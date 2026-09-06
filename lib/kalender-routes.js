// lib/kalender-routes.js — die Kalenderseite (/kalender).
//
// Nachgebaut nach Google Kalender, weil genau das gewuenscht war: links die
// kleine Monatsuebersicht mit dem Tag, auf dem man steht, rechts gross die
// Woche oder der Monat. Wer den Google Kalender kennt, soll sich hier nicht
// umgewoehnen muessen.
//
// Es ist KEIN zweiter Kalender und keine Kopie: gelesen und geschrieben wird
// ueber gws-cli direkt im selben Google-Konto, mit dem Alexandra und Hermes
// arbeiten. Was hier eingetragen wird, steht Sekunden spaeter im Handy —
// und was jemand am Handy eintraegt, steht beim naechsten Laden hier.
//
// Der Aufbau:
//   links   "Erstellen", Mini-Monat zum Springen, Kalenderliste
//   oben    Heute, vor/zurueck, Zeitraum, Umschalter Tag/Woche/Monat
//   rechts  Tages-/Wochenraster (Stunden) oder Monatsraster (Zellen)
//
// Bewusst serverseitig gerendert wie der Rest des OS: keine Kalender-
// Bibliothek, kein Client-State. Ein Klick = ein POST = ein Redirect. Das
// haelt die Seite ehrlich, wenn Google mal nicht antwortet — sie sagt es dann,
// statt eine leere Woche zu zeigen, die nach "keine Termine" aussieht.
//
// Farben: Googles Blau (#1a73e8) und das Blau des OS (--primary, #2563EB)
// liegen so nah beieinander, dass der Unterschied nicht auffaellt. Genommen
// wird --primary — damit dreht der Kalender im Dunkelmodus und im
// Weiss-Modus mit, statt als einzige Seite in Google-Blau stehenzubleiben.
//
// KALENDER <-> KUNDENAKTE (05.09.2026, Wunsch Lukas):
//   - Im Dialog "Termin eintragen"/"Bearbeiten" laesst sich eine Kunden- oder
//     Lead-Akte aus dem CRM anhaengen (Suchfeld, Pille). Der Faden liegt in
//     termin_verknuepfungen (Migration 0059) und zusaetzlich als Zeile
//     "Kundenakte: …" in der Terminbeschreibung (lib/kalender-akte.js).
//   - Ein Klick auf einen Termin oeffnet ein Popover (kein Sofort-Dialog mehr):
//     Zeit, Ort, Beschreibung, "In Google oeffnen", Bearbeiten, Absagen — und,
//     wenn eine Firma haengt, die Akte-Karte aus GET /api/kalender/termin.
//   - Termine mit Akte tragen im Raster ein Personen-Zeichen; Erstgespraeche
//     (vom CRM angelegt) eine eigene Farbe; Googles Termin-Farbe (colorId)
//     gewinnt, wenn jemand sie in Google gesetzt hat.
//   - Tastatur wie bei Google: t = heute, Pfeile = blaettern, n = neuer Termin.
//
// RECHTE (Pruefung 05.09.): Die Datenbank (RLS) entscheidet, wer welche Akte
// sieht — Google weiss das nicht. Darum: Faden zuerst, Zeile danach; eine
// Akte, die der Nutzer nicht sieht, wird weder als Zeile noch als Faden
// geschrieben (?fehler= sagt es); ein Termin, der schon an einer fuer den
// Nutzer unsichtbaren Akte haengt ("fremd"), laesst sich von ihm nicht
// umhaengen, und seine Akte-Zeile ueberlebt jede Notizaenderung.

const express = require("express");
const fs = require("fs");
const path = require("path");

// Wie der Agent heisst (AGENT_NAME). Leer = Alexandra.
const AGENT = process.env.AGENT_NAME || "Alexandra";
const { schale, eintragen } = require("./schale.js");
const kal = require("./kalender.js");
const akte = require("./kalender-akte.js");

// Kalender haengt als Unterpunkt unter der Zentrale — dort steht der Tag, und
// der Kalender ist die Langfassung davon. eintragen() ERGAENZT den
// vorhandenen Eintrag mit gleicher id, schale.js bleibt unberuehrt (Regel ab
// 26.07.: wer einen Bereich baut, aendert die Navigationsliste nicht).
eintragen({
  id: "zentrale", titel: "Zentrale", icon: "zentrale", href: "/", gruppe: "Übersicht",
  unter: [
    { id: "zentrale-start", titel: "Zentrale", icon: "zentrale", href: "/" },
    { id: "kalender", titel: "Kalender", icon: "kalender", href: "/kalender" },
  ],
});

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// JSON in einen <script>-Block. Zwei Fallen, beide real: "</" + "script>" im
// Titel eines Termins bricht die Seite auf (Termine kommen aus einem fremden
// Kalender — da steht irgendwann alles drin), und U+2028/U+2029 sind in JSON
// erlaubt, in JavaScript aber Zeilenumbrueche; sie zerlegen das Skript.
const jsonFuerSkript = (o) => JSON.stringify(o)
  .replace(/</g, "\\u003c")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

// Cache-Stempel wie v() in schale.js (dort nicht exportiert): neue Datei ->
// neue URL -> der Browser holt sie frisch, ohne Strg+F5. Muster aus
// lib/whiteboard-routes.js.
const stempel = new Map();
function v(datei) {
  const jetzt = Date.now();
  const c = stempel.get(datei);
  if (c && jetzt - c.geprueft < 5000) return c.url;
  let url = datei;
  try {
    const st = fs.statSync(path.join(__dirname, "..", "public", datei.replace(/^\//, "")));
    url = `${datei}?v=${Math.round(st.mtimeMs).toString(36)}`;
  } catch { /* Datei fehlt: ohne Stempel ausliefern */ }
  stempel.set(datei, { url, geprueft: jetzt });
  return url;
}

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
// Die Spaltenreihenfolge haengt daran, womit die Woche anfaengt (lib/kalender.js:
// Vorgabe Sonntag, wie in Lukas' Google Kalender). Fest verdrahtet war das ein
// Fehler: bei Wochenstart Sonntag stand ueber der Sonntagsspalte "Mo".
const WT_FOLGE = Array.from({ length: 7 }, (_, i) =>
  WOCHENTAGE[((kal.WOCHENSTART + i) % 7 + 6) % 7]);
// Der Mini-Monat hat schmale Spalten — da passt nur ein Buchstabe hinein.
// Genau wie bei Google, wo dort "S M D M D F S" steht.
const MINI_WT = WT_FOLGE.map((w) => w[0]);
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONATE_KURZ = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni",
  "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];
const WOCHENTAGE_LANG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag",
  "Freitag", "Samstag", "Sonntag"];

const monatsName = (tag) => MONATE[Number(String(tag).slice(5, 7)) - 1] + " " + String(tag).slice(0, 4);
const monatKurz = (tag) => MONATE_KURZ[Number(String(tag).slice(5, 7)) - 1];
const tagNummer = (tag) => String(Number(String(tag).slice(8, 10)));
// Wochentag eines Tages als Index 0..6 (Mo..So).
const wtIndex = (tag) => (kal.alsDate(tag).getUTCDay() + 6) % 7;

// Kalenderwoche nach ISO — die Zahl, die auf jedem deutschen Kalender steht.
function kw(tag) {
  const d = kal.alsDate(tag);
  const nr = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - nr + 3);          // Donnerstag derselben Woche
  const ersterDo = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const nr2 = (ersterDo.getUTCDay() + 6) % 7;
  ersterDo.setUTCDate(ersterDo.getUTCDate() - nr2 + 3);
  return 1 + Math.round((d - ersterDo) / (7 * 86400000));
}

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  links: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  rechts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  papierkorb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  uhr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  ort: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  extern: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M19 13v6H5V5h6"/></svg>',
  person: '<svg class="kal-person" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  akte: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/></svg>',
};

const STUNDE_PX = 48;                   // Hoehe einer Stunde im Zeitraster

// Ein Termin, so wie ihn die Seite (Chips, Dialoge, Popover) und die Termin-API
// gleichermassen bekommen. beschreibung = Google-Text komplett, notiz = ohne
// die Akte-Zeile (fuer das Notizfeld im Dialog). fremd = haengt an einer
// Akte, die dieser Nutzer nicht sehen darf (kein Umhaengen, kein Loesen).
function terminFuerSeite(t, firma, fremd) {
  return {
    id: t.id, titel: t.titel || "(ohne Titel)", ort: t.ort || "",
    start: t.start, ende: t.ende || "", ganztags: kal.istGanztags(t),
    beschreibung: t.beschreibung || "", notiz: akte.beschreibungOhneAkte(t.beschreibung),
    htmlLink: t.htmlLink || "", farbe: kal.farbeVon(t), firma: firma || null, fremd: Boolean(fremd),
  };
}

// Welche Firma haengt an welchem Termin? -> Map(id -> { firma|null, fremd }).
//   1. der Faden aus der Datenbank, mit Zeilenrechten (firma)
//   2. gibt es einen Faden, den der Nutzer NICHT sieht (Systemblick): fremd —
//      dann zaehlt auch die Akte-Zeile in der Beschreibung nicht
//   3. sonst die Akte-Zeile in der Beschreibung (Termine vor der Migration),
//      wieder nur mit Zeilenrechten
async function firmenZuTerminen(nutzer, termine) {
  const karte = new Map();
  if (!nutzer || !nutzer.id || !process.env.DATABASE_URL || !termine.length) return karte;
  const ids = termine.map((t) => t.id);
  const [sichtbar, alle] = await Promise.all([akte.verknuepfungenFuer(nutzer, ids), akte.faedenSystem(ids)]);
  for (const [id, f] of sichtbar) {
    karte.set(id, { firma: { id: f.firma_id, name: f.firma_name, status: f.firma_status, art: f.art }, fremd: false });
  }
  for (const id of alle.keys()) if (!karte.has(id)) karte.set(id, { firma: null, fremd: true });
  const offen = termine
    .filter((t) => !karte.has(String(t.id)))
    .map((t) => [t, akte.akteAusBeschreibung(t.beschreibung)])
    .filter(([, id]) => id);
  if (offen.length) {
    const namen = await akte.firmenKurzliste(nutzer, offen.map(([, id]) => id));
    for (const [t, id] of offen) {
      const f = namen.get(id);
      if (f) karte.set(String(t.id), { firma: { id, name: f.name, status: f.status, art: "termin", ausBeschreibung: true }, fremd: false });
    }
  }
  return karte;
}

module.exports = function (app) {
  const formular = express.urlencoded({ extended: true });

  // Wohin nach dem Speichern? Immer zurueck auf die Ansicht, aus der der
  // Nutzer kam — sonst landet man nach jedem Eintrag wieder im Heute-Monat.
  const ANSICHTEN = ["tag", "woche", "monat"];
  const zurueck = (b) => "/kalender?ansicht=" + encodeURIComponent(ANSICHTEN.includes(b.ansicht) ? b.ansicht : "monat") +
    "&datum=" + encodeURIComponent(kal.tagOderHeute(b.datum));

  // Akten gibt es nur mit Datenbank UND persoenlichem Konto (Zeilenrechte).
  const akteMoeglich = (nutzer) => Boolean(nutzer && nutzer.id && process.env.DATABASE_URL);

  app.get("/kalender", async (req, res, next) => {
    try {
      const nutzer = (req.session && req.session.crm) || null;
      const ansicht = ANSICHTEN.includes(req.query.ansicht) ? req.query.ansicht : "monat";
      const anker = kal.tagOderHeute(req.query.datum);
      const heute = kal.heuteTag();

      // Welche Tage liegen im Hauptraster?
      //   Tag    genau einer
      //   Woche  Montag bis Sonntag
      //   Monat  volle Wochen, also Montag vor dem Ersten bis Sonntag nach dem
      //          Letzten — sonst haette die erste Zeile Loecher und die
      //          Wochentagsspalten wuerden verrutschen.
      const von = ansicht === "tag" ? anker
        : ansicht === "woche" ? kal.wochenAnfang(anker)
        : kal.wochenAnfang(kal.ersterDesMonats(anker));
      const bis = ansicht === "tag" ? anker
        : ansicht === "woche" ? kal.tagPlus(von, 6)
        : kal.tagPlus(kal.wochenAnfang(kal.letzterDesMonats(anker)), 6);

      const antwort = await kal.spanne(von, bis);
      const termine = antwort.ok ? antwort.termine : [];
      const proTag = kal.nachTagen(termine);

      // Welche Termine haengen an einer Akte? (Datenbank-Faden + Akte-Zeile)
      const firmaJe = await firmenZuTerminen(nutzer, termine);
      for (const t of termine) {
        const eintrag = firmaJe.get(String(t.id));
        t.firma = eintrag ? eintrag.firma : null;
        t.fremd = Boolean(eintrag && eintrag.fremd);
      }

      // Fuer Dialoge und Popover: eine flache Liste, die Chips zeigen nur ihren
      // Index. Spart das Escapen von Titeln in onclick-Attributen.
      const liste = termine.map((t) => terminFuerSeite(t, t.firma, t.fremd));
      const indexVon = new Map(termine.map((t, i) => [t, i]));

      const tage = [];
      for (let d = von; d <= bis; d = kal.tagPlus(d, 1)) tage.push(d);

      // ------------------------------------------------------------ Navigation
      const vorher = ansicht === "tag" ? kal.tagPlus(anker, -1)
        : ansicht === "woche" ? kal.tagPlus(anker, -7) : kal.monatPlus(anker, -1);
      const nachher = ansicht === "tag" ? kal.tagPlus(anker, 1)
        : ansicht === "woche" ? kal.tagPlus(anker, 7) : kal.monatPlus(anker, 1);
      const ziel = (datum, a = ansicht, mini = null) =>
        `/kalender?ansicht=${a}&datum=${datum}` + (mini ? `&mini=${mini}` : "");

      const titelZeile = ansicht === "tag"
        ? `${tagNummer(anker)}. ${MONATE[Number(anker.slice(5, 7)) - 1]} ${anker.slice(0, 4)}`
        : ansicht === "woche"
          // Wie bei Google: die Woche traegt den MONAT, nicht die Tagesspanne
          // ("Juli 2026" bzw. "Juli – Aug. 2026"). Die Tage stehen ohnehin
          // gross in der Kopfzeile darunter.
          ? (von.slice(0, 7) === bis.slice(0, 7)
            ? monatsName(von)
            : `${monatKurz(von)} – ${monatKurz(bis)} ${bis.slice(0, 4)}`)
          : monatsName(anker);

      // --------------------------------------------------------- Mini-Monat
      //
      // Wie bei Google: laeuft mit eigenen Pfeilen unabhaengig vom Hauptraster
      // (man will im November nachsehen, ohne die aktuelle Woche zu verlassen).
      // Ein Klick auf einen Tag springt dann doch — das ist sein Zweck.
      const miniAnker = kal.tagOderHeute(req.query.mini || anker);
      const miniVon = kal.wochenAnfang(kal.ersterDesMonats(miniAnker));
      const miniTage = [];
      for (let i = 0; i < 42; i++) miniTage.push(kal.tagPlus(miniVon, i));

      const miniBlock = `
        <div class="gk-mini">
          <div class="gk-mini-kopf">
            <b>${e(monatsName(miniAnker))}</b>
            <span>
              <a href="${ziel(anker, ansicht, kal.monatPlus(miniAnker, -1))}" title="Monat zurück">${ICON.links}</a>
              <a href="${ziel(anker, ansicht, kal.monatPlus(miniAnker, 1))}" title="Monat weiter">${ICON.rechts}</a>
            </span>
          </div>
          <div class="gk-mini-wt">${MINI_WT.map((w) => `<span>${w}</span>`).join("")}</div>
          <div class="gk-mini-tage">${miniTage.map((d) => {
            const klassen = [
              d.slice(0, 7) === miniAnker.slice(0, 7) ? "" : "fremd",
              d === heute ? "heute" : "",
              d === anker ? "gewaehlt" : "",
              // Der im Hauptraster gezeigte Zeitraum wird hinterlegt — so sieht
              // man im Mini-Monat, welche Woche rechts gerade offen ist.
              d >= von && d <= bis && ansicht !== "monat" ? "spanne" : "",
            ].filter(Boolean).join(" ");
            return `<a class="${klassen}" href="${ziel(d, ansicht, miniAnker)}">${tagNummer(d)}</a>`;
          }).join("")}</div>
        </div>`;

      // ------------------------------------------------------- Fehlerzustand
      //
      // Ohne gws-cli (also auf jedem Entwicklerrechner) ist der Kalender nicht
      // kaputt, sondern hier nicht angebunden. Der Unterschied gehoert auf die
      // Seite — sonst sucht wieder jemand einen Fehler, den es nicht gibt.
      const stoerung = antwort.ok ? "" : `
        <div class="os-hinweis ${antwort.fehlt ? "os-hinweis--info" : "os-hinweis--warn"} kal-hinweis">${ICON.info}<div>
          ${antwort.fehlt
            ? `<b>Auf dieser Maschine besteht keine Verbindung zu Google.</b>
               Das Werkzeug <code>gws-cli</code> und das Anmelde-Token liegen auf dem Server —
               lokal ist das der Normalfall und kein Defekt. Termine erscheinen und lassen sich
               eintragen, sobald die Seite dort läuft.
               Prüfen: <code>docker exec flowstate-dashboard node scripts/status.js</code>`
            : `<b>Google antwortet nicht.</b> Meist ist das Anmelde-Token abgelaufen und muss
               einmal neu geholt werden. Bis dahin ist diese Ansicht leer —
               das heißt <em>nicht</em>, dass keine Termine da sind.
               Meldung: <code>${e(antwort.fehler)}</code>`}
        </div></div>`;

      // Ein Schreibversuch, der schiefging (siehe fertig() weiter unten). Muss
      // sichtbar sein: ein Termin, den man eingetragen GLAUBT und der nicht da
      // ist, faellt erst auf, wenn man ihn verpasst hat. "Termin eingetragen,
      // aber …" heisst: der Termin steht, nur die Akte haengt nicht dran.
      const fehler = String(req.query.fehler || "").slice(0, 400);
      const fehlerHinweis = fehler ? `
        <div class="os-hinweis os-hinweis--fehler kal-hinweis">${ICON.info}<div>
          <b>${/^Termin eingetragen/.test(fehler) ? "Nur teilweise gespeichert." : "Der Termin wurde nicht gespeichert."}</b> ${e(fehler)}</div></div>` : "";

      // -------------------------------------------------- Chip-Verzierung
      //
      // Personen-Zeichen bei Termin mit Akte, eigene Farbe fuer Erstgespraeche,
      // Googles colorId gewinnt (das ist die ausdrueckliche Wahl in Google).
      // Nur Google-Daten und der eigene Faden — nichts erfunden.
      const deko = (t) => {
        const f = kal.farbeVon(t);
        const klassen = [];
        // "kal-mit-akte" — nicht "kal-akte": das ist die Akte-KARTE im Popover.
        if (t.firma) klassen.push("kal-mit-akte");
        if (t.firma && t.firma.art === "erstgespraech") klassen.push("kal-eg");
        if (f) klassen.push("kal-farbig");
        return {
          klasse: klassen.join(" "),
          style: f ? `--kal-farbe:${f.hex};--kal-schrift:${f.schrift};` : "",
          person: t.firma ? ICON.person : "",
        };
      };
      const chipTitel = (t) => (kal.istGanztags(t) ? "" : kal.uhrzeit(t.start) + " ") + t.titel
        + (t.ort ? " · " + t.ort : "") + (t.firma ? " · Akte: " + t.firma.name : "");

      // ------------------------------------------------------------- Monat
      //
      // Googles Monatsansicht macht einen Unterschied, der viel ausmacht:
      // ganztaegige Termine sind gefuellte Balken, Termine MIT Uhrzeit nur ein
      // farbiger Punkt plus Zeit und Titel auf dem Zellenhintergrund. Dadurch
      // wirkt ein voller Monat nicht wie eine Wand aus Farbe.
      const monatChip = (t) => {
        const i = indexVon.get(t);
        const zeit = kal.uhrzeit(t.start);
        const d = deko(t);
        const hinweis = e(chipTitel(t));
        return kal.istGanztags(t)
          ? `<button type="button" class="gk-m-balken ${d.klasse}" style="${d.style}" data-i="${i}" title="${hinweis}">
               ${d.person}<span>${e(t.titel)}</span></button>`
          : `<button type="button" class="gk-m-zeile ${d.klasse}" style="${d.style}" data-i="${i}" title="${hinweis}">
               <i class="gk-punkt"></i><span class="gk-m-zeit">${zeit}</span>
               ${d.person}<span class="gk-m-titel">${e(t.titel)}</span></button>`;
      };

      const monatRaster = `
        <div class="gk-monat">
          <div class="gk-m-kopf">${tage.slice(0, 7).map((d) =>
            `<div>${WOCHENTAGE[wtIndex(d)]}</div>`).join("")}</div>
          <div class="gk-m-gitter" style="--zeilen:${tage.length / 7}">${tage.map((d) => {
            const drin = d.slice(0, 7) === anker.slice(0, 7);
            const eintraege = proTag[d] || [];
            const sichtbar = eintraege.slice(0, 3);
            const rest = eintraege.length - sichtbar.length;
            // Wie bei Google steht am Monatsersten der Monatsname neben der Zahl —
            // sonst weiss man in der letzten Zeile nicht, wo der Monat kippt.
            const ersterTag = d.slice(8, 10) === "01";
            return `<div class="gk-m-zelle ${drin ? "" : "fremd"}" data-neu="${d}">
              <div class="gk-m-zellkopf">
                <a class="gk-m-zahl ${d === heute ? "heute" : ""}" href="${ziel(d, "tag", miniAnker)}"
                   title="${e(WOCHENTAGE_LANG[wtIndex(d)] + ", " + tagNummer(d) + ". " + monatKurz(d))}"
                   >${tagNummer(d)}${ersterTag ? ". " + monatKurz(d) : ""}</a>
              </div>
              <div class="gk-m-liste">${sichtbar.map(monatChip).join("")}
                ${rest > 0
                  // Wie bei Google oeffnet "+ N weitere" den Tag an Ort und
                  // Stelle (Popover mit allen Terminen) statt die Seite zu wechseln.
                  ? `<button type="button" class="gk-mehr" data-mehr="${d}"
                       title="Alle ${eintraege.length} Termine am ${tagNummer(d)}. ${monatKurz(d)}">+ ${rest} weitere</button>` : ""}</div>
            </div>`;
          }).join("")}</div>
        </div>`;

      // ------------------------------------------------- Tag / Woche (Raster)
      //
      // Stundenraster wie bei Google: 24 Zeilen, Termine absolut positioniert
      // nach Minuten seit Mitternacht. Ganztaegige stehen im Streifen darueber —
      // im Stundenraster haetten sie keine sinnvolle Hoehe.
      //
      // Ueberschneidungen: liegen Termine gleichzeitig, teilen sie sich die
      // Spaltenbreite (Google macht es genauso). Ohne das liegt der zweite
      // Termin unsichtbar unter dem ersten — und ein Termin, den man nicht
      // sieht, ist schlimmer als einer, der zu schmal ist.
      function verteilen(liste) {
        const sortiert = [...liste].sort((a, b) => kal.minuten(a.start) - kal.minuten(b.start));
        const gelegt = [];
        for (const t of sortiert) {
          const start = kal.minuten(t.start), ende = start + kal.dauer(t);
          // Erste Spur, in der nichts ueberlappt.
          let spur = 0;
          while (gelegt.some((g) => g.spur === spur && g.start < ende && start < g.ende)) spur++;
          gelegt.push({ t, start, ende, spur });
        }
        // Wie viele Spuren ueberlappen sich maximal? Das ist der Teiler.
        for (const g of gelegt) {
          const gleichzeitig = gelegt.filter((h) => h.start < g.ende && g.start < h.ende);
          g.spuren = Math.max(...gleichzeitig.map((h) => h.spur)) + 1;
        }
        return gelegt;
      }

      const zeitSpalte = (d) => {
        const gelegt = verteilen((proTag[d] || []).filter((t) => !kal.istGanztags(t)));
        return `<div class="gk-spalte ${d === heute ? "heute" : ""}" data-tag="${d}">
          ${Array.from({ length: 24 }, (_, h) =>
            `<button type="button" class="gk-stunde" data-neu="${d}" data-stunde="${h}"
               title="${String(h).padStart(2, "0")}:00 – Termin eintragen"></button>`).join("")}
          ${gelegt.map(({ t, spur, spuren }) => {
            const i = indexVon.get(t);
            const dk = deko(t);
            const startMin = String(t.start).slice(0, 10) < d ? 0 : kal.minuten(t.start);
            const hoehe = Math.min(kal.dauer(t), 24 * 60 - startMin);
            const px = Math.max(20, (hoehe / 60) * STUNDE_PX - 2);
            const breite = 100 / spuren;
            return `<button type="button" class="gk-termin ${px < 34 ? "kurz" : ""} ${dk.klasse}" data-i="${i}"
              style="top:${(startMin / 60) * STUNDE_PX}px;height:${px}px;
                     left:calc(${spur * breite}% + 2px);width:calc(${breite}% - 4px);${dk.style}"
              title="${e(kal.uhrzeit(t.start) + "–" + kal.uhrzeit(t.ende) + " " + t.titel + (t.ort ? " · " + t.ort : "") + (t.firma ? " · Akte: " + t.firma.name : ""))}">
              <b>${dk.person}${e(t.titel)}</b>
              <span>${e(kal.uhrzeit(t.start))}${t.ende ? "–" + e(kal.uhrzeit(t.ende)) : ""}${
                t.ort ? " · " + e(t.ort) : ""}</span></button>`;
          }).join("")}
        </div>`;
      };

      const spaltenZahl = tage.length;                       // 1 oder 7
      const zeitRaster = `
        <div class="gk-zeit" style="--spalten:${spaltenZahl};--stunde:${STUNDE_PX}px">
          <div class="gk-z-kopf">
            <div class="gk-z-ecke"><span>GMT+02</span></div>
            ${tage.map((d) => `<a class="gk-z-tag" href="${ziel(d, "tag", miniAnker)}">
              <span class="gk-z-wt ${d === heute ? "heute" : ""}">${
                spaltenZahl === 1 ? WOCHENTAGE_LANG[wtIndex(d)] : WOCHENTAGE[wtIndex(d)]}</span>
              <span class="gk-z-zahl ${d === heute ? "heute" : ""}">${tagNummer(d)}</span></a>`).join("")}
          </div>
          <div class="gk-gz">
            <div class="gk-gz-rand"></div>
            ${tage.map((d) => {
              const g = (proTag[d] || []).filter(kal.istGanztags);
              return `<div class="gk-gz-zelle" data-neu="${d}">${g.map((t) => {
                const dk = deko(t);
                return `<button type="button" class="gk-gz-balken ${dk.klasse}" style="${dk.style}" data-i="${indexVon.get(t)}"
                   title="${e(chipTitel(t))}">${dk.person}<span>${e(t.titel)}</span></button>`;
              }).join("")}</div>`;
            }).join("")}
          </div>
          <div class="gk-rollen" id="gk-rollen">
            <div class="gk-gitter">
              <div class="gk-stunden">${Array.from({ length: 24 }, (_, h) =>
                `<div class="gk-stundenlabel"><span>${h ? String(h).padStart(2, "0") + ":00" : ""}</span></div>`).join("")}</div>
              ${tage.map(zeitSpalte).join("")}
              <div class="gk-jetzt" id="gk-jetzt" hidden><i></i></div>
            </div>
          </div>
        </div>`;

      const heuteDrin = tage.includes(heute);
      const mitAkte = akteMoeglich(nutzer);

      // ------------------------------------------------- Zeile "Kunde oder Lead"
      //
      // In beiden Dialogen gleich: Suchfeld mit Vorschlaegen aus dem CRM
      // (GET /api/kalender/firmen), die gewaehlte Firma als Pille mit x,
      // dahinter das versteckte firma_id. Ohne persoenliches Konto gibt es
      // die Zeile nur als Hinweis — Akten haengen an Zeilenrechten.
      // "fremd": der Termin haengt an einer Akte, die der Nutzer nicht sieht —
      // dann gibt es kein Suchfeld, nur den Satz dazu.
      const firmaZeile = (p) => mitAkte ? `
        <div class="os-zeile os-zeile--eingabe">
          <span class="os-zeile-label" id="${p}-firma-label">Kunde oder Lead</span>
          <div class="os-zeile-wert kal-firma">
            <span class="kal-firma-fremd" id="${p}-firma-fremd" hidden>Dieser Termin hängt an einer Kundenakte,
              die für dich nicht sichtbar ist — die Verknüpfung bleibt, wie sie ist.</span>
            <span class="kal-firma-pille" id="${p}-firma-pille" hidden>
              ${ICON.person}<span id="${p}-firma-name"></span><small id="${p}-firma-ort"></small>
              <button type="button" aria-label="Verknüpfung entfernen" onclick="firmaSetzen('${p}', null, true)">${ICON.x}</button>
            </span>
            <input type="search" class="kal-firma-suche" id="${p}-firma-suche" autocomplete="off"
                   placeholder="Firma suchen — Akte anhängen" aria-labelledby="${p}-firma-label"
                   aria-controls="${p}-firma-liste" aria-expanded="false" role="combobox">
            <div class="kal-firma-liste" id="${p}-firma-liste" role="listbox" hidden></div>
            <input type="hidden" name="firma_id" id="${p}-firma-id" value="">
          </div>
        </div>` : `
        <div class="os-zeile os-zeile--text">
          <span class="os-zeile-label">Kunde oder Lead</span>
          <div class="os-zeile-wert"><span class="kal-firma-hinweis">${nutzer
            ? "Akten lassen sich nur mit Datenbank verknüpfen."
            : "Mit persönlichem Konto anmelden, um eine Kundenakte anzuhängen."}</span></div>
        </div>`;

      res.send(schale({
        titel: "Kalender",
        unterzeile: "Google Kalender",
        aktiv: "kalender", nutzer, suche: "",
        inhalt: `
        <link rel="stylesheet" href="${v("/kalender.css")}">
        ${stoerung}${fehlerHinweis}

        <div class="gk">
          <aside class="gk-seite">
            <button type="button" class="gk-erstellen" onclick="neuOeffnen('${anker}')">
              ${ICON.plus}<span>Erstellen</span></button>
            ${miniBlock}
            <div class="gk-liste">
              <div class="gk-liste-titel">Meine Kalender</div>
              <label class="gk-liste-zeile"><input type="checkbox" checked disabled>
                <span>${e(nutzer ? nutzer.name : "Google Kalender")}</span></label>
              <div class="gk-liste-titel gk-liste-titel2">Weitere Kalender</div>
              <p class="gk-liste-fuss">Angebunden ist genau ein Kalender: das Google-Konto,
                mit dem auch ${AGENT} Termine einträgt. Weitere lassen sich in Google
                freigeben — sie erscheinen dann automatisch hier.</p>
              <p class="kal-tasten"><kbd>T</kbd> heute · <kbd>←</kbd><kbd>→</kbd> blättern · <kbd>N</kbd> neuer Termin · <kbd>Esc</kbd> schließen</p>
            </div>
          </aside>

          <main class="gk-haupt">
            <div class="gk-leiste">
              <a class="gk-heute" href="${ziel(heute, ansicht, heute)}">Heute</a>
              <a class="gk-pfeil" href="${ziel(vorher, ansicht, miniAnker)}" title="zurück">${ICON.links}</a>
              <a class="gk-pfeil" href="${ziel(nachher, ansicht, miniAnker)}" title="weiter">${ICON.rechts}</a>
              <h2 class="gk-titel">${e(titelZeile)}</h2>
              ${ansicht === "woche" ? `<span class="gk-kw">KW ${kw(von)}</span>` : ""}
              <span class="gk-luecke"></span>
              <nav class="gk-umschalter">
                <a href="${ziel(anker, "tag", miniAnker)}" class="${ansicht === "tag" ? "an" : ""}">Tag</a>
                <a href="${ziel(anker, "woche", miniAnker)}" class="${ansicht === "woche" ? "an" : ""}">Woche</a>
                <a href="${ziel(anker, "monat", miniAnker)}" class="${ansicht === "monat" ? "an" : ""}">Monat</a>
              </nav>
            </div>
            <div class="gk-buehne">${ansicht === "monat" ? monatRaster : zeitRaster}</div>
          </main>
        </div>

        <!-- Termin-Popover: Klick auf einen Termin. Bausteine aus os-ui
             (os-popover-kopf/-rumpf/-fuss), frei platziert (Skript), auf
             schmalen Schirmen ein Blatt von unten (kalender.css). Der Kopf
             traegt nur das Schliessen-X; Bearbeiten/Absagen stehen im Fuss. -->
        <div class="kal-schleier" id="kal-schleier"></div>
        <div class="os-popover os-popover--ohne-zipfel kal-pop" id="kal-pop" hidden role="dialog"
             aria-labelledby="kal-pop-titel" tabindex="-1">
          <div class="os-popover-kopf">
            <span class="kal-pop-farbe" id="kal-pop-farbe"></span>
            <b class="kal-pop-titel" id="kal-pop-titel"></b>
            <button type="button" class="os-blatt-schliessen" id="kal-pop-zu" title="Schließen" aria-label="Schließen">${ICON.x}</button>
          </div>
          <div class="os-popover-rumpf" id="kal-pop-rumpf"></div>
          <div class="os-popover-fuss" id="kal-pop-fuss"></div>
        </div>

        <!-- Tag-Popover: "+ N weitere" im Monat zeigt alle Termine des Tages. -->
        <div class="os-popover os-popover--ohne-zipfel kal-pop kal-tagpop" id="kal-tagpop" hidden role="dialog"
             aria-labelledby="kal-tagpop-titel" tabindex="-1">
          <div class="os-popover-kopf">
            <b class="kal-pop-titel" id="kal-tagpop-titel"></b>
            <button type="button" class="os-blatt-schliessen" id="kal-tagpop-zu" title="Schließen" aria-label="Schließen">${ICON.x}</button>
          </div>
          <div class="os-popover-rumpf"><div class="kal-tagpop-liste" id="kal-tagpop-liste"></div></div>
        </div>

        <!-- Absagen aus dem Popover: derselbe POST wie im Dialog. -->
        <form method="post" action="/kalender/absagen" id="kal-absagen-form" hidden>
          <input type="hidden" name="ansicht" value="${e(ansicht)}">
          <input type="hidden" name="datum" value="${e(anker)}">
          <input type="hidden" name="id" id="kal-absagen-id">
        </form>

        <dialog id="dlg-neu" class="os-blatt kal-blatt" aria-labelledby="neu-kopf"><form method="post" action="/kalender/neu">
          <input type="hidden" name="ansicht" value="${e(ansicht)}">
          <input type="hidden" name="datum" value="${e(anker)}">
          <header class="os-blatt-kopf"><div><h2 id="neu-kopf">Termin eintragen</h2>
            <p class="os-blatt-unter">Geht direkt in den Google Kalender</p></div>
            <button type="button" class="os-blatt-schliessen" aria-label="Schließen" onclick="this.closest('dialog').close()">${ICON.x}</button></header>
          <div class="os-blatt-rumpf">
            <section class="os-gruppe"><div class="os-gruppe-rumpf">
              <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Titel *</span>
                <div class="os-zeile-wert"><input name="titel" id="neu-titel" required placeholder="z. B. Erstgespräch Praxis Müller"></div></label>
              <div class="os-zeile os-zeile--eingabe os-zeile--paar">
                <label class="os-zeile-teil"><span class="os-zeile-label">Datum *</span>
                  <div class="os-zeile-wert"><input type="date" name="tag" id="neu-tag" required></div></label>
                <label class="os-zeile-teil"><span class="os-zeile-label">Datum bis</span>
                  <div class="os-zeile-wert"><input type="date" name="tag_bis" id="neu-tag-bis" title="Nur bei mehrtägigen Terminen ausfüllen"></div></label>
              </div>
              <div class="os-zeile os-zeile--eingabe os-zeile--paar" id="neu-zeiten">
                <label class="os-zeile-teil"><span class="os-zeile-label">Von</span>
                  <div class="os-zeile-wert"><input type="time" name="von" id="neu-von" value="09:00"></div></label>
                <label class="os-zeile-teil"><span class="os-zeile-label">Bis</span>
                  <div class="os-zeile-wert"><input type="time" name="bis" id="neu-bis" value="10:00"></div></label>
              </div>
              <label class="os-zeile os-zeile--schalter"><span class="os-zeile-label">Ganztägig</span>
                <span class="os-schalter"><input type="checkbox" name="ganztags" id="neu-ganztags" value="1"></span></label>
            </div></section>
            <section class="os-gruppe"><div class="os-gruppe-titel">Details</div><div class="os-gruppe-rumpf">
              <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Ort</span>
                <div class="os-zeile-wert"><input name="ort" id="neu-ort" placeholder="Adresse, Raum oder Videolink"></div></label>
              <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Notiz</span>
                <div class="os-zeile-wert"><textarea name="beschreibung" id="neu-beschreibung" rows="2" placeholder="Worum geht es?"></textarea></div></label>
              ${firmaZeile("neu")}
            </div></section>
          </div>
          <footer class="os-blatt-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.check} Eintragen</button></footer>
        </form></dialog>

        <dialog id="dlg-bearbeiten" class="os-blatt kal-blatt" aria-labelledby="bea-titel-kopf"><form method="post" action="/kalender/aendern">
          <input type="hidden" name="ansicht" value="${e(ansicht)}">
          <input type="hidden" name="datum" value="${e(anker)}">
          <input type="hidden" name="id" id="bea-id">
          <input type="hidden" name="ganztags" id="bea-ganztags" value="">
          <input type="hidden" name="firma_alt" id="bea-firma-alt" value="">
          <!-- akte_geaendert=1 nur, wenn im Dialog wirklich eine Firma gewaehlt
               oder entfernt wurde — sonst bleibt der Faden unangetastet. -->
          <input type="hidden" name="akte_geaendert" id="bea-akte-geaendert" value="">
          <input type="hidden" name="beschreibung_alt" id="bea-beschreibung-alt" value="">
          <input type="hidden" name="beschreibung_voll" id="bea-beschreibung-voll" value="">
          <header class="os-blatt-kopf"><div><h2 id="bea-titel-kopf">Termin</h2>
            <p class="os-blatt-unter" id="bea-wann">—</p></div>
            <button type="button" class="os-blatt-schliessen" aria-label="Schließen" onclick="this.closest('dialog').close()">${ICON.x}</button></header>
          <div class="os-blatt-rumpf">
            <section class="os-gruppe"><div class="os-gruppe-rumpf">
              <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Titel</span>
                <div class="os-zeile-wert"><input name="titel" id="bea-titel"></div></label>
              <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Datum</span>
                <div class="os-zeile-wert"><input type="date" name="tag" id="bea-tag"></div></label>
              <div class="os-zeile os-zeile--eingabe os-zeile--paar" id="bea-zeiten">
                <label class="os-zeile-teil"><span class="os-zeile-label">Von</span>
                  <div class="os-zeile-wert"><input type="time" name="von" id="bea-von"></div></label>
                <label class="os-zeile-teil"><span class="os-zeile-label">Bis</span>
                  <div class="os-zeile-wert"><input type="time" name="bis" id="bea-bis"></div></label>
              </div>
            </div></section>
            <section class="os-gruppe"><div class="os-gruppe-titel">Details</div><div class="os-gruppe-rumpf">
              <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Ort</span>
                <div class="os-zeile-wert"><input name="ort" id="bea-ort" placeholder="optional"></div></label>
              <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Notiz</span>
                <div class="os-zeile-wert"><textarea name="beschreibung" id="bea-beschreibung" rows="2" placeholder="Worum geht es?"></textarea></div></label>
              ${firmaZeile("bea")}
            </div></section>
            <p class="kal-blatt-hinweis" id="bea-hinweis"></p>
          </div>
          <footer class="os-blatt-fuss">
            <button type="submit" class="still gefahr links" formaction="/kalender/absagen" formnovalidate
              onclick="return confirm('Diesen Termin wirklich absagen? Er verschwindet auch im Google Kalender.')">
              ${ICON.papierkorb} Absagen</button>
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.check} Speichern</button></footer>
        </form></dialog>

        <script>
        var TERMINE = ${jsonFuerSkript(liste)};
        var STUNDE = ${STUNDE_PX};
        var ANKER = ${jsonFuerSkript(anker)};
        var AKTE_MOEGLICH = ${mitAkte ? "true" : "false"};
        var NAV = ${jsonFuerSkript({ heute: ziel(heute, ansicht, heute), vorher: ziel(vorher, ansicht, miniAnker), nachher: ziel(nachher, ansicht, miniAnker) })};
        var ICONS = ${jsonFuerSkript({ uhr: ICON.uhr, ort: ICON.ort, text: ICON.text, extern: ICON.extern, person: ICON.person, akte: ICON.akte, info: ICON.info })};
        var WT_LANG = ${jsonFuerSkript(WOCHENTAGE_LANG)};
        var MONATE_LANG = ${jsonFuerSkript(MONATE)};

        var $ = function(id){ return document.getElementById(id); };
        var p2 = function(n){ return String(n).padStart(2, "0"); };

        // Kleines DOM-Werkzeug: Elemente bauen, Text bleibt Text (nichts aus
        // Google oder dem CRM wird je als HTML eingesetzt; "html" nur fuer
        // die eigenen Icons).
        function h(tag, attrs, kinder){
          var el = document.createElement(tag);
          if (attrs) for (var k in attrs) {
            if (k === "html") el.innerHTML = attrs[k];
            else if (k === "text") el.textContent = attrs[k];
            else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== "") el.setAttribute(k, attrs[k]);
          }
          (kinder || []).forEach(function(c){ if (c === null || c === undefined || c === false) return;
            el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
          return el;
        }

        // ------------------------------------------------------- Datum/Zeit
        // Wochentag+Datum aus "JJJJ-MM-TT" — reine Arithmetik, keine Zeitzone.
        function tagText(tag, mitJahr){
          var d = new Date(tag.slice(0, 10) + "T12:00:00Z");
          var wt = WT_LANG[(d.getUTCDay() + 6) % 7];
          return wt + ", " + d.getUTCDate() + ". " + MONATE_LANG[d.getUTCMonth()] + (mitJahr ? " " + d.getUTCFullYear() : "");
        }
        function tagKurz(tag){ var d = new Date(tag.slice(0, 10) + "T12:00:00Z");
          return p2(d.getUTCDate()) + "." + p2(d.getUTCMonth() + 1) + "." + d.getUTCFullYear(); }
        function vorTag(tag){ var d = new Date(tag.slice(0, 10) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
        // Google-Eigenheit: end.date ganztaegiger Termine ist der Tag DANACH.
        function wannText(t){
          var von = (t.start || "").slice(0, 10), bis = (t.ende || t.start || "").slice(0, 10);
          if (t.ganztags) {
            if (bis > von) bis = vorTag(bis);
            return bis > von ? tagText(von) + " – " + tagText(bis, true) : tagText(von, true);
          }
          var z = (t.start || "").slice(11, 16), zb = (t.ende || "").slice(11, 16);
          if (bis > von && zb !== "00:00") return tagText(von) + " " + z + " – " + tagText(bis) + " " + zb;
          return tagText(von, true) + " · " + z + (zb ? " – " + zb : "");
        }
        function geld(w){ if (w === null || w === undefined || w === "") return "";
          try { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(w)); }
          catch (e) { return String(w) + " €"; } }
        // timestamptz/ISO aus dem CRM in Berliner Wandzeit; Mitternacht = nur der Tag.
        function zeitpunktText(w){
          if (!w) return "";
          if (/^\\d{4}-\\d{2}-\\d{2}$/.test(String(w))) return tagKurz(String(w));
          var d = new Date(w); if (isNaN(d.getTime())) return String(w);
          var tag = d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
          var uhr = d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
          return uhr === "00:00" ? tag : tag + " · " + uhr;
        }
        // Links in Beschreibungen anklickbar machen — Text bleibt Text.
        function mitLinks(text){
          var frag = document.createDocumentFragment();
          var re = /https?:\\/\\/[^\\s<>"]+/g, letzte = 0, m;
          while ((m = re.exec(text))) {
            if (m.index > letzte) frag.appendChild(document.createTextNode(text.slice(letzte, m.index)));
            var url = m[0].replace(/[.,;:)]+$/, "");
            frag.appendChild(h("a", { href: url, target: "_blank", rel: "noopener", text: url }));
            letzte = m.index + url.length;
          }
          if (letzte < text.length) frag.appendChild(document.createTextNode(text.slice(letzte)));
          return frag;
        }

        // ------------------------------------------------------- Dialog: neu
        function neuOeffnen(tag, stunde){
          $("neu-tag").value = tag;
          $("neu-tag-bis").value = "";
          $("neu-titel").value = "";
          $("neu-ort").value = "";
          $("neu-beschreibung").value = "";
          $("neu-ganztags").checked = false;
          if (typeof stunde === "number") {
            $("neu-von").value = p2(stunde) + ":00";
            $("neu-bis").value = p2(Math.min(23, stunde + 1)) + ":00";
          } else {
            $("neu-von").value = "09:00";
            $("neu-bis").value = "10:00";
          }
          firmaSetzen("neu", null, false);
          zeitenSchalten();
          popSchliessen(); tagSchliessen();
          $("dlg-neu").showModal();
          $("neu-titel").focus();
        }

        // Ganztaegig heisst: die Uhrzeiten sind bedeutungslos. Sie stehen zu
        // lassen laedt dazu ein, sie auszufuellen und sich zu wundern.
        function zeitenSchalten(){
          $("neu-zeiten").hidden = $("neu-ganztags").checked;
        }
        $("neu-ganztags").addEventListener("change", zeitenSchalten);

        // ------------------------------------------------ Dialog: bearbeiten
        function bearbeitenOeffnen(i){
          var t = TERMINE[i];
          if (!t) return;
          $("bea-id").value = t.id || "";
          $("bea-titel").value = t.titel || "";
          $("bea-titel-kopf").textContent = t.titel || "Termin";
          $("bea-ort").value = t.ort || "";
          $("bea-beschreibung").value = t.notiz || "";
          $("bea-beschreibung-alt").value = t.notiz || "";
          $("bea-beschreibung-voll").value = t.beschreibung || "";
          $("bea-tag").value = (t.start || "").slice(0, 10);
          $("bea-von").value = (t.start || "").slice(11, 16);
          $("bea-bis").value = (t.ende || "").slice(11, 16);
          $("bea-ganztags").value = t.ganztags ? "1" : "";
          $("bea-zeiten").hidden = Boolean(t.ganztags);
          $("bea-wann").textContent = wannText(t);
          // Vorbelegung ist keine Aenderung: akte_geaendert bleibt leer, bis
          // jemand wirklich waehlt oder entfernt.
          firmaSetzen("bea", t.fremd ? null : (t.firma || null), false);
          firmaSperren("bea", Boolean(t.fremd));
          $("bea-firma-alt").value = t.firma ? String(t.firma.id) : "";
          $("bea-hinweis").textContent = t.id
            ? "Änderungen gehen sofort in den Google Kalender."
            : "Dieser Termin hat keine ID — er lässt sich nur im Google Kalender selbst ändern.";
          popSchliessen(); tagSchliessen();
          $("dlg-bearbeiten").showModal();
          $("bea-titel").focus();
        }

        // Klick auf den Hintergrund schliesst ein Blatt (Leitfaden os-ui).
        document.querySelectorAll("dialog.os-blatt").forEach(function(d){
          d.addEventListener("click", function(ev){ if (ev.target === d) d.close(); });
        });

        // ------------------------------------------- Firma waehlen (Dialoge)
        //
        // Suchfeld -> GET /api/kalender/firmen?q= -> Vorschlaege als Knoepfe.
        // Gewaehlte Firma wird zur Pille, das Suchfeld verschwindet, firma_id
        // wandert versteckt mit. Pfeiltasten und Enter in der Liste.
        // vonNutzer=true heisst: ein Mensch hat gewaehlt/entfernt -> akte_geaendert=1.
        function statusWort(s){ return s === "kunde" ? "Kunde" : s === "lead" ? "Lead" : s === "verloren" ? "Verloren" : (s || ""); }
        function firmaSetzen(p, firma, vonNutzer){
          if (!AKTE_MOEGLICH) return;
          var pille = $(p + "-firma-pille"), suche = $(p + "-firma-suche"), liste = $(p + "-firma-liste");
          if (!pille || !suche) return;
          var warFokus = document.activeElement === pille.querySelector("button");
          $(p + "-firma-id").value = firma ? String(firma.id) : "";
          $(p + "-firma-name").textContent = firma ? firma.name : "";
          $(p + "-firma-ort").textContent = firma ? (firma.ort ? "· " + firma.ort : (firma.status ? "· " + statusWort(firma.status) : "")) : "";
          pille.hidden = !firma;
          pille.title = firma ? firma.name + (firma.ort ? " · " + firma.ort : "") : "";
          suche.hidden = Boolean(firma);
          suche.value = "";
          liste.hidden = true; liste.innerHTML = "";
          delete liste.dataset.q;                                  // Liste gehoert zu keiner Suche mehr
          suche.setAttribute("aria-expanded", "false");
          var flag = $(p + "-akte-geaendert");
          if (flag) flag.value = vonNutzer ? "1" : "";
          if (!firma && warFokus) suche.focus();
        }
        // Termin an einer fuer den Nutzer unsichtbaren Akte: nichts zu waehlen.
        function firmaSperren(p, fremd){
          var f = $(p + "-firma-fremd"), suche = $(p + "-firma-suche"), pille = $(p + "-firma-pille");
          if (!f || !suche) return;
          f.hidden = !fremd;
          if (fremd) { suche.hidden = true; pille.hidden = true; }
        }

        var sucheTimer = {}, sucheLauf = {};
        function firmaSuchen(p){
          var suche = $(p + "-firma-suche"), liste = $(p + "-firma-liste");
          var q = suche.value.trim();
          clearTimeout(sucheTimer[p]);
          // Sobald der Text ein anderer ist, gehoeren die angezeigten
          // Vorschlaege zu einer Suche, die niemand mehr meint. Sie stehen zu
          // lassen ist nicht nur unsauber: Enter oder Pfeiltaste haetten in
          // den 160 ms Wartezeit die FALSCHE Firma an den Termin gehaengt —
          // und genau eine falsche Kundenakte am Termin ist der Schaden, den
          // dieser Bereich verhindern soll (gemessen 05.09.: die alte Liste
          // stand je nach Datenbankgroesse 200-400 ms zu lang).
          if (liste.dataset.q !== q) {
            liste.innerHTML = "";
            liste.appendChild(h("div", { "class": "kal-firma-leer", text: "Suche läuft …" }));
            liste.hidden = false;
            delete liste.dataset.q;
            suche.setAttribute("aria-expanded", "true");
          }
          sucheTimer[p] = setTimeout(function(){
            var lauf = (sucheLauf[p] = (sucheLauf[p] || 0) + 1);
            fetch("/api/kalender/firmen?q=" + encodeURIComponent(q), { credentials: "same-origin" })
              .then(function(r){ return r.json(); })
              .then(function(d){
                if (lauf !== sucheLauf[p]) return;                      // eine juengere Suche laeuft
                var firmen = Array.isArray(d) ? d : (d && d.firmen) || [];
                liste.innerHTML = "";
                if (!firmen.length) {
                  liste.appendChild(h("div", { "class": "kal-firma-leer", text: q ? "Keine Firma zu „" + q + "“ gefunden." : "Keine Firmen sichtbar." }));
                } else {
                  firmen.forEach(function(f){
                    var b = h("button", { type: "button", role: "option", "data-id": f.id }, [
                      h("b", { text: f.name }),
                      h("small", { text: [f.ort, statusWort(f.status)].filter(Boolean).join(" · ") }),
                    ]);
                    b.addEventListener("click", function(){ firmaSetzen(p, f, true); });
                    liste.appendChild(b);
                  });
                }
                liste.hidden = false;
                liste.dataset.q = q;                               // diese Liste gehoert zu genau diesem Text
                suche.setAttribute("aria-expanded", "true");
              })
              .catch(function(){ liste.innerHTML = ""; liste.appendChild(h("div", { "class": "kal-firma-leer", text: "Suche gerade nicht möglich." })); liste.hidden = false; });
          }, q ? 160 : 0);
        }
        ["neu", "bea"].forEach(function(p){
          var suche = $(p + "-firma-suche"), liste = $(p + "-firma-liste");
          if (!suche) return;
          suche.addEventListener("input", function(){ firmaSuchen(p); });
          suche.addEventListener("focus", function(){ if (liste.hidden) firmaSuchen(p); });
          suche.addEventListener("keydown", function(ev){
            var knoepfe = [].slice.call(liste.querySelectorAll("button"));
            var aktiv = knoepfe.findIndex(function(b){ return b.classList.contains("kal-aktiv"); });
            if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
              if (!knoepfe.length) return;
              ev.preventDefault();
              var n = ev.key === "ArrowDown" ? Math.min(knoepfe.length - 1, aktiv + 1) : Math.max(0, aktiv - 1);
              knoepfe.forEach(function(b, i){ b.classList.toggle("kal-aktiv", i === n); });
              knoepfe[n].scrollIntoView({ block: "nearest" });
            } else if (ev.key === "Enter") {
              ev.preventDefault();                                   // Enter im Suchfeld schickt nie das Formular ab
              if (aktiv >= 0) knoepfe[aktiv].click();
              else if (knoepfe.length === 1) knoepfe[0].click();
            } else if (ev.key === "Escape" && !liste.hidden) {
              ev.preventDefault(); ev.stopPropagation(); liste.hidden = true; suche.setAttribute("aria-expanded", "false");
            }
          });
        });

        // ----------------------------------------------------- Termin-Popover
        var pop = $("kal-pop"), popI = -1, popAnker = null, popLauf = 0;
        var schmal = function(){ return window.matchMedia("(max-width:760px)").matches; };

        function popOeffnen(i, ankerEl){
          var t = TERMINE[i];
          if (!t) return;
          tagSchliessen();
          if (popAnker) popAnker.classList.remove("kal-offen");
          popI = i; popAnker = ankerEl || null;
          if (popAnker) popAnker.classList.add("kal-offen");
          popRendern(t, null, "", true);
          pop.hidden = false;
          popPlatzieren();
          $("kal-schleier").classList.add("an");
          pop.focus({ preventScroll: true });
          akteLaden(t, i);
        }
        function popSchliessen(){
          if (pop.hidden) return;
          pop.hidden = true;
          $("kal-schleier").classList.remove("an");
          if (popAnker) { popAnker.classList.remove("kal-offen"); try { popAnker.focus({ preventScroll: true }); } catch (e) {} }
          popAnker = null; popI = -1; popLauf++;
        }
        $("kal-pop-zu").addEventListener("click", popSchliessen);
        function terminAbsagen(){
          var t = TERMINE[popI]; if (!t) return;
          if (!t.id) { alert("Dieser Termin hat keine ID — er lässt sich nur im Google Kalender selbst absagen."); return; }
          if (!confirm("„" + t.titel + "“ wirklich absagen? Er verschwindet auch im Google Kalender.")) return;
          $("kal-absagen-id").value = t.id;
          $("kal-absagen-form").submit();
        }

        // Neben dem Termin, wie bei Google: rechts davon, sonst links, sonst
        // darunter; immer im Fenster. Auf schmalen Schirmen ein Blatt von unten
        // (kalender.css setzt dann die Lage per !important).
        function popPlatzieren(){
          pop.style.top = ""; pop.style.left = "";
          if (schmal() || !popAnker) return;
          var r = popAnker.getBoundingClientRect();
          pop.classList.add("kal-messen");
          var b = pop.offsetWidth, hh = pop.offsetHeight;
          pop.classList.remove("kal-messen");
          var W = window.innerWidth, H = window.innerHeight, rand = 12, abstand = 10;
          var left = r.right + abstand;
          if (left + b > W - rand) left = r.left - b - abstand;
          var top = r.top;
          if (left < rand) { left = Math.max(rand, Math.min(W - b - rand, r.left)); top = r.bottom + abstand; }
          if (top + hh > H - rand) top = Math.max(rand, H - hh - rand);
          pop.style.left = Math.round(left) + "px";
          pop.style.top = Math.round(top) + "px";
        }

        function pille(text, klasse){ return h("span", { "class": "os-pille " + (klasse || "os-pille--grau"), text: text }); }
        function statusPille(s){
          return s === "kunde" ? pille("Kunde", "os-pille--gruen os-pille--punkt")
            : s === "lead" ? pille("Lead", "os-pille--blau os-pille--punkt")
            : s === "verloren" ? pille("Verloren", "os-pille--rot os-pille--punkt") : null;
        }
        function sparteWort(s){ return s === "webdesign" ? "Webdesign" : s === "performance" ? "Performance" : s === "ki" ? "KI" : ""; }
        function hinweisZeile(text, knopf){
          var el = h("div", { "class": "kal-akte-hinweis", html: knopf ? "" : ICONS.info }, [h("span", { text: text })]);
          if (knopf) el.appendChild(knopf);
          return el;
        }

        // Popover fuellen. akteDaten = null (noch nicht geladen / keine), hinweis = Text dazu.
        function popRendern(t, akteDaten, hinweis, laedt){
          var farbe = $("kal-pop-farbe");
          farbe.className = "kal-pop-farbe" + (t.firma && t.firma.art === "erstgespraech" ? " kal-eg" : "");
          farbe.style.background = t.farbe ? t.farbe.hex : "";
          farbe.title = t.farbe ? "Google-Farbe: " + t.farbe.name : "";
          $("kal-pop-titel").textContent = t.titel || "(ohne Titel)";
          var rumpf = $("kal-pop-rumpf"); rumpf.innerHTML = "";
          rumpf.appendChild(h("div", { "class": "kal-pop-zeile", html: ICONS.uhr }, [h("div", null, [
            wannText(t), t.ganztags ? h("span", { "class": "kal-pop-unter", text: "ganztägig" }) : null])]));
          if (t.ort) {
            var ortInhalt = /^https?:\\/\\//.test(t.ort)
              ? h("a", { href: t.ort, target: "_blank", rel: "noopener", text: t.ort })
              : h("a", { href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(t.ort), target: "_blank", rel: "noopener", text: t.ort, title: "In Google Maps öffnen" });
            rumpf.appendChild(h("div", { "class": "kal-pop-zeile", html: ICONS.ort }, [h("div", null, [ortInhalt])]));
          }
          if (t.notiz) {
            // Lange Notiz auf vier Zeilen kuerzen, "mehr" klappt auf — die
            // Akte-Karte darunter soll ohne Scrollen sichtbar bleiben.
            var b = h("div", { "class": "kal-pop-beschreibung" }); b.appendChild(mitLinks(t.notiz));
            var inhalt = h("div", null, [b]);
            if (t.notiz.split("\\n").length > 4 || t.notiz.length > 240) {
              b.classList.add("kal-gekuerzt");
              var mehr = h("button", { type: "button", "class": "kal-mehr", text: "mehr", "aria-expanded": "false" });
              mehr.addEventListener("click", function(){
                var zu = b.classList.toggle("kal-gekuerzt");
                mehr.textContent = zu ? "mehr" : "weniger";
                mehr.setAttribute("aria-expanded", zu ? "false" : "true");
                popPlatzieren();
              });
              inhalt.appendChild(mehr);
            }
            rumpf.appendChild(h("div", { "class": "kal-pop-zeile", html: ICONS.text }, [inhalt]));
          }
          if (t.firma && t.firma.art === "erstgespraech") {
            rumpf.appendChild(h("div", { "class": "kal-pop-zeile", html: ICONS.person }, [h("div", null, [
              pille("Erstgespräch aus dem CRM", "os-pille--grau kal-pop-pille")])]));
          }
          if (t.htmlLink) {
            rumpf.appendChild(h("div", { "class": "kal-pop-zeile", html: ICONS.extern }, [h("div", null, [
              h("a", { href: t.htmlLink, target: "_blank", rel: "noopener", text: "In Google Kalender öffnen" })])]));
          }
          // Akte-Karte — oder der Grund, warum keine da ist.
          if (akteDaten) rumpf.appendChild(akteKarte(akteDaten));
          else if (t.fremd) rumpf.appendChild(hinweisZeile(hinweis || "Mit einer Kundenakte verknüpft, die für dich nicht sichtbar ist."));
          else if (t.firma && laedt) rumpf.appendChild(h("div", { "class": "kal-akte-laedt", text: "Kundenakte „" + t.firma.name + "“ wird geladen …" }));
          else if (t.firma) rumpf.appendChild(hinweisZeile(hinweis || "Kundenakte nicht verfügbar."));
          else if (AKTE_MOEGLICH && t.id) {
            var knopf = h("button", { type: "button", "class": "sekundaer klein", text: "Akte verknüpfen" });
            knopf.addEventListener("click", function(){ bearbeitenOeffnen(popI); });
            rumpf.appendChild(hinweisZeile(hinweis || "Keine Kundenakte verknüpft.", knopf));
          } else if (hinweis) {
            rumpf.appendChild(hinweisZeile(hinweis));
          }
          // Fuss: Bearbeiten · Absagen · (Akte oeffnen nur, solange die Karte fehlt — nie doppelt)
          var fuss = $("kal-pop-fuss"); fuss.innerHTML = "";
          var bea = h("button", { type: "button", "class": "sekundaer", id: "kal-pop-bearbeiten", text: "Bearbeiten" });
          bea.addEventListener("click", function(){ bearbeitenOeffnen(popI); });
          fuss.appendChild(bea);
          var ab = h("button", { type: "button", "class": "still gefahr", id: "kal-pop-absagen", text: "Absagen" });
          ab.addEventListener("click", terminAbsagen);
          fuss.appendChild(ab);
          fuss.appendChild(h("span", { "class": "kal-luecke" }));
          if (!akteDaten && t.firma) fuss.appendChild(h("a", { "class": "knopf dunkel kal-akte-oeffnen", href: "/crm/firma/" + t.firma.id, html: ICONS.akte + " Akte öffnen" }));
        }

        // Die Akte-Karte: nur, was aus dem CRM kommt. Leere Felder fallen weg.
        function akteKarte(a){
          var zeilen = h("dl", { "class": "kal-akte-zeilen" });
          function zeile(label, inhalt){ if (!inhalt) return;
            zeilen.appendChild(h("dt", { text: label }));
            zeilen.appendChild(h("dd", null, [inhalt])); }
          var person = [a.ansprechperson, a.ansprech_rolle].filter(Boolean).join(", ");
          zeile("Ansprechperson", person);
          if (a.telefon) zeile("Telefon", h("a", { href: "tel:" + String(a.telefon).replace(/[^+\\d]/g, ""), text: a.telefon }));
          if (a.mobil) zeile("Mobil", h("a", { href: "tel:" + String(a.mobil).replace(/[^+\\d]/g, ""), text: a.mobil }));
          if (a.email) zeile("E-Mail", h("a", { href: "mailto:" + a.email, text: a.email }));
          zeile("Ort", [a.ort, a.branche].filter(Boolean).join(" · "));
          zeile("Stand", a.stand);
          var geplant = a.umsatz_geplant, geschaetzt = a.umsatz_geschaetzt;
          if (geplant !== null && geplant !== undefined && geplant !== "") zeile("Umsatz geplant", geld(geplant));
          else if (geschaetzt !== null && geschaetzt !== undefined && geschaetzt !== "") zeile("Umsatz geschätzt", geld(geschaetzt));
          zeile("Nächste Aufgabe", a.naechste_aufgabe);
          if (a.naechster_termin) zeile("Nächster Termin", zeitpunktText(a.naechster_termin));
          else if (a.erstgespraech_am) zeile("Erstgespräch", zeitpunktText(a.erstgespraech_am));
          zeile("Verantwortlich", a.besitzer_name);
          var url = a.url || ("/crm/firma/" + a.id);
          var pillen = h("div", { "class": "kal-akte-pillen" }, [statusPille(a.status), sparteWort(a.sparte) ? pille(sparteWort(a.sparte)) : null]);
          return h("div", { "class": "kal-akte" }, [
            h("div", { "class": "kal-akte-kopf" }, [h("div", null, [
              h("p", { "class": "kal-akte-name" }, [h("a", { href: url, text: a.name || "(ohne Namen)" })]),
              pillen])]),
            zeilen,
            a.notizen ? h("p", { "class": "kal-akte-notiz", text: a.notizen }) : null,
            h("div", { "class": "kal-akte-fuss" }, [h("a", { "class": "knopf dunkel", href: url, html: ICONS.akte + " Akte öffnen" })]),
          ]);
        }

        // GET /api/kalender/termin: frischer Termin + Akte. Der Termin selbst
        // steht schon in der Seite — das Popover ist darum sofort da, die Karte
        // kommt nach (ueber gws-cli kann Lesen Sekunden dauern).
        function akteLaden(t, i){
          if (!t.id) return;
          var lauf = ++popLauf;
          var url = "/api/kalender/termin?id=" + encodeURIComponent(t.id) + "&tag=" + encodeURIComponent((t.start || "").slice(0, 10));
          fetch(url, { credentials: "same-origin" }).then(function(r){ return r.json(); }).then(function(d){
            if (lauf !== popLauf || popI !== i) return;
            if (!d || !d.ok) { popRendern(t, null, (d && d.hint) || "Akte gerade nicht abrufbar.", false); popPlatzieren(); return; }
            if (d.termin) {
              // Frische Daten uebernehmen (z. B. nach einer Aenderung am Handy),
              // aber nur die Felder, die Google liefert.
              ["titel", "ort", "start", "ende", "ganztags", "beschreibung", "notiz", "htmlLink", "farbe", "firma", "fremd"].forEach(function(k){ if (k in d.termin) t[k] = d.termin[k]; });
            }
            popRendern(t, d.akte || null, d.hinweis || "", false);
            popPlatzieren();
          }).catch(function(){ if (lauf === popLauf && popI === i) { popRendern(t, null, "Akte gerade nicht abrufbar.", false); popPlatzieren(); } });
        }

        // ------------------------------------------------------- Tag-Popover
        var tagpop = $("kal-tagpop"), tagAnker = null;
        function tagOeffnen(tag, ankerEl){
          popSchliessen();
          tagAnker = ankerEl;
          $("kal-tagpop-titel").textContent = tagText(tag, true);
          var liste = $("kal-tagpop-liste"); liste.innerHTML = "";
          TERMINE.forEach(function(t, i){
            var von = (t.start || "").slice(0, 10), bis = (t.ende || t.start || "").slice(0, 10);
            if (t.ganztags && bis > von) bis = vorTag(bis);
            if (!t.ganztags && bis > von && (t.ende || "").slice(11, 16) === "00:00") bis = vorTag(bis);
            if (tag < von || tag > bis) return;
            var klasse = (t.firma ? " kal-mit-akte" : "") + (t.firma && t.firma.art === "erstgespraech" ? " kal-eg" : "") + (t.farbe ? " kal-farbig" : "");
            var stil = t.farbe ? "--kal-farbe:" + t.farbe.hex + ";--kal-schrift:" + t.farbe.schrift : "";
            var b = t.ganztags
              ? h("button", { type: "button", "class": "gk-m-balken" + klasse, style: stil, "data-i": i, html: t.firma ? ICONS.person : "" }, [h("span", { text: t.titel })])
              : h("button", { type: "button", "class": "gk-m-zeile" + klasse, style: stil, "data-i": i }, [
                  h("i", { "class": "gk-punkt" }), h("span", { "class": "gk-m-zeit", text: (t.start || "").slice(11, 16) }),
                  t.firma ? h("span", { html: ICONS.person }) : null, h("span", { "class": "gk-m-titel", text: t.titel })]);
            liste.appendChild(b);
          });
          tagpop.hidden = false;
          tagpop.style.top = ""; tagpop.style.left = "";
          if (!schmal() && ankerEl) {
            var r = ankerEl.getBoundingClientRect();
            tagpop.classList.add("kal-messen"); var bw = tagpop.offsetWidth, bh = tagpop.offsetHeight; tagpop.classList.remove("kal-messen");
            var left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left));
            var top = r.bottom + 6; if (top + bh > window.innerHeight - 12) top = Math.max(12, r.top - bh - 6);
            tagpop.style.left = Math.round(left) + "px"; tagpop.style.top = Math.round(top) + "px";
          }
          $("kal-schleier").classList.add("an");
          tagpop.focus({ preventScroll: true });
        }
        function tagSchliessen(){
          if (tagpop.hidden) return;
          tagpop.hidden = true;
          if (pop.hidden) $("kal-schleier").classList.remove("an");
          if (tagAnker) { try { tagAnker.focus({ preventScroll: true }); } catch (e) {} }
          tagAnker = null;
        }
        $("kal-tagpop-zu").addEventListener("click", tagSchliessen);

        // Ein Zuhoerer fuer die ganze Seite statt einer je Zelle — im
        // Monatsraster sind das sonst schnell 200 Handler. Der Termin gewinnt
        // gegen die Zelle darunter (closest findet ihn zuerst).
        // Ist ein Popover offen, SCHLIESST ein Klick daneben nur — er legt
        // nicht im selben Zug einen neuen Termin an (wie bei Google).
        document.addEventListener("click", function(ev){
          if (ev.target.closest("dialog")) return;
          var inPop = ev.target.closest("#kal-pop"), inTagpop = ev.target.closest("#kal-tagpop");
          var t = ev.target.closest("[data-i]");
          var mehr = ev.target.closest("[data-mehr]");
          var offen = !pop.hidden || !tagpop.hidden;
          if (offen && !inPop && !inTagpop && !t && !mehr) { popSchliessen(); tagSchliessen(); return; }
          if (ev.target === $("kal-schleier")) return;
          if (mehr) { tagOeffnen(mehr.getAttribute("data-mehr"), mehr); return; }
          if (t) {
            var i = Number(t.getAttribute("data-i"));
            if (inTagpop) { var alterAnker = tagAnker; tagSchliessen(); popOeffnen(i, alterAnker || t); }
            else popOeffnen(i, t);
            return;
          }
          if (inPop || inTagpop || ev.target.closest("a")) return;
          var n = ev.target.closest("[data-neu]");
          if (n) {
            var s = n.getAttribute("data-stunde");
            neuOeffnen(n.getAttribute("data-neu"), s === null ? undefined : Number(s));
          }
        });
        window.addEventListener("resize", function(){ if (!pop.hidden) popPlatzieren(); });
        var rollen = $("gk-rollen");
        if (rollen) rollen.addEventListener("scroll", function(){ if (!pop.hidden && !schmal()) popPlatzieren(); }, { passive: true });

        // ---------------------------------------------------------- Tastatur
        // Wie bei Google: t = heute, Pfeile = blaettern, n = neuer Termin,
        // Escape schliesst. Nie, wenn gerade getippt wird oder ein Blatt offen ist.
        document.addEventListener("keydown", function(ev){
          if (ev.key === "Escape") {
            if (!pop.hidden || !tagpop.hidden) { ev.preventDefault(); popSchliessen(); tagSchliessen(); }
            return;
          }
          if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
          var z = ev.target;
          if (z && (z.tagName === "INPUT" || z.tagName === "TEXTAREA" || z.tagName === "SELECT" || z.isContentEditable)) return;
          if (document.querySelector("dialog[open]")) return;
          if (ev.key === "t" || ev.key === "T") { location.href = NAV.heute; }
          else if (ev.key === "n" || ev.key === "N") { ev.preventDefault(); neuOeffnen(ANKER); }
          else if (ev.key === "ArrowLeft") { location.href = NAV.vorher; }
          else if (ev.key === "ArrowRight") { location.href = NAV.nachher; }
        });

        // Die rote Jetzt-Linie — das eine Element, an dem man einen Kalender
        // sofort erkennt. Nur zeichnen, wenn heute ueberhaupt sichtbar ist.
        (function(){
          var linie = $("gk-jetzt");
          if (!linie || !rollen) return;
          var heuteDrin = ${heuteDrin ? "true" : "false"};
          var spalte = ${tage.indexOf(heute)};

          function setzen(){
            if (!heuteDrin) return;
            // Berliner Wandzeit, nicht die des Browsers — sonst steht die Linie
            // fuer jemanden auf Reisen an der falschen Stelle.
            var t = new Date().toLocaleTimeString("de-DE",
              { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false });
            var teile = t.split(":");
            var min = Number(teile[0]) * 60 + Number(teile[1]);
            linie.style.top = (min / 60 * STUNDE) + "px";
            linie.style.setProperty("--spalte", spalte);
            linie.hidden = false;
          }
          setzen();
          setInterval(setzen, 60000);

          // Auf die Arbeitszeit scrollen — 0:00 oben ist korrekt, zeigt aber die
          // leerste Stelle des Tages. Steht heute im Bild, dann dorthin.
          //
          // Auf eine volle Stunde gerundet: unrund schneidet die oberste
          // Zeile mitten durch, und ein Termin, der dort anfaengt, sieht aus,
          // als waere er halb weg.
          var ziel = 7 * STUNDE;
          if (heuteDrin && !linie.hidden) {
            ziel = parseFloat(linie.style.top) - rollen.clientHeight / 3;
          }
          // Die 8px Vorlauf sind kein Zierrat: die Stundenbeschriftung sitzt
          // UEBER ihrer Linie, ohne sie waere "09:00" oben halb abgeschnitten.
          rollen.scrollTop = Math.max(0, Math.floor(ziel / STUNDE) * STUNDE - 8);
        })();
        </script>`,
      }) + "</body></html>");
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------- Schreiben
  //
  // Alle drei Routen antworten gleich: machen, dann zurueck auf die Ansicht.
  // Geht etwas schief, haengt der Grund als ?fehler= dran — sichtbar, statt
  // still zu scheitern (ein Termin, den man eingetragen glaubt und der nicht
  // da ist, ist schlimmer als eine Fehlermeldung).
  const fertig = (res, b, r) =>
    res.redirect(zurueck(b) + (r && r.ok === false
      ? "&fehler=" + encodeURIComponent(lesbar(String(r.grund || ""))).slice(0, 400) : ""));

  // Rohe Fehler von gws-cli sind fuer niemanden zu gebrauchen. Die haeufigen
  // bekommen Klartext, alles andere geht unveraendert durch.
  function lesbar(grund) {
    const g = String(grund || "");
    if (/ENOENT|not found|command not found/i.test(g)) {
      return "Auf dieser Maschine besteht keine Verbindung zu Google — gws-cli und Token liegen auf dem Server.";
    }
    if (/invalid_grant|token|credential|unauthor/i.test(g)) {
      return "Google hat die Anmeldung abgelehnt — das Token ist abgelaufen und muss neu geholt werden. (" + g.slice(0, 120) + ")";
    }
    // Gruende aus lib/kalender-akte.js (Rechte)
    if (g === "akte-unsichtbar") return "Diese Kundenakte ist für dich nicht sichtbar — sie wurde nicht verknüpft.";
    if (g === "faden-fremd") return "Dieser Termin hängt an einer Kundenakte, die für dich nicht sichtbar ist — Umhängen oder Lösen ist nicht möglich.";
    if (g === "keine-datenbank") return "Ohne Datenbank lässt sich keine Kundenakte verknüpfen.";
    if (g === "kein-konto") return "Mit persönlichem Konto anmelden, um eine Kundenakte zu verknüpfen.";
    if (g === "tabelle-fehlt") return "Die Verknüpfungstabelle fehlt in der Datenbank (Migration 0059 einspielen).";
    if (g === "nicht-geschrieben") return "Die Verknüpfung konnte nicht gespeichert werden.";
    return g;
  }

  // Ein Tag als JSON — fuer die Kalender-Karte auf der Zentrale.
  //
  // Die Karte laeuft damit auf DERSELBEN Leseroutine wie die Seite oben
  // (kal.spanne + kal.nachTagen). Vorher hatte die Zentrale eine eigene, zweite
  // Kalender-Abfrage in server.js mit eigenem Umgang mit ganztaegigen Terminen —
  // zwei Anzeigen desselben Kalenders, die auseinanderlaufen konnten. Die Karte
  // ist die Kurzfassung dieser Seite, kein zweiter Kalender.
  app.get("/api/kalender/tag", async (req, res) => {
    try {
      // Grenze wie in der Seitennavigation: ein Jahr in jede Richtung reicht,
      // und ein manipuliertes ?versatz= kann keine Endlosspanne erzwingen.
      const versatz = Math.max(-365, Math.min(365, parseInt(req.query.versatz, 10) || 0));
      const tag = kal.tagPlus(kal.heuteTag(), versatz);
      const antwort = await kal.spanne(tag, tag);
      if (!antwort.ok) {
        return res.json({
          ok: false,
          hint: antwort.fehlt
            ? "Auf dieser Maschine besteht keine Verbindung zu Google — auf dem Server läuft der Kalender."
            : lesbar(String(antwort.fehler || "Kalender nicht abrufbar.")),
        });
      }
      const termine = (kal.nachTagen(antwort.termine)[tag] || []).map((t) => ({
        titel: t.titel,
        ort: t.ort,
        // Leere Uhrzeit heisst ganztaegig — die Karte schreibt das dann aus.
        uhrzeit: kal.istGanztags(t) ? "" : kal.uhrzeit(t.start),
      }));
      res.json({ ok: true, tag, termine });
    } catch (e) {
      res.json({ ok: false, hint: "Kalender-Aufruf fehlgeschlagen: " + String(e.message).slice(0, 200) });
    }
  });

  // Vorschlaege fuer "Kunde oder Lead" im Termin-Dialog: [{ id, name, ort, status }].
  // Mit Zeilenrechten des angemeldeten Kontos — ein Mitarbeiter sieht nur
  // seine Firmen. Ohne persoenliches Konto gibt es nichts.
  app.get("/api/kalender/firmen", async (req, res) => {
    try {
      const nutzer = (req.session && req.session.crm) || null;
      if (!akteMoeglich(nutzer)) {
        return res.status(nutzer ? 200 : 401).json({ ok: false, hint: nutzer
          ? "Ohne Datenbank gibt es keine Kundenakten."
          : "Bitte mit persönlichem Konto anmelden." });
      }
      const q = String(req.query.q || "").slice(0, 80);
      res.json(await akte.firmenSuchen(nutzer, q, 8));
    } catch (e) {
      res.status(500).json({ ok: false, hint: "Suche fehlgeschlagen: " + String(e.message).slice(0, 160) });
    }
  });

  // Ein Termin samt Kundenakte — die Daten fuers Popover.
  //   ?id=<Google-Termin-ID>&tag=<JJJJ-MM-TT, Tag des Chips>
  // Reihenfolge: gezielt nach ID (Direktweg, events/<id>), sonst das Fenster
  // um den Tag (Google liefert alles, was den Tag beruehrt), notfalls das
  // weite Fenster -30/+180 Tage ohne 200er-Deckel (spanneVoll). Die Akte
  // kommt aus dem Faden (termin_verknuepfungen) oder aus der Akte-Zeile der
  // Beschreibung — beides nur, soweit die Zeilenrechte sie zeigen.
  app.get("/api/kalender/termin", async (req, res) => {
    try {
      const nutzer = (req.session && req.session.crm) || null;
      const id = String(req.query.id || "").slice(0, 200);
      if (!id) return res.status(400).json({ ok: false, hint: "Termin-ID fehlt." });
      const tag = kal.tagOderHeute(req.query.tag);

      let t = await kal.terminNachId(id);
      let antwort = null;
      if (!t) {
        antwort = await kal.spanne(kal.tagPlus(tag, -1), kal.tagPlus(tag, 1), 2000);
        t = antwort.ok ? antwort.termine.find((x) => String(x.id) === id) : null;
      }
      if (!t && antwort && antwort.ok) {
        const heute = kal.heuteTag();
        antwort = await akte.spanneVoll(kal.tagPlus(heute, -30), kal.tagPlus(heute, 180));
        t = antwort.ok ? antwort.termine.find((x) => String(x.id) === id) : null;
      }
      if (!t && antwort && !antwort.ok) {
        return res.json({ ok: false, hint: antwort.fehlt
          ? "Auf dieser Maschine besteht keine Verbindung zu Google — auf dem Server läuft der Kalender."
          : lesbar(String(antwort.fehler || "Kalender nicht abrufbar.")) });
      }
      if (!t) return res.json({ ok: false, hint: "Diesen Termin gibt es im Google Kalender nicht mehr." });

      const eintrag = (await firmenZuTerminen(nutzer, [t])).get(String(t.id)) || { firma: null, fremd: false };
      const termin = terminFuerSeite(t, eintrag.firma, eintrag.fremd);

      let akteDaten = null, hinweis = "";
      if (eintrag.fremd) {
        hinweis = "Mit einer Kundenakte verknüpft, die für dich nicht sichtbar ist.";
      } else {
        const firmaId = eintrag.firma ? eintrag.firma.id : akte.akteAusBeschreibung(t.beschreibung);
        if (firmaId) {
          if (!akteMoeglich(nutzer)) {
            hinweis = nutzer ? "Ohne Datenbank gibt es keine Kundenakten." : "Mit persönlichem Konto anmelden, um die Kundenakte zu sehen.";
          } else {
            akteDaten = await akte.firmaKurz(nutzer, firmaId);
            if (!akteDaten) hinweis = "Diese Akte ist für dich nicht sichtbar.";
          }
        }
      }
      res.json({ ok: true, termin, akte: akteDaten, hinweis });
    } catch (e) {
      res.json({ ok: false, hint: "Termin-Aufruf fehlgeschlagen: " + String(e.message).slice(0, 200) });
    }
  });

  // firma_id aus dem Formular — nur eine Zahl, sonst nichts.
  const firmaAus = (w) => (/^\d{1,12}$/.test(String(w || "")) ? Number(w) : 0);

  // Neuer Termin. Akte anhaengen heisst: ERST pruefen, ob der Nutzer die Firma
  // sieht (RLS) — sieht er sie nicht, wird der Termin OHNE Zeile und ohne
  // Faden eingetragen und ?fehler= sagt es. Sieht er sie: Termin mit Zeile
  // anlegen, dann der Faden (die ID gibt es erst danach); scheitert der Faden
  // doch, kommt die Zeile wieder raus — Zeile und Faden nur gemeinsam.
  app.post("/kalender/neu", formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const nutzer = (req.session && req.session.crm) || null;
      const tag = kal.tagOderHeute(b.tag);
      const ganztags = b.ganztags === "1";
      const bisTag = /^\d{4}-\d{2}-\d{2}$/.test(String(b.tag_bis || "")) && b.tag_bis >= tag ? b.tag_bis : tag;
      const zeit = (w, ersatz) => (/^\d{2}:\d{2}$/.test(String(w || "")) ? w : ersatz);

      const gewuenscht = firmaAus(b.firma_id);
      let firmaId = 0, akteProblem = "";
      if (gewuenscht) {
        if (!akteMoeglich(nutzer)) akteProblem = nutzer ? "keine-datenbank" : "kein-konto";
        else if (!(await akte.firmaSichtbar(nutzer, gewuenscht))) akteProblem = "akte-unsichtbar";
        else firmaId = gewuenscht;
      }

      const r = await kal.terminEintragen({
        titel: b.titel,
        start: ganztags ? tag : `${tag}T${zeit(b.von, "09:00")}`,
        ende: ganztags ? bisTag : `${bisTag}T${zeit(b.bis, "10:00")}`,
        ganztags,
        ort: b.ort || "",
        beschreibung: akte.beschreibungMitAkte(b.beschreibung || "", firmaId),
      });
      if (r.ok && firmaId) {
        const f = r.id
          ? await akte.verknuepfungSetzen(nutzer, { eventId: r.id, firmaId, art: "termin" })
          : { ok: false, grund: "Google hat keine Termin-ID genannt" };
        if (!f.ok) {
          if (r.id) await kal.terminAendern({ id: r.id, beschreibung: akte.beschreibungOhneAkte(b.beschreibung || "") });
          akteProblem = f.grund;
        }
      }
      if (r.ok && akteProblem) {
        return fertig(res, b, { ok: false, grund: "Termin eingetragen, aber: " + lesbar(akteProblem) });
      }
      fertig(res, b, r);
    } catch (err) { next(err); }
  });

  // Termin aendern. Die Akte wird nur angefasst, wenn das Formular eine echte
  // Wahl traegt (akte_geaendert=1 oder ein neues firma_id) und der Nutzer es
  // darf: kein fremder Faden, Firma
  // sichtbar. Dann Faden ZUERST, danach die Zeile in Google — und wenn Google
  // nicht mitzieht, geht der Faden auf den alten Stand zurueck. Ohne Akte-
  // Aenderung bleibt die vorhandene Zeile stehen, was immer an der Notiz passiert.
  app.post("/kalender/aendern", formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const nutzer = (req.session && req.session.crm) || null;
      if (!b.id) return fertig(res, b, { ok: false, grund: "Termin ohne ID — nur in Google änderbar." });
      const tag = /^\d{4}-\d{2}-\d{2}$/.test(String(b.tag || "")) ? b.tag : null;
      const hatZeit = /^\d{2}:\d{2}$/.test(String(b.von || ""));
      const ganztags = b.ganztags === "1";

      const darfAkte = akteMoeglich(nutzer);
      // Der Dialog meldet eine echte Wahl mit akte_geaendert=1; ein konkretes
      // firma_id, das vom mitgeschickten firma_alt abweicht, zaehlt ebenfalls
      // (Skripte, aeltere Formulare). Ein LEERES Feld ohne die Meldung nie —
      // sonst loescht die blosse Notizaenderung eines Mitarbeiters die Akte.
      const akteGeaendert = darfAkte && akte.akteWahlImFormular({
        akteGeaendert: b.akte_geaendert === "1", firmaId: b.firma_id, firmaAlt: b.firma_alt,
      });
      const firmaNeu = akteGeaendert ? firmaAus(b.firma_id) : 0;
      let fadenVorher = null;
      if (akteGeaendert) {
        const [ohneRechte, mitRechten] = await Promise.all([akte.fadenSystem(b.id), akte.verknuepfungVon(nutzer, b.id)]);
        fadenVorher = mitRechten;
        if (!akte.umhaengenErlaubt(ohneRechte, mitRechten)) return fertig(res, b, { ok: false, grund: "faden-fremd" });
        if (firmaNeu && !(await akte.firmaSichtbar(nutzer, firmaNeu))) return fertig(res, b, { ok: false, grund: "akte-unsichtbar" });
        const f = firmaNeu
          ? await akte.verknuepfungSetzen(nutzer, { eventId: b.id, firmaId: firmaNeu, art: "termin" })
          : await akte.verknuepfungLoeschen(nutzer, b.id);
        if (!f.ok) return fertig(res, b, { ok: false, grund: f.grund });
      }

      const plan = akte.beschreibungBeimAendern({
        darfAkte, akteGeaendert, firmaNeu,
        beschreibungVoll: b.beschreibung_voll || "",
        notizNeu: b.beschreibung || "", notizAlt: b.beschreibung_alt || "",
      });

      let r = await kal.terminAendern({
        id: b.id,
        titel: b.titel || undefined,
        // Nur schicken, was wirklich bestimmbar ist: terminAendern verlangt zu
        // einem neuen Start auch ein Ende, sonst bliebe das alte stehen und der
        // Termin waere ploetzlich Stunden lang. Ganztaegige bekommen den Tag.
        start: ganztags ? (tag || undefined) : (tag && hatZeit ? `${tag}T${b.von}` : undefined),
        ende: ganztags ? (tag || undefined) : (tag && /^\d{2}:\d{2}$/.test(String(b.bis || "")) ? `${tag}T${b.bis}` : undefined),
        ganztags,
        ort: b.ort || undefined,
        beschreibung: plan.beschreibung,
      });
      // Dieselbe Firma noch einmal gewaehlt, sonst nichts geaendert: der Faden
      // ist geschrieben, Google hatte nichts zu tun — das ist kein Fehler.
      if (!r.ok && akteGeaendert && r.grund === "nichts zu aendern") r = { ok: true, id: b.id };
      if (!r.ok && akteGeaendert) {
        if (fadenVorher) await akte.verknuepfungSetzen(nutzer, { eventId: b.id, firmaId: fadenVorher.firma_id, art: fadenVorher.art });
        else await akte.verknuepfungLoeschen(nutzer, b.id);
      }
      fertig(res, b, r);
    } catch (err) { next(err); }
  });

  app.post("/kalender/absagen", formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const r = await kal.terminAbsagen({ id: b.id });
      // Der Faden geht mit dem Termin — eine Verknuepfung auf einen Termin,
      // den es nicht mehr gibt, waere nur ein Geist in der Akte. Ohne
      // Zeilenrechte, denn den Termin selbst durfte der Nutzer loeschen.
      if (r.ok && process.env.DATABASE_URL) await akte.fadenEntfernenSystem(b.id);
      fertig(res, b, r);
    } catch (err) { next(err); }
  });
};
