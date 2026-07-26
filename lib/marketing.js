// Flowstate Marketing & Content — Datenzugriff.
//
// Vier Blickwinkel, die zusammen den Bereich ergeben:
//
//   redaktionsplan()  Was in den naechsten Tagen rausgehen soll
//   massenZaehler()   Wie viele Posts tatsaechlich rausgingen — je Woche, je Kanal
//   kampagnen()       Bezahlte Werbung mit Ausgaben, Leads und Kosten je Lead
//   funnel()          Von der Quelle bis zum Kunden, aus den CRM-Daten gerechnet
//
// Laeuft ueber denselben RLS-Weg wie das CRM: jede Abfrage im Namen des
// angemeldeten Nutzers.

const crm = require("./crm.js");
const alsNutzer = crm.alsNutzer;

// Kanaele und Formate. Feste Listen statt freier Eingabe, damit die Auswertung
// vergleichbar bleibt — "IG", "Insta" und "Instagram" waeren sonst drei Kanaele.
const KANAELE = ["Instagram", "TikTok", "LinkedIn", "YouTube", "Facebook", "Newsletter", "Blog"];
const FORMATE = ["Reel", "Karussell", "Story", "Einzelbild", "Video", "Text", "Artikel"];
const WERBEKANAELE = ["Meta Ads", "Google Ads", "LinkedIn Ads", "TikTok Ads", "Sonstige"];
const SPARTEN = ["webdesign", "performance", "ki", "allgemein"];
const SPARTE_LABEL = {
  webdesign: "Webdesign", performance: "Performance Marketing",
  ki: "KI-Projekte", allgemein: "Allgemein",
};
// Die Zielgruppen aus der Beschreibung des Bereichs. Frei ergaenzbar, aber diese
// beiden sind das Tagesgeschaeft.
const ZIELGRUPPEN = ["Physiotherapie", "Zahnärzte", "Ärzte", "Fitness", "Gastronomie",
  "Handwerk", "Kanzleien", "Allgemein"];

const STATUS_LABEL = {
  idee: "Idee", entwurf: "Entwurf", geplant: "Geplant", veroeffentlicht: "Veröffentlicht",
};

const heuteISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ------------------------------------------------------------- Einstellungen

module.exports.einstellungen = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(`select * from marketing_einstellungen where id = 1`);
    const e = rows[0] || { posts_ziel_woche: 20 };
    return { ...e, posts_ziel_woche: Number(e.posts_ziel_woche) };
  });
};

module.exports.zielSetzen = async function (user, ziel) {
  const n = Math.max(0, Math.min(500, Number(ziel) || 0));
  return alsNutzer(user.id, async (q) => {
    await q(`update marketing_einstellungen
                set posts_ziel_woche = $1, geaendert_von = $2, geaendert = now()
              where id = 1`, [n, user.id]);
    return { ok: true, ziel: n };
  });
};

// ----------------------------------------------------------- Redaktionsplan

// Alles, was noch nicht draussen ist, plus die letzten Veroeffentlichungen.
// Sortiert nach dem geplanten Tag: was ueberfaellig ist, steht oben.
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
// das ist die Zahl, aus der spaeter der Massen-Zaehler rechnet.
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

// ------------------------------------------------------------ Massen-Zaehler
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
       select w.start,
              count(p.id)::int as anzahl
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

    return {
      wochen: wochen.map((w) => ({ start: w.start, anzahl: w.anzahl })),
      kanaele, summe, offen,
    };
  });
};

// ----------------------------------------------------------------- Kampagnen

module.exports.kampagnen = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select k.*, pr.name as wer,
              coalesce(z.ausgaben, 0)::numeric  as ausgaben,
              coalesce(z.leads, 0)::int         as leads,
              coalesce(z.klicks, 0)::bigint     as klicks,
              coalesce(z.impressionen, 0)::bigint as impressionen,
              z.monate::int as monate
         from kampagnen k
         left join profiles pr on pr.id = k.besitzer
         left join (
           select kampagne_id, sum(ausgaben) as ausgaben, sum(leads) as leads,
                  sum(klicks) as klicks, sum(impressionen) as impressionen,
                  count(*) as monate
             from kampagnen_zahlen group by 1
         ) z on z.kampagne_id = k.id
        order by (k.status = 'laeuft') desc, k.start_am desc nulls last, k.id desc`);
    return rows.map((k) => {
      const ausgaben = Number(k.ausgaben), leads = Number(k.leads);
      return {
        ...k, ausgaben, leads,
        klicks: Number(k.klicks), impressionen: Number(k.impressionen),
        budget: k.budget === null ? null : Number(k.budget),
        // Kosten je Lead — die eine Zahl, an der eine Kampagne haengt.
        // Ohne Lead keine Aussage, darum null statt einer Division durch null.
        kosten_lead: leads > 0 ? ausgaben / leads : null,
      };
    });
  });
};

module.exports.kampagneAnlegen = async function (user, d) {
  const name = String(d.name || "").trim();
  if (!name) return { ok: false, grund: "name" };
  const budget = zuBetrag(d.budget);
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `insert into kampagnen (name, kanal, zielgruppe, sparte, status, start_am, ende_am,
                              budget, besitzer, notiz)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [name.slice(0, 200),
       WERBEKANAELE.includes(d.kanal) ? d.kanal : WERBEKANAELE[0],
       d.zielgruppe || null,
       SPARTEN.includes(d.sparte) ? d.sparte : null,
       ["geplant", "laeuft", "pausiert", "beendet"].includes(d.status) ? d.status : "laeuft",
       d.start_am || null, d.ende_am || null, budget, user.id, d.notiz || null]);
    return { ok: true, id: rows[0].id };
  });
};

module.exports.kampagneStatus = async function (user, id, status) {
  if (!["geplant", "laeuft", "pausiert", "beendet"].includes(status)) {
    return { ok: false, grund: "status" };
  }
  return alsNutzer(user.id, async (q) => {
    await q(`update kampagnen set status = $2,
                ende_am = case when $2 = 'beendet' then coalesce(ende_am, current_date) else ende_am end
              where id = $1`, [id, status]);
    return { ok: true };
  });
};

// Monatszahlen eintragen. Gibt es den Monat schon, wird er ueberschrieben statt
// verdoppelt — Zahlen aus dem Werbekonto werden im Nachhinein oft korrigiert.
module.exports.zahlenEintragen = async function (user, d) {
  const monat = String(d.monat || "").slice(0, 7); // JJJJ-MM
  if (!/^\d{4}-\d{2}$/.test(monat)) return { ok: false, grund: "monat" };
  if (!/^\d+$/.test(String(d.kampagne_id || ""))) return { ok: false, grund: "kampagne" };
  const zahl = (v) => Math.max(0, Math.round(Number(String(v ?? "").replace(/\./g, "").replace(",", ".")) || 0));
  return alsNutzer(user.id, async (q) => {
    await q(
      `insert into kampagnen_zahlen (kampagne_id, datum, ausgaben, impressionen, klicks, leads, notiz, erfasst_von)
       values ($1, ($2 || '-01')::date, $3, $4, $5, $6, $7, $8)
       on conflict (kampagne_id, datum) do update
          set ausgaben = excluded.ausgaben, impressionen = excluded.impressionen,
              klicks = excluded.klicks, leads = excluded.leads,
              notiz = excluded.notiz, erfasst_von = excluded.erfasst_von`,
      [d.kampagne_id, monat, zuBetrag(d.ausgaben) ?? 0, zahl(d.impressionen),
       zahl(d.klicks), zahl(d.leads), d.notiz || null, user.id]);
    return { ok: true };
  });
};

// Die Monatszeilen einer Kampagne — fuer die Detailansicht.
module.exports.kampagneZahlen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select z.*, p.name as wer from kampagnen_zahlen z
         left join profiles p on p.id = z.erfasst_von
        where z.kampagne_id = $1 order by z.datum desc`, [id]);
    return rows.map((z) => ({ ...z, ausgaben: Number(z.ausgaben) }));
  });
};

// ------------------------------------------------------------------- Funnel
//
// Bewusst ohne eigene Tabelle: woher ein Lead kam, aus welcher Branche er ist
// und wie weit er gekommen ist, steht schon im CRM. Alles zweimal zu fuehren
// hiesse, dass es irgendwann auseinanderlaeuft.
//
// Gemessen wird an drei Punkten: Lead -> Erstgespraech -> Kunde.
// "Erstgespraech erreicht" heisst: es gibt einen Deal, der mindestens so weit
// ist wie die Erstgespraechs-Stufe seiner Sparte. Dieselbe Rechnung wie in der
// Team-Leistung, damit beide Seiten dieselbe Zahl zeigen.

const ERSTGESPRAECH_ERREICHT = `
  exists (
    select 1 from deals d
      join pipeline_stages ss on ss.id = d.stufe_id
      join pipeline_stages eg on eg.sparte = ss.sparte and eg.art = ss.art
                             and eg.name in ('Erstgespräch', 'Readiness-Check gebucht')
     where d.firma_id = f.id and ss.position >= eg.position
  )`;

module.exports.funnel = async function (user, nach = "quelle") {
  // Nur diese beiden Spalten sind erlaubt — der Wert geht in die Abfrage ein.
  const spalte = nach === "branche" ? "f.branche" : "f.quelle";
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select coalesce(nullif(${spalte}, ''), 'Ohne Angabe') as gruppe,
              count(*)::int as leads,
              count(*) filter (where ${ERSTGESPRAECH_ERREICHT})::int as erstgespraeche,
              count(*) filter (where f.status = 'kunde')::int as kunden,
              coalesce(sum(
                (select sum(d.wert) from deals d
                  where d.firma_id = f.id and d.status = 'gewonnen')
              ), 0)::numeric as umsatz
         from firmen f
        group by 1
        having count(*) > 0
        order by 2 desc`);
    return rows.map((r) => {
      const leads = r.leads, eg = r.erstgespraeche, kunden = r.kunden;
      return {
        gruppe: r.gruppe, leads, erstgespraeche: eg, kunden,
        umsatz: Number(r.umsatz),
        // Prozentwerte erst hier und nicht in SQL: null bei 0 Leads ist
        // aussagekraeftiger als eine 0, die nach "schlecht" aussieht.
        quote_eg: leads > 0 ? Math.round((eg / leads) * 1000) / 10 : null,
        quote_kunde: leads > 0 ? Math.round((kunden / leads) * 1000) / 10 : null,
        quote_eg_kunde: eg > 0 ? Math.round((kunden / eg) * 1000) / 10 : null,
      };
    });
  });
};

// Betrag aus dem Formular ("1.234,56") in eine Zahl. Gleiche Regel wie in der
// Buchhaltung, damit sich beide Bereiche gleich anfuehlen.
function zuBetrag(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/\s|€/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

module.exports.KANAELE = KANAELE;
module.exports.FORMATE = FORMATE;
module.exports.WERBEKANAELE = WERBEKANAELE;
module.exports.SPARTEN = SPARTEN;
module.exports.SPARTE_LABEL = SPARTE_LABEL;
module.exports.ZIELGRUPPEN = ZIELGRUPPEN;
module.exports.STATUS_LABEL = STATUS_LABEL;
module.exports.heuteISO = heuteISO;
