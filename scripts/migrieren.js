// Datenbank-Migrationen anzeigen und einspielen.
//
//   node scripts/migrieren.js                          zeigt nur an, was fehlt
//   node scripts/migrieren.js --einspielen             spielt die offenen ein
//   node scripts/migrieren.js --nachtragen 0001 0002   traegt GENANNTE als
//                                                      erledigt ein, ohne sie
//                                                      auszufuehren
//   node scripts/migrieren.js --nachtragen             dasselbe fuer ALLE
//
// "--nachtragen" ist fuer den EINMALIGEN Uebergang gedacht: Die Migrationen bis
// heute wurden von Hand in Supabase eingespielt, bevor es dieses Buch gab. Wer
// das ausfuehrt, behauptet damit "das ist in der Datenbank schon drin" — also
// nur fuer Dateien benutzen, bei denen das sicher stimmt. Genau deshalb lassen
// sich einzelne Namen angeben statt pauschal alle.
//
// Warum das wichtig ist: Die meisten Dateien hier sind wiederholbar geschrieben
// ("if not exists", "where not exists", reine updates) — ein zweiter Lauf tut
// dort nichts. NICHT wiederholbar ist aber z. B. in 0013/0015
// "set position = position + 100": zweimal ausgefuehrt sind es 200. Deshalb
// nicht blind alles nochmal durchjagen.

const m = require("../lib/migrationen.js");

const einspielen = process.argv.includes("--einspielen");
const nachtragen = process.argv.includes("--nachtragen");

(async () => {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL ist nicht gesetzt — ohne Datenbank geht hier nichts.");
    console.log("Auf dem Server:  docker exec flowstate-dashboard node scripts/migrieren.js");
    process.exit(1);
  }

  const stand = await m.offene();
  if (!stand.ok) { console.log("Datenbank nicht erreichbar:", stand.grund); process.exit(1); }

  console.log(`${stand.alle} Migrationen im Ordner supabase/, davon ${stand.offen.length} offen.`);
  if (!stand.offen.length) { console.log("Die Datenbank ist auf dem aktuellen Stand."); process.exit(0); }
  for (const d of stand.offen) console.log("   offen:  " + d);

  if (nachtragen) {
    // Namen duerfen abgekuerzt werden: "0004" trifft "0004_todos.sql".
    const muster = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    const ziel = muster.length
      ? stand.offen.filter((d) => muster.some((mu) => d.startsWith(mu) || d === mu))
      : stand.offen;
    if (!ziel.length) { console.log("\nKeine passende offene Datei gefunden."); process.exit(1); }
    console.log("\nWird als erledigt eingetragen, OHNE Ausfuehrung:");
    for (const d of ziel) console.log("   " + d);
    const r = await m.alsErledigtMarkieren(ziel);
    console.log(r.ok ? `\n${r.markiert} Datei(en) eingetragen.` : `\nFehlgeschlagen: ${r.grund}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (!einspielen) {
    console.log("\nNur angezeigt, nichts geaendert.");
    console.log("Einspielen:  node scripts/migrieren.js --einspielen");
    process.exit(0);
  }

  console.log("\nSpiele ein …");
  const r = await m.einspielen();
  for (const d of r.erledigt) console.log("   eingespielt:  " + d);
  if (r.ok) { console.log(`\nFertig — ${r.erledigt.length} Migration(en) eingespielt.`); process.exit(0); }
  console.log(`\nABGEBROCHEN bei ${r.gescheitert}:\n   ${r.grund}`);
  console.log("Diese Datei wurde zurueckgerollt, die davor sind drin. Fehler beheben, dann erneut starten.");
  process.exit(1);
})();
