// lib/zufluss-sprache.js — aus dem GESPROCHENEN Gespraech wird Gedaechtnis.
//
// Warum es diese Datei gibt (Lukas, 07.08.2026): "Mit dem Gedaechtnis ist es
// wirklich wichtig, dass der nicht so dumm wird. Alexandra soll immer besser
// verstehen, wie ich rede, was sie von mir will und wie unser Unternehmen
// tickt."
//
// Das Telegram-Gespraech wird seit dem 22.07. verdichtet (zufluss-telegram.js).
// Das GESPROCHENE lief bisher an allem vorbei: Das Sprachlog war reine
// Technik-Diagnose — Dauern, Fehler, Modellnamen — und wurde von der Chronik
// nie gelesen. Genau deshalb begann jedes Gespraech bei null.
//
// ZWEI ERGEBNISSE, und das zweite ist der eigentliche Punkt:
//
//   1. ERKENNTNISSE (wie bei Telegram): Entscheidungen, Fakten, Aufgaben,
//      Ideen -> eingang/erkenntnisse/. Findet gehirn.js beim Nachfragen wieder.
//
//   2. ZUSAMMENARBEIT: Was Alexandra ueber Lukas und ueber sich selbst gelernt
//      hat — wie er redet, was er nicht hoeren will, wo sie danebenlag. Das
//      landet in EINER fortgeschriebenen Datei, die bei JEDER Frage im STAND
//      mitgeht. Hier passiert das Lernen: Ein Rohprotokoll sammelt nur,
//      erst diese Schicht macht daraus besseres Verhalten.
//
// WAS AUFGEZEICHNET WIRD: nur, was Lukas Alexandra tatsaechlich gesagt hat —
// das Sprachlog entsteht ausschliesslich beim Sprechen mit ihr. Es gibt keinen
// Mitschnitt "nebenbei" (Entscheidung Lukas, 07.08.).
//
// MODELL: die guenstige Spur (Haiku). Das ist Extraktionsarbeit, keine
// Denkarbeit, und laeuft taeglich — dieselbe Vorgabe wie bei Telegram.

const fs = require("fs");
const path = require("path");
const vault = require("./vault.js");
const schnell = require("./schnell.js");

const DATA = process.env.DATA_PATH || "/data";
const LOG = path.join(DATA, "sprachlog");
const ZIEL = (process.env.SPRACHE_ERKENNTNISSE || "eingang/erkenntnisse").replace(/^\/+|\/+$/g, "");
const LERN_DATEI = (process.env.SPRACHE_LERNDATEI || "eingang/zusammenarbeit.md").replace(/^\/+|\/+$/g, "");
const BEREICH = ZIEL.split("/")[0];
const MODELL = process.env.SCHNELL_ACK_MODEL || "claude-haiku-4-5";
const MAX_ZEICHEN = Number(process.env.SPRACHE_VERDICHTUNG_MAX || 12000);
// Mehr als das traegt der STAND nicht — er geht bei JEDER Frage mit.
const LERN_MAX_ZEILEN = Number(process.env.SPRACHE_LERN_ZEILEN || 25);

const berlinDatum = (ts) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ts));

function verfuegbar() {
  return schnell.verfuegbar() ||
    Boolean(process.env.SCHNELL_CHAT_URL || process.env.HERMES_CHAT_URL);
}

// --- Das Sprachlog in ein lesbares Gespraech zurueckverwandeln --------------
//
// Im Protokoll steht je Frage ein Eintrag mit dem Gesagten, dazu getrennte
// Eintraege fuer Werkzeug-Antworten. Fuers Verdichten zaehlt beides: Was Lukas
// gefragt hat UND was er als Antwort bekam — sonst steht spaeter "hat nach
// Umsatz gefragt" da, ohne die Zahl.
function gespraechAus(datum) {
  const datei = path.join(LOG, datum + ".jsonl");
  if (!fs.existsSync(datei)) return [];
  const raus = [];
  for (const zeile of fs.readFileSync(datei, "utf-8").trim().split("\n")) {
    let e; try { e = JSON.parse(zeile); } catch { continue; }
    if (!e) continue;
    const uhr = new Date(e.zeit).toLocaleTimeString("de-DE",
      { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
    if (e.art === "frage" && e.frage) {
      // Rauschen der Spracherkennung ueberspringen: "[Stille]", "[Geraeusch]",
      // "[klicken]" sind keine Aeusserungen, sondern was das Mikro aufschnappte.
      if (/^\s*\[[^\]]{0,30}\]\s*$/.test(e.frage)) continue;
      raus.push({ wer: "Lukas", zeit: uhr, text: e.frage });
      if (e.gesagt) raus.push({ wer: "Alexandra", zeit: uhr, text: e.gesagt });
    }
    if (e.art === "auftrag" && e.antwort) {
      raus.push({ wer: "Alexandra", zeit: uhr, text: e.antwort });
    }
  }
  return raus;
}

// --- Verdichtung 1: dauerhaftes Wissen -------------------------------------
// Wortgleich streng wie bei Telegram: NUR die vier Rubriken. Ohne diese Haerte
// liefert jedes Modell eine "Zusammenfassung des Gespraechs" — und die ist im
// Gedaechtnis Muell, weil sie den Verlauf nacherzaehlt statt etwas festzuhalten.
const SYSTEM_WISSEN =
  "Du destillierst ein gesprochenes Gespraech zwischen Lukas (Geschaeftsfuehrer) und " +
  "seiner Assistentin Alexandra zu dauerhaftem Firmenwissen. Gib AUSSCHLIESSLICH " +
  "Zeilen in genau diesem Format aus, eine Erkenntnis je Zeile:\n" +
  "Entscheidung: <was festgelegt wurde>\n" +
  "Fakt: <eine dauerhaft gueltige Information zu Firma, Kunden, Preisen, Technik, Zahlen>\n" +
  "Aufgabe: <was zu tun ist, wenn genannt mit Verantwortlichem und Frist>\n" +
  "Idee: <ein Vorhaben oder Vorschlag fuer spaeter>\n" +
  "VERBOTEN: Begruessungen, Verabschiedungen, Dank, Geplauder, Rueckfragen, Meta-Saetze " +
  "ueber das Gespraech, und JEDE Zusammenfassung des Verlaufs. Ebenfalls weglassen: " +
  "was Alexandra nur aus Kalender, CRM oder Wetter vorgelesen hat — das steht schon " +
  "in den Systemen und aendert sich taeglich. " +
  "Jede Zeile muss in einem Jahr ohne das Gespraech verstaendlich sein: Namen und " +
  "Zahlen ausschreiben, keine Pronomen wie 'das', 'er', 'dort'. Hoechstens 12 Zeilen, " +
  "das Wichtigste zuerst. Steht nichts Nennenswertes darin, antworte mit genau: NICHTS";

// --- Verdichtung 2: die Zusammenarbeit (das Self-Healing) ------------------
//
// Der Unterschied zur ersten: Hier geht es nicht um die Firma, sondern um das
// VERHAELTNIS. Was hat Lukas korrigiert? Wie nennt er Dinge? Was hat ihn
// geaergert? Das ist es, was eine Assistentin von einem Auskunftsschalter
// unterscheidet — und es steht in keinem CRM.
const SYSTEM_LERNEN =
  "Du bist Alexandra und siehst dein eigenes Gespraech mit Lukas von heute durch. " +
  "Halte fest, was du fuer die ZUSAMMENARBEIT gelernt hast — nicht, was inhaltlich " +
  "besprochen wurde. Gib AUSSCHLIESSLICH Zeilen in diesem Format aus:\n" +
  "Sprache: <wie Lukas etwas nennt oder formuliert, das du kennen musst>\n" +
  "Wunsch: <wie er etwas haben will — Laenge, Ton, Reihenfolge, was er nicht hoeren will>\n" +
  "Fehler: <wo du danebenlagst und was stattdessen richtig gewesen waere>\n" +
  "Firma: <wie das Unternehmen tickt: Ablaeufe, Rollen, was hier ueblich ist>\n" +
  "Jede Zeile ist eine Anweisung an dich selbst fuer kuenftige Gespraeche, in EINEM " +
  "Satz, ohne Datum und ohne Bezug auf 'heute'. Beispiel: " +
  "'Fehler: Ich habe Zahlen aus einer Abfrage addiert statt sie zu uebernehmen — Zahlen " +
  "nie selbst ausrechnen.' " +
  "VERBOTEN: Inhalte (Umsatzzahlen, Termine, Kundennamen), Lob fuer dich selbst, " +
  "Allgemeinplaetze wie 'freundlich bleiben', und alles, was schon in der Liste UNTEN " +
  "steht. " +
  // DER ZAUN UM DEN CHARAKTER (07.08.2026). Lukas hat den Charakter bewusst
  // festgelegt und will ihn STABIL. Diese Liste waechst taeglich und steht im
  // STAND ueber allem — ohne diese Sperre wuerde sie ihn Zeile fuer Zeile
  // umschreiben. Eine einzige Ermahnung "sei kuerzer und sachlicher" nach einem
  // hektischen Tag, und in vier Wochen ist die Schlagfertigkeit weg, ohne dass
  // jemand eine Entscheidung getroffen haette. Wer den Charakter aendern will,
  // aendert STIMME-alexandra.md — nicht das Gedaechtnis.
  "STRENG VERBOTEN ist alles, was deinen CHARAKTER betrifft: Humor, Schlagfertigkeit, " +
  "Direktheit, Anrede, wie viel du von dir aus sagst, ob du eine Meinung hast. Das " +
  "steht in deiner STIMME-Datei, ist bewusst so entschieden und wird NICHT gelernt. " +
  "Halte nur fest, was du FACHLICH oder SPRACHLICH dazugelernt hast. " +
  "Hoechstens 4 Zeilen — lieber keine als eine belanglose. " +
  "Gibt es nichts Neues zu lernen, antworte mit genau: NICHTS";

const RUBRIKEN = [["entscheidung", "Entscheidungen"], ["fakt", "Fakten"],
  ["aufgabe", "Aufgaben"], ["idee", "Ideen"]];
const LERN_RUBRIKEN = ["sprache", "wunsch", "fehler", "firma"];

function zeilenAus(rohAntwort, erlaubt, grenze = 12) {
  const treffer = [];
  const gesehen = new Set();
  let rubrik = null;
  const muster = new RegExp("^[-*•\\s]*(" + erlaubt.join("|") + ")(?:e?n)?\\s*:?\\s*$", "i");
  const mitText = new RegExp("^[-*•\\d.)\\s>]*(" + erlaubt.join("|") + ")(?:e?n)?\\s*[:\\-–]\\s*(.+)$", "i");
  for (const zeile0 of String(rohAntwort || "").split("\n")) {
    const zeile = zeile0.replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (!zeile) continue;
    const kopf = zeile.match(muster);
    if (kopf) { rubrik = kopf[1].toLowerCase(); continue; }
    const m = zeile.match(mitText);
    let art = null, text = null;
    if (m) { art = m[1].toLowerCase(); text = m[2]; }
    else if (rubrik && /^[-*•]\s+/.test(zeile)) { art = rubrik; text = zeile.replace(/^[-*•]\s+/, ""); }
    if (!art) continue;
    text = text.replace(/\s+/g, " ").replace(/^["'„»]+|["'“«]+$/g, "").trim();
    if (text.length < 8 || /^nichts\b/i.test(text)) continue;
    const s = art + "|" + text.toLowerCase();
    if (gesehen.has(s)) continue;
    gesehen.add(s);
    treffer.push({ art, text });
    if (treffer.length >= grenze) break;
  }
  return treffer;
}

function kopfWissen(datum) {
  const lang = new Date(datum + "T12:00:00").toLocaleDateString("de-DE",
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
  return `---\ntyp: erkenntnisse\nquelle: sprache\ndatum: ${datum}\n---\n\n` +
    `# Erkenntnisse · ${lang}\n\n` +
    "> Aus dem gesprochenen Gespräch verdichtet — nur Entscheidungen, Fakten, Aufgaben, Ideen.\n\n";
}

// --- Die Lerndatei fortschreiben -------------------------------------------
//
// EINE Datei, die waechst und gedeckelt ist. Sie geht bei jeder Frage in den
// STAND — waere sie unbegrenzt, wuerde sie den Prompt auffressen und Alexandra
// wuerde vor lauter Merksaetzen die Frage nicht mehr sehen.
//
// Neues kommt nach OBEN: Was zuletzt gelernt wurde, ist am ehesten noch gueltig.
// Faellt unten etwas heraus, war es lange nicht mehr bestaetigt worden.
function lernenSchreiben(neu) {
  const alt = vault.lesen(LERN_DATEI) || "";
  const altZeilen = alt.split("\n")
    .filter((z) => /^- /.test(z.trim()))
    .map((z) => z.trim());
  const neuZeilen = neu.map((f) => `- ${f.art.charAt(0).toUpperCase() + f.art.slice(1)}: ${f.text}`);
  // Doppeltes raus — das Modell schlaegt Bekanntes gern erneut vor.
  const kennen = new Set(altZeilen.map((z) => z.toLowerCase().replace(/\s+/g, " ")));
  const wirklichNeu = neuZeilen.filter((z) => !kennen.has(z.toLowerCase().replace(/\s+/g, " ")));
  if (!wirklichNeu.length) return { neu: 0 };

  const alle = [...wirklichNeu, ...altZeilen].slice(0, LERN_MAX_ZEILEN);
  const text = "---\ntyp: zusammenarbeit\nquelle: sprache\n---\n\n" +
    "# Was ich über die Zusammenarbeit mit Lukas gelernt habe\n\n" +
    "> Wird abends aus den Gesprächen fortgeschrieben und geht bei jeder Frage mit.\n" +
    "> Neues steht oben; was lange nicht bestätigt wurde, fällt unten heraus.\n\n" +
    alle.join("\n") + "\n";
  vault.schreibe(LERN_DATEI, text);
  return { neu: wirklichNeu.length };
}

// Fuer den STAND: die Liste als knapper Block, oder null.
function fuerStand() {
  try {
    const roh = vault.lesen(LERN_DATEI);
    if (!roh) return null;
    const zeilen = roh.split("\n").filter((z) => /^- /.test(z.trim())).map((z) => z.trim());
    if (!zeilen.length) return null;
    return "## SO ARBEITET LUKAS (aus frueheren Gespraechen gelernt — beachte es)\n" +
      zeilen.slice(0, LERN_MAX_ZEILEN).join("\n");
  } catch { return null; }
}

// ---------------------------------------------------------------- Hauptlauf
// Rueckgabe wie die anderen Zufluss-Module. Wirft NIE — laeuft aus einem
// Intervall-Callback, und ein entkommener Fehler hat den Container hier schon
// einmal in die Neustartschleife geschickt.
async function verdichte({ tage = 2 } = {}) {
  try {
    if (!verfuegbar()) return { ok: false, neu: 0, grund: "Kein Modell konfiguriert." };
    if (!vault.schreibbar(BEREICH)) return { ok: false, neu: 0, grund: BEREICH + " nicht beschreibbar (Mount :ro?)." };

    const tagesListe = [];
    for (let i = Math.max(1, Number(tage) || 1) - 1; i >= 0; i--) {
      tagesListe.push(berlinDatum(Date.now() - i * 86400000));
    }

    let neu = 0, gelernt = 0, letzteDatei = null;
    for (const datum of tagesListe) {
      const alle = gespraechAus(datum);
      if (!alle.length) continue;

      const rel = ZIEL + "/" + datum + ".md";
      const vorhanden = vault.lesen(rel) || "";
      const marken = [...vorhanden.matchAll(new RegExp("<!--\\s*id:sprache-" + datum + "-(\\d+)\\s*-->", "g"))]
        .map((m) => Number(m[1]));
      const schon = marken.length ? Math.max(...marken) : 0;
      const offen = alle.slice(schon);
      if (!offen.length) continue;

      const stuecke = [];
      let laenge = 0, verbraucht = 0;
      for (const b of offen) {
        const z = `${b.wer} (${b.zeit}): ${b.text.replace(/\s+/g, " ").slice(0, 700)}`;
        if (stuecke.length && laenge + z.length > MAX_ZEICHEN) break;
        stuecke.push(z); laenge += z.length; verbraucht++;
      }
      const gespraech = stuecke.join("\n");

      // 1) Firmenwissen
      const rohWissen = await schnell.frage(SYSTEM_WISSEN, gespraech,
        { maxTokens: 700, temp: 0.2, timeoutMs: 30000, model: MODELL }).catch(() => "");
      const gefunden = zeilenAus(rohWissen, ["Entscheidung", "Fakt", "Aufgabe", "Idee"], 12);

      if (gefunden.length) {
        const zeit = new Date().toLocaleString("de-DE",
          { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
        const bloecke = [`## Verdichtet · ${zeit}`, ""];
        for (const [art, titel] of RUBRIKEN) {
          const teil = gefunden.filter((f) => f.art === art);
          if (!teil.length) continue;
          bloecke.push(`**${titel}**`);
          for (const f of teil) bloecke.push("- " + f.text);
          bloecke.push("");
        }
        bloecke.push(`<!-- id:sprache-${datum}-${schon + verbraucht} -->`, "");
        vault.schreibe(rel, (vorhanden || kopfWissen(datum)) + bloecke.join("\n"));
        neu += gefunden.length;
        letzteDatei = rel;
      } else {
        // Auch ohne Erkenntnis den Marker setzen, sonst wird derselbe Abschnitt
        // jede Nacht erneut ans Modell geschickt.
        vault.schreibe(rel, (vorhanden || kopfWissen(datum)) +
          `<!-- id:sprache-${datum}-${schon + verbraucht} -->\n`);
      }

      // 2) Zusammenarbeit — mit dem bisher Gelernten als Kontext, damit das
      //    Modell nicht dreimal dasselbe vorschlaegt.
      const bisher = (vault.lesen(LERN_DATEI) || "").split("\n")
        .filter((z) => /^- /.test(z.trim())).slice(0, 25).join("\n");
      const rohLernen = await schnell.frage(SYSTEM_LERNEN,
        gespraech + (bisher ? "\n\nDAS WEISST DU SCHON (nicht wiederholen):\n" + bisher : ""),
        { maxTokens: 400, temp: 0.3, timeoutMs: 30000, model: MODELL }).catch(() => "");
      const lern = zeilenAus(rohLernen, LERN_RUBRIKEN, 4);
      if (lern.length) gelernt += lernenSchreiben(lern).neu;
    }

    return { ok: true, neu, gelernt, datei: letzteDatei };
  } catch (e) {
    return { ok: false, neu: 0, grund: String(e.message).slice(0, 200) };
  }
}

module.exports = { verdichte, fuerStand, gespraechAus };
