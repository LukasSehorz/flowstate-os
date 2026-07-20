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

// Wie lange ein Teil als frisch gilt. Kalender ändert sich unter dem Tag,
// CRM-Zahlen selten — deshalb unterschiedlich.
const FRISCHE = {
  kalender: 5 * 60 * 1000,
  crm: 60 * 60 * 1000,
};

// ---------------------------------------------------------------- Sammeln

function berlinDatum(d) {
  try { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}
const berlinOffset = (d) => (d.getUTCMonth() > 2 && d.getUTCMonth() < 10 ? "+02:00" : "+01:00");

function kalenderSammeln(tageVoraus = 14, tageZurueck = 1) {
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
      (err, stdout, stderr) => {
        if (err) return fertig({ ok: false, fehler: String(stderr || err.message).slice(0, 200) });
        let roh = stdout;
        try {
          const aussen = JSON.parse(stdout);
          roh = typeof aussen === "string" ? aussen : (aussen.result ?? aussen.data ?? aussen);
        } catch { /* war schon reines JSON */ }
        let liste = [];
        try {
          const d = typeof roh === "string" ? JSON.parse(roh) : roh;
          liste = Array.isArray(d) ? d : (d.events || d.items || []);
        } catch { liste = []; }
        fertig({
          ok: true,
          termine: liste.map((t) => ({
            start: t.start || t.start_time || "",
            ende: t.end || t.end_time || "",
            titel: t.summary || t.title || "(ohne Titel)",
            ort: t.location || "",
          })).filter((t) => t.start),
        });
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

  return zeilen.join("\n");
}

const eur = (n) => Number(n || 0).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " EUR";

module.exports = { bauen, lesen, schreiben, veraltet, alsText, ZUSTAND_DATEI, FRISCHE };
