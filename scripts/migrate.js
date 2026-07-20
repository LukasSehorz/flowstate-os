#!/usr/bin/env node
// Spielt alle SQL-Dateien aus supabase/ der Reihe nach in die Datenbank ein.
// Die Zugangsdaten kommen aus .env (DATABASE_URL) und werden nie ausgegeben.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

// .env einlesen (ohne Zusatzpaket)
const envPfad = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPfad)) {
  for (const zeile of fs.readFileSync(envPfad, "utf-8").split("\n")) {
    const t = zeile.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DATABASE_URL fehlt in der Datei .env");
  console.error("   In Supabase: Project Settings → Database → Connection string → Session pooler");
  process.exit(1);
}

(async () => {
  const dir = path.join(__dirname, "..", "supabase");
  const dateien = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  if (!dateien.length) return console.log("Keine SQL-Dateien gefunden.");

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log("✅ Verbunden mit der Datenbank\n");
  } catch (e) {
    console.error("❌ Verbindung fehlgeschlagen:", e.message);
    console.error("   Prüfe die DATABASE_URL (Passwort korrekt? Session pooler gewählt?)");
    process.exit(1);
  }

  for (const datei of dateien) {
    process.stdout.write(`→ ${datei} … `);
    try {
      await client.query(fs.readFileSync(path.join(dir, datei), "utf-8"));
      console.log("OK");
    } catch (e) {
      console.log("FEHLER");
      console.error(`   ${e.message}`);
      if (e.position) console.error(`   an Position ${e.position}`);
      await client.end();
      process.exit(1);
    }
  }

  // Kontrolle
  const t = await client.query(`select count(*)::int c from information_schema.tables where table_schema='public'`);
  const s = await client.query(`select count(*)::int c from public.pipeline_stages`);
  const p = await client.query(`select count(*)::int c from pg_policies where schemaname='public'`);
  console.log(`\n📊 Ergebnis: ${t.rows[0].c} Tabellen · ${s.rows[0].c} Pipeline-Stufen · ${p.rows[0].c} Rechte-Regeln`);
  await client.end();
})();
