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

  // ------------------------------------------------ Einordnung nach Rang
  //
  // Ein Text- oder Notizblock darf eine Kategorie tragen. Die REIHENFOLGE
  // dieser Liste IST die Rangfolge — und sie steht seit dem 01.09.2026 auf
  // 1 Kunden · 2 Vertrieb · 3 Content & Wissen · 4 Intern & System, und seit
  // dem 08.09.2026 5 CRM & Anrufe (Content bringt Umsatz, das Interne kann
  // warten, und der Hoerer wird abgearbeitet, wenn der Tag es hergibt).
  // Dieselben fuenf Namen in derselben Reihenfolge stehen im Server (KATEGORIEN in
  // whiteboard-routes.js) — was hier nicht steht, wirft er weg. Ohne
  // Kategorie bleibt ein Block liegen, wo er liegt: freies Kritzeln bleibt
  // frei, und genau das ist eine Tafel wert.
  //
  // "farbe" sind KEINE neuen Werte, sondern die Marker-Tinten: rot fuer
  // Kunden, orange fuer Vertrieb, gruen fuer Content, lila fuer Internes und
  // petrol fuer CRM. So traegt die Wand weiterhin EINE Palette.
  //
  // "kopf" ist dieselbe Farbe eine Stufe tiefer — sie traegt die Ueberschrift
  // IM Block. Warum nicht die Tinte selbst: die Tinten sind fuer STRICHE
  // gemischt, und Orange (#C26E1E) kommt als Schrift auf der (im Dunkelmodus
  // entblendeten) Tafel nur auf 2,9:1. Die Werte hier sind gemessen und
  // liegen auf jeder Tafelstelle in jedem Theme ueber 5:1 — die Tafel ist in
  // allen vier Themes hell, darum reicht EIN Satz Werte.
  const KATEGORIEN = [
    { wert: "kunden",   kurz: "Kunden",   lang: "Kunden",           farbe: "rot",
      kopf: "#A32F2F", toast: "Als Kunden-Aufgabe eingeordnet." },
    { wert: "vertrieb", kurz: "Vertrieb", lang: "Vertrieb",         farbe: "orange",
      kopf: "#8A4C0C", toast: "Als Vertriebs-Aufgabe eingeordnet." },
    { wert: "content",  kurz: "Content",  lang: "Content & Wissen", farbe: "gruen",
      kopf: "#1F6B42", toast: "Als Content-Aufgabe eingeordnet." },
    { wert: "intern",   kurz: "Intern",   lang: "Intern & System",  farbe: "lila",
      kopf: "#613C96", toast: "Als interne Aufgabe eingeordnet." },
    // 08.09.2026, Wunsch von Lukas: "Beim Whiteboard eine 5. Kategorie
    // einfuegen mit To-Dos CRM — und die werden automatisch eingefuegt."
    // Hier landet, was ein ANRUFERGEBNIS hinterlaesst (lib/crm.js,
    // anrufAufgabe): das gebuchte Erstgespraech, das Nachfassen ohne Termin
    // und das "Spaeter nochmal". Sie stehen bewusst NICHT mehr bei Kunden:
    // Kunden ist die Arbeit AM Kunden, CRM die Arbeit AM HOERER — und die
    // wird am Stueck abgetelefoniert, nicht zwischen Kundenaufgaben gesucht.
    // Von Hand an einer Firma angelegte Aufgaben bleiben bei Kunden.
    // Rang 5 (letzter): Ein Anruf, der heute nicht rausgeht, geht morgen
    // raus; ein zugesagter Kundentermin nicht.
    { wert: "crm",      kurz: "CRM",      lang: "CRM & Anrufe",     farbe: "petrol",
      kopf: "#0B5A63", toast: "Als CRM-Aufgabe eingeordnet." },
  ];
  const kategorieVon = (wert) => KATEGORIEN.find((k) => k.wert === wert) || null;
  // Rang eines Elements: 0 = Kunden … 3 = Intern, -1 = nicht eingeordnet.
  const kategorieRang = (el) =>
    KATEGORIEN.findIndex((k) => k.wert === (el.inhalt && el.inhalt.kategorie));
  // Die Ueberschrift, die ein Kategorie-Block selbst traegt: "1 · Kunden".
  // Sie steht NICHT im Datenmodell — sie folgt aus der Kategorie und wird
  // gerendert. Wer sie aendern will, aendert die Kategorie.
  const kategorieTitel = (k) => (KATEGORIEN.indexOf(k) + 1) + " · " + k.lang;

  // ------------------------------------------------ Die fuenf festen Plaetze
  //
  // Jede Kategorie hat EINEN Platz auf der Tafel (2400x1400), in Leserichtung:
  //     1 Kunden   2 Vertrieb   3 Content      (obere Reihe)
  //     4 Intern   5 CRM                       (untere Reihe)
  // Beim Einordnen und beim Ordnen rueckt der Kategorie-Block dorthin. Von
  // Hand darf man ihn weiterhin verschieben — er bleibt dann liegen, bis
  // wieder geordnet wird.
  //
  // WARUM DREI SPALTEN und nicht drei Reihen (08.09.2026, fuenfte Kategorie):
  // Auf der Tafel ist die WAAGRECHTE die grosszuegige Achse und die SENKRECHTE
  // die knappe. Ein Block ist 560 breit (BLOCK_BREITE in lib/aufgaben-tafel.js)
  // und waechst nach UNTEN, Zeile fuer Zeile — in der Breite passiert nichts.
  // Bei 2400 Breite steht neben zwei 560ern noch ein dritter bequem; bei 1400
  // Hoehe abzueglich ORD_RAND blieben bei drei Reihen nur rund 413 px je Band,
  // und ausgerechnet der CRM-Block ist der laengste (eine abtelefonierte Liste
  // sind schnell zehn Zeilen). Drei Reihen haetten also die knappe Achse noch
  // einmal gedrittelt und die grosszuegige verschenkt.
  // Die Rechnung: 1670 + 560 = 2230 < 2400, Luecke zwischen den Spalten 210,
  // Rand links 130 (unveraendert), rechts 170. Und die beiden BESTEHENDEN
  // Plaetze der ersten Spalte (130/100 und 130/760) bleiben, wo sie waren —
  // wer heute einen Kunden-Block hat, findet ihn morgen am selben Fleck.
  const ORD_X = [130, 900, 1670];   // Spalte 1, 2, 3
  const ORD_Y = [100, 760];         // Reihe 1, Reihe 2
  const ORD_SPALTEN = ORD_X.length;
  const ORD_LUFT = 60;          // Abstand zwischen zwei Bloecken einer Spalte
  const ORD_RAND = 60;          // Sicherheitsabstand zur unteren Tafelkante
  // Der Platz eines Rangs (0…4): Spalte = Rang modulo Spaltenzahl, Reihe =
  // obere bzw. untere Haelfte. Der sechste Platz (Spalte 3, Reihe 2) bleibt
  // frei — dort waechst die naechste Kategorie hinein, ohne dass sich etwas
  // anderes verschiebt.
  const platzVon = (rang) => ({ x: ORD_X[rang % ORD_SPALTEN],
                                y: ORD_Y[rang < ORD_SPALTEN ? 0 : 1] });

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
  // schicken" soll "Krotzer" uebrig bleiben. Die erste Fassung war bewusst
  // kurz — im Gebrauch ging damit "Bitte Angebot Krotzer freigeben" als
  // "Angebot Krotzer freigeben" in die Suche (31.08.2026 gemessen). Was
  // eine Zeile ueber die TAETIGKEIT sagt, sagt nichts ueber das GESUCHTE;
  // uebrig bleiben soll der Name, die Firma, die Sache.
  const STOPPWORTE = new Set([
    "e-mail", "email", "mail", "mails", "an", "am", "auf", "aus", "bei", "bis", "für", "fuer",
    "im", "in", "mit", "nach", "von", "vom", "zu", "zum", "zur", "über", "ueber", "wegen",
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer",
    "und", "oder", "noch", "nochmal", "bitte", "heute", "morgen", "übermorgen", "uebermorgen",
    "gestern", "neu", "neue", "neuen", "nächste", "naechste", "nächsten", "naechsten", "woche",
    "schicken", "senden", "verschicken", "schreiben", "anrufen", "anruf", "rufen", "telefonat",
    "telefonieren", "melden", "nachfassen", "nachhaken", "nachfrage", "nachfragen",
    "calls", "call", "cold", "webseite", "website", "seite", "bauen", "machen", "erstellen",
    "erledigen", "erledigt", "prüfen", "pruefen", "checken", "klären", "klaeren", "abschließen",
    "abschliessen", "aufräumen", "aufraeumen", "vorbereiten", "besprechen", "abstimmen",
    "termin", "termine", "angebot", "angebote", "rechnung", "rechnungen", "freigeben",
    "fertig", "offen", "dringend", "asap", "kw",
    // Wochentage: "Anruf Krotzer Dienstag" soll nach Krotzer suchen.
    "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonnabend", "sonntag",
    "mo", "di", "mi", "do", "fr", "sa", "so",
  ]);
  // Alles ohne einen einzigen Buchstaben ist eine Zahl, ein Datum oder eine
  // Uhrzeit ("12.05.", "14:30", "2026") — als Suchwort wertlos. Dazu die
  // Kalenderwoche in ihren ueblichen Schreibweisen.
  const OHNE_BUCHSTABE = /^[^a-zà-öø-ÿ]+$/i;
  const KALENDERWOCHE = /^kw[-.\s]?\d+$/i;

  // Tintenfarben: EINE Palette fuer alle Themes. Die Tafel bleibt auch im
  // Dunkelmodus hell — das dunkle Haus-Blau #4B8DF8 ist fuer dunkle
  // Untergruende gedacht und faellt auf der hellen Tafel auf 2,5:1 ab
  // (gemessen). Das Chrom wechselt mit dem Theme, die Tinte nie.
  // "petrol" (08.09.2026) ist KEINE Stiftfarbe — es steht bewusst nicht in
  // FARBNAMEN. Es ist die Tinte der fuenften Kategorie "CRM" und faerbt nur
  // deren Punkt, Schild und Ueberschrift. Warum kein Blau: #2563EB ist die
  // HAUSFARBE (Knoepfe, Links, Auswahlrahmen) — ein Kategorie-Schild in genau
  // diesem Blau saehe auf der Tafel aus wie ein Bedienelement. Petrol liegt
  // weit genug von Rot/Orange/Gruen/Lila UND vom Hausblau entfernt und steht
  // auf der (in jedem Theme hellen) Tafel bei 6,1:1.
  const TINTE_HELL = { schwarz: "#2B3036", blau: "#2563EB", rot: "#C03B3B", gruen: "#2E8555", orange: "#C26E1E", lila: "#7A4FB6", petrol: "#0E6E7A" };
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
    // Antworten: Sprechblase mit drei Punkten — "hier steht noch etwas aus".
    antwort: S('<path d="M20.5 12.4a7.6 7.6 0 0 1-8.2 7.6L7 21.5l1.3-3.7A7.6 7.6 0 1 1 20.5 12.4Z"/><path d="M9.4 12.3h.01M12.6 12.3h.01M15.8 12.3h.01"/>'),
    // Der kleine Pfeil VOR der Antwort: Ecke nach unten und rechts — das
    // gelernte Bild fuer "das gehoert zur Zeile darueber".
    antwortPfeil: S('<path d="M6 5v6a3 3 0 0 0 3 3h9"/><path d="m14.5 10.5 4 3.5-4 3.5"/>'),
    // Einruecken: drei Zeilen, die unteren beiden nach rechts versetzt, davor
    // der kleine Pfeil — "das hier gehoert UNTER die Zeile darueber".
    einruecken: S('<path d="M4 6h16M11 12h9M11 18h9"/><path d="m4 12.2 3 2.8-3 2.8"/>'),
    pfeil: S('<path d="m14.5 5.5-6 6.5 6 6.5"/>'),
    ecke: S('<path d="M20 10v10H10"/><path d="M20 20 12.5 12.5"/>'),
    // Ordnen: von lang nach kurz, daneben der Pfeil nach unten — das
    // gelernte Bild fuer "sortieren", ohne ein Wort dafuer zu brauchen.
    ordnen: S('<path d="M4 6h11M4 12h7M4 18h4"/><path d="M18 4.5v14"/><path d="m15 15.5 3 3 3-3"/>'),
  };

  // Ein Block ohne Listenform mit genau EINER Zeile hat die FORM einer
  // Ueberschrift. Das allein sagt noch nichts — auch "Krotzer anrufen" sieht
  // so aus. Erst zusammen mit einer passenden Kategorie wird daraus eine
  // Alt-Ueberschrift (siehe istAltUeberschrift).
  const istUeberschrift = (el) => !!el && el.art !== "strich"
    && el.inhalt.liste === "keine" && el.inhalt.zeilen.length === 1;

  // ------------------------------------------- Alt-Ueberschriften (Bestand)
  //
  // Bis zum 01.09.2026 schrieb man die Ueberschrift als EIGENEN Block ueber
  // die Liste ("Kunden" mit Kategorie kunden, liste:"keine", eine Zeile).
  // Seitdem traegt der Kategorie-Block seine Ueberschrift selbst — die alten
  // Bloecke stehen aber noch in der Datenbank und werden dort getrennt
  // entfernt. Bis dahin duerfen sie nicht ZUSAETZLICH zum neuen Kopf
  // dastehen: dann stuende "1 · Kunden" ueber "Kunden" ueber der Liste.
  //
  // Erkannt wird streng: Kategorie gesetzt, Ueberschrift-Form UND ein Text,
  // der genau die Kategorie benennt. Steht dort etwas anderes ("Krotzer
  // anrufen"), ist es eine Aufgabe und bleibt sichtbar — eine Zeile
  // wegzublenden, die jemand wirklich geschrieben hat, waere der teuerste
  // aller Fehler.
  const ORDNUNGSWORT = /^(erstens|zweitens|drittens|viertens|prio|priorit(?:ae|ä)t)\s+/;
  const wortKern = (s) => String(s || "").toLowerCase()
    .replace(/[0-9]+/g, " ")                         // "1." / "1 ·" faellt weg
    .replace(/[^a-zà-öø-ÿ&]+/g, " ")
    .replace(/\s+/g, " ").trim()
    .replace(ORDNUNGSWORT, "");
  // Was als Name DIESER Kategorie durchgeht. Absichtlich grosszuegig bei den
  // Schreibweisen, die im Haus wirklich vorkommen — und absichtlich eng bei
  // allem anderen.
  const KOPFWORTE = {
    kunden:   ["kunden", "kunde", "kundschaft"],
    vertrieb: ["vertrieb", "sales", "akquise"],
    content:  ["content", "content & wissen", "content wissen", "wissen"],
    intern:   ["intern", "internes", "intern & system", "intern system", "system"],
  };
  function istAltUeberschrift(el) {
    if (!el || el.art === "strich" || !istUeberschrift(el)) return false;
    const kat = el.inhalt.kategorie;
    if (!KOPFWORTE[kat]) return false;
    return KOPFWORTE[kat].includes(wortKern(el.inhalt.zeilen[0] && el.inhalt.zeilen[0].t));
  }

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
          ${/* Die drei schnellen Wege zur Antwort stehen hier zusammen —
                den Knopf am Blockrand findet man von selbst, diese drei
                nicht. */""}
          <dt>Auf die Zeile antworten</dt><dd><kbd>Alt</kbd>+<kbd>A</kbd></dd>
          <dt>Wort markieren → antworten</dt><dd>Doppelklick im Text</dd>
          ${/* Der Teilstrich hat bewusst KEIN Tastenkuerzel: er braucht immer
                erst eine Markierung, und wer markiert hat, hat die Blase schon
                vor Augen. Hier steht er trotzdem — sonst erfaehrt nie jemand,
                dass man auch nur ein Wort streichen kann. */""}
          <dt>Nur ein Wort durchstreichen</dt><dd>Markieren → <b>Durchstreichen</b></dd>
          <dt>Antwort bearbeiten</dt><dd>Doppelklick auf die Antwort</dd>
          ${/* Der Griff links an der Zeile ist die einzige Stelle, an der man
                eine EINZELNE Aufgabe anfassen kann — ohne diesen Satz findet
                ihn niemand, weil er erst beim Ueberfahren erscheint. */""}
          <dt>Zeile verschieben</dt><dd>Griff <b>⠿</b> links ziehen → andere Stelle, anderer Block, fremde Tafel</dd>
          <dt>Unterpunkt ein- / ausrücken</dt><dd><kbd>Tab</kbd> / <kbd>Umschalt</kbd>+<kbd>Tab</kbd></dd>
          <dt>Leere Zeile entfernen</dt><dd><kbd>⌫</kbd> in der leeren Zeile</dd>
          <dt>Nur diese Zeile löschen</dt><dd>In die Zeile klicken → Papierkorb rechts</dd>
        </dl>
        ${/* Die Rangfolge steht hier, weil sie nirgends sonst als Ganzes zu
              sehen ist: im Werkzeugkasten waehlt man EINE Kategorie, der Kopf
              am Block zeigt EINE — welche vorgeht, sagt erst diese Zeile. Die
              fuenf Punkte sind zugleich der Farbschluessel. */""}
        <h3 class="wb-hilfe-rang-titel">Die fünf Blöcke</h3>
        <p class="wb-hilfe-rang">Jede Kategorie hat EINEN Block mit eigener
          Überschrift und einen festen Platz auf der Tafel:</p>
        <ol class="wb-rangliste"></ol>
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
      ${/* Auf eine Zeile antworten: "Partnerzuweisung angefragt". Die Antwort
            sagt NICHT "erledigt", sondern "hier ist gerade nichts zu tun" —
            die Zeile wird danach ruhig gestellt (siehe .wb-wartet). Derselbe
            Dialog-Bauplan wie beim Verknuepfen: hier wird getippt, und die
            Wand darf dafuer einen Moment stillstehen. Ein Textfeld statt
            einer Zeile, weil man beim Tippen umbricht — gespeichert wird
            trotzdem EIN Text (antwortNormalisieren macht Leerzeichen daraus,
            denn das Datenmodell kennt je Zeile genau eine Antwort). */""}
      <dialog class="wb-dialog wb-antwort-dialog">
        <h2>Antwort hinterlegen</h2>
        <div class="sub wb-antwort-zeile"></div>
        <label class="wb-antwort-feld">
          <span>Antwort</span>
          <textarea class="wb-antwort-eingabe" rows="3" maxlength="400"
                    placeholder="z. B. Partnerzuweisung angefragt — warte auf Rückmeldung"
                    autocomplete="off" spellcheck="false"></textarea>
        </label>
        <p class="wb-antwort-hinweis">Die Aufgabe bleibt offen — sie bekommt nur
          ein Warte-Zeichen statt eines leeren Kästchens.</p>
        <div class="dialog-fuss">
          <button type="button" class="sekundaer wb-antwort-weg" hidden>Antwort löschen</button>
          <span class="wb-antwort-luft"></span>
          <button type="button" class="sekundaer wb-antwort-abbrechen">Abbrechen</button>
          <button type="button" class="wb-antwort-ok">Übernehmen</button>
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
    // Die Raenge in der Hilfe — Nummer, Farbpunkt, voller Name. Die Liste
    // steht als 3x2-Raster (CSS, seit 08.09.2026) und ist damit zugleich die
    // KARTE der Tafel: 1-2-3 in der oberen Reihe, 4-5 in der unteren —
    // genau dort liegen die fuenf Bloecke auch wirklich.
    const rang = $(".wb-rangliste");
    KATEGORIEN.forEach((k) => {
      const li = document.createElement("li");
      li.style.setProperty("--kf", tinte(k.farbe));
      li.textContent = k.lang;
      rang.appendChild(li);
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

  // Ein Kind fuer die Stifte und den Schwamm in der Ablage. Es traegt
  // ZWEI Dinge, die am Knopf selbst keinen Platz mehr haben:
  //   1. die unsichtbare Trefferflaeche — ein 118x26 grosser Stift misst in
  //      der Tafel-Ansicht nur 53x12 Bildschirm-px (whiteboard.css),
  //   2. das data-tip. Am Knopf haengt es in der Falle von B-1:
  //      [data-tip]::after ueberschreibt dessen eigenes ::after — beim
  //      Stift den Farbring, beim Schwamm die Gebrauchsspuren. Sichtbar
  //      war das nur auf der EIGENEN Tafel, denn nur dort gibt es Tooltips.
  // Am Kind stoert es niemanden: seine beiden Pseudos sind frei.
  function ablageKind(eigen, tip) {
    const i = document.createElement("i");
    if (eigen) i.setAttribute("data-tip", tip);
    return i;
  }

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
      // Nicht in der Tab-Reihenfolge: fremde Ablagen sind Deko, und die
      // eigene doppelt nur die Leisten-Chips — Tastatur waehlt dort.
      m.tabIndex = -1;
      m.appendChild(ablageKind(eigen, "Stift: " + name));
      ablage.appendChild(m);
    });
    const sw = document.createElement("button");
    sw.type = "button"; sw.className = "wb-schwammknopf";
    sw.setAttribute("aria-label", "Schwamm");
    sw.tabIndex = -1;
    sw.appendChild(ablageKind(eigen, "Schwamm (E)"));
    ablage.appendChild(sw);

    // Die beiden Tafel-Knoepfe stehen in EINER Reihe am oberen Rahmen:
    // ordnen, dann wischen. Getrennt positioniert waeren es zwei Knoepfe
    // mit zwei Gegen-Skalierungen an derselben Ecke — sie schoeben sich bei
    // jedem Zoomschritt uebereinander. Die Reihe traegt die Skalierung, die
    // vorher am Wisch-Knopf hing; an seiner Optik aendert das nichts.
    const knopfreihe = document.createElement("div");
    knopfreihe.className = "wb-tafelknoepfe";
    const ok = document.createElement("button");
    ok.type = "button"; ok.className = "wb-ordnenknopf";
    ok.innerHTML = ICON.ordnen + "<span>Nach Priorität ordnen</span>";
    ok.setAttribute("aria-label", "Nach Priorität ordnen");
    // An der eigenen Tafel gehoert er hin wie der Schwamm. An einer fremden
    // erscheint er nur, wenn dort wirklich etwas Eingeordnetes von einem
    // selbst haengt — schilderAuffrischen() entscheidet das nach jeder
    // Aenderung neu. Ein Knopf, der nichts zu tun haette, waere ein
    // Versprechen ins Leere.
    ok.hidden = !eigen;
    ok.addEventListener("click", () => nachRangOrdnen(person.id));
    knopfreihe.appendChild(ok);
    wrap.appendChild(knopfreihe);

    if (eigen) {
      const wk = document.createElement("button");
      wk.type = "button"; wk.className = "wb-wischenknopf";
      wk.innerHTML = ICON.wisch + "<span>Tafel wischen</span>";
      knopfreihe.appendChild(wk);
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
      ordnen: ok,
      ablage,
    });
  }
  team.forEach(boardBauen);

  // Namensschilder: Rolle, Fortschritt (nur ☐-Zeilen), zuletzt aktiv,
  // Anwesenheits-Punkt. Wird nach jedem Poll und jeder Aenderung genaehrt.
  function schilderAuffrischen() {
    // EINMAL fuer die ganze Wand: wer traegt den Kopf, welche
    // Alt-Ueberschrift schweigt. Beides wird hier und in kennzeichenPruefen
    // gebraucht — zweimal zu rechnen waere zweimal derselbe Rundgang.
    const koepfe = kategorieKoepfe();
    const stillgelegt = (el) => istAltUeberschrift(el)
      && koepfe.has(tafelVon(el) + "|" + el.inhalt.kategorie);
    for (const person of team) {
      const k = boardKnoten.get(person.id);
      if (!k) continue;
      let gesamt = 0, erledigt = 0, anzahl = 0, ordenbar = 0, wartend = 0;
      for (const el of elemente.values()) {
        // Gezaehlt wird, was auf der TAFEL liegt — eine Aufgabe, die jemand
        // hier hingeschrieben hat, gehoert zum Fortschritt dieser Person.
        if (tafelVon(el) !== person.id) continue;
        // Eine ausgeblendete Alt-Ueberschrift zaehlt nirgends mit: was man
        // nicht sieht, darf weder den Leerhinweis verhindern noch als
        // ordenbar gelten.
        if (stillgelegt(el)) continue;
        anzahl++;
        if (el.art !== "strich" && kategorieRang(el) >= 0 && darfBearbeiten(el)) ordenbar++;
        if (el.art === "text" || el.art === "notiz") {
          if (el.inhalt.liste === "check") {
            // Unterpunkte zaehlen nicht: sie gliedern EINE Aufgabe, sie sind
            // keine eigenen ("x von y erledigt" meint Aufgaben).
            for (const z of el.inhalt.zeilen) { if (z.ebene === 1) continue; gesamt++; if (z.erledigt) erledigt++; }
          }
          // Wartende Zeilen werden ueber ALLE Bloecke gezaehlt, nicht nur
          // ueber die ☐-Listen wie der Fortschritt. Grund: eine Antwort
          // legt jemand nur dort hin, wo er wirklich haengt — auch auf einer
          // Haftnotiz oder in einer Punktliste. Die Zahl im Schild soll
          // sagen "so viel liegt gerade bei anderen", und dafuer waere die
          // engere Menge die falsche.
          for (const z of el.inhalt.zeilen) {
            if (z.antwort && !z.erledigt && !z.gestrichen) wartend++;
          }
        }
      }
      // Auf einer fremden Tafel nur, wenn dort etwas Eingeordnetes von einem
      // selbst haengt (siehe boardBauen). Auf der eigenen steht er immer —
      // sie ist der Arbeitsplatz, nicht das Gastzimmer.
      if (k.ordnen) k.ordnen.hidden = person.id !== ich.id && !ordenbar;
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
      // "… · 2 warten" nur, wenn es welche gibt: eine Null waere Rauschen —
      // sie stuende auf jedem Schild jeden Tag und saehe man nach der ersten
      // Woche nicht mehr.
      if (wartend) {
        k.unter.append(" · ");
        const w = document.createElement("b");
        w.className = "wb-schild-warten";
        w.textContent = wartend === 1 ? "1 wartet" : wartend + " warten";
        k.unter.append(w);
      }
      k.unter.append(" · " + (da ? "gerade aktiv" : relativeZeit(aktivitaet.get(person.id))));
      k.leer.hidden = anzahl > 0;
    }
    kennzeichenPruefen(koepfe);
  }

  // ------------------------------------------------- Wer traegt den Kopf?
  //
  // Je Tafel und Kategorie gibt es GENAU EINEN Block mit Ueberschrift — den
  // Kategorie-Block. Sonst stuende "1 · Kunden" zweimal auf derselben Tafel,
  // und genau das war der Anlass fuer diesen Umbau.
  //
  // Normalerweise gibt es ohnehin nur einen: wer eine Aufgabe einordnet,
  // deren Kategorie schon einen Block hat, landet IN diesem Block
  // (inKategorieBlockLegen). Mehrere entstehen nur noch aus Bestand, aus
  // einer Haftnotiz mit Kategorie oder aus einer abgegebenen Aufgabe, die
  // auf einer fremden Tafel neben dem Block des Gastgebers liegt. Fuer die
  // gilt die Rangfolge:
  //   1. die Hand des Tafel-Besitzers vor einer fremden — ein Gast
  //      uebernimmt nicht die Ueberschrift des Gastgebers,
  //   2. Textblock vor Haftnotiz — Aufgabenlisten sind Textbloecke,
  //   3. weiter oben, weiter links,
  //   4. id, damit die Wahl bei Gleichstand ueberall dieselbe ist.
  // Alt-Ueberschriften zaehlen nie mit: sie werden ausgeblendet.
  function kategorieKoepfe() {
    const beste = new Map();                 // "tafel|kategorie" -> Element
    for (const el of elemente.values()) {
      if (el.art === "strich" || kategorieRang(el) < 0) continue;
      if (istAltUeberschrift(el)) continue;
      const schluessel = tafelVon(el) + "|" + el.inhalt.kategorie;
      const bisher = beste.get(schluessel);
      if (!bisher || kopfBesser(el, bisher)) beste.set(schluessel, el);
    }
    return beste;
  }
  function kopfBesser(a, b) {
    const eigen = (e) => (e.besitzer === tafelVon(e) ? 0 : 1);
    const form = (e) => (e.art === "text" ? 0 : 1);
    return (eigen(a) - eigen(b) || form(a) - form(b) || a.y - b.y || a.x - b.x
            || (a.id < b.id ? -1 : 1)) < 0;
  }

  // Nach jeder Aenderung neu entscheiden, WELCHER Block den Kopf traegt und
  // welche Alt-Ueberschrift schweigt. Nur Klassen, kein Neu-Rendern: sonst
  // riefe das Rendern sich selbst. Das CSS zeigt am Kategorie-Block den Kopf
  // und an allen anderen das kleine Schild.
  function kennzeichenPruefen(vorgerechnet) {
    const koepfe = vorgerechnet || kategorieKoepfe();
    // Eine Alt-Ueberschrift verschwindet nur, wenn ihre Liste noch da ist —
    // sonst naehme man dem Nutzer den einzigen Block, der von seiner Gruppe
    // uebrig ist. Sie hat dann keinen Ersatz und bleibt sichtbar.
    for (const [id, knoten] of elementKnoten) {
      const el = elemente.get(id);
      if (!el) continue;
      const schluessel = tafelVon(el) + "|" + (el.inhalt.kategorie || "");
      const alt = istAltUeberschrift(el) && koepfe.has(schluessel);
      knoten.classList.toggle("wb-altkopf", alt);
      knoten.classList.toggle("wb-kopfblock", !alt && koepfe.get(schluessel) === el);
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

  // EIGENER Schnappschuss fuer die Wischgeste (siehe "Schwamm-Schnappschuss"
  // weiter unten). Getrennt vom Pan/Zoom-Puffer, weil beides gleichzeitig
  // laufen kann: wer beim Radieren am Rad dreht, haette sonst den einen
  // Puffer mit dem anderen ueberschrieben.
  const schwammPuffer = document.createElement("canvas");
  const schwammPufferCtx = schwammPuffer.getContext("2d");
  let schwammBlit = false;                 // Wischgeste laeuft: blitten statt voll zeichnen
  let schwammSchnappOk = false;            // Haelt das gesicherte Bild noch?
  const schwammNachtragen = [];            // frisch markierte Striche: aus dem Bild nehmen

  let tintenDirty = true;                  // Canvas neu zeichnen?
  let buehneDirty = true;                  // CSS-Transform neu schreiben?
  let rafId = 0;

  function zeichnenAnfordern() {
    if (rafId || document.hidden) return;
    rafId = requestAnimationFrame(tick);
  }

  // "An der Tinte hat sich etwas geaendert": Voll-Redraw anfordern UND
  // einen laufenden Schwamm-Schnappschuss fuer ungueltig erklaeren — er
  // zeigt sonst eine Wand, die es so nicht mehr gibt. Der Schwamm selbst
  // ist der EINZIGE, der tintenDirty ohne diese Entwertung setzen darf:
  // seine Vorschau lebt ja gerade davon, dass das Bild darunter steht.
  function tinteNeu() {
    tintenDirty = true;
    schwammSchnappOk = false;
    zeichnenAnfordern();
  }

  function anwenden() { buehneDirty = true; schwammSchnappOk = false; tintenDirty = true; zeichnenAnfordern(); zoomAnzeigen(); }

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
    // Der Fokus-Chip haengt am letzten Zeichen einer Zeile; seine Lage ist in
    // Layout-px gerechnet und muss beim Zoomen nachgemessen werden. Kostet nur
    // etwas, solange ueberhaupt ein Chip steht — und dieser Zweig laeuft nur,
    // wenn sich die Buehne wirklich bewegt hat.
    chipNachziehen();
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
      else if (schwammBlit) schwammFrameZeichnen();
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

  // Die Striche aller Tafeln in EINEN (bereits auf Welt-Koordinaten
  // gestellten) Kontext malen. Herausgeloest aus vollZeichnen, weil der
  // Schwamm-Schnappschuss denselben Code fuer einen KLEINEN Ausschnitt
  // braucht — und zwar auf einer anderen Leinwand.
  //   sicht        Weltfenster {x0,y0,x1,y1}; alles ausserhalb faellt weg
  //   ueberspringen Map/Set von Element-Ids, die NICHT gemalt werden
  function stricheZeichnen(z, sicht, ueberspringen) {
    for (const p of team) {
      const striche = stricheJeBoard.get(p.id);
      if (!striche || !striche.length) continue;
      const bx = versatz.get(p.id), by = versatzY.get(p.id);
      if (bx > sicht.x1 || bx + BOARD_B < sicht.x0 || by > sicht.y1 || by + BOARD_H < sicht.y0) continue;

      // Tinte endet an der Tafelkante — ein Marker schreibt nicht auf die
      // Wand. Der Clip macht auch halb ueber den Rand gewischte Striche
      // glaubwuerdig.
      z.save();
      z.beginPath();
      z.rect(bx, by, BOARD_B, BOARD_H);
      z.clip();

      for (const el of striche) {
        try {
          if (ueberspringen && ueberspringen.has(el.id)) continue;
          const b = el; // bbox liegt am Element (x,y,breite,hoehe, board-relativ)
          const ex0 = b.x + bx, ey0 = b.y + by, ex1 = ex0 + b.breite, ey1 = ey0 + b.hoehe;
          if (ex0 > sicht.x1 || ex1 < sicht.x0 || ey0 > sicht.y1 || ey1 < sicht.y0) continue;
          const weg = schwammStriche.get(el.id);
          const gezogen = ziehVersatz.aktiv && auswahl.has(el.id);
          z.strokeStyle = tinte(el.inhalt.farbe);
          z.lineWidth = el.inhalt.dicke;
          z.globalAlpha = 1;
          if (gezogen) { z.save(); z.translate(ziehVersatz.dx, ziehVersatz.dy); }
          // Angeknabberter Strich: die uebrigen Stuecke voll, die vom
          // Schwamm beruehrten blass — man sieht schon beim Wischen, wo
          // die Luecke entstehen wird.
          if (weg && weg.size) strichStueckeZeichnen(z, el, bx, by, weg);
          else z.stroke(grobModus ? (el._pfadGrob || (el._pfadGrob = strichPfadBauen(el, true))) : pfadVon(el));
          if (gezogen) z.restore();
          if (auswahl.has(el.id)) auswahlRahmen(z, el, bx, by, gezogen);
        } catch (fehler) {
          // Ein kaputtes Element reisst nie die Wand: ueberspringen, melden.
          console.error("Whiteboard: Strich uebersprungen:", el && el.id, fehler);
        }
      }
      z.globalAlpha = 1;
      z.restore();
    }
  }

  // Das ganze Sichtfeld in Weltkoordinaten (mit 40 px Rand fuers Culling).
  function sichtfenster() {
    const w0 = schirmZuWelt(0, 0), w1 = schirmZuWelt(breite, hoehe);
    return { x0: w0.x - 40, y0: w0.y - 40, x1: w1.x + 40, y1: w1.y + 40 };
  }

  // ueberspringen: nur der Schwamm-Schnappschuss setzt das (die gerade
  // markierten Striche kommen dort NICHT ins Bild, sie werden je Frame
  // frisch darueber gemalt).
  function vollZeichnen(ueberspringen) {
    const t0 = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, leinwand.width, leinwand.height);
    ctx.setTransform(dpr * ansicht.s, 0, 0, dpr * ansicht.s, dpr * ansicht.tx, dpr * ansicht.ty);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    stricheZeichnen(ctx, sichtfenster(), ueberspringen);

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
  function strichStueckeZeichnen(z, el, bx, by, weg) {
    const p = el.inhalt.punkte;
    const n = p.length / 2;
    let i = 0;
    while (i < n) {
      const raus = weg.has(i);
      let j = i;
      while (j + 1 < n && weg.has(j + 1) === raus) j++;
      const von = Math.max(0, i - 1), bis = Math.min(n - 1, j + 1);
      if (bis > von) {
        z.globalAlpha = raus ? 0.18 : 1;
        z.beginPath();
        z.moveTo(p[von * 2] + bx, p[von * 2 + 1] + by);
        for (let k = von + 1; k <= bis; k++) z.lineTo(p[k * 2] + bx, p[k * 2 + 1] + by);
        z.stroke();
      }
      i = j + 1;
    }
    z.globalAlpha = 1;
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

  function auswahlRahmen(z, el, bx, by, gezogen) {
    const dx = gezogen ? ziehVersatz.dx : 0, dy = gezogen ? ziehVersatz.dy : 0;
    z.save();
    z.globalAlpha = 1;
    z.strokeStyle = auswahlFarbe;
    z.lineWidth = 1.5 / ansicht.s;
    z.setLineDash([6 / ansicht.s, 5 / ansicht.s]);
    z.strokeRect(el.x + bx + dx - 4, el.y + by + dy - 4, el.breite + 8, el.hoehe + 8);
    z.restore();
  }

  // =================================================================
  // Schwamm-Schnappschuss: die Wischgeste malt nicht die ganze Wand
  // =================================================================
  //
  // Gemessen am 31.08.2026 (1237 Elemente, ein pointermove je Frame):
  // Stift p50/p95 16,7/16,9 ms — Schwamm 33,3/50,1 ms, 62 % der Frames
  // ueber 20 ms. Die Rechenzeit des Treffer-Handlers war es NICHT
  // (p95 0,9 ms selbst ueber 1322 Zeichen): jede Bewegung setzte
  // tintenDirty, und tintenDirty hiess Voll-Redraw ueber ALLE Striche.
  //
  // Also derselbe Trick wie bei Pan/Zoom, nur andersherum: dort steht die
  // Tinte still und die Kamera faehrt, hier steht die Kamera still und ein
  // paar Striche aendern sich. Der Schnappschuss haelt die Wand OHNE die
  // gerade angeknabberten Striche; je Frame wird er einmal geblittet und
  // nur diese wenigen Striche darueber gemalt.
  //
  // Beim Aufsetzen ist der Schnappschuss GRATIS: auf der Leinwand steht
  // in dem Moment genau das gewuenschte Bild (noch ist nichts markiert).
  // Kommt spaeter ein Strich dazu, wird nur SEIN Kasten im Schnappschuss
  // geleert und mit seinen Nachbarn neu gefuellt — nicht die Wand.

  function schwammSchnappSichern() {
    if (schwammPuffer.width !== leinwand.width || schwammPuffer.height !== leinwand.height) {
      schwammPuffer.width = leinwand.width;
      schwammPuffer.height = leinwand.height;
    }
    schwammPufferCtx.setTransform(1, 0, 0, 1, 0, 0);
    schwammPufferCtx.clearRect(0, 0, schwammPuffer.width, schwammPuffer.height);
    schwammPufferCtx.drawImage(leinwand, 0, 0);
    schwammSchnappOk = true;
    schwammNachtragen.length = 0;
  }

  // Einen frisch markierten Strich aus dem Schnappschuss herausrechnen:
  // seinen Kasten leeren und nur die Nachbarn darin neu ziehen. Ohne das
  // schiene der unversehrte Strich unter seiner eigenen blassen Vorschau
  // durch — sichtbar waere gar nichts.
  function schwammSchnappFlicken(el) {
    if (!el || el.art !== "strich") return;
    const bx = versatz.get(tafelVon(el)) || 0, by = versatzY.get(tafelVon(el)) || 0;
    const luft = el.inhalt.dicke + 4;      // Rundkappen ragen ueber die Bbox
    const welt = { x0: el.x + bx - luft, y0: el.y + by - luft,
                   x1: el.x + bx + el.breite + luft, y1: el.y + by + el.hoehe + luft };
    // Weltkasten -> Geraetepixel (dieselbe Kette wie in setTransform).
    const gx = Math.floor((welt.x0 * ansicht.s + ansicht.tx) * dpr) - 1;
    const gy = Math.floor((welt.y0 * ansicht.s + ansicht.ty) * dpr) - 1;
    const gb = Math.ceil((welt.x1 - welt.x0) * ansicht.s * dpr) + 3;
    const gh = Math.ceil((welt.y1 - welt.y0) * ansicht.s * dpr) + 3;
    if (gx > schwammPuffer.width || gy > schwammPuffer.height || gx + gb < 0 || gy + gh < 0) return;
    const z = schwammPufferCtx;
    z.save();
    z.setTransform(1, 0, 0, 1, 0, 0);
    z.beginPath(); z.rect(gx, gy, gb, gh); z.clip();
    z.clearRect(gx, gy, gb, gh);
    z.setTransform(dpr * ansicht.s, 0, 0, dpr * ansicht.s, dpr * ansicht.tx, dpr * ansicht.ty);
    z.lineCap = "round"; z.lineJoin = "round";
    stricheZeichnen(z, welt, schwammStriche);
    z.restore();
  }

  // Ein Frame waehrend der Wischgeste.
  function schwammFrameZeichnen() {
    if (!schwammSchnappOk) {
      // Von aussen hat etwas an der Tinte geruettelt (Poll, Theme, Zoom):
      // einmal die Wand OHNE die Markierten zeichnen und neu sichern.
      vollZeichnen(schwammStriche);
      schwammSchnappSichern();
    } else if (schwammNachtragen.length) {
      for (const el of schwammNachtragen) schwammSchnappFlicken(el);
      schwammNachtragen.length = 0;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, leinwand.width, leinwand.height);
    ctx.drawImage(schwammPuffer, 0, 0);
    schwammVorschauZeichnen();
    schwammTextVorschau();
  }

  // Die angeknabberten Striche ueber den Schnappschuss: uebrige Stuecke
  // voll, beruehrte blass. Das sind waehrend einer Geste eine Handvoll —
  // nicht zwoelfhundert.
  function schwammVorschauZeichnen() {
    if (!schwammStriche.size) return;
    ctx.setTransform(dpr * ansicht.s, 0, 0, dpr * ansicht.s, dpr * ansicht.tx, dpr * ansicht.ty);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const [id, weg] of schwammStriche) {
      const el = elemente.get(id);
      if (!el || el.art !== "strich") continue;
      const bx = versatz.get(tafelVon(el)) || 0, by = versatzY.get(tafelVon(el)) || 0;
      ctx.save();
      ctx.beginPath(); ctx.rect(bx, by, BOARD_B, BOARD_H); ctx.clip();
      ctx.strokeStyle = tinte(el.inhalt.farbe);
      ctx.lineWidth = el.inhalt.dicke;
      ctx.globalAlpha = 1;
      if (weg.size) strichStueckeZeichnen(ctx, el, bx, by, weg);
      else ctx.stroke(pfadVon(el));
      if (auswahl.has(id)) auswahlRahmen(ctx, el, bx, by, false);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function schwammBlitBeginnen() {
    // Steht noch eine Aenderung aus, ist das Bild auf der Leinwand alt —
    // dann erst einmal sauber zeichnen, sonst friert der alte Stand ein.
    if (tintenDirty) { tintenDirty = false; vollZeichnen(); }
    schwammBlit = true;
    schwammSchnappSichern();
  }

  function schwammBlitBeenden() {
    schwammBlit = false;
    schwammSchnappOk = false;
    schwammNachtragen.length = 0;
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
  const strichRinge = new Map();           // id -> Schimmer um eine fremde Aufgabe

  // "von Lukas" — die Herkunftsfahne. Bei Bloecken haengt sie IM Knoten
  // (folgt jedem Verschieben von selbst), bei Strichen als eigener Knoten
  // an der Bounding-Box oben links: Tinte lebt auf dem Canvas, dort gibt
  // es kein DOM, an das sie sich haengen koennte.
  function fahneFuellen(fahne, el) {
    fahne.textContent = "von " + vorname(el.besitzer);
    fahne.title = vorname(el.besitzer) + " hat das auf "
      + besitzform(vorname(tafelVon(el))) + " Tafel geschrieben";
  }

  // Fahne UND Schimmer eines Strichs auf den Stand bringen.
  //
  // Ein Block von fremder Hand traegt auf der eigenen Tafel einen zarten
  // Ring (.wb-fuermich::after) — ein Strich bekam bisher nur die graue
  // Fahne: dasselbe Signal in zwei Staerken, und die eigene Handschrift
  // war von einer hingeschriebenen Aufgabe kaum zu unterscheiden. Ein
  // harter Rahmen um die Bounding-Box waere auf der weissen Tafel aber ein
  // Fehlerkasten, kein Hinweis. Also ein weicher Schimmer HINTER der
  // Schrift (die Tinte liegt auf dem Canvas ueber der Buehne) plus die
  // blaue Fahne, die Bloecke schon haben.
  //
  // dx/dy: waehrend ein Strich gezogen wird, verschiebt sich nur die OPTIK
  // (ziehVersatz) — Fahne und Schimmer laufen live mit, statt bis zum
  // Loslassen an der alten Stelle stehen zu bleiben.
  function strichSchmuck(el, dx, dy) {
    const fremd = istFremdeHand(el);
    const fuerMich = fremd && tafelVon(el) === ich.id;
    const ebene = boardKnoten.get(tafelVon(el));
    const x = el.x + (dx || 0), y = el.y + (dy || 0);

    let fahne = strichFahnen.get(el.id);
    if (!fremd || !ebene) {
      if (fahne) { fahne.remove(); strichFahnen.delete(el.id); }
    } else {
      if (!fahne) {
        fahne = document.createElement("div");
        strichFahnen.set(el.id, fahne);
      }
      fahne.className = "wb-fahne wb-fahne-strich" + (fuerMich ? " wb-fuermich" : "");
      if (fahne.parentElement !== ebene.inhalt) ebene.inhalt.appendChild(fahne);
      fahne.style.left = x + "px";
      fahne.style.top = y + "px";
      fahneFuellen(fahne, el);
    }

    let ring = strichRinge.get(el.id);
    if (!fuerMich || !ebene) {
      if (ring) { ring.remove(); strichRinge.delete(el.id); }
      return;
    }
    if (!ring) {
      ring = document.createElement("div");
      ring.className = "wb-strichring";
      ring.setAttribute("aria-hidden", "true");
      strichRinge.set(el.id, ring);
    }
    // prepend, nicht append: der Schimmer liegt HINTER allem, was auf der
    // Tafel steht — sonst legte er sich als blauer Schleier ueber Notizen,
    // die zufaellig unter dem Strich haengen.
    if (ring.parentElement !== ebene.inhalt) ebene.inhalt.prepend(ring);
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    ring.style.width = el.breite + "px";
    ring.style.height = el.hoehe + "px";
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
      if (quelle === "poll" && inArbeit.has(el.id)) {
        // Finger drauf: nicht ersetzen. Aber was der Server NEU hat — meist
        // eine Aufgabe, die die CRM-Bruecke gerade angehaengt hat —, kommt
        // zusammengefuehrt herein: sonst liefe der naechste Tastendruck in
        // 409 "veraltet", und der Vollabgleich ersetzte den Block samt dem,
        // was hier gerade getippt wurde (Pruefung 05.09.2026).
        const lokal = elemente.get(el.id);
        if (lokal && lokal.art !== "strich" && el.art !== "strich"
            && Number(el.version) > Number(lokal.version)) blockZusammenfuehren(lokal, el);
        return;
      }
      const alt = elemente.get(el.id);
      // Der zuletzt vom Server gesehene Stand der Zeilen — die Basis fuers
      // Zusammenfuehren (was kannten wir schon, was ist wirklich neu?).
      if (el.inhalt && Array.isArray(el.inhalt.zeilen)) el.__serverSchluessel = zeilenSchluessel(el.inhalt.zeilen);
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
        strichSchmuck(el);
        tinteNeu();
      } else {
        blockRendern(el, alt);
      }
    } catch (fehler) {
      console.error("Whiteboard: Element uebersprungen:", el && el.id, fehler);
    }
  }

  // ----------------------------------------------------------------
  // Zusammenfuehren statt ersetzen (05.09.2026)
  //
  // Zwei Haende in einem Block: Louis tippt in seinem Kunden-Block, und die
  // CRM-Bruecke haengt im selben Augenblick eine neue Aufgabe an. Bisher
  // hielt der Client den fokussierten Block vom Poll fern, der naechste
  // Tastendruck lief in 409, der Vollabgleich holte den Serverstand und
  // ERSETZTE den Block — das Getippte war weg. Jetzt werden beide Staende
  // zusammengefuehrt:
  //   - die Zeilen des Servers gelten (Haken, Antworten, neue Aufgaben-Zeilen),
  //   - die Zeile, in der der Cursor steht, behaelt ihren lokalen Text,
  //   - lokal neu getippte Zeilen bleiben,
  //   - was der Server laut letztem bekannten Stand schon hatte und lokal
  //     fehlt, wurde hier geloescht und kommt nicht zurueck; was lokal steht
  //     und auf dem Server fehlt, obwohl er es kannte, wurde dort geloescht.
  // Zeilen finden sich ueber ihren Aufgaben-Bezug, sonst ueber den Text; die
  // Cursor-Zeile (ihr Text ist ja gerade in Bewegung) ueber ihre Stelle.
  const kopie = (x) => JSON.parse(JSON.stringify(x));
  const zeilenSchluesselVon = (z) =>
    (Number(z && z.aufgabe) > 0 ? "a" + Number(z.aufgabe) : "t" + String((z && z.t) || ""));
  const zeilenSchluessel = (zeilen) => new Set((zeilen || []).map(zeilenSchluesselVon));
  const konflikte = new Map();   // id -> 409er hintereinander

  // Ist der Text der Cursor-Zeile eine Fortschreibung des Servertextes?
  // (Gleicher Anfang zu mindestens 60 % des kuerzeren — Tippen am Ende,
  // Loeschen am Ende, ein Wort mittendrin.)
  const fortschreibung = (a, b) => {
    a = String(a || ""); b = String(b || "");
    if (!a || !b) return true;
    const kuerzer = Math.min(a.length, b.length);
    let i = 0;
    while (i < kuerzer && a[i] === b[i]) i++;
    return i >= Math.ceil(kuerzer * 0.6);
  };

  function zeilenZusammenfuehren(lokal, server, caretIdx, bekannt) {
    const basis = bekannt instanceof Set ? bekannt : new Set();
    const benutzt = new Set();
    const bezug = (z) => (Number(z && z.aufgabe) > 0 ? Number(z.aufgabe) : 0);
    const finde = (z, i) => {
      const b = bezug(z);
      for (let k = 0; k < server.length; k++) {
        if (benutzt.has(k)) continue;
        if (b ? bezug(server[k]) === b : (!bezug(server[k]) && server[k].t === z.t)) return k;
      }
      if (!b && i === caretIdx && i < server.length && !benutzt.has(i)
          && !bezug(server[i]) && fortschreibung(server[i].t, z.t)) return i;
      return -1;
    };
    const ergebnis = [];
    let naechster = 0, neue = 0, neueAufgaben = 0, caret = -1;
    // Server-Zeilen vor der Stelle k ausgeben, die lokal keinen Partner
    // haben: neu vom Server — es sei denn, wir kannten sie schon, dann sind
    // sie hier geloescht worden und bleiben weg.
    const serverBis = (k) => {
      for (; naechster < k; naechster++) {
        if (benutzt.has(naechster)) continue;
        benutzt.add(naechster);
        const s = server[naechster];
        if (basis.has(zeilenSchluesselVon(s))) continue;
        ergebnis.push(kopie(s)); neue++;
        if (bezug(s)) neueAufgaben++;
      }
    };
    lokal.forEach((z, i) => {
      const k = finde(z, i);
      if (k >= 0) {
        serverBis(k);
        benutzt.add(k);
        if (naechster <= k) naechster = k + 1;
        const s = kopie(server[k]);
        if (i === caretIdx) {
          s.t = z.t;
          if (z.striche) s.striche = kopie(z.striche); else delete s.striche;
          caret = ergebnis.length;
        }
        ergebnis.push(s);
        return;
      }
      // Lokal, aber nicht auf dem Server: neu getippt (bleibt) — oder dort
      // geloescht (kannten wir sie schon, faellt sie weg), ausser der Cursor
      // steht gerade darin.
      if (i !== caretIdx && basis.has(zeilenSchluesselVon(z))) return;
      if (i === caretIdx) caret = ergebnis.length;
      if (i === caretIdx || String(z.t || "").trim()) ergebnis.push(kopie(z));
    });
    serverBis(server.length);
    return {
      zeilen: ergebnis.length ? ergebnis : [{ t: "", erledigt: false, gestrichen: false }],
      caret, neue, neueAufgaben,
    };
  }

  // Den Serverstand eines Blocks in den lokalen einarbeiten — der Cursor
  // bleibt, wo er war (Zeile und Stelle), auch wenn davor Zeilen dazukamen.
  function blockZusammenfuehren(el, server) {
    const knoten = elementKnoten.get(el.id);
    const aktiv = document.activeElement;
    const zeileEl = knoten && aktiv && aktiv.closest && knoten.contains(aktiv) ? aktiv.closest(".wb-zeile") : null;
    const caretIdx = zeileEl ? zeilenIndex(zeileEl) : -1;
    const span = zeileEl ? $(".wb-zeile-text", zeileEl) : null;
    const offset = span ? caretOffset(span) : 0;
    const serverZeilen = (server.inhalt && Array.isArray(server.inhalt.zeilen)) ? server.inhalt.zeilen : [];
    const m = zeilenZusammenfuehren(el.inhalt.zeilen || [], serverZeilen, caretIdx, el.__serverSchluessel);
    el.inhalt.zeilen = m.zeilen;
    el.version = server.version;
    el.geaendert = server.geaendert || el.geaendert;
    el.__serverSchluessel = zeilenSchluessel(serverZeilen);
    if (knoten) {
      blockRendern(el);
      if (m.caret >= 0) {
        const neu = $$(".wb-zeile-text", knoten)[m.caret];
        if (neu) caretSetzen(neu, offset);
      }
    }
    return m;
  }

  // Den aktuellen Serverstand EINES Elements holen — ueber den Delta-Pfad
  // seiner Tafel, ohne den Poll-Stand anzufassen. "weg", wenn der Server es
  // als geloescht meldet; null, wenn nichts zu holen war.
  async function elementVomServer(el) {
    try {
      const antwort = await fetch("/api/whiteboard/elemente?tafel=" + encodeURIComponent(tafelVon(el))
        + "&seit=1970-01-01T00:00:00.000Z");
      if (antwort.status === 401) { sitzungAbgelaufen(); return null; }
      const daten = await antwort.json();
      if (daten.anmeldung) { sitzungAbgelaufen(); return null; }
      if (!daten.ok) return null;
      if ((daten.geloescht || []).includes(el.id)) return "weg";
      const s = (daten.elemente || []).find((e) => e.id === el.id);
      if (!s) return null;
      if (!s.tafel) s.tafel = s.besitzer;
      return s;
    } catch { return null; }
  }

  // Nur aus Zeichenliste bzw. DOM nehmen — ohne das Modell anzufassen.
  function elementAusBoardNehmen(el) {
    if (el.art === "strich") {
      const liste = stricheJeBoard.get(tafelVon(el));
      if (liste) { const i = liste.indexOf(el); if (i >= 0) liste.splice(i, 1); }
      const f = strichFahnen.get(el.id);
      if (f) { f.remove(); strichFahnen.delete(el.id); }
      const r = strichRinge.get(el.id);
      if (r) { r.remove(); strichRinge.delete(el.id); }
      tinteNeu();
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

    // ---- Die Ueberschrift IM Block (seit 01.09.2026).
    //
    // Frueher waren Ueberschrift und Liste zwei Elemente: man schrieb
    // "Kunden" in einen Block und die Aufgaben in den naechsten, und beim
    // Verschieben blieb regelmaessig eines von beiden liegen. Jetzt ist ein
    // Block mit Kategorie EINE Einheit — der Kopf wird GERENDERT, nicht
    // getippt. Er steht nicht im Datenmodell, sondern folgt aus
    // inhalt.kategorie: wer die Ueberschrift aendern will, aendert die
    // Kategorie. Darum ist er auch nicht editierbar (kein contenteditable)
    // und nicht markierbar — sonst tippte man in etwas hinein, das beim
    // naechsten Rendern wieder dasteht wie zuvor.
    //
    // Verschieben, Skalieren, Auswaehlen und Loeschen fassen ihn mit: er ist
    // ein Kind von .wb-el wie die Zeilen auch.
    const kat = kategorieVon(el.inhalt.kategorie);
    let kopf = $(".wb-blockkopf", knoten);
    if (!kat) {
      if (kopf) { kopf.remove(); kopf = null; }
    } else {
      if (!kopf) {
        kopf = document.createElement("div");
        kopf.className = "wb-blockkopf";
        // Kein Fokus, keine Textauswahl, kein Caret: der Kopf ist Anzeige.
        kopf.setAttribute("contenteditable", "false");
        const nr = document.createElement("span");
        nr.className = "wb-kopf-rang";
        const punkt = document.createElement("span");
        punkt.className = "wb-kopf-punkt";
        punkt.textContent = " · ";
        const wort = document.createElement("span");
        wort.className = "wb-kopf-wort";
        kopf.append(nr, punkt, wort);
        knoten.insertBefore(kopf, zeilenEl);
      }
      const rang = KATEGORIEN.indexOf(kat) + 1;
      $(".wb-kopf-rang", kopf).textContent = String(rang);
      $(".wb-kopf-wort", kopf).textContent = kat.lang;
      kopf.dataset.kategorie = kat.wert;
      kopf.style.setProperty("--kf", tinte(kat.farbe));
      kopf.style.setProperty("--kopf", kat.kopf);
      kopf.title = kategorieTitel(kat) + " — Rang " + rang + " von " + KATEGORIEN.length + ". "
        + "Die Überschrift kommt aus der Einordnung; ändern über den Werkzeugkasten.";
    }

    // Oben links am Block: erst das Kategorie-Schild, dahinter die
    // Herkunftsfahne "von X". Beides kann gleichzeitig auftreten, und beides
    // haengt an derselben Ecke — also stehen sie in EINER Reihe
    // (.wb-marken), sonst laegen sie uebereinander. Die Reihe traegt die
    // Gegen-Skalierung, die vorher an der Fahne hing: so bleiben beide bei
    // jedem Zoom gleich gross und gleich weit voneinander entfernt.
    //
    // Das Schild bleibt fuer die Bloecke, die NICHT der Kategorie-Block
    // sind (eine Haftnotiz mit Kategorie, eine hingeschriebene Aufgabe neben
    // dem Block des Gastgebers): sie gehoeren zur Gruppe, tragen aber nicht
    // deren Ueberschrift. Welcher Block der Kopf ist, entscheidet
    // kennzeichenPruefen ueber die Klasse .wb-kopfblock — das CSS zeigt
    // dann genau eines von beiden.
    const zeigtSchild = !!kat;
    const fremd = istFremdeHand(el);
    let marken = $(".wb-marken", knoten);
    if (!zeigtSchild && !fremd) {
      if (marken) marken.remove();
    } else {
      if (!marken) {
        marken = document.createElement("div");
        marken.className = "wb-marken";
        knoten.appendChild(marken);
      }
      let schild = $(".wb-kat", marken);
      if (zeigtSchild) {
        if (!schild) {
          schild = document.createElement("div");
          schild.className = "wb-kat";
          marken.prepend(schild);       // das Schild steht vorn, "von X" dahinter
        }
        schild.dataset.kategorie = kat.wert;
        schild.style.setProperty("--kf", tinte(kat.farbe));
        schild.textContent = kat.kurz;
        schild.title = kat.lang + " — Rang " + (KATEGORIEN.indexOf(kat) + 1)
          + " von " + KATEGORIEN.length;
      } else if (schild) schild.remove();

      let fahne = $(".wb-fahne", marken);
      if (fremd) {
        if (!fahne) {
          fahne = document.createElement("div");
          fahne.className = "wb-fahne";
          marken.appendChild(fahne);
        }
        fahneFuellen(fahne, el);
      } else if (fahne) fahne.remove();
    }

    // Zeilen abgleichen: vorhandene Knoten wiederverwenden, damit Fokus
    // und Caret bei jedem Rendern ueberleben wuerden (der Poll meidet
    // fokussierte Bloecke ohnehin, aber Vorsicht kostet hier nichts).
    const zeilen = el.inhalt.zeilen;
    // Ueber der ersten Zeile steht nichts, wozu sie gehoeren koennte — ein
    // Unterpunkt an der Spitze (nach dem Loeschen oder Wegziehen seiner
    // Aufgabe) wird wieder eine eigene Zeile.
    if (zeilen[0] && zeilen[0].ebene) delete zeilen[0].ebene;
    const daKnoten = Array.from(zeilenEl.children);
    for (let i = 0; i < zeilen.length; i++) {
      let z = daKnoten[i];
      if (!z) { z = zeileBauen(darf); zeilenEl.appendChild(z); }
      zeileFuellen(z, zeilen[i], darf);
    }
    for (let i = daKnoten.length - 1; i >= zeilen.length; i--) daKnoten[i].remove();

    leerMarkieren(el, knoten);
    scrollMarkieren(el, zeilenEl);
    // Haengt der Fokus-Chip an einer Zeile DIESES Blocks, muss er mit: aus
    // "Antworten" wird "Antwort", sobald eine steht, und das Zeilenende ist
    // nach einem Rendern woanders. Ohne das blieb der Chip nach dem Setzen
    // einer Antwort auf der alten Beschriftung stehen — focusin feuert nicht
    // noch einmal, wenn die Zeile den Fokus ohnehin schon hat (gemessen am
    // 31.08.: Zeile trug die Antwort, der Chip sagte weiter "Antworten").
    chipAuffrischen(knoten);
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

  // =================================================================
  // Teilstriche — EIN Stueck einer Zeile durchstreichen
  // =================================================================
  //
  // "Matten beantworten und Anpassung umsetzen" ist zwei Dinge: geantwortet
  // ist schon, die Anpassung steht noch aus (Originalton 31.08.2026). Darum
  // darf nicht nur die GANZE Zeile durchgestrichen werden, sondern auch ein
  // Stueck davon.
  //
  // Gespeichert wird das als ZEICHENBEREICHE im Zeilentext:
  // zeilen[].striche = [[von, bis], …], halb offen — t.slice(von,bis) ist das
  // Gestrichene. Dasselbe Format nimmt der Server an (siehe pruefeElement in
  // lib/whiteboard-routes.js), und er raeumt es genauso auf, wie es hier
  // aufgeraeumt wird: sortiert, verschmolzen, im Text liegend. Der Client
  // MUSS das selbst tun — sonst saehe die Zeile nach dem naechsten Laden
  // anders aus als in dem Moment, in dem man geklickt hat.
  //
  // Zwei Schalter, nicht einer: `gestrichen` (die GANZE Zeile, Knopf in den
  // Zeilenwerkzeugen) bleibt genau, wie er war, und schlaegt die Teilstriche
  // optisch. Deckt ein Teilstrich die ganze Zeile ab, wird daraus `gestrichen`
  // — dann sind beide Wege am selben Ziel und die Anzeige wechselt nach einem
  // Neuladen nicht ihr Aussehen.

  const TEILSTRICH_MAX = 20;   // derselbe Deckel wie GRENZEN.striche im Server

  // Sortieren, klemmen, Leere wegwerfen, Ueberlappende UND Angrenzende
  // verschmelzen. Angrenzende auch: sonst waechst die Liste bei jedem
  // Streichen weiter, ohne dass man am Bild etwas davon saehe.
  function stricheNormalisieren(roh, laenge) {
    if (!Array.isArray(roh) || !roh.length || laenge <= 0) return [];
    const sauber = [];
    for (const paar of roh) {
      if (!Array.isArray(paar) || paar.length !== 2) continue;
      const von = klemm(Math.round(Number(paar[0])), 0, laenge);
      const bis = klemm(Math.round(Number(paar[1])), 0, laenge);
      if (!Number.isFinite(von) || !Number.isFinite(bis) || bis <= von) continue;
      sauber.push([von, bis]);
    }
    sauber.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const raus = [];
    for (const [von, bis] of sauber) {
      const letzter = raus[raus.length - 1];
      if (letzter && von <= letzter[1]) letzter[1] = Math.max(letzter[1], bis);
      else raus.push([von, bis]);
    }
    // Ueber dem Deckel: der Server SCHNEIDET ab (striche.slice(0,20)) — dabei
    // fielen die hinteren Bereiche ersatzlos weg. Hier werden stattdessen die
    // engsten Nachbarn zusammengefasst, bis 20 uebrig sind. Das streicht dann
    // etwas mehr als gewollt, aber es verschwindet nichts stillschweigend.
    while (raus.length > TEILSTRICH_MAX) {
      let stelle = 0, engste = Infinity;
      for (let i = 0; i < raus.length - 1; i++) {
        const luecke = raus[i + 1][0] - raus[i][1];
        if (luecke < engste) { engste = luecke; stelle = i; }
      }
      raus[stelle][1] = raus[stelle + 1][1];
      raus.splice(stelle + 1, 1);
    }
    return raus;
  }

  const stricheGleich = (a, b) => a.length === b.length
    && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

  // Die Teilstriche EINER Zeile, sauber. `gestrichen` bleibt hier bewusst
  // aussen vor — das ist der andere Schalter.
  const teilstriche = (zeile) => stricheNormalisieren(zeile && zeile.striche,
    zeile ? String(zeile.t || "").length : 0);

  // Alles, was an dieser Zeile gestrichen IST — die ganze Zeile zaehlt dabei
  // als ein Bereich ueber den ganzen Text. Nur der Knopf in der Markier-Leiste
  // rechnet so: fuer ihn gibt es nur "gestrichen" und "nicht gestrichen", und
  // wer bei einer ganz gestrichenen Zeile ein Wort freistellt, bekommt genau
  // das. (Etwaige Bereiche, die unter dem Ganz-Strich schlummerten, gehen
  // dabei verloren — sichtbar war ohnehin nur der Ganz-Strich, und ein
  // Ergebnis, das man nicht gesehen hat, waere eine Ueberraschung.)
  const stricheMitGanz = (zeile) => (zeile && zeile.gestrichen && String(zeile.t || "").length
    ? [[0, String(zeile.t).length]] : teilstriche(zeile));

  // Bereiche an einer Zeile ablegen. Deckt ein Bereich den GANZEN Text, wird
  // daraus das bestehende `gestrichen` — genau wie es der Server tut.
  // `gestrichen` wird hier nie auf false gesetzt: wer den Ganz-Strich loesen
  // will, tut das ausdruecklich (Zeilenwerkzeug oder Markier-Leiste).
  function stricheAblegen(zeile, roh) {
    const laenge = String(zeile.t || "").length;
    const s = stricheNormalisieren(roh, laenge);
    if (s.length === 1 && s[0][0] === 0 && s[0][1] === laenge && laenge > 0) {
      zeile.gestrichen = true;
      delete zeile.striche;
      return;
    }
    if (s.length) zeile.striche = s; else delete zeile.striche;
  }

  const stricheDecken = (striche, von, bis) =>
    bis > von && striche.some(([a, b]) => a <= von && b >= bis);

  // [von,bis) aus allen Bereichen herausschneiden — das ist "Strich weg".
  function stricheAbziehen(striche, von, bis) {
    const raus = [];
    for (const [a, b] of striche) {
      if (a < von) raus.push([a, Math.min(b, von)]);
      if (b > bis) raus.push([Math.max(a, bis), b]);
    }
    return raus;
  }

  // Das Stueck [von,bis) des Textes herausschneiden und die Bereiche darin auf
  // 0 zurueckrechnen — gebraucht, wenn Enter eine Zeile teilt.
  function stricheSchneiden(striche, von, bis) {
    const raus = [];
    for (const [a, b] of striche) {
      const s = Math.max(a, von), e = Math.min(b, bis);
      if (e > s) raus.push([s - von, e - von]);
    }
    return raus;
  }

  // Bereiche durch EINE Textaenderung schieben: an Stelle `pos` fallen `weg`
  // Zeichen heraus und `dazu` kommen hinein.
  //
  // DIE ENTSCHEIDUNG AN DER KANTE: Tippen am ENDE eines Strichs setzt ihn
  // NICHT fort (`nb > pos`, nicht `>=`), und Tippen am ANFANG faellt ebenfalls
  // davor (`na >= pos`). Begruendung: ein Strich ist eine Aussage ueber
  // bestimmte WORTE ("beantworten ist erledigt"). Wer hinter dieses Wort
  // weiterschreibt, schreibt etwas Neues — und Neues ist nie schon erledigt.
  // Der Browser macht es von sich aus umgekehrt (er setzt Auszeichnungen am
  // Ende fort, wie bei fett); genau deshalb wird nach jeder Eingabe
  // nachgezogen statt sich auf ihn zu verlassen.
  function stricheVerschieben(striche, pos, weg, dazu) {
    const nachLoeschen = (x) => (x <= pos ? x : x >= pos + weg ? x - weg : pos);
    const raus = [];
    for (const [a, b] of striche) {
      const na = nachLoeschen(a), nb = nachLoeschen(b);
      const va = na >= pos ? na + dazu : na;
      const vb = nb > pos ? nb + dazu : nb;
      if (vb > va) raus.push([va, vb]);
    }
    return raus;
  }

  // Aus altem und neuem Zeilentext die eine geaenderte Stelle bestimmen und
  // die Bereiche hindurchschieben. Gemeinsamen Anfang und gemeinsames Ende
  // abziehen — was dazwischen bleibt, IST die Aenderung. Eine Eingabe ist
  // immer genau eine zusammenhaengende Stelle; mehr muss diese Rechnung nicht
  // koennen.
  function stricheDurchEdit(striche, alt, neu) {
    if (alt === neu) return striche.map((p) => p.slice());
    const kurz = Math.min(alt.length, neu.length);
    let vorn = 0;
    while (vorn < kurz && alt[vorn] === neu[vorn]) vorn++;
    let hinten = 0;
    while (hinten < kurz - vorn && alt[alt.length - 1 - hinten] === neu[neu.length - 1 - hinten]) hinten++;
    return stricheVerschieben(striche, vorn, alt.length - vorn - hinten, neu.length - vorn - hinten);
  }

  // DER SPRINGENDE PUNKT: die Bereiche aus dem DOM ABLESEN, statt gemerkte
  // Zahlen mitzuschleppen. Die Zeile ist ein contenteditable — tippt jemand
  // mitten hinein, stimmen gemerkte Zahlen nicht mehr, die KNOTEN aber schon:
  // das gestrichene Stueck ist ein eigenes Element und waechst und schrumpft
  // mit dem, was darin steht. Gezaehlt wird ueber dieselben Textknoten wie in
  // caretOffset, damit beide Rechnungen dieselbe Vorstellung von "Zeichen im
  // Zeilentext" haben.
  function stricheAusDom(span) {
    const raus = [];
    let pos = 0;
    const lauf = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let knoten;
    while ((knoten = lauf.nextNode())) {
      const laenge = knoten.textContent.length;
      const eltern = knoten.parentElement;
      const strich = eltern && eltern.closest(".wb-teilstrich");
      if (laenge && strich && span.contains(strich)) {
        const letzter = raus[raus.length - 1];
        if (letzter && letzter[1] === pos) letzter[1] = pos + laenge;
        else raus.push([pos, pos + laenge]);
      }
      pos += laenge;
    }
    return raus;
  }

  // Steht das Caret wirklich in DIESEM Span? caretOffset liefert sonst 0 —
  // und der Caret spraenge beim Neuaufbau an den Zeilenanfang.
  function caretHier(span) {
    if (document.activeElement !== span) return false;
    const sel = window.getSelection();
    return !!(sel && sel.rangeCount && span.contains(sel.getRangeAt(0).startContainer));
  }

  // Den Zeilentext in den Span schreiben — mit den gestrichenen Stuecken als
  // eigene Elemente. Ohne Teilstriche bleibt es bei EINEM Textknoten: das ist
  // der haeufige Fall, und er soll nichts kosten.
  //
  // Steht schon genau das da, wird nichts angefasst (der alte Waechter aus
  // zeileFuellen, nur um die Bereiche erweitert) — sonst risse jedes Rendern
  // die Textknoten weg, an denen Caret und Auswahl haengen.
  function zeilenTextSetzen(span, text, striche) {
    const daStriche = stricheAusDom(span);
    if (span.textContent === text && stricheGleich(daStriche, striche)) {
      span.__strichStand = { text, striche };
      return;
    }
    // Caret-Rettung, Muster aus blockRendern: Offset merken, neu bauen,
    // Offset wieder setzen.
    const retten = caretHier(span);
    const pos = retten ? caretOffset(span) : -1;
    if (!striche.length) {
      span.textContent = text;
    } else {
      const stueck = document.createDocumentFragment();
      let ab = 0;
      for (const [von, bis] of striche) {
        if (von > ab) stueck.appendChild(document.createTextNode(text.slice(ab, von)));
        const s = document.createElement("span");
        s.className = "wb-teilstrich";
        s.textContent = text.slice(von, bis);
        stueck.appendChild(s);
        ab = bis;
      }
      if (ab < text.length) stueck.appendChild(document.createTextNode(text.slice(ab)));
      span.textContent = "";
      span.appendChild(stueck);
    }
    span.__strichStand = { text, striche };
    if (retten) caretSetzen(span, pos);
  }

  // Nach einer Eingabe die Bereiche geradeziehen. Was der Browser aus den
  // Strich-Elementen gemacht hat, wird mit dem verglichen, was aus dem
  // gemerkten Vorzustand FOLGEN muesste (siehe stricheDurchEdit) — und nur
  // wenn beides auseinandergeht, wird die Zeile neu gebaut. So kostet Tippen
  // fern vom Strich gar nichts, und an der Kante gilt unsere Regel statt der
  // des Browsers.
  function teilstricheNachfuehren(span) {
    const stand = span.__strichStand;
    const text = span.textContent;
    const daStriche = stricheAusDom(span);
    if (!stand || (!stand.striche.length && !daStriche.length)) {
      span.__strichStand = { text, striche: daStriche };
      return;
    }
    const soll = stricheNormalisieren(stricheDurchEdit(stand.striche, stand.text, text), text.length);
    if (stricheGleich(soll, daStriche)) span.__strichStand = { text, striche: daStriche };
    else zeilenTextSetzen(span, text, soll);
  }

  function zeileBauen(eigen) {
    const z = document.createElement("div");
    z.className = "wb-zeile";
    // Der Griff zum ABGEBEN — ganz aussen links, vor dem Kaestchen, in
    // derselben Randspalte. Er steht als ERSTES Kind, damit die Reihenfolge
    // im DOM der auf dem Schirm entspricht (Tastatur und Vorlesen lesen ihn
    // nicht: er ist ein Zeigerwerkzeug und traegt darum aria-hidden).
    if (eigen) {
      const griff = document.createElement("span");
      griff.className = "wb-zeile-griff";
      griff.setAttribute("aria-hidden", "true");
      griff.title = "Ziehen: Zeile verschieben — in diesem Block, in einen anderen oder auf eine andere Tafel";
      griff.innerHTML = ICON.griff;
      z.appendChild(griff);
      zeileGriffAnbinden(griff);
    }
    const ab = document.createElement("button");
    ab.type = "button"; ab.className = "wb-abhaken"; ab.tabIndex = -1;
    ab.setAttribute("aria-label", "Abhaken");
    // DREI Zustaende in EINEM Kaestchen — das ist das wichtigste optische
    // Merkmal der ganzen Antwort-Funktion: beim Ueberfliegen einer Liste
    // muss man ohne Nachdenken sehen, wo man anfangen kann.
    //   leer            = offen, kann ich anfangen
    //   Bernstein-Pause = offen, aber blockiert (eine Antwort steht)
    //   gruener Haken   = erledigt
    // Das Warte-Zeichen sind ZWEI BALKEN (Pause), nicht Sanduhr oder Uhr:
    // auf ~20 px Bildschirmkante ist das die einzige Form, die noch als
    // Form liest — eine Sanduhr wird dort zu einem Fleck. Die Flaeche
    // darunter (wb-warte-feld) traegt den Kontrast: so haengt die
    // Lesbarkeit nicht an der Tafelfarbe unter dem Kaestchen.
    ab.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect class="wb-warte-feld" x="3.3" y="3.3" width="13.4" height="13.4" rx="3.6"/>'
      + '<rect class="wb-kasten-rand" x="2.5" y="2.5" width="15" height="15" rx="4.5" stroke-width="1.6"/>'
      + '<path class="wb-warte-symbol" d="M8.1 6.7v6.6M11.9 6.7v6.6"/>'
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
      // Reihenfolge: erst was der Zeile etwas HINZUFUEGT (Antwort, Link),
      // dann die Form (durchstreichen), zuletzt das Zerstoerende (Papierkorb).
      // Der Papierkorb bleibt damit der aeusserste Knopf — die Stelle, an der
      // er seit jeher sitzt und an der man ihn am wenigsten aus Versehen
      // trifft. Der Titel steht als title-Attribut da und nicht als data-tip:
      // [data-tip]::after wuerde das ::after des Knopfes ueberschreiben, und
      // das ist hier seine unsichtbare Trefferflaeche (siehe whiteboard.css).
      const antwort = document.createElement("button");
      antwort.type = "button"; antwort.className = "wb-zeile-antwort"; antwort.tabIndex = -1;
      antwort.setAttribute("aria-label", "Antworten");
      antwort.title = "Antwort hinterlegen — die Zeile wird dann ruhig gestellt";
      antwort.innerHTML = ICON.antwort;
      const kette = document.createElement("button");
      kette.type = "button"; kette.className = "wb-zeile-kette"; kette.tabIndex = -1;
      kette.setAttribute("aria-label", "Verknüpfen");
      kette.title = "Link anhängen";
      kette.innerHTML = ICON.kette;
      // Unterpunkt (17.09.2026): die Zeile rueckt UNTER die Aufgabe darueber —
      // als Stichpunkt mit kleinem Kreis, nicht als eigene Aufgabe. Derselbe
      // Knopf rueckt sie wieder aus; die Tastatur kann es mit Tab / Umschalt+Tab.
      const einr = document.createElement("button");
      einr.type = "button"; einr.className = "wb-zeile-einruecken"; einr.tabIndex = -1;
      einr.setAttribute("aria-label", "Als Unterpunkt einrücken");
      einr.innerHTML = ICON.einruecken;
      const streich = document.createElement("button");
      streich.type = "button"; streich.className = "wb-zeile-streichen"; streich.tabIndex = -1;
      streich.setAttribute("aria-label", "Durchstreichen");
      streich.title = "Zeile durchstreichen";
      streich.innerHTML = ICON.strich;
      const weg = document.createElement("button");
      weg.type = "button"; weg.className = "wb-zeile-weg"; weg.tabIndex = -1;
      weg.setAttribute("aria-label", "Zeile löschen");
      // Der Titel sagt ausdruecklich DIESE ZEILE: der Papierkorb im Kasten
      // darueber loescht den ganzen Block, und die beiden wurden verwechselt.
      weg.title = "Nur diese Zeile löschen";
      weg.innerHTML = ICON.weg;
      tools.append(antwort, kette, einr, streich, weg);
      z.appendChild(tools);
    }
    return z;
  }

  function zeileFuellen(z, daten, eigen) {
    const t = $(".wb-zeile-text", z);
    // Der Text UND die gestrichenen Stuecke in einem Zug: die Teilstriche sind
    // Teil des Zeilenaufbaus, nicht eine Verzierung darueber (siehe
    // zeilenTextSetzen). Sie werden auch dann in den DOM gebaut, wenn die
    // GANZE Zeile gestrichen ist — sichtbar ist dann nur der Ganz-Strich (CSS),
    // aber die Bereiche ueberleben so das Zurueckschreiben aus dem DOM.
    zeilenTextSetzen(t, daten.t, teilstriche(daten));
    const antwort = String(daten.antwort || "").trim();
    z.classList.toggle("wb-erledigt", !!daten.erledigt);
    z.classList.toggle("wb-gestrichen", !!daten.gestrichen && !daten.erledigt);
    // Rangfolge der Zustaende: erledigt schlaegt gestrichen schlaegt wartend.
    // Der Grund ist jedes Mal derselbe — der spaetere Zustand hat den
    // frueheren aufgehoben: Abgehakt ist abgehakt, da wartet niemand mehr;
    // und was durchgestrichen ist, ist vom Tisch, dann ist die Antwort nur
    // noch eine Notiz dazu. Die Antwort BLEIBT in allen drei Faellen sichtbar
    // (wb-hat-antwort) — sie ist der Grund, warum die Zeile so aussieht, wie
    // sie aussieht, und den darf man nicht wegnehmen. Ruhig gestellt
    // (wb-wartet: blasse Zeile + Bernstein-Pause im Kaestchen) wird nur die
    // Zeile, auf die man wirklich gerade wartet.
    z.classList.toggle("wb-hat-antwort", !!antwort);
    // Unterpunkt: ebene 1. Haengt wie Antwort und Aufgaben-Bezug AM KNOTEN,
    // damit das mobile Blatt ihn beim Zurueckschreiben wiederfindet.
    const unter = daten.ebene === 1;
    z.classList.toggle("wb-unterpunkt", unter);
    if (unter) z.dataset.ebene = "1"; else delete z.dataset.ebene;
    const einr = $(".wb-zeile-einruecken", z);
    if (einr) {
      einr.title = unter ? "Wieder ausrücken — eigene Aufgabe (Umschalt+Tab)"
                         : "Als Unterpunkt einrücken — gehört dann zur Zeile darüber (Tab)";
      einr.setAttribute("aria-label", unter ? "Ausrücken" : "Als Unterpunkt einrücken");
    }
    const wartet = !!antwort && !daten.erledigt && !daten.gestrichen;
    z.classList.toggle("wb-wartet", wartet);
    // Das mobile Blatt liest seinen Stand aus dem DOM zurueck (siehe
    // mobilUebernehmen) — wie Haken, Streichung und Link muss die Antwort
    // deshalb AM KNOTEN haengen, sonst faellt sie beim "Fertig" heraus.
    if (antwort) z.dataset.antwort = antwort; else delete z.dataset.antwort;
    antwortAnzeigen(z, antwort);
    // Der Haken steht, wo er hingehoert — ohne Animation, die gibt es nur
    // beim Klick selbst (hakenZiehen).
    const haken = $(".wb-haken", z);
    if (haken) haken.style.strokeDashoffset = daten.erledigt ? "0" : "1";
    // Warum title und nicht data-tip: siehe zeileBauen — das ::after des
    // Kaestchens ist seine Trefferflaeche und darf nicht ueberschrieben
    // werden. Der Satz erklaert das gelbe Zeichen dem, der es zum ersten
    // Mal sieht, und sagt zugleich, dass Abhaken weiterhin geht.
    const ab = $(".wb-abhaken", z);
    if (ab) {
      if (wartet) ab.title = "Wartet: " + antwort + " — Klick hakt trotzdem ab";
      else ab.removeAttribute("title");
    }
    // Zeile aus dem CRM (05.09.2026): "aufgabe" ist die aufgaben.id. Sie
    // haengt wie die Antwort AM KNOTEN, damit das mobile Blatt sie beim
    // Zurueckschreiben wiederfindet — und der Text sagt beim Ueberfahren,
    // woher die Zeile kommt und dass der Haken in der Liste mitlaeuft.
    if (daten.aufgabe) {
      z.dataset.aufgabe = String(daten.aufgabe);
      z.classList.add("wb-aufgabe");
      t.title = "Aufgabe aus dem CRM — der Haken gilt auch in der Aufgabenliste; die Kette öffnet die Kundenakte.";
    } else {
      delete z.dataset.aufgabe;
      z.classList.remove("wb-aufgabe");
      t.removeAttribute("title");
    }
    linkAnkerSetzen(z, daten.link);
  }

  // Die Antwort steht als eigene, eingerueckte Zeile UNTER der Aufgabe —
  // nicht dahinter: sie ist ein zweiter Gedanke ("worauf warte ich"), kein
  // Zusatz zum Aufgabentext. Der Knoten wird nur angelegt, wenn es etwas zu
  // zeigen gibt, und beim Loeschen der Antwort restlos entfernt — dann steht
  // die Zeile SOFORT wieder normal da, ohne Rest und ohne Luecke.
  function antwortAnzeigen(z, text) {
    let a = $(".wb-antwort", z);
    if (!text) { if (a) a.remove(); return; }
    if (!a) {
      a = document.createElement("div");
      a.className = "wb-antwort";
      a.innerHTML = '<i class="wb-antwort-pfeil">' + ICON.antwortPfeil + "</i>"
        + '<span class="wb-antwort-text"></span>';
      // Ans Ende der Zeile: die Zeilenwerkzeuge liegen absolut, also ist die
      // Antwort das letzte Kind IM FLUSS und faellt mit flex-wrap von selbst
      // in die zweite Reihe.
      z.appendChild(a);
    }
    const s = $(".wb-antwort-text", a);
    if (s.textContent !== text) s.textContent = text;
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
      // Link und Antwort sind Metadaten wie erledigt/gestrichen: sie stehen
      // nicht im DOM-Text und duerfen beim Zurueckschreiben nicht verloren
      // gehen — sonst loeschte jeder Tastendruck die Antwort der Zeile.
      if (alt.link) zeile.link = alt.link;
      if (alt.antwort) zeile.antwort = alt.antwort;
      // Ebenso der Aufgaben-Bezug (05.09.2026): "aufgabe" ist die aufgaben.id
      // der CRM-Aufgabe, aus der die Zeile stammt — ohne ihn liefe der Haken
      // nicht mehr in die Aufgabenliste.
      if (alt.aufgabe) zeile.aufgabe = alt.aufgabe;
      // Und die Einrueckung (Unterpunkt) — reine Metadaten wie der Haken. Die
      // erste Zeile eines Blocks kann kein Unterpunkt sein: ueber ihr steht
      // nichts, wozu sie gehoeren koennte.
      if (alt.ebene === 1 && i > 0) zeile.ebene = 1;
      // Die TEILSTRICHE dagegen kommen sehr wohl aus dem DOM: sie sind keine
      // reinen Metadaten, sondern haengen an bestimmten ZEICHEN. Wer ein Wort
      // davor einfuegt, verschiebt sie — gemerkte Zahlen wanderten dann ueber
      // den Text, die Knoten wandern mit ihm (siehe stricheAusDom).
      stricheAblegen(zeile, stricheAusDom(spans[i]));
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
      const hoeheVorher = el.hoehe || 0;
      // Nur Textbloecke wachsen mit dem Text. Die Hoehe einer Haftnotiz ist
      // gewaehlt (aufgezogen oder skaliert) \u2014 sie hier nachzumessen wuerde
      // die Wahl bei jedem Tastendruck ueberschreiben.
      if (el.art !== "notiz") el.hoehe = Math.round(knoten.offsetHeight);
      // Nach unten aus der Tafel WACHSEN kann keiner. Das Ziehen klemmt seit
      // je an der Kante (blockZiehen), das Wachsen tat es nicht: ein Block
      // unten an der Tafel schob seine neuen Zeilen ueber den Rahmen hinaus,
      // wo sie niemand mehr liest. Er rueckt jetzt hoch statt hinaus.
      const maxY = Math.max(0, BOARD_H - (el.hoehe || 0));
      if (el.y > maxY) { el.y = Math.round(maxY); knoten.style.top = el.y + "px"; }
      // Und was jetzt unter ihm im Weg liegt, weicht aus.
      if ((el.hoehe || 0) > hoeheVorher) untenPlatzMachen(el);
    }
    aenderungEinreihen(el, sofort);
    schilderAuffrischen();
  }

  // ------------------------------------------- Aktive und warme Zeile
  //
  // Welche Zeile zeigt ihre Werkzeuge (Antwort, Link, Einruecken, Streichen,
  // Papierkorb) und den Rahmen? Bis 17.09.2026 entschied das allein :hover —
  // und genau daran scheiterte es: Auf dem Weg von der Zeile zu den Knoepfen
  // verlaesst der Zeiger die Zeile (er streift den Groessen-Anfasser, die
  // Nachbarzeile, die Luecke), :hover reisst ab, die Knoepfe verschwinden,
  // bevor man sie trifft. Lukas: "Man kann auf die Symbole gar nicht klicken."
  //
  // Jetzt zwei Zustaende, beide als Klasse an der Zeile:
  //   AKTIV  die Zeile mit dem Caret. Ihre Werkzeuge stehen fest, solange man
  //          in ihr ist — "reinklicken, dann kommen rechts die Symbole".
  //   WARM   die ueberfahrene Zeile, wenn in ihrem Block gerade niemand
  //          schreibt. Sie bleibt nach dem Verlassen noch kurz warm
  //          (WARM_NACHLAUF_MS), und eine ANDERE Zeile uebernimmt erst nach
  //          WARM_WECHSEL_MS — wer schraeg zu den Knoepfen faehrt, streift die
  //          Nachbarzeile, und die Knoepfe sollen ihm dabei nicht wegspringen.
  let aktiveZeile = null, warmeZeile = null, warmTimer = 0;
  const WARM_NACHLAUF_MS = 700, WARM_WECHSEL_MS = 140;
  function zeileWarmSetzen(z) {
    clearTimeout(warmTimer); warmTimer = 0;
    const neu = z && z.isConnected ? z : null;
    if (warmeZeile === neu) return;
    if (warmeZeile) warmeZeile.classList.remove("wb-zeile-warm");
    warmeZeile = neu;
    if (neu) neu.classList.add("wb-zeile-warm");
  }
  function zeileAktivSetzen(z) {
    const neu = z && z.isConnected ? z : null;
    if (aktiveZeile !== neu) {
      if (aktiveZeile) aktiveZeile.classList.remove("wb-zeile-aktiv");
      aktiveZeile = neu;
      if (neu) neu.classList.add("wb-zeile-aktiv");
    }
    // Wer schreibt, braucht keine zweite, nur ueberfahrene Zeile mit Knoepfen.
    if (neu) zeileWarmSetzen(null);
  }
  function zeileUeberfahren(zeile) {
    if (zeile === warmeZeile) { clearTimeout(warmTimer); warmTimer = 0; return; }
    if (!warmeZeile) { zeileWarmSetzen(zeile); return; }
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => zeileWarmSetzen(zeile), zeile ? WARM_WECHSEL_MS : WARM_NACHLAUF_MS);
  }
  // Wie viele Unterpunkte haengen direkt unter dieser Hauptzeile? (0 bei
  // einem Unterpunkt selbst.) Loeschen und Ziehen nehmen sie mit — sie sind
  // die Gliederung DIESER Aufgabe und unter einer anderen sinnlos.
  function zeileFamilie(zeilen, idx) {
    if (!zeilen[idx] || zeilen[idx].ebene === 1) return 0;
    let n = 0;
    for (let i = idx + 1; i < zeilen.length && zeilen[i].ebene === 1; i++) n++;
    return n;
  }

  function blockInteraktionAnbinden(knoten) {
    // ---- Fokus rein/raus: inArbeit schuetzt vor dem Poll; leerer Block
    // verschwindet beim Verlassen (eine leere Notiz ist Muell am Board).
    knoten.addEventListener("focusin", (ev) => {
      const el = elVonKnoten(knoten);
      if (!el) return;
      inArbeit.add(el.id);
      knoten.classList.add("wb-fokus");
      kastenAusrichten(knoten);
      // Der Chip zieht mit dem Cursor um: er gehoert immer zu der Zeile,
      // in der gerade geschrieben wird.
      chipAnZeile(ev.target.closest && ev.target.closest(".wb-zeile"));
      // ... und mit ihm Rahmen und Werkzeuge (siehe zeileAktivSetzen).
      zeileAktivSetzen(ev.target.closest && ev.target.closest(".wb-zeile"));
    });
    // ---- Ueberfahren: die warme Zeile. Nur mit Maus/Stift — ein Finger
    // "ueberfaehrt" nichts, dort entscheidet das Antippen (= aktiv).
    knoten.addEventListener("pointerover", (ev) => {
      if (ev.pointerType === "touch" || abgabe) return;
      // Schreibt jemand in diesem Block, gehoeren die Werkzeuge der aktiven
      // Zeile allein: zwei Knopfreihen auf zwei Hoehen waeren ein Ratespiel.
      if (aktiveZeile && knoten.contains(aktiveZeile)) { zeileWarmSetzen(null); return; }
      const zeile = ev.target.closest && ev.target.closest(".wb-zeile");
      zeileUeberfahren(zeile && knoten.contains(zeile) ? zeile : null);
    });
    knoten.addEventListener("pointerleave", () => { if (warmeZeile && knoten.contains(warmeZeile)) zeileUeberfahren(null); });
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
      chipWeg();
      zeileAktivSetzen(null);
      if (!el) return;
      blockSerialisieren(el);
      const leer = el.inhalt.zeilen.every((z) => !z.t.trim());
      // Eine leere HAFTNOTIZ bleibt: sie ist ein Gegenstand, den man
      // hinklebt und spaeter beschriftet. Ein leerer TEXTBLOCK verschwindet
      // weiterhin — unsichtbar und leer waere er nur eine Falle.
      //
      // Ein eingeordneter Block bleibt AUCH (01.09.2026, real passiert):
      // Lukas hat die beiden Zeilen unter "3 · Content & Wissen" geleert, um
      // sie neu zu schreiben — und damit war der ganze Block weg, samt
      // Ueberschrift und Kategorie. Ein Kategorie-Block ist kein loser Text,
      // sondern ein Behaelter mit Titel; leer heisst dort "nichts offen",
      // nicht "gibt es nicht". Wer ihn wirklich loswerden will, nimmt ihm die
      // Kategorie oder loescht ihn ueber den Papierkorb.
      if (leer && el.art !== "notiz" && !el.inhalt.kategorie) {
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
      // Dieselbe Regel gilt fuer den Fokus-Chip und fuer die Antwort selbst:
      // beide sind zum ANTIPPEN da, nicht zum Ziehen des Blocks — und beide
      // duerfen der Zeile nicht den Fokus nehmen (der Doppelklick auf die
      // Antwort soll den Dialog oeffnen, nicht den Block umsortieren).
      if (ev.target.closest(".wb-abhaken,.wb-zeile-tools,.wb-zeile-chip,.wb-antwort")) { ev.preventDefault(); return; }
      // Diese Kinder regeln sich selbst — Kasten, Griff, Zeilengriff,
      // Anfasser, Link.
      if (ev.target.closest(".wb-kasten,.wb-griff,.wb-zeile-griff,.wb-groesse-griff,.wb-zeile-link")) return;
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
      // Klick auf die Ueberschrift: nur auswaehlen. Sie ist nicht
      // editierbar, und einen Caret in die ERSTE AUFGABE zu setzen, weil
      // jemand den Titel angetippt hat, waere die falsche Antwort auf die
      // falsche Frage. Ausgewaehlt ist der Block an dieser Stelle schon
      // (siehe pointerdown) — es ist also nichts zu tun.
      if (ev.target.closest && ev.target.closest(".wb-blockkopf")) return;
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

    // ---- Unterpunkt ein/aus (Tab, Umschalt+Tab, Knopf). Der getippte Stand
    // zaehlt (serialisieren), der Schritt landet im Rueckgaengig-Stapel, und
    // der Caret bleibt, wo er war.
    function ebeneSetzen(el, idx, unter) {
      blockSerialisieren(el);
      const z = el.inhalt.zeilen[idx];
      if (!z) return false;
      if (unter && idx === 0) {
        toast("Die erste Zeile kann kein Unterpunkt sein — über ihr steht nichts, wozu sie gehören könnte.");
        return false;
      }
      if ((z.ebene === 1) === !!unter) return false;
      const vorher = { inhalt: JSON.parse(JSON.stringify(el.inhalt)) };
      if (unter) z.ebene = 1; else delete z.ebene;
      const spanAlt = $$(".wb-zeile-text", knoten)[idx];
      const hatFokus = !!spanAlt && document.activeElement === spanAlt;
      const pos = hatFokus ? caretOffset(spanAlt) : 0;
      blockRendern(el);
      if (hatFokus) caretSetzen($$(".wb-zeile-text", knoten)[idx], pos);
      undoMerken({ typ: "aendern", id: el.id, vorher,
                   nachher: { inhalt: JSON.parse(JSON.stringify(el.inhalt)) } });
      blockGeaendert(el, true);
      return true;
    }

    // ---- Zeilen wegnehmen — EIN Weg fuer Papierkorb, Backspace und Entf.
    // Bleibt nichts uebrig, gilt dieselbe Regel wie beim Verlassen eines
    // leeren Blocks: Ein loser Textblock verschwindet; eine Haftnotiz und ein
    // eingeordneter Block (mit Ueberschrift) bleiben mit einer leeren Zeile
    // stehen — leer heisst dort "nichts offen", nicht "gibt es nicht".
    // caret: {idx, pos} | null. pos -1 = Zeilenende.
    function zeilenWeg(el, idx, anzahl, caret) {
      const vorher = { inhalt: JSON.parse(JSON.stringify(el.inhalt)) };
      el.inhalt.zeilen.splice(idx, anzahl);
      if (!el.inhalt.zeilen.length) {
        if (el.art !== "notiz" && !el.inhalt.kategorie) { elementLoeschen([el.id]); return; }
        el.inhalt.zeilen = [{ t: "", erledigt: false, gestrichen: false }];
      }
      blockRendern(el);
      if (knoten.classList.contains("wb-fokus") || caret) {
        const spans = $$(".wb-zeile-text", knoten);
        const zi = klemm(caret ? caret.idx : idx, 0, spans.length - 1);
        const ziel = spans[zi];
        if (ziel) caretSetzen(ziel, caret && caret.pos >= 0 ? Math.min(caret.pos, ziel.textContent.length)
                                                          : ziel.textContent.length);
      }
      undoMerken({ typ: "aendern", id: el.id, vorher,
                   nachher: { inhalt: JSON.parse(JSON.stringify(el.inhalt)) } });
      blockGeaendert(el, true);
    }

    // ---- Tastenlogik je Zeile.
    knoten.addEventListener("keydown", (ev) => {
      const span = ev.target.closest(".wb-zeile-text");
      if (!span) return;
      const el = elVonKnoten(knoten);
      if (!el) return;
      const zeile = span.closest(".wb-zeile");
      const idx = zeilenIndex(zeile);

      // Alt+A: auf DIESE Zeile antworten, ohne die Hand von der Tastatur zu
      // nehmen. ev.code statt ev.key, weil Alt+A auf manchen Belegungen ein
      // Sonderzeichen als key liefert (die physische Taste ist gemeint).
      // Serialisieren vorher, sonst antwortet man auf einen Zeilentext, den
      // das Modell so noch gar nicht kennt — dieselbe Vorsicht wie im Blatt.
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "KeyA") {
        ev.preventDefault();
        blockSerialisieren(el);
        antwortDialogOeffnen(el, idx);
        return;
      }

      // Tab rueckt die Zeile als Unterpunkt ein, Umschalt+Tab wieder aus. Tab
      // lief hier vorher aus dem Text hinaus in die Werkzeugleiste — wer
      // wirklich hinaus will, nimmt Esc.
      if (ev.key === "Tab" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault();
        if (ev.isComposing) return;
        ebeneSetzen(el, idx, !ev.shiftKey);
        return;
      }

      if (ev.key === "Enter") {
        ev.preventDefault();
        if (ev.isComposing) return;
        // Enter auf einem LEEREN Unterpunkt beendet die Stichpunkte: die Zeile
        // rueckt aus, statt einen weiteren leeren Punkt zu erzeugen — so, wie
        // es jede Gliederung macht.
        if (!span.textContent.trim() && el.inhalt.zeilen[idx] && el.inhalt.zeilen[idx].ebene === 1) {
          ebeneSetzen(el, idx, false);
          return;
        }
        if (el.inhalt.zeilen.length >= DATEN.grenzen.zeilen) { toast("Mehr als " + DATEN.grenzen.zeilen + " Zeilen passen nicht auf einen Block."); return; }
        blockSerialisieren(el);
        const pos = caretOffset(span);
        const text = el.inhalt.zeilen[idx].t;
        // Die Teilstriche werden MITGETEILT: was vor dem Caret gestrichen war,
        // bleibt oben gestrichen, was dahinter lag, wandert mit in die neue
        // Zeile. Der Ganz-Strich (gestrichen) bleibt dagegen bei der oberen
        // Zeile — das ist das gewohnte Verhalten und bleibt unangetastet.
        const geteilt = teilstriche(el.inhalt.zeilen[idx]);
        el.inhalt.zeilen[idx].t = text.slice(0, pos);
        stricheAblegen(el.inhalt.zeilen[idx], stricheSchneiden(geteilt, 0, pos));
        const neueZeile = { t: text.slice(pos), erledigt: false, gestrichen: false };
        // Unter einem Unterpunkt geht es mit Unterpunkten weiter.
        if (el.inhalt.zeilen[idx].ebene === 1) neueZeile.ebene = 1;
        stricheAblegen(neueZeile, stricheSchneiden(geteilt, pos, text.length));
        el.inhalt.zeilen.splice(idx + 1, 0, neueZeile);
        blockRendern(el);
        const neue = $$(".wb-zeile-text", knoten)[idx + 1];
        if (neue) caretSetzen(neue, 0);
        blockGeaendert(el, true);
        return;
      }

      if (ev.key === "Backspace" && caretOffset(span) === 0 && fensterKollabiert()) {
        blockSerialisieren(el);
        const dieZeile = el.inhalt.zeilen[idx];
        // 1. Ein Unterpunkt rueckt erst einmal AUS — der zweite Druck loescht.
        if (dieZeile && dieZeile.ebene === 1) { ev.preventDefault(); ebeneSetzen(el, idx, false); return; }
        // 2. Die ERSTE Zeile (17.09.2026). Hier stand "return — nichts zu
        //    mergen", und das war der Fehler: Wer den Text der ersten Aufgabe
        //    herausloeschte, behielt ein leeres Kaestchen, das sich mit nichts
        //    mehr entfernen liess. Eine LEERE erste Zeile geht jetzt weg, der
        //    Caret steht danach am Anfang der naechsten.
        if (idx === 0) {
          if (dieZeile && !dieZeile.t.trim() && el.inhalt.zeilen.length > 1) {
            ev.preventDefault();
            zeilenWeg(el, 0, 1, { idx: 0, pos: 0 });
          }
          return;
        }
        ev.preventDefault();
        // 3. Steht DARUEBER eine leere Zeile, geht die leere — nicht diese
        //    hier in ihr auf: beim Verschmelzen gewinnt die obere Zeile, und
        //    Haken, Link und CRM-Bezug dieser Zeile waeren sonst verloren.
        if (!el.inhalt.zeilen[idx - 1].t.trim() && dieZeile && dieZeile.t.trim()) {
          zeilenWeg(el, idx - 1, 1, { idx: idx - 1, pos: 0 });
          return;
        }
        const vorherText = el.inhalt.zeilen[idx - 1].t;
        // Metadaten der VORZEILE ueberleben den Merge — wer eine erledigte
        // Zeile hochzieht, will ihren Haken nicht verlieren.
        // Die Teilstriche BEIDER Zeilen ueberleben: die der unteren wandern um
        // die Laenge der oberen nach hinten. Sonst streichen sie nach dem
        // Zusammenziehen ploetzlich Woerter am Zeilenanfang.
        const obenStriche = teilstriche(el.inhalt.zeilen[idx - 1]);
        const untenStriche = teilstriche(el.inhalt.zeilen[idx])
          .map(([a, b]) => [a + vorherText.length, b + vorherText.length]);
        el.inhalt.zeilen[idx - 1].t = vorherText + el.inhalt.zeilen[idx].t;
        stricheAblegen(el.inhalt.zeilen[idx - 1], obenStriche.concat(untenStriche));
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
        // Eine LEERE Zeile geht selbst — die naechste behaelt Haken, Link und
        // CRM-Bezug (beim Verschmelzen gewaenne sonst die leere obere).
        if (!el.inhalt.zeilen[idx].t.trim()) { zeilenWeg(el, idx, 1, { idx, pos: 0 }); return; }
        const eigenerText = el.inhalt.zeilen[idx].t;
        // Wie beim Backspace-Merge: die Bereiche der unteren Zeile wandern um
        // die Laenge der oberen nach hinten.
        const eigenStriche = teilstriche(el.inhalt.zeilen[idx]);
        const holStriche = teilstriche(el.inhalt.zeilen[idx + 1])
          .map(([a, b]) => [a + eigenerText.length, b + eigenerText.length]);
        el.inhalt.zeilen[idx].t = eigenerText + el.inhalt.zeilen[idx + 1].t;
        stricheAblegen(el.inhalt.zeilen[idx], eigenStriche.concat(holStriche));
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
      // ERST die Teilstriche geradeziehen, DANN ablesen: der Browser setzt
      // eine Auszeichnung am Ende gern fort (wie bei fett) — hier soll ein
      // frisch getipptes Wort hinter einem Strich NICHT mitgestrichen sein.
      // Passiert nichts an einer Kante, kostet der Aufruf nur einen Vergleich.
      teilstricheNachfuehren(span);
      // historyUndo/historyRedo: der Browser hat den Zeileninhalt selbst
      // veraendert — einfach neu ablesen, unser Modell folgt dem DOM.
      blockSerialisieren(el);
      leerMarkieren(el, knoten);
      scrollMarkieren(el);
      blockGeaendert(el, false);
      // Der Chip haengt am ENDE des Textes — der wandert bei jedem Zeichen.
      chipNachziehen();
    });
    knoten.addEventListener("compositionend", (ev) => {
      const el = elVonKnoten(knoten);
      if (!el) return;
      // Waehrend der Komposition wird nichts umgebaut (bestehende Regel) —
      // jetzt ist sie zu Ende, jetzt darf einmal sauber nachgezogen werden.
      const span = ev.target.closest && ev.target.closest(".wb-zeile-text");
      if (span) teilstricheNachfuehren(span);
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
      // Eingefuegter Text ist eine Textaenderung wie jede andere: die Bereiche
      // werden hindurchgeschoben, statt auf ihren alten Zahlen sitzen zu
      // bleiben (dieselbe Regel an der Kante wie beim Tippen).
      const altStriche = teilstriche(el.inhalt.zeilen[idx]);
      if (teile.length === 1) {
        el.inhalt.zeilen[idx].t = (text.slice(0, pos) + teile[0] + text.slice(pos)).slice(0, DATEN.grenzen.zeichenJeZeile);
        stricheAblegen(el.inhalt.zeilen[idx], stricheVerschieben(altStriche, pos, 0, teile[0].length));
        blockRendern(el);
        caretSetzen($$(".wb-zeile-text", knoten)[idx], pos + teile[0].length);
      } else {
        const rest = text.slice(pos);
        el.inhalt.zeilen[idx].t = (text.slice(0, pos) + teile[0]).slice(0, DATEN.grenzen.zeichenJeZeile);
        stricheAblegen(el.inhalt.zeilen[idx], stricheSchneiden(altStriche, 0, pos));
        const neue = teile.slice(1).map((t) => ({ t: t.slice(0, DATEN.grenzen.zeichenJeZeile), erledigt: false, gestrichen: false }));
        const letzte = neue[neue.length - 1];
        // Der Rest der alten Zeile haengt sich an die LETZTE eingefuegte Zeile
        // — seine Bereiche wandern um deren Laenge mit.
        const restStriche = stricheSchneiden(altStriche, pos, text.length)
          .map(([a, b]) => [a + letzte.t.length, b + letzte.t.length]);
        letzte.t = (letzte.t + rest).slice(0, DATEN.grenzen.zeichenJeZeile);
        stricheAblegen(letzte, restStriche);
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

      // Der Knopf in den Zeilenwerkzeugen UND der Fokus-Chip am Wortende
      // fuehren zum selben Dialog — der Chip ist nur der viel kuerzere Weg
      // dorthin (die Werkzeuge haengen an der rechten Blockkante).
      if (ev.target.closest(".wb-zeile-antwort,.wb-zeile-chip")) {
        ev.preventDefault();
        blockSerialisieren(el);
        antwortDialogOeffnen(el, idx);
        return;
      }

      if (ev.target.closest(".wb-zeile-kette")) {
        ev.preventDefault();
        linkDialogOeffnen(el, idx);
        return;
      }

      if (ev.target.closest(".wb-zeile-einruecken")) {
        ev.preventDefault();
        ebeneSetzen(el, idx, !(z.ebene === 1));
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
        // Auch das Wegnehmen einer Zeile gehoert in den Undo-Stapel — aus
        // demselben Grund wie die Toggles darueber, nur mit mehr Gewicht:
        // hier geht TEXT verloren. Ohne Eintrag nahm Strg+Z stattdessen die
        // letzte andere Aktion zurueck und die Zeile blieb weg (gemessen
        // 05.09.2026: nach dem Tippen stand als oberster Eintrag das
        // automatische Nachruecken des Blocks darunter — Rueckgaengig schob
        // diesen fremden Block zurueck, die geloeschte Zeile nicht).
        // Besonders bitter bei einer Zeile aus dem CRM: sie traegt den
        // Aufgaben-Bezug, den man von Hand nicht wiederherstellen kann.
        // Eine Aufgabe nimmt ihre Unterpunkte mit (zeileFamilie) — und sagt
        // es dazu, mit "Rueckgaengig" gleich am Hinweis: Wer den falschen
        // Papierkorb erwischt, soll nicht nach Strg+Z suchen muessen.
        const familie = zeileFamilie(el.inhalt.zeilen, idx);
        const warFokus = knoten.classList.contains("wb-fokus");
        zeilenWeg(el, idx, 1 + familie, warFokus ? { idx, pos: -1 } : null);
        toast(familie ? "Aufgabe mit " + familie + (familie === 1 ? " Unterpunkt" : " Unterpunkten") + " gelöscht."
                      : "Zeile gelöscht.",
              { aktion: () => undoAusfuehren(), aktionText: "Rückgängig" });
      }
    });

    // ---- Doppelklick auf einen Block bei kleiner Ansicht: erst heran-
    // zoomen, dann tippen — unter 35 % ist ein Caret nur noch Deko.
    knoten.addEventListener("dblclick", (ev) => {
      // Doppelklick auf eine vorhandene ANTWORT bearbeitet sie. Der
      // Doppelklick auf den AUFGABENTEXT bleibt unangetastet — das ist die
      // Wortauswahl des Browsers und zugleich der Ausloeser der Markier-Blase.
      if (ev.target.closest(".wb-antwort")) {
        ev.preventDefault();
        ev.stopPropagation();
        const el = elVonKnoten(knoten);
        const zeile = ev.target.closest(".wb-zeile");
        if (el && zeile) { blockSerialisieren(el); antwortDialogOeffnen(el, zeilenIndex(zeile)); }
        return;
      }
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

    // Einordnen: "Ohne" plus die fuenf Kategorien — in der Reihenfolge, die
    // ihre Rangfolge IST. Wer hier klickt, sagt nur, WAS die Aufgabe ist;
    // WOHIN sie gehoert, weiss die Tafel danach selbst (nachRangOrdnen).
    const kategorien = document.createElement("div");
    kategorien.className = "wb-kasten-gruppe wb-kasten-kat";
    const katKnopf = (wert, wort, tip, farbe) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "wb-katwahl"; b.dataset.kategorie = wert;
      b.textContent = wort;
      if (farbe) b.style.setProperty("--kf", tinte(farbe));
      b.setAttribute("data-tip", tip);
      b.setAttribute("aria-label", tip);
      kategorien.appendChild(b);
    };
    katKnopf("", "Ohne", "Nicht eingeordnet", null);
    KATEGORIEN.forEach((k, i) => katKnopf(k.wert, k.kurz, (i + 1) + ". " + k.lang, k.farbe));

    const weg = document.createElement("button");
    weg.type = "button"; weg.className = "wb-kasten-weg"; weg.innerHTML = ICON.weg + "<span>Block löschen</span>";
    weg.setAttribute("data-tip", "Block löschen"); weg.setAttribute("aria-label", "Block löschen");

    const trenner = () => { const t = document.createElement("div"); t.className = "wb-kasten-trenner"; return t; };
    const umbruch = () => { const u = document.createElement("div"); u.className = "wb-kasten-umbruch"; return u; };
    // Zwei Reihen: oben die FORM (Listenform, Farbe, Groesse), unten die
    // BEDEUTUNG (Einordnung, Zettelfarbe, Loeschen). Die Kategorien stehen
    // dabei vor den Zettelfarben, weil die Zettelgruppe bei Textbloecken
    // wegfaellt (kastenAuffrischen) — ein Trenner, dem nichts mehr folgt,
    // waere ein Strich im Nichts.
    kasten.append(listen, trenner(), farben, trenner(), groessen,
                  umbruch(), kategorien, trenner(), zettel, weg);

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
      const katKnopf = ev.target.closest("[data-kategorie]");
      // Kategoriewechsel braucht das "vorher" als ganzen Inhalt (Undo soll
      // Einordnung UND Lage in einem Zug zurueckholen) — darum wird er hier
      // getrennt vorbereitet statt nur ein Feld zu setzen.
      let katWechsel = null;
      if (liste) el.inhalt.liste = liste.dataset.liste;
      else if (farbe) el.inhalt.farbe = farbe.dataset.farbe;
      else if (groesse) el.inhalt.groesse = Number(groesse.dataset.groesse);
      else if (katKnopf) {
        const neu = katKnopf.dataset.kategorie;
        if ((el.inhalt.kategorie || "") === neu) return;   // steht schon so
        // Erst den getippten Stand ins Modell, DANN die Kopie ziehen: sonst
        // fehlte im "vorher" genau das zuletzt Getippte.
        if (!imBlatt) blockSerialisieren(el);
        katWechsel = { vorher: JSON.parse(JSON.stringify(el.inhalt)) };
        if (neu) el.inhalt.kategorie = neu; else delete el.inhalt.kategorie;
        katWechsel.nachher = JSON.parse(JSON.stringify(el.inhalt));
      }
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
      if (katWechsel) {
        // Einordnen ist EIN Vorgang — Ueberschrift, Lage und (falls
        // zusammengefuehrt) der Weg in den Zielblock. Sonst stuende der
        // Block nach einem Strg+Z halb hier und halb dort, und man muesste
        // raten, wie oft man noch druecken muss.
        const neuKat = el.inhalt.kategorie || "";
        const k = kategorieVon(neuKat);
        // Hat diese Kategorie auf der Tafel schon einen Block, wandert der
        // Inhalt DORTHIN — einen zweiten "1 · Kunden" soll es nie geben.
        const ziel = el.art === "text" ? zusammenfuehrZiel(tafelVon(el), neuKat, el) : null;
        sammelnBeginnen();
        let vereint = null;
        try {
          // Wird zusammengefuehrt, verschwindet dieser Block ganz — dann
          // gehoert der alte Stand in die Loeschen-Kopie, nicht in einen
          // eigenen aendern-Eintrag (der liefe beim Strg+Z gegen den
          // Grabstein). Bleibt der Block bestehen, ist der Eintrag noetig:
          // sonst nimmt Strg+Z die Lage zurueck, aber nicht die Einordnung.
          if (!ziel) {
            undoMerken({ typ: "aendern", id: el.id,
                         vorher: { inhalt: katWechsel.vorher }, nachher: { inhalt: katWechsel.nachher } });
          }
          if (ziel) {
            if (imBlatt) mobilVerwerfen();
            vereint = inBlockUebernehmen(el, ziel, katWechsel.vorher);
          } else if (!neuKat || !blockAufPlatz(el, { sammelt: true })) {
            // Blieb der Block liegen (keine Einordnung mehr, oder er steht
            // schon auf seinem Platz), muss die Einordnung selbst noch
            // gespeichert werden — blockAufPlatz schickt nur, wenn er rueckt.
            blockGeaendert(el, true);
          }
        } finally { sammelnAbschliessen(); }
        if (vereint) {
          toast("Zu " + kategorieTitel(k) + " dazugestellt.");
          zumBlockFuehren(ziel, vereint);
          return;
        }
        schilderAuffrischen();
        toast(k ? k.toast : "Einordnung entfernt.");
        if (imBlatt) mobilAnsichtAuffrischen();
        return;
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
    // "" ist der Knopf "Ohne" — ein Block ohne Einordnung ist ein Zustand,
    // kein fehlender Wert, und soll darum genauso markiert sein wie die vier.
    $$("[data-kategorie]", kasten).forEach((b) =>
      b.classList.toggle("wb-aktiv", b.dataset.kategorie === (el.inhalt.kategorie || "")));
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
      if (strichIds.length) {
        ziehVersatz.dx = dx; ziehVersatz.dy = dy;
        // Fahne und Schimmer kleben am Strich, nicht an seiner alten Lage —
        // sonst blieben sie bis zum Loslassen liegen (31.08.2026 gemeldet).
        for (const id of strichIds) { const e = elemente.get(id); if (e) strichSchmuck(e, dx, dy); }
        tinteNeu();
      }
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
        // Nichts bewegt: Positionen zuruecksetzen (falls geklemmt gerundet)
        // — auch Fahne und Schimmer, die live mitgelaufen sind.
        for (const e of betroffen) blockRendern(e);
        for (const id of strichIds) { const e = elemente.get(id); if (e) strichSchmuck(e); }
      }
      betroffen.forEach((e) => { if (!elementKnoten.get(e.id) || !elementKnoten.get(e.id).contains(document.activeElement)) inArbeit.delete(e.id); });
      strichIds.forEach((id) => inArbeit.delete(id));
      tinteNeu();
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
    strichSchmuck(el);
    aenderungEinreihen(el, true);
  }

  // =================================================================
  // Aufgabe abgeben: EINE Zeile auf eine andere Tafel ziehen
  // =================================================================
  //
  // "Das muss Jannik machen" hiess bisher: bei Jannik neu hinschreiben und
  // bei sich wegwischen — zweimal dieselbe Arbeit, und dazwischen vergisst
  // man die Haelfte. Jetzt greift man die Zeile und legt sie drueben ab.
  //
  // GEGRIFFEN wird an einem eigenen Griff links neben der Zeile (sechs
  // Punkte, dasselbe Bild wie am Block-Griff). Warum dort und nirgends
  // sonst:
  //   · Das Kaestchen ist zum ABHAKEN da. Abhaken ist die haeufigere
  //     Handlung — sie darf nie zum Ziehen werden.
  //   · Der Zeilentext gehoert dem Caret und der Markierung; wer dort zoege,
  //     koennte kein Wort mehr auswaehlen und die Markier-Blase nie oeffnen.
  //   · Der BLOCK laesst sich ueberall anfassen. Ein zweites Ziehen auf
  //     denselben Flaechen waere ein Ratespiel — zieht man jetzt die Zeile
  //     oder den ganzen Block?
  // Der Griff faengt sein pointerdown selbst ab, damit weder Block-Zug noch
  // Textauswahl anspringen, und er erscheint erst beim Ueberfahren der
  // Zeile: eine Liste voller Griffe waere eine Liste voller Knoepfe.
  //
  // Beim Loslassen VERSCHWINDET die Zeile bei mir (so entschieden am
  // 01.09.2026 — abgeben heisst abgeben) und steht drueben im Block
  // derselben Kategorie. Das neue Element traegt besitzer=ich und
  // tafel=Zielperson; damit greift die vorhandene Fahne "von Lukas" von
  // selbst. EIN Strg+Z macht beide Haelften zusammen rueckgaengig.
  //
  // Am Telefon gibt es den Griff nicht: dort oeffnet ein Tipp das
  // Bearbeitungsblatt, und ein Zug quer ueber eine stark herausgezoomte
  // Wand waere mit dem Daumen nicht zu treffen.

  let abgabe = null;            // laufender Zug: {el, idx, ziel, …}
  let abgabeGeist = null;       // die Zeile, die am Zeiger haengt
  let abgabeRaf = 0;            // Randlauf (die Wand faehrt mit)

  function zeileGriffAnbinden(griff) {
    griff.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 && ev.pointerType === "mouse") return;
      if (werkzeug !== "auswahl" || leertaste || abgabe || istMobil()) return;
      // Den Block erst JETZT suchen: dieselbe Zeile wird auch im mobilen
      // Blatt gebaut, und dort steckt sie in keinem .wb-el.
      const knoten = griff.closest(".wb-el");
      const zeile = griff.closest(".wb-zeile");
      if (!knoten || !zeile) return;
      // Der Zug gehoert der Zeile, nicht dem Block darunter.
      ev.preventDefault(); ev.stopPropagation();
      const el = elemente.get(knoten.dataset.id);
      if (!el || !darfBearbeiten(el)) return;
      const idx = zeilenIndex(zeile);
      const startX = ev.clientX, startY = ev.clientY, zeiger = ev.pointerId;
      let los = false;
      // Erst ab der Zieh-Schwelle wird es ein Zug: ein Klick auf den Griff
      // soll nichts tun, statt einen Geist aufblitzen zu lassen.
      const pruefen = (m) => {
        if (m.pointerId !== zeiger || los) return;
        if (Math.abs(m.clientX - startX) <= ZIEH_SCHWELLE
            && Math.abs(m.clientY - startY) <= ZIEH_SCHWELLE) return;
        los = true; abmelden();
        abgabeStarten(el, idx, zeile, m);
      };
      const ende = (m) => { if (m.pointerId === zeiger) abmelden(); };
      const abmelden = () => {
        window.removeEventListener("pointermove", pruefen, true);
        window.removeEventListener("pointerup", ende, true);
        window.removeEventListener("pointercancel", ende, true);
      };
      window.addEventListener("pointermove", pruefen, true);
      window.addEventListener("pointerup", ende, true);
      window.addEventListener("pointercancel", ende, true);
    });
  }

  function abgabeStarten(el, idx, zeileKnoten, ev) {
    if (abgabe) return;
    blockSerialisieren(el);                  // der getippte Stand zaehlt
    const daten = el.inhalt.zeilen[idx];
    if (!daten) return;
    inArbeit.add(el.id);
    // Eine Aufgabe nimmt ihre Unterpunkte mit (zeileFamilie).
    const familie = zeileFamilie(el.inhalt.zeilen, idx);
    abgabe = { el, idx, zeileKnoten, zeiger: ev.pointerId, familie,
               kat: el.inhalt.kategorie || "", von: tafelVon(el),
               modus: null, ziel: null, zielBlock: null, einfuegeIdx: -1,
               x: ev.clientX, y: ev.clientY };
    zeileKnoten.classList.add("wb-fliegt");
    for (let n = zeileKnoten.nextElementSibling, i = 0; n && i < familie; n = n.nextElementSibling, i++)
      n.classList.add("wb-fliegt-familie");
    zeileWarmSetzen(null);
    raum.classList.add("wb-abgabe-laeuft");
    if (!abgabeGeist) {
      abgabeGeist = document.createElement("div");
      abgabeGeist.className = "wb-abgabe-geist";
      abgabeGeist.innerHTML = '<div class="wb-abgabe-zeile"></div>'
        + '<div class="wb-abgabe-ziel"></div>';
      raum.appendChild(abgabeGeist);
    }
    $(".wb-abgabe-zeile", abgabeGeist).textContent =
      (String(daten.t || "").trim() || "leere Zeile")
      + (familie ? "  + " + familie + (familie === 1 ? " Unterpunkt" : " Unterpunkte") : "");
    abgabeGeist.hidden = false;
    abgabeNachziehen();
    window.addEventListener("pointermove", abgabeZeiger, true);
    window.addEventListener("pointerup", abgabeLos, true);
    window.addEventListener("pointercancel", abgabeLos, true);
    window.addEventListener("keydown", abgabeTaste, true);
    // Verliert das Fenster den Fokus (Alt+Tab mitten im Zug), kommt kein
    // pointerup mehr — der Geist bliebe stehen und der Randlauf liefe
    // weiter. Also abbrechen: nichts passiert, die Zeile bleibt, wo sie ist.
    window.addEventListener("blur", abgabeVerloren);
    abgabeRaf = requestAnimationFrame(abgabeRandLauf);
  }
  function abgabeVerloren() { if (abgabe) abgabeBeenden(null); }

  function abgabeZeiger(ev) {
    if (!abgabe || ev.pointerId !== abgabe.zeiger) return;
    ev.preventDefault();
    abgabe.x = ev.clientX; abgabe.y = ev.clientY;
    abgabeNachziehen();
  }

  // Geist an den Zeiger, Ziel bestimmen, Hervorhebungen setzen.
  function abgabeNachziehen() {
    const r = raum.getBoundingClientRect();
    abgabeGeist.style.left = (abgabe.x - r.left) + "px";
    abgabeGeist.style.top = (abgabe.y - r.top) + "px";
    // Der Geist haengt normalerweise RECHTS am Zeiger. Genau am rechten
    // Rand zieht man aber, um zur Nachbartafel zu kommen (der Randlauf) —
    // dort waere er abgeschnitten und der Hinweis, der das Ziel nennt,
    // unlesbar. Also klappt er auf die andere Seite, sobald er nicht mehr
    // passt. Dasselbe unten fuer die Werkzeugleiste.
    const breiteGeist = abgabeGeist.offsetWidth || 220;
    const hoeheGeist = abgabeGeist.offsetHeight || 54;
    abgabeGeist.classList.toggle("wb-links",
      abgabe.x + 16 + breiteGeist > r.right - 8);
    abgabeGeist.classList.toggle("wb-hoch",
      abgabe.y + hoeheGeist / 2 > r.bottom - 8);
    const tafelId = boardAnPunkt(ereignisZuWelt({ clientX: abgabe.x, clientY: abgabe.y }));
    // WOHIN FAELLT DIE ZEILE? (17.09.2026) Bis heute gab es genau ein Ziel:
    // eine ANDERE Tafel. Lukas: "Wenn man eine einzelne Aufgabe aus dem Block
    // zu einem anderen rueberziehen will, geht es aktuell nicht." Jetzt drei
    // Antworten, in dieser Reihenfolge:
    //   einfuegen  Der Zeiger steht ueber (oder knapp neben) einem Block, den
    //              ich aendern darf — auch dem eigenen. Die Zeile landet
    //              ZWISCHEN dessen Zeilen, der blaue Strich zeigt wo. Damit
    //              geht auch das Umsortieren innerhalb eines Blocks.
    //   abgeben    Fremde Tafel, kein Block getroffen: wie bisher in den
    //              Kategorie-Block dort bzw. einen eigenen daneben.
    //   neu        Freie Flaeche derselben Tafel: die Zeile wird ein eigener
    //              Block an dieser Stelle — "herausziehen".
    let modus = null, zielBlock = null, einfuegeIdx = -1;
    const getroffen = abgabeBlockUnterZeiger(abgabe.x, abgabe.y);
    if (getroffen) { modus = "einfuegen"; zielBlock = getroffen.el; einfuegeIdx = getroffen.idx; }
    else if (tafelId && tafelId !== abgabe.von) { modus = "abgeben"; zielBlock = abgabeZielBlock(tafelId, abgabe.kat); }
    else if (tafelId) modus = "neu";
    // Auf sich selbst fallen lassen ist kein Zug.
    const aufSichSelbst = modus === "einfuegen" && zielBlock === abgabe.el
      && einfuegeIdx >= abgabe.idx && einfuegeIdx <= abgabe.idx + 1 + abgabe.familie;
    // Ein Block, der NUR aus dieser Zeile besteht, laesst sich nicht aus sich
    // selbst "herausziehen" — den verschiebt man als Block.
    const nurDieseZeile = modus === "neu" && abgabe.el.inhalt.zeilen.length <= 1 + abgabe.familie;
    if (nurDieseZeile) modus = null;
    const gueltig = !!modus && !aufSichSelbst;
    abgabeMarkeSetzen(modus === "einfuegen" ? getroffen : null);
    for (const p of team) {
      const k = boardKnoten.get(p.id);
      if (k) k.wrap.classList.toggle("wb-zieltafel", modus === "abgeben" && p.id === tafelId);
    }
    if (abgabe.zielBlock !== zielBlock) {
      const alt = abgabe.zielBlock && elementKnoten.get(abgabe.zielBlock.id);
      if (alt) alt.classList.remove("wb-zielblock");
      const neu = zielBlock && elementKnoten.get(zielBlock.id);
      if (neu) neu.classList.add("wb-zielblock");
      abgabe.zielBlock = zielBlock;
    }
    abgabe.modus = gueltig ? modus : null;
    abgabe.einfuegeIdx = einfuegeIdx;
    abgabe.ziel = gueltig ? tafelId : null;
    const kat = kategorieVon(abgabe.kat);
    let wort = "auf einen Block oder eine Tafel ziehen";
    if (gueltig && modus === "einfuegen") {
      const zk = kategorieVon(zielBlock.inhalt.kategorie);
      wort = zielBlock === abgabe.el ? "hierhin verschieben"
        : "in diesen Block" + (zk ? " · " + kategorieTitel(zk) : "");
    } else if (gueltig && modus === "abgeben") {
      wort = "zu " + vorname(tafelId) + (kat ? " · " + kategorieTitel(kat) : "");
    } else if (gueltig && modus === "neu") wort = "als eigenen Block ablegen";
    else if (aufSichSelbst) wort = "liegt schon hier";
    $(".wb-abgabe-ziel", abgabeGeist).textContent = wort;
    abgabeGeist.classList.toggle("wb-gueltig", gueltig);
  }

  // Der Block, in den die gezogene Zeile fallen wuerde — samt der Stelle.
  // NACHSICHTIG: Ein Block ist so hoch wie seine Zeilen und oft nur zwei davon;
  // wer 15 px daneben loslaesst, meint ihn trotzdem. Darum zaehlt ein Rand von
  // 22 Bildschirm-px mit, und bei mehreren Kandidaten gewinnt der, dessen
  // Mitte naeher liegt.
  function abgabeBlockUnterZeiger(x, y) {
    const RAND = 22;
    let bester = null;
    for (const [id, k] of elementKnoten) {
      const el = elemente.get(id);
      if (!el || (el.art !== "text" && el.art !== "notiz") || !darfBearbeiten(el)) continue;
      if (k.classList.contains("wb-altkopf") || !k.isConnected) continue;
      const r = k.getBoundingClientRect();
      if (!r.width || x < r.left - RAND || x > r.right + RAND || y < r.top - RAND || y > r.bottom + RAND) continue;
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (!bester || d < bester.d) bester = { el, k, d };
    }
    if (!bester) return null;
    const knoten = $$(".wb-zeilen > .wb-zeile", bester.k);
    let idx = knoten.length;
    for (let i = 0; i < knoten.length; i++) {
      const r = knoten[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { idx = i; break; }
    }
    // Eine HAUPTZEILE faellt nie mitten in eine fremde Familie: stuende sie
    // zwischen einer Aufgabe und deren Unterpunkten, gehoerten die ploetzlich
    // ihr. Sie rutscht ans Ende der Familie.
    const kopf = abgabe && abgabe.el.inhalt.zeilen[abgabe.idx];
    if (kopf && kopf.ebene !== 1) {
      const z = bester.el.inhalt.zeilen;
      while (idx < z.length && z[idx] && z[idx].ebene === 1) idx++;
    }
    return { el: bester.el, k: bester.k, idx, knoten };
  }

  // Der blaue Strich an der Einfuegestelle. Er haengt am BLOCK, nicht in der
  // Zeilenliste — zeilenIndex zaehlt deren Kinder, ein Fremdknoten dort
  // verschoebe jede Zeile dahinter um eins.
  let abgabeMarke = null;
  function abgabeMarkeSetzen(treffer) {
    if (!treffer || !treffer.knoten.length) { if (abgabeMarke) abgabeMarke.remove(); return; }
    if (!abgabeMarke) { abgabeMarke = document.createElement("div"); abgabeMarke.className = "wb-einfuege-marke"; }
    if (abgabeMarke.parentElement !== treffer.k) treffer.k.appendChild(abgabeMarke);
    const kr = treffer.k.getBoundingClientRect();
    const skala = treffer.k.offsetWidth ? kr.width / treffer.k.offsetWidth : 1;
    const n = treffer.knoten;
    const y = treffer.idx < n.length ? n[treffer.idx].getBoundingClientRect().top
                                     : n[n.length - 1].getBoundingClientRect().bottom;
    abgabeMarke.style.top = ((y - kr.top) / (skala || 1)).toFixed(1) + "px";
  }

  // Am Bildrand faehrt die Wand mit. Ohne das ginge die Abgabe nur in der
  // "Alle"-Ansicht — auf der eigenen Tafel haengt die Nachbartafel weit
  // ausserhalb des Bildes, und man koennte nie hinziehen.
  function abgabeRandLauf() {
    abgabeRaf = 0;
    if (!abgabe) return;
    const r = raum.getBoundingClientRect();
    const RAND = 70, TEMPO = 15;
    let dx = 0, dy = 0;
    if (abgabe.x < r.left + RAND) dx = ((r.left + RAND) - abgabe.x) / RAND * TEMPO;
    else if (abgabe.x > r.right - RAND) dx = -(abgabe.x - (r.right - RAND)) / RAND * TEMPO;
    if (abgabe.y < r.top + RAND) dy = ((r.top + RAND) - abgabe.y) / RAND * TEMPO;
    else if (abgabe.y > r.bottom - RAND) dy = -(abgabe.y - (r.bottom - RAND)) / RAND * TEMPO;
    if (dx || dy) {
      ansicht.tx += klemm(dx, -TEMPO, TEMPO);
      ansicht.ty += klemm(dy, -TEMPO, TEMPO);
      ansichtPassend = false;
      panKlemmen(); anwenden();
      abgabeNachziehen();
    }
    abgabeRaf = requestAnimationFrame(abgabeRandLauf);
  }

  function abgabeLos(ev) {
    if (!abgabe || ev.pointerId !== abgabe.zeiger) return;
    abgabeBeenden(ev.type === "pointercancel" ? null : abgabe.modus);
  }
  function abgabeTaste(ev) {
    if (!abgabe || ev.key !== "Escape") return;
    ev.preventDefault(); ev.stopPropagation();
    abgabeBeenden(null);
  }

  function abgabeBeenden(zielTafel) {
    const a = abgabe;
    abgabe = null;
    window.removeEventListener("pointermove", abgabeZeiger, true);
    window.removeEventListener("pointerup", abgabeLos, true);
    window.removeEventListener("pointercancel", abgabeLos, true);
    window.removeEventListener("keydown", abgabeTaste, true);
    window.removeEventListener("blur", abgabeVerloren);
    if (abgabeRaf) { cancelAnimationFrame(abgabeRaf); abgabeRaf = 0; }
    raum.classList.remove("wb-abgabe-laeuft");
    for (const p of team) {
      const k = boardKnoten.get(p.id);
      if (k) k.wrap.classList.remove("wb-zieltafel");
    }
    if (a.zielBlock) {
      const k = elementKnoten.get(a.zielBlock.id);
      if (k) k.classList.remove("wb-zielblock");
    }
    if (a.zeileKnoten) a.zeileKnoten.classList.remove("wb-fliegt");
    for (const n of $$(".wb-fliegt-familie", raum)) n.classList.remove("wb-fliegt-familie");
    if (abgabeMarke) abgabeMarke.remove();
    if (!istInBearbeitung(a.el.id)) inArbeit.delete(a.el.id);
    // "zielTafel" heisst der Parameter noch von frueher; er traegt heute den
    // MODUS (null = abgebrochen). Ausgefuehrt wird nur, was abgabeNachziehen
    // zuletzt als gueltig befunden hat.
    const modus = zielTafel ? a.modus : null;
    let geklappt = false;
    if (modus === "einfuegen") geklappt = zeileEinfuegen(a);
    else if (modus === "abgeben" && a.ziel) { abgabeAusfuehren(a, a.ziel); geklappt = true; }
    else if (modus === "neu") geklappt = zeileAlsBlock(a);
    geistWeg(!geklappt, a);
  }

  // Zeilen aus dem Quellblock nehmen — Teil eines laufenden Sammel-Vorgangs
  // (der Aufrufer oeffnet und schliesst ihn). Bleibt nichts uebrig, gilt die
  // Regel vom 01.09.: Ein loser Textblock verschwindet, eine Haftnotiz und ein
  // eingeordneter Block bleiben mit einer leeren Zeile stehen.
  function quelleAbziehen(el, idx, anzahl) {
    if (el.inhalt.zeilen.length <= anzahl && el.art !== "notiz" && !el.inhalt.kategorie) {
      undoMerken({ typ: "loeschen", kopien: [Object.assign({}, el, { inhalt: tiefeKopie(el.inhalt) })] });
      elementLoeschen([el.id], { ohneUndo: true });
      return;
    }
    const vorher = { inhalt: tiefeKopie(el.inhalt) };
    el.inhalt.zeilen.splice(idx, anzahl);
    if (!el.inhalt.zeilen.length) el.inhalt.zeilen = [{ t: "", erledigt: false, gestrichen: false }];
    undoMerken({ typ: "aendern", id: el.id, vorher, nachher: { inhalt: tiefeKopie(el.inhalt) } });
    blockRendern(el);
    blockGeaendert(el, true);
  }

  // Die gelandeten Zeilen blitzen kurz auf — man soll SEHEN, wo sie jetzt sind.
  function zeilenAufblitzen(el, idx, anzahl) {
    const k = elementKnoten.get(el.id);
    if (!k) return;
    const knoten = $$(".wb-zeilen > .wb-zeile", k).slice(idx, idx + anzahl);
    for (const n of knoten) { n.classList.remove("wb-gelandet"); void n.offsetWidth; n.classList.add("wb-gelandet"); }
    setTimeout(() => { for (const n of knoten) n.classList.remove("wb-gelandet"); }, 1300);
  }

  // Die Zeile (samt Unterpunkten) an die gezeigte Stelle legen — im selben
  // Block (umsortieren) oder in einem anderen. EIN Rueckgaengig-Schritt.
  function zeileEinfuegen(a) {
    const quelle = a.el, ziel = a.zielBlock;
    if (!ziel || !elemente.has(quelle.id) || !elemente.has(ziel.id) || !quelle.inhalt.zeilen[a.idx]) return false;
    const anzahl = 1 + a.familie;
    let ti = a.einfuegeIdx;
    if (ziel === quelle) {
      if (ti >= a.idx && ti <= a.idx + anzahl) return false;
      const vorher = { inhalt: tiefeKopie(quelle.inhalt) };
      const teil = quelle.inhalt.zeilen.splice(a.idx, anzahl);
      if (ti > a.idx) ti -= anzahl;
      ti = klemm(ti, 0, quelle.inhalt.zeilen.length);
      quelle.inhalt.zeilen.splice(ti, 0, ...teil);
      blockRendern(quelle);
      undoMerken({ typ: "aendern", id: quelle.id, vorher, nachher: { inhalt: tiefeKopie(quelle.inhalt) } });
      blockGeaendert(quelle, true);
      zeilenAufblitzen(quelle, ti, anzahl);
      return true;
    }
    // In einen anderen Block. Wird dort gerade getippt, zaehlt der getippte Stand.
    const zk = elementKnoten.get(ziel.id);
    if (zk && zk.classList.contains("wb-fokus")) blockSerialisieren(ziel);
    const zielLeer = ziel.inhalt.zeilen.every((z) => !String(z.t || "").trim());
    if (!zielLeer && ziel.inhalt.zeilen.length + anzahl > DATEN.grenzen.zeilen) {
      toast("Mehr als " + DATEN.grenzen.zeilen + " Zeilen passen nicht auf einen Block.");
      return false;
    }
    const teil = tiefeKopie(quelle.inhalt.zeilen.slice(a.idx, a.idx + anzahl));
    sammelnBeginnen();
    try {
      quelleAbziehen(quelle, a.idx, anzahl);
      const vorher = { inhalt: tiefeKopie(ziel.inhalt) };
      if (zielLeer) { ziel.inhalt.zeilen = teil; ti = 0; }
      else { ti = klemm(ti, 0, ziel.inhalt.zeilen.length); ziel.inhalt.zeilen.splice(ti, 0, ...teil); }
      blockRendern(ziel);
      undoMerken({ typ: "aendern", id: ziel.id, vorher, nachher: { inhalt: tiefeKopie(ziel.inhalt) } });
      blockGeaendert(ziel, true);
    } finally { sammelnAbschliessen(); }
    schilderAuffrischen();
    zeilenAufblitzen(ziel, ti, anzahl);
    toast(anzahl > 1 ? "Aufgabe mit Unterpunkten verschoben." : "Zeile verschoben.",
          { aktion: () => undoAusfuehren(), aktionText: "Rückgängig" });
    return true;
  }

  // "Herausziehen": auf freier Flaeche losgelassen, wird die Zeile ein eigener,
  // loser Block an dieser Stelle (ohne Kategorie — die gibt man ihm im Kasten).
  function zeileAlsBlock(a) {
    const quelle = a.el;
    if (!elemente.has(quelle.id) || !quelle.inhalt.zeilen[a.idx]) return false;
    const anzahl = 1 + a.familie;
    if (quelle.inhalt.zeilen.length <= anzahl) return false;
    const teil = tiefeKopie(quelle.inhalt.zeilen.slice(a.idx, a.idx + anzahl));
    let neu = null;
    sammelnBeginnen();
    try {
      quelleAbziehen(quelle, a.idx, anzahl);
      neu = abgabeBlockAnlegen(Object.assign({}, a, { kat: "" }), a.von, teil);
    } finally { sammelnAbschliessen(); }
    schilderAuffrischen();
    if (neu) zeilenAufblitzen(neu, 0, anzahl);
    toast("Als eigener Block abgelegt.", { aktion: () => undoAusfuehren(), aktionText: "Rückgängig" });
    return true;
  }

  // Kein gueltiges Ziel: der Geist springt zur Zeile zurueck — sichtbar,
  // damit man nicht raet, ob etwas passiert ist. Gelandet: er verblasst an
  // Ort und Stelle.
  function geistWeg(zurueck, a) {
    if (!abgabeGeist) return;
    const fertig = () => { if (abgabeGeist) { abgabeGeist.hidden = true; abgabeGeist.style.opacity = ""; } };
    if (sanft || !gsap || !zurueck || !a || !a.zeileKnoten || !a.zeileKnoten.isConnected) {
      fertig(); return;
    }
    const r = raum.getBoundingClientRect();
    const z = a.zeileKnoten.getBoundingClientRect();
    gsap.to(abgabeGeist, {
      left: (z.left + 14 - r.left), top: (z.top + z.height / 2 - r.top),
      opacity: 0, duration: 0.32, ease: "power2.in", onComplete: fertig,
    });
  }

  // Wohin drueben? Derselbe Kategorie-Block wie beim Einordnen — aber nur,
  // wenn wir ihn anfassen duerfen. Gehoert er der Zielperson selbst, weist
  // der Server jedes aendern mit 404 ab; dann legen wir DANEBEN einen
  // eigenen Block an und finden ihn beim naechsten Mal wieder.
  const abgabeZielBlock = (tafelId, kategorie) => zusammenfuehrZiel(tafelId, kategorie, null);

  function abgabeAusfuehren(a, zielTafel) {
    const el = a.el;
    if (!elemente.has(el.id) || !el.inhalt.zeilen[a.idx]) return;
    // Die Aufgabe geht MIT ihren Unterpunkten (a.familie).
    const anzahl = 1 + (a.familie || 0);
    const zeileKopie = tiefeKopie(el.inhalt.zeilen.slice(a.idx, a.idx + anzahl));
    const ziel = abgabeZielBlock(zielTafel, a.kat);
    let gelandet = null;
    sammelnBeginnen();
    try {
      // ---- 1. Bei mir weg (quelleAbziehen kennt die Regel fuer den Rest).
      quelleAbziehen(el, a.idx, anzahl);
      // ---- 2. Drueben hin.
      if (ziel) {
        const vorher = { inhalt: tiefeKopie(ziel.inhalt) };
        const zielLeer = ziel.inhalt.zeilen.every((z) => !String(z.t || "").trim());
        ziel.inhalt.zeilen = (zielLeer ? [] : ziel.inhalt.zeilen)
          .concat(zeileKopie).slice(0, DATEN.grenzen.zeilen);
        undoMerken({ typ: "aendern", id: ziel.id,
                     vorher, nachher: { inhalt: tiefeKopie(ziel.inhalt) } });
        blockRendern(ziel);
        blockGeaendert(ziel, true);
        gelandet = ziel;
      } else {
        gelandet = abgabeBlockAnlegen(a, zielTafel, zeileKopie);
      }
    } finally { sammelnAbschliessen(); }

    schilderAuffrischen();
    if (gelandet) {
      const k = elementKnoten.get(gelandet.id);
      if (k) {
        k.classList.remove("wb-zugewachsen");
        void k.offsetWidth;
        k.classList.add("wb-zugewachsen");
        setTimeout(() => k.classList.remove("wb-zugewachsen"), 1300);
      }
    }
    const kat = kategorieVon(a.kat);
    toast("An " + vorname(zielTafel) + " abgegeben"
          + (kat ? " — " + kategorieTitel(kat) : "") + ".",
          { aktion: () => undoAusfuehren(), aktionText: "Rückgängig" });
  }

  // Es gibt drueben noch keinen Block, den wir beschreiben duerfen: einen
  // eigenen anlegen. Mit Kategorie an ihrem festen Platz (und unter dem
  // Block der Zielperson, falls dort schon ihrer steht — ihre Ueberschrift
  // bleibt ihre); ohne Kategorie genau dort, wo losgelassen wurde.
  function abgabeBlockAnlegen(a, tafelId, zeile) {
    const quelle = a.el;
    const rang = KATEGORIEN.findIndex((k) => k.wert === a.kat);
    const breiteNeu = Math.round(klemm(quelle.breite || 560, TEXT_MIN_B, 900));
    let x, y;
    if (rang >= 0) {
      const platz = platzVon(rang);
      x = platz.x; y = platz.y;
      for (const el of elemente.values()) {
        if (el.art === "strich" || tafelVon(el) !== tafelId) continue;
        if (el.inhalt.kategorie !== a.kat || istAltUeberschrift(el)) continue;
        y = Math.max(y, el.y + (el.hoehe || 60) + ORD_LUFT);
      }
    } else {
      const w = ereignisZuWelt({ clientX: a.x, clientY: a.y });
      x = w.x - (versatz.get(tafelId) || 0) - 40;
      y = w.y - (versatzY.get(tafelId) || 0) - 24;
    }
    const el = {
      id: crypto.randomUUID(),
      besitzer: ich.id,                       // ich habe es geschrieben
      tafel: tafelId,                         // dort haengt es -> Fahne "von X"
      art: "text",
      x: Math.round(klemm(x, 0, BOARD_B - breiteNeu)),
      y: Math.round(klemm(y, 0, BOARD_H - 120)),
      breite: breiteNeu, hoehe: 60, version: 1,
      inhalt: {
        zeilen: Array.isArray(zeile) ? zeile : [zeile],
        // Eine abgegebene Aufgabe ist zum Abhaken da — darum die Checkliste,
        // wenn die Quelle keine eigene Form vorgibt.
        liste: quelle.inhalt.liste === "keine" ? "check" : quelle.inhalt.liste,
        farbe: quelle.inhalt.farbe, groesse: quelle.inhalt.groesse,
      },
    };
    if (a.kat) el.inhalt.kategorie = a.kat;
    elemente.set(el.id, el);
    blockRendern(el);
    const k = elementKnoten.get(el.id);
    if (k) el.hoehe = Math.round(k.offsetHeight);
    anlegenEinreihen(el);
    undoMerken({ typ: "anlegen", id: el.id });
    return el;
  }

  // =================================================================
  // Zusammenfuehren: eine Aufgabe landet IM Block ihrer Kategorie
  // =================================================================
  //
  // Wunsch vom 01.09.2026, im Originalton: "Man soll nicht extra immer die
  // Überschrift drüberschreiben müssen und zwei verschiedene Blöcke haben."
  // Also: Wer eine Aufgabe einordnet, deren Kategorie auf dieser Tafel schon
  // einen Block hat, schreibt sie IN diesen Block. Der frisch angelegte
  // Block verschwindet dabei — er war nur das Eingabefeld.

  const tiefeKopie = (x) => JSON.parse(JSON.stringify(x));

  // Der Block, in den zusammengefuehrt wird: der Kategorie-Block dieser
  // Tafel, sofern er ein Textblock ist und man ihn anfassen darf.
  //
  // Eine HAFTNOTIZ ist nie Ziel: sie ist ein Gegenstand, den man hinklebt —
  // sie in einer Liste aufgehen zu lassen waere eine Ueberraschung, keine
  // Ordnung. Und ein Block, den der Server uns mit 404 abwiese (fremde Hand
  // auf fremder Tafel), kommt gar nicht erst in Frage; dort entsteht
  // stattdessen ein eigener Block daneben (siehe Abgeben).
  function zusammenfuehrZiel(tafelId, kategorie, ausser) {
    if (!kategorie) return null;
    let beste = null;
    for (const el of elemente.values()) {
      if (el === ausser || el.art !== "text") continue;
      if (tafelVon(el) !== tafelId || el.inhalt.kategorie !== kategorie) continue;
      if (istAltUeberschrift(el) || !darfBearbeiten(el)) continue;
      if (!beste || kopfBesser(el, beste)) beste = el;
    }
    return beste;
  }

  // Die Zeilen von "quelle" an "ziel" anhaengen und die leere Huelle
  // entfernen. Laeuft IMMER innerhalb eines Sammel-Schritts: Anhaengen und
  // Wegnehmen sind EIN Vorgang, also auch EIN Strg+Z.
  //
  // "standVorher" ist der Inhalt, mit dem die Quelle im Undo-Stapel liegen
  // soll. Beim Einordnen ist das der Stand VOR der neuen Kategorie: der
  // Block verschwindet ja ganz, und Strg+Z soll ihn genau so zurueckbringen,
  // wie er vorher aussah. Ein zusaetzlicher "aendern"-Eintrag auf denselben
  // (dann geloeschten) Block waere die falsche Loesung — er liefe beim
  // Zurueckspielen gegen den Grabstein.
  //
  // Liefert {ab, anzahl} — wo die neuen Zeilen im Ziel stehen; danach setzt
  // sich der Cursor dorthin, damit man weitertippen kann, wo die Aufgabe
  // gelandet ist.
  function inBlockUebernehmen(quelle, ziel, standVorher) {
    const quelleKopie = Object.assign({}, quelle,
      { inhalt: tiefeKopie(standVorher || quelle.inhalt) });
    // Leere Zeilen fallen weg — sie waeren im Zielblock eine Luecke ohne
    // Aufgabe. Ist gar nichts uebrig (man hat den Block angelegt und SOFORT
    // eingeordnet), kommt genau EINE leere Zeile mit: dort steht dann der
    // Cursor, und man tippt einfach weiter.
    let zeilen = quelle.inhalt.zeilen.filter((z) => String(z.t || "").trim());
    if (!zeilen.length) zeilen = [{ t: "", erledigt: false, gestrichen: false }];
    // Ein Ziel, in dem noch gar nichts steht, wird ERSETZT statt beschrieben:
    // sonst begaenne die Liste mit einer leeren Zeile.
    const zielLeer = ziel.inhalt.zeilen.every((z) => !String(z.t || "").trim());
    const vorher = { inhalt: tiefeKopie(ziel.inhalt) };
    const bestand = zielLeer ? [] : ziel.inhalt.zeilen;
    const ab = bestand.length;
    ziel.inhalt.zeilen = bestand.concat(tiefeKopie(zeilen)).slice(0, DATEN.grenzen.zeilen);
    const anzahl = ziel.inhalt.zeilen.length - ab;
    undoMerken({ typ: "aendern", id: ziel.id,
                 vorher, nachher: { inhalt: tiefeKopie(ziel.inhalt) } });
    blockRendern(ziel);
    blockGeaendert(ziel, true);
    // Erst danach die Huelle wegnehmen: so steht im Undo-Stapel "Ziel
    // geaendert, dann Quelle geloescht" — rueckwaerts abgespielt kommt also
    // zuerst die Quelle zurueck und danach das Ziel auf seinen alten Stand.
    undoMerken({ typ: "loeschen", kopien: [quelleKopie] });
    elementLoeschen([quelle.id], { ohneUndo: true });
    return { ab, anzahl };
  }

  // Nach dem Zusammenfuehren: den Zielblock zeigen, kurz aufleuchten lassen
  // und den Cursor ans Ende der frisch angehaengten Zeile setzen. Liegt der
  // Block ausserhalb des Bildes, wird erst hingefahren — sonst verschwaende
  // die Aufgabe scheinbar im Nichts.
  function zumBlockFuehren(ziel, stelle) {
    auswahl.clear(); auswahl.add(ziel.id); auswahlAnzeigen();
    const knoten = elementKnoten.get(ziel.id);
    if (knoten) {
      knoten.classList.remove("wb-zugewachsen");
      void knoten.offsetWidth;                 // Animation neu anstossen
      knoten.classList.add("wb-zugewachsen");
      setTimeout(() => knoten.classList.remove("wb-zugewachsen"), 1300);
    }
    const setzen = () => {
      if (istMobil() || ansicht.s < ZOOM_TEXT_MIN || !knoten || !stelle) return;
      const spans = $$(".wb-zeile-text", knoten);
      const span = spans[klemm(stelle.ab + stelle.anzahl - 1, 0, spans.length - 1)];
      if (span) caretSetzen(span, span.textContent.length);
    };
    if (imBild(ziel)) setzen();
    else insBildHolen(ziel, setzen);
  }

  // =================================================================
  // Nach Rang ordnen: die Tafel sortiert sich selbst
  // =================================================================
  //
  // Der Nutzer sagt, WAS eine Aufgabe ist (Kategorie im Werkzeugkasten) —
  // WOHIN sie gehoert, weiss die Tafel danach selbst. Seit dem 01.09.2026
  // hat jede Kategorie ihren FESTEN PLATZ, in Leserichtung (seit 08.09.2026
  // in drei Spalten, siehe ORD_X):
  //     1 Kunden   2 Vertrieb   3 Content     (obere Reihe)
  //     4 Intern   5 CRM                      (untere Reihe)
  // Damit sieht jede Tafel im Haus gleich aus: man weiss, wo man hinschaut,
  // bevor man hinschaut.
  //
  // Angefasst wird ausschliesslich, was EINGEORDNET und BEARBEITBAR ist.
  // Unberuehrt bleiben nicht eingeordnete Bloecke, Haftnotizen ohne
  // Kategorie und ALLE Striche: auf einer Tafel wird auch gezeichnet, und
  // ein Pfeil, der ploetzlich woanders hinzeigt, waere schlimmer als jede
  // Unordnung. Ausgeblendete Alt-Ueberschriften bleiben ebenfalls liegen —
  // sie sind unsichtbar, es gibt nichts zu ordnen. Fremde Bloecke, die man
  // nicht aendern darf, faellt der Server ohnehin mit 404 ab.
  //
  // Waehrend die Bewegung laeuft, stehen die Ids in "ordnend": der Poll
  // darf ihnen nicht dazwischenfahren und sie auf die Serverlage
  // zurueckreissen (istInBearbeitung fragt den Merker mit ab).
  const ordnend = new Set();

  // Die Bloecke einer Spalte stapeln. "anker" ist der feste Platz, an dem
  // eine Gruppe beginnen SOLL; passt die Spalte damit nicht mehr auf die
  // Tafel, wird in Stufen nachgegeben:
  //   1. mit Ankern und vollem Abstand   (der Normalfall — feste Plaetze)
  //   2. ohne Anker, voller Abstand      (die untere Gruppe rueckt hoch)
  //   3. ohne Anker, Abstaende gestaucht (bis hinunter auf 0)
  //   4. enger gestapelt                 (haesslich, aber auf der Tafel)
  // Ausserhalb der Tafel ist weg, und weg ist schlimmer als eng.
  function spalteStapeln(eintraege) {
    const PLATZ = BOARD_H - ORD_RAND;
    const legen = (mitAnker, skala, enge) => {
      const y = [];
      let lauf = ORD_Y[0];
      for (let i = 0; i < eintraege.length; i++) {
        if (i) lauf += ORD_LUFT * skala + enge;
        if (mitAnker && eintraege[i].anker !== undefined)
          lauf = Math.max(lauf, eintraege[i].anker);
        y.push(lauf);
        lauf += eintraege[i].h;
      }
      return { y, unten: lauf };
    };
    let versuch = legen(true, 1, 0);
    if (versuch.unten <= PLATZ) return versuch.y;
    versuch = legen(false, 1, 0);
    if (versuch.unten <= PLATZ) return versuch.y;
    const summeH = eintraege.reduce((s, e) => s + e.h, 0);
    const luecken = Math.max(0, eintraege.length - 1);
    const rest = PLATZ - ORD_Y[0] - summeH;      // was fuer Luecken uebrig ist
    if (rest > 0 && luecken) return legen(false, rest / (luecken * ORD_LUFT), 0).y;
    return legen(false, 0, luecken ? rest / luecken : 0).y;
  }

  function nachRangOrdnen(tafelId, optionen) {
    const o = optionen || {};
    const bewegt = new Set();

    // ---- 1. Sammeln, je Kategorie eine Gruppe.
    const koepfe = kategorieKoepfe();
    const gruppen = KATEGORIEN.map(() => []);
    let anzahl = 0;
    for (const el of elemente.values()) {
      if (el.art === "strich") continue;
      if (tafelVon(el) !== tafelId) continue;
      if (!darfBearbeiten(el)) continue;
      const rang = kategorieRang(el);
      if (rang < 0) continue;
      if (istAltUeberschrift(el)
          && koepfe.has(tafelId + "|" + el.inhalt.kategorie)) continue;
      gruppen[rang].push(el);
      anzahl++;
    }
    if (!anzahl) {
      if (!o.still) toast("Hier ist noch nichts eingeordnet.");
      return bewegt;
    }
    // Innerhalb einer Gruppe: der Kategorie-Block zuerst (er traegt die
    // Ueberschrift, alles andere gehoert darunter), dann die bisherige Lage
    // — oben vor unten, links vor rechts. Der letzte Schluessel macht die
    // Sortierung STABIL: was sich der Nutzer innerhalb einer Gruppe
    // zurechtgelegt hat, bleibt so stehen. Geordnet werden die Gruppen,
    // nicht die Gedanken darin.
    gruppen.forEach((g, rang) => {
      const kopf = koepfe.get(tafelId + "|" + KATEGORIEN[rang].wert);
      g.sort((a, b) => (a === kopf ? -1 : b === kopf ? 1 : 0)
        || a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
    });

    // ---- 2. Hoehen MESSEN, nicht raten: wie hoch ein Textblock ist, weiss
    // nur das Layout (Umbruch, Schriftgroesse, Zeilenzahl — und seit heute
    // die Ueberschrift im Block). Nebenbei zieht das die gespeicherte Hoehe
    // nach; dieselbe Rechnung wie in blockGeaendert.
    const hoeheVon = (el) => {
      const k = elementKnoten.get(el.id);
      const h = Math.max(40, k ? Math.round(k.offsetHeight) : (el.hoehe || 60));
      if (el.art !== "notiz") el.hoehe = h;
      return h;
    };

    // ---- 3. Drei Spalten, je bis zu zwei Gruppen (08.09.2026): Spalte 0
    // traegt Rang 0 und 3, Spalte 1 die Raenge 1 und 4, Spalte 2 den Rang 2
    // (die untere Haelfte der dritten Spalte ist noch frei). Gerechnet wird
    // ueber ORD_SPALTEN statt ueber feste Zahlen — dieselbe Regel wie in
    // platzVon, damit eine sechste Kategorie nur EINE Zeile kostet.
    // Der erste Block einer Gruppe bekommt den festen Platz als Anker.
    const ziele = [];
    for (let spalte = 0; spalte < ORD_SPALTEN; spalte++) {
      const eintraege = [];
      for (let rang = spalte; rang < KATEGORIEN.length; rang += ORD_SPALTEN) {
        gruppen[rang].forEach((el, i) => {
          eintraege.push({ el, h: hoeheVon(el),
                           anker: i === 0 ? platzVon(rang).y : undefined });
        });
      }
      if (!eintraege.length) continue;
      const ys = spalteStapeln(eintraege);
      eintraege.forEach((e, i) => {
        // Weder rechts noch unten ueber den Rahmen: die Tafel ist die Welt.
        const zx = Math.round(klemm(ORD_X[spalte], 0, Math.max(0, BOARD_B - e.el.breite)));
        const zy = Math.round(klemm(ys[i], 0, Math.max(0, BOARD_H - e.h)));
        if (Math.round(e.el.x) !== zx || Math.round(e.el.y) !== zy)
          ziele.push({ el: e.el, x0: e.el.x, y0: e.el.y, x1: zx, y1: zy });
      });
    }

    if (!ziele.length) {
      if (!o.still) toast("Steht schon nach Priorität.");
      return bewegt;
    }

    // ---- 4. Festschreiben und hinfahren.
    zieleBewegen(ziele, o, bewegt);
    return bewegt;
  }

  // Eine Liste von {el,x0,y0,x1,y1} wirklich bewegen: EIN Undo-Eintrag fuer
  // den ganzen Vorgang, ein aendern je Block, EINE Animation. Das Modell
  // steht sofort richtig; die Animation bewegt nur noch die Knoten.
  //
  // Herausgeloest, weil zwei Wege hierher fuehren: das Ordnen der ganzen
  // Tafel und das Einruecken EINES frisch eingeordneten Blocks an seinen
  // festen Platz (blockAufPlatz).
  function zieleBewegen(ziele, o, bewegt) {
    const eigenesSammeln = !o.sammelt;
    if (eigenesSammeln) sammelnBeginnen();
    try {
      for (const z of ziele) {
        undoMerken({ typ: "aendern", id: z.el.id,
                     vorher: { x: z.x0, y: z.y0 }, nachher: { x: z.x1, y: z.y1 } });
        z.el.x = z.x1; z.el.y = z.y1;
        ordnend.add(z.el.id);
        inArbeit.add(z.el.id);
        aenderungEinreihen(z.el, true);
        if (bewegt) bewegt.add(z.el.id);
      }
    } finally { if (eigenesSammeln) sammelnAbschliessen(); }

    const fertig = () => {
      for (const z of ziele) {
        ordnend.delete(z.el.id);
        blockRendern(z.el);
        const k = elementKnoten.get(z.el.id);
        // Der Werkzeugkasten des gerade bearbeiteten Blocks bleibt offen —
        // aber er haengt jetzt an einer anderen Stelle der Tafel: neu
        // ausrichten, sonst oeffnet er oben gegen die Kopfzeile.
        if (k && k.classList.contains("wb-fokus")) kastenAusrichten(k);
        if (!istInBearbeitung(z.el.id)) inArbeit.delete(z.el.id);
      }
      schilderAuffrischen();
      if (o.fertigWort) toast(o.fertigWort);
      else if (!o.still) toast("Nach Priorität geordnet.");
    };

    // EINE Animation fuer den ganzen Vorgang: ein Fortschrittswert, aus dem
    // jeder Block seine Lage bekommt. n einzelne Tweens waeren n Uhren fuer
    // eine Bewegung — und die letzte entschiede, wann es vorbei ist. Unter
    // reduced-motion steht alles sofort da, wo es hingehoert.
    if (sanft || !gsap) { fertig(); return; }
    const lauf = { t: 0 };
    gsap.to(lauf, {
      t: 1, duration: 0.45, ease: "power3.inOut",
      onUpdate: () => {
        for (const z of ziele) {
          const k = elementKnoten.get(z.el.id);
          if (!k) continue;
          k.style.left = (z.x0 + (z.x1 - z.x0) * lauf.t).toFixed(1) + "px";
          k.style.top = (z.y0 + (z.y1 - z.y0) * lauf.t).toFixed(1) + "px";
        }
      },
      onComplete: fertig,
    });
  }

  // EINEN frisch eingeordneten Block an seinen festen Platz ruecken —
  // nicht die ganze Tafel neu ordnen. Grund: von Hand geschobene Bloecke
  // sollen liegen bleiben, bis der Nutzer selbst "Nach Priorität ordnen"
  // drueckt. Wer eine Aufgabe einordnet, will diese EINE Aufgabe an ihrem
  // Platz sehen, nicht die halbe Tafel in Bewegung.
  //
  // Steht schon etwas anderes auf dem Platz (die Gruppe hat mehrere
  // Bloecke), rueckt der neue darunter statt darauf.
  function blockAufPlatz(el, optionen) {
    const rang = kategorieRang(el);
    if (rang < 0) return false;
    const platz = platzVon(rang);
    const knoten = elementKnoten.get(el.id);
    const hoehe = Math.max(40, knoten ? Math.round(knoten.offsetHeight) : (el.hoehe || 60));
    if (el.art !== "notiz") el.hoehe = hoehe;
    // Unter alles ruecken, was in DIESER Spalte schon auf dem Platz liegt:
    // die eigene Gruppe (mehrere Bloecke einer Kategorie) und, in der unteren
    // Reihe, die Gruppe darueber. Ein langer Kunden-Block schiebt Content
    // also nach unten, statt dass beide uebereinander liegen.
    //
    // Nur wer sich wirklich UEBERSCHNEIDET, schiebt: ein Block weiter unten
    // geht niemanden etwas an. Weil jedes Ausweichen neue Ueberschneidungen
    // erzeugen kann, laeuft die Suche in Runden — gedeckelt, damit sie in
    // keinem Fall haengen bleibt.
    const drueber = [KATEGORIEN[rang].wert]
      .concat(rang >= ORD_SPALTEN ? [KATEGORIEN[rang - ORD_SPALTEN].wert] : []);
    let y = platz.y;
    for (let runde = 0; runde < 6; runde++) {
      let gewichen = false;
      for (const anderer of elemente.values()) {
        if (anderer === el || anderer.art === "strich") continue;
        if (tafelVon(anderer) !== tafelVon(el)) continue;
        if (!drueber.includes(anderer.inhalt.kategorie)) continue;
        if (istAltUeberschrift(anderer)) continue;
        const unten = anderer.y + (anderer.hoehe || 60);
        if (unten <= y || anderer.y >= y + hoehe) continue;
        y = unten + ORD_LUFT;
        gewichen = true;
      }
      if (!gewichen) break;
    }
    const x1 = Math.round(klemm(platz.x, 0, Math.max(0, BOARD_B - el.breite)));
    const y1 = Math.round(klemm(y, 0, Math.max(0, BOARD_H - hoehe)));
    if (Math.round(el.x) === x1 && Math.round(el.y) === y1) return false;
    zieleBewegen([{ el, x0: el.x, y0: el.y, x1, y1 }],
                 Object.assign({ still: true }, optionen || {}), null);
    return true;
  }

  // ------------------------------------------------- Wachsen macht Platz
  //
  // Ein Textblock waechst mit seinem Text: ein Absatz mehr, und er ist zwei
  // Zeilen hoeher. Bisher wuchs er dabei UEBER den Block darunter — der neue
  // Absatz stand mitten in fremdem Text, und welche Zeile zu welchem Block
  // gehoert, war nicht mehr zu sehen. Jetzt weicht aus, was er ueberdeckt.
  //
  // Drei Regeln halten das ruhig:
  //   1. Es rueckt nur, wer wirklich UEBERDECKT wird: waagrecht ueberlappend
  //      und senkrecht im Weg, mit der Oberkante nicht ueber der des
  //      Schiebers. Was daneben oder schon frei darunter steht, bleibt
  //      liegen — die Tafel ist kein Textfluss, der sich neu setzt.
  //   2. Die Bewegung PFLANZT SICH FORT: wer ausweicht, wird selbst zum
  //      Schieber (die Runden). Sonst loeste der erste Block sein Problem
  //      und schuf dem naechsten eins.
  //   3. Es geht nur nach UNTEN und nur so weit wie noetig. Schrumpft der
  //      Text wieder, bleibt das Gerueckte stehen: zurueckzuspringen hiesse,
  //      Lagen zu aendern, die der Nutzer inzwischen selbst gewaehlt haben
  //      kann — und ein Block, der beim Loeschen eines Zeichens huepft, ist
  //      schlimmer als eine Luecke.
  //
  // Die Tafel ist die Grenze (wie in spalteStapeln: ausserhalb ist weg, und
  // weg ist schlimmer als eng). Wer unten anstoesst, bleibt stehen, statt
  // ueber den Rahmen geschoben zu werden.
  const SCHUB_LUFT = 24;     // Welteinheiten Luft zwischen zwei Bloecken
  const SCHUB_RUNDEN = 12;   // Deckel: keine Kette laeuft endlos

  function untenPlatzMachen(el) {
    if (!el || el.art === "strich" || !darfBearbeiten(el)) return;
    const tafel = tafelVon(el);
    // Wie in nachRangOrdnen: gemessen, nicht geraten — und die Zahl gleich
    // ins Modell gezogen. Sonst klemmt die Rechnung gegen eine gespeicherte
    // Hoehe, die niemand mehr sieht, und der Block steht am Ende doch ein
    // Stueck unter der Tafelkante.
    const hoeheVon = (a) => {
      const k = elementKnoten.get(a.id);
      const h = Math.max(40, k ? Math.round(k.offsetHeight) : (a.hoehe || 60));
      if (a.art !== "notiz") a.hoehe = h;
      return h;
    };
    // Nur, was auf DERSELBEN Tafel liegt und was ich auch bewegen darf —
    // einen fremden Block wiese der Server mit 404 ab. Wer gerade selbst in
    // Bewegung ist (Zug, Skalieren, laufende Ordnen-Animation), wird nicht
    // auch noch geschoben: zwei Uhren fuer eine Bewegung sehen kaputt aus.
    const andere = [];
    for (const a of elemente.values()) {
      if (a === el || a.art === "strich") continue;
      if (tafelVon(a) !== tafel || !darfBearbeiten(a)) continue;
      if (ordnend.has(a.id)) continue;
      const k = elementKnoten.get(a.id);
      if (k && (k.classList.contains("wb-zieht") || k.classList.contains("wb-skaliert"))) continue;
      andere.push({ el: a, y: a.y, h: hoeheVon(a), geschoben: false });
    }
    if (!andere.length) return;

    let welle = [{ el, x: el.x, y: el.y, b: el.breite, h: hoeheVon(el) }];
    for (let runde = 0; runde < SCHUB_RUNDEN && welle.length; runde++) {
      const naechste = [];
      for (const s of welle) {
        const untenS = s.y + s.h;
        for (const a of andere) {
          // Wer schiebt, schiebt nicht sich selbst: der Ausgewichene wird in
          // der naechsten Runde zum Treiber und traefe sich sonst hier wieder
          // — er schoebe sich Runde um Runde die eigene Hoehe weiter, bis er
          // unten an der Tafel klebt (gemessen: 400 -> 1150 statt 400 -> 446).
          if (a.el === s.el) continue;
          if (a.el.x >= s.x + s.b || a.el.x + a.el.breite <= s.x) continue; // daneben
          if (a.y < s.y) continue;            // steht hoeher: nicht mein Problem
          if (a.y >= untenS) continue;        // steht schon frei darunter
          const ziel = Math.round(klemm(untenS + SCHUB_LUFT, 0,
                                        Math.max(0, BOARD_H - a.h)));
          if (ziel <= a.y) continue;          // Tafelkante: hier bleibt er stehen
          a.y = ziel; a.geschoben = true;
          naechste.push({ el: a.el, x: a.el.x, y: a.y, b: a.el.breite, h: a.h });
        }
      }
      welle = naechste;
    }

    const ziele = andere
      .filter((a) => a.geschoben && Math.round(a.el.y) !== a.y)
      .map((a) => ({ el: a.el, x0: a.el.x, y0: a.el.y, x1: Math.round(a.el.x), y1: a.y }));
    if (!ziele.length) return;
    // Laeuft schon ein Sammel-Vorgang (Abgabe, Gruppen-Zug), haengt sich das
    // Ausweichen dort an: ein eigenes sammelnBeginnen() wuerde die bereits
    // gesammelten Schritte des Aufrufers wegwerfen.
    zieleBewegen(ziele, { still: true, sammelt: !!sammelSchritte }, null);
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

  // Steht ein Element (auch nur zum Teil) im Bild?
  function imBild(el) {
    const bx = versatz.get(tafelVon(el)) || 0, by = versatzY.get(tafelVon(el)) || 0;
    const x0 = (el.x + bx) * ansicht.s + ansicht.tx;
    const y0 = (el.y + by) * ansicht.s + ansicht.ty;
    const x1 = x0 + (el.breite || 60) * ansicht.s;
    const y1 = y0 + (el.hoehe || 60) * ansicht.s;
    return x1 > 8 && y1 > 8 && x0 < breite - 8 && y0 < hoehe - 8;
  }

  // Hinfahren OHNE zu zoomen: der Block wandert in die Bildmitte, die
  // Vergroesserung bleibt, wie sie ist. Gebraucht, wenn eine Aufgabe in
  // einen Block gewandert ist, der gerade nicht im Bild steht — ein
  // Zoomsprung waere dort zu viel Bewegung fuer "sieh mal, dort liegt es".
  function insBildHolen(el, danach) {
    const bx = versatz.get(tafelVon(el)) || 0, by = versatzY.get(tafelVon(el)) || 0;
    const mx = (el.x + bx + (el.breite || 60) / 2) * ansicht.s;
    const my = (el.y + by + (el.hoehe || 60) / 2) * ansicht.s;
    const ziel = { tx: breite / 2 - mx, ty: hoehe / 2 - my };
    ansichtPassend = false;
    if (fitTween) { fitTween.kill(); fitTween = null; gesteBeenden(); }
    if (sanft || !gsap) {
      ansicht.tx = ziel.tx; ansicht.ty = ziel.ty;
      panKlemmen(); aufPixelSnappen();
      if (danach) danach();
      return;
    }
    gesteBeginnen();
    fitTween = gsap.to(ansicht, {
      tx: ziel.tx, ty: ziel.ty, duration: 0.5, ease: "power3.inOut", onUpdate: anwenden,
      onComplete: () => { fitTween = null; panKlemmen(); gesteBeenden(); if (danach) danach(); },
    });
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

  // Die Werkzeugleiste darf am Telefon UMBRECHEN (sonst rutschen Größe,
  // Undo/Redo und Hilfe bei 390 px aus dem Bild). Dann ist sie zwei Reihen
  // hoch — und Toasts wie Hilfe-Popover muessten raten, wie hoch. Also
  // misst sie sich selbst; CSS rechnet mit der Zahl.
  (function leisteMessen() {
    const leiste = $(".wb-leiste");
    const setzen = () => raum.style.setProperty("--wb-leiste-h",
      Math.round(leiste.getBoundingClientRect().height) + "px");
    new ResizeObserver(setzen).observe(leiste);
    setzen();
  })();

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
  // Die Entscheidung wird gepuffert, weil am Ende eines Wischschwungs beim
  // Touchpad gern einmal ein runder ganzer Wert anfaellt — mitten in der
  // Geste darf das nicht auf "Rad" umschlagen (die Wand zoomte sonst zum
  // Abschluss jedes Wischens einmal kurz).
  //
  // Der Merker hielt dafuer 400 ms ab dem LETZTEN Ereignis — auch dann
  // noch, wenn laengst ein anderes Geraet in der Hand lag. An einer
  // Dockingstation (Maus NEBEN Touchpad) war das spuerbar falsch. Zwei
  // Aenderungen, die beides zusammenbringen:
  //   1. Was ein Geraet EINDEUTIG verraet, gilt sofort — auch mitten im
  //      Nachlauf. Ein deltaX oder ein gebrochenes deltaY kann kein
  //      Rasterrad erzeugen: das ist ein Touchpad, Punkt.
  //   2. Der Merker haelt nur, solange die Ereignisse wirklich aneinander
  //      haengen (RAD_PAUSE). Ein Wischschwung feuert alle 8-16 ms; eine
  //      Pause heisst neue Geste, und die wird neu entschieden.
  // Uebrig bleibt der mehrdeutige Fall (kleiner GANZER Schritt ohne X) —
  // und genau der ist der Nachhall, fuer den der Merker gebaut wurde.
  const RAD_PAUSE = 150;                   // ms; darueber gilt die Geste als beendet
  const radMerk = { touchpad: false, zeit: -1e9 };
  function radMerkmal(ev) {
    if (ev.deltaMode !== 0) return false;                 // Zeilen/Seiten = nur Raeder
    if (ev.deltaX !== 0) return true;                     // Raeder kennen kein X
    if (!Number.isInteger(ev.deltaY)) return true;        // stufenlos = Touchpad
    return null;                                          // mehrdeutig
  }
  function istTouchpad(ev) {
    const jetzt = performance.now();
    const laeuft = jetzt - radMerk.zeit < RAD_PAUSE;
    const klar = radMerkmal(ev);
    if (klar !== null) { radMerk.touchpad = klar; radMerk.zeit = jetzt; return klar; }
    if (laeuft) { radMerk.zeit = jetzt; return radMerk.touchpad; }
    // Frische Geste, nur ein ganzer Schritt: 100/120/150 ist ein Rasterrad,
    // ein kleiner Betrag ein Touchpad.
    radMerk.touchpad = Math.abs(ev.deltaY) > 0 && Math.abs(ev.deltaY) < 50;
    radMerk.zeit = jetzt;
    return radMerk.touchpad;
  }

  // Rast am Zettelende: welcher Scroll-Kasten hat zuletzt wirklich
  // geblaettert, und wann. 350 ms — lang genug, dass ein Wischschwung
  // (Ereignisse alle 8-16 ms) und ein zweiter Radstoss derselben Hand noch
  // im Zettel landen, kurz genug, dass man nach dem Absetzen sofort wieder
  // an der Wand ist, ohne zu warten.
  const ZETTEL_RAST = 350;
  const zettelRast = { kasten: null, zeit: -1e9 };

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
    //
    // Am Zettelende greift das Rad bewusst auf die Wand ueber (Scroll-
    // Chaining, wie in jedem Browser) — aber erst nach einer Rast: sonst
    // kippte derselbe Schwung, mit dem man bis ans Ende gelesen hat, die
    // Wand aus dem Zoom (1,000 -> 0,768 gemessen). Die Rast ist die
    // Gestengrenze: solange die Ereignisse aneinanderhaengen, bleibt das
    // Rad im Zettel; nach einer Pause gehoert der naechste Schub der Wand.
    // (Das overscroll-behavior:contain im CSS haelt die SEITE heraus —
    // ueber die Wand entscheidet hier der Code, weil er ohnehin jedes
    // Rad-Ereignis abfaengt.)
    if (!ev.ctrlKey && ev.deltaY) {
      const kasten = ev.target.closest && ev.target.closest(".wb-zeilen.wb-scrollt");
      if (kasten) {
        const vorher = kasten.scrollTop;
        kasten.scrollTop += ev.deltaY * zeilen;
        if (kasten.scrollTop !== vorher) {
          zettelRast.kasten = kasten; zettelRast.zeit = performance.now();
          return;
        }
        // Nichts mehr zu scrollen: Ende erreicht. Innerhalb der Rast den
        // Schub schlucken, statt die Wand zu bewegen.
        if (zettelRast.kasten === kasten && performance.now() - zettelRast.zeit < ZETTEL_RAST) {
          zettelRast.zeit = performance.now();
          return;
        }
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
    if (ev.target.closest(".wb-kopf,.wb-leiste,.wb-hilfe,.wb-toasts,.wb-pfeile,.wb-fremdleiste,.wb-schild,.wb-wischenknopf,.wb-ablage,.wb-kasten,.wb-griff,.wb-zeile-griff,.wb-groesse-griff,.wb-zeile-tools,.wb-zeile-link,.wb-abhaken")) return;
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
    tinteNeu();
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
      // Fahne und Schimmer kleben am Strich, nicht an seiner alten Lage —
      // sonst blieben sie bis zum Loslassen liegen (31.08.2026 gemeldet).
      for (const e of striche) strichSchmuck(e, dx, dy);
      tinteNeu();
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
      } else {
        // Nichts bewegt: Fahne und Schimmer zuruecksetzen.
        for (const e of striche) strichSchmuck(e);
      }
      ids.forEach((id) => inArbeit.delete(id));
      tinteNeu();
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
    tinteNeu();
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
    strichSchmuck(el);
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
    // VOR dem ersten Treffer sichern: da steht die unversehrte Wand noch
    // auf der Leinwand, der Schnappschuss kostet dann nur ein drawImage.
    schwammBlitBeginnen();
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
      if (!weg) {
        weg = new Set(); schwammStriche.set(el.id, weg);
        // Neu markiert: im naechsten Frame aus dem Schnappschuss nehmen.
        if (schwammBlit) schwammNachtragen.push(el);
      }
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

    // ABSICHTLICH tintenDirty statt tinteNeu(): der Schnappschuss unter
    // dieser Vorschau soll genau stehen bleiben — er ist die Wand, wie sie
    // vor dem Wischen war. Ihn hier zu entwerten hiesse Voll-Redraw je
    // Frame, also wieder 30 fps.
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
    // Nach der Geste einmal sauber und vollstaendig zeichnen: der
    // Schnappschuss war ein Bild, jetzt gilt wieder das Modell.
    schwammBlitBeenden();
    tinteNeu();
  }

  function schwammLoslassen(abgebrochen) {
    schwammZug = null;
    if (abgebrochen || (!schwammStriche.size && !schwammTexte.size)) { schwammVerwerfen(); return; }
    schwammBlitBeenden();

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
    tinteNeu();
  }

  // Wie lang ist ein Stueck insgesamt (Summe seiner Segmente, Welt-px)?
  function stueckLaenge(p) {
    let l = 0;
    for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    return l;
  }

  // Einen Strich durch seine Reststuecke ersetzen. Stuecke unter zwei
  // Punkten fallen weg — ein einzelner Punkt waere ein Tupfer, den
  // niemand stehen lassen wollte, wenn er ihn gerade wegwischt.
  //
  // Dieselbe Ueberlegung, eine Stufe weiter (F10): Auch ein Rest von drei
  // Punkten auf zwei Pixeln ist kein Strich mehr, sondern Krümel. Der
  // Schwamm hat einen Durchmesser von 36 Bildschirm-px — was daneben an
  // Fussel liegen bleibt, wollte niemand behalten, und jeder Krümel ist ein
  // eigenes Element mit eigener Zeile in der Datenbank. Die Grenze steht
  // bei 6 Welt-px, weil das gerade die breiteste Strichstaerke (11) ist:
  // kuerzer als der Stift dick ist, kann nichts mehr wie ein Strich
  // aussehen — und breiter darf die Grenze nicht werden, sonst frisst der
  // Schwamm mehr, als er beruehrt hat.
  const REST_MIN_LAENGE = 6;
  function strichZerteilen(el, weg) {
    if (!el || el.art !== "strich") return;
    const p = el.inhalt.punkte;
    const n = p.length / 2;
    const stuecke = [];
    let lauf = [];
    const stueckMerken = () => {
      if (lauf.length >= 4 && stueckLaenge(lauf) >= REST_MIN_LAENGE) stuecke.push(lauf);
    };
    for (let i = 0; i < n; i++) {
      if (weg.has(i)) {
        stueckMerken();
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
    stueckMerken();
    const tafel = tafelVon(el);
    const { farbe, dicke } = el.inhalt;

    // Bleibt GENAU EIN Stueck uebrig, wird der Strich umgeschrieben statt
    // ersetzt. Das spart nicht nur zwei Server-Runden (loeschen + anlegen)
    // — es haelt vor allem die Identitaet: derselbe Strich behaelt seine id,
    // seine Herkunftsfahne und seine Stelle im Undo-Stapel. Wer an einem
    // Strichende immer wieder korrigiert, hatte sonst nach zehn Zuegen zehn
    // frische Elemente, jedes mit eigener Historie.
    if (stuecke.length === 1) {
      const punkte = stuecke[0];
      const bbox = strichBbox(punkte, dicke);
      const vorher = { x: el.x, y: el.y, breite: el.breite, hoehe: el.hoehe,
                       inhalt: { punkte: p.slice(), farbe, dicke } };
      el.inhalt.punkte = punkte;
      el.x = bbox.x; el.y = bbox.y; el.breite = bbox.breite; el.hoehe = bbox.hoehe;
      el._pfad = null; el._pfadGrob = null;
      undoMerken({ typ: "aendern", id: el.id, vorher,
                   nachher: { x: el.x, y: el.y, breite: el.breite, hoehe: el.hoehe,
                              inhalt: { punkte: punkte.slice(), farbe, dicke } } });
      strichSchmuck(el);
      aenderungEinreihen(el, true);
      return;
    }

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
    el.inhalt.zeilen.forEach((z, i) => {
      if (neueZeilen[i] == null) return;
      // Auch die Teilstriche wandern mit: der Schwamm nimmt einzelne ZEICHEN
      // aus dem Text, danach muessen die Bereiche noch dieselben Woerter
      // streichen. Gerechnet wird ueber eine Tabelle "wie viele Zeichen vor
      // Stelle i bleiben stehen" — dieselbe Vorstellung wie beim Tippen.
      const alt = teilstriche(z);
      z.t = neueZeilen[i];
      if (!alt.length) return;
      const weg = eintrag.zeilen[i].weg;
      const roh = eintrag.zeilen[i].text;
      const bleibt = new Array(roh.length + 1);
      let n = 0;
      for (let k = 0; k <= roh.length; k++) { bleibt[k] = n; if (k < roh.length && !weg.has(k)) n++; }
      stricheAblegen(z, alt.map(([a, b]) => [bleibt[klemm(a, 0, roh.length)], bleibt[klemm(b, 0, roh.length)]]));
    });
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
      const gesendet = body.inhalt && Array.isArray(body.inhalt.zeilen) ? zeilenSchluessel(body.inhalt.zeilen) : null;
      try {
        const { status, daten } = await senden("/api/whiteboard/anlegen", body);
        ausstehend.delete(el.id);
        if (daten.ok) {
          el.version = daten.version || 1;
          if (gesendet) el.__serverSchluessel = gesendet;
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
  // den Poll gesperrt, auch wenn der POST durch ist. "ordnend" zaehlt mit:
  // waehrend die Ordnen-Animation laeuft, steht das Modell schon auf der
  // Ziellage, der Knoten aber noch unterwegs — ein Poll dazwischen wuerde
  // ihn mitten im Flug neu zeichnen.
  function istInBearbeitung(id) {
    const k = elementKnoten.get(id);
    return ordnend.has(id)
      || !!(k && (k.classList.contains("wb-fokus") || k.classList.contains("wb-zieht")));
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
      // Was jetzt hinausgeht, ist nach dem Erfolg der Serverstand — die
      // Basis fuers naechste Zusammenfuehren.
      const gesendet = body.inhalt && Array.isArray(body.inhalt.zeilen) ? zeilenSchluessel(body.inhalt.zeilen) : null;
      try {
        const { status, daten } = await senden("/api/whiteboard/aendern", body);
        ausstehend.delete(el.id);
        if (daten.ok) {
          el.version = daten.version;
          if (gesendet) el.__serverSchluessel = gesendet;
          konflikte.delete(el.id);
          speicherFehler = 0;
        } else if (status === 409) {
          // Jemand hat zwischen zwei Tastendruecken in diesen Block
          // geschrieben — meist die CRM-Bruecke mit einer neuen Aufgabe.
          // Nicht ersetzen, sondern zusammenfuehren (zeilenZusammenfuehren)
          // und mit der Server-Version noch einmal senden. Erst wenn das
          // dreimal hintereinander schiefgeht, holt der Vollabgleich wie
          // frueher den ganzen Stand.
          const n = (konflikte.get(el.id) || 0) + 1;
          konflikte.set(el.id, n);
          const server = n <= 3 ? await elementVomServer(el) : null;
          if (server && server !== "weg" && server.art === el.art && elemente.has(el.id)) {
            const m = blockZusammenfuehren(el, server);
            toast(m.neueAufgaben ? "Eine Aufgabe wurde hinzugefügt — dein Text bleibt."
                                 : "Der Block wurde woanders geändert — zusammengeführt.");
            aenderungSenden(el);
          } else if (server === "weg") {
            toast("Das Element wurde in einer anderen Sitzung gelöscht.");
            elementEntfernen(el.id);
          } else {
            toast("Hole den aktuellen Stand.");
            inArbeit.delete(el.id);
            // Erst wenn der Abgleich wirklich durch ist, Entwarnung geben —
            // sonst raetselt man, ob die Wand jetzt stimmt.
            if (await vollAbgleich()) toast("Stand wurde aktualisiert.");
          }
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
  //
  // Sie haengen sich zusaetzlich SELBST in die Kette (01.09.2026): Sonst
  // ueberholt ein unmittelbar danach ausgeloestes "aendern" das
  // "wiederherstellen" — der Server saehe noch den Grabstein, antwortete
  // mit 404, und der Client raeumte das gerade Zurueckgeholte wieder weg.
  // Gemessen beim Strg+Z ueber ein Zusammenfuehren: der Block kam zurueck
  // und verschwand im selben Atemzug.
  function nachKetten(ids, arbeit) {
    const lauf = Promise.all(ids.map((id) => ketten.get(id) || Promise.resolve()))
      .then(arbeit)
      .catch(() => {});
    for (const id of ids) ketten.set(id, lauf);
    return lauf;
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
      strichSchmuck(el);
      tinteNeu();
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
    // Fremde Hand mitzaehlen, je Autor: gewischt wird das BOARD, also
    // faellt auch, was jemand anderes einem hier hingeschrieben hat. Wer
    // nur "12 Elemente" liest, ahnt nicht, dass Janniks Aufgabe dabei ist —
    // und der Undo-Toast hilft nur dem, der den Fehler bemerkt.
    const fremd = new Map();
    for (const el of elemente.values()) {
      if (tafelVon(el) !== ich.id) continue;
      n++;
      if (el.besitzer !== ich.id) fremd.set(el.besitzer, (fremd.get(el.besitzer) || 0) + 1);
    }
    if (!n) { toast("Deine Tafel ist schon leer."); return; }
    const satz = n === 1
      ? "Damit verschwindet 1 Element von deiner Tafel"
      : "Damit verschwinden " + n + " Elemente von deiner Tafel";
    const teile = [...fremd.entries()].sort((a, b) => b[1] - a[1])
      .map(([id, k]) => k + " von " + vorname(id));
    $(".wb-wischen-text").textContent = teile.length
      ? satz + ", darunter " + teile.join(" und ") + "."
      : satz + ".";
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
      .filter((w) => w.length > 1
        && !OHNE_BUCHSTABE.test(w)
        && !KALENDERWOCHE.test(w)
        && !STOPPWORTE.has(w.toLowerCase()));
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
  // Auf eine Zeile antworten — "hier geht es gerade nicht weiter"
  // =================================================================
  //
  // "Ladenhauf: Ads live stellen" — dazu steht "Partnerzuweisung angefragt".
  // Die Aufgabe ist nicht erledigt, aber man kann nichts tun, bis der andere
  // antwortet. Genau das soll man beim Ueberfliegen der Tafel sehen, ohne es
  // sich jedes Mal neu zusammenzureimen: Kaestchen mit Bernstein-Pause,
  // Zeile abgeblendet, Antwort darunter. Nimmt man die Antwort weg, ist die
  // Aufgabe sofort wieder eine ganz normale offene Aufgabe.

  const antwortDialog = $(".wb-antwort-dialog");
  const antwortEingabe = $(".wb-antwort-eingabe");
  // Gemerkt wird die ID, nicht das Element. Warum: waehrend der Dialog offen
  // steht, kann der Poll dasselbe Element als NEUES Objekt in die Karte
  // legen (elementUebernehmen ersetzt es). Ein festgehaltenes Objekt waere
  // dann eine Karteileiche — gemessen am 31.08.: der Server bekam die neue
  // Antwort, das Modell im Browser nicht, und das naechste Speichern lief in
  // einen 409. Der Poll wird zusaetzlich per inArbeit ausgesperrt, solange
  // der Dialog steht (dasselbe Mittel wie beim Tippen im Block); die
  // ID-Aufloesung ist der Guertel dazu.
  let antwortZiel = null;          // {id, idx}

  // Aus dem Textfeld wird EIN Text. Umbrueche werden zu Leerzeichen, weil das
  // Datenmodell je Zeile genau eine Antwort kennt — und weil der Server
  // (textSaeubern in whiteboard-routes.js) zwar Steuerzeichen wegnimmt, das
  // \n aber stehen laesst: die Normalisierung muss also hier passieren, sonst
  // stuende der Umbruch spaeter als harte Kante im Block.
  const antwortNormalisieren = (roh) => String(roh || "")
    .replace(/\s+/g, " ").trim().slice(0, DATEN.grenzen.zeichenJeZeile);

  function antwortDialogOeffnen(el, idx) {
    const zeile = el.inhalt.zeilen[idx];
    if (!zeile) return;
    antwortZiel = { id: el.id, idx };
    inArbeit.add(el.id);
    // Der Dialog uebernimmt jetzt — die Blase hat ihre Arbeit getan.
    blaseVerstecken();
    // Der Zeilentext steht oben als Kontext: im Dialog sieht man die Tafel
    // nicht mehr, und "worauf antworte ich hier" darf man nicht raten muessen.
    $(".wb-antwort-zeile").textContent = zeile.t.trim() || "Leere Zeile";
    antwortEingabe.value = zeile.antwort || "";
    $(".wb-antwort-weg").hidden = !zeile.antwort;
    antwortDialog.showModal();
    antwortEingabe.focus();
    antwortEingabe.select();
  }

  // Die Sperre faellt beim SCHLIESSEN, egal wie geschlossen wurde: Knopf,
  // Escape oder Uebernehmen. Ein Listener am Dialog trifft alle drei Wege —
  // ein vergessenes inArbeit hielte den Poll fuer diesen Block fuer immer an,
  // und fremde Aenderungen kaemen bei dieser Sitzung nie mehr an.
  antwortDialog.addEventListener("close", () => {
    if (antwortZiel) inArbeit.delete(antwortZiel.id);
    antwortZiel = null;
  });
  $(".wb-antwort-abbrechen").addEventListener("click", () => antwortDialog.close());
  $(".wb-antwort-ok").addEventListener("click", () => antwortSetzen(antwortNormalisieren(antwortEingabe.value)));
  $(".wb-antwort-weg").addEventListener("click", () => antwortSetzen(""));
  antwortEingabe.addEventListener("keydown", (ev) => {
    // Enter uebernimmt (wie im Link-Dialog); wer im Feld doch umbrechen will,
    // nimmt Shift+Enter — der Umbruch wird beim Uebernehmen zum Leerzeichen.
    // Escape schliesst der <dialog> von selbst.
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); antwortSetzen(antwortNormalisieren(antwortEingabe.value)); }
  });

  function antwortSetzen(text) {
    if (!antwortZiel) { antwortDialog.close(); return; }
    const { id, idx } = antwortZiel;
    // Erst schliessen (das raeumt antwortZiel und die inArbeit-Sperre ab),
    // dann mit den KOPIERTEN Werten weiterarbeiten — und das Element frisch
    // aus der Karte holen, nie aus dem Dialog-Gedaechtnis.
    antwortDialog.close();
    const el = elemente.get(id);
    const zeile = el && el.inhalt.zeilen[idx];
    if (!zeile) return;
    // Nichts geaendert heisst: kein Speichern und vor allem KEIN Undo-Schritt.
    // Sonst naehme das naechste Strg+Z scheinbar folgenlos "nichts" zurueck.
    if ((zeile.antwort || "") === text) return;
    const vorher = JSON.parse(JSON.stringify(el.inhalt));
    if (text) zeile.antwort = text; else delete zeile.antwort;
    blockRendern(el);
    blockGeaendert(el, true);
    // EIN Undo-Schritt fuer Setzen, Aendern und Loeschen — Muster wie beim
    // Abhaken und beim Link: Vorzustand und Nachzustand als ganzer Inhalt.
    undoMerken({ typ: "aendern", id: el.id, vorher: { inhalt: vorher },
                 nachher: { inhalt: JSON.parse(JSON.stringify(el.inhalt)) } });
    // Steht das mobile Blatt offen, ist ES die sichtbare Wahrheit — der
    // frisch gerenderte Block liegt dahinter. Also dort dieselbe Zeile
    // nachziehen (wie linkSetzen es tut).
    if (mobilOffen && mobilOffen.el.id === el.id) {
      const mobilZeile = mobilOffen.liste.children[idx];
      if (mobilZeile) zeileFuellen(mobilZeile, zeile, true);
    }
    toast(text ? "Antwort steht — die Zeile ist ruhig gestellt."
               : "Antwort gelöscht — die Aufgabe steht wieder offen.");
  }

  // =================================================================
  // Antworten BEIM WORT: Markier-Blase und Fokus-Chip
  // =================================================================
  //
  // Der Knopf in den Zeilenwerkzeugen haengt an der rechten BLOCKKANTE. Bei
  // einem 700 px breiten Block liegt er eine Handbreit von dem Wort entfernt,
  // um das es geht — man muss die Zeile suchen, hinfahren, hovern, treffen.
  // Deshalb drei zusaetzliche Wege zum SELBEN Dialog, alle dort, wo der Blick
  // ohnehin schon ist:
  //   (a) Markierung  — Doppelklick auf ein Wort, Dreifachklick, Ziehen oder
  //       Strg+A blendet eine Blase direkt ueber der Markierung ein.
  //   (b) Doppelklick auf eine vorhandene Antwort (siehe dblclick am Block).
  //   (c) Alt+A, solange der Cursor in der Zeile steht (siehe keydown).
  //   (d) Ein ruhiger Chip am Ende des Zeilentextes, solange sie fokussiert
  //       ist — der sichtbare Hinweis, dass es die anderen Wege gibt.
  //
  // Warum die Blase KEIN "Antwort löschen" anbietet, obwohl sie es koennte:
  // Loeschen ist selten und zerstoerend, und in der Blase saehe man dabei
  // nicht, WAS man wegwirft. Sie oeffnet darum immer den Dialog — dort steht
  // die Antwort im Feld, und der Loeschknopf sitzt daneben. Eine Blase, ein
  // Ziel; die Entscheidung faellt da, wo der Text zu sehen ist.

  // Aus einem Zeilenknoten Element und Zeilenindex bestimmen. Der Knoten kann
  // am Board haengen ODER im mobilen Blatt — beide Wege enden im selben
  // Dialog, also loest eine Funktion beide auf.
  function zeileAufloesen(zeile) {
    if (!zeile || !zeile.parentElement) return null;
    const idx = zeilenIndex(zeile);
    const blockKnoten = zeile.closest(".wb-el");
    if (blockKnoten) {
      const el = elemente.get(blockKnoten.dataset.id);
      return el && darfBearbeiten(el) ? { el, idx, mobil: false } : null;
    }
    if (mobilOffen && mobilOffen.blatt.contains(zeile)) return { el: mobilOffen.el, idx, mobil: true };
    return null;
  }

  // Den Antwort-Dialog fuer eine ZEILE oeffnen, egal von welchem Weg. Vorher
  // wird der getippte Stand ins Modell geschrieben: sonst antwortet man auf
  // eine Zeile, die es so noch gar nicht gibt (dieselbe Falle wie beim
  // Verknuepfen aus dem Blatt heraus).
  function antwortWegOeffnen(zeile) {
    const ziel = zeileAufloesen(zeile);
    if (!ziel) return false;
    if (ziel.mobil) mobilUebernehmen();
    else blockSerialisieren(ziel.el);
    antwortDialogOeffnen(ziel.el, ziel.idx);
    return true;
  }

  // Den markierten TEIL der Zeile durchstreichen — oder den Strich dort
  // wieder aufheben, wenn das Markierte schon ganz darunter liegt. Der
  // Hauptweg der Funktion: markieren, klicken, fertig.
  //
  // Die Bereiche werden VOR der Aktion aus dem DOM ins Modell geschrieben
  // (blockSerialisieren bzw. mobilUebernehmen) — sonst striche man in einer
  // Zeile herum, die das Modell so noch gar nicht kennt (dieselbe Falle wie
  // beim Antworten und beim Verknuepfen aus dem Blatt heraus).
  function teilstrichSchalten(merk) {
    const b = strichBereich(merk);
    if (!b) return false;
    const ziel = zeileAufloesen(merk.zeile);
    if (!ziel) return false;
    if (ziel.mobil) mobilUebernehmen();
    else blockSerialisieren(ziel.el);
    const el = ziel.el;
    const zeile = el.inhalt.zeilen[ziel.idx];
    if (!zeile) return false;
    // Nach dem Serialisieren gilt der Text des MODELLS. Weicht er von dem ab,
    // was beim Markieren dastand (jemand hat dazwischen getippt), waeren die
    // Offsets ein Griff ins Leere — dann lieber nichts tun als das Falsche.
    // Das geschuetzte Leerzeichen wird beim Serialisieren zum gewoehnlichen
    // (1:1, die Offsets bleiben gueltig) — hier also auf beiden Seiten gleich
    // behandeln, sonst schluege der Vergleich grundlos fehl.
    if (zeile.t !== b.text.replace(/ /g, " ")) return false;

    const vorher = JSON.parse(JSON.stringify(el.inhalt));
    const aktuell = stricheMitGanz(zeile);
    const weg = stricheDecken(aktuell, b.von, b.bis);
    const neu = weg ? stricheAbziehen(aktuell, b.von, b.bis) : aktuell.concat([[b.von, b.bis]]);
    // Beide Schalter frisch setzen: ein Ganz-Strich, aus dem ein Stueck
    // herausgenommen wird, ist kein Ganz-Strich mehr — und deckt das Ergebnis
    // wieder die ganze Zeile, macht stricheAblegen von selbst wieder einen
    // daraus (so wie es der Server ohnehin taete).
    zeile.gestrichen = false;
    delete zeile.striche;
    stricheAblegen(zeile, neu);

    blockRendern(el);
    blockGeaendert(el, true);
    // EIN Undo-Schritt fuer Setzen wie fuer Aufheben — Muster wie beim
    // Abhaken und beim Antworten: Vorzustand und Nachzustand als ganzer Inhalt.
    undoMerken({ typ: "aendern", id: el.id, vorher: { inhalt: vorher },
                 nachher: { inhalt: JSON.parse(JSON.stringify(el.inhalt)) } });
    // Steht das mobile Blatt offen, ist ES die sichtbare Wahrheit (wie bei
    // antwortSetzen) — dieselbe Zeile dort nachziehen.
    if (mobilOffen && mobilOffen.el.id === el.id) {
      const mobilZeile = mobilOffen.liste.children[ziel.idx];
      if (mobilZeile) zeileFuellen(mobilZeile, zeile, true);
    }
    const wort = b.text.slice(b.von, b.bis);
    const kurz = wort.length > 28 ? wort.slice(0, 27).trimEnd() + "…" : wort;
    toast(weg ? "„" + kurz + "“ steht wieder offen."
              : (zeile.gestrichen ? "Die ganze Zeile ist durchgestrichen."
                                  : "„" + kurz + "“ ist durchgestrichen — der Rest bleibt offen."));
    return true;
  }

  // ------------------------------------------------- (d) Der Fokus-Chip
  // EIN Knoten fuer die ganze Wand, der zur jeweils fokussierten Zeile
  // umzieht — pro Zeile einen anzulegen waere Ballast in jedem Block, und
  // sichtbar ist ohnehin immer nur einer.
  let chipEl = null;

  function chipBauen() {
    if (chipEl) return chipEl;
    const c = document.createElement("button");
    c.type = "button"; c.className = "wb-zeile-chip"; c.tabIndex = -1;
    c.innerHTML = '<i>' + ICON.antwortPfeil + "</i><span></span>";
    // Wie beim Abhak-Kreis: ohne preventDefault nimmt das Aufsetzen der Maus
    // der Zeile den Fokus — der Chip verschwaende dann in genau dem Moment,
    // in dem man ihn anklickt, und der Klick liefe ins Leere.
    c.addEventListener("pointerdown", (ev) => ev.preventDefault());
    chipEl = c;
    return c;
  }

  // Den Chip an eine Zeile haengen und ausrichten. Er ist ABSOLUT gesetzt und
  // verschiebt den Textfluss darum um nichts — das war die Bedingung: ein
  // Hinweis, der beim Auftauchen den Satz verrueckt, ist schlimmer als keiner.
  function chipAnZeile(zeile) {
    if (!zeile || !zeile.querySelector(".wb-zeile-text")) return chipWeg();
    if (!zeileAufloesen(zeile)) return chipWeg();
    const c = chipBauen();
    if (c.parentElement !== zeile) zeile.appendChild(c);
    const hat = !!zeile.dataset.antwort;
    const wort = hat ? "Antwort" : "Antworten";
    const span = c.lastElementChild;
    if (span.textContent !== wort) span.textContent = wort;
    c.title = hat ? "Antwort bearbeiten (Alt+A)" : "Auf diese Zeile antworten (Alt+A)";
    c.setAttribute("aria-label", c.title);
    chipNachziehen();
  }

  function chipWeg() {
    if (chipEl && chipEl.parentElement) chipEl.remove();
  }

  // Den stehenden Chip neu beschriften und ausrichten. Mit knoten: nur, wenn
  // er wirklich in DIESEM Block haengt — sonst zahlte jedes Rendern
  // irgendeines Blocks die Layout-Messung mit.
  function chipAuffrischen(knoten) {
    if (!chipEl || !chipEl.parentElement) return;
    if (knoten && !knoten.contains(chipEl)) return;
    chipAnZeile(chipEl.parentElement);
  }

  // Den Chip an die gerade beschriebene Zeile zurueckholen. Gebraucht, wenn
  // die Markier-Blase wieder verschwindet: solange SIE steht, waeren es zwei
  // Bernstein-Knoepfe fuer dieselbe Sache in einer Zeile.
  function chipAmFokus() {
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains("wb-zeile-text")) chipAnZeile(a.closest(".wb-zeile"));
  }

  // Die Lage misst das ENDE des Textes, nicht das Ende des Spans: der Span ist
  // immer blockbreit (flex:1), sein rechter Rand liegt also an der Blockkante
  // — genau dort, wo der Chip NICHT hin soll. Gerechnet wird in Layout-px der
  // Zeile; der Massstab kommt aus der Zeile selbst (Bildschirmbreite geteilt
  // durch Layoutbreite), damit dieselbe Rechnung auf der gezoomten Buehne und
  // im ungezoomten mobilen Blatt stimmt.
  function chipNachziehen() {
    const c = chipEl;
    if (!c || !c.parentElement) return;
    const zeile = c.parentElement;
    const span = $(".wb-zeile-text", zeile);
    if (!span) return;
    const zr = zeile.getBoundingClientRect();
    const skala = zeile.offsetWidth > 0 ? (zr.width / zeile.offsetWidth) : 1;
    if (!skala || !isFinite(skala)) return;
    let ende;
    const r = document.createRange();
    r.selectNodeContents(span);
    const kaesten = r.getClientRects();
    if (kaesten.length) ende = kaesten[kaesten.length - 1];
    else {
      // Leere Zeile: es gibt kein letztes Zeichen — der Chip steht dann am
      // Zeilenanfang, wo auch der Caret blinkt.
      const b = span.getBoundingClientRect();
      ende = { right: b.left, top: b.top, height: b.height || zr.height };
    }
    const luft = 8;                       // Layout-px Abstand zum letzten Wort
    const links = Math.max(0, (ende.right - zr.left) / skala + luft);
    // Der Chip GEHT MIT — er steht nie im Text. Bis zum 04.09. wurde er an
    // der rechten Blockkante festgehalten (Math.min gegen clientWidth):
    // schrieb man weiter nach rechts, lief der eigene Satz unter ihn, und man
    // sah nicht mehr, was man tippt. Genau das darf ein Hinweis nicht.
    // Wird der Platz neben dem Wort knapp, legt er zuerst SEIN WORT ab und
    // ist nur noch das Zeichen (wb-chip-knapp, rund ein Drittel so breit);
    // reicht auch das nicht, tritt er lieber neben den Block hinaus — dort
    // steht ohnehin nur Tafel, und der Satz bleibt lesbar. Gemessen wird in
    // dieser Reihenfolge, weil die schmale Fassung erst nach dem Umschalten
    // ihre Breite kennt.
    c.classList.remove("wb-chip-knapp");
    if (links + (c.offsetWidth || 0) > zeile.clientWidth) c.classList.add("wb-chip-knapp");
    c.style.left = Math.round(links) + "px";
    c.style.top = Math.round((ende.top + ende.height / 2 - zr.top) / skala) + "px";
  }

  // ------------------------------------------------- (a) Die Markier-Blase
  //
  // Die Blase ist bewusst eine kleine LEISTE und kein einzelner Knopf: sie
  // gehoert der Markierung, nicht dem Antworten. Was man mit einem markierten
  // Stueck Text tun kann, waechst — die naechste Aktion (ein Teilstueck der
  // Zeile durchstreichen) setzt hier an und bekommt einfach einen zweiten
  // Knopf in .wb-blase-knoepfe, ohne dass an Lage, Erscheinen oder
  // Verschwinden etwas zu aendern waere.
  let blaseEl = null;          // der eine Leisten-Knoten
  let blaseZeile = null;       // Zeile, zu der die stehende Blase gehoert
  let blaseZeigerUnten = false; // Maus/Finger unten: erst loslassen, dann fragen
  let blaseZeigerImText = false; // ... und die Geste begann IM Zeilentext
  let blaseTouch = false;      // letzte Geste kam vom Finger
  let blaseAus = false;        // per Escape stillgelegt, bis wieder etwas passiert
  let blasePlan = 0;

  // Was gerade markiert ist — Zeile UND Zeichenbereich im Zeilentext.
  // {zeile, span, el, idx, von, bis, text}. von/bis sind Offsets in zeile.t,
  // also genau das Format, in dem Zeilen-Metadaten am Server liegen. Wer eine
  // zweite Markierungs-Aktion baut, liest hier und muss die Offset-Rechnerei
  // nicht noch einmal bauen (siehe markierungLesen).
  let markierung = null;

  function blaseBauen() {
    if (blaseEl) return blaseEl;
    const b = document.createElement("div");
    b.className = "wb-markierblase";
    b.setAttribute("role", "toolbar");
    b.setAttribute("aria-label", "Was mit der Markierung tun");
    b.hidden = true;
    b.innerHTML = '<div class="wb-blase-knoepfe">'
      + '<button type="button" class="wb-blase-knopf wb-blase-antwort" tabindex="-1">'
      + "<i>" + ICON.antwortPfeil + '</i><span class="wb-blase-wort">Antworten</span></button>'
      // Der zweite Knopf: den markierten TEIL der Zeile durchstreichen. Er
      // traegt dasselbe Zeichen wie der Knopf in den Zeilenwerkzeugen, der
      // die GANZE Zeile streicht — es ist dieselbe Handbewegung, nur enger
      // gezielt, und das soll man am Bild erkennen, nicht am Text lesen.
      + '<button type="button" class="wb-blase-knopf wb-blase-strich" tabindex="-1">'
      + "<i>" + ICON.strich + '</i><span class="wb-blase-strich-wort">Durchstreichen</span></button>'
      + "</div>";
    // DIE Falle dieser Funktion: ohne preventDefault beim Aufsetzen gibt der
    // Browser der Zeile den Fokus ab und LEERT die Markierung — die Blase
    // verschwaende, bevor der Klick sie erreicht. Genau wie beim Abhak-Kreis
    // (siehe blockInteraktionAnbinden). Die Regel gilt fuer die ganze Leiste,
    // damit sie auch fuer spaetere Knoepfe automatisch stimmt.
    b.addEventListener("pointerdown", (ev) => { ev.preventDefault(); ev.stopPropagation(); });
    b.addEventListener("click", (ev) => {
      const knopf = ev.target.closest(".wb-blase-knopf");
      if (!knopf) return;
      ev.preventDefault();
      ev.stopPropagation();
      const zeile = blaseZeile;
      const merk = markierung;
      blaseVerstecken();
      if (!zeile) return;
      if (knopf.classList.contains("wb-blase-antwort")) antwortWegOeffnen(zeile);
      else if (knopf.classList.contains("wb-blase-strich")) teilstrichSchalten(merk);
    });
    wurzel.appendChild(b);
    blaseEl = b;
    return b;
  }

  function blaseVerstecken() {
    if (!blaseEl || blaseEl.hidden) { blaseZeile = null; return; }
    blaseEl.hidden = true;
    blaseZeile = null;
    // Der Chip kommt zurueck, sobald die Blase weg ist — er ist der ruhige
    // Dauerhinweis, sie der laute Moment.
    chipAmFokus();
  }

  // Gehoert die Markierung GENAU EINER Zeile? Beim Dreifachklick liegt das
  // Ende der Auswahl oft schon ausserhalb des Spans (der Browser nimmt den
  // Absatz) — das ist in Ordnung. Eine Auswahl, die in einer ANDEREN Zeile
  // endet, ist es nicht: auf zwei Zeilen zugleich kann man nicht antworten.
  function markierterSpan(bereich) {
    const alsElement = (k) => (k && (k.nodeType === 1 ? k : k.parentElement)) || null;
    const a = alsElement(bereich.startContainer);
    const b = alsElement(bereich.endContainer);
    const sa = a && a.closest(".wb-zeile-text");
    const sb = b && b.closest(".wb-zeile-text");
    if (!sa) return null;
    if (sb && sb !== sa) return null;
    return sa;
  }

  // Die aktuelle Markierung als ZEICHENBEREICH im Zeilentext lesen.
  // Gerechnet wird wie in caretOffset ueber die Textlaenge eines Teilbereichs
  // — nicht ueber node.textContent-Summen: der Span kann nach einer
  // Browser-Korrektur mehrere Textknoten haben, und dann stimmte jede
  // Abkuerzung nicht mehr. Liegt das Ende ausserhalb des Spans (Dreifachklick
  // nimmt den ganzen Absatz), wird auf die Textlaenge geklemmt.
  function markierungLesen(bereich, span) {
    const bis = (knoten, versatz) => {
      const r = document.createRange();
      r.selectNodeContents(span);
      try { r.setEnd(knoten, versatz); } catch { return span.textContent.length; }
      return r.toString().length;
    };
    const laenge = span.textContent.length;
    let von = klemm(bis(bereich.startContainer, bereich.startOffset), 0, laenge);
    let ende = klemm(bis(bereich.endContainer, bereich.endOffset), 0, laenge);
    if (ende < von) { const t = von; von = ende; ende = t; }
    return { von, bis: ende };
  }

  function markierungPruefen() {
    if (blaseAus || blaseZeigerUnten) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return blaseVerstecken();
    if (!String(sel).trim()) return blaseVerstecken();
    const bereich = sel.getRangeAt(0);
    const span = markierterSpan(bereich);
    if (!span) return blaseVerstecken();
    const zeile = span.closest(".wb-zeile");
    const ziel = zeileAufloesen(zeile);
    if (!ziel) return blaseVerstecken();
    const bereichImText = markierungLesen(bereich, span);
    markierung = { zeile, span, el: ziel.el, idx: ziel.idx, mobil: ziel.mobil,
                   von: bereichImText.von, bis: bereichImText.bis,
                   text: span.textContent.slice(bereichImText.von, bereichImText.bis) };
    blaseZeigen(zeile, bereich.getBoundingClientRect(), !!zeile.dataset.antwort);
  }

  // Was der Strich-Knopf wirklich streichen wuerde. Die Kanten werden von
  // Leerraum befreit: ein Dreifachklick und oft auch ein Doppelklick nehmen
  // das Leerzeichen hinter dem Wort mit — gestrichen sieht man es nicht, es
  // liesse den Bereich aber mit dem Nachbarwort verschmelzen, sobald man dort
  // auch streicht. Gestrichen wird, was man LIEST.
  function strichBereich(merk) {
    if (!merk || !merk.span || !merk.span.isConnected) return null;
    const text = merk.span.textContent;
    let von = klemm(merk.von, 0, text.length);
    let bis = klemm(merk.bis, 0, text.length);
    while (von < bis && /\s/.test(text[von])) von++;
    while (bis > von && /\s/.test(text[bis - 1])) bis--;
    return bis > von ? { von, bis, text } : null;
  }

  // Liegt die Markierung KOMPLETT unter einem Strich? Gelesen wird der DOM,
  // nicht das Modell: getippte Zeichen stehen dort schon, im Modell noch
  // nicht — und die Beschriftung des Knopfes muss zu dem passen, was man sieht.
  function markierungSchonGestrichen(merk) {
    const b = strichBereich(merk);
    if (!b) return false;
    const ganz = merk.zeile.classList.contains("wb-gestrichen") && b.text.length;
    return stricheDecken(ganz ? [[0, b.text.length]] : stricheAusDom(merk.span), b.von, b.bis);
  }

  function blaseZeigen(zeile, kasten, hatAntwort) {
    if (!kasten || (!kasten.width && !kasten.height)) return blaseVerstecken();
    const b = blaseBauen();
    const wort = hatAntwort ? "Antwort bearbeiten" : "Antworten";
    const s = $(".wb-blase-wort", b);
    if (s.textContent !== wort) s.textContent = wort;
    // Der Strich-Knopf sagt, was der Klick TUT: liegt die Markierung schon
    // ganz unter einem Strich, nimmt er ihn dort weg. Bleibt nach dem
    // Beschneiden nichts uebrig (reine Leerzeichen), gibt es nichts zu
    // streichen — dann tritt der Knopf ab, statt folgenlos dazustehen.
    const strichKnopf = $(".wb-blase-strich", b);
    const bereich = strichBereich(markierung);
    strichKnopf.hidden = !bereich;
    if (bereich) {
      const weg = markierungSchonGestrichen(markierung);
      const sw = $(".wb-blase-strich-wort", strichKnopf);
      const strichWort = weg ? "Strich weg" : "Durchstreichen";
      if (sw.textContent !== strichWort) sw.textContent = strichWort;
      strichKnopf.title = weg ? "Den Strich für dieses Stück wieder aufheben"
                              : "Nur das Markierte durchstreichen — der Rest der Zeile bleibt";
      strichKnopf.setAttribute("aria-label", strichKnopf.title);
    }
    b.hidden = false;
    blaseZeile = zeile;
    // Solange die Blase steht, tritt der Fokus-Chip ab: zwei Bernstein-Knoepfe
    // fuer dieselbe Sache in einer Zeile waeren einer zu viel.
    chipWeg();
    // Gerechnet wird gegen die WURZEL: die Blase haengt dort und kennt weder
    // Zoom noch Pan der Buehne — sie ist damit immer bildschirmgross.
    const w = wurzel.getBoundingClientRect();
    const bb = b.getBoundingClientRect();
    const luft = 10;
    // Auf dem Telefon legt der Browser seine eigene Auswahl-Leiste UEBER die
    // Markierung. Also weicht die Blase dort nach unten aus, statt sich mit
    // ihr zu ueberlagern. Nicht nur bei pointerType "touch": auf einem
    // schmalen Fenster gilt dasselbe, und die Geste kann von einem Stift
    // oder einer Maus am Touchgeraet gekommen sein.
    let unten = blaseTouch || istMobil();
    let y = unten ? (kasten.bottom - w.top + luft) : (kasten.top - w.top - bb.height - luft);
    if (!unten && y < 4) { unten = true; y = kasten.bottom - w.top + luft; }
    if (unten && y + bb.height > w.height - 4) { unten = false; y = kasten.top - w.top - bb.height - luft; }
    b.classList.toggle("wb-unten", unten);
    let x = kasten.left + kasten.width / 2 - w.left - bb.width / 2;
    x = klemm(x, 6, Math.max(6, w.width - bb.width - 6));
    y = klemm(y, 4, Math.max(4, w.height - bb.height - 4));
    b.style.left = Math.round(x) + "px";
    b.style.top = Math.round(y) + "px";
  }

  const markierungPlanen = () => {
    clearTimeout(blasePlan);
    // Kleine Verzoegerung: selectionchange feuert waehrend eines Doppelklicks
    // mehrfach (erst leer, dann das Wort). Ohne die Rast blitzte die Blase
    // zuerst an der falschen Stelle auf.
    blasePlan = setTimeout(markierungPruefen, 30);
  };

  document.addEventListener("selectionchange", markierungPlanen);
  // Capture, damit die Blase auch dann verschwindet, wenn ein anderer Handler
  // das Ereignis unterwegs anhaelt.
  document.addEventListener("pointerdown", (ev) => {
    blaseTouch = ev.pointerType === "touch";
    // Auf der Blase selbst passiert nichts — sonst raeumte der eigene Klick
    // sie weg, bevor er ankommt.
    if (blaseEl && blaseEl.contains(ev.target)) return;
    blaseZeigerUnten = true;
    // Nur eine Geste, die IM Zeilentext beginnt, kann eine Markierung machen.
    // Ohne diese Unterscheidung kam die Blase nach einem Klick ins Leere
    // sofort zurueck: der Klick auf die Wand LEERT die Markierung naemlich
    // nicht, die Pruefung nach dem Loslassen fand sie also unveraendert vor
    // (am 31.08. gemessen — "Klick woandershin" raeumte die Blase nicht weg).
    blaseZeigerImText = !!(ev.target.closest && ev.target.closest(".wb-zeile-text"));
    blaseAus = false;
    blaseVerstecken();
  }, true);
  // Loslassen heisst: jetzt steht die Markierung fest, jetzt darf gefragt
  // werden. pointercancel zaehlt dabei GENAUSO wie pointerup — beim Ziehen
  // ueber Text uebernimmt Chrome die Geste und bricht den Zeigerstrom mit
  // einem pointercancel ab; das pointerup kommt danach trotzdem, aber die
  // Sperre war schon gefallen. Wer hier nur auf pointerup hoerte und die
  // Sperre als Bedingung nahm, sah die Blase nach jedem ZIEHEN nie wieder
  // (gemessen am 31.08.: Doppelklick und Strg+A gingen, Ziehen nicht).
  const zeigerLos = () => {
    blaseZeigerUnten = false;
    if (blaseZeigerImText) markierungPlanen();
  };
  document.addEventListener("pointerup", zeigerLos, true);
  document.addEventListener("pointercancel", zeigerLos, true);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      // Escape heisst hier "lass mich in Ruhe": die Markierung bleibt oft
      // stehen, die Blase soll trotzdem weg — und nicht sofort wiederkommen.
      blaseAus = true;
      blaseVerstecken();
      return;
    }
    if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") return;
    // Beim Tippen verschwindet sie. Bei Tasten, die die Markierung erweitern
    // (Shift+Pfeil), holt selectionchange sie gleich wieder.
    blaseAus = false;
    blaseVerstecken();
  }, true);
  // Zoomen und Schieben verruecken die Markierung unter der Blase — sie steht
  // in Bildschirmkoordinaten und waere danach falsch.
  wurzel.addEventListener("wheel", () => blaseVerstecken(), { passive: true });

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
        <b></b>
        <button type="button" class="wb-mobil-fertig">Fertig</button>
      </div>
      <div class="wb-mobil-werkzeuge"></div>
      <div class="wb-mobil-zeilen"><div class="wb-zeilen"></div></div>`;
    // Der Titel des Blatts ist die Ueberschrift des Blocks — am Telefon
    // sieht man die Tafel dahinter nicht mehr, und "Textblock" saehe auf
    // jedem Block gleich aus. Ohne Einordnung bleibt es bei der Art.
    const katBlatt = kategorieVon(el.inhalt.kategorie);
    const titelBlatt = $(".wb-mobil-kopf b", blatt);
    titelBlatt.textContent = katBlatt ? kategorieTitel(katBlatt)
      : (el.art === "notiz" ? "Haftnotiz" : "Textblock");
    if (katBlatt) {
      titelBlatt.className = "wb-mobil-titel-kat";
      titelBlatt.style.setProperty("--kopf", katBlatt.kopf);
    }
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
      // Alt+A gilt auch im Blatt — ein Kuerzel, das nur an einem der beiden
      // Orte funktioniert, waere kein Kuerzel, sondern eine Falle.
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "KeyA") {
        ev.preventDefault();
        antwortWegOeffnen(zeile);
        return;
      }
      // Dieselben Regeln wie am Schreibtisch (17.09.2026), nur ohne Tab — ein
      // Telefon hat keine Tab-Taste, dafuer den Einruecken-Knopf an der Zeile.
      const istUnter = zeile.classList.contains("wb-unterpunkt");
      const ausruecken = () => { zeile.classList.remove("wb-unterpunkt"); delete zeile.dataset.ebene; };
      if (ev.key === "Enter") {
        ev.preventDefault();
        // Enter auf einem LEEREN Unterpunkt beendet die Stichpunkte: er wird
        // zur normalen Aufgabe, statt noch einen leeren Punkt anzuhaengen.
        if (istUnter && !span.textContent) { ausruecken(); return; }
        const neue = zeileBauen(true);
        // Wer in Stichpunkten schreibt, schreibt in Stichpunkten weiter.
        zeileFuellen(neue, Object.assign({ t: "", erledigt: false, gestrichen: false }, istUnter ? { ebene: 1 } : {}), true);
        zeile.after(neue);
        caretSetzen($(".wb-zeile-text", neue), 0);
      } else if (ev.key === "Backspace" && caretOffset(span) === 0 && istUnter && window.getSelection().isCollapsed) {
        // Erst ausruecken, dann (beim naechsten Druck) verbinden — wie in jeder
        // Textverarbeitung.
        ev.preventDefault();
        ausruecken();
      } else if (ev.key === "Backspace" && caretOffset(span) === 0 && !span.textContent
          && !zeile.previousElementSibling && zeile.nextElementSibling) {
        // Die LEERE ERSTE Zeile: darueber ist nichts, womit sie sich verbinden
        // koennte — frueher blieb ihr leeres Kaestchen deshalb fuer immer stehen.
        ev.preventDefault();
        const danach = zeile.nextElementSibling;
        zeile.remove();
        mobilErsteGerade();
        caretSetzen($(".wb-zeile-text", danach), 0);
      } else if (ev.key === "Backspace" && caretOffset(span) === 0 && zeile.previousElementSibling
          && window.getSelection().isCollapsed
          && !$(".wb-zeile-text", zeile.previousElementSibling).textContent) {
        // Die Zeile DARUEBER ist leer: sie geht, diese bleibt — mit Haken, Link
        // und Antwort. Verbinden hiesse, all das der leeren Zeile zu opfern.
        ev.preventDefault();
        zeile.previousElementSibling.remove();
        mobilErsteGerade();
        caretSetzen(span, 0);
      } else if (ev.key === "Backspace" && caretOffset(span) === 0 && zeile.previousElementSibling) {
        ev.preventDefault();
        const davor = $(".wb-zeile-text", zeile.previousElementSibling);
        const lang = davor.textContent.length;
        // Die KNOTEN umhaengen, nicht den Text kopieren: ein
        // "davor.textContent += …" plaettete beide Zeilen zu einem einzigen
        // Textknoten — die gestrichenen Stuecke waeren dabei stillschweigend
        // verschwunden, auf beiden Seiten.
        while (span.firstChild) davor.appendChild(span.firstChild);
        zeile.remove();
        caretSetzen(davor, lang);
      }
    });
    // Auch im Blatt gilt die Kanten-Regel: hinter einem gestrichenen Wort
    // weitergetippt wird NICHT mitgestrichen (siehe teilstricheNachfuehren).
    // Waehrend einer Komposition bleibt alles, wie es ist.
    blatt.addEventListener("input", (ev) => {
      const span = ev.target.closest(".wb-zeile-text");
      if (span && !ev.isComposing) teilstricheNachfuehren(span);
    });
    blatt.addEventListener("compositionend", (ev) => {
      const span = ev.target.closest && ev.target.closest(".wb-zeile-text");
      if (span) teilstricheNachfuehren(span);
    });
    blatt.addEventListener("click", (ev) => {
      const zeile = ev.target.closest(".wb-zeile");
      if (!zeile) return;
      if (ev.target.closest(".wb-zeile-link")) { ev.stopPropagation(); return; }
      if (ev.target.closest(".wb-zeile-antwort")) {
        ev.preventDefault();
        // Wie beim Verknuepfen: erst den getippten Stand ins Modell, sonst
        // antwortete man auf eine Zeile, die es so noch gar nicht gibt.
        mobilUebernehmen();
        antwortDialogOeffnen(el, zeilenIndex(zeile));
        return;
      }
      if (ev.target.closest(".wb-zeile-kette")) {
        ev.preventDefault();
        // Erst den getippten Stand ins Modell, sonst verknuepfte man eine
        // Zeile, die es so noch gar nicht gibt.
        mobilUebernehmen();
        linkDialogOeffnen(el, zeilenIndex(zeile));
        return;
      }
      // Im Blatt lebt der Zustand in den Klassen, nicht im Modell — "wartend"
      // ist aber abgeleitet (Antwort da UND weder abgehakt noch gestrichen).
      // Also nach jedem Umschalten neu bestimmen, sonst bliebe die
      // Bernstein-Pause im Kaestchen einer gerade abgehakten Zeile stehen.
      const wartenNachziehen = () => zeile.classList.toggle("wb-wartet",
        !!zeile.dataset.antwort
        && !zeile.classList.contains("wb-erledigt")
        && !zeile.classList.contains("wb-gestrichen"));
      if (ev.target.closest(".wb-abhaken")) {
        zeile.classList.toggle("wb-erledigt");
        const haken = $(".wb-haken", zeile);
        if (haken) haken.style.strokeDashoffset = zeile.classList.contains("wb-erledigt") ? "0" : "1";
        wartenNachziehen();
      } else if (ev.target.closest(".wb-zeile-streichen")) {
        zeile.classList.toggle("wb-gestrichen");
        wartenNachziehen();
      } else if (ev.target.closest(".wb-zeile-einruecken")) {
        // Unterpunkt ein/aus — im Blatt lebt auch das an Klasse und data-ebene
        // (mobilUebernehmen liest es von dort). Die erste Zeile bleibt, was sie ist.
        const wird = !zeile.classList.contains("wb-unterpunkt") && zeile !== liste.firstElementChild;
        zeile.classList.toggle("wb-unterpunkt", wird);
        if (wird) zeile.dataset.ebene = "1"; else delete zeile.dataset.ebene;
      } else if (ev.target.closest(".wb-zeile-weg")) {
        // Wie am Schreibtisch: eine Aufgabe nimmt ihre Unterpunkte mit — und
        // sagt es. Das Blatt kennt kein Strg+Z, also haengt das Zurueckholen
        // direkt am Toast: dieselben Knoten kommen an dieselbe Stelle.
        const weg = [zeile];
        if (!zeile.classList.contains("wb-unterpunkt")) {
          for (let n = zeile.nextElementSibling; n && n.classList.contains("wb-unterpunkt"); n = n.nextElementSibling) weg.push(n);
        }
        if (liste.children.length > weg.length) {
          const davor = weg[weg.length - 1].nextElementSibling;
          weg.forEach((n) => n.remove());
          mobilErsteGerade();
          const blattJetzt = blatt;
          toast(weg.length > 1
            ? "Aufgabe mit " + (weg.length - 1) + (weg.length === 2 ? " Unterpunkt" : " Unterpunkten") + " gelöscht."
            : "Zeile gelöscht.", {
            aktionText: "Rückgängig",
            aktion: () => {
              if (!mobilOffen || mobilOffen.blatt !== blattJetzt) return;
              const vor = davor && davor.parentNode === liste ? davor : null;
              weg.forEach((n) => liste.insertBefore(n, vor));
              mobilErsteGerade();
            },
          });
        } else {
          // Letzte Zeile: sie bleibt, wird aber wirklich LEER — mit der
          // Aufgabe geht auch ihre Antwort, sonst haenge die Antwort an
          // einer Zeile, die es nicht mehr gibt.
          $(".wb-zeile-text", zeile).textContent = "";
          zeileFuellen(zeile, { t: "", erledigt: false, gestrichen: false }, true);
        }
      }
    });
    // Doppelklick (bzw. Doppeltipp) auf eine vorhandene Antwort bearbeitet sie
    // — derselbe Weg wie am Board.
    blatt.addEventListener("dblclick", (ev) => {
      const antwort = ev.target.closest(".wb-antwort");
      if (!antwort) return;
      ev.preventDefault();
      antwortWegOeffnen(antwort.closest(".wb-zeile"));
    });
    // Die erste Zeile ist nie ein Unterpunkt (es gaebe nichts, worunter sie
    // stuende). Rutscht einer nach oben, wird er zur Aufgabe — sichtbar sofort,
    // nicht erst nach "Fertig".
    function mobilErsteGerade() {
      const erste = liste.firstElementChild;
      if (!erste || !erste.classList.contains("wb-unterpunkt")) return;
      erste.classList.remove("wb-unterpunkt");
      delete erste.dataset.ebene;
    }
    $(".wb-mobil-fertig", blatt).addEventListener("click", mobilSchliessen);
    // Wie am Board: Abhaken/Zeilenwerkzeuge klauen der aktiven Zeile
    // nicht den Fokus (Tastatur bliebe sonst nicht offen). Die Antwort steht
    // aus demselben Grund mit in der Liste — sie ist zum Antippen da.
    blatt.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".wb-abhaken,.wb-zeile-tools,.wb-antwort")) ev.preventDefault();
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
      const span = $(".wb-zeile-text", zeile);
      const neu = {
        t: span.textContent.slice(0, DATEN.grenzen.zeichenJeZeile),
        erledigt: zeile.classList.contains("wb-erledigt"),
        gestrichen: zeile.classList.contains("wb-gestrichen") && !zeile.classList.contains("wb-erledigt"),
      };
      // Die Teilstriche stehen als eigene Knoten IM Zeilentext und werden von
      // dort abgelesen — genau wie am Board (blockSerialisieren). Aus dem
      // Blatt heraus getippt bleiben sie damit an denselben Woertern.
      stricheAblegen(neu, stricheAusDom(span));
      // Der Link steht im Anker der Zeile — er ueberlebt Umsortieren und
      // Loeschen dadurch genauso wie Haken und Streichung.
      const anker = $(".wb-zeile-link", zeile);
      const ziel = anker && anker.getAttribute("href");
      if (ziel && LINK_ERLAUBT.test(ziel)) neu.link = ziel;
      // Die Antwort haengt am Zeilenknoten (zeileFuellen setzt sie dort) und
      // ueberlebt Umsortieren und Loeschen damit genauso wie Haken und Link.
      if (zeile.dataset.antwort) neu.antwort = zeile.dataset.antwort;
      // Und der Aufgaben-Bezug aus dem CRM — aus demselben Grund.
      if (zeile.dataset.aufgabe) neu.aufgabe = Number(zeile.dataset.aufgabe);
      // Unterpunkt bleibt Unterpunkt (nur nicht als allererste Zeile).
      if (zeile.dataset.ebene === "1" && zeilen.length > 0) neu.ebene = 1;
      zeilen.push(neu);
    }
    el.inhalt.zeilen = zeilen.length ? zeilen.slice(0, DATEN.grenzen.zeilen)
      : [{ t: "", erledigt: false, gestrichen: false }];
  }

  // Nach Kasten-Aenderungen die Blatt-Ansicht nachziehen.
  function mobilAnsichtAuffrischen() {
    if (!mobilOffen) return;
    const { el, liste, blatt } = mobilOffen;
    liste.dataset.liste = el.inhalt.liste;
    liste.style.fontSize = Math.max(el.inhalt.groesse, 24) + "px";
    liste.style.color = tinte(el.inhalt.farbe);
    // Die Ueberschrift im Blatt-Titel zieht mit: wer hier einordnet, sieht
    // sofort, in welchem Block er gerade schreibt.
    const kat = kategorieVon(el.inhalt.kategorie);
    const t = $(".wb-mobil-kopf b", blatt);
    if (t) {
      t.textContent = kat ? kategorieTitel(kat)
        : (el.art === "notiz" ? "Haftnotiz" : "Textblock");
      t.className = kat ? "wb-mobil-titel-kat" : "";
      if (kat) t.style.setProperty("--kopf", kat.kopf);
    }
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
    // Wie am Schreibtisch: die leere Haftnotiz bleibt, der leere Textblock
    // geht — und ein eingeordneter Block bleibt ebenfalls (siehe die
    // ausfuehrliche Begruendung am Schreibtisch-Zweig weiter oben).
    if (el.art !== "notiz" && !el.inhalt.kategorie
        && el.inhalt.zeilen.every((z) => !z.t.trim())) {
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
    if (ev.target.closest(".wb-abhaken,.wb-zeile-tools,.wb-zeile-link,.wb-kasten,.wb-griff,.wb-zeile-griff,.wb-groesse-griff")) return;
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
    tinteNeu();
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
    // Die Markier-Blase und der Fokus-Chip: sichtbar? mit welchem Wort? an
    // welcher Zeile? Beide sind fluechtige Anzeigen — ohne diesen Blick
    // muesste ein Test sie ueber Bildpunkte suchen.
    get blase() {
      if (!blaseEl || blaseEl.hidden) return null;
      const r = blaseEl.getBoundingClientRect();
      return { text: blaseEl.textContent, x: r.x, y: r.y, breite: r.width, hoehe: r.height,
               zeile: blaseZeile && blaseZeile.parentElement ? zeilenIndex(blaseZeile) : -1 };
    },
    // Der markierte ZEICHENBEREICH der aktuellen Blase (siehe markierungLesen):
    // Zeile, Index und von/bis als Offsets im Zeilentext.
    get markierung() {
      if (!blaseEl || blaseEl.hidden || !markierung) return null;
      return { idx: markierung.idx, von: markierung.von, bis: markierung.bis,
               text: markierung.text, id: markierung.el ? markierung.el.id : null };
    },
    get chip() {
      if (!chipEl || !chipEl.parentElement) return null;
      const r = chipEl.getBoundingClientRect();
      return { text: chipEl.textContent, x: r.x, y: r.y, breite: r.width, hoehe: r.height,
               zeile: zeilenIndex(chipEl.parentElement) };
    },
    // Welche Nachbar-Pfeile stehen gerade zur Verfuegung?
    get pfeile() {
      return RICHTUNGEN.filter((r) => !$(".wb-pfeil-" + r, pfeileEl).hidden);
    },
    // Laeuft gerade eine Abgabe? Welches Ziel steht am Zeiger?
    get abgabe() {
      if (!abgabe) return null;
      return { id: abgabe.el.id, zeile: abgabe.idx, kategorie: abgabe.kat,
               ziel: abgabe.ziel, zielBlock: abgabe.zielBlock ? abgabe.zielBlock.id : null,
               hinweis: abgabeGeist ? abgabeGeist.textContent : "" };
    },
    // Fuer Tests: kompakter Blick auf ein Board (das TAFEL-Board).
    stand(tafel) {
      return [...elemente.values()]
        .filter((e) => tafelVon(e) === (tafel || ich.id))
        .map((e) => ({ id: e.id, art: e.art, version: e.version,
                       besitzer: e.besitzer, tafel: tafelVon(e),
                       kategorie: e.inhalt.kategorie || "",
                       ueberschrift: istUeberschrift(e),
                       // Traegt der Block die Ueberschrift seiner Kategorie
                       // ("1 · Kunden"), und was steht darin? Und ist er
                       // eine ausgeblendete Alt-Ueberschrift?
                       kopfblock: !!(elementKnoten.get(e.id)
                         && elementKnoten.get(e.id).classList.contains("wb-kopfblock")),
                       altkopf: !!(elementKnoten.get(e.id)
                         && elementKnoten.get(e.id).classList.contains("wb-altkopf")),
                       kopf: (() => {
                         const k = elementKnoten.get(e.id);
                         const h = k && k.querySelector(".wb-blockkopf");
                         return h && k.classList.contains("wb-kopfblock") ? h.textContent : "";
                       })(),
                       x: e.x, y: e.y, breite: e.breite, hoehe: e.hoehe,
                       punkte: e.inhalt.punkte ? e.inhalt.punkte.length : 0,
                       links: e.inhalt.zeilen ? e.inhalt.zeilen.map((z) => z.link || "") : [],
                       // Die Antwort steht neben dem Link, weil sie dasselbe
                       // ist: ein Metadatum je Zeile, das nicht im Text steht.
                       antworten: e.inhalt.zeilen ? e.inhalt.zeilen.map((z) => z.antwort || "") : [],
                       // Teilstriche je Zeile. Die GANZ gestrichene Zeile
                       // meldet sich als "ganz" — sie ist derselbe Zustand,
                       // nur ueber den ganzen Text.
                       striche: e.inhalt.zeilen
                         ? e.inhalt.zeilen.map((z) => (z.gestrichen ? "ganz" : (z.striche || []))) : [],
                       zeilen: e.inhalt.zeilen ? e.inhalt.zeilen.map((z) => (z.erledigt ? "[x] " : "[ ] ") + z.t) : e.inhalt.punkte.length }));
    },
  };
})();
