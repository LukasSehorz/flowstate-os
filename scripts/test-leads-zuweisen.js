// Testet, dass die Geschaeftsfuehrung Leads in die Liste eines Mitarbeiters
// laden kann — ohne sich in dessen Konto anzumelden (05.08.2026).
//
// Braucht die Datenbank und laeuft darum NICHT in scripts/pruefen.js mit,
// genau wie test-crm.js. Aufruf im Container:
//   docker exec -w /app flowstate-dashboard node scripts/test-leads-zuweisen.js
//
// Der Test greift die Routen direkt ab, statt ueber HTTP zu gehen: So braucht
// er keine Anmeldung und kein Passwort im Skript. Der zweite Zweck ist die
// Syntaxpruefung des erzeugten Browser-Skripts — node --check sieht es nicht,
// weil es in einem Template-String steckt. Ein Tippfehler dort macht den
// Dialog stumm, und das faellt sonst erst beim Benutzen auf.
const fs = require("fs"), path = require("path");
const envPfad = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPfad)) {
  for (const z of fs.readFileSync(envPfad, "utf-8").split("\n")) {
    const t = z.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
  }
}
const crm = require("../lib/crm.js");

let fehler = 0;
const melde = (ok, text) => { console.log((ok ? "✅" : "❌") + " " + text); if (!ok) fehler++; };

// Fake-App: sammelt die Routen ein, statt einen Server zu starten.
const routen = {};
const app = {
  get: (p, ...h) => { routen["GET " + p] = h[h.length - 1]; },
  post: (p, ...h) => { routen["POST " + p] = h[h.length - 1]; },
  use: () => {},
};
require("../lib/crm-routes.js")(app);

// Ruft eine Route auf und gibt zurueck, was sie geantwortet hat.
function rufen(schluessel, req) {
  return new Promise((fertig, schief) => {
    const res = {
      send: (html) => fertig({ html }),
      json: (d) => fertig({ json: d }),
      redirect: (ziel) => fertig({ redirect: ziel }),
      status(c) { this.code = c; return this; },
    };
    Promise.resolve(routen[schluessel](req, res, schief)).catch(schief);
  });
}

(async () => {
  // module kommt mit, weil die Navigation es liest — sonst testen wir eine
  // Seite, die es so fuer niemanden gibt.
  const { rows: leute } = await crm.system(
    `select id, name, rolle, coalesce(module, '{}') as module from profiles where aktiv order by rolle, name`);
  const chef = leute.find((p) => p.rolle === "admin");
  const angestellt = leute.find((p) => p.rolle !== "admin");
  if (!chef || !angestellt) { console.error("Kein Admin oder kein Mitarbeiter in profiles."); process.exit(1); }
  console.log(`Getestet mit: ${chef.name} (admin) → ${angestellt.name} (${angestellt.rolle})\n`);

  // ---------------------------------------------------------------- Ansicht
  const alsChef = await rufen("GET /crm/leads", { nutzer: chef, query: {} });
  melde(alsChef.html.includes('id="ln-besitzer"'), "GF sieht die Auswahl „In wessen Liste?“");
  melde(alsChef.html.includes(`>${angestellt.name}<`) || alsChef.html.includes(angestellt.name),
    `GF findet ${angestellt.name} in der Auswahl`);
  melde(!alsChef.html.includes(`value="${chef.id}"`), "GF steht nicht doppelt drin (nur als „meine eigene Liste“)");

  const alsAngestellter = await rufen("GET /crm/leads", { nutzer: angestellt, query: {} });
  melde(!alsAngestellter.html.includes('id="ln-besitzer"'),
    "Mitarbeiter sieht die Auswahl NICHT (darf niemandem Arbeit zuschieben)");

  // ------------------------------------------- Erzeugtes Browser-Skript lesbar?
  // new Function parst, fuehrt aber nichts aus — genau das, was hier zaehlt.
  const skripte = alsChef.html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  let kaputt = 0;
  for (const s of skripte) {
    try { new Function(s.replace(/^<script>/, "").replace(/<\/script>$/, "")); }
    catch (e) { kaputt++; console.log("   " + String(e.message).slice(0, 120)); }
  }
  melde(skripte.length > 0 && !kaputt, `${skripte.length} Browser-Skripte auf der Seite, ${kaputt} mit Syntaxfehler`);

  // ------------------------------------------------------ Hochladen fuer Simon
  const name = "ZZ Testfirma Zuweisung " + process.pid;
  const antwort = await rufen("POST /crm/leads/neu", {
    nutzer: chef,
    query: {},
    body: { sparte: "webdesign", name, telefon: "+49 89 0000" + String(process.pid).slice(-4), besitzer: angestellt.id },
  });
  melde(antwort.json && antwort.json.ok && antwort.json.angelegt === 1, "Lead angelegt");
  melde(antwort.json && antwort.json.fuer === angestellt.name,
    `Antwort nennt den Empfaenger (${antwort.json && antwort.json.fuer || "—"})`);

  const { rows: [angelegt] } = await crm.system(
    `select besitzer, gewonnen_durch from firmen where name = $1`, [name]);
  melde(angelegt && String(angelegt.besitzer) === String(angestellt.id),
    "Der Lead gehoert dem Mitarbeiter, nicht der GF");
  melde(angelegt && String(angelegt.gewonnen_durch) === String(angestellt.id),
    "Auch die Zurechnung (gewonnen_durch) steht auf dem Mitarbeiter");

  // Sieht der Mitarbeiter ihn in seiner eigenen Liste?
  const seineListe = await crm.firmenListe(angestellt, { suche: name, limit: 10 });
  melde(seineListe.some((f) => f.name === name), "Der Mitarbeiter sieht ihn in seiner Liste");

  // ------------------------------------- Mitarbeiter darf NICHT zuweisen
  const name2 = "ZZ Testfirma Uebergriff " + process.pid;
  await rufen("POST /crm/leads/neu", {
    nutzer: angestellt,
    query: {},
    body: { sparte: "webdesign", name: name2, telefon: "+49 89 1111" + String(process.pid).slice(-4), besitzer: chef.id },
  });
  const { rows: [uebergriff] } = await crm.system(`select besitzer from firmen where name = $1`, [name2]);
  melde(uebergriff && String(uebergriff.besitzer) === String(angestellt.id),
    "Ein Mitarbeiter kann der GF nichts unterschieben (Zuweisung wird ignoriert)");

  // ------------------------------------------------------------------ Aufraeumen
  const weg = await crm.system(`delete from firmen where name like 'ZZ Testfirma %'`);
  console.log(`\nAufgeraeumt: ${weg.rowCount} Testfirmen entfernt.`);

  await crm.pool.end();
  console.log(fehler ? `\n${fehler} Problem(e).` : "\nAlles sauber.");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("FEHLER:", e.stack || e.message); process.exit(1); });
