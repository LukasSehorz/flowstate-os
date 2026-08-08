// Legt den Telefon-Agenten bei ElevenLabs an — oder bringt ihn auf Stand.
//
// Warum als Skript und nicht per Hand im Dashboard (08.08.2026): Was hier
// eingestellt ist, entscheidet, wie Alexandra am Telefon klingt und was ein
// Anruf kostet. Von Hand geklickt weiss in zwei Wochen niemand mehr, warum
// etwas so steht — und ein versehentlich verstellter Wert faellt erst auf der
// Rechnung auf.
//
// LAESST SICH GEFAHRLOS WIEDERHOLEN: Gibt es den Agenten schon, wird er
// aktualisiert statt ein zweiter angelegt.
//
// Aufruf: docker exec flowstate-dashboard node scripts/telefon-einrichten.js

const KEY = process.env.ELEVENLABS_API_KEY || "";
const STIMME_ID = process.env.ELEVENLABS_VOICE_ID || "";
const GEHEIM = process.env.TELEFON_SECRET || "";
const BASIS = process.env.TELEFON_BASIS || "https://flowstate.srv1044804.hstgr.cloud";
const NAME = "Alexandra (Telefon)";

// Hoechstdauer eines Gespraechs. Lukas hat mit einem frueheren Aufbau einmal
// 300 € Monatsrechnung bekommen, weil Anrufe unbemerkt weiterliefen. Vier
// Minuten reichen fuer jeden Zweck, den wir kennen — und decken die Kosten
// eines vergessenen Anrufs bei rund 60 Cent.
const MAX_SEKUNDEN = Number(process.env.TELEFON_MAX_SEKUNDEN || 240);

// Flash 2.5 ist das schnellste Sprachmodell (unter 75 ms) und beherrscht
// Deutsch. Am Telefon zaehlt Anlaufzeit mehr als die letzte Nuance im Klang:
// Eine Pause hoert man, eine minimal weichere Betonung nicht.
const SPRACH_MODELL = process.env.TELEFON_TTS_MODELL || "eleven_flash_v2_5";

async function el(pfad, opt = {}) {
  const r = await fetch("https://api.elevenlabs.io/v1/" + pfad, {
    ...opt,
    headers: { "xi-api-key": KEY, "content-type": "application/json", ...(opt.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let d = null; try { d = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(`${pfad} ${r.status}: ${text.slice(0, 300)}`);
  return d;
}

// Der Prompt am Telefon. Er traegt NICHT Alexandras Persoenlichkeit — die
// steckt in unserem Server. Hier steht nur, was ElevenLabs braucht, falls es
// den Prompt doch einmal selbst verwendet.
const PROMPT = `Du bist Alexandra, die Assistentin von Lukas Sehorz (Flowstate, Sehorz & vom Hofe GbR). Du sprichst Deutsch, kurz und natürlich, wie am Telefon. Deine Antworten kommen von einem eigenen Server — gib sie unverändert weiter.`;

function aufbau() {
  return {
    name: NAME,
    conversation_config: {
      agent: {
        language: "de",
        first_message: "",   // wird bei jedem Anruf einzeln gesetzt
        prompt: {
          prompt: PROMPT,
          // "custom" heisst: NICHT ElevenLabs' Modell denkt, sondern unseres.
          // Das ist der ganze Punkt dieses Aufbaus — sonst waere es ein
          // Telefonbot, der Alexandra ANRUFEN kann, statt Alexandra zu sein.
          llm: "custom-llm",   // genau so, nicht "custom" — die Schnittstelle nimmt nur diesen Wert
          custom_llm: {
            server_url: `${BASIS}/telefon`,
            model_id: "alexandra",
            api_key: GEHEIM,
          },
        },
      },
      tts: { voice_id: STIMME_ID, model_id: SPRACH_MODELL },
      // Die Kostenbremse. Ohne sie laeuft ein Anruf, den niemand auflegt,
      // bis die Leitung von selbst abbricht.
      conversation: { max_duration_seconds: MAX_SEKUNDEN },
      turn: {
        // Wie lange Alexandra auf eine Antwort wartet, bevor sie nachhakt.
        turn_timeout: 8,
        // Etwas sagen, wenn die Antwort vom Server laenger braucht — Stille in
        // der Leitung wirkt doppelt so lang wie eine Wartezeit am Bildschirm.
        soft_timeout_config: { timeout_seconds: 3, message: "Einen Moment." },
      },
    },
  };
}

(async () => {
  const fehlt = [["ELEVENLABS_API_KEY", KEY], ["ELEVENLABS_VOICE_ID", STIMME_ID], ["TELEFON_SECRET", GEHEIM]]
    .filter(([, v]) => !v).map(([n]) => n);
  if (fehlt.length) { console.log("Es fehlt: " + fehlt.join(", ")); process.exit(1); }

  const liste = await el("convai/agents");
  const da = (liste.agents || []).find((a) => a.name === NAME);

  let id;
  if (da) {
    id = da.agent_id;
    await el(`convai/agents/${id}`, { method: "PATCH", body: JSON.stringify(aufbau()) });
    console.log(`Agent aktualisiert: ${id}`);
  } else {
    const neu = await el("convai/agents/create", { method: "POST", body: JSON.stringify(aufbau()) });
    id = neu.agent_id;
    console.log(`Agent angelegt: ${id}`);
  }

  // Nachlesen statt glauben: Was zurueckkommt, ist der Stand, mit dem
  // tatsaechlich telefoniert wird.
  const stand = await el(`convai/agents/${id}`);
  const c = stand.conversation_config || {};
  console.log(`  Stimme:       ${c.tts?.voice_id} (${c.tts?.model_id})`);
  console.log(`  Sprache:      ${c.agent?.language}`);
  console.log(`  Gehirn:       ${c.agent?.prompt?.llm} -> ${c.agent?.prompt?.custom_llm?.server_url || "—"}`);
  console.log(`  Hoechstdauer: ${c.conversation?.max_duration_seconds} s`);

  const stimmt = c.tts?.voice_id === STIMME_ID
    && c.agent?.prompt?.llm === "custom-llm"
    && String(c.agent?.prompt?.custom_llm?.server_url || "").includes("/telefon");
  console.log(stimmt ? "\nSteht." : "\nACHTUNG: Der Stand weicht ab — nicht telefonieren, bevor das geklärt ist.");

  const nummern = await el("convai/phone-numbers");
  console.log(`\nHinterlegte Nummern: ${nummern.length || 0}` +
    (nummern.length ? "" : " — ohne Nummer kann noch nicht angerufen werden."));
  (nummern || []).forEach((n) => console.log(`  ${n.phone_number} (${n.phone_number_id})`));

  console.log(`\nIn die .env:\n  ELEVENLABS_AGENT_ID=${id}`);
  process.exitCode = stimmt ? 0 : 1;
})().catch((e) => { console.error("FEHLER:", e.message); process.exitCode = 1; });
