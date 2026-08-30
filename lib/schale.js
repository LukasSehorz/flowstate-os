// Gemeinsame Huelle fuer das ganze Operating System.
// Rail links bleibt stehen, der Inhalt in der Mitte wechselt — das CRM ist
// ein Bereich darin, keine zweite Anwendung. server.js und crm-routes.js
// rendern beide hierueber, damit es genau ein Geruest gibt.

const fs = require("fs");
const path = require("path");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Cache-Stempel fuer Skript und Stylesheets (Fix 24.07.).
// Browser cachen /sprache.js und /crm.css aggressiv. Ohne Stempel laeuft nach
// einem Deploy im Browser die ALTE Datei weiter — ein bereits behobener Fehler
// wirkt dann fort und man sucht ihn im Code, wo er gar nicht mehr steht.
// Der Stempel ist die Aenderungszeit der Datei: neue Datei -> neue URL ->
// der Browser holt sie frisch, ohne dass jemand Strg+F5 druecken muss.
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

// Vorname abgekuerzt, Nachname ausgeschrieben: "Jannik vom Hofe" -> "J. vom Hofe"
const kurzname = (name) => {
  const teile = String(name || "").trim().split(/\s+/);
  return teile.length < 2 ? name : `${teile[0][0]}. ${teile.slice(1).join(" ")}`;
};

// Bisher nur Janniks Profilbild hinterlegt — weitere per E-Mail ergaenzen, sobald vorhanden.
//
// Der Schluessel ist der Teil VOR dem @, nicht die ganze Adresse (24.08.2026).
// Sonst haengt das Bild an der Domaene: Beim Wechsel von flowstate-ai.net auf
// svhconsult.de waere Janniks Bild kommentarlos verschwunden, und niemand
// haette den Zusammenhang zur Umstellung gesehen.
const PROFILBILDER = { jannikvomhofe: "/bilder/profil-jannik.jpg" };
const profilbild = (mail) =>
  PROFILBILDER[String(mail || "").toLowerCase().split("@")[0]] || null;

const S = (d, b = 24) => `<svg viewBox="0 0 ${b} ${b}" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

// Wie der Agent heisst. Fuer die Werbeaufnahmen laeuft er als "Jarvis";
// ohne AGENT_NAME bleibt alles wie bisher.
const AGENT = process.env.AGENT_NAME || "Alexandra";

const ICON = {
  logo: S('<path d="M4 7h16M4 12h10M4 17h7"/>'),
  zentrale: S('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  funke: S('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/><circle cx="12" cy="12" r="3"/>'),
  leads: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>'),
  kunden: S('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>'),
  beleg: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
  euro: S('<path d="M17 6a7 7 0 1 0 0 12M4 10h8M4 14h8"/>'),
  marketing: S('<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
  projekte: S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  wissen: S('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  agenten: S('<path d="m12 2 8.5 5v10L12 22 3.5 17V7z"/><circle cx="12" cy="12" r="3"/>'),
  zahnrad: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  webdesign: S('<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M2 9h20M6 6.5h.01"/>'),
  megafon: S('<path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  chip: S('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
  team: S('<path d="M12 2v6M8.5 5.5 12 8l3.5-2.5"/><circle cx="12" cy="12" r="3"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  sonne: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  mond: S('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  abmelden: S('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  suche: S('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  kalender: S('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  glocke: S('<path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  todo: S('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>'),
  whiteboard: S('<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="M8 10c1.3 1.5 2.7-1.5 4 0s2.7-1.5 4 0"/><path d="m7 21 5-5 5 5"/>'),
};

// Die eine Navigation. "unter" erscheint eingerueckt, sobald das Modul aktiv ist —
// so bleibt die Rail schmal, zeigt aber im CRM dessen Bereiche.
//
// WER EINEN NEUEN BEREICH BAUT, AENDERT DIESE LISTE NICHT (Regel ab 26.07.).
// Stattdessen traegt sich das Bereichsmodul selbst ein:
//
//   const { eintragen } = require("./schale.js");
//   eintragen({ id: "marketing", titel: "Marketing & Content",
//               icon: "marketing", href: "/marketing", nach: "buchhaltung" });
//
// Grund: Diese Datei ist die einzige, die ALLE anfassen muessten — und genau
// hier ist am 26.07. der erste Merge-Konflikt entstanden (dabei waere um ein
// Haar der Weiss-Modus verschwunden). Wenn jeder Bereich seinen Eintrag
// mitbringt, beruehrt "Marketing bauen" nur marketing-routes.js. Da Lukas und
// Jannik jetzt beide direkt auf main arbeiten, ist das keine Feinheit mehr,
// sondern die Voraussetzung dafuer, dass es gutgeht.
const MODULE = [
  { id: "zentrale", titel: "Zentrale", icon: "zentrale", href: "/", gruppe: "Übersicht" },
  { id: "chat", titel: AGENT, icon: "funke", href: "/chat", gruppe: "Assistenz" },
  { id: "sprache", titel: "Sprache", icon: "megafon", href: "/sprache" },
  { id: "leads", titel: "Lead-Maschine", icon: "leads", href: "/leads", gruppe: "Vertrieb" },
  {
    id: "crm", titel: "Kunden & CRM", icon: "kunden", href: "/crm",
    unter: [
      { id: "crm-start", titel: "CRM-Dashboard", icon: "zentrale", href: "/crm" },
      { id: "crm-leads", titel: "Leads", icon: "leads", href: "/crm/leads" },
      { id: "crm-kunden", titel: "Kunden", icon: "kunden", href: "/crm/kunden" },
      { id: "crm-webdesign", titel: "Webdesign", icon: "webdesign", href: "/crm/pipeline?sparte=webdesign" },
      { id: "crm-performance", titel: "Performance Marketing", icon: "megafon", href: "/crm/pipeline?sparte=performance" },
      { id: "crm-ki", titel: "KI-Projekte", icon: "chip", href: "/crm/pipeline?sparte=ki" },
      { id: "crm-team", titel: "Team-Leistung", icon: "team", href: "/crm/team", nurAdmin: true },
    ],
  },
  { id: "angebote", titel: "Angebote & Rechnungen", icon: "beleg", href: "/angebote", gruppe: "Finanzen" },
  { id: "buchhaltung", titel: "Buchhaltung", icon: "euro", href: "/buchhaltung" },
  { id: "marketing", titel: "Marketing & Content", icon: "marketing", href: "/marketing", gruppe: "Marketing & Projekte" },
  { id: "projekte", titel: "Projekte", icon: "projekte", href: "/projekte" },
  { id: "wissen", titel: "Wissen", icon: "wissen", href: "/wissen" },
  { id: "agenten", titel: "Agenten & Skills", icon: "agenten", href: "/agenten", gruppe: "System" },
  { id: "einstellungen", titel: "Einstellungen", icon: "zahnrad", href: "/einstellungen" },
];

// Einen Bereich in die Navigation eintragen — der Weg fuer neue Module.
//
//   eintragen({ id, titel, icon, href })                  // ans Ende
//   eintragen({ ..., nach: "buchhaltung" })               // hinter ein Modul
//   eintragen({ ..., gruppe: "Marketing & Projekte" })    // mit Zwischenueberschrift
//   eintragen({ ..., unter: [ {id,titel,icon,href}, … ] })// mit Unterpunkten
//   eintragen({ ..., nurAdmin: true })                    // nur fuer Admins
//
// Ist die id schon da, wird der bestehende Eintrag ERGAENZT statt verdoppelt.
// So darf ein Modul auch einen Platzhalter aus der Liste oben uebernehmen, ohne
// dass er zweimal in der Rail steht.
//
// icon: ein Schluessel aus ICON (siehe oben). Unbekannte Namen faellt auf
// "projekte" zurueck, damit ein Tippfehler nicht die halbe Rail zerlegt.
function eintragen(modul) {
  if (!modul || !modul.id || !modul.titel || !modul.href) {
    console.error("schale.eintragen: id, titel und href sind Pflicht —", modul);
    return;
  }
  if (!ICON[modul.icon]) modul.icon = "projekte";

  const vorhanden = MODULE.findIndex((m) => m.id === modul.id);
  if (vorhanden >= 0) {
    // Unterpunkte werden ZUSAMMENGEFUEHRT, nicht ersetzt (27.07.).
    //
    // Vorher gewann der letzte Aufrufer: kalender-routes.js haengt "Kalender"
    // unter die Zentrale, todo-routes.js haengt "To-Dos" darunter — und wer als
    // zweiter lief, loeschte den Eintrag des ersten. Das faellt nicht als
    // Fehler auf, sondern als fehlender Menuepunkt, und die Ursache liegt dann
    // in der Ladereihenfolge in server.js. Genau so eine Falle soll ein Modul,
    // das sich selbst eintraegt, nicht stellen.
    //
    // Gleiche id = derselbe Punkt, der neue Stand gewinnt. Neue Punkte haengen
    // sich hinten an, oder hinter den in "nach" genannten Punkt.
    const alt = MODULE[vorhanden];
    const zusammen = { ...alt, ...modul };
    if (alt.unter && modul.unter) {
      const liste = alt.unter.slice();
      for (const u of modul.unter) {
        const i = liste.findIndex((x) => x.id === u.id);
        if (i >= 0) { liste[i] = { ...liste[i], ...u }; continue; }
        const nach = u.nach ? liste.findIndex((x) => x.id === u.nach) : -1;
        if (nach >= 0) liste.splice(nach + 1, 0, u); else liste.push(u);
      }
      zusammen.unter = liste;
    }
    MODULE[vorhanden] = zusammen;
    return;
  }

  if (modul.nach) {
    const i = MODULE.findIndex((m) => m.id === modul.nach);
    if (i >= 0) { MODULE.splice(i + 1, 0, modul); return; }
  }
  MODULE.push(modul);
}

// Ein Untereintrag ist aktiv -> auch sein Modul gilt als aktiv.
function modulVon(aktiv) {
  const m = MODULE.find((x) => x.id === aktiv || (x.unter || []).some((u) => u.id === aktiv));
  return m ? m.id : aktiv;
}

// Darf diese Person den Bereich oeffnen?
//
// Die Geschaeftsfuehrung sieht alles — geprueft ueber die Rolle, nicht ueber
// eine Liste. So funktioniert ein neuer Admin sofort, ohne dass jemand daran
// denken muss, ihm Bereiche einzutragen.
//
// Wer nur mit dem gemeinsamen Passwort da ist (kein persoenliches Konto),
// bekommt ebenfalls alles zu sehen: die Rail ist dann dieselbe wie bisher, und
// die einzelnen Bereiche fragen selbst nach der Anmeldung. Sonst waere die
// Navigation je nach Anmeldeweg eine andere.
//
// WICHTIG: Das hier blendet nur aus. Die echte Sperre steht als Torwaechter in
// server.js — sonst kaeme man mit einer getippten Adresse trotzdem hinein.
function darfModul(nutzer, id) {
  if (!nutzer || nutzer.rolle === "admin") return true;
  return (nutzer.module || []).includes(id);
}

function navigation(aktiv, nutzer) {
  const offen = modulVon(aktiv);
  return MODULE.filter((m) => darfModul(nutzer, m.id)).map((m) => {
    const istAktiv = m.id === offen;
    const kopf = m.gruppe ? `<div class="rail-gruppe">${e(m.gruppe)}</div>` : "";
    const zeile = `${kopf}<a href="${m.href}" class="${istAktiv && m.id === aktiv ? "aktiv" : istAktiv ? "offen" : ""}"
      title="${e(m.titel)}">${ICON[m.icon]}<span class="rail-wort">${e(m.titel)}</span></a>`;
    if (!istAktiv || !m.unter) return zeile;
    // Ein Unterpunkt wird nur dann geprueft, wenn er einen eigenen Bereich
    // meint: entweder weil er ihn mit "modul" benennt (To-Dos liegen unter der
    // Zentrale, sind aber ein eigener Bereich), oder weil seine id selbst ein
    // Bereich ist (Kalender). "CRM-Dashboard" oder "Leads" gehoeren zum
    // Elternbereich und brauchen keine zweite Pruefung — wer das CRM darf,
    // darf auch dessen Unterseiten.
    const bereiche = new Set(MODULE.map((x) => x.id));
    const kinder = m.unter
      .filter((u) => !u.nurAdmin || (nutzer && nutzer.rolle === "admin"))
      .filter((u) => {
        const id = u.modul || (bereiche.has(u.id) ? u.id : null);
        return id === null || darfModul(nutzer, id);
      })
      .map((u) => `<a href="${u.href}" class="rail-unter ${u.id === aktiv ? "aktiv" : ""}"
        title="${e(u.titel)}">${ICON[u.icon]}<span class="rail-wort">${e(u.titel)}</span></a>`).join("");
    return zeile + `<div class="rail-gruppe-unter">${kinder}</div>`;
  }).join("");
}

/**
 * Baut die komplette Seite.
 * @param {object} o
 * @param {string} o.titel      Ueberschrift in der Topbar
 * @param {string} o.aktiv      id des aktiven Moduls oder Untereintrags
 * @param {string} o.inhalt     HTML des Hauptbereichs
 * @param {string} [o.unterzeile]
 * @param {string} [o.reiter]   Reiterleiste unter der Topbar
 * @param {object} [o.nutzer]   angemeldete Person (Name, Rolle) — sonst nur Abmelden
 * @param {string} [o.suche]    Platzhalter im Suchfeld; leer = kein Suchfeld
 */
function schale({ titel, aktiv, inhalt, unterzeile = "", reiter = "", nutzer = null, suche = "", hinweise = [] }) {
  const init = nutzer ? nutzer.name.split(" ").map((t) => t[0]).slice(0, 2).join("") : "?";
  const heute = new Date().toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long" });

  // Naechster Termin. Bis zum 28.07. stand hier ein fest verdrahteter
  // "Erstgespräch Herr Müller in 40 Minuten" — auf JEDER Seite, den ganzen Tag,
  // fuer jeden Nutzer. Das war als Platzhalter gedacht, sah aber wie ein echter
  // Termin aus, und vor dem Einpflegen der echten Daten muss so etwas weg: eine
  // Oberflaeche, die Dinge behauptet, die es nicht gibt, ist schlimmer als eine
  // leere. Sobald die Kalenderanbindung den naechsten Termin liefert
  // (lib/kalender.js kann die Spanne schon), wird er hier durchgereicht — die
  // Anzeige darunter bleibt unveraendert und greift dann von selbst.
  const naechsterTermin = null;
  const terminMinuten = naechsterTermin
    ? Math.round((naechsterTermin.zeit - Date.now()) / 60000) : -1;
  const terminVorhanden = Boolean(nutzer && naechsterTermin && terminMinuten >= 0);
  const terminSichtbar = terminVorhanden && terminMinuten <= 60;

  // Benachrichtigungsglocke — allgemeines Postfach fuer alles Wichtige (neue Leads,
  // abgeschlossene Deals, Kunden-Mails, neue Termine im gemeinsamen Kalender, ...).
  // Die vier Demo-Meldungen ("Neuer Lead erhalten: Müller GmbH" …) sind am
  // 28.07. raus, aus demselben Grund wie der Dummy-Termin. Es bleiben die
  // ECHTEN Hinweise, die der Aufrufer uebergibt — z. B. ueberfaellige Deals aus
  // dem CRM-Dashboard. Kommen keine, ist die Glocke leer, und das stimmt dann auch.
  const BENACHRICHTIGUNGEN = nutzer ? [...hinweise] : [];
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${e(titel)} · flowstateOS</title>
<link rel="stylesheet" href="${v("/crm.css")}"><link rel="stylesheet" href="${v("/style.css")}">
<link rel="stylesheet" href="${v("/mobil.css")}">
<!-- Der Jarvis-HUD (18.08.): gilt nur fuer die Sprachseite und die Zentrale,
     erkennbar an body.jarvis. Steht NACH den anderen drei, damit er dort
     gewinnt, und faerbt ohne diese Klasse keinen einzigen Pixel um. Eigene
     Dateien statt Anbau an crm.css, weil beide Seiten abgefilmt werden und
     ihre Optik sich unabhaengig von den Arbeitsansichten weiterentwickelt. -->
<link rel="stylesheet" href="${v("/jarvis.css")}">
<link rel="stylesheet" href="${v("/jarvis-gehirn.css")}">
<link rel="stylesheet" href="${v("/jarvis-hud.css")}">
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${AGENT}">
<!-- "black" statt "black-translucent": Letzteres saehe auf der dunklen
     Sprachbuehne randlos schoener aus, macht aber die Statuszeilen-Schrift auf
     den HELLEN Dashboard-Seiten weiss auf weiss. Lesbarkeit ueberall schlaegt
     Optik auf einer Seite. -->
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<link rel="apple-touch-icon" href="/bilder/pwa-icon-192.png">
${aktiv === "sprache" ? '<meta name="theme-color" content="#060a12">' : ""}
<script>
  // Manifest und Worker bewusst OHNE Cache-Stempel: Eine wechselnde URL waere
  // bei jedem Deploy eine ANDERE App bzw. ein zweiter Worker daneben.
  // Aenderungen an /sw.js erkennt der Browser selbst.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
</script>
<script>
  // Vor dem ersten Malen setzen, sonst blitzt die helle Fassung kurz auf.
  (function(){var t=localStorage.getItem("flowstate-thema")||"light";
   document.documentElement.setAttribute("data-theme",t);
   if(localStorage.getItem("flowstate-weiss")==="1")
     document.documentElement.setAttribute("data-weiss","1");})();
${/*
  Die Graphit-Palette (public/crm.css, body.crm-dashboard-design) haengt an
  dieser einen Klasse: Hintergrund, Kartenverlaeufe, Raender, Schatten und
  --blau-* werden dort komplett getauscht. Welche Seite sie bekommt, entscheidet
  allein diese Liste.

  Die Zentrale ist am 27.07. dazugekommen. Sie stand als einzige Uebersicht noch
  im Blau-Theme, waehrend CRM, Buchhaltung und Content laengst Graphit tragen —
  und ausgerechnet die Startseite, von der aus man in genau diese Bereiche geht,
  sah dadurch aus wie eine andere Anwendung. Der Aufbau der Seite aendert sich
  dadurch nicht, nur die Farben.
*/""}</script></head><body${/^(crm|buchhaltung|content|zentrale)/.test(String(aktiv)) ? ' class="crm-dashboard-design"' : ""}>
<div class="shell">
  <aside class="rail">
    <a class="rail-marke" href="/"><div class="rail-logo">${ICON.logo}</div>
      <span class="rail-wort" style="font-weight:700;font-size:15px">flowstate<em style="color:var(--primary);font-style:normal">OS</em></span></a>
    <nav class="rail-nav">${navigation(aktiv, nutzer)}</nav>
    <div class="rail-nutzer"><div class="rail-avatar">${e(init)}</div>
      <span class="rail-wort"><span style="display:block;font-weight:600">${e(nutzer ? nutzer.name : "Angemeldet")}</span>
      <span style="display:block;font-size:11.5px;color:var(--text-muted)">${
        nutzer ? (nutzer.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter") : "gemeinsames Passwort"}</span></span></div>
    <a href="/logout" title="Abmelden">${ICON.abmelden}<span class="rail-wort">Abmelden</span></a>
  </aside>
  <div class="inhalt">
    <header class="topbar">
      <div><div class="topbar-titel">${e(titel)}</div>${unterzeile ? `<div class="caption">${unterzeile}</div>` : ""}</div>
      ${suche ? `<div class="topbar-suche">${ICON.suche}
        <input type="search" placeholder="${e(suche)}"><span class="kbd">⌘K</span></div>` : ""}
      <div class="topbar-rechts">
        ${nutzer ? `<div class="glocke-huelle">
          <button class="glocke still" id="glocke-knopf" onclick="glockeUmschalten()" title="Benachrichtigungen"
            aria-label="Benachrichtigungen" data-benachrichtigungen='${JSON.stringify(BENACHRICHTIGUNGEN).replace(/&/g, "&amp;").replace(/'/g, "&#39;")}'>
            ${ICON.glocke}<span class="glocke-punkt" id="glocke-punkt" style="display:none"></span>
          </button>
          <div class="glocke-popup" id="glocke-popup" style="display:none">
            <div class="glocke-popup-liste" id="glocke-popup-liste"></div>
            <div class="dialog-fuss"><button type="button" class="klein" onclick="glockeGesehen()">Gesehen</button></div>
          </div>
        </div>` : ""}
        ${terminSichtbar ? `<div class="termin-hinweis">${ICON.kalender}<span>${e(naechsterTermin.titel)}</span>
          <b class="termin-minuten">in ${terminMinuten} Minuten</b></div>` : ""}
        <button class="thema-schalter still" onclick="themaWechseln()" title="Hell / Dunkel umschalten"
          aria-label="Hell oder Dunkel umschalten">${ICON.sonne}${ICON.mond}</button>
        <button class="weiss-schalter still" id="weiss-knopf" onclick="weissWechseln()"
          title="Schlichtes Weiß ein/aus (augenschonend bei Blaulichtfilter)"
          aria-label="Schlichtes Weiß umschalten"><span id="weiss-wort">Weiß</span></button>
        <div class="datum-chip">${ICON.kalender} ${e(heute)}</div>
        ${nutzer ? `<div class="stoppuhr" id="stoppuhr" style="display:none">
          <span class="stoppuhr-zeit" id="stoppuhr-zeit">00:00:00</span>
          <button id="stoppuhr-pause" onclick="zeitAktion('pause')" style="display:none">Pause</button>
          <button id="stoppuhr-weiter" onclick="zeitAktion('start')" style="display:none">Start</button>
          <button class="feierabend" id="stoppuhr-ende"
            data-termin='${terminVorhanden ? JSON.stringify({ titel: naechsterTermin.titel, minuten: terminMinuten }).replace(/&/g, "&amp;").replace(/'/g, "&#39;") : ""}'
            onclick="feierabendOeffnen()" style="display:none">Feierabend</button>
        </div>
        <dialog id="terminWarnungDialog"><h2>Stopp!</h2>
          <div class="sub">Du hast einen Termin in <b id="termin-warnung-dauer">–</b>:
            <b id="termin-warnung-titel"></b></div>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="document.getElementById('terminWarnungDialog').close(); zeitAktion('start')">Ich bleibe</button>
            <button type="button" class="gefahr" onclick="terminWarnungWeiter()">Ja, fortfahren</button>
          </div>
        </dialog>
        <dialog id="feierabendDialog"><h2>Feierabend</h2>
          <div class="sub">Bist du sicher, dass du deinen Arbeitstag beenden willst?</div>
          <div class="resuemee">
            <h3>Resümee des Tages</h3>
            <div class="resuemee-zeile"><span>Aufgaben abgearbeitet</span><b id="res-aufgaben">– von –</b></div>
            <div class="resuemee-spalten">
              <div><div class="resuemee-haupt"><span>Cold Calls</span><b id="res-anrufe">–</b></div>
                <div class="resuemee-unter"><span>davon gebucht</span><b id="res-gebucht">–</b><b class="resuemee-prozent" id="res-gebucht-proz"></b></div>
              </div>
              <div><div class="resuemee-haupt"><span>Erstgespräche geführt</span><b id="res-gefuehrt">–</b><b class="resuemee-prozent" id="res-gefuehrt-proz"></b></div>
                <div class="resuemee-unter"><span>davon geclosed</span><b id="res-geclosed">–</b><b class="resuemee-prozent" id="res-geclosed-proz"></b></div>
              </div>
            </div>
            <div class="resuemee-zeile"><span>Tagesumsatz</span><span><b id="res-umsatz">–</b><b class="resuemee-prozent" id="res-umsatz-proz"></b></span></div>
            <div class="resuemee-zeile"><span>Arbeitszeit des Tages</span><span><b id="res-arbeitszeit">–</b><b class="resuemee-prozent" id="res-arbeitszeit-proz"></b></span></div>
          </div>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="document.getElementById('feierabendDialog').close(); zeitAktion('start')">Nein, ich bleibe</button>
            <button type="button" class="gefahr" onclick="feierabendBestaetigt()">Ja, fortfahren</button>
          </div>
        </dialog>` : ""}
        ${nutzer ? `<div class="nutzer-block"><div class="nutzer-name">${e(kurzname(nutzer.name))}</div></div>
        ${profilbild(nutzer.email)
          ? `<img class="avatar" src="${profilbild(nutzer.email)}" alt="${e(nutzer.name)}">`
          : `<div class="avatar">${e(init)}</div>`}` : ""}
      </div>
    </header>
    ${reiter}
    <main>${inhalt}</main>
  </div>
</div>
<script>
function themaWechseln(){
  var w = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", w);
  localStorage.setItem("flowstate-thema", w);
}
// Schlichtes Weiss ein/aus (Wunsch Lukas: bei Blaulichtfilter augenschonend).
function weissAnzeige(){
  var an = document.documentElement.getAttribute("data-weiss") === "1";
  var k = document.getElementById("weiss-knopf"), w = document.getElementById("weiss-wort");
  if (w) w.textContent = an ? "Weiß ✓" : "Weiß";
  if (k) k.classList.toggle("aktiv", an);
}
function weissWechseln(){
  var an = document.documentElement.getAttribute("data-weiss") === "1";
  if (an){ document.documentElement.removeAttribute("data-weiss"); localStorage.removeItem("flowstate-weiss"); }
  else   { document.documentElement.setAttribute("data-weiss","1"); localStorage.setItem("flowstate-weiss","1"); }
  weissAnzeige();
}
weissAnzeige();
(function(){
  var el = document.getElementById("stoppuhr");
  if (!el) return;
  // Seit 0026 gibt es keine Abschaltung wegen Untaetigkeit mehr — die Uhr laeuft,
  // bis jemand Pause, Abmelden oder Feierabend drueckt. Der Herzschlag holt nur
  // noch den Stand ab (zwei Tabs, Aufwachen aus dem Ruhezustand); er traegt keine
  // Zeit mehr nach, die steckt jetzt in laeuft_seit auf dem Server.
  var HERZSCHLAG_MS = 30 * 1000;
  var zeitEl = document.getElementById("stoppuhr-zeit");
  var btnPause = document.getElementById("stoppuhr-pause");
  var btnWeiter = document.getElementById("stoppuhr-weiter");
  var btnEnde = document.getElementById("stoppuhr-ende");

  var basisSekunden = 0, seitWann = Date.now(), laeuft = false, tickTimer = null;

  function formatiere(sek) {
    sek = Math.max(0, Math.floor(sek));
    var h = Math.floor(sek / 3600), m = Math.floor((sek % 3600) / 60), s = sek % 60;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(h) + ":" + p(m) + ":" + p(s);
  }

  function anzeigen() {
    zeitEl.textContent = formatiere(basisSekunden + (laeuft ? (Date.now() - seitWann) / 1000 : 0));
  }

  function zustandUebernehmen(daten) {
    // Kein Row (erster Login des Tages) oder per Feierabend beendet -> die Uhr
    // startet von selbst, es gibt keinen manuellen Erst-Start-Knopf mehr.
    if (daten.status === "keine" || daten.status === "beendet") {
      window.zeitAktion("start");
      return;
    }
    basisSekunden = daten.sekunden;
    seitWann = Date.now();
    laeuft = daten.status === "gestartet";
    btnPause.style.display = laeuft ? "" : "none";
    btnWeiter.style.display = laeuft ? "none" : "";
    btnEnde.style.display = "";
    anzeigen();
    if (tickTimer) clearInterval(tickTimer);
    if (laeuft) tickTimer = setInterval(anzeigen, 1000);
  }

  function anfragen(pfad, methode) {
    return fetch(pfad, { method: methode }).then(function (r) { return r.json(); });
  }

  window.zeitAktion = function (aktion) {
    return anfragen("/crm/zeit/" + aktion, "POST").then(zustandUebernehmen);
  };

  function prozentBadge(id, wert) {
    var el = document.getElementById(id);
    el.textContent = (wert > 0 ? "+" : "") + wert + "%";
    el.classList.remove("gruen", "rot");
    el.classList.add(wert >= 0 ? "gruen" : "rot");
  }

  function feierabendResuemeeLaden() {
    fetch("/crm/zeit/resuemee").then(function (r) { return r.json(); }).then(function (d) {
      document.getElementById("res-aufgaben").textContent = d.aufgaben.erledigt + " von " + d.aufgaben.gesamt;
      document.getElementById("res-anrufe").textContent = d.anrufe;
      document.getElementById("res-gebucht").textContent = d.erstgespraeche.gebucht;
      document.getElementById("res-gefuehrt").textContent = d.erstgespraeche.gefuehrt;
      document.getElementById("res-geclosed").textContent = d.erstgespraeche.geclosed;
      document.getElementById("res-umsatz").textContent = Math.round(d.tagesumsatz).toLocaleString("de-DE") + " €";
      document.getElementById("res-arbeitszeit").textContent = formatiere(d.arbeitszeit_sekunden);
      prozentBadge("res-gebucht-proz", d.erstgespraeche.gebucht_prozent);
      prozentBadge("res-gefuehrt-proz", d.erstgespraeche.gefuehrt_prozent);
      prozentBadge("res-geclosed-proz", d.erstgespraeche.geclosed_prozent);
      prozentBadge("res-umsatz-proz", d.tagesumsatz_prozent);
      prozentBadge("res-arbeitszeit-proz", d.arbeitszeit_prozent);
      document.getElementById("feierabendDialog").showModal();
    });
  }

  function terminDauerText(minuten) {
    if (minuten < 60) return minuten + " Minuten";
    var h = Math.floor(minuten / 60), m = minuten % 60;
    return h + " Stunde" + (h === 1 ? "" : "n") + (m ? " " + m + " Minute" + (m === 1 ? "" : "n") : "");
  }

  // Steht noch IRGENDEIN Termin heute an (siehe data-termin am Feierabend-Knopf, unabhaengig
  // von der 60-Minuten-Schwelle des Header-Badges), warnt erst ein Zwischen-Dialog,
  // bevor das Resuemee kommt.
  window.feierabendOeffnen = function () {
    var terminJson = btnEnde.getAttribute("data-termin");
    var termin = terminJson ? JSON.parse(terminJson) : null;
    if (termin) {
      document.getElementById("termin-warnung-dauer").textContent = terminDauerText(termin.minuten);
      document.getElementById("termin-warnung-titel").textContent = termin.titel;
      document.getElementById("terminWarnungDialog").showModal();
    } else {
      feierabendResuemeeLaden();
    }
  };

  window.terminWarnungWeiter = function () {
    document.getElementById("terminWarnungDialog").close();
    feierabendResuemeeLaden();
  };

  window.feierabendBestaetigt = function () {
    anfragen("/crm/zeit/ende", "POST").then(function () { location.href = "/crm/abmelden"; });
  };

  setInterval(function () {
    if (!laeuft) return;
    anfragen("/crm/zeit/herzschlag", "POST").then(zustandUebernehmen);
  }, HERZSCHLAG_MS);

  // Nach dem Aufwachen aus dem Ruhezustand oder beim Zurueckwechseln auf den Tab
  // ist die im Browser hochgezaehlte Anzeige veraltet. Einmal den echten Stand
  // vom Server holen — gerechnet wird dort ohnehin.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) anfragen("/crm/zeit/status", "GET").then(zustandUebernehmen);
  });

  anfragen("/crm/zeit/status", "GET").then(function (daten) {
    el.style.display = "";
    zustandUebernehmen(daten);
    // Jeder Seitenaufruf zaehlt als Aktivitaet — ohne das wuerde "letzte_aktivitaet" am
    // Server veralten, wenn man schneller zwischen Seiten wechselt als der 15-Sek-Herzschlag
    // greift (jede Navigation laedt das Skript neu, der Intervall faengt bei 0 an).
    if (daten.status === "gestartet") anfragen("/crm/zeit/herzschlag", "POST").then(zustandUebernehmen);
  });
})();
(function () {
  var knopf = document.getElementById("glocke-knopf");
  if (!knopf) return;
  var punkt = document.getElementById("glocke-punkt");
  var popup = document.getElementById("glocke-popup");
  var liste = document.getElementById("glocke-popup-liste");
  var alle = JSON.parse(knopf.getAttribute("data-benachrichtigungen") || "[]");
  var GESEHEN_KEY = "flowstate-glocke-gesehen";

  // Navigation zwischen Seiten (Klick auf einen Menuepunkt) ist im CRM technisch auch
  // ein vollstaendiger Seitenaufruf — deshalb reicht ein simpler In-Memory-Reset nicht,
  // sonst bimmelt es bei jedem Seitenwechsel neu. sessionStorage ueberlebt Navigation
  // (bleibt bis der Tab zu ist); nur ein ECHTES Neuladen (F5) setzt "gesehen" zurueck.
  function istEchtesNeuladen() {
    try {
      var eintrag = performance.getEntriesByType("navigation")[0];
      if (eintrag) return eintrag.type === "reload";
      return performance.navigation && performance.navigation.type === 1;
    } catch (e) { return false; }
  }
  if (istEchtesNeuladen()) sessionStorage.removeItem(GESEHEN_KEY);

  function gesehenIds() {
    try { return JSON.parse(sessionStorage.getItem(GESEHEN_KEY) || "[]"); } catch (e) { return []; }
  }

  function ungelesen() {
    var gesehen = gesehenIds();
    return alle.filter(function (n) { return gesehen.indexOf(n.id) === -1; });
  }

  function anzeigenAktualisieren() {
    var u = ungelesen();
    if (u.length) {
      punkt.style.display = "";
      knopf.classList.add("klingelt");
    } else {
      punkt.style.display = "none";
      knopf.classList.remove("klingelt");
    }
    liste.innerHTML = u.length
      ? u.map(function (n) { return '<div class="glocke-popup-eintrag">' + n.text.replace(/</g, "&lt;") + "</div>"; }).join("")
      : '<div class="glocke-popup-leer">Keine neuen Benachrichtigungen.</div>';
  }

  window.glockeUmschalten = function () {
    popup.style.display = popup.style.display === "none" ? "" : "none";
  };

  window.glockeGesehen = function () {
    sessionStorage.setItem(GESEHEN_KEY, JSON.stringify(alle.map(function (n) { return n.id; })));
    anzeigenAktualisieren();
    popup.style.display = "none";
  };

  document.addEventListener("click", function (ev) {
    if (!ev.target.closest(".glocke-huelle")) popup.style.display = "none";
  });

  anzeigenAktualisieren();
})();
document.addEventListener("keydown",function(ev){
  if((ev.metaKey||ev.ctrlKey)&&ev.key==="k"){ev.preventDefault();
   var f=document.querySelector(".topbar-suche input"); if(f) f.focus();}
});
</script>
<!-- Alexandras Ohr auf jeder Seite: "Hey Alexandra" soll auch im CRM gehen.
     Auf /sprache uebernimmt das Skript die grosse Kugel, sonst blendet es
     eine kleine unten rechts ein. -->
<script src="${v("/sprache.js")}" defer></script>`;
}

module.exports = { schale, eintragen, MODULE, ICON, S, e, navigation, darfModul };
