// Alexandra am Telefon.
//
// Warum (Lukas, 07.08.2026): "Er ruft uns an, erinnert uns und dann sagen wir
// halt noch: 'Schick die WhatsApp raus, schreib die Mail noch.' Dann erstellt er
// das Angebot noch, damit man sieht, dass es ein komplett eigenständiger Agent
// ist [...] das komplette Unternehmen läuft von alleine."
//
// DIE ENTSCHEIDENDE ENTSCHEIDUNG — und sie war zuerst falsch getroffen:
//
// Der erste Entwurf haette ElevenLabs' eigenes Modell denken lassen und ihm ein
// Werkzeug gegeben, das bei uns anklopft. Lukas hat gefragt, warum das Gehirn
// dort sitzt, und die Frage war berechtigt: Dieses Modell haette einen anderen
// Prompt, kein STAND, kein Gespraechsgedaechtnis und waere schwaecher. Zwei
// Gehirne, die auseinanderdriften. Man haette gehoert, dass es nicht Alexandra
// ist.
//
// Stattdessen: ElevenLabs erlaubt einen EIGENEN LLM-Server (OpenAI-kompatibel).
// Damit ist die Aufteilung sauber —
//
//   ElevenLabs:   Ohren und Mund. Telefonie, Spracherkennung im Strom,
//                 Sprecherwechsel, Unterbrechen, Alexandras Stimme.
//   Dieser Server: das ganze Denken. Derselbe Prompt, derselbe STAND, dieselben
//                 Werkzeuge, dasselbe Modell.
//
// UND ZWAR OHNE ETWAS NACHZUBAUEN: Dieser Endpunkt ist ein UEBERSETZER, kein
// zweites Gehirn. Er reicht den Satz an /api/sprache/frage weiter — dieselbe
// Route, die Browser und Telegram benutzen — und uebersetzt deren Satzstrom ins
// OpenAI-Format. Es gibt genau EINEN Ort, an dem steht, was Alexandra kann.
//
// Was das praktisch heisst: Jede Faehigkeit, die im Dashboard dazukommt, kann
// Jarvis am Telefon sofort. Ohne Zutun.

const SELF = process.env.SELF_URL || "http://127.0.0.1:3000";
const PW = process.env.DASHBOARD_PASSWORD || "";

// Das Geheimnis, mit dem sich ElevenLabs bei uns ausweist. Ohne das koennte
// jeder, der die Adresse kennt, Auftraege in Lukas' Unternehmen ausloesen —
// WhatsApp verschicken, Rechnungen anlegen. Der Endpunkt steht offen im Netz.
const GEHEIM = process.env.TELEFON_SECRET || "";

const AGENT = process.env.ELEVENLABS_AGENT_ID || "";
const NUMMER_ID = process.env.ELEVENLABS_TELEFON_ID || "";
const ZIEL = process.env.TELEFON_ZIEL || "";
const EL_KEY = process.env.ELEVENLABS_API_KEY || "";

const bereit = () => Boolean(EL_KEY && AGENT && NUMMER_ID);

// --- Die Kostenbremse -------------------------------------------------------
//
// Warum (Lukas, 08.08.2026): "Ich hab das schonmal mit der USA-Nummer gemacht
// und da hab ich eine Rechnung von 300 € dann am Ende vom Monat bekommen, weil
// ich das nicht so viel getestet hab."
//
// ZWEI BREMSEN, weil eine allein nicht reicht:
//
//   1. Die Hoechstdauer je Anruf steht beim Agenten (240 s). Sie verhindert,
//      dass ein Anruf, den niemand auflegt, stundenlang weiterlaeuft.
//   2. Diese hier begrenzt die ANZAHL. Ohne sie koennte eine Schleife im
//      System — ein Wiederholversuch, eine Routine, ein Missverstaendnis —
//      hundertmal anrufen, und jeder einzelne waere unter der Hoechstdauer.
//
// Zusammen ergibt das eine Obergrenze, die man hinschreiben kann:
// 30 Anrufe x 4 Minuten x rund 0,105 $ = etwa 12,60 $ am Tag im schlimmsten Fall.
// Das ist die Zahl, die zaehlt — nicht der Durchschnitt.
const MAX_AM_TAG = Number(process.env.TELEFON_MAX_AM_TAG || 30);
let zaehler = { tag: "", anrufe: 0 };

const berlinTag = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

function darfNoch() {
  const heute = berlinTag();
  if (zaehler.tag !== heute) zaehler = { tag: heute, anrufe: 0 };
  return zaehler.anrufe < MAX_AM_TAG;
}
const stand = () => ({ tag: zaehler.tag, anrufe: zaehler.anrufe, hoechstens: MAX_AM_TAG });

// --- Eigene Sitzung fuers Telefon -------------------------------------------
//
// Ein Anruf braucht eine angemeldete Sitzung (die Sprachroute haengt an
// req.session.crm). Eine EIGENE, nicht die von Telegram: Sonst mischt sich der
// Gespraechsverlauf am Telefon mit dem im Chat, und Alexandra bezieht sich am
// Telefon auf etwas, das Lukas getippt hat.
let keks = "";
async function anmelden() {
  const r = await fetch(SELF + "/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PW }), redirect: "manual",
  });
  const setc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  keks = (setc || []).map((c) => c.split(";")[0]).join("; ");
  // Zweiter Schritt wie bei Telegram: Das Dashboard-Passwort oeffnet nicht die
  // Buchhaltung. Ohne das koennte Jarvis am Telefon keine Rechnung anlegen.
  try {
    await fetch(SELF + "/intern/dienst-anmelden", {
      method: "POST", headers: { "content-type": "application/json", cookie: keks },
      body: JSON.stringify({ passwort: PW }),
    });
  } catch (e) { console.error("Telefon-Dienstanmelden:", e.message); }
}

// --- Anrufen ----------------------------------------------------------------
//
// ansage ist der erste Satz. Er wird HIER festgelegt und nicht vom Modell
// erzeugt: Beim Drehen muss jede Aufnahme mit demselben Wortlaut beginnen, und
// eine Denkpause direkt nach dem Abheben waere der schlechteste Moment dafuer.
async function anrufen({ an, ansage } = {}) {
  // Probelauf (20.08.2026): Ein Testlauf, der Lukas' Handy klingeln laesst,
  // ist beim Dreh das Letzte, was jemand gebrauchen kann. Siehe
  // lib/probemodus.js.
  const probemodus = require("./probemodus.js");
  if (probemodus.aktiv()) {
    probemodus.notieren("anruf", { an: an || null, ansage: String(ansage || "").slice(0, 400) });
    return { ok: true, probe: true, reply: "[Probemodus: Anruf nicht ausgeloest]" };
  }
  if (!bereit()) {
    return { ok: false, reply: "Für Anrufe fehlen noch die Zugangsdaten — Agent-ID und Telefonnummer sind nicht hinterlegt." };
  }
  const nummer = String(an || ZIEL || "").replace(/[^\d+]/g, "");
  if (!/^\+\d{8,15}$/.test(nummer)) {
    return { ok: false, reply: "Ich brauche eine Nummer im Format +49…, um anzurufen." };
  }
  const satz = String(ansage || "").trim();
  if (satz.length < 3) return { ok: false, reply: "Was soll ich denn sagen, wenn du drangehst?" };

  // Die Bremse greift VOR dem Waehlen. Danach waere sie wertlos.
  if (!darfNoch()) {
    return { ok: false, reply: `Heute sind schon ${zaehler.anrufe} Anrufe rausgegangen — das ist die Tagesgrenze. Wenn du mehr brauchst, heb sie in den Einstellungen an.` };
  }

  try {
    const r = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
      method: "POST",
      headers: { "xi-api-key": EL_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: AGENT,
        agent_phone_number_id: NUMMER_ID,
        to_number: nummer,
        conversation_initiation_client_data: {
          conversation_config_override: { agent: { first_message: satz.slice(0, 800) } },
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, reply: `Der Anruf ging nicht raus (${r.status}${d.detail?.message ? ": " + String(d.detail.message).slice(0, 100) : ""}).` };
    }
    // Erst zaehlen, wenn die Leitung wirklich steht.
    zaehler.anrufe++;
    console.log(`Anruf ${zaehler.anrufe}/${MAX_AM_TAG} heute an ${nummer}.`);
    return { ok: true, id: d.conversation_id || d.callSid || null, reply: `Ich rufe dich gleich an, ${nummer}.` };
  } catch (e) {
    return { ok: false, reply: `Der Anruf ging nicht raus: ${String(e.message).slice(0, 100)}` };
  }
}

// --- Das Gehirn fuer den Anruf ----------------------------------------------

// OpenAI erwartet Bruchstuecke in einer festen Form.
const stueck = (id, inhalt, ende) => "data: " + JSON.stringify({
  id, object: "chat.completion.chunk", created: 0, model: "alexandra",
  choices: [{ index: 0, delta: inhalt ? { content: inhalt } : {}, finish_reason: ende || null }],
}) + "\n\n";

function anmelden_noetig(status) { return status === 302 || status === 401; }

function routen(app) {
  app.post("/telefon/v1/chat/completions", async (req, res) => {
    // Ohne Geheimnis gar nicht erst hineinlassen. Ein offener Endpunkt, der
    // Rechnungen anlegen und WhatsApp verschicken kann, ist kein Endpunkt,
    // sondern eine Einladung.
    const mitgebracht = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!GEHEIM || mitgebracht !== GEHEIM) {
      return res.status(401).json({ error: { message: "nicht angemeldet" } });
    }

    const nachrichten = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const vonNutzer = nachrichten.filter((m) => m.role === "user");
    const letzte = vonNutzer[vonNutzer.length - 1];
    const text = String(letzte?.content ?? "").trim();

    const id = "tel-" + Math.abs(Number(String(req.body?.model || "").length) + nachrichten.length) + "-" + nachrichten.length;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    if (!text) {
      res.write(stueck(id, "", "stop"));
      return res.end("data: [DONE]\n\n");
    }

    // ERSTE RUNDE EINES ANRUFS: Verlauf zuruecksetzen. Ein Anruf ist ein eigenes
    // Gespraech — ohne das bezieht sich Alexandra auf etwas von vorgestern.
    if (vonNutzer.length <= 1) {
      try { await fetch(SELF + "/api/sprache/neu", { method: "POST", headers: { cookie: keks } }); } catch {}
    }

    let gesagt = "";
    const sagen = (s) => {
      const sauber = String(s || "").trim();
      if (!sauber) return;
      gesagt += (gesagt ? " " : "") + sauber;
      try { res.write(stueck(id, (gesagt === sauber ? "" : " ") + sauber)); } catch {}
    };

    try {
      let antwort = await frageStroemen(text, sagen);
      if (antwort === "neu-anmelden") { await anmelden(); antwort = await frageStroemen(text, sagen); }
    } catch (e) {
      console.error("Telefon-Gehirn:", e.message);
      if (!gesagt) sagen("Da ist gerade etwas schiefgelaufen, sag es nochmal.");
    }

    // Auch bei völliger Stille muss etwas kommen — sonst haengt die Leitung.
    if (!gesagt) sagen("Ich hab dich nicht verstanden.");
    res.write(stueck(id, "", "stop"));
    res.end("data: [DONE]\n\n");
  });

  console.log("Telefon: Alexandras Gehirn unter /telefon/v1/chat/completions" +
    (GEHEIM ? "" : " — ACHTUNG: TELEFON_SECRET fehlt, der Endpunkt weist alles ab."));
}

// Fragt die normale Sprachroute im Stromverfahren und reicht jeden fertigen
// Satz sofort weiter. Genau dieselbe Route wie Browser und Telegram.
async function frageStroemen(text, sagen) {
  const r = await fetch(SELF + "/api/sprache/frage?strom=1", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: keks, accept: "text/event-stream" },
    body: JSON.stringify({ text }),
    redirect: "manual",
  });
  if (anmelden_noetig(r.status)) return "neu-anmelden";
  if (!r.body) return "leer";

  const leser = r.body.getReader();
  const dekoder = new TextDecoder();
  let rest = "";
  while (true) {
    const { done, value } = await leser.read();
    if (done) break;
    rest += dekoder.decode(value, { stream: true });
    const zeilen = rest.split("\n\n");
    rest = zeilen.pop() || "";
    for (const z of zeilen) {
      const roh = z.replace(/^data:\s*/, "").trim();
      if (!roh) continue;
      let d; try { d = JSON.parse(roh); } catch { continue; }
      if (d.typ === "satz") sagen(d.text);
      // "fertig" traegt, was der Server ZUSAETZLICH sagt — die Bestaetigung
      // ("Steht, Dienstag um elf"). Der schon gestroemte Teil ist dort bereits
      // abgezogen, es kommt also nichts doppelt.
      else if (d.typ === "fertig" && d.sprich) sagen(d.sprich);
    }
  }
  return "fertig";
}

module.exports = { anrufen, routen, anmelden, bereit, stand, MAX_AM_TAG, ZIEL };
