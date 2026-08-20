// Prueft, dass ein leeres Guthaben LAUT scheitert — ohne Netz, ohne Modell.
//
// DER VORFALL (20.08.2026, 02:32 Uhr): Das Anthropic-Guthaben war aufgebraucht.
// Die Schnittstelle antwortete:
//
//   HTTP 400 {"type":"invalid_request_error",
//             "message":"Your credit balance is too low to access the Anthropic API."}
//
// Danach sagte Alexandra auf JEDE Frage in 0,4 bis 0,8 Sekunden "Mach ich — ich
// setz mich dran" und lieferte nie etwas nach. Der Waechter schlug nicht an,
// weil er auf 401/403 und "api key" horcht — ein 400 gilt sonst als eigener
// Fehler und wird bewusst nicht gemeldet.
//
// Das ist der gefaehrlichste Ausfall, den dieses System kennt: Er sieht aus wie
// Arbeit. Vor einer Kamera merkt es niemand, bis das Material geschnitten wird.
//
// Aufruf:  node scripts/test-guthaben.js

const fs = require("fs");
const os = require("os");
const path = require("path");

// DATA_PATH auf einen Wegwerf-Ordner, BEVOR selbsttest.js geladen wird — es
// liest den Pfad beim Laden und wuerde sonst ins echte Protokoll schauen.
const WEG = path.join(os.tmpdir(), "guthaben-test-" + Date.now().toString(36));
fs.mkdirSync(path.join(WEG, "sprachlog"), { recursive: true });
process.env.DATA_PATH = WEG;

const selbsttest = require(path.join(__dirname, "..", "lib", "selbsttest.js"));

let fehler = 0;
const pruefe = (name, wahr, dazu = "") => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !dazu ? "" : "\n   " + dazu));
  if (!wahr) fehler++;
};

// Der Wortlaut, wie er wirklich kam.
const ECHT = "Anthropic 400: {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\"," +
  "\"message\":\"Your credit balance is too low to access the Anthropic API.\"}}";

// --- Wird der Fall ueberhaupt erkannt? --------------------------------------
pruefe("Leeres Guthaben wird erkannt", selbsttest.GUTHABEN_LEER.test(ECHT), ECHT);
pruefe("Und als EIGENER Teil gefuehrt, nicht als Zugangsfehler",
  selbsttest.teilAus(ECHT) === "guthaben", "war: " + selbsttest.teilAus(ECHT));

// Ein kaputter Schluessel bleibt ein Zugangsfehler — die beiden duerfen nicht
// verschmelzen, sonst steht bei einem falschen Schluessel "bitte aufladen".
pruefe("Falscher Schluessel bleibt Zugangsfehler",
  selbsttest.teilAus("Anthropic 401: invalid x-api-key") === "zugang",
  "war: " + selbsttest.teilAus("Anthropic 401: invalid x-api-key"));

// Andere Anbieter schreiben es anders. Alle vier Formen kommen vor.
for (const t of ["insufficient_quota", "You exceeded your current quota",
                 "billing_hard_limit_reached", "Your credit balance is too low"]) {
  pruefe(`Auch erkannt: „${t}“`, selbsttest.GUTHABEN_LEER.test(t), t);
}

// Ein gewoehnlicher Fehler darf KEINEN Alarm ausloesen.
for (const t of ["Anthropic 400: max_tokens must be greater than thinking.budget_tokens",
                 "fetch failed (UND_ERR_HEADERS_TIMEOUT)", "Wetter-API 503"]) {
  pruefe(`Kein Fehlalarm bei „${t.slice(0, 40)}…“`, selbsttest.teilAus(t) === null, t);
}

// --- Taucht er im Protokoll als eigener Alarm auf? --------------------------
//
// Das ist die eigentliche Abnahme: Der Fehler steht im Sprachprotokoll unter
// verstehen.fehler (dort landet er, wenn die Reserve einspringt) — und genau
// dort hat der Waechter frueher nicht hingeschaut.
const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
fs.writeFileSync(path.join(WEG, "sprachlog", heute + ".jsonl"),
  JSON.stringify({ zeit: new Date().toISOString(), art: "frage", frage: "Was steht heute an?",
    verstehen: { modell: "claude-opus-5", reserve: true, fehler: ECHT } }) + "\n");

// Den taeglichen Aktivlauf als "heute schon gemacht" markieren. Sonst prüft
// pruefe() zusaetzlich Datenbank und Stimme — die hier weder erreichbar noch
// gemeint sind, und ihre Meldungen wuerden die Abnahme verrauschen.
fs.writeFileSync(path.join(WEG, "selbsttest.json"),
  JSON.stringify({ kaputt: {}, aktivAm: heute }));

const funde = selbsttest.ausProtokoll();
const guthaben = funde.find((f) => f.teil === "guthaben");
pruefe("Aus dem Protokoll als Alarm „guthaben“ erkannt", Boolean(guthaben),
  "gefunden: " + JSON.stringify(funde));

(async () => {
  const r = await selbsttest.pruefe();
  console.log("\n   Meldung: " + (r.text || "(keine)").replace(/\n/g, "\n            "));
  pruefe("Es geht eine Meldung raus", Boolean(r.text), "");
  pruefe("Sie sagt, was zu tun ist", /aufladen/i.test(r.text || ""), r.text);
  pruefe("Sie warnt vor der falschen Souveraenitaet",
    /sagt bis dahin zu allem zu|liefert nichts/i.test(r.text || ""), r.text);
  pruefe("Sie steht NICHT als gewoehnlicher Reserve-Fall drin",
    !/Modellzugang ist tot/.test(r.text || ""), r.text);

  // --- Und die Antwort im Gespraech? ---------------------------------------
  //
  // Der Satz, den Lukas dann hoert, steht in lib/sprache-routes.js. Er wird hier
  // aus der Quelle gelesen statt nachgebaut — ein Test, der seine eigene
  // Erwartung erfindet, prueft nichts.
  const quelle = fs.readFileSync(path.join(__dirname, "..", "lib", "sprache-routes.js"), "utf-8");
  pruefe("Die Sprachroute bricht bei leerem Guthaben ab, statt an Hermes abzugeben",
    /GUTHABEN_LEER\.test\(diag\.fehler\)/.test(quelle), "");
  const satz = (quelle.match(/"(Ich komme gerade an gar nichts ran[^"]*)"/) || [])[1] || "";
  console.log("   Gesagt wird: " + satz);
  pruefe("Der gesagte Satz verspricht nichts", satz && !/mach ich|bin dran|setz mich dran/i.test(satz), satz);
  pruefe("Der gesagte Satz nennt keine Schluessel oder Anbieter",
    satz && !/anthropic|api|token|schl(ü|ue)ssel/i.test(satz), satz);

  try { fs.rmSync(WEG, { recursive: true, force: true }); } catch { /* egal */ }
  console.log(fehler ? `\n${fehler} Fall/Faelle durchgefallen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
