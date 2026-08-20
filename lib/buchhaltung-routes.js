// Flowstate Buchhaltung — Uebersicht und Erfassung.
// Eigenes Modul, damit der Eingriff in server.js (Lukas' Datei) bei zwei Zeilen bleibt.
const express = require("express");
const { schale } = require("./schale.js");
const buch = require("./buchhaltung.js");
const leser = require("./belegleser.js");
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
  prozent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
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

  // Kennzahlen als JSON — die Buchhaltungs-Karte auf der Zentrale holt sie sich
  // hier. Eigene Route statt eines Zugriffs aus server.js heraus: der Bereich
  // liefert seine Zahlen selbst, dann bleibt der Eingriff in Lukas' Datei klein.
  //
  // Antwortet mit JSON statt einem Redirect — eine Karte, die nachlaedt, kann
  // mit einer Anmeldeseite nichts anfangen. Sie zeigt stattdessen den Hinweis.
  app.get("/api/buchhaltung/stats", async (req, res) => {
    const u = req.session && req.session.crm;
    if (!u) return res.json({ ok: false, anmeldung: true, hint: "Mit persönlichem Konto anmelden." });
    if (u.rolle !== "admin") return res.json({ ok: false, hint: "Buchhaltung sieht nur die Geschäftsführung." });
    try {
      res.json({ ok: true, ...(await buch.kennzahlen(u)) });
    } catch (e) {
      console.error("Buchhaltungs-Kennzahlen:", e.message);
      res.json({ ok: false, hint: "Buchhaltung nicht erreichbar." });
    }
  });

  app.get("/buchhaltung", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const zeitraum = buch.ZEITRAEUME[req.query.zeit] !== undefined ? req.query.zeit : "monat";
      const [d, firmen, belegeAlle, kasse, monate, exporte, erinnerung, einst] = await Promise.all([
        buch.uebersicht(u, zeitraum),
        crm.firmenListe(u, { limit: 300 }),
        buch.belegeOffen(u, null),
        buch.kontoUndSteuer(u),
        buch.monateMitDaten(u),
        buch.exportVerlauf(u),
        // Legt bei Bedarf die Montags-Erinnerung an, dass der Kontostand
        // nachgetragen werden muss. Laeuft absichtlich hier mit statt in einem
        // Zeitplaner — siehe Kommentar in buchhaltung.js.
        buch.saldoErinnerung(u),
        // Die hinterlegte Steuerkanzlei (Migration 0055, 20.08.2026). Steht im
        // Monatsordner-Kasten, weil genau dorthin der Ordner geht — und weil
        // man dort merkt, dass noch keine Adresse da ist, BEVOR Alexandra im
        // Auto danach fragt.
        buch.einstellungen(u),
      ]);
      d.belegeAlle = belegeAlle;
      // Fuer die Kundenauswahl an einer Rechnung: alphabetisch, damit man einen
      // Namen findet, statt ihn zu suchen. Leads sind mit dabei — man schreibt
      // die erste Rechnung manchmal, bevor der Status umgestellt ist.
      const kunden = [...firmen].sort((a, b) => a.name.localeCompare(b.name, "de"));

      // Ihr seid Kleinunternehmer nach §19 UStG: keine Umsatzsteuer auf eigenen
      // Rechnungen. Auf Eingangsbelegen ist aber Vorsteuer ausgewiesen, und die
      // gehoert in die Aufstellung fuer die Steuerberaterin — darum bleibt die
      // Auswahl bei Ausgaben erhalten.
      // -1 heisst "gemischt" (28.07.). Eine Supermarkt- oder Restaurantquittung
      // traegt oft 7 % UND 19 % — dafuer gab es keine richtige Antwort, und man
      // musste sich fuer eine Halbwahrheit entscheiden. Fuer euch als
      // Kleinunternehmer aendert der Satz ohnehin nichts (keine Vorsteuer), er
      // ist Dokumentation fuer die Steuerberaterin. Und die soll lesen koennen,
      // dass der Beleg gemischt war, statt einen erfundenen Satz zu sehen.
      const saetze = [0, 19, 7, -1];
      const satzLabel = (s) => (s === -1 ? "gemischt (7 % und 19 %)" : `${s} %`);

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
              <i>Rechnung vom ${datum(o.datum)}${o.faellig
                ? " · " + (ueber ? `<b class="spaet">${o.tage_ueber} Tage überfällig</b>` : "fällig " + datum(o.faellig))
                : ""}</i></span>
            <span class="lz-wert">${geldGenau(o.betrag)}</span>
            <form method="post" action="/buchhaltung/bezahlt" class="lz-tat lz-bezahlt"
              data-jahr="${o.datum ? new Date(o.datum).getFullYear() : ""}">
              <input type="hidden" name="id" value="${o.id}">
              <input type="date" name="bezahlt_am" value="${o.datum ? datumFeld(o.datum) : heuteFeld()}"
                max="${heuteFeld()}"
                title="Zahltag — danach richtet sich der Monatsordner. Vorbelegt mit dem Rechnungsdatum; das passt, solange Rechnung und Zahlung im selben Jahr liegen. Zahlt der Kunde erst im neuen Jahr, trag den echten Tag ein."
                aria-label="Zahltag">
              <button type="submit" class="sekundaer klein" title="Als bezahlt markieren">${ICON.check}</button>
            </form>
            <form method="post" action="/buchhaltung/loeschen" class="lz-tat"
              onsubmit="return confirm('Rechnung über ${geldGenau(o.betrag)} aus den offenen Rechnungen nehmen?\\n\\nDie Rechnung wandert zurück in „Rechnungen an Kunden“ und wartet dort auf Prüfung. Die Datei bleibt erhalten.')">
              <input type="hidden" name="id" value="${o.id}">
              <button type="submit" class="still klein"
                title="Doch nicht bezahlt oder falsch erfasst — raus aus der Liste. Der Beleg bleibt erhalten.">${ICON.x}</button>
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
      //
      // Der Ablauf in der Maske: Datei ablegen -> die Werte werden aus dem Bild
      // gelesen und stehen schon in den Feldern -> gegenlesen -> "Passt".
      // Nichts wird ohne diesen Knopf gebucht.
      // Eine Zeile je Beleg. Als Funktion herausgezogen, weil sie jetzt an zwei
      // Stellen steht: offen und ausgeklappt.
      const belegZeile = (b, ein, kat, uSaetze) => {
            const offen = b.status !== "gebucht";
            const wartet = ein && b.status === "gebucht" && b.buchung_bezahlt === false;
            return `<div class="beleg ${b.status}">
              <div class="beleg-kopf">
                <span class="lz-punkt ${b.status === "gebucht" ? (wartet ? "offen" : "fertig") : b.status === "fehler" ? "fehler" : "offen"}"></span>
                <span class="beleg-name">${e(b.dateiname)}
                  <i>Nr. ${b.laufnummer ?? "–"}${b.wer ? " · " + e((b.wer || "").split(" ")[0]) : ""}${b.groesse ? " · " + Math.round(b.groesse / 1024) + " KB" : ""}</i></span>
                ${b.status === "gebucht"
                  ? (wartet
                      ? `<span class="badge b-bernstein" title="Steht unter „Offene Rechnungen“. Sobald der Kunde zahlt, dort abhaken.">wartet auf Zahlung</span>`
                      : `<span class="badge b-gruen" title="Gebucht und archiviert. Kommt in den Monatsordner${b.bezahlt_am ? " " + new Date(b.bezahlt_am).toLocaleDateString("de-DE", { month: "long", year: "numeric" }) : ""}.">gebucht</span>`)
                  : `<span class="badge b-bernstein">zu prüfen</span>`}
                ${offen ? `<form method="post" action="/buchhaltung/beleg/verwerfen" class="lz-tat"
                    onsubmit="var g=prompt('Warum wird dieser Beleg verworfen? (Fehlscan, Doppel, privat …)');
                              if(!g||g.trim().length<3){return false} this.grund.value=g; return true;">
                  <input type="hidden" name="id" value="${b.id}">
                  <input type="hidden" name="grund" value="">
                  <button type="submit" class="still klein" title="Verwerfen — der Beleg bleibt nachweisbar, zählt aber nicht mit">${ICON.x}</button></form>` : ""}
              </div>
              ${b.fehler_text ? `<div class="beleg-fehler">${ICON.warnung} ${e(b.fehler_text)}</div>` : ""}
              ${offen && b.lese_hinweis ? `<div class="beleg-hinweis">${ICON.info} ${e(b.lese_hinweis)}</div>` : ""}
              ${offen ? `<form method="post" action="/buchhaltung/beleg/buchen" class="beleg-pruefen">
                <input type="hidden" name="id" value="${b.id}">
                <div class="beleg-felder">
                  <label>Betrag brutto (€)
                    <input name="betrag" required inputmode="decimal" placeholder="0,00"
                      value="${b.betrag !== null ? String(b.betrag).replace(".", ",") : ""}"></label>
                  <label>${ein ? "Rechnungsdatum" : "Belegdatum"}
                    <input type="date" name="datum" required value="${b.datum ? datumFeld(b.datum) : heuteFeld()}"></label>
                  <label>USt ${uSaetze.length === 1
                    ? `<input value="0 % · Kleinunternehmer" disabled title="Als Kleinunternehmer nach §19 UStG weist ihr auf eigenen Rechnungen keine Umsatzsteuer aus.">
                       <input type="hidden" name="steuersatz" value="0">`
                    : `<select name="steuersatz">
                        ${uSaetze.map((s) => `<option value="${s}" ${Number(b.steuersatz) === s || (b.steuersatz === null && s === uSaetze[0]) ? "selected" : ""}>${satzLabel(s)}</option>`).join("")}
                       </select>`}</label>
                  ${ein
                    ? // Feste Auswahl statt freiem Text: nur so weiss die Rechnung,
                      // zu welcher Kundenakte sie gehoert. Ein getippter Name
                      // stimmt beim naechsten Mal um ein Leerzeichen nicht mehr
                      // ueberein, und die Rechnung haengt im Nichts.
                      `<label>Kunde <select name="firma_id" required>
                        <option value="">— Kunde wählen —</option>
                        ${kunden.map((k) => `<option value="${k.id}"
                          ${String(b.firma_id || "") === String(k.id)
                            || (!b.firma_id && b.gegenstelle && b.gegenstelle.trim() === k.name.trim()) ? "selected" : ""}
                          >${e(k.name)}</option>`).join("")}
                      </select></label>
                       <!-- Wofür die Rechnung steht. Daran hängt, gegen welchen
                            Stand in der Kundenakte sie verrechnet wird — sonst
                            zählte eine hochgeladene Monatsrechnung neben dem
                            Zähler in der Akte doppelt. -->
                       <label>Wofür?
                        <select name="fuer_position">
                          <option value="setup" ${b.fuer_position !== "monatlich" ? "selected" : ""}>Setup / Projekt</option>
                          <option value="monatlich" ${b.fuer_position === "monatlich" ? "selected" : ""}>Retainer — ein Monat</option>
                        </select></label>`
                    : `<label>Lieferant
                        <input name="gegenstelle" placeholder="z. B. Shell, Ikea"
                          value="${e(b.gegenstelle || "")}"></label>`}
                  <label>Kategorie <select name="kategorie">
                    ${kat.map((k) => `<option ${b.kategorie === k ? "selected" : ""}>${e(k)}</option>`).join("")}
                  </select></label>
                  ${ein
                    ? `<label>Zahlungsziel <input type="date" name="faellig" value="${b.faellig ? datumFeld(b.faellig) : ""}"></label>
                       <label>Schon bezahlt am
                         <input type="date" name="bezahlt_am" max="${heuteFeld()}"
                           title="Nur ausfüllen, wenn das Geld schon da ist. Dann zählt die Rechnung sofort als Einnahme — im Monat der Zahlung. Leer lassen, wenn der Kunde noch nicht gezahlt hat.">
                       </label>`
                    : `<label>Belegnummer <input name="belegnummer" placeholder="optional" value="${e(b.belegnummer || "")}"></label>`}
                </div>
                ${ein ? `<p class="caption beleg-merk">${ICON.info}
                  „Schon bezahlt am" nur ausfüllen, wenn das Geld schon eingegangen ist —
                  dann zählt die Rechnung im Monat der Zahlung. Leer lassen heißt:
                  sie wartet unter „Offene Rechnungen".</p>` : ""}
                <div class="beleg-fuss">
                  ${b.hat_datei ? `<a href="/buchhaltung/beleg/${b.id}/datei" target="_blank" class="caption">Beleg ansehen ↗</a>` : `<span class="caption">Keine Datei</span>`}
                  <button type="submit" class="dunkel">${ICON.check} Passt${ein ? "" : " — buchen"}</button>
                </div>
              </form>` : `<div class="beleg-fertig">
                ${geldGenau(b.betrag)} · ${e(b.kategorie || "ohne Kategorie")}${b.datum ? " · " + datum(b.datum) : ""}
                ${b.gegenstelle ? " · " + e(b.gegenstelle) : ""}
                ${wartet ? " · noch nicht bezahlt" : b.bezahlt_am ? " · Zahltag " + datum(b.bezahlt_am) : ""}</div>`}
            </div>`;
      };

      // Der Kasten zum Ablegen — darunter die Belege.
      //
      // Ausklappbar seit dem 28.07.: Beim Einpflegen eines ganzen Jahres stehen
      // hier schnell dreissig Belege untereinander, und die Ablage zum Hochladen
      // des naechsten rutscht ausser Sicht. Man laedt aber nicht einmal etwas
      // hoch, sondern zwanzigmal hintereinander.
      //
      // Die Teilung folgt der Arbeit, nicht dem Datum: Was NOCH ZU PRUEFEN ist,
      // steht immer offen — das ist die Arbeit, die auf dich wartet, und sie zu
      // verstecken waere der Fehler. Was gebucht ist, klappt zu; es ist erledigt
      // und wird nur noch nachgeschlagen.
      //
      // <details> und nicht ein eigener Umschalter: Es klappt ohne JavaScript,
      // laesst sich mit der Tastatur bedienen, und der Browser findet beim
      // Suchen (Strg+F) auch zugeklappten Text.
      const belegKasten = (art) => {
        const ein = art === "einnahme";
        const liste = d.belegeAlle.filter((b) => (b.art || "ausgabe") === art);
        const neu = liste.filter((b) => b.status !== "gebucht");
        const fertig = liste.filter((b) => b.status === "gebucht");
        const kat = ein ? buch.EINNAHME_KATEGORIEN : buch.AUSGABE_KATEGORIEN;
        // Eigene Rechnungen tragen als Kleinunternehmer keine Umsatzsteuer.
        // Auf Eingangsbelegen steht sehr wohl welche — die notieren wir mit.
        const uSaetze = ein ? [0] : saetze;
        const wartend = fertig.filter((b) => ein && b.buchung_bezahlt === false).length;
        return `<div class="karte"><div class="karte-kopf"><div>
          <h2>${ein ? "Rechnungen an Kunden" : "Quittungen &amp; Eingangsrechnungen"}</h2>
          <div class="sub">${ein
            ? "Rechnung hochladen — sie steht dann unter „Offene Rechnungen“, bis der Kunde zahlt"
            : "Tankbelege, Einkäufe, Rechnungen von Lieferanten"}</div></div>
          ${neu.length ? `<span class="badge b-bernstein">${neu.length} zu prüfen</span>` : ""}</div>
          <div class="ablage" data-art="${art}" id="ablage-${art}">
            <div class="ablage-icon">${ICON.ordner}</div>
            <div class="ablage-text"><b>${ein ? "Rechnung" : "Beleg"} hier ablegen</b>
              <span class="caption">${leser.bereit()
                ? "PDF oder Foto — die Werte werden ausgelesen, du prüfst nur nach"
                : "PDF, Foto oder Screenshot — oder klicken zum Auswählen"}</span></div>
            <input type="file" id="feld-${art}" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" multiple hidden>
          </div>

          ${neu.length ? `<div class="beleg-liste">
            ${neu.map((b) => belegZeile(b, ein, kat, uSaetze)).join("")}
          </div>` : ""}

          ${fertig.length ? `<details class="beleg-mehr">
            <summary>
              <span class="beleg-mehr-titel">${fertig.length} ${fertig.length === 1 ? "gebuchter Beleg" : "gebuchte Belege"}</span>
              ${wartend ? `<span class="badge b-bernstein">${wartend} wartet auf Zahlung</span>` : ""}
              <span class="caption beleg-mehr-hinweis">anzeigen</span>
            </summary>
            <div class="beleg-liste">
              ${fertig.map((b) => belegZeile(b, ein, kat, uSaetze)).join("")}
            </div>
            ${/* Die Abfrage in buchhaltung.js holt hoechstens 40 Belege. Wer laenger
                 zurueck will, geht in den Monatsordner — das hier ist der Eingang,
                 nicht das Archiv. Lieber sagen als so tun, als waere das alles. */""}
            ${liste.length >= 40 ? `<p class="caption beleg-mehr-fuss">${ICON.info}
              Hier stehen die neuesten Belege. Ältere liegen in den Monatsordnern weiter unten.</p>` : ""}
          </details>` : ""}

          ${liste.length ? "" : `<p class="caption">Noch kein ${ein ? "Rechnungs" : "Beleg"}eingang.</p>`}
        </div>`;
      };

      // ---------- Monatsordner für die Steuerberaterin ----------
      // Ein ZIP je Monat: Übersicht als CSV und HTML, die Belegdateien, dazu die
      // Prüfsummen. Maßgeblich ist der Zahltag, nicht das Rechnungsdatum —
      // darum steht eine unbezahlte Rechnung in keinem Ordner.
      const jetzt = new Date();
      const laufend = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, "0")}`;

      // ---------- Steuerkanzlei (20.08.2026) ----------
      //
      // Bis hierher stand die Adresse der Kanzlei NIRGENDS. Alexandra kann den
      // Monatsordner verschicken, musste aber jedes Mal fragen, an wen — und
      // eine Adresse zu raten kommt nicht in Frage: Das waere die komplette
      // Buchhaltung an einen Fremden.
      //
      // Die Zeile steht bewusst UNTER den Monatsordnern statt in einem eigenen
      // Kasten: Wer hier den Ordner holt, ist gerade dabei, ihn wegzuschicken.
      // Genau da gehoert die Frage hin, an wen.
      const kanzleiName = [einst.steuer_anrede, einst.steuer_name].filter(Boolean).join(" ");
      const kanzleiDa = buch.mailGueltig(einst.steuer_mail);
      // Inline gestylt statt ueber crm.css: Diese eine Zeile ist es nicht wert,
      // dass zwei Dateien gleichzeitig deployt werden muessen.
      const kanzleiZeile = `<div style="display:flex;align-items:center;justify-content:space-between;
          gap:12px;flex-wrap:wrap;margin-top:10px;padding-top:12px;border-top:1px solid var(--line,#e5e5e5)">
        <p class="caption" style="margin:0;flex:1 1 240px">
          ${kanzleiDa
            ? `Alexandra schickt den Ordner an <b>${e(kanzleiName || einst.steuer_mail)}</b>
               <span class="caption">· ${e(einst.steuer_mail)}</span>`
            : `<b>Noch keine Steuerkanzlei hinterlegt.</b> Solange hier nichts steht,
               fragt Alexandra jedes Mal im Gespräch nach der Adresse, statt sie zu raten.`}
        </p>
        <button type="button" class="knopf sekundaer klein"
          onclick="document.getElementById('dlg-kanzlei').showModal()">
          ${kanzleiDa ? "Kanzlei ändern" : "Kanzlei eintragen"}</button>
      </div>`;

      const ordnerKasten = `<div class="karte"><div class="karte-kopf"><div>
        <h2>Monatsordner</h2>
        <div class="sub">Alles für die Steuerberaterin, ein Monat pro Datei</div></div>
        ${ICON.ordner ? `<span class="kachel-icon">${ICON.ordner}</span>` : ""}</div>
        ${monate.length ? `<div class="bh-ordner">
          ${monate.map((m) => {
            const key = `${m.jahr}-${String(m.monat).padStart(2, "0")}`;
            const istLaufend = key === laufend;
            const schonExportiert = exporte.find((x) => x.jahr === m.jahr && x.monat === m.monat);
            return `<div class="bh-ordner-zeile${istLaufend ? " laufend" : ""}">
              <div class="bh-ordner-monat"><b>${buch.MONATSNAME[m.monat - 1]} ${m.jahr}</b>
                <span class="caption">${m.anzahl} Bewegung${m.anzahl === 1 ? "" : "en"} ·
                  ${geld(m.ein)} ein · ${geld(m.aus)} aus${istLaufend ? " · läuft noch" : ""}</span></div>
              <div class="bh-ordner-tat">
                ${schonExportiert ? `<span class="caption" title="Zuletzt geholt am ${datum(schonExportiert.erstellt)}">schon geholt</span>` : ""}
                <a class="knopf sekundaer klein" href="/buchhaltung/monat/${m.jahr}/${m.monat}/ansehen"
                   target="_blank" title="Übersicht im Browser ansehen">Ansehen</a>
                <a class="knopf dunkel klein" href="/buchhaltung/monat/${m.jahr}/${m.monat}/ordner"
                   title="ZIP mit Übersicht und allen Belegdateien">${ICON.ab} Ordner holen</a>
              </div></div>`;
          }).join("")}
        </div>` : `<p class="caption">Noch keine bezahlten Bewegungen — sobald etwas gebucht
          und bezahlt ist, erscheint hier der Monat.</p>`}
        <p class="caption bh-ordner-fuss">${ICON.info}
          Eine Rechnung erscheint in dem Monat, in dem der Kunde <b>gezahlt</b> hat —
          nicht in dem, in dem sie geschrieben wurde. Offene Rechnungen sind in keinem
          Ordner, denn es ist noch kein Geld geflossen.</p>
        ${kanzleiZeile}
      </div>`;

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
            <input name="gegenstelle" placeholder="${ein ? "oder Name frei eintragen" : "z. B. Adobe, Meta, Shell"}"></div>
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
        ${leser.bereit()
          ? `<div class="hinweis info" style="margin-bottom:16px">${ICON.info}<div>
              <strong>Beleg ablegen, kurz gegenlesen, „Passt“ — fertig.</strong>
              Betrag, Datum, Lieferant und Kategorie werden aus dem Bild gelesen und stehen
              schon in den Feldern. Die Datei bleibt hier im Archiv: unveränderbar, mit
              Prüfsumme und laufender Nummer. Am Monatsende holst du unten den Monatsordner
              und schickst ihn der Steuerberaterin.</div></div>`
          : `<div class="hinweis warn" style="margin-bottom:16px">${ICON.warnung}<div>
              <strong>Belege werden noch nicht automatisch ausgelesen.</strong>
              Dafür fehlt <code>ANTHROPIC_API_KEY</code> in der <code>.env</code>. Alles andere
              funktioniert: hochladen, Werte von Hand eintragen, buchen, Monatsordner holen.</div></div>`}

        ${erinnerung.faellig ? `<div class="hinweis warn" style="margin-bottom:16px">${ICON.warnung}<div>
            <strong>Kontostand ist ${erinnerung.tageAlt === null ? "noch nie eingetragen"
              : `${erinnerung.tageAlt} Tage alt`}.</strong>
            Schau einmal ins Online-Banking und trag den Stand unten ein — dann stimmt die
            Zahl wieder.${erinnerung.angelegt ? " Ich habe dir dafür eine Aufgabe für Montag angelegt." : ""}
          </div></div>` : ""}

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

        <div class="kasse-reihe">
          <div class="kasse ${kasse.stand < 0 ? "minus" : ""}">
            <div class="kasse-kopf"><span>Aktueller Kontostand</span>${ICON.euro}</div>
            <div class="kasse-zahl">${kasse.stand < 0 ? "−" : ""}${geld(Math.abs(kasse.stand))}</div>
            <div class="kasse-fuss">${kasse.saldo_stand
              ? `Eingetragen: ${geld(kasse.start)} am ${datum(kasse.saldo_stand)}${
                  erinnerung.tageAlt >= 7 ? ` <b>· ${erinnerung.tageAlt} Tage alt</b>` : ""}
                 <span class="kasse-rechnung">+ ${geld(kasse.bewegung_ein)} rein · − ${geld(kasse.bewegung_aus)} raus seitdem</span>`
              : `<b>Noch nie eingetragen</b>
                 <span class="kasse-rechnung">Trag deinen heutigen Kontostand ein, dann läuft er mit</span>`}</div>
            <button type="button" class="kasse-knopf" onclick="document.getElementById('dlg-kasse').showModal()">
              ${kasse.saldo_stand ? "Kontostand nachtragen" : "Kontostand eintragen"}</button>
          </div>
          <div class="kasse steuer">
            <div class="kasse-kopf"><span>Steuern zurücklegen</span>${ICON.prozent}</div>
            <div class="kasse-zahl">${geld(kasse.ruecklage)}</div>
            <div class="kasse-fuss">${kasse.satz} % vom Gewinn ${new Date().getFullYear()}
              <span class="kasse-rechnung">${geld(kasse.jahr_ein)} rein − ${geld(kasse.jahr_aus)} raus =
                <b>${kasse.gewinn < 0 ? "−" : ""}${geld(Math.abs(kasse.gewinn))} Gewinn</b></span></div>
            <div class="kasse-frei">Frei verfügbar: <b>${kasse.frei < 0 ? "−" : ""}${geld(Math.abs(kasse.frei))}</b></div>
          </div>
        </div>

        <div class="kacheln">
          ${kachel("Einnahmen", geld(d.summe.einnahmen), ICON.auf, "gruen",
            `<span class="caption">${d.summe.anzahl_einnahmen} bezahlt · offene Rechnungen zählen nicht</span>`)}
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

        <div style="margin-top:16px">${ordnerKasten}</div>

        ${dialog("ausgabe")}
        ${dialog("einnahme")}
        <dialog id="dlg-kasse"><form method="post" action="/buchhaltung/kasse">
          <div class="todo-dlg-kopf"><div><h2>Kontostand &amp; Steuersatz</h2>
            <div class="sub">Einmal pro Woche aus dem Online-Banking ablesen und hier eintragen</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="feld-paar">
            <div class="feld"><label>Kontostand (€)</label>
              <input name="start_saldo" inputmode="decimal" placeholder="z. B. 12500,00"
                value="${kasse.start ? String(kasse.start).replace(".", ",") : ""}"></div>
            <div class="feld"><label>Stand vom</label>
              <input type="date" name="saldo_stand" value="${heuteFeld()}"></div>
          </div>
          <p class="caption" style="margin:-4px 0 12px">Ab diesem Tag rechnet die Übersicht deine
            Buchungen dazu: eingetragener Stand + bezahlte Einnahmen − Ausgaben. Buchungen davor
            bleiben außen vor, sie stecken ja schon im eingetragenen Stand.
            Es gibt keine Bankschnittstelle, die den Stand von allein holt — darum die Erinnerung
            montags, sobald der Eintrag eine Woche alt ist.</p>
          <div class="feld"><label>Steuersatz für die Rücklage (%)</label>
            <input name="steuersatz" inputmode="decimal" value="${String(kasse.satz).replace(".", ",")}"></div>
          <p class="caption" style="margin:-4px 0 12px">Rechnet ${kasse.satz} % vom <b>Gewinn</b> des laufenden
            Jahres, nicht vom Umsatz. Der echte Satz hängt von Rechtsform und Gewinnhöhe ab — frag im Zweifel
            die Steuerkanzlei.</p>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">Speichern</button></div>
        </form></dialog>

        <!-- Steuerkanzlei (20.08.2026). Einmal eintragen statt jedes Mal
             diktieren: Alexandra liest die Adresse hier heraus, wenn sie den
             Monatsordner verschicken soll. Steht sie nicht drin, fragt sie
             nach — sie raet keine. -->
        <dialog id="dlg-kanzlei"><form method="post" action="/buchhaltung/kanzlei">
          <div class="todo-dlg-kopf"><div><h2>Steuerkanzlei</h2>
            <div class="sub">Wohin der Monatsordner geht</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="feld-paar">
            <div class="feld"><label>Anrede</label>
              <select name="steuer_anrede">
                <option value="" ${einst.steuer_anrede ? "" : "selected"}>— keine —</option>
                <option value="Frau" ${einst.steuer_anrede === "Frau" ? "selected" : ""}>Frau</option>
                <option value="Herr" ${einst.steuer_anrede === "Herr" ? "selected" : ""}>Herr</option>
              </select></div>
            <div class="feld"><label>Name</label>
              <input name="steuer_name" placeholder="z. B. Meier" value="${e(einst.steuer_name)}"></div>
          </div>
          <p class="caption" style="margin:-4px 0 12px">Anrede und Name stehen getrennt, weil
            Alexandra den Satz ausspricht: „Soll ich sie an <b>Frau Meier</b> schicken?“
            Ohne Anrede sagt sie „an Meier“ — sie setzt keine dazu, die nicht hier steht.</p>
          <div class="feld"><label>E-Mail *</label>
            <input type="email" name="steuer_mail" inputmode="email" placeholder="kanzlei@beispiel.de"
              value="${e(einst.steuer_mail)}"></div>
          <p class="caption" style="margin:-4px 0 12px">An diese Adresse geht der Monatsordner.
            Eine Adresse ohne @ und Endung wird nicht gespeichert — sonst ginge die Mail ins Leere
            und würde trotzdem als verschickt gelten.</p>
          <div class="feld"><label>Notiz</label>
            <textarea name="steuer_notiz" rows="3"
              placeholder="Kanzlei, Anschrift, Mandantennummer">${e(einst.steuer_notiz)}</textarea></div>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">Speichern</button></div>
        </form></dialog>
        <script>
        (function(){
          // Jahreswechsel-Netz. Eine Rechnung vom Dezember, die der Kunde im
          // Januar bezahlt, ist eine Einnahme des NEUEN Jahres — das Geld war im
          // alten schlicht noch nicht da. Innerhalb eines Jahres ist die
          // Verschiebung folgenlos, ueber die Jahresgrenze nicht. Darum wird nur
          // hier nachgefragt, sonst nie.
          document.querySelectorAll("form.lz-bezahlt").forEach(function(f){
            f.addEventListener("submit",function(ev){
              const rechnungsJahr=f.dataset.jahr;
              const feld=f.querySelector('input[name="bezahlt_am"]');
              if(!rechnungsJahr||!feld||!feld.value) return;
              const heuteJahr=String(new Date().getFullYear());
              const gewaehlt=feld.value.slice(0,4);
              // Nur warnen, wenn das eingetragene Jahr vom laufenden abweicht —
              // also genau dann, wenn womoeglich ins falsche Steuerjahr gebucht wird.
              if(gewaehlt===heuteJahr) return;
              const ok=confirm(
                "Achtung: Du buchst diese Zahlung auf "+gewaehlt+", wir haben aber "+heuteJahr+".\\n\\n"+
                "Eine Zahlung zählt in dem Jahr, in dem das Geld eingegangen ist. "+
                "Ist das Geld wirklich noch "+gewaehlt+" gekommen?\\n\\n"+
                "OK = so buchen · Abbrechen = Datum korrigieren");
              if(!ok) ev.preventDefault();
            });
          });

          const GRENZE=20*1024*1024;      // 20 MB je Datei
          const LESEGRENZE=3.4*1024*1024; // darueber kann der Lesedienst nicht mehr
          const MAX_KANTE=2400;           // laengste Bildkante nach dem Verkleinern

          // Handyfotos sind oft 4–8 MB gross. Der Lesedienst nimmt Bilder nur bis
          // rund 3,5 MB an — ein unveraendert hochgeladenes Foto liesse sich also
          // ablegen, aber nicht auslesen, und man muesste alles abtippen.
          //
          // Darum wird ein zu grosses Bild hier im Browser verkleinert, bevor es
          // ueberhaupt losgeht. 2400 Pixel auf der langen Kante sind fuer eine
          // Quittung von etwa 8 cm Breite ueber 700 dpi — weit mehr, als zum
          // Lesen noetig ist, und deutlich ueber allem, was fuer eine bildliche
          // Wiedergabe verlangt wird.
          //
          // PDFs bleiben unangetastet: die sind schon klein und duerfen ohnehin
          // nicht neu gerechnet werden.
          async function verkleinern(f){
            if(!f.type.startsWith("image/")||f.size<=LESEGRENZE) return f;
            try{
              const bild=await createImageBitmap(f);
              const faktor=Math.min(1,MAX_KANTE/Math.max(bild.width,bild.height));
              const b=document.createElement("canvas");
              b.width=Math.round(bild.width*faktor);
              b.height=Math.round(bild.height*faktor);
              b.getContext("2d").drawImage(bild,0,0,b.width,b.height);
              bild.close&&bild.close();
              const klein=await new Promise(fertig=>b.toBlob(fertig,"image/jpeg",0.9));
              // Nur uebernehmen, wenn es wirklich kleiner geworden ist.
              if(!klein||klein.size>=f.size) return f;
              klein.name=f.name.replace(/\.[^.]+$/,"")+".jpg";
              return klein;
            }catch(err){
              // HEIC kann der Browser nicht zeichnen. Dann eben unveraendert
              // hochladen — der Beleg ist gesichert, der Hinweis in der
              // Pruefmaske erklaert, warum die Felder leer bleiben.
              return f;
            }
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
          // Zwei Schritte je Datei, absichtlich getrennt:
          //   1. hochladen  — geht schnell, danach ist der Beleg sicher abgelegt
          //   2. auslesen   — dauert ein paar Sekunden
          // Warum getrennt: scheitert das Auslesen oder ist es langsam, ist die
          // Datei trotzdem schon im Archiv. Ein einziger langer Aufruf wuerde
          // beides zusammen verlieren.
          const LESEN=${leser.bereit() ? "true" : "false"};
          async function schicken(dateien,art,zone){
            const text=zone.querySelector(".ablage-text b");
            const alt=text.textContent;
            let n=0, doppelt=0;
            for(const f of dateien){
              if(f.size>GRENZE){ alert('"'+f.name+'" ist größer als 20 MB und wurde übersprungen.'); continue; }
              let id=null;
              try{
                text.textContent="Bereite "+f.name+" vor …";
                const datei=await verkleinern(f);
                const name=datei.name||f.name;
                text.textContent="Lade "+name+" …";
                const a=await fetch("/buchhaltung/beleg/hochladen",{method:"POST",
                  headers:{
                    "Content-Type":"application/octet-stream",
                    "X-Art":art,
                    // Kopfzeilen vertragen nur ASCII — Umlaute im Dateinamen
                    // muessen kodiert werden, sonst bricht die Anfrage ab.
                    "X-Dateiname":encodeURIComponent(name),
                    "X-Dateityp":datei.type||f.type||"application/octet-stream",
                  },
                  body:datei});
                if(a.status===413) throw new Error("Datei zu groß für den Server");
                if(!a.ok) throw new Error("Server "+a.status);
                const r=await a.json();
                if(r.doppelt){ doppelt++; continue; }
                if(!r.ok) throw new Error(r.grund||"unbekannt");
                id=r.id; n++;
              }catch(err){ alert("Hochladen von "+f.name+" fehlgeschlagen: "+err.message); continue; }

              if(LESEN&&id){
                text.textContent="Lese "+f.name+" …";
                try{
                  await fetch("/buchhaltung/beleg/lesen",{method:"POST",
                    headers:{"Content-Type":"application/json"},
                    body:JSON.stringify({id:id})});
                }catch(err){ /* Absicht: der Beleg liegt schon sicher im Archiv.
                                Ohne gelesene Werte sind die Felder eben leer. */ }
              }
            }
            text.textContent=alt;
            if(doppelt) alert(doppelt===1
              ? "Diese Datei liegt schon im Belegeingang — sie wurde nicht doppelt abgelegt."
              : doppelt+" Dateien lagen schon im Belegeingang und wurden nicht doppelt abgelegt.");
            if(n||doppelt) location.reload();
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

  app.post("/buchhaltung/kasse", nurAdmin, async (req, res, next) => {
    try {
      await buch.einstellungenSetzen(req.nutzer, req.body || {});
      res.redirect("/buchhaltung");
    } catch (err) { next(err); }
  });

  // Steuerkanzlei speichern (20.08.2026). Eigenes Formular, eigener Endpunkt:
  // Ein Formular schickt nur seine eigenen Felder mit, und so kann das
  // Speichern der Kanzlei den Kontostand nicht anfassen — und umgekehrt.
  //
  // Eine ungueltige Mailadresse wird nicht gespeichert; der Rest schon. Das
  // Ergebnis steht danach in der Zeile unter den Monatsordnern: Wer sich
  // vertippt hat, sieht dort weiter "noch keine Kanzlei hinterlegt".
  app.post("/buchhaltung/kanzlei", nurAdmin, async (req, res, next) => {
    try {
      const r = await buch.einstellungenSetzen(req.nutzer, req.body || {});
      if (r && r.grund === "migration-fehlt") {
        console.error("Steuerkanzlei: Migration 0055 ist noch nicht eingespielt.");
      }
      res.redirect("/buchhaltung" + (r && r.ok ? "" : "?fehler=" + encodeURIComponent(r?.grund || "kanzlei")));
    } catch (err) { next(err); }
  });

  // Haken bei einer offenen Rechnung. Der mitgegebene Tag entscheidet ueber den
  // Monatsordner — darum ist er ein Feld und nicht stillschweigend "heute".
  app.post("/buchhaltung/bezahlt", nurAdmin, async (req, res, next) => {
    try {
      const b = req.body || {};
      await buch.bezahltSetzen(req.nutzer, b.id, true, b.bezahlt_am || null);
      res.redirect("/buchhaltung");
    } catch (err) { next(err); }
  });

  app.post("/buchhaltung/loeschen", nurAdmin, async (req, res, next) => {
    try {
      await buch.buchungLoeschen(req.nutzer, (req.body || {}).id);
      res.redirect("/buchhaltung");
    } catch (err) { next(err); }
  });

  // Beleg hochladen.
  //
  // Die Datei kommt ROH im Rumpf, nicht als base64 in einem JSON. Der Grund ist
  // handfest: server.js registriert global express.json() ohne Groessenangabe,
  // und dessen Standard sind 100 kB. Dieser globale Parser laeuft VOR jeder
  // Route-Middleware — eine eigene, groessere Grenze an dieser Route kam also nie
  // zum Zug, und jedes Foto scheiterte mit 413.
  //
  // Mit application/octet-stream fasst express.json() die Anfrage gar nicht erst
  // an (falscher Inhaltstyp), und express.raw() hier gilt nur fuer diese Route.
  // So bleibt server.js unberuehrt. Nebenbei faellt der base64-Aufschlag von
  // einem Drittel weg.
  //
  // Die Angaben zur Datei stehen in Kopfzeilen. Der Dateiname ist dort
  // prozentkodiert, weil Kopfzeilen nur ASCII vertragen — "Tankbeleg Müller.jpg"
  // wuerde sonst unterwegs kaputtgehen.
  app.post("/buchhaltung/beleg/hochladen", nurAdmin,
    express.raw({ type: "application/octet-stream", limit: "24mb" }),
    async (req, res, next) => {
      try {
        if (!Buffer.isBuffer(req.body) || !req.body.length) {
          return res.status(400).json({ ok: false, grund: "keine-datei" });
        }
        let name = "Beleg";
        try { name = decodeURIComponent(req.get("X-Dateiname") || "") || "Beleg"; }
        catch { name = req.get("X-Dateiname") || "Beleg"; }
        const r = await buch.belegHochladen(req.nutzer, {
          art: req.get("X-Art"),
          dateiname: name,
          dateityp: req.get("X-Dateityp") || null,
          daten: req.body,
        });
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

  // Beleg auslesen. Eigener Aufruf direkt nach dem Hochladen — siehe Kommentar
  // im Seitenskript. Antwortet auch bei Misserfolg mit 200: der Beleg liegt dann
  // trotzdem im Eingang, nur ohne vorbefuellte Werte.
  app.post("/buchhaltung/beleg/lesen", nurAdmin, async (req, res, next) => {
    try {
      const r = await buch.belegLesen(req.nutzer, (req.body || {}).id);
      res.json(r);
    } catch (err) { next(err); }
  });

  // Bestaetigen: aus dem geprueften Beleg wird eine Buchung. Bei einer
  // Kundenrechnung landet sie unter "Offene Rechnungen" — bezahlt ist sie damit
  // noch nicht.
  app.post("/buchhaltung/beleg/buchen", nurAdmin, async (req, res, next) => {
    try {
      const b = req.body || {};
      await buch.belegWerte(req.nutzer, b.id, b);
      const r = await buch.belegBuchen(req.nutzer, b.id, b.bezahlt_am || null);
      if (r.ok) {
        return res.redirect("/buchhaltung?" +
          (r.offeneRechnung ? "offen=" : "gebucht=") + b.id);
      }
      return res.redirect("/buchhaltung?fehler=" + encodeURIComponent(r.grund || "unbekannt"));
    } catch (err) { next(err); }
  });

  // Verwerfen statt Loeschen — mit Grund, und der Beleg bleibt nachweisbar.
  app.post("/buchhaltung/beleg/verwerfen", nurAdmin, async (req, res, next) => {
    try {
      const b = req.body || {};
      const r = await buch.belegVerwerfen(req.nutzer, b.id, b.grund);
      if (r.ok) return res.redirect("/buchhaltung");
      return res.redirect("/buchhaltung?fehler=" + encodeURIComponent(r.grund || "unbekannt"));
    } catch (err) { next(err); }
  });

  // ---------- Monatsordner ----------

  // Die Uebersicht im Browser ansehen, ohne gleich das ZIP zu ziehen. Praktisch
  // zum Gegenlesen, bevor etwas rausgeht.
  app.get("/buchhaltung/monat/:jahr/:monat/ansehen", nurAdmin, async (req, res, next) => {
    try {
      const d = await buch.monatsDaten(req.nutzer, req.params.jahr, req.params.monat);
      if (!d) return res.status(400).send("Ungültiger Zeitraum");
      if (!d.zeilen.length) {
        return res.send(`<!doctype html><meta charset="utf-8"><body style="font:15px sans-serif;margin:40px">
          <p>Für ${e(buch.MONATSNAME[d.monat - 1])} ${d.jahr} ist noch nichts bezahlt worden —
          darum gibt es hier nichts zu zeigen.</p></body>`);
      }
      const r = await buch.monatsVorschau(req.nutzer, d);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(r);
    } catch (err) { next(err); }
  });

  // Das ZIP fuer die Steuerberaterin.
  app.get("/buchhaltung/monat/:jahr/:monat/ordner", nurAdmin, async (req, res, next) => {
    try {
      const r = await buch.monatsExport(req.nutzer, req.params.jahr, req.params.monat);
      if (!r.ok) {
        const text = r.grund === "leer"
          ? "In diesem Monat ist noch nichts bezahlt worden — es gibt nichts zu packen."
          : "Ungültiger Zeitraum.";
        return res.status(400).send(text);
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition",
        `attachment; filename="${r.dateiname.replace(/["\\\r\n]/g, "")}"`);
      res.setHeader("Content-Length", String(r.zip.length));
      res.send(r.zip);
    } catch (err) { next(err); }
  });
};
