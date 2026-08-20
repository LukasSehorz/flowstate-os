// Ziffern einzeln — fuer Nummern, die man mitschreibt (Belegnummern), nicht
// fuer Mengen. "null zwei fuenf" kann man notieren, "fuenfundzwanzig" nicht,
// wenn in Wahrheit 025 dasteht.
const ZIFFERN = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"];

// Text fuer die Stimme aufbereiten.
//
// Anlass: "Morgen um 11:00 Uhr" wurde mal als "elf Uhr", mal als "elf null null"
// gesprochen — dieselbe Frage, zwei Ergebnisse. Ziffern, Abkuerzungen und
// Waehrungszeichen sind fuer ein Sprachmodell mehrdeutig; es raet.
//
// Statt auf ein besseres Stimmmodell zu hoffen, nehmen wir ihm das Raten ab:
// Was gesprochen wird, steht vorher als Wort da. Das wirkt unabhaengig vom
// Modell und kostet nichts.
//
// Bewusst NICHT behandelt: englische Begriffe (Call, Lead, Deal). Die gehoeren
// in ein Aussprache-Woerterbuch bei ElevenLabs, weil die richtige Aussprache
// dort hinterlegt und nicht erraten werden muss.

const EINER = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"];
const ZEHN = ["zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
const ZEHNER = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];
const MONATE = ["", "Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
  "August", "September", "Oktober", "November", "Dezember"];

// "ein" statt "eins" in Zusammensetzungen: einundzwanzig, eintausend.
function zahlWort(n, einsForm = "eins") {
  n = Number(n);
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return "minus " + zahlWort(-n, einsForm);
  if (n === 1) return einsForm;
  if (n < 10) return EINER[n];
  if (n < 20) return ZEHN[n - 10];
  if (n < 100) {
    const z = Math.floor(n / 10), e = n % 10;
    return e ? `${e === 1 ? "ein" : EINER[e]}und${ZEHNER[z]}` : ZEHNER[z];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100), r = n % 100;
    return `${h === 1 ? "ein" : EINER[h]}hundert${r ? zahlWort(r) : ""}`;
  }
  if (n < 1000000) {
    const t = Math.floor(n / 1000), r = n % 1000;
    return `${zahlWort(t, "ein")}tausend${r ? zahlWort(r) : ""}`;
  }
  if (n < 1000000000) {
    const m = Math.floor(n / 1000000), r = n % 1000000;
    return `${m === 1 ? "eine Million" : zahlWort(m) + " Millionen"}${r ? " " + zahlWort(r) : ""}`;
  }
  return String(n);
}

// Ordnungszahl fuer Datumsangaben: 1 -> "erster", 21 -> "einundzwanzigster".
// gebeugt = nach "am", "vom", "seit" … steht der Tag im Dativ: "am zwoelfTEN
// August", nicht "am zwoelfTER August" (07.08.2026). Die Endung ist eine
// Kleinigkeit auf dem Papier und im Ohr der Unterschied zwischen einem Satz
// und einem Formular — Lukas' Rueckmeldung war "hoert sich nicht an wie ein
// echter Mensch", und das hier war einer der Gruende.
function ordnungsWort(n, gebeugt = false) {
  n = Number(n);
  const e = gebeugt ? "n" : "r";
  const sonder = { 1: "erste", 3: "dritte", 7: "siebte", 8: "achte" };
  if (sonder[n]) return sonder[n] + e;
  const g = zahlWort(n, "ein");
  return (n < 20 ? g + "te" : g + "ste") + e;
}

function uhrzeit(stunde, minute) {
  const s = zahlWort(Number(stunde), "ein");
  const m = Number(minute);
  if (m === 0) return `${s} Uhr`;
  if (m === 30) return `${s} Uhr dreißig`;
  return `${s} Uhr ${zahlWort(m)}`;
}

// Reihenfolge zaehlt: Spezielleres zuerst, sonst zerlegt die allgemeine
// Zahlregel Uhrzeiten und Datumsangaben, bevor sie erkannt werden.
// UMLAUTE, DIE ALS ae/oe/ue GESCHRIEBEN WURDEN (07.08.2026).
//
// Der Code dieses Projekts schreibt Umlaute in Kommentaren und Bezeichnern
// bewusst als ae/oe/ue. Wenn so ein Wort versehentlich in einen GESPROCHENEN
// Text rutscht, buchstabiert die Stimme es: aus "5 Deals weitergerueckt" wurde
// hoerbar "weiter-ge-ru-eckt", aus "ueberfaellig" ein "u-e-ber-fa-ellig".
// Genau das ist Lukas am 07.08. aufgefallen ("hoert sich nicht an wie ein
// echter Mensch") — die Zahlen selbst waren da laengst richtig.
//
// Bewusst eine WORTLISTE und keine Regel ue->ü: "neue", "Feuer", "Steuer" und
// "heute" tragen dieselbe Buchstabenfolge. Eine allgemeine Ersetzung machte
// aus "neue Firmen" ein "nü Firmen" — schlimmer als das Problem.
//
// Die Liste ist die letzte Rettung, nicht die Loesung: Wer einen gesprochenen
// Text schreibt, schreibt ihn mit richtigen Umlauten. Hier landet nur, was
// trotzdem durchkommt.
const UMLAUT_WORTE = {
  weitergerueckt: "weitergerückt", ueberfaellig: "überfällig", ueberfaellige: "überfällige",
  Erstgespraech: "Erstgespräch", Erstgespraeche: "Erstgespräche", Erstgespraechen: "Erstgesprächen",
  naechster: "nächster", naechste: "nächste", naechsten: "nächsten",
  faellig: "fällig", faellige: "fällige", zurueck: "zurück", ueber: "über", fuer: "für",
  waehlen: "wählen", gehoert: "gehört", moeglich: "möglich", noetig: "nötig",
  Aenderung: "Änderung", Aenderungen: "Änderungen", Uebergabe: "Übergabe",
  Umsaetze: "Umsätze", Auftraege: "Aufträge", Vorschlaege: "Vorschläge",
};
const UMLAUT_MUSTER = new RegExp("\\b(" + Object.keys(UMLAUT_WORTE).join("|") + ")\\b", "g");

function fuerStimme(text) {
  if (!text) return "";
  let t = String(text);

  // Zuerst: was als ae/oe/ue geschrieben wurde, wieder lesbar machen.
  t = t.replace(UMLAUT_MUSTER, (w) => UMLAUT_WORTE[w] || w);

  // ISO-Datum: 2026-07-21 -> "einundzwanzigster Juli"
  t = t.replace(/(\b(?:am|vom|zum|seit|bis|ab)\s+)?\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, vor, j, m, tg) => {
    const monat = MONATE[Number(m)] || m;
    return `${vor || ""}${ordnungsWort(Number(tg), Boolean(vor))} ${monat}`;
  });

  // Zeitspanne: 08:00-09:30 -> "acht Uhr bis neun Uhr dreißig"
  t = t.replace(/\b(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\b/g,
    (_, h1, m1, h2, m2) => `${uhrzeit(h1, m1)} bis ${uhrzeit(h2, m2)}`);

  // Einzelne Uhrzeit, mit oder ohne "Uhr" dahinter
  t = t.replace(/\b(\d{1,2}):(\d{2})(\s*Uhr)?/g, (_, h, m) => uhrzeit(h, m));

  // Tag mit ausgeschriebenem Monat: "20. August" -> "zwanzigsten August".
  // Fehlte bis 19.08. ganz. Uebrig blieb die nackte Zahl mit Punkt, aus der
  // die allgemeine Zahlregel weiter unten "zwanzig. August" machte — im
  // Gespraech deutlich zu hoeren. Steht VOR der numerischen Datumsregel,
  // sonst frisst die den Tag weg.
  //
  // Der zweite Fall ist "Donnerstag, 20. August": Dort steht kein "am"
  // davor, die Beugung ist aber trotzdem die schwache ("zwanzigsten").
  // Deshalb wird hier immer gebeugt, wenn ein Monatsname folgt.
  t = t.replace(/\b(\d{1,2})\.\s+(Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/g,
    (_, tg, monat) => `${ordnungsWort(Number(tg), true)} ${monat.replace("Maerz", "März")}`);

  // Belegnummern wie "2026-025" oder "RE-2026-014". Ohne eigene Regel machte
  // die Zahlregel daraus "2026-fuenfundzwanzig" — eine Nummer, die niemand
  // mitschreiben kann. Der Jahresteil bleibt als Jahr stehen, der laufende
  // Teil wird Ziffer fuer Ziffer gesprochen.
  t = t.replace(/\b(\d{4})-(\d{2,4})\b(?!-)/g, (_, jahr, nr) =>
    `${jahr} ${nr.split("").map((z) => ZIFFERN[Number(z)]).join(" ")}`);

  // Datum deutsch: 21.07. oder 21.07.2026 -> "einundzwanzigster Juli"
  t = t.replace(/(\b(?:am|vom|zum|seit|bis|ab)\s+)?\b(\d{1,2})\.(\d{1,2})\.(\d{4})?/g, (_, vor, tg, m) => {
    const monat = MONATE[Number(m)];
    return monat ? `${vor || ""}${ordnungsWort(Number(tg), Boolean(vor))} ${monat}` : _;
  });

  // Waehrung: "34.500 EUR" / "2.000 €" -> ausgeschrieben + "Euro"
  //
  // Das \b hinter der Waehrung ist am 19.08. entfallen, und das war ein
  // echter Fehler: Eine Wortgrenze verlangt den Uebergang Wort/Nicht-Wort.
  // Auf "€" folgt aber fast immer ein Komma, ein Punkt oder das Zeilenende —
  // alles Nicht-Wortzeichen, also KEINE Wortgrenze. Die Regel griff damit
  // genau dann nicht, wenn der Betrag am Satzende stand. Danach zerlegten die
  // allgemeinen Zahlregeln ihn: aus "4.000,00 €" wurde "viertausend,null €",
  // und das Waehrungszeichen blieb stumm stehen. Im Gespraech vom 19.08. war
  // das der auffaelligste Patzer.
  // Jetzt: negative Vorschau auf Buchstaben — "€" und "EURO-Krise" bleiben
  // unterscheidbar, ein "€," wird aber erfasst.
  t = t.replace(/([\d.]+)(?:,(\d{1,2}))?\s*(?:EUR|€|Euro)(?![\wäöüßÄÖÜ])/gi, (_, ganz, cent) => {
    const n = Number(String(ganz).replace(/\./g, ""));
    if (!Number.isFinite(n)) return _;
    const kopf = `${zahlWort(n, "ein")} Euro`;
    return cent && Number(cent) ? `${kopf} ${zahlWort(Number(cent))}` : kopf;
  });

  // Prozent
  t = t.replace(/\b([\d.]+)(?:,(\d+))?\s*%/g, (_, ganz, komma) => {
    const n = Number(String(ganz).replace(/\./g, ""));
    if (!Number.isFinite(n)) return _;
    return komma ? `${zahlWort(n)} Komma ${zahlWort(Number(komma))} Prozent` : `${zahlWort(n)} Prozent`;
  });

  // Abkuerzungen
  t = t
    .replace(/\bMin\.(?=\s|$)/g, "Minuten")
    .replace(/\bStd\.(?=\s|$)/g, "Stunden")
    .replace(/\bca\.\s*/g, "circa ")
    .replace(/\bbzw\./g, "beziehungsweise")
    .replace(/\bz\.\s?B\./g, "zum Beispiel")
    .replace(/\binkl\./g, "inklusive")
    .replace(/\bNr\.\s*/g, "Nummer ")
    .replace(/\bggf\./g, "gegebenenfalls")
    .replace(/\bu\.\s?a\./g, "unter anderem");

  // Punkt als Tausendertrenner: 34.500 -> vierunddreissigtausendfuenfhundert
  t = t.replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (_, z) => {
    const n = Number(z.replace(/\./g, ""));
    return Number.isFinite(n) ? zahlWort(n) : _;
  });

  // Dezimalzahlen OHNE Einheit (20.08.2026). Prozent und Euro hatten ihre
  // eigenen Regeln weiter oben; eine nackte Kommazahl fiel durch beide und
  // wurde von der Zahlregel darunter zerlegt: "25977,67 Punkte" sprach sie
  // als "25977,siebenundsechzig". Aufgefallen beim Bau der Websuche am
  // DAX-Stand, betrifft aber jede Zahl ohne Einheit — Kilometer, Grad, Tore.
  t = t.replace(/\b(\d{1,3}(?:\.\d{3})*|\d+),(\d{1,2})\b(?!\s*(?:%|€|EUR|Euro))/gi, (_, ganz, komma) => {
    const n = Number(String(ganz).replace(/\./g, ""));
    if (!Number.isFinite(n)) return _;
    return `${zahlWort(n)} Komma ${zahlWort(Number(komma))}`;
  });

  // Ordnungszahl OHNE folgenden Monatsnamen: "am 34. Spieltag", "der 3. Platz".
  // Die Regel weiter oben greift nur vor Monatsnamen; hier blieb die nackte
  // Zahl mit Punkt stehen, und die Zahlregel darunter machte "vierunddreissig."
  // daraus. Nur nach einer Praeposition oder einem Artikel, damit ein
  // Satzende ("Es waren 34.") nicht faelschlich gebeugt wird.
  // Das i-Flag ist noetig, weil ein Satz mit "Am 34. Spieltag" beginnen kann —
  // ohne es blieb genau dieser Fall stehen und wurde "Am vierunddreissig.".
  t = t.replace(/\b(am|vom|zum|zur|seit|bis|ab|der|die|das|den|dem|ein|eine|einem|einen)\s+(\d{1,3})\.\s+(?=[A-ZÄÖÜa-zäöü])/gi,
    (_, wort, zahl) => `${wort} ${ordnungsWort(Number(zahl), true)} `);

  // Uebrige Zahlen. Jahreszahlen bleiben stehen — "zweitausendsechsundzwanzig"
  // ist umstaendlicher als "2026", das jede Stimme richtig liest.
  t = t.replace(/\b(\d{1,4})\b/g, (_, z) => {
    const n = Number(z);
    if (n >= 1900 && n <= 2100) return _;
    return zahlWort(n);
  });

  // Reste, die beim Sprechen stoeren
  t = t
    .replace(/[*_`#]/g, "")
    .replace(/\s*·\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return t;
}

module.exports = { fuerStimme, zahlWort, ordnungsWort, uhrzeit };
