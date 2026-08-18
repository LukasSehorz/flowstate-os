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

  // ------------------------------------------- Nach Person filtern (GF)
  melde(alsChef.html.includes(`wer=${angestellt.id}`),
    `Der Umschalter hat einen Eintrag fuer ${angestellt.name}`);

  const seineAnsicht = await rufen("GET /crm/leads", { nutzer: chef, query: { wer: angestellt.id } });
  melde(seineAnsicht.html.includes(`Anrufe von ${angestellt.name}`),
    "Ueberschrift nennt die Person, deren Liste offen ist");
  melde(seineAnsicht.html.includes("nicht deine eigene"),
    "Hinweis macht klar, dass man eine fremde Liste sieht");
  // Der zugewiesene Testlead muss in DIESER Ansicht auftauchen — das ist der
  // eigentliche Zweck: sehen, was man jemandem gegeben hat.
  melde(seineAnsicht.html.includes(name), `Der zugewiesene Lead steht in ${angestellt.name}s Liste`);
  const meineAnsicht = await rufen("GET /crm/leads", { nutzer: chef, query: {} });
  melde(!meineAnsicht.html.includes(name), "…und NICHT in der eigenen Liste der GF");

  // Eine erfundene uuid darf nicht durchgereicht werden.
  const erfunden = await rufen("GET /crm/leads",
    { nutzer: chef, query: { wer: "00000000-0000-0000-0000-000000000000" } });
  melde(erfunden.html.includes("Meine Anrufe"), "Unbekannte Person faellt auf die eigene Liste zurueck");

  const angestellterFiltert = await rufen("GET /crm/leads",
    { nutzer: angestellt, query: { wer: chef.id } });
  melde(angestellterFiltert.html.includes("Meine Anrufe"),
    "Ein Mitarbeiter kann nicht in fremde Listen schauen");

  // ------------------------------------------- Mehrere auf einmal aendern
  const { rows: [testLead] } = await crm.system(`select id from firmen where name = $1`, [name]);
  const sammel = await rufen("POST /crm/leads/sammel", {
    nutzer: chef, query: {},
    body: { ids: [Number(testLead.id)], branche: "immobilien", sparte: "performance" },
  });
  melde(sammel.json && sammel.json.ok && sammel.json.geaendert === 1, "Sammeländerung meldet 1 Lead");
  const { rows: [nachher] } = await crm.system(`select tags from firmen where id = $1`, [testLead.id]);
  melde(nachher.tags.includes("immobilien") && nachher.tags.includes("performance"),
    "Branche und Bereich sind gesetzt");
  melde(!nachher.tags.includes("webdesign"),
    "Der alte Bereich ist weg (nicht beides gleichzeitig)");

  // Nur die Branche aendern darf den Bereich nicht mitnehmen.
  await rufen("POST /crm/leads/sammel",
    { nutzer: chef, query: {}, body: { ids: [Number(testLead.id)], branche: "handwerk" } });
  const { rows: [nurBranche] } = await crm.system(`select tags from firmen where id = $1`, [testLead.id]);
  melde(nurBranche.tags.includes("handwerk") && nurBranche.tags.includes("performance"),
    "Nur die Branche zu aendern laesst den Bereich stehen");

  // Zuweisen per Sammeländerung: GF ja, Mitarbeiter nein.
  await rufen("POST /crm/leads/sammel",
    { nutzer: chef, query: {}, body: { ids: [Number(testLead.id)], besitzer: chef.id } });
  const { rows: [umgehaengt] } = await crm.system(`select besitzer from firmen where id = $1`, [testLead.id]);
  melde(String(umgehaengt.besitzer) === String(chef.id), "GF kann per Sammeländerung zuweisen");

  const fremd = await rufen("POST /crm/leads/sammel",
    { nutzer: angestellt, query: {}, body: { ids: [Number(testLead.id)], branche: "gastro" } });
  const { rows: [unberuehrt] } = await crm.system(`select tags from firmen where id = $1`, [testLead.id]);
  melde(!unberuehrt.tags.includes("gastro"),
    "Ein Mitarbeiter aendert fremde Leads nicht (RLS greift)");
  melde(fremd.json && fremd.json.geaendert === 0, "…und bekommt 0 geaenderte zurueck, nicht 1");

  const leer = await rufen("POST /crm/leads/sammel", { nutzer: chef, query: {}, body: { ids: [] } });
  melde(leer.json && leer.json.ok === false, "Ohne Auswahl passiert nichts");

  // ------------------------------------------------------------------ Aufraeumen
  const weg = await crm.system(`delete from firmen where name like 'ZZ Testfirma %'`);
  // Seit dem 18.08. legt jeder Upload eine Liste an (call_listen). Die
  // Testfirmen loeschen ihre Eintraege per ON DELETE CASCADE mit, die Liste
  // selbst bliebe als leere Huelle stehen — nach jedem Testlauf eine mehr.
  // Sichtbar waere sie nicht (leadListen blendet leere Listen aus), Datenmuell
  // ist sie trotzdem.
  const huellen = await crm.system(
    `delete from call_listen l where not exists (
       select 1 from call_listen_eintraege e where e.liste_id = l.id)`);
  console.log(`\nAufgeraeumt: ${weg.rowCount} Testfirmen entfernt`
    + (huellen.rowCount ? `, ${huellen.rowCount} leere Liste(n) dazu.` : "."));

  await crm.pool.end();
  console.log(fehler ? `\n${fehler} Problem(e).` : "\nAlles sauber.");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("FEHLER:", e.stack || e.message); process.exit(1); });
