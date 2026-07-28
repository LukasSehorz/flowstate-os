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

const express = require("express");
const { schale, eintragen } = require("./schale.js");
const kal = require("./kalender.js");

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
};

const STUNDE_PX = 48;                   // Hoehe einer Stunde im Zeitraster

module.exports = function (app) {
  const formular = express.urlencoded({ extended: true });

  // Wohin nach dem Speichern? Immer zurueck auf die Ansicht, aus der der
  // Nutzer kam — sonst landet man nach jedem Eintrag wieder im Heute-Monat.
  const ANSICHTEN = ["tag", "woche", "monat"];
  const zurueck = (b) => "/kalender?ansicht=" + encodeURIComponent(ANSICHTEN.includes(b.ansicht) ? b.ansicht : "monat") +
    "&datum=" + encodeURIComponent(kal.tagOderHeute(b.datum));

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

      // Fuer die Dialoge: eine flache Liste, die Chips zeigen nur ihren Index.
      // Spart das Escapen von Titeln in onclick-Attributen.
      const liste = termine.map((t) => ({
        id: t.id, titel: t.titel, ort: t.ort || "",
        start: t.start, ende: t.ende || "", ganztags: kal.istGanztags(t),
      }));
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
        <div class="hinweis ${antwort.fehlt ? "info" : "warn"} gk-stoerung">${ICON.info}<div>
          ${antwort.fehlt
            ? `<b>Auf dieser Maschine besteht keine Verbindung zu Google.</b>
               Das Werkzeug <code>gws-cli</code> und das Anmelde-Token liegen auf dem Server —
               lokal ist das der Normalfall und kein Defekt. Termine erscheinen und lassen sich
               eintragen, sobald die Seite dort laeuft.
               Pruefen: <code>docker exec flowstate-dashboard node scripts/status.js</code>`
            : `<b>Google antwortet nicht.</b> Meist ist das Anmelde-Token abgelaufen und muss
               einmal neu geholt werden. Bis dahin ist diese Ansicht leer —
               das heisst <em>nicht</em>, dass keine Termine da sind.
               Meldung: <code>${e(antwort.fehler)}</code>`}
        </div></div>`;

      // Ein Schreibversuch, der schiefging (siehe fertig() weiter unten). Muss
      // sichtbar sein: ein Termin, den man eingetragen GLAUBT und der nicht da
      // ist, faellt erst auf, wenn man ihn verpasst hat.
      const fehler = String(req.query.fehler || "").slice(0, 400);
      const fehlerHinweis = fehler ? `
        <div class="hinweis warn gk-stoerung">${ICON.info}<div>
          <b>Der Termin wurde nicht gespeichert.</b> ${e(fehler)}</div></div>` : "";

      // ------------------------------------------------------------- Monat
      //
      // Googles Monatsansicht macht einen Unterschied, der viel ausmacht:
      // ganztaegige Termine sind gefuellte Balken, Termine MIT Uhrzeit nur ein
      // farbiger Punkt plus Zeit und Titel auf dem Zellenhintergrund. Dadurch
      // wirkt ein voller Monat nicht wie eine Wand aus Farbe.
      const monatChip = (t) => {
        const i = indexVon.get(t);
        const zeit = kal.uhrzeit(t.start);
        const hinweis = e((zeit ? zeit + " " : "") + t.titel + (t.ort ? " · " + t.ort : ""));
        return kal.istGanztags(t)
          ? `<button type="button" class="gk-m-balken" data-i="${i}" title="${hinweis}">
               <span>${e(t.titel)}</span></button>`
          : `<button type="button" class="gk-m-zeile" data-i="${i}" title="${hinweis}">
               <i class="gk-punkt"></i><span class="gk-m-zeit">${zeit}</span>
               <span class="gk-m-titel">${e(t.titel)}</span></button>`;
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
                ${rest > 0 ? `<a class="gk-mehr" href="${ziel(d, "tag", miniAnker)}">+ ${rest} weitere</a>` : ""}</div>
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
            const startMin = String(t.start).slice(0, 10) < d ? 0 : kal.minuten(t.start);
            const hoehe = Math.min(kal.dauer(t), 24 * 60 - startMin);
            const px = Math.max(20, (hoehe / 60) * STUNDE_PX - 2);
            const breite = 100 / spuren;
            return `<button type="button" class="gk-termin ${px < 34 ? "kurz" : ""}" data-i="${i}"
              style="top:${(startMin / 60) * STUNDE_PX}px;height:${px}px;
                     left:calc(${spur * breite}% + 2px);width:calc(${breite}% - 4px)"
              title="${e(kal.uhrzeit(t.start) + "–" + kal.uhrzeit(t.ende) + " " + t.titel + (t.ort ? " · " + t.ort : ""))}">
              <b>${e(t.titel)}</b>
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
              return `<div class="gk-gz-zelle" data-neu="${d}">${g.map((t) =>
                `<button type="button" class="gk-gz-balken" data-i="${indexVon.get(t)}"
                   title="${e(t.titel)}"><span>${e(t.titel)}</span></button>`).join("")}</div>`;
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

      res.send(schale({
        titel: "Kalender",
        unterzeile: "Google Kalender",
        aktiv: "kalender", nutzer, suche: "",
        inhalt: `
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
                mit dem auch Alexandra Termine einträgt. Weitere lassen sich in Google
                freigeben — sie erscheinen dann automatisch hier.</p>
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

        <dialog id="dlg-neu" class="gk-dialog"><form method="post" action="/kalender/neu">
          <input type="hidden" name="ansicht" value="${e(ansicht)}">
          <input type="hidden" name="datum" value="${e(anker)}">
          <div class="todo-dlg-kopf"><div><h2>Termin eintragen</h2>
            <div class="sub">Geht direkt in den Google Kalender</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="feld"><label>Titel *</label>
            <input name="titel" id="neu-titel" required placeholder="z. B. Erstgespräch Praxis Müller"></div>
          <div class="feld-paar">
            <div class="feld"><label>Datum *</label>
              <input type="date" name="tag" id="neu-tag" required></div>
            <div class="feld"><label>Datum bis</label>
              <input type="date" name="tag_bis" id="neu-tag-bis"
                     title="Nur bei mehrtägigen Terminen ausfüllen"></div>
          </div>
          <div class="feld-paar" id="neu-zeiten">
            <div class="feld"><label>Von</label><input type="time" name="von" id="neu-von" value="09:00"></div>
            <div class="feld"><label>Bis</label><input type="time" name="bis" id="neu-bis" value="10:00"></div>
          </div>
          <label class="gk-schalter"><input type="checkbox" name="ganztags" id="neu-ganztags" value="1">
            <span>ganztägig</span></label>
          <div class="feld"><label>Ort</label>
            <input name="ort" placeholder="Adresse, Raum oder Videolink"></div>
          <div class="feld"><label>Notiz</label>
            <input name="beschreibung" placeholder="Worum geht es?"></div>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.check} Eintragen</button></div>
        </form></dialog>

        <dialog id="dlg-bearbeiten" class="gk-dialog"><form method="post" action="/kalender/aendern">
          <input type="hidden" name="ansicht" value="${e(ansicht)}">
          <input type="hidden" name="datum" value="${e(anker)}">
          <input type="hidden" name="id" id="bea-id">
          <div class="todo-dlg-kopf"><div><h2 id="bea-titel-kopf">Termin</h2>
            <div class="sub" id="bea-wann">—</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="feld"><label>Titel</label><input name="titel" id="bea-titel"></div>
          <div class="feld-paar">
            <div class="feld"><label>Datum</label><input type="date" name="tag" id="bea-tag"></div>
            <div class="feld"><label>Ort</label><input name="ort" id="bea-ort" placeholder="optional"></div>
          </div>
          <div class="feld-paar" id="bea-zeiten">
            <div class="feld"><label>Von</label><input type="time" name="von" id="bea-von"></div>
            <div class="feld"><label>Bis</label><input type="time" name="bis" id="bea-bis"></div>
          </div>
          <p class="caption" id="bea-hinweis" style="margin:-4px 0 12px"></p>
          <div class="dialog-fuss gk-fuss">
            <button type="submit" class="still gefahr" formaction="/kalender/absagen"
              onclick="return confirm('Diesen Termin wirklich absagen? Er verschwindet auch im Google Kalender.')">
              ${ICON.papierkorb} Absagen</button>
            <span class="gk-luecke"></span>
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.check} Speichern</button></div>
        </form></dialog>

        <script>
        var TERMINE = ${jsonFuerSkript(liste)};
        var STUNDE = ${STUNDE_PX};

        function neuOeffnen(tag, stunde){
          document.getElementById("neu-tag").value = tag;
          document.getElementById("neu-tag-bis").value = "";
          document.getElementById("neu-titel").value = "";
          document.getElementById("neu-ganztags").checked = false;
          var p = function(n){ return String(n).padStart(2, "0"); };
          if (typeof stunde === "number") {
            document.getElementById("neu-von").value = p(stunde) + ":00";
            document.getElementById("neu-bis").value = p(Math.min(23, stunde + 1)) + ":00";
          } else {
            document.getElementById("neu-von").value = "09:00";
            document.getElementById("neu-bis").value = "10:00";
          }
          zeitenSchalten();
          document.getElementById("dlg-neu").showModal();
          document.getElementById("neu-titel").focus();
        }

        // Ganztaegig heisst: die Uhrzeiten sind bedeutungslos. Sie stehen zu
        // lassen laedt dazu ein, sie auszufuellen und sich zu wundern.
        function zeitenSchalten(){
          var an = document.getElementById("neu-ganztags").checked;
          document.getElementById("neu-zeiten").style.display = an ? "none" : "";
        }
        document.getElementById("neu-ganztags").addEventListener("change", zeitenSchalten);

        function bearbeitenOeffnen(i){
          var t = TERMINE[i];
          if (!t) return;
          document.getElementById("bea-id").value = t.id || "";
          document.getElementById("bea-titel").value = t.titel || "";
          document.getElementById("bea-titel-kopf").textContent = t.titel || "Termin";
          document.getElementById("bea-ort").value = t.ort || "";
          document.getElementById("bea-tag").value = (t.start || "").slice(0, 10);
          document.getElementById("bea-von").value = (t.start || "").slice(11, 16);
          document.getElementById("bea-bis").value = (t.ende || "").slice(11, 16);
          document.getElementById("bea-zeiten").style.display = t.ganztags ? "none" : "";
          document.getElementById("bea-wann").textContent = t.ganztags
            ? "ganztägig am " + (t.start || "").slice(0, 10)
            : (t.start || "").slice(0, 10) + " · " + (t.start || "").slice(11, 16) +
              ((t.ende || "").slice(11, 16) ? "–" + (t.ende || "").slice(11, 16) : "");
          document.getElementById("bea-hinweis").textContent = t.id
            ? "Änderungen gehen sofort in den Google Kalender."
            : "Dieser Termin hat keine ID — er lässt sich nur im Google Kalender selbst ändern.";
          document.getElementById("dlg-bearbeiten").showModal();
        }

        // Ein Zuhoerer fuer die ganze Seite statt einer je Zelle — im
        // Monatsraster sind das sonst schnell 200 Handler. Der Termin gewinnt
        // gegen die Zelle darunter (closest findet ihn zuerst).
        document.addEventListener("click", function(ev){
          if (ev.target.closest("a, dialog")) return;
          var t = ev.target.closest("[data-i]");
          if (t) { bearbeitenOeffnen(Number(t.getAttribute("data-i"))); return; }
          var n = ev.target.closest("[data-neu]");
          if (n) {
            var s = n.getAttribute("data-stunde");
            neuOeffnen(n.getAttribute("data-neu"), s === null ? undefined : Number(s));
          }
        });

        // Die rote Jetzt-Linie — das eine Element, an dem man einen Kalender
        // sofort erkennt. Nur zeichnen, wenn heute ueberhaupt sichtbar ist.
        (function(){
          var linie = document.getElementById("gk-jetzt");
          var rollen = document.getElementById("gk-rollen");
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

  // Rohe Fehler von gws-cli sind fuer niemanden zu gebrauchen. Die zwei
  // haeufigen bekommen Klartext, alles andere geht unveraendert durch.
  function lesbar(grund) {
    if (/ENOENT|not found|command not found/i.test(grund)) {
      return "Auf dieser Maschine besteht keine Verbindung zu Google — gws-cli und Token liegen auf dem Server.";
    }
    if (/invalid_grant|token|credential|unauthor/i.test(grund)) {
      return "Google hat die Anmeldung abgelehnt — das Token ist abgelaufen und muss neu geholt werden. (" + grund.slice(0, 120) + ")";
    }
    return grund;
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

  app.post("/kalender/neu", formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const tag = kal.tagOderHeute(b.tag);
      const ganztags = b.ganztags === "1";
      const bisTag = /^\d{4}-\d{2}-\d{2}$/.test(String(b.tag_bis || "")) && b.tag_bis >= tag ? b.tag_bis : tag;
      const zeit = (w, ersatz) => (/^\d{2}:\d{2}$/.test(String(w || "")) ? w : ersatz);

      const r = await kal.terminEintragen({
        titel: b.titel,
        start: ganztags ? tag : `${tag}T${zeit(b.von, "09:00")}`,
        ende: ganztags ? bisTag : `${bisTag}T${zeit(b.bis, "10:00")}`,
        ganztags,
        ort: b.ort || "",
        beschreibung: b.beschreibung || "",
      });
      fertig(res, b, r);
    } catch (err) { next(err); }
  });

  app.post("/kalender/aendern", formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      if (!b.id) return fertig(res, b, { ok: false, grund: "Termin ohne ID — nur in Google änderbar." });
      const tag = /^\d{4}-\d{2}-\d{2}$/.test(String(b.tag || "")) ? b.tag : null;
      const hatZeit = /^\d{2}:\d{2}$/.test(String(b.von || ""));

      const r = await kal.terminAendern({
        id: b.id,
        titel: b.titel || undefined,
        // Nur schicken, was wirklich bestimmbar ist: terminAendern verlangt zu
        // einem neuen Start auch ein Ende, sonst bliebe das alte stehen und der
        // Termin waere ploetzlich Stunden lang.
        start: tag && hatZeit ? `${tag}T${b.von}` : undefined,
        ende: tag && /^\d{2}:\d{2}$/.test(String(b.bis || "")) ? `${tag}T${b.bis}` : undefined,
        ort: b.ort || undefined,
      });
      fertig(res, b, r);
    } catch (err) { next(err); }
  });

  app.post("/kalender/absagen", formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const r = await kal.terminAbsagen({ id: b.id });
      fertig(res, b, r);
    } catch (err) { next(err); }
  });
};
