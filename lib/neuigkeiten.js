// "Was ist heute neu im Vergleich zu gestern?" — fuer alle Bereiche des OS.
//
// Warum es das gibt (Lukas, 05.08.2026): "Wenn ich anrufe: was ist heute neu im
// CRM im Vergleich zu gestern, dann soll da die richtige Antwort schnell
// kommen. Und das fuer alle Systeme vom Operating System."
//
// WARUM AUS DER DATENBANK UND NICHT AUS DEM VAULT: Die naheliegende Idee war,
// alles als Markdown in den Vault zu spiegeln und dort zu suchen. Dagegen
// sprechen gemessene Zahlen — 812 Firmen, 45 Deals, 703 Aktivitaeten. Ein
// Spiegel davon waere ein Sync-Job ueber 812 Dateien, zwei Wahrheiten, die
// auseinanderlaufen, sobald er einmal haengt, und eine SCHLECHTERE Antwort:
// Textsuche statt Abfrage. Der Vault bleibt fuer Wissen, das in keiner Spalte
// steht. Der aktuelle Stand kommt live von dort, wo er entsteht.
//
// Jede Tabelle traegt einen Zeitstempel ("erstellt", bei Aktivitaeten "zeit").
// Genau daran haengt alles hier.

const { Pool } = require("pg");

let pool = null;
function db() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 20000,
    });
    pool.on("error", () => { /* eine tote Verbindung darf nichts umwerfen */ });
  }
  return pool;
}

// Zeitraum aus dem gesprochenen Auftrag. Vorgabe: seit gestern frueh, damit
// "was ist neu" auch morgens um acht noch etwas findet.
//
// Absichtlich grosszuegig: Lieber eine Stunde zu viel als die Antwort "nichts
// Neues", waehrend im CRM seit gestern Abend zehn Dinge passiert sind.
function zeitraumAus(text) {
  const t = String(text || "").toLowerCase();
  const jetzt = new Date();
  const tagesBeginn = (minusTage) => {
    const d = new Date(jetzt);
    d.setDate(d.getDate() - minusTage);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  if (/\b(woche|7 tage|sieben tage)\b/.test(t)) return { seit: tagesBeginn(7), wort: "in den letzten sieben Tagen" };
  if (/\b(monat|30 tage)\b/.test(t)) return { seit: tagesBeginn(30), wort: "im letzten Monat" };
  if (/\bgestern\b/.test(t)) return { seit: tagesBeginn(1), wort: "seit gestern" };
  if (/\bheute\b/.test(t)) return { seit: tagesBeginn(0), wort: "heute" };
  return { seit: tagesBeginn(1), wort: "seit gestern" };
}

// Welcher Bereich ist gemeint? Ohne Hinweis: alle.
function bereichAus(text) {
  const t = String(text || "").toLowerCase();
  // Beugungsfest: "Projekten", "Kunden", "Rechnungen" muessen genauso greifen
  // wie die Grundform. Der erste Entwurf schrieb \b(projekt|projekte)\b und
  // liess "bei den Projekten" durchfallen — die Frage landete dann bei "alles"
  // und Lukas bekam vier Bereiche vorgelesen statt einem.
  if (/\b(crm|kund\w*|lead\w*|deal\w*|vertrieb\w*|akquise)\b/.test(t)) return "crm";
  if (/\b(buchhaltung|rechnung\w*|beleg\w*|buchung\w*|umsatz\w*|finanz\w*)\b/.test(t)) return "buchhaltung";
  if (/\b(marketing|content|post\w*|kampagne\w*|ads|social)\b/.test(t)) return "marketing";
  if (/\b(projekt\w*|umsetzung\w*)\b/.test(t)) return "projekte";
  return "alles";
}

// Eine Abfrage, die nie den ganzen Aufruf umwirft. Faellt eine Tabelle aus
// (umbenannt, Rechte fehlen), fehlt genau ihre Zeile — nicht die Antwort.
async function zaehle(sql, werte) {
  try {
    const r = await db().query(sql, werte);
    return r.rows;
  } catch {
    return null;
  }
}

const einsMehr = (n, eins, viele) => (n === 1 ? `ein ${eins}` : `${n} ${viele}`);

// Firmennamen sind fuer Register geschrieben, nicht zum Vorlesen. Im ersten
// Live-Lauf kam heraus: "5 neue Deals bei Lutz Schadstoffsanierung Thomas
// Sassinek e.K. Asbestabbau und Hausmeisterservice Sykora" — drei Firmen, die
// wie eine klangen. Rechtsform und Leistungsbeschreibung weg, dann bleibt der
// Name, den Lukas selbst benutzt.
function sprechName(name) {
  const knapp = String(name || "")
    .replace(/\s*[-–—]\s*.*$/, "")                       // "Sabine Leiseder – Fliesenlegermeisterin"
    .replace(/\b(GmbH|AG|UG|e\.?\s?K\.?|OHG|KG|GbR|mbH|& Co\.?)\b\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim() || String(name || "").trim();
  // Manche Eintraege sind ganze Leistungsbeschreibungen ("Lutz
  // Schadstoffsanierung Thomas Sassinek Asbestabbau"). Drei Woerter reichen,
  // um eine Firma wiederzuerkennen — alles danach hoert ohnehin niemand mehr.
  const w = knapp.split(/\s+/);
  return w.length > 3 ? w.slice(0, 3).join(" ") : knapp;
}
const aufzaehlen = (namen) => (namen.length <= 1 ? (namen[0] || "")
  : namen.slice(0, -1).join(", ") + " und " + namen[namen.length - 1]);

// --- CRM -------------------------------------------------------------------
async function crm(seit) {
  const teile = [];

  const neueFirmen = await zaehle(
    "select name, status from firmen where erstellt >= $1 order by erstellt desc limit 6", [seit]);
  if (neueFirmen?.length) {
    const namen = aufzaehlen(neueFirmen.slice(0, 2).map((f) => sprechName(f.name)));
    teile.push(neueFirmen.length > 2
      ? `${neueFirmen.length} neue Firmen, darunter ${namen}`
      : `${einsMehr(neueFirmen.length, "neue Firma", "neue Firmen")}: ${namen}`);
  }

  const neueDeals = await zaehle(
    "select d.titel, d.wert, f.name as firma from deals d left join firmen f on f.id = d.firma_id " +
    "where d.erstellt >= $1 order by d.erstellt desc limit 5", [seit]);
  if (neueDeals?.length) {
    const summe = neueDeals.reduce((s, d) => s + (Number(d.wert) || 0), 0);
    const wo = aufzaehlen(neueDeals.slice(0, 2).map((d) => sprechName(d.firma || d.titel)));
    teile.push(`${einsMehr(neueDeals.length, "neuer Deal", "neue Deals")} bei ${wo}` +
      (neueDeals.length > 2 ? " und weiteren" : "") +
      (summe ? `, zusammen ${Math.round(summe).toLocaleString("de-DE")} Euro` : ""));
  }

  const gewonnen = await zaehle(
    "select f.name as firma, d.wert from deals d left join firmen f on f.id = d.firma_id " +
    "where d.status = 'gewonnen' and d.geschlossen_am >= $1 order by d.geschlossen_am desc limit 5", [seit]);
  if (gewonnen?.length) {
    teile.push(`${einsMehr(gewonnen.length, "Deal gewonnen", "Deals gewonnen")}: ` +
      gewonnen.map((d) => d.firma).filter(Boolean).join(", "));
  }

  // Aktivitaeten sind der Puls: Anrufe, Notizen, Aussortiertes. Zusammengefasst
  // nach Art, sonst wird daraus eine Liste, die niemand zu Ende hoert.
  //
  // Die Datenbank-Schluessel sind fuer Spalten gemacht, nicht fuers Ohr — im
  // ersten Live-Lauf kam "354 mal anruf, 259 mal aussortiert, 6 mal
  // stufenwechsel, 3 mal system" heraus. Deshalb hier deutsche Woerter, und
  // "system" faellt ganz weg: Das sind Eintraege, die das OS selbst erzeugt.
  const WORT = {
    anruf: ["Anruf", "Anrufe"], notiz: ["Notiz", "Notizen"],
    aussortiert: ["Firma aussortiert", "Firmen aussortiert"],
    stufenwechsel: ["Deal weitergerueckt", "Deals weitergerueckt"],
    mail: ["Mail", "Mails"], termin: ["Termin", "Termine"],
  };
  const akt = await zaehle(
    "select art, count(*)::int as n from aktivitaeten where zeit >= $1 and art <> 'system' " +
    "group by art order by n desc limit 3", [seit]);
  if (akt?.length) {
    teile.push(aufzaehlen(akt.map((a) => {
      const w = WORT[a.art];
      return w ? `${a.n} ${a.n === 1 ? w[0] : w[1]}` : `${a.n} mal ${a.art}`;
    })));
  }

  // "erledigt" ist ein Ja/Nein, KEIN Zeitpunkt — es gibt also keinen Stempel,
  // wann etwas abgehakt wurde. Gemeldet wird deshalb, was noch offen und
  // ueberfaellig ist; das ist ohnehin die nuetzlichere Auskunft.
  const faellig = await zaehle(
    "select count(*)::int as n from aufgaben where not erledigt and faellig < current_date", []);
  if (faellig?.[0]?.n) teile.push(`${faellig[0].n} Aufgaben überfällig`);

  return teile;
}

// --- Buchhaltung -----------------------------------------------------------
async function buchhaltung(seit) {
  const teile = [];
  const belege = await zaehle("select count(*)::int as n from belege where erstellt >= $1", [seit]);
  if (belege?.[0]?.n) teile.push(`${einsMehr(belege[0].n, "neuer Beleg", "neue Belege")}`);
  const buch = await zaehle(
    "select count(*)::int as n, coalesce(sum(betrag),0) as summe from buchungen where erstellt >= $1", [seit]);
  if (buch?.[0]?.n) {
    const s = Number(buch[0].summe) || 0;
    teile.push(`${buch[0].n} Buchungen` + (s ? `, unterm Strich ${Math.round(s).toLocaleString("de-DE")} Euro` : ""));
  }
  return teile;
}

// --- Marketing / Content ---------------------------------------------------
async function marketing(seit) {
  const teile = [];
  const posts = await zaehle("select count(*)::int as n from content_posts where erstellt >= $1", [seit]);
  if (posts?.[0]?.n) teile.push(`${einsMehr(posts[0].n, "neuer Post", "neue Posts")}`);
  const ideen = await zaehle("select count(*)::int as n from content_ideen where erstellt >= $1", [seit]);
  if (ideen?.[0]?.n) teile.push(`${einsMehr(ideen[0].n, "neue Idee", "neue Ideen")}`);
  const kamp = await zaehle("select count(*)::int as n from kampagnen where erstellt >= $1", [seit]);
  if (kamp?.[0]?.n) teile.push(`${einsMehr(kamp[0].n, "neue Kampagne", "neue Kampagnen")}`);
  return teile;
}

// --- Projekte --------------------------------------------------------------
async function projekte(seit) {
  const teile = [];
  const p = await zaehle("select name from projekte where erstellt >= $1 order by erstellt desc limit 4", [seit]);
  if (p?.length) teile.push(`${einsMehr(p.length, "neues Projekt", "neue Projekte")}: ` + p.map((x) => x.name).join(", "));
  const d = await zaehle("select count(*)::int as n from dokumente where erstellt >= $1", [seit]);
  if (d?.[0]?.n) teile.push(`${d[0].n} neue Dokumente`);
  return teile;
}

const BEREICHE = { crm, buchhaltung, marketing, projekte };
const TITEL = { crm: "Im CRM", buchhaltung: "In der Buchhaltung", marketing: "Im Marketing", projekte: "Bei den Projekten" };

// Sprechfertige Antwort. Wird direkt vorgelesen, ohne Umweg ueber das Modell —
// hier gibt es nichts zu deuten, nur zu berichten.
async function neuigkeiten(auftrag) {
  if (!process.env.DATABASE_URL) {
    return { ok: false, hint: "Keine Datenbankverbindung eingerichtet." };
  }
  const { seit, wort } = zeitraumAus(auftrag);
  const bereich = bereichAus(auftrag);
  const gefragt = bereich === "alles" ? Object.keys(BEREICHE) : [bereich];

  try {
    const ergebnisse = await Promise.all(gefragt.map(async (b) => [b, await BEREICHE[b](seit)]));
    const mitInhalt = ergebnisse.filter(([, t]) => t.length);

    if (!mitInhalt.length) {
      return { ok: true, reply: bereich === "alles"
        ? `${wort.charAt(0).toUpperCase() + wort.slice(1)} hat sich nichts getan.`
        : `${TITEL[bereich]} hat sich ${wort} nichts getan.` };
    }

    // Bei einem Bereich ohne Ueberschrift sprechen, bei mehreren mit — sonst
    // weiss Lukas nicht, wovon gerade die Rede ist.
    if (mitInhalt.length === 1 && bereich !== "alles") {
      return { ok: true, reply: `${TITEL[bereich]} ${wort}: ${mitInhalt[0][1].join(". ")}.` };
    }
    const satz = mitInhalt.map(([b, t]) => `${TITEL[b]}: ${t.join(", ")}`).join(". ");
    return { ok: true, reply: `${wort.charAt(0).toUpperCase() + wort.slice(1)} — ${satz}.` };
  } catch (e) {
    return { ok: false, hint: "Neuigkeiten: " + String(e.message).slice(0, 150) };
  }
}

module.exports = { neuigkeiten, zeitraumAus, bereichAus };
