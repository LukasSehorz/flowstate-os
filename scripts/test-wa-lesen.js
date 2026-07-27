// Testet das WhatsApp-Lesen (25.07.) — vor allem die Luecke, die am 24.07.
// auffiel: "Kannst du kurz die neuen WhatsApp-Nachrichten checken?" ging ins
// Leere, weil es nur leseChat(NAME) gab. Der Server suchte einen Kontakt namens
// "die neuen Nachrichten" und fand natuerlich keinen.
//
// Aufruf: node scripts/test-wa-lesen.js

const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wa-test-"));
process.env.WA_DIR = TMP;
process.env.DATA_PATH = TMP;
process.env.WA_GRUPPEN = "Team Flowstate";

const jetzt = Math.floor(Date.now() / 1000);
fs.writeFileSync(path.join(TMP, "contacts.json"), JSON.stringify({
  "491700006888@s.whatsapp.net": { name: "Jannik vom Hofe", notify: "Jannik" },
  "491700003333@s.whatsapp.net": { name: "Mama", notify: "" },
}));
fs.writeFileSync(path.join(TMP, "gruppen.json"), JSON.stringify({
  "111111@g.us": { name: "Team Flowstate" },
}));
// Verlauf: eingehend ("sie") und ausgehend ("ich"), teils alt.
fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), [
  { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 600, text: "Bin gleich im Büro." },
  { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 300, text: "Brauchst du was vom Bäcker?" },
  { jid: "491700003333@s.whatsapp.net", richtung: "sie", von: "Mama", ts: jetzt - 1800, text: "Ruf mal an." },
  { jid: "111111@g.us", richtung: "sie", von: "Ioannis", ts: jetzt - 900, text: "Termin verschoben auf zehn." },
  { jid: "491700006888@s.whatsapp.net", richtung: "ich", von: "Lukas", ts: jetzt - 700, text: "Ne danke." },
  { jid: "491700003333@s.whatsapp.net", richtung: "sie", von: "Mama", ts: jetzt - 200000, text: "Uraltes Zeug." },
].map((o) => JSON.stringify(o)).join("\n") + "\n");

const whatsapp = require("../lib/whatsapp.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

(async () => {
  // --- Der Kernfall: allgemeine Frage ohne Namen -------------------------
  for (const frage of ["neue Nachrichten", "die neuen WhatsApp-Nachrichten", "was ist neu", "whatsapp", ""]) {
    const r = await whatsapp.leseChat(frage);
    const ok = r.ok && /von Jannik/i.test(r.reply);
    pruefe(`Allgemein ("${frage || "leer"}") wird zusammengefasst`, ok);
    if (!ok) console.log("      bekommen:", String(r.reply).slice(0, 90));
  }

  const alle = await whatsapp.neueNachrichten();
  pruefe("Zaehlt nur EINGEHENDE (Lukas' eigene nicht)", !/Ne danke/.test(alle.reply));
  pruefe("Alte Nachrichten fallen aus dem Fenster", !/Uraltes/.test(alle.reply));
  pruefe("Der juengste Chat kommt zuerst", alle.reply.indexOf("Jannik") < alle.reply.indexOf("Mama"));
  pruefe("Mehrere aus einem Chat werden gezaehlt", /2 von Jannik/i.test(alle.reply));
  pruefe("Freigegebene Arbeitsgruppe wird genannt", /In Team Flowstate/.test(alle.reply));
  pruefe("Die letzte Nachricht wird zitiert", /Brauchst du was vom Bäcker/.test(alle.reply));
  pruefe("Personen stehen VOR den Gruppen",
    alle.reply.indexOf("Jannik") < alle.reply.indexOf("Team Flowstate"));
  console.log("   →", alle.reply.slice(0, 150));

  // --- Die echte Lage vom 27.07. auf Lukas' Handy ------------------------
  //
  // Gemessen: 349 eingehende Nachrichten in zwoelf Stunden, 15 Chats — davon
  // 14 Gruppen und genau EINE Person. Alexandra sagte damals "350 neue
  // Nachrichten, 168 in der Gruppe 84564" und las 576 Zeichen vor. Alles
  // richtig, und trotzdem keine Antwort auf die Frage, die er gestellt hat.
  //
  // Nachgestellt wird hier auch die kaputte Gruppe: eine, die die Bruecke
  // nicht kennt. Ihr Name wurde frueher aus dem ABSENDER geraten — daher die
  // "84564". Sie darf jetzt nicht mehr vorkommen.
  const viele = [];
  for (let i = 0; i < 168; i++) {
    viele.push({ jid: "999999@g.us", richtung: "sie", von: "4917000" + (84564 + i), ts: jetzt - 3000 - i, text: "Gruppengeplauder " + i });
  }
  for (let i = 0; i < 60; i++) {
    viele.push({ jid: "888888@g.us", richtung: "sie", von: "Irgendwer", ts: jetzt - 4000 - i, text: "Urlaubsfoto " + i });
  }
  for (let i = 0; i < 63; i++) {
    viele.push({ jid: "111111@g.us", richtung: "sie", von: "Ioannis", ts: jetzt - 2000 - i, text: "Arbeitskram " + i });
  }
  viele.push({ jid: "491700003333@s.whatsapp.net", richtung: "sie", von: "Mama", ts: jetzt - 100, text: "Meldest du dich mal?" });
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), viele.map((o) => JSON.stringify(o)).join("\n") + "\n");

  const echt = await whatsapp.neueNachrichten();
  console.log("   →", echt.reply);
  pruefe("Lawine: die Person kommt zuerst", /^Von Mama/.test(echt.reply));
  pruefe("Lawine: kein erfundener Gruppenname aus einer Nummer", !/84564/.test(echt.reply));
  pruefe("Lawine: private Gruppen nur als Zahl, ohne Namen",
    /228 aus privaten Gruppen/.test(echt.reply));
  pruefe("Lawine: Arbeitsgruppe mit Anzahl statt Zitat",
    /63 in Team Flowstate/.test(echt.reply) && !/Arbeitskram/.test(echt.reply));
  pruefe("Lawine: bleibt vorlesbar kurz (war 576 Zeichen)", echt.reply.length < 200);

  // Drei Personen auf einmal — die Lage im ersten Live-Lauf nach dem Umbau.
  // Damals wurden alle drei in voller Laenge zitiert, zusammen ueber 400
  // Zeichen. Ab dem dritten Zitat hoert bei einer Stimme niemand mehr zu.
  const drei = [
    { jid: "491700001111@s.whatsapp.net", richtung: "sie", von: "Phil", ts: jetzt - 100,
      text: "ja top! Schick gerne mal nen Bild vom Buero. das sollte aber passen. Ja koennen es gerne zusammen machen. aber dann vielleicht nach einander und ich schneide es zusammen." },
    { jid: "491700003333@s.whatsapp.net", richtung: "sie", von: "Mama", ts: jetzt - 200, text: "Ja" },
    { jid: "491700002222@s.whatsapp.net", richtung: "sie", von: "Anna", ts: jetzt - 300,
      text: "Alles gut. Es ist gerade ja auch super viel los und in Bewegung bei dir. Mach dir da keinen Kopf und da ist eine Woche frueher oder spaeter nicht entscheidend." },
  ];
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), drei.map((o) => JSON.stringify(o)).join("\n") + "\n");
  const dreiR = await whatsapp.neueNachrichten();
  console.log("   →", dreiR.reply);
  pruefe("Drei Personen: hoechstens zwei im Wortlaut",
    (dreiR.reply.match(/„/g) || []).length <= 2);
  pruefe("Drei Personen: die dritte wird trotzdem genannt", /Anna/.test(dreiR.reply));
  pruefe("Drei Personen: bleibt vorlesbar (war ueber 400 Zeichen)", dreiR.reply.length < 320);

  // Nur Gruppenrauschen, kein Mensch: ehrlich sagen, dass nichts da ist.
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"),
    viele.filter((m) => m.jid.endsWith("@g.us") && m.jid !== "111111@g.us")
      .map((o) => JSON.stringify(o)).join("\n") + "\n");
  const nurLaerm = await whatsapp.neueNachrichten();
  pruefe("Nur private Gruppen: 'Nichts Persoenliches'", /Nichts Persoenliches/.test(nurLaerm.reply));
  console.log("   →", nurLaerm.reply);

  // Fixture zurueck fuer die folgenden Faelle.
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), [
    { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 600, text: "Bin gleich im Büro." },
    { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 300, text: "Brauchst du was vom Bäcker?" },
    { jid: "491700003333@s.whatsapp.net", richtung: "sie", von: "Mama", ts: jetzt - 1800, text: "Ruf mal an." },
    { jid: "111111@g.us", richtung: "sie", von: "Ioannis", ts: jetzt - 900, text: "Termin verschoben auf zehn." },
  ].map((o) => JSON.stringify(o)).join("\n") + "\n");

  // --- "Ungelesen" ohne Gelesen-Status (Lukas, 27.07.) -------------------
  //
  // Er fragte "gibt es noch ungelesene Nachrichten" und bekam zwoelf Stunden
  // Verlauf — darunter Chats, in denen er laengst geantwortet hatte. Die
  // Bruecke liefert keinen Gelesen-Status (in /wa gibt es keine Chatliste mit
  // unreadCount), also wird das beste vorhandene Signal genutzt: seine EIGENEN
  // Nachrichten. Wer gerade selbst geschrieben hat, hat den Chat auch gelesen.
  //
  // Aufbau unten: In Jannis Chat hat Lukas zuletzt geantwortet, DANACH kam
  // eine neue Nachricht — die zaehlt. Bei Mama liegt seine Antwort NACH ihrer
  // Nachricht — die zaehlt nicht mehr. In der Arbeitsgruppe hat er nie
  // geschrieben, da greift das Zeitfenster als Boden.
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), [
    { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 3000, text: "Alte Frage, schon beantwortet." },
    { jid: "491700006888@s.whatsapp.net", richtung: "ich", von: "Lukas", ts: jetzt - 2000, text: "Ja passt." },
    { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 900, text: "Und noch was Neues." },
    { jid: "491700003333@s.whatsapp.net", richtung: "sie", von: "Mama", ts: jetzt - 4000, text: "Ruf mal an." },
    { jid: "491700003333@s.whatsapp.net", richtung: "ich", von: "Lukas", ts: jetzt - 1000, text: "Mach ich." },
    { jid: "111111@g.us", richtung: "sie", von: "Ioannis", ts: jetzt - 600, text: "Termin steht." },
  ].map((o) => JSON.stringify(o)).join("\n") + "\n");

  const unge = await whatsapp.leseChat("gibt es noch ungelesene Nachrichten");
  console.log("   →", unge.reply);
  pruefe("Ungelesen: sagt worauf es sich bezieht", /Seit du zuletzt geschrieben hast/.test(unge.reply));
  pruefe("Ungelesen: was NACH seiner Antwort kam, zaehlt", /Und noch was Neues/.test(unge.reply));
  pruefe("Ungelesen: was er schon beantwortet hat, faellt weg", !/Alte Frage/.test(unge.reply));
  pruefe("Ungelesen: Chat, in dem ER zuletzt schrieb, faellt ganz weg", !/Mama/.test(unge.reply));
  pruefe("Ungelesen: Gruppe ohne eigene Nachricht bleibt drin", /Team Flowstate/.test(unge.reply));

  // Hat er ueberall zuletzt geschrieben, ist ehrlich nichts da.
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), [
    { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 3000, text: "Frage." },
    { jid: "491700006888@s.whatsapp.net", richtung: "ich", von: "Lukas", ts: jetzt - 100, text: "Antwort." },
  ].map((o) => JSON.stringify(o)).join("\n") + "\n");
  const nix = await whatsapp.leseChat("neue Nachrichten");
  pruefe("Ungelesen: alles beantwortet -> ehrlich 'nichts Neues'",
    /nichts Neues gekommen/.test(nix.reply));
  console.log("   →", nix.reply);

  // --- Der ECHTE Ungelesen-Zaehler (chats.json) --------------------------
  //
  // Zweiter Anlauf am 27.07.: Die Bruecke hoerte nie auf "chats.*", genau dort
  // liefert WhatsApp unreadCount je Chat — dieselbe Zahl wie im gruenen Kreis
  // auf dem Handy, und sie faellt auf 0, sobald Lukas den Chat dort oeffnet.
  // Liegt chats.json vor, gilt sie; die Schaetzung oben ist nur noch Rueckfall.
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), [
    { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 5000, text: "Laengst gelesen." },
    { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 400, text: "Das ist neu." },
    { jid: "491700003333@s.whatsapp.net", richtung: "sie", von: "Mama", ts: jetzt - 300, text: "Auch gelesen." },
    { jid: "111111@g.us", richtung: "sie", von: "Ioannis", ts: jetzt - 200, text: "Gruppe, eine offen." },
  ].map((o) => JSON.stringify(o)).join("\n") + "\n");
  fs.writeFileSync(path.join(TMP, "chats.json"), JSON.stringify({
    "491700006888@s.whatsapp.net": { unread: 1, t: jetzt - 400 },   // nur die juengste
    "491700003333@s.whatsapp.net": { unread: 0, t: jetzt - 300 },   // gelesen -> raus
    "111111@g.us": { unread: 1, t: jetzt - 200 },
  }));
  const echtZ = await whatsapp.leseChat("gibt es ungelesene Nachrichten");
  console.log("   →", echtZ.reply);
  pruefe("Zaehler: sagt 'Ungelesen', nicht die Naeherung", /^Ungelesen: /.test(echtZ.reply));
  pruefe("Zaehler: gelesener Chat faellt ganz weg", !/Mama/.test(echtZ.reply));
  pruefe("Zaehler: nur die als ungelesen gezaehlte Nachricht", /Das ist neu/.test(echtZ.reply));
  pruefe("Zaehler: aeltere im selben Chat bleiben stumm", !/Laengst gelesen/.test(echtZ.reply));

  // Alles gelesen -> ehrliche, ECHTE Auskunft (nicht die Schaetzung).
  fs.writeFileSync(path.join(TMP, "chats.json"), JSON.stringify({
    "491700006888@s.whatsapp.net": { unread: 0, t: jetzt - 400 },
    "111111@g.us": { unread: 0, t: jetzt - 200 },
  }));
  const durch = await whatsapp.leseChat("ungelesene Nachrichten");
  pruefe("Zaehler: alles gelesen -> 'Nichts Ungelesenes'", /Nichts Ungelesenes/.test(durch.reply));
  console.log("   →", durch.reply);

  // Ohne chats.json bleibt es bei der erklaerten Naeherung.
  fs.rmSync(path.join(TMP, "chats.json"));
  const ohne = await whatsapp.leseChat("ungelesene Nachrichten");
  pruefe("Ohne Zaehler: Rueckfall auf die Naeherung, sichtbar benannt",
    /Seit du zuletzt geschrieben hast/.test(ohne.reply));

  // Die Frage nach EINEM Chat darf davon unberuehrt bleiben — dort will Lukas
  // den Verlauf sehen, nicht nur das Unbeantwortete.
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), [
    { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 3000, text: "Bin gleich im Büro." },
    { jid: "491700006888@s.whatsapp.net", richtung: "ich", von: "Lukas", ts: jetzt - 100, text: "Ok." },
  ].map((o) => JSON.stringify(o)).join("\n") + "\n");
  const einer = await whatsapp.leseChat("Jannik");
  pruefe("Bestimmter Chat zeigt weiter den Verlauf, nicht nur Unbeantwortetes",
    /Büro/.test(einer.reply));

  // Ausgangsvorlage zurueck fuer die folgenden Faelle.
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), [
    { jid: "491700006888@s.whatsapp.net", richtung: "ich", von: "Lukas", ts: jetzt - 700, text: "Ne danke." },
    { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 600, text: "Bin gleich im Büro." },
    { jid: "491700006888@s.whatsapp.net", richtung: "sie", von: "Jannik", ts: jetzt - 300, text: "Brauchst du was vom Bäcker?" },
    { jid: "491700003333@s.whatsapp.net", richtung: "sie", von: "Mama", ts: jetzt - 1800, text: "Ruf mal an." },
    { jid: "111111@g.us", richtung: "sie", von: "Ioannis", ts: jetzt - 900, text: "Termin verschoben auf zehn." },
  ].map((o) => JSON.stringify(o)).join("\n") + "\n");

  // --- Ein bestimmter Chat funktioniert weiter ---------------------------
  const j = await whatsapp.leseChat("Jannik");
  pruefe("Bestimmter Kontakt: Jannik gefunden", /Jannik/.test(j.reply) && /Bäcker/.test(j.reply));

  const g = await whatsapp.leseChat("Team Flowstate");
  pruefe("Bestimmte Gruppe funktioniert auch", /Termin verschoben/.test(g.reply));

  const x = await whatsapp.leseChat("Xaver Unbekannt");
  pruefe("Unbekannter Kontakt wird ehrlich gemeldet", /find keinen Kontakt/i.test(x.reply));

  // --- Leeres Fenster ----------------------------------------------------
  fs.writeFileSync(path.join(TMP, "verlauf.jsonl"), "");
  const leer = await whatsapp.neueNachrichten();
  pruefe("Ohne Nachrichten: ehrliche Auskunft", /nichts reingekommen/i.test(leer.reply));

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
