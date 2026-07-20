// Testet die CRM-Datenschicht inkl. echter RLS gegen Supabase.
const fs = require("fs"), path = require("path");
for (const z of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const t = z.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}
const crm = require("../lib/crm.js");

(async () => {
  const lukas = await crm.anmelden("lukas.sehorz@flowstate-ai.net", "flowstate2026");
  console.log("Login Lukas:", lukas ? `OK (${lukas.rolle}, ${lukas.name})` : "FEHLER");
  const louis = await crm.anmelden("louis.tournier@flowstate-ai.net", "flowstate2026");
  console.log("Login Louis:", louis ? `OK (${louis.rolle})` : "FEHLER");
  console.log("Falsches Passwort:", (await crm.anmelden("lukas.sehorz@flowstate-ai.net", "falsch")) ? "❌ FEHLER" : "✅ korrekt abgelehnt");

  console.log("Pipeline-Stufen:", (await crm.stufen(lukas)).length);

  const a = await crm.firmaAnlegen(lukas, { name: "Testpraxis Nord", telefon: "+498911111", quelle: "test", score: 9, ort: "München" });
  await crm.firmaAnlegen(louis, { name: "Testpraxis Süd", telefon: "+498922222", quelle: "test", besitzer: louis.id });
  const sichtLukas = (await crm.firmenListe(lukas)).length;
  const sichtLouis = (await crm.firmenListe(louis)).length;
  console.log(`RLS-Test — Lukas (admin) sieht ${sichtLukas}, Louis (mitarbeiter) sieht ${sichtLouis}`);

  const dealId = await crm.dealAnlegen(lukas, { firma_id: a.id, titel: "Website Testpraxis", sparte: "webdesign", wert: 1 });
  const spalten = await crm.dealsNachStufen(lukas, "webdesign");
  console.log("Kanban Webdesign:", spalten.map((s) => `${s.name}(${s.deals.length})`).join(" → "));

  // Deal auf Gewonnen schieben -> Firma wird Kunde, Projekt entsteht
  const gewonnen = spalten.find((s) => s.ist_abschluss);
  await crm.dealVerschieben(lukas, dealId, gewonnen.id);
  const f = await crm.firma(lukas, a.id);
  console.log("Nach 'Gewonnen':", `Firma-Status = ${f.status}, Projekte = ${f.projekte.length}, Historie = ${f.historie.length} Einträge`);

  const dub = await crm.firmaAnlegen(lukas, { name: "Testpraxis Nord", telefon: "+498911111" });
  console.log("Dubletten-Wache:", dub.dublette ? `✅ erkannt (${dub.dublette.name})` : "❌ nicht erkannt");

  console.log("Kennzahlen:", JSON.stringify(await crm.kennzahlen(lukas)));
  console.log("Team:", (await crm.teamZahlen(lukas)).map((t) => `${t.name}:${t.leads}L/${t.gewonnen}G`).join(" · "));
  await crm.pool.end();
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
