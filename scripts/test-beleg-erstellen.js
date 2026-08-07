// Testet den Ablauf "Rechnung schreiben -> Mail aufsetzen -> rausschicken".
//
// Warum das hier streng geprueft wird: Am Ende dieses Ablaufs geht eine Mail an
// einen ECHTEN Kunden. Jeder andere Fehler im System kostet Zeit — dieser
// kostet Ruf. Deshalb pruefen die Faelle unten vor allem, WAS NICHT PASSIEREN
// DARF:
//
//   · kein Versand ohne zweite Freigabe
//   · kein zweiter Versand auf ein zweites "ja"
//   · keine geratene Mailadresse
//   · keine Nummer doppelt
//   · kein Beleg mit fehlenden Angaben
//
// Gesendet wird hier nie: gmail.senden wird ausgetauscht und schreibt nur mit.
//
// Aufruf: node scripts/test-beleg-erstellen.js

const os = require("os");
const fs = require("fs");
const path = require("path");

// In einen Wegwerfordner ablegen — der Test soll nichts Echtes hinterlassen.
const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), "beleg-test-"));
process.env.BELEG_AUSGANG = ORDNER;

const gmail = require("../lib/gmail-direkt.js");
const nummern = require("../lib/beleg-nummer.js");
const vorlage = require("../lib/beleg-vorlage.js");
const pdf = require("../lib/beleg-pdf.js");
const angebotText = require("../lib/angebot-text.js");

// --- Umgebung ersetzen, BEVOR das zu testende Modul geladen wird ------------
let gesendet = [];
gmail.senden = async (m) => { gesendet.push(m); return { ok: true, id: "test" }; };
gmail.bereit = () => true;

// Nummern ohne Datenbank: aufsteigend, wie es die echte Vergabe auch tut.
let zaehler = { rechnung: 130, angebot: 23 };
nummern.naechste = async (art) => {
  const a = art === "angebot" ? "angebot" : "rechnung";
  zaehler[a] += 1;
  const echt = require("../lib/beleg-nummer.js").FORM;
  return { ok: true, nummer: echt[a](2026, zaehler[a]), zahl: zaehler[a], jahr: 2026 };
};

// Die Vorlage wird in test-beleg-vorlage.js eigens geprueft. Hier zaehlt der
// Ablauf, nicht der Dateiinhalt — also eine Attrappe, damit der Test auch ohne
// gemountete Vorlagen laeuft.
vorlage.erzeugen = () => Buffer.from("PK-attrappe");
pdf.wandeln = async () => ({ pdf: Buffer.from("%PDF-attrappe") });

// Der Angebotstext kommt sonst vom Modell. Hier eine Attrappe: Geprueft wird der
// ABLAUF, nicht die Schreibqualitaet — die haengt am Modell und gehoert in einen
// eigenen Lauf gegen die echte Schnittstelle.
let textAufrufe = 0;
angebotText.schreiben = async (a) => {
  textAufrufe++;
  return {
    anrede: "Sehr geehrter Herr Müller,",
    einleitung: "vielen Dank für Ihr Interesse! In der folgenden Auflistung sehen Sie, was wir anbieten:",
    vorteile: ["Erster Nutzen für den Betrieb", "Zweiter Nutzen", "Dritter Nutzen", "Vierter Nutzen"],
    posten_titel: "Erstellung der neuen Webseite",
    posten_text: "Eine ausführliche Leistungsbeschreibung mit mehr als achtzig Zeichen, damit sie die Prüfung besteht und im Angebot landet.",
  };
};

const b = require("../lib/beleg-erstellen.js");

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

const AUFTRAG = {
  art: "rechnung", firma: "Müller & Sohn GmbH", betrag: 1500,
  leistung: "Erstellung einer professionellen Website für die Müller & Sohn GmbH inkl. responsivem Design.",
  sparte: "Website", anrede: "Herrn Thomas Müller", strasse: "Hauptstraße 12", plz_ort: "84032 Landshut",
};

(async () => {
  // --- Unvollstaendige Auftraege werden zurueckgefragt, nicht geraten -------
  //
  // Das ist der wichtigste Block. Ein Modell, das eine fehlende Angabe still
  // erfindet, erzeugt eine Rechnung, die falsch ist und trotzdem echt aussieht.
  b.vergessen();
  const ohneFirma = await b.erstellen({ ...AUFTRAG, firma: "" });
  pruefe("Ohne Firma wird nachgefragt statt erzeugt", !ohneFirma.ok && /firma/i.test(ohneFirma.reply));

  const ohneBetrag = await b.erstellen({ ...AUFTRAG, betrag: 0 });
  pruefe("Ohne Betrag wird nachgefragt", !ohneBetrag.ok && /betrag/i.test(ohneBetrag.reply));

  const ohneLeistung = await b.erstellen({ ...AUFTRAG, leistung: "Website" });
  pruefe("Zu duenner Leistungstext wird nachgefragt", !ohneLeistung.ok);

  const ohneProjekt = await b.erstellen({ ...AUFTRAG, art: "angebot", leistung: "" });
  pruefe("Beim Angebot wird nach dem Projekt gefragt, nicht nach der Leistung",
    !ohneProjekt.ok && /beschreib mir das projekt/i.test(ohneProjekt.reply), ohneProjekt.reply);

  pruefe("Nach einem Fehlversuch steht nichts offen", b.wasOffen() === null);

  // --- Der glatte Weg ------------------------------------------------------
  const r1 = await b.erstellen(AUFTRAG);
  pruefe("Rechnung wird erzeugt", r1.ok, r1.reply);
  pruefe("Nummer laeuft weiter (R-2026-131)", r1.nummer === "R-2026-131", r1.nummer);
  // Wie im Bestand: laufende Nummer, Kunde, Sparte (vgl. 20_Krotzer_Eisele_Website.docx).
  pruefe("Dateiname im Stil des Bestands", /^131_Mueller_Sohn_Website\.docx$/.test(r1.datei), r1.datei);

  // Die Datei muss WIRKLICH liegen. Ohne das waere eine erstellte, aber nicht
  // sofort verschickte Rechnung nach zwanzig Minuten verloren — mitsamt der
  // Nummer, die dafuer schon vergeben ist.
  pruefe("Die Word-Datei liegt im Ausgang", fs.existsSync(path.join(ORDNER, "131_Mueller_Sohn_Website.docx")),
    fs.readdirSync(ORDNER).join(", "));

  // Der Satz, den Lukas woertlich verlangt hat.
  pruefe("Die Rueckfrage nach der Mail kommt woertlich",
    /Soll ich sie raussenden\? Soll ich eine Mail dafür aufsetzen\?/.test(r1.reply), r1.reply);
  pruefe("Betrag und Frist stehen in der Ansage", /1\.500,00 €/.test(r1.reply) && /zahlbar bis/.test(r1.reply));

  // --- Ohne Adresse wird gefragt, nicht geraten ----------------------------
  const a1 = await b.antwortAuf("ja");
  pruefe("Ohne bekannte Mailadresse wird danach gefragt", /welche mailadresse/i.test(a1.reply), a1.reply);
  pruefe("Dabei wurde nichts gesendet", gesendet.length === 0);

  const a2 = await b.antwortAuf("an thomas@mueller-sohn.de");
  pruefe("Adresse aus dem Satz wird erkannt", /thomas@mueller-sohn\.de/.test(a2.reply), a2.reply);
  pruefe("Der Mailtext wird zum Mithoeren vorgelesen",
    /Rechnung R-2026-131/.test(a2.reply) && /1\.500,00 €/.test(a2.reply), a2.reply);
  pruefe("Und erst dann die zweite Rueckfrage", /Soll sie so rausgehen\?/.test(a2.reply));
  pruefe("Immer noch nichts gesendet", gesendet.length === 0);

  // --- Erst das zweite Ja sendet -------------------------------------------
  const a3 = await b.antwortAuf("ja schick sie raus");
  pruefe("Nach der zweiten Freigabe geht sie raus", gesendet.length === 1, a3.reply);
  pruefe("An die richtige Adresse", gesendet[0]?.an === "thomas@mueller-sohn.de");
  pruefe("Mit Anhang, und zwar als PDF",
    gesendet[0]?.anhaenge?.length === 1 && gesendet[0].anhaenge[0].name === "131_Mueller_Sohn_Website.pdf",
    gesendet[0]?.anhaenge?.[0]?.name);
  pruefe("Die PDF liegt auch im Ausgang", fs.existsSync(path.join(ORDNER, "131_Mueller_Sohn_Website.pdf")),
    fs.readdirSync(ORDNER).join(", "));
  pruefe("Betreff traegt Nummer und Firma",
    /R-2026-131/.test(gesendet[0]?.betreff || "") && /Müller & Sohn/.test(gesendet[0]?.betreff || ""));
  pruefe("Verwendungszweck steht im Text", /Verwendungszwecks? R-2026-131/.test(gesendet[0]?.text || ""));
  pruefe("Bestaetigung nennt Empfaenger und Nummer",
    /thomas@mueller-sohn\.de/.test(a3.reply) && /R-2026-131/.test(a3.reply), a3.reply);

  // --- Ein zweites "ja" darf NICHT nochmal senden --------------------------
  //
  // Am Telefon sagt man leicht zweimal ja. Eine doppelt verschickte Rechnung
  // ist beim Kunden ein echtes Aergernis.
  const doppelt = await b.antwortAuf("ja");
  pruefe("Ein zweites Ja sendet nicht nochmal", gesendet.length === 1);
  pruefe("Und wird gar nicht erst als Antwort gewertet", doppelt === null, JSON.stringify(doppelt));

  // --- Nein bricht ab -------------------------------------------------------
  gesendet = [];
  await b.erstellen({ ...AUFTRAG, email: "kunde@example.com" });
  await b.antwortAuf("ja");
  const nein = await b.antwortAuf("nein, noch nicht");
  pruefe("Nein verhindert den Versand", gesendet.length === 0);
  pruefe("Nein sagt, dass die Rechnung trotzdem daliegt", /liegt fertig/i.test(nein.reply), nein.reply);
  pruefe("Danach steht nichts mehr offen", b.wasOffen() === null);

  // --- Bekannte Adresse ueberspringt die Zwischenfrage ---------------------
  const r2 = await b.erstellen({ ...AUFTRAG, email: "info@kunde.de" });
  const m2 = await b.antwortAuf("ja bitte");
  pruefe("Mit bekannter Adresse kommt der Text sofort", /info@kunde\.de/.test(m2.reply) && /Soll sie so rausgehen/.test(m2.reply));
  pruefe("Die Nummer ist eine andere als vorhin", r2.nummer !== r1.nummer, `${r1.nummer} / ${r2.nummer}`);

  // --- Fremde Saetze sind KEINE Antwort ------------------------------------
  //
  // Waehrend eine Rechnung offen ist, muss "wie ist das Wetter" trotzdem an
  // Alexandra gehen. Sonst verschluckt die Rueckfrage das halbe Gespraech.
  pruefe("Eine fremde Frage wird durchgelassen", (await b.antwortAuf("wie ist das Wetter morgen")) === null);
  pruefe("Auch eine mit 'ja' mittendrin", (await b.antwortAuf("sag mal, kommt Jannik heute ja oder nein")) === null);
  pruefe("Die Rechnung steht danach immer noch offen", b.wasOffen()?.schritt === "mail-freigeben");

  // --- Angebote --------------------------------------------------------------
  b.vergessen();
  const ang = await b.erstellen({ ...AUFTRAG, art: "angebot", betrag: 2400, email: "info@kunde.de" });
  // Format wie im Bestand ab 24.06.: 2026-024, dreistellig, ohne Buchstabe.
  // Der erste Entwurf machte A-2026-119 — ein Format, das Lukas seit sechs
  // Wochen nicht mehr benutzt.
  pruefe("Angebot bekommt eine Nummer im Format 2026-NNN", ang.nummer === "2026-024", ang.nummer);
  pruefe("Für das Angebot wurde ein Text geschrieben", textAufrufe === 1, `${textAufrufe} Aufrufe`);
  pruefe("Die Nutzenpunkte werden mit vorgelesen",
    /Erster Nutzen für den Betrieb/.test(ang.reply) && /Erstellung der neuen Webseite/.test(ang.reply), ang.reply);
  // 30 Tage, nicht 14 — so steht es in jedem Angebot im Bestand.
  const inDreissig = new Date(Date.now() + 30 * 86400000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  pruefe("Angebot gilt 30 Tage", ang.reply.includes(inDreissig), `erwartet ${inDreissig}, bekommen: ${ang.reply.slice(0, 90)}`);
  pruefe("Angebot spricht von Gueltigkeit, nicht von Zahlung", /gültig bis/.test(ang.reply) && !/zahlbar/.test(ang.reply), ang.reply);
  const angMail = await b.antwortAuf("ja");
  pruefe("Angebotsmail bittet nicht um Überweisung", !/Überweisung/.test(angMail.reply), angMail.reply);

  // --- Ohne offene Rechnung passiert nichts ---------------------------------
  b.vergessen();
  pruefe("Ohne offene Rechnung ist 'ja' keine Antwort", (await b.antwortAuf("ja")) === null);
  const leer = await b.senden();
  pruefe("Senden ohne Vorgang meldet das ehrlich", !leer.ok && /keine mail/i.test(leer.reply));

  // --- Wenn kein PDF entsteht, wird das GESAGT -----------------------------
  //
  // Stillschweigend eine Word-Datei zu verschicken, waere schlimmer als der
  // fehlende Wandler selbst: Lukas glaubt, es sei eine PDF rausgegangen.
  //
  // Die Entscheidung faellt jetzt beim SENDEN, nicht beim Erstellen — die
  // Wandlung laeuft nebenher, damit die Rueckfrage nicht 1,6 s spaeter kommt.
  // Der Hinweis muss deshalb in der Sendebestaetigung stehen.
  gesendet = [];
  b.vergessen();
  pdf.wandeln = async () => ({ pdf: null, hint: "kein Wandler" });
  await b.erstellen({ ...AUFTRAG, email: "kunde@example.com" });
  await b.antwortAuf("ja");
  const raus = await b.antwortAuf("ja");
  pruefe("Ohne PDF-Wandler geht die Word-Datei raus", gesendet[0]?.anhaenge?.[0]?.name.endsWith(".docx"),
    gesendet[0]?.anhaenge?.[0]?.name);
  pruefe("Und Alexandra sagt beim Senden dazu, dass es keine PDF war",
    /Word-Datei, nicht als PDF/.test(raus.reply), raus.reply);

  // --- Aufraeumen -------------------------------------------------------------
  try { fs.rmSync(ORDNER, { recursive: true, force: true }); } catch {}

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
