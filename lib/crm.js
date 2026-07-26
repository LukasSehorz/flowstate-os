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

// Die Datenbank laeuft in UTC, wir rechnen aber in unserer Zeit. Ohne das bezoege
// sich current_date auf den UTC-Tag: zwischen Mitternacht und 2 Uhr zeigte "heute"
// noch die Zahlen des Vortags, und ein Anruf um 23 Uhr zaehlte auf den Folgetag.
// Der Supabase-Pooler ignoriert die Verbindungsoption "options", darum setzen wir
// die Zone in jeder Sitzung selbst.
const ZONE = "Europe/Berlin";

// Fuehrt Abfragen im Namen eines Nutzers aus -> RLS aktiv
async function alsNutzer(userId, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local time zone '${ZONE}'`);
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

// Ohne Nutzerkontext (nur fuer Login-Pruefung und Systemaufgaben).
// Auch hier die Zeitzone setzen, sonst rechnen die Systemauswertungen in UTC.
async function system(sql, args = []) {
  const c = await pool.connect();
  try {
    await c.query(`set time zone '${ZONE}'`);
    return await c.query(sql, args);
  } finally {
    c.release();
  }
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
              (select count(*) from deals d where d.firma_id = f.id and d.status = 'offen') as offene_deals,
              -- Stufe des juengsten offenen Deals: zeigt, wo ein Lead im Vertrieb steht
              -- (Erstgespraech, Angebot ...). Sparte kommt vom juengsten Deal ueberhaupt.
              (select s.name from deals d join pipeline_stages s on s.id = d.stufe_id
                where d.firma_id = f.id and d.status = 'offen'
                order by d.erstellt desc limit 1) as stufe_name,
              (select d.sparte from deals d where d.firma_id = f.id
                order by d.erstellt desc limit 1) as haupt_sparte
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
  const erlaubt = ["name","status","branche","website","telefon","email","adresse","plz","ort","temperatur","stand","besonderes","besitzer","wiedervorlage","verlust_grund","versuche","score"];
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
    // Im Verkauf stehen Deals auf dem Brett, in der Projektabwicklung Projekte.
    // Beide liefern dieselben Felder, damit die Karte nur einmal gebaut werden muss.
    const kundenFelder = `f.name as firma_name, f.telefon, f.ort, p.name as besitzer_name,
              f.geschaeftsfuehrer, f.ansprech_rolle, f.quelle,
              f.preis_setup, f.preis_monatlich, f.vertrag_laufzeit, f.erfolgsbonus, f.erfolgsbonus_text,
              f.dringlichkeit, f.erstgespraech_am, f.faellig_am`;
    // sortierung = von Hand gezogene Reihenfolge in der Spalte. Karten, die noch nie
    // sortiert wurden (NULL), haengen sich nach Datum hinten an.
    const { rows } = art === "projekt"
      ? await q(
        `select pr.*, pr.deal_id, d.wert, ${kundenFelder}
           from projekte pr join firmen f on f.id = pr.firma_id
           left join profiles p on p.id = pr.besitzer
           left join deals d on d.id = pr.deal_id
          where pr.sparte = $1 and pr.status in ('laeuft','pausiert')
          order by pr.sortierung nulls last, pr.erstellt desc`, [sparte])
      : await q(
        `select d.*, ${kundenFelder}
           from deals d join firmen f on f.id=d.firma_id left join profiles p on p.id=d.besitzer
          where d.sparte=$1 and d.status='offen'
          order by d.sortierung nulls last, d.erstellt desc`, [sparte]);
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

// stufeId ODER stufeName. Der Name wird gebraucht, wenn im Gesamt-Board gezogen wird:
// dort sind gleichnamige Stufen der drei Bereiche zusammengelegt, also muss die Stufe
// in der Pipeline DIESES Deals gesucht werden. Gibt es sie dort nicht, schlaegt der
// Zug fehl statt still etwas Falsches zu speichern.
async function dealVerschieben(user, dealId, stufeId, stufeName) {
  return alsNutzer(user.id, async (q) => {
    const alt = (await q(`select d.*, s.name as stufe_name, f.name as firma_name from deals d
                          left join pipeline_stages s on s.id=d.stufe_id join firmen f on f.id=d.firma_id
                          where d.id=$1`, [dealId])).rows[0];
    if (!alt) return false;
    if (!stufeId && stufeName) {
      const treffer = (await q(
        `select id from pipeline_stages where sparte=$1 and art='vertrieb' and name=$2 limit 1`,
        [alt.sparte, stufeName])).rows[0];
      if (!treffer) return { ok: false, grund: "keine-stufe" };
      stufeId = treffer.id;
    }
    const neu = (await q(`select * from pipeline_stages where id=$1`, [stufeId])).rows[0];
    // Eine Karte darf nur in Phasen ihres eigenen Bereichs — sonst haengt der Deal
    // in einer fremden Pipeline und taucht auf keinem Brett mehr richtig auf.
    if (!neu || neu.sparte !== alt.sparte || neu.art !== "vertrieb") return { ok: false, grund: "keine-stufe" };
    await q(`update deals set stufe_id=$1 where id=$2`, [stufeId, dealId]);
    // Verlust-Stufe erreicht -> Deal geschlossen, Firma zaehlt als verloren.
    // Kunden bleiben Kunden: wer schon bei uns ist, wird durch einen geplatzten
    // Zusatz-Deal nicht zum verlorenen Lead.
    if (neu.ist_verlust) {
      await q(`update deals set status='verloren', geschlossen_am=now(),
               verlust_grund=coalesce(verlust_grund, 'Im Vertrieb verloren') where id=$1`, [dealId]);
      await q(`update firmen set status='verloren', temperatur='kalt', wiedervorlage=null
                where id=$1 and status <> 'kunde'`, [alt.firma_id]);
      await q(`insert into aktivitaeten (firma_id, deal_id, wer, art, text) values ($1,$2,$3,'stufenwechsel',$4)`,
        [alt.firma_id, dealId, user.id, `Verloren — ${alt.stufe_name || "?"} war die letzte Phase`]);
      await q(`update firmen set letzte_aktivitaet=now() where id=$1`, [alt.firma_id]);
      return { ok: true, gewonnen: false, verloren: true, geschlossen: true };
    }
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
    return { ok: true, gewonnen: !!neu?.ist_abschluss, geschlossen: !!neu?.ist_abschluss };
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
      verloren_monat: await z(`select count(*)::int c from deals where status='verloren' and geschlossen_am >= date_trunc('month', current_date)`),
      verloren_wert_monat: Number((await q(`select coalesce(sum(wert),0)::numeric c from deals where status='verloren' and geschlossen_am >= date_trunc('month', current_date)`)).rows[0]?.c || 0),
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

async function teamZahlen(user, sparte = "") {
  return alsNutzer(user.id, async (q) => {
    // Optionaler Sparte-Filter auf die Deal-Unterabfragen (Leads/Kunden sind firmengebunden
    // und daher sparte-neutral). $1 = sparte, nur gesetzt wenn eine Sparte gewaehlt ist.
    const sp = sparte ? " and d.sparte = $1" : "";
    const a = sparte ? [sparte] : [];
    const { rows } = await q(
      `select p.id, p.name, p.rolle,
        (select count(*)::int from firmen f where f.besitzer=p.id and f.status='lead') as leads,
        (select count(*)::int from firmen f where f.besitzer=p.id and f.status='kunde') as kunden,
        (select count(*)::int from deals d where d.besitzer=p.id and d.status='offen'${sp}) as offen,
        (select count(*)::int from deals d where d.besitzer=p.id and d.status='gewonnen'${sp}) as gewonnen,
        (select count(*)::int from deals d where d.besitzer=p.id and d.status='verloren'${sp}) as verloren,
        (select coalesce(sum(d.wert),0)::numeric from deals d where d.besitzer=p.id and d.status='gewonnen'
           and d.geschlossen_am >= date_trunc('month', current_date)${sp}) as umsatz_monat,
        (select count(*)::int from aktivitaeten a where a.wer=p.id and a.art='anruf' and a.zeit::date = current_date) as anrufe_heute
       from profiles p where p.aktiv order by p.rolle, p.name`, a);
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

// Ergebnis eines Cold Calls speichern. Setzt das Listen-Tag (damit der Lead in der
// richtigen Unterliste auftaucht), schreibt die Aktivitaet mit sauberem "ergebnis"
// (Grundlage der Anruf-Statistik) und legt bei "gebucht" den Deal in der Pipeline an.
const ANRUF_TAGS = ["gebucht", "absage", "nicht-erreicht", "keine-zeit"];
module.exports.anrufSpeichern = async function (user, firmaId, ergebnis, extra = {}) {
  if (ergebnis !== "" && !ANRUF_TAGS.includes(ergebnis)) throw new Error("Unbekanntes Ergebnis: " + ergebnis);
  return alsNutzer(user.id, async (q) => {
    const f = (await q(`select * from firmen where id=$1`, [firmaId])).rows[0];
    if (!f) return { ok: false };

    // Altes Listen-Tag entfernen, neues setzen — ein Lead steht in genau einer Liste.
    await q(
      `update firmen set tags = (
         select coalesce(array_agg(t), '{}'::text[]) from unnest(tags) t where not (t = any($2::text[]))
       ) || case when $3 = '' then '{}'::text[] else array[$3]::text[] end,
       letzte_aktivitaet = now() where id = $1`,
      [firmaId, ANRUF_TAGS, ergebnis]);

    // Zurueck auf "offen": Lead entwerten und alles vom Anruf zuruecksetzen.
    if (ergebnis === "") {
      await q(`update firmen set status='lead', verlust_grund=null, anruf_notiz=null,
               temperatur='warm', wiedervorlage=null where id=$1`, [firmaId]);
      await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'anruf',$3)`,
        [firmaId, user.id, "Ergebnis zurückgesetzt auf offen"]);
      return { ok: true, dealId: null };
    }

    let text = "", dealId = null;
    if (ergebnis === "gebucht") {
      await q(`update firmen set temperatur='heiss', wiedervorlage=null where id=$1`, [firmaId]);
      // Sparte aus den Tags des Leads; ohne Tag als Rueckfall Webdesign.
      const sparte = (f.tags || []).find((t) => ["webdesign", "performance", "ki"].includes(t)) || "webdesign";
      // Erstgespraech-Stufe der Sparte (bei KI heisst sie "Readiness-Check gebucht").
      const st = (await q(
        `select id from pipeline_stages where sparte=$1 and art='vertrieb'
         order by (case when name ilike 'Erstgespräch%' or name ilike 'Readiness%' then 0 else 1 end), position
         limit 1`, [sparte])).rows[0];
      const d = (await q(
        `insert into deals (firma_id, titel, sparte, stufe_id, besitzer) values ($1,$2,$3,$4,$5) returning id`,
        [firmaId, `Erstgespräch ${f.name}`, sparte, st?.id || null, user.id])).rows[0];
      dealId = d.id;
      await q(`update firmen set status='lead', anruf_notiz=$2, verlust_grund=null where id=$1`, [firmaId, extra.notiz || null]);
      text = `Erstgespräch gebucht${extra.notiz ? " — " + extra.notiz : ""}`;
    } else if (ergebnis === "absage") {
      await q(`update firmen set status='verloren', verlust_grund=$2, anruf_notiz=null, temperatur='kalt', wiedervorlage=null where id=$1`,
        [firmaId, extra.grund || "kein Grund angegeben"]);
      text = `Absage — ${extra.grund || "kein Grund angegeben"}`;
    } else if (ergebnis === "nicht-erreicht") {
      await q(`update firmen set status='lead', versuche = versuche + 1, verlust_grund=null, anruf_notiz=null where id=$1`, [firmaId]);
      text = `Nicht erreicht (Versuch ${(f.versuche || 0) + 1})`;
    } else {
      await q(`update firmen set status='lead', wiedervorlage=$2, anruf_notiz=$3, verlust_grund=null where id=$1`,
        [firmaId, extra.datum || null, extra.notiz || null]);
      text = `Später nochmal${extra.notiz ? " — " + extra.notiz : ""}`;
    }

    await q(`insert into aktivitaeten (firma_id, deal_id, wer, art, text, ergebnis)
             values ($1,$2,$3,'anruf',$4,$5)`, [firmaId, dealId, user.id, text, ergebnis]);
    return { ok: true, dealId };
  });
};

// Anruf-Statistik fuer die Cold-Calling-Liste: gesamt, heute und die Zahl der Tage,
// an denen ueberhaupt telefoniert wurde (Grundlage fuer den Tagesdurchschnitt).
module.exports.anrufStatistik = async function (user, { sparte = "", branche = "", ohneSparte = false } = {}) {
  return alsNutzer(user.id, async (q) => {
    // Ein Lead = ein Call. Gezaehlt wird der AKTUELLE Stand des Leads (Tag), nicht
    // jeder Eintrag im Verlauf — wer ein Ergebnis korrigiert, erzeugt keinen zweiten
    // Anruf. Das Datum kommt vom letzten Anruf zu diesem Lead.
    // Leads ohne Sparten-Tag zaehlen zur Standard-Sparte, sonst waeren sie unsichtbar.
    const wo = `($1 = '' or f.tags @> array[$1]::text[]
               or ($3 and not (f.tags && array['webdesign','performance','ki']::text[])))
          and ($2 = '' or f.tags @> array[$2]::text[])`;
    const a = [sparte, branche, ohneSparte];
    const basis = `
      select (select t2 from unnest(f.tags) as t2
                where t2 = any(array['gebucht','absage','nicht-erreicht','keine-zeit']::text[]) limit 1) as stand,
             (select max(k.zeit) from aktivitaeten k where k.firma_id = f.id and k.art = 'anruf') as letzter
        from firmen f where ${wo}`;
    const { rows } = await q(
      `select stand as ergebnis, count(*)::int as gesamt,
              count(*) filter (where letzter::date = current_date)::int as heute
         from (${basis}) t where stand is not null group by stand`, a);
    const { rows: t } = await q(
      `select count(distinct letzter::date)::int as tage
         from (${basis}) t where stand is not null`, a);
    const nach = {};
    rows.forEach((r) => { nach[r.ergebnis] = { gesamt: r.gesamt, heute: r.heute }; });
    return { nach, tage: t[0]?.tage || 0 };
  });
};

// Kundendaten pflegen: Quelle, Verantwortlich, Preise, Leistungen, Kontaktkanaele.
// Die Retainer-Markierung wird NICHT von Hand gesetzt, sondern ergibt sich aus dem
// monatlichen Preis — wer monatlich zahlt, ist Retainer-Kunde.
module.exports.kundeAendern = async function (user, id, d) {
  return alsNutzer(user.id, async (q) => {
    const sets = [], a = [];
    const setz = (spalte, wert) => { a.push(wert); sets.push(`${spalte} = $${a.length}`); };
    const zahl = (v) => (v === "" || v === undefined || v === null ? null : Number(v));
    if (d.quelle !== undefined) setz("quelle", d.quelle || null);
    if (d.besitzer) setz("besitzer", d.besitzer);
    // Uebergabe an jemand anderen: die OFFENEN Deals wandern mit, sonst haengt der
    // Lead in der Pipeline weiter beim alten Verantwortlichen. Abgeschlossene Deals
    // bleiben bei dem, der sie geholt hat — sonst stimmt der Umsatz je Person nicht mehr.
    if (d.besitzer) {
      // Direkt gegen den Deal-Besitzer pruefen — nicht gegen den der Firma. Sonst
      // bleibt der Deal haengen, wenn Firma und Deal unterschiedliche Besitzer haben.
      const { rows: bewegt } = await q(
        `update deals set besitzer = $2
          where firma_id = $1 and status = 'offen' and besitzer is distinct from $2
          returning id`, [id, d.besitzer]);
      if (bewegt.length) {
        const wer = (await q(`select name from profiles where id=$1`, [d.besitzer])).rows[0];
        await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'uebergabe',$3)`,
          [id, user.id, `Übergeben an ${wer?.name || "jemand anderen"} — ${bewegt.length} offene${bewegt.length === 1 ? "r Deal" : " Deals"} mitgewandert`]);
      }
    }
    if (d.kunde_seit !== undefined) setz("kunde_seit", d.kunde_seit || null);
    if (d.ansprech_name !== undefined) setz("geschaeftsfuehrer", d.ansprech_name || null);
    if (d.ansprech_rolle !== undefined) setz("ansprech_rolle", d.ansprech_rolle || null);
    if (d.geschlecht !== undefined) setz("geschlecht", d.geschlecht || null);
    if (d.taetigkeit !== undefined) setz("taetigkeit", d.taetigkeit || null);
    if (d.mitarbeiter_zahl !== undefined) setz("mitarbeiter_zahl", zahl(d.mitarbeiter_zahl));
    if (d.vertrag_laufzeit !== undefined) setz("vertrag_laufzeit", d.vertrag_laufzeit || null);
    if (d.hosting !== undefined) setz("hosting", d.hosting === "" ? null : d.hosting === "ja");
    if (d.leads_ziel !== undefined) setz("leads_ziel", zahl(d.leads_ziel));
    if (d.leads_ist !== undefined) setz("leads_ist", zahl(d.leads_ist));
    if (d.telefon !== undefined) setz("telefon", d.telefon || null);
    if (d.email !== undefined) setz("email", d.email || null);
    if (d.website !== undefined) setz("website", d.website || null);
    if (d.ort !== undefined) setz("ort", d.ort || null);
    if (d.projekt_stand !== undefined) setz("projekt_stand", d.projekt_stand || null);
    if (d.rechnung_stand !== undefined) setz("rechnung_stand", d.rechnung_stand || null);
    if (d.erfolgsbonus !== undefined) {
      setz("erfolgsbonus", d.erfolgsbonus === "" ? null : d.erfolgsbonus === "ja");
    }
    if (d.erfolgsbonus_text !== undefined) setz("erfolgsbonus_text", d.erfolgsbonus_text || null);
    if (d.vertrag_unterschrieben !== undefined) {
      setz("vertrag_unterschrieben", d.vertrag_unterschrieben === "" ? null : d.vertrag_unterschrieben === "ja");
    }
    if (d.preis_setup !== undefined) setz("preis_setup", zahl(d.preis_setup));
    if (d.preis_monatlich !== undefined) setz("preis_monatlich", zahl(d.preis_monatlich));
    if (d.leistungen !== undefined) setz("leistungen", d.leistungen || []);
    if (d.kontakt_kanaele !== undefined) setz("kontakt_kanaele", d.kontakt_kanaele || []);
    if (d.dringlichkeit !== undefined) setz("dringlichkeit", d.dringlichkeit || null);
    if (d.erstgespraech_am !== undefined) setz("erstgespraech_am", d.erstgespraech_am || null);
    if (d.faellig_am !== undefined) setz("faellig_am", d.faellig_am || null);
    if (d.naechster_termin !== undefined) setz("naechster_termin", d.naechster_termin || null);
    if (d.naechste_aufgabe !== undefined) setz("naechste_aufgabe", d.naechste_aufgabe || null);
    if (sets.length) {
      a.push(id);
      await q(`update firmen set ${sets.join(", ")}, letzte_aktivitaet = now() where id = $${a.length}`, a);
    }
    // Bereich (Sparte) als Tag setzen — davon haengen die Leistungen ab.
    if (d.sparte !== undefined && ["webdesign", "performance", "ki"].includes(d.sparte)) {
      await q(
        `update firmen set tags = (
           select coalesce(array_agg(t), '{}'::text[]) from unnest(tags) t
            where not (t = any(array['webdesign','performance','ki']::text[]))
         ) || array[$2]::text[] where id = $1`, [id, d.sparte]);
      // Offene Deals wandern mit in die Pipeline der neuen Sparte — auf die Stufe mit
      // der aehnlichsten Position, damit der Fortschritt nicht verloren geht.
      await q(
        `update deals d set sparte = $2, stufe_id = (
           select ns.id from pipeline_stages ns
            where ns.sparte = $2 and ns.art = 'vertrieb'
            order by abs(ns.position - coalesce(
              (select s.position from pipeline_stages s where s.id = d.stufe_id), 1))
            limit 1)
         where d.firma_id = $1 and d.status = 'offen'`, [id, d.sparte]);
    }
    // Retainer-Tag aus dem monatlichen Preis ableiten
    if (d.preis_monatlich !== undefined) {
      const monatlich = zahl(d.preis_monatlich);
      await q(
        `update firmen set tags = (
           select coalesce(array_agg(t), '{}'::text[]) from unnest(tags) t where t <> 'retainer'
         ) || case when $2::numeric > 0 then array['retainer']::text[] else '{}'::text[] end
         where id = $1`, [id, monatlich]);
    }
    return true;
  });
};

// Leadakte anlegen: der Lead startet im Vertrieb auf der ersten Stufe ("Neu",
// 10 % Wahrscheinlichkeit) und taucht damit unter Kunden -> Lead auf.
module.exports.leadakteAnlegen = async function (user, id, sparte) {
  const sp = ["webdesign", "performance", "ki"].includes(sparte) ? sparte : "webdesign";
  return alsNutzer(user.id, async (q) => {
    const f = (await q(`select name, status from firmen where id=$1`, [id])).rows[0];
    if (!f) return { ok: false };
    const da = (await q(`select id from deals where firma_id=$1 limit 1`, [id])).rows[0];
    if (da) return { ok: false, grund: "hat schon einen Deal" };
    const st = (await q(
      `select id from pipeline_stages where sparte=$1 and art='vertrieb' order by position limit 1`, [sp])).rows[0];
    const d = (await q(
      `insert into deals (firma_id, titel, sparte, stufe_id, besitzer) values ($1,$2,$3,$4,$5) returning id`,
      [id, f.name, sp, st?.id || null, user.id])).rows[0];
    // Sparten-Tag setzen, damit Filter und Leistungen sofort passen.
    await q(`update firmen set status='lead', tags = (
               select coalesce(array_agg(t),'{}'::text[]) from unnest(tags) t
                where not (t = any(array['webdesign','performance','ki']::text[]))
             ) || array[$2]::text[], letzte_aktivitaet=now() where id=$1`, [id, sp]);
    await q(`insert into aktivitaeten (firma_id, deal_id, wer, art, text) values ($1,$2,$3,'system',$4)`,
      [id, d.id, user.id, `Leadakte angelegt — startet in ${sp} auf Stufe Neu`]);
    return { ok: true, dealId: d.id };
  });
};

// ---------------------------------------------------------------- Team-Leistung
//
// "Hat das Erstgespräch erreicht": die Firma hat einen Deal, der mindestens auf der
// Erstgesprächs-Stufe seines Bereichs steht (bei KI heisst sie Readiness-Check).
// Gewonnene und verlorene Deals stehen weiter hinten und zaehlen darum mit.
//
// Bewusst ueber den heutigen Stand der Firma gerechnet und nicht ueber das
// Anruf-Protokoll: aktivitaeten hat keine UPDATE-Regel, alte Eintraege tragen
// darum kein Ergebnis. Der Stand der Firma stimmt dagegen immer.
const ERSTGESPRAECH_ERREICHT = (firmaAlias) => `exists (
  select 1 from deals dd
    join pipeline_stages ss on ss.id = dd.stufe_id
    join pipeline_stages eg on eg.sparte = dd.sparte and eg.art = 'vertrieb'
         and eg.name in ('Erstgespräch', 'Readiness-Check gebucht')
   where dd.firma_id = ${firmaAlias}.id and ss.position >= eg.position)`;

// seitSql ist ein fester SQL-Ausdruck aus einer Whitelist im Routen-Modul
// (z. B. "date_trunc('month', current_date)") oder null fuer "insgesamt".
module.exports.teamLeistung = async function (user, seitSql) {
  const seit = (spalte) => (seitSql ? ` and ${spalte} >= ${seitSql}` : "");
  return alsNutzer(user.id, async (q) => {
    // Je Person: Umsatz aus gewonnenen Deals, angerufene Leads und was aus ihnen wurde.
    // Die Kohorte richtet sich nach dem Anrufdatum — wir fragen also: was ist aus den
    // Anrufen DIESES Zeitraums geworden?
    const angerufenVon = `exists (select 1 from aktivitaeten a
       where a.firma_id = f.id and a.art = 'anruf' and a.wer = p.id${seit("a.zeit")})`;
    const { rows: personen } = await q(
      `select p.id, p.name, p.rolle,
        (select coalesce(sum(d.wert), 0)::numeric from deals d
          where d.besitzer = p.id and d.status = 'gewonnen'${seit("d.geschlossen_am")}) as umsatz,
        (select count(*)::int from deals d
          where d.besitzer = p.id and d.status = 'gewonnen'${seit("d.geschlossen_am")}) as gewonnen,
        (select count(distinct a.firma_id)::int from aktivitaeten a
          where a.wer = p.id and a.art = 'anruf'${seit("a.zeit")}) as angerufen,
        (select count(*)::int from firmen f
          where ${angerufenVon} and ${ERSTGESPRAECH_ERREICHT("f")}) as anruf_erstgespraech,
        (select count(*)::int from firmen f
          where ${angerufenVon} and f.status = 'kunde') as anruf_kunde
       from profiles p where p.aktiv order by p.rolle, p.name`);

    // Je Lead-Quelle: wie viele Leads kamen herein und wie weit sind sie gekommen.
    // Kohorte nach Anlagedatum des Leads. Leads ohne Quelle und die Alt-Quelle
    // "lead-maschine" bleiben draussen — sie sagen nichts ueber Quellen-Qualitaet
    // und wuerden den Vergleich nur verzerren.
    const { rows: quellen } = await q(
      `select f.quelle,
              count(*)::int as leads,
              count(*) filter (where ${ERSTGESPRAECH_ERREICHT("f")})::int as zu_erstgespraech,
              count(*) filter (where f.status = 'kunde')::int as zu_kunde
         from firmen f
        where f.quelle is not null and f.quelle <> '' and f.quelle <> 'lead-maschine'
          ${seit("f.erstellt")}
        group by 1 order by 2 desc, 1`);
    return { personen, quellen };
  });
};

// Tageswerte fuer die Team-Tabelle. Alles bezieht sich auf HEUTE.
//   cold_calls   angerufene Leads
//   eg_gebucht   heute vereinbarte Erstgespräche (Deal auf der Erstgesprächs-Stufe entstanden)
//   eg_gefuehrt  Gespräche, deren Termin auf heute faellt
//   gewonnen     heute gewonnene Deals
//   umsatz       deren Wert
module.exports.teamHeute = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select p.id, p.name, p.rolle, p.aufgaben, p.bereiche, p.kategorien,
        (select count(distinct a.firma_id)::int from aktivitaeten a
          where a.wer = p.id and a.art = 'anruf' and a.zeit::date = current_date) as cold_calls,
        (select count(*)::int from deals d
           join pipeline_stages s on s.id = d.stufe_id
          where d.besitzer = p.id and d.erstellt::date = current_date
            and s.name in ('Erstgespräch', 'Readiness-Check gebucht')) as eg_gebucht,
        (select count(*)::int from firmen f
          where f.besitzer = p.id and f.erstgespraech_am = current_date) as eg_gefuehrt,
        (select count(*)::int from deals d
          where d.besitzer = p.id and d.status = 'gewonnen'
            and d.geschlossen_am::date = current_date) as gewonnen_heute,
        (select coalesce(sum(d.wert), 0)::numeric from deals d
          where d.besitzer = p.id and d.status = 'gewonnen'
            and d.geschlossen_am::date = current_date) as umsatz_heute
       from profiles p where p.aktiv order by p.rolle, p.name`);
    return rows;
  });
};

// Alles, was eine einzelne Person betrifft — fuer die Personenseite.
// seitSql kommt aus einer festen Liste im Routen-Modul (nie aus der Adresszeile).
module.exports.personLeistung = async function (user, personId, seitSql) {
  const seit = (spalte) => (seitSql ? ` and ${spalte} >= ${seitSql}` : "");
  return alsNutzer(user.id, async (q) => {
    const angerufen = `exists (select 1 from aktivitaeten a
       where a.firma_id = f.id and a.art = 'anruf' and a.wer = $1${seit("a.zeit")})`;
    const { rows } = await q(
      `select
        (select count(distinct a.firma_id)::int from aktivitaeten a
          where a.wer = $1 and a.art = 'anruf'${seit("a.zeit")}) as calls,
        -- An wie vielen Tagen wurde ueberhaupt telefoniert? Nur so ist ein
        -- Tagesdurchschnitt ehrlich — Urlaubs- und Wochenendtage zaehlen nicht mit.
        (select count(distinct a.zeit::date)::int from aktivitaeten a
          where a.wer = $1 and a.art = 'anruf'${seit("a.zeit")}) as call_tage,
        (select count(*)::int from firmen f
          where ${angerufen} and ${ERSTGESPRAECH_ERREICHT("f")}) as eg,
        (select count(*)::int from firmen f
          where ${angerufen} and f.status = 'kunde') as kunden,
        (select count(*)::int from deals d
          where d.besitzer = $1 and d.status = 'gewonnen'${seit("d.geschlossen_am")}) as gewonnen,
        (select count(*)::int from deals d
          where d.besitzer = $1 and d.status = 'verloren'${seit("d.geschlossen_am")}) as verloren,
        (select coalesce(sum(d.wert), 0)::numeric from deals d
          where d.besitzer = $1 and d.status = 'gewonnen'${seit("d.geschlossen_am")}) as umsatz,
        (select count(*)::int from aufgaben t
          where t.besitzer = $1 and t.erledigt${seit("t.erstellt")}) as todos_erledigt,
        (select count(*)::int from aufgaben t
          where t.besitzer = $1 and not t.erledigt) as todos_offen,
        (select coalesce(sum(${ZEIT_GESAMT()}), 0)::bigint from zeiterfassung z
          where z.nutzer_id = $1${seit("z.datum")}) as zeit_sekunden,
        (select count(*)::int from zeiterfassung z
          where z.nutzer_id = $1 and ${ZEIT_GESAMT()} > 0${seit("z.datum")}) as zeit_tage
      `, [personId]);
    return rows[0];
  });
};

// Was diese Person offen in der Pipeline hat und woran ihre Deals scheitern.
// Beides ist zeitraumunabhaengig: der Bestand ist der Stand von jetzt, die
// Verlustgruende sammeln wir ueber alles, sonst sind es zu wenige fuer ein Muster.
module.exports.personBestand = async function (user, personId) {
  return alsNutzer(user.id, async (q) => {
    const { rows: stufen } = await q(
      `select s.name, s.sparte, count(*)::int as anzahl,
              coalesce(sum(d.wert), 0)::numeric as wert
         from deals d join pipeline_stages s on s.id = d.stufe_id
        where d.besitzer = $1 and d.status = 'offen'
        group by s.name, s.sparte, s.position order by s.position, s.name`, [personId]);
    const { rows: gruende } = await q(
      `select coalesce(nullif(d.verlust_grund, ''), 'Ohne Angabe') as grund, count(*)::int as anzahl
         from deals d where d.besitzer = $1 and d.status = 'verloren'
        group by 1 order by 2 desc, 1 limit 6`, [personId]);
    const { rows: [summe] } = await q(
      `select count(*)::int as anzahl, coalesce(sum(d.wert), 0)::numeric as wert
         from deals d where d.besitzer = $1 and d.status = 'offen'`, [personId]);
    return { stufen, gruende, offen: summe };
  });
};

// Arbeitszeit als Balkenreihe. raster = "tag" (ein Balken je Tag) oder "monat".
module.exports.zeitVerlauf = async function (user, personId, seitSql, raster = "tag") {
  const stufe = raster === "monat" ? "month" : "day";
  const seit = seitSql ? ` and z.datum >= ${seitSql}` : "";
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select date_trunc('${stufe}', z.datum)::date as punkt,
              sum(${ZEIT_GESAMT()})::bigint as sekunden
         from zeiterfassung z
        where z.nutzer_id = $1${seit}
        group by 1 order by 1`, [personId]);
    return rows.map((r) => ({ punkt: r.punkt, sekunden: Number(r.sekunden) }));
  });
};

// Reihenfolge innerhalb einer Kanban-Spalte festhalten. "ids" ist die Spalte von
// oben nach unten, so wie sie nach dem Ziehen im Browser steht. Wir schreiben den
// Platz als Zahl zurueck (0, 1, 2 …), damit die Spalte beim naechsten Laden genauso
// aussieht. Nur Karten dieser Spalte werden angefasst — der Rest bleibt unberuehrt.
module.exports.kartenSortieren = async function (user, art, ids) {
  const tabelle = art === "projekt" ? "projekte" : "deals";
  // ids kommen als Text aus dem Browser, die Spalten sind bigint — darum der Cast.
  const liste = (Array.isArray(ids) ? ids : [])
    .map((x) => String(x)).filter((x) => /^\d+$/.test(x));
  if (!liste.length) return { ok: true, anzahl: 0 };
  return alsNutzer(user.id, async (q) => {
    await q(
      `update ${tabelle} z set sortierung = v.platz
         from (select unnest($1::bigint[]) as id, generate_subscripts($1::bigint[], 1) as platz) v
        where z.id = v.id`, [liste]);
    return { ok: true, anzahl: liste.length };
  });
};

// Projekt auf eine andere Phase ziehen. Die letzte Phase schliesst das Projekt ab.
module.exports.projektVerschieben = async function (user, projektId, stufeId, stufeName) {
  return alsNutzer(user.id, async (q) => {
    const alt = (await q(
      `select pr.*, s.name as stufe_name from projekte pr
       left join pipeline_stages s on s.id = pr.stufe_id where pr.id = $1`, [projektId])).rows[0];
    if (!alt) return false;
    if (!stufeId && stufeName) {
      const treffer = (await q(
        `select id from pipeline_stages where sparte=$1 and art='projekt' and name=$2 limit 1`,
        [alt.sparte, stufeName])).rows[0];
      if (!treffer) return { ok: false, grund: "keine-stufe" };
      stufeId = treffer.id;
    }
    const neu = (await q(`select * from pipeline_stages where id=$1`, [stufeId])).rows[0];
    if (!neu || neu.sparte !== alt.sparte || neu.art !== "projekt") return { ok: false, grund: "keine-stufe" };
    await q(`update projekte set stufe_id=$1${neu.ist_abschluss ? ", status='fertig'" : ""} where id=$2`,
      [stufeId, projektId]);
    await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'stufenwechsel',$3)`,
      [alt.firma_id, user.id, neu?.ist_abschluss
        ? `✅ Projekt fertig — ${alt.titel}`
        : `Projekt: ${alt.stufe_name || "?"} → ${neu?.name || "?"}`]);
    await q(`update firmen set letzte_aktivitaet=now() where id=$1`, [alt.firma_id]);
    return { ok: true, gewonnen: !!neu?.ist_abschluss };
  });
};

// Aus einem Lead einen Kunden machen. "Kunde seit" wird einmalig gesetzt und ist
// danach fest — deshalb passiert das genau hier und nirgends sonst.
module.exports.zuKundeMachen = async function (user, id, kundeSeit) {
  return alsNutzer(user.id, async (q) => {
    const f = (await q(`select status, name from firmen where id=$1`, [id])).rows[0];
    if (!f || f.status === "kunde") return { ok: false };
    await q(`update firmen set status='kunde', kunde_seit=coalesce($2::date, current_date),
             temperatur='heiss', wiedervorlage=null, verlust_grund=null,
             tags = (select coalesce(array_agg(t),'{}'::text[]) from unnest(tags) t
                      where not (t = any(array['gebucht','absage','nicht-erreicht','keine-zeit']::text[]))),
             letzte_aktivitaet=now() where id=$1`, [id, kundeSeit || null]);
    await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'system',$3)`,
      [id, user.id, "Kundenakte angelegt — aus Lead wurde Kunde"]);
    return { ok: true };
  });
};

// Was wir fuer den Kunden umgesetzt haben — freie Liste, Eintrag ergaenzen/entfernen.
module.exports.umgesetztAendern = async function (user, id, { hinzu = "", weg = "" } = {}) {
  return alsNutzer(user.id, async (q) => {
    if (hinzu.trim()) {
      await q(`update firmen set umgesetzt = coalesce(umgesetzt,'{}'::text[]) || array[$2]::text[],
               letzte_aktivitaet = now() where id = $1 and not (coalesce(umgesetzt,'{}'::text[]) @> array[$2]::text[])`,
        [id, hinzu.trim()]);
    }
    if (weg) {
      await q(`update firmen set umgesetzt = (
                 select coalesce(array_agg(t), '{}'::text[]) from unnest(umgesetzt) t where t <> $2
               ), letzte_aktivitaet = now() where id = $1`, [id, weg]);
    }
    return true;
  });
};

// Leads fuer die Cold-Calling-Liste anlegen (einzeln oder als Liste auf einmal).
// sparte + branche werden als Tags gesetzt, damit Reiter und Filter sofort greifen.
// Dubletten (gleicher Name oder gleiche Telefonnummer) werden uebersprungen.
module.exports.leadsAnlegen = async function (user, leads, { sparte = "", branche = "" } = {}) {
  return alsNutzer(user.id, async (q) => {
    let angelegt = 0; const uebersprungen = [];
    for (const l of leads) {
      const name = (l.name || "").trim();
      if (!name) continue;
      const tel = (l.telefon || "").trim();
      const da = (await q(
        `select id from firmen where lower(name) = lower($1) or ($2 <> '' and telefon = $2) limit 1`,
        [name, tel])).rows[0];
      if (da) { uebersprungen.push(name); continue; }
      const tags = [sparte, branche].filter(Boolean);
      await q(
        `insert into firmen (name, status, branche, ort, telefon, website, geschaeftsfuehrer, quelle, tags, besitzer)
         values ($1,'lead',$2,$3,$4,$5,$6,'cold-call',$7,$8)`,
        [name, (l.branche || "").trim() || null, (l.ort || "").trim() || null,
         tel || null, (l.website || "").trim() || null, (l.chef || "").trim() || null,
         tags, user.id]);
      angelegt++;
    }
    return { angelegt, uebersprungen };
  });
};

// Branche eines Leads setzen. Die Branche haengt als Tag an der Firma — beim Setzen
// wird das alte Branchen-Tag entfernt und das neue gesetzt (leer = Branche loeschen).
module.exports.leadBranche = async function (user, id, branche, alleBranchen) {
  return alsNutzer(user.id, async (q) => {
    await q(
      `update firmen set tags = (
         select coalesce(array_agg(t), '{}'::text[]) from unnest(tags) t where not (t = any($2::text[]))
       ) || case when $3 = '' then '{}'::text[] else array[$3]::text[] end,
       letzte_aktivitaet = now()
       where id = $1`, [id, alleBranchen, branche]);
  });
};

// Verlorene Deals (fuer "Gescheiterte Deals", optional je Sparte) — spiegelt gewonneneDeals.
module.exports.verloreneDeals = async function (user, sparte) {
  return alsNutzer(user.id, async (q) => {
    const a = []; let w = "";
    if (sparte) { a.push(sparte); w = " and sparte = $1"; }
    const { rows } = await q(`select wert, geschlossen_am, sparte from deals
      where status='verloren' and geschlossen_am >= (current_date - interval '13 months')${w}`, a);
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

// ---------------------------------------------------------------- Zeiterfassung
//
// Stoppuhr im Header: eine Zeile pro Person und Tag.
//
//   sekunden     Summe der abgeschlossenen Abschnitte
//   laeuft_seit  Beginn des laufenden Abschnitts, NULL wenn die Uhr steht
//
// Die angezeigte Zeit ist sekunden + (jetzt - laeuft_seit). Sie ergibt sich also
// aus der Uhr, nicht aus der Bedienung: Ob jemand tippt, telefoniert oder den
// Laptop zuklappt, aendert nichts. Angehalten wird nur auf Ansage — Pause,
// Abmelden, Feierabend. Siehe Migration 0026, dort steht auch, was vorher
// schiefging.
//
// Der Herzschlag aus dem Header schreibt seit 0026 nichts mehr fort; er holt nur
// den aktuellen Stand ab, damit zwei offene Tabs dasselbe anzeigen.

// Fuer Auswertungen: der laufende Abschnitt steckt noch nicht in "sekunden".
// Wer heutige Arbeitszeit summiert, muss ihn dazurechnen, sonst steht die Zahl
// still, solange jemand arbeitet. z = Alias der zeiterfassung-Zeile.
const ZEIT_GESAMT = (z = "z") =>
  `(${z}.sekunden + case when ${z}.laeuft_seit is null then 0
      else greatest(0, extract(epoch from (now() - ${z}.laeuft_seit))::int) end)`;
module.exports.ZEIT_GESAMT = ZEIT_GESAMT;

const heuteISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const gesternISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Holt die heutige Zeile. Raeumt dabei nur eines auf: einen Abschnitt, der ueber
// Mitternacht offen geblieben ist (Laptop zugeklappt, nicht abgemeldet). Der
// wird am Ende SEINES Tages geschlossen, statt in den neuen hineinzulaufen —
// sonst haette man am Morgen ploetzlich acht Stunden Nachtarbeit.
//
// Eine Abschaltung wegen Untaetigkeit gibt es hier bewusst nicht mehr.
async function zeitAbgleichen(q, userId) {
  await q(
    `update zeiterfassung
        set sekunden = sekunden + greatest(0, least(
              extract(epoch from ((datum + interval '1 day') - laeuft_seit))::int,
              extract(epoch from (now() - laeuft_seit))::int)),
            status = 'beendet', laeuft_seit = null
      where nutzer_id = $1 and laeuft_seit is not null and datum < current_date`, [userId]);
  const { rows } = await q(
    `select *, ${ZEIT_GESAMT("zeiterfassung")} as gesamt
       from zeiterfassung where nutzer_id=$1 and datum=$2`, [userId, heuteISO()]);
  return rows[0] || null;
}

// Nach aussen zaehlt der Gesamtstand inklusive laufendem Abschnitt — der Browser
// laesst die Anzeige daraus weiterlaufen.
const zeitAntwort = (row) => (row
  ? { status: row.status, sekunden: Number(row.gesamt ?? row.sekunden) }
  : { status: "keine", sekunden: 0 });

module.exports.zeitStatus = async function (user) {
  return alsNutzer(user.id, async (q) => zeitAntwort(await zeitAbgleichen(q, user.id)));
};

// Startet oder setzt fort. Absichtlich gutmuetig: Laeuft die Uhr schon, passiert
// nichts. Dadurch kann die Anmeldung sie bedenkenlos aufrufen, ohne zu pruefen,
// ob heute schon einmal gearbeitet wurde.
module.exports.zeitStart = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const row = await zeitAbgleichen(q, user.id);
    if (!row) {
      const { rows } = await q(
        `insert into zeiterfassung (nutzer_id, datum, sekunden, status, laeuft_seit, letzte_aktivitaet)
         values ($1,$2,0,'gestartet',now(),now())
         returning *, ${ZEIT_GESAMT("zeiterfassung")} as gesamt`, [user.id, heuteISO()]);
      return zeitAntwort(rows[0]);
    }
    if (row.laeuft_seit) return zeitAntwort(row); // laeuft bereits
    const { rows } = await q(
      `update zeiterfassung set status='gestartet', laeuft_seit=now(), letzte_aktivitaet=now()
        where id=$1 returning *, ${ZEIT_GESAMT("zeiterfassung")} as gesamt`, [row.id]);
    return zeitAntwort(rows[0]);
  });
};

// Pause, Abmelden und Feierabend laufen alle hier durch: den laufenden Abschnitt
// abschliessen und die volle verstrichene Zeit gutschreiben. Ohne Deckelung —
// die Zeit ist vergangen, ob dabei jemand die Maus bewegt hat oder nicht.
async function zeitAnhalten(user, zielStatus) {
  return alsNutzer(user.id, async (q) => {
    const row = await zeitAbgleichen(q, user.id);
    if (!row) return zeitAntwort(row);
    const { rows } = await q(
      `update zeiterfassung
          set sekunden = ${ZEIT_GESAMT("zeiterfassung")},
              laeuft_seit = null, status = $2, letzte_aktivitaet = now()
        where id = $1 returning *, sekunden as gesamt`, [row.id, zielStatus]);
    return zeitAntwort(rows[0]);
  });
}
module.exports.zeitPause = (user) => zeitAnhalten(user, "pausiert");
module.exports.zeitEnde = (user) => zeitAnhalten(user, "beendet");

// Vom Header alle ~15s aufgerufen, waehrend die Uhr laeuft: schreibt die
// verstrichene Zeit fest, ohne den Status zu aendern.
// Der Herzschlag rechnet seit 0026 nichts mehr fort — die Zeit steckt in
// laeuft_seit. Er holt nur den Stand ab, damit zwei offene Tabs dasselbe zeigen
// und die Anzeige nach dem Aufwachen aus dem Ruhezustand wieder stimmt.
// Faellt er aus, geht darum keine Zeit verloren.
module.exports.zeitHerzschlag = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const row = await zeitAbgleichen(q, user.id);
    if (row && row.laeuft_seit) {
      await q(`update zeiterfassung set letzte_aktivitaet = now() where id=$1`, [row.id]);
    }
    return zeitAntwort(row);
  });
};

// Montag-Sonntag der laufenden Woche einer Person, fuer die Team-Leistung-Statistik.
module.exports.zeitWoche = async function (user, zielUserId) {
  return alsNutzer(user.id, async (q) => {
    const heute = new Date();
    const wochentag = (heute.getDay() + 6) % 7; // Montag = 0
    const montag = new Date(heute); montag.setDate(heute.getDate() - wochentag);
    const tage = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(montag); d.setDate(montag.getDate() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    const { rows } = await q(
      // Der laufende Abschnitt muss mit hinein, sonst steht der heutige Balken
      // still, solange die Person tatsaechlich arbeitet.
      `select datum, ${ZEIT_GESAMT()} as sekunden
         from zeiterfassung z where nutzer_id=$1 and datum = any($2::date[])`,
      [zielUserId, tage]);
    // Lokale Getter statt toISOString(): das DATE-Feld kommt als lokale Mitternacht zurueck,
    // toISOString() wuerde es in Zeitzonen oestlich von UTC auf den Vortag zurueckdrehen.
    const nachDatum = Object.fromEntries(rows.map((r) =>
      [`${r.datum.getFullYear()}-${String(r.datum.getMonth() + 1).padStart(2, "0")}-${String(r.datum.getDate()).padStart(2, "0")}`, Number(r.sekunden)]));
    const tageSekunden = tage.map((t) => nachDatum[t] || 0);
    return { tage: tageSekunden, summe: tageSekunden.reduce((a, b) => a + b, 0) };
  });
};

// Tagesresuemee fuer den Feierabend-Dialog. Aufgaben, Cold Calls und Arbeitszeit
// sind echte Werte. Erstgespraeche (gebucht/gefuehrt/geclosed) und Tagesumsatz samt
// Vortagsvergleich sind noch DEMO-Zahlen — die echte Anbindung an Pipeline-Historie
// und historischen Umsatz folgt separat, das hier ist nur die Simulation der Anzeige.
const prozentVs = (heute, gestern) => (gestern > 0 ? Math.round(((heute - gestern) / gestern) * 100) : (heute > 0 ? 100 : 0));

module.exports.zeitResuemee = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const heute = heuteISO();
    // Nacheinander statt Promise.all: alle q()-Aufrufe teilen sich dieselbe
    // Verbindung (alsNutzer), die kann immer nur eine Abfrage gleichzeitig.
    const aufgaben = await q(`select count(*) filter (where erledigt)::int as erledigt, count(*)::int as gesamt
       from aufgaben where besitzer=$1 and faellig=$2`, [user.id, heute]);
    const anrufe = await q(`select count(*)::int as c from aktivitaeten where wer=$1 and art='anruf' and zeit::date=$2`, [user.id, heute]);
    const zeitHeute = await q(`select sekunden from zeiterfassung where nutzer_id=$1 and datum=$2`, [user.id, heute]);
    const zeitGestern = await q(`select sekunden from zeiterfassung where nutzer_id=$1 and datum=$2`, [user.id, gesternISO()]);
    const arbeitszeitSekunden = zeitHeute.rows[0] ? Number(zeitHeute.rows[0].sekunden) : 0;
    const arbeitszeitSekundenGestern = zeitGestern.rows[0] ? Number(zeitGestern.rows[0].sekunden) : 0;

    // DEMO-Daten (heute + Vortag), bis die echte Historie angebunden ist.
    const gebucht = 13, gebuchtVortag = 10;
    const gefuehrt = 9, gefuehrtVortag = 10;
    const geclosed = 4, geclosedVortag = 3;
    const tagesumsatz = 5200, tagesumsatzVortag = 4000;

    return {
      aufgaben: { erledigt: aufgaben.rows[0].erledigt, gesamt: aufgaben.rows[0].gesamt },
      anrufe: anrufe.rows[0].c,
      erstgespraeche: {
        gebucht, gebucht_prozent: prozentVs(gebucht, gebuchtVortag),
        gefuehrt, gefuehrt_prozent: prozentVs(gefuehrt, gefuehrtVortag),
        geclosed, geclosed_prozent: prozentVs(geclosed, geclosedVortag),
      },
      tagesumsatz, tagesumsatz_prozent: prozentVs(tagesumsatz, tagesumsatzVortag),
      arbeitszeit_sekunden: arbeitszeitSekunden,
      arbeitszeit_prozent: prozentVs(arbeitszeitSekunden, arbeitszeitSekundenGestern),
    };
  });
};

// ---------------------------------------------------------------- To-Dos / Aufgaben
// Aufgaben koennen kundengebunden (firma_id) oder allgemein sein. "geplant_am" ist der
// Tag, an dem man sie erledigen will; davon zieht sich "Heute zu tun" die Tagesliste.
module.exports.todoListe = async function (user, { nurOffen = false } = {}) {
  return alsNutzer(user.id, async (q) => {
    const w = nurOffen ? "and a.erledigt = false" : "";
    const { rows } = await q(
      `select a.*, f.name as firma_name
         from aufgaben a left join firmen f on f.id = a.firma_id
        where a.besitzer = $1 ${w}
        order by a.erledigt, a.geplant_am nulls last, a.faellig nulls last, a.erstellt desc`,
      [user.id]);
    return rows;
  });
};

module.exports.todoAnlegen = async function (user, d) {
  return alsNutzer(user.id, async (q) => {
    const w = Number(d.wichtigkeit);
    const { rows } = await q(
      `insert into aufgaben (titel, firma_id, faellig, geplant_am, notiz, besitzer, wichtigkeit, dringlichkeit)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [String(d.titel || "").trim(), d.firma_id || null, d.faellig || null, d.geplant_am || null,
       d.notiz || null, user.id, w >= 1 && w <= 4 ? w : 3, d.dringlichkeit || null]);
    return rows[0].id;
  });
};

// Tag zuweisen / verschieben (geplant_am)
module.exports.todoPlanen = async function (user, id, geplant_am) {
  return alsNutzer(user.id, async (q) => {
    await q(`update aufgaben set geplant_am=$2 where id=$1 and besitzer=$3`, [id, geplant_am || null, user.id]);
    return true;
  });
};

module.exports.todoErledigt = async function (user, id, erledigt = true) {
  return alsNutzer(user.id, async (q) => {
    await q(`update aufgaben set erledigt=$2 where id=$1 and besitzer=$3`, [id, !!erledigt, user.id]);
    return true;
  });
};

module.exports.todoLoeschen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    await q(`delete from aufgaben where id=$1 and besitzer=$2`, [id, user.id]);
    return true;
  });
};

// Aufgaben, die fuer HEUTE geplant sind (fuer "Heute zu tun")
module.exports.todosHeute = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const heute = heuteISO();
    const { rows } = await q(
      `select a.*, f.name as firma_name
         from aufgaben a left join firmen f on f.id = a.firma_id
        where a.besitzer=$1 and a.erledigt=false and a.geplant_am = $2
        order by a.faellig nulls last, a.erstellt`,
      [user.id, heute]);
    return rows;
  });
};
