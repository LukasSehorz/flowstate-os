// Prueft die Buchhaltung gegen eine TESTDATENBANK — den Teil, den keine
// Attrappe zeigen kann: Migration 0061, offene Ausgaben, Fixkosten-Folge-
// buchung mit Doppelklick-Schutz, Belegquelle, Monats-Excel aus echten
// Zeilen, Kanzlei-Vermerk, Zaehler und Kosten-Rechnung ueber SQL.
//
// NICHT in scripts/pruefen.js: braucht DATABASE_URL. Derselbe Riegel wie in
// scripts/beispieldaten-buchhaltung.js — Wirt 127.0.0.1/localhost oder
// Tabelle dreh_marke, sonst Abbruch. Schreibt und raeumt hinter sich auf
// (alles, was hier entsteht, traegt "DBTEST" im Namen).
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5499/flowstate node scripts/test-buchhaltung-db.js

process.env.ADS_PROBE = "1";
const URL_DB = process.env.DATABASE_URL;
if (!URL_DB) { console.error("DATABASE_URL (Test-DB) fehlt."); process.exit(1); }
const lokal = (() => { try { return /^(127\.0\.0\.1|localhost|::1)$/.test(new URL(URL_DB).hostname); } catch { return false; } })();

const { Client } = require("pg");
const buch = require("../lib/buchhaltung.js");
const zlib = require("zlib");

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};
const heute = buch.rechnen.tagText(new Date());
const tage = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return buch.rechnen.tagText(d); };

(async () => {
  const c = new Client({ connectionString: URL_DB, ssl: lokal ? false : { rejectUnauthorized: false } });
  await c.connect();
  const { rows: [m] } = await c.query(`select to_regclass('public.dreh_marke') is not null as da`);
  if (!lokal && !m.da) { console.error("ABBRUCH: keine Testdatenbank (weder lokal noch dreh_marke)."); process.exit(1); }
  const { rows: [chef] } = await c.query(
    `select p.id, p.name from public.profiles p join auth.users u on u.id = p.id
      where p.rolle = 'admin' and p.aktiv order by (lower(u.email) like 'lukas%') desc limit 1`);
  const user = { id: chef.id, name: chef.name, rolle: "admin" };
  const angelegt = { buchungen: [], belege: [] };

  try {
    console.log("— Migration 0061 —");
    pruefe("intervall/quelle/an_kanzlei_am sind da", await buch.migration0061Da(user));

    console.log("\n— Offene Ausgabe erfassen, im Kosten-Dashboard sehen, bezahlen —");
    const r1 = await buch.buchen(user, { art: "ausgabe", datum: heute, betrag: "199,90", kategorie: "Software & Tools",
      gegenstelle: "DBTEST Lieferant", notiz: "DBTEST offen", bezahlt: "nein", faellig: tage(10) });
    angelegt.buchungen.push(r1.id);
    pruefe("buchen() legt eine OFFENE Ausgabe an", r1.ok && r1.offen === true);
    let k = await buch.kosten(user);
    let z = k.offenAus.find((b) => b.id === r1.id);
    pruefe("kosten(): steht unter „Noch zu zahlen“ mit Faelligkeit", Boolean(z) && buch.rechnen.tagText(z.faellig) === tage(10));
    pruefe("kosten(): Summe enthaelt 199,90", k.offenAusSummen.summe >= 199.9);
    const ue = await buch.uebersicht(user, "alle");
    pruefe("uebersicht(): offene Ausgabe zaehlt NICHT bei den Ausgaben", !ue.letzte.find((l) => l.id === r1.id && l.bezahlt));
    const kz = await buch.kennzahlen(user);
    pruefe("kennzahlen(): offene_ausgaben_anzahl >= 1 und belege_offen ist eine Zahl", kz.offene_ausgaben_anzahl >= 1 && Number.isInteger(kz.belege_offen));
    const b1 = await buch.bezahltSetzen(user, r1.id, true, heute);
    k = await buch.kosten(user);
    pruefe("bezahltSetzen(): verschwindet aus „Noch zu zahlen“", b1.ok && !k.offenAus.find((b) => b.id === r1.id));
    const { rows: [bz] } = await c.query(`select bezahlt, bezahlt_am::text, faellig from public.buchungen where id = $1`, [r1.id]);
    pruefe("Zahltag gesetzt, Faelligkeit geleert", bz.bezahlt && bz.bezahlt_am === heute && bz.faellig === null);

    console.log("\n— Fixkosten: Vorlage, Folgebuchung, Doppelklick, Beenden —");
    const r2 = await buch.buchen(user, { art: "ausgabe", datum: "2026-01-31", betrag: "59,99", kategorie: "Software & Tools",
      gegenstelle: "DBTEST Adobe", intervall: "monatlich" });
    angelegt.buchungen.push(r2.id);
    const { rows: [vo] } = await c.query(`select intervall, naechste_faelligkeit::text, wiederkehrend from public.buchungen where id = $1`, [r2.id]);
    pruefe("Vorlage traegt intervall und naechste Faelligkeit 28.02.", vo.intervall === "monatlich" && vo.naechste_faelligkeit === "2026-02-28" && vo.wiederkehrend === true);
    k = await buch.kosten(user);
    pruefe("kosten(): Fixkosten je Monat enthalten 59,99", k.fixkosten.some((f) => f.id === r2.id) && k.fixkostenMonat >= 59.99);
    const f1 = await buch.fixkostenBuchen(user, r2.id, {});
    if (f1.ok) angelegt.buchungen.push(f1.id);
    pruefe("fixkostenBuchen(): Folgebuchung angelegt (bezahlt am 28.02.)", f1.ok && !f1.offen);
    const { rows: [fo] } = await c.query(`select datum::text, bezahlt, quelle, quelle_schluessel, intervall from public.buchungen where id = $1`, [f1.id]);
    pruefe("Folgebuchung: einmalig, quelle fixkosten, Schluessel fix-<id>-2026-02",
      fo && fo.intervall === null && fo.quelle === "fixkosten" && fo.quelle_schluessel === `fix-${r2.id}-2026-02` && fo.datum === "2026-02-28");
    const { rows: [vo2] } = await c.query(`select naechste_faelligkeit::text from public.buchungen where id = $1`, [r2.id]);
    pruefe("Vorlage rueckt auf 31.03. weiter", vo2.naechste_faelligkeit === "2026-03-31");
    const f2 = await buch.fixkostenBuchen(user, r2.id, { datum: "2026-02-28" });
    pruefe("zweiter Klick fuer denselben Monat wird abgefangen", !f2.ok && f2.grund === "schon-gebucht");
    const f3 = await buch.fixkostenBuchen(user, r2.id, { bezahlt: "nein" });
    if (f3.ok) angelegt.buchungen.push(f3.id);
    pruefe("Folgebuchung offen anlegen geht (faellig = Faelligkeitstag)", f3.ok && f3.offen);
    const be = await buch.fixkostenBeenden(user, r2.id);
    k = await buch.kosten(user);
    pruefe("fixkostenBeenden(): zaehlt nicht mehr", be.ok && !k.fixkosten.some((f) => f.id === r2.id));

    console.log("\n— Belegquelle, Liste, Blatt —");
    const pdf = Buffer.from("%PDF-1.4\n% DBTEST " + Date.now() + "\n%%EOF\n");
    const h = await buch.belegHochladen(user, { art: "ausgabe", dateiname: "DBTEST_beleg.pdf", dateityp: "application/pdf", daten: pdf, quelle: "handy" });
    angelegt.belege.push(h.id);
    pruefe("belegHochladen() merkt die Quelle handy", h.ok && h.quelle === "handy");
    const h2 = await buch.belegHochladen(user, { art: "ausgabe", dateiname: "DBTEST_beleg.pdf", dateityp: "application/pdf", daten: pdf, quelle: "so-nicht" });
    pruefe("gleiche Datei -> doppelt, nicht neu", h2.ok && h2.doppelt && h2.id === h.id);
    const einzeln = await buch.belegEinzeln(user, h.id);
    pruefe("belegEinzeln(): Quelle, Status neu, keine Buchung", einzeln && einzeln.quelle === "handy" && einzeln.status === "neu" && einzeln.hat_datei);
    const liste = await buch.belegeListe(user, { status: "neu", suche: "DBTEST" });
    pruefe("belegeListe(): Filter status+suche finden ihn", liste.some((b) => b.id === h.id));
    const zaehler = await buch.belegZaehler(user);
    pruefe("belegZaehler(): handy gezaehlt, Monat gelistet", zaehler.quellen.some((q) => q.quelle === "handy") && zaehler.monate.length > 0 && zaehler.status.neu >= 1);
    await buch.belegWerte(user, h.id, { betrag: "12,60", datum: heute, kategorie: "Essen & Getränke", gegenstelle: "DBTEST Bäckerei", steuersatz: 7, faellig: tage(20), art: "ausgabe" });
    const g = await buch.belegBuchen(user, h.id, null, { offen: true });
    if (g.ok) angelegt.buchungen.push(g.buchung);
    pruefe("belegBuchen(offen) -> Buchung offen mit Zahlungsziel", g.ok && g.offeneRechnung && g.bezahltAm === null);
    const { rows: [gb] } = await c.query(`select bezahlt, faellig::text from public.buchungen where id = $1`, [g.buchung]);
    pruefe("Buchung: bezahlt=false, faellig uebernommen", gb && gb.bezahlt === false && gb.faellig === tage(20));
    const w = await buch.belegWerte(user, h.id, { betrag: "1", datum: heute, art: "einnahme" });
    const { rows: [ab] } = await c.query(`select art from public.belege where id = $1`, [h.id]);
    pruefe("Richtung eines GEBUCHTEN Belegs bleibt (nur bei status neu umstellbar)", w.ok && ab.art === "ausgabe");

    console.log("\n— Monatsabschluss: Excel, Status, Kanzlei-Vermerk —");
    const r3 = await buch.buchen(user, { art: "einnahme", datum: "2025-11-03", betrag: "1000", gegenstelle: "DBTEST Kunde", kategorie: "Webdesign", bezahlt: "ja" });
    angelegt.buchungen.push(r3.id);
    const ex = await buch.monatsExcel(user, 2025, 11);
    pruefe("monatsExcel(): liefert eine .xlsx (PK)", ex.ok && Buffer.isBuffer(ex.datei) && ex.datei.readUInt32LE(0) === 0x04034b50 && /\.xlsx$/.test(ex.dateiname));
    const blatt1 = (() => {
      let p = 0; const b = ex.datei;
      while (p + 30 <= b.length && b.readUInt32LE(p) === 0x04034b50) {
        const gepackt = b.readUInt32LE(p + 18), nl = b.readUInt16LE(p + 26), el = b.readUInt16LE(p + 28);
        const n = b.slice(p + 30, p + 30 + nl).toString("utf8"); const s = p + 30 + nl + el;
        if (n === "xl/worksheets/sheet1.xml") return zlib.inflateRawSync(b.slice(s, s + gepackt)).toString("utf8");
        p = s + gepackt;
      }
      return "";
    })();
    pruefe("Excel-Blatt enthaelt die Zeile (DBTEST Kunde, 1000 als Zahl)", /DBTEST Kunde/.test(blatt1) && /<v>1000<\/v>/.test(blatt1));
    let mon = (await buch.monateUebersicht(user)).find((x) => x.jahr === 2025 && x.monat === 11);
    pruefe("monateUebersicht(): Status excel nach dem Abruf", mon && mon.status === "excel");
    const zipR = await buch.monatsExport(user, 2025, 11);
    pruefe("monatsExport(): ZIP enthaelt das Excel", zipR.ok && zipR.zip.includes("Buchhaltung 2025-11.xlsx"));
    mon = (await buch.monateUebersicht(user)).find((x) => x.jahr === 2025 && x.monat === 11);
    pruefe("Status zip (juengste Handlung)", mon && mon.status === "zip");
    const kv = await buch.anKanzleiVermerken(user, 2025, 11);
    mon = (await buch.monateUebersicht(user)).find((x) => x.jahr === 2025 && x.monat === 11);
    pruefe("anKanzleiVermerken(): Status kanzlei mit Zeitpunkt", kv.ok && mon && mon.status === "kanzlei" && mon.am);
    const leer = await buch.monatsExcel(user, 2019, 2);
    pruefe("leerer Monat -> grund leer, kein Protokoll", !leer.ok && leer.grund === "leer");
    const st = await buch.offeneZumStichtag(user, 2026, 12);
    pruefe("offeneZumStichtag(): liefert Liste mit stichtag", Array.isArray(st) && (st.length === 0 || st[0].stichtag === "2026-12-31"));

    console.log("\n— Zu tun —");
    const zt = await buch.zuTun(user);
    pruefe("zuTun(): Zahlen und Vormonat", Number.isInteger(zt.belegeUngeprueft) && zt.vormonat && Number.isInteger(zt.vormonat.monat));
    const ro = await buch.rechnungenOffen(user);
    pruefe("rechnungenOffen(): wirft nie, liefert Liste", Array.isArray(ro.liste) && typeof ro.summe === "number");
  } catch (e) {
    pruefe("Testlauf ohne Ausnahme", false, String(e && e.stack || e).slice(0, 400));
  } finally {
    // Aufraeumen — in umgekehrter Reihenfolge: erst Buchungen, dann Belege verwerfen.
    for (const id of angelegt.buchungen) { try { await buch.buchungLoeschen(user, id); } catch {} }
    await c.query(`delete from public.buchungen where gegenstelle like 'DBTEST%'`);
    for (const id of angelegt.belege) { try { await buch.belegVerwerfen(user, id, "DBTEST aufgeraeumt"); } catch {} }
    await c.query(`delete from public.monats_exporte where jahr = 2025 and monat = 11 and anzahl = 1`);
    await c.end();
  }
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
