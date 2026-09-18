// lib/kalender-akte.js — der Faden zwischen Google-Kalender und Kundenakte.
//
// Wunsch Lukas (05.09.2026): Im OS-Kalender einen Kundentermin eintragen und
// die Kunden- oder Lead-Akte aus dem CRM anhaengen; beim Klick auf den Termin
// die Akte sehen, ohne zwischen fuenf Tabs zu springen. Ein ueber Telesales
// gebuchtes Erstgespraech soll von selbst im Kalender stehen — und wenn das
// Datum in der Akte geaendert wird, wandert der Termin mit, statt dass ein
// zweiter entsteht.
//
// Wo was liegt:
//   Termine       bei Google (lib/kalender.js liest, lib/werkzeuge.js schreibt)
//   Firmen        im CRM (lib/crm.js, mit Row-Level-Security)
//   der Faden     Tabelle termin_verknuepfungen (Migration 0059):
//                 Google-Termin-ID -> Firma, art 'termin' | 'erstgespraech'
//   Rueckfall     eine Zeile "Kundenakte: <OS_URL>/crm/firma/<id>" in der
//                 Terminbeschreibung. Sie ist fuer Menschen gedacht (im Handy
//                 sieht man den Link) und rettet die Zuordnung, wenn die Zeile
//                 in der Datenbank fehlt (Termin vor der Migration angelegt).
//
// RECHTE-GRUNDSATZ (nach der Pruefung vom 05.09.): Zeile in Google und Faden
// in der Datenbank werden nur GEMEINSAM geschrieben — und der Faden zuerst,
// wo es geht. Die Datenbank ist die Instanz, die weiss, wer welche Firma
// sehen darf (RLS); Google weiss das nicht. Deshalb:
//   - vor jeder Verknuepfung wird gefragt, ob der Nutzer die Firma sieht
//     (firmaSichtbar) — sonst keine Zeile, kein Faden, lesbarer Grund;
//   - haengt ein Termin schon an einer Akte, die der Nutzer nicht sieht
//     (fadenSystem ohne Zeilenrechte gegen verknuepfungVon mit), darf er ihn
//     nicht umhaengen — sonst saehen zwei Personen zwei verschiedene Akten;
//   - Schreibfunktionen liefern { ok, grund } zurueck, nichts wird geschluckt.
//
// VERTRAG mit dem CRM (lib/crm.js ruft das beim Speichern von
// erstgespraech_am und beim Buchen im Cold Call; die Akte zeigt
// termineVonFirma). Die zwei Funktionen WERFEN NIE — ein Kalender, der
// gerade nicht antwortet, darf keinen Speichervorgang im CRM scheitern lassen.
//
//   erstgespraechSynchronisieren(user, firmaId, { wann, ort, notiz, dauerMin })
//   dauerMin ist ohne Angabe ERSTGESPRAECH_DAUER_MIN = 30 Minuten.
//     -> { ok:true, id }  |  { ok:false, grund }
//   termineVonFirma(user, firmaId)
//     -> [{ id, titel, start, ende, ort, htmlLink, art, ganztags, fehlt? }]
//
// Alles rechnet in Berliner Wandzeit. Die Zeitzonenarbeit (Offset anhaengen)
// bleibt in lib/werkzeuge.js zeitNormal() — hier werden nur Wanduhr-Strings
// gebaut ("2026-09-10T14:00"), nie Date-Objekte in Zonen umgerechnet.

const fs = require("fs");
const path = require("path");
const kal = require("./kalender.js");
const werkzeuge = require("./werkzeuge.js");

// ----------------------------------------------------------- Akte-Zeile
//
// Die Zeile in der Terminbeschreibung. OS_URL ist die Adresse des OS von
// aussen (z. B. https://os.flowstate-ai.net) — fehlt sie, bleibt der Link
// relativ, was im OS selbst funktioniert und im Handy immerhin die Nummer zeigt.

const AKTE_MARKE = "Kundenakte:";
const BESCHREIBUNG_MAX = 500;          // Deckel von werkzeuge.js (-d wird dort geschnitten)

const basisUrl = () => String(process.env.OS_URL || "").trim().replace(/\/+$/, "");
const akteUrl = (firmaId) => `${basisUrl()}/crm/firma/${Number(firmaId)}`;
const akteZeile = (firmaId) => `${AKTE_MARKE} ${akteUrl(firmaId)}`;

// Beschreibung ohne Akte-Zeile — das, was im Notizfeld des Dialogs steht.
function beschreibungOhneAkte(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((z) => !new RegExp("^\\s*" + AKTE_MARKE, "i").test(z))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Beschreibung mit GENAU EINER Akte-Zeile am Ende. Der Freitext wird so
// gekuerzt, dass die Zeile den 500-Zeichen-Deckel von gws-cli sicher
// uebersteht — sonst wuerde ausgerechnet der Link abgeschnitten.
function mitZeile(text, zeile) {
  const rein = beschreibungOhneAkte(text);
  if (!zeile) return rein;
  const platz = BESCHREIBUNG_MAX - zeile.length - 2;
  const kopf = rein.length > platz ? rein.slice(0, Math.max(0, platz - 1)).trimEnd() + "…" : rein;
  return (kopf ? kopf + "\n\n" : "") + zeile;
}
function beschreibungMitAkte(text, firmaId) {
  return mitZeile(text, Number(firmaId) ? akteZeile(firmaId) : "");
}

// Firma-ID aus der Beschreibung — Rueckfallebene ohne Datenbankzeile.
function akteAusBeschreibung(text) {
  const m = String(text || "").match(new RegExp(AKTE_MARKE + "[^\\n]*?/crm/firma/(\\d+)", "i"));
  return m ? Number(m[1]) : null;
}

// Die Akte-Zeile so, wie sie in Google STEHT — Wort fuer Wort. Beim Bearbeiten
// wird sie nicht neu gebaut: die Basis-URL stammt von dem Server, der den
// Termin angelegt hat, und OS_URL kann dort gesetzt sein und hier fehlen (oder
// andersherum). Wer nur die Notiz aendert, hat nicht darum gebeten, dass sich
// der Link darunter aendert — und ein Termin, dessen Link ploetzlich relativ
// ist, fuehrt im Handy-Google ins Leere. Beim Umhaengen wird deshalb nur die
// Nummer in der vorhandenen Zeile getauscht; eine ganz neue Zeile entsteht
// nur, wenn vorher keine da war (Pruefung 05.09., Punkte 1-3).
function akteZeileAus(text) {
  const treffer = String(text || "").split(/\r?\n/)
    .find((z) => new RegExp("^\\s*" + AKTE_MARKE + "[^\\n]*?/crm/firma/\\d+", "i").test(z));
  return treffer ? treffer.trim() : "";
}

// Was beim "Bearbeiten" in die Beschreibung geschrieben wird — als reine
// Entscheidung, damit sie ohne Datenbank pruefbar ist.
//   darfAkte          Nutzer hat Datenbank + persoenliches Konto
//   akteGeaendert     im Dialog wurde wirklich eine Firma gewaehlt/entfernt
//   firmaNeu          gewaehlte Firma (0 = entfernt)
//   beschreibungVoll  Google-Text beim Oeffnen (mit Akte-Zeile)
//   notizNeu/notizAlt Freitext jetzt / beim Oeffnen
// Regel: Die bestehende Akte-Zeile bleibt IMMER erhalten, wenn der Nutzer den
// Faden nicht aendern darf oder das Formular keine Akte-Aenderung enthaelt —
// eine Notizaenderung durch einen Mitarbeiter darf keine Akte loeschen.
function beschreibungBeimAendern({ darfAkte, akteGeaendert, firmaNeu, beschreibungVoll, notizNeu, notizAlt }) {
  const bestehend = akteAusBeschreibung(beschreibungVoll) || 0;
  const alteZeile = bestehend ? akteZeileAus(beschreibungVoll) : "";
  const wechsel = Boolean(darfAkte && akteGeaendert);
  const ziel = wechsel ? (Number(firmaNeu) || 0) : bestehend;
  const notizGeaendert = String(notizNeu || "").trim() !== String(notizAlt || "").trim();
  const aendern = notizGeaendert || (wechsel && ziel !== bestehend);
  let zeile = "";
  if (ziel) {
    if (!alteZeile) zeile = akteZeile(ziel);                                   // vorher keine Akte
    else if (ziel === bestehend) zeile = alteZeile;                            // unveraendert uebernehmen
    else zeile = alteZeile.replace(/\/crm\/firma\/\d+/i, "/crm/firma/" + ziel); // nur die Nummer tauschen
  }
  return { beschreibung: aendern ? mitZeile(notizNeu, zeile) : undefined, ziel, bestehend, aendern };
}

// Darf ein Termin umgehaengt werden? Nur, wenn es keinen Faden gibt — oder der
// Nutzer den vorhandenen sieht. Sonst saehen zwei Personen zwei Akten.
const umhaengenErlaubt = (fadenOhneRechte, fadenMitRechten) => !fadenOhneRechte || Boolean(fadenMitRechten);

// Traegt das abgeschickte Formular ueberhaupt eine Akte-Wahl?
//
// Zwei Wege sagen ja:
//   a) akte_geaendert=1 — der Dialog setzt das Feld genau dann, wenn ein
//      Mensch eine Firma gewaehlt ODER die Pille weggeklickt hat. Nur dieser
//      Weg darf eine bestehende Verknuepfung auch LOESEN.
//   b) ein konkretes firma_id, das nicht dem mitgeschickten firma_alt
//      entspricht. Eine Firmennummer kann nur aus einer Auswahl stammen; sie
//      zaehlt darum auch ohne das Feld (aeltere Formulare, Skripte, ein Tab,
//      der noch die alte Seite zeigt).
// Ein LEERES firma_id ohne akte_geaendert zaehlt nie — genau daran hing am
// 05.09.2026 der Fehler, dass die Notizaenderung eines Mitarbeiters die
// Akte-Zeile loeschte: sein Formular trug ein leeres Feld, weil er die Firma
// gar nicht sehen durfte, nicht weil er sie entfernen wollte.
function akteWahlImFormular({ akteGeaendert, firmaId, firmaAlt } = {}) {
  if (akteGeaendert) return true;
  const neu = String(firmaId ?? "").trim();
  if (!/^\d{1,12}$/.test(neu) || Number(neu) <= 0) return false;
  const alt = String(firmaAlt ?? "").trim();
  return Number(neu) !== (/^\d{1,12}$/.test(alt) ? Number(alt) : 0);
}

// ----------------------------------------------------------- Zeitplan
//
// "wann" kommt aus dem CRM als timestamptz (Date), als ISO-Text mit Zone, als
// "2026-09-10T14:00" (Wandzeit, so schickt es der datetime-local-Dialog) oder
// als reiner Tag. Mitternacht heisst laut Migration 0051 "Tag bekannt,
// Uhrzeit nicht" — dann wird der Termin GANZTAEGIG eingetragen, statt um
// 00:00 Uhr eine Uhrzeit zu behaupten, die nie jemand vereinbart hat.

const p2 = (n) => String(n).padStart(2, "0");

// Beliebige Eingabe -> "JJJJ-MM-TTTHH:MM" in Berliner Wandzeit, oder "JJJJ-MM-TT".
function wandzeit(wann) {
  if (wann instanceof Date) {
    if (Number.isNaN(wann.getTime())) return null;
    try {
      const s = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(wann);
      return s.replace(" ", "T").replace(/T24:/, "T00:");
    } catch { return null; }
  }
  const s = String(wann || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  // Mit Zone: echter Zeitpunkt, in Berliner Wandzeit umrechnen.
  if (m[4]) return wandzeit(new Date(s));
  return `${m[1]}T${m[2]}:${m[3]}`;
}

// Wanduhr plus Minuten — reine Kalenderarithmetik ueber Date.UTC, damit die
// Zeitzone des Servers keine Rolle spielt (dieselbe Lehre wie in
// werkzeuge.js stundeSpaeter, 25.07.).
function plusMinuten(wand, minuten) {
  const m = String(wand).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + minuten * 60000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

// Wie lang ein Erstgespraech dauert: 30 Minuten (08.09.2026, vorher 45).
// Lukas: "Erstgespräch 30 Minuten." Ein Kennenlernen ist in einer halben
// Stunde gefuehrt — die 45 haben ihm den Nachmittag zerschnitten. Eine
// Konstante und kein Umgebungswert: Es ist eine Hausregel, keine Stellschraube
// je Maschine. Wer sie aendert, aendert sie hier.
const ERSTGESPRAECH_DAUER_MIN = 30;

// -> { ganztags, start, ende, tag, uhrzeit } oder null, wenn nichts lesbar ist.
function zeitplan(wann, dauerMin = ERSTGESPRAECH_DAUER_MIN) {
  const w = wandzeit(wann);
  if (!w) return null;
  const tag = w.slice(0, 10), uhrzeit = w.length > 10 ? w.slice(11, 16) : "";
  if (!uhrzeit || uhrzeit === "00:00") return { ganztags: true, start: tag, ende: tag, tag, uhrzeit: "" };
  const dauer = Math.max(15, Math.min(8 * 60, Number(dauerMin) || ERSTGESPRAECH_DAUER_MIN));
  return { ganztags: false, start: w, ende: plusMinuten(w, dauer), tag, uhrzeit };
}

// ----------------------------------------------------------- Zuordnung
//
// Verknuepfungen (aus der Datenbank) mit den Terminen (von Google) verheiraten.
// Was Google nicht mehr kennt (abgesagt), bleibt als { fehlt:true } sichtbar —
// die Akte soll nicht so tun, als haette es den Termin nie gegeben.
function zuordnen(verknuepfungen, termine) {
  const je = new Map((termine || []).map((t) => [String(t.id), t]));
  const liste = (verknuepfungen || []).map((v) => {
    const t = je.get(String(v.event_id));
    if (!t) return { id: v.event_id, art: v.art || "termin", fehlt: true, titel: "", start: "", ende: "", ort: "", htmlLink: "" };
    const e = {
      id: v.event_id, art: v.art || "termin",
      titel: t.titel || "", start: t.start || "", ende: t.ende || "", ort: t.ort || "",
      htmlLink: t.htmlLink || t.html_link || "", ganztags: kal.istGanztags(t),
    };
    if (t.ausserhalb) e.ausserhalb = true;      // per ID gefunden, liegt ausserhalb des Fensters
    return e;
  });
  liste.sort((a, b) => (a.fehlt === b.fehlt ? String(a.start).localeCompare(String(b.start)) : a.fehlt ? 1 : -1));
  return liste;
}

// ----------------------------------------------------------- Lesen in Scheiben
//
// kal.spanne hat einen Deckel (Vorgabe 200 — der Wert, der gegen gws-cli
// geprueft ist). Fuer "alle Termine einer Firma" reicht das nicht: ab dem
// 201. Termin im Fenster gaelte ein vorhandener Termin als verschwunden.
// Darum hier mit hohem Deckel — und faellt selbst der, in 30-Tage-Scheiben.
const DECKEL = 2000;

// [von, bis] in Fenster von je `tage` Tagen, lueckenlos, ohne Ueberlappung.
function scheiben(von, bis, tage = 30) {
  const liste = [];
  let a = von;
  while (a <= bis) {
    const b = kal.tagPlus(a, tage - 1);
    liste.push([a, b > bis ? bis : b]);
    a = kal.tagPlus(a, tage);
  }
  return liste;
}

async function spanneVoll(von, bis) {
  const erst = await kal.spanne(von, bis, DECKEL);
  if (!erst.ok || erst.termine.length < DECKEL) return erst;
  const je = new Map();
  for (const [a, b] of scheiben(von, bis, 30)) {
    const r = await kal.spanne(a, b, DECKEL);
    if (!r.ok) return r;
    for (const t of r.termine) je.set(String(t.id), t);
  }
  return { ok: true, termine: [...je.values()] };
}

// Ein Termin gezielt nach ID — nur der Direktweg kann das (events/<id>);
// gws-cli kennt im Haus keinen "get". null = nicht gefunden oder kein Weg.
async function terminNachId(id) {
  try { return await kal.terminNachId(id); } catch { return null; }
}

// ----------------------------------------------------------- Zugang
//
// Schreiben geht nur ueber gws-cli (lib/werkzeuge.js). Liegt es nicht im PATH,
// ist der Kalender auf dieser Maschine nicht angebunden — auf dem Laptop der
// Normalfall, kein Defekt. Lesen kann zusaetzlich der Direktweg (Token-Datei).
function gwsDa() {
  const namen = ["gws-cli", "gws-cli.exe", "gws-cli.cmd"];
  return String(process.env.PATH || "").split(path.delimiter).some((ordner) => {
    if (!ordner) return false;
    return namen.some((n) => { try { return fs.existsSync(path.join(ordner, n)); } catch { return false; } });
  });
}
function lesenMoeglich() {
  try { if (require("./kalender-direkt.js").bereit()) return true; } catch { /* egal */ }
  return gwsDa();
}
const schreibenMoeglich = () => gwsDa();

// ----------------------------------------------------------- Datenbank
//
// Lesen ueber crm.alsNutzer — mit Zeilenrechten. Ohne Datenbank, ohne
// persoenliches Konto oder ohne die Tabelle (Migration noch nicht eingespielt)
// gibt es schlicht keine Verknuepfungen; der Kalender laeuft weiter.
// SCHREIBEN liefert immer { ok, grund } — nichts wird geschluckt.
function crmModul() {
  if (!process.env.DATABASE_URL) return null;
  try { return require("./crm.js"); } catch { return null; }
}

let tabelleGemeldet = false;
function dbMelden(text) {
  if (/termin_verknuepfungen/.test(text) && /does not exist|existiert nicht/i.test(text)) {
    if (!tabelleGemeldet) {
      tabelleGemeldet = true;
      console.warn("Kalender-Akte: Tabelle termin_verknuepfungen fehlt — Migration 0059 einspielen (node scripts/migrieren.js --einspielen).");
    }
    return "tabelle-fehlt";
  }
  console.error("Kalender-Akte: Datenbank —", text.slice(0, 160));
  return /row-level security|violates/i.test(text) ? "akte-unsichtbar" : text.slice(0, 160);
}

async function mitDb(user, arbeit, ersatz = null) {
  const crm = crmModul();
  if (!crm || !user || !user.id) return ersatz;
  try { return await crm.alsNutzer(user.id, arbeit); }
  catch (e) { dbMelden(String(e.message || "")); return ersatz; }
}

// Schreibend: Ergebnis statt Ersatzwert.
async function mitDbErgebnis(user, arbeit) {
  const crm = crmModul();
  if (!crm) return { ok: false, grund: "keine-datenbank" };
  if (!user || !user.id) return { ok: false, grund: "kein-konto" };
  try { return { ok: true, wert: await crm.alsNutzer(user.id, arbeit) }; }
  catch (e) { return { ok: false, grund: dbMelden(String(e.message || "")) }; }
}

// Sieht der Nutzer diese Firma? (RLS entscheidet — die Firmen-Policy.)
async function firmaSichtbar(user, firmaId) {
  const id = Number(firmaId);
  if (!id) return false;
  const rows = await mitDb(user, async (q) => (await q(`select 1 from firmen where id = $1`, [id])).rows, null);
  return Array.isArray(rows) && rows.length > 0;
}

// Der Faden OHNE Zeilenrechte (Systemblick). Beantwortet nur die Frage "gibt
// es einen?" — damit ein Nutzer, der den Faden nicht sieht, ihn nicht
// unwissentlich ueberschreibt. Inhalte daraus kommen nie in die Oberflaeche.
async function faedenSystem(eventIds) {
  const ids = [...new Set((eventIds || []).map((x) => String(x || "")).filter(Boolean))];
  const crm = crmModul();
  if (!crm || !ids.length) return new Map();
  try {
    const { rows } = await crm.system(
      `select event_id, firma_id, art from termin_verknuepfungen where event_id = any($1::text[])`, [ids]);
    return new Map(rows.map((r) => [String(r.event_id), { firma_id: Number(r.firma_id), art: r.art }]));
  } catch (e) { dbMelden(String(e.message || "")); return new Map(); }
}
async function fadenSystem(eventId) {
  if (!eventId) return null;
  return (await faedenSystem([eventId])).get(String(eventId)) || null;
}

// Nach dem Absagen: der Google-Termin ist weg, der Faden waere nur noch ein
// Geist. Er darf auch dann gehen, wenn der Loeschende die Akte nicht sieht —
// den Termin selbst durfte er loeschen, es ist EIN gemeinsamer Kalender.
async function fadenEntfernenSystem(eventId) {
  const crm = crmModul();
  if (!crm || !eventId) return { ok: false, grund: "keine-datenbank" };
  try {
    const r = await crm.system(`delete from termin_verknuepfungen where event_id = $1`, [String(eventId)]);
    return { ok: true, geloescht: r.rowCount };
  } catch (e) { return { ok: false, grund: dbMelden(String(e.message || "")) }; }
}

// Verknuepfungen zu einer Liste von Termin-IDs -> Map(event_id -> { firma_id, art, firma_name, firma_status }).
// Nur, was die Firmen-Policy dem Nutzer zeigt: die Verknuepfung eines fremden
// Kunden ist fuer einen Mitarbeiter unsichtbar.
async function verknuepfungenFuer(user, eventIds) {
  const ids = [...new Set((eventIds || []).map((x) => String(x || "")).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await mitDb(user, async (q) => (await q(
    `select v.event_id, v.firma_id, v.art, f.name as firma_name, f.status as firma_status
       from termin_verknuepfungen v join firmen f on f.id = v.firma_id
      where v.event_id = any($1::text[])`, [ids])).rows, []);
  return new Map((rows || []).map((r) => [String(r.event_id), {
    firma_id: Number(r.firma_id), art: r.art, firma_name: r.firma_name, firma_status: r.firma_status,
  }]));
}

async function verknuepfungVon(user, eventId) {
  const karte = await verknuepfungenFuer(user, [eventId]);
  return karte.get(String(eventId)) || null;
}

async function verknuepfungenVonFirma(user, firmaId) {
  const id = Number(firmaId);
  if (!id) return [];
  return mitDb(user, async (q) => (await q(
    `select event_id, kalender_id, firma_id, art, erstellt
       from termin_verknuepfungen where firma_id = $1 order by erstellt`, [id])).rows, []);
}

// Anlegen oder umhaengen -> { ok:true } | { ok:false, grund }.
//   akte-unsichtbar  der Nutzer sieht die Firma nicht (RLS)
//   faden-fremd      der Termin haengt schon an einer Akte, die der Nutzer nicht sieht
// Ein Erstgespraech bleibt eines, auch wenn jemand die Firma im Dialog neu
// waehlt — nur das CRM selbst stuft hoch.
async function verknuepfungSetzen(user, { eventId, firmaId, art = "termin" }) {
  const id = Number(firmaId);
  if (!eventId || !id) return { ok: false, grund: "keine Angaben" };
  if (!crmModul()) return { ok: false, grund: "keine-datenbank" };
  if (!user || !user.id) return { ok: false, grund: "kein-konto" };
  if (!(await firmaSichtbar(user, id))) return { ok: false, grund: "akte-unsichtbar" };
  const vorhanden = await fadenSystem(eventId);
  if (vorhanden && !umhaengenErlaubt(vorhanden, await verknuepfungVon(user, eventId))) {
    return { ok: false, grund: "faden-fremd" };
  }
  const kalenderId = String(process.env.KALENDER_ID || "").trim() || null;
  const r = await mitDbErgebnis(user, async (q) => (await q(
    `insert into termin_verknuepfungen (event_id, kalender_id, firma_id, art, angelegt_von)
       values ($1, $2, $3, $4, $5)
       on conflict (event_id) do update
         set firma_id = excluded.firma_id,
             kalender_id = excluded.kalender_id,
             art = case when excluded.art = 'erstgespraech' then 'erstgespraech'
                        else termin_verknuepfungen.art end`,
    [String(eventId), kalenderId, id, art === "erstgespraech" ? "erstgespraech" : "termin", user.id])).rowCount);
  if (!r.ok) return r;
  if (!r.wert) return { ok: false, grund: "nicht-geschrieben" };
  return { ok: true };
}

// Loeschen -> { ok:true, geloescht } | { ok:false, grund }. Gibt es keinen
// Faden, ist nichts zu tun (ok). Gibt es einen, den der Nutzer nicht sieht:
// faden-fremd — und der Faden bleibt.
async function verknuepfungLoeschen(user, eventId) {
  if (!eventId) return { ok: false, grund: "keine Termin-ID" };
  if (!crmModul()) return { ok: false, grund: "keine-datenbank" };
  if (!user || !user.id) return { ok: false, grund: "kein-konto" };
  const vorhanden = await fadenSystem(eventId);
  if (!vorhanden) return { ok: true, geloescht: 0 };
  const r = await mitDbErgebnis(user, async (q) =>
    (await q(`delete from termin_verknuepfungen where event_id = $1`, [String(eventId)])).rowCount);
  if (!r.ok) return r;
  if (!r.wert) return { ok: false, grund: "faden-fremd" };
  return { ok: true, geloescht: r.wert };
}

// ----------------------------------------------------------- Firma (Akte-Karte)
//
// Die Kurzfassung der Akte fuers Popover. Liefert das CRM crm.firmaKurz()
// (Agent A, seit 05.09.), wird die genommen; sonst eine schlanke eigene
// Abfrage. to_jsonb(f) statt fester Spaltenliste: Die Umsatzspalten
// (umsatz_geschaetzt/umsatz_geplant, Migration 0057) gibt es je nach Stand der
// Datenbank noch nicht — eine feste Liste wuerde dann die ganze Abfrage
// kippen, so fehlt nur der Wert.
async function firmaKurz(user, firmaId) {
  const id = Number(firmaId);
  if (!id) return null;
  const crm = crmModul();
  if (!crm || !user || !user.id) return null;
  try {
    if (typeof crm.firmaKurz === "function") {
      const f = await crm.firmaKurz(user, id);
      return f ? { ...f, url: f.url || `/crm/firma/${id}` } : null;
    }
  } catch (e) {
    console.error("Kalender-Akte: crm.firmaKurz —", String(e.message).slice(0, 160));
  }
  const rows = await mitDb(user, async (q) => (await q(
    `select to_jsonb(f) as daten, p.name as besitzer_name,
            (select a.titel from aufgaben a
              where a.firma_id = f.id and not a.erledigt
              order by a.faellig nulls last, a.erstellt limit 1) as naechstes_todo
       from firmen f left join profiles p on p.id = f.besitzer
      where f.id = $1`, [id])).rows, []);
  const r = rows && rows[0];
  if (!r) return null;
  const d = r.daten || {};
  const tags = Array.isArray(d.tags) ? d.tags : [];
  const sparte = ["webdesign", "performance", "ki"].find((s) => tags.includes(s)) || "";
  const zahl = (w) => (w === null || w === undefined || w === "" ? null : Number(w));
  return {
    id, name: d.name || "", status: d.status || "", sparte,
    ansprechperson: d.geschaeftsfuehrer || "", ansprech_rolle: d.ansprech_rolle || "",
    telefon: d.telefon || "", mobil: d.mobil || "", email: d.email || "",
    ort: d.ort || "", branche: d.branche || "", stand: d.stand || "",
    umsatz_geschaetzt: zahl(d.umsatz_geschaetzt), umsatz_geplant: zahl(d.umsatz_geplant),
    naechste_aufgabe: d.naechste_aufgabe || r.naechstes_todo || "",
    naechster_termin: d.naechster_termin || null,
    erstgespraech_am: d.erstgespraech_am || null,
    besitzer_name: r.besitzer_name || "",
    notizen: String(d.notizen || "").slice(0, 300),
    url: `/crm/firma/${id}`,
  };
}

// Name und Status zu mehreren Firmen-IDs — fuer Termine, deren Akte nur in der
// Beschreibung steht (kein Datenbank-Faden). Mit Zeilenrechten: was der Nutzer
// nicht sehen darf, fehlt in der Antwort.
async function firmenKurzliste(user, ids) {
  const liste = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!liste.length) return new Map();
  const rows = await mitDb(user, async (q) => (await q(
    `select id, name, status from firmen where id = any($1::bigint[])`, [liste])).rows, []);
  return new Map((rows || []).map((r) => [Number(r.id), { name: r.name || "", status: r.status || "" }]));
}

// Vorschlaege fuer das Suchfeld "Kunde oder Lead" im Termin-Dialog.
async function firmenSuchen(user, q, limit = 8) {
  const crm = crmModul();
  if (!crm || !user || !user.id) return [];
  try {
    const rows = await crm.firmenListe(user, { suche: String(q || "").trim().slice(0, 80), limit });
    return (rows || []).map((f) => ({ id: Number(f.id), name: f.name || "", ort: f.ort || "", status: f.status || "" }));
  } catch (e) {
    console.error("Kalender-Akte: Firmensuche —", String(e.message).slice(0, 160));
    return [];
  }
}

// ----------------------------------------------------------- Vertrag 1
//
// Erstgespraech in den Kalender. Gibt es fuer die Firma schon eine
// Verknuepfung mit art 'erstgespraech', wird DIESER Termin verschoben — sonst
// stuende nach jedem Speichern der Akte ein weiterer im Kalender.

// notiz ist der REINE Gespraechstext ("Was wurde besprochen"), nicht die
// Sammelfassung aus der Akte: Die traegt Zeitstempel und Ansprechperson
// vorweg, und beides steht hier schon — der Termin als Start/Ende des
// Eintrags, die Person als eigene Zeile (14.09.2026, lib/crm.js
// anrufSpeichern uebergibt extra.text).
function beschreibungErstgespraech(firma, notiz) {
  const zeilen = [];
  const person = [firma.ansprechperson, firma.ansprech_rolle].filter(Boolean).join(", ");
  if (person) zeilen.push("Ansprechperson: " + person);
  if (firma.telefon || firma.mobil) zeilen.push("Telefon: " + [firma.telefon, firma.mobil].filter(Boolean).join(" / "));
  if (firma.email) zeilen.push("E-Mail: " + firma.email);
  if (firma.ort) zeilen.push("Ort: " + firma.ort);
  const n = String(notiz || "").trim();
  // DIE NOTIZ BEKOMMT DEN PLATZ, DER UEBRIG IST (16.09.2026).
  //
  // Vorher fest 200 Zeichen. Gemessen an den echten Gespraechsnotizen:
  // 487 Zeichen (PT Ingenieure), 448 (MUZ), 437 (Linda Bau), 403
  // (Reifenservice Ramsauer) — bei mehr als der Haelfte der langen Notizen
  // fiel also der zweite Teil weg, und gerade dort steht, was vereinbart
  // wurde. Lukas: "die Notizen aus dem Gespräch sollen aber gleich in der
  // Beschreibung angezeigt werden".
  //
  // Gerechnet statt geraten: Google bekommt hoechstens BESCHREIBUNG_MAX
  // Zeichen (werkzeuge.js schneidet -d dort ab), davon gehen die Kopfzeilen
  // oben ab. Der Rest gehoert der Notiz. Ohne den Akte-Link, der hier bis
  // heute 60 bis 80 Zeichen belegt hat, bleiben fuer sie rund 380 bis 420 —
  // genug fuer fast jede echte Notiz.
  if (n) {
    const kopf = zeilen.join("\n");
    const platz = BESCHREIBUNG_MAX - (kopf ? kopf.length + 1 : 0) - "Notiz: ".length;
    zeilen.push("Notiz: " + (n.length > platz ? n.slice(0, Math.max(0, platz - 1)).trimEnd() + "…" : n));
  }
  return zeilen.join("\n");
}

async function erstgespraechSynchronisieren(user, firmaId, { wann, ort = "", notiz = "", dauerMin = ERSTGESPRAECH_DAUER_MIN } = {}) {
  try {
    const id = Number(firmaId);
    if (!id) return { ok: false, grund: "keine Firma" };
    const plan = zeitplan(wann, dauerMin);
    if (!plan) return { ok: false, grund: "kein Termin" };
    if (!schreibenMoeglich()) return { ok: false, grund: "kalender-offline" };

    // firmaKurz laeuft mit Zeilenrechten: sieht der Nutzer die Firma nicht,
    // gibt es weder Termin noch Faden.
    const firma = await firmaKurz(user, id);
    if (!firma) return { ok: false, grund: "firma-unsichtbar" };

    const titel = `Erstgespräch ${firma.name}`.slice(0, 200);
    // OHNE AKTE-LINK (16.09.2026, Wunsch Lukas). Vorher hing hier
    // beschreibungMitAkte() und damit die Zeile "Kundenakte: https://…" unter
    // der Beschreibung. Im Kalender liest man sie nie — man klickt den Termin
    // an und sieht die Akte im OS ohnehin; im Google-Kalender selbst ist es
    // eine lange URL, die den Gespraechsnotizen den Platz nimmt (500 Zeichen
    // Deckel, mitZeile kuerzt den Text zugunsten der Zeile).
    //
    // Was dadurch NICHT verloren geht: Die Zuordnung Termin -> Akte steht in
    // termin_verknuepfungen mit art='erstgespraech' (0059) und wird hier
    // unten gesetzt. Die Link-Zeile war nur die Rueckfallebene fuer Termine
    // OHNE Verknuepfung — beim Erstgespraech gibt es immer eine, sonst wird
    // der Termin wieder zurueckgenommen (siehe verknuepfungSetzen unten).
    // Beim Verknuepfen von Hand im Kalender (lib/kalender-routes.js) bleibt
    // die Zeile, dort ist sie der einzige Anker fuer alte Eintraege.
    const beschreibung = beschreibungErstgespraech(firma, notiz);
    const ortText = String(ort || "").trim().slice(0, 200);

    // IN WESSEN KALENDER (18.09.2026). user ist hier die Person, die das
    // Gespraech gebucht hat — ihr Kalender ist der richtige. Hat sie keinen
    // eigenen, wird NICHT eingetragen: Ein fremder Termin im Kalender eines
    // anderen war genau das Problem (Lukas, 18.09.). Der Grund geht nach oben
    // durch, damit im Log steht, warum kein Termin entstand.
    let zielId = "";
    try {
      const crm = crmModul();
      if (crm && typeof crm.kalenderZiel === "function") {
        const ziel = await crm.kalenderZiel(user && user.id);
        if (!ziel.ok) return { ok: false, grund: "kein-kalender-fuer-person" };
        zielId = ziel.kalenderId || "";
      }
    } catch { /* ohne Zuordnung: Hauptkalender, wie bisher */ }

    const alt = (await verknuepfungenVonFirma(user, id)).find((v) => v.art === "erstgespraech");
    if (alt) {
      const r = await werkzeuge.terminAendern({
        id: alt.event_id, titel, start: plan.start, ende: plan.ende, ganztags: plan.ganztags,
        ort: ortText || undefined, beschreibung, kalenderId: zielId,
      });
      if (r.ok) return { ok: true, id: alt.event_id, verschoben: true };
      // Termin bei Google nicht mehr da (dort abgesagt)? Dann neu anlegen
      // statt an einer toten Kennung festzuhalten.
      if (!/not ?found|404|gone|nicht gefunden|existiert nicht/i.test(String(r.grund))) {
        return { ok: false, grund: String(r.grund || "Termin nicht verschoben") };
      }
      const weg = await verknuepfungLoeschen(user, alt.event_id);
      if (!weg.ok) return { ok: false, grund: "alter Faden nicht loesbar: " + weg.grund };
    }

    const r = await werkzeuge.terminEintragen({
      titel, start: plan.start, ende: plan.ende, ganztags: plan.ganztags, ort: ortText, beschreibung,
      kalenderId: zielId,
    });
    if (!r.ok) return { ok: false, grund: String(r.grund || "Termin nicht eingetragen") };
    if (!r.id) return { ok: false, grund: "Google hat keine Termin-ID genannt" };
    const f = await verknuepfungSetzen(user, { eventId: r.id, firmaId: id, art: "erstgespraech" });
    if (!f.ok) {
      // Zeile und Faden nur gemeinsam: ohne Faden nehmen wir den Termin
      // wieder zurueck, statt einen halb verknuepften stehen zu lassen.
      await werkzeuge.terminAbsagen({ id: r.id, kalenderId: zielId }).catch(() => null);
      return { ok: false, grund: "Verknuepfung fehlgeschlagen: " + f.grund };
    }
    return { ok: true, id: r.id, neu: true };
  } catch (e) {
    return { ok: false, grund: String((e && e.message) || e).slice(0, 200) };
  }
}

// ----------------------------------------------------------- Vertrag 2
//
// Alle Termine einer Firma, im Fenster 30 Tage zurueck bis 180 voraus — ohne
// den 200er-Deckel (spanneVoll). Was im Fenster fehlt, wird am Direktweg noch
// per ID gesucht (liegt dann ausserhalb); erst was auch dort fehlt, gilt als
// fehlt:true. Ohne Verknuepfungen oder Kalenderzugang eine leere Liste — nie
// ein Fehler.
async function termineVonFirma(user, firmaId) {
  try {
    const vk = await verknuepfungenVonFirma(user, Number(firmaId));
    if (!vk.length) return [];
    if (!lesenMoeglich()) return [];
    const heute = kal.heuteTag();
    const antwort = await spanneVoll(kal.tagPlus(heute, -30), kal.tagPlus(heute, 180));
    if (!antwort.ok) return [];
    const termine = [...antwort.termine];
    const da = new Set(termine.map((t) => String(t.id)));
    for (const v of vk) {
      if (da.has(String(v.event_id))) continue;
      const t = await terminNachId(v.event_id);
      if (t) { t.ausserhalb = true; termine.push(t); }
    }
    return zuordnen(vk, termine);
  } catch (e) {
    console.error("Kalender-Akte: termineVonFirma —", String((e && e.message) || e).slice(0, 160));
    return [];
  }
}

module.exports = {
  // Vertrag mit dem CRM
  erstgespraechSynchronisieren, termineVonFirma, ERSTGESPRAECH_DAUER_MIN,
  // Bausteine fuer die Kalenderseite und die Tests
  akteUrl, akteZeile, beschreibungMitAkte, beschreibungOhneAkte, akteAusBeschreibung,
  beschreibungBeimAendern, umhaengenErlaubt, akteWahlImFormular,
  wandzeit, plusMinuten, zeitplan, zuordnen, scheiben, spanneVoll, terminNachId,
  verknuepfungenFuer, verknuepfungVon, verknuepfungenVonFirma, verknuepfungSetzen, verknuepfungLoeschen,
  firmaSichtbar, fadenSystem, faedenSystem, fadenEntfernenSystem,
  firmaKurz, firmenSuchen, firmenKurzliste, beschreibungErstgespraech,
  lesenMoeglich, schreibenMoeglich,
};
