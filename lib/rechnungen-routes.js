// Flowstate Rechnungen & Angebote — Seiten und Aktionen (05.09.2026).
//
// Eigenes Modul neben lib/buchhaltung-routes.js, damit der Eingriff in
// server.js bei einer Zeile bleibt. Alles unter /buchhaltung/rechnungen, nur
// fuer die Geschaeftsfuehrung (nurAdmin — dasselbe Muster wie in der
// Buchhaltung). Die Logik liegt in lib/rechnungen.js, das PDF in
// lib/pdf-schreiben.js. Hier steht nur, wie es aussieht und welcher Knopf
// welche Funktion ruft.
//
// Seiten
//   GET  /buchhaltung/rechnungen              Liste mit Kacheln und Filter
//   GET  /buchhaltung/rechnungen/neu          Formular (Vorlage, Positionen)
//   GET  /buchhaltung/rechnungen/:id          Vorgang: PDF-Vorschau, Zahlstand, Aktionen
//   GET  /buchhaltung/rechnungen/:id.pdf      das PDF (Entwurf frisch, gestellt eingefroren)
//   GET  /buchhaltung/rechnungen/:id/bearbeiten  nur Entwuerfe
//   GET  /angebote                            der alte Rail-Link -> Liste, Angebote
// Aktionen (POST): anlegen, aendern, stellen, senden, bezahlt, abschlag,
//   umwandeln, status, storno, duplizieren, loeschen — jede leitet zurueck auf
//   den Vorgang, mit ?ok= oder ?fehler=, und die Seite ZEIGT das (Muster
//   "sichtbar scheitern" aus buchhaltung-routes.js, 20.08.).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { schale } = require("./schale.js");
const { unternav } = require("./buchhaltung-unternav.js");
const rg = require("./rechnungen.js");
const crm = require("./crm.js");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const geld = rg.euro;
// Fuer EINGABEFELDER: immer zwei Nachkommastellen. String(850.5) ergab "850,5",
// und das las sich im Zahlungsblatt wie ein anderer Betrag (Befund 16).
const betragFeld = (n) => (Number(n) || 0).toFixed(2).replace(".", ",");
const datum = rg.datumDe;

// Cache-Stempel wie in lib/schale.js: neue Datei -> neue URL.
const stempel = new Map();
function v(datei) {
  const c = stempel.get(datei);
  if (c && Date.now() - c.zeit < 5000) return c.url;
  let url = datei;
  try { url = `${datei}?v=${Math.round(fs.statSync(path.join(__dirname, "..", "public", datei.replace(/^\//, ""))).mtimeMs).toString(36)}`; } catch {}
  stempel.set(datei, { url, zeit: Date.now() });
  return url;
}

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  warnung: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  kopie: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  pfeil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  euro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 18a6 6 0 1 1 0-12M4 10h8M4 14h8"/></svg>',
  prozent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
  stift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  beleg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 3h9l4 4v14H6zM9 12h6M9 16h6"/></svg>',
};

// ------------------------------------------------------ Sichtbar scheitern
const FEHLERTEXTE = {
  empfaenger: "<b>Nicht gespeichert.</b> Es fehlt der Name des Empfängers.",
  mail: "<b>Die Mailadresse sieht nicht vollständig aus</b> — es fehlt meist die Endung, also <code>info@firma.de</code>.",
  positionen: "<b>Nicht gespeichert.</b> Mindestens eine Position mit Titel muss drinstehen.",
  summe: "<b>Nicht gestellt.</b> Die Summe ist 0 — bitte Preise eintragen.",
  nummer: "<b>Nicht gestellt.</b> Die Nummer konnte nicht vergeben werden (Nummernkreis nicht erreichbar). Entwurf bleibt erhalten.",
  "schon-gestellt": "<b>Schon gestellt.</b> Der Vorgang hat bereits eine Nummer.",
  "nur-entwurf": "<b>Nur Entwürfe lassen sich bearbeiten oder löschen.</b> Gestellte Vorgänge bleiben, wie sie beim Kunden liegen — stornieren oder duplizieren.",
  "nicht-gefunden": "<b>Den Vorgang gibt es nicht</b> — gelöscht oder falsche Nummer.",
  "kein-mailzugang": "<b>Nicht gesendet.</b> Auf dieser Maschine ist kein Mailzugang hinterlegt (Google-Token fehlt). Der Versand läuft nur auf dem Server; die Nummer ist vergeben, das PDF liegt bereit.",
  versand: "<b>Das Verschicken hat nicht geklappt.</b> Der Vorgang ist gestellt, das PDF liegt bereit — einfach nochmal senden.",
  status: "<b>Dieser Schritt passt nicht zum aktuellen Status.</b>",
  betrag: "<b>Nicht gebucht.</b> Der Betrag fehlte oder war nicht lesbar (<code>1250</code> oder <code>1.250,00</code>).",
  zuviel: "<b>Nicht gebucht.</b> Der Betrag ist höher als der offene Rest.",
  doppelt: "<b>Nicht gebucht.</b> Diese Zahlung ist schon gebucht (Doppelbuchungsschutz).",
  "kein-auftrag": "<b>Kein Abschlag möglich.</b> Abschläge hängen an einem gestellten oder angenommenen Angebot (oder einer Rechnung im Entwurf als Auftragsrahmen).",
  prozent: "<b>Zu viel.</b> Die Abschläge zusammen überschreiten 100 % des Auftrags.",
  "kein-angebot": "<b>Das geht nur bei Angeboten.</b>",
  "kein-rechnung": "<b>Das geht nur bei Rechnungen.</b>",
  grund: "<b>Nicht storniert.</b> Ein Storno braucht einen Grund.",
  "entwurf-loeschen": "<b>Ein Entwurf wird nicht storniert, sondern gelöscht</b> — er hat noch keine Nummer verbraucht.",
  storniert: "<b>Der Vorgang ist storniert</b> und wird nicht mehr versendet.",
  "migration-fehlt": "<b>Rechnungen lassen sich hier noch nicht speichern.</b> In der Datenbank fehlt Migration 0060 — einspielen mit <code>node scripts/migrieren.js --einspielen</code>.",
  firma: "<b>Nicht gespeichert.</b> Die gewählte Firma gibt es nicht (mehr). Bitte neu auswählen.",
  "zu-gross": "<b>Nicht gespeichert.</b> Ein Betrag ist zu groß — höchstens <code>9.999.999,99</code> je Position und in der Summe.",
  "abschlag-entwurf": "<b>Erst die Abschläge klären.</b> An diesem Vorgang hängt noch ein Abschlag als Entwurf. Stellen oder löschen — sonst wird derselbe Betrag zweimal berechnet.",
  "rest-null": "<b>Nicht gestellt.</b> Nach Abzug der bereits gestellten Abschläge bleibt nichts übrig.",
  "storno-bezahlt": "<b>Nicht storniert.</b> Auf diese Rechnung ist schon Geld geflossen — das verschwindet nicht durch ein Storno. Die Rückzahlung als Ausgabe buchen und den Vorgang so stehen lassen.",
  datum: "<b>Nicht gespeichert.</b> Dieses Datum gibt es nicht — Tag oder Monat liegen außerhalb des Kalenders. Bitte im Feld <b>Datum</b> einen echten Tag auswählen.",
};
const OKTEXTE = {
  angelegt: "Entwurf angelegt. Preise prüfen, dann <b>Stellen</b> oder direkt <b>Per E-Mail senden</b>.",
  gespeichert: "Änderungen gespeichert.",
  gestellt: "Gestellt — die Nummer ist vergeben, das PDF eingefroren.",
  gesendet: "Per E-Mail verschickt.",
  abgefangen: "<b>Probemodus:</b> nicht gesendet, abgefangen und protokolliert (ADS_PROBE).",
  bezahlt: "Zahlung gebucht — die Rechnung ist vollständig bezahlt.",
  teilbezahlt: "Zahlung gebucht — Rest bleibt offen.",
  abschlag: "Abschlagsrechnung als Entwurf angelegt. Prüfen, dann stellen.",
  umgewandelt: "Rechnung aus dem Angebot angelegt (Entwurf).",
  angenommen: "Als angenommen markiert.",
  abgelehnt: "Als abgelehnt markiert.",
  storniert: "Storniert. Die Nummer bleibt vergeben.",
  dupliziert: "Kopie als Entwurf angelegt.",
  geloescht: "Entwurf gelöscht.",
  "schon-gebucht": "Diese Zahlung war schon gebucht — es wurde nichts doppelt eingetragen.",
  "gestellt-mit-abzug": "Gestellt. Die bereits berechneten Abschläge stehen als Abzug auf dem Blatt.",
};
// Object.hasOwn statt einfachem Zugriff: ?ok=constructor lieferte sonst die
// Funktion Object.prototype.constructor und druckte deren Quelltext in die
// Seite, ?fehler=__proto__ ein ganzes Prototyp-Objekt (Befund 12 des Pruefers).
const eigen = (tabelle, schluessel) => (schluessel && Object.hasOwn(tabelle, schluessel) ? tabelle[schluessel] : "");
const fehlerText = (code) => {
  if (!code) return "";
  return eigen(FEHLERTEXTE, code) || `<b>Das hat nicht geklappt.</b> Gespeichert wurde nichts. Meldung: <code>${e(code)}</code>`;
};
const hinweise = (q) => {
  const f = String((q || {}).fehler || "").slice(0, 80), o = String((q || {}).ok || "").slice(0, 40);
  const okText = eigen(OKTEXTE, o);
  // Ein Storno ist kein Erfolg, ueber den man sich freut — es bekommt den
  // ruhigen Warnton statt der gruenen Erfolgsfarbe (Befund 16).
  const okKlasse = o === "storniert" || o === "geloescht" ? "os-hinweis--info" : "os-hinweis--erfolg";
  return (f ? `<div class="os-hinweis os-hinweis--warn">${ICON.warnung}<div>${fehlerText(f)}</div></div>` : "")
    + (okText ? `<div class="os-hinweis ${okKlasse}">${o === "storniert" || o === "geloescht" ? ICON.info : ICON.check}<div>${okText}</div></div>` : "");
};
const pille = (r) => `<span class="os-pille os-pille--${r.status_farbe}">${e(r.status_text)}</span>`;
const artText = (r) => (r.art === "angebot" ? "Angebot" : (r.abschlag_von ? "Abschlagsrechnung" : "Rechnung"));
const nummerText = (r) => r.nummer || "Entwurf";
const kopfStil = `<link rel="stylesheet" href="${v("/rechnungen.css")}">`;

// Fehlt die Tabelle (Migration 0060 nicht eingespielt), soll die Seite das
// sagen — nicht mit einem 500 abbrechen.
const migrationFehlt = (err) => /relation "rechnungen" does not exist/.test(String(err && err.message));

module.exports = function (app) {
  const nurAdmin = (req, res, next) => {
    if (!req.session || !req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    if (req.nutzer.rolle !== "admin") return res.redirect("/crm");
    next();
  };
  const seite = (u, titel, unterzeile, inhalt) => schale({
    titel, unterzeile, aktiv: "buchhaltung", nutzer: u, reiter: unternav("rechnungen"),
    inhalt: `${kopfStil}<div class="rg-seite">${inhalt}</div>`,
  });

  // Der tote Rail-Link "Angebote & Rechnungen" lebt damit.
  app.get("/angebote", (req, res) => res.redirect("/buchhaltung/rechnungen?art=angebot"));

  // ------------------------------------------------------------ Liste
  app.get("/buchhaltung/rechnungen", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const filter = {
        art: ["angebot", "rechnung"].includes(req.query.art) ? req.query.art : "",
        status: String(req.query.status || "").slice(0, 20),
        firma: String(req.query.firma || "").slice(0, 12),
        suche: String(req.query.suche || "").slice(0, 80),
      };
      let k, liste, firmen;
      try {
        [k, liste, firmen] = await Promise.all([rg.kacheln(u), rg.liste(u, filter), crm.firmenListe(u, { limit: 300 })]);
      } catch (err) {
        if (!migrationFehlt(err)) throw err;
        return res.send(seite(u, "Rechnungen & Angebote", "Ausgangsrechnungen und Angebote", hinweise({ fehler: "migration-fehlt" })));
      }
      firmen = [...firmen].sort((a, b) => a.name.localeCompare(b.name, "de"));
      const q = (aend) => {
        const p = new URLSearchParams();
        for (const [kk, vv] of Object.entries({ ...filter, ...aend })) if (vv) p.set(kk, vv);
        const s = p.toString();
        return "/buchhaltung/rechnungen" + (s ? "?" + s : "");
      };
      const kacheln = `<div class="os-kacheln">
        <div class="os-kachel"><div class="os-kachel-label">Gestellt</div><div class="os-kachel-zahl">${geld(k.gestellt)}</div>
          <div class="os-kachel-fuss">${k.anzahl_gestellt} Rechnung${k.anzahl_gestellt === 1 ? "" : "en"} · ohne Entwürfe und Storno</div></div>
        <div class="os-kachel"><div class="os-kachel-label">Bezahlt</div><div class="os-kachel-zahl">${geld(k.bezahlt)}</div>
          <div class="os-kachel-fuss">${k.gestellt > 0 ? Math.round(k.bezahlt / k.gestellt * 100) + " % des Gestellten" : "noch nichts gestellt"}</div></div>
        <div class="os-kachel"><div class="os-kachel-label">Offen</div><div class="os-kachel-zahl">${geld(k.offen)}</div>
          <div class="os-kachel-fuss">${k.anzahl_offen} offen${k.anzahl_ueberfaellig ? ` · <span class="rg-ueberfaellig">${k.anzahl_ueberfaellig} überfällig</span>` : ""}</div></div>
        <div class="os-kachel"><div class="os-kachel-label">Angebote offen</div><div class="os-kachel-zahl">${geld(k.angebote_offen)}</div>
          <div class="os-kachel-fuss">${k.anzahl_angebote_offen} gestellt, noch ohne Antwort</div></div>
      </div>`;
      const filterZeile = `<div class="rg-filter">
        <nav class="os-segment" role="tablist">
          <a href="${q({ art: "" })}" class="${!filter.art ? "aktiv" : ""}">Alle</a>
          <a href="${q({ art: "angebot" })}" class="${filter.art === "angebot" ? "aktiv" : ""}">Angebote</a>
          <a href="${q({ art: "rechnung" })}" class="${filter.art === "rechnung" ? "aktiv" : ""}">Rechnungen</a>
        </nav>
        <form method="get" action="/buchhaltung/rechnungen">
          ${filter.art ? `<input type="hidden" name="art" value="${e(filter.art)}">` : ""}
          <select name="status" onchange="this.form.submit()">
            <option value="">Alle Status</option>
            <option value="offen" ${filter.status === "offen" ? "selected" : ""}>Offen (gestellt/teilbezahlt)</option>
            ${Object.entries(rg.STATUS_TEXT).map(([s, t]) => `<option value="${s}" ${filter.status === s ? "selected" : ""}>${e(t)}</option>`).join("")}
          </select>
          <select name="firma" onchange="this.form.submit()">
            <option value="">Alle Firmen</option>
            ${firmen.map((f) => `<option value="${f.id}" ${String(filter.firma) === String(f.id) ? "selected" : ""}>${e(f.name)}</option>`).join("")}
          </select>
          <input type="search" name="suche" value="${e(filter.suche)}" placeholder="Nummer, Firma, Titel …">
          <button type="submit" class="sekundaer klein">Suchen</button>
        </form>
      </div>`;
      const zeilen = liste.map((r) => `<tr onclick="location.href='${r.url}'" style="cursor:pointer">
        <td><a class="rg-zeile-link" href="${r.url}"><span class="rg-nummer ${r.nummer ? "" : "rg-entwurf"}">${e(nummerText(r))}</span>
          ${r.abschlag_nr ? `<span class="rg-sub">Abschlag ${r.abschlag_nr}${r.abschlag_prozent ? ` · ${String(r.abschlag_prozent).replace(".", ",")} %` : ""}</span>` : ""}</a></td>
        <td>${e(artText(r))}</td>
        <td><span class="zeile-titel">${e(r.firma_name || r.empfaenger.name || "—")}</span>${r.titel ? `<span class="rg-sub">${e(r.titel)}</span>` : ""}</td>
        <td>${datum(r.datum)}</td>
        <td>${r.faellig ? datum(r.faellig) : "—"}${r.ueberfaellig_tage ? `<span class="rg-sub rg-ueberfaellig">${r.ueberfaellig_tage} Tage überfällig</span>` : ""}</td>
        <td class="rg-betrag">${geld(r.summe)}${r.status === "teilbezahlt" ? `<span class="rg-sub">${geld(r.bezahlt_betrag)} bezahlt</span>` : ""}</td>
        <td>${pille(r)}</td>
      </tr>`).join("");
      const tabelle = liste.length ? `<div class="os-tabelle-huelle"><table class="os-tabelle">
        <thead><tr><th>Nummer</th><th>Art</th><th>Firma</th><th>Datum</th><th>Fällig</th><th class="rechts">Betrag</th><th>Status</th></tr></thead>
        <tbody>${zeilen}</tbody></table></div>`
        : `<div class="os-leer"><h3>${filter.art || filter.status || filter.firma || filter.suche ? "Nichts gefunden" : "Noch keine Rechnungen oder Angebote"}</h3>
            <p>${filter.art || filter.status || filter.firma || filter.suche
              ? "Für diesen Filter gibt es keinen Vorgang. Filter zurücksetzen oder einen neuen Vorgang anlegen."
              : "Ein Angebot beginnt mit einer Vorlage (Webseite, KI-Anwendung, Performance-Marketing), die Preise tippst du. Gestellt wird erst, wenn du es sagst — bis dahin ist es ein Entwurf ohne Nummer."}</p>
            <p class="rg-sub">Anlegen geht oben rechts — <b>Neues Angebot</b> oder <b>Neue Rechnung</b>.</p></div>`;
      res.send(seite(u, "Rechnungen & Angebote", "Ausgangsrechnungen, Angebote und Zahlstand", `
        <div class="os-kopf"><div><div class="os-kopf-titel">Rechnungen &amp; Angebote</div>
          <div class="os-kopf-unter">Nummern aus dem laufenden Kreis, PDF beim Stellen eingefroren, Zahlungen landen als Einnahmen in der Buchhaltung.</div></div>
          <div class="os-kopf-aktionen">
            <a class="rg-knopf sekundaer" href="/buchhaltung/rechnungen/neu?art=angebot">${ICON.plus} Neues Angebot</a>
            <a class="rg-knopf dunkel" href="/buchhaltung/rechnungen/neu?art=rechnung">${ICON.plus} Neue Rechnung</a></div></div>
        ${hinweise(req.query)}${kacheln}${filterZeile}${tabelle}`));
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------ Formular
  // Gemeinsam fuer "neu" und "bearbeiten". werte = Vorbelegung.
  function formular(u, { art, werte, firmen, id = null, vorlage = "frei", hinweisHtml = "" }) {
    const angebot = art === "angebot";
    const wort = angebot ? "Angebot" : "Rechnung";
    const emp = werte.empfaenger || {};
    const positionen = werte.positionen && werte.positionen.length ? werte.positionen : [{ titel: "", beschreibung: "", menge: 1, einheit: "pauschal", einzelpreis: null }];
    const vorlagenWahl = id ? "" : `<div class="rg-vorlage-wahl"><nav class="os-segment" role="tablist">${
      ["website", "ki", "performance", "frei"].map((k) => {
        const p = new URLSearchParams({ art, vorlage: k });
        if (werte.firma_id) p.set("firma", werte.firma_id);
        return `<a href="/buchhaltung/rechnungen/neu?${p}" class="${vorlage === k ? "aktiv" : ""}">${e(rg.VORLAGEN[k].titel || "Frei")}</a>`;
      }).join("")}</nav></div>`;
    const posZeile = (p, i) => `<tr>
      <td class="rg-pos-nr">${i + 1}</td>
      <td class="rg-pos-leistung"><input name="positionen[${i}][titel]" value="${e(p.titel)}" placeholder="Titel der Leistung" required>
        <textarea name="positionen[${i}][beschreibung]" placeholder="Beschreibung (optional)" style="margin-top:6px">${e(p.beschreibung)}</textarea></td>
      <td class="rg-pos-menge"><input name="positionen[${i}][menge]" value="${e(String(p.menge ?? 1).replace(".", ","))}" inputmode="decimal" aria-label="Menge"></td>
      <td class="rg-pos-einheit"><select name="positionen[${i}][einheit]" aria-label="Einheit">${rg.EINHEITEN.map((x) => `<option ${x === (p.einheit || "pauschal") ? "selected" : ""}>${e(x)}</option>`).join("")}</select></td>
      <td class="rg-pos-preis"><input name="positionen[${i}][einzelpreis]" value="${p.einzelpreis === null || p.einzelpreis === undefined ? "" : e(String(p.einzelpreis).replace(".", ","))}" inputmode="decimal" placeholder="0,00" aria-label="Einzelpreis"></td>
      <td class="rg-pos-gesamt" data-gesamt>—</td>
      <td class="rg-pos-weg"><button type="button" class="still klein" title="Position entfernen" aria-label="Position entfernen" onclick="rgZeileWeg(this)">${ICON.x}</button></td></tr>`;
    return `
      <div class="os-kopf"><div><div class="os-kopf-titel">${id ? `${wort} bearbeiten` : `${angebot ? "Neues Angebot" : "Neue Rechnung"}`}</div>
        <div class="os-kopf-unter">${id ? "Nur Entwürfe lassen sich ändern — gestellt wird erst auf der Vorgangsseite." : "Entwurf ohne Nummer. Die Nummer kommt beim Stellen, die Preise tippst du."}</div></div>
        <div class="os-kopf-aktionen"><a class="rg-knopf sekundaer" href="${id ? `/buchhaltung/rechnungen/${id}` : "/buchhaltung/rechnungen"}">${id ? "Zum Vorgang" : "Zur Liste"}</a></div></div>
      ${hinweisHtml}
      <form method="post" action="${id ? `/buchhaltung/rechnungen/${id}` : "/buchhaltung/rechnungen"}" id="rg-form">
        <input type="hidden" name="art" value="${art}">
        <input type="hidden" name="vorlage" value="${e(vorlage)}">
        ${werte.angebot_id ? `<input type="hidden" name="angebot_id" value="${e(werte.angebot_id)}">` : ""}
        ${werte.abschlag_von ? `<input type="hidden" name="abschlag_von" value="${e(werte.abschlag_von)}"><input type="hidden" name="abschlag_nr" value="${e(werte.abschlag_nr)}"><input type="hidden" name="abschlag_prozent" value="${e(werte.abschlag_prozent)}">` : ""}
        ${vorlagenWahl}
        <div class="rg-form-raster">
          <div class="os-gruppe"><div class="os-gruppe-titel">Empfänger</div><div class="os-gruppe-rumpf">
            <div class="os-zeile os-zeile--eingabe"><label class="os-zeile-label" for="rg-firma">Firma aus dem CRM</label>
              <select id="rg-firma" name="firma_id" ${id ? "" : `onchange="location.href='/buchhaltung/rechnungen/neu?art=${art}&vorlage=${e(vorlage)}&firma='+this.value"`}>
                <option value="">— ohne Verknüpfung —</option>
                ${firmen.map((f) => `<option value="${f.id}" ${String(werte.firma_id || "") === String(f.id) ? "selected" : ""}>${e(f.name)}</option>`).join("")}</select></div>
            <div class="os-zeile os-zeile--eingabe"><label class="os-zeile-label" for="rg-name">Name *</label><input id="rg-name" name="empfaenger[name]" value="${e(emp.name)}" required placeholder="Firma oder Person"></div>
            <div class="os-zeile os-zeile--eingabe"><label class="os-zeile-label" for="rg-ap">Ansprechperson</label><input id="rg-ap" name="empfaenger[ansprechperson]" value="${e(emp.ansprechperson)}" placeholder="z. B. Max Müller"></div>
            <div class="os-zeile os-zeile--eingabe"><label class="os-zeile-label" for="rg-str">Straße und Hausnummer</label><input id="rg-str" name="empfaenger[strasse]" value="${e(emp.strasse)}"></div>
            <div class="os-zeile os-zeile--eingabe"><label class="os-zeile-label" for="rg-plz">PLZ und Ort</label><input id="rg-plz" name="empfaenger[plz_ort]" value="${e(emp.plz_ort)}" placeholder="84405 Dorfen"></div>
            <div class="os-zeile os-zeile--eingabe"><label class="os-zeile-label" for="rg-mail">E-Mail (für den Versand)</label><input id="rg-mail" type="email" name="empfaenger[email]" value="${e(emp.email)}" placeholder="info@firma.de"></div>
            <input type="hidden" name="empfaenger[anrede]" value="${e(emp.anrede || "")}">
          </div></div>
          <div class="os-gruppe"><div class="os-gruppe-titel">Vorgang</div><div class="os-gruppe-rumpf">
            <div class="os-zeile os-zeile--eingabe"><label class="os-zeile-label" for="rg-titel">Kurzbezeichnung</label><input id="rg-titel" name="titel" value="${e(werte.titel)}" placeholder="z. B. Webseite, KI-Anwendung"></div>
            <div class="os-zeile os-zeile--eingabe os-zeile--paar">
              <div class="os-zeile-teil"><label class="os-zeile-label" for="rg-datum">Datum</label><input id="rg-datum" type="date" name="datum" value="${e(werte.datum)}" required></div>
              <div class="os-zeile-teil"><label class="os-zeile-label" for="rg-faellig">${angebot ? "Gültig bis" : "Fällig bis"}</label><input id="rg-faellig" type="date" name="faellig" value="${e(werte.faellig)}"></div></div>
            <div class="os-zeile os-zeile--eingabe"><label class="os-zeile-label" for="rg-einl">Einleitung</label><textarea id="rg-einl" name="einleitung" rows="3" style="resize:vertical;width:100%" placeholder="${angebot ? "Der Absatz unter der Anrede" : "Der Absatz unter der Anrede — leer lassen für die knappe Hausvorlage"}">${e(werte.einleitung)}</textarea></div>
            ${angebot ? `<div class="os-zeile os-zeile--eingabe"><label class="os-zeile-label" for="rg-nutzen">Nutzen</label><textarea id="rg-nutzen" name="nutzen" rows="5" style="resize:vertical;width:100%" placeholder="Eine Zeile je Punkt — im Angebot steht davor ein goldenes Quadrat">${e(werte.nutzen)}</textarea>
              <div class="rg-sub">Eine Zeile je Punkt. Diese Liste ist das Herz des Angebots — sie steht über der Tabelle.</div></div>` : ""}
            <div class="os-zeile os-zeile--eingabe"><label class="os-zeile-label" for="rg-schluss">Schluss</label><textarea id="rg-schluss" name="schluss" rows="3" style="resize:vertical;width:100%">${e(werte.schluss)}</textarea></div>
          </div></div>
        </div>
        <div class="os-gruppe"><div class="os-gruppe-titel"><span>Positionen</span>
            <span class="os-gruppe-werkzeug"><button type="button" class="sekundaer klein" onclick="rgZeileNeu()">${ICON.plus} Zeile hinzufügen</button></span></div>
          <div class="os-gruppe-rumpf" style="padding:6px 16px 10px">
            <table class="rg-positionen" id="rg-positionen"><thead><tr><th></th><th>Leistung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th style="text-align:right">Gesamt</th><th></th></tr></thead>
              <tbody>${positionen.map(posZeile).join("")}</tbody></table>
            <div class="rg-summe"><span>${angebot ? "Gesamtpaket" : "Gesamtbetrag"}</span><b id="rg-summe">${geld(rg.summe(positionen))}</b></div>
            <div class="rg-sub">Kleinunternehmer nach § 19 UStG — keine Umsatzsteuer. Der Satz steht fest auf dem Blatt.</div>
          </div></div>
        <div class="rg-form-fuss"><div class="rg-links"><a class="rg-knopf sekundaer" href="${id ? `/buchhaltung/rechnungen/${id}` : "/buchhaltung/rechnungen"}">Abbrechen</a></div>
          <button type="submit" class="dunkel">${ICON.check} ${id ? "Änderungen speichern" : "Als Entwurf anlegen"}</button></div>
      </form>
      <template id="rg-zeile-vorlage"><table>${posZeile({ titel: "", beschreibung: "", menge: 1, einheit: "pauschal", einzelpreis: null }, 0)}</table></template>
      <script>
      (function(){
        var tb = document.querySelector('#rg-positionen tbody');
        function zahl(s){ s=String(s||'').trim().replace(/\\s|€/g,''); if(!s) return 0;
          if(s.indexOf(',')>=0) s=s.replace(/\\./g,'').replace(',','.'); else { var p=(s.match(/\\./g)||[]).length; if(p>1||(p===1&&/\\.\\d{3}$/.test(s))) s=s.replace(/\\./g,''); }
          var n=Number(s); return isFinite(n)?n:0; }
        function euro(n){ return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(n); }
        function neuNummerieren(){
          Array.prototype.forEach.call(tb.rows, function(tr, i){
            tr.querySelector('.rg-pos-nr').textContent = i+1;
            tr.querySelectorAll('[name]').forEach(function(el){ el.name = el.name.replace(/positionen\\[\\d+\\]/, 'positionen['+i+']'); });
          });
        }
        function rechnen(){
          var summe = 0;
          Array.prototype.forEach.call(tb.rows, function(tr){
            var m = zahl(tr.querySelector('[name$="[menge]"]').value)||1, p = tr.querySelector('[name$="[einzelpreis]"]').value;
            var g = p.trim()==='' ? null : Math.round(m*zahl(p)*100)/100;
            tr.querySelector('[data-gesamt]').textContent = g===null ? '—' : euro(g);
            summe += g||0;
          });
          document.getElementById('rg-summe').textContent = euro(Math.round(summe*100)/100);
        }
        window.rgZeileNeu = function(){
          var t = document.getElementById('rg-zeile-vorlage').content.querySelector('tr').cloneNode(true);
          tb.appendChild(t); neuNummerieren(); rechnen(); t.querySelector('input').focus();
        };
        window.rgZeileWeg = function(btn){
          if (tb.rows.length <= 1) { var tr = btn.closest('tr'); tr.querySelectorAll('input,textarea').forEach(function(el){ el.value=''; }); rechnen(); return; }
          btn.closest('tr').remove(); neuNummerieren(); rechnen();
        };
        tb.addEventListener('input', rechnen);
        rechnen();
      })();
      </script>`;
  }

  async function firmenSortiert(u) {
    const f = await crm.firmenListe(u, { limit: 300 });
    return [...f].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  app.get("/buchhaltung/rechnungen/neu", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const art = req.query.art === "angebot" ? "angebot" : "rechnung";
      const firmen = await firmenSortiert(u);
      const firmaId = /^\d+$/.test(String(req.query.firma || "")) ? Number(req.query.firma) : null;
      const firma = firmaId ? await crm.firma(u, firmaId) : null;
      // Vorlage: aus der Adresszeile, sonst aus der Sparte der Firma, sonst Webseite.
      const sparte = firma ? (firma.tags || []).find((t) => ["webdesign", "performance", "ki"].includes(t)) : null;
      const vorlage = rg.VORLAGEN[req.query.vorlage] ? req.query.vorlage
        : (sparte === "webdesign" ? "website" : sparte === "performance" ? "performance" : sparte === "ki" ? "ki" : "website");
      const t = rg.texte(vorlage, art);
      const heute = rg.heute();
      const werte = {
        firma_id: firmaId, empfaenger: rg.empfaengerAusFirma(firma), datum: heute, faellig: rg.frist(art, heute),
        titel: t.titel, einleitung: t.einleitung, schluss: t.schluss, nutzen: t.nutzen, positionen: t.positionen,
      };
      // Aus einem Angebot (?aus=) — Vorbelegung aus dem Angebot, Bezug bleibt.
      if (/^\d+$/.test(String(req.query.aus || ""))) {
        const a = await rg.eine(u, req.query.aus);
        if (a && a.art === "angebot") Object.assign(werte, {
          firma_id: a.firma_id, empfaenger: a.empfaenger, titel: a.titel, positionen: a.positionen, angebot_id: a.id,
          einleitung: rg.texte(a.vorlage, "rechnung").einleitung, schluss: rg.SCHLUSS.rechnung, nutzen: "",
        });
      }
      // Abschlag auf einen Auftrag (?abschlag_von=&prozent=)
      if (/^\d+$/.test(String(req.query.abschlag_von || ""))) {
        const a = await rg.eine(u, req.query.abschlag_von);
        const ab = a ? rg.abschlagBetrag(a.summe, { prozent: req.query.prozent || 50 }) : null;
        if (a && ab) {
          const nr = a.abschlaege.reduce((m, k) => Math.max(m, Number(k.abschlag_nr) || 0), 0) + 1;
          Object.assign(werte, {
            firma_id: a.firma_id, empfaenger: a.empfaenger, titel: a.titel, angebot_id: a.art === "angebot" ? a.id : a.angebot_id,
            abschlag_von: a.id, abschlag_nr: nr, abschlag_prozent: ab.prozent,
            positionen: [{ titel: `Abschlag ${nr} (${String(ab.prozent).replace(".", ",")} %) auf ${a.art === "angebot" ? "Angebot" : "Auftrag"} ${a.nummer || ""}${a.titel ? " – " + a.titel : ""}`.replace(/\s+/g, " "),
              beschreibung: `Abschlagszahlung auf den Gesamtauftrag über ${geld(a.summe)}.`, menge: 1, einheit: "pauschal", einzelpreis: ab.betrag }],
            einleitung: `wie vereinbart stellen wir Ihnen den ${nr}. Abschlag in Rechnung:`, schluss: rg.SCHLUSS.rechnung, nutzen: "",
          });
        }
      }
      res.send(seite(u, art === "angebot" ? "Neues Angebot" : "Neue Rechnung", "", formular(u, { art, werte, firmen, vorlage, hinweisHtml: hinweise(req.query) })));
    } catch (err) { if (migrationFehlt(err)) return res.redirect("/buchhaltung/rechnungen?fehler=migration-fehlt"); next(err); }
  });

  app.post("/buchhaltung/rechnungen", nurAdmin, async (req, res, next) => {
    try {
      const b = req.body || {};
      const erg = await rg.anlegen(req.nutzer, b);
      if (!erg.ok) {
        const p = new URLSearchParams({ art: b.art === "angebot" ? "angebot" : "rechnung", fehler: erg.grund });
        if (b.vorlage) p.set("vorlage", b.vorlage);
        if (b.firma_id) p.set("firma", b.firma_id);
        return res.redirect(`/buchhaltung/rechnungen/neu?${p}`);
      }
      res.redirect(`/buchhaltung/rechnungen/${erg.id}?ok=angelegt`);
    } catch (err) { if (migrationFehlt(err)) return res.redirect("/buchhaltung/rechnungen?fehler=migration-fehlt"); next(err); }
  });

  app.get("/buchhaltung/rechnungen/:id(\\d+)/bearbeiten", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const r = await rg.eine(u, req.params.id);
      if (!r) return res.redirect("/buchhaltung/rechnungen?fehler=nicht-gefunden");
      if (r.status !== "entwurf") return res.redirect(`/buchhaltung/rechnungen/${r.id}?fehler=nur-entwurf`);
      const firmen = await firmenSortiert(u);
      res.send(seite(u, `${artText(r)} bearbeiten`, "", formular(u, { art: r.art, werte: r, firmen, id: r.id, vorlage: r.vorlage || "frei", hinweisHtml: hinweise(req.query) })));
    } catch (err) { next(err); }
  });

  app.post("/buchhaltung/rechnungen/:id(\\d+)", nurAdmin, async (req, res, next) => {
    try {
      const erg = await rg.aendern(req.nutzer, req.params.id, req.body || {});
      if (!erg.ok) return res.redirect(`/buchhaltung/rechnungen/${req.params.id}${erg.grund === "nur-entwurf" || erg.grund === "nicht-gefunden" ? "" : "/bearbeiten"}?fehler=${erg.grund}`);
      res.redirect(`/buchhaltung/rechnungen/${req.params.id}?ok=gespeichert`);
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------ PDF
  app.get("/buchhaltung/rechnungen/:id(\\d+).pdf", nurAdmin, async (req, res, next) => {
    try {
      const p = await rg.pdfHolen(req.nutzer, req.params.id, { unterschrift: req.nutzer.name });
      if (!p) return res.status(404).send("Den Vorgang gibt es nicht.");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${req.query.laden ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(p.name)}`);
      res.setHeader("Cache-Control", p.eingefroren ? "private, max-age=3600" : "no-store");
      res.send(p.daten);
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------ Vorgang
  app.get("/buchhaltung/rechnungen/:id(\\d+)", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const r = await rg.eine(u, req.params.id);
      if (!r) return res.redirect("/buchhaltung/rechnungen?fehler=nicht-gefunden");
      const angebot = r.art === "angebot", entwurf = r.status === "entwurf";
      const basis = `/buchhaltung/rechnungen/${r.id}`;
      const knopf = (aktion, text, icon, klasse = "sekundaer", bestaetigung = "") =>
        `<form method="post" action="${basis}/${aktion}" ${bestaetigung ? `onsubmit="return confirm('${e(bestaetigung)}')"` : ""}><button type="submit" class="${klasse}">${icon} ${text}</button></form>`;
      const blatt = (id, text, icon, klasse = "sekundaer") => `<button type="button" class="${klasse}" onclick="document.getElementById('${id}').showModal()">${icon} ${text}</button>`;
      // GENAU EINE dunkle Aktion je Seite (Befund 11): Vorher waren "Senden" und
      // "Als bezahlt" beide dunkel — zwei gleich laute Knoepfe nebeneinander
      // sagen nicht mehr, was der naechste Schritt ist. Der naechste Schritt
      // ist: Entwurf -> stellen, gestellt -> senden, versendet -> Geld buchen.
      const hauptAktion = entwurf ? "stellen"
        : r.status === "storniert" ? ""
        : !r.versendet_am ? "senden"
        : (!angebot && ["gestellt", "teilbezahlt"].includes(r.status)) ? "bezahlt"
        : "senden";
      const stil = (name) => (hauptAktion === name ? "dunkel" : "sekundaer");
      const aktionen = [];
      if (entwurf) {
        aktionen.push(knopf("stellen", angebot ? "Angebot stellen" : "Rechnung stellen", ICON.check, stil("stellen")));
        aktionen.push(blatt("blatt-senden", "Per E-Mail senden", ICON.mail, stil("senden")));
        aktionen.push(`<a class="rg-knopf sekundaer" href="${basis}/bearbeiten">${ICON.stift} Bearbeiten</a>`);
      } else if (r.status !== "storniert") {
        aktionen.push(blatt("blatt-senden", r.versendet_am ? "Erneut senden" : "Per E-Mail senden", ICON.mail, stil("senden")));
      }
      if (!angebot && ["gestellt", "teilbezahlt"].includes(r.status)) aktionen.push(blatt("blatt-bezahlt", r.status === "teilbezahlt" ? "Weitere Zahlung" : "Als bezahlt markieren", ICON.euro, stil("bezahlt")));
      if (angebot && ["gestellt", "angenommen"].includes(r.status)) {
        aktionen.push(knopf("umwandeln", r.abschlaege.length ? "Schlussrechnung anlegen" : "In Rechnung umwandeln", ICON.pfeil));
        aktionen.push(blatt("blatt-abschlag", "Abschlagsrechnung", ICON.prozent));
      }
      if (!angebot && entwurf) aktionen.push(blatt("blatt-abschlag", "Abschlagsrechnung", ICON.prozent));
      if (angebot && ["gestellt", "abgelehnt"].includes(r.status)) aktionen.push(knopf("status", "Angenommen", ICON.check, "sekundaer") .replace('action="' + basis + '/status"', 'action="' + basis + '/status"><input type="hidden" name="status" value="angenommen"'));
      if (angebot && ["gestellt", "angenommen"].includes(r.status)) aktionen.push(knopf("status", "Abgelehnt", ICON.x).replace('action="' + basis + '/status"', 'action="' + basis + '/status"><input type="hidden" name="status" value="abgelehnt"'));
      aktionen.push(knopf("duplizieren", "Duplizieren", ICON.kopie));
      if (!entwurf && r.status !== "storniert") aktionen.push(blatt("blatt-storno", "Stornieren", ICON.x));
      if (entwurf) aktionen.push(knopf("loeschen", "Entwurf löschen", ICON.x, "sekundaer", "Diesen Entwurf wirklich löschen?"));

      const pillen = [pille(r), `<span class="os-pille">${e(artText(r))}</span>`];
      if (r.abschlag_nr) pillen.push(`<span class="os-pille os-pille--blau">Abschlag ${r.abschlag_nr}${r.abschlag_prozent ? ` · ${String(r.abschlag_prozent).replace(".", ",")} %` : ""}</span>`);
      if (r.ueberfaellig_tage) pillen.push(`<span class="os-pille os-pille--rot">${r.ueberfaellig_tage} Tage überfällig</span>`);
      if (r.versendet_am) pillen.push(`<span class="os-pille os-pille--gruen">Versendet ${datum(rg.tagFeld(r.versendet_am))}</span>`);

      const zeileText = (label, wert) => `<div class="os-zeile os-zeile--text"><span class="os-zeile-label">${label}</span><div class="os-zeile-wert">${wert || "—"}</div></div>`;
      const zahlstand = angebot ? "" : `<div class="os-gruppe"><div class="os-gruppe-titel">Zahlstand</div><div class="os-gruppe-rumpf">
          <div class="os-zeile os-zeile--text"><span class="os-zeile-label">${r.status === "storniert" ? "Betrag (storniert)" : "Bezahlt"}</span>
            <div class="os-zeile-wert"><b>${geld(r.bezahlt_betrag)}</b> von ${geld(r.summe)}${r.status !== "storniert" ? `<div class="os-fortschritt"><div class="os-fortschritt-balken"><span style="width:${r.prozent_bezahlt}%"></span></div><span class="os-fortschritt-text">${r.prozent_bezahlt} % bezahlt</span></div>` : ""}</div></div>
          ${r.status !== "storniert" && r.offen > 0 && !entwurf ? zeileText("Offen", `<b>${geld(r.offen)}</b>${r.faellig ? ` · fällig ${datum(r.faellig)}` : ""}`) : ""}
          ${r.zahlungen.map((z, i) => `<div class="os-zeile os-zeile--text"><span class="os-zeile-label">Zahlung ${i + 1}</span><div class="os-zeile-wert rg-zahlung"><span>${geld(z.betrag)} am ${datum(z.am)}</span><small>Buchung #${e(z.buchung_id)}</small></div></div>`).join("")}
          ${!r.zahlungen.length && !entwurf && r.status !== "storniert" ? zeileText("Zahlungen", "Noch keine Zahlung eingegangen.") : ""}
        </div></div>`;
      const kette = (titel, liste) => liste.length ? `<div class="os-gruppe"><div class="os-gruppe-titel">${titel}</div><div class="os-gruppe-rumpf rg-kette">${
        liste.map((k) => `<a href="${k.url}"><span><span class="rg-nummer ${k.nummer ? "" : "rg-entwurf"}">${e(nummerText(k))}</span><span class="rg-sub">${e(artText(k))}${k.abschlag_nr ? ` · Abschlag ${k.abschlag_nr}` : ""} · ${datum(k.datum)}</span></span><span style="display:flex;gap:8px;align-items:center"><span class="rg-betrag">${geld(k.summe)}</span>${pille(k)}</span></a>`).join("")}</div></div>` : "";
      const auftragProzent = angebot && r.summe > 0 ? Math.min(100, Math.round(r.abschlaege.concat(r.rechnungen).filter((k) => rg.ZAEHLT.includes(k.status)).reduce((s, k) => s + k.bezahlt_betrag, 0) / r.summe * 100)) : null;
      const auftrag = angebot && (r.abschlaege.length || r.rechnungen.length) ? `<div class="os-gruppe"><div class="os-gruppe-titel">Auftrag</div><div class="os-gruppe-rumpf">
          <div class="os-zeile os-zeile--text"><span class="os-zeile-label">Bezahlt auf diesen Auftrag</span><div class="os-zeile-wert"><b>${auftragProzent} %</b> von ${geld(r.summe)}
            <div class="os-fortschritt"><div class="os-fortschritt-balken"><span style="width:${auftragProzent}%"></span></div><span class="os-fortschritt-text">${r.abschlaege.length} Abschlag${r.abschlaege.length === 1 ? "" : "e"}</span></div></div></div></div></div>` : "";
      const vorgang = `<div class="os-gruppe"><div class="os-gruppe-titel"><span>Vorgang</span>${entwurf ? `<a class="os-gruppe-werkzeug" href="${basis}/bearbeiten">Bearbeiten</a>` : ""}</div><div class="os-gruppe-rumpf">
          ${zeileText("Empfänger", `${e(r.empfaenger.name)}${r.empfaenger.ansprechperson ? `<span class="rg-sub">${e(r.empfaenger.ansprechperson)}</span>` : ""}${r.empfaenger.strasse || r.empfaenger.plz_ort ? `<span class="rg-sub">${e([r.empfaenger.strasse, r.empfaenger.plz_ort].filter(Boolean).join(", "))}</span>` : ""}`)}
          ${zeileText("E-Mail", r.empfaenger.email ? e(r.empfaenger.email) : `<span class="rg-entwurf">keine Adresse — vor dem Senden eintragen</span>`)}
          ${zeileText("Firma im CRM", r.firma_id ? `<a href="/crm/firma/${r.firma_id}">${e(r.firma_name || "Kundenakte")} ↗</a><span class="rg-sub">Kundennummer K-${r.firma_id}</span>` : "nicht verknüpft")}
          <div class="os-zeile os-zeile--text os-zeile--paar"><div class="os-zeile-teil"><span class="os-zeile-label">Datum</span><div class="os-zeile-wert">${datum(r.datum)}</div></div><div class="os-zeile-teil"><span class="os-zeile-label">${angebot ? "Gültig bis" : "Fällig bis"}</span><div class="os-zeile-wert">${r.faellig ? datum(r.faellig) : "—"}</div></div></div>
          ${(() => {
            // "Webseite · Webseite" stand da, wenn die Kurzbezeichnung genau so
            // heisst wie die Vorlage (Befund 16) — dann genuegt ein Wort.
            const vorlageTitel = (rg.VORLAGEN[r.vorlage] && rg.VORLAGEN[r.vorlage].titel) || "Frei";
            const zusatz = r.titel && r.titel !== vorlageTitel ? ` · ${e(r.titel)}` : "";
            return zeileText("Vorlage", e(vorlageTitel) + zusatz);
          })()}
          ${r.angebot_id ? zeileText("Aus Angebot", `<a href="/buchhaltung/rechnungen/${r.angebot_id}">${e(r.angebot_nummer || "Angebot")}</a>`) : ""}
          ${r.abschlag_von ? zeileText("Abschlag auf", `<a href="/buchhaltung/rechnungen/${r.abschlag_von}">${e(r.auftrag_nummer || "Auftrag")}</a>${r.auftrag_summe ? ` · Auftrag ${geld(r.auftrag_summe)}` : ""}`) : ""}
          ${r.versendet_am ? zeileText("Versendet", `${datum(rg.tagFeld(r.versendet_am))} an ${e(r.versendet_an)}`) : ""}
          ${r.status === "storniert" ? zeileText("Storno-Grund", `<span class="rg-storno">${e(r.storno_grund)}</span>`) : ""}
          ${zeileText("Angelegt", `${e(r.erstellt_von_name || "—")} · ${datum(rg.tagFeld(r.erstellt))}`)}
          ${r.pdf_pruefsumme ? zeileText("PDF-Prüfsumme (SHA-256)", `<span class="rg-mono">${e(r.pdf_pruefsumme)}</span>`) : ""}
        </div></div>`;

      // Frisch je Seitenaufruf. Der Wert landet als verstecktes Feld im
      // Zahlungsblatt und macht das Buchen wiederholbar, ohne doppelt zu buchen.
      const zahlungToken = crypto.randomUUID();
      const blaetter = `
        <dialog class="os-blatt" id="blatt-senden"><form method="post" action="${basis}/senden">
          <div class="os-blatt-kopf"><div><h2>Per E-Mail senden</h2><p class="sub">${entwurf ? "Der Entwurf wird dabei gestellt: Nummer vergeben, PDF eingefroren." : `${e(artText(r))} ${e(r.nummer)} als PDF im Anhang.`}</p></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="os-blatt-rumpf"><div class="feld"><label for="rg-an">An</label><input id="rg-an" type="email" name="an" value="${e(r.empfaenger.email)}" required placeholder="info@firma.de"></div>
            <div class="rg-sub">Betreff: ${e(rg.mailTexten({ ...r, nummer: r.nummer || "…" }, u).betreff)}</div>
            ${process.env.ADS_PROBE === "1" ? `<div class="os-hinweis os-hinweis--info" style="margin-top:12px">${ICON.info}<div>Probemodus (ADS_PROBE): die Mail wird abgefangen und nur protokolliert.</div></div>` : ""}</div>
          <div class="os-blatt-fuss"><button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button><button type="submit" class="dunkel">${ICON.mail} Senden</button></div></form></dialog>
        <dialog class="os-blatt" id="blatt-bezahlt"><form method="post" action="${basis}/bezahlt">
          <div class="os-blatt-kopf"><div><h2>Zahlung eintragen</h2><p class="sub">Erzeugt eine Einnahme in der Buchhaltung (Zufluss-Prinzip: der Zahltag zählt).</p></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="os-blatt-rumpf">
            <!-- Ein Blatt = ein Token. Kommt es zweimal an (Doppelklick, F5, Zurück-Taste),
                 bucht rg.bezahlt() die Zahlung NICHT ein zweites Mal. -->
            <input type="hidden" name="token" value="${e(zahlungToken)}">
            <div class="feld-paar">
            <div class="feld"><label for="rg-am">Zahltag</label><input id="rg-am" type="date" name="am" value="${rg.heute()}" required></div>
            <div class="feld"><label for="rg-betrag">Betrag (€)</label><input id="rg-betrag" name="betrag" value="${betragFeld(r.offen)}" inputmode="decimal" required></div></div>
            <div class="rg-sub">Offen: ${geld(r.offen)}. Ein kleinerer Betrag ist eine Teilzahlung — die Rechnung bleibt dann „teilbezahlt".</div></div>
          <div class="os-blatt-fuss"><button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button><button type="submit" class="dunkel">${ICON.euro} Zahlung buchen</button></div></form></dialog>
        <dialog class="os-blatt" id="blatt-abschlag"><form method="post" action="${basis}/abschlag">
          <div class="os-blatt-kopf"><div><h2>Abschlagsrechnung</h2><p class="sub">Auf ${e(artText(r))} ${e(nummerText(r))} über ${geld(r.summe)}${r.abschlaege.length ? ` — bisher ${r.abschlaege.length} Abschlag${r.abschlaege.length === 1 ? "" : "e"}` : ""}.</p></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="os-blatt-rumpf"><div class="feld-paar">
            <div class="feld"><label for="rg-prozent">Prozent</label><input id="rg-prozent" name="prozent" value="50" inputmode="decimal"></div>
            <div class="feld"><label for="rg-ab-betrag">oder Betrag (€)</label><input id="rg-ab-betrag" name="betrag" placeholder="leer = aus Prozent" inputmode="decimal"></div></div>
            <div class="rg-sub">Es entsteht ein Rechnungs-Entwurf mit einer Position „Abschlag n (x %) …". Stellen und senden wie jede Rechnung.</div></div>
          <div class="os-blatt-fuss"><button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button><button type="submit" class="dunkel">${ICON.prozent} Abschlag anlegen</button></div></form></dialog>
        <dialog class="os-blatt" id="blatt-storno"><form method="post" action="${basis}/storno">
          <div class="os-blatt-kopf"><div><h2>Stornieren</h2><p class="sub">Die Nummer bleibt vergeben, bereits gebuchte Zahlungen bleiben gebucht.</p></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="os-blatt-rumpf"><div class="feld"><label for="rg-grund">Grund *</label><input id="rg-grund" name="grund" required placeholder="z. B. falscher Betrag, neu gestellt als R-2026-140"></div></div>
          <div class="os-blatt-fuss"><button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button><button type="submit" class="gefahr">${ICON.x} Stornieren</button></div></form></dialog>`;

      // e() um den Titel: schale.js rendert die Unterzeile roh (Befund 4) —
      // ein Kundenname mit spitzen Klammern waere sonst Markup.
      res.send(seite(u, `${artText(r)} ${nummerText(r)}`, e(r.titel || ""), `
        <div class="os-kopf"><div><div class="os-kopf-titel">${e(artText(r))} ${e(nummerText(r))}</div>
          <div class="os-kopf-unter">${e(r.empfaenger.name || "")}${r.titel ? ` · ${e(r.titel)}` : ""} · ${geld(r.summe)}</div>
          <div class="os-kopf-pillen">${pillen.join("")}</div></div>
          <div class="os-kopf-aktionen"><a class="rg-knopf sekundaer" href="/buchhaltung/rechnungen">Zur Liste</a></div></div>
        ${hinweise(req.query)}
        <div class="os-werkzeugleiste"><div class="rg-aktionen">${aktionen.join("")}</div></div>
        <div class="rg-detail">
          <div class="rg-vorschau"><div class="rg-vorschau-kopf"><span>${r.pdf_da && !entwurf ? "Eingefrorenes PDF — so liegt es beim Kunden." : "Vorschau — der Entwurf wird beim Stellen eingefroren."}</span>
            <a href="${basis}.pdf?laden=1">${ICON.pdf} PDF herunterladen</a></div>
            <iframe src="${basis}.pdf" title="PDF-Vorschau"></iframe></div>
          <div>${zahlstand}${auftrag}${vorgang}${kette("Abschlagsrechnungen", r.abschlaege)}${kette("Rechnungen aus diesem Angebot", r.rechnungen)}</div>
        </div>${blaetter}`));
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------ Aktionen
  const aktion = (pfad, fn) => app.post(`/buchhaltung/rechnungen/:id(\\d+)/${pfad}`, nurAdmin, async (req, res, next) => {
    try {
      const id = req.params.id;
      const erg = await fn(req.nutzer, id, req.body || {}, req);
      if (!erg.ok) return res.redirect(`/buchhaltung/rechnungen/${id}?fehler=${encodeURIComponent(erg.grund || "unbekannt")}`);
      res.redirect(erg.ziel || `/buchhaltung/rechnungen/${erg.id || id}?ok=${erg.ok_code || pfad}`);
    } catch (err) { next(err); }
  });
  aktion("stellen", async (u, id) => {
    const erg = await rg.stellen(u, id, { unterschrift: u.name });
    return erg.ok ? { ...erg, ok_code: erg.mitAbzug ? "gestellt-mit-abzug" : "gestellt" } : erg;
  });
  aktion("senden", async (u, id, b) => {
    const erg = await rg.versenden(u, id, { an: b.an, unterschrift: u.name });
    return erg.ok ? { ...erg, ok_code: erg.abgefangen ? "abgefangen" : "gesendet" } : erg;
  });
  aktion("bezahlt", async (u, id, b) => {
    const erg = await rg.bezahlt(u, id, b);
    return erg.ok ? { ...erg, ok_code: erg.schon ? "schon-gebucht" : erg.status } : erg;
  });
  aktion("abschlag", async (u, id, b) => { const erg = await rg.abschlag(u, id, b); return erg.ok ? { ok: true, ziel: `/buchhaltung/rechnungen/${erg.id}?ok=abschlag` } : erg; });
  aktion("umwandeln", async (u, id) => { const erg = await rg.umwandeln(u, id); return erg.ok ? { ok: true, ziel: `/buchhaltung/rechnungen/${erg.id}?ok=umgewandelt` } : erg; });
  aktion("status", async (u, id, b) => { const erg = await rg.statusSetzen(u, id, b.status); return erg.ok ? { ok: true, ok_code: b.status } : erg; });
  aktion("storno", async (u, id, b) => { const erg = await rg.stornieren(u, id, b.grund); return erg.ok ? { ok: true, ok_code: "storniert" } : erg; });
  aktion("duplizieren", async (u, id) => { const erg = await rg.duplizieren(u, id); return erg.ok ? { ok: true, ziel: `/buchhaltung/rechnungen/${erg.id}?ok=dupliziert` } : erg; });
  aktion("loeschen", async (u, id) => { const erg = await rg.loeschen(u, id); return erg.ok ? { ok: true, ziel: "/buchhaltung/rechnungen?ok=geloescht" } : erg; });
};

module.exports.fehlerText = fehlerText;
module.exports.FEHLERTEXTE = FEHLERTEXTE;
module.exports.OKTEXTE = OKTEXTE;
