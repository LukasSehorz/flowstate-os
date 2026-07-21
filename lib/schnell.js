// Die Schnellspur — ein direkter Modellaufruf ohne Agent-Schleife.
//
// Warum es diese Datei gibt (Latenz-Analyse 20.07.2026): Jeder Weg ueber
// Hermes traegt 16.000 Token Grundlast und den Umweg ueber ein Abo-Backend
// ohne Latenzgarantie (gemessen: identische Aufrufe zwischen 2,5 und 50 s).
// Fuer Gespraech und Standard-Aktionen braucht es einen Draht direkt zum
// Modell: ein Aufruf, kleiner Kontext, vorhersagbare 1-2 s.
//
// Diese Datei verbirgt den Anbieter. Entscheidung E1 (21.07.2026): Anthropic
// Haiku 4.5 — bestes Deutsch. Dessen API spricht ein anderes Format als die
// OpenAI-kompatiblen Endpunkte (eigener Pfad, x-api-key statt Bearer, system
// als eigenes Feld). Der Rest des Codes soll davon nichts wissen: er ruft
// frage() und bekommt Text.
//
// Fallback-Kette: Ohne SCHNELL_API_KEY laeuft alles weiter wie bisher ueber
// Hermes (OpenAI-Zweig mit HERMES_CHAT_URL) — langsamer, aber nie kaputt.

const PROVIDER = (process.env.SCHNELL_PROVIDER || "").toLowerCase();
const MODELL = process.env.SCHNELL_MODEL || "claude-haiku-4-5";

function verfuegbar() {
  return Boolean(process.env.SCHNELL_API_KEY);
}

// Ein Frage-Antwort-Aufruf. system = Charakter/Anweisung, nutzer = Inhalt.
// Liefert den Antworttext oder wirft — der Aufrufer entscheidet ueber Fallback.
async function frage(system, nutzer, { maxTokens = 400, temp = 0.4, timeoutMs = 15000 } = {}) {
  if (PROVIDER === "anthropic" && verfuegbar()) {
    return anthropic(system, nutzer, maxTokens, temp, timeoutMs);
  }
  return openaiKompatibel(system, nutzer, maxTokens, temp, timeoutMs);
}

// --- Anthropic (Haiku): /v1/messages, x-api-key, system separat -------------
async function anthropic(system, nutzer, maxTokens, temp, timeoutMs) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.SCHNELL_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELL,
      max_tokens: maxTokens,
      temperature: temp,
      system,
      messages: [{ role: "user", content: nutzer }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    const fehler = await r.text().catch(() => "");
    throw new Error(`Anthropic ${r.status}: ${fehler.slice(0, 200)}`);
  }
  const d = await r.json();
  const text = (d.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new Error("Anthropic: leere Antwort (" + (d.stop_reason || "?") + ")");
  return text;
}

// --- OpenAI-kompatibel: Groq, Gemini-OpenAI-Endpunkt, Hermes-Fallback -------
async function openaiKompatibel(system, nutzer, maxTokens, temp, timeoutMs) {
  const url = process.env.SCHNELL_CHAT_URL || process.env.HERMES_CHAT_URL;
  if (!url) throw new Error("Weder SCHNELL_CHAT_URL noch HERMES_CHAT_URL gesetzt.");
  const key = process.env.SCHNELL_API_KEY || process.env.HERMES_API_KEY;
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = "Bearer " + key;

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.SCHNELL_API_KEY ? MODELL : (process.env.HERMES_MODEL || "hermes-agent"),
      max_tokens: maxTokens,
      temperature: temp,
      messages: [
        { role: "system", content: system },
        { role: "user", content: nutzer },
      ],
      stream: false,
    }),
    // Der Hermes-Fallback braucht mehr Luft als ein direktes Modell.
    signal: AbortSignal.timeout(process.env.SCHNELL_API_KEY ? timeoutMs : 45000),
  });
  if (!r.ok) {
    const fehler = await r.text().catch(() => "");
    throw new Error(`Schnellspur ${r.status}: ${fehler.slice(0, 200)}`);
  }
  const d = await r.json();
  const text = d?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Schnellspur: leere Antwort");
  return text;
}

module.exports = { frage, verfuegbar };
