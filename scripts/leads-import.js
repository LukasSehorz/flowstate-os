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
  const u = await crm.anmelden("lukas.sehorz@svhconsult.de", process.env.CRM_PW || "flowstate2026");
  if (!u) throw new Error("Anmeldung fehlgeschlagen");

  if (process.argv.includes("--testdaten-loeschen")) {
    const r = await crm.system(`delete from firmen where quelle = 'test' or name like 'Testpraxis%' returning id`);
    console.log(`🧹 ${r.rowCount} Testeinträge entfernt`);
  }

  const dir = path.join(VAULT, "projekte", "leads");
  if (!fs.existsSync(dir)) { console.log("Kein Lead-Ordner im Vault gefunden:", dir); await crm.pool.end(); return; }
  const dateien = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!dateien.length) { console.log("Keine Lead-Dateien gefunden."); await crm.pool.end(); return; }

  // Aus der Adresse "Straße 1, 83022 Rosenheim, Deutschland" PLZ und Ort ziehen,
  // falls der Lauf sie nicht schon einzeln mitliefert.
  const ausAdresse = (adresse) => {
    const m = /(\d{5})\s+([^,]+)/.exec(adresse || "");
    if (!m) return { plz: null, ort: null };
    return { plz: m[1], ort: m[2].split("-")[0].trim() };
  };

  let neu = 0, dubletten = 0, wiedervorlage = 0;
  for (const datei of dateien) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, datei), "utf-8"));
    const leads = d.leads || [];
    console.log(`\n📦 ${datei} — ${leads.length} Leads (${d.lauf?.branche || "?"}, ${d.lauf?.region || "?"})`);
    for (const l of leads) {
      // Der echte Ort der Firma zaehlt, nicht die Suchregion des Laufs.
      // Sonst steht bei einem Betrieb in Bad Aibling "Rosenheim", nur weil
      // danach gesucht wurde.
      const geo = ausAdresse(l.adresse);
      const r = await crm.firmaAnlegen(u, {
        name: l.name,
        telefon: l.telefon || null,
        website: l.website || null,
        email: l.email || null,
        adresse: l.adresse || null,
        plz: l.plz || geo.plz,
        ort: l.ort || geo.ort || d.lauf?.region || null,
        branche: l.branche || d.lauf?.branche || null,
        quelle: "lead-maschine",
        score: l.score || null,
        argumente: Array.isArray(l.argumente) ? l.argumente : (l.argumente ? [l.argumente] : null),
        temperatur: (l.score || 0) >= 9 ? "heiss" : "warm",
        stand: l.score ? `Veralterungs-Score ${l.score}/10 aus der Lead-Recherche` : null,
        tags: Array.isArray(l.tags) ? l.tags : (d.lauf?.tags || []),
        abbrechenBeiDublette: true,
      });
      if (!r.angelegt) {
        dubletten++;
        const dub = r.dublette;
        // Ein alter Verlust mit hohem Score ist kein neuer Lead, sondern ein
        // Fall fuer die Wiedervorlage — getrennt ausweisen, nicht still schlucken.
        if (dub.status === "verloren" && (l.score || 0) >= 8) {
          wiedervorlage++;
          console.log(`   ⟳ ${l.name} — war verloren (#${dub.id}), Score ${l.score} → Wiedervorlage prüfen`);
        } else {
          console.log(`   ↺ ${l.name} — Dublette von #${dub.id} "${dub.name}" (${dub.status})`);
        }
      } else {
        neu++;
        console.log(`   ✅ ${l.name}${l.score ? ` (Score ${l.score})` : ""}`);
      }
    }
  }
  console.log(`\n📊 ${neu} neu importiert, ${dubletten} Dubletten übersprungen (davon ${wiedervorlage} Wiedervorlage-Kandidaten)`);
  await crm.pool.end();
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
