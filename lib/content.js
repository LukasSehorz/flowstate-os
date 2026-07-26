// Flowstate Content — Datenzugriff.
//
// Was wir selbst schreiben und posten. Bezahlte Werbung liegt daneben in
// lib/marketing.js — die beiden Bereiche teilen sich keine Tabelle.
//
//   redaktionsplan()  Was in den naechsten Tagen rausgehen soll
//   massenZaehler()   Wie viele Posts tatsaechlich rausgingen — je Woche, je Kanal
//
// Laeuft ueber denselben RLS-Weg wie das CRM: jede Abfrage im Namen des
// angemeldeten Nutzers.

const crm = require("./crm.js");
const alsNutzer = crm.alsNutzer;

// Feste Listen statt freier Eingabe, damit die Auswertung vergleichbar bleibt —
// "IG", "Insta" und "Instagram" waeren sonst drei Kanaele.
const KANAELE = ["Instagram", "TikTok", "LinkedIn", "YouTube", "Facebook", "Newsletter", "Blog"];
const FORMATE = ["Reel", "Karussell", "Story", "Einzelbild", "Video", "Text", "Artikel"];
const SPARTEN = ["webdesign", "performance", "ki", "allgemein"];
const SPARTE_LABEL = {
  webdesign: "Webdesign", performance: "Performance Marketing",
  ki: "KI-Projekte", allgemein: "Allgemein",
};
const ZIELGRUPPEN = ["Physiotherapie", "Zahnärzte", "Ärzte", "Fitness", "Gastronomie",
  "Handwerk", "Kanzleien", "Allgemein"];

const STATUS_LABEL = {
  idee: "Idee", entwurf: "Entwurf", geplant: "Geplant", veroeffentlicht: "Veröffentlicht",
};

// ------------------------------------------------------------- Einstellungen

module.exports.einstellungen = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(`select * from content_einstellungen where id = 1`);
    const e = rows[0] || { posts_ziel_woche: 20 };
    return { ...e, posts_ziel_woche: Number(e.posts_ziel_woche) };
  });
};

module.exports.zielSetzen = async function (user, ziel) {
  const n = Math.max(0, Math.min(500, Number(ziel) || 0));
  return alsNutzer(user.id, async (q) => {
    await q(`update content_einstellungen
                set posts_ziel_woche = $1, geaendert_von = $2, geaendert = now()
              where id = 1`, [n, user.id]);
    return { ok: true, ziel: n };
  });
};

// ----------------------------------------------------------- Redaktionsplan

// Alles, was noch nicht draussen ist. Sortiert nach dem geplanten Tag: was
// ueberfaellig ist, steht oben.
module.exports.redaktionsplan = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select p.*, pr.name as wer,
              (p.geplant_am < current_date) as ueberfaellig
         from content_posts p
         left join profiles pr on pr.id = p.besitzer
        where p.status <> 'veroeffentlicht'
        order by p.geplant_am nulls last, p.erstellt
        limit 60`);
    return rows;
  });
};

module.exports.letzteVeroeffentlicht = async function (user, anzahl = 12) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select p.*, pr.name as wer from content_posts p
         left join profiles pr on pr.id = p.besitzer
        where p.status = 'veroeffentlicht'
        order by p.veroeffentlicht_am desc nulls last, p.id desc limit $1`, [anzahl]);
    return rows;
  });
};

module.exports.postAnlegen = async function (user, d) {
  const titel = String(d.titel || "").trim();
  if (!titel) return { ok: false, grund: "titel" };
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `insert into content_posts (titel, kanal, format, status, geplant_am, sparte,
                                  zielgruppe, besitzer, notiz)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [titel.slice(0, 200),
       KANAELE.includes(d.kanal) ? d.kanal : KANAELE[0],
       FORMATE.includes(d.format) ? d.format : null,
       ["idee", "entwurf", "geplant"].includes(d.status) ? d.status : "idee",
       d.geplant_am || null,
       SPARTEN.includes(d.sparte) ? d.sparte : null,
       d.zielgruppe || null,
       d.besitzer || user.id,
       d.notiz || null]);
    return { ok: true, id: rows[0].id };
  });
};

// Einen Post weiterschieben. "veroeffentlicht" setzt zusaetzlich den Tag —
// das ist die Zahl, aus der der Ausstoss rechnet.
module.exports.postStatus = async function (user, id, status, link) {
  if (!STATUS_LABEL[status]) return { ok: false, grund: "status" };
  return alsNutzer(user.id, async (q) => {
    await q(
      `update content_posts
          set status = $2,
              veroeffentlicht_am = case
                when $2 = 'veroeffentlicht' then coalesce(veroeffentlicht_am, current_date)
                else null end,
              link = coalesce(nullif($3, ''), link)
        where id = $1`, [id, status, link || ""]);
    return { ok: true };
  });
};

module.exports.postAendern = async function (user, id, d) {
  return alsNutzer(user.id, async (q) => {
    await q(
      `update content_posts set titel = coalesce(nullif($2,''), titel),
              kanal = coalesce($3, kanal), format = $4, geplant_am = $5,
              sparte = $6, zielgruppe = $7, notiz = $8
        where id = $1`,
      [id, String(d.titel || "").trim().slice(0, 200),
       KANAELE.includes(d.kanal) ? d.kanal : null,
       FORMATE.includes(d.format) ? d.format : null,
       d.geplant_am || null,
       SPARTEN.includes(d.sparte) ? d.sparte : null,
       d.zielgruppe || null, d.notiz || null]);
    return { ok: true };
  });
};

module.exports.postLoeschen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    await q(`delete from content_posts where id = $1`, [id]);
    return { ok: true };
  });
};

// ------------------------------------------------------------------ Ausstoss
//
// "Masse schlaegt Qualitaet" heisst: die Zahl der Posts ist die Kennzahl. Darum
// zaehlt hier nur, was tatsaechlich raus ist — Ideen und Entwuerfe nicht.

module.exports.massenZaehler = async function (user) {
  return alsNutzer(user.id, async (q) => {
    // Die letzten acht Wochen, Montag bis Sonntag. generate_series fuellt auch
    // Wochen ohne Post, sonst waere die Kurve luegenhaft dicht.
    const { rows: wochen } = await q(
      `with w as (
         select generate_series(
           date_trunc('week', current_date) - interval '7 weeks',
           date_trunc('week', current_date), interval '1 week')::date as start
       )
       select w.start, count(p.id)::int as anzahl
         from w
         left join content_posts p
           on p.status = 'veroeffentlicht'
          and p.veroeffentlicht_am >= w.start
          and p.veroeffentlicht_am < w.start + 7
        group by w.start order by w.start`);

    const { rows: kanaele } = await q(
      `select kanal, count(*)::int as anzahl
         from content_posts
        where status = 'veroeffentlicht'
          and veroeffentlicht_am >= date_trunc('month', current_date)
        group by 1 order by 2 desc`);

    const { rows: [summe] } = await q(
      `select
         count(*) filter (where veroeffentlicht_am >= date_trunc('week', current_date))::int as woche,
         count(*) filter (where veroeffentlicht_am >= date_trunc('month', current_date))::int as monat,
         count(*) filter (where veroeffentlicht_am >= date_trunc('year', current_date))::int as jahr
       from content_posts where status = 'veroeffentlicht'`);

    const { rows: [offen] } = await q(
      `select
         count(*) filter (where status = 'idee')::int as ideen,
         count(*) filter (where status = 'entwurf')::int as entwuerfe,
         count(*) filter (where status = 'geplant')::int as geplant,
         count(*) filter (where status <> 'veroeffentlicht' and geplant_am < current_date)::int as ueberfaellig
       from content_posts`);

    return { wochen, kanaele, summe, offen };
  });
};

module.exports.KANAELE = KANAELE;
module.exports.FORMATE = FORMATE;
module.exports.SPARTEN = SPARTEN;
module.exports.SPARTE_LABEL = SPARTE_LABEL;
module.exports.ZIELGRUPPEN = ZIELGRUPPEN;
module.exports.STATUS_LABEL = STATUS_LABEL;
