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

// Bewertet, wie gut ein Name zur Anfrage passt. Hoeher = besser. So gewinnt
// "Jannik vom Hofe" (erstes Wort exakt) klar gegen "Janni" (schwacher Praefix).
function bewerte(name, q) {
  const n = String(name || "").toLowerCase().trim();
  if (!n || !q) return 0;
  const w = n.split(/\s+/);
  if (n === q) return 100;
  if (w[0] === q) return 95;                                   // "jannik" == erstes Wort
  if (w.includes(q)) return 90;                                // exaktes Wort irgendwo
  if (n.startsWith(q) && q.length >= 3) return 80;             // "jannik vom hofe" ~ "jannik"
  if (w.some((x) => x.startsWith(q) && q.length >= 4)) return 55;
  if (q.startsWith(w[0]) && w[0].length >= 4) return 35;       // schwach: "Janni" in "jannik"
  return 0;
}

// Besten Treffer aus einer Kandidatenliste (name-tragende Objekte) waehlen.
function bester(liste, q, feld = "name") {
  let top = null, topScore = 0;
  for (const k of liste) {
    const s = Math.max(bewerte(k[feld], q), bewerte(k.notify, q));
    if (s > topScore) { topScore = s; top = k; }
  }
  return topScore >= 55 ? top : null;
}

// Findet per Name (ganz/teilweise/Vorname) oder direkt per Nummer.
// Reihenfolge: erst das manuelle Buch (kann Interne markieren/ueberschreiben),
// dann die WhatsApp-Kontakte (automatisch, keine Nummer noetig).
function finde(nameOderNr) {
  const q = String(nameOderNr || "").toLowerCase().trim();
  if (!q) return null;

  const manuell = bester(alle().filter((k) => normNr(k.nummer)), q);
  if (manuell) {
    return { name: manuell.name, nummer: normNr(manuell.nummer), intern: Boolean(manuell.intern) || istInternerName(manuell.name) };
  }

  // Direkte Nummer angegeben?
  const nr = normNr(nameOderNr);
  if (nr.length >= 8) return { name: nameOderNr, nummer: nr, intern: false };

  // Aus den WhatsApp-Kontakten aufloesen (bester Treffer).
  const wa = bester(waKontakte(), q);
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
