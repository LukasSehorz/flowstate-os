// scripts/sicherung.js — vollständige Sicherung der Datenbank als JSON.
//
// Warum es das gibt (28.07.2026): Vor dem ersten Einpflegen echter Kundendaten
// gab es im Repo keinen Rückweg. Kein Dump, kein Export, nichts. Solange nur
// Beispieldaten drinstanden, war das folgenlos — in dem Moment, wo die echten
// Kunden drinstehen, ist ein misslungener Import ohne Sicherung ein sehr
// schlechter Tag.
//
//   node --env-file=.env scripts/sicherung.js
//   node --env-file=.env scripts/sicherung.js --ordner /pfad/zum/ziel
//
// Geschrieben wird EINE Datei je Lauf: sicherung-JJJJ-MM-TT-HHMM.json mit
// allen Tabellen. Dazu eine Zeile je Tabelle mit der Zeilenzahl auf der
// Konsole, damit man sofort sieht, ob etwas fehlt.
//
// WICHTIG — Datenschutz: Die Datei enthält Kundennamen, Telefonnummern und
// Umsätze. Sie gehört NICHT ins Git und nicht in den Vault. Der Standardordner
// ist "sicherungen/" und steht in .gitignore. Wer sie woanders hinlegt, muss
// selbst dafür sorgen.
//
// Zurückspielen: bewusst KEIN Automatismus. Eine Sicherung einzuspielen heißt,
// den heutigen Stand zu überschreiben — das passiert nicht auf Zuruf eines
// Skripts, sondern von Hand und mit Blick auf die Datei.

const fs = require("fs");
const path = require("path");
const crm = require("../lib/crm.js");

// Reihenfolge = Abhängigkeit: Erst die Tabellen, auf die andere zeigen.
// Beim Zurückspielen von Hand ist das die Reihenfolge, in der es klappt.
const TABELLEN = [
  "profiles", "pipeline_stages", "finanz_einstellungen", "content_einstellungen",
  "firmen", "kontakte", "deals", "projekte", "aktivitaeten", "aufgaben",
  "call_listen", "call_listen_eintraege", "dokumente",
  "buchungen", "belege", "monats_exporte",
  "content_posts", "content_ideen", "content_zahlen", "content_ziele",
  "content_kanalstand", "content_post_links",
  "kampagnen", "kampagnen_zahlen",
  "zeiterfassung", "schema_migrationen",
];

const zeitstempel = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

(async () => {
  const i = process.argv.indexOf("--ordner");
  const ordner = i > 0 && process.argv[i + 1]
    ? process.argv[i + 1]
    : path.join(__dirname, "..", "sicherungen");
  fs.mkdirSync(ordner, { recursive: true });

  const daten = {};
  let gesamt = 0, fehlend = [];
  for (const t of TABELLEN) {
    try {
      // system() umgeht die Zeilenrechte bewusst: eine Sicherung, die nur die
      // Zeilen EINES Nutzers enthält, ist keine Sicherung.
      const { rows } = await crm.system(`select * from public.${t}`);
      daten[t] = rows;
      gesamt += rows.length;
      console.log(`  ${t.padEnd(24)} ${String(rows.length).padStart(6)} Zeilen`);
    } catch (e) {
      fehlend.push(t);
      console.log(`  ${t.padEnd(24)}      — ${String(e.message).slice(0, 50)}`);
    }
  }

  const datei = path.join(ordner, `sicherung-${zeitstempel()}.json`);
  fs.writeFileSync(datei, JSON.stringify({
    erstellt: new Date().toISOString(),
    hinweis: "Vollsicherung der Flowstate-Datenbank. Enthält personenbezogene Daten — nicht ins Git, nicht in den Vault.",
    tabellen: Object.fromEntries(Object.entries(daten).map(([t, r]) => [t, r.length])),
    daten,
  }, null, 1));

  const mb = (fs.statSync(datei).size / 1048576).toFixed(2);
  console.log(`\n✅ ${gesamt} Zeilen aus ${Object.keys(daten).length} Tabellen`);
  if (fehlend.length) console.log(`⚠️  nicht gelesen: ${fehlend.join(", ")}`);
  console.log(`   ${datei}  (${mb} MB)`);
  process.exit(0);
})();
