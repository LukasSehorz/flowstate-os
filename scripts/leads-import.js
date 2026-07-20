// Importiert die Ergebnisse der Lead-Maschine (JSON im Vault) ins CRM.
// Aufruf: node scripts/leads-import.js [--testdaten-loeschen]
const fs = require("fs"), path = require("path");
for (const z of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const t = z.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}
const crm = require("../lib/crm.js");
const VAULT = process.env.VAULT_LOKAL || "C:/dev/flowstate-vault";

(async () => {
  const u = await crm.anmelden("lukas.sehorz@flowstate-ai.net", process.env.CRM_PW || "flowstate2026");
  if (!u) throw new Error("Anmeldung fehlgeschlagen");

  if (process.argv.includes("--testdaten-loeschen")) {
    const r = await crm.system(`delete from firmen where quelle = 'test' or name like 'Testpraxis%' returning id`);
    console.log(`🧹 ${r.rowCount} Testeinträge entfernt`);
  }

  const dir = path.join(VAULT, "projekte", "leads");
  if (!fs.existsSync(dir)) { console.log("Kein Lead-Ordner im Vault gefunden:", dir); await crm.pool.end(); return; }
  const dateien = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!dateien.length) { console.log("Keine Lead-Dateien gefunden."); await crm.pool.end(); return; }

  let neu = 0, dubletten = 0;
  for (const datei of dateien) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, datei), "utf-8"));
    const leads = d.leads || [];
    console.log(`\n📦 ${datei} — ${leads.length} Leads (${d.lauf?.branche || "?"}, ${d.lauf?.region || "?"})`);
    for (const l of leads) {
      const r = await crm.firmaAnlegen(u, {
        name: l.name,
        telefon: l.telefon || null,
        website: l.website || null,
        adresse: l.adresse || null,
        ort: d.lauf?.region || null,
        branche: d.lauf?.branche || null,
        quelle: "lead-maschine",
        score: l.score || null,
        argumente: Array.isArray(l.argumente) ? l.argumente : (l.argumente ? [l.argumente] : null),
        temperatur: (l.score || 0) >= 9 ? "heiss" : "warm",
        stand: l.score ? `Veraltungs-Score ${l.score}/10 aus der Lead-Recherche` : null,
      });
      if (r.dublette) { dubletten++; console.log(`   ↺ ${l.name} — Dublette (existiert schon)`); }
      else { neu++; console.log(`   ✅ ${l.name}${l.score ? ` (Score ${l.score})` : ""}`); }
    }
  }
  console.log(`\n📊 ${neu} neu importiert, ${dubletten} Dubletten übersprungen`);
  await crm.pool.end();
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
