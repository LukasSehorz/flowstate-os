// Flowstate Rechnungen & Angebote — Datenzugriff und Logik (05.09.2026).
//
// Warum (Lukas): "Aus dem Tool wollen wir Rechnungen und Angebote erstellen und
// direkt an Kunden versenden — verknuepft mit dem CRM/Dashboard: wie viel
// Umsatz schon generiert, wie viel noch offen. Bei Kunden gibt es
// Abschlagsrechnungen: in der Kundenakte soll stehen, eine ist raus und
// bezahlt, eine offen — 50 % bezahlt."
//
// Bis heute erzeugte lib/beleg-erstellen.js Rechnungen per Sprache aus
// DOCX-Vorlagen — als Datei, ohne Datenbankzeile. Hier lebt die Rechnung als
// VORGANG in der Tabelle rechnungen (Migration 0060): Positionen, Empfaenger,
// Status, Zahlungen, PDF. Der Nummernkreis bleibt lib/beleg-nummer.js
// (R-2026-131 / 2026-024), das PDF kommt aus lib/pdf-schreiben.js.
//
// Statusfolge (siehe UEBERGAENGE):
//   Angebot   entwurf -> gestellt -> angenommen | abgelehnt
//   Rechnung  entwurf -> gestellt -> teilbezahlt -> bezahlt
//   storniert jederzeit ab "gestellt", mit Grund. Ein Entwurf wird geloescht,
//   nicht storniert — er hat noch keine Nummer verbraucht.
//
// NUMMER ERST BEIM STELLEN. Beim Anlegen waere einfacher, aber jeder
// verworfene Entwurf risse dann eine Luecke in den Nummernkreis — und der
// Kreis soll lueckenlos bleiben (beleg-nummer.js, Lukas 07.08.). Beim Stellen
// wird auch das PDF gebaut und mit Pruefsumme eingefroren: Was der Kunde
// bekommen hat, kommt spaeter genau so wieder aus dem System.
//
// GELD: Jede Zahlung auf eine Rechnung ist EINE Buchung (buchungen, art
// einnahme, bezahlt, quelle 'rechnung', quelle_schluessel 'rechnung-<id>-<n>').
// Den Doppelbuchungsschutz haelt der Index buchungen_rechnung_einmalig, nicht
// die Sorgfalt hier. Zufluss-Prinzip wie im Rest der Buchhaltung: bezahlt_am
// entscheidet ueber den Monatsordner.
//
// ABSCHLAG haengt am AUFTRAG: einem gestellten/angenommenen Angebot — oder an
// einer Rechnung im Entwurf, die als Auftragsrahmen dient. NICHT an einer
// gestellten Rechnung: die zaehlt schon als Umsatz, ihre Abschlaege wuerden
// denselben Betrag ein zweites Mal zaehlen.
//
// Alle Vertrags-Exporte am Ende (rechnungenJeFirma, umsatzFest,
// offeneRechnungen, URL_NEU) werfen nie: Fehlt die Tabelle noch, kommen Nullen.

const crm = require("./crm.js");
const nummern = require("./beleg-nummer.js");
const pdf = require("./pdf-schreiben.js");
const archiv = require("./archiv.js");
const alsNutzer = crm.alsNutzer;

// ------------------------------------------------------------------ Vorlagen
//
// Preise bewusst leer (null): Der Nutzer tippt sie. Ein vorbelegter Betrag
// waere eine erfundene Zahl in der Oberflaeche. Texte kurz und in der Sie-Form
// wie die Vorbilder in lib/angebot-text.js; der §19-Satz steht fest im Schluss.
const VORLAGEN = {
  website: {
    titel: "Webseite",
    positionen: [
      { titel: "Konzeption & Design", beschreibung: "Struktur, Seitenaufbau und individuelles Webdesign im Corporate Design – abgestimmt auf Ihre Zielgruppe und Ihre Leistungen.", menge: 1, einheit: "pauschal", einzelpreis: null },
      { titel: "Umsetzung & Inhalte", beschreibung: "Technische Umsetzung aller Unterseiten, responsiv für Desktop, Tablet und Smartphone, inkl. On-Page-SEO und KI-Such-Optimierung (Schema.org).", menge: 1, einheit: "pauschal", einzelpreis: null },
      { titel: "Go-Live & Einweisung", beschreibung: "Hosting-Einrichtung, Domain-Verknüpfung, SSL, Go-Live und eine Einweisung, damit Sie Inhalte selbst pflegen können.", menge: 1, einheit: "pauschal", einzelpreis: null },
    ],
    nutzen: [
      "Moderner, vollständig mobiloptimierter Auftritt, der auf Desktop, Tablet und Smartphone überzeugt",
      "Ihre Leistungen klar dargestellt – auf einen Blick verständlich für jeden Besucher",
      "Bessere Auffindbarkeit bei Google durch technische On-Page-SEO – gezielt für Ihre Region",
      "KI-Such-Optimierung (GEO / Schema.org) – damit Ihr Betrieb auch von KI-Assistenten korrekt erfasst und empfohlen wird",
      "Klare Kontaktwege für mehr qualifizierte Anfragen",
    ],
    einleitung: {
      angebot: "vielen Dank für Ihr Interesse! In der folgenden Auflistung sehen Sie auf einen Blick, was wir für Ihren neuen Webauftritt anbieten:",
      rechnung: "vielen Dank für die gute Zusammenarbeit! Für Ihren neuen Webauftritt stellen wir Ihnen die vereinbarten Leistungen wie folgt in Rechnung:",
    },
  },
  ki: {
    titel: "KI-Anwendung",
    positionen: [
      { titel: "Analyse & Readiness-Check", beschreibung: "Bestandsaufnahme Ihrer Abläufe und Daten, Bewertung der Einsatzmöglichkeiten und ein konkreter Umsetzungsplan.", menge: 1, einheit: "pauschal", einzelpreis: null },
      { titel: "Umsetzung", beschreibung: "Aufbau und Integration der KI-Anwendung in Ihre bestehenden Werkzeuge – mit Testphase und Anpassung an Ihren Alltag.", menge: 1, einheit: "pauschal", einzelpreis: null },
      { titel: "Schulung & Übergabe", beschreibung: "Einweisung Ihres Teams, kurze Dokumentation und Übergabe in den laufenden Betrieb.", menge: 1, einheit: "pauschal", einzelpreis: null },
    ],
    nutzen: [
      "Wiederkehrende Handgriffe laufen künftig automatisch – Ihr Team gewinnt Zeit zurück",
      "Die Anwendung fügt sich in Ihre bestehenden Werkzeuge ein, es gibt kein zweites System zu pflegen",
      "Nachvollziehbare Ergebnisse: Sie sehen jederzeit, was die KI getan hat und warum",
      "Einweisung Ihres Teams inklusive – ab dem ersten Tag nutzbar",
    ],
    einleitung: {
      angebot: "vielen Dank für das gute Gespräch! In der folgenden Auflistung sehen Sie auf einen Blick, was wir für Ihre KI-Anwendung anbieten:",
      rechnung: "vielen Dank für die gute Zusammenarbeit! Für Ihre KI-Anwendung stellen wir Ihnen die vereinbarten Leistungen wie folgt in Rechnung:",
    },
  },
  performance: {
    titel: "Performance-Marketing",
    positionen: [
      { titel: "Setup & Strategie", beschreibung: "Zielgruppen, Kampagnenstruktur, Anzeigen und Tracking – einmalig eingerichtet und getestet.", menge: 1, einheit: "pauschal", einzelpreis: null },
      { titel: "Monatliche Betreuung", beschreibung: "Laufende Steuerung, Optimierung und Auswertung der Kampagnen mit monatlichem Bericht.", menge: 1, einheit: "Monat", einzelpreis: null },
    ],
    nutzen: [
      "Sichtbar genau dort, wo Ihre Kunden suchen – ohne Streuverluste",
      "Anzeigen, Zielgruppen und Tracking einmal sauber aufgesetzt statt zusammengestückelt",
      "Monatlicher Bericht in Klartext: was gelaufen ist und was das gekostet hat",
      "Laufende Optimierung – das Budget wandert dorthin, wo es Anfragen bringt",
    ],
    einleitung: {
      angebot: "vielen Dank für Ihr Interesse! In der folgenden Auflistung sehen Sie auf einen Blick, was wir für Ihre Anzeigen anbieten:",
      rechnung: "vielen Dank für die gute Zusammenarbeit! Für Ihre Anzeigen stellen wir Ihnen die vereinbarten Leistungen wie folgt in Rechnung:",
    },
  },
  frei: {
    titel: "",
    positionen: [],
    nutzen: [],
    einleitung: {
      angebot: "vielen Dank für Ihr Interesse! In der folgenden Auflistung sehen Sie auf einen Blick, was wir anbieten:",
      rechnung: "vielen Dank für die gute Zusammenarbeit! Wir stellen Ihnen die vereinbarten Leistungen wie folgt in Rechnung:",
    },
  },
};
// Der Schluss ist fuer alle Vorlagen gleich. Der §19-Satz steht NICHT hier,
// sondern fest und unveraenderbar unter der Summe (PARAGRAF19 in pdfBauen) —
// sonst koennte ihn jemand aus dem Textfeld loeschen.
// Wortlaut des Angebots-Schlusses steht so im Vorbild 2026-026.
//
// Der Rechnungs-Schluss ist eine bewusste ERGAENZUNG zur Hausvorlage: die
// beiden Vorbild-Rechnungen (R-2026-138/139) gehen vom Zahlungsblock direkt in
// den Gruss. Ein Vorgang ohne Text laesst sich aber nicht mehr von einem
// unterscheiden, bei dem jemand den Text geloescht hat — deshalb steht hier ein
// Satz als Vorgabe, den man im Formular leeren kann. Leer heisst leer: dann
// druckt das PDF genau die Hausvorlage (siehe pdfRechnung, Punkt 10).
const SCHLUSS = {
  angebot: "Gerne besprechen wir in einem kurzen Termin die Inhalte und die nächsten Schritte. Bei Fragen erreichen Sie uns jederzeit – wir freuen uns auf die Zusammenarbeit!",
  rechnung: "Vielen Dank für Ihr Vertrauen und die gute Zusammenarbeit.",
};

// Buchungskategorie je Vorlage (Einnahmekategorien aus lib/buchhaltung.js).
const KATEGORIE_JE_VORLAGE = { website: "Webdesign", ki: "KI-Projekte", performance: "Performance Marketing" };
const KATEGORIE_JE_TAG = { webdesign: "Webdesign", ki: "KI-Projekte", performance: "Performance Marketing" };

const EINHEITEN = ["pauschal", "Stück", "Stunde", "Tag", "Monat"];
const FRIST_TAGE = { rechnung: 14, angebot: 30 };

function texte(vorlage, art) {
  const v = VORLAGEN[vorlage] || VORLAGEN.frei;
  const a = art === "angebot" ? "angebot" : "rechnung";
  // Die Nutzenliste gehoert nur ins Angebot — auf einer Rechnung wirbt niemand.
  return {
    einleitung: v.einleitung[a], schluss: SCHLUSS[a], titel: v.titel,
    positionen: v.positionen.map((p) => ({ ...p })),
    nutzen: a === "angebot" ? (v.nutzen || []).join("\n") : "",
  };
}

// ------------------------------------------------------------------ Status
const STATUS_TEXT = {
  entwurf: "Entwurf", gestellt: "Gestellt", teilbezahlt: "Teilbezahlt", bezahlt: "Bezahlt",
  storniert: "Storniert", angenommen: "Angenommen", abgelehnt: "Abgelehnt",
};
// Farbe fuer die Statuspille (.os-pille--…).
const STATUS_FARBE = {
  entwurf: "grau", gestellt: "blau", teilbezahlt: "bernstein", bezahlt: "gruen",
  storniert: "rot", angenommen: "gruen", abgelehnt: "rot",
};
const UEBERGAENGE = {
  angebot: {
    entwurf: ["gestellt"],
    gestellt: ["angenommen", "abgelehnt", "storniert"],
    angenommen: ["abgelehnt", "storniert"],
    abgelehnt: ["angenommen", "storniert"],
    storniert: [],
  },
  rechnung: {
    entwurf: ["gestellt"],
    gestellt: ["teilbezahlt", "bezahlt", "storniert"],
    teilbezahlt: ["teilbezahlt", "bezahlt", "storniert"],
    bezahlt: ["storniert"],
    storniert: [],
  },
};
function uebergangErlaubt(art, von, nach) {
  const a = UEBERGAENGE[art === "angebot" ? "angebot" : "rechnung"];
  return Boolean(a[von] && a[von].includes(nach));
}
// Was zaehlt als Umsatz: gestellte Rechnungen, egal ob bezahlt. Entwuerfe und
// stornierte nicht, Angebote nie.
const ZAEHLT = ["gestellt", "teilbezahlt", "bezahlt"];

// ------------------------------------------------------------------ Rechnen
const rund = (n) => Math.round((Number(n) || 0) * 100) / 100;

// "1.234,56" / "1234.56" / "1234" / 1234 -> Zahl; Unsinn -> null. Negative
// Betraege sind erlaubt (Abzug eines Abschlags in der Schlussrechnung).
function zuBetrag(w) {
  if (w === null || w === undefined || w === "") return null;
  if (typeof w === "number") return Number.isFinite(w) ? rund(w) : null;
  let t = String(w).trim().replace(/\s|€/g, "");
  if (!t) return null;
  if (t.includes(",")) {
    // deutsch: Punkt = Tausender, Komma = Dezimal
    t = t.replace(/\./g, "").replace(",", ".");
  } else {
    // ohne Komma: "1.234" und "1.234.567" sind Tausenderpunkte, "37.30" ist
    // eine fertige Zahl (dieselbe Regel wie buchhaltung.zuBetrag, 21.08.).
    const punkte = (t.match(/\./g) || []).length;
    if (punkte > 1 || (punkte === 1 && /\.\d{3}$/.test(t))) t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? rund(n) : null;
}

function zuMenge(w) {
  const n = zuBetrag(w);
  return n === null || n <= 0 ? 1 : n;
}

// Positionen aus dem Formular (oder aus JSON) bereinigen. Leere Zeilen
// (weder Titel noch Preis) fliegen raus; Reihenfolge bleibt.
function positionenSaeubern(roh) {
  let liste = roh;
  if (typeof liste === "string") { try { liste = JSON.parse(liste); } catch { liste = []; } }
  if (liste && !Array.isArray(liste) && typeof liste === "object") liste = Object.values(liste);
  if (!Array.isArray(liste)) return [];
  const s = (x, max) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return liste
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      titel: s(p.titel, 160),
      beschreibung: String(p.beschreibung ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 1200),
      menge: zuMenge(p.menge),
      einheit: s(p.einheit, 20) || "pauschal",
      einzelpreis: zuBetrag(p.einzelpreis),
    }))
    .filter((p) => p.titel || p.einzelpreis !== null);
}

// Obergrenze je Position und fuer die Summe. Die Spalten sind numeric(12,2);
// ein Einzelpreis von 99999999999 lief in einen Postgres-Ueberlauf und damit in
// einen 500 (Befund 6 des Pruefers). Zehn Millionen sind fuer dieses Haus
// reichlich — was darueber steht, ist ein Tippfehler.
const BETRAG_MAX = 9999999.99;

function positionSumme(p) {
  return rund((Number(p.menge) || 0) * (Number(p.einzelpreis) || 0));
}
function summe(positionen) {
  return rund((positionen || []).reduce((s, p) => s + positionSumme(p), 0));
}

// Abschlag: Prozent ODER Betrag — das jeweils andere wird abgeleitet.
function abschlagBetrag(auftragSumme, { prozent, betrag } = {}) {
  const gesamt = rund(auftragSumme);
  const p = zuBetrag(prozent), b = zuBetrag(betrag);
  if (gesamt <= 0) return null;
  if (b !== null && b > 0) return { betrag: rund(b), prozent: rund(b / gesamt * 100) };
  if (p !== null && p > 0) return { betrag: rund(gesamt * p / 100), prozent: rund(p) };
  return null;
}

// Nummernformat (lib/beleg-nummer.js FORM): Rechnung R-2026-131, Angebot 2026-024.
const NUMMER_MUSTER = { rechnung: /^R-\d{4}-\d+$/, angebot: /^\d{4}-\d{3,}$/ };
function nummerGueltig(art, nummer) {
  const m = NUMMER_MUSTER[art === "angebot" ? "angebot" : "rechnung"];
  return m.test(String(nummer || ""));
}

// ------------------------------------------------------------------ Datum
// Ein Tagesfeld (YYYY-MM-DD). Die Zeichenkette wird nicht nur nach Form
// geprueft, sondern auch nach GUELTIGKEIT: "2026-13-45" sieht richtig aus,
// erreichte aber Postgres und brach dort mit einem 500 ab (Befund 6 des
// Pruefers, 05.09.2026). Jetzt kommt "" zurueck, und der Aufrufer setzt heute.
const tagFeld = (d) => {
  if (!d) return "";
  if (typeof d === "string") {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    const [, j, mo, t] = m.map(Number);
    if (mo < 1 || mo > 12 || t < 1 || t > 31 || j < 1900 || j > 2999) return "";
    const probe = new Date(j, mo - 1, t);
    if (probe.getFullYear() !== j || probe.getMonth() !== mo - 1 || probe.getDate() !== t) return "";
    return d.slice(0, 10);
  }
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const heute = () => tagFeld(new Date());
function tageSpaeter(tag, tage) {
  const [j, m, t] = String(tag || heute()).split("-").map(Number);
  const d = new Date(j, m - 1, t + tage);
  return tagFeld(d);
}
// Rechnung: +14 Tage Zahlungsziel · Angebot: +30 Tage gueltig (wie beleg-erstellen.js).
function frist(art, datum) {
  return tageSpaeter(datum || heute(), FRIST_TAGE[art === "angebot" ? "angebot" : "rechnung"]);
}
const datumDe = (tag) => {
  const t = tagFeld(tag);
  if (!t) return "";
  const [j, m, d] = t.split("-");
  return `${d}.${m}.${j}`;
};
const datumLang = (tag) => {
  const t = tagFeld(tag);
  if (!t) return "";
  const [j, m, d] = t.split("-").map(Number);
  return new Date(j, m - 1, d).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
};
const euro = (n) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(Number(n) || 0);

// ------------------------------------------------------------------ Empfaenger
// Schnappschuss aus der Firma. Ansprechperson = Geschaeftsfuehrer aus der
// Cold-Calling-Liste (0006), Adresse aus adresse/plz/ort (0001).
function empfaengerAusFirma(f) {
  if (!f) return { name: "", ansprechperson: "", strasse: "", plz_ort: "", email: "", anrede: "" };
  return {
    name: String(f.name || "").trim(),
    ansprechperson: String(f.geschaeftsfuehrer || "").trim(),
    strasse: String(f.adresse || "").trim(),
    plz_ort: [f.plz, f.ort].filter(Boolean).join(" ").trim(),
    email: String(f.email || "").trim(),
    // Anrede aus firmen.geschlecht (0009: m | w | d) — nur, wenn es klar ist.
    anrede: /^m/i.test(String(f.geschlecht || "")) ? "Herr" : /^w/i.test(String(f.geschlecht || "")) ? "Frau" : "",
  };
}
function empfaengerSaeubern(e) {
  const s = (x, max) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return {
    name: s(e && e.name, 160), ansprechperson: s(e && e.ansprechperson, 120),
    strasse: s(e && e.strasse, 120), plz_ort: s(e && e.plz_ort, 80), email: s(e && e.email, 160),
    anrede: ["Herr", "Frau"].includes(s(e && e.anrede, 10)) ? s(e && e.anrede, 10) : "",
  };
}
const MAIL_MUSTER = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[a-z]{2,}$/i;

// ------------------------------------------------------------------ Absender
//
// ZWEI Briefkoepfe, und das ist kein Versehen (05.09.2026, aus Lukas' Ordner
// ~/…/Webseiten/Sale/Rechnungen ausgelesen): Angebote gehen unter
// "Flowstate AI Solutions", Rechnungen unter "SVH Consulting GbR" — beide
// Am Anger 3, 84539 Zangberg. Das zieht sich durch alle 30 Rechnungen und
// 18 Angebote. Die frueheren Vorgaben aus PRODUCT.md ("84405 Dorfen") gelten
// fuer Belege NICHT und stehen deshalb nicht mehr hier.
//
// Alles laesst sich ueber die Umgebung uebersteuern: RECHNUNG_ABSENDER_* bzw.
// ANGEBOT_ABSENDER_*, mit den alten FIRMA_* als gemeinsame Rueckfallebene.
// Die Vorgaben sind aber vollstaendig — das OS schreibt auch ohne .env richtig.
const ABSENDER_VORGABE = {
  rechnung: {
    logo1: "SVH", logo2: "CONSULTING", claim: "",
    name: "SVH Consulting GbR", rechtsform: "",
    strasse: "Am Anger 3", plz_ort: "84539 Zangberg", ort: "Zangberg",
    mail: "jannikvomhofe83@gmail.com", telefon: "+49 1511 7796888",
    iban: "DE21 7115 1020 0032 0980 71", bic: "BYLADEM1MDF", bank: "",
    kontoinhaber: "Jannik vom Hofe",
    steuernr: "141/174/10707", ustid: "DE464385333",
    vertreten: "Lukas Sehorz, Jannik vom Hofe", unterschrift: "Jannik vom Hofe",
  },
  angebot: {
    logo1: "FLOWSTATE", logo2: "AI SOLUTIONS", claim: "Webdesign · SEO · KI-Suchoptimierung",
    name: "Flowstate AI Solutions", rechtsform: "Sehorz Lukas, vom Hofe Jannik GbR",
    strasse: "Am Anger 3", plz_ort: "84539 Zangberg", ort: "Zangberg",
    mail: "Lukas.sehorz@hotmail.com", telefon: "0172 3465896",
    iban: "", bic: "", bank: "", kontoinhaber: "",
    steuernr: "", ustid: "",
    vertreten: "Lukas Sehorz, Jannik vom Hofe", unterschrift: "Lukas Sehorz",
  },
};
const ABSENDER_FELDER = Object.keys(ABSENDER_VORGABE.rechnung);

function absender(art = "rechnung") {
  const a = art === "angebot" ? "angebot" : "rechnung";
  const praefix = a === "angebot" ? "ANGEBOT_ABSENDER_" : "RECHNUNG_ABSENDER_";
  const env = (k) => String(process.env[k] || "").trim();
  const vorgabe = ABSENDER_VORGABE[a];
  const abs = { art: a };
  // Reihenfolge: eigener Satz -> gemeinsamer FIRMA_-Satz -> Hausvorgabe.
  for (const feld of ABSENDER_FELDER) {
    const gross = feld.toUpperCase();
    abs[feld] = env(praefix + gross) || env("FIRMA_" + gross) || vorgabe[feld];
  }
  const mailAbsender = env("MAIL_ABSENDER") || `${abs.unterschrift} <${abs.mail}>`;
  abs.mailAbsender = mailAbsender;
  // Die Fusszeile braucht "Name · Rechtsform"; im Mailtext genuegt der Name.
  abs.firmaZeile = [abs.name, abs.rechtsform].filter(Boolean).join(" · ");
  return abs;
}

// ------------------------------------------------------------------ Mailtext
// Bewusst ohne Sprachmodell — drei Saetze, kein Spielraum (wie
// beleg-erstellen.mailTexten). Unterschrift ist, wer sendet.
function mailTexten(r, user, abs = absender(r && r.art)) {
  const wort = r.art === "angebot" ? "Angebot" : (r.abschlag_von ? "Abschlagsrechnung" : "Rechnung");
  const e = r.empfaenger || {};
  const anrede = e.ansprechperson ? `Hallo ${e.ansprechperson},` : "Guten Tag,";
  const wofuer = r.titel ? ` für ${r.titel}` : "";
  const koerper = r.art === "angebot"
    ? `vielen Dank für Ihr Interesse. Anbei erhalten Sie unser Angebot ${r.nummer} über ${euro(r.summe)}${wofuer}.\n\nDas Angebot ist gültig bis zum ${datumLang(r.faellig)}. Bei Fragen melden Sie sich gerne jederzeit.`
    : `anbei erhalten Sie die ${wort} ${r.nummer} über ${euro(r.summe)}${wofuer}.\n\nWir bitten um Überweisung bis zum ${datumLang(r.faellig)} unter Angabe des Verwendungszwecks ${r.nummer}.\n\nVielen Dank für die gute Zusammenarbeit.`;
  return {
    betreff: `${wort} ${r.nummer} – ${e.name || "Kunde"}`,
    text: `${anrede}\n\n${koerper}\n\nViele Grüße\n${(user && user.name) || "Lukas Sehorz"}\n${abs.firmaZeile || abs.name}`,
  };
}

// Die Nutzenliste des Angebots: eine Zeile je Punkt, im Formular als Textfeld
// gepflegt. Leere Zeilen fliegen raus, damit ein versehentlicher Absatz keine
// leere Aufzaehlung mit goldenem Quadrat erzeugt.
function nutzenListe(r) {
  return String((r && r.nutzen) || "").replace(/\r\n?/g, "\n").split("\n")
    .map((t) => t.trim()).filter(Boolean).slice(0, 12);
}

// ------------------------------------------------------------------ PDF
//
// Zwei Vorlagen, nachgebaut nach Lukas' echten Belegen (05.09.2026):
//   Rechnung  = 36_Anderka_Bau_Website_Abschlag.docx (R-2026-139), Serifenschrift
//   Angebot   = Angebote/26_Elektro_Albonni_Website.docx (2026-026), Arial
// Alle Masse unten sind AUS DEN VORBILDERN GEMESSEN, nicht geschaetzt: die
// beiden PDF-Ausdrucke wurden Pixel fuer Pixel abgetastet (scratchpad/
// png-lesen.js), Grundlinien und Flaechenkanten in Punkt umgerechnet, die
// Schriftgroessen aus der gemessenen Textbreite geteilt durch die AFM-Breite
// zurueckgerechnet. Wo die schriftliche Spezifikation und die Messung
// auseinandergingen, gilt die Messung; die Abweichungen stehen im Bericht.
//
// Ursprung oben links, Einheit Punkt (lib/pdf-schreiben.js).
const L = pdf.mm(25), R = 595.28 - pdf.mm(25), BREITE = R - L;
// Farben aus den Word-Dateien (Spezifikation), als 0..1-Tripel.
const GOLD = [0.788, 0.659, 0.298];       // #C9A84C
const DUNKEL = [0.102, 0.102, 0.102];     // #1A1A1A
const GRAU = [0.4, 0.4, 0.4];             // #666666
const GRAU2 = [0.267, 0.267, 0.267];      // #444444
const HELL = [0.961, 0.961, 0.961];       // #F5F5F5
const WEISS = [1, 1, 1];
const RAHMEN = [0.85, 0.85, 0.85];        // feine Zellenlinien
// Fusszeile: goldene Linie und zwei Zeilen, auf beiden Vorlagen gleich hoch.
const FUSS_LINIE = 784.8, FUSS_1 = 797, FUSS_2 = 806;
const UNTEN = FUSS_LINIE - 24;            // hier muss der Satzspiegel enden

// Der §-19-Satz steht WOERTLICH so in jeder Rechnung des Bestands. Er ist
// fest verdrahtet und nicht Teil des editierbaren Schlusstextes — sonst
// koennte ihn jemand versehentlich loeschen, und dann fehlt der Pflichthinweis.
const PARAGRAF19 = "Gemäß § 19 Abs. 1 UStG wird keine Umsatzsteuer ausgewiesen (Kleinunternehmerregelung). Der ausgewiesene Betrag ist der endgültige Rechnungsbetrag.";

// Leistungstext einer Position als EIN Fliesstext (Rechnung) — die Hausvorlage
// trennt nicht in Titel und Beschreibung. Menge/Einheit haben keine eigenen
// Spalten; weicht die Menge von 1 ab, wird sie in den Text gezogen, damit der
// Kunde den Sprung von Einzelpreis zu Gesamt nachvollziehen kann.
function leistungText(p) {
  const teile = [String(p.titel || "").trim(), String(p.beschreibung || "").replace(/\s*\n\s*/g, " ").trim()]
    .filter(Boolean);
  let t = teile.join(" – ");
  const menge = Number(p.menge) || 1;
  if (menge !== 1) t += ` (${String(menge).replace(".", ",")} ${p.einheit || "Stück"} à ${euro(p.einzelpreis || 0)})`;
  return t;
}
const mengeHinweis = (p) => {
  const menge = Number(p.menge) || 1;
  return menge === 1 ? "" : `${String(menge).replace(".", ",")} ${p.einheit || "Stück"} à ${euro(p.einzelpreis || 0)}`;
};

// Die Anrede eines Briefes. Nachname allein, wenn Herr/Frau bekannt ist —
// sonst der ganze Name mit "Guten Tag", und ohne Ansprechperson die Firmenform.
// Steht hier gemeinsam, weil Rechnung und Angebot dieselbe Anrede schreiben.
function anredeZeile(e = {}) {
  const person = String(e.ansprechperson || "").trim();
  if (!person) return "Sehr geehrte Damen und Herren,";
  const nachname = person.split(/\s+/).pop();
  if (e.anrede === "Herr") return `Sehr geehrter Herr ${nachname},`;
  if (e.anrede === "Frau") return `Sehr geehrte Frau ${nachname},`;
  return `Guten Tag ${person},`;
}

// Empfaengerblock: die Hausvorlage schreibt Firma fett, dann "Herrn"/"Frau"
// + Name, Strasse, PLZ Ort. Lange Zeilen werden umgebrochen (250 pt), sonst
// laufen sie in den rechten Infoblock — Befund des Pruefers, 05.09.
const EMPF_BREITE = 250;
function empfaengerZeilen(e) {
  const person = [e.anrede === "Herr" ? "Herrn" : e.anrede === "Frau" ? "Frau" : "", e.ansprechperson]
    .filter(Boolean).join(" ").trim();
  return [
    { text: e.name, fett: true },
    ...[person, e.strasse, e.plz_ort].filter(Boolean).map((t) => ({ text: t, fett: false })),
  ].filter((z) => z.text);
}

// Gemeinsame Fusszeile: goldene Linie, darunter zwei Zeilen. Die Rechnung
// setzt sie linksbuendig, das Angebot zentriert — so steht es in den
// Vorbildern, und so bleibt es.
function fusszeile(d, abs, zeilen, { schrift, zentriert }) {
  const n = d.seiten();
  for (let i = 0; i < n; i++) {
    d.seiteWaehlen(i);
    d.linie(L, FUSS_LINIE, R, FUSS_LINIE, { staerke: 0.75, farbe: GOLD });
    zeilen.forEach((t, k) => {
      if (!t) return;
      const y = k === 0 ? FUSS_1 : FUSS_2;
      if (zentriert) d.text(L + BREITE / 2, y, t, { groesse: 7.5, farbe: GRAU, ausrichtung: "mitte", schrift });
      else d.text(L, y, t, { groesse: 7.5, farbe: GRAU, schrift });
    });
    // Seitenzahl nur, wenn es mehr als eine Seite gibt — die Vorbilder sind
    // einseitig und tragen keine.
    if (n > 1) d.text(R, FUSS_2, `Seite ${i + 1} von ${n}`, { groesse: 7.5, farbe: GRAU, ausrichtung: "rechts", schrift });
  }
}

// Kopfmarke fuer Entwuerfe. Steht nur auf noch nicht gestellten Vorgaengen —
// ein gestelltes PDF sieht deshalb aus wie die Hausvorlage, ohne Zusatz.
function entwurfMarke(d, schrift) {
  d.text(R, 50, "ENTWURF – noch nicht gestellt", { groesse: 8, fett: true, farbe: [0.6, 0.45, 0.1], ausrichtung: "rechts", schrift });
}

// ---------------------------------------------------------------- Rechnung
function pdfRechnung(r, abs, { unterschrift = "" } = {}) {
  const S = "serif";
  const entwurf = !r.nummer || r.status === "entwurf";
  const nummer = r.nummer || "";
  const wort = r.abschlag_von ? "Abschlagsrechnung" : "Rechnung";
  const e = r.empfaenger || {};
  const positionen = Array.isArray(r.positionen) ? r.positionen : [];
  const gesamt = rund(r.summe !== undefined && r.summe !== null ? r.summe : summe(positionen));
  const d = pdf.neu({
    titel: `${wort} ${nummer || "(Entwurf)"} – ${e.name || ""}`.trim(),
    autor: abs.name, betreff: r.titel || wort, schrift: S,
  });

  // 1 Briefkopf: "SVH" schwarz + "CONSULTING" gold, 16 pt (gemessen 15,8).
  const x1 = L + d.text(L, 69, abs.logo1, { groesse: 16, fett: true, farbe: DUNKEL });
  if (abs.logo2) d.text(x1 + d.textBreite(" ", 16, true), 69, abs.logo2, { groesse: 16, fett: true, farbe: GOLD });
  // 2 Goldene Linie
  d.linie(L, 85.5, R, 85.5, { staerke: 1.2, farbe: GOLD });
  if (entwurf) entwurfMarke(d, S);
  // 3 Absenderzeile klein grau
  d.text(L, 103, [abs.name, abs.strasse, abs.plz_ort].filter(Boolean).join("  ·  "), { groesse: 7.5, farbe: GRAU });
  // 4 Empfaenger links, Ort/Datum rechts auf gleicher Hoehe
  let y = 129;
  for (const z of empfaengerZeilen(e)) {
    for (const t of d.umbrechen(z.text, EMPF_BREITE, 11, z.fett)) { d.text(L, y, t, { groesse: 11, fett: z.fett }); y += 12.6; }
  }
  d.text(R, 129, `${abs.ort || abs.plz_ort}, ${datumDe(r.datum) || datumDe(heute())}`, { groesse: 11, ausrichtung: "rechts" });
  // 5 Rechnungsnummer und Leistungsdatum, rechtsbuendig
  const infoOben = Math.max(183, y + 16);
  d.text(R, infoOben, `Rechnungsnummer: ${nummer || "wird beim Stellen vergeben"}`, { groesse: 10.5, ausrichtung: "rechts" });
  d.text(R, infoOben + 12, `Leistungsdatum: ${datumDe(r.datum) || datumDe(heute())}`, { groesse: 10.5, ausrichtung: "rechts" });
  // 6 Ueberschrift
  y = infoOben + 47;
  // Immer "RECHNUNG", auch beim Abschlag: Das Vorbild R-2026-139 IST eine
  // Abschlagsrechnung und traegt trotzdem diese Ueberschrift — was daran
  // Abschlag ist, steht im Leistungstext. "ABSCHLAGSRECHNUNG" waere ausserdem
  // so breit, dass es die Zeile sprengt.
  d.text(L, y, "RECHNUNG", { groesse: 18, fett: true, farbe: DUNKEL });
  d.text(L, y + 19, `Rechnungsnummer ${nummer || "wird beim Stellen vergeben"}`, { groesse: 10.5, farbe: GRAU });
  y += 19;

  // 6b KEINE Anrede auf der Rechnung (06.09.2026 korrigiert). Die Vorbilder
  // R-2026-138/139 springen von "Rechnungsnummer R-2026-139" direkt in die
  // Tabelle: eine Rechnung ist ein Beleg, kein Brief — die Anredezeile war mein
  // Zusatz und stand in keiner der 30 Hausrechnungen. Beim Angebot ist sie
  // richtig und bleibt dort (siehe Abschnitt 7 des Angebots weiter unten).
  // Das Einleitungsfeld des Formulars wirkt weiter: was jemand dort eintippt,
  // muss auf dem Blatt erscheinen, sonst tippt er ins Leere. Ist es leer —
  // der Normalfall bei Rechnungen —, folgt die Tabelle unmittelbar.
  const einleitungText = String(r.einleitung || "").trim();
  if (einleitungText) {
    y += 26;
    y = d.absatz(L, y, einleitungText, { breite: BREITE, groesse: 10.5, farbe: GRAU2, zeilenhoehe: 12.6 }) - 12.6;
  }

  // 7 Tabelle. Spalten aus dem Vorbild: |  Pos.  |  Leistung  | Einzelpreis | Gesamt |
  const SP = { trenn1: L + 34, leistung: L + 40, trenn2: L + 302, preisR: L + 370, trenn3: L + 377, gesamtR: R - 7 };
  const leistungBreite = SP.trenn2 - SP.leistung - 8;
  const KOPF_H = 21.7, ZEILE = 10.85;
  let tabOben = y + 33;      // Oberkante des schwarzen Balkens
  let zeileOben = tabOben;   // Oberkante der laufenden Zeile (fuer die Rahmen)
  const rahmenSeiten = [];   // je Seite: {oben, unten} fuer die senkrechten Linien

  const kopfBalken = () => {
    d.rechteck(L, tabOben, BREITE, KOPF_H, { fuellung: DUNKEL });
    const b = tabOben + 14.5;
    d.text(L + 17, b, "Pos.", { groesse: 9.5, fett: true, farbe: WEISS, ausrichtung: "mitte" });
    d.text(SP.leistung, b, "Leistung", { groesse: 9.5, fett: true, farbe: WEISS });
    d.text(SP.preisR, b, "Einzelpreis", { groesse: 9.5, fett: true, farbe: WEISS, ausrichtung: "rechts" });
    d.text(SP.gesamtR, b, "Gesamt", { groesse: 9.5, fett: true, farbe: WEISS, ausrichtung: "rechts" });
    zeileOben = tabOben + KOPF_H;
    return zeileOben;
  };
  const seitenwechsel = () => {
    rahmenSeiten.push({ seite: d.aktuell(), oben: tabOben, unten: zeileOben });
    d.seite();
    if (entwurf) entwurfMarke(d, S);
    tabOben = pdf.mm(30);
    return kopfBalken();
  };

  y = kopfBalken() + 16.3;   // Grundlinie der ersten Textzeile
  positionen.forEach((p, i) => {
    const zeilen = d.umbrechen(leistungText(p), leistungBreite, 9.5);
    const hoehe = zeilen.length * ZEILE + 10;
    if (y + hoehe > UNTEN) y = seitenwechsel() + 16.3;
    const start = y;
    for (const t of zeilen) { d.text(SP.leistung, y, t, { groesse: 9.5 }); y += ZEILE; }
    // Nummer und Betraege senkrecht mittig zur Leistung — wie im Vorbild.
    const mitte = start + (zeilen.length - 1) * ZEILE / 2;
    d.text(L + 17, mitte, String(i + 1), { groesse: 9.5, ausrichtung: "mitte" });
    const preis = p.einzelpreis === null || p.einzelpreis === undefined ? "–" : euro(p.einzelpreis);
    d.text(SP.preisR, mitte, preis, { groesse: 9.5, ausrichtung: "rechts" });
    d.text(SP.gesamtR, mitte, p.einzelpreis === null || p.einzelpreis === undefined ? "–" : euro(positionSumme(p)), { groesse: 9.5, ausrichtung: "rechts" });
    y = start + zeilen.length * ZEILE + 4.8;
    d.linie(L, y, R, y, { staerke: 0.4, farbe: RAHMEN });
    zeileOben = y;
  });
  if (!positionen.length) {
    d.text(SP.leistung, y, "Noch keine Positionen.", { groesse: 9.5, farbe: GRAU });
    y += ZEILE + 4.8;
    d.linie(L, y, R, y, { staerke: 0.4, farbe: RAHMEN });
    zeileOben = y;
  }
  // Summenzeilen: "Gesamt" weiss, "Gesamtbetrag" auf #F5F5F5.
  if (zeileOben + 2 * KOPF_H > UNTEN) { y = seitenwechsel(); zeileOben = y; }
  d.text(SP.preisR, zeileOben + 15, "Gesamt", { groesse: 10.5, ausrichtung: "rechts" });
  d.text(SP.gesamtR, zeileOben + 15, euro(gesamt), { groesse: 10.5, ausrichtung: "rechts" });
  const gbOben = zeileOben + KOPF_H;
  d.linie(L, gbOben, R, gbOben, { staerke: 0.4, farbe: RAHMEN });
  d.rechteck(L, gbOben, BREITE, KOPF_H, { fuellung: HELL });
  d.text(SP.leistung, gbOben + 16.3, "Gesamtbetrag", { groesse: 10.5, fett: true });
  d.text(SP.gesamtR, gbOben + 16.3, euro(gesamt), { groesse: 10.5, fett: true, ausrichtung: "rechts" });
  const tabUnten = gbOben + KOPF_H;
  d.linie(L, tabUnten, R, tabUnten, { staerke: 0.4, farbe: RAHMEN });
  rahmenSeiten.push({ seite: d.aktuell(), oben: tabOben, unten: tabUnten });
  // Senkrechte Rahmen je Seite nachtragen (Hoehe steht erst jetzt fest).
  const jetzt = d.aktuell();
  for (const s of rahmenSeiten) {
    d.seiteWaehlen(s.seite);
    for (const x of [L, SP.trenn1, SP.trenn2, SP.trenn3, R]) d.linie(x, s.oben, x, s.unten, { staerke: 0.4, farbe: RAHMEN });
  }
  d.seiteWaehlen(jetzt);

  // 8 §-19-Satz
  y = tabUnten + 15.7;
  if (y + 40 > UNTEN) { d.seite(); if (entwurf) entwurfMarke(d, S); y = pdf.mm(30); }
  y = d.absatz(L, y, PARAGRAF19, { breite: BREITE, groesse: 9.5, farbe: GRAU, zeilenhoehe: 10.8 });

  // 9 Zahlungsblock als Label/Wert-Paare
  const zahlung = [
    ["Zahlungsziel:", `${FRIST_TAGE.rechnung} Tage nach Rechnungseingang — fällig bis ${datumDe(r.faellig) || datumDe(frist("rechnung", r.datum))}`],
    ["IBAN:", abs.iban], ["BIC:", abs.bic],
    ["Verwendungszweck:", nummer || "wird beim Stellen vergeben"],
    ["Kontoinhaber:", abs.kontoinhaber],
  ].filter(([, w]) => w);
  y += 17;
  if (y + zahlung.length * 18 > UNTEN) { d.seite(); if (entwurf) entwurfMarke(d, S); y = pdf.mm(30); }
  for (const [k, w] of zahlung) {
    d.text(L, y, k, { groesse: 10.5, fett: true });
    d.text(L + 138, y, w, { groesse: 10.5, farbe: GRAU2 });
    y += 18;
  }

  // 10 Freier Schlusstext (in der Hausvorlage leer) und Gruss.
  // Die Platzpruefung rechnet mit der ECHTEN Hoehe der Bloecke. Mit den
  // Pauschalwerten von vorher (30 bzw. 50 pt) rutschten bei einer normalen
  // Rechnung die drei Grusszeilen allein auf eine zweite Seite, obwohl noch
  // 55 pt frei waren (06.09.2026 an der Vorbild-Rechnung nachgemessen).
  const schlussText = String(r.schluss || "").trim();
  if (schlussText) {
    const hoehe = d.umbrechen(schlussText, BREITE, 10.5).length * 12.6 + 6;
    if (y + hoehe > UNTEN) { d.seite(); if (entwurf) entwurfMarke(d, S); y = pdf.mm(30); }
    y = d.absatz(L, y + 6, schlussText, { breite: BREITE, groesse: 10.5, zeilenhoehe: 12.6 }) + 6;
  }
  // Gruss: Vorlauf 16, dann drei Zeilen auf y, y+14, y+26.
  if (y + 42 > UNTEN) { d.seite(); if (entwurf) entwurfMarke(d, S); y = pdf.mm(30); }
  y += 16;
  d.text(L, y, "Mit freundlichen Grüßen", { groesse: 11 });
  d.text(L, y + 14, unterschrift || abs.unterschrift, { groesse: 11, fett: true });
  d.text(L, y + 26, abs.name, { groesse: 11, farbe: GRAU });

  // 11 Fusszeile: linksbuendig (so steht es im Vorbild), mit Steuernummer und USt-IdNr.
  fusszeile(d, abs, [
    [abs.name, abs.vertreten ? `Vertreten durch: ${abs.vertreten}` : ""].filter(Boolean).join("  ·  "),
    [`${abs.strasse}, ${abs.plz_ort}`, abs.mail, abs.telefon,
     abs.steuernr ? `Steuernummer: ${abs.steuernr}` : "", abs.ustid ? `USt-IdNr.: ${abs.ustid}` : ""].filter(Boolean).join("  ·  "),
  ], { schrift: S, zentriert: false });
  return d.fertig();
}

// ----------------------------------------------------------------- Angebot
function pdfAngebot(r, abs, { unterschrift = "" } = {}) {
  const S = "sans";
  const entwurf = !r.nummer || r.status === "entwurf";
  const nummer = r.nummer || "";
  const e = r.empfaenger || {};
  const positionen = Array.isArray(r.positionen) ? r.positionen : [];
  const gesamt = rund(r.summe !== undefined && r.summe !== null ? r.summe : summe(positionen));
  const d = pdf.neu({
    titel: `Angebot ${nummer || "(Entwurf)"} – ${e.name || ""}`.trim(),
    autor: abs.name, betreff: r.titel || "Angebot", schrift: S,
  });

  // 1 Briefkopf: "FLOWSTATE" schwarz + "AI SOLUTIONS" gold, 20 pt, darunter der Claim.
  const x1 = L + d.text(L, 64, abs.logo1, { groesse: 20, fett: true, farbe: DUNKEL });
  if (abs.logo2) d.text(x1 + d.textBreite(" ", 20, true), 64, abs.logo2, { groesse: 20, fett: true, farbe: GOLD });
  if (abs.claim) d.text(L, 76.5, abs.claim, { groesse: 9, farbe: GRAU });
  // 2 Goldene Linie
  d.linie(L, 94.5, R, 94.5, { staerke: 2.2, farbe: GOLD });
  if (entwurf) entwurfMarke(d, S);
  // 3 Absenderzeile
  d.text(L, 111.5, [abs.name, abs.strasse, abs.plz_ort].filter(Boolean).join(" · "), { groesse: 8, farbe: GRAU });
  // 4 Empfaenger
  let y = 131;
  for (const z of empfaengerZeilen(e)) {
    for (const t of d.umbrechen(z.text, EMPF_BREITE, 10, z.fett)) { d.text(L, y, t, { groesse: 10, fett: z.fett }); y += 12.4; }
  }
  // 5 Rechter Block: Label grau, Wert fett — Datum ausgeschrieben.
  let iy = Math.max(190, y + 22);
  const rechts = [
    ["Angebot-Nr.", nummer || "wird beim Stellen vergeben"],
    ["Datum", datumLang(r.datum) || datumLang(heute())],
    ["Gültig bis", datumLang(r.faellig) || datumLang(frist("angebot", r.datum))],
  ];
  for (const [k, w] of rechts) {
    const bw = d.textBreite(w, 10, true);
    d.text(R, iy, w, { groesse: 10, fett: true, ausrichtung: "rechts" });
    d.text(R - bw - 8, iy, k, { groesse: 10, farbe: GRAU, ausrichtung: "rechts" });
    iy += 11.6;
  }
  // 6 Ueberschrift
  y = Math.max(iy + 19, y + 40);
  d.text(L, y, "Angebot", { groesse: 16, fett: true, farbe: DUNKEL });
  y += 19;
  // 7 Anrede
  d.text(L, y, anredeZeile(e), { groesse: 10 });
  y += 17.6;
  // 8 Einleitung
  if (r.einleitung) y = d.absatz(L, y, r.einleitung, { breite: BREITE, groesse: 10, zeilenhoehe: 10.8 }) + 7;
  // 9 Nutzenliste mit goldenen Quadraten — das Herz des Angebots.
  const nutzen = nutzenListe(r);
  for (const punkt of nutzen) {
    const zeilen = d.umbrechen(punkt, BREITE - 19, 10);
    if (y + zeilen.length * 11.3 > UNTEN) { d.seite(); if (entwurf) entwurfMarke(d, S); y = pdf.mm(30); }
    d.rechteck(L + 8, y - 6, 3.4, 3.4, { fuellung: GOLD });
    for (const t of zeilen) { d.text(L + 19, y, t, { groesse: 10 }); y += 11.3; }
    y += 2.5;
  }
  if (nutzen.length) y += 4;

  // 10 Tabelle: schwarzer Kopfbalken, Pos. · Leistung · Betrag
  const SPX = { pos: L + 21, leistung: L + 50, betragR: R - 8 };
  const leistungBreite = SPX.betragR - SPX.leistung - 60;
  const KOPF_H = 20.4;
  const kopfBalken = (oben) => {
    d.rechteck(L, oben, BREITE, KOPF_H, { fuellung: DUNKEL });
    const b = oben + 13.5;
    d.text(L + 9, b, "Pos.", { groesse: 8.5, fett: true, farbe: WEISS });
    d.text(SPX.leistung, b, "Leistung", { groesse: 8.5, fett: true, farbe: WEISS });
    d.text(SPX.betragR, b, "Betrag", { groesse: 8.5, fett: true, farbe: WEISS, ausrichtung: "rechts" });
    return oben + KOPF_H;
  };
  y = kopfBalken(y + 8) + 15.3;
  positionen.forEach((p, i) => {
    const titelZeilen = d.umbrechen(p.titel || "Leistung", leistungBreite, 10, true);
    const absaetze = String(p.beschreibung || "").replace(/\r\n?/g, "\n").split("\n").map((t) => t.trim()).filter(Boolean);
    const hinweis = mengeHinweis(p);
    if (hinweis) absaetze.push(hinweis);
    const textZeilen = absaetze.flatMap((t) => d.umbrechen(t, leistungBreite, 9.5));
    const hoehe = titelZeilen.length * 12 + textZeilen.length * 10.7 + 12;
    if (y + hoehe > UNTEN) { d.seite(); if (entwurf) entwurfMarke(d, S); y = kopfBalken(pdf.mm(30)) + 15.3; }
    const start = y;
    d.text(SPX.pos, y, String(i + 1), { groesse: 10, ausrichtung: "mitte" });
    d.text(SPX.betragR, y, p.einzelpreis === null || p.einzelpreis === undefined ? "–" : euro(positionSumme(p)), { groesse: 10, ausrichtung: "rechts" });
    for (const t of titelZeilen) { d.text(SPX.leistung, y, t, { groesse: 10, fett: true }); y += 12; }
    y += 1.8;
    for (const t of textZeilen) { d.text(SPX.leistung, y, t, { groesse: 9.5, farbe: GRAU }); y += 10.7; }
    y = Math.max(y, start + 12) + 6.8;
  });
  if (!positionen.length) { d.text(SPX.leistung, y, "Noch keine Positionen.", { groesse: 10, farbe: GRAU }); y += 18; }

  // 11 Summenbalken: schwarz, links weiss "Gesamtpaket", rechts gold der Betrag.
  if (y + 30 > UNTEN) { d.seite(); if (entwurf) entwurfMarke(d, S); y = pdf.mm(30); }
  const balken = y - 5;
  d.rechteck(L, balken, BREITE, 24.9, { fuellung: DUNKEL });
  d.text(L + 8, balken + 16, "Gesamtpaket", { groesse: 10.5, fett: true, farbe: WEISS });
  d.text(SPX.betragR, balken + 16, euro(gesamt), { groesse: 10.5, fett: true, farbe: GOLD, ausrichtung: "rechts" });
  y = balken + 24.9 + 28.9;

  // 12 Schlussabsatz, Gruss
  const schlussText = String(r.schluss || "").trim();
  if (schlussText) {
    const hoehe = d.umbrechen(schlussText, BREITE, 10).length * 11.3 + 3;
    if (y + hoehe > UNTEN) { d.seite(); if (entwurf) entwurfMarke(d, S); y = pdf.mm(30); }
    y = d.absatz(L, y, schlussText, { breite: BREITE, groesse: 10, zeilenhoehe: 11.3 }) + 3;
  }
  // Gruss: Vorlauf 11, dann drei Zeilen auf y, y+12, y+23.
  if (y + 34 > UNTEN) { d.seite(); if (entwurf) entwurfMarke(d, S); y = pdf.mm(30); }
  y += 11;
  d.text(L, y, "Mit freundlichen Grüßen", { groesse: 10 });
  d.text(L, y + 12, unterschrift || abs.unterschrift, { groesse: 10, fett: true });
  d.text(L, y + 23, abs.name, { groesse: 10, farbe: GRAU });

  // 13 Fusszeile: zentriert, ohne Steuernummer (steht in keinem Angebot).
  fusszeile(d, abs, [
    [abs.name, abs.rechtsform, `${abs.strasse}, ${abs.plz_ort}`].filter(Boolean).join("  ·  "),
    [abs.vertreten ? `Vertreten durch: ${abs.vertreten}` : "", abs.mail, abs.telefon].filter(Boolean).join("  ·  "),
  ], { schrift: S, zentriert: true });
  return d.fertig();
}

function pdfBauen(r, abs, opt = {}) {
  const art = r && r.art === "angebot" ? "angebot" : "rechnung";
  // Ein mitgegebener Absender wird nur genommen, wenn er zur Art passt —
  // sonst stuende auf dem Angebot der Rechnungsbriefkopf.
  const a = abs && abs.art === art ? abs : absender(art);
  return art === "angebot" ? pdfAngebot(r, a, opt) : pdfRechnung(r, a, opt);
}

// ------------------------------------------------------------------ Datenzugriff
const SPALTEN = `r.id, r.nummer, r.art, r.firma_id, r.empfaenger, to_char(r.datum,'YYYY-MM-DD') as datum,
  to_char(r.faellig,'YYYY-MM-DD') as faellig, r.positionen, r.summe, r.titel, r.einleitung, r.schluss, r.nutzen, r.status,
  to_char(r.bezahlt_am,'YYYY-MM-DD') as bezahlt_am, r.bezahlt_betrag, r.zahlungen, r.abschlag_von, r.abschlag_nr,
  r.abschlag_prozent, r.angebot_id, r.versendet_am, r.versendet_an, r.buchung_id, r.pdf_pruefsumme,
  (r.pdf is not null) as pdf_da, r.vorlage, r.storno_grund, r.erstellt_von, r.erstellt, r.geaendert`;

function zeile(x) {
  if (!x) return null;
  // bigint kommt aus pg als Text — fuer Vergleiche in Akte und Kosten-Seite
  // (firma_id === 13) sollen es Zahlen sein.
  for (const k of ["id", "firma_id", "abschlag_von", "angebot_id", "buchung_id"]) if (x[k] !== null && x[k] !== undefined) x[k] = Number(x[k]);
  x.summe = Number(x.summe) || 0;
  x.bezahlt_betrag = Number(x.bezahlt_betrag) || 0;
  x.abschlag_prozent = x.abschlag_prozent === null ? null : Number(x.abschlag_prozent);
  x.offen = rund(x.summe - x.bezahlt_betrag);
  x.prozent_bezahlt = x.summe > 0 ? Math.min(100, Math.round(x.bezahlt_betrag / x.summe * 100)) : 0;
  x.positionen = Array.isArray(x.positionen) ? x.positionen : [];
  x.zahlungen = Array.isArray(x.zahlungen) ? x.zahlungen : [];
  x.empfaenger = x.empfaenger && typeof x.empfaenger === "object" ? x.empfaenger : {};
  x.url = `/buchhaltung/rechnungen/${x.id}`;
  x.status_text = STATUS_TEXT[x.status] || x.status;
  x.status_farbe = STATUS_FARBE[x.status] || "grau";
  x.ueberfaellig_tage = 0;
  if (x.art === "rechnung" && ["gestellt", "teilbezahlt"].includes(x.status) && x.faellig && x.faellig < heute()) {
    x.ueberfaellig_tage = Math.round((new Date(x.faellig + "T12:00:00") - new Date(heute() + "T12:00:00")) / -86400000);
  }
  return x;
}

// Kacheln oben auf der Liste — echte Summen aus der Tabelle.
async function kacheln(user) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [k] } = await q(
      `select coalesce(sum(summe) filter (where art='rechnung' and status in ('gestellt','teilbezahlt','bezahlt')),0) as gestellt,
              coalesce(sum(bezahlt_betrag) filter (where art='rechnung' and status in ('gestellt','teilbezahlt','bezahlt')),0) as bezahlt,
              count(*) filter (where art='rechnung' and status in ('gestellt','teilbezahlt','bezahlt')) as anzahl_gestellt,
              count(*) filter (where art='rechnung' and status in ('gestellt','teilbezahlt')) as anzahl_offen,
              count(*) filter (where art='rechnung' and status in ('gestellt','teilbezahlt') and faellig < current_date) as anzahl_ueberfaellig,
              coalesce(sum(summe) filter (where art='angebot' and status='gestellt'),0) as angebote_offen,
              count(*) filter (where art='angebot' and status='gestellt') as anzahl_angebote_offen,
              count(*) filter (where status='entwurf') as anzahl_entwuerfe
         from rechnungen`);
    const gestellt = rund(k.gestellt), bezahlt = rund(k.bezahlt);
    return {
      gestellt, bezahlt, offen: rund(gestellt - bezahlt),
      anzahl_gestellt: Number(k.anzahl_gestellt), anzahl_offen: Number(k.anzahl_offen),
      anzahl_ueberfaellig: Number(k.anzahl_ueberfaellig),
      angebote_offen: rund(k.angebote_offen), anzahl_angebote_offen: Number(k.anzahl_angebote_offen),
      anzahl_entwuerfe: Number(k.anzahl_entwuerfe),
    };
  });
}

async function liste(user, { art = "", status = "", firma = "", suche = "" } = {}) {
  return alsNutzer(user.id, async (q) => {
    const w = [], a = [];
    if (art === "angebot" || art === "rechnung") { a.push(art); w.push(`r.art = $${a.length}`); }
    if (status && STATUS_TEXT[status]) { a.push(status); w.push(`r.status = $${a.length}`); }
    else if (status === "offen") w.push(`r.status in ('gestellt','teilbezahlt')`);
    if (/^\d+$/.test(String(firma))) { a.push(firma); w.push(`r.firma_id = $${a.length}`); }
    if (suche) { a.push(`%${suche}%`); w.push(`(r.nummer ilike $${a.length} or r.empfaenger->>'name' ilike $${a.length} or r.titel ilike $${a.length} or f.name ilike $${a.length})`); }
    const { rows } = await q(
      `select ${SPALTEN}, f.name as firma_name
         from rechnungen r left join firmen f on f.id = r.firma_id
        ${w.length ? "where " + w.join(" and ") : ""}
        order by (r.status='entwurf') desc, r.datum desc, r.id desc limit 500`, a);
    return rows.map(zeile);
  });
}

async function eine(user, id) {
  if (!/^\d+$/.test(String(id))) return null;
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select ${SPALTEN}, f.name as firma_name, f.tags as firma_tags, p.name as erstellt_von_name,
              a.nummer as angebot_nummer, v.nummer as auftrag_nummer, v.titel as auftrag_titel, v.summe as auftrag_summe, v.art as auftrag_art
         from rechnungen r
         left join firmen f on f.id = r.firma_id
         left join profiles p on p.id = r.erstellt_von
         left join rechnungen a on a.id = r.angebot_id
         left join rechnungen v on v.id = r.abschlag_von
        where r.id = $1`, [id]);
    const r = zeile(rows[0]);
    if (!r) return null;
    r.auftrag_summe = r.auftrag_summe === null || r.auftrag_summe === undefined ? null : Number(r.auftrag_summe);
    // Abschlaege, die an diesem Vorgang haengen, und Rechnungen aus diesem Angebot.
    const { rows: kinder } = await q(
      `select ${SPALTEN} from rechnungen r where r.abschlag_von = $1 or r.angebot_id = $1 order by r.abschlag_nr nulls last, r.id`, [id]);
    r.abschlaege = kinder.map(zeile).filter((k) => k.abschlag_von === r.id);
    r.rechnungen = kinder.map(zeile).filter((k) => k.angebot_id === r.id && !k.abschlag_von);
    return r;
  });
}

// Eingaben aus dem Formular in einen Datensatz — gemeinsam fuer anlegen/aendern.
function pruefen(d, art) {
  const empfaenger = empfaengerSaeubern(d.empfaenger || {});
  if (!empfaenger.name) return { ok: false, grund: "empfaenger" };
  if (empfaenger.email && !MAIL_MUSTER.test(empfaenger.email)) return { ok: false, grund: "mail" };
  const positionen = positionenSaeubern(d.positionen);
  if (!positionen.length) return { ok: false, grund: "positionen" };
  // Eine Position mit Preis, aber ohne Titel steht spaeter namenlos auf dem
  // Blatt — der Kunde liest einen Betrag ohne Leistung (Befund 13).
  if (positionen.some((p) => !p.titel)) return { ok: false, grund: "positionen" };
  // Ueberlauf abfangen, bevor Postgres es tut (Befund 6).
  if (positionen.some((p) => p.einzelpreis !== null && Math.abs(p.einzelpreis) > BETRAG_MAX)) return { ok: false, grund: "zu-gross" };
  if (Math.abs(summe(positionen)) > BETRAG_MAX) return { ok: false, grund: "zu-gross" };
  // Ein Datum, das keines ist ("2026-13-45"), wurde bisher still auf heute
  // gesetzt (Pruefung 67). Der 500er war damit weg, aber still ein anderes
  // Datum zu schreiben ist bei einer Rechnung falsch: Leistungsdatum und
  // Faelligkeit stehen auf dem Blatt beim Kunden und im Umsatzfenster der
  // Buchhaltung. Wer Unsinn schickt, bekommt eine Meldung (06.09.2026).
  // LEER bleibt erlaubt und heisst weiterhin "heute" bzw. "Frist aus dem
  // Datum" — darauf verlassen sich duplizieren() und die Vorbelegung.
  const gesetzt = (v) => v !== undefined && v !== null && String(v).trim() !== "";
  if (gesetzt(d.datum) && !tagFeld(d.datum)) return { ok: false, grund: "datum" };
  if (gesetzt(d.faellig) && !tagFeld(d.faellig)) return { ok: false, grund: "datum" };
  const datum = tagFeld(d.datum) || heute();
  const faellig = tagFeld(d.faellig) || frist(art, datum);
  const vorlage = VORLAGEN[d.vorlage] ? d.vorlage : "frei";
  return {
    ok: true,
    werte: {
      empfaenger, positionen, datum, faellig, vorlage,
      summe: summe(positionen),
      titel: String(d.titel ?? (VORLAGEN[vorlage].titel || "")).replace(/\s+/g, " ").trim().slice(0, 120),
      einleitung: String(d.einleitung ?? "").trim().slice(0, 2000),
      schluss: String(d.schluss ?? "").trim().slice(0, 2000),
      // Nutzenliste: je Zeile ein Punkt (siehe nutzenListe). Nur beim Angebot
      // gepflegt, auf der Rechnung bleibt sie leer.
      nutzen: art === "angebot" ? nutzenListe({ nutzen: d.nutzen }).join("\n").slice(0, 2000) : "",
      firma_id: /^\d+$/.test(String(d.firma_id || "")) ? Number(d.firma_id) : null,
    },
  };
}

// Bezuege eines neuen Vorgangs GEGEN DIE DATENBANK pruefen, in derselben
// Transaktion wie das Anlegen.
//
// Warum das sein muss (Pruefer-Befund 3 und 6, 05.09.2026): Die Abschlagsregeln
// standen nur in abschlag(). Wer das Formular direkt aufrief
// (…/neu?abschlag_von=12&prozent=150) oder einen POST von Hand baute, hing
// einen 150-%-Abschlag an eine schon gestellte Rechnung — der Umsatz zaehlte
// doppelt. Und eine firma_id oder angebot_id, die es nicht gibt, lief in einen
// Fremdschluesselfehler und damit in einen 500 statt in eine Meldung.
// Die Nummer und der Prozentsatz des Abschlags werden hier NEU gerechnet; was
// im Formular stand, ist nur ein Vorschlag.
async function bezuegePruefen(q, art, d) {
  const zahl = (x) => (/^\d+$/.test(String(x ?? "")) ? Number(x) : null);
  const firma_id = zahl(d.firma_id);
  if (firma_id !== null) {
    const { rowCount } = await q(`select 1 from firmen where id = $1`, [firma_id]);
    if (!rowCount) return { ok: false, grund: "firma" };
  }
  let angebot_id = zahl(d.angebot_id);
  if (angebot_id !== null) {
    const { rows: [a] } = await q(`select art from rechnungen where id = $1`, [angebot_id]);
    if (!a || a.art !== "angebot") return { ok: false, grund: "kein-angebot" };
  }
  const abschlag_von = zahl(d.abschlag_von);
  let abschlag_nr = null, abschlag_prozent = null;
  if (abschlag_von !== null) {
    if (art !== "rechnung") return { ok: false, grund: "kein-auftrag" };
    const { rows } = await q(`select ${SPALTEN} from rechnungen r where r.id = $1`, [abschlag_von]);
    const a = zeile(rows[0]);
    if (!a) return { ok: false, grund: "kein-auftrag" };
    // Dieselbe Regel wie in abschlag(): Auftrag ist ein gestelltes/angenommenes
    // Angebot oder eine Rechnung im Entwurf. NICHT eine gestellte Rechnung —
    // die zaehlt schon als Umsatz.
    const erlaubt = (a.art === "angebot" && ["gestellt", "angenommen"].includes(a.status))
      || (a.art === "rechnung" && a.status === "entwurf");
    if (!erlaubt) return { ok: false, grund: "kein-auftrag" };
    const p = zuBetrag(d.abschlag_prozent);
    if (p === null || p <= 0 || p > 100) return { ok: false, grund: "prozent" };
    const { rows: geschwister } = await q(
      `select abschlag_nr, abschlag_prozent, status from rechnungen where abschlag_von = $1`, [abschlag_von]);
    const bisherProzent = rund(geschwister.filter((k) => k.status !== "storniert")
      .reduce((sum, k) => sum + (Number(k.abschlag_prozent) || 0), 0));
    if (bisherProzent + rund(p) > 100.01) return { ok: false, grund: "prozent" };
    abschlag_prozent = rund(p);
    abschlag_nr = geschwister.reduce((m, k) => Math.max(m, Number(k.abschlag_nr) || 0), 0) + 1;
    // Der Angebotsbezug haengt am Auftrag, nicht am Formular.
    angebot_id = a.art === "angebot" ? a.id : (a.angebot_id || null);
  }
  return { ok: true, firma_id, angebot_id, abschlag_von, abschlag_nr, abschlag_prozent };
}

async function anlegen(user, d) {
  const art = d.art === "angebot" ? "angebot" : "rechnung";
  const p = pruefen(d, art);
  if (!p.ok) return p;
  const w = p.werte;
  return alsNutzer(user.id, async (q) => {
    const bez = await bezuegePruefen(q, art, d);
    if (!bez.ok) return bez;
    const { rows } = await q(
      `insert into rechnungen (art, firma_id, empfaenger, datum, faellig, positionen, summe, titel, einleitung, schluss,
                               nutzen, status, vorlage, angebot_id, abschlag_von, abschlag_nr, abschlag_prozent, erstellt_von)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'entwurf',$12,$13,$14,$15,$16,$17) returning id`,
      [art, bez.firma_id, JSON.stringify(w.empfaenger), w.datum, w.faellig, JSON.stringify(w.positionen), w.summe,
       w.titel || null, w.einleitung || null, w.schluss || null, w.nutzen || null, w.vorlage,
       bez.angebot_id, bez.abschlag_von, bez.abschlag_nr, bez.abschlag_prozent, user.id]);
    return { ok: true, id: Number(rows[0].id) };
  });
}

async function aendern(user, id, d) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [alt] } = await q(`select art, status from rechnungen where id = $1`, [id]);
    if (!alt) return { ok: false, grund: "nicht-gefunden" };
    if (alt.status !== "entwurf") return { ok: false, grund: "nur-entwurf" };
    const p = pruefen(d, alt.art);
    if (!p.ok) return p;
    const w = p.werte;
    if (w.firma_id !== null) {
      const { rowCount: firmaDa } = await q(`select 1 from firmen where id = $1`, [w.firma_id]);
      if (!firmaDa) return { ok: false, grund: "firma" };
    }
    const { rowCount } = await q(
      `update rechnungen set firma_id=$2, empfaenger=$3, datum=$4, faellig=$5, positionen=$6, summe=$7, titel=$8,
              einleitung=$9, schluss=$10, nutzen=$11, vorlage=$12 where id=$1 and status='entwurf'`,
      [id, w.firma_id, JSON.stringify(w.empfaenger), w.datum, w.faellig, JSON.stringify(w.positionen), w.summe,
       w.titel || null, w.einleitung || null, w.schluss || null, w.nutzen || null, w.vorlage]);
    if (!rowCount) return { ok: false, grund: "nur-entwurf" };
    return { ok: true, id: Number(id) };
  });
}

// Nur Entwuerfe — sie haben keine Nummer verbraucht.
async function loeschen(user, id) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [alt] } = await q(`select status from rechnungen where id = $1`, [id]);
    if (!alt) return { ok: false, grund: "nicht-gefunden" };
    if (alt.status !== "entwurf") return { ok: false, grund: "nur-entwurf" };
    await q(`update rechnungen set abschlag_von = null where abschlag_von = $1`, [id]);
    await q(`update rechnungen set angebot_id = null where angebot_id = $1`, [id]);
    const { rowCount } = await q(`delete from rechnungen where id = $1 and status = 'entwurf'`, [id]);
    if (!rowCount) return { ok: false, grund: "nicht-gefunden" };
    return { ok: true };
  });
}

// Entwurf -> gestellt: Nummer ziehen, PDF bauen und einfrieren.
//
// ALLES IN EINER TRANSAKTION mit gesperrter Zeile (05.09.2026 gelernt). Vorher
// las die Funktion den Stand in einer eigenen Transaktion, zog DANN die Nummer
// und schrieb in einer zweiten — ohne rowCount zu pruefen. Zwei Klicks auf
// "Stellen" kurz hintereinander zogen zwei Nummern; die zweite fiel ins Leere
// (update ... where status='entwurf' traf nichts), meldete aber Erfolg. Ergebnis:
// eine Luecke im Nummernkreis, und den soll es nicht geben. Jetzt sperrt
// "select ... for update" die Rechnung, die zweite Anfrage wartet und sieht
// "schon-gestellt", bevor eine Nummer verbrannt ist.
//
// Ein Rechnungs-ENTWURF kann als Auftragsrahmen dienen, an dem Abschlaege
// haengen (siehe abschlag()). Wird er gestellt, ohne die schon gestellten
// Abschlaege abzuziehen, zaehlt derselbe Umsatz zweimal (Befund 2 des Pruefers:
// 2.000er Rahmen + 50 % Abschlag = 3.000 statt 2.000). Deshalb wandern
// gestellte/bezahlte Abschlaege hier als Abzugsposition ins Blatt — genau wie
// bei umwandeln() — und offene Abschlags-ENTWUERFE halten das Stellen an, weil
// sonst jemand sie hinterher vergisst.
async function stellen(user, id, { unterschrift = "" } = {}) {
  if (!/^\d+$/.test(String(id))) return { ok: false, grund: "nicht-gefunden" };
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select ${SPALTEN}, p.name as erstellt_von_name
         from rechnungen r left join profiles p on p.id = r.erstellt_von
        where r.id = $1 for update of r`, [id]);
    const r = zeile(rows[0]);
    if (!r) return { ok: false, grund: "nicht-gefunden" };
    if (r.status !== "entwurf") return { ok: false, grund: "schon-gestellt" };
    if (!r.empfaenger.name) return { ok: false, grund: "empfaenger" };
    if (!(r.summe > 0)) return { ok: false, grund: "summe" };

    // Abschlaege, die an diesem Entwurf haengen.
    let positionen = r.positionen, neueSumme = r.summe, mitAbzug = false;
    if (r.art === "rechnung") {
      const { rows: kinder } = await q(`select ${SPALTEN} from rechnungen r where r.abschlag_von = $1 order by r.abschlag_nr nulls last, r.id`, [id]);
      const abschlaege = kinder.map(zeile);
      if (abschlaege.some((k) => k.status === "entwurf")) return { ok: false, grund: "abschlag-entwurf" };
      const abzuege = abschlaege.filter((k) => ZAEHLT.includes(k.status));
      if (abzuege.length) {
        mitAbzug = true;
        positionen = r.positionen.concat(abzuege.map((k) => ({
          titel: `Abzüglich Abschlag ${k.abschlag_nr} (Rechnung ${k.nummer})`,
          beschreibung: `Bereits berechnet am ${datumDe(k.datum)}${k.status === "bezahlt" ? ", bezahlt" : ""}.`,
          menge: 1, einheit: "pauschal", einzelpreis: -k.summe,
        })));
        neueSumme = summe(positionen);
        if (!(neueSumme > 0)) return { ok: false, grund: "rest-null" };
        r.positionen = positionen;
        r.summe = neueSumme;
      }
    }

    const n = await nummern.naechste(r.art, `${r.art === "angebot" ? "Angebot" : "Rechnung"} ${r.empfaenger.name}`.slice(0, 200));
    if (!n.ok) return { ok: false, grund: "nummer", hint: n.hint };
    r.nummer = n.nummer;
    r.status = "gestellt";
    const datei = pdfBauen(r, absender(r.art), { unterschrift: unterschrift || r.erstellt_von_name || (user && user.name) || "" });
    const { rowCount } = await q(
      `update rechnungen set nummer=$2, status='gestellt', pdf=$3, pdf_pruefsumme=$4, positionen=$5, summe=$6
        where id=$1 and status='entwurf'`,
      [id, n.nummer, datei, archiv.pruefsumme(datei), JSON.stringify(positionen), neueSumme]);
    if (!rowCount) return { ok: false, grund: "schon-gestellt" };
    return { ok: true, nummer: n.nummer, id: Number(id), mitAbzug };
  });
}

// PDF holen: gestellte aus der Datenbank (eingefroren), Entwuerfe frisch.
async function pdfHolen(user, id, { unterschrift = "" } = {}) {
  const r = await eine(user, id);
  if (!r) return null;
  const name = `${r.nummer || `Entwurf-${r.id}`}_${String(r.empfaenger.name || "Kunde").replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, "_").slice(0, 40)}.pdf`;
  if (r.pdf_da && r.status !== "entwurf") {
    const daten = await alsNutzer(user.id, async (q) => (await q(`select pdf from rechnungen where id = $1`, [id])).rows[0].pdf);
    return { daten, name, eingefroren: true, pruefsumme: r.pdf_pruefsumme };
  }
  return { daten: pdfBauen(r, absender(r.art), { unterschrift: unterschrift || r.erstellt_von_name || "" }), name, eingefroren: false };
}

// Per Mail an den Empfaenger. Entwuerfe werden vorher gestellt. Der Riegel
// fuer Probelaeufe sitzt in gmail-direkt.senden (ADS_PROBE) — hier wird nur
// gemeldet, dass er zugeschlagen hat.
async function versenden(user, id, { an = "", unterschrift = "" } = {}) {
  const gmail = require("./gmail-direkt.js");
  const probemodus = require("./probemodus.js");
  let r = await eine(user, id);
  if (!r) return { ok: false, grund: "nicht-gefunden" };
  if (r.status === "storniert") return { ok: false, grund: "storniert" };
  const adresse = String(an || r.empfaenger.email || "").trim();
  if (!MAIL_MUSTER.test(adresse)) return { ok: false, grund: "mail" };
  // Mailzugang VOR dem Stellen pruefen (Befund 9): Sonst bekam der Entwurf eine
  // Nummer und ein eingefrorenes PDF, und danach hiess es "kein Mailzugang" —
  // die Rechnung galt als gestellt, war aber nie beim Kunden.
  if (!probemodus.aktiv() && !gmail.bereit()) return { ok: false, grund: "kein-mailzugang" };
  if (r.status === "entwurf") {
    const s = await stellen(user, id, { unterschrift });
    if (!s.ok) return s;
    r = await eine(user, id);
  }
  const datei = await pdfHolen(user, id, { unterschrift });
  const m = mailTexten(r, user);
  try {
    const erg = await gmail.senden({
      an: adresse, betreff: m.betreff, text: m.text, absender: absender(r.art).mailAbsender,
      anhaenge: [{ name: datei.name, typ: "application/pdf", daten: datei.daten }],
    });
    if (erg && erg.abgefangen) return { ok: true, abgefangen: true, an: adresse, nummer: r.nummer };
    await alsNutzer(user.id, (q) => q(`update rechnungen set versendet_am = now(), versendet_an = $2 where id = $1`, [id, adresse]));
    return { ok: true, an: adresse, nummer: r.nummer };
  } catch (e) {
    return { ok: false, grund: "versand", hint: String(e.message).slice(0, 140) };
  }
}

function kategorieFuer(r) {
  if (KATEGORIE_JE_VORLAGE[r.vorlage]) return KATEGORIE_JE_VORLAGE[r.vorlage];
  const tag = (r.firma_tags || []).find((t) => KATEGORIE_JE_TAG[t]);
  return tag ? KATEGORIE_JE_TAG[tag] : "Sonstiges";
}

// Zahlung eintragen: Buchung anlegen (eine je Zahlung), Zahlstand fortschreiben.
//
// LESEN UND SCHREIBEN IN EINER TRANSAKTION, mit gesperrter Zeile. Das war der
// schwerste Fehler des ersten Wurfs (Pruefer-Befund 1, 05.09.2026): Der Stand
// kam aus eine() in einer eigenen Transaktion, die laufende Nummer war
// zahlungen.length + 1, und geschrieben wurde in einer zweiten Transaktion.
// Zwei fast gleichzeitige Klicks auf "Zahlung buchen" lasen denselben Stand,
// bekamen verschiedene Schluessel ('rechnung-7-2' und 'rechnung-7-3'), und der
// Unique-Index buchungen_rechnung_einmalig konnte gar nicht greifen — es
// standen 700 Euro Einnahme in der Buchhaltung, wo 500 geflossen waren.
//
// Zwei Riegel jetzt:
//   1. select ... for update sperrt die Rechnung bis zum commit. Die zweite
//      Anfrage wartet, liest den FRISCHEN Stand und rechnet richtig weiter.
//   2. Ein Idempotenz-Token aus dem Formular (ein Blatt = ein Token). Kommt
//      dasselbe Token zweimal an — Doppelklick, F5, zurueck-und-nochmal —,
//      wird die Zahlung nicht erneut gebucht, sondern freundlich gemeldet.
// Der Unique-Index bleibt als dritter Riegel: Was diese beiden durchlassen,
// haelt die Datenbank.
async function bezahlt(user, id, { am = "", betrag = "", token = "" } = {}) {
  if (!/^\d+$/.test(String(id))) return { ok: false, grund: "nicht-gefunden" };
  const tok = String(token || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select ${SPALTEN}, f.name as firma_name, f.tags as firma_tags
         from rechnungen r left join firmen f on f.id = r.firma_id
        where r.id = $1 for update of r`, [id]);
    const r = zeile(rows[0]);
    if (!r) return { ok: false, grund: "nicht-gefunden" };
    if (r.art !== "rechnung") return { ok: false, grund: "kein-rechnung" };
    // Dasselbe Blatt zum zweiten Mal: nichts tun, aber Erfolg melden — sonst
    // erschrickt der Nutzer ueber eine Fehlermeldung fuer etwas, das geklappt hat.
    if (tok && r.zahlungen.some((z) => z && z.token === tok)) {
      return { ok: true, status: r.status, betrag: 0, schon: true };
    }
    if (!["gestellt", "teilbezahlt"].includes(r.status)) return { ok: false, grund: "status" };
    const tag = tagFeld(am) || heute();
    const rest = rund(r.summe - r.bezahlt_betrag);
    const b = betrag === "" || betrag === null || betrag === undefined ? rest : zuBetrag(betrag);
    if (b === null || b <= 0) return { ok: false, grund: "betrag" };
    if (b > rest + 0.005) return { ok: false, grund: "zuviel" };
    const n = r.zahlungen.length + 1;
    const neu = rund(r.bezahlt_betrag + b);
    const voll = neu >= r.summe - 0.005;
    const notiz = `${r.abschlag_von ? "Abschlagsrechnung" : "Rechnung"} ${r.nummer}${r.titel ? " – " + r.titel : ""}` +
      (voll && n === 1 ? "" : ` (Zahlung ${n})`);
    let buchung;
    try {
      ({ rows: [buchung] } = await q(
        `insert into buchungen (art, datum, betrag, kategorie, gegenstelle, notiz, firma_id, bezahlt, bezahlt_am,
                                erfasst_von, quelle, quelle_schluessel)
         values ('einnahme',$1,$2,$3,$4,$5,$6,true,$7,$8,'rechnung',$9) returning id`,
        [r.datum, b, kategorieFuer(r), r.empfaenger.name || r.firma_name || null, notiz, r.firma_id, tag, user.id,
         `rechnung-${r.id}-${n}`]));
    } catch (e) {
      if (/buchungen_rechnung_einmalig/.test(String(e.message))) return { ok: false, grund: "doppelt" };
      throw e;
    }
    const { rowCount } = await q(
      `update rechnungen set bezahlt_betrag = $2, zahlungen = zahlungen || $3::jsonb, status = $4, bezahlt_am = $5, buchung_id = $6
        where id = $1 and status in ('gestellt','teilbezahlt')`,
      [id, neu, JSON.stringify([{ am: tag, betrag: b, buchung_id: buchung.id, token: tok || null }]),
       voll ? "bezahlt" : "teilbezahlt", tag, buchung.id]);
    // Unter der Sperre kann das nicht passieren. Wenn doch, ist die Buchung
    // ohne Rechnung entstanden — dann lieber alles zurueckrollen (der Fehler
    // fliegt durch alsNutzer und loest dort das rollback aus) als eine
    // Einnahme stehen lassen, die zu keiner Rechnung gehoert.
    if (!rowCount) throw new Error("Zahlung: Rechnung hat den Status waehrend der Buchung gewechselt");
    return { ok: true, status: voll ? "bezahlt" : "teilbezahlt", betrag: b, buchung_id: buchung.id };
  });
}

// Abschlagsrechnung auf einen Auftrag anlegen (als Entwurf).
async function abschlag(user, id, { prozent = "", betrag = "" } = {}) {
  const a = await eine(user, id);
  if (!a) return { ok: false, grund: "nicht-gefunden" };
  const erlaubt = (a.art === "angebot" && ["gestellt", "angenommen"].includes(a.status))
    || (a.art === "rechnung" && a.status === "entwurf");
  if (!erlaubt) return { ok: false, grund: "kein-auftrag" };
  const ab = abschlagBetrag(a.summe, { prozent, betrag });
  if (!ab) return { ok: false, grund: "betrag" };
  const bisher = a.abschlaege.filter((k) => k.status !== "storniert");
  const bisherProzent = rund(bisher.reduce((s, k) => s + (Number(k.abschlag_prozent) || 0), 0));
  if (bisherProzent + ab.prozent > 100.01) return { ok: false, grund: "prozent" };
  const nr = (a.abschlaege.reduce((m, k) => Math.max(m, Number(k.abschlag_nr) || 0), 0)) + 1;
  const bezug = a.nummer ? `${a.art === "angebot" ? "Angebot" : "Auftrag"} ${a.nummer}` : "den Auftrag";
  const prozentText = String(ab.prozent).replace(".", ",");
  const datum = heute();
  const werte = {
    art: "rechnung", firma_id: a.firma_id, empfaenger: a.empfaenger, datum, faellig: frist("rechnung", datum),
    vorlage: a.vorlage, titel: a.titel,
    positionen: [{
      titel: `Abschlag ${nr} (${prozentText} %) auf ${bezug}${a.titel ? " – " + a.titel : ""}`,
      beschreibung: `Abschlagszahlung auf den Gesamtauftrag über ${euro(a.summe)}` +
        (bisher.length ? ` (bisher berechnet: ${bisher.map((k) => `Abschlag ${k.abschlag_nr} ${k.nummer || "Entwurf"}`).join(", ")}).` : "."),
      menge: 1, einheit: "pauschal", einzelpreis: ab.betrag,
    }],
    einleitung: `wie vereinbart stellen wir Ihnen den ${nr}. Abschlag auf ${bezug} in Rechnung:`,
    schluss: SCHLUSS.rechnung,
    angebot_id: a.art === "angebot" ? a.id : (a.angebot_id || null),
    abschlag_von: a.id, abschlag_nr: nr, abschlag_prozent: ab.prozent,
  };
  const erg = await anlegen(user, werte);
  return erg.ok ? { ok: true, id: erg.id, nr, betrag: ab.betrag, prozent: ab.prozent } : erg;
}

// Angebot -> Rechnung (Entwurf). Hat das Angebot Abschlaege, werden die
// gestellten als Abzug aufgefuehrt — die Rechnung ist dann die Schlussrechnung.
async function umwandeln(user, id) {
  const a = await eine(user, id);
  if (!a) return { ok: false, grund: "nicht-gefunden" };
  if (a.art !== "angebot") return { ok: false, grund: "kein-angebot" };
  if (!["gestellt", "angenommen"].includes(a.status)) return { ok: false, grund: "status" };
  // Ein noch nicht gestellter Abschlag taucht in keiner Abzugsposition auf
  // (nur ZAEHLT-Status zaehlt). Wer ihn spaeter doch stellt, berechnet den
  // Betrag zweimal — deshalb erst den Entwurf klaeren (Befund 14).
  if (a.abschlaege.some((k) => k.status === "entwurf")) return { ok: false, grund: "abschlag-entwurf" };
  const t = texte(a.vorlage, "rechnung");
  const positionen = a.positionen.map((p) => ({ ...p }));
  const abzuege = a.abschlaege.filter((k) => ZAEHLT.includes(k.status));
  for (const k of abzuege) {
    positionen.push({
      titel: `Abzüglich Abschlag ${k.abschlag_nr} (Rechnung ${k.nummer})`,
      beschreibung: `Bereits berechnet am ${datumDe(k.datum)}${k.status === "bezahlt" ? ", bezahlt" : ""}.`,
      menge: 1, einheit: "pauschal", einzelpreis: -k.summe,
    });
  }
  const datum = heute();
  const erg = await anlegen(user, {
    art: "rechnung", firma_id: a.firma_id, empfaenger: a.empfaenger, datum, faellig: frist("rechnung", datum),
    vorlage: a.vorlage, titel: a.titel, positionen,
    einleitung: abzuege.length ? `wie vereinbart stellen wir Ihnen die Schlussrechnung zu Angebot ${a.nummer}:` : t.einleitung,
    schluss: t.schluss, angebot_id: a.id,
  });
  if (!erg.ok) return erg;
  if (a.status === "gestellt") {
    await alsNutzer(user.id, (q) => q(`update rechnungen set status = 'angenommen' where id = $1 and status = 'gestellt'`, [id]));
  }
  return { ok: true, id: erg.id };
}

// Angebot: angenommen / abgelehnt.
async function statusSetzen(user, id, status) {
  if (!["angenommen", "abgelehnt"].includes(status)) return { ok: false, grund: "status" };
  return alsNutzer(user.id, async (q) => {
    const { rows: [alt] } = await q(`select art, status from rechnungen where id = $1`, [id]);
    if (!alt) return { ok: false, grund: "nicht-gefunden" };
    if (alt.art !== "angebot") return { ok: false, grund: "kein-angebot" };
    if (!uebergangErlaubt("angebot", alt.status, status)) return { ok: false, grund: "status" };
    const { rowCount } = await q(`update rechnungen set status = $2 where id = $1 and status = $3`, [id, status, alt.status]);
    if (!rowCount) return { ok: false, grund: "nicht-gefunden" };
    return { ok: true };
  });
}

// Stornieren — nur mit Grund. Die Nummer bleibt vergeben, Zahlungen bleiben
// gebucht (das Geld ist geflossen; eine Rueckzahlung ist eine eigene Ausgabe).
async function stornieren(user, id, grund) {
  const g = String(grund || "").trim().slice(0, 500);
  if (!g) return { ok: false, grund: "grund" };
  return alsNutzer(user.id, async (q) => {
    const { rows: [alt] } = await q(`select art, status, bezahlt_betrag from rechnungen where id = $1 for update`, [id]);
    if (!alt) return { ok: false, grund: "nicht-gefunden" };
    if (alt.status === "entwurf") return { ok: false, grund: "entwurf-loeschen" };
    // Eine bezahlte Rechnung stornieren hiess bisher: die Einnahmen bleiben in
    // der Buchhaltung stehen, aber umsatzFest zaehlt sie nicht mehr mit — die
    // Buchhaltung und die Kacheln sagten Verschiedenes (Befund 15). Geld, das
    // geflossen ist, verschwindet nicht durch ein Storno; die Rueckzahlung ist
    // eine eigene Ausgabe.
    if (Number(alt.bezahlt_betrag) > 0) return { ok: false, grund: "storno-bezahlt" };
    if (!uebergangErlaubt(alt.art, alt.status, "storniert")) return { ok: false, grund: "status" };
    const { rowCount } = await q(
      `update rechnungen set status = 'storniert', storno_grund = $2 where id = $1 and status = $3`, [id, g, alt.status]);
    if (!rowCount) return { ok: false, grund: "nicht-gefunden" };
    return { ok: true };
  });
}

// Kopie als neuer Entwurf — ohne Nummer, ohne Abschlag-/Angebotsbezug.
async function duplizieren(user, id) {
  const a = await eine(user, id);
  if (!a) return { ok: false, grund: "nicht-gefunden" };
  const datum = heute();
  return anlegen(user, {
    art: a.art, firma_id: a.firma_id, empfaenger: a.empfaenger, datum, faellig: frist(a.art, datum),
    vorlage: a.vorlage, titel: a.titel, positionen: a.positionen, einleitung: a.einleitung, schluss: a.schluss,
    nutzen: a.nutzen,
  });
}

// ------------------------------------------------------------------ Exporte (Vertrag)
//
// Fuer Kundenakte (Agent A) und Kosten-Seite (Agent D2). Laufen mit RLS im
// Namen des Nutzers: Ein Mitarbeiter bekommt nur, was zu seinen Firmen gehoert.
// Werfen nie — fehlt die Tabelle (Migration 0060 noch nicht eingespielt),
// kommen Nullen und leere Listen zurueck.
const NULL_FIRMA = () => ({ gestellt: 0, bezahlt: 0, offen: 0, anzahl: 0, prozent_bezahlt: 0, liste: [], auftraege: [] });
const NULL_UMSATZ = () => ({ gestellt: 0, bezahlt: 0, offen: 0, anzahl: 0 });

function URL_NEU(firmaId, art = "rechnung") {
  const a = art === "angebot" ? "angebot" : "rechnung";
  return `/buchhaltung/rechnungen/neu?art=${a}${firmaId ? `&firma=${encodeURIComponent(firmaId)}` : ""}`;
}

const kurz = (r) => ({
  id: r.id, nummer: r.nummer, art: r.art, datum: r.datum, faellig: r.faellig, betrag: r.summe,
  bezahlt_betrag: r.bezahlt_betrag, offen: r.offen, status: r.status, status_text: r.status_text,
  status_farbe: r.status_farbe, abschlag_nr: r.abschlag_nr, abschlag_von: r.abschlag_von,
  abschlag_prozent: r.abschlag_prozent, angebot_id: r.angebot_id, titel: r.titel,
  bezahlt_am: r.bezahlt_am, prozent_bezahlt: r.prozent_bezahlt, ueberfaellig_tage: r.ueberfaellig_tage,
  url: r.url, pdf_url: r.url + ".pdf",
});

// Zahlstand einer Firma: Summen ueber gestellte Rechnungen (ohne Entwuerfe,
// ohne stornierte), Liste mit Rechnungen UND Angeboten (art unterscheidet),
// plus je Auftrag (Angebot mit Abschlaegen/Rechnungen) der Anteil "x % bezahlt".
async function rechnungenJeFirma(user, firmaId) {
  if (!user || !/^\d+$/.test(String(firmaId))) return NULL_FIRMA();
  try {
    return await alsNutzer(user.id, async (q) => {
      const { rows } = await q(
        `select ${SPALTEN} from rechnungen r where r.firma_id = $1 and r.status not in ('entwurf','storniert')
          order by r.datum desc, r.id desc`, [firmaId]);
      const alle = rows.map(zeile);
      const rechnungen = alle.filter((r) => r.art === "rechnung" && ZAEHLT.includes(r.status));
      const gestellt = rund(rechnungen.reduce((s, r) => s + r.summe, 0));
      const bezahlt = rund(rechnungen.reduce((s, r) => s + r.bezahlt_betrag, 0));
      const auftraege = alle.filter((r) => r.art === "angebot").map((a) => {
        const kinder = rechnungen.filter((r) => r.abschlag_von === a.id || r.angebot_id === a.id);
        const kGestellt = rund(kinder.reduce((s, r) => s + r.summe, 0));
        const kBezahlt = rund(kinder.reduce((s, r) => s + r.bezahlt_betrag, 0));
        return {
          ...kurz(a), gestellt: kGestellt, bezahlt: kBezahlt, offen: rund(kGestellt - kBezahlt),
          prozent_bezahlt: a.summe > 0 ? Math.min(100, Math.round(kBezahlt / a.summe * 100)) : 0,
          abschlaege: kinder.filter((r) => r.abschlag_von === a.id).map(kurz),
        };
      });
      return {
        gestellt, bezahlt, offen: rund(gestellt - bezahlt), anzahl: rechnungen.length,
        prozent_bezahlt: gestellt > 0 ? Math.min(100, Math.round(bezahlt / gestellt * 100)) : 0,
        liste: alle.map(kurz), auftraege,
      };
    });
  } catch { return NULL_FIRMA(); }
}

// Fester Umsatz: gestellte Rechnungen (keine Angebote, keine stornierten),
// wahlweise auf ein Rechnungsdatum-Fenster eingegrenzt.
async function umsatzFest(user, { von, bis } = {}) {
  if (!user) return NULL_UMSATZ();
  try {
    return await alsNutzer(user.id, async (q) => {
      const w = [`art = 'rechnung'`, `status in ('gestellt','teilbezahlt','bezahlt')`], a = [];
      if (tagFeld(von)) { a.push(tagFeld(von)); w.push(`datum >= $${a.length}`); }
      if (tagFeld(bis)) { a.push(tagFeld(bis)); w.push(`datum <= $${a.length}`); }
      const { rows: [k] } = await q(
        `select coalesce(sum(summe),0) as gestellt, coalesce(sum(bezahlt_betrag),0) as bezahlt, count(*) as anzahl
           from rechnungen where ${w.join(" and ")}`, a);
      const gestellt = rund(k.gestellt), bezahlt = rund(k.bezahlt);
      return { gestellt, bezahlt, offen: rund(gestellt - bezahlt), anzahl: Number(k.anzahl) };
    });
  } catch { return NULL_UMSATZ(); }
}

// Offene Kundenrechnungen (gestellt oder teilbezahlt), nach Faelligkeit.
async function offeneRechnungen(user) {
  if (!user) return [];
  try {
    return await alsNutzer(user.id, async (q) => {
      const { rows } = await q(
        `select ${SPALTEN}, f.name as firma_name from rechnungen r left join firmen f on f.id = r.firma_id
          where r.art = 'rechnung' and r.status in ('gestellt','teilbezahlt')
          order by r.faellig nulls last, r.id`);
      return rows.map(zeile).map((r) => ({
        ...kurz(r), firma_id: r.firma_id, firma_name: r.firma_name || r.empfaenger.name || "",
        empfaenger_name: r.empfaenger.name || "",
      }));
    });
  } catch { return []; }
}

module.exports = {
  // Konstanten und reine Funktionen (testbar ohne Datenbank)
  VORLAGEN, SCHLUSS, PARAGRAF19, EINHEITEN, FRIST_TAGE, STATUS_TEXT, STATUS_FARBE, UEBERGAENGE, ZAEHLT,
  KATEGORIE_JE_VORLAGE, texte, uebergangErlaubt, zuBetrag, positionenSaeubern, positionSumme, summe,
  abschlagBetrag, nummerGueltig, frist, tageSpaeter, tagFeld, heute, datumDe, datumLang, euro,
  empfaengerAusFirma, empfaengerSaeubern, absender, mailTexten, pdfBauen, kategorieFuer, nutzenListe,
  anredeZeile, pruefen, BETRAG_MAX,
  // Datenzugriff
  kacheln, liste, eine, anlegen, aendern, loeschen, stellen, pdfHolen, versenden, bezahlt, abschlag,
  umwandeln, statusSetzen, stornieren, duplizieren,
  // Vertrag mit Kundenakte (A) und Kosten-Seite (D2)
  rechnungenJeFirma, umsatzFest, offeneRechnungen, URL_NEU,
};
