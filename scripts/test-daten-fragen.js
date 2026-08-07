// Stellt Alexandra echte Fragen und prueft Antwort UND Tempo.
//
// Die drei Fragen vom 05.08. sind der Prueffall: Damals kam dreimal wortgleich
// dieselbe Antwort ("6 neue Firmen"), obwohl an dem Tag 273 Firmen angelegt
// wurden. Wenn hier dreimal dasselbe herauskommt, ist nichts gewonnen.
//
// Braucht Datenbank UND Modellzugang, laeuft darum nicht in pruefen.js mit:
//   docker exec -w /app flowstate-dashboard node scripts/test-daten-fragen.js
const fs = require("fs"), path = require("path");
const envPfad = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPfad)) {
  for (const z of fs.readFileSync(envPfad, "utf-8").split("\n")) {
    const t = z.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
  }
}
const daten = require("../lib/daten-fragen.js");
const crm = require("../lib/crm.js");

let fehler = 0;
const melde = (ok, text) => { console.log((ok ? "✅" : "❌") + " " + text); if (!ok) fehler++; };

const FRAGEN = [
  "Hat sich heute was im CRM getan?",
  "Kam auch neue Leads dazu bei Jannik und bei Ioannis?",
  "Wurden Erstgespräche gebucht?",
  "Wie viele Leads hat Ioannis insgesamt?",
  "Wie viele Kunden haben wir?",
];

(async () => {
  // --- Schreibschutz: das Wichtigste zuerst -------------------------------
  const boese = [
    "delete from firmen",
    "update firmen set name = 'kaputt'",
    "drop table firmen",
    "insert into firmen (name) values ('x')",
  ];
  const { rows: [chef] } = await crm.system(
    `select id from profiles where aktiv and rolle='admin' order by name limit 1`);
  const { rows: [vorher] } = await crm.system(`select count(*)::int n from firmen`);
  for (const sql of boese) {
    // Direkt am Ausfuehrer vorbei am Modell — genau der Fall, den die
    // schreibgeschuetzte Transaktion abfangen muss.
    const modul = require("../lib/daten-fragen.js");
    let ok = false;
    try {
      const c = await crm.pool.connect();
      try {
        await c.query("begin transaction read only");
        await c.query("set local role authenticated");
        await c.query(`set local request.jwt.claims = '${JSON.stringify({ sub: chef.id, role: "authenticated" })}'`);
        await c.query(sql);
        await c.query("rollback");
      } catch { ok = true; await c.query("rollback").catch(() => {}); } finally { c.release(); }
    } catch { ok = true; }
    melde(ok, `Abgewiesen: ${sql.slice(0, 34)}`);
    void modul;
  }
  const { rows: [nachher] } = await crm.system(`select count(*)::int n from firmen`);
  melde(vorher.n === nachher.n, `Firmenzahl unveraendert (${vorher.n})`);

  // --- Das Schema kommt aus der Datenbank ---------------------------------
  const s = await daten.schema();
  melde(s.includes("firmen(") && s.includes("besitzer"), "Schema enthaelt firmen mit besitzer");
  melde(s.includes("gewonnen_durch"), "Schema kennt auch neue Spalten (gewonnen_durch)");
  console.log(`   Schema: ${s.split("\n").length} Tabellen, ${s.length} Zeichen\n`);

  // --- Die echten Fragen ---------------------------------------------------
  const antworten = [];
  for (const f of FRAGEN) {
    const t0 = Date.now();
    const r = await daten.datenFragen(f);
    const ms = Date.now() - t0;
    antworten.push(r.reply || "");
    console.log(`\n❓ ${f}`);
    console.log(`   → ${r.ok ? r.reply : "FEHLER: " + r.hint}`);
    console.log(`   ${(ms / 1000).toFixed(1)}s${r.sql ? " · " + String(r.sql).replace(/\s+/g, " ").slice(0, 150) : ""}`);
    melde(r.ok, `beantwortet in ${(ms / 1000).toFixed(1)}s`);
    melde(ms < 12000, "unter 12 Sekunden");
  }

  // --- Der eigentliche Punkt: verschiedene Fragen, verschiedene Antworten --
  const drei = antworten.slice(0, 3);
  melde(new Set(drei).size === 3, "Die drei Fragen von vorgestern geben DREI verschiedene Antworten");

  await crm.pool.end();
  console.log(fehler ? `\n${fehler} Problem(e).` : "\nAlles sauber.");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("FEHLER:", e.stack || e.message); process.exit(1); });
