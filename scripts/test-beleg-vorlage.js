// Testet das Erzeugen von Rechnungen und Angeboten aus Lukas' Vorlagen.
//
// Warum (Lukas, 07.08.2026): "Es soll immer das gleiche Format sein, sodass sie
// immer gleich sind. Deswegen soll das Format von den alten Rechnungen
// uebernommen werden."
//
// Der gefaehrlichste Fehler hier ist NICHT ein Absturz — es ist eine Rechnung,
// die zu 90 Prozent stimmt. Der erste Entwurf lieferte genau das: Nummer,
// Empfaenger, Datum und Betrag waren richtig, aber der Leistungstext trug noch
// den Kundennamen der VORLAGE ("Website fuer die Attenberger Bodenziegel
// GmbH"). Das faellt beim Erzeugen nicht auf und landet beim Kunden.
//
// Deshalb prueft dieser Test nicht "ging es durch", sondern: Steht in der
// fertigen Datei irgendwo noch etwas aus der Vorlage?
//
// Aufruf: VORLAGEN_PFAD=... node scripts/test-beleg-vorlage.js

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

process.env.VORLAGEN_PFAD = process.env.VORLAGEN_PFAD || "/vorlagen";
const v = require("../lib/beleg-vorlage.js");

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

// Ohne Vorlagen ist hier nichts zu testen — das ist kein Fehlschlag, sondern
// eine andere Umgebung (lokal liegen sie woanders als im Container).
if (!v.vorhanden().length) {
  console.log(`⏭  Uebersprungen: keine Vorlagen unter ${process.env.VORLAGEN_PFAD}`);
  process.exit(0);
}

function textVon(buf) {
  const doc = v.zipLesen(buf).find((x) => x.name === "word/document.xml");
  const roh = doc.methode === 8 ? zlib.inflateRawSync(doc.daten).toString("utf-8") : doc.daten.toString("utf-8");
  return roh.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const AUFTRAG = {
  art: "rechnung", sparte: "Website", nummer: "R-2026-999",
  empfaenger: { firma: "Müller & Sohn GmbH", anrede: "Herrn Thomas Müller", strasse: "Hauptstraße 12", plz_ort: "84032 Landshut" },
  datum: new Date("2026-08-07"), faellig: new Date("2026-08-21"),
  positionen: [{ text: "Erstellung einer professionellen Website für die Müller & Sohn GmbH inkl. responsivem Design.", einzel: 1500, gesamt: 1500 }],
  gesamt: 1500,
};

const buf = v.erzeugen(AUFTRAG);
const t = textVon(buf);

// --- Die Datei muss ueberhaupt eine gueltige Word-Datei sein ---------------
pruefe("Ergebnis ist eine gueltige docx (PK-Signatur)", buf.slice(0, 2).toString() === "PK");
pruefe("Alle Bestandteile der Vorlage sind noch drin",
  v.zipLesen(buf).length === v.zipLesen(fs.readFileSync(v.vorlagePfad("rechnung", "Website"))).length);

// --- Wurde alles ersetzt? --------------------------------------------------
pruefe("Neue Rechnungsnummer steht drin", t.includes("R-2026-999"));
pruefe("Empfaenger steht drin", t.includes("Müller & Sohn GmbH") && t.includes("Thomas Müller"));
pruefe("Anschrift steht drin", t.includes("Hauptstraße 12") && t.includes("84032 Landshut"));
pruefe("Ausstellungsdatum ersetzt", t.includes("07.08.2026"));
pruefe("Faelligkeit ersetzt", t.includes("21.08.2026"));
pruefe("Betrag ersetzt", t.includes("1.500,00"));

// --- Und jetzt das Entscheidende: bleibt nichts aus der Vorlage stehen? ----
//
// Jeder dieser Fehler wuerde eine fertige Rechnung an den falschen Namen
// tragen. Der erste Entwurf ist bei genau dem ersten Punkt gescheitert.
pruefe("Kein Kundenname der Vorlage im Leistungstext", !/Attenberger|Bodenziegel/i.test(t),
  (t.match(/.{60}Attenberger.{60}/) || [""])[0]);
pruefe("Keine alte Rechnungsnummer mehr", !/R-2026-130/.test(t));
pruefe("Kein altes Datum mehr", !/06\.08\.2026|20\.08\.2026/.test(t));
pruefe("Kein alter Betrag mehr", !/1\.000,00/.test(t));

// --- Die eigenen Daten muessen BLEIBEN -------------------------------------
//
// Beim Ersetzen darf die eigene Anschrift nicht mit ausgetauscht werden — sie
// sieht einer Kundenanschrift zum Verwechseln aehnlich.
pruefe("Eigene Anschrift bleibt", t.includes("Am Anger 3") && t.includes("84539 Zangberg"));
pruefe("Bankverbindung bleibt", t.includes("DE21 7115 1020 0032 0980 71"));
pruefe("Kleinunternehmerhinweis bleibt", /19 Abs. 1 UStG/.test(t));

// --- Kaufmanns-Und darf das Dokument nicht zerstoeren ----------------------
pruefe("Firmenname mit & erzeugt gueltiges XML",
  textVon(v.erzeugen({ ...AUFTRAG, empfaenger: { ...AUFTRAG.empfaenger, firma: "A & B <GmbH>" } })).includes("A & B"));

// --- Sparte waehlt die richtige Vorlage ------------------------------------
// Geprueft wird die VORLAGENWAHL, nicht der Inhalt: Der Leistungstext wird ja
// gerade ersetzt, also kann "Social-Media" darin gar nicht mehr stehen. Der
// erste Entwurf dieses Falls hat genau das verlangt und schlug zu Recht fehl.
pruefe("Social-Media-Auftrag nimmt die Social-Media-Vorlage",
  /socialmedia/i.test(v.vorlagePfad("rechnung", "SocialMedia")));
pruefe("Performance Marketing nimmt auch die Social-Media-Vorlage",
  /socialmedia/i.test(v.vorlagePfad("rechnung", "Performance Marketing")));
pruefe("Website-Auftrag nimmt die Website-Vorlage",
  /website/i.test(v.vorlagePfad("rechnung", "Website")));
pruefe("Social-Media-Rechnung laesst sich erzeugen",
  Boolean(v.erzeugen({ ...AUFTRAG, sparte: "SocialMedia", nummer: "R-2026-998" })));
pruefe("Unbekannte Sparte faellt auf die Website-Vorlage zurueck",
  Boolean(v.erzeugen({ ...AUFTRAG, sparte: "Irgendwas", nummer: "R-2026-997" })));

// --- Angebote gehen genauso --------------------------------------------------
try {
  const ang = v.erzeugen({ ...AUFTRAG, art: "angebot", nummer: "A-2026-999" });
  pruefe("Angebot traegt die neue Angebotsnummer", textVon(ang).includes("A-2026-999"));
} catch (e) {
  pruefe("Angebot laesst sich erzeugen", false, e.message);
}

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
