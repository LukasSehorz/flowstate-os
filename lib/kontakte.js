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
// Gruppenverzeichnis der Bruecke (jid -> {name}), "<id>@g.us".
const WA_GRUPPEN_DATEI = path.join(process.env.WA_DIR || "/wa", "gruppen.json");

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

// WhatsApp-Kontakte laden. Gespeicherter Name und Profilname bleiben GETRENNT
// (Fix 24.07.): Vorher fiel "name" auf "notify" zurueck. Dadurch konnte ein
// fremdgewaehlter Profilname einen echten Adressbuch-Namen ueberstimmen —
// jemand, der sich selbst "jannik" nennt, gewann mit 100 Punkten gegen den
// gespeicherten "jannik vom hofe" (95). Die WhatsApp ging an die falsche Person.
function waKontakte() {
  let roh;
  try { roh = JSON.parse(fs.readFileSync(WA_KONTAKTE, "utf-8")); } catch { return []; }
  const liste = [];
  for (const [jid, v] of Object.entries(roh)) {
    // "@lid" ist eine WhatsApp-INTERNE Kennung, KEINE Telefonnummer (Fix 24.07.).
    // Vorher wurde stumpf alles vor dem "@" als Nummer genommen; daraus baute die
    // Bruecke "<lid>@s.whatsapp.net" — eine Adresse, die es nicht gibt. Die
    // Nachricht galt als gesendet, kam nie an und tauchte in keinem Chat auf.
    // Die Bruecke legt bei LID-Eintraegen "pn" mit dem echten Nummern-JID dazu;
    // fehlt das, ist der Eintrag zum Schreiben wertlos und fliegt raus.
    const nummerJid = jid.endsWith("@lid") ? String(v.pn || "") : jid;
    if (!nummerJid.endsWith("@s.whatsapp.net")) continue;
    const nummer = normNr(nummerJid.split("@")[0]);
    if (nummer.length < 8) continue;
    liste.push({ jid, nummer, name: v.name || "", notify: v.notify || "" });
  }
  return liste.filter((k) => k.name || k.notify);
}

// ------------------------------------------------------------ Gruppen
//
// Gruppen sind heikel: Eine Nachricht dorthin sehen viele Leute auf einmal, und
// im Adressbuch stehen auch private Gruppen (Familie, Freunde). Deshalb gilt
// eine FREIGABELISTE (Lukas 24.07.): Nur ausdruecklich genannte Arbeitsgruppen
// sind ueberhaupt adressierbar; alle anderen existieren fuer Alexandra nicht.
// Gepflegt ueber WA_GRUPPEN in der .env (Namen, mit Komma getrennt).
function freigegebeneGruppen() {
  return (process.env.WA_GRUPPEN || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Alle FREIGEGEBENEN Gruppen aus dem Verzeichnis der Bruecke.
function gruppen() {
  const erlaubt = freigegebeneGruppen();
  if (!erlaubt.length) return [];
  let roh;
  try { roh = JSON.parse(fs.readFileSync(WA_GRUPPEN_DATEI, "utf-8")); } catch { return []; }
  return Object.entries(roh)
    .filter(([jid, g]) => jid.endsWith("@g.us") && g && g.name)
    // Freigabe exakt am Namen — kein "faengt an mit", sonst rutscht
    // "Flowstate privat" ueber die Freigabe "Flowstate" mit hinein.
    .filter(([, g]) => erlaubt.includes(String(g.name).trim().toLowerCase()))
    .map(([jid, g]) => ({ jid, name: g.name, gruppe: true }));
}

// Gruppe per Name finden — ausschliesslich unter den freigegebenen.
// Mehrdeutigkeit wird wie bei Personen gemeldet, nicht geraten.
function findeGruppe(name) {
  const q = String(name || "").toLowerCase().trim();
  if (!q) return null;
  const treffer = entscheide(rangliste(gruppen(), (g) => bewerte(g.name, q)));
  if (!treffer) return null;
  if (treffer.mehrdeutig) return treffer;
  return { name: treffer.name, jid: treffer.jid, gruppe: true, intern: true };
}

// Anzeigename zu einer JID — die umgekehrte Richtung zu finde(): Bei
// EINGEHENDEN Nachrichten haben wir die Kennung und brauchen den Namen.
// Bei Gruppen der Gruppenname, bei Personen der Adressbuchname.
function nameZuJid(jid, rueckfall = "") {
  const id = String(jid || "");
  if (id.endsWith("@g.us")) {
    try {
      const roh = JSON.parse(fs.readFileSync(WA_GRUPPEN_DATEI, "utf-8"));
      if (roh[id]?.name) return roh[id].name;
    } catch {}
    return rueckfall || "einer Gruppe";
  }
  try {
    const roh = JSON.parse(fs.readFileSync(WA_KONTAKTE, "utf-8"));
    const v = roh[id] || {};
    if (v.name) return v.name;
    if (v.notify) return v.notify;
  } catch {}
  return rueckfall || id.split("@")[0];
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

const SCHWELLE = 55;

// Alle Kandidaten ueber der Schwelle, beste zuerst.
function rangliste(liste, punkte) {
  return liste.map((k) => ({ k, s: punkte(k) })).filter((x) => x.s >= SCHWELLE).sort((a, b) => b.s - a.s);
}

// Gewinner ziehen — oder Mehrdeutigkeit melden, wenn mehrere VERSCHIEDENE
// Nummern gleich gut passen. Bei zwei "Janni" im Adressbuch wird nicht geraten,
// sondern nachgefragt: eine Nachricht an die falsche Person ist nicht rueckholbar.
// Identitaet eines Treffers: bei Personen die Nummer, bei Gruppen die JID.
// (Ohne das waeren zwei gleichnamige Gruppen "gleich" und wuerden geraten.)
const kennung = (k) => normNr(k.nummer) || String(k.jid || "");

function entscheide(rang) {
  if (!rang.length) return null;
  const top = rang[0];
  const andere = rang.filter((x) => x.s === top.s && kennung(x.k) !== kennung(top.k));
  if (andere.length) {
    return { mehrdeutig: [top, ...andere].slice(0, 4).map((x) => ({
      name: x.k.name || x.k.notify, nummer: normNr(x.k.nummer), jid: x.k.jid || "",
    })) };
  }
  return top.k;
}

// Besten Treffer waehlen — in ZWEI Durchgaengen (Fix 24.07.):
// 1. der gespeicherte Name, den Lukas selbst vergeben hat — der ist massgeblich;
// 2. erst wenn der nichts hergibt, der Profilname, den sich der Kontakt selbst
//    gibt. So kann ein fremder "jannik" nie mehr den echten Jannik verdraengen.
function bester(liste, q, feld = "name") {
  const nachName = entscheide(rangliste(liste, (k) => bewerte(k[feld], q)));
  if (nachName) return nachName;
  return entscheide(rangliste(liste, (k) => bewerte(k.notify, q)));
}

// Findet per Name (ganz/teilweise/Vorname) oder direkt per Nummer.
// Reihenfolge: erst das manuelle Buch (kann Interne markieren/ueberschreiben),
// dann die WhatsApp-Kontakte (automatisch, keine Nummer noetig).
function finde(nameOderNr) {
  const q = String(nameOderNr || "").toLowerCase().trim();
  if (!q) return null;

  const manuell = bester(alle().filter((k) => normNr(k.nummer)), q);
  if (manuell?.mehrdeutig) return manuell;
  if (manuell) {
    return { name: manuell.name, nummer: normNr(manuell.nummer), intern: Boolean(manuell.intern) || istInternerName(manuell.name) };
  }

  // Direkte Nummer angegeben?
  const nr = normNr(nameOderNr);
  if (nr.length >= 8) return { name: nameOderNr, nummer: nr, intern: false };

  // Aus den WhatsApp-Kontakten aufloesen (bester Treffer).
  const wa = bester(waKontakte(), q);
  if (wa?.mehrdeutig) return wa;
  if (wa) {
    const name = wa.name || wa.notify;
    return { name, nummer: wa.nummer, intern: istInternerName(name) };
  }

  return null;
}

function hinzufuegen({ name, nummer, intern = false }) {
  const liste = alle().filter((k) => (k.name || "").toLowerCase() !== String(name).toLowerCase());
  liste.push({ name, nummer: normNr(nummer), intern: Boolean(intern) });
  speichern(liste);
  return liste;
}

module.exports = { alle, finde, hinzufuegen, speichern, normNr, gruppen, findeGruppe,
  freigegebeneGruppen, nameZuJid };
