// Flowstate CRM — Oberflaeche nach Estera-Vorbild, Flowstate-Inhalte.
const express = require("express");
const crm = require("./crm.js");
const { schale } = require("./schale.js");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const geld = (n) => (n == null ? "–" : Math.round(Number(n)).toLocaleString("de-DE") + " €");
// Die Quotentabelle stand bis zum 27.07. hier. Sie liegt jetzt in
// lib/pipeline-quoten.js, weil die Zentrale denselben Forecast zeigt — mit
// einer zweiten Kopie waere die erste Aenderung an einer Stufe die letzte
// gewesen, bei der beide Seiten dieselbe Zahl nennen. Inhalt unveraendert.
const { STUFEN_QUOTE, stufenPlatz, wahrsch } = require("./pipeline-quoten.js");

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
  // Kein Anrufergebnis, sondern ein Aussortieren VOR dem Anruf: Die Seite ist
  // schon gut, ein Redesign waere keine Hilfe. Eigene Liste, damit diese Leads
  // nicht bei den Absagen liegen — abgesagt hat hier niemand.
  "webseite-zu-gut": "Webseite zu gut",
};

// Ergebnis des Anrufs — steuert, in welche Liste der Lead wandert.
const ERGEBNISSE = {
  "nicht-erreicht": "Nicht erreicht",
  "keine-zeit": "Später nochmal",
  "gebucht": "Erstgespräch gebucht",
  "absage": "Nein",
  "webseite-zu-gut": "Webseite zu gut — nicht anrufen",
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
// PROJEKT_STAende stand hier: drei allgemeine Staende (Onboarding, In Umsetzung,
// Live) als reines Textfeld. Am 28.07. ersetzt durch die ECHTEN Phasen der
// Projektabwicklung je Bereich — sie kommen jetzt aus pipeline_stages, und was
// in der Akte gewaehlt wird, steht danach als Karte auf dem Brett.
// Siehe crm.projektStufen() und crm.projektStufeSetzen().
// Wie weit die Rechnung bezahlt ist.
const RECHNUNG_STAende = {
  offen: "Noch nicht bezahlt",
  "50": "50 % angezahlt",
  "100": "Voll bezahlt",
};

// Gesamtwert eines Deals: einmaliges Setup plus die monatliche Gebuehr ueber die
// vereinbarte Laufzeit. Ist keine Laufzeit gewaehlt, zaehlt EIN Monat: der
// Umsatz soll nicht behaupten, was niemand vereinbart hat. Die Zahl faellt dann
// sichtbar klein aus — und wer sie sieht, traegt die Laufzeit nach. Zwoelf
// Monate anzunehmen wuerde denselben Fehler still und gross machen.
// Fehlen Setup und Retainer beide, zaehlt der Deal-Wert. Der Erfolgsbonus ist
// Freitext ("200 EUR pro Lead") und daher nicht berechenbar — er wird nur als
// Hinweis angezeigt.
function gesamtWert(d) {
  const setup = Number(d.preis_setup) || 0;
  const monatlich = Number(d.preis_monatlich) || 0;
  if (!setup && !monatlich) return Number(d.wert) || 0;
  // Dieselbe Tabelle wie in crm.js, wo der Abschluss entsteht. Bis zum 28.07.
  // gab es hier eine zweite Kopie, die bei fehlender Laufzeit mit zwoelf
  // Monaten rechnete, waehrend der Umsatz nur einen zaehlte — zwei Zahlen fuer
  // denselben Kunden, je nachdem, wo man hinsah.
  return setup + monatlich * crm.monateJeLaufzeit(d.vertrag_laufzeit);
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

// DEMO_ANRUFE stand hier: erfundene Anrufzahlen je Branche, 20 Zeilen. Sie war
// toter Code — die Seite rechnet laengst mit crm.anrufStatistik() aus den echten
// Anrufen. Am 28.07. entfernt.
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
// trennerVorgabe: erzwingt ein Trennzeichen. Ohne Vorgabe wird geraten — und
// das Raten lag falsch, sobald Tabulatoren UND Kommas vorkamen: eine aus Excel
// kopierte Zeile ist mit Tabs getrennt, enthaelt aber Kommas in Adressen
// ("Karlsfelder Str. 35, 80995 München") und in Freitexten. Die alte Regel
// ("Tab nur, wenn gar kein Komma da ist") entschied sich dann fuers Komma und
// zerlegte jede Adresse in zwei Spalten.
function csvZerlegen(text, trennerVorgabe = null) {
  const trenner = trennerVorgabe
    || (text.includes("\t") ? "\t" : text.includes(";") && !text.includes(",") ? ";" : ",");
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
  // Ab 29.07.: echte Lead-Listen bringen mehr mit als die sechs Felder von
  // frueher. Adresse, PLZ und E-Mail wurden bis dahin stillschweigend
  // weggeworfen — man hatte die Daten in der Hand und musste sie hinterher
  // von Hand nachtragen.
  email: ["email", "emailadresse", "mail", "mailadresse", "epost"],
  adresse: ["adresse", "strasse", "straße", "anschrift", "strassehausnummer"],
  plz: ["plz", "postleitzahl", "zip"],
};

// Eine Kopfzeile ist NICHT "plz" allein — "PLZ" faengt mit demselben Wort an
// wie nichts anderes, aber "Ort" steckt in "Ortschaft" und in vielen Namen.
// Darum wird streng verglichen, sobald der Titel kurz ist.
const SPALTEN_FELDER = Object.keys(SPALTEN_NAMEN);
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

// Zeilen -> Leads. Eine Stelle fuer beide Wege (Link und Einfuegen): vorher las
// nur der Link-Weg die Kopfzeile, das Einfuegen nahm eine feste Reihenfolge an.
// Wer eine echte Lead-Liste einfuegte, bekam Kategorie als Ort und PLZ als
// Berufsbezeichnung — sichtbar erst, wenn man einen Lead aufmachte.
function zeilenZuLeads(zeilen) {
  if (!zeilen.length) return [];
  const hol = (z, i) => (i === undefined ? "" : (z[i] || "").trim());
  const zu = spaltenZuordnen(zeilen[0]);
  const baue = (z, k) => Object.fromEntries(SPALTEN_FELDER.map((f) => [f, hol(z, k[f])]));
  if (zu) return zeilen.slice(1).map((z) => baue(z, zu)).filter((l) => l.name);

  // Keine erkennbare Kopfzeile -> die alte feste Reihenfolge annehmen.
  //
  // Erkannt wird eine Kopfzeile erst ab drei zuordenbaren Spalten (sonst waere
  // "Praxis Nord | München | ..." eine). Bei zwei Spalten greift das nicht —
  // und dann wurde die Kopfzeile selbst zum Lead: ein Eintrag namens "Firma".
  // Darum hier zusaetzlich der einfache Blick aufs erste Feld.
  const fest = { name: 0, ort: 1, branche: 2, chef: 3, telefon: 4, website: 5 };
  const leads = zeilen.map((z) => baue(z, fest)).filter((l) => l.name);
  if (leads.length && SPALTEN_NAMEN.name.includes(leads[0].name.toLowerCase().trim())) leads.shift();
  return leads;
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
  return zeilenZuLeads(zeilen);
}

// PROBE_LEADS stand hier: rund dreissig erfundene Betriebe mit Namen, Inhabern,
// Orten und Telefonnummern, aufgeteilt auf die drei Sparten. Auch das war toter
// Code — verwendet hat sie keine Zeile. Am 28.07. entfernt, zusammen mit den
// uebrigen Beispieldaten. Erfundene Telefonnummern in einem CRM sind besonders
// heikel: sie sehen bis zur Ziffer aus wie echte Kontakte.
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
      req.session.crm = u;
      // Anmelden startet die Uhr. Wurde heute schon gearbeitet, laeuft sie vom
      // bisherigen Stand weiter — 2:51 vor dem Mittagessen heisst 2:51 danach.
      // zeitStart ist absichtlich gutmuetig: laeuft sie schon, passiert nichts.
      try { await crm.zeitStart(u); }
      catch (fehler) { console.error("Zeit beim Anmelden nicht gestartet:", fehler.message); }
      res.redirect("/crm");
    } catch { res.redirect("/crm/anmelden?fehler=1"); }
  });
  // Abmelden gilt fuers ganze OS — sonst bliebe man im OS drin, aber aus dem CRM raus.
  // Vorher die Uhr anhalten: waehrend man abgemeldet ist, laeuft keine Arbeitszeit.
  // Der Stand bleibt stehen und laeuft beim naechsten Anmelden von dort weiter.
  app.get("/crm/abmelden", async (req, res) => {
    const u = req.session && req.session.crm;
    if (u) {
      try { await crm.zeitPause(u); }
      catch (fehler) { console.error("Zeit beim Abmelden nicht angehalten:", fehler.message); }
    }
    req.session.destroy(() => res.redirect("/login"));
  });
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

      // Hier standen bis zum 28.07. sechzehn erfundene To-Dos ("Angebot schicken
      // — Physiotherapie Schwabing", Telefonnummern, Ansprechpartner). Sie sprangen
      // ein, sobald es keine echten gab, damit die Seite nicht leer wirkt. Vor dem
      // Einpflegen der echten Kunden ist das genau falsch herum: eine Tafel voller
      // erfundener Aufgaben mit erfundenen Praxisnamen sieht aus wie Arbeit, die
      // niemand hat — und man erkennt nicht, ob eine Zeile echt ist.
      //
      // Jetzt zeigt die Tafel nur, was in der Datenbank steht. Ist nichts da,
      // sagt sie das und zeigt den Weg zum Anlegen.
      // Echte To-Dos aus der Datenbank — das sind die, die in einer Kundenakte oder
      // unter "To-Dos" angelegt wurden und fuer heute eingeplant sind. Nur wenn es
      // noch gar keine gibt, zeigen wir die Beispiele, damit die Seite nicht leer wirkt.
      // Telefon, E-Mail, Ort und die Ansprechperson standen hier bis zum 28.07.
      // fest auf "" — das Detailfenster hatte die Felder, aber nie einen Wert.
      // Es sah aus, als waeren die Daten in der Kundenakte nicht gepflegt, dabei
      // wurden sie schlicht nie mitgeholt. crm.todosHeute() liefert sie jetzt mit.
      const echteTodos = (todosHeute || []).map((t) => ({
        titel: t.titel,
        kunde: t.firma_name || "",
        thema: t.firma_name ? "" : "Allgemein",
        // Faerbt die Karte: webdesign blau, performance orange, ki weinrot.
        sparte: t.sparte || "",
        wichtigkeit: Number(t.wichtigkeit) || 3,
        dringlichkeit: t.dringlichkeit || "Bald",
        faellig: t.faellig ? datum(t.faellig) : "",
        // "An wen" ist die Ansprechperson des Kunden — bei einer Aufgabe ohne
        // Kunde gibt es niemanden, dann bleibt das Feld leer statt zu raten.
        empfaenger: t.geschaeftsfuehrer
          ? t.geschaeftsfuehrer + (t.ansprech_rolle ? ` · ${t.ansprech_rolle}` : "")
          : "",
        beschreibung: t.notiz || "",
        telefon: t.telefon || "", email: t.email || "", ort: t.ort || "",
        firmaId: t.firma_id,
      }));
      const todoQuelle = echteTodos;
      // Bei einer Sparte nur deren To-Dos; bei Gesamt alle. Der Original-Index (i) bleibt
      // erhalten, damit Grid und Detail-Dialog zusammenpassen.
      const sichtbareTodos = todoQuelle.map((t, i) => ({ t, i }))
        .filter(({ t }) => !sparte || !t.sparte || t.sparte === sparte);
      const DRING_FARBE = { "Extrem dringend": "b-rot", "Dringend": "b-rot", "ASAP": "b-bernstein", "Bald": "b-blau", "Wenn Zeit da ist": "" };
      // Kommt seit dem 28.07. aus lib/crm.js — dieselbe Liste benutzen jetzt
      // auch das Formular unter /crm/todos und die Tafel unter /todos.
      const SPALTEN_TODO = crm.WICHTIGKEITEN;
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

      // Der Gesamt-Trichter zeigt seit dem 28.07. ECHTE Zahlen.
      //
      // Vorher standen hier feste Werte (128 Neu, 86 Follow-up, 47 Erstgespräch …)
      // und dahinter ein Dialog, der aus vierzehn erfundenen Praxen mit erfundenen
      // Telefonnummern beliebig viele Zeilen erzeugte. Auf einer Seite, auf der
      // sonst echte Deals stehen, ist so etwas nicht als Platzhalter erkennbar.
      //
      // Stattdessen werden jetzt die Trichter aller Sparten zusammengelegt. Dass
      // die Stufen dabei ueber stufenGruppe() zusammengefasst werden, ist noetig:
      // "Erstgespräch" (Webdesign) und "Readiness-Check gebucht" (KI) sind
      // dieselbe Stufe unter zwei Namen — ohne das Zusammenfassen stuenden sie
      // als zwei Zeilen untereinander und der Trichter haette eine Stufe zu viel.
      const gesamtStufen = [];
      boards.forEach((b) => b.forEach((s, i) => {
        const g = stufenGruppe(s.name);
        let eintrag = gesamtStufen.find((x) => x.schluessel === g.schluessel);
        if (!eintrag) {
          eintrag = { schluessel: g.schluessel, name: g.label, platz: stufenPlatz(s.name), n: 0, wert: 0 };
          gesamtStufen.push(eintrag);
        }
        eintrag.n += s.deals.length;
        eintrag.wert += s.deals.reduce((m, d) => m + Number(d.wert || 0), 0);
      }));
      // Nach Abschlusschance sortiert — das ist die Reihenfolge des Trichters.
      gesamtStufen.sort((a, b) => a.platz - b.platz);
      // Kumulativ wie beim Sparten-Trichter: "diese Stufe erreicht" zaehlt die
      // spaeteren Stufen mit, sonst waere es kein Trichter, sondern ein Balkendiagramm.
      const gKum = gesamtStufen.map((_, i) => gesamtStufen.slice(i).reduce((a, s) => a + s.n, 0));
      const gKumW = gesamtStufen.map((_, i) => gesamtStufen.slice(i).reduce((a, s) => a + s.wert, 0));
      const gMax = Math.max(1, ...gKum);
      const trichterGesamt = gesamtStufen.map((s, i) => {
        const n = gKum[i], breite = Math.max(14, Math.round((n / gMax) * 100));
        return `<div class="trichter-zeile"><div class="trichter-spur">
          <div class="trichter-balken" style="width:${breite}%;background:var(--stage-${(i % 8) + 1})">${n}</div></div>
          <div class="trichter-info"><strong>${e(s.name)} · ${wahrsch(gesamtStufen.length, i, s.name)} %</strong><span>${gKumW[i] ? geld(gKumW[i]) : "—"}</span></div></div>`;
      }).join("");
      const gesamtHatDeals = gKum[0] > 0;


      // Donut: Leads nach Quelle.
      //
      // Zaehlt seit dem 28.07. die ECHTEN Leads aus firmen.quelle. Vorher stand
      // hier eine feste Verteilung (42 Cold Calling, 28 Empfehlung, 24 Meta Ads …),
      // die sich zufaellig auf 128 summierte — dieselbe Zahl, die auch im
      // Dummy-Trichter oben stand. Zwei erfundene Zahlen, die zueinander passten,
      // sind noch schwerer als Erfindung zu erkennen als eine einzelne.
      //
      // Die Farben kommen aus der Graphit-Rampe des Deko-Objekts (siehe Kopf von
      // public/crm.css) — dieselbe Achse wie Karten, Trichter und Rail, damit der
      // Ring nicht als Fremdkoerper auf der Karte liegt.
      const QUELL_FARBEN = ["#16181C", "#343941", "#565C65", "#7C838C", "#A6ACB4"];
      // Nur Leads, und nur die mit einer Quelle — "ohne Angabe" waere die groesste
      // Scheibe und wuerde die Aussage auffressen. Wie viele das sind, steht unter
      // dem Ring.
      const leadsFuerDonut = alle.filter((f) => f.status === "lead");
      const quellZaehler = new Map();
      for (const f of leadsFuerDonut) {
        const q = String(f.quelle || "").trim();
        if (!q) continue;
        quellZaehler.set(q, (quellZaehler.get(q) || 0) + 1);
      }
      // Die fuenf haeufigsten; alles darunter faellt in "Sonstige", damit der Ring
      // nicht in zwanzig Splitter zerfaellt.
      const sortiert = [...quellZaehler.entries()].sort((a, b) => b[1] - a[1]);
      const qListe = sortiert.length > 5
        ? [...sortiert.slice(0, 4), ["Sonstige", sortiert.slice(4).reduce((a, [, n]) => a + n, 0)]]
        : sortiert;
      const ohneQuelle = leadsFuerDonut.length - [...quellZaehler.values()].reduce((a, n) => a + n, 0);
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
                  <stop offset="0%" stop-color="var(--blau-600)" stop-opacity=".44"/>
                  <stop offset="42%" stop-color="var(--blau-500)" stop-opacity=".2"/>
                  <stop offset="100%" stop-color="var(--blau-400)" stop-opacity="0"/></linearGradient>
                  <linearGradient id="ln" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="var(--blau-400)"/><stop offset="100%" stop-color="var(--blau-900)"/></linearGradient></defs>
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
            <div class="karte-kopf"><div><h2>Heute zu tun${
              sichtbareTodos.length ? ` <span class="badge">${sichtbareTodos.length}</span>` : ""}</h2>
              <div class="sub">Für heute geplant — Spalte ist die Wichtigkeit, das Abzeichen die Dringlichkeit.</div></div>
              <a href="/crm/todos" class="caption">Alle To-Dos →</a></div>
            ${sichtbareTodos.length ? `<div class="heute-spalten">
              ${SPALTEN_TODO.map((sp) => `<div class="heute-spalte">
                <div class="heute-spalte-kopf">${e(sp.titel)}</div>
                ${sichtbareTodos.filter((x) => x.t.wichtigkeit === sp.n).map(({ t, i }) => `<div class="heute-todo${
                  t.sparte ? ` sp-${e(t.sparte)}` : ""} ${["Extrem dringend", "Dringend"].includes(t.dringlichkeit) ? "heute-todo--dringend" : ""}" onclick="document.getElementById('todo-dlg-${i}').showModal()">
                  <button type="button" class="todo-haken" title="Als erledigt abhaken" onclick="event.stopPropagation(); this.closest('.heute-todo').remove()">${ICON.check}</button>
                  <div class="heute-todo-text">
                    <div class="heute-todo-titel">${e(t.kunde || t.thema || "Allgemein")}</div>
                    <span class="heute-todo-kunde">${e(t.titel)}</span>
                    <span class="badge dring ${DRING_FARBE[t.dringlichkeit] || ""}">${e(t.dringlichkeit)}</span>
                  </div></div>`).join("") || `<p class="caption" style="font-size:12px">—</p>`}
              </div>`).join("")}
            </div>`
            : `<div class="leer">
              <div class="leer-icon">${ICON.check}</div>
              <h3>Für heute ist nichts eingeplant</h3>
              <p>To-Dos entstehen in einer Kundenakte oder unter „To-Dos". Was dort einen Tag
                 bekommt, steht an dem Tag hier.</p>
              <p style="margin-top:16px"><a class="knopf sekundaer" href="/crm/todos">To-Do anlegen</a></p>
            </div>`}
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
              ${istGesamt
                ? (gesamtHatDeals
                    ? `<div class="trichter">${trichterGesamt}</div>`
                    : `<p class="caption">Noch keine offenen Deals. Leg bei einem Lead einen Deal an — er erscheint dann hier.</p>`)
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
            ${qListe.length ? `<div class="donut-block">
              <div class="donut"><svg width="186" height="186">${donutSeg}</svg>
                <div class="donut-mitte"><div><b>${qGesamt}</b><span class="caption">Leads</span></div></div></div>
              <div class="donut-legende">${donutLeg}</div>
            </div>
            ${ohneQuelle ? `<p class="caption" style="margin-top:12px">${ICON.info}
              ${ohneQuelle} ${ohneQuelle === 1 ? "Lead hat" : "Leads haben"} keine Quelle hinterlegt und
              ${ohneQuelle === 1 ? "fehlt" : "fehlen"} im Ring.</p>` : ""}`
            : `<p class="caption">Noch keine Leads mit hinterlegter Quelle. Die Quelle wird beim
                 Anlegen eines Leads gesetzt — danach steht hier, was am besten funktioniert.</p>`}</div>
          <div style="max-width:230px">
            ${kachel("Gescheiterte Deals", gescheitertAnzahl, ICON.trendAb, "rot", `<span class="caption">Wert: ${geld(gescheitertWert)}</span>`)}
          </div>
        </div>`;

      // Pipeline-Volumen (nur Gesamtsicht): ein ausfuehrlicher Kasten "Volumen je Sparte".
      // Die Eintraege in der Pipeline sind offene LEADS (noch keine gewonnenen Deals).
      //
      // Bis zum 28.07. sprangen hier Demo-Zahlen ein, sobald die echte Pipeline leer
      // war (Performance 13.000 \u00b7 KI 7.000 \u00b7 Webdesign 6.000). Gemeint war "damit man
      // sieht, wie es aussehen wird" \u2014 gelesen hat es sich wie ein Kontostand.
      // Jetzt zeigt der Kasten die echten Zahlen, und wenn es keine gibt, sagt er das.
      const pvDaten = [...auswertung].sort((a, b2) => b2.volumen - a.volumen);
      const pvVolGesamt = pvDaten.reduce((a, x) => a + x.volumen, 0);
      const pvGewGesamt = pvDaten.reduce((a, x) => a + x.gewichtet, 0);
      const pvLeadsGesamt = pvDaten.reduce((a, x) => a + x.anzahl, 0);
      const pvMax = Math.max(1, ...pvDaten.map((x) => x.volumen));
      ansichten.pipeline = pvVolGesamt === 0 ? `
        <div class="karte"><div class="leer">
          <div class="leer-icon">${ICON.trend}</div>
          <h3>Noch kein Pipeline-Volumen</h3>
          <p>Hier steht, wie viel offenes Volumen in Webdesign, Performance Marketing und
             KI-Projekten steckt — und was davon gewichtet realistisch ist. Sobald der erste
             Deal angelegt ist, füllt sich der Kasten.</p>
        </div></div>` : `
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
                  // Welches Datum zeigt die Karte? Reihenfolge ab 28.07.:
                  //   1. nächster Termin — ein vereinbarter Termin schlägt alles,
                  //      er steht fest und der Kunde weiß davon
                  //   2. fällig bis — die selbstgesetzte Frist
                  //   3. Erstgespräch — solange nichts anderes vereinbart ist
                  // Vorher hing es allein an der Phase: Ein eingetragener nächster
                  // Termin war auf der Karte nirgends zu sehen, obwohl er das
                  // Wichtigste ist, was über einen Deal bekannt sein kann.
                  const gespraech = GESPRAECHS_PHASE(s.name);
                  // Vorbelegt, nicht undefiniert: hat eine Karte gar kein Datum,
                  // greift keiner der drei Zweige unten — und auf der Karte stand
                  // wortwoertlich "undefined — noch offen".
                  let terminText = "kein Termin", terminWert = null;
                  if (d.naechster_termin) {
                    terminText = "nächster Termin"; terminWert = d.naechster_termin;
                  } else if (d.faellig_am) {
                    terminText = "fällig bis"; terminWert = d.faellig_am;
                  } else if (d.erstgespraech_am) {
                    terminText = gespraech || "Erstgespräch am"; terminWert = d.erstgespraech_am;
                  }
                  // Überfällig ist nur eine verstrichene FRIST. Ein vergangener
                  // Gesprächstermin ist kein Versäumnis, sondern ein gelaufenes
                  // Gespräch — den rot zu färben wäre schlicht falsch.
                  const ueberfaellig = terminText === "fällig bis"
                    && terminWert && new Date(terminWert) < new Date(heuteFeld());
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
                      : `<div class="deal-termin offen">${ICON.kalender}<span>${
                          terminText === "kein Termin" ? "kein Termin eingetragen" : terminText + " — noch offen"}</span></div>`}
                    <div class="deal-marken">
                      <span class="badge deal-sparte">${e(SPARTEN[d.sparte] || d.sparte)}</span>
                      ${d.quelle ? `<span class="badge">${e(d.quelle)}</span>` : ""}</div>
                    <div class="deal-fuss">
                      <!-- Verantwortlich steht auf der Karte, nicht nur der
                           Name: „Person X" allein liess offen, ob das der
                           Betreuer oder der ist, der den Kunden geholt hat.
                           Weicht beides voneinander ab, steht der Werber
                           daneben — sonst wäre die Zeile doppelt gemoppelt. -->
                      <span class="deal-wer" title="Verantwortlich — betreut ${e(d.firma_name)}${
                        d.gewonnen_name ? `, geholt von ${e(d.gewonnen_name)}` : ""}">${ICON.person}${
                        e(d.besitzer_name || "—")}${d.gewonnen_name && d.gewonnen_name !== d.besitzer_name
                          ? `<i class="deal-werber">← ${e(d.gewonnen_name.split(" ")[0])}</i>` : ""}</span>
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
              ${firmen.filter((f) => f.status !== "verloren")
                .map((f) => `<option value="${f.id}">${e(f.name)}${f.ort ? " — " + e(f.ort) : ""}</option>`).join("")}</select></div>
            <p class="caption" style="margin:-6px 0 12px">Verlorene Kunden stehen nicht zur Auswahl —
              hol sie erst in ihrer Akte zurück.</p>
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
            ${/* Wichtigkeit und Dringlichkeit (28.07.): Dieses Formular kannte beide
                 nicht, obwohl die Kundenakte sie laengst abfragt und die Spalten von
                 "Heute zu tun" darauf beruhen. Alles, was hier angelegt wurde, landete
                 stumm auf Wichtigkeit 3 und ganz ohne Dringlichkeit — auf der Tafel
                 unter /todos stand es damit in der dritten Spalte ohne Abzeichen, und
                 es sah aus, als fehle die Angabe im Programm statt in den Daten. */""}
            <div class="feld-paar">
              <div class="feld"><label>Wichtigkeit <span class="caption">was es bringt</span></label>
                <select name="wichtigkeit">
                  ${crm.WICHTIGKEITEN.map((s) => `<option value="${s.n}"${s.n === 3 ? " selected" : ""}>${e(s.titel)}</option>`).join("")}
                </select></div>
              <div class="feld"><label>Dringlichkeit <span class="caption">wann es weg muss</span></label>
                <select name="dringlichkeit">
                  ${crm.DRINGLICHKEITEN.map((d) => `<option value="${e(d)}"${d === "Bald" ? " selected" : ""}>${e(d)}</option>`).join("")}
                </select></div>
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
      // Wessen Liste? Am Telefon arbeitet JEDER seine eigene — auch die
      // Geschaeftsfuehrung. Bis zum 29.07. sah ein Admin hier alle Leads und
      // alle Anrufe: Bei Jannik standen Ioannis' 448 Leads und dessen zwoelf
      // Anrufe, als waeren es seine. Eine Liste, die man abtelefoniert, muss
      // die eigene sein, sonst ruft man Leute an, die schon jemand hatte.
      //
      // Die Geschaeftsfuehrung kann auf "Alle" stellen — fuer den Blick von
      // oben, nicht fuer die Arbeit. Vorbelegt ist die eigene Liste.
      const istChef = u.rolle === "admin";
      const wer = istChef && req.query.wer === "alle" ? "alle" : "meine";
      const nurVon = wer === "meine" ? u.id : null;
      const alleLeads = await crm.firmenListe(u, { suche, limit: 500, besitzer: nurVon });
      const hatTag = (f, t) => (f.tags || []).includes(t);
      const ergebnisTags = ["gebucht", "absage", "nicht-erreicht", "keine-zeit", "webseite-zu-gut"];
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
      // Dieselbe Eingrenzung wie bei der Liste — sonst zeigte die Tabelle
      // Anrufe, die zu keinem der darunter stehenden Leads gehoeren.
      const stat = await crm.anrufStatistik(u, {
        sparte, branche, ohneSparte: sparte === "webdesign", besitzer: nurVon });
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
        + (suche ? "&suche=" + encodeURIComponent(suche) : "")
        + (wer === "alle" ? "&wer=alle" : "");
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
            <div class="anruf-stat-kopf"><h2>${wer === "meine" ? "Meine Anrufe" : "Anrufe im Team"}</h2>
              <span class="caption">${branche ? e(BRANCHEN[branche]) : "über alle Branchen"} · ${e(SPARTEN[sparte])}</span>
              ${istChef ? `<nav class="wer-schalter">
                <a href="${q(sparte, liste)}" class="${wer === "meine" ? "aktiv" : ""}">Meine Liste</a>
                <a href="${q(sparte, liste)}&wer=alle" class="${wer === "alle" ? "aktiv" : ""}">Alle</a>
              </nav>` : ""}</div>
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
            <!-- Einfügen steht VORNE, der Link darunter. Vorher war es
                 umgekehrt und das Einfügen hinter einem zugeklappten "Kein
                 Link?" versteckt — wer eine Excel-Datei hat (also fast jeder),
                 las oben "Link zur Tabelle" und kam nicht weiter. Excel lässt
                 sich nicht verlinken; kopieren kann man daraus immer. -->
            <label>Zeilen aus Excel einfügen</label>
            <p class="sub" style="margin:4px 0 8px">In Excel die Zeilen markieren, <b>Cmd+C</b>,
              hier hinein <b>Cmd+V</b>. Die Kopfzeile darf mit — sie wird erkannt und übersprungen.</p>
            <textarea id="ln-liste" rows="8" placeholder="Firma	Kategorie	Adresse	PLZ	Ort	Telefon	Ansprechpartner	E-Mail	Website
Wiese Elektroanlagen	Elektriker	Karlsfelder Str. 35	80995	München	+49 89 3149357			wiese-elektroanlagen.de"></textarea>
            <div class="lead-neu-spalten" style="margin-top:10px">Die Kopfzeile wird gelesen — <b>die Reihenfolge der Spalten ist egal</b>.<br>
              <span style="font-weight:400">Erkannt werden: Firma · Kategorie/Branche · Adresse · PLZ · Ort ·
                Telefon · Ansprechpartner · E-Mail · Website. Weitere Spalten (Score, Notizen …)
                werden übergangen. Nur <b>Firma</b> ist Pflicht.<br>
                Doppelte Firmen und Telefonnummern werden übersprungen, nicht doppelt angelegt.</span></div>

            <details class="lead-neu-alt">
              <summary>Oder: Link zu Google Sheets / CSV</summary>
              <p class="sub" style="margin:8px 0">Bei Google Sheets muss die Freigabe auf
                <b>„Jeder mit dem Link"</b> stehen, sonst kommt der Server nicht heran.
                Eine Excel-Datei auf deinem Rechner hat keinen Link — nimm dafür das Feld oben.</p>
              <input id="ln-link" placeholder="https://docs.google.com/spreadsheets/…">
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
                h.textContent='Bitte die Zeilen aus Excel einfügen — oder einen Link angeben.'; return; }
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
                var uebrig=j.uebersprungen.length;
                // Wenn NICHTS angelegt wurde, ist das keine Erfolgsmeldung.
                // Vorher blitzte "0 Leads angelegt · 150 übersprungen" kurz auf
                // und die Seite lud neu — man stand vor einer leeren Liste und
                // wusste nicht, warum. Jetzt bleibt die Meldung stehen, nennt
                // die Besitzer und laedt nicht neu: Es gibt nichts Neues zu
                // sehen, aber etwas zu entscheiden.
                if(!j.angelegt && uebrig){
                  h.className='lead-neu-hinweis warn';
                  var wem=(j.gehoeren||[]).map(function(x){return x.n+'× '+x.wer;}).join(', ');
                  h.textContent='Nichts angelegt — alle '+uebrig+' Firmen gibt es schon'
                    +(wem?' ('+wem+')':'')+'. Doppelte werden übersprungen, damit nicht zwei Leute '
                    +'denselben Betrieb anrufen.';
                  k.disabled=false;
                  return;
                }
                h.className='lead-neu-hinweis erfolg';
                h.textContent=j.angelegt+(j.angelegt===1?' Lead angelegt':' Leads angelegt')
                  +(uebrig?' · '+uebrig+' gab es schon (übersprungen)':'');
                setTimeout(function(){location.reload();},1200);
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
          //
          // "Webseite zu gut" ist KEIN Anruf — der Lead wird beim Durchsehen der
          // Liste aussortiert, ohne zu telefonieren. Der Server zaehlt ihn auch
          // nicht mit; nur diese Anzeige hier hat bis zum 29.07. blind auf
          // "calls" addiert. Beim naechsten Laden der Seite sprang die Zahl dann
          // wieder zurueck — und wer das nicht bemerkt, arbeitet den Tag ueber
          // mit einer zu hohen Anrufzahl.
          var KEIN_ANRUF = ['webseite-zu-gut'];
          function statHoch(schluessel){
            if (KEIN_ANRUF.indexOf(schluessel) >= 0) return;
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
        // Dieselbe Kopfzeilen-Erkennung wie beim Link. Vorher nahm dieser Weg
        // eine feste Spaltenreihenfolge an — wer eine echte Lead-Liste einfügte
        // (Firma, Kategorie, Adresse, PLZ, Ort, Telefon …), bekam die Kategorie
        // als Ort und die PLZ als Berufsbezeichnung eingetragen. Auffallen
        // konnte das erst, wenn man einen Lead aufmachte.
        // Auch das Einfuegen laeuft durch csvZerlegen, nicht durch ein eigenes
        // Aufteilen an "\n" und "\t". Grund: Excel setzt Anfuehrungszeichen um
        // Zellen, die selbst einen Zeilenumbruch enthalten (lange Notizen,
        // Bewertungstexte). Ein naives Trennen an "\n" reisst so eine Zelle
        // mitten entzwei, und aus einem Lead werden drei kaputte.
        const roh = String(b.liste).replace(/\r\n/g, "\n");
        leads = zeilenZuLeads(csvZerlegen(roh, roh.includes("\t") ? "\t" : null));
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
      //
      // Die erlaubten Werte kommen aus ERGEBNISSE, nicht aus einer zweiten
      // Liste hier: Bis zum 29.07. stand hier eine Kopie, und ein neues
      // Ergebnis in der Auswahl wurde von der Route stumm abgewiesen — die
      // Maske bot es an, das Speichern lief ins Leere.
      if (ergebnis !== "" && !ERGEBNISSE[ergebnis]) {
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
      // "abschnitt" sagt, welcher Teil gespeichert wird.
      //
      // Seit dem 28.07. schickt die Akte "alles": sie ist EIN Formular mit EINEM
      // Speichern-Knopf, und dann muessen auch alle Abschnitte auf einmal durch.
      // Die einzelnen Namen bleiben gueltig — andere Stellen (die Dringlichkeit
      // in der Pipeline etwa) schicken weiterhin nur ihren Teil, und ein
      // Abschnitt, der nicht kommt, darf seine Felder nicht ueberschreiben.
      //
      // Genau dafuer ist "istAlles" da: Bei "alles" laufen ALLE Zweige, aber
      // jeder Zweig nimmt nur die Felder, die tatsaechlich mitgeschickt wurden.
      // Sonst wuerde das Speichern der Notizen die Preise leeren, weil deren
      // Felder in dieser Anfrage nun einmal nicht vorkamen.
      // Welche Abschnitte waren ueberhaupt auf der Seite? Jeder Kasten schickt
      // seinen Namen in "dabei" mit. Das ist noetig, weil die Akte je nach Lage
      // nicht alle Kaesten zeigt: Bei einem Lead gibt es weder Auftrag noch
      // Zahlungsstand. Ohne diese Liste wuerde ein Sammel-Speichern die Felder
      // dieser Kaesten als "leer abgeschickt" lesen und echte Werte loeschen —
      // ein Datenverlust, den niemand bemerkt, bis er die Akte wieder oeffnet.
      const dabei = Array.isArray(b.dabei) ? b.dabei : b.dabei ? [b.dabei] : [];
      const daten = {};
      const istAlles = b.abschnitt === "alles";
      const teil = (name) => (istAlles ? dabei.includes(name) : b.abschnitt === name);
      if (teil("bereich")) {
        // Nur der Bereich — die Stammdaten bleiben unberührt.
        if (b.sparte) daten.sparte = b.sparte;
      }
      if (teil("stammdaten")) {
        daten.quelle = QUELLEN.includes(b.quelle) ? b.quelle : "";
        if (b.besitzer) daten.besitzer = b.besitzer;
        // Wer den Kunden geholt hat (0047). Leer bedeutet „noch offen“ und
        // nicht „niemand“ — darum durchreichen statt zu erzwingen.
        if (b.gewonnen_durch !== undefined) daten.gewonnen_durch = b.gewonnen_durch || null;
        daten.ansprech_name = b.ansprech_name || "";
        daten.ansprech_rolle = ANSPRECH_ROLLEN.includes(b.ansprech_rolle) ? b.ansprech_rolle : "";
        daten.geschlecht = ["m", "w", "d"].includes(b.geschlecht) ? b.geschlecht : "";
      }
      if (teil("kontakt")) {
        daten.telefon = b.telefon || "";
        daten.email = b.email || "";
        daten.website = b.website || "";
        daten.ort = b.ort || "";
      }
      if (teil("stand")) {
        daten.rechnung_stand = RECHNUNG_STAende[b.rechnung_stand] ? b.rechnung_stand : "";
        // Der Retainer-Zaehler steht nur in der Maske, wenn ein Monatsbetrag
        // hinterlegt ist. Fehlt das Feld, darf der Stand nicht auf 0 fallen —
        // sonst loescht ein Speichern aus einem anderen Abschnitt die Monate.
        if (b.retainer_monate_bezahlt !== undefined) {
          const n = Number(b.retainer_monate_bezahlt);
          daten.retainer_monate_bezahlt = Number.isInteger(n) && n >= 0 && n <= 120 ? n : 0;
        }
        daten.vertrag_unterschrieben = b.vertrag_unterschrieben;
        // Die Projektphase ist keine Spalte an der Firma, sondern eine Karte auf
        // dem Brett — sie wird getrennt gesetzt, siehe unten nach kundeAendern.
      }
      if (teil("firma")) {
        daten.taetigkeit = b.taetigkeit || "";
        daten.mitarbeiter_zahl = b.mitarbeiter_zahl;
      }
      if (teil("auftrag")) {
        daten.preis_setup = b.preis_setup;
        daten.preis_monatlich = b.preis_monatlich;
        daten.kunde_seit = b.kunde_seit;
        daten.vertrag_laufzeit = LAUFZEITEN.includes(b.vertrag_laufzeit) ? b.vertrag_laufzeit : "";
        daten.erfolgsbonus = b.erfolgsbonus;
        daten.erfolgsbonus_text = b.erfolgsbonus === "ja" ? (b.erfolgsbonus_text || "") : "";
        if (b.hosting !== undefined) daten.hosting = b.hosting;
        if (b.leads_ziel !== undefined) daten.leads_ziel = b.leads_ziel;
        if (b.leads_ist !== undefined) daten.leads_ist = b.leads_ist;
      }
      if (teil("termine")) {
        daten.dringlichkeit = DRINGLICHKEIT[b.dringlichkeit] ? b.dringlichkeit : "";
        daten.erstgespraech_am = b.erstgespraech_am || "";
        daten.faellig_am = b.faellig_am || "";
        daten.naechster_termin = b.naechster_termin || "";
        daten.naechste_aufgabe = b.naechste_aufgabe || "";
      }
      if (teil("leistungen")) {
        daten.leistungen = mehrfach(b.leistungen, LEISTUNGEN);
        daten.kontakt_kanaele = mehrfach(b.kontakt_kanaele, KONTAKT_KANAELE);
      }
      if (teil("notizen")) {
        // Unveraendert durchreichen — kein trim, keine Kuerzung. Absaetze und
        // Einrueckungen sind Teil dessen, was jemand notiert hat.
        daten.notizen = b.notizen === undefined ? "" : String(b.notizen);
      }
      await crm.kundeAendern(req.nutzer, req.params.id, daten);

      // Projektphase: eigener Weg, weil sie nicht an der Firma haengt, sondern
      // eine Karte in der Projektabwicklung ist. Leere Auswahl heisst "noch
      // nicht gestartet" — dann wird nichts angelegt und nichts verschoben. Ein
      // vorhandenes Projekt zu loeschen, weil jemand die Auswahl zuruecksetzt,
      // waere zu weitgehend: die Karte kann auf dem Brett Notizen tragen.
      if (teil("stand") && b.projekt_stufe) {
        const r = await crm.projektStufeSetzen(req.nutzer, req.params.id, b.projekt_stufe);
        if (!r.ok) console.error("Projektphase nicht gesetzt:", r.grund);
      }

      // Preis und Zahlungsstand wirken jetzt in die Buchhaltung: steht ein
      // Betrag und ist die Rechnung als bezahlt markiert, entsteht daraus eine
      // Einnahme. Der Aufruf ist gefahrlos wiederholbar — er erkennt eine
      // frueher erzeugte Buchung wieder und aktualisiert sie, statt eine zweite
      // anzulegen (Migration 0042 sichert das zusaetzlich mit einem Index ab).
      // Zwei getrennte Wirkungen, weil es zwei getrennte Fragen sind:
      //
      //   dealAusAkte     → UMSATZ. Ein Kunde mit Preis ist gewonnenes
      //                     Geschäft, auch wenn noch nichts überwiesen wurde.
      //   einnahmeAusAkte → EINNAHMEN. Nur wenn „Rechnung voll bezahlt" steht,
      //                     also das Geld tatsächlich da ist.
      //
      // Beide sind wiederholbar: sie erkennen ihren früheren Eintrag wieder und
      // aktualisieren ihn, statt einen zweiten anzulegen.
      if (teil("auftrag") || teil("stand")) {
        const d = await crm.dealAusAkte(req.nutzer, req.params.id).catch((e) => ({ ok: false, grund: e.message }));
        if (!d.ok) console.error("Abschluss aus Kundenakte:", d.grund);
        const r = await crm.einnahmeAusAkte(req.nutzer, req.params.id).catch((e) => ({ ok: false, grund: e.message }));
        if (!r.ok) console.error("Einnahme aus Kundenakte:", r.grund);
      }

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
  // ------------------------------------------------------------ Kunde verloren
  app.post("/crm/firma/:id/verloren", async (req, res, next) => {
    try {
      const b = req.body || {};
      // Auswahl und Freitext werden zu einem Satz zusammengezogen: die Auswahl
      // macht die Liste "Verloren" auswertbar, der Freitext haelt fest, was
      // wirklich passiert ist.
      const grund = [String(b.grund_wahl || "").trim(), String(b.grund_text || "").trim()]
        .filter(Boolean).join(" — ");
      const r = await crm.kundeVerloren(req.nutzer, req.params.id, grund);
      if (!r.ok) return res.redirect(`/crm/firma/${req.params.id}?fehler=${encodeURIComponent(r.grund)}`);
      res.redirect("/crm/kunden?liste=verloren");
    } catch (err) { next(err); }
  });

  app.post("/crm/firma/:id/zurueckholen", async (req, res, next) => {
    try {
      await crm.kundeZurueckholen(req.nutzer, req.params.id);
      res.redirect(`/crm/firma/${req.params.id}`);
    } catch (err) { next(err); }
  });

  // ---------------------------------------------- Dokumente in der Kundenakte
  //
  // Die Datei kommt roh im Rumpf (siehe Skript in der Akte). express.raw steht
  // NUR an dieser Route, nicht global — sonst wuerde jedes normale Formular auf
  // der Seite als Binaerdatei gelesen.
  app.post("/crm/firma/:id/dokument",
    express.raw({ type: "application/octet-stream", limit: "24mb" }),
    async (req, res, next) => {
      try {
        if (!Buffer.isBuffer(req.body) || !req.body.length) {
          return res.status(400).json({ ok: false, grund: "keine-datei" });
        }
        const lies = (kopf, ersatz) => {
          try { return decodeURIComponent(req.get(kopf) || "") || ersatz; }
          catch { return req.get(kopf) || ersatz; }
        };
        const r = await crm.dokumentHochladen(req.nutzer, {
          firmaId: req.params.id,
          dateiname: lies("X-Dateiname", "Dokument"),
          dateityp: req.get("X-Dateityp") || null,
          art: lies("X-Art", "Sonstiges"),
          daten: req.body,
        });
        res.json(r);
      } catch (err) { next(err); }
    });

  app.get("/crm/dokument/:id/datei", async (req, res, next) => {
    try {
      const d = await crm.dokumentDatei(req.nutzer, req.params.id);
      if (!d || !d.daten) return res.status(404).send("Keine Datei vorhanden");
      res.setHeader("Content-Type", d.dateityp || "application/octet-stream");
      res.setHeader("Content-Disposition",
        `inline; filename="${String(d.dateiname || "dokument").replace(/["\\\r\n]/g, "")}"`);
      res.send(d.daten);
    } catch (err) { next(err); }
  });

  app.post("/crm/dokument/:id/loeschen", async (req, res, next) => {
    try {
      const r = await crm.dokumentLoeschen(req.nutzer, req.params.id);
      res.redirect(r.ok && r.firmaId ? `/crm/firma/${r.firmaId}` : "/crm/kunden");
    } catch (err) { next(err); }
  });

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
      // Die Phasen der Projektabwicklung fuer genau diesen Bereich, und in
      // welcher der Kunde gerade steht. Beides fuer die Auswahl weiter unten.
      // Retainer: wie lang der Vertrag laeuft und wie viel davon eingegangen
      // ist. MONATE_JE_LAUFZEIT liegt in crm.js, damit Anzeige und Buchung
      // dieselbe Tabelle benutzen — zwei Kopien waeren zwei Wahrheiten.
      const retainerMonate = crm.monateJeLaufzeit(f.vertrag_laufzeit);
      const retainerGesamt = (Number(f.preis_monatlich) || 0) * retainerMonate;
      const retainerBezahlt = (Number(f.preis_monatlich) || 0) * Number(f.retainer_monate_bezahlt || 0);
      const ANTEIL_SETUP = { "100": 1, "50": 0.5, offen: 0 };
      const setupBezahlt = (Number(f.preis_setup) || 0)
        * (ANTEIL_SETUP[String(f.rechnung_stand || "offen")] ?? 0);

      const [projektStufen, projektJetzt, dok] = await Promise.all([
        crm.projektStufen(u, kundenSparte).catch(() => []),
        crm.projektVonFirma(u, f.id, kundenSparte).catch(() => null),
        crm.dokumenteListe(u, f.id).catch(() => ({ eigene: [], rechnungen: [] })),
      ]);
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
          ${/* Notiz (28.07.): Der Titel einer Aufgabe ist eine Zeile — "Formular +
               Live stellen". Was genau zu tun ist, passte bisher nirgendwohin, und
               im Detailfenster stand deshalb unter "Was genau" nichts. Hier steht
               es, und dort erscheint es. */""}
          <input name="notiz" class="akte-todo-notiz"
            placeholder="Was genau? (optional) — erscheint im Detailfenster">
          <button type="submit" class="dunkel" title="Aufgabe anlegen">${ICON.plus}</button>
        </form>
        <p class="caption" style="margin-top:8px"><b>Zeigen am</b> bestimmt, an welchem Tag die Aufgabe im Dashboard
          unter „Heute zu tun" auftaucht. <b>Fertig bis</b> ist die Frist — sie steht hier und auf der To-Do-Liste.</p></div>`;

      res.send(rahmen(u, istKunde ? "kunden" : "leads", istKunde ? "Kundenakte" : "Lead-Akte", "", "", `
        <!-- EIN Formular für die ganze Akte (28.07.).
             Bis dahin hatte jeder Kasten seinen eigenen Speichern-Knopf — neun
             Stück. Wer Telefonnummer, Laufzeit und eine Notiz änderte, musste
             dreimal speichern, und wer einen Knopf übersah, verlor die Eingabe
             beim nächsten Klick ohne jede Warnung.

             Das Formular ist hier LEER und steht ganz oben. Die Eingabefelder
             liegen verteilt in den Kästen und hängen sich über form="akte"
             daran — ein HTML-Standard, den es genau für diesen Fall gibt.
             So bleiben die Aktions-Formulare daneben (Notiz anhängen, Deal
             anlegen, To-Do) eigenständig: sie dürfen NICHT mitgespeichert
             werden, und ineinander verschachtelte Formulare wären ungültig. -->
        <form id="akte" method="post" action="${mitHerkunft(`/crm/firma/${f.id}/kunde`, zurueck)}">
          <input type="hidden" name="abschnitt" value="alles">
        </form>
        <div class="akte-leiste-oben">
          <a class="akte-zurueck" href="${zurueck}">${ICON.pfeilLinks} Zurück zur Übersicht</a>
          <!-- Der Speichern-Knopf oben, wo man ihn sucht. Er haengt ueber
               form="akte" an demselben Formular wie die Leiste unten — egal
               welchen man drueckt, es wird dieselbe Akte im Ganzen gespeichert.
               "geaendert" setzt das Skript unten; ohne Aenderung bleibt der
               Knopf still, damit man nicht raet, ob es etwas zu speichern gibt. -->
          <div class="akte-speichern-oben">
            <span class="caption" id="speicher-hinweis-oben" hidden>Ungespeicherte Änderungen</span>
            <button type="submit" form="akte" class="dunkel" id="speichern-oben">
              ${ICON.check} Speichern</button>
          </div>
        </div>
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
            ${(istKunde || hatDeal) ? `<div class="akte-bereich" data-abschnitt="bereich">
              <input type="hidden" name="dabei" value="bereich" form="akte">
              <label>Bereich</label>
              <select form="akte" name="sparte">
                ${Object.entries(SPARTEN).map(([k, v]) => `<option value="${k}" ${kundenSparte === k ? "selected" : ""}>${e(v)}</option>`).join("")}
              </select></div>` : ""}
            ${f.telefon ? `<a class="knopf sekundaer" href="tel:${e(f.telefon)}">${ICON.telefon} Anrufen</a>` : ""}
            ${f.status === "verloren"
              ? `<form method="post" action="/crm/firma/${f.id}/zurueckholen"
                   onsubmit="return confirm('${e(f.name).replace(/'/g, "&#39;")} zurückholen?')">
                   <button type="submit" class="knopf sekundaer">Zurückholen</button></form>`
              : `<button type="button" class="knopf still verloren-knopf"
                   onclick="document.getElementById('dlgVerloren').showModal()"
                   title="Kunde springt ab">${ICON.x} Verloren</button>`}
          </div>
        </div>

        <!-- Der Grund ist Pflicht, darum ein Dialog und kein blosses confirm():
             ein Klick zum Wegklicken waere zu wenig Reibung fuer einen Schritt,
             der den Kunden aus allen Listen nimmt. -->
        <dialog id="dlgVerloren"><form method="post" action="/crm/firma/${f.id}/verloren">
          <h2>${e(f.name)} verloren</h2>
          <div class="sub">Der Kunde wandert in die Liste „Verloren".</div>
          <div class="feld"><label>Warum? *</label>
            <select name="grund_wahl" id="verloren-wahl">
              ${["Zu teuer", "Kein Bedarf mehr", "Zu anderem Anbieter gewechselt",
                 "Unzufrieden mit der Leistung", "Firma aufgegeben / insolvent",
                 "Kein Kontakt mehr möglich", "Anderer Grund"]
                .map((g) => `<option>${e(g)}</option>`).join("")}
            </select></div>
          <div class="feld"><label>Dazu (optional)</label>
            <input name="grund_text" placeholder="Was genau war der Auslöser?" maxlength="300"></div>
          <p class="caption" style="margin:-4px 0 12px">
            Laufende Projekte werden abgebrochen, offene Deals und Aufgaben geschlossen.
            <b>Umsatz und Buchungen bleiben unangetastet</b> — was er gezahlt hat, hat er gezahlt.</p>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="document.getElementById('dlgVerloren').close()">Abbrechen</button>
            <button type="submit" class="dunkel">Als verloren markieren</button></div>
        </form></dialog>
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
            <!-- Notizen (28.07.): steht ueber dem Verlauf, weil es das ist, was
                 man beim Oeffnen einer Akte zuerst lesen will. Der Verlauf ist
                 das Protokoll darunter — er beantwortet "was ist passiert",
                 die Notizen beantworten "was muss ich wissen".
                 Gespeichert wird nur auf Knopfdruck: ein Feld, das beim
                 Wegklicken speichert, verliert irgendwann etwas. -->
            <div class="karte akte-notizen"><div class="karte-kopf"><div><h2>Notizen</h2>
              <div class="sub">Alles, was sonst nirgends hinpasst — Absprachen, Zugänge, wer wen kennt</div></div></div>
              <div data-abschnitt="notizen">
              <input type="hidden" name="dabei" value="notizen" form="akte">
                <textarea form="akte" name="notizen" rows="8" placeholder="Was man über ${e(f.name)} wissen sollte …"
                  >${e(f.notizen || "")}</textarea>
                <div class="akte-notizen-fuss">
                  <span class="caption">Wird erst mit „Speichern“ übernommen.</span>
                  
                </div>
              </div>
            </div>
            <div class="karte"><div class="karte-kopf"><h2>Verlauf</h2></div>
              ${f.historie.map((h) => `<div class="feed-eintrag">
                <div class="feed-icon ${h.art === "anruf" ? "blau" : h.art === "stufenwechsel" ? "gruen" : ""}">${h.art === "anruf" ? ICON.telefon : h.art === "stufenwechsel" ? ICON.trend : ICON.notiz}</div>
                <div><div class="feed-text">${e(h.text)}</div><div class="feed-zeit">${zeit(h.zeit)}${h.wer_name ? " · " + e(h.wer_name) : ""}</div></div></div>`).join("")}
              <form method="post" action="${mitHerkunft(`/crm/firma/${f.id}/notiz`, zurueck)}" style="display:flex;gap:8px;margin-top:14px">
                <input name="text" placeholder="Notiz hinzufügen …" required><button type="submit">Hinzufügen</button></form></div>
          </div>
          <div class="akte-spalten"><div class="akte-spalte">
            <div class="karte"><div class="karte-kopf"><h2>Stammdaten</h2></div>
              <div class="akte-form akte-form-oben" data-abschnitt="stammdaten">
              <input type="hidden" name="dabei" value="stammdaten" form="akte">
                <div class="feld"><label>Ansprechperson</label>
                  <input form="akte" name="ansprech_name" value="${e(f.geschaeftsfuehrer || "")}" placeholder="z. B. Anna Weber"></div>
                <div class="feld-paar">
                  <div class="feld"><label>Position</label><select form="akte" name="ansprech_rolle">
                    <option value="">— offen —</option>
                    ${ANSPRECH_ROLLEN.map((r) => `<option ${f.ansprech_rolle === r ? "selected" : ""}>${e(r)}</option>`).join("")}</select></div>
                  <div class="feld"><label>Anrede</label><select form="akte" name="geschlecht">
                    <option value="">— offen —</option>
                    <option value="w" ${f.geschlecht === "w" ? "selected" : ""}>Frau</option>
                    <option value="m" ${f.geschlecht === "m" ? "selected" : ""}>Herr</option>
                    <option value="d" ${f.geschlecht === "d" ? "selected" : ""}>Divers</option></select></div>
                </div>
                <!-- Zwei verschiedene Fragen, darum zwei Felder (0047):
                     „Gewonnen durch" = wer den Kunden geholt hat. Danach wird
                     der Umsatz zugerechnet, und das ändert sich nie wieder.
                     „Verantwortlich" = wer ihn betreut. Das darf wechseln — mit
                     dem Wechsel wandert die Akte ins CRM der anderen Person. -->
                <div class="feld-paar">
                  <div class="feld"><label>Gewonnen durch</label><select form="akte" name="gewonnen_durch">
                    <option value="">— offen —</option>
                    ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === f.gewonnen_durch ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
                  <div class="feld"><label>über</label><select form="akte" name="quelle">
                    <option value="">— unbekannt —</option>
                    ${QUELLEN.map((qu) => `<option ${f.quelle === qu ? "selected" : ""}>${e(qu)}</option>`).join("")}</select></div>
                </div>
                ${f.gewonnen_durch ? `<p class="caption" style="margin:-4px 0 12px">
                  <b>${e((mitarbeiter.find((m) => m.id === f.gewonnen_durch) || {}).name || "—")}</b> hat
                  ${istKunde ? "diesen Kunden" : "diesen Lead"} geholt${f.quelle ? ` über ${e(f.quelle)}` : ""} —
                  ${istKunde ? `die ${geld(gesamtWert(f))} zählen auf seine Leistung.` : "der Umsatz zählt später auf seine Leistung."}</p>` : ""}
                <div class="feld"><label>Verantwortlich</label><select form="akte" name="besitzer">
                  ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === f.besitzer ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select>
                  <span class="caption">Betreut ${istKunde ? "den Kunden" : "den Lead"} und sieht ihn in seinem CRM.
                    Beim Wechsel wandern Abschlüsse, Projekte und offene Aufgaben mit.</span></div>

              </div>
              <div class="akte-form" data-abschnitt="kontakt">
              <input type="hidden" name="dabei" value="kontakt" form="akte">
                <div class="feld"><label>Telefon</label>
                  <input form="akte" name="telefon" type="tel" value="${e(f.telefon || "")}" placeholder="+49 89 …"></div>
                <div class="feld"><label>E-Mail</label>
                  <input form="akte" name="email" type="email" value="${e(f.email || "")}" placeholder="info@…"></div>
                <div class="feld"><label>Website</label>
                  <input form="akte" name="website" value="${e(f.website || "")}" placeholder="https://… (leer = keine)"></div>
                <div class="feld"><label>Ort</label>
                  <input form="akte" name="ort" value="${e(f.ort || "")}" placeholder="z. B. München"></div>
                <dl class="def" style="margin:4px 0 12px">
                  ${istKunde
                    ? `<dt>Kunde seit</dt><dd>${f.kunde_seit ? datum(f.kunde_seit) : "—"}</dd>`
                    : `<dt>Versuche</dt><dd>${f.versuche || 0}</dd>`}
                  <dt>Angelegt</dt><dd>${datum(f.erstellt)}</dd></dl>
              </div>
              ${f.argumente?.length ? `<h2 style="margin-top:18px">Verkaufsargumente</h2>
                <ul style="margin:10px 0 0 17px;font-size:13px;color:var(--text-secondary);line-height:1.55">
                ${f.argumente.map((a) => `<li style="margin-bottom:5px">${e(a)}</li>`).join("")}</ul>` : ""}</div>
            ${todoKarte}
            </div><div class="akte-spalte">

            <div class="karte karte-termine"><div class="karte-kopf"><div><h2>Dringlichkeit &amp; Termine</h2>
              <div class="sub">Was auf der Pipeline-Karte steht</div></div>
              ${f.dringlichkeit && DRINGLICHKEIT[f.dringlichkeit]
                ? `<span class="badge d-${DRINGLICHKEIT[f.dringlichkeit].farbe}">${e(f.dringlichkeit)}</span>` : ""}</div>
              <div data-abschnitt="termine">
              <input type="hidden" name="dabei" value="termine" form="akte">
                <div class="feld"><label>Dringlichkeit</label><select form="akte" name="dringlichkeit">
                  <option value="">— offen —</option>
                  ${Object.keys(DRINGLICHKEIT).map((k) => `<option ${f.dringlichkeit === k ? "selected" : ""}>${e(k)}</option>`).join("")}
                </select></div>
                <div class="feld-paar">
                  <div class="feld"><label>Erstgespräch am</label>
                    <input form="akte" type="date" name="erstgespraech_am" value="${datumFeld(f.erstgespraech_am)}"></div>
                  <div class="feld"><label>Fällig bis</label>
                    <input form="akte" type="date" name="faellig_am" value="${datumFeld(f.faellig_am)}"></div>
                </div>
                <p class="caption" style="margin:-4px 0 12px">Solange der Deal im Erstgespräch steht, zeigt die Karte
                  das Gesprächsdatum. Danach steht dort „fällig bis".</p>
                <div class="feld"><label>Nächste Aufgabe</label>
                  <input form="akte" name="naechste_aufgabe" value="${e(f.naechste_aufgabe || "")}"
                    placeholder="z. B. Webseite live stellen"></div>
                <div class="feld"><label>Nächster Termin</label>
                  <input form="akte" type="date" name="naechster_termin" value="${datumFeld(f.naechster_termin)}"></div>
                
              </div></div>

            <div class="karte"><div class="karte-kopf"><div><h2>Auftrag</h2>
              <div class="sub">${istKunde ? "Was wir bekommen — einmalig und laufend" : "Was wir planen — einmalig und laufend"}</div></div></div>
              <div data-abschnitt="auftrag">
              <input type="hidden" name="dabei" value="auftrag" form="akte">
                ${/* "Kunde seit" (28.07.): Das Feld gab es in der Akte nicht — es liess
                     sich nur EINMAL setzen, in dem Moment, in dem aus dem Lead ein Kunde
                     wurde. Wer sich vertippt hatte oder das Datum nachtragen wollte, kam
                     nicht mehr heran, obwohl der Server es die ganze Zeit angenommen
                     haette. Steht nur in der Kundenakte: bei einem Lead gibt es noch
                     kein Datum, ab dem er Kunde ist. */""}
                ${istKunde ? `<div class="feld"><label>Kunde seit</label>
                  <input form="akte" type="date" name="kunde_seit" value="${f.kunde_seit ? datumFeld(f.kunde_seit) : ""}"
                    title="Ab wann zählt die Firma als Kunde — Grundlage für Laufzeit und Auswertungen"></div>` : ""}
                <div class="feld-paar">
                  <div class="feld"><label>${istKunde ? "Setup / Projekt (einmalig)" : "Geplantes Setup / Projekt"}</label>
                    <input form="akte" name="preis_setup" type="number" step="1" placeholder="0" value="${f.preis_setup ?? ""}"></div>
                  <div class="feld"><label>${istKunde ? "Retainer (pro Monat)" : "Geplanter Retainer (pro Monat)"}</label>
                    <input form="akte" name="preis_monatlich" type="number" step="1" placeholder="0" value="${f.preis_monatlich ?? ""}"></div>
                </div>
                <div class="feld"><label>${istKunde ? "Erfolgsbonus" : "Geplanter Erfolgsbonus"}</label>
                  <select form="akte" name="erfolgsbonus" id="bonus-wahl">
                    <option value="" ${f.erfolgsbonus === null || f.erfolgsbonus === undefined ? "selected" : ""}>— offen —</option>
                    <option value="ja" ${f.erfolgsbonus === true ? "selected" : ""}>Ja</option>
                    <option value="nein" ${f.erfolgsbonus === false ? "selected" : ""}>Nein</option></select></div>
                <div class="feld" id="bonus-feld" style="display:${f.erfolgsbonus === true ? "" : "none"}">
                  <label>Wofür genau?</label>
                  <input form="akte" name="erfolgsbonus_text" value="${e(f.erfolgsbonus_text || "")}"
                    placeholder="z. B. 3.000 € pro Mitarbeiter · 200 € pro Lead · 2.000 € für 10 Bewerbungen"></div>
                <div class="feld"><label>${istKunde ? "Laufzeit" : "Geplante Laufzeit"}</label><select form="akte" name="vertrag_laufzeit">
                  <option value="">— offen —</option>
                  ${LAUFZEITEN.map((l) => `<option ${f.vertrag_laufzeit === l ? "selected" : ""}>${e(l)}</option>`).join("")}</select></div>
                ${kundenSparte === "webdesign" ? `<div class="feld"><label>Hosten wir die Seite?</label>
                  <select form="akte" name="hosting">
                    <option value="" ${f.hosting === null || f.hosting === undefined ? "selected" : ""}>— offen —</option>
                    <option value="ja" ${f.hosting === true ? "selected" : ""}>Ja, wir hosten</option>
                    <option value="nein" ${f.hosting === false ? "selected" : ""}>Nein</option></select></div>` : ""}
                ${kundenSparte === "performance" ? `<div class="feld-paar">
                  <div class="feld"><label>Leads erreicht</label>
                    <input form="akte" name="leads_ist" type="number" step="1" placeholder="0" value="${f.leads_ist ?? ""}"></div>
                  <div class="feld"><label>Leads vereinbart</label>
                    <input form="akte" name="leads_ziel" type="number" step="1" placeholder="0" value="${f.leads_ziel ?? ""}"></div>
                </div>
                ${Number(f.leads_ziel) > 0 ? `<div class="leads-stand">
                  <div class="leads-stand-text">Aktueller Stand <b>${Number(f.leads_ist) || 0} von ${Number(f.leads_ziel)}</b> erforderlichen Leads</div>
                  <div class="leads-spur"><div class="leads-balken" style="width:${
                    Math.min(100, Math.round(((Number(f.leads_ist) || 0) / Number(f.leads_ziel)) * 100))}%"></div></div>
                </div>` : ""}` : ""}
                ${istKunde ? `<p class="caption" style="margin-bottom:12px">Sobald ein monatlicher Betrag drinsteht, zählt der Kunde als Retainer-Kunde.</p>` : ""}
              </div></div>

            ${istKunde ? `
            <div class="karte"><div class="karte-kopf"><div><h2>Aktueller Stand</h2>
              <div class="sub">Wo das Projekt steht — und ob alles bezahlt ist</div></div></div>
              <div data-abschnitt="stand">
              <input type="hidden" name="dabei" value="stand" form="akte">
                ${/* Die Phasen dieses Bereichs — dieselben, aus denen die
                     Projektabwicklung ihre Spalten baut (28.07.). Vorher standen
                     hier drei allgemeine Staende, die mit dem Brett nichts zu tun
                     hatten: "In Umsetzung" sagte weder, was ansteht, noch tauchte
                     es dort auf. Was hier gewaehlt wird, verschiebt die Karte auf
                     dem Brett — und legt sie an, wenn es sie noch nicht gibt. */""}
                <div class="feld"><label>Projektphase
                  <span class="caption">${e(SPARTEN[kundenSparte] || kundenSparte)}</span></label>
                  <select form="akte" name="projekt_stufe">
                    <option value="">— noch nicht gestartet —</option>
                    ${/* Die Abschluss-Phase wird benannt, damit vorher klar ist,
                         dass sie das Projekt beendet und vom Brett nimmt — bei
                         Webdesign ist das "Live". */""}
                    ${projektStufen.map((s) => `<option value="${s.id}" ${
                      String(projektJetzt?.stufe_id) === String(s.id) ? "selected" : ""
                    }>${s.position}. ${e(s.name)}${s.ist_abschluss ? " — abgeschlossen" : ""}</option>`).join("")}
                  </select>
                  <span class="caption">${!projektJetzt
                    ? "Sobald du eine Phase wählst, erscheint der Kunde in der Projektabwicklung."
                    : projektJetzt.status === "fertig"
                      ? `Abgeschlossen mit „${e(projektJetzt.stufe_name || "—")}" — steht nicht mehr auf dem Brett.
                         Eine frühere Phase wählen öffnet es wieder.`
                      : `Steht in der Projektabwicklung unter „${e(projektJetzt.stufe_name || "—")}".`}</span>
                </div>
                <div class="feld"><label>Setup / Projekt bezahlt?</label><select form="akte" name="rechnung_stand">
                  <option value="">— offen —</option>
                  ${Object.entries(RECHNUNG_STAende).map(([k, v]) => `<option value="${k}" ${f.rechnung_stand === k ? "selected" : ""}>${e(v)}</option>`).join("")}</select></div>

                <!-- Der Retainer hat einen EIGENEN Stand. Setup bezahlt und
                     Retainer offen ist der Normalfall, und mit einem einzigen
                     Feld für beides war er nicht darstellbar.
                     Der Block steht IMMER im HTML und wird nur ein- und
                     ausgeblendet: er hing vorher davon ab, ob beim Laden der
                     Seite schon ein Monatsbetrag gespeichert war — man musste
                     also erst speichern und neu laden, um den Zähler zu sehen.
                     Jetzt erscheint er, sobald der Betrag getippt ist. -->
                <div class="feld retainer-feld" id="retainer-feld"
                  style="${Number(f.preis_monatlich) > 0 ? "" : "display:none"}">
                  <label>Monatlicher Retainer bezahlt</label>
                  <div class="retainer-zeile">
                    <button type="button" class="retainer-knopf" data-schritt="-1" title="Einen Monat zurück">−</button>
                    <select form="akte" name="retainer_monate_bezahlt" id="retainer-zaehler">
                      ${Array.from({ length: Math.max(retainerMonate, Number(f.retainer_monate_bezahlt || 0)) + 1 },
                        (_, n) => `<option value="${n}" ${Number(f.retainer_monate_bezahlt || 0) === n ? "selected" : ""}
                          >${n} von ${retainerMonate} bezahlt</option>`).join("")}
                    </select>
                    <button type="button" class="retainer-knopf" data-schritt="1" title="Einen Monat weiter">+</button>
                  </div>
                  <div class="retainer-spur" id="retainer-spur">
                    ${Array.from({ length: retainerMonate }, (_, i) =>
                      `<i class="${i < Number(f.retainer_monate_bezahlt || 0) ? "voll" : ""}"></i>`).join("")}
                  </div>
                  <span class="caption" id="retainer-text">${geld(retainerBezahlt)} von ${geld(retainerGesamt)} eingegangen</span>
                  <span class="caption">Jeder bezahlte Monat wird einzeln in der Buchhaltung gebucht —
                    auf den Monat datiert, in dem er anfällt.</span>
                </div>
                <div class="feld"><label>Vertrag unterschrieben?</label><select form="akte" name="vertrag_unterschrieben">
                  <option value="" ${f.vertrag_unterschrieben === null || f.vertrag_unterschrieben === undefined ? "selected" : ""}>— offen —</option>
                  <option value="ja" ${f.vertrag_unterschrieben === true ? "selected" : ""}>Ja, liegt vor</option>
                  <option value="nein" ${f.vertrag_unterschrieben === false ? "selected" : ""}>Nein</option></select></div>
              </div></div>` : `
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
              <div data-abschnitt="firma">
              <input type="hidden" name="dabei" value="firma" form="akte">
                <div class="feld"><label>Leistungen der Firma</label>
                  <textarea form="akte" name="taetigkeit" rows="3" placeholder="z. B. Physiotherapie, Krankengymnastik, Manuelle Therapie">${e(f.taetigkeit || "")}</textarea></div>
                <div class="feld"><label>Mitarbeiter</label>
                  <input form="akte" name="mitarbeiter_zahl" type="number" step="1" placeholder="z. B. 12" value="${f.mitarbeiter_zahl ?? ""}"></div>
                
              </div></div>

            <div class="karte"><div class="karte-kopf"><div><h2>Leistungen</h2>
              <div class="sub">Was wir im Bereich ${e(SPARTEN[kundenSparte])} liefern</div></div></div>
              <div data-abschnitt="leistungen">
              <input type="hidden" name="dabei" value="leistungen" form="akte">
                <div class="wahl-liste">
                  ${leistungenAuswahl.map((l) => `<label class="wahl"><input form="akte" type="checkbox" name="leistungen" value="${e(l)}"
                    ${(f.leistungen || []).includes(l) ? "checked" : ""}><span>${e(l)}</span></label>`).join("")}
                </div>
                ${(f.leistungen || []).filter((l) => !leistungenAuswahl.includes(l)).length
                  ? `<p class="caption" style="margin-top:8px">Aus einem anderen Bereich übernommen: ${
                      (f.leistungen || []).filter((l) => !leistungenAuswahl.includes(l)).map(e).join(", ")}</p>` : ""}
                <h3 style="margin:16px 0 8px;font-size:13px">Kontakt über</h3>
                <div class="wahl-liste">
                  ${KONTAKT_KANAELE.map((k) => `<label class="wahl"><input form="akte" type="checkbox" name="kontakt_kanaele" value="${e(k)}"
                    ${(f.kontakt_kanaele || []).includes(k) ? "checked" : ""}><span>${e(k)}</span></label>`).join("")}
                </div>
                
              </div></div>

            <div class="karte"><div class="karte-kopf"><div><h2>Dokumente</h2>
              <div class="sub">Verträge, Rechnungen, Briefings</div></div>
              ${dok.rechnungen.length ? `<span class="badge">${dok.rechnungen.length} ${dok.rechnungen.length === 1 ? "Rechnung" : "Rechnungen"}</span>` : ""}</div>

              <!-- Die Art wird VOR dem Ablegen gewählt, nicht danach. Sie
                   entscheidet den Weg der Datei: eine Rechnung geht in die
                   Buchhaltung, alles andere bleibt in der Akte. Danach zu
                   fragen hieße, die Datei erst irgendwo hinzulegen. -->
              <div class="feld" style="margin-bottom:10px">
                <label for="dok-art">Was legst du ab?</label>
                <select id="dok-art">
                  ${crm.DOKUMENT_ARTEN.map((a) => `<option value="${e(a)}">${e(a)}</option>`).join("")}
                </select>
              </div>
              <p class="caption" id="dok-hinweis" style="margin:-4px 0 10px"></p>

              <div class="ablage" id="ablage" data-firma="${f.id}">
                <div class="ablage-icon">${ICON.ordner}</div>
                <div class="ablage-text"><b>Dateien hier ablegen</b>
                  <span class="caption">PDF, Bilder oder andere Dateien — oder klicken zum Auswählen</span></div>
                <input type="file" id="ablage-feld" multiple hidden>
              </div>
              <div class="ablage-liste" id="ablage-liste"></div>

              ${dok.rechnungen.length ? `<h3 class="dok-titel">Rechnungen 
                <span class="caption">— liegen in der Buchhaltung</span></h3>
                <div class="dok-liste">
                ${dok.rechnungen.map((r) => {
                  const stand = r.status !== "gebucht"
                    ? { text: "wartet auf Prüfung", klasse: "b-bernstein" }
                    : r.bezahlt ? { text: "bezahlt" + (r.bezahlt_am ? " am " + datum(r.bezahlt_am) : ""), klasse: "b-gruen" }
                    : { text: "offen — Kunde hat noch nicht gezahlt", klasse: "b-bernstein" };
                  return `<div class="dok-zeile">
                    <a href="/buchhaltung/beleg/${r.id}/datei" target="_blank" class="dok-name">
                      ${ICON.datei} <span>${e(r.name)}</span></a>
                    <span class="dok-meta">Nr. ${r.laufnummer ?? "–"}${r.betrag ? " · " + geld(r.betrag) : ""}</span>
                    <span class="badge ${stand.klasse}">${e(stand.text)}</span>
                  </div>`;
                }).join("")}
                </div>
                <p class="caption" style="margin-top:6px">Gebucht und abgehakt wird in der
                  <a href="/buchhaltung">Buchhaltung</a> — dort steht die Rechnung unter
                  „Rechnungen an Kunden".</p>` : ""}

              ${dok.eigene.length ? `<h3 class="dok-titel">Unterlagen</h3>
                <div class="dok-liste">
                ${dok.eigene.map((x) => `<div class="dok-zeile">
                  <a href="/crm/dokument/${x.id}/datei" target="_blank" class="dok-name">
                    ${ICON.datei} <span>${e(x.name)}</span></a>
                  <span class="dok-meta">${e(x.art || "Sonstiges")}${x.groesse ? " · " + Math.round(x.groesse/1024) + " KB" : ""}</span>
                  <form method="post" action="/crm/dokument/${x.id}/loeschen" class="dok-weg"
                    onsubmit="return confirm('„${e(x.name).replace(/'/g, "&#39;")}“ löschen?')">
                    <button type="submit" class="still klein" title="Löschen">${ICON.x}</button></form>
                </div>`).join("")}
                </div>` : ""}

              ${!dok.eigene.length && !dok.rechnungen.length
                ? `<p class="caption" style="margin-top:8px">Noch nichts abgelegt.</p>` : ""}
            </div>
          </div></div>
        </div>
        <script>
        (function(){
          // Retainer-Zähler. Er muss auf zwei Felder hören, die in einer ANDEREN
          // Karte stehen: Monatsbetrag und Laufzeit. Ohne das müsste man erst
          // speichern und neu laden, um den Zähler überhaupt zu sehen — genau
          // das war der Grund, warum er nach dem Eintragen nicht auftauchte.
          var MONATE = ${JSON.stringify(crm.MONATE_JE_LAUFZEIT)};
          (function(){
            var feld=document.getElementById('retainer-feld');
            if(!feld) return;
            var zaehler=document.getElementById('retainer-zaehler'),
                spur=document.getElementById('retainer-spur'),
                text=document.getElementById('retainer-text'),
                betragFeld=document.querySelector('[name="preis_monatlich"]'),
                laufzeitFeld=document.querySelector('[name="vertrag_laufzeit"]');
            function eur(n){ return Math.round(n).toLocaleString('de-DE')+' €'; }
            function monate(){
              if(!laufzeitFeld) return 1;
              var w=laufzeitFeld.value;
              return (w in MONATE) ? MONATE[w] : (w ? 12 : 1);
            }
            function zeichnen(){
              var betrag=Number(betragFeld && betragFeld.value)||0, n=monate();
              feld.style.display = betrag>0 ? '' : 'none';
              if(betrag<=0) return;
              // Der gewählte Stand überlebt das Neuaufbauen der Liste — sonst
              // springt der Zähler auf 0 zurück, sobald man die Laufzeit ändert.
              var jetzt=Math.min(Number(zaehler.value)||0, n);
              zaehler.innerHTML='';
              for(var i=0;i<=n;i++){
                var o=document.createElement('option');
                o.value=i; o.textContent=i+' von '+n+' bezahlt';
                if(i===jetzt) o.selected=true;
                zaehler.appendChild(o);
              }
              spur.innerHTML='';
              for(var k=0;k<n;k++){
                var s=document.createElement('i');
                if(k<jetzt) s.className='voll';
                spur.appendChild(s);
              }
              text.textContent=eur(jetzt*betrag)+' von '+eur(n*betrag)+' eingegangen';
            }
            document.querySelectorAll('.retainer-knopf').forEach(function(b){
              b.addEventListener('click',function(){
                var n=Number(zaehler.value)||0, max=zaehler.options.length-1;
                zaehler.value=Math.max(0,Math.min(max,n+Number(b.dataset.schritt)));
                zaehler.dispatchEvent(new Event('change',{bubbles:true}));
              });
            });
            zaehler.addEventListener('change',zeichnen);
            if(betragFeld) betragFeld.addEventListener('input',zeichnen);
            if(laufzeitFeld) laufzeitFeld.addEventListener('change',zeichnen);
            zeichnen();
          })();

          // Erfolgsbonus: das Textfeld erscheint nur, wenn "Ja" gewaehlt ist.
          var wahl=document.getElementById('bonus-wahl'), feldB=document.getElementById('bonus-feld');
          if(wahl) wahl.addEventListener('change',function(){
            feldB.style.display = wahl.value==='ja' ? '' : 'none';
            if(wahl.value==='ja') feldB.querySelector('input').focus();
          });
        })();
        (function(){
          var zone=document.getElementById('ablage'), feld=document.getElementById('ablage-feld'),
              liste=document.getElementById('ablage-liste'),
              artWahl=document.getElementById('dok-art'), hinweis=document.getElementById('dok-hinweis');
          if(!zone) return;
          var firma=zone.dataset.firma;
          function groesse(b){ return b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB'; }

          // Der Hinweis sagt VOR dem Ablegen, wohin die Datei geht. Sonst ist es
          // eine Ueberraschung, dass eine Rechnung in der Buchhaltung auftaucht.
          function hinweisSetzen(){
            hinweis.textContent = artWahl.value==='Rechnung an den Kunden'
              ? 'Landet zusaetzlich in der Buchhaltung unter „Rechnungen an Kunden“ und wartet dort auf die Pruefung.'
              : 'Bleibt in dieser Kundenakte. Die Buchhaltung sieht sie nicht.';
          }
          artWahl.addEventListener('change',hinweisSetzen); hinweisSetzen();

          // Die Datei geht ROH im Rumpf raus, nicht als base64 in einem JSON:
          // base64 blaeht sie um ein Drittel auf, und ein 20-MB-PDF waere dann
          // 27 MB Text, den beide Seiten erst zusammenbauen muessen.
          function hochladen(d, zeile){
            var art=artWahl.value;
            return fetch('/crm/firma/'+firma+'/dokument',{
              method:'POST',
              headers:{'Content-Type':'application/octet-stream',
                       'X-Dateiname':encodeURIComponent(d.name),
                       'X-Dateityp':d.type||'application/octet-stream',
                       'X-Art':encodeURIComponent(art)},
              body:d
            }).then(function(r){ return r.json(); }).then(function(a){
              if(!a.ok){ zeile.querySelector('.caption').textContent='Fehler: '+(a.grund||'unbekannt'); return false; }
              zeile.querySelector('.caption').textContent = a.doppelt
                ? 'liegt schon hier — nicht doppelt abgelegt'
                : (a.ziel==='buchhaltung' ? 'gesichert · wartet in der Buchhaltung' : 'gesichert');
              return true;
            }).catch(function(){ zeile.querySelector('.caption').textContent='Fehler beim Hochladen'; return false; });
          }

          function zeigen(dateien){
            var alle=Array.prototype.slice.call(dateien);
            if(!alle.length) return;
            var aufgaben=alle.map(function(d){
              var z=document.createElement('div'); z.className='ablage-datei';
              z.innerHTML='<span class="ablage-datei-name"></span><span class="caption"></span>';
              z.querySelector('.ablage-datei-name').textContent=d.name;
              z.querySelector('.caption').textContent=groesse(d.size)+' · wird gesichert …';
              liste.appendChild(z);
              return hochladen(d,z);
            });
            // Erst neu laden, wenn alles durch ist — sonst reisst der Reload
            // einen laufenden Upload ab.
            Promise.all(aufgaben).then(function(e){
              if(e.some(Boolean)) setTimeout(function(){ location.reload(); },900);
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
              <button type="submit" class="dunkel">Deal anlegen</button></div></form></dialog>

        <!-- Die Speicherleiste. Klebt am unteren Rand, weil die Akte länger ist
             als der Bildschirm: ein Knopf ganz unten wäre beim Tippen im
             oberen Drittel unerreichbar, und einer ganz oben beim Tippen unten.
             Sie zeigt sich erst, wenn wirklich etwas geändert wurde — sonst
             steht ein „Speichern" im Bild, das nichts zu tun hat. -->
        <div class="akte-speicherleiste" id="speicherleiste" hidden>
          <span class="akte-speicher-text">Ungespeicherte Änderungen</span>
          <button type="button" class="sekundaer" onclick="location.reload()">Verwerfen</button>
          <button type="submit" form="akte" class="dunkel">${ICON.check} Alles speichern</button>
        </div>

        <script>
        (function () {
          var formular = document.getElementById("akte");
          var leiste = document.getElementById("speicherleiste");
          if (!formular || !leiste) return;

          // Alle Felder, die an diesem Formular hängen — auch die, die im DOM
          // woanders stehen. formular.elements kennt sie dank form="akte".
          function felder() { return Array.prototype.slice.call(formular.elements); }

          // Ausgangsstand merken, um "geändert" von "wieder zurückgeändert"
          // unterscheiden zu können. Wer einen Tippfehler rückgängig macht,
          // soll keine Warnung mehr sehen.
          var start = {};
          felder().forEach(function (el, i) {
            if (!el.name) return;
            start[i] = el.type === "checkbox" || el.type === "radio" ? el.checked : el.value;
          });

          function geaendert() {
            return felder().some(function (el, i) {
              if (!el.name) return false;
              var jetzt = el.type === "checkbox" || el.type === "radio" ? el.checked : el.value;
              return jetzt !== start[i];
            });
          }
          var hinweisOben = document.getElementById("speicher-hinweis-oben");
          var knopfOben = document.getElementById("speichern-oben");
          function pruefen() {
            var offen = geaendert();
            leiste.hidden = !offen;
            if (hinweisOben) hinweisOben.hidden = !offen;
            // Der obere Knopf bleibt immer klickbar (auch ohne Änderung tut ein
            // Speichern nichts Schlimmes), wird aber sichtbar dringlicher.
            if (knopfOben) knopfOben.classList.toggle("wartet", offen);
          }

          formular.addEventListener("input", pruefen);
          formular.addEventListener("change", pruefen);
          // Die Felder liegen ausserhalb des <form>, ihre Ereignisse steigen
          // also NICHT bis dorthin auf. Deshalb zusätzlich am Dokument lauschen.
          document.addEventListener("input", function (ev) {
            if (ev.target && ev.target.form === formular) pruefen();
          });
          document.addEventListener("change", function (ev) {
            if (ev.target && ev.target.form === formular) pruefen();
          });

          // Letzte Rettung: wer die Akte mit ungespeicherten Änderungen verlässt,
          // wird gefragt. Das ist genau der Fall, der vorher lautlos Eingaben
          // gefressen hat.
          var speichertGerade = false;
          formular.addEventListener("submit", function () { speichertGerade = true; });
          window.addEventListener("beforeunload", function (ev) {
            if (speichertGerade || !geaendert()) return;
            ev.preventDefault();
            ev.returnValue = "";
          });
        })();
        </script>`));
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
