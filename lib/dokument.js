// Dokumente bauen — PowerPoint, Word, Excel, PDF.
//
// Warum es das gibt (05.08.2026, aus dem Sprachlog von zwoelf Tagen):
// Hermes wurde 21 mal beauftragt und ist 9 mal gescheitert — 43 Prozent, bei
// einem Median von 142 Sekunden und Ausreissern bis 340. Sieht man sich an,
// WAS beauftragt wurde, ist das Bild noch klarer: Acht der 21 Auftraege waren
// Dokumente (PowerPoint, One-Pager, PDF), und davon sind sieben gescheitert
// oder haben ueber zwei Minuten gebraucht:
//
//   FEHLER 195s  PowerPoint Performance Marketing
//   FEHLER 170s  PowerPoint "KI in der Zukunft"   (zweiter Versuch: ok, 142s)
//   FEHLER 170s  PowerPoint FC Bayern
//   FEHLER 301s  One-Pager FC Bayern
//
// Hermes ist also im Kern eine Dokumenten-Werkstatt, die nicht funktioniert.
//
// Dafuer braucht es keinen eigenen Agenten auf dem Server: Die Claude-API hat
// fertige Faehigkeiten fuer pptx, docx, xlsx und pdf, die serverseitig bei
// Anthropic laufen. Das Modell schreibt Python, fuehrt es in einem Container
// aus, prueft das Ergebnis und legt die Datei ab. Nachgemessen am 05.08.:
// dasselbe Thema, an dem Hermes zweimal gescheitert ist, kam als gueltige
// 137-kB-Datei zurueck ("Performance_Marketing_Handwerk.pptx").
//
// ES BLEIBT LANGSAM — der Testlauf brauchte 264 Sekunden. Das ist in Ordnung,
// weil seit A2 (26.07.) ohnehin nichts davon im Gespraech wartet: Der Auftrag
// laeuft auf dem Server weiter und meldet sich per Telegram. Der Unterschied
// ist nicht das Tempo, sondern dass am Ende etwas ankommt.

const SORTEN = {
  pptx: { skill: "pptx", endung: "pptx", wort: "Präsentation" },
  docx: { skill: "docx", endung: "docx", wort: "Dokument" },
  xlsx: { skill: "xlsx", endung: "xlsx", wort: "Tabelle" },
  pdf: { skill: "pdf", endung: "pdf", wort: "PDF" },
};

// Woran man erkennt, WELCHE Sorte gemeint ist. Reihenfolge zaehlt: "Angebot
// als PDF" ist ein PDF, nicht ein Dokument.
const ERKENNUNG = [
  ["pdf", /\bpdf\b/i],
  ["xlsx", /\b(excel|tabelle|xlsx|kalkulation|liste als)\b/i],
  ["pptx", /\b(powerpoint|präsentation|praesentation|pptx|folien|slide\w*|deck|one-?pager|onepager)\b/i],
  ["docx", /\b(word|docx|dokument|schreiben|text|angebot|exposé|expose|bericht|konzept)\b/i],
];

function sorteAus(text) {
  for (const [sorte, muster] of ERKENNUNG) if (muster.test(String(text || ""))) return sorte;
  return "docx";   // im Zweifel ein Textdokument — das passt fast immer
}

// Erkennt der Auftrag ueberhaupt ein Dokument? Danach entscheidet die Route,
// ob dieses Modul zustaendig ist oder die lange Arbeit woanders hingeht.
const IST_DOKUMENT = new RegExp(ERKENNUNG.map(([, m]) => m.source).join("|"), "i");
const istDokument = (text) => IST_DOKUMENT.test(String(text || ""));

const KOPF = () => ({
  "content-type": "application/json",
  "x-api-key": process.env.SCHNELL_API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "code-execution-2025-08-25,skills-2025-10-02,files-api-2025-04-14",
});

// Die Datei-ID steckt tief in den Werkzeug-Ergebnissen. Statt die Struktur
// nachzubauen (die sich aendern kann), wird sie gesucht — die ID hat ein
// eindeutiges Format, und Feldnamen wie "file_text" fallen durch die Laenge raus.
function dateiIdAus(antwort) {
  const treffer = JSON.stringify(antwort).match(/file_[A-Za-z0-9]{20,}/g);
  return treffer ? treffer[treffer.length - 1] : null;   // die zuletzt erzeugte
}

async function metadaten(id) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/files/" + id, { headers: KOPF() });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Baut das Dokument und liefert { ok, reply, dateiId, dateiname }.
// Der Aufrufer holt die Datei ueber holen() ab, wenn er sie verschicken will.
async function bauen(auftrag, { sorte, timeoutMs = 600000, modell } = {}) {
  if (!process.env.SCHNELL_API_KEY) return { ok: false, hint: "Kein Anthropic-Schluessel eingerichtet." };
  const s = SORTEN[sorte || sorteAus(auftrag)] || SORTEN.docx;
  const start = Date.now();

  const system =
    "Du baust Dokumente fuer Lukas Sehorz (Sehorz & vom Hofe GbR, Performance Marketing). " +
    "Sprache: Deutsch. Sachlich, konkret, ohne Werbefloskeln. Erfinde keine Zahlen und keine " +
    "Quellen — was du nicht weisst, laesst du weg. Baue die Datei fertig und pruefe sie, bevor " +
    "du antwortest. Deine letzte Textnachricht ist EIN Satz darueber, was in der Datei steht.";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: KOPF(),
      body: JSON.stringify({
        model: modell || process.env.DOKUMENT_MODELL || "claude-sonnet-5",
        max_tokens: 16000,
        system,
        container: { skills: [{ type: "anthropic", skill_id: s.skill, version: "latest" }] },
        tools: [{ type: "code_execution_20260521", name: "code_execution" }],
        messages: [{ role: "user", content: String(auftrag || "").slice(0, 4000) }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      const fehler = await r.text().catch(() => "");
      return { ok: false, hint: `Dokument ${r.status}: ${fehler.slice(0, 150)}` };
    }
    const d = await r.json();
    const id = dateiIdAus(d);
    if (!id) {
      // Kein Anhang: Das Modell hat geantwortet, aber nichts gebaut. Ehrlich
      // melden statt eine Datei zu behaupten, die es nicht gibt.
      const text = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      return { ok: false, hint: text ? "Keine Datei entstanden: " + text.slice(0, 160) : "Es ist keine Datei entstanden." };
    }
    const md = await metadaten(id);
    const name = md?.filename || `dokument.${s.endung}`;
    const satz = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ")
      .replace(/\s+/g, " ").trim().slice(0, 220);
    return {
      ok: true,
      dateiId: id,
      dateiname: name,
      dauerMs: Date.now() - start,
      reply: `${s.wort} ist fertig: ${name}.` + (satz ? " " + satz : ""),
    };
  } catch (e) {
    return { ok: false, hint: "Dokument: " + String(e.message).slice(0, 150) };
  }
}

// Die fertige Datei als Buffer — zum Verschicken per Telegram.
async function holen(dateiId) {
  const r = await fetch("https://api.anthropic.com/v1/files/" + dateiId + "/content", { headers: KOPF() });
  if (!r.ok) throw new Error("Download " + r.status);
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { bauen, holen, istDokument, sorteAus };
