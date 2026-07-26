// Flowstate CRM — Oberflaeche nach Estera-Vorbild, Flowstate-Inhalte.
const crm = require("./crm.js");
const { schale } = require("./schale.js");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const geld = (n) => (n == null ? "–" : Math.round(Number(n)).toLocaleString("de-DE") + " €");
// Abschluss-Wahrscheinlichkeit einer Phase: erste 10 %, letzte 100 % - skaliert mit der Phasenzahl.
// Feste Wahrscheinlichkeit je Stufe. "Follow-up" bleibt bei 10 %, weil ein erreichter
// Kontakt allein noch nichts ueber einen Abschluss sagt — erst das Erstgespraech zaehlt.
// Unbekannte Stufen fallen auf die alte gleichmaessige Verteilung zurueck.
const STUFEN_QUOTE = {
  "Neu": 10,
  "Follow-up": 10,
  // Vor dem Gespräch wird nur vorbereitet — das hebt die Abschlusschance noch nicht.
  "Analyse & Strategie": 10,
  // Ein gebuchtes Gespräch ist der grosse Sprung. Bei KI heisst es Readiness-Check.
  "Erstgespräch": 55,
  "Readiness-Check gebucht": 55,
  // Nach dem Gespräch entscheidet kaum jemand sofort. Wer hier steht, hat Interesse
  // gezeigt, ist aber noch nicht sicher — deutlich besser als vor dem Gespräch.
  "Follow-up nach Erstgespräch": 65,
  // Bei KI ist das Ergebnis des Readiness-Checks der Masterplan.
  "KI-Masterplan erstellen": 65,
  "KI-Masterplan versendet": 65,
  "Zweites Erstgespräch": 75,
  "Angebot": 78,
  "Gewonnen": 100,
  "Verloren": 0,
};
// Wo eine Phase im Brett steht. Fast immer die Abschlusschance — nur "Verloren"
// gehoert ans rechte Ende und nicht nach ganz links, obwohl die Chance dort 0 ist.
const stufenPlatz = (name) => (name === "Verloren" ? 101 : (STUFEN_QUOTE[name] ?? 50));
const wahrsch = (anzahl, i, name) => STUFEN_QUOTE[name] ?? Math.round(10 + (90 * i) / Math.max(1, anzahl - 1));

// Phasen, die in verschiedenen Bereichen anders heissen, aber dasselbe bedeuten.
// In der Gesamtsicht stehen sie in EINER Spalte unter dem gemeinsamen Namen.
// In den einzelnen Bereichen behaelt jede Phase ihren eigenen Namen.
const ERSTGESPRAECH_LABEL = "Readiness-Check gebucht / Erstes Gespräch";
const STUFEN_SYNONYM = {
  "Erstgespräch": { schluessel: "erstgespraech", label: ERSTGESPRAECH_LABEL },
  "Readiness-Check gebucht": { schluessel: "erstgespraech", label: ERSTGESPRAECH_LABEL },
};
const stufenGruppe = (name) => STUFEN_SYNONYM[name] || { schluessel: name, label: name };
const geldK = (n) => { const v = Number(n) || 0;
  if (v >= 10000) return Math.round(v / 1000) + "k €";
  if (v >= 1000) return (v / 1000).toFixed(1).replace(".0", "").replace(".", ",") + "k €";
  return Math.round(v) + " €"; };
const datum = (d) => (d ? new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
const zeit = (d) => (d ? new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

const SPARTEN = { webdesign: "Webdesign", performance: "Performance Marketing", ki: "KI" };

// Vier Unterlisten je Bereich — der Stand nach dem Cold Call.
const LEAD_LISTEN = {
  "offen": "Offene Leads",
  "absage": "Absagen",
  "nicht-erreicht": "Nicht erreicht",
  "keine-zeit": "Später nochmal",
};

// Ergebnis des Anrufs — steuert, in welche Liste der Lead wandert.
const ERGEBNISSE = {
  "nicht-erreicht": "Nicht erreicht",
  "keine-zeit": "Später nochmal",
  "gebucht": "Erstgespräch gebucht",
  "absage": "Nein",
};

// Die haeufigsten Absage-Gruende beim Cold Call. "Anderer Grund" blendet ein
// Freitextfeld ein, in das man den echten Grund schreibt.
const ABSAGE_GRUENDE = [
  "Kein Interesse",
  "Keine Zeit im Moment",
  "Sind wir schon dabei",
  "Kein Budget / zu teuer",
  "Machen wir intern selbst",
  "Anderer Grund",
];

// Listen auf der Kunden-Seite. "Lead" sind hier NICHT die Cold-Calling-Kontakte
// (die stehen unter Leads), sondern Leads, die schon im Vertrieb stehen — also
// einen offenen Deal haben (Erstgespraech, Angebot ...).
const KUNDEN_LISTEN = {
  lead: "Lead",
  alle: "Alle Kunden",
  einmal: "Einmal-Kunde",
  retainer: "Retainer-Kunde",
  verloren: "Verloren",
};
// Datum fuer <input type="date"> — bewusst LOKAL gerechnet. toISOString() waere UTC
// und wuerde abends/nachts einen Tag zurueckspringen (dann landen To-Dos auf gestern).
const heuteFeld = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const datumFeld = (wert) => {
  if (!wert) return "";
  const d = new Date(wert);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Wohin "Zurück zur Übersicht" fuehrt: dorthin, wo man hergekommen ist.
// Reihenfolge: ausdruecklicher ?von=-Parameter, sonst die vorherige Seite (Referer),
// sonst die Standardliste. Andere Akten werden ausgeschlossen, sonst springt man
// zwischen zwei Akten hin und her.
function herkunft(req, standard) {
  const pruefen = (pfad) => typeof pfad === "string"
    && pfad.startsWith("/crm")
    && !pfad.startsWith("/crm/firma")
    && !/[<>"']/.test(pfad);
  const von = (req.query || {}).von;
  if (pruefen(von)) return von;
  try {
    const ref = new URL(req.get("referer") || "", `http://${req.get("host")}`);
    const pfad = ref.pathname + ref.search;
    if (ref.host === req.get("host") && pruefen(pfad)) return pfad;
  } catch { /* kein oder kaputter Referer -> Standard */ }
  return standard;
}
// Haengt die Herkunft an eine Adresse, damit sie ueber Formulare erhalten bleibt.
const mitHerkunft = (pfad, von) => (von ? `${pfad}${pfad.includes("?") ? "&" : "?"}von=${encodeURIComponent(von)}` : pfad);

// Woher der Kontakt kam.
const QUELLEN = ["Meta Ads", "Cold Calling", "Netzwerk", "Empfehlung", "Social Media"];

// Kleines Bild der Ansprechperson — man sieht auf einen Blick, ob man einen Mann
// oder eine Frau am Telefon hat. Reines SVG, kein externes Bild noetig.
function avatarBild(geschlecht) {
  const haut = "#EFEDE8";
  if (geschlecht === "w") {
    // Frau: langes Haar — zwei Straehnen fallen links und rechts am Gesicht vorbei
    // bis auf die Schultern, dazu Deckhaar mit Pony. Gesicht bleibt frei.
    return `<span class="akte-avatar" aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48">
      <path d="M8 48c0-6.6 7.2-10.6 16-10.6S40 41.4 40 48H8z" fill="#B2AFA8"/>
      <path d="M24 9c7.1 0 12.8 5.4 12.8 12.8v12.4c0 2.4-1.2 3.8-2.8 3.8s-2.8-1.4-2.8-3.8V22H16.8v12.2c0 2.4-1.2 3.8-2.8 3.8s-2.8-1.4-2.8-3.8V21.8C11.2 14.4 16.9 9 24 9z" fill="#6E6B64"/>
      <path d="M21 28h6v10h-6z" fill="${haut}"/>
      <circle cx="24" cy="24" r="7.8" fill="${haut}"/></svg></span>`;
  }
  if (geschlecht === "m") {
    // Mann: kurzer Haarschnitt — Deckhaar sitzt eng auf dem Kopf, keine Straehnen.
    return `<span class="akte-avatar" aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48">
      <path d="M8 48c0-6.6 7.2-10.6 16-10.6S40 41.4 40 48H8z" fill="#726F68"/>
      <path d="M21 28h6v10h-6z" fill="${haut}"/>
      <circle cx="24" cy="24" r="8" fill="${haut}"/>
      <path d="M15.6 24c0-5.6 3.8-9.6 8.4-9.6s8.4 4 8.4 9.6c-.4-2.9-1.2-4.5-1.9-5.4-4 2.1-9.7 1.9-13.3-.3-.7 1-1.3 2.8-1.6 5.7z" fill="#3A3937"/></svg></span>`;
  }
  // Ohne Angabe: neutrale Silhouette.
  return `<span class="akte-avatar" aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48">
    <circle cx="24" cy="22" r="8.6" fill="#D5D3CD"/>
    <path d="M8 48c0-6.6 7.2-10.6 16-10.6S40 41.4 40 48H8z" fill="#B7B4AE"/></svg></span>`;
}
// Was wir fuer den Kunden leisten — haengt vom Bereich ab, in dem er bei uns liegt.
const LEISTUNGEN_JE_SPARTE = {
  webdesign: ["Monatliche Betreuung", "Hosting", "Anpassungen auf Wunsch", "Support"],
  performance: ["Monatliche Betreuung", "Kampagnen-Betreuung", "Creatives & Anzeigen", "Reporting", "Support"],
  ki: ["Monatliche Betreuung", "Support", "Reporting", "Automatisierungen", "Modell-Pflege", "Schulung"],
};
// Alle Leistungen zusammen — fuer die Pruefung beim Speichern.
const LEISTUNGEN = [...new Set(Object.values(LEISTUNGEN_JE_SPARTE).flat())];
// Position der Ansprechperson beim Kunden.
const ANSPRECH_ROLLEN = ["Geschäftsführung", "Inhaber", "Praxisleitung", "Marketing", "Assistenz", "Sonstiges"];
// Wo das Projekt gerade steht.
const PROJEKT_STAende = {
  onboarding: "Onboarding",
  umsetzung: "In Umsetzung",
  live: "Live · fertig",
};
// Wie weit die Rechnung bezahlt ist.
const RECHNUNG_STAende = {
  offen: "Noch nicht bezahlt",
  "50": "50 % angezahlt",
  "100": "Voll bezahlt",
};

// Gesamtwert eines Deals: einmaliges Setup plus die monatliche Gebuehr ueber die
// vereinbarte Laufzeit. Ohne Laufzeit rechnen wir mit einem Jahr — 1.000 EUR Setup
// und 500 EUR im Monat ergeben also 7.000 EUR. Fehlen beide Angaben, zaehlt der
// Deal-Wert. Der Erfolgsbonus ist Freitext ("200 EUR pro Lead") und daher nicht
// berechenbar — er wird nur als Hinweis angezeigt.
const MONATE_JE_LAUFZEIT = {
  "1 Monat": 1, "3 Monate": 3, "6 Monate": 6, "12 Monate": 12,
  "Unbegrenzt · monatlich kündbar": 12, "Einmaliges Projekt": 0,
};
function gesamtWert(d) {
  const setup = Number(d.preis_setup) || 0;
  const monatlich = Number(d.preis_monatlich) || 0;
  if (!setup && !monatlich) return Number(d.wert) || 0;
  const monate = MONATE_JE_LAUFZEIT[d.vertrag_laufzeit] ?? 12;
  return setup + monatlich * monate;
}

// Wie lange die Zusammenarbeit laeuft.
const LAUFZEITEN = ["1 Monat", "3 Monate", "6 Monate", "12 Monate", "Unbegrenzt · monatlich kündbar", "Einmaliges Projekt"];

// Dringlichkeit eines Leads/Kunden — vier Stufen, wie bei den To-Dos.
// Steht als farbiger Streifen samt Kuerzel auf jeder Pipeline-Karte, damit man
// beim Blick aufs Brett sofort sieht, was zuerst drankommt.
// rang: kleiner = dringender (fuers Sortieren), kurz: Aufdruck auf der Karte.
const DRINGLICHKEIT = {
  "Sehr dringend": { rang: 1, kurz: "Sehr dringend", farbe: "rot" },
  "Dringend":      { rang: 2, kurz: "Dringend",      farbe: "bernstein" },
  "Bald":          { rang: 3, kurz: "Bald",          farbe: "blau" },
  "Kann warten":   { rang: 4, kurz: "Kann warten",   farbe: "still" },
};
// Phasen, in denen ein Gespräch ansteht — dort zeigt die Karte das Gesprächsdatum
// statt der Frist. Beide Gespräche lesen dasselbe Feld (firmen.erstgespraech_am):
// steht der Deal im zweiten Gespräch, traegt man dort einfach den neuen Termin ein.
const GESPRAECHS_PHASE = (name) => {
  const n = name || "";
  if (/^Zweites/i.test(n)) return "Zweites Gespräch am";
  if (/^(Erstgespräch|Readiness)/i.test(n)) return "Erstgespräch am";
  return null;
};
// Vorschlaege fuer "das haben wir umgesetzt" — frei ergaenzbar.
const UMGESETZT_VORSCHLAEGE = [
  "Webdesign", "KI Corporate LLM", "Telefonagent", "Operating System",
  "Mitarbeitergewinnung", "Lead-Generierung",
];
// Worueber wir mit dem Kunden in Kontakt sind.
const KONTAKT_KANAELE = ["E-Mail", "WhatsApp", "Telefon"];

// Score-Bereiche — nur bei "Lead" sichtbar, ersetzt dort den Temperatur-Filter.
const SCORE_BEREICHE = {
  "1-3": { titel: "Score 1 – 3", von: 1, bis: 3 },
  "4-5": { titel: "Score 4 – 5", von: 4, bis: 5 },
  "6-8": { titel: "Score 6 – 8", von: 6, bis: 8 },
  "9-10": { titel: "Score 9 – 10", von: 9, bis: 10 },
};

// Branchen als grosse Ueberbegriffe — jeder Lead haengt an genau einem.
const BRANCHEN = {
  gesundheit: "Gesundheit & Medizin",
  handwerk: "Handwerk & Bau",
  immobilien: "Immobilien",
  gastro: "Gastronomie & Hotellerie",
  handel: "Handel & Einzelhandel",
  dienstleistung: "Dienstleistung & Beratung",
  recht: "Recht & Finanzen",
  auto: "Auto & Mobilität",
  beauty: "Beauty & Wellness",
  sport: "Sport & Fitness",
  bildung: "Bildung & Coaching",
  industrie: "Industrie & Produktion",
  logistik: "Transport & Logistik",
  it: "IT & Technik",
  medien: "Medien & Kreativ",
  verein: "Vereine & Organisationen",
};

// Demo-Anrufstatistik je Branche: [Erstgespräche, Absagen, Später nochmal, Nicht erreicht].
// "Calls" ist die Summe daraus. Wird ersetzt, sobald die Anrufe in der Datenbank landen.
const DEMO_ANRUFE = {
  gesundheit: { gesamt: [6, 22, 14, 54], heute: [1, 1, 0, 3] },
  handwerk: { gesamt: [4, 18, 11, 47], heute: [0, 1, 1, 3] },
  immobilien: { gesamt: [3, 12, 8, 31], heute: [1, 0, 0, 2] },
  gastro: { gesamt: [2, 15, 9, 38], heute: [0, 1, 0, 2] },
  handel: { gesamt: [3, 14, 7, 33], heute: [0, 0, 0, 1] },
  dienstleistung: { gesamt: [2, 9, 6, 24], heute: [0, 0, 0, 0] },
  recht: { gesamt: [1, 8, 5, 21], heute: [0, 0, 0, 0] },
  auto: { gesamt: [2, 10, 6, 26], heute: [0, 0, 0, 0] },
  beauty: { gesamt: [1, 7, 4, 18], heute: [0, 0, 0, 0] },
  sport: { gesamt: [2, 6, 5, 17], heute: [0, 0, 0, 0] },
  bildung: { gesamt: [1, 5, 3, 14], heute: [0, 0, 0, 0] },
  industrie: { gesamt: [1, 6, 4, 16], heute: [0, 0, 0, 0] },
  logistik: { gesamt: [1, 4, 3, 12], heute: [0, 0, 0, 0] },
  it: { gesamt: [1, 3, 2, 9], heute: [0, 0, 0, 0] },
  medien: { gesamt: [0, 3, 2, 8], heute: [0, 0, 0, 0] },
  verein: { gesamt: [0, 2, 1, 6], heute: [0, 0, 0, 0] },
};
// Zeitraum, ueber den die Gesamtzahlen laufen — Grundlage fuer den Tagesdurchschnitt.
const ARBEITSTAGE = 45; // 9 Wochen x 5 Tage

// ---------- Lead-Liste aus einem Link holen (Google Sheets / CSV) ----------

// Google-Sheets-Links auf die CSV-Ausgabe umbiegen. Alles andere bleibt, wie es ist
// (z.B. direkte .csv-Links). Ohne Freigabe "Jeder mit dem Link" liefert Google HTML
// statt CSV — das faengt tabelleHolen() ab und meldet es verstaendlich.
function csvLink(link) {
  const u = String(link).trim();
  const veroeffentlicht = u.match(/\/spreadsheets\/d\/e\/([^/]+)/);
  if (veroeffentlicht) return `https://docs.google.com/spreadsheets/d/e/${veroeffentlicht[1]}/pub?output=csv`;
  const normal = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (normal) {
    const gid = (u.match(/[#&?]gid=(\d+)/) || [])[1] || "0";
    return `https://docs.google.com/spreadsheets/d/${normal[1]}/export?format=csv&gid=${gid}`;
  }
  return u;
}

// CSV/TSV in Zeilen zerlegen — mit Anfuehrungszeichen, damit Kommas im Firmennamen
// ("Muster GmbH, Filiale Nord") nicht die Spalten zerreissen.
function csvZerlegen(text) {
  const trenner = text.includes("\t") && !text.includes(",") ? "\t" : ",";
  const zeilen = []; let feld = "", zeile = [], inZitat = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inZitat) {
      if (c === '"') { if (text[i + 1] === '"') { feld += '"'; i++; } else inZitat = false; }
      else feld += c;
    } else if (c === '"') inZitat = true;
    else if (c === trenner) { zeile.push(feld); feld = ""; }
    else if (c === "\n") { zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ""; }
    else if (c !== "\r") feld += c;
  }
  zeile.push(feld); zeilen.push(zeile);
  return zeilen.map((z) => z.map((f) => f.trim())).filter((z) => z.some(Boolean));
}

// Spalten anhand der Kopfzeile zuordnen — so ist die Reihenfolge in der Tabelle egal.
const SPALTEN_NAMEN = {
  name: ["firma", "firmenname", "name", "unternehmen", "company", "praxis", "betrieb"],
  ort: ["ort", "ortschaft", "stadt", "city", "standort"],
  branche: ["berufsbezeichnung", "beruf", "bezeichnung", "taetigkeit", "tätigkeit", "kategorie", "branche", "typ"],
  chef: ["geschaeftsfuehrer", "geschäftsführer", "inhaber", "ansprechpartner", "kontakt", "chef", "gf"],
  telefon: ["telefon", "telefonnummer", "tel", "phone", "nummer", "rufnummer"],
  website: ["website", "webseite", "web", "url", "homepage", "internet", "seite"],
};
function spaltenZuordnen(kopf) {
  const zu = {};
  kopf.forEach((titel, i) => {
    const t = titel.toLowerCase().replace(/[^a-zäöüß]/g, "");
    if (!t) return;
    for (const [feld, worte] of Object.entries(SPALTEN_NAMEN)) {
      if (zu[feld] === undefined && worte.some((w) => {
        const wort = w.replace(/[^a-zäöüß]/g, "");
        return t === wort || t.startsWith(wort);
      })) { zu[feld] = i; break; }
    }
  });
  // Mindestens drei erkannte Spalten — sonst ist es keine Kopfzeile, sondern schon
  // ein Lead (z.B. "Praxis Nord | München | ..." wuerde sonst verschluckt).
  return zu.name !== undefined && Object.keys(zu).length >= 3 ? zu : null;
}

// Tabelle laden. Nur http(s), keine internen Adressen (Schutz vor Zugriffen aufs eigene Netz).
async function tabelleHolen(link) {
  let url;
  try { url = new URL(csvLink(link)); } catch { throw new Error("Das ist keine gültige Adresse."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Nur http- und https-Links sind erlaubt.");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(url.hostname)) {
    throw new Error("Interne Adressen sind nicht erlaubt.");
  }
  const antwort = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!antwort.ok) {
    if (url.hostname.includes("google") && [401, 403, 404].includes(antwort.status)) {
      throw new Error("Google lässt uns nicht an die Tabelle. Prüf, ob der Link stimmt und die Freigabe auf 'Jeder mit dem Link' steht.");
    }
    throw new Error(`Die Tabelle konnte nicht geladen werden (Fehler ${antwort.status}).`);
  }
  const text = await antwort.text();
  if (/^\s*</.test(text) || /<html/i.test(text.slice(0, 400))) {
    throw new Error("Die Tabelle ist nicht öffentlich freigegeben. Stell sie in Google Sheets auf Freigabe für jeden mit dem Link — oder füg die Zeilen direkt ein.");
  }
  const zeilen = csvZerlegen(text);
  if (!zeilen.length) throw new Error("Die Tabelle ist leer.");
  const zu = spaltenZuordnen(zeilen[0]);
  const hol = (z, i) => (i === undefined ? "" : (z[i] || "").trim());
  if (zu) {
    return zeilen.slice(1).map((z) => ({
      name: hol(z, zu.name), ort: hol(z, zu.ort), branche: hol(z, zu.branche),
      chef: hol(z, zu.chef), telefon: hol(z, zu.telefon), website: hol(z, zu.website),
    })).filter((l) => l.name);
  }
  // Keine erkennbare Kopfzeile -> feste Reihenfolge annehmen.
  return zeilen.map((z) => ({
    name: hol(z, 0), ort: hol(z, 1), branche: hol(z, 2),
    chef: hol(z, 3), telefon: hol(z, 4), website: hol(z, 5),
  })).filter((l) => l.name);
}

// Probe-Leads fuer "Offene Leads", bis die echte Cold-Calling-Liste importiert ist.
// Sobald echte Leads mit dem Bereichs-Tag da sind, werden diese hier nicht mehr gezeigt.
const PROBE_LEADS = {
  webdesign: [
    { name: "Physiotherapie Sonnenhof", bg: "gesundheit", chef: "Andrea Sonnleitner", ort: "München", branche: "Physiotherapie", telefon: "+49 89 4412088", website: "", score: 8 },
    { name: "Zahnarztpraxis Dr. Lehmann", bg: "gesundheit", chef: "Dr. Martin Lehmann", ort: "München", branche: "Zahnarzt", telefon: "+49 89 2731554", website: "", score: 7 },
    { name: "Bäckerei Hofmann", bg: "gastro", chef: "Josef Hofmann", ort: "Dachau", branche: "Bäckerei", telefon: "+49 8131 66210", website: "https://baeckerei-hofmann.de", score: 4 },
    { name: "Elektro Brandl GmbH", bg: "handwerk", chef: "Stefan Brandl", ort: "Freising", branche: "Elektrohandwerk", telefon: "+49 8161 90455", website: "", score: 9 },
    { name: "Kanzlei Reiter & Partner", bg: "recht", chef: "Dr. Klaus Reiter", ort: "München", branche: "Rechtsanwälte", telefon: "+49 89 550312", website: "https://reiter-partner.de", score: 5 },
    { name: "Autowerkstatt Süd", bg: "auto", chef: "Murat Yilmaz", ort: "München", branche: "Kfz-Werkstatt", telefon: "+49 89 7761240", website: "", score: 6 },
    { name: "Blumen Wagner", bg: "handel", chef: "Sabine Wagner", ort: "Erding", branche: "Floristik", telefon: "+49 8122 43870", website: "", score: 3 },
    { name: "Fahrschule Aktiv", bg: "bildung", chef: "Thomas Bergmaier", ort: "München", branche: "Fahrschule", telefon: "+49 89 3082199", website: "https://fahrschule-aktiv.de", score: 5 },
    { name: "Tierarztpraxis Waldperlach", bg: "gesundheit", chef: "Dr. Julia Ostermann", ort: "München", branche: "Tierarzt", telefon: "+49 89 6704433", website: "", score: 7 },
    { name: "Malerbetrieb Kirchner", bg: "handwerk", chef: "Peter Kirchner", ort: "Fürstenfeldbruck", branche: "Malerhandwerk", telefon: "+49 8141 227690", website: "", score: 6 },
  ],
  performance: [
    { name: "Fitnessstudio Bodyworks", bg: "sport", chef: "Marco Reetz", ort: "München", branche: "Fitness", telefon: "+49 89 4471200", website: "https://bodyworks-muc.de", score: 8 },
    { name: "Restaurant Bella Vista", bg: "gastro", chef: "Giulia Conti", ort: "München", branche: "Gastronomie", telefon: "+49 89 227744", website: "https://bellavista-muc.de", score: 6 },
    { name: "Modehaus Sommer", bg: "handel", chef: "Katrin Sommer", ort: "Augsburg", branche: "Einzelhandel", telefon: "+49 821 558812", website: "https://modehaus-sommer.de", score: 7 },
    { name: "Café Kranz", bg: "gastro", chef: "Michael Kranz", ort: "München", branche: "Gastronomie", telefon: "+49 89 339021", website: "", score: 4 },
    { name: "Sanitätshaus Bergmann", bg: "gesundheit", chef: "Uwe Bergmann", ort: "Rosenheim", branche: "Gesundheit", telefon: "+49 8031 440155", website: "https://sanitaets-bergmann.de", score: 5 },
    { name: "Reisebüro Weitblick", bg: "dienstleistung", chef: "Nadine Frey", ort: "München", branche: "Reise", telefon: "+49 89 189044", website: "https://reise-weitblick.de", score: 6 },
    { name: "Kosmetikstudio Aurea", bg: "beauty", chef: "Elena Aurea", ort: "Starnberg", branche: "Beauty", telefon: "+49 8151 776320", website: "", score: 8 },
    { name: "Möbelhaus Lindner", bg: "handel", chef: "Franz Lindner", ort: "Ingolstadt", branche: "Einzelhandel", telefon: "+49 841 903377", website: "https://moebel-lindner.de", score: 7 },
    { name: "Yoga Loft München", bg: "sport", chef: "Lisa Hartmann", ort: "München", branche: "Sport", telefon: "+49 89 5504488", website: "https://yogaloft-muc.de", score: 5 },
    { name: "Weinhandlung Vinum", bg: "handel", chef: "Robert Vogl", ort: "München", branche: "Einzelhandel", telefon: "+49 89 662130", website: "", score: 4 },
  ],
  ki: [
    { name: "Autohaus Wagner", bg: "auto", chef: "Christian Wagner", ort: "München", branche: "Automobil", telefon: "+49 89 601234", website: "https://autohaus-wagner.de", score: 8 },
    { name: "Immobilien König", bg: "immobilien", chef: "Petra König", ort: "München", branche: "Immobilien", telefon: "+49 89 778890", website: "https://koenig-immo.de", score: 9 },
    { name: "Logistik Nord GmbH", bg: "logistik", chef: "Dirk Ahlers", ort: "Nürnberg", branche: "Logistik", telefon: "+49 911 903355", website: "https://logistik-nord.de", score: 7 },
    { name: "Steuerkanzlei Berger", bg: "recht", chef: "Michael Berger", ort: "München", branche: "Steuerberatung", telefon: "+49 89 442017", website: "https://kanzlei-berger.de", score: 6 },
    { name: "Versicherungsbüro Hartl", bg: "recht", chef: "Josef Hartl", ort: "Landshut", branche: "Versicherung", telefon: "+49 871 330244", website: "", score: 5 },
    { name: "Maschinenbau Ritter KG", bg: "industrie", chef: "Anton Ritter", ort: "Augsburg", branche: "Industrie", telefon: "+49 821 771900", website: "https://ritter-maschinenbau.de", score: 8 },
    { name: "Pflegedienst Lebenswert", bg: "gesundheit", chef: "Silke Neumann", ort: "München", branche: "Pflege", telefon: "+49 89 3391870", website: "", score: 7 },
    { name: "Hotel Alpenblick", bg: "gastro", chef: "Hans Steiner", ort: "Garmisch-Partenkirchen", branche: "Hotellerie", telefon: "+49 8821 550140", website: "https://hotel-alpenblick.de", score: 6 },
    { name: "Personalberatung Kestner", bg: "dienstleistung", chef: "Barbara Kestner", ort: "München", branche: "Personal", telefon: "+49 89 208866", website: "https://kestner-personal.de", score: 5 },
    { name: "Großhandel Bayer & Sohn", bg: "handel", chef: "Erwin Bayer", ort: "Regensburg", branche: "Großhandel", telefon: "+49 941 660712", website: "", score: 4 },
  ],
};
const S = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  logo: S('<path d="M4 4h16M4 12h10M4 20h13"/>'),
  start: S('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  pipeline: S('<rect x="3" y="3" width="6" height="18" rx="2"/><rect x="10.5" y="3" width="6" height="12" rx="2"/><rect x="18" y="3" width="3" height="7" rx="1.5"/>'),
  kunden: S('<path d="M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.5"/><path d="M22 20v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  leads: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'),
  team: S('<path d="M12 3v4M6.5 7 9 9.5M17.5 7 15 9.5"/><circle cx="12" cy="12" r="2.5"/><path d="M4 21v-1a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1"/>'),
  euro: S('<path d="M15 6.5A6 6 0 1 0 15 17.5"/><path d="M4 10.5h9M4 13.5h9"/>'),
  trend: S('<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>'),
  trendAb: S('<path d="M22 17l-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>'),
  uhr: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  telefon: S('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  suche: S('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  check: S('<path d="M20 6 9 17l-5-5"/>'),
  x: S('<path d="M18 6 6 18M6 6l12 12"/>'),
  pfeilLinks: S('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
  ordner: S('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.9a2 2 0 0 1 1.6.8l1 1.4a2 2 0 0 0 1.6.8h4.9A2.5 2.5 0 0 1 21 10.5v6A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9z"/>'),
  datei: S('<path d="M14 3v4.5a1.5 1.5 0 0 0 1.5 1.5H20"/><path d="M19 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l6 6v10a2 2 0 0 1-2 2z"/>'),
  notiz: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
  kalender: S('<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>'),
  flamme: S('<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-2 2-3 3-4 3s-1-2-1-4C7 7 5 10 5 15a7 7 0 0 0 7 7z"/>'),
  warnung: S('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'),
  ziel: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
  griff: S('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
  person: S('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
  abmelden: S('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  zurueck: S('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  webdesign: S('<rect x="2.5" y="4" width="19" height="14" rx="2"/><path d="M2.5 8.5h19M6 21h12"/>'),
  megafon: S('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M16 8.5a4 4 0 0 1 0 7M19 6a8 8 0 0 1 0 12"/>'),
  chip: S('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2v4M14.5 2v4M9.5 18v4M14.5 18v4M2 9.5h4M2 14.5h4M18 9.5h4M18 14.5h4"/>'),
  waage: S('<path d="M12 3v18M7 7h10M5.5 7 3 13h5zM18.5 7 16 13h5z"/><path d="M3 13a2.5 2.5 0 0 0 5 0M16 13a2.5 2.5 0 0 0 5 0"/>'),
  schichten: S('<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>'),
  sanduhr: S('<path d="M6 2h12M6 22h12M6 2c0 4 6 6 6 10s-6 6-6 10M18 2c0 4-6 6-6 10s6 6 6 10"/>'),
  prozent: S('<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>'),
};

const RAIL = [
  { id: "start", href: "/crm", icon: "start", titel: "Dashboard" },
  { id: "leads", href: "/crm/leads", icon: "leads", titel: "Leads" },
  { id: "kunden", href: "/crm/kunden", icon: "kunden", titel: "Kunden" },
  { gruppe: "Vertrieb" },
  { id: "pipeline", href: "/crm/pipeline?sparte=webdesign", icon: "webdesign", titel: "Webdesign" },
  { id: "pipeline-pm", href: "/crm/pipeline?sparte=performance", icon: "megafon", titel: "Performance Marketing" },
  { id: "pipeline-ki", href: "/crm/pipeline?sparte=ki", icon: "chip", titel: "KI-Projekte" },
  { gruppe: "Auswertung" },
  { id: "team", href: "/crm/team", icon: "team", titel: "Team-Leistung", nurAdmin: true },
];

// Das CRM rendert durch dieselbe Huelle wie das restliche OS (lib/schale.js).
// Es hat keine eigene Rail und keinen eigenen Kopf mehr — man bleibt im OS,
// nur der Inhaltsbereich wechselt. Die CRM-Bereiche haengen als Unterpunkte
// am Modul "Kunden & CRM".
const SCHALE_ID = { start: "crm-start", leads: "crm-leads", kunden: "crm-kunden", team: "crm-team", todos: "crm-todos" };

function rahmen(user, aktiv, titel, unterzeile, reiter, inhalt, sparte, hinweise = []) {
  const id = aktiv === "pipeline"
    ? ({ webdesign: "crm-webdesign", performance: "crm-performance", ki: "crm-ki" }[sparte] || "crm-webdesign")
    : SCHALE_ID[aktiv] || "crm";
  return schale({
    titel, unterzeile, reiter, inhalt, nutzer: user, aktiv: id, hinweise,
    suche: "CRM durchsuchen — Kunden, Leads …",
  }) + `
<script src="/lib/gsap.min.js"></script>
<script>
if(window.gsap){
  gsap.from(".kachel",{y:10,opacity:0,duration:.35,stagger:.04,ease:"power2.out"});
  gsap.from(".karte,.tabelle-huelle,.spalte",{y:8,opacity:0,duration:.3,stagger:.03,delay:.05,ease:"power2.out"});
  document.querySelectorAll("[data-zahl]").forEach(el=>{const z=parseFloat(el.dataset.zahl)||0,o={v:0};
    gsap.to(o,{v:z,duration:.8,ease:"power2.out",onUpdate:()=>{el.textContent=el.dataset.geld?Math.round(o.v).toLocaleString("de-DE")+" \u20ac":(el.dataset.suffix?Math.round(o.v)+el.dataset.suffix:Math.round(o.v));}});});
  gsap.utils.toArray(".trichter-balken,.balken,.fortschritt>span").forEach(el=>{
    const b=el.style.width||el.style.height; if(!b)return;
    if(el.classList.contains("balken")){gsap.from(el,{height:0,duration:.7,ease:"power2.out",delay:.1});}
    else{gsap.from(el,{width:0,duration:.7,ease:"power2.out",delay:.1});}});
}
</script></body></html>`;
}

function rahmenPipeline(u, sparte, art, reiter, inhalt) {
  return rahmen(u, "pipeline", sparte ? SPARTEN[sparte] : "Alle Bereiche",
    "Vertriebspipeline \u00b7 " + (art === "projekt" ? "Projekte" : "Verkauf"), reiter, inhalt, sparte);
}

// personen (optional): zusaetzliche Auswahl "wessen Deals sehe ich" —
// steht mit Abstand rechts neben den Reitern.
function reiterLeiste(seiten, aktiv, sparte, basis, personen = null) {
  const r = seiten.map((s) => `<a href="${s.href}" class="${s.id === aktiv ? "aktiv" : ""}">${e(s.label)}</a>`).join("");
  const pers = personen ? `<nav class="personen">${
    personen.liste.map((pn) => `<a href="${pn.href}" class="${pn.id === personen.aktiv ? "aktiv" : ""}">${e(pn.label)}</a>`).join("")
  }</nav>` : "";
  const seg = [["", "Gesamt"], ...Object.entries(SPARTEN)]
    .map(([k, v]) => `<a href="${basis}${basis.includes("?") ? "&" : "?"}sparte=${k}" class="${(sparte || "") === k ? "aktiv" : ""}">${e(v)}</a>`).join("");
  return `<div class="reiterleiste"><nav class="reiter">${r}</nav>${pers}<nav class="segmente">${seg}</nav></div>`;
}

function anmeldeSeite(fehler) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anmelden · Flowstate CRM</title><link rel="stylesheet" href="/crm.css"></head><body class="login-seite">
<div class="login-karte">
  <div class="login-marke"><div class="login-logo">${ICON.logo}</div>
    <div><div class="marke">flowstate<em>CRM</em></div><div class="marke-sub">Sehorz &amp; vom Hofe GbR</div></div></div>
  <p class="caption" style="margin-top:16px;line-height:1.5">Vertrieb, Kunden und Projekte an einem Ort.
    Melde dich mit deinem persönlichen Zugang an — du siehst nur, was dir gehört.</p>
  <form method="post" action="/crm/anmelden">
    <div class="feld"><label>E-Mail</label><input type="email" name="email" autofocus required placeholder="vorname.name@flowstate-ai.net"></div>
    <div class="feld" style="margin-bottom:4px"><label>Passwort</label><input type="password" name="passwort" required></div>
    <button type="submit" style="width:100%;justify-content:center">Anmelden</button>
  </form>
  ${fehler ? `<div class="hinweis warn" style="margin-top:16px">${ICON.warnung}<div>E-Mail oder Passwort stimmt nicht.</div></div>` : ""}
  <p class="caption" style="margin-top:22px;padding-top:16px;border-top:1px solid var(--border);text-align:center">
    Passwort vergessen? Sprich Lukas oder Jannik an.</p>
</div></body></html>`;
}

const kachel = (label, zahl, icon, farbe, fuss, istGeld, suffix, klasse) => `
  <div class="kachel${klasse ? " " + klasse : ""}"><div class="kachel-kopf"><span class="kachel-label">${label}</span>
    <span class="kachel-icon ${farbe || ""}">${icon}</span></div>
    <div class="kachel-zahl" data-zahl="${zahl}"${istGeld ? ' data-geld="1"' : ""}${suffix ? ` data-suffix="${suffix}"` : ""}>0</div>
    ${fuss ? `<div class="kachel-fuss">${fuss}</div>` : ""}</div>`;

module.exports = function (app) {
  app.get("/crm/anmelden", (req, res) => res.send(anmeldeSeite(req.query.fehler)));
  app.post("/crm/anmelden", async (req, res) => {
    try { const u = await crm.anmelden(req.body.email, req.body.passwort);
      if (!u) return res.redirect("/crm/anmelden?fehler=1");
      req.session.crm = u; res.redirect("/crm");
    } catch { res.redirect("/crm/anmelden?fehler=1"); }
  });
  // Abmelden gilt fuers ganze OS — sonst bliebe man im OS drin, aber aus dem CRM raus.
  app.get("/crm/abmelden", (req, res) => { req.session.destroy(() => res.redirect("/login")); });
  app.use("/crm", (req, res, next) => {
    if (req.path.startsWith("/anmelden")) return next();
    if (!req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm; next();
  });

  // ================= ZEITERFASSUNG (Stoppuhr im Header) =================
  app.get("/crm/zeit/status", async (req, res, next) => {
    try { res.json(await crm.zeitStatus(req.nutzer)); } catch (err) { next(err); }
  });
  app.get("/crm/zeit/resuemee", async (req, res, next) => {
    try { res.json(await crm.zeitResuemee(req.nutzer)); } catch (err) { next(err); }
  });
  app.post("/crm/zeit/start", async (req, res, next) => {
    try { res.json(await crm.zeitStart(req.nutzer)); } catch (err) { next(err); }
  });
  app.post("/crm/zeit/pause", async (req, res, next) => {
    try { res.json(await crm.zeitPause(req.nutzer)); } catch (err) { next(err); }
  });
  app.post("/crm/zeit/ende", async (req, res, next) => {
    try { res.json(await crm.zeitEnde(req.nutzer)); } catch (err) { next(err); }
  });
  app.post("/crm/zeit/herzschlag", async (req, res, next) => {
    try { res.json(await crm.zeitHerzschlag(req.nutzer)); } catch (err) { next(err); }
  });

  // ================= DASHBOARD =================
  app.get("/crm", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const sparte = SPARTEN[req.query.sparte] ? req.query.sparte : "";
      let tab = ["uebersicht", "pipeline"].includes(req.query.tab) ? req.query.tab : "uebersicht";
      // Pipeline-Volumen gibt es nur in der Gesamtsicht — bei einer einzelnen Sparte
      // steckt dieselbe Info schon in deren Uebersicht, also zurueck auf "uebersicht".
      if (tab === "pipeline" && sparte) tab = "uebersicht";
      const zeitraum = ["30", "3", "6", "12"].includes(req.query.zr) ? req.query.zr : "6";
      const [z, alle, team, todosHeute] = await Promise.all([
        crm.kennzahlen(u), crm.firmenListe(u, { limit: 300 }),
        u.rolle === "admin" ? crm.teamZahlen(u, sparte) : Promise.resolve([]),
        crm.todosHeute(u),
      ]);
      const stufenAlle = await crm.stufen(u);
      const spartenListe = sparte ? [sparte] : Object.keys(SPARTEN);
      const boards = await Promise.all(spartenListe.map((s) => crm.dealsNachStufen(u, s)));

      // Kennzahlen berechnen
      let offen = 0, wert = 0;
      const alleDeals = [];
      boards.forEach((b) => b.forEach((st) => st.deals.forEach((d) => { offen++; wert += Number(d.wert || 0); alleDeals.push(d); })));
      const ziel = 30000, fortschritt = Math.min(100, Math.round((z.umsatz_monat / ziel) * 100));
      const monat = new Date().toLocaleDateString("de-DE", { month: "long" });
      const heisse = alle.filter((f) => f.status === "lead" && (f.temperatur === "heiss" || Number(f.score) >= 9));
      const faellig = alle.filter((f) => f.wiedervorlage && new Date(f.wiedervorlage) <= new Date());

      // Umsatzverlauf der letzten 6 Monate aus gewonnenen Deals
      const gew = await crm.gewonneneDeals(u, sparte, 12);
      // Gescheiterte Deals (optional je Sparte) — Anzahl + Wert des laufenden Monats.
      const verl = await crm.verloreneDeals(u, sparte);
      const aktMonatKey = (() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); })();
      const verlorenMonatListe = verl.filter((v) => v.geschlossen_am && new Date(v.geschlossen_am).toISOString().slice(0, 7) === aktMonatKey);
      const gescheitertAnzahl = verlorenMonatListe.length;
      const gescheitertWert = verlorenMonatListe.reduce((a, v) => a + Number(v.wert || 0), 0);
      // Fuer den Vormonats-Vergleich immer ueber ALLE Sparten rechnen (wie z.umsatz_monat oben),
      // unabhaengig vom gerade gewaehlten Sparten-Tab.
      const gewGesamt = sparte ? await crm.gewonneneDeals(u) : gew;
      const monatsUmsatz = (monateZurueck) => {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - monateZurueck);
        const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        return gewGesamt.filter((g) => g.geschlossen_am && new Date(g.geschlossen_am).toISOString().slice(0, 7) === key)
          .reduce((a, g) => a + Number(g.wert || 0), 0);
      };
      const vormonatName = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
        return d.toLocaleDateString("de-DE", { month: "long" }); })();
      const vormonatUmsatz = monatsUmsatz(1);
      // Vergleich Vormonat (Juni) gegen den aktuellen, noch laufenden Monat (Juli) —
      // bewusst nicht gegen den Monat davor (Mai).
      const vormonatWachstum = z.umsatz_monat > 0
        ? Math.round(((vormonatUmsatz - z.umsatz_monat) / z.umsatz_monat) * 100)
        : (vormonatUmsatz > 0 ? 100 : 0);
      // Hero-Kachel "Umsatz <Monat>": bei einer Sparte nur deren gewonnener Umsatz
      // (aus gew, das schon sparte-gefiltert ist), bei Gesamt der globale Wert.
      const monatUmsatzAus = (liste, monateZurueck) => {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - monateZurueck);
        const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        return liste.filter((g) => g.geschlossen_am && new Date(g.geschlossen_am).toISOString().slice(0, 7) === key)
          .reduce((a, g) => a + Number(g.wert || 0), 0);
      };
      const heroUmsatz = sparte ? monatUmsatzAus(gew, 0) : z.umsatz_monat;
      const heroVormonat = sparte ? monatUmsatzAus(gew, 1) : vormonatUmsatz;
      const heroFortschritt = Math.min(100, Math.round((heroUmsatz / ziel) * 100));
      const monate = zeitraum === "30" ? 1 : Number(zeitraum);
      const verlauf = [];
      for (let i = monate - 1; i >= 0; i--) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
        const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        const wert = gew.filter((g) => g.geschlossen_am && new Date(g.geschlossen_am).toISOString().slice(0, 7) === key)
          .reduce((a, g) => a + Number(g.wert || 0), 0);
        verlauf.push({ label: d.toLocaleDateString("de-DE", { month: "short" }), wert });
      }
      const maxV = Math.max(1, ...verlauf.map((m) => m.wert));
      const pkt = verlauf.map((m, i) => [(i / (verlauf.length - 1 || 1)) * 780 + 10, 190 - (m.wert / maxV) * 178]);
      // Weiche Kurve: Catmull-Rom in kubische Bezier. Die Stuetzpunkte werden auf den
      // Wertebereich des jeweiligen Abschnitts begrenzt, sonst schwingt die Kurve unter die Null-Linie.
      const klemm = (v, a, b) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));
      let linie = `M${pkt[0][0].toFixed(1)},${pkt[0][1].toFixed(1)}`;
      for (let i = 0; i < pkt.length - 1; i++) {
        const p0 = pkt[i - 1] || pkt[i], p1 = pkt[i], p2 = pkt[i + 1], p3 = pkt[i + 2] || p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, klemm(p1[1] + (p2[1] - p0[1]) / 6, p1[1], p2[1])];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, klemm(p2[1] - (p3[1] - p1[1]) / 6, p1[1], p2[1])];
        linie += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
      }
      const flaeche = linie + ` L${pkt[pkt.length - 1][0].toFixed(1)},190 L10,190 Z`;
      const gitter = [0, 1, 2, 3, 4].map((i) => 12 + i * 44.5); // Rasterlinien = Achsenwerte

      // Forecast: Deals gewichtet nach Stufen-Wahrscheinlichkeit
      let forecast = 0;
      boards.forEach((b) => b.forEach((st, i) => st.deals.forEach((d) => { forecast += Number(d.wert || 0) * (wahrsch(b.length, i, st.name) / 100); })));
      // Groesster offener Deal + Wert der Deals, die kurzfristig (naechste 30 Tage) erwartet
      // werden. Passt zur Bucket-Auswahl beim Deal ("Naechste 30 Tage" -> heute+30).
      const groesterDeal = alleDeals.length ? Math.max(...alleDeals.map((d) => Number(d.wert || 0))) : 0;
      // Kurzfrist-Forecast: Deals mit erwartetem Datum in den naechsten 30 Tagen, gewichtet
      // nach Stufen-Wahrscheinlichkeit (wie der grosse Forecast) — deshalb ueber die Boards
      // mit Stufen-Index iterieren, nicht ueber die flache alleDeals-Liste.
      const grenze30 = Date.now() + 31 * 86400000;
      let erwartet30 = 0;
      boards.forEach((b) => b.forEach((st, i) => st.deals.forEach((d) => {
        if (d.erwartet_am && new Date(d.erwartet_am).getTime() <= grenze30) {
          erwartet30 += Number(d.wert || 0) * (wahrsch(b.length, i, st.name) / 100);
        }
      })));
      // Ueberfaellige Deals: erwartetes Abschlussdatum liegt in der Vergangenheit, aber der
      // Deal ist noch offen (nicht auf "Gewonnen" gezogen) -> Hinweis in der Glocke, neues
      // Datum einzutragen. Wird beim Gewinnen/Verlieren automatisch aufgeloest (dann nicht mehr offen).
      const heuteMitternacht = new Date(); heuteMitternacht.setHours(0, 0, 0, 0);
      const ueberfaellig = alleDeals.filter((d) => d.erwartet_am && new Date(d.erwartet_am) < heuteMitternacht);
      const dealHinweise = ueberfaellig.map((d) => ({
        id: "deal-ueberfaellig-" + d.id,
        text: `Erwartetes Datum überschritten: ${d.titel || d.firma_name || "Deal"} — neues Datum eintragen`,
      }));
      const abg = await crm.abschlussZahlen(u, sparte);
      const quote = abg.gewonnen + abg.verloren > 0 ? Math.round((abg.gewonnen / (abg.gewonnen + abg.verloren)) * 100) : null;
      const dauer = abg.dauer ? Math.round(abg.dauer) : null;

      // DEMO-Daten fuer "Heute zu tun" — nur zur Veranschaulichung, an nichts angebunden.
      // wichtigkeit: 1 = Sehr wichtig, 2 = Wichtig, 3 = Sollte erledigt werden, 4 = Kann warten (Spalten).
      // dringlichkeit (Badge neben dem To-Do): Extrem dringend | Dringend | ASAP | Bald | Wenn Zeit da ist.
      // sparte: bindet das To-Do an eine Sparte (webdesign | performance | ki). Ohne sparte
      // (z.B. Buchhaltung/Rechnung) erscheint es nur in der Gesamtsicht. Bei einer Sparte
      // werden nur deren To-Dos gezeigt, bei Gesamt alle zusammen.
      const DUMMY_TODOS = [
        { titel: "Angebot schicken", kunde: "Physiotherapie Schwabing", sparte: "webdesign", wichtigkeit: 1, dringlichkeit: "Extrem dringend",
          faellig: "Montag, 28. Juli", empfaenger: "Dr. Anna Weber (Praxisleitung)", beschreibung: "Angebot für Website-Relaunch inkl. Terminbuchung und monatlicher Wartung erstellen und per E-Mail senden. Auf Wunsch zwei Pakete anbieten.",
          telefon: "+49 89 521648", email: "info@physio-schwabing.de", ort: "München", firmaId: 7 },
        { titel: "Setup-Call vorbereiten", kunde: "Physiotherapie Neuhausen", sparte: "webdesign", wichtigkeit: 1, dringlichkeit: "Dringend",
          faellig: "Dienstag, 29. Juli", empfaenger: "Herr Sommer", beschreibung: "Onboarding-Fragen zusammenstellen, Zugänge klären, Agenda für den Setup-Call schicken.",
          telefon: "+49 89 13011884", email: "kontakt@physio-neuhausen.de", ort: "München", firmaId: null },
        { titel: "Vertrag final prüfen", kunde: "GZM Gesundheitszentrum", sparte: "webdesign", wichtigkeit: 2, dringlichkeit: "ASAP",
          faellig: "Mittwoch, 30. Juli", empfaenger: "Rechtsabteilung GZM", beschreibung: "Vertragsentwurf gegenlesen, Laufzeit und Kündigungsfrist prüfen, offene Punkte markieren.",
          telefon: "+49 89 294445", email: "recht@gzm-muenchen.de", ort: "München", firmaId: null },
        { titel: "Rückruf Kai Zenker Praxis", kunde: "Kai Zenker Praxis", sparte: "webdesign", wichtigkeit: 2, dringlichkeit: "Dringend",
          faellig: "heute, 16:00", empfaenger: "Kai Zenker", beschreibung: "Rückfrage zum Angebot beantworten, Termin für Erstgespräch fixieren.",
          telefon: "+49 89 38586920", email: "praxis@zenker-physio.de", ort: "München", firmaId: 4 },
        { titel: "Follow-up E-Mail Peter Heidemann", kunde: "Peter Heidemann Physio", sparte: "webdesign", wichtigkeit: 3, dringlichkeit: "Bald",
          faellig: "Donnerstag, 31. Juli", empfaenger: "Peter Heidemann", beschreibung: "Freundliches Follow-up nach dem Erstgespräch, Zusammenfassung + nächste Schritte.",
          telefon: "+49 89 584219", email: "info@heidemann-physio.de", ort: "München", firmaId: 5 },
        { titel: "Meta-Ads Kampagne optimieren", kunde: "Fitnessstudio Bodyworks", thema: "Performance Marketing", sparte: "performance", wichtigkeit: 1, dringlichkeit: "Dringend",
          faellig: "heute", empfaenger: "Marco Reetz (Inhaber)", beschreibung: "Zielgruppen und Creatives der laufenden Kampagne prüfen, schwache Anzeigen pausieren, Budget auf die Gewinner umschichten.",
          telefon: "+49 89 4471200", email: "ads@bodyworks-muc.de", ort: "München", firmaId: null },
        { titel: "Kunden-Report senden", kunde: "Restaurant Bella Vista", thema: "Performance Marketing", sparte: "performance", wichtigkeit: 2, dringlichkeit: "ASAP",
          faellig: "Mittwoch, 30. Juli", empfaenger: "Frau Conti", beschreibung: "Monats-Report mit Reichweite, Leads und Kosten pro Lead zusammenstellen und an den Kunden senden.",
          telefon: "+49 89 227744", email: "info@bellavista-muc.de", ort: "München", firmaId: null },
        { titel: "TikTok-Video erstellen", kunde: "Modehaus Sommer", thema: "Performance Marketing", sparte: "performance", wichtigkeit: 4, dringlichkeit: "Wenn Zeit da ist",
          faellig: "diese Woche", empfaenger: "Frau Sommer", beschreibung: "Kurzes Reel für den Sommer-Sale — Skript, Aufnahme und Schnitt.",
          telefon: "+49 89 558812", email: "kontakt@modehaus-sommer.de", ort: "München", firmaId: null },
        { titel: "Content-Plan August anlegen", kunde: "Café Kranz", thema: "Performance Marketing", sparte: "performance", wichtigkeit: 4, dringlichkeit: "Bald",
          faellig: "bis 3. August", empfaenger: "Herr Kranz", beschreibung: "Redaktionsplan für August mit Themen, Formaten und Veröffentlichungsterminen.",
          telefon: "+49 89 339021", email: "hallo@cafe-kranz.de", ort: "München", firmaId: null },
        { titel: "Chatbot-Prompt finalisieren", kunde: "Autohaus Wagner", thema: "KI-Projekte", sparte: "ki", wichtigkeit: 1, dringlichkeit: "Dringend",
          faellig: "Dienstag, 29. Juli", empfaenger: "Herr Wagner", beschreibung: "System-Prompt für den Kunden-Chatbot fertigstellen, Antworten testen und Übergaben an einen Menschen sauber definieren.",
          telefon: "+49 89 601234", email: "service@autohaus-wagner.de", ort: "München", firmaId: null },
        { titel: "Automatisierung testen", kunde: "Immobilien König", thema: "KI-Projekte", sparte: "ki", wichtigkeit: 2, dringlichkeit: "Bald",
          faellig: "Donnerstag, 31. Juli", empfaenger: "Frau König", beschreibung: "Neue Lead-Automatisierung mit Testdaten durchlaufen lassen, Fehlerfälle prüfen und Logging kontrollieren.",
          telefon: "+49 89 778890", email: "office@koenig-immo.de", ort: "München", firmaId: null },
        { titel: "Modell-Feintuning planen", kunde: "Logistik Nord GmbH", thema: "KI-Projekte", sparte: "ki", wichtigkeit: 3, dringlichkeit: "Wenn Zeit da ist",
          faellig: "nächste Woche", empfaenger: "IT-Leitung", beschreibung: "Trainingsdaten sichten, Umfang und Aufwand für das Feintuning abschätzen, grobe Roadmap notieren.",
          telefon: "+49 89 903355", email: "it@logistik-nord.de", ort: "München", firmaId: null },
        { titel: "Rechnung Juli verschicken", kunde: "", thema: "Angebote & Rechnungen", wichtigkeit: 3, dringlichkeit: "ASAP",
          faellig: "Donnerstag, 31. Juli", empfaenger: "Buchhaltung", beschreibung: "Juli-Rechnungen erstellen und an alle aktiven Kunden versenden.", telefon: "", email: "", ort: "", firmaId: null },
        { titel: "Termin Steuerkanzlei vorbereiten", kunde: "", thema: "Buchhaltung", wichtigkeit: 3, dringlichkeit: "Bald",
          faellig: "Freitag, 1. August", empfaenger: "Steuerkanzlei Berger", beschreibung: "Belege Q2 sortieren, offene Fragen notieren, Unterlagen mitnehmen.", telefon: "", email: "", ort: "", firmaId: null },
      ];
      // Echte To-Dos aus der Datenbank — das sind die, die in einer Kundenakte oder
      // unter "To-Dos" angelegt wurden und fuer heute eingeplant sind. Nur wenn es
      // noch gar keine gibt, zeigen wir die Beispiele, damit die Seite nicht leer wirkt.
      const echteTodos = (todosHeute || []).map((t) => ({
        titel: t.titel,
        kunde: t.firma_name || "",
        thema: t.firma_name ? "" : "Allgemein",
        sparte: "",
        wichtigkeit: Number(t.wichtigkeit) || 3,
        dringlichkeit: t.dringlichkeit || "Bald",
        faellig: t.faellig ? datum(t.faellig) : "",
        empfaenger: "", beschreibung: t.notiz || "",
        telefon: "", email: "", ort: "", firmaId: t.firma_id,
      }));
      const todoQuelle = echteTodos.length ? echteTodos : DUMMY_TODOS;
      const nurBeispiele = echteTodos.length === 0;
      // Bei einer Sparte nur deren To-Dos; bei Gesamt alle. Der Original-Index (i) bleibt
      // erhalten, damit Grid und Detail-Dialog zusammenpassen.
      const sichtbareTodos = todoQuelle.map((t, i) => ({ t, i }))
        .filter(({ t }) => !sparte || !t.sparte || t.sparte === sparte);
      const DRING_FARBE = { "Extrem dringend": "b-rot", "Dringend": "b-rot", "ASAP": "b-bernstein", "Bald": "b-blau", "Wenn Zeit da ist": "" };
      const SPALTEN_TODO = [{ n: 1, titel: "Sehr wichtig" }, { n: 2, titel: "Wichtig" }, { n: 3, titel: "Sollte erledigt werden" }, { n: 4, titel: "Kann warten" }];
      const schnitt = verlauf.length ? verlauf.reduce((a, m) => a + m.wert, 0) / verlauf.length : 0;
      const letzterM = verlauf[verlauf.length - 1]?.wert || 0, vorM = verlauf[verlauf.length - 2]?.wert || 0;
      const wachstum = vorM > 0 ? ((letzterM - vorM) / vorM) * 100 : (letzterM > 0 ? 100 : null);

      // Trichter — in der Gesamt-Ansicht "Gesamt" (aktuell Dummy-Zahlen, bis die echten
      // sparten-uebergreifenden Deal-Zahlen anfallen), sonst der echte Trichter der Sparte.
      const istGesamt = !sparte;
      const trichterSparte = sparte || "webdesign";
      const tBoard = boards[spartenListe.indexOf(trichterSparte)] || boards[0] || [];
      // Kumulativ: "diese Stufe erreicht" = Deals hier + in allen spaeteren Stufen -> echte Trichterform
      const kum = tBoard.map((_, i) => tBoard.slice(i).reduce((a, s) => a + s.deals.length, 0));
      const kumW = tBoard.map((_, i) => tBoard.slice(i).reduce((a, s) => a + s.deals.reduce((m, d) => m + Number(d.wert || 0), 0), 0));
      const tMax = Math.max(1, ...kum);
      const trichterEcht = tBoard.map((s, i) => {
        const n = kum[i], breite = Math.max(14, Math.round((n / tMax) * 100));
        return `<div class="trichter-zeile"><div class="trichter-spur">
          <div class="trichter-balken" style="width:${breite}%;background:var(--stage-${(i % 8) + 1})">${n}</div></div>
          <div class="trichter-info"><strong>${e(s.name)} · ${wahrsch(tBoard.length, i, s.name)} %</strong><span>${kumW[i] ? geld(kumW[i]) : "—"}</span></div></div>`;
      }).join("");

      // DEMO-Trichter fuer die Gesamt-Ansicht (Platzhalter, bis echte Zahlen vorhanden sind)
      const DUMMY_TRICHTER = [
        { name: "Neu", n: 128, wert: 192000 },
        { name: "Follow-up", n: 86, wert: 140000 },
        { name: "Erstgespräch", n: 47, wert: 94000 },
        { name: "Angebot", n: 21, wert: 52000 },
        { name: "Gewonnen", n: 8, wert: 24000 },
      ];
      const dMax = Math.max(1, ...DUMMY_TRICHTER.map((d) => d.n));
      const trichterDummy = DUMMY_TRICHTER.map((s, i) => {
        const breite = Math.max(14, Math.round((s.n / dMax) * 100));
        return `<div class="trichter-zeile trichter-klick" onclick="document.getElementById('trichter-dlg-${i}').showModal()" title="Leads dieser Stufe ansehen"><div class="trichter-spur">
          <div class="trichter-balken" style="width:${breite}%;background:var(--stage-${(i % 8) + 1})">${s.n}</div></div>
          <div class="trichter-info"><strong>${e(s.name)} · ${wahrsch(DUMMY_TRICHTER.length, i, s.name)} %</strong><span>${geld(s.wert)}</span></div></div>`;
      }).join("");
      // Breites Stufen-Fenster: volle Info pro Lead, Suche + Seitenblaettern (30/Seite).
      // Die Zeilen werden client-seitig aus einem Pool erzeugt (Dummy, bis echte Deals da sind).
      const trichterDialoge = DUMMY_TRICHTER.map((s, i) => `<dialog id="trichter-dlg-${i}" class="trichter-dialog" data-count="${s.n}">
        <div class="trichter-dlg-kopf">
          <div><h2>${e(s.name)}</h2><div class="sub">${s.n} Leads in dieser Stufe · ${geld(s.wert)} Volumen</div></div>
          <div class="topbar-suche trichter-suche-huelle">${ICON.suche}<input type="search" class="trichter-suche" placeholder="Nach Firma oder Ort suchen …"></div>
          <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button>
        </div>
        <div class="tabelle-huelle" style="margin:0">
          <table class="tabelle"><thead><tr><th>Firma</th><th>Ort</th><th>Telefon</th><th>Verantwortlich</th>
            <th class="rechts">Score</th><th class="rechts">Wert</th><th></th></tr></thead>
            <tbody class="trichter-dlg-body"></tbody></table>
        </div>
        <div class="trichter-dlg-fuss">
          <span class="trichter-seiten-info caption"></span>
          <div class="trichter-blaettern"><button type="button" class="sekundaer klein trichter-prev">← Zurück</button>
            <button type="button" class="sekundaer klein trichter-next">Weiter →</button></div>
        </div>
      </dialog>`).join("") + `<script>
        (function(){
          var POOL=[
            {name:"Physiotherapie Schwabing",ort:"München",tel:"+49 89 521648",wer:"Lukas Sehorz",wahr:70,wert:3500},
            {name:"Kai Zenker Praxis",ort:"München",tel:"+49 89 38586920",wer:"Lukas Sehorz",wahr:40,wert:2800},
            {name:"Peter Heidemann Physio",ort:"München",tel:"+49 89 584219",wer:"Jannik vom Hofe",wahr:90,wert:5200},
            {name:"GZM Gesundheitszentrum",ort:"München",tel:"+49 89 294445",wer:"Lukas Sehorz",wahr:20,wert:4100},
            {name:"Physiopoint München",ort:"München",tel:"+49 89 12669030",wer:"Jannik vom Hofe",wahr:30,wert:2600},
            {name:"Body & Motion",ort:"München",tel:"+49 89 998293940",wer:"Lukas Sehorz",wahr:10,wert:3000},
            {name:"SCHWERPUNKT Praxis",ort:"München",tel:"+49 89 20201309",wer:"Jannik vom Hofe",wahr:50,wert:3400},
            {name:"Physiotherapie Neuhausen",ort:"München",tel:"+49 89 13011884",wer:"Lukas Sehorz",wahr:60,wert:3900},
            {name:"Physiotherapie Münchner Freiheit",ort:"München",tel:"+49 89 335863",wer:"Jannik vom Hofe",wahr:20,wert:2500},
            {name:"Praxis Theodoridis",ort:"München",tel:"+49 89 3081898",wer:"Lukas Sehorz",wahr:80,wert:4600},
            {name:"Physiotherapie an der Universität",ort:"München",tel:"+49 89 24402523",wer:"Jannik vom Hofe",wahr:40,wert:3100},
            {name:"Zentrum Physiotherapie mednord",ort:"München",tel:"+49 89 3164318",wer:"Lukas Sehorz",wahr:30,wert:2900},
            {name:"bensphysio",ort:"München",tel:"+49 89 68972263",wer:"Jannik vom Hofe",wahr:10,wert:2200},
            {name:"Physiotherapie Schwarzbach",ort:"München",tel:"+49 1517 0665408",wer:"Lukas Sehorz",wahr:50,wert:3300}
          ];
          function leadsFuer(n){var a=[];for(var k=0;k<n;k++){var b=POOL[k%POOL.length];var suffix=k>=POOL.length?" "+(Math.floor(k/POOL.length)+1):"";a.push({name:b.name+suffix,ort:b.ort,tel:b.tel,wer:b.wer,wahr:b.wahr,wert:b.wert});}return a;}
          document.querySelectorAll('.trichter-dialog').forEach(function(dlg){
            var count=parseInt(dlg.getAttribute('data-count'),10)||0;
            var alle=leadsFuer(count),gefiltert=alle,seite=1,proSeite=30;
            var body=dlg.querySelector('.trichter-dlg-body'),info=dlg.querySelector('.trichter-seiten-info'),suche=dlg.querySelector('.trichter-suche');
            function esc(x){return String(x).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}
            function render(){
              var seiten=Math.max(1,Math.ceil(gefiltert.length/proSeite)); if(seite>seiten)seite=seiten;
              var start=(seite-1)*proSeite, teil=gefiltert.slice(start,start+proSeite);
              body.innerHTML=teil.map(function(l){return '<tr><td class=\"zeile-titel\">'+esc(l.name)+'</td><td>'+esc(l.ort)+'</td><td>'+esc(l.tel)+'</td><td>'+esc(l.wer)+'</td><td class=\"rechts\"><span class=\"badge '+(l.wahr>=70?'b-gruen':l.wahr>=40?'b-bernstein':'b-rot')+'\">'+(l.wahr/10)+'/10</span></td><td class=\"rechts\" style=\"font-weight:600\">'+l.wert.toLocaleString('de-DE')+' €</td><td class=\"rechts\"><a class=\"knopf sekundaer klein\" href=\"/crm/kunden\">öffnen</a></td></tr>';}).join('') || '<tr><td colspan=\"7\" class=\"caption\" style=\"padding:16px\">Keine Treffer.</td></tr>';
              info.textContent='Seite '+seite+' von '+seiten+' · '+gefiltert.length+' Leads';
            }
            suche.addEventListener('input',function(){var q=suche.value.toLowerCase();gefiltert=alle.filter(function(l){return l.name.toLowerCase().indexOf(q)>-1||l.ort.toLowerCase().indexOf(q)>-1;});seite=1;render();});
            dlg.querySelector('.trichter-prev').addEventListener('click',function(){if(seite>1){seite--;render();}});
            dlg.querySelector('.trichter-next').addEventListener('click',function(){var seiten=Math.ceil(gefiltert.length/proSeite);if(seite<seiten){seite++;render();}});
            render();
          });
        })();
        </script>`;

      // Donut: Leads nach Quelle — die 5 festen Quellen (aktuell Dummy-Verteilung je Sparte,
      // bis das quelle-Feld der Leads auf diese Kategorien umgestellt ist). Die Sparten-Werte
      // summieren sich zur Gesamtsicht (42/28/24/19/15 = 128).
      const QUELL_FARBEN = ["#2B2A28", "#565656", "#848484", "#B2AFA8", "#D7D6D2"];
      const QUELL_DEMO = {
        webdesign: [["Cold Calling", 20], ["Empfehlung", 14], ["Meta Ads", 6], ["Netzwerk", 10], ["Social Media", 5]],
        performance: [["Cold Calling", 14], ["Empfehlung", 8], ["Meta Ads", 15], ["Netzwerk", 5], ["Social Media", 8]],
        ki: [["Cold Calling", 8], ["Empfehlung", 6], ["Meta Ads", 3], ["Netzwerk", 4], ["Social Media", 2]],
      };
      const qListe = sparte ? QUELL_DEMO[sparte] : [
        ["Cold Calling", 42], ["Empfehlung", 28], ["Meta Ads", 24], ["Netzwerk", 19], ["Social Media", 15],
      ];
      const qGesamt = qListe.reduce((a, [, n]) => a + n, 0) || 1;
      let offsetAkk = 0; const U = 2 * Math.PI * 70;
      const donutSeg = qListe.map(([q, n], i) => {
        const anteil = n / qGesamt, laenge = anteil * U;
        const seg = `<circle cx="93" cy="93" r="70" fill="none" stroke="${QUELL_FARBEN[i % QUELL_FARBEN.length]}" stroke-width="26"
          stroke-dasharray="${laenge} ${U - laenge}" stroke-dashoffset="${-offsetAkk}"/>`;
        offsetAkk += laenge; return seg;
      }).join("");
      const donutLeg = qListe.map(([q, n], i) => `<div class="legende-zeile">
        <span class="legende-farbe" style="background:${QUELL_FARBEN[i % QUELL_FARBEN.length]}"></span>
        <span>${e(q)}</span><span class="legende-wert">${n}</span>
        <span class="legende-prozent">${Math.round((n / qGesamt) * 100)} %</span></div>`).join("");

      // Team-Balken — mit dem Umsatz klein ueber dem jeweiligen Balken
      const maxTeam = Math.max(1, ...team.map((t) => Number(t.umsatz_monat) || 0));
      const balken = team.filter((t) => t.rolle !== "x").map((t) => `
        <div class="balken-saeule">
        <div class="balken" style="height:${Math.max(3, Math.round((Number(t.umsatz_monat) || 0) / maxTeam * 100))}%"><span class="balken-wert">${geldK(Number(t.umsatz_monat) || 0)}</span></div>
        <span class="balken-label">${e(t.name.split(" ")[0])}</span></div>`).join("");


      // Auswertung je Sparte - Grundlage fuer den Reiter "Pipeline-Volumen"
      const heute = new Date();
      const auswertung = spartenListe.map((sp, i) => {
        const b = boards[i] || [];
        const deals = b.flatMap((st) => st.deals);
        const volumen = deals.reduce((a, d) => a + Number(d.wert || 0), 0);
        const gewichtet = b.reduce((a, st, j) => a + st.deals.reduce((m, d) => m + Number(d.wert || 0) * (wahrsch(b.length, j, st.name) / 100), 0), 0);
        const alter = deals.length ? deals.reduce((a, d) => a + (heute - new Date(d.erstellt)) / 86400000, 0) / deals.length : 0;
        const stufen = b.map((st, j) => ({
          name: st.name, anzahl: st.deals.length, quote: wahrsch(b.length, j, st.name),
          wert: st.deals.reduce((m, d) => m + Number(d.wert || 0), 0),
          alter: st.deals.length ? st.deals.reduce((a, d) => a + (heute - new Date(d.erstellt)) / 86400000, 0) / st.deals.length : 0,
        }));
        const engpass = stufen.filter((x) => x.anzahl).sort((a, b2) => b2.wert - a.wert)[0] || null;
        return { key: sp, name: SPARTEN[sp], anzahl: deals.length, volumen, gewichtet, alter, stufen, engpass };
      });
      const maxVol = Math.max(1, ...auswertung.map((a) => a.volumen));

      const q = (t) => "/crm?tab=" + t + (sparte ? "&sparte=" + sparte : "");
      const reiter = reiterLeiste([
        { id: "uebersicht", label: "Übersicht", href: q("uebersicht") },
        // Pipeline-Volumen nur in der Gesamtsicht — bei einer Sparte zeigt deren
        // eigene Uebersicht das schon. Team-Leistung hat einen eigenen Navbar-Punkt.
        ...(sparte ? [] : [{ id: "pipeline", label: "Pipeline-Volumen", href: q("pipeline") }]),
      ], tab, sparte, "/crm?tab=" + tab);

      const offeneLeadsAnzahl = alle.filter((f) => f.status === "lead").length;
      const ansichten = {};
      ansichten.uebersicht = `
        <div class="raster" style="grid-template-columns:0.85fr 1.3fr 0.85fr;margin-bottom:16px;align-items:stretch">
          <div class="karte karte-schmal">
            <div class="karte-kopf"><div><h2>Umsatzentwicklung</h2>
              <div class="caption" style="margin-top:6px">Ø Umsatz pro Monat</div>
              <div class="chart-kopf"><span class="chart-zahl">${geld(schnitt)}</span>
                ${wachstum !== null ? `<span class="trend ${wachstum >= 0 ? "auf" : "ab"}">${wachstum >= 0 ? "↗" : "↘"} ${Math.abs(wachstum).toFixed(1).replace(".", ",")} %</span>` : ""}</div></div></div>
            <nav class="zeitraum zeitraum-schmal">
              ${[["30", "30 T"], ["3", "3 M"], ["6", "6 M"], ["12", "12 M"]].map(([k, v]) =>
                `<a href="/crm?tab=${tab}&zr=${k}${sparte ? "&sparte=" + sparte : ""}" class="${zeitraum === k ? "aktiv" : ""}">${v}</a>`).join("")}
            </nav>
            <div class="chart-flaeche" style="height:220px">
              <div class="chart-y">${[maxV, maxV * .75, maxV * .5, maxV * .25, 0].map((v, i) =>
                `<span style="top:${gitter[i]}px">${geldK(v)}</span>`).join("")}</div>
              <svg viewBox="0 0 800 200" preserveAspectRatio="none" style="width:100%;height:200px">
                <defs><linearGradient id="fl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--blau-600)" stop-opacity=".34"/>
                  <stop offset="55%" stop-color="var(--blau-500)" stop-opacity=".12"/>
                  <stop offset="100%" stop-color="var(--blau-500)" stop-opacity="0"/></linearGradient>
                  <linearGradient id="ln" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="var(--blau-400)"/><stop offset="100%" stop-color="var(--blau-800)"/></linearGradient></defs>
                ${gitter.map((y) => `<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 6"/>`).join("")}
                <path d="${flaeche}" fill="url(#fl)"/>
                <path d="${linie}" fill="none" stroke="url(#ln)" stroke-width="2.5" stroke-linecap="round"/>
                ${pkt.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#fff" stroke="var(--blau-600)" stroke-width="2.5"/>`).join("")}
              </svg>
              <div class="chart-achse" style="padding-left:0">${verlauf.map((m) => `<span class="caption">${e(m.label)}</span>`).join("")}</div>
            </div>
            ${wachstum !== null ? `<div class="chart-fuss"><span style="color:${wachstum >= 0 ? "var(--success)" : "var(--danger)"};font-weight:600">${wachstum >= 0 ? "+" : ""}${wachstum.toFixed(1).replace(".", ",")} %</span>
              Wachstum: letzter Monat gegenüber dem Monat davor</div>` : ""}
            <div class="kennliste" style="margin-top:14px;border-top:1px solid var(--border);padding-top:6px">
              <div class="kennzeile">${ICON.prozent}<span>Abschlussquote</span><b>${quote === null ? "—" : quote + " %"}</b></div>
              <div class="kennzeile">${ICON.sanduhr}<span>Ø Deal-Dauer</span><b>${dauer ? dauer + " Tage" : "—"}</b></div>
            </div>
          </div>

          <div class="karte karte-mitte">
            <div class="mini-stat-reihe">
              <div class="mini-stat"><span class="caption">Offene Leads</span><b>${offeneLeadsAnzahl}</b></div>
              <div class="mini-stat"><span class="caption">Pipeline-Wert</span><b>${geld(wert)}</b></div>
            </div>
            <div class="hero-umsatz">
              <div class="hero-umsatz-seite">
                <span class="kachel-mini-titel">Kunden</span>
                <div class="hero-umsatz-neben-zahl">${z.kunden}</div>
              </div>
              <div class="hero-umsatz-haupt">
                <span class="kachel-label">Umsatz ${e(monat)}</span>
                <div class="kachel-zahl" data-zahl="${heroUmsatz}" data-geld="1">0</div>
                <div class="kachel-fuss-stapel">
                  <span class="caption">Ziel: ${geld(ziel)}</span>
                  <span class="trend auf klein">${heroFortschritt} % vom Ziel</span>
                </div>
              </div>
              <div class="hero-umsatz-seite hero-umsatz-neben">
                <span class="kachel-mini-titel">${e(vormonatName)}</span>
                <div class="hero-umsatz-neben-zahl">${geld(heroVormonat)}</div>
                <span class="kachel-mini-ziel">/ ${geld(ziel)}</span>
              </div>
            </div>
            <img src="/bilder/orb-grau.png" class="orb-deko" alt="">
          </div>

          <div class="karte">
            <div class="karte-kopf"><div><h2>Blick nach vorn</h2>
              <div class="sub">Was in der offenen Pipeline steckt</div></div></div>
            <div class="forecast">
              <div class="forecast-label">${ICON.waage} Forecast</div>
              <div class="forecast-zahl">${geld(forecast)}</div>
              <div class="forecast-sub">gewichtet nach Phasen-Wahrscheinlichkeit</div>
            </div>
            <div class="kennliste">
              <div class="kennzeile">${ICON.trend}<span>Pipeline-Volumen (offen)</span><b>${geld(wert)}</b></div>
              <div class="kennzeile">${ICON.schichten}<span>Offene Deals</span><b>${offen}</b></div>
              <div class="kennzeile">${ICON.euro}<span>Ø Deal-Größe</span><b>${offen ? geld(wert / offen) : "—"}</b></div>
              <div class="kennzeile">${ICON.ziel}<span>Größter Deal</span><b>${offen ? geld(groesterDeal) : "—"}</b></div>
              <div class="kennzeile">${ICON.kalender}<span>Nächste 30 Tage erwartet</span><b>${erwartet30 ? geld(erwartet30) : "—"}</b></div>
            </div>
            <a class="knopf dunkel" style="width:100%;justify-content:center;margin-top:16px"
               href="/crm/pipeline?sparte=${sparte || "webdesign"}">Zur offenen Pipeline</a>
          </div>
        </div>

        <div class="raster raster-2" style="margin-bottom:16px">
          <div class="karte">
            <div class="karte-kopf"><div><h2>Heute zu tun ${
              nurBeispiele ? `<span class="badge b-bernstein">Beispiele</span>` : ""}</h2>
              <div class="sub">${nurBeispiele
                ? "Noch nichts für heute eingeplant — das hier sind Beispiele. Leg To-Dos in einer Kundenakte oder unter To-Dos an."
                : "Für heute geplant — nach Wichtigkeit sortiert, mit Dringlichkeit."}</div></div>
              <a href="/crm/todos" class="caption">Alle To-Dos →</a></div>
            <div class="heute-spalten">
              ${SPALTEN_TODO.map((sp) => `<div class="heute-spalte">
                <div class="heute-spalte-kopf">${e(sp.titel)}</div>
                ${sichtbareTodos.filter((x) => x.t.wichtigkeit === sp.n).map(({ t, i }) => `<div class="heute-todo ${["Extrem dringend", "Dringend"].includes(t.dringlichkeit) ? "heute-todo--dringend" : ""}" onclick="document.getElementById('todo-dlg-${i}').showModal()">
                  <button type="button" class="todo-haken" title="Als erledigt abhaken" onclick="event.stopPropagation(); this.closest('.heute-todo').remove()">${ICON.check}</button>
                  <div class="heute-todo-text">
                    <div class="heute-todo-titel">${e(t.kunde || t.thema || "Allgemein")}</div>
                    <span class="heute-todo-kunde">${e(t.titel)}</span>
                    <span class="badge dring ${DRING_FARBE[t.dringlichkeit] || ""}">${e(t.dringlichkeit)}</span>
                  </div></div>`).join("") || `<p class="caption" style="font-size:12px">—</p>`}
              </div>`).join("")}
            </div>
            ${sichtbareTodos.map(({ t, i }) => `<dialog id="todo-dlg-${i}" class="todo-dialog">
              <div class="todo-dlg-kopf"><div><h2>${e(t.kunde || t.thema || "Allgemeine Aufgabe")}</h2><div class="sub">${e(t.titel)}</div></div>
                <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
              <div class="todo-dlg-badges">
                <span class="badge">Wichtigkeit: ${e(SPALTEN_TODO.find((s) => s.n === t.wichtigkeit).titel)}</span>
                <span class="badge ${DRING_FARBE[t.dringlichkeit] || ""}">${e(t.dringlichkeit)}</span></div>
              <div class="todo-dlg-grid">
                <div><span>Bis wann</span><b>${e(t.faellig || "—")}</b></div>
                <div><span>An wen</span><b>${e(t.empfaenger || "—")}</b></div></div>
              <h3>Was genau</h3><p class="todo-dlg-text">${e(t.beschreibung || "—")}</p>
              ${t.kunde ? `<h3>Kundenakte · ${e(t.kunde)}</h3>
                <dl class="def">
                  <dt>Telefon</dt><dd>${t.telefon ? `<a href="tel:${e(t.telefon)}">${e(t.telefon)}</a>` : "—"}</dd>
                  <dt>E-Mail</dt><dd>${t.email ? `<a href="mailto:${e(t.email)}">${e(t.email)}</a>` : "—"}</dd>
                  <dt>Ort</dt><dd>${e(t.ort || "—")}</dd></dl>` : ""}
              <div class="dialog-fuss">
                ${t.firmaId ? `<a href="/crm/firma/${t.firmaId}" class="knopf sekundaer">Zur vollständigen Kundenakte →</a>` : (t.kunde ? `<a href="/crm/kunden" class="knopf sekundaer">Kunde öffnen →</a>` : "")}
                <button type="button" class="dunkel" onclick="this.closest('dialog').close()">Schließen</button></div>
            </dialog>`).join("")}
            <script>
            (function(){
              var gezogen=null;
              // Findet die Karte, VOR der eingefuegt werden soll — anhand der Maus-Y-Position.
              // So landet das To-Do genau dort, wo man es fallen laesst (auch zwischen/unter anderen).
              function zielKarte(spalte, y){
                var karten = Array.prototype.slice.call(spalte.querySelectorAll('.heute-todo:not(.todo-zieht)'));
                var naechste = { abstand: -Infinity, el: null };
                karten.forEach(function(k){
                  var box = k.getBoundingClientRect();
                  var versatz = y - box.top - box.height/2;
                  if(versatz < 0 && versatz > naechste.abstand){ naechste = { abstand: versatz, el: k }; }
                });
                return naechste.el;
              }
              document.querySelectorAll('.heute-todo').forEach(function(el){
                el.setAttribute('draggable','true');
                el.addEventListener('dragstart',function(ev){ gezogen=el; setTimeout(function(){ el.classList.add('todo-zieht'); },0); ev.dataTransfer.effectAllowed='move'; });
                el.addEventListener('dragend',function(){ el.classList.remove('todo-zieht'); gezogen=null;
                  document.querySelectorAll('.heute-spalte').forEach(function(s){ s.classList.remove('spalte-ziel'); }); });
              });
              document.querySelectorAll('.heute-spalte').forEach(function(sp){
                sp.addEventListener('dragover',function(ev){
                  ev.preventDefault(); sp.classList.add('spalte-ziel');
                  if(!gezogen) return;
                  var nach = zielKarte(sp, ev.clientY);
                  if(nach == null) sp.appendChild(gezogen); else sp.insertBefore(gezogen, nach);
                });
                sp.addEventListener('dragleave',function(ev){ if(!sp.contains(ev.relatedTarget)) sp.classList.remove('spalte-ziel'); });
                sp.addEventListener('drop',function(ev){ ev.preventDefault(); sp.classList.remove('spalte-ziel'); });
              });
            })();
            </script>
          </div>

          <div class="karte-spalte">
            <div class="karte karte-trichter">
              <div class="karte-kopf"><div><h2>Trichter ${istGesamt ? "Gesamt" : e(SPARTEN[trichterSparte])}</h2>
                <div class="sub">Je Stufe erreicht · offene Deals</div></div>
                <a href="/crm/pipeline?sparte=${trichterSparte}" class="caption">öffnen →</a></div>
              ${istGesamt ? `<div class="trichter">${trichterDummy}</div>${trichterDialoge}`
                : tBoard.some((s) => s.deals.length) ? `<div class="trichter">${trichterEcht}</div>`
                : `<p class="caption">Noch keine Deals in dieser Sparte. Leg bei einem Lead einen Deal an — er erscheint dann hier.</p>`}
            </div>
            ${u.rolle === "admin" ? `<div class="karte karte-dunkel" style="margin-top:16px"><div class="karte-kopf"><div><h2>Umsatz je Person</h2>
              <div class="sub">Gewonnene Deals im ${e(monat)}</div></div>
              <a href="/crm/team" class="caption">Details →</a></div>
              <div class="balken-block">${balken}</div></div>` : ""}
          </div>
        </div>

        <div class="raster raster-2" style="align-items:start">
          <div class="karte"><div class="karte-kopf"><div><h2>Leads nach Quelle</h2>
            <div class="sub">Woher unsere Kontakte kommen</div></div></div>
            <div class="donut-block">
              <div class="donut"><svg width="186" height="186">${donutSeg}</svg>
                <div class="donut-mitte"><div><b>${qGesamt}</b><span class="caption">Gesamt</span></div></div></div>
              <div class="donut-legende">${donutLeg || '<span class="caption">Noch keine Daten.</span>'}</div>
            </div></div>
          <div style="max-width:230px">
            ${kachel("Gescheiterte Deals", gescheitertAnzahl, ICON.trendAb, "rot", `<span class="caption">Wert: ${geld(gescheitertWert)}</span>`)}
          </div>
        </div>`;

      // Pipeline-Volumen (nur Gesamtsicht): ein ausfuehrlicher Kasten "Volumen je Sparte".
      // Die Eintraege in der Pipeline sind offene LEADS (noch keine gewonnenen Deals).
      // Solange die echte Pipeline leer ist, Demo-Zahlen zeigen, damit man Balken und
      // Anteile veranschaulicht sieht (WD 6.000 \u00b7 Performance 13.000 \u00b7 KI 7.000).
      const pvDemo = [
        { key: "performance", name: SPARTEN.performance, anzahl: 5, volumen: 13000, gewichtet: 6500, alter: 8, engpass: { name: "Erstgespr\u00e4ch", wert: 6000 } },
        { key: "ki", name: SPARTEN.ki, anzahl: 2, volumen: 7000, gewichtet: 2800, alter: 20, engpass: { name: "Neu", wert: 4000 } },
        { key: "webdesign", name: SPARTEN.webdesign, anzahl: 3, volumen: 6000, gewichtet: 2400, alter: 12, engpass: { name: "Angebot", wert: 3000 } },
      ];
      const pvEcht = [...auswertung].sort((a, b2) => b2.volumen - a.volumen);
      const pvDaten = pvEcht.reduce((a, x) => a + x.volumen, 0) > 0 ? pvEcht : pvDemo;
      const pvVolGesamt = pvDaten.reduce((a, x) => a + x.volumen, 0);
      const pvGewGesamt = pvDaten.reduce((a, x) => a + x.gewichtet, 0);
      const pvLeadsGesamt = pvDaten.reduce((a, x) => a + x.anzahl, 0);
      const pvMax = Math.max(1, ...pvDaten.map((x) => x.volumen));
      ansichten.pipeline = `
        <div class="karte" style="margin-bottom:16px">
          <div class="karte-kopf"><div><h2>Volumen je Sparte</h2>
            <div class="sub">Wo unser offenes Pipeline-Volumen steckt \u2014 und was davon gewichtet realistisch ist</div></div>
            <div class="pv-summe">
              <div><span class="caption">Pipeline gesamt</span><b>${geld(pvVolGesamt)}</b></div>
              <div><span class="caption">gewichteter Forecast</span><b class="pv-gruen">${geld(pvGewGesamt)}</b></div>
              <div><span class="caption">offene Leads</span><b>${pvLeadsGesamt}</b></div>
            </div></div>
          <div class="pv-legende">
            <span><i class="pkt gesamt"></i> heller Balken = gesamtes Volumen</span>
            <span><i class="pkt gewichtet"></i> dunkler Balken = realistischer Forecast (gewichtet)</span></div>
          ${pvDaten.map((a) => {
            const anteilVol = pvVolGesamt ? Math.round((a.volumen / pvVolGesamt) * 100) : 0;
            const anteilGew = pvGewGesamt ? Math.round((a.gewichtet / pvGewGesamt) * 100) : 0;
            return `<div class="sparte-zeile">
            <div class="sparte-kopf"><b>${e(a.name)}</b>
              <span class="caption">${a.anzahl} ${a.anzahl === 1 ? "Lead" : "Leads"} \u00b7 \u00d8 ${Math.round(a.alter)} Tage alt</span>
              <span class="sparte-wert">${geld(a.volumen)}<span class="sparte-anteil">${anteilVol} % der Pipeline</span></span></div>
            <div class="sparte-spur">
              <div class="sparte-balken" style="width:${Math.round((a.volumen / pvMax) * 100)}%"></div>
              <div class="sparte-balken gewichtet" style="width:${Math.round((a.gewichtet / pvMax) * 100)}%"></div>
            </div>
            <div class="sparte-fuss">
              <span class="caption">gewichtet <b class="pv-gruen">${geld(a.gewichtet)}</b> \u00b7 ${anteilGew} % vom gewichteten Gesamt</span>
              <a href="/crm/pipeline?sparte=${a.key}" class="caption pv-board">Board \u00f6ffnen \u2192</a></div></div>`;
          }).join("")}
        </div>`;

      res.send(rahmen(u, "start", "Dashboard", "", reiter, ansichten[tab] || ansichten.uebersicht, sparte, dealHinweise));
    } catch (err) { next(err); }
  });

  // ================= PIPELINE =================
  app.get("/crm/pipeline", async (req, res, next) => {
    try {
      const u = req.nutzer;
      // Leere Sparte = "Gesamt": alle drei Bereiche in einem Board.
      const sparte = SPARTEN[req.query.sparte] ? req.query.sparte : "";
      const istGesamtBoard = !sparte;
      const art = req.query.art === "projekt" ? "projekt" : "vertrieb";
      const [boards, firmen, mitarbeiter] = await Promise.all([
        Promise.all((istGesamtBoard ? Object.keys(SPARTEN) : [sparte]).map((sp) => crm.dealsNachStufen(u, sp, art))),
        crm.firmenListe(u, { limit: 300 }), crm.team(u),
      ]);
      // In der Gesamtsicht werden gleichbedeutende Stufen der drei Bereiche in einer
      // Spalte zusammengelegt und nach Wahrscheinlichkeit sortiert — "Neu" steht also
      // links, "Gewonnen" rechts. "Erstgespräch" und "Readiness-Check gebucht" sind
      // dasselbe und landen darum unter einem gemeinsamen Namen.
      const spartenListe = istGesamtBoard ? Object.keys(SPARTEN) : [sparte];
      let alleSpalten;
      if (istGesamtBoard) {
        const nachGruppe = new Map();
        boards.forEach((brett, bi) => brett.forEach((st, i) => {
          const sp = spartenListe[bi];
          const pos = st.position ?? i + 1;
          // Im Verkauf legen wir gleichbedeutende Phasen unter einem gemeinsamen Namen
          // zusammen. In der Projektabwicklung heisst jede Phase in jedem Bereich anders
          // — dort zaehlt die Phasennummer, und der Spaltenkopf nennt darunter die drei
          // Namen. Sonst stuenden hier 17 Spalten nebeneinander.
          const g = art === "projekt"
            ? { schluessel: "phase-" + pos, label: "Phase " + pos }
            : stufenGruppe(st.name);
          const vorhanden = nachGruppe.get(g.schluessel);
          if (vorhanden) {
            vorhanden.deals = vorhanden.deals.concat(st.deals);
            vorhanden.position = Math.min(vorhanden.position, pos);
            // stufen = Bereich -> konkrete Stufen-Id. Daraus werden die Punkte im
            // Spaltenkopf, und beim Ziehen weiss die Karte genau, wohin sie gehoert.
            vorhanden.stufen[sp] = st.id;
            vorhanden.namen[sp] = st.name;
            vorhanden.ist_abschluss = vorhanden.ist_abschluss || st.ist_abschluss;
          } else {
            nachGruppe.set(g.schluessel, { ...st, name: g.label, quote: STUFEN_QUOTE[st.name] ?? 50,
              platz: stufenPlatz(st.name),
              deals: [...st.deals], position: pos, stufen: { [sp]: st.id }, namen: { [sp]: st.name } });
          }
        }));
        alleSpalten = [...nachGruppe.values()].sort((a, b2) => (art === "projekt"
          ? a.position - b2.position
          : a.platz - b2.platz || a.position - b2.position || a.name.localeCompare(b2.name)));
      } else {
        alleSpalten = boards[0].map((s, i) => ({ ...s,
          quote: art === "vertrieb" ? wahrsch(boards[0].length, i, s.name) : null,
          stufen: { [sparte]: s.id }, namen: { [sparte]: s.name } }));
      }
      // Reihenfolge in der Spalte: erst die Dringlichkeit (sehr dringend ganz oben),
      // darin die von Hand gezogene Reihenfolge. In der Gesamtsicht kamen die drei
      // Bereiche als getrennte Listen an und stuenden sonst hintereinander.
      const dringRang = (d) => DRINGLICHKEIT[d.dringlichkeit]?.rang ?? 9;
      alleSpalten.forEach((s) => s.deals.sort((a, b2) =>
        dringRang(a) - dringRang(b2)
        || (a.sortierung ?? Infinity) - (b2.sortierung ?? Infinity)
        || new Date(b2.erstellt) - new Date(a.erstellt)));
      // Nach Verantwortlichem filtern — leer = alle im Team.
      const person = mitarbeiter.some((m) => m.id === req.query.person) ? req.query.person : "";
      const spalten = person
        ? alleSpalten.map((s) => ({ ...s, deals: s.deals.filter((d) => d.besitzer === person) }))
        : alleSpalten;
      const gesamt = spalten.reduce((n, s) => n + s.deals.length, 0);
      const wert = spalten.reduce((n, s) => n + s.deals.reduce((m, d) => m + gesamtWert(d), 0), 0);

      // Eine Adresse, drei Schalter: Sparte, Art (Verkauf/Projekt) und Person.
      const pipeUrl = (o = {}) => {
        const sp = o.sparte ?? sparte, ar = o.art ?? art, pe = o.person ?? person;
        return `/crm/pipeline?sparte=${sp}&art=${ar}${pe ? "&person=" + pe : ""}`;
      };
      const pUrl = (pid) => pipeUrl({ person: pid });
      const reiter = reiterLeiste([
        { id: "vertrieb", label: "Verkauf", href: pipeUrl({ art: "vertrieb" }) },
        { id: "projekt", label: "Projektabwicklung", href: pipeUrl({ art: "projekt" }) },
      ], art, sparte, "/crm/pipeline?art=" + art + (person ? "&person=" + person : ""), {
        aktiv: person,
        liste: [{ id: "", label: "Alle", href: pUrl("") }].concat(
          mitarbeiter.map((m) => ({ id: m.id, label: m.name.split(" ")[0], href: pUrl(m.id) }))),
      });

      res.send(rahmenPipeline(u, sparte, art, reiter, `
        <div class="seiten-kopf">
          <div><p class="sub">${gesamt} ${art === "projekt"
            ? (gesamt === 1 ? "laufendes Projekt" : "laufende Projekte")
            : "offene Deals"} · ${geld(wert)} Gesamtwert${istGesamtBoard ? " · alle drei Bereiche" : ""}</p></div>
          ${istGesamtBoard || art === "projekt" ? "" : `<button class="dunkel" onclick="document.getElementById('dealNeu').showModal()">${ICON.plus} Neuer Deal</button>`}
        </div>
        ${istGesamtBoard ? `<div class="hinweis info" style="margin-bottom:14px">${ICON.info}<div>
          <strong>Überblick über alle Bereiche.</strong> ${art === "projekt"
            ? `Zusammengelegt nach Phasennummer — unter jeder Spalte steht, wie die Phase im
               jeweiligen Bereich heißt. Eine Karte landet immer in der Phase ihres eigenen Bereichs.`
            : `Phasen, die dasselbe bedeuten, stehen in einer Spalte. Die Punkte sagen, welche Bereiche
               eine Phase haben — nur deren Karten lassen sich dort ablegen.`}
          Innerhalb einer Spalte stehen die dringendsten Karten oben.</div></div>` : ""}
        <div class="zug-hinweis" id="zug-hinweis" role="status" aria-live="polite"></div>
        <div class="kanban" id="kanban">
          ${spalten.map((s, i) => {
            // In der Gesamtsicht sagen die Punkte, welche Bereiche diese Phase haben —
            // nur deren Karten lassen sich hier ablegen.
            const sparten = Object.keys(SPARTEN).filter((sp) => s.stufen[sp]);
            // Verkauf: eine Punktreihe sagt, welche Bereiche die Phase haben.
            // Projektabwicklung: dort heisst die Phase in jedem Bereich anders, darum
            // steht unter "Phase N" je Bereich der Name, den sie dort traegt.
            const punkte = istGesamtBoard && art === "vertrieb"
              ? `<span class="stufe-punkte" title="Diese Phase gibt es in: ${
                  sparten.map((sp) => SPARTEN[sp]).join(", ")}">${
                  sparten.map((sp) => `<span class="stufe-punkt sparte-${sp}"></span>`).join("")}</span>`
              : "";
            const unterzeile = istGesamtBoard && art === "projekt"
              ? `<div class="stufe-namen">${sparten.map((sp) =>
                  `<span><i class="stufe-punkt sparte-${sp}"></i>${e(s.namen[sp])}</span>`).join("")}</div>`
              : `<div class="spalte-quote">${art !== "vertrieb"
                  ? "Phase " + s.position
                  : s.ist_verlust ? "Deal ist weg"
                  : (s.quote ?? wahrsch(spalten.length, i, s.name)) + " % Wahrscheinlichkeit"}</div>`;
            return `
            <div class="spalte${s.ist_verlust ? " spalte-verlust" : ""}" data-stufe="${s.id}"
              data-stufen="${e(JSON.stringify(s.stufen))}" style="--stufe:var(--stage-${(i % 8) + 1})">
              <div class="spalte-kopf"><div class="spalte-titel-zeile">
                <span class="spalte-titel">${e(s.name)}</span>${punkte}<span class="spalte-zahl">${s.deals.length}</span></div>
                ${unterzeile}</div>
              <div class="spalte-karten">
                ${!s.deals.length ? `<div class="spalte-leer">${
                  s.ist_abschluss ? "Ziel-Stufe" : s.ist_verlust ? "Hierher, wenn nichts draus wird" : "leer"}</div>` : ""}
                ${s.deals.map((d) => {
                  const dr = DRINGLICHKEIT[d.dringlichkeit];
                  // Steht ein Gespräch an, zeigt die Karte dessen Datum. Sonst das
                  // Datum, bis zu dem die Phase abgehakt sein muss.
                  const gespraech = GESPRAECHS_PHASE(s.name);
                  const terminWert = gespraech ? d.erstgespraech_am : d.faellig_am;
                  const terminText = gespraech || "fällig bis";
                  const ueberfaellig = !gespraech && terminWert && new Date(terminWert) < new Date(heuteFeld());
                  return `
                  <div class="deal sparte-${e(d.sparte)}" draggable="true"
                    data-id="${d.id}" data-sparte="${e(d.sparte)}" data-rang="${dr ? dr.rang : 9}"
                    data-firma="${d.firma_id}"
                    onclick="if(!window.__zieht)location.href='/crm/firma/${d.firma_id}'">
                    <div class="deal-kopf"><span class="deal-punkt"></span>
                      <span class="deal-name">${e(d.firma_name)}</span><span class="deal-griff">${ICON.griff}</span></div>
                    <div class="deal-person">${d.geschaeftsfuehrer
                      ? e(d.geschaeftsfuehrer) + (d.ansprech_rolle ? ` · ${e(d.ansprech_rolle)}` : "")
                      : "Ansprechperson offen"}</div>
                    <div class="deal-betrag">${geld(gesamtWert(d))}${d.erfolgsbonus
                      ? `<span class="deal-bonus" title="${e(d.erfolgsbonus_text || "Erfolgsbonus vereinbart")}">+ Bonus</span>` : ""}</div>
                    ${terminWert
                      ? `<div class="deal-termin ${ueberfaellig ? "spaet" : ""}">${ICON.kalender}
                          <span>${terminText} <b>${datum(terminWert)}</b></span></div>`
                      : `<div class="deal-termin offen">${ICON.kalender}<span>${terminText} — noch offen</span></div>`}
                    <div class="deal-marken">
                      <span class="badge deal-sparte">${e(SPARTEN[d.sparte] || d.sparte)}</span>
                      ${d.quelle ? `<span class="badge">${e(d.quelle)}</span>` : ""}</div>
                    <div class="deal-fuss">
                      <span class="deal-wer">${ICON.person}${e(d.besitzer_name || "—")}</span>
                      <select class="deal-dring dr-${dr ? dr.farbe : "leer"}" title="Dringlichkeit"
                        aria-label="Dringlichkeit für ${e(d.firma_name)}">
                        <option value="" ${dr ? "" : "selected"}>offen</option>
                        ${Object.keys(DRINGLICHKEIT).map((k) =>
                          `<option ${d.dringlichkeit === k ? "selected" : ""}>${e(k)}</option>`).join("")}
                      </select></div>
                  </div>`; }).join("")}
              </div></div>`; }).join("")}
        </div>
        ${!gesamt ? `<div class="hinweis info">${ICON.info}<div><strong>${art === "projekt"
            ? "Noch keine laufenden Projekte" : "Noch keine offenen Deals"}${sparte ? " in " + e(SPARTEN[sparte]) : ""}.</strong>
          ${art === "projekt"
            ? "Projekte entstehen automatisch: Sobald du im Verkauf einen Deal auf „Gewonnen“ ziehst, erscheint er hier in der ersten Phase."
            : sparte ? "Leg oben rechts einen neuen Deal an — er erscheint dann in der ersten Stufe und lässt sich per Ziehen bewegen."
                     : "Wechsel in einen Bereich, um dort einen Deal anzulegen."}</div></div>` : ""}

        <dialog id="dealNeu"><h2>Neuer Deal</h2><div class="sub">Bereich ${e(SPARTEN[sparte] || "—")} · Kunde &amp; Phase</div>
          <form method="post" action="/crm/deal/anlegen">
            <input type="hidden" name="sparte" value="${sparte}">
            <div class="feld"><label>Kunde / Lead *</label><select name="firma_id" required>
              <option value="">Kunden wählen …</option>
              ${firmen.map((f) => `<option value="${f.id}">${e(f.name)}${f.ort ? " — " + e(f.ort) : ""}</option>`).join("")}</select></div>
            <div class="feld"><label>Dealname *</label><input name="titel" required placeholder="z. B. Website + Wartung"></div>
            <div class="feld-paar">
              <div class="feld"><label>Wert (€)</label><input name="wert" type="number" step="1" placeholder="0"></div>
              <div class="feld"><label>Phase</label><select name="stufe_id">
                ${spalten.map((s) => `<option value="${s.id}">${e(s.name)}</option>`).join("")}</select></div>
            </div>
            <div class="feld-paar">
              <div class="feld"><label>Verantwortlich</label><select name="besitzer">
                ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === u.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
              <div class="feld"><label>Erwarteter Abschluss</label><select name="erwartet_horizont">
                <option value="">unbekannt</option>
                <option value="30">Nächste 30 Tage</option>
                <option value="60">Nächste 60 Tage</option>
                <option value="90">Nächste 3 Monate</option>
                <option value="180">Nächste 6 Monate</option>
                <option value="365">Nächste 12 Monate</option></select></div>
            </div>
            <div class="dialog-fuss"><button type="button" class="sekundaer" onclick="document.getElementById('dealNeu').close()">Abbrechen</button>
              <button type="submit" class="dunkel">Deal anlegen</button></div>
          </form></dialog>
        <script>
        (function(){
          const ART=${art === "projekt" ? '"projekt"' : '"deal"'};
          const kanban=document.getElementById("kanban");
          let gezogen=null, startSpalte=null, startDavor=null, abgelegt=false;
          let zeigerX=0, zeigerY=0, rollen=null;
          window.__zieht=false;

          function melden(text){
            const box=document.getElementById("zug-hinweis");
            if(!box) return;
            box.textContent=text; box.classList.add("sichtbar");
            clearTimeout(window.__zugTimer);
            window.__zugTimer=setTimeout(()=>box.classList.remove("sichtbar"),3500);
          }

          // ---- Mitfahren am Rand -------------------------------------------------
          // Ohne das kommt man beim Ziehen nie bis "Gewonnen", weil das Brett breiter
          // ist als der Bildschirm. Nahe am Rand rollt es von selbst weiter — waagrecht
          // das Brett, senkrecht die Seite, damit auch lange Spalten erreichbar bleiben.
          function fahren(){
            if(!gezogen){ rollen=null; return; }
            const RAND=110, TEMPO=22;
            const k=kanban.getBoundingClientRect();
            if(zeigerX>k.right-RAND) kanban.scrollLeft+=TEMPO;
            else if(zeigerX<k.left+RAND) kanban.scrollLeft-=TEMPO;
            if(zeigerY>innerHeight-RAND) scrollBy(0,TEMPO);
            else if(zeigerY<RAND+60) scrollBy(0,-TEMPO);
            rollen=requestAnimationFrame(fahren);
          }
          document.addEventListener("dragover",ev=>{
            zeigerX=ev.clientX; zeigerY=ev.clientY;
            if(gezogen&&rollen===null) rollen=requestAnimationFrame(fahren);
          });

          // Vor welche Karte gehoert die gezogene? Entscheidet die Mitte der Nachbarn.
          function karteDavor(behaelter,y){
            return [...behaelter.querySelectorAll(".deal:not(.zieht)")].find(k=>{
              const r=k.getBoundingClientRect(); return y<r.top+r.height/2; })||null;
          }
          // Jede Spalte kennt ihre Stufen-Id je Bereich. Gibt es fuer den Bereich der
          // Karte keine, gehoert sie hier nicht hin.
          const stufeFuer=(sp,karte)=>{
            try{ return JSON.parse(sp.dataset.stufen||"{}")[karte.dataset.sparte]||null; }catch(_){ return null; }
          };
          function darfHierhin(sp){ return !gezogen||!!stufeFuer(sp,gezogen); }
          // Dringlichkeit gewinnt vor der Handreihenfolge: sehr dringend steht oben.
          // sort() ist stabil, die gezogene Stelle bleibt innerhalb ihrer Stufe erhalten.
          function nachDringlichkeit(behaelter){
            [...behaelter.querySelectorAll(".deal")]
              .sort((a,b)=>(+a.dataset.rang||9)-(+b.dataset.rang||9))
              .forEach(k=>behaelter.appendChild(k));
          }
          function aufraeumen(){
            document.querySelectorAll(".spalte").forEach(s=>s.classList.remove("ziel","gesperrt"));
          }
          // Leer-Hinweis und Zaehler nachziehen, damit die Spalten stimmig bleiben.
          function spaltenAuffrischen(){
            document.querySelectorAll(".spalte").forEach(sp=>{
              const b=sp.querySelector(".spalte-karten");
              const n=b.querySelectorAll(".deal").length;
              const zahl=sp.querySelector(".spalte-zahl"); if(zahl) zahl.textContent=n;
              const leer=b.querySelector(".spalte-leer");
              if(n&&leer) leer.remove();
              if(!n&&!leer){ const d=document.createElement("div"); d.className="spalte-leer";
                d.textContent="leer"; b.appendChild(d); }
            });
          }
          function zurueckAnDenPlatz(karte){
            if(!startSpalte) return;
            const b=startSpalte.querySelector(".spalte-karten");
            if(startDavor&&startDavor.parentElement===b) b.insertBefore(karte,startDavor);
            else b.appendChild(karte);
            spaltenAuffrischen();
          }
          // Reihenfolge einer Spalte sichern (0, 1, 2 … von oben nach unten).
          function reihenfolgeSichern(sp){
            const ids=[...sp.querySelectorAll(".deal")].map(k=>k.dataset.id);
            return fetch("/crm/karten/sortieren",{method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({art:ART,ids:ids})}).catch(()=>{});
          }

          // Dringlichkeit direkt auf der Karte. Der Klick darf weder die Akte oeffnen
          // noch ein Ziehen ausloesen — waehrend das Feld bedient wird, ist die Karte
          // darum kurz nicht ziehbar.
          const RANG={${Object.entries(DRINGLICHKEIT).map(([k, v]) => `${JSON.stringify(k)}:${v.rang}`).join(",")}};
          const FARBE={${Object.entries(DRINGLICHKEIT).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v.farbe)}`).join(",")}};
          document.querySelectorAll(".deal-dring").forEach(sel=>{
            const karte=sel.closest(".deal");
            sel.addEventListener("click",ev=>ev.stopPropagation());
            sel.addEventListener("mousedown",()=>{karte.draggable=false});
            sel.addEventListener("blur",()=>{karte.draggable=true});
            sel.addEventListener("change",async ev=>{
              ev.stopPropagation(); karte.draggable=true;
              const wert=sel.value;
              sel.className="deal-dring dr-"+(FARBE[wert]||"leer");
              karte.dataset.rang=RANG[wert]||9;
              nachDringlichkeit(karte.closest(".spalte-karten"));
              const spalte=karte.closest(".spalte");
              const r=await fetch("/crm/karte/dringlichkeit",{method:"POST",
                headers:{"Content-Type":"application/json"},
                body:JSON.stringify({firma:karte.dataset.firma,dringlichkeit:wert})})
                .then(r=>r.json()).catch(()=>({ok:false}));
              if(r.ok===false){ melden("Dringlichkeit konnte nicht gespeichert werden."); return; }
              await reihenfolgeSichern(spalte);
            });
          });

          document.querySelectorAll(".deal").forEach(k=>{
            k.addEventListener("dragstart",ev=>{
              gezogen=k; window.__zieht=true; abgelegt=false;
              startSpalte=k.closest(".spalte"); startDavor=k.nextElementSibling;
              if(ev.dataTransfer){ ev.dataTransfer.effectAllowed="move";
                try{ ev.dataTransfer.setData("text/plain",k.dataset.id); }catch(_){} }
              setTimeout(()=>k.classList.add("zieht"),0);
            });
            k.addEventListener("dragend",()=>{
              k.classList.remove("zieht"); aufraeumen();
              if(rollen!==null){ cancelAnimationFrame(rollen); rollen=null; }
              // Losgelassen, ohne in einer Spalte zu landen -> zurueck an den Platz.
              if(!abgelegt) zurueckAnDenPlatz(k);
              gezogen=null; setTimeout(()=>window.__zieht=false,60);
            });
          });

          document.querySelectorAll(".spalte").forEach(sp=>{
            const behaelter=sp.querySelector(".spalte-karten");
            sp.addEventListener("dragover",ev=>{
              ev.preventDefault();
              if(!gezogen) return;
              if(!darfHierhin(sp)){
                sp.classList.add("gesperrt"); sp.classList.remove("ziel");
                if(ev.dataTransfer) ev.dataTransfer.dropEffect="none";
                return;
              }
              if(ev.dataTransfer) ev.dataTransfer.dropEffect="move";
              sp.classList.add("ziel"); sp.classList.remove("gesperrt");
              // Schon beim Ziehen einsortieren — man sieht, wo die Karte landet.
              const davor=karteDavor(behaelter,ev.clientY);
              if(davor) behaelter.insertBefore(gezogen,davor);
              else if(gezogen.parentElement!==behaelter||gezogen.nextElementSibling) behaelter.appendChild(gezogen);
              const leer=behaelter.querySelector(".spalte-leer"); if(leer) leer.remove();
            });
            sp.addEventListener("dragleave",ev=>{
              if(!sp.contains(ev.relatedTarget)) sp.classList.remove("ziel","gesperrt");
            });
            sp.addEventListener("drop",async ev=>{
              ev.preventDefault(); aufraeumen();
              const karte=gezogen; if(!karte) return;
              const zielStufe=stufeFuer(sp,karte);
              if(!zielStufe){ zurueckAnDenPlatz(karte);
                karte.classList.add("abgelehnt"); setTimeout(()=>karte.classList.remove("abgelehnt"),1400);
                melden("Diese Phase gibt es im Bereich dieses Deals nicht."); return; }
              abgelegt=true;
              nachDringlichkeit(sp.querySelector(".spalte-karten"));
              spaltenAuffrischen();
              if(window.gsap) gsap.fromTo(karte,{scale:.96},{scale:1,duration:.25,ease:"back.out(2)"});

              // Gleiche Spalte -> nur die Reihenfolge hat sich geaendert.
              if(startSpalte===sp){ await reihenfolgeSichern(sp); return; }

              const ziel=ART==="projekt"?"/crm/projekt/verschieben":"/crm/deal/verschieben";
              const r=await fetch(ziel,{method:"POST",headers:{"Content-Type":"application/json"},
                body:JSON.stringify({deal:karte.dataset.id,stufe:zielStufe})})
                .then(r=>r.json()).catch(()=>({ok:false,fehler:"Netzwerkfehler"}));
              if(r.ok===false){
                zurueckAnDenPlatz(karte);
                karte.classList.add("abgelehnt"); setTimeout(()=>karte.classList.remove("abgelehnt"),1400);
                melden(r.fehler||"Verschieben nicht möglich.");
                return;
              }
              // Gewonnen oder verloren: der Deal ist zu und verschwindet vom Brett.
              if(r.geschlossen){ location.reload(); return; }
              await reihenfolgeSichern(sp);
            });
          });
        })();
        </script>`));
    } catch (err) { next(err); }
  });

  // Horizont-Auswahl (Nächste 30 Tage …) -> konkretes Datum (heute + N Tage),
  // damit die datumsbasierten Auswertungen unveraendert weiterrechnen koennen.
  const horizontZuDatum = (h) => {
    const tage = { "30": 30, "60": 60, "90": 90, "180": 180, "365": 365 }[String(h || "")];
    if (!tage) return null;
    const d = new Date(); d.setDate(d.getDate() + tage);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  app.post("/crm/deal/anlegen", async (req, res, next) => {
    try {
      await crm.dealAnlegen(req.nutzer, { ...req.body, wert: req.body.wert || null, erwartet_am: horizontZuDatum(req.body.erwartet_horizont) });
      res.redirect("/crm/pipeline?sparte=" + req.body.sparte);
    } catch (err) { next(err); }
  });

  // Reihenfolge einer Kanban-Spalte sichern. "ids" ist die Spalte von oben nach
  // unten, so wie sie nach dem Ziehen dasteht.
  app.post("/crm/karten/sortieren", async (req, res, next) => {
    try {
      const b = req.body || {};
      const r = await crm.kartenSortieren(req.nutzer, b.art === "projekt" ? "projekt" : "deal", b.ids);
      res.json(r);
    } catch (err) { next(err); }
  });

  // Dringlichkeit direkt von der Pipeline-Karte aus setzen — ohne Umweg ueber die
  // Akte. Sie haengt an der Firma, gilt also fuer Verkauf und Projektabwicklung.
  app.post("/crm/karte/dringlichkeit", async (req, res, next) => {
    try {
      const b = req.body || {};
      const wert = DRINGLICHKEIT[b.dringlichkeit] ? b.dringlichkeit : "";
      await crm.kundeAendern(req.nutzer, b.firma, { dringlichkeit: wert });
      res.json({ ok: true, rang: wert ? DRINGLICHKEIT[wert].rang : 9 });
    } catch (err) { next(err); }
  });

  // stufe = Stufen-Id. Auch im Gesamt-Board schickt die Karte eine echte Id: jede
  // Spalte kennt ihre Stufe je Bereich. stufeName bleibt als Rueckfalle bestehen.
  // Der Server prueft in jedem Fall, dass die Stufe zum Bereich der Karte gehoert.
  app.post("/crm/deal/verschieben", async (req, res) => {
    try {
      const r = await crm.dealVerschieben(req.nutzer, req.body.deal, req.body.stufe, req.body.stufeName);
      if (!r || r.ok === false) {
        return res.json({ ok: false, grund: r?.grund || "nicht-gefunden",
          fehler: r?.grund === "keine-stufe" ? "Diese Phase gibt es im Bereich dieses Deals nicht." : "Deal nicht gefunden." });
      }
      res.json(r);
    } catch (e) { res.json({ ok: false, fehler: e.message }); }
  });

  // Projekt auf eine andere Phase ziehen (Projektabwicklung)
  app.post("/crm/projekt/verschieben", async (req, res) => {
    try {
      const r = await crm.projektVerschieben(req.nutzer, req.body.deal, req.body.stufe, req.body.stufeName);
      if (!r || r.ok === false) {
        return res.json({ ok: false, grund: r?.grund || "nicht-gefunden",
          fehler: r?.grund === "keine-stufe" ? "Diese Phase gibt es im Bereich dieses Projekts nicht." : "Projekt nicht gefunden." });
      }
      res.json(r);
    } catch (e) { res.json({ ok: false, fehler: e.message }); }
  });

  // ================= TO-DOS =================
  const heuteISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  app.get("/crm/todos", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const [todos, firmen] = await Promise.all([crm.todoListe(u), crm.firmenListe(u, { limit: 300 })]);
      const heute = heuteISO();
      // Lokale Getter statt toISOString() — sonst rutscht das DATE-Feld in Zeitzonen
      // oestlich von UTC auf den Vortag (Gruppierung + Datums-Input wuerden falsch stehen).
      const lokalISO = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
      const offen = todos.filter((t) => !t.erledigt);
      const erledigt = todos.filter((t) => t.erledigt);
      const heuteGeplant = offen.filter((t) => t.geplant_am && lokalISO(t.geplant_am) === heute);
      const spaeter = offen.filter((t) => t.geplant_am && lokalISO(t.geplant_am) !== heute);
      const ohnePlan = offen.filter((t) => !t.geplant_am);

      const zeile = (t) => {
        const gepl = t.geplant_am ? lokalISO(t.geplant_am) : "";
        const faelligBadge = t.faellig
          ? `<span class="badge ${new Date(t.faellig) < new Date(heute) ? "b-rot" : "b-bernstein"}">bis ${datum(t.faellig)}</span>` : "";
        return `<div class="todo-zeile ${t.erledigt ? "todo-erledigt" : ""}">
          <form method="post" action="/crm/todo/erledigt" class="todo-check">
            <input type="hidden" name="id" value="${t.id}"><input type="hidden" name="erledigt" value="${t.erledigt ? "0" : "1"}">
            <button type="submit" class="todo-haken ${t.erledigt ? "an" : ""}" title="${t.erledigt ? "Wieder öffnen" : "Erledigt"}">${t.erledigt ? ICON.check : ""}</button>
          </form>
          <div class="todo-text">
            <div class="todo-titel">${e(t.titel)}</div>
            <div class="todo-meta">${t.firma_name ? `<a href="/crm/firma/${t.firma_id}">${ICON.kunden} ${e(t.firma_name)}</a>` : `<span class="caption">Allgemein</span>`} ${faelligBadge}</div>
          </div>
          <form method="post" action="/crm/todo/planen" class="todo-plan">
            <input type="hidden" name="id" value="${t.id}">
            <input type="date" name="geplant_am" value="${gepl}" onchange="this.form.submit()" title="Für welchen Tag einplanen">
          </form>
          <form method="post" action="/crm/todo/loeschen" onsubmit="return confirm('To-Do löschen?')">
            <input type="hidden" name="id" value="${t.id}">
            <button type="submit" class="still todo-weg" title="Löschen">${ICON.x}</button>
          </form>
        </div>`;
      };
      const block = (titel, liste, leer) => `<div class="karte" style="margin-bottom:16px">
        <div class="karte-kopf"><div><h2>${titel} ${liste.length ? `<span class="badge">${liste.length}</span>` : ""}</h2></div></div>
        ${liste.length ? liste.map(zeile).join("") : `<p class="caption">${leer}</p>`}</div>`;

      res.send(rahmen(u, "todos", "To-Dos", "Alle Aufgaben — kundengebunden oder allgemein. Weise sie einem Tag zu, dann erscheinen sie im Dashboard unter Heute zu tun.", "", `
        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div><h2>Neue Aufgabe</h2>
          <div class="sub">Freie Aufgabe (z. B. „TikTok erstellen") oder mit Kunde verknüpft</div></div></div>
          <form method="post" action="/crm/todo/anlegen">
            <div class="feld"><label>Aufgabe *</label><input name="titel" required placeholder="z. B. Angebot schicken · TikTok erstellen · Termin Steuerkanzlei" autofocus></div>
            <div class="feld-paar">
              <div class="feld"><label>Kunde (optional)</label><select name="firma_id">
                <option value="">— Allgemein, kein Kunde —</option>
                ${firmen.map((f) => `<option value="${f.id}">${e(f.name)}</option>`).join("")}</select></div>
              <div class="feld"><label>Fällig bis (optional)</label><input type="date" name="faellig"></div>
            </div>
            <div class="feld-paar">
              <div class="feld"><label>Geplant für (Tag)</label><input type="date" name="geplant_am" value="${heute}"></div>
              <div class="feld" style="display:flex;align-items:flex-end"><button type="submit" class="dunkel" style="width:100%;justify-content:center">${ICON.plus} Hinzufügen</button></div>
            </div>
          </form></div>
        ${block("Für heute geplant", heuteGeplant, "Nichts für heute eingeplant.")}
        ${block("Später geplant", spaeter, "Nichts für später geplant.")}
        ${block("Noch nicht eingeplant", ohnePlan, "Alles eingeplant. 🎉")}
        ${erledigt.length ? block("Erledigt", erledigt.slice(0, 20), "") : ""}`));
    } catch (err) { next(err); }
  });

  // Nach dem Speichern dorthin zurueck, wo man war (To-Do-Seite oder Kundenakte).
  const todoZiel = (req) => {
    const z = (req.body || {}).zurueck || "";
    // Nur eigene /crm-Adressen — Parameter sind erlaubt, damit die Herkunft
    // (?von=…) beim Zurueckspringen in die Akte erhalten bleibt.
    if (typeof z !== "string" || !z.startsWith("/crm") || /[<>"'\s]/.test(z)) return "/crm/todos";
    return z;
  };
  app.post("/crm/todo/anlegen", async (req, res, next) => {
    try { await crm.todoAnlegen(req.nutzer, req.body); res.redirect(todoZiel(req)); } catch (err) { next(err); }
  });
  app.post("/crm/todo/planen", async (req, res, next) => {
    try { await crm.todoPlanen(req.nutzer, req.body.id, req.body.geplant_am || null); res.redirect(todoZiel(req)); } catch (err) { next(err); }
  });
  app.post("/crm/todo/erledigt", async (req, res, next) => {
    try { await crm.todoErledigt(req.nutzer, req.body.id, req.body.erledigt === "1"); res.redirect(todoZiel(req)); } catch (err) { next(err); }
  });
  app.post("/crm/todo/loeschen", async (req, res, next) => {
    try { await crm.todoLoeschen(req.nutzer, req.body.id); res.redirect(todoZiel(req)); } catch (err) { next(err); }
  });

  // ================= KUNDEN =================
  app.get("/crm/kunden", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const { suche = "" } = req.query;
      // Leere Sparte = "Gesamt" (alle Sparten zusammen).
      const sparte = SPARTEN[req.query.sparte] ? req.query.sparte : "";
      const liste = KUNDEN_LISTEN[req.query.liste] ? req.query.liste : "alle";
      const score = SCORE_BEREICHE[req.query.score] ? req.query.score : "";
      const [alleFirmen, mitarbeiter, alleStufen] = await Promise.all([
        crm.firmenListe(u, { suche, limit: 300 }), crm.team(u), crm.stufen(u)]);

      const hatTag = (f, t) => (f.tags || []).includes(t);
      // Sparte: aus dem Deal, sonst aus dem Tag. Ohne beides zaehlt der Eintrag zu
      // Webdesign, damit nichts unsichtbar wird. Bei "Gesamt" faellt der Filter weg.
      const inSparte = (f) => !sparte || f.haupt_sparte === sparte || hatTag(f, sparte)
        || (sparte === "webdesign" && !f.haupt_sparte && !["webdesign", "performance", "ki"].some((s) => hatTag(f, s)));
      const inListe = (f) => {
        if (liste === "lead") return f.status === "lead" && Number(f.offene_deals) > 0;
        if (liste === "alle") return f.status === "kunde";
        if (liste === "einmal") return f.status === "kunde" && !hatTag(f, "retainer");
        if (liste === "retainer") return f.status === "kunde" && hatTag(f, "retainer");
        return f.status === "verloren";
      };
      const b = SCORE_BEREICHE[score];
      const imScore = (f) => !b || (Number(f.score) >= b.von && Number(f.score) <= b.bis);
      const firmen = alleFirmen.filter((f) => inSparte(f) && inListe(f) && (liste !== "lead" || imScore(f)));

      const q = (k, l) => "/crm/kunden?sparte=" + k + "&liste=" + l
        + (score && l === "lead" ? "&score=" + score : "")
        + (suche ? "&suche=" + encodeURIComponent(suche) : "");
      const istLead = liste === "lead";

      const zeilen = firmen.map((f) => `<tr onclick="location.href='/crm/firma/${f.id}'" style="cursor:pointer">
        <td><div class="zeile-titel">${e(f.name)}</div><div class="zeile-sub">${e(f.ort || "")}${f.branche ? " · " + e(f.branche) : ""}</div></td>
        ${istLead
          ? `<td>${f.stufe_name ? `<span class="badge b-blau">${e(f.stufe_name)}</span>` : `<span class="caption">—</span>`}</td>
             <td>${f.score ? `<span class="badge ${f.score >= 9 ? "b-gruen" : f.score >= 6 ? "b-bernstein" : "b-rot"}">${f.score}</span>` : "—"}</td>`
          : `<td><span class="badge ${f.status === "kunde" ? (hatTag(f, "retainer") ? "b-blau" : "b-gruen") : f.status === "verloren" ? "b-rot" : "b-blau"}">${
               f.status === "kunde" ? (hatTag(f, "retainer") ? "Retainer" : "Einmal") : f.status === "verloren" ? "Verloren" : "Lead"}</span></td>
             <td>${f.kunde_seit ? datum(f.kunde_seit) : f.verlust_grund ? `<span class="caption">${e(f.verlust_grund)}</span>` : "—"}</td>`}
        <td>${f.telefon ? `<a href="tel:${e(f.telefon)}" onclick="event.stopPropagation()">${e(f.telefon)}</a>` : "—"}</td>
        <td>${f.website ? `<a href="${e(f.website)}" target="_blank" onclick="event.stopPropagation()">Website ↗</a>` : "—"}</td>
        <td onclick="event.stopPropagation()">
          <select class="lead-branche verantwortlich-wahl" data-id="${f.id}" aria-label="Verantwortlich für ${e(f.name)}">
            ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === f.besitzer ? "selected" : ""}>${e(m.name)}</option>`).join("")}
          </select></td></tr>`).join("");

      const reiter = `<nav class="sparten-reiter">${
        [["", "Gesamt"], ...Object.entries(SPARTEN)]
          .map(([k, v]) => `<a href="${q(k, liste)}" class="${sparte === k ? "aktiv" : ""}">${e(v)}</a>`).join("")
      }</nav>`;
      const spartenName = sparte ? SPARTEN[sparte] : "Gesamt";

      // Zahlen oben rechts — bei "Lead" die Phasen im Vertrieb, sonst die Kundenarten.
      let zaehler, zaehlerTitel;
      if (istLead) {
        const leadsDerSparte = alleFirmen.filter((f) => f.status === "lead"
          && Number(f.offene_deals) > 0 && inSparte(f));
        // Phasen in der Reihenfolge der Pipeline sortieren, nicht alphabetisch.
        const reihenfolge = {};
        (alleStufen || []).filter((s) => s.art === "vertrieb").forEach((s) => {
          if (reihenfolge[s.name] === undefined || s.position < reihenfolge[s.name]) reihenfolge[s.name] = s.position;
        });
        const nachPhase = {};
        leadsDerSparte.forEach((f) => {
          const ph = f.stufe_name || "Ohne Phase";
          nachPhase[ph] = (nachPhase[ph] || 0) + 1;
        });
        // "Gewonnen" taucht hier nicht auf — daraus wird ein Kunde mit eigener Akte.
        zaehler = [{ titel: "Leads gesamt", n: leadsDerSparte.length, stark: true }].concat(
          Object.entries(nachPhase)
            .filter(([ph]) => !/gewonnen/i.test(ph))
            .sort((a, b2) => (reihenfolge[a[0]] ?? 99) - (reihenfolge[b2[0]] ?? 99))
            .map(([ph, n]) => ({ titel: ph, n })));
        zaehlerTitel = "Leads";
      } else {
        const kundenDerSparte = alleFirmen.filter((f) => f.status === "kunde" && inSparte(f));
        const zahlRetainer = kundenDerSparte.filter((f) => hatTag(f, "retainer")).length;
        zaehler = [
          { titel: "Kunden gesamt", n: kundenDerSparte.length, stark: true },
          { titel: "Einmal-Kunden", n: kundenDerSparte.length - zahlRetainer },
          { titel: "Retainer-Kunden", n: zahlRetainer },
        ];
        zaehlerTitel = "Kunden";
      }

      res.send(rahmen(u, "kunden", "Kunden", `${e(KUNDEN_LISTEN[liste])} · ${e(spartenName)}`, "", `
        <div class="lead-kopf">${reiter}
          <div class="kunden-zaehler">
            <div class="anruf-stat-kopf"><h2>${e(zaehlerTitel)}</h2><span class="caption">${e(spartenName)}</span></div>
            <div class="zaehler-reihe">
              ${zaehler.map((z) => `<div class="zaehler ${z.stark ? "stark" : ""}">
                <span class="zaehler-zahl">${z.n}</span>
                <span class="zaehler-titel">${e(z.titel)}</span></div>`).join("")}
            </div>
          </div>
        </div>
        <div class="lead-neu-leiste">
          <button type="button" class="dunkel" onclick="document.getElementById('neu').showModal()">${ICON.plus} Neuer Kunde</button>
        </div>
        <form class="filter" method="get">
          <input type="hidden" name="sparte" value="${e(sparte)}">
          <span class="such">${ICON.suche}<input type="search" name="suche" placeholder="Nach Name, Ort oder Telefon suchen …" value="${e(suche)}"></span>
          <select name="liste" class="knapp" onchange="this.form.submit()">
            ${Object.entries(KUNDEN_LISTEN).map(([k, v]) => `<option value="${k}" ${liste === k ? "selected" : ""}>${e(v)}</option>`).join("")}</select>
          ${istLead ? `<select name="score" class="knapp" onchange="this.form.submit()">
            <option value="">Alle Scores</option>
            ${Object.entries(SCORE_BEREICHE).map(([k, s]) => `<option value="${k}" ${score === k ? "selected" : ""}>${e(s.titel)}</option>`).join("")}</select>` : ""}
          <span class="filter-zahl">${firmen.length} ${firmen.length === 1 ? "Eintrag" : "Einträge"}</span>
        </form>
        ${firmen.length ? `<div class="tabelle-huelle"><table class="tabelle anruf-tabelle kunden-tabelle">
          <thead><tr><th>Firma</th>${istLead ? "<th>Stufe</th><th>Score</th>" : "<th>Status</th><th>Kunde seit</th>"}
            <th>Telefon</th><th>Website</th><th>Verantwortlich</th></tr></thead>
          <tbody>${zeilen}</tbody></table></div>
        <script>
        document.querySelectorAll('.verantwortlich-wahl').forEach(function(sel){
          sel.addEventListener('change',function(){
            var d=new FormData(); d.append('besitzer',sel.value);
            fetch('/crm/firma/'+sel.dataset.id+'/verantwortlich',{method:'POST',body:new URLSearchParams(d)})
              .then(function(r){ sel.classList.add(r.ok?'gesetzt':'fehler');
                setTimeout(function(){sel.classList.remove('gesetzt','fehler')},1200); })
              .catch(function(){ sel.classList.add('fehler');
                setTimeout(function(){sel.classList.remove('fehler')},1200); });
          });
        });
        </script>`
        : `<div class="karte leer"><div class="leer-icon">${ICON.kunden}</div><h3>${e(KUNDEN_LISTEN[liste])} · ${e(spartenName)}</h3>
           <p>${istLead
             ? "Hier stehen die Leads, die schon im Vertrieb sind — also einen offenen Deal haben (Erstgespräch, Angebot …). Sobald du in der Cold-Calling-Liste ein Erstgespräch buchst, erscheinen sie hier."
             : liste === "retainer" ? "Noch keine Retainer-Kunden — also Kunden mit laufender monatlicher Betreuung."
             : liste === "einmal" ? "Noch keine Einmal-Kunden — also Kunden aus einem einmaligen Projekt."
             : liste === "verloren" ? "Noch keine verlorenen Kunden."
             : "Noch keine Kunden."}${sparte ? " In dieser Sparte." : ""}</p></div>`}
        <dialog id="neu"><h2>Neuer Kunde</h2><div class="sub">Lead oder Kunde anlegen</div>
          <form method="post" action="/crm/kunden/anlegen">
            <div class="feld"><label>Firma / Praxis *</label><input name="name" required autofocus></div>
            <div class="feld-paar"><div class="feld"><label>Telefon</label><input name="telefon"></div>
              <div class="feld"><label>E-Mail</label><input type="email" name="email"></div></div>
            <div class="feld-paar"><div class="feld"><label>Ort</label><input name="ort"></div>
              <div class="feld"><label>Branche</label><input name="branche" placeholder="z. B. Physiotherapie"></div></div>
            <div class="feld"><label>Website</label><input name="website" placeholder="https://…"></div>
            <div class="feld-paar">
              <div class="feld"><label>Status</label><select name="status">
                <option value="lead">Lead</option><option value="kunde">Kunde</option></select></div>
              <div class="feld"><label>Verantwortlich</label><select name="besitzer">
                ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === u.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
            </div>
            <div class="feld"><label>Kauf-Wahrscheinlichkeit (optional, später einstellbar)</label><select name="score">
              <option value="">— noch nicht eingeschätzt —</option>
              ${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}">${n}/10 · ${n * 10} % Kaufwahrscheinlichkeit</option>`).join("")}</select></div>
            <div class="dialog-fuss"><button type="button" class="sekundaer" onclick="document.getElementById('neu').close()">Abbrechen</button>
              <button type="submit" class="dunkel">Kunden anlegen</button></div>
          </form></dialog>`));
    } catch (err) { next(err); }
  });

  app.post("/crm/kunden/anlegen", async (req, res, next) => {
    try { const r = await crm.firmaAnlegen(req.nutzer, req.body);
      res.redirect(`/crm/firma/${r.id}${r.dublette ? "?dublette=" + r.dublette.id : ""}`);
    } catch (err) { next(err); }
  });

  // ================= LEADS =================
  app.get("/crm/leads", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const { suche = "" } = req.query;
      // Drei Kategorien (Cold-Calling-Listen je Bereich). Standard = Webdesign.
      const sparte = SPARTEN[req.query.sparte] ? req.query.sparte : "webdesign";
      // Vier Unterlisten je Bereich — der Stand nach dem Anruf.
      const liste = LEAD_LISTEN[req.query.liste] ? req.query.liste : "offen";
      const branche = BRANCHEN[req.query.branche] ? req.query.branche : "";
      // Zuordnung Lead -> Bereich laeuft ueber ein Tag (webdesign|performance|ki), die
      // Unterliste ueber ein zweites Tag (offen|absage|nicht-erreicht|keine-zeit).
      // Leads kommen aus der Datenbank. Ein Lead traegt Tags: Sparte (webdesign|
      // performance|ki), Branche und — nach dem Anruf — sein Ergebnis. "Offene Leads"
      // sind die ohne Ergebnis-Tag.
      const alleLeads = await crm.firmenListe(u, { suche, limit: 300 });
      const hatTag = (f, t) => (f.tags || []).includes(t);
      const ergebnisTags = ["gebucht", "absage", "nicht-erreicht", "keine-zeit"];
      // Leads ohne Sparten-Tag zeigen wir in der Standard-Sparte, damit nichts unsichtbar wird.
      const inSparte = (f) => hatTag(f, sparte)
        || (sparte === "webdesign" && !["webdesign", "performance", "ki"].some((s) => hatTag(f, s)));
      const echte = alleLeads.filter((f) => inSparte(f)
        && (!branche || hatTag(f, branche))
        && (liste === "offen"
          ? f.status === "lead" && !ergebnisTags.some((t) => hatTag(f, t))
          : hatTag(f, liste)));
      const probeGefiltert = [];
      const anzahl = echte.length;

      // Anrufstatistik direkt aus den gespeicherten Anrufen.
      const stat = await crm.anrufStatistik(u, { sparte, branche, ohneSparte: sparte === "webdesign" });
      const holen = (k, feld) => (stat.nach[k] ? stat.nach[k][feld] : 0);
      const sGesamt = ["gebucht", "absage", "keine-zeit", "nicht-erreicht"].map((k) => holen(k, "gesamt"));
      const sHeute = ["gebucht", "absage", "keine-zeit", "nicht-erreicht"].map((k) => holen(k, "heute"));
      const tage = Math.max(1, stat.tage);
      // richtung: +1 = mehr ist besser, -1 = weniger ist besser, 0 = neutral.
      const statBlock = [
        { titel: "Calls", g: sGesamt.reduce((a, v) => a + v, 0), h: sHeute.reduce((a, v) => a + v, 0), k: "calls", richtung: 1 },
        { titel: "Erstgespräche", g: sGesamt[0], h: sHeute[0], k: "gebucht", richtung: 1 },
        { titel: "Absagen", g: sGesamt[1], h: sHeute[1], k: "absage", richtung: -1 },
        { titel: "Später nochmal", g: sGesamt[2], h: sHeute[2], k: "keine-zeit", richtung: 0 },
        { titel: "Nicht erreicht", g: sGesamt[3], h: sHeute[3], k: "nicht-erreicht", richtung: 0 },
      ].map((s) => {
        const schnitt = s.g / tage;
        const delta = schnitt >= 0.1 ? Math.round(((s.h - schnitt) / schnitt) * 100) : null;
        return { ...s, schnitt, delta };
      });
      const zahl1 = (n) => n.toFixed(1).replace(".", ",");
      const heuteDatum = new Date().toLocaleDateString("de-DE", { day: "numeric", month: "long" });

      const q = (k, l) => "/crm/leads?sparte=" + k + "&liste=" + l
        + (branche ? "&branche=" + branche : "")
        + (suche ? "&suche=" + encodeURIComponent(suche) : "");
      // Die Sparten-Reiter stehen nicht oben in der Leiste, sondern weiter unten
      // links neben der Anruf-Statistik (siehe .lead-kopf).
      const reiter = "";

      // Eine Zeile = ein Anruf. Ergebnis waehlen -> passendes Detailfeld erscheint
      // -> Haken bei "Absenden" schickt den Lead in die passende Liste.
      const zeile = (f) => {
        const bg = (f.tags || []).find((t) => BRANCHEN[t]) || f.bg || "";
        // Bisheriges Ergebnis wieder anzeigen, damit man es sehen und aendern kann.
        const stand = (f.tags || []).find((t) => ERGEBNISSE[t]) || "";
        const grundRoh = stand === "absage" ? (f.verlust_grund || "") : "";
        const grundGewaehlt = ABSAGE_GRUENDE.includes(grundRoh) ? grundRoh : (grundRoh ? "Anderer Grund" : "");
        const grundFrei = grundRoh && !ABSAGE_GRUENDE.includes(grundRoh) ? grundRoh : "";
        return `<tr class="anruf-zeile" data-name="${e(f.name)}" data-bg="${e(bg)}"${f.id ? ` data-id="${e(String(f.id))}"` : ""}${f.anruf_notiz ? ` data-gespraech="${e(f.anruf_notiz)}"` : ""}>
        <td><div class="zeile-titel">${e(f.name)}</div>
          <div class="zeile-sub zeile-ort">${e(f.ort || "—")}${f.branche ? " · " + e(f.branche) : ""}</div>
          <select class="lead-branche" aria-label="Branche von ${e(f.name)}">
            <option value="">Branche wählen …</option>
            ${Object.entries(BRANCHEN).map(([k, v]) => `<option value="${k}" ${bg === k ? "selected" : ""}>${e(v)}</option>`).join("")}
          </select></td>
        <td>${e(f.geschaeftsfuehrer || f.chef || "—")}</td>
        <td>${f.telefon ? `<a href="tel:${e(f.telefon)}">${e(f.telefon)}</a>` : "—"}</td>
        <td>${f.website ? `<a href="${e(f.website)}" target="_blank">Website ↗</a>` : `<span class="badge b-gruen">keine ✨</span>`}</td>
        <td><select class="anruf-ergebnis" aria-label="Ergebnis für ${e(f.name)}">
          <option value="">— offen —</option>
          ${Object.entries(ERGEBNISSE).map(([k, v]) => `<option value="${k}" ${stand === k ? "selected" : ""}>${e(v)}</option>`).join("")}
        </select></td>
        <td class="anruf-detail">
          <select class="anruf-grund" style="display:${stand === "absage" ? "" : "none"}" aria-label="Grund der Absage">
            <option value="">Grund wählen …</option>
            ${ABSAGE_GRUENDE.map((g) => `<option ${grundGewaehlt === g ? "selected" : ""}>${e(g)}</option>`).join("")}
          </select>
          <input class="anruf-grund-frei" style="display:${grundFrei ? "" : "none"}" placeholder="Anderer Grund …"
            aria-label="Anderer Grund" value="${e(grundFrei)}">
          <input class="anruf-notiz" style="display:${stand === "keine-zeit" ? "" : "none"}" placeholder="Notiz zum Anruf …"
            aria-label="Notiz" value="${e(stand === "keine-zeit" ? (f.anruf_notiz || "") : "")}">
          <button type="button" class="sekundaer klein anruf-akte" style="display:${stand === "gebucht" ? "" : "none"}"
            onclick="gespraechOeffnen(this)">${ICON.notiz} ${stand === "gebucht" && f.anruf_notiz ? "✓ Notiz vorhanden" : "Gesprächsnotiz"}</button>
          <span class="caption anruf-leer" style="display:${stand && stand !== "nicht-erreicht" ? "none" : ""}">${
            stand === "nicht-erreicht" ? `${f.versuche || 1}. Versuch` : "—"}</span>
        </td>
        <td class="rechts"><input type="checkbox" class="anruf-senden" aria-label="Absenden"></td></tr>`;
      };
      const zeilen = echte.length ? echte.map(zeile).join("") : probeGefiltert.map(zeile).join("");

      res.send(rahmen(u, "leads", "Leads", `Cold-Calling-Liste · ${e(SPARTEN[sparte])}`, reiter, `
        <div class="lead-kopf">
          <nav class="sparten-reiter">${
            Object.entries(SPARTEN).map(([k, v]) => `<a href="${q(k, liste)}" class="${sparte === k ? "aktiv" : ""}">${e(v)}</a>`).join("")
          }</nav>
          <div class="anruf-stat-karte">
            <div class="anruf-stat-kopf"><h2>Anrufe</h2>
              <span class="caption">${branche ? e(BRANCHEN[branche]) : "über alle Branchen"} · ${e(SPARTEN[sparte])}</span></div>
            <table class="anruf-stat-tab">
              <thead><tr><th></th>${statBlock.map((s) => `<th>${e(s.titel)}</th>`).join("")}</tr></thead>
              <tbody>
                <tr class="stat-allgemein"><th>Allgemein<span>Ø pro Tag</span></th>
                  ${statBlock.map((s) => `<td><b class="stat-zahl">${s.g}</b><span class="stat-schnitt">${zahl1(s.schnitt)}</span></td>`).join("")}</tr>
                <tr class="stat-heute"><th>Heute<span>${e(heuteDatum)}</span></th>
                  ${statBlock.map((s) => `<td data-metrik="${s.k}" data-schnitt="${s.schnitt}" data-richtung="${s.richtung}">
                    <b class="stat-zahl">${s.h}</b>
                    <span class="stat-delta ${s.delta === null || !s.richtung ? "neutral" : (s.delta * s.richtung) > 0 ? "auf" : (s.delta * s.richtung) < 0 ? "ab" : "neutral"}">${
                      s.delta === null ? "—" : (s.delta > 0 ? "+" : "") + s.delta + " %"}</span></td>`).join("")}</tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="lead-neu-leiste">
          <button type="button" class="dunkel" onclick="document.getElementById('lead-neu-dlg').showModal()">
            ${ICON.plus} Neuer Lead</button>
        </div>
        <form class="filter" method="get">
          <input type="hidden" name="sparte" value="${e(sparte)}">
          <span class="such">${ICON.suche}<input type="search" name="suche" placeholder="Suchen: Name, Ort, Telefon …" value="${e(suche)}"></span>
          <select name="liste" class="knapp" onchange="this.form.submit()">
            ${Object.entries(LEAD_LISTEN).map(([k, v]) => `<option value="${k}" ${liste === k ? "selected" : ""}>${e(v)}</option>`).join("")}
          </select>
          <select name="branche" class="knapp" onchange="this.form.submit()">
            <option value="">Alle Branchen</option>
            ${Object.entries(BRANCHEN).map(([k, v]) => `<option value="${k}" ${branche === k ? "selected" : ""}>${e(v)}</option>`).join("")}
          </select>
          <span class="filter-zahl">${anzahl} ${anzahl === 1 ? "Eintrag" : "Einträge"}</span></form>
        <dialog id="lead-neu-dlg" class="lead-neu-dialog">
          <div class="todo-dlg-kopf"><div><h2>Neuer Lead</h2>
            <div class="sub">Kommt in <b>${e(SPARTEN[sparte])}</b> → Offene Leads</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="lead-neu-wahl">
            <button type="button" class="aktiv" data-art="einzeln" onclick="leadArt('einzeln')">Einzelner Lead</button>
            <button type="button" data-art="liste" onclick="leadArt('liste')">Ganze Liste</button>
          </div>

          <div id="lead-einzeln">
            <div class="lead-neu-raster">
              <div><label>Firmenname *</label><input id="ln-name" placeholder="z. B. Physiotherapie Sonnenhof"></div>
              <div><label>Ortschaft</label><input id="ln-ort" placeholder="z. B. München"></div>
              <div><label>Berufsbezeichnung</label><input id="ln-beruf" placeholder="z. B. Physiotherapie"></div>
              <div><label>Branche</label><select id="ln-branche">
                <option value="">Branche wählen …</option>
                ${Object.entries(BRANCHEN).map(([k, v]) => `<option value="${k}" ${branche === k ? "selected" : ""}>${e(v)}</option>`).join("")}
              </select></div>
              <div><label>Geschäftsführer</label><input id="ln-chef" placeholder="z. B. Andrea Sonnleitner"></div>
              <div><label>Telefon</label><input id="ln-telefon" placeholder="+49 89 …"></div>
              <div class="voll"><label>Website</label><input id="ln-website" placeholder="https://… (leer lassen, wenn keine da ist)"></div>
            </div>
          </div>

          <div id="lead-liste" style="display:none">
            <label>Link zur Tabelle</label>
            <input id="ln-link" placeholder="https://docs.google.com/spreadsheets/…">
            <p class="sub" style="margin-top:8px">Google Sheets oder eine CSV-Datei. Bei Google Sheets muss die Freigabe
              auf <b>„Jeder mit dem Link"</b> stehen, sonst kommt der Server nicht heran.</p>
            <div class="lead-neu-spalten" style="margin-top:12px">Erkannte Spalten:
              Firma &nbsp;·&nbsp; Ort &nbsp;·&nbsp; Berufsbezeichnung &nbsp;·&nbsp; Geschäftsführer &nbsp;·&nbsp; Telefon &nbsp;·&nbsp; Website<br>
              <span style="font-weight:400">Die Kopfzeile wird automatisch gelesen — die Reihenfolge der Spalten ist egal.</span></div>

            <details class="lead-neu-alt">
              <summary>Kein Link? Zeilen direkt einfügen</summary>
              <p class="sub" style="margin:8px 0">Zeilen aus Excel oder Sheets kopieren und hier einfügen —
                eine Zeile je Lead, in der Reihenfolge oben.</p>
              <textarea id="ln-liste" rows="6" placeholder="Physiotherapie Sonnenhof	München	Physiotherapie	Andrea Sonnleitner	+49 89 4412088"></textarea>
            </details>

            <div><label style="margin-top:12px">Branche für alle</label><select id="ln-liste-branche">
              <option value="">Branche wählen … (kann später je Lead gesetzt werden)</option>
              ${Object.entries(BRANCHEN).map(([k, v]) => `<option value="${k}" ${branche === k ? "selected" : ""}>${e(v)}</option>`).join("")}
            </select></div>
          </div>

          <div class="lead-neu-hinweis" id="ln-hinweis"></div>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="button" class="dunkel" id="ln-speichern" onclick="leadSpeichern()">Hinzufügen</button></div>
        </dialog>
        <script>
        (function(){
          var art='einzeln';
          window.leadArt=function(a){
            art=a;
            document.getElementById('lead-einzeln').style.display=a==='einzeln'?'':'none';
            document.getElementById('lead-liste').style.display=a==='liste'?'':'none';
            document.querySelectorAll('.lead-neu-wahl button').forEach(function(b){
              b.classList.toggle('aktiv',b.dataset.art===a);});
          };
          window.leadSpeichern=function(){
            var h=document.getElementById('ln-hinweis'), k=document.getElementById('ln-speichern');
            var daten={sparte:${JSON.stringify(sparte)}};
            if(art==='liste'){
              daten.link=document.getElementById('ln-link').value.trim();
              daten.liste=document.getElementById('ln-liste').value;
              daten.branche=document.getElementById('ln-liste-branche').value;
              if(!daten.link && !daten.liste.trim()){
                h.className='lead-neu-hinweis fehler';
                h.textContent='Bitte den Link einfügen — oder die Zeilen direkt.'; return; }
            } else {
              daten.name=document.getElementById('ln-name').value;
              daten.ort=document.getElementById('ln-ort').value;
              daten.beruf=document.getElementById('ln-beruf').value;
              daten.branche=document.getElementById('ln-branche').value;
              daten.chef=document.getElementById('ln-chef').value;
              daten.telefon=document.getElementById('ln-telefon').value;
              daten.website=document.getElementById('ln-website').value;
              if(!daten.name.trim()){ h.className='lead-neu-hinweis fehler'; h.textContent='Der Firmenname fehlt.'; return; }
            }
            k.disabled=true; h.className='lead-neu-hinweis';
            h.textContent=daten.link?'Tabelle wird geladen …':'Wird gespeichert …';
            fetch('/crm/leads/neu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(daten)})
              .then(function(r){return r.json().then(function(j){if(!r.ok) throw new Error(j.fehler||'Fehler');return j;});})
              .then(function(j){
                h.className='lead-neu-hinweis erfolg';
                h.textContent=j.angelegt+(j.angelegt===1?' Lead angelegt':' Leads angelegt')
                  +(j.uebersprungen.length?' · '+j.uebersprungen.length+' schon vorhanden (übersprungen)':'');
                setTimeout(function(){location.reload();},900);
              })
              .catch(function(err){ k.disabled=false; h.className='lead-neu-hinweis fehler'; h.textContent=err.message; });
          };
        })();
        </script>
        ${anzahl ? `<div class="tabelle-huelle"><table class="tabelle anruf-tabelle">
          <thead><tr><th>Firma</th><th>Geschäftsführer</th><th>Telefon</th><th>Website</th>
            <th>Ergebnis</th><th>Detail</th><th class="rechts">Absenden</th></tr></thead>
          <tbody>${zeilen}</tbody></table></div>
        <dialog id="gespraech-dlg" class="todo-dialog">
          <div class="todo-dlg-kopf"><div><h2 id="gespraech-firma">Gesprächsnotiz</h2>
            <div class="sub">Was im Erstgespräch besprochen wurde</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <label>Termin</label><input id="gespraech-termin" type="datetime-local">
          <label style="margin-top:12px">Ansprechpartner</label><input id="gespraech-person" placeholder="Wer war im Gespräch?">
          <label style="margin-top:12px">Was wurde besprochen</label>
          <textarea id="gespraech-text" rows="5" placeholder="Bedarf, Budget, nächste Schritte …"></textarea>
          <div class="dialog-fuss"><button type="button" class="dunkel" onclick="gespraechSpeichern()">Übernehmen</button></div>
        </dialog>
        <script>
        (function(){
          var aktiveZeile=null;
          // true = wir sind in einer Ergebnis-Liste (Absagen/Nicht erreicht/Später),
          // dort zaehlt ein Wechsel keinen neuen Call, sondern verschiebt nur.
          var ISTLISTE=${liste !== "offen"};
          window.gespraechOeffnen=function(knopf){
            aktiveZeile=knopf.closest('tr');
            document.getElementById('gespraech-firma').textContent=aktiveZeile.dataset.name;
            document.getElementById('gespraech-dlg').showModal();
          };
          window.gespraechSpeichern=function(){
            if(aktiveZeile){
              var t=document.getElementById('gespraech-text').value.trim();
              var termin=document.getElementById('gespraech-termin').value;
              var person=document.getElementById('gespraech-person').value.trim();
              aktiveZeile.dataset.gespraech=[termin?'Termin '+termin:'',person,t].filter(Boolean).join(' · ');
              var k=aktiveZeile.querySelector('.anruf-akte');
              k.textContent=t||termin||person?'✓ Notiz übernommen':'Gesprächsnotiz';
            }
            document.getElementById('gespraech-dlg').close();
          };
          // Ergebnis waehlen -> passendes Detailfeld einblenden
          document.querySelectorAll('.anruf-ergebnis').forEach(function(sel){
            sel.addEventListener('change',function(){
              var td=sel.closest('tr').querySelector('.anruf-detail');
              var grund=td.querySelector('.anruf-grund'), frei=td.querySelector('.anruf-grund-frei');
              var notiz=td.querySelector('.anruf-notiz');
              var akte=td.querySelector('.anruf-akte'), leer=td.querySelector('.anruf-leer');
              [grund,frei,notiz,akte,leer].forEach(function(el){el.style.display='none'});
              if(sel.value==='absage') grund.style.display='';
              else if(sel.value==='keine-zeit') notiz.style.display='';
              else if(sel.value==='gebucht') akte.style.display='';
              else leer.style.display='';
            });
          });
          // "Anderer Grund" -> Freitextfeld darunter einblenden
          document.querySelectorAll('.anruf-grund').forEach(function(sel){
            sel.addEventListener('change',function(){
              var frei=sel.closest('td').querySelector('.anruf-grund-frei');
              if(sel.value==='Anderer Grund'){ frei.style.display=''; frei.focus(); }
              else { frei.style.display='none'; frei.value=''; }
            });
          });
          // Branche eines Leads nachtraeglich setzen — bei echten Leads sofort speichern.
          document.querySelectorAll('.lead-branche').forEach(function(sel){
            sel.addEventListener('change',function(){
              var tr=sel.closest('tr');
              tr.dataset.bg=sel.value;
              var id=tr.dataset.id;
              if(id){
                fetch('/crm/lead/'+id+'/branche',{method:'POST',headers:{'Content-Type':'application/json'},
                  body:JSON.stringify({branche:sel.value})})
                  .then(function(r){ sel.classList.add(r.ok?'gesetzt':'fehler');
                    setTimeout(function(){sel.classList.remove('gesetzt','fehler')},1200); })
                  .catch(function(){ sel.classList.add('fehler');
                    setTimeout(function(){sel.classList.remove('fehler')},1200); });
              } else {
                sel.classList.add('gesetzt');
                setTimeout(function(){sel.classList.remove('gesetzt')},900);
              }
            });
          });
          // Statistik live mitzaehlen: Heute-Zeile hoch, Prozent gegen den Tagesschnitt neu.
          function statHoch(schluessel){
            ['calls',schluessel].forEach(function(k){
              var td=document.querySelector('.stat-heute td[data-metrik="'+k+'"]');
              if(!td) return;
              var z=td.querySelector('.stat-zahl'), d=td.querySelector('.stat-delta');
              var neu=(parseInt(z.textContent,10)||0)+1;
              z.textContent=neu;
              var schnitt=parseFloat(td.dataset.schnitt)||0, richtung=parseInt(td.dataset.richtung,10)||0;
              d.className='stat-delta neutral';
              if(schnitt>=0.1){
                var p=Math.round(((neu-schnitt)/schnitt)*100);
                d.textContent=(p>0?'+':'')+p+' %';
                var gut=p*richtung;
                d.className='stat-delta '+(!richtung?'neutral':gut>0?'auf':gut<0?'ab':'neutral');
              } else d.textContent='—';
              td.classList.add('puls'); setTimeout(function(){td.classList.remove('puls')},600);
            });
          }
          // Erstgespraech gebucht: Aufforderung, gleich die Leadakte zu fuellen.
          // Bleibt stehen, bis man sie wegklickt — der Termin darf nicht untergehen.
          function akteHinweis(name,id){
            var alt=document.getElementById('akte-ruf'); if(alt) alt.remove();
            var box=document.createElement('div');
            box.className='akte-ruf'; box.id='akte-ruf';
            box.innerHTML='<div class="akte-ruf-text"><b>Leadakte anlegen</b>'
              +'<span>'+name.replace(/[<>&]/g,'')+' — trag jetzt das Datum des Erstgesprächs ein, '
              +'dann steht es auf der Pipeline-Karte.</span></div>'
              +'<div class="akte-ruf-knoepfe">'
              +'<a class="knopf dunkel" href="/crm/firma/'+id+'?von=' + encodeURIComponent(location.pathname+location.search) + '">Zur Leadakte</a>'
              +'<button type="button" class="still" aria-label="Schließen">✕</button></div>';
            box.querySelector('button').onclick=function(){ box.remove(); };
            document.body.appendChild(box);
            requestAnimationFrame(function(){ box.classList.add('sichtbar'); });
          }
          // Haken -> Anruf speichern, Lead wandert in die passende Liste
          document.querySelectorAll('.anruf-senden').forEach(function(box){
            box.addEventListener('change',function(){
              var tr=box.closest('tr'), sel=tr.querySelector('.anruf-ergebnis');
              if(!box.checked) return;
              // In der Liste "Offene Leads" ist ein Ergebnis Pflicht; in den anderen
              // Listen darf man auch auf "offen" zuruecksetzen.
              if(!sel.value && !ISTLISTE){ box.checked=false; sel.focus(); sel.style.borderColor='var(--danger)';
                setTimeout(function(){sel.style.borderColor=''},1200); return; }
              var td=tr.querySelector('.anruf-detail');
              var grundSel=td.querySelector('.anruf-grund'), grundFrei=td.querySelector('.anruf-grund-frei');
              var grund=grundSel.value==='Anderer Grund'?(grundFrei.value.trim()||'Anderer Grund'):grundSel.value;
              var daten={ergebnis:sel.value,grund:grund,notiz:td.querySelector('.anruf-notiz').value.trim(),
                gespraech:tr.dataset.gespraech||''};
              var id=tr.dataset.id;
              box.disabled=true;
              function raus(){
                // Nur ein neu bearbeiteter Lead zaehlt als Call. Wer ein bestehendes
                // Ergebnis nur korrigiert, erzeugt keinen zusaetzlichen Anruf.
                if(!ISTLISTE) statHoch(sel.value);
                tr.style.transition='opacity .4s,transform .4s';
                tr.style.opacity='0'; tr.style.transform='translateX(24px)';
                setTimeout(function(){
                  tr.remove();
                  var rest=document.querySelectorAll('.anruf-zeile').length;
                  var z=document.querySelector('.filter-zahl');
                  if(z) z.textContent=rest+(rest===1?' Eintrag':' Einträge');
                },400);
              }
              if(!id){ raus(); return; }
              fetch('/crm/lead/'+id+'/anruf',{method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify(daten)})
                .then(function(r){ if(!r.ok) throw new Error('Speichern fehlgeschlagen'); return r.json(); })
                .then(function(a){ raus();
                  // Erstgespraech gebucht -> sofort zur Leadakte, dort wird das
                  // Gespraechsdatum eingetragen. Ohne das steht die Karte spaeter
                  // ohne Termin in der Pipeline.
                  if(sel.value==='gebucht'&&a&&a.dealId) akteHinweis(tr.dataset.name||'Der Lead',id); })
                .catch(function(){
                  box.checked=false; box.disabled=false;
                  sel.style.borderColor='var(--danger)';
                  setTimeout(function(){sel.style.borderColor=''},2000);
                  alert('Der Anruf konnte nicht gespeichert werden. Bitte nochmal versuchen.');
                });
            });
          });
        })();
        </script>`
        : `<div class="karte leer"><div class="leer-icon">${ICON.leads}</div><h3>${e(LEAD_LISTEN[liste])} · ${e(SPARTEN[sparte])}</h3>
           <p>${liste === "offen"
             ? `Hier kommt die Cold-Calling-Liste für ${e(SPARTEN[sparte])} rein. Sobald die Liste importiert ist, erscheinen die Kontakte hier zum Abtelefonieren.`
             : `Noch keine Einträge. Sobald du beim Anruf „${e(LEAD_LISTEN[liste])}" auswählst, landet der Kontakt hier.`}</p></div>`}`));
    } catch (err) { next(err); }
  });

  // Neue Leads anlegen — einzeln oder als ganze Liste.
  // Die Liste wird aus Excel/Google Sheets kopiert und hier eingefuegt: eine Zeile
  // je Lead, Spalten getrennt durch Tab (direktes Einfuegen), Semikolon oder Komma.
  // Reihenfolge: Firma | Ort | Berufsbezeichnung | Geschäftsführer | Telefon | Website
  app.post("/crm/leads/neu", async (req, res, next) => {
    try {
      const b = req.body || {};
      const sparte = SPARTEN[b.sparte] ? b.sparte : "webdesign";
      const branche = BRANCHEN[b.branche] ? b.branche : "";
      let leads = [];
      if (b.link) {
        // Tabelle direkt vom Link holen (Google Sheets oder CSV).
        try { leads = await tabelleHolen(b.link); }
        catch (fehler) { return res.status(400).json({ ok: false, fehler: fehler.message }); }
        if (!leads.length) return res.status(400).json({ ok: false, fehler: "In der Tabelle stehen keine Firmennamen." });
      } else if (b.liste) {
        leads = String(b.liste).split(/\r?\n/).map((z) => z.trim()).filter(Boolean).map((z) => {
          const s = z.includes("\t") ? z.split("\t") : z.includes(";") ? z.split(";") : z.split(",");
          const [name, ort, beruf, chef, telefon, website] = s.map((x) => (x || "").trim());
          return { name, ort, branche: beruf, chef, telefon, website };
        }).filter((l) => l.name);
        // Kopfzeile aus der Tabelle ignorieren
        if (leads.length && /^(firma|name|unternehmen)$/i.test(leads[0].name)) leads.shift();
      } else {
        leads = [{ name: b.name, ort: b.ort, branche: b.beruf, chef: b.chef, telefon: b.telefon, website: b.website }];
      }
      if (!leads.length || !leads[0].name) {
        return res.status(400).json({ ok: false, fehler: "Kein Firmenname angegeben" });
      }
      const r = await crm.leadsAnlegen(req.nutzer, leads, { sparte, branche });
      res.json({ ok: true, ...r });
    } catch (err) { next(err); }
  });

  // Ergebnis eines Cold Calls speichern. Der Lead wandert in die passende Liste;
  // bei "gebucht" entsteht zusaetzlich der Deal in der Pipeline (Stufe Erstgespräch).
  app.post("/crm/lead/:id/anruf", async (req, res, next) => {
    try {
      const { ergebnis, grund = "", notiz = "", gespraech = "" } = req.body || {};
      // "" setzt den Lead zurueck auf offen (falls man sich verklickt hat).
      if (!["", "gebucht", "absage", "nicht-erreicht", "keine-zeit"].includes(ergebnis)) {
        return res.status(400).json({ ok: false, fehler: "Unbekanntes Ergebnis" });
      }
      const ergebnisNotiz = [notiz, gespraech].filter(Boolean).join(" · ");
      const r = await crm.anrufSpeichern(req.nutzer, req.params.id, ergebnis, { grund, notiz: ergebnisNotiz });
      if (!r.ok) return res.status(404).json({ ok: false, fehler: "Lead nicht gefunden" });
      res.json(r);
    } catch (err) { next(err); }
  });

  // Kundendaten speichern (Preise, Leistungen, Kanäle, Quelle, Verantwortlich)
  app.post("/crm/firma/:id/kunde", async (req, res, next) => {
    try {
      const b = req.body || {};
      const mehrfach = (wert, erlaubt) => (Array.isArray(wert) ? wert : wert ? [wert] : []).filter((x) => erlaubt.includes(x));
      // Die Akte hat mehrere Formulare auf diesen Endpunkt. "abschnitt" sagt, welches
      // gespeichert wird — sonst wuerden die Felder der anderen Abschnitte geleert.
      const daten = {};
      if (b.abschnitt === "bereich") {
        // Nur der Bereich — die Stammdaten bleiben unberührt.
        if (b.sparte) daten.sparte = b.sparte;
      } else if (b.abschnitt === "stammdaten") {
        daten.quelle = QUELLEN.includes(b.quelle) ? b.quelle : "";
        if (b.besitzer) daten.besitzer = b.besitzer;
        daten.ansprech_name = b.ansprech_name || "";
        daten.ansprech_rolle = ANSPRECH_ROLLEN.includes(b.ansprech_rolle) ? b.ansprech_rolle : "";
        daten.geschlecht = ["m", "w", "d"].includes(b.geschlecht) ? b.geschlecht : "";
      } else if (b.abschnitt === "kontakt") {
        daten.telefon = b.telefon || "";
        daten.email = b.email || "";
        daten.website = b.website || "";
        daten.ort = b.ort || "";
      } else if (b.abschnitt === "stand") {
        daten.projekt_stand = PROJEKT_STAende[b.projekt_stand] ? b.projekt_stand : "";
        daten.rechnung_stand = RECHNUNG_STAende[b.rechnung_stand] ? b.rechnung_stand : "";
        daten.vertrag_unterschrieben = b.vertrag_unterschrieben;
      } else if (b.abschnitt === "firma") {
        daten.taetigkeit = b.taetigkeit || "";
        daten.mitarbeiter_zahl = b.mitarbeiter_zahl;
      } else if (b.abschnitt === "auftrag") {
        daten.preis_setup = b.preis_setup;
        daten.preis_monatlich = b.preis_monatlich;
        daten.kunde_seit = b.kunde_seit;
        daten.vertrag_laufzeit = LAUFZEITEN.includes(b.vertrag_laufzeit) ? b.vertrag_laufzeit : "";
        daten.erfolgsbonus = b.erfolgsbonus;
        daten.erfolgsbonus_text = b.erfolgsbonus === "ja" ? (b.erfolgsbonus_text || "") : "";
        if (b.hosting !== undefined) daten.hosting = b.hosting;
        if (b.leads_ziel !== undefined) daten.leads_ziel = b.leads_ziel;
        if (b.leads_ist !== undefined) daten.leads_ist = b.leads_ist;
      } else if (b.abschnitt === "termine") {
        daten.dringlichkeit = DRINGLICHKEIT[b.dringlichkeit] ? b.dringlichkeit : "";
        daten.erstgespraech_am = b.erstgespraech_am || "";
        daten.faellig_am = b.faellig_am || "";
        daten.naechster_termin = b.naechster_termin || "";
        daten.naechste_aufgabe = b.naechste_aufgabe || "";
      } else if (b.abschnitt === "leistungen") {
        daten.leistungen = mehrfach(b.leistungen, LEISTUNGEN);
        daten.kontakt_kanaele = mehrfach(b.kontakt_kanaele, KONTAKT_KANAELE);
      }
      await crm.kundeAendern(req.nutzer, req.params.id, daten);
      res.redirect(mitHerkunft(`/crm/firma/${req.params.id}`, (req.query || {}).von));
    } catch (err) { next(err); }
  });

  // Leadakte anlegen — Lead startet im Vertrieb auf Stufe "Neu"
  app.post("/crm/firma/:id/leadakte", async (req, res, next) => {
    try {
      await crm.leadakteAnlegen(req.nutzer, req.params.id, (req.body || {}).sparte);
      res.redirect(mitHerkunft(`/crm/firma/${req.params.id}`, (req.query || {}).von));
    } catch (err) { next(err); }
  });

  // Aus einem Lead einen Kunden machen
  app.post("/crm/firma/:id/zu-kunde", async (req, res, next) => {
    try {
      await crm.zuKundeMachen(req.nutzer, req.params.id, (req.body || {}).kunde_seit);
      res.redirect(mitHerkunft(`/crm/firma/${req.params.id}`, (req.query || {}).von));
    } catch (err) { next(err); }
  });

  // Was wir umgesetzt haben — Eintrag ergänzen oder entfernen
  app.post("/crm/firma/:id/umgesetzt", async (req, res, next) => {
    try {
      const b = req.body || {};
      await crm.umgesetztAendern(req.nutzer, req.params.id, { hinzu: b.hinzu || "", weg: b.weg || "" });
      res.redirect(mitHerkunft(`/crm/firma/${req.params.id}`, (req.query || {}).von));
    } catch (err) { next(err); }
  });

  // Verantwortlichen direkt aus der Kundenliste heraus wechseln
  app.post("/crm/firma/:id/verantwortlich", async (req, res, next) => {
    try {
      await crm.kundeAendern(req.nutzer, req.params.id, { besitzer: (req.body || {}).besitzer });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Branche eines Leads setzen (aus der Cold-Calling-Liste heraus)
  app.post("/crm/lead/:id/branche", async (req, res, next) => {
    try {
      const wunsch = req.body && req.body.branche;
      const branche = BRANCHEN[wunsch] ? wunsch : "";
      await crm.leadBranche(req.nutzer, req.params.id, branche, Object.keys(BRANCHEN));
      res.json({ ok: true, branche });
    } catch (err) { next(err); }
  });

  // ================= FIRMA / KUNDENAKTE =================
  app.get("/crm/firma/:id", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const f = await crm.firma(u, req.params.id);
      if (!f) return res.status(404).send(rahmen(u, "kunden", "Nicht gefunden", "", "",
        `<div class="karte leer"><h3>Nicht gefunden</h3><p>Dieser Eintrag existiert nicht oder gehört jemand anderem.</p></div>`));
      const mitarbeiter = await crm.team(u);
      // Ab dem Moment, wo jemand Kunde ist, zaehlen andere Dinge: Preise, Leistungen,
      // Kontaktwege und offene Aufgaben — statt Score und Anruf-Ergebnis.
      const istKunde = f.status === "kunde";
      const istRetainer = (f.tags || []).includes("retainer");
      // Bereich des Kunden: aus dem Tag, sonst aus dem juengsten Deal, sonst Webdesign.
      // Davon haengt ab, welche Leistungen zur Auswahl stehen.
      const kundenSparte = (f.tags || []).find((t) => SPARTEN[t])
        || (f.deals || [])[0]?.sparte || "webdesign";
      const leistungenAuswahl = LEISTUNGEN_JE_SPARTE[kundenSparte] || LEISTUNGEN_JE_SPARTE.webdesign;
      // Deal gewonnen, aber noch kein Kunde -> deutlicher Hinweis, die Akte anzulegen.
      const gewonnen = !istKunde && (f.deals || []).some((d) => d.status === "gewonnen");
      // Ohne Deal steht der Lead noch nicht im Vertrieb — dann bieten wir an,
      // die Leadakte anzulegen (Deal auf Stufe "Neu", 10 % Wahrscheinlichkeit).
      const hatDeal = (f.deals || []).length > 0;
      // Woher kam man? Dorthin fuehrt "Zurück zur Übersicht" — und dorthin kehren
      // auch die Formulare zurueck, damit der Weg beim Speichern nicht verloren geht.
      const zurueck = herkunft(req, istKunde ? "/crm/kunden" : "/crm/leads");
      const akteUrl = mitHerkunft(`/crm/firma/${f.id}`, zurueck);

      // To-Dos stehen als schmale Karte in der Spalte — so muss man nicht scrollen.
      const offeneTodos = (f.aufgaben || []).filter((t) => !t.erledigt).length;
      const todoKarte = `<div class="karte"><div class="karte-kopf"><div><h2>To-Dos ${
        offeneTodos ? `<span class="badge">${offeneTodos}</span>` : ""}</h2>
        <div class="sub">Was für diesen Kunden ansteht</div></div>
        <a href="/crm/todos" class="caption">Alle →</a></div>
        ${(f.aufgaben || []).length ? `<div class="akte-todos">${f.aufgaben.map((t) => `
          <div class="akte-todo ${t.erledigt ? "fertig" : ""}">
            <form method="post" action="/crm/todo/erledigt">
              <input type="hidden" name="id" value="${t.id}"><input type="hidden" name="erledigt" value="${t.erledigt ? "0" : "1"}">
              <input type="hidden" name="zurueck" value="${akteUrl}">
              <button type="submit" class="todo-haken ${t.erledigt ? "an" : ""}" title="${t.erledigt ? "Wieder öffnen" : "Erledigt"}">${t.erledigt ? ICON.check : ""}</button>
            </form>
            <span class="akte-todo-text">${e(t.titel)}</span>
            ${t.faellig ? `<span class="badge ${new Date(t.faellig) <= new Date() && !t.erledigt ? "b-rot" : "b-bernstein"}"
              title="Muss bis dahin fertig sein">bis ${datum(t.faellig)}</span>` : ""}
          </div>`).join("")}</div>` : `<p class="caption">Noch nichts offen.</p>`}
        <form method="post" action="/crm/todo/anlegen" class="akte-todo-neu">
          <input type="hidden" name="firma_id" value="${f.id}">
          <input type="hidden" name="zurueck" value="${akteUrl}">
          <input name="titel" required placeholder="Neue Aufgabe — z. B. Webseite live stellen">
          <select name="wichtigkeit" title="Wichtigkeit">
            <option value="1">Sehr wichtig</option><option value="2">Wichtig</option>
            <option value="3" selected>Sollte erledigt werden</option><option value="4">Kann warten</option>
          </select>
          <select name="dringlichkeit" title="Dringlichkeit">
            <option value="Extrem dringend">Extrem dringend</option><option value="Dringend">Dringend</option>
            <option value="ASAP">ASAP</option><option value="Bald" selected>Bald</option>
            <option value="Wenn Zeit da ist">Wenn Zeit da ist</option>
          </select>
          <label class="akte-todo-datum">Zeigen am
            <input type="date" name="geplant_am" value="${heuteFeld()}" title="An welchem Tag es im Dashboard auftaucht"></label>
          <label class="akte-todo-datum">Fertig bis
            <input type="date" name="faellig" title="Bis wann es erledigt sein muss"></label>
          <button type="submit" class="dunkel">${ICON.plus}</button>
        </form>
        <p class="caption" style="margin-top:8px"><b>Zeigen am</b> bestimmt, an welchem Tag die Aufgabe im Dashboard
          unter „Heute zu tun" auftaucht. <b>Fertig bis</b> ist die Frist — sie steht hier und auf der To-Do-Liste.</p></div>`;

      res.send(rahmen(u, istKunde ? "kunden" : "leads", istKunde ? "Kundenakte" : "Lead-Akte", "", "", `
        <a class="akte-zurueck" href="${zurueck}">${ICON.pfeilLinks} Zurück zur Übersicht</a>
        <div class="seiten-kopf akte-kopf">
          <div class="akte-titel">
            ${avatarBild(f.geschlecht)}
            <div><h1>${e(f.name)}</h1>
              <p>${f.geschaeftsfuehrer ? `<span class="akte-person">${e(f.geschaeftsfuehrer)}${f.ansprech_rolle ? ` · ${e(f.ansprech_rolle)}` : ""}</span>` : `<span class="caption">Ansprechperson noch offen</span>`}
              ${f.branche ? ` · ${e(f.branche)}` : ""}</p>
              <p style="margin-top:7px">
                <span class="badge ${istKunde ? (istRetainer ? "b-blau" : "b-gruen") : f.status === "verloren" ? "b-rot" : "b-blau"}">${
                  istKunde ? (istRetainer ? "Retainer-Kunde" : "Einmal-Kunde") : f.status === "verloren" ? "Verloren" : "Lead"}</span>
                ${!istKunde && f.score ? ` <span class="badge ${f.score >= 7 ? "b-gruen" : f.score >= 4 ? "b-bernstein" : "b-rot"}">Score ${f.score}</span>` : ""}
                ${istKunde && Number(f.preis_monatlich) > 0 ? ` <span class="badge b-gruen">${geld(f.preis_monatlich)} / Monat</span>` : ""}
                ${istKunde && Number(f.preis_setup) > 0 ? ` <span class="badge b-bernstein">${geld(f.preis_setup)} Setup</span>` : ""}
              </p></div>
          </div>
          <div class="akte-kopf-rechts">
            ${(istKunde || hatDeal) ? `<form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/kunde`, zurueck)}" class="akte-bereich">
              <input type="hidden" name="abschnitt" value="bereich">
              <label>Bereich</label>
              <select name="sparte" onchange="this.form.submit()">
                ${Object.entries(SPARTEN).map(([k, v]) => `<option value="${k}" ${kundenSparte === k ? "selected" : ""}>${e(v)}</option>`).join("")}
              </select></form>` : ""}
            ${f.telefon ? `<a class="knopf sekundaer" href="tel:${e(f.telefon)}">${ICON.telefon} Anrufen</a>` : ""}
          </div>
        </div>
        ${!istKunde && !hatDeal ? `<div class="akte-hinweis stark">
          <div>
            <b>Neue Leadakte anlegen</b>
            <span class="caption">Dieser Lead steht noch nicht im Vertrieb. Leg die Leadakte an — er startet dann
              in der Pipeline bei „Neu" (10 % Wahrscheinlichkeit) und taucht unter Kunden → Lead auf.</span>
          </div>
          <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/leadakte`, zurueck)}">
            <select name="sparte">
              ${Object.entries(SPARTEN).map(([k, v]) => `<option value="${k}" ${kundenSparte === k ? "selected" : ""}>${e(v)}</option>`).join("")}
            </select>
            <button type="submit" class="dunkel">${ICON.plus} Leadakte anlegen</button>
          </form>
        </div>` : ""}
        ${!istKunde && hatDeal ? `<div class="akte-hinweis ${gewonnen ? "stark" : ""}">
          <div>
            <b>${gewonnen ? "Deal gewonnen — jetzt Kundenakte anlegen" : "Aus diesem Lead einen Kunden machen"}</b>
            <span class="caption">${gewonnen
              ? "Der Deal steht auf gewonnen. Leg die Kundenakte an, dann kannst du Laufzeit, Leistungen und Zahlungsstand pflegen."
              : "Sobald der Lead abgeschlossen ist, legst du hier die Kundenakte an."}</span>
          </div>
          <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/zu-kunde`, zurueck)}">
            <input type="date" name="kunde_seit" value="${heuteFeld()}" title="Kunde seit">
            <button type="submit" class="dunkel">${ICON.check} Kundenakte anlegen</button>
          </form>
        </div>` : ""}
        ${req.query.dublette ? `<div class="hinweis warn" style="margin-bottom:16px">${ICON.warnung}<div>Es gibt bereits einen ähnlichen Eintrag —
          <a href="/crm/firma/${e(req.query.dublette)}">hier ansehen</a>. Prüfe, ob das eine Dublette ist.</div></div>` : ""}
        <div class="akte-oben">
          <div class="akte-unten">
            <div class="karte"><div class="karte-kopf"><h2>Verlauf</h2></div>
              ${f.historie.map((h) => `<div class="feed-eintrag">
                <div class="feed-icon ${h.art === "anruf" ? "blau" : h.art === "stufenwechsel" ? "gruen" : ""}">${h.art === "anruf" ? ICON.telefon : h.art === "stufenwechsel" ? ICON.trend : ICON.notiz}</div>
                <div><div class="feed-text">${e(h.text)}</div><div class="feed-zeit">${zeit(h.zeit)}${h.wer_name ? " · " + e(h.wer_name) : ""}</div></div></div>`).join("")}
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/notiz`, zurueck)}" style="display:flex;gap:8px;margin-top:14px">
                <input name="text" placeholder="Notiz hinzufügen …" required><button type="submit">Speichern</button></form></div>
          </div>
          <div class="akte-spalten"><div class="akte-spalte">
            <div class="karte"><div class="karte-kopf"><h2>Stammdaten</h2></div>
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/kunde`, zurueck)}" class="akte-form akte-form-oben">
                <input type="hidden" name="abschnitt" value="stammdaten">
                <div class="feld"><label>Ansprechperson</label>
                  <input name="ansprech_name" value="${e(f.geschaeftsfuehrer || "")}" placeholder="z. B. Anna Weber"></div>
                <div class="feld-paar">
                  <div class="feld"><label>Position</label><select name="ansprech_rolle">
                    <option value="">— offen —</option>
                    ${ANSPRECH_ROLLEN.map((r) => `<option ${f.ansprech_rolle === r ? "selected" : ""}>${e(r)}</option>`).join("")}</select></div>
                  <div class="feld"><label>Anrede</label><select name="geschlecht">
                    <option value="">— offen —</option>
                    <option value="w" ${f.geschlecht === "w" ? "selected" : ""}>Frau</option>
                    <option value="m" ${f.geschlecht === "m" ? "selected" : ""}>Herr</option>
                    <option value="d" ${f.geschlecht === "d" ? "selected" : ""}>Divers</option></select></div>
                </div>
                <div class="feld"><label>Quelle</label><select name="quelle">
                  <option value="">— unbekannt —</option>
                  ${QUELLEN.map((qu) => `<option ${f.quelle === qu ? "selected" : ""}>${e(qu)}</option>`).join("")}</select></div>
                <div class="feld"><label>Verantwortlich</label><select name="besitzer">
                  ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === f.besitzer ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
                <button type="submit" class="dunkel" style="width:100%;justify-content:center">Speichern</button>
              </form>
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/kunde`, zurueck)}" class="akte-form">
                <input type="hidden" name="abschnitt" value="kontakt">
                <div class="feld"><label>Telefon</label>
                  <input name="telefon" type="tel" value="${e(f.telefon || "")}" placeholder="+49 89 …"></div>
                <div class="feld"><label>E-Mail</label>
                  <input name="email" type="email" value="${e(f.email || "")}" placeholder="info@…"></div>
                <div class="feld"><label>Website</label>
                  <input name="website" value="${e(f.website || "")}" placeholder="https://… (leer = keine)"></div>
                <div class="feld"><label>Ort</label>
                  <input name="ort" value="${e(f.ort || "")}" placeholder="z. B. München"></div>
                <dl class="def" style="margin:4px 0 12px">
                  ${istKunde
                    ? `<dt>Kunde seit</dt><dd>${f.kunde_seit ? datum(f.kunde_seit) : "—"}</dd>`
                    : `<dt>Versuche</dt><dd>${f.versuche || 0}</dd>`}
                  <dt>Angelegt</dt><dd>${datum(f.erstellt)}</dd></dl>
                <button type="submit" class="dunkel" style="width:100%;justify-content:center">Kontaktdaten speichern</button>
              </form>
              ${f.argumente?.length ? `<h2 style="margin-top:18px">Verkaufsargumente</h2>
                <ul style="margin:10px 0 0 17px;font-size:13px;color:var(--text-secondary);line-height:1.55">
                ${f.argumente.map((a) => `<li style="margin-bottom:5px">${e(a)}</li>`).join("")}</ul>` : ""}</div>
            ${todoKarte}
            </div><div class="akte-spalte">

            <div class="karte karte-termine"><div class="karte-kopf"><div><h2>Dringlichkeit &amp; Termine</h2>
              <div class="sub">Was auf der Pipeline-Karte steht</div></div>
              ${f.dringlichkeit && DRINGLICHKEIT[f.dringlichkeit]
                ? `<span class="badge d-${DRINGLICHKEIT[f.dringlichkeit].farbe}">${e(f.dringlichkeit)}</span>` : ""}</div>
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/kunde`, zurueck)}">
                <input type="hidden" name="abschnitt" value="termine">
                <div class="feld"><label>Dringlichkeit</label><select name="dringlichkeit">
                  <option value="">— offen —</option>
                  ${Object.keys(DRINGLICHKEIT).map((k) => `<option ${f.dringlichkeit === k ? "selected" : ""}>${e(k)}</option>`).join("")}
                </select></div>
                <div class="feld-paar">
                  <div class="feld"><label>Erstgespräch am</label>
                    <input type="date" name="erstgespraech_am" value="${datumFeld(f.erstgespraech_am)}"></div>
                  <div class="feld"><label>Fällig bis</label>
                    <input type="date" name="faellig_am" value="${datumFeld(f.faellig_am)}"></div>
                </div>
                <p class="caption" style="margin:-4px 0 12px">Solange der Deal im Erstgespräch steht, zeigt die Karte
                  das Gesprächsdatum. Danach steht dort „fällig bis".</p>
                <div class="feld"><label>Nächste Aufgabe</label>
                  <input name="naechste_aufgabe" value="${e(f.naechste_aufgabe || "")}"
                    placeholder="z. B. Webseite live stellen"></div>
                <div class="feld"><label>Nächster Termin</label>
                  <input type="date" name="naechster_termin" value="${datumFeld(f.naechster_termin)}"></div>
                <button type="submit" class="dunkel" style="width:100%;justify-content:center">Speichern</button>
              </form></div>

            <div class="karte"><div class="karte-kopf"><div><h2>Auftrag</h2>
              <div class="sub">${istKunde ? "Was wir bekommen — einmalig und laufend" : "Was wir planen — einmalig und laufend"}</div></div></div>
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/kunde`, zurueck)}">
                <input type="hidden" name="abschnitt" value="auftrag">
                <div class="feld-paar">
                  <div class="feld"><label>${istKunde ? "Setup / Projekt (einmalig)" : "Geplantes Setup / Projekt"}</label>
                    <input name="preis_setup" type="number" step="1" placeholder="0" value="${f.preis_setup ?? ""}"></div>
                  <div class="feld"><label>${istKunde ? "Retainer (pro Monat)" : "Geplanter Retainer (pro Monat)"}</label>
                    <input name="preis_monatlich" type="number" step="1" placeholder="0" value="${f.preis_monatlich ?? ""}"></div>
                </div>
                <div class="feld"><label>${istKunde ? "Erfolgsbonus" : "Geplanter Erfolgsbonus"}</label>
                  <select name="erfolgsbonus" id="bonus-wahl">
                    <option value="" ${f.erfolgsbonus === null || f.erfolgsbonus === undefined ? "selected" : ""}>— offen —</option>
                    <option value="ja" ${f.erfolgsbonus === true ? "selected" : ""}>Ja</option>
                    <option value="nein" ${f.erfolgsbonus === false ? "selected" : ""}>Nein</option></select></div>
                <div class="feld" id="bonus-feld" style="display:${f.erfolgsbonus === true ? "" : "none"}">
                  <label>Wofür genau?</label>
                  <input name="erfolgsbonus_text" value="${e(f.erfolgsbonus_text || "")}"
                    placeholder="z. B. 3.000 € pro Mitarbeiter · 200 € pro Lead · 2.000 € für 10 Bewerbungen"></div>
                <div class="feld"><label>${istKunde ? "Laufzeit" : "Geplante Laufzeit"}</label><select name="vertrag_laufzeit">
                  <option value="">— offen —</option>
                  ${LAUFZEITEN.map((l) => `<option ${f.vertrag_laufzeit === l ? "selected" : ""}>${e(l)}</option>`).join("")}</select></div>
                ${kundenSparte === "webdesign" ? `<div class="feld"><label>Hosten wir die Seite?</label>
                  <select name="hosting">
                    <option value="" ${f.hosting === null || f.hosting === undefined ? "selected" : ""}>— offen —</option>
                    <option value="ja" ${f.hosting === true ? "selected" : ""}>Ja, wir hosten</option>
                    <option value="nein" ${f.hosting === false ? "selected" : ""}>Nein</option></select></div>` : ""}
                ${kundenSparte === "performance" ? `<div class="feld-paar">
                  <div class="feld"><label>Leads erreicht</label>
                    <input name="leads_ist" type="number" step="1" placeholder="0" value="${f.leads_ist ?? ""}"></div>
                  <div class="feld"><label>Leads vereinbart</label>
                    <input name="leads_ziel" type="number" step="1" placeholder="0" value="${f.leads_ziel ?? ""}"></div>
                </div>
                ${Number(f.leads_ziel) > 0 ? `<div class="leads-stand">
                  <div class="leads-stand-text">Aktueller Stand <b>${Number(f.leads_ist) || 0} von ${Number(f.leads_ziel)}</b> erforderlichen Leads</div>
                  <div class="leads-spur"><div class="leads-balken" style="width:${
                    Math.min(100, Math.round(((Number(f.leads_ist) || 0) / Number(f.leads_ziel)) * 100))}%"></div></div>
                </div>` : ""}` : ""}
                ${istKunde ? `<p class="caption" style="margin-bottom:12px">Sobald ein monatlicher Betrag drinsteht, zählt der Kunde als Retainer-Kunde.</p>` : ""}
                <button type="submit" class="dunkel" style="width:100%;justify-content:center">Auftrag speichern</button>
              </form></div>

            ${istKunde ? `
            <div class="karte"><div class="karte-kopf"><div><h2>Aktueller Stand</h2>
              <div class="sub">Wo das Projekt steht — und ob alles bezahlt ist</div></div></div>
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/kunde`, zurueck)}">
                <input type="hidden" name="abschnitt" value="stand">
                <div class="feld"><label>Projekt</label><select name="projekt_stand">
                  <option value="">— offen —</option>
                  ${Object.entries(PROJEKT_STAende).map(([k, v]) => `<option value="${k}" ${f.projekt_stand === k ? "selected" : ""}>${e(v)}</option>`).join("")}</select></div>
                <div class="feld"><label>Rechnung</label><select name="rechnung_stand">
                  <option value="">— offen —</option>
                  ${Object.entries(RECHNUNG_STAende).map(([k, v]) => `<option value="${k}" ${f.rechnung_stand === k ? "selected" : ""}>${e(v)}</option>`).join("")}</select></div>
                <div class="feld"><label>Vertrag unterschrieben?</label><select name="vertrag_unterschrieben">
                  <option value="" ${f.vertrag_unterschrieben === null || f.vertrag_unterschrieben === undefined ? "selected" : ""}>— offen —</option>
                  <option value="ja" ${f.vertrag_unterschrieben === true ? "selected" : ""}>Ja, liegt vor</option>
                  <option value="nein" ${f.vertrag_unterschrieben === false ? "selected" : ""}>Nein</option></select></div>
                <button type="submit" class="dunkel" style="width:100%;justify-content:center">Stand speichern</button>
              </form></div>` : `
            <div class="karte"><div class="karte-kopf"><div><h2>Aktueller Stand</h2>
              <div class="sub">Wo wir mit diesem Lead stehen</div></div></div>
              ${(f.deals || []).length ? `<div class="phasen-liste">
                ${(f.deals || []).map((d) => `<div class="phasen-zeile">
                  <span class="badge ${d.status === "gewonnen" ? "b-gruen" : d.status === "verloren" ? "b-rot" : "b-blau"}">${
                    e(d.stufe_name || d.status)}</span>
                  <span class="caption">${e(SPARTEN[d.sparte] || d.sparte)}</span></div>`).join("")}
              </div>` : `<p class="caption" style="margin-bottom:12px">Noch nicht im Vertrieb — leg oben die Leadakte an.</p>`}
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/score`, zurueck)}" style="margin-top:12px">
                <label>Score</label>
                <select name="score" onchange="this.form.submit()" style="width:100%">
                  <option value="" ${!f.score ? "selected" : ""}>— noch nicht eingeschätzt —</option>
                  ${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${Number(f.score) === n ? "selected" : ""}>Score ${n} von 10</option>`).join("")}
                </select></form></div>`}

            <div class="karte"><div class="karte-kopf"><div><h2>${istKunde ? "Umgesetzt" : "Geplante Umsetzung"} ${
              (f.umgesetzt || []).length ? `<span class="badge">${(f.umgesetzt || []).length}</span>` : ""}</h2>
              <div class="sub">${istKunde ? "Was wir gebaut haben" : "Was wir umsetzen würden"}</div></div></div>
              ${(f.umgesetzt || []).length ? `<div class="akte-todos">${(f.umgesetzt || []).map((x) => `
                <div class="akte-todo">
                  <span class="akte-todo-text">${e(x)}</span>
                  <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/umgesetzt`, zurueck)}">
                    <input type="hidden" name="weg" value="${e(x)}">
                    <button type="submit" class="still todo-weg" title="Entfernen">${ICON.x}</button>
                  </form>
                </div>`).join("")}</div>` : `<p class="caption">Noch nichts eingetragen.</p>`}
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/umgesetzt`, zurueck)}" class="akte-todo-neu">
                <input name="hinzu" required list="umgesetzt-liste" placeholder="z. B. Webdesign · Telefonagent">
                <datalist id="umgesetzt-liste">${UMGESETZT_VORSCHLAEGE.map((v) => `<option value="${e(v)}">`).join("")}</datalist>
                <button type="submit" class="dunkel">${ICON.plus}</button>
              </form></div>
            </div><div class="akte-spalte">

            <div class="karte"><div class="karte-kopf"><div><h2>Die Firma</h2>
              <div class="sub">${istKunde ? "Was der Kunde selbst anbietet" : "Was der Lead selbst anbietet"}</div></div></div>
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/kunde`, zurueck)}">
                <input type="hidden" name="abschnitt" value="firma">
                <div class="feld"><label>Leistungen der Firma</label>
                  <textarea name="taetigkeit" rows="3" placeholder="z. B. Physiotherapie, Krankengymnastik, Manuelle Therapie">${e(f.taetigkeit || "")}</textarea></div>
                <div class="feld"><label>Mitarbeiter</label>
                  <input name="mitarbeiter_zahl" type="number" step="1" placeholder="z. B. 12" value="${f.mitarbeiter_zahl ?? ""}"></div>
                <button type="submit" class="dunkel" style="width:100%;justify-content:center">Speichern</button>
              </form></div>

            <div class="karte"><div class="karte-kopf"><div><h2>Leistungen</h2>
              <div class="sub">Was wir im Bereich ${e(SPARTEN[kundenSparte])} liefern</div></div></div>
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/kunde`, zurueck)}">
                <input type="hidden" name="abschnitt" value="leistungen">
                <div class="wahl-liste">
                  ${leistungenAuswahl.map((l) => `<label class="wahl"><input type="checkbox" name="leistungen" value="${e(l)}"
                    ${(f.leistungen || []).includes(l) ? "checked" : ""}><span>${e(l)}</span></label>`).join("")}
                </div>
                ${(f.leistungen || []).filter((l) => !leistungenAuswahl.includes(l)).length
                  ? `<p class="caption" style="margin-top:8px">Aus einem anderen Bereich übernommen: ${
                      (f.leistungen || []).filter((l) => !leistungenAuswahl.includes(l)).map(e).join(", ")}</p>` : ""}
                <h3 style="margin:16px 0 8px;font-size:13px">Kontakt über</h3>
                <div class="wahl-liste">
                  ${KONTAKT_KANAELE.map((k) => `<label class="wahl"><input type="checkbox" name="kontakt_kanaele" value="${e(k)}"
                    ${(f.kontakt_kanaele || []).includes(k) ? "checked" : ""}><span>${e(k)}</span></label>`).join("")}
                </div>
                <button type="submit" class="dunkel" style="width:100%;justify-content:center;margin-top:14px">Speichern</button>
              </form></div>

            <div class="karte"><div class="karte-kopf"><div><h2>Dokumente</h2>
              <div class="sub">Verträge, Rechnungen, Briefings</div></div></div>
              <div class="ablage" id="ablage">
                <div class="ablage-icon">${ICON.ordner}</div>
                <div class="ablage-text"><b>Dateien hier ablegen</b>
                  <span class="caption">PDF, Bilder oder andere Dateien — oder klicken zum Auswählen</span></div>
                <input type="file" id="ablage-feld" multiple hidden>
              </div>
              <div class="ablage-liste" id="ablage-liste"></div>
              <p class="caption ablage-hinweis">Die Ablage ist noch nicht mit dem Speicher verbunden —
                Dateien werden hier vorgemerkt, aber noch nicht dauerhaft gesichert.</p>
            </div>
          </div></div>
        </div>
        <script>
        (function(){
          // Erfolgsbonus: das Textfeld erscheint nur, wenn "Ja" gewaehlt ist.
          var wahl=document.getElementById('bonus-wahl'), feldB=document.getElementById('bonus-feld');
          if(wahl) wahl.addEventListener('change',function(){
            feldB.style.display = wahl.value==='ja' ? '' : 'none';
            if(wahl.value==='ja') feldB.querySelector('input').focus();
          });
        })();
        (function(){
          var zone=document.getElementById('ablage'), feld=document.getElementById('ablage-feld'),
              liste=document.getElementById('ablage-liste');
          if(!zone) return;
          function groesse(b){ return b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB'; }
          function zeigen(dateien){
            Array.prototype.forEach.call(dateien,function(d){
              var z=document.createElement('div'); z.className='ablage-datei';
              z.innerHTML='<span class="ablage-datei-name"></span><span class="caption"></span>';
              z.querySelector('.ablage-datei-name').textContent=d.name;
              z.querySelector('.caption').textContent=groesse(d.size)+' · noch nicht gesichert';
              liste.appendChild(z);
            });
          }
          zone.addEventListener('click',function(){ feld.click(); });
          feld.addEventListener('change',function(){ zeigen(feld.files); feld.value=''; });
          ['dragenter','dragover'].forEach(function(n){
            zone.addEventListener(n,function(ev){ ev.preventDefault(); zone.classList.add('drueber'); });
          });
          ['dragleave','drop'].forEach(function(n){
            zone.addEventListener(n,function(ev){ ev.preventDefault(); zone.classList.remove('drueber'); });
          });
          zone.addEventListener('drop',function(ev){ zeigen(ev.dataTransfer.files); });
        })();
        </script>
        <dialog id="dealNeu"><h2>Neuer Deal</h2><div class="sub">für ${e(f.name)}</div>
          <form method="post" action="/crm/deal/anlegen"><input type="hidden" name="firma_id" value="${f.id}">
            <div class="feld"><label>Dealname *</label><input name="titel" required value="Website + Wartung" autofocus></div>
            <div class="feld-paar"><div class="feld"><label>Sparte</label><select name="sparte">
              ${Object.entries(SPARTEN).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join("")}</select></div>
              <div class="feld"><label>Wert (€)</label><input name="wert" type="number" step="1"></div></div>
            <div class="feld-paar"><div class="feld"><label>Verantwortlich</label><select name="besitzer">
              ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === u.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
              <div class="feld"><label>Erwarteter Abschluss</label><select name="erwartet_horizont">
                <option value="">unbekannt</option>
                <option value="30">Nächste 30 Tage</option>
                <option value="60">Nächste 60 Tage</option>
                <option value="90">Nächste 3 Monate</option>
                <option value="180">Nächste 6 Monate</option>
                <option value="365">Nächste 12 Monate</option></select></div></div>
            <div class="dialog-fuss"><button type="button" class="sekundaer" onclick="document.getElementById('dealNeu').close()">Abbrechen</button>
              <button type="submit" class="dunkel">Deal anlegen</button></div></form></dialog>`));
    } catch (err) { next(err); }
  });

  app.post("/crm/firma/:id/notiz", async (req, res, next) => {
    try { await crm.notiz(req.nutzer, req.params.id, req.body.text); res.redirect(mitHerkunft(`/crm/firma/${req.params.id}`, (req.query || {}).von)); } catch (e) { next(e); }
  });
  app.post("/crm/firma/:id/score", async (req, res, next) => {
    try { await crm.firmaAendern(req.nutzer, req.params.id, { score: req.body.score === "" ? null : Number(req.body.score) });
      res.redirect(mitHerkunft(`/crm/firma/${req.params.id}`, (req.query || {}).von)); } catch (e) { next(e); }
  });
  // Der Kasten "Anruf-Ergebnis" in der Akte ist entfallen — Anrufe werden dort
  // erfasst, wo telefoniert wird: in der Cold-Calling-Liste unter Leads. Damit
  // faellt auch die Route dazu weg.

  // ================= TEAM =================
  // Zeitraeume der Auswertung. Der SQL-Ausdruck kommt aus dieser festen Liste und
  // nie aus der Adresszeile — deshalb ist er unbedenklich direkt in der Abfrage.
  const ZEITRAEUME = [
    { id: "monat", label: new Date().toLocaleDateString("de-DE", { month: "long" }), sql: "date_trunc('month', current_date)" },
    { id: "m3", label: "3 Monate", sql: "current_date - interval '3 months'" },
    { id: "m6", label: "6 Monate", sql: "current_date - interval '6 months'" },
    { id: "m12", label: "12 Monate", sql: "current_date - interval '12 months'" },
    { id: "alle", label: "Insgesamt", sql: null },
  ];
  // Die drei Quoten der Cold-Call-Kachel. oben/unten sind die Felder aus teamLeistung,
  // obenWort/untenWort die Bezeichnungen fuers Fenster beim Überfahren ([Einzahl, Mehrzahl]).
  const CALL_QUOTEN = [
    { id: "cc-k", label: "→ Kunde", oben: "anruf_kunde", unten: "angerufen",
      obenWort: ["Kunde", "Kunden"], untenWort: ["Cold Call", "Cold Calls"],
      hinweis: "Von den angerufenen Leads wurde am Ende ein Kunde" },
    { id: "cc-eg", label: "→ Erstgespräch", oben: "anruf_erstgespraech", unten: "angerufen",
      obenWort: ["Erstgespräch", "Erstgespräche"], untenWort: ["Cold Call", "Cold Calls"],
      hinweis: "Von den angerufenen Leads kam es zum Erstgespräch" },
    { id: "eg-k", label: "EG → Kunde", oben: "anruf_kunde", unten: "anruf_erstgespraech",
      obenWort: ["Kunde", "Kunden"], untenWort: ["Erstgespräch", "Erstgespräche"],
      hinweis: "Von den geführten Erstgesprächen wurde ein Kunde" },
  ];
  const QUELL_ZIELE = [
    { id: "q-k", label: "→ Kunde", oben: "zu_kunde", unten: "leads",
      obenWort: ["Kunde", "Kunden"], untenWort: ["Lead", "Leads"],
      hinweis: "Anteil der Leads je Quelle, aus denen ein Kunde wurde" },
    { id: "q-eg", label: "→ Erstgespräch", oben: "zu_erstgespraech", unten: "leads",
      obenWort: ["Erstgespräch", "Erstgespräche"], untenWort: ["Lead", "Leads"],
      hinweis: "Anteil der Leads je Quelle, die es bis ins Erstgespräch geschafft haben" },
    { id: "q-egk", label: "EG → Kunde", oben: "zu_kunde", unten: "zu_erstgespraech",
      obenWort: ["Kunde", "Kunden"], untenWort: ["Erstgespräch", "Erstgespräche"],
      hinweis: "Von den Erstgesprächen dieser Quelle wurde ein Kunde" },
  ];

  app.get("/crm/team", async (req, res, next) => {
    try {
      const u = req.nutzer;
      if (u.rolle !== "admin") return res.redirect("/crm");
      // Alle Zeitraeume auf einmal holen und mitschicken — das Umschalten passiert
      // dann ohne Nachladen im Browser. Die Datenmenge ist winzig.
      const [t, heuteJePerson, ...zeitraumDaten] = await Promise.all([
        crm.teamZahlen(u), crm.teamHeute(u),
        ...ZEITRAEUME.map((z) => crm.teamLeistung(u, z.sql)),
      ]);
      const heuteVon = Object.fromEntries(heuteJePerson.map((h) => [h.id, h]));
      const daten = {};
      ZEITRAEUME.forEach((z, i) => { daten[z.id] = zeitraumDaten[i]; });
      const monat = ZEITRAEUME[0].label;

      // Umschalter über einer Kachel
      const schalter = (name, liste, aktiv) => `<div class="zeit-schalter" data-gruppe="${name}">
        ${liste.map((z) => `<button type="button" data-wert="${z.id}"
          class="${z.id === aktiv ? "an" : ""}"${z.hinweis ? ` title="${e(z.hinweis)}"` : ""}>${e(z.label)}</button>`).join("")}</div>`;
      // Leeres Balkenfeld — Höhen und Zahlen setzt das Skript beim Umschalten.
      // Die Zahl steht IM Balken (der ist position:relative) — nur so wandert sie
      // mit seiner Hoehe und sitzt immer genau darueber. Das Fenster beim Überfahren
      // haengt an der Säule und zeigt die absoluten Zahlen hinter der Prozentangabe.
      const balkenFeld = (id, saeulen) => `<div class="balken-block" id="${id}">
        ${saeulen.map((s) => `<div class="balken-saeule" data-schluessel="${e(s)}" tabindex="0">
          <div class="balken" style="height:3%"><span class="balken-wert"></span></div>
          <span class="balken-label">${e(s)}</span><span class="balken-basis"></span>
          <div class="balken-fenster" role="tooltip">
            <b class="bf-name">${e(s)}</b><span class="bf-zeit"></span>
            <span class="bf-zahlen"></span><span class="bf-quote"></span></div>
        </div>`).join("")}</div>`;

      const namen = daten.alle.personen.map((p) => p.name.split(" ")[0]);
      const quellen = [...new Set(Object.values(daten).flatMap((d) => d.quellen.map((q) => q.quelle)))];

      res.send(rahmen(u, "team", "Team-Leistung", "Umsatz, Cold Calls und Lead-Qualität", "", `
        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div><h2>Umsatz je Person</h2>
          <div class="sub" id="umsatz-sub">Gewonnene Deals im ${e(monat)}</div></div>
          ${schalter("umsatz", ZEITRAEUME, "monat")}</div>
          ${balkenFeld("balken-umsatz", namen)}</div>

        <div class="team-reihe">
          <div class="karte"><div class="karte-kopf"><div><h2>Cold Calls in Prozent</h2>
            <div class="sub" id="quote-sub">${e(CALL_QUOTEN[0].hinweis)}</div></div></div>
            ${schalter("quoteWas", CALL_QUOTEN, "cc-k")}
            ${schalter("quoteZeit", ZEITRAEUME, "alle")}
            ${balkenFeld("balken-quote", namen)}</div>

          <div class="karte"><div class="karte-kopf"><div><h2>Lead-Quellen</h2>
            <div class="sub" id="quelle-sub">${e(QUELL_ZIELE[0].hinweis)}</div></div></div>
            ${schalter("quelleWas", QUELL_ZIELE, "q-k")}
            ${schalter("quelleZeit", ZEITRAEUME, "alle")}
            ${balkenFeld("balken-quelle", quellen)}</div>
        </div>

        <div class="tabelle-huelle"><table class="tabelle team-tabelle">
          <thead>
            <tr class="gruppen-zeile"><th></th>
              <th colspan="2" class="gruppe">Aktuell betreut</th>
              <th colspan="5" class="gruppe gruppe-heute">Heute</th></tr>
            <tr><th>Person</th>
              <th class="rechts">Leads</th><th class="rechts">Kunden</th>
              <th class="rechts heute-erst">Cold Calls</th><th class="rechts">EG gebucht</th>
              <th class="rechts">EG geführt</th><th class="rechts">Kunden</th>
              <th class="rechts">Umsatz</th></tr></thead>
          <tbody>${t.map((p) => { const h = heuteVon[p.id] || {};
            const zahl = (n) => (n ? String(n) : `<span class="null">—</span>`);
            return `<tr onclick="location.href='/crm/team/${p.id}'" style="cursor:pointer">
              <td class="zeile-titel">${e(p.name)}
                <span class="zeile-sub">${p.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter"}${
                  (h.bereiche || []).length ? " · " + h.bereiche.map((b) => SPARTEN[b] || b).join(", ") : ""}</span></td>
              <td class="rechts">${zahl(p.leads)}</td><td class="rechts">${zahl(p.kunden)}</td>
              <td class="rechts heute-erst">${zahl(h.cold_calls)}</td>
              <td class="rechts">${zahl(h.eg_gebucht)}</td>
              <td class="rechts">${zahl(h.eg_gefuehrt)}</td>
              <td class="rechts">${h.gewonnen_heute ? `<span class="badge b-gruen">${h.gewonnen_heute}</span>` : `<span class="null">—</span>`}</td>
              <td class="rechts" style="font-weight:600">${Number(h.umsatz_heute)
                ? geld(h.umsatz_heute) : `<span class="null">—</span>`}</td></tr>`; }).join("")}</tbody></table></div>
        <script>
        (function(){
          const DATEN=${JSON.stringify(daten)};
          const ZEIT=${JSON.stringify(ZEITRAEUME.map((z) => ({ id: z.id, label: z.label })))};
          const QUOTEN=${JSON.stringify(CALL_QUOTEN)};
          const ZIELE=${JSON.stringify(QUELL_ZIELE)};
          const wahl={umsatz:"monat",quoteWas:"cc-k",quoteZeit:"alle",quelleWas:"q-k",quelleZeit:"alle"};
          const geld=n=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n||0);
          const zeitLabel=id=>(ZEIT.find(z=>z.id===id)||{}).label||"";
          // Wie der Zeitraum im Fenster beim Überfahren steht.
          const zeitSatz=id=>id==="alle"?"insgesamt":id==="monat"?"im "+zeitLabel("monat")
            :"in den letzten "+zeitLabel(id);
          const wort=(n,paar)=>n+" "+(n===1?paar[0]:paar[1]);

          // Ein Balkenfeld neu zeichnen. werte: {schluessel -> {zahl, text, basis, fenster}}
          // basis ist die Grundgesamtheit ("1 von 3") und steht klein unter dem Namen —
          // ohne sie sagt eine Quote von 100 % bei einem einzigen Lead zu viel aus.
          function zeichne(feldId,werte,zeitId){
            const feld=document.getElementById(feldId);
            const max=Math.max(1,...Object.values(werte).map(v=>v.zahl));
            feld.querySelectorAll(".balken-saeule").forEach(s=>{
              const v=werte[s.dataset.schluessel]||{zahl:0,text:"—"};
              s.querySelector(".balken-wert").textContent=v.text;
              s.querySelector(".balken-basis").textContent=v.basis||"";
              s.querySelector(".balken").style.height=Math.max(3,Math.round(v.zahl/max*100))+"%";
              s.classList.toggle("balken-null",!v.zahl);
              s.querySelector(".bf-zeit").textContent=zeitSatz(zeitId);
              s.querySelector(".bf-zahlen").textContent=(v.fenster||{}).zahlen||"Noch keine Daten";
              s.querySelector(".bf-quote").textContent=(v.fenster||{}).quote||"";
            });
          }
          // Quote in Prozent — ohne Grundgesamtheit gibt es keine Zahl, dann "—".
          function quote(oben,unten,art){
            if(!unten) return {zahl:0,text:"—",basis:"keine Daten",
              fenster:{zahlen:"Keine "+art.untenWort[1]+" im Zeitraum",quote:""}};
            const p=Math.round(oben/unten*100);
            return {zahl:p,text:p+" %",basis:oben+" von "+unten,
              fenster:{zahlen:wort(unten,art.untenWort)+" · "+wort(oben,art.obenWort),
                       quote:"Das sind "+p+" %"}};
          }
          function vorname(p){ return p.name.split(" ")[0]; }

          function frisch(){
            // Umsatz je Person
            const u={}; DATEN[wahl.umsatz].personen.forEach(p=>{
              const n=Number(p.umsatz)||0;
              u[vorname(p)]={zahl:n,text:n?geld(n):"—",
                fenster:{zahlen:wort(p.gewonnen,["gewonnener Deal","gewonnene Deals"]),
                         quote:n?geld(n)+" Umsatz":"Noch kein Umsatz"}}; });
            zeichne("balken-umsatz",u,wahl.umsatz);
            document.getElementById("umsatz-sub").textContent =
              wahl.umsatz==="alle"?"Gewonnene Deals insgesamt"
              :wahl.umsatz==="monat"?"Gewonnene Deals im "+zeitLabel("monat")
              :"Gewonnene Deals der letzten "+zeitLabel(wahl.umsatz);

            // Cold Calls in Prozent
            const qw=QUOTEN.find(q=>q.id===wahl.quoteWas);
            const qq={}; DATEN[wahl.quoteZeit].personen.forEach(p=>{
              qq[vorname(p)]=quote(p[qw.oben],p[qw.unten],qw); });
            zeichne("balken-quote",qq,wahl.quoteZeit);
            document.getElementById("quote-sub").textContent=qw.hinweis;

            // Lead-Quellen
            const zw=ZIELE.find(z=>z.id===wahl.quelleWas);
            const qu={}; DATEN[wahl.quelleZeit].quellen.forEach(r=>{
              qu[r.quelle]=quote(r[zw.oben],r[zw.unten],zw); });
            zeichne("balken-quelle",qu,wahl.quelleZeit);
            document.getElementById("quelle-sub").textContent=zw.hinweis;
          }

          document.querySelectorAll(".zeit-schalter").forEach(g=>{
            g.addEventListener("click",ev=>{
              const b=ev.target.closest("button"); if(!b) return;
              g.querySelectorAll("button").forEach(x=>x.classList.remove("an"));
              b.classList.add("an");
              wahl[g.dataset.gruppe]=b.dataset.wert;
              frisch();
            });
          });
          frisch();
        })();
        </script>`));
    } catch (err) { next(err); }
  });

  const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const stdFmt = (sek) => { const h = Math.floor(sek / 3600), m = Math.round((sek % 3600) / 60);
    return h === 0 && m === 0 ? "0 Std" : `${h ? h + " Std" : ""}${h && m ? " " : ""}${m ? m + " Min" : ""}`; };

  // Zeitraeume der Personenseite. "woche" hat ein eigenes Raster (sieben Wochentage),
  // Monat zeigt Tagesbalken, laengere Zeitraeume je einen Balken pro Monat.
  const PERSON_ZEIT = [
    { id: "woche", label: "Diese Woche", sql: null, raster: "woche" },
    { id: "monat", label: new Date().toLocaleDateString("de-DE", { month: "long" }), sql: "date_trunc('month', current_date)", raster: "tag" },
    { id: "m3", label: "3 Monate", sql: "current_date - interval '3 months'", raster: "monat" },
    { id: "m6", label: "6 Monate", sql: "current_date - interval '6 months'", raster: "monat" },
    { id: "m12", label: "12 Monate", sql: "current_date - interval '12 months'", raster: "monat" },
  ];
  // Zeitraeume der Kennzahlen. "heute" kommt hier dazu, "insgesamt" ganz hinten.
  const PERSON_WERTE = [
    { id: "heute", label: "Heute", sql: "current_date" },
    { id: "monat", label: new Date().toLocaleDateString("de-DE", { month: "long" }), sql: "date_trunc('month', current_date)" },
    { id: "m3", label: "3 Monate", sql: "current_date - interval '3 months'" },
    { id: "m6", label: "6 Monate", sql: "current_date - interval '6 months'" },
    { id: "m12", label: "12 Monate", sql: "current_date - interval '12 months'" },
    { id: "alle", label: "Insgesamt", sql: null },
  ];
  const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  // Auf der Personenseite steht nur die Oberkategorie. Was konkret dahintersteckt,
  // zeigt der Tooltip — aber nur die Aufgaben, die diese Person auch wirklich hat.
  const KATEGORIE_AUFGABEN = {
    "Vertrieb": ["Cold Calling", "Erstgespräche führen", "Angebote erstellen", "Vertragsabschluss"],
    "Marketing": ["Google Ads", "LinkedIn Ads", "Xing Ads", "Meta Ads", "Website-Analyse"],
    "Content": ["Social Media"],
    "Umsetzung": ["Webseiten bauen", "Hosting & Wartung", "KI-Automatisierungen", "KI-Readiness-Check"],
    "Kunden": ["Onboarding", "Kundenbetreuung", "Reporting", "Projektleitung"],
    "Buchhaltung": ["Rechnungsstellung"],
    "Führung": ["Recruiting", "Strategie & Führung"],
  };

  app.get("/crm/team/:id", async (req, res, next) => {
    try {
      const u = req.nutzer;
      if (u.rolle !== "admin") return res.redirect("/crm");
      const alle = await crm.teamZahlen(u);
      const person = alle.find((p) => String(p.id) === req.params.id);
      if (!person) return res.redirect("/crm/team");
      const heuteAlle = await crm.teamHeute(u);
      const stamm = heuteAlle.find((h) => String(h.id) === req.params.id) || {};

      // Alles auf einmal holen, damit das Umschalten ohne Nachladen laeuft.
      const [woche, bestand, ...rest] = await Promise.all([
        crm.zeitWoche(u, person.id),
        crm.personBestand(u, person.id),
        ...PERSON_ZEIT.filter((z) => z.raster !== "woche").map((z) => crm.zeitVerlauf(u, person.id, z.sql, z.raster)),
        ...PERSON_WERTE.map((z) => crm.personLeistung(u, person.id, z.sql)),
      ]);
      // Team-Schnitt je Zeitraum — eine Quote von 33 % sagt allein wenig, erst der
      // Vergleich ordnet sie ein. Personen ohne Anrufe zaehlen nicht in den Schnitt.
      const teamSchnitt = {};
      for (const z of PERSON_WERTE) {
        const alleP = (await crm.teamLeistung(u, z.sql)).personen.filter((x) => x.angerufen > 0);
        const sum = (f) => alleP.reduce((a, x) => a + Number(x[f] || 0), 0);
        teamSchnitt[z.id] = { calls: sum("angerufen"), eg: sum("anruf_erstgespraech"), kunden: sum("anruf_kunde") };
      }
      const zeitRaster = PERSON_ZEIT.filter((z) => z.raster !== "woche");
      const verlauf = { woche: { raster: "woche",
        punkte: woche.tage.map((sek, i) => ({ label: WOCHENTAGE[i].slice(0, 2), lang: WOCHENTAGE[i], sekunden: sek })) } };
      zeitRaster.forEach((z, i) => {
        verlauf[z.id] = { raster: z.raster, punkte: rest[i].map((r) => {
          const d = new Date(r.punkt);
          return { label: z.raster === "monat" ? MONATE_KURZ[d.getMonth()] : String(d.getDate()),
            lang: z.raster === "monat" ? MONATE_KURZ[d.getMonth()] + " " + d.getFullYear() : datum(d),
            sekunden: r.sekunden };
        }) };
      });
      const werte = {};
      PERSON_WERTE.forEach((z, i) => { werte[z.id] = rest[zeitRaster.length + i]; });

      const zurueck = herkunft(req, "/crm/team");
      const bereiche = (stamm.bereiche || []).map((b) => SPARTEN[b] || b);

      res.send(rahmen(u, "team", person.name, person.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter", "", `
        <a class="akte-zurueck" href="${zurueck}">${ICON.pfeilLinks} Zurück zur Team-Leistung</a>

        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div>
          <h2>${e(person.name)}</h2>
          <div class="sub">${person.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter"}${
            bereiche.length ? " · " + e(bereiche.join(", ")) : ""}</div></div></div>
          ${(stamm.kategorien || []).length ? `<div class="person-aufgaben">
            ${stamm.kategorien.map((k) => {
              const teil = (KATEGORIE_AUFGABEN[k] || []).filter((a) => (stamm.aufgaben || []).includes(a));
              return `<span class="badge"${teil.length ? ` title="${e(teil.join(" · "))}"` : ""}>${e(k)}</span>`;
            }).join("")}</div>`
            : `<p class="caption">Für diese Person sind noch keine Aufgaben hinterlegt.</p>`}
        </div>

        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div><h2>Arbeitszeit</h2>
          <div class="sub" id="zeit-sub">Montag bis Sonntag, aus der Stoppuhr im Header</div></div>
          <div class="zeit-schalter" data-gruppe="zeit">
            ${PERSON_ZEIT.map((z, i) => `<button type="button" data-wert="${z.id}" class="${i === 0 ? "an" : ""}">${e(z.label)}</button>`).join("")}
          </div></div>
          <div class="kennzeilen">
            <div class="kennzeile"><span>Summe</span><b id="zeit-summe">—</b></div>
            <div class="kennzeile"><span>Ø je Arbeitstag</span><b id="zeit-schnitt">—</b></div>
            <div class="kennzeile"><span>Erfasste Tage</span><b id="zeit-tage">—</b></div>
          </div>
          <div class="balken-block" id="zeit-balken"></div>
        </div>

        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div><h2>Cold Calling</h2>
          <div class="sub" id="call-sub">Was aus den Anrufen dieser Person geworden ist</div></div>
          <div class="zeit-schalter" data-gruppe="werte">
            ${PERSON_WERTE.map((z) => `<button type="button" data-wert="${z.id}" class="${z.id === "monat" ? "an" : ""}">${e(z.label)}</button>`).join("")}
          </div></div>
          <div class="kennzeilen kennzeilen-vier">
            <div class="kennzeile"><span>Cold Calls</span><b id="k-calls">—</b><i id="k-calls-sub"></i></div>
            <div class="kennzeile"><span>Erstgespräche</span><b id="k-eg">—</b><i id="k-eg-sub"></i></div>
            <div class="kennzeile"><span>Daraus Kunden</span><b id="k-kunden">—</b><i id="k-kunden-sub"></i></div>
            <div class="kennzeile"><span>Umsatz</span><b id="k-umsatz">—</b><i id="k-umsatz-sub"></i></div>
          </div>
          <div class="quoten-reihe">
            <div class="quote-kachel"><span>Cold Call → Erstgespräch</span><b id="q-cceg">—</b>
              <i id="q-cceg-sub"></i><em id="q-cceg-team"></em></div>
            <div class="quote-kachel"><span>Erstgespräch → Kunde</span><b id="q-egk">—</b>
              <i id="q-egk-sub"></i><em id="q-egk-team"></em></div>
            <div class="quote-kachel"><span>Cold Call → Kunde</span><b id="q-cck">—</b>
              <i id="q-cck-sub"></i><em id="q-cck-team"></em></div>
          </div>
        </div>

        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div><h2>Abschlüsse und Aufgaben</h2>
          <div class="sub" id="ab-sub">Im gewählten Zeitraum</div></div></div>
          <div class="kennzeilen kennzeilen-vier">
            <div class="kennzeile"><span>Gewonnen</span><b id="k-gewonnen">—</b></div>
            <div class="kennzeile"><span>Verloren</span><b id="k-verloren">—</b></div>
            <div class="kennzeile"><span>Abschlussquote</span><b id="k-quote">—</b><i id="k-quote-sub"></i></div>
            <div class="kennzeile"><span>To-Dos</span><b id="k-todos">—</b><i id="k-todos-sub"></i></div>
          </div>
        </div>

        <div class="person-reihe">
          <div class="karte"><div class="karte-kopf"><div><h2>Offene Pipeline</h2>
            <div class="sub">Was diese Person gerade in Arbeit hat</div></div>
            <span class="badge b-blau">${geld(bestand.offen.wert)}</span></div>
            ${bestand.stufen.length ? `<div class="liste-zeilen">
              ${bestand.stufen.map((s) => `<div class="liste-zeile">
                <span class="lz-punkt sparte-${e(s.sparte)}"></span>
                <span class="lz-text">${e(s.name)}<i>${e(SPARTEN[s.sparte] || s.sparte)}</i></span>
                <span class="lz-zahl">${s.anzahl}</span>
                <span class="lz-wert">${geld(s.wert)}</span></div>`).join("")}
              <div class="liste-fuss"><span>${bestand.offen.anzahl} offene ${
                bestand.offen.anzahl === 1 ? "Deal" : "Deals"}</span><b>${geld(bestand.offen.wert)}</b></div>
            </div>` : `<p class="caption">Aktuell kein offener Deal.</p>`}
          </div>

          <div class="karte"><div class="karte-kopf"><div><h2>Woran es scheitert</h2>
            <div class="sub">Gründe verlorener Deals — über alles gezählt</div></div></div>
            ${bestand.gruende.length ? `<div class="liste-zeilen">
              ${(() => { const max = Math.max(...bestand.gruende.map((g) => g.anzahl));
                return bestand.gruende.map((g) => `<div class="grund-zeile">
                  <span class="gz-text">${e(g.grund)}</span>
                  <span class="gz-spur"><i style="width:${Math.round(g.anzahl / max * 100)}%"></i></span>
                  <span class="gz-zahl">${g.anzahl}</span></div>`).join(""); })()}
            </div>` : `<p class="caption">Noch kein Deal verloren — hier steht später, woran es hakt.</p>`}
          </div>
        </div>
        <script>
        (function(){
          const VERLAUF=${JSON.stringify(verlauf)};
          const WERTE=${JSON.stringify(werte)};
          const TEAM=${JSON.stringify(teamSchnitt)};
          const ZEIT_LABEL=${JSON.stringify(Object.fromEntries(PERSON_ZEIT.map((z) => [z.id, z.label])))};
          const WERT_LABEL=${JSON.stringify(Object.fromEntries(PERSON_WERTE.map((z) => [z.id, z.label])))};
          let wZeit="woche", wWerte="monat";
          const geld=n=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n||0);
          // Sekunden lesbar: "7 Std 8 Min"
          function std(sek){ sek=Math.round(sek||0);
            const h=Math.floor(sek/3600), m=Math.round((sek%3600)/60);
            if(!h&&!m) return "0 Std";
            return (h?h+" Std":"")+(h&&m?" ":"")+(m?m+" Min":""); }
          function proz(oben,unten){ return unten?Math.round(oben/unten*100)+" %":"—"; }
          // "6 Punkte über dem Team" — oder darunter. Ohne Vergleichsbasis bleibt es leer.
          function vergleich(id,oben,unten,tOben,tUnten){
            const el=document.getElementById(id); if(!el) return;
            if(!unten||!tUnten){ el.textContent=""; el.className=""; return; }
            const mein=Math.round(oben/unten*100), team=Math.round(tOben/tUnten*100);
            const diff=mein-team;
            el.textContent=(diff>0?"+":"")+diff+" Punkte gegenüber Team-Schnitt "+team+" %";
            el.className=diff>0?"besser":diff<0?"schlechter":"";
          }

          function zeitZeichnen(){
            const v=VERLAUF[wZeit]||{punkte:[]};
            const summe=v.punkte.reduce((a,p)=>a+p.sekunden,0);
            const tage=v.punkte.filter(p=>p.sekunden>0).length;
            document.getElementById("zeit-summe").textContent=std(summe);
            document.getElementById("zeit-schnitt").textContent=tage?std(summe/tage):"—";
            document.getElementById("zeit-tage").textContent=tage||"—";
            document.getElementById("zeit-sub").textContent =
              wZeit==="woche"?"Montag bis Sonntag, aus der Stoppuhr im Header"
              :v.raster==="monat"?"Ein Balken je Monat — "+ZEIT_LABEL[wZeit]
              :"Ein Balken je Tag — "+ZEIT_LABEL[wZeit];
            const feld=document.getElementById("zeit-balken");
            if(!v.punkte.length){ feld.innerHTML='<p class="caption">Für diesen Zeitraum ist keine Zeit erfasst.</p>'; return; }
            const max=Math.max(1,...v.punkte.map(p=>p.sekunden));
            feld.innerHTML=v.punkte.map(p=>
              '<div class="balken-saeule">'
              +'<div class="balken" style="height:'+Math.max(3,Math.round(p.sekunden/max*100))+'%">'
              +'<span class="balken-wert">'+(p.sekunden?std(p.sekunden):"")+'</span></div>'
              +'<span class="balken-label">'+p.label+'</span></div>').join("");
          }

          function werteZeichnen(){
            const d=WERTE[wWerte]||{};
            const setz=(id,txt)=>{const el=document.getElementById(id); if(el) el.textContent=txt;};
            const zeitraum=wWerte==="alle"?"insgesamt":wWerte==="heute"?"heute"
              :wWerte==="monat"?"im "+WERT_LABEL.monat
              :"in den letzten "+WERT_LABEL[wWerte].replace(/Monate$/,"Monaten");
            setz("call-sub","Was aus den Anrufen dieser Person geworden ist — "+zeitraum);
            setz("ab-sub","Im Zeitraum: "+zeitraum);

            setz("k-calls",d.calls||"—");
            setz("k-calls-sub",d.call_tage?"an "+d.call_tage+" Tagen · Ø "+(d.calls/d.call_tage).toFixed(1)+" pro Tag":"");
            setz("k-eg",d.eg||"—");
            setz("k-eg-sub",d.calls?"aus "+d.calls+" Anrufen":"");
            setz("k-kunden",d.kunden||"—");
            setz("k-kunden-sub",d.eg?"aus "+d.eg+" Erstgesprächen":"");
            setz("k-umsatz",Number(d.umsatz)?geld(d.umsatz):"—");
            setz("k-umsatz-sub",d.gewonnen?d.gewonnen+" gewonnene Deals":"");

            setz("q-cceg",proz(d.eg,d.calls));   setz("q-cceg-sub",d.calls?d.eg+" von "+d.calls:"keine Anrufe");
            setz("q-egk",proz(d.kunden,d.eg));   setz("q-egk-sub",d.eg?d.kunden+" von "+d.eg:"keine Erstgespräche");
            setz("q-cck",proz(d.kunden,d.calls));setz("q-cck-sub",d.calls?d.kunden+" von "+d.calls:"keine Anrufe");
            // Vergleich zum Team: erst dadurch laesst sich eine Quote einordnen.
            const s=TEAM[wWerte]||{};
            vergleich("q-cceg-team",d.eg,d.calls,s.eg,s.calls);
            vergleich("q-egk-team",d.kunden,d.eg,s.kunden,s.eg);
            vergleich("q-cck-team",d.kunden,d.calls,s.kunden,s.calls);

            setz("k-gewonnen",d.gewonnen||"—");
            setz("k-verloren",d.verloren||"—");
            const ent=(d.gewonnen||0)+(d.verloren||0);
            setz("k-quote",proz(d.gewonnen,ent));
            setz("k-quote-sub",ent?d.gewonnen+" von "+ent+" entschieden":"nichts entschieden");
            setz("k-todos",d.todos_erledigt||"—");
            setz("k-todos-sub",(d.todos_offen||0)+" noch offen");
          }

          document.querySelectorAll(".zeit-schalter").forEach(g=>{
            g.addEventListener("click",ev=>{
              const b=ev.target.closest("button"); if(!b) return;
              g.querySelectorAll("button").forEach(x=>x.classList.remove("an"));
              b.classList.add("an");
              if(g.dataset.gruppe==="zeit"){ wZeit=b.dataset.wert; zeitZeichnen(); }
              else { wWerte=b.dataset.wert; werteZeichnen(); }
            });
          });
          zeitZeichnen(); werteZeichnen();
        })();
        </script>`));
    } catch (err) { next(err); }
  });
};
