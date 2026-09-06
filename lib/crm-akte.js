// lib/crm-akte.js — Die Kundenakte in Kategorien und Zeilen (05.09.2026).
//
// Warum eine eigene Datei: Die Akte war in crm-routes.js ein 780-Zeilen-
// Template am Stueck — elf verschieden hohe Karten, rund vierzig Felder auf
// einmal. Lukas: "zu unuebersichtlich, zu viele Felder". Jetzt gibt es acht
// KATEGORIEN (Segment oben, genau eine sichtbar) und darin GRUPPEN mit
// ZEILEN: Beschriftung oben, Wert darunter. Welche optionalen Zeilen eine
// Akte zeigt, waehlt man je Kategorie ueber "Zeilen" — die Wahl liegt an der
// Firma (firmen.akte_zeilen, Migration 0057).
//
// Die Datei hat zwei Haelften:
//   1. REINE LOGIK ohne Datenbank — Zeilenliste, Sichtbarkeit, Pipeline-Regel.
//      Getestet in scripts/test-akte.js (laeuft in pruefen.js vor jedem Push).
//   2. RENDERING der Akte und des "Neuer Kunde"-Blatts als Template-Strings
//      mit den Bausteinen aus public/os-ui.css (Leitfaden 01-design.md).
//      Die Konstanten des CRM (SPARTEN, BRANCHEN, QUELLEN …) kommen vom
//      Aufrufer im ctx mit — hier gibt es keine zweite Kopie davon.
//
// Speichern bleibt EIN Formular (#akte) mit "dabei"-Markern je Abschnitt,
// genau wie bisher: Der POST-Handler in crm-routes.js weiss daran, welche
// Abschnitte auf der Seite standen. Alle Kategorien liegen im DOM (die nicht
// gewaehlten nur hidden), darum werden alle Felder mitgeschickt. Optionale
// Zeilen sind nur dann ausgeblendet, wenn sie LEER sind — ein leeres Feld,
// das leer zurueckkommt, loescht nichts. Das ist der Grund, warum die
// Zeilenwahl ohne Aenderung am Speicherweg auskommt.

const fs = require("fs");
const path = require("path");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Cache-Stempel wie in lib/schale.js — dieselbe Idee, eigene kleine Kopie,
// weil schale.js die Funktion nicht exportiert.
const stempel = new Map();
function v(datei) {
  const jetzt = Date.now();
  const c = stempel.get(datei);
  if (c && jetzt - c.geprueft < 5000) return c.url;
  let url = datei;
  try {
    const st = fs.statSync(path.join(__dirname, "..", "public", datei.replace(/^\//, "")));
    url = `${datei}?v=${Math.round(st.mtimeMs).toString(36)}`;
  } catch { /* Datei fehlt: ohne Stempel */ }
  stempel.set(datei, { url, geprueft: jetzt });
  return url;
}

// =====================================================================
// 1. REINE LOGIK
// =====================================================================

// Die acht Kategorien in der Reihenfolge des Segments.
const KATEGORIEN = [
  { id: "ueberblick", titel: "Überblick" },
  { id: "kontakt", titel: "Kontakt" },
  { id: "firma", titel: "Firma" },
  { id: "geld", titel: "Auftrag & Geld" },
  { id: "stand", titel: "Projekt & Stand" },
  { id: "aufgaben", titel: "Aufgaben & Termine" },
  { id: "dokumente", titel: "Dokumente" },
  { id: "verlauf", titel: "Verlauf" },
];

// Die Zeilen je Kategorie. Eine Zeile ist ENTWEDER pflicht (immer da), ODER
// sie wird gezeigt, wenn eines ihrer Felder einen Wert hat, ODER wenn sie in
// akte_zeilen gewaehlt ist. "nur" schraenkt auf eine Lage ein (nur Kunde, nur
// Webdesign …) — eine Zeile, die es in dieser Lage nicht gibt, ist weder
// sichtbar noch waehlbar.
//
// Was hier NICHT mehr steht (Lukas: "zu viele Infos"), aber als Spalte
// bleibt: temperatur (intern, steuert Listen), projekt_stand (Altfeld, durch
// die Projektphase ersetzt), versuche/wiedervorlage (gehoeren zur Anrufliste).
// geschlecht ist nur noch die optionale Zeile "Anrede" — das Avatar-Bild ist
// weg.
const ZEILEN = {
  kontakt: [
    { id: "ansprechperson", gruppe: "Ansprechperson", label: "Ansprechperson", pflicht: true, felder: ["ansprech_name"] },
    { id: "position", gruppe: "Ansprechperson", label: "Position", felder: ["ansprech_rolle"] },
    { id: "anrede", gruppe: "Ansprechperson", label: "Anrede", felder: ["geschlecht"] },
    { id: "telefon", gruppe: "Erreichbar", label: "Telefon", pflicht: true, felder: ["telefon"] },
    { id: "mobil", gruppe: "Erreichbar", label: "Mobil", felder: ["mobil"] },
    { id: "email", gruppe: "Erreichbar", label: "E-Mail", pflicht: true, felder: ["email"] },
    { id: "website", gruppe: "Erreichbar", label: "Website", felder: ["website"] },
    { id: "kontakt_kanaele", gruppe: "Erreichbar", label: "Kontakt bevorzugt über", felder: ["kontakt_kanaele"] },
    { id: "adresse", gruppe: "Adresse", label: "Straße und Hausnummer", felder: ["adresse"] },
    { id: "plz_ort", gruppe: "Adresse", label: "PLZ und Ort", felder: ["plz", "ort"] },
  ],
  firma: [
    { id: "branche", gruppe: "Die Firma", label: "Branche", pflicht: true, felder: ["branche"] },
    { id: "taetigkeit", gruppe: "Die Firma", label: "Tätigkeit", felder: ["taetigkeit"] },
    { id: "mitarbeiter_zahl", gruppe: "Die Firma", label: "Mitarbeiterzahl", felder: ["mitarbeiter_zahl"] },
    // Nur lesen und nur, wenn vorhanden — kommt aus dem Lead-Import.
    { id: "argumente", gruppe: "Die Firma", label: "Verkaufsargumente", felder: ["argumente"], nurLesen: true },
    { id: "besitzer", gruppe: "Zuständigkeit", label: "Verantwortlich", pflicht: true, felder: ["besitzer"] },
    { id: "gewonnen_durch", gruppe: "Zuständigkeit", label: "Gewonnen durch", felder: ["gewonnen_durch"] },
    { id: "quelle", gruppe: "Zuständigkeit", label: "Quelle", felder: ["quelle"] },
    { id: "notizen", gruppe: "Notizen", label: "Notizen", felder: ["notizen"] },
  ],
  geld: [
    { id: "umsatz_geschaetzt", gruppe: "Umsatz", label: "Umsatz geschätzt", pflicht: true, felder: ["umsatz_geschaetzt"] },
    { id: "umsatz_geplant", gruppe: "Umsatz", label: "Umsatz geplant", pflicht: true, felder: ["umsatz_geplant"] },
    { id: "preis_setup", gruppe: "Vereinbart", label: "Setup-Preis (einmalig)", felder: ["preis_setup"] },
    { id: "preis_monatlich", gruppe: "Vereinbart", label: "Retainer pro Monat", felder: ["preis_monatlich"] },
    { id: "vertrag_laufzeit", gruppe: "Vereinbart", label: "Laufzeit", felder: ["vertrag_laufzeit"] },
    { id: "erfolgsbonus", gruppe: "Vereinbart", label: "Erfolgsbonus", felder: ["erfolgsbonus", "erfolgsbonus_text"] },
    { id: "kunde_seit", gruppe: "Vereinbart", label: "Kunde seit", felder: ["kunde_seit"], nur: (c) => c.istKunde },
    { id: "vertrag_unterschrieben", gruppe: "Vereinbart", label: "Vertrag unterschrieben", felder: ["vertrag_unterschrieben"], nur: (c) => c.istKunde },
    { id: "leistungen", gruppe: "Vereinbart", label: "Leistungen", felder: ["leistungen"] },
    { id: "hosting", gruppe: "Vereinbart", label: "Hosting", felder: ["hosting"], nur: (c) => c.sparte === "webdesign" },
    { id: "leads", gruppe: "Vereinbart", label: "Leads Ziel / Ist", felder: ["leads_ziel", "leads_ist"], nur: (c) => c.sparte === "performance" },
    // Die Altfelder bleiben funktional (sie buchen weiter Einnahmen, siehe
    // crm.einnahmeAusAkte), sind aber nur noch zu sehen, wenn gesetzt oder
    // gewaehlt — der Zahlstand kommt jetzt aus echten Rechnungen.
    { id: "rechnung_stand", gruppe: "Vereinbart", label: "Zahlungsstand Setup (alt)", felder: ["rechnung_stand"], nur: (c) => c.istKunde },
    { id: "retainer_monate_bezahlt", gruppe: "Vereinbart", label: "Retainer-Monate bezahlt (alt)", felder: ["retainer_monate_bezahlt"], nur: (c) => c.istKunde },
  ],
  stand: [
    { id: "projekt_stufe", gruppe: "Wo es steht", label: "Projektphase", pflicht: true, felder: ["projekt_stufe"], nur: (c) => c.istKunde },
    { id: "score", gruppe: "Wo es steht", label: "Kaufwahrscheinlichkeit", pflicht: true, felder: ["score"], nur: (c) => !c.istKunde },
    { id: "naechste_aufgabe", gruppe: "Wo es steht", label: "Nächste Aufgabe", pflicht: true, felder: ["naechste_aufgabe"] },
    { id: "dringlichkeit", gruppe: "Wo es steht", label: "Dringlichkeit", felder: ["dringlichkeit"] },
    { id: "faellig_am", gruppe: "Wo es steht", label: "Fällig bis", felder: ["faellig_am"] },
    { id: "umgesetzt", gruppe: "Umgesetzt", label: "Umgesetzt", felder: ["umgesetzt"] },
  ],
  aufgaben: [
    { id: "erstgespraech_am", gruppe: "Termine", label: "Erstgespräch am", felder: ["erstgespraech_am"] },
    { id: "naechster_termin", gruppe: "Termine", label: "Nächster Termin", felder: ["naechster_termin"] },
  ],
};
// Jede Zeile traegt "gruppe": Das Popover "Zeilen" listet sie so gegliedert,
// wie die Gruppen auf der Seite stehen — und eine Gruppe, deren Zeilen alle
// ausgeblendet sind, verschwindet mit (Pruefung 05.09.2026: "Vereinbart"
// zeigte nur Titel und Fussnote).

// Hat ein Feld einen Wert, der die Zeile sichtbar macht? Leer heisst: null,
// undefined, leerer Text, leere Liste — und beim Retainer-Zaehler die 0, weil
// die Spalte NOT NULL DEFAULT 0 ist und "0 von 3 bezahlt" kein Eintrag ist.
// false (etwa hosting = "Nein") IST ein Wert: jemand hat Nein gesagt.
function hatWert(f, feld) {
  const w = (f || {})[feld];
  if (w === null || w === undefined) return false;
  if (typeof w === "string") return w.trim() !== "";
  if (Array.isArray(w)) return w.length > 0;
  if (typeof w === "number") return feld === "retainer_monate_bezahlt" ? w > 0 : true;
  return true;
}

// Die Zeilen einer Kategorie in dieser Lage (nur-Filter angewandt).
function zeilenFuer(kategorie, ctx = {}) {
  return (ZEILEN[kategorie] || []).filter((z) => !z.nur || z.nur(ctx));
}

// Welche Zeilen einer Kategorie sichtbar sind — und welche man waehlen kann.
//   sichtbar : Set der Zeilen-ids, die gezeigt werden
//   waehlbar : [{ id, label, gewaehlt, hatWert }] — die optionalen Zeilen
//              fuer das Popover ("hat einen Wert" ist dort nicht abwaehlbar)
function zeilenSichtbar(kategorie, f, ctx = {}) {
  const gewaehlt = new Set((((f || {}).akte_zeilen || {})[kategorie]) || []);
  const sichtbar = new Set();
  const waehlbar = [];
  for (const z of zeilenFuer(kategorie, ctx)) {
    const mitWert = z.felder.some((feld) => hatWert(f, feld));
    if (z.pflicht || mitWert || gewaehlt.has(z.id)) sichtbar.add(z.id);
    // Nur-lesen-Zeilen (Verkaufsargumente) gibt es nur, wenn sie einen Wert
    // haben — waehlen kann man sie nicht, es gaebe nichts einzutragen.
    if (!z.pflicht && !z.nurLesen) waehlbar.push({ id: z.id, label: z.label, gewaehlt: gewaehlt.has(z.id), hatWert: mitWert });
  }
  return { sichtbar, waehlbar };
}

// Eingabe aus dem Browser gegen die Zeilenliste pruefen: nur optionale
// Zeilen der Kategorie, jede einmal, in der Reihenfolge der Liste. null,
// wenn es die Kategorie nicht gibt oder sie keine waehlbaren Zeilen hat.
function zeilenPruefen(kategorie, zeilen) {
  const alle = ZEILEN[kategorie];
  if (!alle) return null;
  const erlaubt = alle.filter((z) => !z.pflicht && !z.nurLesen).map((z) => z.id);
  if (!erlaubt.length) return null;
  const gewuenscht = new Set((Array.isArray(zeilen) ? zeilen : []).map((x) => String(x)));
  return erlaubt.filter((id) => gewuenscht.has(id));
}

// Was der POST-Handler mit einem Auswahlfeld macht (Pruefung 05.09.2026):
//   undefined  -> Feld kam nicht mit: unangetastet lassen
//   ""         -> "— offen —" gewaehlt: loeschen
//   in erlaubt -> uebernehmen
//   sonst      -> Altbestand, den die Liste nicht kennt (quelle='manuell',
//                 ansprech_rolle='Inhaberin'): unangetastet lassen. Vorher
//                 wurde er auf "" gesetzt, und ein Speichern ohne Aenderung
//                 loeschte damit Bestand.
// Rueckgabe undefined heisst: nichts schreiben.
function auswahlWert(wert, erlaubt) {
  if (wert === undefined || wert === null) return undefined;
  const w = String(wert);
  if (w === "") return "";
  return (erlaubt || []).map(String).includes(w) ? w : undefined;
}

// --- Die Umsatz-Regel (siehe Kommentar in lib/crm.js ueber pipelineVolumen) ---
//
// Beitrag einer Firma zur Pipeline:
//   status nicht lead/kunde            -> 0
//   schon eine Rechnung gestellt       -> 0 (zaehlt unter festem Umsatz)
//   umsatz_geplant > 0                 -> geplant
//   sonst umsatz_geschaetzt > 0        -> geschaetzt
//   sonst Summe offener Deal-Werte > 0 -> geschaetzt (Quelle "deals")
//   sonst                              -> 0
// Rueckgabe { betrag, art: "geplant" | "geschaetzt" | null, quelle }.
function pipelineBeitrag(f) {
  const z = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  if (!f || !["lead", "kunde"].includes(f.status)) return { betrag: 0, art: null, quelle: "status" };
  if (z(f.rechnungen_gestellt) > 0) return { betrag: 0, art: null, quelle: "rechnung" };
  if (z(f.umsatz_geplant) > 0) return { betrag: z(f.umsatz_geplant), art: "geplant", quelle: "umsatz_geplant" };
  if (z(f.umsatz_geschaetzt) > 0) return { betrag: z(f.umsatz_geschaetzt), art: "geschaetzt", quelle: "umsatz_geschaetzt" };
  if (z(f.deals_offen) > 0) return { betrag: z(f.deals_offen), art: "geschaetzt", quelle: "deals" };
  return { betrag: 0, art: null, quelle: "leer" };
}

// Pipeline-Volumen ueber viele Firmen: { gesamt, geplant, geschaetzt, anzahl }.
// anzahl = Firmen, die etwas beitragen.
function pipelineSumme(firmen) {
  const s = { gesamt: 0, geplant: 0, geschaetzt: 0, anzahl: 0 };
  for (const f of firmen || []) {
    const b = pipelineBeitrag(f);
    if (!b.betrag) continue;
    s.gesamt += b.betrag;
    s[b.art] += b.betrag;
    s.anzahl += 1;
  }
  return s;
}

// Wie viel Prozent der gestellten Rechnungen bezahlt sind — null ohne
// Rechnungen, damit die Anzeige "—" sagt statt "0 % bezahlt".
function bezahltProzent(r) {
  const g = Number((r || {}).gestellt) || 0, b = Number((r || {}).bezahlt) || 0;
  if (g <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((b / g) * 100)));
}

// Abschlagsrechnungen lesbar machen: "Abschlag 1 von 2". Die Gesamtzahl je
// Auftrag (abschlag_von) wird aus der Liste gezaehlt.
function abschlagText(r, liste) {
  if (!r || !r.abschlag_nr) return "";
  const von = r.abschlag_von;
  const n = von ? (liste || []).filter((x) => x.abschlag_von === von && x.abschlag_nr).length : 0;
  return n > 1 ? `Abschlag ${r.abschlag_nr} von ${n}` : `Abschlag ${r.abschlag_nr}`;
}

// =====================================================================
// 2. RENDERING
// =====================================================================

// Statuspille einer Rechnung/eines Angebots aus lib/rechnungen.js (D1).
const RECHNUNG_PILLE = {
  entwurf: ["", "Entwurf"], gestellt: ["os-pille--blau", "Gestellt"], teilbezahlt: ["os-pille--bernstein", "Teilbezahlt"],
  bezahlt: ["os-pille--gruen", "Bezahlt"], storniert: ["os-pille--rot", "Storniert"],
  angenommen: ["os-pille--gruen", "Angenommen"], abgelehnt: ["os-pille--rot", "Abgelehnt"],
};
const rechnungPille = (status) => {
  const [klasse, text] = RECHNUNG_PILLE[status] || ["", status || "—"];
  return `<span class="os-pille ${klasse} os-pille--punkt">${e(text)}</span>`;
};

// ---- Zeilen-Bausteine ------------------------------------------------
// Jede Zeile traegt data-zeile (fuer das Ein-/Ausblenden per Popover) und
// data-fest="1", wenn sie nicht abwaehlbar ist (Pflicht oder mit Wert).
function zeileAttr(z, sicht) {
  const sichtbar = sicht.sichtbar.has(z.id);
  const fest = z.pflicht || z.nurLesen || (sicht.waehlbar.find((w) => w.id === z.id) || {}).hatWert;
  return `data-zeile="${z.id}"${fest ? ' data-fest="1"' : ""}${sichtbar ? "" : " hidden"}`;
}
function zEingabe(z, sicht, inhalt, { label, hilfe } = {}) {
  return `<label class="os-zeile os-zeile--eingabe" ${zeileAttr(z, sicht)}>
    <span class="os-zeile-label">${e(label || z.label)}</span>
    <div class="os-zeile-wert">${inhalt}</div>${hilfe ? `<span class="os-zeile-hilfe">${hilfe}</span>` : ""}
  </label>`;
}
function zPaar(z, sicht, teile) {
  return `<div class="os-zeile os-zeile--eingabe os-zeile--paar" ${zeileAttr(z, sicht)}>
    ${teile.map(([label, inhalt]) => `<label class="os-zeile-teil"><span class="os-zeile-label">${e(label)}</span>
      <div class="os-zeile-wert">${inhalt}</div></label>`).join("")}
  </div>`;
}
function zText(z, sicht, inhalt, { label, leer = "Noch nicht eingetragen" } = {}) {
  return `<div class="os-zeile os-zeile--text" ${zeileAttr(z, sicht)}>
    <span class="os-zeile-label">${e(label || z.label)}</span>
    <div class="os-zeile-wert" data-leer="${e(leer)}">${inhalt}</div>
  </div>`;
}
function zChips(z, sicht, name, werte, gewaehlt, { label, hilfe } = {}) {
  return `<div class="os-zeile os-zeile--chips" ${zeileAttr(z, sicht)}>
    <span class="os-zeile-label">${e(label || z.label)}</span>
    <div class="os-zeile-wert"><div class="os-chips">
      ${/* Gewaehlte Werte, die die Liste nicht kennt (aus einem anderen Bereich),
           stehen als angehakte Chips mit drin — sonst gingen sie beim Speichern
           verloren, weil nur angehakte Chips zurueckkommen. */""}
      ${[...werte, ...gewaehlt.filter((g) => !werte.includes(g))].map((w) => `<label class="os-chip"><input form="akte" type="checkbox" name="${name}" value="${e(w)}"${gewaehlt.includes(w) ? " checked" : ""}> ${e(w)}</label>`).join("")}
    </div></div>${hilfe ? `<span class="os-zeile-hilfe">${hilfe}</span>` : ""}
  </div>`;
}
// Einfache Lese-Zeile ohne Zeilenwahl (Ueberblick).
function lese(label, inhalt, leer = "—") {
  return `<div class="os-zeile os-zeile--text"><span class="os-zeile-label">${e(label)}</span>
    <div class="os-zeile-wert" data-leer="${e(leer)}">${inhalt}</div></div>`;
}
// Auswahl aus einer Liste mit "— offen —" oben. Ein gespeicherter Wert, den
// die Liste nicht kennt (Altbestand), wird als eigene, gewaehlte Option
// gerendert — so kommt er beim Speichern unveraendert zurueck, statt still
// auf "— offen —" zu fallen (Pruefung 05.09.2026). fremdText beschriftet
// ihn, wenn der Wert selbst nichts sagt (eine uuid).
function auswahl(name, werte, aktuell, { leerText = "— offen —", schluessel = false, fremdText = "" } = {}) {
  const jetzt = aktuell === null || aktuell === undefined ? "" : String(aktuell);
  const liste = werte.map((w) => (schluessel ? w : [w, w]));
  const bekannt = liste.some(([wert]) => String(wert) === jetzt);
  const fremd = jetzt && !bekannt ? `<option value="${e(jetzt)}" selected>${e(fremdText || jetzt)}${fremdText ? "" : " (Altbestand)"}</option>` : "";
  const optionen = liste.map(([wert, text]) => `<option value="${e(wert)}"${String(wert) === jetzt ? " selected" : ""}>${e(text)}</option>`);
  return `<select form="akte" name="${name}"><option value=""${jetzt ? "" : " selected"}>${e(leerText)}</option>${fremd}${optionen.join("")}</select>`;
}
const jaNein = (name, wert, jaText = "Ja", neinText = "Nein") =>
  `<select form="akte" name="${name}">
    <option value=""${wert === null || wert === undefined ? " selected" : ""}>— offen —</option>
    <option value="ja"${wert === true ? " selected" : ""}>${e(jaText)}</option>
    <option value="nein"${wert === false ? " selected" : ""}>${e(neinText)}</option></select>`;
const eingabe = (name, wert, { typ = "text", platz = "", extra = "" } = {}) =>
  `<input form="akte" type="${typ}" name="${name}" value="${e(wert ?? "")}"${platz ? ` placeholder="${e(platz)}"` : ""} ${extra}>`;
const betrag = (name, wert) =>
  `<input form="akte" type="number" step="1" min="0" inputmode="decimal" name="${name}" value="${wert === null || wert === undefined ? "" : Math.round(Number(wert))}" placeholder="0 €">`;

// Das "Zeilen"-Werkzeug einer Kategorie: sitzt oben rechts an der Kategorie
// und listet die optionalen Zeilen gegliedert nach Gruppe — auch die einer
// Gruppe, die gerade ganz ausgeblendet ist, bleibt so erreichbar.
function zeilenWerkzeug(kategorie, sicht) {
  if (!sicht.waehlbar.length) return "";
  const gruppen = [];
  for (const z of ZEILEN[kategorie] || []) {
    const w = sicht.waehlbar.find((x) => x.id === z.id);
    if (!w) continue;
    let g = gruppen.find((x) => x.name === (z.gruppe || ""));
    if (!g) { g = { name: z.gruppe || "", zeilen: [] }; gruppen.push(g); }
    g.zeilen.push(w);
  }
  const abschnitt = (g, i) => `${i ? '<div class="os-popover-trenner"></div>' : ""}
      ${g.name ? `<div class="akte2-popover-gruppe">${e(g.name)}</div>` : ""}
      ${g.zeilen.map((w) => `<label><input type="checkbox" value="${w.id}"${w.gewaehlt || w.hatWert ? " checked" : ""}${w.hatWert ? " disabled" : ""}> ${e(w.label)}${w.hatWert ? ' <small class="akte2-zeilen-wert">hat einen Wert</small>' : ""}</label>`).join("")}`;
  return `<span class="os-popover-anker">
    <button type="button" class="still klein akte2-zeilen-knopf" aria-expanded="false" aria-controls="pop-${kategorie}" onclick="osPopover(this)">Zeilen</button>
    <div class="os-popover os-popover--rechts akte2-popover" id="pop-${kategorie}" hidden role="dialog" aria-label="Zeilen wählen" data-kategorie="${kategorie}">
      <div class="os-popover-kopf">Zeilen einblenden</div>
      <div class="os-popover-liste">${gruppen.map(abschnitt).join("")}</div>
      <div class="os-popover-fuss"><span class="caption akte2-zeilen-stand" aria-live="polite"></span>
        <button type="button" class="sekundaer klein" onclick="osPopover(this.closest('.os-popover-anker').querySelector('[aria-controls]'))">Fertig</button></div>
    </div></span>`;
}
// Die Kopfzeile einer Kategorie mit dem Werkzeug rechts. Leer, wenn es in der
// Kategorie nichts zu waehlen gibt (Ueberblick, Dokumente, Verlauf).
function katKopf(kategorie, sicht) {
  const werkzeug = zeilenWerkzeug(kategorie, sicht);
  if (!werkzeug) return "";
  return `<div class="akte2-kat-kopf"><span class="caption">Leere Zeilen sind ausgeblendet.</span>${werkzeug}</div>`;
}

// zeilen + sicht: Besteht die Gruppe nur aus optionalen Zeilen und ist keine
// davon sichtbar, wird sie ganz ausgeblendet (data-gruppe-zeilen — das Skript
// blendet sie wieder ein, sobald eine Zeile gewaehlt wird).
function gruppe(titel, rumpf, { werkzeug = "", fuss = "", unter = "", zeilen = null, sicht = null } = {}) {
  const leer = Array.isArray(zeilen) && sicht && !zeilen.some((id) => sicht.sichtbar.has(id));
  const attr = Array.isArray(zeilen) ? ` data-gruppe-zeilen="${zeilen.join(",")}"${leer ? " hidden" : ""}` : "";
  return `<section class="os-gruppe"${attr}>
    <div class="os-gruppe-titel">${titel}${unter ? `<span class="os-gruppe-unter">${unter}</span>` : ""}${werkzeug}</div>
    <div class="os-gruppe-rumpf">${rumpf}</div>${fuss ? `<div class="os-gruppe-fuss">${fuss}</div>` : ""}
  </section>`;
}

// ---- Die Seite --------------------------------------------------------
//
// ctx: { u, f, mitarbeiter, projektStufen, projektJetzt, dok, rechnungen,
//        termine, zurueck, akteUrl, dublette, admin, rechnungUrl(art),
//        konst: { SPARTEN, BRANCHEN, QUELLEN, ANSPRECH_ROLLEN, LAUFZEITEN,
//                 DRINGLICHKEIT, LEISTUNGEN_JE_SPARTE, KONTAKT_KANAELE,
//                 RECHNUNG_STAende, UMGESETZT_VORSCHLAEGE, ICON,
//                 MONATE_JE_LAUFZEIT, DOKUMENT_ARTEN },
//        hilfen: { geld, datum, zeit, datumFeld, datumZeitFeld, datumZeit,
//                  mitHerkunft, heuteFeld, monateJeLaufzeit } }
function akteSeite(ctx) {
  const { u, f, mitarbeiter = [], projektStufen = [], projektJetzt = null, dok = { eigene: [], rechnungen: [] },
    rechnungen, termine = [], zurueck, akteUrl, dublette = "", admin = false, rechnungUrl } = ctx;
  const K = ctx.konst, H = ctx.hilfen, ICON = K.ICON;
  const geld = H.geld, datum = H.datum;
  const istKunde = f.status === "kunde";
  const istRetainer = (f.tags || []).includes("retainer");
  const sparte = (f.tags || []).find((t) => K.SPARTEN[t]) || (f.deals || [])[0]?.sparte || "webdesign";
  // Das Bereich-Select zeigt nur das TAG — ohne Tag "— offen —". Der Rueckfall
  // oben ist fuer Leistungen/Phasen da; ins Formular gehoert er nicht, sonst
  // schrieb ein Speichern ohne Aenderung still das Tag "webdesign".
  const spartenTag = (f.tags || []).find((t) => K.SPARTEN[t]) || "";
  const lage = { istKunde, sparte, admin };
  const hatDeal = (f.deals || []).length > 0;
  const gewonnen = !istKunde && (f.deals || []).some((d) => d.status === "gewonnen");
  const R = rechnungen || { gestellt: 0, bezahlt: 0, offen: 0, anzahl: 0, liste: [] };
  const sicht = {};
  for (const k of Object.keys(ZEILEN)) sicht[k] = zeilenSichtbar(k, f, lage);
  const Z = (kategorie, id) => ZEILEN[kategorie].find((z) => z.id === id);
  const personName = (id) => (mitarbeiter.find((m) => m.id === id) || {}).name || "";
  const offeneTodos = (f.aufgaben || []).filter((t) => !t.erledigt);
  const beitrag = pipelineBeitrag({ ...f, rechnungen_gestellt: R.gestellt,
    deals_offen: (f.deals || []).filter((d) => d.status === "offen").reduce((a, d) => a + (Number(d.wert) || 0), 0) });
  const prozent = bezahltProzent(R);
  const naechsteAufgabe = (f.naechste_aufgabe || "").trim() || (offeneTodos[0] || {}).titel || "";
  const naechsterTermin = f.naechster_termin ? datum(f.naechster_termin)
    : (termine.find((t) => t.start && new Date(t.start) >= new Date()) || {}).start;
  const branchenName = (wert) => (K.BRANCHEN[wert] ? K.BRANCHEN[wert] : wert || "");
  // Branche: erst das Tag (Leads), dann die Spalte (Kunden) — als Schluessel,
  // wenn der Text einem Eintrag aus BRANCHEN entspricht, sonst als Freitext.
  const brancheTag = (f.tags || []).find((t) => K.BRANCHEN[t]) || "";
  const brancheSchluessel = brancheTag
    || (K.BRANCHEN[f.branche] ? f.branche : (Object.entries(K.BRANCHEN).find(([, name]) => name === f.branche) || [""])[0]);
  const brancheFrei = !brancheSchluessel && f.branche ? f.branche : "";
  const leistungenAuswahl = K.LEISTUNGEN_JE_SPARTE[sparte] || K.LEISTUNGEN_JE_SPARTE.webdesign;
  const retainerMonate = H.monateJeLaufzeit(f.vertrag_laufzeit);

  // ---- Kopf ----
  const statusPille = f.status === "verloren"
    ? `<span class="os-pille os-pille--rot os-pille--punkt">Verloren</span>`
    : istKunde ? `<span class="os-pille os-pille--gruen os-pille--punkt">${istRetainer ? "Retainer-Kunde" : "Kunde"}</span>`
    : `<span class="os-pille os-pille--blau os-pille--punkt">Lead</span>`;
  const kopfUnter = [f.geschaeftsfuehrer ? `${f.geschaeftsfuehrer}${f.ansprech_rolle ? ` · ${f.ansprech_rolle}` : ""}` : "",
    branchenName(brancheSchluessel || brancheFrei), f.ort].filter(Boolean).map(e).join(" · ");
  const aktionen = [
    `<span id="speicher-hinweis-oben" class="caption" hidden>Ungespeicherte Änderungen</span>`,
    `<button type="submit" form="akte" class="dunkel" id="speichern-oben" hidden>${ICON.check} Speichern</button>`,
    f.telefon || f.mobil ? `<a class="knopf sekundaer" href="tel:${e(f.mobil || f.telefon)}">${ICON.telefon} Anrufen</a>` : "",
    admin && rechnungUrl ? `<a class="knopf sekundaer" href="${e(rechnungUrl("angebot"))}">Angebot erstellen</a>
      <a class="knopf sekundaer" href="${e(rechnungUrl("rechnung"))}">Rechnung erstellen</a>` : "",
    f.status === "verloren"
      ? `<form method="post" action="/crm/firma/${f.id}/zurueckholen" onsubmit="return confirm('${e(f.name).replace(/'/g, "&#39;")} zurückholen?')">
           <button type="submit" class="still">Zurückholen</button></form>`
      : `<button type="button" class="still" onclick="document.getElementById('dlgVerloren').showModal()" title="Kunde springt ab">${ICON.x} Verloren</button>`,
    istKunde ? `<form method="post" action="${H.mitHerkunft(`/crm/firma/${f.id}/zu-lead`, zurueck)}"
        onsubmit="return confirm('${e(f.name).replace(/'/g, "&#39;")}: Kundenakte entfernen und zurück zu Lead?')">
        <button type="submit" class="still" title="Falls die Kundenakte irrtümlich angelegt wurde">Zurück zu Lead</button></form>` : "",
  ].filter(Boolean).join("");

  const kopf = `<header class="os-kopf akte2-kopf">
    <a class="os-kopf-zurueck" href="${e(zurueck)}">${ICON.pfeilLinks} ${istKunde ? "Kunden" : "Leads"}</a>
    <div class="os-kopf-zeile">
      <div class="os-kopf-text"><div>
        <h1 class="os-kopf-titel">${e(f.name)}</h1>
        <p class="os-kopf-unter">${kopfUnter || '<span class="caption">Ansprechperson noch offen</span>'}</p>
        <div class="os-kopf-pillen">${statusPille}
          ${(istKunde || hatDeal) ? `<span class="os-pille">${e(K.SPARTEN[sparte] || sparte)}</span>` : ""}
          ${istKunde && f.kunde_seit ? `<span class="os-pille">Kunde seit ${datum(f.kunde_seit)}</span>` : ""}
          ${!istKunde && f.score ? `<span class="os-pille ${f.score >= 7 ? "os-pille--gruen" : f.score >= 4 ? "os-pille--bernstein" : "os-pille--rot"}">Score ${f.score}</span>` : ""}
          ${R.offen > 0 ? `<span class="os-pille os-pille--bernstein os-pille--punkt">${geld(R.offen)} offen</span>` : ""}
        </div>
      </div></div>
      <div class="os-kopf-aktionen">${aktionen}</div>
    </div>
  </header>`;

  // Bereich (Sparte) als Zeile in "Firma" — bisher stand das Select im Kopf.
  const bereichZeile = (istKunde || hatDeal) ? `<div data-abschnitt="bereich"><input type="hidden" name="dabei" value="bereich" form="akte">
    <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Bereich</span>
      <div class="os-zeile-wert">${auswahl("sparte", Object.entries(K.SPARTEN), spartenTag, { leerText: "— offen —", schluessel: true })}</div>
      <span class="os-zeile-hilfe">Davon hängen Pipeline und Leistungen ab.</span></label></div>` : "";

  // ---- Hinweise unter dem Kopf ----
  const hinweise = [
    !istKunde && !hatDeal ? `<div class="os-hinweis os-hinweis--info">${ICON.info}<div><b>Noch nicht im Vertrieb.</b> Leg die Leadakte an — der Lead startet in der Pipeline bei „Neu" und erscheint unter Kunden → Lead.</div>
      <form method="post" action="${H.mitHerkunft(`/crm/firma/${f.id}/leadakte`, zurueck)}" class="akte2-hinweis-form">
        <select name="sparte">${Object.entries(K.SPARTEN).map(([k, n]) => `<option value="${k}"${sparte === k ? " selected" : ""}>${e(n)}</option>`).join("")}</select>
        <button type="submit" class="sekundaer klein">Leadakte anlegen</button></form></div>` : "",
    !istKunde && hatDeal ? `<div class="os-hinweis ${gewonnen ? "os-hinweis--erfolg" : "os-hinweis--info"}">${ICON.info}<div><b>${gewonnen ? "Deal gewonnen — jetzt Kundenakte anlegen." : "Aus diesem Lead einen Kunden machen."}</b>
      ${gewonnen ? "Danach kannst du Laufzeit, Leistungen und Rechnungen pflegen." : "Sobald der Lead abgeschlossen ist, legst du hier die Kundenakte an."}</div>
      <form method="post" action="${H.mitHerkunft(`/crm/firma/${f.id}/zu-kunde`, zurueck)}" class="akte2-hinweis-form">
        <input type="date" name="kunde_seit" value="${H.heuteFeld()}" title="Kunde seit">
        <button type="submit" class="sekundaer klein">Kundenakte anlegen</button></form></div>` : "",
    dublette ? `<div class="os-hinweis os-hinweis--warn">${ICON.warnung}<div>Es gibt bereits einen ähnlichen Eintrag — prüfe, ob das eine Dublette ist.</div>
      <a class="os-hinweis-aktion" href="/crm/firma/${e(dublette)}">Ansehen</a></div>` : "",
  ].filter(Boolean).join("");

  // ---- Segment ----
  const segment = `<div class="os-segment akte2-segment" role="tablist" aria-label="Kategorie" data-os-segment>
    ${KATEGORIEN.map((k, i) => `<button type="button" role="tab" id="${k.id}" aria-controls="kat-${k.id}" aria-selected="${i === 0}" class="${i === 0 ? "aktiv" : ""}"${i === 0 ? "" : ' tabindex="-1"'}>${e(k.titel)}${
      k.id === "aufgaben" && offeneTodos.length ? ` <small>${offeneTodos.length}</small>` : k.id === "dokumente" && (dok.eigene.length + dok.rechnungen.length) ? ` <small>${dok.eigene.length + dok.rechnungen.length}</small>` : ""}</button>`).join("")}
  </div>`;

  // ---- 1. Überblick ----
  const abschlaege = (R.liste || []).filter((r) => r.art === "rechnung" && r.abschlag_nr && r.status !== "storniert");
  const rechnungZeile = (r) => {
    const stand = r.status === "bezahlt" ? `bezahlt${r.bezahlt_am ? " am " + datum(r.bezahlt_am) : ""}`
      : r.status === "teilbezahlt" ? `${geld(r.bezahlt_betrag)} bezahlt, Rest offen${r.faellig ? ", fällig " + datum(r.faellig) : ""}`
      : r.status === "gestellt" ? `offen${r.faellig ? ", fällig " + datum(r.faellig) : ""}` : (RECHNUNG_PILLE[r.status] || [])[1] || r.status;
    return `<a class="os-zeile os-zeile--aktion" href="${e(r.url || "#")}">
      <span class="os-zeile-wert"><b>${e(abschlagText(r, R.liste) || r.nummer || "Rechnung")}</b>${r.nummer && abschlagText(r, R.liste) ? ` <span class="caption">${e(r.nummer)}</span>` : ""}
        <div class="os-tabelle-unter">${geld(r.betrag)} · ${e(stand)}</div></span>
      <span class="os-zeile-neben">${rechnungPille(r.status)}</span></a>`;
  };
  const ueberblick = `
    ${gruppe("Auf einen Blick", [
      lese("Status", statusPille + (istKunde && istRetainer ? ' <span class="os-pille">Retainer</span>' : "")),
      // Der Bereich steht auch bei einem Lead ohne Deal, sobald er ein
      // Sparten-Tag traegt (aus dem Blatt "Neuer Kunde" oder dem Lead-Import).
      lese("Bereich", (istKunde || hatDeal || (f.tags || []).some((t) => K.SPARTEN[t])) ? e(K.SPARTEN[sparte] || sparte) : "", "Noch kein Bereich"),
      lese("Verantwortlich", e(personName(f.besitzer) || f.besitzer_name || ""), "Niemand zugeteilt"),
      istKunde ? lese("Kunde seit", f.kunde_seit ? datum(f.kunde_seit) : "") : lese("Angelegt", datum(f.erstellt)),
    ].join(""))}
    <section class="os-gruppe"><div class="os-gruppe-titel">Geld</div>
      <div class="os-kacheln akte2-kacheln">
        <div class="os-kachel"><span class="os-kachel-label">Pipeline-Beitrag</span>
          <span class="os-kachel-zahl">${beitrag.betrag ? geld(beitrag.betrag) : "—"}</span>
          <span class="os-kachel-fuss">${beitrag.art === "geplant" ? "geplant — fest besprochen" : beitrag.art === "geschaetzt" ? (beitrag.quelle === "deals" ? "geschätzt aus offenen Deals" : "geschätzt — Bauchgefühl")
            : beitrag.quelle === "rechnung" ? "zählt als fester Umsatz" : "noch keine Zahl eingetragen"}</span></div>
        <div class="os-kachel"><span class="os-kachel-label">Gestellt</span><span class="os-kachel-zahl">${R.anzahl ? geld(R.gestellt) : "—"}</span>
          <span class="os-kachel-fuss">${R.anzahl ? `${R.anzahl} ${R.anzahl === 1 ? "Rechnung" : "Rechnungen"}` : "noch keine Rechnung"}</span></div>
        <div class="os-kachel os-kachel--gruen"><span class="os-kachel-label">Bezahlt</span><span class="os-kachel-zahl">${R.anzahl ? geld(R.bezahlt) : "—"}</span>
          <span class="os-kachel-fuss">${prozent === null ? "aus echten Rechnungen" : `${prozent} % der gestellten Summe`}</span></div>
        <div class="os-kachel ${R.offen > 0 ? "os-kachel--bernstein" : ""}"><span class="os-kachel-label">Offen</span><span class="os-kachel-zahl">${R.anzahl ? geld(R.offen) : "—"}</span>
          <span class="os-kachel-fuss">${R.offen > 0 ? "noch nicht bezahlt" : R.anzahl ? "alles bezahlt" : "nichts offen"}</span></div>
      </div>
      ${prozent !== null ? `<div class="os-fortschritt ${prozent >= 100 ? "os-fortschritt--gruen" : "os-fortschritt--bernstein"} akte2-fortschritt" role="progressbar" aria-valuenow="${prozent}" aria-valuemin="0" aria-valuemax="100" aria-label="Bezahlt">
        <div class="os-fortschritt-text"><span><b>${prozent} %</b> bezahlt</span><span>${geld(R.bezahlt)} von ${geld(R.gestellt)}</span></div>
        <div class="os-fortschritt-balken"><span style="width:${prozent}%"></span></div></div>` : ""}
      ${abschlaege.length ? `<div class="os-gruppe-rumpf akte2-abschlaege">${abschlaege.map(rechnungZeile).join("")}</div>` : ""}
    </section>
    ${gruppe("Was ansteht", [
      lese("Nächste Aufgabe", e(naechsteAufgabe), "Keine offene Aufgabe"),
      lese("Nächster Termin", naechsterTermin ? (typeof naechsterTermin === "string" && /\d{2}\.\d{2}\.\d{4}/.test(naechsterTermin) ? e(naechsterTermin) : e(H.zeit(naechsterTermin))) : "", "Kein Termin eingetragen"),
      offeneTodos.length ? `<div class="os-zeile os-zeile--text"><span class="os-zeile-label">Offene Aufgaben</span><div class="os-zeile-wert">
        ${offeneTodos.slice(0, 3).map((t) => `<div>${e(t.titel)}${t.faellig ? ` <span class="caption">bis ${datum(t.faellig)}</span>` : ""}</div>`).join("")}
        ${offeneTodos.length > 3 ? `<a href="#aufgaben" class="caption" onclick="document.getElementById('aufgaben').click()">${offeneTodos.length - 3} weitere →</a>` : ""}</div></div>`
        : lese("Offene Aufgaben", "", "Nichts offen"),
    ].join(""))}
    ${gruppe("Zuletzt passiert", (f.historie || []).length
      ? (f.historie || []).slice(0, 3).map((h) => `<div class="os-zeile os-zeile--text"><span class="os-zeile-label">${e(H.zeit(h.zeit))}${h.wer_name ? " · " + e(h.wer_name) : ""}</span><div class="os-zeile-wert">${e(h.text)}</div></div>`).join("")
      : `<div class="os-leer os-leer--klein"><p>Noch kein Eintrag im Verlauf.</p></div>`,
      { werkzeug: `<span class="os-gruppe-werkzeug"><a href="#verlauf" onclick="document.getElementById('verlauf').click();return false">Alles ansehen</a></span>` })}`;

  // ---- 2. Kontakt ----
  const sK = sicht.kontakt;
  const kontakt = `${katKopf("kontakt", sK)}<div data-abschnitt="stammdaten"><input type="hidden" name="dabei" value="stammdaten" form="akte"></div>
    <div data-abschnitt="kontakt"><input type="hidden" name="dabei" value="kontakt" form="akte"></div>
    ${gruppe("Ansprechperson", [
      zEingabe(Z("kontakt", "ansprechperson"), sK, eingabe("ansprech_name", f.geschaeftsfuehrer, { platz: "z. B. Anna Weber" })),
      zEingabe(Z("kontakt", "position"), sK, auswahl("ansprech_rolle", K.ANSPRECH_ROLLEN, f.ansprech_rolle)),
      zEingabe(Z("kontakt", "anrede"), sK, auswahl("geschlecht", [["w", "Frau"], ["m", "Herr"], ["d", "Divers"]], f.geschlecht, { schluessel: true })),
    ].join(""), { zeilen: ["ansprechperson", "position", "anrede"], sicht: sK })}
    ${gruppe("Erreichbar", [
      zEingabe(Z("kontakt", "telefon"), sK, eingabe("telefon", f.telefon, { typ: "tel", platz: "+49 89 …" })),
      zEingabe(Z("kontakt", "mobil"), sK, eingabe("mobil", f.mobil, { typ: "tel", platz: "+49 172 …" })),
      zEingabe(Z("kontakt", "email"), sK, eingabe("email", f.email, { typ: "email", platz: "info@…" })),
      zEingabe(Z("kontakt", "website"), sK, eingabe("website", f.website, { platz: "https://… (leer = keine)" })),
      zChips(Z("kontakt", "kontakt_kanaele"), sK, "kontakt_kanaele", K.KONTAKT_KANAELE, f.kontakt_kanaele || []),
    ].join(""), { zeilen: ["telefon", "mobil", "email", "website", "kontakt_kanaele"], sicht: sK })}
    ${gruppe("Adresse", [
      zEingabe(Z("kontakt", "adresse"), sK, eingabe("adresse", f.adresse, { platz: "z. B. Marktplatz 3" }), { hilfe: "Steht auf Rechnungen und Angeboten." }),
      zPaar(Z("kontakt", "plz_ort"), sK, [["PLZ", eingabe("plz", f.plz, { platz: "84405", extra: 'inputmode="numeric"' })], ["Ort", eingabe("ort", f.ort, { platz: "z. B. Dorfen" })]]),
    ].join(""), { zeilen: ["adresse", "plz_ort"], sicht: sK })}
    <div data-abschnitt="leistungen"><input type="hidden" name="dabei" value="leistungen" form="akte"></div>`;

  // ---- 3. Firma ----
  const sF = sicht.firma;
  const brancheAuswahl = `<select form="akte" name="branche">
    <option value="">— offen —</option>
    ${brancheFrei ? `<option value="${e(brancheFrei)}" selected>${e(brancheFrei)} (Freitext)</option>` : ""}
    ${Object.entries(K.BRANCHEN).map(([k, n]) => `<option value="${k}"${brancheSchluessel === k ? " selected" : ""}>${e(n)}</option>`).join("")}</select>`;
  const firma = `${katKopf("firma", sF)}${bereichZeile}
    <div data-abschnitt="firma"><input type="hidden" name="dabei" value="firma" form="akte"></div>
    ${gruppe("Die Firma", [
      zEingabe(Z("firma", "branche"), sF, brancheAuswahl),
      zEingabe(Z("firma", "taetigkeit"), sF, `<textarea form="akte" name="taetigkeit" rows="2" placeholder="z. B. Physiotherapie, Krankengymnastik">${e(f.taetigkeit || "")}</textarea>`),
      zEingabe(Z("firma", "mitarbeiter_zahl"), sF, eingabe("mitarbeiter_zahl", f.mitarbeiter_zahl, { typ: "number", platz: "z. B. 12", extra: 'step="1" min="0"' })),
      (f.argumente || []).length ? zText(Z("firma", "argumente"), sF, `<ul class="akte2-liste">${f.argumente.map((a) => `<li>${e(a)}</li>`).join("")}</ul>`) : "",
    ].join(""), { zeilen: ["branche", "taetigkeit", "mitarbeiter_zahl", "argumente"], sicht: sF })}
    ${gruppe("Zuständigkeit", [
      zEingabe(Z("firma", "besitzer"), sF, auswahl("besitzer", mitarbeiter.map((m) => [m.id, m.name]), f.besitzer, { schluessel: true, fremdText: "Nicht (mehr) im Team" }),
        { hilfe: `Betreut ${istKunde ? "den Kunden" : "den Lead"} und sieht ihn in seinem CRM. Beim Wechsel wandern Abschlüsse, Projekte und offene Aufgaben mit.` }),
      zEingabe(Z("firma", "gewonnen_durch"), sF, auswahl("gewonnen_durch", mitarbeiter.map((m) => [m.id, m.name]), f.gewonnen_durch, { schluessel: true, fremdText: "Nicht (mehr) im Team" }),
        { hilfe: "Wer den Kunden geholt hat — danach wird der Umsatz zugerechnet." }),
      zEingabe(Z("firma", "quelle"), sF, auswahl("quelle", K.QUELLEN, f.quelle, { leerText: "— unbekannt —" })),
    ].join(""), { zeilen: ["besitzer", "gewonnen_durch", "quelle"], sicht: sF })}
    <div data-abschnitt="notizen"><input type="hidden" name="dabei" value="notizen" form="akte"></div>
    ${gruppe("Notizen", zEingabe(Z("firma", "notizen"), sF, `<textarea form="akte" name="notizen" rows="6" placeholder="Absprachen, Zugänge, wer wen kennt …">${e(f.notizen || "")}</textarea>`),
      { fuss: "Wird erst mit „Speichern“ übernommen.", zeilen: ["notizen"], sicht: sF })}`;

  // ---- 4. Auftrag & Geld ----
  const sG = sicht.geld;
  const retainerOptionen = Array.from({ length: Math.max(retainerMonate, Number(f.retainer_monate_bezahlt || 0)) + 1 },
    (_, n) => `<option value="${n}"${Number(f.retainer_monate_bezahlt || 0) === n ? " selected" : ""}>${n} von ${retainerMonate} bezahlt</option>`).join("");
  const angebote = (R.liste || []).filter((r) => r.art === "angebot");
  const rechnungenListe = (R.liste || []).filter((r) => r.art === "rechnung");
  const geldKat = `${katKopf("geld", sG)}<div data-abschnitt="auftrag"><input type="hidden" name="dabei" value="auftrag" form="akte"></div>
    ${istKunde ? `<div data-abschnitt="stand"><input type="hidden" name="dabei" value="stand" form="akte"></div>` : ""}
    ${gruppe("Umsatz", [
      zEingabe(Z("geld", "umsatz_geschaetzt"), sG, betrag("umsatz_geschaetzt", f.umsatz_geschaetzt), { hilfe: "Schätzung aus dem Bauchgefühl." }),
      zEingabe(Z("geld", "umsatz_geplant"), sG, betrag("umsatz_geplant", f.umsatz_geplant), { hilfe: "Der fest besprochene Preis. Zählt in der Pipeline, bis die erste Rechnung gestellt ist." }),
    ].join(""), { zeilen: ["umsatz_geschaetzt", "umsatz_geplant"], sicht: sG,
      fuss: `Pipeline-Beitrag jetzt: <b>${beitrag.betrag ? geld(beitrag.betrag) : "—"}</b>${beitrag.art ? ` (${beitrag.art === "geplant" ? "geplant" : "geschätzt"})` : beitrag.quelle === "rechnung" ? " — es gibt schon Rechnungen, die Firma zählt als fester Umsatz" : ""}.` })}
    ${gruppe("Vereinbart", [
      zEingabe(Z("geld", "preis_setup"), sG, betrag("preis_setup", f.preis_setup)),
      zEingabe(Z("geld", "preis_monatlich"), sG, betrag("preis_monatlich", f.preis_monatlich), { hilfe: "Sobald ein Betrag drinsteht, zählt die Firma als Retainer-Kunde." }),
      zEingabe(Z("geld", "vertrag_laufzeit"), sG, auswahl("vertrag_laufzeit", K.LAUFZEITEN, f.vertrag_laufzeit)),
      zPaar(Z("geld", "erfolgsbonus"), sG, [["Erfolgsbonus", jaNein("erfolgsbonus", f.erfolgsbonus)], ["Wofür genau?", eingabe("erfolgsbonus_text", f.erfolgsbonus_text, { platz: "z. B. 200 € pro Lead" })]]),
      istKunde ? zEingabe(Z("geld", "kunde_seit"), sG, eingabe("kunde_seit", H.datumFeld(f.kunde_seit), { typ: "date" })) : "",
      istKunde ? zEingabe(Z("geld", "vertrag_unterschrieben"), sG, jaNein("vertrag_unterschrieben", f.vertrag_unterschrieben, "Ja, liegt vor", "Nein")) : "",
      zChips(Z("geld", "leistungen"), sG, "leistungen", leistungenAuswahl, f.leistungen || [],
        { hilfe: (f.leistungen || []).filter((l) => !leistungenAuswahl.includes(l)).length
          ? `Aus einem anderen Bereich übernommen: ${(f.leistungen || []).filter((l) => !leistungenAuswahl.includes(l)).map(e).join(", ")}` : "" }),
      sparte === "webdesign" ? zEingabe(Z("geld", "hosting"), sG, jaNein("hosting", f.hosting, "Ja, wir hosten", "Nein")) : "",
      sparte === "performance" ? zPaar(Z("geld", "leads"), sG, [["Leads vereinbart", eingabe("leads_ziel", f.leads_ziel, { typ: "number", platz: "0", extra: 'step="1" min="0"' })], ["Leads erreicht", eingabe("leads_ist", f.leads_ist, { typ: "number", platz: "0", extra: 'step="1" min="0"' })]]) : "",
      istKunde ? zEingabe(Z("geld", "rechnung_stand"), sG, auswahl("rechnung_stand", Object.entries(K.RECHNUNG_STAende), f.rechnung_stand, { schluessel: true }),
        { hilfe: "Altes Feld — bucht das Setup anteilig als Einnahme. Neue Zahlungen laufen über Rechnungen." }) : "",
      istKunde ? zEingabe(Z("geld", "retainer_monate_bezahlt"), sG, `<select form="akte" name="retainer_monate_bezahlt">${retainerOptionen}</select>`,
        { hilfe: "Altes Feld — jeder bezahlte Monat wird einzeln gebucht." }) : "",
    ].join(""), { zeilen: ["preis_setup", "preis_monatlich", "vertrag_laufzeit", "erfolgsbonus", "kunde_seit", "vertrag_unterschrieben", "leistungen", "hosting", "leads", "rechnung_stand", "retainer_monate_bezahlt"], sicht: sG })}
    <section class="os-gruppe"><div class="os-gruppe-titel">Rechnungen &amp; Angebote
      ${/* Die Quote steht auch hier, nicht nur im Ueberblick — wer in "Auftrag &
           Geld" die Liste liest, will wissen, wie viel davon schon da ist. */""}
      ${R.anzahl ? `<span class="os-gruppe-unter">${geld(R.bezahlt)} von ${geld(R.gestellt)} bezahlt${prozent !== null ? ` · ${prozent} % bezahlt` : ""}</span>` : ""}
      ${admin && rechnungUrl ? `<span class="os-gruppe-werkzeug"><a href="${e(rechnungUrl("angebot"))}">Angebot erstellen</a> · <a href="${e(rechnungUrl("rechnung"))}">Rechnung erstellen</a></span>` : ""}</div>
      ${(R.liste || []).length ? `<div class="os-gruppe-rumpf">
        ${rechnungenListe.map(rechnungZeile).join("")}
        ${angebote.map((r) => `<a class="os-zeile os-zeile--aktion" href="${e(r.url || "#")}">
          <span class="os-zeile-wert"><b>Angebot ${e(r.nummer || "")}</b><div class="os-tabelle-unter">${geld(r.betrag)}${r.datum ? " · " + datum(r.datum) : ""}${r.faellig ? " · gültig bis " + datum(r.faellig) : ""}</div></span>
          <span class="os-zeile-neben">${rechnungPille(r.status)}</span></a>`).join("")}
      </div>` : `<div class="os-gruppe-rumpf"><div class="os-leer os-leer--klein"><p>Noch keine Rechnung und kein Angebot.${admin ? " Erstelle das erste über die Knöpfe rechts oben." : ""}</p></div></div>`}
    </section>`;

  // ---- 5. Projekt & Stand ----
  const sS = sicht.stand;
  const umgesetztRumpf = `${(f.umgesetzt || []).length ? (f.umgesetzt || []).map((x) => `<div class="os-zeile os-zeile--text akte2-umgesetzt"><span class="os-zeile-wert">${e(x)}</span>
      <form method="post" action="${H.mitHerkunft(`/crm/firma/${f.id}/umgesetzt`, zurueck)}"><input type="hidden" name="weg" value="${e(x)}">
        <button type="submit" class="still klein" title="Entfernen">${ICON.x}</button></form></div>`).join("") : ""}
    <form method="post" action="${H.mitHerkunft(`/crm/firma/${f.id}/umgesetzt`, zurueck)}" class="os-zeile os-zeile--eingabe akte2-umgesetzt-neu">
      <span class="os-zeile-label">Hinzufügen</span>
      <div class="os-zeile-wert"><input name="hinzu" required list="umgesetzt-liste" placeholder="z. B. Webdesign · Telefonagent">
        <datalist id="umgesetzt-liste">${K.UMGESETZT_VORSCHLAEGE.map((x) => `<option value="${e(x)}">`).join("")}</datalist>
        <button type="submit" class="sekundaer klein">${ICON.plus} Eintragen</button></div></form>`;
  const stand = `${katKopf("stand", sS)}<div data-abschnitt="termine"><input type="hidden" name="dabei" value="termine" form="akte"></div>
    ${gruppe("Wo es steht", [
      istKunde ? zEingabe(Z("stand", "projekt_stufe"), sS, `<select form="akte" name="projekt_stufe">
          <option value="">— noch nicht gestartet —</option>
          ${projektStufen.map((s) => `<option value="${s.id}"${String(projektJetzt?.stufe_id) === String(s.id) ? " selected" : ""}>${s.position}. ${e(s.name)}${s.ist_abschluss ? " — abgeschlossen" : ""}</option>`).join("")}</select>`,
        { label: `Projektphase · ${K.SPARTEN[sparte] || sparte}`, hilfe: !projektJetzt ? "Sobald du eine Phase wählst, erscheint der Kunde in der Projektabwicklung."
          : projektJetzt.status === "fertig" ? `Abgeschlossen mit „${e(projektJetzt.stufe_name || "—")}" — steht nicht mehr auf dem Brett.`
          : `Steht in der Projektabwicklung unter „${e(projektJetzt.stufe_name || "—")}".` })
        : zEingabe(Z("stand", "score"), sS, auswahl("score", [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => [String(n), `Score ${n} von 10 · ${n * 10} %`]), f.score, { leerText: "— noch nicht eingeschätzt —", schluessel: true })),
      !istKunde && (f.deals || []).length ? `<div class="os-zeile os-zeile--text"><span class="os-zeile-label">Im Vertrieb</span><div class="os-zeile-wert">
        ${(f.deals || []).map((d) => `<span class="os-pille ${d.status === "gewonnen" ? "os-pille--gruen" : d.status === "verloren" ? "os-pille--rot" : "os-pille--blau"}">${e(d.stufe_name || d.status)}</span> <span class="caption">${e(K.SPARTEN[d.sparte] || d.sparte)}</span>`).join("<br>")}</div></div>` : "",
      zEingabe(Z("stand", "naechste_aufgabe"), sS, eingabe("naechste_aufgabe", f.naechste_aufgabe, { platz: offeneTodos[0] ? `Nächstes To-do: ${offeneTodos[0].titel}` : "z. B. Webseite live stellen" }),
        { hilfe: offeneTodos.length ? `Leer = das nächste offene To-do (${e(offeneTodos[0].titel)}).` : "Freitext — oder lege unter „Aufgaben & Termine“ ein To-do an." }),
      zEingabe(Z("stand", "dringlichkeit"), sS, auswahl("dringlichkeit", Object.keys(K.DRINGLICHKEIT), f.dringlichkeit), { hilfe: "Steht als Streifen auf der Pipeline-Karte." }),
      zEingabe(Z("stand", "faellig_am"), sS, eingabe("faellig_am", H.datumFeld(f.faellig_am), { typ: "date" })),
    ].join(""), { zeilen: ["projekt_stufe", "score", "naechste_aufgabe", "dringlichkeit", "faellig_am"], sicht: sS })}
    <section class="os-gruppe" data-zeile="umgesetzt"${sS.sichtbar.has("umgesetzt") ? "" : " hidden"}${(f.umgesetzt || []).length ? ' data-fest="1"' : ""}>
      <div class="os-gruppe-titel">${istKunde ? "Umgesetzt" : "Geplante Umsetzung"}${(f.umgesetzt || []).length ? ` <small>${(f.umgesetzt || []).length}</small>` : ""}</div>
      <div class="os-gruppe-rumpf">${umgesetztRumpf}</div>
    </section>`;

  // ---- 6. Aufgaben & Termine ----
  const sA = sicht.aufgaben;
  const todoZeile = (t) => `<div class="os-zeile os-zeile--text akte2-todo${t.erledigt ? " fertig" : ""}">
      <form method="post" action="/crm/todo/erledigt" class="akte2-todo-haken">
        <input type="hidden" name="id" value="${t.id}"><input type="hidden" name="erledigt" value="${t.erledigt ? "0" : "1"}">
        <input type="hidden" name="zurueck" value="${e(akteUrl)}#aufgaben">
        <button type="submit" class="todo-haken ${t.erledigt ? "an" : ""}" title="${t.erledigt ? "Wieder öffnen" : "Erledigt"}">${t.erledigt ? ICON.check : ""}</button></form>
      <span class="os-zeile-wert"><span class="akte2-todo-titel">${e(t.titel)}</span>
        ${t.notiz ? `<div class="os-tabelle-unter">${e(t.notiz)}</div>` : ""}
        <div class="os-tabelle-unter">${[t.dringlichkeit, t.geplant_am ? `zeigen am ${datum(t.geplant_am)}` : "", t.verantwortlich && t.verantwortlich !== u.id ? `für ${e(personName(t.verantwortlich))}` : ""].filter(Boolean).join(" · ")}</div></span>
      ${t.faellig ? `<span class="os-zeile-neben"><span class="os-pille ${new Date(t.faellig) <= new Date() && !t.erledigt ? "os-pille--rot" : "os-pille--bernstein"}">bis ${datum(t.faellig)}</span></span>` : ""}
    </div>`;
  const erledigte = (f.aufgaben || []).filter((t) => t.erledigt);
  const aufgaben = `${katKopf("aufgaben", sA)}${gruppe(`Aufgaben${offeneTodos.length ? ` <small>${offeneTodos.length} offen</small>` : ""}`,
      (offeneTodos.length ? offeneTodos.map(todoZeile).join("") : `<div class="os-leer os-leer--klein"><p>Nichts offen. Lege unten eine Aufgabe an — sie landet auf dem Whiteboard der verantwortlichen Person.</p></div>`)
      + (erledigte.length ? `<details class="akte2-erledigt"><summary class="os-zeile os-zeile--aktion"><span class="os-zeile-wert">Erledigt</span><span class="os-zeile-neben">${erledigte.length}</span></summary>${erledigte.slice(0, 10).map(todoZeile).join("")}</details>` : ""),
      { werkzeug: `<span class="os-gruppe-werkzeug"><a href="/crm/todos">Alle To-dos</a></span>` })}
    <section class="os-gruppe"><div class="os-gruppe-titel">Neue Aufgabe</div>
      <form method="post" action="/crm/todo/anlegen" class="os-gruppe-rumpf akte2-todo-neu">
        <input type="hidden" name="firma_id" value="${f.id}"><input type="hidden" name="zurueck" value="${e(akteUrl)}#aufgaben">
        <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Aufgabe *</span>
          <div class="os-zeile-wert"><input name="titel" required placeholder="z. B. Webseite live stellen"></div></label>
        <div class="os-zeile os-zeile--eingabe os-zeile--paar">
          <label class="os-zeile-teil"><span class="os-zeile-label">Verantwortlich</span><div class="os-zeile-wert">
            <select name="verantwortlich">${mitarbeiter.map((m) => `<option value="${m.id}"${m.id === u.id ? " selected" : ""}>${e(m.name)}</option>`).join("")}</select></div></label>
          <label class="os-zeile-teil"><span class="os-zeile-label">Wichtigkeit</span><div class="os-zeile-wert">
            <select name="wichtigkeit"><option value="1">Sehr wichtig</option><option value="2">Wichtig</option><option value="3" selected>Sollte erledigt werden</option><option value="4">Kann warten</option></select></div></label>
        </div>
        <div class="os-zeile os-zeile--eingabe os-zeile--paar">
          <label class="os-zeile-teil"><span class="os-zeile-label">Dringlichkeit</span><div class="os-zeile-wert">
            <select name="dringlichkeit"><option>Extrem dringend</option><option>Dringend</option><option>ASAP</option><option selected>Bald</option><option>Wenn Zeit da ist</option></select></div></label>
          <label class="os-zeile-teil"><span class="os-zeile-label">Zeigen am</span><div class="os-zeile-wert"><input type="date" name="geplant_am" value="${H.heuteFeld()}"></div></label>
        </div>
        <div class="os-zeile os-zeile--eingabe os-zeile--paar">
          <label class="os-zeile-teil"><span class="os-zeile-label">Fertig bis</span><div class="os-zeile-wert"><input type="date" name="faellig"></div></label>
          <label class="os-zeile-teil"><span class="os-zeile-label">Was genau? (optional)</span><div class="os-zeile-wert"><input name="notiz" placeholder="erscheint im Detailfenster"></div></label>
        </div>
        <div class="os-zeile akte2-zeile-knopf"><button type="submit" class="sekundaer">${ICON.plus} Aufgabe anlegen</button>
          <span class="caption">„Zeigen am" bestimmt den Tag unter „Heute zu tun", „Fertig bis" ist die Frist. Die Aufgabe geht automatisch aufs Whiteboard der verantwortlichen Person.</span></div>
      </form>
    </section>
    ${gruppe("Termine", [
      zEingabe(Z("aufgaben", "erstgespraech_am"), sA, eingabe("erstgespraech_am", H.datumZeitFeld(f.erstgespraech_am), { typ: "datetime-local" }),
        { hilfe: "Wird beim Speichern in den Kalender eingetragen oder dort verschoben." }),
      zEingabe(Z("aufgaben", "naechster_termin"), sA, eingabe("naechster_termin", H.datumFeld(f.naechster_termin), { typ: "date" })),
      termine.length ? termine.map((t) => `<a class="os-zeile os-zeile--aktion" href="${e(t.htmlLink || "/kalender")}"${t.htmlLink ? ' target="_blank" rel="noopener"' : ""}>
          <span class="os-zeile-icon">${ICON.kalender}</span>
          <span class="os-zeile-wert">${e(t.titel || "Termin")}${t.fehlt ? ' <span class="caption">nicht mehr im Kalender</span>' : ""}<div class="os-tabelle-unter">${t.start ? e(H.zeit(t.start)) : ""}${t.ort ? " · " + e(t.ort) : ""}</div></span>
          <span class="os-zeile-neben">${t.art === "erstgespraech" ? '<span class="os-pille os-pille--blau">Erstgespräch</span>' : ""}</span></a>`).join("")
        : `<div class="os-zeile os-zeile--text"><span class="os-zeile-label">Aus dem Kalender</span><div class="os-zeile-wert" data-leer="Kein verknüpfter Termin — im Kalender einen Termin mit dieser Firma anlegen."></div></div>`,
    ].join(""))}`;

  // ---- 7. Dokumente ----
  const dokumente = `<section class="os-gruppe"><div class="os-gruppe-titel">Ablegen</div>
      <div class="os-gruppe-rumpf">
        <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Was legst du ab?</span>
          <div class="os-zeile-wert"><select id="dok-art">${K.DOKUMENT_ARTEN.map((a) => `<option value="${e(a)}">${e(a)}</option>`).join("")}</select></div>
          <span class="os-zeile-hilfe" id="dok-hinweis"></span></label>
        <div class="os-zeile"><div class="ablage akte2-ablage" id="ablage" data-firma="${f.id}">
          <div class="ablage-icon">${ICON.ordner}</div>
          <div class="ablage-text"><b>Dateien hier ablegen</b><span class="caption">PDF, Bilder oder andere Dateien — oder klicken zum Auswählen</span></div>
          <input type="file" id="ablage-feld" multiple hidden></div>
          <div class="ablage-liste" id="ablage-liste"></div></div>
      </div></section>
    ${dok.rechnungen.length ? gruppe(`Rechnungen in der Buchhaltung <small>${dok.rechnungen.length}</small>`, dok.rechnungen.map((r) => {
      const stand = r.status !== "gebucht" ? ["os-pille--bernstein", "wartet auf Prüfung"]
        : r.bezahlt ? ["os-pille--gruen", "bezahlt" + (r.bezahlt_am ? " am " + datum(r.bezahlt_am) : "")] : ["os-pille--bernstein", "offen"];
      return `<a class="os-zeile os-zeile--aktion" href="/buchhaltung/beleg/${r.id}/datei" target="_blank" rel="noopener">
        <span class="os-zeile-icon">${ICON.datei}</span>
        <span class="os-zeile-wert">${e(r.name)}<div class="os-tabelle-unter">Nr. ${r.laufnummer ?? "–"}${r.betrag ? " · " + geld(r.betrag) : ""}</div></span>
        <span class="os-zeile-neben"><span class="os-pille ${stand[0]}">${e(stand[1])}</span></span></a>`;
    }).join(""), { fuss: `Gebucht und abgehakt wird in der <a href="/buchhaltung">Buchhaltung</a>.` }) : ""}
    ${dok.eigene.length ? gruppe(`Unterlagen <small>${dok.eigene.length}</small>`, dok.eigene.map((x) => `<div class="os-zeile os-zeile--text akte2-dokument">
        <span class="os-zeile-icon">${ICON.datei}</span>
        <a class="os-zeile-wert" href="/crm/dokument/${x.id}/datei" target="_blank" rel="noopener">${e(x.name)}<div class="os-tabelle-unter">${e(x.art || "Sonstiges")}${x.groesse ? " · " + Math.round(x.groesse / 1024) + " KB" : ""}${x.wer ? " · " + e(x.wer) : ""}</div></a>
        <form method="post" action="/crm/dokument/${x.id}/loeschen" onsubmit="return confirm('„${e(x.name).replace(/'/g, "&#39;")}“ löschen?')"><button type="submit" class="still klein" title="Löschen">${ICON.x}</button></form>
      </div>`).join("")) : ""}
    ${!dok.eigene.length && !dok.rechnungen.length ? `<div class="os-leer"><div class="os-leer-icon">${ICON.ordner}</div><h3>Noch nichts abgelegt</h3><p>Zieh Verträge, Briefings oder Rechnungen in die Ablage oben — Rechnungen an den Kunden wandern dabei in die Buchhaltung.</p></div>` : ""}`;

  // ---- 8. Verlauf ----
  const verlauf = `<section class="os-gruppe"><div class="os-gruppe-titel">Notiz hinzufügen</div>
      <form method="post" action="${H.mitHerkunft(`/crm/firma/${f.id}/notiz`, zurueck)}" class="os-gruppe-rumpf">
        <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Was ist passiert?</span>
          <div class="os-zeile-wert"><input name="text" required placeholder="z. B. Telefonat: will Angebot bis Freitag"></div></label>
        <div class="os-zeile akte2-zeile-knopf"><button type="submit" class="sekundaer">${ICON.plus} In den Verlauf</button></div>
      </form></section>
    ${gruppe("Verlauf", (f.historie || []).length ? (f.historie || []).map((h) => `<div class="os-zeile os-zeile--text akte2-verlauf">
        <span class="os-zeile-icon ${h.art === "anruf" ? "blau" : h.art === "stufenwechsel" ? "gruen" : ""}">${h.art === "anruf" ? ICON.telefon : h.art === "stufenwechsel" ? ICON.trend : ICON.notiz}</span>
        <span class="os-zeile-wert">${e(h.text)}<div class="os-tabelle-unter">${e(H.zeit(h.zeit))}${h.wer_name ? " · " + e(h.wer_name) : ""}</div></span></div>`).join("")
      : `<div class="os-leer os-leer--klein"><p>Noch kein Eintrag. Anrufe, Phasenwechsel und Notizen landen hier.</p></div>`)}`;

  const kategorien = { ueberblick, kontakt, firma, geld: geldKat, stand, aufgaben, dokumente, verlauf };

  // ---- Dialog "Verloren" ----
  const dlgVerloren = `<dialog id="dlgVerloren"><form method="post" action="/crm/firma/${f.id}/verloren">
    <h2>${e(f.name)} verloren</h2><div class="sub">Der Kunde wandert in die Liste „Verloren".</div>
    <div class="feld"><label>Warum? *</label><select name="grund_wahl">
      ${["Zu teuer", "Kein Bedarf mehr", "Zu anderem Anbieter gewechselt", "Unzufrieden mit der Leistung", "Firma aufgegeben / insolvent", "Kein Kontakt mehr möglich", "Anderer Grund"].map((g) => `<option>${e(g)}</option>`).join("")}</select></div>
    <div class="feld"><label>Dazu (optional)</label><input name="grund_text" placeholder="Was genau war der Auslöser?" maxlength="300"></div>
    <p class="caption" style="margin:-4px 0 12px">Laufende Projekte werden abgebrochen, offene Deals und Aufgaben geschlossen. <b>Umsatz und Buchungen bleiben unangetastet.</b></p>
    <div class="dialog-fuss"><button type="button" class="sekundaer" onclick="document.getElementById('dlgVerloren').close()">Abbrechen</button>
      <button type="submit" class="dunkel">Als verloren markieren</button></div></form></dialog>`;

  return `<link rel="stylesheet" href="${v("/akte.css")}">
    <form id="akte" method="post" action="${H.mitHerkunft(`/crm/firma/${f.id}/kunde`, zurueck)}"><input type="hidden" name="abschnitt" value="alles"></form>
    <div class="akte2" data-firma="${f.id}">
      ${kopf}
      ${hinweise ? `<div class="akte2-hinweise">${hinweise}</div>` : ""}
      ${segment}
      <div class="os-breite-mittel akte2-rumpf">
        ${KATEGORIEN.map((k, i) => `<section id="kat-${k.id}" class="akte2-kategorie" role="tabpanel" aria-labelledby="${k.id}" data-kategorie="${k.id}"${i === 0 ? "" : " hidden"}>${kategorien[k.id]}</section>`).join("")}
      </div>
      ${dlgVerloren}
      <div class="akte-speicherleiste akte2-speicherleiste" id="speicherleiste" hidden>
        <span class="akte-speicher-text">Ungespeicherte Änderungen</span>
        <button type="button" class="sekundaer" onclick="akteVerwerfen()">Verwerfen</button>
        <button type="submit" form="akte" class="dunkel">${ICON.check} Alles speichern</button>
      </div>
    </div>
    ${akteSkript({ f })}`;
}

// Das Skript der Akte: Segment (aus 01-design.md), Popover, Zeilenwahl,
// Speicherleiste, Ablage. Alles in einem Block, ohne Fremdbibliothek.
function akteSkript({ f }) {
  return `<script>
(function(){
  // --- Segment: genau eine Kategorie sichtbar, Wahl im Hash ---
  document.querySelectorAll("[data-os-segment]").forEach(function(seg){
    var tabs=[].slice.call(seg.querySelectorAll("[role=tab]"));
    function waehle(tab,fokus){
      tabs.forEach(function(t){var an=t===tab;t.classList.toggle("aktiv",an);t.setAttribute("aria-selected",an);t.tabIndex=an?0:-1;
        var p=document.getElementById(t.getAttribute("aria-controls"));if(p)p.hidden=!an});
      if(fokus)tab.focus();if(tab.id)history.replaceState(null,"","#"+tab.id);
    }
    tabs.forEach(function(t,i){
      t.addEventListener("click",function(){waehle(t,false)});
      t.addEventListener("keydown",function(e){var j=e.key==="ArrowRight"?i+1:e.key==="ArrowLeft"?i-1:null;
        if(j===null)return;e.preventDefault();waehle(tabs[(j+tabs.length)%tabs.length],true)});
    });
    var start=location.hash&&/^#[a-z]+$/.test(location.hash)&&seg.querySelector(location.hash);if(start)waehle(start,false);
    window.addEventListener("hashchange",function(){var t=/^#[a-z]+$/.test(location.hash)&&seg.querySelector(location.hash);if(t)waehle(t,false)});
  });

  // --- Zeilenwahl: Haekchen im Popover -> sofort speichern und Zeile zeigen ---
  var wurzel=document.querySelector(".akte2"), firma=wurzel&&wurzel.dataset.firma;
  document.querySelectorAll(".akte2-popover").forEach(function(pop){
    var kat=pop.dataset.kategorie, stand=pop.querySelector(".akte2-zeilen-stand");
    var panel=document.querySelector('[data-kategorie="'+kat+'"].akte2-kategorie');
    function zeigen(gewaehlt){
      panel.querySelectorAll("[data-zeile]").forEach(function(z){
        if(z.dataset.fest==="1")return;
        z.hidden = gewaehlt.indexOf(z.dataset.zeile)<0;
      });
      // Eine Gruppe ohne sichtbare Zeile verschwindet mit — und kommt wieder,
      // sobald eine ihrer Zeilen gewaehlt ist.
      panel.querySelectorAll("[data-gruppe-zeilen]").forEach(function(g){
        var ids=g.dataset.gruppeZeilen.split(",");
        g.hidden=!ids.some(function(id){var z=panel.querySelector('[data-zeile="'+id+'"]');return z&&!z.hidden});
      });
    }
    pop.addEventListener("change",function(){
      // Nur die GEWAEHLTEN Zeilen werden gemerkt — Zeilen mit Wert (gesperrt
      // angehakt) sind ohnehin sichtbar und gehoeren nicht in die Wahl.
      var gewaehlt=[].slice.call(pop.querySelectorAll("input[type=checkbox]:checked:not(:disabled)")).map(function(c){return c.value});
      zeigen(gewaehlt);
      if(stand)stand.textContent="wird gemerkt …";
      fetch("/crm/firma/"+firma+"/zeilen",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({kategorie:kat,zeilen:gewaehlt})})
        .then(function(r){return r.json()}).then(function(a){
          if(stand)stand.textContent=a.ok?"gemerkt":"nicht gespeichert: "+(a.grund||"");
          // Der Server hat die Liste gegen die Zeilenliste geprueft — was er
          // zurueckgibt, ist der Stand, der auch beim naechsten Laden gilt.
          if(a.ok&&Array.isArray(a.zeilen))zeigen(a.zeilen);
        }).catch(function(){if(stand)stand.textContent="nicht gespeichert — keine Verbindung"});
    });
  });

  // --- Speicherleiste: erscheint erst, wenn wirklich etwas geaendert wurde ---
  var formular=document.getElementById("akte"), leiste=document.getElementById("speicherleiste");
  if(formular&&leiste){
    function felder(){return Array.prototype.slice.call(formular.elements)}
    var start={};
    felder().forEach(function(el,i){if(!el.name)return;start[i]=el.type==="checkbox"||el.type==="radio"?el.checked:el.value});
    function geaendert(){return felder().some(function(el,i){if(!el.name)return false;
      var jetzt=el.type==="checkbox"||el.type==="radio"?el.checked:el.value;return jetzt!==start[i]})}
    var hinweisOben=document.getElementById("speicher-hinweis-oben"), knopfOben=document.getElementById("speichern-oben");
    function pruefen(){var offen=geaendert();leiste.hidden=!offen;if(hinweisOben)hinweisOben.hidden=!offen;if(knopfOben)knopfOben.hidden=!offen}
    document.addEventListener("input",function(ev){if(ev.target&&ev.target.form===formular)pruefen()});
    document.addEventListener("change",function(ev){if(ev.target&&ev.target.form===formular)pruefen()});
    var speichertGerade=false;
    // "Verwerfen" laedt neu — ohne die beforeunload-Frage, die sonst genau
    // hier aufginge (Pruefung 05.09.2026).
    window.akteVerwerfen=function(){speichertGerade=true;location.reload()};
    formular.addEventListener("submit",function(){speichertGerade=true;
      // Die Kategorie ueberlebt das Speichern: der Hash haengt an der Antwortadresse.
      var h=location.hash;if(h&&formular.action.indexOf("#")<0)formular.action=formular.action+h});
    window.addEventListener("beforeunload",function(ev){if(speichertGerade||!geaendert())return;ev.preventDefault();ev.returnValue=""});
  }

  // --- Ablage (Dokumente): Datei geht ROH im Rumpf raus, wie bisher ---
  var zone=document.getElementById("ablage"), feld=document.getElementById("ablage-feld"),
      liste=document.getElementById("ablage-liste"), artWahl=document.getElementById("dok-art"), hinweis=document.getElementById("dok-hinweis");
  if(zone){
    function groesse(b){return b<1024?b+" B":b<1048576?(b/1024).toFixed(0)+" KB":(b/1048576).toFixed(1)+" MB"}
    function hinweisSetzen(){hinweis.textContent=artWahl.value==="Rechnung an den Kunden"
      ?"Landet zusätzlich in der Buchhaltung unter „Rechnungen an Kunden“ und wartet dort auf die Prüfung."
      :"Bleibt in dieser Kundenakte. Die Buchhaltung sieht sie nicht."}
    artWahl.addEventListener("change",hinweisSetzen);hinweisSetzen();
    function hochladen(d,zeile){
      return fetch("/crm/firma/"+firma+"/dokument",{method:"POST",headers:{"Content-Type":"application/octet-stream",
        "X-Dateiname":encodeURIComponent(d.name),"X-Dateityp":d.type||"application/octet-stream","X-Art":encodeURIComponent(artWahl.value)},body:d})
        .then(function(r){return r.json()}).then(function(a){
          if(!a.ok){zeile.querySelector(".caption").textContent="Fehler: "+(a.grund||"unbekannt");return false}
          zeile.querySelector(".caption").textContent=a.doppelt?"liegt schon hier — nicht doppelt abgelegt":(a.ziel==="buchhaltung"?"gesichert · wartet in der Buchhaltung":"gesichert");return true})
        .catch(function(){zeile.querySelector(".caption").textContent="Fehler beim Hochladen";return false});
    }
    function zeigen(dateien){var alle=Array.prototype.slice.call(dateien);if(!alle.length)return;
      var aufgaben=alle.map(function(d){var z=document.createElement("div");z.className="ablage-datei";
        z.innerHTML='<span class="ablage-datei-name"></span><span class="caption"></span>';
        z.querySelector(".ablage-datei-name").textContent=d.name;z.querySelector(".caption").textContent=groesse(d.size)+" · wird gesichert …";
        liste.appendChild(z);return hochladen(d,z)});
      Promise.all(aufgaben).then(function(e){if(e.some(Boolean))setTimeout(function(){location.hash="#dokumente";location.reload()},900)});
    }
    zone.addEventListener("click",function(){feld.click()});
    feld.addEventListener("change",function(){zeigen(feld.files);feld.value=""});
    ["dragenter","dragover"].forEach(function(n){zone.addEventListener(n,function(ev){ev.preventDefault();zone.classList.add("drueber")})});
    ["dragleave","drop"].forEach(function(n){zone.addEventListener(n,function(ev){ev.preventDefault();zone.classList.remove("drueber")})});
    zone.addEventListener("drop",function(ev){zeigen(ev.dataTransfer.files)});
  }
})();
function osPopover(knopf){var p=document.getElementById(knopf.getAttribute("aria-controls"));var auf=p.hidden;p.hidden=!auf;knopf.setAttribute("aria-expanded",auf);
  if(!auf)return;function zu(e){if(e.type==="keydown"&&e.key!=="Escape")return;if(e.type==="click"&&(p.contains(e.target)||knopf.contains(e.target)))return;
    p.hidden=true;knopf.setAttribute("aria-expanded",false);document.removeEventListener("click",zu,true);document.removeEventListener("keydown",zu,true)}
  setTimeout(function(){document.addEventListener("click",zu,true);document.addEventListener("keydown",zu,true)},0)}
</script>`;
}

// ---- Das Blatt "Neuer Kunde" (auf /crm/kunden) ----------------------------
// Schlank: Firma zuerst, dann Kontakt, Zustaendigkeit, Umsatz, erste Aufgabe.
// ctx: { u, mitarbeiter, konst: { SPARTEN, BRANCHEN, ICON } }
function kundeNeuBlatt(ctx) {
  const { u, mitarbeiter = [], admin = false, fehler = "" } = ctx;
  const K = ctx.konst, ICON = K.ICON;
  const personen = (name, vorgabe) => `<select name="${name}">${mitarbeiter.map((m) => `<option value="${m.id}"${m.id === vorgabe ? " selected" : ""}>${e(m.name)}</option>`).join("")}</select>`;
  return `<dialog class="os-blatt" id="neu" aria-labelledby="neu-titel">
    <form method="post" action="/crm/kunden/anlegen">
      <header class="os-blatt-kopf">
        <div><h2 id="neu-titel">Neuer Kunde</h2><p class="os-blatt-unter">Lead oder Kunde anlegen — alles Weitere kommt in die Akte.</p></div>
        <button type="button" class="os-blatt-schliessen" aria-label="Schließen" onclick="this.closest('dialog').close()">${ICON.x}</button>
      </header>
      <div class="os-blatt-rumpf">
        ${fehler ? `<div class="os-hinweis os-hinweis--fehler">${ICON.warnung}<div>${fehler === "name"
          ? "<b>Der Firmenname fehlt.</b> Ohne Namen wird nichts angelegt."
          : "<b>Das hat nicht geklappt.</b> Die Firma wurde nicht angelegt — bitte noch einmal versuchen."}</div></div>` : ""}
        <section class="os-gruppe"><div class="os-gruppe-titel">Firma</div><div class="os-gruppe-rumpf">
          <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Firma / Praxis *</span>
            <div class="os-zeile-wert"><input name="name" required autofocus placeholder="z. B. Physiotherapie Sonnenhof"></div></label>
          <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Ansprechperson</span>
            <div class="os-zeile-wert"><input name="geschaeftsfuehrer" placeholder="z. B. Anna Weber"></div></label>
          <div class="os-zeile os-zeile--eingabe os-zeile--paar">
            <label class="os-zeile-teil"><span class="os-zeile-label">Telefon</span><div class="os-zeile-wert"><input name="telefon" type="tel" placeholder="+49 …"></div></label>
            <label class="os-zeile-teil"><span class="os-zeile-label">E-Mail</span><div class="os-zeile-wert"><input name="email" type="email" placeholder="info@…"></div></label>
          </div>
          <div class="os-zeile os-zeile--eingabe os-zeile--paar">
            <label class="os-zeile-teil"><span class="os-zeile-label">Ort</span><div class="os-zeile-wert"><input name="ort" placeholder="z. B. Dorfen"></div></label>
            <label class="os-zeile-teil"><span class="os-zeile-label">Branche</span><div class="os-zeile-wert"><select name="branche"><option value="">— offen —</option>
              ${Object.entries(K.BRANCHEN).map(([k, n]) => `<option value="${k}">${e(n)}</option>`).join("")}</select></div></label>
          </div>
        </div></section>
        <section class="os-gruppe"><div class="os-gruppe-titel">Zuständigkeit</div><div class="os-gruppe-rumpf">
          <div class="os-zeile os-zeile--eingabe os-zeile--paar">
            <label class="os-zeile-teil"><span class="os-zeile-label">Bereich</span><div class="os-zeile-wert"><select name="sparte">
              ${Object.entries(K.SPARTEN).map(([k, n]) => `<option value="${k}">${e(n)}</option>`).join("")}</select></div></label>
            <label class="os-zeile-teil"><span class="os-zeile-label">Status</span><div class="os-zeile-wert"><select name="status">
              <option value="lead">Lead</option><option value="kunde">Kunde</option></select></div></label>
          </div>
          ${/* Ein Mitarbeiter legt fuer sich selbst an — die Zeilenrechte lassen
               ihn keine fremde Zeile anlegen (500er in der Pruefung 05.09.2026).
               Das deaktivierte Feld schickt nichts mit; der Server nimmt ihn. */""}
          <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Verantwortlich</span>
            <div class="os-zeile-wert">${admin ? personen("besitzer", u.id) : `<select disabled><option>${e(u.name || "Ich")}</option></select>`}</div>
            ${admin ? "" : `<span class="os-zeile-hilfe">Übergabe später in der Akte durch einen Admin.</span>`}</label>
        </div></section>
        <section class="os-gruppe"><div class="os-gruppe-titel">Umsatz</div><div class="os-gruppe-rumpf">
          <div class="os-zeile os-zeile--eingabe os-zeile--paar">
            <label class="os-zeile-teil"><span class="os-zeile-label">Umsatz geschätzt</span><div class="os-zeile-wert"><input name="umsatz_geschaetzt" type="number" step="1" min="0" inputmode="decimal" placeholder="0 €"></div></label>
            <label class="os-zeile-teil"><span class="os-zeile-label">Umsatz geplant</span><div class="os-zeile-wert"><input name="umsatz_geplant" type="number" step="1" min="0" inputmode="decimal" placeholder="0 €"></div></label>
          </div>
        </div><div class="os-gruppe-fuss">Eins von beiden reicht: Schätzung aus dem Bauchgefühl — oder der fest besprochene Preis. Zählt im Pipeline-Volumen, bis die erste Rechnung gestellt ist.</div></section>
        <section class="os-gruppe"><div class="os-gruppe-titel">Erste Aufgabe <span class="os-gruppe-unter">optional</span></div><div class="os-gruppe-rumpf">
          <div class="os-zeile os-zeile--eingabe os-zeile--paar">
            <label class="os-zeile-teil"><span class="os-zeile-label">Aufgabe</span><div class="os-zeile-wert"><input name="aufgabe_titel" placeholder="z. B. Erstgespräch vorbereiten"></div></label>
            <label class="os-zeile-teil"><span class="os-zeile-label">Verantwortlich</span><div class="os-zeile-wert">${personen("aufgabe_verantwortlich", u.id)}</div></label>
          </div>
        </div><div class="os-gruppe-fuss">Landet auf dem Whiteboard der verantwortlichen Person, Kategorie „Kunden".</div></section>
      </div>
      <footer class="os-blatt-fuss">
        <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
        <button type="submit" class="dunkel">Kunden anlegen</button>
      </footer>
    </form>
  </dialog>
  <script>document.querySelectorAll("dialog.os-blatt").forEach(function(d){d.addEventListener("click",function(e){if(e.target===d)d.close()})});
  ${fehler ? 'document.getElementById("neu").showModal();' : ""}</script>`;
}

module.exports = {
  KATEGORIEN, ZEILEN,
  hatWert, zeilenFuer, zeilenSichtbar, zeilenPruefen, auswahlWert,
  pipelineBeitrag, pipelineSumme, bezahltProzent, abschlagText,
  akteSeite, kundeNeuBlatt,
};
