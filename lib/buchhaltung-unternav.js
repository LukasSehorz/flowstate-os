// Gemeinsame Unter-Navigation der Buchhaltung (05.09.2026).
//
// Warum eine eigene Datei: Die Buchhaltung besteht ab heute aus fuenf Seiten
// (Uebersicht, Belege, Rechnungen & Angebote, Monatsabschluss, Kosten), die
// von zwei Modulen gebaut werden — lib/buchhaltung-routes.js und
// lib/rechnungen-routes.js. Beide brauchen dieselbe Reiterleiste unter dem
// Seitenkopf. Zwei Kopien waeren zwei Reihenfolgen, zwei Schreibweisen und
// beim naechsten Reiter eine vergessene Stelle.
//
// Aufruf:  schale({ ..., aktiv: "buchhaltung", reiter: unternav("rechnungen") })
//
// Markup: ".reiterleiste"/".reiter" aus crm.css geben der Leiste schon heute
// das bekannte Aussehen; ".os-unternav" ist der Haken fuer das gemeinsame
// Bausteinsystem (public/os-ui.css), das die Leiste feiner zeichnet, sobald es
// geladen ist. Beide Klassen zusammen: die Seite sieht vorher und nachher
// richtig aus.

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Reihenfolge = Reihenfolge auf der Seite. Die id ist das, was unternav()
// als "aktiv" bekommt.
const SEITEN = [
  { id: "uebersicht", titel: "Übersicht", href: "/buchhaltung" },
  { id: "belege", titel: "Belege", href: "/buchhaltung/belege" },
  { id: "rechnungen", titel: "Rechnungen & Angebote", href: "/buchhaltung/rechnungen" },
  { id: "monate", titel: "Monatsabschluss", href: "/buchhaltung/monate" },
  { id: "kosten", titel: "Kosten", href: "/buchhaltung/kosten" },
];

function unternav(aktiv = "uebersicht") {
  const links = SEITEN.map((s) =>
    `<a href="${s.href}" class="${s.id === aktiv ? "aktiv" : ""}"${s.id === aktiv ? ' aria-current="page"' : ""}>${e(s.titel)}</a>`).join("");
  return `<div class="reiterleiste os-unternav" role="navigation" aria-label="Buchhaltung"><nav class="reiter">${links}</nav></div>`;
}

module.exports = { unternav, SEITEN };
