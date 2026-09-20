// Beleg-Diktat — aus einem Satz wird ein Angebot oder eine Rechnung.
//
// Warum (Lukas, 05.09.2026): "Angebote und Rechnungen sollen so gedacht sein,
// wie wenn ich mit Claude Code arbeite: Ich nenne einfach kurz ein paar Fakten,
// schreibe die irgendwo rein, und dann wird es automatisch erstellt — mit Hilfe
// einer KI im Hintergrund. Die Rechnung will ich nicht selber erstellen, ich
// will nur in einem Textfeld Zahlen, Datum und Fakten eingeben."
//
// Also: EIN Textfeld statt eines Formulars mit siebzehn Feldern. Das Formular
// aus lib/rechnungen-routes.js bleibt — es ist der Weg fuer den Fall, dass man
// eine Position einzeln nachbessern will. Dieses Modul ist der Weg davor.
//
// WAS HIER NICHT PASSIERT: speichern. verstehen() liefert einen VORSCHLAG,
// nichts weiter. Erst entwurfAnlegen() schreibt eine Zeile, und das ruft die
// Oberflaeche erst nach dem Blick auf die Vorschau. Grund: Das Modell liest
// einen Satz, der beim Diktieren entstanden ist — "Abschlag 50" kann 50 Prozent
// oder 50 Euro heissen, und wer das falsch speichert, hat eine Rechnung mit
// einer Nummer, die beim Kunden liegt. Ein Zwischenschritt kostet zwei
// Sekunden, ein falscher Beleg kostet einen Anruf.
//
// GELD ENTSCHEIDET DAS MODELL NIE ALLEIN (Regel aus lib/belegleser.js, hier
// verschaerft): saeubern() prueft jede Zahl gegen die Wirklichkeit, und wenn
// die Summe der Positionen nicht zu einem genannten Gesamtbetrag passt, steht
// das als Warnung ueber der Vorschau. Nicht korrigiert — gezeigt. Wer eine
// Zahl still zurechtbiegt, nimmt dem Menschen die Chance, den Diktierfehler zu
// sehen.
//
// OHNE MODELLZUGANG (lokal, ohne SCHNELL_API_KEY): bereit() gibt false, und der
// Aufrufer bekommt aus verstehen() einen leeren Entwurf, in dem der diktierte
// Text als Notiz steht. Nichts scheitert hart — die Seite bleibt bedienbar,
// nur das Verstehen faellt aus.

const schnell = require("./schnell.js");
const rg = require("./rechnungen.js");
const crm = require("./crm.js");

// Sonnet, nicht Haiku: Aus "Abschlag 50 % vom Gesamtbetrag 2.500" die richtige
// Position mit 1.250 € zu bauen, ist eine Rechen- und Verstehensaufgabe, keine
// Abschreibaufgabe. Haiku 4.5 hat im Vorlauf zweimal den Gesamtbetrag als
// Rechnungsbetrag eingesetzt.
const MODELL = process.env.DIKTAT_MODELL || "claude-sonnet-5";

// Wie viel Diktat angenommen wird. Alles darueber ist kein Beleg mehr, sondern
// ein Brief — und wuerde den Aufruf nur langsam machen.
const MAX_DIKTAT = 4000;

// Grenzen fuer die Nachpruefung. Der Betrag stammt aus numeric(12,2) in 0060 —
// mehr passt schlicht nicht in die Spalte, und ein Beleg ueber zehn Millionen
// ist in diesem Haus ein Tippfehler.
const MAX_BETRAG = 9999999.99;
const MIN_JAHR = 2020;

const VORLAGEN = ["website", "ki", "performance", "frei"];
const ARTEN = ["angebot", "rechnung"];
const SICHERHEIT = ["hoch", "mittel", "niedrig"];

const rund = (n) => Math.round((Number(n) || 0) * 100) / 100;
const s = (x, max) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const mehrzeilig = (x, max) => String(x ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);

// Ist ein Modell erreichbar? mitWerkzeugen() verlangt beides: den Schluessel
// UND den Anthropic-Zweig (der OpenAI-kompatible Fallback kennt keine
// Werkzeuge). Deshalb hier dieselbe Bedingung wie dort, nicht nur verfuegbar().
function bereit() {
  return schnell.verfuegbar() && (process.env.SCHNELL_PROVIDER || "").toLowerCase() === "anthropic";
}

// ------------------------------------------------------------ Datumsangaben
//
// Das Modell bekommt das heutige Datum mit und soll "heute"/"nächsten Montag"
// selbst aufloesen. Diese Funktion ist der Rueckfall fuer den Fall, dass es
// das Wort trotzdem stehen laesst — und sie ist testbar, was ein Modellaufruf
// nicht ist.
const WOCHENTAGE = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6,
};
const MONATE = {
  januar: 1, februar: 2, "märz": 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7,
  august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

// Liefert JJJJ-MM-TT oder "". heute = Bezugstag (JJJJ-MM-TT), damit der Test
// nicht vom Kalender des Rechners abhaengt.
function datumAufloesen(roh, heute = rg.heute()) {
  const t = String(roh ?? "").trim().toLowerCase();
  if (!t) return "";
  const basis = /^\d{4}-\d{2}-\d{2}$/.test(String(heute)) ? String(heute) : rg.heute();

  // Schon fertig.
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  if (/^(heute|jetzt|sofort|am heutigen tag)$/.test(t)) return basis;
  if (/^(morgen)$/.test(t)) return rg.tageSpaeter(basis, 1);
  if (/^(übermorgen|uebermorgen)$/.test(t)) return rg.tageSpaeter(basis, 2);
  if (/^(gestern)$/.test(t)) return rg.tageSpaeter(basis, -1);
  if (/^(vorgestern)$/.test(t)) return rg.tageSpaeter(basis, -2);

  // "in 5 Tagen" / "in 2 Wochen"
  const inTagen = t.match(/^in\s+(\d{1,3})\s*(tag|tagen|woche|wochen)$/);
  if (inTagen) {
    const n = Number(inTagen[1]) * (/woche/.test(inTagen[2]) ? 7 : 1);
    return rg.tageSpaeter(basis, n);
  }

  // "nächsten Montag" / "kommenden Freitag" / "am Montag"
  const wt = t.match(/^(?:am\s+|diesen\s+|nächsten\s+|naechsten\s+|kommenden\s+)?([a-zäöü]+)$/);
  if (wt && WOCHENTAGE[wt[1]] !== undefined) {
    const ziel = WOCHENTAGE[wt[1]];
    const [j, m, d] = basis.split("-").map(Number);
    const heuteTag = new Date(j, m - 1, d).getDay();
    // "nächsten Montag" ist NIE heute: Wer am Montag "nächsten Montag" sagt,
    // meint in sieben Tagen. Ein Beleg mit dem Datum von heute waere hier der
    // haeufigste Missgriff.
    let plus = (ziel - heuteTag + 7) % 7;
    if (plus === 0) plus = 7;
    return rg.tageSpaeter(basis, plus);
  }

  // "15.9." / "15.09." / "15.09.2026" / "15.9.26"
  const de = t.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})?$/);
  if (de) {
    const tag = Number(de[1]), monat = Number(de[2]);
    let jahr = de[3] ? Number(de[3]) : Number(basis.slice(0, 4));
    if (de[3] && jahr < 100) jahr += 2000;
    if (monat < 1 || monat > 12 || tag < 1 || tag > 31) return "";
    const kandidat = `${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
    if (!istEchterTag(kandidat)) return "";
    // Ohne Jahresangabe: Ein Tag, der schon mehr als drei Monate zurueckliegt,
    // ist beim Diktieren fast immer das kommende Jahr gemeint ("15.1." im
    // Dezember). Umgekehrt bleibt ein Datum knapp hinter uns dieses Jahr —
    // Rechnungen werden oft ein paar Tage rueckdatiert.
    if (!de[3] && kandidat < rg.tageSpaeter(basis, -92)) {
      return `${jahr + 1}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
    }
    return kandidat;
  }

  // "15. September" / "15. September 2026"
  const lang = t.match(/^(\d{1,2})\.?\s+([a-zäöü]+)\s*(\d{4})?$/);
  if (lang && MONATE[lang[2]]) {
    const jahr = lang[3] ? Number(lang[3]) : Number(basis.slice(0, 4));
    const kandidat = `${jahr}-${String(MONATE[lang[2]]).padStart(2, "0")}-${String(Number(lang[1])).padStart(2, "0")}`;
    return istEchterTag(kandidat) ? kandidat : "";
  }
  return "";
}

// Gibt es den Tag wirklich? "2026-02-31" ist schema-gueltig und trotzdem kein
// Datum — new Date() rollt ihn stillschweigend auf den 3. Maerz weiter.
function istEchterTag(tag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tag))) return false;
  const [j, m, d] = tag.split("-").map(Number);
  const x = new Date(j, m - 1, d);
  return x.getFullYear() === j && x.getMonth() === m - 1 && x.getDate() === d;
}

// Plausibel? Nicht vor 2020 (dann ist es ein Lesefehler, die Firma gibt es
// erst seit 2025) und nicht mehr als ein Jahr in der Zukunft.
function datumPlausibel(tag, heute = rg.heute()) {
  if (!istEchterTag(tag)) return false;
  const jahr = Number(tag.slice(0, 4));
  if (jahr < MIN_JAHR) return false;
  return tag <= rg.tageSpaeter(heute, 366);
}

// ------------------------------------------------------------ Werkzeug-Schema
//
// Das Schema steht NEBEN dem Prompt, nicht darin (siehe die Begruendung in
// lib/schnell.js zu mitWerkzeugen): Es kann nicht abreissen, und das Modell
// schreibt keinen JSON-Text, den wir aus Prosa herausschneiden muessten.
const SCHEMA = {
  name: "beleg_entwurf",
  description: "Der aus dem Diktat verstandene Entwurf eines Angebots oder einer Rechnung.",
  input_schema: {
    type: "object",
    properties: {
      art: { type: "string", enum: ARTEN, description: "angebot oder rechnung — so, wie es im Text steht. Steht nichts dazu da, nimm die Vorgabe aus der Aufgabe." },
      firma: { type: "string", description: "Name des Kunden, genau wie im Text genannt. Leerer Text, wenn keiner genannt wird." },
      ansprechpartner: { type: "string", description: "Vor- und Nachname der Ansprechperson, falls genannt. Sonst leerer Text." },
      anrede: { type: "string", enum: ["Herr", "Frau", ""], description: "Nur wenn aus Namen oder Text eindeutig. Im Zweifel leerer Text." },
      titel: { type: "string", description: "Kurzbezeichnung des Vorgangs in ein bis drei Wörtern, z. B. 'Webseite' oder 'KI-Assistent'. Kein Satz." },
      vorlage: { type: "string", enum: VORLAGEN, description: "website = Webseite/Homepage/Onlineauftritt · ki = KI-Anwendung, Assistent, Automatisierung · performance = Google/Meta-Anzeigen, Kampagnen · frei = alles andere." },
      datum: { type: "string", description: "Belegdatum als JJJJ-MM-TT. Ohne Angabe das heutige Datum." },
      leistungsdatum: { type: "string", description: "Tag der Leistung als JJJJ-MM-TT, falls genannt ('Leistung heute', 'geliefert am 15.9.'). Sonst leerer Text." },
      faellig_tage: { type: "number", description: "Zahlungsziel in Tagen ab Belegdatum (Rechnung) bzw. Gültigkeit des Angebots. Ohne Angabe 14 bei Rechnung, 30 beim Angebot." },
      abschlag_prozent: { anyOf: [{ type: "number" }, { type: "null" }], description: "Prozentsatz, falls es eine Abschlagsrechnung ist ('Abschlag 50 %'). Sonst null." },
      gesamtbetrag: { anyOf: [{ type: "number" }, { type: "null" }], description: "Der genannte GESAMTbetrag des Auftrags, falls davon ein Abschlag genommen wird oder falls eine Gesamtsumme ausdrücklich genannt ist. Sonst null." },
      positionen: {
        type: "array",
        description: "Die Leistungszeilen des Belegs. Bei einer Abschlagsrechnung genau EINE Position über den Abschlagsbetrag.",
        items: {
          type: "object",
          properties: {
            titel: { type: "string", description: "Kurzer, fetter Zeilentitel, z. B. 'Erstellung der neuen Webseite'." },
            beschreibung: { type: "string", description: "Ein bis zwei Sätze Leistungsbeschreibung im Stil der Hausvorlage. Leer lassen, wenn nichts Konkretes im Diktat steht." },
            menge: { type: "number", description: "Anzahl. Ohne Angabe 1." },
            einheit: { type: "string", enum: ["pauschal", "Stück", "Stunde", "Tag", "Monat"], description: "Ohne Angabe pauschal." },
            einzelpreis: { anyOf: [{ type: "number" }, { type: "null" }], description: "Preis je Einheit in Euro als Zahl (2500 für '2.500 €'). null, wenn kein Preis genannt wurde." },
          },
          required: ["titel", "beschreibung", "menge", "einheit", "einzelpreis"],
        },
      },
      einleitung: { type: "string", description: "Nur beim Angebot: ein Satz, der mit Doppelpunkt endet. Bei der Rechnung leerer Text — die Hausvorlage hat dort keinen Einleitungstext." },
      nutzen: { type: "array", items: { type: "string" }, description: "Nur beim Angebot: 4 bis 5 Nutzenpunkte, je ein Satz ohne Schlusspunkt. Bei der Rechnung eine leere Liste." },
      schluss: { type: "string", description: "Nur beim Angebot: der Schlussabsatz. Bei der Rechnung leerer Text." },
      hinweis: { type: "string", description: "Was im Diktat unklar blieb oder fehlt, in einem kurzen deutschen Satz. Leerer Text, wenn alles klar war." },
      sicherheit: { type: "string", enum: SICHERHEIT, description: "Wie sicher sind Betrag, Datum und Kunde gelesen." },
    },
    required: ["art", "firma", "ansprechpartner", "anrede", "titel", "vorlage", "datum", "leistungsdatum",
               "faellig_tage", "abschlag_prozent", "gesamtbetrag", "positionen", "einleitung", "nutzen",
               "schluss", "hinweis", "sicherheit"],
  },
};

// Zwei echte Belege aus Lukas' Ordner, gekuerzt. Sie stehen hier
// AUSGESCHRIEBEN und nicht als Regel ("schreibe sachlich, nenne den Umfang") —
// ein Beispiel traegt den Ton, eine Regel beschreibt ihn nur. Vorbild:
// scratchpad/vorbilder/rechnung-R-2026-139.txt und angebot-2026-026.txt.
const VORBILD = `So schreibt das Haus (gekürzte Auszüge aus zwei echten Belegen):

RECHNUNG R-2026-139, Abschlagsrechnung an die Anderka GmbH — EINE Position, ein Fließtext:
"Abschlagsrechnung (50 %) – Erstellung einer professionellen Website für die Anderka GmbH inkl. individuellem, responsivem Webdesign, Aufbau aller Unterseiten, technischer On-Page-SEO-Optimierung, KI-Such-Optimierung (GEO / AI-SEO, Schema.org) sowie Online-Stellung (Hosting-Einrichtung, Domain-Verknüpfung, SSL und Go-Live). Diese Abschlagsrechnung umfasst 50 % des vereinbarten Gesamtbetrags von 2.500,00 €; die Schlussrechnung über die verbleibenden 50 % wird nach erfolgreichem Go-Live gestellt."
Betrag dieser Position: 1.250,00 € — also die HÄLFTE von 2.500,00 €, nicht der Gesamtbetrag.

ANGEBOT 2026-026 an Elektro Albonni — Nutzenpunkte, dann eine Position mit Titel und Beschreibung:
Nutzenpunkte:
- Moderner, vollständig mobiloptimierter Auftritt, der auf Desktop, Tablet und Smartphone überzeugt
- Ihre Leistungen klar dargestellt – Elektroinstallation, Reparatur, Wartung und Beratung auf einen Blick
- Bessere Auffindbarkeit bei Google durch technische On-Page-SEO – gezielt für Ihre Region
- KI-Such-Optimierung (GEO / Schema.org) – damit Ihr Betrieb auch von KI-Assistenten korrekt erfasst und empfohlen wird
- Klare Kontaktwege für mehr qualifizierte Anfragen
Position "Erstellung der neuen Webseite":
"Individuelles, responsives Webdesign – optimiert für Desktop, Tablet und Smartphone, inkl. Aufbau aller Unterseiten (u. a. Leistungen, Über uns, Referenzen, Kontakt). Technische On-Page-SEO-Optimierung, KI-Such-Optimierung (GEO / Schema.org) sowie Online-Stellung: Hosting-Einrichtung, Domain-Verknüpfung, SSL und Go-Live."`;

// Die Systemanweisung. Das heutige Datum steht DRIN, weil "heute" und
// "nächsten Montag" ohne Bezugstag nicht aufloesbar sind.
function anweisung(heute = rg.heute()) {
  return `Du füllst einen Beleg — ein Angebot oder eine Rechnung — für eine deutsche Webdesign- und KI-Agentur (svh Consulting, Sehorz & vom Hofe GbR, Zangberg). Du bekommst ein paar hingeworfene Fakten und machst daraus einen sauberen Entwurf, den ein Mensch anschließend prüft.

Heute ist der ${rg.datumLang(heute)} (${heute}).

RATE NICHTS. Was nicht dasteht, bleibt leer, und du sagst in "hinweis", was fehlt. Ein leeres Feld mit Hinweis ist richtig; eine plausible erfundene Zahl ist falsch — sie fällt beim Prüfen nicht auf und landet beim Kunden.

Zahlen und Beträge
· Alle Beträge sind ENDPREISE. Kleinunternehmerregelung nach § 19 UStG, keine Umsatzsteuer, kein Netto, kein "zzgl. MwSt.". Erwähne Umsatzsteuer nirgends.
· Deutsche Zahlformate: "2.500 €" = 2500, "2.500,50" = 2500.5, "2500" = 2500, "zweitausendfünfhundert" = 2500. Gib immer eine Zahl zurück, nie einen Text mit Währungszeichen.
· Wird ein Abschlag von einem Gesamtbetrag genannt ("2.500 €, Abschlag 50 %"), dann ist gesamtbetrag = 2500, abschlag_prozent = 50 und die EINE Position trägt 1250 — den Abschlagsbetrag, nicht den Gesamtbetrag.
· Ohne Abschlag muss die Summe der Positionen genau den genannten Betrag ergeben.

Datumsangaben
· Immer JJJJ-MM-TT. Löse "heute", "morgen", "nächsten Montag", "15.9." und "in zwei Wochen" gegen das oben genannte heutige Datum auf.
· "15.9." ohne Jahr meint den nächstliegenden solchen Tag, im Zweifel dieses Jahr.
· "Zahlungsziel 14 Tage" gehört nach faellig_tage, nicht ins Datum.

Text
· Sie-Form, konkret, ohne Superlative und ohne Floskelketten.
· Die RECHNUNG hat keine Anrede, keine Einleitung, keinen Schlussabsatz und keine Nutzenpunkte — sie geht von der Überschrift direkt in die Tabelle. Lass diese Felder bei der Rechnung leer.
· Das ANGEBOT hat 4 bis 5 Nutzenpunkte, die sagen, was DIESER Kunde davon hat — nicht, was wir tun. Mindestens zwei davon greifen die Branche des Kunden auf.
· Erfinde keine Leistungen, die im Diktat nicht vorkommen. Steht von Social Media nichts da, steht auch nichts davon im Beleg.
· Halte dich beim Ton an die Vorbilder unten.

${VORBILD}`;
}

// ------------------------------------------------------------ Nachpruefung
//
// Was aus dem Modell kommt, wird hier gegen die Wirklichkeit geprueft — nicht
// weil das Schema unzuverlaessig waere, sondern weil "schema-gueltig" und
// "kaufmaennisch plausibel" zwei verschiedene Dinge sind: 0 Euro ist eine
// gueltige Zahl und trotzdem kein Preis, 150 % ist ein gueltiger Prozentsatz
// und trotzdem kein Abschlag, und ein Datum in fuenf Jahren ist ein Lesefehler.
//
// Liefert IMMER ein vollstaendiges Objekt — auch bei Muell als Eingabe.
// warnungen[] sind Saetze fuer den Menschen, nicht fuer die Maschine: nichts
// davon verhindert das Speichern, alles davon steht ueber der Vorschau.
function saeubern(roh, { art = "rechnung", heute = rg.heute() } = {}) {
  const w = roh && typeof roh === "object" ? roh : {};
  const warnungen = [];
  const gewuenschteArt = ARTEN.includes(art) ? art : "rechnung";
  const gewaehlteArt = ARTEN.includes(w.art) ? w.art : gewuenschteArt;

  // --- Positionen. Titel UND Preis sind Pflicht: Eine Zeile ohne Preis ist im
  // Beleg eine Zeile mit "0,00 €", und eine Zeile ohne Titel ist ein leeres
  // Feld in der Tabelle beim Kunden.
  const rohPos = Array.isArray(w.positionen) ? w.positionen : [];
  const positionen = [];
  let verworfen = 0;
  for (const p of rohPos) {
    if (!p || typeof p !== "object") { verworfen++; continue; }
    const titel = s(p.titel, 160);
    let preis = rg.zuBetrag(p.einzelpreis);
    if (preis !== null && (preis <= 0 || preis > MAX_BETRAG)) {
      warnungen.push(`Der Preis „${s(p.einzelpreis, 40)}" in der Zeile „${titel || "ohne Titel"}" ist nicht plausibel und wurde entfernt.`);
      preis = null;
    }
    let menge = rg.zuBetrag(p.menge);
    if (menge === null || menge <= 0 || menge > 100000) menge = 1;
    const einheit = rg.EINHEITEN.includes(s(p.einheit, 20)) ? s(p.einheit, 20) : "pauschal";
    if (!titel || preis === null) { verworfen++; continue; }
    positionen.push({ titel, beschreibung: mehrzeilig(p.beschreibung, 1200), menge, einheit, einzelpreis: preis });
    if (positionen.length >= 20) break;
  }
  if (verworfen) {
    warnungen.push(verworfen === 1
      ? "Eine Zeile hatte keinen Titel oder keinen Preis und wurde nicht übernommen."
      : `${verworfen} Zeilen hatten keinen Titel oder keinen Preis und wurden nicht übernommen.`);
  }
  const summe = rg.summe(positionen);

  // --- Abschlag: 1 bis 100 Prozent. Alles andere ist verlesen ("Abschlag 150")
  // oder ein Euro-Betrag, der als Prozent gelandet ist.
  let abschlag = rg.zuBetrag(w.abschlag_prozent);
  if (abschlag !== null && (abschlag < 1 || abschlag > 100)) {
    warnungen.push(`Ein Abschlag von ${String(abschlag).replace(".", ",")} % ist nicht möglich — der Wert wurde entfernt. Bitte den Prozentsatz von Hand eintragen.`);
    abschlag = null;
  }

  // --- Gesamtbetrag
  let gesamt = rg.zuBetrag(w.gesamtbetrag);
  if (gesamt !== null && (gesamt <= 0 || gesamt > MAX_BETRAG)) {
    warnungen.push("Der genannte Gesamtbetrag ist nicht plausibel und wurde entfernt.");
    gesamt = null;
  }

  // --- DIE Geldpruefung. Nichts wird korrigiert, es wird gezeigt: Ob der
  // Diktierfehler beim Gesamtbetrag oder bei der Position sitzt, weiss nur der
  // Mensch, der den Satz gesagt hat.
  if (gesamt !== null && positionen.length) {
    const erwartet = abschlag !== null ? rund(gesamt * abschlag / 100) : gesamt;
    if (Math.abs(summe - erwartet) > 0.01) {
      warnungen.push(abschlag !== null
        ? `Die Positionen ergeben ${rg.euro(summe)}, ${String(abschlag).replace(".", ",")} % von ${rg.euro(gesamt)} wären aber ${rg.euro(erwartet)}. Bitte prüfen, welche Zahl stimmt.`
        : `Die Positionen ergeben ${rg.euro(summe)}, genannt war aber ein Gesamtbetrag von ${rg.euro(gesamt)}. Bitte prüfen, welche Zahl stimmt.`);
    }
  }
  if (!positionen.length) {
    warnungen.push("Aus dem Text ließ sich keine Position mit Titel und Preis lesen. Bitte Leistung und Betrag ergänzen.");
  }

  // --- Datum
  let datum = datumAufloesen(w.datum, heute) || "";
  if (datum && !datumPlausibel(datum, heute)) {
    warnungen.push(`Das gelesene Belegdatum (${s(w.datum, 30)}) liegt außerhalb des Plausiblen — es wurde durch das heutige Datum ersetzt.`);
    datum = "";
  }
  if (!datum) datum = heute;

  let leistungsdatum = datumAufloesen(w.leistungsdatum, heute) || "";
  if (leistungsdatum && !datumPlausibel(leistungsdatum, heute)) leistungsdatum = "";

  // --- Frist. 0 Tage waere "sofort faellig" und ist erlaubt; negativ nicht.
  let tage = rg.zuBetrag(w.faellig_tage);
  if (tage === null || tage < 0 || tage > 365) tage = rg.FRIST_TAGE[gewaehlteArt === "angebot" ? "angebot" : "rechnung"];
  tage = Math.round(tage);
  const faellig = rg.tageSpaeter(datum, tage);

  // --- Texte. Auf der Rechnung gibt es sie nicht (Hausvorlage, an allen 30
  // Rechnungen des Bestands geprueft) — was das Modell trotzdem schreibt,
  // faellt hier weg statt im PDF aufzutauchen.
  const istAngebot = gewaehlteArt === "angebot";
  const nutzen = istAngebot
    ? (Array.isArray(w.nutzen) ? w.nutzen : []).map((n) => s(n, 300).replace(/[.;]+$/, "")).filter((n) => n.length > 10).slice(0, 5)
    : [];

  return {
    art: gewaehlteArt,
    firma: s(w.firma, 160),
    ansprechpartner: s(w.ansprechpartner, 120),
    anrede: ["Herr", "Frau"].includes(s(w.anrede, 10)) ? s(w.anrede, 10) : "",
    titel: s(w.titel, 120),
    vorlage: VORLAGEN.includes(w.vorlage) ? w.vorlage : "frei",
    datum,
    leistungsdatum,
    faellig,
    faellig_tage: tage,
    abschlag_prozent: abschlag,
    gesamtbetrag: gesamt,
    positionen,
    summe,
    einleitung: istAngebot ? mehrzeilig(w.einleitung, 2000) : "",
    nutzen,
    schluss: istAngebot ? mehrzeilig(w.schluss, 2000) : "",
    hinweis: s(w.hinweis, 400),
    sicherheit: SICHERHEIT.includes(w.sicherheit) ? w.sicherheit : "mittel",
    warnungen,
  };
}

// Ein leerer Entwurf — der Zustand ohne Modellzugang und der Rueckfall, wenn
// das Modell wirft. Der diktierte Text bleibt erhalten und wandert als Notiz in
// die Einleitung bzw. in die eine Position, damit die Arbeit nicht weg ist.
function leererEntwurf(text, { art = "rechnung", heute = rg.heute(), grund = "" } = {}) {
  const e = saeubern({ art, positionen: [], nutzen: [], datum: heute, sicherheit: "niedrig" }, { art, heute });
  e.warnungen = grund ? [grund] : [];
  e.notiz = mehrzeilig(text, MAX_DIKTAT);
  e.leer = true;
  return e;
}

// ------------------------------------------------------------ Firma zuordnen
//
// Genau EIN guter Treffer wird genommen. Mehrere oder keiner heisst: fragen.
// Ein Angebot an den falschen Kunden ist schlimmer als eine Rueckfrage —
// dieselbe Regel wie in lib/beleg-erstellen.js.
const roh = (x) => String(x || "").toLowerCase().replace(/\s+/g, " ").trim();
const normal = (x) => roh(x)
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/\b(gmbh|ug|ag|kg|gbr|ohg|e\.?k\.?|mbh|co|und|&)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ").trim();

async function firmaZuordnen(user, name, firmaId = "") {
  // Von Hand gewaehlt schlaegt alles: Wer im Auswahlfeld eine Firma anklickt,
  // will genau die.
  if (/^\d+$/.test(String(firmaId))) {
    try {
      const [f] = await crm.firmenListe(user, { limit: 400 }).then((l) => l.filter((x) => String(x.id) === String(firmaId)));
      if (f) return { firma: f, treffer: [f], eindeutig: true, gewaehlt: true };
    } catch { /* unten weiter */ }
  }
  const suche = s(name, 80);
  if (!suche) return { firma: null, treffer: [], eindeutig: false };
  let treffer = [];
  try { treffer = await crm.firmenListe(user, { suche, limit: 5 }); } catch { treffer = []; }
  if (!treffer.length) return { firma: null, treffer: [], eindeutig: false };

  // Der Name steht Zeichen fuer Zeichen so in der Akte (nur Gross-/Kleinschreibung
  // und Leerzeichen egal) — dann ist es diese Firma, egal wie viele Namensvettern
  // die Suche noch liefert.
  const rohGenau = treffer.filter((f) => roh(f.name) === roh(suche));
  if (rohGenau.length === 1) return { firma: rohGenau[0], treffer, eindeutig: true };

  // Sonst wird ohne Rechtsform und Umlaute verglichen. ABER: "Anderka" trifft so
  // auch "Anderka GmbH" — und wenn daneben noch "Anderka Bau GmbH" steht, ist
  // das kein guter Treffer, sondern ein Namensanfang, der auf zwei Kunden passt.
  // Genau daran ist ein Beleg beim falschen Empfaenger gelandet; deshalb zaehlt
  // ein exakter Treffer nur, wenn kein zweiter Name mit demselben Anfang danebensteht.
  const g = normal(suche);
  const genau = treffer.filter((f) => normal(f.name) === g);
  const aehnlich = treffer.filter((f) => normal(f.name) !== g && normal(f.name).startsWith(g + " "));
  if (genau.length === 1 && !aehnlich.length) return { firma: genau[0], treffer, eindeutig: true };
  if (treffer.length === 1) return { firma: treffer[0], treffer, eindeutig: true };
  return { firma: null, treffer, eindeutig: false };
}

// ------------------------------------------------------------ Verstehen
//
// Wirft nie. Ohne Modell oder bei einem Fehler kommt ein leerer Entwurf mit
// erklaerender Warnung zurueck — die Seite bleibt bedienbar.
async function verstehen(user, { text = "", art = "rechnung", firmaId = "", heute = rg.heute() } = {}) {
  const diktat = mehrzeilig(text, MAX_DIKTAT);
  const gewuenscht = ARTEN.includes(art) ? art : "rechnung";
  if (!diktat) {
    return { ok: false, grund: "leer", entwurf: leererEntwurf("", { art: gewuenscht, heute, grund: "Es stand nichts im Textfeld." }), firma: null, treffer: [] };
  }
  if (!bereit()) {
    const e = leererEntwurf(diktat, { art: gewuenscht, heute,
      grund: "Ohne Sprachmodell kann ich aus deinem Text keinen Entwurf bauen — auf dem Server läuft es. Der Text bleibt als Notiz am Entwurf stehen." });
    const f = await firmaZuordnen(user, "", firmaId);
    return { ok: false, grund: "kein-modell", entwurf: e, firma: f.firma, treffer: f.treffer };
  }

  let antwort;
  try {
    antwort = await schnell.mitWerkzeugen(
      anweisung(heute),
      [
        `Art des Belegs (Vorgabe aus der Oberfläche): ${gewuenscht}`,
        "",
        "Das ist das Diktat:",
        diktat,
      ].join("\n"),
      [SCHEMA],
      { maxTokens: 3000, model: MODELL, timeoutMs: 45000, aufwand: "medium" },
    );
  } catch (fehler) {
    return {
      ok: false, grund: "modell",
      entwurf: leererEntwurf(diktat, { art: gewuenscht, heute,
        grund: `Das Verstehen hat nicht geklappt: ${String(fehler.message).slice(0, 160)}. Der Text bleibt stehen — nochmal versuchen oder von Hand ausfüllen.` }),
      firma: null, treffer: [],
    };
  }

  const auf = (antwort.aufrufe || []).find((a) => a.name === SCHEMA.name);
  if (!auf) {
    return {
      ok: false, grund: "keine-antwort",
      entwurf: leererEntwurf(diktat, { art: gewuenscht, heute,
        grund: "Das Modell hat keinen Entwurf zurückgegeben. Nochmal versuchen oder von Hand ausfüllen." }),
      firma: null, treffer: [],
    };
  }

  const entwurf = saeubern(auf.input || {}, { art: gewuenscht, heute });
  entwurf.notiz = "";
  const f = await firmaZuordnen(user, entwurf.firma, firmaId);
  if (!f.firma && entwurf.firma) {
    entwurf.warnungen.push(f.treffer.length
      ? `Zu „${entwurf.firma}" passen mehrere Kunden — bitte unten auswählen.`
      : `„${entwurf.firma}" steht nicht im CRM. Empfängerdaten kommen dann aus dem Diktat; die Adresse fehlt.`);
  }
  return { ok: true, entwurf, firma: f.firma, treffer: f.treffer, modell: MODELL, tokenRaus: antwort.tokenRaus || 0 };
}

// ------------------------------------------------------------ Entwurf anlegen
//
// Erst hier entsteht eine Zeile in "rechnungen" — Status entwurf, also ohne
// Nummer. rechnungen.anlegen() gehoert Agent D1; hier wird sie nur gerufen.
async function entwurfAnlegen(user, entwurf, { firma = null } = {}) {
  const e = entwurf && typeof entwurf === "object" ? entwurf : {};
  const art = ARTEN.includes(e.art) ? e.art : "rechnung";

  // Empfaenger: die Akte fuellt, was sie hat; was diktiert wurde, gewinnt.
  const ausAkte = firma ? rg.empfaengerAusFirma(firma) : rg.empfaengerAusFirma(null);
  const empfaenger = {
    name: ausAkte.name || s(e.firma, 160),
    ansprechperson: s(e.ansprechpartner, 120) || ausAkte.ansprechperson,
    strasse: ausAkte.strasse,
    plz_ort: ausAkte.plz_ort,
    email: ausAkte.email,
    anrede: s(e.anrede, 10) || ausAkte.anrede,
  };
  if (!empfaenger.name) return { ok: false, grund: "empfaenger" };

  // Ohne Position kann rechnungen.anlegen() nicht speichern (Regel von D1).
  // Statt zu scheitern legen wir eine leere Zeile mit dem diktierten Text an —
  // genau das ist der Zustand ohne Modellzugang, und er soll benutzbar sein.
  let positionen = Array.isArray(e.positionen) ? e.positionen : [];
  const notiz = mehrzeilig(e.notiz, MAX_DIKTAT);
  if (!positionen.length) {
    positionen = [{
      titel: s(e.titel, 160) || (art === "angebot" ? "Leistung" : "Leistung"),
      beschreibung: notiz ? `Aus dem Diktat übernommen, noch nicht ausgewertet:\n${notiz}` : "",
      menge: 1, einheit: "pauschal", einzelpreis: null,
    }];
  }

  const vorlage = VORLAGEN.includes(e.vorlage) ? e.vorlage : "frei";
  const standard = rg.texte(vorlage, art);
  const istAngebot = art === "angebot";

  return rg.anlegen(user, {
    art,
    firma_id: firma ? firma.id : null,
    empfaenger,
    datum: e.datum || rg.heute(),
    faellig: e.faellig || rg.frist(art, e.datum || rg.heute()),
    positionen,
    vorlage,
    titel: s(e.titel, 120) || standard.titel,
    // Der diktierte Text landet beim Angebot in der Einleitung, bei der
    // Rechnung nirgends (die Hausvorlage hat dort keinen Fliesstext) — dann
    // steht er in der Positionsbeschreibung, siehe oben.
    einleitung: istAngebot ? (mehrzeilig(e.einleitung, 2000) || standard.einleitung) : "",
    schluss: istAngebot ? (mehrzeilig(e.schluss, 2000) || standard.schluss) : "",
    nutzen: istAngebot ? (Array.isArray(e.nutzen) ? e.nutzen.join("\n") : "") : "",
  });
}

module.exports = {
  // Konstanten und reine Funktionen (testbar ohne Datenbank und ohne Modell)
  SCHEMA, VORLAGEN, ARTEN, MODELL, MAX_DIKTAT, MAX_BETRAG,
  anweisung, saeubern, datumAufloesen, datumPlausibel, istEchterTag, leererEntwurf, bereit,
  // Mit Datenbank bzw. Modell
  firmaZuordnen, verstehen, entwurfAnlegen,
};
