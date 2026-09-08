// lib/aufgaben-tafel.js — die Bruecke zwischen Aufgabenliste und Whiteboard.
//
// Wunsch von Lukas (05.09.2026): "Wenn man To-Dos eintraegt, innerhalb des
// CRMs bei den Kunden — beim Anlegen oder spaeter in der Akte — soll es
// automatisch aufs Whiteboard uebertragen werden, automatisch in die
// Kategorie Kunden. Man muss noch zuweisen, welche Person verantwortlich
// ist, weil sich danach entscheidet, in welches Whiteboard es reingeht."
//
// Was hier passiert, in drei Saetzen:
//   1. aufgabeAufTafel()     Eine Kunden-Aufgabe (firma_id gesetzt) wird als
//      Zeile "<Firma>: <Titel>" mit Link in die Akte in den Kategorie-Block
//      auf der Tafel des VERANTWORTLICHEN geschrieben — gibt es dort noch
//      keinen Block, den der Anleger beschreiben darf, entsteht einer am
//      festen Platz dieser Kategorie. Die Zeile traegt "aufgabe": aufgaben.id;
//      das ist der einzige Faden zwischen beiden Welten.
//      Welche Kategorie, sagt der Aufrufer (optionen.kategorie, Vorgabe
//      "kunden"). Seit 08.09.2026 schickt lib/crm.js Aufgaben aus einem
//      ANRUFERGEBNIS in den CRM-Block; von Hand angelegte bleiben bei Kunden.
//   2. zeilenAbgleichen()    Wer die Zeile AUF DER TAFEL abhakt, hakt die
//      Aufgabe in der Liste mit ab — die Whiteboard-Route vergleicht dafuer
//      den Stand vor und nach jedem Speichern.
//   3. elementeNachziehen()  Ein wiederhergestellter Block (Undo) bekommt
//      die Haken seiner Aufgaben-Zeilen aus der Liste — sie ist die Wahrheit.
//
// Den Weg Liste -> Tafel (Haken in der Liste, Zeile folgt) geht lib/crm.js
// ueber die Datenbankfunktion aufgabe_haken_auf_tafel() aus Migration 0058:
// Sie schreibt am RLS von whiteboard_elemente vorbei, weil die Zeile
// inzwischen in einem Block liegen kann, der dem Anleger nicht gehoert
// (Louis hat sie in seinen eigenen Block gezogen).
//
// Was hier NICHT passiert: Eine Tafelzeile wird nie zur Aufgabe, eine
// geloeschte Zeile loescht keine Aufgabe, eine geloeschte Aufgabe loescht
// keine Zeile. Die Tafel bleibt die freie Flaeche, die sie ist (0056).
//
// Die Tafel darf scheitern, die Aufgabe nicht: Jede Funktion hier faengt
// ihre Fehler, loggt den Grund und antwortet {ok:false, grund}. Der
// Aufrufer in lib/crm.js hat die Aufgabe da laengst gespeichert.
//
// Der Whiteboard-Speicher wird hereingereicht (optionen.speicher), damit
// scripts/test-aufgaben-tafel.js die Bruecke mit speicherImArbeitsspeicher()
// OHNE Datenbank durchspielen kann — dieselbe Regel wie bei der Probe.
// Ohne Angabe laeuft im Betrieb der Postgres-Speicher. Die Pruefung der
// Elemente (pruefeElement) kommt aus whiteboard-routes.js und wird erst beim
// Aufruf geladen: whiteboard-routes.js laedt dieses Modul beim Start, ein
// Gegen-require im Kopf gaebe eine halb gefuellte Exportliste.

const crypto = require("crypto");

// Die festen Kategorie-Plaetze auf der Tafel (2400 x 1400) — dieselben Zahlen
// wie platzVon(rang) im Client (public/lib/whiteboard.js: ORD_X, ORD_Y,
// ORD_LUFT). Wer sie dort aendert, aendert sie hier, sonst legt der Server
// den Block woandershin als der Client beim Ordnen.
//
// Seit 08.09.2026 sind es DREI Spalten und fuenf Plaetze (die fuenfte
// Kategorie "CRM" passte nicht mehr in das 2x2-Raster). Die Reihenfolge der
// Liste IST die Rangfolge, wie drueben:
//     1 Kunden   2 Vertrieb   3 Content     (obere Reihe,  y = 100)
//     4 Intern   5 CRM                      (untere Reihe, y = 760)
const TAFEL = { breite: 2400, hoehe: 1400 };
const ORD_X = [130, 900, 1670];
const ORD_Y = [100, 760];
const KATEGORIEN = ["kunden", "vertrieb", "content", "intern", "crm"];
const KATEGORIE_VORGABE = "kunden";
// Der Platz einer Kategorie. Unbekannter Name -> der Kunden-Platz; so legt
// ein Aufrufer mit Tippfehler den Block wenigstens dorthin, wo bisher alles
// hinkam, statt auf x=undefined.
function platzVon(kategorie) {
  const rang = KATEGORIEN.indexOf(String(kategorie || KATEGORIE_VORGABE));
  const r = rang < 0 ? 0 : rang;
  return { x: ORD_X[r % ORD_X.length], y: ORD_Y[r < ORD_X.length ? 0 : 1] };
}
// Bleibt als Name erhalten, weil die Tests und die Kommentare ihn kennen:
// der Kunden-Platz ist der Platz der Vorgabe-Kategorie.
const PLATZ = platzVon(KATEGORIE_VORGABE);
const LUFT = 60;
const BLOCK_BREITE = 560;
const SCHRIFT = 28;
// Hoehe schaetzen: ein Textblock misst im Browser rund 40 px Rand plus 37 px
// je DARGESTELLTER Zeile — und eine lange Zeile bricht um. Gemessen am
// 05.09.2026: In einen 560 px breiten Block passen bei Schriftgroesse 28
// rund 47 Zeichen gewoehnlichen Textes in eine Reihe (die Tafelschrift ist
// schmal); breite Glyphen (lauter Grossbuchstaben, Umlaute) brauchen mehr
// Platz. Daraus der Faktor 0,40 je Zeichen: 50 Zeichen je Reihe bei 560/28.
// Die Schaetzung darf grosszuegig sein — der Client misst spaeter nach; sie
// muss nur verhindern, dass ein neuer oder gewachsener Block unten aus der
// Tafel faellt (dann klemmen wir ihn hoch) oder auf einem alten liegt.
const ZEILE_HOEHE = 37;
const BLOCK_RAND = 40;
const ZEICHEN_BREITE_PROZENT = 40;   // 0,40 der Schriftgroesse je Zeichen — als ganze Zahl, siehe unten
const ZEILEN_MAX = 200;   // GRENZEN.zeilen in whiteboard-routes.js
const ZEICHEN_MAX = 400;  // GRENZEN.zeichenJeZeile — laenger wird keine Zeile, die Schaetzung rechnet damit
const VERSUCHE = 4;       // Anlaeufe bei Versionskonflikten, bevor ein neuer Block entsteht

// Ganzzahlig gerechnet: 28 * 0.40 ist in Fliesskommazahlen 11.200000000000001,
// und 560 / 11.200000000000001 faellt unter 50 — floor() machte daraus 49.
const zeichenJeReihe = (breite, groesse) =>
  Math.max(8, Math.floor(((Number(breite) || BLOCK_BREITE) * 100)
                         / ((Number(groesse) || SCHRIFT) * ZEICHEN_BREITE_PROZENT)));
// Dargestellte Reihen einer Zeilenliste (Zahl = so viele einzeilige Zeilen).
function reihen(zeilen, breite, groesse) {
  if (typeof zeilen === "number") return Math.max(1, zeilen);
  const je = zeichenJeReihe(breite, groesse);
  let n = 0;
  for (const z of zeilen) n += Math.max(1, Math.ceil(Math.min(ZEICHEN_MAX, String((z && z.t) || "").length) / je));
  return Math.max(1, n);
}
const hoeheSchaetzen = (zeilen, breite, groesse) => BLOCK_RAND + ZEILE_HOEHE * reihen(zeilen, breite, groesse);
// Nie unter die Tafelkante: ein Block, der unten hinausragte, rueckt hoch.
const yKlemmen = (y, hoehe) => Math.round(Math.max(0, Math.min(Number(y) || 0, TAFEL.hoehe - hoehe)));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pruefer = () => require("./whiteboard-routes.js").pruefeElement;
const standardSpeicher = () => require("./whiteboard-speicher.js").pgSpeicher();
const kurz = (s) => String(s && s.message ? s.message : s).slice(0, 160);

// Die Tafelzeile zu einer Aufgabe. "<Firma>: <Titel>" — die Firma zuerst,
// weil der Block "Kunden" heisst und man ihn nach Kunden ueberfliegt. Der
// Link fuehrt in die Akte; "aufgabe" ist der Faden zurueck in die Liste.
function zeileFuer(aufgabe) {
  const firma = String(aufgabe.firma_name || "").trim();
  const titel = String(aufgabe.titel || "").trim();
  const zeile = {
    // Gleich auf die Zeilengrenze gekuerzt — pruefeElement taete es sonst,
    // aber die Hoehenschaetzung soll denselben Text sehen wie die Tafel.
    t: (firma ? `${firma}: ${titel}` : titel).slice(0, ZEICHEN_MAX),
    erledigt: !!aufgabe.erledigt,
    gestrichen: false,
    aufgabe: Number(aufgabe.id),
  };
  if (Number(aufgabe.firma_id) > 0) zeile.link = `/crm/firma/${Number(aufgabe.firma_id)}`;
  return zeile;
}

const zeilenVon = (el) => (el && el.inhalt && Array.isArray(el.inhalt.zeilen)) ? el.inhalt.zeilen : [];
const istLeer = (el) => zeilenVon(el).every((z) => !String(z.t || "").trim());

// In welchen Block auf der Tafel? Den JUENGSTEN lebenden Textblock DIESER
// KATEGORIE, den der Anleger aendern darf (Autor oder Tafel-Besitzer —
// dieselbe Regel wie im Speicher und in der RLS) und der noch Platz hat.
// Haftnotizen nie: sie sind Gegenstaende, keine Listen (siehe
// zusammenfuehrZiel im Client).
//
// Die Kategorie ist seit 08.09.2026 beweglich: Eine Aufgabe aus dem
// Anrufergebnis gehoert nach "crm", eine von Hand an einer Firma angelegte
// weiterhin nach "kunden". Ein CRM-Eintrag darf sich also NICHT an einen
// Kunden-Block haengen und umgekehrt — sonst stuende die Zeile unter der
// falschen Ueberschrift und bekaeme beim Ordnen den falschen Platz.
function zielBlock(elemente, user, kategorie = KATEGORIE_VORGABE) {
  let bester = null;
  for (const el of elemente) {
    if (el.art !== "text" || !el.inhalt || el.inhalt.kategorie !== kategorie) continue;
    if (el.besitzer !== user.id && el.tafel !== user.id) continue;
    if (zeilenVon(el).length >= ZEILEN_MAX) continue;
    if (!bester || new Date(el.erstellt) > new Date(bester.erstellt)) bester = el;
  }
  return bester;
}

// Wohin mit einem neuen Block? Auf den Platz SEINER KATEGORIE — und wenn
// dort schon etwas liegt (gleich welcher Kategorie), darunter: unter den
// untersten Block, der die Spalte des neuen Blocks waagrecht ueberdeckt, mit
// LUFT Abstand. Was seitlich daneben steht, schiebt nicht. Striche zaehlen
// nicht (wie blockAufPlatz im Client). Und nie unten aus der Tafel hinaus:
// liegt die Spalte voll, wird geklemmt — ueberlappen ist dann das kleinere
// Uebel als ein Block, den niemand mehr sieht.
//
// Gesucht wird ab dem Platz der Kategorie NACH UNTEN. Ein CRM-Block (Spalte
// 2, untere Reihe) laesst den Vertriebs-Block darueber also stehen und legt
// sich darunter, statt ihn zu ueberdecken.
function platzFinden(elemente, hoehe, breite = BLOCK_BREITE, kategorie = KATEGORIE_VORGABE) {
  const platz = platzVon(kategorie);
  const links = platz.x, rechts = platz.x + breite;
  let y = platz.y;
  for (const el of elemente) {
    if (el.art === "strich") continue;
    const elRechts = Number(el.x) + Number(el.breite || 0);
    if (elRechts <= links || Number(el.x) >= rechts) continue;
    y = Math.max(y, Number(el.y) + Number(el.hoehe || 60) + LUFT);
  }
  return { x: platz.x, y: yKlemmen(y, hoehe) };
}

// ------------------------------------------------- 1. Aufgabe -> Tafel
//
// aufgabe: {id, titel, firma_id, firma_name, verantwortlich, erledigt}
// optionen.kategorie: In welchen Kategorie-Block die Zeile gehoert. Vorgabe
//   "kunden" — so bleibt alles von Hand Angelegte, wo es war. lib/crm.js
//   reicht "crm" durch, wenn die Aufgabe aus einem ANRUFERGEBNIS stammt
//   (aufgaben.anlass beginnt mit "anruf:", Migration 0066). Ein unbekannter
//   Name faellt auf die Vorgabe zurueck.
// Rueckgabe: {ok:true, element, neu, version} | {ok:false, grund}
//
// Alles laeuft in EINER gesperrten Transaktion je Tafel (speicher.gesperrt):
// Block suchen, anhaengen — oder neu anlegen. Zwei Aufgaben, die im selben
// Augenblick fuer dieselbe Person angelegt werden, kommen so nacheinander
// dran; die zweite sieht den Block der ersten. Ohne die Sperre gab es vier
// Bloecke fuer vier gleichzeitige Aufgaben (Pruefung vom 05.09.2026).
async function aufgabeAufTafel(user, aufgabe, { speicher, kategorie } = {}) {
  try {
    if (!user || !user.id) return { ok: false, grund: "nutzer" };
    if (!aufgabe || !(Number(aufgabe.id) > 0)) return { ok: false, grund: "aufgabe" };
    const kat = KATEGORIEN.includes(String(kategorie)) ? String(kategorie) : KATEGORIE_VORGABE;
    const tafel = UUID.test(String(aufgabe.verantwortlich || "")) ? String(aufgabe.verantwortlich) : user.id;
    const s = speicher || standardSpeicher();
    const pruefeElement = pruefer();
    const zeile = zeileFuer(aufgabe);

    return await s.gesperrt(user, tafel, async (t) => {
      // ---- Anhaengen an den bestehenden Block dieser Kategorie — bei einem
      // Versionskonflikt (jemand tippt gerade darin) mit frischem Stand noch
      // einmal, bis zu VERSUCHE mal; der Block wird jedes Mal neu gesucht.
      for (let versuch = 0; versuch < VERSUCHE; versuch++) {
        const elemente = await t.vonTafel(tafel);
        const ziel = zielBlock(elemente, user, kat);
        if (!ziel) return neuAnlegen(t, tafel, zeile, elemente, pruefeElement, kat);
        // Ein Block, in dem nur Leerzeilen stehen, ist ein leeres Blatt: die
        // Aufgabe ersetzt die Leerzeilen, statt unter ihnen zu haengen.
        const bisher = istLeer(ziel) ? [] : zeilenVon(ziel);
        const zeilen = bisher.concat([zeile]);
        const breite = Number(ziel.breite) || BLOCK_BREITE;
        const groesse = Number(ziel.inhalt.groesse) || SCHRIFT;
        // Nie kleiner als das, was der Client gemessen hat, plus die neue
        // Zeile — und nie kleiner als die Schaetzung fuer alle Zeilen.
        const hoehe = Math.max(hoeheSchaetzen(zeilen, breite, groesse),
          (Number(ziel.hoehe) || 0) + hoeheSchaetzen([zeile], breite, groesse) - BLOCK_RAND);
        const y = yKlemmen(ziel.y, hoehe);
        const p = pruefeElement({ art: "text", y, hoehe, inhalt: { ...ziel.inhalt, zeilen } });
        if (!p.ok) return { ok: false, grund: "pruefung:" + p.grund };
        const r = await t.aendern({ id: ziel.id, version: ziel.version, art: "text",
                                    y: p.y, hoehe: p.hoehe, inhalt: p.inhalt });
        if (r.ok) return { ok: true, element: ziel.id, neu: false, version: r.version };
        if (r.grund !== "veraltet") return neuAnlegen(t, tafel, zeile, await t.vonTafel(tafel), pruefeElement, kat);
      }
      // Nach VERSUCHE Konflikten hintereinander: lieber ein eigener Block als
      // endlos gegen einen Block anrennen, in dem jemand ohne Pause tippt.
      return neuAnlegen(t, tafel, zeile, await t.vonTafel(tafel), pruefeElement, kat);
    });
  } catch (fehler) {
    console.error("Aufgabe aufs Whiteboard:", kurz(fehler));
    return { ok: false, grund: kurz(fehler) };
  }
}

// Neuer Block am Platz seiner Kategorie (bzw. darunter). besitzer setzt der
// Speicher auf den Anleger; auf einer fremden Tafel zeigt der Client dann die
// Fahne "von X".
async function neuAnlegen(t, tafel, zeile, elemente, pruefeElement, kategorie = KATEGORIE_VORGABE) {
  const hoehe = hoeheSchaetzen([zeile], BLOCK_BREITE, SCHRIFT);
  const lage = platzFinden(elemente, hoehe, BLOCK_BREITE, kategorie);
  const p = pruefeElement({
    art: "text", x: lage.x, y: lage.y, breite: BLOCK_BREITE, hoehe,
    inhalt: { liste: "check", farbe: "schwarz", groesse: SCHRIFT, kategorie, zeilen: [zeile] },
  });
  if (!p.ok) return { ok: false, grund: "pruefung:" + p.grund };
  const id = crypto.randomUUID();
  await t.anlegen({ id, tafel, art: "text", x: p.x, y: p.y, breite: p.breite, hoehe: p.hoehe, inhalt: p.inhalt });
  return { ok: true, element: id, neu: true, version: 1 };
}

// ------------------------------------------------- 2. Tafel -> Liste (Haken)
//
// Reine Rechnerei, ohne Datenbank: Welche Aufgaben-Zeilen haben zwischen
// vorher und nachher den Haken gewechselt (gewechselt), und welche sind in
// diesem Element neu aufgetaucht (neu — eine abgegebene Zeile wandert mit
// ihrer Aufgabe in einen anderen Block, die Aufgabe soll ihn dann kennen)?
function zeilenVergleichen(vorher, nachher) {
  const alt = new Map();
  for (const z of (vorher && Array.isArray(vorher.zeilen)) ? vorher.zeilen : []) {
    const id = Number(z && z.aufgabe);
    if (id > 0) alt.set(id, !!z.erledigt);
  }
  const gewechselt = [], neu = [];
  for (const z of (nachher && Array.isArray(nachher.zeilen)) ? nachher.zeilen : []) {
    const id = Number(z && z.aufgabe);
    if (!(id > 0)) continue;
    if (!alt.has(id)) { neu.push(id); continue; }
    if (alt.get(id) !== !!z.erledigt) gewechselt.push({ id, erledigt: !!z.erledigt });
  }
  return { gewechselt, neu };
}

// Der Schreiber im Betrieb: als handelnde Person, mit RLS. Wer weder
// Besitzer noch Verantwortlicher ist, trifft 0 Zeilen — still, wie gewollt.
// Bewusst NICHT ueber crm.todoErledigt(): das wuerde den Haken gleich wieder
// auf die Tafel zurueckschreiben, die Version des Elements erhoehen und dem
// Browser, der gerade gespeichert hat, beim naechsten Tastendruck ein
// "veraltet" einhandeln.
async function aufgabenSchreiben(user, { element, gewechselt, neu }) {
  const crm = require("./crm.js");
  await crm.alsNutzer(user.id, async (q) => {
    for (const g of gewechselt) {
      await q(`update aufgaben set erledigt = $2 where id = $1 and erledigt is distinct from $2`,
              [g.id, g.erledigt]);
    }
    if (neu.length && UUID.test(String(element || ""))) {
      await q(`update aufgaben
                  set tafel_element = $2, tafel_gesetzt = coalesce(tafel_gesetzt, now())
                where id = any($1::bigint[]) and tafel_element is distinct from $2`,
              [neu, String(element)]);
    }
  });
}

// Nach einem erfolgreichen Speichern aus dem Browser aufrufen. Schreibt nur,
// wenn es etwas zu schreiben gibt — ein gewoehnlicher Block ohne
// Aufgaben-Zeilen kostet hier keine einzige Abfrage. Wirft nie.
async function zeilenAbgleichen(user, { element, vorher, nachher }, { schreiben } = {}) {
  const ergebnis = zeilenVergleichen(vorher, nachher);
  if (!ergebnis.gewechselt.length && !ergebnis.neu.length) return ergebnis;
  try {
    await (schreiben || aufgabenSchreiben)(user, { element, ...ergebnis });
  } catch (fehler) {
    console.error("Whiteboard → Aufgabenliste:", kurz(fehler));
  }
  return ergebnis;
}

// ------------------------------------------------- 3. Wiederhergestellt -> Liste gilt
//
// Ein Block war gewischt, die Aufgabe wurde derweil in der Liste abgehakt
// (die Zeile war nicht erreichbar, der Bezug blieb). Kommt der Block per
// Rueckgaengig zurueck, traegt er den alten Haken — falsch. Also nach dem
// Wiederherstellen die Aufgaben-Zeilen aus der Liste nachziehen: sie ist die
// Wahrheit. Gelesen wird mit RLS (nur Aufgaben, die man sehen darf); der
// Schreiber ist der, der wiederhergestellt hat — Autor oder Tafel-Besitzer,
// er darf also aendern. Liefert die Zahl der nachgezogenen Elemente.
async function aufgabenStandLesen(user, ids) {
  const crm = require("./crm.js");
  const { rows } = await crm.alsNutzer(user.id, (q) =>
    q(`select id, erledigt from aufgaben where id = any($1::bigint[])`, [ids]));
  return new Map(rows.map((r) => [Number(r.id), !!r.erledigt]));
}

async function elementeNachziehen(user, ids, { speicher, aufgabenLesen } = {}) {
  const s = speicher || standardSpeicher();
  const lesen = aufgabenLesen || aufgabenStandLesen;
  let n = 0;
  for (const id of Array.isArray(ids) ? ids : []) {
    try {
      const el = await s.holen(user, String(id));
      if (!el || el.geloescht || el.art === "strich") continue;
      const zeilen = zeilenVon(el);
      const bezuege = [...new Set(zeilen.map((z) => Number(z && z.aufgabe)).filter((x) => x > 0))];
      if (!bezuege.length) continue;
      const stand = await lesen(user, bezuege);
      let geaendert = false;
      const neu = zeilen.map((z) => {
        const a = Number(z && z.aufgabe);
        if (!(a > 0) || !stand.has(a) || !!z.erledigt === stand.get(a)) return z;
        geaendert = true;
        return { ...z, erledigt: stand.get(a) };
      });
      if (!geaendert) continue;
      const p = pruefer()({ art: el.art, inhalt: { ...el.inhalt, zeilen: neu } });
      if (!p.ok) continue;
      const r = await s.aendern(user, { id: el.id, version: el.version, art: el.art, inhalt: p.inhalt });
      if (r.ok) n++;
    } catch (fehler) {
      console.error("Wiederherstellen → Aufgaben-Haken:", kurz(fehler));
    }
  }
  return n;
}

module.exports = {
  aufgabeAufTafel, zeilenAbgleichen, elementeNachziehen,
  // fuer den Test
  zeileFuer, zielBlock, platzFinden, zeilenVergleichen, hoeheSchaetzen, reihen, yKlemmen,
  PLATZ, LUFT, BLOCK_BREITE, ZEILEN_MAX, TAFEL, VERSUCHE,
  platzVon, KATEGORIEN, KATEGORIE_VORGABE, ORD_X, ORD_Y,
};
