// Prueft die Verdichtung des Zustands mit erfundenen Daten — ohne Datenbank
// und ohne gws-cli, damit das auch auf dem Laptop laeuft.
// Aufruf: node scripts/zustand-test.js

const os = require("os");
const path = require("path");
const fs = require("fs");

const dir = path.join(os.tmpdir(), "flowstate-zustand-test");
fs.mkdirSync(dir, { recursive: true });
process.env.DATA_PATH = dir;

const jetzt = Date.now();
// gws-cli liefert Ortszeit mit Offset, z.B. "2026-07-22T16:00:00+02:00".
// Genau so bauen wir die Testdaten — sonst prueft der Test die falsche Form.
const tag = (versatzTage, stunde, minute = 0) => {
  const d = new Date(jetzt + versatzTage * 86400000);
  const datum = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${datum}T${p(stunde)}:${p(minute)}:00+02:00`;
};

fs.writeFileSync(path.join(dir, "zustand.json"), JSON.stringify({
  stand: { kalender: jetzt - 3 * 60000, crm: jetzt - 40 * 60000 },
  kalender: [
    { start: tag(0, 9), ende: tag(0, 10), titel: "Marvin Call bzgl. Meta Ads", ort: "" },
    { start: tag(1, 8), ende: tag(1, 9), titel: "Dad Physio", ort: "" },
    { start: tag(1, 16), ende: tag(1, 16, 15), titel: "WM Bau anrufen", ort: "" },
    { start: tag(3, 11), ende: tag(3, 12), titel: "Erstgespräch Krotzer", ort: "Zoom" },
  ],
  crm: {
    kennzahlen: {
      leads: 47, kunden: 12, offene_deals: 8, pipeline_wert: 34500,
      gewonnen_monat: 3, umsatz_monat: 12400, wiedervorlagen: 5, offene_aufgaben: 11,
    },
    team: [
      { name: "Lukas Sehorz", rolle: "admin", leads: 31, kunden: 8, offen: 5, gewonnen: 9, verloren: 3, umsatz_monat: 8200, anrufe_heute: 6 },
      { name: "Jannik vom Hofe", rolle: "admin", leads: 16, kunden: 4, offen: 3, gewonnen: 4, verloren: 1, umsatz_monat: 4200, anrufe_heute: 2 },
    ],
  },
}));

const zustand = require("../lib/zustand.js");
const text = zustand.alsText();

console.log(text);
console.log("───────────────────────────────────────────");
console.log(`Zeichen: ${text.length}  |  grob Token: ${Math.round(text.length / 3.5)}`);
console.log(`Veraltet laut Frische-Regeln: ${JSON.stringify(zustand.veraltet())}`);

fs.rmSync(dir, { recursive: true, force: true });
