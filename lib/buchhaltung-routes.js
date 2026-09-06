// Flowstate Buchhaltung — die Seiten und Endpunkte.
// Eigenes Modul, damit der Eingriff in server.js (Lukas' Datei) bei zwei Zeilen bleibt.
//
// UMBAU 05.09.2026 (Auftrag D2, "hochmodernes Buchhaltungsmodul"). Bis heute
// war /buchhaltung EINE Seite mit vierzehn Karten uebereinander — Kontostand,
// Kacheln, Verlauf, zwei Belegkaesten mit Pruefmasken, Monatsordner, Kanzlei.
// Jetzt sind es fuenf Seiten unter einer gemeinsamen Reiterleiste
// (lib/buchhaltung-unternav.js, geteilt mit lib/rechnungen-routes.js):
//
//   /buchhaltung          Uebersicht: Kacheln, "Zu tun", Verlauf, letzte Buchungen
//   /buchhaltung/belege   Belegeingang mit Filtern, Pruef-Blatt, Postfach-Knopf
//   /buchhaltung/scan     Handy-Scan (Kamera -> hochladen -> lesen -> buchen)
//   /buchhaltung/monate   Monatsabschluss: Excel, ZIP, an die Kanzlei
//   /buchhaltung/kosten   Kosten-Dashboard: noch zu zahlen, Fixkosten, Kategorien
//
// Bausteine aus public/os-ui.css (Design-Leitfaden 01-design.md); eigene
// Klassen mit Praefix .buch- in public/buchhaltung.css. Alle Seiten nur fuer
// die Geschaeftsfuehrung (nurAdmin), die Datenbank sieht es genauso (RLS).
const express = require("express");
const fs = require("fs");
const path = require("path");

// Wie der Agent heisst (AGENT_NAME). Leer = Alexandra.
const AGENT = process.env.AGENT_NAME || "Alexandra";
const { schale } = require("./schale.js");
const { unternav } = require("./buchhaltung-unternav.js");
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
const zeitpunkt = (d) => (d ? new Date(d).toLocaleString("de-DE",
  { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");
// Lokale Datumsfelder — nie toISOString(), das dreht oestlich von UTC auf den Vortag.
const datumFeld = (w) => buch.rechnen.tagText(w);
const heuteFeld = () => datumFeld(new Date());
const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const monatName = (jahr, monat) => `${buch.MONATSNAME[monat - 1]} ${jahr}`;

// Cache-Stempel fuer das eigene Stylesheet — dasselbe Muster wie in
// lib/schale.js (dort nicht exportiert) und lib/whiteboard-routes.js: neue
// Datei -> neue URL, sonst laeuft nach einem Deploy das alte CSS weiter.
const stempel = new Map();
function v(datei) {
  const jetzt = Date.now();
  const c = stempel.get(datei);
  if (c && jetzt - c.geprueft < 5000) return c.url;
  let url = datei;
  try {
    const st = fs.statSync(path.join(__dirname, "..", "public", datei.replace(/^\//, "")));
    url = `${datei}?v=${Math.round(st.mtimeMs).toString(36)}`;
  } catch { /* Datei fehlt: ohne Stempel ausliefern */ }
  stempel.set(datei, { url, geprueft: jetzt });
  return url;
}

const ZEITRAUM_LABEL = {
  monat: new Date().toLocaleDateString("de-DE", { month: "long" }),
  m3: "3 Monate", m6: "6 Monate", m12: "12 Monate", alle: "Insgesamt",
};

const S = (d, b = 24) => `<svg viewBox="0 0 ${b} ${b}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  euro: S('<path d="M15 18a6 6 0 1 1 0-12M4 10h8M4 14h8"/>'),
  ab: S('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
  auf: S('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  uhr: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  check: S('<path d="M20 6L9 17l-5-5"/>'),
  ordner: S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  x: S('<path d="M18 6L6 18M6 6l12 12"/>'),
  prozent: S('<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
  warnung: S('<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  kamera: S('<path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>'),
  mail: S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  tabelle: S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>'),
  senden: S('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
  datei: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
  bild: S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>'),
  handy: S('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'),
  nochmal: S('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  lupe: S('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  wiederholen: S('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  liste: S('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>'),
};

// ------------------------------------------------------ Sichtbar scheitern
//
// STUMM VERWORFEN (Fehler gefunden am 20.08.2026).
//
// Vier Endpunkte leiten bei einem Fehlschlag auf "/buchhaltung?fehler=…" um —
// und die Seite hat req.query.fehler NIRGENDS gelesen. Live gemessen:
// /buchhaltung und /buchhaltung?fehler=mail waren byteidentisch.
//
// Der Fall, der es aufgedeckt hat: Lukas tippt "meier@kanzlei" ins
// Kanzlei-Feld. einstellungenSetzen() lehnt richtig ab und speichert die
// Adresse nicht, der Name aber schon. Der Dialog schliesst, die Seite laedt neu
// und sieht aus wie immer — kein Wort dazu. Erst wenn Alexandra Wochen spaeter
// wieder nach der Adresse fragt, faellt es auf.
//
// Eine abgelehnte Eingabe MUSS man sehen. Das Muster steht in
// lib/kalender-routes.js:221 und ist hier bewusst dasselbe. Seit 05.09. gilt
// es fuer alle fuenf Seiten: jede rendert hinweisBlock(req).
const FEHLERTEXTE = {
  mail: `<b>Die Adresse wurde nicht gespeichert.</b> Das sah nicht nach einer vollständigen
     Mailadresse aus — es fehlt meist die Endung, also <code>meier@kanzlei.de</code> statt
     <code>meier@kanzlei</code>. Alles andere ist gespeichert; trag die Adresse einfach nochmal ein.`,
  kanzlei: `<b>Die Steuerkanzlei wurde nicht gespeichert.</b> Bitte noch einmal eintragen —
     wenn es wieder scheitert, steht der Grund im Serverprotokoll.`,
  "migration-fehlt": `<b>Die Steuerkanzlei lässt sich hier noch nicht speichern.</b>
     In der Datenbank fehlt Migration 0055. Einspielen mit
     <code>docker exec flowstate-dashboard node scripts/migrate.js</code>, danach geht es.`,
  "migration-0061": `<b>Dafür fehlt Migration 0061 in der Datenbank.</b> Einspielen mit
     <code>docker exec flowstate-dashboard node scripts/migrieren.js --einspielen</code> —
     hochladen, buchen und der Monatsordner gehen auch so.`,
  betrag: `<b>Die Buchung wurde nicht gespeichert.</b> Der Betrag fehlte oder war nicht lesbar —
     er muss eine Zahl sein (<code>1250</code> oder <code>19,90</code>).`,
  datum: `<b>Der Beleg wurde nicht gebucht.</b> Es fehlt das Belegdatum — ohne das
     landet er in keinem Monatsordner.`,
  "schon-gebucht": `<b>Der Beleg ist bereits gebucht.</b> Zweimal wird er nicht gebucht —
     du findest ihn unter den Bewegungen.`,
  verworfen: `<b>Der Beleg wurde verworfen.</b> Verworfene Belege lassen sich nicht buchen.`,
  "nicht-gefunden": `<b>Den Beleg gibt es nicht mehr.</b> Er wurde zwischenzeitlich gelöscht
     oder gehört zu einem anderen Konto.`,
  "nicht-offen": `<b>Der Beleg ist nicht mehr offen.</b> Neu gelesen wird nur, was noch zu prüfen ist.`,
  "kein-grund": `<b>Ohne Grund wird nicht verworfen.</b> Drei Zeichen reichen — „Doppel“, „privat“, „Fehlscan“.`,
  leer: `<b>Für diesen Monat ist nichts bezahlt worden</b> — es gibt nichts zu packen.`,
  zeitraum: `<b>Ungültiger Monat.</b>`,
  "kanzlei-fehlt": `<b>Noch keine Steuerkanzlei hinterlegt.</b> Trag unten unter „Steuerkanzlei“ Name und
     Mailadresse ein — dann geht der Monat mit einem Klick raus.`,
  "mail-kein-zugang": `<b>Auf dieser Maschine gibt es keinen Postfach-Zugang.</b> Der Postfach-Import läuft
     auf dem Server, wo der Google-Zugang (gws-cli) hinterlegt ist — dort täglich von selbst und
     hier per Knopf. Belege lassen sich trotzdem jederzeit hochladen.`,
  "fixkosten-doppelt": `<b>Für diesen Monat ist die Kostenstelle schon gebucht.</b> Ein zweites Mal wird
     sie nicht angelegt — die Buchung steht in den Bewegungen.`,
  "keine-datei": `<b>Es kam keine Datei an.</b> Bitte noch einmal auswählen.`,
};

// Fehler mit Zusatztext aus der Adresszeile (maskiert): ein Grund, den der
// Server gerade erst erfahren hat (Postfach nicht erreichbar: …).
const FEHLER_MIT_TEXT = {
  "mail-fehler": (t) => `<b>Postfach nicht erreichbar.</b> ${e(t)}`,
  "kanzlei-versand": (t) => `<b>Der Monat ist nicht rausgegangen.</b> ${e(t)}`,
  "nicht-gelesen": (t) => `<b>Der Beleg ließ sich nicht auslesen.</b> ${e(t)} Die Werte lassen sich von Hand eintragen.`,
  hochladen: (t) => `<b>Die Datei kam nicht an.</b> ${e(t)}`,
};

// Unbekannte Codes werden NICHT verschluckt: Ein Fehler, den diese Tabelle noch
// nicht kennt, ist immer noch ein Fehler und gehoert auf die Seite.
const fehlerText = (code, text = "") => {
  if (!code) return "";
  if (FEHLERTEXTE[code]) return FEHLERTEXTE[code];
  if (FEHLER_MIT_TEXT[code]) return FEHLER_MIT_TEXT[code](String(text || "").slice(0, 300));
  return `<b>Das hat nicht geklappt.</b> Gespeichert wurde nichts. Meldung: <code>${e(code)}</code>`;
};

// Das Gegenstueck: Was gerade gelungen ist. Ebenfalls per Adresszeile, damit
// ein Neuladen der Seite die Meldung nicht wiederholt ausloest.
const HINWEISTEXTE = {
  gebucht: () => `<b>Beleg gebucht.</b> Er zählt ab jetzt in den Zahlen und liegt im Monatsordner seines Zahltags.`,
  offen: () => `<b>Beleg gebucht — wartet auf die Zahlung.</b> Er steht unter „Offen“ und zählt erst, wenn das Geld geflossen ist.`,
  erfasst: () => `<b>Buchung erfasst.</b>`,
  "erfasst-offen": () => `<b>Buchung erfasst — noch nicht bezahlt.</b> Sie steht unter „Kosten“ bzw. „Offen“, bis du sie abhakst.`,
  bezahlt: () => `<b>Als bezahlt markiert.</b> Der Zahltag entscheidet über den Monatsordner.`,
  geloescht: () => `<b>Buchung zurückgenommen.</b> Ein zugehöriger Beleg liegt wieder im Eingang.`,
  verworfen: () => `<b>Beleg verworfen.</b> Er bleibt mit Grund nachweisbar, zählt aber nirgends mehr.`,
  gelesen: () => `<b>Beleg neu gelesen.</b> Die erkannten Werte stehen in der Maske — bitte gegenlesen.`,
  hochgeladen: (q) => {
    const n = Number(q.n) || 0, d = Number(q.doppelt) || 0;
    return `<b>${n} ${n === 1 ? "Beleg" : "Belege"} abgelegt${d ? `, ${d} lag${d === 1 ? "" : "en"} schon da` : ""}.</b> ${n ? "Jetzt prüfen und buchen." : ""}`;
  },
  "mail-import": (q) => {
    const n = Number(q.neu) || 0, u = Number(q.uebersprungen) || 0, t = Number(q.tage) || 0;
    return n
      ? `<b>${n} neue ${n === 1 ? "Rechnung" : "Rechnungen"} aus dem Postfach.</b> ${u ? `${u} nicht verarbeitet. ` : ""}Sie liegen zum Prüfen bereit.`
      : `<b>Keine neuen Rechnungen im Postfach</b> (${t} Tage geprüft${u ? `, ${u} nicht verarbeitet` : ""}).`;
  },
  "kanzlei-entwurf": (q) => `<b>Liegt als Entwurf in Gmail an ${e(q.an || "die Kanzlei")}.</b> Ansehen, prüfen, abschicken — von dort aus.`,
  "kanzlei-gesendet": (q) => `<b>Rausgegangen an ${e(q.an || "die Kanzlei")}.</b>`,
  "kanzlei-probe": (q) => `<b>Probemodus: nichts hat das Haus verlassen.</b> Der Versand an ${e(q.an || "die Kanzlei")} wurde abgefangen und protokolliert (probe-abgefangen.jsonl).`,
  "fixkosten-gebucht": () => `<b>Diesen Monat gebucht.</b> Die nächste Fälligkeit ist um ein Intervall weitergerückt.`,
  "fixkosten-offen": () => `<b>Für diesen Monat angelegt — noch nicht bezahlt.</b> Steht unter „Noch zu zahlen“.`,
  "fixkosten-beendet": () => `<b>Kostenstelle beendet.</b> Sie zählt nicht mehr zur monatlichen Last.`,
  kasse: () => `<b>Kontostand gespeichert.</b>`,
  "kanzlei-gespeichert": () => `<b>Steuerkanzlei gespeichert.</b>`,
};
const hinweisText = (code, q = {}) => (HINWEISTEXTE[code] ? HINWEISTEXTE[code](q) : "");

// Beide Streifen fuer eine Seite. ?gebucht=<id> / ?offen=<id> sind die alten
// Parameter, die lib/beleg-telegram.js in der Umleitung liest — sie bleiben.
function hinweisBlock(req) {
  const q = req.query || {};
  const raus = [];
  const fehler = String(q.fehler || "").slice(0, 60);
  if (fehler) raus.push(`<div class="os-hinweis os-hinweis--fehler">${ICON.warnung}<div>${fehlerText(fehler, q.text)}</div></div>`);
  const code = String(q.hinweis || (q.gebucht ? "gebucht" : q.offen ? "offen" : "")).slice(0, 40);
  const text = hinweisText(code, q);
  if (text) raus.push(`<div class="os-hinweis os-hinweis--erfolg">${ICON.check}<div>${text}</div></div>`);
  return raus.join("");
}

// Wohin ein Formular nach getaner Arbeit zurueckfuehrt. Kommt aus einem
// verborgenen Feld "zurueck" — und darf nur innerhalb der Buchhaltung liegen,
// sonst waere es eine offene Weiterleitung.
function zurueckZiel(req, standard = "/buchhaltung") {
  const roh = String((req.body && req.body.zurueck) || (req.query && req.query.zurueck) || "");
  return /^\/buchhaltung(\/[A-Za-z0-9_\-/]*)?(\?[A-Za-z0-9_\-=&%.+]*)?$/.test(roh) && !roh.includes("//") ? roh : standard;
}
function mitParam(url, key, wert) {
  const teil = `${encodeURIComponent(key)}=${encodeURIComponent(wert)}`;
  return url + (url.includes("?") ? "&" : "?") + teil;
}
// Die aktuelle Seite ohne Meldungs-Parameter — als "zurueck"-Wert fuer Formulare.
const MELDUNGS_PARAMETER = ["fehler", "hinweis", "gebucht", "offen", "text", "neu", "uebersprungen", "tage", "an", "n", "doppelt"];
function aktuelleUrl(req, { ohne = [] } = {}) {
  const pfad = String(req.path || "/buchhaltung");
  const q = { ...(req.query || {}) };
  for (const k of [...MELDUNGS_PARAMETER, ...ohne]) delete q[k];
  const teile = Object.entries(q)
    .filter(([k, w]) => typeof w === "string" && w !== "" && /^[a-z_]+$/.test(k))
    .map(([k, w]) => `${k}=${encodeURIComponent(String(w).slice(0, 120))}`);
  return pfad + (teile.length ? "?" + teile.join("&") : "");
}

// --------------------------------------------------------------- Bausteine

const pille = (text, ton = "", punkt = false) =>
  `<span class="os-pille${ton ? " os-pille--" + ton : ""}${punkt ? " os-pille--punkt" : ""}">${text}</span>`;

const QUELLE_LABEL = { web: "Browser", handy: "Handy", telegram: "Telegram", mail: "Postfach", akte: "Kundenakte", unbekannt: "vor 0061" };
const quelleLabel = (q) => QUELLE_LABEL[q] || (q ? e(q) : "—");

// Status eines Belegs als Pille — eine Stelle fuer Liste und Blatt.
function belegPille(b) {
  if (b.status === "verworfen") return pille("verworfen", "grau");
  if (b.status === "fehler") return pille("Fehler", "rot", true);
  if (b.status === "gebucht") {
    return b.buchung_bezahlt === false ? pille("wartet auf Zahlung", "bernstein", true) : pille("gebucht", "gruen", true);
  }
  return b.gelesen && b.betrag ? pille("gelesen — prüfen", "blau", true) : pille("zu prüfen", "bernstein", true);
}

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
const SAETZE = [0, 19, 7, -1];
const satzLabel = (s) => (s === -1 ? "gemischt (7 % und 19 %)" : `${s} %`);

const auswahl = (name, werte, gewaehlt, { leer = "", attr = "" } = {}) =>
  `<select name="${name}" ${attr}>${leer ? `<option value="">${e(leer)}</option>` : ""}${
    werte.map((w) => {
      const [wert, text] = Array.isArray(w) ? w : [w, w];
      return `<option value="${e(wert)}" ${String(gewaehlt ?? "") === String(wert) ? "selected" : ""}>${e(text)}</option>`;
    }).join("")}</select>`;

// Das Skript, das jede Seite braucht: Blatt schliesst beim Klick daneben,
// Tabellenzeilen mit data-href sind klickbar, Blatt aus der Adresszeile
// oeffnet sich von selbst.
const SEITEN_SKRIPT = `<script>
(function(){
  document.querySelectorAll("dialog.os-blatt").forEach(function(d){
    d.addEventListener("click",function(ev){if(ev.target===d)d.close()});
  });
  document.addEventListener("click",function(ev){var tr=ev.target.closest("tr[data-href]");
    if(!tr||ev.target.closest("a,button,input,select,label,form"))return;location.href=tr.dataset.href});
  var auf=document.querySelector("dialog.os-blatt[data-auf]");
  if(auf&&typeof auf.showModal==="function"){
    try{auf.showModal()}catch(e){}
    auf.addEventListener("close",function(){
      var u=new URL(location.href);u.searchParams.delete("beleg");history.replaceState(null,"",u.pathname+u.search);
    });
  }
})();
</script>`;

// Bildverkleinerung + Upload, geteilt von Ablagezone und Handy-Scan.
//
// Handyfotos sind oft 4–8 MB gross. Der Lesedienst nimmt Bilder nur bis rund
// 3,5 MB an — ein unveraendert hochgeladenes Foto liesse sich also ablegen,
// aber nicht auslesen, und man muesste alles abtippen. Darum wird ein zu
// grosses Bild hier im Browser verkleinert, bevor es losgeht. 2400 Pixel auf
// der langen Kante sind fuer eine Quittung von etwa 8 cm Breite ueber 700 dpi
// — weit mehr, als zum Lesen noetig ist. PDFs bleiben unangetastet.
// HEIC kann der Browser nicht zeichnen (Befund 2b): dann geht die Datei
// unveraendert hoch — sicher abgelegt, aber nicht lesbar — und der Aufrufer
// bekommt "heic: true", um es zu sagen.
const UPLOAD_SKRIPT = (quelle) => `
  var GRENZE=20*1024*1024, LESEGRENZE=3.4*1024*1024, MAX_KANTE=2400;
  var LESEN=${leser.bereit() ? "true" : "false"};
  function istHeic(f){return /heic|heif/i.test(f.type||"")||/\\.hei[cf]$/i.test(f.name||"")}
  async function verkleinern(f){
    if(!f.type.startsWith("image/")||f.size<=LESEGRENZE) return f;
    try{
      var bild=await createImageBitmap(f);
      var faktor=Math.min(1,MAX_KANTE/Math.max(bild.width,bild.height));
      var b=document.createElement("canvas");
      b.width=Math.round(bild.width*faktor); b.height=Math.round(bild.height*faktor);
      b.getContext("2d").drawImage(bild,0,0,b.width,b.height);
      bild.close&&bild.close();
      var klein=await new Promise(function(fertig){b.toBlob(fertig,"image/jpeg",0.9)});
      if(!klein||klein.size>=f.size) return f;
      klein.name=f.name.replace(/\\.[^.]+$/,"")+".jpg";
      return klein;
    }catch(err){ return f; }
  }
  // Zwei Schritte je Datei, absichtlich getrennt: hochladen (schnell, danach
  // ist der Beleg sicher) und auslesen (dauert). Scheitert das Lesen, liegt
  // die Datei trotzdem im Archiv.
  async function hochladen(f,art,melden){
    if(f.size>GRENZE) throw new Error("größer als 20 MB");
    melden&&melden("Bereite "+f.name+" vor …");
    var datei=await verkleinern(f);
    var name=datei.name||f.name;
    melden&&melden("Lade "+name+" …");
    var a=await fetch("/buchhaltung/beleg/hochladen",{method:"POST",
      headers:{"Content-Type":"application/octet-stream","X-Art":art,
        "X-Dateiname":encodeURIComponent(name),
        "X-Dateityp":datei.type||f.type||"application/octet-stream",
        "X-Quelle":${JSON.stringify(quelle)}},
      body:datei});
    if(a.status===413) throw new Error("zu groß für den Server");
    if(!a.ok) throw new Error("Server "+a.status);
    var r=await a.json();
    if(!r.ok) throw new Error(r.grund||"unbekannt");
    r.heic=istHeic(f);
    return r;
  }
  async function lesen(id,melden){
    if(!LESEN) return null;
    melden&&melden("Lese Beleg …");
    try{
      var r=await fetch("/buchhaltung/beleg/lesen",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id})});
      return await r.json();
    }catch(err){ return null; }
  }`;

// Die Ablagezone fuer Uebersicht und Belege-Seite. Nach dem Ablegen geht es in
// den Belegeingang — bei genau einer Datei direkt ins Pruef-Blatt.
function ablageZone({ art = "ausgabe", quelle = "web", ziel = "/buchhaltung/belege" } = {}) {
  return `<div class="buch-ablage" id="buch-ablage" data-ziel="${e(ziel)}">
    <div class="buch-ablage-icon">${ICON.datei}</div>
    <div class="buch-ablage-text"><b>Beleg hier ablegen</b>
      <span>${leser.bereit()
        ? "PDF oder Foto — die Werte werden ausgelesen, du prüfst nur nach"
        : "PDF, Foto oder Screenshot — oder klicken zum Auswählen"}</span></div>
    <label class="buch-ablage-richtung" onclick="event.stopPropagation()">als
      ${auswahl("art", [["ausgabe", "Ausgabe (Quittung, Eingangsrechnung)"], ["einnahme", "Einnahme (Rechnung an Kunden)"]], art, { attr: 'id="buch-ablage-art"' })}</label>
    <input type="file" id="buch-ablage-feld" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf" multiple>
  </div>
  <script>
  (function(){
    ${UPLOAD_SKRIPT(quelle)}
    var zone=document.getElementById("buch-ablage"), feld=document.getElementById("buch-ablage-feld");
    var text=zone.querySelector(".buch-ablage-text b"), alt=text.textContent;
    zone.addEventListener("click",function(){feld.click()});
    ["dragenter","dragover"].forEach(function(n){zone.addEventListener(n,function(ev){ev.preventDefault();zone.classList.add("bereit")})});
    ["dragleave","drop"].forEach(function(n){zone.addEventListener(n,function(){zone.classList.remove("bereit")})});
    zone.addEventListener("drop",function(ev){ev.preventDefault();schicken(ev.dataTransfer.files)});
    feld.addEventListener("change",function(){schicken(feld.files)});
    async function schicken(dateien){
      var art=document.getElementById("buch-ablage-art").value;
      var n=0, doppelt=0, letzteId=null, fehler=[];
      for(var i=0;i<dateien.length;i++){
        var f=dateien[i];
        try{
          var r=await hochladen(f,art,function(t){text.textContent=t});
          if(r.doppelt){doppelt++;letzteId=r.id;continue}
          n++; letzteId=r.id;
          await lesen(r.id,function(t){text.textContent=t});
        }catch(err){fehler.push(f.name+": "+err.message)}
      }
      text.textContent=alt;
      if(fehler.length) alert("Nicht abgelegt:\\n"+fehler.join("\\n"));
      if(!n&&!doppelt) return;
      var ziel=zone.dataset.ziel;
      var u=ziel+(ziel.indexOf("?")>=0?"&":"?")+"hinweis=hochgeladen&n="+n+"&doppelt="+doppelt;
      if(dateien.length===1&&letzteId) u+="&beleg="+letzteId;
      location.href=u;
    }
  })();
  </script>`;
}

// Das Erfassen-Blatt (Einnahme / Ausgabe von Hand).
function erfassenBlatt(art, kunden, zurueck) {
  const ein = art === "einnahme";
  const kat = ein ? buch.EINNAHME_KATEGORIEN : buch.AUSGABE_KATEGORIEN;
  const id = `blatt-${art}`;
  return `<dialog class="os-blatt" id="${id}" aria-labelledby="${id}-titel">
    <form method="post" action="/buchhaltung/buchen">
      <input type="hidden" name="art" value="${art}">
      <input type="hidden" name="zurueck" value="${e(zurueck)}">
      <header class="os-blatt-kopf">
        <div><h2 id="${id}-titel">${ein ? "Einnahme" : "Ausgabe"} erfassen</h2>
          <p class="os-blatt-unter">${ein ? "Was hereinkommt — ohne Beleg, z. B. eine Überweisung" : "Was hinausgeht — ohne Beleg, z. B. eine Abbuchung"}</p></div>
        <button type="button" class="os-blatt-schliessen" aria-label="Schließen" onclick="this.closest('dialog').close()">${ICON.x}</button>
      </header>
      <div class="os-blatt-rumpf">
        <section class="os-gruppe">
          <div class="os-gruppe-titel">Buchung</div>
          <div class="os-gruppe-rumpf">
            <div class="os-zeile os-zeile--eingabe os-zeile--paar">
              <label class="os-zeile-teil"><span class="os-zeile-label">Datum *</span>
                <div class="os-zeile-wert"><input type="date" name="datum" value="${heuteFeld()}" required></div></label>
              <label class="os-zeile-teil"><span class="os-zeile-label">Betrag *</span>
                <div class="os-zeile-wert"><input name="betrag" required inputmode="decimal" placeholder="0,00 €"></div></label>
            </div>
            ${ein ? `<label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Kunde</span>
              <div class="os-zeile-wert">${auswahl("firma_id", kunden.map((k) => [k.id, k.name]), "", { leer: "— frei eintragen —" })}</div></label>` : ""}
            <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">${ein ? "oder Name frei" : "Empfänger"}</span>
              <div class="os-zeile-wert"><input name="gegenstelle" placeholder="${ein ? "z. B. Müller GmbH" : "z. B. Adobe, Meta, Shell"}"></div></label>
            <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Kategorie</span>
              <div class="os-zeile-wert">${auswahl("kategorie", kat, "", { leer: "— ohne —" })}</div></label>
            <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Notiz</span>
              <div class="os-zeile-wert"><input name="notiz" placeholder="Wofür genau?"></div></label>
          </div>
        </section>
        <section class="os-gruppe">
          <div class="os-gruppe-titel">Zahlung</div>
          <div class="os-gruppe-rumpf">
            <div class="os-zeile os-zeile--eingabe os-zeile--paar">
              <label class="os-zeile-teil"><span class="os-zeile-label">Schon bezahlt?</span>
                <div class="os-zeile-wert">${auswahl("bezahlt", [["ja", ein ? "Ja, ist eingegangen" : "Ja, ist bezahlt"], ["nein", ein ? "Nein, Rechnung offen" : "Nein, noch zu zahlen"]], "ja",
                  { attr: `onchange="this.closest('.os-zeile--paar').querySelector('[name=faellig]').disabled=this.value!=='nein'"` })}</div></label>
              <label class="os-zeile-teil"><span class="os-zeile-label">Fällig bis</span>
                <div class="os-zeile-wert"><input type="date" name="faellig" disabled></div></label>
            </div>
            ${ein ? "" : `<label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Wiederkehrend</span>
              <div class="os-zeile-wert">${auswahl("intervall", [["", "Einmalig"], ["monatlich", "Monatlich (Fixkosten)"], ["jaehrlich", "Jährlich (Fixkosten)"]], "")}</div>
              <span class="os-zeile-hilfe">Wiederkehrende Kosten erscheinen unter „Kosten“ mit ihrer nächsten Fälligkeit — gebucht wird dort per Klick, nie von selbst.</span></label>`}
          </div>
        </section>
      </div>
      <footer class="os-blatt-fuss">
        <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
        <button type="submit" class="dunkel">${ICON.plus} Erfassen</button>
      </footer>
    </form>
  </dialog>`;
}

// Kontostand & Steuersatz als schmales Blatt.
function kasseBlatt(kasse, zurueck) {
  return `<dialog class="os-blatt os-blatt--schmal" id="blatt-kasse" aria-labelledby="blatt-kasse-titel">
    <form method="post" action="/buchhaltung/kasse">
      <input type="hidden" name="zurueck" value="${e(zurueck)}">
      <header class="os-blatt-kopf">
        <div><h2 id="blatt-kasse-titel">Kontostand &amp; Steuersatz</h2>
          <p class="os-blatt-unter">Einmal pro Woche aus dem Online-Banking ablesen</p></div>
        <button type="button" class="os-blatt-schliessen" aria-label="Schließen" onclick="this.closest('dialog').close()">${ICON.x}</button>
      </header>
      <div class="os-blatt-rumpf">
        <section class="os-gruppe">
          <div class="os-gruppe-titel">Kontostand</div>
          <div class="os-gruppe-rumpf">
            <div class="os-zeile os-zeile--eingabe os-zeile--paar">
              <label class="os-zeile-teil"><span class="os-zeile-label">Kontostand</span>
                <div class="os-zeile-wert"><input name="start_saldo" inputmode="decimal" placeholder="0,00 €"
                  value="${kasse.start ? String(kasse.start).replace(".", ",") : ""}"></div></label>
              <label class="os-zeile-teil"><span class="os-zeile-label">Stand vom</span>
                <div class="os-zeile-wert"><input type="date" name="saldo_stand" value="${heuteFeld()}"></div></label>
            </div>
          </div>
          <div class="os-gruppe-fuss">Ab diesem Tag rechnet die Übersicht deine Buchungen dazu: eingetragener Stand
            + bezahlte Einnahmen − bezahlte Ausgaben. Es gibt keine Bankschnittstelle, die den Stand von allein
            holt — darum die Erinnerung, sobald der Eintrag eine Woche alt ist.</div>
        </section>
        <section class="os-gruppe">
          <div class="os-gruppe-titel">Steuer-Rücklage</div>
          <div class="os-gruppe-rumpf">
            <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Steuersatz für die Rücklage (%)</span>
              <div class="os-zeile-wert"><input name="steuersatz" inputmode="decimal" value="${String(kasse.satz).replace(".", ",")}"></div></label>
          </div>
          <div class="os-gruppe-fuss">Rechnet vom <b>Gewinn</b> des laufenden Jahres, nicht vom Umsatz. Der echte Satz hängt von
            Rechtsform und Gewinnhöhe ab — frag im Zweifel die Steuerkanzlei.</div>
        </section>
      </div>
      <footer class="os-blatt-fuss">
        <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
        <button type="submit" class="dunkel">Speichern</button>
      </footer>
    </form>
  </dialog>`;
}

// Die Steuerkanzlei als Gruppe (Monatsabschluss-Seite). Einmal eintragen
// statt jedes Mal diktieren: Alexandra liest die Adresse hier heraus, wenn sie
// den Monatsordner verschicken soll. Steht sie nicht drin, fragt sie nach —
// sie raet keine.
function kanzleiGruppe(einst, zurueck) {
  const kanzleiDa = buch.mailGueltig(einst.steuer_mail);
  return `<section class="os-gruppe" id="kanzlei">
    <div class="os-gruppe-titel">Steuerkanzlei
      <span class="os-gruppe-werkzeug">${kanzleiDa ? pille("hinterlegt", "gruen", true) : pille("fehlt noch", "bernstein", true)}</span></div>
    <form class="os-gruppe-rumpf" method="post" action="/buchhaltung/kanzlei">
      <input type="hidden" name="zurueck" value="${e(zurueck)}">
      <div class="os-zeile os-zeile--eingabe os-zeile--paar">
        <label class="os-zeile-teil"><span class="os-zeile-label">Anrede</span>
          <div class="os-zeile-wert">${auswahl("steuer_anrede", [["", "— keine —"], ["Frau", "Frau"], ["Herr", "Herr"]], einst.steuer_anrede)}</div></label>
        <label class="os-zeile-teil"><span class="os-zeile-label">Name</span>
          <div class="os-zeile-wert"><input name="steuer_name" placeholder="z. B. Meier" value="${e(einst.steuer_name)}"></div></label>
      </div>
      <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">E-Mail *</span>
        <div class="os-zeile-wert"><input type="email" name="steuer_mail" inputmode="email" placeholder="kanzlei@beispiel.de" value="${e(einst.steuer_mail)}"></div>
        <span class="os-zeile-hilfe">An diese Adresse geht der Monatsabschluss. Eine Adresse ohne @ und Endung wird nicht gespeichert.</span></label>
      <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Notiz</span>
        <div class="os-zeile-wert"><textarea name="steuer_notiz" rows="2" placeholder="Kanzlei, Anschrift, Mandantennummer">${e(einst.steuer_notiz)}</textarea></div></label>
      <div class="os-zeile os-zeile--text">
        <span class="os-zeile-label">Versandweg</span>
        <div class="os-zeile-wert">${process.env.STEUER_MODUS === "senden"
          ? "Direkt senden (STEUER_MODUS=senden)"
          : `Als Entwurf in Gmail ablegen — du schaust drüber und schickst selbst ab`}</div>
      </div>
      <div class="os-zeile os-zeile--text" style="align-items:flex-end">
        <button type="submit" class="sekundaer">Speichern</button>
      </div>
    </form>
    <div class="os-gruppe-fuss">Anrede und Name stehen getrennt, weil ${e(AGENT)} den Satz ausspricht:
      „Soll ich sie an <b>Frau Meier</b> schicken?“ Ohne Anrede sagt sie „an Meier“ — sie setzt keine dazu, die nicht hier steht.</div>
  </section>`;
}

// Das Pruef-Blatt fuer einen Beleg: Vorschau links, Maske rechts.
//
// Der Ablauf: Datei ansehen -> die gelesenen Werte gegenlesen -> "Passt &
// buchen". Nichts wird ohne diesen Knopf gebucht. Die Richtung laesst sich
// hier noch umstellen (ein per Mail gekommener Beleg, der eine Kunden-
// rechnung war) — solange der Beleg nicht gebucht ist.
function belegBlatt(b, kunden, listeUrl, hier) {
  const ein = b.art === "einnahme";
  const offen = b.status === "neu" || b.status === "fehler";
  const istBild = /^image\//.test(b.dateityp || "");
  const vorschau = b.hat_datei
    ? (istBild ? `<img src="/buchhaltung/beleg/${b.id}/datei" alt="Beleg ${b.laufnummer ?? ""}">`
      : `<iframe src="/buchhaltung/beleg/${b.id}/datei" title="Beleg ${b.laufnummer ?? ""}"></iframe>`)
    : `<div class="buch-vorschau-leer">Keine Datei hinterlegt</div>`;
  const kopf = `<header class="os-blatt-kopf">
    <div><h2 id="beleg-blatt-titel">Beleg Nr. ${b.laufnummer ?? "–"}${b.gegenstelle || b.firma_name ? ` · ${e(b.gegenstelle || b.firma_name)}` : ""}</h2>
      <p class="os-blatt-unter">${e(b.dateiname)}${b.groesse ? ` · ${Math.round(b.groesse / 1024)} KB` : ""} · ${quelleLabel(b.quelle)} · ${e((b.wer || "").split(" ")[0] || "")} ${zeitpunkt(b.erstellt)}</p></div>
    <button type="button" class="os-blatt-schliessen" aria-label="Schließen" onclick="this.closest('dialog').close()">${ICON.x}</button>
  </header>`;
  const vorschauBlock = `<div class="buch-vorschau">${vorschau}
    <div class="buch-vorschau-fuss"><span>${belegPille(b)}</span>
      ${b.hat_datei ? `<a href="/buchhaltung/beleg/${b.id}/datei" target="_blank">In neuem Tab öffnen ↗</a>` : ""}</div></div>`;

  let rechts, fuss;
  if (offen) {
    const kat = (art) => (art === "einnahme" ? buch.EINNAHME_KATEGORIEN : buch.AUSGABE_KATEGORIEN);
    rechts = `<form method="post" action="/buchhaltung/beleg/buchen" id="beleg-form">
      <input type="hidden" name="id" value="${b.id}">
      <input type="hidden" name="zurueck" value="${e(listeUrl)}">
      ${b.lese_hinweis ? `<div class="os-hinweis os-hinweis--info">${ICON.info}<div>${e(b.lese_hinweis)}</div></div>` : ""}
      ${b.fehler_text ? `<div class="os-hinweis os-hinweis--fehler">${ICON.warnung}<div>${e(b.fehler_text)}</div></div>` : ""}
      ${!b.gelesen && leser.bereit() ? `<div class="os-hinweis os-hinweis--info">${ICON.info}<div>Noch nicht ausgelesen — „Nochmal lesen“ füllt die Felder, oder trag sie von Hand ein.</div></div>` : ""}
      <section class="os-gruppe">
        <div class="os-gruppe-titel">Prüfen</div>
        <div class="os-gruppe-rumpf">
          <div class="os-zeile os-zeile--text">
            <span class="os-zeile-label">Richtung</span>
            <div class="os-zeile-wert buch-radio">
              <label><input type="radio" name="art" value="ausgabe" ${!ein ? "checked" : ""} onchange="buchRichtung(this.form)"> Ausgabe — wir haben bezahlt</label>
              <label><input type="radio" name="art" value="einnahme" ${ein ? "checked" : ""} onchange="buchRichtung(this.form)"> Einnahme — Rechnung an einen Kunden</label>
            </div>
          </div>
          <div class="os-zeile os-zeile--eingabe os-zeile--paar">
            <label class="os-zeile-teil"><span class="os-zeile-label">Betrag brutto *</span>
              <div class="os-zeile-wert"><input name="betrag" required inputmode="decimal" placeholder="0,00 €" value="${b.betrag !== null ? String(b.betrag).replace(".", ",") : ""}"></div></label>
            <label class="os-zeile-teil"><span class="os-zeile-label"><span data-nur="ausgabe">Belegdatum *</span><span data-nur="einnahme">Rechnungsdatum *</span></span>
              <div class="os-zeile-wert"><input type="date" name="datum" required value="${b.datum ? datumFeld(b.datum) : heuteFeld()}"></div></label>
          </div>
          <label class="os-zeile os-zeile--eingabe" data-nur="ausgabe"><span class="os-zeile-label">USt auf dem Beleg</span>
            <div class="os-zeile-wert">${auswahl("steuersatz", SAETZE.map((s) => [s, satzLabel(s)]), b.steuersatz === null || b.steuersatz === undefined ? 0 : Number(b.steuersatz))}</div></label>
          <div class="os-zeile os-zeile--text" data-nur="einnahme"><span class="os-zeile-label">USt</span>
            <div class="os-zeile-wert">0 % · Kleinunternehmer nach §19 UStG</div></div>
          <label class="os-zeile os-zeile--eingabe" data-nur="ausgabe"><span class="os-zeile-label">Lieferant</span>
            <div class="os-zeile-wert"><input name="gegenstelle" placeholder="z. B. Shell, Ikea" value="${e(b.gegenstelle || "")}"></div></label>
          <label class="os-zeile os-zeile--eingabe" data-nur="einnahme"><span class="os-zeile-label">Kunde *</span>
            <div class="os-zeile-wert">${auswahl("firma_id", kunden.map((k) => [k.id, k.name]),
              b.firma_id || (kunden.find((k) => b.gegenstelle && k.name.trim() === b.gegenstelle.trim()) || {}).id || "", { leer: "— Kunde wählen —" })}</div>
            <span class="os-zeile-hilfe">Feste Auswahl statt Freitext: nur so weiß die Rechnung, zu welcher Kundenakte sie gehört.</span></label>
          <label class="os-zeile os-zeile--eingabe" data-nur="einnahme"><span class="os-zeile-label">Wofür?</span>
            <div class="os-zeile-wert">${auswahl("fuer_position", [["setup", "Setup / Projekt"], ["monatlich", "Retainer — ein Monat"]], b.fuer_position || "setup")}</div></label>
          <label class="os-zeile os-zeile--eingabe" data-nur="ausgabe"><span class="os-zeile-label">Kategorie</span>
            <div class="os-zeile-wert">${auswahl("kategorie", kat("ausgabe"), b.kategorie || "", { leer: "— wählen —" })}</div></label>
          <label class="os-zeile os-zeile--eingabe" data-nur="einnahme"><span class="os-zeile-label">Kategorie</span>
            <div class="os-zeile-wert">${auswahl("kategorie", kat("einnahme"), b.kategorie || "", { leer: "— wählen —" })}</div></label>
        </div>
      </section>
      <section class="os-gruppe">
        <div class="os-gruppe-titel">Zahlung</div>
        <div class="os-gruppe-rumpf">
          <div class="os-zeile os-zeile--eingabe os-zeile--paar" data-nur="ausgabe">
            <label class="os-zeile-teil"><span class="os-zeile-label">Schon bezahlt?</span>
              <div class="os-zeile-wert">${auswahl("bezahlt", [["ja", "Ja — der Beleg ist der Nachweis"], ["nein", "Nein — Rechnung mit Zahlungsziel"]], "ja", { attr: 'onchange="buchZahlung(this.form)"' })}</div></label>
            <label class="os-zeile-teil"><span class="os-zeile-label"><span data-zahlung="ja">Zahltag</span><span data-zahlung="nein">Zahlungsziel</span></span>
              <div class="os-zeile-wert"><input type="date" name="bezahlt_am" value="${b.datum ? datumFeld(b.datum) : heuteFeld()}" max="${heuteFeld()}" data-zahlung="ja">
                <input type="date" name="faellig" value="${b.faellig ? datumFeld(b.faellig) : ""}" data-zahlung="nein"></div></label>
          </div>
          <div class="os-zeile os-zeile--eingabe os-zeile--paar" data-nur="einnahme">
            <label class="os-zeile-teil"><span class="os-zeile-label">Zahlungsziel</span>
              <div class="os-zeile-wert"><input type="date" name="faellig" value="${b.faellig ? datumFeld(b.faellig) : ""}"></div></label>
            <label class="os-zeile-teil"><span class="os-zeile-label">Schon bezahlt am</span>
              <div class="os-zeile-wert"><input type="date" name="bezahlt_am" max="${heuteFeld()}"></div></label>
          </div>
          <label class="os-zeile os-zeile--eingabe" data-nur="ausgabe"><span class="os-zeile-label">Wiederkehrend</span>
            <div class="os-zeile-wert">${auswahl("intervall", [["", "Einmalig"], ["monatlich", "Monatlich (Fixkosten)"], ["jaehrlich", "Jährlich (Fixkosten)"]], "")}</div></label>
          <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Belegnummer</span>
            <div class="os-zeile-wert"><input name="belegnummer" placeholder="optional" value="${e(b.belegnummer || "")}"></div></label>
          <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Wofür genau</span>
            <div class="os-zeile-wert"><input name="notiz" placeholder="kurze Beschreibung" value="${e(b.notiz || "")}"></div></label>
        </div>
        <div class="os-gruppe-fuss" data-nur="einnahme">„Schon bezahlt am“ nur ausfüllen, wenn das Geld schon eingegangen ist — dann zählt die
          Rechnung im Monat der Zahlung. Leer lassen heißt: sie wartet unter „Offen“.</div>
      </section>
    </form>`;
    fuss = `<footer class="os-blatt-fuss">
      <form method="post" action="/buchhaltung/beleg/verwerfen" class="links"
        onsubmit="var g=prompt('Warum wird dieser Beleg verworfen? (Fehlscan, Doppel, privat …)');if(!g||g.trim().length<3){return false}this.grund.value=g;return true;">
        <input type="hidden" name="id" value="${b.id}"><input type="hidden" name="grund" value=""><input type="hidden" name="zurueck" value="${e(listeUrl)}">
        <button type="submit" class="still">Verwerfen …</button></form>
      ${leser.bereit() ? `<form method="post" action="/buchhaltung/beleg/nochmal-lesen">
        <input type="hidden" name="id" value="${b.id}"><input type="hidden" name="zurueck" value="${e(hier)}">
        <button type="submit" class="sekundaer">${ICON.nochmal} Nochmal lesen</button></form>` : ""}
      <button type="submit" form="beleg-form" class="dunkel">${ICON.check} Passt &amp; buchen</button>
    </footer>`;
  } else {
    const zeileT = (label, wert) => `<div class="os-zeile os-zeile--text"><span class="os-zeile-label">${label}</span><div class="os-zeile-wert" data-leer="—">${wert}</div></div>`;
    rechts = `<section class="os-gruppe">
      <div class="os-gruppe-titel">${b.status === "verworfen" ? "Verworfen" : "Gebucht"}</div>
      <div class="os-gruppe-rumpf">
        ${zeileT("Richtung", ein ? "Einnahme" : "Ausgabe")}
        ${zeileT("Betrag", b.betrag !== null ? geldGenau(b.betrag) : "")}
        ${zeileT(ein ? "Rechnungsdatum" : "Belegdatum", b.datum ? datum(b.datum) : "")}
        ${zeileT(ein ? "Kunde" : "Lieferant", e(b.firma_name || b.gegenstelle || ""))}
        ${zeileT("Kategorie", e(b.kategorie || ""))}
        ${b.status === "gebucht" ? zeileT("Zahlung", b.buchung_bezahlt === false
          ? `${pille("wartet auf Zahlung", "bernstein", true)}${b.buchung_faellig ? ` fällig ${datum(b.buchung_faellig)}` : ""}`
          : `${pille("bezahlt", "gruen", true)} Zahltag ${datum(b.bezahlt_am)} · Monatsordner ${b.bezahlt_am ? e(monatName(new Date(b.bezahlt_am).getFullYear(), new Date(b.bezahlt_am).getMonth() + 1)) : "–"}`) : ""}
        ${b.status === "verworfen" ? zeileT("Grund", e(b.verworfen_grund || "")) + zeileT("Verworfen am", zeitpunkt(b.verworfen_am)) : ""}
        ${b.belegnummer ? zeileT("Belegnummer", e(b.belegnummer)) : ""}
        ${b.notiz ? zeileT("Beschreibung", e(b.notiz)) : ""}
        ${b.steuersatz !== null && b.steuersatz !== undefined ? zeileT("USt", satzLabel(Number(b.steuersatz))) : ""}
      </div>
      <div class="os-gruppe-fuss">Beleg Nr. ${b.laufnummer ?? "–"} · Prüfsumme <code>${e((b.pruefsumme || "").slice(0, 12))}…</code> — Datei und Nummer sind unveränderbar (Aufbewahrungspflicht).</div>
    </section>`;
    fuss = `<footer class="os-blatt-fuss">
      ${b.status === "gebucht" && b.buchung_id ? `<form method="post" action="/buchhaltung/loeschen" class="links" onsubmit="return confirm('Buchung zurücknehmen? Der Beleg wandert zurück in den Eingang, die Datei bleibt.')">
        <input type="hidden" name="id" value="${b.buchung_id}"><input type="hidden" name="zurueck" value="${e(listeUrl)}">
        <button type="submit" class="still">Buchung zurücknehmen</button></form>` : ""}
      ${b.status === "gebucht" && b.buchung_bezahlt === false ? `<form method="post" action="/buchhaltung/bezahlt" class="buch-tat">
        <input type="hidden" name="id" value="${b.buchung_id}"><input type="hidden" name="zurueck" value="${e(listeUrl)}">
        <input type="date" name="bezahlt_am" value="${heuteFeld()}" max="${heuteFeld()}" aria-label="Zahltag">
        <button type="submit" class="dunkel">${ICON.check} Bezahlt am</button></form>` : ""}
      <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Schließen</button>
    </footer>`;
  }
  return `<dialog class="os-blatt os-blatt--breit buch-blatt" id="beleg-blatt" data-auf="1" aria-labelledby="beleg-blatt-titel">
    ${kopf}
    <div class="os-blatt-rumpf"><div class="buch-blatt-spalten">${vorschauBlock}<div>${rechts}</div></div></div>
    ${fuss}
    <script>
    // Richtung und Zahlung schalten die passenden Zeilen: Felder in
    // verborgenen Zeilen werden "disabled", damit sie nicht mitgeschickt
    // werden — zwei Kategorie-Auswahlen heissen sonst beide "kategorie".
    function buchRichtung(f){
      var art=(f.querySelector('[name=art]:checked')||{}).value||"ausgabe";
      f.querySelectorAll("[data-nur]").forEach(function(el){
        var an=el.dataset.nur===art; el.hidden=!an;
        el.querySelectorAll("input,select,textarea").forEach(function(x){x.disabled=!an});
      });
      buchZahlung(f);
    }
    function buchZahlung(f){
      var s=f.querySelector('[name=bezahlt]'); if(!s||s.disabled) return;
      var w=s.value;
      f.querySelectorAll("[data-zahlung]").forEach(function(el){
        var an=el.dataset.zahlung===w; el.hidden=!an; if(el.tagName==="INPUT") el.disabled=!an;
      });
    }
    (function(){var f=document.getElementById("beleg-form");if(f)buchRichtung(f)})();
    </script>
  </dialog>`;
}

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

  // Die gemeinsame Huelle aller fuenf Seiten: Reiterleiste, eigenes
  // Stylesheet, Meldungsstreifen, Seitenskript.
  const seite = (req, { titel, unterzeile, id, inhalt }) => schale({
    titel, unterzeile, aktiv: "buchhaltung", nutzer: req.nutzer,
    reiter: unternav(id),
    inhalt: `<link rel="stylesheet" href="${v("/buchhaltung.css")}">
      <div class="buch-seite">${hinweisBlock(req)}${inhalt}</div>${SEITEN_SKRIPT}`,
  }) + "</body></html>";

  // ------------------------------------------------------- Nur im Dreh
  //
  // Creative 3, der schoenste Moment: Lukas fotografiert den Bon vom Team-Essen
  // mit dem Handy, schickt ihn in den Telegram-Chat — und auf dem Bildschirm
  // springt der Belegzaehler hoch. Ohne das muesste jemand F5 druecken, und
  // genau das sieht man einem Video an.
  //
  // Die Wache holt sich alle zwei Sekunden nur eine Zahl. Aendert sie sich,
  // laedt sie die Seite EINMAL neu und tauscht die Stellen aus, die
  // data-dreh tragen (Kacheln, Zu-tun-Gruppe). Ohne DREH_REGIE=1 gibt dieser
  // Aufruf einen leeren Text zurueck, und im Betrieb steht nichts davon in
  // der Seite.
  const drehWache = () => process.env.DREH_REGIE !== "1" ? "" : `
    <style>
      @keyframes dreh-blitz { 0% { background: rgba(255, 214, 10, .55); } 100% { background: transparent; } }
      .dreh-frisch { animation: dreh-blitz 2.4s ease-out; border-radius: 8px; }
    </style>
    <script>
    (function () {
      var stand = null, laeuft = false;
      function hervorheben(el) { if (!el) return; el.classList.remove("dreh-frisch"); void el.offsetWidth; el.classList.add("dreh-frisch"); }
      async function nachsehen() {
        if (laeuft) return;
        laeuft = true;
        try {
          var d = await (await fetch("/regie/belegstand", { cache: "no-store" })).json();
          if (stand === null) { stand = d.gebucht; return; }
          if (d.gebucht === stand) return;
          stand = d.gebucht;
          var html = await (await fetch(location.pathname + location.search, { cache: "no-store" })).text();
          var neu = new DOMParser().parseFromString(html, "text/html");
          document.querySelectorAll("[data-dreh]").forEach(function (alt) {
            var frisch = neu.querySelector('[data-dreh="' + alt.dataset.dreh + '"]');
            if (!frisch) return;
            alt.innerHTML = frisch.innerHTML;
            hervorheben(alt);
          });
        } catch (e) { /* im Dreh lieber still weiterlaufen als eine Fehlermeldung im Bild */ }
        finally { laeuft = false; }
      }
      setInterval(nachsehen, 2000);
      nachsehen();
    })();
    </script>`;

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

  // ================================================================ Uebersicht
  app.get("/buchhaltung", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const zeitraum = buch.ZEITRAEUME[req.query.zeit] !== undefined ? req.query.zeit : "monat";
      const [d, kasse, zutun, erinnerung, firmen, rechn] = await Promise.all([
        buch.uebersicht(u, zeitraum),
        buch.kontoUndSteuer(u),
        buch.zuTun(u),
        // Legt bei Bedarf die Montags-Erinnerung an, dass der Kontostand
        // nachgetragen werden muss. Laeuft absichtlich hier mit statt in einem
        // Zeitplaner — siehe Kommentar in buchhaltung.js.
        buch.saldoErinnerung(u),
        crm.firmenListe(u, { limit: 300 }),
        // Rechnungen aus dem Rechnungsmodul (Agent D1) — faellt auf Nullen
        // zurueck, wenn das Modul fehlt.
        buch.rechnungenOffen(u),
      ]);
      const offenAus = d.offenAus || [];
      const offenAusSumme = Number(d.offenAusSumme) || 0;
      // Fuer die Kundenauswahl an einer Einnahme: alphabetisch, damit man einen
      // Namen findet, statt ihn zu suchen. Leads sind mit dabei — man schreibt
      // die erste Rechnung manchmal, bevor der Status umgestellt ist.
      const kunden = [...(firmen || [])].sort((a, b) => a.name.localeCompare(b.name, "de"));
      const hier = aktuelleUrl(req);

      const zLabel = ZEITRAUM_LABEL[zeitraum];
      const zSatz = zeitraum === "alle" ? "insgesamt"
        : zeitraum === "monat" ? "im " + zLabel
        : "in den letzten " + zLabel.replace(/Monate$/, "Monaten");

      // ---------- Kacheln ----------
      const kundenOffenSumme = Number(d.offenSumme || 0) + Number(rechn.summe || 0);
      const kundenOffenAnzahl = (d.offen || []).length + (rechn.anzahl || 0);
      const kachel = (label, zahl, fuss, ton = "") => `<div class="os-kachel${ton ? " os-kachel--" + ton : ""}">
        <span class="os-kachel-label">${label}</span><span class="os-kachel-zahl">${zahl}</span>
        <span class="os-kachel-fuss buch-kachel-fuss">${fuss}</span></div>`;
      const vorzeichen = (n) => (n < 0 ? "−" : "") + geld(Math.abs(n));
      const kacheln = `<div class="os-kacheln" data-dreh="kacheln">
        ${kachel("Kontostand", vorzeichen(kasse.stand), kasse.saldo_stand
          ? `<span>Stand vom ${datum(kasse.saldo_stand)}${erinnerung.tageAlt >= 7 ? ` · <b>${erinnerung.tageAlt} Tage alt</b>` : ""}</span>
             <span>Rücklage ${geld(kasse.ruecklage)} (${kasse.satz} % vom Gewinn) · frei ${vorzeichen(kasse.frei)}</span>
             <a href="#" onclick="document.getElementById('blatt-kasse').showModal();return false">Nachtragen</a>`
          : `<span>Noch nie eingetragen</span><a href="#" onclick="document.getElementById('blatt-kasse').showModal();return false">Kontostand eintragen</a>`,
          kasse.stand < 0 ? "rot" : "")}
        ${kachel("Einnahmen", geld(d.summe.einnahmen), `<span>${d.summe.anzahl_einnahmen} bezahlt ${e(zSatz)}</span>`, "gruen")}
        ${kachel("Ausgaben", geld(d.summe.ausgaben), `<span>${d.summe.anzahl_ausgaben} bezahlt ${e(zSatz)}</span>`, "rot")}
        ${kachel("Ergebnis", vorzeichen(d.summe.ergebnis), `<span>${d.summe.ergebnis >= 0 ? "Überschuss" : "Unterdeckung"} ${e(zSatz)}</span>`,
          d.summe.ergebnis > 0 ? "gruen" : d.summe.ergebnis < 0 ? "rot" : "")}
        ${kachel("Offen", geld(kundenOffenSumme),
          `<span>${kundenOffenAnzahl} ${kundenOffenAnzahl === 1 ? "Kundenrechnung" : "Kundenrechnungen"}</span>
           <a href="/buchhaltung/kosten">Noch zu zahlen: ${geld(offenAusSumme)} (${offenAus.length})</a>`,
          kundenOffenAnzahl ? "bernstein" : "")}
      </div>`;

      // ---------- Zu tun ----------
      const heute = heuteFeld();
      const rechnUeber = (rechn.liste || []).filter((r) => r.faellig && r.faellig < heute);
      const zeile = (zahl, ton, text, href, onclick) => onclick
        ? `<button type="button" class="os-zeile os-zeile--aktion" onclick="${onclick}"><span class="os-zeile-wert"><span class="buch-zutun-zahl ${ton}">${zahl}</span> &nbsp;${text}</span></button>`
        : `<a class="os-zeile os-zeile--aktion" href="${href}"><span class="os-zeile-wert"><span class="buch-zutun-zahl ${ton}">${zahl}</span> &nbsp;${text}</span></a>`;
      const zutunZeilen = [];
      if (zutun.belegeUngeprueft) zutunZeilen.push(zeile(zutun.belegeUngeprueft, "warn", `${zutun.belegeUngeprueft === 1 ? "Beleg" : "Belege"} prüfen und buchen`, "/buchhaltung/belege?status=neu"));
      if (zutun.belegeFehler) zutunZeilen.push(zeile(zutun.belegeFehler, "rot", `${zutun.belegeFehler === 1 ? "Beleg" : "Belege"} mit Fehler ansehen`, "/buchhaltung/belege?status=fehler"));
      if (zutun.einnahmenUeberfaellig) zutunZeilen.push(zeile(zutun.einnahmenUeberfaellig, "rot", `Kundenrechnung${zutun.einnahmenUeberfaellig === 1 ? "" : "en"} überfällig · ${geld(zutun.einnahmenUeberfaelligSumme)}`, "/buchhaltung/kosten#kunden"));
      if (rechnUeber.length) zutunZeilen.push(zeile(rechnUeber.length, "rot", `Rechnung${rechnUeber.length === 1 ? "" : "en"} aus dem Rechnungsmodul überfällig`, "/buchhaltung/rechnungen"));
      if (zutun.ausgabenUeberfaellig) zutunZeilen.push(zeile(zutun.ausgabenUeberfaellig, "rot", `Ausgabe${zutun.ausgabenUeberfaellig === 1 ? "" : "n"} überfällig · ${geld(zutun.ausgabenUeberfaelligSumme)} — bezahlen`, "/buchhaltung/kosten"));
      if (zutun.ausgabenBald) zutunZeilen.push(zeile(zutun.ausgabenBald, "warn", `Ausgabe${zutun.ausgabenBald === 1 ? "" : "n"} in den nächsten 7 Tagen fällig`, "/buchhaltung/kosten"));
      if (erinnerung.faellig) zutunZeilen.push(zeile("!", "warn", `Kontostand ${erinnerung.tageAlt === null ? "noch nie eingetragen" : `ist ${erinnerung.tageAlt} Tage alt`} — nachtragen${erinnerung.angelegt ? " (Aufgabe für Montag angelegt)" : ""}`, null, "document.getElementById('blatt-kasse').showModal()"));
      if (zutun.vormonat && zutun.vormonat.bewegungen && !zutun.vormonat.abgeschlossen) {
        zutunZeilen.push(zeile("1", zutun.vormonat.geholt ? "" : "warn",
          `Monatsabschluss ${e(monatName(zutun.vormonat.jahr, zutun.vormonat.monat))}: ${zutun.vormonat.geholt ? "geholt, aber noch nicht an die Kanzlei" : "noch nicht erstellt"}`,
          "/buchhaltung/monate"));
      }
      const zutunBlock = `<section class="os-gruppe" data-dreh="zutun">
        <div class="os-gruppe-titel">Zu tun</div>
        <div class="os-gruppe-rumpf">${zutunZeilen.length ? zutunZeilen.join("") : `
          <div class="os-zeile os-zeile--text"><span class="os-zeile-label">Alles erledigt</span>
            <div class="os-zeile-wert">Keine Belege zu prüfen, nichts überfällig, Kontostand frisch.</div></div>`}</div>
      </section>`;

      // ---------- Verlauf: zwei Balken je Monat ----------
      // Die Abfrage liefert nur Monate MIT Buchungen. Fehlende auffuellen, sonst
      // steht "zwölf Monate" darueber und es sind sechs Balken zu sehen.
      const vonDb = Object.fromEntries((d.verlauf || []).map((x) => [x.monat, x]));
      const zwoelf = Array.from({ length: 12 }, (_, i) => {
        const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - (11 - i));
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
        return vonDb[key] || { monat: key, einnahmen: 0, ausgaben: 0 };
      });
      const maxV = Math.max(1, ...zwoelf.flatMap((x) => [x.einnahmen, x.ausgaben]));
      const verlaufBlock = (d.verlauf || []).length ? `<div class="buch-verlauf">${zwoelf.map((x) => {
        const [jahr, mon] = x.monat.split("-");
        return `<div class="buch-monat" title="${MONATE_KURZ[Number(mon) - 1]} ${jahr}: Einnahmen ${geld(x.einnahmen)}, Ausgaben ${geld(x.ausgaben)}">
          <div class="buch-paar"><span class="buch-ein" style="height:${Math.max(2, Math.round(x.einnahmen / maxV * 100))}%"></span>
            <span class="buch-aus" style="height:${Math.max(2, Math.round(x.ausgaben / maxV * 100))}%"></span></div>
          <span class="buch-monat-label">${MONATE_KURZ[Number(mon) - 1]}</span></div>`;
      }).join("")}</div>
        <div class="buch-legende"><span><i class="ein"></i>Einnahmen</span><span><i class="aus"></i>Ausgaben</span></div>`
        : `<div class="os-leer os-leer--klein"><div class="os-leer-icon">${ICON.euro}</div><h3>Noch keine bezahlten Buchungen</h3><p>Sobald etwas gebucht und bezahlt ist, stehen hier die Monate.</p></div>`;

      // ---------- Ausgaben je Kategorie ----------
      const maxK = Math.max(1, ...(d.kategorien || []).map((k) => k.betrag));
      const katBlock = (d.kategorien || []).length ? `<div class="buch-balken">${d.kategorien.map((k) => `
        <div class="os-fortschritt os-fortschritt--klein" role="progressbar" aria-valuenow="${Math.round(k.betrag / maxK * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="${e(k.kategorie)}">
          <div class="os-fortschritt-text"><span>${e(k.kategorie)} <small class="buch-still">${k.anzahl} ${k.anzahl === 1 ? "Buchung" : "Buchungen"}</small></span><span>${geldGenau(k.betrag)}</span></div>
          <div class="os-fortschritt-balken"><span style="width:${Math.round(k.betrag / maxK * 100)}%"></span></div>
        </div>`).join("")}</div>`
        : `<div class="os-leer os-leer--klein"><div class="os-leer-icon">${ICON.ab}</div><h3>Keine Ausgaben ${e(zSatz)}</h3><p>Erfasste Ausgaben erscheinen hier nach Kategorie.</p></div>`;

      // ---------- Letzte Buchungen ----------
      const letzteBlock = (d.letzte || []).length ? `<div class="os-tabelle-huelle"><table class="os-tabelle os-tabelle--dicht">
        <thead><tr><th>Datum</th><th>Wer / Was</th><th>Kategorie</th><th class="rechts">Betrag</th><th>Stand</th><th class="rechts">Erfasst</th><th></th></tr></thead>
        <tbody>${d.letzte.map((l) => {
          const ueber = l.faellig && datumFeld(l.faellig) < heute;
          return `<tr>
          <td class="buch-datum">${datum(l.datum)}</td>
          <td><span class="os-tabelle-titel">${e(l.firma_name || l.gegenstelle || "—")}</span>${l.notiz ? `<div class="os-tabelle-unter">${e(l.notiz)}</div>` : ""}</td>
          <td>${l.kategorie ? pille(e(l.kategorie), "grau") : `<span class="buch-still">—</span>`}</td>
          <td class="rechts buch-betrag ${l.art}">${l.art === "ausgabe" ? "−" : "+"} ${geldGenau(l.betrag)}</td>
          <td>${l.bezahlt ? pille(`bezahlt ${l.bezahlt_am ? datum(l.bezahlt_am) : ""}`.trim(), "gruen")
            : pille(l.faellig ? (ueber ? "überfällig" : `fällig ${datum(l.faellig)}`) : "offen", ueber ? "rot" : "bernstein", true)}
            ${l.intervall ? " " + pille(l.intervall === "monatlich" ? "monatlich" : "jährlich", "blau") : ""}</td>
          <td class="rechts buch-klein">${e((l.wer || "").split(" ")[0] || "—")}</td>
          <td class="rechts"><div class="buch-taten">
            ${!l.bezahlt ? `<form method="post" action="/buchhaltung/bezahlt" class="buch-tat">
              <input type="hidden" name="id" value="${l.id}"><input type="hidden" name="zurueck" value="${e(hier)}">
              <input type="date" name="bezahlt_am" value="${heute}" max="${heute}" aria-label="Zahltag" title="Zahltag — danach richtet sich der Monatsordner">
              <button type="submit" class="sekundaer" title="Als bezahlt markieren">${ICON.check}</button></form>` : ""}
            <form method="post" action="/buchhaltung/loeschen" onsubmit="return confirm('Diese Buchung löschen? Ein zugehöriger Beleg wandert zurück in den Eingang.')">
              <input type="hidden" name="id" value="${l.id}"><input type="hidden" name="zurueck" value="${e(hier)}">
              <button type="submit" class="still" title="Löschen">${ICON.x}</button></form></div></td>
        </tr>`;
        }).join("")}</tbody></table></div>`
        : `<div class="os-leer os-leer--klein"><div class="os-leer-icon">${ICON.liste}</div><h3>Noch nichts erfasst</h3><p>Erfasse eine Ausgabe oder lade einen Beleg hoch — die neuesten Buchungen stehen dann hier.</p></div>`;

      res.send(seite(req, {
        titel: "Buchhaltung", unterzeile: "Einnahmen, Ausgaben und Belege", id: "uebersicht",
        inhalt: `
        ${leser.bereit() ? "" : `<div class="os-hinweis os-hinweis--warn">${ICON.warnung}<div>
          <b>Belege werden noch nicht automatisch ausgelesen.</b> Dafür fehlt <code>ANTHROPIC_API_KEY</code> in der
          <code>.env</code>. Alles andere funktioniert: hochladen, Werte von Hand eintragen, buchen, Monatsabschluss.</div></div>`}

        <div class="os-werkzeugleiste">
          <h2 class="os-werkzeugleiste-titel">Übersicht
            <span class="os-werkzeugleiste-unter">Zahlen ${e(zSatz)} · gezählt wird am Zahltag (Zufluss-Prinzip)</span></h2>
          <div class="os-werkzeugleiste-aktionen">
            <div class="os-segment" role="tablist" aria-label="Zeitraum">
              ${Object.keys(ZEITRAUM_LABEL).map((z) => `<a href="/buchhaltung?zeit=${z}" class="${z === zeitraum ? "aktiv" : ""}"${z === zeitraum ? ' aria-current="page"' : ""}>${e(ZEITRAUM_LABEL[z])}</a>`).join("")}
            </div>
            <button type="button" class="sekundaer" onclick="document.getElementById('blatt-einnahme').showModal()">${ICON.auf} Einnahme</button>
            <button type="button" class="dunkel" onclick="document.getElementById('blatt-ausgabe').showModal()">${ICON.plus} Ausgabe erfassen</button>
          </div>
        </div>

        ${ablageZone({ quelle: "web" })}
        ${kacheln}
        ${zutunBlock}

        <div class="os-spalten os-spalten--2">
          <section class="os-gruppe">
            <div class="os-gruppe-titel">Einnahmen und Ausgaben, 12 Monate
              <span class="os-gruppe-werkzeug"><a href="/buchhaltung/monate">Monatsabschluss</a></span></div>
            <div class="buch-gruppe-rumpf">${verlaufBlock}</div>
          </section>
          <section class="os-gruppe">
            <div class="os-gruppe-titel">Ausgaben nach Kategorie
              <span class="os-gruppe-werkzeug"><a href="/buchhaltung/kosten">Kosten</a></span></div>
            <div class="buch-gruppe-rumpf">${katBlock}</div>
          </section>
        </div>

        <section class="os-gruppe">
          <div class="os-gruppe-titel">Letzte Buchungen
            <span class="os-gruppe-werkzeug"><a href="/buchhaltung/belege">Alle Belege</a></span></div>
          ${letzteBlock}
        </section>

        ${erfassenBlatt("ausgabe", kunden, hier)}
        ${erfassenBlatt("einnahme", kunden, hier)}
        ${kasseBlatt(kasse, hier)}
        ${drehWache()}`,
      }));
    } catch (err) { next(err); }
  });

  // ==================================================================== Belege
  app.get("/buchhaltung/belege", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const q = req.query || {};
      const filter = {
        art: ["ausgabe", "einnahme"].includes(q.art) ? q.art : "",
        status: ["neu", "gebucht", "verworfen", "fehler"].includes(q.status) ? q.status : "",
        monat: /^\d{4}-\d{2}$/.test(String(q.monat || "")) ? q.monat : "",
        suche: String(q.q || "").slice(0, 80),
      };
      const [liste, zaehler, firmen, beleg] = await Promise.all([
        buch.belegeListe(u, filter),
        buch.belegZaehler(u),
        crm.firmenListe(u, { limit: 300 }),
        /^\d+$/.test(String(q.beleg || "")) ? buch.belegEinzeln(u, q.beleg) : null,
      ]);
      const kunden = [...(firmen || [])].sort((a, b) => a.name.localeCompare(b.name, "de"));
      const listeUrl = aktuelleUrl(req, { ohne: ["beleg"] });
      const hier = aktuelleUrl(req);
      let gmailBereit = false;
      try { gmailBereit = require("./gmail-direkt.js").bereit(); } catch { gmailBereit = false; }
      const ungeprueft = liste.filter((b) => b.status === "neu");
      const osUrl = (process.env.OS_URL || "").replace(/\/$/, "");
      const gefiltert = Boolean(filter.suche || filter.status || filter.monat || filter.art);

      // Filterzeile: Segment fuer die Richtung (Links, behalten die anderen
      // Filter), dazu Status, Monat, Suche als GET-Formular.
      const linkMit = (aenderung) => {
        const p = { ...filter, ...aenderung };
        const teile = Object.entries({ art: p.art, status: p.status, monat: p.monat, q: p.suche })
          .filter(([, w]) => w).map(([k, w]) => `${k}=${encodeURIComponent(w)}`);
        return "/buchhaltung/belege" + (teile.length ? "?" + teile.join("&") : "");
      };
      const segment = `<div class="os-segment" role="tablist" aria-label="Richtung">
        ${[["", "Alle"], ["ausgabe", "Ausgaben"], ["einnahme", "Einnahmen"]].map(([w, t]) =>
          `<a href="${linkMit({ art: w })}" class="${filter.art === w ? "aktiv" : ""}">${t}${w && zaehler.jeArt[w].neu ? ` <small>${zaehler.jeArt[w].neu} neu</small>` : ""}</a>`).join("")}
      </div>`;
      const filterZeile = `<form method="get" action="/buchhaltung/belege" class="buch-filter">
        <input type="hidden" name="art" value="${e(filter.art)}">
        ${auswahl("status", [["", "Offen & gebucht"], ["neu", "Zu prüfen"], ["gebucht", "Gebucht"], ["fehler", "Mit Fehler"], ["verworfen", "Verworfen"]], filter.status, { attr: 'onchange="this.form.submit()" aria-label="Status"' })}
        ${auswahl("monat", [["", "Alle Monate"], ...zaehler.monate.map((m) => [m.monat, `${MONATE_KURZ[Number(m.monat.slice(5)) - 1]} ${m.monat.slice(0, 4)} (${m.n})`])], filter.monat, { attr: 'onchange="this.form.submit()" aria-label="Monat"' })}
        <input type="search" name="q" value="${e(filter.suche)}" placeholder="Lieferant, Kunde, Notiz, Belegnummer …" aria-label="Suche">
        <button type="submit" class="sekundaer klein">${ICON.lupe} Suchen</button>
        ${gefiltert ? `<a class="knopf still klein" href="/buchhaltung/belege">Zurücksetzen</a>` : ""}
      </form>`;
      const handyLink = `<span class="buch-rechts">${ICON.handy} Vom Handy: <a href="/buchhaltung/scan">${e(osUrl)}/buchhaltung/scan</a></span>`;
      const quellenZeile = `<div class="buch-quellen">${zaehler.quellen.length
        ? `Woher die Belege kamen: ${zaehler.quellen.map((x) => pille(`${quelleLabel(x.quelle)} ${x.n}`, "grau")).join(" ")}`
        : ""}${handyLink}</div>`;

      // Die Tabelle. Klick auf die Zeile oeffnet das Pruef-Blatt (?beleg=id).
      const tabelle = liste.length ? `<div class="os-tabelle-huelle"><table class="os-tabelle os-tabelle--dicht">
        <thead><tr><th>Nr.</th><th>Datum</th><th>Wer / Datei</th><th class="rechts">Betrag</th><th>Kategorie</th><th>Stand</th><th>Quelle</th><th></th></tr></thead>
        <tbody>${liste.map((b) => {
          const href = mitParam(listeUrl, "beleg", b.id);
          return `<tr data-href="${e(href)}">
            <td class="buch-nowrap"><a href="${e(href)}">${b.laufnummer ?? "–"}</a></td>
            <td class="buch-datum">${b.datum ? datum(b.datum) : `<span class="buch-still" title="Eingang ${zeitpunkt(b.erstellt)}">${datum(b.erstellt)}</span>`}</td>
            <td><span class="os-tabelle-titel">${e(b.firma_name || b.gegenstelle || "—")}</span>
              <div class="os-tabelle-unter">${e(b.dateiname)}${b.notiz ? " · " + e(b.notiz) : ""}</div></td>
            <td class="rechts buch-betrag ${b.art}">${b.betrag !== null ? geldGenau(b.betrag) : `<span class="buch-still">—</span>`}</td>
            <td>${b.kategorie ? pille(e(b.kategorie), "grau") : `<span class="buch-still">—</span>`}</td>
            <td>${belegPille(b)}</td>
            <td class="buch-klein">${quelleLabel(b.quelle)}</td>
            <td class="rechts">${b.hat_datei ? `<a class="buch-tabelle-icon" href="/buchhaltung/beleg/${b.id}/datei" target="_blank" title="Datei ansehen">${/^image\//.test(b.dateityp || "") ? ICON.bild : ICON.datei}</a>` : ""}</td>
          </tr>`;
        }).join("")}</tbody></table></div>`
        : `<div class="os-leer"><div class="os-leer-icon">${ICON.datei}</div>
          <h3>${gefiltert ? "Nichts gefunden" : "Noch keine Belege"}</h3>
          <p>${gefiltert
            ? "Mit diesen Filtern liegt hier nichts. Setz die Filter zurück oder such anders."
            : "Leg oben einen Beleg ab, scann ihn mit dem Handy oder lass das Postfach prüfen — er erscheint dann hier."}</p>
          ${gefiltert ? `<a class="knopf sekundaer" href="/buchhaltung/belege">Filter zurücksetzen</a>` : `<button type="button" class="dunkel" onclick="document.getElementById('buch-ablage-feld').click()">Beleg hochladen</button>`}
        </div>`;

      res.send(seite(req, {
        titel: "Buchhaltung", unterzeile: "Belegeingang", id: "belege",
        inhalt: `
        <div class="os-werkzeugleiste">
          <h2 class="os-werkzeugleiste-titel">Belege
            <span class="os-werkzeugleiste-unter">${zaehler.status.neu} zu prüfen · ${zaehler.status.gebucht} gebucht${zaehler.status.verworfen ? ` · ${zaehler.status.verworfen} verworfen` : ""}</span></h2>
          <div class="os-werkzeugleiste-aktionen">
            <form method="post" action="/buchhaltung/mail-import" style="display:contents">
              <input type="hidden" name="zurueck" value="${e(listeUrl)}">
              <button type="submit" class="sekundaer" title="${gmailBereit ? "Sucht im Postfach nach Rechnungen der letzten 7 Tage" : "Auf dieser Maschine ist kein Postfach-Zugang hinterlegt"}">${ICON.mail} Postfach jetzt prüfen</button>
            </form>
            ${leser.bereit() && ungeprueft.length ? `<button type="button" class="sekundaer" id="alle-lesen" data-ids="${ungeprueft.filter((b) => !b.gelesen).map((b) => b.id).join(",")}">${ICON.nochmal} Alle ungeprüften lesen</button>` : ""}
            <button type="button" class="dunkel" onclick="document.getElementById('buch-ablage-feld').click()">${ICON.plus} Beleg hochladen</button>
          </div>
        </div>
        ${ablageZone({ art: filter.art || "ausgabe", quelle: "web", ziel: listeUrl })}
        <div class="buch-filter">${segment}${filterZeile}</div>
        ${quellenZeile}
        ${tabelle}
        ${beleg ? belegBlatt(beleg, kunden, listeUrl, hier) : ""}
        <script>
        (function(){
          var k=document.getElementById("alle-lesen");
          if(!k) return;
          k.addEventListener("click",async function(){
            var ids=(k.dataset.ids||"").split(",").filter(Boolean);
            if(!ids.length){ alert("Alle ungeprüften Belege wurden schon gelesen — öffne einen Beleg und drück „Nochmal lesen“, wenn etwas fehlt."); return; }
            k.disabled=true;
            for(var i=0;i<ids.length;i++){
              k.textContent="Lese "+(i+1)+" von "+ids.length+" …";
              try{ await fetch("/buchhaltung/beleg/lesen",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:ids[i]})}); }catch(err){}
            }
            location.href=${JSON.stringify(mitParam(listeUrl, "hinweis", "gelesen"))};
          });
        })();
        </script>`,
      }));
    } catch (err) { next(err); }
  });

  // ==================================================================== Scan
  //
  // Die Handy-Seite: zwei grosse Knoepfe, Kamera auf, Foto, fertig. Mobil
  // zuerst gebaut, laeuft aber genauso am Schreibtisch (dann oeffnet sich die
  // Dateiauswahl). Der Ablauf je Foto: verkleinern -> hochladen (X-Quelle:
  // handy) -> lesen -> Ergebnis-Karte mit "Passt" (bucht sofort) oder "Später
  // prüfen" (Beleg liegt im Eingang).
  app.get("/buchhaltung/scan", nurAdmin, async (req, res, next) => {
    try {
      const warnIcon = ICON.warnung.replace(/\s+/g, " ");
      const checkIcon = ICON.check.replace(/\s+/g, " ");
      res.send(seite(req, {
        titel: "Buchhaltung", unterzeile: "Beleg mit dem Handy scannen", id: "belege",
        inhalt: `
        <div class="buch-scan">
          <div class="os-werkzeugleiste">
            <h2 class="os-werkzeugleiste-titel">Beleg scannen
              <span class="os-werkzeugleiste-unter">${leser.bereit() ? "Fotografieren — Betrag, Datum und Lieferant werden gelesen, du bestätigst." : "Fotografieren und ablegen — die Werte trägst du im Belegeingang ein."}</span></h2>
            <div class="os-werkzeugleiste-aktionen"><a class="knopf sekundaer klein" href="/buchhaltung/belege">${ICON.liste} Belegeingang</a></div>
          </div>
          <label class="buch-scan-knopf buch-scan-knopf--ausgabe">
            <span class="buch-scan-icon">${ICON.kamera}</span>
            <span>Ausgabe fotografieren<small>Quittung, Tankbeleg, Eingangsrechnung</small></span>
            <input type="file" accept="image/*,application/pdf" capture="environment" multiple data-art="ausgabe">
          </label>
          <label class="buch-scan-knopf buch-scan-knopf--einnahme">
            <span class="buch-scan-icon">${ICON.kamera}</span>
            <span>Einnahme fotografieren<small>Rechnung, die wir einem Kunden gestellt haben</small></span>
            <input type="file" accept="image/*,application/pdf" capture="environment" multiple data-art="einnahme">
          </label>
          <div class="buch-scan-nebenweg">
            <label>${ICON.bild} Aus Fotos oder Dateien wählen (als Ausgabe)<input type="file" accept="image/*,application/pdf" multiple data-art="ausgabe"></label>
          </div>
          <div class="buch-scan-fortschritt" id="scan-fortschritt"><span></span></div>
          <div class="buch-scan-stand" id="scan-stand"></div>
          <div class="buch-scan-liste" id="scan-liste"></div>
        </div>
        <script>
        (function(){
          ${UPLOAD_SKRIPT("handy")}
          var liste=document.getElementById("scan-liste"), stand=document.getElementById("scan-stand"), fort=document.getElementById("scan-fortschritt");
          var WARN=${JSON.stringify(warnIcon)}, CHECK=${JSON.stringify(checkIcon)};
          var euro=function(n){return Number(n).toLocaleString("de-DE",{style:"currency",currency:"EUR"})};
          var tag=function(t){if(!t)return "–";var p=String(t).slice(0,10).split("-");return p.length===3?p[2]+"."+p[1]+"."+p[0]:t};
          var esc=function(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})};
          document.querySelectorAll("input[type=file][data-art]").forEach(function(feld){
            feld.addEventListener("change",function(){ verarbeiten(feld.files, feld.dataset.art); });
          });
          function karte(html){var d=document.createElement("div");d.className="buch-scan-karte";d.innerHTML=html;liste.prepend(d);return d;}
          async function verarbeiten(dateien,art){
            var alle=[].slice.call(dateien);
            for(var i=0;i<alle.length;i++){
              var f=alle[i];
              var k=karte('<div class="buch-scan-kopf"><b>'+esc(f.name)+'</b><span>'+(art==="einnahme"?"Einnahme":"Ausgabe")+'</span></div><div class="buch-klein" data-stand>Bereite vor …</div>');
              var st=k.querySelector("[data-stand]");
              fort.classList.add("laeuft");
              try{
                var r=await hochladen(f,art,function(t){st.textContent=t;stand.textContent=t});
                if(r.doppelt){ st.innerHTML='Lag schon im Eingang als <b>Nr. '+r.laufnummer+'</b> — nicht doppelt abgelegt. <a href="/buchhaltung/belege?beleg='+r.id+'">Ansehen</a>'; continue; }
                var heic=r.heic;
                var g=heic?null:await lesen(r.id,function(t){st.textContent=t;stand.textContent=t});
                var w=g&&g.ok?g.werte:null;
                var kannBuchen=!!(w&&w.betrag&&w.datum);
                var richtung=(w&&w.art)||art;
                var html='<div class="buch-scan-kopf"><b>'+esc(f.name)+'</b><span>Nr. '+r.laufnummer+' · '+(richtung==="einnahme"?"Einnahme":"Ausgabe")+'</span></div>';
                if(w){
                  html+='<div class="buch-scan-werte">'+
                    '<div><span>Betrag</span><b>'+(w.betrag?euro(w.betrag):"nicht erkannt")+'</b></div>'+
                    '<div><span>Datum</span><b>'+tag(w.datum)+'</b></div>'+
                    '<div><span>'+(richtung==="einnahme"?"Kunde":"Lieferant")+'</span><b>'+esc(w.gegenstelle||"–")+'</b></div>'+
                    '<div><span>Kategorie</span><b>'+esc(w.kategorie||"–")+'</b></div></div>';
                  if(w.hinweis||w.sicherheit==="niedrig") html+='<div class="buch-scan-hinweis">'+WARN+'<span>'+esc(w.hinweis||"Schlecht lesbar — bitte gegenprüfen.")+'</span></div>';
                } else if(heic){
                  html+='<div class="buch-scan-hinweis">'+WARN+'<span>Sicher abgelegt — aber iPhone-Format (HEIC) kann nicht gelesen werden. Im iPhone unter Einstellungen › Kamera › Formate auf „Maximale Kompatibilität“ stellen, dann kommen Fotos als JPG. Werte bitte im Belegeingang eintragen.</span></div>';
                } else {
                  html+='<div class="buch-klein">Abgelegt'+(LESEN?' — auslesen hat nicht geklappt'+(g&&g.hinweis?": "+esc(g.hinweis):""):"")+'. Werte bitte im Belegeingang eintragen.</div>';
                }
                html+='<div class="buch-scan-taten">'+
                  '<a class="knopf sekundaer" href="/buchhaltung/belege?beleg='+r.id+'">'+(kannBuchen?"Später prüfen":"Im Belegeingang prüfen")+'</a>'+
                  (kannBuchen?'<button type="button" class="dunkel" data-buchen>'+CHECK+' Passt — buchen</button>':"")+'</div>';
                k.innerHTML=html;
                var b=k.querySelector("[data-buchen]");
                if(b) b.addEventListener("click",(function(kk,id,ww,bb){return function(){buchen(kk,id,ww,bb)}})(k,r.id,w,b));
              }catch(err){
                k.className="buch-scan-karte fehler"; st.textContent="Nicht abgelegt: "+err.message+" — bitte nochmal versuchen.";
              }finally{ fort.classList.remove("laeuft"); stand.textContent=""; }
            }
          }
          async function buchen(k,id,w,knopf){
            knopf.disabled=true; knopf.textContent="Buche …";
            try{
              var r=await fetch("/buchhaltung/beleg/buchen",{method:"POST",headers:{"Content-Type":"application/json","X-Antwort":"json"},
                body:JSON.stringify({id:id,betrag:w.betrag,datum:w.datum,gegenstelle:w.gegenstelle,kategorie:w.kategorie,belegnummer:w.belegnummer,steuersatz:w.steuersatz,faellig:w.faellig,notiz:w.notiz,art:w.art})});
              var d=await r.json();
              if(d.ok){ k.className="buch-scan-karte fertig"; k.querySelector(".buch-scan-taten").innerHTML='<span class="os-pille os-pille--gruen os-pille--punkt">'+(d.offeneRechnung?"Gebucht — wartet auf Zahlung":"Gebucht")+'</span>'; }
              else { knopf.disabled=false; knopf.textContent="Passt — buchen"; alert("Nicht gebucht: "+(d.grund||"unbekannt")+". Bitte im Belegeingang prüfen."); }
            }catch(err){ knopf.disabled=false; knopf.textContent="Passt — buchen"; alert("Nicht gebucht: "+err.message); }
          }
        })();
        </script>`,
      }));
    } catch (err) { next(err); }
  });

  // ================================================================== Monate
  app.get("/buchhaltung/monate", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const [monate, einst] = await Promise.all([buch.monateUebersicht(u), buch.einstellungen(u)]);
      const hier = "/buchhaltung/monate";
      const kanzleiDa = buch.mailGueltig(einst.steuer_mail);
      const kanzleiName = [einst.steuer_anrede, einst.steuer_name].filter(Boolean).join(" ") || einst.steuer_mail;
      const statusPille = (m) => {
        switch (m.status) {
          case "kanzlei": return pille(`an Kanzlei ${datum(m.am)}`, "gruen", true);
          case "excel": return pille(`Excel geholt ${datum(m.am)}`, "blau", true);
          case "zip": return pille(`ZIP geholt ${datum(m.am)}`, "blau", true);
          case "laufend": return pille("läuft noch", "grau");
          default: return pille("offen", "bernstein", true);
        }
      };
      const tabelle = monate.length ? `<div class="os-tabelle-huelle buch-monate"><table class="os-tabelle">
        <thead><tr><th>Monat</th><th class="rechts">Bewegungen</th><th class="rechts">Einnahmen</th><th class="rechts">Ausgaben</th><th>Belege</th><th>Stand</th><th></th></tr></thead>
        <tbody>${monate.map((m) => {
          const basis = `/buchhaltung/monat/${m.jahr}/${m.monat}`;
          const name = monatName(m.jahr, m.monat);
          const frage = kanzleiDa
            ? `${name} an ${kanzleiName} ${process.env.STEUER_MODUS === "senden" ? "senden" : "als Gmail-Entwurf vorbereiten"}?${m.laufend ? " Der Monat läuft noch — es geht nur, was bis heute bezahlt ist." : ""}`
            : "Noch keine Steuerkanzlei hinterlegt — bitte unten eintragen.";
          return `<tr class="${m.laufend ? "buch-monat-laufend" : ""}">
            <td><span class="os-tabelle-titel">${e(name)}</span></td>
            <td class="rechts">${m.anzahl}</td>
            <td class="rechts buch-betrag einnahme">${geldGenau(m.ein)}</td>
            <td class="rechts buch-betrag ausgabe">${geldGenau(m.aus)}</td>
            <td>${m.ohne_beleg ? pille(`${m.anzahl - m.ohne_beleg} von ${m.anzahl} mit Datei`, "bernstein", true) : pille("vollständig", "gruen", true)}</td>
            <td>${statusPille(m)}</td>
            <td class="rechts buch-taten-zelle"><div class="buch-taten">
              <a class="knopf still" href="${basis}/ansehen" target="_blank" title="Übersicht im Browser">Ansehen</a>
              <a class="knopf sekundaer" href="${basis}/excel" title="Excel mit Übersicht und offenen Posten">${ICON.tabelle} Excel</a>
              <a class="knopf sekundaer" href="${basis}/ordner" title="ZIP mit Übersicht, Excel und allen Belegdateien">${ICON.ab} ZIP</a>
              <form method="post" action="${basis}/kanzlei" onsubmit="return confirm(${e(JSON.stringify(frage))})">
                <input type="hidden" name="zurueck" value="${hier}">
                <button type="submit" class="dunkel" ${kanzleiDa ? "" : 'title="Zuerst unten die Kanzlei eintragen"'}>${ICON.senden} An Steuerkanzlei</button></form>
            </div></td>
          </tr>`;
        }).join("")}</tbody></table></div>`
        : `<div class="os-leer"><div class="os-leer-icon">${ICON.ordner}</div><h3>Noch kein Monat mit bezahlten Bewegungen</h3>
          <p>Sobald etwas gebucht und bezahlt ist, erscheint der Monat hier — mit Excel, ZIP und dem Weg zur Kanzlei.</p>
          <a class="knopf sekundaer" href="/buchhaltung/belege">Zum Belegeingang</a></div>`;

      res.send(seite(req, {
        titel: "Buchhaltung", unterzeile: "Monatsabschluss", id: "monate",
        inhalt: `
        <div class="os-werkzeugleiste">
          <h2 class="os-werkzeugleiste-titel">Monatsabschluss
            <span class="os-werkzeugleiste-unter">Je Monat eine Excel-Tabelle und ein ZIP mit allen Belegdateien — und der Weg zur Steuerkanzlei</span></h2>
          <div class="os-werkzeugleiste-aktionen">
            <span class="buch-kanzlei-zeile">${kanzleiDa
              ? `${ICON.senden} Kanzlei: <b>${e(kanzleiName)}</b> <span class="buch-still">· ${e(einst.steuer_mail)}</span>`
              : `${ICON.warnung} <a href="#kanzlei">Steuerkanzlei eintragen</a>`}</span>
          </div>
        </div>
        ${tabelle}
        <div class="os-hinweis os-hinweis--info">${ICON.info}<div>Eine Rechnung erscheint in dem Monat, in dem das Geld <b>geflossen</b> ist (Zufluss-Prinzip) —
          nicht in dem, in dem sie geschrieben wurde. Offene Rechnungen stehen im Excel auf dem Blatt „Offen“, nicht in den Summen.
          Das ZIP enthält zusätzlich jede Belegdatei mit SHA-256-Prüfsumme.</div></div>
        <div class="os-breite-mittel">${kanzleiGruppe(einst, hier)}</div>`,
      }));
    } catch (err) { next(err); }
  });

  // ================================================================== Kosten
  app.get("/buchhaltung/kosten", nurAdmin, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const [k, rechn] = await Promise.all([buch.kosten(u), buch.rechnungenOffen(u)]);
      const hier = "/buchhaltung/kosten";
      const heute = heuteFeld();
      const kundenOffenSumme = k.offenEinSummen.summe + (rechn.summe || 0);
      const kundenOffenAnzahl = k.offenEin.length + (rechn.anzahl || 0);
      const faelligPille = (f, tageUeber) => {
        if (!f) return pille("ohne Fälligkeit", "grau");
        const t = Number(tageUeber);
        if (t > 0) return pille(`${t} ${t === 1 ? "Tag" : "Tage"} überfällig`, "rot", true);
        if (t === 0) return pille("heute fällig", "bernstein", true);
        return pille(`fällig ${datum(f)}`, -t <= 7 ? "bernstein" : "grau", -t <= 7);
      };
      const bezahltForm = (id, betrag) => `<form method="post" action="/buchhaltung/bezahlt" class="buch-tat">
        <input type="hidden" name="id" value="${id}"><input type="hidden" name="zurueck" value="${hier}">
        <input type="date" name="bezahlt_am" value="${heute}" max="${heute}" aria-label="Zahltag" title="Zahltag — danach richtet sich der Monatsordner">
        <button type="submit" class="dunkel" title="${geldGenau(betrag)} als bezahlt markieren">${ICON.check} Bezahlt am</button></form>`;

      const kacheln = `<div class="os-kacheln">
        <div class="os-kachel ${k.offenAusSummen.anzahl ? "os-kachel--rot" : ""}"><span class="os-kachel-label">Noch zu zahlen</span>
          <span class="os-kachel-zahl">${geld(k.offenAusSummen.summe)}</span>
          <span class="os-kachel-fuss buch-kachel-fuss"><span>${k.offenAusSummen.anzahl} ${k.offenAusSummen.anzahl === 1 ? "Rechnung" : "Rechnungen"}${k.offenAusSummen.aelteste ? ` · älteste Fälligkeit ${datum(k.offenAusSummen.aelteste)}` : ""}</span>
            ${k.offenAusSummen.ueberfaellig ? pille(`${k.offenAusSummen.ueberfaellig} überfällig · ${geld(k.offenAusSummen.ueberfaelligSumme)}`, "rot", true) : ""}</span></div>
        <div class="os-kachel"><span class="os-kachel-label">Bezahlt diesen Monat</span>
          <span class="os-kachel-zahl">${geld(k.bezahltMonat.summe)}</span>
          <span class="os-kachel-fuss">${k.bezahltMonat.anzahl} ${k.bezahltMonat.anzahl === 1 ? "Ausgabe" : "Ausgaben"} · ${e(ZEITRAUM_LABEL.monat)}</span></div>
        <div class="os-kachel os-kachel--blau"><span class="os-kachel-label">Fixkosten je Monat</span>
          <span class="os-kachel-zahl">${geld(k.fixkostenMonat)}</span>
          <span class="os-kachel-fuss">${k.fixkosten.length} ${k.fixkosten.length === 1 ? "Kostenstelle" : "Kostenstellen"} · jährliche mit einem Zwölftel</span></div>
        <div class="os-kachel ${kundenOffenAnzahl ? "os-kachel--bernstein" : ""}"><span class="os-kachel-label">Offene Kundenrechnungen</span>
          <span class="os-kachel-zahl">${geld(kundenOffenSumme)}</span>
          <span class="os-kachel-fuss">${kundenOffenAnzahl} ${kundenOffenAnzahl === 1 ? "Rechnung" : "Rechnungen"}${k.offenEinSummen.ueberfaellig ? ` · ${k.offenEinSummen.ueberfaellig} überfällig` : ""}</span></div>
      </div>`;

      const faelligBlock = k.offenAus.length ? `<div class="os-tabelle-huelle"><table class="os-tabelle os-tabelle--dicht">
        <thead><tr><th>Fällig</th><th>Wer / Was</th><th>Kategorie</th><th class="rechts">Betrag</th><th></th></tr></thead>
        <tbody>${k.offenAus.map((b) => `<tr>
          <td>${faelligPille(b.faellig, b.tage_ueber)}</td>
          <td><span class="os-tabelle-titel">${e(b.firma_name || b.gegenstelle || "—")}</span><div class="os-tabelle-unter">Rechnung vom ${datum(b.datum)}${b.notiz ? " · " + e(b.notiz) : ""}</div></td>
          <td>${b.kategorie ? pille(e(b.kategorie), "grau") : `<span class="buch-still">—</span>`}</td>
          <td class="rechts buch-betrag ausgabe">${geldGenau(b.betrag)}</td>
          <td class="rechts">${bezahltForm(b.id, b.betrag)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="3">Summe noch zu zahlen</td><td class="rechts">${geldGenau(k.offenAusSummen.summe)}</td><td></td></tr></tfoot>
        </table></div>`
        : `<div class="os-leer os-leer--klein"><div class="os-leer-icon">${ICON.check}</div><h3>Nichts offen</h3><p>Alle erfassten Ausgaben sind bezahlt. Eine Rechnung mit Zahlungsziel erfasst du über „Ausgabe erfassen“ oder beim Buchen eines Belegs („Nein — Rechnung mit Zahlungsziel“).</p></div>`;

      const fixBlock = k.fixkosten.length ? `<div class="os-tabelle-huelle"><table class="os-tabelle os-tabelle--dicht">
        <thead><tr><th>Wer / Was</th><th>Intervall</th><th class="rechts">Betrag</th><th class="rechts">je Monat</th><th>Nächste Fälligkeit</th><th></th></tr></thead>
        <tbody>${k.fixkosten.map((f) => {
          const nf = datumFeld(f.naechste_faelligkeit);
          const bald = datumFeld(new Date(Date.now() + 7 * 86400000));
          const faelligTon = nf && nf < heute ? "rot" : nf && nf <= bald ? "bernstein" : "grau";
          return `<tr>
          <td><span class="os-tabelle-titel">${e(f.firma_name || f.gegenstelle || "—")}</span><div class="os-tabelle-unter">${e(f.kategorie || "ohne Kategorie")}${f.notiz ? " · " + e(f.notiz) : ""} · seit ${datum(f.datum)}</div></td>
          <td>${pille(f.intervall === "monatlich" ? "monatlich" : "jährlich", "blau")}</td>
          <td class="rechts buch-betrag ausgabe">${geldGenau(f.betrag)}</td>
          <td class="rechts">${geldGenau(f.intervall === "monatlich" ? f.betrag : f.betrag / 12)}</td>
          <td>${nf ? pille(datum(nf), faelligTon, faelligTon !== "grau") : `<span class="buch-still">—</span>`}</td>
          <td class="rechts"><div class="buch-taten">
            <form method="post" action="/buchhaltung/fixkosten/${f.id}/buchen" class="buch-tat">
              <input type="hidden" name="zurueck" value="${hier}">
              ${auswahl("bezahlt", [["ja", "bezahlt"], ["nein", "noch offen"]], "ja", { attr: 'aria-label="Zahlungsstand" style="width:auto;height:30px;padding:0 26px 0 8px;font-size:12px"' })}
              <button type="submit" class="sekundaer" title="Die nächste Zahlung (${nf ? datum(nf) : "heute"}) als Buchung anlegen">${ICON.check} Gebucht</button></form>
            <form method="post" action="/buchhaltung/fixkosten/${f.id}/beenden" onsubmit="return confirm('Kostenstelle beenden? Die bisherigen Buchungen bleiben, sie zählt nur nicht mehr zur monatlichen Last.')">
              <input type="hidden" name="zurueck" value="${hier}"><button type="submit" class="still" title="Beenden">${ICON.x}</button></form></div></td></tr>`;
        }).join("")}</tbody>
        <tfoot><tr><td colspan="3">Monatliche Last</td><td class="rechts">${geldGenau(k.fixkostenMonat)}</td><td colspan="2"></td></tr></tfoot>
        </table></div>`
        : `<div class="os-leer os-leer--klein"><div class="os-leer-icon">${ICON.wiederholen}</div><h3>Noch keine wiederkehrenden Kosten</h3><p>Erfasse eine Ausgabe mit „Wiederkehrend: monatlich“ — sie steht dann hier mit ihrer nächsten Fälligkeit, und du buchst jeden Monat mit einem Klick.</p></div>`;

      const kundenBlock = (k.offenEin.length || (rechn.liste || []).length) ? `<div class="os-tabelle-huelle"><table class="os-tabelle os-tabelle--dicht">
        <thead><tr><th>Fällig</th><th>Kunde</th><th>Woher</th><th class="rechts">Betrag</th><th></th></tr></thead>
        <tbody>${(rechn.liste || []).map((r) => `<tr data-href="${e(r.url)}">
          <td>${faelligPille(r.faellig, r.faellig ? Math.round((new Date(heute) - new Date(r.faellig)) / 86400000) : null)}</td>
          <td><a href="${e(r.url)}"><span class="os-tabelle-titel">${e(r.firma || "—")}</span></a><div class="os-tabelle-unter">${e(r.nummer)}${r.notiz ? " · " + e(r.notiz) : ""}</div></td>
          <td>${pille("Rechnungsmodul", "grau")}</td>
          <td class="rechts buch-betrag einnahme">${geldGenau(r.betrag)}</td>
          <td class="rechts"><a class="knopf sekundaer klein" href="${e(r.url)}">Öffnen</a></td></tr>`).join("")}
        ${k.offenEin.map((b) => `<tr>
          <td>${faelligPille(b.faellig, b.tage_ueber)}</td>
          <td><span class="os-tabelle-titel">${e(b.firma_name || b.gegenstelle || "—")}</span><div class="os-tabelle-unter">Rechnung vom ${datum(b.datum)}${b.notiz ? " · " + e(b.notiz) : ""}</div></td>
          <td>${pille("Buchhaltung", "grau")}</td>
          <td class="rechts buch-betrag einnahme">${geldGenau(b.betrag)}</td>
          <td class="rechts">${bezahltForm(b.id, b.betrag)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="3">Summe offen</td><td class="rechts">${geldGenau(kundenOffenSumme)}</td><td></td></tr></tfoot>
        </table></div>`
        : `<div class="os-leer os-leer--klein"><div class="os-leer-icon">${ICON.check}</div><h3>Alles bezahlt</h3><p>Keine offene Kundenrechnung${rechn.da ? "" : " in der Buchhaltung"}.</p></div>`;

      const maxK = Math.max(1, ...k.kategorien.map((x) => x.betrag));
      const maxM = Math.max(1, ...k.monate.map((x) => x.betrag));
      const vonDb = Object.fromEntries(k.monate.map((x) => [x.monat, x.betrag]));
      const zwoelf = Array.from({ length: 12 }, (_, i) => {
        const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - (11 - i));
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
        return { key, betrag: vonDb[key] || 0, label: MONATE_KURZ[dt.getMonth()] };
      });
      const katBlock = k.kategorien.length ? `<div class="buch-gruppe-rumpf"><div class="buch-balken">${k.kategorien.map((x) => `
        <div class="os-fortschritt os-fortschritt--klein" role="progressbar" aria-valuenow="${Math.round(x.betrag / maxK * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="${e(x.kategorie)}">
          <div class="os-fortschritt-text"><span>${e(x.kategorie)} <small class="buch-still">${x.anzahl}</small></span><span>${geldGenau(x.betrag)}</span></div>
          <div class="os-fortschritt-balken"><span style="width:${Math.round(x.betrag / maxK * 100)}%"></span></div></div>`).join("")}</div>
        <div class="buch-mini-verlauf" aria-label="Ausgaben je Monat">${zwoelf.map((m) => `<div title="${m.label}: ${geld(m.betrag)}"><i style="height:${Math.max(2, Math.round(m.betrag / maxM * 100))}%"></i><small>${m.label}</small></div>`).join("")}</div></div>`
        : `<div class="os-leer os-leer--klein"><div class="os-leer-icon">${ICON.ab}</div><h3>Noch keine bezahlten Ausgaben</h3><p>In den letzten zwölf Monaten ist nichts gebucht und bezahlt worden.</p></div>`;

      res.send(seite(req, {
        titel: "Buchhaltung", unterzeile: "Kosten", id: "kosten",
        inhalt: `
        <div class="os-werkzeugleiste">
          <h2 class="os-werkzeugleiste-titel">Kosten
            <span class="os-werkzeugleiste-unter">Was noch zu zahlen ist, was schon gezahlt wurde — und was jeden Monat wiederkommt</span></h2>
          <div class="os-werkzeugleiste-aktionen"><a class="knopf dunkel" href="/buchhaltung#erfassen">${ICON.plus} Ausgabe erfassen</a></div>
        </div>
        ${k.migration0061 ? "" : `<div class="os-hinweis os-hinweis--warn">${ICON.warnung}<div>${fehlerText("migration-0061")}</div></div>`}
        ${kacheln}
        <section class="os-gruppe"><div class="os-gruppe-titel">Fällig demnächst <span class="os-gruppe-werkzeug">Ausgaben, nach Fälligkeit</span></div>${faelligBlock}</section>
        <section class="os-gruppe"><div class="os-gruppe-titel">Wiederkehrende Kosten <span class="os-gruppe-werkzeug">Fixkosten — gebucht wird per Klick, nie von selbst</span></div>${fixBlock}</section>
        <section class="os-gruppe" id="kunden"><div class="os-gruppe-titel">Offene Kundenrechnungen <span class="os-gruppe-werkzeug"><a href="/buchhaltung/rechnungen">Rechnungen &amp; Angebote</a></span></div>${kundenBlock}</section>
        <section class="os-gruppe"><div class="os-gruppe-titel">Ausgaben nach Kategorie, 12 Monate</div>${katBlock}</section>`,
      }));
    } catch (err) { next(err); }
  });

  // ================================================================ Aktionen

  app.post("/buchhaltung/buchen", nurAdmin, async (req, res, next) => {
    try {
      const ziel = zurueckZiel(req, "/buchhaltung");
      const r = await buch.buchen(req.nutzer, req.body || {});
      res.redirect(r.ok ? mitParam(ziel, "hinweis", r.offen ? "erfasst-offen" : "erfasst") : mitParam(ziel, "fehler", r.grund || "betrag"));
    } catch (err) { next(err); }
  });

  app.post("/buchhaltung/kasse", nurAdmin, async (req, res, next) => {
    try {
      const ziel = zurueckZiel(req, "/buchhaltung");
      await buch.einstellungenSetzen(req.nutzer, req.body || {});
      res.redirect(mitParam(ziel, "hinweis", "kasse"));
    } catch (err) { next(err); }
  });

  // Steuerkanzlei speichern (20.08.2026). Eigenes Formular, eigener Endpunkt:
  // Ein Formular schickt nur seine eigenen Felder mit, und so kann das
  // Speichern der Kanzlei den Kontostand nicht anfassen — und umgekehrt.
  //
  // Eine ungueltige Mailadresse wird nicht gespeichert; der Rest schon. Das
  // Ergebnis steht danach als Streifen auf der Seite.
  app.post("/buchhaltung/kanzlei", nurAdmin, async (req, res, next) => {
    try {
      const ziel = zurueckZiel(req, "/buchhaltung/monate");
      const r = await buch.einstellungenSetzen(req.nutzer, req.body || {});
      if (r && r.grund === "migration-fehlt") {
        console.error("Steuerkanzlei: Migration 0055 ist noch nicht eingespielt.");
      }
      res.redirect(r && r.ok ? mitParam(ziel, "hinweis", "kanzlei-gespeichert") : mitParam(ziel, "fehler", r?.grund || "kanzlei"));
    } catch (err) { next(err); }
  });

  // Haken bei einer offenen Buchung (Einnahme ODER Ausgabe). Der mitgegebene
  // Tag entscheidet ueber den Monatsordner — darum ist er ein Feld und nicht
  // stillschweigend "heute".
  app.post("/buchhaltung/bezahlt", nurAdmin, async (req, res, next) => {
    try {
      const b = req.body || {};
      const ziel = zurueckZiel(req, "/buchhaltung");
      const r = await buch.bezahltSetzen(req.nutzer, b.id, true, b.bezahlt_am || null);
      res.redirect(r.ok ? mitParam(ziel, "hinweis", "bezahlt") : mitParam(ziel, "fehler", "nicht-gefunden"));
    } catch (err) { next(err); }
  });

  app.post("/buchhaltung/loeschen", nurAdmin, async (req, res, next) => {
    try {
      const ziel = zurueckZiel(req, "/buchhaltung");
      await buch.buchungLoeschen(req.nutzer, (req.body || {}).id);
      res.redirect(mitParam(ziel, "hinweis", "geloescht"));
    } catch (err) { next(err); }
  });

  // Fixkosten: die naechste Zahlung anlegen / die Kostenstelle beenden.
  app.post("/buchhaltung/fixkosten/:id/buchen", nurAdmin, async (req, res, next) => {
    try {
      const ziel = zurueckZiel(req, "/buchhaltung/kosten");
      const r = await buch.fixkostenBuchen(req.nutzer, req.params.id, req.body || {});
      if (r.ok) return res.redirect(mitParam(ziel, "hinweis", r.offen ? "fixkosten-offen" : "fixkosten-gebucht"));
      res.redirect(mitParam(ziel, "fehler", r.grund === "schon-gebucht" ? "fixkosten-doppelt" : r.grund || "unbekannt"));
    } catch (err) { next(err); }
  });
  app.post("/buchhaltung/fixkosten/:id/beenden", nurAdmin, async (req, res, next) => {
    try {
      const ziel = zurueckZiel(req, "/buchhaltung/kosten");
      const r = await buch.fixkostenBeenden(req.nutzer, req.params.id);
      res.redirect(r.ok ? mitParam(ziel, "hinweis", "fixkosten-beendet") : mitParam(ziel, "fehler", r.grund || "nicht-gefunden"));
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
  // wuerde sonst unterwegs kaputtgehen. X-Quelle (seit 05.09.) sagt, ueber
  // welchen Weg der Beleg kam: web · handy · telegram · mail — Standard web.
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
          quelle: req.get("X-Quelle"),
        });
        res.json(r);
      } catch (err) { next(err); }
    });

  // Beleg ansehen — liefert die abgelegte Datei aus.
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

  // Dasselbe als Formular aus dem Pruef-Blatt ("Nochmal lesen").
  app.post("/buchhaltung/beleg/nochmal-lesen", nurAdmin, async (req, res, next) => {
    try {
      const ziel = zurueckZiel(req, "/buchhaltung/belege");
      const r = await buch.belegLesen(req.nutzer, (req.body || {}).id);
      if (r.ok) return res.redirect(mitParam(ziel, "hinweis", "gelesen"));
      if (r.grund) return res.redirect(mitParam(ziel, "fehler", r.grund));
      res.redirect(mitParam(mitParam(ziel, "fehler", "nicht-gelesen"), "text", String(r.hinweis || "").slice(0, 200)));
    } catch (err) { next(err); }
  });

  // Bestaetigen: aus dem geprueften Beleg wird eine Buchung. Bei einer
  // Kundenrechnung ohne Zahltag landet sie unter "Offen"; eine Ausgabe mit
  // "bezahlt = nein" ebenso (Rechnung mit Zahlungsziel).
  //
  // Antwortet mit JSON, wenn der Aufrufer es sagt (X-Antwort: json — die
  // Scan-Seite). Sonst Umleitung wie bisher: lib/beleg-telegram.js liest
  // "?gebucht=" / "?offen=" / "?fehler=" aus der Umleitung.
  app.post("/buchhaltung/beleg/buchen", nurAdmin, async (req, res, next) => {
    try {
      const b = req.body || {};
      const json = req.get("X-Antwort") === "json";
      const ziel = zurueckZiel(req, "/buchhaltung/belege");
      await buch.belegWerte(req.nutzer, b.id, b);
      const r = await buch.belegBuchen(req.nutzer, b.id, b.bezahlt_am || null,
        { offen: b.bezahlt === "nein", intervall: b.intervall });
      if (json) return res.json(r);
      if (r.ok) return res.redirect(mitParam(ziel, r.offeneRechnung ? "offen" : "gebucht", b.id));
      return res.redirect(mitParam(ziel, "fehler", r.grund || "unbekannt"));
    } catch (err) { next(err); }
  });

  // Verwerfen statt Loeschen — mit Grund, und der Beleg bleibt nachweisbar.
  app.post("/buchhaltung/beleg/verwerfen", nurAdmin, async (req, res, next) => {
    try {
      const b = req.body || {};
      const ziel = zurueckZiel(req, "/buchhaltung/belege");
      const r = await buch.belegVerwerfen(req.nutzer, b.id, b.grund);
      if (r.ok) return res.redirect(mitParam(ziel, "hinweis", "verworfen"));
      return res.redirect(mitParam(ziel, "fehler", r.grund || "unbekannt"));
    } catch (err) { next(err); }
  });

  // Postfach jetzt pruefen (05.09.2026). Derselbe Lauf wie der taegliche in
  // server.js — nur angestossen per Knopf und mit sieben Tagen Rueckschau statt
  // zwei, weil man den Knopf drueckt, wenn man etwas vermisst.
  //
  // Der Lauf braucht ein "dash", das Belege ablegt und liest. Der taegliche
  // Lauf geht dafuer ueber HTTP an sich selbst (telegram.dash mit
  // Dienstanmeldung). Hier gibt es die Sitzung schon: die beiden Endpunkte
  // werden direkt als Funktionen aufgerufen, unter den Rechten des
  // angemeldeten Nutzers — kein Umweg, keine zweite Anmeldung.
  const MAIL_TAGE = 7;
  app.post("/buchhaltung/mail-import", nurAdmin, async (req, res, next) => {
    const ziel = zurueckZiel(req, "/buchhaltung/belege");
    try {
      let gmail;
      try { gmail = require("./gmail-direkt.js"); } catch { gmail = null; }
      if (!gmail || !gmail.bereit()) return res.redirect(mitParam(ziel, "fehler", "mail-kein-zugang"));
      const mailBelege = require("./mail-belege.js");
      const u = req.nutzer;
      const dash = async (pfad, body, kopf = {}) => {
        let ergebnis;
        if (pfad === "/buchhaltung/beleg/hochladen") {
          let name = "Beleg";
          try { name = decodeURIComponent(kopf["X-Dateiname"] || "") || "Beleg"; } catch { name = kopf["X-Dateiname"] || "Beleg"; }
          ergebnis = await buch.belegHochladen(u, { art: kopf["X-Art"], dateiname: name, dateityp: kopf["X-Dateityp"] || null, daten: body, quelle: kopf["X-Quelle"] || "mail" });
        } else if (pfad === "/buchhaltung/beleg/lesen") {
          ergebnis = await buch.belegLesen(u, body && body.id);
        } else ergebnis = { ok: false, grund: "unbekannter-pfad" };
        return { status: 200, ok: true, json: async () => ergebnis, headers: { get: () => "" } };
      };
      const r = await mailBelege.laufen({ dash, tage: MAIL_TAGE });
      if (!r.ok) return res.redirect(mitParam(mitParam(ziel, "fehler", "mail-fehler"), "text", String(r.hint || "").slice(0, 200)));
      res.redirect(`${mitParam(ziel, "hinweis", "mail-import")}&neu=${r.neu}&uebersprungen=${r.uebersprungen}&tage=${MAIL_TAGE}`);
    } catch (err) { next(err); }
  });

  // ---------- Monatsabschluss ----------

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
      if (!r.ok) return res.redirect(mitParam("/buchhaltung/monate", "fehler", r.grund === "leer" ? "leer" : "zeitraum"));
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition",
        `attachment; filename="${r.dateiname.replace(/["\\\r\n]/g, "")}"`);
      res.setHeader("Content-Length", String(r.zip.length));
      res.send(r.zip);
    } catch (err) { next(err); }
  });

  // Das Excel (05.09.2026): Blatt "Übersicht" mit allen Bewegungen als echte
  // Zahlen und Daten, Blatt "Offen" mit den offenen Posten zum Stichtag.
  app.get("/buchhaltung/monat/:jahr/:monat/excel", nurAdmin, async (req, res, next) => {
    try {
      const r = await buch.monatsExcel(req.nutzer, req.params.jahr, req.params.monat);
      if (!r.ok) return res.redirect(mitParam("/buchhaltung/monate", "fehler", r.grund === "leer" ? "leer" : "zeitraum"));
      res.setHeader("Content-Type", require("./xlsx-schreiben.js").MIME);
      res.setHeader("Content-Disposition",
        `attachment; filename="${r.dateiname.replace(/["\\\r\n]/g, "")}"`);
      res.setHeader("Content-Length", String(r.datei.length));
      res.send(r.datei);
    } catch (err) { next(err); }
  });

  // An die Steuerkanzlei (05.09.2026): derselbe Weg wie per Sprache
  // (lib/steuer-versand.js), nur fuer genau diesen Monat und per Klick. Im
  // Standard landet die Mail als ENTWURF in Gmail (STEUER_MODUS leer), mit
  // STEUER_MODUS=senden geht sie direkt raus — der Klick auf den Knopf samt
  // Rueckfrage im Browser ist dann die Freigabe. ADS_PROBE=1 faengt beides ab.
  //
  // Vermerkt wird die Uebergabe nur, wenn wirklich etwas passiert ist
  // (Entwurf liegt oder Mail ist raus). Ein Probelauf zaehlt nicht als
  // Abschluss — sonst stuende "an Kanzlei" da, und niemand hat etwas bekommen.
  app.post("/buchhaltung/monat/:jahr/:monat/kanzlei", nurAdmin, async (req, res, next) => {
    const ziel = zurueckZiel(req, "/buchhaltung/monate");
    try {
      const u = req.nutzer;
      const jahr = Number(req.params.jahr), monat = Number(req.params.monat);
      if (!Number.isInteger(jahr) || !Number.isInteger(monat) || monat < 1 || monat > 12) return res.redirect(mitParam(ziel, "fehler", "zeitraum"));
      const k = await buch.steuerkanzlei(u);
      if (!k.an) return res.redirect(mitParam(ziel, "fehler", "kanzlei-fehlt"));
      const sv = require("./steuer-versand.js");
      const modus = process.env.STEUER_MODUS === "senden" ? "senden" : "entwurf";
      let r = await sv.vorbereiten(u, { zeitraum: monatName(jahr, monat), modus });
      if (r && r.ok && r.wartetAuf === "freigabe" && modus === "senden") r = await sv.senden();
      if (!r || !r.ok) {
        sv.vergessen();
        return res.redirect(mitParam(mitParam(ziel, "fehler", "kanzlei-versand"), "text", String(r?.reply || "Unbekannter Grund").slice(0, 240)));
      }
      if (r.probe) { sv.vergessen(); return res.redirect(mitParam(mitParam(ziel, "hinweis", "kanzlei-probe"), "an", k.an)); }
      await buch.anKanzleiVermerken(u, jahr, monat);
      sv.vergessen();
      res.redirect(mitParam(mitParam(ziel, "hinweis", r.gesendet ? "kanzlei-gesendet" : "kanzlei-entwurf"), "an", k.an));
    } catch (err) { next(err); }
  });
};

// Der Fehlerstreifen einzeln pruefbar (scripts/test-buchhaltung-fehler.js) —
// die Seite selbst braucht Datenbank und Anmeldung, die Zuordnung Code -> Satz
// nicht.
module.exports.fehlerText = fehlerText;
module.exports.FEHLERTEXTE = FEHLERTEXTE;
module.exports.hinweisText = hinweisText;
module.exports.zurueckZiel = zurueckZiel;
