// Rechnung per Telegram schicken — auslesen, ablegen, buchen.
//
// Warum (Lukas, 07.08.2026): "Ein Agent, der zum Beispiel automatisch, wenn ich
// auf Telegram eine Rechnung schicke, das auswertet, ablegt und das System
// abbucht."
//
// KEIN AGENT — eine bekannte Abfolge. Datei holen, ablegen, auslesen,
// bestaetigen, buchen. Fuenf Schritte, immer dieselben, jeder kann einzeln
// scheitern und einzeln wiederholt werden. Ein Agent wuerde hier nur Sekunden
// und Ausfallwahrscheinlichkeit hinzufuegen (gemessen an Hermes: 43 % Fehler,
// Median 142 s) — ohne dass er etwas koennte, was diese fuenf Aufrufe nicht tun.
//
// DIE STUECKE GAB ES SCHON, sie waren nur nie verbunden:
//   lib/belegleser.js       liest Betrag, Datum, Lieferant, Kategorie
//   /buchhaltung/beleg/*    legt ab, liest aus, bucht
//   lib/telegram.js         empfaengt — warf Fotos und PDFs aber weg
//     ("if (!text.trim()) return" — eine Rechnung ohne Bildunterschrift
//      landete im Nichts)
//
// Angesprochen werden die HTTP-Endpunkte, nicht die Bibliothek direkt: Die
// Buchhaltung arbeitet mit Zeilenrechten (alsNutzer), und Telegram hat ueber
// dash() ohnehin schon eine angemeldete Sitzung. Der direkte Bibliotheksweg
// haette einen zweiten, rechtefreien Zugang geschaffen — genau das, was man in
// einer Buchhaltung nicht will.
//
// GEBUCHT WIRD NICHT VON SELBST. Lukas bekommt die gelesenen Werte und
// antwortet "passt" oder korrigiert. Grund steht in belegleser.js: Das Auslesen
// macht einen VORSCHLAG. Ein falsch erkannter Betrag, still gebucht, faellt
// erst beim Steuerberater auf.
//
// NACHGEFRAGT STATT GERATEN (20.08.2026). Bis hierher gab es einen Fall, in dem
// der Ablauf ins Leere lief: Der Leser erkennt den Haendler, aber nicht den
// Betrag — bei einem geknickten Kassenbon der Normalfall. Dann wurde trotzdem
// "Soll ich das so buchen?" gefragt, und auf ein "ja" antwortete die
// Buchhaltung mit "fehler=betrag" (belegBuchen verlangt Betrag UND Datum).
// Lukas hatte dann bestaetigt, nichts war gebucht, und warum, stand nirgends.
//
// Jetzt wird gefragt, was fehlt — erst der Betrag, dann das Datum — und erst
// mit vollstaendigen Werten kommt die Buchungsfrage. Ein falsch erkannter
// Betrag in der Buchhaltung ist schlimmer als eine Rueckfrage; ein
// stillschweigend nicht gebuchter Beleg ist es auch.

const MAX = 20 * 1024 * 1024;   // Telegram gibt Dateien bis 20 MB heraus

// Was gerade auf eine Bestaetigung wartet. Bewusst nur im Arbeitsspeicher:
// Nach einem Neustart ist der Beleg trotzdem abgelegt und im Eingang sichtbar —
// verloren geht nichts, nur die Rueckfrage. Eine Tabelle dafuer waere Aufwand
// fuer einen Zustand, der Sekunden lebt.
let offen = null;

const zahl = (n) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2 });
const euro = (n) => zahl(n) + " Euro";
const datumLang = (d) => {
  if (!d) return "";
  const t = new Date(d);
  return isNaN(t) ? String(d) : t.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
};

// ---------------------------------------------------------- Nachgefragtes
//
// Was Lukas auf "was hat's gekostet?" tippt oder diktiert. BEWUSST STRENG:
// Findet sich keine Zahl, ist es keine Antwort auf die Rueckfrage, sondern eine
// neue Nachricht an Alexandra. Lieber einmal nicht erkennen als aus "sag mal,
// wie war das mit den 3 Terminen" einen Belegbetrag machen.
// JEDE ZAHL WAR EIN BETRAG (Fehler gefunden am 20.08.2026).
//
// Der Kommentar darueber stand schon da — der Code hat sich nicht daran
// gehalten. Er strich die Waehrungswoerter weg und nahm dann die erste Zahl im
// Satz, egal woher sie kam. Gemessen:
//
//   BOT>   Den Betrag konnte ich nicht lesen — was hat's gekostet?
//   LUKAS> sag mal, wie war das mit den 3 Terminen morgen
//   BOT>   Beleg 4711: · EDEKA · 3,00 Euro — Soll ich das so buchen?
//
// Ebenso "von der Tankstelle an der B15" -> 15,00 €, "um 14 Uhr" -> 14,00 €,
// "das waren 8 Euro 50" -> 8,00 € (die Cent fielen weg), "minus 12,00" ->
// 12,00 € (das Vorzeichen fiel weg). Doppelt schlimm: Die Nachricht galt damit
// als beantwortet und erreichte Alexandra nie.
//
// DIE REGEL SEITDEM: Eine Zahl ist nur dann ein Betrag, wenn sie sich als einer
// zu erkennen gibt —
//   · sie traegt ein Geldzeichen (€, EUR, "Euro"), ODER
//   · sie hat Nachkommastellen ("19,90", "68,50"), ODER
//   · der ganze Satz besteht aus hoechstens drei Woertern ("ca. 20 Euro", "42").
// Alles andere ist ein Satz an Alexandra und keine Antwort auf die Rueckfrage.

// Geldzeichen vor der Zahl ("EUR 20", "€19,90") und dahinter ("20 Euro").
const GELD_DAVOR = /(€|\beur|\beuro)\s*$/i;
const GELD_DANACH = /^\s*(€|eur\b|euro\b)/i;
// "acht Euro fuenfzig" tippt Lukas als "8 Euro 50" — die Cent stehen hinter dem
// Waehrungswort, nicht hinter einem Komma. Vorher gingen sie verloren.
const EURO_CENT = /^\s*(?:€|eur\b|euro\b)\s*(\d{1,2})(?!\d)/i;
// Eine Zahl MIT Einheit ist kein Geld. "um 14 Uhr" hat drei Woerter und waere
// sonst durch die Kurzsatz-Regel gerutscht.
const EINHEIT = /^\s*(uhr|grad|prozent|%|km\b|kilometer|meter|liter|kg\b|gramm|minuten?|min\b|stunden?|std\b|tage?|wochen?|monate?|jahre?|termin\w*|aufgab\w*|mails?|nachricht\w*|leute|personen|kunden|st(ü|ue)ck|mal\b|leads?)/i;
// Ein Minus davor: Ein Belegbetrag ist nie negativ. Das Vorzeichen einfach
// wegzuwerfen hiesse, eine Gutschrift als Ausgabe zu buchen — lieber fragen.
const MINUS = /(minus|[-−–])\s*$/i;
// Deutsch: Punkt trennt Tausender, Komma die Cent. "1.234,56" -> 1234.56
// Englisch/Tastatur: "19.90" ohne Tausendergruppe sind 19,90 Euro.
// Der Buchstaben-Blick nach hinten haelt Strassennamen draussen: In "B15" ist
// die 15 keine Zahl fuer sich.
const ZAHL = /(?<![\d.,])(?<![A-Za-zÄÖÜäöüß])(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?(?!\d)/g;

function betragAus(text) {
  const roh = String(text || "");
  const woerter = roh.trim().split(/\s+/).filter(Boolean).length;
  const kurz = woerter > 0 && woerter <= 3;

  ZAHL.lastIndex = 0;
  let m;
  while ((m = ZAHL.exec(roh)) !== null) {
    const vor = roh.slice(0, m.index);
    const nach = roh.slice(m.index + m[0].length);

    if (MINUS.test(vor)) return null;
    if (EINHEIT.test(nach)) continue;

    const hatCent = m[2] !== undefined;
    const hatGeld = GELD_DAVOR.test(vor) || GELD_DANACH.test(nach);
    if (!hatGeld && !hatCent && !kurz) continue;

    const ganz = Number(m[1].replace(/\./g, ""));
    const centText = hatCent ? m[2] : (nach.match(EURO_CENT) || [])[1];
    const cent = centText ? Number(String(centText).padEnd(2, "0")) : 0;
    const n = ganz + cent / 100;
    // Dieselben Grenzen wie im Belegleser: 0 Euro ist eine gueltige Zahl und
    // trotzdem kein Betrag.
    if (!Number.isFinite(n) || n <= 0 || n > 1000000) continue;
    return Math.round(n * 100) / 100;
  }
  return null;
}

const alsTag = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Ein Datum aus der Antwort. "heute" und "gestern" sind erlaubt, weil man den
// Bon meist am selben oder am naechsten Tag fotografiert — beides sagt Lukas
// dann AUSDRUECKLICH. Von selbst auf heute zu raten waere etwas anderes: Das
// haette den Beleg mit einem erfundenen Datum in den falschen Monat gebucht.
function datumAus(text, jetzt = new Date()) {
  const t = String(text || "").toLowerCase();
  if (/\bheute\b/.test(t)) return alsTag(jetzt);
  if (/\bgestern\b/.test(t)) return alsTag(new Date(jetzt.getTime() - 86400000));
  if (/\bvorgestern\b/.test(t)) return alsTag(new Date(jetzt.getTime() - 2 * 86400000));

  const iso = t.match(/(?<!\d)(20\d{2})-(\d{1,2})-(\d{1,2})(?!\d)/);
  const de = t.match(/(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})?(?!\d)/);
  let jahr, monat, tag;
  if (iso) { [, jahr, monat, tag] = iso; }
  else if (de) {
    tag = de[1]; monat = de[2];
    // Ohne Jahresangabe das laufende — und wenn das in der Zukunft laege, das
    // davor. Einen Bon vom 28.12., im Januar hochgeladen, sonst ins neue Jahr
    // zu buchen waere der teuerste stille Fehler hier: falsches Steuerjahr.
    jahr = de[3] ? (de[3].length === 2 ? "20" + de[3] : de[3]) : String(jetzt.getFullYear());
  } else return null;

  const d = new Date(`${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;

  // KEIN UEBERLAUF IN DEN FOLGEMONAT (20.08.2026). datumAus("31.02.2026") gab
  // bisher 2026-03-03 zurueck: Der Date-Konstruktor rechnet einen unmoeglichen
  // Tag stillschweigend weiter. Ein verhoertes Datum ("einunddreissigster
  // Februar") buchte damit in den falschen Monat — und ein falscher Monat ist
  // im Monatsordner fuer die Steuerberaterin genau der Fehler, den niemand
  // mehr findet. Bleiben Tag und Monat nicht, wie sie gesagt wurden, war es
  // kein Datum.
  if (d.getUTCMonth() + 1 !== Number(monat) || d.getUTCDate() !== Number(tag)) return null;

  if (!de?.[3] && !iso && d.getTime() > jetzt.getTime() + 36 * 3600 * 1000) {
    d.setUTCFullYear(d.getUTCFullYear() - 1);
  }
  const jahrZahl = d.getUTCFullYear();
  // Dieselbe Plausibilitaet wie im Belegleser: vor 2015 oder in der Zukunft ist
  // kein Beleg von uns, sondern ein Vertipper.
  if (jahrZahl < 2015 || d.getTime() > jetzt.getTime() + 36 * 3600 * 1000) return null;
  return d.toISOString().slice(0, 10);
}

// Aus einer Telegram-Nachricht die Datei herausziehen — Foto ODER Dokument.
//
// Fotos kommen als Liste in mehreren Aufloesungen; die letzte ist die groesste.
// Wer die erste nimmt, bekommt eine Vorschau von 90 Pixeln, auf der kein Betrag
// zu lesen ist.
function dateiAus(msg) {
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const gross = msg.photo[msg.photo.length - 1];
    return { fileId: gross.file_id, name: "Foto.jpg", typ: "image/jpeg", groesse: gross.file_size || 0 };
  }
  const d = msg.document;
  if (d) {
    return { fileId: d.file_id, name: d.file_name || "Beleg", typ: d.mime_type || null, groesse: d.file_size || 0 };
  }
  return null;
}

// Sieht das nach einem Beleg aus? Telegram bekommt auch Screenshots und Memes.
//
// Bewusst grosszuegig: Lieber einmal zu viel gefragt ("das sieht nicht nach
// einem Beleg aus") als eine echte Rechnung stillschweigend zu verwerfen.
// Ausgeschlossen wird nur, was sicher keiner ist.
const KEIN_BELEG = /\.(zip|exe|dmg|apk|mp4|mov|mp3|ogg|wav|pptx?|xlsx?)$/i;

function koennteBelegSein(datei) {
  if (!datei) return false;
  if (KEIN_BELEG.test(datei.name)) return false;
  const typ = String(datei.typ || "");
  return typ.startsWith("image/") || typ === "application/pdf" || /\.pdf$/i.test(datei.name);
}

// Der Ablauf. dash() und holeDatei() kommen aus telegram.js — dieses Modul
// kennt Telegram nicht selbst, damit es einzeln testbar bleibt.
async function verarbeiten({ datei, holeDatei, dash, sagen }) {
  if (datei.groesse > MAX) {
    return sagen(`Die Datei ist mit ${Math.round(datei.groesse / 1024 / 1024)} MB zu groß — Telegram gibt mir höchstens 20 MB. Schick sie mir als Foto oder kleineres PDF.`);
  }

  await sagen("Schau ich mir an…");

  let daten;
  try { daten = await holeDatei(datei.fileId); }
  catch (e) { return sagen("Die Datei kam nicht durch — schick sie nochmal."); }

  // 1. Ablegen. Ab hier ist der Beleg sicher, auch wenn das Lesen scheitert.
  let ab;
  try {
    const r = await dash("/buchhaltung/beleg/hochladen", daten, {
      "X-Art": "ausgabe",
      "X-Dateiname": encodeURIComponent(datei.name),
      "X-Dateityp": datei.typ || "application/octet-stream",
      // Woher der Beleg kam (Migration 0061) — siehe mail-belege.js.
      "X-Quelle": "telegram",
    });
    ab = await r.json();
  } catch (e) {
    return sagen("Das Ablegen hat gehakt — versuch's gleich nochmal.");
  }
  if (!ab?.ok) return sagen("Konnte den Beleg nicht ablegen" + (ab?.grund ? ` (${ab.grund})` : "") + ".");
  if (ab.doppelt) {
    return sagen(`Den hab ich schon — Beleg Nummer ${ab.laufnummer} liegt bereits im Eingang.`);
  }

  // 2. Auslesen. Schlaegt es fehl, liegt der Beleg trotzdem im Eingang; Lukas
  // traegt die Werte dann im Dashboard nach.
  let werte = null;
  try {
    const r = await dash("/buchhaltung/beleg/lesen", { id: ab.id });
    const d = await r.json();
    if (d?.ok) werte = d.werte || d;
  } catch { /* Vorschlag entfaellt, Beleg bleibt */ }

  if (!werte || (!werte.betrag && !werte.gegenstelle)) {
    offen = null;
    return sagen(`Beleg ${ab.laufnummer} liegt im Eingang — auslesen hat nicht geklappt. Trag die Werte im Dashboard nach, dann ist er gebucht.`);
  }

  offen = { id: ab.id, laufnummer: ab.laufnummer, werte, frage: null,
    zweifel: false, umgerechnet: false };
  return naechsteFrage(sagen);
}

// ------------------------------------------------- Was der Leser selbst sagt
//
// DER LESER WARNT, DIE RUECKFRAGE VERSCHWIEG ES (20.08.2026).
//
// lib/belegleser.js ist ausgezeichnet und vor allem ehrlich: Ist etwas unklar,
// setzt er ein `hinweis`-Feld und stuft `sicherheit` herunter. naechsteFrage()
// hat beides bis heute nicht angefasst. Gemessener Fall:
//
//   Leser: betrag=259.8, hinweis="Betrag in USD (259,80 USD), nicht EUR."
//   Bot:   "· ACME Software Inc. · 259,80 Euro — Soll ich das so buchen?"
//   Nach "ja" gebucht: 259,80 € statt rund 240 €.
//
// Ein Zweifel, den der Leser SELBST anmeldet, ist die wertvollste Information
// im ganzen Ablauf — und war die einzige, die nicht ankam. Seitdem gilt:
// Steht ein Hinweis da oder ist die Sicherheit niedrig, wird NICHT "Soll ich
// das so buchen?" gefragt, sondern der Zweifel genannt.
const WAEHRUNGEN = [
  [/\b(usd|us-?dollar|dollar)\b|\$/i, "US-Dollar"],
  [/\b(chf|franken)\b/i, "Schweizer Franken"],
  [/\b(gbp|pfund|sterling)\b|£/i, "britische Pfund"],
  [/\b(pln|zloty|z[łl]oty)\b/i, "Złoty"],
  [/\b(czk|kronen|kc|k[čc])\b/i, "Kronen"],
];

// Nur was der LESER schreibt, wird hier gelesen — nichts geraten. Sagt sein
// Hinweis, der Betrag stehe in einer fremden Waehrung, darf er nicht als Euro
// vorgelesen werden: "259,80 Euro" ist dann schlicht eine falsche Zahl.
function fremdwaehrung(hinweis) {
  const t = String(hinweis || "");
  if (!t) return null;
  for (const [muster, name] of WAEHRUNGEN) if (muster.test(t)) return name;
  return null;
}

// Was als Naechstes gefragt wird: der fehlende Betrag, das fehlende Datum, die
// fremde Waehrung, sonst die Buchungsfrage. Eine Stelle fuer alle Wege — die
// Rueckfrage nach dem Betrag muendet danach in dieselbe Bestaetigung wie ein
// Beleg, bei dem gleich alles zu lesen war.
function naechsteFrage(sagen) {
  const b = offen;
  if (!b) return;
  const w = b.werte;
  const wer = w.gegenstelle ? ` von ${w.gegenstelle}` : "";

  if (!w.betrag) {
    b.frage = "betrag";
    return sagen(`Beleg ${b.laufnummer}${wer} liegt im Eingang. Den Betrag konnte ich nicht lesen — was hat's gekostet?`);
  }
  if (!w.datum) {
    b.frage = "datum";
    return sagen(`${euro(w.betrag)}${wer} — welches Datum steht auf dem Beleg? Sag „heute“, wenn er von heute ist.`);
  }

  // Fremde Waehrung: gar nicht erst als Euro anbieten.
  const waehrung = b.umgerechnet ? null : fremdwaehrung(w.hinweis);
  if (waehrung) {
    b.frage = "waehrung";
    b.zweifel = true;
    const kopf = [`Beleg ${b.laufnummer}:`, w.gegenstelle || null].filter(Boolean).join(" · ");
    return sagen(`${kopf}\n${w.hinweis}\n\n${zahl(w.betrag)} ${waehrung} — soll ich umrechnen?`);
  }

  // Was der Leser sonst angemerkt hat. Die niedrige Sicherheit bekommt einen
  // eigenen Satz, weil sie ohne Hinweistext sonst gar nicht zur Sprache kaeme.
  const zweifel = w.hinweis
    || (w.sicherheit === "niedrig"
      ? "Der Beleg war schlecht lesbar — Betrag und Datum konnte ich nicht sicher entziffern."
      : "");

  b.frage = "buchen";
  b.zweifel = Boolean(zweifel);
  const zeilen = [
    `Beleg ${b.laufnummer}:`,
    w.gegenstelle ? `${w.gegenstelle}` : null,
    `${euro(w.betrag)}`,
    `vom ${datumLang(w.datum)}`,
    w.kategorie ? `Kategorie ${w.kategorie}` : null,
  ].filter(Boolean);

  if (!zweifel) return sagen(zeilen.join(" · ") + "\n\nSoll ich das so buchen?");
  return sagen(zeilen.join(" · ") + `\n\n${zweifel}\n\nStimmt das so? Dann buch ich — sonst sag mir den richtigen Betrag.`);
}

// Antwort auf die Rueckfrage. Gibt true zurueck, wenn sie hier behandelt wurde —
// dann laeuft sie NICHT zusaetzlich als Frage an Alexandra.
async function antwortAuf(text, { dash, sagen }) {
  if (!offen) return false;
  const t = String(text || "").trim().toLowerCase();

  const nein = /^(nein|ne|nee|nicht|stopp|stop|lass|abbrechen|verwerfen|falsch|weiss nicht|weiß nicht)\b/.test(t);

  // Auf eine Rueckfrage nach Betrag oder Datum ist die Antwort eine ZAHL, kein
  // Ja. Sie wird uebernommen und der Ablauf geht einen Schritt weiter; gebucht
  // wird auch dann erst nach der Bestaetigung am Ende.
  //
  // Findet sich nichts Verwertbares, gibt diese Funktion false zurueck und der
  // Satz laeuft normal an Alexandra. Das ist Absicht: Wer mitten in der
  // Rueckfrage etwas ganz anderes fragt, soll eine Antwort bekommen und nicht
  // "ich brauch den Betrag".
  // Fremde Waehrung. Nennt Lukas den Euro-Betrag, ist der Zweifel ausgeraeumt.
  // Sagt er nur "ja", wird NICHT gerechnet: Einen Wechselkurs hat dieses Modul
  // nicht, und einen zu erfinden waere genau der Fehler, den die ganze
  // Rueckfrage verhindern soll.
  if (offen.frage === "waehrung") {
    const b0 = offen;
    if (nein) {
      offen = null;
      await sagen(`Alles klar, Beleg ${b0.laufnummer} bleibt im Eingang — trag ihn im Dashboard fertig aus.`);
      return true;
    }
    const betrag = betragAus(text);
    if (betrag !== null) {
      b0.werte.betrag = betrag;
      // Der Hinweis ist erledigt, sobald der Euro-Betrag dasteht — sonst
      // stuende er in der naechsten Frage nochmal und verwirrte nur.
      b0.werte.hinweis = "";
      b0.umgerechnet = true;
      await naechsteFrage(sagen);
      return true;
    }
    if (/^(ja|jap|jo|klar|bitte|mach|gerne|ok|okay|rechne)\b/.test(t)) {
      b0.werte.hinweis = "";
      b0.umgerechnet = true;
      b0.frage = "betrag";
      await sagen("Einen Wechselkurs hab ich hier nicht. Sag mir den Euro-Betrag von der Abrechnung, dann buch ich den.");
      return true;
    }
    return false;
  }

  if (offen.frage === "betrag" || offen.frage === "datum") {
    const b0 = offen;
    if (nein) {
      offen = null;
      await sagen(`Alles klar, Beleg ${b0.laufnummer} bleibt im Eingang — trag ihn im Dashboard fertig aus.`);
      return true;
    }
    if (b0.frage === "betrag") {
      const betrag = betragAus(text);
      if (betrag === null) return false;
      b0.werte.betrag = betrag;
      // Was Lukas selbst nennt, sind Euro. Sonst fragte die naechste Runde bei
      // einem Waehrungshinweis "soll ich umrechnen?" — nach einer Zahl, die er
      // gerade in Euro gesagt hat.
      b0.umgerechnet = true;
    } else {
      const datum = datumAus(text);
      if (datum === null) return false;
      b0.werte.datum = datum;
    }
    await naechsteFrage(sagen);
    return true;
  }

  // Nur eindeutige Antworten fangen. Bei allem anderen war es keine Antwort auf
  // die Rueckfrage, sondern eine neue Frage — die gehoert zu Alexandra.
  // Hat der Leser selbst gezweifelt, ist eine genannte Zahl die KORREKTUR und
  // keine neue Frage an Alexandra: "nee, das waren 34,20 Euro". Das steht
  // bewusst VOR der Ja/Nein-Auswertung — sonst gaelte das "nee" am Satzanfang
  // als Abbruch, und der genannte Betrag waere weg. Ohne einen gemeldeten
  // Zweifel greift der Weg nicht: Dort ist jede Zahl wieder nur eine Zahl.
  if (offen.frage === "buchen" && offen.zweifel) {
    const k = betragAus(text);
    if (k !== null) {
      offen.werte.betrag = k;
      offen.werte.hinweis = "";
      offen.werte.sicherheit = "hoch";
      offen.zweifel = false;
      await naechsteFrage(sagen);
      return true;
    }
  }

  const ja = /^(ja|jap|passt|passt so|buchen|buch das|stimmt|korrekt|genau|ok|okay|jo)\b/.test(t);
  if (!ja && !nein) return false;

  const b = offen;
  offen = null;

  if (nein) {
    await sagen(`Alles klar, Beleg ${b.laufnummer} bleibt im Eingang — du kannst ihn im Dashboard prüfen oder verwerfen.`);
    return true;
  }

  try {
    // Der Endpunkt leitet nach dem Buchen auf die Seite um (er ist fuer das
    // Formular gebaut). Eine Weiterleitung IST hier der Erfolg — deshalb wird
    // sie nicht verfolgt, sondern als Ergebnis gelesen.
    const r = await dash("/buchhaltung/beleg/buchen", { id: b.id, ...b.werte });
    const gelungen = r.status === 302 || r.status === 200;
    const ziel = r.headers.get("location") || "";
    if (!gelungen || /fehler=/.test(ziel)) {
      // Den Grund NENNEN. Vorher stand hier nur "hat nicht geklappt", und der
      // haeufigste Grund (Betrag oder Datum fehlt) war damit unsichtbar —
      // dabei ist genau er in einer Nachricht zu beheben.
      const grund = decodeURIComponent((ziel.match(/fehler=([^&]*)/) || [])[1] || "");
      const klartext = { betrag: "der Betrag fehlt", datum: "das Datum fehlt",
        "schon-gebucht": "der ist schon gebucht", verworfen: "der wurde verworfen",
        "nicht-gefunden": "ich finde ihn nicht mehr" }[grund];
      // BEWUSST await statt "return sagen(...) || true": sagen() gibt ein
      // Promise zurueck, und das await im Aufrufer haette daraus undefined
      // gemacht — die Nachricht waere zusaetzlich als Frage an Alexandra
      // gelaufen.
      await sagen(`Das Buchen hat nicht geklappt${klartext ? ` — ${klartext}` : ""}. Beleg ${b.laufnummer} liegt weiter im Eingang.`);
      return true;
    }
    await sagen(/offen=/.test(ziel)
      ? `Gebucht — steht jetzt unter offenen Rechnungen.`
      : `Gebucht. ${b.werte.betrag ? euro(b.werte.betrag) + " " : ""}ist raus aus dem Eingang.`);
  } catch {
    await sagen(`Das Buchen hat gehakt — Beleg ${b.laufnummer} liegt weiter im Eingang.`);
  }
  return true;
}

// Fuer den Fall, dass eine neue Datei kommt, waehrend noch eine Rueckfrage
// offen ist: Die alte verfaellt, sonst bucht ein spaeteres "ja" den falschen.
function vergessen() { offen = null; }

// Nur zum Nachsehen (Test, Protokoll) — nicht zum Verstellen.
const wasOffen = () => (offen ? { laufnummer: offen.laufnummer, frage: offen.frage } : null);

module.exports = { dateiAus, koennteBelegSein, verarbeiten, antwortAuf, vergessen,
  wasOffen, betragAus, datumAus, fremdwaehrung };
