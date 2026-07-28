// scripts/crm-leeren.js — das CRM auf null setzen, bevor die echten Daten kommen.
//
// Warum es das gibt (28.07.2026): Im CRM standen Beispieldaten aus der
// Aufbauzeit — 13 "Demo …"-Firmen, ein Lead-Maschinen-Lauf und die Deals dazu.
// Bevor Jannik die echten Kunden einpflegt, muss das weg, sonst weiss hinterher
// niemand mehr, welche Zahl echt ist.
//
//   node --env-file=.env scripts/crm-leeren.js            zeigt nur, was passieren wuerde
//   node --env-file=.env scripts/crm-leeren.js --wirklich loescht
//
// WAS NICHT ANGEFASST WIRD, und zwar ausdruecklich:
//   buchungen, belege, monats_exporte  — die Buchhaltung. Dort liegen echte
//     Quittungen, Eingangsrechnungen und Kundenrechnungen. Ein Beleg ist ein
//     Dokument mit Aufbewahrungspflicht; er wird nicht "zum Aufraeumen" geloescht.
//   profiles, pipeline_stages, finanz_einstellungen  — Konten und Einstellungen.
//   content_*  — dafuer gibt es scripts/content-beispiele.js --weg.
//   zeiterfassung  — echte Arbeitszeiten.
//
// Reihenfolge: von innen nach aussen. Erst was auf firmen zeigt, dann firmen.
// Andersherum blockieren die Fremdschluessel.

const crm = require("../lib/crm.js");

// Belege haengen ueber buchung_id an Buchungen, nicht an Firmen — sie bleiben.
// Aber Buchungen koennen eine firma_id tragen. Die wird geloest statt geloescht:
// die Buchung bleibt vollstaendig, nur ohne Verweis auf eine Firma, die es nicht
// mehr gibt. Eine Buchung zu loeschen, weil ihr Kunde geloescht wird, waere das
// Gegenteil von Buchhaltung.
const SCHRITTE = [
  { was: "Aktivitäten", sql: "delete from public.aktivitaeten" },
  { was: "Aufgaben (To-Dos)", sql: "delete from public.aufgaben" },
  { was: "Dokumente", sql: "delete from public.dokumente" },
  { was: "Call-Listen-Einträge", sql: "delete from public.call_listen_eintraege" },
  { was: "Call-Listen", sql: "delete from public.call_listen" },
  { was: "Projekte", sql: "delete from public.projekte" },
  { was: "Deals", sql: "delete from public.deals" },
  { was: "Kontakte", sql: "delete from public.kontakte" },
  { was: "Buchungen: Firmenverweis lösen (Buchung bleibt!)",
    sql: "update public.buchungen set firma_id = null where firma_id is not null" },
  { was: "Firmen (Leads und Kunden)", sql: "delete from public.firmen" },
];

const UNANGETASTET = ["buchungen", "belege", "monats_exporte", "profiles",
  "pipeline_stages", "finanz_einstellungen", "zeiterfassung"];

(async () => {
  const echt = process.argv.includes("--wirklich");
  const zaehle = async (t) => (await crm.system(`select count(*)::int c from public.${t}`)).rows[0].c;

  console.log(echt ? "LÖSCHEN\n" : "TROCKENLAUF — es wird nichts geändert. Mit --wirklich ausführen.\n");

  console.log("Vorher:");
  const vorher = {};
  for (const t of ["firmen", "deals", "projekte", "aktivitaeten", "aufgaben", "kontakte",
    ...UNANGETASTET]) {
    vorher[t] = await zaehle(t);
    console.log(`  ${t.padEnd(22)} ${String(vorher[t]).padStart(5)}${UNANGETASTET.includes(t) ? "   ← bleibt" : ""}`);
  }

  if (!echt) {
    console.log("\nWürde ausführen:");
    for (const s of SCHRITTE) console.log("  " + s.was);
    console.log("\nNichts geändert. Zum Ausführen: --wirklich");
    process.exit(0);
  }

  console.log("");
  for (const s of SCHRITTE) {
    const r = await crm.system(s.sql);
    console.log(`  ${String(r.rowCount).padStart(4)} × ${s.was}`);
  }

  console.log("\nNachher:");
  let fehler = false;
  for (const t of Object.keys(vorher)) {
    const jetzt = await zaehle(t);
    const bleibt = UNANGETASTET.includes(t);
    // Was bleiben sollte, MUSS gleich geblieben sein. Sonst ist etwas passiert,
    // das nicht passieren durfte — dann sagt das Skript es laut.
    if (bleibt && jetzt !== vorher[t]) { fehler = true; }
    console.log(`  ${t.padEnd(22)} ${String(jetzt).padStart(5)}` +
      (bleibt ? (jetzt === vorher[t] ? "   ✅ unverändert" : `   ❌ WAR ${vorher[t]}!`) : ""));
  }
  console.log(fehler
    ? "\n❌ Eine geschützte Tabelle hat sich geändert. Sicherung prüfen!"
    : "\n✅ CRM leer, Buchhaltung und Einstellungen unverändert.");
  process.exit(fehler ? 1 : 0);
})();
