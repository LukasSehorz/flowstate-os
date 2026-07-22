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
const CONTACTS = path.join(WA_DIR, "contacts.json");
const VERLAUF = path.join(WA_DIR, "verlauf.jsonl");
const SECRET = process.env.WA_BRIDGE_SECRET || "";
const PORT = Number(process.env.WA_BRIDGE_PORT || 3100);

fs.mkdirSync(AUTH_DIR, { recursive: true });

let sock = null, verbunden = false, hatQR = false;

// Kontaktbuch aus WhatsApp (jid -> {name, notify}). Bleibt auf dem Server
// (/wa-Volume), NICHT im Git-Vault — Kontaktliste ist rein operativ.
let kontakte = {};
try { kontakte = JSON.parse(fs.readFileSync(CONTACTS, "utf-8")); } catch {}
function speichereKontakte() { try { fs.writeFileSync(CONTACTS, JSON.stringify(kontakte)); } catch {} }
function mergeKontakte(liste) {
  let geaendert = false;
  for (const c of liste || []) {
    if (!c || !c.id) continue;
    const id = c.id;
    if (!id.endsWith("@s.whatsapp.net") && !id.endsWith("@lid")) continue;
    const alt = kontakte[id] || {};
    const name = c.name || c.verifiedName || alt.name || "";
    const notify = c.notify || alt.notify || "";
    if (name !== alt.name || notify !== alt.notify) { kontakte[id] = { name, notify, lid: c.lid || alt.lid || "" }; geaendert = true; }
    // Manche Kontakte tragen zusaetzlich ihre LID -> als eigenen Eintrag spiegeln,
    // damit LID-adressierte Nachrichten den Adressbuchnamen bekommen.
    if (c.lid && c.lid.endsWith("@lid") && name) {
      const l = kontakte[c.lid] || {};
      if (l.name !== name) { kontakte[c.lid] = { name, notify: l.notify || notify || "", pn: id }; geaendert = true; }
    }
  }
  if (geaendert) speichereKontakte();
}

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
      // Adressbuch aktiv nachziehen: das Erst-Sync lief evtl. vor unserem Handler,
      // beim Reconnect kommen nur noch Deltas. resyncAppState stoesst die
      // Kontakt-Kollektionen neu an -> contacts.set/upsert feuern.
      setTimeout(async () => {
        try {
          await sock.resyncAppState(["critical_unblock_low", "regular_high", "regular_low", "regular"], false);
          console.log("Kontakt-Resync fertig — " + Object.keys(kontakte).length + " Kontakte bekannt.");
        } catch (e) { console.log("Kontakt-Resync-Hinweis:", String(e.message).slice(0, 120)); }
      }, 4000);
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

  // Kontakte aus WhatsApp mitnehmen — damit "schick Jannik ..." aufloesbar ist.
  sock.ev.on("contacts.set", (arg) => mergeKontakte(arg?.contacts || arg));
  sock.ev.on("contacts.upsert", (arg) => mergeKontakte(arg));
  sock.ev.on("contacts.update", (arg) => mergeKontakte(arg));
  sock.ev.on("messaging-history.set", (arg) => mergeKontakte(arg?.contacts));

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      // Absendername als schwache Kontaktquelle mitnehmen (falls Adressbuch leer).
      try {
        const jid = m.key?.remoteJid;
        if (jid && jid.endsWith("@s.whatsapp.net") && m.pushName && !kontakte[jid]?.name) {
          mergeKontakte([{ id: jid, notify: m.pushName }]);
        }
      } catch {}
      try { verlaufSpeichern(m); } catch {}   // ALLE Chats mitschreiben (nur lesen)
      try { eingang(m); } catch { /* eine Nachricht darf nichts umwerfen */ }
    }
  });
}

// Rollender Chatverlauf (ein- UND ausgehend, alle Chats) — NUR server-lokal im
// /wa-Volume, NIE im Git-Vault. Damit Alexandra einen Chat auf Zuruf lesen kann.
function verlaufSpeichern(m) {
  const jid = m.key?.remoteJid || "";
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) return;
  const text = textAus(m).trim();
  if (!text) return;
  const eintrag = {
    jid,
    richtung: m.key.fromMe ? "ich" : "sie",
    von: m.key.fromMe ? "Lukas" : (m.pushName || jid.split("@")[0]),
    ts: Number(m.messageTimestamp) || Math.floor(Date.now() / 1000),
    text: text.slice(0, 1000),
  };
  fs.appendFileSync(VERLAUF, JSON.stringify(eintrag) + "\n");
  try {
    if (fs.statSync(VERLAUF).size > 900 * 1024) {
      const zeilen = fs.readFileSync(VERLAUF, "utf-8").split("\n").filter(Boolean);
      fs.writeFileSync(VERLAUF, zeilen.slice(-2500).join("\n") + "\n");
    }
  } catch {}
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

  // Nummer -> aktuelle Chat-ID(s) aufloesen (fuer LID<->Nummer beim Lesen).
  if (req.url.startsWith("/aufloesen")) {
    (async () => {
      try {
        const nr = new URL(req.url, "http://x").searchParams.get("nummer");
        if (!sock || !verbunden || !nr) return json({ jid: null, lid: null });
        const r = await sock.onWhatsApp(nr.replace(/[^0-9]/g, ""));
        json({ jid: r?.[0]?.jid || null, lid: r?.[0]?.lid || null, roh: JSON.stringify(r?.[0] || null).slice(0, 200) });
      } catch (e) { json({ jid: null, fehler: String(e.message).slice(0, 150) }); }
    })();
    return;
  }

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
