// Prueft lib/beleg-chat.js — ohne Datenbank und ohne Sprachmodell.
//
// Getestet wird die Werkzeugschleife und das, was das Modell NICHT entscheiden
// darf: dass in einem Gespraech genau EIN Beleg entsteht, dass die zweite
// Aeusserung denselben Beleg aendert statt einen zweiten anzulegen, dass ein
// unmoeglicher Betrag oder ein unmoegliches Datum nicht geschrieben, sondern im
// Chat benannt wird, dass nach sechs Runden abgebrochen wird und dass ein
// werfendes Modell in einem freundlichen Satz endet.
//
// Drei Attrappen (unten in require.cache bzw. auf den Exporten):
//   lib/schnell.js  — liefert erfundene Modellantworten nach Drehbuch
//   lib/crm.js      — Firmenliste und ein Arbeitsspeicher-"beleg_chat"
//   lib/rechnungen.js — echte Pruefung (rg.pruefen), aber ohne Datenbank
// Der Test darf weder ins Netz noch in die Datenbank, sonst laeuft er nicht in
// scripts/pruefen.js mit.
//
//   node scripts/test-beleg-chat.js

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};

// ---------------------------------------------------------------- Attrappen
// Muessen VOR dem require von beleg-chat.js stehen.
const modell = { da: true, drehbuch: [], gefragt: [], wirft: null };
require.cache[require.resolve("../lib/schnell.js")] = {
  id: "schnell-attrappe", filename: require.resolve("../lib/schnell.js"), loaded: true, children: [], paths: [],
  exports: {
    verfuegbar: () => modell.da,
    kenntAufwand: () => true,
    async frage() { return ""; },
    async denke() { return ""; },
    async mitWerkzeugenStrom() { return { text: "", aufrufe: [] }; },
    async mitWerkzeugen(system, nutzer, werkzeuge, opts) {
      modell.gefragt.push({ system, nutzer, werkzeuge, opts });
      if (modell.wirft) throw new Error(modell.wirft);
      return modell.drehbuch.length ? modell.drehbuch.shift() : { text: "Fertig.", aufrufe: [], tokenRaus: 0 };
    },
  },
};

const FIRMEN = [
  { id: 7, name: "Anderka GmbH", geschaeftsfuehrer: "Gottfried Anderka", adresse: "Isener Str. 6", plz: "83527", ort: "Kirchdorf", email: "info@anderka.de", geschlecht: "m" },
  { id: 8, name: "Anderka Bau GmbH", geschaeftsfuehrer: "Sepp Anderka", adresse: "Hauptstr. 1", plz: "83527", ort: "Kirchdorf", email: "bau@anderka.de", geschlecht: "m" },
  { id: 9, name: "Elektro Albonni", geschaeftsfuehrer: "Mohamad Albonni", adresse: "Lilienstraße 12", plz: "86825", ort: "Bad Wörishofen", email: "info@albonni.de", geschlecht: "m" },
];

// Der Arbeitsspeicher-Ersatz fuer die Tabelle beleg_chat aus 0063. Er erkennt
// genau die fuenf Abfragen, die lib/beleg-chat.js stellt — laeuft eine davon
// aus dem Ruder, faellt das hier auf und nicht erst im Browser.
const CHATS = [];
async function q(sql, args = []) {
  const t = String(sql).replace(/\s+/g, " ").trim();
  if (/^insert into beleg_chat/.test(t)) {
    const c = { id: CHATS.length + 1, rechnung_id: args[0] === null || args[0] === undefined ? null : Number(args[0]), nutzer: args[1], nachrichten: [], erstellt: "2026-09-06T09:00:00+02", geaendert: "2026-09-06T09:00:00+02" };
    CHATS.push(c);
    return { rows: [c], rowCount: 1 };
  }
  if (/^select .* from beleg_chat where id = \$1$/.test(t)) {
    const c = CHATS.find((x) => x.id === Number(args[0]));
    return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
  }
  if (/^select .* from beleg_chat where rechnung_id = \$1 order by id limit 1$/.test(t)) {
    const c = CHATS.find((x) => x.rechnung_id === Number(args[0]));
    return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
  }
  if (/^select .* from beleg_chat where nutzer = \$1 and rechnung_id is not null/.test(t)) {
    const l = CHATS.filter((x) => x.nutzer === args[0] && x.rechnung_id !== null).slice(-1);
    return { rows: l, rowCount: l.length };
  }
  if (/^update beleg_chat set nachrichten =/.test(t)) {
    const c = CHATS.find((x) => x.id === Number(args[0]));
    if (!c) return { rows: [], rowCount: 0 };
    c.nachrichten = [...c.nachrichten, ...JSON.parse(args[1])];
    if (c.rechnung_id === null && args[2] !== null && args[2] !== undefined) c.rechnung_id = Number(args[2]);
    return { rows: [c], rowCount: 1 };
  }
  if (/^update beleg_chat set rechnung_id = \$2/.test(t)) {
    const c = CHATS.find((x) => x.id === Number(args[0]));
    if (c) c.rechnung_id = Number(args[1]);
    return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
  }
  throw new Error("Unerwartete Abfrage im Test: " + t.slice(0, 120));
}

require.cache[require.resolve("../lib/crm.js")] = {
  id: "crm-attrappe", filename: require.resolve("../lib/crm.js"), loaded: true, children: [], paths: [],
  exports: {
    async alsNutzer(userId, fn) { return fn(q); },
    async system() { throw new Error("Der Test spricht nicht mit der Datenbank."); },
    async firmenListe(user, { suche = "", limit = 200 } = {}) {
      const t = String(suche).toLowerCase();
      return FIRMEN.filter((f) => !t || f.name.toLowerCase().includes(t)).slice(0, limit);
    },
  },
};

const rg = require("../lib/rechnungen.js");
const bc = require("../lib/beleg-chat.js");

// Der Ersatz fuer die Tabelle "rechnungen". Die ECHTE Pruefung (rg.pruefen)
// bleibt drin — sonst pruefte der Test eine Regel, die es im Betrieb nicht gibt.
const BELEGE = new Map();
let naechsteId = 500;
function belegZeile(x) {
  if (!x) return null;
  const r = { ...x, positionen: x.positionen.map((p) => ({ ...p })), empfaenger: { ...x.empfaenger } };
  r.summe = rg.summe(r.positionen);
  r.bezahlt_betrag = 0; r.offen = r.summe;
  r.status_text = rg.STATUS_TEXT[r.status] || r.status;
  r.url = `/buchhaltung/rechnungen/${r.id}`;
  r.abschlaege = []; r.rechnungen = [];
  return r;
}
rg.anlegen = async (user, d) => {
  const art = d.art === "angebot" ? "angebot" : "rechnung";
  const p = rg.pruefen(d, art);
  if (!p.ok) return p;
  const id = naechsteId++;
  BELEGE.set(id, { id, art, nummer: null, status: "entwurf", firma_id: p.werte.firma_id, firma_name: (FIRMEN.find((f) => f.id === p.werte.firma_id) || {}).name || null,
    empfaenger: p.werte.empfaenger, datum: p.werte.datum, faellig: p.werte.faellig, positionen: p.werte.positionen,
    titel: p.werte.titel, einleitung: p.werte.einleitung, schluss: p.werte.schluss, nutzen: p.werte.nutzen,
    vorlage: p.werte.vorlage, abschlag_von: null, abschlag_nr: null, abschlag_prozent: null, angebot_id: null });
  return { ok: true, id };
};
rg.eine = async (user, id) => belegZeile(BELEGE.get(Number(id)) || null);
rg.aendern = async (user, id, d) => {
  const alt = BELEGE.get(Number(id));
  if (!alt) return { ok: false, grund: "nicht-gefunden" };
  if (alt.status !== "entwurf") return { ok: false, grund: "nur-entwurf" };
  const p = rg.pruefen(d, alt.art);
  if (!p.ok) return p;
  Object.assign(alt, p.werte, { firma_name: (FIRMEN.find((f) => f.id === p.werte.firma_id) || {}).name || null });
  return { ok: true, id: Number(id) };
};
rg.loeschen = async (user, id) => {
  const alt = BELEGE.get(Number(id));
  if (!alt) return { ok: false, grund: "nicht-gefunden" };
  if (alt.status !== "entwurf") return { ok: false, grund: "nur-entwurf" };
  BELEGE.delete(Number(id));
  return { ok: true };
};

process.env.SCHNELL_PROVIDER = "anthropic";
process.env.SCHNELL_API_KEY = "test";

const NUTZER = { id: "11111111-1111-1111-1111-111111111111", rolle: "admin", name: "Lukas" };
const HEUTE = "2026-09-06";
const werkzeug = (name, input) => ({ name, input });
const antwortMit = (text, ...aufrufe) => ({ text, aufrufe, tokenRaus: 10 });

(async () => {
  // =================================================== Systemanweisung
  const anw = bc.anweisung(HEUTE);
  pruefe("Anweisung nennt das heutige Datum", anw.includes("2026-09-06"));
  pruefe("Anweisung nennt die Ein-Beleg-Regel", /NUR EINEN BELEG/.test(anw));
  pruefe("Anweisung verbietet die Umsatzsteuer", /Kleinunternehmerregelung/.test(anw) && /keine Umsatzsteuer/.test(anw));
  pruefe("Anweisung traegt beide Vorbilder", /R-2026-139/.test(anw) && /2026-026/.test(anw) && /Elektro Albonni/.test(anw));
  pruefe("Anweisung verlangt eine kurze Antwort", /Ein bis zwei Sätze/.test(anw));

  const namen = bc.WERKZEUGE.map((w) => w.name);
  pruefe("vier Werkzeuge", namen.length === 4 && namen.includes("kunde_suchen") && namen.includes("beleg_anlegen")
    && namen.includes("beleg_aendern") && namen.includes("beleg_zeigen"), namen.join(","));
  pruefe("die Einheiten im Schema sind die des Hauses",
    JSON.stringify(bc.WERKZEUGE[2].input_schema.properties.positionen.items.properties.einheit.enum) === JSON.stringify(rg.EINHEITEN));

  // =================================================== Nachpruefung (rein)
  const BELEG = {
    id: 1, art: "rechnung", nummer: null, status: "entwurf", firma_id: 7, firma_name: "Anderka GmbH",
    empfaenger: { name: "Anderka GmbH", ansprechperson: "Gottfried Anderka", anrede: "Herr", strasse: "Isener Str. 6", plz_ort: "83527 Kirchdorf", email: "info@anderka.de" },
    datum: "2026-09-06", faellig: "2026-09-20", vorlage: "website", titel: "Webseite",
    positionen: [{ titel: "Website", beschreibung: "Aufbau", menge: 1, einheit: "pauschal", einzelpreis: 750 }],
    einleitung: "", schluss: "", nutzen: "", summe: 750,
  };
  const aend = (f, r = BELEG) => bc.aenderungSaeubern(r, f, { heute: HEUTE });

  let a = aend({ position_aendern: { nr: 1, einzelpreis: 900 } });
  pruefe("„mach 900 daraus“ setzt den Preis der ersten Zeile", a.werte.positionen[0].einzelpreis === 900 && a.geaendert.includes("Zeile 1"));
  pruefe("dabei bleibt alles andere stehen", a.werte.positionen[0].titel === "Website"
    && a.werte.datum === "2026-09-06" && a.werte.empfaenger.email === "info@anderka.de");

  a = aend({ datum: "2026-09-01" });
  pruefe("Datum aendern verschiebt die Faelligkeit mit", a.werte.datum === "2026-09-01" && a.werte.faellig === "2026-09-15");
  a = aend({ datum: "morgen" });
  pruefe("„morgen“ wird aufgeloest", a.werte.datum === "2026-09-07", a.werte.datum);
  a = aend({ datum: "2031-01-01" });
  pruefe("Datum weit in der Zukunft wird abgelehnt und benannt",
    a.werte.datum === "2026-09-06" && !a.geaendert.length && /kein brauchbares Belegdatum/.test(a.warnungen.join(" ")));
  a = aend({ datum: "2026-02-31" });
  pruefe("ein Tag, den es nicht gibt, wird abgelehnt", a.werte.datum === "2026-09-06" && a.warnungen.length === 1);

  a = aend({ position_hinzu: { titel: "Hosting", beschreibung: "Ein Jahr", menge: 1, einheit: "pauschal", einzelpreis: 120 } });
  pruefe("Position dazu haengt hinten an", a.werte.positionen.length === 2 && rg.summe(a.werte.positionen) === 870);

  a = aend({ position_weg: 1 }, { ...BELEG, positionen: [BELEG.positionen[0], { titel: "Hosting", beschreibung: "", menge: 1, einheit: "pauschal", einzelpreis: 120 }] });
  pruefe("Position weg entfernt die richtige Zeile", a.werte.positionen.length === 1 && a.werte.positionen[0].titel === "Hosting");
  a = aend({ position_weg: 1 });
  pruefe("die letzte Zeile bleibt stehen (ein Beleg ohne Leistung geht nicht)",
    a.werte.positionen.length === 1 && /letzte Zeile/.test(a.warnungen.join(" ")));
  a = aend({ position_weg: 5 });
  pruefe("eine Zeile, die es nicht gibt, wird benannt", !a.geaendert.length && /Zeile Nummer 5 gibt es nicht/.test(a.warnungen.join(" ")));

  a = aend({ position_aendern: { nr: 1, einzelpreis: 0 } });
  pruefe("Preis 0 wird abgelehnt und nicht geschrieben",
    a.werte.positionen[0].einzelpreis === 750 && /nicht plausibel/.test(a.warnungen.join(" ")));
  a = aend({ position_aendern: { nr: 1, einzelpreis: 99999999 } });
  pruefe("Preis ueber der Spaltengrenze wird abgelehnt", a.werte.positionen[0].einzelpreis === 750 && a.warnungen.length === 1);
  a = aend({ position_aendern: { nr: 1, titel: "Abzug Abschlag 1" } }, { ...BELEG, positionen: [{ titel: "Abschlag 1", beschreibung: "", menge: 1, einheit: "pauschal", einzelpreis: -375 }] });
  pruefe("eine bestehende Abzugszeile darf ihren negativen Preis behalten",
    a.werte.positionen[0].einzelpreis === -375 && a.werte.positionen[0].titel === "Abzug Abschlag 1" && !a.warnungen.length, a.warnungen.join(" "));

  a = aend({ vorlage: "quatsch" });
  pruefe("unbekannte Vorlage wird abgelehnt", a.werte.vorlage === "website" && /gibt es nicht/.test(a.warnungen.join(" ")));
  a = aend({ faellig_tage: 30 });
  pruefe("Zahlungsziel in Tagen rechnet ab Belegdatum", a.werte.faellig === "2026-10-06");
  a = aend({ faellig_tage: 999 });
  pruefe("ein unmoegliches Zahlungsziel wird abgelehnt", a.werte.faellig === "2026-09-20" && a.warnungen.length === 1);
  a = aend({ einleitung: "Vielen Dank für Ihr Interesse:", nutzen: ["Ein ausreichend langer Nutzenpunkt"] });
  pruefe("auf der Rechnung gibt es keine Einleitung und keine Nutzenpunkte", a.werte.einleitung === "" && a.werte.nutzen === "");
  a = aend({ einleitung: "Vielen Dank für Ihr Interesse:" }, { ...BELEG, art: "angebot" });
  pruefe("beim Angebot geht die Einleitung durch", a.werte.einleitung === "Vielen Dank für Ihr Interesse:");
  a = aend({});
  pruefe("ein leerer Aufruf aendert nichts", !a.geaendert.length);

  const text = bc.belegText(BELEG);
  pruefe("belegText nummeriert die Positionen ab 1", /^ {2}1\. Website/m.test(text), text);
  pruefe("belegText nennt Summe und Status", new RegExp("Summe: " + rg.euro(750)).test(text) && /Entwurf/.test(text));
  pruefe("ohne Beleg sagt belegText genau das", /noch keinen Beleg/.test(bc.belegText(null)));

  // =================================================== Gespraech: anlegen
  modell.drehbuch = [
    antwortMit("", werkzeug("kunde_suchen", { name: "Anderka GmbH" })),
    antwortMit("", werkzeug("beleg_anlegen", {
      art: "rechnung", firma_id: 7, titel: "Webseite", vorlage: "website", datum: HEUTE, faellig_tage: 14,
      positionen: [{ titel: "Erstellung der neuen Webseite", beschreibung: "Individuelles, responsives Webdesign.", menge: 1, einheit: "pauschal", einzelpreis: 750 }],
      einleitung: "", nutzen: [], schluss: "",
    })),
    antwortMit("Die Rechnung über 750,00 € für die Anderka GmbH liegt als Entwurf im System."),
  ];
  let e = await bc.antworten(NUTZER, { text: "Anderka GmbH braucht eine Rechnung für eine Website in Höhe von 750 €", heute: HEUTE });
  pruefe("erste Aeusserung legt einen Beleg an", e.ok && e.rechnungId && e.beleg && e.beleg.summe === 750, JSON.stringify(e.tat));
  pruefe("die Kundenakte fuellt den Empfaenger", e.beleg.empfaenger.name === "Anderka GmbH" && e.beleg.empfaenger.email === "info@anderka.de" && e.beleg.firma_id === 7);
  pruefe("die Antwort ist der Satz des Modells", /750,00 €/.test(e.antwort));
  pruefe("die Tat steht am Verlauf", e.tat && e.tat.art === "anlegen");
  pruefe("Verlauf: Frage und Antwort gespeichert", e.verlauf.length === 2 && e.verlauf[0].rolle === "nutzer" && e.verlauf[1].rolle === "assistent");
  pruefe("das Modell sah den Beleg-Kopf und die neue Nachricht",
    /DER BELEG, ÜBER DEN IHR REDET/.test(modell.gefragt[0].nutzer) && /750/.test(modell.gefragt[0].nutzer));
  pruefe("ab Runde 2 sieht das Modell sein eigenes Werkzeugergebnis",
    /DEINE WERKZEUGE IN RUNDE 1/.test(modell.gefragt[1].nutzer) && /kunde_suchen/.test(modell.gefragt[1].nutzer) && /\[7\] Anderka GmbH/.test(modell.gefragt[1].nutzer));

  const chatId = e.chatId, belegId = e.rechnungId;

  // =================================================== Gespraech: aendern
  modell.gefragt = [];
  modell.drehbuch = [
    antwortMit("", werkzeug("beleg_aendern", { position_aendern: { nr: 1, einzelpreis: 900 } })),
    antwortMit("Steht auf 900,00 €."),
  ];
  e = await bc.antworten(NUTZER, { text: "mach 900 daraus", chatId, rechnungId: belegId, heute: HEUTE });
  pruefe("„mach 900 daraus“ aendert DENSELBEN Beleg", e.rechnungId === belegId && e.beleg.summe === 900);
  pruefe("es entstand kein zweiter Beleg", BELEGE.size === 1, `${BELEGE.size} Belege`);
  pruefe("der Verlauf waechst am selben Gespraech", e.chatId === chatId && e.verlauf.length === 4);
  pruefe("das Modell sah den bisherigen Verlauf", /BISHERIGES GESPRÄCH/.test(modell.gefragt[0].nutzer) && /Lukas: Anderka GmbH braucht/.test(modell.gefragt[0].nutzer));

  modell.drehbuch = [
    antwortMit("", werkzeug("beleg_aendern", { datum: "2026-09-01" })),
    antwortMit("Datum steht auf dem 1. September."),
  ];
  e = await bc.antworten(NUTZER, { text: "setz das Datum auf den 1.", chatId, heute: HEUTE });
  pruefe("Datum aendern schreibt denselben Beleg", e.beleg.id === belegId && e.beleg.datum === "2026-09-01" && e.beleg.faellig === "2026-09-15");

  modell.drehbuch = [
    antwortMit("", werkzeug("beleg_aendern", { position_hinzu: { titel: "Hosting", beschreibung: "Ein Jahr Hosting", menge: 1, einheit: "pauschal", einzelpreis: 120 } })),
    antwortMit("Hosting steht drauf."),
  ];
  e = await bc.antworten(NUTZER, { text: "schreib noch eine Position Hosting 120 € dazu", chatId, heute: HEUTE });
  pruefe("Position dazu: derselbe Beleg, zwei Zeilen, 1.020 €", e.beleg.id === belegId && e.beleg.positionen.length === 2 && e.beleg.summe === 1020);

  modell.drehbuch = [
    antwortMit("", werkzeug("beleg_aendern", { position_weg: 2 })),
    antwortMit("Hosting ist wieder weg."),
  ];
  e = await bc.antworten(NUTZER, { text: "das Hosting wieder raus", chatId, heute: HEUTE });
  pruefe("Position weg: eine Zeile, 900 €", e.beleg.positionen.length === 1 && e.beleg.summe === 900);

  // =================================================== Zweiter Beleg: nein
  modell.drehbuch = [
    antwortMit("", werkzeug("beleg_anlegen", { art: "rechnung", titel: "Noch eine", vorlage: "frei",
      positionen: [{ titel: "Irgendwas", beschreibung: "", menge: 1, einheit: "pauschal", einzelpreis: 100 }] })),
    antwortMit("In diesem GesprÃ¤ch geht nur ein Beleg â fÃ¼r einen zweiten oben „Neuer Beleg“ antippen."),
  ];
  e = await bc.antworten(NUTZER, { text: "und noch eine Rechnung über 100 €", chatId, heute: HEUTE });
  pruefe("beleg_anlegen wird abgelehnt, solange ein Beleg im Faden haengt", BELEGE.size === 1 && e.rechnungId === belegId);
  pruefe("das Modell bekommt die Ablehnung samt Begruendung zu lesen",
    /Abgelehnt: In diesem Gespräch gibt es schon einen Beleg/.test(modell.gefragt[modell.gefragt.length - 1].nutzer));

  // =================================================== Ungueltiger Betrag
  modell.drehbuch = [
    antwortMit("", werkzeug("beleg_aendern", { position_aendern: { nr: 1, einzelpreis: -50 } })),
    antwortMit("Das ging nicht."),
  ];
  e = await bc.antworten(NUTZER, { text: "mach minus 50 draus", chatId, heute: HEUTE });
  pruefe("ein unmoeglicher Betrag wird nicht geschrieben", e.beleg.summe === 900);
  pruefe("und im Chat benannt", /nicht plausibel/.test(e.antwort), e.antwort);

  // =================================================== Mehrdeutiger Kunde
  modell.drehbuch = [
    antwortMit("", werkzeug("kunde_suchen", { name: "Anderka" })),
    antwortMit("Zu „Anderka“ finde ich zwei Kunden in Kirchdorf: die Anderka GmbH und die Anderka Bau GmbH. Welche meinst du?"),
  ];
  e = await bc.antworten(NUTZER, { text: "Rechnung für Anderka, Website 2.500 €", heute: HEUTE });
  pruefe("mehrdeutiger Kunde fuehrt zur Rueckfrage statt zu einem Beleg", !e.rechnungId && /Welche meinst du/.test(e.antwort));
  pruefe("dabei entstand kein Beleg", BELEGE.size === 1);
  pruefe("das Gespraech ohne Beleg laesst sich fortsetzen", Number.isInteger(e.chatId) && e.chatId !== chatId);

  // =================================================== Endlosschleife
  modell.drehbuch = Array.from({ length: 10 }, () => antwortMit("", werkzeug("beleg_zeigen", {})));
  modell.gefragt = [];
  e = await bc.antworten(NUTZER, { text: "und jetzt?", chatId, heute: HEUTE });
  pruefe("nach sechs Runden wird abgebrochen", modell.gefragt.length === bc.MAX_RUNDEN, `${modell.gefragt.length} Runden`);
  pruefe("der Abbruch wird im Chat gesagt, nicht verschwiegen", /im Kreis gedreht/.test(e.antwort), e.antwort);
  pruefe("beim Abbruch bleibt der Beleg unveraendert", (await rg.eine(NUTZER, belegId)).summe === 900);

  // =================================================== Modell wirft
  modell.drehbuch = [];
  modell.wirft = "Werkzeuge 529: overloaded";
  e = await bc.antworten(NUTZER, { text: "mach 800 draus", chatId, heute: HEUTE });
  modell.wirft = null;
  pruefe("ein werfendes Modell endet in einem freundlichen Satz",
    !e.ok && e.grund === "modell" && /nicht ans Sprachmodell/.test(e.antwort) && /unverändert/.test(e.antwort), e.antwort);
  pruefe("auch dann steht die Frage im Verlauf", e.verlauf[e.verlauf.length - 2].text === "mach 800 draus");

  // =================================================== Art wechseln
  modell.drehbuch = [
    antwortMit("", werkzeug("beleg_aendern", { art: "angebot" })),
    antwortMit("Jetzt ist es ein Angebot."),
  ];
  const vorher = BELEGE.size;
  e = await bc.antworten(NUTZER, { text: "mach ein Angebot draus", chatId, heute: HEUTE });
  pruefe("aus der Rechnung wird ein Angebot", e.beleg && e.beleg.art === "angebot" && e.beleg.summe === 900, JSON.stringify(e.tat));
  pruefe("und es bleibt bei EINEM Beleg (der alte Entwurf ist weg)", BELEGE.size === vorher, `${BELEGE.size} statt ${vorher}`);
  pruefe("das Gespraech haengt jetzt am neuen Beleg",
    e.rechnungId !== belegId && CHATS.find((c) => c.id === chatId).rechnung_id === e.rechnungId);
  const angebotId = e.rechnungId;

  // =================================================== Gestellter Beleg
  BELEGE.get(angebotId).status = "gestellt";
  BELEGE.get(angebotId).nummer = "2026-031";
  modell.drehbuch = [
    antwortMit("", werkzeug("beleg_aendern", { position_aendern: { nr: 1, einzelpreis: 1000 } })),
    antwortMit("Das Angebot ist schon gestellt — dafür müsstest du es stornieren."),
  ];
  e = await bc.antworten(NUTZER, { text: "mach 1000 draus", chatId, heute: HEUTE });
  pruefe("ein gestellter Beleg wird nicht mehr geaendert", (await rg.eine(NUTZER, angebotId)).summe === 900);
  pruefe("das Modell erfaehrt, warum", /nicht mehr im Entwurf/.test(modell.gefragt[modell.gefragt.length - 1].nutzer));

  // =================================================== Ohne Modellzugang
  modell.da = false;
  const vorherBelege = BELEGE.size;
  e = await bc.antworten(NUTZER, { text: "Rechnung für Elektro Albonni, Website 500 €", heute: HEUTE });
  pruefe("ohne Modell entsteht trotzdem ein leerer Entwurf", !e.ok && e.grund === "kein-modell" && BELEGE.size === vorherBelege + 1);
  pruefe("der Satz steht als Notiz am Entwurf",
    /Elektro Albonni, Website 500/.test(e.beleg.positionen[0].beschreibung), JSON.stringify(e.beleg.positionen[0]));
  pruefe("der Empfaengername kommt grob aus dem Satz", e.beleg.empfaenger.name === "Elektro Albonni", e.beleg.empfaenger.name);
  pruefe("die Meldung ist ruhig und sagt, wo es laeuft", /auf dem Server läuft es/.test(e.antwort));
  pruefe("nichts wirft", typeof e.antwort === "string" && e.antwort.length > 40);

  e = await bc.antworten(NUTZER, { text: "mach 900 daraus", chatId: e.chatId, heute: HEUTE });
  pruefe("ohne Modell bleibt ein bestehender Beleg unangetastet", /nicht ändern/.test(e.antwort) && e.beleg.summe === 0);
  modell.da = true;

  // =================================================== Veralteter Reiter
  // Ein Reiter, der noch die alte Beleg-Nummer traegt (geloescht oder beim
  // Artwechsel ersetzt), darf keinen Fremdschluesselfehler ausloesen.
  modell.drehbuch = [antwortMit("Diesen Beleg gibt es nicht mehr — sag mir, was drauf soll.")];
  e = await bc.antworten(NUTZER, { text: "mach 500 draus", rechnungId: 99999, heute: HEUTE });
  pruefe("ein Beleg, den es nicht gibt, faengt ein Gespraech ohne Beleg an",
    e.ok && !e.rechnungId && e.beleg === null, JSON.stringify({ ok: e.ok, r: e.rechnungId }));

  // =================================================== Leere Eingabe
  e = await bc.antworten(NUTZER, { text: "   ", chatId, heute: HEUTE });
  pruefe("eine leere Eingabe wird nicht gespeichert", !e.ok && e.grund === "leer" && /Da stand nichts/.test(e.antwort));

  pruefe("ersterName fischt den Kunden aus dem Satz",
    bc.ersterName("Rechnung für Anderka GmbH über 750 €") === "Anderka GmbH", bc.ersterName("Rechnung für Anderka GmbH über 750 €"));

  console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles gruen.");
  process.exit(fehler ? 1 : 0);
})().catch((err) => { console.error("❌ Unerwartet:", err); process.exit(1); });
