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
function ordnungsWort(n) {
  n = Number(n);
  const sonder = { 1: "erster", 3: "dritter", 7: "siebter", 8: "achter" };
  if (sonder[n]) return sonder[n];
  const g = zahlWort(n, "ein");
  return n < 20 ? g + "ter" : g + "ster";
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
function fuerStimme(text) {
  if (!text) return "";
  let t = String(text);

  // ISO-Datum: 2026-07-21 -> "einundzwanzigster Juli"
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, j, m, tg) => {
    const monat = MONATE[Number(m)] || m;
    return `${ordnungsWort(Number(tg))} ${monat}`;
  });

  // Zeitspanne: 08:00-09:30 -> "acht Uhr bis neun Uhr dreißig"
  t = t.replace(/\b(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\b/g,
    (_, h1, m1, h2, m2) => `${uhrzeit(h1, m1)} bis ${uhrzeit(h2, m2)}`);

  // Einzelne Uhrzeit, mit oder ohne "Uhr" dahinter
  t = t.replace(/\b(\d{1,2}):(\d{2})(\s*Uhr)?/g, (_, h, m) => uhrzeit(h, m));

  // Datum deutsch: 21.07. oder 21.07.2026 -> "einundzwanzigster Juli"
  t = t.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})?/g, (_, tg, m) => {
    const monat = MONATE[Number(m)];
    return monat ? `${ordnungsWort(Number(tg))} ${monat}` : _;
  });

  // Waehrung: "34.500 EUR" / "2.000 €" -> ausgeschrieben + "Euro"
  t = t.replace(/([\d.]+)(?:,(\d{1,2}))?\s*(?:EUR|€|Euro)\b/gi, (_, ganz, cent) => {
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
