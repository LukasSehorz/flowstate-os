// Testet: Doppelte aus einer neuen Liste ZIEHEN UM, statt uebersprungen zu werden.
//
// Anlass (09.10.2026, Lukas): Liste „45 Min. Dorfen“ hochgeladen, 182 statt 300
// Zeilen kamen an — 88 Betriebe standen schon offen in seiner Liste OB/UB und
// wurden als Doppelte uebersprungen. Die Reihenfolge der Datei hatte Loecher.
// „Ich will, dass alle aus dem Dorfen-Umkreis in dieser Liste sind.“
//
// Erwartet:
//   * offener Lead desselben Besitzers ohne Ergebnis → in die neue Liste, an
//     die Nr. der Datei, aus seiner alten Liste raus, Sparten-Tag ergaenzt
//   * Lead mit Ergebnis-Tag (schon angerufen) → bleibt, wo er ist
//   * Lead eines anderen Besitzers → bleibt, wo er ist
//
// Braucht die Datenbank, laeuft darum NICHT in scripts/pruefen.js mit:
//   docker exec -w /app flowstate-dashboard node scripts/test-lead-umzug.js
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
const P = String(process.pid).slice(-4);
const N = (s) => `ZZ Testfirma Umzug ${s} ${P}`;

(async () => {
  const { rows: leute } = await crm.system(
    `select id, name, rolle from profiles where aktiv order by rolle, name`);
  const a = leute.find((p) => p.rolle === "admin");
  const b = leute.find((p) => p.id !== a.id);
  if (!a || !b) { console.error("Zu wenige Konten in profiles."); process.exit(1); }

  try {
    // Alte Liste von a: drei offene Leads, einer davon bekommt danach ein Ergebnis
    const alt = await crm.leadsAnlegen(a, [
      { name: N("offen"), telefon: "+49 89 7001" + P, nr: 1 },
      { name: N("angerufen"), telefon: "+49 89 7002" + P, nr: 2 },
    ], { sparte: "webdesign", besitzer: a.id, listenName: N("Alt") });
    await crm.system(`update firmen set tags = tags || array['absage'] where name = $1`, [N("angerufen")]);
    // Ein Lead von b
    await crm.leadsAnlegen(b, [{ name: N("fremd"), telefon: "+49 89 7003" + P }],
      { sparte: "ki", besitzer: b.id, listenName: N("Fremd") });

    // Neue Liste von a: alle drei Doppelten + ein ganz neuer, mit Nr. aus der Datei
    const neu = await crm.leadsAnlegen(a, [
      { name: N("neu"), telefon: "+49 89 7004" + P, nr: 5 },
      { name: N("offen"), telefon: "+49 89 7001" + P, nr: 12 },
      { name: N("angerufen"), telefon: "+49 89 7002" + P, nr: 13 },
      { name: N("fremd"), telefon: "+49 89 7003" + P, nr: 14 },
    ], { sparte: "ki", besitzer: a.id, listenName: N("Neu") });

    melde(neu.angelegt === 1, `ein neuer Lead angelegt (${neu.angelegt})`);
    melde(neu.verschoben === 1, `ein Doppelter umgezogen (${neu.verschoben})`);
    melde(neu.uebersprungen.length === 2, `zwei bleiben stehen: ${neu.uebersprungen.join(", ")}`);

    const { rows: eintr } = await crm.system(
      `select f.name, e.liste_id, e.position, f.tags from call_listen_eintraege e
         join firmen f on f.id = e.firma_id where f.name like $1 order by f.name, e.liste_id`, [`ZZ Testfirma Umzug % ${P}`]);
    const von = (n) => eintr.filter((e) => e.name === N(n));
    melde(von("offen").length === 1 && Number(von("offen")[0].liste_id) === Number(neu.liste.id)
      && von("offen")[0].position === 12, "offener Lead: nur noch in der neuen Liste, an Nr. 12");
    melde(von("offen")[0] && von("offen")[0].tags.includes("ki"), "offener Lead: Sparten-Tag „ki“ ergänzt");
    melde(von("neu")[0] && von("neu")[0].position === 5, "neuer Lead an Nr. 5");
    melde(von("angerufen").length === 1 && Number(von("angerufen")[0].liste_id) === Number(alt.liste.id),
      "angerufener Lead bleibt in der alten Liste");
    melde(von("fremd").length === 1 && Number(von("fremd")[0].liste_id) !== Number(neu.liste.id),
      "fremder Lead bleibt beim Kollegen");
  } finally {
    await crm.system(`delete from firmen where name like $1`, [`ZZ Testfirma Umzug % ${P}`]);
    await crm.system(`delete from call_listen where name like $1`, [`ZZ Testfirma Umzug % ${P}`]);
  }
  console.log(fehler ? `\n${fehler} Fehler` : "\nalle Prüfungen bestanden");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
