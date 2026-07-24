// Testet das WhatsApp-Lesen (25.07.) — vor allem die Luecke, die am 24.07.
// auffiel: "Kannst du kurz die neuen WhatsApp-Nachrichten checken?" ging ins
// Leere, weil es nur leseChat(NAME) gab. Der Server suchte einen Kontakt namens
// "die neuen Nachrichten" und fand natuerlich keinen.
//
// Aufruf: node scripts/test-wa-lesen.js

const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wa-test-"));
process.env.WA_DIR = TMP;
process.env.DATA_PATH = TMP;
process.env.WA_GRUPPEN = "Team Flowstate";

const jetzt = Math.floor(Date.now() / 1000);
fs.writeFileSync(path.join(TMP, "contacts.json"), JSON.stringify({
  "491700006888@s.whatsapp.net": { name: "Jannik vom Hofe", notify: "Jannik" },
  "491700003333@s.whatsapp.net": { name: "Mama", notify: "" },
}));
fs.writeFileSync(path.join(TMP, "gruppen.json"), JSON.stringify({
  "111111@g.us": { name: "Team Flowstate" },
}));
// Verlauf: eingehend ("sie") und ausgehend ("ich"), teils alt.
fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), [
  { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 600, text: "Bin gleich im Büro." },
  { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 300, text: "Brauchst du was vom Bäcker?" },
  { jid: "491700003333@s.whatsapp.net", richtung: "sie", von: "Mama", ts: jetzt - 1800, text: "Ruf mal an." },
  { jid: "111111@g.us", richtung: "sie", von: "Ioannis", ts: jetzt - 900, text: "Termin verschoben auf zehn." },
  { jid: "491700006888@s.whatsapp.net", richtung: "ich", von: "Lukas", ts: jetzt - 120, text: "Ne danke." },
  { jid: "491700003333@s.whatsapp.net", richtung: "sie", von: "Mama", ts: jetzt - 200000, text: "Uraltes Zeug." },
].map((o) => JSON.stringify(o)).join("\n") + "\n");

const whatsapp = require("../lib/whatsapp.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

(async () => {
  // --- Der Kernfall: allgemeine Frage ohne Namen -------------------------
  for (const frage of ["neue Nachrichten", "die neuen WhatsApp-Nachrichten", "was ist neu", "whatsapp", ""]) {
    const r = await whatsapp.leseChat(frage);
    const ok = r.ok && /neue Nachricht/i.test(r.reply);
    pruefe(`Allgemein ("${frage || "leer"}") wird zusammengefasst`, ok);
    if (!ok) console.log("      bekommen:", String(r.reply).slice(0, 90));
  }

  const alle = await whatsapp.neueNachrichten();
  pruefe("Zaehlt nur EINGEHENDE (Lukas' eigene nicht)", !/Ne danke/.test(alle.reply));
  pruefe("Alte Nachrichten fallen aus dem Fenster", !/Uraltes/.test(alle.reply));
  pruefe("Der juengste Chat kommt zuerst", alle.reply.indexOf("Jannik") < alle.reply.indexOf("Mama"));
  pruefe("Mehrere aus einem Chat werden gezaehlt", /2 von Jannik/i.test(alle.reply));
  pruefe("Gruppen werden als Gruppe benannt", /in der Gruppe Team Flowstate/.test(alle.reply));
  pruefe("Die letzte Nachricht wird zitiert", /Brauchst du was vom Bäcker/.test(alle.reply));
  console.log("   →", alle.reply.slice(0, 150));

  // --- Ein bestimmter Chat funktioniert weiter ---------------------------
  const j = await whatsapp.leseChat("Jannik");
  pruefe("Bestimmter Kontakt: Jannik gefunden", /Jannik/.test(j.reply) && /Bäcker/.test(j.reply));

  const g = await whatsapp.leseChat("Team Flowstate");
  pruefe("Bestimmte Gruppe funktioniert auch", /Termin verschoben/.test(g.reply));

  const x = await whatsapp.leseChat("Xaver Unbekannt");
  pruefe("Unbekannter Kontakt wird ehrlich gemeldet", /find keinen Kontakt/i.test(x.reply));

  // --- Leeres Fenster ----------------------------------------------------
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), "");
  const leer = await whatsapp.neueNachrichten();
  pruefe("Ohne Nachrichten: ehrliche Auskunft", /nichts reingekommen/i.test(leer.reply));

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
