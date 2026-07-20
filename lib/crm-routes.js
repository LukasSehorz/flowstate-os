// Flowstate CRM — Oberflaeche nach Estera-Vorbild, Flowstate-Inhalte.
const crm = require("./crm.js");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const geld = (n) => (n == null ? "–" : Math.round(Number(n)).toLocaleString("de-DE") + " €");
// Abschluss-Wahrscheinlichkeit einer Phase: erste 10 %, letzte 100 % - skaliert mit der Phasenzahl.
const wahrsch = (anzahl, i) => Math.round(10 + (90 * i) / Math.max(1, anzahl - 1));
const geldK = (n) => { const v = Number(n) || 0;
  if (v >= 10000) return Math.round(v / 1000) + "k €";
  if (v >= 1000) return (v / 1000).toFixed(1).replace(".0", "").replace(".", ",") + "k €";
  return Math.round(v) + " €"; };
const datum = (d) => (d ? new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
const zeit = (d) => (d ? new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

const SPARTEN = { webdesign: "Webdesign", performance: "Performance Marketing", ki: "KI" };
const S = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  logo: S('<path d="M4 4h16M4 12h10M4 20h13"/>'),
  start: S('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  pipeline: S('<rect x="3" y="3" width="6" height="18" rx="2"/><rect x="10.5" y="3" width="6" height="12" rx="2"/><rect x="18" y="3" width="3" height="7" rx="1.5"/>'),
  kunden: S('<path d="M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.5"/><path d="M22 20v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  leads: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'),
  team: S('<path d="M12 3v4M6.5 7 9 9.5M17.5 7 15 9.5"/><circle cx="12" cy="12" r="2.5"/><path d="M4 21v-1a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1"/>'),
  euro: S('<path d="M15 6.5A6 6 0 1 0 15 17.5"/><path d="M4 10.5h9M4 13.5h9"/>'),
  trend: S('<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>'),
  uhr: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  telefon: S('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  suche: S('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  check: S('<path d="M20 6 9 17l-5-5"/>'),
  x: S('<path d="M18 6 6 18M6 6l12 12"/>'),
  notiz: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
  kalender: S('<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>'),
  flamme: S('<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-2 2-3 3-4 3s-1-2-1-4C7 7 5 10 5 15a7 7 0 0 0 7 7z"/>'),
  warnung: S('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'),
  ziel: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
  griff: S('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
  person: S('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
  abmelden: S('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  webdesign: S('<rect x="2.5" y="4" width="19" height="14" rx="2"/><path d="M2.5 8.5h19M6 21h12"/>'),
  megafon: S('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M16 8.5a4 4 0 0 1 0 7M19 6a8 8 0 0 1 0 12"/>'),
  chip: S('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2v4M14.5 2v4M9.5 18v4M14.5 18v4M2 9.5h4M2 14.5h4M18 9.5h4M18 14.5h4"/>'),
  waage: S('<path d="M12 3v18M7 7h10M5.5 7 3 13h5zM18.5 7 16 13h5z"/><path d="M3 13a2.5 2.5 0 0 0 5 0M16 13a2.5 2.5 0 0 0 5 0"/>'),
  schichten: S('<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>'),
  sanduhr: S('<path d="M6 2h12M6 22h12M6 2c0 4 6 6 6 10s-6 6-6 10M18 2c0 4-6 6-6 10s6 6 6 10"/>'),
  prozent: S('<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>'),
};

const RAIL = [
  { id: "start", href: "/crm", icon: "start", titel: "Dashboard" },
  { id: "leads", href: "/crm/leads", icon: "leads", titel: "Leads" },
  { id: "kunden", href: "/crm/kunden", icon: "kunden", titel: "Kunden" },
  { gruppe: "Vertrieb" },
  { id: "pipeline", href: "/crm/pipeline?sparte=webdesign", icon: "webdesign", titel: "Webdesign" },
  { id: "pipeline-pm", href: "/crm/pipeline?sparte=performance", icon: "megafon", titel: "Performance Marketing" },
  { id: "pipeline-ki", href: "/crm/pipeline?sparte=ki", icon: "chip", titel: "KI-Projekte" },
  { gruppe: "Auswertung" },
  { id: "team", href: "/crm/team", icon: "team", titel: "Team-Leistung", nurAdmin: true },
];

function rahmen(user, aktiv, titel, unterzeile, reiter, inhalt) {
  const rail = RAIL.filter((r) => !r.nurAdmin || user.rolle === "admin").map((r) =>
    r.gruppe ? `<div class="rail-gruppe">${e(r.gruppe)}</div>`
      : `<a href="${r.href}" class="${r.id === aktiv ? "aktiv" : ""}" title="${e(r.titel)}">${ICON[r.icon]}<span class="rail-wort">${e(r.titel)}</span></a>`).join("");
  const init = user.name.split(" ").map((t) => t[0]).slice(0, 2).join("");
  const heute = new Date().toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long" });
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(titel)} · Flowstate CRM</title><link rel="stylesheet" href="/crm.css"></head><body>
<div class="shell">
  <aside class="rail">
    <div class="rail-marke"><div class="rail-logo">${ICON.logo}</div>
      <span class="rail-wort" style="font-weight:700;font-size:15px">flowstate<em style="color:var(--primary);font-style:normal">CRM</em></span></div>
    ${rail}
    <div class="rail-luecke"></div>
    <div class="rail-nutzer"><div class="rail-avatar">${e(init)}</div>
      <span class="rail-wort"><span style="display:block;font-weight:600">${e(user.name)}</span>
      <span style="display:block;font-size:11.5px;color:var(--text-muted)">${user.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter"}</span></span></div>
    <a href="/crm/abmelden" title="Abmelden">${ICON.abmelden}<span class="rail-wort">Abmelden</span></a>
  </aside>
  <div class="inhalt">
    <header class="topbar">
      <div><div class="topbar-titel">${e(titel)}</div>${unterzeile ? `<div class="caption">${unterzeile}</div>` : ""}</div>
      <form class="topbar-suche" method="get" action="/crm/leads">
        ${ICON.suche}<input name="suche" placeholder="CRM durchsuchen — Kunden, Leads …" autocomplete="off"><span class="kbd">⌘K</span>
      </form>
      <div class="topbar-rechts">
        <span class="datum-chip">${ICON.kalender}${e(heute)}</span>
        <div class="nutzer-block"><div class="nutzer-name">${e(user.name)}</div>
          <div class="nutzer-rolle">${user.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter"}</div></div>
        <div class="avatar">${e(init)}</div>
      </div>
    </header>
    ${reiter || ""}
    <main>${inhalt}</main>
  </div>
</div>
<script src="/lib/gsap.min.js"></script>
<script>
if(window.gsap){
  gsap.from(".kachel",{y:10,opacity:0,duration:.35,stagger:.04,ease:"power2.out"});
  gsap.from(".karte,.tabelle-huelle,.spalte",{y:8,opacity:0,duration:.3,stagger:.03,delay:.05,ease:"power2.out"});
  document.querySelectorAll("[data-zahl]").forEach(el=>{const z=parseFloat(el.dataset.zahl)||0,o={v:0};
    gsap.to(o,{v:z,duration:.8,ease:"power2.out",onUpdate:()=>{el.textContent=el.dataset.geld?Math.round(o.v).toLocaleString("de-DE")+" €":(el.dataset.suffix?Math.round(o.v)+el.dataset.suffix:Math.round(o.v));}});});
  gsap.utils.toArray(".trichter-balken,.balken,.fortschritt>span").forEach(el=>{
    const b=el.style.width||el.style.height; if(!b)return;
    if(el.classList.contains("balken")){gsap.from(el,{height:0,duration:.7,ease:"power2.out",delay:.1});}
    else{gsap.from(el,{width:0,duration:.7,ease:"power2.out",delay:.1});}});
}
document.addEventListener("keydown",ev=>{if((ev.metaKey||ev.ctrlKey)&&ev.key==="k"){ev.preventDefault();document.querySelector(".topbar-suche input")?.focus();}});
</script></body></html>`;
}

function reiterLeiste(seiten, aktiv, sparte, basis) {
  const r = seiten.map((s) => `<a href="${s.href}" class="${s.id === aktiv ? "aktiv" : ""}">${e(s.label)}</a>`).join("");
  void 0;
  const seg = [["", "Gesamt"], ...Object.entries(SPARTEN)]
    .map(([k, v]) => `<a href="${basis}${basis.includes("?") ? "&" : "?"}sparte=${k}" class="${(sparte || "") === k ? "aktiv" : ""}">${e(v)}</a>`).join("");
  return `<div class="reiterleiste"><nav class="reiter">${r}</nav><nav class="segmente">${seg}</nav></div>`;
}

function anmeldeSeite(fehler) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anmelden · Flowstate CRM</title><link rel="stylesheet" href="/crm.css"></head><body class="login-seite">
<div class="login-karte">
  <div class="login-marke"><div class="login-logo">${ICON.logo}</div>
    <div><div class="marke">flowstate<em>CRM</em></div><div class="marke-sub">Sehorz &amp; vom Hofe GbR</div></div></div>
  <p class="caption" style="margin-top:16px;line-height:1.5">Vertrieb, Kunden und Projekte an einem Ort.
    Melde dich mit deinem persönlichen Zugang an — du siehst nur, was dir gehört.</p>
  <form method="post" action="/crm/anmelden">
    <div class="feld"><label>E-Mail</label><input type="email" name="email" autofocus required placeholder="vorname.name@flowstate-ai.net"></div>
    <div class="feld" style="margin-bottom:4px"><label>Passwort</label><input type="password" name="passwort" required></div>
    <button type="submit" style="width:100%;justify-content:center">Anmelden</button>
  </form>
  ${fehler ? `<div class="hinweis warn" style="margin-top:16px">${ICON.warnung}<div>E-Mail oder Passwort stimmt nicht.</div></div>` : ""}
  <p class="caption" style="margin-top:22px;padding-top:16px;border-top:1px solid var(--border);text-align:center">
    Passwort vergessen? Sprich Lukas oder Jannik an.</p>
</div></body></html>`;
}

const kachel = (label, zahl, icon, farbe, fuss, istGeld, suffix) => `
  <div class="kachel"><div class="kachel-kopf"><span class="kachel-label">${label}</span>
    <span class="kachel-icon ${farbe || ""}">${icon}</span></div>
    <div class="kachel-zahl" data-zahl="${zahl}"${istGeld ? ' data-geld="1"' : ""}${suffix ? ` data-suffix="${suffix}"` : ""}>0</div>
    ${fuss ? `<div class="kachel-fuss">${fuss}</div>` : ""}</div>`;

module.exports = function (app) {
  app.get("/crm/anmelden", (req, res) => res.send(anmeldeSeite(req.query.fehler)));
  app.post("/crm/anmelden", async (req, res) => {
    try { const u = await crm.anmelden(req.body.email, req.body.passwort);
      if (!u) return res.redirect("/crm/anmelden?fehler=1");
      req.session.crm = u; res.redirect("/crm");
    } catch { res.redirect("/crm/anmelden?fehler=1"); }
  });
  app.get("/crm/abmelden", (req, res) => { delete req.session.crm; res.redirect("/crm/anmelden"); });
  app.use("/crm", (req, res, next) => {
    if (req.path.startsWith("/anmelden")) return next();
    if (!req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm; next();
  });

  // ================= DASHBOARD =================
  app.get("/crm", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const sparte = SPARTEN[req.query.sparte] ? req.query.sparte : "";
      const tab = ["uebersicht", "pipeline", "team"].includes(req.query.tab) ? req.query.tab : "uebersicht";
      const zeitraum = ["30", "3", "6", "12"].includes(req.query.zr) ? req.query.zr : "6";
      const [z, alle, team] = await Promise.all([
        crm.kennzahlen(u), crm.firmenListe(u, { limit: 300 }),
        u.rolle === "admin" ? crm.teamZahlen(u) : Promise.resolve([]),
      ]);
      const stufenAlle = await crm.stufen(u);
      const spartenListe = sparte ? [sparte] : Object.keys(SPARTEN);
      const boards = await Promise.all(spartenListe.map((s) => crm.dealsNachStufen(u, s)));

      // Kennzahlen berechnen
      let offen = 0, wert = 0;
      const alleDeals = [];
      boards.forEach((b) => b.forEach((st) => st.deals.forEach((d) => { offen++; wert += Number(d.wert || 0); alleDeals.push(d); })));
      const ziel = 30000, fortschritt = Math.min(100, Math.round((z.umsatz_monat / ziel) * 100));
      const monat = new Date().toLocaleDateString("de-DE", { month: "long" });
      const heisse = alle.filter((f) => f.status === "lead" && (f.temperatur === "heiss" || Number(f.score) >= 9));
      const faellig = alle.filter((f) => f.wiedervorlage && new Date(f.wiedervorlage) <= new Date());

      // Umsatzverlauf der letzten 6 Monate aus gewonnenen Deals
      const gew = await crm.gewonneneDeals(u, sparte, 12);
      const monate = zeitraum === "30" ? 1 : Number(zeitraum);
      const verlauf = [];
      for (let i = monate - 1; i >= 0; i--) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
        const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        const wert = gew.filter((g) => g.geschlossen_am && new Date(g.geschlossen_am).toISOString().slice(0, 7) === key)
          .reduce((a, g) => a + Number(g.wert || 0), 0);
        verlauf.push({ label: d.toLocaleDateString("de-DE", { month: "short" }), wert });
      }
      const maxV = Math.max(1, ...verlauf.map((m) => m.wert));
      const pkt = verlauf.map((m, i) => [(i / (verlauf.length - 1 || 1)) * 780 + 10, 190 - (m.wert / maxV) * 178]);
      // Weiche Kurve: Catmull-Rom in kubische Bezier. Die Stuetzpunkte werden auf den
      // Wertebereich des jeweiligen Abschnitts begrenzt, sonst schwingt die Kurve unter die Null-Linie.
      const klemm = (v, a, b) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));
      let linie = `M${pkt[0][0].toFixed(1)},${pkt[0][1].toFixed(1)}`;
      for (let i = 0; i < pkt.length - 1; i++) {
        const p0 = pkt[i - 1] || pkt[i], p1 = pkt[i], p2 = pkt[i + 1], p3 = pkt[i + 2] || p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, klemm(p1[1] + (p2[1] - p0[1]) / 6, p1[1], p2[1])];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, klemm(p2[1] - (p3[1] - p1[1]) / 6, p1[1], p2[1])];
        linie += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
      }
      const flaeche = linie + ` L${pkt[pkt.length - 1][0].toFixed(1)},190 L10,190 Z`;
      const gitter = [0, 1, 2, 3, 4].map((i) => 12 + i * 44.5); // Rasterlinien = Achsenwerte

      // Forecast: Deals gewichtet nach Stufen-Wahrscheinlichkeit
      let forecast = 0;
      boards.forEach((b) => b.forEach((st, i) => st.deals.forEach((d) => { forecast += Number(d.wert || 0) * (wahrsch(b.length, i) / 100); })));
      const abg = await crm.abschlussZahlen(u, sparte);
      const quote = abg.gewonnen + abg.verloren > 0 ? Math.round((abg.gewonnen / (abg.gewonnen + abg.verloren)) * 100) : null;
      const dauer = abg.dauer ? Math.round(abg.dauer) : null;
      const schnitt = verlauf.length ? verlauf.reduce((a, m) => a + m.wert, 0) / verlauf.length : 0;
      const letzterM = verlauf[verlauf.length - 1]?.wert || 0, vorM = verlauf[verlauf.length - 2]?.wert || 0;
      const wachstum = vorM > 0 ? ((letzterM - vorM) / vorM) * 100 : (letzterM > 0 ? 100 : null);

      // Trichter (erste Sparte oder gewählte)
      const trichterSparte = sparte || "webdesign";
      const tBoard = boards[spartenListe.indexOf(trichterSparte)] || boards[0] || [];
      // Kumulativ: "diese Stufe erreicht" = Deals hier + in allen spaeteren Stufen -> echte Trichterform
      const kum = tBoard.map((_, i) => tBoard.slice(i).reduce((a, s) => a + s.deals.length, 0));
      const kumW = tBoard.map((_, i) => tBoard.slice(i).reduce((a, s) => a + s.deals.reduce((m, d) => m + Number(d.wert || 0), 0), 0));
      const tMax = Math.max(1, ...kum);
      const trichter = tBoard.map((s, i) => {
        const n = kum[i], breite = Math.max(14, Math.round((n / tMax) * 100));
        return `<div class="trichter-zeile"><div class="trichter-spur">
          <div class="trichter-balken" style="width:${breite}%;background:var(--stage-${(i % 8) + 1})">${n}</div></div>
          <div class="trichter-info"><strong>${e(s.name)} · ${wahrsch(tBoard.length, i)} %</strong><span>${kumW[i] ? geld(kumW[i]) : "—"}</span></div></div>`;
      }).join("");

      // Donut: Leads nach Quelle
      const quellen = {};
      alle.forEach((f) => { const q = f.quelle || "unbekannt"; quellen[q] = (quellen[q] || 0) + 1; });
      const qListe = Object.entries(quellen).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const qGesamt = qListe.reduce((a, [, n]) => a + n, 0) || 1;
      let offsetAkk = 0; const U = 2 * Math.PI * 70;
      const donutSeg = qListe.map(([q, n], i) => {
        const anteil = n / qGesamt, laenge = anteil * U;
        const seg = `<circle cx="93" cy="93" r="70" fill="none" stroke="var(--stage-${(i % 8) + 1})" stroke-width="26"
          stroke-dasharray="${laenge} ${U - laenge}" stroke-dashoffset="${-offsetAkk}"/>`;
        offsetAkk += laenge; return seg;
      }).join("");
      const donutLeg = qListe.map(([q, n], i) => `<div class="legende-zeile">
        <span class="legende-farbe" style="background:var(--stage-${(i % 8) + 1})"></span>
        <span>${e(q)}</span><span class="legende-wert">${n}</span>
        <span class="legende-prozent">${Math.round((n / qGesamt) * 100)} %</span></div>`).join("");

      // Team-Balken
      const maxTeam = Math.max(1, ...team.map((t) => Number(t.umsatz_monat) || 0));
      const balken = team.filter((t) => t.rolle !== "x").map((t) => `
        <div class="balken-saeule"><div class="balken" style="height:${Math.max(3, Math.round((Number(t.umsatz_monat) || 0) / maxTeam * 100))}%"></div>
        <span class="balken-label">${e(t.name.split(" ")[0])}</span></div>`).join("");

      // Aktuelle Deals
      const neueste = alleDeals.sort((a, b) => new Date(b.erstellt) - new Date(a.erstellt)).slice(0, 5);
      const dealZeilen = neueste.map((d, i) => `<tr>
        <td><span class="rang">#${i + 1}</span></td>
        <td><div class="zeile-titel">${e(d.firma_name)}</div><div class="zeile-sub">${e(d.titel)}</div></td>
        <td class="caption">${datum(d.erstellt)}</td>
        <td><span class="badge b-blau">${e(SPARTEN[d.sparte] || d.sparte)}</span></td>
        <td class="rechts" style="font-weight:600">${geld(d.wert)}</td>
        <td class="rechts"><a class="knopf sekundaer klein" href="/crm/firma/${d.firma_id}">Öffnen</a></td></tr>`).join("");

      // Auswertung je Sparte - Grundlage fuer den Reiter "Pipeline-Volumen"
      const heute = new Date();
      const auswertung = spartenListe.map((sp, i) => {
        const b = boards[i] || [];
        const deals = b.flatMap((st) => st.deals);
        const volumen = deals.reduce((a, d) => a + Number(d.wert || 0), 0);
        const gewichtet = b.reduce((a, st, j) => a + st.deals.reduce((m, d) => m + Number(d.wert || 0) * (wahrsch(b.length, j) / 100), 0), 0);
        const alter = deals.length ? deals.reduce((a, d) => a + (heute - new Date(d.erstellt)) / 86400000, 0) / deals.length : 0;
        const stufen = b.map((st, j) => ({
          name: st.name, anzahl: st.deals.length, quote: wahrsch(b.length, j),
          wert: st.deals.reduce((m, d) => m + Number(d.wert || 0), 0),
          alter: st.deals.length ? st.deals.reduce((a, d) => a + (heute - new Date(d.erstellt)) / 86400000, 0) / st.deals.length : 0,
        }));
        const engpass = stufen.filter((x) => x.anzahl).sort((a, b2) => b2.wert - a.wert)[0] || null;
        return { key: sp, name: SPARTEN[sp], anzahl: deals.length, volumen, gewichtet, alter, stufen, engpass };
      });
      const maxVol = Math.max(1, ...auswertung.map((a) => a.volumen));

      const q = (t) => "/crm?tab=" + t + (sparte ? "&sparte=" + sparte : "");
      const reiter = reiterLeiste([
        { id: "uebersicht", label: "Übersicht", href: q("uebersicht") },
        { id: "pipeline", label: "Pipeline-Volumen", href: q("pipeline") },
        ...(u.rolle === "admin" ? [{ id: "team", label: "Team-Leistung", href: q("team") }] : []),
      ], tab, sparte, "/crm?tab=" + tab);

      const ansichten = {};
      ansichten.uebersicht = `
        <div class="kacheln">
          ${kachel(`Umsatz ${e(monat)}`, z.umsatz_monat, ICON.euro, "gruen",
            `<span class="trend auf">${fortschritt} % vom Ziel</span><span class="caption">Ziel ${geld(ziel)}</span>`, true)}
          ${kachel("Pipeline-Wert", wert, ICON.trend, "", `<span class="caption">${offen} offene Deals${sparte ? " · " + e(SPARTEN[sparte]) : " über alle Sparten"}</span>`, true)}
          ${kachel("Offene Leads", alle.filter((f) => f.status === "lead").length, ICON.leads, "",
            `<span class="caption">${heisse.length} heiß · ${faellig.length} fällig</span>`)}
          ${kachel("Kunden", z.kunden, ICON.kunden, "rosa", `<span class="caption">${z.gewonnen_monat} gewonnen im ${e(monat)}</span>`)}
        </div>

        <div class="raster" style="grid-template-columns:1.5fr 1fr;margin-bottom:16px">
          <div class="karte">
            <div class="karte-kopf"><div><h2>Umsatzentwicklung</h2>
              <div class="caption" style="margin-top:6px">Ø Umsatz pro Monat</div>
              <div class="chart-kopf"><span class="chart-zahl">${geld(schnitt)}</span>
                ${wachstum !== null ? `<span class="trend ${wachstum >= 0 ? "auf" : "ab"}">${wachstum >= 0 ? "↗" : "↘"} ${Math.abs(wachstum).toFixed(1).replace(".", ",")} %</span>` : ""}</div></div></div>
            <nav class="zeitraum">
              ${[["30", "30 Tage"], ["3", "3 Monate"], ["6", "6 Monate"], ["12", "12 Monate"]].map(([k, v]) =>
                `<a href="/crm?tab=${tab}&zr=${k}${sparte ? "&sparte=" + sparte : ""}" class="${zeitraum === k ? "aktiv" : ""}">${v}</a>`).join("")}
            </nav>
            <div class="chart-flaeche" style="height:220px">
              <div class="chart-y">${[maxV, maxV * .75, maxV * .5, maxV * .25, 0].map((v, i) =>
                `<span style="top:${gitter[i]}px">${geldK(v)}</span>`).join("")}</div>
              <svg viewBox="0 0 800 200" preserveAspectRatio="none" style="width:100%;height:200px">
                <defs><linearGradient id="fl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--blau-500)" stop-opacity=".26"/>
                  <stop offset="100%" stop-color="var(--blau-500)" stop-opacity="0"/></linearGradient></defs>
                ${gitter.map((y) => `<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 6"/>`).join("")}
                <path d="${flaeche}" fill="url(#fl)"/>
                <path d="${linie}" fill="none" stroke="var(--blau-600)" stroke-width="2.5" stroke-linecap="round"/>
                ${pkt.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#fff" stroke="var(--blau-600)" stroke-width="2.5"/>`).join("")}
              </svg>
              <div class="chart-achse" style="padding-left:0">${verlauf.map((m) => `<span class="caption">${e(m.label)}</span>`).join("")}</div>
            </div>
            ${wachstum !== null ? `<div class="chart-fuss"><span class="${wachstum >= 0 ? "" : ""}" style="color:${wachstum >= 0 ? "var(--success)" : "var(--danger)"};font-weight:600">${wachstum >= 0 ? "+" : ""}${wachstum.toFixed(1).replace(".", ",")} %</span>
              Wachstum: letzter Monat gegenüber dem Monat davor</div>` : ""}
          </div>

          <div class="karte">
            <div class="karte-kopf"><div><h2>Blick nach vorn</h2>
              <div class="sub">Was in der offenen Pipeline steckt</div></div></div>
            <div class="forecast">
              <div class="forecast-label">${ICON.waage} Forecast</div>
              <div class="forecast-zahl">${geld(forecast)}</div>
              <div class="forecast-sub">gewichtet nach Phasen-Wahrscheinlichkeit</div>
            </div>
            <div class="kennliste">
              <div class="kennzeile">${ICON.trend}<span>Pipeline-Volumen (offen)</span><b>${geld(wert)}</b></div>
              <div class="kennzeile">${ICON.schichten}<span>Offene Deals</span><b>${offen}</b></div>
              <div class="kennzeile">${ICON.euro}<span>Ø Deal-Größe</span><b>${offen ? geld(wert / offen) : "—"}</b></div>
              <div class="kennzeile">${ICON.prozent}<span>Abschlussquote</span><b>${quote === null ? "—" : quote + " %"}</b></div>
              <div class="kennzeile">${ICON.sanduhr}<span>Ø Deal-Dauer</span><b>${dauer ? dauer + " Tage" : "—"}</b></div>
            </div>
            <a class="knopf dunkel" style="width:100%;justify-content:center;margin-top:16px"
               href="/crm/pipeline?sparte=${sparte || "webdesign"}">Zur offenen Pipeline</a>
          </div>
        </div>

        <div class="raster raster-2" style="margin-bottom:16px">
          <div class="karte">
            <div class="karte-kopf"><div><h2>Heute zu tun</h2>
              <div class="sub">Deine Handlungsliste — fällige Wiedervorlagen und heiße Leads.</div></div>
              <a href="/crm/leads" class="caption">Alle Leads →</a></div>
            ${heisse.length ? `<div class="signal"><div class="signal-icon">${ICON.flamme}</div>
              <div class="signal-text"><b>${heisse.length} heiße ${heisse.length === 1 ? "Lead wartet" : "Leads warten"} auf dich</b>
              <span>Score 9 oder 10 — noch kein Deal angelegt.</span></div>
              <a href="/crm/leads?temperatur=heiss" class="knopf klein">Ansehen</a></div>
            <div class="kennliste">${heisse.slice(0, 5).map((f) => `<div class="kennzeile">${ICON.flamme}
              <span><a href="/crm/firma/${f.id}">${e(f.name)}</a><br><span class="caption">${e(f.ort || f.quelle || "—")}</span></span>
              <b>Score ${f.score ?? "—"}</b></div>`).join("")}</div>` : ""}
            <div class="spalten-titel" style="margin-top:18px">${ICON.uhr} Wiedervorlagen ${faellig.length ? `<span class="badge b-rot">${faellig.length} fällig</span>` : ""}</div>
            ${faellig.length ? faellig.slice(0, 6).map((f) => `<div class="aufgabe">
              <input type="checkbox"><span class="aufgabe-text"><a href="/crm/firma/${f.id}">${e(f.name)}</a></span>
              <span class="badge b-rot">${datum(f.wiedervorlage)}</span></div>`).join("")
              : `<p class="caption">Keine offenen Wiedervorlagen. 🎉</p>`}
          </div>

          <div class="karte">
            <div class="karte-kopf"><div><h2>Trichter ${e(SPARTEN[trichterSparte])}</h2>
              <div class="sub">Je Stufe erreicht · offene Deals</div></div>
              <a href="/crm/pipeline?sparte=${trichterSparte}" class="caption">öffnen →</a></div>
            ${tBoard.some((s) => s.deals.length) ? `<div class="trichter">${trichter}</div>`
              : `<p class="caption">Noch keine Deals in dieser Sparte. Leg bei einem Lead einen Deal an — er erscheint dann hier.</p>`}
          </div>
        </div>

        <div class="karte" style="margin-bottom:16px">
          <div class="karte-kopf"><div><h2>Aktuelle Deals</h2><div class="sub">Zuletzt angelegte offene Deals</div></div>
            <a href="/crm/pipeline" class="knopf sekundaer klein">Alle ansehen</a></div>
          ${neueste.length ? `<table class="tabelle"><thead><tr><th>Rang</th><th>Deal</th><th>Angelegt</th><th>Sparte</th><th class="rechts">Betrag</th><th></th></tr></thead>
            <tbody>${dealZeilen}</tbody></table>`
            : `<p class="caption">Noch keine offenen Deals.</p>`}
        </div>

        <div class="raster raster-2">
          <div class="karte"><div class="karte-kopf"><div><h2>Leads nach Quelle</h2>
            <div class="sub">Woher unsere Kontakte kommen</div></div></div>
            <div class="donut-block">
              <div class="donut"><svg width="186" height="186">${donutSeg}</svg>
                <div class="donut-mitte"><div><b>${alle.length}</b><span class="caption">Gesamt</span></div></div></div>
              <div class="donut-legende">${donutLeg || '<span class="caption">Noch keine Daten.</span>'}</div>
            </div></div>
          ${u.rolle === "admin" ? `<div class="karte"><div class="karte-kopf"><div><h2>Umsatz je Person</h2>
            <div class="sub">Gewonnene Deals im ${e(monat)}</div></div>
            <a href="/crm/team" class="caption">Details →</a></div>
            <div class="balken-block">${balken}</div></div>` : ""}
        </div>`;

      ansichten.pipeline = `
        <div class="kacheln">
          ${kachel("Pipeline-Volumen", wert, ICON.trend, "", `<span class="caption">${offen} offene Deals${sparte ? " \u00b7 " + e(SPARTEN[sparte]) : " \u00fcber alle Sparten"}</span>`, true)}
          ${kachel("Gewichteter Forecast", forecast, ICON.waage, "gruen", `<span class="caption">nach Phasen-Wahrscheinlichkeit</span>`, true)}
          ${kachel("\u00d8 Deal-Gr\u00f6\u00dfe", offen ? wert / offen : 0, ICON.euro, "bernstein", `<span class="caption">\u00fcber alle offenen Deals</span>`, true)}
          ${kachel("\u00d8 Liegezeit", Math.round(auswertung.reduce((a, x) => a + x.alter * x.anzahl, 0) / (offen || 1)), ICON.sanduhr, "rosa", `<span class="caption">Tage seit Anlage</span>`, false, " Tage")}
        </div>

        <div class="karte" style="margin-bottom:16px">
          <div class="karte-kopf"><div><h2>Volumen je Sparte</h2>
            <div class="sub">Wo unser offenes Geld liegt \u2014 und was davon gewichtet realistisch ist</div></div></div>
          ${auswertung.map((a) => `<div class="sparte-zeile">
            <div class="sparte-kopf"><b>${e(a.name)}</b>
              <span class="caption">${a.anzahl} ${a.anzahl === 1 ? "Deal" : "Deals"} \u00b7 \u00d8 ${a.anzahl ? geld(a.volumen / a.anzahl) : "\u2014"} \u00b7 \u00d8 ${Math.round(a.alter)} Tage alt</span>
              <span class="sparte-wert">${geld(a.volumen)}</span></div>
            <div class="sparte-spur">
              <div class="sparte-balken" style="width:${Math.round((a.volumen / maxVol) * 100)}%"></div>
              <div class="sparte-balken gewichtet" style="width:${Math.round((a.gewichtet / maxVol) * 100)}%"></div>
            </div>
            <div class="sparte-fuss"><span class="caption">gewichtet ${geld(a.gewichtet)}</span>
              <a href="/crm/pipeline?sparte=${a.key}" class="caption">Board \u00f6ffnen \u2192</a></div></div>`).join("")}
          <div class="legende-flach">
            <span><i class="pkt gesamt"></i> Volumen gesamt</span><span><i class="pkt gewichtet"></i> gewichteter Forecast</span></div>
        </div>

        <div class="raster raster-2" style="margin-bottom:16px">
          ${auswertung.filter((a) => a.anzahl).map((a) => `<div class="karte">
            <div class="karte-kopf"><div><h2>${e(a.name)}</h2>
              <div class="sub">Verteilung \u00fcber die Phasen</div></div>
              <a href="/crm/pipeline?sparte=${a.key}" class="caption">\u00f6ffnen \u2192</a></div>
            <div class="stufen-liste">
              ${a.stufen.map((st, j) => `<div class="stufen-zeile">
                <span class="stufen-punkt" style="background:var(--stage-${(j % 8) + 1})"></span>
                <span class="stufen-name">${e(st.name)}</span>
                <span class="caption">${st.quote} %</span>
                <div class="stufen-spur"><div class="stufen-balken" style="width:${Math.round((st.wert / Math.max(1, ...a.stufen.map((x) => x.wert))) * 100)}%;background:var(--stage-${(j % 8) + 1})"></div></div>
                <b>${st.anzahl}</b><span class="stufen-wert">${st.wert ? geld(st.wert) : "\u2014"}</span></div>`).join("")}
            </div>
            ${a.engpass ? `<div class="hinweis"><b>Engpass:</b> In \u201e${e(a.engpass.name)}\u201c liegen ${geld(a.engpass.wert)} bei ${a.engpass.anzahl} ${a.engpass.anzahl === 1 ? "Deal" : "Deals"}${a.engpass.alter >= 14 ? ` \u2014 im Schnitt seit ${Math.round(a.engpass.alter)} Tagen.` : "."}</div>` : ""}
          </div>`).join("")}
          ${auswertung.some((a) => !a.anzahl) ? `<div class="karte">
            <div class="karte-kopf"><div><h2>Ohne offene Deals</h2>
              <div class="sub">Hier passiert gerade nichts \u2014 lohnt sich ein Blick</div></div></div>
            <div class="kennliste">${auswertung.filter((a) => !a.anzahl).map((a) => `<div class="kennzeile">
              ${ICON.schichten}<span>${e(a.name)}</span>
              <a class="knopf sekundaer klein" href="/crm/pipeline?sparte=${a.key}">Board \u00f6ffnen</a></div>`).join("")}</div>
          </div>` : ""}
        </div>`;

      ansichten.team = u.rolle !== "admin" ? null : `
        <div class="kacheln">
          ${kachel(`Umsatz ${e(monat)}`, team.reduce((a, p) => a + Number(p.umsatz_monat || 0), 0), ICON.euro, "gruen", `<span class="caption">alle Personen zusammen</span>`, true)}
          ${kachel("Gewonnene Deals", team.reduce((a, p) => a + p.gewonnen, 0), ICON.check, "", `<span class="caption">${team.reduce((a, p) => a + p.verloren, 0)} verloren</span>`)}
          ${kachel("Abschlussquote", quote === null ? 0 : quote, ICON.prozent, "bernstein", `<span class="caption">gewonnen \u00f7 entschieden</span>`, false, " %")}
          ${kachel("Anrufe heute", team.reduce((a, p) => a + p.anrufe_heute, 0), ICON.telefon, "rosa", `<span class="caption">im gesamten Team</span>`)}
        </div>

        <div class="raster" style="grid-template-columns:1fr 1.4fr;margin-bottom:16px">
          <div class="karte"><div class="karte-kopf"><div><h2>Umsatz je Person</h2>
            <div class="sub">Gewonnene Deals im ${e(monat)}</div></div></div>
            <div class="balken-block">${balken}</div></div>
          <div class="karte"><div class="karte-kopf"><div><h2>Leistung im Vergleich</h2>
            <div class="sub">Wer wie viel bewegt \u2014 und wo es hakt</div></div>
            <a href="/crm/team" class="caption">Volle Tabelle \u2192</a></div>
            <div class="kennliste">
              ${team.map((p) => { const pq = p.gewonnen + p.verloren > 0 ? Math.round((p.gewonnen / (p.gewonnen + p.verloren)) * 100) : null;
                return `<div class="kennzeile"><span class="rail-avatar" style="width:28px;height:28px;font-size:11px">${e(p.name.split(" ").map((x) => x[0]).join("").slice(0, 2))}</span>
                  <span>${e(p.name)}<br><span class="caption">${p.offen} offen \u00b7 ${p.gewonnen} gewonnen${pq === null ? "" : " \u00b7 " + pq + " % Quote"}</span></span>
                  <b>${geld(p.umsatz_monat)}</b></div>`; }).join("")}
            </div></div>
        </div>

        <div class="karte">
          <div class="karte-kopf"><div><h2>Aktivit\u00e4t</h2><div class="sub">Anrufe heute je Person</div></div></div>
          <div class="kennliste">
            ${team.map((p) => `<div class="kennzeile">${ICON.telefon}<span>${e(p.name)}</span><b>${p.anrufe_heute}</b></div>`).join("")}
          </div>
        </div>`;

      res.send(rahmen(u, "start", "Dashboard", "", reiter, ansichten[tab] || ansichten.uebersicht));
    } catch (err) { next(err); }
  });

  // ================= PIPELINE =================
  app.get("/crm/pipeline", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const sparte = SPARTEN[req.query.sparte] ? req.query.sparte : "webdesign";
      const art = req.query.art === "projekt" ? "projekt" : "vertrieb";
      const [spalten, firmen, mitarbeiter] = await Promise.all([
        crm.dealsNachStufen(u, sparte, art), crm.firmenListe(u, { limit: 300 }), crm.team(u),
      ]);
      const gesamt = spalten.reduce((n, s) => n + s.deals.length, 0);
      const wert = spalten.reduce((n, s) => n + s.deals.reduce((m, d) => m + Number(d.wert || 0), 0), 0);

      const reiter = reiterLeiste([
        { id: "vertrieb", label: "Verkauf", href: `/crm/pipeline?sparte=${sparte}&art=vertrieb` },
        { id: "projekt", label: "Projektabwicklung", href: `/crm/pipeline?sparte=${sparte}&art=projekt` },
      ], art, sparte, "/crm/pipeline?art=" + art);

      res.send(rahmen(u, "pipeline", SPARTEN[sparte], "Vertriebspipeline · " + (art === "projekt" ? "Projekte" : "Verkauf"), reiter, `
        <div class="seiten-kopf">
          <div><h1>${e(SPARTEN[sparte])}</h1>
            <p>${gesamt} offene Deals · ${geld(wert)} Gesamtwert</p></div>
          <button class="dunkel" onclick="document.getElementById('dealNeu').showModal()">${ICON.plus} Neuer Deal</button>
        </div>
        <div class="kanban">
          ${spalten.map((s, i) => `
            <div class="spalte" data-stufe="${s.id}" style="--stufe:var(--stage-${(i % 8) + 1})">
              <div class="spalte-kopf"><div class="spalte-titel-zeile">
                <span class="spalte-titel">${e(s.name)}</span><span class="spalte-zahl">${s.deals.length}</span></div>
                <div class="spalte-quote">${art === "vertrieb" ? wahrsch(spalten.length, i) + " % Wahrscheinlichkeit" : "Phase " + (i + 1)}</div></div>
              <div class="spalte-karten">
                ${!s.deals.length ? `<div class="spalte-leer">${s.ist_abschluss ? "Ziel-Stufe" : "leer"}</div>` : ""}
                ${s.deals.map((d) => `
                  <div class="deal" draggable="true" data-id="${d.id}" onclick="if(!window.__zieht)location.href='/crm/firma/${d.firma_id}'">
                    <div class="deal-kopf"><span class="deal-punkt"></span>
                      <span class="deal-name">${e(d.firma_name)}</span><span class="deal-griff">${ICON.griff}</span></div>
                    <div class="deal-betrag">${geld(d.wert)}</div>
                    <div class="deal-zeile">${e(d.titel)}</div>
                    <div class="deal-marken">${d.ort ? `<span class="badge">${e(d.ort)}</span>` : ""}
                      <span class="badge b-blau">${e(SPARTEN[d.sparte] || d.sparte)}</span></div>
                    <div class="deal-fuss">${ICON.person}${e(d.besitzer_name || "—")}</div>
                  </div>`).join("")}
              </div></div>`).join("")}
        </div>
        ${!gesamt ? `<div class="hinweis info">${ICON.info}<div><strong>Noch keine offenen Deals in ${e(SPARTEN[sparte])}.</strong>
          Leg oben rechts einen neuen Deal an — er erscheint dann in der ersten Stufe und lässt sich per Ziehen bewegen.</div></div>` : ""}

        <dialog id="dealNeu"><h2>Neuer Deal</h2><div class="sub">Bereich ${e(SPARTEN[sparte])} · Kunde &amp; Phase</div>
          <form method="post" action="/crm/deal/anlegen">
            <input type="hidden" name="sparte" value="${sparte}">
            <div class="feld"><label>Kunde / Lead *</label><select name="firma_id" required>
              <option value="">Kunden wählen …</option>
              ${firmen.map((f) => `<option value="${f.id}">${e(f.name)}${f.ort ? " — " + e(f.ort) : ""}</option>`).join("")}</select></div>
            <div class="feld"><label>Dealname *</label><input name="titel" required placeholder="z. B. Website + Wartung"></div>
            <div class="feld-paar">
              <div class="feld"><label>Wert (€)</label><input name="wert" type="number" step="1" placeholder="0"></div>
              <div class="feld"><label>Phase</label><select name="stufe_id">
                ${spalten.map((s) => `<option value="${s.id}">${e(s.name)}</option>`).join("")}</select></div>
            </div>
            <div class="feld-paar">
              <div class="feld"><label>Verantwortlich</label><select name="besitzer">
                ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === u.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
              <div class="feld"><label>Erwarteter Abschluss</label><input type="date" name="erwartet_am"></div>
            </div>
            <div class="dialog-fuss"><button type="button" class="sekundaer" onclick="document.getElementById('dealNeu').close()">Abbrechen</button>
              <button type="submit" class="dunkel">Deal anlegen</button></div>
          </form></dialog>
        <script>
          let gezogen=null; window.__zieht=false;
          document.querySelectorAll(".deal").forEach(k=>{
            k.addEventListener("dragstart",()=>{gezogen=k;window.__zieht=true;k.classList.add("zieht")});
            k.addEventListener("dragend",()=>{k.classList.remove("zieht");setTimeout(()=>window.__zieht=false,60);
              document.querySelectorAll(".spalte").forEach(s=>s.classList.remove("ziel"))});
          });
          document.querySelectorAll(".spalte").forEach(sp=>{
            sp.addEventListener("dragover",ev=>{ev.preventDefault();sp.classList.add("ziel")});
            sp.addEventListener("dragleave",()=>sp.classList.remove("ziel"));
            sp.addEventListener("drop",async ev=>{ev.preventDefault();sp.classList.remove("ziel");if(!gezogen)return;
              sp.querySelector(".spalte-karten").appendChild(gezogen);
              if(window.gsap)gsap.fromTo(gezogen,{scale:.96},{scale:1,duration:.25,ease:"back.out(2)"});
              const r=await fetch("/crm/deal/verschieben",{method:"POST",headers:{"Content-Type":"application/json"},
                body:JSON.stringify({deal:gezogen.dataset.id,stufe:sp.dataset.stufe})}).then(r=>r.json());
              if(r.gewonnen)location.reload();});
          });
        </script>`));
    } catch (err) { next(err); }
  });

  app.post("/crm/deal/anlegen", async (req, res, next) => {
    try {
      await crm.dealAnlegen(req.nutzer, { ...req.body, wert: req.body.wert || null, erwartet_am: req.body.erwartet_am || null });
      res.redirect("/crm/pipeline?sparte=" + req.body.sparte);
    } catch (err) { next(err); }
  });

  app.post("/crm/deal/verschieben", async (req, res) => {
    try {
      await crm.dealVerschieben(req.nutzer, req.body.deal, req.body.stufe);
      const st = (await crm.stufen(req.nutzer)).find((s) => String(s.id) === String(req.body.stufe));
      res.json({ ok: true, gewonnen: !!st?.ist_abschluss });
    } catch (e) { res.json({ ok: false, fehler: e.message }); }
  });

  // ================= KUNDEN =================
  app.get("/crm/kunden", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const { suche = "", status = "", temperatur = "" } = req.query;
      const [firmen, mitarbeiter] = await Promise.all([crm.firmenListe(u, { suche, status, temperatur, limit: 300 }), crm.team(u)]);
      const zeilen = firmen.map((f) => `<tr onclick="location.href='/crm/firma/${f.id}'" style="cursor:pointer">
        <td><div class="zeile-titel">${e(f.name)}</div><div class="zeile-sub">${e(f.email || f.telefon || "")}</div></td>
        <td><span class="badge ${f.status === "kunde" ? "b-gruen" : f.status === "verloren" ? "b-rot" : "b-blau"}">${f.status === "kunde" ? "Kunde" : f.status === "verloren" ? "Verloren" : f.status === "ruht" ? "Ruht" : "Lead"}</span></td>
        <td>${f.branche ? `<span class="badge">${e(f.branche)}</span>` : "—"}</td>
        <td>${f.ort ? e(f.ort) : "—"}</td>
        <td>${f.score ? `<span class="badge ${f.score >= 9 ? "b-gruen" : f.score >= 7 ? "b-bernstein" : ""}">${f.score}/10</span>` : "—"}</td>
        <td><span class="badge ${f.temperatur === "heiss" ? "b-rosa" : f.temperatur === "kalt" ? "" : "b-bernstein"}"><span class="punkt"></span>${e(f.temperatur || "warm")}</span></td>
        <td>${f.quelle ? `<span class="caption">${e(f.quelle)}</span>` : "—"}</td>
        <td>${e(f.besitzer_name || "—")}</td>
        <td class="rechts">${f.offene_deals > 0 ? `<span class="badge b-blau">${f.offene_deals}</span>` : `<span class="caption">—</span>`}</td></tr>`).join("");

      res.send(rahmen(u, "kunden", "Kunden", "Leads, Interessenten &amp; Bestandskunden", "", `
        <div class="seiten-kopf" style="margin-bottom:14px"><div></div>
          <button class="dunkel" onclick="document.getElementById('neu').showModal()">${ICON.plus} Neuer Kunde</button></div>
        <form class="filter" method="get">
          <span class="such">${ICON.suche}<input type="search" name="suche" placeholder="Nach Name, Ort oder Telefon suchen …" value="${e(suche)}"></span>
          <select name="status"><option value="">Alle Status</option>
            ${[["lead", "Lead"], ["kunde", "Kunde"], ["verloren", "Verloren"], ["ruht", "Ruht"]].map(([k, v]) => `<option value="${k}" ${status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
          <select name="temperatur"><option value="">Alle Temperaturen</option>
            ${["heiss", "warm", "kalt"].map((t) => `<option ${temperatur === t ? "selected" : ""}>${t}</option>`).join("")}</select>
          <button class="sekundaer" type="submit">Filtern</button>
          <span class="filter-zahl">${firmen.length} Einträge</span>
        </form>
        ${firmen.length ? `<div class="tabelle-huelle"><table class="tabelle">
          <thead><tr><th>Name</th><th>Status</th><th>Branche</th><th>Ort</th><th>Score</th><th>Temperatur</th><th>Quelle</th><th>Verantwortlich</th><th class="rechts">Deals</th></tr></thead>
          <tbody>${zeilen}</tbody></table></div>`
        : `<div class="karte leer"><div class="leer-icon">${ICON.kunden}</div><h3>Noch keine Einträge</h3>
           <p>Leg den ersten Kunden an — oder übernimm Leads aus der Lead-Maschine im OS-Dashboard.</p></div>`}
        <dialog id="neu"><h2>Neuer Kunde</h2><div class="sub">Lead oder Kunde anlegen</div>
          <form method="post" action="/crm/kunden/anlegen">
            <div class="feld"><label>Firma / Praxis *</label><input name="name" required autofocus></div>
            <div class="feld-paar"><div class="feld"><label>Telefon</label><input name="telefon"></div>
              <div class="feld"><label>E-Mail</label><input type="email" name="email"></div></div>
            <div class="feld-paar"><div class="feld"><label>Ort</label><input name="ort"></div>
              <div class="feld"><label>Branche</label><input name="branche" placeholder="z. B. Physiotherapie"></div></div>
            <div class="feld"><label>Website</label><input name="website" placeholder="https://…"></div>
            <div class="feld-paar">
              <div class="feld"><label>Status</label><select name="status">
                <option value="lead">Lead</option><option value="kunde">Kunde</option></select></div>
              <div class="feld"><label>Verantwortlich</label><select name="besitzer">
                ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === u.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
            </div>
            <div class="dialog-fuss"><button type="button" class="sekundaer" onclick="document.getElementById('neu').close()">Abbrechen</button>
              <button type="submit" class="dunkel">Kunden anlegen</button></div>
          </form></dialog>`));
    } catch (err) { next(err); }
  });

  app.post("/crm/kunden/anlegen", async (req, res, next) => {
    try { const r = await crm.firmaAnlegen(req.nutzer, req.body);
      res.redirect(`/crm/firma/${r.id}${r.dublette ? "?dublette=" + r.dublette.id : ""}`);
    } catch (err) { next(err); }
  });

  // ================= LEADS =================
  app.get("/crm/leads", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const { suche = "", temperatur = "" } = req.query;
      const firmen = await crm.firmenListe(u, { suche, status: "lead", temperatur, limit: 300 });
      const zeilen = firmen.map((f) => `<tr onclick="location.href='/crm/firma/${f.id}'" style="cursor:pointer">
        <td><div class="zeile-titel">${e(f.name)}</div><div class="zeile-sub">${e(f.ort || "")}${f.branche ? " · " + e(f.branche) : ""}</div></td>
        <td>${f.telefon ? `<a href="tel:${e(f.telefon)}" onclick="event.stopPropagation()">${e(f.telefon)}</a>` : "—"}</td>
        <td>${f.website ? `<a href="${e(f.website)}" target="_blank" onclick="event.stopPropagation()">Website ↗</a>` : `<span class="badge b-gruen">keine ✨</span>`}</td>
        <td>${f.score ? `<span class="badge ${f.score >= 9 ? "b-gruen" : f.score >= 7 ? "b-bernstein" : ""}">${f.score}/10</span>` : "—"}</td>
        <td><span class="badge ${f.temperatur === "heiss" ? "b-rosa" : f.temperatur === "kalt" ? "" : "b-bernstein"}"><span class="punkt"></span>${e(f.temperatur || "warm")}</span></td>
        <td>${e(f.besitzer_name || "—")}</td>
        <td class="rechts">${f.wiedervorlage ? `<span class="badge ${new Date(f.wiedervorlage) <= new Date() ? "b-rot" : "b-blau"}">${datum(f.wiedervorlage)}</span>` : `<span class="caption">—</span>`}</td></tr>`).join("");

      res.send(rahmen(u, "leads", "Leads", "Offene Vertriebskontakte", "", `
        <div class="seiten-kopf" style="margin-bottom:14px"><div></div>
          <a class="knopf dunkel" href="/crm/kunden">${ICON.plus} Neuer Lead</a></div>
        <form class="filter" method="get">
          <span class="such">${ICON.suche}<input type="search" name="suche" placeholder="Suchen: Name, Ort, Telefon …" value="${e(suche)}"></span>
          <select name="temperatur"><option value="">Alle Temperaturen</option>
            ${["heiss", "warm", "kalt"].map((t) => `<option ${temperatur === t ? "selected" : ""}>${t}</option>`).join("")}</select>
          <button class="sekundaer" type="submit">Filtern</button>
          <span class="filter-zahl">${firmen.length} Einträge</span></form>
        ${firmen.length ? `<div class="tabelle-huelle"><table class="tabelle">
          <thead><tr><th>Firma</th><th>Telefon</th><th>Website</th><th>Score</th><th>Temperatur</th><th>Verantwortlich</th><th class="rechts">Wiedervorlage</th></tr></thead>
          <tbody>${zeilen}</tbody></table></div>`
        : `<div class="karte leer"><div class="leer-icon">${ICON.leads}</div><h3>Keine Leads gefunden</h3>
           <p>Passe die Filter an oder leg über „Kunden" einen neuen Lead an.</p></div>`}`));
    } catch (err) { next(err); }
  });

  // ================= FIRMA / KUNDENAKTE =================
  app.get("/crm/firma/:id", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const f = await crm.firma(u, req.params.id);
      if (!f) return res.status(404).send(rahmen(u, "kunden", "Nicht gefunden", "", "",
        `<div class="karte leer"><h3>Nicht gefunden</h3><p>Dieser Eintrag existiert nicht oder gehört jemand anderem.</p></div>`));
      const mitarbeiter = await crm.team(u);

      res.send(rahmen(u, f.status === "kunde" ? "kunden" : "leads", f.name,
        `${f.status === "kunde" ? "Kunde" : "Lead"}${f.ort ? " · " + e(f.ort) : ""}`, "", `
        <div class="seiten-kopf">
          <div><h1>${e(f.name)}</h1>
            <p><span class="badge ${f.status === "kunde" ? "b-gruen" : f.status === "verloren" ? "b-rot" : "b-blau"}">${f.status === "kunde" ? "Kunde" : f.status === "verloren" ? "Verloren" : "Lead"}</span>
            ${f.score ? ` <span class="badge ${f.score >= 9 ? "b-gruen" : "b-bernstein"}">Score ${f.score}/10</span>` : ""}
            ${f.branche ? " · " + e(f.branche) : ""}</p></div>
          <div style="display:flex;gap:8px">
            ${f.telefon ? `<a class="knopf sekundaer" href="tel:${e(f.telefon)}">${ICON.telefon} Anrufen</a>` : ""}
            <button class="dunkel" onclick="document.getElementById('dealNeu').showModal()">${ICON.plus} Deal</button></div>
        </div>
        ${req.query.dublette ? `<div class="hinweis warn" style="margin-bottom:16px">${ICON.warnung}<div>Es gibt bereits einen ähnlichen Eintrag —
          <a href="/crm/firma/${e(req.query.dublette)}">hier ansehen</a>. Prüfe, ob das eine Dublette ist.</div></div>` : ""}
        <div class="zwei-spalten">
          <div>
            ${f.stand ? `<div class="karte"><h2>Stand</h2><p class="sub" style="margin-top:8px">${e(f.stand)}</p></div>` : ""}
            <div class="karte"><div class="karte-kopf"><h2>Deals</h2></div>
              ${f.deals.length ? `<table class="tabelle"><tbody>${f.deals.map((d) => `
                <tr><td><div class="zeile-titel">${e(d.titel)}</div><div class="zeile-sub">${e(SPARTEN[d.sparte] || d.sparte)}</div></td>
                <td><span class="badge ${d.status === "gewonnen" ? "b-gruen" : d.status === "verloren" ? "b-rot" : "b-blau"}">${e(d.stufe_name || d.status)}</span></td>
                <td class="rechts" style="font-weight:600">${geld(d.wert)}</td></tr>`).join("")}</tbody></table>`
              : `<p class="caption">Noch kein Deal. Leg oben einen an — er erscheint dann in der Pipeline.</p>`}</div>
            ${f.projekte.length ? `<div class="karte"><div class="karte-kopf"><h2>Projekte</h2></div>
              <table class="tabelle"><tbody>${f.projekte.map((p) => `<tr><td class="zeile-titel">${e(p.titel)}</td>
              <td class="rechts"><span class="badge b-blau">${e(p.stufe_name || p.status)}</span></td></tr>`).join("")}</tbody></table></div>` : ""}
            <div class="karte"><div class="karte-kopf"><h2>Verlauf</h2></div>
              ${f.historie.map((h) => `<div class="feed-eintrag">
                <div class="feed-icon ${h.art === "anruf" ? "blau" : h.art === "stufenwechsel" ? "gruen" : ""}">${h.art === "anruf" ? ICON.telefon : h.art === "stufenwechsel" ? ICON.trend : ICON.notiz}</div>
                <div><div class="feed-text">${e(h.text)}</div><div class="feed-zeit">${zeit(h.zeit)}${h.wer_name ? " · " + e(h.wer_name) : ""}</div></div></div>`).join("")}
              <form method="post" action="/crm/firma/${f.id}/notiz" style="display:flex;gap:8px;margin-top:14px">
                <input name="text" placeholder="Notiz hinzufügen …" required><button type="submit">Speichern</button></form></div>
          </div>
          <div>
            <div class="karte"><div class="karte-kopf"><h2>Stammdaten</h2></div>
              <dl class="def">
                <dt>Telefon</dt><dd>${f.telefon ? `<a href="tel:${e(f.telefon)}">${e(f.telefon)}</a>` : "—"}</dd>
                <dt>E-Mail</dt><dd>${f.email ? `<a href="mailto:${e(f.email)}">${e(f.email)}</a>` : "—"}</dd>
                <dt>Website</dt><dd>${f.website ? `<a href="${e(f.website)}" target="_blank">öffnen ↗</a>` : `<span class="badge b-gruen">keine ✨</span>`}</dd>
                <dt>Ort</dt><dd>${e(f.ort || "—")}</dd>
                <dt>Quelle</dt><dd>${e(f.quelle || "—")}</dd>
                <dt>Verantwortlich</dt><dd>${e(f.besitzer_name || "—")}</dd>
                <dt>Versuche</dt><dd>${f.versuche || 0}</dd>
                <dt>Angelegt</dt><dd>${datum(f.erstellt)}</dd></dl>
              ${f.argumente?.length ? `<h2 style="margin-top:18px">Verkaufsargumente</h2>
                <ul style="margin:10px 0 0 17px;font-size:13px;color:var(--text-secondary);line-height:1.55">
                ${f.argumente.map((a) => `<li style="margin-bottom:5px">${e(a)}</li>`).join("")}</ul>` : ""}</div>
            <div class="karte"><div class="karte-kopf"><div><h2>Anruf-Ergebnis</h2>
              <div class="sub">Ein Klick — Verlauf und Status werden mitgeschrieben.</div></div></div>
              <form method="post" action="/crm/firma/${f.id}/call" style="display:grid;gap:10px">
                <button name="ausgang" value="termin" style="background:var(--success);justify-content:center">${ICON.check} Erstgespräch gebucht</button>
                <button name="ausgang" value="nicht-erreicht" class="sekundaer" style="justify-content:center">${ICON.uhr} Nicht erreicht</button>
                <div style="border-top:1px solid var(--border);padding-top:12px"><label>Später anrufen am</label>
                  <div style="display:flex;gap:8px"><input type="date" name="datum" style="flex:1">
                    <button name="ausgang" value="spaeter" class="sekundaer">Merken</button></div></div>
                <div style="border-top:1px solid var(--border);padding-top:12px"><label>Absage — Grund (Pflicht)</label>
                  <div style="display:flex;gap:8px"><select name="grund" style="flex:1"><option value="">bitte wählen …</option>
                    <option>kein Bedarf</option><option>zu teuer</option><option>hat schon</option><option>kein Interesse</option></select>
                    <button name="ausgang" value="absage" class="sekundaer" style="color:var(--danger);border-color:var(--danger)">${ICON.x}</button></div></div>
              </form></div>
          </div>
        </div>
        <dialog id="dealNeu"><h2>Neuer Deal</h2><div class="sub">für ${e(f.name)}</div>
          <form method="post" action="/crm/deal/anlegen"><input type="hidden" name="firma_id" value="${f.id}">
            <div class="feld"><label>Dealname *</label><input name="titel" required value="Website + Wartung" autofocus></div>
            <div class="feld-paar"><div class="feld"><label>Sparte</label><select name="sparte">
              ${Object.entries(SPARTEN).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join("")}</select></div>
              <div class="feld"><label>Wert (€)</label><input name="wert" type="number" step="1"></div></div>
            <div class="feld"><label>Verantwortlich</label><select name="besitzer">
              ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === u.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
            <div class="dialog-fuss"><button type="button" class="sekundaer" onclick="document.getElementById('dealNeu').close()">Abbrechen</button>
              <button type="submit" class="dunkel">Deal anlegen</button></div></form></dialog>`));
    } catch (err) { next(err); }
  });

  app.post("/crm/firma/:id/notiz", async (req, res, next) => {
    try { await crm.notiz(req.nutzer, req.params.id, req.body.text); res.redirect(`/crm/firma/${req.params.id}`); } catch (e) { next(e); }
  });
  app.post("/crm/firma/:id/call", async (req, res, next) => {
    try { await crm.callErgebnis(req.nutzer, req.params.id, req.body.ausgang, { grund: req.body.grund, datum: req.body.datum || null });
      res.redirect(`/crm/firma/${req.params.id}`); } catch (e) { next(e); }
  });

  // ================= TEAM =================
  app.get("/crm/team", async (req, res, next) => {
    try {
      const u = req.nutzer;
      if (u.rolle !== "admin") return res.redirect("/crm");
      const t = await crm.teamZahlen(u);
      const monat = new Date().toLocaleDateString("de-DE", { month: "long" });
      const gesamtUmsatz = t.reduce((a, p) => a + Number(p.umsatz_monat || 0), 0);
      const gesamtGewonnen = t.reduce((a, p) => a + p.gewonnen, 0);
      const gesamtVerloren = t.reduce((a, p) => a + p.verloren, 0);
      const quote = gesamtGewonnen + gesamtVerloren > 0 ? Math.round((gesamtGewonnen / (gesamtGewonnen + gesamtVerloren)) * 100) : 0;
      const maxU = Math.max(1, ...t.map((p) => Number(p.umsatz_monat) || 0));

      const reiter = "";

      res.send(rahmen(u, "team", "Team-Leistung", "Umsatz, Abschlüsse und Aktivität je Person", reiter, `
        <div class="kacheln">
          ${kachel(`Umsatz ${e(monat)}`, gesamtUmsatz, ICON.euro, "gruen", `<span class="caption">alle Personen zusammen</span>`, true)}
          ${kachel("Gewonnene Deals", gesamtGewonnen, ICON.check, "", `<span class="caption">${gesamtVerloren} verloren</span>`)}
          ${kachel("Abschlussquote", quote, ICON.prozent, "bernstein", `<span class="caption">gewonnen ÷ entschieden</span>`, false, " %")}
          ${kachel("Anrufe heute", t.reduce((a, p) => a + p.anrufe_heute, 0), ICON.telefon, "rosa", `<span class="caption">im gesamten Team</span>`)}
        </div>
        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div><h2>Umsatz je Person</h2>
          <div class="sub">Gewonnene Deals im ${e(monat)}</div></div></div>
          <div class="balken-block">${t.map((p) => `<div class="balken-saeule">
            <div class="balken" style="height:${Math.max(3, Math.round((Number(p.umsatz_monat) || 0) / maxU * 100))}%"></div>
            <span class="balken-label">${e(p.name.split(" ")[0])}</span></div>`).join("")}</div></div>
        <div class="tabelle-huelle"><table class="tabelle">
          <thead><tr><th>Person</th><th>Rolle</th><th class="rechts">Leads</th><th class="rechts">Kunden</th>
            <th class="rechts">Offen</th><th class="rechts">Gewonnen</th><th class="rechts">Verloren</th>
            <th class="rechts">Quote</th><th class="rechts">Umsatz ${e(monat)}</th><th class="rechts">Anrufe heute</th></tr></thead>
          <tbody>${t.map((p) => { const q = p.gewonnen + p.verloren > 0 ? Math.round((p.gewonnen / (p.gewonnen + p.verloren)) * 100) : null;
            return `<tr><td class="zeile-titel">${e(p.name)}</td>
              <td><span class="badge ${p.rolle === "admin" ? "b-blau" : ""}">${p.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter"}</span></td>
              <td class="rechts">${p.leads}</td><td class="rechts">${p.kunden}</td><td class="rechts">${p.offen}</td>
              <td class="rechts">${p.gewonnen ? `<span class="badge b-gruen">${p.gewonnen}</span>` : "—"}</td>
              <td class="rechts">${p.verloren || "—"}</td><td class="rechts">${q === null ? "—" : q + " %"}</td>
              <td class="rechts" style="font-weight:600">${geld(p.umsatz_monat)}</td>
              <td class="rechts">${p.anrufe_heute || "—"}</td></tr>`; }).join("")}</tbody></table></div>`));
    } catch (err) { next(err); }
  });
};
