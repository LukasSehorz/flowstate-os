// lib/kontakte.js — kleines Kontaktbuch (Name -> WhatsApp-Nummer, intern?).
//
// Damit Alexandra "schick Jannik eine WhatsApp" ausfuehren kann, muss sie den
// Namen in eine Nummer aufloesen. Interne Kontakte (Jannik, Team) duerfen ohne
// Rueckfrage angeschrieben werden — externe erst nach Freigabe (REGELN.md).
//
// Liegt als JSON unter DATA_PATH/kontakte.json (persistent). Format:
//   [{ "name": "Jannik vom Hofe", "nummer": "49170...", "intern": true }]

const fs = require("fs");
const path = require("path");

const DATA = process.env.DATA_PATH || path.join(__dirname, "..", "data");
const DATEI = path.join(DATA, "kontakte.json");

const normNr = (s) => String(s || "").replace(/[^0-9]/g, "");

function alle() {
  try { return JSON.parse(fs.readFileSync(DATEI, "utf-8")); }
  catch {
    try { return JSON.parse(process.env.KONTAKTE || "[]"); } catch { return []; }
  }
}

function speichern(liste) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(DATEI, JSON.stringify(liste, null, 2), "utf-8"); return true; }
  catch { return false; }
}

// Findet per Name (ganz/teilweise/Vorname) oder direkt per Nummer.
function finde(nameOderNr) {
  const q = String(nameOderNr || "").toLowerCase().trim();
  if (!q) return null;
  const liste = alle();
  const treffer =
    liste.find((k) => (k.name || "").toLowerCase() === q) ||
    liste.find((k) => (k.name || "").toLowerCase().includes(q)) ||
    liste.find((k) => q.includes((k.name || "").toLowerCase().split(" ")[0]) && (k.name || "").length > 2);
  if (treffer && normNr(treffer.nummer)) return { name: treffer.name, nummer: normNr(treffer.nummer), intern: Boolean(treffer.intern) };
  const nr = normNr(nameOderNr);
  if (nr.length >= 8) return { name: nameOderNr, nummer: nr, intern: false }; // direkte Nummer -> extern
  return null;
}

function hinzufuegen({ name, nummer, intern = false }) {
  const liste = alle().filter((k) => (k.name || "").toLowerCase() !== String(name).toLowerCase());
  liste.push({ name, nummer: normNr(nummer), intern: Boolean(intern) });
  speichern(liste);
  return liste;
}

module.exports = { alle, finde, hinzufuegen, speichern, normNr };
