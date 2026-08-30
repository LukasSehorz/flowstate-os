// scripts/whiteboard-probe.js — das Whiteboard OHNE Datenbank ausprobieren.
//
//   node scripts/whiteboard-probe.js             leer starten
//   node scripts/whiteboard-probe.js befuellt    mit Beispiel-Elementen starten
//
// Dann im Browser:  http://localhost:3999/als/0   (Lukas, Geschaeftsfuehrung)
//                   http://localhost:3999/als/1   (Jannik, Geschaeftsfuehrung)
//                   http://localhost:3999/als/2   (Louis, Mitarbeiter) … /als/4
//
// Warum es das gibt (30.08.2026): Die Whiteboard-Oberflaeche soll sich mit
// Puppeteer durchtesten lassen — zeichnen, tippen, abhaken, Ansichten wechseln,
// ZWEI Nutzer im Wechsel — ohne die echte Supabase-Datenbank zu beschreiben
// und ohne echte Zugangsdaten auf dem Testrechner. Der Speicher ist die
// Arbeitsspeicher-Fassung aus lib/whiteboard-speicher.js: gleiche Schnittstelle,
// gleiche Regeln (schreiben nur aufs eigene Board, Versionspruefung, Tombstones),
// er lebt nur genau so lange wie dieser Prozess.
//
// Das ist eine PROBE, kein zweiter Betriebsweg: server.js kennt diese Datei
// nicht, und der echte Server laedt das Whiteboard nur mit DATABASE_URL.

const express = require("express");
const session = require("express-session");
const { speicherImArbeitsspeicher } = require("../lib/whiteboard-speicher.js");

// Dieselben Namen wie im echten Team (scripts/nutzer-anlegen.js), aber mit
// erfundenen ids — damit die Wand in der Probe so aussieht wie im Betrieb.
const NUTZER = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Lukas Sehorz", rolle: "admin", module: [] },
  { id: "22222222-2222-4222-8222-222222222222", name: "Jannik vom Hofe", rolle: "admin", module: [] },
  { id: "33333333-3333-4333-8333-333333333333", name: "Louis Tournier", rolle: "mitarbeiter",
    module: ["zentrale", "kalender", "todos", "whiteboard", "crm"] },
  { id: "44444444-4444-4444-8444-444444444444", name: "Ioannis", rolle: "mitarbeiter",
    module: ["zentrale", "kalender", "todos", "whiteboard", "crm"] },
  { id: "55555555-5555-4555-8555-555555555555", name: "Okan", rolle: "mitarbeiter",
    module: ["zentrale", "kalender", "todos", "whiteboard", "crm"] },
];

const speicher = speicherImArbeitsspeicher();

// Beispiel-Elemente, damit Screenshots nicht auf fuenf leere Tafeln schauen.
async function befuellen() {
  const uuid = () => require("crypto").randomUUID();
  const kritzel = (ab, breite, hoehe, wellen) => {
    const punkte = [];
    for (let i = 0; i <= 48; i++) {
      punkte.push(Math.round(ab.x + (i / 48) * breite),
                  Math.round(ab.y + Math.sin((i / 48) * Math.PI * wellen) * hoehe));
    }
    return punkte;
  };
  const [lukas, jannik, louis] = NUTZER;
  await speicher.anlegen(lukas, {
    id: uuid(), art: "text", x: 160, y: 140, breite: 560, hoehe: 300,
    inhalt: JSON.stringify({
      liste: "check", farbe: "schwarz", groesse: 28,
      zeilen: [
        { t: "Angebot Krotzer rausschicken", erledigt: true, gestrichen: false },
        { t: "Meta-Ads Report prüfen", erledigt: false, gestrichen: false },
        { t: "Dreh-Termin mit Jannik klären", erledigt: false, gestrichen: false },
        { t: "Serverbackup kontrollieren", erledigt: false, gestrichen: true },
      ],
    }),
  });
  await speicher.anlegen(lukas, {
    id: uuid(), art: "notiz", x: 860, y: 180, breite: 320, hoehe: 260,
    inhalt: JSON.stringify({
      liste: "keine", farbe: "schwarz", groesse: 24, zettel: "gelb",
      zeilen: [{ t: "Nicht vergessen:", erledigt: false, gestrichen: false },
               { t: "Freitag 14 Uhr Demo!", erledigt: false, gestrichen: false }],
    }),
  });
  await speicher.anlegen(lukas, {
    id: uuid(), art: "strich", x: 150, y: 480, breite: 620, hoehe: 90,
    inhalt: JSON.stringify({ punkte: kritzel({ x: 150, y: 520 }, 620, 40, 3), farbe: "rot", dicke: 6 }),
  });
  await speicher.anlegen(jannik, {
    id: uuid(), art: "text", x: 200, y: 160, breite: 620, hoehe: 260,
    inhalt: JSON.stringify({
      liste: "zahl", farbe: "blau", groesse: 28,
      zeilen: [
        { t: "CRM-Pipeline aufräumen", erledigt: false, gestrichen: false },
        { t: "Buchhaltung August abschließen", erledigt: false, gestrichen: false },
        { t: "Content-Plan September", erledigt: true, gestrichen: false },
      ],
    }),
  });
  await speicher.anlegen(louis, {
    id: uuid(), art: "notiz", x: 300, y: 220, breite: 320, hoehe: 240,
    inhalt: JSON.stringify({
      liste: "punkt", farbe: "schwarz", groesse: 22, zettel: "mint",
      zeilen: [{ t: "Anrufliste Montag", erledigt: false, gestrichen: false },
               { t: "Follow-ups KW 36", erledigt: false, gestrichen: false }],
    }),
  });
  console.log("Beispiel-Elemente angelegt (Lukas 3, Jannik 1, Louis 1).");
}

const app = express();
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(express.json({ limit: "5mb" }));
app.use(express.static(require("path").join(__dirname, "..", "public")));
app.use(session({
  secret: "whiteboard-probe", resave: false, saveUninitialized: false,
  cookie: { maxAge: 3600 * 1000 * 8 },
}));

// Anmeldung per Klick statt Passwort — es gibt hier nichts zu schuetzen.
app.get("/als/:nr", (req, res) => {
  const n = NUTZER[Number(req.params.nr)];
  if (!n) return res.status(404).send("Unbekannte Nummer. 0–" + (NUTZER.length - 1));
  req.session.crm = { ...n, email: n.name.toLowerCase().replace(/\s+/g, ".") + "@probe.local" };
  res.redirect("/whiteboard");
});
const auswahl = (req, res) => res.send(`<!doctype html><meta charset="utf-8">
  <title>Whiteboard-Probe</title>
  <body style="font:16px system-ui;padding:40px;line-height:2">
  <h1>Whiteboard-Probe</h1><p>Als wem anmelden?</p>
  ${NUTZER.map((n, i) => `<a href="/als/${i}">${n.name} (${n.rolle})</a>`).join("<br>")}
  </body>`);
app.get("/", auswahl);
app.get("/crm/anmelden", auswahl);
app.get("/logout", (req, res) => { req.session.destroy(() => res.redirect("/")); });

require("../lib/whiteboard-routes.js")(app, {
  speicher,
  team: async () => NUTZER.map(({ id, name, rolle }) => ({ id, name, rolle })),
});

const PORT = Number(process.env.WB_PROBE_PORT || 3999);
(async () => {
  if (process.argv.includes("befuellt")) await befuellen();
  app.listen(PORT, () => {
    console.log(`Whiteboard-Probe läuft: http://localhost:${PORT}/als/0`);
    console.log("Nutzer wechseln über /als/0 … /als/4 · Daten leben nur in diesem Prozess.");
  });
})();
