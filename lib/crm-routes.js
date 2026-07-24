// Flowstate CRM — Oberflaeche nach Estera-Vorbild, Flowstate-Inhalte.
const crm = require("./crm.js");
const { schale } = require("./schale.js");

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
  trendAb: S('<path d="M22 17l-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>'),
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
  zurueck: S('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
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

// Das CRM rendert durch dieselbe Huelle wie das restliche OS (lib/schale.js).
// Es hat keine eigene Rail und keinen eigenen Kopf mehr — man bleibt im OS,
// nur der Inhaltsbereich wechselt. Die CRM-Bereiche haengen als Unterpunkte
// am Modul "Kunden & CRM".
const SCHALE_ID = { start: "crm-start", leads: "crm-leads", kunden: "crm-kunden", team: "crm-team", todos: "crm-todos" };

function rahmen(user, aktiv, titel, unterzeile, reiter, inhalt, sparte, hinweise = []) {
  const id = aktiv === "pipeline"
    ? ({ webdesign: "crm-webdesign", performance: "crm-performance", ki: "crm-ki" }[sparte] || "crm-webdesign")
    : SCHALE_ID[aktiv] || "crm";
  return schale({
    titel, unterzeile, reiter, inhalt, nutzer: user, aktiv: id, hinweise,
    suche: "CRM durchsuchen — Kunden, Leads …",
  }) + `
<script src="/lib/gsap.min.js"></script>
<script>
if(window.gsap){
  gsap.from(".kachel",{y:10,opacity:0,duration:.35,stagger:.04,ease:"power2.out"});
  gsap.from(".karte,.tabelle-huelle,.spalte",{y:8,opacity:0,duration:.3,stagger:.03,delay:.05,ease:"power2.out"});
  document.querySelectorAll("[data-zahl]").forEach(el=>{const z=parseFloat(el.dataset.zahl)||0,o={v:0};
    gsap.to(o,{v:z,duration:.8,ease:"power2.out",onUpdate:()=>{el.textContent=el.dataset.geld?Math.round(o.v).toLocaleString("de-DE")+" \u20ac":(el.dataset.suffix?Math.round(o.v)+el.dataset.suffix:Math.round(o.v));}});});
  gsap.utils.toArray(".trichter-balken,.balken,.fortschritt>span").forEach(el=>{
    const b=el.style.width||el.style.height; if(!b)return;
    if(el.classList.contains("balken")){gsap.from(el,{height:0,duration:.7,ease:"power2.out",delay:.1});}
    else{gsap.from(el,{width:0,duration:.7,ease:"power2.out",delay:.1});}});
}
</script></body></html>`;
}

function rahmenPipeline(u, sparte, art, reiter, inhalt) {
  return rahmen(u, "pipeline", SPARTEN[sparte],
    "Vertriebspipeline \u00b7 " + (art === "projekt" ? "Projekte" : "Verkauf"), reiter, inhalt, sparte);
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

const kachel = (label, zahl, icon, farbe, fuss, istGeld, suffix, klasse) => `
  <div class="kachel${klasse ? " " + klasse : ""}"><div class="kachel-kopf"><span class="kachel-label">${label}</span>
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
  // Abmelden gilt fuers ganze OS — sonst bliebe man im OS drin, aber aus dem CRM raus.
  app.get("/crm/abmelden", (req, res) => { req.session.destroy(() => res.redirect("/login")); });
  app.use("/crm", (req, res, next) => {
    if (req.path.startsWith("/anmelden")) return next();
    if (!req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm; next();
  });

  // ================= ZEITERFASSUNG (Stoppuhr im Header) =================
  app.get("/crm/zeit/status", async (req, res, next) => {
    try { res.json(await crm.zeitStatus(req.nutzer)); } catch (err) { next(err); }
  });
  app.get("/crm/zeit/resuemee", async (req, res, next) => {
    try { res.json(await crm.zeitResuemee(req.nutzer)); } catch (err) { next(err); }
  });
  app.post("/crm/zeit/start", async (req, res, next) => {
    try { res.json(await crm.zeitStart(req.nutzer)); } catch (err) { next(err); }
  });
  app.post("/crm/zeit/pause", async (req, res, next) => {
    try { res.json(await crm.zeitPause(req.nutzer)); } catch (err) { next(err); }
  });
  app.post("/crm/zeit/ende", async (req, res, next) => {
    try { res.json(await crm.zeitEnde(req.nutzer)); } catch (err) { next(err); }
  });
  app.post("/crm/zeit/herzschlag", async (req, res, next) => {
    try { res.json(await crm.zeitHerzschlag(req.nutzer)); } catch (err) { next(err); }
  });

  // ================= DASHBOARD =================
  app.get("/crm", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const sparte = SPARTEN[req.query.sparte] ? req.query.sparte : "";
      let tab = ["uebersicht", "pipeline"].includes(req.query.tab) ? req.query.tab : "uebersicht";
      // Pipeline-Volumen gibt es nur in der Gesamtsicht — bei einer einzelnen Sparte
      // steckt dieselbe Info schon in deren Uebersicht, also zurueck auf "uebersicht".
      if (tab === "pipeline" && sparte) tab = "uebersicht";
      const zeitraum = ["30", "3", "6", "12"].includes(req.query.zr) ? req.query.zr : "6";
      const [z, alle, team, todosHeute] = await Promise.all([
        crm.kennzahlen(u), crm.firmenListe(u, { limit: 300 }),
        u.rolle === "admin" ? crm.teamZahlen(u) : Promise.resolve([]),
        crm.todosHeute(u),
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
      // Fuer den Vormonats-Vergleich immer ueber ALLE Sparten rechnen (wie z.umsatz_monat oben),
      // unabhaengig vom gerade gewaehlten Sparten-Tab.
      const gewGesamt = sparte ? await crm.gewonneneDeals(u) : gew;
      const monatsUmsatz = (monateZurueck) => {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - monateZurueck);
        const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        return gewGesamt.filter((g) => g.geschlossen_am && new Date(g.geschlossen_am).toISOString().slice(0, 7) === key)
          .reduce((a, g) => a + Number(g.wert || 0), 0);
      };
      const vormonatName = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
        return d.toLocaleDateString("de-DE", { month: "long" }); })();
      const vormonatUmsatz = monatsUmsatz(1);
      // Vergleich Vormonat (Juni) gegen den aktuellen, noch laufenden Monat (Juli) —
      // bewusst nicht gegen den Monat davor (Mai).
      const vormonatWachstum = z.umsatz_monat > 0
        ? Math.round(((vormonatUmsatz - z.umsatz_monat) / z.umsatz_monat) * 100)
        : (vormonatUmsatz > 0 ? 100 : 0);
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
      // Groesster offener Deal + Wert der Deals, die kurzfristig (naechste 30 Tage) erwartet
      // werden. Passt zur Bucket-Auswahl beim Deal ("Naechste 30 Tage" -> heute+30).
      const groesterDeal = alleDeals.length ? Math.max(...alleDeals.map((d) => Number(d.wert || 0))) : 0;
      // Kurzfrist-Forecast: Deals mit erwartetem Datum in den naechsten 30 Tagen, gewichtet
      // nach Stufen-Wahrscheinlichkeit (wie der grosse Forecast) — deshalb ueber die Boards
      // mit Stufen-Index iterieren, nicht ueber die flache alleDeals-Liste.
      const grenze30 = Date.now() + 31 * 86400000;
      let erwartet30 = 0;
      boards.forEach((b) => b.forEach((st, i) => st.deals.forEach((d) => {
        if (d.erwartet_am && new Date(d.erwartet_am).getTime() <= grenze30) {
          erwartet30 += Number(d.wert || 0) * (wahrsch(b.length, i) / 100);
        }
      })));
      // Ueberfaellige Deals: erwartetes Abschlussdatum liegt in der Vergangenheit, aber der
      // Deal ist noch offen (nicht auf "Gewonnen" gezogen) -> Hinweis in der Glocke, neues
      // Datum einzutragen. Wird beim Gewinnen/Verlieren automatisch aufgeloest (dann nicht mehr offen).
      const heuteMitternacht = new Date(); heuteMitternacht.setHours(0, 0, 0, 0);
      const ueberfaellig = alleDeals.filter((d) => d.erwartet_am && new Date(d.erwartet_am) < heuteMitternacht);
      const dealHinweise = ueberfaellig.map((d) => ({
        id: "deal-ueberfaellig-" + d.id,
        text: `Erwartetes Datum überschritten: ${d.titel || d.firma_name || "Deal"} — neues Datum eintragen`,
      }));
      const abg = await crm.abschlussZahlen(u, sparte);
      const quote = abg.gewonnen + abg.verloren > 0 ? Math.round((abg.gewonnen / (abg.gewonnen + abg.verloren)) * 100) : null;
      const dauer = abg.dauer ? Math.round(abg.dauer) : null;

      // DEMO-Daten fuer "Heute zu tun" — nur zur Veranschaulichung, an nichts angebunden.
      // wichtigkeit: 1 = Sehr wichtig, 2 = Wichtig, 3 = Sollte erledigt werden, 4 = Kann warten (Spalten).
      // dringlichkeit (Badge neben dem To-Do): Extrem dringend | Dringend | ASAP | Bald | Wenn Zeit da ist.
      const DUMMY_TODOS = [
        { titel: "Angebot schicken", kunde: "Physiotherapie Schwabing", wichtigkeit: 1, dringlichkeit: "Extrem dringend",
          faellig: "Montag, 28. Juli", empfaenger: "Dr. Anna Weber (Praxisleitung)", beschreibung: "Angebot für Website-Relaunch inkl. Terminbuchung und monatlicher Wartung erstellen und per E-Mail senden. Auf Wunsch zwei Pakete anbieten.",
          telefon: "+49 89 521648", email: "info@physio-schwabing.de", ort: "München", firmaId: 7 },
        { titel: "Setup-Call vorbereiten", kunde: "Physiotherapie Neuhausen", wichtigkeit: 1, dringlichkeit: "Dringend",
          faellig: "Dienstag, 29. Juli", empfaenger: "Herr Sommer", beschreibung: "Onboarding-Fragen zusammenstellen, Zugänge klären, Agenda für den Setup-Call schicken.",
          telefon: "+49 89 13011884", email: "kontakt@physio-neuhausen.de", ort: "München", firmaId: null },
        { titel: "Vertrag final prüfen", kunde: "GZM Gesundheitszentrum", wichtigkeit: 2, dringlichkeit: "ASAP",
          faellig: "Mittwoch, 30. Juli", empfaenger: "Rechtsabteilung GZM", beschreibung: "Vertragsentwurf gegenlesen, Laufzeit und Kündigungsfrist prüfen, offene Punkte markieren.",
          telefon: "+49 89 294445", email: "recht@gzm-muenchen.de", ort: "München", firmaId: null },
        { titel: "Rückruf Kai Zenker Praxis", kunde: "Kai Zenker Praxis", wichtigkeit: 2, dringlichkeit: "Dringend",
          faellig: "heute, 16:00", empfaenger: "Kai Zenker", beschreibung: "Rückfrage zum Angebot beantworten, Termin für Erstgespräch fixieren.",
          telefon: "+49 89 38586920", email: "praxis@zenker-physio.de", ort: "München", firmaId: 4 },
        { titel: "Follow-up E-Mail Peter Heidemann", kunde: "Peter Heidemann Physio", wichtigkeit: 3, dringlichkeit: "Bald",
          faellig: "Donnerstag, 31. Juli", empfaenger: "Peter Heidemann", beschreibung: "Freundliches Follow-up nach dem Erstgespräch, Zusammenfassung + nächste Schritte.",
          telefon: "+49 89 584219", email: "info@heidemann-physio.de", ort: "München", firmaId: 5 },
        { titel: "Rechnung Juli verschicken", kunde: "", thema: "Angebote & Rechnungen", wichtigkeit: 3, dringlichkeit: "ASAP",
          faellig: "Donnerstag, 31. Juli", empfaenger: "Buchhaltung", beschreibung: "Juli-Rechnungen erstellen und an alle aktiven Kunden versenden.", telefon: "", email: "", ort: "", firmaId: null },
        { titel: "Termin Steuerkanzlei vorbereiten", kunde: "", thema: "Buchhaltung", wichtigkeit: 3, dringlichkeit: "Bald",
          faellig: "Freitag, 1. August", empfaenger: "Steuerkanzlei Berger", beschreibung: "Belege Q2 sortieren, offene Fragen notieren, Unterlagen mitnehmen.", telefon: "", email: "", ort: "", firmaId: null },
        { titel: "TikTok-Video erstellen", kunde: "", thema: "Marketing & Content", wichtigkeit: 4, dringlichkeit: "Wenn Zeit da ist",
          faellig: "diese Woche", empfaenger: "—", beschreibung: "Kurzes Reel zum Thema Website in 7 Tagen — Skript, Aufnahme und Schnitt.", telefon: "", email: "", ort: "", firmaId: null },
        { titel: "YouTube-Video schneiden", kunde: "", thema: "Marketing & Content", wichtigkeit: 4, dringlichkeit: "Wenn Zeit da ist",
          faellig: "nächste Woche", empfaenger: "—", beschreibung: "Rohmaterial vom letzten Dreh schneiden, Intro + Untertitel ergänzen.", telefon: "", email: "", ort: "", firmaId: null },
        { titel: "Content-Plan August anlegen", kunde: "", thema: "Marketing & Content", wichtigkeit: 4, dringlichkeit: "Bald",
          faellig: "bis 3. August", empfaenger: "—", beschreibung: "Redaktionsplan für August mit Themen, Formaten und Veröffentlichungsterminen.", telefon: "", email: "", ort: "", firmaId: null },
      ];
      const DRING_FARBE = { "Extrem dringend": "b-rot", "Dringend": "b-rot", "ASAP": "b-bernstein", "Bald": "b-blau", "Wenn Zeit da ist": "" };
      const SPALTEN_TODO = [{ n: 1, titel: "Sehr wichtig" }, { n: 2, titel: "Wichtig" }, { n: 3, titel: "Sollte erledigt werden" }, { n: 4, titel: "Kann warten" }];
      const schnitt = verlauf.length ? verlauf.reduce((a, m) => a + m.wert, 0) / verlauf.length : 0;
      const letzterM = verlauf[verlauf.length - 1]?.wert || 0, vorM = verlauf[verlauf.length - 2]?.wert || 0;
      const wachstum = vorM > 0 ? ((letzterM - vorM) / vorM) * 100 : (letzterM > 0 ? 100 : null);

      // Trichter — in der Gesamt-Ansicht "Gesamt" (aktuell Dummy-Zahlen, bis die echten
      // sparten-uebergreifenden Deal-Zahlen anfallen), sonst der echte Trichter der Sparte.
      const istGesamt = !sparte;
      const trichterSparte = sparte || "webdesign";
      const tBoard = boards[spartenListe.indexOf(trichterSparte)] || boards[0] || [];
      // Kumulativ: "diese Stufe erreicht" = Deals hier + in allen spaeteren Stufen -> echte Trichterform
      const kum = tBoard.map((_, i) => tBoard.slice(i).reduce((a, s) => a + s.deals.length, 0));
      const kumW = tBoard.map((_, i) => tBoard.slice(i).reduce((a, s) => a + s.deals.reduce((m, d) => m + Number(d.wert || 0), 0), 0));
      const tMax = Math.max(1, ...kum);
      const trichterEcht = tBoard.map((s, i) => {
        const n = kum[i], breite = Math.max(14, Math.round((n / tMax) * 100));
        return `<div class="trichter-zeile"><div class="trichter-spur">
          <div class="trichter-balken" style="width:${breite}%;background:var(--stage-${(i % 8) + 1})">${n}</div></div>
          <div class="trichter-info"><strong>${e(s.name)} · ${wahrsch(tBoard.length, i)} %</strong><span>${kumW[i] ? geld(kumW[i]) : "—"}</span></div></div>`;
      }).join("");

      // DEMO-Trichter fuer die Gesamt-Ansicht (Platzhalter, bis echte Zahlen vorhanden sind)
      const DUMMY_TRICHTER = [
        { name: "Neu", n: 128, wert: 192000 },
        { name: "Kontaktiert", n: 86, wert: 140000 },
        { name: "Erstgespräch", n: 47, wert: 94000 },
        { name: "Angebot", n: 21, wert: 52000 },
        { name: "Gewonnen", n: 8, wert: 24000 },
      ];
      const dMax = Math.max(1, ...DUMMY_TRICHTER.map((d) => d.n));
      const trichterDummy = DUMMY_TRICHTER.map((s, i) => {
        const breite = Math.max(14, Math.round((s.n / dMax) * 100));
        return `<div class="trichter-zeile trichter-klick" onclick="document.getElementById('trichter-dlg-${i}').showModal()" title="Leads dieser Stufe ansehen"><div class="trichter-spur">
          <div class="trichter-balken" style="width:${breite}%;background:var(--stage-${(i % 8) + 1})">${s.n}</div></div>
          <div class="trichter-info"><strong>${e(s.name)} · ${wahrsch(DUMMY_TRICHTER.length, i)} %</strong><span>${geld(s.wert)}</span></div></div>`;
      }).join("");
      // Breites Stufen-Fenster: volle Info pro Lead, Suche + Seitenblaettern (30/Seite).
      // Die Zeilen werden client-seitig aus einem Pool erzeugt (Dummy, bis echte Deals da sind).
      const trichterDialoge = DUMMY_TRICHTER.map((s, i) => `<dialog id="trichter-dlg-${i}" class="trichter-dialog" data-count="${s.n}">
        <div class="trichter-dlg-kopf">
          <div><h2>${e(s.name)}</h2><div class="sub">${s.n} Leads in dieser Stufe · ${geld(s.wert)} Volumen</div></div>
          <div class="topbar-suche trichter-suche-huelle">${ICON.suche}<input type="search" class="trichter-suche" placeholder="Nach Firma oder Ort suchen …"></div>
          <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button>
        </div>
        <div class="tabelle-huelle" style="margin:0">
          <table class="tabelle"><thead><tr><th>Firma</th><th>Ort</th><th>Telefon</th><th>Verantwortlich</th>
            <th class="rechts">Score</th><th class="rechts">Wert</th><th></th></tr></thead>
            <tbody class="trichter-dlg-body"></tbody></table>
        </div>
        <div class="trichter-dlg-fuss">
          <span class="trichter-seiten-info caption"></span>
          <div class="trichter-blaettern"><button type="button" class="sekundaer klein trichter-prev">← Zurück</button>
            <button type="button" class="sekundaer klein trichter-next">Weiter →</button></div>
        </div>
      </dialog>`).join("") + `<script>
        (function(){
          var POOL=[
            {name:"Physiotherapie Schwabing",ort:"München",tel:"+49 89 521648",wer:"Lukas Sehorz",wahr:70,wert:3500},
            {name:"Kai Zenker Praxis",ort:"München",tel:"+49 89 38586920",wer:"Lukas Sehorz",wahr:40,wert:2800},
            {name:"Peter Heidemann Physio",ort:"München",tel:"+49 89 584219",wer:"Jannik vom Hofe",wahr:90,wert:5200},
            {name:"GZM Gesundheitszentrum",ort:"München",tel:"+49 89 294445",wer:"Lukas Sehorz",wahr:20,wert:4100},
            {name:"Physiopoint München",ort:"München",tel:"+49 89 12669030",wer:"Jannik vom Hofe",wahr:30,wert:2600},
            {name:"Body & Motion",ort:"München",tel:"+49 89 998293940",wer:"Lukas Sehorz",wahr:10,wert:3000},
            {name:"SCHWERPUNKT Praxis",ort:"München",tel:"+49 89 20201309",wer:"Jannik vom Hofe",wahr:50,wert:3400},
            {name:"Physiotherapie Neuhausen",ort:"München",tel:"+49 89 13011884",wer:"Lukas Sehorz",wahr:60,wert:3900},
            {name:"Physiotherapie Münchner Freiheit",ort:"München",tel:"+49 89 335863",wer:"Jannik vom Hofe",wahr:20,wert:2500},
            {name:"Praxis Theodoridis",ort:"München",tel:"+49 89 3081898",wer:"Lukas Sehorz",wahr:80,wert:4600},
            {name:"Physiotherapie an der Universität",ort:"München",tel:"+49 89 24402523",wer:"Jannik vom Hofe",wahr:40,wert:3100},
            {name:"Zentrum Physiotherapie mednord",ort:"München",tel:"+49 89 3164318",wer:"Lukas Sehorz",wahr:30,wert:2900},
            {name:"bensphysio",ort:"München",tel:"+49 89 68972263",wer:"Jannik vom Hofe",wahr:10,wert:2200},
            {name:"Physiotherapie Schwarzbach",ort:"München",tel:"+49 1517 0665408",wer:"Lukas Sehorz",wahr:50,wert:3300}
          ];
          function leadsFuer(n){var a=[];for(var k=0;k<n;k++){var b=POOL[k%POOL.length];var suffix=k>=POOL.length?" "+(Math.floor(k/POOL.length)+1):"";a.push({name:b.name+suffix,ort:b.ort,tel:b.tel,wer:b.wer,wahr:b.wahr,wert:b.wert});}return a;}
          document.querySelectorAll('.trichter-dialog').forEach(function(dlg){
            var count=parseInt(dlg.getAttribute('data-count'),10)||0;
            var alle=leadsFuer(count),gefiltert=alle,seite=1,proSeite=30;
            var body=dlg.querySelector('.trichter-dlg-body'),info=dlg.querySelector('.trichter-seiten-info'),suche=dlg.querySelector('.trichter-suche');
            function esc(x){return String(x).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}
            function render(){
              var seiten=Math.max(1,Math.ceil(gefiltert.length/proSeite)); if(seite>seiten)seite=seiten;
              var start=(seite-1)*proSeite, teil=gefiltert.slice(start,start+proSeite);
              body.innerHTML=teil.map(function(l){return '<tr><td class=\"zeile-titel\">'+esc(l.name)+'</td><td>'+esc(l.ort)+'</td><td>'+esc(l.tel)+'</td><td>'+esc(l.wer)+'</td><td class=\"rechts\"><span class=\"badge '+(l.wahr>=70?'b-gruen':l.wahr>=40?'b-bernstein':'b-rot')+'\">'+(l.wahr/10)+'/10</span></td><td class=\"rechts\" style=\"font-weight:600\">'+l.wert.toLocaleString('de-DE')+' €</td><td class=\"rechts\"><a class=\"knopf sekundaer klein\" href=\"/crm/kunden\">öffnen</a></td></tr>';}).join('') || '<tr><td colspan=\"7\" class=\"caption\" style=\"padding:16px\">Keine Treffer.</td></tr>';
              info.textContent='Seite '+seite+' von '+seiten+' · '+gefiltert.length+' Leads';
            }
            suche.addEventListener('input',function(){var q=suche.value.toLowerCase();gefiltert=alle.filter(function(l){return l.name.toLowerCase().indexOf(q)>-1||l.ort.toLowerCase().indexOf(q)>-1;});seite=1;render();});
            dlg.querySelector('.trichter-prev').addEventListener('click',function(){if(seite>1){seite--;render();}});
            dlg.querySelector('.trichter-next').addEventListener('click',function(){var seiten=Math.ceil(gefiltert.length/proSeite);if(seite<seiten){seite++;render();}});
            render();
          });
        })();
        </script>`;

      // Donut: Leads nach Quelle — die 5 festen Quellen (aktuell Dummy-Verteilung,
      // bis das quelle-Feld der Leads auf diese Kategorien umgestellt ist).
      const QUELL_FARBEN = ["#2B2A28", "#565656", "#848484", "#B2AFA8", "#D7D6D2"];
      const qListe = [
        ["Cold Calling", 42], ["Empfehlung", 28], ["Meta Ads", 24], ["Netzwerk", 19], ["Social Media", 15],
      ];
      const qGesamt = qListe.reduce((a, [, n]) => a + n, 0) || 1;
      let offsetAkk = 0; const U = 2 * Math.PI * 70;
      const donutSeg = qListe.map(([q, n], i) => {
        const anteil = n / qGesamt, laenge = anteil * U;
        const seg = `<circle cx="93" cy="93" r="70" fill="none" stroke="${QUELL_FARBEN[i % QUELL_FARBEN.length]}" stroke-width="26"
          stroke-dasharray="${laenge} ${U - laenge}" stroke-dashoffset="${-offsetAkk}"/>`;
        offsetAkk += laenge; return seg;
      }).join("");
      const donutLeg = qListe.map(([q, n], i) => `<div class="legende-zeile">
        <span class="legende-farbe" style="background:${QUELL_FARBEN[i % QUELL_FARBEN.length]}"></span>
        <span>${e(q)}</span><span class="legende-wert">${n}</span>
        <span class="legende-prozent">${Math.round((n / qGesamt) * 100)} %</span></div>`).join("");

      // Team-Balken — mit dem Umsatz klein ueber dem jeweiligen Balken
      const maxTeam = Math.max(1, ...team.map((t) => Number(t.umsatz_monat) || 0));
      const balken = team.filter((t) => t.rolle !== "x").map((t) => `
        <div class="balken-saeule">
        <div class="balken" style="height:${Math.max(3, Math.round((Number(t.umsatz_monat) || 0) / maxTeam * 100))}%"><span class="balken-wert">${geldK(Number(t.umsatz_monat) || 0)}</span></div>
        <span class="balken-label">${e(t.name.split(" ")[0])}</span></div>`).join("");


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
        // Pipeline-Volumen nur in der Gesamtsicht — bei einer Sparte zeigt deren
        // eigene Uebersicht das schon. Team-Leistung hat einen eigenen Navbar-Punkt.
        ...(sparte ? [] : [{ id: "pipeline", label: "Pipeline-Volumen", href: q("pipeline") }]),
      ], tab, sparte, "/crm?tab=" + tab);

      const offeneLeadsAnzahl = alle.filter((f) => f.status === "lead").length;
      const ansichten = {};
      ansichten.uebersicht = `
        <div class="raster" style="grid-template-columns:0.85fr 1.3fr 0.85fr;margin-bottom:16px;align-items:stretch">
          <div class="karte karte-schmal">
            <div class="karte-kopf"><div><h2>Umsatzentwicklung</h2>
              <div class="caption" style="margin-top:6px">Ø Umsatz pro Monat</div>
              <div class="chart-kopf"><span class="chart-zahl">${geld(schnitt)}</span>
                ${wachstum !== null ? `<span class="trend ${wachstum >= 0 ? "auf" : "ab"}">${wachstum >= 0 ? "↗" : "↘"} ${Math.abs(wachstum).toFixed(1).replace(".", ",")} %</span>` : ""}</div></div></div>
            <nav class="zeitraum zeitraum-schmal">
              ${[["30", "30 T"], ["3", "3 M"], ["6", "6 M"], ["12", "12 M"]].map(([k, v]) =>
                `<a href="/crm?tab=${tab}&zr=${k}${sparte ? "&sparte=" + sparte : ""}" class="${zeitraum === k ? "aktiv" : ""}">${v}</a>`).join("")}
            </nav>
            <div class="chart-flaeche" style="height:220px">
              <div class="chart-y">${[maxV, maxV * .75, maxV * .5, maxV * .25, 0].map((v, i) =>
                `<span style="top:${gitter[i]}px">${geldK(v)}</span>`).join("")}</div>
              <svg viewBox="0 0 800 200" preserveAspectRatio="none" style="width:100%;height:200px">
                <defs><linearGradient id="fl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--blau-600)" stop-opacity=".34"/>
                  <stop offset="55%" stop-color="var(--blau-500)" stop-opacity=".12"/>
                  <stop offset="100%" stop-color="var(--blau-500)" stop-opacity="0"/></linearGradient>
                  <linearGradient id="ln" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="var(--blau-400)"/><stop offset="100%" stop-color="var(--blau-800)"/></linearGradient></defs>
                ${gitter.map((y) => `<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 6"/>`).join("")}
                <path d="${flaeche}" fill="url(#fl)"/>
                <path d="${linie}" fill="none" stroke="url(#ln)" stroke-width="2.5" stroke-linecap="round"/>
                ${pkt.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#fff" stroke="var(--blau-600)" stroke-width="2.5"/>`).join("")}
              </svg>
              <div class="chart-achse" style="padding-left:0">${verlauf.map((m) => `<span class="caption">${e(m.label)}</span>`).join("")}</div>
            </div>
            ${wachstum !== null ? `<div class="chart-fuss"><span style="color:${wachstum >= 0 ? "var(--success)" : "var(--danger)"};font-weight:600">${wachstum >= 0 ? "+" : ""}${wachstum.toFixed(1).replace(".", ",")} %</span>
              Wachstum: letzter Monat gegenüber dem Monat davor</div>` : ""}
            <div class="kennliste" style="margin-top:14px;border-top:1px solid var(--border);padding-top:6px">
              <div class="kennzeile">${ICON.prozent}<span>Abschlussquote</span><b>${quote === null ? "—" : quote + " %"}</b></div>
              <div class="kennzeile">${ICON.sanduhr}<span>Ø Deal-Dauer</span><b>${dauer ? dauer + " Tage" : "—"}</b></div>
            </div>
          </div>

          <div class="karte karte-mitte">
            <div class="mini-stat-reihe">
              <div class="mini-stat"><span class="caption">Offene Leads</span><b>${offeneLeadsAnzahl}</b></div>
              <div class="mini-stat"><span class="caption">Pipeline-Wert</span><b>${geld(wert)}</b></div>
            </div>
            <div class="hero-umsatz">
              <div class="hero-umsatz-seite">
                <span class="kachel-mini-titel">Kunden</span>
                <div class="hero-umsatz-neben-zahl">${z.kunden}</div>
              </div>
              <div class="hero-umsatz-haupt">
                <span class="kachel-label">Umsatz ${e(monat)}</span>
                <div class="kachel-zahl" data-zahl="${z.umsatz_monat}" data-geld="1">0</div>
                <div class="kachel-fuss-stapel">
                  <span class="caption">Ziel: ${geld(ziel)}</span>
                  <span class="trend auf klein">${fortschritt} % vom Ziel</span>
                </div>
              </div>
              <div class="hero-umsatz-seite hero-umsatz-neben">
                <span class="kachel-mini-titel">${e(vormonatName)}</span>
                <div class="hero-umsatz-neben-zahl">${geld(vormonatUmsatz)}</div>
                <span class="kachel-mini-ziel">/ ${geld(ziel)}</span>
              </div>
            </div>
            <img src="/bilder/orb-grau.png" class="orb-deko" alt="">
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
              <div class="kennzeile">${ICON.ziel}<span>Größter Deal</span><b>${offen ? geld(groesterDeal) : "—"}</b></div>
              <div class="kennzeile">${ICON.kalender}<span>Nächste 30 Tage erwartet</span><b>${erwartet30 ? geld(erwartet30) : "—"}</b></div>
            </div>
            <a class="knopf dunkel" style="width:100%;justify-content:center;margin-top:16px"
               href="/crm/pipeline?sparte=${sparte || "webdesign"}">Zur offenen Pipeline</a>
          </div>
        </div>

        <div class="raster raster-2" style="margin-bottom:16px">
          <div class="karte">
            <div class="karte-kopf"><div><h2>Heute zu tun</h2>
              <div class="sub">Für heute geplant — nach Wichtigkeit sortiert, mit Dringlichkeit.</div></div>
              <a href="/crm/todos" class="caption">Alle To-Dos →</a></div>
            <div class="heute-spalten">
              ${SPALTEN_TODO.map((sp) => `<div class="heute-spalte">
                <div class="heute-spalte-kopf">${e(sp.titel)}</div>
                ${DUMMY_TODOS.map((t, i) => ({ t, i })).filter((x) => x.t.wichtigkeit === sp.n).map(({ t, i }) => `<div class="heute-todo ${["Extrem dringend", "Dringend"].includes(t.dringlichkeit) ? "heute-todo--dringend" : ""}" onclick="document.getElementById('todo-dlg-${i}').showModal()">
                  <button type="button" class="todo-haken" title="Als erledigt abhaken" onclick="event.stopPropagation(); this.closest('.heute-todo').remove()">${ICON.check}</button>
                  <div class="heute-todo-text">
                    <div class="heute-todo-titel">${e(t.kunde || t.thema || "Allgemein")}</div>
                    <span class="heute-todo-kunde">${e(t.titel)}</span>
                    <span class="badge dring ${DRING_FARBE[t.dringlichkeit] || ""}">${e(t.dringlichkeit)}</span>
                  </div></div>`).join("") || `<p class="caption" style="font-size:12px">—</p>`}
              </div>`).join("")}
            </div>
            ${DUMMY_TODOS.map((t, i) => `<dialog id="todo-dlg-${i}" class="todo-dialog">
              <div class="todo-dlg-kopf"><div><h2>${e(t.kunde || t.thema || "Allgemeine Aufgabe")}</h2><div class="sub">${e(t.titel)}</div></div>
                <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
              <div class="todo-dlg-badges">
                <span class="badge">Wichtigkeit: ${e(SPALTEN_TODO.find((s) => s.n === t.wichtigkeit).titel)}</span>
                <span class="badge ${DRING_FARBE[t.dringlichkeit] || ""}">${e(t.dringlichkeit)}</span></div>
              <div class="todo-dlg-grid">
                <div><span>Bis wann</span><b>${e(t.faellig || "—")}</b></div>
                <div><span>An wen</span><b>${e(t.empfaenger || "—")}</b></div></div>
              <h3>Was genau</h3><p class="todo-dlg-text">${e(t.beschreibung || "—")}</p>
              ${t.kunde ? `<h3>Kundenakte · ${e(t.kunde)}</h3>
                <dl class="def">
                  <dt>Telefon</dt><dd>${t.telefon ? `<a href="tel:${e(t.telefon)}">${e(t.telefon)}</a>` : "—"}</dd>
                  <dt>E-Mail</dt><dd>${t.email ? `<a href="mailto:${e(t.email)}">${e(t.email)}</a>` : "—"}</dd>
                  <dt>Ort</dt><dd>${e(t.ort || "—")}</dd></dl>` : ""}
              <div class="dialog-fuss">
                ${t.firmaId ? `<a href="/crm/firma/${t.firmaId}" class="knopf sekundaer">Zur vollständigen Kundenakte →</a>` : (t.kunde ? `<a href="/crm/kunden" class="knopf sekundaer">Kunde öffnen →</a>` : "")}
                <button type="button" class="dunkel" onclick="this.closest('dialog').close()">Schließen</button></div>
            </dialog>`).join("")}
            <script>
            (function(){
              var gezogen=null;
              // Findet die Karte, VOR der eingefuegt werden soll — anhand der Maus-Y-Position.
              // So landet das To-Do genau dort, wo man es fallen laesst (auch zwischen/unter anderen).
              function zielKarte(spalte, y){
                var karten = Array.prototype.slice.call(spalte.querySelectorAll('.heute-todo:not(.todo-zieht)'));
                var naechste = { abstand: -Infinity, el: null };
                karten.forEach(function(k){
                  var box = k.getBoundingClientRect();
                  var versatz = y - box.top - box.height/2;
                  if(versatz < 0 && versatz > naechste.abstand){ naechste = { abstand: versatz, el: k }; }
                });
                return naechste.el;
              }
              document.querySelectorAll('.heute-todo').forEach(function(el){
                el.setAttribute('draggable','true');
                el.addEventListener('dragstart',function(ev){ gezogen=el; setTimeout(function(){ el.classList.add('todo-zieht'); },0); ev.dataTransfer.effectAllowed='move'; });
                el.addEventListener('dragend',function(){ el.classList.remove('todo-zieht'); gezogen=null;
                  document.querySelectorAll('.heute-spalte').forEach(function(s){ s.classList.remove('spalte-ziel'); }); });
              });
              document.querySelectorAll('.heute-spalte').forEach(function(sp){
                sp.addEventListener('dragover',function(ev){
                  ev.preventDefault(); sp.classList.add('spalte-ziel');
                  if(!gezogen) return;
                  var nach = zielKarte(sp, ev.clientY);
                  if(nach == null) sp.appendChild(gezogen); else sp.insertBefore(gezogen, nach);
                });
                sp.addEventListener('dragleave',function(ev){ if(!sp.contains(ev.relatedTarget)) sp.classList.remove('spalte-ziel'); });
                sp.addEventListener('drop',function(ev){ ev.preventDefault(); sp.classList.remove('spalte-ziel'); });
              });
            })();
            </script>
          </div>

          <div class="karte-spalte">
            <div class="karte karte-trichter">
              <div class="karte-kopf"><div><h2>Trichter ${istGesamt ? "Gesamt" : e(SPARTEN[trichterSparte])}</h2>
                <div class="sub">Je Stufe erreicht · offene Deals</div></div>
                <a href="/crm/pipeline?sparte=${trichterSparte}" class="caption">öffnen →</a></div>
              ${istGesamt ? `<div class="trichter">${trichterDummy}</div>${trichterDialoge}`
                : tBoard.some((s) => s.deals.length) ? `<div class="trichter">${trichterEcht}</div>`
                : `<p class="caption">Noch keine Deals in dieser Sparte. Leg bei einem Lead einen Deal an — er erscheint dann hier.</p>`}
            </div>
            ${u.rolle === "admin" ? `<div class="karte karte-dunkel" style="margin-top:16px"><div class="karte-kopf"><div><h2>Umsatz je Person</h2>
              <div class="sub">Gewonnene Deals im ${e(monat)}</div></div>
              <a href="/crm/team" class="caption">Details →</a></div>
              <div class="balken-block">${balken}</div></div>` : ""}
          </div>
        </div>

        <div class="raster raster-2" style="align-items:start">
          <div class="karte"><div class="karte-kopf"><div><h2>Leads nach Quelle</h2>
            <div class="sub">Woher unsere Kontakte kommen</div></div></div>
            <div class="donut-block">
              <div class="donut"><svg width="186" height="186">${donutSeg}</svg>
                <div class="donut-mitte"><div><b>${qGesamt}</b><span class="caption">Gesamt</span></div></div></div>
              <div class="donut-legende">${donutLeg || '<span class="caption">Noch keine Daten.</span>'}</div>
            </div></div>
          <div style="max-width:230px">
            ${kachel("Gescheiterte Deals", z.verloren_monat, ICON.trendAb, "rot", `<span class="caption">Wert: ${geld(z.verloren_wert_monat)}</span>`)}
          </div>
        </div>`;

      // Pipeline-Volumen (nur Gesamtsicht): ein einziger, ausfuehrlicher Kasten
      // "Volumen je Sparte" im Designmuster der Uebersichtsseite.
      const pvGesamtVol = auswertung.reduce((a, x) => a + x.volumen, 0);
      const pvGesamtGew = auswertung.reduce((a, x) => a + x.gewichtet, 0);
      const pvGesamtDeals = auswertung.reduce((a, x) => a + x.anzahl, 0);
      const pvSortiert = [...auswertung].sort((a, b2) => b2.volumen - a.volumen);
      ansichten.pipeline = `
        <div class="karte" style="margin-bottom:16px">
          <div class="karte-kopf"><div><h2>Volumen je Sparte</h2>
            <div class="sub">Wo unser offenes Geld liegt \u2014 und was davon gewichtet realistisch ist</div></div>
            <div class="pv-summe">
              <div><span class="caption">Pipeline gesamt</span><b>${geld(pvGesamtVol)}</b></div>
              <div><span class="caption">gewichteter Forecast</span><b class="pv-gruen">${geld(pvGesamtGew)}</b></div>
              <div><span class="caption">offene Deals</span><b>${pvGesamtDeals}</b></div>
            </div></div>
          ${pvSortiert.map((a) => {
            const anteil = pvGesamtVol ? Math.round((a.volumen / pvGesamtVol) * 100) : 0;
            const quoteGew = a.volumen ? Math.round((a.gewichtet / a.volumen) * 100) : 0;
            return `<div class="sparte-zeile">
            <div class="sparte-kopf"><b>${e(a.name)}</b>
              <span class="caption">${a.anzahl} ${a.anzahl === 1 ? "Deal" : "Deals"} \u00b7 \u00d8 ${a.anzahl ? geld(a.volumen / a.anzahl) : "\u2014"} \u00b7 \u00d8 ${Math.round(a.alter)} Tage alt</span>
              <span class="sparte-wert">${geld(a.volumen)}<span class="sparte-anteil">${anteil} % der Pipeline</span></span></div>
            <div class="sparte-spur">
              <div class="sparte-balken" style="width:${Math.round((a.volumen / maxVol) * 100)}%"></div>
              <div class="sparte-balken gewichtet" style="width:${Math.round((a.gewichtet / maxVol) * 100)}%"></div>
            </div>
            <div class="sparte-fuss">
              <span class="caption">gewichtet <b class="pv-gruen">${geld(a.gewichtet)}</b> \u00b7 ${quoteGew} % vom Volumen${a.engpass ? ` \u00b7 gr\u00f6\u00dfter Topf \u201e${e(a.engpass.name)}\u201c ${geld(a.engpass.wert)}` : ""}</span>
              <a href="/crm/pipeline?sparte=${a.key}" class="caption pv-board">Board \u00f6ffnen \u2192</a></div></div>`;
          }).join("")}
          <div class="legende-flach">
            <span><i class="pkt gesamt"></i> Volumen gesamt</span><span><i class="pkt gewichtet"></i> gewichteter Forecast</span></div>
        </div>`;

      res.send(rahmen(u, "start", "Dashboard", "", reiter, ansichten[tab] || ansichten.uebersicht, sparte, dealHinweise));
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

      res.send(rahmenPipeline(u, sparte, art, reiter, `
        <div class="seiten-kopf">
          <div><p class="sub">${gesamt} offene Deals · ${geld(wert)} Gesamtwert</p></div>
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
              <div class="feld"><label>Erwarteter Abschluss</label><select name="erwartet_horizont">
                <option value="">unbekannt</option>
                <option value="30">Nächste 30 Tage</option>
                <option value="60">Nächste 60 Tage</option>
                <option value="90">Nächste 3 Monate</option>
                <option value="180">Nächste 6 Monate</option>
                <option value="365">Nächste 12 Monate</option></select></div>
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

  // Horizont-Auswahl (Nächste 30 Tage …) -> konkretes Datum (heute + N Tage),
  // damit die datumsbasierten Auswertungen unveraendert weiterrechnen koennen.
  const horizontZuDatum = (h) => {
    const tage = { "30": 30, "60": 60, "90": 90, "180": 180, "365": 365 }[String(h || "")];
    if (!tage) return null;
    const d = new Date(); d.setDate(d.getDate() + tage);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  app.post("/crm/deal/anlegen", async (req, res, next) => {
    try {
      await crm.dealAnlegen(req.nutzer, { ...req.body, wert: req.body.wert || null, erwartet_am: horizontZuDatum(req.body.erwartet_horizont) });
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

  // ================= TO-DOS =================
  const heuteISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  app.get("/crm/todos", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const [todos, firmen] = await Promise.all([crm.todoListe(u), crm.firmenListe(u, { limit: 300 })]);
      const heute = heuteISO();
      // Lokale Getter statt toISOString() — sonst rutscht das DATE-Feld in Zeitzonen
      // oestlich von UTC auf den Vortag (Gruppierung + Datums-Input wuerden falsch stehen).
      const lokalISO = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
      const offen = todos.filter((t) => !t.erledigt);
      const erledigt = todos.filter((t) => t.erledigt);
      const heuteGeplant = offen.filter((t) => t.geplant_am && lokalISO(t.geplant_am) === heute);
      const spaeter = offen.filter((t) => t.geplant_am && lokalISO(t.geplant_am) !== heute);
      const ohnePlan = offen.filter((t) => !t.geplant_am);

      const zeile = (t) => {
        const gepl = t.geplant_am ? lokalISO(t.geplant_am) : "";
        const faelligBadge = t.faellig
          ? `<span class="badge ${new Date(t.faellig) < new Date(heute) ? "b-rot" : "b-bernstein"}">bis ${datum(t.faellig)}</span>` : "";
        return `<div class="todo-zeile ${t.erledigt ? "todo-erledigt" : ""}">
          <form method="post" action="/crm/todo/erledigt" class="todo-check">
            <input type="hidden" name="id" value="${t.id}"><input type="hidden" name="erledigt" value="${t.erledigt ? "0" : "1"}">
            <button type="submit" class="todo-haken ${t.erledigt ? "an" : ""}" title="${t.erledigt ? "Wieder öffnen" : "Erledigt"}">${t.erledigt ? ICON.check : ""}</button>
          </form>
          <div class="todo-text">
            <div class="todo-titel">${e(t.titel)}</div>
            <div class="todo-meta">${t.firma_name ? `<a href="/crm/firma/${t.firma_id}">${ICON.kunden} ${e(t.firma_name)}</a>` : `<span class="caption">Allgemein</span>`} ${faelligBadge}</div>
          </div>
          <form method="post" action="/crm/todo/planen" class="todo-plan">
            <input type="hidden" name="id" value="${t.id}">
            <input type="date" name="geplant_am" value="${gepl}" onchange="this.form.submit()" title="Für welchen Tag einplanen">
          </form>
          <form method="post" action="/crm/todo/loeschen" onsubmit="return confirm('To-Do löschen?')">
            <input type="hidden" name="id" value="${t.id}">
            <button type="submit" class="still todo-weg" title="Löschen">${ICON.x}</button>
          </form>
        </div>`;
      };
      const block = (titel, liste, leer) => `<div class="karte" style="margin-bottom:16px">
        <div class="karte-kopf"><div><h2>${titel} ${liste.length ? `<span class="badge">${liste.length}</span>` : ""}</h2></div></div>
        ${liste.length ? liste.map(zeile).join("") : `<p class="caption">${leer}</p>`}</div>`;

      res.send(rahmen(u, "todos", "To-Dos", "Alle Aufgaben — kundengebunden oder allgemein. Weise sie einem Tag zu, dann erscheinen sie im Dashboard unter Heute zu tun.", "", `
        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div><h2>Neue Aufgabe</h2>
          <div class="sub">Freie Aufgabe (z. B. „TikTok erstellen") oder mit Kunde verknüpft</div></div></div>
          <form method="post" action="/crm/todo/anlegen">
            <div class="feld"><label>Aufgabe *</label><input name="titel" required placeholder="z. B. Angebot schicken · TikTok erstellen · Termin Steuerkanzlei" autofocus></div>
            <div class="feld-paar">
              <div class="feld"><label>Kunde (optional)</label><select name="firma_id">
                <option value="">— Allgemein, kein Kunde —</option>
                ${firmen.map((f) => `<option value="${f.id}">${e(f.name)}</option>`).join("")}</select></div>
              <div class="feld"><label>Fällig bis (optional)</label><input type="date" name="faellig"></div>
            </div>
            <div class="feld-paar">
              <div class="feld"><label>Geplant für (Tag)</label><input type="date" name="geplant_am" value="${heute}"></div>
              <div class="feld" style="display:flex;align-items:flex-end"><button type="submit" class="dunkel" style="width:100%;justify-content:center">${ICON.plus} Hinzufügen</button></div>
            </div>
          </form></div>
        ${block("Für heute geplant", heuteGeplant, "Nichts für heute eingeplant.")}
        ${block("Später geplant", spaeter, "Nichts für später geplant.")}
        ${block("Noch nicht eingeplant", ohnePlan, "Alles eingeplant. 🎉")}
        ${erledigt.length ? block("Erledigt", erledigt.slice(0, 20), "") : ""}`));
    } catch (err) { next(err); }
  });

  app.post("/crm/todo/anlegen", async (req, res, next) => {
    try { await crm.todoAnlegen(req.nutzer, req.body); res.redirect("/crm/todos"); } catch (err) { next(err); }
  });
  app.post("/crm/todo/planen", async (req, res, next) => {
    try { await crm.todoPlanen(req.nutzer, req.body.id, req.body.geplant_am || null); res.redirect("/crm/todos"); } catch (err) { next(err); }
  });
  app.post("/crm/todo/erledigt", async (req, res, next) => {
    try { await crm.todoErledigt(req.nutzer, req.body.id, req.body.erledigt === "1"); res.redirect("/crm/todos"); } catch (err) { next(err); }
  });
  app.post("/crm/todo/loeschen", async (req, res, next) => {
    try { await crm.todoLoeschen(req.nutzer, req.body.id); res.redirect("/crm/todos"); } catch (err) { next(err); }
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
        <td>${f.score ? `<span class="badge ${f.score >= 7 ? "b-gruen" : f.score >= 4 ? "b-bernstein" : "b-rot"}">${f.score * 10} %</span>` : "—"}</td>
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
          <thead><tr><th>Name</th><th>Status</th><th>Branche</th><th>Ort</th><th>Kauf-Chance</th><th>Temperatur</th><th>Quelle</th><th>Verantwortlich</th><th class="rechts">Deals</th></tr></thead>
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
            <div class="feld"><label>Kauf-Wahrscheinlichkeit (optional, später einstellbar)</label><select name="score">
              <option value="">— noch nicht eingeschätzt —</option>
              ${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}">${n}/10 · ${n * 10} % Kaufwahrscheinlichkeit</option>`).join("")}</select></div>
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
        <td>${f.score ? `<span class="badge ${f.score >= 7 ? "b-gruen" : f.score >= 4 ? "b-bernstein" : "b-rot"}">${f.score * 10} %</span>` : "—"}</td>
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
          <thead><tr><th>Firma</th><th>Telefon</th><th>Website</th><th>Kauf-Chance</th><th>Temperatur</th><th>Verantwortlich</th><th class="rechts">Wiedervorlage</th></tr></thead>
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
            ${f.score ? ` <span class="badge ${f.score >= 7 ? "b-gruen" : f.score >= 4 ? "b-bernstein" : "b-rot"}">${f.score * 10} % Kauf-Chance</span>` : ""}
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
            <div class="karte"><div class="karte-kopf"><div><h2>Kauf-Wahrscheinlichkeit</h2>
              <div class="sub">Wie wahrscheinlich wird daraus ein Kunde? Nach dem Erstgespräch einschätzen.</div></div></div>
              <form method="post" action="/crm/firma/${f.id}/score">
                <select name="score" onchange="this.form.submit()" style="width:100%">
                  <option value="" ${!f.score ? "selected" : ""}>— noch nicht eingeschätzt —</option>
                  ${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${Number(f.score) === n ? "selected" : ""}>${n}/10 · ${n * 10} % Kaufwahrscheinlichkeit</option>`).join("")}
                </select></form></div>
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
            <div class="feld-paar"><div class="feld"><label>Verantwortlich</label><select name="besitzer">
              ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === u.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
              <div class="feld"><label>Erwarteter Abschluss</label><select name="erwartet_horizont">
                <option value="">unbekannt</option>
                <option value="30">Nächste 30 Tage</option>
                <option value="60">Nächste 60 Tage</option>
                <option value="90">Nächste 3 Monate</option>
                <option value="180">Nächste 6 Monate</option>
                <option value="365">Nächste 12 Monate</option></select></div></div>
            <div class="dialog-fuss"><button type="button" class="sekundaer" onclick="document.getElementById('dealNeu').close()">Abbrechen</button>
              <button type="submit" class="dunkel">Deal anlegen</button></div></form></dialog>`));
    } catch (err) { next(err); }
  });

  app.post("/crm/firma/:id/notiz", async (req, res, next) => {
    try { await crm.notiz(req.nutzer, req.params.id, req.body.text); res.redirect(`/crm/firma/${req.params.id}`); } catch (e) { next(e); }
  });
  app.post("/crm/firma/:id/score", async (req, res, next) => {
    try { await crm.firmaAendern(req.nutzer, req.params.id, { score: req.body.score === "" ? null : Number(req.body.score) });
      res.redirect(`/crm/firma/${req.params.id}`); } catch (e) { next(e); }
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
            return `<tr onclick="location.href='/crm/team/${p.id}'" style="cursor:pointer"><td class="zeile-titel">${e(p.name)}</td>
              <td><span class="badge ${p.rolle === "admin" ? "b-blau" : ""}">${p.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter"}</span></td>
              <td class="rechts">${p.leads}</td><td class="rechts">${p.kunden}</td><td class="rechts">${p.offen}</td>
              <td class="rechts">${p.gewonnen ? `<span class="badge b-gruen">${p.gewonnen}</span>` : "—"}</td>
              <td class="rechts">${p.verloren || "—"}</td><td class="rechts">${q === null ? "—" : q + " %"}</td>
              <td class="rechts" style="font-weight:600">${geld(p.umsatz_monat)}</td>
              <td class="rechts">${p.anrufe_heute || "—"}</td></tr>`; }).join("")}</tbody></table></div>`));
    } catch (err) { next(err); }
  });

  const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const stdFmt = (sek) => { const h = Math.floor(sek / 3600), m = Math.round((sek % 3600) / 60);
    return h === 0 && m === 0 ? "0 Std" : `${h ? h + " Std" : ""}${h && m ? " " : ""}${m ? m + " Min" : ""}`; };

  app.get("/crm/team/:id", async (req, res, next) => {
    try {
      const u = req.nutzer;
      if (u.rolle !== "admin") return res.redirect("/crm");
      const alle = await crm.teamZahlen(u);
      const person = alle.find((p) => String(p.id) === req.params.id);
      if (!person) return res.redirect("/crm/team");
      const woche = await crm.zeitWoche(u, person.id);
      const maxSek = Math.max(1, ...woche.tage, woche.summe);

      res.send(rahmen(u, "team", person.name, person.rolle === "admin" ? "Geschäftsführung" : "Mitarbeiter", "", `
        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div><h2>Arbeitszeit diese Woche</h2>
          <div class="sub">Montag bis Sonntag, aus der Stoppuhr im Header</div></div></div>
          <div class="balken-block">
            ${woche.tage.map((sek, i) => `<div class="balken-saeule">
              <div class="balken" style="height:${Math.max(3, Math.round(sek / maxSek * 100))}%" title="${stdFmt(sek)}"></div>
              <span class="balken-label">${WOCHENTAGE[i].slice(0, 2)}</span></div>`).join("")}
            <div class="balken-saeule balken-summe">
              <div class="balken" style="height:${Math.max(3, Math.round(woche.summe / maxSek * 100))}%" title="${stdFmt(woche.summe)}"></div>
              <span class="balken-label">Summe</span></div>
          </div>
        </div>
        <div class="tabelle-huelle"><table class="tabelle">
          <thead><tr>${WOCHENTAGE.map((t) => `<th class="rechts">${t.slice(0, 2)}</th>`).join("")}<th class="rechts">Summe</th></tr></thead>
          <tbody><tr>${woche.tage.map((sek) => `<td class="rechts">${stdFmt(sek)}</td>`).join("")}
            <td class="rechts" style="font-weight:600">${stdFmt(woche.summe)}</td></tr></tbody>
        </table></div>
        <p style="margin-top:16px"><a href="/crm/team" class="caption">← Zurück zur Team-Leistung</a></p>`));
    } catch (err) { next(err); }
  });
};
