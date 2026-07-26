// Zeigt, was mit dem Operating System verbunden ist.
//
//   node scripts/status.js                                  (lokal)
//   docker exec flowstate-dashboard node scripts/status.js  (Server = die Wahrheit)
//
// Warum es das gibt (26.07.2026): Jannik fragte, ob Meta-Ads angebunden ist.
// Sein Assistent schaute ins Repo, fand keine Zugangsdaten und sagte "nicht
// verbunden" — obwohl die Anbindung fertig ist und auf dem Server laeuft. Die
// Wahrheit steht in der .env auf dem Server und ist im Code unsichtbar. Ohne
// dieses Skript baut jemand nach, was es laengst gibt.
//
// Es werden nur JA/NEIN gezeigt, nie ein Wert. Die Ausgabe darf gefahrlos in
// einem Screenshot landen.

const { stand } = require("../lib/anbindungen.js");

const liste = stand();
const aufDemServer = Boolean(process.env.DATA_PATH === "/data" || process.env.VAULT_PATH === "/vault");

console.log(aufDemServer
  ? "\nANBINDUNGEN — auf dem SERVER (das ist der echte Betriebsstand)\n"
  : "\nANBINDUNGEN — auf DIESER Maschine (lokal; der echte Stand ist der Server)\n");

const breite = Math.max(...liste.map((a) => a.name.length));
for (const a of liste) {
  console.log(`  ${a.eingerichtet ? "JA  " : "nein"}  ${a.name.padEnd(breite)}  ${a.zweck}`);
}

const n = liste.filter((a) => a.eingerichtet).length;
console.log(`\n  ${n} von ${liste.length} eingerichtet.`);

if (!aufDemServer) {
  console.log(`
  WICHTIG: "nein" heisst hier NUR "auf diesem Rechner nicht konfiguriert".
  Lokal fehlen die meisten Zugaenge absichtlich — die Zugangsdaten liegen auf
  dem Server, und dort laeuft der Betrieb. Was WIRKLICH verbunden ist, zeigt:

      ssh <server> "docker exec flowstate-dashboard node scripts/status.js"

  Nicht anhand einer lokal fehlenden Variable schliessen, eine Anbindung
  existiere nicht — der Code dafuer ist da, sonst stuende sie hier nicht.`);
}
console.log("");
