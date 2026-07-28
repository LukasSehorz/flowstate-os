// Flowstate Marketing — Datenzugriff.
//
// Was wir an Reichweite EINKAUFEN: Meta Ads, Google Ads, LinkedIn Ads. Was wir
// selbst schreiben und posten, liegt daneben in lib/content.js — die beiden
// Bereiche teilen sich keine Tabelle.
//
//   kampagnen()   Laufende und beendete Kampagnen mit Ausgaben, Leads, Kosten je Lead
//   funnel()      Von der Quelle bis zum Kunden, aus den CRM-Daten gerechnet
//
// Laeuft ueber denselben RLS-Weg wie das CRM: jede Abfrage im Namen des
// angemeldeten Nutzers.

const crm = require("./crm.js");
const alsNutzer = crm.alsNutzer;

const WERBEKANAELE = ["Meta Ads", "Google Ads", "LinkedIn Ads", "TikTok Ads", "Sonstige"];
const SPARTEN = ["webdesign", "performance", "ki", "allgemein"];
const SPARTE_LABEL = {
  webdesign: "Webdesign", performance: "Performance Marketing",
  ki: "KI-Projekte", allgemein: "Allgemein",
};
const ZIELGRUPPEN = ["Physiotherapie", "Zahnärzte", "Ärzte", "Fitness", "Gastronomie",
  "Handwerk", "Kanzleien", "Allgemein"];
const KAMPAGNE_STATUS = ["geplant", "laeuft", "pausiert", "beendet"];
// Die Datenbank speichert ohne Umlaute; angezeigt wird deutsch.
const STATUS_LABEL = {
  geplant: "geplant", laeuft: "läuft", pausiert: "pausiert", beendet: "beendet",
};

// ----------------------------------------------------------------- Kampagnen

module.exports.kampagnen = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select k.*, pr.name as wer,
              coalesce(z.ausgaben, 0)::numeric      as ausgaben,
              coalesce(z.leads, 0)::int             as leads,
              coalesce(z.klicks, 0)::bigint         as klicks,
              coalesce(z.impressionen, 0)::bigint   as impressionen,
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

// Die Zahlen fuer die Karte auf der Zentrale.
//
// Der Monat, nicht die Laufzeit: "was kostet uns Werbung gerade" ist die Frage
// auf einer Startseite. Die Kosten je Lead stehen daneben, weil die Ausgabe
// allein nichts sagt — 900 € sind gut oder schlecht, je nachdem was rauskam.
module.exports.kennzahlen = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [k] } = await q(
      `select count(*) filter (where status = 'laeuft')::int   as laufend,
              count(*) filter (where status = 'geplant')::int  as geplant,
              coalesce(sum(budget) filter (where status = 'laeuft'), 0)::numeric as budget_laufend
         from kampagnen`);
    const { rows: [z] } = await q(
      `select coalesce(sum(ausgaben), 0)::numeric as ausgaben,
              coalesce(sum(leads), 0)::int        as leads,
              coalesce(sum(klicks), 0)::bigint    as klicks
         from kampagnen_zahlen where datum >= date_trunc('month', current_date)`);
    const ausgaben = Number(z.ausgaben), leads = Number(z.leads);
    return {
      laufend: k.laufend, geplant: k.geplant, budget_laufend: Number(k.budget_laufend),
      ausgaben_monat: ausgaben, leads_monat: leads, klicks_monat: Number(z.klicks),
      // Ohne Lead keine Aussage — null statt einer Division durch null.
      kosten_lead: leads > 0 ? ausgaben / leads : null,
    };
  });
};

module.exports.kampagneAnlegen = async function (user, d) {
  const name = String(d.name || "").trim();
  if (!name) return { ok: false, grund: "name" };
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `insert into kampagnen (name, kanal, zielgruppe, sparte, status, start_am, ende_am,
                              budget, besitzer, notiz)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [name.slice(0, 200),
       WERBEKANAELE.includes(d.kanal) ? d.kanal : WERBEKANAELE[0],
       d.zielgruppe || null,
       SPARTEN.includes(d.sparte) ? d.sparte : null,
       KAMPAGNE_STATUS.includes(d.status) ? d.status : "laeuft",
       d.start_am || null, d.ende_am || null, zuBetrag(d.budget), user.id, d.notiz || null]);
    return { ok: true, id: rows[0].id };
  });
};

module.exports.kampagneStatus = async function (user, id, status) {
  if (!KAMPAGNE_STATUS.includes(status)) return { ok: false, grund: "status" };
  return alsNutzer(user.id, async (q) => {
    await q(`update kampagnen set status = $2,
                ende_am = case when $2 = 'beendet' then coalesce(ende_am, current_date) else ende_am end
              where id = $1`, [id, status]);
    return { ok: true };
  });
};

module.exports.kampagneLoeschen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    await q(`delete from kampagnen where id = $1`, [id]);
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

module.exports.WERBEKANAELE = WERBEKANAELE;
module.exports.SPARTEN = SPARTEN;
module.exports.SPARTE_LABEL = SPARTE_LABEL;
module.exports.ZIELGRUPPEN = ZIELGRUPPEN;
module.exports.KAMPAGNE_STATUS = KAMPAGNE_STATUS;
module.exports.STATUS_LABEL = STATUS_LABEL;
