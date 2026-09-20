#!/usr/bin/env node
// Die Postfach-Rueckschau von der Kommandozeile — derselbe Lauf wie der Knopf
// "Alle Rechnungen seit … holen" auf der Belege-Seite, nur ohne Browser.
// Geht ueber die Dienstanmeldung (DIENST_KONTO), wie der taegliche Lauf.
//
//   docker exec -w /app flowstate-dashboard node scripts/postfach-rueckschau.js --seit 2026-07-26
//
// Ohne --seit: die letzten 7 Tage. Bucht nichts — die Belege liegen danach im
// Eingang, zum Pruefen oder fuer "sauber gelesene buchen".
const args = process.argv.slice(2);
const wert = (name) => { const i = args.indexOf(name); return i >= 0 ? String(args[i + 1] || "") : ""; };
const seit = wert("--seit");
if (seit && !/^\d{4}-\d{2}-\d{2}$/.test(seit)) { console.error("--seit braucht JJJJ-MM-TT, z. B. --seit 2026-07-26"); process.exit(2); }

const telegram = require("../lib/telegram.js");
const mailBelege = require("../lib/mail-belege.js");

(async () => {
  const konten = mailBelege.allePostfaecher().map((p) => p.name || "Hauptkonto");
  console.log(`Postfächer: ${konten.join(", ") || "keins"} — ${seit ? "seit " + seit : "letzte 7 Tage"}`);
  let zuletzt = 0;
  const r = await mailBelege.laufen({
    dash: telegram.dash,
    seit,
    tage: 7,
    melden: telegram.hatOwner?.() ? (t) => telegram.push(t) : null,
    fortschritt: (s) => { if (s.geprueft - zuletzt >= 10) { zuletzt = s.geprueft; console.log(`… ${s.geprueft} Mails geprüft, ${s.neu} neue Belege`); } },
  });
  if (!r.ok) { console.error("Fehlgeschlagen: " + r.hint); process.exit(1); }
  console.log("\n" + r.reply);
  console.log(`\n${r.geprueft} Mails geprüft, ${r.neu} neue Belege, ${r.uebersprungen} nicht verarbeitet.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
