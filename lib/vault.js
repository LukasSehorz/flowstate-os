// lib/vault.js — die Schreib-Hand ins zweite Gehirn (Obsidian-Vault).
//
// Warum getrennt: Der Vault synchronisiert sich selbst ueber /root/vault-sync.sh
// (Host-Cron, alle 5 Min: git pull --rebase, add -A, commit, push nach GitHub ->
// Obsidian). Wir muessen Git also NICHT anfassen — was hier in den Vault
// geschrieben wird, ist von selbst in Obsidian. Diese Datei kuemmert sich nur
// ums sichere Schreiben in EINEN erlaubten Unterordner.
//
// DSGVO (REGELN.md §7 + .gitignore "Kundendaten nie in Git"): In den Git-Vault
// duerfen nur Aggregate und interne Notizen — NIE Kundendaten (Namen, Adressen,
// Mailinhalte). Das ist eine Regel der Firma, kein technisches Limit. Wer PII
// hineinschreiben will, muss den Kanal vorher klaeren (server-lokal vs. Git).

const fs = require("fs");
const path = require("path");

const VAULT = process.env.VAULT_PATH || "/vault";
// Nur dieser Unterordner ist beschreibbar (im Compose als :rw gemountet).
const UNTERORDNER = process.env.VAULT_SCHREIB || "chronik";
const WURZEL = path.resolve(VAULT, UNTERORDNER);

// Kein Ausbrechen aus dem Schreibbereich (kein ../, kein absoluter Pfad).
function sichererPfad(rel) {
  const voll = path.resolve(WURZEL, rel);
  if (voll !== WURZEL && !voll.startsWith(WURZEL + path.sep)) {
    throw new Error("Pfad ausserhalb des Schreibbereichs: " + rel);
  }
  return voll;
}

function schreibbar() {
  try {
    fs.mkdirSync(WURZEL, { recursive: true });
    fs.accessSync(WURZEL, fs.constants.W_OK);
    return true;
  } catch { return false; }
}

function schreibe(rel, inhalt) {
  const voll = sichererPfad(rel);
  fs.mkdirSync(path.dirname(voll), { recursive: true });
  fs.writeFileSync(voll, inhalt, "utf-8");
  return voll;
}

function anhaenge(rel, inhalt) {
  const voll = sichererPfad(rel);
  fs.mkdirSync(path.dirname(voll), { recursive: true });
  fs.appendFileSync(voll, inhalt, "utf-8");
  return voll;
}

module.exports = { schreibe, anhaenge, schreibbar, sichererPfad, WURZEL, UNTERORDNER };
