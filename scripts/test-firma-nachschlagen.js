// Testet, was aus dem CRM in einen Beleg uebernommen wird — und was nicht.
//
// Zwei Fehler waeren hier teuer, und beide sind still:
//
//   1. Das CRM ueberschreibt, was Lukas gerade gesagt hat. Er sitzt beim
//      Kunden, das CRM kann ein halbes Jahr alt sein. Faellt erst auf, wenn
//      der Brief zurueckkommt.
//   2. Bei mehreren passenden Firmen wird eine geraten. Dann geht ein Angebot
//      an den falschen Kunden — mit dessen Anschrift und Mailadresse.
//
// Aufruf: node scripts/test-firma-nachschlagen.js

const crm = require("../lib/crm.js");

// Die Datenbank wird ausgetauscht, BEVOR das Modul geladen wird.
let letzteAbfrage = null;
let BESTAND = [];
crm.system = async (sql, args) => {
  letzteAbfrage = { sql, args };
  const suche = String(args?.[0] || "").replace(/%/g, "").toLowerCase();
  const treffer = BESTAND.filter((f) => f.name.toLowerCase().includes(suche));
  // So sortiert es auch die echte Abfrage: woertlich zuerst, dann Anfang.
  treffer.sort((a, b) => {
    const w = (x) => (x.name.toLowerCase() === String(args?.[1] || "").toLowerCase() ? 0 : 1);
    const p = (x) => (x.name.toLowerCase().startsWith(suche) ? 0 : 1);
    return w(a) - w(b) || p(a) - p(b);
  });
  return { rows: treffer.slice(0, 4) };
};

const f = require("../lib/firma-nachschlagen.js");

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

const BERGMANN = {
  id: "1", name: "Physiotherapie Bergmann", branche: "Gesundheit",
  website: "https://physio-bergmann.de", telefon: "0871 123456",
  email: "info@physio-bergmann.de", adresse: "Altstadt 42", plz: "84028", ort: "Landshut",
  geschaeftsfuehrer: "Anna Bergmann", geschlecht: "w", taetigkeit: "Physiotherapie",
  mitarbeiter_zahl: 6, leistungen: "Manuelle Therapie, Lymphdrainage",
  besonderes: "Vier Behandlungsräume", anruf_notiz: "Empfang hängt ständig am Telefon",
};

(async () => {
  // --- Anrede aus Name und Geschlecht ---------------------------------------
  pruefe("Frau wird zu 'Frau …'", f.anredeZeile("Anna Bergmann", "w") === "Frau Anna Bergmann");
  pruefe("Mann wird zu 'Herrn …'", f.anredeZeile("Thomas Müller", "m") === "Herrn Thomas Müller");
  pruefe("Ausgeschrieben geht auch", f.anredeZeile("Anna Bergmann", "weiblich") === "Frau Anna Bergmann");
  // Lieber ohne Anrede als mit der falschen — "Herrn Kim Schneider" an eine Frau
  // ist genau die Art Fehler, die den Rest des Angebots entwertet.
  pruefe("Ohne Geschlecht keine geratene Anrede", f.anredeZeile("Kim Schneider", "") === "Kim Schneider");
  pruefe("Ohne Namen keine Anrede", f.anredeZeile("", "w") === "");

  // --- Der Normalfall --------------------------------------------------------
  BESTAND = [BERGMANN];
  const e = await f.ergaenzen({ firma: "Bergmann", betrag: 1900 });
  pruefe("Firma wird gefunden", Boolean(e.quelle), JSON.stringify(e.grund));
  pruefe("Der volle Firmenname wird uebernommen", e.auftrag.firma === "Physiotherapie Bergmann", e.auftrag.firma);
  pruefe("Anschrift kommt aus dem CRM", e.auftrag.strasse === "Altstadt 42" && e.auftrag.plz_ort === "84028 Landshut");
  pruefe("Ansprechpartner mit richtiger Anrede", e.auftrag.anrede === "Frau Anna Bergmann", e.auftrag.anrede);
  pruefe("Mailadresse kommt mit", e.auftrag.email === "info@physio-bergmann.de");
  pruefe("Die Website wird weitergereicht", e.quelle.website === "https://physio-bergmann.de");
  pruefe("Alexandra kann sagen, was sie ergaenzt hat",
    e.dazu.includes("Anschrift") && e.dazu.includes("Mailadresse"), e.dazu.join(", "));

  // --- WAS LUKAS SAGT, GEWINNT ----------------------------------------------
  //
  // Der wichtigste Fall. Er sitzt beim Kunden und nennt die neue Anschrift —
  // ein CRM-Eintrag von vor einem halben Jahr darf sie nicht ueberschreiben.
  const eigen = await f.ergaenzen({
    firma: "Bergmann", strasse: "Neue Gasse 8", plz_ort: "84030 Ergolding",
    anrede: "Herrn Peter Bergmann", email: "peter@physio-bergmann.de",
  });
  pruefe("Genannte Anschrift bleibt stehen", eigen.auftrag.strasse === "Neue Gasse 8", eigen.auftrag.strasse);
  pruefe("Genannter Ort bleibt stehen", eigen.auftrag.plz_ort === "84030 Ergolding");
  pruefe("Genannter Ansprechpartner bleibt stehen", eigen.auftrag.anrede === "Herrn Peter Bergmann");
  pruefe("Genannte Mailadresse bleibt stehen", eigen.auftrag.email === "peter@physio-bergmann.de");
  pruefe("Nichts wurde ergaenzt gemeldet, was nicht ergaenzt wurde",
    !eigen.dazu.includes("Anschrift") && !eigen.dazu.includes("Mailadresse"), eigen.dazu.join(", "));

  // --- Mehrere Treffer: FRAGEN, nicht raten ---------------------------------
  BESTAND = [
    { ...BERGMANN, id: "1", name: "Physiotherapie Bergmann" },
    { ...BERGMANN, id: "2", name: "Bergmann Elektrotechnik", email: "info@bergmann-elektro.de", adresse: "Industriestr. 3" },
    { ...BERGMANN, id: "3", name: "Autohaus Bergmann", email: "kontakt@autohaus-bergmann.de" },
  ];
  const viele = await f.ergaenzen({ firma: "Bergmann" });
  pruefe("Bei mehreren Firmen wird nicht geraten", !viele.quelle && viele.grund === "mehrdeutig", JSON.stringify(viele.grund));
  pruefe("Und alle Kandidaten werden genannt", (viele.namen || []).length === 3, (viele.namen || []).join(", "));

  // Eindeutig wird es, sobald der Name genauer ist.
  const genau = await f.ergaenzen({ firma: "Physiotherapie Bergmann" });
  pruefe("Ein woertlicher Treffer ist eindeutig", Boolean(genau.quelle) && genau.quelle.id === "1", JSON.stringify(genau.grund));

  const anfang = await f.ergaenzen({ firma: "Autohaus" });
  pruefe("Ein eindeutiger Anfang reicht auch", Boolean(anfang.quelle) && anfang.quelle.id === "3", JSON.stringify(anfang.grund));

  // --- Unbekannte Firma ------------------------------------------------------
  //
  // Kein Fehler: Bei einem neuen Kunden steht noch nichts im CRM. Der Beleg
  // muss trotzdem entstehen, nur eben aus dem, was Lukas sagt.
  const neu = await f.ergaenzen({ firma: "Ganz Neue GmbH", strasse: "Weg 1" });
  pruefe("Unbekannte Firma ist kein Fehler", !neu.quelle && neu.grund === "nicht-gefunden");
  pruefe("Der Auftrag bleibt dabei unversehrt", neu.auftrag.strasse === "Weg 1" && neu.auftrag.firma === "Ganz Neue GmbH");

  const kurz = await f.ergaenzen({ firma: "AB" });
  pruefe("Zu kurze Namen werden gar nicht gesucht", kurz.grund === "zu-kurz");

  // --- Was in den Angebotstext einfliesst ------------------------------------
  BESTAND = [BERGMANN];
  const q = (await f.ergaenzen({ firma: "Physiotherapie Bergmann" })).quelle;
  const txt = f.alsText(q);
  pruefe("Branche fliesst in den Text ein", /Gesundheit/.test(txt));
  pruefe("Leistungen fliessen ein", /Manuelle Therapie/.test(txt));
  pruefe("Die Notiz aus dem Telefonat fliesst ein", /Empfang hängt/.test(txt), txt);
  pruefe("Besonderheiten fliessen ein", /Vier Behandlungsräume/.test(txt));
  // Telefonnummer und Mailadresse gehoeren NICHT in den Angebotstext — sie
  // haetten dort nichts verloren und koennten im Fliesstext landen.
  pruefe("Telefonnummer fliesst NICHT in den Text", !/0871/.test(txt), txt);
  pruefe("Ohne Firma ist der Text leer", f.alsText(null) === "");

  // --- Die Abfrage selbst ----------------------------------------------------
  pruefe("Es wird unscharf gesucht", /ilike/.test(letzteAbfrage.sql));
  pruefe("Hoechstens vier Treffer", /limit 4/.test(letzteAbfrage.sql));

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
