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
let reconnectGeplant = false;   // verhindert gestapelte Reconnects (Doppel-Socket)

// Zugestellte-Verfolgung + Retry-Speicher (Fix 22.07. fuer "nur ein Haken"):
//  - gesendet: die zuletzt gesendeten Nachrichten-Inhalte, damit getMessage bei
//    einer Retry-Receipt (Empfaenger konnte nicht entschluesseln) NEU senden kann.
//    OHNE das bleibt eine unzustellbare Nachricht fuer immer bei einem Haken.
//  - zustellStatus: hoechster empfangener Status je Nachrichten-ID
//    (2 = beim Server, 3 = beim Empfaenger zugestellt, 4 = gelesen). So kann
//    /senden ehrlich melden, ob es WIRKLICH angekommen ist.
const gesendet = new Map();
const zustellStatus = new Map();
function merkeGesendet(id, message) {
  if (!id || !message) return;
  gesendet.set(id, message);
  if (gesendet.size > 500) gesendet.delete(gesendet.keys().next().value);
}

// Kontaktbuch aus WhatsApp (jid -> {name, notify}). Bleibt auf dem Server
// (/wa-Volume), NICHT im Git-Vault — Kontaktliste ist rein operativ.
let kontakte = {};
try { kontakte = JSON.parse(fs.readFileSync(CONTACTS, "utf-8")); } catch {}
function speichereKontakte() { try { fs.writeFileSync(CONTACTS, JSON.stringify(kontakte)); } catch {} }
// --- Ungelesen-Zaehler je Chat --------------------------------------------
//
// Geschrieben wird nach chats.json: { "<jid>": { unread, t } }.
//
// Zwei Eigenheiten von Baileys, die hier beruecksichtigt sind:
//
//   - "chats.update" liefert TEILobjekte. Fehlt unreadCount, bleibt der alte
//     Wert stehen — sonst wuerde jede Namensaenderung den Zaehler loeschen.
//   - unreadCount kann NEGATIV kommen (-1 heisst "als ungelesen markiert").
//     Das wird als "mindestens eine" gewertet, nicht als Unfug weitergereicht.
//
// Bewusst NICHT gespeichert wird der Nachrichteninhalt — der steht im Verlauf.
// Hier liegt nur die Zahl, die es sonst nirgends gibt.
const CHATS = path.join(WA_DIR, "chats.json");
let chats = {};
try { chats = JSON.parse(fs.readFileSync(CHATS, "utf-8")); } catch { chats = {}; }
let chatsSchreibt = null;
function speichereChats() {
  clearTimeout(chatsSchreibt);
  chatsSchreibt = setTimeout(() => {
    try { fs.writeFileSync(CHATS, JSON.stringify(chats)); } catch {}
  }, 500);   // gebuendelt: bei der Erstsynchronisierung kommen hunderte auf einmal
}

function mergeChats(liste) {
  let geaendert = false;
  for (const c of liste || []) {
    if (!c || !c.id) continue;
    const alt = chats[c.id] || {};
    let unread = alt.unread || 0;
    if (c.unreadCount != null) unread = c.unreadCount < 0 ? 1 : c.unreadCount;
    const t = Number(c.conversationTimestamp?.low ?? c.conversationTimestamp ?? alt.t ?? 0) || 0;
    if (unread !== alt.unread || t !== alt.t) { chats[c.id] = { unread, t }; geaendert = true; }
  }
  if (geaendert) speichereChats();
}

// Schreibt Lukas selbst in einen Chat, hat er ihn offen — dann ist dort nichts
// mehr ungelesen. WhatsApp meldet das zwar auch, aber spaeter; so stimmt die
// Zahl sofort und Alexandra liest nicht vor, was er gerade selbst beantwortet.
function chatGelesen(jid) {
  if (!jid || !chats[jid] || !chats[jid].unread) return;
  chats[jid] = { ...chats[jid], unread: 0 };
  speichereChats();
}

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

// Gruppenverzeichnis (jid -> {name}). Wie das Kontaktbuch nur auf dem Server.
// Ohne das liesse sich "schick das in die Gruppe Team Flowstate" nicht
// aufloesen: WhatsApp adressiert Gruppen ueber "<id>@g.us", und diese IDs
// tauchen in den Kontakten nicht auf.
const GRUPPEN = path.join(WA_DIR, "gruppen.json");
let gruppen = {};
try { gruppen = JSON.parse(fs.readFileSync(GRUPPEN, "utf-8")); } catch {}

async function gruppenSammeln() {
  if (!sock || !verbunden) return;
  try {
    const alle = await sock.groupFetchAllParticipating();
    let geaendert = false;
    for (const [jid, g] of Object.entries(alle || {})) {
      const name = g?.subject || "";
      if (!name || gruppen[jid]?.name === name) continue;
      gruppen[jid] = { name };
      geaendert = true;
    }
    if (geaendert) { try { fs.writeFileSync(GRUPPEN, JSON.stringify(gruppen)); } catch {} }
    console.log("Gruppen erfasst — " + Object.keys(gruppen).length + " Gruppen bekannt.");
  } catch (e) {
    console.log("Gruppen-Hinweis:", String(e.message).slice(0, 120));
  }
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
    // Retry-Receipts bedienen: Fragt der Empfaenger eine Nachricht neu an (weil
    // sein Geraet sie nicht entschluesseln konnte), MUSS Baileys den Inhalt neu
    // senden koennen. Ohne diesen Rueckgriff bleibt sie fuer immer bei einem
    // Haken. Das ist der Kern-Fix gegen "rausgeschickt, aber nicht angekommen".
    getMessage: async (key) => gesendet.get(key?.id) || undefined,
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
        gruppenSammeln();
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
      // Alten Socket sauber schliessen und Reconnects NICHT stapeln: mehrere
      // close-Events (oder ein close waehrend schon ein Reconnect laeuft) wuerden
      // sonst zwei Sockets gleichzeitig oeffnen -> Sitzung desynchronisiert
      // (die "Bad MAC"-Fehler). Ein Flag laesst nur EINEN Reconnect zu.
      try { sock?.ev?.removeAllListeners?.(); sock?.ws?.close?.(); } catch {}
      sock = null;
      if (!reconnectGeplant) {
        reconnectGeplant = true;
        setTimeout(() => {
          reconnectGeplant = false;
          start().catch((e) => console.error("Reconnect-Fehler:", e.message));
        }, abgemeldet ? 2000 : 3000);
      }
    }
  });

  // Kontakte aus WhatsApp mitnehmen — damit "schick Jannik ..." aufloesbar ist.
  // CHATS: der echte Ungelesen-Zaehler (27.07.).
  //
  // Bis hierher hoerte die Bruecke auf Kontakte, Gruppen und Nachrichten — aber
  // nie auf chats.*. Genau dort liefert WhatsApp unreadCount je Chat, und
  // "chats.update" kommt auch dann, wenn Lukas einen Chat am HANDY oeffnet:
  // Der Zaehler faellt auf 0. Ohne dieses Ereignis konnte das Dashboard
  // "ungelesen" nur schaetzen (an Lukas' eigenen Nachrichten).
  //
  // messaging-history.set liefert den Anfangsbestand, upsert neue Chats,
  // update die Aenderungen.
  sock.ev.on("messaging-history.set", (arg) => mergeChats(arg?.chats));
  sock.ev.on("chats.set", (arg) => mergeChats(arg?.chats || arg));
  sock.ev.on("chats.upsert", (arg) => mergeChats(arg));
  sock.ev.on("chats.update", (arg) => mergeChats(arg));

  sock.ev.on("contacts.set", (arg) => mergeKontakte(arg?.contacts || arg));
  sock.ev.on("contacts.upsert", (arg) => mergeKontakte(arg));
  sock.ev.on("contacts.update", (arg) => mergeKontakte(arg));
  sock.ev.on("messaging-history.set", (arg) => mergeKontakte(arg?.contacts));

  // Gruppen: neue oder umbenannte mitnehmen, damit die Namen aktuell bleiben.
  sock.ev.on("groups.upsert", () => gruppenSammeln());
  sock.ev.on("groups.update", () => gruppenSammeln());

  // Zustell-Quittungen: WhatsApp meldet den Fortschritt je Nachricht als Status
  // (2 = beim Server, 3 = beim Empfaenger angekommen = zwei Haken, 4 = gelesen).
  // Wir merken uns den hoechsten Wert, damit /senden ehrlich sagen kann, ob es
  // WIRKLICH zugestellt wurde — statt blind "ist raus" bei nur einem Haken.
  sock.ev.on("messages.update", (updates) => {
    for (const u of updates || []) {
      const id = u?.key?.id;
      const st = u?.update?.status;
      if (!id || typeof st !== "number") continue;
      if (st > (zustellStatus.get(id) || 0)) zustellStatus.set(id, st);
      if (zustellStatus.size > 1000) zustellStatus.delete(zustellStatus.keys().next().value);
    }
  });

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
      // Eigene Nachricht (auch vom Handy getippt) heisst: Chat ist offen und
      // damit gelesen. WhatsApp meldet das auch selbst, nur spaeter.
      try { if (m.key?.fromMe) chatGelesen(m.key.remoteJid); } catch {}
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
        const msg = await sock.sendMessage(jid, { text: String(text || "") });
        const id = msg?.key?.id || null;
        // Fuer eine moegliche Retry-Receipt merken (dann kann Baileys neu senden).
        if (id && msg?.message) merkeGesendet(id, msg.message);

        // Auf echte Zustellung warten (Status 3 = zwei Haken). Kommt sofort
        // zurueck, sobald angekommen; sonst hoechstens ~7 s. So melden wir NIE
        // faelschlich "angekommen". (Lukas 22.07.: muss verlaesslich ankommen.)
        let status = zustellStatus.get(id) || 2;
        const bis = Date.now() + 7000;
        while (id && status < 3 && Date.now() < bis) {
          await new Promise((r) => setTimeout(r, 300));
          status = zustellStatus.get(id) || status;
        }
        json({ ok: true, an: jid, id, status, zugestellt: status >= 3 });
      } catch (e) { res.writeHead(500); json({ ok: false, grund: String(e.message).slice(0, 200) }); }
    });
    return;
  }

  // Zustellstatus einer bereits gesendeten Nachricht nachfragen (fuer spaetere
  // Bestaetigung, falls sie beim Senden noch nicht zugestellt war).
  if (req.url.startsWith("/zustellung")) {
    const id = new URL(req.url, "http://x").searchParams.get("id");
    const status = zustellStatus.get(id) || 0;
    return json({ id, status, zugestellt: status >= 3 });
  }
  res.writeHead(404); res.end("?");
}).listen(PORT, () => console.log("WA-Bruecke HTTP auf Port " + PORT));

start().catch((e) => { console.error("Start-Fehler:", e.message); setTimeout(start, 5000); });
