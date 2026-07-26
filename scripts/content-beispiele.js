// Dummy-Daten fuer die Ideenwerkstatt, damit der ganze Weg durchklickbar ist:
// Vorschlaege (Haken/X), eine angenommene mit Skript, und Kaertchen in jeder
// Spalte der Produktionstafel mit zwei Videos je Tag.
//
// ALLE Titel beginnen mit "[Beispiel]" — beim Aufraeumen ist damit eindeutig,
// was echt ist und was nicht. Loeschen: node --env-file=.env scripts/content-beispiele.js --weg
const crm = require("../lib/crm.js");

const MARKE = "Jannik vom Hofe";
const P = "[Beispiel] ";

// Drei Vorschlaege je Funnel-Stufe, wie ein echter Lauf sie liefert.
const VORSCHLAEGE = [
  { funnel: "tofu", rubrik: "ki",
    titel: "Ich habe unsere Telefon-KI mit dem breitesten Dialekt getestet, den ich konnte",
    idee: "Bildschirmaufnahme, ich rufe die Telefon-KI an und rede absichtlich starkes Oberbayerisch. Erst versteht sie nichts, dann stelle ich einen Satz im Prompt um und es klappt. Am Ende der eine Satz, der den Unterschied gemacht hat.",
    warum: "Ein überprüfbares Scheitern im ersten Moment. Der Zuschauer bleibt, weil er wissen will, ob es doch funktioniert — und der Dialekt ist regional, das trifft genau unsere Gegend.",
    beispiel: "Live-Mitschnitte von Telefonaten mit Sprach-KI, wie sie als Bildschirmaufnahme verbreitet sind" },
  { funnel: "mofu", rubrik: "ki",
    titel: "Sieben Tage Anrufprotokoll einer Praxis, Zeile für Zeile",
    idee: "Ich scrolle durch das Gesprächsprotokoll eines KI-Telefonagenten, Namen unkenntlich. Uhrzeit, Anliegen, Ergebnis. Ich lese drei Zeilen laut vor — eine Terminverschiebung um 22 Uhr, eine Absage, und die eine, bei der die KI nicht weiterwusste.",
    warum: "Rohdaten statt Behauptung. Dass die zwei Fehlversuche mit im Bild sind, macht die zwölf gelungenen glaubwürdig.",
    beispiel: "" },
  { funnel: "bofu", rubrik: "ki",
    titel: "Was ein KI-Telefonagent kostet und was in den fünf Tagen davor passiert",
    idee: "Ich sitze da und gehe die fünf Tage durch, jeder Tag ein Einblender. Tag 1: eine Stunde mit dem Team, welche zehn Fragen am Telefon wirklich kommen. Tag 2: Anbindung ans Terminsystem. Tag 3 bis 5: Testanrufe. Zum Schluss die Zahl.",
    warum: "Preis und Ablauf offen zu nennen beantwortet die eigentliche Frage dieser Stufe und filtert gleichzeitig: wer sich danach meldet, meldet sich mit einer konkreten Absicht.",
    beispiel: "" },
  { funnel: "tofu", rubrik: "lifestyle",
    titel: "5:40 Uhr aufstehen war nicht das Problem — das hier war es",
    idee: "Handkamera, dunkler Morgen, ich gehe durch den Ablauf der ersten Stunde. Dann der Bruch: das Frühaufstehen hat nichts gebracht, solange der Abend vorher unstrukturiert war. Ich zeige, was ich abends geändert habe.",
    warum: "Setzt eine bekannte Erwartung und dreht sie in der Mitte um. Kein Ratschlag, sondern ein korrigierter Irrtum — das lässt sich schwerer wegwischen.",
    beispiel: "" },
  { funnel: "mofu", rubrik: "webdesign",
    titel: "Ich habe die Ladezeit von 8,4 auf 1,1 Sekunden gedrückt — mit drei Handgriffen",
    idee: "Split-Screen mit zwei Messungen. Ich gehe die drei Ursachen durch: unkomprimierte Bilder aus dem Handy, ein Schriftpaket mit neun Schnitten, ein Cookie-Banner, der alles blockiert. Nach jedem Handgriff die neue Messung im Bild.",
    warum: "Eine Zahl vorher, eine nachher, drei nachvollziehbare Schritte dazwischen. Das ist überprüfbar und damit nicht wegzudiskutieren.",
    beispiel: "" },
];

// Die Produktionstafel: zwei Videos je Tag, verteilt ueber die Spalten.
const TAFEL = [
  // status, Tagesversatz ab heute, Titel, Rubrik, Funnel
  ["aufnehmen", 2, "Die drei Sätze, die auf jeder Praxis-Website fehlen", "webdesign", "tofu"],
  ["aufnehmen", 2, "Morgens 20 Minuten ohne Handy — was sich nach zwei Wochen ändert", "lifestyle", "tofu"],
  ["aufnehmen", 3, "Google Ads für Physios: worauf wir NICHT bieten", "performance", "mofu"],
  ["aufnehmen", 3, "Mein Schreibtisch nach einem Tag mit vier Kundenterminen", "lifestyle", "tofu"],
  ["aufnehmen", 4, "Was eine KI-Terminannahme in der ersten Woche wirklich abnimmt", "ki", "mofu"],
  ["aufnehmen", 4, "Warum ich Freitag ab 14 Uhr keine Termine mehr annehme", "lifestyle", "tofu"],
  ["aufnehmen", 5, "Kundenstimme: Praxis Neuhausen nach drei Monaten", "webdesign", "bofu"],
  ["aufnehmen", 5, "Sonntagabend: wie ich die Woche in 25 Minuten plane", "lifestyle", "tofu"],
  ["schneiden", 1, "Vier Klicks bis zum Termin — einer ist zu viel", "webdesign", "tofu"],
  ["schneiden", 1, "Was mich 2026 am meisten Zeit gekostet hat", "lifestyle", "tofu"],
  ["schneiden", 0, "Meta-Ads: das Budget, ab dem es überhaupt Sinn hat", "performance", "mofu"],
  ["hochladen", 0, "Unsere Preise, offen ausgesprochen", "webdesign", "bofu"],
  ["geplant", 0, "Ein Tag mit unserer eigenen Automatisierung", "ki", "tofu"],
];

// Ein glaubwuerdiges Skript fuer die angenommene Idee.
const SKRIPT = `HOOK (0–3 s)
Bild: Bildschirmaufnahme, Telefon klingelt.
Ich: „Ich rufe jetzt unsere eigene Telefon-KI an. Und ich rede so, wie man hier redet."

AUFBAU (3–12 s)
KI hebt ab, freundliche Begrüßung.
Ich, breit: „Griaß di, i bräucht heid nomoi an Termin, mei Kreuz macht ma z'schaffen."
Pause. Die KI antwortet daneben — sie hat „Kreuz" nicht verstanden.
Einblender: „Erster Versuch: nicht verstanden."

WENDE (12–24 s)
Ich: „Das Problem ist nicht die KI. Das Problem ist, dass ihr niemand gesagt hat, wie unsere Leute reden."
Ich zeige eine Zeile im Prompt und ergänze sie: die zehn Begriffe, die hier wirklich fallen.
Einblender: „Eine Zeile. Nicht ein neues Modell."

BEWEIS (24–34 s)
Zweiter Anruf, gleicher Satz. Die KI: „Rückenschmerzen, verstehe. Heute 16:30 wäre frei."
Schnitt auf den echten Kalender: 16:30 ist frei. Nicht geraten — angebunden.

SCHLUSS (34–38 s)
Ich: „Eine KI, die nur hochdeutsch versteht, ist in Traunstein keine KI. Sie ist ein Anrufbeantworter."
Kein Verkaufssatz. Nur der Satz.

HINWEIS ZUR AUFNAHME
Der Fehlversuch muss echt sein und im Bild bleiben. Ohne ihn ist der Beweis am
Ende nichts wert — dann ist es Werbung.`;

(async () => {
  const weg = process.argv.includes("--weg");
  const { rows: [m] } = await crm.system(`select id, name from profiles where name = $1`, [MARKE]);
  if (!m) throw new Error("Marke nicht gefunden: " + MARKE);

  if (weg) {
    const a = await crm.system(`delete from content_ideen where titel like $1`, [P + "%"]);
    const b = await crm.system(`delete from content_posts where titel like $1`, [P + "%"]);
    console.log(`Weggeraeumt: ${a.rowCount} Ideen, ${b.rowCount} Kaertchen.`);
    process.exit(0);
  }

  // Erst alte Beispiele weg, damit nichts doppelt herumliegt.
  await crm.system(`delete from content_ideen where titel like $1`, [P + "%"]);
  await crm.system(`delete from content_posts where titel like $1`, [P + "%"]);

  // Vorschlaege — die ersten vier bleiben offen, der letzte ist angenommen mit Skript.
  let offen = 0, ja = 0;
  for (const [i, v] of VORSCHLAEGE.entries()) {
    const letzter = i === VORSCHLAEGE.length - 1;
    await crm.system(
      `insert into content_ideen (marke, kanal, rubrik, funnel, titel, idee, warum,
                                 beispiel_quelle, status, skript, skript_am,
                                 entschieden_am, entschieden_von, quelle, erstellt)
       values ($1,'TikTok',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ki', now() - ($13 || ' hours')::interval)`,
      [m.id, v.rubrik, v.funnel, P + v.titel, v.idee, v.warum, v.beispiel || null,
       letzter ? "angenommen" : "vorschlag",
       letzter ? SKRIPT : null, letzter ? new Date() : null,
       letzter ? new Date() : null, letzter ? m.id : null, String(i * 3 + 1)]);
    letzter ? ja++ : offen++;
  }

  // Kaertchen auf der Tafel.
  for (const [status, versatz, titel, rubrik, funnel] of TAFEL) {
    const kanaele = ["TikTok", "YouTube Shorts", "Instagram"];
    await crm.system(
      `insert into content_posts (titel, kanaele, sorte, status, geplant_am, marke,
                                 rubrik, funnel, besitzer, stufe_seit, laenge_sek)
       values ($1,$2,'Kurzvideo',$3, current_date + ($4::int), $5, $6, $7, $5,
               now() - ($8 || ' days')::interval, $9)`,
      [P + titel, kanaele, status, versatz, m.id, rubrik, funnel,
       String(Math.floor(Math.random() * 7)), 30 + Math.floor(Math.random() * 25)]);
  }

  console.log(`Angelegt: ${offen} offene Vorschlaege, ${ja} angenommen (mit Skript), ${TAFEL.length} Kaertchen auf der Tafel.`);
  console.log("Wegraeumen mit: node --env-file=.env scripts/content-beispiele.js --weg");
  process.exit(0);
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
