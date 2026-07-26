// Flowstate Marketing & Content — Seite und Routen.
// Eigenes Modul, damit der Eingriff in server.js (Lukas' Datei) bei zwei Zeilen bleibt.
//
// Die Seite folgt der Beschreibung des Bereichs, von oben nach unten:
//   1. Kacheln       Posts diese Woche gegen das Ziel, Werbeausgaben, Kosten je Lead
//   2. Redaktionsplan Was als Naechstes rausgeht — Ideen, Entwuerfe, Geplantes
//   3. Masse          Acht Wochen Ausstoss als Balken, dazu die Kanaele des Monats
//   4. Kampagnen      Bezahlte Werbung mit Ausgaben, Leads und Kosten je Lead
//   5. Funnel         Von der Quelle bis zum Kunden, aus den CRM-Daten gerechnet

const express = require("express");
const { schale } = require("./schale.js");
const mk = require("./marketing.js");

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
  warnung: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  senden: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  megafon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  trichter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4z"/></svg>',
  stift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  auge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
};

const STATUS_TON = { idee: "still", entwurf: "bernstein", geplant: "blau", veroeffentlicht: "gruen" };
// Die Datenbank speichert ohne Umlaute; angezeigt wird deutsch.
const KAMPAGNE_STATUS = {
  geplant: "geplant", laeuft: "läuft", pausiert: "pausiert", beendet: "beendet",
};

module.exports = function (app) {
  // Marketing sieht jeder im Team — anders als die Buchhaltung ist Content
  // Gemeinschaftsarbeit. Geprueft wird nur, dass jemand angemeldet ist.
  const angemeldet = (req, res, next) => {
    if (!req.session || !req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    next();
  };

  app.get("/marketing", angemeldet, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const nachWas = req.query.funnel === "branche" ? "branche" : "quelle";
      const [plan, raus, masse, kampagnen, funnel, einst] = await Promise.all([
        mk.redaktionsplan(u),
        mk.letzteVeroeffentlicht(u, 8),
        mk.massenZaehler(u),
        mk.kampagnen(u),
        mk.funnel(u, nachWas),
        mk.einstellungen(u),
      ]);

      // ---------- Kacheln ----------
      const laufende = kampagnen.filter((k) => k.status === "laeuft");
      const werbeAusgaben = kampagnen.reduce((a, k) => a + k.ausgaben, 0);
      const werbeLeads = kampagnen.reduce((a, k) => a + k.leads, 0);
      const kostenLead = werbeLeads > 0 ? werbeAusgaben / werbeLeads : null;
      const ziel = einst.posts_ziel_woche;
      const wocheIst = masse.summe.woche;
      const zielProzent = ziel > 0 ? Math.round((wocheIst / ziel) * 100) : 0;

      const kachel = (titel, wert, icon, ton, fuss) => `
        <div class="kachel ${ton}"><div class="kachel-kopf">
          <span class="kachel-titel">${e(titel)}</span><span class="kachel-icon">${icon}</span></div>
          <div class="kachel-zahl">${wert}</div>
          <div class="kachel-fuss">${fuss}</div></div>`;

      // ---------- Masse: acht Wochen als Balken ----------
      const hoechste = Math.max(ziel, ...masse.wochen.map((w) => w.anzahl), 1);
      const massenBalken = `<div class="mk-wochen">
        ${masse.wochen.map((w, i) => {
          const hoehe = Math.round((w.anzahl / hoechste) * 100);
          const zielHoehe = Math.round((ziel / hoechste) * 100);
          const letzte = i === masse.wochen.length - 1;
          // Zahl und Balken stehen gestapelt untereinander, beide ganz normal im
          // Fluss. Absolut positioniert war die Zahl vorher am Diagramm
          // ausgerichtet statt am Balken und landete bei leeren Wochen in der
          // Mitte. Gestapelt kann das nicht passieren: die Zahl sitzt immer
          // direkt auf ihrem Balken, auch wenn der null hoch ist.
          const balkenHoehe = Math.max(hoehe, w.anzahl ? 4 : 0);
          return `<div class="mk-woche">
            <div class="mk-saeule" title="${w.anzahl} Post${w.anzahl === 1 ? "" : "s"} in der Woche ab ${datumKurz(w.start)}">
              <span class="mk-ziellinie" style="bottom:${zielHoehe}%"></span>
              <span class="mk-wert${w.anzahl ? "" : " mk-wert-null"}">${w.anzahl}</span>
              <span class="mk-balken ${w.anzahl >= ziel ? "erreicht" : ""}${letzte ? " laufend" : ""}"
                style="height:${balkenHoehe}%"></span>
            </div>
            <span class="mk-woche-tag">${datumKurz(w.start)}</span></div>`;
        }).join("")}
      </div>
      <p class="caption mk-legende">Die Linie ist euer Wochenziel von ${ziel} Posts.
        Die letzte Säule ist die laufende Woche und darum noch nicht voll.</p>`;

      const kanalListe = masse.kanaele.length
        ? `<div class="mk-kanaele">${masse.kanaele.map((k) => {
            const anteil = masse.summe.monat > 0 ? Math.round((k.anzahl / masse.summe.monat) * 100) : 0;
            return `<div class="mk-kanal">
              <span class="mk-kanal-name">${e(k.kanal)}</span>
              <span class="mk-kanal-spur"><span style="width:${anteil}%"></span></span>
              <b>${k.anzahl}</b></div>`;
          }).join("")}</div>`
        : `<p class="caption">Diesen Monat ist noch nichts rausgegangen.</p>`;

      // ---------- Redaktionsplan ----------
      const planZeile = (p) => `<div class="mk-post ${p.ueberfaellig ? "spaet" : ""}">
        <div class="mk-post-kopf">
          <span class="badge b-${STATUS_TON[p.status] || "still"}">${e(mk.STATUS_LABEL[p.status])}</span>
          <span class="mk-post-titel">${e(p.titel)}
            <i>${e(p.kanal)}${p.format ? " · " + e(p.format) : ""}${p.zielgruppe ? " · " + e(p.zielgruppe) : ""}${p.wer ? " · " + e(p.wer.split(" ")[0]) : ""}</i></span>
          <span class="mk-post-tag ${p.ueberfaellig ? "spaet" : ""}">${p.geplant_am ? datumKurz(p.geplant_am) : "ohne Tag"}</span>
        </div>
        ${p.notiz ? `<p class="mk-post-notiz">${e(p.notiz)}</p>` : ""}
        <div class="mk-post-tat">
          ${p.status !== "veroeffentlicht" ? `
            <form method="post" action="/marketing/post/status">
              <input type="hidden" name="id" value="${p.id}">
              <input type="hidden" name="status" value="${p.status === "idee" ? "entwurf" : p.status === "entwurf" ? "geplant" : "veroeffentlicht"}">
              <button type="submit" class="${p.status === "geplant" ? "dunkel" : "sekundaer"} klein">
                ${p.status === "geplant" ? ICON.senden + " Ist raus" : "Weiter → " + (p.status === "idee" ? "Entwurf" : "Geplant")}</button>
            </form>` : ""}
          <form method="post" action="/marketing/post/loeschen"
            onsubmit="return confirm('Diesen Post wirklich streichen?')">
            <input type="hidden" name="id" value="${p.id}">
            <button type="submit" class="still klein" title="Streichen">${ICON.x}</button></form>
        </div>
      </div>`;

      const planBlock = plan.length
        ? `<div class="mk-posts">${plan.map(planZeile).join("")}</div>`
        : `<p class="caption">Nichts geplant. Leg oben einen Post an — der Plan ist gleichzeitig
           die Statistik von nächster Woche.</p>`;

      const rausBlock = raus.length
        ? `<div class="mk-raus">${raus.map((p) => `<div class="mk-raus-zeile">
            <span class="lz-punkt fertig"></span>
            <span class="mk-raus-titel">${p.link
              ? `<a href="${e(p.link)}" target="_blank" rel="noopener">${e(p.titel)} ↗</a>`
              : e(p.titel)}
              <i>${e(p.kanal)}${p.wer ? " · " + e(p.wer.split(" ")[0]) : ""}</i></span>
            <span class="mk-raus-tag">${datumKurz(p.veroeffentlicht_am)}</span></div>`).join("")}</div>`
        : `<p class="caption">Noch nichts veröffentlicht.</p>`;

      // ---------- Kampagnen ----------
      const kampagnenBlock = kampagnen.length
        ? `<div class="tabelle-huelle"><table class="tabelle">
            <thead><tr><th>Kampagne</th><th>Kanal</th><th>Zielgruppe</th>
              <th class="rechts">Ausgaben</th><th class="rechts">Leads</th>
              <th class="rechts">je Lead</th><th></th></tr></thead>
            <tbody>${kampagnen.map((k) => `<tr class="${k.status !== "laeuft" ? "matt" : ""}">
              <td class="zeile-titel">${e(k.name)}
                <i>${e(KAMPAGNE_STATUS[k.status] || k.status)}${k.start_am ? " · seit " + datumKurz(k.start_am) : ""}${
                  k.budget ? " · Budget " + geld(k.budget) : ""}</i></td>
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
           hier anlegen und monatlich die Zahlen eintragen.</p>`;

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

      // ---------- Dialoge ----------
      const auswahl = (name, werte, gewaehlt, leerText) => `<select name="${name}">
        ${leerText ? `<option value="">${e(leerText)}</option>` : ""}
        ${werte.map((w) => `<option ${w === gewaehlt ? "selected" : ""}>${e(w)}</option>`).join("")}</select>`;

      res.send(schale({
        titel: "Marketing & Content", unterzeile: "Redaktionsplan, Reichweite und Kampagnen",
        aktiv: "marketing", nutzer: u, suche: "Marketing durchsuchen …",
        inhalt: `
        ${masse.offen.ueberfaellig ? `<div class="hinweis warn" style="margin-bottom:16px">${ICON.warnung}<div>
          <strong>${masse.offen.ueberfaellig} Post${masse.offen.ueberfaellig === 1 ? " ist" : "s sind"} überfällig.</strong>
          Im Redaktionsplan rot markiert — entweder rausschicken oder das Datum verschieben.</div></div>` : ""}

        <div class="seiten-kopf">
          <div><p class="sub">Diese Woche ${wocheIst} von ${ziel} Posts</p></div>
          <div class="bh-tasten">
            <button type="button" class="sekundaer" onclick="document.getElementById('dlg-kampagne').showModal()">
              ${ICON.megafon} Kampagne</button>
            <button type="button" class="dunkel" onclick="document.getElementById('dlg-post').showModal()">
              ${ICON.plus} Post anlegen</button>
          </div>
        </div>

        <div class="kacheln">
          ${kachel("Posts diese Woche", `${wocheIst}<span class="kachel-von"> / ${ziel}</span>`,
            ICON.senden, wocheIst >= ziel ? "gruen" : zielProzent >= 60 ? "bernstein" : "rot",
            `<span class="caption">${zielProzent} % vom Wochenziel · <a href="#" onclick="document.getElementById('dlg-ziel').showModal();return false">Ziel ändern</a></span>`)}
          ${kachel("Posts diesen Monat", zahl(masse.summe.monat), ICON.megafon, "",
            `<span class="caption">${zahl(masse.summe.jahr)} im laufenden Jahr</span>`)}
          ${kachel("Werbeausgaben", geld(werbeAusgaben), ICON.euro || ICON.megafon, "",
            `<span class="caption">${laufende.length} laufende ${laufende.length === 1 ? "Kampagne" : "Kampagnen"}</span>`)}
          ${kachel("Kosten je Lead", kostenLead === null ? "–" : geldGenau(kostenLead), ICON.trichter,
            kostenLead !== null && kostenLead > 150 ? "rot" : kostenLead !== null ? "gruen" : "",
            `<span class="caption">${werbeLeads} Lead${werbeLeads === 1 ? "" : "s"} aus bezahlter Werbung</span>`)}
        </div>

        <div class="bh-reihe">
          <div class="karte"><div class="karte-kopf"><div>
            <h2>Redaktionsplan</h2>
            <div class="sub">Was als Nächstes rausgeht</div></div>
            <span class="badge">${masse.offen.ideen} Ideen · ${masse.offen.entwuerfe} Entwürfe · ${masse.offen.geplant} geplant</span></div>
            ${planBlock}
          </div>
          <div class="karte"><div class="karte-kopf"><div>
            <h2>Ausstoß</h2>
            <div class="sub">Acht Wochen — Masse schlägt Qualität</div></div></div>
            ${massenBalken}
            <div class="mk-trenner"></div>
            <h3 class="mk-unter">Kanäle diesen Monat</h3>
            ${kanalListe}
          </div>
        </div>

        <div class="karte" style="margin:16px 0"><div class="karte-kopf"><div>
          <h2>Zuletzt veröffentlicht</h2>
          <div class="sub">Die acht neuesten Beiträge</div></div></div>
          ${rausBlock}
        </div>

        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div>
          <h2>Kampagnen</h2>
          <div class="sub">Bezahlte Werbung — Zahlen monatlich aus dem Werbekonto eintragen</div></div>
          ${werbeAusgaben ? `<span class="badge">${geld(werbeAusgaben)} gesamt</span>` : ""}</div>
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

        <dialog id="dlg-post"><form method="post" action="/marketing/post/anlegen">
          <div class="todo-dlg-kopf"><div><h2>Post anlegen</h2>
            <div class="sub">Idee festhalten oder gleich einplanen</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="feld"><label>Thema *</label>
            <input name="titel" required placeholder="z. B. 3 Fehler auf Physio-Websites"></div>
          <div class="feld-paar">
            <div class="feld"><label>Kanal</label>${auswahl("kanal", mk.KANAELE, "Instagram")}</div>
            <div class="feld"><label>Format</label>${auswahl("format", mk.FORMATE, null, "— egal —")}</div>
          </div>
          <div class="feld-paar">
            <div class="feld"><label>Geplant für</label><input type="date" name="geplant_am" value="${heuteFeld()}"></div>
            <div class="feld"><label>Status</label><select name="status">
              <option value="idee">Idee</option><option value="entwurf">Entwurf</option>
              <option value="geplant">Geplant</option></select></div>
          </div>
          <div class="feld-paar">
            <div class="feld"><label>Zielgruppe</label>${auswahl("zielgruppe", mk.ZIELGRUPPEN, null, "— alle —")}</div>
            <div class="feld"><label>Sparte</label><select name="sparte">
              <option value="">— allgemein —</option>
              ${mk.SPARTEN.filter((s) => s !== "allgemein").map((s) =>
                `<option value="${s}">${e(mk.SPARTE_LABEL[s])}</option>`).join("")}</select></div>
          </div>
          <div class="feld"><label>Notiz</label><input name="notiz" placeholder="Aufhänger, Quelle, Idee …"></div>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.plus} Anlegen</button></div>
        </form></dialog>

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

        <dialog id="dlg-ziel"><form method="post" action="/marketing/ziel">
          <div class="todo-dlg-kopf"><div><h2>Wochenziel</h2>
            <div class="sub">Wie viele Posts sollen pro Woche rausgehen?</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="feld"><label>Posts je Woche</label>
            <input name="ziel" inputmode="numeric" value="${ziel}" required></div>
          <p class="caption" style="margin:-4px 0 12px">Die Linie im Ausstoß-Diagramm richtet sich danach.</p>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">Speichern</button></div>
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

  // ---------------------------------------------------------------- Routen

  const formular = express.urlencoded({ extended: true });

  app.post("/marketing/post/anlegen", angemeldet, formular, async (req, res, next) => {
    try {
      const r = await mk.postAnlegen(req.nutzer, req.body || {});
      res.redirect("/marketing" + (r.ok ? "" : "?fehler=" + encodeURIComponent(r.grund)));
    } catch (err) { next(err); }
  });

  app.post("/marketing/post/status", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      await mk.postStatus(req.nutzer, b.id, b.status, b.link);
      res.redirect("/marketing");
    } catch (err) { next(err); }
  });

  app.post("/marketing/post/loeschen", angemeldet, formular, async (req, res, next) => {
    try {
      await mk.postLoeschen(req.nutzer, (req.body || {}).id);
      res.redirect("/marketing");
    } catch (err) { next(err); }
  });

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

  app.post("/marketing/ziel", angemeldet, formular, async (req, res, next) => {
    try {
      await mk.zielSetzen(req.nutzer, (req.body || {}).ziel);
      res.redirect("/marketing");
    } catch (err) { next(err); }
  });
};
