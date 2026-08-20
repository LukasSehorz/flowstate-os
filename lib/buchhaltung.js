// Flowstate Buchhaltung — Datenzugriff.
// Nutzt denselben RLS-Weg wie das CRM (lib/crm.js): jede Abfrage laeuft im Namen
// des angemeldeten Nutzers, die Policies aus 0019_buchhaltung.sql lassen nur die
// Geschaeftsfuehrung heran.
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
  const saldo = zuBetrag(d.start_saldo);
  const satz = Number(String(d.steuersatz || "").replace(",", "."));

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
    // Nur BEZAHLTE Buchungen bewegen das Konto. Eine offene Rechnung ist Geld,
    // das noch nicht da ist — sie darf den Kontostand nicht erhoehen.
    // Ab dem Stichtag des Startsaldos rechnen, sonst zaehlen Altbuchungen doppelt.
    const seit = e?.saldo_stand ? ` and b.datum > $1::date` : "";
    const a = e?.saldo_stand ? [e.saldo_stand] : [];
    const { rows: [bew] } = await q(
      `select coalesce(sum(b.betrag) filter (where b.art = 'einnahme' and b.bezahlt), 0)::numeric as ein,
              coalesce(sum(b.betrag) filter (where b.art = 'ausgabe'), 0)::numeric as aus
         from buchungen b where true${seit}`, a);
    const ein = Number(bew.ein), aus = Number(bew.aus);
    const stand = start + ein - aus;

    // Steuer-Ruecklage auf den Gewinn des laufenden Jahres — nicht auf den Umsatz.
    // Bei Verlust ist die Ruecklage null, nicht negativ.
    const { rows: [jahr] } = await q(
      `select coalesce(sum(b.betrag) filter (where b.art = 'einnahme' and b.bezahlt), 0)::numeric as ein,
              coalesce(sum(b.betrag) filter (where b.art = 'ausgabe'), 0)::numeric as aus
         from buchungen b where b.datum >= date_trunc('year', current_date)`);
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

// Die vier Zahlen fuer die Karte auf der Zentrale.
//
// Bewusst NICHT uebersicht() — das sind sechs Abfragen samt Kontoauszug und
// Belegliste, und davon braucht eine Startseiten-Karte nichts. Zwei schmale
// Abfragen, die auf der Zentrale in Millisekunden durch sind.
//
// "Einnahmen" zaehlt wie ueberall in diesem Modul nur BEZAHLTES: eine
// verschickte Rechnung ist noch kein Geld. Sie steht daneben unter "offen".
module.exports.kennzahlen = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [b] } = await q(
      `select
        coalesce(sum(betrag) filter (where art = 'einnahme' and bezahlt
                 and datum >= date_trunc('month', current_date)), 0)::numeric as einnahmen_monat,
        coalesce(sum(betrag) filter (where art = 'ausgabe'
                 and datum >= date_trunc('month', current_date)), 0)::numeric as ausgaben_monat,
        coalesce(sum(betrag) filter (where art = 'einnahme' and not bezahlt), 0)::numeric as offen_summe,
        count(*) filter (where art = 'einnahme' and not bezahlt)::int as offen_anzahl,
        count(*) filter (where art = 'einnahme' and not bezahlt
                 and faellig < current_date)::int as ueberfaellig
       from buchungen`);
    const { rows: [be] } = await q(
      `select count(*) filter (where status = 'offen')::int as offen from belege`);
    const ein = Number(b.einnahmen_monat), aus = Number(b.ausgaben_monat);
    return {
      einnahmen_monat: ein, ausgaben_monat: aus, ergebnis_monat: ein - aus,
      offen_summe: Number(b.offen_summe), offen_anzahl: b.offen_anzahl,
      ueberfaellig: b.ueberfaellig, belege_offen: be.offen,
    };
  });
};

// Alles fuer die Uebersicht in einem Rutsch.
module.exports.uebersicht = async function (user, zeitraum = "monat") {
  const seitSql = ZEITRAEUME[zeitraum] === undefined ? ZEITRAEUME.monat : ZEITRAEUME[zeitraum];
  const seit = seitSql ? ` and b.datum >= ${seitSql}` : "";
  return alsNutzer(user.id, async (q) => {
    // Summen je Richtung im Zeitraum.
    // WICHTIG: Bei den Einnahmen zaehlen nur BEZAHLTE. Eine verschickte Rechnung ist
    // noch kein Geld — sie steht unter "Offene Rechnungen" und wandert erst mit dem
    // Haken hierher. Sonst waere die Einnahmenzahl geschoent.
    const { rows: [summe] } = await q(
      `select
        coalesce(sum(b.betrag) filter (where b.art = 'einnahme' and b.bezahlt), 0)::numeric as einnahmen,
        coalesce(sum(b.betrag) filter (where b.art = 'ausgabe'), 0)::numeric as ausgaben,
        count(*) filter (where b.art = 'einnahme' and b.bezahlt)::int as anzahl_einnahmen,
        count(*) filter (where b.art = 'ausgabe')::int as anzahl_ausgaben
       from buchungen b where true${seit}`);

    // Offene Rechnungen — zeitraumunabhaengig, offen ist offen.
    const { rows: offen } = await q(
      `select b.*, f.name as firma_name,
              (current_date - b.faellig) as tage_ueber
         from buchungen b left join firmen f on f.id = b.firma_id
        where b.art = 'einnahme' and b.bezahlt = false
        order by b.faellig nulls last, b.datum`);

    // Verlauf je Monat — immer die letzten zwölf, damit die Kurve etwas zeigt.
    const { rows: verlauf } = await q(
      `select to_char(date_trunc('month', b.datum), 'YYYY-MM') as monat,
              coalesce(sum(b.betrag) filter (where b.art = 'einnahme'), 0)::numeric as einnahmen,
              coalesce(sum(b.betrag) filter (where b.art = 'ausgabe'), 0)::numeric as ausgaben
         from buchungen b
        where b.datum >= date_trunc('month', current_date) - interval '11 months'
        group by 1 order by 1`);

    // Ausgaben je Kategorie im Zeitraum
    const { rows: kategorien } = await q(
      `select coalesce(nullif(b.kategorie, ''), 'Ohne Kategorie') as kategorie,
              sum(b.betrag)::numeric as betrag, count(*)::int as anzahl
         from buchungen b where b.art = 'ausgabe'${seit}
        group by 1 order by 2 desc`);

    // Letzte Buchungen — der Kontoauszug-Blick
    const { rows: letzte } = await q(
      `select b.*, f.name as firma_name, p.name as wer
         from buchungen b
         left join firmen f on f.id = b.firma_id
         left join profiles p on p.id = b.erfasst_von
        order by b.datum desc, b.id desc limit 12`);

    // Belege, die noch keiner Buchung zugeordnet sind
    const { rows: belege } = await q(
      `select be.*, p.name as wer from belege be
         left join profiles p on p.id = be.von
        order by (be.status = 'offen') desc, be.erstellt desc limit 20`);

    return {
      summe: {
        einnahmen: Number(summe.einnahmen), ausgaben: Number(summe.ausgaben),
        ergebnis: Number(summe.einnahmen) - Number(summe.ausgaben),
        anzahl_einnahmen: summe.anzahl_einnahmen, anzahl_ausgaben: summe.anzahl_ausgaben,
      },
      offen: offen.map((o) => ({ ...o, betrag: Number(o.betrag) })),
      offenSumme: offen.reduce((a, o) => a + Number(o.betrag), 0),
      verlauf: verlauf.map((v) => ({ monat: v.monat, einnahmen: Number(v.einnahmen), ausgaben: Number(v.ausgaben) })),
      kategorien: kategorien.map((k) => ({ ...k, betrag: Number(k.betrag) })),
      letzte: letzte.map((l) => ({ ...l, betrag: Number(l.betrag) })),
      belege: belege.map((b) => ({ ...b, betrag: b.betrag === null ? null : Number(b.betrag) })),
    };
  });
};

// Eine Buchung erfassen. betrag kommt als Text aus dem Formular ("1.234,56").
const zuBetrag = (v) => {
  const n = Number(String(v ?? "").replace(/\s|€/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

module.exports.buchen = async function (user, d) {
  const art = d.art === "einnahme" ? "einnahme" : "ausgabe";
  const betrag = zuBetrag(d.betrag);
  if (betrag === null) return { ok: false, grund: "betrag" };
  const erlaubt = art === "einnahme" ? EINNAHME_KATEGORIEN : AUSGABE_KATEGORIEN;
  // Nur Einnahmen koennen offen sein — eine Ausgabe ist bezahlt, sonst ist sie
  // keine Ausgabe, sondern eine Verbindlichkeit.
  const bezahlt = art === "einnahme" ? d.bezahlt !== "nein" : true;
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `insert into buchungen (art, datum, betrag, kategorie, gegenstelle, notiz,
                              firma_id, bezahlt, bezahlt_am, faellig, wiederkehrend, erfasst_von)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [art, d.datum || null, betrag,
       erlaubt.includes(d.kategorie) ? d.kategorie : null,
       d.gegenstelle || null, d.notiz || null,
       /^\d+$/.test(String(d.firma_id || "")) ? d.firma_id : null,
       bezahlt,
       // Zahltag = Buchungsdatum, wenn schon bezahlt. Offene Rechnung: keiner.
       bezahlt ? (d.datum || null) : null,
       art === "einnahme" && d.bezahlt === "nein" ? (d.faellig || null) : null,
       d.wiederkehrend === "ja", user.id]);
    return { ok: true, id: rows[0].id };
  });
};

// Der Haken bei "Offene Rechnungen": Geld ist da.
//
// bezahlt_am ist hier das Wichtige, nicht das Kennzeichen. Es entscheidet, in
// welchen Monatsordner die Rechnung wandert — nach dem Zufluss-Prinzip zaehlt
// der Tag, an dem das Geld kam, nicht der Tag, an dem wir die Rechnung
// geschrieben haben. Juli-Rechnung, im September bezahlt -> September-Ordner.
//
// Ein Zahltag kann mitgegeben werden (falls der Kontoauszug einen anderen Tag
// zeigt als heute); ohne Angabe ist es heute.
module.exports.bezahltSetzen = async function (user, id, bezahlt = true, am = null) {
  const tag = /^\d{4}-\d{2}-\d{2}$/.test(String(am || "")) ? am : null;
  return alsNutzer(user.id, async (q) => {
    await q(
      `update buchungen
          set bezahlt = $2,
              bezahlt_am = case when $2 then coalesce($3::date, current_date) else null end,
              faellig    = case when $2 then null else faellig end
        where id = $1`, [id, !!bezahlt, tag]);
    return { ok: true };
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
module.exports.belegHochladen = async function (user, d) {
  const art = d.art === "einnahme" ? "einnahme" : "ausgabe";
  // Die Datei kommt roh (Buffer) von der Hochladen-Route. datenBase64 bleibt als
  // zweiter Weg bestehen, damit sich Belege auch aus einem Skript einspielen
  // lassen, ohne einen Rumpf zusammenbauen zu muessen.
  const daten = Buffer.isBuffer(d.daten) ? d.daten
    : d.datenBase64 ? Buffer.from(d.datenBase64, "base64") : null;
  if (!daten || !daten.length) return { ok: false, grund: "keine-datei" };
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
    const { rows } = await q(
      `insert into belege (dateiname, dateityp, daten, groesse, pruefsumme, art, status, von)
       values ($1,$2,$3,$4,$5,$6,'neu',$7) returning id, laufnummer`,
      [String(d.dateiname || "Beleg").slice(0, 200), d.dateityp || null,
       daten, daten.length, summe, art, user.id]);
    return { ok: true, id: rows[0].id, laufnummer: rows[0].laufnummer };
  });
};

// Beleg auslesen und die Werte als Vorschlag hinterlegen.
//
// Bewusst getrennt vom Hochladen: der Upload muss auch gelingen, wenn das Lesen
// scheitert oder kein Zugang hinterlegt ist. Was hier gesetzt wird, ist ein
// Vorschlag — gebucht wird erst mit "Passt".
module.exports.belegLesen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [b] } = await q(
      `select id, dateiname, dateityp, daten, art, status from belege where id = $1`, [id]);
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
    // Der Hinweis sammelt beides: was das Modell selbst unklar fand, und den
    // Fall, dass die erkannte Richtung nicht zum Eingangskorb passt (Rechnung im
    // Ausgaben-Korb ist meistens ein Versehen und soll auffallen).
    const hinweise = [];
    if (w.hinweis) hinweise.push(w.hinweis);
    if (w.sicherheit === "niedrig") hinweise.push("Beleg war schlecht lesbar — Betrag und Datum bitte gegenprüfen.");
    if (w.richtung !== (b.art === "einnahme" ? "einnahme" : "ausgabe")) {
      hinweise.push(w.richtung === "einnahme"
        ? "Sieht nach einer Rechnung an einen Kunden aus, liegt aber bei den Ausgaben."
        : "Sieht nach einem bezahlten Beleg aus, liegt aber bei den Einnahmen.");
    }

    await q(
      `update belege set betrag = $2, datum = $3, gegenstelle = $4, kategorie = $5,
              belegnummer = $6, steuersatz = $7, notiz = $8, faellig = $9,
              gelesen = now(), lese_hinweis = $10, lese_modell = $11
        where id = $1`,
      [id, w.betrag, w.datum || null, w.gegenstelle || null, w.kategorie,
       w.belegnummer || null, w.steuersatz, w.notiz || null, w.faellig || null,
       hinweise.join(" ").slice(0, 400) || null, r.modell]);

    return { ok: true, werte: w };
  });
};

// Was im Eingang liegt — je Art getrennt.
// Verworfene sind draussen: sie bleiben in der Datenbank nachweisbar, haben im
// Arbeitsblick aber nichts zu suchen.
module.exports.belegeOffen = async function (user, art) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select b.id, b.laufnummer, b.dateiname, b.dateityp, b.art, b.status,
              b.betrag, b.datum, b.faellig, b.kategorie, b.gegenstelle, b.steuersatz,
              b.belegnummer, b.notiz, b.fehler_text, b.erstellt, b.groesse,
              b.pruefsumme, b.gelesen, b.lese_hinweis, b.buchung_id, b.firma_id,
              p.name as wer, (b.daten is not null) as hat_datei,
              bu.bezahlt as buchung_bezahlt, bu.bezahlt_am, f.name as firma_name
         from belege b
         left join profiles p on p.id = b.von
         left join buchungen bu on bu.id = b.buchung_id
         left join firmen f on f.id = b.firma_id
        where b.status <> 'verworfen' and ($1::text is null or b.art = $1)
        order by (b.status = 'neu') desc, b.erstellt desc limit 40`, [art || null]);
    return rows.map((r) => ({ ...r, betrag: r.betrag === null ? null : Number(r.betrag) }));
  });
};

module.exports.belegDatei = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(`select dateiname, dateityp, daten from belege where id = $1`, [id]);
    return rows[0] || null;
  });
};

// Werte am Beleg festhalten, ohne zu buchen (Zwischenstand beim Prüfen).
module.exports.belegWerte = async function (user, id, d) {
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
              firma_id = $10::int, fuer_position = $11
        where id = $1`,
      [id, zuBetrag(d.betrag), d.datum || null, d.kategorie || null, d.gegenstelle || null,
       d.steuersatz === undefined || d.steuersatz === "" ? null : Number(d.steuersatz),
       d.belegnummer || null, d.notiz || null,
       /^\d{4}-\d{2}-\d{2}$/.test(String(d.faellig || "")) ? d.faellig : null,
       /^\d+$/.test(String(d.firma_id || "")) ? Number(d.firma_id) : null,
       // Wofuer die Rechnung steht. Daran haengt, gegen welchen Stand in der
       // Kundenakte sie verrechnet wird (Migration 0045) — ohne das zaehlte
       // eine hochgeladene Monatsrechnung neben dem Zaehler doppelt.
       ["setup", "monatlich"].includes(d.fuer_position) ? d.fuer_position : null]);
    return { ok: true };
  });
};

// Bestaetigen: aus dem geprueften Beleg wird eine Buchung. Die Datei bleibt
// liegen, wo sie ist — bei uns.
//
// Der Unterschied zwischen den beiden Richtungen ist der ganze Grund, warum es
// "Offene Rechnungen" gibt:
//
//   AUSGABE   ist mit dem Beleg bezahlt. Der Bon IST der Zahlungsnachweis.
//             Zahltag = Belegdatum, zaehlt sofort.
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
// sie zufaellig eintippt.
module.exports.belegBuchen = async function (user, id, bezahltAm = null) {
  const zahltag = /^\d{4}-\d{2}-\d{2}$/.test(String(bezahltAm || "")) ? bezahltAm : null;
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
    // Ausgabe: mit dem Beleg bezahlt, Zahltag = Belegdatum.
    // Einnahme: nur bezahlt, wenn ein Zahltag mitgegeben wurde.
    const bezahlt = !einnahme || Boolean(zahltag);
    const amTag = einnahme ? zahltag : b.datum;

    const { rows: [bu] } = await q(
      // firma_id wandert vom Beleg in die Buchung. Daran haengt beides: die
      // Rechnung erscheint in der Kundenakte, und die Kundenakte weiss, was
      // offen ist.
      `insert into buchungen (art, datum, betrag, kategorie, gegenstelle, notiz,
                              bezahlt, bezahlt_am, faellig, erfasst_von, firma_id, fuer_position)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [einnahme ? "einnahme" : "ausgabe", b.datum, betrag,
       b.kategorie || null, b.gegenstelle || null, b.notiz || null,
       bezahlt, amTag,
       // Ein Zahlungsziel merken wir uns nur, solange noch nichts bezahlt ist.
       einnahme && !bezahlt ? (b.faellig || null) : null, user.id, b.firma_id || null, b.fuer_position || null]);

    await q(
      `update belege set status = 'gebucht', buchung_id = $2, fehler_text = null
        where id = $1`, [id, bu.id]);
    return { ok: true, buchung: bu.id, offeneRechnung: einnahme && !bezahlt, bezahltAm: amTag };
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
//   Uebersicht.csv     alle Bewegungen als Tabelle, in Excel direkt lesbar
//   Uebersicht.html    dasselbe zum Anschauen und Ausdrucken (Druck -> PDF)
//   Pruefsummen.txt    SHA-256 je Datei, damit belegbar ist, was drin war
//   Belege/...         die Dateien selbst, benannt nach Laufnummer und Datum
//
// Massgeblich ist bezahlt_am, nicht datum: eine Rechnung gehoert in den Monat,
// in dem das Geld geflossen ist. Offene Rechnungen sind darum nicht dabei — sie
// erscheinen erst in dem Monat, in dem sie bezahlt werden.

// Welche Monate ueberhaupt etwas enthalten — fuer die Auswahl auf der Seite.
module.exports.monateMitDaten = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select extract(year from bezahlt_am)::int as jahr,
              extract(month from bezahlt_am)::int as monat,
              count(*)::int as anzahl,
              coalesce(sum(betrag) filter (where art = 'einnahme'), 0)::numeric as ein,
              coalesce(sum(betrag) filter (where art = 'ausgabe'), 0)::numeric as aus
         from buchungen where bezahlt_am is not null
        group by 1, 2 order by 1 desc, 2 desc limit 36`);
    return rows.map((r) => ({ ...r, ein: Number(r.ein), aus: Number(r.aus) }));
  });
};

// Alles, was in einen Monatsordner gehoert.
module.exports.monatsDaten = async function (user, jahr, monat) {
  const j = Number(jahr), m = Number(monat);
  if (!Number.isInteger(j) || j < 2000 || j > 2100) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select bu.id as buchung_id, bu.art, bu.datum, bu.bezahlt_am, bu.betrag,
              bu.kategorie, bu.gegenstelle, bu.notiz,
              b.id as beleg_id, b.laufnummer, b.dateiname, b.dateityp,
              b.pruefsumme, b.groesse, b.belegnummer, b.steuersatz,
              (b.daten is not null) as hat_datei,
              f.name as firma_name, p.name as erfasst
         from buchungen bu
         left join belege b on b.buchung_id = bu.id and b.status = 'gebucht'
         left join firmen f on f.id = bu.firma_id
         left join profiles p on p.id = bu.erfasst_von
        where extract(year from bu.bezahlt_am) = $1
          and extract(month from bu.bezahlt_am) = $2
        order by bu.bezahlt_am, bu.id`, [j, m]);
    const zeilen = rows.map((r) => ({ ...r, betrag: Number(r.betrag) }));
    return {
      jahr: j, monat: m, zeilen,
      summe_ein: zeilen.filter((z) => z.art === "einnahme").reduce((a, z) => a + z.betrag, 0),
      summe_aus: zeilen.filter((z) => z.art === "ausgabe").reduce((a, z) => a + z.betrag, 0),
      mitBeleg: zeilen.filter((z) => z.hat_datei).length,
      ohneBeleg: zeilen.filter((z) => !z.hat_datei).length,
    };
  });
};

const MONATSNAME = ["Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];

// Dateiname im Archiv: Laufnummer voran, damit die Sortierung im Ordner der
// Reihenfolge in der Tabelle entspricht und jede Zeile eindeutig zu ihrer Datei
// fuehrt. Die Steuerberaterin liest "Beleg-Nr 0042" in der Tabelle und findet
// "0042 ..." im Ordner.
// Zweistellig: "09.07.2026", nicht "9.7.2026". So sieht es auf jedem
// Steuerbeleg aus und sortiert in Excel nicht durcheinander.
const tag = (v) => (v
  ? new Date(v).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
  : "");

// Datum fuer Dateinamen: JJJJ-MM-TT, damit der Ordner chronologisch sortiert.
// Nicht toISOString() — das rechnet in UTC und dreht oestlich davon auf den
// Vortag. Also aus den lokalen Bestandteilen zusammensetzen.
function tagSortierbar(v) {
  if (!v) return "";
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function archivName(z) {
  const nr = String(z.laufnummer || z.beleg_id).padStart(4, "0");
  return archiv.dateinameSicher(`${nr}_${tagSortierbar(z.bezahlt_am)}_${z.dateiname}`);
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
    { titel: "Datei", wert: (z) => (z.hat_datei ? archivName(z) : "keine Datei") },
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

// Das ZIP bauen und den Export protokollieren.
module.exports.monatsExport = async function (user, jahr, monat) {
  const d = await module.exports.monatsDaten(user, jahr, monat);
  if (!d) return { ok: false, grund: "zeitraum" };
  if (!d.zeilen.length) return { ok: false, grund: "leer" };

  const monatKurz = `${d.jahr}-${String(d.monat).padStart(2, "0")}`;
  const titel = `${MONATSNAME[d.monat - 1]} ${d.jahr}`;
  const csv = archiv.csv(d.zeilen, spaltenFuer());
  const html = module.exports.monatsVorschau(user, d);
  const dateiname = archivName;

  const mitDatei = [];
  await alsNutzer(user.id, async (q) => {
    // Dateien einzeln holen statt alle in einer Abfrage: ein Monat kann
    // hundert Fotos haben, und die muessen nicht alle gleichzeitig als eine
    // Ergebnismenge im Speicher liegen.
    for (const z of d.zeilen) {
      if (!z.hat_datei || !z.beleg_id) continue;
      const { rows: [datei] } = await q(`select daten from belege where id = $1`, [z.beleg_id]);
      if (datei && datei.daten) mitDatei.push({ z, daten: datei.daten });
    }
  });

  const pruefliste = [
    `Prüfsummen (SHA-256) — Buchhaltung ${titel}`,
    `Sehorz & vom Hofe GbR, erstellt am ${new Date().toLocaleString("de-DE")}`,
    "",
    ...mitDatei.map(({ z }) => `${z.pruefsumme || "(keine)"}  Belege/${dateiname(z)}`),
    "",
    `Export-Prüfsumme: ${archiv.exportPruefsumme(d.zeilen.filter((z) => z.laufnummer))}`,
  ].join("\n");

  const zip = archiv.zip([
    { name: "Uebersicht.csv", daten: csv },
    { name: "Uebersicht.html", daten: html },
    { name: "Pruefsummen.txt", daten: pruefliste },
    ...mitDatei.map(({ z, daten }) => ({ name: `Belege/${dateiname(z)}`, daten })),
  ]);

  const exportSumme = archiv.exportPruefsumme(d.zeilen.filter((z) => z.laufnummer));
  await alsNutzer(user.id, async (q) => {
    await q(
      `insert into monats_exporte (jahr, monat, anzahl, summe_ein, summe_aus,
                                   laufnummern, pruefsumme, von)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [d.jahr, d.monat, d.zeilen.length, d.summe_ein, d.summe_aus,
       d.zeilen.map((z) => z.laufnummer).filter(Boolean), exportSumme, user.id]);
  });

  return {
    ok: true, zip, titel,
    dateiname: `Buchhaltung ${monatKurz} Sehorz-vom-Hofe.zip`,
    anzahl: d.zeilen.length, dateien: mitDatei.length, ohneBeleg: d.ohneBeleg,
  };
};

// Frühere Exporte — damit nachvollziehbar bleibt, was schon rausgegangen ist.
module.exports.exportVerlauf = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select e.*, p.name as wer from monats_exporte e
         left join profiles p on p.id = e.von
        order by e.erstellt desc limit 12`);
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

module.exports.AUSGABE_KATEGORIEN = AUSGABE_KATEGORIEN;
module.exports.EINNAHME_KATEGORIEN = EINNAHME_KATEGORIEN;
module.exports.ZEITRAEUME = ZEITRAEUME;
module.exports.MONATSNAME = MONATSNAME;
