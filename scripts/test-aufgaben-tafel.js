// scripts/test-aufgaben-tafel.js — die Bruecke Aufgabe -> Whiteboard, OHNE Datenbank.
//
//   node scripts/test-aufgaben-tafel.js
//
// Laeuft in scripts/pruefen.js mit. Der Whiteboard-Speicher ist die
// Arbeitsspeicher-Fassung (wie in scripts/whiteboard-probe.js); die
// Aufgaben-Tabelle ersetzt ein Merker. Geprueft wird die ganze Rechnerei aus
// lib/aufgaben-tafel.js: Zeile bauen, an den Kunden-Block anhaengen, neuen
// Block an den festen Kunden-Platz legen, unter Belegtes ruecken, an der
// Tafelkante klemmen (auch beim Anhaengen langer Zeilen), die 200-Zeilen-
// Grenze, der Versionskonflikt, gleichzeitige Anlagen unter der Sperre, der
// Haken Tafel -> Liste, das Nachziehen nach Rueckgaengig — und dass
// pruefeElement (whiteboard-routes.js) den Aufgaben-Bezug und eigene Pfade
// behaelt, javascript: aber verwirft. Seit 08.09.2026 dazu Abschnitt 14: die
// fuenfte Kategorie "CRM" und die fuenf festen Plaetze in drei Spalten.
//
// Das Gegenstueck MIT Datenbank (RLS mit Verantwortlichem, echte Route,
// aufgabe_haken_auf_tafel) ist scripts/test-aufgaben-db.js.

const crypto = require("crypto");
const { speicherImArbeitsspeicher } = require("../lib/whiteboard-speicher.js");
const { pruefeElement } = require("../lib/whiteboard-routes.js");
const bruecke = require("../lib/aufgaben-tafel.js");

let fehler = 0;
const melde = (ok, text) => { console.log((ok ? "✅" : "❌") + " " + text); if (!ok) fehler++; };

// Dieselben erfundenen Konten wie in der Whiteboard-Probe.
const LUKAS   = { id: "11111111-1111-4111-8111-111111111111", name: "Lukas Sehorz", rolle: "admin" };
const JANNIK  = { id: "22222222-2222-4222-8222-222222222222", name: "Jannik vom Hofe", rolle: "admin" };
const LOUIS   = { id: "33333333-3333-4333-8333-333333333333", name: "Louis Tournier", rolle: "mitarbeiter" };
const IOANNIS = { id: "44444444-4444-4444-8444-444444444444", name: "Ioannis", rolle: "mitarbeiter" };
const OKAN    = { id: "55555555-5555-4555-8555-555555555555", name: "Okan", rolle: "mitarbeiter" };

const uuid = () => crypto.randomUUID();
// Ein Block, wie ihn der Speicher erwartet (inhalt als JSON-Text).
const block = (tafel, { x, y, breite = 560, hoehe = 200, zeilen = 1, kategorie, art = "text", texte } = {}) => ({
  id: uuid(), tafel, art, x, y, breite, hoehe,
  inhalt: JSON.stringify({
    liste: "check", farbe: "schwarz", groesse: 28,
    ...(kategorie ? { kategorie } : {}),
    ...(art === "notiz" ? { zettel: "gelb" } : {}),
    zeilen: (texte || Array.from({ length: zeilen }, (_, i) => "Zeile " + (i + 1)))
      .map((t) => ({ t, erledigt: false, gestrichen: false })),
  }),
});
const H1 = bruecke.hoeheSchaetzen(1);   // geschaetzte Hoehe eines Ein-Zeilen-Blocks (77)
const aufgabeX = (id, extra = {}) => ({ id, titel: "Aufgabe " + id, firma_id: 9, firma_name: "Firma X", ...extra });

(async () => {
  // ------------------------------------------------ 1. pruefeElement
  {
    const p = pruefeElement({
      art: "text", x: 1, y: 2, breite: 560, hoehe: H1,
      inhalt: {
        liste: "check", farbe: "schwarz", groesse: 28, kategorie: "kunden",
        zeilen: [
          { t: "Sonnenhof: Angebot", erledigt: false, gestrichen: false, link: "/crm/firma/12", aufgabe: 12 },
          { t: "Bezug als Text", aufgabe: "34" },
          { t: "Kein Bezug", aufgabe: -1 },
          { t: "Kein Bezug 2", aufgabe: "abc" },
          { t: "Kein Bezug 3", aufgabe: 0 },
          { t: "javascript", link: "javascript:alert(1)" },
          { t: "protokoll-relativ", link: "//boese.de/x" },
          { t: "nur Schraegstrich", link: "/" },
          { t: "mailto", link: "mailto:a@b.de" },
          { t: "extern", link: "https://kunde.de" },
        ],
      },
    });
    melde(p.ok, "pruefeElement nimmt den Block an" + (p.ok ? "" : " — " + p.grund));
    const z = p.ok ? JSON.parse(p.inhalt).zeilen : [];
    melde(z[0] && z[0].aufgabe === 12 && z[0].link === "/crm/firma/12", "behaelt aufgabe und eigenen Pfad /crm/firma/12");
    melde(z[1] && z[1].aufgabe === 34, "aufgabe als Text wird zur Zahl");
    melde(z[2] && !("aufgabe" in z[2]) && !("aufgabe" in z[3]) && !("aufgabe" in z[4]), "verwirft negative, unsinnige und 0 als aufgabe");
    melde(z[5] && !("link" in z[5]), "verwirft javascript:");
    melde(z[6] && !("link" in z[6]), "verwirft //protokoll-relativ");
    melde(z[7] && !("link" in z[7]), "verwirft den nackten Schraegstrich");
    melde(z[8] && z[8].link === "mailto:a@b.de" && z[9] && z[9].link === "https://kunde.de", "mailto und https bleiben");
    melde(p.ok && JSON.parse(p.inhalt).kategorie === "kunden", "Kategorie kunden bleibt");
  }

  // ------------------------------------------------ 2. Neuer Block auf Louis' Tafel
  const speicher = speicherImArbeitsspeicher();
  const aufgabe = { id: 101, titel: "Angebot nachfassen", firma_id: 7,
                    firma_name: "Testpraxis Sonnenhof", verantwortlich: LOUIS.id };
  const r1 = await bruecke.aufgabeAufTafel(LUKAS, aufgabe, { speicher });
  melde(r1.ok && r1.neu === true, "neuer Block auf Louis' Tafel: " + JSON.stringify(r1));
  let el = r1.ok ? await speicher.holen(LUKAS, r1.element) : null;
  melde(el && el.tafel === LOUIS.id && el.besitzer === LUKAS.id, "Block liegt auf Louis' Tafel, Autor Lukas (Fahne 'von Lukas')");
  melde(el && el.x === 130 && el.y === 100 && el.breite === 560 && el.hoehe === H1, `am festen Kunden-Platz (130/100), Breite 560, Hoehe ${H1}`);
  melde(el && el.inhalt.kategorie === "kunden" && el.inhalt.liste === "check" && el.inhalt.groesse === 28, "Kategorie kunden, Checkliste, Groesse 28");
  melde(el && el.inhalt.zeilen.length === 1
        && el.inhalt.zeilen[0].t === "Testpraxis Sonnenhof: Angebot nachfassen"
        && el.inhalt.zeilen[0].link === "/crm/firma/7"
        && el.inhalt.zeilen[0].aufgabe === 101
        && el.inhalt.zeilen[0].erledigt === false,
        "Zeile: '<Firma>: <Titel>', Link in die Akte, aufgabe = 101, offen");

  // ------------------------------------------------ 3. Weitere Aufgaben haengen sich an
  const r2 = await bruecke.aufgabeAufTafel(LUKAS, { id: 102, titel: "Rechnung schicken", firma_id: 7,
    firma_name: "Testpraxis Sonnenhof", verantwortlich: LOUIS.id }, { speicher });
  melde(r2.ok && r2.neu === false && r2.element === r1.element, "zweite Aufgabe haengt sich an denselben Block");
  el = await speicher.holen(LUKAS, r1.element);
  melde(el.inhalt.zeilen.length === 2 && el.inhalt.zeilen[1].aufgabe === 102 && el.version === 2, "Block hat zwei Zeilen, Version 2");
  melde(el.hoehe === H1 + 37 && el.y === 100, "Hoehe um eine Zeile (37) gewachsen, Lage unveraendert");
  // Louis selbst (Tafel-Besitzer) darf in Lukas' Block schreiben
  const r3 = await bruecke.aufgabeAufTafel(LOUIS, { id: 103, titel: "Anrufen", firma_id: 8,
    firma_name: "Bäckerei Huber", verantwortlich: LOUIS.id }, { speicher });
  melde(r3.ok && r3.element === r1.element, "Louis (Tafel-Besitzer) haengt in Lukas' Block an");

  // ------------------------------------------------ 4. Fremder Block ist tabu
  // Okan hat auf seiner Tafel einen EIGENEN Kunden-Block. Lukas ist dort weder
  // Autor noch Tafel-Besitzer -> er darf ihn nicht aendern -> neuer Block darunter.
  await speicher.anlegen(OKAN, block(OKAN.id, { x: 130, y: 100, hoehe: 300, kategorie: "kunden" }));
  const r4 = await bruecke.aufgabeAufTafel(LUKAS, { id: 104, titel: "Termin", firma_id: 9,
    firma_name: "Firma X", verantwortlich: OKAN.id }, { speicher });
  el = r4.ok ? await speicher.holen(LUKAS, r4.element) : null;
  melde(r4.ok && r4.neu && el && el.y === 100 + 300 + 60 && el.x === 130, "Okans eigener Block ist tabu: neuer Block darunter (y = 460)");

  // ------------------------------------------------ 5. Platzwahl und Hoehenschaetzung
  const platz = bruecke.platzFinden([
    { art: "text", x: 800, y: 100, breite: 400, hoehe: 300 },       // rechts daneben (800 >= 690): schiebt nicht
    { art: "notiz", x: 200, y: 300, breite: 320, hoehe: 240, inhalt: { kategorie: "intern" } }, // ueberdeckt: schiebt
    { art: "strich", x: 130, y: 900, breite: 600, hoehe: 200 },     // Striche zaehlen nicht
  ], H1);
  melde(platz.x === 130 && platz.y === 300 + 240 + 60, "Platzwahl: unter den ueberdeckenden Block (jede Kategorie); seitliche Bloecke und Striche schieben nicht");
  const geklemmt = bruecke.platzFinden([{ art: "text", x: 130, y: 1200, breite: 560, hoehe: 300 }], H1);
  melde(geklemmt.y === 1400 - H1, "Platzwahl klemmt an der Tafelkante (1400 - Hoehe)");
  const leer = bruecke.platzFinden([], H1);
  melde(leer.x === 130 && leer.y === 100, "leere Tafel: der Kunden-Platz selbst");
  melde(bruecke.reihen([{ t: "x".repeat(50) }], 560, 28) === 1 && bruecke.reihen([{ t: "x".repeat(51) }], 560, 28) === 2,
        "Hoehenschaetzung: 50 Zeichen je Reihe bei 560 px / Groesse 28");
  melde(bruecke.hoeheSchaetzen([{ t: "x".repeat(400) }], 560, 28) === 40 + 37 * 8, "400 Zeichen: 8 Reihen -> 336 px");
  melde(bruecke.hoeheSchaetzen([{ t: "kurz" }, { t: "" }, { t: "x".repeat(120) }], 560, 28) === 40 + 37 * 5, "drei Zeilen (1 + 1 + 3 Reihen): 225 px");
  melde(bruecke.hoeheSchaetzen(3) === 40 + 37 * 3, "Zahl statt Liste: so viele einzeilige Zeilen");

  // ------------------------------------------------ 6. 200-Zeilen-Grenze
  await speicher.anlegen(LUKAS, block(JANNIK.id, { x: 130, y: 100, hoehe: 7440, zeilen: 200, kategorie: "kunden" }));
  const r5 = await bruecke.aufgabeAufTafel(LUKAS, { id: 105, titel: "Noch eine", firma_id: 9,
    firma_name: "Firma X", verantwortlich: JANNIK.id }, { speicher });
  el = r5.ok ? await speicher.holen(LUKAS, r5.element) : null;
  melde(r5.ok && r5.neu && el && el.inhalt.zeilen.length === 1, "voller Block (200 Zeilen): neuer Block statt anhaengen");
  melde(el && el.y === 1400 - H1, "... geklemmt an die Tafelkante, weil der volle Block bis unten reicht");
  // 199 Zeilen: die 200. haengt sich noch an — ohne Verantwortlichen auf die eigene Tafel
  const fast = block(LUKAS.id, { x: 130, y: 100, hoehe: 100, zeilen: 199, kategorie: "kunden" });
  await speicher.anlegen(LUKAS, fast);
  const r6 = await bruecke.aufgabeAufTafel(LUKAS, { id: 106, titel: "Eigene", firma_id: 9, firma_name: "Firma X" }, { speicher });
  el = await speicher.holen(LUKAS, fast.id);
  melde(r6.ok && !r6.neu && r6.element === fast.id && el.inhalt.zeilen.length === 200,
        "199 Zeilen: die 200. haengt sich noch an; ohne Verantwortlichen = eigene Tafel");
  melde(el.hoehe === 40 + 37 * 200 && el.y === 0, "... Hoehe fuer 200 Zeilen geschaetzt, Block bis ganz nach oben gerueckt (y = 0)");

  // ------------------------------------------------ 7. Anhaengen an der Tafelkante: lange Zeile, Block rueckt hoch
  {
    const s7 = speicherImArbeitsspeicher();
    const unten = block(LOUIS.id, { x: 130, y: 1250, hoehe: 114, texte: ["eins", "zwei"], kategorie: "kunden" });
    await s7.anlegen(LUKAS, unten);
    const lang = await bruecke.aufgabeAufTafel(LUKAS, { id: 107, titel: "Ä".repeat(400), firma_id: 9,
      firma_name: "Firma X", verantwortlich: LOUIS.id }, { speicher: s7 });
    const e7 = await s7.holen(LUKAS, unten.id);
    const erwartet = 40 + 37 * (1 + 1 + 8);    // zwei kurze Zeilen + 400 Zeichen (8 Reihen)
    melde(lang.ok && !lang.neu && e7.hoehe === erwartet, `lange Zeile angehaengt: Hoehe ${e7.hoehe} (erwartet ${erwartet})`);
    melde(e7.y === 1400 - erwartet && e7.y + e7.hoehe <= 1400, `... Block nach oben gerueckt (y = ${e7.y}), unten bleibt <= 1400`);
    melde(e7.inhalt.zeilen[2].t.length === 400, "... Zeilentext auf 400 Zeichen gekuerzt");
  }

  // ------------------------------------------------ 8. Leerer Block wird gefuellt, nicht ergaenzt
  const leerer = { id: uuid(), tafel: IOANNIS.id, art: "text", x: 130, y: 100, breite: 560, hoehe: H1,
    inhalt: JSON.stringify({ liste: "check", farbe: "schwarz", groesse: 28, kategorie: "kunden",
                             zeilen: [{ t: "", erledigt: false, gestrichen: false }] }) };
  await speicher.anlegen(LUKAS, leerer);
  const r7 = await bruecke.aufgabeAufTafel(LUKAS, { id: 108, titel: "Erste", firma_id: 9,
    firma_name: "Firma X", verantwortlich: IOANNIS.id }, { speicher });
  el = await speicher.holen(LUKAS, leerer.id);
  melde(r7.ok && r7.element === leerer.id && el.inhalt.zeilen.length === 1 && el.inhalt.zeilen[0].aufgabe === 108,
        "leerer Kunden-Block: die Leerzeile wird ersetzt, nicht ergaenzt");

  // ------------------------------------------------ 9. Versionskonflikt: neu laden, wiederholen
  {
    const s2 = speicherImArbeitsspeicher();
    const b = block(LOUIS.id, { x: 130, y: 100, hoehe: H1, zeilen: 1, kategorie: "kunden" });
    await s2.anlegen(LUKAS, b);
    const echt = s2.gesperrt.bind(s2);
    let gestoert = 0;
    // Jemand tippt dazwischen: vor jedem der ersten zwei Schreibversuche der
    // Bruecke springt der Block auf eine neue Version.
    s2.gesperrt = (user, tafel, fn) => echt(user, tafel, async (t) => fn({
      ...t,
      aendern: async (arg) => {
        if (gestoert++ < 2) {
          const jetzt = await t.holen(arg.id);
          await t.aendern({ id: arg.id, version: jetzt.version, art: "text",
            inhalt: JSON.stringify({ ...jetzt.inhalt, zeilen: jetzt.inhalt.zeilen.concat([{ t: "dazwischen " + gestoert, erledigt: false, gestrichen: false }]) }) });
        }
        return t.aendern(arg);
      },
    }));
    const r8 = await bruecke.aufgabeAufTafel(LUKAS, { id: 109, titel: "Konflikt", firma_id: 9,
      firma_name: "Firma X", verantwortlich: LOUIS.id }, { speicher: s2 });
    const e8 = await s2.holen(LUKAS, b.id);
    melde(r8.ok && !r8.neu && e8.inhalt.zeilen.length === 4 && e8.inhalt.zeilen[3].aufgabe === 109 && gestoert === 3,
          `Versionskonflikt: zweimal neu geladen, im dritten Anlauf angehaengt (${e8.inhalt.zeilen.length} Zeilen, Version ${e8.version})`);
    // Wer OHNE Pause dazwischentippt, bekommt nach VERSUCHE Anlaeufen einen eigenen Block
    gestoert = -100;
    const r9 = await bruecke.aufgabeAufTafel(LUKAS, { id: 110, titel: "Dauerkonflikt", firma_id: 9,
      firma_name: "Firma X", verantwortlich: LOUIS.id }, { speicher: s2 });
    const e9 = r9.ok ? await s2.holen(LUKAS, r9.element) : null;
    melde(r9.ok && r9.neu && e9 && e9.inhalt.zeilen.length === 1 && e9.inhalt.zeilen[0].aufgabe === 110,
          `Dauerkonflikt: nach ${bruecke.VERSUCHE} Anlaeufen ein eigener Block`);
  }

  // ------------------------------------------------ 10. Gleichzeitig: die Sperre je Tafel
  {
    const s3 = speicherImArbeitsspeicher();
    const vier = await Promise.all([201, 202, 203, 204].map((id) =>
      bruecke.aufgabeAufTafel(LUKAS, aufgabeX(id, { verantwortlich: IOANNIS.id }), { speicher: s3 })));
    const bloecke = new Set(vier.map((r) => r.element));
    const e10 = await s3.holen(LUKAS, vier[0].element);
    melde(vier.every((r) => r.ok) && bloecke.size === 1 && e10.inhalt.zeilen.length === 4
          && [201, 202, 203, 204].every((id) => e10.inhalt.zeilen.some((z) => z.aufgabe === id)),
          `4 gleichzeitig auf leerer Tafel: ${bloecke.size} Block, ${e10.inhalt.zeilen.length} Zeilen`);
    melde(vier.filter((r) => r.neu).length === 1, "... genau eine hat den Block angelegt, drei haben angehaengt");
    // ... und dasselbe auf eine Tafel mit vorhandenem Block, gemischt mit Louis' Tafel
    const gemischt = await Promise.all([
      bruecke.aufgabeAufTafel(LUKAS, aufgabeX(205, { verantwortlich: IOANNIS.id }), { speicher: s3 }),
      bruecke.aufgabeAufTafel(LUKAS, aufgabeX(206, { verantwortlich: LOUIS.id }), { speicher: s3 }),
      bruecke.aufgabeAufTafel(LUKAS, aufgabeX(207, { verantwortlich: IOANNIS.id }), { speicher: s3 }),
      bruecke.aufgabeAufTafel(LUKAS, aufgabeX(208, { verantwortlich: LOUIS.id }), { speicher: s3 }),
    ]);
    const io = await s3.vonTafel(LUKAS, IOANNIS.id), lo = await s3.vonTafel(LUKAS, LOUIS.id);
    melde(gemischt.every((r) => r.ok) && io.length === 1 && io[0].inhalt.zeilen.length === 6 && lo.length === 1 && lo[0].inhalt.zeilen.length === 2,
          `gemischt auf zwei Tafeln: Ioannis 1 Block/${io[0] && io[0].inhalt.zeilen.length} Zeilen, Louis 1 Block/${lo[0] && lo[0].inhalt.zeilen.length} Zeilen`);
  }

  // ------------------------------------------------ 11. Haken Tafel -> Liste
  {
    const vorher = { zeilen: [
      { t: "a", erledigt: false, aufgabe: 1 }, { t: "b", erledigt: true, aufgabe: 2 },
      { t: "c", erledigt: false }, { t: "d", erledigt: false, aufgabe: 3 } ] };
    const nachher = { zeilen: [
      { t: "a", erledigt: true, aufgabe: 1 }, { t: "b", erledigt: true, aufgabe: 2 },
      { t: "c", erledigt: true }, { t: "e", erledigt: false, aufgabe: 4 } ] };
    const v = bruecke.zeilenVergleichen(vorher, nachher);
    melde(v.gewechselt.length === 1 && v.gewechselt[0].id === 1 && v.gewechselt[0].erledigt === true,
          "Tafel -> Liste: nur Zeile 1 hat den Haken gewechselt (Zeile ohne Bezug zaehlt nicht)");
    melde(v.neu.length === 1 && v.neu[0] === 4, "... Zeile 4 ist neu im Element (Bezug wird umgehaengt); die geloeschte Zeile 3 tut nichts");
    const geschrieben = [];
    await bruecke.zeilenAbgleichen(LOUIS, { element: r1.element, vorher, nachher },
      { schreiben: async (user, was) => geschrieben.push({ user: user.id, ...was }) });
    melde(geschrieben.length === 1 && geschrieben[0].user === LOUIS.id && geschrieben[0].element === r1.element
          && geschrieben[0].gewechselt.length === 1 && geschrieben[0].neu[0] === 4,
          "zeilenAbgleichen ruft den Schreiber als handelnde Person auf");
    const nichts = [];
    await bruecke.zeilenAbgleichen(LOUIS, { element: r1.element,
      vorher: { zeilen: [{ t: "x" }] }, nachher: { zeilen: [{ t: "y", erledigt: true }] } },
      { schreiben: async () => nichts.push(1) });
    melde(nichts.length === 0, "ohne Aufgaben-Zeilen wird gar nicht erst geschrieben");
    const ohneVorher = bruecke.zeilenVergleichen(null, nachher);
    melde(ohneVorher.gewechselt.length === 0 && ohneVorher.neu.length === 3, "ohne Vorher-Stand (anlegen): alles neu, nichts gewechselt");
    const kaputt = await bruecke.zeilenAbgleichen(LOUIS, { element: r1.element, vorher, nachher },
      { schreiben: async () => { throw new Error("Datenbank weg"); } });
    melde(kaputt.gewechselt.length === 1, "ein Fehler des Schreibers wird geloggt, nicht geworfen");
  }

  // ------------------------------------------------ 12. Nach Rueckgaengig: die Liste gilt
  {
    // Block E (Lukas auf Louis' Tafel): Zeilen 101 (offen), 102 (offen), 103 (offen).
    // Derweil wurde 101 in der Liste erledigt und 102 nie angefasst.
    await speicher.loeschen(LOUIS, [r1.element]);
    const zurueck = await speicher.wiederherstellen(LOUIS, [r1.element]);
    const gelesen = [];
    const n = await bruecke.elementeNachziehen(LOUIS, zurueck.ids, { speicher,
      aufgabenLesen: async (user, ids) => { gelesen.push(ids); return new Map([[101, true], [102, false]]); } });
    el = await speicher.holen(LOUIS, r1.element);
    melde(n === 1 && el.inhalt.zeilen[0].erledigt === true && el.inhalt.zeilen[1].erledigt === false && el.inhalt.zeilen[2].erledigt === false,
          "wiederhergestellter Block: Zeile 101 erledigt (aus der Liste), 102 offen, 103 (nicht lesbar) unberuehrt");
    melde(gelesen.length === 1 && gelesen[0].length === 3, "... die Liste wurde einmal fuer alle drei Bezuege gelesen");
    const n2 = await bruecke.elementeNachziehen(LOUIS, [r1.element], { speicher,
      aufgabenLesen: async () => new Map([[101, true]]) });
    melde(n2 === 0, "... steht schon so: nichts geschrieben");
    const n3 = await bruecke.elementeNachziehen(OKAN, [r1.element], { speicher,
      aufgabenLesen: async () => new Map([[101, false]]) });
    el = await speicher.holen(LOUIS, r1.element);
    melde(n3 === 0 && el.inhalt.zeilen[0].erledigt === true, "Okan (darf nicht aendern): nichts geschrieben");
    const n4 = await bruecke.elementeNachziehen(LOUIS, [uuid(), "kaputt"], { speicher, aufgabenLesen: async () => new Map() });
    melde(n4 === 0, "unbekannte ids: still");
  }

  // ------------------------------------------------ 13. Die Tafel darf scheitern, die Aufgabe nicht
  {
    const kaputt = { ...speicherImArbeitsspeicher(), gesperrt: async () => { throw new Error("Tafel unbekannt"); } };
    const r = await bruecke.aufgabeAufTafel(LUKAS, aufgabe, { speicher: kaputt });
    melde(!r.ok && /Tafel unbekannt/.test(r.grund), "Speicherfehler: {ok:false, grund}, kein Wurf");
    const r0 = await bruecke.aufgabeAufTafel(LUKAS, { titel: "ohne id", firma_id: 1 }, { speicher });
    melde(!r0.ok && r0.grund === "aufgabe", "ohne Aufgaben-id: abgelehnt");
    const zeile = bruecke.zeileFuer({ id: 5, titel: "  Nur Titel  " });
    melde(zeile.t === "Nur Titel" && !("link" in zeile) && zeile.aufgabe === 5, "Zeile ohne Firma: nur der Titel, kein Link");
  }

  // ------------------------------------------------ 14. Die fuenfte Kategorie: CRM
  //
  // Seit 08.09.2026 traegt aufgabeAufTafel eine Kategorie. Aufgaben aus einem
  // ANRUFERGEBNIS (lib/crm.js, aufgaben.anlass = 'anruf:*') gehen in den
  // CRM-Block, von Hand angelegte weiterhin in den Kunden-Block. Beide duerfen
  // sich NICHT vermischen: Sonst stuende die Zeile unter der falschen
  // Ueberschrift und bekaeme beim Ordnen den falschen Platz.
  {
    const sp = speicherImArbeitsspeicher();
    const crm1 = await bruecke.aufgabeAufTafel(LUKAS, aufgabeX(201, { titel: "Nochmal anrufen" }),
      { speicher: sp, kategorie: "crm" });
    let e = crm1.ok ? await sp.holen(LUKAS, crm1.element) : null;
    melde(crm1.ok && crm1.neu && e && e.inhalt.kategorie === "crm",
          "Anruf-Aufgabe: neuer Block mit Kategorie 'crm'");
    melde(e && e.x === 900 && e.y === 760, "... am CRM-Platz (Spalte 2, untere Reihe: 900/760)");

    // Eine Kunden-Aufgabe haengt sich NICHT an den CRM-Block, sondern legt
    // ihren eigenen am Kunden-Platz an.
    const kun = await bruecke.aufgabeAufTafel(LUKAS, aufgabeX(202, { titel: "Angebot schicken" }),
      { speicher: sp });
    e = kun.ok ? await sp.holen(LUKAS, kun.element) : null;
    melde(kun.ok && kun.neu && kun.element !== crm1.element && e && e.inhalt.kategorie === "kunden",
          "Kunden-Aufgabe haengt sich nicht an den CRM-Block");
    melde(e && e.x === 130 && e.y === 100, "... sondern legt einen eigenen am Kunden-Platz an");

    // Die zweite Anruf-Aufgabe haengt sich an den vorhandenen CRM-Block.
    const crm2 = await bruecke.aufgabeAufTafel(LUKAS, aufgabeX(203, { titel: "Nachfassen" }),
      { speicher: sp, kategorie: "crm" });
    melde(crm2.ok && !crm2.neu && crm2.element === crm1.element,
          "zweite Anruf-Aufgabe haengt sich an denselben CRM-Block");

    // Ein unbekannter Name faellt auf die Vorgabe zurueck, statt einen Block
    // ohne gueltige Kategorie anzulegen (pruefeElement wuerde ihn verwerfen).
    const sp2 = speicherImArbeitsspeicher();
    const wirr = await bruecke.aufgabeAufTafel(LUKAS, aufgabeX(204), { speicher: sp2, kategorie: "quatsch" });
    e = wirr.ok ? await sp2.holen(LUKAS, wirr.element) : null;
    melde(wirr.ok && e && e.inhalt.kategorie === "kunden", "unbekannte Kategorie -> Kunden-Block");

    // Der CRM-Block legt sich UNTER den Vertriebs-Block derselben Spalte,
    // statt ihn zu ueberdecken (Spalte 2 traegt Vertrieb oben und CRM unten).
    const sp3 = speicherImArbeitsspeicher();
    await sp3.anlegen(LUKAS, block(LUKAS.id, { x: 900, y: 100, hoehe: 800, kategorie: "vertrieb" }));
    const unten = await bruecke.aufgabeAufTafel(LUKAS, aufgabeX(205), { speicher: sp3, kategorie: "crm" });
    e = unten.ok ? await sp3.holen(LUKAS, unten.element) : null;
    melde(unten.ok && e && e.x === 900 && e.y === 100 + 800 + 60,
          "langer Vertriebs-Block schiebt den CRM-Block nach unten (y = 960)");
  }

  console.log(fehler ? `\n${fehler} Problem(e).` : "\nAlles gut.");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("FEHLER:", e); process.exit(1); });
