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
      if (e.ok !== false || !e.hint) continue;
      if (!ZUGANG_KAPUTT.test(String(e.hint))) continue;
      const was = e.art === "hoeren" ? "hoeren" : e.art === "stimme" ? "stimme" : e.art;
      funde.push({ teil: was, text: String(e.hint).slice(0, 160) });
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

  // Sprechen. Ein Zeichen genuegt — der Zugang wird geprueft, nicht die Stimme.
  const k = process.env.ELEVENLABS_API_KEY, stimme = process.env.ELEVENLABS_VOICE_ID;
  if (k && stimme) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${stimme}/stream?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": k, "content-type": "application/json" },
        body: JSON.stringify({ text: ".", model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2" }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) funde.push({ teil: "stimme", text: `HTTP ${r.status}: ${(await r.text()).slice(0, 130)}` });
    } catch (e) {
      funde.push({ teil: "stimme", text: String(e.message).slice(0, 160) });
    }
  } else {
    funde.push({ teil: "stimme", text: "ELEVENLABS_API_KEY oder VOICE_ID fehlt." });
  }

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
      if (ZUGANG_KAPUTT.test(m)) funde.push({ teil: "modell", text: m.slice(0, 160) });
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
};
const HEIL = {
  hoeren: "Hören geht wieder", stimme: "Sprechen geht wieder",
  datenbank: "Die Datenbank ist wieder da", modell: "Der Modellzugang steht wieder",
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

module.exports = { pruefe, ausProtokoll, aktivPruefen };
