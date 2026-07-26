// Testet die selbst eintragende Navigation (26.07.).
//
// Warum es das gibt: lib/schale.js ist die einzige Datei, die JEDER anfassen
// muesste, der einen neuen Bereich baut — und genau hier ist am 26.07. der
// erste Merge-Konflikt entstanden (beinahe waere dabei der Weiss-Modus
// verschwunden). Seit Lukas und Jannik beide direkt auf main arbeiten, muss
// "Marketing bauen" ohne Aenderung an dieser Datei gehen.
//
// Aufruf: node scripts/test-navigation.js

process.env.VAULT_PATH = process.env.VAULT_PATH || __dirname;
const { eintragen, MODULE, navigation, schale } = require("../lib/schale.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

const vorher = MODULE.length;
const nutzer = { name: "Lukas Sehorz", rolle: "admin" };

// 1. Neuer Bereich landet in der Rail.
eintragen({ id: "test-neu", titel: "Testbereich", icon: "projekte", href: "/testbereich" });
pruefe("Neuer Bereich ist in der Liste", MODULE.some((m) => m.id === "test-neu"));
pruefe("Er erscheint in der gerenderten Rail", /Testbereich/.test(navigation("zentrale", nutzer)));

// 2. Einsortieren an eine bestimmte Stelle.
eintragen({ id: "test-nach", titel: "Direkt nach Buchhaltung", icon: "euro", href: "/tn", nach: "buchhaltung" });
const iBuch = MODULE.findIndex((m) => m.id === "buchhaltung");
const iNach = MODULE.findIndex((m) => m.id === "test-nach");
pruefe("'nach' setzt den Eintrag an die richtige Stelle", iNach === iBuch + 1);

// 3. Ein bestehender Platzhalter wird ERGAENZT, nicht verdoppelt.
//    (Marketing steht schon als leerer Menuepunkt in der Liste.)
const vorMarketing = MODULE.filter((m) => m.id === "marketing").length;
eintragen({ id: "marketing", titel: "Marketing & Content", icon: "marketing", href: "/marketing",
  unter: [{ id: "marketing-kampagnen", titel: "Kampagnen", icon: "megafon", href: "/marketing/kampagnen" }] });
pruefe("Vorhandene id wird nicht verdoppelt", MODULE.filter((m) => m.id === "marketing").length === vorMarketing);
pruefe("Unterpunkte kommen dazu", (MODULE.find((m) => m.id === "marketing").unter || []).length === 1);
pruefe("Unterpunkt erscheint, wenn der Bereich offen ist",
  /Kampagnen/.test(navigation("marketing", nutzer)));
pruefe("Unterpunkt bleibt versteckt, solange er es nicht ist",
  !/Kampagnen/.test(navigation("zentrale", nutzer)));

// 4. Robustheit — ein Tippfehler darf die Rail nicht zerlegen.
const stillerFehler = console.error; let gemeckert = 0;
console.error = () => { gemeckert++; };
eintragen({ titel: "Ohne id", href: "/x" });
eintragen(null);
console.error = stillerFehler;
pruefe("Unvollstaendiger Eintrag wird abgelehnt und gemeldet", gemeckert === 2);

eintragen({ id: "test-icon", titel: "Falsches Icon", icon: "gibtsnicht", href: "/ti" });
pruefe("Unbekanntes Icon faellt auf einen Standard zurueck",
  MODULE.find((m) => m.id === "test-icon").icon === "projekte");
pruefe("Die Rail rendert trotzdem sauber", /Falsches Icon/.test(navigation("zentrale", nutzer)));

// 5. Die ganze Seite baut weiterhin.
const html = schale({ titel: "Test", inhalt: "<p>x</p>", aktiv: "test-neu", nutzer });
pruefe("Vollstaendige Seite wird gebaut", html.includes("<!doctype html>") && html.includes("Testbereich"));

console.log(`\n(${vorher} Module vorher, ${MODULE.length} nachher)`);
console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
