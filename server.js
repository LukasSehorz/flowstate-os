// Flowstate OS Dashboard — V1 (Gerüst)
// Schichten: Dashboard (hier) -> Hermes (Agent) -> Vault/Daten (unten)
const express = require("express");
const session = require("express-session");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const { schale } = require("./lib/schale.js");
const verlauf = require("./lib/verlauf.js");

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

// ---------- CRM (eigener Login mit persoenlichen Konten, RLS in der Datenbank) ----------
if (process.env.DATABASE_URL) {
  try { require("./lib/crm-routes.js")(app); console.log("CRM-Modul geladen"); }
  catch (e) { console.error("CRM-Modul konnte nicht geladen werden:", e.message); }
  try { require("./lib/buchhaltung-routes.js")(app); console.log("Buchhaltungs-Modul geladen"); }
  catch (e) { console.error("Buchhaltungs-Modul konnte nicht geladen werden:", e.message); }
  try { require("./lib/marketing-routes.js")(app); console.log("Marketing-Modul geladen"); }
  catch (e) { console.error("Marketing-Modul konnte nicht geladen werden:", e.message); }
  try { require("./lib/content-routes.js")(app); console.log("Content-Modul geladen"); }
  catch (e) { console.error("Content-Modul konnte nicht geladen werden:", e.message); }
}

// ---------- Auth ----------
app.get("/login", (req, res) => {
  res.send(layoutBare("Login", `
    <div class="login-box">
      <h1>flowstate<span class="accent">OS</span></h1>
      <p class="muted">Die Zentrale der Sehorz &amp; vom Hofe GbR</p>
      <form method="post" action="/login">
        <input type="email" name="email" placeholder="E-Mail" autocomplete="username" autofocus>
        <input type="password" name="password" placeholder="Passwort" autocomplete="current-password" required>
        <button type="submit">Anmelden</button>
      </form>
      <p class="muted small">Mit dem persönlichen Konto anmelden — damit ist auch das CRM offen.
        Ohne E-Mail gilt das gemeinsame Passwort (dann ohne CRM-Zugriff).</p>
      ${req.query.err ? '<p class="error">E-Mail oder Passwort stimmt nicht.</p>' : ""}
    </div>`));
});

// Eine Anmeldung fuer alles: das persoenliche Konto oeffnet OS und CRM zugleich.
// Das gemeinsame Passwort bleibt als Rueckfallebene, gibt aber keinen CRM-Zugriff —
// das CRM braucht eine persoenliche Identitaet, weil die Datenbank daran die
// Zeilenrechte (RLS) haengt. Ein geteiltes Passwort kann Lukas nicht von Louis unterscheiden.
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (email && process.env.DATABASE_URL) {
    try {
      const u = await require("./lib/crm.js").anmelden(email.trim(), password);
      if (u) { req.session.crm = u; req.session.authed = true; return res.redirect("/"); }
    } catch (e) { console.error("Anmeldung fehlgeschlagen:", e.message); }
    return res.redirect("/login?err=1");
  }
  if (PASSWORD && password === PASSWORD) {
    req.session.authed = true;
    return res.redirect("/");
  }
  res.redirect("/login?err=1");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// Melde-Kanal: proaktive Nachricht an Lukas' Telegram (Text + Sprache). STEHT
// bewusst VOR dem Login-Gate, damit Hermes-Crons per HTTP abliefern koennen —
// geschuetzt NUR durch das MELDE_SECRET (faellt ohne Secret geschlossen, sonst
// waere der oeffentliche Endpunkt offen). So liefert Hermes seine Reports/Alerts
// ueber die schnelle Stimme aus, statt selbst an Telegram zu schreiben.
app.post("/api/melde", (req, res) => {
  const secret = process.env.MELDE_SECRET || "";
  if (!secret || String(req.get("x-melde-secret") || "") !== secret) {
    return res.status(403).json({ ok: false, grund: "Secret fehlt oder falsch." });
  }
  const text = String(req.body?.text || "").slice(0, 3000);
  if (!text.trim()) return res.json({ ok: false, grund: "Kein Text." });
  require("./lib/telegram.js").push(text, { stimme: req.body?.stimme !== false })
    .then((r) => res.json(r)).catch((e) => res.json({ ok: false, grund: String(e.message).slice(0, 200) }));
});

app.use((req, res, next) => {
  if (!PASSWORD) return res.status(500).send("DASHBOARD_PASSWORD ist nicht gesetzt.");
  // Wer im CRM angemeldet ist, ist auch im OS angemeldet — eine Identitaet fuer beides.
  if (req.session.authed || req.session.crm) return next();
  // API-Aufrufe bekommen eine klare Meldung statt einer Weiterleitung ins Nichts
  if (req.path.startsWith("/api/")) return res.status(401).json({ ok: false, hint: "Sitzung abgelaufen — bitte Seite neu laden und neu anmelden." });
  res.redirect("/login");
});

// Die Navigation steht jetzt zentral in lib/schale.js (MODULE).

// ---------- Sprache (Alexandra zum Zuhoeren) ----------
// Steht bewusst hinter dem Auth-Gate: Die Routen reichen Kalender, Kennzahlen
// und die Leitung zu Hermes durch — nichts davon gehoert nach aussen offen.
try { require("./lib/sprache-routes.js")(app, { layout }); console.log("Sprach-Modul geladen"); }
catch (e) { console.error("Sprach-Modul konnte nicht geladen werden:", e.message); }

// WhatsApp-Koppelseite (/whatsapp). Die Bruecke laeuft als eigener Container;
// faellt sie aus, zeigt die Seite nur "nicht verbunden" — das Dashboard bleibt heil.
try { require("./lib/whatsapp.js")(app, { layout }); console.log("WhatsApp-Modul geladen"); }
catch (e) { console.error("WhatsApp-Modul konnte nicht geladen werden:", e.message); }

// Telegram-Bot (Alexandra auf Telegram, Schnellspur + Sprachantwort). Schlummert
// ohne TELEGRAM_BOT_TOKEN — beruehrt Hermes' eigenes Telegram nicht.
try { require("./lib/telegram.js").starten(); }
catch (e) { console.error("Telegram-Modul:", e.message); }

// Kalender im Hintergrund frisch halten, damit eine Sprachfrage nicht warten muss.
// Kostet keine Token — das ist ein gws-cli-Aufruf, kein Modell.
//
// Nur der Kalender: Der haengt am Firmenkonto und braucht keine Identitaet.
// Die CRM-Zahlen dagegen laufen ueber Row-Level-Security, also mit den Rechten
// der fragenden Person — die kennt ein Hintergrund-Timer nicht. Die werden
// deshalb beim Fragen aufgefrischt, mit der Sitzung des Fragenden.
{
  const zustand = require("./lib/zustand.js");
  const takt = Number(process.env.ZUSTAND_TAKT_MS || zustand.FRISCHE.kalender);
  const auffrischen = () =>
    zustand.bauen(null, ["kalender"]).catch((e) => console.error("Zustand (Kalender):", e.message));
  auffrischen();
  setInterval(auffrischen, takt).unref();
  console.log(`Zustand: Kalender alle ${Math.round(takt / 60000)} Min.`);
}

// Zweites Gehirn — Zufluss (Entscheidung Lukas 22.07.): Firmen-Aggregatzahlen
// fliessen taeglich als Chronik-Note in den Vault und synchronisieren sich ueber
// vault-sync.sh nach Obsidian. Nur Zahlen, keine Kundendaten (DSGVO). Der Takt
// ist grob (stuendlich pruefen, aber pro Tag EINE Datei ueberschreiben) — so ist
// die Zahl immer aktuell, ohne den Vault mit Versionen zu fluten.
{
  const chronik = require("./lib/chronik.js");
  const vault = require("./lib/vault.js");
  const takt = Number(process.env.CHRONIK_TAKT_MS || 60 * 60 * 1000);
  const laufen = () =>
    chronik.schreibeTagesSnapshot()
      .then((r) => { if (!r.ok) console.error("Chronik:", r.grund); })
      .catch((e) => console.error("Chronik:", e.message));
  if (vault.schreibbar("chronik")) {
    laufen();
    setInterval(laufen, takt).unref();
    console.log(`Zweites Gehirn: Chronik alle ${Math.round(takt / 60000)} Min.`);
  } else {
    console.log("Zweites Gehirn: chronik nicht beschreibbar — Chronik pausiert.");
  }

  // Mail-Zufluss: neue Mails fliessen als Tagesnotiz ins Gehirn (eingang/mail).
  // NEU (Bot-Uebernahme 22.07.): neue geschaeftliche Mails werden zugleich als
  // Telegram-Alert ueber die schnelle Stimme gemeldet — das ersetzt Hermes'
  // Mail-Cron, der nach der Uebernahme nicht mehr direkt an Telegram liefert.
  const posteingang = require("./lib/posteingang.js");
  const telegram = require("./lib/telegram.js");
  const mailTakt = Number(process.env.MAIL_ZUFLUSS_MS || 15 * 60 * 1000);
  const mailLaufen = () =>
    posteingang.erfassen()
      .then((r) => {
        if (r.ok && r.neu) {
          console.log(`Mail-Zufluss: ${r.neu} neue Mail(s) -> ${r.datei}`);
          if (telegram.hatOwner?.() && Array.isArray(r.neueMails) && r.neueMails.length) {
            const liste = r.neueMails.map((m) => `• ${m.von}: ${m.betreff}`).join("\n");
            const wort = r.neu === 1 ? "eine neue geschäftliche Mail" : `${r.neu} neue geschäftliche Mails`;
            telegram.push(`Du hast ${wort}:\n${liste}\nSoll ich zu einer was aufsetzen?`).catch(() => {});
          }
        } else if (!r.ok) console.error("Mail-Zufluss:", r.grund);
      })
      .catch((e) => console.error("Mail-Zufluss:", e.message));
  if (vault.schreibbar("eingang")) {
    mailLaufen();
    setInterval(mailLaufen, mailTakt).unref();
    console.log(`Zweites Gehirn: Mail-Zufluss alle ${Math.round(mailTakt / 60000)} Min.`);
  } else {
    console.log("Zweites Gehirn: eingang nicht beschreibbar — Mail-Zufluss pausiert.");
  }

  // WhatsApp-Zufluss: die Bruecke legt Nachrichten in /wa/pending.jsonl ab; wir
  // holen sie regelmaessig, filtern auf Geschaeftliches und schreiben ins Gehirn.
  const whatsapp = require("./lib/whatsapp.js");
  const waTakt = Number(process.env.WA_ZUFLUSS_MS || 3 * 60 * 1000);
  const waLaufen = () =>
    whatsapp.verarbeitePending()
      .then((r) => { if (r.ok && r.neu) console.log(`WhatsApp-Zufluss: ${r.neu} neue Nachricht(en) ins Gehirn`); else if (!r.ok) console.error("WhatsApp-Zufluss:", r.grund); })
      .catch((e) => console.error("WhatsApp-Zufluss:", e.message));
  if (vault.schreibbar("eingang")) {
    setInterval(waLaufen, waTakt).unref();
    console.log(`Zweites Gehirn: WhatsApp-Zufluss alle ${Math.round(waTakt / 60000)} Min.`);
  }

  // Telegram-Verdichtung (Bauplan P3.3): Aus dem Tagesgespraech mit Alexandra
  // wandern die FAKTEN ins Gehirn — Entscheidungen, Aufgaben, Ideen, kein
  // Protokoll. Sonst versickern Erkenntnisse im Chat. Laeuft ueber Haiku
  // (Extraktion, keine Denkarbeit) und schreibt nach eingang/erkenntnisse/,
  // also NICHT in denselben Ordner wie die Quelle — sonst verdichtet der
  // naechste Lauf seine eigene Ausgabe. Ohne neues Gespraech: kein Modellaufruf.
  const zuflussTelegram = require("./lib/zufluss-telegram.js");
  const tgTakt = Number(process.env.TELEGRAM_VERDICHTUNG_MS || 6 * 60 * 60 * 1000);
  const tgLaufen = () =>
    zuflussTelegram.verdichte()
      .then((r) => { if (r.ok && r.neu) console.log(`Telegram-Verdichtung: ${r.neu} Erkenntnis(se) -> ${r.datei}`); else if (!r.ok) console.error("Telegram-Verdichtung:", r.grund); })
      .catch((e) => console.error("Telegram-Verdichtung:", e.message));
  if (vault.schreibbar("eingang") && zuflussTelegram.verfuegbar()) {
    setInterval(tgLaufen, tgTakt).unref();
    console.log(`Zweites Gehirn: Telegram-Verdichtung alle ${Math.round(tgTakt / 3600000)} Std.`);
  }

  // Von Hand ausloesen (Test / spaeter Dashboard-Kachel).
  app.post("/api/gehirn/telegram", async (req, res) => {
    try { res.json(await zuflussTelegram.verdichte()); }
    catch (e) { res.json({ ok: false, grund: String(e.message).slice(0, 200) }); }
  });
  app.post("/api/gehirn/chronik", async (req, res) => {
    try { res.json(await chronik.schreibeTagesSnapshot()); }
    catch (e) { res.json({ ok: false, grund: String(e.message).slice(0, 200) }); }
  });
  app.post("/api/gehirn/mail", async (req, res) => {
    try { res.json(await posteingang.erfassen()); }
    catch (e) { res.json({ ok: false, grund: String(e.message).slice(0, 200) }); }
  });
  app.post("/api/gehirn/whatsapp", async (req, res) => {
    try { res.json(await whatsapp.verarbeitePending()); }
    catch (e) { res.json({ ok: false, grund: String(e.message).slice(0, 200) }); }
  });

  // (Der Melde-Kanal /api/melde steht bewusst VOR dem Login-Gate — siehe oben.)

  // Proaktiver Tages-Report (Wunsch Lukas 22.07.): jeden Abend um REPORT_STUNDE
  // meldet sich Alexandra ueber die schnelle Stimme (Telegram) mit einem Blick
  // auf morgen — Termine, To-Dos, Zahlen. Dashboard-nativ, mit Stimme.
  const report = require("./lib/report.js");
  const REPORT_STUNDE = Number(process.env.REPORT_STUNDE || 20);
  const berlinStunde = () => Number(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(new Date()));
  const berlinTag = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  // Zwei proaktive Meldungen (Bereich J, "Herzstück"): morgens ein Briefing
  // (Blick auf heute), abends der Report (Blick auf morgen). Beide von Hermes
  // generiert, per Stimme ausgeliefert.
  const BRIEFING_STUNDE = Number(process.env.BRIEFING_STUNDE || 8);
  let letzterReportTag = "", letzterBriefingTag = "";
  const proaktivSenden = async (art, name) => {
    try {
      const r = await report.baueReport({ art });
      if (r.ok && telegram.hatOwner?.()) { await telegram.push(r.text); console.log(`${name} gesendet (${r.quelle || "?"}).`); }
    } catch (e) { console.error(`${name}:`, e.message); }
  };
  const reportPruefen = async () => {
    const heute = berlinTag(), std = berlinStunde();
    if (letzterBriefingTag !== heute && std === BRIEFING_STUNDE) { letzterBriefingTag = heute; await proaktivSenden("morgen", "Morgen-Briefing"); }
    if (letzterReportTag !== heute && std === REPORT_STUNDE) { letzterReportTag = heute; await proaktivSenden("abend", "Abend-Report"); }
  };
  // Das Dashboard besitzt den Report (Entscheidung 22.07.): Es PLANT hier
  // zuverlaessig, laesst ihn von HERMES generieren (report.js) und liest ihn per
  // Stimme vor. Der Hermes-eigene Cron ist deaktiviert — dessen Kosten-Schutz
  // stoppt bei jedem Modellwechsel und er kann keine Stimme. So kommt der Report
  // verlaesslich und in Alexandras Stimme.
  setInterval(reportPruefen, 5 * 60 * 1000).unref();
  console.log(`Zweites Gehirn: Morgen-Briefing ${BRIEFING_STUNDE} Uhr + Abend-Report ${REPORT_STUNDE} Uhr (Hermes generiert, Stimme liest vor).`);

  // Waechter (P4.2): proaktive Warnungen tagsueber. Prueft CRM + Kalender und
  // meldet Neues gebuendelt per Stimme; Tages-Dedup verhindert Wiederholung.
  // Nur zwischen WAECHTER_VON und WAECHTER_BIS, damit nachts Ruhe ist.
  const waechter = require("./lib/waechter.js");
  const WAECHTER_VON = Number(process.env.WAECHTER_VON || 8);
  const WAECHTER_BIS = Number(process.env.WAECHTER_BIS || 20);
  const waechterPruefen = async () => {
    const std = berlinStunde();
    if (std < WAECHTER_VON || std >= WAECHTER_BIS) return;
    try {
      const r = await waechter.pruefe();
      if (r.text && telegram.hatOwner?.()) { await telegram.push(r.text); console.log(`Waechter: ${r.anzahl} Warnung(en) gemeldet.`); }
    } catch (e) { console.error("Waechter:", e.message); }
  };
  setInterval(waechterPruefen, 20 * 60 * 1000).unref();
  console.log(`Zweites Gehirn: Waechter aktiv (${WAECHTER_VON}-${WAECHTER_BIS} Uhr, alle 20 Min).`);

  // Waechter von Hand ausloesen (Test/Vorschau). senden:true schickt per Stimme.
  app.post("/api/gehirn/waechter", async (req, res) => {
    try {
      const r = await waechter.pruefe();
      if (r.text && req.body?.senden && telegram.hatOwner?.()) await telegram.push(r.text);
      res.json(r);
    } catch (e) { res.json({ ok: false, hint: String(e.message).slice(0, 200) }); }
  });

  // Von Hand ausloesen/vorschauen (Test): { art?: "abend"|"morgen", senden?: true }
  app.post("/api/gehirn/report", async (req, res) => {
    try {
      const r = await report.baueReport({ art: req.body?.art === "morgen" ? "morgen" : "abend" });
      if (r.ok && req.body?.senden && telegram.hatOwner?.()) await telegram.push(r.text);
      res.json(r);
    } catch (e) { res.json({ ok: false, grund: String(e.message).slice(0, 200) }); }
  });
}

// ---------- Zentrale ----------
app.get("/", async (req, res) => {
  const heute = new Date().toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  res.send(layout("Zentrale", "zentrale", `
    <div class="head-row">
      <div><p class="muted">${heute}</p></div>
      <div class="qa">
        <form method="post" action="/briefing/neu" class="inline"><button>☀️ Briefing erstellen</button></form>
        <form method="post" action="/skill/mail-triage" class="inline"><button>📬 Mail-Triage starten</button></form>
        <a class="btn-link" href="/leads">🎯 Lead-Lauf</a>
        <a class="btn-link" href="/chat">✦ Alexandra fragen</a>
      </div>
    </div>
    ${req.query.gestartet ? `<div class="card note"><p>🚀 <strong>${esc(req.query.gestartet)}</strong> läuft — Alexandra arbeitet im Hintergrund. Ergebnis erscheint hier, Seite in ein paar Minuten neu laden.</p></div>` : ""}
    <div class="tiles">
      <div class="tile" data-tile="/api/calendar"><span class="tile-num">–</span><span class="tile-label">Termine heute</span></div>
      <div class="tile" data-tile="/api/mail"><span class="tile-num">–</span><span class="tile-label">Wichtige Mails</span></div>
      <div class="tile" data-tile="/api/inbox"><span class="tile-num">–</span><span class="tile-label">Brauchen dich</span></div>
      <div class="tile" data-tile="/api/leads/stats"><span class="tile-num">–</span><span class="tile-label">Leads gesamt</span></div>
      <div class="tile" data-tile="/api/crm/stats"><span class="tile-num">–</span><span class="tile-label">Offene Deals</span></div>
    </div>
    <div class="grid">
      <div class="card wide" id="card-briefing"><h2>☀️ Tages-Briefing <span class="muted small">von Alexandra</span></h2><div class="card-body" data-load="/api/briefing">Lade…</div></div>
      <div class="card"><h2>📅 Kalender
        <span class="cal-nav"><button class="tiny nav" onclick="calShift(-1)">‹</button><span id="cal-label">Heute</span><button class="tiny nav" onclick="calShift(1)">›</button></span></h2>
        <div class="card-body" id="cal-body">Lade…</div></div>
      <div class="card"><h2>📬 Mail-Triage <span class="muted small">vier Körbe</span></h2><div class="card-body" data-load="/api/mail">Lade…</div></div>
      <div class="card"><h2>✅ Was braucht mich?</h2><div class="card-body" data-load="/api/inbox">Lade…</div></div>
      <div class="card"><h2>🎯 Leads</h2><div class="card-body" data-load="/api/leads/stats">Lade…</div></div>
      <div class="card"><h2>▣ Kunden &amp; Pipeline <a class="card-link" href="/crm">CRM öffnen →</a></h2>
        <div class="card-body" data-load="/api/crm/stats">Lade…</div></div>
      <div class="card"><h2>❖ Wissens-Vault</h2><div class="card-body" data-load="/api/vault/stats">Lade…</div></div>
      <div class="card"><h2>⬡ System</h2><div class="card-body" data-load="/api/system">Lade…</div></div>
    </div>`, req));
});

// --- Briefing: Alexandra legt es als Markdown im Vault ab, Dashboard zeigt es an ---
const BRIEFING_FILE = () => path.join(VAULT_PATH, "projekte", "briefing-heute.md");

app.get("/api/briefing", (req, res) => {
  try {
    const f = BRIEFING_FILE();
    if (!fs.existsSync(f)) return res.json({ ok: true, leer: true });
    const stat = fs.statSync(f);
    const alterMin = Math.round((Date.now() - stat.mtime.getTime()) / 60000);
    res.json({ ok: true, html: marked.parse(fs.readFileSync(f, "utf-8")), alterMin, stand: stat.mtime.toLocaleString("de-DE") });
  } catch (e) {
    res.json({ ok: false, hint: "Briefing nicht lesbar." });
  }
});

app.post("/briefing/neu", async (req, res) => {
  const url = process.env.HERMES_CHAT_URL;
  if (url) {
    const auftrag = `Erstelle mein Tages-Briefing und schreibe es als Markdown nach /opt/data/vault/projekte/briefing-heute.md (überschreibe die Datei). ` +
      `Inhalt: (1) Meine heutigen Termine aus dem Google-Kalender. (2) Die wichtigsten ungelesenen Mails, kurz zusammengefasst — nutze deinen mail-triage-Skill. ` +
      `(3) Was aus deiner Sicht heute Priorität hat, mit kurzer Begründung. (4) Falls dir etwas auffällt, das ich übersehen könnte: ein Hinweis. ` +
      `Halte es kompakt, deutsch, in Markdown mit Überschriften. Bestätige mir kurz, wenn die Datei geschrieben ist.`;
    const headers = { "Content-Type": "application/json" };
    if (process.env.HERMES_API_KEY) headers["Authorization"] = "Bearer " + process.env.HERMES_API_KEY;
    fetch(url, { method: "POST", headers, body: JSON.stringify({ model: process.env.HERMES_MODEL || "hermes-agent", messages: [{ role: "user", content: auftrag }], stream: false }), signal: AbortSignal.timeout(170000) }).catch(() => {});
  }
  res.redirect("/?gestartet=Briefing");
});

// Mail-Triage-Skill per Knopf ausführen — Ergebnis landet als JSON im Vault
app.post("/skill/mail-triage", async (req, res) => {
  const url = process.env.HERMES_CHAT_URL;
  if (url) {
    const auftrag = `Führe den mail-triage-Skill aus. Schreibe zusätzlich zur Chat-Übersicht das Ergebnis als JSON nach ` +
      `/opt/data/vault/projekte/mail-triage-heute.json (überschreiben) im Format: ` +
      `{"koerbe":{"dringend":[{"von":"","betreff":"","zusammenfassung":""}],"wichtig":[...],"warten":<anzahl>,"werbung":<anzahl>}} ` +
      `— das Dashboard liest diese Datei. Entwürfe für Korb 1 wie gewohnt nur im Chat vorschlagen, nichts senden.`;
    const headers = { "Content-Type": "application/json" };
    if (process.env.HERMES_API_KEY) headers["Authorization"] = "Bearer " + process.env.HERMES_API_KEY;
    fetch(url, { method: "POST", headers, body: JSON.stringify({ model: process.env.HERMES_MODEL || "hermes-agent", messages: [{ role: "user", content: auftrag }], stream: false }), signal: AbortSignal.timeout(170000) }).catch(() => {});
  }
  res.redirect("/?gestartet=Mail-Triage");
});

// --- Mail-Triage: liest die von Alexandra abgelegte Übersicht ---
app.get("/api/mail", (req, res) => {
  try {
    const f = path.join(VAULT_PATH, "projekte", "mail-triage-heute.json");
    if (!fs.existsSync(f)) return res.json({ ok: true, leer: true });
    const d = JSON.parse(fs.readFileSync(f, "utf-8"));
    const stat = fs.statSync(f);
    res.json({ ok: true, koerbe: d.koerbe || d, stand: stat.mtime.toLocaleString("de-DE") });
  } catch { res.json({ ok: true, leer: true }); }
});

// --- Inbox "Was braucht mich?" (J3): offene Freigaben/Entscheidungen ---
const INBOX_FILE = path.join(DATA_PATH, "inbox.json");
function readInbox() { try { return JSON.parse(fs.readFileSync(INBOX_FILE, "utf-8")); } catch { return []; } }
function writeInbox(x) { fs.writeFileSync(INBOX_FILE, JSON.stringify(x, null, 2)); }

app.get("/api/inbox", (req, res) => {
  // Aus dem Vault (Alexandra) + lokal (manuell) zusammenführen
  let ausVault = [];
  try {
    const f = path.join(VAULT_PATH, "projekte", "inbox.json");
    if (fs.existsSync(f)) ausVault = JSON.parse(fs.readFileSync(f, "utf-8"));
  } catch {}
  const alle = [...(Array.isArray(ausVault) ? ausVault : []), ...readInbox()].filter((x) => !x.erledigt);
  res.json({ ok: true, punkte: alle.slice(0, 8), gesamt: alle.length });
});

app.get("/api/leads/stats", (req, res) => {
  const runs = readLeadRuns();
  const gesamt = runs.reduce((n, r) => n + (r.leads || []).length, 0);
  const top = runs.flatMap((r) => r.leads || []).filter((l) => Number(l.score) >= 9).length;
  res.json({ ok: true, laeufe: runs.length, gesamt, top, letzter: runs[0]?.lauf?.datum || null, manuell: readLeads().length });
});

// CRM-Kennzahlen fuer die Zentrale. Braucht eine persoenliche Anmeldung, weil die
// Datenbank die Zeilenrechte daran haengt — wer nur das gemeinsame Passwort genutzt
// hat, bekommt hier einen Hinweis statt fremder Kundendaten.
app.get("/api/crm/stats", async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ ok: false, hint: "CRM ist nicht eingerichtet." });
  if (!req.session.crm) return res.json({ ok: false, anmeldung: true, hint: "Mit persönlichem Konto anmelden, um das CRM zu sehen." });
  try {
    const z = await require("./lib/crm.js").kennzahlen(req.session.crm);
    res.json({ ok: true, ...z, name: req.session.crm.name });
  } catch (e) {
    console.error("CRM-Kennzahlen:", e.message);
    res.json({ ok: false, hint: "CRM-Datenbank nicht erreichbar." });
  }
});

app.get("/api/calendar", (req, res) => {
  // Von Alexandra verifizierter Befehl: Zeitraum "heute" nach Europe/Berlin.
  // Robust gebaut: nichts hier darf den Prozess werfen — jeder Fehler wird als Hinweis gemeldet.
  try {
    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (d) => {
      // Datum in Europe/Berlin ermitteln (unabhängig von Container-Zeitzone), Offset Juli = +02:00
      let y, m, day;
      try {
        const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d).split("-");
        [y, m, day] = p;
      } catch {
        y = d.getUTCFullYear(); m = pad(d.getUTCMonth() + 1); day = pad(d.getUTCDate());
      }
      return `${y}-${m}-${day}T00:00:00+02:00`;
    };
    const offset = Math.max(-30, Math.min(60, parseInt(req.query.offset, 10) || 0));
    const day = new Date(Date.now() + offset * 86400000);
    const nextDay = new Date(day.getTime() + 86400000);
    execFile(
      "gws-cli",
      ["calendar", "list", "--from", fmt(day), "--to", fmt(nextDay), "--max", "50"],
      { env: GWS_ENV, timeout: 25000 },
      (err, stdout, stderr) => {
        try {
          if (err) return res.json({ ok: false, hint: "Kalender nicht abrufbar.", detail: String(stderr || err.message || err).slice(0, 400) });
          const data = safeJson(stdout);
          // gws-cli verpackt die Termine als JSON-String in einer Sicherheits-Huelle:
          // { events: { warning: "EXTERNAL CONTENT...", data: "[{...}]", security_warnings: [...] } }
          let events = null;
          const huelle = data && data.events;
          if (huelle && typeof huelle === "object" && typeof huelle.data === "string") {
            const inner = safeJson(huelle.data);
            if (Array.isArray(inner)) events = inner;
          }
          if (!events) {
            for (const c of [data, data?.events, data?.items, data?.data]) {
              if (Array.isArray(c) && !(c[0] && typeof c[0] === "object" && "matched_text" in c[0])) { events = c; break; }
            }
          }
          if (!events) return res.json({ ok: false, hint: "Unbekanntes Kalender-Format — Rohdaten:", detail: String(stdout).slice(0, 350) });
          // Abgesagte Termine ausblenden
          events = events.filter((e) => (e.status || "confirmed") !== "cancelled");
          const mapped = (events || []).map((e) => {
            const ev = e.event || e; // manche CLIs verschachteln
            return {
              titel: ev.summary || ev.title || ev.name || ev.subject || "(ohne Titel)",
              start: (ev.start && (ev.start.dateTime || ev.start.date)) || ev.startTime || ev.start_time || ev.begin || (typeof ev.start === "string" ? ev.start : "") || ev.when || "",
              ort: ev.location || "",
            };
          });
          const antwort = { ok: true, datum: fmt(day).slice(0, 10), events: mapped };
          // Selbst-Diagnose: wenn kein einziger Titel erkannt wurde, Feldnamen mitliefern
          if (mapped.length && mapped.every((m) => m.titel === "(ohne Titel)")) {
            antwort.felder = Object.keys(events[0] || {}).join(", ");
          }
          res.json(antwort);
        } catch (e2) {
          res.json({ ok: false, hint: "Kalender-Antwort nicht lesbar.", detail: String(e2.message).slice(0, 300) });
        }
      }
    );
  } catch (e) {
    res.json({ ok: false, hint: "Kalender-Aufruf fehlgeschlagen.", detail: String(e.message).slice(0, 300) });
  }
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

app.get("/api/system", async (req, res) => {
  let hermes = false;
  try {
    const base = (process.env.HERMES_CHAT_URL || "").replace(/\/v1\/.*$/, "");
    if (base) { const r = await fetch(base + "/health", { signal: AbortSignal.timeout(3000) }); hermes = r.ok; }
  } catch {}
  res.json({
    ok: true,
    app: "flowstate-dashboard v0.2.0",
    uptimeMin: Math.round(process.uptime() / 60),
    vaultMounted: fs.existsSync(VAULT_PATH),
    hermes,
    zeit: new Date().toLocaleString("de-DE"),
  });
});

// ---------- Chat mit Alexandra ----------
app.get("/chat", (req, res) => {
  const configured = Boolean(process.env.HERMES_CHAT_URL);
  const bisher = verlauf.lesen(DATA_PATH, req.session.crm || null);

  // Verlauf mit Tagestrennern, damit "die Unterhaltung von vor drei Tagen" auffindbar ist.
  const tag = (iso) => {
    const d = new Date(iso), heute = new Date();
    const gestern = new Date(heute); gestern.setDate(heute.getDate() - 1);
    const gleich = (a, b) => a.toDateString() === b.toDateString();
    if (gleich(d, heute)) return "Heute";
    if (gleich(d, gestern)) return "Gestern";
    return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year:
      d.getFullYear() === heute.getFullYear() ? undefined : "numeric" });
  };
  const uhr = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  let letzterTag = "";
  const verlaufHtml = bisher.map((n) => {
    const t = tag(n.zeit);
    const trenner = t === letzterTag ? "" : `<div class="chat-tag"><span>${esc(t)}</span></div>`;
    letzterTag = t;
    return trenner + `<div class="msg ${n.rolle === "user" ? "user" : "agent"}" title="${esc(uhr(n.zeit))}">${esc(n.text)}</div>`;
  }).join("");

  res.send(layout("Alexandra — direkte Leitung zum Agenten", "chat", `
    ${configured ? "" : `<div class="card placeholder"><h2>🔌 Verbindung wird eingerichtet</h2>
      <p>Die Chat-Tür zu Alexandra (Hermes-Webhook) ist noch nicht konfiguriert. Bis dahin erreichst du sie über Telegram.</p></div>`}
    <div class="chat-kopf">
      <span class="caption">${bisher.length ? bisher.length + " Nachrichten im Verlauf · dauerhaft gespeichert"
        : "Noch kein Verlauf — der erste Austausch wird gespeichert."}</span>
      ${bisher.length ? `<form method="post" action="/chat/leeren" class="inline"
        onsubmit="return confirm('Den ganzen Chatverlauf mit Alexandra löschen? Das lässt sich nicht rückgängig machen.')">
        <button class="danger tiny" type="submit">Verlauf löschen</button></form>` : ""}
    </div>
    <div class="chat-wrap${configured ? "" : " disabled"}">
      <div id="chat-log" class="chat-log">${verlaufHtml
        || `<div class="msg agent">Hallo${req.session.crm ? " " + esc(req.session.crm.name.split(" ")[0]) : ""}! Schreib mir hier wie in Telegram — ich habe denselben Kopf, dasselbe Gedächtnis und dieselben Regeln. ✦</div>`}</div>
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
      // Beim Oeffnen ans Ende springen — der neueste Austausch soll sichtbar sein.
      if (log) log.scrollTop = log.scrollHeight;
    </script>`, req));
});

// Hermes API-Server (OpenAI-kompatibel, Port 8642) — Verlauf wird pro Session mitgeschickt
app.post("/chat/leeren", (req, res) => {
  verlauf.leeren(DATA_PATH, req.session.crm || null);
  res.redirect("/chat");
});

app.post("/api/chat", async (req, res) => {
  const url = process.env.HERMES_CHAT_URL;
  if (!url) return res.json({ ok: false, hint: "HERMES_CHAT_URL ist noch nicht konfiguriert." });
  const wer = req.session.crm || null;
  verlauf.anhaengen(DATA_PATH, wer, "user", String(req.body.message || ""));
  const history = verlauf.kontext(DATA_PATH, wer);
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
    verlauf.anhaengen(DATA_PATH, wer, "assistant", reply);
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
  res.send(layout("Wissen — der Vault, live", "wissen", `
    <div class="split"><nav class="tree">${tree}</nav><article class="reader">${content}</article></div>`, req));
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
  res.send(layout("Lead-Maschine", "leads", `
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
    <tbody>${manualRows || '<tr><td colspan="6" class="muted">Noch keine manuellen Leads.</td></tr>'}</tbody></table></div>`, req));
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
// ---------- Agenten & Skills: Fenster in den Maschinenraum ----------
app.get("/agenten", (req, res) => {
  res.send(layout("Agenten & Skills", "agenten", `
    <div class="head-row">
      <div><p class="muted">Was Alexandra kann und gerade tut — Zuschauen stört sie nicht.</p></div>
      <div class="qa"><button onclick="location.reload()">🔄 Aktualisieren</button></div>
    </div>
    <div class="tiles">
      <div class="tile" data-tile2="skills"><span class="tile-num">–</span><span class="tile-label">Skills gesamt</span></div>
      <div class="tile" data-tile2="eigene"><span class="tile-num">–</span><span class="tile-label">Eigene Skills</span></div>
      <div class="tile" data-tile2="status"><span class="tile-num">–</span><span class="tile-label">Status</span></div>
      <div class="tile" data-tile2="cron"><span class="tile-num">–</span><span class="tile-label">Routinen</span></div>
    </div>
    <div class="grid">
      <div class="card"><h2>⚙️ Alexandras Zustand</h2><div class="card-body" data-load="/api/agent/status">Lade…</div></div>
      <div class="card"><h2>⏰ Routinen (Cron)</h2><div class="card-body" data-load="/api/agent/cron">Lade…</div></div>
      <div class="card wide"><h2>🧩 Eigene Skills <span class="muted small">im Vault — von uns und ihr selbst gebaut</span></h2><div class="card-body" data-load="/api/agent/skills">Lade…</div></div>
      <div class="card wide"><h2>📋 Entscheidungs-Log <span class="muted small">was wann warum entschieden wurde</span></h2><div class="card-body" data-load="/api/agent/entscheidungen">Lade…</div></div>
    </div>
    <script>
      (async () => {
        try {
          const [s, c] = await Promise.all([fetch("/api/agent/status").then(r=>r.json()), fetch("/api/agent/cron").then(r=>r.json())]);
          const sk = await fetch("/api/agent/skills").then(r=>r.json());
          setTile("skills", s.skillsGesamt ?? "?"); setTile("eigene", sk.skills ? sk.skills.length : "?");
          setTile("status", s.beschaeftigt ? "🟠" : (s.online ? "🟢" : "⚪"));
          setTile("cron", c.jobs ? c.jobs.length : "–");
        } catch {}
        function setTile(k, v) { const el = document.querySelector('[data-tile2="' + k + '"] .tile-num'); if (el) el.textContent = v; }
      })();
    </script>`, req));
});

app.get("/api/agent/status", async (req, res) => {
  const out = { ok: true, online: false, beschaeftigt: false };
  try {
    const base = (process.env.HERMES_CHAT_URL || "").replace(/\/v1\/.*$/, "");
    if (base) {
      const r = await fetch(base + "/health", { signal: AbortSignal.timeout(4000) });
      out.online = r.ok;
      try { const h = await r.json(); out.details = h; } catch {}
    }
  } catch {}
  // Modell + Skill-Zahl aus der Hermes-Konfiguration lesen (nur lesend)
  try {
    const cfg = fs.readFileSync("/hermes-data/config.yaml", "utf-8");
    const m = cfg.match(/default:\s*(\S+)/); if (m) out.modell = m[1];
    const r = cfg.match(/reasoning_effort:\s*(\S+)/); if (r) out.denkstaerke = r[1];
  } catch {}
  try { out.skillsGesamt = fs.readdirSync("/hermes-data/skills").filter((f) => !f.startsWith(".")).length; } catch {}
  res.json(out);
});

app.get("/api/agent/cron", (req, res) => {
  try {
    const p = "/hermes-data/cron.json";
    if (!fs.existsSync(p)) return res.json({ ok: true, jobs: [], hint: "Noch keine Routinen eingerichtet." });
    const d = JSON.parse(fs.readFileSync(p, "utf-8"));
    const jobs = Array.isArray(d) ? d : d.jobs || [];
    res.json({ ok: true, jobs });
  } catch (e) { res.json({ ok: true, jobs: [], hint: "Routinen nicht lesbar." }); }
});

app.get("/api/agent/skills", (req, res) => {
  try {
    const dir = path.join(VAULT_PATH, "skills");
    const skills = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const f = path.join(dir, e.name, "SKILL.md");
        let beschreibung = "", geaendert = "";
        try {
          const txt = fs.readFileSync(f, "utf-8");
          const m = txt.match(/description:\s*(.+)/); if (m) beschreibung = m[1].trim().slice(0, 160);
          geaendert = fs.statSync(f).mtime.toLocaleString("de-DE");
        } catch {}
        return { name: e.name, beschreibung, geaendert };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ ok: true, skills });
  } catch (e) { res.json({ ok: false, hint: "Skill-Ordner nicht lesbar." }); }
});

app.get("/api/agent/entscheidungen", (req, res) => {
  try {
    const dir = path.join(VAULT_PATH, "entscheidungen");
    const eintraege = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse().slice(0, 8)
      .map((f) => {
        let titel = f.replace(/\.md$/, "");
        try {
          const erste = fs.readFileSync(path.join(dir, f), "utf-8").split("\n").find((l) => l.startsWith("#"));
          if (erste) titel = erste.replace(/^#+\s*/, "");
        } catch {}
        return { datei: f, titel };
      });
    res.json({ ok: true, eintraege });
  } catch { res.json({ ok: true, eintraege: [] }); }
});

const PLACEHOLDERS = {
  kunden: ["Kunden (CRM)", "Der Eigenbau nach Bereich E: eigene Datenbank, Row-Level-Security, 5 Logins, Pipeline, Call-Listen. Größter Pain Point — kommt als eigenes Bauprojekt."],
  angebote: ["Angebote & Rechnungen", "Templates mit euren Preisen (1-€-Webseite, PM-Pakete, KI-Projekte), einheitliches Format, Status offen/bezahlt. Ablauf: Erstgespräch → Zuruf an Alexandra → Entwurf → Freigabe → raus."],
  // buchhaltung ist kein Platzhalter mehr — siehe lib/buchhaltung-routes.js
  // marketing  ist kein Platzhalter mehr — siehe lib/marketing-routes.js
  projekte: ["Projekte", "Laufende Kundenprojekte mit Status, nächsten Schritten und Verantwortlichen. Entsteht automatisch bei Deal = gewonnen."],
};

// Einstellungen: eigene Seite (kein Platzhalter), zeigt die angemeldete Identitaet
// (Wunsch Lukas 22.07.: "man sollte immer nachsehen koennen, mit welcher Mail man
// angemeldet ist").
app.get("/einstellungen", (req, res) => {
  const u = req.session.crm;
  const konto = u
    ? `<div class="row"><span>Name</span><span><strong>${esc(u.name)}</strong></span></div>
       <div class="row"><span>E-Mail</span><span><strong>${esc(u.email)}</strong></span></div>
       <div class="row"><span>Rolle</span><span>${esc(u.rolle)}</span></div>`
    : `<p class="muted">Du bist über das gemeinsame <strong>Dashboard-Passwort</strong> angemeldet — das ist kein persönliches Konto und hat keine E-Mail. Für dein persönliches Konto (mit E-Mail) über <a class="btn-link" href="/login">Login</a> mit deiner E-Mail anmelden.</p>`;
  // Passwort-Aenderung nur fuer persoenliche Konten (CRM-Login).
  const pwForm = u ? `
    <div class="card"><h2>Passwort ändern</h2>
      <p class="muted small">Ändert das Passwort deines persönlichen Kontos (${esc(u.email)}).</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
        <input id="pw-neu" type="password" autocomplete="new-password" placeholder="Neues Passwort (min. 6 Zeichen)"
          style="flex:1;min-width:220px;padding:9px 12px;border:1px solid var(--line,#d9dee5);border-radius:8px;background:var(--bg,#fff);color:inherit">
        <button type="button" class="btn" onclick="pwAendern()">Ändern</button>
        <span id="pw-status" class="muted small"></span>
      </div>
    </div>
    <script>
      async function pwAendern(){
        var el=document.getElementById('pw-neu'), s=document.getElementById('pw-status'), neu=el.value;
        if(!neu||neu.length<6){s.textContent='Mindestens 6 Zeichen.';return;}
        s.textContent='…';
        try{
          var r=await fetch('/api/einstellungen/passwort',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({neu:neu})});
          var d=await r.json();
          s.textContent=d.ok?'✅ Passwort geändert.':('Fehler: '+(d.hint||'?'));
          if(d.ok) el.value='';
        }catch(e){ s.textContent='Fehler beim Speichern.'; }
      }
    </script>` : "";
  // Anbindungen sichtbar machen (26.07.): Bisher stand nur in der .env auf dem
  // Server, was verbunden ist — im Code unsichtbar. Jannik fragte, ob Meta-Ads
  // angebunden sei, sein Assistent fand lokal keine Zugangsdaten und sagte
  // "nein", obwohl es laengst laeuft. Genau so baut jemand etwas zum zweiten
  // Mal. Hier stehen nur JA/NEIN, nie ein Wert — die Seite darf man zeigen.
  const anb = require("./lib/anbindungen.js").stand();
  const anbZeilen = anb.map((a) =>
    `<div class="row"><span>${esc(a.name)}<br><span class="muted small">${esc(a.zweck)}</span></span>
     <span>${a.eingerichtet
       ? '<strong style="color:var(--success,#1a7f37)">verbunden</strong>'
       : '<span class="muted">nicht eingerichtet</span>'}</span></div>`).join("");
  const anzahl = anb.filter((a) => a.eingerichtet).length;

  res.send(layout("Einstellungen", "einstellungen", `
    <div class="card"><h2>Angemeldet als</h2>${konto}
      <p class="muted small" style="margin-top:12px"><a class="btn-link" href="/logout">Abmelden</a></p></div>
    ${pwForm}
    <div class="card"><h2>Anbindungen (${anzahl} von ${anb.length} verbunden)</h2>
      <p class="muted small">Was dieses Operating System erreichen kann. Zugangsdaten selbst
        werden nie angezeigt — nur ob sie da sind.</p>
      ${anbZeilen}
      <p class="muted small" style="margin-top:12px">Dies ist der Stand <strong>dieser Instanz</strong>.
        Auf einem Entwicklungsrechner fehlen die meisten Zugänge absichtlich — maßgeblich ist der Server.
        Im Terminal: <code>node scripts/status.js</code></p></div>
    <div class="card placeholder"><h2>🔜 Weitere Einstellungen in Vorbereitung</h2>
      <p>Benutzer &amp; Zugänge, Instanzen (Alexandra/Jarvis), Modell-Routing, Kostenübersicht.</p></div>`, req));
});

// Passwort des eigenen (persoenlichen) Kontos aendern.
app.post("/api/einstellungen/passwort", async (req, res) => {
  if (!req.session.crm) return res.json({ ok: false, hint: "Nur mit persönlichem Konto (E-Mail-Login) möglich." });
  const neu = String(req.body?.neu || "");
  if (neu.length < 6) return res.json({ ok: false, hint: "Mindestens 6 Zeichen." });
  try {
    await require("./lib/crm.js").passwortAendern(req.session.crm.id, neu);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, hint: String(e.message).slice(0, 150) }); }
});

for (const [id, [title, desc]] of Object.entries(PLACEHOLDERS)) {
  app.get("/" + id, (req, res) => {
    res.send(layout(title, id, `
      <div class="card placeholder"><h2>🔜 Modul in Vorbereitung</h2><p>${desc}</p>
      <p class="muted">Das Gerüst steht — dieses Modul wird als nächster Ausbauschritt mit echten Daten und Funktionen gefüllt.</p></div>`, req));
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
  <title>${esc(title)} · flowstateOS</title>
  <link rel="stylesheet" href="/crm.css"><link rel="stylesheet" href="/style.css">
  <script>(function(){var t=localStorage.getItem("flowstate-thema")||"light";
   document.documentElement.setAttribute("data-theme",t);})();</script></head>
  <body class="bare">${content}</body></html>`;
}

// Alle OS-Seiten laufen durch die gemeinsame Huelle (lib/schale.js) —
// dieselbe Rail, dieselbe Topbar, dasselbe Designsystem wie im CRM.
function layout(title, active, content, req) {
  return schale({
    titel: title, aktiv: active, inhalt: content,
    nutzer: req && req.session ? req.session.crm || null : null,
  }) + `
  <script>
    document.querySelectorAll("[data-load]").forEach(async (el) => {
      try {
        const r = await fetch(el.dataset.load); const d = await r.json();
        el.innerHTML = renderCard(el.dataset.load, d);
      } catch (e) { el.innerHTML = "<p class='error'>Fehler beim Laden.</p>"; }
    });
    // Kalender mit Tages-Navigation
    let calOffset = 0;
    const TAGE = ["So","Mo","Di","Mi","Do","Fr","Sa"];
    async function loadCal() {
      const body = document.getElementById("cal-body"); if (!body) return;
      const label = document.getElementById("cal-label");
      const d = new Date(Date.now() + calOffset * 86400000);
      label.textContent = calOffset === 0 ? "Heute" : calOffset === 1 ? "Morgen" : calOffset === 2 ? "Übermorgen" : calOffset === -1 ? "Gestern" : TAGE[d.getDay()] + ", " + d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
      body.innerHTML = "Lade…";
      try {
        const r = await fetch("/api/calendar?offset=" + calOffset); const dd = await r.json();
        if (!dd.ok) { body.innerHTML = "<p class='muted'>" + (dd.hint || "Nicht verfügbar.") + "</p>" + (dd.detail ? "<pre class='small'>" + String(dd.detail).replace(/[<>&]/g, "") + "</pre>" : ""); return; }
        if (!dd.events.length) {
          const tag = d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
          body.innerHTML = "<div class='cal-frei'><span class='cal-frei-icon'>🌤️</span><p><strong>" + tag + "</strong></p><p class='muted'>Keine Termine — freier Tag.</p></div>";
          return;
        }
        body.innerHTML = dd.events.map(function (e) {
          var t = e.start && String(e.start).includes("T") ? new Date(e.start).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "ganztägig";
          return "<div class='row'><span><strong>" + t + "</strong> " + e.titel + "</span>" + (e.ort ? "<span class='muted small'>" + e.ort + "</span>" : "") + "</div>";
        }).join("") + (dd.felder ? "<p class='muted small'>⚠️ Felder: " + dd.felder + "</p>" : "");
      } catch { body.innerHTML = "<p class='error'>Fehler beim Laden.</p>"; }
    }
    function calShift(n) { calOffset += n; loadCal(); }
    loadCal();
    document.querySelectorAll("[data-tile]").forEach(async (el) => {
      try {
        const r = await fetch(el.dataset.tile); const d = await r.json();
        el.querySelector(".tile-num").textContent = tileNum(el.dataset.tile, d);
      } catch { el.querySelector(".tile-num").textContent = "?"; }
    });
    function tileNum(src, d) {
      if (!d.ok) return "–";
      if (src.includes("calendar")) return (d.events || []).length;
      if (src.includes("mail")) { if (d.leer) return "–"; var k = d.koerbe || {}; return ((k.dringend || []).length + (k.wichtig || []).length); }
      if (src.includes("inbox")) return d.gesamt ?? 0;
      if (src.includes("crm")) return d.offene_deals ?? 0;
      if (src.includes("leads")) return d.gesamt ?? 0;
      return "–";
    }
    function renderCard(src, d) {
      if (!d.ok && d.anmeldung) return "<p class='muted'>" + d.hint + "</p><p><a class='btn-link' href='/login'>Persönlich anmelden</a></p>";
      if (!d.ok) return "<p class='muted'>" + (d.hint || "Noch nicht verbunden.") + "</p>" + (d.detail ? "<pre class='small'>" + String(d.detail).replace(/[<>&]/g, "") + "</pre>" : "");
      if (src.includes("crm")) {
        var eur = function (n) { return (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " €"; };
        return "<div class='row'><span>Offene Deals</span><span><strong>" + d.offene_deals + "</strong></span></div>" +
               "<div class='row'><span>Pipeline-Wert</span><span><strong>" + eur(d.pipeline_wert) + "</strong></span></div>" +
               "<div class='row'><span>Umsatz diesen Monat</span><span>" + eur(d.umsatz_monat) + "</span></div>" +
               "<div class='row'><span>Leads · Kunden</span><span>" + d.leads + " · " + d.kunden + "</span></div>" +
               (d.wiedervorlagen ? "<div class='row'><span>⏰ Fällige Wiedervorlagen</span><span><strong>" + d.wiedervorlagen + "</strong></span></div>" : "") +
               "<p class='muted small'>Angemeldet als " + d.name + "</p>";
      }
      if (src.includes("briefing")) {
        if (d.leer) return "<p class='muted'>Noch kein Briefing heute. Klick oben auf <strong>☀️ Briefing erstellen</strong> — Alexandra stellt Termine, Mails und Prioritäten zusammen (dauert 1–3 Min).</p>";
        return "<div class='md'>" + d.html + "</div><p class='muted small'>Stand: " + d.stand + (d.alterMin > 240 ? " ⚠️ schon " + Math.round(d.alterMin/60) + " Std alt" : "") + "</p>";
      }
      if (src.includes("mail")) {
        if (d.leer) return "<p class='muted'>Noch keine Triage heute. Klick oben auf <strong>📬 Mail-Triage starten</strong>.</p>";
        var k = d.koerbe || {};
        var out = "";
        if ((k.dringend || []).length) out += "<p><strong>🔴 Wichtig & dringend (" + k.dringend.length + ")</strong></p>" + k.dringend.map(m => "<div class='row'><span>" + m.von + " — " + m.betreff + "</span></div>").join("");
        if ((k.wichtig || []).length) out += "<p><strong>🟡 Wichtig (" + k.wichtig.length + ")</strong></p>" + k.wichtig.slice(0,5).map(m => "<div class='row'><span>" + m.von + " — " + m.betreff + "</span></div>").join("");
        out += "<p class='muted small'>Kann warten: " + (k.warten ?? "–") + " · Werbung: " + (k.werbung ?? "–") + " · Stand: " + (d.stand || "") + "</p>";
        return out || "<p class='muted'>Postfach leer. 🎉</p>";
      }
      if (src.includes("inbox")) {
        if (!d.punkte || !d.punkte.length) return "<p class='muted'>Nichts offen — alles entschieden. ✅</p>";
        return d.punkte.map(p => "<div class='row'><span>" + (p.titel || p.text || JSON.stringify(p)) + "</span><span class='muted small'>" + (p.von || "") + "</span></div>").join("");
      }
      if (src.includes("leads/stats")) {
        return "<div class='row'><span>Läufe</span><span>" + d.laeufe + "</span></div>" +
               "<div class='row'><span>Leads gesamt</span><span><strong>" + d.gesamt + "</strong></span></div>" +
               "<div class='row'><span>Top-Leads (Score ≥ 9)</span><span>" + d.top + "</span></div>" +
               "<div class='row'><span>Manuell erfasst</span><span>" + d.manuell + "</span></div>" +
               (d.letzter ? "<p class='muted small'>Letzter Lauf: " + d.letzter + "</p>" : "");
      }
      if (src.includes("agent/status")) {
        return "<div class='row'><span>Erreichbar</span><span>" + (d.online ? "🟢 online" : "⚪ offline") + "</span></div>" +
               (d.modell ? "<div class='row'><span>Modell</span><span>" + d.modell + "</span></div>" : "") +
               (d.denkstaerke ? "<div class='row'><span>Denkstärke</span><span>" + d.denkstaerke + "</span></div>" : "") +
               (d.skillsGesamt ? "<div class='row'><span>Skills installiert</span><span>" + d.skillsGesamt + "</span></div>" : "") +
               "<p class='muted small'>Zuschauen stört nicht — nur Nachrichten unterbrechen sie.</p>";
      }
      if (src.includes("agent/cron")) {
        if (!d.jobs || !d.jobs.length) return "<p class='muted'>" + (d.hint || "Noch keine Routinen.") + "</p><p class='muted small'>Später hier: Morgen-Briefing 7:30, Wochenreport Mo 9:00 …</p>";
        return d.jobs.map(j => "<div class='row'><span>" + String(j.name || j.prompt || "Routine").slice(0,60) + "</span><span class='muted small'>" + (j.schedule || j.cron || "") + "</span></div>").join("");
      }
      if (src.includes("agent/skills")) {
        if (!d.skills || !d.skills.length) return "<p class='muted'>Keine eigenen Skills gefunden.</p>";
        return "<table class='tbl'><thead><tr><th>Skill</th><th>Beschreibung</th><th>Geändert</th></tr></thead><tbody>" +
          d.skills.map(s => "<tr><td><strong>" + s.name + "</strong></td><td class='small'>" + (s.beschreibung || "—") + "</td><td class='muted small'>" + (s.geaendert || "") + "</td></tr>").join("") + "</tbody></table>";
      }
      if (src.includes("agent/entscheidungen")) {
        if (!d.eintraege || !d.eintraege.length) return "<p class='muted'>Noch keine Einträge.</p>";
        return d.eintraege.map(e => "<div class='row'><span><a href='/wissen?f=" + encodeURIComponent("entscheidungen/" + e.datei) + "'>" + e.titel + "</a></span></div>").join("");
      }
      if (src.includes("vault")) return "<p><strong>" + d.mdCount + "</strong> Wissens-Dateien</p><p class='muted small'>Zuletzt geändert:</p>" + d.newest.slice(0,4).map(n => "<div class='row'><span>" + n.file + "</span><span class='muted small'>" + n.changed + "</span></div>").join("");
      if (src.includes("system")) return "<div class='row'><span>App</span><span>" + d.app + "</span></div><div class='row'><span>Läuft seit</span><span>" + d.uptimeMin + " Min</span></div><div class='row'><span>Vault</span><span>" + (d.vaultMounted ? "✅ verbunden" : "❌ fehlt") + "</span></div><div class='row'><span>Alexandra</span><span>" + (d.hermes ? "🟢 online" : "⚪ nicht erreichbar") + "</span></div>";
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

app.listen(PORT, () => {
  console.log(`flowstate-dashboard läuft auf Port ${PORT}`);
  // Nachsehen, ob Datenbank und Code zusammenpassen (26.07.). Am 26.07. lagen
  // 14 Migrationen im Code, in Supabase fehlten die meisten — im Betrieb sieht
  // das aus wie kaputter Code ("Spalte gibt es nicht"), und man sucht im
  // falschen Code. Hier wird nur GEWARNT: Struktur-Aenderungen an einer
  // Datenbank mit echten Kundendaten passieren nie nebenbei beim Hochfahren.
  require("./lib/migrationen.js").warnen().catch(() => {});
});
