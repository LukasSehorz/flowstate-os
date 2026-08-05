// lib/report.js — der proaktive Tages-Report (Wunsch Lukas 22.07.).
//
// Architektur (Entscheidung 22.07., ueberarbeitet am 05.08.):
//   Dashboard PLANT (server.js, zuverlaessig, keine Cron-Drift-Sperre)
//   -> SONNET FORMULIERT aus Dashboard-Daten
//   -> Dashboard LIEST per Stimme vor (telegram.push).
//
// HERMES IST AM 05.08. AUS DIESEM PFAD GEFLOGEN. Er war bis dahin erste Wahl,
// mit Sonnet als Notnagel. Gemessen am 25.07.: median 142 s, 41 % Timeout —
// fuer einen Text, der um acht Uhr da sein soll. Jedes Mal, wenn er nicht kam,
// sprang ohnehin Sonnet ein; der Umweg kostete nur Wartezeit und eine
// Fehlerquelle. Sonnet formuliert denselben Text in Sekunden.
//
// Die DATEN sind derselbe Umbau: Bis dahin gab es Termine plus ein paar
// aggregierte Kennzahlen ("23 Leads, 6 offene Aufgaben"). Das ist eine
// Statistik, kein Briefing. Seit dem 05.08. kommen dazu: was sich seit gestern
// getan hat (lib/neuigkeiten.js), ueberfaellige Aufgaben MIT Titel, faellige
// Wiedervorlagen MIT Firmennamen, die naechste faellige Rechnung und ungelesene
// WhatsApp. Also das, was Lukas morgens tatsaechlich wissen muss.

const fs = require("fs");
const path = require("path");
const zustand = require("./zustand.js");
const crm = require("./crm.js");
const schnell = require("./schnell.js");
const neuigkeiten = require("./neuigkeiten.js");
const whatsapp = require("./whatsapp.js");
const { Pool } = require("pg");

const VAULT = process.env.VAULT_PATH || "/vault";
const STIMME = path.join(VAULT, "instanzen", "lukas", "STIMME-alexandra.md");

const berlinTag = (offsetTage = 0) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" })
    .format(new Date(Date.now() + offsetTage * 86400000));
const tagVon = (iso) => {
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? "" : new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ts));
};
const uhr = (iso) => (String(iso).match(/T(\d{2}:\d{2})/) || [, "ganztägig"])[1];
const eur = (n) => Number(n || 0).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " Euro";

// Dashboard-Daten (Kalender + CRM) einsammeln — als Kontext fuer Hermes UND als
// Grundlage fuer den Sonnet-Fallback. Art-bewusst: Morgen-Briefing blickt auf
// HEUTE (der Tag, der beginnt), Abend-Report auf MORGEN (der Tag, der kommt).
let pool = null;
function db() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 2, idleTimeoutMillis: 20000,
    });
    pool.on("error", () => {});
  }
  return pool;
}
// Eine Abfrage darf das Briefing nie verhindern. Faellt eine aus, fehlt genau
// ihre Zeile — um acht Uhr ist ein knapperes Briefing besser als gar keins.
const frag = async (sql, w) => { try { return (await db().query(sql, w)).rows; } catch { return null; } };

// Alles einsammeln, was Lukas morgens (bzw. abends) wissen muss.
// Art-bewusst: Morgen-Briefing blickt auf HEUTE, Abend-Report auf MORGEN.
async function datenSammeln(art) {
  const z = zustand.lesen();
  const istMorgen = art === "morgen";
  const tag = berlinTag(istMorgen ? 0 : 1);
  const wort = istMorgen ? "heute" : "morgen";
  const termine = (Array.isArray(z.kalender) ? z.kalender : [])
    .filter((t) => tagVon(t.start) === tag)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((t) => `${uhr(t.start)} ${t.titel}`);

  // Parallel, damit das Briefing nicht die Summe aller Wartezeiten kostet.
  const [k, veraenderung, aufgaben, wieder, rechnung, wa] = await Promise.all([
    crm.kennzahlenGesamt().catch(() => null),
    neuigkeiten.neuigkeiten(istMorgen ? "seit gestern" : "heute").catch(() => null),
    frag("select titel, faellig from aufgaben where not erledigt and faellig <= current_date order by faellig limit 4", []),
    frag("select name, wiedervorlage from firmen where wiedervorlage <= current_date order by wiedervorlage limit 4", []),
    frag("select gegenstelle, betrag, faellig from buchungen where not bezahlt and faellig is not null " +
         "and faellig <= current_date + 7 order by faellig limit 2", []),
    whatsapp.leseChat("neue Nachrichten").catch(() => null),
  ]);

  const langTag = new Date(tag + "T12:00:00").toLocaleDateString("de-DE",
    { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });

  const zeilen = [
    `Report-Art: ${istMorgen ? "Morgen-Briefing (Blick auf HEUTE)" : "Abend-Report (Blick auf morgen)"}`,
    `Termine ${wort} (${langTag}): ${termine.length ? termine.join(" · ") : "keine"}`,
  ];
  if (aufgaben?.length) {
    zeilen.push("Faellig oder ueberfaellig: " + aufgaben.map((a) => a.titel).join(" · "));
  }
  if (wieder?.length) {
    zeilen.push("Wiedervorlagen faellig: " + wieder.map((f) => f.name).join(" · "));
  }
  if (rechnung?.length) {
    zeilen.push("Naechste Zahlung: " + rechnung.map((r) =>
      `${r.gegenstelle || "Rechnung"} ${eur(r.betrag)} am ${new Date(r.faellig).toLocaleDateString("de-DE", { day: "numeric", month: "long" })}`).join(" · "));
  }
  if (veraenderung?.ok && veraenderung.reply && !/nichts getan/i.test(veraenderung.reply)) {
    zeilen.push("Veraenderungen: " + veraenderung.reply);
  }
  // Nur melden, wenn wirklich etwas offen ist — "nichts Ungelesenes" gehoert
  // nicht in ein Briefing, das kurz sein soll.
  if (wa?.reply && !/Nichts Ungelesenes|nichts Neues|nichts reingekommen/i.test(wa.reply)) {
    zeilen.push("WhatsApp: " + wa.reply);
  }
  if (k) {
    zeilen.push(`Zahlen: ${k.leads} Leads, diesen Monat ${k.gewonnen_monat} Deal(s) gewonnen (${eur(k.umsatz_monat)}), ` +
      `${k.offene_aufgaben} offene Aufgaben, ${k.wiedervorlagen} faellige Wiedervorlagen.`);
  }
  return { daten: zeilen.join(String.fromCharCode(10)), termine };
}

// Die 3 wichtigsten Weltnachrichten (Wunsch Lukas 22.07., nur fuers Morgen-
// Briefing). Ueber Sonnet mit Websuche — aktuell und verlaesslich; Hermes webt
// sie danach in seiner Stimme ein. Faellt sie aus, laeuft das Briefing ohne News.
async function weltNews() {
  const heute = new Date().toLocaleDateString("de-DE",
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
  const system =
    `Du bist ein knapper Nachrichten-Kurator. Heute ist ${heute}. Nenne die 3 WICHTIGSTEN ` +
    `aktuellen Nachrichten aus der Welt (global relevant: Politik, Wirtschaft, Technologie, ` +
    `groessere Ereignisse; deutscher Bezug zaehlt mit). Nutze die Websuche fuer aktuelle Fakten, ` +
    `nichts erfinden. Antworte als GENAU 3 sehr kurze Punkte, je EIN faktischer Satz, ohne Meinung, ` +
    `ohne Quellen-URLs. Format: "1. … 2. … 3. …"`;
  try {
    const t = await schnell.denke(system, "Die 3 wichtigsten Weltnachrichten heute.",
      { maxSuchen: 3, maxTokens: 320, timeoutMs: 45000 });
    return String(t || "").trim();
  } catch { return ""; }
}

async function sonnetReport(daten, art) {
  const istMorgen = art === "morgen";
  let stimme = "";
  try { stimme = fs.readFileSync(STIMME, "utf-8"); } catch {}
  const system = stimme +
    `\n\n## Aufgabe: ${istMorgen ? "Morgen-Briefing" : "Abend-Report"}\nFasse fuer Lukas kurz und ` +
    `persoenlich zusammen — als wuerdest du dich ${istMorgen ? "morgens bei ihm melden und den Tag anschieben" : "abends bei ihm melden"}. ` +
    `Zuerst die wichtigsten Termine ${istMorgen ? "heute" : "morgen"} (werte/priorisiere, nicht alles ` +
    "aufzaehlen), dann kurz, was bei den Zahlen/To-Dos ansteht. " +
    (istMorgen ? "Zum Schluss die 3 Weltnachrichten aus den Daten, je ein knapper Satz, eingeleitet mit 'Und kurz aus der Welt:'. " : "") +
    `${istMorgen ? "4-6" : "3-5"} Saetze, natuerlich gesprochen, deine ` +
    `Hoerregeln (Uhrzeiten wie 'elf Uhr', keine Rohzahlen). Beginne mit ` +
    (istMorgen ? "'Guten Morgen! Dein Tag im Blick:'" : "'Hey, kurzer Blick auf morgen:'") +
    ". Nichts erfinden — nur was in den Daten steht.";
  return (await schnell.frage(system, daten, { maxTokens: istMorgen ? 450 : 320, timeoutMs: 25000 })).trim();
}

// Rohdaten -> Report-Text. Hermes zuerst (reich), Sonnet als Ausfallnetz.
// Morgens zusaetzlich die 3 wichtigsten Weltnachrichten (parallel geholt).
async function baueReport({ art = "abend" } = {}) {
  const istMorgen = art === "morgen";
  const [{ daten, termine }, news] = await Promise.all([
    datenSammeln(art),
    istMorgen ? weltNews() : Promise.resolve(""),
  ]);
  const datenPlus = news
    ? daten + `

Weltnachrichten (schon recherchiert - gib diese 3 sinngemaess wieder, nichts hinzuerfinden):
${news}`
    : daten;
  // Hermes ist am 05.08. aus diesem Pfad geflogen (Begruendung im Modulkopf).
  // Sonnet formuliert direkt; faellt auch das aus, kommt wenigstens die
  // Terminliste. Ein Briefing, das nicht kommt, ist schlimmer als ein knappes.
  try {
    return { ok: true, text: await sonnetReport(datenPlus, art), termine: termine.length, quelle: "sonnet" };
  } catch (e) {
    console.error("Report-Formulierung fehlgeschlagen:", String(e.message).slice(0, 120));
    const t = termine.length
      ? `${istMorgen ? "Heute" : "Morgen"}: ${termine.join(", ")}.`
      : `${istMorgen ? "Heute" : "Morgen"} stehen keine Termine im Kalender.`;
    return { ok: true, text: `${istMorgen ? "Guten Morgen!" : "Hey, kurzer Blick auf morgen."} ${t}`,
             termine: termine.length, quelle: "notnagel" };
  }
}

module.exports = { baueReport };
