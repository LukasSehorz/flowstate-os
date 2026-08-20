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
//
// denken: "aus" (Vorgabe) | "adaptiv". Siehe anthropic() unten — die Vorgabe
// ist hier bewusst eine andere als bei mitWerkzeugen(): frage() formuliert und
// entnimmt, es entscheidet nichts.
async function frage(system, nutzer, { maxTokens = 400, temp = 0.4, timeoutMs = 15000, model, denken = "aus" } = {}) {
  if (PROVIDER === "anthropic" && verfuegbar()) {
    return anthropic(system, nutzer, maxTokens, temp, timeoutMs, model || MODELL, denken);
  }
  return openaiKompatibel(system, nutzer, maxTokens, temp, timeoutMs);
}

// --- Anthropic: /v1/messages, x-api-key, system separat ---------------------
async function anthropic(system, nutzer, maxTokens, temp, timeoutMs, modell = MODELL, denken = "aus") {
  const body = {
    model: modell,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: nutzer }],
    // DENKEN AUS, UND ZWAR ALS VORGABE (Fix 20.08.2026).
    //
    // Sonnet 5 und Opus 5 denken ohne diese Angabe ADAPTIV. Das Denken zaehlt
    // gegen max_tokens — bei den kleinen Budgets, mit denen hier gearbeitet
    // wird, ist das Budget aufgebraucht, bevor ein einziges Wort Antwort
    // entsteht. Zurueck kommt dann eine Antwort ohne Textblock, und diese
    // Funktion wirft "Anthropic: leere Antwort (max_tokens)".
    //
    // Live gemessen: Die Cold-Calls-Dreifachfrage — der ERSTE Satz aus
    // Creative 1 — fiel in zwei von drei Laeufen nach 16 Sekunden Stille genau
    // damit aus. Nachgemessen am 20.08. mit maxTokens 160:
    //   opus-5 ohne das Feld  -> stop_reason "max_tokens", Text angeschnitten
    //   opus-5 mit dem Feld   -> stop_reason "end_turn", Text vollstaendig
    // Sonnet 5 und Haiku 4.5 nehmen das Feld ebenso an (beide 200/end_turn).
    //
    // mitWerkzeugen() setzt das Feld laengst (weiter unten), frage() bisher
    // nicht — und an frage() haengen vierzehn Stellen, mehrere mit Budgets von
    // 120 bis 160 Token. Die Vorgabe steht deshalb HIER, an der einen Stelle,
    // durch die alle laufen.
    //
    // Warum "aus" die richtige Vorgabe ist: frage() formuliert um, entnimmt
    // Felder, uebersetzt ein Ergebnis in einen Satz. Entschieden wird dabei
    // nichts — das ist bei mitWerkzeugen() passiert, und dort bleibt das
    // Denken an. Wer es hier doch braucht, uebergibt denken: "adaptiv".
    thinking: { type: denken === "adaptiv" ? "adaptive" : "disabled" },
  };
  // temperature ist bei den neuen Modellen (Sonnet 5 u. a.) deprecated und
  // fuehrt zu 400. Nur mitschicken, wo es noch akzeptiert wird (4.x).
  if (temp != null && /-4-|haiku-4|opus-4/.test(modell)) body.temperature = temp;
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

async function denke(system, nutzer, { webSuche = true, maxSuchen = 2, maxTokens = 700, timeoutMs = 30000, aufwand } = {}) {
  if (!verfuegbar() || PROVIDER !== "anthropic") {
    throw new Error("Denk-Spur braucht den Anthropic-Schluessel.");
  }
  const anfrage = {
    model: DENKER_MODELL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: nutzer }],
  };
  // Ohne Angabe bleibt es bei der Vorgabe des Modells ("high"). Recherche darf
  // sich Zeit nehmen; kurze Formulierhilfen sollen es nicht.
  if (aufwand) anfrage.output_config = { effort: aufwand };
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

// --- Werkzeug-Aufruf (A4, 26.07.): das Modell RUFT AUF statt zu formulieren ---
//
// Bis hierher bekam das Modell ein 2.372 Token grosses JSON-Schema in den
// System-Prompt und musste die Antwort als JSON-Text zurueckschreiben. Zwei
// gemessene Folgen:
//
//   - Es dauerte. Bis zu 900 Token JSON mussten VOLLSTAENDIG fertig sein,
//     bevor ein Ton kam: median 4,89 s, p90 11,2 s.
//   - Es brach ab. Lief die Ausgabe gegen die Token-Grenze, fehlte das
//     schliessende }, das Parsen scheiterte, und mit ihm gingen ALLE
//     strukturierten Felder verloren. Am 26.07. verschwand so eine
//     vorbereitete WhatsApp, und Lukas bekam rohes JSON vorgelesen.
//
// Mit nativem Tool-Calling entfaellt beides: Die Werkzeuge stehen als Schema
// neben dem Prompt (nicht darin), das Modell schreibt nur noch den
// Sprechsatz plus kompakte Aufrufe, und die Aufrufe kommen strukturiert
// zurueck — es gibt kein JSON mehr, das abreissen koennte.
//
// DENKEN UND AUFWAND (27.07.): Sonnet 5 denkt von sich aus, wenn man nichts
// sagt — nicht wie die Vorgaengermodelle, bei denen Weglassen "kein Denken"
// hiess. Gemessen an einem einzelnen Aufruf: 29 Denk-Token, die wir wegwerfen
// (wir lesen nur text- und tool_use-Bloecke) und auf die Lukas trotzdem
// wartet. Im Sprachlog vom 27.07. schwankte das Verstehen zwischen 1,6 und
// 7,1 Sekunden — genau das Ruckeln, das er im Gespraech gemerkt hat.
//
// Zwei Hebel, beide hier durchgereicht:
//   denken: "adaptiv" (Vorgabe) | "aus"
//   aufwand: "low" | "medium" | "high" (Vorgabe) | "xhigh" | "max"
//
// "aus" ist NICHT automatisch besser: Ohne Denken greift Sonnet 5 seltener zu
// Werkzeugen — und Alexandra besteht aus Werkzeugaufrufen. Deshalb wird das
// nicht geraten, sondern mit scripts/rauchtest-sprache.js gemessen: erst
// Werkzeugtreffer, dann Tempo. Was dabei gewonnen hat, steht in
// lib/sprache-routes.js an der Aufrufstelle.
//
// Liefert { text, aufrufe: [{ name, input }], stop }.
async function mitWerkzeugen(system, nutzer, werkzeuge,
  { maxTokens = 1200, timeoutMs = 30000, model, denken = "adaptiv", aufwand = "high" } = {}) {
  if (!verfuegbar() || PROVIDER !== "anthropic") {
    throw new Error("Werkzeug-Aufruf braucht den Anthropic-Schluessel.");
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.SCHNELL_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || DENKER_MODELL,
      max_tokens: maxTokens,
      // Der Zwischenspeicher-Marker deckt alles ab, was VOR ihm steht — also
      // auch die Werkzeugliste. Beide sind bei jeder Aeusserung Zeichen fuer
      // Zeichen identisch (~2.700 Token), und ohne Marker zahlt jede Frage sie
      // neu: an Zeit im Prefill und an Geld. Der Speicher haelt 5 Minuten und
      // verlaengert sich bei jedem Treffer — ein laufendes Gespraech faellt nie
      // heraus, nur die erste Frage nach einer Pause legt ihn neu an.
      //
      // Wer hier Bloecke uebergibt, setzt den Marker selbst: Alles Wechselnde
      // (z. B. Lukas' Stilproben, die nur bei Mails mitgehen) gehoert HINTER
      // den Marker, sonst verfehlt jeder Aufruf mit Stilproben den Speicher.
      system: typeof system === "string"
        ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
        : system,
      thinking: { type: denken === "aus" ? "disabled" : "adaptive" },
      output_config: { effort: aufwand },
      tools: werkzeuge,
      messages: [{ role: "user", content: nutzer }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    const fehler = await r.text().catch(() => "");
    throw new Error(`Werkzeuge ${r.status}: ${fehler.slice(0, 200)}`);
  }
  const d = await r.json();
  const bloecke = d.content || [];
  const u = d.usage || {};
  return {
    text: bloecke.filter((b) => b.type === "text").map((b) => b.text).join("").trim(),
    aufrufe: bloecke
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ name: b.name, input: b.input || {} })),
    stop: d.stop_reason || null,
    // Fuers Sprachprotokoll: ein Treffer im Zwischenspeicher ist der Unterschied
    // zwischen "System-Prompt neu gelesen" und "uebersprungen".
    zwischenspeicher: u.cache_read_input_tokens ? "treffer" : (u.cache_creation_input_tokens ? "angelegt" : "keiner"),
    tokenRaus: u.output_tokens || 0,
    tokenDenken: u.output_tokens_details?.thinking_tokens || 0,
    // Die EINGABE getrennt nach Art (07.08., auf Lukas' Kostenfrage hin). Ohne
    // sie laesst sich nicht sagen, was ein Vorgang kostet: Frisch gelesene,
    // zwischengespeicherte und aus dem Speicher gelesene Token unterscheiden
    // sich im Preis um mehr als das Zehnfache. Eine einzige "Eingabe"-Zahl
    // waere dafuer wertlos.
    tokenRein: u.input_tokens || 0,
    tokenSpeicherNeu: u.cache_creation_input_tokens || 0,
    tokenSpeicherGelesen: u.cache_read_input_tokens || 0,
  };
}

// --- Dasselbe, aber stueckweise (A4 zweite Haelfte, 27.07.) ----------------
//
// mitWerkzeugen() wartet, bis die ganze Antwort steht. Bei einer erzaehlenden
// Antwort ("was steht morgen an") sind das gemessen 2-4 Sekunden, in denen
// nichts passiert, obwohl der erste Satz nach knapp einer Sekunde fertig waere.
//
// Hier kommt derselbe Aufruf als Strom zurueck. onSatz() wird gerufen, sobald
// ein SATZ vollstaendig ist — nicht pro Wort: Die Sprachausgabe braucht ganze
// Saetze, sonst klingt die Betonung zerhackt. Werkzeugaufrufe kommen im Strom
// als Bruchstuecke und werden hier wieder zusammengesetzt; der Rueckgabewert
// ist deshalb Zeichen fuer Zeichen derselbe wie bei mitWerkzeugen().
//
// SATZENDE — die heikelste Zeile im ganzen Streaming.
//
// Der erste Entwurf war "Punkt, dann Leerzeichen" und zerschnitt prompt
// "Mittwoch, 29.07. um 12:00 Uhr" mitten im Datum. Die Stimme haette dann
// "Mittwoch, neunundzwanzigster siebter" gesagt, Pause, "um zwoelf Uhr" —
// schlimmer als gar kein Streaming.
//
// Zwei Bedingungen, beide noetig:
//   - Vor dem PUNKT steht keine Ziffer. Das deckt Datumsangaben (29.07.),
//     Tausendertrennung (1.500) und Ordnungszahlen (am 3.) ab. Fuer ! und ?
//     gilt das nicht — die sind eindeutig.
//   - Danach faengt etwas Neues an: Grossbuchstabe, Anfuehrungszeichen,
//     Klammer, Ziffer oder Textende. Ein kleingeschriebenes Wort danach heisst
//     Abkuerzung, nicht Satzende.
// Im Zweifel wird NICHT getrennt: Dann kommt der Satz eben einen Moment
// spaeter, statt zerhackt zu klingen.
const SATZENDE = /([^\s].*?(?:(?<![0-9])\.|[!?])["'”“»]?)(\s+)(?=[A-ZÄÖÜ„"'(0-9]|$)/s;

async function mitWerkzeugenStrom(system, nutzer, werkzeuge, opts = {}, onSatz = () => {}) {
  if (!verfuegbar() || PROVIDER !== "anthropic") {
    throw new Error("Werkzeug-Aufruf braucht den Anthropic-Schluessel.");
  }
  const { maxTokens = 1200, timeoutMs = 30000, model, denken = "adaptiv", aufwand = "high" } = opts;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.SCHNELL_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || DENKER_MODELL,
      max_tokens: maxTokens,
      system: typeof system === "string"
        ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
        : system,
      thinking: { type: denken === "aus" ? "disabled" : "adaptive" },
      output_config: { effort: aufwand },
      tools: werkzeuge,
      messages: [{ role: "user", content: nutzer }],
      stream: true,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    const fehler = await r.text().catch(() => "");
    throw new Error(`Werkzeuge ${r.status}: ${fehler.slice(0, 200)}`);
  }

  const leser = r.body.getReader();
  const dekoder = new TextDecoder();
  let puffer = "";            // unfertige SSE-Zeilen
  let text = "";              // gesamter Sprechtext
  let ungesagt = "";          // was noch nicht als Satz rausging
  const aufrufe = [];
  const bloecke = new Map();  // index -> { name, json }
  let stop = null, tokenRaus = 0, tokenDenken = 0, speicher = "keiner";
  let tokenRein = 0, tokenSpeicherNeu = 0, tokenSpeicherGelesen = 0;

  const satzPruefen = (schluss = false) => {
    let m;
    while ((m = SATZENDE.exec(ungesagt))) {
      const satz = m[1].trim();
      ungesagt = ungesagt.slice(m[0].length);
      if (satz) onSatz(satz);
    }
    if (schluss && ungesagt.trim()) { onSatz(ungesagt.trim()); ungesagt = ""; }
  };

  while (true) {
    const { done, value } = await leser.read();
    if (done) break;
    puffer += dekoder.decode(value, { stream: true });
    const zeilen = puffer.split("\n");
    puffer = zeilen.pop() || "";
    for (const z of zeilen) {
      if (!z.startsWith("data:")) continue;
      let d;
      try { d = JSON.parse(z.slice(5).trim()); } catch { continue; }

      if (d.type === "content_block_start" && d.content_block?.type === "tool_use") {
        bloecke.set(d.index, { name: d.content_block.name, json: "" });
      } else if (d.type === "content_block_delta") {
        if (d.delta?.type === "text_delta") {
          text += d.delta.text;
          ungesagt += d.delta.text;
          satzPruefen();
        } else if (d.delta?.type === "input_json_delta" && bloecke.has(d.index)) {
          bloecke.get(d.index).json += d.delta.partial_json || "";
        }
      } else if (d.type === "content_block_stop" && bloecke.has(d.index)) {
        const b = bloecke.get(d.index);
        // Ein abgerissener Aufruf wird VERWORFEN, nicht halb ausgefuehrt —
        // dieselbe Regel wie beim JSON-Vertrag, nur an anderer Stelle.
        try { aufrufe.push({ name: b.name, input: b.json ? JSON.parse(b.json) : {} }); } catch {}
        bloecke.delete(d.index);
      } else if (d.type === "message_start") {
        const u = d.message?.usage || {};
        speicher = u.cache_read_input_tokens ? "treffer" : (u.cache_creation_input_tokens ? "angelegt" : "keiner");
        tokenRein = u.input_tokens || 0;
        tokenSpeicherNeu = u.cache_creation_input_tokens || 0;
        tokenSpeicherGelesen = u.cache_read_input_tokens || 0;
      } else if (d.type === "message_delta") {
        stop = d.delta?.stop_reason || stop;
        tokenRaus = d.usage?.output_tokens || tokenRaus;
        tokenDenken = d.usage?.output_tokens_details?.thinking_tokens || tokenDenken;
      }
    }
  }
  satzPruefen(true);
  return { text: text.trim(), aufrufe, stop, zwischenspeicher: speicher, tokenRaus, tokenDenken,
           tokenRein, tokenSpeicherNeu, tokenSpeicherGelesen };
}

module.exports = { frage, denke, mitWerkzeugen, mitWerkzeugenStrom, verfuegbar, SATZENDE };
