// lib/vault.js — die Schreib-Hand ins zweite Gehirn (Obsidian-Vault).
//
// Warum getrennt: Der Vault synchronisiert sich selbst ueber /root/vault-sync.sh
// (Host-Cron, alle 5 Min: git pull --rebase, add -A, commit, push nach GitHub ->
// Obsidian). Wir muessen Git also NICHT anfassen — was hier in den Vault
// geschrieben wird, ist von selbst in Obsidian. Diese Datei kuemmert sich nur
// ums sichere Schreiben in die ERLAUBTEN Unterordner (die :rw gemountet sind).
//
// Zwei Schreibbereiche:
//   chronik/  — Aggregatzahlen, keine PII.
//   eingang/  — Kanal-Inhalte (Mail, spaeter WhatsApp/Telegram). Enthaelt PII.
// Entscheidung Lukas 22.07.: Kanal-Inhalte duerfen ins (private) Repo, damit
// Alexandra jederzeit — auch mobil — darauf zugreifen kann.

const fs = require("fs");
const path = require("path");

const VAULT = process.env.VAULT_PATH || "/vault";
const ERLAUBT = (process.env.VAULT_SCHREIB || "chronik,eingang")
  .split(",").map((s) => s.trim()).filter(Boolean);

const wurzel = (ordner) => path.resolve(VAULT, ordner);

// Kein Ausbrechen: der Zielpfad muss in einem erlaubten Ordner liegen.
function sichererPfad(rel) {
  const voll = path.resolve(VAULT, rel);
  const ok = ERLAUBT.some((o) => {
    const w = wurzel(o);
    return voll === w || voll.startsWith(w + path.sep);
  });
  if (!ok) throw new Error("Pfad ausserhalb der erlaubten Schreibbereiche: " + rel);
  return voll;
}

// Ohne Argument: sind ALLE erlaubten Ordner beschreibbar? Mit Argument: nur der.
function schreibbar(ordner) {
  const ziele = ordner ? [ordner] : ERLAUBT;
  return ziele.every((o) => {
    try {
      const w = wurzel(o);
      fs.mkdirSync(w, { recursive: true });
      fs.accessSync(w, fs.constants.W_OK);
      return true;
    } catch { return false; }
  });
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

function lesen(rel) {
  try { return fs.readFileSync(sichererPfad(rel), "utf-8"); } catch { return ""; }
}

module.exports = { schreibe, anhaenge, lesen, schreibbar, sichererPfad, ERLAUBT, VAULT };
