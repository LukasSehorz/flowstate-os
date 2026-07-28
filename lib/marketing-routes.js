// Flowstate Marketing — Seite und Routen.
//
// Was wir an Reichweite EINKAUFEN: Meta Ads, Google Ads, LinkedIn Ads. Was wir
// selbst schreiben und posten, liegt daneben unter /content — bewusst getrennt:
// Marketing kostet Geld, Content kostet Zeit, und die beiden Zahlen gehoeren
// nicht in dieselbe Uebersicht.
//
// Die Seite von oben nach unten:
//   1. Kacheln    Werbeausgaben, Leads daraus, Kosten je Lead, laufende Kampagnen
//   2. Kampagnen  Mit Ausgaben, Leads und Kosten je Lead; Zahlen monatlich pflegen
//   3. Funnel     Vom Lead zum Kunden, gerechnet aus den CRM-Daten

const express = require("express");
const { schale, eintragen } = require("./schale.js");
const mk = require("./marketing.js");

// Der Eintrag hiess bisher "Marketing & Content". Seit Content einen eigenen
// Bereich hat, ist das nur noch Marketing. eintragen() ergaenzt einen
// vorhandenen Eintrag mit gleicher id — so bleibt schale.js unberuehrt.
// Icon bleibt "marketing" (das Megafon). "megafon" waere der Lautsprecher —
// den traegt schon "Sprache", und zwei gleiche Symbole in der Leiste sind
// schlechter als eines, das man kennt.
eintragen({
  id: "marketing", titel: "Marketing", icon: "marketing", href: "/marketing",
});

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const geld = (n) => new Intl.NumberFormat("de-DE",
  { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n) || 0);
const geldGenau = (n) => new Intl.NumberFormat("de-DE",
  { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(Number(n) || 0);
const zahl = (n) => new Intl.NumberFormat("de-DE").format(Number(n) || 0);
const datum = (d) => (d ? new Date(d).toLocaleDateString("de-DE",
  { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
const datumKurz = (d) => (d ? new Date(d).toLocaleDateString("de-DE",
  { day: "2-digit", month: "2-digit" }) : "–");
// Lokale Datumsfelder — nie toISOString(), das dreht oestlich von UTC auf den Vortag.
const datumFeld = (w) => {
  if (!w) return "";
  const d = new Date(w);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const heuteFeld = () => datumFeld(new Date());
const monatFeld = () => heuteFeld().slice(0, 7);

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  euro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 18a6 6 0 1 1 0-12M4 10h8M4 14h8"/></svg>',
  megafon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  trichter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4z"/></svg>',
  leute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
};

module.exports = function (app) {
  const angemeldet = (req, res, next) => {
    if (!req.session || !req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    next();
  };

  // Kennzahlen als JSON fuer die Marketing-Karte auf der Zentrale. Antwortet mit
  // einem Hinweis statt einem Redirect — eine nachladende Karte kann mit einer
  // Anmeldeseite nichts anfangen.
  app.get("/api/marketing/stats", async (req, res) => {
    const u = req.session && req.session.crm;
    if (!u) return res.json({ ok: false, anmeldung: true, hint: "Mit persönlichem Konto anmelden." });
    try {
      res.json({ ok: true, ...(await mk.kennzahlen(u)) });
    } catch (e) {
      console.error("Marketing-Kennzahlen:", e.message);
      res.json({ ok: false, hint: "Marketing-Daten nicht erreichbar." });
    }
  });

  app.get("/marketing", angemeldet, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const nachWas = req.query.funnel === "branche" ? "branche" : "quelle";
      const [kampagnen, funnel] = await Promise.all([
        mk.kampagnen(u),
        mk.funnel(u, nachWas),
      ]);

      const laufende = kampagnen.filter((k) => k.status === "laeuft");
      const ausgaben = kampagnen.reduce((a, k) => a + k.ausgaben, 0);
      const leads = kampagnen.reduce((a, k) => a + k.leads, 0);
      const kostenLead = leads > 0 ? ausgaben / leads : null;
      const budget = kampagnen.reduce((a, k) => a + (k.budget || 0), 0);

      const kachel = (titel, wert, icon, ton, fuss) => `
        <div class="kachel ${ton}"><div class="kachel-kopf">
          <span class="kachel-titel">${e(titel)}</span><span class="kachel-icon">${icon}</span></div>
          <div class="kachel-zahl">${wert}</div>
          <div class="kachel-fuss">${fuss}</div></div>`;

      // ---------- Kampagnen ----------
      const kampagnenBlock = kampagnen.length
        ? `<div class="tabelle-huelle"><table class="tabelle">
            <thead><tr><th>Kampagne</th><th>Kanal</th><th>Zielgruppe</th>
              <th class="rechts">Ausgaben</th><th class="rechts">Leads</th>
              <th class="rechts">je Lead</th><th></th></tr></thead>
            <tbody>${kampagnen.map((k) => `<tr class="${k.status !== "laeuft" ? "matt" : ""}">
              <td class="zeile-titel">${e(k.name)}
                <i>${e(mk.STATUS_LABEL[k.status] || k.status)}${k.start_am ? " · seit " + datumKurz(k.start_am) : ""}${
                  k.budget ? " · Budget " + geld(k.budget) : ""}${
                  k.monate ? " · " + k.monate + " Monat" + (k.monate === 1 ? "" : "e") + " erfasst" : " · noch keine Zahlen"}</i></td>
              <td>${e(k.kanal)}</td>
              <td>${e(k.zielgruppe || "–")}</td>
              <td class="rechts">${geld(k.ausgaben)}</td>
              <td class="rechts">${k.leads || "–"}</td>
              <td class="rechts ${k.kosten_lead !== null && k.kosten_lead > 150 ? "teuer" : ""}">${
                k.kosten_lead === null ? "–" : geldGenau(k.kosten_lead)}</td>
              <td class="rechts mk-kampagne-tat">
                <button type="button" class="sekundaer klein"
                  onclick="zahlenOeffnen(${k.id}, ${JSON.stringify(k.name).replace(/"/g, "&quot;")})">Zahlen</button>
                ${k.status === "laeuft" ? `<form method="post" action="/marketing/kampagne/status" style="display:inline">
                  <input type="hidden" name="id" value="${k.id}">
                  <input type="hidden" name="status" value="beendet">
                  <button type="submit" class="still klein" title="Beenden">${ICON.check}</button></form>` : ""}
              </td></tr>`).join("")}</tbody></table></div>`
        : `<p class="caption">Keine Kampagne erfasst. Sobald bei Meta oder Google etwas läuft,
           hier anlegen und monatlich die Zahlen aus dem Werbekonto eintragen.</p>`;

      // ---------- Funnel ----------
      const funnelMax = Math.max(...funnel.map((f) => f.leads), 1);
      const funnelBlock = funnel.length
        ? `<div class="mk-funnel">${funnel.map((f) => `<div class="mk-funnel-zeile">
            <div class="mk-funnel-kopf">
              <b>${e(f.gruppe)}</b>
              <span class="caption">${f.leads} Lead${f.leads === 1 ? "" : "s"} ·
                ${f.erstgespraeche} Erstgespräch${f.erstgespraeche === 1 ? "" : "e"} ·
                ${f.kunden} Kunde${f.kunden === 1 ? "" : "n"}${f.umsatz ? " · " + geld(f.umsatz) : ""}</span>
            </div>
            <div class="mk-funnel-spur" title="${f.leads} Leads → ${f.erstgespraeche} Erstgespräche → ${f.kunden} Kunden">
              <span class="mk-f-leads" style="width:${Math.round((f.leads / funnelMax) * 100)}%"></span>
              <span class="mk-f-eg"    style="width:${Math.round((f.erstgespraeche / funnelMax) * 100)}%"></span>
              <span class="mk-f-kunde" style="width:${Math.round((f.kunden / funnelMax) * 100)}%"></span>
            </div>
            <div class="mk-funnel-quoten">
              <span>zum Erstgespräch <b>${f.quote_eg === null ? "–" : f.quote_eg + " %"}</b></span>
              <span>zum Kunden <b>${f.quote_kunde === null ? "–" : f.quote_kunde + " %"}</b></span>
              <span>Gespräch → Kunde <b>${f.quote_eg_kunde === null ? "–" : f.quote_eg_kunde + " %"}</b></span>
            </div></div>`).join("")}</div>`
        : `<p class="caption">Noch keine Leads erfasst.</p>`;

      const auswahl = (name, werte, gewaehlt, leerText) => `<select name="${name}">
        ${leerText ? `<option value="">${e(leerText)}</option>` : ""}
        ${werte.map((w) => `<option ${w === gewaehlt ? "selected" : ""}>${e(w)}</option>`).join("")}</select>`;

      res.send(schale({
        titel: "Marketing", unterzeile: "Bezahlte Werbung und Funnel",
        aktiv: "marketing", nutzer: u, suche: "Marketing durchsuchen …",
        inhalt: `
        <div class="hinweis info" style="margin-bottom:16px">${ICON.info}<div>
          Hier steht nur, was Reichweite <b>kostet</b> — Meta, Google, LinkedIn.
          Was ihr selbst schreibt und postet, liegt unter
          <a href="/content">Content</a>.</div></div>

        <div class="seiten-kopf">
          <div><p class="sub">${laufende.length
            ? laufende.length + " laufende " + (laufende.length === 1 ? "Kampagne" : "Kampagnen")
            : "Keine laufende Kampagne"}</p></div>
          <div class="bh-tasten">
            <button type="button" class="dunkel" onclick="document.getElementById('dlg-kampagne').showModal()">
              ${ICON.plus} Kampagne anlegen</button>
          </div>
        </div>

        <div class="kacheln">
          ${kachel("Werbeausgaben", geld(ausgaben), ICON.euro, "",
            budget ? `<span class="caption">von ${geld(budget)} geplantem Budget</span>`
                   : `<span class="caption">über alle Kampagnen</span>`)}
          ${kachel("Leads daraus", zahl(leads), ICON.leute, "",
            `<span class="caption">aus bezahlter Werbung</span>`)}
          ${kachel("Kosten je Lead", kostenLead === null ? "–" : geldGenau(kostenLead), ICON.trichter,
            kostenLead !== null && kostenLead > 150 ? "rot" : kostenLead !== null ? "gruen" : "",
            `<span class="caption">${kostenLead === null ? "noch keine Zahlen eingetragen" : "Ausgaben ÷ Leads"}</span>`)}
          ${kachel("Kampagnen", zahl(kampagnen.length), ICON.megafon, "",
            `<span class="caption">${laufende.length} laufend · ${kampagnen.length - laufende.length} beendet oder pausiert</span>`)}
        </div>

        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div>
          <h2>Kampagnen</h2>
          <div class="sub">Zahlen monatlich aus dem Werbekonto eintragen</div></div>
          ${ausgaben ? `<span class="badge">${geld(ausgaben)} gesamt</span>` : ""}</div>
          ${kampagnenBlock}
        </div>

        <div class="karte"><div class="karte-kopf"><div>
          <h2>Funnel</h2>
          <div class="sub">Vom Lead zum Kunden — gerechnet aus den CRM-Daten, nicht doppelt gepflegt</div></div>
          <nav class="zeit-schalter" style="margin:0">
            <a href="/marketing?funnel=quelle" class="${nachWas === "quelle" ? "an" : ""}">nach Quelle</a>
            <a href="/marketing?funnel=branche" class="${nachWas === "branche" ? "an" : ""}">nach Branche</a>
          </nav></div>
          ${funnelBlock}
          <p class="caption mk-legende">${ICON.info}
            Der breite Balken sind alle Leads, der mittlere die mit Erstgespräch,
            der schmale die gewonnenen Kunden.</p>
        </div>

        <dialog id="dlg-kampagne"><form method="post" action="/marketing/kampagne/anlegen">
          <div class="todo-dlg-kopf"><div><h2>Kampagne anlegen</h2>
            <div class="sub">Bezahlte Werbung bei Meta, Google oder LinkedIn</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="feld"><label>Name *</label>
            <input name="name" required placeholder="z. B. Physio Traunstein — Leads Juli"></div>
          <div class="feld-paar">
            <div class="feld"><label>Kanal</label>${auswahl("kanal", mk.WERBEKANAELE, "Meta Ads")}</div>
            <div class="feld"><label>Zielgruppe</label>${auswahl("zielgruppe", mk.ZIELGRUPPEN, null, "— alle —")}</div>
          </div>
          <div class="feld-paar">
            <div class="feld"><label>Start</label><input type="date" name="start_am" value="${heuteFeld()}"></div>
            <div class="feld"><label>Budget gesamt (€)</label>
              <input name="budget" inputmode="decimal" placeholder="z. B. 1500"></div>
          </div>
          <div class="feld"><label>Sparte</label><select name="sparte">
            <option value="">— allgemein —</option>
            ${mk.SPARTEN.filter((s) => s !== "allgemein").map((s) =>
              `<option value="${s}">${e(mk.SPARTE_LABEL[s])}</option>`).join("")}</select></div>
          <div class="feld"><label>Notiz</label><input name="notiz" placeholder="Ziel, Angebot, Landingpage …"></div>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.plus} Anlegen</button></div>
        </form></dialog>

        <dialog id="dlg-zahlen"><form method="post" action="/marketing/kampagne/zahlen">
          <div class="todo-dlg-kopf"><div><h2>Zahlen eintragen</h2>
            <div class="sub" id="zahlen-name">—</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <input type="hidden" name="kampagne_id" id="zahlen-id">
          <div class="feld-paar">
            <div class="feld"><label>Monat</label><input type="month" name="monat" value="${monatFeld()}" required></div>
            <div class="feld"><label>Ausgaben (€)</label><input name="ausgaben" inputmode="decimal" placeholder="z. B. 480,50"></div>
          </div>
          <div class="feld-paar">
            <div class="feld"><label>Leads</label><input name="leads" inputmode="numeric" placeholder="z. B. 12"></div>
            <div class="feld"><label>Klicks</label><input name="klicks" inputmode="numeric" placeholder="optional"></div>
          </div>
          <div class="feld"><label>Impressionen</label><input name="impressionen" inputmode="numeric" placeholder="optional"></div>
          <p class="caption" style="margin:-4px 0 12px">Ein Monat, der schon eingetragen ist, wird
            überschrieben — Werbekonten korrigieren ihre Zahlen oft im Nachhinein.</p>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.check} Speichern</button></div>
        </form></dialog>

        <script>
        function zahlenOeffnen(id, name){
          document.getElementById("zahlen-id").value = id;
          document.getElementById("zahlen-name").textContent = name;
          document.getElementById("dlg-zahlen").showModal();
        }
        </script>`,
      }) + "</body></html>");
    } catch (err) { next(err); }
  });

  const formular = express.urlencoded({ extended: true });

  app.post("/marketing/kampagne/anlegen", angemeldet, formular, async (req, res, next) => {
    try {
      const r = await mk.kampagneAnlegen(req.nutzer, req.body || {});
      res.redirect("/marketing" + (r.ok ? "" : "?fehler=" + encodeURIComponent(r.grund)));
    } catch (err) { next(err); }
  });

  app.post("/marketing/kampagne/status", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      await mk.kampagneStatus(req.nutzer, b.id, b.status);
      res.redirect("/marketing");
    } catch (err) { next(err); }
  });

  app.post("/marketing/kampagne/zahlen", angemeldet, formular, async (req, res, next) => {
    try {
      const r = await mk.zahlenEintragen(req.nutzer, req.body || {});
      res.redirect("/marketing" + (r.ok ? "" : "?fehler=" + encodeURIComponent(r.grund)));
    } catch (err) { next(err); }
  });
};
