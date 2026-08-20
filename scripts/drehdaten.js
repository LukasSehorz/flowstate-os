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
//   node scripts/drehdaten.js --stand              was liegt in der Dreh-Datenbank?
//   node scripts/drehdaten.js --laden              Kulisse aufbauen (leert vorher)
//   node scripts/drehdaten.js --leads-nachziehen   im Dreh: 250 Leads freischalten
//   node scripts/drehdaten.js --leeren             Kulisse abbauen
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
const NACHZIEHEN = argv.includes("--leads-nachziehen");
const STAND = argv.includes("--stand") || (!LADEN && !LEEREN && !MARKIEREN && !NACHZIEHEN);

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
// Stand: Skript-Fassung 2 vom 20.08.2026.
const K = {
  // ---- Creative 1 (Sales-Zahlen und Leads)
  callsGestern: 142,          // C1_03
  callsHeute: 18,             // damit die Kachel am Drehtag nicht auf null steht
  erstgespraecheGestern: 12,  // C1_03 — Quote rund achteinhalb Prozent
  salesCallsGestern: 4,       // C1_03
  closingsGestern: 2,         // C1_03 — "Du hast beide", also Jannik
  wertClosingsGestern: 12000, // C1_04 — zwei Operating Systems a 6.000
  umsatzMonat: 32400,         // C1_04 — Stand am Drehtag, die 12.000 sind drin
  monatsziel: 60000,          // C1_04 — Ziellinie im Diagramm
  umsatzVormonat: 55000,      // C1_04 — "steigert euch um 5.000" gegenueber Juli
  umsatzGesamt: 269400,       // Kachel "Umsatz insgesamt" und das Zwoelf-Monats-Diagramm
  leadsHeute: 50,             // C1_05
  leadsNachschub: 250,        // C1_06 — zusammen 300

  // ---- Creative 3 (Sales Call ausgewertet, Angebot, Rechnung)
  dealNordlicht: 8000,        // C3_02 — Voice Agent, zwei Standorte
  belegeJuli: 33,             // C3_04 — der 34. wird im Dreh eingescannt
};

// Wer im Video angesprochen wird. Fassung 2, Grundregeln: "Angesprochen wird
// Jannik, nicht Lukas." Daran haengen die Aufgaben des Tages, die beiden
// Abschluesse von gestern ("Du hast beide") und der Kalender.
const CHEF_NAME = /jannik/i;

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
  const chef = profile.find((p) => CHEF_NAME.test(p.name)) || profile[0];
  console.log("Konten gefunden: " + profile.map((p) => p.name).join(", "));
  console.log(`Angesprochen wird: ${chef.name} — Aufgaben, Kalender und die zwei`
    + ` Abschluesse von gestern stehen auf ihm.`);

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

  // Die Sparte entscheidet, unter welchem Reiter ein Lead auf /leads auftaucht.
  //
  // WARUM VERTEILT (20.08.2026): Zuerst trugen alle Leads nur "performance".
  // Die Leads-Seite oeffnet aber auf dem Reiter "Webdesign", und der stand
  // dadurch auf null Eintraegen — genau die Ansicht, in der in Creative 1 die
  // Liste vollaufen soll. Jetzt liegt in jedem Reiter etwas.
  const SPARTEN = ["performance", "webdesign", "ki"];
  const sparteVon = (i) => SPARTEN[i % 5 === 4 ? 2 : i % 2];   // ~40/40/20

  let lauf = 0;
  const anrufTag = async (tag, anzahl, tageZurueck) => {
    for (let i = 0; i < anzahl; i++, lauf++) {
      const f = await firma({
        name: firmenname(lauf), status: "lead",
        branche: BRANCHEN[lauf % BRANCHEN.length], ort: ORTE[lauf % ORTE.length],
        tags: [sparteVon(lauf), tag], besitzer: wer(lauf % 3),
        temperatur: tag === "gebucht" ? "heiss" : tag === "absage" ? "kalt" : "warm",
      });
      await c.query(
        `insert into public.aktivitaeten (firma_id, wer, art, text, zeit)
         values ($1,$2,'anruf',$3, (current_date - $4::int) + time '09:00' + ($5::int * interval '3 min'))`,
        [f, wer(lauf % 3), "Cold Call — " + tag, tageZurueck, i]);
    }
  };

  // Gestern: die Zahl, die im Skript vorgelesen wird. Die Erstgespraeche sind
  // fest gesetzt (C1_03), der Rest verteilt sich.
  for (const [tag, n] of verteilen(K.callsGestern - K.erstgespraecheGestern)) {
    await anrufTag(tag, n, 1);
  }
  await anrufTag("gebucht", K.erstgespraecheGestern, 1);
  // Heute: damit die Kachel am Drehtag nicht auf null steht.
  for (const [tag, n] of verteilen(K.callsHeute)) await anrufTag(tag, n, 0);

  // -------------------------------------------------------- Leads fuer heute
  //
  // C1_05/C1_06: 50 liegen bereit, 250 kommen im Dreh dazu, zusammen 300.
  //
  // Der Nachschub liegt schon in der Datenbank, aber auf status 'ruht' — die
  // Leads-Seite zeigt nur 'lead'. Damit steht die Liste vor der Aufnahme auf
  // 50, und "--leads-nachziehen" schaltet die 250 in einer Sekunde frei. Echtes
  // Recherchieren dauert Minuten und haette die Einstellung gesprengt.
  const liste = async (name) => (await c.query(
    `insert into public.call_listen (name, besitzer) values ($1,$2) returning id`,
    [name, chef.id])).rows[0].id;
  const listeHeute = await liste("Kaltakquise "
    + new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }));
  const listeNachschub = await liste("Nachschub");

  const leadAnlegen = async (n, { ruht, listeId }) => {
    for (let i = 0; i < n; i++, lauf++) {
      const f = await firma({
        name: firmenname(lauf), status: ruht ? "ruht" : "lead",
        branche: BRANCHEN[lauf % BRANCHEN.length], ort: ORTE[lauf % ORTE.length],
        tags: [sparteVon(lauf)], besitzer: wer(lauf % 3), temperatur: "kalt",
        telefon: "0" + (8000 + (lauf % 900)) + " " + (100000 + lauf * 7),
      });
      if (!ruht) {
        await c.query(`update public.firmen set wiedervorlage = current_date where id = $1`, [f]);
      }
      await c.query(
        `insert into public.call_listen_eintraege (liste_id, firma_id) values ($1,$2)`,
        [listeId, f]);
    }
  };
  await leadAnlegen(K.leadsHeute, { ruht: false, listeId: listeHeute });
  await leadAnlegen(K.leadsNachschub, { ruht: true, listeId: listeNachschub });

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

  // Kunde + gewonnener Deal in einem Zug. gewonnenAm ist der Abstand in Tagen
  // zum Monatsersten; vormonat verschiebt zusaetzlich um einen Monat zurueck.
  //
  // erstellt wird VOR den Abschluss gelegt. Ohne das steht im CRM-Dashboard
  // eine negative Deal-Dauer ("Ø Deal-Dauer -28 Tage") — nachgemessen am
  // 20.08.2026, weil erstellt auf now() stand und der Abschluss in der
  // Vergangenheit lag.
  // monateZurueck: 0 = laufender Monat, 1 = Vormonat, 2 = der davor …
  const gewinner = async (name, wert, tag, monateZurueck, besitzer) => {
    const f = await firma({
      name, status: "kunde", branche: BRANCHEN[lauf % BRANCHEN.length],
      ort: ORTE[lauf % ORTE.length], besitzer,
      kunde_seit: null, telefon: "0" + (7000 + (lauf % 900)) + " " + (200000 + lauf * 3),
    });
    lauf++;
    const id = await deal({
      firma: f, titel: "Operating System", sparte: "ki",
      stufe: stufeGewonnen, wert, status: "gewonnen", besitzer,
    });
    await c.query(
      `update public.deals
          set geschlossen_am = date_trunc('month', current_date)
                             - $3::int * interval '1 month' + $2::int * interval '1 day',
              erstellt = date_trunc('month', current_date)
                             - $3::int * interval '1 month' + $2::int * interval '1 day'
                             - 26 * interval '1 day'
        where id = $1`, [id, tag, monateZurueck]);
    await c.query(
      `update public.firmen set kunde_seit = (date_trunc('month', current_date)
          - $2::int * interval '1 month' + $3::int * interval '1 day')::date where id = $1`,
      [f, monateZurueck, tag]);
    return { firma: f, name };
  };

  // Die Monate davor — damit "Umsatz insgesamt" auf 269.400 kommt und das
  // Zwoelf-Monats-Diagramm nicht nur zwei Balken hat. Steigend zum Heute hin,
  // weil eine Agentur, die gerade 55.000 im Monat macht, vor einem Jahr nicht
  // dasselbe gemacht hat — ein flacher Verlauf sieht erfunden aus.
  const HISTORIE = [26400, 24800, 22600, 21200, 19400, 17800, 15600, 13900, 11200, 9100];
  const kundenHistorie = [];
  for (let m = 0; m < HISTORIE.length; m++) {
    const gross = Math.round(HISTORIE[m] * 0.6);
    kundenHistorie.push(await gewinner(firmenname(lauf), gross, 9, m + 2, wer(m % 3)));
    kundenHistorie.push(await gewinner(firmenname(lauf), HISTORIE[m] - gross, 21, m + 2, wer((m + 1) % 3)));
  }

  // Vormonat — die 55.000 aus C1_04 ("5.000 mehr als im Vormonat").
  const vormonatWerte = [12000, 9500, 8400, 7600, 6800, 5900, 4800];
  vormonatWerte.push(K.umsatzVormonat - vormonatWerte.reduce((a, b) => a + b, 0));
  const kundenVormonat = [];
  for (let i = 0; i < vormonatWerte.length; i++) {
    kundenVormonat.push(await gewinner(firmenname(lauf), vormonatWerte[i], 6 + i * 3, 1, wer(i % 3)));
  }

  // Laufender Monat — die 32.400 aus C1_04. Die zwei Abschluesse von gestern
  // stecken hier drin (je 6.000, zusammen 12.000) und gehoeren dem Chef:
  // "Von den vier Sales Calls sind zwei geclosed. Du hast beide."
  const proClosing = K.wertClosingsGestern / K.closingsGestern;
  const monatWerte = [8900, 6300, 5200];
  monatWerte.push(K.umsatzMonat - K.wertClosingsGestern - monatWerte.reduce((a, b) => a + b, 0));
  const kundenMonat = [];
  for (let i = 0; i < monatWerte.length; i++) {
    kundenMonat.push(await gewinner(firmenname(lauf), monatWerte[i], 2 + i * 4, 0, wer(i % 3)));
  }
  for (let i = 0; i < K.closingsGestern; i++) {
    const k = await gewinner(firmenname(lauf), proClosing, 0, 0, chef.id);
    kundenMonat.push(k);
    await c.query(
      `update public.deals set geschlossen_am = current_date - 1 + time '16:30'
        where firma_id = $1`, [k.firma]);
    await c.query(
      `update public.firmen set kunde_seit = current_date - 1 where id = $1`, [k.firma]);
  }

  // Die vier Sales Calls von gestern — zwei mit Abschluss, zwei ohne.
  for (let i = 0; i < K.salesCallsGestern; i++) {
    await c.query(
      `insert into public.aktivitaeten (firma_id, wer, art, text, zeit)
       values (null, $1, 'termin', $2, (current_date - 1) + time '14:00' + $3::int * interval '45 min')`,
      [chef.id, i < K.closingsGestern ? "Sales Call — abgeschlossen"
        : "Sales Call — kein Abschluss", i]);
  }

  // Offene Deals — damit die Pipeline nicht leer aussieht.
  //
  // Nordlicht steht auf "Erstgespraech": In Creative 3 wird der Deal im Bild
  // geschlossen und die Rechnung ueber 8.000 daraus gebaut. Wer ihn vorher auf
  // gewonnen setzt, nimmt der Szene ihren Sinn.
  await deal({ firma: nordlicht, titel: "Voice Agent, zwei Standorte", sparte: "ki",
    stufe: stufeErst, wert: K.dealNordlicht, status: "offen", besitzer: chef.id });
  await deal({ firma: bergmann, titel: "Performance Marketing Retainer", sparte: "performance",
    stufe: stufeAngebot, wert: 3500, status: "offen", besitzer: chef.id });
  await deal({ firma: meridian, titel: "Operating System", sparte: "ki",
    stufe: stufeAngebot, wert: 6000, status: "offen", besitzer: wer(1) });

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
  //
  // ZWEI FALLEN, beide am 20.08.2026 im fertigen Dashboard gesehen:
  //
  //   1. todosHeute filtert auf geplant_am, NICHT auf faellig (lib/crm.js).
  //      Ohne geplant_am stand "Anstehend heute" auf null, obwohl vier
  //      Aufgaben in der Tabelle lagen.
  //   2. Die Aufgaben gehoerten wer(0) — das ist die erste Zeile der nach
  //      Rolle und Name sortierten Liste und nicht zwangslaeufig die Person,
  //      die im Video angesprochen wird.
  const aufgabe = (titel, tage, firmaId) => c.query(
    `insert into public.aufgaben (firma_id, titel, faellig, geplant_am, erledigt, besitzer)
     values ($1,$2, current_date + $3::int, current_date + $3::int, false, $4)`,
    [firmaId || null, titel, tage, chef.id]);
  await aufgabe("Angebot Nordlicht Media freigeben und rausschicken", 0, nordlicht);
  await aufgabe("Vertrag Bergmann Solar gegenzeichnen", 0, bergmann);
  await aufgabe("Neue Creatives für die Physio-Kampagne freigeben", 0, null);
  await aufgabe("Follow-up Nordlicht vorbereiten", 3, nordlicht);

  // ------------------------------------------------------------ Buchhaltung
  //
  // Die Buchhaltungsseite rechnet aus buchungen, die Zentrale aus deals. Beide
  // muessen dieselbe Summe zeigen, sonst faellt es genau dann auf, wenn im Dreh
  // zwischen den Seiten gewechselt wird.
  //
  // Die Gegenstelle ist der ECHTE Kundenname aus derselben Schleife. Vorher
  // stand hier firmenname(i) mit einem anderen Zaehler — in "Letzte Buchungen"
  // standen dadurch Firmen, die es in der Kundenliste gar nicht gab.
  const buchung = (art, betrag, datumSql, kategorie, gegenstelle, firmaId) => c.query(
    `insert into public.buchungen (art, datum, betrag, kategorie, gegenstelle, firma_id, bezahlt, erfasst_von)
     values ($1, ${datumSql}, $2, $3, $4, $5, true, $6)`,
    [art, betrag, kategorie, gegenstelle, firmaId || null, chef.id]);

  const amTag = (tag, vormonat) => `date_trunc('month', current_date) - ${vormonat ? 1 : 0}`
    + ` * interval '1 month' + ${Number(tag)} * interval '1 day'`;
  for (let i = 0; i < kundenVormonat.length; i++) {
    await buchung("einnahme", vormonatWerte[i], amTag(6 + i * 3, true), "Projekt",
      kundenVormonat[i].name, kundenVormonat[i].firma);
  }
  for (let i = 0; i < monatWerte.length; i++) {
    await buchung("einnahme", monatWerte[i], amTag(2 + i * 4, false), "Projekt",
      kundenMonat[i].name, kundenMonat[i].firma);
  }
  for (let i = 0; i < K.closingsGestern; i++) {
    const k = kundenMonat[monatWerte.length + i];
    await buchung("einnahme", proClosing, "current_date - 1", "Projekt", k.name, k.firma);
  }
  for (const [betrag, kat, wem, tage] of [
    [1290, "Software", "Hosting & Werkzeuge", 12],
    [640, "Werbung", "Meta Platforms", 8],
    [2400, "Personal", "Freelancer Design", 5],
    [129, "Software", "Hosting", 3],
  ]) await buchung("ausgabe", betrag, `current_date - ${Number(tage)}`, kat, wem, null);

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
       i, ["Bewirtung", "Software", "Fahrtkosten", "Büromaterial"][i % 4], chef.id]);
  }

  // Kontostand, damit die Buchhaltungsseite nicht mit einer gelben Warnung
  // aufgeht ("Kontostand ist noch nie eingetragen") — die stuende im Bild.
  await c.query(
    `update public.finanz_einstellungen
        set start_saldo = $1, saldo_stand = date_trunc('month', current_date)::date,
            steuersatz = 30.0, geaendert_von = $2
      where id = 1`, [48500, chef.id]);

  await c.query(
    `insert into public.dokumente (firma_id, name, pfad, art, hochgeladen_von)
     values ($1,'Angebot-Nordlicht-Media.pdf','dreh/angebot.pdf','angebot',$3),
            ($2,'Vertrag-Bergmann-Solar.pdf','dreh/vertrag.pdf','vertrag',$3)`,
    [nordlicht, bergmann, chef.id]);
}

// Die 250 Nachschub-Leads freischalten — der Moment aus C1_06.
//
// Sie liegen schon in der Datenbank, aber auf status 'ruht'; die Leads-Seite
// zeigt nur 'lead'. Ein Befehl, unter einer Sekunde, und die Liste springt von
// 50 auf 300. Echtes Recherchieren dauert Minuten und sprengt die Einstellung.
async function leadsNachziehen(c) {
  const { rowCount } = await c.query(
    `update public.firmen set status = 'lead', wiedervorlage = current_date
      where status = 'ruht'`);
  const { rows: [z] } = await c.query(
    `select count(*)::int as offen from public.firmen where status = 'lead'`);
  console.log(`${rowCount} Leads freigeschaltet — in der Liste stehen jetzt ${z.offen}.`);
  if (!rowCount) console.log("Nichts mehr auf 'ruht'. Vor dem naechsten Take: --laden");
}

// ----------------------------------------------------------------- Stand
async function stand(c) {
  const eine = async (sql) => (await c.query(sql)).rows[0];
  const z = await eine(`select
      (select count(*) from public.firmen)::int as firmen,
      (select count(*) from public.firmen where status='kunde')::int as kunden,
      -- Dieselbe Rechnung wie die Leads-Seite: status 'lead' UND noch kein
      -- Ergebnis-Tag. Wer nur status zaehlt, bekommt die 160 schon
      -- angerufenen dazu und vergleicht gegen die falsche Zahl.
      (select count(*) from public.firmen
        where status='lead' and not (tags && array['gebucht','absage','nicht-erreicht',
              'keine-zeit','webseite-zu-gut','follow-up']::text[]))::int as leads_offen,
      (select count(*) from public.firmen where status='ruht')::int as leads_reserve,
      (select count(*) from public.aufgaben where not erledigt
         and geplant_am = current_date)::int as heute_geplant,
      (select coalesce(sum(wert),0) from public.deals where status='gewonnen'
         and geschlossen_am::date = current_date - 1)::numeric as gestern_wert,
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
         and datum <  date_trunc('month', current_date))::numeric as buchungen_vormonat,
      (select coalesce(sum(wert),0) from public.deals
        where status='gewonnen')::numeric as umsatz_gesamt`);

  const euro = (n) => Number(n).toLocaleString("de-DE", { minimumFractionDigits: 0 }) + " €";
  const zeile = (was, ist, soll) => console.log("  " + was.padEnd(24) + String(ist).padStart(10)
    + (soll === undefined ? "" : "   Skript: " + soll));
  console.log("\nStand der Dreh-Datenbank");
  zeile("Firmen gesamt", z.firmen + " (Kunden: " + z.kunden + ")");
  zeile("Cold Calls gestern", z.calls_gestern, K.callsGestern);
  zeile("Cold Calls heute", z.calls_heute, K.callsHeute);
  zeile("Erstgespräche gebucht", z.gebucht, K.erstgespraecheGestern + " von gestern + Nordlicht");
  zeile("Leads in der Liste", z.leads_offen, K.leadsHeute);
  zeile("Leads in Reserve", z.leads_reserve, K.leadsNachschub);
  zeile("Aufgaben heute geplant", z.heute_geplant, 3);
  zeile("Belege", z.belege, K.belegeJuli);
  zeile("Umsatz Vormonat", euro(z.umsatz_vormonat), euro(K.umsatzVormonat));
  zeile("davon in buchungen", euro(z.buchungen_vormonat));
  zeile("Umsatz laufender Monat", euro(z.umsatz_monat), euro(K.umsatzMonat));
  zeile("davon gestern geclosed", euro(z.gestern_wert), euro(K.wertClosingsGestern));
  zeile("Umsatz insgesamt", euro(z.umsatz_gesamt), euro(K.umsatzGesamt));
  console.log("\n  C1_06: --leads-nachziehen schaltet " + K.leadsNachschub
    + " frei →  " + (z.leads_offen + z.leads_reserve) + " in der Liste.");

  const abweichung = [];
  if (z.calls_gestern !== K.callsGestern) abweichung.push("Cold Calls gestern");
  if (z.leads_offen !== K.leadsHeute) abweichung.push("Leads in der Liste");
  if (z.leads_reserve !== K.leadsNachschub) abweichung.push("Leads in Reserve");
  if (z.heute_geplant !== 3) abweichung.push("Aufgaben für heute");
  if (Number(z.gestern_wert) !== K.wertClosingsGestern) abweichung.push("Wert der Abschlüsse von gestern");
  if (Number(z.umsatz_vormonat) !== K.umsatzVormonat) abweichung.push("Umsatz Vormonat");
  if (Number(z.umsatz_monat) !== K.umsatzMonat) abweichung.push("Umsatz laufender Monat");
  if (Number(z.umsatz_gesamt) !== K.umsatzGesamt) abweichung.push("Umsatz insgesamt");
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
    if ((LADEN || LEEREN || NACHZIEHEN) && !(await markeVorhanden(c))) {
      console.error("\nABBRUCH: Diese Datenbank trägt keine Dreh-Marke.");
      console.error("Wenn es wirklich die Dreh-Datenbank ist (leer, frisch migriert):");
      console.error("   node scripts/drehdaten.js --markieren");
      process.exit(1);
    }
    if (NACHZIEHEN) { await leadsNachziehen(c); return; }
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
