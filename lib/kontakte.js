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
// Von der WhatsApp-Bruecke gepflegte Kontaktliste (jid -> {name, notify}).
const WA_KONTAKTE = path.join(process.env.WA_DIR || "/wa", "contacts.json");

const normNr = (s) => String(s || "").replace(/[^0-9]/g, "");

// Wer darf ohne Rueckfrage angeschrieben werden (Jannik, Team). Nur Namen —
// die Nummer kommt aus den WhatsApp-Kontakten.
function internNamen() {
  return (process.env.INTERN_WA_NAMEN || "jannik")
    .toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
}
function istInternerName(name) {
  const n = String(name || "").toLowerCase();
  return internNamen().some((i) => n.includes(i));
}

// WhatsApp-Kontakte laden und nach Name/Notify durchsuchbar machen.
function waKontakte() {
  let roh;
  try { roh = JSON.parse(fs.readFileSync(WA_KONTAKTE, "utf-8")); } catch { return []; }
  return Object.entries(roh).map(([jid, v]) => ({
    jid, nummer: jid.split("@")[0], name: v.name || v.notify || "", notify: v.notify || "",
  })).filter((k) => k.name);
}

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

function passt(name, q) {
  const n = String(name || "").toLowerCase();
  if (!n) return false;
  return n === q || n.includes(q) || (q.includes(n.split(" ")[0]) && n.split(" ")[0].length > 2);
}

// Findet per Name (ganz/teilweise/Vorname) oder direkt per Nummer.
// Reihenfolge: erst das manuelle Buch (kann Interne markieren/ueberschreiben),
// dann die WhatsApp-Kontakte (automatisch, keine Nummer noetig).
function finde(nameOderNr) {
  const q = String(nameOderNr || "").toLowerCase().trim();
  if (!q) return null;

  const manuell = alle().find((k) => passt(k.name, q));
  if (manuell && normNr(manuell.nummer)) {
    return { name: manuell.name, nummer: normNr(manuell.nummer), intern: Boolean(manuell.intern) || istInternerName(manuell.name) };
  }

  // Direkte Nummer angegeben?
  const nr = normNr(nameOderNr);
  if (nr.length >= 8) return { name: nameOderNr, nummer: nr, intern: false };

  // Aus den WhatsApp-Kontakten aufloesen.
  const wa = waKontakte().find((k) => passt(k.name, q) || passt(k.notify, q));
  if (wa) return { name: wa.name, nummer: wa.nummer, intern: istInternerName(wa.name) };

  return null;
}

function hinzufuegen({ name, nummer, intern = false }) {
  const liste = alle().filter((k) => (k.name || "").toLowerCase() !== String(name).toLowerCase());
  liste.push({ name, nummer: normNr(nummer), intern: Boolean(intern) });
  speichern(liste);
  return liste;
}

module.exports = { alle, finde, hinzufuegen, speichern, normNr };
