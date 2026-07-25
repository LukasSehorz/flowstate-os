// lib/zufluss-telegram.js — aus dem Telegram-Gespraech wird Firmenwissen (P3.3).
//
// Warum es diese Datei gibt: Im Chat mit Alexandra fallen taeglich die
// wichtigsten Dinge — Preise werden festgelegt, Aufgaben verteilt, Ideen
// geboren. Das Rohprotokoll landet schon im Gehirn (lib/telegram.js ->
// insGehirn -> eingang/telegram/YYYY-MM-DD.md), aber als GESPRAECH: mit
// Begruessungen, Rueckfragen, vorgelesenen Terminen. Darin gehen die Fakten
// unter, und niemand liest 12.000 Zeichen Chat nach einer Woche noch nachtraeglich.
// Hier destilliert das guenstige Modell den Tag zu einer Liste harter Inhalte
// (Entscheidungen, Fakten, Aufgaben, Ideen) in eingang/erkenntnisse/. So waechst
// das Firmengedaechtnis, statt dass Erkenntnisse im Chat versickern — und
// gehirn.js (Wissensordner "eingang") findet sie beim Nachfragen wieder.
//
// QUELLE: bestaetigt. lib/telegram.js schreibt jeden Beitrag als
// "**Wer** · HH:MM\nText" in eingang/telegram/YYYY-MM-DD.md; genau diese Dateien
// liegen im Vault. Ueber TELEGRAM_QUELLE umstellbar, falls der Mitschnitt spaeter
// aus einem Roh-Log kommt — geraten wird hier nichts.
//
// ZIEL: eingang/ (nicht wiki/ oder entscheidungen/) — der Vault ist ueberwiegend
// nur lesbar gemountet, beschreibbar sind laut lib/vault.js allein chronik/ und
// eingang/. Ein Schreibversuch woanders scheitert, deshalb bleibt die Verdichtung
// im Eingangsbereich (der laut Entscheidung Lukas 22.07. auch PII enthalten darf).
//
// MODELL: bewusst die guenstige Spur (SCHNELL_ACK_MODEL, Haiku). Das ist
// Extraktionsarbeit, keine Denkarbeit, und laeuft taeglich — Sonnet waere hier
// verbranntes Geld (Vorgabe Lukas: keine teuren Modelle fuer Routinen).

const vault = require("./vault.js");
const schnell = require("./schnell.js");

const QUELLE = (process.env.TELEGRAM_QUELLE || "eingang/telegram").replace(/^\/+|\/+$/g, "");
const ZIEL = (process.env.TELEGRAM_ERKENNTNISSE || "eingang/erkenntnisse").replace(/^\/+|\/+$/g, "");
const BEREICH = ZIEL.split("/")[0];                       // dieser Vault-Ordner muss :rw sein
const MODELL = process.env.SCHNELL_ACK_MODEL || "claude-haiku-4-5";
// Wieviel Gespraech pro Aufruf ans Modell geht. Der Rest kommt beim naechsten
// Lauf dran — der Marker zaehlt nur, was wirklich verdichtet wurde.
const MAX_ZEICHEN = Number(process.env.TELEGRAM_VERDICHTUNG_MAX || 12000);

const berlinDatum = (ts) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ts));

// Kanal konfiguriert (eigener Bot) UND ein Modell erreichbar — ohne das eine gibt
// es keine Gespraeche, ohne das andere niemanden, der sie verdichtet. Absichtlich
// zur Laufzeit gelesen, damit ein spaeter gesetztes Token ohne Neustart zieht.
function verfuegbar() {
  const kanal = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const modell = schnell.verfuegbar() ||
    Boolean(process.env.SCHNELL_CHAT_URL || process.env.HERMES_CHAT_URL);
  return kanal && modell;
}

// --- Rohprotokoll in Sprechbeitraege zerlegen -------------------------------
// Zeilenweise statt per Regex ueber den ganzen Text: das Format kommt aus
// insGehirn ("**Wer** · HH:MM"), Frontmatter und Ueberschrift stehen davor und
// fallen so von selbst weg. Mehrzeilige Beitraege bleiben zusammen.
function beitraege(text) {
  const roh = [];
  let aktuell = null;
  for (const zeile of String(text || "").replace(/\r/g, "").split("\n")) {
    const kopf = zeile.match(/^\*\*([^*]+)\*\*\s*·\s*(.*)$/);
    if (kopf) {
      if (aktuell) roh.push(aktuell);
      aktuell = { wer: kopf[1].trim(), zeit: kopf[2].trim(), zeilen: [] };
      continue;
    }
    if (aktuell) aktuell.zeilen.push(zeile);
  }
  if (aktuell) roh.push(aktuell);
  return roh
    .map((b) => ({ wer: b.wer, zeit: b.zeit, text: b.zeilen.join("\n").trim() }))
    .filter((b) => b.text);
}

// --- Die Verdichtung -------------------------------------------------------
// Der Prompt ist streng: NUR die vier Rubriken, sonst nichts. Ohne diese Haerte
// liefert jedes Modell brav eine "Zusammenfassung des Gespraechs" — und genau
// die ist Muell im Gedaechtnis, weil sie den Chat nur nacherzaehlt.
const SYSTEM =
  "Du destillierst das Chatprotokoll zwischen Lukas (Geschaeftsfuehrer) und seiner " +
  "Assistenz Alexandra zu dauerhaftem Firmenwissen. Gib AUSSCHLIESSLICH Zeilen in " +
  "genau diesem Format aus, eine Erkenntnis je Zeile:\n" +
  "Entscheidung: <was festgelegt wurde>\n" +
  "Fakt: <eine dauerhaft gueltige Information zu Firma, Kunden, Preisen, Technik, Zahlen>\n" +
  "Aufgabe: <was zu tun ist, wenn genannt mit Verantwortlichem und Frist>\n" +
  "Idee: <ein Vorhaben oder Vorschlag fuer spaeter>\n" +
  "VERBOTEN: Begruessungen, Verabschiedungen, Dank, Geplauder, Smalltalk, Rueckfragen, " +
  "Meta-Saetze ueber den Chat oder die Assistenz, und JEDE Zusammenfassung des " +
  "Gespraechsverlaufs. Ebenfalls weglassen: was Alexandra nur aus Kalender oder CRM " +
  "vorgelesen hat (Termine, Kennzahlen) — das steht schon in der Chronik. " +
  "Jede Zeile muss in einem Jahr ohne den Chat verstaendlich sein: Namen und Zahlen " +
  "ausschreiben, keine Pronomen wie 'das', 'er', 'dort'. Hoechstens 12 Zeilen, das " +
  "Wichtigste zuerst. Steht nichts Nennenswertes im Protokoll, antworte mit genau: NICHTS";

const RUBRIKEN = [["entscheidung", "Entscheidungen"], ["fakt", "Fakten"],
  ["aufgabe", "Aufgaben"], ["idee", "Ideen"]];

// Antwort des Modells in Erkenntnisse zerlegen. Tolerant gegenueber Aufzaehlungs-
// zeichen und gegenueber Modellen, die Abschnitte ("**Fakten**") statt Praefixe
// schreiben — alles, was in keine Rubrik faellt, wird verworfen (kein Geplauder).
function fakten(rohAntwort) {
  const treffer = [];
  const gesehen = new Set();
  let rubrik = null;
  for (const zeile0 of String(rohAntwort || "").split("\n")) {
    const zeile = zeile0.replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (!zeile) continue;
    const kopf = zeile.match(/^[-*•\s]*(Entscheidung|Fakt|Aufgabe|Idee)(?:e?n)?\s*:?\s*$/i);
    if (kopf) { rubrik = kopf[1].toLowerCase(); continue; }
    const mitPraefix = zeile.match(/^[-*•\d.)\s>]*(Entscheidung|Fakt|Aufgabe|Idee)(?:e?n)?\s*[:\-–]\s*(.+)$/i);
    let art = null, text = null;
    if (mitPraefix) { art = mitPraefix[1].toLowerCase(); text = mitPraefix[2]; }
    else if (rubrik && /^[-*•]\s+/.test(zeile)) { art = rubrik; text = zeile.replace(/^[-*•]\s+/, ""); }
    if (!art) continue;
    text = text.replace(/\s+/g, " ").replace(/^["'„»]+|["'“«]+$/g, "").trim();
    if (text.length < 8 || /^nichts\b/i.test(text)) continue;
    const schluessel = art + "|" + text.toLowerCase();
    if (gesehen.has(schluessel)) continue;              // Modell wiederholt sich gern
    gesehen.add(schluessel);
    treffer.push({ art, text });
    if (treffer.length >= 12) break;
  }
  return treffer;
}

// --- Vault: Tagesnotiz ------------------------------------------------------
function kopf(datum) {
  const lang = new Date(datum + "T12:00:00").toLocaleDateString("de-DE",
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
  return `---\ntyp: erkenntnisse\nquelle: telegram\ndatum: ${datum}\n---\n\n` +
    `# Erkenntnisse · ${lang}\n\n` +
    "> Aus dem Telegram-Gespräch verdichtet — nur Entscheidungen, Fakten, Aufgaben, Ideen.\n\n";
}

function block(gefunden, marke) {
  const zeit = new Date().toLocaleString("de-DE",
    { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  const z = [`## Verdichtet · ${zeit}`, ""];
  for (const [art, titel] of RUBRIKEN) {
    const teil = gefunden.filter((f) => f.art === art);
    if (!teil.length) continue;
    z.push(`**${titel}**`);
    for (const f of teil) z.push("- " + f.text);
    z.push("");
  }
  z.push(marke, "");
  return z.join("\n");
}

// --- Der taegliche Lauf ----------------------------------------------------
// Rueckgabe wie die anderen Zufluss-Module: { ok, neu, grund? }. Wirft NIE —
// sie laeuft aus einem Intervall-Callback, und ein entkommener Fehler hat den
// Container hier schon einmal in die Neustartschleife geschickt.
async function verdichte({ tage = 2 } = {}) {
  try {
    if (!verfuegbar()) return { ok: false, neu: 0, grund: "Telegram-Kanal oder Modell nicht konfiguriert." };
    if (!vault.schreibbar(BEREICH)) return { ok: false, neu: 0, grund: BEREICH + " nicht beschreibbar (Mount :ro?)." };

    // Heute UND gestern: laeuft die Routine kurz nach Mitternacht, waere der
    // Abend sonst fuer immer verloren.
    const tagesListe = [];
    for (let i = Math.max(1, Number(tage) || 1) - 1; i >= 0; i--) {
      tagesListe.push(berlinDatum(Date.now() - i * 86400000));
    }

    let neu = 0, geprueft = 0, letzteDatei = null;
    for (const datum of tagesListe) {
      const protokoll = vault.lesen(QUELLE + "/" + datum + ".md");
      if (!protokoll) continue;                       // an dem Tag kein Gespraech
      const alle = beitraege(protokoll);
      if (!alle.length) continue;

      const rel = ZIEL + "/" + datum + ".md";
      const vorhanden = vault.lesen(rel);
      // Idempotenz nach dem erprobten Muster aus whatsapp.js/posteingang.js:
      // ein <!-- id:… -->-Marker haelt fest, WIEVIELE Beitraege des Tages schon
      // verdichtet wurden. Ohne ihn stuenden die Fakten nach jedem Lauf erneut da.
      const marken = [...vorhanden.matchAll(new RegExp("<!--\\s*id:telegram-" + datum + "-(\\d+)\\s*-->", "g"))]
        .map((m) => Number(m[1]));
      const schonVerdichtet = marken.length ? Math.max(...marken) : 0;
      const offen = alle.slice(schonVerdichtet);
      if (!offen.length) continue;                    // nichts Neues geredet

      // Nur so viel Gespraech, wie ins Fenster passt; mindestens ein Beitrag,
      // damit ein Monster-Beitrag den Fortschritt nicht blockiert.
      const stuecke = [];
      let laenge = 0, verbraucht = 0;
      for (const b of offen) {
        const zeile = `${b.wer}${b.zeit ? " (" + b.zeit + ")" : ""}: ${b.text.replace(/\s+/g, " ").slice(0, 700)}`;
        if (stuecke.length && laenge + zeile.length > MAX_ZEICHEN) break;
        stuecke.push(zeile);
        laenge += zeile.length + 1;
        verbraucht++;
      }
      geprueft += verbraucht;

      let gefunden;
      try {
        const antwort = await schnell.frage(SYSTEM, stuecke.join("\n"),
          { model: MODELL, maxTokens: 700, temp: 0, timeoutMs: 30000 });
        gefunden = fakten(antwort);
      } catch (e) {
        // Modellausfall: kein Marker, keine Datei — der Tag wird beim naechsten
        // Lauf erneut versucht. ok:false, damit server.js es ins Log schreibt.
        return { ok: false, neu, geprueft, grund: "Verdichtung fehlgeschlagen: " + String(e && e.message || e).slice(0, 150) };
      }

      const marke = `<!-- id:telegram-${datum}-${schonVerdichtet + verbraucht} -->`;
      if (!gefunden.length) {
        // Nichts Nennenswertes im Gespraech: KEINE leere Tagesnotiz anlegen
        // (leere Notizen sind Muell). Gibt es die Notiz schon, halten wir nur
        // den Fortschritt fest — unsichtbarer Kommentar, damit dieselben Zeilen
        // nicht bei jedem Lauf erneut ans Modell gehen.
        if (vorhanden) vault.anhaenge(rel, marke + "\n\n");
        continue;
      }

      if (!vorhanden) vault.schreibe(rel, kopf(datum));
      vault.anhaenge(rel, block(gefunden, marke));
      neu += gefunden.length;
      letzteDatei = rel;
    }
    return { ok: true, neu, geprueft, datei: letzteDatei };
  } catch (e) {
    return { ok: false, neu: 0, grund: String(e && e.message || e).slice(0, 200) };
  }
}

module.exports = { verfuegbar, verdichte, QUELLE, ZIEL };
