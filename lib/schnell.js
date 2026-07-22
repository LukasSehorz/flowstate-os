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

// --- Anthropic: /v1/messages, x-api-key, system separat ---------------------
async function anthropic(system, nutzer, maxTokens, temp, timeoutMs) {
  const body = {
    model: MODELL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: nutzer }],
  };
  // temperature ist bei den neuen Modellen (Sonnet 5 u. a.) deprecated und
  // fuehrt zu 400. Nur mitschicken, wo es noch akzeptiert wird (4.x).
  if (temp != null && /-4-|haiku-4|opus-4/.test(MODELL)) body.temperature = temp;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.SCHNELL_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
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

// --- Die Denk-Spur (Sonnet): kurze Aufgaben mit etwas mehr Logik ------------
//
// Entscheidung 21.07. (Lukas): Drei Spuren. Haiku orchestriert und liest vor,
// was schon da ist. Sonnet erledigt schnelle Denk-/Recherche-Aufgaben (Wetter
// nachschauen, Zahlen auswerten, Report zusammenfassen) in Sekunden — mit
// Websuche als Server-Werkzeug. Hermes bleibt fuer lange Arbeit (PowerPoint,
// Angebote, Routinen). Grund aus dem Test: Eine Wetterfrage stellte sich bei
// Hermes hinter einer laufenden PowerPoint an (96 s, Abbruch) — voellig
// unnoetig fuer eine 5-Sekunden-Recherche.
const DENKER_MODELL = process.env.SCHNELL_DENKER_MODEL || "claude-sonnet-5";

async function denke(system, nutzer, { webSuche = true, maxSuchen = 2, maxTokens = 700, timeoutMs = 30000 } = {}) {
  if (!verfuegbar() || PROVIDER !== "anthropic") {
    throw new Error("Denk-Spur braucht den Anthropic-Schluessel.");
  }
  const anfrage = {
    model: DENKER_MODELL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: nutzer }],
  };
  // Websuche laeuft serverseitig bei Anthropic — ein Aufruf, Suche inklusive.
  // max_uses: 2 statt 3 (gemessen 22.07.): Mit 3 sucht das Modell gern 2-3 mal
  // (18-35 s, teils Timeout). Bei 2 + "sparsam"-Anweisung macht es meist EINE
  // Suche und ist in ~9 s fertig. max_uses: 1 ist kontraproduktiv — dann laeuft
  // es ans Limit und scheitert ("Suchlimit erreicht").
  if (webSuche) anfrage.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: maxSuchen }];

  // pause_turn: Server-Werkzeugschleife am Limit -> gleiche Anfrage mit
  // bisherigem Inhalt fortsetzen (max 2x, dann nehmen wir, was da ist).
  for (let versuch = 0; versuch < 3; versuch++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.SCHNELL_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anfrage),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      const fehler = await r.text().catch(() => "");
      throw new Error(`Denk-Spur ${r.status}: ${fehler.slice(0, 200)}`);
    }
    const d = await r.json();
    if (d.stop_reason === "pause_turn" && versuch < 2) {
      anfrage.messages = [anfrage.messages[0], { role: "assistant", content: d.content }];
      continue;
    }
    const text = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text) throw new Error("Denk-Spur: leere Antwort (" + (d.stop_reason || "?") + ")");
    return text;
  }
  throw new Error("Denk-Spur: nach 3 Versuchen keine fertige Antwort.");
}

module.exports = { frage, denke, verfuegbar };
