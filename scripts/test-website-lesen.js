// Testet das Lesen der Kundenwebsite — vor allem, WAS NICHT gelesen werden darf.
//
// Die URL kommt aus der Datenbank, nicht von Lukas. Ein Eintrag wie
// "http://localhost:5432" wuerde den Server dazu bringen, sich selbst
// abzufragen und das Ergebnis in ein Angebot an einen Kunden zu schreiben.
// Deshalb steht die Netzpruefung hier im Mittelpunkt, nicht das Textausleseb.
//
// Aufruf: node scripts/test-website-lesen.js

const w = require("../lib/website-lesen.js");

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

(async () => {
  // --- Was als intern gilt ---------------------------------------------------
  const intern = ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255",
    "169.254.169.254", "0.0.0.0", "::1", "fc00::1", "fe80::1"];
  pruefe("Alle internen Adressen werden erkannt",
    intern.every((ip) => w.istIntern(ip)), intern.filter((ip) => !w.istIntern(ip)).join(", "));

  // 172.32 liegt AUSSERHALB des privaten Bereichs (der endet bei 172.31) —
  // eine zu grosszuegige Regel wuerde echte Kundenseiten aussperren.
  const aussen = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "93.184.216.34", "11.0.0.1"];
  pruefe("Oeffentliche Adressen werden nicht faelschlich gesperrt",
    aussen.every((ip) => !w.istIntern(ip)), aussen.filter((ip) => w.istIntern(ip)).join(", "));

  // --- Was gar nicht erst versucht wird -------------------------------------
  for (const [url, was] of [
    ["file:///etc/passwd", "Dateizugriff"],
    ["gopher://alt.example.com", "fremdes Protokoll"],
    ["ftp://example.com", "FTP"],
    ["nicht mal eine url", "Unsinn"],
  ]) {
    const r = await w.erlaubt(url);
    pruefe(`Abgewiesen: ${was}`, !r.ok, JSON.stringify(r));
  }

  const lokal = await w.erlaubt("http://localhost:5432");
  pruefe("Abgewiesen: der eigene Rechner", !lokal.ok && /intern|auflös/.test(lokal.grund), JSON.stringify(lokal));

  const eigen = await w.erlaubt("http://127.0.0.1:3000/buchhaltung");
  pruefe("Abgewiesen: die eigene Buchhaltung", !eigen.ok, JSON.stringify(eigen));

  // --- Leere Eingabe ---------------------------------------------------------
  const leer = await w.lesen("");
  pruefe("Ohne Website kommt eine klare Auskunft", !leer.ok && /keine Website/.test(leer.grund), leer.grund);

  // --- HTML zu Text ----------------------------------------------------------
  const html = `<!doctype html><html><head>
    <title>Physiotherapie Bergmann – Praxis in Landshut</title>
    <meta name="description" content="Manuelle Therapie, Lymphdrainage und Krankengymnastik in Landshut.">
    <style>body{color:red}</style><script>var x = "Startseite Leistungen";</script>
    </head><body>
    <h1>Willkommen in unserer Praxis</h1>
    <p>Wir behandeln in vier modernen R&auml;umen.</p>
    <ul><li>Manuelle Therapie</li><li>Lymphdrainage</li></ul>
    <!-- interner Kommentar -->
    </body></html>`;
  const t = w.textAus(html);
  pruefe("Titel wird herausgezogen", /Titel: Physiotherapie Bergmann/.test(t), t.slice(0, 120));
  pruefe("Beschreibung wird herausgezogen", /Beschreibung: Manuelle Therapie/.test(t));
  pruefe("Fliesstext kommt mit", /vier modernen Räumen/.test(t), t);
  pruefe("Listenpunkte kommen mit", /Manuelle Therapie/.test(t) && /Lymphdrainage/.test(t));
  // Skript- und Stilinhalte im Angebotstext waeren peinlich.
  pruefe("Kein Skriptinhalt im Text", !/var x/.test(t), t);
  pruefe("Kein Stilinhalt im Text", !/color:red/.test(t));
  pruefe("Keine Kommentare im Text", !/interner Kommentar/.test(t));
  pruefe("Keine Steuerzeichen uebrig", !/<|>/.test(t), t);
  pruefe("Umlaut-Entities werden aufgeloest", !/&auml;/.test(t));

  // --- Eine echte Seite ------------------------------------------------------
  //
  // Der einzige Fall, der nach draussen geht. Faellt das Netz aus, ist das kein
  // Testfehler — nur eine andere Umgebung.
  const echt = await w.lesen("example.com");
  if (echt.ok) {
    pruefe("Eine echte Seite laesst sich lesen", echt.text.length > 100, `${echt.text.length} Zeichen`);
    pruefe("Ohne Schema wird https ergaenzt", /^https:\/\//.test(echt.url), echt.url);
  } else {
    console.log(`⏭  Kein Netz erreichbar (${echt.grund}) — der Teil mit einer echten Seite entfällt.`);
  }

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
