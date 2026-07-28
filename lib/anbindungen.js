// lib/anbindungen.js — was ist mit dem OS verbunden, und was nicht?
//
// Warum es das gibt (26.07.2026): Jannik fragte, ob Meta-Ads schon angebunden
// ist. Sein Assistent schaute ins Repo, fand keine Zugangsdaten und antwortete
// "nicht verbunden" — obwohl die Anbindung fertig gebaut ist und auf dem Server
// laeuft. Die Wahrheit steht naemlich in der .env auf dem SERVER, und die ist
// aus dem Code heraus unsichtbar. Ergebnis: Man arbeitet doppelt oder baut
// etwas nach, das es laengst gibt.
//
// Hier steht deshalb EINE Liste aller Anbindungen mit einer Pruefung, die
// ueberall laeuft. Wichtig: Es werden nur JA/NEIN und niemals Werte
// zurueckgegeben — kein Token, kein Passwort, kein Schluessel. Die Ausgabe darf
// gefahrlos in einem Screenshot landen (was hier schon zweimal schiefging).
//
// "eingerichtet: false" bedeutet NUR "auf DIESER Maschine nicht konfiguriert".
// Lokal fehlen die meisten Zugaenge absichtlich — gearbeitet wird mit dem
// Server. Wer wissen will, was WIRKLICH laeuft, fragt den Server.

const fs = require("fs");
const path = require("path");

const da = (...namen) => namen.every((n) => Boolean(process.env[n]));

// Reihenfolge = Wichtigkeit fuers Tagesgeschaeft.
const ANBINDUNGEN = [
  { id: "crm", name: "CRM-Datenbank (Supabase)", zweck: "Leads, Kunden, Deals, Aufgaben, Zeiterfassung",
    pruefe: () => da("DATABASE_URL"), schluessel: ["DATABASE_URL"] },

  { id: "kalender", name: "Google Kalender & Gmail", zweck: "Termine lesen/eintragen, Posteingang, Mailversand",
    pruefe: () => { try { return fs.existsSync(path.join(process.env.HOME || "/gws-home", ".config", "gws-cli")); } catch { return false; } },
    schluessel: ["(OAuth-Token unter ~/.config/gws-cli)"] },

  { id: "meta", name: "Meta Ads", zweck: "Kampagnen-Kennzahlen (Ausgaben, Leads, ROAS) im STAND",
    pruefe: () => da("META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"), schluessel: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] },

  // Lexware Office stand hier bis zum 28.07. Bewusste Entscheidung: Belege und
  // Rechnungen werden im OS selbst gefuehrt und archiviert, der Monatsordner geht
  // an die Steuerberaterin. Eine zweite Ablage waere eine zweite Wahrheit.

  { id: "whatsapp", name: "WhatsApp", zweck: "Nachrichten senden und lesen, freigegebene Gruppen",
    pruefe: () => { try { return fs.existsSync(path.join(process.env.WA_DIR || "/wa", "auth")); } catch { return false; } },
    schluessel: ["(Kopplung ueber QR unter /whatsapp)"] },

  { id: "telegram", name: "Telegram-Bot", zweck: "Alexandra per Chat und Sprachnachricht",
    pruefe: () => da("TELEGRAM_BOT_TOKEN"), schluessel: ["TELEGRAM_BOT_TOKEN"] },

  { id: "stimme", name: "ElevenLabs", zweck: "Alexandras Stimme",
    pruefe: () => da("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"), schluessel: ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"] },

  { id: "modell", name: "Sprachmodell (Anthropic)", zweck: "Verstehen, Formulieren, Verdichten",
    pruefe: () => da("SCHNELL_API_KEY"), schluessel: ["SCHNELL_API_KEY"] },

  { id: "hermes", name: "Hermes-Agent", zweck: "lange Arbeit, Routinen, Kommandos ans System",
    pruefe: () => da("HERMES_CHAT_URL"), schluessel: ["HERMES_CHAT_URL"] },

  { id: "suche", name: "Websuche (Serper/Google)", zweck: "schnelles Nachschlagen; ohne Schluessel nur Wikipedia",
    pruefe: () => da("SERPER_API_KEY"), schluessel: ["SERPER_API_KEY"] },

  { id: "vault", name: "Zweites Gehirn (Vault)", zweck: "Firmenwissen, Zufluss aus Mail/WhatsApp/Telegram",
    pruefe: () => { try { return fs.existsSync(process.env.VAULT_PATH || "/vault"); } catch { return false; } },
    schluessel: ["VAULT_PATH"] },
];

// Liefert je Anbindung { id, name, zweck, eingerichtet, schluessel }.
// Keine Werte, nur ja/nein — die Ausgabe ist bewusst screenshot-sicher.
function stand() {
  return ANBINDUNGEN.map((a) => {
    let eingerichtet = false;
    try { eingerichtet = Boolean(a.pruefe()); } catch { eingerichtet = false; }
    return { id: a.id, name: a.name, zweck: a.zweck, eingerichtet, schluessel: a.schluessel };
  });
}

module.exports = { stand, ANBINDUNGEN };
