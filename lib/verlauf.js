// Chatverlauf mit Alexandra — dauerhaft auf Platte, je Person eine Datei.
// Vorher lag der Verlauf nur in der Sitzung und war bei 24 Nachrichten
// abgeschnitten; sichtbar war er nie. Jetzt bleibt alles erhalten und wird
// beim Oeffnen der Seite wieder angezeigt.
const fs = require("fs");
const path = require("path");

// Wieviele Nachrichten als Zusammenhang an Hermes gehen. Angezeigt wird alles —
// mitgeschickt nur das Juengste, sonst waechst der Aufruf ins Unendliche.
const KONTEXT = 24;

function ordner(datenPfad) {
  const d = path.join(datenPfad, "chat");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

// Eine Datei je Person. Ohne persoenliche Anmeldung landet alles in "gemeinsam".
function datei(datenPfad, nutzer) {
  const kennung = nutzer && nutzer.id ? String(nutzer.id) : "gemeinsam";
  return path.join(ordner(datenPfad), kennung.replace(/[^a-zA-Z0-9_-]/g, "") + ".jsonl");
}

function lesen(datenPfad, nutzer, grenze = 400) {
  const f = datei(datenPfad, nutzer);
  if (!fs.existsSync(f)) return [];
  const zeilen = fs.readFileSync(f, "utf-8").split("\n").filter(Boolean);
  return zeilen.slice(-grenze).map((z) => { try { return JSON.parse(z); } catch { return null; } }).filter(Boolean);
}

function anhaengen(datenPfad, nutzer, rolle, text) {
  const eintrag = { zeit: new Date().toISOString(), rolle, text };
  fs.appendFileSync(datei(datenPfad, nutzer), JSON.stringify(eintrag) + "\n", "utf-8");
  return eintrag;
}

// Der Zusammenhang fuer Hermes: nur Rolle und Text, nur die letzten KONTEXT Stueck.
function kontext(datenPfad, nutzer) {
  return lesen(datenPfad, nutzer, KONTEXT).map((n) => ({
    role: n.rolle === "user" ? "user" : "assistant", content: n.text,
  }));
}

function leeren(datenPfad, nutzer) {
  const f = datei(datenPfad, nutzer);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

module.exports = { lesen, anhaengen, kontext, leeren, KONTEXT };
