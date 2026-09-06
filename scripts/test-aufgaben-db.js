// scripts/test-aufgaben-db.js — Verantwortlicher, RLS und die Whiteboard-Bruecke
// gegen die TEST-Datenbank (Migration 0058 muss eingespielt sein).
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5499/flowstate node scripts/test-aufgaben-db.js
//
// Braucht die Datenbank und laeuft darum NICHT in scripts/pruefen.js mit.
// Legt eine Testfirma und ein paar Aufgaben an (Kennzeichen "ZZ Test
// Aufgaben <pid>") und raeumt sie am Ende wieder weg — samt der
// Whiteboard-Elemente, die dabei entstehen.
//
// Absichtlich OHNE .env: Diese Pruefung schreibt und loescht, und sie soll
// nie aus Versehen gegen Supabase laufen. Eine Adresse mit "supabase" wird
// abgelehnt, es sei denn, AUFGABEN_TEST_ECHT=1 sagt ausdruecklich ja.

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL fehlt — bitte die Test-Datenbank angeben (siehe Kopf der Datei).");
  process.exit(1);
}
if (/supabase/i.test(process.env.DATABASE_URL) && process.env.AUFGABEN_TEST_ECHT !== "1") {
  console.error("Das sieht nach der echten Datenbank aus — abgebrochen. (AUFGABEN_TEST_ECHT=1 erzwingt es.)");
  process.exit(1);
}

const crypto = require("crypto");
const crm = require("../lib/crm.js");
const { pgSpeicher } = require("../lib/whiteboard-speicher.js");

let fehler = 0;
const melde = (ok, text) => { console.log((ok ? "✅" : "❌") + " " + text); if (!ok) fehler++; };

// Die Whiteboard-Route als Attrappe — wie in test-uebergabe.js: nur der
// letzte Handler je Route, req.nutzer wird von Hand gesetzt.
const routen = {};
const app = {
  get: (p, ...h) => { routen["GET " + p] = h[h.length - 1]; },
  post: (p, ...h) => { routen["POST " + p] = h[h.length - 1]; },
  use: () => {},
};
const speicher = pgSpeicher();
require("../lib/whiteboard-routes.js")(app, { speicher, team: (u) => crm.team(u) });
function rufen(schluessel, req) {
  return new Promise((fertig, schief) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(d) { fertig({ code: this.code, json: d }); },
      send(h) { fertig({ code: this.code, html: h }); },
      redirect(z) { fertig({ redirect: z }); },
    };
    Promise.resolve(routen[schluessel](req, res, schief)).catch(schief);
  });
}
const zeileVon = (el, id) => el && el.inhalt.zeilen.find((z) => z.aufgabe === Number(id));

(async () => {
  const lukas = await crm.anmelden("lukas.sehorz@svhconsult.de", "flowstate2026");
  const louis = await crm.anmelden("louis.tournier@svhconsult.de", "flowstate2026");
  const okan  = await crm.anmelden("okan@svhconsult.de", "flowstate2026");
  if (!lukas || !louis || !okan) {
    console.error("Konten fehlen (lukas / louis / okan mit Passwort flowstate2026).");
    process.exit(1);
  }
  const { rows: spalten } = await crm.system(
    `select column_name from information_schema.columns
      where table_name = 'aufgaben' and column_name in ('verantwortlich','tafel_element','tafel_gesetzt')`);
  const { rows: funktionen } = await crm.system(
    `select proname from pg_proc where proname in ('aufgabe_firma_name','aufgabe_haken_auf_tafel')`);
  if (spalten.length !== 3 || funktionen.length !== 2) {
    console.error("Migration 0058 ist nicht (vollstaendig) eingespielt — Spalten oder Funktionen fehlen.");
    process.exit(1);
  }

  const marke = "ZZ Test Aufgaben " + process.pid;
  const { rows: [firma] } = await crm.system(
    `insert into firmen (name, besitzer, status) values ($1, $2, 'kunde') returning id`, [marke, lukas.id]);
  const elemente = new Set();   // alles, was am Ende weg muss

  // ------------------------------------------------ 1. Lukas legt fuer Louis an
  const id = await crm.todoAnlegen(lukas, { titel: "Angebot nachfassen", firma_id: firma.id,
    verantwortlich: louis.id, wichtigkeit: 2, dringlichkeit: "Bald" });
  const { rows: [a] } = await crm.system(`select * from aufgaben where id = $1`, [id]);
  melde(a && a.verantwortlich === louis.id && a.besitzer === lukas.id, "Aufgabe: besitzer Lukas, verantwortlich Louis");
  melde(a && a.tafel_element && a.tafel_gesetzt, "tafel_element und tafel_gesetzt sind gesetzt");
  melde(a && a.wichtigkeit === 2 && a.dringlichkeit === "Bald", "Wichtigkeit und Dringlichkeit uebernommen");
  if (a && a.tafel_element) elemente.add(a.tafel_element);
  const el = a && a.tafel_element ? await speicher.holen(lukas, a.tafel_element) : null;
  melde(el && el.tafel === louis.id && el.besitzer === lukas.id && el.inhalt.kategorie === "kunden",
        "Whiteboard-Block auf Louis' Tafel, Autor Lukas, Kategorie kunden");
  melde(el && el.inhalt.zeilen.some((z) => z.aufgabe === Number(id)
        && z.link === `/crm/firma/${firma.id}` && z.t === `${marke}: Angebot nachfassen` && z.erledigt === false),
        "Zeile mit Bezug, Link in die Akte und '<Firma>: <Titel>'");

  // ------------------------------------------------ 2. Sichtbarkeit: Bedingung + RLS
  const inListe = async (u) => (await crm.todoListe(u)).find((t) => Number(t.id) === Number(id));
  const lL = await inListe(lukas), lO = await inListe(louis), lK = await inListe(okan);
  melde(lL && lL.verantwortlich_name === "Louis Tournier", "Lukas sieht sie in seiner Liste (fuer Louis Tournier)");
  melde(lO && lO.besitzer_name === "Lukas Sehorz", "Louis sieht sie in seiner Liste (von Lukas Sehorz)");
  melde(lO && lO.firma_name === marke && lO.firma_sichtbar === false, "Louis sieht den Firmennamen, aber die Akte ist nicht freigegeben");
  melde(!lK, "Okan sieht sie nicht");
  const { rows: rlsLouis } = await crm.alsNutzer(louis.id, (q) => q(`select id from aufgaben where id = $1`, [id]));
  const { rows: rlsOkan } = await crm.alsNutzer(okan.id, (q) => q(`select id from aufgaben where id = $1`, [id]));
  melde(rlsLouis.length === 1 && rlsOkan.length === 0, "RLS: Louis (verantwortlich) liest die Zeile, Okan nicht");
  const heute = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  await crm.todoPlanen(louis, id, heute);
  const heuteLouis = (await crm.todosHeute(louis)).some((t) => Number(t.id) === Number(id));
  const heuteLukas = (await crm.todosHeute(lukas)).some((t) => Number(t.id) === Number(id));
  melde(heuteLouis && heuteLukas, "Louis darf den Tag setzen; 'Heute zu tun' zeigt sie bei beiden");
  const zl = await crm.zentraleZahlen(louis);
  melde(zl && zl.todos && zl.todos.offen >= 1 && zl.todos.heute >= 1, `Zentrale (Louis) zaehlt die Aufgabe mit: offen ${zl.todos.offen}, heute ${zl.todos.heute}`);

  // ------------------------------------------------ 3. Liste -> Tafel: Louis hakt ab (aufgabe_haken_auf_tafel)
  // (Der Block kann ein aelterer Kunden-Block auf Louis' Tafel sein — die
  // Bruecke haengt an den juengsten, den Lukas aendern darf. Darum wird die
  // Version relativ geprueft, nicht absolut.)
  await crm.todoErledigt(louis, id, true);
  let el2 = await speicher.holen(louis, a.tafel_element);
  let { rows: [a2] } = await crm.system(`select erledigt from aufgaben where id = $1`, [id]);
  melde(a2.erledigt === true && zeileVon(el2, id).erledigt === true && el2.version === el.version + 1,
        `Liste -> Tafel: Louis hakt ab, die Tafelzeile ist erledigt, Version ${el.version} -> ${el2.version} (Trigger)`);
  const { rows: [nochmal] } = await crm.alsNutzer(louis.id, (q) => q(`select aufgabe_haken_auf_tafel($1, true) as stand`, [id]));
  melde(nochmal.stand === "unveraendert", "aufgabe_haken_auf_tafel noch einmal: 'unveraendert'");
  const { rows: [fremd] } = await crm.alsNutzer(okan.id, (q) => q(`select aufgabe_haken_auf_tafel($1, false) as stand`, [id]));
  const { rows: [unbekannt] } = await crm.alsNutzer(lukas.id, (q) => q(`select aufgabe_haken_auf_tafel(999999999, false) as stand`));
  melde(fremd.stand === "recht" && unbekannt.stand === "aufgabe", "... Okan: 'recht', unbekannte Aufgabe: 'aufgabe'");

  // ------------------------------------------------ 4. Okan darf nichts
  await crm.todoErledigt(okan, id, false);
  ({ rows: [a2] } = await crm.system(`select erledigt from aufgaben where id = $1`, [id]));
  melde(a2.erledigt === true, "Okan (weder Besitzer noch Verantwortlicher) kann sie nicht wieder oeffnen");

  // ------------------------------------------------ 5. Tafel -> Liste ueber die echte Route
  el2 = await speicher.holen(louis, a.tafel_element);
  const zeilen = el2.inhalt.zeilen.map((z) => ({ ...z, erledigt: z.aufgabe === Number(id) ? false : z.erledigt }));
  const antwort = await rufen("POST /api/whiteboard/aendern", { nutzer: louis, body: {
    id: el2.id, version: el2.version, art: "text", inhalt: { ...el2.inhalt, zeilen } } });
  melde(antwort.json && antwort.json.ok && !("vorher" in antwort.json), "Route aendern: ok — 'vorher' bleibt beim Server");
  ({ rows: [a2] } = await crm.system(`select erledigt from aufgaben where id = $1`, [id]));
  melde(a2.erledigt === false, "Tafel -> Liste: Louis oeffnet die Zeile auf dem Whiteboard, die Aufgabe ist wieder offen");
  // Okan darf die Tafel (Louis') nicht beschreiben: 404, Aufgabe unberuehrt
  const el3 = await speicher.holen(louis, a.tafel_element);
  const fremdRoute = await rufen("POST /api/whiteboard/aendern", { nutzer: okan, body: {
    id: el3.id, version: el3.version, art: "text",
    inhalt: { ...el3.inhalt, zeilen: el3.inhalt.zeilen.map((z) => ({ ...z, erledigt: true })) } } });
  ({ rows: [a2] } = await crm.system(`select erledigt from aufgaben where id = $1`, [id]));
  melde(fremdRoute.code === 404 && a2.erledigt === false, "Okan kann Louis' Block nicht aendern (404), die Aufgabe bleibt offen");

  // ------------------------------------------------ 6. Louis zieht die Zeile in einen EIGENEN Block
  // (Autor UND Tafel = Louis). Lukas kommt per RLS nicht mehr an das Element —
  // sein Haken in der Liste muss die Zeile trotzdem erreichen (0058-Funktion).
  const idL = crypto.randomUUID();
  const el4 = await speicher.holen(louis, a.tafel_element);
  const zeileT = zeileVon(el4, id);
  const anl = await rufen("POST /api/whiteboard/anlegen", { nutzer: louis, body: {
    id: idL, art: "text", x: 130, y: 700, breite: 560, hoehe: 100,
    inhalt: { liste: "check", farbe: "schwarz", groesse: 28, kategorie: "kunden", zeilen: [zeileT] } } });
  elemente.add(idL);
  const rest = el4.inhalt.zeilen.filter((z) => z.aufgabe !== Number(id));
  const weg = await rufen("POST /api/whiteboard/aendern", { nutzer: louis, body: {
    id: el4.id, version: el4.version, art: "text",
    inhalt: { ...el4.inhalt, zeilen: rest.length ? rest : [{ t: "", erledigt: false, gestrichen: false }] } } });
  const { rows: [b6] } = await crm.system(`select tafel_element from aufgaben where id = $1`, [id]);
  melde(anl.json.ok && weg.json.ok && b6.tafel_element === idL, "Louis verschiebt die Zeile in eigenen Block -> tafel_element zeigt auf den neuen Block");
  await crm.todoErledigt(lukas, id, true);
  let eL = await speicher.holen(lukas, idL);
  ({ rows: [a2] } = await crm.system(`select erledigt from aufgaben where id = $1`, [id]));
  melde(a2.erledigt === true && zeileVon(eL, id).erledigt === true, "Lukas hakt in der Liste ab -> Zeile in Louis' eigenem Block folgt (am RLS vorbei)");
  await crm.todoErledigt(louis, id, false);
  eL = await speicher.holen(lukas, idL);
  melde(zeileVon(eL, id).erledigt === false, "Louis oeffnet in der Liste -> Zeile folgt");

  // ------------------------------------------------ 7. Wischen, in der Liste abhaken, Rueckgaengig: die Liste gilt
  await speicher.loeschen(louis, [idL]);
  await crm.todoErledigt(lukas, id, true);
  const { rows: [b7] } = await crm.system(`select tafel_element, erledigt from aufgaben where id = $1`, [id]);
  melde(b7.erledigt === true && b7.tafel_element === idL, "Block weich geloescht: Liste abhaken geht, Bezug bleibt");
  const zurueck = await rufen("POST /api/whiteboard/wiederherstellen", { nutzer: louis, body: { ids: [idL] } });
  eL = await speicher.holen(lukas, idL);
  melde(zurueck.json.ok && zurueck.json.ids.includes(idL) && !eL.geloescht && zeileVon(eL, id).erledigt === true,
        "Wiederherstellen ueber die Route: Zeile traegt den Haken aus der Liste (nachgezogen)");

  // ------------------------------------------------ 8. Zweite Aufgabe: derselbe Block (juengster Kunden-Block)
  const id2 = await crm.todoAnlegen(lukas, { titel: "Rechnung", firma_id: firma.id, verantwortlich: louis.id });
  const { rows: [b] } = await crm.system(`select tafel_element from aufgaben where id = $1`, [id2]);
  melde(b.tafel_element === a.tafel_element, "zweite Aufgabe fuer Louis: Lukas' Block (Louis' eigener ist fuer Lukas tabu)");

  // ------------------------------------------------ 9. Gleichzeitig: ein Block, keine Doppelten
  const parallel = await Promise.all([1, 2, 3, 4].map((i) =>
    crm.todoAnlegen(lukas, { titel: `Parallel ${i}`, firma_id: firma.id, verantwortlich: louis.id })));
  const { rows: pz } = await crm.system(`select id, tafel_element from aufgaben where id = any($1::bigint[])`, [parallel]);
  const eP = await speicher.holen(lukas, a.tafel_element);
  melde(pz.every((r) => r.tafel_element === a.tafel_element) && parallel.every((p) => zeileVon(eP, p)),
        `4 gleichzeitig -> alle im selben Block (${eP.inhalt.zeilen.length} Zeilen)`);
  await crm.system(`delete from whiteboard_elemente where tafel = $1 and besitzer = $2 and inhalt like '%"kategorie":"kunden"%' and id <> all($3::uuid[])`,
    [okan.id, lukas.id, [...elemente]]);
  const parallelO = await Promise.all([1, 2].map((i) =>
    crm.todoAnlegen(lukas, { titel: `Parallel Okan ${i}`, firma_id: firma.id, verantwortlich: okan.id })));
  const { rows: po } = await crm.system(`select tafel_element from aufgaben where id = any($1::bigint[])`, [parallelO]);
  po.forEach((r) => elemente.add(r.tafel_element));
  melde(po[0].tafel_element && po[0].tafel_element === po[1].tafel_element, "2 gleichzeitig auf Okans Tafel ohne Block -> EIN neuer Block");

  // ------------------------------------------------ 10. Lange Zeile: Hoehe schaetzen, an der Tafelkante klemmen
  // Der Pruefer fand am 05.09.2026: beim Anhaengen wurde nur "hoehe += 37"
  // gerechnet und y nie geklemmt — eine 400-Zeichen-Zeile bricht aber auf acht
  // Reihen um, und der Block wuchs unten aus der Tafel (gemessen y=610,
  // hoehe=862 -> unten 1472 > 1400). Geprueft wird das an einem FRISCHEN Block
  // dicht an der Unterkante: haengt man an einen gewachsenen Block aus einer
  // Browser-Sitzung an, steht in dessen hoehe eine im Browser GEMESSENE Zahl,
  // und die Rechnung taugt als Beleg nichts (die erste Fassung dieser Pruefung
  // war genau deshalb von Altlasten abhaengig). Okans Tafel wird leergeraeumt.
  const { rows: wegO } = await crm.system(
    `delete from whiteboard_elemente where tafel = $1 and besitzer = $2 returning id`, [okan.id, lukas.id]);
  for (const r of wegO) elemente.delete(r.id);
  const idKante = crypto.randomUUID();
  await rufen("POST /api/whiteboard/anlegen", { nutzer: lukas, body: {
    id: idKante, tafel: okan.id, art: "text", x: 130, y: 1200, breite: 560, hoehe: 114,
    inhalt: { liste: "check", farbe: "schwarz", groesse: 28, kategorie: "kunden",
              zeilen: [{ t: marke + " Platzhalter", erledigt: false, gestrichen: false }] } } });
  elemente.add(idKante);
  const idLang = await crm.todoAnlegen(lukas, { titel: "Ä".repeat(400), firma_id: firma.id, verantwortlich: okan.id });
  const eLang = await speicher.holen(lukas, idKante);
  const zLang = zeileVon(eLang, idLang);
  melde(zLang && zLang.t.length === 400 && eLang.hoehe >= 40 + 37 * 8
        && eLang.y < 1200 && eLang.y + eLang.hoehe <= 1400,
        `400-Zeichen-Zeile: Hoehe ${eLang.hoehe} (>= ${40 + 37 * 8}), y 1200 -> ${eLang.y}, `
        + `unten ${eLang.y + eLang.hoehe} <= 1400`);

  // ------------------------------------------------ 11. Unbekannter Verantwortlicher = ich
  const id3 = await crm.todoAnlegen(lukas, { titel: "Eigene", firma_id: firma.id,
    verantwortlich: "00000000-0000-4000-8000-000000000000" });
  const { rows: [c] } = await crm.system(`select verantwortlich, tafel_element from aufgaben where id = $1`, [id3]);
  if (c.tafel_element) elemente.add(c.tafel_element);
  const el5 = c.tafel_element ? await speicher.holen(lukas, c.tafel_element) : null;
  melde(c.verantwortlich === null && el5 && el5.tafel === lukas.id, "unbekannte uuid: verantwortlich null, Block auf Lukas' eigener Tafel");

  // ------------------------------------------------ 12. Ohne Firma: keine Tafel; ohne Titel: nichts
  const id4 = await crm.todoAnlegen(lukas, { titel: marke + " allgemein" });
  const { rows: [d] } = await crm.system(`select tafel_element from aufgaben where id = $1`, [id4]);
  melde(d.tafel_element === null, "allgemeine Aufgabe (ohne Firma) bleibt der Tafel fern");
  melde((await crm.todoAnlegen(lukas, { titel: "   ", firma_id: firma.id })) === null, "ohne Titel wird nichts angelegt");

  // ------------------------------------------------ 13. Verantwortlicher darf loeschen und einstufen
  const stufe = await crm.todoEinstufen(louis, id2, { wichtigkeit: 1 });
  melde(stufe.ok === true, "Louis (verantwortlich) darf die Wichtigkeit setzen");
  await crm.todoLoeschen(louis, id2);
  const { rows: wegL } = await crm.system(`select id from aufgaben where id = $1`, [id2]);
  melde(wegL.length === 0, "Louis (verantwortlich) darf loeschen");

  // ------------------------------------------------ 14. Element hart weg -> Bezug geloest
  await crm.system(`delete from whiteboard_elemente where id = $1`, [idL]);
  elemente.delete(idL);
  await crm.todoErledigt(lukas, id, false);
  const { rows: [f] } = await crm.system(`select tafel_element, erledigt from aufgaben where id = $1`, [id]);
  melde(f.erledigt === false && f.tafel_element === null, "Element hart geloescht: Haken bleibt in der Liste, Bezug wird geloest");

  // ------------------------------------------------ Aufraeumen
  // Nicht pauschal loeschen: Die Bruecke haengt an einen BESTEHENDEN
  // Kunden-Block an, wenn es einen gibt — der gehoert dann nicht dem Test,
  // sondern einer anderen Pruefung in derselben Test-Datenbank. Weg darf nur,
  // was ausschliesslich aus Testzeilen besteht; sonst werden bloss die
  // Testzeilen herausgenommen (05.09.2026 gelernt: der frueher pauschale
  // delete hat einen fremden Block mitgerissen).
  const meineZeile = (z) => String(z && z.t || "").startsWith(marke) || z.link === `/crm/firma/${firma.id}`;
  for (const eid of elemente) {
    const { rows: [roh] } = await crm.system(`select inhalt from whiteboard_elemente where id = $1`, [eid]);
    if (!roh) continue;
    let inhalt = null;
    try { inhalt = JSON.parse(roh.inhalt); } catch { inhalt = null; }
    const zeilen = inhalt && Array.isArray(inhalt.zeilen) ? inhalt.zeilen : [];
    const rest = zeilen.filter((z) => !meineZeile(z));
    if (!rest.length) { await crm.system(`delete from whiteboard_elemente where id = $1`, [eid]); continue; }
    await crm.system(`update whiteboard_elemente set inhalt = $2 where id = $1`,
                     [eid, JSON.stringify({ ...inhalt, zeilen: rest })]);
  }
  await crm.system(`delete from aufgaben where firma_id = $1 or titel like $2`, [firma.id, marke + "%"]);
  await crm.system(`delete from firmen where id = $1`, [firma.id]);
  const { rows: rest2 } = await crm.system(`select count(*)::int as n from aufgaben where firma_id = $1`, [firma.id]);
  melde(rest2[0].n === 0, "aufgeraeumt");

  console.log(fehler ? `\n${fehler} Problem(e).` : "\nAlles gut.");
  await crm.pool.end();
  process.exit(fehler ? 1 : 0);
})().catch(async (e) => { console.error("FEHLER:", e); try { await crm.pool.end(); } catch {} process.exit(1); });
