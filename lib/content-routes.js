// Flowstate Content — Seite und Routen.
//
// Was wir selbst schreiben und posten. Bezahlte Werbung liegt daneben unter
// /marketing — bewusst getrennt: Content kostet Zeit, Marketing kostet Geld,
// und die beiden Zahlen gehoeren nicht in dieselbe Uebersicht.
//
// Die Seite von oben nach unten:
//   1. Kacheln        Posts diese Woche gegen das Ziel, Monat, Jahr, was liegen blieb
//   2. Redaktionsplan Was als Naechstes rausgeht — Ideen, Entwuerfe, Geplantes
//   3. Ausstoss       Acht Wochen als Balken, dazu die Kanaele des Monats
//   4. Veroeffentlicht Die letzten Beitraege

const express = require("express");
const { schale, eintragen } = require("./schale.js");
const ct = require("./content.js");

// Content bekommt einen eigenen Eintrag in der Navigation, direkt hinter
// Marketing. Ueber eintragen() statt durch Bearbeiten der MODULE-Liste in
// schale.js — so bleibt die gemeinsame Datei unberuehrt.
eintragen({
  id: "content", titel: "Content", icon: "kalender", href: "/content",
  nach: "marketing",
});

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const zahl = (n) => new Intl.NumberFormat("de-DE").format(Number(n) || 0);
const datumKurz = (d) => (d ? new Date(d).toLocaleDateString("de-DE",
  { day: "2-digit", month: "2-digit" }) : "–");
// Lokale Datumsfelder — nie toISOString(), das dreht oestlich von UTC auf den Vortag.
const datumFeld = (w) => {
  if (!w) return "";
  const d = new Date(w);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const heuteFeld = () => datumFeld(new Date());

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  warnung: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  senden: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  stapel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg>',
  uhr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  kalender: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
};

const STATUS_TON = { idee: "still", entwurf: "bernstein", geplant: "blau", veroeffentlicht: "gruen" };

module.exports = function (app) {
  // Content sieht das ganze Team — Schreiben und Posten ist Gemeinschaftsarbeit.
  const angemeldet = (req, res, next) => {
    if (!req.session || !req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    next();
  };

  app.get("/content", angemeldet, async (req, res, next) => {
    try {
      const u = req.nutzer;
      // Welche Marke ist gewaehlt? Leer = alle. Der Wert wird unten gegen die
      // echte Markenliste geprueft, damit aus der Adresszeile nichts anderes
      // durchrutscht.
      const marken = await ct.marken(u);
      const gewaehlt = marken.some((m) => m.id === req.query.marke) ? req.query.marke : null;
      // Zweite Ebene: der Kanal. Auch er wird gegen die feste Liste geprueft,
      // damit aus der Adresszeile nichts anderes durchrutscht.
      const kanal = ct.KANAELE.includes(req.query.kanal) ? req.query.kanal : null;

      const [plan, raus, masse, einst, jeMarke, jeKanal] = await Promise.all([
        ct.redaktionsplan(u, gewaehlt, kanal),
        ct.letzteVeroeffentlicht(u, 10, gewaehlt, kanal),
        ct.massenZaehler(u, gewaehlt, kanal),
        ct.einstellungen(u),
        ct.jeMarke(u),
        ct.jeKanal(u, gewaehlt),
      ]);
      const markeVon = (id) => marken.find((m) => m.id === id);
      const aktuelle = gewaehlt ? markeVon(gewaehlt) : null;
      // Die Adresse traegt beide Filter. Ein Wechsel der Marke behaelt den Kanal
      // und umgekehrt — sonst faellt man bei jedem Klick auf "alles" zurueck.
      const url = (m, k) => {
        const t = [];
        if (m) t.push("marke=" + encodeURIComponent(m));
        if (k) t.push("kanal=" + encodeURIComponent(k));
        return "/content" + (t.length ? "?" + t.join("&") : "");
      };
      const mUrl = (id) => url(id, kanal);

      // Das Wochenziel gilt JE MARKE. In der Gesamtansicht wird es darum mit der
      // Zahl der Marken hochgerechnet — sonst saehe "40 von 20" nach einer
      // Uebererfuellung aus, obwohl beide nur ihr Soll geschafft haben.
      const ziel = einst.posts_ziel_woche;
      const zielGesamt = gewaehlt ? ziel : ziel * Math.max(1, marken.length);
      const wocheIst = masse.summe.woche;
      const zielProzent = zielGesamt > 0 ? Math.round((wocheIst / zielGesamt) * 100) : 0;
      const inArbeit = masse.offen.ideen + masse.offen.entwuerfe + masse.offen.geplant;

      const kachel = (titel, wert, icon, ton, fuss) => `
        <div class="kachel ${ton}"><div class="kachel-kopf">
          <span class="kachel-titel">${e(titel)}</span><span class="kachel-icon">${icon}</span></div>
          <div class="kachel-zahl">${wert}</div>
          <div class="kachel-fuss">${fuss}</div></div>`;

      // ---------- Ausstoss: acht Wochen als Balken ----------
      const hoechste = Math.max(zielGesamt, ...masse.wochen.map((w) => w.anzahl), 1);
      const massenBalken = `<div class="mk-wochen">
        ${masse.wochen.map((w, i) => {
          const hoehe = Math.round((w.anzahl / hoechste) * 100);
          const zielHoehe = Math.round((zielGesamt / hoechste) * 100);
          const letzte = i === masse.wochen.length - 1;
          // Zahl und Balken stehen gestapelt im Fluss — absolut positioniert
          // richtete sich die Zahl am Diagramm aus statt am Balken.
          const balkenHoehe = Math.max(hoehe, w.anzahl ? 4 : 0);
          return `<div class="mk-woche">
            <div class="mk-saeule" title="${w.anzahl} Post${w.anzahl === 1 ? "" : "s"} in der Woche ab ${datumKurz(w.start)}">
              <span class="mk-ziellinie" style="bottom:${zielHoehe}%"></span>
              <span class="mk-wert${w.anzahl ? "" : " mk-wert-null"}">${w.anzahl}</span>
              <span class="mk-balken ${w.anzahl >= zielGesamt ? "erreicht" : ""}${letzte ? " laufend" : ""}"
                style="height:${balkenHoehe}%"></span>
            </div>
            <span class="mk-woche-tag">${datumKurz(w.start)}</span></div>`;
        }).join("")}
      </div>
      <p class="caption mk-legende">Die Linie ist euer Wochenziel von ${zielGesamt} Posts${gewaehlt ? "" : " (" + ziel + " je Marke)"}.
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
      const naechsterStatus = (s) => (s === "idee" ? "entwurf" : s === "entwurf" ? "geplant" : "veroeffentlicht");
      const planZeile = (p) => `<div class="mk-post ${p.ueberfaellig ? "spaet" : ""}">
        <div class="mk-post-kopf">
          <span class="badge b-${STATUS_TON[p.status] || "still"}">${e(ct.STATUS_LABEL[p.status])}</span>
          <span class="mk-post-titel">${e(p.titel)}
            <i>${!gewaehlt && p.marke_name ? `<b class="ct-marke-tag">${e(p.marke_name.split(" ")[0])}</b> · ` : ""}${kanal ? "" : e(p.kanal) + " · "}${p.format ? e(p.format) : ""}${p.zielgruppe ? " · " + e(p.zielgruppe) : ""}</i></span>
          <span class="mk-post-tag ${p.ueberfaellig ? "spaet" : ""}">${p.geplant_am ? datumKurz(p.geplant_am) : "ohne Tag"}</span>
        </div>
        ${p.notiz ? `<p class="mk-post-notiz">${e(p.notiz)}</p>` : ""}
        <div class="mk-post-tat">
          <form method="post" action="/content/post/status">
            <input type="hidden" name="id" value="${p.id}">
            <input type="hidden" name="status" value="${naechsterStatus(p.status)}">
            <button type="submit" class="${p.status === "geplant" ? "dunkel" : "sekundaer"} klein">
              ${p.status === "geplant" ? ICON.senden + " Ist raus" : "Weiter → " + (p.status === "idee" ? "Entwurf" : "Geplant")}</button>
          </form>
          <form method="post" action="/content/post/loeschen"
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
              <i>${!gewaehlt && p.marke_name ? `<b class="ct-marke-tag">${e(p.marke_name.split(" ")[0])}</b> · ` : ""}${e(p.kanal)}${p.format ? " · " + e(p.format) : ""}</i></span>
            <span class="mk-raus-tag">${datumKurz(p.veroeffentlicht_am)}</span></div>`).join("")}</div>`
        : `<p class="caption">Noch nichts veröffentlicht.</p>`;

      const auswahl = (name, werte, gewaehlt, leerText) => `<select name="${name}">
        ${leerText ? `<option value="">${e(leerText)}</option>` : ""}
        ${werte.map((w) => `<option ${w === gewaehlt ? "selected" : ""}>${e(w)}</option>`).join("")}</select>`;

      res.send(schale({
        titel: "Content", unterzeile: "Redaktionsplan und Ausstoß",
        aktiv: "content", nutzer: u, suche: "Content durchsuchen …",
        inhalt: `
        ${masse.offen.ueberfaellig ? `<div class="hinweis warn" style="margin-bottom:16px">${ICON.warnung}<div>
          <strong>${masse.offen.ueberfaellig} Post${masse.offen.ueberfaellig === 1 ? " ist" : "s sind"} überfällig.</strong>
          Im Redaktionsplan rot markiert — entweder rausschicken oder das Datum verschieben.</div></div>` : ""}

        <div class="seiten-kopf">
          <div><p class="sub">${aktuelle ? e(aktuelle.name) : "Alle Marken"}${kanal ? " · " + e(kanal) : ""} — diese Woche ${wocheIst} von ${zielGesamt} Posts</p></div>
          <div class="bh-tasten">
            <button type="button" class="dunkel" onclick="document.getElementById('dlg-post').showModal()">
              ${ICON.plus} Post anlegen</button>
          </div>
        </div>

        <!-- Umschalter zwischen den Personal-Brands. Er filtert die GANZE Seite,
             nicht nur eine Karte — zwei Redaktionsplaene nebeneinander waeren
             sonst ein unbrauchbarer Haufen. -->
        <nav class="ct-marken">
          <a href="${mUrl(null)}" class="${gewaehlt ? "" : "an"}">
            <span class="ct-marke-name">Alle</span>
            <span class="ct-marke-zahl">${jeMarke.reduce((a, x) => a + x.woche, 0)}/${ziel * marken.length} diese Woche</span></a>
          ${marken.map((m) => {
            const z = jeMarke.find((x) => x.id === m.id) || { woche: 0, in_arbeit: 0, ueberfaellig: 0 };
            return `<a href="${mUrl(m.id)}" class="${gewaehlt === m.id ? "an" : ""}">
              <span class="ct-marke-name">${e(m.name)}</span>
              <span class="ct-marke-zahl">${z.woche}/${ziel} diese Woche${
                z.ueberfaellig ? ` · <b class="spaet">${z.ueberfaellig} überfällig</b>` : ""}</span></a>`;
          }).join("")}
        </nav>

        <!-- Zweite Ebene: der Kanal, innerhalb der gewaehlten Marke. Die Zahl am
             Knopf ist die Zahl, die nach dem Klick auch dasteht — sie zaehlt
             darum immer nur innerhalb der aktuellen Marke. -->
        <nav class="ct-kanaele">
          <a href="${url(gewaehlt, null)}" class="${kanal ? "" : "an"}">Alle Kanäle</a>
          ${ct.KANAELE.map((k) => {
            const z = jeKanal[k] || { in_arbeit: 0, ueberfaellig: 0 };
            return `<a href="${url(gewaehlt, k)}" class="${kanal === k ? "an" : ""}"
              title="${z.in_arbeit} in Arbeit${z.ueberfaellig ? ", davon " + z.ueberfaellig + " überfällig" : ""}">
              ${e(k)}${z.in_arbeit ? `<span class="ct-kanal-zahl${z.ueberfaellig ? " spaet" : ""}">${z.in_arbeit}</span>` : ""}</a>`;
          }).join("")}
        </nav>

        <div class="kacheln">
          ${kachel("Diese Woche", `${wocheIst}<span class="kachel-von"> / ${zielGesamt}</span>`,
            ICON.senden, wocheIst >= zielGesamt ? "gruen" : zielProzent >= 60 ? "bernstein" : "rot",
            `<span class="caption">${zielProzent} % vom Wochenziel · <a href="#" onclick="document.getElementById('dlg-ziel').showModal();return false">Ziel ändern</a></span>`)}
          ${kachel("Diesen Monat", zahl(masse.summe.monat), ICON.kalender, "",
            `<span class="caption">${zahl(masse.summe.jahr)} im laufenden Jahr</span>`)}
          ${kachel("In Arbeit", zahl(inArbeit), ICON.stapel, "",
            `<span class="caption">${masse.offen.ideen} Ideen · ${masse.offen.entwuerfe} Entwürfe · ${masse.offen.geplant} geplant</span>`)}
          ${kachel("Überfällig", zahl(masse.offen.ueberfaellig), ICON.uhr,
            masse.offen.ueberfaellig ? "rot" : "gruen",
            `<span class="caption">${masse.offen.ueberfaellig ? "Termin verstrichen" : "alles im Plan"}</span>`)}
        </div>

        <div class="bh-reihe">
          <div class="karte"><div class="karte-kopf"><div>
            <h2>Redaktionsplan</h2>
            <div class="sub">Was als Nächstes rausgeht</div></div>
            <span class="badge">${inArbeit} in Arbeit</span></div>
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

        <div class="karte" style="margin-top:16px"><div class="karte-kopf"><div>
          <h2>Zuletzt veröffentlicht</h2>
          <div class="sub">Die zehn neuesten Beiträge</div></div></div>
          ${rausBlock}
        </div>

        <dialog id="dlg-post"><form method="post" action="/content/post/anlegen">
          <div class="todo-dlg-kopf"><div><h2>Post anlegen</h2>
            <div class="sub">Idee festhalten oder gleich einplanen</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="feld"><label>Marke — auf welchem Account?</label>
            <select name="marke" id="post-marke">
              ${marken.map((m) => `<option value="${m.id}" ${
                (gewaehlt || u.id) === m.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}
            </select></div>
          <div class="feld"><label>Thema *</label>
            <input name="titel" required placeholder="z. B. 3 Fehler auf Physio-Websites"></div>
          <div class="feld-paar">
            <div class="feld"><label>Kanal</label>
              <select name="kanal" id="post-kanal" onchange="formateSetzen()">
                ${ct.KANAELE.map((k) => `<option>${e(k)}</option>`).join("")}</select></div>
            <div class="feld"><label>Format</label>
              <select name="format" id="post-format"></select></div>
          </div>
          <div class="feld-paar">
            <div class="feld"><label>Geplant für</label><input type="date" name="geplant_am" value="${heuteFeld()}"></div>
            <div class="feld"><label>Status</label><select name="status">
              <option value="idee">Idee</option><option value="entwurf">Entwurf</option>
              <option value="geplant">Geplant</option></select></div>
          </div>
          <div class="feld-paar">
            <div class="feld"><label>Zielgruppe</label>${auswahl("zielgruppe", ct.ZIELGRUPPEN, null, "— alle —")}</div>
            <div class="feld"><label>Sparte</label><select name="sparte">
              <option value="">— allgemein —</option>
              ${ct.SPARTEN.filter((s) => s !== "allgemein").map((s) =>
                `<option value="${s}">${e(ct.SPARTE_LABEL[s])}</option>`).join("")}</select></div>
          </div>
          <div class="feld"><label>Notiz</label><input name="notiz" placeholder="Aufhänger, Quelle, Idee …"></div>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.plus} Anlegen</button></div>
        </form></dialog>

        <dialog id="dlg-ziel"><form method="post" action="/content/ziel">
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
        // Formate haengen am Kanal: ein Reel gibt es auf YouTube nicht, einen
        // Thread nur auf X. Die Liste wird darum beim Wechsel neu aufgebaut,
        // statt allen Kanaelen alles anzubieten.
        var FORMATE_JE_KANAL = ${JSON.stringify(ct.FORMATE_JE_KANAL)};
        function formateSetzen(){
          var kanal = document.getElementById("post-kanal").value;
          var feld  = document.getElementById("post-format");
          var alt   = feld.value;
          feld.innerHTML = "";
          (FORMATE_JE_KANAL[kanal] || []).forEach(function(f){
            var o = document.createElement("option");
            o.textContent = f;
            if (f === alt) o.selected = true;   // Auswahl behalten, wenn es sie hier auch gibt
            feld.appendChild(o);
          });
        }
        formateSetzen();
        </script>`,
      }) + "</body></html>");
    } catch (err) { next(err); }
  });

  const formular = express.urlencoded({ extended: true });

  app.post("/content/post/anlegen", angemeldet, formular, async (req, res, next) => {
    try {
      const r = await ct.postAnlegen(req.nutzer, req.body || {});
      res.redirect("/content" + (r.ok ? "" : "?fehler=" + encodeURIComponent(r.grund)));
    } catch (err) { next(err); }
  });

  app.post("/content/post/status", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      await ct.postStatus(req.nutzer, b.id, b.status, b.link);
      res.redirect("/content");
    } catch (err) { next(err); }
  });

  app.post("/content/post/loeschen", angemeldet, formular, async (req, res, next) => {
    try {
      await ct.postLoeschen(req.nutzer, (req.body || {}).id);
      res.redirect("/content");
    } catch (err) { next(err); }
  });

  app.post("/content/ziel", angemeldet, formular, async (req, res, next) => {
    try {
      await ct.zielSetzen(req.nutzer, (req.body || {}).ziel);
      res.redirect("/content");
    } catch (err) { next(err); }
  });
};
