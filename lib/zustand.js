// Der Zustand — was Alexandra über die Firma weiß, bevor gefragt wird.
//
// Der Grund (Latenz-Analyse 20.07.2026): Eine agentische Anfrage über Hermes
// braucht 15-30 s, weil sie Werkzeuge aufruft und eine Schleife dreht. Für ein
// Gespräch ist das zu lang.
//
// Statt einzelne Fragen mit Stichwörtern abzukürzen — das bricht bei der ersten
// unvorhergesehenen Formulierung — halten wir den Zustand der Firma vor. Ein
// Sammler schreibt regelmäßig eine kompakte Fassung; eine Frage ist dann EIN
// Modellaufruf über diesen Text. Kein Werkzeug, keine Schleife: ~1-2 s und
// ~3.000 Token statt 81.000.
//
// Wichtig: Das Sammeln selbst kostet KEINE Token — es sind SQL-Abfragen und ein
// gws-cli-Aufruf. Nur das Beantworten kostet.
//
// Der Zustand muss knapp bleiben. Wächst er auf Zehntausende Token, ist der
// Vorteil dahin. Deshalb: verdichtete Zahlen, keine Rohdaten, keine Mailtexte.

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const GWS_ENV = { ...process.env, GWS_ENCRYPTION: "none" };
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, "..", "data");
const ZUSTAND_DATEI = path.join(DATA_PATH, "zustand.json");

// Zufluss-Module (P3.7). Schlummern ohne Key -> dann kein Abschnitt im Zustand.
const lexware = require("./zufluss-lexware.js");
const meta = require("./zufluss-meta.js");

// Wie lange ein Teil als frisch gilt. Kalender ändert sich unter dem Tag,
// CRM-Zahlen selten, Buchhaltung/Ads noch seltener — deshalb unterschiedlich.
// Buchhaltung/Ads nur aufnehmen, wenn ein Key da ist (sonst wuerde veraltet()
// sie ewig als "abgelaufen" melden und bei jeder Frage vergeblich abrufen).
const FRISCHE = {
  kalender: 5 * 60 * 1000,
  crm: 60 * 60 * 1000,
  ...(lexware.verfuegbar() ? { buchhaltung: 3 * 60 * 60 * 1000 } : {}),
  ...(meta.verfuegbar() ? { ads: 3 * 60 * 60 * 1000 } : {}),
};

// ---------------------------------------------------------------- Sammeln

function berlinDatum(d) {
  try { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}
const berlinOffset = (d) => (d.getUTCMonth() > 2 && d.getUTCMonth() < 10 ? "+02:00" : "+01:00");

const jsonOderNichts = (s) => { try { return JSON.parse(s); } catch { return null; } };

// Festwissen ueber die Firma (Stufe 3, 25.07.): Preise, Leistungen, Team.
// Stand bisher NICHT im STAND — fuer "was kostet Webdesign bei uns?" musste
// Alexandra den Umweg ueber das zweite Gehirn nehmen (eigene Aktion, mehrere
// Sekunden, konnte danebengreifen). Es ist statisches Wissen, das in jede
// zweite Frage hineinspielt, also gehoert es direkt in den STAND.
// Gedeckelt, damit die Datei den Prompt nicht wieder aufblaeht.
const VAULT = () => process.env.VAULT_PATH || "/vault";
const FIRMA_MAX = 2600;
let firmaCache = { text: "", mtime: 0 };

function firmaLaden() {
  const datei = path.join(VAULT(), "kontext", "firma.md");
  try {
    const st = fs.statSync(datei);
    if (st.mtimeMs !== firmaCache.mtime) {
      firmaCache = { text: fs.readFileSync(datei, "utf-8").slice(0, FIRMA_MAX), mtime: st.mtimeMs };
    }
    return firmaCache.text;
  } catch { return ""; }
}

// gws-cli verpackt die Termine als JSON-STRING in einer Sicherheits-Huelle:
//   { events: { warning: "EXTERNAL CONTENT…", data: "[{…}]", security_warnings: [...] } }
// Wer nur d.events nimmt, bekommt darum einen String und nicht die Liste —
// genau daran ist "liste.map is not a function" entstanden. Dieselbe Logik
// steckt in /api/calendar in server.js; sie ist dort erprobt.
function termineLesen(stdout) {
  const daten = jsonOderNichts(stdout);
  let roh = null;

  const huelle = daten && daten.events;
  if (huelle && typeof huelle === "object" && typeof huelle.data === "string") {
    const innen = jsonOderNichts(huelle.data);
    if (Array.isArray(innen)) roh = innen;
  }
  if (!roh) {
    for (const k of [daten, daten?.events, daten?.items, daten?.data]) {
      // security_warnings sehen wie eine Liste aus, sind aber keine Termine
      if (Array.isArray(k) && !(k[0] && typeof k[0] === "object" && "matched_text" in k[0])) { roh = k; break; }
    }
  }
  if (!Array.isArray(roh)) return [];

  return roh
    .filter((t) => (t.status || "confirmed") !== "cancelled")
    .map((x) => {
      const t = x.event || x;
      const wann = (f) => (t[f] && (t[f].dateTime || t[f].date)) || (typeof t[f] === "string" ? t[f] : "");
      return {
        // Die Termin-ID (Phase 4, 25.07.): noetig, um einen Termin zu
        // verschieben oder abzusagen. Sie bleibt INTERN — im STAND, den das
        // Modell sieht, taucht sie nicht auf: Alexandra darf IDs nie
        // aussprechen, und was sie nicht kennt, kann sie nicht vorlesen.
        id: t.id || t.event_id || t.eventId || "",
        start: wann("start") || t.start_time || t.startTime || "",
        ende: wann("end") || t.end_time || t.endTime || "",
        titel: t.summary || t.title || t.name || "(ohne Titel)",
        ort: t.location || "",
      };
    })
    .filter((t) => t.start);
}

// Fenster (Stufe 3, 25.07.): 14 Tage waren zu knapp — auf "was steht in drei
// Wochen an?" oder "hab ich im August schon was?" gab es schlicht keine Daten,
// und Alexandra sagte "nichts", obwohl Termine existierten. 35 Tage decken den
// naechsten Monat ab; 200 Eintraege bleiben als Obergrenze reichlich.
// Ueber KALENDER_TAGE anpassbar, falls der Kalender mal sehr voll wird.
function kalenderSammeln(tageVoraus = Number(process.env.KALENDER_TAGE || 35), tageZurueck = 1) {
  return new Promise((fertig) => {
    const von = new Date(Date.now() - tageZurueck * 86400000);
    const bis = new Date(Date.now() + tageVoraus * 86400000);
    execFile(
      "gws-cli",
      ["calendar", "list",
        "--from", `${berlinDatum(von)}T00:00:00${berlinOffset(von)}`,
        "--to", `${berlinDatum(bis)}T00:00:00${berlinOffset(bis)}`,
        "--max", "200"],
      { env: GWS_ENV, timeout: 30000 },
      // Alles in try/catch: Der Rueckruf laeuft ausserhalb der Promise-Kette.
      // Was hier fliegt, faengt kein .catch() beim Aufrufer — es beendet den
      // ganzen Prozess. Genau daran ist der Container in einer Schleife gestorben.
      (err, stdout, stderr) => {
        try {
          if (err) return fertig({ ok: false, fehler: String(stderr || err.message).slice(0, 200) });
          fertig({ ok: true, termine: termineLesen(stdout) });
        } catch (e) {
          fertig({ ok: false, fehler: "Kalender-Antwort nicht lesbar: " + String(e.message).slice(0, 150) });
        }
      }
    );
  });
}

async function crmSammeln(nutzer) {
  if (!process.env.DATABASE_URL || !nutzer) return { ok: false, grund: "keine Datenbank oder nicht angemeldet" };
  try {
    const crm = require("./crm.js");
    const [kennzahlen, team] = await Promise.all([
      crm.kennzahlen(nutzer).catch(() => null),
      crm.teamZahlen(nutzer).catch(() => null),
    ]);
    return { ok: true, kennzahlen, team };
  } catch (e) {
    return { ok: false, grund: String(e.message).slice(0, 150) };
  }
}

// ---------------------------------------------------------------- Aufbauen

async function bauen(nutzer, teile = ["kalender", "crm"]) {
  const alt = lesen();
  const neu = { ...alt, stand: {} , ...(alt.stand ? { stand: { ...alt.stand } } : {}) };
  neu.stand = neu.stand || {};

  if (teile.includes("kalender")) {
    const k = await kalenderSammeln();
    if (k.ok) { neu.kalender = k.termine; neu.stand.kalender = Date.now(); }
    else neu.kalenderFehler = k.fehler;
  }

  if (teile.includes("crm")) {
    const c = await crmSammeln(nutzer);
    if (c.ok) { neu.crm = { kennzahlen: c.kennzahlen, team: c.team }; neu.stand.crm = Date.now(); }
    else neu.crmFehler = c.grund;
  }

  if (teile.includes("buchhaltung") && lexware.verfuegbar()) {
    const b = await lexware.offeneRechnungen().catch((e) => ({ fehler: String(e.message).slice(0, 150) }));
    if (b && !b.fehler) { neu.buchhaltung = b; neu.stand.buchhaltung = Date.now(); }
    else if (b?.fehler) neu.buchhaltungFehler = b.fehler;
  }

  if (teile.includes("ads") && meta.verfuegbar()) {
    const a = await meta.kampagnenKpi().catch((e) => ({ fehler: String(e.message).slice(0, 150) }));
    if (a && !a.fehler) { neu.ads = a; neu.stand.ads = Date.now(); }
    else if (a?.fehler) neu.adsFehler = a.fehler;
  }

  schreiben(neu);
  return neu;
}

function lesen() {
  try { return JSON.parse(fs.readFileSync(ZUSTAND_DATEI, "utf-8")); }
  catch { return { stand: {} }; }
}

function schreiben(z) {
  try {
    fs.mkdirSync(path.dirname(ZUSTAND_DATEI), { recursive: true });
    fs.writeFileSync(ZUSTAND_DATEI, JSON.stringify(z), "utf-8");
  } catch (e) { console.error("Zustand nicht schreibbar:", e.message); }
}

// Welche Teile sind abgelaufen?
function veraltet(z = lesen()) {
  const jetzt = Date.now();
  return Object.entries(FRISCHE)
    .filter(([teil, dauer]) => !z.stand?.[teil] || jetzt - z.stand[teil] > dauer)
    .map(([teil]) => teil);
}

// ---------------------------------------------------------------- Verdichten

// Aus dem Rohzustand wird der Text, den das Modell zu sehen bekommt.
// Kurz halten: jedes Token hier zahlt bei JEDER Frage mit.
function alsText(z = lesen()) {
  const jetzt = new Date();
  const zeilen = [];
  const heute = berlinDatum(jetzt);
  const tag = (d) => berlinDatum(new Date(Date.parse(d)));

  zeilen.push(`STAND: ${jetzt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} (Europe/Berlin)`);
  zeilen.push(`HEUTE: ${jetzt.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" })}`);
  zeilen.push("");

  // Festwissen zuerst: Preise, Leistungen, Team. Aendert sich selten, wird aber
  // staendig gebraucht — damit beantwortet sie Firmenfragen sofort statt ueber
  // eine eigene Suche im zweiten Gehirn.
  const firma = firmaLaden();
  if (firma) {
    zeilen.push("## FIRMA (Festwissen — gilt immer)");
    zeilen.push(firma.trim());
    zeilen.push("");
  }

  // --- Kalender, nach Tagen gruppiert
  if (Array.isArray(z.kalender)) {
    const alterMin = z.stand?.kalender ? Math.round((Date.now() - z.stand.kalender) / 60000) : null;
    zeilen.push(`## KALENDER (Stand vor ${alterMin ?? "?"} Min.)`);
    const nachTag = {};
    for (const t of z.kalender) {
      const d = tag(t.start);
      (nachTag[d] ||= []).push(t);
    }
    const tage = Object.keys(nachTag).sort();
    if (!tage.length) zeilen.push("keine Termine im Zeitraum");
    for (const d of tage) {
      const dat = new Date(d + "T12:00:00Z");
      const label = dat.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });
      const marke = d === heute ? " [HEUTE]" : "";
      zeilen.push(`${d} ${label}${marke}:`);
      for (const t of nachTag[d]) {
        const uhr = (v) => (String(v).match(/T(\d{2}:\d{2})/) || [, "ganztägig"])[1];
        zeilen.push(`  ${uhr(t.start)}${t.ende ? "-" + uhr(t.ende) : ""} ${t.titel}${t.ort ? " (" + t.ort + ")" : ""}`);
      }
    }
    zeilen.push("");
  } else if (z.kalenderFehler) {
    zeilen.push(`## KALENDER: nicht abrufbar (${z.kalenderFehler})`, "");
  }

  // --- CRM
  const k = z.crm?.kennzahlen;
  if (k) {
    const alterMin = z.stand?.crm ? Math.round((Date.now() - z.stand.crm) / 60000) : null;
    zeilen.push(`## CRM (Stand vor ${alterMin ?? "?"} Min.)`);
    zeilen.push(`Leads: ${k.leads} · Kunden: ${k.kunden}`);
    zeilen.push(`Offene Deals: ${k.offene_deals} · Pipeline-Wert: ${eur(k.pipeline_wert)}`);
    zeilen.push(`Diesen Monat gewonnen: ${k.gewonnen_monat} Deals · Umsatz: ${eur(k.umsatz_monat)}`);
    zeilen.push(`Fällige Wiedervorlagen: ${k.wiedervorlagen} · Offene Aufgaben: ${k.offene_aufgaben}`);
    zeilen.push("");
  } else if (z.crmFehler) {
    zeilen.push(`## CRM: nicht abrufbar (${z.crmFehler})`, "");
  }

  // --- Team
  if (Array.isArray(z.crm?.team) && z.crm.team.length) {
    zeilen.push("## TEAM (pro Person)");
    for (const p of z.crm.team) {
      zeilen.push(`${p.name} (${p.rolle}): ${p.leads} Leads · ${p.kunden} Kunden · ` +
        `${p.offen} offene Deals · ${p.gewonnen} gewonnen · ${p.verloren} verloren · ` +
        `Umsatz Monat ${eur(p.umsatz_monat)} · Anrufe heute ${p.anrufe_heute}`);
    }
    zeilen.push("");
  }

  // --- Buchhaltung (offene Ausgangsrechnungen, Lexware)
  if (z.buchhaltung) {
    const b = z.buchhaltung;
    const alterMin = z.stand?.buchhaltung ? Math.round((Date.now() - z.stand.buchhaltung) / 60000) : null;
    zeilen.push(`## BUCHHALTUNG (Stand vor ${alterMin ?? "?"} Min.)`);
    zeilen.push(`Offene Rechnungen: ${b.anzahl} über ${eur(b.summe)}` +
      (b.ueberfaellig_anzahl ? ` · davon überfällig: ${b.ueberfaellig_anzahl} (${eur(b.ueberfaellig_summe)})` : " · keine überfällig"));
    zeilen.push("");
  } else if (z.buchhaltungFehler) {
    zeilen.push(`## BUCHHALTUNG: nicht abrufbar (${z.buchhaltungFehler})`, "");
  }

  // --- Meta-Ads (KPIs letzte 7 Tage)
  if (z.ads) {
    const a = z.ads;
    const alterMin = z.stand?.ads ? Math.round((Date.now() - z.stand.ads) / 60000) : null;
    zeilen.push(`## META-ADS ${a.zeitraum ? "(" + a.zeitraum + ")" : ""} (Stand vor ${alterMin ?? "?"} Min.)`);
    zeilen.push(`Ausgaben: ${eur(a.ausgaben)}` +
      (a.roas != null ? ` · ROAS: ${a.roas}` : "") +
      (a.leads != null ? ` · Leads: ${a.leads}` : "") +
      ` · Klicks: ${a.klicks}` + (a.ctr != null ? ` · CTR: ${a.ctr}%` : ""));
    zeilen.push("");
  } else if (z.adsFehler) {
    zeilen.push(`## META-ADS: nicht abrufbar (${z.adsFehler})`, "");
  }

  return zeilen.join("\n");
}

const eur = (n) => Number(n || 0).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " EUR";

module.exports = { bauen, lesen, schreiben, veraltet, alsText, termineLesen, firmaLaden, ZUSTAND_DATEI, FRISCHE };
