// Flowstate WhatsApp-Bruecke (Baileys) — ein eigener, kleiner Dauerdienst.
//
// Warum eigener Container: Baileys haelt eine dauerhafte WhatsApp-Web-Verbindung
// (verknuepftes Geraet). Getrennt vom Dashboard, damit ein Zick der Verbindung
// nie das laufende OS gefaehrdet.
//
// Was er tut:
//  - Kopplung per QR (einmal scannen, Auth wird persistiert -> ueberlebt Neustart).
//  - Eingehende TEXT-Nachrichten -> anhaengen an /wa/pending.jsonl. Das Dashboard
//    holt sie ab, filtert auf Geschaeftliches (Haiku) und schreibt sie ins Gehirn.
//  - HTTP /senden (nur ueber das interne Docker-Netz): Nachricht verschicken.
//
// Bewusst zurueckhaltend (markOnlineOnConnect:false, keine History-Sync) — nur
// lesen + gelegentlich an bekannte Kontakte senden. Kein Massenversand.

const {
  default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const http = require("http");

const WA_DIR = process.env.WA_DIR || "/wa";
const AUTH_DIR = path.join(WA_DIR, "auth");
const QR_PNG = path.join(WA_DIR, "qr.png");
const PENDING = path.join(WA_DIR, "pending.jsonl");
const SECRET = process.env.WA_BRIDGE_SECRET || "";
const PORT = Number(process.env.WA_BRIDGE_PORT || 3100);

fs.mkdirSync(AUTH_DIR, { recursive: true });

let sock = null, verbunden = false, hatQR = false;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* Default nutzen */ }

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["Flowstate OS", "Chrome", "120.0.0"],
    markOnlineOnConnect: false,   // nicht als "online" erscheinen -> unauffaellig
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      hatQR = true;
      try { await QRCode.toFile(QR_PNG, qr, { width: 420, margin: 2 }); } catch {}
      console.log("QR bereit — unter /whatsapp scannen.");
    }
    if (connection === "open") {
      verbunden = true; hatQR = false;
      try { fs.unlinkSync(QR_PNG); } catch {}
      console.log("WhatsApp verbunden.");
    }
    if (connection === "close") {
      verbunden = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const abgemeldet = code === DisconnectReason.loggedOut;
      console.log("Verbindung geschlossen (code " + code + ")" + (abgemeldet ? " — abgemeldet" : " — reconnect"));
      if (abgemeldet) {
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
      setTimeout(() => start().catch((e) => console.error("Reconnect-Fehler:", e.message)), abgemeldet ? 2000 : 3000);
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) { try { eingang(m); } catch { /* eine Nachricht darf nichts umwerfen */ } }
  });
}

function textAus(m) {
  const msg = m.message || {};
  return msg.conversation || msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption || msg.videoMessage?.caption || "";
}

function eingang(m) {
  if (!m.message || m.key.fromMe) return;                 // nur eingehende
  const jid = m.key.remoteJid || "";
  if (jid === "status@broadcast" || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) return;
  const text = textAus(m).trim();
  if (!text) return;                                       // v1: nur Textnachrichten
  const eintrag = {
    id: m.key.id,
    von: m.pushName || jid.split("@")[0],
    jid,
    gruppe: jid.endsWith("@g.us"),
    ts: Number(m.messageTimestamp) || Math.floor(Date.now() / 1000),
    text: text.slice(0, 2000),
  };
  fs.appendFileSync(PENDING, JSON.stringify(eintrag) + "\n");
}

// --- Kleiner HTTP-Server, nur im Docker-Netz erreichbar (kein Traefik-Label) ---
http.createServer((req, res) => {
  if (SECRET && req.headers["x-wa-secret"] !== SECRET) { res.writeHead(403); return res.end("nein"); }
  const json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };

  if (req.url === "/status") return json({ verbunden, qr: hatQR });

  if (req.url === "/senden" && req.method === "POST") {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", async () => {
      try {
        const { an, text } = JSON.parse(b || "{}");
        if (!sock || !verbunden) { res.writeHead(503); return json({ ok: false, grund: "WhatsApp nicht verbunden" }); }
        const jid = String(an).includes("@") ? an : String(an).replace(/[^0-9]/g, "") + "@s.whatsapp.net";
        await sock.sendMessage(jid, { text: String(text || "") });
        json({ ok: true, an: jid });
      } catch (e) { res.writeHead(500); json({ ok: false, grund: String(e.message).slice(0, 200) }); }
    });
    return;
  }
  res.writeHead(404); res.end("?");
}).listen(PORT, () => console.log("WA-Bruecke HTTP auf Port " + PORT));

start().catch((e) => { console.error("Start-Fehler:", e.message); setTimeout(start, 5000); });
