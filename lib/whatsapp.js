// lib/whatsapp.js — Dashboard-Seite der WhatsApp-Anbindung.
//
// Die Bruecke (eigener Container) schreibt eingehende Nachrichten nach
// /wa/pending.jsonl. Hier holen wir sie ab, filtern auf GESCHAEFTLICHES (Haiku,
// wie bei Mail) und schreiben sie ins Gehirn (eingang/whatsapp/YYYY-MM-DD.md).
// Ausserdem: die Koppel-Seite /whatsapp (QR) und Senden (an bekannte Kontakte).
//
// Privat bleibt privat: Familien-/Freundeschat und Smalltalk werden verworfen,
// nur Firmen-/Kundenrelevantes landet im (privaten) Repo.

const fs = require("fs");
const path = require("path");
const vault = require("./vault.js");
const schnell = require("./schnell.js");
const kontakte = require("./kontakte.js");

const WA_DIR = process.env.WA_DIR || "/wa";
const PENDING = path.join(WA_DIR, "pending.jsonl");
const VERLAUF = path.join(WA_DIR, "verlauf.jsonl");
const QR_PNG = path.join(WA_DIR, "qr.png");
const BRIDGE = process.env.WA_BRIDGE_URL || "http://whatsapp:3100";
const SECRET = process.env.WA_BRIDGE_SECRET || "";

const berlinDatum = (ts) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ts));

async function status() {
  try {
    const r = await fetch(BRIDGE + "/status", { headers: { "x-wa-secret": SECRET }, signal: AbortSignal.timeout(4000) });
    return await r.json();
  } catch { return { verbunden: false, qr: fs.existsSync(QR_PNG) }; }
}

async function senden({ an, text }) {
  const r = await fetch(BRIDGE + "/senden", {
    method: "POST",
    headers: { "content-type": "application/json", "x-wa-secret": SECRET },
    body: JSON.stringify({ an, text }),
    // Die Bruecke wartet bis zu 7 s auf die Zustellbestaetigung -> hier mehr Luft.
    signal: AbortSignal.timeout(15000),
  });
  return r.json();   // { ok, an, id, status, zugestellt }
}

// Zustellstatus einer schon gesendeten Nachricht nachfragen (zum Nachfassen,
// wenn sie beim Senden noch nicht zugestellt war). zugestellt = zwei Haken.
async function zustellung(id) {
  try {
    const r = await fetch(BRIDGE + "/zustellung?id=" + encodeURIComponent(id),
      { headers: { "x-wa-secret": SECRET }, signal: AbortSignal.timeout(4000) });
    return await r.json();
  } catch { return { id, status: 0, zugestellt: false }; }
}

// Haiku sortiert: nur geschaeftlich Relevantes. Bei Aussetzer lieber behalten.
async function nurGeschaeftlich(nachrichten) {
  if (!nachrichten.length || !schnell.verfuegbar()) return nachrichten;
  const liste = nachrichten.map((m, i) =>
    `${i + 1}. Von ${m.von}${m.gruppe ? " (Gruppe)" : ""}: ${m.text.replace(/\s+/g, " ").slice(0, 160)}`
  ).join("\n");
  const system =
    "Du sortierst Lukas' WhatsApp fuers Firmen-Wissensarchiv. BEHALTE nur geschaeftlich " +
    "Relevantes: Kundenanfragen, Nachrichten von Partnern/Lieferanten/Interessenten, " +
    "Projekt-/Firmenabsprachen, Termine, Angebote, Rechnungen. VERWIRF klar Privates, " +
    "Smalltalk, Familien-/Freundeschat, Werbung, Ketten-/Statusnachrichten. Antworte NUR " +
    "mit einem JSON-Array der Nummern zum Behalten (z. B. [1,3]). Nichts sonst.";
  try {
    const roh = await schnell.frage(system, liste, { maxTokens: 120, temp: 0 });
    const keep = new Set(JSON.parse((roh.match(/\[[\d,\s]*\]/) || ["[]"])[0]).map(Number));
    return nachrichten.filter((_, i) => keep.has(i + 1));
  } catch { return nachrichten; }
}

async function verarbeitePending() {
  if (!vault.schreibbar("eingang")) return { ok: false, grund: "eingang nicht beschreibbar" };
  let roh;
  try { roh = fs.readFileSync(PENDING, "utf-8"); } catch { return { ok: true, neu: 0 }; }
  const zeilen = roh.split("\n").filter(Boolean);
  if (!zeilen.length) return { ok: true, neu: 0 };

  const msgs = zeilen.map((z) => { try { return JSON.parse(z); } catch { return null; } }).filter(Boolean);

  // Schon erfasste IDs (ueber die betroffenen Tagesnotizen).
  const tage = [...new Set(msgs.map((m) => berlinDatum(m.ts * 1000)))];
  const schonDa = new Set();
  for (const t of tage)
    for (const x of vault.lesen("eingang/whatsapp/" + t + ".md").matchAll(/<!--\s*id:([^\s]+)\s*-->/g))
      schonDa.add(x[1]);
  const neuMsgs = msgs.filter((m) => m.id && !schonDa.has(m.id));
  if (!neuMsgs.length) { fs.writeFileSync(PENDING, ""); return { ok: true, neu: 0 }; }

  const behalten = await nurGeschaeftlich(neuMsgs);
  const nachTag = {};
  for (const m of behalten) (nachTag[berlinDatum(m.ts * 1000)] ||= []).push(m);

  let gesamt = 0;
  for (const datum of Object.keys(nachTag).sort()) {
    const rel = "eingang/whatsapp/" + datum + ".md";
    if (!vault.lesen(rel)) {
      const lang = new Date(datum + "T12:00:00").toLocaleDateString("de-DE",
        { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
      vault.schreibe(rel, `---\ntyp: whatsapp\ndatum: ${datum}\n---\n\n# WhatsApp · ${lang}\n\n`);
    }
    for (const m of nachTag[datum].sort((a, b) => a.ts - b.ts)) {
      const zeit = new Date(m.ts * 1000).toLocaleString("de-DE",
        { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      vault.anhaenge(rel, `**${m.von}${m.gruppe ? " (Gruppe)" : ""}** · ${zeit}\n${m.text}\n\n<!-- id:${m.id} -->\n\n`);
      gesamt++;
    }
  }

  // Alle verarbeiteten (behalten ODER verworfen) aus pending entfernen.
  const erledigt = new Set(neuMsgs.map((m) => m.id));
  const rest = zeilen.filter((z) => { try { return !erledigt.has(JSON.parse(z).id); } catch { return false; } });
  fs.writeFileSync(PENDING, rest.length ? rest.join("\n") + "\n" : "");
  return { ok: true, neu: gesamt, geprueft: neuMsgs.length };
}

// --- Routen: Koppel-Seite + QR-Bild ---
function routen(app, { layout } = {}) {
  app.get("/whatsapp", async (req, res) => {
    const s = await status();
    const inner = s.verbunden
      ? `<div class="card"><h2>✅ WhatsApp verbunden</h2>
           <p class="muted">Eingehende Nachrichten fliessen ins Gehirn (eingang/whatsapp) — nur Geschaeftliches, Privates bleibt draussen.</p></div>`
      : `<div class="card"><h2>📲 WhatsApp koppeln</h2>
           <p>Am Handy: <b>WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät verknüpfen</b>, dann diesen Code scannen:</p>
           ${s.qr
             ? `<img src="/whatsapp/qr.png?t=${Date.now()}" width="320" style="background:#fff;padding:14px;border-radius:14px">
                <p class="muted">Nach dem Scannen verbindet sich der Dienst automatisch — Seite dann neu laden.</p>`
             : `<p class="muted">QR wird gerade erzeugt… ein paar Sekunden warten und Seite neu laden.</p>`}</div>`;
    res.send(layout ? layout("WhatsApp", "whatsapp", inner, req) : inner);
  });

  app.get("/whatsapp/qr.png", (req, res) => {
    fs.stat(QR_PNG, (err) => {
      if (err) return res.status(404).end();
      res.setHeader("content-type", "image/png");
      res.setHeader("cache-control", "no-store");
      fs.createReadStream(QR_PNG).pipe(res);
    });
  });
}

// Einen Chat lesen: Name -> Nummer (Kontakte) -> letzte Nachrichten aus dem
// server-lokalen Verlauf. Nur Nachrichten SEIT Verbindungsstart (WhatsApp liefert
// keine Alt-Historie an ein neu verknuepftes Geraet — das sagt Alexandra ehrlich).
// Nummer -> aktuelle Chat-IDs (inkl. LID) ueber die Bruecke aufloesen. WhatsApp
// adressiert Chats ueber eine Privacy-ID (LID), nicht die Nummer — sonst faende
// die Suche nichts.
async function chatIds(nummer) {
  try {
    const r = await fetch(BRIDGE + "/aufloesen?nummer=" + encodeURIComponent(nummer),
      { headers: { "x-wa-secret": SECRET }, signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    return [nummer + "@s.whatsapp.net", d.jid, d.lid].filter(Boolean);
  } catch { return [nummer + "@s.whatsapp.net"]; }
}

// Sprechfertig: die letzte Nachricht des Kontakts, dazu ein knapper Verlauf.
// Kein Nachbearbeiten durchs Modell (sonst wird geraten) — wird direkt gesprochen.
async function leseChat(name, { max = 5 } = {}) {
  const ziel = kontakte.finde(name);
  if (!ziel || !ziel.nummer) return { ok: true, reply: `Ich find keinen Kontakt „${name}“ — sag mir den Namen genauer.` };
  const jids = new Set(await chatIds(ziel.nummer));
  let roh;
  try { roh = fs.readFileSync(VERLAUF, "utf-8"); } catch { roh = ""; }
  const alle = roh.split("\n").filter(Boolean)
    .map((z) => { try { return JSON.parse(z); } catch { return null; } })
    .filter((m) => m && jids.has(m.jid));
  if (!alle.length) {
    return { ok: true, reply: `Von ${ziel.name} hab ich seit dem Koppeln nichts mitbekommen — ältere Chats zieht WhatsApp leider nicht rüber.` };
  }
  const msgs = alle.slice(-max);
  const letzteVonIhm = [...alle].reverse().find((m) => m.richtung === "sie");
  const verlauf = msgs.map((m) => `${m.richtung === "ich" ? "du" : ziel.name}: ${m.text}`).join(" — ");
  const kopf = letzteVonIhm
    ? `${ziel.name} hat dir zuletzt geschrieben: „${letzteVonIhm.text}“.`
    : `Im Chat mit ${ziel.name} hast zuletzt du geschrieben.`;
  return { ok: true, reply: msgs.length > 1 ? `${kopf} Kurzer Verlauf — ${verlauf}.` : kopf, kontakt: ziel.name };
}

module.exports = routen;
module.exports.verarbeitePending = verarbeitePending;
module.exports.senden = senden;
module.exports.zustellung = zustellung;
module.exports.status = status;
module.exports.leseChat = leseChat;
