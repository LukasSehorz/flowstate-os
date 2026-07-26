// Flowstate Buchhaltung — Uebersicht und Erfassung.
// Eigenes Modul, damit der Eingriff in server.js (Lukas' Datei) bei zwei Zeilen bleibt.
const express = require("express");
const { schale } = require("./schale.js");
const buch = require("./buchhaltung.js");
const lex = require("./lexware.js");
const crm = require("./crm.js");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Summen und Auswertungen ohne Cent — sonst werden die Kacheln unruhig.
const geld = (n) => new Intl.NumberFormat("de-DE",
  { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n) || 0);
// Einzelbuchungen IMMER mit Cent. In der Buchhaltung darf nichts gerundet werden:
// 249,90 € als "250 €" anzuzeigen wäre schlicht falsch.
const geldGenau = (n) => new Intl.NumberFormat("de-DE",
  { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(Number(n) || 0);
const datum = (d) => (d ? new Date(d).toLocaleDateString("de-DE",
  { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
// Lokale Datumsfelder — nie toISOString(), das dreht oestlich von UTC auf den Vortag.
const datumFeld = (w) => {
  if (!w) return "";
  const d = new Date(w);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const heuteFeld = () => datumFeld(new Date());

const ZEITRAUM_LABEL = {
  monat: new Date().toLocaleDateString("de-DE", { month: "long" }),
  m3: "3 Monate", m6: "6 Monate", m12: "12 Monate", alle: "Insgesamt",
};
const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  euro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 18a6 6 0 1 1 0-12M4 10h8M4 14h8"/></svg>',
  ab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  auf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  uhr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
  ordner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  warnung: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
};

module.exports = function (app) {
  // Die Buchhaltung laeuft auf den CRM-Konten: die Anmeldung steckt in
  // req.session.crm, gesetzt beim Login unter /crm/anmelden. Die Middleware des
  // CRM-Moduls greift nur unter /crm, darum hier dieselbe Pruefung fuer /buchhaltung.
  // Nur die Geschaeftsfuehrung — die Datenbank-Policies sehen es genauso, das hier
  // erspart nur die leere Seite.
  const nurAdmin = (req, res, next) => {
    if (!req.session || !req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    if (req.nutzer.rolle !== "admin") return res.redirect("/crm");
    next();
  };

  app.get("/buchhaltung", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const zeitraum = buch.ZEITRAEUME[req.query.zeit] !== undefined ? req.query.zeit : "monat";
      const [d, firmen, belegeAlle, konto] = await Promise.all([
        buch.uebersicht(u, zeitraum),
        crm.firmenListe(u, { limit: 300 }),
        buch.belegeOffen(u, null),
        lex.kontoArt(),
      ]);
      d.belegeAlle = belegeAlle;
      // Bei Kleinunternehmern erlaubt Lexware nur 0 % — dann gibt es nichts zu waehlen.
      const saetze = konto.steuerfrei ? [0] : [19, 7, 0];

      const zLabel = ZEITRAUM_LABEL[zeitraum];
      const zSatz = zeitraum === "alle" ? "insgesamt"
        : zeitraum === "monat" ? "im " + zLabel
        : "in den letzten " + zLabel.replace(/Monate$/, "Monaten");
      const zUrl = (z) => "/buchhaltung?zeit=" + z;

      // ---------- Kacheln ----------
      const kachel = (titel, wert, icon, ton, fuss) => `
        <div class="kachel ${ton}"><div class="kachel-kopf">
          <span class="kachel-titel">${e(titel)}</span><span class="kachel-icon">${icon}</span></div>
          <div class="kachel-zahl">${wert}</div>
          <div class="kachel-fuss">${fuss}</div></div>`;

      const ergebnisTon = d.summe.ergebnis > 0 ? "gruen" : d.summe.ergebnis < 0 ? "rot" : "";

      // ---------- Verlauf: zwei Balken je Monat ----------
      // Die Abfrage liefert nur Monate MIT Buchungen. Fehlende auffuellen, sonst
      // steht "zwölf Monate" darueber und es sind sechs Balken zu sehen.
      const vonDb = Object.fromEntries(d.verlauf.map((v) => [v.monat, v]));
      const zwoelf = Array.from({ length: 12 }, (_, i) => {
        const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - (11 - i));
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
        return vonDb[key] || { monat: key, einnahmen: 0, ausgaben: 0 };
      });
      const hatBuchungen = d.verlauf.length > 0;
      const maxV = Math.max(1, ...zwoelf.flatMap((v) => [v.einnahmen, v.ausgaben]));
      const verlaufBlock = hatBuchungen ? `
        <div class="bh-verlauf">
          ${zwoelf.map((v) => {
            const [jahr, mon] = v.monat.split("-");
            return `<div class="bh-monat" title="${MONATE_KURZ[Number(mon) - 1]} ${jahr}
Einnahmen ${geld(v.einnahmen)}
Ausgaben ${geld(v.ausgaben)}">
              <div class="bh-paar">
                <span class="bh-ein" style="height:${Math.max(2, Math.round(v.einnahmen / maxV * 100))}%"></span>
                <span class="bh-aus" style="height:${Math.max(2, Math.round(v.ausgaben / maxV * 100))}%"></span>
              </div>
              <span class="bh-monat-label">${MONATE_KURZ[Number(mon) - 1]}</span></div>`;
          }).join("")}
        </div>
        <div class="bh-legende">
          <span><i class="bh-punkt ein"></i>Einnahmen</span>
          <span><i class="bh-punkt aus"></i>Ausgaben</span>
        </div>` : `<p class="caption">Noch keine Buchungen — erfasse die erste über „Ausgabe erfassen".</p>`;

      // ---------- Ausgaben je Kategorie ----------
      const maxK = Math.max(1, ...d.kategorien.map((k) => k.betrag));
      const katBlock = d.kategorien.length ? `<div class="liste-zeilen">
        ${d.kategorien.map((k) => `<div class="grund-zeile">
          <span class="gz-text">${e(k.kategorie)}<i>${k.anzahl} ${k.anzahl === 1 ? "Buchung" : "Buchungen"}</i></span>
          <span class="gz-spur"><i style="width:${Math.round(k.betrag / maxK * 100)}%"></i></span>
          <span class="gz-zahl">${geld(k.betrag)}</span></div>`).join("")}
        </div>` : `<p class="caption">Keine Ausgaben ${e(zSatz)}.</p>`;

      // ---------- Offene Rechnungen ----------
      const offenBlock = d.offen.length ? `<div class="liste-zeilen">
        ${d.offen.map((o) => {
          const ueber = o.tage_ueber !== null && o.tage_ueber > 0;
          return `<div class="liste-zeile">
            <span class="lz-text">${e(o.firma_name || o.gegenstelle || "Ohne Kunde")}
              <i>${o.faellig ? (ueber ? `<b class="spaet">${o.tage_ueber} Tage überfällig</b>` : "fällig " + datum(o.faellig)) : "ohne Frist"}</i></span>
            <span class="lz-wert">${geldGenau(o.betrag)}</span>
            <form method="post" action="/buchhaltung/bezahlt" class="lz-tat">
              <input type="hidden" name="id" value="${o.id}">
              <button type="submit" class="sekundaer klein" title="Als bezahlt markieren">${ICON.check}</button>
            </form></div>`;
        }).join("")}
        <div class="liste-fuss"><span>${d.offen.length} offene ${d.offen.length === 1 ? "Rechnung" : "Rechnungen"}</span>
          <b>${geld(d.offenSumme)}</b></div>
        </div>` : `<p class="caption">Alles bezahlt — keine offene Rechnung.</p>`;

      // ---------- Letzte Buchungen ----------
      const letzteBlock = d.letzte.length ? `<div class="tabelle-huelle"><table class="tabelle">
        <thead><tr><th>Datum</th><th>Wen/Was</th><th>Kategorie</th>
          <th class="rechts">Betrag</th><th class="rechts">Erfasst</th><th></th></tr></thead>
        <tbody>${d.letzte.map((l) => `<tr>
          <td>${datum(l.datum)}</td>
          <td class="zeile-titel">${e(l.firma_name || l.gegenstelle || "—")}
            ${l.notiz ? `<span class="zeile-sub">${e(l.notiz)}</span>` : ""}</td>
          <td>${l.kategorie ? `<span class="badge">${e(l.kategorie)}</span>` : `<span class="caption">—</span>`}</td>
          <td class="rechts bh-betrag ${l.art}">${l.art === "ausgabe" ? "−" : "+"} ${geldGenau(l.betrag)}
            ${l.art === "einnahme" && !l.bezahlt ? `<span class="badge b-bernstein">offen</span>` : ""}</td>
          <td class="rechts caption">${e((l.wer || "").split(" ")[0] || "—")}</td>
          <td class="rechts"><form method="post" action="/buchhaltung/loeschen"
            onsubmit="return confirm('Diese Buchung löschen?')">
            <input type="hidden" name="id" value="${l.id}">
            <button type="submit" class="still klein" title="Löschen">${ICON.x}</button></form></td>
        </tr>`).join("")}</tbody></table></div>`
        : `<p class="caption">Noch nichts erfasst.</p>`;

      // ---------- Belegeingang, getrennt nach Richtung ----------
      // Ein Kasten je Art: Ausgaben (Quittungen, Tankrechnungen, Eingangsrechnungen)
      // und Einnahmen (unsere Rechnungen an Kunden). Beide arbeiten gleich.
      const belegKasten = (art) => {
        const ein = art === "einnahme";
        const liste = d.belegeAlle.filter((b) => (b.art || "ausgabe") === art);
        const neu = liste.filter((b) => b.status !== "gebucht");
        const kat = ein ? buch.EINNAHME_KATEGORIEN : buch.AUSGABE_KATEGORIEN;
        return `<div class="karte"><div class="karte-kopf"><div>
          <h2>${ein ? "Rechnungen an Kunden" : "Quittungen &amp; Eingangsrechnungen"}</h2>
          <div class="sub">${ein
            ? "Was wir in Rechnung gestellt und bekommen haben"
            : "Tankbelege, Einkäufe, Rechnungen von Lieferanten"}</div></div>
          ${neu.length ? `<span class="badge b-bernstein">${neu.length} zu prüfen</span>` : ""}</div>
          <div class="ablage" data-art="${art}" id="ablage-${art}">
            <div class="ablage-icon">${ICON.ordner}</div>
            <div class="ablage-text"><b>${ein ? "Rechnung" : "Beleg"} hier ablegen</b>
              <span class="caption">PDF, Foto oder Screenshot — oder klicken zum Auswählen</span></div>
            <input type="file" id="feld-${art}" accept="image/*,application/pdf" multiple hidden>
          </div>
          <div class="beleg-liste">
          ${liste.length ? liste.map((b) => {
            const offen = b.status !== "gebucht";
            return `<div class="beleg ${b.status}">
              <div class="beleg-kopf">
                <span class="lz-punkt ${b.status === "gebucht" ? "fertig" : b.status === "fehler" ? "fehler" : "offen"}"></span>
                <span class="beleg-name">${e(b.dateiname)}
                  <i>${e((b.wer || "").split(" ")[0] || "")}${b.groesse ? " · " + Math.round(b.groesse / 1024) + " KB" : ""}</i></span>
                ${b.status === "gebucht"
                  ? `<span class="badge b-gruen" title="${b.lexware_id
                      ? "Liegt in Lexware im Belegeingang und muss dort noch freigegeben werden"
                      : "Nur hier gebucht — nicht in Lexware"}">gebucht${b.lexware_id ? " · in Lexware" : ""}</span>`
                  : `<span class="badge b-bernstein">zu prüfen</span>`}
                <form method="post" action="/buchhaltung/beleg/loeschen" class="lz-tat">
                  <input type="hidden" name="id" value="${b.id}">
                  <button type="submit" class="still klein" title="Entfernen">${ICON.x}</button></form>
              </div>
              ${b.fehler_text ? `<div class="beleg-fehler">${ICON.warnung} ${e(b.fehler_text)}</div>` : ""}
              ${offen ? `<form method="post" action="/buchhaltung/beleg/buchen" class="beleg-pruefen">
                <input type="hidden" name="id" value="${b.id}">
                <div class="beleg-felder">
                  <label>Betrag brutto (€)
                    <input name="betrag" required inputmode="decimal" placeholder="0,00"
                      value="${b.betrag !== null ? String(b.betrag).replace(".", ",") : ""}"></label>
                  <label>Datum <input type="date" name="datum" required value="${b.datum ? datumFeld(b.datum) : heuteFeld()}"></label>
                  <label>USt ${saetze.length === 1
                    ? `<input value="0 % · Kleinunternehmer" disabled title="Euer Lexware-Konto steht auf Kleinunternehmer (§19 UStG) — dort ist nur 0 % erlaubt.">
                       <input type="hidden" name="steuersatz" value="0">`
                    : `<select name="steuersatz">
                        ${saetze.map((s) => `<option value="${s}" ${Number(b.steuersatz) === s || (b.steuersatz === null && s === saetze[0]) ? "selected" : ""}>${s} %</option>`).join("")}
                       </select>`}</label>
                  <label>${ein ? "Kunde" : "Lieferant"}
                    <input name="gegenstelle" placeholder="${ein ? "z. B. Tierklinik Isartal" : "z. B. Shell, Ikea"}"
                      value="${e(b.gegenstelle || "")}"></label>
                  <label>Kategorie <select name="kategorie">
                    ${kat.map((k) => `<option ${b.kategorie === k ? "selected" : ""}>${e(k)}</option>`).join("")}
                  </select></label>
                  <label>Belegnummer <input name="belegnummer" placeholder="optional" value="${e(b.belegnummer || "")}"></label>
                </div>
                <div class="beleg-fuss">
                  ${b.hat_datei ? `<a href="/buchhaltung/beleg/${b.id}/datei" target="_blank" class="caption">Beleg ansehen ↗</a>` : `<span class="caption">Keine Datei</span>`}
                  <button type="submit" class="dunkel">${ICON.check} Passt — buchen</button>
                </div>
              </form>` : `<div class="beleg-fertig">
                ${geldGenau(b.betrag)} · ${e(b.kategorie || "ohne Kategorie")}${b.datum ? " · " + datum(b.datum) : ""}
                ${b.gegenstelle ? " · " + e(b.gegenstelle) : ""}</div>`}
            </div>`;
          }).join("") : `<p class="caption">Noch kein ${ein ? "Rechnungs" : "Beleg"}eingang.</p>`}
          </div>
        </div>`;
      };

      // ---------- Erfassungs-Dialog ----------
      const dialog = (art) => {
        const ein = art === "einnahme";
        const kat = ein ? buch.EINNAHME_KATEGORIEN : buch.AUSGABE_KATEGORIEN;
        return `<dialog id="dlg-${art}"><form method="post" action="/buchhaltung/buchen">
          <div class="todo-dlg-kopf"><div><h2>${ein ? "Einnahme" : "Ausgabe"} erfassen</h2>
            <div class="sub">${ein ? "Was hereinkommt" : "Was hinausgeht"}</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <input type="hidden" name="art" value="${art}">
          <div class="feld-paar">
            <div class="feld"><label>Datum</label><input type="date" name="datum" value="${heuteFeld()}" required></div>
            <div class="feld"><label>Betrag (€) *</label><input name="betrag" required placeholder="z. B. 1250" inputmode="decimal"></div>
          </div>
          <div class="feld"><label>${ein ? "Kunde" : "Empfänger"}</label>
            ${ein ? `<select name="firma_id">
              <option value="">— frei eintragen —</option>
              ${firmen.map((f) => `<option value="${f.id}">${e(f.name)}</option>`).join("")}
            </select>` : ""}
            <input name="gegenstelle" placeholder="${ein ? "oder Name frei eintragen" : "z. B. Adobe, Meta, Steuerkanzlei Berger"}"></div>
          <div class="feld"><label>Kategorie</label><select name="kategorie">
            <option value="">— ohne —</option>
            ${kat.map((k) => `<option>${e(k)}</option>`).join("")}</select></div>
          ${ein ? `<div class="feld-paar">
            <div class="feld"><label>Schon bezahlt?</label><select name="bezahlt" id="bez-${art}"
              onchange="document.getElementById('faellig-${art}').style.display=this.value==='nein'?'':'none'">
              <option value="ja">Ja, ist eingegangen</option>
              <option value="nein">Nein, Rechnung offen</option></select></div>
            <div class="feld" id="faellig-${art}" style="display:none"><label>Fällig bis</label>
              <input type="date" name="faellig"></div>
          </div>` : `<div class="feld"><label>Wiederkehrend?</label><select name="wiederkehrend">
            <option value="nein">Einmalig</option><option value="ja">Monatlich wiederkehrend</option></select></div>`}
          <div class="feld"><label>Notiz</label><input name="notiz" placeholder="Wofür genau?"></div>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.plus} Erfassen</button></div>
        </form></dialog>`;
      };

      res.send(schale({
        titel: "Buchhaltung", unterzeile: "Einnahmen, Ausgaben und Belege", aktiv: "buchhaltung",
        nutzer: u, suche: "Buchhaltung durchsuchen …",
        inhalt: `
        ${lex.bereit()
          ? `<div class="hinweis info" style="margin-bottom:16px">${ICON.info}<div>
              <strong>Lexware ist verbunden${konto.firma ? " — " + e(konto.firma) : ""}.</strong>
              Beleg hochladen, Werte prüfen, auf „Passt" tippen — die Datei wandert dann in den
              Belegeingang von Lexware, wo die Belegerkennung darüber läuft, und die Zahlen zählen
              hier sofort mit. <b>In Lexware musst du den Beleg einmal freigeben</b> — die
              Schnittstelle kann Belege mit Datei nicht selbst abschließen.
              ${konto.steuerfrei
                ? `<br><b>Kleinunternehmer nach §19 UStG:</b> ohne Umsatzsteuer — Lexware weist
                   jeden Beleg mit 7 % oder 19 % ab.`
                : ""}</div></div>`
          : `<div class="hinweis warn" style="margin-bottom:16px">${ICON.warnung}<div>
              <strong>Lexware ist nicht verbunden.</strong> Es fehlt <code>LEXWARE_API_KEY</code> in der
              <code>.env</code>. Belege lassen sich erfassen, werden aber nicht übertragen.</div></div>`}

        <div class="seiten-kopf">
          <div><p class="sub">Zahlen ${e(zSatz)}</p></div>
          <div class="bh-tasten">
            <button type="button" class="sekundaer" onclick="document.getElementById('dlg-einnahme').showModal()">
              ${ICON.auf} Einnahme</button>
            <button type="button" class="dunkel" onclick="document.getElementById('dlg-ausgabe').showModal()">
              ${ICON.plus} Ausgabe erfassen</button>
          </div>
        </div>

        <nav class="zeit-schalter" style="max-width:520px;margin-bottom:16px">
          ${Object.keys(ZEITRAUM_LABEL).map((z) => `<a href="${zUrl(z)}"
            class="${z === zeitraum ? "an" : ""}">${e(ZEITRAUM_LABEL[z])}</a>`).join("")}
        </nav>

        <div class="kacheln">
          ${kachel("Einnahmen", geld(d.summe.einnahmen), ICON.auf, "gruen",
            `<span class="caption">${d.summe.anzahl_einnahmen} ${d.summe.anzahl_einnahmen === 1 ? "Buchung" : "Buchungen"}</span>`)}
          ${kachel("Ausgaben", geld(d.summe.ausgaben), ICON.ab, "rot",
            `<span class="caption">${d.summe.anzahl_ausgaben} ${d.summe.anzahl_ausgaben === 1 ? "Buchung" : "Buchungen"}</span>`)}
          ${kachel("Ergebnis", (d.summe.ergebnis >= 0 ? "" : "−") + geld(Math.abs(d.summe.ergebnis)), ICON.euro, ergebnisTon,
            `<span class="caption">${d.summe.ergebnis >= 0 ? "Überschuss" : "Unterdeckung"} ${e(zSatz)}</span>`)}
          ${kachel("Offene Rechnungen", geld(d.offenSumme), ICON.uhr, d.offen.length ? "bernstein" : "",
            `<span class="caption">${d.offen.length} ${d.offen.length === 1 ? "Rechnung" : "Rechnungen"} · unabhängig vom Zeitraum</span>`)}
        </div>

        <div class="karte" style="margin-bottom:16px"><div class="karte-kopf"><div>
          <h2>Einnahmen und Ausgaben im Verlauf</h2>
          <div class="sub">Die letzten zwölf Monate — unabhängig vom gewählten Zeitraum</div></div></div>
          ${verlaufBlock}
        </div>

        <div class="bh-reihe">
          <div class="karte"><div class="karte-kopf"><div><h2>Ausgaben nach Kategorie</h2>
            <div class="sub">Wohin das Geld geht — ${e(zSatz)}</div></div>
            ${d.summe.ausgaben ? `<span class="badge">${geld(d.summe.ausgaben)}</span>` : ""}</div>
            ${katBlock}
          </div>
          <div class="karte"><div class="karte-kopf"><div><h2>Offene Rechnungen</h2>
            <div class="sub">Was noch nicht eingegangen ist</div></div>
            ${d.offen.length ? `<span class="badge b-bernstein">${geld(d.offenSumme)}</span>` : ""}</div>
            ${offenBlock}
          </div>
        </div>

        <div class="karte" style="margin:16px 0"><div class="karte-kopf"><div><h2>Letzte Buchungen</h2>
          <div class="sub">Die zwölf neuesten Einträge</div></div></div>
          ${letzteBlock}
        </div>

        <div class="bh-reihe">
          ${belegKasten("ausgabe")}
          ${belegKasten("einnahme")}
        </div>

        ${dialog("ausgabe")}
        ${dialog("einnahme")}
        <script>
        (function(){
          const GRENZE=10*1024*1024; // 10 MB je Datei
          // Die Datei wird im Browser als base64 gelesen und als JSON geschickt.
          // So braucht der Server keinen zusaetzlichen Multipart-Leser.
          function lesen(f){
            return new Promise((fertig,fehler)=>{
              const l=new FileReader();
              l.onload=()=>fertig(String(l.result).split(",")[1]||"");
              l.onerror=()=>fehler(new Error("Datei nicht lesbar"));
              l.readAsDataURL(f);
            });
          }
          ["ausgabe","einnahme"].forEach(art=>{
            const zone=document.getElementById("ablage-"+art);
            const feld=document.getElementById("feld-"+art);
            if(!zone||!feld) return;
            zone.addEventListener("click",()=>feld.click());
            ["dragenter","dragover"].forEach(n=>zone.addEventListener(n,ev=>{
              ev.preventDefault(); zone.classList.add("bereit"); }));
            ["dragleave","drop"].forEach(n=>zone.addEventListener(n,()=>zone.classList.remove("bereit")));
            zone.addEventListener("drop",ev=>{ ev.preventDefault(); schicken(ev.dataTransfer.files,art,zone); });
            feld.addEventListener("change",()=>schicken(feld.files,art,zone));
          });
          async function schicken(dateien,art,zone){
            const text=zone.querySelector(".ablage-text b");
            const alt=text.textContent;
            let n=0;
            for(const f of dateien){
              if(f.size>GRENZE){ alert('"'+f.name+'" ist größer als 10 MB und wurde übersprungen.'); continue; }
              text.textContent="Lade "+f.name+" …";
              try{
                const daten=await lesen(f);
                const a=await fetch("/buchhaltung/beleg/hochladen",{method:"POST",
                  headers:{"Content-Type":"application/json"},
                  body:JSON.stringify({art:art,dateiname:f.name,dateityp:f.type,datenBase64:daten})});
                if(!a.ok) throw new Error("Server "+a.status);
                n++;
              }catch(err){ alert("Hochladen von "+f.name+" fehlgeschlagen: "+err.message); }
            }
            text.textContent=alt;
            if(n) location.reload();
          }
        })();
        </script>`,
      }) + "</body></html>");
    } catch (err) { next(err); }
  });

  app.post("/buchhaltung/buchen", nurAdmin, async (req, res, next) => {
    try {
      const r = await buch.buchen(req.nutzer, req.body || {});
      res.redirect("/buchhaltung" + (r.ok ? "" : "?fehler=betrag"));
    } catch (err) { next(err); }
  });

  app.post("/buchhaltung/bezahlt", nurAdmin, async (req, res, next) => {
    try {
      await buch.bezahltSetzen(req.nutzer, (req.body || {}).id, true);
      res.redirect("/buchhaltung");
    } catch (err) { next(err); }
  });

  app.post("/buchhaltung/loeschen", nurAdmin, async (req, res, next) => {
    try {
      await buch.buchungLoeschen(req.nutzer, (req.body || {}).id);
      res.redirect("/buchhaltung");
    } catch (err) { next(err); }
  });

  // Beleg hochladen. Eigener Body-Parser mit hoeherem Limit — die Datei kommt als
  // base64 im JSON. Bewusst nur fuer diese eine Route, damit das globale Limit in
  // server.js unangetastet bleibt.
  app.post("/buchhaltung/beleg/hochladen", nurAdmin,
    express.json({ limit: "16mb" }), async (req, res, next) => {
      try {
        const r = await buch.belegHochladen(req.nutzer, req.body || {});
        res.json(r);
      } catch (err) { next(err); }
    });

  // Beleg ansehen — liefert die zwischengelagerte Datei aus.
  app.get("/buchhaltung/beleg/:id/datei", nurAdmin, async (req, res, next) => {
    try {
      const b = await buch.belegDatei(req.nutzer, req.params.id);
      if (!b || !b.daten) return res.status(404).send("Keine Datei vorhanden");
      res.setHeader("Content-Type", b.dateityp || "application/octet-stream");
      res.setHeader("Content-Disposition",
        `inline; filename="${String(b.dateiname || "beleg").replace(/["\\\r\n]/g, "")}"`);
      res.send(b.daten);
    } catch (err) { next(err); }
  });

  // Bestaetigen und buchen: erst die Werte festhalten, dann nach Lexware.
  app.post("/buchhaltung/beleg/buchen", nurAdmin, async (req, res, next) => {
    try {
      const b = req.body || {};
      await buch.belegWerte(req.nutzer, b.id, b);
      const r = await buch.belegBuchen(req.nutzer, b.id, lex);
      if (r.ok) return res.redirect("/buchhaltung?gebucht=" + b.id);
      return res.redirect("/buchhaltung?fehler=" + encodeURIComponent(r.grund || "unbekannt"));
    } catch (err) { next(err); }
  });

  app.post("/buchhaltung/beleg/loeschen", nurAdmin, async (req, res, next) => {
    try {
      await buch.belegLoeschen(req.nutzer, (req.body || {}).id);
      res.redirect("/buchhaltung");
    } catch (err) { next(err); }
  });
};
