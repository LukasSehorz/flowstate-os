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
}
async function dash(pfad, body) {
  const opt = () => ({ method: body ? "POST" : "GET", headers: { ...(body ? { "content-type": "application/json" } : {}), cookie }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  let r = await fetch(SELF + pfad, opt());
  if (r.status === 302 || r.status === 401) { await login(); r = await fetch(SELF + pfad, opt()); }
  return r;
}

// --- Telegram-API ---
async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
async function sendeText(chat, text) { if (text && text.trim()) await tg("sendMessage", { chat_id: chat, text }); }

async function sendeStimme(chat, text) {
  try {
    const r = await dash("/api/sprache/stimme", { text });
    if (!r.ok) return;
    const buf = Buffer.from(await r.arrayBuffer());
    const fd = new FormData();
    fd.append("chat_id", String(chat));
    fd.append("audio", new Blob([buf], { type: "audio/mpeg" }), "antwort.mp3");
    await fetch(`${API}/sendAudio`, { method: "POST", body: fd });
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

  let text = msg.text || msg.caption || "";
  if (!text && (msg.voice || msg.audio)) {
    await tg("sendChatAction", { chat_id: chat, action: "typing" });
    text = await stt((msg.voice || msg.audio).file_id);
  }
  if (!text.trim()) return;

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
async function push(text, { stimme = true } = {}) {
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

module.exports = { starten, push };
module.exports.hatOwner = () => Boolean(owner);
