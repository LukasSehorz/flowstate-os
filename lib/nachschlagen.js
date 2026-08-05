// "Wie ist der Stand bei X?" — eine Frage, alle Systeme des OS.
//
// Warum es das gibt (Lukas, 05.08.2026): "Das Ziel ist, dass Alexandra immer
// alles ueber das Unternehmen weiss wenn wir fragen: was ist der aktuelle Stand
// bei Projekt xyz, wie hat das Reel xyz performt, wie viele neue Formate haben
// wir, wie sieht es in der Buchhaltung aus, wie viele neue Rechnungen kamen
// rein."
//
// EIN Werkzeug statt fuenf. Das Modell reicht die Frage durch, dieses Modul
// entscheidet, worum es geht. Gruende:
//   - Die Werkzeugliste geht bei JEDEM Aufruf mit und ist groessenbegrenzt
//     (scripts/test-prompt.js). Fuenf Werkzeuge kosten fuenfmal Beschreibung.
//   - Lukas fragt nicht in Kategorien. "Wie laeuft das mit Krotzer" kann Firma,
//     Projekt oder Rechnung meinen — das entscheidet sich am Namen, nicht an
//     der Formulierung.
//
// Wie neuigkeiten.js: live aus der Datenbank, kein Vault-Spiegel. Begruendung
// steht dort.

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
    pool.on("error", () => {});
  }
  return pool;
}

async function frag(sql, werte) {
  try { return (await db().query(sql, werte)).rows; } catch { return null; }
}

const euro = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE") + " Euro";
const zahl = (n) => Number(n || 0).toLocaleString("de-DE");

// "vor drei Tagen" statt "2026-08-02" — Datumsangaben sind zum Vorlesen da.
function vorWie(datum) {
  if (!datum) return "";
  const tage = Math.floor((Date.now() - new Date(datum).getTime()) / 86400000);
  if (tage <= 0) return "heute";
  if (tage === 1) return "gestern";
  if (tage < 14) return `vor ${tage} Tagen`;
  if (tage < 60) return `vor ${Math.round(tage / 7)} Wochen`;
  return `vor ${Math.round(tage / 30)} Monaten`;
}

// --- Was ist gemeint? ------------------------------------------------------
//
// Zuerst die Bereichsfragen ohne Namen ("wie sieht es in der Buchhaltung aus"),
// dann die Einzelfragen mit Namen. Der Name ist alles nach dem Schluesselwort.
const ARTEN = [
  { art: "projekt", muster: /\bprojekt\w*\b/i },
  { art: "post", muster: /\b(reel\w*|post\w*|video\w*|tiktok|beitr[aä]g\w*|content|format\w*|idee\w*|kanal|kanäle|kanaele|abo\w*)\b/i },
  { art: "buchhaltung", muster: /\b(buchhaltung|rechnung\w*|beleg\w*|buchung\w*|finanz\w*|ausgabe\w*|einnahme\w*|umsatz\w*)\b/i },
  { art: "firma", muster: /\b(firma|firmen|kunde\w*|lead\w*|deal\w*|crm)\b/i },
];

// Woerter, die in einer gesprochenen Frage vorkommen, aber nie Teil eines
// Namens sind. Bleibt nach dem Aussieben nichts uebrig, war keine bestimmte
// Sache gemeint — dann wird der Ueberblick geliefert statt "finde ich nicht".
const FUELL = new RegExp("\\b(" + [
  "von", "bei", "fuer", "für", "mit", "zu", "zum", "zur", "im", "in", "am", "an", "auf",
  "das", "der", "die", "den", "dem", "des", "ein", "eine", "einen", "einem",
  "wie", "was", "wer", "wo", "wann", "welche[rsn]?", "viele?", "wieviel\\w*",
  "ist", "sind", "war", "waren", "hat", "haben", "wir", "es", "sich", "denn",
  "steht", "stand", "laeuft", "läuft", "laufen", "laufend\\w*", "gelaufen",
  "performt", "performen", "gerade", "aktuell\\w*", "jetzt", "grad", "eigentlich",
  "neue[rsn]?", "offen\\w*", "kamen", "kam", "rein", "reingekommen", "gibt",
  "aus", "denn", "nochmal", "kurz", "mal", "xyz", "bitte", "sag", "sagen", "mir",
].join("|") + ")\\b", "gi");

function saeubern(s) {
  return String(s || "").replace(/[?.!,;:]/g, " ").replace(FUELL, " ").replace(/\s{2,}/g, " ").trim();
}

function deuten(text) {
  const t = String(text || "").trim();
  for (const { art, muster } of ARTEN) {
    const m = t.match(muster);
    if (!m) continue;
    // Der Name steht ueblicherweise HINTER dem Schluesselwort ("Projekt
    // Krotzer", "Reel Fassade"). Alles Uebrige ist Frage, kein Name.
    const name = saeubern(t.slice(m.index + m[0].length));
    return { art, name: name.length > 2 ? name : "" };
  }
  // Kein Schluesselwort. Steht ein "bei/mit/von" im Satz, folgt dahinter fast
  // immer ein Firmenname ("wie laeuft es bei Krotzer und Eisele").
  const nach = t.match(/\b(bei|mit|von)\b(.*)$/i);
  const name = nach ? saeubern(nach[2]) : "";
  return { art: "firma", name: name.length > 2 ? name : "" };
}

// --- Firma / Kunde ---------------------------------------------------------
async function firma(name) {
  if (!name) return { ok: true, reply: "Bei welcher Firma denn?" };
  const treffer = await frag(
    "select id, name, status, temperatur, ort, besitzer, stand, besonderes, notizen, " +
    "       kunde_seit, letzte_aktivitaet, wiedervorlage, naechster_termin, naechste_aufgabe " +
    "from firmen where name ilike $1 order by (name ilike $2) desc, letzte_aktivitaet desc nulls last limit 3",
    ["%" + name + "%", name + "%"]);
  if (!treffer) return { ok: false, hint: "Die Firmenliste ist gerade nicht erreichbar." };
  if (!treffer.length) return { ok: true, reply: `Zu „${name}“ finde ich keine Firma.` };
  if (treffer.length > 1 && !treffer[0].name.toLowerCase().startsWith(name.toLowerCase())) {
    return { ok: true, reply: `Da hab ich mehrere: ${treffer.map((f) => f.name).join(", ")}. Welche meinst du?` };
  }
  const f = treffer[0];

  const [deals, aufgaben, letzte] = await Promise.all([
    frag("select titel, wert, status, stufe_id from deals where firma_id = $1 and status not in ('verloren') order by erstellt desc limit 3", [f.id]),
    frag("select titel, faellig from aufgaben where firma_id = $1 and erledigt is null order by faellig nulls last limit 3", [f.id]),
    frag("select art, text, zeit from aktivitaeten where firma_id = $1 order by zeit desc limit 1", [f.id]),
  ]);

  const teile = [];
  teile.push(f.kunde_seit ? `${f.name} ist Kunde seit ${new Date(f.kunde_seit).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}`
    : `${f.name}${f.status ? ", Status " + f.status : ""}${f.ort ? ", " + f.ort : ""}`);

  if (deals?.length) {
    const summe = deals.reduce((s, d) => s + (Number(d.wert) || 0), 0);
    teile.push(`${deals.length === 1 ? "ein offener Deal" : deals.length + " offene Deals"}` +
      (summe ? ` über ${euro(summe)}` : ""));
  }
  if (letzte?.[0]) {
    const l = letzte[0];
    teile.push(`letzter Kontakt ${vorWie(l.zeit)}${l.art ? " — " + l.art : ""}` +
      (l.text ? `: „${String(l.text).replace(/\s+/g, " ").slice(0, 120)}“` : ""));
  }
  if (aufgaben?.length) {
    const ueberfaellig = aufgaben.filter((a) => a.faellig && new Date(a.faellig) < new Date());
    teile.push(ueberfaellig.length
      ? `${ueberfaellig.length === 1 ? "eine überfällige Aufgabe" : ueberfaellig.length + " überfällige Aufgaben"}: ${ueberfaellig[0].titel}`
      : `${aufgaben.length === 1 ? "eine offene Aufgabe" : aufgaben.length + " offene Aufgaben"}: ${aufgaben[0].titel}`);
  }
  // Das Freitextwissen zuletzt — es ist oft das Wertvollste, aber auch das
  // laengste. Wer bis hierhin zugehoert hat, will es auch hoeren.
  const frei = [f.stand, f.besonderes, f.notizen].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (frei) teile.push(`Notiz: ${frei.slice(0, 200)}`);

  return { ok: true, reply: teile.join(". ") + "." };
}

// --- Projekt ---------------------------------------------------------------
async function projekt(name) {
  const wo = name ? "where p.titel ilike $1" : "where p.status is distinct from 'fertig'";
  const werte = name ? ["%" + name + "%"] : [];
  const treffer = await frag(
    "select p.titel, p.status, p.deadline, p.notiz, p.sparte, p.erstellt, f.name as firma " +
    "from projekte p left join firmen f on f.id = p.firma_id " + wo +
    " order by p.deadline nulls last limit 5", werte);
  if (!treffer) return { ok: false, hint: "Die Projektliste ist gerade nicht erreichbar." };
  if (!treffer.length) {
    return { ok: true, reply: name ? `Zu „${name}“ finde ich kein Projekt.` : "Es läuft gerade kein Projekt." };
  }

  // Ohne Namen: Ueberblick ueber alles Laufende.
  if (!name) {
    const liste = treffer.map((p) => {
      const frist = p.deadline ? `, bis ${new Date(p.deadline).toLocaleDateString("de-DE", { day: "numeric", month: "long" })}` : "";
      return `${p.titel}${p.firma ? " für " + p.firma : ""} — ${p.status || "läuft"}${frist}`;
    });
    return { ok: true, reply: `${treffer.length === 1 ? "Ein Projekt läuft" : treffer.length + " Projekte laufen"}: ${liste.join(". ")}.` };
  }

  const p = treffer[0];
  const teile = [`${p.titel}${p.firma ? " für " + p.firma : ""}: ${p.status || "läuft"}`];
  if (p.deadline) {
    const tage = Math.ceil((new Date(p.deadline) - Date.now()) / 86400000);
    teile.push(tage < 0 ? `Deadline war vor ${Math.abs(tage)} Tagen`
      : tage === 0 ? "Deadline ist heute"
      : `noch ${tage} Tage bis zur Deadline`);
  }
  if (p.notiz) teile.push(String(p.notiz).replace(/\s+/g, " ").slice(0, 200));
  return { ok: true, reply: teile.join(". ") + "." };
}

// --- Content: einzelner Post oder Ueberblick -------------------------------
async function post(name) {
  if (!name) return contentStand();
  const treffer = await frag(
    "select id, titel, ueberschrift, sorte, status, kanaele, veroeffentlicht_am, laenge_sek " +
    "from content_posts where titel ilike $1 or ueberschrift ilike $1 or headline ilike $1 " +
    "order by veroeffentlicht_am desc nulls last limit 3", ["%" + name + "%"]);
  if (!treffer) return { ok: false, hint: "Die Content-Liste ist gerade nicht erreichbar." };
  if (!treffer.length) return { ok: true, reply: `Zu „${name}“ finde ich keinen Beitrag.` };
  const p = treffer[0];

  // Die juengste Messung je Kanal — content_zahlen sammelt mehrere Messpunkte.
  const z = await frag(
    "select distinct on (kanal) kanal, views, likes, kommentare, shares, saves, neue_abos, " +
    "       bis_ende_proz, avg_sekunden, gemessen_am " +
    "from content_zahlen where post_id = $1 order by kanal, gemessen_am desc", [p.id]);

  const kopf = `${p.ueberschrift || p.titel}${p.sorte ? " (" + p.sorte + ")" : ""}` +
    (p.veroeffentlicht_am ? `, veröffentlicht ${vorWie(p.veroeffentlicht_am)}` : `, Status ${p.status || "offen"}`);

  if (!z?.length) return { ok: true, reply: `${kopf}. Zahlen sind dafür noch keine erfasst.` };

  const proKanal = z.map((k) => {
    const t = [`${k.kanal}: ${zahl(k.views)} Views`];
    if (k.likes) t.push(`${zahl(k.likes)} Likes`);
    if (k.kommentare) t.push(`${zahl(k.kommentare)} Kommentare`);
    if (k.neue_abos) t.push(`${zahl(k.neue_abos)} neue Abos`);
    if (k.bis_ende_proz) t.push(`${Math.round(k.bis_ende_proz)} Prozent bis zum Ende`);
    return t.join(", ");
  });
  return { ok: true, reply: `${kopf}. ${proKanal.join(". ")}.` };
}

async function contentStand() {
  const [posts, ideen, kanal] = await Promise.all([
    frag("select status, count(*)::int n from content_posts group by status order by n desc", []),
    frag("select count(*)::int n from content_ideen where status is distinct from 'verworfen'", []),
    frag("select distinct on (marke, kanal) marke, kanal, abonnenten, gemessen_am from content_kanalstand order by marke, kanal, gemessen_am desc", []),
  ]);
  const teile = [];
  if (posts?.length) teile.push(posts.map((p) => `${p.n} ${p.status || "ohne Status"}`).join(", "));
  if (ideen?.[0]?.n) teile.push(`${ideen[0].n} Ideen in der Werkstatt`);
  if (kanal?.length) {
    teile.push(kanal.map((k) => `${k.kanal}${k.marke ? " " + k.marke : ""}: ${zahl(k.abonnenten)} Abos`).join(", "));
  }
  return { ok: true, reply: teile.length ? "Content: " + teile.join(". ") + "." : "Im Content ist noch nichts erfasst." };
}

// --- Buchhaltung -----------------------------------------------------------
async function buchhaltung() {
  const [offen, belege, monat, faellig] = await Promise.all([
    frag("select count(*)::int n, coalesce(sum(betrag),0) s from buchungen where bezahlt is null and art = 'ausgabe'", []),
    frag("select status, count(*)::int n from belege where verworfen_am is null group by status order by n desc", []),
    frag("select coalesce(sum(case when art='einnahme' then betrag else 0 end),0) ein, " +
         "       coalesce(sum(case when art='ausgabe' then betrag else 0 end),0) aus " +
         "from buchungen where datum >= date_trunc('month', current_date)", []),
    frag("select gegenstelle, betrag, faellig from buchungen where bezahlt is null and faellig is not null " +
         "and faellig <= current_date + 7 order by faellig limit 3", []),
  ]);

  const teile = [];
  if (monat?.[0]) {
    const ein = Number(monat[0].ein) || 0, aus = Number(monat[0].aus) || 0;
    if (ein || aus) teile.push(`Diesen Monat ${euro(ein)} rein, ${euro(aus)} raus`);
  }
  if (offen?.[0]?.n) teile.push(`${offen[0].n} unbezahlte Ausgaben über ${euro(offen[0].s)}`);
  if (faellig?.length) {
    const f = faellig[0];
    teile.push(`als Nächstes fällig: ${f.gegenstelle || "eine Rechnung"} über ${euro(f.betrag)} am ${new Date(f.faellig).toLocaleDateString("de-DE", { day: "numeric", month: "long" })}`);
  }
  if (belege?.length) {
    const zuTun = belege.filter((b) => b.status !== "gebucht" && b.status !== "fertig");
    if (zuTun.length) teile.push(`${zuTun.reduce((s, b) => s + b.n, 0)} Belege noch nicht gebucht`);
  }
  return { ok: true, reply: teile.length ? teile.join(". ") + "." : "In der Buchhaltung ist gerade nichts offen." };
}

// --- Einstieg --------------------------------------------------------------
async function nachschlagen(auftrag) {
  if (!process.env.DATABASE_URL) return { ok: false, hint: "Keine Datenbankverbindung eingerichtet." };
  const { art, name } = deuten(auftrag);
  try {
    if (art === "projekt") return await projekt(name);
    if (art === "post") return await post(name);
    if (art === "buchhaltung") return await buchhaltung();
    return await firma(name);
  } catch (e) {
    return { ok: false, hint: "Nachschlagen: " + String(e.message).slice(0, 150) };
  }
}

module.exports = { nachschlagen, deuten };
