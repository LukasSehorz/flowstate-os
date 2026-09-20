#!/usr/bin/env node
// Welche Postfaecher haengen am Belegeingang? Fragt jedes Konto nach seiner
// Adresse — damit man nicht raten muss, ob "Hauptkonto" Lukas' SvH-Postfach
// ist oder noch das alte flowstate-ai.net.
//
// Auf dem Server:
//   docker exec -w /app flowstate-dashboard node scripts/postfach-konten.js
const gmail = require("../lib/gmail-direkt.js");

(async () => {
  const konten = [];
  if (gmail.bereit()) konten.push(gmail.haupt); else console.log("Hauptkonto: kein Zugang (" + gmail.haupt.tokenPfad + ")");
  for (const k of gmail.postfaecher()) konten.push(k);
  try {
    const outlook = require("../lib/outlook-direkt.js");
    const path = require("path"), fs = require("fs");
    for (const n of fs.readdirSync(gmail.POSTFAECHER).sort()) {
      const k = outlook.konto(path.join(gmail.POSTFAECHER, n, "outlook.json"), n + " (Outlook)");
      if (k.bereit()) konten.push(k);
    }
  } catch { /* kein Ordner */ }
  if (!konten.length) { console.log("Kein Postfach angeschlossen. Ordner für weitere: " + gmail.POSTFAECHER); process.exit(1); }
  for (const k of konten) {
    const adresse = await k.adresse();
    console.log(`${k.name || "Hauptkonto"}: ${adresse || "Adresse nicht abrufbar (Zugang abgelaufen?)"}  [${k.tokenPfad}]`);
  }
  console.log(`\nOrdner für weitere Postfächer: ${gmail.POSTFAECHER}/<name>/token.json`);
})().catch((e) => { console.error(e.message); process.exit(1); });
