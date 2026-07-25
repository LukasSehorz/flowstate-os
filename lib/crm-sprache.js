// lib/crm-sprache.js — CRM-Arbeit per Sprache (Phase 4, 25.07.).
//
// Warum es diese Datei gibt: Alexandra konnte bisher ueber das CRM nur REDEN.
// Kalender, Aufgaben, Mail und WhatsApp haengen an der Sprachschicht, das CRM
// nicht — auf "notier bei Krotzer, dass sie erst im September Budget haben"
// blieb nur eine Zusage ohne Tat. Genau die vier Handgriffe, die im Vertrieb
// zwischen zwei Anrufen anfallen, stehen hier als getestete Funktionen:
// Lead anlegen, Notiz, Wiedervorlage, Anrufergebnis.
//
// Drei Grenzen, die diese Datei bewusst NICHT ueberschreitet:
//  1. Kein eigenes SQL. lib/crm.js ist die einzige Datenschicht; nur dort
//     laeuft jede Abfrage im Namen des Nutzers, sodass die RLS-Policies aus
//     0002_rls.sql greifen. Eine Abfrage hier daneben waere ein Loch darin.
//  2. Kein Datumsrechnen. "in einer Woche" loest die Sprachschicht auf und
//     liefert JJJJ-MM-TT. Zwei Stellen, die rechnen, rechnen irgendwann
//     verschieden — und ein falsches Datum faellt niemandem auf.
//  3. Kein Raten. Passen zwei Firmen gleich gut, wird zurueckgefragt. Eine
//     Notiz an der falschen Firma sieht man erst Wochen spaeter im Anruf.
//
// Signatur-Konvention wie in werkzeuge.js: Jede Funktion liefert
// { ok: true, ... } oder { ok: false, grund: "..." } und wirft NIEMALS.

const crm = require("./crm.js");

// Bewusst ueber das Modulobjekt (crm.xyz) statt destrukturiert aufgerufen —
// nur so lassen sich die Datenbankfunktionen im Test ersetzen.

// ---------------------------------------------------------------- Grundlagen

// Ohne persoenliches Konto geht nichts: Die Datenbank riegelt pro Person ab
// (RLS), das gemeinsame Sprach-Passwort ist kein Nutzer.
const KEIN_NUTZER = { ok: false, grund: "keine persoenliche Anmeldung" };
const angemeldet = (nutzer) => Boolean(nutzer && nutzer.id);

// Jeder Datenbankzugriff laeuft hier durch. Ein Wurf aus lib/crm.js (Netz weg,
// Pool voll, RLS verbietet die Zeile) wuerde in der Sprachschicht sonst als
// unbeantwortete Anfrage enden — Lukas hoert dann gar nichts und weiss nicht,
// ob es geklappt hat. Als { ok:false, grund } kann Alexandra es aussprechen.
async function versuch(fn) {
  try { return { ok: true, wert: await fn() }; }
  catch (e) { return { ok: false, grund: String((e && e.message) || e).slice(0, 200) }; }
}

const text = (v, max = 2000) => String(v == null ? "" : v).trim().slice(0, max);

// Die Sprachschicht liefert fertige Tagesangaben. Hier wird nur geprueft, ob
// wirklich ein Datum ankam: Ein durchgereichtes "in einer Woche" landete in der
// date-Spalte als Fehler oder null — und null LOESCHT eine bestehende
// Wiedervorlage still. Lieber vorher ehrlich abbrechen.
const istTag = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());

// ---------------------------------------------------------------- Firma finden
//
// Gleiches Muster wie die Kontaktsuche in lib/kontakte.js: bewerten, Rangliste,
// entscheiden — und bei Gleichstand melden statt waehlen.

// Vergleichsform eines Namens. Die drei Eingriffe sind alle an echten
// Sprachfehlern belegt: "&" wird "und" gesprochen (Krotzer & Eisele), die
// Erkennung schreibt Umlaute mal aus ("Mueller" statt "Müller"), und
// Rechtsformen/Satzzeichen ("GmbH", "-", ".") stehen im CRM, werden aber nie
// mitgesprochen. Ohne Faltung findet sie die Firma nicht und legt eine zweite an.
function vergleichsform(s) {
  return String(s || "").toLowerCase()
    .replace(/&/g, " und ")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Rechtsform-Anhaengsel zaehlen nicht mit: "Physio Schwabing" soll die
// "Physio Schwabing GmbH" voll treffen, nicht nur knapp.
const RECHTSFORMEN = /\b(gmbh|gbr|ug|ag|kg|ohg|mbh|co|ek|e k|eg|ev|e v|und co|praxis|dr)\b/g;
const kern = (s) => vergleichsform(s).replace(RECHTSFORMEN, " ").replace(/\s+/g, " ").trim();

// Wie gut passt ein Firmenname zur Anfrage? Hoeher = besser. So gewinnt
// "Krotzer & Eisele" (erstes Wort exakt) klar gegen "Krotzer Immobilien Sued"
// nicht — beide 95 — und genau dann wird gefragt statt geraten.
function bewerte(name, q) {
  const n = kern(name);
  if (!n || !q) return 0;
  const w = n.split(" ");
  if (n === q) return 100;
  if (w[0] === q) return 95;                                    // "krotzer" == erstes Wort
  if (w.includes(q)) return 90;                                 // exaktes Wort irgendwo
  if (n.startsWith(q) && q.length >= 3) return 80;              // "physio schwabing" ~ Anfang
  if (n.includes(" " + q) && q.length >= 4) return 70;          // mehrere Woerter, mitten drin
  if (w.some((x) => x.startsWith(q) && q.length >= 4)) return 55;
  if (q.startsWith(w[0]) && w[0].length >= 4) return 35;        // schwach, faellt durch
  return 0;
}

const SCHWELLE = 55;

// Alle Kandidaten ueber der Schwelle, beste zuerst.
function rangliste(firmen, punkte) {
  return firmen.map((f) => ({ f, s: punkte(f) })).filter((x) => x.s >= SCHWELLE).sort((a, b) => b.s - a.s);
}

// Identitaet eines Treffers ist die id — ohne sie waeren zwei gleichnamige
// Firmen (Filialen, Namensvetter) "derselbe" Treffer und die Notiz landete
// stillschweigend bei der falschen.
const kennung = (f) => String(f.id != null ? f.id : f.name || "");

function entscheide(rang) {
  if (!rang.length) return null;
  const top = rang[0];
  const andere = rang.filter((x) => x.s === top.s && kennung(x.f) !== kennung(top.f));
  if (andere.length) {
    return { mehrdeutig: [top, ...andere].slice(0, 4).map((x) => ({
      id: x.f.id, name: x.f.name, ort: x.f.ort || "", status: x.f.status || "",
    })) };
  }
  return top.f;
}

// Findet die gemeinte Firma in einer Liste (wie sie crm.firmenListe liefert).
// Rueckgabe: die Firmenzeile selbst, oder { mehrdeutig: [...] } bei Gleichstand,
// oder null. Absichtlich synchron und ohne Datenbank — so ist die Trefferlogik
// ohne Supabase pruefbar.
function firmaFinden(suchbegriff, firmen) {
  const q = kern(suchbegriff);
  if (!q || !Array.isArray(firmen) || !firmen.length) return null;
  return entscheide(rangliste(firmen.filter((f) => f && f.name), (f) => bewerte(f.name, q)));
}

// Firma aus der Datenbank aufloesen. Die Liste wird KOMPLETT geholt und hier
// bewertet, nicht per ILIKE vorgefiltert: Der Datenbankfilter kennt nur
// Teilzeichenketten, wuerde "Krotzer und Eisele" gegen "Krotzer & Eisele"
// verfehlen — und schlimmer: Er kann den zweiten, gleich guten Treffer
// wegfiltern. Dann waere die Sache scheinbar eindeutig und wir raten.
async function firmaAufloesen(nutzer, suchbegriff) {
  if (!angemeldet(nutzer)) return KEIN_NUTZER;
  const suche = text(suchbegriff, 120);
  if (!suche) return { ok: false, grund: "keine Firma genannt" };

  const geholt = await versuch(() => crm.firmenListe(nutzer, { limit: 500 }));
  if (!geholt.ok) return { ok: false, grund: geholt.grund };

  const treffer = firmaFinden(suche, Array.isArray(geholt.wert) ? geholt.wert : []);
  if (!treffer) return { ok: false, unbekannt: true, grund: `keine Firma gefunden zu "${suche}"` };
  if (treffer.mehrdeutig) {
    return { ok: false, mehrdeutig: treffer.mehrdeutig,
      grund: `mehrere Firmen passen auf "${suche}"` };
  }
  return { ok: true, firma: treffer };
}

// ---------------------------------------------------------------- 1. Lead anlegen
//
// "leg einen Lead an: Physio Schwabing, kam ueber Empfehlung"

// quelle ist Freitext, laut Schema aber mit fester Wortliste gemeint
// (0001_schema.sql). Gesprochen kommt es als halber Satz ("kam ueber
// Empfehlung") — ungefiltert stehen morgen fuenf Schreibweisen derselben
// Quelle in der Auswertung.
const QUELLEN = [
  ["empfehlung", /empfehl|weiterempf|ueber einen kunden|über einen kunden/i],
  ["cold-call", /cold.?call|kaltakquise|rausgerufen|telefonisch akquir/i],
  ["meta-ads", /meta|facebook|instagram|insta\b/i],
  ["google-ads", /google|adwords|sea\b/i],
  ["funnel", /funnel|landingpage|formular|website/i],
  ["mail", /mail|newsletter/i],
  ["messe", /messe|veranstaltung|netzwerk|event/i],
];

function quelleNormal(wort) {
  const s = text(wort, 60);
  if (!s) return null;                                  // dann greift der Standard aus crm.js
  for (const [wert, muster] of QUELLEN) if (muster.test(s)) return wert;
  return s.toLowerCase().slice(0, 40);                  // unbekannt: lieber das Gesagte behalten
}

const TEMPERATUREN = ["heiss", "warm", "kalt"];

async function leadAnlegen(nutzer, d = {}) {
  if (!angemeldet(nutzer)) return KEIN_NUTZER;
  const name = text(d.name, 160);
  if (!name) return { ok: false, grund: "kein Firmenname" };

  const felder = {
    name,
    status: "lead",
    quelle: quelleNormal(d.quelle),
    ort: text(d.ort, 80) || null,
    telefon: text(d.telefon, 40) || null,
    email: text(d.email, 120) || null,
    branche: text(d.branche, 80) || null,
    // "stand" ist der Satz, den man vor dem Anruf wissen muss (E2) — genau das,
    // was beim Diktieren nebenbei mitkommt ("die wollen erst im September").
    stand: text(d.notiz, 500) || null,
  };
  // Nur pruefen, nicht korrigieren: Ein erfundener Wert wuerde am
  // check-constraint scheitern und den ganzen Lead verhindern.
  if (TEMPERATUREN.includes(String(d.temperatur))) felder.temperatur = String(d.temperatur);

  const angelegt = await versuch(() => crm.firmaAnlegen(nutzer, felder));
  if (!angelegt.ok) return { ok: false, grund: angelegt.grund };
  const erg = angelegt.wert || {};

  // Die Dubletten-Wache aus crm.js legt trotz Treffer an. Sie muss deshalb
  // nach oben durchgereicht und ausgesprochen werden — sonst entstehen bei
  // wiederholtem Diktieren (Erkennung bricht ab, Lukas sagt es nochmal)
  // stumm zwei Karteikarten derselben Firma.
  return { ok: true, id: erg.id, name, quelle: felder.quelle, dublette: erg.dublette || null };
}

// ---------------------------------------------------------------- 2. Notiz
//
// "notier bei Krotzer, dass sie erst im September Budget haben"

async function notizAnlegen(nutzer, d = {}) {
  if (!angemeldet(nutzer)) return KEIN_NUTZER;
  const inhalt = text(d.text, 2000);
  if (!inhalt) return { ok: false, grund: "keine Notiz genannt" };

  const ziel = await firmaAufloesen(nutzer, d.firma);
  if (!ziel.ok) return ziel;

  const g = await versuch(() => crm.notiz(nutzer, ziel.firma.id, inhalt, "notiz"));
  if (!g.ok) return { ok: false, grund: g.grund };
  return { ok: true, firma: { id: ziel.firma.id, name: ziel.firma.name }, text: inhalt };
}

// ---------------------------------------------------------------- 3. Wiedervorlage
//
// "erinner mich in einer Woche an Mueller"

async function wiedervorlageSetzen(nutzer, d = {}) {
  if (!angemeldet(nutzer)) return KEIN_NUTZER;
  if (!istTag(d.datum)) {
    return { ok: false, grund: `kein gueltiges Datum (JJJJ-MM-TT): "${text(d.datum, 40)}"` };
  }
  const datum = text(d.datum, 10);

  const ziel = await firmaAufloesen(nutzer, d.firma);
  if (!ziel.ok) return ziel;

  const gesetzt = await versuch(() => crm.firmaAendern(nutzer, ziel.firma.id, { wiedervorlage: datum }));
  if (!gesetzt.ok) return { ok: false, grund: gesetzt.grund };

  // Bewusst zusaetzlich eine Notiz: Das Feld "wiedervorlage" haelt nur den Tag
  // fest, nicht den Anlass. Ohne die Zeile in der Historie steht die Firma
  // naechste Woche auf der Liste und keiner weiss mehr, warum.
  // Scheitert nur die Spur, gilt der Handgriff trotzdem als erledigt — der
  // Termin steht ja. Alles andere waere eine Luege in die falsche Richtung.
  const grund = text(d.notiz, 500);
  await versuch(() => crm.notiz(nutzer, ziel.firma.id,
    `Wiedervorlage auf ${datum}${grund ? " — " + grund : ""}`, "notiz"));

  return { ok: true, firma: { id: ziel.firma.id, name: ziel.firma.name }, datum };
}

// ---------------------------------------------------------------- 4. Anrufergebnis
//
// "Mueller erreicht, will Angebot"

// crm.callErgebnis kennt genau vier Ausgaenge und macht bei allem anderen
// STILL NICHTS — es liefert trotzdem true. Ein vertipptes/frei formuliertes
// Wort waere also die schlimmste Sorte Fehler: Alexandra sagt "notiert", im
// CRM steht nichts. Deshalb wird hier auf die vier Werte abgebildet und
// alles Uneindeutige abgelehnt.
//
// Reihenfolge ist Absicht: "nicht erreicht" enthaelt "erreicht", und eine
// "Absage, wollte keinen Termin" ist keine Terminbuchung.
const AUSGAENGE = [
  ["nicht-erreicht", /nicht[\s-]?erreich|niemand|mailbox|keiner (dran|ran)|nicht ran|nicht abgenommen/i],
  ["absage", /absage|abgesagt|abgelehnt|kein interesse|kein bedarf|will nicht|springt ab/i],
  ["termin", /termin|erstgespr|gebucht|gespr(ae|ä)ch steht/i],
  ["spaeter", /sp(ae|ä)ter|wiedervorlage|nochmal anrufen|merken|melden lassen/i],
  ["erreicht", /erreicht|gesprochen|am telefon|dran gehabt/i],
];

function ausgangNormal(wort) {
  const s = text(wort, 200);
  if (!s) return null;
  for (const [wert, muster] of AUSGAENGE) if (muster.test(s)) return wert;
  return null;
}

async function anrufErgebnis(nutzer, d = {}) {
  if (!angemeldet(nutzer)) return KEIN_NUTZER;
  const ausgang = ausgangNormal(d.ausgang);
  if (!ausgang) {
    return { ok: false, grund: `Anrufergebnis nicht eindeutig: "${text(d.ausgang, 60)}"` };
  }
  // "spaeter" schreibt das Datum direkt in die Wiedervorlage — und crm.js
  // setzt ohne Datum null ein. Das wuerde eine bereits gesetzte Wiedervorlage
  // loeschen, statt sie zu verschieben: die Firma verschwindet von der Liste.
  if (ausgang === "spaeter" && !istTag(d.datum)) {
    return { ok: false, grund: "fuer 'spaeter' fehlt das Datum (JJJJ-MM-TT)" };
  }

  const ziel = await firmaAufloesen(nutzer, d.firma);
  if (!ziel.ok) return ziel;
  const notizText = text(d.notiz, 500);

  // "erreicht" ist keiner der vier CRM-Ausgaenge: Es ist gesprochen worden,
  // aber noch nichts entschieden — kein Termin, keine Absage. Als Aktivitaet
  // der Art "anruf" zaehlt es trotzdem in die Anrufstatistik des Tages
  // (teamZahlen zaehlt art='anruf'), ohne Status oder Temperatur zu verbiegen.
  if (ausgang === "erreicht") {
    const g = await versuch(() => crm.notiz(nutzer, ziel.firma.id,
      `Erreicht${notizText ? " — " + notizText : ""}`, "anruf"));
    if (!g.ok) return { ok: false, grund: g.grund };
    return { ok: true, firma: { id: ziel.firma.id, name: ziel.firma.name }, ausgang };
  }

  const extra = { notiz: notizText || undefined, datum: istTag(d.datum) ? text(d.datum, 10) : null };
  if (ausgang === "absage") extra.grund = notizText || text(d.grund, 200) || "kein Grund genannt";

  const g = await versuch(() => crm.callErgebnis(nutzer, ziel.firma.id, ausgang, extra));
  if (!g.ok) return { ok: false, grund: g.grund };
  // false heisst: Die Firma war beim Schreiben nicht (mehr) sichtbar.
  if (g.wert === false) return { ok: false, grund: "Firma nicht gefunden" };

  return { ok: true, firma: { id: ziel.firma.id, name: ziel.firma.name }, ausgang,
    datum: extra.datum || null };
}

module.exports = {
  firmaFinden, firmaAufloesen,
  leadAnlegen, notizAnlegen, wiedervorlageSetzen, anrufErgebnis,
  ausgangNormal, quelleNormal, bewerte,
};
