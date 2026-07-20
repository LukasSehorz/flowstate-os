// Flowstate CRM — Oberflaeche nach Estera-Vorbild, Flowstate-Inhalte.
const crm = require("./crm.js");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const geld = (n) => (n == null ? "–" : Math.round(Number(n)).toLocaleString("de-DE") + " €");
const geldK = (n) => { const v = Number(n) || 0; return v >= 1000 ? Math.round(v / 1000) + "k €" : Math.round(v) + " €"; };
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
  prozent: S('<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>'),
};

const RAIL = [
  { id: "start", href: "/crm", icon: "start", titel: "Dashboard" },
  { id: "pipeline", href: "/crm/pipeline", icon: "pipeline", titel: "Pipeline" },
  { id: "kunden", href: "/crm/kunden", icon: "kunden", titel: "Kunden" },
  { id: "leads", href: "/crm/leads", icon: "leads", titel: "Leads" },
  { id: "team", href: "/crm/team", icon: "team", titel: "Team", nurAdmin: true },
];

function rahmen(user, aktiv, titel, unterzeile, reiter, inhalt) {
  const rail = RAIL.filter((r) => !r.nurAdmin || user.rolle === "admin")
    .map((r) => `<a href="${r.href}" class="${r.id === aktiv ? "aktiv" : ""}" title="${e(r.titel)}">${ICON[r.icon]}</a>`).join("");
  const init = user.name.split(" ").map((t) => t[0]).slice(0, 2).join("");
  const heute = new Date().toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long" });
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(titel)} · Flowstate CRM</title><link rel="stylesheet" href="/crm.css"></head><body>
<div class="shell">
  <aside class="rail">
    <div class="rail-logo">${ICON.logo}</div>${rail}
    <div class="rail-luecke"></div>
    <div class="rail-avatar">${e(init)}</div>
    <a href="/crm/abmelden" title="Abmelden">${ICON.abmelden}</a>
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

      // Trichter (erste Sparte oder gewählte)
      const trichterSparte = sparte || "webdesign";
      const tBoard = boards[spartenListe.indexOf(trichterSparte)] || boards[0] || [];
      // Kumulativ: "diese Stufe erreicht" = Deals hier + in allen spaeteren Stufen -> echte Trichterform
      const quotenT = [10, 25, 40, 60, 80, 95, 100, 100];
      const kum = tBoard.map((_, i) => tBoard.slice(i).reduce((a, s) => a + s.deals.length, 0));
      const kumW = tBoard.map((_, i) => tBoard.slice(i).reduce((a, s) => a + s.deals.reduce((m, d) => m + Number(d.wert || 0), 0), 0));
      const tMax = Math.max(1, ...kum);
      const trichter = tBoard.map((s, i) => {
        const n = kum[i], breite = Math.max(14, Math.round((n / tMax) * 100));
        return `<div class="trichter-zeile"><div class="trichter-spur">
          <div class="trichter-balken" style="width:${breite}%;background:var(--stage-${(i % 8) + 1})">${n}</div></div>
          <div class="trichter-info"><strong>${e(s.name)} · ${quotenT[i] || 100} %</strong><span>${kumW[i] ? geld(kumW[i]) : "—"}</span></div></div>`;
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

      const reiter = reiterLeiste([
        { id: "start", label: "Übersicht", href: "/crm" + (sparte ? "?sparte=" + sparte : "") },
        { id: "pipeline", label: "Pipeline-Volumen", href: "/crm/pipeline" + (sparte ? "?sparte=" + sparte : "") },
        ...(u.rolle === "admin" ? [{ id: "team", label: "Team-Leistung", href: "/crm/team" }] : []),
      ], "start", sparte, "/crm");

      res.send(rahmen(u, "start", "Dashboard", "", reiter, `
        <div class="kacheln">
          ${kachel(`Umsatz ${e(monat)}`, z.umsatz_monat, ICON.euro, "gruen",
            `<span class="trend auf">${fortschritt} % vom Ziel</span><span class="caption">Ziel ${geld(ziel)}</span>`, true)}
          ${kachel("Pipeline-Wert", wert, ICON.trend, "", `<span class="caption">${offen} offene Deals${sparte ? " · " + e(SPARTEN[sparte]) : " über alle Sparten"}</span>`, true)}
          ${kachel("Offene Leads", alle.filter((f) => f.status === "lead").length, ICON.leads, "",
            `<span class="caption">${heisse.length} heiß · ${faellig.length} fällig</span>`)}
          ${kachel("Kunden", z.kunden, ICON.kunden, "rosa", `<span class="caption">${z.gewonnen_monat} gewonnen im ${e(monat)}</span>`)}
        </div>

        <div class="raster raster-2" style="margin-bottom:16px">
          <div class="karte">
            <div class="karte-kopf"><div><h2>Heute zu tun</h2>
              <div class="sub">Deine Handlungsliste — fällige Wiedervorlagen und heiße Leads.</div></div>
              <a href="/crm/leads" class="caption">Alle Leads →</a></div>
            ${heisse.length ? `<div class="signal"><div class="signal-icon">${ICON.flamme}</div>
              <div class="signal-text"><b>${heisse.length} heiße ${heisse.length === 1 ? "Lead wartet" : "Leads warten"} auf dich</b>
              <span>Score 9 oder 10 — noch kein Deal angelegt.</span></div>
              <a href="/crm/leads?temperatur=heiss" class="knopf klein">Ansehen</a></div>` : ""}
            <div class="spalten-titel">${ICON.uhr} Wiedervorlagen ${faellig.length ? `<span class="badge b-rot">${faellig.length} fällig</span>` : ""}</div>
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
        </div>`));
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
      const quoten = [10, 25, 40, 60, 80, 95, 100, 100];

      const reiter = reiterLeiste([
        { id: "start", label: "Übersicht", href: "/crm?sparte=" + sparte },
        { id: "pipeline", label: "Pipeline-Volumen", href: "/crm/pipeline?sparte=" + sparte },
        ...(u.rolle === "admin" ? [{ id: "team", label: "Team-Leistung", href: "/crm/team" }] : []),
      ], "pipeline", sparte, "/crm/pipeline?art=" + art);

      res.send(rahmen(u, "pipeline", SPARTEN[sparte], "Vertriebspipeline · " + (art === "projekt" ? "Projekte" : "Verkauf"), reiter, `
        <div class="seiten-kopf">
          <div><h1>${e(SPARTEN[sparte])}</h1>
            <p>${gesamt} offene Deals · ${geld(wert)} Gesamtwert</p></div>
          <div style="display:flex;gap:10px;align-items:center">
            <div class="segmente" style="margin:0">
              <a href="/crm/pipeline?sparte=${sparte}&art=vertrieb" class="${art === "vertrieb" ? "aktiv" : ""}">Verkauf</a>
              <a href="/crm/pipeline?sparte=${sparte}&art=projekt" class="${art === "projekt" ? "aktiv" : ""}">Projekte</a></div>
            <button class="dunkel" onclick="document.getElementById('dealNeu').showModal()">${ICON.plus} Neuer Deal</button></div>
        </div>
        <div class="kanban">
          ${spalten.map((s, i) => `
            <div class="spalte" data-stufe="${s.id}" style="--stufe:var(--stage-${(i % 8) + 1})">
              <div class="spalte-kopf"><div class="spalte-titel-zeile">
                <span class="spalte-titel">${e(s.name)}</span><span class="spalte-zahl">${s.deals.length}</span></div>
                <div class="spalte-quote">${art === "vertrieb" ? (quoten[i] || 100) + " % Wahrscheinlichkeit" : "Phase " + (i + 1)}</div></div>
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
        <div class="seiten-kopf"><div><h1>Kunden</h1><p>Leads, Interessenten und Bestandskunden</p></div>
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
        <div class="seiten-kopf"><div><h1>Leads</h1><p>${firmen.length} offene Vertriebskontakte</p></div>
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

      const reiter = reiterLeiste([
        { id: "start", label: "Übersicht", href: "/crm" },
        { id: "pipeline", label: "Pipeline-Volumen", href: "/crm/pipeline" },
        { id: "team", label: "Team-Leistung", href: "/crm/team" },
      ], "team", "", "/crm/team");

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
