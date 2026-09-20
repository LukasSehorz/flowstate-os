#!/usr/bin/env node
// Ein Outlook.com-/Hotmail-Postfach an den Belegeingang haengen.
//
//   docker exec -w /app flowstate-dashboard node scripts/outlook-anmelden.js --name hotmail --client-id <App-ID>
//
// Das Skript nennt einen Code und eine Adresse (microsoft.com/devicelogin).
// Dort meldet sich der Postfach-Inhaber an und tippt den Code ein. Sobald das
// geschehen ist, schreibt das Skript die Zugangsdatei nach
//   <GWS_HOME>/.config/gws-cli/postfaecher/<name>/outlook.json
// und der naechste Postfachlauf nimmt das Konto mit.
//
// Die App-ID kommt aus dem Microsoft-Entra-Portal (entra.microsoft.com):
// App-Registrierungen -> Neue Registrierung -> "Nur persoenliche
// Microsoft-Konten" -> Registrieren. Dann unter Authentifizierung
// "Oeffentliche Clientflows zulassen" auf Ja. Die "Anwendungs-ID (Client)"
// ist der Wert fuer --client-id.
const fs = require("fs");
const path = require("path");
const outlook = require("../lib/outlook-direkt.js");
const gmail = require("../lib/gmail-direkt.js");

const args = process.argv.slice(2);
const wert = (n) => { const i = args.indexOf(n); return i >= 0 ? String(args[i + 1] || "") : ""; };
const name = wert("--name") || "hotmail";
const clientId = wert("--client-id");
if (!/^[a-z0-9_.-]+$/i.test(name)) { console.error("--name: nur Buchstaben, Ziffern, Punkt, Strich."); process.exit(2); }
if (!clientId) { console.error("Es fehlt --client-id <Anwendungs-ID aus der App-Registrierung>."); process.exit(2); }

(async () => {
  const d = await outlook.geraetecodeAnfordern(clientId);
  console.log(`\nIm Browser öffnen: ${d.verification_uri}\nCode eingeben:     ${d.user_code}\n\nMit dem Konto anmelden, dessen Postfach dran soll. Ich warte (bis ${Math.round((d.expires_in || 900) / 60)} Minuten) …`);
  const t = await outlook.geraetecodeWarten(clientId, d);
  const ordner = path.join(gmail.POSTFAECHER, name);
  fs.mkdirSync(ordner, { recursive: true });
  const datei = path.join(ordner, "outlook.json");
  fs.writeFileSync(datei, JSON.stringify({ client_id: clientId, refresh_token: t.refresh_token }, null, 2), { mode: 0o600 });
  const k = outlook.konto(datei, name);
  const adresse = await k.adresse();
  if (adresse) fs.writeFileSync(datei, JSON.stringify({ client_id: clientId, refresh_token: t.refresh_token, adresse }, null, 2), { mode: 0o600 });
  console.log(`\nAngeschlossen: ${adresse || "(Adresse nicht abrufbar)"} als "${name}" — ${datei}`);
  console.log(`Nur bestimmte Absender? Dann eine Datei ${path.join(ordner, "absender.txt")} anlegen, je Zeile ein Absender (Adresse oder Domäne).`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
