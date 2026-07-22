// Flowstate CRM — Datenzugriff mit echter Row-Level-Security.
// Kniff: Pro Transaktion wird die Postgres-Rolle 'authenticated' und der JWT-Claim
// gesetzt. Dadurch greifen exakt die Policies aus 0002_rls.sql — genau wie beim
// Supabase-Client, ohne zusaetzliche Schluessel.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 6,
  idleTimeoutMillis: 20000,
});

// Fuehrt Abfragen im Namen eines Nutzers aus -> RLS aktiv
async function alsNutzer(userId, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query(`set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: "authenticated" })}'`);
    const r = await fn((sql, args = []) => c.query(sql, args));
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// Ohne Nutzerkontext (nur fuer Login-Pruefung und Systemaufgaben)
async function system(sql, args = []) {
  const r = await pool.query(sql, args);
  return r;
}

// ---------------------------------------------------------------- Login
async function anmelden(email, passwort) {
  const { rows } = await system(
    `select u.id, u.email, p.name, p.rolle, p.aktiv
       from auth.users u join public.profiles p on p.id = u.id
      where lower(u.email) = lower($1)
        and u.encrypted_password = crypt($2, u.encrypted_password)`,
    [String(email).trim(), passwort]
  );
  const u = rows[0];
  if (!u || !u.aktiv) return null;
  return { id: u.id, email: u.email, name: u.name, rolle: u.rolle };
}

async function passwortAendern(userId, neu) {
  await system(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where id = $1`, [userId, neu]);
}

// ---------------------------------------------------------------- Stammdaten
async function stufen(user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(`select * from pipeline_stages order by sparte, art, position`);
    return rows;
  });
}

async function team(user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(`select id, name, rolle from profiles where aktiv order by rolle, name`);
    return rows;
  });
}

// ---------------------------------------------------------------- Firmen (Leads & Kunden)
async function firmenListe(user, { suche = "", status = "", temperatur = "", besitzer = "", limit = 200 } = {}) {
  return alsNutzer(user.id, async (q) => {
    const w = [], a = [];
    if (suche) { a.push(`%${suche}%`); w.push(`(f.name ilike $${a.length} or f.ort ilike $${a.length} or f.telefon ilike $${a.length} or f.email ilike $${a.length})`); }
    if (status) { a.push(status); w.push(`f.status = $${a.length}`); }
    if (temperatur) { a.push(temperatur); w.push(`f.temperatur = $${a.length}`); }
    if (besitzer) { a.push(besitzer); w.push(`f.besitzer = $${a.length}`); }
    a.push(limit);
    const { rows } = await q(
      `select f.*, p.name as besitzer_name,
              (select count(*) from deals d where d.firma_id = f.id and d.status = 'offen') as offene_deals
         from firmen f left join profiles p on p.id = f.besitzer
        ${w.length ? "where " + w.join(" and ") : ""}
        order by (f.wiedervorlage is not null and f.wiedervorlage <= current_date) desc,
                 f.score desc nulls last, f.letzte_aktivitaet desc
        limit $${a.length}`, a);
    return rows;
  });
}

async function firma(user, id) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(`select f.*, p.name as besitzer_name from firmen f left join profiles p on p.id=f.besitzer where f.id=$1`, [id]);
    if (!rows[0]) return null;
    const f = rows[0];
    f.kontakte = (await q(`select * from kontakte where firma_id=$1 order by id`, [id])).rows;
    f.deals = (await q(`select d.*, s.name as stufe_name, p.name as besitzer_name
                          from deals d left join pipeline_stages s on s.id=d.stufe_id
                          left join profiles p on p.id=d.besitzer
                         where d.firma_id=$1 order by d.erstellt desc`, [id])).rows;
    f.projekte = (await q(`select pr.*, s.name as stufe_name from projekte pr
                           left join pipeline_stages s on s.id=pr.stufe_id where pr.firma_id=$1`, [id])).rows;
    f.aufgaben = (await q(`select * from aufgaben where firma_id=$1 order by erledigt, faellig nulls last`, [id])).rows;
    f.historie = (await q(`select a.*, p.name as wer_name from aktivitaeten a left join profiles p on p.id=a.wer
                           where a.firma_id=$1 order by a.zeit desc limit 50`, [id])).rows;
    return f;
  });
}

async function firmaAnlegen(user, d) {
  return alsNutzer(user.id, async (q) => {
    // E11 Dubletten-Wache
    const dub = await q(
      `select f.id, f.name, p.name as besitzer_name from firmen f left join profiles p on p.id=f.besitzer
        where ($1 <> '' and f.telefon = $1) or ($2 <> '' and f.website = $2) or lower(f.name) = lower($3) limit 1`,
      [d.telefon || "", d.website || "", d.name]);
    const { rows } = await q(
      `insert into firmen (name, status, branche, website, telefon, email, adresse, plz, ort, quelle, temperatur, score, argumente, stand, besitzer, tags)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
      [d.name, d.status || "lead", d.branche || null, d.website || null, d.telefon || null, d.email || null,
       d.adresse || null, d.plz || null, d.ort || null, d.quelle || "manuell", d.temperatur || "warm",
       d.score || null, d.argumente || null, d.stand || null, d.besitzer || user.id, d.tags || []]);
    const id = rows[0].id;
    await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'system',$3)`,
      [id, user.id, `Angelegt (Quelle: ${d.quelle || "manuell"})`]);
    return { id, dublette: dub.rows[0] || null };
  });
}

async function firmaAendern(user, id, felder) {
  const erlaubt = ["name","status","branche","website","telefon","email","adresse","plz","ort","temperatur","stand","besonderes","besitzer","wiedervorlage","verlust_grund","versuche"];
  const sets = [], a = [];
  for (const [k,v] of Object.entries(felder)) if (erlaubt.includes(k)) { a.push(v === "" ? null : v); sets.push(`${k} = $${a.length}`); }
  if (!sets.length) return;
  a.push(id);
  return alsNutzer(user.id, async (q) => {
    await q(`update firmen set ${sets.join(", ")}, letzte_aktivitaet = now() where id = $${a.length}`, a);
  });
}

// ---------------------------------------------------------------- Deals & Pipeline
async function dealsNachStufen(user, sparte, art = "vertrieb") {
  return alsNutzer(user.id, async (q) => {
    const st = (await q(`select * from pipeline_stages where sparte=$1 and art=$2 order by position`, [sparte, art])).rows;
    const { rows } = await q(
      `select d.*, f.name as firma_name, f.telefon, f.ort, p.name as besitzer_name
         from deals d join firmen f on f.id=d.firma_id left join profiles p on p.id=d.besitzer
        where d.sparte=$1 and d.status='offen' order by d.erstellt desc`, [sparte]);
    return st.map((s) => ({ ...s, deals: rows.filter((d) => d.stufe_id === s.id) }));
  });
}

async function dealAnlegen(user, d) {
  return alsNutzer(user.id, async (q) => {
    const st = (await q(`select id from pipeline_stages where sparte=$1 and art='vertrieb' order by position limit 1`, [d.sparte])).rows[0];
    const { rows } = await q(
      `insert into deals (firma_id, titel, sparte, stufe_id, wert, besitzer, erwartet_am)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [d.firma_id, d.titel, d.sparte, d.stufe_id || st?.id || null, d.wert || null, d.besitzer || user.id, d.erwartet_am || null]);
    await q(`insert into aktivitaeten (firma_id, deal_id, wer, art, text) values ($1,$2,$3,'system',$4)`,
      [d.firma_id, rows[0].id, user.id, `Deal angelegt: ${d.titel} (${d.sparte})`]);
    return rows[0].id;
  });
}

async function dealVerschieben(user, dealId, stufeId) {
  return alsNutzer(user.id, async (q) => {
    const alt = (await q(`select d.*, s.name as stufe_name, f.name as firma_name from deals d
                          left join pipeline_stages s on s.id=d.stufe_id join firmen f on f.id=d.firma_id
                          where d.id=$1`, [dealId])).rows[0];
    if (!alt) return false;
    const neu = (await q(`select * from pipeline_stages where id=$1`, [stufeId])).rows[0];
    await q(`update deals set stufe_id=$1 where id=$2`, [stufeId, dealId]);
    // Abschluss-Stufe erreicht -> Deal gewonnen, Firma wird Kunde
    if (neu?.ist_abschluss) {
      await q(`update deals set status='gewonnen', geschlossen_am=now() where id=$1`, [dealId]);
      await q(`update firmen set status='kunde', kunde_seit=coalesce(kunde_seit, current_date) where id=$1`, [alt.firma_id]);
      const pst = (await q(`select id from pipeline_stages where sparte=$1 and art='projekt' order by position limit 1`, [alt.sparte])).rows[0];
      await q(`insert into projekte (firma_id, deal_id, titel, sparte, stufe_id, besitzer) values ($1,$2,$3,$4,$5,$6)`,
        [alt.firma_id, dealId, alt.titel, alt.sparte, pst?.id || null, alt.besitzer]);
      await q(`insert into aktivitaeten (firma_id, deal_id, wer, art, text) values ($1,$2,$3,'stufenwechsel',$4)`,
        [alt.firma_id, dealId, user.id, `🎉 Gewonnen — Projekt angelegt`]);
    } else {
      await q(`insert into aktivitaeten (firma_id, deal_id, wer, art, text) values ($1,$2,$3,'stufenwechsel',$4)`,
        [alt.firma_id, dealId, user.id, `${alt.stufe_name || "?"} → ${neu?.name || "?"}`]);
    }
    await q(`update firmen set letzte_aktivitaet=now() where id=$1`, [alt.firma_id]);
    return true;
  });
}

async function dealVerlieren(user, dealId, grund) {
  return alsNutzer(user.id, async (q) => {
    const d = (await q(`select * from deals where id=$1`, [dealId])).rows[0];
    if (!d) return false;
    await q(`update deals set status='verloren', verlust_grund=$2, geschlossen_am=now() where id=$1`, [dealId, grund]);
    await q(`insert into aktivitaeten (firma_id, deal_id, wer, art, text) values ($1,$2,$3,'stufenwechsel',$4)`,
      [d.firma_id, dealId, user.id, `Verloren — Grund: ${grund}`]);
    return true;
  });
}

// ---------------------------------------------------------------- Aktivitäten & Call-Modus
async function notiz(user, firmaId, text, art = "notiz") {
  return alsNutzer(user.id, async (q) => {
    await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,$3,$4)`, [firmaId, user.id, art, text]);
    await q(`update firmen set letzte_aktivitaet=now() where id=$1`, [firmaId]);
  });
}

async function callErgebnis(user, firmaId, ausgang, extra = {}) {
  return alsNutzer(user.id, async (q) => {
    const f = (await q(`select * from firmen where id=$1`, [firmaId])).rows[0];
    if (!f) return false;
    if (ausgang === "termin") {
      await q(`update firmen set temperatur='heiss', wiedervorlage=null, letzte_aktivitaet=now() where id=$1`, [firmaId]);
      await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'anruf',$3)`,
        [firmaId, user.id, `Erstgespräch gebucht${extra.notiz ? " — " + extra.notiz : ""}`]);
    } else if (ausgang === "absage") {
      await q(`update firmen set status='verloren', verlust_grund=$2, temperatur='kalt', wiedervorlage=null, letzte_aktivitaet=now() where id=$1`,
        [firmaId, extra.grund || "kein Grund angegeben"]);
      await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'anruf',$3)`,
        [firmaId, user.id, `Absage — ${extra.grund || "?"}`]);
    } else if (ausgang === "nicht-erreicht") {
      await q(`update firmen set versuche = versuche + 1, letzte_aktivitaet=now() where id=$1`, [firmaId]);
      await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'anruf',$3)`,
        [firmaId, user.id, `Nicht erreicht (Versuch ${(f.versuche || 0) + 1})`]);
    } else if (ausgang === "spaeter") {
      await q(`update firmen set wiedervorlage=$2, letzte_aktivitaet=now() where id=$1`, [firmaId, extra.datum || null]);
      await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'anruf',$3)`,
        [firmaId, user.id, `Später anrufen: ${extra.datum || "?"}${extra.notiz ? " — " + extra.notiz : ""}`]);
    }
    return true;
  });
}

// ---------------------------------------------------------------- Kennzahlen
async function kennzahlen(user) {
  return alsNutzer(user.id, async (q) => {
    const z = async (sql, a = []) => Number((await q(sql, a)).rows[0]?.c || 0);
    return {
      leads: await z(`select count(*)::int c from firmen where status='lead'`),
      kunden: await z(`select count(*)::int c from firmen where status='kunde'`),
      offene_deals: await z(`select count(*)::int c from deals where status='offen'`),
      pipeline_wert: Number((await q(`select coalesce(sum(wert),0)::numeric c from deals where status='offen'`)).rows[0]?.c || 0),
      gewonnen_monat: await z(`select count(*)::int c from deals where status='gewonnen' and geschlossen_am >= date_trunc('month', current_date)`),
      umsatz_monat: Number((await q(`select coalesce(sum(wert),0)::numeric c from deals where status='gewonnen' and geschlossen_am >= date_trunc('month', current_date)`)).rows[0]?.c || 0),
      wiedervorlagen: await z(`select count(*)::int c from firmen where wiedervorlage <= current_date`),
      offene_aufgaben: await z(`select count(*)::int c from aufgaben where not erledigt`),
    };
  });
}

// Firmenweite Aggregate OHNE Nutzerkontext — fuer das zweite Gehirn (Chronik).
// Bewusst nur Zahlen, keine Kundendaten: Das Ergebnis darf in den Git-Vault,
// die Rohdaten (Namen, Deals) niemals (REGELN.md §DSGVO, .gitignore).
async function kennzahlenGesamt() {
  const z = async (sql) => Number((await system(sql)).rows[0]?.c || 0);
  return {
    leads: await z(`select count(*)::int c from public.firmen where status='lead'`),
    kunden: await z(`select count(*)::int c from public.firmen where status='kunde'`),
    offene_deals: await z(`select count(*)::int c from public.deals where status='offen'`),
    pipeline_wert: await z(`select coalesce(sum(wert),0)::numeric c from public.deals where status='offen'`),
    gewonnen_monat: await z(`select count(*)::int c from public.deals where status='gewonnen' and geschlossen_am >= date_trunc('month', current_date)`),
    umsatz_monat: await z(`select coalesce(sum(wert),0)::numeric c from public.deals where status='gewonnen' and geschlossen_am >= date_trunc('month', current_date)`),
    verloren_monat: await z(`select count(*)::int c from public.deals where status='verloren' and geschlossen_am >= date_trunc('month', current_date)`),
    neue_leads_heute: await z(`select count(*)::int c from public.firmen where status='lead' and erstellt::date = current_date`),
    wiedervorlagen: await z(`select count(*)::int c from public.firmen where wiedervorlage <= current_date`),
    offene_aufgaben: await z(`select count(*)::int c from public.aufgaben where not erledigt`),
  };
}

// Pro Person (intern — Teammitglieder, keine Kunden): Zahlen fuer die Chronik.
async function teamZahlenGesamt() {
  const { rows } = await system(
    `select p.name, p.rolle,
      (select count(*)::int from public.firmen f where f.besitzer=p.id and f.status='lead') as leads,
      (select count(*)::int from public.firmen f where f.besitzer=p.id and f.status='kunde') as kunden,
      (select count(*)::int from public.deals d where d.besitzer=p.id and d.status='offen') as offen,
      (select count(*)::int from public.deals d where d.besitzer=p.id and d.status='gewonnen') as gewonnen,
      (select coalesce(sum(d.wert),0)::numeric from public.deals d where d.besitzer=p.id and d.status='gewonnen'
         and d.geschlossen_am >= date_trunc('month', current_date)) as umsatz_monat,
      (select count(*)::int from public.aktivitaeten a where a.wer=p.id and a.art='anruf' and a.zeit::date = current_date) as anrufe_heute
     from public.profiles p where p.aktiv order by p.rolle, p.name`);
  return rows;
}

async function teamZahlen(user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select p.id, p.name, p.rolle,
        (select count(*)::int from firmen f where f.besitzer=p.id and f.status='lead') as leads,
        (select count(*)::int from firmen f where f.besitzer=p.id and f.status='kunde') as kunden,
        (select count(*)::int from deals d where d.besitzer=p.id and d.status='offen') as offen,
        (select count(*)::int from deals d where d.besitzer=p.id and d.status='gewonnen') as gewonnen,
        (select count(*)::int from deals d where d.besitzer=p.id and d.status='verloren') as verloren,
        (select coalesce(sum(d.wert),0)::numeric from deals d where d.besitzer=p.id and d.status='gewonnen'
           and d.geschlossen_am >= date_trunc('month', current_date)) as umsatz_monat,
        (select count(*)::int from aktivitaeten a where a.wer=p.id and a.art='anruf' and a.zeit::date = current_date) as anrufe_heute
       from profiles p where p.aktiv order by p.rolle, p.name`);
    return rows;
  });
}

module.exports = {
  pool, alsNutzer, system, anmelden, passwortAendern, stufen, team,
  firmenListe, firma, firmaAnlegen, firmaAendern,
  dealsNachStufen, dealAnlegen, dealVerschieben, dealVerlieren,
  notiz, callErgebnis, kennzahlen, teamZahlen, kennzahlenGesamt, teamZahlenGesamt,
};

// Gewonnene Deals (fuer den Umsatzverlauf im Dashboard)
module.exports.gewonneneDeals = async function (user, sparte) {
  return alsNutzer(user.id, async (q) => {
    const a = []; let w = "";
    if (sparte) { a.push(sparte); w = " and sparte = $1"; }
    const { rows } = await q(`select wert, geschlossen_am, sparte from deals
      where status='gewonnen' and geschlossen_am >= (current_date - interval '13 months')${w}`, a);
    return rows;
  });
};

// Abschlusszahlen fuer Forecast-Kennzahlen
module.exports.abschlussZahlen = async function (user, sparte) {
  return alsNutzer(user.id, async (q) => {
    const a = []; let w = "";
    if (sparte) { a.push(sparte); w = " and sparte = $1"; }
    const { rows } = await q(`select
      count(*) filter (where status='gewonnen')::int as gewonnen,
      count(*) filter (where status='verloren')::int as verloren,
      avg(extract(epoch from (geschlossen_am - erstellt))/86400) filter (where status='gewonnen') as dauer
      from deals where status in ('gewonnen','verloren')${w}`, a);
    return rows[0] || { gewonnen: 0, verloren: 0, dauer: null };
  });
};
