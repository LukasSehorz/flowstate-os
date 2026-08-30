/* =====================================================================
   WHITEBOARD — die Tafelwand des OS (Client, rendert in #wb-wurzel)
   =====================================================================

   Eine Wand mit einer Tafel je Person (Reihenfolge = WB_DATEN.team),
   Zoom und Pan wie an einer echten Buerowand: herantreten, schreiben,
   abhaken, wegwischen. Geschrieben wird NUR auf der eigenen Tafel,
   gesehen wird alles — Konflikte zwischen zwei Personen gibt es darum
   nicht, nur "dieselbe Person in zwei Tabs" (dafuer die Versionspruefung
   der API).

   Die drei Ebenen, von hinten nach vorn:
     1. DOM-Buehne (.wb-buehne)  — Boards, Textbloecke, Haftnotizen.
        DOM, damit Text bei jedem Zoom scharf bleibt und die Bearbeitung
        nativ ist (Caret, Auswahl, IME).
     2. Tinten-Canvas (.wb-tinte) — ALLE Striche, viewportgross, UEBER
        der Buehne: der Marker malt ueber Notizen, wie am echten Board.
     3. Chrome (Kopf, Werkzeugleiste, Toasts) — bildschirmfest.

   Der Transform-Kern: EIN Objekt ansicht={s,tx,ty} (Schirm = Welt*s+t).
   anwenden() schreibt pro rAF-Tick BEIDES — CSS-Transform der Buehne
   und ctx.setTransform des Canvas — damit die Ebenen nie driften.
   Fit-Animationen tweenen dieses Objekt per GSAP, nie per CSS-Transition
   (zwei Interpolatoren = zwei Wahrheiten = sichtbares Auseinanderlaufen).

   Performance-Regeln (gemessen erprobt in jarvis-gehirn.js):
   - Dirty-Flag: gezeichnet wird nur, wenn sich etwas geaendert hat.
   - Waehrend Pan/Zoom KEIN Vektor-Redraw: einmal Schnappschuss, dann
     pro Frame ein einziges drawImage; 120 ms nach der letzten Bewegung
     ein scharfer Voll-Redraw.
   - Path2D-Cache je Strich, Viewport-Culling ueber die Bounding-Box,
     Notbremse ab ~20,5 ms Framezeit (vereinfachtes Zeichnen, bounded).

   Speichern ist optimistisch: erst anzeigen, dann POST; scheitert es,
   sagt ein Toast Bescheid, und bei wiederholtem harten Fehler laedt die
   Seite neu (Hauskonvention). pagehide flusht per sendBeacon.
   ===================================================================== */

(function () {
  "use strict";

  const wurzel = document.getElementById("wb-wurzel");
  const DATEN = window.WB_DATEN;
  if (!wurzel || !DATEN || !DATEN.ich) return;

  const gsap = window.gsap || null;
  const sanft = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const istMobil = () => window.matchMedia("(max-width: 860px)").matches;

  // ------------------------------------------------------------ Konstanten

  const BOARD_B = 2400, BOARD_H = 1400;   // Welteinheiten je Tafel
  const LUECKE = 260;                      // Wandabstand zwischen zwei Tafeln
  const LUECKE_Y = 360;                    // Reihenabstand: Ablage unten (78) + Schild oben (~120) + Luft
  const ZOOM_MAX = 3;
  const ZOOM_TEXT_MIN = 0.35;              // darunter: kein In-Place-Editieren
  const DICKEN = { fein: 3, mittel: 6, breit: 11 };
  const GROESSEN = [20, 28, 40];
  const FARBNAMEN = ["schwarz", "blau", "rot", "gruen", "orange", "lila"];
  const ZETTELNAMEN = ["gelb", "rosa", "mint", "blau"];
  const MAX_PUNKTE_JE_STRICH = 2900;       // Stuetzpunkte; Server erlaubt 3000 (6000 Zahlen)
  const SCHWAMM_RADIUS_PX = 18;            // Bildschirm-px, wird durch s geteilt

  // Tintenfarben: EINE Palette fuer alle Themes. Die Tafel bleibt auch im
  // Dunkelmodus hell — das dunkle Haus-Blau #4B8DF8 ist fuer dunkle
  // Untergruende gedacht und faellt auf der hellen Tafel auf 2,5:1 ab
  // (gemessen). Das Chrom wechselt mit dem Theme, die Tinte nie.
  const TINTE_HELL = { schwarz: "#2B3036", blau: "#2563EB", rot: "#C03B3B", gruen: "#2E8555", orange: "#C26E1E", lila: "#7A4FB6" };
  const tinte = (name) => TINTE_HELL[name] || TINTE_HELL.schwarz;

  // ------------------------------------------------------------ Zustand

  const ich = DATEN.ich;
  const team = Array.isArray(DATEN.team) && DATEN.team.length ? DATEN.team : [ich];

  // Wandversatz je Besitzer. Ab vier Personen haengt die Wand ZWEIREIHIG
  // (zeilenweise in team-Reihenfolge, bei fuenf also 3 oben + 2 unten):
  // einreihig laegen zwei Drittel des Bildschirms brach und "Alle" zeigte
  // nur Briefmarken. Die Reihen sind reine Wandgeometrie des Clients —
  // Element-Koordinaten bleiben board-relativ.
  const jeReihe = team.length > 3 ? Math.ceil(team.length / 2) : team.length;
  const versatz = new Map();               // besitzerId -> x der Tafel
  const versatzY = new Map();              // besitzerId -> y der Tafel
  team.forEach((p, i) => {
    versatz.set(p.id, (i % jeReihe) * (BOARD_B + LUECKE));
    versatzY.set(p.id, Math.floor(i / jeReihe) * (BOARD_H + LUECKE_Y));
  });
  const reihen = Math.ceil(team.length / jeReihe);
  const spalten = Math.min(team.length, jeReihe);
  const WAND_B = spalten * BOARD_B + (spalten - 1) * LUECKE;
  const WAND_H = reihen * BOARD_H + (reihen - 1) * LUECKE_Y;

  const elemente = new Map();              // id -> Element (inhalt als Objekt)
  const stricheJeBoard = new Map();        // besitzerId -> [Element] in Zeichenreihenfolge
  team.forEach((p) => stricheJeBoard.set(p.id, []));

  const ansicht = { s: 0.5, tx: 0, ty: 0 };
  let werkzeug = "auswahl";                // auswahl | stift | text | notiz | schwamm
  let stiftFarbe = "schwarz";
  let stiftDicke = "mittel";
  let zettelFarbe = "gelb";
  const auswahl = new Set();               // ids gewaehlter eigener Elemente

  // Elemente, die der Sync NICHT anfassen darf: gerade im Editor, gerade
  // im Drag, oder mit laufendem/ausstehendem POST. Der Poll ueberspringt
  // sie — sonst wuerde die eigene Zweitsitzung einem den Cursor unterm
  // Finger wegziehen.
  const inArbeit = new Set();

  let anwesend = new Set(DATEN.anwesend || []);
  const aktivitaet = new Map();            // besitzer -> ISO letzte Aenderung
  (DATEN.aktivitaet || []).forEach((a) => aktivitaet.set(a.besitzer, a.letzte));

  // ------------------------------------------------------------ Werkzeugkasten

  const $ = (sel, el) => (el || wurzel).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || wurzel).querySelectorAll(sel));

  // Stabiler Hash aus einer id — fuer die Zufallsrotation der Zettel.
  // Muss bei jedem Laden gleich ausfallen, sonst "zittert" die Wand.
  function idHash(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }
  const zettelDrehung = (id) => ((idHash(id) * 4) - 2).toFixed(2) + "deg";

  const klemm = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Deutsch, relativ, fuers Namensschild.
  function relativeZeit(iso) {
    if (!iso) return "noch nichts notiert";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "";
    const d = Date.now() - t;
    if (d < 90 * 1000) return "gerade eben";
    if (d < 3600 * 1000) return "vor " + Math.round(d / 60000) + " Min.";
    if (d < 24 * 3600 * 1000) { const h = Math.round(d / 3600000); return "vor " + h + " Std."; }
    const tage = Math.round(d / (24 * 3600 * 1000));
    if (tage === 1) return "gestern";
    if (tage < 30) return "vor " + tage + " Tagen";
    return "am " + new Date(t).toLocaleDateString("de-DE", { day: "numeric", month: "short" });
  }

  const rollenWort = (rolle) => (rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter");

  // Kleine Inline-Icons im Hausstil (Strichstaerke 1.8, currentColor).
  const S = (d, b) => `<svg viewBox="0 0 ${b || 24} ${b || 24}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    auswahl: S('<path d="M5 3l14 8-6.5 1.5L9 19z"/>'),
    stift: S('<path d="M14.5 4.5 19.5 9.5 8 21H3v-5z"/><path d="m12.5 6.5 5 5"/>'),
    text: S('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
    notiz: S('<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>'),
    schwamm: S('<path d="M4 15 13.5 5.5a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L9 20H5.5L4 18.5z"/><path d="m11 8 5 5M4 20h16"/>'),
    zurueck: S('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    vor: S('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>'),
    minus: S('<path d="M5 12h14"/>'),
    fit: S('<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
    frage: S('<circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.9 2.9 0 0 1 5.6 1c0 1.8-2.6 2.2-2.6 4"/><path d="M12 17.6h.01"/>'),
    strich: S('<path d="M5 12h14M8 7c2.5 1.2 5.5 1.2 8 0M8 17c2.5-1.2 5.5-1.2 8 0"/>'),
    weg: S('<path d="M4 7h16M10 4h4M7 7l1 13h8l1-13M10 11v5M14 11v5"/>'),
    wisch: S('<path d="M5 14 14 5a2 2 0 0 1 2.8 0L19 7.2a2 2 0 0 1 0 2.8L10 19H6l-1-1z"/><path d="m12 7 5 5"/>'),
    griff: S('<circle cx="9" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="17" r="1.2"/><circle cx="15" cy="17" r="1.2"/>'),
    listeKeine: S('<path d="M5 7h14M5 12h14M5 17h9"/>'),
    listeZahl: S('<path d="M10 7h9M10 12h9M10 17h9"/><path d="M5.5 5.5 6.5 5v4M5 16.5c0-.8.7-1.5 1.5-1.5s1.4.6 1.4 1.3c0 1.2-2.9 1.7-2.9 2.7h3"/>', 24),
    listeBuchstabe: S('<path d="M10 7h9M10 12h9M10 17h9"/><path d="M4.5 9.5 6 5l1.5 4.5M5 8h2"/><path d="M4.7 14.5h1.6a1.2 1.2 0 0 1 0 2.4H4.7zM4.7 16.9h1.9a1.2 1.2 0 0 1 0 2.4H4.7z"/>', 24),
    listePunkt: S('<path d="M10 7h9M10 12h9M10 17h9"/><circle cx="5.5" cy="7" r="1.4" fill="currentColor" stroke="none"/><circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="5.5" cy="17" r="1.4" fill="currentColor" stroke="none"/>'),
    listeCheck: S('<path d="M11 7h8M11 12h8M11 17h8"/><path d="m4 6.5 1.4 1.4L8 5.4M4 11.5l1.4 1.4L8 10.4M4 16.5l1.4 1.4L8 15.4"/>'),
  };

  // Escaping ist hier KEIN Thema der Vorsicht, sondern der Regel: Nutzdaten
  // landen ausschliesslich per textContent im DOM. innerHTML gibt es nur
  // fuer statische, hier im Code stehende Vorlagen.

  // =================================================================
  // DOM-Geruest
  // =================================================================
  //
  // Alles statische Markup entsteht hier einmal; Nutzdaten (Namen,
  // Zeilentexte) werden danach ausschliesslich per textContent gesetzt.

  wurzel.innerHTML = `
    <div class="wb-raum">
      <div class="wb-flaeche" data-werkzeug="auswahl">
        <div class="wb-buehne"></div>
        <canvas class="wb-tinte"></canvas>
        <div class="wb-marquee" hidden></div>
        <div class="wb-schwammkreis" hidden></div>
      </div>
      ${/* Die Leiste steht im DOM VOR der Kopfzeile: Tab laeuft dann
            Werkzeuge -> Ansichten -> Zoom. Beide sind absolut
            positioniert, optisch aendert die Reihenfolge nichts. */""}
      <div class="wb-leiste" role="toolbar" aria-label="Werkzeuge">
        <button type="button" class="wb-knopf" data-werkzeug="auswahl" data-tip="Auswahl (V)" aria-label="Auswahl">${ICON.auswahl}</button>
        <button type="button" class="wb-knopf" data-werkzeug="stift" data-tip="Stift (S)" aria-label="Stift">${ICON.stift}</button>
        <button type="button" class="wb-knopf" data-werkzeug="text" data-tip="Text (T)" aria-label="Text">${ICON.text}</button>
        <button type="button" class="wb-knopf" data-werkzeug="notiz" data-tip="Haftnotiz (N)" aria-label="Haftnotiz">${ICON.notiz}</button>
        <button type="button" class="wb-knopf" data-werkzeug="schwamm" data-tip="Schwamm (E)" aria-label="Schwamm">${ICON.schwamm}</button>
        <div class="wb-leiste-trenner"></div>
        <div class="wb-kontext wb-kontext-stift" hidden>
          <div class="wb-kontext-farben"></div>
          <div class="wb-leiste-trenner"></div>
          <div class="wb-kontext-dicken"></div>
        </div>
        <div class="wb-kontext wb-kontext-notiz" hidden></div>
        <div class="wb-leiste-trenner wb-kontext-trenner" hidden></div>
        <button type="button" class="wb-knopf wb-undo" data-tip="Rückgängig (Strg+Z)" aria-label="Rückgängig" disabled>${ICON.zurueck}</button>
        <button type="button" class="wb-knopf wb-redo" data-tip="Wiederholen (Strg+Y)" aria-label="Wiederholen" disabled>${ICON.vor}</button>
        <div class="wb-leiste-trenner"></div>
        <button type="button" class="wb-knopf wb-hilfe-knopf" data-tip="Tastenkürzel (?)" aria-label="Tastenkürzel">${ICON.frage}</button>
      </div>
      <div class="wb-kopf">
        <div class="wb-segmente" role="tablist" aria-label="Ansicht"></div>
        <div class="wb-zoomgruppe">
          <button type="button" class="wb-zoom-raus" data-tip="Herauszoomen (−)" aria-label="Herauszoomen">${ICON.minus}</button>
          <button type="button" class="wb-zoom-stand" data-tip="Auf 100 % (1)" aria-label="Zoom auf 100 Prozent">100&nbsp;%</button>
          <button type="button" class="wb-zoom-rein" data-tip="Hineinzoomen (+)" aria-label="Hineinzoomen">${ICON.plus}</button>
          <button type="button" class="wb-zoom-fit" data-tip="Alles zeigen (0)" aria-label="Alles zeigen">${ICON.fit}</button>
        </div>
      </div>
      <div class="wb-hilfe" hidden>
        <h3>Tastenkürzel</h3>
        <dl>
          ${/* Kurzer Begriff, sonst bricht die Zeile um; die Zuordnung
                V=Auswahl usw. steht in den Tooltips der Leiste. */""}
          <dt>Werkzeuge wechseln</dt><dd><kbd>V</kbd><kbd>S</kbd><kbd>T</kbd><kbd>N</kbd><kbd>E</kbd></dd>
          <dt>Zoom auf den Mauszeiger</dt><dd><kbd>Rad</kbd></dd>
          <dt>Seitwärts an der Wand entlang</dt><dd><kbd>Shift</kbd>+<kbd>Rad</kbd></dd>
          <dt>Wand verschieben</dt><dd><kbd>Leertaste</kbd>+Ziehen</dd>
          <dt>Rückgängig / Wiederholen</dt><dd><kbd>Strg</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></dd>
          <dt>Auswahl löschen</dt><dd><kbd>Entf</kbd></dd>
          <dt>Zoom · 100 % · alles zeigen</dt><dd><kbd>+</kbd><kbd>−</kbd> · <kbd>1</kbd> · <kbd>0</kbd></dd>
          <dt>Text bearbeiten</dt><dd>Doppelklick</dd>
        </dl>
      </div>
      <div class="wb-toasts"></div>
      <dialog class="wb-dialog wb-wischen-dialog">
        <h2>Tafel wischen?</h2>
        <div class="sub wb-wischen-text">Damit verschwindet alles von deiner Tafel.</div>
        <div class="dialog-fuss">
          <button type="button" class="sekundaer wb-wischen-nein">Abbrechen</button>
          <button type="button" class="gefahr wb-wischen-ja">Tafel wischen</button>
        </div>
      </dialog>
      <div class="wb-anmelden" hidden>
        <div class="wb-anmelden-karte">
          <h2>Sitzung abgelaufen</h2>
          <p>Deine Anmeldung ist abgelaufen — die Tafel kann nicht mehr speichern.</p>
          <a href="/crm/anmelden">Neu anmelden</a>
        </div>
      </div>
    </div>`;

  const raum = $(".wb-raum");
  const flaeche = $(".wb-flaeche");
  const buehne = $(".wb-buehne");
  const leinwand = $(".wb-tinte");
  const ctx = leinwand.getContext("2d");
  const marqueeEl = $(".wb-marquee");
  const schwammKreis = $(".wb-schwammkreis");
  const toastsEl = $(".wb-toasts");

  // Farb- und Dickenwahl in der Leiste fuellen (Kontext des Stifts).
  (function kontexteFuellen() {
    const farben = $(".wb-kontext-farben");
    FARBNAMEN.forEach((name) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "wb-farbe"; b.dataset.farbe = name;
      b.style.setProperty("--f", tinte(name));
      b.setAttribute("aria-label", "Farbe " + name);
      farben.appendChild(b);
    });
    const dicken = $(".wb-kontext-dicken");
    Object.keys(DICKEN).forEach((name) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "wb-dicke"; b.dataset.dicke = name;
      b.setAttribute("aria-label", "Strichstärke " + name);
      b.setAttribute("data-tip", name === "fein" ? "fein" : name === "mittel" ? "mittel" : "breit");
      const i = document.createElement("i");
      const d = Math.max(3, Math.round(DICKEN[name] * 0.9));
      i.style.width = "16px"; i.style.height = d + "px";
      b.appendChild(i);
      dicken.appendChild(b);
    });
    const zettel = $(".wb-kontext-notiz");
    ZETTELNAMEN.forEach((name) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "wb-zettelwahl"; b.dataset.zettel = name;
      b.style.setProperty("--z", "var(--wb-zettel-" + name + ")");
      b.setAttribute("aria-label", "Zettelfarbe " + name);
      zettel.appendChild(b);
    });
  })();

  // =================================================================
  // Die Boards an der Wand
  // =================================================================

  const boardKnoten = new Map();           // besitzerId -> {wrap, inhalt, schild:{...}, leer}

  function boardBauen(person) {
    const eigen = person.id === ich.id;
    const wrap = document.createElement("div");
    wrap.className = "wb-board" + (eigen ? " wb-eigen" : "");
    wrap.dataset.besitzer = person.id;
    wrap.style.left = versatz.get(person.id) + "px";
    wrap.style.top = versatzY.get(person.id) + "px";
    wrap.style.width = BOARD_B + "px";
    wrap.style.height = BOARD_H + "px";

    wrap.innerHTML = `
      <div class="wb-rahmen"></div>
      <div class="wb-tafelflaeche"></div>
      <div class="wb-glanz"></div>
      <div class="wb-inhaltsebene"></div>
      <div class="wb-leerhinweis" hidden>
        <span></span>
        ${S('<path d="M10 6c-4 10 0 24 12 32 6 4 12 6 16 7" stroke-width="2.2"/><path d="m30 40 8.5 5.5L28 49" stroke-width="2.2"/>', 56)}
      </div>
      <div class="wb-schild">
        <span class="wb-schild-punkt"></span>
        <span>
          <span class="wb-schild-name"></span>
          <span class="wb-schild-unter"></span>
        </span>
      </div>
      <div class="wb-ablage"></div>`;

    $(".wb-schild-name", wrap).textContent = person.name;
    $(".wb-leerhinweis span", wrap).textContent = eigen
      ? "Nimm dir einen Stift aus der Ablage und leg los."
      : "Hier steht noch nichts.";

    // Die Ablage: sechs Marker + Schwamm. Am eigenen Board sind sie der
    // Farb- und Werkzeugwaehler, an fremden liegen sie nur da (CSS nimmt
    // ihnen die pointer-events).
    const ablage = $(".wb-ablage", wrap);
    FARBNAMEN.forEach((name) => {
      const m = document.createElement("button");
      m.type = "button"; m.className = "wb-marker"; m.dataset.farbe = name;
      m.style.setProperty("--mf", tinte(name));
      m.setAttribute("aria-label", "Stift " + name);
      if (eigen) m.setAttribute("data-tip", "Stift: " + name);
      // Nicht in der Tab-Reihenfolge: fremde Ablagen sind Deko, und die
      // eigene doppelt nur die Leisten-Chips — Tastatur waehlt dort.
      m.tabIndex = -1;
      ablage.appendChild(m);
    });
    const sw = document.createElement("button");
    sw.type = "button"; sw.className = "wb-schwammknopf";
    sw.setAttribute("aria-label", "Schwamm");
    if (eigen) sw.setAttribute("data-tip", "Schwamm (E)");
    sw.tabIndex = -1;
    ablage.appendChild(sw);

    if (eigen) {
      const wk = document.createElement("button");
      wk.type = "button"; wk.className = "wb-wischenknopf";
      wk.innerHTML = ICON.wisch + "<span>Tafel wischen</span>";
      wrap.appendChild(wk);
      wk.addEventListener("click", wischenFragen);
      ablage.addEventListener("click", (ev) => {
        const marker = ev.target.closest(".wb-marker");
        if (marker) { stiftWaehlen(marker.dataset.farbe); return; }
        if (ev.target.closest(".wb-schwammknopf")) werkzeugSetzen("schwamm");
      });
    }

    buehne.appendChild(wrap);
    boardKnoten.set(person.id, {
      wrap,
      inhalt: $(".wb-inhaltsebene", wrap),
      leer: $(".wb-leerhinweis", wrap),
      punkt: $(".wb-schild-punkt", wrap),
      unter: $(".wb-schild-unter", wrap),
      ablage,
    });
  }
  team.forEach(boardBauen);

  // Namensschilder: Rolle, Fortschritt (nur ☐-Zeilen), zuletzt aktiv,
  // Anwesenheits-Punkt. Wird nach jedem Poll und jeder Aenderung genaehrt.
  function schilderAuffrischen() {
    for (const person of team) {
      const k = boardKnoten.get(person.id);
      if (!k) continue;
      let gesamt = 0, erledigt = 0, anzahl = 0;
      for (const el of elemente.values()) {
        if (el.besitzer !== person.id) continue;
        anzahl++;
        if ((el.art === "text" || el.art === "notiz") && el.inhalt.liste === "check") {
          for (const z of el.inhalt.zeilen) { gesamt++; if (z.erledigt) erledigt++; }
        }
      }
      const da = anwesend.has(person.id);
      k.punkt.classList.toggle("wb-da", da);
      k.unter.textContent = "";
      k.unter.append(rollenWort(person.rolle));
      if (gesamt) {
        k.unter.append(" · ");
        const b = document.createElement("b");
        b.textContent = erledigt + " von " + gesamt + " erledigt";
        k.unter.append(b);
      }
      k.unter.append(" · " + (da ? "gerade aktiv" : relativeZeit(aktivitaet.get(person.id))));
      k.leer.hidden = anzahl > 0;
    }
  }

  // =================================================================
  // Transform-Kern: EINE Wahrheit fuer DOM und Canvas
  // =================================================================

  let dpr = 1;
  let breite = 0, hoehe = 0;               // CSS-Groesse der Flaeche
  let flaecheRect = null;                  // gecachtes getBoundingClientRect
  const rectHolen = () => flaecheRect || (flaecheRect = flaeche.getBoundingClientRect());

  // Schnappschuss-Puffer fuer Pan/Zoom-Gesten.
  const puffer = document.createElement("canvas");
  const pufferCtx = puffer.getContext("2d");
  let gesteAktiv = 0;                      // >0: nur drawImage, kein Vektor-Redraw
  const schnapp = { s: 1, tx: 0, ty: 0, breit: 0, hoch: 0 };
  let scharfTimer = 0;

  let tintenDirty = true;                  // Canvas neu zeichnen?
  let buehneDirty = true;                  // CSS-Transform neu schreiben?
  let rafId = 0;

  function zeichnenAnfordern() {
    if (rafId || document.hidden) return;
    rafId = requestAnimationFrame(tick);
  }

  function anwenden() { buehneDirty = true; tintenDirty = true; zeichnenAnfordern(); zoomAnzeigen(); }

  // Gegen-Skalierung der Schilder (Uebersicht) und des Block-Kastens
  // (immer bildschirmgross). Als CSS-Variablen einmal pro Frame gesetzt.
  function variablenSetzen() {
    const gegen = klemm(0.5 / ansicht.s, 1, 3.6);
    buehne.style.setProperty("--wb-gegen", gegen.toFixed(4));
    // Der Wischen-Knopf ist ein ZIEL, kein Schild: er kompensiert
    // staerker (Boden 0,75 statt 0,5), damit seine Trefferflaeche auch
    // in der Tafel-Ansicht ueber ~40 Bildschirm-px bleibt.
    buehne.style.setProperty("--wb-gegen2", klemm(0.75 / ansicht.s, 1, 4.2).toFixed(4));
    buehne.style.setProperty("--wb-anti", (1 / ansicht.s).toFixed(4));
    // Zeilen-Tools (Streichen/Papierkorb): exakt gegen den Zoom, damit
    // sie auf dem Schirm immer so gross sind wie bei 100 % (bei 300 %
    // waren sie sonst ~90-px-Riesen neben dem Block). Gedeckelt bei
    // 1/ZOOM_TEXT_MIN: unterhalb der Editier-Grenze schrumpfen sie
    // wieder mit — riesige Knoepfe an einer briefmarkenkleinen Tafel
    // waeren schlimmer als kleine.
    buehne.style.setProperty("--wb-anti2", klemm(1 / ansicht.s, 1 / ZOOM_MAX, 1 / ZOOM_TEXT_MIN).toFixed(4));
  }

  function tick() {
    rafId = 0;
    if (buehneDirty) {
      buehneDirty = false;
      // translate VOR scale — dieselbe Reihenfolge wie im setTransform des
      // Canvas. Andersherum waere t in Weltkoordinaten und beide Ebenen
      // laegen bei jedem Zoom woanders.
      buehne.style.transform = "translate(" + ansicht.tx + "px," + ansicht.ty + "px) scale(" + ansicht.s + ")";
      variablenSetzen();
    }
    if (tintenDirty) {
      tintenDirty = false;
      if (gesteAktiv) schnappschussZeichnen();
      else vollZeichnen();
    }
  }

  // ------------------------------------------------------------ Messen/DPR

  function messen() {
    const r = raum.getBoundingClientRect();
    breite = Math.max(1, Math.round(r.width));
    hoehe = Math.max(1, Math.round(r.height));
    // Deckel bei 2,5: Tinte gewinnt oberhalb davon nichts Sichtbares mehr,
    // die Fuellflaeche (und damit die Redraw-Zeit) waechst aber quadratisch.
    // Der Text bleibt DOM und rendert weiterhin in voller Aufloesung.
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    leinwand.width = Math.round(breite * dpr);
    leinwand.height = Math.round(hoehe * dpr);
    leinwand.style.width = breite + "px";
    leinwand.style.height = hoehe + "px";
    flaecheRect = null;
    // Stand der Nutzer auf einem unveraenderten Ansichts-Fit, wird der
    // Fit auf die neue Fenstergroesse neu angewendet — sonst bleibt die
    // Tafel nach jedem Resize angeschnitten stehen. Ohne Tween: ein
    // Resize ist keine Kamerafahrt.
    if (ansichtPassend) {
      if (fitTween) { fitTween.kill(); fitTween = null; gesteBeenden(); }
      const r = ansichtRechteck(ansichtWahl);
      if (r) {
        const ziel = fitZiel(r.x, r.y, r.b, r.h, undefined, fitLuftDeckel(ansichtWahl));
        ansicht.s = ziel.s; ansicht.tx = ziel.tx; ansicht.ty = ziel.ty;
      }
    }
    zoomKlemmen();
    anwenden();
  }

  // DPR-Wechsel (Monitorwechsel, Strg±) faengt matchMedia ab: die Abfrage
  // gilt genau fuer den aktuellen Wert und feuert einmal, wenn er kippt —
  // dann neu vermessen und die Beobachtung neu aufsetzen.
  function dprBeobachten() {
    try {
      const mq = window.matchMedia("(resolution: " + (window.devicePixelRatio || 1) + "dppx)");
      const neu = () => { messen(); dprBeobachten(); };
      if (mq.addEventListener) mq.addEventListener("change", neu, { once: true });
      else mq.addListener(neu);
    } catch { /* alte Engine: resize deckt das meiste ab */ }
  }

  new ResizeObserver(() => messen()).observe(raum);
  window.addEventListener("resize", () => { flaecheRect = null; });
  dprBeobachten();

  // ------------------------------------------------------------ Koordinaten

  const schirmZuWelt = (sx, sy) => ({ x: (sx - ansicht.tx) / ansicht.s, y: (sy - ansicht.ty) / ansicht.s });
  const ereignisZuSchirm = (ev) => {
    const r = rectHolen();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const ereignisZuWelt = (ev) => { const p = ereignisZuSchirm(ev); return schirmZuWelt(p.x, p.y); };

  // Auf welchem Board liegt ein Weltpunkt? (null = Wand/Luecke)
  function boardAnPunkt(w) {
    for (const p of team) {
      const x0 = versatz.get(p.id), y0 = versatzY.get(p.id);
      if (w.x >= x0 && w.x <= x0 + BOARD_B && w.y >= y0 && w.y <= y0 + BOARD_H) return p.id;
    }
    return null;
  }

  const minZoom = () => Math.min((breite - 120) / WAND_B, (hoehe - 200) / WAND_H, 1) * 0.98;

  // Pan-Klemme: Die Wand darf nie ganz aus dem Bild rutschen — mindestens
  // 140 Schirm-px bleiben immer sichtbar.
  function panKlemmen() {
    const M = 140;
    const wandB = WAND_B * ansicht.s, wandH = WAND_H * ansicht.s;
    ansicht.tx = klemm(ansicht.tx, M - wandB, breite - M);
    ansicht.ty = klemm(ansicht.ty, M - wandH, hoehe - M);
  }
  function zoomKlemmen() {
    if (!breite) return;
    ansicht.s = klemm(ansicht.s, Math.max(0.02, minZoom()), ZOOM_MAX);
    panKlemmen();
  }

  // Nach Gestenende auf ganze Geraetepixel snappen: ein Transform, das auf
  // einem Drittel-Pixel steht, macht jede Textkante milchig.
  function aufPixelSnappen() {
    ansicht.tx = Math.round(ansicht.tx * dpr) / dpr;
    ansicht.ty = Math.round(ansicht.ty * dpr) / dpr;
    anwenden();
  }

  // ------------------------------------------------------------ Gesten-Puffer

  function gesteBeginnen() {
    if (gesteAktiv++ === 0) {
      // Schnappschuss des aktuellen Canvas-Inhalts in Geraetepixeln.
      puffer.width = leinwand.width; puffer.height = leinwand.height;
      pufferCtx.clearRect(0, 0, puffer.width, puffer.height);
      pufferCtx.drawImage(leinwand, 0, 0);
      schnapp.s = ansicht.s; schnapp.tx = ansicht.tx; schnapp.ty = ansicht.ty;
      schnapp.breit = leinwand.width; schnapp.hoch = leinwand.height;
    }
    if (scharfTimer) { clearTimeout(scharfTimer); scharfTimer = 0; }
  }

  // EIN gemeinsamer "jetzt wieder scharf"-Handler fuer alle Gestenarten:
  // er raeumt auch eine noch offene Rad-Geste ab. Zwei getrennte Timer
  // hatten in einem Zwischenstand die Radgeste haengen lassen — die Wand
  // blieb dann dauerhaft im (unscharfen) Blit-Modus.
  let radGeste = false;
  function scharfMachen() {
    scharfTimer = 0;
    if (radGeste) { radGeste = false; gesteAktiv = Math.max(0, gesteAktiv - 1); }
    if (gesteAktiv === 0) aufPixelSnappen();
  }

  function gesteBeenden() {
    if (gesteAktiv > 0) gesteAktiv--;
    if (gesteAktiv - (radGeste ? 1 : 0) <= 0) {
      // Nicht sofort scharf zeichnen: bei schnellen Radstoessen kommt die
      // naechste Geste in Millisekunden — 120 ms Ruhe reichen fuers Auge.
      if (scharfTimer) clearTimeout(scharfTimer);
      scharfTimer = setTimeout(scharfMachen, 120);
    }
  }

  // Eine "fluechtige" Geste fuer Einzel-Ereignisse (Radzoom): kurz in den
  // Gestenmodus, der gemeinsame Timer beendet sie.
  function radGesteAnstossen() {
    if (!radGeste) { radGeste = true; gesteBeginnen(); }
    if (scharfTimer) clearTimeout(scharfTimer);
    scharfTimer = setTimeout(scharfMachen, 120);
  }

  function schnappschussZeichnen() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, leinwand.width, leinwand.height);
    const f = ansicht.s / schnapp.s;
    // Geraetepixel p im Schnappschuss -> Welt -> neue Schirmlage. Ergibt
    // exakt: p' = p*f + (t_neu - t_alt*f)*dpr.
    ctx.setTransform(f, 0, 0, f, (ansicht.tx - schnapp.tx * f) * dpr, (ansicht.ty - schnapp.ty * f) * dpr);
    ctx.drawImage(puffer, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // =================================================================
  // Tinte: Path-Cache, Culling, Voll-Redraw, Notbremse
  // =================================================================

  // Der Pfad eines Strichs wird EINMAL gebaut (beim Laden bzw. bei
  // pointerup) und in Weltkoordinaten gecacht — der Wandversatz des
  // Besitzers ist eingebacken. Midpoint-Quadratic glaettet die Kette.
  function strichPfadBauen(el, grob) {
    const p = el.inhalt.punkte;
    const vx = versatz.get(el.besitzer) || 0;
    const vy = versatzY.get(el.besitzer) || 0;
    const pfad = new Path2D();
    if (p.length < 4) return pfad;
    pfad.moveTo(p[0] + vx, p[1] + vy);
    if (grob || p.length < 8) {
      for (let i = 2; i < p.length; i += 2) pfad.lineTo(p[i] + vx, p[i + 1] + vy);
      return pfad;
    }
    for (let i = 2; i < p.length - 2; i += 2) {
      pfad.quadraticCurveTo(p[i] + vx, p[i + 1] + vy,
        (p[i] + p[i + 2]) / 2 + vx, (p[i + 1] + p[i + 3]) / 2 + vy);
    }
    pfad.lineTo(p[p.length - 2] + vx, p[p.length - 1] + vy);
    return pfad;
  }
  const pfadVon = (el) => el._pfad || (el._pfad = strichPfadBauen(el, false));

  function strichBbox(punkte, dicke) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < punkte.length; i += 2) {
      if (punkte[i] < minX) minX = punkte[i];
      if (punkte[i] > maxX) maxX = punkte[i];
      if (punkte[i + 1] < minY) minY = punkte[i + 1];
      if (punkte[i + 1] > maxY) maxY = punkte[i + 1];
    }
    const r = Math.ceil(dicke / 2);
    return { x: Math.floor(minX) - r, y: Math.floor(minY) - r,
             breite: Math.ceil(maxX - minX) + 2 * r, hoehe: Math.ceil(maxY - minY) + 2 * r };
  }

  // Notbremse wie im Gehirn: gemessen wird die Zeit des Voll-Redraws als
  // gleitender Mittelwert. Ueber 20,5 ms wird grob gezeichnet (gerade
  // Segmente statt Kurven), unter 14 ms wieder fein. Bounded: ein Bit.
  let redrawZeit = 8, grobModus = false;

  // Waehrend eine Auswahl gezogen wird, verschieben sich Striche nur
  // OPTISCH (translate beim Zeichnen); gebacken wird erst beim Loslassen.
  const ziehVersatz = { aktiv: false, dx: 0, dy: 0 };

  // Der Schwamm tintet Striche, BEVOR er loescht: alles in dieser Menge
  // wird halbtransparent gezeichnet.
  const schwammOpfer = new Set();

  // Der gerade entstehende Strich (Werkzeug Stift).
  let liveStrich = null; // {punkte:[welt-boardrelativ], farbe, dicke, besitzer, letzteX, letzteY}

  function vollZeichnen() {
    const t0 = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, leinwand.width, leinwand.height);
    ctx.setTransform(dpr * ansicht.s, 0, 0, dpr * ansicht.s, dpr * ansicht.tx, dpr * ansicht.ty);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Sichtfenster in Weltkoordinaten — alles ausserhalb wird gar nicht
    // erst angefasst (Culling ueber die Bounding-Box).
    const w0 = schirmZuWelt(0, 0), w1 = schirmZuWelt(breite, hoehe);
    const sichtX0 = w0.x - 40, sichtY0 = w0.y - 40, sichtX1 = w1.x + 40, sichtY1 = w1.y + 40;

    for (const p of team) {
      const striche = stricheJeBoard.get(p.id);
      if (!striche || !striche.length) continue;
      const bx = versatz.get(p.id), by = versatzY.get(p.id);
      if (bx > sichtX1 || bx + BOARD_B < sichtX0 || by > sichtY1 || by + BOARD_H < sichtY0) continue;

      // Tinte endet an der Tafelkante — ein Marker schreibt nicht auf die
      // Wand. Der Clip macht auch halb ueber den Rand gewischte Striche
      // glaubwuerdig.
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, by, BOARD_B, BOARD_H);
      ctx.clip();

      for (const el of striche) {
        try {
          const b = el; // bbox liegt am Element (x,y,breite,hoehe, board-relativ)
          const ex0 = b.x + bx, ey0 = b.y + by, ex1 = ex0 + b.breite, ey1 = ey0 + b.hoehe;
          if (ex0 > sichtX1 || ex1 < sichtX0 || ey0 > sichtY1 || ey1 < sichtY0) continue;
          const gewischt = schwammOpfer.has(el.id);
          const gezogen = ziehVersatz.aktiv && auswahl.has(el.id);
          ctx.strokeStyle = tinte(el.inhalt.farbe);
          ctx.lineWidth = el.inhalt.dicke;
          ctx.globalAlpha = gewischt ? 0.22 : 1;
          if (gezogen) { ctx.save(); ctx.translate(ziehVersatz.dx, ziehVersatz.dy); }
          ctx.stroke(grobModus ? (el._pfadGrob || (el._pfadGrob = strichPfadBauen(el, true))) : pfadVon(el));
          if (gezogen) ctx.restore();
          if (auswahl.has(el.id)) auswahlRahmen(el, bx, by, gezogen);
        } catch (fehler) {
          // Ein kaputtes Element reisst nie die Wand: ueberspringen, melden.
          console.error("Whiteboard: Strich uebersprungen:", el && el.id, fehler);
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Der Strich unterm Stift, immer scharf und zuoberst.
    if (liveStrich) {
      const bx = versatz.get(liveStrich.besitzer) || 0;
      const by = versatzY.get(liveStrich.besitzer) || 0;
      ctx.save();
      ctx.beginPath(); ctx.rect(bx, by, BOARD_B, BOARD_H); ctx.clip();
      ctx.strokeStyle = tinte(liveStrich.farbe);
      ctx.lineWidth = liveStrich.dicke;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const p = liveStrich.punkte;
      if (p.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(p[0] + bx, p[1] + by);
        for (let i = 2; i < p.length - 2; i += 2) {
          ctx.quadraticCurveTo(p[i] + bx, p[i + 1] + by, (p[i] + p[i + 2]) / 2 + bx, (p[i + 1] + p[i + 3]) / 2 + by);
        }
        ctx.lineTo(p[p.length - 2] + bx, p[p.length - 1] + by);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    redrawZeit += (performance.now() - t0 - redrawZeit) * 0.2;
    if (!grobModus && redrawZeit > 20.5) { grobModus = true; }
    else if (grobModus && redrawZeit < 14) { grobModus = false; }
  }

  // Auswahlrahmen fuer Striche: gestrichelte Box, Strichbreite in
  // Bildschirm-px (durch s geteilt), damit sie beim Zoomen ruhig bleibt.
  // Die Auswahlfarbe kommt aus dem Theme (unter Graphit ist "primaer"
  // ein Grau) — fuers Canvas einmal ablesen und bei Themewechsel neu.
  let auswahlFarbe = "#2563EB";
  function auswahlFarbeLesen() {
    try {
      const w = getComputedStyle(wurzel).getPropertyValue("--wb-primaer").trim();
      if (w) auswahlFarbe = w;
    } catch { /* Standard bleibt */ }
  }

  function auswahlRahmen(el, bx, by, gezogen) {
    const dx = gezogen ? ziehVersatz.dx : 0, dy = gezogen ? ziehVersatz.dy : 0;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = auswahlFarbe;
    ctx.lineWidth = 1.5 / ansicht.s;
    ctx.setLineDash([6 / ansicht.s, 5 / ansicht.s]);
    ctx.strokeRect(el.x + bx + dx - 4, el.y + by + dy - 4, el.breite + 8, el.hoehe + 8);
    ctx.restore();
  }

  // Nur den Live-Strich nachziehen: waehrend des Zeichnens gibt es keinen
  // Grund, die ganze Wand neu zu malen — es kommen nur Segmente HINZU.
  // Der inkrementelle Pfad zeichnet ab dem letzten festen Punkt.
  function liveSegmentZeichnen() {
    if (!liveStrich) return;
    const p = liveStrich.punkte;
    const n = p.length;
    if (n < 4) return;
    const bx = versatz.get(liveStrich.besitzer) || 0;
    const by = versatzY.get(liveStrich.besitzer) || 0;
    ctx.setTransform(dpr * ansicht.s, 0, 0, dpr * ansicht.s, dpr * ansicht.tx, dpr * ansicht.ty);
    ctx.save();
    ctx.beginPath(); ctx.rect(bx, by, BOARD_B, BOARD_H); ctx.clip();
    ctx.strokeStyle = tinte(liveStrich.farbe);
    ctx.lineWidth = liveStrich.dicke;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    if (n >= 8) {
      // Das letzte Kurvenstueck neu: vom vorletzten Mittelpunkt durch den
      // vorletzten Punkt zum letzten Mittelpunkt, dann zum Endpunkt.
      const x3 = p[n - 2] + bx, y3 = p[n - 1] + by;
      const x2 = p[n - 4] + bx, y2 = p[n - 3] + by;
      const x1 = p[n - 6] + bx, y1 = p[n - 5] + by;
      ctx.moveTo((x1 + x2) / 2, (y1 + y2) / 2);
      ctx.quadraticCurveTo(x2, y2, (x2 + x3) / 2, (y2 + y3) / 2);
      ctx.lineTo(x3, y3);
    } else {
      ctx.moveTo(p[0] + bx, p[1] + by);
      for (let i = 2; i < n; i += 2) ctx.lineTo(p[i] + bx, p[i + 1] + by);
    }
    ctx.stroke();
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // =================================================================
  // Elementverwaltung: Upsert, Entfernen, DOM-Knoten fuer Text/Notiz
  // =================================================================

  const elementKnoten = new Map();         // id -> DOM-Knoten (nur text/notiz)

  // Ein Element vollstaendig uebernehmen (Erstaufbau UND Poll-Delta).
  // Idempotent per id: der komplette Zustand wird ersetzt — Duplikate aus
  // dem 10-Sekunden-Ueberlappungsfenster des Servers sind dadurch gratis.
  function elementUebernehmen(el, quelle) {
    try {
      if (!versatz.has(el.besitzer)) return;               // unbekanntes Board
      if (quelle === "poll" && inArbeit.has(el.id)) return; // Finger drauf: nicht anfassen
      const alt = elemente.get(el.id);
      elemente.set(el.id, el);
      if (el.art === "strich") {
        el._pfad = null; el._pfadGrob = null;
        const liste = stricheJeBoard.get(el.besitzer);
        if (alt && alt.art === "strich") {
          const i = liste.indexOf(alt);
          if (i >= 0) liste[i] = el; else liste.push(el);
        } else liste.push(el);
        tintenDirty = true; zeichnenAnfordern();
      } else {
        blockRendern(el, alt);
      }
    } catch (fehler) {
      console.error("Whiteboard: Element uebersprungen:", el && el.id, fehler);
    }
  }

  function elementEntfernen(id) {
    const el = elemente.get(id);
    if (!el) return;
    elemente.delete(id);
    auswahl.delete(id);
    inArbeit.delete(id);
    if (el.art === "strich") {
      const liste = stricheJeBoard.get(el.besitzer);
      const i = liste.indexOf(el);
      if (i >= 0) liste.splice(i, 1);
      tintenDirty = true; zeichnenAnfordern();
    } else {
      const k = elementKnoten.get(id);
      if (k) { k.remove(); elementKnoten.delete(id); }
    }
    auswahlAnzeigen();
    schilderAuffrischen();
  }

  // ------------------------------------------------- Text-/Notiz-Knoten

  // Waechter: Entfernt blockRendern gerade die fokussierte End-Zeile,
  // feuert ihr remove() ein SYNCHRONES focusout — und dessen Handler
  // wuerde den noch-alten DOM serialisieren und das frisch gesplicete
  // Modell ueberschreiben (die geloeschte Zeile erstuende nach Poll oder
  // Reload wieder). Solange das Flag steht, laesst focusout die Finger
  // vom Modell; die Handler setzen den Fokus nach dem Rendern selbst.
  let rendernLaeuft = false;

  // Baut den DOM-Knoten eines Blocks neu bzw. aktualisiert ihn in place.
  // waehrend der Bearbeitung (inArbeit) kommt niemand von aussen hierher.
  function blockRendern(el, alt) {
    rendernLaeuft = true;
    try { blockRendernInnen(el, alt); }
    finally { rendernLaeuft = false; }
  }

  function blockRendernInnen(el, alt) {
    let knoten = elementKnoten.get(el.id);
    const eigen = el.besitzer === ich.id;
    if (!knoten) {
      knoten = document.createElement("div");
      knoten.dataset.id = el.id;
      const inhalt = boardKnoten.get(el.besitzer).inhalt;
      inhalt.appendChild(knoten);
      elementKnoten.set(el.id, knoten);
      if (eigen) blockInteraktionAnbinden(knoten);
    }
    // wb-fokus lebt am Fokus, nicht am Modell — die Klasse muss das
    // Neuschreiben von className ueberleben, sonst schliesst sich der
    // Werkzeugkasten nach jedem Rendern (Farbe klicken -> Kasten weg).
    knoten.className = "wb-el " + (el.art === "notiz" ? "wb-el-notiz" : "wb-el-text")
      + (auswahl.has(el.id) ? " wb-gewaehlt" : "")
      + (knoten.classList.contains("wb-fokus") ? " wb-fokus" : "");
    knoten.style.left = el.x + "px";
    knoten.style.top = el.y + "px";
    knoten.style.width = el.breite + "px";
    knoten.style.fontSize = el.inhalt.groesse + "px";
    knoten.style.setProperty("--ef", tinte(el.inhalt.farbe));
    if (el.art === "notiz") {
      knoten.style.setProperty("--zf", "var(--wb-zettel-" + el.inhalt.zettel + ")");
      knoten.style.setProperty("--drehung", zettelDrehung(el.id));
    }

    // Struktur: Griff + Zeilenliste (+ Kasten nur am eigenen Block).
    let zeilenEl = $(".wb-zeilen", knoten);
    if (!zeilenEl) {
      knoten.innerHTML = "";
      if (eigen) {
        const griff = document.createElement("div");
        griff.className = "wb-griff";
        griff.setAttribute("data-tip", "Verschieben");
        knoten.appendChild(griff);
        // Direkt HIER anbinden: blockInteraktionAnbinden lief auf dem
        // noch leeren Knoten — dort gibt es den Griff nie zu finden.
        griffAnbinden(griff, knoten);
      }
      zeilenEl = document.createElement("div");
      zeilenEl.className = "wb-zeilen";
      knoten.appendChild(zeilenEl);
      if (eigen) knoten.appendChild(kastenBauen(el.id));
    }
    zeilenEl.dataset.liste = el.inhalt.liste;

    // Zeilen abgleichen: vorhandene Knoten wiederverwenden, damit Fokus
    // und Caret bei jedem Rendern ueberleben wuerden (der Poll meidet
    // fokussierte Bloecke ohnehin, aber Vorsicht kostet hier nichts).
    const zeilen = el.inhalt.zeilen;
    const daKnoten = Array.from(zeilenEl.children);
    for (let i = 0; i < zeilen.length; i++) {
      let z = daKnoten[i];
      if (!z) { z = zeileBauen(eigen); zeilenEl.appendChild(z); }
      zeileFuellen(z, zeilen[i], eigen);
    }
    for (let i = daKnoten.length - 1; i >= zeilen.length; i--) daKnoten[i].remove();

    if (eigen) kastenAuffrischen(el);
    schilderAuffrischen();
  }

  function zeileBauen(eigen) {
    const z = document.createElement("div");
    z.className = "wb-zeile";
    const ab = document.createElement("button");
    ab.type = "button"; ab.className = "wb-abhaken"; ab.tabIndex = -1;
    ab.setAttribute("aria-label", "Abhaken");
    ab.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect class="wb-kasten-rand" x="2.5" y="2.5" width="15" height="15" rx="4.5" stroke-width="1.6"/>'
      + '<path class="wb-haken" d="M5.5 10.5 L8.8 14 L15 5.5" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1"/></svg>';
    z.appendChild(ab);
    const t = document.createElement("span");
    t.className = "wb-zeile-text";
    if (eigen) {
      t.contentEditable = "true";
      t.spellcheck = false;
      // Nicht in der Tab-Reihenfolge: Tab soll durch die Werkzeuge
      // laufen, nicht durch jede Textzeile jedes Blocks (Klick und
      // caretSetzen fokussieren weiterhin).
      t.tabIndex = -1;
    }
    z.appendChild(t);
    if (eigen) {
      const tools = document.createElement("span");
      tools.className = "wb-zeile-tools";
      const streich = document.createElement("button");
      streich.type = "button"; streich.className = "wb-zeile-streichen"; streich.tabIndex = -1;
      streich.setAttribute("aria-label", "Durchstreichen");
      streich.innerHTML = ICON.strich;
      const weg = document.createElement("button");
      weg.type = "button"; weg.className = "wb-zeile-weg"; weg.tabIndex = -1;
      weg.setAttribute("aria-label", "Zeile löschen");
      weg.innerHTML = ICON.weg;
      tools.append(streich, weg);
      z.appendChild(tools);
    }
    return z;
  }

  function zeileFuellen(z, daten, eigen) {
    const t = $(".wb-zeile-text", z);
    if (t.textContent !== daten.t) t.textContent = daten.t;
    z.classList.toggle("wb-erledigt", !!daten.erledigt);
    z.classList.toggle("wb-gestrichen", !!daten.gestrichen && !daten.erledigt);
    // Der Haken steht, wo er hingehoert — ohne Animation, die gibt es nur
    // beim Klick selbst (hakenZiehen).
    const haken = $(".wb-haken", z);
    if (haken) haken.style.strokeDashoffset = daten.erledigt ? "0" : "1";
  }

  // Der gruene Haken wird GEZOGEN, nicht eingeblendet — wie mit dem
  // Stift. Unter reduced-motion steht er sofort.
  function hakenZiehen(z) {
    const haken = $(".wb-haken", z);
    if (!haken) return;
    if (sanft || !gsap) { haken.style.strokeDashoffset = "0"; return; }
    gsap.fromTo(haken, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.38, ease: "power2.out" });
  }

  // Mini-Konfetti, wenn ALLE Zeilen eines Checklisten-Blocks erledigt
  // sind: ein kurzer Papierregen aus der Blockmitte. Nur dann — Delight
  // ist ein Gewuerz, kein Hauptgericht.
  function konfetti(knoten) {
    if (sanft || !gsap) return;
    const halter = document.createElement("div");
    halter.className = "wb-konfetti";
    halter.style.left = (knoten.offsetLeft + knoten.offsetWidth / 2) + "px";
    halter.style.top = knoten.offsetTop + "px";
    knoten.parentElement.appendChild(halter);
    const farben = [TINTE_HELL.blau, TINTE_HELL.gruen, TINTE_HELL.orange, TINTE_HELL.rot, TINTE_HELL.lila];
    for (let i = 0; i < 16; i++) {
      const teil = document.createElement("i");
      teil.style.background = farben[i % farben.length];
      halter.appendChild(teil);
      const winkel = (Math.random() - 0.5) * Math.PI * 1.1 - Math.PI / 2;
      const weite = 90 + Math.random() * 160;
      gsap.fromTo(teil, { x: 0, y: 0, rotation: 0, opacity: 1 }, {
        x: Math.cos(winkel) * weite,
        y: Math.sin(winkel) * weite + 150,
        rotation: (Math.random() - 0.5) * 540,
        opacity: 0,
        duration: 0.9 + Math.random() * 0.5,
        ease: "power1.out",
      });
    }
    setTimeout(() => halter.remove(), 1600);
  }

  // =================================================================
  // Zeilen-Editor — ein contenteditable JE ZEILE
  // =================================================================
  //
  // Warum nicht ein grosses contenteditable: dessen DOM waere nach drei
  // Enter-Druecken browserabhaengiger Wildwuchs (div, br, span mit
  // Inline-Styles) — nicht mehr verlustfrei auf unser Zeilenmodell
  // abbildbar. Eine Zeile = ein Span ist langweilig, und genau deshalb
  // robust: Enter, Merge, Paste und Listenform bleiben UNSERE Logik,
  // der Browser verwaltet nur Caret und Tastatur innerhalb einer Zeile.

  const caretOffset = (span) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    if (!span.contains(r.startContainer)) return 0;
    const vor = r.cloneRange();
    vor.selectNodeContents(span);
    vor.setEnd(r.startContainer, r.startOffset);
    return vor.toString().length;
  };

  function caretSetzen(span, offset) {
    span.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    let rest = klemm(offset, 0, span.textContent.length);
    let gesetzt = false;
    const lauf = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let knoten;
    while ((knoten = lauf.nextNode())) {
      if (rest <= knoten.textContent.length) { r.setStart(knoten, rest); gesetzt = true; break; }
      rest -= knoten.textContent.length;
    }
    if (!gesetzt) { r.selectNodeContents(span); r.collapse(false); }
    else r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // Zeilenmetadaten leben im Datenmodell, nicht im DOM: der DOM-Index der
  // Zeile IST der Index im Modell — beide werden immer zusammen geaendert.
  const zeilenIndex = (z) => Array.prototype.indexOf.call(z.parentElement.children, z);
  const elVonKnoten = (knoten) => elemente.get(knoten.closest(".wb-el").dataset.id);

  // Serialisiert die Texte aus dem DOM zurueck ins Modell. Metadaten
  // (erledigt/gestrichen) werden NICHT aus dem DOM gelesen — sie werden
  // nur ueber ihre Schalter geaendert und stehen im Modell schon richtig.
  function blockSerialisieren(el) {
    const knoten = elementKnoten.get(el.id);
    if (!knoten) return;
    const spans = $$(".wb-zeile-text", knoten);
    const neu = [];
    for (let i = 0; i < spans.length; i++) {
      const alt = el.inhalt.zeilen[i] || { erledigt: false, gestrichen: false };
      neu.push({ t: spans[i].textContent.replace(/\u00A0/g, " ").slice(0, DATEN.grenzen.zeichenJeZeile),
                 erledigt: !!alt.erledigt, gestrichen: !!alt.gestrichen });
    }
    el.inhalt.zeilen = neu.length ? neu : [{ t: "", erledigt: false, gestrichen: false }];
  }

  // Groesse nachmessen und Aenderung speichern (entprellt 800 ms; blur
  // und Strukturaenderungen flushen frueher ueber speichernFlush).
  function blockGeaendert(el, sofort) {
    const knoten = elementKnoten.get(el.id);
    if (knoten) {
      el.breite = Math.max(el.breite, 40);
      el.hoehe = Math.round(knoten.offsetHeight);
    }
    aenderungEinreihen(el, sofort);
    schilderAuffrischen();
  }

  function blockInteraktionAnbinden(knoten) {
    // ---- Fokus rein/raus: inArbeit schuetzt vor dem Poll; leerer Block
    // verschwindet beim Verlassen (eine leere Notiz ist Muell am Board).
    knoten.addEventListener("focusin", () => {
      const el = elVonKnoten(knoten);
      if (!el) return;
      inArbeit.add(el.id);
      knoten.classList.add("wb-fokus");
      kastenAusrichten(knoten);
    });
    knoten.addEventListener("focusout", (ev) => {
      if (ev.relatedTarget && knoten.contains(ev.relatedTarget)) return;
      // Render-Waechter (siehe rendernLaeuft): dieses focusout kommt vom
      // remove() einer End-Zeile MITTEN im Rendern — der alte DOM ist
      // noch abfragbar, Serialisieren wuerde den Splice rueckgaengig
      // machen. Der ausloesende Handler stellt den Fokus gleich per
      // caretSetzen wieder her; ein echtes Verlassen des Blocks feuert
      // sein focusout spaeter, ohne laufendes Rendern.
      if (rendernLaeuft) return;
      const el = elVonKnoten(knoten);
      knoten.classList.remove("wb-fokus");
      if (!el) return;
      blockSerialisieren(el);
      const leer = el.inhalt.zeilen.every((z) => !z.t.trim());
      if (leer) {
        elementLoeschen([el.id], { still: true });
      } else {
        blockGeaendert(el, true);
      }
      inArbeit.delete(el.id);
    });

    // ---- pointerdown im Block: zwei Sonderfaelle VOR dem Fokus.
    knoten.addEventListener("pointerdown", (ev) => {
      // Abhaken und Zeilenwerkzeuge nehmen beim Klick KEINEN Fokus an
      // (tabIndex -1 steht schon): das mousedown wuerde sonst wb-fokus
      // setzen — der Format-Kasten ploppte ungefragt auf, und die
      // inArbeit-Sperre bliebe haengen (der Poll traegt Fremdstaende
      // dann nicht mehr nach, bis irgendwo ins Leere geklickt wird).
      if (ev.target.closest(".wb-abhaken,.wb-zeile-tools")) { ev.preventDefault(); return; }
      // Winzig-Zoom: unter 35 % ist ein Caret nur noch Deko — aber der
      // Fokus finge danach die Tastenkuerzel (T/S/...) ab und tippte sie
      // in den Block. Statt zu fokussieren heranfahren, wie beim
      // Doppelklick weiter unten.
      if (ansicht.s < ZOOM_TEXT_MIN && ev.target.closest(".wb-zeile-text")) {
        ev.preventDefault();
        const el = elVonKnoten(knoten);
        if (el) aufElementZoomen(el);
      }
    });

    // ---- Tastenlogik je Zeile.
    knoten.addEventListener("keydown", (ev) => {
      const span = ev.target.closest(".wb-zeile-text");
      if (!span) return;
      const el = elVonKnoten(knoten);
      if (!el) return;
      const zeile = span.closest(".wb-zeile");
      const idx = zeilenIndex(zeile);

      if (ev.key === "Enter") {
        ev.preventDefault();
        if (ev.isComposing) return;
        if (el.inhalt.zeilen.length >= DATEN.grenzen.zeilen) { toast("Mehr als " + DATEN.grenzen.zeilen + " Zeilen passen nicht auf einen Block."); return; }
        blockSerialisieren(el);
        const pos = caretOffset(span);
        const text = el.inhalt.zeilen[idx].t;
        el.inhalt.zeilen[idx].t = text.slice(0, pos);
        el.inhalt.zeilen.splice(idx + 1, 0, { t: text.slice(pos), erledigt: false, gestrichen: false });
        blockRendern(el);
        const neue = $$(".wb-zeile-text", knoten)[idx + 1];
        if (neue) caretSetzen(neue, 0);
        blockGeaendert(el, true);
        return;
      }

      if (ev.key === "Backspace" && caretOffset(span) === 0 && fensterKollabiert()) {
        if (idx === 0) return; // Anfang des Blocks: nichts zu mergen
        ev.preventDefault();
        blockSerialisieren(el);
        const vorherText = el.inhalt.zeilen[idx - 1].t;
        // Metadaten der VORZEILE ueberleben den Merge — wer eine erledigte
        // Zeile hochzieht, will ihren Haken nicht verlieren.
        el.inhalt.zeilen[idx - 1].t = vorherText + el.inhalt.zeilen[idx].t;
        el.inhalt.zeilen.splice(idx, 1);
        blockRendern(el);
        const ziel = $$(".wb-zeile-text", knoten)[idx - 1];
        if (ziel) caretSetzen(ziel, vorherText.length);
        blockGeaendert(el, true);
        return;
      }

      if (ev.key === "Delete" && caretOffset(span) === span.textContent.length && fensterKollabiert()) {
        if (idx >= el.inhalt.zeilen.length - 1) return;
        ev.preventDefault();
        blockSerialisieren(el);
        const eigenerText = el.inhalt.zeilen[idx].t;
        el.inhalt.zeilen[idx].t = eigenerText + el.inhalt.zeilen[idx + 1].t;
        el.inhalt.zeilen.splice(idx + 1, 1);
        blockRendern(el);
        const ziel = $$(".wb-zeile-text", knoten)[idx];
        if (ziel) caretSetzen(ziel, eigenerText.length);
        blockGeaendert(el, true);
        return;
      }

      if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
        const runter = ev.key === "ArrowDown";
        // Nur an der Blockgrenze uebernehmen wir; innerhalb einer
        // umgebrochenen Zeile soll der Browser normal hochlaufen.
        if (!anZeilengrenze(span, runter)) return;
        const ziel = $$(".wb-zeile-text", knoten)[idx + (runter ? 1 : -1)];
        if (!ziel) return;
        ev.preventDefault();
        caretSetzen(ziel, klemm(caretOffset(span), 0, ziel.textContent.length));
        return;
      }

      if (ev.key === "Escape") { span.blur(); }
    });

    // ---- Eingabe: entprellt speichern. Waehrend einer Komposition (IME)
    // wird NICHTS normalisiert; compositionend serialisiert einmal sauber.
    knoten.addEventListener("input", (ev) => {
      const span = ev.target.closest(".wb-zeile-text");
      if (!span || ev.isComposing) return;
      const el = elVonKnoten(knoten);
      if (!el) return;
      // historyUndo/historyRedo: der Browser hat den Zeileninhalt selbst
      // veraendert — einfach neu ablesen, unser Modell folgt dem DOM.
      blockSerialisieren(el);
      blockGeaendert(el, false);
    });
    knoten.addEventListener("compositionend", () => {
      const el = elVonKnoten(knoten);
      if (!el) return;
      blockSerialisieren(el);
      blockGeaendert(el, false);
    });

    // ---- Paste: nur Klartext; \n macht neue Zeilen daraus.
    knoten.addEventListener("paste", (ev) => {
      const span = ev.target.closest(".wb-zeile-text");
      if (!span) return;
      ev.preventDefault();
      const el = elVonKnoten(knoten);
      if (!el) return;
      const roh = (ev.clipboardData || window.clipboardData).getData("text/plain") || "";
      const teile = roh.replace(/\r\n?/g, "\n").split("\n");
      blockSerialisieren(el);
      const zeile = span.closest(".wb-zeile");
      const idx = zeilenIndex(zeile);
      const pos = caretOffset(span);
      const text = el.inhalt.zeilen[idx].t;
      if (teile.length === 1) {
        el.inhalt.zeilen[idx].t = (text.slice(0, pos) + teile[0] + text.slice(pos)).slice(0, DATEN.grenzen.zeichenJeZeile);
        blockRendern(el);
        caretSetzen($$(".wb-zeile-text", knoten)[idx], pos + teile[0].length);
      } else {
        const rest = text.slice(pos);
        el.inhalt.zeilen[idx].t = (text.slice(0, pos) + teile[0]).slice(0, DATEN.grenzen.zeichenJeZeile);
        const neue = teile.slice(1).map((t) => ({ t: t.slice(0, DATEN.grenzen.zeichenJeZeile), erledigt: false, gestrichen: false }));
        neue[neue.length - 1].t = (neue[neue.length - 1].t + rest).slice(0, DATEN.grenzen.zeichenJeZeile);
        el.inhalt.zeilen.splice(idx + 1, 0, ...neue.slice(0, DATEN.grenzen.zeilen - el.inhalt.zeilen.length));
        blockRendern(el);
        const ziel = $$(".wb-zeile-text", knoten)[Math.min(idx + teile.length - 1, el.inhalt.zeilen.length - 1)];
        if (ziel) caretSetzen(ziel, ziel.textContent.length);
      }
      blockGeaendert(el, true);
    });

    // ---- Klicks auf Abhaken / Streichen / Zeile loeschen.
    knoten.addEventListener("click", (ev) => {
      const el = elVonKnoten(knoten);
      if (!el) return;
      const zeile = ev.target.closest(".wb-zeile");
      if (!zeile) return;
      const idx = zeilenIndex(zeile);
      const z = el.inhalt.zeilen[idx];
      if (!z) return;

      // Toggles landen im Undo-Stack (typ aendern) — ohne Eintrag naehme
      // Strg+Z nach dem Abhaken ueberraschend die letzte ANDERE Aktion
      // zurueck (im Test verschwand ein Strich).
      const inhaltKopie = () => JSON.parse(JSON.stringify(el.inhalt));

      if (ev.target.closest(".wb-abhaken")) {
        ev.preventDefault();
        const vorher = { inhalt: inhaltKopie() };
        z.erledigt = !z.erledigt;
        zeileFuellen(zeile, z, true);
        if (z.erledigt) {
          hakenZiehen(zeile);
          if (el.inhalt.liste === "check" && el.inhalt.zeilen.every((x) => x.erledigt)) {
            konfetti(knoten);
          }
        }
        undoMerken({ typ: "aendern", id: el.id, vorher, nachher: { inhalt: inhaltKopie() } });
        blockGeaendert(el, true);
      } else if (ev.target.closest(".wb-zeile-streichen")) {
        ev.preventDefault();
        const vorher = { inhalt: inhaltKopie() };
        z.gestrichen = !z.gestrichen;
        zeileFuellen(zeile, z, true);
        undoMerken({ typ: "aendern", id: el.id, vorher, nachher: { inhalt: inhaltKopie() } });
        blockGeaendert(el, true);
      } else if (ev.target.closest(".wb-zeile-weg")) {
        ev.preventDefault();
        blockSerialisieren(el);
        el.inhalt.zeilen.splice(idx, 1);
        if (!el.inhalt.zeilen.length) { elementLoeschen([el.id]); return; }
        blockRendern(el);
        // Stand das Caret in der geloeschten (letzten) Zeile, haengt der
        // Fokus jetzt an einem entfernten Knoten — auf die Nachbarzeile
        // setzen, damit Tippen, wb-fokus und inArbeit nahtlos weitergehen.
        if (knoten.classList.contains("wb-fokus")) {
          const spans = $$(".wb-zeile-text", knoten);
          const ziel = spans[Math.min(idx, spans.length - 1)];
          if (ziel) caretSetzen(ziel, ziel.textContent.length);
        }
        blockGeaendert(el, true);
      }
    });

    // ---- Doppelklick auf einen Block bei kleiner Ansicht: erst heran-
    // zoomen, dann tippen — unter 35 % ist ein Caret nur noch Deko.
    knoten.addEventListener("dblclick", (ev) => {
      if (ansicht.s >= ZOOM_TEXT_MIN) return;
      ev.preventDefault();
      const el = elVonKnoten(knoten);
      if (el) aufElementZoomen(el);
    });

    // (Der Griff wird beim Strukturaufbau in blockRendern angebunden —
    // hier ist der Knoten noch leer, ein Lookup faende nie einen.)
  }

  // Ist die Selektion kollabiert (kein markierter Bereich)? Merge-Logik
  // greift nur dann — sonst soll Backspace die Markierung loeschen.
  function fensterKollabiert() {
    const sel = window.getSelection();
    return !sel || sel.isCollapsed;
  }

  // Steht das Caret optisch in der ersten (bzw. letzten) Bildschirmzeile
  // des Spans? Umbruchzeilen INNERHALB des Spans gehoeren dem Browser.
  function anZeilengrenze(span, unten) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return true;
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(!unten);
    const rects = r.getClientRects();
    const caret = rects.length ? rects[rects.length - 1] : null;
    if (!caret || !caret.height) return true;
    const box = span.getBoundingClientRect();
    const zeilenHoehe = caret.height || 18;
    return unten ? (box.bottom - caret.bottom) < zeilenHoehe * 0.7
                 : (caret.top - box.top) < zeilenHoehe * 0.7;
  }

  // =================================================================
  // Block-Werkzeugkasten (Listenform, Farbe, Groesse, Zettel, Loeschen)
  // =================================================================

  function kastenBauen(elId) {
    const kasten = document.createElement("div");
    kasten.className = "wb-kasten";
    // Der Kasten faengt pointerdown ab, damit ein Klick auf einen Knopf
    // dem Block nicht den Fokus nimmt (focusout wuerde sonst speichern
    // und den Kasten schliessen, bevor der Klick ankommt).
    kasten.addEventListener("pointerdown", (ev) => ev.preventDefault());

    const listen = document.createElement("div");
    listen.className = "wb-kasten-gruppe";
    [["keine", ICON.listeKeine, "Keine Liste"], ["zahl", ICON.listeZahl, "1. 2. 3."],
     ["buchstabe", ICON.listeBuchstabe, "a) b) c)"], ["punkt", ICON.listePunkt, "Aufzählung"],
     ["check", ICON.listeCheck, "Checkliste"]].forEach(([wert, icon, tip]) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.liste = wert; b.innerHTML = icon;
      b.setAttribute("data-tip", tip); b.setAttribute("aria-label", tip);
      listen.appendChild(b);
    });

    const farben = document.createElement("div");
    farben.className = "wb-kasten-gruppe";
    FARBNAMEN.forEach((name) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "wb-farbe"; b.dataset.farbe = name;
      b.style.setProperty("--f", tinte(name));
      b.setAttribute("aria-label", "Schriftfarbe " + name);
      farben.appendChild(b);
    });

    const groessen = document.createElement("div");
    groessen.className = "wb-kasten-gruppe";
    [["20", "S"], ["28", "M"], ["40", "L"]].forEach(([wert, wort]) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.groesse = wert; b.textContent = wort;
      b.setAttribute("aria-label", "Schriftgröße " + wort);
      groessen.appendChild(b);
    });

    const zettel = document.createElement("div");
    zettel.className = "wb-kasten-gruppe wb-kasten-zettel";
    ZETTELNAMEN.forEach((name) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "wb-zettelwahl"; b.dataset.zettel = name;
      b.style.setProperty("--z", "var(--wb-zettel-" + name + ")");
      b.setAttribute("aria-label", "Zettel " + name);
      zettel.appendChild(b);
    });

    const weg = document.createElement("button");
    weg.type = "button"; weg.className = "wb-kasten-weg"; weg.innerHTML = ICON.weg;
    weg.setAttribute("data-tip", "Block löschen"); weg.setAttribute("aria-label", "Block löschen");

    const trenner = () => { const t = document.createElement("div"); t.className = "wb-kasten-trenner"; return t; };
    kasten.append(listen, trenner(), farben, trenner(), groessen, trenner(), zettel, weg);

    kasten.addEventListener("click", (ev) => {
      const el = elemente.get(elId);
      if (!el) return;
      // Laeuft der Kasten im mobilen Blatt, ist DORT der aktuelle Text —
      // erst uebernehmen, sonst wuerde ein Farbwechsel das Getippte mit
      // dem alten Buehnenstand ueberschreiben.
      const imBlatt = mobilOffen && mobilOffen.el.id === elId;
      if (imBlatt) mobilUebernehmen();
      // Caret merken: das Rendern gleich kann den fokussierten Textknoten
      // ersetzen (Nbsp-Normalisierung beim Serialisieren) — ohne das
      // Wiederherstellen verloere man Fokus samt Kasten nach jedem Klick
      // und muesste fuer die naechste Farbe neu in den Text klicken.
      const blockKnoten = elementKnoten.get(elId);
      let caretMerk = null;
      if (!imBlatt && blockKnoten) {
        const aktiv = document.activeElement;
        if (aktiv && blockKnoten.contains(aktiv) && aktiv.classList.contains("wb-zeile-text")) {
          caretMerk = { idx: zeilenIndex(aktiv.closest(".wb-zeile")), pos: caretOffset(aktiv) };
        }
      }
      const liste = ev.target.closest("[data-liste]");
      const farbe = ev.target.closest("[data-farbe]");
      const groesse = ev.target.closest("[data-groesse]");
      const zettelKnopf = ev.target.closest("[data-zettel]");
      if (liste) el.inhalt.liste = liste.dataset.liste;
      else if (farbe) el.inhalt.farbe = farbe.dataset.farbe;
      else if (groesse) el.inhalt.groesse = Number(groesse.dataset.groesse);
      else if (zettelKnopf && el.art === "notiz") el.inhalt.zettel = zettelKnopf.dataset.zettel;
      else if (ev.target.closest(".wb-kasten-weg")) {
        if (imBlatt) mobilVerwerfen();
        elementLoeschen([el.id]);
        return;
      }
      else return;
      if (!imBlatt) blockSerialisieren(el);
      blockRendern(el);
      if (caretMerk) {
        const spans = $$(".wb-zeile-text", blockKnoten);
        const ziel = spans[Math.min(caretMerk.idx, spans.length - 1)];
        if (ziel) caretSetzen(ziel, caretMerk.pos);
      }
      blockGeaendert(el, true);
      if (imBlatt) mobilAnsichtAuffrischen();
    });
    return kasten;
  }

  function kastenAuffrischen(el) {
    const knoten = elementKnoten.get(el.id);
    const kasten = knoten && $(".wb-kasten", knoten);
    if (!kasten) return;
    $$("[data-liste]", kasten).forEach((b) => b.classList.toggle("wb-aktiv", b.dataset.liste === el.inhalt.liste));
    $$("[data-farbe]", kasten).forEach((b) => b.classList.toggle("wb-aktiv", b.dataset.farbe === el.inhalt.farbe));
    $$("[data-groesse]", kasten).forEach((b) => b.classList.toggle("wb-aktiv", Number(b.dataset.groesse) === el.inhalt.groesse));
    $$("[data-zettel]", kasten).forEach((b) => b.classList.toggle("wb-aktiv", b.dataset.zettel === el.inhalt.zettel));
    $(".wb-kasten-zettel", kasten).style.display = el.art === "notiz" ? "" : "none";
  }

  // Der Kasten oeffnet normal OBERHALB des Blocks. Steht der Block nahe
  // der Raum-Oberkante oder ist weit hineingezoomt, fehlt dort der Platz
  // (er kollidierte mit Namensschild und Kopfzeile) — dann unterhalb.
  // Entschieden wird beim Fokussieren, nicht pro Frame.
  function kastenAusrichten(knoten) {
    const kasten = $(".wb-kasten", knoten);
    if (!kasten) return;
    const raumRect = raum.getBoundingClientRect();
    const oben = knoten.getBoundingClientRect().top - raumRect.top;
    // Bedarf oben: Weltabstand (40 * Zoom) + Kastenhoehe + Kopfzeile.
    kasten.classList.toggle("wb-unten", oben < 40 * ansicht.s + 110);
    // Horizontal in den Viewport klemmen: der Kasten haengt an der
    // linken Blockkante — ragt die bei hohem Zoom links aus dem Bild,
    // laege die Listenform-Gruppe unerreichbar ausserhalb. Erst neutral
    // messen (ein alter Versatz darf nicht in die Rechnung wandern),
    // dann in Bildschirm-px klemmen. Der Versatz wird als left in
    // WELTEINHEITEN gesetzt: der linke Rand ist der Transform-Ursprung
    // der --wb-anti-Skalierung, left wirkt also mit Faktor s auf dem
    // Schirm — darum durch s teilen.
    kasten.style.left = "";
    const rk = kasten.getBoundingClientRect();
    const RAND = 8;
    let dx = 0;
    if (rk.right > raumRect.right - RAND) dx = (raumRect.right - RAND) - rk.right;
    // Links gewinnt: lieber rechts anschneiden als die Listenform verlieren.
    if (rk.left + dx < raumRect.left + RAND) dx = (raumRect.left + RAND) - rk.left;
    if (dx) kasten.style.left = (dx / ansicht.s).toFixed(2) + "px";
  }

  // ------------------------------------------------------------ Griff-Drag

  function griffAnbinden(griff, knoten) {
    griff.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      const el = elVonKnoten(knoten);
      if (!el) return;
      blockZiehen(el, ev);
    });
  }

  // Einen (oder mehrere gewaehlte) Bloecke ziehen. Live wird nur left/top
  // gesetzt; gespeichert wird EINMAL beim Loslassen.
  function blockZiehen(el, startEv) {
    const start = ereignisZuWelt(startEv);
    const betroffen = auswahl.has(el.id) && auswahl.size > 1
      ? [...auswahl].map((id) => elemente.get(id)).filter((e) => e && e.art !== "strich")
      : [el];
    const strichIds = auswahl.has(el.id) && auswahl.size > 1
      ? [...auswahl].filter((id) => { const e = elemente.get(id); return e && e.art === "strich"; })
      : [];
    const lagen = new Map(betroffen.map((e) => [e.id, { x: e.x, y: e.y }]));
    betroffen.forEach((e) => inArbeit.add(e.id));
    strichIds.forEach((id) => inArbeit.add(id));
    const ziel = startEv.target;
    try { ziel.setPointerCapture(startEv.pointerId); } catch { /* schon weg */ }
    let dx = 0, dy = 0, bewegt = false;
    if (strichIds.length) { ziehVersatz.aktiv = true; ziehVersatz.dx = 0; ziehVersatz.dy = 0; }
    const knotenVon = (e) => elementKnoten.get(e.id);
    knotenVon(el) && knotenVon(el).classList.add("wb-zieht");

    const move = (ev) => {
      const p = ereignisZuWelt(ev);
      dx = p.x - start.x; dy = p.y - start.y;
      // Klemmen: KEIN Block verlaesst die Tafel — sonst schriebe jemand
      // "auf die Wand" und wunderte sich, warum es dort nicht lesbar ist.
      for (const e of betroffen) {
        const lage = lagen.get(e.id);
        const maxX = BOARD_B - Math.max(60, e.breite), maxY = BOARD_H - Math.max(60, Math.min(e.hoehe || 60, BOARD_H));
        dx = klemm(dx, -lage.x, maxX - lage.x) ;
        dy = klemm(dy, -lage.y, maxY - lage.y);
      }
      for (const id of strichIds) {
        const e = elemente.get(id);
        dx = klemm(dx, -e.x, BOARD_B - e.breite - e.x);
        dy = klemm(dy, -e.y, BOARD_H - e.hoehe - e.y);
      }
      bewegt = bewegt || Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
      for (const e of betroffen) {
        const lage = lagen.get(e.id);
        const k = knotenVon(e);
        if (k) { k.style.left = (lage.x + dx) + "px"; k.style.top = (lage.y + dy) + "px"; }
      }
      if (strichIds.length) { ziehVersatz.dx = dx; ziehVersatz.dy = dy; tintenDirty = true; zeichnenAnfordern(); }
    };
    const ende = () => {
      ziel.removeEventListener("pointermove", move);
      ziel.removeEventListener("pointerup", ende);
      ziel.removeEventListener("pointercancel", ende);
      knotenVon(el) && knotenVon(el).classList.remove("wb-zieht");
      ziehVersatz.aktiv = false;
      const rdx = Math.round(dx), rdy = Math.round(dy);
      if (bewegt && (rdx || rdy)) {
        // Die ganze Auswahl war EINE Bewegung — also EIN Undo-Eintrag
        // (sonst hiesse "2 Elemente verschoben": zweimal Strg+Z).
        sammelnBeginnen();
        try {
          for (const e of betroffen) {
            const lage = lagen.get(e.id);
            const vorher = { x: e.x, y: e.y };
            e.x = Math.round(lage.x + rdx); e.y = Math.round(lage.y + rdy);
            undoMerken({ typ: "aendern", id: e.id, vorher, nachher: { x: e.x, y: e.y } });
            aenderungEinreihen(e, true);
            blockRendern(e);
          }
          for (const id of strichIds) strichVerschieben(id, rdx, rdy);
        } finally { sammelnAbschliessen(); }
      } else {
        // Nichts bewegt: Positionen zuruecksetzen (falls geklemmt gerundet).
        for (const e of betroffen) blockRendern(e);
      }
      betroffen.forEach((e) => { if (!elementKnoten.get(e.id) || !elementKnoten.get(e.id).contains(document.activeElement)) inArbeit.delete(e.id); });
      strichIds.forEach((id) => inArbeit.delete(id));
      tintenDirty = true; zeichnenAnfordern();
    };
    ziel.addEventListener("pointermove", move);
    ziel.addEventListener("pointerup", ende);
    ziel.addEventListener("pointercancel", ende);
  }

  // Einen Strich wirklich versetzen: Punkte umschreiben, EIN aendern.
  function strichVerschieben(id, dx, dy) {
    const el = elemente.get(id);
    if (!el || el.art !== "strich") return;
    const vorher = { x: el.x, y: el.y, inhalt: { punkte: el.inhalt.punkte.slice(), farbe: el.inhalt.farbe, dicke: el.inhalt.dicke } };
    const p = el.inhalt.punkte;
    for (let i = 0; i < p.length; i += 2) { p[i] += dx; p[i + 1] += dy; }
    el.x += dx; el.y += dy;
    el._pfad = null; el._pfadGrob = null;
    undoMerken({ typ: "aendern", id, vorher, nachher: { x: el.x, y: el.y, inhalt: { punkte: p.slice(), farbe: el.inhalt.farbe, dicke: el.inhalt.dicke } } });
    aenderungEinreihen(el, true);
  }

  // =================================================================
  // Ansicht: Segmente, Zoom-Knoepfe, Fit-Animationen
  // =================================================================

  const segmenteEl = $(".wb-segmente");
  let ansichtWahl = "mein";
  // Steht die Kamera noch auf dem unveraenderten Fit der gewaehlten
  // Ansicht? Nur dann fittet messen() bei Fenster-Resize nach; sobald
  // der Nutzer selbst zoomt oder schiebt, gehoert die Kamera ihm.
  let ansichtPassend = true;

  function segmenteBauen() {
    segmenteEl.innerHTML = "";
    const knopf = (id, text) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "wb-seg"; b.dataset.ziel = id;
      b.setAttribute("role", "tab");
      b.textContent = text;
      segmenteEl.appendChild(b);
    };
    knopf("mein", "Meine Tafel");
    for (const p of team) {
      if (p.id === ich.id) continue;
      knopf(p.id, p.name.split(" ")[0]);
    }
    knopf("alle", "Alle");
    segmenteEl.addEventListener("click", (ev) => {
      const b = ev.target.closest(".wb-seg");
      if (b) ansichtWechseln(b.dataset.ziel);
    });
  }
  segmenteBauen();

  function segmenteMarkieren() {
    $$(".wb-seg").forEach((b) => b.classList.toggle("wb-aktiv", b.dataset.ziel === ansichtWahl));
  }

  // Fit auf ein Rechteck in Weltkoordinaten — animiert ueber GSAP auf dem
  // ansicht-Objekt selbst. Unter reduced-motion (oder ohne gsap) springt
  // die Ansicht — ein kurzer Sprung ist dort die richtige Animation.
  let fitTween = null;
  // Zielansicht fuer ein Weltrechteck. Der Wunschrand schrumpft auf
  // schmalen Fenstern mit — 90 px Rand auf einem Telefon waeren die
  // halbe Tafel.
  // luftDeckel (optional): Hoechstmass an Leerraum UEBER dem Rechteck.
  // Auf Hochkant-Fenstern bindet die BREITE den Zoom einer einzelnen
  // Tafel — die halbe Restluft waere ein leeres Bildschirmdrittel ueber
  // der Wand (ueber Reihe 1 haengt nichts), waehrend unten die naechste
  // Reihe anschliesst: die Tafel wirkte "nach unten gerutscht". Der
  // Deckel zieht sie in die Mitte des sichtbaren Bereichs. Bindet die
  // HOEHE, ist die Restluft hoechstens 2*Rand (<= 180 px) — der Deckel
  // greift dann nie, Desktop-Fits bleiben pixelgleich.
  function fitZiel(x, y, b, h, rand, luftDeckel) {
    const R = Math.min(rand === undefined ? 90 : rand, breite * 0.07, hoehe * 0.09);
    const s = klemm(Math.min((breite - 2 * R) / b, (hoehe - 2 * R) / h), Math.max(0.02, minZoom()), ZOOM_MAX);
    let luftOben = (hoehe - h * s) / 2;
    if (luftDeckel !== undefined) luftOben = Math.min(luftOben, luftDeckel);
    return { s, tx: (breite - b * s) / 2 - x * s, ty: luftOben - y * s };
  }
  // Deckel nur fuer die Einzel-Tafel-Ansichten (mein / Person): Kopfzeile
  // plus Atem. "Alle" bleibt echt mittig — dort ist die ganze Wand im
  // Bild, Leerraum oben wie unten ist symmetrisch und wirkt ruhig.
  const fitLuftDeckel = (wahl) => (wahl === "alle" ? undefined : Math.max(96, hoehe * 0.16));
  function fitAuf(x, y, b, h, rand, luftDeckel) {
    const ziel = fitZiel(x, y, b, h, rand, luftDeckel);
    if (fitTween) { fitTween.kill(); fitTween = null; gesteBeenden(); }
    if (sanft || !gsap) {
      ansicht.s = ziel.s; ansicht.tx = ziel.tx; ansicht.ty = ziel.ty;
      panKlemmen(); aufPixelSnappen();
      return;
    }
    gesteBeginnen();
    fitTween = gsap.to(ansicht, {
      s: ziel.s, tx: ziel.tx, ty: ziel.ty,
      duration: 0.65, ease: "power3.inOut",
      onUpdate: anwenden,
      onComplete: () => { fitTween = null; panKlemmen(); gesteBeenden(); },
    });
  }

  // Das Weltrechteck einer benannten Ansicht — fuer den Fit-Klick und
  // fuers Nachfitten beim Fenster-Resize (messen).
  function ansichtRechteck(wahl) {
    if (wahl === "alle") return { x: 0, y: -120, b: WAND_B, h: WAND_H + 260 };
    const id = wahl === "mein" ? ich.id : wahl;
    const x = versatz.get(id);
    if (x === undefined) return null;
    // Rahmen, Schild und Ablage mit einrechnen: -100 oben, +110 unten.
    return { x: x - 40, y: versatzY.get(id) - 100, b: BOARD_B + 80, h: BOARD_H + 220 };
  }

  function ansichtWechseln(ziel) {
    ansichtWahl = ziel;
    segmenteMarkieren();
    const r = ansichtRechteck(ziel);
    if (!r) return;
    ansichtPassend = true;
    fitAuf(r.x, r.y, r.b, r.h, undefined, fitLuftDeckel(ziel));
  }

  function aufElementZoomen(el) {
    const bx = versatz.get(el.besitzer) || 0;
    const by = versatzY.get(el.besitzer) || 0;
    const b = Math.max(el.breite, 420), h = Math.max(el.hoehe || 200, 300);
    ansichtPassend = false; // Element-Fit ist keine benannte Ansicht
    fitAuf(el.x + bx - 60, el.y + by - 60, b + 120, h + 120, 60);
  }

  // Zoom um einen Schirmpunkt herum (Rad, Knoepfe, Pinch).
  function zoomUm(faktor, sx, sy) {
    const alt = ansicht.s;
    const neu = klemm(alt * faktor, Math.max(0.02, minZoom()), ZOOM_MAX);
    if (neu === alt) return;
    ansichtPassend = false;
    const w = schirmZuWelt(sx, sy);
    ansicht.s = neu;
    ansicht.tx = sx - w.x * neu;
    ansicht.ty = sy - w.y * neu;
    panKlemmen();
    anwenden();
    zoomAnzeigen();
  }

  const zoomStandEl = $(".wb-zoom-stand");
  let zoomStandWert = "";
  function zoomAnzeigen() {
    const wert = Math.round(ansicht.s * 100) + " %";
    if (wert !== zoomStandWert) { zoomStandWert = wert; zoomStandEl.textContent = wert; }
  }

  $(".wb-zoom-rein").addEventListener("click", () => { radGesteAnstossen(); zoomUm(1.25, breite / 2, hoehe / 2); });
  $(".wb-zoom-raus").addEventListener("click", () => { radGesteAnstossen(); zoomUm(0.8, breite / 2, hoehe / 2); });
  $(".wb-zoom-fit").addEventListener("click", () => ansichtWechseln("alle"));
  $(".wb-zoom-stand").addEventListener("click", () => {
    // 100 %: Zoom auf 1, Blickpunkt bleibt die Bildschirmmitte.
    ansichtPassend = false;
    const w = schirmZuWelt(breite / 2, hoehe / 2);
    if (fitTween) { fitTween.kill(); fitTween = null; gesteBeenden(); }
    if (sanft || !gsap) {
      ansicht.s = 1; ansicht.tx = breite / 2 - w.x; ansicht.ty = hoehe / 2 - w.y;
      panKlemmen(); aufPixelSnappen(); zoomAnzeigen();
      return;
    }
    gesteBeginnen();
    fitTween = gsap.to(ansicht, {
      s: 1, tx: breite / 2 - w.x, ty: hoehe / 2 - w.y,
      duration: 0.5, ease: "power3.inOut", onUpdate: anwenden,
      onComplete: () => { fitTween = null; panKlemmen(); gesteBeenden(); zoomAnzeigen(); },
    });
  });

  // =================================================================
  // Werkzeuge: Umschaltung + Cursor
  // =================================================================

  function stiftWaehlen(farbe) {
    stiftFarbe = farbe;
    werkzeugSetzen("stift");
  }

  function werkzeugSetzen(neu) {
    werkzeug = neu;
    flaeche.dataset.werkzeug = neu;
    $$(".wb-leiste .wb-knopf[data-werkzeug]").forEach((b) =>
      b.classList.toggle("wb-aktiv", b.dataset.werkzeug === neu));
    $(".wb-kontext-stift").hidden = neu !== "stift";
    $(".wb-kontext-notiz").hidden = neu !== "notiz";
    $(".wb-kontext-trenner").hidden = neu !== "stift" && neu !== "notiz";
    // Der Schwammkreis erscheint erst mit der ersten Mausbewegung — sonst
    // staende er nach dem Umschalten verloren in der Ecke.
    schwammKreis.hidden = true;
    kontextMarkieren();
    ablagenMarkieren();
    cursorSetzen();
  }

  function kontextMarkieren() {
    $$(".wb-kontext-farben .wb-farbe").forEach((b) => b.classList.toggle("wb-aktiv", b.dataset.farbe === stiftFarbe));
    $$(".wb-kontext-dicken .wb-dicke").forEach((b) => b.classList.toggle("wb-aktiv", b.dataset.dicke === stiftDicke));
    $$(".wb-kontext-notiz .wb-zettelwahl").forEach((b) => b.classList.toggle("wb-aktiv", b.dataset.zettel === zettelFarbe));
  }

  // Die Ablage am eigenen Board spiegelt die Wahl: der aktive Marker ist
  // herausgenommen (angehoben), der Schwamm ebenso.
  function ablagenMarkieren() {
    const k = boardKnoten.get(ich.id);
    if (!k) return;
    $$(".wb-marker", k.ablage).forEach((m) =>
      m.classList.toggle("wb-aktiv", werkzeug === "stift" && m.dataset.farbe === stiftFarbe));
    const sw = $(".wb-schwammknopf", k.ablage);
    if (sw) sw.classList.toggle("wb-aktiv", werkzeug === "schwamm");
  }

  $(".wb-leiste").addEventListener("click", (ev) => {
    const wk = ev.target.closest("[data-werkzeug]");
    if (wk) { werkzeugSetzen(wk.dataset.werkzeug); return; }
    const farbe = ev.target.closest(".wb-kontext-farben .wb-farbe");
    if (farbe) { stiftFarbe = farbe.dataset.farbe; kontextMarkieren(); ablagenMarkieren(); cursorSetzen(); return; }
    const dicke = ev.target.closest(".wb-dicke");
    if (dicke) { stiftDicke = dicke.dataset.dicke; kontextMarkieren(); return; }
    const zettel = ev.target.closest(".wb-zettelwahl");
    if (zettel) { zettelFarbe = zettel.dataset.zettel; kontextMarkieren(); return; }
    if (ev.target.closest(".wb-undo")) { undoAusfuehren(); return; }
    if (ev.target.closest(".wb-redo")) { redoAusfuehren(); return; }
    if (ev.target.closest(".wb-hilfe-knopf")) { hilfeUmschalten(); }
  });

  // Das Hilfe-Popover gehoert optisch zu seinem ?-Knopf: beim Oeffnen
  // die rechten Kanten buendig stellen statt es in die Raumecke zu
  // setzen. Am Telefon regelt die Media-Query die Lage (volle Breite).
  function hilfeUmschalten() {
    const h = $(".wb-hilfe");
    if (!h.hidden) { h.hidden = true; return; }
    if (istMobil()) {
      h.style.right = "";
    } else {
      const k = $(".wb-hilfe-knopf").getBoundingClientRect();
      const r = raum.getBoundingClientRect();
      h.style.right = Math.max(10, Math.round(r.right - k.right)) + "px";
    }
    h.hidden = false;
  }

  // Stift-Cursor: eine kleine Stiftspitze in der gewaehlten Farbe. Als
  // Daten-URI gebaut — extern laden waere ein Netzaufruf fuer nichts.
  function cursorSetzen() {
    if (werkzeug === "stift") {
      const f = encodeURIComponent(tinte(stiftFarbe));
      leinwand.style.cursor = "url(\"data:image/svg+xml," +
        encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><path d="M3 23l2.2-6.4L17.6 4.2a2.4 2.4 0 0 1 3.4 0l0.8 0.8a2.4 2.4 0 0 1 0 3.4L9.4 20.8z" fill="') +
        f + encodeURIComponent('" stroke="white" stroke-width="1.4"/></svg>') +
        "\") 3 23, crosshair";
    } else if (werkzeug === "schwamm") {
      leinwand.style.cursor = "none";
    } else {
      leinwand.style.cursor = "";
    }
  }

  // =================================================================
  // Eingabe auf der Flaeche: Pan/Zoom, Auswahl, Platzieren
  // =================================================================

  let leertaste = false;
  const aktivePointer = new Map();         // pointerId -> {x,y} (Schirm)
  let pinch = null;                        // {abstand, mitte, s0, tx0, ty0}
  let pan = null;                          // {x0,y0,tx0,ty0,pointerId}
  let marquee = null;                      // {x0,y0} Welt
  const fremdHinweisZuletzt = new Map();   // boardId -> ms des letzten Hinweises

  // Rad: Zoom auf den Mauszeiger; Shift+Rad faehrt seitwaerts an der Wand
  // entlang. passive:false ist Pflicht — Chromium macht Wheel-Listener
  // sonst passiv, und preventDefault verhallt (Seite zoomt/scrollt mit).
  flaeche.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const p = ereignisZuSchirm(ev);
    radGesteAnstossen();
    if (ev.shiftKey && !ev.ctrlKey) {
      const d = (ev.deltaY || ev.deltaX) * (ev.deltaMode === 1 ? 24 : 1);
      ansicht.tx -= d;
      ansichtPassend = false;
      panKlemmen(); anwenden();
      return;
    }
    const roh = ev.deltaY * (ev.deltaMode === 1 ? 24 : 1);
    // Trackpad-Pinch kommt als ctrl+wheel mit kleinen Deltas — feinere
    // Uebersetzung, sonst springt der Zoom.
    const staerke = ev.ctrlKey ? 0.012 : 0.0022;
    zoomUm(Math.exp(-roh * staerke), p.x, p.y);
  }, { passive: false });

  // Leertaste: gedrueckt halten = Schieben. Nicht, wenn gerade getippt wird.
  window.addEventListener("keydown", (ev) => {
    if (ev.code === "Space" && !imTextfeld(ev.target) && !leertaste) {
      leertaste = true;
      flaeche.classList.add("wb-greifbar");
      ev.preventDefault();
    }
  });
  window.addEventListener("keyup", (ev) => {
    if (ev.code === "Space") {
      leertaste = false;
      flaeche.classList.remove("wb-greifbar");
    }
  });

  function imTextfeld(ziel) {
    return ziel && (ziel.isContentEditable || ziel.tagName === "INPUT" || ziel.tagName === "TEXTAREA");
  }

  function panStarten(ev) {
    pan = { x0: ev.clientX, y0: ev.clientY, tx0: ansicht.tx, ty0: ansicht.ty, pointerId: ev.pointerId };
    flaeche.classList.add("wb-greift");
    gesteBeginnen();
    try { flaeche.setPointerCapture(ev.pointerId); } catch { /* egal */ }
  }
  function panBewegen(ev) {
    if (!pan || ev.pointerId !== pan.pointerId) return;
    ansicht.tx = pan.tx0 + (ev.clientX - pan.x0);
    ansicht.ty = pan.ty0 + (ev.clientY - pan.y0);
    ansichtPassend = false;
    panKlemmen();
    anwenden();
  }
  function panBeenden() {
    if (!pan) return;
    pan = null;
    flaeche.classList.remove("wb-greift");
    gesteBeenden();
  }

  // ---- Pointer auf der FLAECHE (Auswahl, Pan, Platzieren, Pinch).
  flaeche.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".wb-kopf,.wb-leiste,.wb-hilfe,.wb-toasts,.wb-schild,.wb-wischenknopf,.wb-ablage,.wb-kasten,.wb-griff,.wb-zeile-tools,.wb-abhaken")) return;
    $(".wb-hilfe").hidden = true;

    aktivePointer.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    // Zwei Finger: immer Pan+Pinch, egal welches Werkzeug.
    if (ev.pointerType === "touch" && aktivePointer.size === 2) {
      marqueeAbbrechen();
      panBeenden();
      pinchStarten();
      return;
    }

    // Mittlere Maustaste oder Leertaste: Schieben.
    if (ev.button === 1 || leertaste) {
      ev.preventDefault();
      panStarten(ev);
      return;
    }
    if (ev.button !== 0) return;

    if (werkzeug === "auswahl") {
      // Am Telefon schiebt der eine Finger die Wand — Marquee ist ein
      // Maus-Werkzeug, und Antippen waehlt praezise genug aus.
      if (ev.pointerType === "touch") {
        const traf = elementTreffer(ev);
        if (!traf) { panStarten(ev); return; }
      }
      auswahlPointer(ev);
    } else if (werkzeug === "text" || werkzeug === "notiz") {
      platzieren(ev);
    }
  });

  flaeche.addEventListener("pointermove", (ev) => {
    const merk = aktivePointer.get(ev.pointerId);
    if (merk) { merk.x = ev.clientX; merk.y = ev.clientY; }
    if (pinch) { pinchBewegen(); return; }
    if (pan) { panBewegen(ev); return; }
    if (marquee) marqueeBewegen(ev);
  });

  const pointerLoslassen = (ev) => {
    aktivePointer.delete(ev.pointerId);
    if (pinch && aktivePointer.size < 2) { pinch = null; gesteBeenden(); }
    if (pan && ev.pointerId === pan.pointerId) panBeenden();
    if (marquee) marqueeBeenden(ev);
  };
  flaeche.addEventListener("pointerup", pointerLoslassen);
  flaeche.addEventListener("pointercancel", pointerLoslassen);

  // ---- Pinch (zwei Finger): Pan + Zoom in einem.
  function pinchStarten() {
    if (pinch) return;
    const [a, b] = [...aktivePointer.values()];
    const r = rectHolen();
    pinch = {
      abstand: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top,
      s0: ansicht.s, tx0: ansicht.tx, ty0: ansicht.ty,
    };
    gesteBeginnen();
  }
  function pinchBewegen() {
    const werte = [...aktivePointer.values()];
    if (werte.length < 2) return;
    const [a, b] = werte;
    const r = rectHolen();
    const abstand = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    const f = abstand / pinch.abstand;
    const s = klemm(pinch.s0 * f, Math.max(0.02, minZoom()), ZOOM_MAX);
    const echteF = s / pinch.s0;
    // Der Weltpunkt unter der Fingermitte bleibt unter der Fingermitte.
    ansichtPassend = false;
    ansicht.s = s;
    ansicht.tx = mx - (pinch.mx - pinch.tx0) * echteF;
    ansicht.ty = my - (pinch.my - pinch.ty0) * echteF;
    panKlemmen();
    anwenden();
    zoomAnzeigen();
  }

  // =================================================================
  // Auswahl: Klick, Shift-Klick, Marquee, Verschieben, Entf
  // =================================================================

  function auswahlAnzeigen() {
    for (const [id, knoten] of elementKnoten) knoten.classList.toggle("wb-gewaehlt", auswahl.has(id));
    tintenDirty = true; zeichnenAnfordern();
  }
  function auswahlLeeren() {
    if (!auswahl.size) return;
    auswahl.clear();
    auswahlAnzeigen();
  }

  // Was liegt unter dem Zeiger? Erst DOM-Bloecke (oben), dann Striche.
  // Fremde Elemente sind bewusst NIE Treffer.
  function elementTreffer(ev) {
    const blockKnoten = ev.target.closest && ev.target.closest(".wb-el");
    if (blockKnoten && blockKnoten.closest(".wb-board.wb-eigen")) {
      return elemente.get(blockKnoten.dataset.id) || null;
    }
    const w = ereignisZuWelt(ev);
    return strichTreffer(w, 6 / ansicht.s);
  }

  // Punkt-zu-Strich: bbox-Vorfilter, dann Abstand Punkt->Segment.
  function strichTreffer(w, toleranz) {
    const striche = stricheJeBoard.get(ich.id);
    const bx = versatz.get(ich.id), by = versatzY.get(ich.id);
    const x = w.x - bx, y = w.y - by;
    for (let i = striche.length - 1; i >= 0; i--) {
      const el = striche[i];
      const r = toleranz + el.inhalt.dicke / 2;
      if (x < el.x - r || x > el.x + el.breite + r || y < el.y - r || y > el.y + el.hoehe + r) continue;
      if (strichAbstandOk(el, x, y, r)) return el;
    }
    return null;
  }

  function strichAbstandOk(el, x, y, r) {
    const p = el.inhalt.punkte;
    const r2 = r * r;
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (segmentAbstand2(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r2) return true;
    }
    if (p.length === 2) {
      const dx = x - p[0], dy = y - p[1];
      return dx * dx + dy * dy <= r2;
    }
    return false;
  }

  function segmentAbstand2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = klemm(t, 0, 1);
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  }

  function auswahlPointer(ev) {
    const treffer = elementTreffer(ev);
    if (treffer) {
      if (ev.shiftKey) {
        if (auswahl.has(treffer.id)) auswahl.delete(treffer.id); else auswahl.add(treffer.id);
        auswahlAnzeigen();
        return;
      }
      if (!auswahl.has(treffer.id)) { auswahl.clear(); auswahl.add(treffer.id); auswahlAnzeigen(); }
      // Striche (und Mehrfachauswahl) zieht man direkt an; Bloecke haben
      // ihren Griff, reagieren aber auch auf direktes Ziehen am Rand.
      if (treffer.art === "strich") {
        strichAuswahlZiehen(ev);
      }
      return;
    }
    // Leere Flaeche: Marquee aufziehen (Maus) bzw. Auswahl loesen.
    if (!ev.shiftKey) auswahlLeeren();
    marquee = { x0: ev.clientX, y0: ev.clientY, zusatz: ev.shiftKey };
    try { flaeche.setPointerCapture(ev.pointerId); } catch { /* egal */ }
  }

  // Gewaehlte Striche per Drag verschieben (ohne DOM-Griff): gleiche
  // Mechanik wie blockZiehen, nur ueber den Canvas-Zeichenversatz.
  function strichAuswahlZiehen(startEv) {
    const start = ereignisZuWelt(startEv);
    const ids = [...auswahl];
    const bloecke = ids.map((id) => elemente.get(id)).filter((e) => e && e.art !== "strich");
    const striche = ids.map((id) => elemente.get(id)).filter((e) => e && e.art === "strich");
    if (!striche.length && !bloecke.length) return;
    ids.forEach((id) => inArbeit.add(id));
    const lagen = new Map(bloecke.map((e) => [e.id, { x: e.x, y: e.y }]));
    ziehVersatz.aktiv = true; ziehVersatz.dx = 0; ziehVersatz.dy = 0;
    try { flaeche.setPointerCapture(startEv.pointerId); } catch { /* egal */ }
    let dx = 0, dy = 0, bewegt = false;

    const move = (ev) => {
      if (ev.pointerId !== startEv.pointerId) return;
      const p = ereignisZuWelt(ev);
      dx = p.x - start.x; dy = p.y - start.y;
      for (const e of striche) {
        dx = klemm(dx, -e.x, BOARD_B - e.breite - e.x);
        dy = klemm(dy, -e.y, BOARD_H - e.hoehe - e.y);
      }
      for (const e of bloecke) {
        const lage = lagen.get(e.id);
        dx = klemm(dx, -lage.x, BOARD_B - e.breite - lage.x);
        dy = klemm(dy, -lage.y, BOARD_H - Math.min(e.hoehe || 60, BOARD_H) - lage.y);
      }
      bewegt = bewegt || Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
      ziehVersatz.dx = dx; ziehVersatz.dy = dy;
      for (const e of bloecke) {
        const lage = lagen.get(e.id);
        const k = elementKnoten.get(e.id);
        if (k) { k.style.left = (lage.x + dx) + "px"; k.style.top = (lage.y + dy) + "px"; }
      }
      tintenDirty = true; zeichnenAnfordern();
    };
    const ende = (ev) => {
      if (ev.pointerId !== startEv.pointerId) return;
      flaeche.removeEventListener("pointermove", move);
      flaeche.removeEventListener("pointerup", ende);
      flaeche.removeEventListener("pointercancel", ende);
      ziehVersatz.aktiv = false;
      const rdx = Math.round(dx), rdy = Math.round(dy);
      if (bewegt && (rdx || rdy)) {
        // Wie beim Griff-Drag: eine Bewegung, ein Undo-Eintrag.
        sammelnBeginnen();
        try {
          for (const e of striche) strichVerschieben(e.id, rdx, rdy);
          for (const e of bloecke) {
            const lage = lagen.get(e.id);
            const vorher = { x: e.x, y: e.y };
            e.x = Math.round(lage.x + rdx); e.y = Math.round(lage.y + rdy);
            undoMerken({ typ: "aendern", id: e.id, vorher, nachher: { x: e.x, y: e.y } });
            aenderungEinreihen(e, true);
            blockRendern(e);
          }
        } finally { sammelnAbschliessen(); }
      }
      ids.forEach((id) => inArbeit.delete(id));
      tintenDirty = true; zeichnenAnfordern();
    };
    flaeche.addEventListener("pointermove", move);
    flaeche.addEventListener("pointerup", ende);
    flaeche.addEventListener("pointercancel", ende);
  }

  function marqueeBewegen(ev) {
    const r = rectHolen();
    const x0 = Math.min(marquee.x0, ev.clientX) - r.left, y0 = Math.min(marquee.y0, ev.clientY) - r.top;
    const b = Math.abs(ev.clientX - marquee.x0), h = Math.abs(ev.clientY - marquee.y0);
    marqueeEl.hidden = b < 3 && h < 3;
    marqueeEl.style.left = x0 + "px"; marqueeEl.style.top = y0 + "px";
    marqueeEl.style.width = b + "px"; marqueeEl.style.height = h + "px";
  }

  function marqueeBeenden(ev) {
    const r = rectHolen();
    const a = schirmZuWelt(Math.min(marquee.x0, ev.clientX) - r.left, Math.min(marquee.y0, ev.clientY) - r.top);
    const z = schirmZuWelt(Math.max(marquee.x0, ev.clientX) - r.left, Math.max(marquee.y0, ev.clientY) - r.top);
    const zusatz = marquee.zusatz;
    marqueeAbbrechen();
    if (Math.abs(z.x - a.x) < 4 && Math.abs(z.y - a.y) < 4) return;
    if (!zusatz) auswahl.clear();
    // Bounding-Box-Schnitt ueber ALLE eigenen Elemente — Striche wie Bloecke.
    const bx = versatz.get(ich.id), by = versatzY.get(ich.id);
    for (const el of elemente.values()) {
      if (el.besitzer !== ich.id) continue;
      const ex0 = el.x + bx, ey0 = el.y + by, ex1 = ex0 + el.breite, ey1 = ey0 + (el.hoehe || 40);
      if (ex0 <= z.x && ex1 >= a.x && ey0 <= z.y && ey1 >= a.y) auswahl.add(el.id);
    }
    auswahlAnzeigen();
  }

  function marqueeAbbrechen() {
    marquee = null;
    marqueeEl.hidden = true;
  }

  // Entf loescht die Auswahl — aber nie, waehrend in einer Zeile getippt wird.
  window.addEventListener("keydown", (ev) => {
    if ((ev.key === "Delete" || ev.key === "Backspace") && auswahl.size && !imTextfeld(ev.target)) {
      ev.preventDefault();
      elementLoeschen([...auswahl]);
    }
  });

  // =================================================================
  // Text & Notiz platzieren
  // =================================================================

  function fremdHinweis(boardId) {
    // Entprellt wiederholen statt einmal je Sitzung: wer spaeter nochmal
    // auf Janniks Tafel malt, soll wieder hoeren WARUM nichts passiert —
    // ein stummer Stift wirkt kaputt.
    const jetzt = Date.now();
    if ((fremdHinweisZuletzt.get(boardId) || 0) > jetzt - 5000) return;
    fremdHinweisZuletzt.set(boardId, jetzt);
    const person = team.find((p) => p.id === boardId);
    toast("Nur ansehen — das ist " + (person ? person.name.split(" ")[0] + "s" : "eine fremde") + " Tafel.");
  }

  function platzieren(ev) {
    const w = ereignisZuWelt(ev);
    const boardId = boardAnPunkt(w);
    if (!boardId) return;
    if (boardId !== ich.id) { fremdHinweis(boardId); return; }
    // Ohne preventDefault nimmt das Standard-mousedown dem frisch
    // fokussierten Span den Fokus sofort wieder weg — der neue Block
    // waere leer, und leer heisst beim Verlassen: geloescht.
    ev.preventDefault();

    const bx = versatz.get(ich.id), by = versatzY.get(ich.id);
    const istNotiz = werkzeug === "notiz";
    const breiteNeu = istNotiz ? 340 : 520;
    const el = {
      id: crypto.randomUUID(),
      besitzer: ich.id,
      art: istNotiz ? "notiz" : "text",
      x: klemm(Math.round(w.x - bx - (istNotiz ? breiteNeu / 2 : 20)), 0, BOARD_B - breiteNeu),
      y: klemm(Math.round(w.y - by - (istNotiz ? 60 : 24)), 0, BOARD_H - 120),
      breite: breiteNeu,
      hoehe: istNotiz ? 200 : 60,
      version: 1,
      inhalt: istNotiz
        ? { zeilen: [{ t: "", erledigt: false, gestrichen: false }], liste: "keine", farbe: stiftFarbe, groesse: 24, zettel: zettelFarbe }
        : { zeilen: [{ t: "", erledigt: false, gestrichen: false }], liste: "keine", farbe: stiftFarbe, groesse: 28 },
    };
    elemente.set(el.id, el);
    inArbeit.add(el.id);
    blockRendern(el);
    anlegenEinreihen(el);
    undoMerken({ typ: "anlegen", id: el.id });
    werkzeugSetzen("auswahl");
    // Sofort lostippen: Fokus in die erste Zeile.
    const knoten = elementKnoten.get(el.id);
    const span = knoten && $(".wb-zeile-text", knoten);
    if (span) {
      if (istMobil()) { mobilOeffnen(el); }
      else if (ansicht.s < ZOOM_TEXT_MIN) { aufElementZoomen(el); setTimeout(() => caretSetzen(span, 0), sanft ? 0 : 700); }
      else caretSetzen(span, 0);
    }
  }

  // Doppelklick mit Auswahl-Werkzeug: bei kleiner Ansicht heranzoomen
  // (In-Place-Bearbeitung beginnt der Klick in den Block von selbst).
  flaeche.addEventListener("dblclick", (ev) => {
    if (werkzeug !== "auswahl") return;
    if (ev.target.closest(".wb-el")) return; // regelt der Block selbst
    const treffer = elementTreffer(ev);
    if (treffer && treffer.art === "strich") aufElementZoomen(treffer);
  });

  // =================================================================
  // Stift: Zeichnen auf dem Canvas
  // =================================================================
  //
  // Der Strich hat KONSTANTE Breite: Stiftdruck darf hoechstens beim
  // Aufsetzen die Dicke des ganzen Strichs waehlen, nie pro Punkt —
  // ein Whiteboard-Marker ist kein Pinsel. Geglaettet wird zweifach:
  // EMA auf den Eingabepunkten (Maus zittriger als Stift, darum
  // unterschiedliches Alpha) und Midpoint-Quadratic beim Zeichnen.

  let zeichnung = null; // {punkte, ema:{x,y}, alpha, boardId, pointerId, dickeWelt}

  // Die Canvas-Listener stoppen die Weitergabe: dasselbe pointerdown
  // wuerde sonst zusaetzlich den Flaechen-Listener erreichen (der Canvas
  // ist dessen Kind) und Pan/Pinch doppelt starten.
  leinwand.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    if (ev.button !== 0 && ev.pointerType !== "touch" && ev.pointerType !== "pen") return;
    if (leertaste || ev.button === 1) { panStarten(ev); return; }
    aktivePointer.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ev.pointerType === "touch" && aktivePointer.size === 2) {
      // Zweiter Finger: die begonnene Zeichnung nach der 5-Punkte-Regel
      // abschliessen und in den Pinch wechseln.
      zeichnungAbschliessen(true);
      pinchStarten();
      return;
    }
    // Mit Stift/Schwamm in der Hand liegt der Canvas ueber ALLEM — auch
    // ueber Ablage und Wischen-Knopf. NEBEN der Tafel wird aber nie
    // gezeichnet: dort den Klick an das Bedien-Element darunter
    // durchreichen, sonst kaeme man beim Zeichnen nie an den naechsten
    // Marker (die Ablage IST der Farbwaehler). Fremde Ablagen stehen auf
    // pointer-events:none und tauchen hier gar nicht erst auf.
    if (boardAnPunkt(ereignisZuWelt(ev)) === null) {
      for (const d of document.elementsFromPoint(ev.clientX, ev.clientY)) {
        if (!d.closest || !d.closest(".wb-board.wb-eigen")) continue;
        const marker = d.closest(".wb-marker");
        if (marker) { stiftWaehlen(marker.dataset.farbe); return; }
        if (d.closest(".wb-schwammknopf")) { werkzeugSetzen("schwamm"); return; }
        if (d.closest(".wb-wischenknopf")) { wischenFragen(); return; }
      }
    }
    if (werkzeug === "stift") stiftAnsetzen(ev);
    else if (werkzeug === "schwamm") schwammAnsetzen(ev);
  });

  leinwand.addEventListener("pointermove", (ev) => {
    ev.stopPropagation();
    const merk = aktivePointer.get(ev.pointerId);
    if (merk) { merk.x = ev.clientX; merk.y = ev.clientY; }
    if (pinch) { pinchBewegen(); return; }
    if (pan) { panBewegen(ev); return; }
    if (zeichnung && ev.pointerId === zeichnung.pointerId) stiftBewegen(ev);
    else if (schwammZug && ev.pointerId === schwammZug.pointerId) schwammBewegen(ev);
    else if (werkzeug === "schwamm") schwammKreisSetzen(ev);
    else if (werkzeug === "stift") stiftCursorPruefen(ev);
  });

  const leinwandLoslassen = (ev) => {
    ev.stopPropagation();
    aktivePointer.delete(ev.pointerId);
    if (pinch && aktivePointer.size < 2) { pinch = null; gesteBeenden(); }
    if (pan && ev.pointerId === pan.pointerId) { panBeenden(); return; }
    if (zeichnung && ev.pointerId === zeichnung.pointerId) {
      // pointercancel (Handflaeche, Systemgeste): mit mehr als 5 Punkten
      // ist es ein gewollter Strich — committen; weniger ist ein Wischer.
      zeichnungAbschliessen(ev.type === "pointercancel");
    }
    if (schwammZug && ev.pointerId === schwammZug.pointerId) schwammLoslassen(ev.type === "pointercancel");
  };
  leinwand.addEventListener("pointerup", leinwandLoslassen);
  leinwand.addEventListener("pointercancel", leinwandLoslassen);
  leinwand.addEventListener("pointerleave", () => {
    if (werkzeug === "schwamm" && !schwammZug) schwammKreis.hidden = true;
  });

  function stiftCursorPruefen(ev) {
    const w = ereignisZuWelt(ev);
    const boardId = boardAnPunkt(w);
    leinwand.style.cursor = boardId && boardId !== ich.id ? "not-allowed" : "";
    if (!leinwand.style.cursor) cursorSetzen();
  }

  function stiftAnsetzen(ev) {
    const w = ereignisZuWelt(ev);
    const boardId = boardAnPunkt(w);
    if (boardId !== ich.id) {
      if (boardId) fremdHinweis(boardId);
      return;
    }
    try { leinwand.setPointerCapture(ev.pointerId); } catch { /* egal */ }
    const bx = versatz.get(ich.id), by = versatzY.get(ich.id);
    zeichnung = {
      pointerId: ev.pointerId,
      punkte: [klemm(w.x - bx, 0, BOARD_B), klemm(w.y - by, 0, BOARD_H)],
      ema: { x: w.x - bx, y: w.y - by },
      // Stift in der Hand zittert weniger als eine Maus — die Maus wird
      // staerker geglaettet (kleineres Alpha = mehr Traegheit).
      alpha: ev.pointerType === "pen" ? 0.7 : 0.4,
      minAbstand: 1.5 / ansicht.s, // 1,5 BILDSCHIRM-px
      farbe: stiftFarbe,
      dicke: DICKEN[stiftDicke],
      besitzer: ich.id,
    };
    liveStrich = zeichnung;
  }

  function stiftBewegen(ev) {
    const bx = versatz.get(ich.id), by = versatzY.get(ich.id);
    // getCoalescedEvents: der Browser buendelt bei 120+-Hz-Eingabe mehrere
    // Messpunkte in ein Event — ohne sie wuerde jede schnelle Kurve eckig.
    const roh = (typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : null) || [ev];
    let neu = false;
    for (const e of roh) {
      const w = ereignisZuWelt(e);
      const zx = klemm(w.x - bx, 0, BOARD_B), zy = klemm(w.y - by, 0, BOARD_H);
      zeichnung.ema.x += (zx - zeichnung.ema.x) * zeichnung.alpha;
      zeichnung.ema.y += (zy - zeichnung.ema.y) * zeichnung.alpha;
      const p = zeichnung.punkte;
      const lx = p[p.length - 2], ly = p[p.length - 1];
      const dx = zeichnung.ema.x - lx, dy = zeichnung.ema.y - ly;
      if (dx * dx + dy * dy < zeichnung.minAbstand * zeichnung.minAbstand) continue;
      p.push(zeichnung.ema.x, zeichnung.ema.y);
      neu = true;
      // Server-Grenze: bei ~2900 Stuetzpunkten den Strich teilen und
      // nahtlos einen neuen beginnen — der Uebergangspunkt ist doppelt.
      if (p.length / 2 >= MAX_PUNKTE_JE_STRICH) {
        const letzterX = p[p.length - 2], letzterY = p[p.length - 1];
        zeichnungFestschreiben();
        zeichnung.punkte = [letzterX, letzterY];
        liveStrich = zeichnung;
      }
    }
    if (neu) liveSegmentZeichnen();
  }

  function zeichnungAbschliessen(abgebrochen) {
    if (!zeichnung) return;
    const zuWenig = zeichnung.punkte.length < (abgebrochen ? 12 : 4);
    if (!zuWenig) zeichnungFestschreiben();
    zeichnung = null;
    liveStrich = null;
    tintenDirty = true; zeichnenAnfordern();
  }

  // Den aktuellen Live-Strich als Element festschreiben und speichern.
  function zeichnungFestschreiben() {
    const punkte = zeichnung.punkte.map(Math.round);
    if (punkte.length < 4) {
      // Ein Punkt ist ein Tupfer: zweiter Punkt minimal daneben, damit
      // der Server (min. 4 Zahlen) und lineCap:round einen Punkt malen.
      punkte.push(punkte[0] + 1, punkte[1]);
    }
    const bbox = strichBbox(punkte, zeichnung.dicke);
    const el = {
      id: crypto.randomUUID(),
      besitzer: ich.id,
      art: "strich",
      x: bbox.x, y: bbox.y, breite: bbox.breite, hoehe: bbox.hoehe,
      version: 1,
      inhalt: { punkte, farbe: zeichnung.farbe, dicke: zeichnung.dicke },
    };
    elemente.set(el.id, el);
    stricheJeBoard.get(ich.id).push(el);
    anlegenEinreihen(el);
    undoMerken({ typ: "anlegen", id: el.id });
    schilderAuffrischen();
  }

  // =================================================================
  // Schwamm: ganze Striche wegwischen
  // =================================================================
  //
  // Der Radius ist in BILDSCHIRM-px konstant (wird durch s geteilt): der
  // Schwamm in der Hand ist immer gleich gross, egal wie nah man an der
  // Wand steht. Die Bewegung wird in Radius/2-Schritten interpoliert,
  // damit eine schnelle Wischbewegung keine Striche ueberspringt.
  // Getroffene Striche blassen erst ab (Vorschau) — geloescht wird beim
  // Loslassen, EIN Undo-Eintrag fuer die ganze Wischbewegung.

  let schwammZug = null; // {pointerId, letzte:{x,y} Welt}

  function schwammKreisSetzen(ev) {
    const p = ereignisZuSchirm(ev);
    schwammKreis.hidden = false;
    schwammKreis.style.left = p.x + "px";
    schwammKreis.style.top = p.y + "px";
    schwammKreis.style.width = (SCHWAMM_RADIUS_PX * 2) + "px";
    schwammKreis.style.height = (SCHWAMM_RADIUS_PX * 2) + "px";
  }

  function schwammAnsetzen(ev) {
    const w = ereignisZuWelt(ev);
    const boardId = boardAnPunkt(w);
    if (boardId && boardId !== ich.id) { fremdHinweis(boardId); return; }
    try { leinwand.setPointerCapture(ev.pointerId); } catch { /* egal */ }
    schwammZug = { pointerId: ev.pointerId, letzte: w };
    schwammKreisSetzen(ev);
    schwammTreffen(w);
  }

  function schwammBewegen(ev) {
    schwammKreisSetzen(ev);
    const w = ereignisZuWelt(ev);
    const radius = SCHWAMM_RADIUS_PX / ansicht.s;
    const schritt = radius / 2;
    let { x, y } = schwammZug.letzte;
    const dx = w.x - x, dy = w.y - y;
    const strecke = Math.hypot(dx, dy);
    const schritte = Math.max(1, Math.ceil(strecke / schritt));
    for (let i = 1; i <= schritte; i++) {
      schwammTreffen({ x: x + (dx * i) / schritte, y: y + (dy * i) / schritte });
    }
    schwammZug.letzte = w;
  }

  function schwammTreffen(w) {
    const radius = SCHWAMM_RADIUS_PX / ansicht.s;
    const bx = versatz.get(ich.id), by = versatzY.get(ich.id);
    const x = w.x - bx, y = w.y - by;
    const striche = stricheJeBoard.get(ich.id);
    let neu = false;
    for (const el of striche) {
      if (schwammOpfer.has(el.id)) continue;
      const r = radius + el.inhalt.dicke / 2;
      if (x < el.x - r || x > el.x + el.breite + r || y < el.y - r || y > el.y + el.hoehe + r) continue;
      if (strichAbstandOk(el, x, y, r)) { schwammOpfer.add(el.id); neu = true; }
    }
    if (neu) { tintenDirty = true; zeichnenAnfordern(); }
  }

  function schwammLoslassen(abgebrochen) {
    schwammZug = null;
    if (abgebrochen || !schwammOpfer.size) {
      schwammOpfer.clear();
      tintenDirty = true; zeichnenAnfordern();
      return;
    }
    const ids = [...schwammOpfer];
    schwammOpfer.clear();
    elementLoeschen(ids);
  }

  // =================================================================
  // Speichern: optimistisch, je Element serialisiert, Beacon beim Gehen
  // =================================================================
  //
  // Pro Element laeuft EINE Promise-Kette: anlegen kommt garantiert vor
  // dem ersten aendern an, zwei schnelle aenderungen ueberholen sich
  // nicht. "ausstehend" haelt fuer pagehide den jeweils letzten Stand —
  // sendBeacon uebertraegt ihn auch dann noch, wenn der Tab schon faellt.

  const ketten = new Map();        // id -> Promise (Sende-Reihenfolge je Element)
  const ausstehend = new Map();    // id -> {pfad, body} letzter ungesendeter Stand
  const entprellt = new Map();     // id -> Timeout des 800-ms-Entprellers
  let speicherFehler = 0;          // in Folge; ab 3 wird neu geladen
  let sitzungWeg = false;

  function kette(id, arbeit) {
    const bisher = ketten.get(id) || Promise.resolve();
    const neu = bisher.then(arbeit).catch(() => {});
    ketten.set(id, neu);
    return neu;
  }

  async function senden(pfad, body) {
    const antwort = await fetch(pfad, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let daten = null;
    try { daten = await antwort.json(); } catch { /* leere Antwort */ }
    if (antwort.status === 401 || (daten && daten.anmeldung)) { sitzungAbgelaufen(); throw new Error("anmeldung"); }
    return { status: antwort.status, daten: daten || {} };
  }

  function sitzungAbgelaufen() {
    if (sitzungWeg) return;
    sitzungWeg = true;
    $(".wb-anmelden").hidden = false;
  }

  function speicherfehlerZaehlen() {
    speicherFehler++;
    if (speicherFehler === 1) toast("Speichern fehlgeschlagen — Verbindung prüfen.");
    if (speicherFehler >= 3) {
      // Hauskonvention: ein Zustand, der dem Server dauerhaft davonlaeuft,
      // ist gefaehrlicher als ein Neuladen. Der Nutzer sieht warum.
      toast("Speichern klappt weiter nicht — die Seite lädt gleich neu.");
      setTimeout(() => location.reload(), 2200);
    }
  }

  function anlegenEinreihen(el) {
    if (sitzungWeg) return;
    const body = {
      id: el.id, art: el.art, x: el.x, y: el.y, breite: el.breite, hoehe: el.hoehe,
      inhalt: el.inhalt,
    };
    ausstehend.set(el.id, { pfad: "/api/whiteboard/anlegen", body });
    inArbeit.add(el.id);
    kette(el.id, async () => {
      try {
        const { status, daten } = await senden("/api/whiteboard/anlegen", body);
        ausstehend.delete(el.id);
        if (daten.ok) {
          el.version = daten.version || 1;
          speicherFehler = 0;
        } else if (status === 400 && daten.grund === "voll") {
          toast("Deine Tafel ist voll — erst etwas wegwischen.");
          elementEntfernen(el.id);
        } else {
          speicherfehlerZaehlen();
        }
      } catch (fehler) {
        if (fehler.message !== "anmeldung") speicherfehlerZaehlen();
      } finally {
        if (!istInBearbeitung(el.id)) inArbeit.delete(el.id);
      }
    });
  }

  // Steckt der Nutzer noch im Element (Fokus/Drag)? Dann bleibt es fuer
  // den Poll gesperrt, auch wenn der POST durch ist.
  function istInBearbeitung(id) {
    const k = elementKnoten.get(id);
    return !!(k && (k.classList.contains("wb-fokus") || k.classList.contains("wb-zieht")));
  }

  // aendern: schickt immer art (der Speicher prueft sie mit) und die
  // zuletzt GESEHENE Version — 409 heisst: andere eigene Sitzung war
  // schneller, dann holt der Vollabgleich den echten Stand.
  function aenderungSenden(el) {
    if (sitzungWeg || !elemente.has(el.id)) return;
    const body = {
      id: el.id, version: el.version, art: el.art,
      x: el.x, y: el.y, breite: el.breite, hoehe: el.hoehe,
      inhalt: el.inhalt,
    };
    ausstehend.set(el.id, { pfad: "/api/whiteboard/aendern", body });
    inArbeit.add(el.id);
    kette(el.id, async () => {
      if (!elemente.has(el.id)) { ausstehend.delete(el.id); return; }
      body.version = el.version; // die Kette kann aeltere Bodies ueberholen lassen
      try {
        const { status, daten } = await senden("/api/whiteboard/aendern", body);
        ausstehend.delete(el.id);
        if (daten.ok) {
          el.version = daten.version;
          speicherFehler = 0;
        } else if (status === 409) {
          toast("In anderer Sitzung geändert — hole den aktuellen Stand.");
          inArbeit.delete(el.id);
          // Erst wenn der Abgleich wirklich durch ist, Entwarnung geben —
          // sonst raetselt man, ob die Wand jetzt stimmt.
          if (await vollAbgleich()) toast("Stand wurde aktualisiert.");
        } else if (status === 404) {
          toast("Das Element wurde in einer anderen Sitzung gelöscht.");
          elementEntfernen(el.id);
        } else if (status !== 400) {
          speicherfehlerZaehlen();
        }
      } catch (fehler) {
        if (fehler.message !== "anmeldung") speicherfehlerZaehlen();
      } finally {
        if (!istInBearbeitung(el.id)) inArbeit.delete(el.id);
      }
    });
  }

  // Textaenderungen entprellt (~800 ms), Strukturaenderungen sofort.
  function aenderungEinreihen(el, sofort) {
    if (entprellt.has(el.id)) { clearTimeout(entprellt.get(el.id)); entprellt.delete(el.id); }
    inArbeit.add(el.id);
    if (sofort) { aenderungSenden(el); return; }
    entprellt.set(el.id, setTimeout(() => {
      entprellt.delete(el.id);
      aenderungSenden(el);
    }, 800));
  }

  // Beim Verlassen der Seite: alles Ungesendete als Beacon hinterher.
  // sendBeacon uebertraegt nach dem Tab-Tod weiter; fetch/keepalive ist
  // der Rueckfall fuer Browser ohne Beacon.
  function beimGehenFlushen() {
    for (const [id, t] of entprellt) {
      clearTimeout(t);
      const el = elemente.get(id);
      if (el) {
        ausstehend.set(id, { pfad: "/api/whiteboard/aendern", body: {
          id: el.id, version: el.version, art: el.art,
          x: el.x, y: el.y, breite: el.breite, hoehe: el.hoehe, inhalt: el.inhalt,
        } });
      }
    }
    entprellt.clear();
    for (const { pfad, body } of ausstehend.values()) {
      const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
      let ok = false;
      try { ok = navigator.sendBeacon && navigator.sendBeacon(pfad, blob); } catch { ok = false; }
      if (!ok) {
        try { fetch(pfad, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }); } catch { /* letzter Versuch */ }
      }
    }
    ausstehend.clear();
  }
  window.addEventListener("pagehide", beimGehenFlushen);
  document.addEventListener("visibilitychange", () => { if (document.hidden) beimGehenFlushen(); });

  // =================================================================
  // Loeschen / Wiederherstellen (Basis fuer Schwamm, Entf und Undo)
  // =================================================================

  // loeschen/wiederherstellen warten auf die Sende-Ketten der betroffenen
  // Elemente: ein "loeschen" darf ein noch fliegendes "anlegen" nicht
  // ueberholen — sonst gewinnt das anlegen, und das Element steht nach
  // dem naechsten Poll wieder da.
  function nachKetten(ids, arbeit) {
    Promise.all(ids.map((id) => ketten.get(id) || Promise.resolve()))
      .then(arbeit)
      .catch(() => {});
  }

  function elementLoeschen(ids, optionen) {
    const kopien = ids.map((id) => elemente.get(id)).filter(Boolean);
    if (!kopien.length) return;
    for (const el of kopien) elementEntfernen(el.id);
    if (!(optionen && (optionen.ohneUndo || optionen.still))) undoMerken({ typ: "loeschen", kopien });
    if (sitzungWeg) return;
    nachKetten(ids, () =>
      senden("/api/whiteboard/loeschen", { ids: kopien.map((e) => e.id) })
        .then(({ daten }) => { if (daten.ok) speicherFehler = 0; else speicherfehlerZaehlen(); })
        .catch((f) => { if (f.message !== "anmeldung") speicherfehlerZaehlen(); }));
  }

  function wiederherstellen(kopien) {
    if (!kopien.length) return;
    if (!sitzungWeg) {
      nachKetten(kopien.map((e) => e.id), () =>
        senden("/api/whiteboard/wiederherstellen", { ids: kopien.map((e) => e.id) })
          .then(({ daten }) => { if (daten.ok) speicherFehler = 0; })
          .catch(() => {}));
    }
    for (const el of kopien) elementUebernehmen(el, "lokal");
    auswahlAnzeigen();
    schilderAuffrischen();
  }

  // =================================================================
  // Undo/Redo — Stack inverser Operationen, Tiefe 50
  // =================================================================
  //
  // Steht der Fokus in einer Textzeile, gehoert Strg+Z dem Browser
  // (native Zeilen-Undo-Historie); der Whiteboard-Stack uebernimmt nur
  // ausserhalb. So verliert niemand Tipparbeit an ein Werkzeug-Undo.

  const undoStapel = [];
  const redoStapel = [];

  // Sammel-Modus: buendelt mehrere Schritte zu EINEM Undo-Eintrag
  // (Muster Schwamm: eine Wischbewegung loescht n Striche = ein
  // Eintrag). Der Gruppen-Drag nutzt ihn — ohne Buendel braeuchte
  // "2 Elemente verschoben" zwei Strg+Z, je Element eins.
  let sammelSchritte = null;
  function sammelnBeginnen() { sammelSchritte = []; }
  function sammelnAbschliessen() {
    const schritte = sammelSchritte;
    sammelSchritte = null;
    if (!schritte || !schritte.length) return;
    // Ein einzelner Schritt bleibt ein normaler Eintrag — die Gruppe
    // ist nur fuer echte Mehrfach-Bewegungen da.
    undoMerken(schritte.length === 1 ? schritte[0] : { typ: "gruppe", schritte });
  }

  function undoMerken(eintrag) {
    if (sammelSchritte) { sammelSchritte.push(eintrag); return; }
    undoStapel.push(eintrag);
    if (undoStapel.length > 50) undoStapel.shift();
    redoStapel.length = 0;
    undoKnoepfe();
  }

  function undoKnoepfe() {
    $(".wb-undo").disabled = !undoStapel.length;
    $(".wb-redo").disabled = !redoStapel.length;
  }

  function felderAnwenden(id, felder) {
    const el = elemente.get(id);
    if (!el) return;
    if (felder.x !== undefined) el.x = felder.x;
    if (felder.y !== undefined) el.y = felder.y;
    if (felder.breite !== undefined) el.breite = felder.breite;
    if (felder.hoehe !== undefined) el.hoehe = felder.hoehe;
    if (felder.inhalt !== undefined) {
      el.inhalt = felder.inhalt.punkte
        ? { punkte: felder.inhalt.punkte.slice(), farbe: felder.inhalt.farbe, dicke: felder.inhalt.dicke }
        : JSON.parse(JSON.stringify(felder.inhalt));
    }
    if (el.art === "strich") {
      el._pfad = null; el._pfadGrob = null;
      tintenDirty = true; zeichnenAnfordern();
    } else {
      blockRendern(el);
    }
    aenderungEinreihen(el, true);
  }

  // Einen Eintrag rueckwaerts bzw. vorwaerts anwenden. Die "gruppe"
  // (Sammel-Eintrag des Gruppen-Drags) spielt ihre Schritte einzeln ab —
  // rueckwaerts in umgekehrter Reihenfolge, wie bei jedem Stapel.
  function eintragZurueck(e) {
    if (e.typ === "anlegen") {
      const el = elemente.get(e.id);
      e.kopien = el ? [el] : [];
      elementLoeschen([e.id], { ohneUndo: true });
    } else if (e.typ === "loeschen" || e.typ === "wischen") {
      wiederherstellen(e.kopien);
    } else if (e.typ === "aendern") {
      felderAnwenden(e.id, e.vorher);
    } else if (e.typ === "gruppe") {
      for (let i = e.schritte.length - 1; i >= 0; i--) eintragZurueck(e.schritte[i]);
    }
  }

  function eintragVor(e) {
    if (e.typ === "anlegen") {
      wiederherstellen(e.kopien || []);
    } else if (e.typ === "loeschen" || e.typ === "wischen") {
      elementLoeschen(e.kopien.map((k) => k.id), { ohneUndo: true });
    } else if (e.typ === "aendern") {
      felderAnwenden(e.id, e.nachher);
    } else if (e.typ === "gruppe") {
      for (const s of e.schritte) eintragVor(s);
    }
  }

  function undoAusfuehren() {
    const e = undoStapel.pop();
    if (!e) return;
    eintragZurueck(e);
    redoStapel.push(e);
    undoKnoepfe();
  }

  function redoAusfuehren() {
    const e = redoStapel.pop();
    if (!e) return;
    eintragVor(e);
    undoStapel.push(e);
    undoKnoepfe();
  }

  // =================================================================
  // Toasts
  // =================================================================

  function toast(text, optionen) {
    const o = optionen || {};
    const t = document.createElement("div");
    t.className = "wb-toast";
    const span = document.createElement("span");
    span.textContent = text;
    t.appendChild(span);
    if (o.aktion) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.aktionText || "Rückgängig";
      b.addEventListener("click", () => { o.aktion(); wegDamit(); });
      t.appendChild(b);
    }
    toastsEl.appendChild(t);
    requestAnimationFrame(() => t.classList.add("wb-sichtbar"));
    let timer = setTimeout(wegDamit, o.dauer || (o.aktion ? 8000 : 4200));
    function wegDamit() {
      clearTimeout(timer);
      t.classList.remove("wb-sichtbar");
      setTimeout(() => t.remove(), sanft ? 0 : 220);
    }
  }

  // =================================================================
  // Tafel wischen: Dialog, Animation, Undo
  // =================================================================

  const wischenDialog = $(".wb-wischen-dialog");

  function wischenFragen() {
    let n = 0;
    for (const el of elemente.values()) if (el.besitzer === ich.id) n++;
    if (!n) { toast("Deine Tafel ist schon leer."); return; }
    $(".wb-wischen-text").textContent = n === 1
      ? "Damit verschwindet 1 Element von deiner Tafel."
      : "Damit verschwinden " + n + " Elemente von deiner Tafel.";
    wischenDialog.showModal();
  }
  $(".wb-wischen-nein").addEventListener("click", () => wischenDialog.close());
  $(".wb-wischen-ja").addEventListener("click", () => {
    wischenDialog.close();
    tafelWischen();
  });

  function tafelWischen() {
    const kopien = [...elemente.values()].filter((el) => el.besitzer === ich.id);
    if (!kopien.length) return;

    const fertig = () => {
      for (const el of kopien) elementEntfernen(el.id);
      undoMerken({ typ: "wischen", kopien });
      toast("Tafel gewischt.", { aktion: () => undoAusfuehren(), aktionText: "Rückgängig" });
    };

    if (!sitzungWeg) {
      senden("/api/whiteboard/wischen", {})
        .then(({ daten }) => { if (daten.ok) speicherFehler = 0; else speicherfehlerZaehlen(); })
        .catch((f) => { if (f.message !== "anmeldung") speicherfehlerZaehlen(); });
    }

    // Die Wisch-Animation: ein Schwamm faehrt einmal quer ueber die
    // Tafel, hinter seiner Kante ist sie sauber. Unter reduced-motion
    // ist die Tafel schlicht sofort leer.
    const k = boardKnoten.get(ich.id);
    if (sanft || !gsap || !k) { fertig(); return; }
    const bahn = document.createElement("div");
    bahn.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:0;overflow:hidden;z-index:4;"
      + "background:var(--wb-tafel);border-radius:6px;";
    const schwamm = document.createElement("div");
    schwamm.style.cssText = "position:absolute;right:-60px;top:38%;width:120px;height:220px;border-radius:14px;"
      + "background:linear-gradient(90deg,#5D82C4 0%,#41609C 42%,#F4F6F8 42%,#D8DDE2 100%);"
      + "box-shadow:0 18px 40px -12px rgba(15,23,42,.5);transform:rotate(8deg);";
    bahn.appendChild(schwamm);
    k.wrap.appendChild(bahn);
    gsap.to(bahn, {
      width: BOARD_B + 70, duration: 0.75, ease: "power2.inOut",
      onUpdate: () => gsap.set(schwamm, { top: 38 + Math.sin(gsap.getProperty(bahn, "width") / 160) * 9 + "%" }),
      onComplete: () => {
        fertig();
        gsap.to(bahn, { opacity: 0, duration: 0.3, onComplete: () => bahn.remove() });
      },
    });
  }

  // =================================================================
  // Sync: Poll alle 5 s, idempotenter Upsert, Backoff bei Fehlern
  // =================================================================

  let seitStand = DATEN.jetzt;
  let pollTimer = 0;
  let pollFehler = 0;
  let wackelToastGezeigt = false;

  function standUebernehmen(daten, quelle) {
    seitStand = daten.jetzt || seitStand;
    anwesend = new Set(daten.anwesend || []);
    (daten.aktivitaet || []).forEach((a) => aktivitaet.set(a.besitzer, a.letzte));
    for (const el of daten.elemente || []) elementUebernehmen(el, quelle);
    for (const id of daten.geloescht || []) {
      if (inArbeit.has(id)) continue;
      elementEntfernen(id);
    }
    schilderAuffrischen();
  }

  async function pollen() {
    if (document.hidden || sitzungWeg) return;
    try {
      const antwort = await fetch("/api/whiteboard/elemente?seit=" + encodeURIComponent(seitStand));
      if (antwort.status === 401) { sitzungAbgelaufen(); return; }
      const daten = await antwort.json();
      if (daten.anmeldung) { sitzungAbgelaufen(); return; }
      if (!daten.ok) throw new Error(daten.grund || "poll");
      pollFehler = 0;
      wackelToastGezeigt = false;
      standUebernehmen(daten, "poll");
    } catch {
      pollFehler++;
      if (pollFehler === 2 && !wackelToastGezeigt) {
        wackelToastGezeigt = true;
        toast("Verbindung wackelt — die Wand zeigt eventuell nicht den neuesten Stand.");
      }
    } finally {
      pollPlanen();
    }
  }

  function pollPlanen() {
    clearTimeout(pollTimer);
    // Backoff 5 -> 10 -> 20 -> 40 s; ein Erfolg setzt zurueck.
    const wartezeit = 5000 * Math.pow(2, Math.min(pollFehler, 3));
    pollTimer = setTimeout(pollen, wartezeit);
  }

  // Nach 409 oder Wiederkehr: einmal ALLES holen (ohne seit) und
  // idempotent einpflegen — der billigste Weg zurueck zur Wahrheit.
  // Liefert true, wenn der Abgleich wirklich durchlief — der 409-Weg
  // haengt seine Entwarnung ("Stand wurde aktualisiert.") daran.
  async function vollAbgleich() {
    if (sitzungWeg) return false;
    try {
      const antwort = await fetch("/api/whiteboard/elemente");
      if (antwort.status === 401) { sitzungAbgelaufen(); return false; }
      const daten = await antwort.json();
      if (daten.anmeldung) { sitzungAbgelaufen(); return false; }
      if (!daten.ok) return false;
      // Vollstand: was der Server nicht mehr kennt, fliegt lokal raus.
      const bekannt = new Set((daten.elemente || []).map((e) => e.id));
      for (const id of [...elemente.keys()]) {
        if (!bekannt.has(id) && !inArbeit.has(id)) elementEntfernen(id);
      }
      standUebernehmen(daten, "poll");
      return true;
    } catch { return false; /* der naechste Poll versucht es wieder */ }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      zeichnenAnfordern();
      pollFehler = 0;
      clearTimeout(pollTimer);
      pollen();
    }
  });

  // =================================================================
  // Tastatur, Datei-Drop, Hilfe
  // =================================================================

  window.addEventListener("keydown", (ev) => {
    if (imTextfeld(ev.target)) return; // Zeilen gehoeren dem Browser
    const strg = ev.ctrlKey || ev.metaKey;
    if (strg && ev.key.toLowerCase() === "z" && !ev.shiftKey) { ev.preventDefault(); undoAusfuehren(); return; }
    if (strg && (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey))) { ev.preventDefault(); redoAusfuehren(); return; }
    if (strg) return;
    switch (ev.key.toLowerCase()) {
      case "v": werkzeugSetzen("auswahl"); break;
      case "s": werkzeugSetzen("stift"); break;
      case "t": werkzeugSetzen("text"); break;
      case "n": werkzeugSetzen("notiz"); break;
      case "e": werkzeugSetzen("schwamm"); break;
      case "+": radGesteAnstossen(); zoomUm(1.25, breite / 2, hoehe / 2); break;
      case "-": radGesteAnstossen(); zoomUm(0.8, breite / 2, hoehe / 2); break;
      case "1": $(".wb-zoom-stand").click(); break;
      case "0": ansichtWechseln("alle"); break;
      case "?": hilfeUmschalten(); break;
      case "escape": auswahlLeeren(); $(".wb-hilfe").hidden = true; break;
    }
  });

  // Ein fallengelassenes Bild wuerde den Browser von der Wand
  // wegnavigieren — und die halbe Sitzung waere weg. Es gibt hier nichts
  // zu droppen, also beides stumpf blocken.
  wurzel.addEventListener("dragover", (ev) => ev.preventDefault());
  wurzel.addEventListener("drop", (ev) => ev.preventDefault());

  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".wb-hilfe") && !ev.target.closest(".wb-hilfe-knopf")) {
      $(".wb-hilfe").hidden = true;
    }
  });

  // =================================================================
  // Mobiles Bearbeitungsblatt (<=860px): Zeilenliste im Vollbild
  // =================================================================
  //
  // Auf dem Telefon ist In-Place-Tippen in einer gezoomten Tafel eine
  // Zumutung (Tastatur schiebt, Caret winzig). Ein Tap auf den eigenen
  // Block oeffnet stattdessen dieses Blatt; "Fertig" schreibt zurueck.

  let mobilOffen = null; // {el, blatt}

  function mobilOeffnen(el) {
    if (mobilOffen) mobilSchliessen();
    inArbeit.add(el.id);
    const blatt = document.createElement("div");
    blatt.className = "wb-mobil";
    blatt.innerHTML = `
      <div class="wb-mobil-kopf">
        <b>${el.art === "notiz" ? "Haftnotiz" : "Textblock"}</b>
        <button type="button" class="wb-mobil-fertig">Fertig</button>
      </div>
      <div class="wb-mobil-werkzeuge"></div>
      <div class="wb-mobil-zeilen"><div class="wb-zeilen"></div></div>`;
    const werkzeugZeile = $(".wb-mobil-werkzeuge", blatt);
    const kasten = kastenBauen(el.id);
    kasten.style.display = "flex";
    kasten.style.position = "static";
    kasten.style.transform = "none";
    kasten.classList.add("wb-mobil-kasten");
    // Zettelfarben nur bei Notizen — wie am Board (kastenAuffrischen
    // erreicht nur den Buehnen-Kasten, nicht diesen frischen).
    $(".wb-kasten-zettel", kasten).style.display = el.art === "notiz" ? "" : "none";
    werkzeugZeile.appendChild(kasten);

    const liste = $(".wb-zeilen", blatt);
    liste.dataset.liste = el.inhalt.liste;
    liste.style.fontSize = Math.max(el.inhalt.groesse, 24) + "px";
    liste.style.color = tinte(el.inhalt.farbe);
    el.inhalt.zeilen.forEach((z) => {
      const zeile = zeileBauen(true);
      zeileFuellen(zeile, z, true);
      liste.appendChild(zeile);
    });

    // Die Zeilenlogik des Blatts ist bewusst schlicht: Enter = neue
    // Zeile darunter, Backspace am Anfang = mit der Vorzeile verbinden.
    blatt.addEventListener("keydown", (ev) => {
      const span = ev.target.closest(".wb-zeile-text");
      if (!span) return;
      const zeile = span.closest(".wb-zeile");
      if (ev.key === "Enter") {
        ev.preventDefault();
        const neue = zeileBauen(true);
        zeileFuellen(neue, { t: "", erledigt: false, gestrichen: false }, true);
        zeile.after(neue);
        caretSetzen($(".wb-zeile-text", neue), 0);
      } else if (ev.key === "Backspace" && caretOffset(span) === 0 && zeile.previousElementSibling) {
        ev.preventDefault();
        const davor = $(".wb-zeile-text", zeile.previousElementSibling);
        const lang = davor.textContent.length;
        davor.textContent += span.textContent;
        zeile.remove();
        caretSetzen(davor, lang);
      }
    });
    blatt.addEventListener("click", (ev) => {
      const zeile = ev.target.closest(".wb-zeile");
      if (!zeile) return;
      if (ev.target.closest(".wb-abhaken")) {
        zeile.classList.toggle("wb-erledigt");
        const haken = $(".wb-haken", zeile);
        if (haken) haken.style.strokeDashoffset = zeile.classList.contains("wb-erledigt") ? "0" : "1";
      } else if (ev.target.closest(".wb-zeile-streichen")) {
        zeile.classList.toggle("wb-gestrichen");
      } else if (ev.target.closest(".wb-zeile-weg")) {
        if (liste.children.length > 1) zeile.remove();
        else $(".wb-zeile-text", zeile).textContent = "";
      }
    });
    $(".wb-mobil-fertig", blatt).addEventListener("click", mobilSchliessen);
    // Wie am Board: Abhaken/Zeilenwerkzeuge klauen der aktiven Zeile
    // nicht den Fokus (Tastatur bliebe sonst nicht offen).
    blatt.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".wb-abhaken,.wb-zeile-tools")) ev.preventDefault();
    });

    // In die WURZEL haengen, nicht an document.body: saemtliche
    // --wb-*-Variablen leben an .wb-wurzel — am Body waere das Blatt
    // transparent und die Format-Knoepfe leere weisse Quadrate.
    wurzel.appendChild(blatt);
    mobilOffen = { el, blatt, liste };
    const erster = $(".wb-zeile-text", liste);
    if (erster && !erster.textContent) caretSetzen(erster, 0);
  }

  // Blatt-Zeilen ins Modell schreiben (ohne zu schliessen).
  function mobilUebernehmen() {
    if (!mobilOffen) return;
    const { el, liste } = mobilOffen;
    const zeilen = [];
    for (const zeile of liste.children) {
      zeilen.push({
        t: $(".wb-zeile-text", zeile).textContent.slice(0, DATEN.grenzen.zeichenJeZeile),
        erledigt: zeile.classList.contains("wb-erledigt"),
        gestrichen: zeile.classList.contains("wb-gestrichen") && !zeile.classList.contains("wb-erledigt"),
      });
    }
    el.inhalt.zeilen = zeilen.length ? zeilen.slice(0, DATEN.grenzen.zeilen)
      : [{ t: "", erledigt: false, gestrichen: false }];
  }

  // Nach Kasten-Aenderungen die Blatt-Ansicht nachziehen.
  function mobilAnsichtAuffrischen() {
    if (!mobilOffen) return;
    const { el, liste } = mobilOffen;
    liste.dataset.liste = el.inhalt.liste;
    liste.style.fontSize = Math.max(el.inhalt.groesse, 24) + "px";
    liste.style.color = tinte(el.inhalt.farbe);
  }

  function mobilVerwerfen() {
    if (!mobilOffen) return;
    mobilOffen.blatt.remove();
    mobilOffen = null;
  }

  function mobilSchliessen() {
    if (!mobilOffen) return;
    const { el, blatt } = mobilOffen;
    mobilUebernehmen();
    mobilOffen = null;
    blatt.remove();
    if (!elemente.has(el.id)) return;
    if (el.inhalt.zeilen.every((z) => !z.t.trim())) {
      elementLoeschen([el.id], { still: true });
      inArbeit.delete(el.id);
      return;
    }
    blockRendern(el);
    blockGeaendert(el, true);
    inArbeit.delete(el.id);
  }

  // Tap auf einen eigenen Block oeffnet am Telefon das Blatt — der Klick
  // laeuft ueber die Buehne, weil die Zeilen dort ohne Zeigergeraet
  // bewusst nicht fokussierbar sind (CSS nimmt ihnen die pointer-events).
  buehne.addEventListener("click", (ev) => {
    if (!istMobil()) return;
    const knoten = ev.target.closest(".wb-el");
    if (!knoten || !knoten.closest(".wb-board.wb-eigen")) return;
    if (ev.target.closest(".wb-abhaken,.wb-zeile-tools,.wb-kasten,.wb-griff")) return;
    const el = elemente.get(knoten.dataset.id);
    if (el) mobilOeffnen(el);
  });

  // =================================================================
  // Theme-Wechsel: Auswahlfarbe und Chrome leben mit
  // =================================================================
  //
  // Der Hell/Dunkel-Schalter der Topbar setzt nur data-theme am <html>.
  // Die TINTE ist inzwischen theme-fest (eine Palette, siehe oben) —
  // nachgezogen werden die Auswahlfarbe des Canvas (--wb-primaer wechselt
  // mit dem Theme) und ein Redraw; die tinte()-Schleifen bleiben als
  // Schutz stehen, falls die Palette je wieder theme-abhaengig wird.

  function farbenNachziehen() {
    auswahlFarbeLesen();
    $$(".wb-farbe").forEach((b) => { if (b.dataset.farbe) b.style.setProperty("--f", tinte(b.dataset.farbe)); });
    $$(".wb-marker").forEach((m) => m.style.setProperty("--mf", tinte(m.dataset.farbe)));
    for (const el of elemente.values()) {
      if (el.art === "strich") continue;
      const k = elementKnoten.get(el.id);
      if (k) k.style.setProperty("--ef", tinte(el.inhalt.farbe));
    }
    cursorSetzen();
    tintenDirty = true; zeichnenAnfordern();
  }
  new MutationObserver(farbenNachziehen)
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-weiss"] });

  // =================================================================
  // Start
  // =================================================================

  messen();
  auswahlFarbeLesen();
  for (const el of DATEN.elemente || []) elementUebernehmen(el, "start");
  schilderAuffrischen();
  werkzeugSetzen("auswahl");
  zoomAnzeigen();

  // Erste Ansicht: die eigene Tafel, ohne Anfahrt — die Seite soll
  // stehen, nicht vorfahren.
  {
    const r = ansichtRechteck("mein");
    const ziel = fitZiel(r.x, r.y, r.b, r.h, undefined, fitLuftDeckel("mein"));
    ansicht.s = ziel.s; ansicht.tx = ziel.tx; ansicht.ty = ziel.ty;
    panKlemmen();
    aufPixelSnappen();
  }
  segmenteMarkieren();
  pollPlanen();

  // Ablesbarer Zustand fuer Tests und Fehlersuche (Muster __gehirn).
  window.__wb = {
    get elemente() { return elemente.size; },
    get ansicht() { return { ...ansicht }; },
    get redrawZeit() { return redrawZeit; },
    get werkzeug() { return werkzeug; },
    get auswahl() { return auswahl.size; },
    get wand() { return { breite: WAND_B, hoehe: WAND_H, reihen, jeReihe }; },
    // Fuer Tests: kompakter Blick auf ein Board.
    stand(besitzer) {
      return [...elemente.values()]
        .filter((e) => e.besitzer === (besitzer || ich.id))
        .map((e) => ({ id: e.id, art: e.art, version: e.version,
                       zeilen: e.inhalt.zeilen ? e.inhalt.zeilen.map((z) => (z.erledigt ? "[x] " : "[ ] ") + z.t) : e.inhalt.punkte.length }));
    },
  };
})();
