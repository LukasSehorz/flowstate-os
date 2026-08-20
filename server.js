// Flowstate OS Dashboard — V1 (Gerüst)
// Schichten: Dashboard (hier) -> Hermes (Agent) -> Vault/Daten (unten)
const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const { schale, ICON, S } = require("./lib/schale.js");
// Wie der Agent in der Oberflaeche heisst (AGENT_NAME). Leer = Alexandra.
const AGENT = process.env.AGENT_NAME || "Alexandra";
const verlauf = require("./lib/verlauf.js");

// Zusaetzliche Zeichen fuer die Zentrale. ICON aus schale.js hat schon alles,
// was auch in der Rail steht (sonne, funke, leads, kunden, euro, kalender …) —
// hier stehen nur die, die es dort nicht gibt. Gebaut mit demselben S() und
// derselben Strichstaerke, damit nichts aus der Reihe faellt.
const ZT = {
  post: S('<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  links: S('<path d="m15 18-6-6 6-6"/>'),
  rechts: S('<path d="m9 6 6 6-6 6"/>'),
  frei: S('<path d="M12 3v2M5.6 5.6l1.4 1.4M3 12h2M18.4 5.6 17 7M21 12h-2"/><circle cx="12" cy="12" r="4"/><path d="M6 19h12"/>'),
  // Fuer Umsatz, Forecast und To-Dos. Bewusst dieselben Pfade wie im
  // CRM-Dashboard (lib/crm-routes.js) — dieselbe Zahl soll auch dasselbe
  // Zeichen tragen, sonst sucht man auf zwei Seiten nach demselben Wert.
  waage: S('<path d="M12 3v18M7 7h10M5.5 7 3 13h5zM18.5 7 16 13h5z"/><path d="M3 13a2.5 2.5 0 0 0 5 0M16 13a2.5 2.5 0 0 0 5 0"/>'),
  trend: S('<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>'),
  schichten: S('<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>'),
  ziel: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
  euro: S('<path d="M15 6.5A6 6 0 1 0 15 17.5"/><path d="M4 10.5h9M4 13.5h9"/>'),
  kalenderKlein: S('<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>'),
  haken: S('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  warnung: S('<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
};

const eur = (n) => (n == null ? "–" : Math.round(Number(n)).toLocaleString("de-DE") + " €");
// Kurz fuer die Achse: 36.800 wird zu "37k €". Auf einer 48 px breiten
// Y-Achse ist die volle Zahl nicht lesbar.
const eurK = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000) return Math.round(v / 1000) + "k €";
  if (v >= 1000) return (v / 1000).toFixed(1).replace(".0", "").replace(".", ",") + "k €";
  return Math.round(v) + " €";
};

// Die Umsatzkurve. Dieselbe Rechnung wie im CRM-Dashboard: Catmull-Rom in
// kubische Bezier, damit die Kurve weich laeuft, und die Stuetzpunkte auf den
// Wertebereich des Abschnitts geklemmt — ohne das schwingt sie zwischen zwei
// Monaten unter die Nulllinie und behauptet einen Verlust, den es nie gab.
function umsatzKurve(werte) {
  const max = Math.max(1, ...werte);
  const pkt = werte.map((w, i) => [
    (i / (werte.length - 1 || 1)) * 780 + 10,
    190 - (w / max) * 178,
  ]);
  const klemm = (v, a, b) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));
  let linie = `M${pkt[0][0].toFixed(1)},${pkt[0][1].toFixed(1)}`;
  for (let i = 0; i < pkt.length - 1; i++) {
    const p0 = pkt[i - 1] || pkt[i], p1 = pkt[i], p2 = pkt[i + 1], p3 = pkt[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, klemm(p1[1] + (p2[1] - p0[1]) / 6, p1[1], p2[1])];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, klemm(p2[1] - (p3[1] - p1[1]) / 6, p1[1], p2[1])];
    linie += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return {
    max, pkt, linie,
    flaeche: linie + ` L${pkt[pkt.length - 1][0].toFixed(1)},190 L10,190 Z`,
    gitter: [0, 1, 2, 3, 4].map((i) => 12 + i * 44.5),
  };
}

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.DASHBOARD_PASSWORD || "";
const VAULT_PATH = process.env.VAULT_PATH || "/vault";
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, "data");

if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });

// 5 MB statt der 100 KB, die Express von Haus aus erlaubt.
//
// Anlass (29.07.): Eine eingefuegte Lead-Liste mit Bewertungstexten und
// Maps-Links sprengte die Grenze. Express warf PayloadTooLargeError, der
// Standard-Fehlerbehandler antwortete mit einer HTML-Seite, und im Browser
// stand "Unexpected token '<'" — eine Meldung, aus der niemand ableiten kann,
// dass die Liste schlicht zu gross war.
//
// 5 MB sind grosszuegig fuer Formulare (das sind rund 20.000 Lead-Zeilen) und
// weit unter dem, was den Server belasten wuerde. Dateien laufen ohnehin nicht
// hierueber, sondern roh ueber eigene Routen.
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(express.json({ limit: "5mb" }));
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

// ---------- Torwaechter: welche Bereiche darf diese Person oeffnen? ----------
//
// Die Zeilenrechte in der Datenbank regeln, WELCHE Datensaetze jemand sieht.
// Hier geht es um die Ebene darueber: welche BEREICHE es fuer ihn ueberhaupt
// gibt. Ohne das kaeme Simon mit einer getippten Adresse auf /marketing oder
// /leads — die Rail haette den Punkt zwar ausgeblendet, die Route aber nicht.
// Ausblenden ist keine Sperre.
//
// Steht bewusst GANZ OBEN, vor allen Modulen: die Bereiche werden in
// unterschiedlicher Reihenfolge geladen (CRM vor dem Auth-Gate, Kalender
// danach), und ein Waechter, der erst in der Mitte greift, laesst die Haelfte
// durch. Hier sieht er jede Anfrage.
//
// Wer KEIN persoenliches Konto hat (nur gemeinsames Passwort), laeuft
// unveraendert durch — dafuer sorgt das Auth-Gate weiter unten und die
// Bereiche selbst.
const BEREICH_JE_PFAD = {
  "": "zentrale", umsatz: "zentrale",
  kalender: "kalender", todos: "todos",
  crm: "crm", leads: "leads",
  buchhaltung: "buchhaltung", angebote: "angebote",
  marketing: "marketing", content: "content", projekte: "projekte",
  chat: "chat", sprache: "sprache", whatsapp: "chat",
  wissen: "wissen", agenten: "agenten", einstellungen: "einstellungen",
};
// Immer offen: Anmeldung, Abmeldung und was der Browser fuer die Seite braucht.
const IMMER_OFFEN = new Set(["login", "logout", "bilder", "favicon.ico"]);

app.use((req, res, next) => {
  const u = req.session && req.session.crm;
  if (!u || u.rolle === "admin") return next();

  // Erster Pfadabschnitt entscheidet. /api/<bereich>/… wird auf denselben
  // Bereich abgebildet — sonst waeren die Kacheln der Zentrale ein offenes
  // Fenster in gesperrte Bereiche.
  const teile = req.path.split("/").filter(Boolean);
  const erst = teile[0] || "";
  if (IMMER_OFFEN.has(erst)) return next();
  const schluessel = erst === "api" ? (teile[1] || "") : erst;
  const bereich = BEREICH_JE_PFAD[schluessel];
  // Unbekannter Pfad (Dateien, neue Routen): durchlassen. Ein Waechter, der
  // alles Unbekannte sperrt, legt beim naechsten neuen Bereich die Seite lahm.
  if (!bereich) return next();
  if (require("./lib/schale.js").darfModul(u, bereich)) return next();

  if (req.path.startsWith("/api/")) {
    return res.status(403).json({ ok: false, hint: "Für diesen Bereich fehlt dir die Freigabe." });
  }
  return res.redirect("/");
});

// ---------- CRM (eigener Login mit persoenlichen Konten, RLS in der Datenbank) ----------
if (process.env.DATABASE_URL) {
  try { require("./lib/crm-routes.js")(app); console.log("CRM-Modul geladen"); }
  catch (e) { console.error("CRM-Modul konnte nicht geladen werden:", e.message); }
  try { require("./lib/buchhaltung-routes.js")(app); console.log("Buchhaltungs-Modul geladen"); }
  catch (e) { console.error("Buchhaltungs-Modul konnte nicht geladen werden:", e.message); }
  try { require("./lib/marketing-routes.js")(app); console.log("Marketing-Modul geladen"); }
  catch (e) { console.error("Marketing-Modul konnte nicht geladen werden:", e.message); }
  try { require("./lib/content-ideen-routes.js")(app); console.log("Content-Ideen geladen"); }
  catch (e) { console.error("Content-Ideen:", e.message); }
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
// DIENSTANMELDUNG fuer die eigenen Hintergrundlaeufe (07.08.2026).
//
// Warum es das braucht: Der taegliche Postfachlauf und der Telegram-Beleg legen
// Rechnungen ueber /buchhaltung/beleg/hochladen ab — bewusst ueber HTTP und
// nicht an der Datenbank vorbei, damit die Zeilenrechte der Datenbank greifen.
// Dieser Endpunkt haengt aber an req.session.crm, und das setzt nur die
// CRM-Anmeldung mit Mail und Passwort. Die hat der Server nicht.
//
// Gefunden wurde das beim ersten echten Lauf: Vier gefundene Rechnungen, alle
// vier abgewiesen, Umleitung nach /crm/anmelden. Der 19-Uhr-Lauf waere jeden
// Abend genauso ins Leere gelaufen — und haette gemeldet, es sei nichts da.
//
// ZWEI SCHRANKEN, und beide muessen halten:
//   1. Nur von diesem Rechner selbst. Traefik sitzt in einem eigenen Container
//      und traegt eine Netzwerkadresse, kein 127.0.0.1 — von aussen ist dieser
//      Endpunkt damit nicht erreichbar.
//   2. Das Dashboard-Passwort, das der Prozess ohnehin kennt.
//
// Das vergibt KEINE neuen Rechte: Der Prozess hat die Datenbank sowieso in der
// Hand. Es macht nur sichtbar, ALS WEN er handelt — und laesst die Zeilenrechte
// weiter greifen, statt sie zu umgehen.
const DIENST_KONTO = process.env.DIENST_KONTO || "lukas.sehorz@flowstate-ai.net";
app.post("/intern/dienst-anmelden", async (req, res) => {
  const her = String(req.socket.remoteAddress || "");
  const drinnen = her === "127.0.0.1" || her === "::1" || her === "::ffff:127.0.0.1";
  if (!drinnen) return res.status(403).json({ ok: false, hint: "nur intern" });
  if (!PASSWORD || req.body?.passwort !== PASSWORD) return res.status(403).json({ ok: false, hint: "falsches Passwort" });
  try {
    const { rows } = await require("./lib/crm.js").system(
      `select p.id, u.email, p.name, p.rolle, p.module
         from public.profiles p join auth.users u on u.id = p.id
        where lower(u.email) = lower($1) and p.aktiv and p.rolle = 'admin'`, [DIENST_KONTO]);
    if (!rows[0]) return res.status(403).json({ ok: false, hint: `Kein aktives Admin-Konto ${DIENST_KONTO}` });
    req.session.crm = { ...rows[0], module: rows[0].module || [] };
    req.session.authed = true;
    // ERST SPEICHERN, DANN ANTWORTEN (07.08.). Die Sitzungen liegen als Dateien
    // (FileStore). Ohne dieses Warten geht die Antwort raus, bevor die Datei
    // geschrieben ist — und der naechste Aufruf liest die alte, noch ohne
    // Anmeldung.
    //
    // Das war kein theoretisches Risiko: Von drei Laeufen hintereinander schlug
    // der erste fehl und die beiden folgenden gingen durch. Genau so haette es
    // den 19-Uhr-Lauf getroffen, der einmal taeglich auf einen kalten Server
    // trifft — also praktisch immer den langsamen Fall.
    req.session.save((fehler) => {
      if (fehler) return res.status(500).json({ ok: false, hint: "Sitzung nicht gespeichert" });
      res.json({ ok: true, als: rows[0].email });
    });
  } catch (e) { res.status(500).json({ ok: false, hint: String(e.message).slice(0, 120) }); }
});

// Nach der Anmeldung dorthin, wo derjenige eigentlich hinwollte.
//
// WARUM (20.08.2026): Beim Dreh oeffnete Jannik /sprache?drehbuch=0, wurde zur
// Anmeldung geschickt und landete danach auf der Startseite. Die Frage im Link
// war weg, das Drehbuch damit aus — und er sprach mit dem echten Agenten statt
// mit der Aufnahme. Man sieht es dem Bildschirm nicht an; auffallen kann es
// erst, wenn die falsche Antwort kommt.
function zurueckZiel(req) {
  const z = req.session && req.session.zurueck;
  if (req.session) delete req.session.zurueck;
  // Nur eigene Pfade, und nichts, was wieder auf die Anmeldung zeigt.
  return (typeof z === "string" && z.startsWith("/") && !z.startsWith("//")
    && !z.startsWith("/login")) ? z : "/";
}

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (email && process.env.DATABASE_URL) {
    try {
      const u = await require("./lib/crm.js").anmelden(email.trim(), password);
      if (u) { req.session.crm = u; req.session.authed = true; return res.redirect(zurueckZiel(req)); }
    } catch (e) { console.error("Anmeldung fehlgeschlagen:", e.message); }
    return res.redirect("/login?err=1");
  }
  if (PASSWORD && password === PASSWORD) {
    req.session.authed = true;
    return res.redirect(zurueckZiel(req));
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

// ALEXANDRA AM TELEFON — und zwar VOR dem Torwaechter (07.08.).
//
// Die Reihenfolge ist hier kein Geschmack, sondern Bedingung: ElevenLabs bringt
// keine Sitzung mit, sondern einen eigenen Ausweis im Kopfzeilenfeld. Stuende
// diese Zeile weiter unten, faengt der Torwaechter darunter den Aufruf ab und
// antwortet mit einer Umleitung zur Anmeldeseite — ElevenLabs bekaeme statt
// Alexandras Antwort eine HTML-Seite, und in der Leitung waere Stille.
//
// Genau so ist es beim ersten Versuch von aussen passiert. Die Testattrappe
// konnte es nicht sehen: Sie kennt die Reihenfolge der Middleware nicht. Nur
// ein Aufruf gegen den laufenden Server zeigt es (scripts/test-telefon-live.js).
//
// Der Endpunkt bleibt trotzdem geschuetzt — er prueft sein eigenes Geheimnis,
// bevor er irgendetwas weiterreicht.
try {
  const telefon = require("./lib/telefon.js");
  telefon.routen(app);
  telefon.anmelden().catch((e) => console.error("Telefon-Anmeldung:", e.message));
} catch (e) { console.error("Telefon-Modul:", e.message); }

app.use((req, res, next) => {
  if (!PASSWORD) return res.status(500).send("DASHBOARD_PASSWORD ist nicht gesetzt.");
  // Wer im CRM angemeldet ist, ist auch im OS angemeldet — eine Identitaet fuer beides.
  if (req.session.authed || req.session.crm) return next();
  // API-Aufrufe bekommen eine klare Meldung statt einer Weiterleitung ins Nichts
  if (req.path.startsWith("/api/")) return res.status(401).json({ ok: false, hint: "Sitzung abgelaufen — bitte Seite neu laden und neu anmelden." });
  // Das Ziel merken, samt Fragezeichen-Teil. Ohne das geht ?drehbuch=0
  // verloren (siehe zurueckZiel oben).
  //
  // NUR ECHTE SEITEN: Der Browser holt nebenbei favicon, Stylesheets und
  // Skripte. Die laufen durch denselben Torwaechter, und wer zuletzt kam,
  // gewinnt — im Test landete die Anmeldung auf /favicon.ico. Nach dem
  // Anmelden steht man dann vor einem Bild statt vor der Sprachseite.
  const istSeite = req.method === "GET"
    && !/\.(ico|css|js|png|jpe?g|svg|woff2?|map|webmanifest)$/i.test(req.path)
    && !req.path.startsWith("/api/")
    && (req.get("accept") || "").includes("text/html");
  if (istSeite) req.session.zurueck = req.originalUrl;
  res.redirect("/login");
});

// Die Navigation steht jetzt zentral in lib/schale.js (MODULE).

// ---------- Sprache (Alexandra zum Zuhoeren) ----------
// Steht bewusst hinter dem Auth-Gate: Die Routen reichen Kalender, Kennzahlen
// und die Leitung zu Hermes durch — nichts davon gehoert nach aussen offen.
try { require("./lib/sprache-routes.js")(app, { layout }); console.log("Sprach-Modul geladen"); }
catch (e) { console.error("Sprach-Modul konnte nicht geladen werden:", e.message); }

// Kalender (/kalender) — der Google Kalender zum Ansehen und Eintragen.
// Steht hinter dem Auth-Gate: die Routen schreiben in ein echtes Google-Konto.
// Regie-Seite fuer die Werbeaufnahmen. Nur mit DREH_REGIE=1 — im Betrieb gibt
// es die Route nicht, auch nicht als 403.
if (process.env.DREH_REGIE === "1") {
  try { require("./lib/regie-routes.js")(app); console.log("Regie-Modul geladen (Dreh)"); }
  catch (e) { console.error("Regie-Modul nicht geladen:", e.message); }
}

try { require("./lib/kalender-routes.js")(app); console.log("Kalender-Modul geladen"); }
catch (e) { console.error("Kalender-Modul konnte nicht geladen werden:", e.message); }

// To-Dos haengen in der Rail hinter dem Kalender und muessen deshalb NACH ihm
// geladen werden — "nach: kalender" kann nur greifen, wenn es den Kalender
// schon gibt. Verloren geht sonst nichts (schale.eintragen fuehrt zusammen),
// aber die Reihenfolge waere vertauscht. DATABASE_URL, weil die Aufgaben in
// der CRM-Datenbank liegen.
if (process.env.DATABASE_URL) {
  try { require("./lib/todo-routes.js")(app); console.log("To-Do-Modul geladen"); }
  catch (e) { console.error("To-Do-Modul konnte nicht geladen werden:", e.message); }
}

// WhatsApp-Koppelseite (/whatsapp). Die Bruecke laeuft als eigener Container;
// faellt sie aus, zeigt die Seite nur "nicht verbunden" — das Dashboard bleibt heil.
try { require("./lib/whatsapp.js")(app, { layout }); console.log("WhatsApp-Modul geladen"); }
catch (e) { console.error("WhatsApp-Modul konnte nicht geladen werden:", e.message); }

// Telegram-Bot (Alexandra auf Telegram, Schnellspur + Sprachantwort). Schlummert
// ohne TELEGRAM_BOT_TOKEN — beruehrt Hermes' eigenes Telegram nicht.
try {
  const telegram = require("./lib/telegram.js");
  telegram.starten();
  // Fertige Rechnungen und Angebote als PDF zustellen (07.08.). Lukas soll das
  // Dokument SEHEN, bevor er es freigibt — eine Aufzaehlung im Chat sagt nichts
  // darueber, ob die Anschrift stimmt oder das Layout sitzt.
  //
  // Hier verdrahtet und nicht im Beleg-Modul selbst: telegram.js laedt schon
  // beleg-erstellen.js. Umgekehrt auch, und die beiden wuerden sich im Kreis
  // laden.
  require("./lib/beleg-erstellen.js").zustellerSetzen(
    (buf, name, text) => telegram.pushDatei(buf, name, text, { stimme: false }));
} catch (e) { console.error("Telegram-Modul:", e.message); }

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
  // ALLES AUFFRISCHEN, WAS ABGELAUFEN IST — nicht nur den Kalender.
  //
  // Der Fehler, den das behebt (05.08., im grossen Durchlauf gefunden): Hier
  // stand ["kalender"]. CRM, Buchhaltung und Meta-Ads haben zwar
  // Frischegrenzen (1 h, 3 h, 3 h), aber niemand hat sie je erneuert. Gemessen
  // waren die Buchhaltungszahlen im STAND 11.056 Minuten alt — 7,7 Tage.
  //
  // Die Folge war schlimmer als veraltete Daten: Alexandra las sie als
  // AKTUELL vor. Auf "sind noch Rechnungen offen" kam ein ueberzeugtes "Nein,
  // alles beglichen" — aus einer Woche alten Zahlen. Eine falsche Zahl,
  // selbstbewusst vorgetragen, ist schlimmer als keine.
  //
  // veraltet() gab es schon, es wurde nur nie aufgerufen.
  const auffrischen = async () => {
    // Buchhaltung bleibt aussen vor: Sie braucht einen angemeldeten Nutzer
    // (Zeilenrechte), den es hier nicht gibt. Sie wuerde also jede Runde
    // vergeblich versucht — und im STAND stuende weiter ein alter Wert.
    // Beantwortet wird sie live ueber das Werkzeug "nachschlagen".
    const faellig = zustand.veraltet().filter((t) => t !== "buchhaltung");
    if (!faellig.length) return;
    try { await zustand.bauen(null, faellig); }
    catch (e) { console.error(`Zustand (${faellig.join(", ")}):`, e.message); }
  };
  auffrischen();
  setInterval(auffrischen, takt).unref();
  console.log(`Zustand: prueft alle ${Math.round(takt / 60000)} Min., frischt auf was abgelaufen ist.`);
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

  // SPRACH-VERDICHTUNG (07.08.2026): dasselbe fuers GESPROCHENE Gespraech.
  //
  // Bis heute lief die Sprachspur an allem vorbei — das Sprachlog war reine
  // Technik-Diagnose und wurde von der Chronik nie gelesen. Darum begann jedes
  // Gespraech bei null: "Was habe ich dich gerade gefragt?" konnte sie nicht
  // beantworten, sobald drei Wortwechsel dazwischen lagen.
  //
  // Zwei Ergebnisse je Lauf: Firmenwissen nach eingang/erkenntnisse/ (wie
  // Telegram) UND eine fortgeschriebene Liste "so arbeitet Lukas", die bei
  // jeder Frage im STAND mitgeht. Letzteres ist der Lernteil.
  //
  // Takt bewusst 6 Stunden statt naechtlich: Was am Vormittag geklaert wurde,
  // soll am Nachmittag schon gelten, nicht erst morgen.
  const zuflussSprache = require("./lib/zufluss-sprache.js");
  const spTakt = Number(process.env.SPRACHE_VERDICHTUNG_MS || 6 * 60 * 60 * 1000);
  const spLaufen = () =>
    zuflussSprache.verdichte()
      .then((r) => {
        if (r.ok && (r.neu || r.gelernt)) {
          console.log(`Sprach-Verdichtung: ${r.neu} Erkenntnis(se), ${r.gelernt} zur Zusammenarbeit gelernt.`);
        } else if (!r.ok) console.error("Sprach-Verdichtung:", r.grund);
      })
      .catch((e) => console.error("Sprach-Verdichtung:", e.message));
  if (vault.schreibbar("eingang")) {
    setTimeout(spLaufen, 3 * 60 * 1000).unref();      // einmal kurz nach dem Start
    setInterval(spLaufen, spTakt).unref();
    console.log(`Zweites Gehirn: Sprach-Verdichtung alle ${Math.round(spTakt / 3600000)} Std.`);
  }

  // Von Hand ausloesen (Test/Vorschau).
  app.post("/api/gehirn/sprache-verdichten", async (req, res) => {
    try { res.json(await zuflussSprache.verdichte({ tage: Number(req.body?.tage) || 2 })); }
    catch (e) { res.status(500).json({ ok: false, grund: e.message }); }
  });

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
  // Eine Stunde vor dem Abend-Report, damit neue Belege noch darin auftauchen.
  const MAIL_STUNDE = Number(process.env.MAIL_BELEGE_STUNDE || (REPORT_STUNDE - 1));
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
  // RECHNUNGEN AUS DEM POSTFACH (07.08., Wunsch Lukas: "Wenn eine Rechnung an
  // meine Mail kommt, soll am Ende des Tages das immer ueberprueft werden.")
  //
  // Laeuft VOR dem Abend-Report, damit die neuen Belege noch in dessen Zahlen
  // auftauchen. Zwei Tage Rueckschau statt einem: faellt ein Lauf aus, ist am
  // naechsten Tag nichts verloren. Doppelte werden ohnehin an der Pruefsumme
  // erkannt und uebersprungen.
  let letzterMailTag = "";
  const mailBelege = require("./lib/mail-belege.js");
  const belegePruefen = async () => {
    const heute = berlinTag(), std = berlinStunde();
    if (letzterMailTag === heute || std !== MAIL_STUNDE) return;
    letzterMailTag = heute;
    try {
      const r = await mailBelege.laufen({
        dash: telegram.dash,
        tage: 2,
        melden: telegram.hatOwner?.() ? (t) => telegram.push(t) : null,
      });
      console.log(`Rechnungen aus dem Postfach: ${r.ok ? `${r.neu} neu` : r.hint}`);
    } catch (e) { console.error("Postfach-Belege:", e.message); }
  };

  const reportPruefen = async () => {
    const heute = berlinTag(), std = berlinStunde();
    if (letzterBriefingTag !== heute && std === BRIEFING_STUNDE) { letzterBriefingTag = heute; await proaktivSenden("morgen", "Morgen-Briefing"); }
    await belegePruefen();
    if (letzterReportTag !== heute && std === REPORT_STUNDE) { letzterReportTag = heute; await proaktivSenden("abend", "Abend-Report"); }
  };
  // Das Dashboard besitzt den Report (Entscheidung 22.07.): Es PLANT hier
  // zuverlaessig, laesst ihn von HERMES generieren (report.js) und liest ihn per
  // Stimme vor. Der Hermes-eigene Cron ist deaktiviert — dessen Kosten-Schutz
  // stoppt bei jedem Modellwechsel und er kann keine Stimme. So kommt der Report
  // verlaesslich und in Alexandras Stimme.
  setInterval(reportPruefen, 5 * 60 * 1000).unref();
  console.log(`Zweites Gehirn: Morgen-Briefing ${BRIEFING_STUNDE} Uhr + Abend-Report ${REPORT_STUNDE} Uhr, Rechnungen aus dem Postfach ${MAIL_STUNDE} Uhr.`);

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

  // SELBSTTEST (07.08.2026). Der Waechter oben prueft das Geschaeft, dieser
  // hier das System selbst: Hoeren, Sprechen, Datenbank, Modellzugang.
  //
  // Anlass: Der ElevenLabs-Schluessel wurde am 05.08. um 23:16 Uhr ungueltig,
  // Alexandra war zwei Tage stumm, und gemerkt hat es niemand.
  //
  // Zwei Unterschiede zum Waechter, beide Absicht:
  //   - RUND UM DIE UHR. Ein toter Zugang um zwei Uhr nachts ist um acht Uhr
  //     frueh immer noch tot; dann steht die Meldung schon da.
  //   - PER TELEGRAM, NIE PER STIMME. Eine kaputte Stimme kann sich nicht per
  //     Stimme melden.
  const selbsttest = require("./lib/selbsttest.js");
  const selbsttestLaufen = async () => {
    try {
      const r = await selbsttest.pruefe();
      if (r.text && telegram.hatOwner?.()) {
        await telegram.push(r.text, { stimme: false });
        console.log("Selbsttest:", r.text.replace(/\n/g, " ").slice(0, 120));
      }
    } catch (e) { console.error("Selbsttest:", e.message); }
  };
  setTimeout(selbsttestLaufen, 60 * 1000).unref();   // einmal kurz nach dem Start
  setInterval(selbsttestLaufen, 20 * 60 * 1000).unref();
  console.log("Zweites Gehirn: Selbsttest aktiv (alle 20 Min, Meldung per Telegram).");

  // Von Hand ausloesen — mit aktivem Anfassen statt nur Protokoll lesen.
  app.post("/api/gehirn/selbsttest", async (req, res) => {
    try {
      const r = await selbsttest.pruefe({ aktivErzwingen: true });
      res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, hint: e.message }); }
  });

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

// ---------- Zentrale: JARVIS // COMMAND CENTER ----------
//
// Umbau vom Karten-Dashboard zum Steuerpult (19.08.2026).
//
// Anlass: Diese Seite wird abgefilmt und als Meta-Anzeige fuer das Operating
// System geschaltet. Sie muss aus zwei Metern Entfernung auf einem grossen
// Bildschirm tragen — dicht, leuchtend, in dauernder Bewegung. Ein ruhiges
// Kachel-Dashboard waere fuer diesen Zweck ein Fehlschlag.
//
// Was sich dabei NICHT geaendert hat, und das ist die wichtigere Haelfte:
// - Es sind dieselben echten Zahlen aus derselben Datenbank wie vorher. Kein
//   Wert auf dieser Seite ist erfunden. Was es nicht gibt, steht als
//   Leerzustand da und wird nicht durch eine huebsche Null ersetzt.
// - Die Buchhaltung sieht weiterhin nur die Geschaeftsfuehrung (dieselbe
//   Regel wie unter /buchhaltung).
// - Jeder Weg in einen anderen Bereich laeuft ueber darfModul(). Eine Kachel
//   ist eine Tuer, und eine Tuer, die nicht aufgeht, gehoert nicht in die Wand.
// - Ohne persoenliche Anmeldung bleibt die Seite benutzbar: Termine, Briefing
//   und die Wege in die Bereiche stehen, die Zahlen nicht — an dem Konto
//   haengen die Zeilenrechte in der Datenbank.
//
// Aufbau: hudDaten() holt alles in einem Rutsch, hudWerte() rechnet daraus die
// abgeleiteten Groessen, hudStuecke() baut die Teile, die sich bewegen.
// Dieselben drei Funktionen benutzt /api/hud/zentrale weiter unten. So gibt es
// GENAU EINE Darstellung jeder Zahl — der Nachzug im Browser kann nicht
// auseinanderlaufen mit dem, was beim ersten Laden dastand. (Genau das war
// beim frueheren Kalender-Doppel passiert, siehe /api/kalender/tag.)

// Der Direktionsvertrag. Steht im ausgelieferten HTML direkt hinter <body>,
// damit die Entwurfsentscheidung dort nachlesbar ist, wo die Seite entsteht —
// und nicht nur in einem Dokument, das niemand oeffnet.
const HUD_VERTRAG = `<!--
THESIS: Die Firma ist ein Instrument; die Startseite ist sein Cockpit, nicht ihr Bericht.
OWN-WORLD: Fast schwarzes Blau, ein einziger leuchtender Akzent (#4B8DF8), Eckwinkel statt Karten, gesperrte Versalien, Messwerte in Monospace. Signalfarben nur fuer Alarm und Trend.
STORY: Das Pult faehrt hoch — Panels setzen sich, Zahlen zaehlen an, der Zeiger schwingt ein, die Saeulen bauen sich von links auf. Danach bleibt es wach: Band, Lauftext, Puls, Nachzug alle 45 Sekunden.
FIRST VIEWPORT: Kopfzeile mit Kennwertband; darunter Tageslast-Kugel links, das Anstehende gross in der Mitte, Messuhr Monatsumsatz rechts.
FORM: Ungleiches Zwoelf-Spalten-Raster, dichte Mikrotypografie, gezeichnete SVG-Instrumente. Jede Flaeche traegt einen echten Wert oder bleibt ehrlich leer.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

// Zeichen, die es in ICON (schale.js) und ZT (oben) noch nicht gibt. Gebaut
// mit demselben S() und derselben Strichstaerke — echte gezeichnete Pfade,
// keine Unicode-Pfeile: ein Pult mit ▲ und → aus der Zeichentabelle sieht in
// jedem Browser anders aus.
const HUD_IKON = {
  pfeil: S('<path d="M4 12h13M12 7l5 5-5 5"/>'),
  telefon: S('<path d="M15.7 21A12.7 12.7 0 0 1 3 8.3V6a1.5 1.5 0 0 1 1.5-1.5h2.2a1 1 0 0 1 1 .8l.6 2.9a1 1 0 0 1-.5 1.1l-1.5.7a11 11 0 0 0 5.2 5.2l.7-1.5a1 1 0 0 1 1.1-.5l2.9.6a1 1 0 0 1 .8 1V19.5A1.5 1.5 0 0 1 18 21z"/>'),
  puls: S('<path d="M2 12h4l2.6-7.5 4.8 15L16 12h6"/>'),
};

// Wie viele Zellen eine Saeule im Histogramm hoch ist. 22 statt eines glatten
// Balkens: das ist die Rasterung eines Messgeraets, und sie macht die Saeulen
// im Video lesbar, wo ein Farbverlauf verschwimmt.
const HUD_ZELLEN = 22;

// Die fuenf Ausgaenge eines Cold Calls, in der Reihenfolge, in der man sie
// lesen will: erst der Erfolg, dann die Zwischenzustaende, zuletzt die Absage.
// Die Schluessel sind die Tags aus der Datenbank (siehe crm.anrufStatistik).
const HUD_CALLS = [
  { schluessel: "gebucht", titel: "Erstgespräch gebucht", ton: "gruen" },
  { schluessel: "follow-up", titel: "Follow-up", ton: "" },
  { schluessel: "nicht-erreicht", titel: "Nicht erreicht", ton: "gelb" },
  { schluessel: "keine-zeit", titel: "Keine Zeit", ton: "gelb" },
  { schluessel: "absage", titel: "Absage", ton: "rot" },
];

const MONATSKUERZEL = ["JAN", "FEB", "MÄR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"];
const hudZahl = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const hudTag = (w) => (w ? new Date(w).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : "");

// Cache-Stempel fuer die eigenen Browser-Dateien. Dasselbe Verfahren wie in
// lib/schale.js: nach einem Deploy laeuft sonst im Browser die alte Fassung
// weiter, und ein bereits behobener Fehler wirkt fort.
function hudStempel(datei) {
  try {
    const st = fs.statSync(path.join(__dirname, "public", datei.replace(/^\//, "")));
    return "?v=" + Math.round(st.mtimeMs).toString(36);
  } catch { return ""; }
}

// Alle Zahlen der Zentrale in einem Rutsch. Faellt ein Teil aus, faellt nur
// dieser Teil aus — die Seite bleibt stehen. Auf einem Laptop ohne
// DATABASE_URL laeuft sie ohne eine einzige Abfrage durch.
async function hudDaten(req) {
  const nutzer = (req.session && req.session.crm) || null;
  const admin = Boolean(nutzer && nutzer.rolle === "admin");
  const darf = (id) => require("./lib/schale.js").darfModul(nutzer, id);
  const datenbank = Boolean(process.env.DATABASE_URL);
  const d = {
    nutzer, admin, darf, datenbank,
    fehler: null, z: null, kz: null, todos: [],
    team: [], anrufeJePerson: {}, anrufe: null, finanzen: null,
  };
  if (!datenbank || !nutzer) return d;

  const crm = require("./lib/crm.js");
  try {
    // zentraleZahlen liefert Umsatz, Zwoelf-Monats-Verlauf und den gewichteten
    // Forecast; kennzahlen() legt die Zaehlstaende daneben, die dort nicht
    // drinstehen (Wiedervorlagen, gewonnen/verloren im Monat).
    const [z, kz, todos] = await Promise.all([
      crm.zentraleZahlen(nutzer),
      crm.kennzahlen(nutzer),
      crm.todosHeute(nutzer).catch(() => []),
    ]);
    d.z = z; d.kz = kz; d.todos = todos || [];
  } catch (e) {
    console.error("Zentrale-Zahlen:", e.message);
    d.fehler = "Umsatz, Aufgaben und Pipeline sind gerade nicht abrufbar — die CRM-Datenbank antwortet nicht.";
    return d;
  }

  // Cold Calling. Ohne Adminrechte NUR die eigene Liste: sonst stehen bei
  // Jannik die Anrufe, die Ioannis gefuehrt hat, als seine da (der Fehler vom
  // 29.07., siehe Kommentar an crm.anrufStatistik).
  if (darf("crm")) {
    try { d.anrufe = await crm.anrufStatistik(nutzer, admin ? {} : { besitzer: nutzer.id }); }
    catch (e) { console.error("Zentrale-Anrufe:", e.message); }
  }

  // Die Aufschluesselung je Person gibt es nur fuer die Geschaeftsfuehrung —
  // dieselbe Regel wie bei /crm/team (nurAdmin in der Rail).
  if (admin && darf("crm")) {
    try {
      const team = await crm.teamZahlen(nutzer);
      d.team = team || [];
      const je = await Promise.all(d.team.map((p) =>
        crm.anrufStatistik(nutzer, { besitzer: p.id }).catch(() => null)));
      d.team.forEach((p, i) => { d.anrufeJePerson[p.id] = je[i]; });
    } catch (e) { console.error("Zentrale-Team:", e.message); }
  }

  // Buchhaltung: dieselbe Rechtepruefung wie in /api/buchhaltung/stats.
  if (admin) {
    try { d.finanzen = await require("./lib/buchhaltung.js").kennzahlen(nutzer); }
    catch (e) { console.error("Zentrale-Finanzen:", e.message); }
  }
  return d;
}

// Aus den Rohdaten die Groessen, die das Pult anzeigt. Alles hier ist eine
// Rechnung auf echten Werten — nichts wird geschaetzt und nichts gefuellt.
function hudWerte(d) {
  const z = d.z, kz = d.kz, f = d.finanzen;
  const verlauf = z ? z.verlauf : [];
  const monat = z ? z.umsatz.monat : 0;
  const vormonat = z ? z.umsatz.vormonat : 0;

  // Die Skala der Messuhr ist der beste Monat der letzten zwoelf. Bewusst kein
  // ERFUNDENES Monatsziel: ein Zeiger, der gegen eine ausgedachte Marke laeuft,
  // behauptet etwas ueber die Firma, das niemand festgelegt hat. Der beste
  // bisherige Monat ist eine Zahl, die es wirklich gibt — und der Zeiger sagt
  // damit "so gut wie je" statt "Ziel erreicht".
  //
  // Wer aber UMSATZ_ZIEL setzt, HAT eines festgelegt — dann ist es nicht mehr
  // ausgedacht, und der Zeiger darf dagegen laufen (20.08.2026). Ohne die
  // Variable bleibt alles wie bisher.
  const zielUmsatz = Number(process.env.UMSATZ_ZIEL) || 0;
  const skala = zielUmsatz > 0
    ? zielUmsatz
    : Math.max(monat, vormonat, ...verlauf.map((v) => v.wert), 0);
  const uhrAnteil = skala > 0 ? Math.min(1, monat / skala) : 0;
  const vormonatAnteil = skala > 0 ? Math.min(1, vormonat / skala) : 0;

  // Veraenderung zum Vormonat. Ohne Vormonatsumsatz gibt es keinen Prozentwert
  // — "+100 %" auf eine Null ist keine Aussage, sondern eine Division, die
  // zufaellig durchgeht.
  const wachstum = vormonat > 0 ? Math.round(((monat - vormonat) / vormonat) * 100) : null;

  const nach = (d.anrufe && d.anrufe.nach) || {};
  const anrufeGesamt = Object.keys(nach).reduce((n, k) => n + (nach[k].gesamt || 0), 0);
  const anrufeHeute = Object.keys(nach).reduce((n, k) => n + (nach[k].heute || 0), 0);
  const callMax = Math.max(1, ...HUD_CALLS.map((c) => (nach[c.schluessel] || {}).gesamt || 0));

  const t = (z && z.todos) || { offen: 0, heute: 0, ueberfaellig: 0, heute_erledigt: 0 };
  const tagesLast = t.heute + t.heute_erledigt;
  const tagesAnteil = tagesLast > 0 ? t.heute_erledigt / tagesLast : 0;

  const histMax = Math.max(1, ...verlauf.map((v) => v.wert));

  return {
    skala, zielUmsatz, uhrAnteil, vormonatAnteil, wachstum, verlauf, histMax,
    nach, anrufeGesamt, anrufeHeute, callMax, todos: t, tagesLast, tagesAnteil,
    // Die flache Werteliste: genau diese Schluessel stehen als data-wert an den
    // Zahlen im HTML, und genau sie schickt /api/hud/zentrale beim Nachzug.
    werte: {
      umsatz_monat: monat,
      umsatz_vormonat: vormonat,
      umsatz_gesamt: z ? z.umsatz.gesamt : 0,
      abschluesse_monat: z ? z.umsatz.anzahl_monat : 0,
      abschluesse_gesamt: z ? z.umsatz.anzahl_gesamt : 0,
      forecast: z ? z.forecast : 0,
      erwartet30: z ? z.erwartet30 : 0,
      pipeline_wert: z ? z.pipeline_wert : 0,
      offene_deals: z ? z.offene_deals : 0,
      kunden: z ? z.kunden : 0,
      leads: z ? z.leads : 0,
      gewonnen_monat: kz ? kz.gewonnen_monat : 0,
      verloren_monat: kz ? kz.verloren_monat : 0,
      wiedervorlagen: kz ? kz.wiedervorlagen : 0,
      todos_heute: t.heute,
      todos_offen: t.offen,
      todos_ueberfaellig: t.ueberfaellig,
      todos_erledigt: t.heute_erledigt,
      anrufe_gesamt: anrufeGesamt,
      anrufe_heute: anrufeHeute,
      gebucht_gesamt: (nach.gebucht || {}).gesamt || 0,
      absagen_gesamt: (nach.absage || {}).gesamt || 0,
      fin_einnahmen: f ? f.einnahmen_monat : 0,
      fin_ausgaben: f ? f.ausgaben_monat : 0,
      fin_ergebnis: f ? f.ergebnis_monat : 0,
      fin_offen: f ? f.offen_summe : 0,
      fin_ueberfaellig: f ? f.ueberfaellig : 0,
      fin_belege: f ? f.belege_offen : 0,
    },
  };
}

// Eine grosse Zahl im Pult. data-ziel = der Wert, von dem aus hud-zentrale.js
// hochzaehlt; data-wert = der Name, unter dem der Nachzug sie wiederfindet.
function hudZ(schluessel, wert, art, klasse) {
  const text = art === "eur" ? eur(wert) : art === "eurk" ? eurK(wert) : hudZahl(wert);
  return `<span class="hud-zahl${klasse ? " " + klasse : ""}" data-wert="${schluessel}"` +
    ` data-ziel="${Number(wert) || 0}" data-format="${art || "zahl"}">${text}</span>`;
}
// Eine Zahl mitten im Satz: zaehlt nicht hoch (kein data-ziel), wird beim
// Nachzug aber mit aktualisiert — sonst stuende neben einer frischen Summe
// eine alte Stueckzahl.
function hudN(schluessel, wert, art) {
  const text = art === "eur" ? eur(wert) : art === "eurk" ? eurK(wert) : hudZahl(wert);
  return `<span data-wert="${schluessel}" data-format="${art || "zahl"}">${text}</span>`;
}

// --- Die beweglichen Stuecke. Seite und Nachzug bauen sie mit denselben
//     Funktionen, damit es keine zweite Fassung derselben Liste gibt. ---

function hudTodoListe(d) {
  if (!d.nutzer || !d.datenbank) {
    return `<div class="hud-leer">${ZT.info}<div><b>Ohne Anmeldung keine Aufgaben</b>
      Die Aufgaben hängen an deinem persönlichen Konto.</div></div>`;
  }
  if (!d.todos.length) {
    const offen = d.z ? d.z.todos.offen : 0;
    return `<div class="hud-leer">${ZT.haken}<div><b>Nichts eingeplant</b>
      ${offen ? `${offen} Aufgaben sind offen, aber keine für heute vorgemerkt.` : "Alles erledigt."}</div></div>`;
  }
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const zeilen = d.todos.slice(0, 7).map((t) => {
    const spaet = Boolean(t.faellig && new Date(t.faellig) < heute);
    const sparte = ["webdesign", "performance", "ki"].includes(t.sparte) ? t.sparte : "ohne";
    const unter = [t.firma_name, t.geschaeftsfuehrer, t.ort, t.dringlichkeit]
      .filter(Boolean).map((x) => esc(x)).join(" · ");
    const stempel = t.faellig ? `${spaet ? "SEIT" : "BIS"} ${hudTag(t.faellig)}` : "HEUTE";
    // Die Zeile fuehrt in die Kundenakte, ersatzweise in die Aufgabenliste.
    // Darf sie weder das eine noch das andere oeffnen, wird sie KEIN Link:
    // ein Klick, der auf der Zentrale wieder landet, ist eine Sackgasse mit
    // Zeigefinger-Cursor.
    const ziel = d.darf("crm") && t.firma_id ? `/crm/firma/${t.firma_id}` : d.darf("todos") ? "/todos" : null;
    const inneres = `<span class="hud-marke-punkt ${sparte}" aria-hidden="true"></span>
      <span class="hud-todo-text"><strong>${esc(t.titel)}</strong>${unter ? `<span>${unter}</span>` : ""}</span>
      <span class="hud-stempel ${spaet ? "spaet" : "jetzt"}">${stempel}</span>`;
    return ziel ? `<a class="hud-todo-zeile" href="${ziel}">${inneres}</a>`
                : `<div class="hud-todo-zeile">${inneres}</div>`;
  }).join("");
  const rest = d.todos.length - 7;
  if (rest <= 0) return zeilen;
  const mehr = `<span class="hud-marke-punkt ohne" aria-hidden="true"></span>
    <span class="hud-todo-text"><strong>${rest} weitere Aufgaben für heute</strong></span>
    <span class="hud-stempel">ALLE</span>`;
  return zeilen + (d.darf("todos")
    ? `<a class="hud-todo-zeile" href="/todos">${mehr}</a>`
    : `<div class="hud-todo-zeile">${mehr}</div>`);
}

// Die roten Zeilen unten. Was hier steht, ist wirklich fällig — überfällig
// heisst überfällig. Ist nichts offen, sagt die Zeile das ebenso deutlich,
// statt einfach zu verschwinden: eine leere Flaeche liesse offen, ob geprueft
// wurde oder nur nichts geladen hat.
function hudAlarme(d) {
  const zeilen = [];
  const zeile = (klasse, ikon, text, ziel) => zeilen.push(ziel
    ? `<a class="hud-alarm-zeile ${klasse}" href="${ziel}">${ikon}<span>${text}</span><span>ANSEHEN</span></a>`
    : `<div class="hud-alarm-zeile ${klasse}">${ikon}<span>${text}</span><span></span></div>`);

  if (d.z && d.z.todos.ueberfaellig) {
    zeile("", ZT.warnung, `<b>${d.z.todos.ueberfaellig}</b> Aufgaben überfällig`,
      d.darf("todos") ? "/todos" : null);
  }
  if (d.kz && d.kz.wiedervorlagen) {
    zeile("gelb", HUD_IKON.telefon, `<b>${d.kz.wiedervorlagen}</b> Wiedervorlagen fällig`,
      d.darf("crm") ? "/crm/leads" : null);
  }
  // d.finanzen gibt es nur fuer die Geschaeftsfuehrung — fuer alle anderen ist
  // es oben gar nicht erst geholt worden.
  if (d.finanzen && d.finanzen.ueberfaellig) {
    zeile("", ICON.beleg, `<b>${d.finanzen.ueberfaellig}</b> Rechnungen überfällig`, "/buchhaltung");
  }
  if (d.finanzen && d.finanzen.belege_offen) {
    zeile("gelb", ICON.beleg, `<b>${d.finanzen.belege_offen}</b> Belege ohne Buchung`, "/buchhaltung");
  }
  if (d.fehler) zeile("", ZT.warnung, esc(d.fehler), null);
  if (!zeilen.length) zeile("ruhig", ZT.haken, "<b>Ruhig</b> — nichts überfällig, nichts unerledigt", null);
  return zeilen.join("");
}

function hudTeamKoerper(d) {
  if (!d.team.length) return "";
  const leer = (x) => (Number(x) ? "" : ' class="null"');
  return d.team.map((p) => {
    const n = (d.anrufeJePerson[p.id] && d.anrufeJePerson[p.id].nach) || {};
    const gebucht = (n.gebucht || {}).gesamt || 0;
    const absagen = (n.absage || {}).gesamt || 0;
    return `<tr>
      <td title="${esc(p.name)}">${esc(p.name)}</td>
      <td${leer(p.anrufe_heute)}>${hudZahl(p.anrufe_heute)}</td>
      <td${leer(gebucht)}>${hudZahl(gebucht)}</td>
      <td${leer(absagen)}>${hudZahl(absagen)}</td>
      <td${leer(p.kunden)}>${hudZahl(p.kunden)}</td>
      <td${leer(p.umsatz_monat)}>${eurK(p.umsatz_monat)}</td>
    </tr>`;
  }).join("");
}

function hudHistSaeulen(d, w) {
  if (!w.verlauf.length) return "";
  const letzter = w.verlauf[w.verlauf.length - 1];
  return w.verlauf.map((v) => {
    const nr = Number(v.monat.slice(5, 7)) - 1;
    const anteil = w.histMax > 0 ? v.wert / w.histMax : 0;
    // Ein Monat mit Umsatz bekommt mindestens eine leuchtende Zelle: sonst
    // saehe ein kleiner Abschluss aus wie gar keiner.
    const an = v.wert > 0 ? Math.max(1, Math.round(anteil * HUD_ZELLEN)) : 0;
    let zellen = "";
    for (let i = 0; i < HUD_ZELLEN; i++) zellen += `<i class="hud-hist-zelle${i < an ? " an" : ""}"></i>`;
    return `<div class="hud-hist-saeule${v === letzter ? " jetzt" : ""}"
      title="${MONATSKUERZEL[nr] || esc(v.monat)}: ${eur(v.wert)}">
      <div class="hud-hist-zellen">${zellen}</div>
      <div class="hud-hist-monat">${MONATSKUERZEL[nr] || "?"}</div></div>`;
  }).join("");
}

// Das Kennwertband im Kopf und der Lauftext unten. Beide laufen als Schleife —
// der Inhalt steht darum zweimal hintereinander, sonst reisst die Schleife
// sichtbar ab. Fuer Vorleseprogramme sind sie ausgeblendet: jede Zahl darin
// steht weiter unten noch einmal als richtiger Wert.
function hudBand(d, w) {
  if (!d.z) {
    const eine = `<span class="hud-chip">FLOWSTATE OS <b>ZENTRALE</b></span>`;
    return eine + eine;
  }
  const v = w.werte;
  const teile = [];
  const chip = (label, wert, trend) => teile.push(`<span class="hud-chip">${label} <b>${wert}</b>${trend || ""}</span>`);
  chip("UMSATZ MONAT", eur(v.umsatz_monat), w.wachstum === null ? ""
    : ` <span class="${w.wachstum >= 0 ? "j-auf" : "j-ab"}">${w.wachstum >= 0 ? "+" : "−"}${Math.abs(w.wachstum)} %</span>`);
  chip("KUNDEN", hudZahl(v.kunden));
  chip("LEADS", hudZahl(v.leads));
  chip("OFFENE DEALS", hudZahl(v.offene_deals));
  // Nullwerte laufen nicht im Band mit: "PIPELINE 0 €" alle vierzig Sekunden
  // sagt nichts, was die Ablesung unten rechts nicht genauer sagt. Sobald
  // Summen in den Deals stehen, sind die Chips von selbst wieder da.
  if (v.pipeline_wert > 0) chip("PIPELINE", eurK(v.pipeline_wert));
  if (v.forecast > 0) chip("FORECAST", eurK(v.forecast));
  if (v.gebucht_gesamt) chip("ERSTGESPRÄCHE", hudZahl(v.gebucht_gesamt));
  chip("AUFGABEN HEUTE", hudZahl(v.todos_heute));
  if (v.todos_ueberfaellig) chip("ÜBERFÄLLIG", `<span class="j-ab">${hudZahl(v.todos_ueberfaellig)}</span>`);
  if (d.anrufe) chip("ANRUFE HEUTE", hudZahl(v.anrufe_heute));
  if (v.wiedervorlagen) chip("WIEDERVORLAGEN", hudZahl(v.wiedervorlagen));
  const eine = teile.join("");
  return eine + eine;
}

function hudTicker(d, w) {
  const zeilen = [];
  if (d.z) {
    const v = w.werte;
    const monatName = new Date().toLocaleDateString("de-DE", { month: "long" }).toUpperCase();
    zeilen.push(`UMSATZ ${monatName} <b>${eur(v.umsatz_monat)}</b> aus <b>${hudZahl(v.abschluesse_monat)}</b> Abschlüssen`);
    zeilen.push(`UMSATZ INSGESAMT <b>${eur(v.umsatz_gesamt)}</b> aus <b>${hudZahl(v.abschluesse_gesamt)}</b> Abschlüssen`);
    // Ohne hinterlegte Summen sagt "PIPELINE 0 €" weniger als der Grund dafuer.
    if (v.pipeline_wert > 0) {
      zeilen.push(`PIPELINE <b>${eur(v.pipeline_wert)}</b> in <b>${hudZahl(v.offene_deals)}</b> offenen Deals`);
      zeilen.push(`FORECAST <b>${eur(v.forecast)}</b> gewichtet nach Phase`);
    } else if (v.offene_deals) {
      zeilen.push(`PIPELINE <b>${hudZahl(v.offene_deals)}</b> offene Deals · noch ohne hinterlegte Summe`);
    }
    if (v.erwartet30) zeilen.push(`NÄCHSTE 30 TAGE <b>${eur(v.erwartet30)}</b> erwartet`);
    zeilen.push(`KUNDEN <b>${hudZahl(v.kunden)}</b> · LEADS <b>${hudZahl(v.leads)}</b>`);
    zeilen.push(`GEWONNEN DIESEN MONAT <b>${hudZahl(v.gewonnen_monat)}</b> · VERLOREN <b>${hudZahl(v.verloren_monat)}</b>`);
    zeilen.push(`AUFGABEN HEUTE <b>${hudZahl(v.todos_heute)}</b> offen · <b>${hudZahl(v.todos_erledigt)}</b> erledigt`);
    if (d.anrufe) zeilen.push(`COLD CALLS <b>${hudZahl(v.anrufe_gesamt)}</b> gesamt · <b>${hudZahl(v.anrufe_heute)}</b> heute`);
    if (d.finanzen) zeilen.push(`EINNAHMEN DIESEN MONAT <b>${eur(v.fin_einnahmen)}</b> · AUSGABEN <b>${eur(v.fin_ausgaben)}</b>`);
  } else {
    zeilen.push("FLOWSTATE OS · <b>ZENTRALE</b> · Melde dich persönlich an, dann stehen hier die Zahlen");
  }
  const eine = zeilen.map((t) => `<span>${t}</span>`).join("");
  return eine + eine;
}

function hudStuecke(d, w) {
  return {
    todos: hudTodoListe(d),
    alarme: hudAlarme(d),
    team: hudTeamKoerper(d),
    band: hudBand(d, w),
    ticker: hudTicker(d, w),
    hist: hudHistSaeulen(d, w),
  };
}

// --- Die Instrumente. Beide werden serverseitig im ENDZUSTAND gezeichnet;
//     hud-zentrale.js setzt sie kurz auf Anfang und faehrt sie hoch. Ohne
//     Skript steht der richtige Wert da, nur ohne Anlauf. ---

// Messuhr-Geometrie: 270 Grad Skala, Start unten links (135 Grad), Ende unten
// rechts. 0 Grad zeigt nach rechts, y waechst nach unten — SVG-Koordinaten.
function hudUhrPunkt(grad, r) {
  const b = (grad * Math.PI) / 180;
  return [100 + r * Math.cos(b), 100 + r * Math.sin(b)];
}
function hudUhrBogen(anteil, r) {
  const spanne = 270 * Math.max(0, Math.min(1, anteil));
  const a = hudUhrPunkt(135, r), b = hudUhrPunkt(135 + spanne, r);
  return `M${a[0].toFixed(2)},${a[1].toFixed(2)} A${r},${r} 0 ${spanne > 180 ? 1 : 0} 1 ${b[0].toFixed(2)},${b[1].toFixed(2)}`;
}

function hudMessuhr(w) {
  const striche = [];
  for (let i = 0; i <= 40; i++) {
    const gross = i % 4 === 0;
    const g = 135 + (270 * i) / 40;
    const a = hudUhrPunkt(g, gross ? 62 : 66), b = hudUhrPunkt(g, 71);
    striche.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"
      stroke="${gross ? "var(--j-blau-hell)" : "var(--j-linie-hell)"}" stroke-width="${gross ? 1.6 : 1}"/>`);
  }
  const vm1 = hudUhrPunkt(135 + 270 * w.vormonatAnteil, 74);
  const vm2 = hudUhrPunkt(135 + 270 * w.vormonatAnteil, 90);
  return `<svg id="hud-uhr-svg" viewBox="0 0 200 200" data-anteil="${w.uhrAnteil.toFixed(4)}" role="img"
    aria-label="Umsatz diesen Monat ${eur(w.werte.umsatz_monat)} auf einer Skala bis ${eur(w.skala)}">
    <circle cx="100" cy="100" r="94" fill="none" stroke="var(--j-linie)"/>
    <circle cx="100" cy="100" r="44" fill="none" stroke="var(--j-linie)" stroke-dasharray="2 5"/>
    ${striche.join("")}
    <path d="${hudUhrBogen(1, 78)}" fill="none" stroke="var(--j-linie)" stroke-width="7"/>
    <path class="hud-uhr-bogen" d="${w.uhrAnteil > 0 ? hudUhrBogen(w.uhrAnteil, 78) : ""}" fill="none"
      stroke="var(--j-blau)" stroke-width="7" style="filter:drop-shadow(0 0 6px rgba(75,141,248,.55))"/>
    ${w.vormonatAnteil > 0 ? `<line x1="${vm1[0].toFixed(1)}" y1="${vm1[1].toFixed(1)}"
      x2="${vm2[0].toFixed(1)}" y2="${vm2[1].toFixed(1)}" stroke="var(--j-gelb)" stroke-width="2"/>` : ""}
    <g class="hud-uhr-zeiger" transform="rotate(${(135 + 270 * w.uhrAnteil).toFixed(2)} 100 100)">
      <polygon points="50,96.8 84,99.4 84,100.6 50,103.2" fill="var(--j-blau-hell)"/>
    </g>
  </svg>`;
}

// Die Kugel: Tageslast. Der Ring aussen ist der Anteil der heute schon
// erledigten Aufgaben, die Zahl in der Mitte, was noch offen ist.
function hudKugel(w) {
  const striche = [];
  for (let i = 0; i < 60; i++) {
    const lang = i % 5 === 0;
    const a = hudUhrPunkt((360 * i) / 60, lang ? 88 : 91), b = hudUhrPunkt((360 * i) / 60, 95);
    striche.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"
      stroke="var(--j-linie-hell)" stroke-width="${lang ? 1.4 : 0.8}"/>`);
  }
  const umfang = 2 * Math.PI * 80;
  return `<svg viewBox="0 0 200 200" role="img"
    aria-label="Tageslast: ${w.todos.heute_erledigt} von ${w.tagesLast} Aufgaben erledigt">
    <defs>
      <radialGradient id="hudKugel" cx="34%" cy="28%" r="78%">
        <stop offset="0%" stop-color="#1E3F72"/>
        <stop offset="52%" stop-color="#0B1A33"/>
        <stop offset="100%" stop-color="#050A14"/>
      </radialGradient>
    </defs>
    ${striche.join("")}
    <circle cx="100" cy="100" r="80" fill="none" stroke="var(--j-linie)" stroke-width="4"/>
    ${w.tagesAnteil > 0 ? `<circle cx="100" cy="100" r="80" fill="none" stroke="var(--j-blau)" stroke-width="4"
      stroke-dasharray="${(umfang * w.tagesAnteil).toFixed(1)} ${umfang.toFixed(1)}"
      transform="rotate(-90 100 100)" style="filter:drop-shadow(0 0 7px rgba(75,141,248,.6))"/>` : ""}
    <circle cx="100" cy="100" r="66" fill="url(#hudKugel)" stroke="var(--j-linie-hell)"/>
    <g class="hud-orb-netz" opacity=".5">
      <ellipse cx="100" cy="100" rx="66" ry="22" fill="none" stroke="var(--j-blau-tief)"/>
      <ellipse cx="100" cy="100" rx="66" ry="44" fill="none" stroke="var(--j-blau-tief)"/>
      <ellipse cx="100" cy="100" rx="22" ry="66" fill="none" stroke="var(--j-blau-tief)"/>
      <ellipse cx="100" cy="100" rx="44" ry="66" fill="none" stroke="var(--j-blau-tief)"/>
      <circle cx="100" cy="100" r="66" fill="none" stroke="var(--j-linie-akzent)"/>
    </g>
  </svg>`;
}

// ---------------------------------------------------------------- Die Seite
app.get("/", async (req, res) => {
  const jetzt = new Date();
  const heute = jetzt.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const nutzer = (req.session && req.session.crm) || null;
  // Wer nur mit dem gemeinsamen Passwort da ist, gilt fuer die KNOEPFE als
  // Geschaeftsfuehrung (unveraendert gegenueber vorher): die Bereiche fragen
  // selbst nach der Anmeldung. Fuer die ZAHLEN gilt das nicht — dafuer braucht
  // es ein Konto, an dem die Zeilenrechte haengen.
  const knopfAdmin = !nutzer || nutzer.rolle === "admin";
  const darf = (id) => require("./lib/schale.js").darfModul(nutzer, id);
  const datenbank = Boolean(process.env.DATABASE_URL);

  const d = await hudDaten(req);
  const w = hudWerte(d);
  const s = hudStuecke(d, w);
  const zahlen = Boolean(d.z);

  const monatName = jetzt.toLocaleDateString("de-DE", { month: "long" });
  const vormonatName = (() => {
    const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - 1);
    return x.toLocaleDateString("de-DE", { month: "long" });
  })();

  // Wie breit welches Panel steht. Wird gerechnet statt festgelegt, weil je
  // nach Rechten Panels wegfallen — und eine Reihe, die auf neun statt zwoelf
  // Spalten aufgeht, laesst rechts ein Loch stehen.
  const callsDa = darf("crm");
  const teamDa = d.team.length > 0;
  const finDa = Boolean(d.finanzen);
  const sHist = callsDa ? 6 : 9;
  const sLog = callsDa ? 3 : 3;
  const sTeam = teamDa && finDa ? 5 : teamDa ? 8 : 0;
  const sFin = finDa && teamDa ? 3 : finDa ? 4 : 0;
  // Die rechte Fussspalte traegt Pipeline-Ablesung und Meldezeilen. Sie nimmt,
  // was Team und Buchhaltung uebriglassen — vier von zwoelf, wenn beide da
  // sind, sonst mehr. Vorher stand dort nur die Alarmleiste, eine Zeile hoch:
  // rechts unten blieb ein Loch, und genau dort hoert das Bild auf.
  const sRechts = teamDa && finDa ? 4 : teamDa ? 4 : finDa ? 8 : 12;

  const weg = (ziel, wort) => `<a class="hud-weg" href="${ziel}">${wort} ${HUD_IKON.pfeil}</a>`;
  const titel = (label, rechts) => `<div class="hud-titel"><span class="j-label">${label}</span>
    <span class="hud-titel-fuell"></span>${rechts || ""}</div>`;

  // --- Kopfzeile: Marke links, durchlaufendes Kennwertband rechts ---
  const kopf = `
    <header class="hud-kopf">
      <div class="hud-marke">
        <span class="hud-puls" aria-hidden="true"></span>
        <h1>Jarvis <i>//</i> Command Center</h1>
      </div>
      <span class="hud-datum">${esc(heute)}${nutzer ? " · " + esc(nutzer.name.split(" ")[0]) : ""}
        · <span id="hud-uhrzeit">${esc(jetzt.toLocaleTimeString("de-DE"))}</span></span>
      <div class="hud-band" aria-hidden="true"><div class="hud-band-lauf" id="hud-band-lauf">${s.band}</div></div>
    </header>`;

  // --- Kugel: Tageslast ---
  const kugel = `
    <section class="j-panel hud-orb hud-s3">
      ${titel("Tageslast", darf("todos") ? weg("/todos", "To-Dos") : "")}
      <div class="hud-orb-buehne">
        ${hudKugel(w)}
        <div class="hud-orb-mitte">
          ${hudZ("todos_heute", w.werte.todos_heute, "zahl")}
          <span class="j-label">offen heute</span>
        </div>
      </div>
      <div class="hud-orb-fuss">
        <span class="hud-mikro">Erledigt<br><b>${hudN("todos_erledigt", w.werte.todos_erledigt)}</b> von ${hudZahl(w.tagesLast)}</span>
        <span class="hud-mikro" style="text-align:right">Offen gesamt<br><b>${hudN("todos_offen", w.werte.todos_offen)}</b></span>
      </div>
    </section>`;

  // --- Das Wichtigste: was heute ansteht ---
  const todoPanel = `
    <section class="j-panel hud-todo hud-s6">
      ${titel("Anstehend heute", darf("todos") ? weg("/todos", "Alle Aufgaben") : "")}
      <div class="hud-todo-kopf">
        ${hudZ("todos_heute", w.werte.todos_heute, "zahl")}
        <div class="hud-todo-kopf-text">
          <span class="j-label">Aufgaben für heute</span>
          <span class="hud-mikro">${w.werte.todos_ueberfaellig
            ? `<b class="j-ab">${hudN("todos_ueberfaellig", w.werte.todos_ueberfaellig)} überfällig</b> · ` : ""}
            <b>${hudN("todos_offen", w.werte.todos_offen)}</b> offen insgesamt ·
            <b>${hudN("todos_erledigt", w.werte.todos_erledigt)}</b> heute erledigt</span>
        </div>
      </div>
      <div class="hud-todo-liste" id="hud-todo-liste">${s.todos}</div>
    </section>`;

  // --- Messuhr: Monatsumsatz gegen den besten Monat der letzten zwoelf ---
  const uhrPanel = `
    <section class="j-panel hud-uhr hud-s3">
      ${titel("Umsatz " + esc(monatName), weg("/umsatz", "Aufschlüsselung"))}
      <div class="hud-uhr-buehne">
        ${hudMessuhr(w)}
        <div class="hud-uhr-mitte">
          ${hudZ("umsatz_monat", w.werte.umsatz_monat, "eur")}
          <span class="j-label">${hudN("abschluesse_monat", w.werte.abschluesse_monat)}
            ${w.werte.abschluesse_monat === 1 ? "Abschluss" : "Abschlüsse"}</span>
        </div>
      </div>
      <div class="hud-uhr-fuss">
        <span class="hud-mikro">Skala 0 – <b>${eur(w.skala)}</b> · ${w.zielUmsatz > 0 ? "Monatsziel" : "bester Monat der letzten zwölf"}</span>
        <span class="hud-mikro">${esc(vormonatName)} <b>${hudN("umsatz_vormonat", w.werte.umsatz_vormonat, "eur")}</b>${
          w.wachstum === null ? " · kein Vergleich möglich"
            : ` · <b class="${w.wachstum >= 0 ? "j-auf" : "j-ab"}">${w.wachstum >= 0 ? "+" : "−"}${Math.abs(w.wachstum)} %</b>`}</span>
      </div>
    </section>`;

  // --- Cold Calling ---
  const callPanel = callsDa ? `
    <section class="j-panel hud-calls hud-s3">
      ${titel(d.admin ? "Cold Calling" : "Deine Anrufe", weg("/crm/leads", "Liste"))}
      ${d.anrufe && w.anrufeGesamt ? `
      <div class="hud-balken-liste">
        ${HUD_CALLS.map((c) => {
          const x = w.nach[c.schluessel] || { gesamt: 0, heute: 0 };
          const anteil = w.callMax > 0 ? x.gesamt / w.callMax : 0;
          return `<div class="hud-balken-zeile">
            <div class="hud-balken-kopf"><span class="j-label">${c.titel}</span>
              <span class="hud-zahl">${hudZahl(x.gesamt)}${x.heute
                ? ` <span class="j-auf" style="font-size:11px">+${hudZahl(x.heute)} heute</span>` : ""}</span></div>
            <div class="hud-balken-spur"><div class="hud-balken-fuell ${c.ton}"
              data-schluessel="${c.schluessel}" data-anteil="${anteil.toFixed(4)}"
              style="width:${(anteil * 100).toFixed(2)}%"></div></div>
          </div>`;
        }).join("")}
      </div>
      <div class="hud-balken-fuss hud-mikro">
        <b>${hudN("anrufe_gesamt", w.anrufeGesamt)}</b> Anrufe an <b>${hudZahl(d.anrufe.tage)}</b> Tagen${
          d.anrufe.tage ? ` · Ø <b>${(w.anrufeGesamt / d.anrufe.tage).toFixed(1).replace(".", ",")}</b> pro Tag` : ""} ·
        heute <b>${hudN("anrufe_heute", w.anrufeHeute)}</b>
      </div>` : `<div class="hud-leer">${HUD_IKON.telefon}<div><b>Keine Anrufe erfasst</b>
        Sobald in der Lead-Liste ein Ergebnis gesetzt wird, steht es hier.</div></div>`}
    </section>` : "";

  // --- Histogramm: zwoelf Monate Umsatz ---
  const histPanel = `
    <section class="j-panel hud-hist hud-s${sHist}">
      ${titel("Umsatz zwölf Monate", weg("/umsatz", "Nach Monat"))}
      <div class="hud-hist-feld">
        <div class="hud-hist-achse">
          <span>${eurK(w.histMax)}</span><span>${eurK(w.histMax * 0.75)}</span>
          <span>${eurK(w.histMax * 0.5)}</span><span>${eurK(w.histMax * 0.25)}</span><span>0</span>
        </div>
        <div class="hud-hist-saeulen" id="hud-hist-saeulen">${s.hist}</div>
      </div>
      <div class="hud-hist-fuss">
        <span class="hud-mikro">Insgesamt<br>${hudZ("umsatz_gesamt", w.werte.umsatz_gesamt, "eur")}</span>
        <span class="hud-mikro">Abschlüsse<br>${hudZ("abschluesse_gesamt", w.werte.abschluesse_gesamt, "zahl")}</span>
        <span class="hud-mikro">Gewonnen ${esc(monatName)}<br>${hudZ("gewonnen_monat", w.werte.gewonnen_monat, "zahl")}</span>
        <span class="hud-mikro">Verloren ${esc(monatName)}<br>${hudZ("verloren_monat", w.werte.verloren_monat, "zahl")}</span>
      </div>
    </section>`;

  // --- Termine und Briefing. Beide holen sich ihren Inhalt selbst: der
  //     Kalender haengt an Google, das Briefing an einer Datei im Vault —
  //     keins von beidem soll den ersten Aufbau der Seite aufhalten. ---
  const logPanel = `
    <div class="hud-log hud-s${zahlen ? sLog : 6}">
      <section class="j-panel hud-log-termine">
        ${titel('Termine · <span id="hud-termine-tag">Heute</span>', `<span class="hud-nav">
          <button type="button" onclick="hudTagWechseln(-1)" title="Ein Tag zurück" aria-label="Ein Tag zurück">${ZT.links}</button>
          <button type="button" onclick="hudTagWechseln(1)" title="Ein Tag vor" aria-label="Ein Tag vor">${ZT.rechts}</button>
        </span>${darf("kalender") ? weg("/kalender", "Kalender") : ""}`)}
        <div class="hud-zeilen" id="hud-termine"><div class="hud-leer">${ICON.kalender}<b>Lädt</b></div></div>
      </section>
      <section class="j-panel hud-log-briefing">
        ${titel('Tages-Briefing <span id="hud-briefing-stand"></span>', darf("chat") ? weg("/chat", AGENT) : "")}
        <div id="hud-briefing"><div class="hud-leer">${ICON.funke}<b>Lädt</b></div></div>
      </section>
    </div>`;

  // --- Die grossen Zahlen: die Fragen, die man auf eine Startseite mitbringt
  //     — wie viele Kunden, wie viel ist durchgelaufen, was ist in Arbeit.
  //
  //     Welche sechs das sind, steht NICHT fest. Bis zum 19.08. standen
  //     Pipeline und Forecast fest in der Reihe; bei uns sind in den offenen
  //     Deals derzeit keine Summen hinterlegt, und dann standen dort zwei
  //     riesige "0 €" nebeneinander. Die Zahlen stimmten — aber zwei leere
  //     Felder in Kameragroesse lesen sich als Ausfall, nicht als Befund.
  //
  //     Erfunden wird deshalb nichts. Ein Wert, der nichts zu sagen hat, tritt
  //     zurueck: er wandert klein in die Pipeline-Ablesung unten rechts (dort
  //     steht auch, WARUM er null ist), und in die Reihe rueckt ein Wert nach,
  //     der wirklich Inhalt hat. Sind Pipeline und Forecast gefuellt — auf dem
  //     Server sind sie das —, stehen sie wie bisher gross in der Reihe. ---
  const kachel = (label, inhalt, unter, ziel) => {
    const inneres = `<span class="j-label">${label}</span>${inhalt}
      <span class="hud-mikro hud-kachel-fuss">${unter}</span>`;
    return ziel ? `<a class="j-panel hud-kachel" href="${ziel}">${inneres}</a>`
                : `<div class="j-panel hud-kachel">${inneres}</div>`;
  };
  const crmZiel = (pfad) => (darf("crm") ? pfad : null);
  const v = w.werte;
  const pipeStumm = v.pipeline_wert <= 0;   // offene Deals ohne hinterlegte Summe

  const kachelKopf = [
    kachel("Kunden gesamt", hudZ("kunden", v.kunden, "zahl"),
      `${hudZahl(v.gewonnen_monat)} diesen Monat gewonnen`, crmZiel("/crm/kunden")),
    kachel("Leads", hudZ("leads", v.leads, "zahl"),
      v.wiedervorlagen ? `${hudZahl(v.wiedervorlagen)} Wiedervorlagen fällig` : "keine Wiedervorlagen fällig",
      crmZiel("/crm/leads")),
    kachel("Offene Deals", hudZ("offene_deals", v.offene_deals, "zahl"),
      !v.offene_deals ? "nichts offen"
        : pipeStumm ? "noch ohne hinterlegte Summe"
          : `Ø ${eur(v.pipeline_wert / v.offene_deals)} je Deal`,
      crmZiel("/crm")),
  ];
  const kachelMitte = [
    v.pipeline_wert > 0 ? kachel("Pipeline offen", hudZ("pipeline_wert", v.pipeline_wert, "eur"),
      "Summe aller offenen Deals", crmZiel("/crm")) : "",
    v.forecast > 0 ? kachel("Forecast", hudZ("forecast", v.forecast, "eur"),
      v.erwartet30 ? `${eur(v.erwartet30)} in den nächsten 30 Tagen` : "gewichtet nach Phase",
      crmZiel("/crm")) : "",
    v.gebucht_gesamt ? kachel("Erstgespräche", hudZ("gebucht_gesamt", v.gebucht_gesamt, "zahl"),
      `aus ${hudZahl(v.anrufe_gesamt)} Anrufen`, crmZiel("/crm/leads")) : "",
    v.anrufe_gesamt && !v.gebucht_gesamt ? kachel("Anrufe gesamt", hudZ("anrufe_gesamt", v.anrufe_gesamt, "zahl"),
      `${hudZahl(v.anrufe_heute)} heute`, crmZiel("/crm/leads")) : "",
    v.todos_offen ? kachel("Aufgaben offen", hudZ("todos_offen", v.todos_offen, "zahl"),
      v.todos_ueberfaellig ? `${hudZahl(v.todos_ueberfaellig)} davon überfällig` : "nichts überfällig",
      darf("todos") ? "/todos" : null) : "",
    v.gewonnen_monat ? kachel("Gewonnen " + esc(monatName), hudZ("gewonnen_monat", v.gewonnen_monat, "zahl"),
      v.verloren_monat ? `${hudZahl(v.verloren_monat)} verloren` : "nichts verloren", crmZiel("/crm")) : "",
  ].filter(Boolean);
  const kachelFuss = kachel("Umsatz insgesamt", hudZ("umsatz_gesamt", v.umsatz_gesamt, "eur"),
    `${hudZahl(v.abschluesse_gesamt)} Abschlüsse`, "/umsatz");

  const kachelListe = kachelKopf
    .concat(kachelMitte.slice(0, Math.max(0, 6 - kachelKopf.length - 1)))
    .concat([kachelFuss]);
  const kacheln = `
    <section class="hud-kacheln hud-s12" style="--kachel-n:${kachelListe.length}">
      ${kachelListe.join("")}
    </section>`;

  // --- Team: Cold Calling und Umsatz je Person. Nur fuer die
  //     Geschaeftsfuehrung, dieselbe Regel wie /crm/team. ---
  const teamPanel = teamDa ? `
    <section class="j-panel hud-team hud-s${sTeam}">
      ${titel("Team · " + esc(monatName), weg("/crm/team", "Team-Leistung"))}
      <div class="hud-tabelle-huelle">
        <table class="hud-tabelle">
          <thead><tr><th>Person</th><th>Anrufe heute</th><th>Erstgespräche</th>
            <th>Absagen</th><th>Kunden</th><th>Umsatz Monat</th></tr></thead>
          <tbody id="hud-team-koerper">${s.team}</tbody>
        </table>
      </div>
    </section>` : "";

  // --- Buchhaltung. Wird oben nur fuer die Geschaeftsfuehrung geholt. ---
  const finanzPanel = finDa ? `
    <section class="j-panel hud-finanz hud-s${sFin}">
      ${titel("Buchhaltung " + esc(monatName), weg("/buchhaltung", "Öffnen"))}
      <div class="hud-paare">
        <div class="hud-paar"><span class="j-label">Einnahmen</span>${hudZ("fin_einnahmen", d.finanzen.einnahmen_monat, "eur")}</div>
        <div class="hud-paar"><span class="j-label">Ausgaben</span>${hudZ("fin_ausgaben", d.finanzen.ausgaben_monat, "eur")}</div>
        <div class="hud-paar"><span class="j-label">Ergebnis</span>
          <b class="${d.finanzen.ergebnis_monat < 0 ? "j-ab" : "j-auf"}">${eur(d.finanzen.ergebnis_monat)}</b></div>
        <div class="hud-paar"><span class="j-label">Offene Rechnungen</span>
          <b>${hudZahl(d.finanzen.offen_anzahl)} · ${eur(d.finanzen.offen_summe)}</b></div>
      </div>
      <div class="hud-mikro" style="margin-top:9px">Einnahmen zählen erst, wenn sie bezahlt sind.</div>
    </section>` : "";

  // data-post=1 erlaubt hud-zentrale.js, Mail-Triage und offene Entscheidungen
  // nachzutragen — die haengen an Dateien, nicht an der Datenbank, und sollen
  // den ersten Aufbau nicht aufhalten.
  const alarmPanel = `<section class="hud-alarm" id="hud-alarm"
    data-post="${knopfAdmin ? "1" : "0"}">${s.alarme}</section>`;

  // --- Pipeline und Prognose als Ablesung statt als zwei riesige Nullen.
  //     Die Zahlen sind dieselben; nur stehen sie hier neben der Stueckzahl,
  //     die sie erklaert, und mit dem Satz darunter, warum nichts drinsteht.
  //     Kommt Wert in die Deals, wandern beide von selbst wieder gross nach
  //     oben in die Kachelreihe (siehe kachelMitte). ---
  const pipePanel = `
    <section class="j-panel hud-pipe">
      ${titel("Pipeline · Prognose", crmZiel("/crm") ? weg("/crm", "Deals") : "")}
      <div class="hud-paare">
        <div class="hud-paar"><span class="j-label">Offene Deals</span>
          ${hudZ("offene_deals", v.offene_deals, "zahl")}</div>
        <div class="hud-paar"><span class="j-label">Pipeline offen</span>
          ${hudZ("pipeline_wert", v.pipeline_wert, "eur")}</div>
        <div class="hud-paar"><span class="j-label">Forecast</span>
          ${hudZ("forecast", v.forecast, "eur")}</div>
        <div class="hud-paar"><span class="j-label">Nächste 30 Tage</span>
          ${hudZ("erwartet30", v.erwartet30, "eur")}</div>
      </div>
      <div class="hud-mikro hud-pipe-fuss">${pipeStumm
        ? `In den <b>${hudZahl(v.offene_deals)}</b> offenen Deals steht noch keine Summe —
           darum ist die Pipeline null und nicht geschätzt.`
        : "Forecast ist die Pipeline, gewichtet nach Phase."}</div>
    </section>`;

  // Rechte Fussspalte: Ablesung oben, Meldezeilen darunter. Ohne Zahlen (kein
  // Konto) gibt es nichts abzulesen — dann bleibt nur die Meldespalte.
  const rechtsSpalte = `<div class="hud-rechts hud-s${zahlen ? sRechts : 6}">
    ${zahlen ? pipePanel : ""}${alarmPanel}</div>`;

  // --- Die Wege in die anderen Bereiche. Eigene Leiste, weil die Zentrale der
  //     Einstiegspunkt bleibt: von hier kommt man ueberall hin, auch wenn die
  //     Rail eingeklappt ist. Jeder Punkt wird vorher geprueft. ---
  const modul = (ziel, ikon, wort) => `<a class="hud-modul" href="${ziel}">${ikon}${wort}</a>`;
  const wege = [
    knopfAdmin ? `<form method="post" action="/briefing/neu"><button class="hud-modul tat" type="submit">${ICON.sonne}Briefing erstellen</button></form>` : "",
    knopfAdmin ? `<form method="post" action="/skill/mail-triage"><button class="hud-modul tat" type="submit">${ZT.post}Mail-Triage starten</button></form>` : "",
    darf("chat") ? modul("/chat", ICON.funke, AGENT) : "",
    darf("sprache") ? modul("/sprache", ICON.megafon, "Sprache") : "",
    darf("leads") ? modul("/leads", ICON.leads, "Lead-Maschine") : "",
    darf("crm") ? modul("/crm", ICON.kunden, "Kunden &amp; CRM") : "",
    darf("todos") ? modul("/todos", ICON.todo, "To-Dos") : "",
    darf("kalender") ? modul("/kalender", ICON.kalender, "Kalender") : "",
    knopfAdmin && datenbank ? modul("/buchhaltung", ICON.euro, "Buchhaltung") : "",
    darf("angebote") ? modul("/angebote", ICON.beleg, "Angebote") : "",
    datenbank && darf("content") ? modul("/content", ICON.projekte, "Content") : "",
    datenbank && darf("marketing") ? modul("/marketing", ICON.marketing, "Marketing") : "",
    darf("wissen") ? modul("/wissen", ICON.wissen, "Wissen") : "",
    darf("agenten") ? modul("/agenten", ICON.agenten, "Agenten") : "",
    darf("einstellungen") ? modul("/einstellungen", ICON.zahnrad, "Einstellungen") : "",
  ].filter(Boolean);
  // Darf jemand ueberhaupt keinen anderen Bereich, bleibt die Leiste weg statt
  // als leerer Strich stehenzubleiben.
  const module = wege.length
    ? `<nav class="hud-module hud-s12" aria-label="Bereiche">${wege.join("")}</nav>` : "";

  // Die Huelle .hud-ticker-saum traegt die Maske, die den Lauftext an beiden
  // Enden ausblendet — auf dem Lauf selbst liefe sie mit ihm mit.
  const ticker = `<footer class="hud-ticker hud-s12" aria-hidden="true">
    <div class="hud-ticker-saum"><div class="hud-ticker-lauf" id="hud-ticker-lauf">${s.ticker}</div></div></footer>`;

  const hinweise = `
    ${req.query.gestartet ? `<div class="hud-hinweis">${ZT.info}<div>
      <strong>${esc(req.query.gestartet)}</strong> läuft — Alexandra arbeitet im Hintergrund.
      Das Ergebnis erscheint hier, lad die Seite in ein paar Minuten neu.</div></div>` : ""}
    ${datenbank && !nutzer ? `<div class="hud-hinweis">${ZT.info}<div>
      <strong>Melde dich persönlich an</strong>, dann stehen hier Umsatz, Aufgaben, Pipeline und Team —
      an deinem Konto hängen die Zeilenrechte in der Datenbank.
      <a href="/crm/anmelden">Jetzt anmelden →</a></div></div>` : ""}
    ${d.fehler ? `<div class="hud-hinweis warn">${ZT.warnung}<div>${esc(d.fehler)}</div></div>` : ""}`;

  // Ohne Zahlen (kein Konto, keine Datenbank, Datenbank stumm) bleibt das Pult
  // nicht halb leer stehen: dann laufen nur die Teile, die es trotzdem gibt.
  // Eine Seite mit sechs Loechern sieht kaputt aus, obwohl sie nur weniger weiss.
  const pult = zahlen
    ? kopf + hinweise + kugel + todoPanel + uhrPanel + callPanel + histPanel + logPanel +
      kacheln + teamPanel + finanzPanel + rechtsSpalte + module + ticker
    : kopf + hinweise + logPanel + rechtsSpalte + module + ticker;

  const inhalt = `
    <div class="hud startet" id="hud">${pult}</div>
    <noscript><style>.hud.startet > * { opacity: 1 !important; }</style></noscript>
    <script src="/lib/gsap.min.js${hudStempel("/lib/gsap.min.js")}" defer></script>
    <script src="/lib/hud-zentrale.js${hudStempel("/lib/hud-zentrale.js")}" defer></script>
    <script>
      // Notbremse: faellt hud-zentrale.js aus (Ladefehler, alter Browser), holt
      // diese Zeile das Pult nach gut einer Sekunde trotzdem ins Bild. Eine
      // Startanimation darf nie der Grund sein, dass jemand nichts sieht.
      setTimeout(function () {
        var h = document.getElementById("hud");
        if (h && !h.classList.contains("laeuft")) h.classList.remove("startet");
      }, 1200);
    </script>`;

  // body.jarvis holt die gemeinsame HUD-Sprache (public/jarvis.css),
  // body.hud-zentrale das Pult selbst (public/jarvis-hud.css). Beide werden
  // HIER gesetzt und nicht in lib/schale.js: die Schale gehoert allen Seiten,
  // und diese eine soll dort keine Sonderregel hinterlassen. Damit faellt
  // zugleich crm-dashboard-design weg — die Graphit-Palette der Arbeitsseiten
  // haette gegen das Pult gearbeitet.
  // ?buehne=1 — die Zentrale sitzt dann in einem Rahmen auf /buehne (der
  // Aufnahme-Seite). Dort bringt sie ihre eigene Schiene und Kopfleiste ein
  // ZWEITES Mal mit, weil die Buehne beides schon hat; im Bild stand alles
  // doppelt. Die Klasse blendet ihre Navigation aus, sonst bleibt alles.
  const imRahmen = String(req.query.buehne || "") === "1";
  const seite = layout("Zentrale", "zentrale-start", inhalt, req)
    .replace(/<body[^>]*>/, () =>
      `<body class="jarvis hud-zentrale${imRahmen ? " hud-im-rahmen" : ""}">\n${HUD_VERTRAG}`);
  res.send(seite);
});

// --- Umsatz aufgeschluesselt: was hinter der Zahl auf der Zentrale steckt ---
//
// Eine Summe allein laesst sich nicht pruefen. Hier steht jeder Monat mit den
// Kunden, die ihn ausmachen — neuester Monat oben —, und jede Zeile fuehrt in
// die Kundenakte. Damit sieht man beim Hinsehen, ob ein Kunde fehlt oder einer
// zu viel drin ist.
app.get("/umsatz", async (req, res) => {
  const nutzer = (req.session && req.session.crm) || null;
  // datenbank ist in der Zentrale-Route lokal — hier neu bilden statt darauf
  // zu hoffen, dass es global existiert.
  if (!process.env.DATABASE_URL || !nutzer) {
    return res.send(layout("Umsatz", "zentrale", `
      <div class="seiten-kopf"><div><h1>Umsatz</h1>
        <p>Alle Abschlüsse, nach Monat</p></div></div>
      <div class="karte leer"><h3>Anmeldung nötig</h3>
        <p>Melde dich persönlich am CRM an, dann steht der Umsatz hier.</p>
        <a class="knopf dunkel" href="/crm">Zum CRM</a></div>`, req));
  }
  try {
    const crm = require("./lib/crm.js");
    const d = await crm.umsatzNachMonat(nutzer);
    const SPARTE_NAME = { webdesign: "Webdesign", performance: "Performance Marketing", ki: "KI" };
    const heuteSchluessel = (() => { const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; })();

    const monatsBlock = d.monate.map((m) => {
      const offen = m.summe - m.eingegangen;
      return `<div class="karte um-monat${m.schluessel === heuteSchluessel ? " jetzt" : ""}">
        <div class="um-kopf">
          <div class="um-kopf-titel">
            <h2>Umsatz ${esc(m.titel)}</h2>
            <span class="caption">${m.deals.length} ${m.deals.length === 1 ? "Abschluss" : "Abschlüsse"}
              · ${eur(m.eingegangen)} eingegangen${offen > 0.01 ? ` · ${eur(offen)} offen` : ""}</span>
          </div>
          <div class="um-kopf-zahl">${eur(m.summe)}</div>
        </div>
        <div class="um-liste">
          ${m.deals.map((x) => {
            const rest = x.wert - x.eingegangen;
            const stand = rest <= 0.01
              ? { text: "bezahlt", klasse: "b-gruen" }
              : x.eingegangen > 0.01
                ? { text: eur(rest) + " offen", klasse: "b-bernstein" }
                : { text: "nichts eingegangen", klasse: "b-rot" };
            return `<a class="um-zeile" href="/crm/firma/${x.firma_id}">
              <span class="um-tag">${x.geschlossen_am
                ? new Date(x.geschlossen_am).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })
                : "—"}</span>
              <span class="um-name">${esc(x.firma)}
                <i>${esc(SPARTE_NAME[x.sparte] || x.sparte || "—")}${x.ort ? " · " + esc(x.ort) : ""}${
                  x.status === "verloren" ? " · verloren" : ""}</i></span>
              <span class="badge ${stand.klasse} um-stand">${esc(stand.text)}</span>
              <span class="um-wert">${eur(x.wert)}</span>
            </a>`;
          }).join("")}
        </div>
      </div>`;
    }).join("");

    res.send(layout("Umsatz", "zentrale", `
      <div class="seiten-kopf">
        <div><h1>Umsatz</h1>
          <p>Alle gewonnenen Abschlüsse — neuester Monat zuerst</p></div>
        <a class="knopf sekundaer" href="/">← Zentrale</a>
      </div>
      <div class="um-summe">
        <div><span class="caption">Umsatz insgesamt</span><b>${eur(d.gesamt)}</b>
          <span class="caption">${d.anzahl} Abschlüsse</span></div>
        <div><span class="caption">Davon eingegangen</span><b>${eur(d.eingegangen)}</b>
          <span class="caption">in der Buchhaltung gebucht</span></div>
        <div><span class="caption">Noch offen</span><b>${eur(d.gesamt - d.eingegangen)}</b>
          <span class="caption">abgeschlossen, aber nicht bezahlt</span></div>
      </div>
      ${d.monate.length ? monatsBlock : `<div class="karte leer"><h3>Noch kein Umsatz</h3>
        <p>Sobald ein Kunde mit Preis in der Kundenakte steht, erscheint er hier.</p></div>`}`, req));
  } catch (err) {
    console.error("Umsatzseite:", err.message);
    res.send(layout("Umsatz", "zentrale", `
      <div class="seiten-kopf"><div><h1>Umsatz</h1></div></div>
      <div class="karte leer"><h3>Nicht abrufbar</h3>
        <p>Die CRM-Datenbank antwortet gerade nicht.</p></div>`, req));
  }
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

// /api/calendar stand hier — eine zweite, eigene Kalender-Abfrage nur fuer die
// Karte auf der Zentrale, mit eigenem Umgang mit ganztaegigen Terminen und
// eigener Auspack-Logik fuer die Sicherheitshuelle von gws-cli. Seit es
// lib/kalender.js gibt (der Kalender unter /kalender), sind das zwei Anzeigen
// desselben Google-Kalenders, die auseinanderlaufen koennen — und genau das
// sollte nicht sein. Die Karte holt ihren Tag jetzt bei /api/kalender/tag,
// derselben Leseroutine, aus der auch die Kalenderseite gebaut wird.

// Wissens-Vault und System haengen seit dem 27.07. nicht mehr auf der Zentrale
// (Betriebsdaten, keine Tagesuebersicht). Die Endpunkte bleiben — sie sind das
// einzige, was von aussen sagen kann, ob Vault und Alexandra erreichbar sind.
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

  res.send(layout(AGENT + " — direkte Leitung zum Agenten", "chat", `
    ${configured ? "" : `<div class="card placeholder"><h2>🔌 Verbindung wird eingerichtet</h2>
      <p>Die Chat-Tür zu ${AGENT} (Hermes-Webhook) ist noch nicht konfiguriert. Bis dahin erreichst du sie über Telegram.</p></div>`}
    <div class="chat-kopf">
      <span class="caption">${bisher.length ? bisher.length + " Nachrichten im Verlauf · dauerhaft gespeichert"
        : "Noch kein Verlauf — der erste Austausch wird gespeichert."}</span>
      ${bisher.length ? `<form method="post" action="/chat/leeren" class="inline"
        onsubmit="return confirm('Den ganzen Chatverlauf mit ${AGENT} löschen? Das lässt sich nicht rückgängig machen.')">
        <button class="danger tiny" type="submit">Verlauf löschen</button></form>` : ""}
    </div>
    <div class="chat-wrap${configured ? "" : " disabled"}">
      <div id="chat-log" class="chat-log">${verlaufHtml
        || `<div class="msg agent">Hallo${req.session.crm ? " " + esc(req.session.crm.name.split(" ")[0]) : ""}! Schreib mir hier wie in Telegram — ich habe denselben Kopf, dasselbe Gedächtnis und dieselben Regeln. ✦</div>`}</div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" placeholder="Nachricht an ${AGENT}…" autocomplete="off" ${configured ? "" : "disabled"}>
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

// /api/chat STEHT JETZT IN lib/sprache-routes.js (08.08.2026).
//
// Hier ging der Chat frueher direkt an Hermes. Zuletzt kam davon nur noch:
//   HTTP 400: The 'gpt-5.6-sol' model is not supported when using Codex
//             with a ChatGPT account.
//
// Selbst funktionierend haette dieser Weg nichts von dem gekonnt, was an der
// Sprache haengt — Werkzeuge, STAND, Charakter, Gedaechtnis. Zwei Wege zur
// selben Assistentin, von denen einer alles kann und einer nichts. Der
// getippte Chat nimmt jetzt denselben Weg wie das Gespraech; nur wartet er
// auf die Ergebnisse, statt sie einzeln vorzulesen.

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
    ${runBlocks || '<div class="card"><p class="muted">Noch keine Läufe. Starte oben den ersten — oder warte, bis ${AGENT} den lead-gen-Skill fertig hat.</p></div>'}
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
      <div><p class="muted">Was ${AGENT} kann und gerade tut — Zuschauen stört sie nicht.</p></div>
      <div class="qa"><button onclick="location.reload()">🔄 Aktualisieren</button></div>
    </div>
    <div class="tiles">
      <div class="tile" data-tile2="skills"><span class="tile-num">–</span><span class="tile-label">Skills gesamt</span></div>
      <div class="tile" data-tile2="eigene"><span class="tile-num">–</span><span class="tile-label">Eigene Skills</span></div>
      <div class="tile" data-tile2="status"><span class="tile-num">–</span><span class="tile-label">Status</span></div>
      <div class="tile" data-tile2="cron"><span class="tile-num">–</span><span class="tile-label">Routinen</span></div>
    </div>
    <div class="grid">
      <div class="card"><h2>⚙️ ${AGENT}s Zustand</h2><div class="card-body" data-load="/api/agent/status">Lade…</div></div>
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
      } catch (e) { el.innerHTML = "<p class='caption'>Nicht erreichbar.</p>"; }
    });
    // Termintitel kommen aus einem fremden Kalender — da steht irgendwann alles
    // drin. Nichts davon geht ungefiltert in innerHTML.
    function hesc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

    // Das Zeichen fuer den freien Tag kommt ueber JSON.stringify herein, nicht
    // roh: ein SVG enthaelt doppelte Anfuehrungszeichen (viewBox="0 0 24 24"),
    // und direkt in einen JS-String interpoliert schliesst das erste davon den
    // String — der Rest der Seite waere dann ein Syntaxfehler.
    const IKON_FREI = ${JSON.stringify(ZT.frei)};

    // Kalender mit Tages-Navigation.
    //
    // Quelle ist /api/kalender/tag aus lib/kalender-routes.js — dieselbe
    // Leseroutine wie die Kalenderseite unter /kalender. Diese Karte ist die
    // Kurzfassung dieses Kalenders, kein zweiter mit eigener Abfrage.
    let calOffset = 0;
    const TAGE = ["So","Mo","Di","Mi","Do","Fr","Sa"];
    async function loadCal() {
      const body = document.getElementById("cal-body"); if (!body) return;
      const label = document.getElementById("cal-label");
      const d = new Date(Date.now() + calOffset * 86400000);
      label.textContent = calOffset === 0 ? "Heute" : calOffset === 1 ? "Morgen" : calOffset === 2 ? "Übermorgen" : calOffset === -1 ? "Gestern" : TAGE[d.getDay()] + ", " + d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
      body.innerHTML = "<p class='caption'>Lädt …</p>";
      try {
        const r = await fetch("/api/kalender/tag?versatz=" + calOffset); const dd = await r.json();
        if (!dd.ok) { body.innerHTML = "<p class='caption'>" + hesc(dd.hint || "Nicht verfügbar.") + "</p>"; return; }
        if (!dd.termine.length) {
          const tag = d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
          body.innerHTML = "<div class='zt-frei'>" + IKON_FREI + "<div><strong>" + tag + "</strong>" +
            "<p class='caption'>Keine Termine — freier Tag.</p></div></div>";
          return;
        }
        body.innerHTML = dd.termine.map(function (t) {
          return "<div class='zt-termin'>" +
            "<span class='zt-termin-zeit" + (t.uhrzeit ? "" : " ganz") + "'>" + (t.uhrzeit || "ganztägig") + "</span>" +
            "<span>" + hesc(t.titel) +
              (t.ort ? "<span class='zt-termin-ort'>" + hesc(t.ort) + "</span>" : "") + "</span></div>";
        }).join("");
      } catch { body.innerHTML = "<p class='caption'>Nicht erreichbar.</p>"; }
    }
    function calShift(n) { calOffset += n; loadCal(); }
    loadCal();
    // Die Kachelreihe ueber den Karten gab es hier — sie holte dieselben fuenf
    // Zahlen ein zweites Mal, nur um sie ohne Zusammenhang gross anzuzeigen.
    // Seit dem 27.07. traegt jede Karte ihre Zahl selbst.
    //
    // Die Karten der Zentrale sprechen das Vokabular des Designsystems aus
    // crm.css: .zt-zeile fuer "Beschriftung links, Zahl rechts", .caption fuer
    // den Fuss, .badge fuer Zustaende. Die agent/*-Zweige weiter unten gehoeren
    // zur Agenten-Seite, die noch im alten .card/.row-Stil steht — die bleiben
    // darum unveraendert, sonst haette die Seite halb neue, halb alte Zeilen.
    // klasse: "gross" hebt die Zahl hervor (die eine Zahl, um die es in der
    // Karte geht), "warnt" faerbt die ganze Zeile rot.
    function zeile(label, wert, klasse) {
      var gross = klasse === "gross";
      return "<div class='zt-zeile" + (klasse && !gross ? " " + klasse : "") + "'><span>" + label +
             "</span><span class='zt-wert" + (gross ? " gross" : "") + "'>" + wert + "</span></div>";
    }
    function liste() {
      var teile = [].slice.call(arguments).filter(Boolean);
      return "<div class='zt-liste'>" + teile.join("") + "</div>";
    }
    function renderCard(src, d) {
      // Ziel ist /crm/anmelden, nicht /login: gemeint ist das PERSOENLICHE
      // Konto (daran haengen die Zeilenrechte in der Datenbank), nicht das
      // gemeinsame Passwort — mit dem ist man an dieser Stelle ja schon da.
      if (!d.ok && d.anmeldung) return "<p class='caption'>" + d.hint + "</p>" +
        "<p style='margin-top:11px'><a class='knopf sekundaer klein' href='/crm/anmelden'>Persönlich anmelden</a></p>";
      if (!d.ok) return "<p class='caption'>" + (d.hint || "Noch nicht verbunden.") + "</p>" + (d.detail ? "<pre class='small'>" + String(d.detail).replace(/[<>&]/g, "") + "</pre>" : "");
      var eur = function (n) { return (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " €"; };
      var zahl = function (n) { return (Number(n) || 0).toLocaleString("de-DE"); };
      if (src.includes("buchhaltung")) {
        return liste(
          zeile("Einnahmen diesen Monat", eur(d.einnahmen_monat), "gross"),
          zeile("Ausgaben diesen Monat", eur(d.ausgaben_monat)),
          zeile("Ergebnis", (d.ergebnis_monat < 0 ? "−" : "") + eur(Math.abs(d.ergebnis_monat)),
                d.ergebnis_monat < 0 ? "warnt" : ""),
          d.offen_anzahl ? zeile("Offene Rechnungen", d.offen_anzahl + " · " + eur(d.offen_summe)) : "",
          d.ueberfaellig ? zeile("Überfällig", d.ueberfaellig, "warnt") : "",
          d.belege_offen ? zeile("Belege ohne Buchung", d.belege_offen) : ""
        ) + "<p class='caption zt-fuss'>Einnahmen zählen erst, wenn sie bezahlt sind.</p>";
      }
      if (src.includes("content")) {
        return liste(
          zeile("Diese Woche veröffentlicht",
                d.woche + (d.ziel_woche ? " <span class='zt-ziel'>von " + d.ziel_woche + "</span>" : ""), "gross"),
          zeile("Diesen Monat", d.monat),
          zeile("In Produktion", d.produktion),
          zeile("Geplant", d.geplant),
          d.faellig ? zeile("Muss jetzt raus", d.faellig, "warnt") : ""
        ) + (d.ziel_woche ? "" : "<p class='caption zt-fuss'>Noch keine Wochenziele festgelegt.</p>");
      }
      if (src.includes("marketing")) {
        return liste(
          zeile("Laufende Kampagnen", d.laufend, "gross"),
          d.geplant ? zeile("Geplant", d.geplant) : "",
          zeile("Ausgaben diesen Monat", eur(d.ausgaben_monat)),
          zeile("Leads daraus", d.leads_monat),
          zeile("Kosten je Lead", d.kosten_lead === null
            ? "<span class='zt-ziel'>noch keine Leads</span>" : eur(d.kosten_lead))
        ) + (d.klicks_monat ? "<p class='caption zt-fuss'>" + zahl(d.klicks_monat) + " Klicks diesen Monat</p>" : "");
      }
      if (src.includes("crm")) {
        // Offene Deals, Pipeline-Wert, Umsatz und Kunden·Leads standen hier bis
        // zum 28.07. — alle vier stehen inzwischen weiter oben im Umsatz-Kasten
        // und unter "Blick nach vorn". Dieselbe Zahl zweimal auf einer Seite
        // ist genau das, was die fuenf Kacheln erledigt hat.
        //
        // Uebrig bleibt, was es sonst nirgends gibt: wie der Monat ausgeht
        // (gewonnen gegen verloren) und wer auf einen Rueckruf wartet.
        return liste(
          zeile("Gewonnen diesen Monat", d.gewonnen_monat, "gross"),
          zeile("Verloren diesen Monat", d.verloren_monat +
            (d.verloren_wert_monat ? " <span class='zt-ziel'>· " + eur(d.verloren_wert_monat) + "</span>" : "")),
          d.wiedervorlagen ? zeile("Fällige Wiedervorlagen", d.wiedervorlagen, "warnt")
            : zeile("Fällige Wiedervorlagen", "keine"),
          d.offene_aufgaben ? zeile("Offene Aufgaben", d.offene_aufgaben) : ""
        ) + "<p class='caption zt-fuss'>Angemeldet als " + d.name + "</p>";
      }
      if (src.includes("briefing")) {
        if (d.leer) return "<p class='caption'>Noch kein Briefing für heute. Oben auf <strong>Briefing erstellen</strong> — " +
          AGENT + " stellt Termine, Mails und Prioritäten zusammen (dauert 1–3 Minuten).</p>";
        return "<div class='md'>" + d.html + "</div>" +
          "<p class='caption zt-fuss'>Stand: " + d.stand +
          (d.alterMin > 240 ? " <span class='badge b-bernstein'>" + Math.round(d.alterMin / 60) + " Std alt</span>" : "") + "</p>";
      }
      if (src.includes("mail")) {
        if (d.leer) return "<p class='caption'>Noch keine Triage für heute. Oben auf <strong>Mail-Triage starten</strong>.</p>";
        var k = d.koerbe || {};
        var korb = function (titel, ton, liste2) {
          if (!liste2.length) return "";
          return "<div class='zt-zeile'><span><strong>" + titel + "</strong></span>" +
                 "<span class='badge " + ton + "'>" + liste2.length + "</span></div>" +
                 liste2.slice(0, 5).map(function (m) {
                   return "<div class='zt-zeile'><span>" + m.von + " — " + m.betreff + "</span></div>"; }).join("");
        };
        var out = korb("Wichtig &amp; dringend", "b-rot", k.dringend || []) +
                  korb("Wichtig", "b-bernstein", k.wichtig || []);
        if (!out) return "<p class='caption'>Postfach leer — nichts, was dich braucht.</p>";
        return "<div class='zt-liste'>" + out + "</div>" +
          "<p class='caption zt-fuss'>Kann warten: " + (k.warten ?? "–") + " · Werbung: " + (k.werbung ?? "–") +
          (d.stand ? " · Stand: " + d.stand : "") + "</p>";
      }
      if (src.includes("inbox")) {
        if (!d.punkte || !d.punkte.length) return "<p class='caption'>Nichts offen — alles entschieden.</p>";
        return "<div class='zt-liste'>" + d.punkte.map(function (p) {
          return "<div class='zt-zeile'><span>" + (p.titel || p.text || JSON.stringify(p)) + "</span>" +
                 (p.von ? "<span class='caption'>" + p.von + "</span>" : "") + "</div>"; }).join("") + "</div>" +
          (d.gesamt > d.punkte.length ? "<p class='caption zt-fuss'>" + (d.gesamt - d.punkte.length) + " weitere</p>" : "");
      }
      // Die Leads-Karte stand hier bis zum 27.07. Sie ist von der Zentrale
      // runter — die Lead-Maschine ist die Fundgrube VOR dem CRM, und auf der
      // Startseite hat sie zwischen Umsatz und Tagesgeschaeft nichts zu suchen.
      // Die Seite /leads und /api/leads/stats gibt es unveraendert weiter.
      if (src.includes("todos")) {
        var kopf = liste(
          zeile("Heute", d.heute, "gross"),
          d.ueberfaellig ? zeile("Überfällig", d.ueberfaellig, "warnt") : "",
          zeile("Offen insgesamt", d.offen),
          d.ohne_plan ? zeile("Ohne Tag", d.ohne_plan) : ""
        );
        if (!d.naechste.length) {
          return kopf + "<p class='caption zt-fuss'>" +
            (d.offen ? "Für heute ist nichts eingeplant." : "Nichts offen — alles erledigt.") + "</p>";
        }
        return kopf + "<div class='zt-liste zt-fuss'>" + d.naechste.map(function (t) {
          return "<div class='zt-zeile" + (t.spaet ? " warnt" : "") + "'><span>" + t.titel +
            (t.firma ? " <span class='caption'>· " + t.firma + "</span>" : "") + "</span>" +
            (t.faellig ? "<span class='caption'>" + (t.spaet ? "seit " : "bis ") + t.faellig + "</span>" : "") +
            "</div>";
        }).join("") + "</div>" +
        (d.heute_erledigt ? "<p class='caption zt-fuss'>" + d.heute_erledigt + " heute schon erledigt</p>" : "");
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
      return "<pre>" + JSON.stringify(d, null, 2) + "</pre>";
    }
  </script></body></html>`;
}

// --- Nachzug fuer das Command Center (19.08.2026) ---
//
// Die Zentrale laedt sich nicht neu, sie zieht nach: alle 45 Sekunden holt
// hud-zentrale.js hier die Zahlen und die Listen, die sich geaendert haben
// koennen, und faehrt sie im Bild nach. Ein Seiten-Neuladen wuerde beim
// Abfilmen die Startanimation erneut ausloesen und die Kamera zuruecksetzen.
//
// Gebaut wird die Antwort mit DENSELBEN Funktionen wie die Seite selbst
// (hudDaten / hudWerte / hudStuecke). Deshalb kommen hier auch fertige
// HTML-Stuecke heraus und nicht nur Rohdaten: gaebe es eine zweite Fassung
// der Aufgabenliste im Browser, waere die naechste Aenderung an einer Zeile
// eine Aenderung an zwei Stellen — und die zweite wird vergessen.
//
// Die Rechte stecken in hudDaten(): ohne persoenliches Konto keine Zahlen,
// ohne Adminrolle keine Buchhaltung und keine Team-Aufschluesselung.
app.get("/api/hud/zentrale", async (req, res) => {
  try {
    const d = await hudDaten(req);
    const w = hudWerte(d);
    const s = hudStuecke(d, w);
    res.json({
      ok: true,
      angemeldet: Boolean(d.nutzer),
      stand: new Date().toLocaleTimeString("de-DE"),
      werte: w.werte,
      uhr_anteil: w.uhrAnteil,
      balken: HUD_CALLS.map((c) => ({
        schluessel: c.schluessel,
        anteil: w.callMax > 0 ? ((w.nach[c.schluessel] || {}).gesamt || 0) / w.callMax : 0,
      })),
      html: s,
    });
  } catch (e) {
    console.error("HUD-Nachzug:", e.message);
    res.json({ ok: false, hint: "Nachzug nicht möglich." });
  }
});

// Fehlerbehandlung. Steht ganz unten, nach allen Routen — nur dann sieht sie
// deren Fehler.
//
// Der Anlass (29.07.): Eine zu grosse Lead-Liste liess Express einen Fehler
// werfen, und der Standard-Behandler antwortete mit einer HTML-Seite. Das
// Seitenskript erwartete JSON und meldete "Unexpected token '<'" — technisch
// richtig und fuer den Menschen davor vollkommen wertlos. Wer per fetch fragt,
// bekommt jetzt eine Antwort in der Sprache, in der er gefragt hat.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const zuGross = err.type === "entity.too.large" || err.status === 413;
  const status = zuGross ? 413 : (err.status || 500);
  if (!zuGross) console.error("Serverfehler:", req.method, req.path, "—", err.message);
  const text = zuGross
    ? "Die Liste ist zu groß für eine Übertragung. Teil sie in zwei Hälften und füg sie nacheinander ein."
    : "Da ist auf dem Server etwas schiefgegangen.";
  if (req.path.startsWith("/api/") || (req.get("accept") || "").includes("json")
      || req.get("x-requested-with") || req.method === "POST") {
    return res.status(status).json({ ok: false, fehler: text });
  }
  res.status(status).send(layout("Fehler", "zentrale", `
    <div class="seiten-kopf"><div><h1>Fehler</h1></div></div>
    <div class="karte leer"><h3>${esc(text)}</h3>
      <a class="knopf dunkel" href="/">Zur Zentrale</a></div>`, req));
});

app.listen(PORT, () => {
  console.log(`flowstate-dashboard läuft auf Port ${PORT}`);
  // Nachsehen, ob Datenbank und Code zusammenpassen (26.07.). Am 26.07. lagen
  // 14 Migrationen im Code, in Supabase fehlten die meisten — im Betrieb sieht
  // das aus wie kaputter Code ("Spalte gibt es nicht"), und man sucht im
  // falschen Code. Hier wird nur GEWARNT: Struktur-Aenderungen an einer
  // Datenbank mit echten Kundendaten passieren nie nebenbei beim Hochfahren.
  require("./lib/migrationen.js").warnen().catch(() => {});
});
