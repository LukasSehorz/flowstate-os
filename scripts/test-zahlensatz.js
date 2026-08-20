// Prueft satzBauen() aus lib/daten-fragen.js — ohne Datenbank, ohne Modell.
//
// WARUM GETRENNT VON test-daten-fragen.js: Jenes stellt echte Fragen und
// braucht dafuer Datenbank und Modellzugang; es laeuft deshalb nicht vor dem
// Push mit. Der Schritt, an dem am 20.08. eine richtige Zahl verlorenging, ist
// aber reine Rechnerei und braucht beides nicht. Er gehoert damit in die
// Pruefung vor dem Push.
//
// DER FALL: Die Abfrage holte anzahl, gesamtumsatz und titel — alles korrekt.
// Vorgelesen wurde "5 gewonnene Deals im Juli 2026, darunter Baugeschaeft
// Stefan Huber …". Die 5.000 € standen in den Daten und kamen nie an. Auf die
// Nachfrage "in Euro?" antwortete Alexandra "Die Zahl hab ich hier gerade nicht
// vorliegen" — und las dieselbe Liste noch einmal vor.
//
// Aufruf:  node scripts/test-zahlensatz.js

const path = require("path");
const { satzBauen } = require(path.join(__dirname, "..", "lib", "daten-fragen.js"));
const { fuerStimme } = require(path.join(__dirname, "..", "lib", "aussprache.js"));

let fehler = 0;
const pruefe = (name, wahr, dazu = "") => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !dazu ? "" : "\n   " + dazu));
  if (!wahr) fehler++;
};

// --- Der Fall vom 20.08., Zeile fuer Zeile nachgestellt ---------------------
const juli = satzBauen(
  "gewonnene Deals im Juli 2026",
  ["anzahl", "gesamtumsatz", "titel"],
  Array.from({ length: 5 }, (_, i) => ({ anzahl: "5", gesamtumsatz: "5000.00", titel: "Baugeschäft Stefan Huber " + i })));
console.log("   " + juli);
pruefe("Gesamtsumme kommt vor", /5\.000\s*€/.test(juli), juli);
pruefe("Anzahl kommt vor", /^5 /.test(juli), juli);
pruefe("Beispiele kommen vor", /Stefan Huber/.test(juli), juli);
pruefe("Vorgelesen wird die Summe zu Euro",
  /fünftausend Euro/.test(fuerStimme(juli)), fuerStimme(juli).slice(0, 120));

// --- Die Formen, die vorher schon stimmten: duerfen nicht kippen ------------
const b = satzBauen("Umsatz im Juli 2026", ["umsatz"], [{ umsatz: "5000.00" }]);
pruefe("Einzelwert bleibt Geld", /5\.000\s*€/.test(b), b);

const c = satzBauen("Leads je Berater", ["anzahl", "name"],
  [{ anzahl: "183", name: "Ioannis" }, { anzahl: "90", name: "Jannik" }]);
pruefe("Zahl je Beschriftung bleibt", /183 Ioannis/.test(c) && /90 Jannik/.test(c), c);

const d = satzBauen("diesen Monat", ["gewonnen", "umsatz"], [{ gewonnen: 9, umsatz: "7000.00" }]);
pruefe("Mehrere Kennzahlen: Geld traegt Euro", /7\.000\s*€/.test(d), d);

// --- Keine SQL-Bezeichner im gesprochenen Satz ------------------------------
//
// Live gehoert: "Umsatz und gewonnene Deals im Juli 2026: 5.000 € umsatz,
// 5 anzahl deals." Zweimal Umsatz, einmal davon als Datenbankfeld. Sichtbar
// wurde es erst, seit Geldspalten in diesem Zweig ueberhaupt landen.
const sql = satzBauen("Umsatz und gewonnene Deals im Juli 2026",
  ["umsatz", "anzahl_deals"], [{ umsatz: "5000.00", anzahl_deals: 5 }]);
console.log("   " + sql);
for (const bez of ["umsatz", "anzahl_deals", "anzahl deals"]) {
  pruefe(`Bezeichner „${bez}“ kommt nicht woertlich vor`, !sql.includes(bez), sql);
}
pruefe("Der Betrag steht trotzdem drin", /5\.000\s*€/.test(sql), sql);
pruefe("Die Anzahl steht trotzdem drin", /(^| )5 Deals[ .,]/.test(sql), sql);

// Unterstriche werden zu deutschen Woertern, das Substantiv gross.
const mehr = satzBauen("was lief heute", ["neue_firmen", "neue_deals", "anrufe"],
  [{ neue_firmen: 3, neue_deals: 2, anrufe: 11 }]);
pruefe("Unterstriche verschwinden", !mehr.includes("_"), mehr);
pruefe("Substantiv gross, Eigenschaftswort klein", /neue Firmen/.test(mehr), mehr);

const e = satzBauen("neue Firmen heute", ["anzahl"], [{ anzahl: "273" }]);
pruefe("Reine Anzahl bleibt reine Anzahl", e.startsWith("273 ") && !/€/.test(e), e);

// Kein Geld im Spiel -> kein "zusammen …" dazuerfinden.
const f = satzBauen("offene Aufgaben", ["anzahl", "titel"],
  [{ anzahl: "3", titel: "Häckl Follow-up" }, { anzahl: "3", titel: "Matten.de" }]);
pruefe("Ohne Geldspalte kein Betrag im Satz", !/€/.test(f), f);

// Leeres Ergebnis bleibt ehrlich.
pruefe("Keine Treffer bleibt keine Treffer",
  /Keine Treffer/.test(satzBauen("Umsatz gestern", ["umsatz"], [])), "");

console.log(fehler ? `\n${fehler} Fall/Faelle durchgefallen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
