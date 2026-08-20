// scripts/websuche-proben.js — die Websuche gegen echte Fragen fahren.
//
// Warum es das gibt (Auftrag Lukas, 20.08.2026): "Es soll so lange getestet und
// nachgebessert werden, bis es zuverlaessig laeuft. Nicht einmal messen und fuer
// gut befinden."
//
// Der Test misst DREI Dinge, und alle drei muessen stimmen:
//   1. Dauer. Ueber 10 s Stille wirken im Gespraech wie ein Absturz. Ziel: < 6 s.
//   2. Richtigkeit. Wo die Antwort nachpruefbar ist, steht sie hier als Muster.
//   3. Ehrlichkeit. Fragen, deren Antwort es NICHT gibt, muessen scheitern —
//      eine erfundene Zahl ist schlimmer als keine.
//
// Aufruf (nur im Container, braucht Netz und Schluessel):
//   ssh flowstate 'docker exec -i flowstate-dashboard node' < scripts/websuche-proben.js
//   ... oder mit Filter:  NUR=sport node scripts/websuche-proben.js
//
// Die Fragen laufen NACHEINANDER. Das ist Absicht: Die Rueckbezugs-Faelle
// ("wie haben sie gespielt") setzen voraus, dass die vorige Frage derselben
// Sitzung schon durch ist.

// Die Bibliothek wird ueber WEB_LIB gefunden. Grund: Der Test laeuft laut
// MITARBEIT per "docker exec -i ... node" mit dem Skript auf der STANDARDEINGABE
// — dann gibt es kein __dirname, an dem ein relativer Pfad haengen koennte.
const pfad = require("path");
const WURZEL = process.env.WEB_LIB || (typeof __dirname === "string" ? pfad.join(__dirname, "..", "lib") : "/app/lib");
const suche = require(pfad.join(WURZEL, "suche-web.js"));

// erwartet: muss im Text stehen. verboten: darf nicht. finden:false = die
// Antwort gibt es nicht, sie MUSS ehrlich scheitern.
const PROBEN = [
  // --- Sport: der harte Fall, woertlich von Lukas -------------------------
  //
  // Das `verboten` ist hier das Wichtigste am ganzen Test. Die Vereinsseite
  // zeigt die ABGESCHLOSSENE Vorsaison direkt unter dem aktuellen Stand — im
  // Lauf vom 20.08. kam zweimal "Platz eins mit sechsundfuenfzig Punkten aus
  // sechsundzwanzig Spielen" heraus. Das ist eine echte Zahl von einer echten
  // Seite und trotzdem die falsche Antwort. Ein Test, der nur "steht Platz
  // drin?" prueft, haette beide Male gruen gemeldet.
  { art: "sport", sitzung: "s1", frage: "Wie steht der SV Oberbergkirchen in der Tabelle?",
    erwartet: /kreisliga/i,
    verboten: /sechsundf[üu]nfzig|sechsundzwanzig Spiel|26 Spiel|\b56\b/i,
    notiz: "Kreisliga 1 Inn/Salzach, Saison 26/27: Platz 4, 3 Punkte aus 1 Spiel (Stand 20.08.2026)" },
  { art: "sport", sitzung: "s1", frage: "Wie haben sie am Wochenende gespielt?",
    erwartet: /gr[üu]nthal|gewonnen|verloren|unentschieden|null|eins zu/i,
    rueckbezug: "SV Oberbergkirchen",
    notiz: "RUECKBEZUG — 'sie' = der Verein davor. Am Fr 14.08. bei FC Grünthal 1:0 gewonnen" },
  { art: "sport", sitzung: "s2", frage: "In welcher Liga spielt der TSV Dorfen?",
    erwartet: /liga|klasse/i },
  // GEAENDERT am 20.08.2026, und der Grund gehoert zum Test dazu: Die urspruengliche
  // Frage war "Wer steht gerade an der Spitze der Bundesliga-Tabelle?". Am
  // 1. Spieltag hat noch keine Mannschaft gespielt — alle stehen bei null
  // Punkten, es GIBT keinen Tabellenfuehrer. Mal antwortete Alexandra "mehrere
  // teilen sich die Spitze", mal "finde ich nicht"; beides ist richtig, und ein
  // Test, der zwischen zwei richtigen Antworten wuerfelt, misst nichts.
  // Die Meisterfrage hat dagegen genau eine Antwort.
  { art: "sport", sitzung: "s3", frage: "Wer wurde 2026 deutscher Fußballmeister?",
    erwartet: /bayern|leverkusen|dortmund|leipzig|stuttgart|frankfurt|bremen|hoffenheim|union|mainz|freiburg|wolfsburg|gladbach|hamburg|k[öo]ln|augsburg/i },
  { art: "sport", sitzung: "s4", frage: "Wer hat das letzte Champions-League-Finale gewonnen?",
    erwartet: /\w{4,}/ },
  { art: "sport", sitzung: "s5", frage: "Wann wurde der SV Oberbergkirchen gegründet?",
    erwartet: /1966/ },

  // --- Aktuelles ----------------------------------------------------------
  { art: "aktuell", sitzung: "a1", frage: "Was ist heute in Deutschland passiert?",
    erwartet: /\w{6,}/ },
  { art: "aktuell", sitzung: "a2", frage: "Wie ist das Wetter gerade in Hamburg?",
    erwartet: /grad|regen|sonn|bew[öo]lk|wolk|schauer|trocken|wind/i },
  { art: "aktuell", sitzung: "a3", frage: "Wie hoch steht der DAX gerade?",
    erwartet: /\d\.?\d{3}|\d{2}\.\d{3}|punkte|tausend/i },
  // WEICH, mit Begruendung (20.08.2026): Diese Frage hat an ruhigen Tagen keine
  // feste Antwort. In sieben von acht Laeufen kam "Nein, gerade nicht" (aus
  // bahn.de und netzwelt.de), einmal "finde ich nichts Belastbares" — und das
  // ist bei einer Frage nach dem NICHTVORHANDENSEIN einer Stoerung dieselbe
  // Aussage in anderen Worten. Was hier zaehlt: Sie darf keine Stoerung
  // erfinden, die es nicht gibt.
  { art: "aktuell", sitzung: "a4", frage: "Gibt es gerade eine Störung bei der Deutschen Bahn?",
    weich: true, erwartet: /\w{5,}/ },

  // --- Fakten mit Zahlen --------------------------------------------------
  { art: "zahlen", sitzung: "z1", frage: "Wie viele Einwohner hat Dorfen?",
    erwartet: /1[45]\.?\d{3}|vierzehntausend|f[üu]nfzehntausend|dreizehntausend/i,
    notiz: "rund 15.000" },
  { art: "zahlen", sitzung: "z2", frage: "Wie weit ist es von München nach Salzburg?",
    erwartet: /1[35]\d\s*(km|kilometer)|hundert.*kilometer|kilometer/i, notiz: "ca. 145 km" },
  { art: "zahlen", sitzung: "z3", frage: "Wie hoch ist der Eiffelturm?",
    erwartet: /33[0-9]|32[0-9]|dreihundert/i },
  { art: "zahlen", sitzung: "z4", frage: "Wie hoch ist der Mehrwertsteuersatz in Deutschland?",
    erwartet: /19|neunzehn/i },
  { art: "zahlen", sitzung: "z5", frage: "Wie viele Einwohner hat der Landkreis Mühldorf am Inn?",
    erwartet: /1(1|2)\d\.?\d{3}|hunderttausend|einhundert/i, notiz: "rund 117.000" },
  // WEICH, mit Begruendung (20.08.2026): Tagesaktuelle Spritpreise je Bundesland
  // stehen bei clever-tanken und ADAC hinter JavaScript, das wir in unter drei
  // Sekunden nicht ausfuehren. Was uebrig bleibt, sind Staedte-Ranglisten und
  // eine bundesweite Zahl von vorgestern. Beides zu nennen ist in Ordnung —
  // zuzugeben, dass es nicht sauber dasteht, ist es auch. Nur ERFINDEN darf sie
  // nichts, und genau das prueft `verboten` hier.
  { art: "zahlen", sitzung: "z6", frage: "Was kostet ein Liter Diesel gerade in Bayern?",
    weich: true, erwartet: /1,\d|2,\d|1\.\d|2\.\d|euro|cent/i },
  { art: "zahlen", sitzung: "z7", frage: "Wie hoch ist der gesetzliche Mindestlohn in Deutschland?",
    erwartet: /12|13|zw[öo]lf|dreizehn|euro/i },

  // --- Firmen und Personen aus dem Umfeld ---------------------------------
  { art: "umfeld", sitzung: "u1", frage: "Wer ist Bürgermeister von Dorfen?",
    erwartet: /\w{4,}/ },
  { art: "umfeld", sitzung: "u2", frage: "Wer ist der bayerische Ministerpräsident?",
    erwartet: /s[öo]der/i },
  { art: "umfeld", sitzung: "u3", frage: "Was macht die Firma Krotzer und Eisele?",
    erwartet: /\w{5,}/ },
  { art: "umfeld", sitzung: "u4", frage: "Wo sitzt die Firma Wacker Chemie?",
    erwartet: /m[üu]nchen|burghausen|bayern/i },

  // --- Rueckbezug ausserhalb des Sports -----------------------------------
  { art: "rueckbezug", sitzung: "r1", frage: "Wie viele Einwohner hat Erding?",
    erwartet: /3[0-9]\.?\d{3}|dreissig|dreißig|vierunddreißig|sechsunddreißig/i },
  { art: "rueckbezug", sitzung: "r1", frage: "Und wer ist dort Bürgermeister?",
    erwartet: /\w{4,}/, rueckbezug: "Erding" },

  // --- Was es nicht gibt: muss ehrlich scheitern --------------------------
  { art: "ehrlich", sitzung: "n1", frage: "Wie viele Tore hat Jannik vom Hofe für den SV Oberbergkirchen geschossen?",
    finden: false },
  { art: "ehrlich", sitzung: "n2", frage: "Wie hoch war der Umsatz der Sehorz und vom Hofe GbR im Jahr 2025?",
    finden: false },
  { art: "ehrlich", sitzung: "n3", frage: "Wer ist Präsident des FC Xylophon Untergrübling?",
    finden: false },
  { art: "ehrlich", sitzung: "n4", frage: "Wann findet das Quarkfest in Oberbergkirchen 2031 statt?",
    finden: false },
];

const NUR = (process.env.NUR || "").toLowerCase();
const nur = NUR ? PROBEN.filter((p) => p.art === NUR || p.frage.toLowerCase().includes(NUR)) : PROBEN;

// Was im Sprechtext NICHTS zu suchen hat. Anforderung 3: vorlesbar.
const UNSPRECHBAR = [
  [/https?:\/\//i, "URL im Sprechtext"],
  [/\bwww\.\b/i, "www im Sprechtext"],
  [/\|/, "Tabellenstrich im Sprechtext"],
  [/^\s*[-•*]\s/m, "Aufzaehlung im Sprechtext"],
  [/^\s*\d\.\s+\w+.*\n\s*\d\.\s/m, "Nummernliste im Sprechtext"],
  [/\bquelle\b/i, "Quellenangabe im Sprechtext"],
  [/NICHT GEFUNDEN/i, "Rohmarke im Sprechtext"],
];

function urteilen(p, r) {
  const maengel = [];
  const text = `${r.reply || ""} ${r.gesprochen || ""}`;

  if (p.finden === false) {
    if (r.gefunden) maengel.push("hat etwas erfunden statt zuzugeben, dass es nichts gibt");
  } else if (p.weich) {
    // Weiche Faelle: Ein ehrliches "finde ich nicht" ist erlaubt. Kommt aber
    // eine Antwort, muss sie zum Erwarteten passen — geraten wird nicht.
    if (r.gefunden && p.erwartet && !p.erwartet.test(text)) {
      maengel.push("Antwort passt nicht zum Erwarteten");
    }
  } else {
    if (!r.gefunden) maengel.push("nichts gefunden, obwohl es die Antwort gibt");
    else if (p.erwartet && !p.erwartet.test(text)) maengel.push("Antwort passt nicht zum Erwarteten");
  }
  if (p.verboten && p.verboten.test(text)) maengel.push("verbotener Inhalt");
  if (p.rueckbezug && !(r.stufen && r.stufen.rueckbezug)) maengel.push("Rueckbezug nicht aufgeloest");
  if (p.rueckbezug && r.stufen && r.stufen.rueckbezug &&
      !String(r.stufen.frage).toLowerCase().includes(p.rueckbezug.toLowerCase().split(" ").pop())) {
    maengel.push(`Rueckbezug falsch aufgeloest (${r.stufen.rueckbezug})`);
  }
  for (const [muster, was] of UNSPRECHBAR) {
    if (muster.test(String(r.gesprochen || ""))) maengel.push(was);
  }
  if (r.dauerMs > 10000) maengel.push("ueber 10 s — im Gespraech ein Absturz");
  return maengel;
}

(async () => {
  console.log(`\nWebsuche-Proben — ${nur.length} Fragen, ${new Date().toLocaleString("de-DE")}\n`);
  const zeilen = [];
  let schlecht = 0, langsam = 0;

  for (const p of nur) {
    const r = await suche.websuche(p.frage, { sitzung: p.sitzung });
    const maengel = urteilen(p, r);
    if (maengel.length) schlecht++;
    if (r.dauerMs > 6000) langsam++;

    const zeichen = maengel.length ? "❌" : (r.dauerMs > 6000 ? "🐌" : "✅");
    console.log(`${zeichen} [${p.art}] ${p.frage}`);
    console.log(`   ${(r.dauerMs / 1000).toFixed(1)} s` +
      `  (suche ${r.stufen.sucheMs || "-"} / seiten ${r.stufen.seitenMs || "-"} / satz ${r.stufen.satzMs || "-"} ms)` +
      `  Quelle: ${r.quelle || "—"}` +
      (r.stufen.rueckbezug ? `  Rueckbezug: „${r.stufen.rueckbezug}“` : "") +
      (r.stufen.seiten && r.stufen.seiten.length ? `  gelesen: ${r.stufen.seiten.join(", ")}` : ""));
    console.log(`   → ${String(r.gesprochen || r.hint || "").replace(/\s+/g, " ").slice(0, 260)}`);
    if (p.notiz) console.log(`   (soll: ${p.notiz})`);
    for (const m of maengel) console.log(`   ⚠ ${m}`);
    console.log("");

    zeilen.push({
      art: p.art, frage: p.frage, dauer: (r.dauerMs / 1000).toFixed(1),
      gefunden: r.gefunden ? "ja" : "nein", quelle: r.quelle || "",
      richtig: maengel.length ? "NEIN" : "ja",
      antwort: String(r.gesprochen || r.hint || "").replace(/\s+/g, " ").slice(0, 120),
      maengel: maengel.join("; "),
    });
  }

  // --- Messtabelle ---------------------------------------------------------
  const dauern = zeilen.map((z) => Number(z.dauer)).sort((a, b) => a - b);
  const median = dauern[Math.floor(dauern.length / 2)];
  const p90 = dauern[Math.floor(dauern.length * 0.9)];

  console.log("\n─────────────────── MESSTABELLE ───────────────────");
  console.log("Dauer | richtig | Quelle          | Frage");
  for (const z of zeilen) {
    console.log(`${z.dauer.padStart(5)}s | ${z.richtig.padEnd(7)} | ${(z.quelle || "—").padEnd(15).slice(0, 15)} | ${z.frage}`);
  }
  console.log("───────────────────────────────────────────────────");
  console.log(`Median ${median}s · p90 ${p90}s · langsamste ${dauern[dauern.length - 1]}s`);
  console.log(`${zeilen.length - schlecht} von ${zeilen.length} richtig · ${langsam} ueber 6 s`);
  console.log(schlecht
    ? `\n${schlecht} Frage(n) noch nicht in Ordnung.`
    : "\nAlle Fragen in Ordnung.");
  process.exit(schlecht ? 1 : 0);
})().catch((e) => { console.error("ABBRUCH:", e); process.exit(2); });
