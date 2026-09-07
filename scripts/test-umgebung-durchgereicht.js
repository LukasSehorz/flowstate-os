#!/usr/bin/env node
// Waechter: Was in .env.beispiel dokumentiert ist und im Code benutzt wird,
// muss docker-compose.yml auch in den Container durchreichen.
//
// WARUM (07.09.2026): docker-compose.yml zaehlt die Umgebungswerte EINZELN
// auf. Steht einer nicht in der Liste, kann er in der .env stehen und kommt
// trotzdem nie an — ohne Fehlermeldung, denn der Code nimmt dann still seine
// eigene Vorgabe. So lief die Anmeldung der Hintergrundlaeufe monatelang gegen
// eine Adresse, die es nicht gab: Der taegliche Postfach-Lauf und die
// Telegram-Belege kamen nie herein, und im Protokoll stand nur ein 403.
//
// Dieser Test faellt auf, bevor es jemand im Betrieb merkt.
const fs = require("fs");
const path = require("path");
const wurzel = path.join(__dirname, "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8");

// PORT und DATA_PATH setzt der Container selbst, DATABASE_URL kommt ueber
// env_file — die gehoeren nicht in die Aufzaehlung.
const EIGEN = new Set(["PORT", "DATA_PATH", "VAULT_PATH", "DATABASE_URL", "HOME", "NODE_ENV"]);

const dokumentiert = [...lies(".env.beispiel").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
const durchgereicht = new Set([...lies("docker-compose.yml").matchAll(/^\s*-\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
const imCode = new Set();
for (const f of ["server.js", ...fs.readdirSync(path.join(wurzel, "lib")).filter((x) => x.endsWith(".js")).map((x) => "lib/" + x)])
  for (const m of lies(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) imCode.add(m[1]);

const fehlt = [...new Set(dokumentiert)].filter((k) => !EIGEN.has(k) && imCode.has(k) && !durchgereicht.has(k));

if (fehlt.length) {
  console.log("❌ Diese Werte stehen in .env.beispiel und im Code, aber NICHT in docker-compose.yml:");
  for (const k of fehlt) console.log("     " + k);
  console.log("\n   Sie kaemen nie im Container an. Eine Zeile je Wert unter 'environment:':");
  console.log("     - " + (fehlt[0] || "NAME") + "=${" + (fehlt[0] || "NAME") + "}");
  process.exit(1);
}
console.log(`✅ Alle ${dokumentiert.length} dokumentierten Werte werden durchgereicht`);
