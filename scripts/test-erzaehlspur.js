// Testet den Streaming-Empfang von Hermes (Stufe 2, Erzaehlspur).
//
// Warum eigener Test: Ein Datenstrom kommt in Paketen, die NICHT an Zeilenenden
// brechen — mitten in "data: {...}" kann Schluss sein und der Rest kommt im
// naechsten Paket. Wer das falsch zusammensetzt, verliert Text oder wirft.
// Ausserdem muss ein Endpunkt OHNE Streaming sauber scheitern, damit der
// Aufrufer auf den normalen Weg zurueckfaellt statt stehenzubleiben.
//
// Aufruf: node scripts/test-erzaehlspur.js

process.env.VAULT_PATH = process.env.VAULT_PATH || __dirname;
const { hermesStream } = require("../lib/sprache-routes.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

// Baut eine Antwort mit vorgegebenen Paketgrenzen (so wie das Netz sie liefert).
function antwortMit(pakete, { ok = true, status = 200, leer = false } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok, status,
    body: leer ? null : {
      getReader: () => ({
        read: async () => (i < pakete.length
          ? { done: false, value: enc.encode(pakete[i++]) }
          : { done: true, value: undefined }),
      }),
    },
  };
}

const zeile = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n`;

(async () => {
  const echtesFetch = global.fetch;

  // 1. Normaler Strom: Text wird zusammengesetzt, Zwischenstaende gemeldet.
  global.fetch = async () => antwortMit([
    zeile("Ich schau mir "), zeile("die Zahlen an. "), zeile("Jetzt die Folien."), "data: [DONE]\n",
  ]);
  let stufen = [];
  let text = await hermesStream("http://x", {}, {}, (t) => stufen.push(t));
  pruefe("Voller Text zusammengesetzt", text === "Ich schau mir die Zahlen an. Jetzt die Folien.");
  pruefe("Zwischenstaende wurden dreimal gemeldet", stufen.length === 3);
  pruefe("Zwischenstand waechst mit", stufen[0] === "Ich schau mir " && stufen[2] === text);

  // 2. Paketgrenze MITTEN in einer Zeile — der Kernfall.
  const ganz = zeile("Erster Teil. ") + zeile("Zweiter Teil.");
  const schnitt = Math.floor(ganz.length / 2);
  global.fetch = async () => antwortMit([ganz.slice(0, schnitt), ganz.slice(schnitt), "data: [DONE]\n"]);
  text = await hermesStream("http://x", {}, {}, () => {});
  pruefe("Zerschnittene Zeile geht nicht verloren", text === "Erster Teil. Zweiter Teil.");

  // 3. Muell zwischendrin (Kommentare, Leerzeilen, kaputtes JSON) wird ignoriert.
  global.fetch = async () => antwortMit([
    ": keepalive\n\n", zeile("Sauber."), "data: {kaputt\n", "\n", "data: [DONE]\n",
  ]);
  text = await hermesStream("http://x", {}, {}, () => {});
  pruefe("Muellzeilen werden uebersprungen", text === "Sauber.");

  // 4. Auch das nicht-Delta-Format (message statt delta) wird verstanden.
  global.fetch = async () => antwortMit([
    `data: ${JSON.stringify({ choices: [{ message: { content: "Aus message." } }] })}\n`, "data: [DONE]\n",
  ]);
  text = await hermesStream("http://x", {}, {}, () => {});
  pruefe("Format mit 'message' funktioniert auch", text === "Aus message.");

  // 5. Endpunkt kann kein Streaming -> muss WERFEN (Aufrufer faellt zurueck).
  global.fetch = async () => antwortMit([], { ok: false, status: 400 });
  let geworfen = false;
  try { await hermesStream("http://x", {}, {}, () => {}); } catch { geworfen = true; }
  pruefe("Fehlerstatus wirft (Rueckfall greift)", geworfen);

  // 6. Leerer Strom -> ebenfalls werfen, nicht stumm "" zurueckgeben.
  global.fetch = async () => antwortMit(["data: [DONE]\n"]);
  geworfen = false;
  try { await hermesStream("http://x", {}, {}, () => {}); } catch { geworfen = true; }
  pruefe("Leerer Strom wirft statt leerem Text", geworfen);

  // 7. Ein Fehler im melde-Rueckruf darf den Empfang NICHT abbrechen.
  global.fetch = async () => antwortMit([zeile("Trotzdem da."), "data: [DONE]\n"]);
  text = await hermesStream("http://x", {}, {}, () => { throw new Error("Anzeige kaputt"); });
  pruefe("Kaputter Rueckruf bricht den Empfang nicht ab", text === "Trotzdem da.");

  global.fetch = echtesFetch;
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
