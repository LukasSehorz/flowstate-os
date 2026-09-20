// Merkt das OS selbst, wenn es kaputt ist?
//
// Anlass (07.08.2026): Der ElevenLabs-Schluessel wurde am 05.08. um 23:16 Uhr
// ungueltig — der Anbieter hatte das Format umgestellt. Alexandra konnte ab da
// weder hoeren noch sprechen. Gemerkt hat es niemand, bis Lukas zwei Tage
// spaeter selbst "Hey Alexandra" sagte und der orange Kreis sich endlos drehte.
//
// Der Waechter lief die ganze Zeit. Er prueft stille Leads und faellige
// Wiedervorlagen — nur nicht, ob das System ueberhaupt noch arbeitsfaehig ist.
//
// ZWEI WEGE, absichtlich:
//
//   1. AUS DEM PROTOKOLL (kostenlos, sofort). Jeder Hoer- und Sprechversuch
//      steht im Sprachlog mit ok/Fehler. Scheitert etwas im echten Betrieb,
//      steht es dort in derselben Sekunde. Das haette den Ausfall am 06.08. um
//      00:16 gemeldet statt am 07.08. um 12:24.
//
//   2. AKTIV NACHFRAGEN (einmal taeglich). Wird tagelang nicht gesprochen,
//      steht auch nichts im Protokoll — dann faellt ein toter Zugang nicht auf.
//      Darum einmal am Tag ein echter Aufruf. Bewusst SELTEN: Ein Sprechtest
//      verbraucht Guthaben, und ein Waechter, der Geld kostet, wird abgeschaltet.
//
// GEMELDET WIRD PER TELEGRAM, NIE PER STIMME. Eine kaputte Stimme kann sich
// nicht per Stimme melden — das ist kein Detail, sondern der ganze Punkt.
//
// EINMAL MELDEN, NICHT ALLE 20 MINUTEN. Ein Alarm, der sich wiederholt, wird
// weggewischt. Gemeldet wird der Wechsel: kaputt -> Meldung, wieder heil ->
// Entwarnung. Dazwischen Ruhe.

const fs = require("fs");
const path = require("path");

const DATA = process.env.DATA_PATH || "/data";
const MERK = path.join(DATA, "selbsttest.json");
const LOG = path.join(DATA, "sprachlog");

// Wie weit zurueck das Protokoll gelesen wird. Grosszuegiger als der Takt des
// Waechters (20 Min), damit zwischen zwei Laeufen nichts durchrutscht.
const FENSTER_MIN = 45;

const berlinTag = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

function standLaden() {
  try { return JSON.parse(fs.readFileSync(MERK, "utf-8")); } catch { return { kaputt: {}, aktivAm: null }; }
}
function standSpeichern(s) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(MERK, JSON.stringify(s)); } catch { /* egal */ }
}

// --- Weg 1: was im echten Betrieb schiefging ------------------------------
//
// Interessant sind nur Fehler, die auf einen kaputten ZUGANG deuten. Ein
// einzelner Netzhaenger ist kein Grund, jemanden zu wecken.
const ZUGANG_KAPUTT = /invalid_api_key|authentication_error|unauthorized|401|403|missing the permission|api key/i;

// GUTHABEN LEER — eigener Fall, nicht bloss ein Zugangsfehler (20.08.2026).
//
// In der Nacht vor den Werbeaufnahmen war das Anthropic-Guthaben um 02:32 Uhr
// aufgebraucht. Die Antwort der Schnittstelle:
//
//   HTTP 400 {"type":"invalid_request_error",
//             "message":"Your credit balance is too low to access the Anthropic API."}
//
// Der Waechter oben hat das NICHT gesehen: kein 401, kein 403, kein "api key".
// Ein 400 gilt sonst als eigener Fehler ("die Anfrage war falsch") und wird
// bewusst nicht gemeldet, damit nicht jeder Ausrutscher jemanden weckt.
//
// Die Folge war der gefaehrlichste Ausfall, den dieses System kennt: Alexandra
// antwortete auf JEDE Frage in 0,4 bis 0,8 Sekunden mit "Mach ich — ich setz
// mich dran" und lieferte nie etwas nach. Schnell, souveraen, vollstaendig
// nutzlos. Vor einer Kamera sieht das aus wie Arbeit.
//
// Deshalb ein EIGENER Teil "guthaben" statt einer Erweiterung von
// ZUGANG_KAPUTT: Die Ursache ist eine andere (niemand muss einen Schluessel
// suchen, es muss Geld aufgeladen werden), und die Meldung muss das sagen.
const GUTHABEN_LEER =
  /credit balance is too low|insufficient[_ ]quota|billing[_ ]hard[_ ]limit|quota exceeded|exceeded[^.]{0,30}quota/i;

// Welcher Teil ist betroffen? Guthaben schlaegt Zugang — wer kein Geld mehr
// hat, hat auch keinen funktionierenden Zugang, aber der Grund ist das Geld.
function teilAus(text) {
  if (GUTHABEN_LEER.test(text)) return "guthaben";
  if (ZUGANG_KAPUTT.test(text)) return "zugang";
  return null;
}

function ausProtokoll() {
  const funde = [];
  try {
    const datei = path.join(LOG, berlinTag() + ".jsonl");
    if (!fs.existsSync(datei)) return funde;
    const ab = Date.now() - FENSTER_MIN * 60 * 1000;
    const zeilen = fs.readFileSync(datei, "utf-8").trim().split("\n");
    // Von hinten lesen: die juengsten Eintraege stehen am Ende, und bei einem
    // langen Tag sind das ein paar hundert Zeilen, die niemand braucht.
    for (let i = zeilen.length - 1; i >= 0 && i > zeilen.length - 400; i--) {
      let e; try { e = JSON.parse(zeilen[i]); } catch { continue; }
      if (!e || new Date(e.zeit).getTime() < ab) break;
      // Der Grund steht je nach Eintragsart in "hint" ODER in der Diagnose des
      // Verstehens (dort landet der Fehler, wenn die Reserve einsprang) — und
      // genau dort stand der Guthaben-Fehler, waehrend "hint" leer blieb.
      const text = String(e.hint || e.verstehen?.fehler || e.fehler || "");
      if (!text) continue;
      if (e.ok !== false && !e.verstehen?.reserve && !e.fehler) continue;
      const art = teilAus(text);
      if (!art) continue;
      // Guthaben ist immer der Modellzugang, egal aus welchem Eintrag es kommt.
      const was = art === "guthaben" ? "guthaben"
        : e.art === "hoeren" ? "hoeren" : e.art === "stimme" ? "stimme" : e.art;
      funde.push({ teil: was, text: text.slice(0, 160) });
    }
  } catch { /* ein unlesbares Protokoll darf den Waechter nicht umwerfen */ }
  // Je Teil nur der juengste Fund — zehnmal derselbe Fehler ist eine Meldung.
  const proTeil = new Map();
  for (const f of funde) if (!proTeil.has(f.teil)) proTeil.set(f.teil, f);
  return [...proTeil.values()];
}

// --- Weg 2: einmal am Tag wirklich anfassen -------------------------------
async function aktivPruefen() {
  const funde = [];

  // Datenbank
  try {
    const crm = require("./crm.js");
    await crm.system("select 1");
  } catch (e) {
    funde.push({ teil: "datenbank", text: String(e.message).slice(0, 160) });
  }

  // Die Sprechen-Pruefung (ElevenLabs-Stimme) ist am 19.09.2026 mit dem Sprachbereich entfernt worden.

  // Modellzugang. Geprueft wird der ZUGANG, nicht die Antwortqualitaet.
  //
  // Erster Entwurf stand auf maxTokens 5 und meldete prompt "Der Modellzugang
  // ist tot — leere Antwort (max_tokens)". Der Schluessel war tadellos, das
  // Modell hatte nur keinen Platz zum Antworten. Ein Waechter, der falschen
  // Alarm schlaegt, wird nach dem zweiten Mal ignoriert — dann haette man ihn
  // auch weglassen koennen.
  //
  // Darum: genug Platz, UND nur echte Zugangsfehler zaehlen. Ein Timeout oder
  // eine leere Antwort heisst "gerade langsam", nicht "Schluessel weg".
  if (process.env.SCHNELL_API_KEY) {
    try {
      const schnell = require("./schnell.js");
      await schnell.frage("Antworte mit OK.", "OK?", { maxTokens: 32, timeoutMs: 12000 });
    } catch (e) {
      const m = String(e.message);
      // Leeres Guthaben zuerst: Es kommt als HTTP 400 und faellt sonst durch
      // jedes Raster, weil 400 fuer "die Anfrage war falsch" reserviert ist.
      if (GUTHABEN_LEER.test(m)) funde.push({ teil: "guthaben", text: m.slice(0, 160) });
      else if (ZUGANG_KAPUTT.test(m)) funde.push({ teil: "modell", text: m.slice(0, 160) });
    }
  }

  return funde;
}

// Zwei Formulierungen je Teil: die Stoerung und die Entwarnung. Mit nur einer
// stand in der Entwarnung "Alexandra spricht nicht: geht wieder" — ein Satz,
// der sich selbst widerspricht und den man zweimal lesen muss.
const NAME = {
  hoeren: "Alexandra hört nicht", stimme: "Alexandra spricht nicht",
  datenbank: "Die Datenbank antwortet nicht", modell: "Der Modellzugang ist tot",
  // Beim Guthaben steht ausnahmsweise DIE HANDLUNG im Namen, nicht der Zustand.
  // Wer das um halb drei nachts auf dem Handy liest, soll nicht erst überlegen
  // müssen, was zu tun ist.
  guthaben: "GUTHABEN AUFGEBRAUCHT — bitte aufladen. Alexandra sagt bis dahin zu allem zu und liefert nichts",
};
const HEIL = {
  hoeren: "Hören geht wieder", stimme: "Sprechen geht wieder",
  datenbank: "Die Datenbank ist wieder da", modell: "Der Modellzugang steht wieder",
  guthaben: "Guthaben ist wieder da — Alexandra arbeitet normal",
};

// ---------------------------------------------------------------- Hauptlauf
//
// Liefert den Text, der per Telegram rausgeht — oder "" wenn alles beim Alten
// ist. Der Aufrufer entscheidet ueber das Senden.
async function pruefe({ aktivErzwingen = false } = {}) {
  const stand = standLaden();
  const heute = berlinTag();

  const funde = [...ausProtokoll()];
  // Aktiv nur einmal taeglich — oder auf Ansage (Test von Hand).
  if (aktivErzwingen || stand.aktivAm !== heute) {
    funde.push(...(await aktivPruefen()));
    stand.aktivAm = heute;
  }

  const kaputtJetzt = {};
  for (const f of funde) kaputtJetzt[f.teil] = f.text;

  const neuKaputt = Object.keys(kaputtJetzt).filter((t) => !stand.kaputt[t]);
  const wiederHeil = Object.keys(stand.kaputt || {}).filter((t) => !kaputtJetzt[t]);

  stand.kaputt = kaputtJetzt;
  standSpeichern(stand);

  const teile = [];
  for (const t of neuKaputt) {
    teile.push(`⚠️ ${NAME[t] || t} — ${kaputtJetzt[t]}`);
  }
  for (const t of wiederHeil) {
    teile.push(`✅ ${HEIL[t] || `${t}: wieder in Ordnung`}.`);
  }
  if (!teile.length) return { text: "", kaputt: Object.keys(kaputtJetzt) };

  const kopf = neuKaputt.length ? "Selbsttest: da stimmt was nicht.\n\n" : "Selbsttest:\n\n";
  return { text: kopf + teile.join("\n"), kaputt: Object.keys(kaputtJetzt), neuKaputt, wiederHeil };
}

// GUTHABEN_LEER wird auch anderswo gebraucht: Die Sprachroute muss beim
// Einspringen der Reserve unterscheiden koennen, ob es sich ueberhaupt lohnt.
module.exports = { pruefe, ausProtokoll, aktivPruefen, GUTHABEN_LEER, teilAus };
