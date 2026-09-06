// Beispielbelege fuer die Buchhaltung — laden, ansehen, wieder wegraeumen.
//
// WOZU (05.09.2026, Auftrag D2): Lukas will Testbelege sehen — Belegeingang,
// Pruef-Blatt, Monatsabschluss mit Excel, Kosten-Dashboard mit offenen und
// wiederkehrenden Ausgaben. Ohne Daten sind das fuenf leere Seiten. Dieses
// Skript legt ~13 Ausgabenbelege (als kleine PDFs), drei Einnahmen, einen
// Kontostand und eine Steuerkanzlei an — alles klar als "Beispiel …" benannt.
//
// NUR IN EINER TESTDATENBANK. PRODUCT.md: keine erfundenen Zahlen im Betrieb.
// Der Riegel (Muster scripts/drehdaten.js zielPruefen): Das Skript bricht ab,
// wenn der Datenbank-Wirt NICHT 127.0.0.1/localhost ist UND die Tabelle
// dreh_marke fehlt. Die echte Supabase-Datenbank ist weder das eine noch das
// andere. Ein vertippter Verbindungsstring ist der einzige Weg, wie hier
// Beispielzahlen in die echten Buecher kaemen — und den faengt das ab.
//
// AUFRUF (Test-DB aus den Leitplanken):
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5499/flowstate node scripts/beispieldaten-buchhaltung.js --laden
//   DATABASE_URL=… node scripts/beispieldaten-buchhaltung.js --stand
//   DATABASE_URL=… node scripts/beispieldaten-buchhaltung.js --leeren
//
// --leeren: Belege sind per Trigger (0024) unloeschbar — sie werden auf
// "verworfen" gesetzt mit Grund "Beispieldaten" (die Buchungen dazu werden
// vorher entfernt). Buchungen mit Gegenstelle "Beispiel …" werden geloescht,
// auch Folgebuchungen aus "Diesen Monat gebucht". Kontostand und Kanzlei nur,
// wenn sie von hier stammen (Notiz "Beispieldaten").
//
// Die Belege gehen denselben Weg wie im Betrieb — belegHochladen ->
// belegWerte -> belegBuchen unter den Rechten des ersten aktiven Admin-Kontos
// (Lukas, wenn vorhanden). Migration 0061 muss eingespielt sein (intervall,
// quelle); ohne sie laeuft das Skript, aber ohne Fixkosten und Quellen.

const path = require("path");

// .env NICHT lesen: Die .env im Arbeitsordner zeigt auf die echte Datenbank.
// DATABASE_URL muss ausdruecklich in der Umgebung stehen.
const URL_DB = process.env.DATABASE_URL;
if (!URL_DB) {
  console.error("DATABASE_URL ist nicht gesetzt. Beispiel (Test-DB):");
  console.error("  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5499/flowstate node scripts/beispieldaten-buchhaltung.js --laden");
  process.exit(1);
}

const argv = process.argv.slice(2);
const LADEN = argv.includes("--laden");
const LEEREN = argv.includes("--leeren");
const STAND = argv.includes("--stand") || (!LADEN && !LEEREN);

const { Client } = require("pg");
const buch = require(path.join(__dirname, "..", "lib", "buchhaltung.js"));

// ------------------------------------------------------- Ein Blatt Papier
//
// Jeder Beleg braucht eine echte Datei: Das Pruef-Blatt zeigt sie, der
// Monatsordner packt sie ins ZIP. Ein PDF von Hand ist die ehrlichste Loesung
// (Muster scripts/drehdaten.js belegBlatt) — keine Abhaengigkeit, und was im
// ZIP landet, laesst sich wirklich oeffnen.
function belegBlatt(zeilen) {
  // Klammern und Backslash muessen im PDF-Text maskiert werden, sonst bricht
  // der Textstrom mitten im Wort ab. Umlaute gehen ueber WinAnsiEncoding.
  const roh = (t) => String(t).replace(/([\\()])/g, "\\$1");
  const strom = "BT /F1 13 Tf 56 770 Td 19 TL\n"
    + zeilen.map((z) => "(" + roh(z) + ") Tj T*").join("\n") + "\nET";
  const objekte = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length " + Buffer.byteLength(strom, "latin1") + " >>\nstream\n" + strom + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const stellen = [];
  objekte.forEach((o, i) => {
    stellen.push(Buffer.byteLength(pdf, "latin1"));
    pdf += (i + 1) + " 0 obj\n" + o + "\nendobj\n";
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 " + (objekte.length + 1) + "\n0000000000 65535 f \n"
    + stellen.map((b) => String(b).padStart(10, "0") + " 00000 n \n").join("")
    + "trailer\n<< /Size " + (objekte.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(pdf, "latin1");
}

// Datum relativ zum heutigen Monat: mt(-2, 15) = der 15. vor zwei Monaten.
// So bleiben die Beispiele frisch, egal wann man sie laedt.
function mt(versatzMonate, tag) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + versatzMonate);
  const letzter = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(tag, letzter));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function tageAb(heuteVersatz) {
  const d = new Date(); d.setDate(d.getDate() + heuteVersatz);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const deBetrag = (n) => n.toFixed(2).replace(".", ",") + " EUR";
const deTag = (t) => t.split("-").reverse().join(".");

// ------------------------------------------------------------ Die Belege
//
// Realistisch gemischt: Software, Werbung, Tanken, Buero, Freelancer, Essen,
// Reise, Versicherung — ueber vier Monate, zwei davon offen mit Faelligkeit
// (eine ueberfaellig), zwei wiederkehrend (Adobe monatlich, Versicherung
// jaehrlich), zwei noch ungeprueft im Eingang. Die Quellen sind gemischt,
// damit die Belege-Seite "3 vom Handy, 4 aus dem Postfach …" zeigen kann.
const AUSGABEN = [
  { wem: "Beispiel Adobe Systems", kategorie: "Software & Tools", betrag: 65.49, datum: mt(-2, 1), nr: "INV-2026-07-0913", ust: 19, quelle: "mail", intervall: "monatlich", notiz: "Creative Cloud Team (Beispiel)" },
  { wem: "Beispiel Meta Platforms", kategorie: "Werbung & Ads", betrag: 420.00, datum: mt(-2, 15), nr: "FB-778812", ust: 0, quelle: "mail", notiz: "Anzeigen Juli (Beispiel)" },
  { wem: "Beispiel Shell Tankstelle Dorfen", kategorie: "Fahrzeug & Tanken", betrag: 78.40, datum: mt(-2, 22), nr: "Bon 4471", ust: 19, quelle: "handy", notiz: "Tanken Kundentermin (Beispiel)" },
  { wem: "Beispiel IKEA Deutschland", kategorie: "Büro & Ausstattung", betrag: 249.00, datum: mt(-1, 3), nr: "R-55-0021", ust: 19, quelle: "web", notiz: "Bürostuhl (Beispiel)" },
  { wem: "Beispiel Anna Weber Design", kategorie: "Honorare & Freelancer", betrag: 1200.00, datum: mt(-1, 20), nr: "2026-031", ust: 0, quelle: "mail", offen: true, faellig: tageAb(14), notiz: "Logo & Screendesign (Beispiel)" },
  { wem: "Beispiel Hetzner Online", kategorie: "Software & Tools", betrag: 39.90, datum: mt(-1, 1), nr: "H-2026-0801", ust: 19, quelle: "mail", notiz: "Server August (Beispiel)" },
  { wem: "Beispiel Asia-Imbiss Erding", kategorie: "Essen & Getränke", betrag: 37.30, datum: mt(-1, 12), nr: "", ust: -1, quelle: "telegram", notiz: "Team-Essen (Beispiel)" },
  { wem: "Beispiel Deutsche Bahn", kategorie: "Reisekosten", betrag: 89.90, datum: mt(-1, 25), nr: "DB-99012345", ust: 7, quelle: "handy", notiz: "Fahrt Kundentermin München (Beispiel)" },
  { wem: "Beispiel Versicherung Betriebshaftpflicht", kategorie: "Versicherungen", betrag: 480.00, datum: mt(-3, 10), nr: "VS-2026-1", ust: 0, quelle: "mail", intervall: "jaehrlich", notiz: "Jahresbeitrag (Beispiel)" },
  { wem: "Beispiel Telekom Mobilfunk", kategorie: "Sonstiges", betrag: 49.99, datum: mt(0, 2), nr: "TK-0902", ust: 19, quelle: "mail", notiz: "Mobilfunk (Beispiel)" },
  { wem: "Beispiel Druckerei Flyerwerk", kategorie: "Werbung & Ads", betrag: 156.50, datum: mt(-1, 28), nr: "DR-4410", ust: 19, quelle: "mail", offen: true, faellig: tageAb(-5), notiz: "Flyer 500 Stück (Beispiel)" },
  // Die beiden hier bleiben UNGEPRUEFT im Eingang — einer mit gelesenen
  // Werten, einer ganz ohne (als kaeme er gerade vom Handy).
  { wem: "Beispiel Notion Labs", kategorie: "Software & Tools", betrag: 96.00, datum: mt(0, 3), nr: "NT-2201", ust: 0, quelle: "mail", nurWerte: true, notiz: "Notion Team (Beispiel)" },
  { wem: "Beispiel Bäckerei Huber", kategorie: "", betrag: 12.60, datum: mt(0, 4), nr: "", ust: 7, quelle: "handy", roh: true, notiz: "" },
];

const EINNAHMEN = [
  { wem: "Beispiel Sonnenhof Physiotherapie", kategorie: "Webdesign", betrag: 2400.00, datum: mt(-2, 10), bezahltAm: mt(-2, 24), nr: "R-2026-131", notiz: "Website Setup (Beispiel)", beleg: true },
  { wem: "Beispiel Bergmann Solar", kategorie: "Performance Marketing", betrag: 850.00, datum: mt(-1, 5), bezahltAm: mt(-1, 19), notiz: "Ads-Betreuung August (Beispiel)" },
  { wem: "Beispiel Nordlicht Media", kategorie: "KI-Projekte", betrag: 3200.00, datum: mt(-1, 26), offen: true, faellig: tageAb(4), nr: "R-2026-134", notiz: "KI-Readiness-Check (Beispiel)", beleg: true },
];

// ------------------------------------------------------------------ Riegel
function wirtLokal(url) {
  try { return /^(127\.0\.0\.1|localhost|::1|\[::1\])$/i.test(new URL(url).hostname); }
  catch { return false; }
}

async function main() {
  const c = new Client({ connectionString: URL_DB, ssl: wirtLokal(URL_DB) ? false : { rejectUnauthorized: false } });
  await c.connect();
  const { rows: [m] } = await c.query(`select to_regclass('public.dreh_marke') is not null as da`);
  if (!wirtLokal(URL_DB) && !m.da) {
    console.error("ABBRUCH: Diese Datenbank liegt nicht auf 127.0.0.1/localhost und traegt keine dreh_marke.");
    console.error("Beispielzahlen gehoeren nicht in die echten Buecher (PRODUCT.md). Nichts geschrieben.");
    await c.end(); process.exit(1);
  }
  const { rows: [mig] } = await c.query(
    `select exists (select 1 from information_schema.columns where table_name = 'buchungen' and column_name = 'intervall') as da`);
  if (!mig.da) console.warn("Hinweis: Migration 0061 fehlt — Fixkosten und Quellen werden nicht gesetzt.");

  // Das Konto, unter dem gebucht wird: erstes aktives Admin-Konto, Lukas zuerst.
  const { rows: [chef] } = await c.query(
    `select p.id, p.name, u.email from public.profiles p join auth.users u on u.id = p.id
      where p.rolle = 'admin' and p.aktiv
      order by (lower(u.email) like 'lukas%') desc, u.email limit 1`);
  if (!chef) { console.error("Kein aktives Admin-Konto — zuerst scripts/nutzer-anlegen.js."); await c.end(); process.exit(1); }
  const user = { id: chef.id, name: chef.name, rolle: "admin" };

  if (LEEREN) await leeren(c, user);
  if (LADEN) await laden(c, user, mig.da);
  await stand(c);
  await c.end();
  process.exit(0);
}

async function stand(c) {
  const { rows: [b] } = await c.query(
    `select count(*) filter (where status <> 'verworfen')::int as belege,
            count(*) filter (where status = 'neu')::int as neu,
            count(*) filter (where status = 'gebucht')::int as gebucht
       from public.belege where dateiname like 'Beispiel_%'`);
  const { rows: [u] } = await c.query(
    `select count(*)::int as n, count(*) filter (where not bezahlt)::int as offen,
            coalesce(sum(betrag) filter (where art = 'ausgabe' and bezahlt), 0)::numeric as aus,
            coalesce(sum(betrag) filter (where art = 'einnahme' and bezahlt), 0)::numeric as ein
       from public.buchungen where gegenstelle like 'Beispiel %'`);
  console.log(`Stand: ${b.belege} Beispiel-Belege (${b.neu} zu prüfen, ${b.gebucht} gebucht) · ${u.n} Beispiel-Buchungen (${u.offen} offen) · bezahlt: ${Number(u.ein).toFixed(2)} € ein, ${Number(u.aus).toFixed(2)} € aus`);
}

async function laden(c, user, mitKosten) {
  console.log(`Lade Beispieldaten als ${user.name} …`);
  let n = 0;
  for (const a of AUSGABEN) {
    const name = `Beispiel_${a.wem.replace(/^Beispiel /, "").replace(/[^A-Za-z0-9]+/g, "-")}_${a.datum}.pdf`;
    const datei = belegBlatt([
      "BELEG - Beispieldaten, kein echter Beleg", "", a.wem, "Datum: " + deTag(a.datum),
      a.nr ? "Belegnummer: " + a.nr : "", a.kategorie ? "Kategorie: " + a.kategorie : "",
      "Betrag brutto: " + deBetrag(a.betrag), a.ust === -1 ? "USt: gemischt (7 % und 19 %)" : `USt: ${a.ust} %`,
      a.offen ? "Zahlbar bis " + deTag(a.faellig) : "Bezahlt.",
    ].filter((z) => z !== ""));
    const r = await buch.belegHochladen(user, { art: "ausgabe", dateiname: name, dateityp: "application/pdf", daten: datei, quelle: a.quelle });
    if (!r.ok) { console.error("Beleg nicht abgelegt:", name, r.grund); continue; }
    if (r.doppelt) { console.log("  schon da:", name); continue; }
    n++;
    if (a.roh) continue;                       // bleibt ungelesen im Eingang
    await buch.belegWerte(user, r.id, {
      betrag: a.betrag, datum: a.datum, kategorie: a.kategorie, gegenstelle: a.wem,
      steuersatz: a.ust, belegnummer: a.nr, notiz: a.notiz, faellig: a.faellig || "",
    });
    if (a.nurWerte) continue;                  // gelesen, aber noch nicht bestaetigt
    const g = await buch.belegBuchen(user, r.id, null, { offen: Boolean(a.offen), intervall: mitKosten ? a.intervall : null });
    if (!g.ok) console.error("Beleg nicht gebucht:", name, g.grund);
  }
  console.log(`  ${n} Ausgabenbelege abgelegt.`);

  let m = 0;
  for (const x of EINNAHMEN) {
    if (x.beleg) {
      const name = `Beispiel_Rechnung_${x.nr}_${x.wem.replace(/^Beispiel /, "").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
      const datei = belegBlatt([
        "RECHNUNG " + x.nr + " - Beispieldaten, kein echter Beleg", "", "An: " + x.wem,
        "Rechnungsdatum: " + deTag(x.datum), "Leistung: " + x.notiz, "Betrag: " + deBetrag(x.betrag),
        "Kleinunternehmer nach §19 UStG - keine Umsatzsteuer.",
        x.offen ? "Zahlbar bis " + deTag(x.faellig) : "Bezahlt am " + deTag(x.bezahltAm),
      ]);
      const r = await buch.belegHochladen(user, { art: "einnahme", dateiname: name, dateityp: "application/pdf", daten: datei, quelle: "web" });
      if (!r.ok || r.doppelt) { console.log("  schon da / nicht abgelegt:", name); continue; }
      await buch.belegWerte(user, r.id, { betrag: x.betrag, datum: x.datum, kategorie: x.kategorie, gegenstelle: x.wem,
        steuersatz: 0, belegnummer: x.nr, notiz: x.notiz, faellig: x.faellig || "", fuer_position: "setup" });
      const g = await buch.belegBuchen(user, r.id, x.bezahltAm || null);
      if (!g.ok) console.error("Einnahme nicht gebucht:", name, g.grund);
    } else {
      const g = await buch.buchen(user, { art: "einnahme", datum: x.datum, betrag: x.betrag, kategorie: x.kategorie,
        gegenstelle: x.wem, notiz: x.notiz, bezahlt: x.offen ? "nein" : "ja", faellig: x.faellig || "" });
      // Zahltag nachziehen: buchen() setzt bezahlt_am = datum; hier soll er
      // spaeter liegen (Rechnung im August, Geld zwei Wochen danach).
      if (g.ok && x.bezahltAm) await c.query(`update public.buchungen set bezahlt_am = $2 where id = $1`, [g.id, x.bezahltAm]);
    }
    m++;
  }
  console.log(`  ${m} Einnahmen angelegt.`);

  // Kontostand (frisch, damit keine Erinnerung aufgeht) und Kanzlei — nur,
  // wenn dort noch nichts Eigenes steht.
  const { rows: [fe] } = await c.query(`select start_saldo, saldo_stand, steuer_mail, notiz from public.finanz_einstellungen where id = 1`);
  if (!fe || (!fe.saldo_stand && !fe.steuer_mail) || fe.notiz === "Beispieldaten") {
    await buch.einstellungenSetzen(user, { start_saldo: "12480,00", saldo_stand: tageAb(-2), steuersatz: "30" });
    await buch.einstellungenSetzen(user, { steuer_anrede: "Frau", steuer_name: "Beispiel-Kanzlei Keller", steuer_mail: "kanzlei@beispiel-keller.de",
      steuer_notiz: "Beispieldaten — Kanzlei Keller & Partner, Erding · Mandant 4711" });
    await c.query(`update public.finanz_einstellungen set notiz = 'Beispieldaten' where id = 1`);
    console.log("  Kontostand 12.480,00 € und Beispiel-Kanzlei gesetzt.");
  } else {
    console.log("  Kontostand/Kanzlei: eigene Werte vorhanden — nicht angefasst.");
  }
}

async function leeren(c, user) {
  console.log("Räume Beispieldaten weg …");
  // 1. Buchungen der Beispiel-Belege loesen (Beleg zurueck auf 'neu'), dann loeschen.
  const { rows: belege } = await c.query(
    `select id, buchung_id, status, laufnummer from public.belege where dateiname like 'Beispiel_%' and status <> 'verworfen'`);
  for (const b of belege) {
    if (b.buchung_id) await buch.buchungLoeschen(user, b.buchung_id);
    const r = await buch.belegVerwerfen(user, b.id, "Beispieldaten");
    if (!r.ok) console.error("  Beleg", b.laufnummer, "nicht verworfen:", r.grund);
  }
  // 2. Buchungen ohne Beleg und Folgebuchungen ("Diesen Monat gebucht").
  const { rowCount } = await c.query(`delete from public.buchungen where gegenstelle like 'Beispiel %'`);
  // 3. Export-Protokoll, das nur Beispiel-Belege umfasst.
  const { rowCount: ex } = await c.query(
    `delete from public.monats_exporte e
      where not exists (select 1 from unnest(e.laufnummern) l
                          join public.belege b on b.laufnummer = l
                         where b.dateiname not like 'Beispiel_%')`);
  // 4. Kontostand und Kanzlei nur, wenn von hier.
  const { rowCount: fe } = await c.query(
    `update public.finanz_einstellungen set start_saldo = 0, saldo_stand = null, steuer_anrede = null,
            steuer_name = null, steuer_mail = null, steuer_notiz = null, notiz = null
      where id = 1 and notiz = 'Beispieldaten'`);
  console.log(`  ${belege.length} Belege verworfen, ${rowCount} Buchungen gelöscht, ${ex} Export-Einträge entfernt${fe ? ", Kontostand/Kanzlei zurückgesetzt" : ""}.`);
}

main().catch((e) => { console.error("Fehler:", e.message); process.exit(1); });
