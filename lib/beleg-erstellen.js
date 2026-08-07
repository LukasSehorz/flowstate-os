// Rechnungen und Angebote erstellen — und auf Zuruf rausschicken.
//
// Warum (Lukas, 07.08.2026): "Der automatisch Rechnungen erstellen kann und
// Angebote erstellen kann. [...] Wenn die erstellt werden soll, dann soll immer
// auch die Frage kommen: 'Soll ich es raussenden? Soll ich eine Mail dafuer
// aufsetzen?' Wenn man das mit 'Ja' beantwortet, dann sollte es erstellt
// werden. Dann soll es immer durchlesen koennen und dann soll es rausgehen."
//
// Daraus folgen ZWEI Rueckfragen, nicht eine:
//
//   1. Rechnung liegt  ->  "Soll ich eine Mail dafuer aufsetzen?"
//   2. Mail ist getippt ->  vorlesen, dann "Soll sie so rausgehen?"
//
// Die zweite ist die wichtigere. Eine Rechnung, die an den falschen Empfaenger
// oder mit schiefem Text rausgeht, laesst sich nicht zurueckholen — und Lukas
// gibt diese Anweisungen aus dem Auto, wo er nichts sieht. Deshalb wird der
// fertige Text vorgelesen, BEVOR gesendet wird, und nie in einem Rutsch beides.
//
// WAS HIER NICHT PASSIERT: buchen. Eine gestellte Rechnung ist eine Forderung,
// keine Einnahme — sie wird erst beim Zahlungseingang gebucht. Wer das
// zusammenzieht, hat sein Ergebnis um jede offene Rechnung zu hoch.

const nummern = require("./beleg-nummer.js");
const vorlage = require("./beleg-vorlage.js");
const pdf = require("./beleg-pdf.js");
const gmail = require("./gmail-direkt.js");

const ABSENDER = process.env.MAIL_ABSENDER || "Lukas Sehorz <lukas.sehorz@flowstate-ai.net>";
// Wie lange eine Rueckfrage gilt. Laenger waere gefaehrlich: Ein "ja" eine
// Stunde spaeter meint mit ziemlicher Sicherheit etwas anderes.
const GILT_MS = 20 * 60 * 1000;

// Was gerade zur Bestaetigung aussteht. Bewusst nur EINS: Zwei offene
// Rueckfragen gleichzeitig und ein blosses "ja" ist nicht mehr zuordenbar.
let offen = null;

const euro = (n) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const dLang = (d) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
const dKurz = (d) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

function frisch() {
  if (offen && Date.now() - offen.seit > GILT_MS) offen = null;
  return offen;
}

// Aus "Müller & Sohn GmbH" wird "Mueller_Sohn" — Dateinamen im Stil des
// Bestands (27_Bodenziegel_Website.docx).
function kurzName(s) {
  return String(s || "Kunde")
    .replace(/ä/gi, "ae").replace(/ö/gi, "oe").replace(/ü/gi, "ue").replace(/ß/g, "ss")
    .replace(/\b(GmbH|UG|AG|KG|GbR|e\.?K\.?|mbH|und|&|Co)\b/gi, " ")
    .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_+$/g, "").split("_").slice(0, 2).join("_") || "Kunde";
}

// --- Schritt 1: erstellen ---------------------------------------------------
//
// auftrag kommt vom Sprachmodell und ist damit nie ganz vertrauenswuerdig.
// Deshalb hier die Pruefungen, die eine unbrauchbare Rechnung verhindern —
// jede fehlende Angabe ist eine Rueckfrage wert, KEIN stiller Platzhalter.
async function erstellen(auftrag = {}) {
  const art = auftrag.art === "angebot" ? "angebot" : "rechnung";
  const wort = art === "angebot" ? "Angebot" : "Rechnung";

  const firma = String(auftrag.firma || auftrag.empfaenger?.firma || "").trim();
  if (!firma) return { ok: false, reply: `Für welche Firma soll ich die ${wort === "Angebot" ? "das Angebot" : "Rechnung"} schreiben?` };

  const betrag = Number(auftrag.betrag);
  if (!betrag || betrag <= 0) return { ok: false, reply: `Über welchen Betrag soll ${art === "angebot" ? "das Angebot" : "die Rechnung"} für ${firma} laufen?` };

  const leistung = String(auftrag.leistung || "").trim();
  if (leistung.length < 10) return { ok: false, reply: `Was genau soll als Leistung draufstehen für ${firma}?` };

  const heute = new Date();
  // Rechnungen: 14 Tage zahlbar. Angebote: 14 Tage gueltig. Beides ist der
  // Bestand — nicht erfunden, sondern aus Lukas' bisherigen Belegen.
  const frist = new Date(heute.getTime() + (Number(auftrag.zahlungsziel) || 14) * 86400000);

  const n = await nummern.naechste(art, firma);
  if (!n.ok) return { ok: false, reply: `Die Nummernvergabe hakt gerade (${n.hint}). Ich lege lieber nichts an, bevor eine Nummer doppelt vergeben wird.` };

  const daten = {
    art, sparte: auftrag.sparte || "Website", nummer: n.nummer,
    empfaenger: {
      firma,
      anrede: String(auftrag.anrede || auftrag.ansprechpartner || "").trim(),
      strasse: String(auftrag.strasse || "").trim(),
      plz_ort: String(auftrag.plz_ort || auftrag.ort || "").trim(),
    },
    datum: heute, faellig: frist,
    positionen: [{ text: leistung, einzel: betrag, gesamt: betrag }],
    gesamt: betrag,
  };

  let docx;
  try { docx = vorlage.erzeugen(daten); }
  catch (e) { return { ok: false, reply: `Die Vorlage ließ sich nicht füllen: ${String(e.message).slice(0, 120)}` }; }

  const basis = `${n.zahl}_${kurzName(firma)}_${String(daten.sparte).replace(/\s+/g, "")}`;
  const { pdf: fertigePdf, hint: pdfHint } = await pdf.wandeln(docx);

  offen = {
    schritt: "mail-anbieten", seit: Date.now(),
    art, wort, nummer: n.nummer, firma, betrag, leistung, frist,
    mailAn: String(auftrag.email || "").trim(),
    datei: fertigePdf
      ? { name: `${basis}.pdf`, typ: "application/pdf", daten: fertigePdf }
      : { name: `${basis}.docx`, typ: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", daten: docx },
    nurWord: !fertigePdf,
  };

  // Der Satz, den Lukas woertlich verlangt hat. Die Angaben davor sind das
  // Wenige, an dem er im Auto merkt, ob etwas schiefgelaufen ist.
  const kopf = art === "angebot"
    ? `${wort} ${n.nummer} für ${firma} liegt: ${euro(betrag)}, gültig bis ${dKurz(frist)}.`
    : `${wort} ${n.nummer} für ${firma} liegt: ${euro(betrag)}, zahlbar bis ${dKurz(frist)}.`;
  const warnung = fertigePdf ? "" : ` Als Word-Datei — der PDF-Wandler hat nicht angeschlagen (${pdfHint}).`;

  return {
    ok: true, nummer: n.nummer, datei: offen.datei, nurWord: offen.nurWord,
    reply: `${kopf}${warnung}\n\nSoll ich sie raussenden? Soll ich eine Mail dafür aufsetzen?`,
  };
}

// --- Schritt 2: die Mail texten ---------------------------------------------
//
// Bewusst ohne Sprachmodell. Ein Anschreiben zu einer Rechnung hat drei Saetze
// und keinen Spielraum — und ein Modellaufruf hier waere eine weitere Stelle,
// an der etwas Falsches an einen Kunden gehen kann.
function mailTexten(b) {
  const anrede = b.anredeName
    ? `Hallo ${b.anredeName},`
    : "Guten Tag,";
  const koerper = b.art === "angebot"
    ? `vielen Dank für Ihr Interesse. Anbei erhalten Sie unser Angebot ${b.nummer} über ${euro(b.betrag)}.\n\n${b.leistung}\n\nDas Angebot ist gültig bis zum ${dLang(b.frist)}. Bei Fragen melden Sie sich gerne jederzeit.`
    : `anbei erhalten Sie die Rechnung ${b.nummer} über ${euro(b.betrag)}.\n\n${b.leistung}\n\nWir bitten um Überweisung bis zum ${dLang(b.frist)} unter Angabe des Verwendungszwecks ${b.nummer}.\n\nVielen Dank für die gute Zusammenarbeit.`;
  return {
    betreff: `${b.wort} ${b.nummer} – ${b.firma}`,
    text: `${anrede}\n\n${koerper}\n\nViele Grüße\nLukas Sehorz\nFlowstate – Sehorz & vom Hofe GbR`,
  };
}

// Ist eine Mailadresse dabei? Sonst muss danach gefragt werden — raten waere
// hier der teuerste Fehler.
function mailAufsetzen(email) {
  const b = frisch();
  // Beide Schritte sind gueltig: "mail-anbieten" ist der erste Anlauf,
  // "adresse-fehlt" der zweite, nachdem nach der Adresse gefragt wurde. Nur den
  // ersten zu akzeptieren liess die nachgereichte Adresse ins Leere laufen.
  if (!b || (b.schritt !== "mail-anbieten" && b.schritt !== "adresse-fehlt")) {
    return { ok: false, reply: "Da ist gerade keine Rechnung offen." };
  }

  const an = String(email || b.mailAn || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(an)) {
    b.schritt = "adresse-fehlt";
    return { ok: true, reply: `An welche Mailadresse soll die ${b.wort} gehen?` };
  }

  b.mailAn = an;
  const m = mailTexten(b);
  b.mail = m;
  b.schritt = "mail-freigeben";
  b.seit = Date.now();

  // Vorlesen — genau das, was Lukas mit "dann soll es immer durchlesen koennen"
  // gemeint hat. Der Betreff gehoert dazu: Ein falscher Empfaenger faellt
  // meistens erst auf, wenn man ihn hoert.
  return {
    ok: true,
    reply: `Die Mail geht an ${an}, Betreff: ${m.betreff}.\n\n${m.text}\n\nSoll sie so rausgehen?`,
  };
}

// --- Schritt 3: senden ------------------------------------------------------
async function senden() {
  const b = frisch();
  if (!b || b.schritt !== "mail-freigeben") return { ok: false, reply: "Da ist gerade keine Mail zum Rausschicken offen." };
  if (!gmail.bereit()) return { ok: false, reply: "Kein Mailzugang hinterlegt — ich kann sie nicht verschicken." };

  const merk = b;
  offen = null;   // vor dem Senden leeren: ein zweites "ja" darf nicht doppelt senden

  try {
    await gmail.senden({
      an: merk.mailAn, betreff: merk.mail.betreff, text: merk.mail.text,
      absender: ABSENDER, anhaenge: [merk.datei],
    });
    return { ok: true, reply: `Raus an ${merk.mailAn}. ${merk.wort} ${merk.nummer} über ${euro(merk.betrag)}${merk.art === "rechnung" ? `, fällig ${dKurz(merk.frist)}` : ""}.` };
  } catch (e) {
    // Die Nummer ist vergeben und die Datei existiert — das bleibt so. Nur der
    // Versand ist gescheitert, und das muss deutlich gesagt werden.
    return { ok: false, reply: `Das Verschicken hat nicht geklappt: ${String(e.message).slice(0, 140)}. ${merk.wort} ${merk.nummer} liegt aber fertig — ich kann es nochmal versuchen.` };
  }
}

// --- Die Rueckfragen beantworten --------------------------------------------
//
// Gibt null zurueck, wenn der Satz KEINE Antwort auf eine offene Rueckfrage war.
// Dann gehoert er Alexandra und wird ganz normal beantwortet.
async function antwortAuf(text) {
  const b = frisch();
  if (!b) return null;
  const t = String(text || "").trim().toLowerCase();

  // Eine Mailadresse im Satz ist immer eine Antwort — egal, wie er sonst lautet.
  const adr = (String(text).match(/[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}/i) || [])[0];
  if (adr && (b.schritt === "adresse-fehlt" || b.schritt === "mail-anbieten")) return mailAufsetzen(adr);

  const ja = /^(ja|jap|jo|klar|passt|gerne|mach|mach das|schick|schicke|senden|send|raus|rausschicken|los|ok|okay|genau|bitte|jawohl)\b/.test(t);
  const nein = /^(nein|ne|nee|nicht|kein|stopp|stop|lass|warte|abbrechen|verwerfen|noch nicht|später)\b/.test(t);
  if (!ja && !nein) return null;

  if (nein) {
    const w = b.wort, n = b.nummer;
    offen = null;
    return { ok: true, reply: b.schritt === "mail-freigeben"
      ? `Alles klar, ich schick sie nicht. ${w} ${n} liegt fertig da.`
      : `Alles klar. ${w} ${n} liegt fertig da, ohne Mail.` };
  }

  if (b.schritt === "mail-anbieten" || b.schritt === "adresse-fehlt") return mailAufsetzen();
  if (b.schritt === "mail-freigeben") return senden();
  return null;
}

// Damit ein spaeteres "ja" nicht die falsche Rechnung verschickt.
function vergessen() { offen = null; }
const wasOffen = () => (frisch() ? { schritt: offen.schritt, nummer: offen.nummer, wort: offen.wort } : null);

module.exports = { erstellen, mailAufsetzen, senden, antwortAuf, vergessen, wasOffen, mailTexten, kurzName };
