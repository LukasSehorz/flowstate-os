// Flowstate OS Dashboard — V1 (Gerüst)
// Schichten: Dashboard (hier) -> Hermes (Agent) -> Vault/Daten (unten)
const express = require("express");
const session = require("express-session");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.DASHBOARD_PASSWORD || "";
const VAULT_PATH = process.env.VAULT_PATH || "/vault";
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, "data");
const GWS_ENV = { ...process.env, GWS_ENCRYPTION: "none" };

if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
// Sitzungen auf Platte (ueberleben Container-Neustarts) statt im Arbeitsspeicher
const FileStore = require("session-file-store")(session);
app.use(
  session({
    store: new FileStore({ path: path.join(DATA_PATH, "sessions"), retries: 1, ttl: 60 * 60 * 24 * 30, logFn: () => {} }),
    secret: process.env.SESSION_SECRET || "flowstate-dev-secret",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 },
  })
);

// ---------- Auth ----------
app.get("/login", (req, res) => {
  res.send(layoutBare("Login", `
    <div class="login-box">
      <h1>flowstate<span class="accent">OS</span></h1>
      <p class="muted">Die Zentrale der Sehorz &amp; vom Hofe GbR</p>
      <form method="post" action="/login">
        <input type="password" name="password" placeholder="Passwort" autofocus required>
        <button type="submit">Anmelden</button>
      </form>
      ${req.query.err ? '<p class="error">Falsches Passwort.</p>' : ""}
    </div>`));
});

app.post("/login", (req, res) => {
  if (PASSWORD && req.body.password === PASSWORD) {
    req.session.authed = true;
    return res.redirect("/");
  }
  res.redirect("/login?err=1");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.use((req, res, next) => {
  if (!PASSWORD) return res.status(500).send("DASHBOARD_PASSWORD ist nicht gesetzt.");
  if (req.session.authed) return next();
  // API-Aufrufe bekommen eine klare Meldung statt einer Weiterleitung ins Nichts
  if (req.path.startsWith("/api/")) return res.status(401).json({ ok: false, hint: "Sitzung abgelaufen — bitte Seite neu laden und neu anmelden." });
  res.redirect("/login");
});

// ---------- Module ----------
const MODULES = [
  { id: "zentrale", label: "Zentrale", icon: "◈", href: "/" },
  { id: "chat", label: "Alexandra", icon: "✦", href: "/chat" },
  { id: "leads", label: "Leads", icon: "◎", href: "/leads" },
  { id: "kunden", label: "Kunden (CRM)", icon: "▣", href: "/kunden" },
  { id: "angebote", label: "Angebote & Rechnungen", icon: "▤", href: "/angebote" },
  { id: "buchhaltung", label: "Buchhaltung", icon: "€", href: "/buchhaltung" },
  { id: "marketing", label: "Marketing & Content", icon: "◪", href: "/marketing" },
  { id: "projekte", label: "Projekte", icon: "◫", href: "/projekte" },
  { id: "wissen", label: "Wissen", icon: "❖", href: "/wissen" },
  { id: "agenten", label: "Agenten & Skills", icon: "⬡", href: "/agenten" },
  { id: "einstellungen", label: "Einstellungen", icon: "⚙", href: "/einstellungen" },
];

// ---------- Zentrale ----------
app.get("/", async (req, res) => {
  res.send(layout("Zentrale", "zentrale", `
    <h1>Zentrale</h1>
    <p class="muted">${new Date().toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
    <div class="grid">
      <div class="card" id="card-calendar"><h2>📅 Heute im Kalender</h2><div class="card-body" data-load="/api/calendar">Lade…</div></div>
      <div class="card" id="card-vault"><h2>❖ Wissens-Vault</h2><div class="card-body" data-load="/api/vault/stats">Lade…</div></div>
      <div class="card"><h2>📬 Mail-Triage</h2><div class="card-body"><p class="muted">Kommt als Nächstes: Die vier Körbe aus Alexandras Mail-Triage direkt hier.</p><p>Bis dahin: Frag sie in Telegram — <em>„Führe den mail-triage-Skill aus"</em>.</p></div></div>
      <div class="card"><h2>⬡ System</h2><div class="card-body" data-load="/api/system">Lade…</div></div>
    </div>`));
});

app.get("/api/calendar", (req, res) => {
  // Von Alexandra verifizierter Befehl: Zeitraum "heute" nach Europe/Berlin
  const tz = "Europe/Berlin";
  const fmt = (d) => {
    const p = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    return `${p}T00:00:00+02:00`;
  };
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  execFile(
    "gws-cli",
    ["calendar", "list", "--from", fmt(today), "--to", fmt(tomorrow), "--max", "50"],
    { env: GWS_ENV, timeout: 25000 },
    (err, stdout, stderr) => {
      if (err) return res.json({ ok: false, hint: "Kalender nicht abrufbar.", detail: String(stderr || err.message).slice(0, 300) });
      const data = safeJson(stdout);
      const events = (data && data.events) || [];
      res.json({
        ok: true,
        events: events.map((e) => ({
          titel: e.summary || e.title || "(ohne Titel)",
          start: e.start?.dateTime || e.start?.date || e.start || "",
          ende: e.end?.dateTime || e.end?.date || e.end || "",
          ort: e.location || "",
        })),
      });
    }
  );
});

app.get("/api/vault/stats", (req, res) => {
  try {
    const files = walkVault(VAULT_PATH);
    const mdCount = files.filter((f) => f.endsWith(".md")).length;
    const newest = files
      .map((f) => ({ f, m: fs.statSync(path.join(VAULT_PATH, f)).mtime }))
      .sort((a, b) => b.m - a.m)
      .slice(0, 5);
    res.json({ ok: true, mdCount, newest: newest.map((x) => ({ file: x.f, changed: x.m.toLocaleString("de-DE") })) });
  } catch (e) {
    res.json({ ok: false, hint: "Vault nicht gefunden — Volume-Mount prüfen.", detail: String(e.message) });
  }
});

app.get("/api/system", (req, res) => {
  res.json({
    ok: true,
    app: "flowstate-dashboard v0.1.0",
    uptimeMin: Math.round(process.uptime() / 60),
    vaultMounted: fs.existsSync(VAULT_PATH),
    zeit: new Date().toLocaleString("de-DE"),
  });
});

// ---------- Chat mit Alexandra ----------
app.get("/chat", (req, res) => {
  const configured = Boolean(process.env.HERMES_CHAT_URL);
  res.send(layout("Alexandra", "chat", `
    <h1>Alexandra <span class="muted small">— direkte Leitung zum Agenten</span></h1>
    ${configured ? "" : `<div class="card placeholder"><h2>🔌 Verbindung wird eingerichtet</h2>
      <p>Die Chat-Tür zu Alexandra (Hermes-Webhook) ist noch nicht konfiguriert. Bis dahin erreichst du sie über Telegram.</p></div>`}
    <div class="chat-wrap${configured ? "" : " disabled"}">
      <div id="chat-log" class="chat-log"><div class="msg agent">Hallo Lukas! Schreib mir hier wie in Telegram — ich habe denselben Kopf, dasselbe Gedächtnis und dieselben Regeln. ✦</div></div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" placeholder="Nachricht an Alexandra…" autocomplete="off" ${configured ? "" : "disabled"}>
        <button type="submit" ${configured ? "" : "disabled"}>Senden</button>
      </form>
    </div>
    <script>
      const form = document.getElementById("chat-form"), input = document.getElementById("chat-input"), log = document.getElementById("chat-log");
      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = input.value.trim(); if (!text) return;
        add("user", text); input.value = ""; const pending = add("agent", "…");
        try {
          const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
          const d = await r.json();
          pending.textContent = d.ok ? d.reply : ("⚠️ " + (d.hint || "Fehler"));
        } catch { pending.textContent = "⚠️ Verbindung fehlgeschlagen."; }
        log.scrollTop = log.scrollHeight;
      });
      function add(who, text) { const el = document.createElement("div"); el.className = "msg " + who; el.textContent = text; log.appendChild(el); log.scrollTop = log.scrollHeight; return el; }
    </script>`));
});

// Hermes API-Server (OpenAI-kompatibel, Port 8642) — Verlauf wird pro Session mitgeschickt
app.post("/api/chat", async (req, res) => {
  const url = process.env.HERMES_CHAT_URL;
  if (!url) return res.json({ ok: false, hint: "HERMES_CHAT_URL ist noch nicht konfiguriert." });
  const history = (req.session.chat ||= []);
  history.push({ role: "user", content: String(req.body.message || "") });
  if (history.length > 24) history.splice(0, history.length - 24);
  try {
    const headers = { "Content-Type": "application/json" };
    if (process.env.HERMES_API_KEY) headers["Authorization"] = "Bearer " + process.env.HERMES_API_KEY;
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: process.env.HERMES_MODEL || "hermes-agent", messages: history, stream: false }),
      signal: AbortSignal.timeout(180000),
    });
    const d = await r.json().catch(() => null);
    if (d?.error) return res.json({ ok: false, hint: d.error.message || "Hermes meldet einen Fehler." });
    const reply = d?.choices?.[0]?.message?.content;
    if (!reply) return res.json({ ok: false, hint: "Unerwartete Antwort: " + JSON.stringify(d).slice(0, 300) });
    history.push({ role: "assistant", content: reply });
    res.json({ ok: true, reply });
  } catch (e) {
    res.json({ ok: false, hint: "Hermes nicht erreichbar: " + String(e.message).slice(0, 200) });
  }
});

// ---------- Wissen (Vault-Browser) ----------
app.get("/wissen", (req, res) => {
  let tree = "";
  try {
    tree = renderTree(VAULT_PATH);
  } catch (e) {
    tree = `<p class="error">Vault nicht erreichbar: ${esc(e.message)}</p>`;
  }
  const file = req.query.f ? String(req.query.f) : null;
  let content = `<p class="muted">Wähle links eine Datei — das ist euer Firmengedächtnis (live vom Server, synchron mit Obsidian und GitHub).</p>`;
  if (file) {
    const full = path.join(VAULT_PATH, file);
    if (full.startsWith(path.resolve(VAULT_PATH)) && fs.existsSync(full) && full.endsWith(".md")) {
      content = `<div class="md">${marked.parse(fs.readFileSync(full, "utf-8"))}</div>`;
    } else {
      content = `<p class="error">Datei nicht gefunden.</p>`;
    }
  }
  res.send(layout("Wissen", "wissen", `
    <h1>Wissen <span class="muted small">— der Vault, live</span></h1>
    <div class="split"><nav class="tree">${tree}</nav><article class="reader">${content}</article></div>`));
});

// ---------- Leads (Grundgerüst mit lokalem Speicher) ----------
const LEADS_FILE = path.join(DATA_PATH, "leads.json");
function readLeads() {
  try { return JSON.parse(fs.readFileSync(LEADS_FILE, "utf-8")); } catch { return []; }
}
function writeLeads(leads) { fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2)); }

// Läufe der Lead-Maschine: Alexandra schreibt Ergebnisse als JSON in den Vault
function readLeadRuns() {
  const dir = path.join(VAULT_PATH, "projekte", "leads");
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try { return { file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) }; }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.lauf?.datum || b.file).localeCompare(String(a.lauf?.datum || a.file)));
  } catch { return []; }
}

function scoreBadge(s) {
  const n = Number(s) || 0;
  const cls = n >= 9 ? "b-gewonnen" : n >= 7 ? "b-kontaktiert" : "b-verloren";
  return `<span class="badge ${cls}">${n}/10</span>`;
}

app.get("/leads", (req, res) => {
  const runs = readLeadRuns();
  const runBlocks = runs.map((r) => {
    const rows = (r.leads || []).map((l) => `
      <tr>
        <td>${esc(l.name)}</td><td>${esc(l.telefon || "–")}</td>
        <td>${l.website ? `<a href="${esc(l.website)}" target="_blank">Website ↗</a>` : "<span class='muted'>keine ✨</span>"}</td>
        <td>${scoreBadge(l.score)}</td>
        <td class="small">${(l.argumente || []).map(esc).join(" · ")}</td>
      </tr>`).join("");
    return `<div class="card">
      <h2>📦 ${esc(r.lauf?.branche || "?")} · ${esc(r.lauf?.region || "?")} <span class="muted small">— ${esc(r.lauf?.datum || "")}, ${(r.leads || []).length} Leads</span></h2>
      ${r.lauf?.sheet_url ? `<p><a href="${esc(r.lauf.sheet_url)}" target="_blank">📊 Google Sheet öffnen ↗</a></p>` : ""}
      <table class="tbl"><thead><tr><th>Name</th><th>Telefon</th><th>Website</th><th>Score</th><th>Verkaufsargumente</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">Keine Leads im Lauf.</td></tr>'}</tbody></table>
    </div>`;
  }).join("");

  const leads = readLeads();
  const manualRows = leads.map((l, i) => `
    <tr>
      <td>${esc(l.name)}</td><td>${esc(l.telefon || "–")}</td>
      <td>${l.website ? `<a href="${esc(l.website)}" target="_blank">${esc(l.website)}</a>` : "–"}</td>
      <td><span class="badge b-${esc(l.status || "neu")}">${esc(l.status || "neu")}</span></td>
      <td>${esc(l.notiz || "")}</td>
      <td><form method="post" action="/leads/delete" class="inline"><input type="hidden" name="i" value="${i}"><button class="tiny danger">✕</button></form></td>
    </tr>`).join("");

  const started = req.query.started === "1";
  res.send(layout("Leads", "leads", `
    <h1>Leads <span class="muted small">— Lead-Maschine (wandert später ins CRM)</span></h1>
    ${started ? `<div class="card" style="border-color:var(--accent)"><h2>🚀 Auftrag an Alexandra gesendet</h2><p>Der Lauf startet im Hintergrund (ca. 8–15 Min). Das Ergebnis erscheint hier und als Google Sheet, sobald es fertig ist — Seite später einfach neu laden.</p></div>` : ""}
    <div class="card"><h2>🎯 Neuen Lauf starten</h2>
      <form method="post" action="/leads/run" class="lead-form">
        <input name="branche" placeholder="Branche (z. B. Physiotherapie)" required>
        <input name="region" placeholder="Region (z. B. München)" required>
        <input name="anzahl" type="number" value="20" min="5" max="100">
        <button type="submit">Lauf starten</button>
      </form>
      <p class="muted small">Ablauf: Apify-Rohdaten → technischer Vorfilter → Screenshot-Bewertung durch parallele Subagenten (Score 1–10, ab 7 = Lead) → Google Sheet + Tabelle hier.</p>
    </div>
    ${runBlocks || '<div class="card"><p class="muted">Noch keine Läufe. Starte oben den ersten — oder warte, bis Alexandra den lead-gen-Skill fertig hat.</p></div>'}
    <div class="card"><h2>✍️ Manuelle Leads</h2><form method="post" action="/leads/add" class="lead-form">
      <input name="name" placeholder="Name / Praxis" required>
      <input name="telefon" placeholder="Telefon">
      <input name="website" placeholder="Website (https://…)">
      <select name="status"><option>neu</option><option>kontaktiert</option><option>termin</option><option>gewonnen</option><option>verloren</option></select>
      <input name="notiz" placeholder="Notiz">
      <button type="submit">Hinzufügen</button>
    </form>
    <table class="tbl"><thead><tr><th>Name</th><th>Telefon</th><th>Website</th><th>Status</th><th>Notiz</th><th></th></tr></thead>
    <tbody>${manualRows || '<tr><td colspan="6" class="muted">Noch keine manuellen Leads.</td></tr>'}</tbody></table></div>`));
});

// Lauf starten -> Auftrag an Alexandra (Hermes-API); sie arbeitet im Hintergrund weiter
app.post("/leads/run", async (req, res) => {
  const { branche, region, anzahl } = req.body;
  const url = process.env.HERMES_CHAT_URL;
  if (!url) return res.redirect("/leads");
  const auftrag = `Starte den lead-gen-Skill als Hintergrund-Lauf mit diesen Parametern: Branche „${branche}", Region „${region}", Anzahl ${Number(anzahl) || 20}. ` +
    `Wichtig: (1) Bestätige mir SOFORT kurz den Start und arbeite dann im Hintergrund weiter (delegierte Subagenten). ` +
    `(2) Schreibe das Endergebnis zusätzlich zum Google Sheet als JSON nach /opt/data/vault/projekte/leads/JJJJ-MM-TT-branche-region.json ` +
    `im Format {"lauf":{"datum","branche","region","anzahl","sheet_url"},"leads":[{"name","telefon","website","adresse","score","argumente":[]}]} — das Dashboard liest diese Datei.`;
  try {
    const headers = { "Content-Type": "application/json" };
    if (process.env.HERMES_API_KEY) headers["Authorization"] = "Bearer " + process.env.HERMES_API_KEY;
    // Nur kurz auf die Startbestätigung warten — der eigentliche Lauf dauert Minuten
    await fetch(url, {
      method: "POST", headers,
      body: JSON.stringify({ model: process.env.HERMES_MODEL || "hermes-agent", messages: [{ role: "user", content: auftrag }], stream: false }),
      signal: AbortSignal.timeout(90000),
    }).catch(() => {});
  } catch {}
  res.redirect("/leads?started=1");
});

app.post("/leads/add", (req, res) => {
  const leads = readLeads();
  const { name, telefon, website, status, notiz } = req.body;
  if (name) leads.push({ name, telefon, website, status, notiz, erstellt: new Date().toISOString() });
  writeLeads(leads);
  res.redirect("/leads");
});

app.post("/leads/delete", (req, res) => {
  const leads = readLeads();
  leads.splice(Number(req.body.i), 1);
  writeLeads(leads);
  res.redirect("/leads");
});

// ---------- Platzhalter-Module ----------
const PLACEHOLDERS = {
  kunden: ["Kunden (CRM)", "Der Eigenbau nach Bereich E: eigene Datenbank, Row-Level-Security, 5 Logins, Pipeline, Call-Listen. Größter Pain Point — kommt als eigenes Bauprojekt."],
  angebote: ["Angebote & Rechnungen", "Templates mit euren Preisen (1-€-Webseite, PM-Pakete, KI-Projekte), einheitliches Format, Status offen/bezahlt. Ablauf: Erstgespräch → Zuruf an Alexandra → Entwurf → Freigabe → raus."],
  buchhaltung: ["Buchhaltung", "Einnahmen & Ausgaben auf einen Blick, Lexware-Anbindung, Beleg-Eingang. Pain Point Nr. 2 aus dem Onboarding."],
  marketing: ["Marketing & Content", "Redaktionsplan, Social-Posts (Masse schlägt Qualität), Kampagnen-Zahlen, Funnel-Übersicht (Zahnärzte, Physios)."],
  projekte: ["Projekte", "Laufende Kundenprojekte mit Status, nächsten Schritten und Verantwortlichen. Entsteht automatisch bei Deal = gewonnen."],
  agenten: ["Agenten & Skills", "Was Alexandra kann: alle Skills, letzte Läufe, Cron-Jobs, Freigaben. Fenster in den Maschinenraum."],
  einstellungen: ["Einstellungen", "Benutzer, Zugänge, Instanzen (Alexandra/Jarvis), Modell-Routing, Kostenübersicht."],
};

for (const [id, [title, desc]] of Object.entries(PLACEHOLDERS)) {
  app.get("/" + id, (req, res) => {
    res.send(layout(title, id, `
      <h1>${title}</h1>
      <div class="card placeholder"><h2>🔜 Modul in Vorbereitung</h2><p>${desc}</p>
      <p class="muted">Das Gerüst steht — dieses Modul wird als nächster Ausbauschritt mit echten Daten und Funktionen gefüllt.</p></div>`));
  });
}

// ---------- Helpers ----------
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function safeJson(s) { try { return JSON.parse(s); } catch { return String(s).slice(0, 2000); } }

function walkVault(dir, base = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) out.push(...walkVault(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

function renderTree(root) {
  const files = walkVault(root).filter((f) => f.endsWith(".md")).sort();
  const byDir = {};
  for (const f of files) {
    const dir = f.includes("/") ? f.split("/")[0] : "· Wurzel";
    (byDir[dir] ??= []).push(f);
  }
  return Object.entries(byDir)
    .map(([dir, fs2]) => `<details open><summary>${esc(dir)}</summary>${fs2
      .map((f) => `<a href="/wissen?f=${encodeURIComponent(f)}">${esc(f.split("/").pop())}</a>`)
      .join("")}</details>`)
    .join("");
}

function layoutBare(title, content) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} · flowstateOS</title><link rel="stylesheet" href="/style.css"></head>
  <body class="bare">${content}</body></html>`;
}

function layout(title, active, content) {
  const nav = MODULES.map((m) => `<a class="${m.id === active ? "active" : ""}" href="${m.href}"><span class="icon">${m.icon}</span>${m.label}</a>`).join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} · flowstateOS</title><link rel="stylesheet" href="/style.css"></head>
  <body><div class="shell">
    <aside class="sidebar"><div class="brand">flowstate<span class="accent">OS</span></div><nav>${nav}</nav>
    <div class="sidebar-foot"><a href="/logout">Abmelden</a></div></aside>
    <main>${content}</main></div>
  <script>
    document.querySelectorAll("[data-load]").forEach(async (el) => {
      try {
        const r = await fetch(el.dataset.load); const d = await r.json();
        el.innerHTML = window.renderCard ? renderCard(el.dataset.load, d) : "<pre>" + JSON.stringify(d, null, 2) + "</pre>";
      } catch (e) { el.innerHTML = "<p class='error'>Fehler beim Laden.</p>"; }
    });
    function renderCard(src, d) {
      if (!d.ok) return "<p class='muted'>" + (d.hint || "Noch nicht verbunden.") + "</p>";
      if (src.includes("vault")) return "<p><strong>" + d.mdCount + "</strong> Wissens-Dateien</p><p class='muted small'>Zuletzt geändert:</p>" + d.newest.map(n => "<div class='row'><span>" + n.file + "</span><span class='muted small'>" + n.changed + "</span></div>").join("");
      if (src.includes("system")) return "<div class='row'><span>App</span><span>" + d.app + "</span></div><div class='row'><span>Läuft seit</span><span>" + d.uptimeMin + " Min</span></div><div class='row'><span>Vault</span><span>" + (d.vaultMounted ? "✅ verbunden" : "❌ fehlt") + "</span></div>";
      if (src.includes("calendar")) {
        if (!d.events || !d.events.length) return "<p class='muted'>Heute keine Termine. 🎉</p>";
        return d.events.map(function (e) {
          var t = e.start && e.start.includes("T") ? new Date(e.start).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "ganztägig";
          return "<div class='row'><span><strong>" + t + "</strong> " + e.titel + "</span>" + (e.ort ? "<span class='muted small'>" + e.ort + "</span>" : "") + "</div>";
        }).join("");
      }
      return "<pre>" + JSON.stringify(d, null, 2) + "</pre>";
    }
  </script></body></html>`;
}

app.listen(PORT, () => console.log(`flowstate-dashboard läuft auf Port ${PORT}`));
