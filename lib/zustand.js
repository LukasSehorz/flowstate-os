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
// zufluss-lexware.js ist am 28.07. entfallen: Rechnungen und Belege werden im
// OS selbst gefuehrt, die offenen Rechnungen kommen aus der eigenen Buchhaltung
// (offeneRechnungenEigen weiter unten).
const meta = require("./zufluss-meta.js");

// Wie lange ein Teil als frisch gilt. Kalender ändert sich unter dem Tag,
// CRM-Zahlen selten, Buchhaltung/Ads noch seltener — deshalb unterschiedlich.
// Buchhaltung/Ads nur aufnehmen, wenn ein Key da ist (sonst wuerde veraltet()
// sie ewig als "abgelaufen" melden und bei jeder Frage vergeblich abrufen).
const FRISCHE = {
  kalender: 5 * 60 * 1000,
  crm: 60 * 60 * 1000,
  ...(process.env.DATABASE_URL ? { buchhaltung: 3 * 60 * 60 * 1000 } : {}),
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
// genau daran ist "liste.map is not a function" entstanden. Diese Funktion ist
// seit dem 27.07. die einzige Stelle, die gws-cli auspackt: lib/kalender.js
// benutzt sie, und die frueher zweite Fassung in server.js (/api/calendar) ist
// weg — die Kalenderkarte auf der Zentrale laeuft jetzt hier durch.
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

// Offene Ausgangsrechnungen aus der eigenen Buchhaltung — was Kunden uns noch
// schulden. "Offen" heisst hier dasselbe wie auf der Buchhaltungsseite: eine
// Einnahme, die verbucht, aber noch nicht als bezahlt abgehakt ist.
// Ueberfaellig ist, was ausserdem sein Faelligkeitsdatum ueberschritten hat.
async function offeneRechnungenEigen(nutzer) {
  const buch = require("./buchhaltung.js");
  // uebersicht() liefert "offen" und "offenSumme" schon fertig — dieselbe
  // Rechnung, die auch die Kachel "Offene Rechnungen" zeigt. Zwei Wege zur
  // selben Zahl waeren zwei Gelegenheiten, sich zu unterscheiden.
  const d = await buch.uebersicht(nutzer, "alle");
  const heute = new Date().toISOString().slice(0, 10);
  const ueber = (d.offen || []).filter((o) => o.faellig && String(o.faellig).slice(0, 10) < heute);

  // Die eigene Steuerkanzlei (20.08.2026). Sie stand bis heute NUR in der
  // Datenbank — der Versand las sie dort, das Gespraech nicht. Gemessen:
  //
  //   "Wie heisst unsere Steuerberaterin?"
  //   -> "Weiss ich gerade nicht — der Name steht hier nirgends."
  //
  // Fuer den Versand reichte das (steuer-versand.js holt die Adresse selbst),
  // fuer den Satz "Soll ich sie an Frau Scherger schicken?" nicht.
  //
  // NUR DER NAME, NICHT DIE ADRESSE: Was im STAND steht, kann vorgelesen
  // werden. Eine Mailadresse im Sprechtext ist Buchstabensalat ("o-f-f-i-c-e
  // at steuerkanzlei minus scherger punkt d-e"), und gebraucht wird sie im
  // Gespraech nie — die Adresse zieht der Versand direkt aus der Buchhaltung.
  let kanzlei = null;
  try {
    const k = await buch.steuerkanzlei(nutzer);
    if (k && k.name) kanzlei = { name: k.name, hinterlegt: Boolean(k.an) };
  } catch (e) { console.error("STAND (Steuerkanzlei):", e.message); }

  return {
    anzahl: (d.offen || []).length,
    summe: Math.round(d.offenSumme || 0),
    ueberfaellig_anzahl: ueber.length,
    ueberfaellig_summe: Math.round(ueber.reduce((s, o) => s + Number(o.betrag || 0), 0)),
    kanzlei,
    stand: Date.now(),
  };
}

// System-Abfragen fuer den Hintergrundlauf — ohne angemeldeten Benutzer.
//
// Der Fehler, den das behebt (05.08.): CRM und Buchhaltung wurden NUR
// aufgefrischt, wenn Lukas im Browser angemeldet war — crmSammeln() stieg ohne
// Nutzer sofort aus ("nicht angemeldet"). Der Sammler im Hintergrund hat aber
// nie eine Sitzung. Deshalb standen im STAND wochenalte Zahlen, und Alexandra
// las sie als aktuell vor.
//
// Die Kennzahlen sind firmenweit — sie brauchen gar keinen Nutzer. Nur die
// zeilenrechte-gebundenen Abfragen tun das, und fuer die gibt es hier eine
// Systemfassung.
async function aufgabenSystem() {
  const { Pool } = require("pg");
  aufgabenSystem.pool ||= new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 2, idleTimeoutMillis: 20000,
  });
  aufgabenSystem.pool.on?.("error", () => {});
  const { rows } = await aufgabenSystem.pool.query(
    `select a.titel, a.faellig, a.geplant_am, a.notiz, a.wichtigkeit, a.dringlichkeit,
            f.name as firma_name
       from aufgaben a left join firmen f on f.id = a.firma_id
      where not a.erledigt
      order by a.faellig nulls last limit 30`);
  return rows;
}

async function crmSammeln(nutzer) {
  if (!process.env.DATABASE_URL) return { ok: false, grund: "keine Datenbank" };
  const crm = require("./crm.js");

  // Ohne Sitzung: firmenweite Zahlen. Das ist fuer den STAND ohnehin das
  // Richtige — er beschreibt die Firma, nicht eine Person.
  if (!nutzer) {
    try {
      const [kennzahlen, team, aufgaben] = await Promise.all([
        crm.kennzahlenGesamt().catch(() => null),
        crm.teamZahlenGesamt().catch(() => null),
        aufgabenSystem().catch(() => null),
      ]);
      if (!kennzahlen) return { ok: false, grund: "Kennzahlen nicht abrufbar" };
      return { ok: true, kennzahlen, team, aufgaben };
    } catch (e) {
      return { ok: false, grund: String(e.message).slice(0, 150) };
    }
  }

  try {
    // Aufgaben MIT INHALT (25.07.): Bisher stand im STAND nur die Anzahl
    // ("Offene Aufgaben: 5"). Alexandra wusste also, dass etwas offen ist,
    // aber nicht WAS — auf "was steht heute an?" konnte sie nur den Kalender
    // nennen. Die Aufgaben liegen langst im CRM, sie kamen nur nie an.
    const [kennzahlen, team, aufgaben] = await Promise.all([
      crm.kennzahlen(nutzer).catch(() => null),
      crm.teamZahlen(nutzer).catch(() => null),
      crm.todoListe(nutzer, { nurOffen: true }).catch(() => null),
    ]);
    return { ok: true, kennzahlen, team, aufgaben };
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
    if (c.ok) { neu.crm = { kennzahlen: c.kennzahlen, team: c.team, aufgaben: c.aufgaben }; neu.stand.crm = Date.now(); }
    else neu.crmFehler = c.grund;
  }

  // Offene Rechnungen kommen seit dem 28.07. aus UNSERER Buchhaltung, nicht mehr
  // von Lexware.
  //
  // Der Grund ist keine technische Vorliebe, sondern eine Entscheidung: Belege
  // und Rechnungen werden hier erfasst und archiviert, und der Monatsordner geht
  // an die Steuerberaterin. Lexware ist damit keine Quelle mehr — es waere eine
  // zweite, die langsam veraltet. Alexandra haette dann auf "wie viele offene
  // Rechnungen?" den Stand eines Systems genannt, in das niemand mehr etwas
  // eintraegt.
  //
  // Die Form der Antwort bleibt gleich (anzahl, summe, ueberfaellig_*), damit
  // der STAND und alles, was ihn liest, unveraendert weiterlaufen.
  if (teile.includes("buchhaltung") && process.env.DATABASE_URL && nutzer) {
    const b = await offeneRechnungenEigen(nutzer)
      .catch((e) => ({ fehler: String(e.message).slice(0, 150) }));
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
// ABGELAUFENES KOMMT GAR NICHT ERST IN DEN STAND.
//
// Der zweite Teil des Fehlers vom 05.08.: Selbst mit funktionierender
// Auffrischung kann ein Teil veralten — die Datenbank ist mal weg, ein Abruf
// scheitert. Bisher landete er trotzdem im STAND, mit einem Hinweis "(Stand
// vor 11056 Min.)", den kein Modell als Warnung liest. Alexandra las die
// Zahlen als aktuell vor.
//
// Deshalb wird jetzt WEGGELASSEN statt markiert. Der Unterschied ist
// entscheidend: Bei einem Hinweis MUSS sie richtig entscheiden; bei einer
// Luecke KANN sie gar nicht falsch antworten — sie greift zum Werkzeug und
// bekommt in 100 ms den echten Wert. Determinismus schlaegt Prompt-Regel.
//
// Die Grenze ist grosszuegig (dreifache Frische): Ein Kalender von vor 12
// Minuten ist brauchbar, einer von gestern nicht.
function nochBrauchbar(z, teil) {
  const stand = z.stand?.[teil];
  if (!stand) return false;                       // nie geholt -> nichts zu sagen
  // Fehlt eine ausdrueckliche Frischegrenze, gilt eine Vorgabe — NICHT
  // "unbegrenzt gueltig". Der erste Entwurf gab hier true zurueck, und genau
  // deshalb stand die 7,7 Tage alte Buchhaltung im Test immer noch drin:
  // FRISCHE.buchhaltung existiert nur mit gesetzter DATABASE_URL, ohne sie
  // war die Zahl formal "ohne Frischeanspruch" und damit ewig frisch.
  // Was einen Zeitstempel traegt, kann veralten — ausnahmslos.
  const grenze = FRISCHE[teil] || 3 * 60 * 60 * 1000;
  return Date.now() - stand <= grenze * 3;
}

function alsText(z = lesen()) {
  const jetzt = new Date();
  const zeilen = [];
  const heute = berlinDatum(jetzt);
  const tag = (d) => berlinDatum(new Date(Date.parse(d)));

  zeilen.push(`STAND: ${jetzt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} (Europe/Berlin)`);
  zeilen.push(`HEUTE: ${jetzt.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" })}`);
  // Wo Lukas gerade ist — nur wenn der Browser es gemeldet hat (07.08.2026).
  // Steht direkt beim Datum, weil es dieselbe Sorte Angabe ist: der Rahmen,
  // in dem alles andere gilt. Ohne die Zeile fragte Alexandra dreimal nach
  // dem Ort, waehrend die Spracherkennung an "in Nizza" scheiterte.
  try {
    const wo = require("./standort.js").fuerStand();
    if (wo) zeilen.push(wo);
  } catch { /* ohne Standort laeuft alles wie bisher */ }
  zeilen.push("");

  // WAS SIE UEBER DIE ZUSAMMENARBEIT GELERNT HAT (07.08.2026).
  //
  // Wird abends aus den Gespraechen fortgeschrieben (zufluss-sprache.js) und
  // steht hier ganz oben — vor allen Zahlen. Grund: Es aendert nicht, WAS sie
  // weiss, sondern WIE sie antwortet, und das muss gelten, bevor sie den ersten
  // Satz baut. Gedeckelt auf 25 Zeilen; eine Liste, die den Prompt auffrisst,
  // macht sie nicht klueger, sondern langsamer.
  try {
    const gelernt = require("./zufluss-sprache.js").fuerStand();
    if (gelernt) { zeilen.push(gelernt); zeilen.push(""); }
  } catch { /* noch nichts gelernt — dann eben ohne */ }

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
  const k = nochBrauchbar(z, "crm") ? z.crm?.kennzahlen : null;
  if (k) {
    const alterMin = z.stand?.crm ? Math.round((Date.now() - z.stand.crm) / 60000) : null;
    zeilen.push(`## CRM (Stand vor ${alterMin ?? "?"} Min.)`);
    zeilen.push(`Leads: ${k.leads} · Kunden: ${k.kunden}`);
    zeilen.push(`Offene Deals: ${k.offene_deals} · Pipeline-Wert: ${eur(k.pipeline_wert)}`);
    zeilen.push(`Diesen Monat gewonnen: ${k.gewonnen_monat} Deals · Umsatz: ${eur(k.umsatz_monat)}`);
    zeilen.push(`Fällige Wiedervorlagen: ${k.wiedervorlagen} · Offene Aufgaben: ${k.offene_aufgaben}`);
    // Die Antwort auf "wie viele Leads haben wir (fuer morgen) zur Verfuegung".
    // Steht hier, damit sie ohne Abfrage und ohne Streuung kommt — siehe die
    // Begruendung bei anrufbare_leads in lib/crm.js.
    if (k.anrufbare_leads != null) {
      zeilen.push(`Leads zum Anrufen (Nummer da, nie angerufen): ${k.anrufbare_leads}` +
        ` · davon morgen zur Wiedervorlage: ${k.wiedervorlagen_morgen ?? 0}`);
    }
    zeilen.push("");
  } else if (z.crmFehler) {
    zeilen.push(`## CRM: nicht abrufbar (${z.crmFehler})`, "");
  }

  // --- Aufgaben MIT INHALT (25.07.)
  //
  // Vorher stand oben nur die Anzahl. Auf "was steht heute an?" konnte
  // Alexandra deshalb nur Termine nennen — die Aufgaben lagen im CRM und kamen
  // nie im Gespraech an. Bewusst knapp: heute Geplantes und Ueberfaelliges
  // zuerst, hoechstens 12 Zeilen. Der STAND soll unter 2.500 Token bleiben.
  const aufgaben = Array.isArray(z.crm?.aufgaben) ? z.crm.aufgaben : [];
  if (aufgaben.length) {
    const heuteTag = berlinDatum(jetzt);
    const kurz = (d) => (d ? String(d).slice(0, 10) : "");
    const wichtig = (a) => {
      const g = kurz(a.geplant_am), f = kurz(a.faellig);
      return (g && g <= heuteTag) || (f && f <= heuteTag);
    };
    const sortiert = [...aufgaben].sort((a, b) => (wichtig(b) ? 1 : 0) - (wichtig(a) ? 1 : 0));
    zeilen.push(`## AUFGABEN (offen: ${aufgaben.length})`);
    for (const a of sortiert.slice(0, 12)) {
      const teile = [a.titel];
      if (a.firma_name) teile.push(`bei ${a.firma_name}`);
      const g = kurz(a.geplant_am), f = kurz(a.faellig);
      if (g === heuteTag) teile.push("für heute geplant");
      else if (g) teile.push(`geplant am ${g}`);
      if (f && f < heuteTag) teile.push(`ÜBERFÄLLIG seit ${f}`);
      else if (f) teile.push(`fällig ${f}`);
      zeilen.push("- " + teile.join(" · "));
    }
    if (aufgaben.length > 12) zeilen.push(`- (und ${aufgaben.length - 12} weitere)`);
    zeilen.push("");
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

  // --- Buchhaltung
  //
  // STEHT SEIT DEM 05.08. NUR NOCH DRIN, WENN SIE FRISCH IST — und im
  // Hintergrundlauf wird sie gar nicht mehr geholt. Der Grund ist eine
  // Abwaegung, keine Nachlaessigkeit:
  //
  // Die Zahl braucht einen angemeldeten Nutzer (Zeilenrechte), der Sammler im
  // Hintergrund hat keinen. Sie wuerde also zwangslaeufig wieder veralten —
  // genau der Fehler, der Alexandra "keine offenen Rechnungen" sagen liess,
  // aus 7,7 Tage alten Daten.
  //
  // Das Werkzeug "nachschlagen" beantwortet dieselbe Frage live in rund 100 ms
  // und ohne Zeilenrechte. Eine Luecke im STAND ist hier besser als ein Wert:
  // Sie zwingt zum Nachschlagen, statt eine alte Zahl anzubieten.
  if (z.buchhaltung && nochBrauchbar(z, "buchhaltung")) {
    const b = z.buchhaltung;
    const alterMin = z.stand?.buchhaltung ? Math.round((Date.now() - z.stand.buchhaltung) / 60000) : null;
    zeilen.push(`## BUCHHALTUNG (Stand vor ${alterMin ?? "?"} Min.)`);
    zeilen.push(`Offene Rechnungen: ${b.anzahl} über ${eur(b.summe)}` +
      (b.ueberfaellig_anzahl ? ` · davon überfällig: ${b.ueberfaellig_anzahl} (${eur(b.ueberfaellig_summe)})` : " · keine überfällig"));
    zeilen.push("");
  } else if (z.buchhaltungFehler) {
    zeilen.push(`## BUCHHALTUNG: nicht abrufbar (${z.buchhaltungFehler})`, "");
  }

  // Die Steuerkanzlei steht BEWUSST ausserhalb des Frische-Riegels oben
  // (20.08.2026). Der gilt fuer Zahlen: Eine drei Stunden alte Rechnungssumme
  // waere falsch, und eine Luecke ist dann besser als ein alter Wert. Ein Name
  // ist keine Zahl — "Frau Scherger" ist auch morgen noch richtig. Waere er
  // mit eingesperrt, koennte Alexandra ihre Steuerberaterin ausgerechnet dann
  // nicht benennen, wenn die Buchhaltungszahlen gerade veraltet sind.
  if (z.buchhaltung?.kanzlei?.name) {
    zeilen.push(`## STEUERKANZLEI: ${z.buchhaltung.kanzlei.name}`
      + (z.buchhaltung.kanzlei.hinterlegt
        ? " (Adresse ist hinterlegt — der Versand nimmt sie selbst, sie muss nie genannt werden)"
        : " (ACHTUNG: keine Mailadresse hinterlegt — vor dem Versand nachfragen)"), "");
  }

  // --- Meta-Ads (KPIs letzte 7 Tage)
  if (z.ads && nochBrauchbar(z, "ads")) {
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
