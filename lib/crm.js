// Flowstate CRM — Datenzugriff mit echter Row-Level-Security.
// Kniff: Pro Transaktion wird die Postgres-Rolle 'authenticated' und der JWT-Claim
// gesetzt. Dadurch greifen exakt die Policies aus 0002_rls.sql — genau wie beim
// Supabase-Client, ohne zusaetzliche Schluessel.
const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 6,
  idleTimeoutMillis: 20000,
});

// OHNE DIESE ZEILEN STIRBT DER SERVER, wenn die Datenbankverbindung im Leerlauf
// abreisst (28.07.2026, real passiert):
//
//   Error: read EADDRNOTAVAIL
//     at Client.idleListener (node_modules/pg-pool/index.js:62:10)
//   -> throw er; // Unhandled 'error' event
//
// Der Ablauf: Eine Verbindung liegt ungenutzt im Pool. Das Netz wackelt — Laptop
// im Ruhezustand, WLAN-Wechsel, eine Sekunde Aussetzer beim Server. Der Client
// meldet einen Fehler. node-postgres reicht ihn an den Pool weiter, und ein
// 'error'-Ereignis OHNE Zuhoerer ist in Node kein Fehler, den man ignoriert:
// Node wirft ihn und beendet den Prozess. Das ganze Operating System geht aus,
// weil eine ungenutzte Verbindung abgelaufen ist.
//
// Der Pool ersetzt die kaputte Verbindung von selbst. Zu tun ist nichts ausser
// zuzuhoeren — aber zuhoeren MUSS jemand.
pool.on("error", (fehler) => {
  console.error("Datenbank: Verbindung im Leerlauf verloren —",
    String(fehler.message).slice(0, 120), "· der Pool baut sie neu auf.");
});

// Der Zuhoerer oben deckt nur Verbindungen ab, die UNGENUTZT im Pool liegen.
// Reisst eine Verbindung ab, waehrend sie gerade ausgeliehen ist, meldet sie
// den Fehler bei sich selbst — und beendet ohne Zuhoerer wieder den Prozess:
//
//   Error: Connection terminated unexpectedly
//     at Connection.<anonymous> (pg/lib/client.js:199)
//   -> throw er; // Unhandled 'error' event
//
// (Am 28.07. zweimal passiert, einmal je Fall.) Darum haengt sich holen() an
// jede ausgeliehene Verbindung. Der eigentliche Fehler kommt ohnehin ueber die
// abgelehnte Abfrage beim Aufrufer an — der Zuhoerer verhindert nur, dass Node
// die Sache vorher zum Prozessende erklaert.
async function holen() {
  const c = await pool.connect();
  if (!c.listenerCount("error")) {
    c.on("error", (fehler) => {
      console.error("Datenbank: Verbindung während einer Abfrage verloren —",
        String(fehler.message).slice(0, 120));
    });
  }
  return c;
}

// Die Datenbank laeuft in UTC, wir rechnen aber in unserer Zeit. Ohne das bezoege
// sich current_date auf den UTC-Tag: zwischen Mitternacht und 2 Uhr zeigte "heute"
// noch die Zahlen des Vortags, und ein Anruf um 23 Uhr zaehlte auf den Folgetag.
// Der Supabase-Pooler ignoriert die Verbindungsoption "options", darum setzen wir
// die Zone in jeder Sitzung selbst.
const ZONE = "Europe/Berlin";

// Fuehrt Abfragen im Namen eines Nutzers aus -> RLS aktiv
async function alsNutzer(userId, fn) {
  const c = await holen();
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
  const c = await holen();
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
    `select u.id, u.email, p.name, p.rolle, p.aktiv, p.module
       from auth.users u join public.profiles p on p.id = u.id
      where lower(u.email) = lower($1)
        and u.encrypted_password = crypt($2, u.encrypted_password)`,
    [String(email).trim(), passwort]
  );
  const u = rows[0];
  if (!u || !u.aktiv) return null;
  // module wandert in die Sitzung: Navigation und Torwaechter (server.js)
  // brauchen es bei jedem Aufruf, und eine Abfrage je Seitenaufruf waere
  // Verschwendung. Aendert sich der Zugriff, muss die Person sich neu anmelden —
  // das ist der Preis dafuer und in Ordnung.
  return { id: u.id, email: u.email, name: u.name, rolle: u.rolle, module: u.module || [] };
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
// Welche Listen wurden hochgeladen? Fuer das Auswahlfeld ueber der Anrufliste.
//
// Die Zahl dahinter zaehlt nur Leads, die noch den Status "lead" haben —
// dieselbe Menge, die die Anrufliste zeigt. Wer aus einer Liste heraus Kunde
// geworden ist, faellt also aus der Zahl heraus. Das ist gewollt: Die Zahl
// soll sagen, wie viel aus dieser Liste noch zu tun ist, nicht wie gross die
// Datei einmal war.
// ZWEI verschiedene Personen, darum zwei Filter — sie zu verwechseln war der
// Fehler vom 07.09.2026:
//
//   besitzer      = wem die LISTE gehoert (call_listen.besitzer, der Importeur).
//                   Das braucht der Dialog "Neuer Lead": An eine bestehende
//                   Liste anhaengen darf nur, wem sie gehoert (siehe die
//                   Pruefung in leadsAnlegen).
//   leadBesitzer  = wer die LEADS gerade abtelefoniert (firmen.besitzer).
//                   Das braucht das Auswahlfeld ueber der Anrufliste.
//
// Vorher filterte das Auswahlfeld mit dem Importeur, obwohl die Anrufliste
// darunter nach dem Lead-Besitzer eingegrenzt ist. Solange beide dieselbe
// Person sind, faellt das nicht auf. Weist die Geschaeftsfuehrung eine Liste
// aber weiter — Jannik importiert, Ioannis telefoniert —, gehen die beiden
// auseinander: Bei Jannik stand die Liste noch im Feld, lieferte aber 0
// Eintraege; bei Ioannis, wo die Leads nun liegen, tauchte sie gar nicht mehr
// auf. Genau die 299 uebergebenen Leads liessen sich dann nicht mehr von den
// rund 600 aelteren Werbescreen-Leads trennen.
async function leadListen(user, { besitzer = "", leadBesitzer = "" } = {}) {
  return alsNutzer(user.id, async (q) => {
    const a = [], w = [];
    if (besitzer) { a.push(besitzer); w.push(`l.besitzer = $${a.length}`); }
    // Der Lead-Besitzer gehoert an die VERBINDUNG zu firmen, nicht in das
    // where: So zaehlt "offen" nur die Leads dieser Person, und eine Liste,
    // von der ihr keiner mehr gehoert, faellt ueber das having von selbst
    // heraus. Stuende die Bedingung im where, waere die Zahl dieselbe — aber
    // die Absicht waere nicht mehr abzulesen.
    let fWo = "";
    if (leadBesitzer) { a.push(leadBesitzer); fWo = ` and f.besitzer = $${a.length}`; }
    // Der Besitzername kommt mit, weil in der Team-Ansicht sonst mehrere
    // gleich beschriftete Eintraege nebeneinander staenden: Laedt das halbe
    // Team am selben Tag hoch, heissen drei Listen "Liste vom 29.07.2026".
    const { rows } = await q(
      // l.besitzer kommt mit, weil der Dialog "Neuer Lead" die Listen nach der
      // dort gewaehlten Person filtert — sonst boete er Simons Listen an,
      // waehrend oben Jannik eingestellt ist.
      `select l.id, l.name, l.erstellt, l.besitzer, pb.name as besitzer_name,
              count(f.id) filter (where f.status = 'lead')::int as offen
         from call_listen l
         left join call_listen_eintraege e on e.liste_id = l.id
         left join firmen f on f.id = e.firma_id${fWo}
         left join profiles pb on pb.id = l.besitzer
        ${w.length ? "where " + w.join(" and ") : ""}
        group by l.id, l.name, l.erstellt, l.besitzer, pb.name
        having count(f.id) > 0
        order by l.erstellt desc
        limit 60`, a);
    return rows;
  });
}

// Dieselbe Regel wie webseite() weiter unten, nur fuer die Datenbank: Protokoll
// davor UND ein Punkt im Hostnamen. Beide Fassungen muessen dasselbe sagen,
// sonst zeigt die Liste "Maps" und der Filter zaehlt den Lead trotzdem zu "mit
// Webseite". Am 18.08. gegen alle 818 Leads geprueft: gleiche 729 Treffer.
const SQL_HAT_WEBSEITE = `f.website ~* '^https?://[^/]*\\.'`;

async function firmenListe(user, { suche = "", status = "", temperatur = "", besitzer = "", limit = 200,
  listeId = "", web = "" } = {}) {
  return alsNutzer(user.id, async (q) => {
    const w = [], a = [];
    if (suche) { a.push(`%${suche}%`); w.push(`(f.name ilike $${a.length} or f.ort ilike $${a.length} or f.telefon ilike $${a.length} or f.email ilike $${a.length})`); }
    if (status) { a.push(status); w.push(`f.status = $${a.length}`); }
    if (temperatur) { a.push(temperatur); w.push(`f.temperatur = $${a.length}`); }
    if (besitzer) { a.push(besitzer); w.push(`f.besitzer = $${a.length}`); }
    // Aus welchem Upload stammt der Lead? Die Einschraenkung gehoert HIERHER
    // und nicht hinter das Laden: Es gibt mehr Leads als das Limit hergibt
    // (818 gegen 500 am 18.08.). Wer nachtraeglich filtert, sucht in einem
    // Ausschnitt und bekommt bei aelteren Listen zu wenig zu sehen.
    if (listeId) {
      a.push(listeId);
      w.push(`exists (select 1 from call_listen_eintraege e
                       where e.firma_id = f.id and e.liste_id = $${a.length})`);
    }
    // Aus demselben Grund steht auch der Webseiten-Filter in der Abfrage.
    // coalesce ist Pflicht: Bei website = NULL liefert der Vergleich NULL,
    // nicht false — ohne das faende "ohne Webseite" genau die nicht, um die
    // es geht.
    if (web === "mit") w.push(`coalesce(${SQL_HAT_WEBSEITE}, false)`);
    if (web === "ohne") w.push(`not coalesce(${SQL_HAT_WEBSEITE}, false)`);
    a.push(limit);
    const { rows } = await q(
      `select f.*, p.name as besitzer_name,
              -- Woher der Lead kam: fuer das kleine Datum in der Zeile. Juengste
              -- Zuordnung gewinnt, falls ein Lead je in zwei Listen landet.
              (select l.name from call_listen_eintraege e
                 join call_listen l on l.id = e.liste_id
                where e.firma_id = f.id order by l.erstellt desc limit 1) as liste_name,
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

// --- Normalisierung fuer die Dubletten-Wache -------------------------------
// Frueher wurde exakt verglichen. Damit galten "+49 89 969382" und "089969382"
// als verschiedene Nummern und "https://x.de/" als andere Seite als
// "http://www.x.de" — die Wache lief praktisch ins Leere. Diese Ausdruecke
// bringen beide Seiten des Vergleichs auf eine gemeinsame Form.
const TEL_NORM = (s) => `(case
  when regexp_replace(coalesce(${s},''), '\\D', '', 'g') ~ '^00'
    then '0' || substr(regexp_replace(coalesce(${s},''), '\\D', '', 'g'), 5)
  when regexp_replace(coalesce(${s},''), '\\D', '', 'g') ~ '^49'
    then '0' || substr(regexp_replace(coalesce(${s},''), '\\D', '', 'g'), 3)
  else regexp_replace(coalesce(${s},''), '\\D', '', 'g')
end)`;

// Nur der Host zaehlt: Protokoll, www. und Pfad fallen weg.
const WEB_NORM = (s) =>
  `split_part(regexp_replace(lower(coalesce(${s},'')), '^https?://(www\\.)?', ''), '/', 1)`;

// Umlaute ausschreiben, dann alles ausser a-z0-9 entfernen.
// So trifft "Müller" auch "Mueller".
const NAME_NORM = (s) => `regexp_replace(
  replace(replace(replace(replace(lower(coalesce(${s},'')),
    'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),
  '[^a-z0-9]', '', 'g')`;

/**
 * Legt eine Firma an.
 *
 * d.abbrechenBeiDublette = true  -> bei einem Treffer wird NICHTS geschrieben,
 *   der Rueckgabewert ist { id: null, angelegt: false, dublette }.
 *   Das braucht der Lead-Import, damit Wiederholungen keine Doppeleintraege
 *   erzeugen. Ohne das Flag bleibt das alte Verhalten (anlegen und melden),
 *   damit UI und Sprachsteuerung eine Firma bewusst doppelt anlegen koennen.
 */
async function firmaAnlegen(user, d) {
  // Ohne Namen keine Firma (Pruefung 05.09.2026: "   " kam als Firma "" durch
  // und stand als leere Zeile in der Kundenliste).
  const name = String((d || {}).name || "").trim();
  if (!name) throw new Error("Firmenname fehlt");
  return alsNutzer(user.id, async (q) => {
    // E11 Dubletten-Wache
    const dub = await q(
      `select f.id, f.name, f.status, f.telefon, f.website, p.name as besitzer_name
         from firmen f left join profiles p on p.id=f.besitzer
        where ($1 <> '' and ${TEL_NORM("f.telefon")} = ${TEL_NORM("$1")})
           or ($2 <> '' and ${WEB_NORM("f.website")} = ${WEB_NORM("$2")})
           or ${NAME_NORM("f.name")} = ${NAME_NORM("$3")}
        limit 1`,
      [d.telefon || "", d.website || "", name]);

    if (d.abbrechenBeiDublette && dub.rows[0]) {
      return { id: null, angelegt: false, dublette: dub.rows[0] };
    }

    // Seit 0057 (05.09.2026) kommen aus dem schlanken "Neuer Kunde"-Dialog auch
    // Ansprechperson, Handy und die beiden Umsatzzahlen mit: geschaetzt
    // (Bauchgefuehl) oder geplant (fest besprochener Preis). Leer bleibt leer —
    // eine Null waere hier eine Behauptung ("wir rechnen mit nichts").
    const zahlOderNull = (v) => (v === "" || v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));
    const { rows } = await q(
      `insert into firmen (name, status, branche, website, telefon, email, adresse, plz, ort, quelle, temperatur, score, argumente, stand, besitzer, tags,
                           geschaeftsfuehrer, mobil, umsatz_geschaetzt, umsatz_geplant, kunde_seit)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning id`,
      [name, d.status || "lead", d.branche || null, d.website || null, d.telefon || null, d.email || null,
       d.adresse || null, d.plz || null, d.ort || null, d.quelle || "manuell", d.temperatur || "warm",
       d.score || null, d.argumente || null, d.stand || null, d.besitzer || user.id, d.tags || [],
       d.geschaeftsfuehrer || null, d.mobil || null, zahlOderNull(d.umsatz_geschaetzt), zahlOderNull(d.umsatz_geplant),
       // Wer direkt als Kunde angelegt wird, ist ab heute Kunde — zuKundeMachen
       // greift nur beim Umwandeln eines Leads (bricht bei status='kunde' ab).
       d.status === "kunde" ? (d.kunde_seit || alsTag(new Date())) : null]);
    const id = rows[0].id;
    await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'system',$3)`,
      [id, user.id, `${d.status === "kunde" ? "Als Kunde angelegt" : "Angelegt"} (Quelle: ${d.quelle || "manuell"})`]);
    return { id, angelegt: true, dublette: dub.rows[0] || null };
  });
}

async function firmaAendern(user, id, felder) {
  const erlaubt = ["name","status","branche","website","telefon","mobil","email","adresse","plz","ort","temperatur","stand","besonderes","besitzer","wiedervorlage","verlust_grund","versuche","score"];
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
              (select g.name from profiles g where g.id = f.gewonnen_durch) as gewonnen_name,
              f.preis_setup, f.preis_monatlich, f.vertrag_laufzeit, f.erfolgsbonus, f.erfolgsbonus_text,
              f.dringlichkeit, f.erstgespraech_am, f.faellig_am, f.naechster_termin`;
    // Reihenfolge in der Spalte: DER NAECHSTE TERMIN OBEN.
    //
    // Bis zum 30.07. entschied die von Hand gezogene Reihenfolge (sortierung),
    // sonst das Anlagedatum. Damit stand ein Erstgespraech von morgen irgendwo
    // in der Mitte, waehrend eines in drei Wochen oben lag — man musste die
    // Spalte lesen, um zu wissen, was als Naechstes ansteht.
    //
    // Dasselbe Datum wie auf der Karte, in derselben Rangfolge (siehe
    // crm-routes.js): naechster Termin, sonst faellig bis, sonst Erstgespraech.
    // Ohne jedes Datum haengt die Karte hinten an — dort greift dann wieder die
    // von Hand gezogene Reihenfolge.
    //
    // Aufsteigend, vergangene Termine also zuerst: Eine verstrichene Frist
    // gehoert nach oben, und ein Erstgespraech, das vorbei ist und dessen Karte
    // noch hier steht, ebenfalls — dann fehlt naemlich der naechste Schritt.
    const terminSpalte = `coalesce(f.naechster_termin, f.faellig_am, f.erstgespraech_am)`;
    const nachTermin = `(${terminSpalte} is null), ${terminSpalte} asc`;
    const { rows } = art === "projekt"
      ? await q(
        `select pr.*, pr.deal_id, d.wert, ${kundenFelder}
           from projekte pr join firmen f on f.id = pr.firma_id
           left join profiles p on p.id = pr.besitzer
           left join deals d on d.id = pr.deal_id
          where pr.sparte = $1 and pr.status in ('laeuft','pausiert')
          order by ${nachTermin}, pr.sortierung nulls last, pr.erstellt desc`, [sparte])
      : await q(
        `select d.*, ${kundenFelder}
           from deals d join firmen f on f.id=d.firma_id left join profiles p on p.id=d.besitzer
          where d.sparte=$1 and d.status='offen'
          order by ${nachTermin}, d.sortierung nulls last, d.erstellt desc`, [sparte]);
    return st.map((s) => ({ ...s, deals: rows.filter((d) => d.stufe_id === s.id) }));
  });
}

async function dealAnlegen(user, d) {
  return alsNutzer(user.id, async (q) => {
    const st = (await q(`select id from pipeline_stages where sparte=$1 and art='vertrieb' order by position limit 1`, [d.sparte])).rows[0];
    const { rows } = await q(
      // gewonnen_durch wird MIT angelegt (0050). Bleibt es leer, ist der Deal
      // niemandem zugerechnet — und niemand ausser dem Besitzer darf ihn sehen.
      // Beim Uebergeben wird die Zeile dadurch fuer den Uebergebenden unsichtbar,
      // und Postgres weist die Aenderung ab: "new row violates row-level
      // security policy". Genau daran ist am 06.08. eine Uebergabe gescheitert.
      `insert into deals (firma_id, titel, sparte, stufe_id, wert, besitzer, erwartet_am, gewonnen_durch)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [d.firma_id, d.titel, d.sparte, d.stufe_id || st?.id || null, d.wert || null,
       d.besitzer || user.id, d.erwartet_am || null, d.gewonnen_durch || d.besitzer || user.id]);
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
      // ANRUFBARE LEADS — die Antwort auf "wie viele Leads haben wir fuer
      // morgen" (20.08.2026).
      //
      // Warum als feste Kennzahl und nicht als Abfrage des Modells: Auf genau
      // diese Frage kamen an einem Nachmittag vier verschiedene Antworten —
      // "keine" (nur Wiedervorlagen des Folgetags gezaehlt), "1.879" (ohne
      // Datum), "723 fuer Ioannis, 694 fuer Jannik …" (nach Person zerlegt) und
      // "60 pro Mitarbeiter". Jede fuer sich richtig, zusammen keine Auskunft.
      // Zwei Nachschaerfungen der Anweisung brachten sie von 0 auf 8 von 10 —
      // und blieben dort. Ein Satz im Anzeigen-Konzept haengt daran ("das ist
      // zu wenig, such nochmal hundert weitere raus"): Bei "keine" bricht die
      // Szene, bei einer Aufteilung nach Personen wirkt der Satz absurd.
      //
      // Als Kennzahl steht die Zahl im STAND, und Alexandra beantwortet die
      // Frage ohne Abfrage — in zwei statt in acht Sekunden, und jedes Mal
      // gleich. Dieselbe Bedingung wie in lib/leads-nachschub.js: Nummer da,
      // noch nie angerufen.
      anrufbare_leads: await z(`select count(*)::int c from firmen f
        where f.status='lead' and coalesce(btrim(f.telefon),'') <> ''
          and not exists (select 1 from aktivitaeten a where a.firma_id=f.id and a.art='anruf')`),
      wiedervorlagen_morgen: await z(`select count(*)::int c from firmen where wiedervorlage = current_date + 1`),
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
    // Dieselben zwei Zahlen wie in kennzahlen() weiter oben — und genau
    // deshalb standen sie am 20.08. nicht im STAND: Sie waren nur DORT
    // eingebaut, aber lib/zustand.js ruft kennzahlenGesamt(). Alexandra
    // antwortete darum auf "Wie viele Leads haben wir fuer morgen?" mit
    // "Morgen hast du 1 unbearbeiteten Lead" und zaehlte danach fuenf Namen
    // auf. Richtig sind 1.808. Eine Zahl, die der eigenen Aufzaehlung
    // widerspricht, ist in der Aufnahme schlimmer als gar keine.
    //
    // Bedingung wie in lib/leads-nachschub.js: Nummer da, noch nie angerufen.
    anrufbare_leads: await z(`select count(*)::int c from public.firmen f
      where f.status='lead' and coalesce(btrim(f.telefon),'') <> ''
        and not exists (select 1 from public.aktivitaeten a
                         where a.firma_id=f.id and a.art='anruf')`),
    wiedervorlagen_morgen: await z(
      `select count(*)::int c from public.firmen where wiedervorlage = current_date + 1`),
  };
}

// Pro Person (intern — Teammitglieder, keine Kunden): Zahlen fuer die Chronik.
async function teamZahlenGesamt() {
  const { rows } = await system(
    `select p.name, p.rolle,
      (select count(*)::int from public.firmen f where f.besitzer=p.id and f.status='lead') as leads,
      (select count(*)::int from public.firmen f where f.besitzer=p.id and f.status='kunde') as kunden,
      (select count(*)::int from public.deals d where d.besitzer=p.id and d.status='offen') as offen,
      -- Zurechnung nach gewonnen_durch (0047): der Umsatz gehoert dem, der den
      -- Kunden geholt hat, nicht dem, der ihn heute betreut.
      (select count(*)::int from public.deals d
        where coalesce(d.gewonnen_durch, d.besitzer)=p.id and d.status='gewonnen') as gewonnen,
      (select coalesce(sum(d.wert),0)::numeric from public.deals d
        where coalesce(d.gewonnen_durch, d.besitzer)=p.id and d.status='gewonnen'
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
        -- Gewonnen und Umsatz zaehlen fuer den, der den Kunden GEHOLT hat
        -- (gewonnen_durch, 0047) — nicht fuer den, der ihn heute betreut.
        -- Wer den Abschluss macht, ist oft ein anderer als der, der den Lead
        -- gebracht hat; die Leistung gehoert dem, der ihn gebracht hat.
        (select count(*)::int from deals d
          where coalesce(d.gewonnen_durch, d.besitzer)=p.id and d.status='gewonnen'${sp}) as gewonnen,
        (select count(*)::int from deals d where d.besitzer=p.id and d.status='verloren'${sp}) as verloren,
        (select coalesce(sum(d.wert),0)::numeric from deals d
          where coalesce(d.gewonnen_durch, d.besitzer)=p.id and d.status='gewonnen'
           and d.geschlossen_am >= date_trunc('month', current_date)${sp}) as umsatz_monat,
        (select coalesce(sum(d.wert),0)::numeric from deals d
          where coalesce(d.gewonnen_durch, d.besitzer)=p.id and d.status='gewonnen'${sp}) as umsatz_gesamt,
        (select count(*)::int from aktivitaeten a where a.wer=p.id and a.art='anruf' and a.zeit::date = current_date) as anrufe_heute
       from profiles p where p.aktiv order by p.rolle, p.name`, a);
    return rows;
  });
}

module.exports = {
  pool, alsNutzer, system, anmelden, passwortAendern, stufen, team,
  firmenListe, leadListen, firma, firmaAnlegen, firmaAendern,
  dealsNachStufen, dealAnlegen, dealVerschieben, dealVerlieren,
  notiz, callErgebnis, kennzahlen, teamZahlen, kennzahlenGesamt, teamZahlenGesamt,
  // Die Funktionen sind Deklarationen und damit hier schon bekannt, auch wenn
  // sie weiter unten stehen. DOKUMENT_ARTEN ist ein const und wird erst dort
  // angehaengt — hier waere es noch nicht initialisiert.
  dokumenteListe, dokumentHochladen, dokumentDatei, dokumentLoeschen,
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

// ------------------------------------------------- Umsatz aufgeschluesselt
//
// Was hinter der Umsatz-Zahl auf der Zentrale steckt: jeder Monat mit den
// Kunden, die ihn ausmachen. Neuester Monat zuerst.
//
// Eine Summe allein laesst sich nicht pruefen — man sieht nicht, ob eine Null
// zu viel drin ist oder ein Kunde fehlt. Mit den Namen darunter erkennt man das
// beim Hinsehen. Und der Weg von der Zahl zur Kundenakte ist ein Klick.
//
// Bezahlt/offen kommt aus den Buchungen, nicht aus dem Zahlungsstand in der
// Akte: es zaehlt, was tatsaechlich gebucht ist.
module.exports.umsatzNachMonat = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select d.id, d.wert, d.sparte, d.geschlossen_am, d.quelle,
              f.id as firma_id, f.name as firma, f.status, f.ort,
              f.preis_setup, f.preis_monatlich, f.vertrag_laufzeit,
              f.rechnung_stand, f.retainer_monate_bezahlt,
              p.name as besitzer_name,
              coalesce((select sum(b.betrag) from buchungen b
                         where b.firma_id = f.id and b.art = 'einnahme' and b.bezahlt), 0)::numeric as eingegangen
         from deals d
         join firmen f on f.id = d.firma_id
         left join profiles p on p.id = d.besitzer
        where d.status = 'gewonnen'
        order by d.geschlossen_am desc nulls last, d.wert desc`);

    // Nach Monat buendeln. Der Schluessel wird aus lokalen Gettern gebaut —
    // toISOString() waere UTC und wuerde einen Abschluss vom Ersten eines
    // Monats in den Vormonat schieben.
    const monate = new Map();
    for (const r of rows) {
      const d = r.geschlossen_am ? new Date(r.geschlossen_am) : null;
      const schluessel = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "ohne";
      if (!monate.has(schluessel)) {
        monate.set(schluessel, {
          schluessel,
          titel: d ? d.toLocaleDateString("de-DE", { month: "long", year: "numeric" }) : "Ohne Datum",
          summe: 0, eingegangen: 0, deals: [],
        });
      }
      const m = monate.get(schluessel);
      m.summe += Number(r.wert) || 0;
      m.eingegangen += Number(r.eingegangen) || 0;
      m.deals.push({ ...r, wert: Number(r.wert) || 0, eingegangen: Number(r.eingegangen) || 0 });
    }
    const liste = [...monate.values()];
    return {
      monate: liste,
      gesamt: liste.reduce((s, m) => s + m.summe, 0),
      eingegangen: liste.reduce((s, m) => s + m.eingegangen, 0),
      anzahl: rows.length,
    };
  });
};

// Ergebnis eines Cold Calls speichern. Setzt das Listen-Tag (damit der Lead in der
// richtigen Unterliste auftaucht), schreibt die Aktivitaet mit sauberem "ergebnis"
// (Grundlage der Anruf-Statistik) und legt bei "gebucht" den Deal in der Pipeline an.
// "webseite-zu-gut" ist kein Anrufergebnis, sondern ein Aussortieren VOR dem
// Anruf: Die Seite des Betriebs ist schon gut, ein Redesign waere keine Hilfe.
// Steht trotzdem hier, weil es dieselbe Zeile in derselben Liste abschliesst —
// und weil ein Lead in genau EINEM dieser Zustaende sein darf.
const ANRUF_TAGS = ["gebucht", "absage", "nicht-erreicht", "keine-zeit", "webseite-zu-gut", "follow-up"];
module.exports.anrufSpeichern = async function (user, firmaId, ergebnis, extra = {}) {
  if (ergebnis !== "" && !ANRUF_TAGS.includes(ergebnis)) throw new Error("Unbekanntes Ergebnis: " + ergebnis);
  // Das Ergebnis der Transaktion wird eingefangen statt direkt zurueckgegeben:
  // Ein gebuchtes Erstgespraech geht danach in den Kalender (siehe unten).
  const ergebnisAnruf = await alsNutzer(user.id, async (q) => {
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
        // gewonnen_durch = wer angerufen hat. Ohne diese Angabe verliert er den
        // Deal aus den Augen, sobald jemand anderes ihn uebernimmt (0050).
        `insert into deals (firma_id, titel, sparte, stufe_id, besitzer, gewonnen_durch)
         values ($1,$2,$3,$4,$5,$5) returning id`,
        [firmaId, `Erstgespräch ${f.name}`, sparte, st?.id || null, user.id])).rows[0];
      dealId = d.id;
      // Der Termin landet im Terminfeld, nicht nur im Notiztext (0051). Sonst
      // steht auf der Pipeline-Karte "noch offen", obwohl die Uhrzeit beim
      // Buchen erfasst wurde — und jemand muss sie von Hand nachtragen.
      await q(`update firmen set status='lead', anruf_notiz=$2, verlust_grund=null,
               erstgespraech_am = coalesce($3::timestamptz, erstgespraech_am) where id=$1`,
        [firmaId, extra.notiz || null, extra.termin || null]);
      text = `Erstgespräch gebucht${extra.notiz ? " — " + extra.notiz : ""}`;
    } else if (ergebnis === "absage") {
      await q(`update firmen set status='verloren', verlust_grund=$2, anruf_notiz=null, temperatur='kalt', wiedervorlage=null where id=$1`,
        [firmaId, extra.grund || "kein Grund angegeben"]);
      text = `Absage — ${extra.grund || "kein Grund angegeben"}`;
    } else if (ergebnis === "follow-up") {
      // Interesse, aber kein Termin. Der Lead BLEIBT ein Lead und bekommt
      // trotzdem eine Karte auf dem Brett — in der Spalte "Follow-up", die es
      // in jeder Sparte gibt (Position 2, vor dem Erstgespraech). Sonst haette
      // man ein Gespraech gefuehrt, an das nichts erinnert.
      //
      // Bewusst NICHT die Erstgespraech-Stufe: Ein Erstgespraech ist ein Termin
      // im Kalender. Wer beides in eine Spalte legt, weiss am Montag nicht, mit
      // wem er wirklich sprechen wird.
      // DER TERMIN AUS DEM GESPRAECHS-DIALOG ZAEHLT AUCH HIER (14.09.2026).
      //
      // Bis heute stand an dieser Stelle nur extra.datum — das die Leads-Maske
      // bei Follow-up nie mitschickt. Der Dialog bietet das Terminfeld bei
      // "gebucht" UND bei "follow-up" an (GESPRAECH_STAENDE), die Uhrzeit ging
      // also in die Notiz und sonst nirgendwohin: Nachgemessen bei allen 15
      // Follow-up-Leads — 15 mit Deal, 0 mit Wiedervorlage. Bei KFZ Holzer
      // stand "Termin 2026-09-21T10:00" in der Notiz, die Karte hatte trotzdem
      // kein Datum und hing hinten in der Spalte (sortiert wird nach
      // naechster_termin, faellig_am, erstgespraech_am — alle drei leer).
      //
      // extra.termin gewinnt, extra.datum bleibt als Rueckfall: Letzteres
      // kommt aus anderen Wegen (Sprache, Akte), die weiterhin nur einen Tag
      // ohne Uhrzeit kennen.
      //
      // naechster_termin MIT gesetzt, nicht nur wiedervorlage: Die Pipeline-
      // Karte liest naechster_termin zuerst, und ein verabredeter Rueckruf ist
      // genau das — der naechste Termin mit diesem Lead.
      //
      // ::date, nicht ::timestamptz: Beide Spalten SIND date (0001 und 0012).
      // Die Uhrzeit aus dem Dialog wird hier also auf den Tag gekuerzt — sie
      // bleibt in der Notiz und im Titel der Whiteboard-Aufgabe erhalten, wo
      // sie hingehoert. Der Cast steht ausdruecklich da, damit am Code
      // ablesbar ist, was gespeichert wird: Ein ::timestamptz an dieser
      // Stelle verspraeche eine Genauigkeit, die die Spalte nicht hat.
      // Soll die Uhrzeit auch auf der Karte stehen, braucht es denselben
      // Schritt wie bei erstgespraech_am (Migration 0051: date -> timestamptz
      // mit "at time zone 'Europe/Berlin'"); die Karte zeigt beim Zweig
      // "naechster Termin" derzeit bewusst nur den Tag (mitZeit = false).
      const fuTermin = extra.termin || extra.datum || null;
      await q(`update firmen set status='lead', temperatur='heiss', anruf_notiz=$2,
               verlust_grund=null, wiedervorlage=$3::date,
               naechster_termin = coalesce($3::date, naechster_termin) where id=$1`,
        [firmaId, extra.notiz || null, fuTermin]);
      const sparteF = (f.tags || []).find((t) => ["webdesign", "performance", "ki"].includes(t)) || "webdesign";
      const stF = (await q(
        `select id from pipeline_stages where sparte=$1 and art='vertrieb'
           and name ilike 'Follow-up' order by position limit 1`, [sparteF])).rows[0];
      // Zweimal Follow-up soll keine zweite Karte ergeben.
      const daF = (await q(
        `select id from deals where firma_id=$1 and status='offen'`, [firmaId])).rows[0];
      if (daF) {
        await q(`update deals set stufe_id=$2, titel=$3 where id=$1`,
          [daF.id, stF?.id || null, `Follow-up ${f.name}`]);
        dealId = daF.id;
      } else {
        const d = (await q(
          `insert into deals (firma_id, titel, sparte, stufe_id, besitzer, gewonnen_durch)
           values ($1,$2,$3,$4,$5,$5) returning id`,
          [firmaId, `Follow-up ${f.name}`, sparteF, stF?.id || null, user.id])).rows[0];
        dealId = d.id;
      }
      text = `Follow-up — Interesse, kein Termin${extra.notiz ? " — " + extra.notiz : ""}`;
    } else if (ergebnis === "webseite-zu-gut") {
      // Aussortiert, nicht abgesagt: Hier hat niemand angerufen und niemand
      // Nein gesagt. Der Lead wird geschlossen wie eine Absage — aber der
      // Grund haelt fest, dass es an der Seite lag und nicht am Betrieb. Wird
      // die Seite in zwei Jahren alt, ist er wieder ein Kandidat.
      await q(`update firmen set status='verloren', verlust_grund=$2, anruf_notiz=null,
               temperatur='kalt', wiedervorlage=null where id=$1`,
        [firmaId, "Webseite ist bereits gut — kein Redesign-Bedarf"]);
      text = "Aussortiert: Webseite ist bereits gut — nicht angerufen";
    } else if (ergebnis === "nicht-erreicht") {
      await q(`update firmen set status='lead', versuche = versuche + 1, verlust_grund=null, anruf_notiz=null where id=$1`, [firmaId]);
      text = `Nicht erreicht (Versuch ${(f.versuche || 0) + 1})`;
    } else {
      await q(`update firmen set status='lead', wiedervorlage=$2, anruf_notiz=$3, verlust_grund=null where id=$1`,
        [firmaId, extra.datum || null, extra.notiz || null]);
      text = `Später nochmal${extra.notiz ? " — " + extra.notiz : ""}`;
    }

    // Die Art entscheidet, ob es als Anruf zaehlt. "Webseite zu gut" wird beim
    // Durchsehen der Liste gesetzt, ohne zu telefonieren — als Anruf gebucht
    // wuerde es die Anrufzahl aufblaehen und den Tagesdurchschnitt verfaelschen.
    // Jede Auswertung, die auf art='anruf' filtert, laesst es damit korrekt aus.
    const art = ergebnis === "webseite-zu-gut" ? "aussortiert" : "anruf";
    await q(`insert into aktivitaeten (firma_id, deal_id, wer, art, text, ergebnis)
             values ($1,$2,$3,$4,$5,$6)`, [firmaId, dealId, user.id, art, text, ergebnis]);
    // firmaName geht mit hinaus: Die Tafelzeile heisst "<Firma>: <Titel>",
    // und ihn danach noch einmal zu holen waere eine Abfrage fuer nichts.
    return { ok: true, dealId, firmaName: f.name };
  });
  // Ein gebuchtes Erstgespraech mit Termin gehoert in den Kalender (Agent C,
  // lib/kalender-akte.js, 05.09.2026). NACH der Transaktion und abgefangen:
  // Ein langsamer oder fehlender Kalender darf das Anrufergebnis weder
  // aufhalten noch zurueckrollen — der Anruf ist passiert, das steht fest.
  if (ergebnisAnruf && ergebnisAnruf.ok && ergebnis === "gebucht" && extra.termin) {
    await erstgespraechInKalender(user, firmaId, { wann: extra.termin, notiz: extra.notiz || "" });
  }
  // Und aufs Whiteboard, aus demselben Grund an derselben Stelle: NACH der
  // Transaktion. todoAnlegen() faehrt seine eigene und ruft danach die
  // Bruecke zur Tafel — von hier aus mittendrin aufgerufen haetten wir eine
  // Transaktion in der Transaktion. Fehler werden nur protokolliert: Der
  // Anruf ist passiert, das steht fest; eine Zeile, die nicht ans Brett
  // kommt, darf ihn nicht zurueckrollen.
  if (ergebnisAnruf && ergebnisAnruf.ok) {
    await anrufAufgabe(user, firmaId, ergebnis, extra, ergebnisAnruf.firmaName);
  }
  return ergebnisAnruf;
};

// ------------------------------- Anruf -> Aufgabe -> Whiteboard (0066)
//
// Wunsch von Lukas (07.09.2026), zur Ergebnis-Auswahl auf /crm/leads: "Wenn
// man hier eins von beiden auswählt, soll das auch gleich im Whiteboard
// auftauchen. Also einfach Datum + kurz Stichpunkt, was genau zu tun ist."
//
// DREI Ergebnisse hinterlassen Arbeit (das dritte seit 08.09.2026):
//   gebucht     Ein Termin steht — er will vorbereitet und gehalten werden.
//   follow-up   Interesse ohne Termin — jemand muss nachfassen.
//   keine-zeit  "Später nochmal" — Lukas' "Calling": nochmal anrufen.
// "Später nochmal" kam dazu, weil es GENAU DER FALL ist, den Lukas mit
// "Calling" meinte: Der Angerufene hatte jetzt keine Zeit, will aber
// grundsaetzlich — das ist kein abgeschlossener Vorgang, sondern ein
// vertagter Anruf. Bisher stand er nur als Wiedervorlage in der Anrufliste;
// wer die Liste nicht oeffnet, sieht ihn nie. Auf der Tafel steht er jetzt
// mit Datum da, wo auch der Rest der Telefonarbeit steht.
// Die uebrigen drei legen weiterhin NICHTS an: Bei "Nein" und "Webseite zu
// gut" ist der Lead zu, da ist nichts mehr zu tun; "Nicht erreicht" ist kein
// Gespraech, sondern ein Klingeln — jeder nicht abgenommene Hoerer als eigene
// Tafelzeile, und nach zwei Tagen liest niemand mehr hin.
//
// Gebaut wird hier nichts Neues: todoAnlegen() schreibt die Aufgabe, und
// lib/aufgaben-tafel.js haengt sie als Zeile "<Firma>: <Titel>" mit Link in
// die Kundenakte an den CRM-Block der verantwortlichen Person (seit
// 08.09.2026 die fuenfte Whiteboard-Kategorie; von Hand angelegte Aufgaben
// bleiben bei "Kunden"). Hier steht nur, WAS in der Zeile steht und WER sie
// bekommt.
const ANRUF_ANLASS = { "gebucht": "anruf:gebucht", "follow-up": "anruf:follow-up",
                       "keine-zeit": "anruf:keine-zeit" };

// Welche Whiteboard-Kategorie eine Aufgabe traegt. Entschieden wird am
// ANLASS (0066), nicht am Titel und nicht daran, wer sie anlegt: "anruf:*"
// heisst, sie ist aus einem Anrufergebnis entstanden und gehoert damit in
// den CRM-Block. Alles andere — der "Neuer Kunde"-Dialog, die Aufgabe, die
// jemand von Hand in der Akte anlegt — bleibt bei "kunden", wie seit 0058.
const kategorieFuerAnlass = (anlass) =>
  /^anruf:/.test(String(anlass || "").trim()) ? "crm" : "kunden";
module.exports.kategorieFuerAnlass = kategorieFuerAnlass;

// Datum + Uhrzeit aus dem, was die Maske schickt ("2026-09-12T10:00" aus
// <input type="datetime-local">) — oder aus einem vollen Zeitstempel, falls
// der Wert einmal aus der Akte kommt. 00:00 gilt als KEINE Uhrzeit, dieselbe
// Regel wie im Kalender (lib/kalender-akte.js: ganztags): Um Mitternacht
// faengt kein Erstgespraech an, das ist ein Tag ohne vereinbarte Zeit.
const ANRUF_ZEITPUNKT = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;
function zeitpunktLesen(wert) {
  const m = ANRUF_ZEITPUNKT.exec(String(wert || "").trim());
  if (!m) return null;
  const uhrzeit = m[4] ? `${m[4]}:${m[5]}` : "";
  return { tag: `${m[1]}-${m[2]}-${m[3]}`, kurz: `${m[3]}.${m[2]}.`,
           uhrzeit: uhrzeit === "00:00" ? "" : uhrzeit };
}

// In n Werktagen. Wochenenden uebersprungen: Eine Wiedervorlage auf Samstag
// sieht am Montag niemand mehr — sie steht dann schon unter "ueberfaellig".
function werktageSpaeter(n) {
  const d = new Date();
  for (let rest = n; rest > 0; ) {
    d.setDate(d.getDate() + 1);
    const tag = d.getDay();
    if (tag !== 0 && tag !== 6) rest--;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Die Gespraechsnotiz auf Stichpunktlaenge. An der letzten Wortluecke
// getrennt, damit kein halbes Wort auf der Tafel steht.
function stichpunkt(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const schnitt = t.slice(0, max);
  const luecke = schnitt.lastIndexOf(" ");
  return (luecke > max / 2 ? schnitt.slice(0, luecke) : schnitt).replace(/[\s·—-]+$/, "") + "…";
}

// Titel, Tag und Einstufung fuer das jeweilige Ergebnis.
//
// Der Titel ist der "kurze Stichpunkt": Auf der Tafel steht davor noch der
// Firmenname, und in einen 560 px breiten Block passen rund 50 Zeichen je
// Reihe (lib/aufgaben-tafel.js). Darum ANRUF_TITEL_MAX — drei Reihen fuer
// eine Zeile sind noch lesbar, sechs sind eine Wand.
const ANRUF_TITEL_MAX = 60;
function anrufAufgabePlanen(ergebnis, extra) {
  if (ergebnis === "gebucht") {
    const t = zeitpunktLesen(extra.termin);
    // Wichtigkeit 1, weil ein zugesagter Termin die einzige Verabredung im
    // Tag ist, die man nicht verschieben kann, ohne jemanden zu versetzen.
    const stufe = { wichtigkeit: 1, dringlichkeit: "Dringend" };
    // "Gebucht" ohne Termin gibt es: Der Gespraechs-Dialog verlangt das
    // Terminfeld nicht. Dann ist die Aufgabe eine andere — nicht "hingehen",
    // sondern "Zeitpunkt beschaffen" —, und sie steht auf HEUTE, weil sie
    // sonst nirgends auftaucht.
    if (!t) return { ...stufe, titel: "Erstgespräch — Termin nachtragen", tag: heuteISO() };
    return { ...stufe, tag: t.tag,
             titel: `Erstgespräch am ${t.kurz}${t.uhrzeit ? ` um ${t.uhrzeit}` : ""}` };
  }
  // Follow-up und "Später nochmal": Der Tag kommt aus dem verabredeten
  // Zeitpunkt, wenn einer erfasst wurde.
  //
  // extra.termin ZUERST (14.09.2026): Der Gespraechs-Dialog der Leads-Maske
  // bietet das Terminfeld bei "gebucht" UND "follow-up" an, schickt es aber
  // immer als "termin" — extra.datum ist dort nie gesetzt. Bis heute las nur
  // extra.datum, darum stand ein Follow-up mit ausgehandelter Uhrzeit
  // trotzdem "in drei Werktagen" auf der Tafel, waehrend der Kunde einen
  // anderen Tag im Ohr hatte. extra.datum bleibt als Rueckfall: Es kommt aus
  // Wegen, die nur einen Tag ohne Uhrzeit kennen ("Später nochmal", Sprache).
  //
  // Ohne jede Angabe drei Werktage: nah genug, dass das Gespraech noch
  // praesent ist, weit genug, dass man nicht am naechsten Morgen schon
  // wieder anruft.
  const wieder = zeitpunktLesen(extra.termin) || zeitpunktLesen(extra.datum);
  const notiz = stichpunkt(extra.notiz, 40);
  const tag = wieder ? wieder.tag : werktageSpaeter(3);
  if (ergebnis === "keine-zeit") {
    // Wichtigkeit 3 / "Bald": Es ist ein Anruf, kein Termin. Er darf einen
    // Tag rutschen, ohne dass jemand versetzt wird — genau darum steht er in
    // der letztgereihten Kategorie (CRM) und nicht bei den Kunden.
    return { wichtigkeit: 3, dringlichkeit: "Bald", tag,
             titel: `Nochmal anrufen${notiz ? " · " + notiz : ""}` };
  }
  // "kein Termin" stimmt nur, solange keiner verabredet wurde. Ist im
  // Gespraechs-Dialog eine Uhrzeit erfasst, steht sie im Titel — wie beim
  // Erstgespraech. Sonst behauptet die Tafelzeile das Gegenteil von dem, was
  // im Kalender steht.
  if (wieder && wieder.uhrzeit) {
    return { wichtigkeit: 2, dringlichkeit: "Bald", tag,
             titel: `Nachfassen am ${wieder.kurz} um ${wieder.uhrzeit}${notiz ? " · " + notiz : ""}` };
  }
  return { wichtigkeit: 2, dringlichkeit: "Bald", tag,
           titel: `Nachfassen${wieder ? ` am ${wieder.kurz}` : " — kein Termin"}${notiz ? " · " + notiz : ""}` };
}
// Exportiert fuer scripts/test-aufgabe-kalender.js: Titel und Tag je Ergebnis
// sind reine Rechnerei und gehoeren geprueft, ohne dass ein Anruf noetig ist.
module.exports.anrufAufgabePlanen = anrufAufgabePlanen;
module.exports.ANRUF_ANLASS = ANRUF_ANLASS;

// Die Aufgabe zum Anrufergebnis anlegen — oder die vorhandene nachfuehren.
//
// verantwortlich = user.id, also WER ANGERUFEN HAT. Dieselbe Begruendung wie
// bei gewonnen_durch am Deal weiter oben (0050): Wer das Gespraech gefuehrt
// hat, muss es weiterverfolgen — er weiss, was gesagt wurde. Landet die
// Aufgabe auf einer fremden Tafel, verliert er sie aus den Augen, und der
// andere weiss mit ihr nichts anzufangen.
//
// KEINE DUBLETTEN: Derselbe Lead wird oft zweimal mit demselben Ergebnis
// gespeichert — Uhrzeit korrigiert, Notiz nachgetragen, verklickt und neu
// gewaehlt. Erkannt wird das am anlass (0066), nicht am Titel: Der Titel
// traegt genau die Angabe, die sich dabei aendert ("… um 10:00" -> "… um
// 14:00"), ein Titelvergleich fiele also ausgerechnet im wichtigsten Fall
// durch und legte eine zweite Zeile an. Umgekehrt traefe ein unscharfer
// Vergleich ("faengt mit 'Erstgespräch' an") auch die Aufgabe, die jemand
// von Hand geschrieben hat. Die ausfuehrliche Begruendung steht in 0066.
//
// Erledigte zaehlen nicht: Wer abgehakt hat, ist fertig; ein neuer Anruf zum
// selben Lead darf dann eine neue Aufgabe ergeben.
//
// Wirft nie — der Anruf ist gespeichert, die Tafel ist Zugabe (wie
// todoAufTafel und erstgespraechInKalender).
async function anrufAufgabe(user, firmaId, ergebnis, extra = {}, firmaName = "") {
  const anlass = ANRUF_ANLASS[ergebnis];
  if (!anlass) return { ok: true, grund: "kein-anlass" };
  try {
    const plan = anrufAufgabePlanen(ergebnis, extra);
    const titel = plan.titel.slice(0, ANRUF_TITEL_MAX);
    const { rows } = await alsNutzer(user.id, (q) => q(
      `select id from aufgaben
        where firma_id = $1 and anlass = $2 and erledigt = false
        order by erstellt desc limit 1`, [firmaId, anlass]));
    const da = rows[0];
    if (da) {
      // Nachfuehren statt neu anlegen: Titel und Tag koennen sich geaendert
      // haben (neue Uhrzeit), der Anlass nie.
      await alsNutzer(user.id, (q) => q(
        `update aufgaben set titel = $2, geplant_am = $3, faellig = $3, notiz = coalesce($4, notiz)
          where id = $1`, [da.id, titel, plan.tag, extra.notiz || null]));
      // Und die Zeile auf der Tafel mit. Nicht ueber aufgabeAufTafel(): die
      // haengt IMMER an, es stuenden dann doch zwei Zeilen da.
      await todoTextAufTafel(user, da.id, tafelZeilenText(firmaName, titel));
      // Und der Kalendereintrag mit: neuer Tag, neuer Titel. Beim zweiten
      // "Erstgespräch gebucht" bleibt es beim EINEN Termin, den
      // erstgespraechSynchronisieren gerade verschoben hat — aufgabeInKalender
      // sieht die 'erstgespraech'-Verknuepfung und legt keinen zweiten an.
      await aufgabeInKalender(user, da.id);
      return { ok: true, id: da.id, neu: false };
    }
    const id = await module.exports.todoAnlegen(user, {
      titel, firma_id: firmaId, verantwortlich: user.id, anlass,
      geplant_am: plan.tag, faellig: plan.tag,
      wichtigkeit: plan.wichtigkeit, dringlichkeit: plan.dringlichkeit,
      notiz: extra.notiz || null,
    });
    return { ok: true, id, neu: true };
  } catch (e) {
    console.error(`Anruf ${ergebnis} (Firma ${firmaId}): keine Aufgabe angelegt —`,
      String(e.message).slice(0, 160));
    return { ok: false, grund: String(e.message).slice(0, 160) };
  }
}
module.exports.anrufAufgabe = anrufAufgabe;

// Wie die Zeile auf der Tafel heisst — dieselbe Regel wie zeileFuer() in
// lib/aufgaben-tafel.js: Firma zuerst, weil der Block "Kunden" heisst und man
// ihn nach Kunden ueberfliegt.
const tafelZeilenText = (firmaName, titel) =>
  (String(firmaName || "").trim() ? `${String(firmaName).trim()}: ${titel}` : titel).slice(0, 400);

// Anruf-Statistik fuer die Cold-Calling-Liste: gesamt, heute und die Zahl der Tage,
// an denen ueberhaupt telefoniert wurde (Grundlage fuer den Tagesdurchschnitt).
// besitzer: Wessen Liste gezaehlt wird. Ohne Angabe alle sichtbaren — das
// ergibt nur fuer eine Gesamtschau Sinn. Am Telefon arbeitet jeder SEINE
// Liste, und die Geschaeftsfuehrung sieht sonst fremde Anrufe als die eigenen:
// Bei Jannik standen zwoelf Anrufe und drei Erstgespraeche, die alle Ioannis
// gefuehrt hatte (29.07.).
module.exports.anrufStatistik = async function (user,
  { sparte = "", branche = "", ohneSparte = false, besitzer = null } = {}) {
  return alsNutzer(user.id, async (q) => {
    // Ein Lead = ein Call. Gezaehlt wird der AKTUELLE Stand des Leads (Tag), nicht
    // jeder Eintrag im Verlauf — wer ein Ergebnis korrigiert, erzeugt keinen zweiten
    // Anruf. Das Datum kommt vom letzten Anruf zu diesem Lead.
    // Leads ohne Sparten-Tag zaehlen zur Standard-Sparte, sonst waeren sie unsichtbar.
    const wo = `($1 = '' or f.tags @> array[$1]::text[]
               or ($3 and not (f.tags && array['webdesign','performance','ki']::text[])))
          and ($2 = '' or f.tags @> array[$2]::text[])
          and ($4::uuid is null or f.besitzer = $4::uuid)`;
    const a = [sparte, branche, ohneSparte, besitzer];
    const basis = `
      select (select t2 from unnest(f.tags) as t2
                where t2 = any(array['gebucht','follow-up','absage','nicht-erreicht','keine-zeit']::text[]) limit 1) as stand,
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
  // Das Ergebnis der Transaktion wird eingefangen: Ein neues oder verschobenes
  // Erstgespraech geht DANACH in den Kalender (siehe Ende der Funktion).
  const nachher = await alsNutzer(user.id, async (q) => {
    const sets = [], a = [];
    const setz = (spalte, wert) => { a.push(wert); sets.push(`${spalte} = $${a.length}`); };
    // Unzahlen ("abc") werden null, nicht NaN — NaN landete sonst in der
    // numeric-Spalte bzw. warf bei integer einen 500er (Pruefung 05.09.2026).
    const zahl = (v) => { if (v === "" || v === undefined || v === null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
    // Vorheriges Erstgespraech merken — nur wenn das Feld ueberhaupt mitkommt.
    // Daran entscheidet sich unten, ob der Kalender etwas zu tun bekommt.
    const vorher = d.erstgespraech_am !== undefined
      ? (await q(`select erstgespraech_am, adresse, plz, ort, anruf_notiz from firmen where id = $1`, [id])).rows[0] || null
      : null;
    if (d.quelle !== undefined) setz("quelle", d.quelle || null);
    // Die Uebergabe (d.besitzer) passiert ganz am ENDE dieser Funktion, nicht
    // hier. Grund: Danach gehoert die Akte jemand anderem, und alles, was
    // hinterher noch geschrieben wuerde, faellt an den Zeilenrechten ab —
    // stumm, mit 0 geaenderten Zeilen. Wer beim Uebergeben zugleich das
    // Erstgespraech eintraegt, haette es verloren.
    // Wer den Kunden GEHOLT hat. Etwas anderes als besitzer: die Betreuung darf
    // wechseln, ohne dass der Umsatz die Person wechselt (Migration 0047).
    if (d.gewonnen_durch !== undefined) {
      setz("gewonnen_durch", d.gewonnen_durch || null);
      await q(`update deals set gewonnen_durch = $2 where firma_id = $1`,
        [id, d.gewonnen_durch || null]);
    }
    if (d.kunde_seit !== undefined) setz("kunde_seit", d.kunde_seit || null);
    if (d.ansprech_name !== undefined) setz("geschaeftsfuehrer", d.ansprech_name || null);
    if (d.ansprech_rolle !== undefined) setz("ansprech_rolle", d.ansprech_rolle || null);
    if (d.geschlecht !== undefined) setz("geschlecht", d.geschlecht || null);
    if (d.taetigkeit !== undefined) setz("taetigkeit", d.taetigkeit || null);
    if (d.mitarbeiter_zahl !== undefined) setz("mitarbeiter_zahl", zahl(d.mitarbeiter_zahl));
    if (d.vertrag_laufzeit !== undefined) setz("vertrag_laufzeit", d.vertrag_laufzeit || null);
    // Wie viele Monatsbeitraege eingegangen sind (Migration 0045). Die Spalte
    // ist NOT NULL — ein leeres Feld muss darum 0 werden, nicht null.
    if (d.retainer_monate_bezahlt !== undefined) {
      const n = Number(d.retainer_monate_bezahlt);
      setz("retainer_monate_bezahlt", Number.isInteger(n) && n >= 0 && n <= 120 ? n : 0);
    }
    if (d.hosting !== undefined) setz("hosting", d.hosting === "" ? null : d.hosting === "ja");
    if (d.leads_ziel !== undefined) setz("leads_ziel", zahl(d.leads_ziel));
    if (d.leads_ist !== undefined) setz("leads_ist", zahl(d.leads_ist));
    if (d.telefon !== undefined) setz("telefon", d.telefon || null);
    if (d.email !== undefined) setz("email", d.email || null);
    if (d.website !== undefined) setz("website", d.website || null);
    if (d.ort !== undefined) setz("ort", d.ort || null);
    if (d.projekt_stand !== undefined) setz("projekt_stand", d.projekt_stand || null);
    // Freies Notizfeld der Akte (Migration 0041). Bewusst ohne Laengenbegrenzung
    // und ohne Aufbereitung: was hier steht, hat der Mensch so gemeint.
    if (d.notizen !== undefined) setz("notizen", d.notizen || null);
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
    // Kundenakte 2 (0057, 05.09.2026): Umsatz geschaetzt/geplant, Handy und die
    // Rechnungsadresse (adresse/plz gab es in der Tabelle laengst — nur die
    // Oberflaeche kannte sie nicht; Agent D1 liest sie fuer den
    // Rechnungsempfaenger). Der Score haengt jetzt am selben Formular wie
    // alles andere statt an einem eigenen Sofort-Speichern.
    if (d.umsatz_geschaetzt !== undefined) setz("umsatz_geschaetzt", zahl(d.umsatz_geschaetzt));
    if (d.umsatz_geplant !== undefined) setz("umsatz_geplant", zahl(d.umsatz_geplant));
    if (d.mobil !== undefined) setz("mobil", d.mobil || null);
    if (d.adresse !== undefined) setz("adresse", d.adresse || null);
    if (d.plz !== undefined) setz("plz", d.plz || null);
    if (d.score !== undefined) {
      // Leer loescht; 1-10 setzt; alles andere (99, "abc") laesst den Stand
      // unangetastet, statt ihn still zu loeschen.
      if (d.score === "" || d.score === null) setz("score", null);
      else { const s = Number(d.score); if (Number.isInteger(s) && s >= 1 && s <= 10) setz("score", s); }
    }
    // Branche als lesbarer Text in der Spalte (den liest der Kopf der Akte und
    // die Kurzakte im Kalender). Das Branchen-Tag fuer die Lead-Listen wird
    // weiter unten gesetzt, wenn ein Schluessel aus BRANCHEN mitkommt.
    if (d.branche !== undefined) setz("branche", d.branche || null);
    if (sets.length) {
      a.push(id);
      await q(`update firmen set ${sets.join(", ")}, letzte_aktivitaet = now() where id = $${a.length}`, a);
    }
    // Branchen-Tag wie bei Leads (leadBranche): genau ein Schluessel aus
    // BRANCHEN, die anderen fliegen raus. Leer = kein Branchen-Tag.
    if (d.branche_tag !== undefined && Array.isArray(d.branchen_alle) && d.branchen_alle.length) {
      await q(
        `update firmen set tags = (
           select coalesce(array_agg(t), '{}'::text[]) from unnest(tags) t where not (t = any($2::text[]))
         ) || case when $3 = '' then '{}'::text[] else array[$3]::text[] end
         where id = $1`, [id, d.branchen_alle, d.branche_tag || ""]);
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

    // ------------------------------------------------------- Uebergabe zuletzt
    //
    // Deals, Projekte und offene Aufgaben wandern mit — sonst sieht der neue
    // Verantwortliche die Akte, aber nicht das Projekt darin, und auf dem Brett
    // steht weiter der alte Name.
    //
    // Ueber firma_uebergeben() (Migration 0050) und NICHT ueber ein update
    // hier: Die Zeilenrechte verbieten, eine Zeile fuer sich selbst unsichtbar
    // zu machen — bei einer Uebergabe ist genau das der Zweck. Ein Mitarbeiter
    // bekam sonst "new row violates row-level security policy" und verlor beim
    // Speichern alles Eingetippte (06.08.2026, Simon, Fahrschule Baptistella).
    //
    // Steht bewusst ganz am Ende: Ab hier gehoert die Akte jemand anderem.
    if (d.besitzer) {
      const { rows: [bewegt] } = await q(
        `select * from firma_uebergeben($1::bigint, $2::uuid)`, [id, d.besitzer]);
      const n = (k) => Number((bewegt || {})[k] || 0);
      if (n("deals") + n("projekte") + n("aufgaben")) {
        const wer = (await q(`select name from profiles where id=$1`, [d.besitzer])).rows[0];
        const teile = [];
        if (n("deals")) teile.push(`${n("deals")} ${n("deals") === 1 ? "Abschluss" : "Abschlüsse"}`);
        if (n("projekte")) teile.push(`${n("projekte")} ${n("projekte") === 1 ? "Projekt" : "Projekte"}`);
        if (n("aufgaben")) teile.push(`${n("aufgaben")} ${n("aufgaben") === 1 ? "Aufgabe" : "Aufgaben"}`);
        await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'uebergabe',$3)`,
          [id, user.id, `Verantwortlich jetzt ${wer?.name || "jemand anderes"}` +
            (teile.length ? ` — ${teile.join(", ")} mitgewandert` : "")]);
      }
    }
    return { ok: true, vorher };
  });

  // Erstgespraech in den Kalender (Agent C) — nur wenn es neu gesetzt oder
  // verschoben wurde (Toleranz eine Minute, damit ein unveraendertes Feld beim
  // Speichern der Akte keinen Kalenderaufruf ausloest). Nach der Transaktion
  // und abgefangen: Der Kalender darf das Speichern nie scheitern lassen.
  const v = nachher && nachher.vorher;
  if (v && d.erstgespraech_am) {
    const alt = v.erstgespraech_am ? new Date(v.erstgespraech_am).getTime() : null;
    const neu = new Date(d.erstgespraech_am).getTime();
    if (!Number.isNaN(neu) && (alt === null || Math.abs(alt - neu) > 60000)) {
      await erstgespraechInKalender(user, id, {
        wann: d.erstgespraech_am,
        ort: [v.adresse, [v.plz, v.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        notiz: v.anruf_notiz || "",
      });
    }
  }
  return true;
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
      `insert into deals (firma_id, titel, sparte, stufe_id, besitzer, gewonnen_durch)
       values ($1,$2,$3,$4,$5,$5) returning id`,
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
          -- ::date, seit das Feld eine Uhrzeit traegt (0051). Ohne den Schnitt
          -- zaehlt hier nur, was auf die Sekunde Mitternacht steht — also
          -- ausgerechnet die Termine OHNE Uhrzeit, und die mit fielen raus.
          where f.besitzer = p.id and f.erstgespraech_am::date = current_date) as eg_gefuehrt,
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

// Kehrt zuKundeMachen um: Kundenakte irrtuemlich angelegt, zurueck zu Lead.
// "kunde_seit" wird geloescht, offene Deals/Projekte laufen unveraendert weiter.
module.exports.zuLeadMachen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    const f = (await q(`select status, name from firmen where id=$1`, [id])).rows[0];
    if (!f || f.status !== "kunde") return { ok: false };
    await q(`update firmen set status='lead', kunde_seit=null, letzte_aktivitaet=now() where id=$1`, [id]);
    await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'system',$3)`,
      [id, user.id, "Kundenakte entfernt — zurück zu Lead"]);
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
// besitzer/gewonnenDurch: Wer die Leads bekommt. Ohne Angabe der Importierende
// selbst — das war bis zum 29.07. fest verdrahtet, und damit landeten Leads,
// die fuer jemand anderen gedacht waren, in der eigenen Liste. Beim Einlesen
// einer Tabelle fuer einen Mitarbeiter ist das der Normalfall, nicht die
// Ausnahme.
module.exports.leadsAnlegen = async function (user, leads,
  { sparte = "", branche = "", besitzer = null, gewonnenDurch = null, listenName = "",
    listeId = "" } = {}) {
  return alsNutzer(user.id, async (q) => {
    let angelegt = 0; const uebersprungen = [], wemGehoert = {}, neueIds = [];
    for (const l of leads) {
      const name = (l.name || "").trim();
      if (!name) continue;
      // Eine Rufnummer ohne Ziffer ist keine. Passiert, wenn eine Spalte mit
      // einem anderen Zweck als Telefonfeld erkannt wurde — "Mobil optimiert"
      // (Werte ja/nein) landete am 19.08. als Handynummer in der Datenbank.
      // Der Schaden entstand nicht dort, sondern eine Zeile tiefer: Die
      // Dublettenpruefung vergleicht mobil gegen telefon, ab dem ersten
      // gespeicherten "ja" galt jede weitere "ja"-Zeile als Dublette und die
      // halbe Liste wurde stillschweigend uebersprungen.
      const ziffrig = (v) => (/\d/.test(v || "") ? String(v).trim() : "");
      const tel = ziffrig(l.telefon);
      const mob = ziffrig(l.mobil);
      // Ueber Kreuz geprueft (18.08.): Dieselbe Nummer steht in der einen Liste
      // unter "Telefon" und in der naechsten unter "Handy". Wer nur Spalte
      // gegen Spalte vergleicht, legt denselben Betrieb ein zweites Mal an —
      // und zwei Leute rufen dort an.
      const da = (await q(
        `select id from firmen
          where lower(name) = lower($1)
             or ($2 <> '' and (telefon = $2 or mobil = $2))
             or ($3 <> '' and (mobil = $3 or telefon = $3))
          limit 1`,
        [name, tel, mob])).rows[0];
      if (da) {
        // Wem gehoert der vorhandene Eintrag? Ohne diese Angabe steht in der
        // Maske nur "schon vorhanden", und man sucht die Firma in der eigenen
        // Liste, wo sie nicht sein kann.
        uebersprungen.push(name);
        const { rows: [w] } = await q(
          `select coalesce(p.name, 'ohne Besitzer') as wer from firmen f
             left join profiles p on p.id = f.besitzer where f.id = $1`, [da.id]);
        const wer = w ? w.wer : "unbekannt";
        wemGehoert[wer] = (wemGehoert[wer] || 0) + 1;
        continue;
      }
      const tags = [sparte, branche].filter(Boolean);
      const neu = (await q(
        `insert into firmen (name, status, branche, ort, telefon, mobil, website, geschaeftsfuehrer,
                             email, adresse, plz, quelle, tags, besitzer, gewonnen_durch)
         values ($1,'lead',$2,$3,$4,$5,$6,$7,$8,$9,$10,'Cold Calling',$11,$12,$13)
         returning id`,
        [name, (l.branche || "").trim() || null, (l.ort || "").trim() || null,
         tel || null, mob || null, webseite(l.website), (l.chef || "").trim() || null,
         (l.email || "").trim() || null, (l.adresse || "").trim() || null,
         (l.plz || "").trim() || null,
         tags, besitzer || user.id, gewonnenDurch || besitzer || user.id])
      ).rows[0];
      angelegt++;
      if (neu) neueIds.push(neu.id);
    }

    // Jeder Upload bekommt seine Liste (18.08.). Ohne die laesst sich hinterher
    // nicht mehr sagen, was zusammen hereingekommen ist: Eine Liste mit
    // Geschaeftsfuehrer-Handynummern mischt bewusst Branchen, der Branchen-
    // Filter findet sie also nie als Ganzes.
    //
    // Nur die NEU angelegten kommen hinein. Uebersprungene Doppelte gehoeren
    // schon einer frueheren Liste an — sie hier nochmal einzutragen hiesse,
    // denselben Lead unter zwei Herkuenften zu fuehren.
    // Eine bestehende Liste weiterfuehren statt jedes Mal eine neue anzulegen
    // (19.08.). Vorher entstand bei jedem Upload eine eigene Liste — nach fuenf
    // Anlaeufen mit derselben Branche standen fuenf Eintraege "Friseure"
    // nebeneinander im Filter, und keiner davon war die ganze Liste.
    let liste = null, listeNeu = false;
    if (neueIds.length) {
      const eigner = besitzer || user.id;
      if (listeId) {
        liste = (await q(
          `select id, name from call_listen where id = $1 and besitzer = $2`,
          [listeId, eigner])).rows[0];
        // Gehoert die Liste jemand anderem, wird NICHT still eine neue
        // angelegt: Der Nutzer hat eine bestimmte Liste gemeint.
        if (!liste) throw new Error("Diese Liste gibt es nicht mehr oder sie gehört jemand anderem.");
      } else {
        // Vorbelegung mit Uhrzeit, nicht nur Datum: Wer zweimal am selben Tag
        // hochlaedt, haette sonst zwei gleich beschriftete Eintraege im Filter.
        liste = (await q(
          `insert into call_listen (name, besitzer)
           values (coalesce(nullif(btrim($1), ''),
                            'Liste vom ' || to_char(now(), 'DD.MM.YYYY, HH24:MI')), $2)
           returning id, name`,
          [listenName, eigner])).rows[0];
        listeNeu = true;
      }
      await q(
        `insert into call_listen_eintraege (liste_id, firma_id)
         select $1, unnest($2::bigint[]) on conflict do nothing`,
        [liste.id, neueIds]);
    }

    return { angelegt, uebersprungen, listeNeu,
      liste: liste ? { id: Number(liste.id), name: liste.name } : null,
      gehoeren: Object.entries(wemGehoert).map(([wer, n]) => ({ wer, n })).sort((a, b) => b.n - a.n) };
  });
};

// Ist das eine Webseite, auf die man klicken kann? Gibt die fertige Adresse
// zurueck oder null.
//
// Warum es das braucht (06.08.2026): In einer importierten Tabelle stand in der
// Spalte Website woertlich "keine". Fuer die Anzeige war das ein Wert wie jeder
// andere — sie baute <a href="keine"> daraus. Ohne http:// davor liest der
// Browser das als Adresse INNERHALB des CRM: Aus "keine Webseite" wurde ein
// Link auf eine CRM-Seite, die es nicht gibt. Im Cold Calling klickt man genau
// da drauf, weil man sehen will, wie die Seite aussieht.
//
// Zwei Faelle, die auseinandergehalten werden muessen:
//   "keine", "-", "n/a"   -> es gibt keine. Beim Webdesign das beste
//                            Verkaufsargument — darf nicht wie ein Link aussehen.
//   "beispiel.de"         -> es gibt eine, nur ohne Protokoll. Bekommt https://.
//
// Steht hier und nicht in den Routen, weil JEDER Weg hier vorbeikommt: die
// Maske, der Tabellen-Import, scripts/leads-import.js und Hermes. Eine
// Pruefung in der Anzeige haette den Platzhalter in der Datenbank gelassen,
// und jede Auswertung "wie viele haben keine Seite?" haette ihn mitgezaehlt.
const WEBSEITE_PLATZHALTER = new Set(["keine", "kein", "keine webseite", "keine website",
  "nein", "-", "--", "—", "–", ".", "/", "n/a", "na", "none", "null", "ka", "k.a."]);
function webseite(wert) {
  const roh = String(wert || "").trim();
  if (!roh || WEBSEITE_PLATZHALTER.has(roh.toLowerCase())) return null;
  const mitProtokoll = /^https?:\/\//i.test(roh) ? roh : "https://" + roh;
  // Letzter Filter: Was keinen Punkt im Hostnamen hat, ist keine Domain,
  // sondern ein Platzhalter, den die Liste oben noch nicht kennt.
  try {
    const url = new URL(mitProtokoll);
    return url.hostname.includes(".") ? mitProtokoll : null;
  } catch { return null; }
}
module.exports.webseite = webseite;

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

// Mehrere Leads auf einmal aendern (05.08.): Branche, Bereich und Besitzer.
//
// Warum das gebraucht wird: Nach einem Import mit der falschen Vorauswahl
// stehen 107 Leads mit der falschen Branche da. Einzeln umzustellen heisst
// 107 Mal klicken — in der Praxis macht das niemand, und die Liste bleibt
// falsch. Am 05.08. musste genau das von Hand in der Datenbank geradegezogen
// werden; danach war klar, dass es dafuer einen Weg in der Oberflaeche braucht.
//
// besitzer nur fuer die Geschaeftsfuehrung — dieselbe Regel wie beim Hochladen:
// niemand schiebt einem anderen ungefragt Arbeit in die Liste. Die Pruefung
// steht in der Route, hier wird nur ausgefuehrt, was ankommt.
//
// RLS bleibt die Wahrheit: firmen_aendern laesst Mitarbeiter nur ihre eigenen
// Zeilen anfassen. Wer fremde ids mitschickt, aendert sie nicht — sie fallen
// stumm aus dem update heraus. Darum wird die tatsaechliche Trefferzahl
// zurueckgegeben und nicht die Zahl der geschickten ids.
module.exports.leadsSammelAendern = async function (user, ids, { branche, sparte, besitzer } = {},
  { alleBranchen = [], alleSparten = [] } = {}) {
  const liste = (ids || []).map(Number).filter((n) => Number.isFinite(n));
  if (!liste.length) return { geaendert: 0 };
  return alsNutzer(user.id, async (q) => {
    const setz = [], a = [liste];
    // Tags: erst die alte Sparte/Branche herausfiltern, dann die neue anhaengen.
    // Beides in EINEM Ausdruck, sonst ueberschreibt der zweite update den ersten.
    const weg = [], dazu = [];
    if (branche !== undefined) { weg.push(...alleBranchen); if (branche) dazu.push(branche); }
    if (sparte !== undefined) { weg.push(...alleSparten); if (sparte) dazu.push(sparte); }
    if (weg.length) {
      a.push(weg); const iWeg = a.length;
      a.push(dazu); const iDazu = a.length;
      setz.push(`tags = (
        select coalesce(array_agg(t), '{}'::text[]) from unnest(tags) t
         where not (t = any($${iWeg}::text[]))
      ) || $${iDazu}::text[]`);
    }
    if (besitzer) {
      a.push(besitzer); setz.push(`besitzer = $${a.length}::uuid`);
    }
    if (!setz.length) return { geaendert: 0 };
    setz.push("letzte_aktivitaet = now()");
    const { rowCount } = await q(
      `update firmen set ${setz.join(", ")} where id = any($1::bigint[])`, a);
    return { geaendert: rowCount };
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
//
// Zwei Personen je Aufgabe (seit 05.09.2026, Migration 0058): besitzer ist,
// wer sie ANGELEGT hat; verantwortlich ist, wer sie ERLEDIGT (null = der
// Besitzer selbst). "Eigene Aufgaben" heisst darum ueberall in diesem Block:
//
//     (a.besitzer = ich or a.verantwortlich = ich)
//
// — dieselbe Bedingung wie in den RLS-Regeln (0058) und wie sie die Zaehlung
// in zentraleZahlen() braucht. Lukas gibt Louis eine Aufgabe: Louis sieht sie
// mit "von Lukas", Lukas mit "fuer Louis", beide duerfen abhaken.
// Und eine KUNDEN-Aufgabe (firma_id) landet beim Anlegen als Zeile auf dem
// Whiteboard des Verantwortlichen, Kategorie Kunden (lib/aufgaben-tafel.js).
module.exports.todoListe = async function (user, { nurOffen = false } = {}) {
  return alsNutzer(user.id, async (q) => {
    const w = nurOffen ? "and a.erledigt = false" : "";
    // Der Firmenname kommt aus dem Join — oder, wenn mir die Akte nicht
    // freigegeben ist (RLS auf firmen; jemand gab mir eine Aufgabe zu SEINEM
    // Kunden), aus aufgabe_firma_name() (0058): nur der Name, sonst nichts.
    // firma_sichtbar sagt der Oberflaeche, ob sie in die Akte verlinken darf.
    const { rows } = await q(
      `select a.*, coalesce(f.name, aufgabe_firma_name(a.id)) as firma_name,
              (f.id is not null) as firma_sichtbar,
              f.geschaeftsfuehrer, f.ansprech_rolle, f.telefon, f.email, f.ort,
              pv.name as verantwortlich_name, pb.name as besitzer_name,
              -- Die Sparte einer Aufgabe steht nicht an der Aufgabe, sondern am
              -- Kunden: zuerst sein Tag, sonst die Sparte seines juengsten Deals.
              -- Sie faerbt die Karte (Webdesign blau, Performance orange, KI weinrot).
              coalesce(
                (select t from unnest(f.tags) t where t in ('webdesign','performance','ki') limit 1),
                (select d.sparte from deals d where d.firma_id = f.id order by d.erstellt desc limit 1)
              ) as sparte
         from aufgaben a left join firmen f on f.id = a.firma_id
              left join profiles pv on pv.id = a.verantwortlich
              left join profiles pb on pb.id = a.besitzer
        where (a.besitzer = $1 or a.verantwortlich = $1) ${w}
        order by a.erledigt, a.geplant_am nulls last, a.faellig nulls last, a.erstellt desc`,
      [user.id]);
    return rows;
  });
};

// d: {titel*, firma_id, faellig, geplant_am, notiz, wichtigkeit, dringlichkeit,
//     verantwortlich (uuid aus dem Team; fehlt oder unbekannt = ich),
//     anlass (0066 — warum es die Aufgabe gibt: 'anruf:gebucht' & Co.; leer
//     bei allem, was von Hand angelegt wird)}.
// Alles ausser titel darf fehlen — der "Neuer Kunde"-Dialog schickt nur
// titel, firma_id und verantwortlich. Rueckgabe: die neue id (null ohne Titel).
//
// Die Tafel kommt NACH dem Speichern dran, in eigener Transaktion: Scheitert
// das Whiteboard (Datenbank, fremde Tafel, was auch immer), steht die Aufgabe
// trotzdem in der Liste — der Grund landet im Log, nicht beim Nutzer.
module.exports.todoAnlegen = async function (user, d) {
  d = d || {};
  const titel = String(d.titel || "").trim();
  if (!titel) return null;
  const w = Number(d.wichtigkeit);
  const firmaId = Number(d.firma_id) > 0 ? Number(d.firma_id) : null;
  const dringlichkeit = DRINGLICHKEITEN.includes(d.dringlichkeit) ? d.dringlichkeit : null;
  const verantwortlich = await todoVerantwortlichPruefen(user, d.verantwortlich);
  const { id, firmaName } = await alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `insert into aufgaben (titel, firma_id, faellig, geplant_am, notiz, besitzer,
                             wichtigkeit, dringlichkeit, verantwortlich, anlass)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [titel, firmaId, d.faellig || null, d.geplant_am || null, d.notiz || null, user.id,
       w >= 1 && w <= 4 ? w : 3, dringlichkeit, verantwortlich,
       String(d.anlass || "").trim().slice(0, 40) || null]);
    let firmaName = null;
    if (firmaId) {
      const f = await q(`select name from firmen where id = $1`, [firmaId]);
      firmaName = f.rows[0] ? f.rows[0].name : null;
    }
    return { id: rows[0].id, firmaName };
  });
  if (firmaId) {
    // Welche Kategorie, entscheidet der Anlass: "anruf:*" -> CRM-Block,
    // alles von Hand Angelegte -> Kunden-Block (kategorieFuerAnlass).
    await todoAufTafel(user, { id, titel, firma_id: firmaId, firma_name: firmaName,
                               verantwortlich: verantwortlich || user.id, erledigt: false },
                       kategorieFuerAnlass(d.anlass));
    // Und in den Google-Kalender, wenn ein Tag feststeht. Nach dem Speichern,
    // abgefangen, abschaltbar — siehe aufgabeInKalender().
    await aufgabeInKalender(user, id);
  }
  return id;
};

// Tag zuweisen / verschieben (geplant_am)
module.exports.todoPlanen = async function (user, id, geplant_am) {
  await alsNutzer(user.id, async (q) => {
    await q(`update aufgaben set geplant_am=$2 where id=$1 and (besitzer=$3 or verantwortlich=$3)`,
            [id, geplant_am || null, user.id]);
    return true;
  });
  // Der Termin wandert mit: verschoben, neu angelegt oder — wenn das Datum
  // geloescht wurde — abgesagt. aufgabeInKalender entscheidet das selbst.
  await aufgabeInKalender(user, id);
  return true;
};

// Abhaken (oder wieder oeffnen) — und die Zeile auf dem Whiteboard zieht mit,
// wenn die Aufgabe dort steht (tafel_element). Der Haken in der Liste ist die
// Wahrheit; die Tafel folgt ihr, und wenn sie es nicht kann (Element
// gewischt, kein Recht), bleibt die Liste trotzdem richtig.
module.exports.todoErledigt = async function (user, id, erledigt = true) {
  const { rows } = await alsNutzer(user.id, (q) => q(
    `update aufgaben set erledigt=$2 where id=$1 and (besitzer=$3 or verantwortlich=$3)
     returning tafel_element`, [id, !!erledigt, user.id]));
  const element = rows[0] && rows[0].tafel_element;
  if (element) await todoHakenAufTafel(user, id, element, !!erledigt);
  // Und der Kalender: abgehakt heisst abgesagt, wieder geoeffnet heisst
  // wieder eingetragen. Beides derselbe Eingang.
  if (rows.length) await aufgabeInKalender(user, id);
  return true;
};

// Loeschen darf, wer sie angelegt hat, und wer sie erledigen soll — wie am
// Whiteboard, wo der Tafel-Besitzer wegwischt, was andere ihm hinschrieben.
// Die Tafelzeile bleibt stehen (ihr Bezug greift dann ins Leere, still).
module.exports.todoLoeschen = async function (user, id) {
  // Die Kalender-Kennung VOR dem Loeschen holen — danach gibt es die Zeile
  // nicht mehr, und der Termin stuende fuer immer im Kalender. Eigener,
  // abgefangener Griff: Fehlt die Spalte (0067 nicht eingespielt), wird
  // trotzdem geloescht.
  let termin = null;
  try {
    const { rows } = await alsNutzer(user.id, (q) => q(
      `select kalender_termin from aufgaben
        where id=$1 and (besitzer=$2 or verantwortlich=$2)`, [id, user.id]));
    termin = rows[0] && rows[0].kalender_termin;
  } catch { termin = null; }
  await alsNutzer(user.id, async (q) => {
    await q(`delete from aufgaben where id=$1 and (besitzer=$2 or verantwortlich=$2)`, [id, user.id]);
    return true;
  });
  if (termin && kalenderAufgabenAn()) await aufgabeAusKalender(user, id, termin);
  return true;
};

// Aufgaben, die fuer HEUTE geplant sind (fuer "Heute zu tun")
module.exports.todosHeute = async function (user) {
  return alsNutzer(user.id, async (q) => {
    const heute = heuteISO();
    const { rows } = await q(
      `select a.*, coalesce(f.name, aufgabe_firma_name(a.id)) as firma_name,
              (f.id is not null) as firma_sichtbar,
              f.geschaeftsfuehrer, f.ansprech_rolle, f.telefon, f.email, f.ort,
              pv.name as verantwortlich_name, pb.name as besitzer_name,
              -- Die Sparte einer Aufgabe steht nicht an der Aufgabe, sondern am
              -- Kunden: zuerst sein Tag, sonst die Sparte seines juengsten Deals.
              -- Sie faerbt die Karte (Webdesign blau, Performance orange, KI weinrot).
              coalesce(
                (select t from unnest(f.tags) t where t in ('webdesign','performance','ki') limit 1),
                (select d.sparte from deals d where d.firma_id = f.id order by d.erstellt desc limit 1)
              ) as sparte
         from aufgaben a left join firmen f on f.id = a.firma_id
              left join profiles pv on pv.id = a.verantwortlich
              left join profiles pb on pb.id = a.besitzer
        where (a.besitzer=$1 or a.verantwortlich=$1) and a.erledigt=false and a.geplant_am = $2
        order by a.faellig nulls last, a.erstellt`,
      [user.id, heute]);
    return rows;
  });
};

// ------------------------------------------------------------- Zentrale
//
// Alle Zahlen der Startseite in EINEM Aufruf. Die Zentrale zeigt dieselben
// Groessen wie das CRM-Dashboard — Umsatz, Verlauf, Forecast —, und sie muss
// dieselben Werte zeigen wie dort. Deshalb wird hier nichts neu erfunden:
// gerechnet wird auf denselben Tabellen, und die Abschlusschance je Phase kommt
// aus lib/pipeline-quoten.js, aus der auch das CRM-Dashboard liest.
//
// Warum eine eigene Funktion und nicht kennzahlen(): kennzahlen() liefert
// Zaehlstaende fuer eine Karte. Hier braucht es zusaetzlich den Zwoelf-Monats-
// Verlauf und den gewichteten Forecast — beides zu teuer, um es jeder Seite
// aufzuzwingen, die nur wissen will, wie viele Deals offen sind.
module.exports.zentraleZahlen = async function (user) {
  const { wahrsch } = require("./pipeline-quoten.js");
  return alsNutzer(user.id, async (q) => {
    // --- Umsatz: laufender Monat, Vormonat, und alles seit Beginn ---
    //
    // UMSATZ = abgeschlossenes Geschaeft, nicht eingegangenes Geld.
    //
    // Ein Deal auf "gewonnen" zaehlt hier, auch wenn der Kunde noch nicht
    // ueberwiesen hat. Was tatsaechlich auf dem Konto ist, steht in der
    // Buchhaltung unter Einnahmen — das sind zwei verschiedene Fragen, und
    // beide muessen nebeneinander stehen koennen: 2.000 Umsatz bei 0 Einnahmen
    // heisst "gewonnen, Rechnung offen".
    //
    // (Am 28.07. war das kurz auf bezahlte Einnahmen umgestellt — falsch herum.
    // Die Luecke war nicht die Definition, sondern dass von Hand angelegte
    // Kunden keinen Deal hatten. Den legt die Akte jetzt selbst an, siehe
    // dealAusAkte weiter unten.)
    const { rows: [u] } = await q(
      `select
         coalesce(sum(wert) filter (where geschlossen_am >= date_trunc('month', current_date)), 0)::numeric as monat,
         coalesce(sum(wert) filter (where geschlossen_am >= date_trunc('month', current_date) - interval '1 month'
                                      and geschlossen_am <  date_trunc('month', current_date)), 0)::numeric as vormonat,
         coalesce(sum(wert), 0)::numeric as gesamt,
         count(*) filter (where geschlossen_am >= date_trunc('month', current_date))::int as anzahl_monat,
         count(*)::int as anzahl_gesamt
       from deals where status = 'gewonnen'`);

    // --- Verlauf: die letzten zwoelf Monate, Luecken als 0 ---
    // generate_series statt group by: ein Monat ohne Abschluss muss als Null in
    // der Kurve stehen. Ohne ihn ruecken die Punkte zusammen und die Kurve
    // behauptet einen gleichmaessigen Verlauf, den es nicht gab.
    const { rows: verlauf } = await q(
      `select to_char(m, 'YYYY-MM') as monat,
              coalesce((select sum(d.wert) from deals d
                         where d.status = 'gewonnen'
                           and date_trunc('month', d.geschlossen_am) = m), 0)::numeric as wert
         from generate_series(date_trunc('month', current_date) - interval '11 months',
                              date_trunc('month', current_date), interval '1 month') as m
        order by m`);

    // --- Forecast: offene Deals, gewichtet nach der Phase, in der sie stehen ---
    const { rows: offene } = await q(
      `select d.wert, d.erwartet_am, s.name as stufe, s.position,
              (select count(*) from pipeline_stages s2
                where s2.sparte = s.sparte and s2.art = s.art) as stufen_gesamt
         from deals d left join pipeline_stages s on s.id = d.stufe_id
        where d.status = 'offen'`);

    let forecast = 0, erwartet30 = 0, pipeline = 0;
    const grenze30 = new Date(Date.now() + 31 * 86400000);
    for (const d of offene) {
      const wert = Number(d.wert || 0);
      pipeline += wert;
      // position ist 1-basiert, wahrsch() erwartet den Index ab 0.
      const anteil = wahrsch(Number(d.stufen_gesamt || 1), Math.max(0, Number(d.position || 1) - 1), d.stufe) / 100;
      forecast += wert * anteil;
      if (d.erwartet_am && new Date(d.erwartet_am) <= grenze30) erwartet30 += wert * anteil;
    }

    // --- To-Dos: was heute ansteht und was ueberfaellig ist ---
    const { rows: [t] } = await q(
      `select
         count(*) filter (where not erledigt)::int as offen,
         count(*) filter (where not erledigt and geplant_am = current_date)::int as heute,
         count(*) filter (where not erledigt and faellig < current_date)::int as ueberfaellig,
         count(*) filter (where erledigt and geplant_am = current_date)::int as heute_erledigt
       from aufgaben where (besitzer = $1 or verantwortlich = $1)`, [user.id]);

    const { rows: [f] } = await q(
      `select count(*) filter (where status = 'kunde')::int as kunden,
              count(*) filter (where status = 'lead')::int as leads
         from firmen`);

    return {
      umsatz: {
        monat: Number(u.monat), vormonat: Number(u.vormonat), gesamt: Number(u.gesamt),
        anzahl_monat: u.anzahl_monat, anzahl_gesamt: u.anzahl_gesamt,
      },
      verlauf: verlauf.map((v) => ({ monat: v.monat, wert: Number(v.wert) })),
      forecast: Math.round(forecast),
      erwartet30: Math.round(erwartet30),
      pipeline_wert: pipeline,
      offene_deals: offene.length,
      kunden: f.kunden, leads: f.leads,
      todos: t,
    };
  });
};

// Wichtigkeit und Dringlichkeit einer Aufgabe aendern.
//
// Braucht es, weil die Vier-Spalten-Tafel unter /todos echt ist: was dort von
// "Kann warten" nach "Sehr wichtig" gezogen wird, steht nach dem Neuladen auch
// dort. (Die gleich aussehende Tafel im CRM-Dashboard zeigt Beispieldaten und
// vergisst das Ziehen beim Neuladen — sie hat nie eine Speicherroute bekommen.)
//
// wichtigkeit: 1 = Sehr wichtig … 4 = Kann warten. Alles ausserhalb wird
// abgelehnt, damit aus einer manipulierten Anfrage keine fuenfte Spalte wird.
const DRINGLICHKEITEN = ["Extrem dringend", "Dringend", "ASAP", "Bald", "Wenn Zeit da ist"];
module.exports.DRINGLICHKEITEN = DRINGLICHKEITEN;

// Die vier Wichtigkeitsstufen. Stehen hier und nicht in den Routen, weil sie
// inzwischen an drei Stellen gebraucht werden: die Tafel im CRM-Dashboard, das
// Formular unter /crm/todos und die Tafel unter /todos. Drei Kopien derselben
// Liste waeren drei Gelegenheiten, dass "wichtig" woanders etwas anderes heisst.
const WICHTIGKEITEN = [
  { n: 1, titel: "Sehr wichtig" },
  { n: 2, titel: "Wichtig" },
  { n: 3, titel: "Sollte erledigt werden" },
  { n: 4, titel: "Kann warten" },
];
module.exports.WICHTIGKEITEN = WICHTIGKEITEN;

module.exports.todoEinstufen = async function (user, id, { wichtigkeit, dringlichkeit } = {}) {
  const w = Number(wichtigkeit);
  const gueltigW = w >= 1 && w <= 4;
  const gueltigD = dringlichkeit === null || DRINGLICHKEITEN.includes(dringlichkeit);
  if (!gueltigW && dringlichkeit === undefined) return { ok: false, grund: "wichtigkeit" };
  if (dringlichkeit !== undefined && !gueltigD) return { ok: false, grund: "dringlichkeit" };
  return alsNutzer(user.id, async (q) => {
    const setzen = [], werte = [id, user.id];
    if (gueltigW) { werte.push(w); setzen.push(`wichtigkeit = $${werte.length}`); }
    if (dringlichkeit !== undefined) { werte.push(dringlichkeit); setzen.push(`dringlichkeit = $${werte.length}`); }
    if (!setzen.length) return { ok: false, grund: "nichts" };
    const { rowCount } = await q(
      `update aufgaben set ${setzen.join(", ")} where id = $1 and (besitzer = $2 or verantwortlich = $2)`, werte);
    return { ok: rowCount > 0 };
  });
};

// ---------------------------------------- Verantwortlicher und Whiteboard
//
// Wer darf verantwortlich sein? Jede aktive Person im Team — geprueft gegen
// team(), nicht nur gegen das uuid-Muster: Eine getippte fremde id zerschellte
// sonst am Fremdschluessel (haesslicher 500er), und eine inaktive Person
// bekaeme Aufgaben auf eine Tafel, die niemand mehr ansieht. Die eigene id
// und alles Ungueltige ergeben null (= der Besitzer selbst).
async function todoVerantwortlichPruefen(user, wert) {
  const id = String(wert || "").trim().toLowerCase();
  if (!id || id === String(user.id).toLowerCase()) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
  const leute = await team(user);
  return leute.some((p) => String(p.id).toLowerCase() === id) ? id : null;
}

// Eine Kunden-Aufgabe auf die Tafel des Verantwortlichen schreiben und sich
// das Element an der Aufgabe merken (tafel_element/tafel_gesetzt). Wirft nie:
// die Aufgabe ist da schon gespeichert, die Tafel ist Zugabe. Exportiert,
// damit eine bestehende Aufgabe nachtraeglich hochgereicht werden kann.
//   aufgabe: {id, titel, firma_id, firma_name, verantwortlich, erledigt}
//   kategorie: In welchen Kategorie-Block (Vorgabe "kunden"). Seit 08.09.2026
//     schickt todoAnlegen hier "crm" hin, wenn die Aufgabe aus einem
//     Anrufergebnis stammt.
async function todoAufTafel(user, aufgabe, kategorie) {
  let r;
  try { r = await require("./aufgaben-tafel.js").aufgabeAufTafel(user, aufgabe, { kategorie }); }
  catch (e) { r = { ok: false, grund: String(e.message).slice(0, 160) }; }
  if (!r || !r.ok) {
    console.error(`Aufgabe ${aufgabe.id}: nicht aufs Whiteboard gekommen —`, (r && r.grund) || "unbekannt");
    return r || { ok: false, grund: "unbekannt" };
  }
  try {
    await alsNutzer(user.id, (q) => q(
      `update aufgaben set tafel_element = $2, tafel_gesetzt = now() where id = $1`, [aufgabe.id, r.element]));
  } catch (e) {
    console.error(`Aufgabe ${aufgabe.id}: Tafel-Bezug nicht gemerkt —`, String(e.message).slice(0, 160));
  }
  return r;
}
module.exports.todoAufTafel = todoAufTafel;

// Den Haken der Liste auf die Tafelzeile uebertragen — ueber die
// Datenbankfunktion aufgabe_haken_auf_tafel() aus 0058, nicht ueber den
// Whiteboard-Speicher: Die Zeile kann inzwischen in einem Block liegen, der
// dem Abhakenden nicht gehoert (Louis hat sie in seinen eigenen Block
// gezogen; Lukas ist dort weder Autor noch Tafel-Besitzer). Die Funktion
// prueft selbst, dass der Aufrufer Besitzer oder Verantwortlicher der
// Aufgabe ist, und schreibt dann am RLS des Elements vorbei — nur diese
// eine Zeile, nur den Haken. Eigene Transaktion: Scheitert sie, bleibt der
// Haken in der Liste trotzdem gesetzt.
//
// Gibt es das Element gar nicht mehr (hart geloescht, "weg"), wird der
// Bezug geloest — bei jedem spaeteren Haken ins Leere zu greifen waere
// sinnlos. Ein nur WEICH geloeschtes Element behaelt den Bezug: Kommt es
// per Rueckgaengig zurueck, zieht die Route den Haken aus der Liste nach.
async function todoHakenAufTafel(user, aufgabeId, element, erledigt) {
  let stand;
  try {
    const { rows } = await alsNutzer(user.id, (q) =>
      q(`select aufgabe_haken_auf_tafel($1, $2) as stand`, [aufgabeId, !!erledigt]));
    stand = rows[0] && rows[0].stand;
  } catch (e) {
    console.error(`Aufgabe ${aufgabeId}: Haken nicht aufs Whiteboard gekommen —`, String(e.message).slice(0, 160));
    return { ok: false, grund: String(e.message).slice(0, 160) };
  }
  if (stand === "ok" || stand === "unveraendert") return { ok: true, stand };
  if (stand === "weg") {
    try {
      await alsNutzer(user.id, (q) => q(
        `update aufgaben set tafel_element = null where id = $1 and tafel_element = $2`, [aufgabeId, element]));
    } catch (e) {
      console.error(`Aufgabe ${aufgabeId}: Tafel-Bezug nicht geloest —`, String(e.message).slice(0, 160));
    }
  } else if (stand !== "geloescht" && stand !== "zeile") {
    console.error(`Aufgabe ${aufgabeId}: Haken nicht aufs Whiteboard gekommen —`, stand);
  }
  return { ok: false, grund: stand };
}

// Den TEXT einer Tafelzeile nachziehen — das Gegenstueck zum Haken, ueber
// aufgabe_text_auf_tafel() aus 0066 und aus denselben Gruenden: Die Zeile
// kann in einem fremden Block liegen, und die Datenbankfunktion aendert nur
// genau die Zeile mit diesem Aufgaben-Bezug, nur ihren Text.
//
// Gebraucht wird das, wenn eine bestehende Aufgabe einen neuen Titel bekommt
// (anrufAufgabe: zweiter Anruf, neue Uhrzeit). Neu aufs Brett schreiben ginge
// nicht — aufgabeAufTafel() haengt immer an, es stuenden zwei Zeilen da.
//
// Eigene Transaktion, Fehler nur ins Log: Der Titel in der Liste stimmt schon.
async function todoTextAufTafel(user, aufgabeId, text) {
  let stand;
  try {
    const { rows } = await alsNutzer(user.id, (q) =>
      q(`select aufgabe_text_auf_tafel($1, $2) as stand`, [aufgabeId, String(text || "")]));
    stand = rows[0] && rows[0].stand;
  } catch (e) {
    console.error(`Aufgabe ${aufgabeId}: Text nicht aufs Whiteboard gekommen —`, String(e.message).slice(0, 160));
    return { ok: false, grund: String(e.message).slice(0, 160) };
  }
  if (stand === "ok" || stand === "unveraendert") return { ok: true, stand };
  // "kein-bezug" ist kein Fehler: Die Aufgabe war nie auf einer Tafel (etwa
  // weil die Bruecke beim Anlegen nicht durchkam). Die uebrigen Staende
  // ("weg", "geloescht", "zeile") loesen hier bewusst KEINEN Bezug — das
  // besorgt todoHakenAufTafel beim naechsten Abhaken, und ein Titel ist kein
  // Grund, die Verbindung zur Tafel zu kappen.
  if (stand !== "kein-bezug") {
    console.error(`Aufgabe ${aufgabeId}: Text nicht aufs Whiteboard gekommen —`, stand);
  }
  return { ok: false, grund: stand };
}
module.exports.todoTextAufTafel = todoTextAufTafel;

// ---------------------------------------------- Projekt-Phase aus der Kundenakte
//
// Verbindet die Kundenakte mit der Projektabwicklung (28.07.2026).
//
// Bis dahin gab es in der Akte drei allgemeine Staende — "Onboarding",
// "In Umsetzung", "Live · fertig" — als reines Textfeld. Die Projektabwicklung
// daneben hatte laengst die echten Phasen je Bereich (Webdesign:
// Designvorschlag erstellen … Wartung), aber die beiden wussten nichts
// voneinander. Wer in der Akte "In Umsetzung" waehlte, sah auf dem Brett
// nichts, und wer auf dem Brett eine Karte zog, aenderte in der Akte nichts.
//
// Jetzt ist die Phase in der Akte DIESELBE Sache wie die Spalte auf dem Brett.
// Gibt es noch kein Projekt fuer diesen Kunden, wird es angelegt — genau das
// ist der Normalfall bei einem Kunden, der ohne Deal von Hand erfasst wurde.
//
// stufeId muss zur Sparte gehoeren; eine Stufe aus einem fremden Bereich wird
// abgelehnt, statt ein Projekt in eine Spalte zu setzen, die es dort nicht gibt.
module.exports.projektStufeSetzen = async function (user, firmaId, stufeId) {
  return alsNutzer(user.id, async (q) => {
    if (!stufeId) return { ok: false, grund: "keine-stufe" };
    const { rows: [stufe] } = await q(
      `select id, sparte, name, ist_abschluss from pipeline_stages
        where id = $1 and art = 'projekt'`, [stufeId]);
    if (!stufe) return { ok: false, grund: "unbekannte-stufe" };

    const { rows: [firma] } = await q(`select id, name from firmen where id = $1`, [firmaId]);
    if (!firma) return { ok: false, grund: "firma" };

    // Ein Projekt je Kunde und Bereich. Mehr waeren zwei Karten fuer dieselbe
    // Arbeit auf demselben Brett.
    // Auch fertige Projekte zaehlen hier mit: Wer nach dem Livegang zurueck auf
    // "Änderungswünsche umsetzen" stellt, soll dasselbe Projekt wieder oeffnen
    // und nicht ein zweites daneben bekommen.
    const { rows: [vorhanden] } = await q(
      `select id, stufe_id from projekte
        where firma_id = $1 and sparte = $2 and status <> 'abgebrochen'
        order by (status = 'fertig'), erstellt desc limit 1`, [firmaId, stufe.sparte]);

    if (vorhanden) {
      if (String(vorhanden.stufe_id) === String(stufe.id)) return { ok: true, unveraendert: true };
      // Die Abschluss-Stufe schliesst das Projekt (Korrektur 28.07.): Bei
      // Webdesign heisst sie "Live" — ist die Seite online, ist das Projekt
      // fertig und faellt vom Brett. Wer zurueck auf eine fruehere Phase geht,
      // macht es wieder auf; das kommt vor, wenn nach dem Livegang doch noch
      // etwas nachkommt.
      await q(`update projekte set stufe_id = $2, status = $3 where id = $1`,
        [vorhanden.id, stufe.id, stufe.ist_abschluss ? "fertig" : "laeuft"]);
      await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'stufenwechsel',$3)`,
        [firmaId, user.id, `Projektphase: ${stufe.name} (${stufe.sparte})`]);
      return { ok: true, projektId: vorhanden.id, verschoben: true };
    }

    const { rows: [neu] } = await q(
      `insert into projekte (firma_id, titel, sparte, stufe_id, besitzer, status)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [firmaId, firma.name, stufe.sparte, stufe.id, user.id,
       stufe.ist_abschluss ? "fertig" : "laeuft"]);
    await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'system',$3)`,
      [firmaId, user.id, `Projekt angelegt · Phase: ${stufe.name} (${stufe.sparte})`]);
    return { ok: true, projektId: neu.id, angelegt: true };
  });
};

// Die Projekt-Phasen eines Bereichs, in ihrer Reihenfolge — fuer die Auswahl
// in der Kundenakte. Dieselbe Liste, aus der das Brett seine Spalten baut.
module.exports.projektStufen = async function (user, sparte) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select id, name, position, ist_abschluss from pipeline_stages
        where art = 'projekt' and sparte = $1 order by position`, [sparte]);
    return rows;
  });
};

// In welcher Phase steckt der Kunde gerade? Fuer die Vorauswahl in der Akte.
module.exports.projektVonFirma = async function (user, firmaId, sparte) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [p] } = await q(
      `select p.id, p.stufe_id, p.status, s.name as stufe_name
         from projekte p left join pipeline_stages s on s.id = p.stufe_id
        where p.firma_id = $1 and p.sparte = $2 and p.status <> 'abgebrochen'
        order by (p.status = 'fertig'), p.erstellt desc limit 1`, [firmaId, sparte]);
    return p || null;
  });
};

// ------------------------------------------------- Dokumente in der Kundenakte
//
// Die Ablage hat bis zum 28.07. nichts gespeichert — Dateien wurden angezeigt
// und waren beim naechsten Laden weg.
//
// Es gibt zwei Ablagen, und das ist Absicht, keine Doppelung:
//
//   RECHNUNG AN DEN KUNDEN  ->  belege
//       Sie muss durch die Buchhaltung: geprueft, gebucht, in den Monatsordner,
//       mit Laufnummer und Pruefsumme, unloeschbar (Trigger aus 0024). Wer sie
//       in der Akte ablegt, legt sie damit auch in der Buchhaltung ab — sie
//       erscheint dort unter "Rechnungen an Kunden" und wartet auf "Passt".
//
//   ALLES ANDERE            ->  dokumente
//       Vertraege, Briefings, Logos, Zugangsdaten. Das geht die Buchhaltung
//       nichts an und darf auch wieder geloescht werden.
//
// Der Rueckweg ist derselbe Draht: belege.firma_id. Eine Rechnung, die in der
// Buchhaltung hochgeladen und einem Kunden zugeordnet wird, steht ohne weiteres
// Zutun in dessen Akte.
const DOKUMENT_ARTEN = ["Rechnung an den Kunden", "Vertrag", "Angebot", "Briefing", "Sonstiges"];
module.exports.DOKUMENT_ARTEN = DOKUMENT_ARTEN;

async function dokumenteListe(user, firmaId) {
  return alsNutzer(user.id, async (q) => {
    const { rows: eigene } = await q(
      `select d.id, d.name, d.art, d.dateityp, d.erstellt,
              coalesce(d.groesse_neu, d.groesse) as groesse,
              p.name as wer
         from dokumente d left join profiles p on p.id = d.hochgeladen_von
        where d.firma_id = $1 order by d.erstellt desc`, [firmaId]);
    // Die Rechnungen kommen aus der Buchhaltung — mit ihrem echten Stand, damit
    // in der Akte steht, ob das Geld schon da ist.
    const { rows: rechnungen } = await q(
      `select b.id, b.dateiname as name, b.art as richtung, b.dateityp, b.erstellt,
              b.groesse, b.betrag, b.status, b.laufnummer, b.datum,
              bu.bezahlt, bu.bezahlt_am, p.name as wer
         from belege b
         left join buchungen bu on bu.id = b.buchung_id
         left join profiles p on p.id = b.von
        where b.firma_id = $1 and b.status <> 'verworfen'
        order by b.erstellt desc`, [firmaId]);
    return {
      eigene,
      rechnungen: rechnungen.map((r) => ({ ...r, betrag: r.betrag === null ? null : Number(r.betrag) })),
    };
  });
}

// Eine Datei ablegen. Der Weg entscheidet sich an der Art, nicht am Dateinamen.
async function dokumentHochladen(user, d) {
  const daten = Buffer.isBuffer(d.daten) ? d.daten : null;
  if (!daten || !daten.length) return { ok: false, grund: "keine-datei" };
  const firmaId = Number(d.firmaId);
  if (!Number.isFinite(firmaId)) return { ok: false, grund: "firma" };
  const name = String(d.dateiname || "Dokument").slice(0, 200);
  const art = DOKUMENT_ARTEN.includes(d.art) ? d.art : "Sonstiges";
  const summe = crypto.createHash("sha256").update(daten).digest("hex");
  const istRechnung = art === "Rechnung an den Kunden";

  return alsNutzer(user.id, async (q) => {
    if (istRechnung) {
      // Dieselbe Dublettenpruefung wie in der Buchhaltung: dieselbe Datei zweimal
      // hochzuladen darf nicht zwei Rechnungen ergeben.
      const { rows: schon } = await q(
        `select id, laufnummer, firma_id from belege
          where pruefsumme = $1 and status <> 'verworfen' limit 1`, [summe]);
      if (schon.length) {
        // Lag sie bisher ohne Kunden herum, bekommt sie ihn jetzt.
        if (!schon[0].firma_id) {
          await q(`update belege set firma_id = $2 where id = $1`, [schon[0].id, firmaId]);
        }
        return { ok: true, doppelt: true, ziel: "buchhaltung", id: schon[0].id };
      }
      const { rows: [f] } = await q(`select name from firmen where id = $1`, [firmaId]);
      const { rows } = await q(
        `insert into belege (dateiname, dateityp, daten, groesse, pruefsumme, art, status,
                             von, firma_id, gegenstelle, kategorie)
         values ($1,$2,$3,$4,$5,'einnahme','neu',$6,$7,$8,'Webdesign')
         returning id, laufnummer`,
        [name, d.dateityp || null, daten, daten.length, summe, user.id, firmaId, f ? f.name : null]);
      await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'system',$3)`,
        [firmaId, user.id, `Rechnung abgelegt: ${name} — wartet in der Buchhaltung auf Prüfung`]);
      return { ok: true, ziel: "buchhaltung", id: rows[0].id, laufnummer: rows[0].laufnummer };
    }

    const { rows: schon } = await q(
      `select id from dokumente where firma_id = $1 and pruefsumme = $2 limit 1`, [firmaId, summe]);
    if (schon.length) return { ok: true, doppelt: true, ziel: "akte", id: schon[0].id };
    const { rows } = await q(
      `insert into dokumente (firma_id, name, art, dateityp, daten, groesse_neu,
                              pruefsumme, hochgeladen_von)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [firmaId, name, art, d.dateityp || null, daten, daten.length, summe, user.id]);
    return { ok: true, ziel: "akte", id: rows[0].id };
  });
}

async function dokumentDatei(user, id) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select name as dateiname, dateityp, daten from dokumente where id = $1`, [id]);
    return rows[0] || null;
  });
}

// Nur eigene Dokumente. Eine Rechnung liegt in belege und ist dort durch den
// Trigger aus 0024 gegen Loeschen gesperrt — sie kann nur verworfen werden, und
// das gehoert in die Buchhaltung, wo der Grund mit erfasst wird.
async function dokumentLoeschen(user, id) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(`delete from dokumente where id = $1 returning firma_id, name`, [id]);
    return rows.length ? { ok: true, firmaId: rows[0].firma_id } : { ok: false, grund: "nicht-gefunden" };
  });
}

// Wie viele Monate eine Laufzeit hat. Muss zu LAUFZEITEN in crm-routes.js
// passen — dieselbe Tabelle steht dort fuer die Anzeige auf der Pipeline-Karte.
// "Unbegrenzt" wird mit zwoelf Monaten bewertet: irgendeine Annahme braucht der
// Abschluss, und ein Jahr ist die vorsichtigere von den plausiblen.
const MONATE_JE_LAUFZEIT = {
  "1 Monat": 1, "3 Monate": 3, "6 Monate": 6, "12 Monate": 12,
  "Unbegrenzt · monatlich kündbar": 12, "Einmaliges Projekt": 0,
};
const monateJeLaufzeit = (l) => MONATE_JE_LAUFZEIT[l] ?? (l ? 12 : 1);
module.exports.MONATE_JE_LAUFZEIT = MONATE_JE_LAUFZEIT;
module.exports.monateJeLaufzeit = monateJeLaufzeit;

// Ein DATE aus der Datenbank kommt als lokale Mitternacht zurueck. toISOString()
// rechnet nach UTC um und dreht es damit oestlich von Greenwich auf den Vortag —
// aus dem 27. Mai wird der 26. Deshalb die lokalen Getter.
const alsTag = (wert) => {
  if (!wert) return null;
  const d = wert instanceof Date ? wert : new Date(wert);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Denselben Tag N Monate spaeter. Der 31. Januar plus einen Monat ist der
// 28. Februar und nicht der 3. Maerz — Date rollt sonst von allein in den
// naechsten Monat weiter, und der zweite Retainer-Monat laege im dritten.
const monatSpaeter = (tag, n) => {
  if (!tag) return null;
  const [j, m, d] = tag.split("-").map(Number);
  const ziel = new Date(j, m - 1 + n, 1);
  const letzterTag = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
  ziel.setDate(Math.min(d, letzterTag));
  return alsTag(ziel);
};

// ------------------------------------------- Kundenakte erzeugt eine Einnahme
//
// Was in der Akte steht, IST die Wahrheit ueber das Geld. Zwei Positionen mit
// getrennten Staenden — seit dem 28.07., weil Fuchspool beides gleichzeitig
// hat: Setup bezahlt, Retainer noch nicht.
//
//   SETUP      rechnung_stand: voll / 50 % / offen. Eine Zahlung, ein Datum.
//
//   RETAINER   retainer_monate_bezahlt: wie viele Monatsbeitraege da sind.
//              JEDER bezahlte Monat wird EINZELN gebucht, mit dem Datum seines
//              Monats. Drei Beitraege in einer Buchung haetten ein Datum, und
//              die Umsatzkurve zeigte 300 € in einem Monat statt 3 × 100 €.
//              Auch der Monatsordner fuer die Steuerberaterin haengt daran.
//
// Das Nicht-doppelt-Anlegen ist der schwierige Teil: die Akte wird oft
// gespeichert. Jede so entstandene Buchung traegt quelle='kundenakte' und einen
// Schluessel ('setup', 'monat-1', 'monat-2' …); darauf liegt ein eindeutiger
// Index (Migration 0042). Beim zweiten Speichern wird dieselbe Buchung
// AKTUALISIERT statt eine zweite anzulegen.
//
// Und der zweite Weg, auf dem dasselbe Geld ankommen kann: eine echte,
// hochgeladene Rechnung. Die wird GEGEN den Stand in der Akte verrechnet, nicht
// obendrauf gezaehlt — wer die Monatsrechnung hochlaedt UND den Zaehler stellt,
// soll 100 € sehen und nicht 200 €. Siehe "schonBezahlt" weiter unten.
const AKTE_POSITIONEN = [
  { schluessel: "setup", feld: "preis_setup", was: "Setup / Projekt" },
];

module.exports.einnahmeAusAkte = async function (user, firmaId) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [f] } = await q(
      `select id, name, preis_setup, preis_monatlich, vertrag_laufzeit,
              rechnung_stand, retainer_monate_bezahlt, kunde_seit, tags
         from firmen where id = $1`, [firmaId]);
    if (!f) return { ok: false, grund: "firma" };

    // Der Zahlungsstand teilt den Betrag, er schaltet ihn nicht nur an oder aus.
    // Eine Anzahlung von 50 % ergibt die Haelfte als Einnahme, nicht null.
    const ANTEIL = { "100": 1, "50": 0.5, offen: 0 };
    const anteil = ANTEIL[String(f.rechnung_stand || "offen")] ?? 0;

    const tag = alsTag(f.kunde_seit);
    const sparte = (f.tags || []).find((t) => ["webdesign", "performance", "ki"].includes(t));
    const KATEGORIE = { webdesign: "Webdesign", performance: "Performance Marketing", ki: "KI-Projekte" };
    const kategorie = KATEGORIE[sparte] || "Sonstiges";
    const cent = (n) => Math.round(n * 100) / 100;

    // Was ueber echte Rechnungen schon eingegangen ist, je Position. Diese
    // Buchungen stammen NICHT aus der Akte und tragen fuer_position aus der
    // Pruefmaske der Buchhaltung (Migration 0045).
    const { rows: echt } = await q(
      `select coalesce(fuer_position, 'setup') as pos,
              coalesce(sum(betrag), 0)::numeric as summe,
              count(*)::int as anzahl
         from buchungen
        where firma_id = $1 and art = 'einnahme' and bezahlt
          and coalesce(quelle, '') <> 'kundenakte'
        group by 1`, [firmaId]);
    const schonBezahlt = Object.fromEntries(echt.map((r) => [r.pos, Number(r.summe)]));
    const schonAnzahl = Object.fromEntries(echt.map((r) => [r.pos, r.anzahl]));

    const setzen = async (schluessel, betrag, datumTag, was) => {
      const { rows: [da] } = await q(
        `select id from buchungen where firma_id = $1 and quelle = 'kundenakte'
           and quelle_schluessel = $2`, [firmaId, schluessel]);
      if (!(betrag > 0)) {
        if (da) {
          await q(`delete from buchungen where id = $1`, [da.id]);
          return { schluessel, entfernt: true };
        }
        return null;
      }
      if (da) {
        await q(
          `update buchungen set betrag = $2, bezahlt = true, kategorie = $4,
                  datum = coalesce($3::date, datum),
                  bezahlt_am = coalesce($3::date, bezahlt_am, current_date)
            where id = $1`,
          [da.id, betrag, datumTag, kategorie]);
        return { schluessel, betrag, aktualisiert: true };
      }
      await q(
        `insert into buchungen (art, datum, betrag, kategorie, gegenstelle, firma_id,
                                bezahlt, bezahlt_am, erfasst_von, notiz, quelle,
                                quelle_schluessel, fuer_position)
         values ('einnahme', coalesce($1::date, current_date), $2, $3, $4, $5,
                 true, coalesce($1::date, current_date), $6, $7, 'kundenakte', $8, $9)`,
        [datumTag, betrag, kategorie, f.name.trim(), firmaId, user.id, was, schluessel,
         schluessel.startsWith("monat-") ? "monatlich" : "setup"]);
      return { schluessel, betrag, angelegt: true };
    };

    const ergebnis = [];

    // ---------- Setup ----------
    // Was schon per echter Rechnung eingegangen ist, wird abgezogen. Sonst
    // stuende dasselbe Geld zweimal drin: einmal aus der Rechnung, einmal aus
    // dem Haken in der Akte.
    for (const p of AKTE_POSITIONEN) {
      const gesamt = Number(f[p.feld]) || 0;
      const soll = cent(gesamt * anteil);
      const rest = cent(Math.max(0, soll - (schonBezahlt.setup || 0)));
      const a = await setzen(p.schluessel, rest, tag, `${p.was} laut Kundenakte`);
      if (a) ergebnis.push(a);
      // Gerechnete Restbetraege aus einer frueheren Fassung raeumen wir weg —
      // "Offene Rechnungen" enthaelt nur noch echte, verschickte Rechnungen.
      const b = await setzen(p.schluessel + "-offen", 0, tag, "");
      if (b) ergebnis.push(b);
    }

    // ---------- Retainer, Monat fuer Monat ----------
    const monatsBetrag = Number(f.preis_monatlich) || 0;
    const laufzeit = monateJeLaufzeit(f.vertrag_laufzeit);
    // Der Zaehler ist ein Mindeststand, keine Obergrenze: wer drei bezahlte
    // Monatsrechnungen hochgeladen hat, hat drei Monate bezahlt — auch wenn am
    // Zaehler noch eine 1 steht. So wird ein vergessener Klick nicht zu einer
    // fehlenden Einnahme.
    const ausRechnungen = schonAnzahl.monatlich || 0;
    const bezahlteMonate = Math.min(
      Math.max(Number(f.retainer_monate_bezahlt) || 0, ausRechnungen),
      laufzeit || 120);

    // Die ersten Monate gelten als durch echte Rechnungen abgedeckt; nur was
    // darueber hinausgeht, wird aus der Akte gebucht.
    const { rows: alteMonate } = await q(
      `select quelle_schluessel from buchungen
        where firma_id = $1 and quelle = 'kundenakte' and quelle_schluessel like 'monat-%'`,
      [firmaId]);
    const gebraucht = new Set();
    for (let n = ausRechnungen + 1; n <= bezahlteMonate; n++) {
      const schluessel = "monat-" + n;
      gebraucht.add(schluessel);
      const r = await setzen(schluessel, monatsBetrag, monatSpaeter(tag, n - 1),
        `Retainer Monat ${n} laut Kundenakte`);
      if (r) ergebnis.push(r);
    }
    // Was der Zaehler nicht mehr deckt — heruntergesetzt, Rechnung nachgereicht,
    // Laufzeit verkuerzt — muss weg. Sonst bliebe eine Einnahme stehen, der
    // kein Geld mehr entspricht.
    for (const m of alteMonate) {
      if (gebraucht.has(m.quelle_schluessel)) continue;
      const r = await setzen(m.quelle_schluessel, 0, null, "");
      if (r) ergebnis.push(r);
    }
    // Der Sammelschluessel aus der Zeit vor 0045, als der Retainer mit einem
    // einzigen Betrag gebucht wurde.
    for (const altSchluessel of ["monatlich", "monatlich-offen"]) {
      const r = await setzen(altSchluessel, 0, null, "");
      if (r) ergebnis.push(r);
    }

    return {
      ok: true, anteil, bezahlteMonate, laufzeit, ausRechnungen,
      setupSumme: cent((Number(f.preis_setup) || 0) * anteil),
      retainerSumme: cent(monatsBetrag * bezahlteMonate),
      positionen: ergebnis,
    };
  });
};

// ------------------------------------------------------------ Kunde verloren
//
// Ein Kunde springt ab. Was dann passieren muss, steht an vier Stellen:
//
//   Firma      -> status 'verloren' mit Grund. Damit taucht sie in der Liste
//                 "Verloren" auf und nicht mehr unter den Kunden.
//   Projekte   -> abgebrochen. Sie verschwinden von der Projektabwicklung —
//                 daran arbeitet niemand mehr.
//   Offene Deals -> verloren, mit demselben Grund.
//
// Was BLEIBT: der gewonnene Abschluss und jede Buchung. Was er gezahlt hat, hat
// er gezahlt; was abgeschlossen war, war abgeschlossen. Ein Kunde, der nach
// einem Jahr geht, macht den Umsatz des Vorjahres nicht rueckgaengig — und eine
// Buchhaltung, die sich rueckwirkend aendert, ist keine.
//
// Der Grund ist Pflicht. Ohne ihn ist die Liste "Verloren" nur eine Sammlung
// von Namen; mit ihm sieht man nach zwanzig Eintraegen, woran es wirklich liegt.
module.exports.kundeVerloren = async function (user, firmaId, grund) {
  const text = String(grund || "").trim().slice(0, 500);
  if (text.length < 3) return { ok: false, grund: "kein-grund" };
  return alsNutzer(user.id, async (q) => {
    const { rows: [f] } = await q(`select id, name, status from firmen where id = $1`, [firmaId]);
    if (!f) return { ok: false, grund: "firma" };

    await q(
      `update firmen set status = 'verloren', verlust_grund = $2, temperatur = 'kalt',
              wiedervorlage = null, naechster_termin = null, naechste_aufgabe = null,
              letzte_aktivitaet = now()
        where id = $1`, [firmaId, text]);
    const { rowCount: projekte } = await q(
      `update projekte set status = 'abgebrochen'
        where firma_id = $1 and status not in ('fertig', 'abgebrochen')`, [firmaId]);
    const { rowCount: deals } = await q(
      `update deals set status = 'verloren', verlust_grund = $2, geschlossen_am = now()
        where firma_id = $1 and status = 'offen'`, [firmaId, text]);
    await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'system',$3)`,
      [firmaId, user.id, `Kunde verloren: ${text}`]);
    // Offene Aufgaben zu diesem Kunden gehen niemanden mehr etwas an — sonst
    // steht morgen "Angebot nachfassen" auf dem Brett fuer jemanden, der weg ist.
    const { rowCount: aufgaben } = await q(
      `update aufgaben set erledigt = true where firma_id = $1 and erledigt = false`, [firmaId]);
    return { ok: true, projekte, deals, aufgaben };
  });
};

// Zurueckholen — jemand hat sich anders entschieden, oder es war ein Fehlgriff.
module.exports.kundeZurueckholen = async function (user, firmaId) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [f] } = await q(
      `select id, kunde_seit from firmen where id = $1 and status = 'verloren'`, [firmaId]);
    if (!f) return { ok: false, grund: "nicht-verloren" };
    // War er schon einmal Kunde, ist er wieder Kunde; sonst wieder Lead.
    const ziel = f.kunde_seit ? "kunde" : "lead";
    await q(
      `update firmen set status = $2, verlust_grund = null, temperatur = 'warm',
              letzte_aktivitaet = now() where id = $1`, [firmaId, ziel]);
    await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'system',$3)`,
      [firmaId, user.id, `Zurückgeholt — wieder ${ziel === "kunde" ? "Kunde" : "Lead"}`]);
    return { ok: true, status: ziel };
  });
};

// ------------------------------------- Kundenakte erzeugt den gewonnenen Deal
//
// Ein Kunde IST gewonnenes Geschaeft. Wer von Hand als Kunde angelegt wird —
// weil er nie durch die Pipeline lief — hatte bisher keinen Deal, und damit
// zaehlte er nirgends zum Umsatz. Das war die Luecke hinter "vier Kunden
// abgeschlossen, Umsatz 0 €".
//
// Erzeugt wird ein Deal auf der Abschluss-Stufe des Bereichs, mit
// geschlossen_am = kunde_seit, damit der Umsatz im richtigen Monat steht.
// Wiedererkennbar ueber quelle='kundenakte' (Migration 0043) — zweimal
// Speichern legt keinen zweiten an, und ein geaenderter Preis aendert den Wert.
//
// WICHTIG: Nur fuer Firmen mit status='kunde'. Ein Lead mit hinterlegtem
// Wunschpreis ist kein Umsatz — das waere die schlimmste Art von Zahl:
// eine, die gut aussieht und nicht stimmt.
module.exports.dealAusAkte = async function (user, firmaId) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [f] } = await q(
      `select id, name, status, preis_setup, preis_monatlich, vertrag_laufzeit,
              kunde_seit, tags, besitzer, gewonnen_durch
         from firmen where id = $1`, [firmaId]);
    if (!f) return { ok: false, grund: "firma" };

    const sparte = (f.tags || []).find((t) => ["webdesign", "performance", "ki"].includes(t)) || "webdesign";
    // Der Abschluss ist die GANZE Vertragssumme: Setup plus Retainer mal
    // Laufzeit. Bis zum 28.07. zaehlte der Retainer nur mit einem Monat, und
    // Fuchspool (1.500 € Setup + 100 € ueber drei Monate) stand mit 1.600 €
    // statt 1.800 € im Umsatz. Die Pipeline-Karte rechnete es die ganze Zeit
    // richtig — es gab also zwei Zahlen fuer denselben Kunden.
    const setup = Number(f.preis_setup) || 0;
    const monat = Number(f.preis_monatlich) || 0;
    const wert = setup + monat * monateJeLaufzeit(f.vertrag_laufzeit);

    const { rows: [vorhanden] } = await q(
      `select id, wert from deals where firma_id = $1 and quelle = 'kundenakte' and quelle_schluessel = 'abschluss'`,
      [firmaId]);

    // Ein verlorener Kunde behaelt seinen Umsatz, wenn er einmal Kunde WAR
    // (kunde_seit ist gesetzt). Das Geschaeft war abgeschlossen — dass er
    // spaeter abgesprungen ist, macht den Auftrag von damals nicht ungeschehen.
    // Umsatz rueckwirkend zu loeschen hiesse, die Vergangenheit umzuschreiben.
    const zaehlt = f.status === "kunde" || (f.status === "verloren" && f.kunde_seit);
    if (!zaehlt || wert <= 0) {
      if (vorhanden) {
        await q(`delete from deals where id = $1`, [vorhanden.id]);
        return { ok: true, entfernt: true };
      }
      return { ok: true, nichts: true };
    }

    const tag = alsTag(f.kunde_seit);
    if (vorhanden) {
      await q(
        // besitzer und gewonnen_durch folgen der Akte, damit Sichtbarkeit und
        // Umsatz-Zurechnung nicht auseinanderlaufen (0047).
        `update deals set wert = $2, geschlossen_am = coalesce($3::date, geschlossen_am, now()),
                sparte = $4, besitzer = coalesce($5, besitzer), gewonnen_durch = $6
          where id = $1`,
        [vorhanden.id, wert, tag, sparte, f.besitzer, f.gewonnen_durch || f.besitzer]);
      return { ok: true, aktualisiert: true, wert };
    }

    // Die Abschluss-Stufe des Bereichs — dieselbe, auf der ein normal
    // gewonnener Deal landet.
    const { rows: [stufe] } = await q(
      `select id from pipeline_stages
        where sparte = $1 and art = 'vertrieb' and ist_abschluss order by position limit 1`, [sparte]);

    await q(
      // besitzer = wer betreut (steuert die Sichtbarkeit), gewonnen_durch = wem
      // der Umsatz gehoert. Beides kommt aus der Akte, nicht von dem, der
      // gerade auf Speichern drueckt — sonst wechselte der Umsatz die Person,
      // sobald jemand anderes die Akte aufmacht.
      `insert into deals (firma_id, titel, sparte, stufe_id, wert, besitzer, status,
                          geschlossen_am, quelle, quelle_schluessel, gewonnen_durch)
       values ($1,$2,$3,$4,$5,$6,'gewonnen', coalesce($7::date, now()), 'kundenakte','abschluss',$8)`,
      [firmaId, f.name.trim(), sparte, stufe?.id || null, wert, f.besitzer || user.id, tag,
       f.gewonnen_durch || f.besitzer || user.id]);
    await q(`insert into aktivitaeten (firma_id, wer, art, text) values ($1,$2,'system',$3)`,
      [firmaId, user.id, `Abschluss aus der Kundenakte: ${Math.round(wert)} €`]);
    return { ok: true, angelegt: true, wert };
  });
};

// =====================================================================
// Kundenakte 2 (05.09.2026): Pipeline-Volumen, fester Umsatz, Zeilenwahl,
// Kurzakte fuer den Kalender — und die Draehte zu den Nachbarmodulen.
// =====================================================================
//
// DIE UMSATZ-REGEL (verbindlich fuer Akte, /crm und Zentrale):
//
//   Pipeline-Beitrag einer Firma
//     = coalesce(umsatz_geplant, umsatz_geschaetzt, Summe offener Deal-Werte, 0)
//     fuer Firmen mit status 'lead' oder 'kunde', solange fuer sie noch KEINE
//     Rechnung gestellt wurde. Sobald eine Rechnung gestellt ist, zaehlt die
//     Firma unter FESTEM Umsatz (lib/rechnungen.js: gestellt / bezahlt / offen)
//     und faellt aus der Pipeline — dieselbe Zahl darf nicht zweimal zaehlen.
//
//   Pipeline-Volumen = Summe der Beitraege, aufgeschluesselt "davon geplant"
//   (fest besprochener Preis) und "davon geschaetzt" (Bauchgefuehl; offene
//   Deal-Werte zaehlen als Schaetzung, weil nichts vereinbart ist).
//
//   Fester Umsatz = gestellt / bezahlt / offen aus echten Rechnungen (keine
//   Angebote, keine stornierten) — Agent D1, umsatzFest(user).
//
//   Der bisherige "Umsatz" (gewonnene Deals, deals.wert) bleibt als
//   "Abschluesse" bestehen — nichts davon wird geloescht oder umgedeutet.
//
// Die reine Rechnung (pipelineBeitrag, pipelineSumme) liegt in lib/crm-akte.js,
// damit sie ohne Datenbank testbar ist (scripts/test-akte.js) und die Akte
// dieselbe Zahl zeigt wie das Dashboard.

// Ein Nachbarmodul erst beim Aufruf laden. Fehlt es (noch), gibt es null —
// und der Aufrufer faellt auf Nullen oder leere Listen zurueck, statt dass die
// ganze Akte an einem require scheitert. Ein Modul, das beim Laden selbst
// wirft, wird gemeldet, aber ebenfalls als "nicht da" behandelt.
function nachbar(name) {
  try { return require(name); } catch (e) {
    if (!e || e.code !== "MODULE_NOT_FOUND") console.error(`Modul ${name}:`, e && e.message);
    return null;
  }
}

const RECHNUNGEN_LEER = () => ({ gestellt: 0, bezahlt: 0, offen: 0, anzahl: 0, liste: [] });
const UMSATZ_FEST_LEER = () => ({ gestellt: 0, bezahlt: 0, offen: 0, anzahl: 0 });

// Rechnungen einer Firma — { gestellt, bezahlt, offen, anzahl, liste } aus
// lib/rechnungen.js (Agent D1). Wirft nie; ohne Modul, Tabelle oder Rechte
// (RLS gibt einem Mitarbeiter fremde Rechnungen nicht) kommen Nullen.
module.exports.rechnungenJeFirmaSicher = async function (user, firmaId) {
  const m = nachbar("./rechnungen.js");
  if (!m || typeof m.rechnungenJeFirma !== "function") return RECHNUNGEN_LEER();
  try {
    const r = await m.rechnungenJeFirma(user, firmaId);
    if (!r) return RECHNUNGEN_LEER();
    return {
      gestellt: Number(r.gestellt) || 0, bezahlt: Number(r.bezahlt) || 0, offen: Number(r.offen) || 0,
      anzahl: Number(r.anzahl) || 0, liste: Array.isArray(r.liste) ? r.liste : [],
    };
  } catch (e) { console.error("Rechnungen je Firma:", e.message); return RECHNUNGEN_LEER(); }
};

// Fester Umsatz fuer den Nutzer — { gestellt, bezahlt, offen, anzahl }.
module.exports.umsatzFestSicher = async function (user) {
  const m = nachbar("./rechnungen.js");
  if (!m || typeof m.umsatzFest !== "function") return UMSATZ_FEST_LEER();
  try {
    const r = await m.umsatzFest(user);
    if (!r) return UMSATZ_FEST_LEER();
    return { gestellt: Number(r.gestellt) || 0, bezahlt: Number(r.bezahlt) || 0,
             offen: Number(r.offen) || 0, anzahl: Number(r.anzahl) || 0 };
  } catch (e) { console.error("Fester Umsatz:", e.message); return UMSATZ_FEST_LEER(); }
};

// Termine einer Firma aus dem Kalender (Agent C) — [{ id, titel, start, ende,
// ort, htmlLink, art }]. Wirft nie; ohne Modul oder Kalenderzugang leer.
module.exports.termineVonFirmaSicher = async function (user, firmaId) {
  const m = nachbar("./kalender-akte.js");
  if (!m || typeof m.termineVonFirma !== "function") return [];
  try {
    const r = await m.termineVonFirma(user, firmaId);
    return Array.isArray(r) ? r : [];
  } catch (e) { console.error("Termine je Firma:", e.message); return []; }
};

// Erstgespraech in den Kalender (Agent C). Das Ergebnis wird nur geloggt —
// der Aufrufer (kundeAendern, anrufSpeichern) hat sein Speichern da schon
// hinter sich, und daran soll der Kalender nichts mehr aendern koennen.
async function erstgespraechInKalender(user, firmaId, { wann, ort = "", notiz = "" } = {}) {
  const m = nachbar("./kalender-akte.js");
  if (!m || typeof m.erstgespraechSynchronisieren !== "function") return { ok: false, grund: "modul-fehlt" };
  try {
    const r = await m.erstgespraechSynchronisieren(user, firmaId, { wann, ort, notiz });
    if (!r || !r.ok) console.log(`Erstgespräch → Kalender (Firma ${firmaId}): ${(r && r.grund) || "kein Ergebnis"}`);
    return r || { ok: false, grund: "kein-ergebnis" };
  } catch (e) { console.error("Erstgespräch → Kalender:", e.message); return { ok: false, grund: e.message }; }
}
module.exports.erstgespraechInKalender = erstgespraechInKalender;

// ============================================================ CRM-Aufgaben
// im Google Kalender (Migration 0067, 08.09.2026)
//
// Wunsch von Lukas: "Geht das, dass die CRM-To-Dos auch gleich in meinem
// Google Kalender stehen?" — Ja. Eine Aufgabe MIT Firma UND Datum bekommt
// einen Eintrag am geplanten Tag; ohne Datum keinen, denn dann wuesste
// niemand, wohin damit.
//
// KEIN GANZTAGSEINTRAG MEHR (08.09.2026). Der erste Wurf hat ganztaegig
// eingetragen; Lukas dazu: "auch nicht den ganzen Tag, sondern Follow-up
// maximal 10 Minuten". Ein ganztaegiger Eintrag sagt nichts darueber, WANN
// man anruft, und drei davon an einem Tag sehen aus wie drei verlorene Tage.
// Jetzt bekommt jede Aufgabe einen 10-Minuten-Block (AUFGABE_DAUER_MIN).
//
// WO AM TAG? Die Aufgabe hat nur ein Datum, keine Uhrzeit — also sucht das OS
// den Platz selbst: der Tag wird EINMAL bei Google abgefragt
// (kalender.spanne(tag, tag)) und der Block in das ERSTE freie
// Zehn-Minuten-Fenster ab 9:00 gelegt, das mit keinem bestehenden Termin
// kollidiert (ersterFreierPlatz). Auch die Eintraege, die das OS selbst
// angelegt hat, zaehlen als belegt — so stapeln sich drei Follow-ups an einem
// Tag hintereinander (9:00, 9:10, 9:20) statt uebereinander.
//   Ganztaegige Termine ANDERER blockieren nicht. Ein Feiertag, ein Urlaub
//   oder ein Geburtstag im Kalender wuerde sonst jeden Tag im Jahr verbauen,
//   an dem er steht — und genau an einem Brueckentag will man anrufen.
//   Der eigene Termin einer Aufgabe zaehlt beim Umplanen ebenfalls nicht mit
//   (optionen.ausser): sonst wanderte er bei jedem Speichern zehn Minuten
//   weiter nach hinten.
//   Ist der Tag von 9:00 bis 18:00 voll ODER Google nicht erreichbar, wird
//   9:00 genommen und der Grund in die Beschreibung geschrieben. Lieber eine
//   Ueberschneidung, die man sieht, als kein Eintrag, den niemand vermisst.
//
// ES GIBT GENAU EINEN GOOGLE-ZUGANG, den von Lukas (docs/dreh-umgebung.md:
// gws-cli spricht mit seinem Konto, KALENDER_ID waehlt hoechstens einen
// zweiten Kalender IM SELBEN Konto). Aufgaben anderer Personen landen darum
// ebenfalls in SEINEM Kalender — das ist kein Versehen, sondern die Lage.
// Damit er die fremden nicht fuer eigene haelt, steht der Vorname der
// verantwortlichen Person vorn im Titel, wenn sie nicht der Kalenderbesitzer
// ist: "CRM: Louis — Nochmal anrufen — Muster GmbH".
//
// KEIN ZWEITER EINTRAG BEIM ERSTGESPRAECH: Ein gebuchtes Erstgespraech steht
// laengst im Kalender — erstgespraechSynchronisieren() legt es an, mit
// Uhrzeit und 30 Minuten Dauer, und haengt die Akte als Verknuepfung mit
// art='erstgespraech' daran (lib/kalender-akte.js). Die Aufgabe dazu
// ("Erstgespräch am 12.09. um 10:00") beschreibt DENSELBEN Termin. Sie
// bekommt darum keinen eigenen: aufgabeKalenderPlan() gibt "erstgespraech-
// steht" zurueck, sobald der Anlass 'anruf:gebucht' ist UND es fuer die Firma
// eine 'erstgespraech'-Verknuepfung gibt.
//   Warum diese Pruefung und nicht "hat der Titel eine Uhrzeit": Der Titel
//   ist Anzeigetext (dieselbe Lehre wie in Migration 0066). Die Verknuepfung
//   dagegen ist die Tatsache — sie existiert genau dann, wenn der Termin
//   wirklich im Kalender steht. Und sie faellt richtig aus, wo eine
//   Titelpruefung falsch laege: "Erstgespräch — Termin nachtragen" (gebucht
//   OHNE Zeitpunkt) hat keine Verknuepfung und bekommt deshalb sehr wohl
//   einen eigenen kurzen Eintrag am selben Tag — genau die Erinnerung, die
//   man dafuer braucht. Umgekehrt bekommt ein Follow-up bei einer Firma, die vor
//   Wochen schon einmal ein Erstgespraech hatte, weiterhin seinen eigenen
//   Eintrag: die Pruefung greift nur beim Anlass 'anruf:gebucht'.
//
// EIN SCHALTER: KALENDER_AUFGABEN=aus schaltet das Ganze ab, damit der
// Kalender nicht zuwaechst. Vorgabe "an".
//
// NICHTS SCHEITERT HART: Ohne gws-cli (auf dem Laptop der Normalfall), ohne
// Spalte kalender_termin (0067 noch nicht eingespielt) oder bei einem Fehler
// von Google wird nur protokolliert — die Aufgabe steht trotzdem in der
// Liste und auf der Tafel. Dieselbe Regel wie bei erstgespraechInKalender.
const KALENDER_TITEL_MAX = 200;          // Deckel von werkzeuge.terminEintragen

// Die drei Stellschrauben — bewusst Konstanten und keine Umgebungswerte: Es
// sind Hausregeln, keine Werte, die sich je Maschine unterscheiden. Wer sie
// aendern will, aendert sie hier; scripts/test-aufgabe-kalender.js rechnet
// mit ihnen und nicht mit festen Uhrzeiten.
const AUFGABE_DAUER_MIN = 10;            // "Follow-up maximal 10 Minuten"
const ARBEIT_VON_MIN = 9 * 60;           // 09:00 — frueher ruft niemand an
const ARBEIT_BIS_MIN = 18 * 60;          // 18:00 — danach ist der Tag voll
module.exports.AUFGABE_DAUER_MIN = AUFGABE_DAUER_MIN;
module.exports.ARBEIT_VON_MIN = ARBEIT_VON_MIN;
module.exports.ARBEIT_BIS_MIN = ARBEIT_BIS_MIN;

const kalenderAufgabenAn = () =>
  String(process.env.KALENDER_AUFGABEN || "an").trim().toLowerCase() !== "aus";
module.exports.kalenderAufgabenAn = kalenderAufgabenAn;

// Ein Tag ("JJJJ-MM-TT") aus dem, was die Datenbank liefert: bei einer
// date-Spalte ein Date auf lokale Mitternacht, bei einem Text der Text.
// toISOString() waere hier falsch — es rechnet nach UTC um und macht aus dem
// 12.09. in Berlin den 11.09.
function tagAus(wert) {
  if (!wert) return "";
  if (wert instanceof Date) {
    if (Number.isNaN(wert.getTime())) return "";
    return `${wert.getFullYear()}-${String(wert.getMonth() + 1).padStart(2, "0")}-${String(wert.getDate()).padStart(2, "0")}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(wert).trim());
  return m ? m[1] : "";
}

// Der Vorname reicht: Im Kalender steht der Titel in einer schmalen Spalte,
// und im Haus ist genau ein Louis.
const vornameVon = (name) => String(name || "").trim().split(/\s+/)[0] || "";

// BEKOMMT DIESE AUFGABE EINEN EIGENEN KALENDEREINTRAG? Reine Entscheidung,
// ohne Datenbank und ohne Google — damit sie in scripts/test-aufgabe-kalender.js
// Fall fuer Fall nachpruefbar ist.
//   aufgabe: {titel, firma_id, firma_name, geplant_am, faellig, anlass, erledigt}
//   an                      Schalter KALENDER_AUFGABEN
//   erstgespraechImKalender Fuer diese Firma steht schon ein Erstgespraech
//   personName              Name der verantwortlichen Person, ODER "" wenn
//                           sie der Kalenderbesitzer ist (dann kein Vorsatz)
// -> { eintrag:false, grund } | { eintrag:true, tag, titel, dauerMin }
// WANN am Tag steht hier bewusst nicht: das entscheidet ersterFreierPlatz()
// weiter unten, denn dafuer muss man den Tag bei Google gesehen haben.
function aufgabeKalenderPlan(aufgabe, optionen = {}) {
  const o = optionen || {};
  if (o.an === false) return { eintrag: false, grund: "abgeschaltet" };
  const a = aufgabe || {};
  if (!(Number(a.firma_id) > 0)) return { eintrag: false, grund: "keine-firma" };
  if (a.erledigt) return { eintrag: false, grund: "erledigt" };
  // Geplant geht vor faellig: der geplante Tag ist der, an dem gearbeitet
  // wird — die Faelligkeit sagt nur, bis wann.
  const tag = tagAus(a.geplant_am) || tagAus(a.faellig);
  if (!tag) return { eintrag: false, grund: "kein-datum" };
  if (String(a.anlass || "") === "anruf:gebucht" && o.erstgespraechImKalender)
    return { eintrag: false, grund: "erstgespraech-steht" };
  const person = vornameVon(o.personName);
  const firma = String(a.firma_name || "").trim();
  const titel = ["CRM:", person ? person + " —" : "", String(a.titel || "").trim(),
                 firma ? "— " + firma : ""]
    .filter(Boolean).join(" ").slice(0, KALENDER_TITEL_MAX);
  return { eintrag: true, tag, titel, dauerMin: AUFGABE_DAUER_MIN };
}
module.exports.aufgabeKalenderPlan = aufgabeKalenderPlan;

// hh:mm aus Minuten seit Mitternacht, und zurueck.
const alsUhrzeit = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const alsMinuten = (wert) => {
  const m = /T(\d{2}):(\d{2})/.exec(String(wert || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

// WELCHE MINUTEN DES TAGES SIND BELEGT? Aus der Terminliste von Google
// (kalender.spanne) die Fenster [von, bis) in Minuten seit Mitternacht,
// aufsteigend. Reine Rechnerei — keine Datenbank, kein Netz.
//
// Nicht mitgezaehlt wird:
//   - ein GANZTAEGIGER Termin (start ohne "T"): Feiertag, Urlaub, Geburtstag.
//     Wer die mitzaehlt, findet an einem Feiertagstag nie ein Fenster.
//   - ein Termin, der den Tag gar nicht beruehrt.
//   - der Termin mit der Kennung "ausser" — der eigene Eintrag der Aufgabe,
//     die gerade umgeplant wird. Sonst schoebe sich der Block bei jedem
//     Speichern um seine eigene Laenge nach hinten.
// Ein Termin, der vom Vortag hereinragt, belegt ab 0:00; einer, der ueber
// Mitternacht hinausgeht, bis 24:00.
function belegteFenster(termine, tag, ausser = "") {
  const raus = [];
  const ausserId = String(ausser || "");
  for (const t of termine || []) {
    if (!t) continue;
    if (ausserId && String(t.id) === ausserId) continue;
    const start = String(t.start || "");
    if (!start.includes("T")) continue;                 // ganztaegig blockiert nicht
    const ende = String(t.ende || t.end || start);
    const startTag = start.slice(0, 10), endeTag = ende.slice(0, 10);
    if (startTag > tag || endeTag < tag) continue;      // beruehrt den Tag nicht
    const von = startTag < tag ? 0 : alsMinuten(start);
    const bis = endeTag > tag ? 24 * 60
      : (ende.includes("T") ? alsMinuten(ende) : 24 * 60);
    if (bis > von) raus.push({ von, bis });
  }
  raus.sort((a, b) => a.von - b.von || a.bis - b.bis);
  return raus;
}
module.exports.belegteFenster = belegteFenster;

// DAS ERSTE FREIE FENSTER AB 9:00. Reine Entscheidung, ohne Datenbank und
// ohne Netz — der Aufrufer hat die Termine schon geholt.
//   termine   was kalender.spanne(tag, tag) geliefert hat; null oder
//             undefined heisst "Google hat nicht geantwortet"
//   tag       "JJJJ-MM-TT"
//   dauerMin  Laenge des Blocks (Vorgabe AUFGABE_DAUER_MIN = 10)
//   optionen  { von, bis, ausser }
// -> { start, ende, uhrzeit, voll, ohneGoogle }
//
// Gerechnet wird mit einem Zeiger, der bei 9:00 startet und an jedem Termin,
// der ihn ueberlappt, auf dessen Ende springt. Die Fenster liegen sortiert
// vor, ein Durchlauf genuegt. Passt der Block bis 18:00 nirgends mehr, bleibt
// es bei 9:00 mit voll:true — der Aufrufer schreibt das in die Beschreibung.
function ersterFreierPlatz(termine, tag, dauerMin = AUFGABE_DAUER_MIN, optionen = {}) {
  const o = optionen || {};
  const dauer = Math.max(5, Math.min(8 * 60, Number(dauerMin) || AUFGABE_DAUER_MIN));
  const von = Number.isFinite(o.von) ? o.von : ARBEIT_VON_MIN;
  const bis = Number.isFinite(o.bis) ? o.bis : ARBEIT_BIS_MIN;
  const ohneGoogle = !Array.isArray(termine);
  const belegt = ohneGoogle ? [] : belegteFenster(termine, tag, o.ausser);

  let zeiger = von;
  for (const f of belegt) {
    if (f.von < zeiger + dauer && f.bis > zeiger) zeiger = Math.max(zeiger, f.bis);
  }
  const voll = zeiger + dauer > bis;
  const anfang = voll ? von : zeiger;
  return {
    start: `${tag}T${alsUhrzeit(anfang)}`,
    ende: `${tag}T${alsUhrzeit(Math.min(anfang + dauer, 24 * 60 - 1))}`,
    uhrzeit: alsUhrzeit(anfang), voll, ohneGoogle,
  };
}
module.exports.ersterFreierPlatz = ersterFreierPlatz;

// Der Freitext des Termins — die Akte-Zeile haengt kalender-akte.js danach an.
// hinweis ist die Zeile fuer den Fall, dass der Platz nicht sauber gefunden
// wurde (Tag voll, Google stumm). Sie steht im Termin, weil man dort
// hinschaut, wenn zwei Eintraege uebereinanderliegen.
function aufgabeKalenderText(aufgabe, personName = "", hinweis = "") {
  const a = aufgabe || {};
  const zeilen = ["Aufgabe aus dem CRM: " + String(a.titel || "").trim()];
  const person = String(personName || "").trim();
  if (person) zeilen.push("Verantwortlich: " + person);
  const notiz = String(a.notiz || "").trim();
  if (notiz) zeilen.push("Notiz: " + notiz.slice(0, 200));
  const h = String(hinweis || "").trim();
  if (h) zeilen.push(h.slice(0, 200));
  return zeilen.join("\n");
}
module.exports.aufgabeKalenderText = aufgabeKalenderText;

// Die Hinweiszeile zu einem Platz — leer, wenn alles glatt lief.
function platzHinweis(platz) {
  const p = platz || {};
  if (p.ohneGoogle)
    return `Hinweis: Der Kalender war beim Eintragen nicht erreichbar — ${p.uhrzeit} Uhr ist gesetzt, nicht geprueft.`;
  if (p.voll)
    return `Hinweis: Zwischen ${alsUhrzeit(ARBEIT_VON_MIN)} und ${alsUhrzeit(ARBEIT_BIS_MIN)} Uhr war an diesem Tag nichts frei — dieser Eintrag ueberschneidet sich.`;
  return "";
}
module.exports.platzHinweis = platzHinweis;

// Wem gehoert der Kalender? Dem Konto, unter dem das OS nach aussen handelt —
// dieselbe Regel wie beim Dienstanmelden in server.js: DIENST_KONTO, sonst
// das aelteste aktive Admin-Konto. EINMAL je Prozess gefragt und gemerkt: Es
// aendert sich nicht, und je Aufgabe eine Abfrage waere Verschwendung.
// Faellt die Frage aus, ist niemand Besitzer — dann steht bei jeder Aufgabe
// der Name davor. Lieber ein Vorsatz zu viel als eine fremde Aufgabe, die im
// Kalender wie eine eigene aussieht.
let kalenderBesitzer = null;
async function kalenderBesitzerId() {
  if (kalenderBesitzer !== null) return kalenderBesitzer;
  kalenderBesitzer = "";
  try {
    const konto = String(process.env.DIENST_KONTO || "").trim();
    const { rows } = await module.exports.system(
      `select p.id from public.profiles p join auth.users u on u.id = p.id
        where p.aktiv and p.rolle = 'admin' and ($1 = '' or lower(u.email) = lower($1))
        order by u.created_at nulls last, u.email limit 1`, [konto]);
    if (rows[0]) kalenderBesitzer = String(rows[0].id);
  } catch (e) {
    console.log("Kalenderbesitzer nicht ermittelt:", String((e && e.message) || e).slice(0, 120));
  }
  return kalenderBesitzer;
}

// Die Kennung des Termins an der Aufgabe merken (oder loesen). Eigene
// Transaktion, Fehler nur ins Log — die Aufgabe selbst steht schon.
// Fehlt die Spalte (0067 nicht eingespielt), wird das EINMAL gemeldet.
let spalteGemeldet = false;
async function kalenderTerminMerken(user, aufgabeId, eventId) {
  try {
    await alsNutzer(user.id, (q) => q(
      `update aufgaben set kalender_termin = $2 where id = $1`, [aufgabeId, eventId || null]));
    return true;
  } catch (e) {
    const text = String((e && e.message) || e);
    if (/kalender_termin/.test(text) && !spalteGemeldet) {
      spalteGemeldet = true;
      console.log("aufgaben.kalender_termin fehlt — Migration 0067 einspielen. "
        + "Bis dahin bleiben CRM-Aufgaben ohne Kalendereintrag.");
    } else if (!/kalender_termin/.test(text)) {
      console.error(`Aufgabe ${aufgabeId}: Kalender-Kennung nicht gemerkt —`, text.slice(0, 160));
    }
    return false;
  }
}

const TERMIN_WEG = /not ?found|404|gone|nicht gefunden|existiert nicht/i;

// Die Termine EINES Tages von Google — oder null, wenn nichts zu holen ist.
// Wirft nie: Ohne Kalender-Zugang, ohne Token oder bei einem Fehler unterwegs
// gibt es null, und ersterFreierPlatz legt den Block auf 9:00 mit Hinweis.
// Genau EINE Abfrage je Eintrag (ein Tag, kleines Fenster) — der Direktweg in
// lib/kalender.js antwortet in Millisekunden.
async function tagesTermine(tag) {
  try {
    const kal = nachbar("./kalender.js");
    if (!kal || typeof kal.spanne !== "function") return null;
    const antwort = await kal.spanne(tag, tag);
    return antwort && antwort.ok && Array.isArray(antwort.termine) ? antwort.termine : null;
  } catch (e) {
    console.log(`Kalender-Tag ${tag} nicht gelesen:`, String((e && e.message) || e).slice(0, 120));
    return null;
  }
}

// Eine Aufgabe in den Kalender bringen: anlegen, verschieben oder absagen —
// je nachdem, was aufgabeKalenderPlan sagt und ob schon ein Termin haengt.
// EIN Eingang fuer alle Wege (anlegen, umplanen, abhaken, wieder oeffnen),
// damit die Regel an genau einer Stelle steht. Wirft nie.
async function aufgabeInKalender(user, aufgabeId) {
  try {
    if (!user || !user.id || !(Number(aufgabeId) > 0)) return { ok: false, grund: "keine-aufgabe" };
    if (!kalenderAufgabenAn()) return { ok: false, grund: "abgeschaltet" };
    const ka = nachbar("./kalender-akte.js");
    const w = nachbar("./werkzeuge.js");
    if (!ka || !w) return { ok: false, grund: "modul-fehlt" };

    let a;
    try {
      const { rows } = await alsNutzer(user.id, (q) => q(
        `select a.id, a.titel, a.notiz, a.anlass, a.erledigt, a.firma_id,
                a.geplant_am, a.faellig, a.kalender_termin, a.verantwortlich,
                f.name as firma_name, pv.name as verantwortlich_name
           from aufgaben a
                left join firmen f on f.id = a.firma_id
                left join profiles pv on pv.id = a.verantwortlich
          where a.id = $1`, [aufgabeId]));
      a = rows[0];
    } catch (e) {
      const text = String((e && e.message) || e);
      if (/kalender_termin/.test(text)) {
        if (!spalteGemeldet) {
          spalteGemeldet = true;
          console.log("aufgaben.kalender_termin fehlt — Migration 0067 einspielen. "
            + "Bis dahin bleiben CRM-Aufgaben ohne Kalendereintrag.");
        }
        return { ok: false, grund: "spalte-fehlt" };
      }
      throw e;
    }
    if (!a) return { ok: false, grund: "aufgabe-weg" };

    // Steht fuer diese Firma schon ein Erstgespraech im Kalender? Nur beim
    // Anlass 'anruf:gebucht' ueberhaupt gefragt — siehe Kopf.
    let erstgespraechImKalender = false;
    if (String(a.anlass || "") === "anruf:gebucht") {
      try {
        const vk = await ka.verknuepfungenVonFirma(user, Number(a.firma_id));
        erstgespraechImKalender = vk.some((v) => v.art === "erstgespraech");
      } catch { erstgespraechImKalender = false; }
    }

    const besitzer = await kalenderBesitzerId();
    const fremd = a.verantwortlich && String(a.verantwortlich) !== besitzer;
    const plan = aufgabeKalenderPlan(a, {
      an: true, erstgespraechImKalender,
      personName: fremd ? a.verantwortlich_name : "",
    });

    if (!plan.eintrag) {
      // Kein Eintrag (mehr) — was diese Aufgabe selbst angelegt hat, wird
      // abgesagt. Beim Erstgespraech gibt es nichts abzusagen: der Termin
      // gehoert erstgespraechSynchronisieren, nicht der Aufgabe.
      if (a.kalender_termin && plan.grund !== "erstgespraech-steht")
        return aufgabeAusKalender(user, a.id, a.kalender_termin);
      return { ok: false, grund: plan.grund };
    }
    if (!ka.schreibenMoeglich()) return { ok: false, grund: "kalender-offline" };

    // WO AM TAG? Einmal den Tag bei Google fragen und das erste freie Fenster
    // ab 9:00 nehmen. Antwortet Google nicht (kein Token, kein gws-cli, Fehler
    // unterwegs), wird trotzdem eingetragen — auf 9:00, mit Hinweis in der
    // Beschreibung. Ein Eintrag zur falschen Stunde ist besser als keiner.
    const platz = ersterFreierPlatz(await tagesTermine(plan.tag), plan.tag,
      plan.dauerMin, { ausser: a.kalender_termin || "" });

    const text = aufgabeKalenderText(a, fremd ? a.verantwortlich_name : "",
      platzHinweis(platz));
    const beschreibung = ka.beschreibungMitAkte(text, Number(a.firma_id));

    // Schon ein Termin da: verschieben statt neu anlegen — sonst stuende nach
    // jedem Umplanen ein weiterer im Kalender.
    if (a.kalender_termin) {
      const r = await w.terminAendern({ id: a.kalender_termin, titel: plan.titel,
        start: platz.start, ende: platz.ende, ganztags: false, beschreibung });
      if (r.ok) return { ok: true, id: a.kalender_termin, verschoben: true };
      // Bei Google geloescht? Dann neu anlegen, statt an einer toten Kennung
      // festzuhalten (dieselbe Stufe wie in erstgespraechSynchronisieren).
      if (!TERMIN_WEG.test(String(r.grund))) {
        console.log(`Aufgabe ${a.id} → Kalender: nicht verschoben — ${String(r.grund).slice(0, 120)}`);
        return { ok: false, grund: String(r.grund || "nicht verschoben") };
      }
      await ka.verknuepfungLoeschen(user, a.kalender_termin).catch(() => null);
      await kalenderTerminMerken(user, a.id, null);
    }

    const r = await w.terminEintragen({ titel: plan.titel, start: platz.start, ende: platz.ende,
                                        ganztags: false, beschreibung });
    if (!r.ok || !r.id) {
      console.log(`Aufgabe ${a.id} → Kalender: ${String((r && r.grund) || "keine Termin-ID").slice(0, 120)}`);
      return { ok: false, grund: String((r && r.grund) || "keine Termin-ID") };
    }
    // Zeile und Faden nur gemeinsam (Grundsatz aus kalender-akte.js): ohne
    // Verknuepfung nehmen wir den Termin wieder zurueck, statt einen halb
    // verknuepften stehen zu lassen — das Popover faende sonst keine Akte.
    const f = await ka.verknuepfungSetzen(user, { eventId: r.id, firmaId: Number(a.firma_id), art: "termin" });
    if (!f.ok) {
      await w.terminAbsagen({ id: r.id }).catch(() => null);
      console.log(`Aufgabe ${a.id} → Kalender: Verknuepfung fehlgeschlagen — ${f.grund}`);
      return { ok: false, grund: "verknuepfung:" + f.grund };
    }
    await kalenderTerminMerken(user, a.id, r.id);
    return { ok: true, id: r.id, neu: true };
  } catch (e) {
    console.error(`Aufgabe ${aufgabeId} → Kalender:`, String((e && e.message) || e).slice(0, 160));
    return { ok: false, grund: String((e && e.message) || e).slice(0, 160) };
  }
}
module.exports.aufgabeInKalender = aufgabeInKalender;

// Den Termin einer Aufgabe absagen und den Faden loesen. Die Kennung wird nur
// dann von der Aufgabe geloest, wenn der Termin auch wirklich weg ist — sonst
// stuende er fuer immer im Kalender, ohne dass ihn noch jemand findet.
async function aufgabeAusKalender(user, aufgabeId, eventId) {
  try {
    if (!eventId) return { ok: true, grund: "kein-termin" };
    const ka = nachbar("./kalender-akte.js");
    const w = nachbar("./werkzeuge.js");
    if (!ka || !w) return { ok: false, grund: "modul-fehlt" };
    if (!ka.schreibenMoeglich()) return { ok: false, grund: "kalender-offline" };
    const r = await w.terminAbsagen({ id: eventId });
    if (!r.ok && !TERMIN_WEG.test(String(r.grund))) {
      console.log(`Aufgabe ${aufgabeId} → Kalender: nicht abgesagt — ${String(r.grund).slice(0, 120)}`);
      return { ok: false, grund: String(r.grund || "nicht abgesagt") };
    }
    await ka.verknuepfungLoeschen(user, eventId).catch(() => null);
    await kalenderTerminMerken(user, aufgabeId, null);
    return { ok: true, id: eventId, abgesagt: true };
  } catch (e) {
    console.error(`Aufgabe ${aufgabeId} → Kalender absagen:`, String((e && e.message) || e).slice(0, 160));
    return { ok: false, grund: String((e && e.message) || e).slice(0, 160) };
  }
}
module.exports.aufgabeAusKalender = aufgabeAusKalender;

// Welche Firmen haben schon eine gestellte Rechnung? Map firma_id -> Summe.
// Liest die Tabelle von Agent D1 (Migration 0060) direkt — EINE Abfrage statt
// eine je Firma. Gibt es die Tabelle (noch) nicht, ist die Map leer und
// alles zaehlt als Pipeline; weicht die Tabelle ab, wird gemeldet statt
// geraten. Laeuft in der Transaktion des Aufrufers, RLS inklusive.
async function gestellteRechnungenJeFirma(q) {
  try {
    const { rows: [t] } = await q(`select to_regclass('public.rechnungen') as da`);
    if (!t || !t.da) return new Map();
    const { rows } = await q(
      `select firma_id, coalesce(sum(summe), 0)::numeric as gestellt
         from rechnungen
        where art = 'rechnung' and status in ('gestellt','teilbezahlt','bezahlt') and firma_id is not null
        group by firma_id`);
    return new Map(rows.map((r) => [String(r.firma_id), Number(r.gestellt) || 0]));
  } catch (e) { console.error("Gestellte Rechnungen je Firma:", e.message); return new Map(); }
}

// Pipeline-Volumen fuer den angemeldeten Nutzer (RLS: Mitarbeiter sehen ihr
// Volumen). Rueckgabe { gesamt, geschaetzt, geplant, anzahl } — die Regel
// steht oben, die Rechnung in lib/crm-akte.js.
module.exports.pipelineVolumen = async function (user) {
  const { pipelineSumme } = require("./crm-akte.js");
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select f.id, f.status, f.umsatz_geschaetzt, f.umsatz_geplant,
              coalesce((select sum(d.wert) from deals d where d.firma_id = f.id and d.status = 'offen'), 0)::numeric as deals_offen
         from firmen f where f.status in ('lead','kunde')`);
    const gestellt = await gestellteRechnungenJeFirma(q);
    return pipelineSumme(rows.map((f) => ({ ...f, rechnungen_gestellt: gestellt.get(String(f.id)) || 0 })));
  });
};

// Zeilenwahl der Akte speichern: welche optionalen Zeilen einer Kategorie
// eingeblendet sind (firmen.akte_zeilen, 0057). Die Namen prueft die Route
// gegen lib/crm-akte.js — hier wird nur geschrieben. Eine leere Liste
// entfernt den Schluessel, damit die Spalte nicht mit leeren Listen zuwaechst.
module.exports.akteZeilenSetzen = async function (user, id, kategorie, zeilen) {
  return alsNutzer(user.id, async (q) => {
    const liste = Array.isArray(zeilen) ? zeilen : [];
    const r = liste.length
      ? await q(`update firmen set akte_zeilen = jsonb_set(coalesce(akte_zeilen, '{}'::jsonb), array[$2::text], $3::jsonb, true)
                  where id = $1 returning akte_zeilen`, [id, kategorie, JSON.stringify(liste)])
      : await q(`update firmen set akte_zeilen = coalesce(akte_zeilen, '{}'::jsonb) - $2::text
                  where id = $1 returning akte_zeilen`, [id, kategorie]);
    if (!r.rowCount) return { ok: false, grund: "Firma nicht gefunden oder keine Rechte" };
    return { ok: true, akte_zeilen: r.rows[0].akte_zeilen || {} };
  });
};

// Kurzakte fuer den Kalender (Agent C zeigt sie im Termin-Popover) und fuer
// jeden, der die Firma in einem Satz braucht. null, wenn der Nutzer die
// Firma nicht sehen darf (RLS). Die naechste Aufgabe ist das Freitextfeld,
// ersatzweise das naechste offene To-do des Nutzers zu dieser Firma.
module.exports.firmaKurz = async function (user, firmaId) {
  return alsNutzer(user.id, async (q) => {
    const { rows: [f] } = await q(
      `select f.id, f.name, f.status, f.tags, f.geschaeftsfuehrer, f.ansprech_rolle, f.telefon, f.mobil, f.email,
              f.ort, f.branche, f.stand, f.umsatz_geschaetzt, f.umsatz_geplant, f.naechster_termin, f.notizen,
              coalesce(nullif(btrim(f.naechste_aufgabe), ''),
                       (select a.titel from aufgaben a where a.firma_id = f.id and not a.erledigt
                         order by a.geplant_am nulls last, a.faellig nulls last, a.erstellt limit 1)) as naechste_aufgabe
         from firmen f where f.id = $1`, [firmaId]);
    if (!f) return null;
    const notizen = f.notizen ? String(f.notizen) : "";
    return {
      // bigint kommt aus pg als Text — als Zahl, damit der Kalender vergleichen kann.
      id: Number(f.id), name: f.name, status: f.status,
      sparte: (f.tags || []).find((t) => ["webdesign", "performance", "ki"].includes(t)) || null,
      ansprechperson: f.geschaeftsfuehrer || null, ansprech_rolle: f.ansprech_rolle || null,
      telefon: f.telefon || null, mobil: f.mobil || null, email: f.email || null, ort: f.ort || null,
      branche: f.branche || null, stand: f.stand || null,
      umsatz_geschaetzt: f.umsatz_geschaetzt === null ? null : Number(f.umsatz_geschaetzt),
      umsatz_geplant: f.umsatz_geplant === null ? null : Number(f.umsatz_geplant),
      naechste_aufgabe: f.naechste_aufgabe || null,
      naechster_termin: f.naechster_termin ? alsTag(f.naechster_termin) : null,
      notizen: notizen.length > 300 ? notizen.slice(0, 297).trimEnd() + "…" : (notizen || null),
      url: `/crm/firma/${f.id}`,
    };
  });
};
