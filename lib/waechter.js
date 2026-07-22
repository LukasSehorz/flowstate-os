// lib/waechter.js — proaktive Warnungen (P4.2, Bereich J: "ungefragte Warnungen").
//
// Prueft regelmaessig CRM + Kalender und meldet, was Aufmerksamkeit braucht:
// stille Leads, faellige Wiedervorlagen, ueberfaellige Aufgaben, Termin-Kollisionen.
// Bewusst DETERMINISTISCH (kein LLM-Raten in einer Warnung — "boring is beautiful"),
// gebuendelt zu EINER Sprach-Meldung, mit Tages-Dedup: jede Warnung feuert
// hoechstens einmal pro Tag. Rohzahlen ("12 Tage") wandelt der Aussprache-Helfer
// beim Sprechen in Worte ("zwoelf Tage"), hier bleibt der Text schlicht.

const fs = require("fs");
const path = require("path");
const crm = require("./crm.js");
const zustand = require("./zustand.js");

const DATA = process.env.DATA_PATH || "/data";
const MERK_DATEI = path.join(DATA, "waechter-gemeldet.json");
const STILLE_LEAD_TAGE = Number(process.env.STILLE_LEAD_TAGE || 12);

const berlinTag = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

// ---------------------------------------------------------------- Regeln
// Jede liefert eine Liste { schluessel, dringlichkeit, text }. Der schluessel
// dedupliziert pro Tag (die Merkdatei wird taeglich zurueckgesetzt).

async function stilleLeads() {
  const { rows } = await crm.system(
    `select id, name, (current_date - letzte_aktivitaet::date) as tage
       from public.firmen
      where status = 'lead' and letzte_aktivitaet is not null
        and letzte_aktivitaet < now() - ($1 * interval '1 day')
      order by letzte_aktivitaet limit 5`, [STILLE_LEAD_TAGE]);
  return rows.map((r) => ({
    schluessel: `stiller-lead:${r.id}`,
    dringlichkeit: 2,
    text: `${r.name} meldet sich nicht — seit ${r.tage} Tagen kein Kontakt. Zeit fuer ein Follow-up.`,
  }));
}

async function faelligeWiedervorlagen() {
  const { rows } = await crm.system(
    `select id, name, (current_date - wiedervorlage) as tage
       from public.firmen
      where wiedervorlage is not null and wiedervorlage <= current_date
      order by wiedervorlage limit 5`);
  return rows.map((r) => ({
    schluessel: `wiedervorlage:${r.id}`,
    dringlichkeit: 3,
    text: Number(r.tage) <= 0
      ? `Die Wiedervorlage bei ${r.name} ist heute faellig.`
      : `Die Wiedervorlage bei ${r.name} ist seit ${r.tage} Tagen faellig.`,
  }));
}

async function ueberfaelligeAufgaben() {
  const { rows } = await crm.system(
    `select a.id, a.titel, (current_date - a.faellig) as tage, f.name as firma
       from public.aufgaben a left join public.firmen f on f.id = a.firma_id
      where not a.erledigt and a.faellig is not null and a.faellig < current_date
      order by a.faellig limit 5`);
  return rows.map((r) => ({
    schluessel: `aufgabe:${r.id}`,
    dringlichkeit: 3,
    text: `Die Aufgabe „${r.titel}"${r.firma ? " bei " + r.firma : ""} ist seit ${r.tage} Tagen ueberfaellig.`,
  }));
}

// Termin-Kollisionen aus dem vorgehaltenen Kalender (heute + morgen).
function terminKollisionen() {
  const z = zustand.lesen();
  const evs = (Array.isArray(z.kalender) ? z.kalender : [])
    .map((t) => ({ titel: t.titel || t.summary || "ein Termin", start: Date.parse(t.start), ende: Date.parse(t.end || t.ende) }))
    .filter((t) => t.start && t.ende)
    .sort((a, b) => a.start - b.start);
  const grenze = Date.now() + 2 * 86400000;
  const alerts = [];
  for (let i = 0; i < evs.length - 1; i++) {
    const a = evs[i], b = evs[i + 1];
    if (a.start > grenze) break;
    if (b.start < a.ende) {
      const zeit = new Date(b.start).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
      alerts.push({
        schluessel: `kollision:${a.start}:${b.start}`,
        dringlichkeit: 3,
        text: `Zwei Termine ueberschneiden sich: ${a.titel} und ${b.titel} gegen ${zeit} Uhr.`,
      });
    }
  }
  return alerts;
}

// ---------------------------------------------------------------- Dedup (taeglich)
function gemeldetLaden() {
  try {
    const d = JSON.parse(fs.readFileSync(MERK_DATEI, "utf-8"));
    if (d.tag === berlinTag()) return new Set(d.schluessel || []);
  } catch {}
  return new Set(); // neuer Tag (oder erste Nutzung) -> frisch
}
function gemeldetSpeichern(set) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(MERK_DATEI, JSON.stringify({ tag: berlinTag(), schluessel: [...set] }));
  } catch {}
}

// ---------------------------------------------------------------- Hauptlauf
// Ermittelt NEUE Warnungen (heute noch nicht gemeldet) und formatiert sie zu
// EINER natuerlichen Sprach-Meldung. Leerer Text = nichts Neues zu melden.
async function pruefe() {
  const ergebnisse = await Promise.allSettled([stilleLeads(), faelligeWiedervorlagen(), ueberfaelligeAufgaben()]);
  const alle = ergebnisse
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .concat(terminKollisionen());

  const gemeldet = gemeldetLaden();
  const neu = alle.filter((a) => !gemeldet.has(a.schluessel));
  if (!neu.length) return { text: "", anzahl: 0 };

  neu.sort((a, b) => b.dringlichkeit - a.dringlichkeit);
  const zeigen = neu.slice(0, 5);
  neu.forEach((a) => gemeldet.add(a.schluessel));
  gemeldetSpeichern(gemeldet);

  let text = zeigen.length === 1
    ? zeigen[0].text
    : "Kurz was fuer dich: " + zeigen.map((a) => a.text).join(" ");
  if (neu.length > zeigen.length) text += ` Und ${neu.length - zeigen.length} weitere Punkte.`;
  return { text, anzahl: neu.length };
}

module.exports = { pruefe };
