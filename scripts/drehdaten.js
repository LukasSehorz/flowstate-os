// Drehdaten fuer die Meta-Anzeigen — laden, ansehen, wieder wegraeumen.
//
// WOZU: Fuer die vier Werbeaufnahmen soll auf dem Bildschirm eine Agentur zu
// sehen sein, die es nicht gibt — erfundene Kunden, erfundene Zahlen. Die
// echten duerfen dabei aus zwei Gruenden nicht im Bild sein: Kundennamen gehen
// niemanden etwas an, und die echten Zahlen sind nicht die, die das Skript
// vorliest.
//
// WARUM EINE ZWEITE DATENBANK UND KEIN PRAEFIX: scripts/ads-proben.js schreibt
// mit ADSTEST-Praefix in die ECHTE Datenbank — richtig fuer eine Generalprobe,
// bei der es auf echte Zahlen ankommt. Beim DREHEN ist es genau falsch: Sobald
// eine Liste aufgeht, stehen die echten Zeilen daneben im Bild. Deshalb hier
// eine eigene Datenbank, in der es nichts anderes gibt als die Kulisse.
//
// DIE ECHTE DATENBANK WIRD VON DIESEM SKRIPT NIE ANGEFASST. Es liest
// DREH_DATABASE_URL, nicht DATABASE_URL, und bricht ab, wenn beide gleich sind
// (siehe zielPruefen unten). Das ist die einzige Sicherung, die zaehlt — ein
// vertippter Verbindungsstring ist der einzige Weg, wie hier echte Daten
// verlorengehen koennten.
//
// AUFRUF
//   node scripts/drehdaten.js --stand      was liegt in der Dreh-Datenbank?
//   node scripts/drehdaten.js --laden      Kulisse aufbauen (leert vorher)
//   node scripts/drehdaten.js --leeren     Kulisse abbauen
//
// VORHER: In der Dreh-Datenbank muessen das Schema (scripts/migrieren.js) und
// mindestens ein Konto (scripts/nutzer-anlegen.js) stehen. Ohne Konto gibt es
// keine profiles-Zeile, an der Anrufe und Deals haengen koennen.

const { Client } = require("pg");

// -------------------------------------------------------------- Argumente
const argv = process.argv.slice(2);
const LADEN = argv.includes("--laden");
const LEEREN = argv.includes("--leeren");
const MARKIEREN = argv.includes("--markieren");
const STAND = argv.includes("--stand") || (!LADEN && !LEEREN && !MARKIEREN);

// ------------------------------------------------------------------ Ziel
//
// Die Pruefung vergleicht nicht die Zeichenketten, sondern Wirt und
// Datenbankname: dieselbe Datenbank laesst sich auf mehrere Arten schreiben
// (Pooler-Port, andere Nutzerkennung, angehaengte Parameter), und ein
// Zeichenkettenvergleich wuerde genau die Faelle durchlassen, auf die es
// ankommt.
// Supabase schreibt dieselbe Datenbank auf zwei Arten: direkt
// (db.<kennung>.supabase.co) und ueber den Pooler (aws-0-….pooler.supabase.com,
// Kennung im BENUTZERNAMEN als postgres.<kennung>). Ein Vergleich der Wirte
// haelt diese beiden fuer verschiedene Datenbanken — nachgemessen am
// 20.08.2026, der Riegel liess den Fall durch. Darum wird die Projektkennung
// aus beiden Stellen gezogen.
function projektKennung(url) {
  try {
    const u = new URL(url);
    const ausWirt = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(u.hostname);
    if (ausWirt) return ausWirt[1].toLowerCase();
    const ausNutzer = /^postgres\.([a-z0-9]+)$/i.exec(decodeURIComponent(u.username || ""));
    if (ausNutzer) return ausNutzer[1].toLowerCase();
    return `${u.hostname.toLowerCase()}${u.pathname}`;   // kein Supabase: Wirt + Name
  } catch { return null; }
}

function zielPruefen() {
  const ziel = process.env.DREH_DATABASE_URL;
  if (!ziel) {
    console.error("DREH_DATABASE_URL ist nicht gesetzt.");
    console.error("Das ist die Verbindung zur DREH-Datenbank — nicht zur echten.");
    process.exit(1);
  }
  const echt = process.env.DATABASE_URL;
  const a = projektKennung(echt || ""), b = projektKennung(ziel);
  if (a && b && a === b) {
    console.error("ABBRUCH: DREH_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL.");
    console.error("Hier wird geloescht und neu befuellt. Das darf nur die Dreh-Datenbank sein.");
    process.exit(1);
  }
  return ziel;
}

// Der eigentliche Riegel. Ein Verbindungsstring kann falsch sein, ohne dass man
// es ihm ansieht — die Datenbank selbst muss sagen, dass sie die Kulisse ist.
// Ohne diese Tabelle wird nichts geloescht und nichts geschrieben.
async function markeVorhanden(c) {
  const { rows } = await c.query(
    `select to_regclass('public.dreh_marke') is not null as da`);
  return rows[0].da;
}

// Gesetzt wird sie nur in einer Datenbank, die noch keine Geschaeftsdaten
// traegt. Wer sie versehentlich gegen die echte laufen laesst, bekommt einen
// Abbruch statt einer Marke — dort stehen Firmen und Buchungen drin.
async function markieren(c) {
  if (await markeVorhanden(c)) { console.log("Ist bereits als Dreh-Datenbank markiert."); return; }
  const { rows: [z] } = await c.query(`select
      (select count(*) from public.firmen)::int as firmen,
      (select count(*) from public.buchungen)::int as buchungen`);
  if (z.firmen > 0 || z.buchungen > 0) {
    console.error(`ABBRUCH: Diese Datenbank enthält bereits Daten `
      + `(${z.firmen} Firmen, ${z.buchungen} Buchungen).`);
    console.error("Eine frische Dreh-Datenbank ist leer. Sieht aus wie die echte — nichts geändert.");
    process.exit(1);
  }
  await c.query(`create table public.dreh_marke (
      hinweis text not null,
      gesetzt timestamptz not null default now())`);
  await c.query(`insert into public.dreh_marke (hinweis) values
    ('Kulisse für die Meta-Anzeigen. Enthält nur erfundene Daten und darf jederzeit geleert werden.')`);
  console.log("Als Dreh-Datenbank markiert. Jetzt:  node scripts/drehdaten.js --laden");
}

// --------------------------------------------------------------- Kulisse
//
// Alle Zahlen stehen hier oben, weil sie im Skript vorgelesen werden. Wer eine
// aendert, muss die Sprechzeile mitaendern — deshalb nicht ueber die Datei
// verstreut.
const K = {
  // Creative 1
  callsGestern: 142,        // Cold Calls gestern
  callsHeute: 18,           // schon gefuehrt, damit die Kachel nicht auf null steht
  erstgespraecheGestern: 19,
  salesCallsGestern: 4,
  closingsGestern: 2,
  umsatzJuli: 87400,
  umsatzJuni: 78000,        // fuer "knapp 12 Prozent ueber Juni"
  umsatzMonatVorher: 62800, // Stand, bevor die Rechnung im Dreh dazukommt
  leadsMorgen: 50,
  leadsNachschub: 100,
  // Creative 3 / 4
  belegeJuli: 33,           // der 34. wird im Dreh fotografiert
  rechnungMeridian: 4000,
};

const TEAM_ANTEIL = { erste: 0.45, zweite: 0.33 };  // Rest auf die dritte Person

// Firmennamen fuer die Cold-Call-Liste. Bewusst erfunden und bewusst
// unauffaellig — in der Liste sieht man sie nur im Vorbeiscrollen.
const WORT_A = ["Nord", "Sued", "Alpen", "Isar", "Donau", "Berg", "Tal", "Stein",
  "Linde", "Eiche", "Auen", "Feld", "Bach", "Ried", "Moos", "Hain", "Wald",
  "Anger", "Kamp", "Furt"];
const WORT_B = ["licht", "punkt", "kraft", "form", "werk", "haus", "hof", "grund",
  "blick", "weg", "raum", "quelle", "bogen", "kern", "puls"];
const RECHTSFORM = ["GmbH", "GbR", "e. K.", "UG", "GmbH & Co. KG"];
const BRANCHEN = ["Physiotherapie", "Zahnarztpraxis", "Handwerk", "Steuerkanzlei",
  "Fitnessstudio", "Autohaus", "Immobilien", "Gastronomie", "Sanitaer", "Elektro"];
const ORTE = ["Muenchen", "Rosenheim", "Landshut", "Erding", "Freising",
  "Ingolstadt", "Augsburg", "Regensburg", "Passau", "Traunstein"];

// Kein Math.random: derselbe Aufruf soll dieselbe Kulisse bauen. Sonst sieht
// die Liste beim zweiten Take anders aus als beim ersten.
function firmenname(i) {
  const a = WORT_A[i % WORT_A.length];
  const b = WORT_B[Math.floor(i / WORT_A.length) % WORT_B.length];
  return `${a}${b} ${RECHTSFORM[i % RECHTSFORM.length]}`;
}

// --------------------------------------------------------------- Tabellen
//
// Reihenfolge ist die Loeschreihenfolge: Kinder vor Eltern. Ein truncate mit
// cascade waere kuerzer, wuerde aber auch profiles und pipeline_stages
// mitreissen — und damit die Konten, ohne die nichts mehr geht.
const TABELLEN = [
  "call_listen_eintraege", "call_listen", "dokumente", "belege", "buchungen",
  "aufgaben", "aktivitaeten", "projekte", "deals", "kontakte", "firmen",
];

async function leeren(c) {
  for (const t of TABELLEN) {
    await c.query(`truncate table public.${t} restart identity cascade`);
  }
}

// ----------------------------------------------------------------- Laden
async function laden(c) {
  const { rows: profile } = await c.query(
    `select id, name, rolle from public.profiles where aktiv order by rolle, name`);
  if (!profile.length) {
    console.error("In der Dreh-Datenbank gibt es kein Konto (Tabelle profiles ist leer).");
    console.error("Erst  node scripts/nutzer-anlegen.js  laufen lassen, dann hier weiter.");
    process.exit(1);
  }
  const wer = (i) => profile[i % profile.length].id;
  console.log("Konten gefunden: " + profile.map((p) => p.name).join(", "));

  const stufe = async (sparte, name) => {
    const { rows } = await c.query(
      `select id from public.pipeline_stages where sparte=$1 and art='vertrieb' and name=$2`,
      [sparte, name]);
    return rows[0]?.id || null;
  };
  const stufeGewonnen = await stufe("ki", "Gewonnen") || await stufe("performance", "Gewonnen");
  const stufeAngebot = await stufe("ki", "Angebot") || await stufe("performance", "Angebot");
  const stufeErst = await stufe("ki", "Readiness-Check gebucht")
    || await stufe("performance", "Erstgespräch");

  // ---------------------------------------------------- die drei Hauptrollen
  const firma = async (d) => {
    const { rows } = await c.query(
      `insert into public.firmen (name, status, branche, ort, quelle, temperatur,
                                  stand, tags, besitzer, kunde_seit, telefon, email)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [d.name, d.status, d.branche, d.ort, d.quelle || "cold-call", d.temperatur || "warm",
       d.stand || null, d.tags || [], d.besitzer || wer(0), d.kunde_seit || null,
       d.telefon || null, d.email || null]);
    return rows[0].id;
  };

  const nordlicht = await firma({
    name: "Nordlicht Media GmbH", status: "lead", branche: "Werbeagentur",
    ort: "Hamburg", quelle: "empfehlung", temperatur: "heiss",
    stand: "Erstgespräch gelaufen, Angebot raus. Reporting war ihr wichtig.",
    tags: ["ki", "gebucht"], telefon: "040 5550142", email: "carstens@nordlicht-media.de",
  });
  const meridian = await firma({
    name: "Meridian Consulting GmbH", status: "kunde", branche: "Unternehmensberatung",
    ort: "Stuttgart", quelle: "meta-ads", temperatur: "heiss",
    stand: "Heute abgeschlossen. Einrichtung startet nächste Woche.",
    tags: ["ki", "gebucht"], kunde_seit: new Date().toISOString().slice(0, 10),
    telefon: "0711 5550188", email: "kontakt@meridian-consulting.de",
  });
  const bergmann = await firma({
    name: "Bergmann Solar GmbH", status: "kunde", branche: "Photovoltaik",
    ort: "Regensburg", quelle: "cold-call", temperatur: "warm",
    stand: "Vertrag liegt zur Gegenzeichnung. Größter Posten im Juli.",
    tags: ["performance"], kunde_seit: "2026-03-01",
    telefon: "0941 5550117", email: "info@bergmann-solar.de",
  });

  await c.query(
    `insert into public.kontakte (firma_id, name, funktion, email, telefon, hinweis)
     values ($1,'Anke Carstens','Geschäftsführerin','carstens@nordlicht-media.de',
             '040 5550142','Entscheidet allein. Will wöchentliches Reporting.')`,
    [nordlicht]);

  // ------------------------------------------------------- Cold-Call-Kulisse
  //
  // anrufStatistik zaehlt Firmen nach ihrem Ergebnis-Tag und datiert sie ueber
  // den letzten Anruf in aktivitaeten. Ein Lead = ein Call. Deshalb wird hier
  // je Firma genau EIN Anruf geschrieben.
  // Ohne "gebucht": die Erstgespraeche werden fest gesetzt, weil ihre Zahl im
  // Skript vorgelesen wird. Der Rest verteilt sich nach diesen Gewichten, die
  // zusammen 1 ergeben muessen — sonst fehlen am Ende Anrufe.
  const ERGEBNISSE = [
    ["nicht-erreicht", 0.55], ["absage", 0.25], ["follow-up", 0.16],
    ["keine-zeit", 0.04],
  ];
  const verteilen = (gesamt) => {
    const out = [];
    let rest = gesamt;
    ERGEBNISSE.forEach(([tag, anteil], i) => {
      const n = i === ERGEBNISSE.length - 1 ? rest : Math.round(gesamt * anteil);
      out.push([tag, n]);
      rest -= n;
    });
    return out;
  };

  let lauf = 0;
  const anrufTag = async (tag, anzahl, tageZurueck) => {
    for (let i = 0; i < anzahl; i++, lauf++) {
      const f = await firma({
        name: firmenname(lauf), status: "lead",
        branche: BRANCHEN[lauf % BRANCHEN.length], ort: ORTE[lauf % ORTE.length],
        tags: ["performance", tag], besitzer: wer(lauf % 3),
        temperatur: tag === "gebucht" ? "heiss" : tag === "absage" ? "kalt" : "warm",
      });
      await c.query(
        `insert into public.aktivitaeten (firma_id, wer, art, text, zeit)
         values ($1,$2,'anruf',$3, (current_date - $4::int) + time '09:00' + ($5::int * interval '3 min'))`,
        [f, wer(lauf % 3), "Cold Call — " + tag, tageZurueck, i]);
    }
  };

  // Gestern: die Zahl, die im Skript vorgelesen wird. Die Erstgespraeche sind
  // dabei fest gesetzt (19), der Rest verteilt sich.
  for (const [tag, n] of verteilen(K.callsGestern - K.erstgespraecheGestern)) {
    await anrufTag(tag, n, 1);
  }
  await anrufTag("gebucht", K.erstgespraecheGestern, 1);
  // Heute: damit die Kachel am Drehtag nicht auf null steht.
  for (const [tag, n] of verteilen(K.callsHeute)) await anrufTag(tag, n, 0);

  // ------------------------------------------------------------- Leads morgen
  const listeId = (await c.query(
    `insert into public.call_listen (name, besitzer) values ($1,$2) returning id`,
    ["Kaltakquise " + new Date().toLocaleDateString("de-DE", { month: "long" }), wer(0)]
  )).rows[0].id;

  const leadAnlegen = async (n, wiedervorlage) => {
    for (let i = 0; i < n; i++, lauf++) {
      const f = await firma({
        name: firmenname(lauf), status: "lead",
        branche: BRANCHEN[lauf % BRANCHEN.length], ort: ORTE[lauf % ORTE.length],
        tags: ["performance"], besitzer: wer(lauf % 3), temperatur: "kalt",
      });
      if (wiedervorlage) {
        await c.query(`update public.firmen set wiedervorlage = current_date + 1 where id = $1`, [f]);
      }
      await c.query(
        `insert into public.call_listen_eintraege (liste_id, firma_id) values ($1,$2)`,
        [listeId, f]);
    }
  };
  await leadAnlegen(K.leadsMorgen, true);
  // Der Nachschub liegt schon in der Datenbank, aber ohne Wiedervorlage. "Zieh
  // nochmal 100" setzt im Dreh nur noch das Datum — das geht in einer Sekunde,
  // waehrend echtes Recherchieren Minuten braucht.
  await leadAnlegen(K.leadsNachschub, false);

  // ------------------------------------------------------------------ Deals
  const deal = async (d) => {
    const { rows } = await c.query(
      `insert into public.deals (firma_id, titel, sparte, stufe_id, wert, status,
                                 besitzer, geschlossen_am, erwartet_am)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [d.firma, d.titel, d.sparte || "ki", d.stufe, d.wert, d.status || "offen",
       d.besitzer || wer(0), d.geschlossen || null, d.erwartet || null]);
    return rows[0].id;
  };

  // Juli — die 87.400 aus C1_03, groesster Posten Bergmann Solar mit 14.000.
  const juli = [14000, 12800, 11500, 9900, 9400, 8600, 7800, 6900, 6500];
  const juliSumme = juli.reduce((a, b) => a + b, 0);
  juli.push(K.umsatzJuli - juliSumme);
  for (let i = 0; i < juli.length; i++) {
    const f = i === 0 ? bergmann : await firma({
      name: firmenname(lauf++), status: "kunde", branche: BRANCHEN[i % BRANCHEN.length],
      ort: ORTE[i % ORTE.length], besitzer: wer(i % 3), kunde_seit: "2026-07-01",
    });
    const id = await deal({
      firma: f, titel: "Projekt Juli", sparte: i % 2 ? "performance" : "ki",
      stufe: stufeGewonnen, wert: juli[i], status: "gewonnen", besitzer: wer(i % 3),
    });
    // Das Datum ist ein Ausdruck und geht darum nicht als Parameter mit —
    // es wird direkt danach gesetzt. Wichtig ist nur, dass es im VORmonat
    // liegt: daraus rechnet die Zentrale die 87.400 aus C1_03.
    await c.query(
      `update public.deals
          set geschlossen_am = date_trunc('month', current_date) - interval '1 month'
                             + $2::int * interval '1 day'
        where id = $1`, [id, 7 + i]);
  }

  // Laufender Monat — der Stand VOR der Rechnung aus Creative 4.
  const monat = [18500, 14200, 12100, 9800];
  monat.push(K.umsatzMonatVorher - monat.reduce((a, b) => a + b, 0));
  for (let i = 0; i < monat.length; i++) {
    const f = await firma({
      name: firmenname(lauf++), status: "kunde", branche: BRANCHEN[i % BRANCHEN.length],
      ort: ORTE[i % ORTE.length], besitzer: wer(i % 3), kunde_seit: "2026-08-01",
    });
    const id = await deal({
      firma: f, titel: "Projekt " + (i + 1), sparte: i % 2 ? "performance" : "ki",
      stufe: stufeGewonnen, wert: monat[i], status: "gewonnen", besitzer: wer(i % 3),
    });
    await c.query(
      `update public.deals set geschlossen_am = date_trunc('month', current_date) + $2::int * interval '1 day'
        where id = $1`, [id, i * 3]);
  }

  // Gestern: vier Sales Calls, zwei davon abgeschlossen (C1_02). Die beiden
  // Abschluesse sind KEINE zusaetzlichen Deals, sondern zwei aus dem laufenden
  // Monat, auf gestern datiert — sonst waere die Monatssumme nicht mehr die
  // 62.800, die in C4_03 hochzaehlen soll.
  const verkaeufer = profile.find((p) => /ioannis/i.test(p.name)) || profile[1] || profile[0];
  const { rows: gestrige } = await c.query(
    `select id from public.deals where status='gewonnen'
        and geschlossen_am >= date_trunc('month', current_date)
      order by wert desc limit $1`, [K.closingsGestern]);
  for (const g of gestrige) {
    await c.query(
      `update public.deals
          set geschlossen_am = current_date - 1 + time '16:30', besitzer = $2
        where id = $1`, [g.id, verkaeufer.id]);
  }
  // Die vier Gespraeche selbst — zwei gewonnen, zwei ohne Abschluss.
  for (let i = 0; i < K.salesCallsGestern; i++) {
    await c.query(
      `insert into public.aktivitaeten (firma_id, wer, art, text, zeit)
       values (null, $1, 'termin', $2, (current_date - 1) + time '14:00' + $3::int * interval '45 min')`,
      [verkaeufer.id, i < K.closingsGestern ? "Sales Call — abgeschlossen"
        : "Sales Call — kein Abschluss", i]);
  }
  console.log(`Die zwei Abschlüsse von gestern stehen auf: ${verkaeufer.name}`);
  console.log(`   → In Zeile C1_02 muss dieser Name gesprochen werden.`);

  // Offene Deals — damit die Pipeline nicht leer aussieht.
  await deal({ firma: nordlicht, titel: "Voice-Agent zwei Standorte", sparte: "ki",
    stufe: stufeAngebot, wert: 4800, status: "offen", besitzer: wer(0) });
  await deal({ firma: bergmann, titel: "Performance Marketing Retainer", sparte: "performance",
    stufe: stufeAngebot, wert: 3500, status: "offen", besitzer: wer(0) });
  // Meridian steht auf "offen" und wird im Dreh gewonnen — nicht vorher.
  await deal({ firma: meridian, titel: "KI-Assistent Einführung", sparte: "ki",
    stufe: stufeErst, wert: K.rechnungMeridian, status: "offen", besitzer: wer(0) });

  // Pipeline aus den gestern gebuchten Erstgespraechen.
  //
  // WARUM (20.08.2026, beim ersten Blick ins fertige Dashboard): Der Reiter
  // "Leads" im CRM zeigt nur Leads MIT offenem Deal (crm-routes.js, liste ===
  // "lead"). Ohne diese Deals stand dort eine einzige Firma, waehrend die
  // Zentrale 311 Leads meldete — im Bild sieht das aus, als sei das CRM leer.
  //
  // Genommen werden Firmen mit dem Tag "gebucht": Wer ein Erstgespraech hat,
  // hat auch einen Deal. Die Kaltakquise-Liste bekommt keinen — die ist noch
  // nicht angerufen, dort waere ein Deal falsch.
  const stufen = (await c.query(
    `select id, name from public.pipeline_stages
      where art='vertrieb' and name in ('Erstgespräch','Analyse & Strategie','Angebot',
                                        'Follow-up nach Erstgespräch','Readiness-Check gebucht')
      order by id`)).rows;
  const { rows: gebuchte } = await c.query(
    `select id from public.firmen
      where status='lead' and tags @> array['gebucht']::text[] and id <> $1
      order by id limit 12`, [nordlicht]);
  const WERTE = [8900, 7400, 6800, 5900, 5400, 4800, 4200, 3900, 3500, 2900, 2600, 2400];
  for (let i = 0; i < gebuchte.length; i++) {
    const s = stufen[i % stufen.length];
    await deal({
      firma: gebuchte[i].id, titel: "Erstgespräch geführt",
      sparte: /Readiness|Masterplan/.test(s.name) ? "ki" : "performance",
      stufe: s.id, wert: WERTE[i % WERTE.length], status: "offen", besitzer: wer(i % 3),
    });
  }

  // --------------------------------------------------------------- Aufgaben
  const aufgabe = (titel, tage, firmaId) => c.query(
    `insert into public.aufgaben (firma_id, titel, faellig, erledigt, besitzer)
     values ($1,$2, current_date + $3::int, false, $4)`,
    [firmaId || null, titel, tage, wer(0)]);
  await aufgabe("Angebot Nordlicht Media freigeben und rausschicken", 0, nordlicht);
  await aufgabe("Vertrag Bergmann Solar gegenzeichnen", 0, bergmann);
  await aufgabe("Neue Creatives für die Physio-Kampagne freigeben", 0, null);
  await aufgabe("Follow-up Nordlicht vorbereiten", 3, nordlicht);

  // ------------------------------------------------------------ Buchhaltung
  //
  // Die Buchhaltungsseite rechnet aus buchungen, die Zentrale aus deals. Beide
  // muessen dieselbe Summe zeigen, sonst faellt es genau dann auf, wenn im Dreh
  // zwischen den Seiten gewechselt wird.
  const buchung = (art, betrag, tageZurueck, kategorie, gegenstelle, firmaId) => c.query(
    `insert into public.buchungen (art, datum, betrag, kategorie, gegenstelle, firma_id, bezahlt, erfasst_von)
     values ($1, current_date - $2::int, $3, $4, $5, $6, true, $7)`,
    [art, tageZurueck, betrag, kategorie, gegenstelle, firmaId || null, wer(0)]);

  for (let i = 0; i < juli.length; i++) {
    await buchung("einnahme", juli[i], 30 + i, "Projekt",
      i === 0 ? "Bergmann Solar GmbH" : firmenname(i), i === 0 ? bergmann : null);
  }
  for (let i = 0; i < monat.length; i++) {
    await buchung("einnahme", monat[i], i * 3, "Projekt", firmenname(100 + i), null);
  }
  for (const [betrag, kat, wem, tage] of [
    [1290, "Software", "Hosting & Werkzeuge", 12],
    [640, "Werbung", "Meta Platforms", 8],
    [2400, "Personal", "Freelancer Design", 5],
    [129, "Software", "Hosting", 3],
  ]) await buchung("ausgabe", betrag, tage, kat, wem, null);

  // Belege im Juli-Ordner — 33 Stueck, der 34. wird im Dreh fotografiert.
  // Status 'gebucht': 0021 kannte noch 'offen'/'zugeordnet', 0022 und 0024 haben
  // die Werte auf neu | gebucht | fehler | verworfen umgestellt.
  for (let i = 0; i < K.belegeJuli; i++) {
    await c.query(
      `insert into public.belege (dateiname, betrag, datum, status, notiz, von, erstellt)
       values ($1,$2, date_trunc('month', current_date) - interval '1 month' + $3::int * interval '1 day',
               'gebucht', $4, $5,
               date_trunc('month', current_date) - interval '1 month' + $3::int * interval '1 day')`,
      [`Beleg-2026-07-${String(i + 1).padStart(3, "0")}.pdf`,
       [18.9, 129, 47.5, 12.4, 89, 240, 33.1, 15.8][i % 8],
       i, ["Bewirtung", "Software", "Fahrtkosten", "Büromaterial"][i % 4], wer(0)]);
  }

  await c.query(
    `insert into public.dokumente (firma_id, name, pfad, art, hochgeladen_von)
     values ($1,'Angebot-AN-2026-0231-Nordlicht-Media.pdf','dreh/angebot.pdf','angebot',$3),
            ($2,'Vertrag-Bergmann-Solar.pdf','dreh/vertrag.pdf','vertrag',$3)`,
    [nordlicht, bergmann, wer(0)]);
}

// ----------------------------------------------------------------- Stand
async function stand(c) {
  const eine = async (sql) => (await c.query(sql)).rows[0];
  const z = await eine(`select
      (select count(*) from public.firmen)::int as firmen,
      (select count(*) from public.firmen where status='kunde')::int as kunden,
      (select count(*) from public.firmen where wiedervorlage = current_date + 1)::int as morgen,
      (select count(*) from public.aktivitaeten where art='anruf'
         and zeit::date = current_date - 1)::int as calls_gestern,
      (select count(*) from public.aktivitaeten where art='anruf'
         and zeit::date = current_date)::int as calls_heute,
      (select count(*) from public.firmen where tags @> array['gebucht']::text[]
         )::int as gebucht,
      (select count(*) from public.aufgaben where not erledigt)::int as aufgaben,
      (select count(*) from public.belege)::int as belege,
      (select coalesce(sum(wert),0) from public.deals where status='gewonnen'
         and geschlossen_am >= date_trunc('month', current_date))::numeric as umsatz_monat,
      (select coalesce(sum(wert),0) from public.deals where status='gewonnen'
         and geschlossen_am >= date_trunc('month', current_date) - interval '1 month'
         and geschlossen_am <  date_trunc('month', current_date))::numeric as umsatz_vormonat,
      (select coalesce(sum(betrag),0) from public.buchungen where art='einnahme'
         and datum >= date_trunc('month', current_date) - interval '1 month'
         and datum <  date_trunc('month', current_date))::numeric as buchungen_vormonat`);

  const euro = (n) => Number(n).toLocaleString("de-DE", { minimumFractionDigits: 0 }) + " €";
  console.log("\nStand der Dreh-Datenbank");
  console.log("  Firmen gesamt          " + z.firmen + "  (davon Kunden: " + z.kunden + ")");
  console.log("  Cold Calls gestern     " + z.calls_gestern + "   erwartet: " + K.callsGestern);
  console.log("  Cold Calls heute       " + z.calls_heute + "    erwartet: " + K.callsHeute);
  console.log("  Erstgespräche gebucht  " + z.gebucht);
  console.log("  Leads für morgen       " + z.morgen + "    erwartet: " + K.leadsMorgen);
  console.log("  Offene Aufgaben        " + z.aufgaben);
  console.log("  Belege                 " + z.belege + "    erwartet: " + K.belegeJuli);
  console.log("  Umsatz Vormonat        " + euro(z.umsatz_vormonat) + "   erwartet: " + euro(K.umsatzJuli));
  console.log("  davon in buchungen     " + euro(z.buchungen_vormonat));
  console.log("  Umsatz laufender Monat " + euro(z.umsatz_monat) + "   erwartet: " + euro(K.umsatzMonatVorher));
  console.log("\n  Im Dreh kommt die Rechnung über " + euro(K.rechnungMeridian) + " dazu →  "
    + euro(Number(z.umsatz_monat) + K.rechnungMeridian));

  const abweichung = [];
  if (z.calls_gestern !== K.callsGestern) abweichung.push("Cold Calls gestern");
  if (z.morgen !== K.leadsMorgen) abweichung.push("Leads für morgen");
  if (Number(z.umsatz_vormonat) !== K.umsatzJuli) abweichung.push("Umsatz Vormonat");
  if (Number(z.umsatz_monat) !== K.umsatzMonatVorher) abweichung.push("Umsatz laufender Monat");
  if (abweichung.length) {
    console.log("\n  ACHTUNG — weicht vom Skript ab: " + abweichung.join(", "));
    console.log("  Entweder neu laden oder die Sprechzeile anpassen.");
  } else if (z.firmen) {
    console.log("\n  Alles passt zum Skript.");
  }
}

// ------------------------------------------------------------------ Lauf
(async () => {
  const ziel = zielPruefen();
  const c = new Client({ connectionString: ziel, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows: [db] } = await c.query("select current_database() as name, inet_server_addr() as wirt");
  console.log(`Dreh-Datenbank: ${db.name}`);

  try {
    if (MARKIEREN) { await markieren(c); return; }
    if ((LADEN || LEEREN) && !(await markeVorhanden(c))) {
      console.error("\nABBRUCH: Diese Datenbank trägt keine Dreh-Marke.");
      console.error("Wenn es wirklich die Dreh-Datenbank ist (leer, frisch migriert):");
      console.error("   node scripts/drehdaten.js --markieren");
      process.exit(1);
    }
    if (LEEREN) {
      await leeren(c);
      console.log("Kulisse abgebaut — alle Geschäftstabellen sind leer.");
      console.log("Konten (profiles) und Pipeline-Stufen stehen noch.");
    }
    if (LADEN) {
      console.log("Alte Kulisse wird entfernt …");
      await leeren(c);
      console.log("Baue auf …");
      await laden(c);
      console.log("Fertig.");
      await stand(c);
    }
    if (STAND && !LADEN) await stand(c);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("\nFehlgeschlagen:", e.message);
  process.exit(1);
});
