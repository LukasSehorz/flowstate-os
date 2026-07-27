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
const ideen = require("./content-ideen.js");

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

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  warnung: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  senden: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  stapel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg>',
  uhr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pfeilLinks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
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
      // Sortierung des Upload-Kastens. Gegen die feste Liste geprueft, damit aus
      // der Adresszeile nichts anderes durchrutscht.
      const sort = ct.SORTIERUNGEN.some((x) => x.id === req.query.sort) ? req.query.sort : "neu";

      const [masse, einst, jeMarke, jeKanal, zieleKanal,
             uploads, summen, offeneMess, offeneIdeen, jaIdeen, staende] = await Promise.all([
        ct.massenZaehler(u, gewaehlt, kanal),
        ct.einstellungen(u),
        ct.jeMarke(u),
        ct.jeKanal(u, gewaehlt),
        ct.zieleVonMarke(u, gewaehlt),
        ct.uploads(u, gewaehlt, kanal, 7, sort),
        ct.summen(u, gewaehlt, kanal),
        ct.offeneMessungen(u, gewaehlt),
        ideen.ideen(u, { marke: gewaehlt, status: "vorschlag" }),
        ideen.ideen(u, { marke: gewaehlt, status: "angenommen" }),
        ct.kanalstand(u, gewaehlt, kanal),
      ]);
      const markeVon = (id) => marken.find((m) => m.id === id);
      const aktuelle = gewaehlt ? markeVon(gewaehlt) : null;
      // Wochenziel einer Marke = Summe ihrer Kanalziele (im gewaehlten Kanal
      // nur dessen). "—" wenn fuer sie noch nichts festgelegt ist; eine 0 waere
      // etwas anderes und saehe nach erfuelltem Soll aus.
      const zielVonMarke = (id) => {
        const eigene = alleZiele.filter((z) => z.marke === id && (!kanal || z.kanal === kanal));
        return eigene.length ? eigene.reduce((a, z) => a + Number(z.ziel), 0) : "—";
      };
      // Die Adresse traegt beide Filter. Ein Wechsel der Marke behaelt den Kanal
      // und umgekehrt — sonst faellt man bei jedem Klick auf "alles" zurueck.
      const url = (m, k, so = sort) => {
        const t = [];
        if (m) t.push("marke=" + encodeURIComponent(m));
        if (k) t.push("kanal=" + encodeURIComponent(k));
        // "neu" ist die Vorgabe und muss nicht in der Adresse stehen.
        if (so && so !== "neu") t.push("sort=" + encodeURIComponent(so));
        return "/content" + (t.length ? "?" + t.join("&") : "");
      };
      const mUrl = (id) => url(id, kanal);

      // Die Ziele stehen je Marke UND Kanal. Was gerade gilt, haengt davon ab,
      // wie eng gefiltert ist — und die Summe muss zur gezaehlten Groesse passen:
      // gezaehlt werden Platzierungen (ein Kurzvideo auf drei Kanaelen = drei),
      // also wird auch ueber die Kanalziele summiert.
      const alleZiele = await ct.ziele(u, null);
      const zielGesamt = alleZiele
        .filter((z) => (!gewaehlt || z.marke === gewaehlt) && (!kanal || z.kanal === kanal))
        .reduce((a, z) => a + Number(z.ziel), 0);
      const ziel = einst.posts_ziel_woche; // Rueckfallwert, wenn nichts festgelegt ist
      const wocheIst = masse.summe.woche;
      const zielProzent = zielGesamt > 0 ? Math.round((wocheIst / zielGesamt) * 100) : 0;
      // Alles, was noch nicht draussen ist — also die ganze Produktionstafel.
      const inArbeit = masse.offen.gesamt;

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
      <p class="caption mk-legende">Die Linie ist das Wochenziel von ${zielGesamt} Platzierungen.
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
      // Der Redaktionsplan (planZeile/naechsterStatus) stand hier bis 26.07.
      // Er ist zur Produktionstafel in der Ideenwerkstatt geworden — dort sind
      // die Stufen sichtbar und die Kaertchen verschiebbar. Die alte Zeile mit
      // ihrem "Weiter ->"-Knopf kannte nur idee/entwurf/geplant und haette nach
      // Migration 0035 in die falsche Stufe geschoben.

      // Der Kasten "Zuletzt veroeffentlicht" stand hier bis 27.07. Er ist jetzt
      // eine SORTIERUNG des Upload-Kastens. Zwei Listen derselben Beitraege
      // nebeneinander waren doppelte Arbeit beim Lesen — und sie widersprachen
      // sich: die eine zeigte 10 Stueck, die andere 7 Tage.

      // ---------- Uploads der letzten 7 Tage ----------
      // Eine Zeile je Video UND Kanal: dasselbe Kurzvideo laeuft auf drei
      // Kanaelen und hat dort drei verschiedene Zahlen. Sie in einer Zeile zu
      // mitteln waere die unbrauchbarste aller Darstellungen.
      const uploadBlock = uploads.length
        ? `<div class="ct-uploads">${uploads.map((up) => `
            <a class="ct-upload ${up.ohne_zahlen ? "leerzahl" : ""}" href="/content/post/${up.id}">
              <div class="ct-upload-kopf">
                <span class="ct-upload-titel">${e(up.titel)}</span>
                <span class="ct-upload-kanal">${e(up.kanal)}</span>
              </div>
              <div class="ct-upload-zeile">
                <span class="ct-upload-tag">${datumKurz(up.veroeffentlicht_am)}${
                  up.sorte ? " · " + e(up.sorte) : ""}${
                  !gewaehlt && up.marke_name ? " · " + e(up.marke_name.split(" ")[0]) : ""}</span>
                ${up.ohne_zahlen
                  ? `<span class="ct-upload-fehlt">Zahlen fehlen →</span>`
                  : `<span class="ct-upload-zahlen">
                      <b>${zahl(up.views ?? 0)}</b> Views ·
                      ${zahl(up.likes ?? 0)} Likes ·
                      ${zahl(up.kommentare ?? 0)} Komm.
                      <i>${e(ct.MESSPUNKTE.find((m) => m.id === up.messpunkt)?.titel || up.messpunkt)}</i>
                    </span>`}
                ${up.leistung === null ? "" : `<span class="ct-leistung ${
                  up.leistung > 0 ? "auf" : up.leistung < 0 ? "ab" : "gleich"}"
                  title="Views gegenüber dem Ø der anderen Videos auf ${e(up.kanal)} nach 24 Stunden">${
                  up.leistung > 0 ? "+" : ""}${up.leistung} %<i>24 h</i></span>`}
              </div></a>`).join("")}</div>`
        : `<p class="caption">In den letzten sieben Tagen ist nichts rausgegangen${
            kanal ? " auf " + e(kanal) : ""}.</p>`;

      // ---------- Woche und Monat ----------
      // Gerechnet auf dem spaetesten Messpunkt je Video und Kanal — sonst zaehlte
      // ein Video, das nach 24 Stunden UND nach 7 Tagen gemessen wurde, doppelt.
      const summenZeile = (k) => {
        const w = summen.woche[k.id], m = summen.monat[k.id], g = summen.gesamt[k.id];
        if (!w && !m && !g) return "";
        return `<tr><td>${e(k.titel)}</td>
          <td class="rechts"><b>${zahl(w)}</b></td>
          <td class="rechts">${zahl(m)}</td>
          <td class="rechts ct-spalte-schnitt">${zahl(g)}</td></tr>`;
      };
      const summenZeilen = ct.KENNZAHLEN.filter((k) => k.art === "ganz").map(summenZeile).join("");
      const summenBlock = summenZeilen
        ? `<div class="tabelle-huelle"><table class="tabelle ct-summen">
            <thead><tr><th></th><th class="rechts">Diese Woche</th><th class="rechts">Dieser Monat</th>
              <th class="rechts ct-spalte-schnitt">Insgesamt</th></tr></thead>
            <tbody>
              <tr class="ct-summen-kopf"><td>Videos</td>
                <td class="rechts"><b>${zahl(summen.stuecke_woche)}</b></td>
                <td class="rechts">${zahl(summen.stuecke_monat)}</td>
                <td class="rechts ct-spalte-schnitt">${zahl(summen.stuecke_gesamt)}</td></tr>
              ${summenZeilen}
            </tbody></table></div>
          <p class="caption mk-legende">${ICON.info}<span>
            Gezählt wird je Video und Kanal die jeweils neueste Messung — ein Video,
            das nach 24 Stunden und nach 7 Tagen gemessen wurde, zählt einmal.
            <strong>„Insgesamt" ist die Summe unserer erfassten Videos</strong> — nicht
            der Stand des Kanals. Ältere Videos und alles vor unserer Erfassung fehlen
            darin; der echte Kanalstand steht im Kasten darunter.</span></p>`
        : `<p class="caption">Noch keine Zahlen erfasst. Trag sie über den Kasten links ein —
           auf ein Video klicken, dann öffnet sich die Analyse.</p>`;

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
            <span class="ct-marke-zahl">${jeMarke.reduce((a, x) => a + x.woche, 0)}/${alleZiele.reduce((a,z)=>a+Number(z.ziel),0)} diese Woche</span></a>
          ${marken.map((m) => {
            const z = jeMarke.find((x) => x.id === m.id) || { woche: 0, in_arbeit: 0, ueberfaellig: 0 };
            return `<a href="${mUrl(m.id)}" class="${gewaehlt === m.id ? "an" : ""}">
              <span class="ct-marke-name">${e(m.name)}</span>
              <span class="ct-marke-zahl">${z.woche}/${zielVonMarke(m.id)} diese Woche${
                z.ueberfaellig ? ` · <b class="spaet">${z.ueberfaellig} überfällig</b>` : ""}</span></a>`;
          }).join("")}
        </nav>

        <!-- Zweite Ebene: der Kanal, innerhalb der gewaehlten Marke. Die Zahl am
             Knopf ist die Zahl, die nach dem Klick auch dasteht — sie zaehlt
             darum immer nur innerhalb der aktuellen Marke. -->
        <nav class="ct-kanaele">
          <a href="${url(gewaehlt, null)}" class="${kanal ? "" : "an"}">Alle Kanäle</a>
          ${ct.KANAELE.map((k) => {
            const z = jeKanal[k] || { woche: 0, in_arbeit: 0, ueberfaellig: 0 };
            // Das Wochenziel steht nur, wenn eine Marke gewaehlt ist — die Ziele
            // sind je Marke verschieden, "8/14" waere ueber beide zusammen falsch.
            const ziel = gewaehlt ? zieleKanal[k] : undefined;
            return `<a href="${url(gewaehlt, k)}" class="${kanal === k ? "an" : ""}"
              title="${ziel !== undefined ? `Diese Woche ${z.woche} von ${ziel}. ` : ""}${z.in_arbeit} in Arbeit${z.ueberfaellig ? ", davon " + z.ueberfaellig + " überfällig" : ""}">
              ${e(k)}${ziel !== undefined
                ? `<span class="ct-kanal-zahl${z.woche >= ziel ? " voll" : ""}">${z.woche}/${ziel}</span>`
                : z.in_arbeit ? `<span class="ct-kanal-zahl${z.ueberfaellig ? " spaet" : ""}">${z.in_arbeit}</span>` : ""}</a>`;
          }).join("")}
          ${gewaehlt ? `<a href="#" class="ct-ziel-knopf"
            onclick="document.getElementById('dlg-ziel').showModal();return false">Ziele ändern</a>` : ""}
        </nav>

        <!-- Vier Zahlen, EIN Kasten. Als vier einzelne Karten beanspruchten sie
             eine ganze Bildschirmhoehe fuer vier Ziffern — und weil jede Karte
             gleich schwer wirkte, stach die wichtigste (das Wochenziel) nicht
             heraus. Hier tragen die Trennlinien die Gliederung. -->
        <div class="karte ct-leiste">
          <div class="ct-leiste-feld ct-leiste-haupt${
            wocheIst >= zielGesamt ? " voll" : zielProzent >= 60 ? " mittel" : " knapp"}">
            <span class="ct-leiste-titel">Posts diese Woche</span>
            <div class="ct-leiste-zahl">${wocheIst}<span>/ ${zielGesamt}</span></div>
            <span class="caption">${zielProzent} % vom Wochenziel${gewaehlt
              ? ` · <a href="#" onclick="document.getElementById('dlg-ziel').showModal();return false">Ziele ändern</a>`
              : ""}</span>
          </div>
          <div class="ct-leiste-feld">
            <span class="ct-leiste-titel">In Arbeit</span>
            <div class="ct-leiste-zahl">${zahl(inArbeit)}</div>
            <span class="caption">${masse.offen.aufnehmen} aufnehmen · ${masse.offen.schneiden} schneiden · ${masse.offen.hochladen} hochladen · ${masse.offen.geplant} geplant</span>
          </div>
          <div class="ct-leiste-feld">
            <span class="ct-leiste-titel">Diesen Monat</span>
            <div class="ct-leiste-zahl">${zahl(masse.summe.monat)}</div>
            <span class="caption">${zahl(masse.summe.jahr)} im laufenden Jahr</span>
          </div>
          <div class="ct-leiste-feld${masse.offen.ueberfaellig ? " warnt" : ""}">
            <span class="ct-leiste-titel">Überfällig</span>
            <div class="ct-leiste-zahl">${zahl(masse.offen.ueberfaellig)}</div>
            <span class="caption">${masse.offen.ueberfaellig ? "Termin verstrichen" : "alles im Plan"}</span>
          </div>
        </div>

        <a class="karte id-band" href="/content/ideen${gewaehlt ? "?marke=" + encodeURIComponent(gewaehlt) : ""}">
          <div class="id-band-zahl">${offeneIdeen.length}</div>
          <div class="id-band-text">
            <strong>${offeneIdeen.length === 1 ? "Eine Idee wartet" : "Ideen warten"} auf deine Entscheidung</strong>
            <span class="caption">${offeneIdeen.length
              ? "Haken oder X — beim Haken wird das Skript geschrieben."
              : "Nichts offen. In der Werkstatt neue holen — dort liegt auch die Produktionstafel."}${
              jaIdeen.length ? ` · ${jaIdeen.length} angenommen${
                jaIdeen.filter((i) => !i.post_id).length
                  ? ", " + jaIdeen.filter((i) => !i.post_id).length + " noch nicht im Plan" : ""}` : ""}</span>
          </div>
          <span class="id-band-pfeil">Zur Ideenwerkstatt →</span>
        </a>

        <!-- Der Redaktionsplan stand hier bis 26.07. Er ist zur Produktionstafel
             in der Ideenwerkstatt geworden: dort sind die Stufen sichtbar
             (aufnehmen, schneiden, hochladen) und die Kaertchen verschiebbar.
             Zwei Listen fuer dieselbe Sache waeren zwei Wahrheiten. -->
        <div class="karte">
          <div class="karte-kopf"><div>
            <h2>Ausstoß</h2>
            <div class="sub">Acht Wochen — Masse schlägt Qualität</div></div></div>
          ${massenBalken}
          <div class="mk-trenner"></div>
          <h3 class="mk-unter">Kanäle diesen Monat</h3>
          ${kanalListe}
        </div>

        <div class="bh-reihe" style="margin-top:16px">
          <div class="karte"><div class="karte-kopf"><div>
            <h2>Uploads der letzten 7 Tage</h2>
            <div class="sub">${kanal ? e(kanal) + " — " : ""}auf den Namen klicken für die volle Analyse</div></div>
            ${offeneMess.length ? `<span class="badge b-bernstein">${offeneMess.length} Messung${
              offeneMess.length === 1 ? "" : "en"} offen</span>` : ""}</div>
            <nav class="ct-sortieren">${ct.SORTIERUNGEN.map((so) =>
              `<a href="${e(url(gewaehlt, kanal, so.id))}" class="${
                so.id === sort ? "aktiv" : ""}">${e(so.titel)}</a>`).join("")}</nav>
            ${uploadBlock}
            <p class="caption ct-sort-fuss">${ICON.info}<span>„Performer" heißt nicht
              die meisten Views, sondern den Abstand zum Durchschnitt der anderen Videos
              <strong>auf demselben Kanal, jeweils 24 Stunden nach Veröffentlichung</strong>. Nach roher
              Zahl stünde sonst immer TikTok oben und ein sechs Tage altes Video über einem
              von heute Morgen. Ohne mindestens drei Vergleichsvideos steht kein Wert da.</span></p>
          </div>
          <div class="karte"><div class="karte-kopf"><div>
            <h2>Woche und Monat</h2>
            <div class="sub">Summen über alle Videos${kanal ? " auf " + e(kanal) : ""}</div></div></div>
            ${summenBlock}
          </div>
        </div>

        <!-- DER KANALSTAND. Bewusst getrennt von den Summen darueber: das eine
             ist, was unsere erfassten Videos gebracht haben, das andere der
             Stand des Kanals inklusive allem davor. Beide in eine Tabelle zu
             schreiben hiesse, zwei verschiedene Zahlen als dieselbe auszugeben. -->
        <div class="karte" style="margin-top:16px"><div class="karte-kopf"><div>
          <h2>Kanalstand</h2>
          <div class="sub">Abonnenten und Gesamtzahlen der Kanäle — von Hand eingetragen</div></div>
          <button type="button" class="sekundaer klein" onclick="document.getElementById('dlg-stand').showModal()">Stand eintragen</button></div>
          ${staende.length ? `<div class="ks-raster">${staende.map((st) => {
            const w = (jetzt, vorher) => {
              if (jetzt === null || vorher === null || jetzt === undefined || vorher === undefined) return "";
              const d = Number(jetzt) - Number(vorher);
              if (!d) return `<i class="ks-gleich">±0</i>`;
              return `<i class="ks-delta ${d > 0 ? "auf" : "ab"}">${d > 0 ? "+" : ""}${zahl(d)}</i>`;
            };
            const zeile = (titel, jetzt, vorher) => jetzt === null || jetzt === undefined ? "" :
              `<div class="ks-zeile"><span>${titel}</span>
                 <b>${zahl(jetzt)}</b>${w(jetzt, vorher)}</div>`;
            return `<div class="ks-kanal">
              <div class="ks-kopf"><strong>${e(st.kanal)}</strong>
                <span class="caption">Stand ${datumKurz(st.gemessen_am)}${
                  st.vor_am ? " · davor " + datumKurz(st.vor_am) : ""}</span></div>
              ${zeile("Abonnenten", st.abonnenten, st.vor_abonnenten)}
              ${zeile("Aufrufe gesamt", st.views_gesamt, st.vor_views)}
              ${zeile("Likes gesamt", st.likes_gesamt, st.vor_likes)}
              ${st.videos_gesamt !== null && st.videos_gesamt !== undefined
                ? `<div class="ks-zeile"><span>Videos auf dem Kanal</span><b>${zahl(st.videos_gesamt)}</b></div>` : ""}
              ${st.notiz ? `<p class="caption">${e(st.notiz)}</p>` : ""}
            </div>`;
          }).join("")}</div>` : `<p class="caption">Noch kein Stand eingetragen.</p>`}
          <p class="caption mk-legende">${ICON.info}<span>Diese Zahlen weiß nur die
            Plattform selbst — sie lassen sich nicht aus unseren Videos errechnen.
            Einmal die Woche in die Creator-Ansicht schauen und abtippen: zwei Minuten,
            und die Zahl stimmt. Sobald ein freigegebener Plattformzugang steht, holt
            das System sie selbst; bis dahin ist das der verlässliche Weg.</span></p>
        </div>

        <dialog id="dlg-stand"><form method="post" action="/content/kanalstand">
          <div class="todo-dlg-kopf"><div><h2>Kanalstand eintragen</h2>
            <div class="sub">Aus der Creator-Ansicht des Kanals abtippen</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <input type="hidden" name="marke" value="${e(gewaehlt || u.id)}">
          <div class="feld-paar">
            <div class="feld"><label>Kanal</label>
              <select name="kanal">${ct.KANAELE.map((k) =>
                `<option ${k === kanal ? "selected" : ""}>${e(k)}</option>`).join("")}</select></div>
            <div class="feld"><label>Stand vom</label>
              <input type="date" name="gemessen_am" value="${heuteFeld()}"></div>
          </div>
          <div class="feld-paar">
            <div class="feld"><label>Abonnenten</label>
              <input name="abonnenten" inputmode="numeric" placeholder="z. B. 4210"></div>
            <div class="feld"><label>Aufrufe gesamt</label>
              <input name="views_gesamt" inputmode="numeric" placeholder="z. B. 478500"></div>
          </div>
          <div class="feld-paar">
            <div class="feld"><label>Likes gesamt</label>
              <input name="likes_gesamt" inputmode="numeric" placeholder="optional"></div>
            <div class="feld"><label>Videos auf dem Kanal</label>
              <input name="videos_gesamt" inputmode="numeric" placeholder="optional"></div>
          </div>
          <div class="feld"><label>Notiz</label>
            <input name="notiz" placeholder="Auffälligkeiten?"></div>
          <p class="caption" style="margin:-4px 0 12px">Leere Felder bleiben leer. Ein schon
            eingetragener Tag wird überschrieben — zweimal am selben Tag heißt korrigiert,
            nicht zweimal gewachsen.</p>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.check} Speichern</button></div>
        </form></dialog>

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
          <div class="feld"><label>Sorte</label>
            <select name="sorte" id="post-sorte" onchange="kanaeleVorschlagen()">
              ${ct.SORTEN.map((s) => `<option>${e(s.titel)}</option>`).join("")}</select></div>
          <div class="feld"><label>Kanäle — wo erscheint es?</label>
            <div class="ct-kanalwahl" id="post-kanaele">
              ${ct.KANAELE.map((k) => `<label class="ct-kanalwahl-feld">
                <input type="checkbox" name="kanaele" value="${e(k)}"${
                  kanal === k ? " checked" : ""}> <span>${e(k)}</span></label>`).join("")}
            </div>
            <p class="caption" style="margin-top:6px">Ein Kurzvideo läuft auf allen drei
              Videokanälen — einmal eintragen genügt, es zählt bei jedem mit.</p></div>
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

        ${gewaehlt ? `<dialog id="dlg-ziel"><form method="post" action="/content/ziele">
          <div class="todo-dlg-kopf"><div><h2>Wochenziele</h2>
            <div class="sub">${e(aktuelle.name)} — wie viele Beiträge je Kanal pro Woche?</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <input type="hidden" name="marke" value="${gewaehlt}">
          <div class="feld-paar">
            ${ct.KANAELE.map((k) => `<div class="feld"><label>${e(k)}</label>
              <input name="ziel_${e(k)}" inputmode="numeric"
                value="${zieleKanal[k] === undefined ? "" : zieleKanal[k]}" placeholder="—"></div>`).join("")}
          </div>
          <p class="caption" style="margin:-4px 0 12px">Leer lassen heißt „noch nicht festgelegt" —
            das ist etwas anderes als eine 0. Ein Kurzvideo, das auf drei Kanälen läuft,
            zählt bei jedem der drei mit.</p>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">Speichern</button></div>
        </form></dialog>` : ""}

        <script>
        // Jede Sorte bringt einen Kanalvorschlag mit: ein Kurzvideo laeuft auf
        // TikTok, YouTube und Instagram, ein Langvideo nur auf YouTube. Der
        // Vorschlag setzt die Haken, ueberschreiben kann man ihn jederzeit.
        var SORTEN = ${JSON.stringify(ct.SORTEN)};
        function kanaeleVorschlagen(){
          var titel = document.getElementById("post-sorte").value;
          var sorte = SORTEN.filter(function(s){ return s.titel === titel; })[0];
          if (!sorte) return;
          document.querySelectorAll('#post-kanaele input[name="kanaele"]').forEach(function(k){
            k.checked = sorte.kanaele.indexOf(k.value) >= 0;
          });
        }
        kanaeleVorschlagen();
        </script>`,
      }) + "</body></html>");
    } catch (err) { next(err); }
  });

  // ------------------------------------------------- Analyse eines Videos
  //
  // Eine Seite je Stueck Content. Oben die Akte (was war drin, wie lang, wo
  // laeuft es), darunter je Kanal eine Tabelle: Zeilen sind die Kennzahlen,
  // Spalten die Messzeitpunkte, ganz rechts der Durchschnitt der anderen Videos.
  //
  // Die eigentliche Leistung der Seite ist die EINORDNUNG. "12,4 Sekunden
  // durchschnittlich gesehen" sagt fuer sich genommen nichts — erst neben
  // "die anderen 9 TikToks kamen auf 9,1" wird daraus eine Aussage.
  //
  // Zwei Regeln, damit der Vergleich nicht luegt:
  //
  //   1. Gleicher Messzeitpunkt gegen gleichen Messzeitpunkt. Ein halbes Jahr
  //      altes Video hat selbstverstaendlich mehr Views als ein gestriges.
  //      Verglichen wird "nach 24 Stunden" gegen "nach 24 Stunden" — sonst
  //      misst man das Alter und nennt es Leistung.
  //   2. Erst ab drei Vergleichsvideos (ct.VERGLEICH_MINDESTENS). Bei einem
  //      oder zweien ist "+40 %" kein Befund, sondern Zufall. Dann steht der
  //      nackte Wert da und daneben nichts.
  //
  // Es wird der Mittelwert genommen, nicht der Median — so hat Jannik es
  // gewuenscht. Der Preis steht offen auf der Seite: bei wenigen Videos zieht
  // ein einzelner Ausreisser den Schnitt spuerbar mit.

  // Sekunden lesbar machen: 47 -> "0:47 min", 95 -> "1:35 min".
  const dauer = (sek) => {
    const n = Number(sek);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n / 60) + ":" + String(Math.round(n % 60)).padStart(2, "0") + " min";
  };

  app.get("/content/post/:id", angemeldet, async (req, res, next) => {
    try {
      const u = req.nutzer;
      if (!/^\d+$/.test(req.params.id)) return res.status(400).send("Ungültige Kennung");
      const p = await ct.post(u, req.params.id);
      if (!p) return res.status(404).send("Dieses Video gibt es nicht.");
      const vgl = await ct.vergleiche(u, p.marke, p.id);

      const linkVon = (kanal) => (p.links.find((l) => l.kanal === kanal) || {}).url || "";
      const zahlVon = (kanal, mp) => p.zahlen.find((z) => z.kanal === kanal && z.messpunkt === mp);
      const wert = (z, k) => {
        if (!z || z[k.id] === null || z[k.id] === undefined) return null;
        return Number(z[k.id]);
      };
      const formatiere = (v, art) => (v === null ? `<span class="ct-leer">–</span>`
        : art === "komma"
          ? v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 })
          : zahl(v));

      // Der Vergleichsanteil: um wie viel liegt dieses Video ueber oder unter
      // dem Schnitt der anderen? Alle zehn Kennzahlen sind "mehr ist besser",
      // darum ist Plus immer gruen und Minus immer rot — es braucht keine
      // Richtungsangabe je Kennzahl.
      const vglChip = (v, schnitt, n) => {
        if (v === null || !schnitt || !(schnitt > 0)) return "";
        if (!n || n < ct.VERGLEICH_MINDESTENS) return "";
        const proz = Math.round(((v - schnitt) / schnitt) * 100);
        if (proz === 0) return `<i class="ct-vgl gleich" title="genau im Schnitt">±0 %</i>`;
        return `<i class="ct-vgl ${proz > 0 ? "auf" : "ab"}" title="gegenüber dem Ø der anderen Videos">${
          proz > 0 ? "+" : ""}${proz} %</i>`;
      };

      // Zusatzzeile, die keine Plattform liefert, die wir aber rechnen koennen:
      // wie viel Prozent der eigenen Laufzeit im Schnitt gesehen wurden.
      // 12 von 15 Sekunden ist stark, 12 von 90 Sekunden ist schwach — ohne die
      // Laenge daneben ist "Ø Sekunden gesehen" nicht zu deuten.
      const anteilGesehen = (z, laenge) => {
        const s = wert(z, { id: "avg_sekunden" });
        if (s === null || !laenge || laenge <= 0) return null;
        return Math.round((s / laenge) * 1000) / 10;
      };

      const kanalKarte = (kanal) => {
        const punkte = ct.MESSPUNKTE.filter((mp) => zahlVon(kanal, mp.id));
        const link = linkVon(kanal);
        // Die Ø-Spalte haengt an EINEM Messpunkt — und zwar an dem mit der
        // breitesten Grundlage, nicht am spaetesten. Sonst steht die Spalte bei
        // TikTok auf "nach 7 Tagen", wo es erst zwei Vergleichsvideos gibt, und
        // bleibt leer, obwohl "nach 24 Stunden" drei hat. Welcher Zeitpunkt es
        // ist, steht in der Spaltenueberschrift — eine Ø-Spalte ohne diese
        // Angabe waere nicht nachpruefbar.
        const bester = punkte
          .map((mp) => ({ mp, v: vgl[kanal + "|" + mp.id] }))
          .filter((x) => x.v)
          .sort((a, b) => (b.v.videos || 0) - (a.v.videos || 0))[0] || null;
        const vglVideos = bester ? (bester.v.videos || 0) : 0;
        // Ø-Spalte nur zeigen, wenn sie auf genug Videos steht. Sonst waere sie
        // eine Zahl, die Sicherheit vortaeuscht, die sie nicht hat.
        const zeigeSchnitt = vglVideos >= ct.VERGLEICH_MINDESTENS;
        const vglLetzter = bester ? bester.v : null;

        const zeile = (titel, zellen, schnittZelle) =>
          `<tr><td>${titel}</td>${zellen}${zeigeSchnitt ? schnittZelle : ""}</tr>`;

        return `<div class="karte ct-analyse"><div class="karte-kopf"><div>
          <h2>${e(kanal)}</h2>
          <div class="sub">${punkte.length
            ? punkte.length + " Messung" + (punkte.length === 1 ? "" : "en") +
              (zeigeSchnitt
                ? ` · eingeordnet gegen ${vglVideos} andere Videos auf ${e(kanal)}`
                : ` · noch keine Einordnung — dafür braucht es Messungen von ${
                    ct.VERGLEICH_MINDESTENS} anderen Videos auf ${e(kanal)} zum selben Zeitpunkt`)
            : "noch nicht gemessen"}</div></div>
          <div class="ct-kanal-tasten">
            ${link ? `<a href="${e(link)}" target="_blank" rel="noopener noreferrer"
              class="knopf sekundaer klein">Ansehen ↗</a>` : ""}
            <button type="button" class="sekundaer klein"
              onclick="messenOeffnen(${JSON.stringify(kanal).replace(/"/g, "&quot;")})">Zahlen eintragen</button>
          </div></div>
          ${punkte.length ? `<div class="tabelle-huelle"><table class="tabelle ct-analyse-tab">
            <thead><tr><th></th>${punkte.map((mp) =>
              `<th class="rechts">${e(mp.titel)}</th>`).join("")}${
              zeigeSchnitt ? `<th class="rechts ct-spalte-schnitt">Ø andere Videos
                <span class="ct-vgl-basis">${e(bester.mp.titel)}</span></th>` : ""}</tr></thead>
            <tbody>${ct.KENNZAHLEN.map((k) => {
              if (punkte.every((mp) => wert(zahlVon(kanal, mp.id), k) === null)) return "";
              const zellen = punkte.map((mp) => {
                const v = wert(zahlVon(kanal, mp.id), k);
                const vv = vgl[kanal + "|" + mp.id];
                return `<td class="rechts"><span class="ct-wert">${formatiere(v, k.art)}</span>${
                  vv ? vglChip(v, vv[k.id], vv["n_" + k.id]) : ""}</td>`;
              }).join("");
              const n = vglLetzter ? vglLetzter["n_" + k.id] : 0;
              const schnitt = `<td class="rechts ct-spalte-schnitt">${
                n >= ct.VERGLEICH_MINDESTENS
                  ? `${formatiere(k.art === "ganz"
                        ? Math.round(vglLetzter[k.id])
                        : Math.round(vglLetzter[k.id] * 10) / 10, k.art)}
                     <span class="ct-vgl-basis">aus ${n}</span>`
                  : `<span class="ct-leer">–</span>`}</td>`;
              return zeile(e(k.titel), zellen, schnitt);
            }).join("")}
            ${p.laenge_sek && punkte.some((mp) => anteilGesehen(zahlVon(kanal, mp.id), p.laenge_sek) !== null) ? (() => {
              // Berechnete Zeile — deutlich als solche gekennzeichnet.
              const zellen = punkte.map((mp) => {
                const a = anteilGesehen(zahlVon(kanal, mp.id), p.laenge_sek);
                const vv = vgl[kanal + "|" + mp.id];
                const vSchnitt = vv && vv.avg_sekunden && vv.laenge_sek
                  ? (vv.avg_sekunden / vv.laenge_sek) * 100 : null;
                return `<td class="rechts"><span class="ct-wert">${
                  a === null ? `<span class="ct-leer">–</span>` : a.toLocaleString("de-DE") + " %"
                }</span>${vv ? vglChip(a, vSchnitt, vv.n_avg_sekunden) : ""}</td>`;
              }).join("");
              const vS = vglLetzter && vglLetzter.avg_sekunden && vglLetzter.laenge_sek
                ? Math.round((vglLetzter.avg_sekunden / vglLetzter.laenge_sek) * 1000) / 10 : null;
              return zeile(
                `Anteil der Länge gesehen <span class="ct-berechnet">berechnet</span>`,
                zellen,
                `<td class="rechts ct-spalte-schnitt">${vS === null
                  ? `<span class="ct-leer">–</span>`
                  : vS.toLocaleString("de-DE") + " %"}</td>`);
            })() : ""}
            </tbody></table></div>`
            : `<p class="caption">Für ${e(kanal)} sind noch keine Zahlen da.
               Über den Knopf oben eintragen — 24 Stunden nach dem Hochladen und
               noch einmal nach einer Woche.</p>`}
        </div>`;
      };

      const rubrik = p.rubrik ? ct.RUBRIK_TITEL[p.rubrik] : null;
      const funnel = p.funnel ? ct.FUNNEL_TITEL[p.funnel] : null;

      res.send(schale({
        titel: p.titel, unterzeile: `${p.sorte ? p.sorte + " · " : ""}${
          p.marke_name || ""}${p.veroeffentlicht_am ? " · veröffentlicht " + datum(p.veroeffentlicht_am) : ""}`,
        aktiv: "content", nutzer: u,
        inhalt: `
        <div class="seiten-kopf">
          <div><a href="/content" class="ct-zurueck">${ICON.pfeilLinks} Zurück zu Content</a></div>
        </div>

        <div class="karte ct-akte" style="margin-bottom:16px">
          <div class="karte-kopf"><div>
            <h2>${e(p.titel)}</h2>
            <div class="ct-akte-marken">
              <span class="badge b-gruen">${e(ct.STATUS_LABEL[p.status])}</span>
              ${rubrik ? `<span class="badge">${e(rubrik)}</span>` : ""}
              ${funnel ? `<span class="badge">${e(funnel)}</span>` : ""}
              ${p.sorte ? `<span class="badge">${e(p.sorte)}</span>` : ""}
              ${p.zielgruppe ? `<span class="badge">${e(p.zielgruppe)}</span>` : ""}
            </div></div>
            <button type="button" class="sekundaer klein" onclick="akteOeffnen()">Akte bearbeiten</button>
          </div>

          <div class="ct-akte-raster">
            <div class="ct-akte-inhalt">
              <h3>Was im Video zu sehen war</h3>
              ${p.inhalt
                ? `<p class="ct-inhalt-text">${e(p.inhalt)}</p>`
                : `<p class="caption">Noch nichts eingetragen. Ohne eine kurze Beschreibung
                   sind die Zahlen weiter unten in drei Monaten nicht mehr zu deuten —
                   „Reel 47" sagt dann nichts mehr.</p>`}
              ${p.notiz ? `<p class="mk-post-notiz">${e(p.notiz)}</p>` : ""}
            </div>

            <div class="ct-akte-fakten">
              <div class="ct-fakt"><span>Länge</span><b>${dauer(p.laenge_sek) || "–"}</b></div>
              <div class="ct-fakt"><span>Veröffentlicht</span><b>${
                p.veroeffentlicht_am ? datum(p.veroeffentlicht_am) : "–"}</b></div>
              <div class="ct-fakt"><span>Läuft auf</span><b>${p.kanaele.length} Kanälen</b></div>
            </div>
          </div>

          <div class="ct-akte-links">
            ${p.kanaele.map((kanal) => {
              const l = linkVon(kanal);
              return `<div class="ct-linkzeile">
                <span class="ct-linkkanal">${e(kanal)}</span>
                ${l ? `<a href="${e(l)}" target="_blank" rel="noopener noreferrer">Video ansehen ↗</a>`
                    : `<span class="caption">kein Link hinterlegt</span>`}</div>`;
            }).join("")}
          </div>
        </div>

        ${p.kanaele.map(kanalKarte).join("")}

        <div class="hinweis info" style="margin-top:16px">${ICON.info}<div>
          <strong>Wie der Vergleich zu lesen ist.</strong>
          Verglichen wird immer gleicher Zeitpunkt gegen gleichen Zeitpunkt —
          „nach 24 Stunden" gegen „nach 24 Stunden" der anderen Videos auf
          demselben Kanal. Sonst würde ein altes Video allein durch sein Alter
          besser dastehen. Ein Prozentwert erscheint erst ab
          ${ct.VERGLEICH_MINDESTENS} Vergleichsvideos; darunter ist er Zufall.
          Es ist der Mittelwert: solange wenige Videos dahinterstehen, zieht ein
          einzelner Ausreißer ihn spürbar mit.
          <br><br>
          <strong>Was hier fehlt und warum.</strong>
          Geschlecht, Bundesland und Sekundenschwellen (0,5 s / 1 s / 15 s) geben
          weder TikTok noch YouTube, Instagram oder X je Video heraus — die gibt es
          dort nur für den ganzen Kanal. Was es gibt, steht oben: Ø Sekunden und
          der Anteil, der bis zum Ende geschaut hat. Website-Klicks messen wir
          selbst, sobald je Video ein eigener Link verwendet wird.</div></div>

        <dialog id="dlg-akte"><form method="post" action="/content/post/akte">
          <div class="todo-dlg-kopf"><div><h2>Akte bearbeiten</h2>
            <div class="sub">${e(p.titel)}</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <input type="hidden" name="post_id" value="${p.id}">
          <div class="feld"><label>Was im Video zu sehen war</label>
            <textarea name="inhalt" rows="4"
              placeholder="Kurz: Aufhänger, was passiert, wie es endet.">${e(p.inhalt || "")}</textarea></div>
          <div class="feld"><label>Länge in Sekunden</label>
            <input name="laenge_sek" inputmode="numeric" value="${p.laenge_sek || ""}"
              placeholder="z. B. 34"></div>
          <h3 style="margin:6px 0 10px">Links</h3>
          ${p.kanaele.map((kanal) => `<div class="feld"><label>${e(kanal)}</label>
            <input name="link_${e(kanal)}" value="${e(linkVon(kanal))}"
              placeholder="https://…"></div>`).join("")}
          <p class="caption" style="margin:-4px 0 12px">Ein leeres Feld entfernt den
            hinterlegten Link. Es werden nur Adressen mit http:// oder https:// übernommen.</p>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.check} Speichern</button></div>
        </form></dialog>

        <dialog id="dlg-messen"><form method="post" action="/content/zahlen">
          <div class="todo-dlg-kopf"><div><h2>Zahlen eintragen</h2>
            <div class="sub" id="messen-kanal">—</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <input type="hidden" name="post_id" value="${p.id}">
          <input type="hidden" name="kanal" id="messen-kanal-wert">
          <div class="feld"><label>Zeitpunkt der Messung</label>
            <select name="messpunkt" id="messen-punkt" onchange="messwerteLaden()">
              ${ct.MESSPUNKTE.map((m) => `<option value="${m.id}">${e(m.titel)}</option>`).join("")}
            </select></div>
          <div class="ct-messfelder">
            ${ct.KENNZAHLEN.map((k) => `<div class="feld"><label>${e(k.titel)}</label>
              <input name="${k.id}" id="mess-${k.id}" inputmode="${k.art === "komma" ? "decimal" : "numeric"}"
                placeholder="—"></div>`).join("")}
          </div>
          <div class="feld"><label>Notiz</label><input name="notiz" id="mess-notiz" placeholder="Auffälligkeiten?"></div>
          <p class="caption" style="margin:-4px 0 12px">Leere Felder bleiben leer — du musst nicht
            alles eintragen. Ein schon erfasster Zeitpunkt wird überschrieben.</p>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.check} Speichern</button></div>
        </form></dialog>

        <script>
        // Schon erfasste Werte, damit die Maske beim Nachbessern nicht leer ist.
        var ZAHLEN = ${JSON.stringify(p.zahlen)};
        var FELDER = ${JSON.stringify(ct.KENNZAHLEN.map((k) => k.id))};
        function akteOeffnen(){ document.getElementById("dlg-akte").showModal(); }
        function messenOeffnen(kanal){
          document.getElementById("messen-kanal").textContent = kanal;
          document.getElementById("messen-kanal-wert").value = kanal;
          messwerteLaden();
          document.getElementById("dlg-messen").showModal();
        }
        function messwerteLaden(){
          var kanal = document.getElementById("messen-kanal-wert").value;
          var mp    = document.getElementById("messen-punkt").value;
          var z = ZAHLEN.filter(function(x){ return x.kanal === kanal && x.messpunkt === mp; })[0];
          FELDER.forEach(function(f){
            var el = document.getElementById("mess-" + f);
            // Komma statt Punkt: so tippt man Zahlen hier, und so kommen sie
            // auch aus den Creator-Ansichten der Plattformen.
            el.value = z && z[f] !== null && z[f] !== undefined ? String(z[f]).replace(".", ",") : "";
          });
          document.getElementById("mess-notiz").value = (z && z.notiz) || "";
        }
        </script>`,
      }) + "</body></html>");
    } catch (err) { next(err); }
  });

  const formular = express.urlencoded({ extended: true });

  app.post("/content/zahlen", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const r = await ct.zahlenEintragen(req.nutzer, b);
      res.redirect("/content/post/" + encodeURIComponent(b.post_id) +
        (r.ok ? "" : "?fehler=" + encodeURIComponent(r.grund)));
    } catch (err) { next(err); }
  });

  // Inhalt, Laenge und die Links je Kanal. Die Linkfelder heissen "link_TikTok",
  // "link_YouTube Shorts" usw. — der Kanalname steht im Feldnamen, damit das
  // Formular ohne feste Reihenfolge auskommt.
  app.post("/content/kanalstand", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const r = await ct.standEintragen(req.nutzer, b);
      res.redirect("/content" + (b.marke ? "?marke=" + encodeURIComponent(b.marke) : "") +
        (r.ok ? "" : (b.marke ? "&" : "?") + "fehler=" + encodeURIComponent(r.grund)));
    } catch (err) { next(err); }
  });

  app.post("/content/post/akte", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const links = {};
      for (const kanal of ct.KANAELE) links[kanal] = b["link_" + kanal] || "";
      const r = await ct.postAkte(req.nutzer, b.post_id, {
        inhalt: b.inhalt, laenge_sek: b.laenge_sek, links,
      });
      res.redirect("/content/post/" + encodeURIComponent(b.post_id) +
        (r.ok ? "" : "?fehler=" + encodeURIComponent(r.grund)));
    } catch (err) { next(err); }
  });

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

  // Wochenziele je Kanal. Die Felder heissen ziel_YouTube, ziel_TikTok, …
  app.post("/content/ziele", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const jeKanal = {};
      for (const k of ct.KANAELE) jeKanal[k] = b["ziel_" + k];
      const r = await ct.zieleSetzen(req.nutzer, b.marke, jeKanal);
      res.redirect("/content" + (r.ok
        ? "?marke=" + encodeURIComponent(b.marke)
        : "?fehler=" + encodeURIComponent(r.grund)));
    } catch (err) { next(err); }
  });
};
