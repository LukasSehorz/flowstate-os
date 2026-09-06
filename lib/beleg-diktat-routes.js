// Beleg diktieren und verschicken — Seiten und Aktionen (05.09.2026).
//
// Eigenes Modul neben lib/rechnungen-routes.js (Agent D1), damit der Eingriff
// in server.js bei einer Zeile bleibt und die beiden Wege sich nicht ins
// Gehege kommen: Dort steht das FORMULAR (jede Position von Hand), hier steht
// das TEXTFELD. Beide legen am Ende dieselbe Zeile in "rechnungen" an, über
// dieselbe Funktion (rechnungen.anlegen).
//
// Seiten
//   GET  /buchhaltung/rechnungen/diktat            das eine Textfeld
//   POST /buchhaltung/rechnungen/diktat            verstehen -> Vorschau
//   POST /buchhaltung/rechnungen/diktat/anlegen    Vorschau -> Entwurf
//   GET  /buchhaltung/rechnungen/:id/nachricht     Mail/WhatsApp schreiben
//   POST /buchhaltung/rechnungen/:id/nachricht     neu formulieren / stellen
//   POST /buchhaltung/rechnungen/:id/senden-als    raus damit
//   GET  /r/:schluessel                            das PDF für den Kunden — OHNE Anmeldung
//
// WARUM DIE VORSCHAU (Schritt zwischen Verstehen und Speichern): Das Modell
// liest einen hingeworfenen Satz. "Abschlag 50" kann 50 Prozent oder 50 Euro
// heißen. Wer das ungesehen speichert, hat im schlechten Fall eine Rechnung
// mit vergebener Nummer beim Kunden. Die Vorschau zeigt, was aus welchem Satz
// wurde, samt Warnungen — und erst der Knopf "Passt" schreibt eine Zeile.
//
// WARUM /r/:schluessel OHNE ANMELDUNG: Der Kunde hat kein Konto in diesem
// System und wird auch keines bekommen. WhatsApp kann keine Datei mitschicken
// (lib/whatsapp.js), also ist ein Link der einzige Weg zum PDF. Der Schlüssel
// ist die ganze Berechtigung — 24 Zufallsbytes, 30 Tage, kein Verzeichnis.
// Der Torwächter in server.js lässt die Route durch, ohne dass dort etwas
// geändert werden muss: Diese Routen werden im DATABASE_URL-Block registriert
// und stehen damit VOR dem Auth-Gate (server.js, "app.use" mit PASSWORD).
// Der Modul-Torwächter darüber greift nur bei angemeldeten Nicht-Admins und
// lässt unbekannte erste Pfadabschnitte ("r") ausdrücklich durch.

const fs = require("fs");
const path = require("path");
const { schale } = require("./schale.js");
const { unternav } = require("./buchhaltung-unternav.js");
const rg = require("./rechnungen.js");
const crm = require("./crm.js");
const bd = require("./beleg-diktat.js");
const bv = require("./beleg-versand.js");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const geld = rg.euro;
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
  stift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  warnung: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  pfeil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  neu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/></svg>',
  beleg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 3h9l4 4v14H6zM9 12h6M9 16h6"/></svg>',
  senden: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8z"/></svg>',
};

// ------------------------------------------------------ Sichtbar scheitern
// Muster aus lib/buchhaltung-routes.js: Was nicht geklappt hat, steht auf der
// Seite — nicht im Serverlog. Object.hasOwn statt [] , sonst zeigt
// "?fehler=__proto__" den Inhalt der Prototypkette (Befund des Prüfers zu D1).
const FEHLERTEXTE = {
  leer: "<b>Da stand nichts.</b> Schreib in ein paar Worten, für wen der Beleg ist, was drauf soll und was es kostet.",
  "kein-modell": "<b>Ohne Sprachmodell kann ich aus deinem Text keinen Entwurf bauen</b> — auf dem Server läuft es. Der Text bleibt stehen; du kannst ihn als leeren Entwurf anlegen und die Zahlen von Hand eintragen.",
  empfaenger: "<b>Nicht angelegt.</b> Es fehlt der Name des Kunden — entweder im Text nennen oder unten eine Firma auswählen.",
  positionen: "<b>Nicht angelegt.</b> Mindestens eine Zeile mit Titel muss drinstehen.",
  "nicht-gefunden": "<b>Den Vorgang gibt es nicht</b> — gelöscht oder falsche Nummer.",
  entwurf: "<b>Noch ein Entwurf.</b> Ein Beleg ohne Nummer geht nicht raus — erst stellen, dann senden.",
  storniert: "<b>Der Vorgang ist storniert</b> und wird nicht mehr versendet.",
  mail: "<b>Die Mailadresse sieht nicht vollständig aus</b> — es fehlt meist die Endung, also <code>info@firma.de</code>.",
  nummer: "<b>Die WhatsApp-Nummer fehlt oder ist unvollständig.</b> Mit Vorwahl eintragen, z. B. <code>0151 12345678</code>.",
  text: "<b>Nicht gesendet.</b> Der Nachrichtentext ist leer.",
  "kein-pdf": "<b>Nicht gesendet.</b> Zu diesem Vorgang gibt es kein PDF.",
  "kein-mailzugang": "<b>Nicht gesendet.</b> Auf dieser Maschine ist kein Mailzugang hinterlegt (Google-Token fehlt). Der Versand läuft nur auf dem Server.",
  "kein-whatsapp-entwurf": "<b>Einen WhatsApp-Entwurf gibt es nicht.</b> Entweder senden oder den Text kopieren.",
  versand: "<b>Das Verschicken hat nicht geklappt.</b> Der Beleg liegt unverändert da — einfach nochmal versuchen.",
  "kein-link": "<b>Der PDF-Link ließ sich nicht anlegen.</b> Fehlt in der Datenbank Migration 0062? Einspielen mit <code>node scripts/migrieren.js --einspielen</code>.",
  "migration-fehlt": "<b>Das Diktat lässt sich hier noch nicht speichern.</b> In der Datenbank fehlt Migration 0060 oder 0062 — einspielen mit <code>node scripts/migrieren.js --einspielen</code>.",
};
const OKTEXTE = {
  gesendet: "Per E-Mail verschickt — mit dem PDF im Anhang.",
  "gesendet-whatsapp": "Per WhatsApp verschickt.",
  entwurf: "Als Entwurf in Gmail abgelegt. Du kannst ihn dort noch anfassen, bevor er rausgeht.",
  abgefangen: "<b>Probemodus:</b> nicht gesendet, abgefangen und protokolliert (<code>ADS_PROBE=1</code>).",
  gestellt: "Gestellt — die Nummer ist vergeben, das PDF eingefroren. Jetzt die Nachricht.",
};
const hat = (o, k) => Boolean(k) && Object.hasOwn(o, k);
const hinweise = (q) => {
  const f = String((q || {}).fehler || "").slice(0, 80), o = String((q || {}).ok || "").slice(0, 40);
  return (f ? `<div class="os-hinweis os-hinweis--warn">${ICON.warnung}<div>${hat(FEHLERTEXTE, f)
    ? FEHLERTEXTE[f] : `<b>Das hat nicht geklappt.</b> Gespeichert wurde nichts. Meldung: <code>${e(f)}</code>`}</div></div>` : "")
    + (hat(OKTEXTE, o) ? `<div class="os-hinweis os-hinweis--erfolg">${ICON.check}<div>${OKTEXTE[o]}</div></div>` : "");
};

const kopfStil = `<link rel="stylesheet" href="${v("/rechnungen.css")}"><link rel="stylesheet" href="${v("/diktat.css")}">`;
const migrationFehlt = (err) => /relation "(rechnungen|beleg_links|beleg_versand)" does not exist/.test(String(err && err.message));

// Der Platzhalter im Textfeld ist ein ECHTES Beispiel, kein "z. B. …": Wer
// zum ersten Mal vor einem leeren Feld sitzt, braucht einen Satz zum
// Nachbauen, keine Aufzaehlung von Feldnamen.
const BEISPIEL = "Rechnung für Anderka GmbH, Website 2.500 €, Abschlag 50 %, Ansprechpartner Gottfried Anderka, Leistung heute, Zahlungsziel 14 Tage";

const artWort = (a) => (a === "angebot" ? "Angebot" : "Rechnung");
const nummerText = (r) => r.nummer || "Entwurf";

module.exports = function (app) {
  const nurAdmin = (req, res, next) => {
    if (!req.session || !req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    if (req.nutzer.rolle !== "admin") return res.redirect("/crm");
    next();
  };
  const seite = (u, titel, unterzeile, inhalt) => schale({
    titel, unterzeile, aktiv: "buchhaltung", nutzer: u, reiter: unternav("rechnungen"),
    inhalt: `${kopfStil}<div class="rg-seite dk-seite">${inhalt}</div>`,
  });
  // Woher der Kunde das PDF holt. Auf dem Server steht die Adresse fest in der
  // Umgebung; lokal (und hinter wechselnden Hostnamen) wird sie aus der
  // Anfrage gebaut, damit der Link im Testlauf auch wirklich funktioniert.
  const basisUrl = (req) => String(process.env.BELEG_LINK_BASIS || process.env.OS_URL || "").trim().replace(/\/+$/, "")
    || `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}`;

  // =====================================================================
  // Das PDF fuer den Kunden — bewusst ohne Anmeldung.
  // =====================================================================
  app.get("/r/:schluessel", async (req, res) => {
    let erg;
    try { erg = await bv.linkAufloesen(req.params.schluessel); }
    catch { erg = { ok: false, grund: "fehler" }; }
    if (!erg.ok) {
      // EINE Seite fuer alle Gruende. Ein Kunde mit abgelaufenem Link und ein
      // Fremder, der Schluessel durchprobiert, bekommen dieselbe Antwort —
      // sonst verriete die Meldung, welche Schluessel es gibt.
      return res.status(erg.grund === "abgelaufen" ? 410 : 404).send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Link abgelaufen</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F4F5F9;color:#1A1A1A;
font:400 15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
.k{max-width:420px;background:#fff;border:1px solid #E4E7EC;border-radius:14px;padding:28px 30px;text-align:center}
h1{font-size:18px;font-weight:600;margin:0 0 8px}p{margin:0;color:#5A6472}</style></head>
<body><div class="k"><h1>Dieser Link ist abgelaufen.</h1>
<p>Links auf ein Dokument gelten ${bv.LINK_TAGE} Tage. Melden Sie sich gerne bei uns — wir schicken Ihnen das Dokument erneut.</p>
</div></body></html>`);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${erg.name}"`);
    // Kein Zwischenspeicher unterwegs: Das ist ein persoenliches Dokument.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.send(Buffer.isBuffer(erg.daten) ? erg.daten : Buffer.from(erg.daten));
  });

  // =====================================================================
  // Das Textfeld
  // =====================================================================
  function diktatSeite(u, { text = "", art = "rechnung", firmaId = "", firmen = [], q = {} }) {
    const modellDa = bd.bereit();
    const artChip = (k) => `<label class="os-chip"><input type="radio" name="art" value="${k}" ${art === k ? "checked" : ""}> ${artWort(k)}</label>`;
    return seite(u, "Beleg diktieren", "Ein Satz statt eines Formulars", `
      <div class="os-kopf"><div><div class="os-kopf-titel">Diktieren statt ausfüllen</div>
        <div class="os-kopf-unter">Schreib in ein paar Worten, für wen der Beleg ist, was drauf soll und was es kostet. Der Rest wird daraus gebaut — du siehst ihn, bevor etwas gespeichert wird.</div></div>
        <div class="os-kopf-aktionen">
          <a class="rg-knopf sekundaer" href="/buchhaltung/rechnungen">Alle Vorgänge</a>
          <a class="rg-knopf sekundaer" href="/buchhaltung/rechnungen/neu?art=${art}">${ICON.stift} Lieber das Formular</a></div></div>
      ${hinweise(q)}
      ${modellDa ? "" : `<div class="os-hinweis os-hinweis--warn">${ICON.warnung}<div><b>Ohne Sprachmodell kann ich aus deinem Text keinen Entwurf bauen</b> — auf dem Server läuft es.
        Du kannst trotzdem weitermachen: Der Text wird als Notiz an einem leeren Entwurf gespeichert, die Zahlen trägst du dann im Formular nach.</div></div>`}
      <form method="post" action="/buchhaltung/rechnungen/diktat" class="os-breite-schmal">
        <section class="os-gruppe">
          <div class="os-gruppe-titel">Was soll auf den Beleg?</div>
          <div class="os-gruppe-rumpf">
            <label class="os-zeile os-zeile--eingabe dk-diktat">
              <span class="os-zeile-label">Diktat</span>
              <div class="os-zeile-wert"><textarea name="text" rows="5" autofocus placeholder="${e(BEISPIEL)}">${e(text)}</textarea></div>
            </label>
            <div class="os-zeile os-zeile--chips">
              <span class="os-zeile-label">Art</span>
              <div class="os-zeile-wert"><div class="os-chips">${artChip("rechnung")}${artChip("angebot")}</div></div>
              <span class="os-zeile-hilfe">Steht die Art im Text („Angebot für …"), gilt der Text.</span>
            </div>
            <label class="os-zeile os-zeile--eingabe">
              <span class="os-zeile-label">Kunde (nur falls er nicht erkannt wird)</span>
              <div class="os-zeile-wert"><select name="firma_id">
                <option value="">— aus dem Text erkennen —</option>
                ${firmen.map((f) => `<option value="${f.id}" ${String(firmaId) === String(f.id) ? "selected" : ""}>${e(f.name)}</option>`).join("")}
              </select></div>
            </label>
          </div>
          <div class="os-gruppe-fuss">Beispiel: <span class="dk-beispiel">${e(BEISPIEL)}</span></div>
        </section>
        <div class="dk-aktionen"><button type="submit" class="dunkel">${ICON.pfeil} Entwurf erstellen</button></div>
      </form>`);
  }

  app.get("/buchhaltung/rechnungen/diktat", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      let firmen = [];
      try { firmen = await crm.firmenListe(u, { limit: 300 }); } catch { firmen = []; }
      firmen = [...firmen].sort((a, b) => a.name.localeCompare(b.name, "de"));
      res.send(diktatSeite(u, {
        text: String(req.query.text || "").slice(0, bd.MAX_DIKTAT),
        art: ["angebot", "rechnung"].includes(req.query.art) ? req.query.art : "rechnung",
        firmaId: String(req.query.firma || "").slice(0, 12),
        firmen, q: req.query,
      }));
    } catch (err) { next(err); }
  });

  // -------------------------------------------------- Verstehen -> Vorschau
  app.post("/buchhaltung/rechnungen/diktat", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const b = req.body || {};
      // "Nochmal, mit Ergaenzung": Das Textfeld bleibt stehen, die Ergaenzung
      // wird angehaengt — Lukas soll nicht neu tippen, was schon dastand.
      const ergaenzung = String(b.ergaenzung || "").trim();
      const text = (String(b.text || "").slice(0, bd.MAX_DIKTAT) + (ergaenzung ? "\n" + ergaenzung : "")).slice(0, bd.MAX_DIKTAT);
      const art = ["angebot", "rechnung"].includes(b.art) ? b.art : "rechnung";
      const firmaId = String(b.firma_id || "").slice(0, 12);

      let firmen = [];
      try { firmen = await crm.firmenListe(u, { limit: 300 }); } catch { firmen = []; }
      firmen = [...firmen].sort((a, b2) => a.name.localeCompare(b2.name, "de"));

      if (!text.trim()) return res.send(diktatSeite(u, { text, art, firmaId, firmen, q: { fehler: "leer" } }));

      const erg = await bd.verstehen(u, { text, art, firmaId });
      res.send(vorschauSeite(u, { text, art, firmen, erg }));
    } catch (err) { next(err); }
  });

  // Die Vorschau: was aus welchem Satz wurde. Sie ist der Grund, warum hier
  // noch nichts gespeichert ist.
  function vorschauSeite(u, { text, art, firmen, erg }) {
    const w = erg.entwurf;
    const gewaehlt = erg.firma ? String(erg.firma.id) : "";
    const sicher = { hoch: "gruen", mittel: "bernstein", niedrig: "rot" }[w.sicherheit] || "grau";
    const zeile = (label, wert, hilfe = "") =>
      `<div class="os-zeile os-zeile--text"><span class="os-zeile-label">${e(label)}</span>
        <div class="os-zeile-wert" data-leer="Nicht genannt">${wert || ""}</div>${hilfe ? `<span class="os-zeile-hilfe">${e(hilfe)}</span>` : ""}</div>`;
    const posZeilen = w.positionen.map((p, i) => `<tr>
      <td class="dk-pos-nr">${i + 1}</td>
      <td><span class="zeile-titel">${e(p.titel)}</span>${p.beschreibung ? `<span class="rg-sub">${e(p.beschreibung)}</span>` : ""}</td>
      <td>${String(p.menge).replace(".", ",")} ${e(p.einheit)}</td>
      <td class="rg-betrag">${geld(p.einzelpreis)}</td>
      <td class="rg-betrag">${geld(rg.positionSumme(p))}</td></tr>`).join("");

    const treffer = erg.treffer && erg.treffer.length ? erg.treffer : [];
    const firmenListe = [...treffer, ...firmen.filter((f) => !treffer.some((t) => String(t.id) === String(f.id)))];

    return seite(u, "Verstanden?", `${artWort(w.art)} · ${w.firma || "ohne Kunde"}`, `
      <div class="os-kopf"><div><div class="os-kopf-titel">Das habe ich verstanden</div>
        <div class="os-kopf-unter">Noch ist nichts gespeichert. Passt es, wird ein <b>Entwurf</b> daraus — ohne Nummer, jederzeit änderbar.</div>
        <div class="os-kopf-pillen"><span class="os-pille">${e(artWort(w.art))}</span>
          <span class="os-pille os-pille--${sicher} os-pille--punkt">Sicherheit ${e(w.sicherheit)}</span>
          ${erg.entwurf.leer ? '<span class="os-pille os-pille--rot">ohne Sprachmodell</span>' : ""}</div></div></div>

      ${w.warnungen.map((x) => `<div class="os-hinweis os-hinweis--warn">${ICON.warnung}<div>${e(x)}</div></div>`).join("")}
      ${w.hinweis ? `<div class="os-hinweis os-hinweis--info">${ICON.info}<div><b>Hinweis aus dem Verstehen:</b> ${e(w.hinweis)}</div></div>` : ""}

      <form method="post" action="/buchhaltung/rechnungen/diktat/anlegen" class="os-breite-mittel">
        <input type="hidden" name="entwurf" value="${e(JSON.stringify(w))}">
        <input type="hidden" name="text" value="${e(text)}">

        <div class="os-spalten os-spalten--2">
          <section class="os-gruppe">
            <div class="os-gruppe-titel">Empfänger</div>
            <div class="os-gruppe-rumpf">
              <label class="os-zeile os-zeile--eingabe">
                <span class="os-zeile-label">Kunde aus dem CRM</span>
                <div class="os-zeile-wert"><select name="firma_id">
                  <option value="">— keiner (Empfänger nur aus dem Text) —</option>
                  ${firmenListe.map((f) => `<option value="${f.id}" ${gewaehlt === String(f.id) ? "selected" : ""}>${e(f.name)}</option>`).join("")}
                </select></div>
                <span class="os-zeile-hilfe">${erg.firma ? "Aus dem Diktat erkannt. Adresse und Mailadresse kommen aus der Akte."
                  : "Nicht eindeutig erkannt — bitte auswählen, sonst fehlen Adresse und Mailadresse."}</span>
              </label>
              ${zeile("Im Text genannt", e(w.firma))}
              ${zeile("Ansprechpartner", e([w.anrede, w.ansprechpartner].filter(Boolean).join(" ")))}
            </div>
          </section>

          <section class="os-gruppe">
            <div class="os-gruppe-titel">Eckdaten</div>
            <div class="os-gruppe-rumpf">
              ${zeile("Kurzbezeichnung", e(w.titel))}
              ${zeile("Vorlage", e(rg.VORLAGEN[w.vorlage].titel || "Frei"))}
              ${zeile("Belegdatum", datum(w.datum))}
              ${zeile(w.art === "angebot" ? "Gültig bis" : "Zahlungsziel",
                `${datum(w.faellig)} <span class="rg-sub">${w.faellig_tage} Tage</span>`)}
              ${w.leistungsdatum ? zeile("Leistungsdatum", datum(w.leistungsdatum)) : ""}
              ${w.abschlag_prozent !== null ? zeile("Abschlag",
                `${String(w.abschlag_prozent).replace(".", ",")} %${w.gesamtbetrag !== null ? ` von ${geld(w.gesamtbetrag)}` : ""}`) : ""}
            </div>
          </section>
        </div>

        <section class="os-gruppe">
          <div class="os-gruppe-titel">Positionen<span class="os-gruppe-werkzeug">Summe ${geld(w.summe)}</span></div>
          ${w.positionen.length ? `<div class="os-tabelle-huelle"><table class="os-tabelle">
            <thead><tr><th>Pos.</th><th>Leistung</th><th>Menge</th><th class="rechts">Einzelpreis</th><th class="rechts">Gesamt</th></tr></thead>
            <tbody>${posZeilen}</tbody>
            <tfoot><tr><td></td><td colspan="3" class="rechts"><b>Gesamt</b></td><td class="rg-betrag"><b>${geld(w.summe)}</b></td></tr></tfoot>
            </table></div>`
            : `<div class="os-gruppe-rumpf"><div class="os-leer os-leer--klein"><h3>Keine Position erkannt</h3>
                <p>Leg den Entwurf trotzdem an und trag Leistung und Betrag im Formular nach — oder ergänze unten, was fehlt, und lass es nochmal lesen.</p></div></div>`}
        </section>

        ${w.art === "angebot" && w.nutzen.length ? `<section class="os-gruppe">
          <div class="os-gruppe-titel">Nutzenpunkte fürs Angebot</div>
          <div class="os-gruppe-rumpf">${w.nutzen.map((n) => `<div class="os-zeile os-zeile--text"><div class="os-zeile-wert">${e(n)}</div></div>`).join("")}</div>
        </section>` : ""}

        <div class="dk-aktionen">
          <button type="submit" class="dunkel">${ICON.check} Passt — Entwurf anlegen</button>
          <a class="rg-knopf sekundaer" href="/buchhaltung/rechnungen/diktat?text=${encodeURIComponent(text)}&art=${e(w.art)}">Verwerfen und neu tippen</a>
        </div>
      </form>

      <form method="post" action="/buchhaltung/rechnungen/diktat" class="os-breite-mittel dk-nochmal">
        <input type="hidden" name="text" value="${e(text)}">
        <input type="hidden" name="art" value="${e(w.art)}">
        <input type="hidden" name="firma_id" value="${e(gewaehlt)}">
        <section class="os-gruppe">
          <div class="os-gruppe-titel">Nochmal, mit Ergänzung</div>
          <div class="os-gruppe-rumpf">
            <div class="os-zeile os-zeile--text"><span class="os-zeile-label">Dein Text</span>
              <div class="os-zeile-wert dk-diktat-echo">${e(text)}</div></div>
            <label class="os-zeile os-zeile--eingabe">
              <span class="os-zeile-label">Was noch dazu soll</span>
              <div class="os-zeile-wert"><textarea name="ergaenzung" rows="2" placeholder="z. B. Zahlungsziel 30 Tage, Leistungsdatum 15.9."></textarea></div>
              <span class="os-zeile-hilfe">Wird an deinen Text angehängt, dann wird nochmal gelesen.</span>
            </label>
          </div>
        </section>
        <div class="dk-aktionen"><button type="submit" class="sekundaer">${ICON.neu} Ergänzen und nochmal lesen</button></div>
      </form>`);
  }

  // -------------------------------------------------- Vorschau -> Entwurf
  app.post("/buchhaltung/rechnungen/diktat/anlegen", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const b = req.body || {};
      // Was aus dem Browser zurueckkommt, wird NOCHMAL durch saeubern geschickt.
      // Das versteckte Feld ist Text im Formular eines Nutzers — vertrauenswuerdig
      // ist daran nichts.
      let roh = {};
      try { roh = JSON.parse(String(b.entwurf || "{}")); } catch { roh = {}; }
      const entwurf = bd.saeubern(roh, { art: roh.art });
      entwurf.notiz = String(roh.notiz || b.text || "").slice(0, bd.MAX_DIKTAT);

      let firma = null;
      if (/^\d+$/.test(String(b.firma_id || ""))) {
        const f = await bd.firmaZuordnen(u, "", b.firma_id);
        firma = f.firma;
      }
      let erg;
      try { erg = await bd.entwurfAnlegen(u, entwurf, { firma }); }
      catch (err) {
        if (!migrationFehlt(err)) throw err;
        return res.redirect("/buchhaltung/rechnungen/diktat?fehler=migration-fehlt");
      }
      if (!erg.ok) {
        const p = new URLSearchParams({ fehler: erg.grund || "unbekannt", text: entwurf.notiz || String(b.text || ""), art: entwurf.art });
        return res.redirect("/buchhaltung/rechnungen/diktat?" + p);
      }
      // Auf die Vorgangsseite von D1. "entworfen" ist der Code aus dem Auftrag;
      // kennt ihn deren OKTEXTE (noch) nicht, wird der bestehende genommen —
      // sonst kaeme man auf einer Seite ganz ohne Rueckmeldung an.
      let ok = "entworfen";
      try {
        const r = require("./rechnungen-routes.js");
        if (!r.OKTEXTE || !Object.hasOwn(r.OKTEXTE, "entworfen")) ok = "angelegt";
      } catch { ok = "angelegt"; }
      res.redirect(`/buchhaltung/rechnungen/${erg.id}?ok=${ok}`);
    } catch (err) { next(err); }
  });

  // =====================================================================
  // Die Nachricht
  // =====================================================================
  async function nachrichtSeite(u, req, r, { kanal, betreff = null, text = null, q = {} }) {
    const basis = `/buchhaltung/rechnungen/${r.id}`;
    const wa = kanal === "whatsapp";
    const wort = r.art === "angebot" ? "Angebot" : (r.abschlag_von ? "Abschlagsrechnung" : "Rechnung");

    // Noch ein Entwurf? Dann gibt es keine Nummer, und ohne Nummer ist die
    // Nachricht unbrauchbar (der Verwendungszweck IST die Nummer). Also erst
    // stellen — sichtbar und auf Knopfdruck, nicht heimlich beim Seitenaufruf.
    if (r.status === "entwurf") {
      return seite(u, `Nachricht zu ${nummerText(r)}`, e(r.empfaenger.name || ""), `
        <div class="os-kopf"><div><a class="os-kopf-zurueck" href="${basis}">Zurück zum Vorgang</a>
          <div class="os-kopf-titel">${e(wort)} — noch ein Entwurf</div>
          <div class="os-kopf-unter">Ein Beleg ohne Nummer geht nicht raus: Der Verwendungszweck auf der Überweisung <i>ist</i> die Nummer.</div></div></div>
        ${hinweise(q)}
        <div class="os-hinweis os-hinweis--info">${ICON.info}<div>Beim Stellen wird die nächste Nummer aus dem Kreis gezogen und das PDF eingefroren. Danach schreibe ich die Nachricht.</div></div>
        <form method="post" action="${basis}/nachricht" class="os-breite-schmal">
          <input type="hidden" name="stellen" value="1"><input type="hidden" name="kanal" value="${e(kanal)}">
          <div class="dk-aktionen"><button type="submit" class="dunkel">${ICON.check} Stellen und Nachricht schreiben</button>
            <a class="rg-knopf sekundaer" href="${basis}">Abbrechen</a></div>
        </form>`);
    }

    let firma = null;
    if (r.firma_id) { try { firma = await crm.firmaKurz(u, r.firma_id); } catch { firma = null; } }

    // Der PDF-Link entsteht nur fuer WhatsApp — bei der Mail haengt das PDF an,
    // und ein Link, den niemand braucht, waere ein Zugang, den niemand braucht.
    let link = null, linkFehler = "";
    if (wa) {
      try { link = await bv.linkHolen(u, r.id, { basis: basisUrl(req) }); } catch { link = null; }
      if (!link) linkFehler = "Der PDF-Link ließ sich nicht anlegen — die Nachricht kündigt das PDF stattdessen per E-Mail an.";
    }
    const pdfLink = link ? link.url : "";

    const vorschlag = (betreff === null && text === null)
      ? await bv.textBauen(u, r, { kanal, pdfLink })
      : { betreff: betreff ?? "", text: text ?? "", quelle: "eigen", verworfen: "" };

    const an = wa
      ? (String(q.an || "") || bv.whatsappVorschlag(r, firma))
      : (String(q.an || "") || bv.mailVorschlag(r, firma));
    const protokoll = await bv.protokoll(u, r.id);
    const seg = (k, titel, icon) => `<a href="${basis}/nachricht?kanal=${k}" class="${kanal === k ? "aktiv" : ""}">${icon} ${titel}</a>`;

    return seite(u, `Nachricht zu ${nummerText(r)}`, e(r.empfaenger.name || ""), `
      <div class="os-kopf"><div><a class="os-kopf-zurueck" href="${basis}">Zurück zum Vorgang</a>
        <div class="os-kopf-titel">Nachricht zu ${e(nummerText(r))}</div>
        <div class="os-kopf-unter">${e(wort)} über ${geld(r.summe)} an ${e(r.empfaenger.name || "—")} · ${r.art === "angebot" ? "gültig bis" : "fällig"} ${datum(r.faellig)}</div>
        <div class="os-kopf-pillen"><span class="os-pille os-pille--${r.status_farbe}">${e(r.status_text)}</span>
          ${r.versendet_am ? `<span class="os-pille os-pille--blau">schon einmal verschickt</span>` : ""}</div></div></div>
      ${hinweise(q)}
      ${linkFehler ? `<div class="os-hinweis os-hinweis--warn">${ICON.warnung}<div>${e(linkFehler)}</div></div>` : ""}
      ${vorschlag.verworfen ? `<div class="os-hinweis os-hinweis--info">${ICON.info}<div>${e(vorschlag.verworfen)}</div></div>` : ""}

      <nav class="os-segment dk-kanal" role="tablist">${seg("mail", "E-Mail", ICON.mail)}${seg("whatsapp", "WhatsApp", ICON.chat)}</nav>

      <form method="post" action="${basis}/senden-als" class="os-breite-schmal">
        <input type="hidden" name="kanal" value="${e(kanal)}">
        <section class="os-gruppe">
          <div class="os-gruppe-titel">${wa ? "WhatsApp" : "E-Mail"}
            <span class="os-gruppe-werkzeug">${vorschlag.quelle === "modell" ? "vorgeschlagen" : "feste Fassung"}</span></div>
          <div class="os-gruppe-rumpf">
            <label class="os-zeile os-zeile--eingabe">
              <span class="os-zeile-label">${wa ? "WhatsApp-Nummer" : "An"}</span>
              <div class="os-zeile-wert"><input name="an" value="${e(an)}" ${wa ? 'inputmode="tel" placeholder="0151 12345678"' : 'type="email" placeholder="info@firma.de"'} required></div>
              <span class="os-zeile-hilfe">${wa
                ? (an ? "Aus der Kundenakte (Mobil, sonst Telefon)." : "In der Akte steht keine Nummer — hier eintragen.")
                : (an ? "Aus dem Beleg bzw. der Kundenakte." : "Am Beleg steht keine Mailadresse — hier eintragen.")}</span>
            </label>
            ${wa ? "" : `<label class="os-zeile os-zeile--eingabe">
              <span class="os-zeile-label">Betreff</span>
              <div class="os-zeile-wert"><input name="betreff" value="${e(vorschlag.betreff)}" required></div></label>`}
            <label class="os-zeile os-zeile--eingabe">
              <span class="os-zeile-label">Text</span>
              <div class="os-zeile-wert"><textarea name="text" rows="${wa ? 6 : 12}" required>${e(vorschlag.text)}</textarea></div>
              <span class="os-zeile-hilfe">${wa
                ? `Höchstens ${bv.WA_MAX} Zeichen. Nummer, Betrag und Fälligkeit müssen drinbleiben.`
                : "Nummer, Betrag und Fälligkeit müssen drinbleiben."}</span>
            </label>
            <div class="os-zeile os-zeile--text">
              <span class="os-zeile-label">Anhang</span>
              <div class="os-zeile-wert">${wa
                ? (pdfLink ? `Kein Anhang — WhatsApp kann keine Datei mitschicken. Stattdessen der Link <code class="dk-link">${e(pdfLink)}</code>`
                           : "Kein Anhang und kein Link — die Nachricht kündigt das PDF per E-Mail an.")
                : `${e(nummerText(r))}.pdf`}</div>
              ${wa && link ? `<span class="os-zeile-hilfe">Gültig bis ${datum(link.gueltig_bis)} (${bv.LINK_TAGE} Tage). Danach ist der Link tot.</span>` : ""}
            </div>
          </div>
        </section>
        <div class="dk-aktionen">
          <button type="submit" class="dunkel" name="modus" value="senden">${ICON.senden} Jetzt senden</button>
          ${wa ? "" : `<button type="submit" class="sekundaer" name="modus" value="entwurf">${ICON.mail} Als Entwurf in Gmail</button>`}
          <button type="submit" class="still" formaction="${basis}/nachricht" formmethod="post" formnovalidate name="neu" value="1">${ICON.neu} Neu formulieren</button>
        </div>
      </form>

      <section class="os-gruppe os-breite-schmal">
        <div class="os-gruppe-titel">Was schon rausging</div>
        ${protokoll.length ? `<div class="os-gruppe-rumpf">${protokoll.map((p) => `
          <div class="os-zeile os-zeile--text">
            <span class="os-zeile-label">${e(kanalWort(p.kanal))} · ${e(p.an || "—")}</span>
            <div class="os-zeile-wert">${p.fehler ? `<span class="dk-fehler">Fehlgeschlagen: ${e(p.fehler)}</span>`
              : p.abgefangen ? '<span class="os-pille os-pille--bernstein">Probemodus — abgefangen</span>'
              : p.gesendet_am ? `Gesendet am ${e(zeitDe(p.gesendet_am))}`
              : "Als Entwurf abgelegt"}</div>
            <span class="os-zeile-hilfe">${e(zeitDe(p.erstellt))}</span>
          </div>`).join("")}</div>`
          : `<div class="os-gruppe-rumpf"><div class="os-leer os-leer--klein"><h3>Noch nichts verschickt</h3>
              <p>Sobald du sendest, steht hier, wann und an wen — auch die im Probemodus abgefangenen Versuche.</p></div></div>`}
      </section>`);
  }

  const kanalWort = (k) => ({ mail: "E-Mail", "mail-entwurf": "E-Mail (Entwurf)", whatsapp: "WhatsApp" }[k] || k);
  const zeitDe = (t) => {
    if (!t) return "";
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  const kanalVon = (x) => (bv.KANAELE.includes(x) ? x : "mail");

  app.get("/buchhaltung/rechnungen/:id(\\d+)/nachricht", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      let r;
      try { r = await rg.eine(u, req.params.id); }
      catch (err) { if (!migrationFehlt(err)) throw err; return res.redirect("/buchhaltung/rechnungen?fehler=migration-fehlt"); }
      if (!r) return res.redirect("/buchhaltung/rechnungen?fehler=nicht-gefunden");
      res.send(await nachrichtSeite(u, req, r, { kanal: kanalVon(req.query.kanal), q: req.query }));
    } catch (err) { next(err); }
  });

  // Neu formulieren, Kanal wechseln — und der eine Fall, in dem hier gestellt
  // wird (Entwurf ohne Nummer).
  app.post("/buchhaltung/rechnungen/:id(\\d+)/nachricht", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const b = req.body || {};
      const kanal = kanalVon(b.kanal);
      let r = await rg.eine(u, req.params.id);
      if (!r) return res.redirect("/buchhaltung/rechnungen?fehler=nicht-gefunden");
      const q = {};
      if (b.stellen === "1" && r.status === "entwurf") {
        const erg = await rg.stellen(u, r.id, { unterschrift: u.name });
        if (!erg.ok) return res.redirect(`/buchhaltung/rechnungen/${r.id}?fehler=${encodeURIComponent(erg.grund || "unbekannt")}`);
        r = await rg.eine(u, r.id);
        q.ok = "gestellt";
      }
      // "Neu formulieren" heisst: Vorschlag verwerfen, nochmal bauen lassen.
      // Der Empfaenger bleibt stehen — den hat vielleicht gerade jemand getippt.
      if (b.an) q.an = String(b.an).slice(0, 200);
      res.send(await nachrichtSeite(u, req, r, { kanal, q }));
    } catch (err) { next(err); }
  });

  // -------------------------------------------------- Senden
  app.post("/buchhaltung/rechnungen/:id(\\d+)/senden-als", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const b = req.body || {};
      const kanal = kanalVon(b.kanal);
      const modus = b.modus === "entwurf" ? "entwurf" : "senden";
      const r = await rg.eine(u, req.params.id);
      if (!r) return res.redirect("/buchhaltung/rechnungen?fehler=nicht-gefunden");
      const zurueck = (p) => res.redirect(`/buchhaltung/rechnungen/${r.id}/nachricht?kanal=${kanal}&${p}`);

      const erg = await bv.senden(u, r, { kanal, an: b.an, betreff: b.betreff, text: b.text, modus });
      if (!erg.ok) return zurueck(`fehler=${encodeURIComponent(erg.grund || "unbekannt")}&an=${encodeURIComponent(String(b.an || "").slice(0, 200))}`);
      const ok = erg.abgefangen ? "abgefangen"
        : modus === "entwurf" ? "entwurf"
        : kanal === "whatsapp" ? "gesendet-whatsapp" : "gesendet";
      zurueck(`ok=${ok}`);
    } catch (err) { next(err); }
  });
};
