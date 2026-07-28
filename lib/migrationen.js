// lib/migrationen.js — welche SQL-Dateien sind in der Datenbank angekommen?
//
// Warum es das gibt (26.07.2026): Jannik hatte 14 Migrationen im Code, in
// Supabase fehlten die meisten. Aufgefallen ist das erst beim Nachmessen —
// im Betrieb haette es ausgesehen wie kaputter Code ("Spalte gibt es nicht"),
// und man haette im falschen Code gesucht. Der Grund war kein
// Kommunikationsproblem, sondern ein fehlendes Werkzeug: Niemand KONNTE sehen,
// welche Dateien schon eingespielt waren.
//
// Ab jetzt fuehrt die Datenbank selbst Buch. Beim Serverstart wird nur GEPRUEFT
// und gewarnt — eingespielt wird ausdruecklich nur, wenn es jemand von Hand
// anstoesst (scripts/migrieren.js). Struktur-Aenderungen an einer Datenbank mit
// echten Kundendaten passieren nicht nebenbei beim Hochfahren.

const fs = require("fs");
const path = require("path");

const ORDNER = path.join(__dirname, "..", "supabase");

// Nur nummerierte Dateien zaehlen, in ihrer Reihenfolge: 0009_kundenakte.sql
// braucht die Tabellen aus 0007_kunden.sql. Andersherum bricht es ab.
function dateien() {
  try {
    return fs.readdirSync(ORDNER)
      .filter((n) => /^\d{4}_.+\.sql$/.test(n))
      .sort();
  } catch { return []; }
}

async function mitVerbindung(arbeit) {
  if (!process.env.DATABASE_URL) return { ok: false, grund: "DATABASE_URL fehlt" };
  const { Client } = require("pg");
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  // Aus demselben Grund wie der Zuhoerer am Pool in lib/crm.js: Ein
  // 'error'-Ereignis ohne Zuhoerer beendet in Node den ganzen Prozess. Diese
  // Pruefung laeuft beim Hochfahren — ein Netzaussetzer in genau dem Moment
  // wuerde den Server nicht warnen lassen, sondern gar nicht erst starten.
  c.on("error", (fehler) => {
    console.error("Migrationspruefung: Verbindung verloren —", String(fehler.message).slice(0, 120));
  });
  try {
    await c.connect();
    await c.query(`create table if not exists schema_migrationen (
      datei text primary key, eingespielt_am timestamptz not null default now())`);
    return await arbeit(c);
  } catch (e) {
    return { ok: false, grund: String(e.message).slice(0, 200) };
  } finally {
    try { await c.end(); } catch {}
  }
}

// Was fehlt? Aendert nichts.
async function offene() {
  return mitVerbindung(async (c) => {
    const { rows } = await c.query("select datei from schema_migrationen");
    const da = new Set(rows.map((r) => r.datei));
    const alle = dateien();
    return { ok: true, alle: alle.length, offen: alle.filter((n) => !da.has(n)) };
  });
}

// Eine bereits von Hand eingespielte Datei nachtragen, ohne sie auszufuehren.
// Gebraucht fuer den Uebergang: Die ersten Migrationen liefen, bevor es dieses
// Buch gab. Ohne das Nachtragen wuerden sie als "offen" gelten und beim
// naechsten Lauf ein zweites Mal starten.
async function alsErledigtMarkieren(namen) {
  return mitVerbindung(async (c) => {
    let n = 0;
    for (const datei of namen) {
      const r = await c.query(
        "insert into schema_migrationen (datei) values ($1) on conflict do nothing", [datei]);
      n += r.rowCount;
    }
    return { ok: true, markiert: n };
  });
}

// Offene Migrationen einspielen — in Reihenfolge, jede in EINER Transaktion.
// Schlaegt eine fehl, wird sie zurueckgerollt und der Lauf hoert auf: Lieber
// eine halb aktuelle Datenbank in bekanntem Zustand als eine, bei der niemand
// mehr weiss, was durchlief.
async function einspielen({ nurEine = null } = {}) {
  return mitVerbindung(async (c) => {
    const { rows } = await c.query("select datei from schema_migrationen");
    const da = new Set(rows.map((r) => r.datei));
    const zuTun = dateien().filter((n) => !da.has(n) && (!nurEine || n === nurEine));

    const erledigt = [];
    for (const datei of zuTun) {
      const sql = fs.readFileSync(path.join(ORDNER, datei), "utf-8");
      try {
        await c.query("begin");
        await c.query(sql);
        await c.query("insert into schema_migrationen (datei) values ($1) on conflict do nothing", [datei]);
        await c.query("commit");
        erledigt.push(datei);
      } catch (e) {
        try { await c.query("rollback"); } catch {}
        return { ok: false, erledigt, gescheitert: datei, grund: String(e.message).slice(0, 300) };
      }
    }
    return { ok: true, erledigt };
  });
}

// Beim Serumstart einmal nachsehen und WARNEN — nie selbst einspielen.
async function warnen() {
  if (!process.env.DATABASE_URL) return;
  const r = await offene().catch(() => null);
  if (!r || !r.ok) return;                       // keine Datenbank erreichbar: still bleiben
  if (!r.offen.length) return;
  console.warn(`⚠️  ${r.offen.length} von ${r.alle} Datenbank-Migrationen sind NICHT eingespielt:`);
  console.warn("    " + r.offen.join(", "));
  console.warn("    Einspielen mit:  node scripts/migrieren.js --einspielen");
}

module.exports = { dateien, offene, einspielen, alsErledigtMarkieren, warnen };
