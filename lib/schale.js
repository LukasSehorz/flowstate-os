// Gemeinsame Huelle fuer das ganze Operating System.
// Rail links bleibt stehen, der Inhalt in der Mitte wechselt — das CRM ist
// ein Bereich darin, keine zweite Anwendung. server.js und crm-routes.js
// rendern beide hierueber, damit es genau ein Geruest gibt.

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = (d, b = 24) => `<svg viewBox="0 0 ${b} ${b}" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

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
};

// Die eine Navigation. "unter" erscheint eingerueckt, sobald das Modul aktiv ist —
// so bleibt die Rail schmal, zeigt aber im CRM dessen Bereiche.
const MODULE = [
  { id: "zentrale", titel: "Zentrale", icon: "zentrale", href: "/" },
  { id: "chat", titel: "Alexandra", icon: "funke", href: "/chat" },
  { id: "sprache", titel: "Sprache", icon: "megafon", href: "/sprache" },
  { id: "leads", titel: "Lead-Maschine", icon: "leads", href: "/leads" },
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
  { id: "angebote", titel: "Angebote & Rechnungen", icon: "beleg", href: "/angebote" },
  { id: "buchhaltung", titel: "Buchhaltung", icon: "euro", href: "/buchhaltung" },
  { id: "marketing", titel: "Marketing & Content", icon: "marketing", href: "/marketing" },
  { id: "projekte", titel: "Projekte", icon: "projekte", href: "/projekte" },
  { id: "wissen", titel: "Wissen", icon: "wissen", href: "/wissen" },
  { id: "agenten", titel: "Agenten & Skills", icon: "agenten", href: "/agenten" },
  { id: "einstellungen", titel: "Einstellungen", icon: "zahnrad", href: "/einstellungen" },
];

// Ein Untereintrag ist aktiv -> auch sein Modul gilt als aktiv.
function modulVon(aktiv) {
  const m = MODULE.find((x) => x.id === aktiv || (x.unter || []).some((u) => u.id === aktiv));
  return m ? m.id : aktiv;
}

function navigation(aktiv, nutzer) {
  const offen = modulVon(aktiv);
  return MODULE.map((m) => {
    const istAktiv = m.id === offen;
    const zeile = `<a href="${m.href}" class="${istAktiv && m.id === aktiv ? "aktiv" : istAktiv ? "offen" : ""}"
      title="${e(m.titel)}">${ICON[m.icon]}<span class="rail-wort">${e(m.titel)}</span></a>`;
    if (!istAktiv || !m.unter) return zeile;
    const kinder = m.unter
      .filter((u) => !u.nurAdmin || (nutzer && nutzer.rolle === "admin"))
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
function schale({ titel, aktiv, inhalt, unterzeile = "", reiter = "", nutzer = null, suche = "" }) {
  const init = nutzer ? nutzer.name.split(" ").map((t) => t[0]).slice(0, 2).join("") : "?";
  const heute = new Date().toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long" });
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(titel)} · flowstateOS</title>
<link rel="stylesheet" href="/crm.css"><link rel="stylesheet" href="/style.css">
<script>
  // Vor dem ersten Malen setzen, sonst blitzt die helle Fassung kurz auf.
  (function(){var t=localStorage.getItem("flowstate-thema")||"light";
   document.documentElement.setAttribute("data-theme",t);})();
</script></head><body>
<div class="shell">
  <aside class="rail">
    <a class="rail-marke" href="/"><div class="rail-logo">${ICON.logo}</div>
      <span class="rail-wort" style="font-weight:700;font-size:15px">flowstate<em style="color:var(--primary);font-style:normal">OS</em></span></a>
    ${navigation(aktiv, nutzer)}
    <div class="rail-luecke"></div>
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
        <button class="thema-schalter still" onclick="themaWechseln()" title="Hell / Dunkel umschalten"
          aria-label="Hell oder Dunkel umschalten">${ICON.sonne}${ICON.mond}</button>
        <div class="datum-chip">${ICON.kalender} ${e(heute)}</div>
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
document.addEventListener("keydown",function(ev){
  if((ev.metaKey||ev.ctrlKey)&&ev.key==="k"){ev.preventDefault();
   var f=document.querySelector(".topbar-suche input"); if(f) f.focus();}
});
</script>`;
}

module.exports = { schale, MODULE, ICON, S, e, navigation };
