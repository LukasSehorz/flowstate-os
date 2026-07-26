// Flowstate Buchhaltung — Datenzugriff.
// Nutzt denselben RLS-Weg wie das CRM (lib/crm.js): jede Abfrage laeuft im Namen
// des angemeldeten Nutzers, die Policies aus 0019_buchhaltung.sql lassen nur die
// Geschaeftsfuehrung heran.
const crm = require("./crm.js");
const alsNutzer = crm.alsNutzer;

// Kategorien. Bewusst hier und nicht in der Datenbank: sie aendern sich selten,
// und eine feste Liste haelt die Auswertung vergleichbar.
// Diese Liste MUSS zu den Schlüsseln in lexware.js AUSGABE_KATEGORIE passen —
// sonst landet eine Buchung bei Lexware in "Sonstige Ausgaben".
const AUSGABE_KATEGORIEN = [
  "Software & Tools", "Werbung & Ads", "Personal", "Honorare & Freelancer",
  "Büro & Ausstattung", "Fahrzeug & Tanken", "Reisekosten", "Steuern & Abgaben",
  "Versicherungen", "Sonstiges",
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

// Alles fuer die Uebersicht in einem Rutsch.
module.exports.uebersicht = async function (user, zeitraum = "monat") {
  const seitSql = ZEITRAEUME[zeitraum] === undefined ? ZEITRAEUME.monat : ZEITRAEUME[zeitraum];
  const seit = seitSql ? ` and b.datum >= ${seitSql}` : "";
  return alsNutzer(user.id, async (q) => {
    // Summen je Richtung im Zeitraum
    const { rows: [summe] } = await q(
      `select
        coalesce(sum(b.betrag) filter (where b.art = 'einnahme'), 0)::numeric as einnahmen,
        coalesce(sum(b.betrag) filter (where b.art = 'ausgabe'), 0)::numeric as ausgaben,
        count(*) filter (where b.art = 'einnahme')::int as anzahl_einnahmen,
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
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `insert into buchungen (art, datum, betrag, kategorie, gegenstelle, notiz,
                              firma_id, bezahlt, faellig, wiederkehrend, erfasst_von)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [art, d.datum || null, betrag,
       erlaubt.includes(d.kategorie) ? d.kategorie : null,
       d.gegenstelle || null, d.notiz || null,
       /^\d+$/.test(String(d.firma_id || "")) ? d.firma_id : null,
       // Nur Einnahmen koennen offen sein — eine Ausgabe ist bezahlt, sonst
       // ist sie keine Ausgabe, sondern eine Verbindlichkeit.
       art === "einnahme" ? d.bezahlt !== "nein" : true,
       art === "einnahme" && d.bezahlt === "nein" ? (d.faellig || null) : null,
       d.wiederkehrend === "ja", user.id]);
    return { ok: true, id: rows[0].id };
  });
};

module.exports.bezahltSetzen = async function (user, id, bezahlt = true) {
  return alsNutzer(user.id, async (q) => {
    await q(`update buchungen set bezahlt = $2, faellig = case when $2 then null else faellig end
              where id = $1`, [id, !!bezahlt]);
    return { ok: true };
  });
};

module.exports.buchungLoeschen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    await q(`update belege set buchung_id = null, status = 'offen' where buchung_id = $1`, [id]);
    await q(`delete from buchungen where id = $1`, [id]);
    return { ok: true };
  });
};

// ---------------------------------------------------------------- Belegeingang
//
// Ablauf: hochladen -> bestaetigen -> nach Lexware.
// Die Datei wird bis zur Bestaetigung in der Spalte "daten" zwischengelagert.
// Danach liegt sie in Lexware und wir loeschen sie hier wieder — Lexware ist der
// revisionssichere Ort, nicht wir.

// Datei entgegennehmen. Noch nichts gebucht, nur abgelegt.
module.exports.belegHochladen = async function (user, d) {
  const art = d.art === "einnahme" ? "einnahme" : "ausgabe";
  const daten = d.datenBase64 ? Buffer.from(d.datenBase64, "base64") : null;
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `insert into belege (dateiname, dateityp, daten, art, status, von)
       values ($1,$2,$3,$4,'neu',$5) returning id`,
      [String(d.dateiname || "Beleg").slice(0, 200), d.dateityp || null, daten, art, user.id]);
    return { ok: true, id: rows[0].id };
  });
};

// Was noch auf Bestaetigung wartet — je Art getrennt.
module.exports.belegeOffen = async function (user, art) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select b.id, b.dateiname, b.dateityp, b.art, b.status, b.betrag, b.datum,
              b.kategorie, b.gegenstelle, b.steuersatz, b.belegnummer, b.notiz,
              b.lexware_id, b.fehler_text, b.erstellt, p.name as wer,
              (b.daten is not null) as hat_datei,
              octet_length(b.daten) as groesse
         from belege b left join profiles p on p.id = b.von
        where ($1::text is null or b.art = $1)
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
      `update belege set betrag = $2, datum = $3, kategorie = $4, gegenstelle = $5,
              steuersatz = $6, belegnummer = $7, notiz = $8
        where id = $1`,
      [id, zuBetrag(d.betrag), d.datum || null, d.kategorie || null, d.gegenstelle || null,
       d.steuersatz === undefined || d.steuersatz === "" ? null : Number(d.steuersatz),
       d.belegnummer || null, d.notiz || null]);
    return { ok: true };
  });
};

// Bestaetigen: Beleg nach Lexware schieben, Datei anhaengen, Buchung bei uns anlegen.
// Wenn Lexware ablehnt, bleibt der Beleg im Eingang stehen und traegt den Grund —
// nichts wird halb gebucht.
module.exports.belegBuchen = async function (user, id, lex) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [b] } = await q(`select * from belege where id = $1`, [id]);
    if (!b) return { ok: false, grund: "nicht-gefunden" };
    if (b.status === "gebucht") return { ok: false, grund: "schon-gebucht" };
    const betrag = Number(b.betrag);
    if (!Number.isFinite(betrag) || betrag <= 0) return { ok: false, grund: "betrag" };

    const art = b.art === "einnahme" ? "einnahme" : "ausgabe";
    let lexId = null, dateiId = null, dateiFehler = null;
    if (lex && lex.bereit()) {
      if (b.daten) {
        // Mit Datei: hochladen. Lexware legt daraus selbst einen Beleg im Eingang an
        // und laesst seine Belegerkennung darueber laufen. Wir tragen die Werte NICHT
        // per PUT nach — das wuerde die Datei vom Beleg loesen (siehe lexware.js).
        try {
          const hoch = await lex.dateiHochladen({
            name: b.dateiname, typ: b.dateityp, daten: b.daten,
          });
          dateiId = hoch?.id || null;
          lexId = hoch?.voucherId || null;
        } catch (fehler) {
          await q(`update belege set status = 'fehler', fehler_text = $2 where id = $1`,
            [id, String(fehler.message).slice(0, 500)]);
          return { ok: false, grund: "lexware", fehler: fehler.message };
        }
      } else {
        // Ohne Datei (von Hand erfasst): Beleg direkt mit allen Werten anlegen.
        try {
          const angelegt = await lex.belegAnlegen({
            art, betrag, steuersatz: b.steuersatz ?? 0, datum: b.datum,
            gegenstelle: b.gegenstelle, kategorie: b.kategorie,
            belegnummer: b.belegnummer,
          });
          lexId = angelegt?.id || null;
        } catch (fehler) {
          await q(`update belege set status = 'fehler', fehler_text = $2 where id = $1`,
            [id, String(fehler.message).slice(0, 500)]);
          return { ok: false, grund: "lexware", fehler: fehler.message };
        }
      }
    }

    // Buchung bei uns — damit die Zahlen oben sofort stimmen.
    const { rows: [bu] } = await q(
      `insert into buchungen (art, datum, betrag, kategorie, gegenstelle, notiz, bezahlt, erfasst_von)
       values ($1,$2,$3,$4,$5,$6,true,$7) returning id`,
      [art, b.datum || null, betrag, b.kategorie || null, b.gegenstelle || null,
       b.notiz || null, user.id]);

    // Datei bei uns nur loeschen, wenn sie wirklich in Lexware angekommen ist.
    // Sonst behalten wir sie, damit sie nachgereicht werden kann.
    await q(
      // $4 braucht den Cast: er steht nur in einem NULL-Vergleich, sonst kann
      // Postgres den Typ nicht bestimmen.
      `update belege set status = 'gebucht', buchung_id = $2, lexware_id = $3,
              lexware_datei_id = $4::text, fehler_text = $5,
              daten = case when $4::text is not null then null else daten end
        where id = $1`, [id, bu.id, lexId, dateiId, dateiFehler]);
    return { ok: true, buchung: bu.id, lexware: lexId, datei: dateiId,
      ohneLexware: !lexId, dateiFehler };
  });
};

module.exports.belegLoeschen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    await q(`delete from belege where id = $1`, [id]);
    return { ok: true };
  });
};

module.exports.AUSGABE_KATEGORIEN = AUSGABE_KATEGORIEN;
module.exports.EINNAHME_KATEGORIEN = EINNAHME_KATEGORIEN;
module.exports.ZEITRAEUME = ZEITRAEUME;
