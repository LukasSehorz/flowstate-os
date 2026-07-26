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
//
// YouTube steht zweimal drin, und das ist Absicht: ein Langvideo und ein Short
// sind verschiedene Arbeit mit verschiedenen Zielen (1 gegen 14 pro Woche). In
// einem Topf gerechnet saehe eine Woche mit 15 Shorts und ohne Langvideo nach
// erfuelltem Soll aus — obwohl genau das aufwendigste Stueck fehlt.
const KANAELE = ["YouTube Video", "YouTube Shorts", "TikTok", "Instagram", "X"];

// Die SORTE beschreibt das Stueck selbst, nicht seinen Auftritt: ein Kurzvideo
// bleibt ein Kurzvideo, ob es als Short, als Reel oder auf TikTok laeuft. Darum
// haengt sie nicht mehr am Kanal — frueher hiess dasselbe Video je nach Ort
// anders, und die Auswertung zaehlte drei verschiedene Dinge.
//
// "kanaele" ist der Vorschlag, wenn man diese Sorte waehlt. Genau Janniks
// Ablauf: ein Kurzvideo geht auf alle drei Videokanaele, ein Langvideo nur auf
// YouTube. Der Vorschlag ist aenderbar, er spart nur Klicks.
const SORTEN = [
  { id: "kurzvideo",  titel: "Kurzvideo",       kanaele: ["TikTok", "YouTube Shorts", "Instagram"] },
  { id: "langvideo",  titel: "Langvideo",       kanaele: ["YouTube Video"] },
  { id: "beitrag",    titel: "Beitrag",         kanaele: ["X"] },
  { id: "thread",     titel: "Thread",          kanaele: ["X"] },
  { id: "karussell",  titel: "Foto-Karussell",  kanaele: ["Instagram", "TikTok"] },
  { id: "story",      titel: "Story",           kanaele: ["Instagram"] },
  { id: "livestream", titel: "Livestream",      kanaele: ["YouTube Video", "TikTok"] },
];
const SORTEN_TITEL = SORTEN.map((s) => s.titel);
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

// ------------------------------------------------------------------- Marken
//
// Die Personal-Brands. Kommen aus profiles, damit die Namen an einer Stelle
// stehen. Wer keinen Content macht, taucht hier nicht auf — die Liste ergibt
// sich aus den Rollen, nicht aus einer zweiten Namensliste.

module.exports.marken = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select id, name from profiles where rolle = 'admin' and aktiv order by name`);
    return rows.map((m) => ({ ...m, kurz: m.name.split(" ")[0] }));
  });
};

// Der Filter der ganzen Seite: erst Marke, dann Kanal. Beide zusammen in EINEM
// Ausdruck, und in jeder Abfrage derselbe — sonst zeigen Kacheln, Plan und
// Ausstoss irgendwann verschiedene Teilmengen und niemand merkt es.
//
// $1 ist immer die Marke, $2 immer der Kanal (jeweils null = alle). Dass die
// Parameternummern ueberall gleich sind, ist Absicht: eine Abfrage laesst sich
// so kopieren, ohne die Nummern nachzuziehen.
// Der Kanalvergleich laeuft ueber "= any(kanaele)", weil ein Stueck jetzt auf
// mehreren Kanaelen liegt. Ein Kurzvideo taucht damit sowohl unter TikTok als
// auch unter YouTube auf — genau so, wie es tatsaechlich erscheint.
const FILTER = (alias = "p") =>
  `($1::uuid is null or ${alias}.marke = $1) and ($2::text is null or $2 = any(${alias}.kanaele))`;

const markeOderNull = (m) => (/^[0-9a-f-]{36}$/i.test(String(m || "")) ? m : null);
// Nur ein Kanal aus der festen Liste — der Wert kommt aus der Adresszeile.
const kanalOderNull = (k) => (KANAELE.includes(k) ? k : null);
const werte = (marke, kanal) => [markeOderNull(marke), kanalOderNull(kanal)];

// Aus dem Formular kommen die Kanaele als Liste oder als einzelner Wert (ein
// Kaestchen angehakt = kein Array). Beides annehmen, gegen die feste Liste
// pruefen, Doppelte raus. Bleibt nichts uebrig, waere der Post nirgends
// sichtbar — dann lieber der Standardkanal als eine Zeile ins Leere.
function kanaeleSauber(v) {
  const roh = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const rein = [...new Set(roh.filter((k) => KANAELE.includes(k)))];
  return rein.length ? rein : [KANAELE[0]];
}

// ------------------------------------------------------------------- Ziele
//
// Ein Wochenziel je Marke UND Kanal. Janniks Woche ist nicht gleichmaessig
// verteilt: 15 auf YouTube, 14 auf TikTok, 14 auf Instagram, 7 auf X. Eine
// einzige Zahl fuer alles waere hier nur Dekoration.
//
// Keine Zeile heisst "noch nicht festgelegt" — nicht "Ziel null". Der
// Unterschied ist wichtig: bei Lukas steht noch nichts fest, und eine 0 wuerde
// aussehen, als haette er sein Soll immer erfuellt.

module.exports.ziele = async function (user, marke = null) {
  const m = markeOderNull(marke);
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select marke, kanal, ziel from content_ziele
        where ($1::uuid is null or marke = $1)`, [m]);
    return rows;
  });
};

// Die Ziele einer Marke als Nachschlagewerk { Kanal: Ziel }.
module.exports.zieleVonMarke = async function (user, marke) {
  const rows = await module.exports.ziele(user, marke);
  return Object.fromEntries(rows.map((r) => [r.kanal, Number(r.ziel)]));
};

module.exports.zieleSetzen = async function (user, marke, werteJeKanal) {
  const m = markeOderNull(marke);
  if (!m) return { ok: false, grund: "marke" };
  return alsNutzer(user.id, async (q) => {
    for (const kanal of KANAELE) {
      const roh = werteJeKanal[kanal];
      // Leeres Feld = Ziel entfernen. So laesst sich ein Kanal auch wieder auf
      // "nicht festgelegt" stellen, statt eine 0 stehen lassen zu muessen.
      if (roh === undefined || String(roh).trim() === "") {
        await q(`delete from content_ziele where marke = $1 and kanal = $2`, [m, kanal]);
        continue;
      }
      const n = Math.max(0, Math.min(500, Math.round(Number(roh) || 0)));
      await q(
        `insert into content_ziele (marke, kanal, ziel, geaendert_von, geaendert)
         values ($1,$2,$3,$4,now())
         on conflict (marke, kanal) do update
            set ziel = excluded.ziel, geaendert_von = excluded.geaendert_von,
                geaendert = now()`, [m, kanal, n, user.id]);
    }
    return { ok: true };
  });
};

// ----------------------------------------------------------- Redaktionsplan

// Alles, was noch nicht draussen ist. Sortiert nach dem geplanten Tag: was
// ueberfaellig ist, steht oben.
module.exports.redaktionsplan = async function (user, marke = null, kanal = null) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select p.*, pr.name as wer, mk.name as marke_name,
              (p.geplant_am < current_date) as ueberfaellig
         from content_posts p
         left join profiles pr on pr.id = p.besitzer
         left join profiles mk on mk.id = p.marke
        where p.status <> 'veroeffentlicht' and ${FILTER()}
        order by p.geplant_am nulls last, p.erstellt
        limit 60`, werte(marke, kanal));
    return rows;
  });
};

module.exports.letzteVeroeffentlicht = async function (user, anzahl = 12, marke = null, kanal = null) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select p.*, pr.name as wer, mk.name as marke_name from content_posts p
         left join profiles pr on pr.id = p.besitzer
         left join profiles mk on mk.id = p.marke
        where p.status = 'veroeffentlicht' and ${FILTER()}
        order by p.veroeffentlicht_am desc nulls last, p.id desc limit $3`,
      [...werte(marke, kanal), anzahl]);
    return rows;
  });
};

module.exports.postAnlegen = async function (user, d) {
  const titel = String(d.titel || "").trim();
  if (!titel) return { ok: false, grund: "titel" };
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `insert into content_posts (titel, kanaele, sorte, status, geplant_am, sparte,
                                  zielgruppe, besitzer, marke, notiz)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [titel.slice(0, 200),
       kanaeleSauber(d.kanaele),
       SORTEN_TITEL.includes(d.sorte) ? d.sorte : null,
       ["idee", "entwurf", "geplant"].includes(d.status) ? d.status : "idee",
       d.geplant_am || null,
       SPARTEN.includes(d.sparte) ? d.sparte : null,
       d.zielgruppe || null,
       d.besitzer || user.id,
       // Ohne Angabe geht der Post auf den eigenen Account — das ist der
       // haeufige Fall und erspart eine Pflichtauswahl.
       markeOderNull(d.marke) || user.id,
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
              kanaele = coalesce($3, kanaele), sorte = $4, geplant_am = $5,
              sparte = $6, zielgruppe = $7, notiz = $8
        where id = $1`,
      [id, String(d.titel || "").trim().slice(0, 200),
       d.kanaele ? kanaeleSauber(d.kanaele) : null,
       SORTEN_TITEL.includes(d.sorte) ? d.sorte : null,
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

module.exports.massenZaehler = async function (user, marke = null, kanal = null) {
  const w = werte(marke, kanal);
  return alsNutzer(user.id, async (q) => {
    // Die letzten acht Wochen, Montag bis Sonntag. generate_series fuellt auch
    // Wochen ohne Post, sonst waere die Kurve luegenhaft dicht.
    // Gezaehlt werden PLATZIERUNGEN, nicht Stuecke: ein Kurzvideo auf drei
    // Kanaelen ist dreimal Reichweite. Nur so passt die Zahl zu den Zielen, die
    // ja auch je Kanal gesetzt sind (YouTube 15, TikTok 14, …).
    // Was in Arbeit ist, wird weiter unten dagegen in Stuecken gezaehlt — daran
    // arbeitet man einmal, nicht dreimal.
    const { rows: wochen } = await q(
      `with w as (
         select generate_series(
           date_trunc('week', current_date) - interval '7 weeks',
           date_trunc('week', current_date), interval '1 week')::date as start
       )
       select w.start, count(k.*)::int as anzahl
         from w
         left join content_posts p
           on p.status = 'veroeffentlicht'
          and p.veroeffentlicht_am >= w.start
          and p.veroeffentlicht_am < w.start + 7
          and ${FILTER()}
         -- Die zweite Bedingung ist entscheidend: FILTER waehlt die ZEILE aus,
         -- hier wird die PLATZIERUNG ausgewaehlt. Ohne sie zaehlte ein
         -- Kurzvideo unter "TikTok" dreifach, weil es drei Kanaele hat.
         left join lateral unnest(p.kanaele) as k
                on ($2::text is null or k = $2)
        group by w.start order by w.start`, w);

    const { rows: kanaele } = await q(
      // unnest: ein Stueck liegt auf mehreren Kanaelen und wird bei jedem davon
      // mitgezaehlt. 14 Kurzvideos ergeben so 14 bei TikTok UND 14 bei YouTube —
      // was der Wahrheit entspricht, denn sie erscheinen auch wirklich beidseits.
      `select k as kanal, count(*)::int as anzahl
         from content_posts p, unnest(p.kanaele) as k
        where status = 'veroeffentlicht'
          and veroeffentlicht_am >= date_trunc('month', current_date)
          and ${FILTER()}
          and ($2::text is null or k = $2)
        group by 1 order by 2 desc`, w);

    // Auch hier Platzierungen (unnest), damit die Kachel zur Zielsumme passt.
    const { rows: [summe] } = await q(
      `select
         count(*) filter (where veroeffentlicht_am >= date_trunc('week', current_date))::int as woche,
         count(*) filter (where veroeffentlicht_am >= date_trunc('month', current_date))::int as monat,
         count(*) filter (where veroeffentlicht_am >= date_trunc('year', current_date))::int as jahr
       from content_posts p, unnest(p.kanaele) as k
      where status = 'veroeffentlicht' and ${FILTER()}
        and ($2::text is null or k = $2)`, w);

    // Stuecke statt Platzierungen: wie viele einzelne Beitraege gab es? Ein
    // Kurzvideo auf drei Kanaelen ist hier EINS.
    const { rows: [stuecke] } = await q(
      `select
         count(*) filter (where veroeffentlicht_am >= date_trunc('week', current_date))::int as woche,
         count(*) filter (where veroeffentlicht_am >= date_trunc('month', current_date))::int as monat
       from content_posts p where status = 'veroeffentlicht' and ${FILTER()}`, w);

    const { rows: [offen] } = await q(
      `select
         count(*) filter (where status = 'idee')::int as ideen,
         count(*) filter (where status = 'entwurf')::int as entwuerfe,
         count(*) filter (where status = 'geplant')::int as geplant,
         count(*) filter (where status <> 'veroeffentlicht' and geplant_am < current_date)::int as ueberfaellig
       from content_posts p where ${FILTER()}`, w);

    return { wochen, kanaele, summe, stuecke, offen };
  });
};

// Je Kanal die Zahlen — fuer die zweite Umschalterreihe. Immer INNERHALB der
// gewaehlten Marke: bei "Jannik" zeigt TikTok Janniks TikTok-Zahlen, nicht die
// von beiden. Sonst waere die Zahl neben dem Knopf eine andere als die, die man
// nach dem Klick sieht.
module.exports.jeKanal = async function (user, marke = null) {
  const m = markeOderNull(marke);
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select k as kanal,
              count(*) filter (where status = 'veroeffentlicht'
                and veroeffentlicht_am >= date_trunc('week', current_date))::int as woche,
              count(*) filter (where status <> 'veroeffentlicht')::int as in_arbeit,
              count(*) filter (where status <> 'veroeffentlicht'
                and geplant_am < current_date)::int as ueberfaellig
         from content_posts p, unnest(p.kanaele) as k
        where ($1::uuid is null or p.marke = $1)
        group by k`, [m]);
    // Als Nachschlagewerk zurueck, damit die Seite auch Kanaele ohne Post
    // anzeigen kann — die sind gerade die interessanten.
    return Object.fromEntries(rows.map((r) => [r.kanal, r]));
  });
};

// Je Marke die Zahlen der laufenden Woche — fuer die Umschalter oben auf der
// Seite. So sieht man beim Umschalten schon, wo etwas liegen blieb.
module.exports.jeMarke = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      // "woche" zaehlt PLATZIERUNGEN (darum unnest) — dieselbe Groesse wie die
      // Kachel und die Kanalziele. "in_arbeit" zaehlt dagegen STUeCKE, denn an
      // einem Kurzvideo arbeitet man einmal, nicht dreimal. Die beiden Zahlen
      // messen absichtlich Verschiedenes.
      `select pr.id, pr.name,
              count(k.*) filter (where p.status = 'veroeffentlicht'
                and p.veroeffentlicht_am >= date_trunc('week', current_date))::int as woche,
              count(distinct p.id) filter (where p.status <> 'veroeffentlicht')::int as in_arbeit,
              count(distinct p.id) filter (where p.status <> 'veroeffentlicht'
                and p.geplant_am < current_date)::int as ueberfaellig
         from profiles pr
         left join content_posts p on p.marke = pr.id
         left join lateral unnest(p.kanaele) as k on true
        where pr.rolle = 'admin' and pr.aktiv
        group by pr.id, pr.name order by pr.name`);
    return rows;
  });
};

module.exports.KANAELE = KANAELE;
module.exports.SORTEN = SORTEN;
module.exports.SORTEN_TITEL = SORTEN_TITEL;
module.exports.SPARTEN = SPARTEN;
module.exports.SPARTE_LABEL = SPARTE_LABEL;
module.exports.ZIELGRUPPEN = ZIELGRUPPEN;
module.exports.STATUS_LABEL = STATUS_LABEL;
