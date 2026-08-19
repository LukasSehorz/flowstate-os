// Lead-Nachschub — "das ist zu wenig, such nochmal hundert weitere raus"
// (20.08.2026).
//
// WOZU: Genau dieser Satz steht im Anzeigen-Konzept, Creative 1. Bis heute lief
// er als "lange Arbeit" an Hermes, und der meldete sich irgendwann per
// Telegram. In einer Aufnahme heisst das: Lukas sagt den Satz, Alexandra sagt
// "mach ich", und dann passiert sichtbar nichts. Gemessen am 20.08. genau so:
// Werkzeug lange_arbeit, Antwort "ich lass hundert weitere raussuchen".
//
// WAS "RAUSSUCHEN" HIER HEISST — und was nicht:
// Es werden keine Firmen aus dem Internet gezogen. Das macht der Maps-Scraper
// als eigener Vorgang, und ein Modell, das im Gespraech fremde Firmendaten
// erfindet, waere das Gegenteil eines brauchbaren CRM. Was hier passiert, ist
// das, was ein Vertriebler morgens tut: Aus dem Bestand (2.183 Leads, Stand
// 20.08.) die noch unbearbeiteten holen, sie zu einer Anrufliste buendeln und
// einer Person zuordnen. Das ist echte Arbeit, sie ist in zwei Sekunden fertig,
// und die Zahl am Ende stimmt.
//
// UMKEHRBAR (REGELN.md, Zone GELB): Es entsteht eine Liste, sonst nichts. Keine
// Firma wird veraendert, keine Nachricht geht raus, nichts kostet Geld. Wer die
// Liste nicht will, loescht sie.

const crm = require("./crm.js");
const schnell = require("./schnell.js");

const HOECHSTENS = 500;   // mehr ruft an einem Tag niemand an

// Was der Satz eigentlich verlangt. Wieder ein Modellaufruf statt Ausdruecken:
// "hundert weitere", "nochmal fuenfzig Zahnaerzte in Muenchen fuer Ioannis",
// "mehr Leads" — dazwischen liegt zu viel, um es mit einer Regel zu treffen.
const VERSTEHEN = `Du liest einen Auftrag zum Nachlegen von Leads und gibst NUR JSON zurueck:
{"anzahl":100,"ort":"","branche":"","wem":"","name":""}
- anzahl: gewuenschte Menge. Nicht genannt -> 50.
- ort: Stadt/Region, wenn genannt. Sonst "".
- branche: Branche oder Zielgruppe, wenn genannt ("Zahnaerzte", "Physio"). Sonst "".
- wem: Vorname der Person, in deren Liste sie sollen. Nicht genannt -> "".
- name: ein kurzer Listenname, falls er einen nennt. Sonst "".`;

async function verstehen(auftrag) {
  if (!process.env.SCHNELL_API_KEY) return { anzahl: 50, ort: "", branche: "", wem: "", name: "" };
  const roh = await schnell.frage(VERSTEHEN, `AUFTRAG: ${auftrag}`,
    { maxTokens: 200, temp: 0, timeoutMs: 10000, model: process.env.COMPUTER_MODEL || "claude-haiku-4-5" })
    .catch(() => "");
  const m = String(roh || "").match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : "{}"); } catch { return {}; }
}

async function leadsNachschub(auftrag, { nutzerId } = {}) {
  if (!process.env.DATABASE_URL) return { ok: false, reply: "Keine Datenbankverbindung." };
  const w = await verstehen(auftrag);
  const anzahl = Math.min(Math.max(Number(w.anzahl) || 50, 1), HOECHSTENS);

  // Wer bekommt die Liste? Genannter Vorname, sonst der Fragende, sonst der
  // erste aktive Admin. Namen mit ilike — gesprochene Namen sind ungenau.
  let besitzer = nutzerId || null, besitzerName = "dir";
  if (w.wem) {
    const { rows } = await crm.system(
      `select id, name from profiles where aktiv and name ilike $1 order by name limit 1`, [`%${w.wem}%`]);
    if (rows[0]) { besitzer = rows[0].id; besitzerName = rows[0].name.split(" ")[0]; }
  }
  if (!besitzer) {
    const { rows } = await crm.system(
      `select id, name from profiles where aktiv and rolle='admin' order by name limit 1`);
    if (!rows[0]) return { ok: false, reply: "Ich finde kein Konto, dem ich die Liste geben koennte." };
    besitzer = rows[0].id; besitzerName = rows[0].name.split(" ")[0];
  }

  // Die Auswahl. Bedingungen, jede aus einem echten Grund:
  //   status='lead'          — Kunden und Verlorene ruft niemand kalt an.
  //   telefon vorhanden      — eine Anrufliste ohne Nummer ist keine.
  //   nie angerufen          — "weitere" heisst weitere, nicht dieselben.
  //   nicht schon im Nachschub — sonst legt der zweite Aufruf dieselben
  //                            hundert nochmal hin und jemand ruft doppelt an.
  //
  // BEWUSST NICHT "gehoert noch keiner Liste": Am 20.08. gegen den echten
  // Bestand gemessen — von 2.112 anrufbaren Leads sind ALLE ueber einen Import
  // hereingekommen und damit in irgendeiner Liste. Diese Bedingung haette
  // jedes Mal null geliefert. Was zaehlt, ist nicht die Herkunft, sondern ob
  // schon jemand zum Hoerer gegriffen hat: 1.737 sind es, die noch nie
  // angerufen wurden.
  const GRUND = `f.status = 'lead'
      and coalesce(btrim(f.telefon), '') <> ''
      and not exists (select 1 from aktivitaeten a where a.firma_id = f.id and a.art = 'anruf')
      and not exists (select 1 from call_listen_eintraege e
                        join call_listen l on l.id = e.liste_id
                       where e.firma_id = f.id and l.name like 'Nachschub%')`;

  const holen = async (mitFilter) => {
    const b = [];
    let wo = GRUND;
    if (mitFilter && w.ort) { b.push(`%${w.ort}%`); wo += ` and f.ort ilike $${b.length}`; }
    if (mitFilter && w.branche) {
      b.push(`%${w.branche}%`);
      wo += ` and (f.branche ilike $${b.length} or exists (select 1 from unnest(f.tags) t where t ilike $${b.length}))`;
    }
    b.push(anzahl);
    return (await crm.system(
      `select f.id, f.name, f.ort from firmen f where ${wo}
        order by f.erstellt desc nulls last limit $${b.length}`, b)).rows;
  };

  // Erst eng suchen, dann weit — und sagen, dass gelockert wurde.
  //
  // Warum die zweite Runde (20.08.): Bei 1.089 von 2.183 Leads ist die Branche
  // gar nicht gefuellt. "Such fuenfzig Zahnarztpraxen in Muenchen" haette also
  // meistens null Treffer ergeben, obwohl 316 Muenchner Leads bereitliegen.
  // Ein "hab nichts gefunden" auf einen vollen Topf ist der schlechteste
  // Ausgang von allen.
  let treffer = await holen(true);
  let gelockert = "";
  if (!treffer.length && (w.ort || w.branche)) {
    treffer = await holen(false);
    const eng = [w.branche, w.ort].filter(Boolean).join(" in ");
    if (treffer.length) gelockert = ` Auf ${eng} genau passte nichts mehr — das sind unbearbeitete Leads quer durch den Bestand.`;
  }

  if (!treffer.length) {
    // EHRLICH SEIN, WENN DER TOPF LEER IST. Eine leere Liste anzulegen und
    // "erledigt" zu sagen waere die schlimmste Variante: Am naechsten Morgen
    // sitzt jemand vor null Nummern und glaubt, es sei etwas passiert.
    return { ok: true, reply: "Im Bestand liegt gerade nichts Unbearbeitetes mehr — alles mit Telefonnummer wurde entweder schon angerufen oder liegt schon in einer Nachschub-Liste. Da muessen neue rein." };
  }

  const name = String(w.name || "").trim() ||
    `Nachschub ${[w.branche, w.ort].filter(Boolean).join(" ")}`.trim() || "Nachschub";
  const liste = (await crm.system(
    `insert into call_listen (name, besitzer)
     values ($1 || ' vom ' || to_char(now(), 'DD.MM.'), $2) returning id, name`,
    [name, besitzer])).rows[0];
  await crm.system(
    `insert into call_listen_eintraege (liste_id, firma_id)
     select $1, unnest($2::bigint[]) on conflict do nothing`,
    [liste.id, treffer.map((t) => Number(t.id))]);

  const orte = [...new Set(treffer.map((t) => t.ort).filter(Boolean))].slice(0, 3);
  const knapp = treffer.length < anzahl
    ? ` Mehr waren nicht da — ${anzahl} hattest du gesagt, ${treffer.length} sind es geworden.` : "";
  return {
    ok: true,
    listeId: Number(liste.id),
    anzahl: treffer.length,
    reply: `${treffer.length} Leads liegen jetzt in der Liste "${liste.name}" bei ${besitzerName}` +
      (orte.length ? `, ueberwiegend ${orte.join(", ")}` : "") +
      `. Alle mit Telefonnummer, keiner davon schon angerufen.${knapp}${gelockert}`,
  };
}

module.exports = { leadsNachschub };
