// Flowstate Buchhaltung — Datenzugriff.
// Nutzt denselben RLS-Weg wie das CRM (lib/crm.js): jede Abfrage laeuft im Namen
// des angemeldeten Nutzers, die Policies aus 0021_buchhaltung.sql lassen nur die
// Geschaeftsfuehrung heran.
//
// UMBAU 05.09.2026 (Auftrag D2, "hochmodernes Buchhaltungsmodul"):
//   - Ausgaben duerfen OFFEN sein (bezahlt = false + faellig). Bisher hat der
//     Code jede Ausgabe als bezahlt erzwungen — eine Lieferantenrechnung mit
//     Zahlungsziel liess sich damit nicht abbilden, und "was muessen wir noch
//     zahlen" war nicht beantwortbar. Folge fuer JEDE Summe: Ausgaben zaehlen
//     nur noch, wenn sie bezahlt sind — genau wie Einnahmen schon immer.
//   - Zufluss-Prinzip ueberall: Zeitraum-Summen, Verlauf und Kategorien
//     rechnen nach dem ZAHLTAG (bezahlt_am), nicht mehr nach dem Belegdatum.
//     Bis heute lief die Uebersicht nach datum, der Monatsordner nach
//     bezahlt_am — eine Juli-Rechnung, im September bezahlt, stand oben im
//     Juli und unten im September. Jetzt sagen beide dasselbe.
//   - Fixkosten: buchungen.intervall / naechste_faelligkeit (Migration 0061).
//   - Belegquelle (belege.quelle), Belegliste mit Filtern, Monatsstatus,
//     Excel-Abschluss, Kosten-Dashboard.
//   - Befund-Fixes: kennzahlen() zaehlte status='offen' (gibt es seit 0022
//     nicht), der Verlauf rechnete ohne bezahlt-Filter, eine tote
//     Belegabfrage lief bei jedem Seitenaufruf umsonst.
const crm = require("./crm.js");
const archiv = require("./archiv.js");
const leser = require("./belegleser.js");
const alsNutzer = crm.alsNutzer;

// Kategorien. Bewusst hier und nicht in der Datenbank: sie aendern sich selten,
// und eine feste Liste haelt die Auswertung vergleichbar.
// (Bis zum 28.07. musste diese Liste zu einer zweiten in lexware.js passen. Die
// Lexware-Anbindung ist entfallen — die Kategorien haengen jetzt an nichts mehr
// ausser der eigenen Auswertung und dem Monatsordner.)
const AUSGABE_KATEGORIEN = [
  "Software & Tools", "Werbung & Ads", "Personal", "Honorare & Freelancer",
  "Büro & Ausstattung", "Fahrzeug & Tanken", "Reisekosten",
  // Bewirtung und Verpflegung (28.07.): lief bis dahin unter "Sonstiges" und
  // war damit in der Auswertung nicht von allem anderen zu trennen — dabei ist
  // es die Kategorie, die das Finanzamt am genauesten ansieht.
  "Essen & Getränke",
  "Steuern & Abgaben", "Versicherungen", "Sonstiges",
];
const EINNAHME_KATEGORIEN = [
  "Webdesign", "Performance Marketing", "KI-Projekte", "Hosting & Wartung", "Sonstiges",
];

// Zeitraum-Ausdruecke. Kommen aus dieser festen Liste und nie aus der Adresszeile.
const ZEITRAEUME = {
  monat: "date_trunc('month', current_date)",
  m3: "current_date - interval '3 months'",
  m6: "current_date - interval '6 months'",
  m12: "current_date - interval '12 months'",
  alle: null,
};

// Woher ein Beleg kommen kann (Migration 0061). Alles andere wird zu "web" —
// die Kopfzeile kommt aus dem Browser und darf keinen Freitext in die
// Datenbank tragen.
const QUELLEN = ["web", "handy", "telegram", "mail", "akte"];
const INTERVALLE = ["monatlich", "jaehrlich"];

const MONATSNAME = ["Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];

const istTag = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

// ---------------------------------------------------------- Reine Rechnerei
//
// Diese Funktionen kennen keine Datenbank. Sie sind einzeln pruefbar
// (scripts/test-buchhaltung.js) — und genau die Stellen, an denen sich
// stillschweigend eine Zahl verrechnen kann.

// Kopfzeile X-Quelle -> gueltiger Wert. Unbekanntes oder leeres = "web".
function quelleAus(kopf) {
  const q = String(kopf || "").trim().toLowerCase();
  return QUELLEN.includes(q) ? q : "web";
}

// Datum als JJJJ-MM-TT aus Date oder Text, ohne UTC-Drehung (siehe
// tagSortierbar weiter unten).
function tagText(v) {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Naechste Faelligkeit einer wiederkehrenden Kostenstelle: ein Intervall nach
// dem gegebenen Tag. Monatsende wird abgefangen: 31.01. + 1 Monat ist der
// 28./29.02., nicht der 3. Maerz (so rechnet JavaScript sonst).
// ankerTag: der Tag im Monat, an dem die Kostenstelle URSPRUENGLICH faellig
// war (aus dem Datum der Vorlage). Ohne ihn bliebe eine Kostenstelle vom 31.
// nach dem Februar fuer immer auf dem 28. haengen — gefunden im DB-Test am
// 05.09.2026 (31.01. -> 28.02. -> 28.03. statt 31.03.).
function naechsteFaelligkeit(datum, intervall, ankerTag = null) {
  const t = tagText(datum);
  if (!t || !INTERVALLE.includes(intervall)) return null;
  const [j, m, d] = t.split("-").map(Number);
  const zielMonat = intervall === "monatlich" ? m + 1 : m + 12;   // 1-basiert
  const zj = j + Math.floor((zielMonat - 1) / 12);
  const zm = ((zielMonat - 1) % 12) + 1;
  const letzter = new Date(zj, zm, 0).getDate();                // Tage im Zielmonat
  const anker = Number.isInteger(ankerTag) && ankerTag >= 1 && ankerTag <= 31 ? ankerTag : d;
  const zd = Math.min(anker, letzter);
  return `${zj}-${String(zm).padStart(2, "0")}-${String(zd).padStart(2, "0")}`;
}

// Monatliche Last aus den Fixkosten-Vorlagen: monatlich zaehlt voll,
// jaehrlich mit einem Zwoelftel. Ohne Intervall zaehlt eine Zeile nicht —
// sie ist dann keine Vorlage, sondern eine gewoehnliche Buchung.
function fixkostenJeMonat(liste) {
  let summe = 0;
  for (const b of liste || []) {
    const betrag = Number(b.betrag) || 0;
    if (b.intervall === "monatlich") summe += betrag;
    else if (b.intervall === "jaehrlich") summe += betrag / 12;
  }
  return Math.round(summe * 100) / 100;
}

// Offene Posten zusammenzaehlen: Summe, Anzahl, aelteste Faelligkeit,
// davon ueberfaellig (Faelligkeit vor heute). "heute" kommt von aussen, damit
// der Test nicht am Kalender haengt.
function offeneSummen(liste, heute = tagText(new Date())) {
  const raus = { summe: 0, anzahl: 0, aelteste: null, ueberfaellig: 0, ueberfaelligSumme: 0 };
  for (const b of liste || []) {
    if (b.bezahlt) continue;
    const betrag = Number(b.betrag) || 0;
    raus.summe += betrag;
    raus.anzahl += 1;
    const f = tagText(b.faellig);
    if (f) {
      if (!raus.aelteste || f < raus.aelteste) raus.aelteste = f;
      if (f < heute) { raus.ueberfaellig += 1; raus.ueberfaelligSumme += betrag; }
    }
  }
  raus.summe = Math.round(raus.summe * 100) / 100;
  raus.ueberfaelligSumme = Math.round(raus.ueberfaelligSumme * 100) / 100;
  return raus;
}

// Status eines Monats aus dem Export-Protokoll ableiten.
//
//   laufend  der Monat ist noch nicht vorbei — kein Abschluss moeglich
//   offen    nichts geholt, nichts verschickt
//   excel    Excel geholt (juengste Handlung)
//   zip      ZIP geholt (juengste Handlung)
//   kanzlei  an die Kanzlei gegangen — das ist der Endzustand, egal was
//            danach noch geholt wurde: ein nachtraeglicher Blick ins Excel
//            macht den Versand nicht ungeschehen
//
// exporte: Zeilen aus monats_exporte (beliebige Monate, wird gefiltert).
function monatsStatus({ jahr, monat }, exporte = [], heute = new Date()) {
  const j = heute.getFullYear(), m = heute.getMonth() + 1;
  const laufend = jahr > j || (jahr === j && monat >= m);
  const zeit = (v) => (v ? new Date(v).getTime() : 0);
  let kanzlei = null, excel = null, zip = null;
  for (const x of exporte || []) {
    if (Number(x.jahr) !== Number(jahr) || Number(x.monat) !== Number(monat)) continue;
    if (x.an_kanzlei_am) { if (zeit(x.an_kanzlei_am) > zeit(kanzlei)) kanzlei = x.an_kanzlei_am; }
    else if (x.excel_geholt_am) { if (zeit(x.excel_geholt_am) > zeit(excel)) excel = x.excel_geholt_am; }
    else if (zeit(x.erstellt) > zeit(zip)) zip = x.erstellt;
  }
  if (kanzlei) return { status: "kanzlei", am: kanzlei, excel, zip, laufend };
  if (laufend) return { status: "laufend", am: null, excel, zip, laufend };
  if (excel && zeit(excel) >= zeit(zip)) return { status: "excel", am: excel, excel, zip, laufend };
  if (zip) return { status: "zip", am: zip, excel, zip, laufend };
  return { status: "offen", am: null, excel, zip, laufend };
}

// Aus dem, was ankommt, einen Betrag machen.
//
// DER PUNKT WAR DAS PROBLEM (21.08.2026). Hier stand: alle Punkte weg, Komma
// wird Punkt. Richtig fuer das Formularfeld, in dem "1.234,56" steht — und
// falsch fuer alles, was schon eine Zahl ist. Der Belegleser gibt betrag als
// ZAHL zurueck, und lib/beleg-telegram.js reicht sie unveraendert an
// /buchhaltung/beleg/buchen weiter. Aus 37.3 wurde "37.3", daraus "373".
//
// Gemessen am 21.08. mit dem echten Bon vom Asia-Imbiss: 37,30 Euro auf dem
// Papier, 373,00 Euro in der Datenbank. Aufgefallen ist es nur, weil derselbe
// Beleg im Anzeigen-Dreh vor der Kamera eingelesen wird und die Zahl im Bild
// steht. Jeder per Telegram gebuchte Beleg mit Nachkommastellen war davon
// betroffen — also praktisch jeder.
//
// Die Regel jetzt:
//   Zahl bleibt Zahl.
//   Text mit Komma ist deutsch: Punkte sind Tausender, das Komma trennt.
//   Text nur mit Punkten: Ein Punkt mit GENAU drei Ziffern dahinter ist ein
//   Tausenderpunkt ("1.234"), alles andere trennt die Nachkommastellen
//   ("37.3", "37.30"). Das ist dieselbe Lesart, die auch ein Mensch waehlt.
const zuBetrag = (v) => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  let t = String(v ?? "").replace(/\s|€/g, "");
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+(\.\d+)+$/.test(t)) {
    const teile = t.split(".");
    if (teile[teile.length - 1].length === 3) t = teile.join("");
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// ---------------------------------------------------------- Steuerkanzlei
//
// (Migration 0055, 20.08.2026.) Die eigene Kanzlei steht in den
// Finanz-Einstellungen und NICHT im CRM: dort liegen Kunden und Leads, und
// darunter sind Steuerkanzleien als angerufene Betriebe. Eine Suche nach
// "Steuerberater" haette dort mit einiger Wahrscheinlichkeit ein fremdes Buero
// getroffen — und ihm unsere Belege geschickt.
//
// Anrede getrennt vom Namen, weil Alexandra den Satz spricht: "Soll ich sie an
// Frau Meier schicken?" Ein "Frau" davorzusetzen waere geraten, und bei einem
// Herrn Meier waere es peinlich.

// Muss ein @ haben und danach einen Punkt mit Endung. Eine kaputte Adresse ist
// spaeter eine Mail ins Leere: Der Monatsordner gilt als verschickt, angekommen
// ist er nie — und das faellt erst auf, wenn die Kanzlei nachfragt.
const MAIL_MUSTER = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[a-z]{2,}$/i;
module.exports.mailGueltig = (m) => MAIL_MUSTER.test(String(m || "").trim());

// Migration 0055 laeuft NICHT automatisch mit dem Deploy. Solange sie nicht
// eingespielt ist, gibt es die vier Spalten nicht — und ein "update ... set
// steuer_mail" braeche dann JEDES Speichern ab, auch das von Kontostand und
// Steuersatz, mit denen alles in Ordnung waere. Darum einmal nachsehen und das
// Ergebnis merken: Spalten kommen und gehen nicht im laufenden Betrieb.
let kanzleiSpalten = null;
async function kanzleiSpaltenDa(q) {
  if (kanzleiSpalten !== null) return kanzleiSpalten;
  try {
    const { rows } = await q(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'finanz_einstellungen'
          and column_name = 'steuer_mail' limit 1`);
    kanzleiSpalten = rows.length > 0;
  } catch { kanzleiSpalten = false; }
  return kanzleiSpalten;
}

// Dasselbe fuer Migration 0061: Ohne intervall/quelle/an_kanzlei_am duerfen
// die alten Wege (buchen, hochladen, ZIP) trotzdem laufen. Die neuen Seiten
// sagen dann klar, dass die Migration fehlt, statt mit "column does not
// exist" abzubrechen.
let kostenSpalten = null;
async function kostenSpaltenDa(q) {
  if (kostenSpalten !== null) return kostenSpalten;
  try {
    const { rows } = await q(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'buchungen'
          and column_name = 'intervall' limit 1`);
    kostenSpalten = rows.length > 0;
  } catch { kostenSpalten = false; }
  return kostenSpalten;
}
module.exports.migration0061Da = async function (user) {
  return alsNutzer(user.id, (q) => kostenSpaltenDa(q));
};

// Und dasselbe fuer das Rechnungsmodul (0060). Gebraucht von
// monateMitDaten(): Die Zaehlung "x von n mit Datei" muss die eigenen
// Ausgangsrechnungen mitzaehlen, seit sie im Monatsordner liegen (06.09.2026)
// — aber ein Haus ohne Rechnungsmodul darf daran nicht scheitern.
let rechnungenTabelle = null;
async function rechnungenTabelleDa(q) {
  if (rechnungenTabelle !== null) return rechnungenTabelle;
  try {
    const { rows } = await q(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'rechnungen'
          and column_name = 'pdf' limit 1`);
    rechnungenTabelle = rows.length > 0;
  } catch { rechnungenTabelle = false; }
  return rechnungenTabelle;
}

const feldText = (v) => (typeof v === "string" ? v.trim() : "");

// Startsaldo und Steuersatz. Der Kontostand kommt NICHT von Lexware — die
// Schnittstelle gibt keinen heraus (alle Konto-Endpunkte antworten mit 404).
// Darum: einmal den heutigen Stand eintragen, danach laeuft er mit den Buchungen mit.
module.exports.einstellungen = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(`select * from finanz_einstellungen where id = 1`);
    const e = rows[0] || { start_saldo: 0, steuersatz: 30 };
    return {
      ...e,
      start_saldo: Number(e.start_saldo),
      steuersatz: Number(e.steuersatz),
      // Immer als Text, nie undefined: Vor der Migration gibt es die Spalten
      // gar nicht, und ein leeres Feld muss sich genauso anfuehlen wie eines,
      // das noch niemand ausgefuellt hat — sonst raet der Aufrufer.
      steuer_anrede: feldText(e.steuer_anrede),
      steuer_name: feldText(e.steuer_name),
      steuer_mail: feldText(e.steuer_mail),
      steuer_notiz: feldText(e.steuer_notiz),
    };
  });
};

// Die Kanzlei so, wie sie gesprochen und adressiert wird. Eine Stelle, damit
// steuer-versand.js und die Oberflaeche denselben Namen sagen.
//
// "an" ist nur gesetzt, wenn die Adresse auch taugt: Eine halb eingetippte
// Adresse ist schlimmer als gar keine — bei gar keiner fragt Alexandra nach,
// bei einer halben schickt sie ins Leere.
module.exports.steuerkanzlei = async function (user) {
  const e = await module.exports.einstellungen(user);
  const name = [e.steuer_anrede, e.steuer_name].filter(Boolean).join(" ");
  return {
    anrede: e.steuer_anrede,
    name,                       // "Frau Meier" — fertig fuer den Sprechtext
    reinerName: e.steuer_name,
    an: module.exports.mailGueltig(e.steuer_mail) ? e.steuer_mail : "",
    notiz: e.steuer_notiz,
  };
};

module.exports.einstellungenSetzen = async function (user, d) {
  // NUR anfassen, was im Rumpf steht (Fehler gefunden 05.09.2026 im QA-Lauf):
  // Das Kanzlei-Formular schickt keine Kontostand-Felder mit. zuBetrag(undefined)
  // ist aber 0, und Number("") ebenfalls — jedes Speichern der Kanzlei setzte
  // damit Kontostand UND Steuersatz auf null. Der alte Kanzlei-Dialog hatte
  // denselben Fehler; aufgefallen ist er erst, als die Beispieldaten beides
  // nacheinander schrieben und die Kachel "0 % vom Gewinn" zeigte.
  const saldo = "start_saldo" in (d || {}) ? zuBetrag(d.start_saldo) : null;
  const satz = "steuersatz" in (d || {}) && String(d.steuersatz || "").trim() !== ""
    ? Number(String(d.steuersatz).replace(",", ".")) : null;

  // Die Kanzlei-Felder kommen aus einem EIGENEN Formular, und ein Formular
  // schickt immer nur seine eigenen Felder mit. Steht keines davon im Rumpf,
  // wird an der Kanzlei auch nichts angefasst — sonst wuerde jedes Speichern
  // des Kontostands die hinterlegte Adresse leeren.
  const kanzlei = ["steuer_anrede", "steuer_name", "steuer_mail", "steuer_notiz"]
    .some((f) => f in (d || {}));

  // Nur "Frau" oder "Herr". Freitext hier waere ein zweiter Namensteil, und
  // dann stuende die Anrede zweimal im gesprochenen Satz.
  const anrede = ["Frau", "Herr"].includes(feldText(d.steuer_anrede)) ? feldText(d.steuer_anrede) : null;
  const mail = feldText(d.steuer_mail);
  const mailOk = !mail || module.exports.mailGueltig(mail);

  return alsNutzer(user.id, async (q) => {
    await q(
      `update finanz_einstellungen
          set start_saldo = coalesce($1, start_saldo),
              saldo_stand = coalesce($2, saldo_stand),
              steuersatz  = case when $3 between 0 and 100 then $3 else steuersatz end,
              geaendert_von = $4, geaendert = now()
        where id = 1`,
      [saldo, d.saldo_stand || null, Number.isFinite(satz) ? satz : null, user.id]);

    if (!kanzlei) return { ok: true };
    if (!(await kanzleiSpaltenDa(q))) return { ok: false, grund: "migration-fehlt" };

    // Eine ungueltige Adresse laesst den ALTEN Wert stehen (case when), statt
    // ihn durch Unsinn zu ersetzen. Name und Notiz werden trotzdem gespeichert:
    // Wer sich bei der Adresse vertippt, soll nicht auch noch die Anschrift
    // neu eintippen muessen.
    await q(
      `update finanz_einstellungen
          set steuer_anrede = $1,
              steuer_name   = $2,
              steuer_mail   = case when $4::boolean then $3::text else steuer_mail end,
              steuer_notiz  = $5,
              geaendert_von = $6, geaendert = now()
        where id = 1`,
      [anrede, feldText(d.steuer_name) || null, mail || null, mailOk,
       feldText(d.steuer_notiz) || null, user.id]);

    return mailOk ? { ok: true } : { ok: false, grund: "mail" };
  });
};

// Kontostand und Steuer-Ruecklage. Beides laeuft ueber ALLE Buchungen, nicht ueber
// den gewaehlten Zeitraum — ein Kontostand kennt keinen Zeitraum.
module.exports.kontoUndSteuer = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [e] } = await q(`select start_saldo, saldo_stand, steuersatz from finanz_einstellungen where id = 1`);
    const satz = Number(e?.steuersatz ?? 30);
    const start = Number(e?.start_saldo ?? 0);
    // Nur BEZAHLTE Buchungen bewegen das Konto — in beide Richtungen. Eine
    // offene Rechnung ist Geld, das noch nicht da ist; eine offene
    // Lieferantenrechnung ist Geld, das noch nicht weg ist.
    // Ab dem Stichtag des Startsaldos rechnen, sonst zaehlen Altbuchungen
    // doppelt. Massgeblich ist der Zahltag: Nur was NACH dem Stichtag
    // geflossen ist, fehlt im eingetragenen Stand.
    const seit = e?.saldo_stand ? ` and coalesce(b.bezahlt_am, b.datum) > $1::date` : "";
    const a = e?.saldo_stand ? [e.saldo_stand] : [];
    const { rows: [bew] } = await q(
      `select coalesce(sum(b.betrag) filter (where b.art = 'einnahme'), 0)::numeric as ein,
              coalesce(sum(b.betrag) filter (where b.art = 'ausgabe'), 0)::numeric as aus
         from buchungen b where b.bezahlt${seit}`, a);
    const ein = Number(bew.ein), aus = Number(bew.aus);
    const stand = start + ein - aus;

    // Steuer-Ruecklage auf den Gewinn des laufenden Jahres — nicht auf den Umsatz.
    // Bei Verlust ist die Ruecklage null, nicht negativ.
    const { rows: [jahr] } = await q(
      `select coalesce(sum(b.betrag) filter (where b.art = 'einnahme'), 0)::numeric as ein,
              coalesce(sum(b.betrag) filter (where b.art = 'ausgabe'), 0)::numeric as aus
         from buchungen b
        where b.bezahlt and coalesce(b.bezahlt_am, b.datum) >= date_trunc('year', current_date)`);
    const gewinn = Number(jahr.ein) - Number(jahr.aus);
    const ruecklage = gewinn > 0 ? Math.round(gewinn * satz) / 100 : 0;
    return {
      start, saldo_stand: e?.saldo_stand || null, satz,
      stand, bewegung_ein: ein, bewegung_aus: aus,
      jahr_ein: Number(jahr.ein), jahr_aus: Number(jahr.aus), gewinn, ruecklage,
      frei: stand - ruecklage,
    };
  });
};

// Die Zahlen fuer die Karte auf der Zentrale.
//
// Bewusst NICHT uebersicht() — das sind sechs Abfragen samt Kontoauszug und
// Belegliste, und davon braucht eine Startseiten-Karte nichts. Zwei schmale
// Abfragen, die auf der Zentrale in Millisekunden durch sind.
//
// "Einnahmen" zaehlt wie ueberall in diesem Modul nur BEZAHLTES: eine
// verschickte Rechnung ist noch kein Geld. Sie steht daneben unter "offen".
//
// belege_offen: bis zum 05.09. stand hier status = 'offen' — ein Wert, den es
// seit Migration 0022 nicht gibt. Die Zahl war darum immer null, und die Zeile
// "Belege ohne Buchung" auf der Zentrale erschien nie.
module.exports.kennzahlen = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [b] } = await q(
      `select
        coalesce(sum(betrag) filter (where art = 'einnahme' and bezahlt
                 and coalesce(bezahlt_am, datum) >= date_trunc('month', current_date)), 0)::numeric as einnahmen_monat,
        coalesce(sum(betrag) filter (where art = 'ausgabe' and bezahlt
                 and coalesce(bezahlt_am, datum) >= date_trunc('month', current_date)), 0)::numeric as ausgaben_monat,
        coalesce(sum(betrag) filter (where art = 'einnahme' and not bezahlt), 0)::numeric as offen_summe,
        count(*) filter (where art = 'einnahme' and not bezahlt)::int as offen_anzahl,
        count(*) filter (where art = 'einnahme' and not bezahlt
                 and faellig < current_date)::int as ueberfaellig,
        coalesce(sum(betrag) filter (where art = 'ausgabe' and not bezahlt), 0)::numeric as offene_ausgaben_summe,
        count(*) filter (where art = 'ausgabe' and not bezahlt)::int as offene_ausgaben_anzahl,
        count(*) filter (where art = 'ausgabe' and not bezahlt
                 and faellig < current_date)::int as ueberfaellig_ausgaben
       from buchungen`);
    const { rows: [be] } = await q(
      `select count(*) filter (where status = 'neu')::int as offen from belege`);
    const ein = Number(b.einnahmen_monat), aus = Number(b.ausgaben_monat);
    return {
      einnahmen_monat: ein, ausgaben_monat: aus, ergebnis_monat: ein - aus,
      offen_summe: Number(b.offen_summe), offen_anzahl: b.offen_anzahl,
      ueberfaellig: b.ueberfaellig, belege_offen: be.offen,
      offene_ausgaben_summe: Number(b.offene_ausgaben_summe),
      offene_ausgaben_anzahl: b.offene_ausgaben_anzahl,
      ueberfaellig_ausgaben: b.ueberfaellig_ausgaben,
    };
  });
};

// Alles fuer die Uebersicht in einem Rutsch.
module.exports.uebersicht = async function (user, zeitraum = "monat") {
  const seitSql = ZEITRAEUME[zeitraum] === undefined ? ZEITRAEUME.monat : ZEITRAEUME[zeitraum];
  // Zufluss-Prinzip: Der Zahltag entscheidet, in welchen Zeitraum eine
  // Buchung faellt. coalesce nur als Netz fuer Altzeilen ohne bezahlt_am.
  const seit = seitSql ? ` and coalesce(b.bezahlt_am, b.datum) >= ${seitSql}` : "";
  return alsNutzer(user.id, async (q) => {
    // Summen je Richtung im Zeitraum.
    // WICHTIG: Nur BEZAHLTE zaehlen — in beide Richtungen. Eine verschickte
    // Rechnung ist noch kein Geld, eine offene Lieferantenrechnung noch keine
    // Ausgabe. Beides steht unter "Offen" und wandert erst mit dem Haken hierher.
    const { rows: [summe] } = await q(
      `select
        coalesce(sum(b.betrag) filter (where b.art = 'einnahme'), 0)::numeric as einnahmen,
        coalesce(sum(b.betrag) filter (where b.art = 'ausgabe'), 0)::numeric as ausgaben,
        count(*) filter (where b.art = 'einnahme')::int as anzahl_einnahmen,
        count(*) filter (where b.art = 'ausgabe')::int as anzahl_ausgaben
       from buchungen b where b.bezahlt${seit}`);

    // Offene Rechnungen (Einnahmen) — zeitraumunabhaengig, offen ist offen.
    const { rows: offen } = await q(
      `select b.*, f.name as firma_name,
              (current_date - b.faellig) as tage_ueber
         from buchungen b left join firmen f on f.id = b.firma_id
        where b.art = 'einnahme' and b.bezahlt = false
        order by b.faellig nulls last, b.datum`);

    // Offene Ausgaben — was wir noch zahlen muessen. Ebenfalls zeitlos.
    const { rows: offenAus } = await q(
      `select b.*, f.name as firma_name,
              (current_date - b.faellig) as tage_ueber
         from buchungen b left join firmen f on f.id = b.firma_id
        where b.art = 'ausgabe' and b.bezahlt = false
        order by b.faellig nulls last, b.datum`);

    // Verlauf je Monat — immer die letzten zwoelf, damit die Kurve etwas zeigt.
    // Mit bezahlt-Filter (Befund 05.09.): vorher lagen die Balken systematisch
    // ueber den Kacheln, weil offene Rechnungen mitgezaehlt wurden.
    const { rows: verlauf } = await q(
      `select to_char(date_trunc('month', coalesce(b.bezahlt_am, b.datum)), 'YYYY-MM') as monat,
              coalesce(sum(b.betrag) filter (where b.art = 'einnahme'), 0)::numeric as einnahmen,
              coalesce(sum(b.betrag) filter (where b.art = 'ausgabe'), 0)::numeric as ausgaben
         from buchungen b
        where b.bezahlt
          and coalesce(b.bezahlt_am, b.datum) >= date_trunc('month', current_date) - interval '11 months'
        group by 1 order by 1`);

    // Ausgaben je Kategorie im Zeitraum (bezahlt)
    const { rows: kategorien } = await q(
      `select coalesce(nullif(b.kategorie, ''), 'Ohne Kategorie') as kategorie,
              sum(b.betrag)::numeric as betrag, count(*)::int as anzahl
         from buchungen b where b.art = 'ausgabe' and b.bezahlt${seit}
        group by 1 order by 2 desc`);

    // Letzte Buchungen — der Kontoauszug-Blick (offene mit dabei, sie sind
    // ja erfasst; die Tabelle markiert sie).
    const { rows: letzte } = await q(
      `select b.*, f.name as firma_name, p.name as wer
         from buchungen b
         left join firmen f on f.id = b.firma_id
         left join profiles p on p.id = b.erfasst_von
        order by b.datum desc, b.id desc limit 12`);

    const zahl = (l) => l.map((o) => ({ ...o, betrag: Number(o.betrag) }));
    return {
      summe: {
        einnahmen: Number(summe.einnahmen), ausgaben: Number(summe.ausgaben),
        ergebnis: Number(summe.einnahmen) - Number(summe.ausgaben),
        anzahl_einnahmen: summe.anzahl_einnahmen, anzahl_ausgaben: summe.anzahl_ausgaben,
      },
      offen: zahl(offen),
      offenSumme: offen.reduce((a, o) => a + Number(o.betrag), 0),
      offenAus: zahl(offenAus),
      offenAusSumme: offenAus.reduce((a, o) => a + Number(o.betrag), 0),
      verlauf: verlauf.map((v) => ({ monat: v.monat, einnahmen: Number(v.einnahmen), ausgaben: Number(v.ausgaben) })),
      kategorien: zahl(kategorien),
      letzte: zahl(letzte),
    };
  });
};

// Eine Buchung erfassen. betrag kommt als Text aus dem Formular ("1.234,56").
//
// Beide Richtungen koennen offen sein (bezahlt = "nein" + faellig). Eine
// Ausgabe mit Zahlungsziel ist eine Verbindlichkeit — und genau die will das
// Kosten-Dashboard sehen ("was muessen wir noch zahlen").
//
// intervall ("monatlich" | "jaehrlich") macht die Buchung zur Vorlage einer
// wiederkehrenden Kostenstelle; naechste_faelligkeit ist dann ein Intervall
// nach dem Buchungsdatum. Das alte Kennzeichen wiederkehrend laeuft mit,
// damit nichts, was es noch liest, umfaellt.
module.exports.buchen = async function (user, d) {
  const art = d.art === "einnahme" ? "einnahme" : "ausgabe";
  const betrag = zuBetrag(d.betrag);
  // Null Euro sind keine Buchung — ein leeres Feld ergibt bei zuBetrag 0.
  if (betrag === null || betrag <= 0) return { ok: false, grund: "betrag" };
  const erlaubt = art === "einnahme" ? EINNAHME_KATEGORIEN : AUSGABE_KATEGORIEN;
  const bezahlt = d.bezahlt !== "nein";
  const datum = istTag(d.datum) ? d.datum : tagText(new Date());
  // "wiederkehrend=ja" aus dem alten Dialog bedeutet monatlich.
  const intervall = INTERVALLE.includes(d.intervall) ? d.intervall
    : d.wiederkehrend === "ja" ? "monatlich" : null;
  const faellig = !bezahlt && istTag(d.faellig) ? d.faellig : null;
  return alsNutzer(user.id, async (q) => {
    const mitKosten = await kostenSpaltenDa(q);
    const spalten = ["art", "datum", "betrag", "kategorie", "gegenstelle", "notiz",
      "firma_id", "bezahlt", "bezahlt_am", "faellig", "wiederkehrend", "erfasst_von"];
    const werte = [art, datum, betrag,
      erlaubt.includes(d.kategorie) ? d.kategorie : null,
      feldText(d.gegenstelle) || null, feldText(d.notiz) || null,
      /^\d+$/.test(String(d.firma_id || "")) ? d.firma_id : null,
      bezahlt,
      // Zahltag = Buchungsdatum, wenn schon bezahlt. Offen: keiner.
      bezahlt ? datum : null,
      faellig,
      Boolean(intervall), user.id];
    if (mitKosten) {
      spalten.push("intervall", "naechste_faelligkeit");
      werte.push(intervall, intervall ? naechsteFaelligkeit(datum, intervall) : null);
    }
    const { rows } = await q(
      `insert into buchungen (${spalten.join(", ")})
       values (${spalten.map((_, i) => "$" + (i + 1)).join(",")}) returning id`, werte);
    return { ok: true, id: rows[0].id, offen: !bezahlt };
  });
};

// Der Haken bei "Offen": Geld ist da (Einnahme) bzw. weg (Ausgabe).
//
// bezahlt_am ist hier das Wichtige, nicht das Kennzeichen. Es entscheidet, in
// welchen Monatsordner die Buchung wandert — nach dem Zufluss-Prinzip zaehlt
// der Tag, an dem das Geld floss, nicht der Tag, an dem wir die Rechnung
// geschrieben oder bekommen haben. Juli-Rechnung, im September bezahlt ->
// September-Ordner.
//
// Ein Zahltag kann mitgegeben werden (falls der Kontoauszug einen anderen Tag
// zeigt als heute); ohne Angabe ist es heute. Gilt fuer beide Richtungen.
module.exports.bezahltSetzen = async function (user, id, bezahlt = true, am = null) {
  const tag = istTag(am) ? am : null;
  return alsNutzer(user.id, async (q) => {
    const { rowCount } = await q(
      `update buchungen
          set bezahlt = $2,
              bezahlt_am = case when $2 then coalesce($3::date, current_date) else null end,
              faellig    = case when $2 then null else faellig end
        where id = $1`, [id, !!bezahlt, tag]);
    return { ok: rowCount > 0 };
  });
};

// Eine Buchung zuruecknehmen. Der zugehoerige Beleg wandert zurueck in den
// Eingang — er bleibt erhalten, nur die Buchung ist weg.
// ('neu', nicht 'offen': 'offen' war der Zustand aus 0021 und ist seit 0022 kein
// gueltiger Wert mehr. Bis 0024 lief das hier in die Pruefregel.)
module.exports.buchungLoeschen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    await q(`update belege set buchung_id = null, status = 'neu' where buchung_id = $1`, [id]);
    await q(`delete from buchungen where id = $1`, [id]);
    return { ok: true };
  });
};

// ---------------------------------------------------------------- Fixkosten
//
// Eine Buchung mit intervall ist die Vorlage einer wiederkehrenden
// Kostenstelle (Adobe monatlich, Versicherung jaehrlich). Die Kosten-Seite
// zeigt sie mit "faellig am"; gebucht wird die naechste Zahlung NUR per Klick.
// Nichts entsteht von selbst — eine Buchung, die niemand ausgeloest hat, waere
// eine Zahl, die niemand bestaetigt hat.

module.exports.fixkosten = async function (user) {
  return alsNutzer(user.id, async (q) => {
    if (!(await kostenSpaltenDa(q))) return [];
    const { rows } = await q(
      `select b.*, f.name as firma_name
         from buchungen b left join firmen f on f.id = b.firma_id
        where b.intervall is not null
        order by b.naechste_faelligkeit nulls last, b.betrag desc`);
    return rows.map((r) => ({ ...r, betrag: Number(r.betrag) }));
  });
};

// "Diesen Monat gebucht": legt die naechste Zahlung als EINMALIGE Buchung an
// und schiebt die Vorlage um ein Intervall weiter. quelle_schluessel traegt
// Vorlage und Faelligkeitsmonat — der eindeutige Index aus 0061 faengt einen
// Doppelklick ab, statt zweimal Adobe im selben Monat zu buchen.
// d.bezahlt = "nein" legt die Folgebuchung offen an (mit der Faelligkeit als
// Zahlungsziel); sonst gilt sie als am Faelligkeitstag bezahlt.
module.exports.fixkostenBuchen = async function (user, id, d = {}) {
  return alsNutzer(user.id, async (q) => {
    if (!(await kostenSpaltenDa(q))) return { ok: false, grund: "migration-0061" };
    const { rows: [v] } = await q(`select * from buchungen where id = $1 and intervall is not null`, [id]);
    if (!v) return { ok: false, grund: "nicht-gefunden" };
    const tag = istTag(d.datum) ? d.datum : (tagText(v.naechste_faelligkeit) || tagText(new Date()));
    const bezahlt = d.bezahlt !== "nein";
    const schluessel = `fix-${v.id}-${tag.slice(0, 7)}`;
    const { rows: schon } = await q(
      `select id from buchungen where quelle = 'fixkosten' and quelle_schluessel = $1`, [schluessel]);
    if (schon.length) return { ok: false, grund: "schon-gebucht", id: schon[0].id };
    const { rows: [neu] } = await q(
      `insert into buchungen (art, datum, betrag, kategorie, gegenstelle, notiz, firma_id,
                              bezahlt, bezahlt_am, faellig, wiederkehrend, erfasst_von,
                              quelle, quelle_schluessel)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,'fixkosten',$12) returning id`,
      [v.art, tag, v.betrag, v.kategorie, v.gegenstelle, v.notiz, v.firma_id,
       bezahlt, bezahlt ? tag : null, bezahlt ? null : tag, user.id, schluessel]);
    // Der Ankertag kommt aus dem Datum der Vorlage — siehe naechsteFaelligkeit.
    const ankerTag = Number(tagText(v.datum).slice(8, 10)) || null;
    await q(`update buchungen set naechste_faelligkeit = $2 where id = $1`,
      [v.id, naechsteFaelligkeit(tag, v.intervall, ankerTag)]);
    return { ok: true, id: neu.id, offen: !bezahlt };
  });
};

// Eine Kostenstelle beenden: die Vorlage bleibt als Buchung stehen (sie war
// eine echte Zahlung), verliert aber ihr Intervall und zaehlt nicht mehr zur
// monatlichen Last.
module.exports.fixkostenBeenden = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    if (!(await kostenSpaltenDa(q))) return { ok: false, grund: "migration-0061" };
    const { rowCount } = await q(
      `update buchungen set intervall = null, naechste_faelligkeit = null, wiederkehrend = false
        where id = $1 and intervall is not null`, [id]);
    return { ok: rowCount > 0 };
  });
};

// ------------------------------------------------------------ Kosten-Dashboard
//
// "Was muessen wir noch zahlen, was ist schon gezahlt." Alles aus der
// Datenbank, nichts geschaetzt.
module.exports.kosten = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const mitKosten = await kostenSpaltenDa(q);
    const { rows: offenAus } = await q(
      `select b.*, f.name as firma_name, (current_date - b.faellig) as tage_ueber
         from buchungen b left join firmen f on f.id = b.firma_id
        where b.art = 'ausgabe' and b.bezahlt = false
        order by b.faellig nulls last, b.datum, b.id`);
    const { rows: offenEin } = await q(
      `select b.*, f.name as firma_name, (current_date - b.faellig) as tage_ueber
         from buchungen b left join firmen f on f.id = b.firma_id
        where b.art = 'einnahme' and b.bezahlt = false
        order by b.faellig nulls last, b.datum, b.id`);
    const { rows: [monat] } = await q(
      `select coalesce(sum(b.betrag), 0)::numeric as summe, count(*)::int as anzahl
         from buchungen b
        where b.art = 'ausgabe' and b.bezahlt
          and coalesce(b.bezahlt_am, b.datum) >= date_trunc('month', current_date)`);
    const { rows: fix } = mitKosten ? await q(
      `select b.*, f.name as firma_name
         from buchungen b left join firmen f on f.id = b.firma_id
        where b.intervall is not null
        order by b.naechste_faelligkeit nulls last, b.betrag desc`) : { rows: [] };
    // Ausgaben nach Kategorie, zwoelf Monate — je Kategorie Summe und Anzahl,
    // dazu die Monatsreihe fuer ruhige Balken.
    const { rows: kategorien } = await q(
      `select coalesce(nullif(b.kategorie, ''), 'Ohne Kategorie') as kategorie,
              sum(b.betrag)::numeric as betrag, count(*)::int as anzahl
         from buchungen b
        where b.art = 'ausgabe' and b.bezahlt
          and coalesce(b.bezahlt_am, b.datum) >= date_trunc('month', current_date) - interval '11 months'
        group by 1 order by 2 desc`);
    const { rows: monate } = await q(
      `select to_char(date_trunc('month', coalesce(b.bezahlt_am, b.datum)), 'YYYY-MM') as monat,
              sum(b.betrag)::numeric as betrag
         from buchungen b
        where b.art = 'ausgabe' and b.bezahlt
          and coalesce(b.bezahlt_am, b.datum) >= date_trunc('month', current_date) - interval '11 months'
        group by 1 order by 1`);
    const zahl = (l) => l.map((o) => ({ ...o, betrag: Number(o.betrag) }));
    const fixListe = zahl(fix);
    return {
      offenAus: zahl(offenAus), offenAusSummen: offeneSummen(offenAus),
      offenEin: zahl(offenEin), offenEinSummen: offeneSummen(offenEin),
      bezahltMonat: { summe: Number(monat.summe), anzahl: monat.anzahl },
      fixkosten: fixListe, fixkostenMonat: fixkostenJeMonat(fixListe),
      kategorien: zahl(kategorien),
      monate: zahl(monate),
      migration0061: mitKosten,
    };
  });
};

// ---------------------------------------------------------------- Belegeingang
//
// Ablauf: hochladen -> auslesen -> bestaetigen -> gebucht.
//
// Die Datei bleibt DAUERHAFT bei uns in der Spalte "daten". Wir sind der
// Aufbewahrungsort, nicht mehr Lexware. Was das absichert, steht in Migration
// 0024: Laufnummer, Pruefsumme und ein Trigger, der Loeschen verbietet und die
// Datei gegen Austausch sperrt.

// Datei entgegennehmen. Noch nichts gebucht, nur unveraenderlich abgelegt.
// Die Laufnummer setzt die Datenbank selbst (Sequenz), damit sie auch dann
// lueckenlos bleibt, wenn zwei Uploads gleichzeitig laufen.
// d.quelle: web | handy | telegram | mail | akte (siehe quelleAus).
module.exports.belegHochladen = async function (user, d) {
  const art = d.art === "einnahme" ? "einnahme" : "ausgabe";
  // Die Datei kommt roh (Buffer) von der Hochladen-Route. datenBase64 bleibt als
  // zweiter Weg bestehen, damit sich Belege auch aus einem Skript einspielen
  // lassen, ohne einen Rumpf zusammenbauen zu muessen.
  const daten = Buffer.isBuffer(d.daten) ? d.daten
    : d.datenBase64 ? Buffer.from(d.datenBase64, "base64") : null;
  if (!daten || !daten.length) return { ok: false, grund: "keine-datei" };
  const quelle = quelleAus(d.quelle);
  return alsNutzer(user.id, async (q) => {
    // Gleiche Datei schon da? Dann ist es ein Doppel-Upload — wir legen sie
    // nicht zweimal ab, sondern verweisen auf den vorhandenen Beleg. Sonst
    // taucht derselbe Bon zweimal in den Ausgaben auf.
    const summe = archiv.pruefsumme(daten);
    const { rows: schon } = await q(
      `select id, laufnummer, status from belege
        where pruefsumme = $1 and status <> 'verworfen' limit 1`, [summe]);
    if (schon.length) {
      return { ok: true, doppelt: true, id: schon[0].id, laufnummer: schon[0].laufnummer };
    }
    const mitQuelle = await kostenSpaltenDa(q);
    const { rows } = await q(
      `insert into belege (dateiname, dateityp, daten, groesse, pruefsumme, art, status, von${mitQuelle ? ", quelle" : ""})
       values ($1,$2,$3,$4,$5,$6,'neu',$7${mitQuelle ? ",$8" : ""}) returning id, laufnummer`,
      [String(d.dateiname || "Beleg").slice(0, 200), d.dateityp || null,
       daten, daten.length, summe, art, user.id, ...(mitQuelle ? [quelle] : [])]);
    return { ok: true, id: rows[0].id, laufnummer: rows[0].laufnummer, quelle };
  });
};

// Beleg auslesen und die Werte als Vorschlag hinterlegen.
//
// Bewusst getrennt vom Hochladen: der Upload muss auch gelingen, wenn das Lesen
// scheitert oder kein Zugang hinterlegt ist. Was hier gesetzt wird, ist ein
// Vorschlag — gebucht wird erst mit "Passt".
//
// RICHTUNG (05.09.2026): Mail- und Telegram-Belege landen immer im
// Ausgabenkorb (mail-belege.js / beleg-telegram.js setzen X-Art fest). Erkennt
// der Leser dort mit HOHER Sicherheit eine Kundenrechnung, wird der Beleg
// umsortiert — bei diesen beiden Wegen hat kein Mensch die Richtung gewaehlt,
// es gibt also nichts zu ueberstimmen. Beim Web- und Handy-Upload hat jemand
// bewusst "Ausgabe" gedrueckt: da bleibt es beim Hinweis, umsortieren kann
// man in der Pruefmaske. Die Kategorie faellt beim Umsortieren weg, weil sie
// aus der falschen Liste kam.
module.exports.belegLesen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    const mitQuelle = await kostenSpaltenDa(q);
    const { rows: [b] } = await q(
      `select id, dateiname, dateityp, daten, art, status${mitQuelle ? ", quelle" : ""} from belege where id = $1`, [id]);
    if (!b) return { ok: false, grund: "nicht-gefunden" };
    if (b.status !== "neu") return { ok: false, grund: "nicht-offen" };

    const kategorien = b.art === "einnahme" ? EINNAHME_KATEGORIEN : AUSGABE_KATEGORIEN;
    const r = await leser.lesen(b, kategorien);

    if (!r.ok) {
      await q(`update belege set gelesen = now(), lese_hinweis = $2 where id = $1`,
        [id, String(r.hinweis || "Auslesen nicht möglich").slice(0, 400)]);
      return { ok: false, hinweis: r.hinweis };
    }

    const w = r.werte;
    const korb = b.art === "einnahme" ? "einnahme" : "ausgabe";
    const erkannt = w.richtung === "einnahme" ? "einnahme" : w.richtung === "ausgabe" ? "ausgabe" : null;
    const automatisch = ["mail", "telegram"].includes(b.quelle);
    const umsortieren = Boolean(erkannt && erkannt !== korb && automatisch && w.sicherheit === "hoch");

    // Der Hinweis sammelt beides: was das Modell selbst unklar fand, und den
    // Fall, dass die erkannte Richtung nicht zum Eingangskorb passt (Rechnung im
    // Ausgaben-Korb ist meistens ein Versehen und soll auffallen).
    const hinweise = [];
    if (w.hinweis) hinweise.push(w.hinweis);
    if (w.sicherheit === "niedrig") hinweise.push("Beleg war schlecht lesbar — Betrag und Datum bitte gegenprüfen.");
    if (erkannt && erkannt !== korb) {
      hinweise.push(umsortieren
        ? (erkannt === "einnahme"
          ? "Als Einnahme einsortiert — sah nach einer Rechnung an einen Kunden aus. Kategorie bitte wählen."
          : "Als Ausgabe einsortiert — sah nach einem bezahlten Beleg aus. Kategorie bitte wählen.")
        : (erkannt === "einnahme"
          ? "Sieht nach einer Rechnung an einen Kunden aus, liegt aber bei den Ausgaben."
          : "Sieht nach einem bezahlten Beleg aus, liegt aber bei den Einnahmen."));
    }

    await q(
      `update belege set betrag = $2, datum = $3, gegenstelle = $4, kategorie = $5,
              belegnummer = $6, steuersatz = $7, notiz = $8, faellig = $9,
              gelesen = now(), lese_hinweis = $10, lese_modell = $11,
              art = $12
        where id = $1`,
      [id, w.betrag, w.datum || null, w.gegenstelle || null, umsortieren ? null : w.kategorie,
       w.belegnummer || null, w.steuersatz, w.notiz || null, w.faellig || null,
       hinweise.join(" ").slice(0, 400) || null, r.modell,
       umsortieren ? erkannt : korb]);

    return { ok: true, werte: { ...w, art: umsortieren ? erkannt : korb }, umsortiert: umsortieren };
  });
};

const BELEG_SPALTEN = `b.id, b.laufnummer, b.dateiname, b.dateityp, b.art, b.status,
              b.betrag, b.datum, b.faellig, b.kategorie, b.gegenstelle, b.steuersatz,
              b.belegnummer, b.notiz, b.fehler_text, b.erstellt, b.groesse,
              b.pruefsumme, b.gelesen, b.lese_hinweis, b.lese_modell, b.buchung_id, b.firma_id,
              b.fuer_position, b.verworfen_am, b.verworfen_grund,
              p.name as wer, (b.daten is not null) as hat_datei,
              bu.bezahlt as buchung_bezahlt, bu.bezahlt_am, bu.faellig as buchung_faellig,
              f.name as firma_name`;

// Was im Eingang liegt — je Art getrennt.
// Verworfene sind draussen: sie bleiben in der Datenbank nachweisbar, haben im
// Arbeitsblick aber nichts zu suchen.
module.exports.belegeOffen = async function (user, art) {
  return alsNutzer(user.id, async (q) => {
    const mitQuelle = await kostenSpaltenDa(q);
    const { rows } = await q(
      `select ${BELEG_SPALTEN}${mitQuelle ? ", b.quelle" : ", null::text as quelle"}
         from belege b
         left join profiles p on p.id = b.von
         left join buchungen bu on bu.id = b.buchung_id
         left join firmen f on f.id = b.firma_id
        where b.status <> 'verworfen' and ($1::text is null or b.art = $1)
        order by (b.status = 'neu') desc, b.erstellt desc limit 40`, [art || null]);
    return rows.map((r) => ({ ...r, betrag: r.betrag === null ? null : Number(r.betrag) }));
  });
};

// Die Belegliste fuer die eigene Seite /buchhaltung/belege — mit Filtern.
//   art     'ausgabe' | 'einnahme' | '' (alle)
//   status  'neu' | 'gebucht' | 'verworfen' | 'fehler' | '' (alle ausser verworfen)
//   monat   'JJJJ-MM' nach Belegdatum (Eingang, wenn kein Datum erkannt)
//   suche   Gegenstelle, Notiz, Belegnummer, Dateiname (ilike)
// Alles parametrisiert — nichts aus der Adresszeile landet im SQL-Text.
module.exports.belegeListe = async function (user, { art = "", status = "", monat = "", suche = "", limit = 200 } = {}) {
  const w = [], a = [];
  if (art === "ausgabe" || art === "einnahme") { a.push(art); w.push(`b.art = $${a.length}`); }
  if (["neu", "gebucht", "verworfen", "fehler"].includes(status)) { a.push(status); w.push(`b.status = $${a.length}`); }
  else w.push(`b.status <> 'verworfen'`);
  if (/^\d{4}-\d{2}$/.test(monat)) {
    a.push(monat + "-01");
    w.push(`date_trunc('month', coalesce(b.datum, b.erstellt::date)) = $${a.length}::date`);
  }
  const s = feldText(suche).slice(0, 80);
  if (s) {
    a.push(`%${s}%`);
    w.push(`(b.gegenstelle ilike $${a.length} or b.notiz ilike $${a.length} or b.belegnummer ilike $${a.length}
             or b.dateiname ilike $${a.length} or f.name ilike $${a.length})`);
  }
  a.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  return alsNutzer(user.id, async (q) => {
    const mitQuelle = await kostenSpaltenDa(q);
    const { rows } = await q(
      `select ${BELEG_SPALTEN}${mitQuelle ? ", b.quelle" : ", null::text as quelle"}
         from belege b
         left join profiles p on p.id = b.von
         left join buchungen bu on bu.id = b.buchung_id
         left join firmen f on f.id = b.firma_id
        where ${w.join(" and ")}
        order by (b.status = 'neu') desc, coalesce(b.datum, b.erstellt::date) desc, b.laufnummer desc
        limit $${a.length}`, a);
    return rows.map((r) => ({ ...r, betrag: r.betrag === null ? null : Number(r.betrag) }));
  });
};

// Ein einzelner Beleg fuer das Pruef-Blatt.
module.exports.belegEinzeln = async function (user, id) {
  if (!/^\d+$/.test(String(id || ""))) return null;
  return alsNutzer(user.id, async (q) => {
    const mitQuelle = await kostenSpaltenDa(q);
    const { rows } = await q(
      `select ${BELEG_SPALTEN}${mitQuelle ? ", b.quelle" : ", null::text as quelle"}
         from belege b
         left join profiles p on p.id = b.von
         left join buchungen bu on bu.id = b.buchung_id
         left join firmen f on f.id = b.firma_id
        where b.id = $1`, [id]);
    const r = rows[0];
    return r ? { ...r, betrag: r.betrag === null ? null : Number(r.betrag) } : null;
  });
};

// Zaehler fuer den Kopf der Belege-Seite: je Status und je Quelle, plus die
// Monate, in denen Belege liegen (fuer den Monatsfilter).
module.exports.belegZaehler = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const mitQuelle = await kostenSpaltenDa(q);
    const { rows: st } = await q(
      `select art, status, count(*)::int as n from belege group by 1, 2`);
    const { rows: qu } = mitQuelle
      ? await q(`select coalesce(quelle, 'unbekannt') as quelle, count(*)::int as n
                   from belege where status <> 'verworfen' group by 1 order by 2 desc`)
      : { rows: [] };
    const { rows: monate } = await q(
      `select to_char(date_trunc('month', coalesce(datum, erstellt::date)), 'YYYY-MM') as monat, count(*)::int as n
         from belege where status <> 'verworfen' group by 1 order by 1 desc limit 36`);
    const status = { neu: 0, gebucht: 0, verworfen: 0, fehler: 0 };
    const jeArt = { ausgabe: { neu: 0, gebucht: 0 }, einnahme: { neu: 0, gebucht: 0 } };
    for (const r of st) {
      status[r.status] = (status[r.status] || 0) + r.n;
      const art = r.art === "einnahme" ? "einnahme" : "ausgabe";
      if (r.status in jeArt[art]) jeArt[art][r.status] += r.n;
    }
    return { status, jeArt, quellen: qu, monate };
  });
};

module.exports.belegDatei = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(`select dateiname, dateityp, daten from belege where id = $1`, [id]);
    return rows[0] || null;
  });
};

// Werte am Beleg festhalten, ohne zu buchen (Zwischenstand beim Pruefen).
// d.art darf die Richtung umstellen — nur solange der Beleg noch nicht
// gebucht ist; danach haengt eine Buchung daran, und die muesste erst weg.
module.exports.belegWerte = async function (user, id, d) {
  const neueArt = d.art === "einnahme" || d.art === "ausgabe" ? d.art : null;
  return alsNutzer(user.id, async (q) => {
    await q(
      // faellig gehoert mit dazu: das Zahlungsziel wird in der Pruefmaske
      // eingetragen und von belegBuchen wieder aus der Zeile gelesen. Fehlte es
      // hier, waere jede Eingabe im Feld "Zahlungsziel" stillschweigend weg.
      // firma_id ist der harte Draht zur Kundenakte. Ist er gesetzt, gilt der
      // Name der Firma und nicht der eingetippte Text — sonst haette man zwei
      // Wahrheiten, sobald ein Kunde umbenannt wird.
      `update belege set betrag = $2, datum = $3, kategorie = $4,
              gegenstelle = coalesce((select name from firmen where id = $10::int), $5),
              steuersatz = $6, belegnummer = $7, notiz = $8, faellig = $9,
              firma_id = $10::int, fuer_position = $11,
              art = case when $12::text is not null and status = 'neu' then $12::text else art end
        where id = $1`,
      [id, zuBetrag(d.betrag), istTag(d.datum) ? d.datum : null, feldText(d.kategorie) || null,
       feldText(d.gegenstelle) || null,
       d.steuersatz === undefined || d.steuersatz === "" ? null : Number(d.steuersatz),
       feldText(d.belegnummer) || null, feldText(d.notiz) || null,
       istTag(d.faellig) ? d.faellig : null,
       /^\d+$/.test(String(d.firma_id || "")) ? Number(d.firma_id) : null,
       // Wofuer die Rechnung steht. Daran haengt, gegen welchen Stand in der
       // Kundenakte sie verrechnet wird (Migration 0045) — ohne das zaehlte
       // eine hochgeladene Monatsrechnung neben dem Zaehler doppelt.
       ["setup", "monatlich"].includes(d.fuer_position) ? d.fuer_position : null,
       neueArt]);
    return { ok: true };
  });
};

// Bestaetigen: aus dem geprueften Beleg wird eine Buchung. Die Datei bleibt
// liegen, wo sie ist — bei uns.
//
// Der Unterschied zwischen den beiden Richtungen ist der ganze Grund, warum es
// "Offene Rechnungen" gibt:
//
//   AUSGABE   ist in der Regel mit dem Beleg bezahlt. Der Bon IST der
//             Zahlungsnachweis. Zahltag = Belegdatum, zaehlt sofort.
//             AUSNAHME (seit 05.09.): opt.offen = true — eine Eingangs-
//             rechnung mit Zahlungsziel. Dann bleibt sie offen, mit
//             faellig aus der Pruefmaske, und steht im Kosten-Dashboard
//             unter "Noch zu zahlen".
//
//   EINNAHME  ist noch kein Geld. Wir laden die Rechnung hoch, sobald sie beim
//             Kunden ist — ob er zahlt, wissen wir da noch nicht. Sie steht
//             unter "Offene Rechnungen", zaehlt NICHT bei den Einnahmen und hat
//             keinen Zahltag. Erst der Haken dort setzt ihn.
//
// Daran haengt auch der Monatsordner: ohne Zahltag ist eine Rechnung in keinem
// Ordner. Eine nie bezahlte Rechnung landet also nie bei der Steuerberaterin —
// genau richtig, denn Geld ist nie geflossen.
// bezahltAm (optional, JJJJ-MM-TT): Bei einer Kundenrechnung, die schon bezahlt
// ist, kann der Zahltag gleich mitgegeben werden. Dann geht sie nicht den Umweg
// ueber "Offene Rechnungen", sondern zaehlt sofort im Monat der Zahlung.
// Genau das braucht man beim Nachtragen: eine Rechnung von Mai, die der Kunde im
// Juni bezahlt hat, gehoert in den Juni-Ordner — nicht in den Monat, in dem man
// sie zufaellig eintippt. Bei einer Ausgabe ueberschreibt bezahltAm den
// Zahltag ebenso (Rechnung vom 28., ueberwiesen am 3.).
// opt.intervall macht die entstehende Buchung zur Fixkosten-Vorlage.
module.exports.belegBuchen = async function (user, id, bezahltAm = null, opt = {}) {
  const zahltag = istTag(bezahltAm) ? bezahltAm : null;
  const intervall = INTERVALLE.includes(opt.intervall) ? opt.intervall : null;
  return alsNutzer(user.id, async (q) => {
    const { rows: [b] } = await q(
      `select id, art, status, betrag, datum, faellig, kategorie, gegenstelle, notiz, firma_id, fuer_position
         from belege where id = $1`, [id]);
    if (!b) return { ok: false, grund: "nicht-gefunden" };
    if (b.status === "gebucht") return { ok: false, grund: "schon-gebucht" };
    if (b.status === "verworfen") return { ok: false, grund: "verworfen" };
    const betrag = Number(b.betrag);
    if (!Number.isFinite(betrag) || betrag <= 0) return { ok: false, grund: "betrag" };
    if (!b.datum) return { ok: false, grund: "datum" };

    const einnahme = b.art === "einnahme";
    // Einnahme: nur bezahlt, wenn ein Zahltag mitgegeben wurde.
    // Ausgabe: bezahlt, ausser sie wurde ausdruecklich als offen gebucht.
    const bezahlt = einnahme ? Boolean(zahltag) : !opt.offen;
    const amTag = !bezahlt ? null : (zahltag || tagText(b.datum));
    const mitKosten = await kostenSpaltenDa(q);

    const spalten = ["art", "datum", "betrag", "kategorie", "gegenstelle", "notiz",
      "bezahlt", "bezahlt_am", "faellig", "erfasst_von", "firma_id", "fuer_position", "wiederkehrend"];
    const werte = [einnahme ? "einnahme" : "ausgabe", b.datum, betrag,
      b.kategorie || null, b.gegenstelle || null, b.notiz || null,
      bezahlt, amTag,
      // Ein Zahlungsziel merken wir uns nur, solange noch nichts bezahlt ist.
      !bezahlt ? (b.faellig || null) : null, user.id, b.firma_id || null, b.fuer_position || null,
      Boolean(intervall)];
    if (mitKosten) {
      spalten.push("intervall", "naechste_faelligkeit");
      werte.push(intervall, intervall ? naechsteFaelligkeit(b.datum, intervall) : null);
    }
    const { rows: [bu] } = await q(
      // firma_id wandert vom Beleg in die Buchung. Daran haengt beides: die
      // Rechnung erscheint in der Kundenakte, und die Kundenakte weiss, was
      // offen ist.
      `insert into buchungen (${spalten.join(", ")})
       values (${spalten.map((_, i) => "$" + (i + 1)).join(",")}) returning id`, werte);

    await q(
      `update belege set status = 'gebucht', buchung_id = $2, fehler_text = null
        where id = $1`, [id, bu.id]);
    return { ok: true, buchung: bu.id, offeneRechnung: !bezahlt, bezahltAm: amTag, art: b.art };
  });
};

// Verwerfen statt Loeschen.
//
// Ein Fehlscan oder ein versehentlich hochgeladenes Privatfoto darf raus aus den
// Buechern, aber nicht aus der Ablage: Loeschen wuerde eine Luecke in der
// Laufnummer hinterlassen, und eine Luecke muss man erklaeren koennen. Also
// bleibt der Beleg mit Grund und Zeitstempel stehen und zaehlt nirgends mehr
// mit. Der Trigger aus 0024 laesst echtes Loeschen ohnehin nicht zu.
module.exports.belegVerwerfen = async function (user, id, grund) {
  const text = String(grund || "").trim();
  if (text.length < 3) return { ok: false, grund: "kein-grund" };
  return alsNutzer(user.id, async (q) => {
    const { rows: [b] } = await q(`select status, buchung_id from belege where id = $1`, [id]);
    if (!b) return { ok: false, grund: "nicht-gefunden" };
    // Ein gebuchter Beleg wird nicht verworfen — dann muesste erst die Buchung
    // weg, und das ist eine eigene, bewusste Handlung.
    if (b.status === "gebucht") return { ok: false, grund: "schon-gebucht" };
    await q(
      `update belege set status = 'verworfen', verworfen_am = now(),
              verworfen_von = $2, verworfen_grund = $3
        where id = $1`, [id, user.id, text.slice(0, 300)]);
    return { ok: true };
  });
};

// ------------------------------------------------------------- Monatsordner
//
// Das, was die Steuerberaterin bekommt. Ein Monat, ein ZIP:
//
//   Bitte-lesen.txt    drei Zeilen: erst entpacken, dann klicken (seit 06.09.)
//   Uebersicht.csv     alle Bewegungen als Tabelle, in Excel direkt lesbar
//   Uebersicht.html    dasselbe zum Anschauen und Ausdrucken (Druck -> PDF)
//   Buchhaltung.xlsx   dieselbe Tabelle als Excel mit echten Zahlen (seit 05.09.),
//                      Spalte "Datei" verknuepft auf Belege/… (seit 06.09.)
//   Pruefsummen.txt    SHA-256 je Datei, damit belegbar ist, was drin war
//   Belege/...         die Dateien selbst: Eingangsbelege nach Laufnummer und
//                      Datum ("0042_2026-08-01_…"), die eigenen Ausgangs-
//                      rechnungen mit "R_" voran ("R_RE-2026-0007_…", 06.09.)
//
// Massgeblich ist bezahlt_am, nicht datum: eine Rechnung gehoert in den Monat,
// in dem das Geld geflossen ist. Offene Rechnungen sind darum nicht dabei — sie
// erscheinen erst in dem Monat, in dem sie bezahlt werden.

// Der Zettel obenauf (06.09.2026). Eine Verknuepfung in der Excel zeigt
// relativ auf "Belege/…" — sie funktioniert also erst, wenn das ZIP entpackt
// ist. Klickt jemand in der Vorschau eines noch gepackten Archivs, passiert
// nichts, und die schoenste Verknuepfung waere nutzlos, weil niemand weiss,
// warum. Deshalb drei Zeilen in der Wurzel, wo sie beim Oeffnen als Erstes
// stehen (Bindestrich voran sortiert sie in den meisten Dateimanagern nach
// oben) — derselbe Satz steht auch ueber der Tabelle im Blatt "Übersicht".
const BITTE_LESEN = [
  "Die Spalte „Datei“ in der Excel-Tabelle ist verknüpft.",
  "Bitte dieses ZIP zuerst in einen Ordner entpacken.",
  "Danach öffnet ein Klick in der Spalte den zugehörigen Beleg aus dem Ordner „Belege“.",
  "",
].join("\r\n");

// Welche Monate ueberhaupt etwas enthalten — fuer die Auswahl auf der Seite.
// ohne_beleg: Bewegungen ohne Belegdatei — die Kanzlei fragt genau danach.
module.exports.monateMitDaten = async function (user) {
  return alsNutzer(user.id, async (q) => {
    // Eine Zeile gilt als belegt, wenn ein Eingangsbeleg mit Datei daranhaengt
    // ODER — seit 06.09.2026 — wenn es die eigene Ausgangsrechnung als PDF
    // gibt. Die Rechnungsnummer steckt in quelle_schluessel
    // ('rechnung-<id>-<zahlung>'); das CASE stellt sicher, dass der Cast nach
    // bigint nur fuer Schluessel laeuft, die auch so aussehen — ohne das
    // koennte Postgres die Bedingungen umsortieren und an einem fremden
    // Schluessel abbrechen.
    const eigene = (await rechnungenTabelleDa(q))
      ? `and not exists (select 1 from rechnungen r
                          where r.id = (case when bu.quelle = 'rechnung'
                                              and bu.quelle_schluessel ~ '^rechnung-[0-9]+-[0-9]+$'
                                         then split_part(bu.quelle_schluessel, '-', 2)::bigint end)
                            and r.pdf is not null)`
      : "";
    const { rows } = await q(
      `select extract(year from bu.bezahlt_am)::int as jahr,
              extract(month from bu.bezahlt_am)::int as monat,
              count(*)::int as anzahl,
              coalesce(sum(bu.betrag) filter (where bu.art = 'einnahme'), 0)::numeric as ein,
              coalesce(sum(bu.betrag) filter (where bu.art = 'ausgabe'), 0)::numeric as aus,
              count(*) filter (where not exists
                (select 1 from belege b where b.buchung_id = bu.id and b.status = 'gebucht' and b.daten is not null)
                ${eigene})::int as ohne_beleg
         from buchungen bu where bu.bezahlt_am is not null and bu.bezahlt
        group by 1, 2 order by 1 desc, 2 desc limit 36`);
    return rows.map((r) => ({ ...r, ein: Number(r.ein), aus: Number(r.aus) }));
  });
};

// Monate samt Status fuer die Seite /buchhaltung/monate.
module.exports.monateUebersicht = async function (user) {
  const [monate, exporte] = await Promise.all([
    module.exports.monateMitDaten(user),
    module.exports.exportVerlauf(user, 400),
  ]);
  return monate.map((m) => ({ ...m, ...monatsStatus(m, exporte) }));
};

// Alles, was in einen Monatsordner gehoert.
module.exports.monatsDaten = async function (user, jahr, monat) {
  const j = Number(jahr), m = Number(monat);
  if (!Number.isInteger(j) || j < 2000 || j > 2100) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  const d = await alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select bu.id as buchung_id, bu.art, bu.datum, bu.bezahlt_am, bu.betrag,
              bu.kategorie, bu.gegenstelle, bu.notiz, bu.quelle, bu.quelle_schluessel,
              b.id as beleg_id, b.laufnummer, b.dateiname, b.dateityp,
              b.pruefsumme, b.groesse, b.belegnummer, b.steuersatz,
              (b.daten is not null) as hat_datei,
              f.name as firma_name, p.name as erfasst
         from buchungen bu
         left join belege b on b.buchung_id = bu.id and b.status = 'gebucht'
         left join firmen f on f.id = bu.firma_id
         left join profiles p on p.id = bu.erfasst_von
        where bu.bezahlt
          and extract(year from bu.bezahlt_am) = $1
          and extract(month from bu.bezahlt_am) = $2
        order by bu.bezahlt_am, bu.id`, [j, m]);
    const zeilen = rows.map((r) => ({
      ...r, betrag: Number(r.betrag), rechnung_id: rechnungAus(r.quelle, r.quelle_schluessel),
    }));
    return {
      jahr: j, monat: m, zeilen,
      summe_ein: zeilen.filter((z) => z.art === "einnahme").reduce((a, z) => a + z.betrag, 0),
      summe_aus: zeilen.filter((z) => z.art === "ausgabe").reduce((a, z) => a + z.betrag, 0),
      mitBeleg: 0, ohneBeleg: 0,
    };
  });
  if (!d) return null;
  // Die eigenen Ausgangsrechnungen dazu (06.09.2026, siehe
  // rechnungenAnhaengen). Erst NACH der Transaktion oben: rechnungen.js
  // oeffnet seine eigene, und zwei ineinander braucht niemand.
  await rechnungenAnhaengen(user, d);
  d.mitBeleg = d.zeilen.filter((z) => dateiImArchiv(z)).length;
  d.ohneBeleg = d.zeilen.length - d.mitBeleg;
  return d;
};

// Aus quelle/quelle_schluessel die Nummer der eigenen Ausgangsrechnung:
// rechnungen.js schreibt beim Verbuchen einer Zahlung quelle='rechnung' und
// quelle_schluessel='rechnung-<id>-<laufende Zahlung>' (0060).
function rechnungAus(quelle, schluessel) {
  if (quelle !== "rechnung") return null;
  const p = /^rechnung-(\d+)-\d+$/.exec(String(schluessel || ""));
  return p ? Number(p[1]) : null;
}

// Die eigenen Ausgangsrechnungen zu den Einnahmen eines Monats.
//
// WARUM (Lukas, 06.09.2026): "Wichtig ist, dass die Kanzlei die Rechnung
// gleich sehen und öffnen kann." Bis hierhin packte der Monatsordner nur die
// EINGANGSbelege. Die eigenen Rechnungen standen mit "keine Datei" in der
// Liste — obwohl das PDF in rechnungen.pdf liegt und die Einnahme genau
// daraus stammt. Fuer die Kanzlei ist die Ausgangsrechnung derselbe Beleg wie
// die Tankquittung; ohne sie ist die Einnahme unbelegt.
//
// Das Modul wird ERST BEIM AUFRUF geladen und jeder Fehler abgefangen: Ohne
// Rechnungsmodul (oder ohne Migration 0060) gibt es weiter einen
// Monatsordner, nur eben ohne diese PDFs.
//
// EINE Datei je Rechnung, auch bei mehreren Teilzahlungen im selben Monat:
// Beide Zeilen zeigen dann auf denselben Namen. Zwei gleiche Namen im ZIP
// wuerde archiv.zip zu "… (2).pdf" durchzaehlen — und die Verknuepfung in der
// Excel zeigte ins Leere. Genau der Fehler, bei dem Excel "Reparieren?" fragt.
async function rechnungenAnhaengen(user, d) {
  const ids = [...new Set(d.zeilen.map((z) => z.rechnung_id).filter(Boolean))];
  if (!ids.length) return;
  let rech;
  try { rech = require("./rechnungen.js"); } catch { return; }
  if (!rech || typeof rech.eine !== "function") return;
  const bekannt = new Map();
  for (const id of ids) {
    try {
      const r = await rech.eine(user, id);
      // Nur gestellte Rechnungen: ein Entwurf hat kein eingefrorenes PDF, und
      // ein frisch gebautes waere nicht das, was der Kunde bekommen hat.
      if (r && r.pdf_da && r.status !== "entwurf") {
        bekannt.set(id, { name: rechnungsName(r), pruefsumme: r.pdf_pruefsumme || "" });
      }
    } catch (e) { console.error("Rechnungs-PDF zum Monat:", String(e.message).slice(0, 120)); }
  }
  for (const z of d.zeilen) {
    const t = z.rechnung_id ? bekannt.get(z.rechnung_id) : null;
    if (!t) continue;
    z.rechnung_datei = t.name;
    z.rechnung_pruefsumme = t.pruefsumme;
  }
}

// Dateiname der Ausgangsrechnung im Archiv: "R_" voran, damit die eigenen
// Rechnungen im Ordner "Belege" beisammenstehen und sich von den
// durchnummerierten Eingangsbelegen ("0042 …") auf den ersten Blick
// unterscheiden. Danach Nummer, Datum, Kunde — so, wie die Kanzlei sucht.
function rechnungsName(r) {
  const kunde = String((r.empfaenger && r.empfaenger.name) || r.firma_name || "Kunde")
    .replace(/[^A-Za-z0-9ÄÖÜäöüß -]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "Kunde";
  return archiv.dateinameSicher(`R_${r.nummer || r.id}_${tagText(r.datum)}_${kunde}.pdf`);
}

// Offene Posten zum Stichtag (letzter Tag des Monats): alles, was bis dahin
// erfasst, aber am Stichtag noch nicht bezahlt war — auch wenn es inzwischen
// bezahlt ist. So stimmt das Blatt "Offen" auch fuer einen Monat, den man
// erst im Nachhinein abschliesst.
module.exports.offeneZumStichtag = async function (user, jahr, monat) {
  const j = Number(jahr), m = Number(monat);
  if (!Number.isInteger(j) || !Number.isInteger(m) || m < 1 || m > 12) return [];
  const stichtag = `${j}-${String(m).padStart(2, "0")}-${new Date(j, m, 0).getDate()}`;
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select bu.*, f.name as firma_name, ($1::date - bu.faellig) as tage_ueber
         from buchungen bu left join firmen f on f.id = bu.firma_id
        where bu.datum <= $1::date
          and (bu.bezahlt = false or bu.bezahlt_am > $1::date)
        order by bu.art, bu.faellig nulls last, bu.datum`, [stichtag]);
    return rows.map((r) => ({ ...r, betrag: Number(r.betrag), stichtag }));
  });
};

// Datum zweistellig: "09.07.2026", nicht "9.7.2026". So sieht es auf jedem
// Steuerbeleg aus und sortiert in Excel nicht durcheinander.
const tag = (v) => (v
  ? new Date(v).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
  : "");

// Dateiname im Archiv: Laufnummer voran, damit die Sortierung im Ordner der
// Reihenfolge in der Tabelle entspricht und jede Zeile eindeutig zu ihrer Datei
// fuehrt. Die Steuerberaterin liest "Beleg-Nr 0042" in der Tabelle und findet
// "0042 ..." im Ordner. Datum JJJJ-MM-TT (tagText: lokale Bestandteile, keine
// UTC-Drehung), damit der Ordner chronologisch sortiert.
function archivName(z) {
  const nr = String(z.laufnummer || z.beleg_id).padStart(4, "0");
  return archiv.dateinameSicher(`${nr}_${tagText(z.bezahlt_am)}_${z.dateiname}`);
}

// Der Name, unter dem die Datei zu DIESER Zeile im Ordner "Belege" liegt:
// Eingangsbeleg oder eigene Ausgangsrechnung. "" heisst, dass es zu der Zeile
// nichts gibt. Eine Definition fuer CSV, HTML, Excel und das Packen — damit
// die Verknuepfung in der Tabelle und der Name im Ordner nicht auseinander-
// laufen koennen. Genau daran haengt, ob der Klick der Kanzlei etwas oeffnet.
function dateiImArchiv(z) {
  if (z.hat_datei) return archivName(z);
  return z.rechnung_datei || "";
}

// Die Spalten der Uebersicht. Eine Definition fuer CSV und HTML, damit die
// Tabelle im ZIP und die Ansicht im Browser nie auseinanderlaufen.
function spaltenFuer() {
  const geld = archiv.betragDe;
  return [
    { titel: "Beleg-Nr", wert: (z) => z.laufnummer || "" },
    { titel: "Zahltag", wert: (z) => tag(z.bezahlt_am) },
    { titel: "Belegdatum", wert: (z) => tag(z.datum) },
    { titel: "Richtung", wert: (z) => (z.art === "einnahme" ? "Einnahme" : "Ausgabe") },
    { titel: "Betrag EUR", wert: (z) => geld(z.betrag), zahl: true },
    // -1 steht fuer "der Beleg trug mehrere Saetze" (siehe buchhaltung-routes.js).
    // In der Aufstellung fuer die Steuerberaterin muss das als Wort dastehen —
    // eine "-1,00" in der USt-Spalte waere schlicht falsch.
    { titel: "USt %", wert: (z) => (z.steuersatz === null || z.steuersatz === undefined ? ""
      : Number(z.steuersatz) === -1 ? "gemischt" : geld(z.steuersatz)), zahl: true },
    { titel: "Kunde / Lieferant", wert: (z) => z.gegenstelle || z.firma_name || "" },
    { titel: "Kategorie", wert: (z) => z.kategorie || "" },
    { titel: "Beschreibung", wert: (z) => z.notiz || "" },
    { titel: "Belegnummer", wert: (z) => z.belegnummer || "" },
    { titel: "Datei", wert: (z) => dateiImArchiv(z) || "keine Datei" },
  ];
}

// Die Uebersicht als eigenstaendige HTML-Seite. Landet so im ZIP und wird
// gleichzeitig unter /buchhaltung/monat/.../ansehen ausgeliefert.
// Bewusst ohne PDF-Erzeugung: die Seite ist auf Druck ausgelegt, "Drucken ->
// Als PDF speichern" macht daraus in einem Klick ein PDF. Ein Browser im Server
// nur fuers Papierformat waere Aufwand ohne Gegenwert.
module.exports.monatsVorschau = function (user, d) {
  const geld = archiv.betragDe;
  const titel = `${MONATSNAME[d.monat - 1]} ${d.jahr}`;
  const spalten = spaltenFuer();
  const ergebnis = d.summe_ein - d.summe_aus;
  const sicher = (v) => String(v ?? "").replace(/[&<>]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Buchhaltung ${titel} — Sehorz &amp; vom Hofe GbR</title>
<style>
  body{font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1e;margin:32px;max-width:1100px}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#6b6b70;margin-bottom:24px}
  .summe{display:flex;gap:28px;flex-wrap:wrap;margin:0 0 24px;padding:16px 20px;background:#f5f5f7;border-radius:10px}
  .summe div{min-width:120px} .summe b{display:block;font-size:19px;margin-top:2px}
  .tabelle{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #e5e5ea;vertical-align:top}
  th{background:#fafafa;font-weight:600;white-space:nowrap}
  td.z,th.z{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .ein{color:#146c43} .aus{color:#a4243d}
  footer{margin-top:28px;color:#6b6b70;font-size:12px;line-height:1.7}
  @media print{body{margin:12mm}.summe{background:none;border:1px solid #ccc}}
</style></head><body>
<h1>Buchhaltung ${titel}</h1>
<div class="sub">Sehorz &amp; vom Hofe GbR · Kleinunternehmer nach §19 UStG ·
  erstellt am ${new Date().toLocaleDateString("de-DE")}</div>
<div class="summe">
  <div>Einnahmen<b class="ein">${geld(d.summe_ein)} €</b></div>
  <div>Ausgaben<b class="aus">${geld(d.summe_aus)} €</b></div>
  <div>Ergebnis<b>${geld(ergebnis)} €</b></div>
  <div>Bewegungen<b>${d.zeilen.length}</b></div>
  <div>mit Beleg<b>${d.mitBeleg}${d.ohneBeleg
    ? ` <span style="font-size:13px;color:#a4243d">(${d.ohneBeleg} ohne)</span>` : ""}</b></div>
</div>
<div class="tabelle"><table><thead><tr>${spalten.map((s) =>
  `<th${s.zahl ? ' class="z"' : ""}>${s.titel}</th>`).join("")}</tr></thead>
<tbody>${d.zeilen.map((z) => `<tr>${spalten.map((s) => {
    const farbe = s.titel === "Betrag EUR" ? (z.art === "einnahme" ? " ein" : " aus") : "";
    return `<td class="${s.zahl ? "z" : ""}${farbe}">${sicher(s.wert(z))}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>
<footer>
  Die Belegdateien liegen im ZIP im Unterordner <b>Belege</b>, benannt nach der
  Beleg-Nr. aus der ersten Spalte.<br>
  Maßgeblich für die Zuordnung zum Monat ist der <b>Zahltag</b> (Zufluss-Prinzip),
  nicht das Belegdatum. Unbezahlte Rechnungen sind darum nicht enthalten.<br>
  <b>Pruefsummen.txt</b> enthält je Datei einen SHA-256-Wert. Damit ist
  nachweisbar, dass die Dateien seit dem Eingang unverändert sind.
</footer></body></html>`;
};

// Eine Protokollzeile in monats_exporte. Drei Arten: ZIP (Standard), Excel
// (excel_geholt_am), Kanzlei (an_kanzlei_am). Vor Migration 0061 gibt es die
// beiden Spalten nicht — dann wird die Zeile ohne sie geschrieben, das
// Protokoll bleibt vollstaendig, nur die Art fehlt.
async function exportVermerken(q, d, user, { excel = false, kanzlei = false } = {}) {
  const exportSumme = archiv.exportPruefsumme(d.zeilen.filter((z) => z.laufnummer));
  const mit = await kostenSpaltenDa(q);
  const spalten = ["jahr", "monat", "anzahl", "summe_ein", "summe_aus", "laufnummern", "pruefsumme", "von"];
  const werte = [d.jahr, d.monat, d.zeilen.length, d.summe_ein, d.summe_aus,
    d.zeilen.map((z) => z.laufnummer).filter(Boolean), exportSumme, user.id];
  if (mit && excel) { spalten.push("excel_geholt_am"); werte.push(new Date()); }
  if (mit && kanzlei) { spalten.push("an_kanzlei_am"); werte.push(new Date()); }
  await q(`insert into monats_exporte (${spalten.join(", ")})
           values (${spalten.map((_, i) => "$" + (i + 1)).join(",")})`, werte);
  return exportSumme;
}

// Das ZIP bauen und den Export protokollieren.
module.exports.monatsExport = async function (user, jahr, monat) {
  const d = await module.exports.monatsDaten(user, jahr, monat);
  if (!d) return { ok: false, grund: "zeitraum" };
  if (!d.zeilen.length) return { ok: false, grund: "leer" };

  const monatKurz = `${d.jahr}-${String(d.monat).padStart(2, "0")}`;
  const titel = `${MONATSNAME[d.monat - 1]} ${d.jahr}`;
  const csv = archiv.csv(d.zeilen, spaltenFuer());
  const html = module.exports.monatsVorschau(user, d);

  // Die Dateien fuer den Ordner "Belege". EIN Eintrag je Name — dieselbe
  // Ausgangsrechnung kann zu zwei Teilzahlungen im selben Monat gehoeren, und
  // zwei gleiche Namen wuerde archiv.zip zu "… (2).pdf" durchzaehlen. Dann
  // zeigte die Verknuepfung in der Excel auf einen Namen, den es im ZIP nicht
  // gibt — und Excel fragt beim Oeffnen "Reparieren?".
  const dateien = new Map();   // Name -> { daten, pruefsumme }
  await alsNutzer(user.id, async (q) => {
    // Dateien einzeln holen statt alle in einer Abfrage: ein Monat kann
    // hundert Fotos haben, und die muessen nicht alle gleichzeitig als eine
    // Ergebnismenge im Speicher liegen.
    for (const z of d.zeilen) {
      if (!z.hat_datei || !z.beleg_id) continue;
      const { rows: [datei] } = await q(`select daten from belege where id = $1`, [z.beleg_id]);
      if (datei && datei.daten) dateien.set(archivName(z), { daten: datei.daten, pruefsumme: z.pruefsumme || "" });
    }
  });
  // Die eigenen Ausgangsrechnungen (06.09.2026). Die Namen stehen schon in
  // den Zeilen (monatsDaten -> rechnungenAnhaengen); hier kommen nur noch die
  // Bytes dazu. Faellt eine aus, verschwindet auch ihr Name aus der Zeile —
  // lieber "keine Datei" in der Tabelle als ein Klick, der ins Leere geht.
  for (const { z, daten } of await rechnungsPdfs(user, d)) {
    if (daten) dateien.set(z.rechnung_datei, { daten, pruefsumme: z.rechnung_pruefsumme || "" });
  }
  for (const z of d.zeilen) {
    if (z.rechnung_datei && !dateien.has(z.rechnung_datei)) { delete z.rechnung_datei; delete z.rechnung_pruefsumme; }
  }
  d.mitBeleg = d.zeilen.filter((z) => dateiImArchiv(z)).length;
  d.ohneBeleg = d.zeilen.length - d.mitBeleg;

  const pruefliste = [
    `Prüfsummen (SHA-256) — Buchhaltung ${titel}`,
    `Sehorz & vom Hofe GbR, erstellt am ${new Date().toLocaleString("de-DE")}`,
    "",
    ...[...dateien.entries()].map(([name, f]) => `${f.pruefsumme || "(keine)"}  Belege/${name}`),
    "",
    `Export-Prüfsumme: ${archiv.exportPruefsumme(d.zeilen.filter((z) => z.laufnummer))}`,
  ].join("\n");

  // Das Excel liegt seit 05.09. mit im ZIP: Die Kanzlei bekommt damit im
  // Paket dieselbe Tabelle einmal fuer Menschen (HTML), einmal fuer Excel.
  // Seit 06.09. ist die Spalte "Datei" darin verknuepft — relativ auf
  // Belege/…, also genau auf das, was neben der Datei im entpackten Ordner
  // liegt. Scheitert der Excel-Bau, geht das ZIP trotzdem raus — ohne das
  // Blatt, mit Meldung im Protokoll.
  let excel = null;
  try { excel = module.exports.monatsExcelBauen(d, []); } catch (e) { console.error("Excel im ZIP:", e.message); }

  const zip = archiv.zip([
    { name: "Bitte-lesen.txt", daten: BITTE_LESEN },
    { name: "Uebersicht.csv", daten: csv },
    { name: "Uebersicht.html", daten: html },
    ...(excel ? [{ name: `Buchhaltung ${monatKurz}.xlsx`, daten: excel }] : []),
    { name: "Pruefsummen.txt", daten: pruefliste },
    ...[...dateien.entries()].map(([name, f]) => ({ name: `Belege/${name}`, daten: f.daten })),
  ]);

  await alsNutzer(user.id, (q) => exportVermerken(q, d, user));

  return {
    ok: true, zip, titel,
    dateiname: `Buchhaltung ${monatKurz} Sehorz-vom-Hofe.zip`,
    anzahl: d.zeilen.length, dateien: dateien.size, ohneBeleg: d.ohneBeleg,
  };
};

// Die PDF-Bytes der eigenen Ausgangsrechnungen. Getrennt von
// rechnungenAnhaengen(), weil nur das ZIP sie braucht — die Excel und die
// HTML-Ansicht kommen mit dem Namen aus, und ein PDF je Rechnung im Speicher
// zu halten, nur um eine Tabelle zu bauen, waere Verschwendung.
async function rechnungsPdfs(user, d) {
  const gebraucht = new Map();   // rechnung_id -> Zeile
  for (const z of d.zeilen) if (z.rechnung_id && z.rechnung_datei && !gebraucht.has(z.rechnung_id)) gebraucht.set(z.rechnung_id, z);
  if (!gebraucht.size) return [];
  let rech;
  try { rech = require("./rechnungen.js"); } catch { return []; }
  if (!rech || typeof rech.pdfHolen !== "function") return [];
  const raus = [];
  for (const [id, z] of gebraucht) {
    try {
      const p = await rech.pdfHolen(user, id);
      if (p && p.daten) raus.push({ z, daten: Buffer.isBuffer(p.daten) ? p.daten : Buffer.from(p.daten) });
    } catch (e) { console.error("Rechnungs-PDF ins ZIP:", String(e.message).slice(0, 120)); }
  }
  return raus;
}

// Das Excel fuer den Monat — reine Rechnerei aus den Monatsdaten, ohne
// Datenbank (damit es sich einzeln pruefen laesst). offene: Zeilen aus
// offeneZumStichtag() fuer das zweite Blatt.
//
// DIE VERKNUEPFUNG (Lukas, 06.09.2026): "Wenn wir die Datei an die
// Steuerkanzlei schicken, steht in der Excel-Tabelle nur der Name der
// Rechnung. Ich kann da nicht draufklicken, die PDF öffnet sich nicht."
// Seitdem traegt jede Zeile mit Datei eine echte Verknuepfung auf
// "Belege/<datei>" — RELATIV, nicht absolut. Der Weg ist damit derselbe,
// egal wo die Kanzlei den entpackten Ordner ablegt, er braucht keinen Server
// und ueberlebt jedes Archiv. Voraussetzung ist nur, dass die Excel neben dem
// Ordner "Belege" liegt — genau so kommt sie aus dem ZIP, und genau so legt
// sie sich hin, wenn jemand beides einzeln herunterlaedt.
//
// opt.links: Map buchung_id -> Adresse. Setzt nur monatsExcel() (die
// einzelne Datei) und nur, wenn OS_URL konfiguriert ist. Dann kommt eine
// Spalte "Online" dazu, die ohne Entpacken funktioniert.
module.exports.monatsExcelBauen = function (d, offene = [], opt = {}) {
  const xlsx = require("./xlsx-schreiben.js");
  const titel = `${MONATSNAME[d.monat - 1]} ${d.jahr}`;
  const links = opt.links instanceof Map ? opt.links : null;
  const mitOnline = !!(links && links.size);
  // Der Steuersatz steht als TEXT in der Zelle ("19 %"), nicht als Zahl mit dem
  // Zahlformat 0" %". Grund (06.09.2026): Das Prozentzeichen ist in einem
  // Excel-Format ein Rechenzeichen — es multipliziert mit 100. In
  // Anfuehrungszeichen soll es nur ein Zeichen sein, und Excel haelt sich daran;
  // Apples Betrachter nicht, dort stand "1900 %". In einer Datei, die an die
  // Steuerkanzlei geht, darf so etwas nicht vom Betrachter abhaengen. Gerechnet
  // wird mit der Spalte ohnehin nie — sie ist eine Einordnung, keine Groesse.
  const gemischt = (s) => (s === null || s === undefined ? null
    : Number(s) === -1 ? "gemischt" : `${Number(s)} %`);
  // Die Zelle der Spalte "Datei": mit Datei eine Verknuepfung, ohne Datei das
  // Wort. Ein leeres Ziel darf nie entstehen — xlsx-schreiben traegt dann gar
  // keine Verknuepfung ein, aber sauberer ist es, es hier zu entscheiden.
  const dateiZelle = (z) => {
    const name = dateiImArchiv(z);
    if (!name) return "keine Datei";
    return { wert: name, link: `Belege/${name}`, hinweis: `Öffnet Belege/${name} aus dem entpackten Ordner` };
  };
  const onlineZelle = (z) => {
    const url = links ? links.get(z.buchung_id) : null;
    return url ? { wert: "Rechnung ansehen", link: url, hinweis: url } : null;
  };
  const zeilen = d.zeilen.map((z) => [
    z.laufnummer || null,
    tagText(z.bezahlt_am) || null,
    tagText(z.datum) || null,
    z.art === "einnahme" ? "Einnahme" : "Ausgabe",
    z.betrag,
    gemischt(z.steuersatz),
    z.gegenstelle || z.firma_name || "",
    z.kategorie || "",
    z.notiz || "",
    z.belegnummer || "",
    dateiZelle(z),
    ...(mitOnline ? [onlineZelle(z)] : []),
  ]);
  const uebersicht = {
    name: "Übersicht",
    kopf: [
      [{ wert: `Buchhaltung ${titel}`, stil: "titel" }],
      ["Sehorz & vom Hofe GbR · Kleinunternehmer nach §19 UStG"],
      [`Erstellt am ${new Date().toLocaleDateString("de-DE")} · ${d.zeilen.length} Bewegungen · ${d.mitBeleg} mit Belegdatei${d.ohneBeleg ? `, ${d.ohneBeleg} ohne` : ""}`],
      // Der Satz steht bewusst GANZ OBEN und nicht in einer Fussnote: Wer die
      // Datei aus dem noch gepackten ZIP heraus anklickt, erlebt sonst, dass
      // nichts passiert, und haelt die Verknuepfung fuer kaputt.
      [{ wert: "Die Spalte „Datei“ ist verknüpft — ZIP entpacken, dann öffnet ein Klick den Beleg." }],
      [{ wert: "Maßgeblich für die Zuordnung zum Monat ist der Zahltag (Zufluss-Prinzip), nicht das Belegdatum. Offene Rechnungen stehen auf dem Blatt „Offen“.", stil: "hinweis" }],
      ...(mitOnline ? [[{ wert: "Die Spalte „Online“ öffnet unsere eigenen Ausgangsrechnungen direkt im Browser — dafür muss nichts entpackt sein. Die Links gelten 180 Tage.", stil: "hinweis" }]] : []),
      [],
    ],
    spalten: [
      { titel: "Beleg-Nr", breite: 10, typ: "zahl" },
      { titel: "Zahltag", breite: 12, typ: "datum" },
      { titel: "Belegdatum", breite: 12, typ: "datum" },
      { titel: "Richtung", breite: 10 },
      { titel: "Betrag €", breite: 14, typ: "geld" },
      { titel: "USt %", breite: 9, typ: "prozent" },
      { titel: "Kunde / Lieferant", breite: 28 },
      { titel: "Kategorie", breite: 22 },
      { titel: "Beschreibung", breite: 36 },
      { titel: "Belegnummer", breite: 18 },
      { titel: "Datei", breite: 44 },
      ...(mitOnline ? [{ titel: "Online", breite: 18 }] : []),
    ],
    zeilen,
    summen: [
      ["Einnahmen", null, null, null, { wert: d.summe_ein, typ: "geld", fett: true }],
      ["Ausgaben", null, null, null, { wert: d.summe_aus, typ: "geld", fett: true }],
      ["Ergebnis", null, null, null, { wert: d.summe_ein - d.summe_aus, typ: "geld", fett: true }],
    ],
  };
  const stichtag = offene[0]?.stichtag || `${d.jahr}-${String(d.monat).padStart(2, "0")}-${new Date(d.jahr, d.monat, 0).getDate()}`;
  const offenBlatt = {
    name: "Offen",
    kopf: [
      [{ wert: `Offene Posten zum ${tag(stichtag)}`, stil: "titel" }],
      [{ wert: "Rechnungen, die am Stichtag erfasst, aber noch nicht bezahlt waren — Kundenrechnungen (Einnahme) und Lieferantenrechnungen (Ausgabe). Sie sind nicht Teil des Monatsergebnisses.", stil: "hinweis" }],
      [],
    ],
    spalten: [
      { titel: "Richtung", breite: 10 },
      { titel: "Rechnungsdatum", breite: 14, typ: "datum" },
      { titel: "Fällig", breite: 12, typ: "datum" },
      { titel: "Kunde / Lieferant", breite: 28 },
      { titel: "Betrag €", breite: 14, typ: "geld" },
      { titel: "Kategorie", breite: 22 },
      { titel: "Beschreibung", breite: 36 },
      { titel: "Tage überfällig", breite: 14, typ: "zahl" },
      { titel: "Inzwischen bezahlt am", breite: 20, typ: "datum" },
      { titel: "Quelle", breite: 16 },
    ],
    zeilen: offene.map((o) => [
      o.art === "einnahme" ? "Einnahme" : "Ausgabe",
      tagText(o.datum) || null,
      tagText(o.faellig) || null,
      o.gegenstelle || o.firma_name || "",
      Number(o.betrag) || 0,
      o.kategorie || "",
      o.notiz || "",
      o.tage_ueber !== null && o.tage_ueber !== undefined && Number(o.tage_ueber) > 0 ? Number(o.tage_ueber) : null,
      tagText(o.bezahlt_am) || null,
      o.quelle === "rechnung" ? "Rechnungsmodul" : "Buchhaltung",
    ]),
    summen: offene.length ? [
      ["Offene Einnahmen", null, null, null, { wert: offene.filter((o) => o.art === "einnahme").reduce((a, o) => a + Number(o.betrag || 0), 0), typ: "geld", fett: true }],
      ["Offene Ausgaben", null, null, null, { wert: offene.filter((o) => o.art !== "einnahme").reduce((a, o) => a + Number(o.betrag || 0), 0), typ: "geld", fett: true }],
    ] : [],
    leerText: "Zum Stichtag war nichts offen.",
  };
  return xlsx.bauen({ blaetter: [uebersicht, offenBlatt], autor: "Flowstate OS" });
};

// Das Excel holen und protokollieren (excel_geholt_am).
//
// Wer die Excel EINZELN herunterlaedt, hat den Ordner "Belege" meist auch —
// er laedt beides und legt es nebeneinander. Deshalb steht auch hier dieselbe
// relative Verknuepfung. Zusaetzlich gibt es die Spalte "Online", wenn OS_URL
// gesetzt ist: sie funktioniert ohne jedes Entpacken.
module.exports.monatsExcel = async function (user, jahr, monat) {
  const d = await module.exports.monatsDaten(user, jahr, monat);
  if (!d) return { ok: false, grund: "zeitraum" };
  if (!d.zeilen.length) return { ok: false, grund: "leer" };
  const offene = await module.exports.offeneZumStichtag(user, jahr, monat);
  const links = await webLinks(user, d);
  const datei = module.exports.monatsExcelBauen(d, offene, { links });
  await alsNutzer(user.id, (q) => exportVermerken(q, d, user, { excel: true }));
  const monatKurz = `${d.jahr}-${String(d.monat).padStart(2, "0")}`;
  return {
    ok: true, datei, titel: `${MONATSNAME[d.monat - 1]} ${d.jahr}`,
    dateiname: `Buchhaltung ${monatKurz} Sehorz-vom-Hofe.xlsx`,
    anzahl: d.zeilen.length, offene: offene.length, online: links.size,
  };
};

// Gueltigkeit der Links fuer die Kanzlei. Der Kundenlink aus beleg-versand.js
// gilt 30 Tage — das deckt ein Zahlungsziel ab. Die Kanzlei braucht laenger:
// Sie sieht den August womoeglich erst beim Jahresabschluss wieder, und ein
// toter Link waere dann schlimmer als gar keiner. 180 Tage reichen von jedem
// Monat bis ueber den naechsten Jahreswechsel.
const KANZLEI_LINK_TAGE = 180;

// Adressen fuer die Spalte "Online" — buchung_id -> https://…/r/<schluessel>.
//
// Nur fuer die EIGENEN Ausgangsrechnungen. Die Tabelle beleg_links (0062)
// haengt an rechnungen.id; fuer einen Eingangsbeleg gibt es keinen Weg ohne
// Anmeldung, und ein Link auf /buchhaltung/… wuerde der Kanzlei nur eine
// Anmeldemaske zeigen. Solche Zeilen bleiben in der Spalte leer — lieber
// leer als ein Klick, der nicht zum Beleg fuehrt.
//
// Ohne OS_URL entfaellt die Spalte ersatzlos: Ein Link auf "/r/xyz" ohne
// Wirt ist keine Adresse, und einen Wirt aus der Anfrage zu raten waere
// falsch — die Datei geht per Mail an jemanden ausserhalb des Hauses.
async function webLinks(user, d) {
  const links = new Map();
  const basis = String(process.env.OS_URL || "").trim().replace(/\/+$/, "");
  if (!basis || !/^https?:\/\//i.test(basis)) return links;
  // Nur Rechnungen, von denen es auch wirklich ein PDF gibt: /r/<schluessel>
  // liefert sonst "kein-pdf", und die Kanzlei klickt auf eine Fehlerseite.
  const zeilen = d.zeilen.filter((z) => z.rechnung_id && z.rechnung_datei);
  if (!zeilen.length) return links;
  let bv;
  try { bv = require("./beleg-versand.js"); } catch { return links; }
  if (!bv || typeof bv.schluesselNeu !== "function") return links;
  // Je Rechnung EIN Schluessel, auch wenn zwei Teilzahlungen im Monat stehen.
  const jeRechnung = new Map();
  for (const z of zeilen) {
    if (jeRechnung.has(z.rechnung_id)) { links.set(z.buchung_id, jeRechnung.get(z.rechnung_id)); continue; }
    let url = null;
    try { url = await kanzleiLink(user, bv, z.rechnung_id, basis); }
    catch (e) {
      // Beim ERSTEN Fehlschlag aufhoeren. Fehlt die Tabelle beleg_links
      // (Migration 0062 nicht eingespielt), scheitert jeder weitere Versuch
      // genauso — dann lieber eine Meldung im Protokoll als dreissig.
      console.error("Kanzlei-Link:", String(e.message).slice(0, 120));
      break;
    }
    if (!url) continue;
    jeRechnung.set(z.rechnung_id, url);
    links.set(z.buchung_id, url);
  }
  return links;
}

// Ein Link nach dem Muster von beleg-versand.linkHolen(), nur mit der langen
// Gueltigkeit. Ein bestehender Link wird weiterverwendet, solange er noch
// mindestens 30 Tage haelt — sonst entstuende bei jedem Klick auf "Excel" ein
// neuer Schluessel, und nach einem halben Jahr laegen dreissig gueltige Links
// auf dieselbe Rechnung in der Tabelle.
async function kanzleiLink(user, bv, rechnungId, basis) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [alt] } = await q(
      `select schluessel from beleg_links
        where rechnung_id = $1 and gueltig_bis > now() + interval '30 days'
        order by gueltig_bis desc limit 1`, [rechnungId]);
    if (alt) return bv.linkUrl(basis, alt.schluessel);
    const schluessel = bv.schluesselNeu();
    await q(
      `insert into beleg_links (schluessel, rechnung_id, gueltig_bis, erstellt_von)
       values ($1, $2, now() + ($3 || ' days')::interval, $4)`,
      [schluessel, rechnungId, String(KANZLEI_LINK_TAGE), user.id]);
    return bv.linkUrl(basis, schluessel);
  });
}

// Die Uebergabe an die Kanzlei festhalten (an_kanzlei_am). Wird von der
// Monats-Seite aufgerufen, NACHDEM steuer-versand.js den Entwurf angelegt
// oder die Mail gesendet hat — nie vorher.
module.exports.anKanzleiVermerken = async function (user, jahr, monat) {
  const d = await module.exports.monatsDaten(user, jahr, monat);
  if (!d || !d.zeilen.length) return { ok: false, grund: "leer" };
  await alsNutzer(user.id, (q) => exportVermerken(q, d, user, { kanzlei: true }));
  return { ok: true };
};

// Fruehere Exporte — damit nachvollziehbar bleibt, was schon rausgegangen ist.
module.exports.exportVerlauf = async function (user, limit = 12) {
  return alsNutzer(user.id, async (q) => {
    const mit = await kostenSpaltenDa(q);
    const { rows } = await q(
      `select e.*${mit ? "" : ", null::timestamptz as excel_geholt_am, null::timestamptz as an_kanzlei_am"},
              p.name as wer from monats_exporte e
         left join profiles p on p.id = e.von
        order by e.erstellt desc limit $1`, [Math.min(Math.max(Number(limit) || 12, 1), 1000)]);
    return rows.map((r) => ({ ...r, summe_ein: Number(r.summe_ein), summe_aus: Number(r.summe_aus) }));
  });
};

// ------------------------------------------------------- Kontostand-Erinnerung
//
// Den Kontostand gibt keine Schnittstelle her, also traegt Jannik ihn wöchentlich
// ein. Damit das nicht vergessen wird, legt diese Funktion eine Aufgabe an,
// sobald der eingetragene Stand aelter als sieben Tage ist.
//
// Bewusst ohne Zeitplaner: sie laeuft beim Aufruf der Buchhaltungsseite mit. Ein
// Cron-Job, der stillschweigend nicht laeuft, faellt niemandem auf — dieser Weg
// kann nicht ausfallen, weil er an der Seite haengt, auf der es auffaellt.
const ERINNERUNG_TITEL = "Kontostand eintragen";

module.exports.saldoErinnerung = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [e] } = await q(
      `select saldo_stand, (current_date - saldo_stand) as tage_alt
         from finanz_einstellungen where id = 1`);
    const tageAlt = e?.saldo_stand ? Number(e.tage_alt) : null;
    const faellig = tageAlt === null || tageAlt >= 7;
    if (!faellig) return { faellig: false, tageAlt, angelegt: false };

    // Nur eine offene Erinnerung gleichzeitig — sonst sammeln sich bei jedem
    // Seitenaufruf neue Aufgaben an.
    const { rows: schon } = await q(
      `select id from aufgaben
        where titel = $1 and besitzer = $2 and erledigt = false limit 1`,
      [ERINNERUNG_TITEL, user.id]);
    if (schon.length) return { faellig: true, tageAlt, angelegt: false, aufgabe: schon[0].id };

    // Auf den kommenden Montag legen. Am Montag selbst: heute.
    const { rows: [neu] } = await q(
      `insert into aufgaben (titel, notiz, besitzer, geplant_am, faellig, wichtigkeit)
       values ($1, $2, $3,
               current_date + ((8 - extract(isodow from current_date))::int % 7),
               current_date + ((8 - extract(isodow from current_date))::int % 7), 2)
       returning id`,
      [ERINNERUNG_TITEL,
       'Kontostand aus dem Online-Banking ablesen und in der Buchhaltung unter „Kontostand“ eintragen.',
       user.id]);
    return { faellig: true, tageAlt, angelegt: true, aufgabe: neu.id };
  });
};

// ------------------------------------------------------------------ Zu tun
//
// Die "Zu tun"-Gruppe der Uebersicht: alles, was auf die Geschaeftsfuehrung
// wartet. Bewusst nur Zahlen, die es schon gibt — keine neue Wahrheit.
module.exports.zuTun = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [b] } = await q(
      `select count(*) filter (where status = 'neu')::int as ungeprueft,
              count(*) filter (where status = 'fehler')::int as fehler from belege`);
    const { rows: [r] } = await q(
      `select count(*) filter (where art = 'einnahme' and not bezahlt and faellig < current_date)::int as ein_ueber,
              coalesce(sum(betrag) filter (where art = 'einnahme' and not bezahlt and faellig < current_date), 0)::numeric as ein_ueber_summe,
              count(*) filter (where art = 'ausgabe' and not bezahlt and faellig < current_date)::int as aus_ueber,
              coalesce(sum(betrag) filter (where art = 'ausgabe' and not bezahlt and faellig < current_date), 0)::numeric as aus_ueber_summe,
              count(*) filter (where art = 'ausgabe' and not bezahlt and faellig between current_date and current_date + 7)::int as aus_bald
         from buchungen`);
    const { rows: [k] } = await q(
      `select saldo_stand, (current_date - saldo_stand) as tage_alt from finanz_einstellungen where id = 1`);
    // Der Vormonat ohne Abschluss: Bewegungen da, aber weder Excel/ZIP geholt
    // noch an die Kanzlei gegangen.
    const mit = await kostenSpaltenDa(q);
    const { rows: [v] } = await q(
      `with vm as (select (date_trunc('month', current_date) - interval '1 month')::date as anfang)
       select extract(year from vm.anfang)::int as jahr, extract(month from vm.anfang)::int as monat,
              (select count(*) from buchungen bu where bu.bezahlt and date_trunc('month', bu.bezahlt_am) = vm.anfang)::int as bewegungen,
              (select count(*) from monats_exporte e
                where e.jahr = extract(year from vm.anfang) and e.monat = extract(month from vm.anfang))::int as exporte,
              ${mit ? `(select count(*) from monats_exporte e
                where e.jahr = extract(year from vm.anfang) and e.monat = extract(month from vm.anfang)
                  and e.an_kanzlei_am is not null)::int` : "0"} as kanzlei
         from vm`);
    return {
      belegeUngeprueft: b.ungeprueft, belegeFehler: b.fehler,
      einnahmenUeberfaellig: r.ein_ueber, einnahmenUeberfaelligSumme: Number(r.ein_ueber_summe),
      ausgabenUeberfaellig: r.aus_ueber, ausgabenUeberfaelligSumme: Number(r.aus_ueber_summe),
      ausgabenBald: r.aus_bald,
      kontostandTage: k?.saldo_stand ? Number(k.tage_alt) : null,
      vormonat: { jahr: v.jahr, monat: v.monat, bewegungen: v.bewegungen,
        abgeschlossen: v.kanzlei > 0, geholt: v.exporte > 0 },
    };
  });
};

// ------------------------------------------------- Rechnungen (Agent D1)
//
// lib/rechnungen.js entsteht parallel. Es wird erst beim Aufruf geladen und
// jeder Fehler abgefangen: Fehlt das Modul oder die Tabelle, liefert diese
// Funktion Nullen — die Seiten hier duerfen daran nie scheitern.
// Rueckgabe normalisiert, weil die genaue Zeilenform dort erst festgelegt wird.
module.exports.rechnungenOffen = async function (user) {
  let mod;
  try { mod = require("./rechnungen.js"); } catch { return { da: false, liste: [], summe: 0, anzahl: 0 }; }
  try {
    const roh = typeof mod.offeneRechnungen === "function" ? await mod.offeneRechnungen(user) : [];
    const liste = (Array.isArray(roh) ? roh : (roh?.liste || [])).map((r) => {
      const gesamt = Number(r.offen ?? r.rest ?? r.summe ?? r.betrag ?? 0) || 0;
      const bezahlt = Number(r.bezahlt_betrag ?? 0) || 0;
      const offen = r.offen !== undefined || r.rest !== undefined ? gesamt : Math.max(0, gesamt - bezahlt);
      return {
        id: r.id, nummer: r.nummer || "", firma: r.firma_name || r.firma || r.empfaenger?.name || "",
        datum: tagText(r.datum), faellig: tagText(r.faellig), betrag: offen, status: r.status || "",
        url: r.url || (r.id ? `/buchhaltung/rechnungen/${r.id}` : "/buchhaltung/rechnungen"),
        art: "einnahme", quelle: "rechnung", gegenstelle: r.firma_name || r.firma || "", notiz: r.titel || "",
      };
    });
    return { da: true, liste, summe: liste.reduce((a, r) => a + r.betrag, 0), anzahl: liste.length };
  } catch (e) {
    console.error("rechnungen.offeneRechnungen:", e.message);
    return { da: false, liste: [], summe: 0, anzahl: 0 };
  }
};

// Nur damit scripts/test-betrag.js die Zahlenlesung einzeln pruefen kann. Sie
// steckte bis zum 21.08. still in der Datei und hat jeden per Telegram
// gebuchten Beleg um den Faktor zehn oder hundert verfaelscht.
module.exports.zuBetrag = zuBetrag;
module.exports.AUSGABE_KATEGORIEN = AUSGABE_KATEGORIEN;
module.exports.EINNAHME_KATEGORIEN = EINNAHME_KATEGORIEN;
module.exports.ZEITRAEUME = ZEITRAEUME;
module.exports.MONATSNAME = MONATSNAME;
module.exports.QUELLEN = QUELLEN;
module.exports.INTERVALLE = INTERVALLE;
// Die reine Rechnerei — scripts/test-buchhaltung.js prueft sie ohne Datenbank.
module.exports.rechnen = { quelleAus, naechsteFaelligkeit, fixkostenJeMonat, offeneSummen, monatsStatus, tagText };
