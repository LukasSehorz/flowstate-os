// Flowstate OS Dashboard — V1 (Gerüst)
// Schichten: Dashboard (hier) -> Hermes (Agent) -> Vault/Daten (unten)
const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const { schale, ICON, S } = require("./lib/schale.js");
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

// ---------- Zentrale ----------
//
// Nur Karten, keine Kachelreihe mehr (27.07.). Die fuenf Kacheln oben ("Termine
// heute", "Wichtige Mails", "Brauchen dich", "Leads gesamt", "Offene Deals")
// zeigten ausnahmslos Zahlen, die zwei Zentimeter tiefer nochmal in der
// zugehoerigen Karte standen — jede Zahl wurde doppelt geholt und doppelt
// angezeigt. Die Karte gewinnt, weil sie die Zahl UND die Zeilen dahinter hat.
//
// Ebenfalls raus: "Wissens-Vault" (Dateizaehler) und "System" (Laufzeit, Mounts).
// Das sind Betriebsdaten, keine Tagesuebersicht. Die Endpunkte dazu gibt es
// weiter, sie haengen nur nicht mehr auf der Startseite.
//
// Dafuer sind die drei Bereiche dazugekommen, die es beim letzten Stand der
// Zentrale noch nicht gab: Buchhaltung, Content und Marketing. Jeder liefert
// seine Zahlen ueber eine eigene Route in seinem eigenen Modul.
app.get("/", async (req, res) => {
  const heute = new Date().toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  // Buchhaltung sieht nur die Geschaeftsfuehrung (dieselbe Regel wie unter
  // /buchhaltung, siehe lib/buchhaltung-routes.js). Fuer ein Teammitglied wird
  // die Karte gar nicht erst gebaut — eine Karte, die nur "darfst du nicht
  // sehen" sagt, ist keine Information.
  //
  // Wer nur mit dem gemeinsamen Passwort da ist (kein req.session.crm), bekommt
  // sie trotzdem: die Karte fragt dann nach der persoenlichen Anmeldung, genau
  // wie die CRM-Karte darueber. Sonst waere die Buchhaltung fuer Jannik und
  // Lukas je nach Anmeldeweg mal da und mal weg.
  const nutzer = (req.session && req.session.crm) || null;
  const admin = !nutzer || nutzer.rolle === "admin";
  // Dieselbe Regel wie in der Rail und im Torwaechter: eine Karte auf der
  // Zentrale ist eine Tuer, und eine Tuer, die nicht aufgeht, gehoert nicht in
  // die Wand. Ohne persoenliches Konto bleibt alles wie bisher.
  const darf = (id) => require("./lib/schale.js").darfModul(nutzer, id);
  // Buchhaltung, Content und Marketing haengen an der Datenbank — ohne
  // DATABASE_URL laedt server.js ihre Routen oben gar nicht erst. Dann duerfen
  // hier auch keine Karten stehen, die auf eine 404 zeigen und rot "Fehler beim
  // Laden" schreiben. Auf dem Laptop ohne Datenbank bleibt die Zentrale damit
  // schlicht kuerzer, statt kaputt auszusehen.
  const datenbank = Boolean(process.env.DATABASE_URL);
  // aktiv = "zentrale-start" (nicht "zentrale"): Seit der Kalender als
  // Unterpunkt darunter haengt, hat die Zentrale selbst einen eigenen
  // Untereintrag — sonst waere in der Rail kein Kind markiert.
  // Eine Karte = ein Bereich. Kopf mit Titel und Unterzeile, rechts der Weg
  // dorthin — dasselbe Muster wie die Karten im CRM, in der Buchhaltung und im
  // Content. Der Inhalt wird nachgeladen und von renderCard() unten gebaut.
  const karte = (titel, unter, quelle, ziel, zielWort) => `
    <div class="karte"><div class="karte-kopf"><div>
      <h2>${titel}</h2><div class="sub">${unter}</div></div>
      ${ziel ? `<a href="${ziel}" class="caption">${zielWort} →</a>` : ""}</div>
      <div data-load="${quelle}"><p class="caption">Lädt …</p></div></div>`;

  // ---- Geld und Ausblick: dieselben Groessen wie im CRM-Dashboard ----
  //
  // Diese drei Bloecke werden SERVERSEITIG gebaut, nicht nachgeladen wie die
  // Karten darunter. Grund: eine Kurve aus zwoelf Monaten im Browser zu
  // zeichnen hiesse, die Bezier-Rechnung ein zweites Mal zu schreiben — und
  // damit zwei Kurven zu pflegen, die dieselbe Zahl zeigen sollen. Die Daten
  // kommen aus crm.zentraleZahlen(), die Abschlusschancen aus
  // lib/pipeline-quoten.js: dieselbe Quelle, aus der das CRM-Dashboard rechnet.
  //
  // Ohne persoenliche Anmeldung gibt es die Zahlen nicht — daran haengen die
  // Zeilenrechte in der Datenbank. Dann steht hier ein Hinweis statt einer
  // leeren Kurve.
  let geldBlock = "";
  if (datenbank && nutzer) {
    try {
      const z = await require("./lib/crm.js").zentraleZahlen(nutzer);
      const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
      const kurve = umsatzKurve(z.verlauf.map((v) => v.wert));
      const monatName = new Date().toLocaleDateString("de-DE", { month: "long" });
      const vormonatName = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
        return d.toLocaleDateString("de-DE", { month: "long" }); })();
      // Veraenderung zum Vormonat. Ohne Vormonatsumsatz gibt es keinen
      // Prozentwert — "+100 %" auf eine Null ist keine Aussage, sondern eine
      // Division, die zufaellig durchgeht.
      const wachstum = z.umsatz.vormonat > 0
        ? Math.round(((z.umsatz.monat - z.umsatz.vormonat) / z.umsatz.vormonat) * 100)
        : null;
      const monateMitUmsatz = z.verlauf.filter((v) => v.wert > 0).length;
      const schnitt = monateMitUmsatz ? z.umsatz.gesamt / monateMitUmsatz : 0;

      geldBlock = `
      <div class="zt-geld">
        <!-- Links die Zahl, um die es geht. Anders als im CRM-Dashboard steht
             rechts nicht das Monatsziel, sondern der Umsatz INSGESAMT — auf der
             Startseite ist "was haben wir bisher gemacht" die zweite Frage nach
             "was haben wir diesen Monat gemacht". -->
        <!-- Der ganze Kasten führt zur Aufschlüsselung. Eine Summe ohne den
             Weg zu ihren Bestandteilen ist eine Behauptung — hier ist sie
             nachprüfbar: ein Klick, und darunter stehen die Kunden. -->
        <a class="karte zt-umsatz" href="/umsatz" title="Alle Abschlüsse nach Monat ansehen">
          <div class="zt-umsatz-haupt">
            <span class="kachel-label">Umsatz ${esc(monatName)}</span>
            <div class="zt-umsatz-zahl">${eur(z.umsatz.monat)}</div>
            <div class="zt-umsatz-fuss">
              <span class="caption">${z.umsatz.anzahl_monat} ${z.umsatz.anzahl_monat === 1 ? "Abschluss" : "Abschlüsse"}</span>
              ${wachstum === null
                ? `<span class="caption zt-punkt">${esc(vormonatName)} ohne Umsatz</span>`
                : `<span class="trend ${wachstum >= 0 ? "auf" : "ab"} klein">${wachstum >= 0 ? "↗" : "↘"} ${Math.abs(wachstum)} % zu ${esc(vormonatName)}</span>`}
            </div>
          </div>
          <div class="zt-umsatz-seite">
            <div class="zt-umsatz-neben">
              <span class="kachel-mini-titel">${esc(vormonatName)}</span>
              <div class="zt-umsatz-neben-zahl">${eur(z.umsatz.vormonat)}</div>
            </div>
            <div class="zt-umsatz-neben stark">
              <span class="kachel-mini-titel">Insgesamt</span>
              <div class="zt-umsatz-neben-zahl">${eur(z.umsatz.gesamt)}</div>
              <span class="kachel-mini-ziel">${z.umsatz.anzahl_gesamt} Abschlüsse · Ø ${eur(schnitt)}/Monat</span>
            </div>
          </div>
        </a>

        <div class="karte zt-kurve">
          <div class="karte-kopf"><div><h2>Umsatzentwicklung</h2>
            <div class="sub">Zwölf Monate — gewonnene Deals je Monat</div></div>
            <a href="/crm" class="caption">CRM →</a></div>
          <div class="chart-flaeche" style="height:200px">
            <div class="chart-y">${[kurve.max, kurve.max * .75, kurve.max * .5, kurve.max * .25, 0]
              .map((v, i) => `<span style="top:${kurve.gitter[i]}px">${eurK(v)}</span>`).join("")}</div>
            <svg viewBox="0 0 800 200" preserveAspectRatio="none" style="width:100%;height:180px">
              <defs>
                <linearGradient id="ztfl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--blau-600)" stop-opacity=".38"/>
                  <stop offset="45%" stop-color="var(--blau-500)" stop-opacity=".16"/>
                  <stop offset="100%" stop-color="var(--blau-400)" stop-opacity="0"/></linearGradient>
                <linearGradient id="ztln" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="var(--blau-400)"/>
                  <stop offset="100%" stop-color="var(--blau-900)"/></linearGradient>
              </defs>
              ${kurve.gitter.map((y) => `<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 6"/>`).join("")}
              <path d="${kurve.flaeche}" fill="url(#ztfl)"/>
              <path d="${kurve.linie}" fill="none" stroke="url(#ztln)" stroke-width="2.5" stroke-linecap="round"/>
              ${kurve.pkt.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="var(--surface-fest, #fff)" stroke="var(--blau-600)" stroke-width="2.5"/>`).join("")}
            </svg>
            <div class="chart-achse">${z.verlauf.map((v) =>
              `<span class="caption">${MON[Number(v.monat.slice(5, 7)) - 1]}</span>`).join("")}</div>
          </div>
        </div>

        <div class="karte zt-vorn">
          <div class="karte-kopf"><div><h2>Blick nach vorn</h2>
            <div class="sub">Was in der offenen Pipeline steckt</div></div></div>
          <div class="forecast">
            <div class="forecast-label">${ZT.waage} Forecast</div>
            <div class="forecast-zahl">${eur(z.forecast)}</div>
            <div class="forecast-sub">gewichtet nach Phasen-Wahrscheinlichkeit</div>
          </div>
          <div class="kennliste">
            <div class="kennzeile">${ZT.trend}<span>Pipeline offen</span><b>${eur(z.pipeline_wert)}</b></div>
            <div class="kennzeile">${ZT.schichten}<span>Offene Deals</span><b>${z.offene_deals}</b></div>
            <div class="kennzeile">${ZT.euro}<span>Ø Deal-Größe</span><b>${z.offene_deals ? eur(z.pipeline_wert / z.offene_deals) : "—"}</b></div>
            <div class="kennzeile">${ZT.kalenderKlein}<span>Nächste 30 Tage</span><b>${z.erwartet30 ? eur(z.erwartet30) : "—"}</b></div>
            <div class="kennzeile">${ZT.ziel}<span>Kunden · Leads</span><b>${z.kunden} · ${z.leads}</b></div>
          </div>
        </div>
      </div>`;
    } catch (e) {
      console.error("Zentrale-Zahlen:", e.message);
      geldBlock = `<div class="hinweis warn" style="margin-bottom:16px">${ZT.warnung}<div>
        Umsatz und Forecast sind gerade nicht abrufbar — die CRM-Datenbank antwortet nicht.</div></div>`;
    }
  } else if (datenbank) {
    geldBlock = `<div class="hinweis info" style="margin-bottom:16px">${ZT.info}<div>
      <strong>Melde dich persönlich an</strong>, dann stehen hier Umsatz, Entwicklung und Forecast —
      an deinem Konto hängen die Zeilenrechte in der Datenbank.
      <a href="/crm/anmelden">Jetzt anmelden →</a></div></div>`;
  }

  res.send(layout("Zentrale", "zentrale-start", `
    <div class="seiten-kopf">
      <div><p class="sub">${heute}${nutzer ? " · " + esc(nutzer.name.split(" ")[0]) : ""}</p></div>
      <!-- Die Knöpfe starten eure eigenen Abläufe: Briefing, Mail-Triage,
           Lead-Lauf, Alexandra. Nichts davon gehört auf die Zentrale von
           jemandem, der diese Bereiche gar nicht hat — ein Knopf, der ins
           Leere führt, ist schlimmer als kein Knopf. -->
      <div class="zt-tasten">
        ${admin ? `
        <form method="post" action="/briefing/neu"><button class="dunkel">${ICON.sonne} Briefing erstellen</button></form>
        <form method="post" action="/skill/mail-triage"><button class="sekundaer">${ZT.post} Mail-Triage starten</button></form>` : ""}
        ${darf("leads") ? `<a class="knopf sekundaer" href="/leads">${ICON.leads} Lead-Lauf</a>` : ""}
        ${darf("chat") ? `<a class="knopf sekundaer" href="/chat">${ICON.funke} Alexandra fragen</a>` : ""}
      </div>
    </div>
    ${req.query.gestartet ? `<div class="hinweis info" style="margin-bottom:16px">${ZT.info}<div>
      <strong>${esc(req.query.gestartet)}</strong> läuft — Alexandra arbeitet im Hintergrund.
      Das Ergebnis erscheint hier, lad die Seite in ein paar Minuten neu.</div></div>` : ""}

    ${geldBlock}

    <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div>
      <h2>Tages-Briefing</h2><div class="sub">Was Alexandra für heute zusammengestellt hat</div></div>
      <a href="/chat" class="caption">Alexandra fragen →</a></div>
      <div data-load="/api/briefing"><p class="caption">Lädt …</p></div></div>

    <div class="zt-raster">
      <div class="karte"><div class="karte-kopf"><div>
        <h2>Kalender</h2><div class="sub" id="cal-label">Heute</div></div>
        <span class="zt-kopf-rechts">
          <span class="zt-nav">
            <button type="button" onclick="calShift(-1)" title="Ein Tag zurück">${ZT.links}</button>
            <button type="button" onclick="calShift(1)" title="Ein Tag vor">${ZT.rechts}</button></span>
          <a href="/kalender" class="caption">öffnen →</a></span></div>
        <div id="cal-body"><p class="caption">Lädt …</p></div></div>
      ${datenbank && darf("todos") ? karte("To-Dos", "Was heute ansteht", "/api/todos/stats", "/todos", "öffnen") : ""}
      ${admin ? karte("Mail-Triage", "Vier Körbe, sortiert von Alexandra", "/api/mail", null) : ""}
      ${admin ? karte("Was braucht mich?", "Freigaben und Entscheidungen", "/api/inbox", null) : ""}
      ${darf("crm") ? karte("Kunden &amp; CRM", "Wie der Monat ausgeht", "/api/crm/stats", "/crm", "öffnen") : ""}
      ${datenbank && admin ? karte("Buchhaltung", "Der laufende Monat", "/api/buchhaltung/stats", "/buchhaltung", "öffnen") : ""}
      ${datenbank && darf("content") ? karte("Content", "Was wir selbst posten", "/api/content/stats", "/content", "öffnen") : ""}
      ${datenbank && darf("marketing") ? karte("Marketing", "Eingekaufte Reichweite", "/api/marketing/stats", "/marketing", "öffnen") : ""}
    </div>`, req));
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
          "Alexandra stellt Termine, Mails und Prioritäten zusammen (dauert 1–3 Minuten).</p>";
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
