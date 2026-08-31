/* =====================================================================
   WHITEBOARD — die Tafelwand des OS (Client, rendert in #wb-wurzel)
   =====================================================================

   Eine Wand mit einer Tafel je Person (Reihenfolge = WB_DATEN.team),
   Zoom und Pan wie an einer echten Buerowand: herantreten, schreiben,
   abhaken, wegwischen.

   ZWEI Personen je Element (31.08.2026): "tafel" ist das Board, auf dem
   es HAENGT — daraus folgt seine Lage an der Wand; "besitzer" ist, wer
   es GESCHRIEBEN hat. Gehen die auseinander, hat jemand einem anderen
   eine Aufgabe hingeschrieben; das Element traegt dann eine Fahne
   "von X". Schreiben darf jeder auf jede Tafel, aendern und loeschen
   genau zwei: Autor und Tafel-Besitzer (darfBearbeiten()). Der Server
   erzwingt dieselbe Regel — ein Dritter bekommt 404.

   MERKSATZ fuer alles, was mit Koordinaten zu tun hat: Position, Culling,
   Clipping, Treffer und Fits gehen IMMER ueber el.tafel, nie ueber
   el.besitzer. Der Autor entscheidet nur ueber Herkunft und Rechte.

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

  // Haftnotizen sind GEGENSTAENDE mit einer Groesse: aufziehbar, spaeter
  // skalierbar, innen scrollend. Darunter waere kein Zettel mehr zu lesen.
  const NOTIZ_MIN_B = 140, NOTIZ_MIN_H = 120;
  const TEXT_MIN_B = 160;
  const ZIEH_SCHWELLE = 4;                 // px, ab hier ist ein Klick ein Zug
  const GROESSE_SCHLUESSEL = "flowstate-wb-groesse";

  // Adressen, die der Client ueberhaupt anbieten darf. Der Server filtert
  // ein zweites Mal (nur http/https/mailto) — aber was hier nicht durchkommt,
  // wird gar nicht erst gesetzt: ein Klick auf einen Link darf nie Code
  // ausfuehren.
  const LINK_ERLAUBT = /^(https?:\/\/|mailto:|\/)/i;
  // Eine getippte Adresse am ZEILENENDE erkennen ("... siehe www.kunde.de").
  const ADRESSE_AM_ENDE = /(?:https?:\/\/[^\s]{2,}|www\.[^\s]{2,}|[^\s@]+@[^\s@]+\.[a-z]{2,})\s*$/i;

  // Fuellwoerter, die als Suchwort nichts taugen: Aus "E-Mail an Krotzer
  // schicken" soll "Krotzer" uebrig bleiben. Bewusst kurz gehalten — was
  // hier fehlt, sucht der Nutzer eben mit einem Wort zu viel.
  const STOPPWORTE = new Set([
    "e-mail", "email", "mail", "mails", "an", "am", "auf", "aus", "bei", "bis", "für", "fuer",
    "im", "in", "mit", "nach", "von", "vom", "zu", "zum", "zur", "über", "ueber",
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer",
    "und", "oder", "noch", "nochmal", "bitte", "heute", "morgen", "neu", "neue", "neuen",
    "schicken", "senden", "schreiben", "anrufen", "rufen", "melden", "nachfassen",
    "calls", "call", "cold", "webseite", "website", "seite", "bauen", "machen", "erstellen",
    "erledigen", "prüfen", "pruefen", "checken", "klären", "klaeren", "abschließen",
    "abschliessen", "aufräumen", "aufraeumen", "vorbereiten", "termin", "fertig", "offen",
  ]);

  // Tintenfarben: EINE Palette fuer alle Themes. Die Tafel bleibt auch im
  // Dunkelmodus hell — das dunkle Haus-Blau #4B8DF8 ist fuer dunkle
  // Untergruende gedacht und faellt auf der hellen Tafel auf 2,5:1 ab
  // (gemessen). Das Chrom wechselt mit dem Theme, die Tinte nie.
  const TINTE_HELL = { schwarz: "#2B3036", blau: "#2563EB", rot: "#C03B3B", gruen: "#2E8555", orange: "#C26E1E", lila: "#7A4FB6" };
  const tinte = (name) => TINTE_HELL[name] || TINTE_HELL.schwarz;

  // ------------------------------------------------------------ Zustand

  const ich = DATEN.ich;
  const team = Array.isArray(DATEN.team) && DATEN.team.length ? DATEN.team : [ich];
  const person = (id) => team.find((p) => p.id === id) || null;
  const vorname = (id) => { const p = person(id); return p ? p.name.split(" ")[0] : "jemand"; };
  // "Janniks Tafel", aber "Lukas' Tafel": ein Name auf s/x/z/ß bekommt im
  // Deutschen nur den Apostroph. Kleinigkeit — aber "Lukass Tafel" liest
  // sich wie ein Tippfehler des Hauses.
  const besitzform = (name) => name + (/[sxzß]$/i.test(name) ? "'" : "s");

  // Auf WESSEN Board haengt das Element? Ein Stand aus der ersten Fassung
  // (nur "besitzer") faellt auf den Autor zurueck, statt beim Rendern zu
  // verschwinden.
  const tafelVon = (el) => el.tafel || el.besitzer;
  // Aendern und Loeschen duerfen genau zwei: der Autor und die Person,
  // auf deren Tafel es haengt (sie darf ihre Aufgabe abhaken und wischen).
  // Dieselbe Regel steht im Server — hier nur, damit die Oberflaeche gar
  // nicht erst etwas anbietet, was gleich mit 404 zurueckkaeme.
  const darfBearbeiten = (el) => !!el && (el.besitzer === ich.id || tafelVon(el) === ich.id);
  // Fremde Aufgabe: Autor und Tafel gehen auseinander -> Fahne "von X".
  const istFremdeHand = (el) => !!el && el.besitzer !== tafelVon(el);

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
  const stricheJeBoard = new Map();        // TAFEL-id -> [Element] in Zeichenreihenfolge
  team.forEach((p) => stricheJeBoard.set(p.id, []));

  const ansicht = { s: 0.5, tx: 0, ty: 0 };
  let werkzeug = "auswahl";                // auswahl | stift | text | notiz | schwamm
  let stiftFarbe = "schwarz";
  let stiftDicke = "mittel";
  let zettelFarbe = "gelb";
  // Schriftgroesse fuer NEUE Bloecke — vorab in der Leiste waehlbar und
  // ueber die Sitzung hinaus gemerkt. Wer gross schreibt, schreibt meist
  // weiter gross; jedes Mal nachtraeglich umzustellen waere Arbeit fuer
  // nichts. localStorage kann werfen (privates Fenster) — dann M.
  let neuGroesse = 28;
  try {
    const g = Number(localStorage.getItem(GROESSE_SCHLUESSEL));
    if (GROESSEN.includes(g)) neuGroesse = g;
  } catch { /* kein Speicher: M bleibt */ }
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
    kette: S('<path d="M10.6 13.4a3.6 3.6 0 0 0 5.2 0l2.6-2.6a3.7 3.7 0 0 0-5.2-5.2l-1.5 1.5"/><path d="M13.4 10.6a3.6 3.6 0 0 0-5.2 0l-2.6 2.6a3.7 3.7 0 0 0 5.2 5.2l1.5-1.5"/>'),
    pfeil: S('<path d="m14.5 5.5-6 6.5 6 6.5"/>'),
    ecke: S('<path d="M20 10v10H10"/><path d="M20 20 12.5 12.5"/>'),
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
        <div class="wb-neurahmen" hidden></div>
        <div class="wb-schwammkreis" hidden></div>
      </div>
      ${/* Nachbar-Pfeile: nur in Richtungen, in denen an der zweireihigen
            Wand wirklich eine Tafel haengt. Bildschirmfest, damit sie beim
            Zoomen nicht mitwandern. */""}
      <div class="wb-pfeile" hidden>
        <button type="button" class="wb-pfeil wb-pfeil-links" data-richtung="links" hidden>${ICON.pfeil}<span></span></button>
        <button type="button" class="wb-pfeil wb-pfeil-rechts" data-richtung="rechts" hidden>${ICON.pfeil}<span></span></button>
        <button type="button" class="wb-pfeil wb-pfeil-oben" data-richtung="oben" hidden>${ICON.pfeil}<span></span></button>
        <button type="button" class="wb-pfeil wb-pfeil-unten" data-richtung="unten" hidden>${ICON.pfeil}<span></span></button>
      </div>
      <div class="wb-fremdleiste" hidden>${ICON.stift}<span></span></div>
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
        ${/* Schriftgroesse fuer den naechsten Block — S/M/L, gemerkt ueber
              die Sitzung hinaus. Der Umschalter IM Block-Werkzeugkasten
              aendert weiterhin bestehende Bloecke; dieser hier entscheidet,
              womit der naechste anfaengt. */""}
        <div class="wb-kontext wb-kontext-groesse" hidden>
          <span class="wb-kontext-wort">Größe</span>
          <div class="wb-kontext-groessen"></div>
        </div>
        <div class="wb-leiste-trenner wb-kontext-zettel-trenner" hidden></div>
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
          <dt>Zoom auf den Mauszeiger</dt><dd><kbd>Rad</kbd> · <kbd>Strg</kbd>+<kbd>Rad</kbd></dd>
          <dt>Wand verschieben</dt><dd>Zwei Finger · <kbd>Leertaste</kbd>+Ziehen</dd>
          <dt>Seitwärts an der Wand entlang</dt><dd><kbd>Shift</kbd>+<kbd>Rad</kbd></dd>
          <dt>Zur Nachbar-Tafel</dt><dd><kbd>Alt</kbd>+<kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></dd>
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
      ${/* Zeile verknuepfen: Adressfeld + Live-Vorschlaege aus dem CRM.
            Ein Dialog statt eines Popovers, weil hier getippt wird — und
            weil er die Wand fuer den Moment stillstellen darf. */""}
      <dialog class="wb-dialog wb-link-dialog">
        <h2>Zeile verknüpfen</h2>
        <div class="sub wb-link-zeile"></div>
        <label class="wb-link-feld">
          <span>Adresse</span>
          <input type="text" class="wb-link-eingabe" placeholder="https://… oder name@firma.de"
                 autocomplete="off" spellcheck="false">
        </label>
        <div class="wb-link-treffer" role="listbox" aria-label="Vorschläge"></div>
        <div class="dialog-fuss">
          <button type="button" class="sekundaer wb-link-weg" hidden>Link entfernen</button>
          <span class="wb-link-luft"></span>
          <button type="button" class="sekundaer wb-link-abbrechen">Abbrechen</button>
          <button type="button" class="wb-link-ok">Übernehmen</button>
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
  const neuRahmen = $(".wb-neurahmen");
  const schwammKreis = $(".wb-schwammkreis");
  const toastsEl = $(".wb-toasts");
  const pfeileEl = $(".wb-pfeile");
  const fremdLeiste = $(".wb-fremdleiste");

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
    const groessen = $(".wb-kontext-groessen");
    [[GROESSEN[0], "S", "klein"], [GROESSEN[1], "M", "mittel"], [GROESSEN[2], "L", "groß"]]
      .forEach(([wert, wort, tip]) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "wb-neugroesse"; b.dataset.groesse = String(wert);
        b.textContent = wort;
        b.setAttribute("data-tip", "Schrift " + tip);
        b.setAttribute("aria-label", "Schriftgröße " + tip);
        groessen.appendChild(b);
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
    // Beide Namen fuer dieselbe Person: das Board GEHOERT ihr (besitzer,
    // so heisst es seit der ersten Fassung) und IST ihre Tafel.
    wrap.dataset.besitzer = person.id;
    wrap.dataset.tafel = person.id;
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
        // Gezaehlt wird, was auf der TAFEL liegt — eine Aufgabe, die jemand
        // hier hingeschrieben hat, gehoert zum Fortschritt dieser Person.
        if (tafelVon(el) !== person.id) continue;
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

  // Rueckfall fuer Engines ohne overflow:clip (siehe whiteboard.css): dort
  // bleibt die Flaeche ein Scroll-Container, und der Browser scrollt ihn
  // ungefragt, sobald ein Caret ausserhalb liegt. Die DOM-Buehne wanderte
  // dann gegen den Tinten-Canvas — Schrift und Striche laegen nicht mehr
  // uebereinander. Also: sofort zuruecksetzen, es gibt hier nichts zu
  // scrollen. Verschoben wird ausschliesslich ueber "ansicht".
  const scrollZurueck = (el) => el.addEventListener("scroll", () => {
    if (el.scrollLeft || el.scrollTop) { el.scrollLeft = 0; el.scrollTop = 0; flaecheRect = null; }
  }, { passive: true });
  scrollZurueck(flaeche);
  scrollZurueck(raum);

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
    const vx = versatz.get(tafelVon(el)) || 0;
    const vy = versatzY.get(tafelVon(el)) || 0;
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

  // Der Schwamm radiert PUNKTGENAU: waehrend des Wischens merkt er sich je
  // Strich, welche Stuetzpunkte er beruehrt hat (Set von Indizes), und
  // zeichnet nur diese blass. Erst beim Loslassen zerfaellt der Strich in
  // seine Reststuecke. Fuer getippten Text merkt er sich je Zeile die
  // getroffenen Zeichen und legt eine Vorschau auf den Canvas — das
  // contenteditable wird waehrend der Geste NICHT angefasst (Fokus und
  // Caret waeren sonst hin).
  const schwammStriche = new Map();   // strichId -> Set(Punkt-Index)
  const schwammTexte = new Map();     // blockId -> {zeilen:[{span, kaesten:[..], weg:Set}]}

  // Der gerade entstehende Strich (Werkzeug Stift).
  let liveStrich = null; // {punkte:[welt-boardrelativ], farbe, dicke, tafel, ...}

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
          const weg = schwammStriche.get(el.id);
          const gezogen = ziehVersatz.aktiv && auswahl.has(el.id);
          ctx.strokeStyle = tinte(el.inhalt.farbe);
          ctx.lineWidth = el.inhalt.dicke;
          ctx.globalAlpha = 1;
          if (gezogen) { ctx.save(); ctx.translate(ziehVersatz.dx, ziehVersatz.dy); }
          // Angeknabberter Strich: die uebrigen Stuecke voll, die vom
          // Schwamm beruehrten blass — man sieht schon beim Wischen, wo
          // die Luecke entstehen wird.
          if (weg && weg.size) strichStueckeZeichnen(el, bx, by, weg);
          else ctx.stroke(grobModus ? (el._pfadGrob || (el._pfadGrob = strichPfadBauen(el, true))) : pfadVon(el));
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
      const bx = versatz.get(liveStrich.tafel) || 0;
      const by = versatzY.get(liveStrich.tafel) || 0;
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
    schwammTextVorschau();

    redrawZeit += (performance.now() - t0 - redrawZeit) * 0.2;
    if (!grobModus && redrawZeit > 20.5) { grobModus = true; }
    else if (grobModus && redrawZeit < 14) { grobModus = false; }
  }

  // Ein angeknabberter Strich, Stueck fuer Stueck: zusammenhaengende Laeufe
  // gleichen Zustands werden als eigener Pfad gezogen, die weggewischten
  // blass. Ein Uebergangspunkt gehoert BEIDEN Laeufen, sonst klaffte schon
  // in der Vorschau eine zu grosse Luecke.
  function strichStueckeZeichnen(el, bx, by, weg) {
    const p = el.inhalt.punkte;
    const n = p.length / 2;
    let i = 0;
    while (i < n) {
      const raus = weg.has(i);
      let j = i;
      while (j + 1 < n && weg.has(j + 1) === raus) j++;
      const von = Math.max(0, i - 1), bis = Math.min(n - 1, j + 1);
      if (bis > von) {
        ctx.globalAlpha = raus ? 0.18 : 1;
        ctx.beginPath();
        ctx.moveTo(p[von * 2] + bx, p[von * 2 + 1] + by);
        for (let k = von + 1; k <= bis; k++) ctx.lineTo(p[k * 2] + bx, p[k * 2 + 1] + by);
        ctx.stroke();
      }
      i = j + 1;
    }
    ctx.globalAlpha = 1;
  }

  // Vorschau fuer radierte ZEICHEN: halbtransparente Rechtecke ueber den
  // getroffenen Buchstaben, gezeichnet in BILDSCHIRM-Koordinaten (die
  // Rechtecke kommen aus getClientRects und die Ansicht steht waehrend der
  // Wischgeste still). Das contenteditable bleibt unberuehrt.
  function schwammTextVorschau() {
    if (!schwammTexte.size) return;
    const r = rectHolen();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgba(192,59,59,.28)";
    for (const eintrag of schwammTexte.values()) {
      for (const zeile of eintrag.zeilen) {
        for (const i of zeile.weg) {
          const k = zeile.kaesten[i];
          if (!k) continue;
          ctx.fillRect(k.x - r.left, k.y - r.top, k.b, k.h);
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
    const bx = versatz.get(liveStrich.tafel) || 0;
    const by = versatzY.get(liveStrich.tafel) || 0;
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
  const strichFahnen = new Map();          // id -> DOM-Fahne "von X" eines Strichs

  // "von Lukas" — die Herkunftsfahne. Bei Bloecken haengt sie IM Knoten
  // (folgt jedem Verschieben von selbst), bei Strichen als eigener Knoten
  // an der Bounding-Box oben links: Tinte lebt auf dem Canvas, dort gibt
  // es kein DOM, an das sie sich haengen koennte.
  function fahneFuellen(fahne, el) {
    fahne.textContent = "von " + vorname(el.besitzer);
    fahne.title = vorname(el.besitzer) + " hat das auf "
      + besitzform(vorname(tafelVon(el))) + " Tafel geschrieben";
  }

  function strichFahne(el) {
    const noetig = istFremdeHand(el);
    let fahne = strichFahnen.get(el.id);
    if (!noetig) { if (fahne) { fahne.remove(); strichFahnen.delete(el.id); } return; }
    const ebene = boardKnoten.get(tafelVon(el));
    if (!ebene) return;
    if (!fahne) {
      fahne = document.createElement("div");
      fahne.className = "wb-fahne wb-fahne-strich";
      strichFahnen.set(el.id, fahne);
    }
    if (fahne.parentElement !== ebene.inhalt) ebene.inhalt.appendChild(fahne);
    fahne.style.left = el.x + "px";
    fahne.style.top = el.y + "px";
    fahneFuellen(fahne, el);
  }

  // Ein Element vollstaendig uebernehmen (Erstaufbau UND Poll-Delta).
  // Idempotent per id: der komplette Zustand wird ersetzt — Duplikate aus
  // dem 10-Sekunden-Ueberlappungsfenster des Servers sind dadurch gratis.
  function elementUebernehmen(el, quelle) {
    try {
      // Ein Element ohne "tafel" (Stand der ersten Fassung) haengt auf dem
      // Board seines Autors — EINMAL hier normalisieren, damit der ganze
      // Rest des Clients nur noch el.tafel kennt.
      if (!el.tafel) el.tafel = el.besitzer;
      if (!versatz.has(el.tafel)) return;                  // unbekanntes Board
      if (quelle === "poll" && inArbeit.has(el.id)) return; // Finger drauf: nicht anfassen
      const alt = elemente.get(el.id);
      // Wechselt ein Element das Board (kommt nur ueber einen Vollabgleich
      // vor), muss es aus der alten Strichliste bzw. Inhaltsebene heraus.
      if (alt && alt.tafel !== el.tafel) elementAusBoardNehmen(alt);
      elemente.set(el.id, el);
      if (el.art === "strich") {
        el._pfad = null; el._pfadGrob = null;
        const liste = stricheJeBoard.get(el.tafel);
        if (alt && alt.art === "strich" && alt.tafel === el.tafel) {
          const i = liste.indexOf(alt);
          if (i >= 0) liste[i] = el; else liste.push(el);
        } else liste.push(el);
        strichFahne(el);
        tintenDirty = true; zeichnenAnfordern();
      } else {
        blockRendern(el, alt);
      }
    } catch (fehler) {
      console.error("Whiteboard: Element uebersprungen:", el && el.id, fehler);
    }
  }

  // Nur aus Zeichenliste bzw. DOM nehmen — ohne das Modell anzufassen.
  function elementAusBoardNehmen(el) {
    if (el.art === "strich") {
      const liste = stricheJeBoard.get(tafelVon(el));
      if (liste) { const i = liste.indexOf(el); if (i >= 0) liste.splice(i, 1); }
      const f = strichFahnen.get(el.id);
      if (f) { f.remove(); strichFahnen.delete(el.id); }
      tintenDirty = true; zeichnenAnfordern();
    } else {
      const k = elementKnoten.get(el.id);
      if (k) { k.remove(); elementKnoten.delete(el.id); }
    }
  }

  function elementEntfernen(id) {
    const el = elemente.get(id);
    if (!el) return;
    elemente.delete(id);
    auswahl.delete(id);
    inArbeit.delete(id);
    elementAusBoardNehmen(el);
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
    // "darf" ersetzt das alte "eigen": bearbeiten kann jetzt auch, wer die
    // Tafel besitzt (eine Aufgabe abhaken) — und wer auf einer fremden
    // Tafel geschrieben hat, behaelt seinen eigenen Text.
    const darf = darfBearbeiten(el);
    if (!knoten) {
      knoten = document.createElement("div");
      knoten.dataset.id = el.id;
      boardKnoten.get(tafelVon(el)).inhalt.appendChild(knoten);
      elementKnoten.set(el.id, knoten);
      if (darf) blockInteraktionAnbinden(knoten);
    }
    // wb-fokus lebt am Fokus, nicht am Modell — die Klasse muss das
    // Neuschreiben von className ueberleben, sonst schliesst sich der
    // Werkzeugkasten nach jedem Rendern (Farbe klicken -> Kasten weg).
    knoten.className = "wb-el " + (el.art === "notiz" ? "wb-el-notiz" : "wb-el-text")
      + (darf ? " wb-darf" : "")
      + (istFremdeHand(el) ? " wb-fremdhand" : "")
      + (istFremdeHand(el) && tafelVon(el) === ich.id ? " wb-fuermich" : "")
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
      // Eine Haftnotiz ist ein Gegenstand mit fester Groesse: sie waechst
      // nicht mit dem Text, sondern scrollt innen. Ohne feste Hoehe waere
      // "aufziehen" und "skalieren" folgenlos.
      knoten.style.height = Math.max(NOTIZ_MIN_H, Math.round(el.hoehe || NOTIZ_MIN_H)) + "px";
    }

    // Struktur: Griff + Zeilenliste (+ Kasten und Anfasser nur, wo man darf).
    let zeilenEl = $(".wb-zeilen", knoten);
    if (!zeilenEl) {
      knoten.innerHTML = "";
      if (darf) {
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
      if (darf) {
        knoten.appendChild(kastenBauen(el.id));
        const anfasser = document.createElement("div");
        anfasser.className = "wb-groesse-griff";
        anfasser.setAttribute("data-tip", el.art === "notiz" ? "Größe ändern" : "Breite ändern");
        anfasser.innerHTML = ICON.ecke;
        knoten.appendChild(anfasser);
        anfasserAnbinden(anfasser, knoten);
      }
    }
    zeilenEl.dataset.liste = el.inhalt.liste;

    // Fahne "von X" — nur, wenn Autor und Tafel auseinandergehen.
    let fahne = $(".wb-fahne", knoten);
    if (istFremdeHand(el)) {
      if (!fahne) {
        fahne = document.createElement("div");
        fahne.className = "wb-fahne";
        knoten.appendChild(fahne);
      }
      fahneFuellen(fahne, el);
    } else if (fahne) fahne.remove();

    // Zeilen abgleichen: vorhandene Knoten wiederverwenden, damit Fokus
    // und Caret bei jedem Rendern ueberleben wuerden (der Poll meidet
    // fokussierte Bloecke ohnehin, aber Vorsicht kostet hier nichts).
    const zeilen = el.inhalt.zeilen;
    const daKnoten = Array.from(zeilenEl.children);
    for (let i = 0; i < zeilen.length; i++) {
      let z = daKnoten[i];
      if (!z) { z = zeileBauen(darf); zeilenEl.appendChild(z); }
      zeileFuellen(z, zeilen[i], darf);
    }
    for (let i = daKnoten.length - 1; i >= zeilen.length; i--) daKnoten[i].remove();

    leerMarkieren(el, knoten);
    scrollMarkieren(el, zeilenEl);
    if (darf) kastenAuffrischen(el);
    schilderAuffrischen();
  }

  // Passt der Text nicht mehr in die Notiz, wird INNEN gescrollt statt
  // ueber den Zettel hinauszulaufen. Die Klasse steht nur dann, weil ein
  // Scroll-Kasten alles abschneidet, was neben den Zeilen liegt.
  function scrollMarkieren(el, zeilenEl) {
    const z = zeilenEl || (elementKnoten.get(el.id) && $(".wb-zeilen", elementKnoten.get(el.id)));
    if (!z || el.art !== "notiz") return;
    // Erst ohne Klasse messen: mit gesetztem overflow waere scrollHeight
    // die gescrollte Hoehe und die Klasse bliebe fuer immer haengen.
    const hatte = z.classList.contains("wb-scrollt");
    if (hatte) z.classList.remove("wb-scrollt");
    const laeuftUeber = z.scrollHeight > z.clientHeight + 1;
    z.classList.toggle("wb-scrollt", laeuftUeber);
  }

  // Eine leere Haftnotiz bleibt stehen (sie ist ein Gegenstand — man klebt
  // sie hin und schreibt spaeter drauf) und zeigt einen ganz blassen
  // Platzhalter. Die Klasse sagt "alle Zeilen leer"; das :empty im CSS
  // sorgt dafuer, dass der Platzhalter beim ersten Zeichen verschwindet,
  // ohne dass dafuer neu gerendert werden muss.
  function leerMarkieren(el, knoten) {
    const k = knoten || elementKnoten.get(el.id);
    if (!k) return;
    k.classList.toggle("wb-blockleer", el.inhalt.zeilen.every((z) => !z.t));
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
    // Das Ketten-Symbol HINTER dem Text (nicht der Text selbst): ein
    // klickbarer Zeilentext kollidierte mit dem Bearbeiten — man kaeme nie
    // mehr ans Caret.
    const anker = document.createElement("a");
    anker.className = "wb-zeile-link";
    anker.innerHTML = ICON.kette;
    anker.hidden = true;
    z.appendChild(anker);
    if (eigen) {
      const tools = document.createElement("span");
      tools.className = "wb-zeile-tools";
      const kette = document.createElement("button");
      kette.type = "button"; kette.className = "wb-zeile-kette"; kette.tabIndex = -1;
      kette.setAttribute("aria-label", "Verknüpfen");
      kette.innerHTML = ICON.kette;
      const streich = document.createElement("button");
      streich.type = "button"; streich.className = "wb-zeile-streichen"; streich.tabIndex = -1;
      streich.setAttribute("aria-label", "Durchstreichen");
      streich.innerHTML = ICON.strich;
      const weg = document.createElement("button");
      weg.type = "button"; weg.className = "wb-zeile-weg"; weg.tabIndex = -1;
      weg.setAttribute("aria-label", "Zeile löschen");
      weg.innerHTML = ICON.weg;
      tools.append(kette, streich, weg);
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
    linkAnkerSetzen(z, daten.link);
  }

  // Den Link-Anker einer Zeile auf den Stand bringen. Die Adresse wird HIER
  // ein zweites Mal geprueft: was aus einer alten Zeile oder einer fremden
  // Sitzung kommt, darf niemals ungeprueft in ein href.
  function linkAnkerSetzen(z, adresse) {
    const anker = $(".wb-zeile-link", z);
    if (!anker) return;
    const ziel = String(adresse || "").trim();
    if (!ziel || !LINK_ERLAUBT.test(ziel)) {
      anker.hidden = true;
      anker.removeAttribute("href");
      anker.removeAttribute("target");
      anker.removeAttribute("rel");
      return;
    }
    anker.hidden = false;
    anker.setAttribute("href", ziel);
    anker.title = ziel;
    anker.setAttribute("aria-label", "Öffnen: " + ziel);
    if (intern(ziel)) {
      // Eigene Seiten bleiben im selben Tab — das OS ist EINE Anwendung,
      // ein zweiter Tab davon waere nur ein zweiter Ort zum Zurechtfinden.
      anker.removeAttribute("target");
      anker.removeAttribute("rel");
    } else {
      anker.setAttribute("target", "_blank");
      anker.setAttribute("rel", "noopener");
    }
  }

  // Zeigt die Adresse auf dieses OS? Der Server nimmt nur http/https/mailto
  // (siehe LINK in whiteboard-routes.js) — interne Ziele reisen deshalb als
  // absolute Adresse auf den eigenen Ursprung und werden hier wieder als
  // "intern" erkannt.
  function intern(adresse) {
    if (adresse.startsWith("/")) return true;
    try { return new URL(adresse, location.href).origin === location.origin; }
    catch { return false; }
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
      const zeile = { t: spans[i].textContent.replace(/\u00A0/g, " ").slice(0, DATEN.grenzen.zeichenJeZeile),
                      erledigt: !!alt.erledigt, gestrichen: !!alt.gestrichen };
      // Der Link ist Metadatum wie erledigt/gestrichen: er steht nicht im
      // DOM-Text und darf beim Zurueckschreiben nicht verloren gehen.
      if (alt.link) zeile.link = alt.link;
      neu.push(zeile);
    }
    el.inhalt.zeilen = neu.length ? neu : [{ t: "", erledigt: false, gestrichen: false }];
  }

  // Groesse nachmessen und Aenderung speichern (entprellt 800 ms; blur
  // und Strukturaenderungen flushen frueher ueber speichernFlush).
  function blockGeaendert(el, sofort) {
    const knoten = elementKnoten.get(el.id);
    if (knoten) {
      el.breite = Math.max(el.breite, 40);
      // Nur Textbloecke wachsen mit dem Text. Die Hoehe einer Haftnotiz ist
      // gewaehlt (aufgezogen oder skaliert) \u2014 sie hier nachzumessen wuerde
      // die Wahl bei jedem Tastendruck ueberschreiben.
      if (el.art !== "notiz") el.hoehe = Math.round(knoten.offsetHeight);
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
      // Eine leere HAFTNOTIZ bleibt: sie ist ein Gegenstand, den man
      // hinklebt und spaeter beschriftet. Ein leerer TEXTBLOCK verschwindet
      // weiterhin — unsichtbar und leer waere er nur eine Falle.
      if (leer && el.art !== "notiz") {
        elementLoeschen([el.id], { still: true });
      } else {
        if (adressenErkennen(el)) blockRendern(el);
        leerMarkieren(el, knoten);
        blockGeaendert(el, true);
      }
      inArbeit.delete(el.id);
    });

    // ---- pointerdown im Block: greifen, fokussieren oder heranfahren.
    //
    // Neu (31.08.2026): Man packt eine Haftnotiz UEBERALL an, nicht nur am
    // Griff — wie am echten Board. Der Zeiger entscheidet: bewegt er sich
    // ueber 4 px, ist es ein Zug; bleibt er stehen, war es ein Klick und
    // die Zeile bekommt den Caret an genau die geklickte Stelle.
    //
    // Warum preventDefault schon beim Aufsetzen: sonst gaebe der Browser
    // dem contenteditable sofort den Fokus UND begaenne eine Textauswahl —
    // beides mitten in einem Zug. Der Fokus wird darum von Hand gesetzt,
    // erst wenn feststeht, dass es kein Zug war.
    knoten.addEventListener("pointerdown", (ev) => {
      // Abhaken und Zeilenwerkzeuge nehmen beim Klick KEINEN Fokus an
      // (tabIndex -1 steht schon): das mousedown wuerde sonst wb-fokus
      // setzen — der Format-Kasten ploppte ungefragt auf, und die
      // inArbeit-Sperre bliebe haengen (der Poll traegt Fremdstaende
      // dann nicht mehr nach, bis irgendwo ins Leere geklickt wird).
      if (ev.target.closest(".wb-abhaken,.wb-zeile-tools")) { ev.preventDefault(); return; }
      // Diese Kinder regeln sich selbst — Kasten, Griff, Anfasser, Link.
      if (ev.target.closest(".wb-kasten,.wb-griff,.wb-groesse-griff,.wb-zeile-link")) return;
      if (ev.button !== 0 && ev.pointerType === "mouse") return;
      // Mit Stift/Notiz/Schwamm in der Hand gehoert der Klick dem Werkzeug
      // (neuer Block ueber dem alten, Radieren) — nicht dem Verschieben.
      if (werkzeug !== "auswahl") return;
      if (leertaste) return;                 // Leertaste = Wand schieben
      const el = elVonKnoten(knoten);
      if (!el || !darfBearbeiten(el)) return;

      // Shift ergaenzt die Auswahl (Muster der Flaeche), ohne zu ziehen.
      if (ev.shiftKey) {
        ev.preventDefault(); ev.stopPropagation();
        if (auswahl.has(el.id)) auswahl.delete(el.id); else auswahl.add(el.id);
        auswahlAnzeigen();
        return;
      }

      // Steht der Cursor schon IM Block, darf nur Griff/Rand ziehen —
      // sonst koennte man Text nicht mehr markieren.
      const imText = !!ev.target.closest(".wb-zeile-text");
      if (knoten.classList.contains("wb-fokus") && imText) return;

      ev.stopPropagation();
      ev.preventDefault();
      if (!auswahl.has(el.id)) { auswahl.clear(); auswahl.add(el.id); auswahlAnzeigen(); }

      const startX = ev.clientX, startY = ev.clientY, zeiger = ev.pointerId;
      const ziel = ev.target;
      let gestartet = false;
      const pruefen = (m) => {
        if (m.pointerId !== zeiger || gestartet) return;
        if (Math.abs(m.clientX - startX) <= ZIEH_SCHWELLE
            && Math.abs(m.clientY - startY) <= ZIEH_SCHWELLE) return;
        gestartet = true;
        abmelden();
        blockZiehen(el, { clientX: startX, clientY: startY, pointerId: zeiger, target: ziel });
      };
      const los = (m) => {
        if (m.pointerId !== zeiger) return;
        abmelden();
        if (gestartet || m.type === "pointercancel") return;
        klickImBlock(el, knoten, m);
      };
      const abmelden = () => {
        window.removeEventListener("pointermove", pruefen, true);
        window.removeEventListener("pointerup", los, true);
        window.removeEventListener("pointercancel", los, true);
      };
      // Am FENSTER lauschen, mit capture: der Zeiger verlaesst beim Ziehen
      // regelmaessig den Block, und ein Listener am Knoten bekaeme das
      // Loslassen dann nie zu sehen.
      window.addEventListener("pointermove", pruefen, true);
      window.addEventListener("pointerup", los, true);
      window.addEventListener("pointercancel", los, true);
    });

    // Klick ohne Bewegung: bearbeiten. Am Telefon oeffnet das Vollbild-
    // Blatt, bei winziger Ansicht wird erst herangefahren (ein Caret unter
    // 35 % ist Deko, und der Fokus finge danach die Tastenkuerzel ab).
    function klickImBlock(el, knoten, ev) {
      if (istMobil()) { if (!mobilOffen) mobilOeffnen(el); return; }
      if (ansicht.s < ZOOM_TEXT_MIN) { aufElementZoomen(el); return; }
      let span = ev.target.closest && ev.target.closest(".wb-zeile-text");
      if (!span) {
        // Klick auf die freie Zettelflaeche: die naechstliegende Zeile
        // bekommt den Caret. Ein Zettel ist zum Beschriften da — ihn
        // anzutippen und nichts passieren zu lassen, waere eine tote Stelle.
        const spans = $$(".wb-zeile-text", knoten);
        if (!spans.length) return;
        let bester = spans[0], abstand = Infinity;
        for (const s of spans) {
          const r = s.getBoundingClientRect();
          const dy = ev.clientY < r.top ? r.top - ev.clientY
                   : ev.clientY > r.bottom ? ev.clientY - r.bottom : 0;
          if (dy < abstand) { abstand = dy; bester = s; }
        }
        span = bester;
      }
      caretSetzen(span, caretAusPunkt(span, ev.clientX, ev.clientY));
    }

    // Der Caret gehoert dorthin, wo geklickt wurde — nicht an den Anfang.
    // Gemessen wird ueber die Zeichen-Rechtecke, nicht ueber
    // caretPositionFromPoint: das liefert fuer einen Klick NEBEN dem Text
    // (der Zeilen-Span ist immer blockbreit) den Span selbst mit Offset 0 —
    // der Caret landete dann am Zeilenanfang statt am Ende, und ein
    // getipptes Wort stand ploetzlich vor dem alten.
    function caretAusPunkt(span, x, y) {
      try {
        const kaesten = zeichenRechtecke(span);
        if (!kaesten.length) return 0;
        let bester = null, bestesMass = Infinity, besterIndex = 0;
        for (let i = 0; i < kaesten.length; i++) {
          const k = kaesten[i];
          if (!k) continue;
          // Erst die Zeile finden (senkrechter Abstand wiegt schwerer),
          // dann darin die naechste Zeichengrenze.
          const dy = y < k.y ? k.y - y : y > k.y + k.h ? y - (k.y + k.h) : 0;
          const dx = x < k.x ? k.x - x : x > k.x + k.b ? x - (k.x + k.b) : 0;
          const mass = dy * 1000 + dx;
          if (mass < bestesMass) { bestesMass = mass; bester = k; besterIndex = i; }
        }
        if (!bester) return span.textContent.length;
        return x > bester.x + bester.b / 2 ? besterIndex + 1 : besterIndex;
      } catch { return span.textContent.length; }
    }

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
      leerMarkieren(el, knoten);
      scrollMarkieren(el);
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

      // Der Link-Anker macht seine Arbeit selbst (href/target stehen) —
      // hier nur dafuer sorgen, dass der Klick nicht zusaetzlich als
      // Block-Klick gewertet wird.
      if (ev.target.closest(".wb-zeile-link")) { ev.stopPropagation(); return; }

      if (ev.target.closest(".wb-zeile-kette")) {
        ev.preventDefault();
        linkDialogOeffnen(el, idx);
        return;
      }

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

  // ------------------------------------------------------- Groesse aendern
  //
  // Der Anfasser unten rechts. Haftnotizen bekommen Breite UND Hoehe (sie
  // sind Gegenstaende und scrollen innen), Textbloecke nur die Breite —
  // ihre Hoehe gehoert dem Text. Live wird der Knoten gestellt, gespeichert
  // wird EINMAL beim Loslassen (ein aendern, ein Undo-Eintrag).
  function anfasserAnbinden(anfasser, knoten) {
    anfasser.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 && ev.pointerType === "mouse") return;
      ev.preventDefault(); ev.stopPropagation();
      const el = elVonKnoten(knoten);
      if (!el || !darfBearbeiten(el)) return;
      const start = ereignisZuWelt(ev);
      const b0 = el.breite, h0 = el.hoehe;
      const minB = el.art === "notiz" ? NOTIZ_MIN_B : TEXT_MIN_B;
      let breiteNeu = b0, hoeheNeu = h0;
      inArbeit.add(el.id);
      knoten.classList.add("wb-skaliert");
      try { anfasser.setPointerCapture(ev.pointerId); } catch { /* schon weg */ }

      const move = (m) => {
        if (m.pointerId !== ev.pointerId) return;
        const p = ereignisZuWelt(m);
        // Hoechstmass ist die Tafel: ein Zettel, der ueber den Rahmen
        // haengt, waere an einer echten Wand auch heruntergefallen.
        breiteNeu = Math.round(klemm(b0 + (p.x - start.x), minB, BOARD_B - el.x));
        knoten.style.width = breiteNeu + "px";
        if (el.art === "notiz") {
          hoeheNeu = Math.round(klemm(h0 + (p.y - start.y), NOTIZ_MIN_H, BOARD_H - el.y));
          knoten.style.height = hoeheNeu + "px";
        }
      };
      const ende = (m) => {
        if (m.pointerId !== ev.pointerId) return;
        anfasser.removeEventListener("pointermove", move);
        anfasser.removeEventListener("pointerup", ende);
        anfasser.removeEventListener("pointercancel", ende);
        knoten.classList.remove("wb-skaliert");
        const geaendert = breiteNeu !== b0 || (el.art === "notiz" && hoeheNeu !== h0);
        if (geaendert) {
          const vorher = { breite: b0, hoehe: h0 };
          el.breite = breiteNeu;
          if (el.art === "notiz") el.hoehe = hoeheNeu;
          blockRendern(el);
          // Textbloecke messen ihre neue Hoehe erst NACH dem Umbruch —
          // blockGeaendert tut das, darum steht der Undo-Eintrag danach.
          blockGeaendert(el, true);
          undoMerken({ typ: "aendern", id: el.id, vorher,
                       nachher: { breite: el.breite, hoehe: el.hoehe } });
        } else blockRendern(el);
        if (!istInBearbeitung(el.id)) inArbeit.delete(el.id);
      };
      anfasser.addEventListener("pointermove", move);
      anfasser.addEventListener("pointerup", ende);
      anfasser.addEventListener("pointercancel", ende);
    });
  }

  // ------------------------------------------------- Adressen automatisch
  //
  // Endet eine Zeile beim Verlassen auf eine Adresse, wird sie verknuepft —
  // der Text bleibt stehen wie getippt. Wer "www.kunde.de" schreibt, meint
  // die Seite; sie danach noch von Hand einzuhaengen waere Arbeit fuer
  // etwas, das schon dasteht. Liefert true, wenn sich etwas geaendert hat.
  function adressenErkennen(el) {
    let neu = false;
    for (const z of el.inhalt.zeilen) {
      if (z.link) continue;
      const treffer = ADRESSE_AM_ENDE.exec(z.t || "");
      if (!treffer) continue;
      const roh = treffer[0].trim().replace(/[.,;:!?)\]]+$/, "");
      let ziel = "";
      if (/^https?:\/\//i.test(roh)) ziel = roh;
      else if (/^www\./i.test(roh)) ziel = "https://" + roh;
      else if (roh.includes("@")) ziel = "mailto:" + roh;
      if (ziel && LINK_ERLAUBT.test(ziel)) { z.link = ziel; neu = true; }
    }
    return neu;
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
    strichFahne(el);
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
    pfeileAuffrischen();
    flaeche.dataset.ansicht = ziel;
    const r = ansichtRechteck(ziel);
    if (!r) return;
    ansichtPassend = true;
    fitAuf(r.x, r.y, r.b, r.h, undefined, fitLuftDeckel(ziel));
  }

  // =================================================================
  // Nachbar-Pfeile: die Wand hat Kanten, und man soll sie sehen
  // =================================================================
  //
  // Sieht man EINE Tafel an, erscheinen an den Raendern Pfeile — aber nur
  // dort, wo in der zweireihigen Wand wirklich eine Nachbar-Tafel haengt.
  // Ein Pfeil ins Leere waere schlimmer als keiner: er verspricht etwas.

  const RICHTUNGEN = ["links", "rechts", "oben", "unten"];

  // Index der angesehenen Tafel im team, oder -1 in der "Alle"-Ansicht.
  function angeseheneTafel() {
    const id = ansichtWahl === "mein" ? ich.id : ansichtWahl;
    return team.findIndex((p) => p.id === id);
  }

  function nachbar(richtung) {
    const i = angeseheneTafel();
    if (i < 0) return null;
    const spalte = i % jeReihe, reihe = Math.floor(i / jeReihe);
    let j = -1;
    if (richtung === "links" && spalte > 0) j = i - 1;
    else if (richtung === "rechts" && spalte < jeReihe - 1) j = i + 1;
    else if (richtung === "oben" && reihe > 0) j = i - jeReihe;
    else if (richtung === "unten") j = i + jeReihe;
    return j >= 0 && j < team.length ? team[j] : null;
  }

  function pfeileAuffrischen() {
    const einzeln = ansichtWahl !== "alle";
    pfeileEl.hidden = !einzeln;
    for (const richtung of RICHTUNGEN) {
      const knopf = $(".wb-pfeil-" + richtung, pfeileEl);
      const p = einzeln ? nachbar(richtung) : null;
      knopf.hidden = !p;
      if (!p) continue;
      // title statt des Haus-Tooltips: der Knopf traegt den Namen schon
      // sichtbar, und ein Chip ueber dem Oben-Pfeil laege genau auf der
      // Kopfzeile.
      const wort = "Zu " + besitzform(p.name.split(" ")[0]) + " Tafel";
      knopf.title = wort;
      knopf.setAttribute("aria-label", wort);
      $("span", knopf).textContent = p.name.split(" ")[0];
      knopf.dataset.ziel = p.id === ich.id ? "mein" : p.id;
    }
  }

  pfeileEl.addEventListener("click", (ev) => {
    const knopf = ev.target.closest(".wb-pfeil");
    if (knopf && knopf.dataset.ziel) ansichtWechseln(knopf.dataset.ziel);
  });

  function aufElementZoomen(el) {
    const bx = versatz.get(tafelVon(el)) || 0;
    const by = versatzY.get(tafelVon(el)) || 0;
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
    const blockWerkzeug = neu === "text" || neu === "notiz";
    $(".wb-kontext-stift").hidden = neu !== "stift";
    $(".wb-kontext-groesse").hidden = !blockWerkzeug;
    $(".wb-kontext-zettel-trenner").hidden = neu !== "notiz";
    $(".wb-kontext-notiz").hidden = neu !== "notiz";
    $(".wb-kontext-trenner").hidden = neu !== "stift" && !blockWerkzeug;
    // Der Schwammkreis erscheint erst mit der ersten Mausbewegung — sonst
    // staende er nach dem Umschalten verloren in der Ecke.
    schwammKreis.hidden = true;
    if (neu !== "stift" && neu !== "text" && neu !== "notiz") fremdLeisteZeigen(null);
    kontextMarkieren();
    ablagenMarkieren();
    cursorSetzen();
  }

  function kontextMarkieren() {
    $$(".wb-kontext-farben .wb-farbe").forEach((b) => b.classList.toggle("wb-aktiv", b.dataset.farbe === stiftFarbe));
    $$(".wb-kontext-dicken .wb-dicke").forEach((b) => b.classList.toggle("wb-aktiv", b.dataset.dicke === stiftDicke));
    $$(".wb-kontext-notiz .wb-zettelwahl").forEach((b) => b.classList.toggle("wb-aktiv", b.dataset.zettel === zettelFarbe));
    $$(".wb-neugroesse").forEach((b) => b.classList.toggle("wb-aktiv", Number(b.dataset.groesse) === neuGroesse));
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
    const neugroesse = ev.target.closest(".wb-neugroesse");
    if (neugroesse) {
      neuGroesse = Number(neugroesse.dataset.groesse);
      // Ueber die Sitzung hinaus merken: wer gross schreibt, schreibt meist
      // weiter gross. localStorage kann in privaten Fenstern werfen.
      try { localStorage.setItem(GROESSE_SCHLUESSEL, String(neuGroesse)); } catch { /* egal */ }
      kontextMarkieren();
      return;
    }
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
  let aufziehen = null;                    // Vorschau-Rahmen fuer eine neue Notiz
  const fremdHinweisZuletzt = new Map();   // boardId -> ms des letzten Hinweises

  // Kommt dieses Rad-Ereignis von einem Touchpad? Der Browser sagt es
  // nicht, also wird geschlossen: Ein Mausrad rastet — es liefert grosse,
  // GANZE deltaY-Schritte (100/120/150), nie ein deltaX und manchmal
  // deltaMode 1 (Zeilen). Ein Touchpad schiebt stufenlos: gebrochene
  // Werte, kleine Betraege und sehr wohl ein deltaX.
  //
  // Die Entscheidung wird kurz gepuffert: ein Geraet wechselt nicht
  // mitten in einer Geste, und am Ende eines Wischschwungs faellt beim
  // Touchpad gern einmal ein runder ganzer Wert an. Erst nach 400 ms
  // Ruhe wird neu entschieden.
  const radMerk = { touchpad: false, zeit: -1e9 };
  function istTouchpad(ev) {
    const jetzt = performance.now();
    if (jetzt - radMerk.zeit < 400) { radMerk.zeit = jetzt; return radMerk.touchpad; }
    let touchpad;
    if (ev.deltaMode !== 0) touchpad = false;                       // Zeilen/Seiten = Rad
    else if (ev.deltaX !== 0) touchpad = true;                      // Raeder kennen kein X
    else if (!Number.isInteger(ev.deltaY)) touchpad = true;         // stufenlos = Touchpad
    else touchpad = Math.abs(ev.deltaY) > 0 && Math.abs(ev.deltaY) < 50;
    radMerk.touchpad = touchpad; radMerk.zeit = jetzt;
    return touchpad;
  }

  // Rad: Strg/Pinch zoomt auf den Zeiger, Zweifinger-Wischen verschiebt die
  // Wand, das klassische Mausrad zoomt weiter (daran sind Mausnutzer
  // gewoehnt), Shift+Rad faehrt seitwaerts. passive:false ist Pflicht —
  // Chromium macht Wheel-Listener sonst passiv, und preventDefault verhallt
  // (die Seite zoomt/scrollt dann mit).
  flaeche.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const zeilen = ev.deltaMode === 1 ? 24 : 1;
    // Ueber einer zu vollen Haftnotiz blaettert das Rad IM Zettel. Die
    // Wand nimmt den Rad-Ereignissen sonst alles weg (preventDefault) —
    // das interne Scrollen kaeme nie zustande.
    if (!ev.ctrlKey && ev.deltaY) {
      const kasten = ev.target.closest && ev.target.closest(".wb-zeilen.wb-scrollt");
      if (kasten) {
        const vorher = kasten.scrollTop;
        kasten.scrollTop += ev.deltaY * zeilen;
        if (kasten.scrollTop !== vorher) return;
      }
    }
    const p = ereignisZuSchirm(ev);
    radGesteAnstossen();
    // Pinch am Touchpad kommt als ctrl+wheel mit kleinen Deltas — feinere
    // Uebersetzung, sonst springt der Zoom.
    if (ev.ctrlKey) { zoomUm(Math.exp(-ev.deltaY * zeilen * 0.012), p.x, p.y); return; }
    if (ev.shiftKey) {
      ansicht.tx -= (ev.deltaY || ev.deltaX) * zeilen;
      ansichtPassend = false;
      panKlemmen(); anwenden();
      return;
    }
    if (istTouchpad(ev)) {
      // Zweifinger-Wischen schiebt die Wand in BEIDE Richtungen — genau
      // das, was die Geste ueberall sonst tut.
      ansicht.tx -= ev.deltaX * zeilen;
      ansicht.ty -= ev.deltaY * zeilen;
      ansichtPassend = false;
      panKlemmen(); anwenden();
      return;
    }
    zoomUm(Math.exp(-ev.deltaY * zeilen * 0.0022), p.x, p.y);
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
    if (ev.target.closest(".wb-kopf,.wb-leiste,.wb-hilfe,.wb-toasts,.wb-pfeile,.wb-fremdleiste,.wb-schild,.wb-wischenknopf,.wb-ablage,.wb-kasten,.wb-griff,.wb-groesse-griff,.wb-zeile-tools,.wb-zeile-link,.wb-abhaken")) return;
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
      neuAufziehenStarten(ev);
    }
  });

  flaeche.addEventListener("pointermove", (ev) => {
    const merk = aktivePointer.get(ev.pointerId);
    if (merk) { merk.x = ev.clientX; merk.y = ev.clientY; }
    if (pinch) { pinchBewegen(); return; }
    if (pan) { panBewegen(ev); return; }
    if (aufziehen) { neuAufziehenBewegen(ev); return; }
    if (marquee) { marqueeBewegen(ev); return; }
    fremdLeisteAktualisieren(ev);
  });
  flaeche.addEventListener("pointerleave", () => fremdLeisteZeigen(null));

  const pointerLoslassen = (ev) => {
    aktivePointer.delete(ev.pointerId);
    if (pinch && aktivePointer.size < 2) { pinch = null; gesteBeenden(); }
    if (pan && ev.pointerId === pan.pointerId) panBeenden();
    if (aufziehen) neuAufziehenBeenden(ev, ev.type === "pointercancel");
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
  // Was man nicht bearbeiten darf, ist bewusst NIE ein Treffer — sonst
  // wuerde man es anfassen und der Server antwortete mit 404.
  function elementTreffer(ev) {
    const blockKnoten = ev.target.closest && ev.target.closest(".wb-el");
    if (blockKnoten) {
      const el = elemente.get(blockKnoten.dataset.id);
      return el && darfBearbeiten(el) ? el : null;
    }
    const w = ereignisZuWelt(ev);
    return strichTreffer(w, 6 / ansicht.s);
  }

  // Punkt-zu-Strich auf der Tafel unter dem Zeiger: bbox-Vorfilter, dann
  // Abstand Punkt->Segment.
  function strichTreffer(w, toleranz) {
    const boardId = boardAnPunkt(w);
    if (!boardId) return null;
    const striche = stricheJeBoard.get(boardId) || [];
    const bx = versatz.get(boardId), by = versatzY.get(boardId);
    const x = w.x - bx, y = w.y - by;
    for (let i = striche.length - 1; i >= 0; i--) {
      const el = striche[i];
      if (!darfBearbeiten(el)) continue;
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
    marquee = { x0: ev.clientX, y0: ev.clientY, zusatz: ev.shiftKey,
                aufElement: !!(ev.target.closest && ev.target.closest(".wb-el")) };
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
    const aufElement = marquee.aufElement;
    marqueeAbbrechen();
    if (Math.abs(z.x - a.x) < 4 && Math.abs(z.y - a.y) < 4) {
      // Klick auf eine Tafel in der Uebersicht: hinfahren. In der Wand
      // stehen fuenf Boards nebeneinander — sie anzuklicken ist die
      // naheliegendste Art hinzukommen, naeher als der Umschalter oben.
      if (ansichtWahl === "alle" && !aufElement) {
        const boardId = boardAnPunkt(a);
        if (boardId) ansichtWechseln(boardId === ich.id ? "mein" : boardId);
      }
      return;
    }
    if (!zusatz) auswahl.clear();
    // Bounding-Box-Schnitt ueber alles, was man anfassen darf — eigene
    // Elemente und fremde Aufgaben auf der eigenen Tafel, Striche wie
    // Bloecke, jeweils am Versatz IHRER Tafel gemessen.
    for (const el of elemente.values()) {
      if (!darfBearbeiten(el)) continue;
      const bx = versatz.get(tafelVon(el)), by = versatzY.get(tafelVon(el));
      if (bx === undefined) continue;
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

  // Hinweis, wenn man etwas anfassen will, das einem nicht gehoert — also
  // weder selbst geschrieben noch auf der eigenen Tafel. SCHREIBEN darf man
  // seit dem 31.08.2026 ueberall; nur wegwischen und aendern nicht.
  function fremdHinweis(el) {
    const schluessel = el.id || el;
    const jetzt = Date.now();
    if ((fremdHinweisZuletzt.get(schluessel) || 0) > jetzt - 5000) return;
    fremdHinweisZuletzt.set(schluessel, jetzt);
    toast("Nur ansehen — das gehört zu " + besitzform(vorname(tafelVon(el))) + " Tafel.");
  }

  // Die dezente Leiste "Du schreibst auf Janniks Tafel": solange ein
  // Schreibwerkzeug ueber einer fremden Tafel steht. Ohne sie waere die
  // neue Freiheit eine Falle — man notierte versehentlich bei anderen.
  function fremdLeisteZeigen(boardId) {
    if (!boardId) {
      fremdLeiste.hidden = true;
      raum.classList.remove("wb-schreibhinweis");
      return;
    }
    $("span", fremdLeiste).textContent = "Du schreibst auf " + besitzform(vorname(boardId)) + " Tafel";
    fremdLeiste.hidden = false;
    raum.classList.add("wb-schreibhinweis");
  }

  function fremdLeisteAktualisieren(ev) {
    const schreibend = werkzeug === "stift" || werkzeug === "text" || werkzeug === "notiz";
    if (!schreibend) { fremdLeisteZeigen(null); return; }
    const boardId = boardAnPunkt(ereignisZuWelt(ev));
    fremdLeisteZeigen(boardId && boardId !== ich.id ? boardId : null);
  }

  // Nach dem Anlegen auf fremder Tafel: kurz sagen, was passiert ist.
  function aufgabeGemeldet(boardId) {
    if (boardId === ich.id) return;
    toast("Aufgabe für " + vorname(boardId) + " notiert.");
  }

  // ------------------------------------------------- Notiz/Text aufziehen
  //
  // Ein Klick legt die Standardgroesse an (wie bisher), ein aufgezogenes
  // Rechteck genau diese Groesse. Der Vorschau-Rahmen zeigt dabei, was
  // entsteht — sonst zoege man ins Blaue.
  function neuAufziehenStarten(ev) {
    const w = ereignisZuWelt(ev);
    const boardId = boardAnPunkt(w);
    if (!boardId) return;
    // Ohne preventDefault nimmt das Standard-mousedown dem frisch
    // fokussierten Span den Fokus sofort wieder weg — der neue Block
    // waere leer, und leer heisst bei Textbloecken: geloescht.
    ev.preventDefault();
    aufziehen = { x0: ev.clientX, y0: ev.clientY, boardId, pointerId: ev.pointerId, gezogen: false };
    try { flaeche.setPointerCapture(ev.pointerId); } catch { /* egal */ }
  }

  function neuAufziehenBewegen(ev) {
    if (ev.pointerId !== aufziehen.pointerId) return;
    const r = rectHolen();
    const b = Math.abs(ev.clientX - aufziehen.x0), h = Math.abs(ev.clientY - aufziehen.y0);
    aufziehen.gezogen = aufziehen.gezogen || b > 8 || h > 8;
    neuRahmen.hidden = !aufziehen.gezogen;
    neuRahmen.style.left = (Math.min(aufziehen.x0, ev.clientX) - r.left) + "px";
    neuRahmen.style.top = (Math.min(aufziehen.y0, ev.clientY) - r.top) + "px";
    neuRahmen.style.width = b + "px";
    neuRahmen.style.height = h + "px";
  }

  function neuAufziehenBeenden(ev, abgebrochen) {
    if (ev.pointerId !== aufziehen.pointerId) return;
    const zug = aufziehen;
    aufziehen = null;
    neuRahmen.hidden = true;
    if (abgebrochen) return;
    const a = ereignisZuWelt({ clientX: zug.x0, clientY: zug.y0 });
    const z = ereignisZuWelt(ev);
    const istNotiz = werkzeug === "notiz";
    const masse = zug.gezogen
      ? { breite: Math.abs(z.x - a.x), hoehe: Math.abs(z.y - a.y),
          x: Math.min(a.x, z.x), y: Math.min(a.y, z.y) }
      : null;
    platzieren(zug.boardId, a, masse, istNotiz);
  }

  // welt = Weltpunkt des Klicks, masse = aufgezogenes Weltrechteck (oder
  // null fuer Standardgroesse).
  function platzieren(boardId, welt, masse, istNotiz) {
    const bx = versatz.get(boardId), by = versatzY.get(boardId);
    const standardB = istNotiz ? 340 : 520;
    let breiteNeu, hoeheNeu, x, y;
    if (masse) {
      breiteNeu = Math.round(klemm(masse.breite, istNotiz ? NOTIZ_MIN_B : TEXT_MIN_B, BOARD_B));
      hoeheNeu = Math.round(klemm(masse.hoehe, NOTIZ_MIN_H, BOARD_H));
      x = klemm(Math.round(masse.x - bx), 0, BOARD_B - breiteNeu);
      y = klemm(Math.round(masse.y - by), 0, BOARD_H - hoeheNeu);
    } else {
      breiteNeu = standardB;
      hoeheNeu = istNotiz ? 200 : 60;
      x = klemm(Math.round(welt.x - bx - (istNotiz ? breiteNeu / 2 : 20)), 0, BOARD_B - breiteNeu);
      y = klemm(Math.round(welt.y - by - (istNotiz ? 60 : 24)), 0, BOARD_H - 120);
    }
    const zeile = () => [{ t: "", erledigt: false, gestrichen: false }];
    const el = {
      id: crypto.randomUUID(),
      besitzer: ich.id,        // wer es geschrieben hat
      tafel: boardId,          // auf wessen Board es haengt
      art: istNotiz ? "notiz" : "text",
      x, y, breite: breiteNeu, hoehe: hoeheNeu,
      version: 1,
      inhalt: istNotiz
        ? { zeilen: zeile(), liste: "keine", farbe: stiftFarbe, groesse: neuGroesse, zettel: zettelFarbe }
        : { zeilen: zeile(), liste: "keine", farbe: stiftFarbe, groesse: neuGroesse },
    };
    elemente.set(el.id, el);
    inArbeit.add(el.id);
    blockRendern(el);
    anlegenEinreihen(el);
    undoMerken({ typ: "anlegen", id: el.id });
    werkzeugSetzen("auswahl");
    aufgabeGemeldet(boardId);
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
    else if (werkzeug === "stift") fremdLeisteAktualisieren(ev);
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
    fremdLeisteZeigen(null);
  });

  function stiftAnsetzen(ev) {
    const w = ereignisZuWelt(ev);
    const boardId = boardAnPunkt(w);
    // Auf JEDE Tafel darf geschrieben werden — so gibt man eine Aufgabe.
    if (!boardId) return;
    try { leinwand.setPointerCapture(ev.pointerId); } catch { /* egal */ }
    const bx = versatz.get(boardId), by = versatzY.get(boardId);
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
      tafel: boardId,
    };
    liveStrich = zeichnung;
  }

  function stiftBewegen(ev) {
    const bx = versatz.get(zeichnung.tafel), by = versatzY.get(zeichnung.tafel);
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
    const tafel = zeichnung.tafel;
    if (!zuWenig) zeichnungFestschreiben();
    zeichnung = null;
    liveStrich = null;
    if (!zuWenig) aufgabeGemeldet(tafel);
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
    strichAnlegen(punkte, zeichnung.farbe, zeichnung.dicke, zeichnung.tafel);
  }

  // Ein Strich-Element aus fertigen Punkten bauen, anzeigen und speichern.
  // Gemeinsamer Weg fuer den Stift und fuer die Reststuecke des Schwamms.
  function strichAnlegen(punkte, farbe, dicke, tafel) {
    const bbox = strichBbox(punkte, dicke);
    const el = {
      id: crypto.randomUUID(),
      besitzer: ich.id,
      tafel,
      art: "strich",
      x: bbox.x, y: bbox.y, breite: bbox.breite, hoehe: bbox.hoehe,
      version: 1,
      inhalt: { punkte, farbe, dicke },
    };
    elemente.set(el.id, el);
    stricheJeBoard.get(tafel).push(el);
    strichFahne(el);
    anlegenEinreihen(el);
    undoMerken({ typ: "anlegen", id: el.id });
    schilderAuffrischen();
    return el;
  }

  // =================================================================
  // Schwamm: radiert punktgenau — Tinte wie getippten Text
  // =================================================================
  //
  // Der Radius ist in BILDSCHIRM-px konstant (wird durch s geteilt): der
  // Schwamm in der Hand ist immer gleich gross, egal wie nah man an der
  // Wand steht. Die Bewegung wird in Radius/2-Schritten interpoliert,
  // damit eine schnelle Wischbewegung nichts ueberspringt.
  //
  // Es verschwindet NUR, was der Schwamm wirklich beruehrt:
  //   Striche  — die Stuetzpunkte im Radius fallen weg; beim Loslassen
  //              wird der Strich durch seine Reststuecke ersetzt (altes
  //              Element loeschen, je Stueck ein neues anlegen).
  //   Text     — die beruehrten ZEICHEN fallen weg ("Test" -> "Tet").
  //              Waehrend der Geste wird das contenteditable NICHT
  //              angefasst (Fokus und Caret waeren hin), sondern eine
  //              Vorschau auf den Tinten-Canvas gelegt.
  // Die GANZE Wischbewegung ist EIN Undo-Eintrag und stellt exakt den
  // Ausgangszustand wieder her.

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
    if (!boardAnPunkt(w)) return;
    try { leinwand.setPointerCapture(ev.pointerId); } catch { /* egal */ }
    schwammZug = { pointerId: ev.pointerId, letzte: w };
    schwammKreisSetzen(ev);
    schwammTreffen(w, ev);
  }

  function schwammBewegen(ev) {
    schwammKreisSetzen(ev);
    const w = ereignisZuWelt(ev);
    const radius = SCHWAMM_RADIUS_PX / ansicht.s;
    const schritt = radius / 2;
    const { x, y } = schwammZug.letzte;
    const dx = w.x - x, dy = w.y - y;
    const strecke = Math.hypot(dx, dy);
    const schritte = Math.max(1, Math.ceil(strecke / schritt));
    const r = rectHolen();
    for (let i = 1; i <= schritte; i++) {
      const t = i / schritte;
      schwammTreffen({ x: x + dx * t, y: y + dy * t },
                     // Bildschirmpunkt fuer den Textvergleich mitfuehren:
                     // getClientRects liefert Viewport-Koordinaten.
                     { clientX: r.left + (x + dx * t) * ansicht.s + ansicht.tx,
                       clientY: r.top + (y + dy * t) * ansicht.s + ansicht.ty });
    }
    schwammZug.letzte = w;
  }

  function schwammTreffen(w, schirm) {
    const radius = SCHWAMM_RADIUS_PX / ansicht.s;
    const boardId = boardAnPunkt(w);
    if (!boardId) return;
    const bx = versatz.get(boardId), by = versatzY.get(boardId);
    const x = w.x - bx, y = w.y - by;
    let neu = false;

    for (const el of stricheJeBoard.get(boardId) || []) {
      const r = radius + el.inhalt.dicke / 2;
      if (x < el.x - r || x > el.x + el.breite + r || y < el.y - r || y > el.y + el.hoehe + r) continue;
      if (!strichAbstandOk(el, x, y, r)) continue;
      if (!darfBearbeiten(el)) { fremdHinweis(el); continue; }
      let weg = schwammStriche.get(el.id);
      if (!weg) { weg = new Set(); schwammStriche.set(el.id, weg); }
      const p = el.inhalt.punkte, r2 = r * r;
      for (let i = 0; i < p.length; i += 2) {
        const ddx = p[i] - x, ddy = p[i + 1] - y;
        if (ddx * ddx + ddy * ddy <= r2 && !weg.has(i / 2)) { weg.add(i / 2); neu = true; }
      }
    }

    // Getippter Text: je Zeile die Zeichen-Rechtecke gegen den Kreis
    // pruefen. Die Rechtecke werden EINMAL je Block gemessen — waehrend
    // der Wischgeste steht die Ansicht still, und getClientRects fuer
    // jedes Zeichen bei jeder Bewegung waere pures Layout-Verbrennen.
    if (schirm) {
      for (const el of elemente.values()) {
        if (el.art === "strich" || tafelVon(el) !== boardId) continue;
        const knoten = elementKnoten.get(el.id);
        if (!knoten) continue;
        const kasten = knoten.getBoundingClientRect();
        if (schirm.clientX < kasten.left - SCHWAMM_RADIUS_PX || schirm.clientX > kasten.right + SCHWAMM_RADIUS_PX
            || schirm.clientY < kasten.top - SCHWAMM_RADIUS_PX || schirm.clientY > kasten.bottom + SCHWAMM_RADIUS_PX) continue;
        if (!darfBearbeiten(el)) { fremdHinweis(el); continue; }
        const eintrag = schwammTextEintrag(el, knoten);
        if (!eintrag) continue;
        const r2 = SCHWAMM_RADIUS_PX * SCHWAMM_RADIUS_PX;
        for (const zeile of eintrag.zeilen) {
          for (let i = 0; i < zeile.kaesten.length; i++) {
            if (zeile.weg.has(i)) continue;
            const k = zeile.kaesten[i];
            if (!k) continue;
            // Ein Zeichen faellt, wenn der Schwamm seine MITTE erwischt.
            // Gemessen an der Kante waere ein 36-px-Schwamm ueber einer
            // Handschrift immer drei Buchstaben breit — man koennte nie
            // gezielt eines wegnehmen. Die Mitte macht daraus eine Regel,
            // die man nach dem ersten Mal im Gefuehl hat.
            const ddx = schirm.clientX - (k.x + k.b / 2);
            const ddy = schirm.clientY - (k.y + k.h / 2);
            if (ddx * ddx + ddy * ddy <= r2) { zeile.weg.add(i); neu = true; }
          }
        }
      }
    }

    if (neu) { tintenDirty = true; zeichnenAnfordern(); }
  }

  // Zeichen-Rechtecke eines Blocks messen (einmal je Wischgeste).
  function schwammTextEintrag(el, knoten) {
    let eintrag = schwammTexte.get(el.id);
    if (eintrag) return eintrag;
    const spans = $$(".wb-zeile-text", knoten);
    if (!spans.length) return null;
    eintrag = { id: el.id, zeilen: spans.map((span, idx) => ({
      idx, span, text: span.textContent, kaesten: zeichenRechtecke(span), weg: new Set(),
    })) };
    schwammTexte.set(el.id, eintrag);
    return eintrag;
  }

  // Ein Rechteck je Zeichen — ueber Range.getClientRects auf den
  // Textknoten. Ein Zeichen ohne Rechteck (Umbruchstelle, Leerzeichen am
  // Zeilenende) bekommt null und ist damit unradierbar; es faellt spaeter
  // nur weg, wenn es das Wort tut.
  function zeichenRechtecke(span) {
    const raus = [];
    const bereich = document.createRange();
    const lauf = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let knoten;
    while ((knoten = lauf.nextNode())) {
      const laenge = knoten.textContent.length;
      for (let i = 0; i < laenge; i++) {
        let kasten = null;
        try {
          bereich.setStart(knoten, i);
          bereich.setEnd(knoten, i + 1);
          const rects = bereich.getClientRects();
          for (const r of rects) {
            if (r.width > 0 && r.height > 0) { kasten = { x: r.x, y: r.y, b: r.width, h: r.height }; break; }
          }
        } catch { kasten = null; }
        raus.push(kasten);
      }
    }
    return raus;
  }

  function schwammVerwerfen() {
    schwammStriche.clear();
    schwammTexte.clear();
    tintenDirty = true; zeichnenAnfordern();
  }

  function schwammLoslassen(abgebrochen) {
    schwammZug = null;
    if (abgebrochen || (!schwammStriche.size && !schwammTexte.size)) { schwammVerwerfen(); return; }

    const striche = [...schwammStriche.entries()];
    const texte = [...schwammTexte.values()];
    schwammStriche.clear();
    schwammTexte.clear();

    // Die ganze Wischbewegung ist EIN Undo-Schritt — sonst braeuchte man
    // nach einem Zug ueber drei Striche dreimal Strg+Z.
    sammelnBeginnen();
    try {
      for (const [id, weg] of striche) {
        if (!weg.size) continue;
        strichZerteilen(elemente.get(id), weg);
      }
      for (const eintrag of texte) zeichenSchneiden(eintrag);
    } finally { sammelnAbschliessen(); }
    tintenDirty = true; zeichnenAnfordern();
  }

  // Einen Strich durch seine Reststuecke ersetzen. Stuecke unter zwei
  // Punkten fallen weg — ein einzelner Punkt waere ein Tupfer, den
  // niemand stehen lassen wollte, wenn er ihn gerade wegwischt.
  function strichZerteilen(el, weg) {
    if (!el || el.art !== "strich") return;
    const p = el.inhalt.punkte;
    const n = p.length / 2;
    const stuecke = [];
    let lauf = [];
    for (let i = 0; i < n; i++) {
      if (weg.has(i)) {
        if (lauf.length >= 4) stuecke.push(lauf);
        lauf = [];
      } else {
        lauf.push(p[i * 2], p[i * 2 + 1]);
        // Server-Grenze (6000 Zahlen): ein Stueck bleibt teilbar.
        if (lauf.length / 2 >= MAX_PUNKTE_JE_STRICH) {
          stuecke.push(lauf);
          lauf = [p[i * 2], p[i * 2 + 1]];
        }
      }
    }
    if (lauf.length >= 4) stuecke.push(lauf);
    const tafel = tafelVon(el);
    const { farbe, dicke } = el.inhalt;
    elementLoeschen([el.id]);
    for (const stueck of stuecke) strichAnlegen(stueck, farbe, dicke, tafel);
  }

  // Die radierten Zeichen wirklich aus dem Modell schneiden — EINMAL je
  // Block, danach ein einziges blockRendern.
  function zeichenSchneiden(eintrag) {
    const el = elemente.get(eintrag.id);
    if (!el) return;
    let etwas = false;
    const neueZeilen = eintrag.zeilen.map((zeile) => {
      if (!zeile.weg.size) return null;
      etwas = true;
      let raus = "";
      for (let i = 0; i < zeile.text.length; i++) if (!zeile.weg.has(i)) raus += zeile.text[i];
      return raus.replace(/ /g, " ");
    });
    if (!etwas) return;

    // Ein Textblock, der komplett leer wird, verschwindet (Regel wie beim
    // Verlassen); eine Haftnotiz bleibt als Gegenstand stehen. Der
    // Loesch-Weg fasst el.inhalt bewusst NICHT an — die Undo-Kopie soll
    // den Originaltext tragen.
    const kuenftig = el.inhalt.zeilen.map((z, i) => (neueZeilen[i] == null ? z.t : neueZeilen[i]));
    if (el.art === "text" && kuenftig.every((t) => !t.trim())) { elementLoeschen([el.id]); return; }

    const vorher = JSON.parse(JSON.stringify(el.inhalt));
    el.inhalt.zeilen.forEach((z, i) => { if (neueZeilen[i] != null) z.t = neueZeilen[i]; });
    blockRendern(el);
    blockGeaendert(el, true);
    undoMerken({ typ: "aendern", id: el.id, vorher: { inhalt: vorher },
                 nachher: { inhalt: JSON.parse(JSON.stringify(el.inhalt)) } });
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
      // "tafel" entscheidet, auf WESSEN Board es landet; den Autor setzt
      // der Server selbst auf die angemeldete Person.
      id: el.id, tafel: tafelVon(el), art: el.art,
      x: el.x, y: el.y, breite: el.breite, hoehe: el.hoehe,
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
          toast(tafelVon(el) === ich.id ? "Deine Tafel ist voll — erst etwas wegwischen."
                                        : besitzform(vorname(tafelVon(el))) + " Tafel ist voll.");
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

  // Loeschen UND Wiederherstellen zaehlen serverseitig die Version hoch —
  // der Trigger bumpt bei jedem Update, damit auch Tombstones ueber den
  // Delta-Cursor zu den anderen Browsern reisen. Ein zurueckgeholtes Element
  // traegt hier also eine zu alte Nummer, und die naechste Aenderung daran
  // liefe in einen 409: Die Verschiebung ginge verloren, und der Hinweis
  // "In anderer Sitzung geaendert" waere schlicht gelogen — es war niemand
  // sonst beteiligt (31.08.2026 gemessen: anlegen, verschieben, zweimal
  // Strg+Z, zweimal Strg+Y -> die Lage fiel zurueck, auch nach dem Neuladen).
  //
  // Also nach dem Zurueckholen die echten Nummern nachziehen. Nur die
  // Nummern: Der Inhalt in der Datenbank ist genau der, den wir eben wieder
  // eingehaengt haben — waehrend ein Element geloescht war, hat ihn niemand
  // angefasst. Ueber den Delta-Cursor, weil das gerade Beruehrte darin
  // ohnehin steht; ein eigener Endpunkt waere dafuer zu viel Apparat.
  function versionenNachziehen(ids) {
    const seit = new Date(Date.now() - 30000).toISOString();
    fetch(`/api/whiteboard/elemente?seit=${encodeURIComponent(seit)}`)
      .then((a) => (a.ok ? a.json() : null))
      .then((daten) => {
        if (!daten || !daten.ok) return;
        const gesucht = new Set(ids);
        for (const frisch of daten.elemente || []) {
          if (!gesucht.has(frisch.id)) continue;
          const hier = elemente.get(frisch.id);
          if (hier && frisch.version > (hier.version || 0)) hier.version = frisch.version;
        }
      })
      .catch(() => { /* der naechste Poll richtet es sonst */ });
  }

  function wiederherstellen(kopien) {
    if (!kopien.length) return;
    if (!sitzungWeg) {
      const ids = kopien.map((e) => e.id);
      nachKetten(ids, () =>
        senden("/api/whiteboard/wiederherstellen", { ids })
          .then(({ daten }) => {
            if (daten.ok) { speicherFehler = 0; versionenNachziehen(ids); }
          })
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
      strichFahne(el);
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
    for (const el of elemente.values()) if (tafelVon(el) === ich.id) n++;
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
    // Gewischt wird das BOARD — auch Aufgaben, die andere hier
    // hingeschrieben haben. Wie am echten Whiteboard; Undo holt alles zurueck.
    const kopien = [...elemente.values()].filter((el) => tafelVon(el) === ich.id);
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
  // Zeile verknuepfen: Adressfeld + Live-Vorschlaege aus dem CRM
  // =================================================================
  //
  // "100 Cold Calls für YoKan" soll die Anrufliste danebenhaengen haben,
  // "E-Mail an Krotzer" die Adresse. Die Daten liegen im CRM — sie noch
  // einmal abzutippen waere die schlechteste Art, sie zu haben. Gesucht
  // wird ueber /api/whiteboard/verknuepfung; die Zeile selbst liefert das
  // erste Suchwort (ohne Fuellwoerter).

  const linkDialog = $(".wb-link-dialog");
  const linkEingabe = $(".wb-link-eingabe");
  const linkTrefferEl = $(".wb-link-treffer");
  let linkZiel = null;          // {el, idx}
  let linkTimer = 0;
  let linkLauf = 0;             // laufende Nummer: alte Antworten verfallen

  const GRUPPEN = [["kunde", "Kundenakte"], ["mail", "E-Mail"], ["web", "Webseite"], ["liste", "Anrufliste"]];

  // Suchwort aus einer Zeile: Fuellwoerter und reine Zahlen raus, der Rest
  // bleibt stehen. Aus "E-Mail an Krotzer schicken" wird "Krotzer".
  function suchwortAus(text) {
    const worte = String(text || "")
      .split(/[\s,;:!?"'()\[\]/]+/)
      .map((w) => w.replace(/^[.\-–—]+|[.\-–—]+$/g, ""))
      .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !STOPPWORTE.has(w.toLowerCase()));
    return worte.slice(0, 4).join(" ").slice(0, 60);
  }

  function linkDialogOeffnen(el, idx) {
    const zeile = el.inhalt.zeilen[idx];
    if (!zeile) return;
    linkZiel = { el, idx };
    $(".wb-link-zeile").textContent = zeile.t.trim() || "Leere Zeile";
    linkEingabe.value = zeile.link || "";
    $(".wb-link-weg").hidden = !zeile.link;
    linkTrefferEl.textContent = "";
    linkDialog.showModal();
    // Vorbefuellt wird die SUCHE, nicht das Adressfeld: das Wort ist ein
    // Suchbegriff, keine Adresse.
    const wort = suchwortAus(zeile.t);
    if (wort && !zeile.link) linkSuchen(wort);
    else if (zeile.link) linkHinweis("Adresse steht — oder unten neu suchen.");
    linkEingabe.focus();
    linkEingabe.select();
  }

  function linkHinweis(text) {
    linkTrefferEl.textContent = "";
    const p = document.createElement("p");
    p.className = "wb-link-leer";
    p.textContent = text;
    linkTrefferEl.appendChild(p);
  }

  async function linkSuchen(wort) {
    const q = String(wort || "").trim();
    if (q.length < 2) { linkTrefferEl.textContent = ""; return; }
    const lauf = ++linkLauf;
    try {
      const antwort = await fetch("/api/whiteboard/verknuepfung?q=" + encodeURIComponent(q));
      if (antwort.status === 401) { sitzungAbgelaufen(); return; }
      const daten = await antwort.json();
      if (lauf !== linkLauf) return;                 // eine neuere Suche laeuft
      linkTrefferZeigen(daten.treffer || [], q);
    } catch {
      // Ohne Vorschlaege laesst sich die Adresse trotzdem eintippen —
      // ein Fehlerdialog waere hier lauter als der Nutzen.
      if (lauf === linkLauf) linkHinweis("Keine Vorschläge gerade — Adresse von Hand eintragen.");
    }
  }

  function linkTrefferZeigen(treffer, wort) {
    linkTrefferEl.textContent = "";
    if (!treffer.length) { linkHinweis("Nichts zu „" + wort + "“ gefunden."); return; }
    for (const [art, ueberschrift] of GRUPPEN) {
      const teil = treffer.filter((t) => t.art === art);
      if (!teil.length) continue;
      const kopf = document.createElement("div");
      kopf.className = "wb-link-gruppe";
      kopf.textContent = ueberschrift;
      linkTrefferEl.appendChild(kopf);
      for (const t of teil) {
        if (!LINK_ERLAUBT.test(String(t.url || ""))) continue;
        const knopf = document.createElement("button");
        knopf.type = "button"; knopf.className = "wb-link-treffer-zeile";
        knopf.dataset.url = t.url;
        const titel = document.createElement("b");
        titel.textContent = t.titel || t.url;
        const unter = document.createElement("span");
        unter.textContent = t.unter || t.url;
        knopf.append(titel, unter);
        linkTrefferEl.appendChild(knopf);
      }
    }
    // Reicht die Liste ueber den Rand, sagt eine weiche Kante unten, dass
    // es weitergeht — ein am Dialogfuss abgeschnittener Eintrag saehe sonst
    // aus wie ein Fehler, nicht wie eine Liste.
    linkTrefferEl.classList.toggle("wb-mehr",
      linkTrefferEl.scrollHeight > linkTrefferEl.clientHeight + 1);
  }

  linkEingabe.addEventListener("input", () => {
    clearTimeout(linkTimer);
    const wert = linkEingabe.value.trim();
    // Wer schon eine Adresse tippt, sucht nicht mehr — sonst blinkte die
    // Liste bei jedem Zeichen einer langen URL.
    if (/^(https?:\/\/|mailto:|\/)/i.test(wert)) { linkTrefferEl.textContent = ""; return; }
    linkTimer = setTimeout(() => linkSuchen(wert), 250);
  });

  linkTrefferEl.addEventListener("click", (ev) => {
    const knopf = ev.target.closest(".wb-link-treffer-zeile");
    if (!knopf) return;
    linkEingabe.value = knopf.dataset.url;
    linkUebernehmen();
  });

  $(".wb-link-abbrechen").addEventListener("click", () => linkDialog.close());
  $(".wb-link-ok").addEventListener("click", () => linkUebernehmen());
  $(".wb-link-weg").addEventListener("click", () => linkSetzen(""));
  linkEingabe.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); linkUebernehmen(); }
  });

  function linkUebernehmen() {
    const roh = linkEingabe.value.trim();
    if (!roh) { linkSetzen(""); return; }
    const ziel = adresseNormalisieren(roh);
    if (!ziel) { linkHinweis("Das ist keine Adresse — es geht https://, http://, mailto: oder eine Seite dieses OS."); return; }
    linkSetzen(ziel);
  }

  // Aus Eingetipptem eine erlaubte Adresse machen — oder "" (dann nichts).
  // Interne Ziele reisen ABSOLUT: der Server nimmt nur http/https/mailto,
  // ein "/crm/firma/…" wuerde beim Speichern still verschwinden. Beim
  // Anzeigen erkennt intern() den eigenen Ursprung wieder und oeffnet im
  // selben Tab.
  function adresseNormalisieren(roh) {
    if (roh.startsWith("/")) return location.origin + roh;
    if (/^(https?:\/\/|mailto:)/i.test(roh)) return LINK_ERLAUBT.test(roh) ? roh : "";
    if (/^www\./i.test(roh)) return "https://" + roh;
    if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(roh)) return "mailto:" + roh;
    return "";
  }

  function linkSetzen(adresse) {
    if (!linkZiel) { linkDialog.close(); return; }
    const { el, idx } = linkZiel;
    const zeile = elemente.has(el.id) && el.inhalt.zeilen[idx];
    linkDialog.close();
    if (!zeile) return;
    const vorher = JSON.parse(JSON.stringify(el.inhalt));
    if (adresse) zeile.link = adresse; else delete zeile.link;
    blockRendern(el);
    blockGeaendert(el, true);
    undoMerken({ typ: "aendern", id: el.id, vorher: { inhalt: vorher },
                 nachher: { inhalt: JSON.parse(JSON.stringify(el.inhalt)) } });
    if (mobilOffen && mobilOffen.el.id === el.id) {
      const mobilZeile = mobilOffen.liste.children[idx];
      if (mobilZeile) linkAnkerSetzen(mobilZeile, adresse);
    }
    toast(adresse ? "Verknüpft." : "Link entfernt.");
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
    // Alt+Pfeil: zur Nachbar-Tafel — dieselben Wege wie die Randpfeile.
    if (ev.altKey && /^Arrow(Left|Right|Up|Down)$/.test(ev.key)) {
      const richtung = { ArrowLeft: "links", ArrowRight: "rechts", ArrowUp: "oben", ArrowDown: "unten" }[ev.key];
      const p = nachbar(richtung);
      if (p) { ev.preventDefault(); ansichtWechseln(p.id === ich.id ? "mein" : p.id); }
      return;
    }
    if (strg || ev.altKey) return;
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
      if (ev.target.closest(".wb-zeile-link")) { ev.stopPropagation(); return; }
      if (ev.target.closest(".wb-zeile-kette")) {
        ev.preventDefault();
        // Erst den getippten Stand ins Modell, sonst verknuepfte man eine
        // Zeile, die es so noch gar nicht gibt.
        mobilUebernehmen();
        linkDialogOeffnen(el, zeilenIndex(zeile));
        return;
      }
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
      const neu = {
        t: $(".wb-zeile-text", zeile).textContent.slice(0, DATEN.grenzen.zeichenJeZeile),
        erledigt: zeile.classList.contains("wb-erledigt"),
        gestrichen: zeile.classList.contains("wb-gestrichen") && !zeile.classList.contains("wb-erledigt"),
      };
      // Der Link steht im Anker der Zeile — er ueberlebt Umsortieren und
      // Loeschen dadurch genauso wie Haken und Streichung.
      const anker = $(".wb-zeile-link", zeile);
      const ziel = anker && anker.getAttribute("href");
      if (ziel && LINK_ERLAUBT.test(ziel)) neu.link = ziel;
      zeilen.push(neu);
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
    // Wie am Schreibtisch: die leere Haftnotiz bleibt, der leere Textblock geht.
    if (el.art !== "notiz" && el.inhalt.zeilen.every((z) => !z.t.trim())) {
      elementLoeschen([el.id], { still: true });
      inArbeit.delete(el.id);
      return;
    }
    adressenErkennen(el);
    blockRendern(el);
    blockGeaendert(el, true);
    inArbeit.delete(el.id);
  }

  // Tap auf einen eigenen Block oeffnet am Telefon das Blatt — der Klick
  // laeuft ueber die Buehne, weil die Zeilen dort ohne Zeigergeraet
  // bewusst nicht fokussierbar sind (CSS nimmt ihnen die pointer-events).
  buehne.addEventListener("click", (ev) => {
    if (!istMobil() || mobilOffen) return;
    const knoten = ev.target.closest(".wb-el");
    if (!knoten || !knoten.classList.contains("wb-darf")) return;
    if (ev.target.closest(".wb-abhaken,.wb-zeile-tools,.wb-zeile-link,.wb-kasten,.wb-griff,.wb-groesse-griff")) return;
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
  flaeche.dataset.ansicht = ansichtWahl;
  pfeileAuffrischen();
  pollPlanen();

  // Ablesbarer Zustand fuer Tests und Fehlersuche (Muster __gehirn).
  window.__wb = {
    get elemente() { return elemente.size; },
    // Nur die drei Zahlen kopieren, nicht das ganze Objekt: GSAP haengt
    // beim Tweenen einen Cache (_gsap) daran, und der zeigt im Kreis auf
    // sich selbst — jedes JSON.stringify daran wirft.
    get ansicht() { return { s: ansicht.s, tx: ansicht.tx, ty: ansicht.ty }; },
    get ansichtWahl() { return ansichtWahl; },
    get redrawZeit() { return redrawZeit; },
    get werkzeug() { return werkzeug; },
    get auswahl() { return auswahl.size; },
    get neuGroesse() { return neuGroesse; },
    get wand() { return { breite: WAND_B, hoehe: WAND_H, reihen, jeReihe }; },
    get ich() { return ich.id; },
    // Welche Nachbar-Pfeile stehen gerade zur Verfuegung?
    get pfeile() {
      return RICHTUNGEN.filter((r) => !$(".wb-pfeil-" + r, pfeileEl).hidden);
    },
    // Fuer Tests: kompakter Blick auf ein Board (das TAFEL-Board).
    stand(tafel) {
      return [...elemente.values()]
        .filter((e) => tafelVon(e) === (tafel || ich.id))
        .map((e) => ({ id: e.id, art: e.art, version: e.version,
                       besitzer: e.besitzer, tafel: tafelVon(e),
                       x: e.x, y: e.y, breite: e.breite, hoehe: e.hoehe,
                       punkte: e.inhalt.punkte ? e.inhalt.punkte.length : 0,
                       links: e.inhalt.zeilen ? e.inhalt.zeilen.map((z) => z.link || "") : [],
                       zeilen: e.inhalt.zeilen ? e.inhalt.zeilen.map((z) => (z.erledigt ? "[x] " : "[ ] ") + z.t) : e.inhalt.punkte.length }));
    },
  };
})();
