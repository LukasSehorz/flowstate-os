// Testet die Kette Erstgespraech -> Auswertung -> Angebot (20.08.2026).
//
// Die teuren Fehler stehen hier alle beieinander, und keiner davon faellt beim
// Zuhoeren auf:
//
//   1. Nach der Firma fragen, obwohl der Name im Satz stand. Das ist der
//      Grund, aus dem es diese Datei ueberhaupt gibt (19.08., vor der Kamera).
//   2. Einen Preis erfinden. Die Zahl steht in einem Angebot beim Kunden.
//   3. Den Beinahe-Treffer stillschweigend nehmen — "Bergmann Immobilien"
//      statt "Zahnarztpraxis Bergmann".
//   4. Mit einer blossen Rueckfrage enden, wenn nichts im System steht.
//      Ehrlich sein reicht nicht; es muss ein Weg dabeistehen.
//
// Laeuft ohne Datenbank und ohne Modell — beides ist ausgetauscht.
// Aufruf: node scripts/test-gespraech-angebot.js

const crm = require("../lib/crm.js");
const schnell = require("../lib/schnell.js");
const belegErstellen = require("../lib/beleg-erstellen.js");

// --- Die Datenbank austauschen, BEVOR das Modul geladen wird ----------------
let BESTAND = [];        // firmen
let VERLAUF = [];        // aktivitaeten
let DEALS = [];

crm.system = async (sql, args = []) => {
  const s = String(sql);
  if (/from aktivitaeten/.test(s)) return { rows: VERLAUF };
  if (/from deals/.test(s)) return { rows: DEALS };
  if (/where id = \$1/.test(s)) {
    const f = BESTAND.find((x) => String(x.id) === String(args[0]));
    return { rows: f ? [f] : [] };
  }
  // Beide Firmensuchen (die aus firma-nachschlagen und der zweite Anlauf hier)
  // laufen ueber name ilike $1.
  const suche = String(args[0] || "").replace(/%/g, "").toLowerCase();
  const treffer = BESTAND.filter((f) => f.name.toLowerCase().includes(suche));
  treffer.sort((a, b) => {
    const w = (x) => (x.name.toLowerCase() === String(args[1] || "").toLowerCase() ? 0 : 1);
    const p = (x) => (x.name.toLowerCase().startsWith(suche) ? 0 : 1);
    return w(a) - w(b) || p(a) - p(b);
  });
  return { rows: treffer.slice(0, 4) };
};

// --- Das Modell austauschen ------------------------------------------------
// ANTWORT ist, was die Auswertung zurueckgeben soll. MODELL_LIEF zaehlt mit,
// damit geprueft werden kann, dass bei duennem Material gar nicht erst gefragt
// wird — ein Modellaufruf auf zwei Woerter kostet nur Zeit.
let ANTWORT = null;
let MODELL_LIEF = 0;
let MODELL_SAH = "";
schnell.frage = async (system, nutzer) => {
  MODELL_LIEF++;
  MODELL_SAH = nutzer;
  if (ANTWORT === "wirf") throw new Error("Modell nicht erreichbar");
  // Im Codeblock, genau wie Haiku 4.5 es live zurueckgibt (20.08. gemessen).
  // Ein Test, der sauberes JSON stubbt, haette den Auspacker nie geprueft.
  return "```json\n" + JSON.stringify(ANTWORT) + "\n```";
};

// --- Die Belegerstellung austauschen ---------------------------------------
// Sonst verbraucht jeder Testlauf eine echte Angebotsnummer.
let BELEG = null;
belegErstellen.erstellen = async (auftrag) => {
  BELEG = auftrag;
  return {
    ok: true, nummer: "2026-042", datei: "42_Test_Website.docx",
    reply: "Angebot 2026-042 für " + auftrag.firma + " liegt: 500,00 €, gültig bis 19.09.2026.\n\nSoll ich sie raussenden?",
    gesprochen: "Angebot 2026-042 für " + auftrag.firma + " liegt: 500,00 €. Soll ich es raussenden?",
  };
};

const g = require("../lib/gespraech-angebot.js");

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

// Aus dem echten Bestand abgeschrieben (Elektro Albonni, Dachdecker Restle,
// 20.08. aus der Datenbank gelesen). Erfundene Notizen waeren sauberer als die
// Wirklichkeit — und dann wuerde hier nicht auffallen, dass die Wirklichkeit
// Tippfehler, Halbsaetze und Mittelpunkte enthaelt.
const ALBONNI = {
  id: "2371", name: "Elektro Albonni", branche: "Elektriker", ort: "Wasserburg",
  website: "", email: "info@albonni.de", adresse: "Hauptstr. 1", plz: "83512",
  geschaeftsfuehrer: "Marco Albonni", geschlecht: "m", taetigkeit: "Elektroinstallation",
  leistungen: [], argumente: null, stand: null, besonderes: null,
  anruf_notiz: null, notizen: null, erstgespraech_am: "2026-08-18T15:00:00.000Z",
  preis_setup: null, preis_monatlich: null, status: "lead", mitarbeiter_zahl: 4,
};
const ALBONNI_VERLAUF = [
  { art: "anruf", zeit: "2026-08-17T13:16:22.024Z",
    text: "Erstgespräch gebucht — Termin 2026-08-18T17:00 · Herr Albonni · Erstgespräch Albonni, Preis 500€ -> Demo-Seite zeigen" },
];

(async () => {
  // === 1. Die Notiz vom Protokoll trennen ==================================
  //
  // crm.js setzt den Ausgang vor den Text ("Erstgespräch gebucht — ..."). Der
  // Ausgang ist kein Gespraechsinhalt, und "Termin 2026-08-18T17:00" ist eine
  // Uhrzeit — bleibt sie stehen, taucht sie spaeter als Zahl auf und kann einer
  // erfundenen Preisangabe falschen Rueckhalt geben.
  const k = g.kern(ALBONNI_VERLAUF[0].text);
  pruefe("Der Ausgang faellt weg", !/Erstgespräch gebucht/.test(k), k);
  pruefe("Die Terminzeit faellt weg", !/2026-08-18T17:00/.test(k), k);
  pruefe("Der Inhalt bleibt", /Preis 500€/.test(k) && /Demo-Seite/.test(k), k);
  pruefe("Reines Protokoll bleibt leer", g.kern("Nicht erreicht (Versuch 1)").length < 12,
    g.kern("Nicht erreicht (Versuch 1)"));
  pruefe("Auch ein Stufenwechsel traegt nichts bei",
    g.kern("Später nochmal").length < 12, g.kern("Später nochmal"));
  pruefe("Eine Notiz MIT Inhalt bleibt erhalten",
    /Mann sprechen/.test(g.kern("Später nochmal — muss mit Mann sprechen, ruft an")));

  // === 2. Preise lesen =====================================================
  pruefe("500€ ohne Leerzeichen", g.preiseAus("Preis 500€ -> Demo").join() === "500");
  pruefe("Tausenderpunkt", g.preiseAus("Angebot über 1.500 €").join() === "1500");
  pruefe("Ausgeschrieben", g.preiseAus("kostet 750 Euro").join() === "750");
  pruefe("Cent werden mitgenommen", g.preiseAus("2.000,50 EUR").join() === "2000.5");
  // Untergrenze: "3 €" ist eine Stueckzahl oder ein Vertipper, kein Angebot.
  pruefe("Kleinbetraege sind kein Angebotspreis", g.preiseAus("3 € Porto").length === 0);
  pruefe("Uhrzeiten sind kein Preis", g.preiseAus("Termin um 14:00").length === 0);

  // === 3. Ein erfundener Preis kommt nicht durch ===========================
  //
  // Der wichtigste Test der Datei. Ein Sprachmodell, das "1200" sagt, weil es
  // plausibel klingt, schreibt diese Zahl sonst in ein Angebot beim Kunden.
  pruefe("Belegter Preis wird angenommen", g.belegbar(500, "Preis 500€ -> Demo-Seite"));
  pruefe("Belegter Preis auch mit Tausenderpunkt", g.belegbar(1500, "für 1.500 € angeboten"));
  pruefe("ERFUNDENER Preis wird verworfen", !g.belegbar(1200, "Preis 500€ -> Demo-Seite"));
  pruefe("Ohne Preis kein Preis", !g.belegbar(null, "irgendwas"));

  // === 4. Woher der Preis kommt ============================================
  //
  // Reihenfolge ist eine Entscheidung, keine Geschmacksfrage: Was Lukas gerade
  // sagt, ist immer juenger als jeder Eintrag.
  const material = { text: "Preis 500€", zeilen: [{ kern: "Preis 500€" }], deals: [{ wert: 900 }] };
  pruefe("Was Lukas sagt, gewinnt",
    g.preisFinden({ auftrag: { betrag: 1900 }, firma: { preis_setup: 750 }, material }).preis === 1900);
  pruefe("Danach die Kundenakte",
    g.preisFinden({ auftrag: {}, firma: { preis_setup: 750 }, material }).preis === 750);
  pruefe("Danach der offene Deal",
    g.preisFinden({ auftrag: {}, firma: {}, material }).preis === 900);
  pruefe("Zuletzt das Gespraech",
    g.preisFinden({ auftrag: {}, firma: {}, material: { ...material, deals: [] } }).preis === 500);
  pruefe("Und die Herkunft wird gemerkt",
    g.preisFinden({ auftrag: {}, firma: {}, material: { ...material, deals: [] } }).woher === "gespraech");
  pruefe("Ohne Zahl bleibt es bei null",
    g.preisFinden({ auftrag: {}, firma: {}, material: { text: "", zeilen: [], deals: [] } }).preis === null);

  // === 5. Firmennamen, wie Lukas sie ausspricht ===========================
  pruefe("Branchenwort faellt weg",
    g.tragendeWorte("Zahnarztpraxis Bergmann").join() === "Bergmann",
    g.tragendeWorte("Zahnarztpraxis Bergmann").join());
  pruefe("Rechtsform faellt weg",
    !g.tragendeWorte("Stephan Himmel GmbH").includes("GmbH"));
  pruefe("Der Eigenname bleibt",
    g.tragendeWorte("Fahrschule Wachtel Freising").includes("Wachtel"));

  // === 6. Die Firma finden =================================================
  BESTAND = [ALBONNI];
  VERLAUF = ALBONNI_VERLAUF;
  DEALS = [];

  const gefunden = await g.firmaFinden("Elektro Albonni");
  pruefe("Die genannte Firma wird gefunden", gefunden.ok && gefunden.firma.name === "Elektro Albonni");

  BESTAND = [
    { ...ALBONNI, id: "1", name: "Physiotherapie Bergmann" },
    { ...ALBONNI, id: "2", name: "Bergmann Elektrotechnik" },
  ];
  const mehrere = await g.firmaFinden("Bergmann");
  pruefe("Bei mehreren wird nicht geraten",
    !mehrere.ok && mehrere.grund === "mehrdeutig", JSON.stringify(mehrere.grund));

  BESTAND = [{ ...ALBONNI, id: "9", name: "Bergmann Immobilien" }];
  const beinahe = await g.firmaFinden("Zahnarztpraxis Bergmann");
  pruefe("Der Beinahe-Treffer wird gefunden",
    !beinahe.ok && beinahe.grund === "aehnlich" && beinahe.namen[0] === "Bergmann Immobilien",
    JSON.stringify(beinahe));

  BESTAND = [];
  const nichts = await g.firmaFinden("Zahnarztpraxis Bergmann");
  pruefe("Gar nichts ist gar nichts", !nichts.ok && nichts.grund === "nicht-gefunden");

  // Das seltenere Wort gewinnt, nicht das laengere. Live am 20.08. gefunden:
  // Zu "Dachdecker Restle" lieferte das laengere Wort drei fremde Betriebe.
  BESTAND = [
    { ...ALBONNI, id: "3", name: "Dachdecker | Erwin Restle GmbH | München" },
    { ...ALBONNI, id: "4", name: "IG Dachdecker GmbH & Co.KG" },
    { ...ALBONNI, id: "5", name: "Dachdeckerei Sigmund Pielmeier GmbH" },
  ];
  const restle = await g.firmaFinden("Dachdecker Restle");
  pruefe("Das seltenere Wort entscheidet, nicht das laengere",
    restle.namen?.length === 1 && /Restle/.test(restle.namen[0]), JSON.stringify(restle.namen));

  // Firmennamen, die aus einem Verzeichnis importiert wurden, tragen
  // Trennstriche — und dieselbe Firma steht oft zweimal drin, kurz und lang.
  // Vorgelesen klingt beides nach Systemfehler.
  const ohr = g.fuersOhr(["Dachdecker | Erwin Restle GmbH | München", "Erwin Restle GmbH"]);
  pruefe("Doppelte Schreibweise faellt weg", ohr.length === 1, JSON.stringify(ohr));
  pruefe("Und der Trennstrich wird zum Komma",
    !/\|/.test(g.fuersOhr(["A | B"])[0]), JSON.stringify(g.fuersOhr(["A | B"])));

  // === 7. Der Satz, um den es geht =========================================
  //
  // "Bei welcher Firma es genau geht, weiss ich gerade nicht" darf nie wieder
  // vorkommen, wenn der Name im Satz stand. Und die Antwort muss ohne
  // Nachfrage weiterhelfen.
  BESTAND = [];
  const a1 = await g.ausGespraech({ firma: "Zahnarztpraxis Bergmann" });
  pruefe("Der Firmenname steht in der Antwort", /Bergmann/.test(a1.gesprochen), a1.gesprochen);
  pruefe("Es wird NICHT nach der Firma gefragt",
    !/welche[rn]? Firma|welche du meinst|welchen Zusammenhang/i.test(a1.gesprochen), a1.gesprochen);
  pruefe("Es wird trotzdem weitergeholfen",
    /sag mir Leistung und Preis/i.test(a1.gesprochen), a1.gesprochen);
  pruefe("Und ehrlich gesagt, dass nichts da ist",
    /nichts im System/i.test(a1.gesprochen), a1.gesprochen);

  // Der Beinahe-Treffer wird genannt, aber nicht benutzt.
  BESTAND = [{ ...ALBONNI, id: "9", name: "Bergmann Immobilien" }];
  BELEG = null;
  const a2 = await g.ausGespraech({ firma: "Zahnarztpraxis Bergmann" });
  pruefe("Der Beinahe-Treffer wird beim Namen genannt",
    /Bergmann Immobilien/.test(a2.gesprochen), a2.gesprochen);
  pruefe("Aber KEIN Angebot an den Falschen", BELEG === null, JSON.stringify(BELEG));
  pruefe("Und auch hier steht ein Weg dabei",
    /Leistung und Preis/i.test(a2.gesprochen), a2.gesprochen);

  // === 8. Firma da, Gespraech leer =========================================
  BESTAND = [ALBONNI];
  VERLAUF = [{ art: "anruf", zeit: "2026-08-17T13:16:22.024Z", text: "Nicht erreicht (Versuch 1)" }];
  DEALS = [];
  MODELL_LIEF = 0;
  BELEG = null;
  const a3 = await g.ausGespraech({ firma: "Elektro Albonni" });
  pruefe("Leeres Gespraech wird ehrlich gemeldet",
    /nichts\s+\S*\s*im System/i.test(a3.gesprochen), a3.gesprochen);
  pruefe("Auch hier wird weitergeholfen", /Leistung und Preis/i.test(a3.gesprochen));
  pruefe("Kein Angebot aus dem Nichts", BELEG === null);
  // Auf zwei Woerter das Modell zu befragen kostet nur Zeit — im Gespraech
  // hoerbare Zeit.
  pruefe("Und das Modell wird gar nicht erst gefragt", MODELL_LIEF === 0, String(MODELL_LIEF));

  // Reine Rueckruforganisation ist Material, aber kein Vorhaben. Das Modell
  // sagt das — und Alexandra soll es weitersagen, statt nur "nichts da".
  // Live am 20.08. am Malereibetrieb Richter beobachtet: drei Notizen, alle
  // ueber Rueckrufzeiten, kein Wort zum Projekt.
  VERLAUF = [
    { art: "anruf", zeit: "2026-08-04T13:21:59.548Z", text: "Später nochmal — Hatte gerade Kunden da, 05. August nochmal anrufen" },
    { art: "anruf", zeit: "2026-08-05T12:37:28.083Z", text: "Erstgespräch gebucht — 14 Uhr nochmal · Herr Richter · Di, 11.08. 14 uhr" },
  ];
  // "Rueckrufzeiten" steht hier mit Absicht falsch: Genau so kam es am 20.08.
  // aus dem Modell zurueck, und vorgelesen wurde daraus "R-u-e-ck-ruf-zeiten".
  ANTWORT = { verwertbar: false, leistung: "", kernpunkte: [], preis: null,
    sparte: "Website", warum: "Nur Rueckrufzeiten, nichts zum Vorhaben" };
  BELEG = null;
  const a3b = await g.ausGespraech({ firma: "Elektro Albonni" });
  pruefe("Es wird gesagt, WAS stattdessen dasteht",
    /Rückrufzeiten/.test(a3b.gesprochen), a3b.gesprochen);
  pruefe("ae/oe/ue aus dem Modell wird repariert",
    !/Rueckruf/.test(a3b.gesprochen), a3b.gesprochen);
  pruefe("Der Halbsatz haengt sich klein an", /— nur Rückrufzeiten/.test(a3b.gesprochen), a3b.gesprochen);
  pruefe("Aus Rueckrufzeiten wird kein Angebot", BELEG === null, JSON.stringify(BELEG));

  // === 9. Der Normalfall: Angebot entsteht =================================
  BESTAND = [ALBONNI];
  VERLAUF = ALBONNI_VERLAUF;
  DEALS = [];
  ANTWORT = {
    verwertbar: true,
    leistung: "Neue Website für den Elektrobetrieb Albonni. Herr Albonni will vorab eine Demo-Seite sehen. Besprochener Preis 500 Euro.",
    kernpunkte: ["neue Website", "Demo-Seite vorab"],
    preis: 500, sparte: "Website",
  };
  MODELL_LIEF = 0;
  BELEG = null;
  const a4 = await g.ausGespraech({ firma: "Elektro Albonni" });

  pruefe("Ein Angebot wird angelegt", Boolean(BELEG) && BELEG.art === "angebot", JSON.stringify(BELEG));
  pruefe("Mit dem Preis aus dem Gespraech", BELEG?.betrag === 500, String(BELEG?.betrag));
  pruefe("Mit dem vollen Firmennamen", BELEG?.firma === "Elektro Albonni", BELEG?.firma);
  pruefe("Und einer Leistungsbeschreibung, die traegt",
    String(BELEG?.leistung || "").length >= 40, BELEG?.leistung);
  pruefe("Sparte kommt mit", g.SPARTEN.includes(BELEG?.sparte), BELEG?.sparte);
  pruefe("Das Modell hat die Notiz gesehen", /Demo-Seite/.test(MODELL_SAH));
  pruefe("Aber kein Protokollrauschen", !/Stufenwechsel|Kundenakte angelegt/.test(MODELL_SAH));

  pruefe("Die Antwort sagt, dass ausgewertet wurde",
    /ausgewertet/i.test(a4.gesprochen), a4.gesprochen);
  pruefe("Sie nennt den Preis", /500 Euro/.test(a4.gesprochen), a4.gesprochen);
  pruefe("Und woher er kommt", /aus dem Gespräch/.test(a4.gesprochen), a4.gesprochen);
  pruefe("Die Rueckfrage von beleg-erstellen bleibt stehen",
    /raussenden/i.test(a4.gesprochen), a4.gesprochen);

  // --- Vorlesbarkeit. Das hier ist kein Schoenheitspreis: Am 19.08. wurde ein
  //     ganzes Angebot am Stueck vorgelesen, mit Spiegelstrichen.
  pruefe("Kein Spiegelstrich im Sprechtext", !/[·•]|^\s*-\s/m.test(a4.gesprochen), a4.gesprochen);
  pruefe("Keine Zeilenumbrueche im Sprechtext", !/\n/.test(a4.gesprochen), a4.gesprochen);
  pruefe("Echte Umlaute, kein ae/oe/ue",
    !/\b\w*(ae|oe|ue)\w*\b/.test(a4.gesprochen.replace(/[A-ZÄÖÜ][a-zäöüß]*(?:er|en)\b/g, "")) ||
    !/gespraech|angebot fuer|naechste/i.test(a4.gesprochen), a4.gesprochen);
  pruefe("Der Sprechtext bleibt kurz", a4.gesprochen.length <= 320,
    a4.gesprochen.length + " Zeichen: " + a4.gesprochen);
  pruefe("Der Chat darf mehr zeigen als die Stimme sagt",
    a4.reply.length > a4.gesprochen.length - 40);

  // === 10. Material ja, Preis nein =========================================
  //
  // Kein Angebot mit geratener Zahl — aber auch keine nackte Rueckfrage: Die
  // Auswertung steht schon, ein Satz von Lukas reicht.
  VERLAUF = [{ art: "anruf", zeit: "2026-08-17T13:16:22.024Z",
    text: "Erstgespräch gebucht — Herr Albonni · Will eine neue Webseite, Schwerpunkt Mitarbeitergewinnung, über Preis noch nicht gesprochen" }];
  ANTWORT = {
    verwertbar: true,
    leistung: "Neue Website für Elektro Albonni mit Schwerpunkt auf Mitarbeitergewinnung. Über den Preis wurde noch nicht gesprochen.",
    kernpunkte: ["neue Website", "Mitarbeitergewinnung"],
    preis: null, sparte: "Website",
  };
  BELEG = null;
  const a5 = await g.ausGespraech({ firma: "Elektro Albonni" });
  pruefe("Ohne Preis wird nichts angelegt", BELEG === null, JSON.stringify(BELEG));
  pruefe("Aber die Auswertung wird trotzdem geliefert",
    /Mitarbeitergewinnung/i.test(a5.gesprochen), a5.gesprochen);
  pruefe("Und genau nach der Zahl gefragt", /Preis steht nirgends/i.test(a5.gesprochen), a5.gesprochen);

  // Sagt Lukas die Zahl im selben Satz, laeuft es durch.
  BELEG = null;
  const a6 = await g.ausGespraech({ firma: "Elektro Albonni", betrag: 1500 });
  pruefe("Mit genannter Zahl entsteht das Angebot", BELEG?.betrag === 1500, JSON.stringify(BELEG?.betrag));
  pruefe("Dann wird die Herkunft nicht dazugesagt",
    !/aus dem Gespräch|aus der Kundenakte/.test(a6.gesprochen), a6.gesprochen);

  // === 11. Ein erfundener Modellpreis darf nicht durchkommen ===============
  VERLAUF = [{ art: "anruf", zeit: "2026-08-17T13:16:22.024Z",
    text: "Erstgespräch gebucht — Herr Albonni · Will eine neue Webseite, über Preis noch nicht gesprochen" }];
  ANTWORT = {
    verwertbar: true, leistung: "Neue Website für Elektro Albonni, Schwerpunkt Kundengewinnung im Landkreis.",
    kernpunkte: ["neue Website"], preis: 1200, sparte: "Website",
  };
  BELEG = null;
  const a7 = await g.ausGespraech({ firma: "Elektro Albonni" });
  pruefe("Eine Zahl, die nirgends steht, wird verworfen", BELEG === null, JSON.stringify(BELEG));
  pruefe("Und stattdessen danach gefragt", /Preis steht nirgends/i.test(a7.gesprochen), a7.gesprochen);

  // === 12. Nur auswerten, nichts erzeugen =================================
  VERLAUF = ALBONNI_VERLAUF;
  ANTWORT = {
    verwertbar: true, leistung: "Neue Website für den Elektrobetrieb Albonni, Demo-Seite vorab.",
    kernpunkte: ["neue Website", "Demo-Seite vorab"], preis: 500, sparte: "Website",
  };
  BELEG = null;
  const a8 = await g.ausGespraech({ firma: "Elektro Albonni", nur_auswerten: true });
  pruefe("Nur auswerten legt nichts an", BELEG === null);
  pruefe("Sagt aber, was drinsteht", /Demo-Seite/i.test(a8.gesprochen), a8.gesprochen);
  pruefe("Und bietet den naechsten Schritt an", /Angebot machen/i.test(a8.gesprochen), a8.gesprochen);

  // === 13. Faellt das Modell aus, geht es trotzdem weiter =================
  //
  // Morgen wird gedreht. Ein Werkzeug, das bei einem Modellausfall stumm
  // bleibt, ist in der Aufnahme schlimmer als eines, das die Rohnotiz
  // weiterreicht — angebot-text.js kann daraus immer noch ein Angebot bauen.
  ANTWORT = "wirf";
  BELEG = null;
  const a9 = await g.ausGespraech({ firma: "Elektro Albonni" });
  pruefe("Ohne Modell entsteht trotzdem ein Angebot", BELEG?.betrag === 500, JSON.stringify(BELEG?.betrag));
  pruefe("Und die Rohnotiz traegt die Leistung",
    /Demo-Seite/.test(String(BELEG?.leistung || "")), BELEG?.leistung);
  pruefe("Gesprochen wird auch dann etwas", Boolean(a9.gesprochen && a9.gesprochen.length > 20));

  // === 14. Ohne Firma im Satz darf gefragt werden =========================
  const a10 = await g.ausGespraech({});
  pruefe("Ohne genannte Firma ist die Rueckfrage richtig",
    /welcher Firma/i.test(a10.gesprochen), a10.gesprochen);

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
