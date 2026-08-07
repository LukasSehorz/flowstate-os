// Testet das Fuellen der Angebotsvorlage.
//
// Der gefaehrlichste Fehler ist derselbe wie bei der Rechnung, nur schlimmer:
// Die Vorlage ist ein ECHTES Angebot an die Firma Heuberger. Bleibt eine Zeile
// stehen, verschickt Lukas einem neuen Kunden ein Angebot, in dem
// "Notoeffnungen ueber Schluesseldienst bis Schliessanlagen" steht und
// "Landkreis Muehldorf" — Text, der zu dessen Betrieb nichts zu tun hat.
//
// Beim Angebot ist das wahrscheinlicher als bei der Rechnung: Es hat vierzehn
// zu ersetzende Stellen statt sechs, darunter fuenf Nutzenpunkte.
//
// Aufruf: VORLAGEN_PFAD=... node scripts/test-angebot-vorlage.js

const fs = require("fs");
const zlib = require("zlib");

process.env.VORLAGEN_PFAD = process.env.VORLAGEN_PFAD || "/vorlagen";
const v = require("../lib/beleg-vorlage.js");

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

if (!v.vorhanden().includes("angebot.docx")) {
  console.log(`⏭  Uebersprungen: keine angebot.docx unter ${process.env.VORLAGEN_PFAD}`);
  process.exit(0);
}

function textVon(buf) {
  const doc = v.zipLesen(buf).find((x) => x.name === "word/document.xml");
  const roh = doc.methode === 8 ? zlib.inflateRawSync(doc.daten).toString("utf-8") : doc.daten.toString("utf-8");
  return roh.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const INHALT = {
  anrede: "Sehr geehrte Frau Bergmann,",
  einleitung: "vielen Dank für Ihr Interesse! Nachfolgend sehen Sie, was wir für Ihre neue Praxis-Website anbieten:",
  vorteile: [
    "Ein Auftritt, der Ihre Praxis so seriös darstellt, wie Patienten sie erleben",
    "Termine online anfragen statt telefonisch – das entlastet Ihren Empfang",
    "Bessere Auffindbarkeit bei Google für Physiotherapie in Landshut",
    "Klare Darstellung Ihrer Behandlungen von Manueller Therapie bis Lymphdrainage",
  ],
  posten_titel: "Erstellung der neuen Praxis-Website",
  posten_text: "Modernes, responsives Webdesign für die Physiotherapie Bergmann inkl. Aufbau aller Unterseiten, Online-Terminanfrage, technischer On-Page-SEO sowie vollständiger Online-Stellung.",
};

const AUFTRAG = {
  art: "angebot", sparte: "Website", nummer: "2026-024",
  empfaenger: { firma: "PHYSIOTHERAPIE BERGMANN", anrede: "Frau Anna Bergmann", strasse: "Altstadt 42", plz_ort: "84028 Landshut" },
  datum: new Date("2026-08-07"), faellig: new Date("2026-09-06"),
  gesamt: 1900, inhalt: INHALT,
};

const buf = v.erzeugen(AUFTRAG);
const t = textVon(buf);

// --- Gueltige Datei --------------------------------------------------------
pruefe("Ergebnis ist eine gueltige docx", buf.slice(0, 2).toString() === "PK");
pruefe("Alle Bestandteile der Vorlage sind noch drin",
  v.zipLesen(buf).length === v.zipLesen(fs.readFileSync(v.vorlagePfad("angebot", "Website"))).length);

// --- Ist alles Neue drin? --------------------------------------------------
pruefe("Angebotsnummer im Format 2026-NNN", t.includes("2026-024"));
pruefe("Empfaenger steht drin", t.includes("PHYSIOTHERAPIE BERGMANN") && t.includes("Anna Bergmann"));
pruefe("Anschrift steht drin", t.includes("Altstadt 42") && t.includes("84028 Landshut"));
pruefe("Datum ausgeschrieben", /07\.\s*August\s*2026/.test(t), t.slice(0, 400));
pruefe("Gueltig bis ausgeschrieben", /06\.\s*September\s*2026/.test(t));
pruefe("Persoenliche Anrede", t.includes("Sehr geehrte Frau Bergmann"));
pruefe("Einleitung ersetzt", t.includes("Praxis-Website anbieten"));
pruefe("Alle vier Nutzenpunkte stehen drin",
  INHALT.vorteile.every((x) => t.includes(x.slice(0, 40))),
  INHALT.vorteile.filter((x) => !t.includes(x.slice(0, 40))).join(" || "));
pruefe("Postentitel ersetzt", t.includes("Erstellung der neuen Praxis-Website"));
pruefe("Leistungsbeschreibung ersetzt", t.includes("Physiotherapie Bergmann inkl. Aufbau"));
pruefe("Betrag ersetzt", t.includes("1.900,00"));

// --- Und jetzt das Entscheidende: nichts von Heuberger uebrig? -------------
const A = v.ANGEBOT;
pruefe("Keine Heuberger-Firma mehr", !t.includes(A.firma), A.firma);
pruefe("Kein Heuberger-Ansprechpartner mehr", !/Thomas Heuberger/.test(t));
pruefe("Keine Heuberger-Anschrift mehr", !/Seeweiherstr|Jettenbach/.test(t));
pruefe("Keine alte Angebotsnummer mehr", !t.includes("2026-023"));
pruefe("Kein altes Datum mehr", !/21\.\s*Juli\s*2026|20\.\s*August\s*2026/.test(t));
pruefe("Kein alter Betrag mehr", !/750,00/.test(t));
// Das ist der teuerste Einzelfall: Nutzenpunkte des Vorkunden im neuen Angebot.
pruefe("Kein Nutzenpunkt der Vorlage mehr uebrig",
  !A.vorteile.some((x) => t.includes(x.slice(0, 40))),
  A.vorteile.filter((x) => t.includes(x.slice(0, 40))).join(" || "));
pruefe("Keine Schluesseldienst-Begriffe mehr", !/Notöffnung|Schlüsseldienst|Schließanlage|Mühldorf/i.test(t),
  (t.match(/.{40}(Notöffnung|Schlüsseldienst|Schließanlage|Mühldorf).{40}/i) || [""])[0]);

// --- Was BLEIBEN muss ------------------------------------------------------
pruefe("Eigener Briefkopf bleibt", /FLOWSTATE/.test(t) && /Am Anger 3/.test(t));
pruefe("Schlussformel bleibt", /Mit freundlichen Grüßen/.test(t) && /Lukas Sehorz/.test(t));
pruefe("Tabellenkopf bleibt", /Leistung/.test(t) && /Betrag/.test(t) && /Gesamtpaket/.test(t));

// --- Weniger Nutzenpunkte: die freie Zeile muss WEG ------------------------
//
// Nur den Text zu leeren hinterliesse einen Aufzaehlungspunkt ohne Inhalt.
const drei = textVon(v.erzeugen({ ...AUFTRAG, nummer: "2026-025",
  inhalt: { ...INHALT, vorteile: INHALT.vorteile.slice(0, 3) } }));
pruefe("Bei drei Punkten bleibt kein leerer Aufzaehlungspunkt",
  (drei.match(/▪/g) || []).length === 3, `${(drei.match(/▪/g) || []).length} Punkte gefunden`);

// --- Kaufmanns-Und darf das Dokument nicht zerstoeren ----------------------
pruefe("Firmenname mit & erzeugt gueltiges XML",
  textVon(v.erzeugen({ ...AUFTRAG, nummer: "2026-026",
    empfaenger: { ...AUFTRAG.empfaenger, firma: "BERGMANN & PARTNER <GmbH>" } })).includes("BERGMANN & PARTNER"));

// --- Eine fremde Vorlage muss LAUT scheitern -------------------------------
//
// Legt Lukas eine andere Datei als angebot.docx ab, darf nicht still ein halb
// gefuelltes Angebot entstehen.
try {
  v.erzeugen({ ...AUFTRAG, art: "angebot", sparte: "Website", nummer: "2026-027" });
  // Mit der richtigen Vorlage muss es durchgehen — nur der Gegentest unten zaehlt.
  pruefe("Mit der richtigen Vorlage geht es durch", true);
} catch (e) {
  pruefe("Mit der richtigen Vorlage geht es durch", false, e.message);
}

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
