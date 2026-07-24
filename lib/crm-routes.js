// Flowstate CRM — Oberflaeche nach Estera-Vorbild, Flowstate-Inhalte.
const crm = require("./crm.js");
const { schale } = require("./schale.js");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const geld = (n) => (n == null ? "–" : Math.round(Number(n)).toLocaleString("de-DE") + " €");
// Abschluss-Wahrscheinlichkeit einer Phase: erste 10 %, letzte 100 % - skaliert mit der Phasenzahl.
const wahrsch = (anzahl, i) => Math.round(10 + (90 * i) / Math.max(1, anzahl - 1));
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

// Wie lange die Zusammenarbeit laeuft.
const LAUFZEITEN = ["1 Monat", "3 Monate", "6 Monate", "12 Monate", "Unbegrenzt · monatlich kündbar", "Einmaliges Projekt"];
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
  return rahmen(u, "pipeline", SPARTEN[sparte],
    "Vertriebspipeline \u00b7 " + (art === "projekt" ? "Projekte" : "Verkauf"), reiter, inhalt, sparte);
}

function reiterLeiste(seiten, aktiv, sparte, basis) {
  const r = seiten.map((s) => `<a href="${s.href}" class="${s.id === aktiv ? "aktiv" : ""}">${e(s.label)}</a>`).join("");
  void 0;
  const seg = [["", "Gesamt"], ...Object.entries(SPARTEN)]
    .map(([k, v]) => `<a href="${basis}${basis.includes("?") ? "&" : "?"}sparte=${k}" class="${(sparte || "") === k ? "aktiv" : ""}">${e(v)}</a>`).join("");
  return `<div class="reiterleiste"><nav class="reiter">${r}</nav><nav class="segmente">${seg}</nav></div>`;
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
      boards.forEach((b) => b.forEach((st, i) => st.deals.forEach((d) => { forecast += Number(d.wert || 0) * (wahrsch(b.length, i) / 100); })));
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
          erwartet30 += Number(d.wert || 0) * (wahrsch(b.length, i) / 100);
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
          <div class="trichter-info"><strong>${e(s.name)} · ${wahrsch(tBoard.length, i)} %</strong><span>${kumW[i] ? geld(kumW[i]) : "—"}</span></div></div>`;
      }).join("");

      // DEMO-Trichter fuer die Gesamt-Ansicht (Platzhalter, bis echte Zahlen vorhanden sind)
      const DUMMY_TRICHTER = [
        { name: "Neu", n: 128, wert: 192000 },
        { name: "Kontaktiert", n: 86, wert: 140000 },
        { name: "Erstgespräch", n: 47, wert: 94000 },
        { name: "Angebot", n: 21, wert: 52000 },
        { name: "Gewonnen", n: 8, wert: 24000 },
      ];
      const dMax = Math.max(1, ...DUMMY_TRICHTER.map((d) => d.n));
      const trichterDummy = DUMMY_TRICHTER.map((s, i) => {
        const breite = Math.max(14, Math.round((s.n / dMax) * 100));
        return `<div class="trichter-zeile trichter-klick" onclick="document.getElementById('trichter-dlg-${i}').showModal()" title="Leads dieser Stufe ansehen"><div class="trichter-spur">
          <div class="trichter-balken" style="width:${breite}%;background:var(--stage-${(i % 8) + 1})">${s.n}</div></div>
          <div class="trichter-info"><strong>${e(s.name)} · ${wahrsch(DUMMY_TRICHTER.length, i)} %</strong><span>${geld(s.wert)}</span></div></div>`;
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
        const gewichtet = b.reduce((a, st, j) => a + st.deals.reduce((m, d) => m + Number(d.wert || 0) * (wahrsch(b.length, j) / 100), 0), 0);
        const alter = deals.length ? deals.reduce((a, d) => a + (heute - new Date(d.erstellt)) / 86400000, 0) / deals.length : 0;
        const stufen = b.map((st, j) => ({
          name: st.name, anzahl: st.deals.length, quote: wahrsch(b.length, j),
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
      const sparte = SPARTEN[req.query.sparte] ? req.query.sparte : "webdesign";
      const art = req.query.art === "projekt" ? "projekt" : "vertrieb";
      const [spalten, firmen, mitarbeiter] = await Promise.all([
        crm.dealsNachStufen(u, sparte, art), crm.firmenListe(u, { limit: 300 }), crm.team(u),
      ]);
      const gesamt = spalten.reduce((n, s) => n + s.deals.length, 0);
      const wert = spalten.reduce((n, s) => n + s.deals.reduce((m, d) => m + Number(d.wert || 0), 0), 0);

      const reiter = reiterLeiste([
        { id: "vertrieb", label: "Verkauf", href: `/crm/pipeline?sparte=${sparte}&art=vertrieb` },
        { id: "projekt", label: "Projektabwicklung", href: `/crm/pipeline?sparte=${sparte}&art=projekt` },
      ], art, sparte, "/crm/pipeline?art=" + art);

      res.send(rahmenPipeline(u, sparte, art, reiter, `
        <div class="seiten-kopf">
          <div><p class="sub">${gesamt} offene Deals · ${geld(wert)} Gesamtwert</p></div>
          <button class="dunkel" onclick="document.getElementById('dealNeu').showModal()">${ICON.plus} Neuer Deal</button>
        </div>
        <div class="kanban">
          ${spalten.map((s, i) => `
            <div class="spalte" data-stufe="${s.id}" style="--stufe:var(--stage-${(i % 8) + 1})">
              <div class="spalte-kopf"><div class="spalte-titel-zeile">
                <span class="spalte-titel">${e(s.name)}</span><span class="spalte-zahl">${s.deals.length}</span></div>
                <div class="spalte-quote">${art === "vertrieb" ? wahrsch(spalten.length, i) + " % Wahrscheinlichkeit" : "Phase " + (i + 1)}</div></div>
              <div class="spalte-karten">
                ${!s.deals.length ? `<div class="spalte-leer">${s.ist_abschluss ? "Ziel-Stufe" : "leer"}</div>` : ""}
                ${s.deals.map((d) => `
                  <div class="deal" draggable="true" data-id="${d.id}" onclick="if(!window.__zieht)location.href='/crm/firma/${d.firma_id}'">
                    <div class="deal-kopf"><span class="deal-punkt"></span>
                      <span class="deal-name">${e(d.firma_name)}</span><span class="deal-griff">${ICON.griff}</span></div>
                    <div class="deal-betrag">${geld(d.wert)}</div>
                    <div class="deal-zeile">${e(d.titel)}</div>
                    <div class="deal-marken">${d.ort ? `<span class="badge">${e(d.ort)}</span>` : ""}
                      <span class="badge b-blau">${e(SPARTEN[d.sparte] || d.sparte)}</span></div>
                    <div class="deal-fuss">${ICON.person}${e(d.besitzer_name || "—")}</div>
                  </div>`).join("")}
              </div></div>`).join("")}
        </div>
        ${!gesamt ? `<div class="hinweis info">${ICON.info}<div><strong>Noch keine offenen Deals in ${e(SPARTEN[sparte])}.</strong>
          Leg oben rechts einen neuen Deal an — er erscheint dann in der ersten Stufe und lässt sich per Ziehen bewegen.</div></div>` : ""}

        <dialog id="dealNeu"><h2>Neuer Deal</h2><div class="sub">Bereich ${e(SPARTEN[sparte])} · Kunde &amp; Phase</div>
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
          let gezogen=null; window.__zieht=false;
          document.querySelectorAll(".deal").forEach(k=>{
            k.addEventListener("dragstart",()=>{gezogen=k;window.__zieht=true;k.classList.add("zieht")});
            k.addEventListener("dragend",()=>{k.classList.remove("zieht");setTimeout(()=>window.__zieht=false,60);
              document.querySelectorAll(".spalte").forEach(s=>s.classList.remove("ziel"))});
          });
          document.querySelectorAll(".spalte").forEach(sp=>{
            sp.addEventListener("dragover",ev=>{ev.preventDefault();sp.classList.add("ziel")});
            sp.addEventListener("dragleave",()=>sp.classList.remove("ziel"));
            sp.addEventListener("drop",async ev=>{ev.preventDefault();sp.classList.remove("ziel");if(!gezogen)return;
              sp.querySelector(".spalte-karten").appendChild(gezogen);
              if(window.gsap)gsap.fromTo(gezogen,{scale:.96},{scale:1,duration:.25,ease:"back.out(2)"});
              const r=await fetch("/crm/deal/verschieben",{method:"POST",headers:{"Content-Type":"application/json"},
                body:JSON.stringify({deal:gezogen.dataset.id,stufe:sp.dataset.stufe})}).then(r=>r.json());
              if(r.gewonnen)location.reload();});
          });
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

  app.post("/crm/deal/verschieben", async (req, res) => {
    try {
      await crm.dealVerschieben(req.nutzer, req.body.deal, req.body.stufe);
      const st = (await crm.stufen(req.nutzer)).find((s) => String(s.id) === String(req.body.stufe));
      res.json({ ok: true, gewonnen: !!st?.ist_abschluss });
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
    return /^\/crm\/[a-z0-9/-]*$/i.test(z) ? z : "/crm/todos";
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
                .then(function(){ raus(); })
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
      } else if (b.abschnitt === "leistungen") {
        daten.leistungen = mehrfach(b.leistungen, LEISTUNGEN);
        daten.kontakt_kanaele = mehrfach(b.kontakt_kanaele, KONTAKT_KANAELE);
      }
      await crm.kundeAendern(req.nutzer, req.params.id, daten);
      res.redirect(`/crm/firma/${req.params.id}`);
    } catch (err) { next(err); }
  });

  // Leadakte anlegen — Lead startet im Vertrieb auf Stufe "Neu"
  app.post("/crm/firma/:id/leadakte", async (req, res, next) => {
    try {
      await crm.leadakteAnlegen(req.nutzer, req.params.id, (req.body || {}).sparte);
      res.redirect(`/crm/firma/${req.params.id}`);
    } catch (err) { next(err); }
  });

  // Aus einem Lead einen Kunden machen
  app.post("/crm/firma/:id/zu-kunde", async (req, res, next) => {
    try {
      await crm.zuKundeMachen(req.nutzer, req.params.id, (req.body || {}).kunde_seit);
      res.redirect(`/crm/firma/${req.params.id}`);
    } catch (err) { next(err); }
  });

  // Was wir umgesetzt haben — Eintrag ergänzen oder entfernen
  app.post("/crm/firma/:id/umgesetzt", async (req, res, next) => {
    try {
      const b = req.body || {};
      await crm.umgesetztAendern(req.nutzer, req.params.id, { hinzu: b.hinzu || "", weg: b.weg || "" });
      res.redirect(`/crm/firma/${req.params.id}`);
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
              <input type="hidden" name="zurueck" value="/crm/firma/${f.id}">
              <button type="submit" class="todo-haken ${t.erledigt ? "an" : ""}" title="${t.erledigt ? "Wieder öffnen" : "Erledigt"}">${t.erledigt ? ICON.check : ""}</button>
            </form>
            <span class="akte-todo-text">${e(t.titel)}</span>
            ${t.faellig ? `<span class="badge ${new Date(t.faellig) <= new Date() && !t.erledigt ? "b-rot" : ""}">${datum(t.faellig)}</span>` : ""}
          </div>`).join("")}</div>` : `<p class="caption">Noch nichts offen.</p>`}
        <form method="post" action="/crm/todo/anlegen" class="akte-todo-neu">
          <input type="hidden" name="firma_id" value="${f.id}">
          <input type="hidden" name="zurueck" value="/crm/firma/${f.id}">
          <input name="titel" required placeholder="Neue Aufgabe — z. B. Anrufen und Termin abklären">
          <select name="wichtigkeit" title="Wichtigkeit">
            <option value="1">Sehr wichtig</option><option value="2">Wichtig</option>
            <option value="3" selected>Sollte erledigt werden</option><option value="4">Kann warten</option>
          </select>
          <select name="dringlichkeit" title="Dringlichkeit">
            <option value="Extrem dringend">Extrem dringend</option><option value="Dringend">Dringend</option>
            <option value="ASAP">ASAP</option><option value="Bald" selected>Bald</option>
            <option value="Wenn Zeit da ist">Wenn Zeit da ist</option>
          </select>
          <input type="date" name="geplant_am" value="${heuteFeld()}" title="Für welchen Tag einplanen">
          <button type="submit" class="dunkel">${ICON.plus}</button>
        </form>
        <p class="caption" style="margin-top:8px">Für heute eingeplante Aufgaben erscheinen im Dashboard unter „Heute zu tun".</p></div>`;

      res.send(rahmen(u, istKunde ? "kunden" : "leads", istKunde ? "Kundenakte" : "Lead-Akte", "", "", `
        <a class="akte-zurueck" href="${istKunde ? "/crm/kunden" : "/crm/leads"}">${ICON.pfeilLinks} Zurück zur Übersicht</a>
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
            ${(istKunde || hatDeal) ? `<form method="post" action="/crm/firma/${f.id}/kunde" class="akte-bereich">
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
          <form method="post" action="/crm/firma/${f.id}/leadakte">
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
          <form method="post" action="/crm/firma/${f.id}/zu-kunde">
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
              <form method="post" action="/crm/firma/${f.id}/notiz" style="display:flex;gap:8px;margin-top:14px">
                <input name="text" placeholder="Notiz hinzufügen …" required><button type="submit">Speichern</button></form></div>
          </div>
          <div class="akte-spalten"><div class="akte-spalte">
            <div class="karte"><div class="karte-kopf"><h2>Stammdaten</h2></div>
              <form method="post" action="/crm/firma/${f.id}/kunde" class="akte-form akte-form-oben">
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
              <form method="post" action="/crm/firma/${f.id}/kunde" class="akte-form">
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

            <div class="karte"><div class="karte-kopf"><div><h2>Auftrag</h2>
              <div class="sub">${istKunde ? "Was wir bekommen — einmalig und laufend" : "Was wir planen — einmalig und laufend"}</div></div></div>
              <form method="post" action="/crm/firma/${f.id}/kunde">
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
              <form method="post" action="/crm/firma/${f.id}/kunde">
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
              <form method="post" action="/crm/firma/${f.id}/score" style="margin-top:12px">
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
                  <form method="post" action="/crm/firma/${f.id}/umgesetzt">
                    <input type="hidden" name="weg" value="${e(x)}">
                    <button type="submit" class="still todo-weg" title="Entfernen">${ICON.x}</button>
                  </form>
                </div>`).join("")}</div>` : `<p class="caption">Noch nichts eingetragen.</p>`}
              <form method="post" action="/crm/firma/${f.id}/umgesetzt" class="akte-todo-neu">
                <input name="hinzu" required list="umgesetzt-liste" placeholder="z. B. Webdesign · Telefonagent">
                <datalist id="umgesetzt-liste">${UMGESETZT_VORSCHLAEGE.map((v) => `<option value="${e(v)}">`).join("")}</datalist>
                <button type="submit" class="dunkel">${ICON.plus}</button>
              </form></div>
            </div><div class="akte-spalte">

            <div class="karte"><div class="karte-kopf"><div><h2>Die Firma</h2>
              <div class="sub">${istKunde ? "Was der Kunde selbst anbietet" : "Was der Lead selbst anbietet"}</div></div></div>
              <form method="post" action="/crm/firma/${f.id}/kunde">
                <input type="hidden" name="abschnitt" value="firma">
                <div class="feld"><label>Leistungen der Firma</label>
                  <textarea name="taetigkeit" rows="3" placeholder="z. B. Physiotherapie, Krankengymnastik, Manuelle Therapie">${e(f.taetigkeit || "")}</textarea></div>
                <div class="feld"><label>Mitarbeiter</label>
                  <input name="mitarbeiter_zahl" type="number" step="1" placeholder="z. B. 12" value="${f.mitarbeiter_zahl ?? ""}"></div>
                <button type="submit" class="dunkel" style="width:100%;justify-content:center">Speichern</button>
              </form></div>

            <div class="karte"><div class="karte-kopf"><div><h2>Leistungen</h2>
              <div class="sub">Was wir im Bereich ${e(SPARTEN[kundenSparte])} liefern</div></div></div>
              <form method="post" action="/crm/firma/${f.id}/kunde">
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

            ${!istKunde ? `
            <div class="karte"><div class="karte-kopf"><div><h2>Anruf-Ergebnis</h2>
              <div class="sub">Ein Klick — Verlauf und Status werden mitgeschrieben.</div></div></div>
              <form method="post" action="/crm/firma/${f.id}/call" style="display:grid;gap:10px">
                <button name="ausgang" value="termin" style="background:var(--success);justify-content:center">${ICON.check} Erstgespräch gebucht</button>
                <button name="ausgang" value="nicht-erreicht" class="sekundaer" style="justify-content:center">${ICON.uhr} Nicht erreicht</button>
                <div style="border-top:1px solid var(--border);padding-top:12px"><label>Später anrufen am</label>
                  <div style="display:flex;gap:8px"><input type="date" name="datum" style="flex:1">
                    <button name="ausgang" value="spaeter" class="sekundaer">Merken</button></div></div>
                <div style="border-top:1px solid var(--border);padding-top:12px"><label>Absage — Grund (Pflicht)</label>
                  <div style="display:flex;gap:8px"><select name="grund" style="flex:1"><option value="">bitte wählen …</option>
                    <option>kein Bedarf</option><option>zu teuer</option><option>hat schon</option><option>kein Interesse</option></select>
                    <button name="ausgang" value="absage" class="sekundaer" style="color:var(--danger);border-color:var(--danger)">${ICON.x}</button></div></div>
              </form></div>` : ""}

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
    try { await crm.notiz(req.nutzer, req.params.id, req.body.text); res.redirect(`/crm/firma/${req.params.id}`); } catch (e) { next(e); }
  });
  app.post("/crm/firma/:id/score", async (req, res, next) => {
    try { await crm.firmaAendern(req.nutzer, req.params.id, { score: req.body.score === "" ? null : Number(req.body.score) });
      res.redirect(`/crm/firma/${req.params.id}`); } catch (e) { next(e); }
  });
  app.post("/crm/firma/:id/call", async (req, res, next) => {
    try { await crm.callErgebnis(req.nutzer, req.params.id, req.body.ausgang, { grund: req.body.grund, datum: req.body.datum || null });
      res.redirect(`/crm/firma/${req.params.id}`); } catch (e) { next(e); }
  });

  // ================= TEAM =================
  app.get("/crm/team", async (req, res, next) => {
    try {
      const u = req.nutzer;
      if (u.rolle !== "admin") return res.redirect("/crm");
      const t = await crm.teamZahlen(u);
      const monat = new Date().toLocaleDateString("de-DE", { month: "long" });
      const gesamtUmsatz = t.reduce((a, p) => a + Number(p.umsatz_monat || 0), 0);
      const gesamtGewonnen = t.reduce((a, p) => a + p.gewonnen, 0);
      const gesamtVerloren = t.reduce((a, p) => a + p.verloren, 0);
      const quote = gesamtGewonnen + gesamtVerloren > 0 ? Math.round((gesamtGewonnen / (gesamtGewonnen + gesamtVerloren)) * 100) : 0;
      const maxU = Math.max(1, ...t.map((p) => Number(p.umsatz_monat) || 0));

      const reiter = "";

      res.send(rahmen(u, "team", "Team-Leistung", "Umsatz, Abschlüsse und Aktivität je Person", reiter, `
        <div class="kacheln">
          ${kachel(`Umsatz ${e(monat)}`, gesamtUmsatz, ICON.euro, "gruen", `<span class="caption">alle Personen zusammen</span>`, true)}
          ${kachel("Gewonnene Deals", gesamtGewonnen, ICON.check, "", `<span class="caption">${gesamtVerloren} verloren</span>`)}
          ${kachel("Abschlussquote", quote, ICON.prozent, "bernstein", `<span class="caption">gewonnen ÷ entschieden</span>`, false, " %")}
          ${kachel("Anrufe heute", t.reduce((a, p) => a + p.anrufe_heute, 0), ICON.telefon, "rosa", `<span class="caption">im gesamten Team</span>`)}
        </div>
        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div><h2>Umsatz je Person</h2>
          <div class="sub">Gewonnene Deals im ${e(monat)}</div></div></div>
          <div class="balken-block">${t.map((p) => `<div class="balken-saeule">
            <div class="balken" style="height:${Math.max(3, Math.round((Number(p.umsatz_monat) || 0) / maxU * 100))}%"></div>
            <span class="balken-label">${e(p.name.split(" ")[0])}</span></div>`).join("")}</div></div>
        <div class="tabelle-huelle"><table class="tabelle">
          <thead><tr><th>Person</th><th>Rolle</th><th class="rechts">Leads</th><th class="rechts">Kunden</th>
            <th class="rechts">Offen</th><th class="rechts">Gewonnen</th><th class="rechts">Verloren</th>
            <th class="rechts">Quote</th><th class="rechts">Umsatz ${e(monat)}</th><th class="rechts">Anrufe heute</th></tr></thead>
          <tbody>${t.map((p) => { const q = p.gewonnen + p.verloren > 0 ? Math.round((p.gewonnen / (p.gewonnen + p.verloren)) * 100) : null;
            return `<tr onclick="location.href='/crm/team/${p.id}'" style="cursor:pointer"><td class="zeile-titel">${e(p.name)}</td>
              <td><span class="badge ${p.rolle === "admin" ? "b-blau" : ""}">${p.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter"}</span></td>
              <td class="rechts">${p.leads}</td><td class="rechts">${p.kunden}</td><td class="rechts">${p.offen}</td>
              <td class="rechts">${p.gewonnen ? `<span class="badge b-gruen">${p.gewonnen}</span>` : "—"}</td>
              <td class="rechts">${p.verloren || "—"}</td><td class="rechts">${q === null ? "—" : q + " %"}</td>
              <td class="rechts" style="font-weight:600">${geld(p.umsatz_monat)}</td>
              <td class="rechts">${p.anrufe_heute || "—"}</td></tr>`; }).join("")}</tbody></table></div>`));
    } catch (err) { next(err); }
  });

  const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const stdFmt = (sek) => { const h = Math.floor(sek / 3600), m = Math.round((sek % 3600) / 60);
    return h === 0 && m === 0 ? "0 Std" : `${h ? h + " Std" : ""}${h && m ? " " : ""}${m ? m + " Min" : ""}`; };

  app.get("/crm/team/:id", async (req, res, next) => {
    try {
      const u = req.nutzer;
      if (u.rolle !== "admin") return res.redirect("/crm");
      const alle = await crm.teamZahlen(u);
      const person = alle.find((p) => String(p.id) === req.params.id);
      if (!person) return res.redirect("/crm/team");
      const woche = await crm.zeitWoche(u, person.id);
      const maxSek = Math.max(1, ...woche.tage, woche.summe);

      res.send(rahmen(u, "team", person.name, person.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter", "", `
        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div><h2>Arbeitszeit diese Woche</h2>
          <div class="sub">Montag bis Sonntag, aus der Stoppuhr im Header</div></div></div>
          <div class="balken-block">
            ${woche.tage.map((sek, i) => `<div class="balken-saeule">
              <div class="balken" style="height:${Math.max(3, Math.round(sek / maxSek * 100))}%" title="${stdFmt(sek)}"></div>
              <span class="balken-label">${WOCHENTAGE[i].slice(0, 2)}</span></div>`).join("")}
            <div class="balken-saeule balken-summe">
              <div class="balken" style="height:${Math.max(3, Math.round(woche.summe / maxSek * 100))}%" title="${stdFmt(woche.summe)}"></div>
              <span class="balken-label">Summe</span></div>
          </div>
        </div>
        <div class="tabelle-huelle"><table class="tabelle">
          <thead><tr>${WOCHENTAGE.map((t) => `<th class="rechts">${t.slice(0, 2)}</th>`).join("")}<th class="rechts">Summe</th></tr></thead>
          <tbody><tr>${woche.tage.map((sek) => `<td class="rechts">${stdFmt(sek)}</td>`).join("")}
            <td class="rechts" style="font-weight:600">${stdFmt(woche.summe)}</td></tr></tbody>
        </table></div>
        <p style="margin-top:16px"><a href="/crm/team" class="caption">← Zurück zur Team-Leistung</a></p>`));
    } catch (err) { next(err); }
  });
};
