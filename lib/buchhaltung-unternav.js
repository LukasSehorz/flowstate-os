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

// Handy-Skript (30.09.2026). Zwei Aufgaben, die CSS allein nicht kann:
//
// 1) Der Verlauf am Rand muss WISSEN, wo die Leiste gerade steht. Sonst
//    verblasst der letzte Reiter auch dann noch, wenn man schon ganz rechts
//    ist — er saehe aus wie ausgegraut statt wie anklickbar. Das Skript
//    schreibt nur zwei Merkmale (data-links, data-rechts); wie es dann
//    aussieht, entscheidet public/buchhaltung.css.
//
// 2) Wer auf dem Telefon "Kosten" anklickt, landet auf einer Seite, deren
//    Reiterleiste ganz links steht — der aktive Reiter waere unsichtbar.
//    Darum wird er beim Laden herangeschoben.
//
// Dasselbe Skript bedient die Tabellenhuellen: Sie tragen denselben Verlauf
// und brauchen dieselbe Standmeldung.
//
// Warum inline und nicht als Datei: Es sind zwanzig Zeilen, sie gehoeren zu
// genau diesem Baustein, und eine eigene Datei waere ein zweiter Ort, an dem
// man die Reiterleiste suchen muss.
const SKRIPT = `<script>
(function(){
  // Merkt am Element, ob links bzw. rechts noch etwas wartet.
  function stand(el){
    var rest = el.scrollWidth - el.clientWidth - el.scrollLeft;
    el.setAttribute("data-links", el.scrollLeft > 4 ? "1" : "0");
    el.setAttribute("data-rechts", rest > 4 ? "1" : "0");
  }
  function beobachten(el){
    stand(el);
    el.addEventListener("scroll", function(){ stand(el); }, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(function(){ stand(el); }).observe(el);
  }
  var leiste = document.querySelector(".reiterleiste.os-unternav");
  if (leiste) {
    beobachten(leiste);
    // Den aktiven Reiter ins Bild holen — ohne Animation, sonst ruckelt die
    // Seite beim Laden sichtbar an.
    var a = leiste.querySelector("a.aktiv");
    if (a && a.offsetLeft + a.offsetWidth > leiste.clientWidth) {
      var vorher = leiste.style.scrollBehavior;
      leiste.style.scrollBehavior = "auto";
      leiste.scrollLeft = a.offsetLeft - 14;
      leiste.style.scrollBehavior = vorher;
      stand(leiste);
    }
  }
  // Tabellen und Umschalt-Schienen kommen teils erst nach dem Laden dazu
  // (Filter, Nachladen) — deshalb beim Laden alle einsammeln und spaeter
  // erneut, wenn sich der Inhaltsbereich aendert.
  function roller(){
    var t = document.querySelectorAll(".buch-seite .os-tabelle-huelle:not([data-rechts]), .buch-seite .os-segment:not([data-rechts])");
    for (var i = 0; i < t.length; i++) beobachten(t[i]);
  }
  // WARUM erst bei DOMContentLoaded: Dieses Skript steht direkt hinter der
  // Reiterleiste — also VOR <main>. Zum Zeitpunkt des Ausfuehrens gibt es die
  // Tabellen noch gar nicht, und document.querySelector("main") ist null.
  // Gemessen: data-rechts blieb an jeder Tabelle leer, der Verlauf hing fest.
  // Die Leiste selbst steht schon da und wird oben sofort bedient — nur der
  // Inhaltsteil wartet.
  function spaeter(){
    roller();
    var haupt = document.querySelector("main");
    if (haupt && window.MutationObserver) new MutationObserver(roller).observe(haupt, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", spaeter);
  else spaeter();
})();
</script>`;

function unternav(aktiv = "uebersicht") {
  const links = SEITEN.map((s) =>
    `<a href="${s.href}" class="${s.id === aktiv ? "aktiv" : ""}"${s.id === aktiv ? ' aria-current="page"' : ""}>${e(s.titel)}</a>`).join("");
  return `<div class="reiterleiste os-unternav" role="navigation" aria-label="Buchhaltung"><nav class="reiter">${links}</nav></div>${SKRIPT}`;
}

module.exports = { unternav, SEITEN };
