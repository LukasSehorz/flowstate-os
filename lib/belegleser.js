// Flowstate Belegleser — liest Betrag, Datum, Lieferant und Kategorie aus dem
// hochgeladenen Bild oder PDF.
//
// Der Punkt dieses Moduls: Jannik soll nichts abtippen. Er laedt den Bon hoch,
// hier werden die Werte gelesen, die Pruefmaske ist vorbefuellt, er tippt auf
// "Passt". Nichts wird ohne diese Bestaetigung gebucht — das Auslesen macht
// einen Vorschlag, keine Buchung.
//
// Lexware konnte das nicht: die Public API hat keine Belegerkennung. Das war
// mit der Hauptgrund, es aus dem Weg zu nehmen.
//
// Ohne Schluessel ist das Modul still: bereit() gibt false, der Belegeingang
// funktioniert weiter, die Felder sind dann eben leer. Der Ablauf haengt also
// nicht daran.
//
// WELCHER SCHLUESSEL (07.08.2026): dieselbe Kette wie ueberall sonst im System.
// Hier stand nur ANTHROPIC_API_KEY — den gibt es auf dem Server nicht, der
// Anthropic-Schluessel liegt dort unter SCHNELL_API_KEY. Ergebnis: Der Leser
// hat seit jeher geschwiegen, und jeder Beleg kam ohne Betrag durch. Aufgefallen
// ist es erst, als der Postfachlauf drei Rechnungen mit "Betrag nicht erkannt"
// meldete — beim Telegram-Beleg war es genauso, nur hat es dort niemand
// nachgerechnet.

const KLASSE = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");

const MODELL = process.env.BELEG_MODELL || "claude-opus-5";

// Bildformate, die die Schnittstelle annimmt. HEIC ist bewusst NICHT dabei —
// iPhone-Fotos kommen oft als HEIC und werden abgewiesen. Darum unten ein
// verstaendlicher Hinweis statt einer Fehlermeldung aus dem Netzwerkstack.
const BILD_TYPEN = ["image/jpeg", "image/png", "image/gif", "image/webp"];
// Die Schnittstelle nimmt Bilder bis 5 MB base64. Wir bleiben mit Abstand
// darunter, weil base64 rund ein Drittel aufschlaegt.
const MAX_BILD = 3.7 * 1024 * 1024;
const MAX_PDF = 28 * 1024 * 1024;

const SCHLUESSEL = () =>
  process.env.ANTHROPIC_API_KEY || process.env.SCHNELL_API_KEY || process.env.HERMES_API_KEY || "";

let klient = null;
function hol() {
  const k = SCHLUESSEL();
  if (!k) return null;
  if (!klient) klient = new KLASSE({ apiKey: k });
  return klient;
}

module.exports.bereit = () => Boolean(SCHLUESSEL());
module.exports.modell = () => MODELL;

// Warum ein Beleg nicht gelesen werden kann — in Klartext, damit der Hinweis in
// der Pruefmaske etwas taugt.
function warumNicht(typ, groesse) {
  const t = String(typ || "").toLowerCase();
  if (t.includes("heic") || t.includes("heif")) {
    return "iPhone-Format (HEIC) kann nicht gelesen werden. Im iPhone unter " +
           'Einstellungen › Kamera › Formate auf „Maximale Kompatibilität“ stellen, ' +
           "dann kommen Fotos als JPG.";
  }
  if (t === "application/pdf") {
    if (groesse > MAX_PDF) return "PDF ist größer als 28 MB.";
    return null;
  }
  if (!BILD_TYPEN.includes(t)) {
    return `Dateityp ${typ || "unbekannt"} kann nicht gelesen werden — bitte als JPG, PNG oder PDF hochladen.`;
  }
  if (groesse > MAX_BILD) return "Bild ist größer als 3,7 MB — bitte kleiner speichern oder als PDF hochladen.";
  return null;
}
module.exports.warumNicht = warumNicht;

// Das Schema. Die Kategorienliste kommt von aussen herein, damit sie nur an
// einer Stelle gepflegt wird (lib/buchhaltung.js) und Auslesen und Auswahlfeld
// nie auseinanderlaufen.
function schema(kategorien) {
  const zahlOderNull = { anyOf: [{ type: "number" }, { type: "null" }] };
  const textOderNull = { anyOf: [{ type: "string" }, { type: "null" }] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["betrag_brutto", "datum", "gegenstelle", "kategorie", "belegnummer",
               "steuersatz", "faellig", "notiz", "richtung", "sicherheit", "hinweis"],
    properties: {
      betrag_brutto: { ...zahlOderNull, description: "Gesamtbetrag inklusive Steuer. Bei einem Kassenbon die Summe, nicht einzelne Posten. null wenn nicht lesbar." },
      datum: { ...textOderNull, description: "Belegdatum als JJJJ-MM-TT. Bei einem Kassenbon das Kaufdatum, bei einer Rechnung das Rechnungsdatum." },
      gegenstelle: { type: "string", description: "Firmenname des Lieferanten bzw. des Kunden. Leerer Text wenn nicht erkennbar." },
      kategorie: { type: "string", enum: kategorien, description: "Die am besten passende Kategorie aus der Liste." },
      belegnummer: { type: "string", description: "Rechnungs- oder Bonnummer, wie sie auf dem Beleg steht. Leerer Text wenn keine da ist." },
      steuersatz: { ...zahlOderNull, description: "Ausgewiesener Umsatzsteuersatz in Prozent, z. B. 19 oder 7. null wenn keiner ausgewiesen ist." },
      faellig: { ...textOderNull, description: "Zahlungsziel als JJJJ-MM-TT, falls auf einer Rechnung angegeben. Sonst null." },
      notiz: { type: "string", description: "In maximal acht Wörtern: was wurde gekauft oder geleistet." },
      richtung: { type: "string", enum: ["ausgabe", "einnahme"], description: "ausgabe = wir haben bezahlt. einnahme = wir haben Geld bekommen bzw. es ist unsere Rechnung an einen Kunden." },
      sicherheit: { type: "string", enum: ["hoch", "mittel", "niedrig"], description: "Wie sicher sind Betrag und Datum gelesen." },
      hinweis: { type: "string", description: "Wenn etwas unklar oder schlecht lesbar war, in einem kurzen deutschen Satz sagen was. Sonst leerer Text." },
    },
  };
}

const ANWEISUNG = `Du liest Belege für die Buchhaltung einer deutschen Werbeagentur (Sehorz & vom Hofe GbR, Kleinunternehmer nach §19 UStG).

Lies aus dem Bild oder PDF ausschließlich ab, was tatsächlich draufsteht. Regeln:

- Betrag: immer der BRUTTO-Gesamtbetrag. Auf Kassenbons ist das die Zeile "SUMME", "Gesamt" oder "Total" — nicht ein einzelner Artikel und nicht der Netto-Betrag.
- Deutsche Zahlen: "1.234,56" bedeutet eintausendzweihundertvierunddreißig Euro und 56 Cent. Gib 1234.56 zurück.
- Datum: deutsche Belege schreiben TT.MM.JJJJ. "03.07.26" ist der 3. Juli 2026, nicht der 7. März. Gib immer JJJJ-MM-TT zurück.
- Lieferant: der Firmenname des Ausstellers, nicht die Adresse und nicht der Sachbearbeiter.
- Wenn du einen Wert nicht sicher lesen kannst, gib null oder leeren Text zurück und schreibe in "hinweis", was unklar war. Rate nicht.

Erfinde nichts. Ein leeres Feld mit Hinweis ist richtig, ein geratener Betrag ist falsch — ein Mensch prüft deinen Vorschlag anschließend und korrigiert lieber ein leeres Feld als eine plausible falsche Zahl.`;

// beleg: { dateiname, dateityp, daten (Buffer), art }
// kategorien: erlaubte Kategorien fuer diese Richtung
//
// Rueckgabe immer { ok, werte?, hinweis?, modell? } — dieses Modul wirft nicht.
// Ein Beleg, der nicht gelesen werden kann, darf den Upload nicht scheitern
// lassen; er landet dann eben mit leeren Feldern im Eingang.
module.exports.lesen = async function (beleg, kategorien) {
  const c = hol();
  if (!c) return { ok: false, hinweis: "Kein Zugang zum Lesedienst hinterlegt (weder ANTHROPIC_API_KEY noch SCHNELL_API_KEY gesetzt)." };
  if (!beleg || !beleg.daten || !beleg.daten.length) return { ok: false, hinweis: "Keine Datei vorhanden." };

  const grund = warumNicht(beleg.dateityp, beleg.daten.length);
  if (grund) return { ok: false, hinweis: grund };

  const istPdf = String(beleg.dateityp).toLowerCase() === "application/pdf";
  const base64 = beleg.daten.toString("base64");
  const anhang = istPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: String(beleg.dateityp).toLowerCase(), data: base64 } };

  const richtung = beleg.art === "einnahme" ? "einnahme" : "ausgabe";
  const frage = richtung === "einnahme"
    ? "Das ist eine Rechnung, die wir einem Kunden gestellt haben. Lies die Werte aus."
    : "Das ist ein Beleg für etwas, das wir bezahlt haben. Lies die Werte aus.";

  try {
    const antwort = await c.messages.create({
      model: MODELL,
      // Reichlich Luft: das Modell denkt vor der Antwort, und max_tokens deckelt
      // Denken und Ausgabe zusammen. Zu knapp bemessen bricht mitten im JSON ab.
      max_tokens: 4000,
      system: ANWEISUNG,
      // Niedriger Aufwand genuegt — einen Bon ablesen ist keine Denkaufgabe.
      // Das Schema erzwingt die Form, wir muessen nichts aus Prosa herausparsen.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: schema(kategorien) },
      },
      messages: [{ role: "user", content: [anhang, { type: "text", text: frage }] }],
    });

    const text = (antwort.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (antwort.stop_reason === "refusal") {
      return { ok: false, hinweis: "Der Lesedienst hat die Datei abgelehnt. Bitte Werte von Hand eintragen." };
    }
    if (!text.trim()) {
      return { ok: false, hinweis: "Der Lesedienst hat nichts zurückgegeben. Bitte Werte von Hand eintragen." };
    }

    const w = JSON.parse(text);
    return { ok: true, werte: saeubern(w, kategorien), modell: MODELL };
  } catch (fehler) {
    // Absicht: der Upload gilt trotzdem. Der Grund landet als Hinweis am Beleg,
    // damit man sieht, warum die Felder leer sind.
    return { ok: false, hinweis: `Lesen fehlgeschlagen: ${String(fehler.message).slice(0, 200)}` };
  }
};

// Was aus dem Modell kommt, wird hier nochmal gegen die Wirklichkeit geprueft.
// Nicht weil das Schema unzuverlaessig waere, sondern weil "schema-gueltig" und
// "buchhalterisch plausibel" zwei verschiedene Dinge sind: 0 Euro ist eine
// gueltige Zahl und trotzdem kein Betrag, und ein Datum in fuenf Jahren ist ein
// Lesefehler, kein Beleg.
function saeubern(w, kategorien) {
  const zahl = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const text = (v) => (typeof v === "string" ? v.trim().slice(0, 200) : "");

  let betrag = zahl(w.betrag_brutto);
  if (betrag !== null && (betrag <= 0 || betrag > 1000000)) betrag = null;

  let datum = text(w.datum);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) datum = "";
  if (datum) {
    const d = new Date(datum + "T12:00:00Z");
    const jahr = d.getUTCFullYear();
    const morgen = Date.now() + 36 * 3600 * 1000;
    // Vor 2015 oder in der Zukunft: das ist kein Beleg von uns, das ist ein
    // verdrehtes Datum. Lieber leer lassen als falsch vorbelegen.
    if (Number.isNaN(d.getTime()) || jahr < 2015 || d.getTime() > morgen) datum = "";
  }

  let faellig = text(w.faellig);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(faellig)) faellig = "";

  let satz = zahl(w.steuersatz);
  if (satz !== null && (satz < 0 || satz > 30)) satz = null;

  return {
    betrag,
    datum,
    faellig,
    gegenstelle: text(w.gegenstelle),
    kategorie: kategorien.includes(w.kategorie) ? w.kategorie : null,
    belegnummer: text(w.belegnummer),
    steuersatz: satz,
    notiz: text(w.notiz),
    richtung: w.richtung === "einnahme" ? "einnahme" : "ausgabe",
    sicherheit: ["hoch", "mittel", "niedrig"].includes(w.sicherheit) ? w.sicherheit : "mittel",
    hinweis: text(w.hinweis),
  };
}
