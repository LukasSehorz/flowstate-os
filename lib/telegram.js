// lib/telegram.js — Alexandra auf Telegram (Schnellspur + Sprachantwort).
//
// Ein EIGENER Bot (Token via @BotFather), unabhaengig von Hermes' Telegram.
// Er nutzt exakt die Schnellspur des Dashboards (interner Aufruf mit Session):
// Text ODER Sprachnachricht rein -> schnelle Antwort als Text UND Stimme raus.
// Laenger laufende Auftraege (Recherche/Hermes) meldet er nach.
//
// Aktiviert sich nur, wenn TELEGRAM_BOT_TOKEN gesetzt ist — sonst schlummert er.
//
// Sicherheit: nur der EIGENTUEMER-Chat darf ihn steuern (der Bot kann Mails/
// WhatsApp senden und das Gehirn lesen). Ohne TELEGRAM_ALLOWED_CHAT koppelt sich
// der Bot an den ersten Chat, der ihn anschreibt, und merkt ihn sich.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const vault = require("./vault.js");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : "";
const FILEAPI = TOKEN ? `https://api.telegram.org/file/bot${TOKEN}` : "";
const SELF = process.env.SELF_URL || "http://127.0.0.1:3000";
const PW = process.env.DASHBOARD_PASSWORD || "";
const EL_KEY = process.env.ELEVENLABS_API_KEY;
const DATA = process.env.DATA_PATH || path.join(__dirname, "..", "data");
const OWNER_DATEI = path.join(DATA, "telegram-owner.json");

let cookie = "";
let offset = 0;
let owner = ladeOwner();

function ladeOwner() {
  if (process.env.TELEGRAM_ALLOWED_CHAT) return String(process.env.TELEGRAM_ALLOWED_CHAT);
  try { return String(JSON.parse(fs.readFileSync(OWNER_DATEI, "utf-8")).chat); } catch { return ""; }
}
function merkeOwner(chat) {
  owner = String(chat);
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(OWNER_DATEI, JSON.stringify({ chat: owner })); } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const berlinDatum = (ts) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ts));

// --- interne Schnellspur (mit Session-Cookie wie der Browser) ---
async function login() {
  const r = await fetch(SELF + "/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PW }), redirect: "manual",
  });
  const setc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")].filter(Boolean);
  cookie = (setc || []).map((c) => c.split(";")[0]).join("; ");

  // ZWEITER SCHRITT (07.08.): Das Dashboard-Passwort oeffnet das Dashboard, aber
  // nicht die Buchhaltung — die haengt an einem CRM-Konto. Ohne diesen Schritt
  // wurden alle Belege mit einer Umleitung nach /crm/anmelden abgewiesen.
  //
  // Scheitert er, bleibt die Dashboard-Sitzung trotzdem gueltig: Kalender,
  // Wetter und Sprache laufen weiter. Nur die Buchhaltung wuerde dann klemmen,
  // und das faellt dort einzeln auf, statt hier alles mitzureissen.
  try {
    const d = await fetch(SELF + "/intern/dienst-anmelden", {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ passwort: PW }),
    });
    if (!d.ok) console.error("Dienstanmelden:", d.status, (await d.text()).slice(0, 120));
  } catch (e) { console.error("Dienstanmelden:", e.message); }
}
const beleg = require("./beleg-telegram.js");
const belegErstellen = require("./beleg-erstellen.js");

// Eine Datei von Telegram holen. Bisher gab es das nur eingebacken in stt() —
// fuer Belege braucht es denselben Weg mit den rohen Bytes.
async function holeDatei(fileId) {
  const f = await tg("getFile", { file_id: fileId });
  const pfad = f.result?.file_path;
  if (!pfad) throw new Error("Telegram gibt die Datei nicht heraus");
  const r = await fetch(`${FILEAPI}/${pfad}`);
  if (!r.ok) throw new Error("Download " + r.status);
  return Buffer.from(await r.arrayBuffer());
}

async function dash(pfad, body, extraKopf) {
  // Buffer = rohe Datei (Belegupload), sonst JSON. Der Belegendpunkt nimmt
  // application/octet-stream und liest den Dateinamen aus einer Kopfzeile.
  const roh = Buffer.isBuffer(body);
  const opt = () => ({
    method: body ? "POST" : "GET",
    headers: {
      ...(roh ? { "content-type": "application/octet-stream" } : (body ? { "content-type": "application/json" } : {})),
      ...(extraKopf || {}), cookie,
    },
    body: body ? (roh ? body : JSON.stringify(body)) : undefined,
    redirect: "manual",
  });
  let r = await fetch(SELF + pfad, opt());
  if (r.status === 302 || r.status === 401) {
    await login();
    r = await fetch(SELF + pfad, opt());
    // Weist der Server auch nach dem Anmelden ab, ist das eine Meldung wert.
    // Vorher verschwand es lautlos: Der Aufrufer sah nur eine Umleitung und
    // hielt sie fuer ein Problem der Datei. So sind vier Rechnungen aus dem
    // Postfach als "nicht verarbeitet" gemeldet worden, obwohl sie in Ordnung
    // waren.
    //
    // Nur eine Umleitung AUF EINE ANMELDESEITE zaehlt. Die Formular-Endpunkte
    // leiten nach getaner Arbeit ebenfalls um ("302 -> /buchhaltung") — das ist
    // dort der Erfolgsfall, und ihn zu melden macht die Meldung wertlos.
    const ziel = r.headers.get("location") || "";
    if (r.status === 401 || /anmelden|\/login/.test(ziel)) {
      console.error(`Dashboard weist ${pfad} auch nach dem Anmelden ab (${r.status} -> ${ziel || "?"}).`);
    }
  }
  return r;
}

// --- Telegram-API ---
async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
async function sendeText(chat, text) { if (text && text.trim()) await tg("sendMessage", { chat_id: chat, text }); }

// MP3 (ElevenLabs) -> OGG/Opus, damit Telegram es als echte SPRACHNACHRICHT
// (Voice-Blase mit Wellenform) zeigt, nicht als Musikdatei. ffmpeg per Pipe.
function mp3ZuOgg(mp3) {
  return new Promise((ok) => {
    try {
      const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error",
        "-i", "pipe:0", "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", "-f", "ogg", "pipe:1"]);
      const teile = [];
      ff.stdout.on("data", (d) => teile.push(d));
      ff.on("error", () => ok(null));
      ff.on("close", (code) => ok(code === 0 && teile.length ? Buffer.concat(teile) : null));
      ff.stdin.on("error", () => {});
      ff.stdin.write(mp3); ff.stdin.end();
    } catch { ok(null); }
  });
}

async function sendeStimme(chat, text) {
  try {
    const r = await dash("/api/sprache/stimme", { text });
    if (!r.ok) return;
    const mp3 = Buffer.from(await r.arrayBuffer());
    const ogg = await mp3ZuOgg(mp3);
    const fd = new FormData();
    fd.append("chat_id", String(chat));
    if (ogg) {
      fd.append("voice", new Blob([ogg], { type: "audio/ogg" }), "alexandra.ogg");
      await fetch(`${API}/sendVoice`, { method: "POST", body: fd });
    } else {
      // Fallback, falls ffmpeg fehlt: als Audiodatei.
      fd.append("audio", new Blob([mp3], { type: "audio/mpeg" }), "antwort.mp3");
      await fetch(`${API}/sendAudio`, { method: "POST", body: fd });
    }
  } catch { /* Text kam ja schon */ }
}

// Sprachnachricht -> Text (ElevenLabs Scribe). Faellt bei Fehler auf leer zurueck.
async function stt(fileId) {
  try {
    const f = await tg("getFile", { file_id: fileId });
    const p = f.result?.file_path;
    if (!p || !EL_KEY) return "";
    const audio = Buffer.from(await (await fetch(`${FILEAPI}/${p}`)).arrayBuffer());
    const fd = new FormData();
    fd.append("file", new Blob([audio]), "sprache.oga");
    fd.append("model_id", "scribe_v1");
    const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": EL_KEY }, body: fd });
    const d = await r.json();
    return String(d.text || "").trim();
  } catch { return ""; }
}

// Telegram-Chat mit Alexandra ins Gehirn (eingang/telegram) — nur der eigene Chat.
function insGehirn(text, wer) {
  try {
    if (!vault.schreibbar("eingang")) return;
    const datum = berlinDatum(Date.now());
    const rel = "eingang/telegram/" + datum + ".md";
    if (!vault.lesen(rel)) {
      const lang = new Date(datum + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
      vault.schreibe(rel, `---\ntyp: telegram\ndatum: ${datum}\n---\n\n# Telegram · ${lang}\n\n`);
    }
    const zeit = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
    vault.anhaenge(rel, `**${wer}** · ${zeit}\n${text}\n\n`);
  } catch {}
}

// Auf eine KURZE Aktion warten und ihr Ergebnis zurueckgeben (Telegram zeigt
// derweil "tippt..."). Kein eigenes Senden — der Aufrufer buendelt EINE Antwort.
async function warteKurz(chat, id) {
  for (let i = 0; i < 45; i++) {
    if (i % 2 === 0) tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
    await sleep(1400);
    let d;
    try { d = await (await dash("/api/sprache/auftrag/" + id)).json(); } catch { continue; }
    if (d.unbekannt) return null;
    if (d.fertig) return d.reply || null;
  }
  return null;
}

// Lange Arbeit (Hermes): laeuft im Hintergrund, meldet sich mit EINER Nachricht.
async function verfolgeLang(chat, a) {
  for (let i = 0; i < 300; i++) {
    await sleep(2000);
    let d;
    try { d = await (await dash("/api/sprache/auftrag/" + a.id)).json(); } catch { continue; }
    if (d.unbekannt) return;
    if (d.fertig) {
      if (d.reply) { await sendeText(chat, d.reply); await sendeStimme(chat, d.reply); insGehirn(d.reply, "Alexandra"); }
      return;
    }
  }
}

async function behandle(msg) {
  const chat = msg.chat?.id;
  if (!chat) return;

  // Eigentuemer-Schutz: nur der gekoppelte Chat darf steuern.
  if (!owner) { merkeOwner(chat); await sendeText(chat, "Gekoppelt. Ab jetzt bin ich für dich da. 🌊"); }
  if (String(chat) !== owner) { await sendeText(chat, "Dieser Assistent ist privat."); return; }

  // BELEGE ZUERST (07.08.). Vorher endete jede Nachricht ohne Text hier:
  // "if (!text.trim()) return" — eine Rechnung ohne Bildunterschrift landete
  // im Nichts. Foto und PDF haben Vorrang vor der Textbehandlung.
  const datei = beleg.dateiAus(msg);
  if (datei) {
    if (!beleg.koennteBelegSein(datei)) {
      await sendeText(chat, "Das sieht mir nicht nach einem Beleg aus — schick mir ein Foto oder ein PDF davon.");
      return;
    }
    beleg.vergessen();   // eine neue Datei hebt eine offene Rueckfrage auf
    await tg("sendChatAction", { chat_id: chat, action: "typing" });
    await beleg.verarbeiten({
      datei, holeDatei, dash,
      sagen: (t) => sendeText(chat, t),
    });
    return;
  }

  let text = msg.text || msg.caption || "";
  if (!text && (msg.voice || msg.audio)) {
    await tg("sendChatAction", { chat_id: chat, action: "typing" });
    text = await stt((msg.voice || msg.audio).file_id);
  }
  if (!text.trim()) return;

  // Wartet ein Beleg auf Bestaetigung, ist ein knappes "passt" die Antwort
  // darauf — und keine Frage an Alexandra. Nur eindeutige Ja/Nein-Antworten
  // werden hier gefangen; alles andere laeuft normal weiter.
  if (await beleg.antwortAuf(text, { dash, sagen: (t) => sendeText(chat, t) })) return;

  // Dasselbe fuer eine offene Rechnung oder ein Angebot (07.08.): "Soll ich
  // eine Mail dafuer aufsetzen?" -> "ja". Ohne das liefe das "ja" als neue
  // Frage an Alexandra, die dann nicht mehr weiss, worauf es sich bezieht.
  {
    // Die Dauer wird mitgeschrieben (07.08.). Bei einem Ablauf, der am Ende
    // eine Mail an einen Kunden schickt, ist "wie lange dauert es" keine
    // Neugier — sie entscheidet, ob Lukas ihn im Auto benutzt oder nicht. Ohne
    // Messung liesse sich das hinterher nur schaetzen.
    const vorher = belegErstellen.wasOffen();
    const los = Date.now();
    const r = await belegErstellen.antwortAuf(text);
    if (r) {
      const ms = Date.now() - los;
      console.log(`Beleg-Schritt ${vorher?.schritt || "?"} -> ${belegErstellen.wasOffen()?.schritt || "fertig"}: ${ms} ms`);
      await sendeText(chat, r.reply);
      return;
    }
  }

  insGehirn(text, "Lukas");
  await tg("sendChatAction", { chat_id: chat, action: "typing" });

  let d;
  try { d = await (await dash("/api/sprache/frage", { text })).json(); }
  catch { await sendeText(chat, "Verbindung hakt gerade — sag's gleich nochmal."); return; }

  const auftraege = Array.isArray(d.auftraege) ? d.auftraege : [];
  const lang = auftraege.filter((a) => a.art === "lang");
  const kurz = auftraege.filter((a) => a.art !== "lang");

  // EINE Antwort pro Frage (Text-Chat, kein Voice-Dialog): kurze Zusage weglassen,
  // wenn ohnehin ein Ergebnis kommt; sonst Inhalt + kurze Ergebnisse buendeln.
  const teile = [];
  const nurZusage = auftraege.length && d.sprich && d.sprich.length < 48;
  if (d.sprich && !nurZusage) teile.push(d.sprich);
  for (const a of kurz) {
    const r = await warteKurz(chat, a.id);
    if (r) teile.push(r);
  }

  const antwort = teile.filter(Boolean).join("\n\n").trim();
  if (antwort) {
    await sendeText(chat, antwort);
    await sendeStimme(chat, antwort);
    insGehirn(antwort, "Alexandra");
  } else if (d.sprich && lang.length) {
    // Reine Lang-Aufgabe ohne Vorab-Inhalt: kurz Bescheid geben, Ergebnis folgt.
    await sendeText(chat, d.sprich);
    await sendeStimme(chat, d.sprich);
  }

  // Lange Arbeit meldet sich separat mit EINEM Ergebnis (bei Minuten gerechtfertigt).
  for (const a of lang) verfolgeLang(chat, a).catch(() => {});
}

async function schleife() {
  try {
    const d = await tg("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
    for (const u of (d.result || [])) {
      offset = u.update_id + 1;
      if (u.message) behandle(u.message).catch(() => {});
    }
  } catch { await sleep(2000); }
  setImmediate(schleife);
}

// Melde-Kanal: proaktiv eine Nachricht an Lukas' Chat schicken (Text + Stimme).
// So liefern Dashboard-Automationen (und kuenftig Hermes) ueber die schnelle
// Stimme aus, statt dass Hermes direkt an Telegram schreibt.
// Eine fertige Datei zustellen (PowerPoint, PDF, Word ...).
//
// Gebaut am 05.08. zusammen mit lib/dokument.js: Vorher konnte der Bot nur Text
// und Sprache. Ein fertiges Dokument landete damit nirgends — Hermes legte es
// auf dem Server ab und nannte den Pfad, was auf dem Handy nichts nuetzt.
// Jetzt kommt die Datei dort an, wo Lukas ohnehin hinschaut.
async function sendeDatei(chat, buffer, dateiname, text) {
  const fd = new FormData();
  fd.append("chat_id", String(chat));
  if (text) fd.append("caption", String(text).slice(0, 1000));
  fd.append("document", new Blob([buffer]), dateiname || "datei");
  const r = await fetch(`${API}/sendDocument`, { method: "POST", body: fd });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error("Telegram: " + String(d.description || r.status).slice(0, 120));
}

// Datei an Lukas — mit einem gesprochenen Satz dazu, damit er im Auto merkt,
// dass etwas angekommen ist, ohne aufs Display zu schauen.
async function pushDatei(buffer, dateiname, text, { stimme = true } = {}) {
  if (!TOKEN || !owner) return { ok: false, grund: "kein Bot/Owner" };
  try {
    await sendeDatei(owner, buffer, dateiname, text);
    if (stimme && text) await sendeStimme(owner, text);
    insGehirn(`${text || "Datei"} (${dateiname})`, "Alexandra");
    return { ok: true };
  } catch (e) { return { ok: false, grund: String(e.message).slice(0, 150) }; }
}

async function push(text, { stimme = true } = {}) {
  // Probelauf (20.08.2026): Lange Auftraege stellen ihr Ergebnis von selbst per
  // Telegram zu. Bei sechzig Proben waeren das sechzig Nachrichten samt
  // Sprachdatei auf Lukas' Handy. Siehe lib/probemodus.js.
  const probemodus = require("./probemodus.js");
  if (probemodus.aktiv()) {
    probemodus.notieren("telegram", { text: String(text || "").slice(0, 800) });
    return { ok: true, probe: true };
  }
  if (!TOKEN || !owner || !text || !text.trim()) return { ok: false, grund: "kein Bot/Owner/Text" };
  try {
    await sendeText(owner, text);
    if (stimme) await sendeStimme(owner, text);
    insGehirn(text, "Alexandra");
    return { ok: true };
  } catch (e) { return { ok: false, grund: String(e.message).slice(0, 150) }; }
}

function starten() {
  if (!TOKEN) { console.log("Telegram: kein Token — Bot schlummert."); return; }
  if (!PW) { console.log("Telegram: DASHBOARD_PASSWORD fehlt — Bot kann die Schnellspur nicht aufrufen."); return; }
  login().catch(() => {});
  tg("getMe", {}).then((d) => console.log("Telegram: Bot @" + (d.result?.username || "?") + " aktiv" + (owner ? " (gekoppelt)" : " — warte auf ersten Chat"))).catch(() => {});
  schleife();
}

// dash wird mitexportiert, damit der taegliche Postfachlauf (server.js) die
// angemeldete Dashboard-Sitzung mitbenutzen kann, statt eine zweite aufzubauen.
module.exports = { starten, push, pushDatei, dash };
module.exports.hatOwner = () => Boolean(owner);
