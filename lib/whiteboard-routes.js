// lib/whiteboard-routes.js — die Whiteboard-Wand des OS (/whiteboard).
//
// Eine Tafel je Person, alle nebeneinander an einer Wand: schreiben per
// Tastatur oder freihaendig mit dem Stift, abhaken, durchstreichen, mit dem
// Schwamm wegwischen. Jeder sieht alle Boards (wie im Buero) und darf auch
// auf jede Tafel SCHREIBEN — so gibt man jemandem eine Aufgabe (31.08.2026).
// Jedes Element kennt darum zwei Personen: besitzer (der Autor, immer die
// angemeldete Person) und tafel (auf wessen Board es steht); die Oberflaeche
// zeigt "von Lukas", wenn beide auseinandergehen. Bearbeiten und Loeschen
// duerfen genau diese zwei — mehr nie. Gleichzeitige Schreiber pro Element
// bleiben damit selten ("zwei Tabs" oder "Autor und Empfaenger zugleich"),
// und genau dafuer gibt es die Versionspruefung beim Aendern.
//
// WICHTIG: Das ist KEINE zweite To-Do-Verwaltung. /todos (Tabelle "aufgaben")
// bleibt die Aufgabenliste mit Frist und Wichtigkeit; das Whiteboard ist die
// freie Flaeche daneben — Tinte, Textbloecke, Haftnotizen, eigene Tabelle
// "whiteboard_elemente" (Migration 0056). Von der Tafel wird nichts zur
// Aufgabe. Den EINEN Weg in die andere Richtung gibt es seit 05.09.2026:
// Eine Kunden-Aufgabe aus dem CRM landet als Zeile (mit "aufgabe": id) im
// Kunden-Block auf der Tafel des Verantwortlichen, und der Haken laeuft in
// beide Richtungen mit (lib/aufgaben-tafel.js). Mehr nicht — die Tafel
// bleibt frei.
//
// Die Seite selbst ist bewusst clientseitig aufgebaut (public/lib/whiteboard.js
// rendert in #wb-wurzel): Eine Zeichenflaeche mit Zoom, Pan und Canvas IST
// Client-Arbeit — serverseitige Templates haetten hier nichts zu sagen. Der
// Server liefert die Daten (unten eingebettet) und die API; die Wahrheit
// liegt wie ueberall in der Datenbank.

const fs = require("fs");
const path = require("path");
const { schale, eintragen, darfModul } = require("./schale.js");
const crm = require("./crm.js");
const { pgSpeicher } = require("./whiteboard-speicher.js");
// Die Bruecke zur Aufgabenliste. Sie braucht pruefeElement von HIER und laedt
// dieses Modul darum erst beim Aufruf — ein require in beide Richtungen beim
// Laden gaebe eine halbe Exportliste.
const aufgabenTafel = require("./aufgaben-tafel.js");

// Haengt als vierter Unterpunkt unter die Zentrale, hinter die To-Dos.
// eintragen() fuehrt Unterpunkte zusammen (siehe schale.js) — Kalender- und
// To-Do-Eintrag bleiben stehen, egal in welcher Reihenfolge geladen wird.
eintragen({
  id: "zentrale", titel: "Zentrale", icon: "zentrale", href: "/", gruppe: "Übersicht",
  unter: [{ id: "zentrale-whiteboard", modul: "whiteboard", titel: "Whiteboard",
            icon: "whiteboard", href: "/whiteboard", nach: "zentrale-todos" }],
});

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Cache-Stempel wie v() in schale.js (dort nicht exportiert): neue Datei ->
// neue URL -> der Browser holt sie frisch, ohne Strg+F5.
const stempel = new Map();
function v(datei) {
  const jetzt = Date.now();
  const c = stempel.get(datei);
  if (c && jetzt - c.geprueft < 5000) return c.url;
  let url = datei;
  try {
    const st = fs.statSync(path.join(__dirname, "..", "public", datei.replace(/^\//, "")));
    url = `${datei}?v=${Math.round(st.mtimeMs).toString(36)}`;
  } catch { /* Datei fehlt: ohne Stempel ausliefern */ }
  stempel.set(datei, { url, geprueft: jetzt });
  return url;
}

// ------------------------------------------------------------- Pruefregeln
//
// Der Server prueft JEDES Schreiben und baut den Inhalt als SAUBERES Objekt
// neu auf (nur bekannte Schluessel). Grund: Eine einzige unguelige Zeile in
// der Datenbank wuerde sonst bei JEDEM Betrachter im Render landen — der
// Client faengt das zwar ab (try/catch je Element), aber gar nicht erst
// hineinschreiben ist die bessere Haelfte der Regel.
//
// Farben sind NAMEN, keine Hex-Werte: Der Client uebersetzt sie je Theme.
// So bleibt "blau" im Dunkelmodus lesbar, ohne dass Daten angefasst werden.
const ARTEN = new Set(["strich", "text", "notiz"]);
const FARBEN = new Set(["schwarz", "blau", "rot", "gruen", "orange", "lila"]);
const ZETTEL = new Set(["gelb", "rosa", "mint", "blau"]);
const LISTEN = new Set(["keine", "zahl", "buchstabe", "punkt", "check"]);
// Optionale Einordnung eines Blocks — die Reihenfolge IST die Rangfolge:
//   1 Kunden · 2 Vertrieb · 3 Content & Wissen · 4 Intern & System · 5 CRM & Anrufe
// Kunden gehen immer vor, das Interne kommt zuletzt. (Am 31.08.2026 zuerst
// mit Intern auf Platz 3 gebaut und noch am selben Tag getauscht — Content
// bringt Umsatz, das Interne kann warten. Wer die Rangfolge aendert, aendert
// sie HIER und im Client, sonst sortiert die Oberflaeche anders, als der
// Server sie beschreibt.)
//
// Wer eine Aufgabe einordnet, muss sie nicht mehr von Hand an die richtige
// Stelle schieben; ohne Angabe bleibt ein Block liegen, wo er liegt. Die
// Namen stehen hier, damit der Server nichts durchlaesst, was die
// Oberflaeche nicht einsortieren kann.
// "crm" kam am 08.09.2026 als fuenfte dazu (Wunsch von Lukas): dort landet,
// was ein Anrufergebnis hinterlaesst (lib/crm.js -> lib/aufgaben-tafel.js).
const KATEGORIEN = ["kunden", "vertrieb", "content", "intern", "crm"];
const GRENZEN = {
  punkte: 6000,        // Zahlen je Strich (x und y zusammen) — ~3000 Stuetzpunkte
  zeilen: 200,         // Zeilen je Textblock/Notiz
  zeichenJeZeile: 400,
  striche: 20,         // Teilstriche je Zeile — mehr sind keine Zeile mehr, sondern ein Muster
  inhalt: 120000,      // Zeichen des fertigen JSON
  elementeJeBoard: 20000,
  ids: 500,            // je loeschen/wiederherstellen-Aufruf
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- Listen-Tafeln
//
// Zwei feste Listen: "Kunden" und "Leads" (09.09.2026, Migration 0068). Seit
// dem 14.09.2026 haengen sie als eigene Tafeln IN der Wand (unter den
// Personen-Tafeln, per Pfeil erreichbar) und sind an die Akte gebunden
// (Migration 0070) — Wunsch von Lukas.
//
// Je Zeile: eine Firma aus dem CRM, eine Notiz, ein freier Preis und
// "bezahlt" als Auswahl (ganz/50%/nein, seit 20.09.2026 — Migration 0071).
// Der Preis bleibt Freitext: mal mit monatlicher Gebuehr, mal ohne.
// Das ganze Team sieht und pflegt dieselben zwei Listen — es gibt hier keinen
// Autor-Begriff wie bei den Personen-Tafeln.
//
// SEIT DEM 20.09.2026 FUELLEN SICH DIE TAFELN SELBST (Migration 0077).
//
// Am 14.09. galt noch das Gegenteil: "trotzdem soll man es immer selber aufs
// Whiteboard eintragen muessen". Lukas hat das umgedreht, und die Begruendung
// steht in derselben Ansage: Die Tafeln sollen zeigen, was die
// Umsatzuebersicht zeigt — jeden Posten, der Geld bedeutet, in dem Monat, in
// dem er anfaellt. Von Hand abzuschreiben, was das CRM ohnehin weiss, ist
// Zusatzarbeit mit eingebauter Fehlerquelle.
//
// Was von selbst entsteht (siehe listenAbgleichen):
//   Leads-Tafel   je Lead, der das Gespraech erreicht hat (Erstgespräch /
//                 Setting Call) — dieselbe Schwelle wie beim Pipeline-Volumen.
//   Kunden-Tafel  je Kunde die einmalige Gebuehr, und je angefallenem
//                 Retainer-Monat eine eigene Zeile. Der Oktober erscheint am
//                 1. Oktober, nicht vorher.
//
// Was NICHT von selbst entsteht: die Notiz. Die schreibt der Mensch, und ein
// Abgleich fasst sie nie an.
//
// Und was vollstaendig bezahlt ist, verschwindet. Die Tafel ist eine
// Arbeitsliste, kein Archiv — was erledigt ist, gehoert nicht darauf. Die
// Zahlen bleiben in der Akte und in der Umsatzuebersicht.
//
// DIE BRUECKE ZUR AKTE geht jetzt in beide Richtungen: Was auf der Tafel
// eingetragen wird, landet im Verlauf der Firma, und ein Haken bei "bezahlt"
// schreibt den Zahlungsstand in die Akte zurueck (siehe zurueckInDieAkte).
// Anders ginge es nicht: Eine Zeile, deren Wert aus der Akte kommt, wuerde den
// Haken beim naechsten Abgleich sonst wieder wegwischen.
const LISTENBOARDS = new Set(["kunden", "leads"]);
const LISTEN_TITEL = { kunden: "Kunden", leads: "Leads" };
// Auf die Kunden-Tafel gehoeren Kunden, auf die Leads-Tafel Leads.
const LISTEN_STATUS = { kunden: "kunde", leads: "lead" };
const ZEILENFELDER = new Set(["notiz1", "preis", "bezahlt"]);
// "bezahlt" ist eine Auswahl, kein Freitext (20.09.2026): leer, ganz, 50% oder
// nein. Dieselben Werte stehen als Pruefung in der Datenbank (Migration 0071)
// und als Auswahlliste im Browser (public/lib/whiteboard-listen.js).
const BEZAHLT_WERTE = new Set(["", "ganz", "50%", "nein"]);
const ZEILEN_SPALTEN = "id, liste, firma_id, firma_name, notiz1, preis, bezahlt, position, herkunft, posten";
// Herkuenfte, die der Abgleich erzeugt. null (nicht in dieser Menge) heisst:
// von Hand angelegt — davon laesst der Abgleich die Finger.
const HERKUNFT_AUTOMATISCH = new Set(["lead", "kunde-setup", "kunde-monat"]);

// Faellt weich aus: In scripts/whiteboard-probe.js laeuft das Whiteboard
// bewusst OHNE Datenbank (Arbeitsspeicher-Fassung) — ein harter Fehler hier
// haette die ganze Probe lahmgelegt. Ein kaputter Teil darf nie die ganze
// Seite reissen.
async function listenLesen(user) {
  try {
    return await crm.alsNutzer(user.id, async (q) => {
      const { rows } = await q(
        `select ${ZEILEN_SPALTEN} from whiteboard_listenzeilen order by liste, position, erstellt`);
      return rows;
    });
  } catch (fehler) {
    console.error("Whiteboard-Listen lesen:", fehler.message);
    return [];
  }
}

// DIE RETAINER GANZ NACH OBEN (20.09.2026, Vorgabe Lukas).
//
// Warum beim Lesen sortiert wird und nicht ueber die Position in der
// Datenbank: Die Position gehoert dem Menschen — sie entsteht beim Ziehen.
// Wuerde der Abgleich sie jeden Monat neu vergeben, waere jede von Hand
// gezogene Reihenfolge nach 30 Sekunden wieder weg. So bleibt beides: Die
// Betreuung steht immer oben, und INNERHALB der Gruppen gilt weiter, was
// jemand gezogen hat.
//
// Drei Raenge auf der Kunden-Tafel:
//   0  die Monatszeilen der Betreuung — sie kommen jeden Monat wieder
//   1  die einmalige Gebuehr eines Retainer-Kunden — gehoert zu ihm
//   2  alles andere
//
// Die Frage "wer ist Retainer-Kunde" wird mit crm.system() gestellt, nicht
// unter den Rechten des Lesenden: Sonst haetten zwei Leute dieselbe Tafel in
// verschiedener Reihenfolge vor sich.
async function retainerFirmen() {
  try {
    const { rows } = await crm.system(
      `select id from public.firmen where status = 'kunde' and coalesce(preis_monatlich, 0) > 0`);
    return new Set(rows.map((r) => String(r.id)));
  } catch (fehler) {
    console.error("Retainer-Firmen lesen:", fehler.message);
    return new Set();
  }
}

function listenRang(zeile, retainer) {
  if (zeile.liste !== "kunden") return 0;
  if (zeile.herkunft === "kunde-monat") return 0;
  return retainer.has(String(zeile.firma_id)) ? 1 : 2;
}

// ---------------------------------------------------------------------------
// DER ABGLEICH
// ---------------------------------------------------------------------------
//
// Laeuft mit crm.system() und damit OHNE Zeilenrechte — mit Absicht. Die
// beiden Tafeln gehoeren dem ganzen Team, nicht einer Person. Liefe der
// Abgleich unter den Rechten dessen, der die Seite gerade offen hat, wuerde er
// jede Zeile loeschen, deren Firma dieser eine Mensch nicht sehen darf. Ein
// Blick auf die Tafel wuerde sie leerraeumen.
//
// Der Abgleich ist beliebig oft wiederholbar: Er vergleicht Soll und Ist ueber
// (liste, firma_id, herkunft, posten) und fasst nur an, was sich unterscheidet.
// Der eindeutige Index aus 0077 haelt das auch dann durch, wenn zwei Leute die
// Tafel im selben Moment oeffnen.

const geldText = (n) => new Intl.NumberFormat("de-DE").format(Math.round(Number(n) || 0)) + " €";
const monatsSchluessel = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// Wie viel von der einmaligen Gebuehr da ist — in der Sprache der Tafel.
// bezahlt_betrag schlaegt den groben Zahlungsstand (Migration 0072): "500 von
// 1.500" ist weder halb noch ganz, zaehlt hier aber als angefangen.
function setupBezahlt(f) {
  const setup = Number(f.preis_setup) || 0;
  const genau = f.bezahlt_betrag === null || f.bezahlt_betrag === undefined ? null : Number(f.bezahlt_betrag);
  if (genau !== null) return genau >= setup - 0.01 ? "ganz" : genau > 0 ? "50%" : "nein";
  return { "100": "ganz", "50": "50%" }[String(f.rechnung_stand || "")] || "nein";
}

async function listenSoll(q) {
  const { wahrsch, zaehltInPipeline } = require("./pipeline-quoten.js");
  const soll = [];

  // --- Leads: ab dem Gespraech, dieselbe Schwelle wie das Pipeline-Volumen ---
  const { rows: leads } = await q(
    `select f.id, f.name, f.preis_setup, f.preis_monatlich, f.vertrag_laufzeit, f.preis_geschaetzt,
            s.name as stufe, s.position,
            (select count(*) from pipeline_stages s2
              where s2.sparte = s.sparte and s2.art = s.art) as stufen_gesamt
       from deals d
       join firmen f on f.id = d.firma_id
       left join pipeline_stages s on s.id = d.stufe_id
      where d.status = 'offen' and f.status = 'lead'
      order by s.position desc, f.name`);
  for (const l of leads) {
    const anzahl = Number(l.stufen_gesamt || 1), i = Math.max(0, Number(l.position || 1) - 1);
    if (!zaehltInPipeline(anzahl, i, l.stufe)) continue;
    const wert = crm.dealWert(l);
    const monatlich = Number(l.preis_monatlich) || 0;
    soll.push({
      liste: "leads", firma_id: String(l.id), firma_name: l.name,
      herkunft: "lead", posten: "",
      // Das "≈" sagt dasselbe wie auf der Pipeline-Karte: noch nicht
      // vereinbart. Ohne Preis steht das auch da — der Lead gehoert trotzdem
      // auf die Tafel, und die fehlende Zahl faellt so von selbst auf.
      preis: (wert
        ? (l.preis_geschaetzt ? "≈ " : "") + geldText(wert)
          + (monatlich ? ` (${geldText(l.preis_setup)} + ${geldText(monatlich)}/Monat)` : "")
        : "Preis noch offen")
        + ` · ${l.stufe || "offen"}`,
      bezahlt: "",
    });
  }

  // --- Kunden: die einmalige Gebuehr ---
  const { rows: kunden } = await q(
    `select f.id, f.name, f.kunde_seit, f.preis_setup, f.preis_monatlich, f.vertrag_laufzeit,
            f.rechnung_stand, f.bezahlt_betrag
       from firmen f
      where f.status = 'kunde' and f.kunde_seit is not null
      order by f.kunde_seit desc, f.name`);
  for (const k of kunden) {
    if (!(Number(k.preis_setup) > 0)) continue;
    const bezahlt = setupBezahlt(k);
    // Vollstaendig bezahlt: gehoert nicht mehr auf die Arbeitsliste.
    if (bezahlt === "ganz") continue;
    soll.push({
      liste: "kunden", firma_id: String(k.id), firma_name: k.name,
      herkunft: "kunde-setup", posten: "",
      preis: geldText(k.preis_setup) + " einmalig", bezahlt,
    });
  }

  // --- Kunden: jeder Retainer-Monat, der schon angefallen ist ---
  //
  // Gerechnet wie in crm.umsatzAnfall (Monat fuer Monat ab dem Monat NACH dem
  // Abschluss), nicht aus retainer_monate gelesen: Dort stehen nur Monate, die
  // schon einmal angefasst wurden. Ein Kunde, bei dem noch niemand einen Haken
  // gesetzt hat, haette sonst keine einzige Zeile.
  const { rows: bezahlteMonate } = await q(
    `select firma_id, to_char(monat, 'YYYY-MM') as schluessel, bezahlt
       from retainer_monate where bezahlt`);
  const schonBezahlt = new Set(bezahlteMonate.map((m) => `${m.firma_id}|${m.schluessel}`));
  const jetzt = monatsSchluessel(new Date());
  for (const k of kunden) {
    const monatlich = Number(k.preis_monatlich) || 0;
    if (monatlich <= 0) continue;
    const start = new Date(k.kunde_seit);
    if (Number.isNaN(start.getTime())) continue;
    const laufzeit = crm.monateJeLaufzeit(k.vertrag_laufzeit);
    for (let n = 1; n <= laufzeit; n++) {
      const d = new Date(start.getFullYear(), start.getMonth() + n, 1);
      const schluessel = monatsSchluessel(d);
      // Erst wenn der Monat begonnen hat. Der Oktober erscheint am 1. Oktober.
      if (schluessel > jetzt) break;
      if (schonBezahlt.has(`${k.id}|${schluessel}`)) continue;
      soll.push({
        liste: "kunden", firma_id: String(k.id), firma_name: k.name,
        herkunft: "kunde-monat", posten: schluessel,
        preis: geldText(monatlich) + " monatlich · Retainer "
          + d.toLocaleDateString("de-DE", { month: "long", year: "numeric" }),
        bezahlt: "nein",
      });
    }
  }
  return soll;
}

// Nicht bei jedem Abruf: Die Tafel fragt alle 20 Sekunden nach. Der Abgleich
// liest drei Tabellen — das muss nicht viermal pro Minute sein. Beim Aufruf
// der Seite laeuft er trotzdem immer (erzwingen = true), damit man nie auf
// eine veraltete Tafel schaut.
let letzterAbgleich = 0;
const ABGLEICH_PAUSE = 30000;

async function listenAbgleichen(erzwingen = false) {
  const jetzt = Date.now();
  if (!erzwingen && jetzt - letzterAbgleich < ABGLEICH_PAUSE) return { uebersprungen: true };
  letzterAbgleich = jetzt;
  try {
    const schluessel = (z) => [z.liste, z.firma_id, z.herkunft, z.posten || ""].join("|");
    const soll = await listenSoll((sql, a) => crm.system(sql, a));
    const { rows: ist } = await crm.system(
      `select id, liste, firma_id, herkunft, posten, preis, bezahlt
         from public.whiteboard_listenzeilen where herkunft is not null`);
    const sollNach = new Map(soll.map((z) => [schluessel(z), z]));
    const istNach = new Map(ist.map((z) => [schluessel(z), z]));

    let weg = 0, neu = 0, geaendert = 0;
    // Was nicht mehr hingehoert — bezahlt, verloren, Lead zurueckgestuft.
    for (const [k, z] of istNach) {
      if (sollNach.has(k)) continue;
      await crm.system(`delete from public.whiteboard_listenzeilen where id = $1`, [z.id]);
      weg += 1;
    }
    // Was fehlt oder sich geaendert hat. Die Notiz bleibt, wie sie ist.
    const { rows: [p] } = await crm.system(
      `select coalesce(max(position), -1) as p from public.whiteboard_listenzeilen`);
    let position = Number(p.p);
    for (const [k, z] of sollNach) {
      const da = istNach.get(k);
      if (!da) {
        position += 1;
        await crm.system(
          `insert into public.whiteboard_listenzeilen
             (liste, firma_id, firma_name, preis, bezahlt, position, herkunft, posten)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict do nothing`,
          [z.liste, z.firma_id, z.firma_name, z.preis, z.bezahlt, position, z.herkunft, z.posten]);
        neu += 1;
        continue;
      }
      if (String(da.preis || "") === z.preis && String(da.bezahlt || "") === z.bezahlt) continue;
      await crm.system(
        `update public.whiteboard_listenzeilen set preis = $2, bezahlt = $3 where id = $1`,
        [da.id, z.preis, z.bezahlt]);
      geaendert += 1;
    }
    return { ok: true, neu, weg, geaendert };
  } catch (fehler) {
    // Ein misslungener Abgleich darf die Tafel nicht kosten: Dann steht dort
    // eben der Stand von vorhin.
    console.error("Whiteboard-Listen abgleichen:", fehler.message);
    return { ok: false, grund: fehler.message };
  }
}

// Was auf der Tafel angehakt wird, gehoert in die Akte — sonst waere es beim
// naechsten Abgleich wieder weg, weil der Wert ja von dort kommt.
//
//   ganz -> voll bezahlt      50% -> halb      nein -> nichts
//
// bezahlt_betrag wird dabei geleert: Es ist der GENAUE Betrag und schlaegt den
// Zahlungsstand. Bliebe er stehen, haette der Haken auf der Tafel keine
// Wirkung — und niemand kaeme darauf, warum.
async function zurueckInDieAkte(user, zeile, wert) {
  const STAND = { ganz: "100", "50%": "50", nein: "offen" };
  if (zeile.herkunft === "kunde-setup") {
    await crm.kundeAendern(user, zeile.firma_id, {
      rechnung_stand: STAND[wert] || "offen", bezahlt_betrag: "",
    });
  } else if (zeile.herkunft === "kunde-monat") {
    await crm.retainerMonateSetzen(user, zeile.firma_id, [{
      schluessel: zeile.posten, gestellt: wert === "ganz", bezahlt: wert === "ganz",
    }]);
  } else {
    return false; // Lead-Zeilen haben keinen Zahlungsstand in der Akte.
  }
  await crm.einnahmeAusAkte(user, zeile.firma_id).catch((e) =>
    console.error("Einnahme nach Tafel-Haken:", e.message));
  return true;
}

function nachListe(zeilen, retainer = new Set()) {
  const aus = { kunden: [], leads: [] };
  for (const z of zeilen) if (aus[z.liste]) aus[z.liste].push(z);
  for (const liste of Object.keys(aus)) {
    aus[liste] = aus[liste]
      .map((z, i) => ({ z, i, rang: listenRang(z, retainer) }))
      // Der Ursprungsindex haelt die Reihenfolge innerhalb eines Ranges
      // stabil — sie kam schon sortiert aus der Datenbank (position, erstellt).
      .sort((a, b) => a.rang - b.rang || a.i - b.i)
      .map((x) => x.z);
  }
  return aus;
}

async function listeZeileAnlegen(user, liste) {
  return crm.alsNutzer(user.id, async (q) => {
    const { rows: [p] } = await q(
      `select coalesce(max(position), -1) + 1 as p from whiteboard_listenzeilen where liste = $1`, [liste]);
    const { rows: [z] } = await q(
      `insert into whiteboard_listenzeilen (liste, position) values ($1, $2)
       returning ${ZEILEN_SPALTEN}`, [liste, p.p]);
    return z;
  });
}

// Ein Eintrag im Verlauf der Akte — dieselbe Form wie crm.notiz(). Das update
// auf letzte_aktivitaet trifft unter den Zeilenrechten nur, wer die Firma
// aendern darf; fuer alle anderen bleibt es folgenlos, der Eintrag steht trotzdem.
async function inDieAkte(q, user, firmaId, text) {
  await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1, $2, 'notiz', $3)`,
    [firmaId, user.id, text.slice(0, 1000)]);
  await q(`update firmen set letzte_aktivitaet = now() where id = $1`, [firmaId]);
}

const aktenText = (liste, feld, wert) => feld === "notiz1"
  ? `Whiteboard ${LISTEN_TITEL[liste]}: ${wert}`
  : `Whiteboard ${LISTEN_TITEL[liste]} · ${feld === "preis" ? "Preis" : "Bezahlt"}: ${wert}`;

// { ok, akte } — akte sagt, ob der Eintrag auch im Verlauf der Firma steht.
// Dorthin kommt nur, was sich wirklich geaendert hat und nicht leer ist: Ein
// Feld zu leeren oder unveraendert zu verlassen ist keine Nachricht.
async function listeZeileAendern(user, id, feld, wert) {
  // feld kommt aus ZEILENFELDER (vom Aufrufer geprueft) — trotzdem hier
  // nochmal, direkt vor der Verwendung im SQL-Text: Wer die Pruefung beim
  // naechsten Umbau vor den Aufruf vergisst, baut sich sonst eine Injektion.
  if (!ZEILENFELDER.has(feld)) return { ok: false };
  if (feld === "bezahlt" && !BEZAHLT_WERTE.has(wert)) return { ok: false, grund: "wert" };
  const ergebnis = await crm.alsNutzer(user.id, async (q) => {
    const { rows: [alt] } = await q(
      `select liste, firma_id, herkunft, posten, ${feld} as wert
         from whiteboard_listenzeilen where id = $1`, [id]);
    if (!alt) return { ok: false };
    // Der Preis einer erzeugten Zeile kommt aus der Akte. Ihn hier zu
    // ueberschreiben waere folgenlos — der naechste Abgleich schriebe den
    // alten Wert zurueck. Lieber ehrlich ablehnen als still vergessen.
    if (feld === "preis" && HERKUNFT_AUTOMATISCH.has(alt.herkunft || "")) {
      return { ok: false, grund: "automatisch" };
    }
    await q(`update whiteboard_listenzeilen set ${feld} = $2 where id = $1`, [id, wert]);
    const neu = wert.trim();
    if (!alt.firma_id || !neu || neu === String(alt.wert || "").trim()) {
      return { ok: true, akte: false, zeile: alt, geaendert: false };
    }
    await inDieAkte(q, user, alt.firma_id, aktenText(alt.liste, feld, neu));
    return { ok: true, akte: true, zeile: alt, geaendert: true };
  });
  // Der Zahlungsstand wandert in die Akte — NACH der Transaktion oben, weil
  // kundeAendern und einnahmeAusAkte ihre eigene fahren.
  if (ergebnis.ok && ergebnis.geaendert && feld === "bezahlt"
      && HERKUNFT_AUTOMATISCH.has((ergebnis.zeile || {}).herkunft || "")) {
    try {
      const gewirkt = await zurueckInDieAkte(user, ergebnis.zeile, wert);
      // Voll bezahlt heisst: Die Zeile hat ihren Zweck erfuellt. Der naechste
      // Abgleich raeumt sie weg — der Tafel sagen wir es gleich.
      if (gewirkt) return { ...ergebnis, akte: true, erledigt: wert === "ganz" };
    } catch (fehler) {
      console.error("Zahlungsstand von der Tafel in die Akte:", fehler.message);
      return { ok: false, grund: "akte" };
    }
  }
  return ergebnis;
}

// Firma waehlen — nur eine, die der Waehlende sehen darf (Zeilenrechte) und
// die zur Tafel passt. Was schon in der Zeile steht, geht beim Waehlen gleich
// mit in die Akte: Sonst kaeme eine Notiz, die VOR der Firma getippt wurde,
// dort nie an.
async function listeFirmaSetzen(user, id, firmaId) {
  return crm.alsNutzer(user.id, async (q) => {
    const { rows: [z] } = await q(`select ${ZEILEN_SPALTEN} from whiteboard_listenzeilen where id = $1`, [id]);
    if (!z) return { ok: false, grund: "zeile" };
    // Die Firma einer erzeugten Zeile steht fest — sie IST der Posten.
    if (HERKUNFT_AUTOMATISCH.has(z.herkunft || "")) return { ok: false, grund: "automatisch" };
    const { rows: [f] } = await q(`select id, name, status from firmen where id = $1`, [firmaId]);
    if (!f || f.status !== LISTEN_STATUS[z.liste]) return { ok: false, grund: "firma" };
    const { rows: [neu] } = await q(
      `update whiteboard_listenzeilen set firma_id = $2, firma_name = $3 where id = $1
       returning ${ZEILEN_SPALTEN}`, [id, f.id, f.name]);
    if (String(z.firma_id) === String(f.id)) return { ok: true, zeile: neu, akte: false };
    const teile = [String(neu.notiz1 || "").trim()].filter(Boolean);
    if (String(neu.preis || "").trim()) teile.push("Preis: " + neu.preis.trim());
    if (String(neu.bezahlt || "").trim()) teile.push("Bezahlt: " + neu.bezahlt.trim());
    await inDieAkte(q, user, f.id, `Auf das Whiteboard ${LISTEN_TITEL[z.liste]} gesetzt`
      + (teile.length ? " — " + teile.join(" · ") : ""));
    return { ok: true, zeile: neu, akte: true };
  });
}

// Vorschlaege fuer die Firmenwahl, mit Zeilenrechten. Ohne Suchwort die
// zuletzt bewegten — die stehen meist als naechstes an.
async function listeFirmenSuchen(user, liste, suche) {
  return crm.alsNutzer(user.id, async (q) => {
    const a = [LISTEN_STATUS[liste]];
    let bedingung = "";
    if (suche) { a.push(`%${suche}%`); bedingung = " and (name ilike $2 or ort ilike $2)"; }
    const { rows } = await q(
      `select id, name, ort from firmen where status = $1${bedingung}
        order by ${suche ? "name" : "letzte_aktivitaet desc nulls last"} limit 12`, a);
    return rows;
  });
}

async function listeZeileLoeschen(user, id) {
  return crm.alsNutzer(user.id, async (q) => {
    // Eine erzeugte Zeile zu loeschen hiesse, sie 30 Sekunden spaeter wieder
    // dastehen zu sehen — der Abgleich legt sie neu an, solange der Posten
    // offen ist. Sie verschwindet, wenn sie bezahlt ist, und nur dann.
    const { rows: [z] } = await q(
      `select herkunft from whiteboard_listenzeilen where id = $1`, [id]);
    if (!z) return false;
    if (HERKUNFT_AUTOMATISCH.has(z.herkunft || "")) return { ok: false, grund: "automatisch" };
    const { rowCount } = await q(`delete from whiteboard_listenzeilen where id = $1`, [id]);
    return rowCount === 1;
  });
}

async function listeSortieren(user, liste, ids) {
  return crm.alsNutzer(user.id, async (q) => {
    for (let i = 0; i < ids.length; i++) {
      await q(`update whiteboard_listenzeilen set position = $1 where id = $2 and liste = $3`, [i, ids[i], liste]);
    }
    return true;
  });
}

// Eine Zeile darf einen Link tragen ("100 Cold Calls" -> die Anrufliste im
// CRM, "Webseite bauen" -> die Seite, "E-Mail an X" -> mailto). Nur http(s),
// mailto und eigene Pfade ("/crm/firma/12", seit 05.09.2026 fuer die Zeilen
// aus dem CRM; der Client liess sie schon zu, LINK_ERLAUBT in whiteboard.js).
// Ein eigener Pfad beginnt mit GENAU einem Schraegstrich: "//boese.de" waere
// eine fremde Adresse ohne Protokoll. javascript:-Adressen und alles andere
// fliegen raus, BEVOR sie in der Datenbank landen: Ein Klick auf einen Link
// darf nie Code ausfuehren.
const LINK = /^(?:(?:https?:\/\/|mailto:)\S{1,500}|\/[^\/\s]\S{0,498})$/i;

const ganz = (wert, min, max) => {
  const n = Math.round(Number(wert));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// Steuerzeichen und unsichtbare Breiten raus — sie kommen ueber Paste herein
// und machen spaeter "gleiche" Zeilen ungleich.
const textSaeubern = (s) => String(s ?? "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF]/g, "")
  .slice(0, GRENZEN.zeichenJeZeile);

// Prueft ein Element und liefert die Werte zurueck, wie sie gespeichert werden.
// inhaltNoetig=false beim Aendern: dort darf inhalt fehlen (nur Position bewegt).
function pruefeElement(roh, { inhaltNoetig = true } = {}) {
  if (!roh || typeof roh !== "object") return { ok: false, grund: "leer" };
  if (!ARTEN.has(roh.art)) return { ok: false, grund: "art" };

  const raus = { art: roh.art };
  for (const [feld, min, max] of [["x", -100000, 100000], ["y", -100000, 100000],
                                  ["breite", 0, 100000], ["hoehe", 0, 100000]]) {
    if (roh[feld] === undefined) continue;
    const n = ganz(roh[feld], min, max);
    if (n === null) return { ok: false, grund: feld };
    raus[feld] = n;
  }

  if (roh.inhalt === undefined) {
    if (inhaltNoetig) return { ok: false, grund: "inhalt" };
    return { ok: true, ...raus };
  }
  const i = roh.inhalt;
  if (!i || typeof i !== "object") return { ok: false, grund: "inhalt" };

  let sauber;
  if (roh.art === "strich") {
    const p = i.punkte;
    if (!Array.isArray(p) || p.length < 4 || p.length > GRENZEN.punkte || p.length % 2)
      return { ok: false, grund: "punkte" };
    const punkte = new Array(p.length);
    for (let k = 0; k < p.length; k++) {
      const n = ganz(p[k], -100000, 100000);
      if (n === null) return { ok: false, grund: "punkte" };
      punkte[k] = n;
    }
    const dicke = ganz(i.dicke, 1, 40);
    if (!FARBEN.has(i.farbe) || dicke === null) return { ok: false, grund: "stift" };
    sauber = { punkte, farbe: i.farbe, dicke };
  } else {
    if (!Array.isArray(i.zeilen) || !i.zeilen.length || i.zeilen.length > GRENZEN.zeilen)
      return { ok: false, grund: "zeilen" };
    const zeilen = i.zeilen.map((z) => {
      const zeile = {
        t: textSaeubern(z && z.t),
        erledigt: Boolean(z && z.erledigt),
        gestrichen: Boolean(z && z.gestrichen),
      };
      const link = String((z && z.link) || "").trim();
      if (link && LINK.test(link)) zeile.link = link;
      // Eine Antwort auf die Zeile (31.08.2026): "Partner angefragt, warte auf
      // Rueckmeldung". Sie beantwortet nicht die Frage "erledigt?", sondern
      // "kann ich hier gerade weiterarbeiten?" — die Oberflaeche blendet eine
      // beantwortete Zeile darum ab. Nimmt man die Antwort weg, steht die
      // Aufgabe wieder normal da. Gleiche Saeuberung und Laengengrenze wie der
      // Zeilentext selbst.
      const antwort = textSaeubern(z && z.antwort).trim();
      if (antwort) zeile.antwort = antwort;
      // Der Aufgaben-Bezug (05.09.2026): aufgaben.id der CRM-Aufgabe, aus der
      // die Zeile stammt. Nur eine positive ganze Zahl kommt durch — und sie
      // MUSS durchkommen, sonst verloere jeder Tastendruck im Block die
      // Verbindung, und der Haken liefe nicht mehr in die Aufgabenliste.
      const aufgabe = ganz(z && z.aufgabe, 1, 9e15);
      if (aufgabe !== null) zeile.aufgabe = aufgabe;
      // Teilstriche (31.08.2026): "Matten beantworten und Anpassung umsetzen"
      // ist zwei Dinge — geantwortet ist er schon, die Anpassung steht noch
      // aus. Darum darf nicht nur die GANZE Zeile durchgestrichen werden,
      // sondern auch ein Stueck davon. Gespeichert als Zeichenbereiche in "t":
      // [[0,11]] streicht "beantworten" durch.
      //
      // Der Server raeumt sie auf, statt sie nur durchzuwinken: Bereiche
      // ausserhalb des Textes waeren beim Anzeigen ein Griff ins Leere, und
      // ueberlappende oder unsortierte wuerden beim Aufteilen der Zeile in
      // Stuecke Zeichen doppelt zeigen. Was hier herauskommt, ist immer
      // sortiert, ueberschneidungsfrei und liegt im Text.
      const striche = Array.isArray(z && z.striche) ? z.striche : null;
      if (striche && striche.length) {
        const laenge = zeile.t.length;
        const sauber = [];
        for (const paar of striche.slice(0, GRENZEN.striche)) {
          if (!Array.isArray(paar) || paar.length !== 2) continue;
          const von = ganz(paar[0], 0, laenge);
          const bis = ganz(paar[1], 0, laenge);
          if (von === null || bis === null || bis <= von) continue;
          sauber.push([von, bis]);
        }
        sauber.sort((a, b) => a[0] - b[0]);
        const verschmolzen = [];
        for (const [von, bis] of sauber) {
          const letzter = verschmolzen[verschmolzen.length - 1];
          // Aneinandergrenzende Bereiche werden EIN Bereich — sonst waechst
          // die Liste bei jedem Streichen weiter, ohne dass man es sieht.
          if (letzter && von <= letzter[1]) letzter[1] = Math.max(letzter[1], bis);
          else verschmolzen.push([von, bis]);
        }
        // Deckt ein Bereich die ganze Zeile, ist das schlicht "durchgestrichen".
        if (verschmolzen.length === 1 && verschmolzen[0][0] === 0
            && verschmolzen[0][1] === laenge && laenge > 0) {
          zeile.gestrichen = true;
        } else if (verschmolzen.length) {
          zeile.striche = verschmolzen;
        }
      }
      return zeile;
    });
    const groesse = ganz(i.groesse, 14, 64);
    if (!LISTEN.has(i.liste) || !FARBEN.has(i.farbe) || groesse === null)
      return { ok: false, grund: "block" };
    sauber = { zeilen, liste: i.liste, farbe: i.farbe, groesse };
    // Nur setzen, wenn sie da UND gueltig ist: Ein Block ohne Einordnung ist
    // ausdruecklich erlaubt (freies Kritzeln bleibt frei).
    if (KATEGORIEN.includes(i.kategorie)) sauber.kategorie = i.kategorie;
    if (roh.art === "notiz") {
      if (!ZETTEL.has(i.zettel)) return { ok: false, grund: "zettel" };
      sauber.zettel = i.zettel;
    }
  }

  const inhalt = JSON.stringify(sauber);
  if (inhalt.length > GRENZEN.inhalt) return { ok: false, grund: "zu-gross" };
  return { ok: true, ...raus, inhalt };
}

// Wer hat in den letzten Sekunden gepollt? Fuer den gruenen Punkt am
// Namensschild. Bewusst nur im Arbeitsspeicher: Anwesenheit ist fluechtig,
// eine Tabelle dafuer waere Buchhaltung ueber nichts.
const zuletztGesehen = new Map();
const ANWESEND_MS = 15000;
const anwesende = () => {
  const grenze = Date.now() - ANWESEND_MS;
  return [...zuletztGesehen.entries()].filter(([, t]) => t > grenze).map(([id]) => id);
};

module.exports = function (app, optionen = {}) {
  const speicher = optionen.speicher || pgSpeicher();
  const teamHolen = optionen.team || ((user) => crm.team(user));

  // Auf wessen Tafel darf geschrieben werden? Auf jede, die es GIBT — aber
  // nur auf die. Ohne diese Pruefung wuerde eine getippte fremde uuid am
  // Fremdschluessel zerschellen (haesslicher 500er) oder, schlimmer, im
  // Arbeitsspeicher der Probe ein Geister-Board erzeugen. Die Team-Liste
  // aendert sich selten, darum reicht ein 60-Sekunden-Gedaechtnis.
  let teamMerker = { ids: null, bis: 0 };
  const tafelGueltig = async (user, tafel) => {
    if (!tafel || tafel === user.id) return true;
    if (Date.now() > teamMerker.bis) {
      const team = await teamHolen(user);
      teamMerker = { ids: new Set(team.map((p) => p.id)), bis: Date.now() + 60000 };
    }
    return teamMerker.ids.has(tafel);
  };

  // Boards haengen am persoenlichen Konto (besitzer). Ohne persoenliche
  // Anmeldung gibt es keine Tafel — gleiche Regel wie bei den To-Dos.
  const angemeldet = (req, res, next) => {
    if (!req.session || !req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    next();
  };
  // Die API antwortet mit 401 statt Umleitung: Der Poll-Fetch einer laengst
  // offenen Seite wuerde einer Umleitung folgen und HTML als JSON parsen —
  // das gaebe den nutzlosesten aller Fehler. So sieht der Client "anmeldung"
  // und zeigt das Anmelde-Overlay.
  const angemeldetApi = (req, res, next) => {
    if (!req.session || !req.session.crm)
      return res.status(401).json({ ok: false, anmeldung: true, grund: "anmeldung" });
    req.nutzer = req.session.crm;
    next();
  };

  // ------------------------------------------------------------- Seite
  app.get("/whiteboard", angemeldet, async (req, res, next) => {
    try {
      const u = req.nutzer;
      // Beim Oeffnen der Seite immer abgleichen: Niemand soll auf eine Tafel
      // schauen, auf der der Monat von gestern steht.
      await listenAbgleichen(true);
      const [team, stand, listenzeilen, retainer] = await Promise.all([
        teamHolen(u), speicher.alle(u), listenLesen(u), retainerFirmen()]);
      const daten = {
        ich: { id: u.id, name: u.name, rolle: u.rolle },
        team, // [{id, name, rolle}] — Reihenfolge = Reihenfolge der Boards an der Wand
        elemente: stand.elemente,
        aktivitaet: stand.aktivitaet,
        anwesend: anwesende(),
        jetzt: stand.jetzt,
        grenzen: { zeilen: GRENZEN.zeilen, zeichenJeZeile: GRENZEN.zeichenJeZeile, punkte: GRENZEN.punkte },
        // Die zwei Listen-Tafeln unter den Personen (whiteboard-listen.js).
        // crmZugang: Wer das CRM nicht oeffnen darf, bekommt keine Firmenwahl
        // — deren Vorschlaege waeren Kundennamen.
        listen: nachListe(listenzeilen, retainer),
        crmZugang: darfModul(u, "crm"),
      };
      res.send(schale({
        titel: "Whiteboard", aktiv: "zentrale-whiteboard", nutzer: u,
        unterzeile: "Eine Tafel je Person, darunter Kunden und Leads",
        inhalt: `
        <link rel="stylesheet" href="${v("/whiteboard.css")}">
        <div id="wb-wurzel" class="wb-wurzel">
          <noscript><div class="hinweis warn" style="margin:24px">
            Das Whiteboard braucht JavaScript — ohne geht hier nichts.
          </div></noscript>
        </div>

        ${/* "<" wird maskiert, damit ein boesartiger Textinhalt ("</script>…")
              das Skript-Tag nicht verlassen kann. */""}
        <script>window.WB_DATEN = ${JSON.stringify(daten).replace(/</g, "\\u003c")};</script>
        <script src="${v("/lib/gsap.min.js")}"></script>
        <script src="${v("/lib/whiteboard.js")}"></script>
        <script src="${v("/lib/whiteboard-listen.js")}"></script>`,
      }));
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------- Lesen
  // Ohne "seit": kompletter Stand (Erstaufbau, Aufraeumen nach Fehlern).
  // Mit "seit": nur was sich getan hat — inklusive Tombstones. Als naechstes
  // "seit" IMMER das mitgelieferte "jetzt" verwenden, nie die eigene Uhr:
  // Client-Uhren gehen falsch, die des Servers ist die einzige, die zaehlt.
  app.get("/api/whiteboard/elemente", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      // "tafel" filtert aufs Board; "besitzer" bleibt als alter Name desselben
      // Filters bestehen, damit kein Aufrufer der ersten Fassung bricht.
      const tafel = String(req.query.tafel || req.query.besitzer || "");
      if (tafel && !UUID.test(tafel))
        return res.status(400).json({ ok: false, grund: "tafel" });
      const seit = String(req.query.seit || "");
      const stand = seit && !Number.isNaN(new Date(seit).getTime())
        ? await speicher.delta(req.nutzer, { seit, tafel })
        : await speicher.alle(req.nutzer);
      res.json({ ok: true, anwesend: anwesende(), ...stand });
    } catch (fehler) {
      console.error("Whiteboard lesen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  // ------------------------------------------------------------- Verknuepfen
  //
  // Vorschlaege fuer den Link einer Zeile (Wunsch vom 31.08.2026): Wer
  // "100 Cold Calls für YoKan" schreibt, soll die Anrufliste danebenhaengen
  // koennen; bei "E-Mail an Herrn Müller" die Adresse, bei "Webseite bauen
  // für X" deren Seite. Die Daten liegen laengst im CRM — sie noch einmal von
  // Hand einzutippen waere die schlechteste Art, sie zu haben.
  //
  // Gesucht wird ueber crm.firmenListe(): eine Firma liefert bis zu drei
  // Vorschlaege (Kundenakte, E-Mail, Webseite), dazu die Anruflisten. Die
  // Suche laeuft ueber crm.alsNutzer, also mit Zeilenrechten — ein
  // Mitarbeiter bekommt nur Firmen vorgeschlagen, die er ohnehin sehen darf.
  //
  // Zusaetzlich der Bereichs-Riegel: Wer das CRM gar nicht geoeffnet bekommt,
  // bekommt hier auch keine Kundennamen zu sehen. Der Torwaechter in
  // server.js kann das nicht leisten — fuer ihn ist das hier "whiteboard".
  app.get("/api/whiteboard/verknuepfung", angemeldetApi, async (req, res) => {
    const q = String(req.query.q || "").trim().slice(0, 80);
    if (q.length < 2) return res.json({ ok: true, treffer: [] });
    if (!darfModul(req.nutzer, "crm"))
      return res.json({ ok: true, treffer: [], grund: "kein-crm" });
    try {
      const [firmen, listen] = await Promise.all([
        crm.firmenListe(req.nutzer, { suche: q, limit: 8 }),
        crm.leadListen(req.nutzer).catch(() => []),
      ]);
      const treffer = [];
      for (const f of firmen) {
        treffer.push({ art: "kunde", titel: f.name, unter: f.ort || "Kundenakte",
                       url: `/crm/firma/${f.id}` });
        if (f.email) treffer.push({ art: "mail", titel: `E-Mail an ${f.name}`,
                                    unter: f.email, url: `mailto:${f.email}` });
        // Webseiten stehen im CRM oft ohne Vorsilbe ("kunde.de") — ohne
        // https:// wuerde der Browser das als Unterseite des Dashboards lesen.
        if (f.website) {
          const url = /^https?:\/\//i.test(f.website) ? f.website : `https://${f.website}`;
          treffer.push({ art: "web", titel: `Webseite ${f.name}`, unter: f.website, url });
        }
      }
      const suchwort = q.toLowerCase();
      for (const l of listen) {
        if (!String(l.name || "").toLowerCase().includes(suchwort)) continue;
        treffer.push({ art: "liste", titel: l.name,
                       unter: `Anrufliste${l.offen ? ` · ${l.offen} offen` : ""}`,
                       url: `/crm/leads?liste=${l.id}` });
      }
      res.json({ ok: true, treffer: treffer.slice(0, 12) });
    } catch (fehler) {
      console.error("Whiteboard verknuepfen:", fehler.message);
      // Keine 500er-Kaskade im Tippfluss: Die Zeile wird auch ohne
      // Vorschlaege geschrieben, der Link laesst sich von Hand einfuegen.
      res.json({ ok: true, treffer: [], grund: "fehler" });
    }
  });

  // ------------------------------------------------------------- Schreiben
  app.post("/api/whiteboard/anlegen", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      const id = String(req.body.id || "");
      if (!UUID.test(id)) return res.status(400).json({ ok: false, grund: "id" });
      // Ohne "tafel" landet das Element auf der eigenen; mit einer fremden
      // wird eine Aufgabe vergeben — die Tafel muss dann jemandem gehoeren.
      const tafel = String(req.body.tafel || req.nutzer.id);
      if (!UUID.test(tafel) || !(await tafelGueltig(req.nutzer, tafel)))
        return res.status(400).json({ ok: false, grund: "tafel" });
      const p = pruefeElement(req.body);
      if (!p.ok) return res.status(400).json({ ok: false, grund: p.grund });
      if (await speicher.anzahl(req.nutzer, tafel) >= GRENZEN.elementeJeBoard)
        return res.status(400).json({ ok: false, grund: "voll" });
      const r = await speicher.anlegen(req.nutzer, {
        id, tafel, art: p.art, x: p.x ?? 0, y: p.y ?? 0,
        breite: p.breite ?? 0, hoehe: p.hoehe ?? 0, inhalt: p.inhalt,
      });
      // Zeilen mit Aufgaben-Bezug, die in einem NEUEN Block landen (eine
      // abgegebene Zeile wandert mit ihrer Aufgabe): die Aufgabe merkt sich
      // ihren neuen Block. Ohne Vorher-Stand — hier wechselt kein Haken.
      if (r.ok && p.art !== "strich") {
        const ab = await aufgabenTafel.zeilenAbgleichen(req.nutzer,
          { element: id, vorher: null, nachher: JSON.parse(p.inhalt) });
        if (ab.neu.length) await aufgabenTafel.elementeNachziehen(req.nutzer, [id], { speicher });
      }
      res.json(r);
    } catch (fehler) {
      console.error("Whiteboard anlegen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  app.post("/api/whiteboard/aendern", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      const id = String(req.body.id || "");
      const version = ganz(req.body.version, 1, 1e9);
      if (!UUID.test(id) || version === null)
        return res.status(400).json({ ok: false, grund: "id" });
      const p = pruefeElement(req.body, { inhaltNoetig: false });
      if (!p.ok) return res.status(400).json({ ok: false, grund: p.grund });
      const { vorher, ...r } = await speicher.aendern(req.nutzer, {
        id, version, art: p.art,
        x: p.x, y: p.y, breite: p.breite, hoehe: p.hoehe, inhalt: p.inhalt,
      });
      // "veraltet" = eine andere Sitzung derselben Person hat dazwischen
      // gespeichert -> 409, der Client holt den echten Stand. "fehlt" = weg
      // (geloescht oder nie angekommen) -> 404, der Client raeumt lokal auf.
      if (!r.ok && r.grund === "veraltet") return res.status(409).json(r);
      if (!r.ok && r.grund === "fehlt") return res.status(404).json(r);
      // Haken auf einer Zeile aus dem CRM gewechselt? Dann in die Aufgaben-
      // liste durchreichen — als handelnde Person (RLS: Besitzer oder
      // Verantwortlicher; wer keins von beiden ist, aendert dort still
      // nichts). Der alte Stand kommt aus demselben Update (vorher), nur
      // der Browser bekommt ihn nicht: er hat ihn ja gerade selbst ersetzt.
      if (r.ok && p.inhalt !== undefined && p.art !== "strich") {
        const ab = await aufgabenTafel.zeilenAbgleichen(req.nutzer,
          { element: id, vorher, nachher: JSON.parse(p.inhalt) });
        // Eine Aufgaben-Zeile, die in diesem Block NEU auftaucht, kommt
        // entweder aus einem anderen Block (verschoben) oder aus dem
        // Rueckgaengig-Stapel des Browsers (die Zeile war geloescht). Im
        // zweiten Fall traegt sie den Haken von damals — und derweil kann
        // die Liste laengst etwas anderes sagen. Dieselbe Regel wie beim
        // wiederhergestellten Block (05.09.2026): die Liste ist die
        // Wahrheit, die Zeile zieht nach. Beim blossen Verschieben stimmen
        // beide ueberein, dann schreibt elementeNachziehen gar nichts.
        if (ab.neu.length) await aufgabenTafel.elementeNachziehen(req.nutzer, [id], { speicher });
      }
      res.json(r);
    } catch (fehler) {
      console.error("Whiteboard aendern:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  const idListe = (roh) => {
    if (!Array.isArray(roh) || !roh.length || roh.length > GRENZEN.ids) return null;
    const ids = roh.map(String);
    return ids.every((id) => UUID.test(id)) ? ids : null;
  };

  app.post("/api/whiteboard/loeschen", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      const ids = idListe(req.body.ids);
      if (!ids) return res.status(400).json({ ok: false, grund: "ids" });
      res.json(await speicher.loeschen(req.nutzer, ids));
    } catch (fehler) {
      console.error("Whiteboard loeschen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  app.post("/api/whiteboard/wiederherstellen", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      const ids = idListe(req.body.ids);
      if (!ids) return res.status(400).json({ ok: false, grund: "ids" });
      const r = await speicher.wiederherstellen(req.nutzer, ids);
      // Ein zurueckgeholter Block traegt die Haken von vor dem Wischen. Was
      // derweil in der Aufgabenliste abgehakt (oder wieder geoeffnet) wurde,
      // gilt — die Zeilen mit Aufgaben-Bezug ziehen nach. Die Antwort an den
      // Browser bleibt dieselbe; den neuen Stand bringt der Delta-Abgleich.
      if (r.ok && r.ids.length) await aufgabenTafel.elementeNachziehen(req.nutzer, r.ids, { speicher });
      res.json(r);
    } catch (fehler) {
      console.error("Whiteboard wiederherstellen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  // Die ganze eigene Tafel wischen. Die Bestaetigung ist Sache der Oberflaeche
  // (Dialog mit Elementzahl); zurueck kommen die ids — Undo stellt genau diese
  // Menge wieder her.
  app.post("/api/whiteboard/wischen", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      res.json(await speicher.wischen(req.nutzer));
    } catch (fehler) {
      console.error("Whiteboard wischen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  // ------------------------------------------------------------- Listen-Boards
  app.post("/api/whiteboard-liste/anlegen", angemeldetApi, async (req, res) => {
    try {
      const liste = String(req.body.liste || "");
      if (!LISTENBOARDS.has(liste)) return res.status(400).json({ ok: false, grund: "liste" });
      const zeile = await listeZeileAnlegen(req.nutzer, liste);
      res.json({ ok: true, zeile });
    } catch (fehler) {
      console.error("Whiteboard-Liste anlegen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  // Nachzug fuer die Listen-Tafeln (alle 20 s). Anders als beim Seitenaufbau
  // faellt hier nichts weich aus: Eine leere Antwort bei einer Stoerung
  // wuerde die Tafel im Browser leeren, obwohl in der Datenbank alles steht.
  app.get("/api/whiteboard-liste/zeilen", angemeldetApi, async (req, res) => {
    // Gedrosselt (siehe ABGLEICH_PAUSE): Die Tafel fragt alle 20 Sekunden.
    await listenAbgleichen(false);
    try {
      const zeilen = await crm.alsNutzer(req.nutzer.id, async (q) => (await q(
        `select ${ZEILEN_SPALTEN} from whiteboard_listenzeilen order by liste, position, erstellt`)).rows);
      res.json({ ok: true, listen: nachListe(zeilen, await retainerFirmen()) });
    } catch (fehler) {
      console.error("Whiteboard-Listen nachziehen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  // Vorschlaege fuer die Firmenwahl. Derselbe Bereichs-Riegel wie bei den
  // Verknuepfungen oben: Wer das CRM nicht oeffnen darf, bekommt keine
  // Kundennamen zu sehen.
  app.get("/api/whiteboard-liste/firmen", angemeldetApi, async (req, res) => {
    const liste = String(req.query.liste || "");
    if (!LISTENBOARDS.has(liste)) return res.status(400).json({ ok: false, grund: "liste" });
    if (!darfModul(req.nutzer, "crm")) return res.json({ ok: true, treffer: [], grund: "kein-crm" });
    try {
      const suche = String(req.query.q || "").trim().slice(0, 80);
      res.json({ ok: true, treffer: await listeFirmenSuchen(req.nutzer, liste, suche) });
    } catch (fehler) {
      console.error("Whiteboard-Liste Firmen suchen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  app.post("/api/whiteboard-liste/aendern", angemeldetApi, async (req, res) => {
    try {
      const id = String(req.body.id || "");
      const feld = String(req.body.feld || "");
      if (!UUID.test(id) || !ZEILENFELDER.has(feld))
        return res.status(400).json({ ok: false, grund: "eingabe" });
      const wert = textSaeubern(req.body.wert);
      res.json(await listeZeileAendern(req.nutzer, id, feld, wert));
    } catch (fehler) {
      console.error("Whiteboard-Liste aendern:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  app.post("/api/whiteboard-liste/firma", angemeldetApi, async (req, res) => {
    try {
      const id = String(req.body.id || "");
      const firma = String(req.body.firma || "");
      if (!UUID.test(id) || !/^\d+$/.test(firma))
        return res.status(400).json({ ok: false, grund: "eingabe" });
      if (!darfModul(req.nutzer, "crm")) return res.status(403).json({ ok: false, grund: "kein-crm" });
      const r = await listeFirmaSetzen(req.nutzer, id, firma);
      res.status(r.ok ? 200 : r.grund === "zeile" ? 404 : 400).json(r);
    } catch (fehler) {
      console.error("Whiteboard-Liste Firma setzen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  app.post("/api/whiteboard-liste/loeschen", angemeldetApi, async (req, res) => {
    try {
      const id = String(req.body.id || "");
      if (!UUID.test(id)) return res.status(400).json({ ok: false, grund: "id" });
      const r = await listeZeileLoeschen(req.nutzer, id);
      // listeZeileLoeschen gibt true/false oder ein Objekt mit Grund zurueck.
      res.json(typeof r === "object" ? r : { ok: r });
    } catch (fehler) {
      console.error("Whiteboard-Liste loeschen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  // ids = die ganze Liste, von oben nach unten, so wie sie nach dem Ziehen
  // dasteht — derselbe Kniff wie /crm/karten/sortieren im CRM-Kanban.
  app.post("/api/whiteboard-liste/sortieren", angemeldetApi, async (req, res) => {
    try {
      const liste = String(req.body.liste || "");
      const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : null;
      if (!LISTENBOARDS.has(liste) || !ids || !ids.length || ids.length > GRENZEN.ids
          || !ids.every((id) => UUID.test(id)))
        return res.status(400).json({ ok: false, grund: "eingabe" });
      await listeSortieren(req.nutzer, liste, ids);
      res.json({ ok: true });
    } catch (fehler) {
      console.error("Whiteboard-Liste sortieren:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  // ------------------------------------------------------------- Aufraeumen
  // Tombstones aelter als 30 Tage endgueltig weg — sonst wachsen die
  // Schwamm-Sitzungen der naechsten Monate zu totem Gewicht in jedem Delta.
  // Nur im echten Betrieb (die Probe reicht ihren eigenen Speicher herein).
  if (!optionen.speicher) {
    const aufraeumen = () => speicher.aufraeumen()
      .then((n) => { if (n) console.log(`Whiteboard: ${n} alte Tombstones entfernt.`); })
      .catch((fehler) => console.error("Whiteboard aufraeumen:", fehler.message));
    setTimeout(aufraeumen, 60 * 1000).unref();
    setInterval(aufraeumen, 6 * 3600 * 1000).unref();
  }
};

// Fuer die Bruecke (lib/aufgaben-tafel.js) und ihren Test: Was das CRM auf
// die Tafel schreibt, geht durch DIESELBE Pruefung wie ein Browser-Schreiben.
// Eine zweite Fassung der Regeln waere die sicherste Art, dass eine Zeile vom
// Server anders aussieht als eine vom Client.
module.exports.pruefeElement = pruefeElement;
module.exports.KATEGORIEN = KATEGORIEN;
module.exports.GRENZEN = GRENZEN;
// Nach aussen, damit ein Skript oder eine Pruefung den Abgleich anstossen kann,
// ohne die Seite aufzurufen.
module.exports.listenAbgleichen = listenAbgleichen;
