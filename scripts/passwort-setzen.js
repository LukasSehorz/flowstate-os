#!/usr/bin/env node
// Ein neues Passwort fuer ein Konto setzen — wenn jemand seins vergessen hat.
//
//   node scripts/passwort-setzen.js ioannis@svhconsult.de "neuesPasswort"
//   node scripts/passwort-setzen.js --liste          zeigt alle Konten
//
// WARUM ES DAS GIBT (06.09.2026): Ioannis hatte sein Passwort vergessen. Das
// ALTE laesst sich nicht herausfinden — Supabase legt in auth.users nur
// crypt(passwort, gen_salt('bf')) ab, eine Einbahnstrasse. Das ist richtig so:
// Waere das Passwort lesbar, koennte jeder mit Datenbankzugriff sich als
// dieser Mensch anmelden. Es geht also nur ein NEUES.
//
// Bis heute konnte das nur jeder fuer sich selbst (Einstellungen ->
// Passwort aendern, server.js), und das hilft genau dann nicht, wenn man
// nicht mehr hineinkommt. Diesen Weg schliesst das Skript.
//
// Der Riegel ist der Serverzugang: Wer das hier ausfuehren kann, hat ohnehin
// die Datenbank. Deshalb keine zweite Anmeldung, aber zwei Wachen: Das Konto
// muss es geben (kein stilles Anlegen durch einen Tippfehler in der Adresse),
// und das Passwort muss mindestens 10 Zeichen haben.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const envPfad = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPfad)) {
  for (const zeile of fs.readFileSync(envPfad, "utf-8").split("\n")) {
    const t = zeile.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const MINDESTLAENGE = 10;

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL fehlt. Auf dem Server:  docker exec flowstate-dashboard node scripts/passwort-setzen.js …");
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const [email, passwort] = process.argv.slice(2);

    if (!email || email === "--liste") {
      const { rows } = await c.query(
        `select u.email, p.name, p.rolle, p.aktiv,
                to_char(u.updated_at, 'DD.MM.YYYY') as geaendert
           from auth.users u join public.profiles p on p.id = u.id
          order by p.rolle, p.name`);
      console.log("\nKonten:\n");
      for (const r of rows) {
        console.log(`  ${r.email.padEnd(34)} ${(r.name || "").padEnd(18)} ${r.rolle.padEnd(12)}`
          + `${r.aktiv ? "aktiv" : "STILLGELEGT"}   zuletzt geaendert ${r.geaendert || "?"}`);
      }
      console.log("\nNeues Passwort setzen:\n  node scripts/passwort-setzen.js <E-Mail> \"<neues Passwort>\"\n");
      return;
    }

    if (!passwort) {
      console.error("Kein Passwort angegeben.\n  node scripts/passwort-setzen.js <E-Mail> \"<neues Passwort>\"");
      process.exit(1);
    }
    if (passwort.length < MINDESTLAENGE) {
      console.error(`Zu kurz: mindestens ${MINDESTLAENGE} Zeichen.`);
      process.exit(1);
    }

    // Erst nachsehen, ob es das Konto gibt. Ein Tippfehler in der Adresse soll
    // nicht in einem "0 Zeilen geaendert" enden, das wie Erfolg aussieht.
    const { rows: [wer] } = await c.query(
      `select u.id, p.name, p.rolle, p.aktiv
         from auth.users u join public.profiles p on p.id = u.id
        where lower(u.email) = lower($1)`, [email.trim()]);
    if (!wer) {
      console.error(`Kein Konto mit "${email}". Alle Konten zeigt:  node scripts/passwort-setzen.js --liste`);
      process.exit(1);
    }

    const { rowCount } = await c.query(
      `update auth.users
          set encrypted_password = crypt($2, gen_salt('bf')), updated_at = now()
        where id = $1`, [wer.id, passwort]);
    if (rowCount !== 1) { console.error("Nichts geaendert — bitte melden."); process.exit(1); }

    console.log(`\nNeues Passwort gesetzt fuer ${wer.name} (${email}, ${wer.rolle}).`);
    if (!wer.aktiv) console.log("Hinweis: Das Konto ist stillgelegt — anmelden kann er sich damit noch nicht.");
    console.log("Bitte ihm das Passwort auf einem anderen Weg mitteilen als per Mail an dieses Konto,");
    console.log("und ihn bitten, es unter Einstellungen -> Passwort aendern gleich selbst zu aendern.\n");
  } finally { await c.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
