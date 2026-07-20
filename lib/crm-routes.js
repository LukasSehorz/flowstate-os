// Flowstate CRM — Oberflaeche. Wird in server.js unter /crm eingehaengt.
const crm = require("./crm.js");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const geld = (n) => (n == null ? "–" : Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }));
const datum = (d) => (d ? new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "–");
const zeit = (d) => (d ? new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

const SPARTEN = { webdesign: "Webdesign", performance: "Performance Marketing", ki: "KI" };
const NAV = [
  { id: "start", label: "Übersicht", icon: "◈", href: "/crm" },
  { id: "leads", label: "Leads", icon: "◎", href: "/crm/leads" },
  { id: "pipeline", label: "Pipeline", icon: "▤", href: "/crm/pipeline" },
  { id: "kunden", label: "Kunden", icon: "▣", href: "/crm/kunden" },
  { gruppe: "Auswertung" },
  { id: "team", label: "Team", icon: "⬡", href: "/crm/team", nurAdmin: true },
];

function seite(user, aktiv, titel, inhalt, extraKopf = "") {
  const nav = NAV.map((n) => {
    if (n.gruppe) return `<div class="nav-gruppe">${e(n.gruppe)}</div>`;
    if (n.nurAdmin && user.rolle !== "admin") return "";
    return `<a href="${n.href}" class="${n.id === aktiv ? "aktiv" : ""}"><span class="icon">${n.icon}</span>${e(n.label)}</a>`;
  }).join("");
  const initialen = user.name.split(" ").map((t) => t[0]).slice(0, 2).join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(titel)} · Flowstate CRM</title><link rel="stylesheet" href="/crm.css">${extraKopf}</head><body>
<div class="shell">
  <aside class="seitenleiste">
    <div class="marke-block"><div class="marke">flowstate<em>CRM</em></div><div class="marke-sub">Sehorz &amp; vom Hofe</div></div>
    <nav>${nav}</nav>
    <div class="leisten-fuss">
      <div class="nutzer-chip"><div class="avatar">${e(initialen)}</div>
        <div><div style="font-weight:600">${e(user.name)}</div><div class="rolle-tag">${e(user.rolle)}</div></div></div>
      <div style="margin-top:10px"><a href="/crm/abmelden" style="font-size:12.5px;color:var(--text-3)">Abmelden</a>
      · <a href="/" style="font-size:12.5px;color:var(--text-3)">OS</a></div>
    </div>
  </aside>
  <main>${inhalt}</main>
</div>
<script src="/lib/gsap.min.js"></script>
<script>
  // Dezente Choreografie: Karten und Zeilen gestaffelt einblenden
  if (window.gsap) {
    gsap.from(".kachel", { y: 10, opacity: 0, duration: .35, stagger: .04, ease: "power2.out" });
    gsap.from(".karte, .tabelle-huelle, .spalte", { y: 8, opacity: 0, duration: .3, stagger: .03, delay: .05, ease: "power2.out" });
    document.querySelectorAll(".kachel-zahl[data-zahl]").forEach((el) => {
      const ziel = parseFloat(el.dataset.zahl) || 0; const o = { v: 0 };
      gsap.to(o, { v: ziel, duration: .7, ease: "power2.out",
        onUpdate: () => { el.textContent = el.dataset.geld ? Math.round(o.v).toLocaleString("de-DE") + " €" : Math.round(o.v); } });
    });
  }
</script>
</body></html>`;
}

function anmeldeSeite(fehler) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anmelden · Flowstate CRM</title><link rel="stylesheet" href="/crm.css"></head><body class="login-seite">
<div class="login-karte">
  <div class="marke">flowstate<em>CRM</em></div>
  <div class="marke-sub">Sehorz &amp; vom Hofe GbR</div>
  <form method="post" action="/crm/anmelden">
    <div class="feld"><label>E-Mail</label><input type="email" name="email" autofocus required placeholder="vorname.name@flowstate-ai.net"></div>
    <div class="feld"><label>Passwort</label><input type="password" name="passwort" required></div>
    <button type="submit" style="width:100%;justify-content:center">Anmelden</button>
  </form>
  ${fehler ? `<p style="color:var(--rot);font-size:13px;margin-top:14px">E-Mail oder Passwort stimmt nicht.</p>` : ""}
</div></body></html>`;
}

module.exports = function (app) {
  // ---------- Anmeldung ----------
  app.get("/crm/anmelden", (req, res) => res.send(anmeldeSeite(req.query.fehler)));

  app.post("/crm/anmelden", async (req, res) => {
    try {
      const u = await crm.anmelden(req.body.email, req.body.passwort);
      if (!u) return res.redirect("/crm/anmelden?fehler=1");
      req.session.crm = u;
      res.redirect("/crm");
    } catch { res.redirect("/crm/anmelden?fehler=1"); }
  });

  app.get("/crm/abmelden", (req, res) => { delete req.session.crm; res.redirect("/crm/anmelden"); });

  // Wache: alles unter /crm braucht ein CRM-Konto
  app.use("/crm", (req, res, next) => {
    if (req.path.startsWith("/anmelden")) return next();
    if (!req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    next();
  });

  // ---------- Übersicht ----------
  app.get("/crm", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const [z, spalten] = await Promise.all([crm.kennzahlen(u), crm.dealsNachStufen(u, "webdesign")]);
      const team = u.rolle === "admin" ? await crm.teamZahlen(u) : [];
      const ziel = 30000, fortschritt = Math.min(100, Math.round((z.umsatz_monat / ziel) * 100));

      const teamBlock = u.rolle === "admin" ? `
        <div class="karte"><h2>Team diesen Monat</h2>
          <table class="tabelle" style="margin-top:8px">
            <thead><tr><th>Name</th><th class="rechts">Leads</th><th class="rechts">Offen</th><th class="rechts">Gewonnen</th><th class="rechts">Umsatz</th><th class="rechts">Anrufe heute</th></tr></thead>
            <tbody>${team.map((t) => `<tr><td class="zeile-titel">${e(t.name)} <span class="rolle-tag">${e(t.rolle)}</span></td>
              <td class="rechts">${t.leads}</td><td class="rechts">${t.offen}</td><td class="rechts">${t.gewonnen}</td>
              <td class="rechts">${geld(t.umsatz_monat)}</td><td class="rechts">${t.anrufe_heute}</td></tr>`).join("")}</tbody>
          </table></div>` : "";

      res.send(seite(u, "start", "Übersicht", `
        <div class="kopf"><div><h1>Guten Tag, ${e(u.name.split(" ")[0])}</h1>
          <p>${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p></div>
          <div style="display:flex;gap:8px"><a class="knopf sekundaer" href="/crm/leads">Leads</a><a class="knopf" href="/crm/pipeline">Pipeline öffnen</a></div>
        </div>
        <div class="kacheln">
          <div class="kachel"><div class="kachel-zahl" data-zahl="${z.leads}">0</div><div class="kachel-label">Offene Leads</div></div>
          <div class="kachel gruen"><div class="kachel-zahl" data-zahl="${z.kunden}">0</div><div class="kachel-label">Kunden</div></div>
          <div class="kachel"><div class="kachel-zahl" data-zahl="${z.offene_deals}">0</div><div class="kachel-label">Offene Deals</div></div>
          <div class="kachel bernstein"><div class="kachel-zahl" data-zahl="${z.pipeline_wert}" data-geld="1">0</div><div class="kachel-label">Pipeline-Wert</div></div>
          ${z.wiedervorlagen ? `<div class="kachel rot"><div class="kachel-zahl" data-zahl="${z.wiedervorlagen}">0</div><div class="kachel-label">Wiedervorlagen fällig</div></div>` : ""}
        </div>
        ${u.rolle === "admin" ? `<div class="karte" style="margin-bottom:16px">
          <h2>Umsatz Juli — Ziel 30.000 €</h2>
          <div style="display:flex;align-items:baseline;gap:12px;margin:8px 0 12px">
            <span style="font-family:'Plus Jakarta Sans';font-size:30px;font-weight:750">${geld(z.umsatz_monat)}</span>
            <span class="marke-tag ${fortschritt >= 100 ? "m-gruen" : "m-blau"}">${fortschritt} % erreicht</span></div>
          <div style="height:8px;background:var(--flaeche-2);border-radius:99px;overflow:hidden">
            <div id="balken" style="height:100%;width:0;background:var(--primaer);border-radius:99px"></div></div>
          <script>if(window.gsap)gsap.to("#balken",{width:"${fortschritt}%",duration:.9,delay:.2,ease:"power2.out"});</script>
        </div>` : ""}
        ${teamBlock}`));
    } catch (err) { next(err); }
  });

  // ---------- Leads ----------
  app.get("/crm/leads", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const { suche = "", status = "lead", temperatur = "" } = req.query;
      const [firmen, mitarbeiter] = await Promise.all([
        crm.firmenListe(u, { suche, status, temperatur }), crm.team(u),
      ]);
      const zeilen = firmen.map((f) => `
        <tr onclick="location.href='/crm/firma/${f.id}'" style="cursor:pointer">
          <td><div class="zeile-titel">${e(f.name)}</div><div class="zeile-sub">${e(f.ort || "")}${f.branche ? " · " + e(f.branche) : ""}</div></td>
          <td>${f.telefon ? `<a href="tel:${e(f.telefon)}" onclick="event.stopPropagation()">${e(f.telefon)}</a>` : "–"}</td>
          <td>${f.website ? `<a href="${e(f.website)}" target="_blank" onclick="event.stopPropagation()">Website ↗</a>` : `<span class="marke-tag m-gruen">keine ✨</span>`}</td>
          <td>${f.score ? `<span class="marke-tag ${f.score >= 9 ? "m-gruen" : f.score >= 7 ? "m-bernstein" : ""}">${f.score}/10</span>` : "–"}</td>
          <td><span class="marke-tag ${f.temperatur === "heiss" ? "m-rot" : f.temperatur === "kalt" ? "" : "m-bernstein"}"><span class="punkt"></span>${e(f.temperatur)}</span></td>
          <td>${e(f.besitzer_name || "–")}</td>
          <td class="rechts">${f.wiedervorlage ? `<span class="marke-tag ${new Date(f.wiedervorlage) <= new Date() ? "m-rot" : "m-blau"}">${datum(f.wiedervorlage)}</span>` : `<span class="zeile-sub">${datum(f.letzte_aktivitaet)}</span>`}</td>
        </tr>`).join("");

      res.send(seite(u, "leads", "Leads", `
        <div class="kopf"><div><h1>Leads</h1><p>${firmen.length} Einträge${status ? ` · Filter: ${e(status)}` : ""}</p></div>
          <button onclick="document.getElementById('neu').showModal()">+ Lead anlegen</button></div>
        <form class="werkzeuge" method="get">
          <input type="search" name="suche" placeholder="Suchen: Name, Ort, Telefon…" value="${e(suche)}">
          <select name="status"><option value="">alle Status</option>
            ${["lead", "kunde", "verloren", "ruht"].map((s) => `<option ${status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
          <select name="temperatur"><option value="">alle</option>
            ${["heiss", "warm", "kalt"].map((t) => `<option ${temperatur === t ? "selected" : ""}>${t}</option>`).join("")}</select>
          <button class="sekundaer" type="submit">Filtern</button>
        </form>
        ${firmen.length ? `<div class="tabelle-huelle"><table class="tabelle">
          <thead><tr><th>Firma</th><th>Telefon</th><th>Website</th><th>Score</th><th>Temperatur</th><th>Besitzer</th><th class="rechts">Wiedervorlage</th></tr></thead>
          <tbody>${zeilen}</tbody></table></div>`
        : `<div class="karte leer"><span class="leer-icon">◎</span><h3>Noch keine Leads</h3>
           <p>Leg den ersten an — oder übernimm die Ergebnisse aus der Lead-Maschine im OS-Dashboard.</p></div>`}

        <dialog id="neu" style="border:1px solid var(--linie);border-radius:var(--r-lg);padding:26px;max-width:520px;width:92vw;box-shadow:var(--schatten-3)">
          <h2 style="font-size:17px;color:var(--text);margin-bottom:16px">Neuer Lead</h2>
          <form method="post" action="/crm/leads/anlegen">
            <div class="feld"><label>Firma / Praxis *</label><input name="name" required autofocus></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="feld"><label>Telefon</label><input name="telefon"></div>
              <div class="feld"><label>Ort</label><input name="ort"></div>
            </div>
            <div class="feld"><label>Website</label><input name="website" placeholder="https://…"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="feld"><label>Branche</label><input name="branche" placeholder="Physiotherapie"></div>
              <div class="feld"><label>Besitzer</label><select name="besitzer">
                ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === u.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
              <button type="button" class="sekundaer" onclick="document.getElementById('neu').close()">Abbrechen</button>
              <button type="submit">Anlegen</button></div>
          </form></dialog>`));
    } catch (err) { next(err); }
  });

  app.post("/crm/leads/anlegen", async (req, res, next) => {
    try {
      const r = await crm.firmaAnlegen(req.nutzer, req.body);
      res.redirect(`/crm/firma/${r.id}${r.dublette ? "?dublette=" + r.dublette.id : ""}`);
    } catch (err) { next(err); }
  });

  // ---------- Pipeline (Kanban) ----------
  app.get("/crm/pipeline", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const sparte = SPARTEN[req.query.sparte] ? req.query.sparte : "webdesign";
      const art = req.query.art === "projekt" ? "projekt" : "vertrieb";
      const spalten = await crm.dealsNachStufen(u, sparte, art);
      const gesamt = spalten.reduce((n, s) => n + s.deals.length, 0);
      const wert = spalten.reduce((n, s) => n + s.deals.reduce((m, d) => m + Number(d.wert || 0), 0), 0);

      const reiterSparte = Object.entries(SPARTEN).map(([k, v]) =>
        `<a href="/crm/pipeline?sparte=${k}&art=${art}" class="${k === sparte ? "aktiv" : ""}">${e(v)}</a>`).join("");

      res.send(seite(u, "pipeline", "Pipeline", `
        <div class="kopf"><div><h1>Pipeline</h1><p>${gesamt} offene Deals · ${geld(wert)} Gesamtwert</p></div>
          <div class="reiter">
            <a href="/crm/pipeline?sparte=${sparte}&art=vertrieb" class="${art === "vertrieb" ? "aktiv" : ""}">Vertrieb</a>
            <a href="/crm/pipeline?sparte=${sparte}&art=projekt" class="${art === "projekt" ? "aktiv" : ""}">Projekte</a>
          </div></div>
        <div class="werkzeuge"><div class="reiter">${reiterSparte}</div></div>
        <div class="kanban sparte-${sparte}">
          ${spalten.map((s) => `
            <div class="spalte" data-stufe="${s.id}">
              <div class="spalte-kopf"><span class="spalte-titel">${e(s.name)}</span><span class="spalte-zahl">${s.deals.length}</span></div>
              <div class="spalte-karten">
                ${s.deals.map((d) => `
                  <div class="deal" draggable="true" data-id="${d.id}">
                    <div class="deal-titel">${e(d.firma_name)}</div>
                    <div class="zeile-sub">${e(d.titel)}</div>
                    <div class="deal-meta"><span>${e(d.besitzer_name || "")}</span>${d.wert ? `<span class="deal-wert">${geld(d.wert)}</span>` : ""}</div>
                  </div>`).join("")}
              </div>
            </div>`).join("")}
        </div>
        ${!gesamt ? `<div class="karte leer" style="margin-top:16px"><span class="leer-icon">▤</span><h3>Keine offenen Deals in ${e(SPARTEN[sparte])}</h3>
          <p>Öffne einen Lead und lege dort einen Deal an — er erscheint dann hier in der ersten Stufe.</p></div>` : ""}
        <script>
          let gezogen = null;
          document.querySelectorAll(".deal").forEach((k) => {
            k.addEventListener("dragstart", () => { gezogen = k; k.classList.add("zieht"); });
            k.addEventListener("dragend", () => { k.classList.remove("zieht"); document.querySelectorAll(".spalte").forEach(s=>s.classList.remove("ziel")); });
          });
          document.querySelectorAll(".spalte").forEach((sp) => {
            sp.addEventListener("dragover", (ev) => { ev.preventDefault(); sp.classList.add("ziel"); });
            sp.addEventListener("dragleave", () => sp.classList.remove("ziel"));
            sp.addEventListener("drop", async (ev) => {
              ev.preventDefault(); sp.classList.remove("ziel");
              if (!gezogen) return;
              sp.querySelector(".spalte-karten").appendChild(gezogen);
              if (window.gsap) gsap.fromTo(gezogen, { scale: .96 }, { scale: 1, duration: .25, ease: "back.out(2)" });
              const r = await fetch("/crm/deal/verschieben", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deal: gezogen.dataset.id, stufe: sp.dataset.stufe }) }).then(r=>r.json());
              if (r.gewonnen) location.reload();
            });
          });
        </script>`));
    } catch (err) { next(err); }
  });

  app.post("/crm/deal/verschieben", async (req, res) => {
    try {
      await crm.dealVerschieben(req.nutzer, req.body.deal, req.body.stufe);
      const st = (await crm.stufen(req.nutzer)).find((s) => String(s.id) === String(req.body.stufe));
      res.json({ ok: true, gewonnen: !!st?.ist_abschluss });
    } catch (e) { res.json({ ok: false, fehler: e.message }); }
  });

  // ---------- Firma / Kundenordner ----------
  app.get("/crm/firma/:id", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const f = await crm.firma(u, req.params.id);
      if (!f) return res.status(404).send(seite(u, "leads", "Nicht gefunden", `<div class="karte leer"><h3>Nicht gefunden</h3><p>Dieser Eintrag existiert nicht oder gehört jemand anderem.</p></div>`));
      const mitarbeiter = await crm.team(u);

      res.send(seite(u, f.status === "kunde" ? "kunden" : "leads", f.name, `
        <div class="kopf">
          <div><h1>${e(f.name)}</h1>
            <p><span class="marke-tag ${f.status === "kunde" ? "m-gruen" : f.status === "verloren" ? "m-rot" : "m-blau"}">${e(f.status)}</span>
            ${f.score ? `<span class="marke-tag ${f.score >= 9 ? "m-gruen" : "m-bernstein"}">Score ${f.score}/10</span>` : ""}
            ${f.ort ? " · " + e(f.ort) : ""}${f.branche ? " · " + e(f.branche) : ""}</p></div>
          <div style="display:flex;gap:8px">
            ${f.telefon ? `<a class="knopf sekundaer" href="tel:${e(f.telefon)}">📞 Anrufen</a>` : ""}
            <button onclick="document.getElementById('dealNeu').showModal()">+ Deal</button></div>
        </div>
        ${req.query.dublette ? `<div class="hinweis warn" style="margin-bottom:16px">⚠️ Achtung: Es gibt bereits einen ähnlichen Eintrag — <a href="/crm/firma/${e(req.query.dublette)}">hier ansehen</a>. Prüfe, ob das eine Dublette ist.</div>` : ""}

        <div class="zwei-spalten">
          <div>
            ${f.stand ? `<div class="karte"><h2>Stand</h2><p style="margin-top:6px">${e(f.stand)}</p></div>` : ""}
            <div class="karte"><h2>Deals</h2>
              ${f.deals.length ? `<table class="tabelle" style="margin-top:8px"><tbody>${f.deals.map((d) => `
                <tr><td class="zeile-titel">${e(d.titel)}<div class="zeile-sub">${e(SPARTEN[d.sparte] || d.sparte)}</div></td>
                <td><span class="marke-tag ${d.status === "gewonnen" ? "m-gruen" : d.status === "verloren" ? "m-rot" : "m-blau"}">${e(d.stufe_name || d.status)}</span></td>
                <td class="rechts">${geld(d.wert)}</td></tr>`).join("")}</tbody></table>`
              : `<p class="zeile-sub" style="margin-top:6px">Noch kein Deal. Leg oben einen an, dann erscheint er in der Pipeline.</p>`}
            </div>
            ${f.projekte.length ? `<div class="karte"><h2>Projekte</h2><table class="tabelle" style="margin-top:8px"><tbody>
              ${f.projekte.map((p) => `<tr><td class="zeile-titel">${e(p.titel)}</td><td><span class="marke-tag m-blau">${e(p.stufe_name || p.status)}</span></td></tr>`).join("")}
            </tbody></table></div>` : ""}
            <div class="karte"><h2>Verlauf</h2>
              <div class="feed" style="margin-top:8px">${f.historie.map((h) => `
                <div class="feed-eintrag"><div class="feed-punkt"></div>
                  <div><div class="feed-text">${e(h.text)}</div><div class="feed-zeit">${zeit(h.zeit)}${h.wer_name ? " · " + e(h.wer_name) : ""}</div></div></div>`).join("")}
              </div>
              <form method="post" action="/crm/firma/${f.id}/notiz" style="display:flex;gap:8px;margin-top:14px">
                <input name="text" placeholder="Notiz hinzufügen…" required><button type="submit">Speichern</button></form>
            </div>
          </div>
          <div>
            <div class="karte"><h2>Stammdaten</h2>
              <dl class="def" style="margin-top:10px">
                <dt>Telefon</dt><dd>${f.telefon ? `<a href="tel:${e(f.telefon)}">${e(f.telefon)}</a>` : "–"}</dd>
                <dt>E-Mail</dt><dd>${f.email ? `<a href="mailto:${e(f.email)}">${e(f.email)}</a>` : "–"}</dd>
                <dt>Website</dt><dd>${f.website ? `<a href="${e(f.website)}" target="_blank">öffnen ↗</a>` : `<span class="marke-tag m-gruen">keine ✨</span>`}</dd>
                <dt>Quelle</dt><dd>${e(f.quelle || "–")}</dd>
                <dt>Besitzer</dt><dd>${e(f.besitzer_name || "–")}</dd>
                <dt>Versuche</dt><dd>${f.versuche || 0}</dd>
                <dt>Angelegt</dt><dd>${datum(f.erstellt)}</dd>
              </dl>
              ${f.argumente?.length ? `<h2 style="margin-top:16px">Verkaufsargumente</h2>
                <ul style="margin:8px 0 0 16px;font-size:13.5px;color:var(--text-2)">${f.argumente.map((a) => `<li style="margin-bottom:4px">${e(a)}</li>`).join("")}</ul>` : ""}
            </div>
            <div class="karte"><h2>Anruf-Ergebnis</h2>
              <form method="post" action="/crm/firma/${f.id}/call" style="display:grid;gap:8px;margin-top:10px">
                <button name="ausgang" value="termin" style="background:var(--gruen)">✓ Erstgespräch gebucht</button>
                <button name="ausgang" value="nicht-erreicht" class="sekundaer">↻ Nicht erreicht</button>
                <button name="ausgang" value="spaeter" class="sekundaer">🕐 Später anrufen</button>
                <input type="date" name="datum" title="Datum für Wiedervorlage">
                <button name="ausgang" value="absage" class="sekundaer" style="color:var(--rot)">✕ Absage</button>
                <input name="grund" placeholder="Grund bei Absage (Pflicht)">
              </form>
            </div>
          </div>
        </div>

        <dialog id="dealNeu" style="border:1px solid var(--linie);border-radius:var(--r-lg);padding:26px;max-width:480px;width:92vw;box-shadow:var(--schatten-3)">
          <h2 style="font-size:17px;color:var(--text);margin-bottom:16px">Neuer Deal</h2>
          <form method="post" action="/crm/firma/${f.id}/deal">
            <div class="feld"><label>Titel *</label><input name="titel" required value="${e(f.name)} — " autofocus></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="feld"><label>Sparte</label><select name="sparte">
                ${Object.entries(SPARTEN).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join("")}</select></div>
              <div class="feld"><label>Wert (€)</label><input name="wert" type="number" step="1"></div>
            </div>
            <div class="feld"><label>Besitzer</label><select name="besitzer">
              ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === u.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button type="button" class="sekundaer" onclick="document.getElementById('dealNeu').close()">Abbrechen</button>
              <button type="submit">Anlegen</button></div>
          </form></dialog>`));
    } catch (err) { next(err); }
  });

  app.post("/crm/firma/:id/notiz", async (req, res, next) => {
    try { await crm.notiz(req.nutzer, req.params.id, req.body.text); res.redirect(`/crm/firma/${req.params.id}`); } catch (e) { next(e); }
  });

  app.post("/crm/firma/:id/deal", async (req, res, next) => {
    try {
      await crm.dealAnlegen(req.nutzer, { ...req.body, firma_id: req.params.id, wert: req.body.wert || null });
      res.redirect(`/crm/pipeline?sparte=${req.body.sparte}`);
    } catch (e) { next(e); }
  });

  app.post("/crm/firma/:id/call", async (req, res, next) => {
    try {
      await crm.callErgebnis(req.nutzer, req.params.id, req.body.ausgang, { grund: req.body.grund, datum: req.body.datum || null });
      res.redirect(`/crm/firma/${req.params.id}`);
    } catch (e) { next(e); }
  });

  // ---------- Kunden ----------
  app.get("/crm/kunden", async (req, res, next) => {
    try {
      const u = req.nutzer;
      const kunden = await crm.firmenListe(u, { status: "kunde" });
      res.send(seite(u, "kunden", "Kunden", `
        <div class="kopf"><div><h1>Kunden</h1><p>${kunden.length} aktive Kunden</p></div></div>
        ${kunden.length ? `<div class="tabelle-huelle"><table class="tabelle">
          <thead><tr><th>Firma</th><th>Kunde seit</th><th>Offene Deals</th><th>Besitzer</th><th class="rechts">Letzte Aktivität</th></tr></thead>
          <tbody>${kunden.map((k) => `<tr onclick="location.href='/crm/firma/${k.id}'" style="cursor:pointer">
            <td><div class="zeile-titel">${e(k.name)}</div><div class="zeile-sub">${e(k.ort || "")}</div></td>
            <td>${datum(k.kunde_seit)}</td><td>${k.offene_deals || 0}</td><td>${e(k.besitzer_name || "–")}</td>
            <td class="rechts zeile-sub">${datum(k.letzte_aktivitaet)}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="karte leer"><span class="leer-icon">▣</span><h3>Noch keine Kunden</h3>
           <p>Sobald ein Deal die Stufe „Gewonnen" erreicht, wird die Firma automatisch zum Kunden — inklusive Projekt.</p></div>`}`));
    } catch (err) { next(err); }
  });

  // ---------- Team (nur Admin) ----------
  app.get("/crm/team", async (req, res, next) => {
    try {
      const u = req.nutzer;
      if (u.rolle !== "admin") return res.redirect("/crm");
      const t = await crm.teamZahlen(u);
      res.send(seite(u, "team", "Team", `
        <div class="kopf"><div><h1>Team</h1><p>Leistung im laufenden Monat</p></div></div>
        <div class="tabelle-huelle"><table class="tabelle">
          <thead><tr><th>Name</th><th>Rolle</th><th class="rechts">Leads</th><th class="rechts">Kunden</th>
            <th class="rechts">Offen</th><th class="rechts">Gewonnen</th><th class="rechts">Verloren</th>
            <th class="rechts">Quote</th><th class="rechts">Umsatz Monat</th><th class="rechts">Anrufe heute</th></tr></thead>
          <tbody>${t.map((p) => {
            const q = p.gewonnen + p.verloren > 0 ? Math.round((p.gewonnen / (p.gewonnen + p.verloren)) * 100) : null;
            return `<tr><td class="zeile-titel">${e(p.name)}</td><td><span class="marke-tag ${p.rolle === "admin" ? "m-blau" : ""}">${e(p.rolle)}</span></td>
              <td class="rechts">${p.leads}</td><td class="rechts">${p.kunden}</td><td class="rechts">${p.offen}</td>
              <td class="rechts">${p.gewonnen}</td><td class="rechts">${p.verloren}</td>
              <td class="rechts">${q === null ? "–" : q + " %"}</td><td class="rechts">${geld(p.umsatz_monat)}</td>
              <td class="rechts">${p.anrufe_heute}</td></tr>`;
          }).join("")}</tbody></table></div>`));
    } catch (err) { next(err); }
  });
};
