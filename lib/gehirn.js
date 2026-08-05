// lib/gehirn.js — die Lese-Bruecke: Alexandra antwortet AUS dem zweiten Gehirn.
//
// Termine/Zahlen kommen aus dem vorgehaltenen Zustand. Firmenwissen (Kontext,
// Entscheidungen, Wiki, Referenzen, Chronik) steht aber NUR im Vault. Diese
// Datei durchsucht die Wissensordner, liest die passendsten Notizen und laesst
// Sonnet daraus knapp antworten — so "weiss" die schnelle Stimme, was im Gehirn
// steht. (Charakter/Ton liegen ebenfalls im Vault, werden aber in
// sprache-routes.js geladen — STIMME-alexandra.md, ton-lukas.md.)

const fs = require("fs");
const path = require("path");
const schnell = require("./schnell.js");

const VAULT = process.env.VAULT_PATH || "/vault";
// Wissensordner — bewusst OHNE instanzen (Charakter), skills (Hermes-Interna)
// und raw (Rohdumps). Nur echtes Firmenwissen.
const WISSEN = ["kontext", "wiki", "entscheidungen", "referenzen", "chronik", "projekte", "eingang"];
const WURZEL_DATEIEN = ["README.md", "TOOLS.md", "REGELN.md"];

function alleNotizen() {
  const treffer = [];
  const scan = (rel, tiefe = 0) => {
    if (tiefe > 3) return;
    let eintraege;
    try { eintraege = fs.readdirSync(path.join(VAULT, rel), { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      const p = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) scan(p, tiefe + 1);
      else if (e.name.endsWith(".md")) treffer.push(p);
    }
  };
  WISSEN.forEach((o) => scan(o));
  for (const f of WURZEL_DATEIEN) if (fs.existsSync(path.join(VAULT, f))) treffer.push(f);
  return treffer;
}

const STOPP = new Set(("der die das und oder ist sind ein eine wie was wann wer wir ich du mir mich " +
  "noch mal auch von den dem des auf fuer für mit bei uns unser unsere haben habt gibt es dass").split(" "));

// NICHT ALLES IM VAULT IST GLEICH VIEL WERT.
//
// "entscheidungen" und "kontext" sind kuratiert — jemand hat sich hingesetzt
// und aufgeschrieben, was gilt. "eingang" ist das Gegenteil: Rohabzuege von
// WhatsApp, Mail und Telegram, ungefiltert, taeglich neu. Beides gleich zu
// gewichten hiess in der Praxis, dass ein Chatprotokoll eine Entscheidung
// ueberstimmt.
//
// Die Rohposteingaenge bleiben durchsuchbar — dort steht durchaus Brauchbares
// ("was hat Jannik zu Krotzer geschrieben"). Sie sollen nur nicht gewinnen,
// wenn eine kuratierte Notiz dieselbe Frage beantwortet.
const GEWICHT = (rel) => {
  if (rel.startsWith("entscheidungen/") || rel.startsWith("kontext/")) return 1.4;
  if (rel.startsWith("wiki/") || rel.startsWith("referenzen/")) return 1.2;
  if (rel.startsWith("eingang/")) return 0.4;
  return 1.0;
};

// Monatsnamen sind Zahlen — und umgekehrt.
//
// Lukas fragt "was wurde am 16. Juli entschieden", in den Notizen steht
// "16.07.2026". Ohne diese Bruecke findet die Suche nichts (nachgewiesen am
// 05.08.: Die Datei entscheidungen/2026-07-16-basisentscheidungen.md enthielt
// das Wort "Juli" kein einziges Mal).
const MONATE = {
  januar: "01", februar: "02", maerz: "03", märz: "03", april: "04", mai: "05", juni: "06",
  juli: "07", august: "08", september: "09", oktober: "10", november: "11", dezember: "12",
};

// Deutsche Woerter beugen sich staerker als englische: "entschieden" soll
// "Entscheidung" finden, "Preise" soll "Preis" finden. Ein Wortstamm-Verfahren
// waere hier zu viel; es genuegt, lange Woerter auf ihren Anfang zu kuerzen.
// Sechs Zeichen sind der Kompromiss: "entsch" trifft die ganze Familie,
// bleibt aber lang genug, um nicht alles zu treffen.
const stamm = (w) => (w.length > 7 ? w.slice(0, 6) : w);

function schluessel(frage) {
  const roh = String(frage).toLowerCase().replace(/[^a-zäöüß0-9 ]/g, " ").split(/\s+/);
  const raus = [];
  for (const w of roh) {
    if (!w || STOPP.has(w)) continue;
    // Zahlen zaehlen ab EINER Stelle — Tagesangaben ("16") fielen vorher durch
    // die Laengengrenze und Datumsfragen waren damit unbeantwortbar.
    if (/^\d+$/.test(w)) {
      raus.push(w);
      if (w.length === 1) raus.push("0" + w);      // "5." steht als "05" in den Notizen
      continue;
    }
    if (w.length <= 3) continue;
    raus.push(stamm(w));
    if (MONATE[w]) raus.push(MONATE[w]);           // "juli" -> auch "07" suchen
  }
  return [...new Set(raus)];
}

async function durchsuchen(frage) {
  const woerter = schluessel(frage);
  if (!woerter.length) return { ok: true, reply: "Dazu bräuchte ich einen konkreteren Anhaltspunkt." };

  const bewertet = [];
  for (const rel of alleNotizen()) {
    let text;
    try { text = fs.readFileSync(path.join(VAULT, rel), "utf-8"); } catch { continue; }
    const klein = text.toLowerCase();
    // DER PFAD ZAEHLT MIT, und zwar schwer.
    //
    // Vorher wurde ausschliesslich der Inhalt durchsucht. Die Datei
    // entscheidungen/2026-07-16-basisentscheidungen.md war damit fuer die Frage
    // "was wurde am 16. Juli entschieden" unsichtbar — obwohl Ordnername,
    // Datum und Thema alle im Pfad stehen. Wer eine Datei so benennt, hat
    // bereits gesagt, worum es geht; das ist ein staerkeres Signal als eine
    // beilaeufige Erwaehnung im Fliesstext. Deshalb zaehlt ein Treffer im Pfad
    // dreifach.
    const pfad = rel.toLowerCase().replace(/[-_/.]/g, " ");
    let imText = 0, imPfad = 0;
    for (const w of woerter) {
      imText += klein.split(w).length - 1;
      imPfad += pfad.split(w).length - 1;
    }
    // LAENGE HERAUSRECHNEN — sonst gewinnt, wer am meisten redet.
    //
    // Nachgemessen am 05.08.: Bei der Frage nach dem 16. Juli lagen auf den
    // ersten fuenf Plaetzen ausschliesslich WhatsApp-Rohdumps (Bestwert 190).
    // Ein 50-kB-Chatprotokoll enthaelt "07" fuenfzigmal, die zweiseitige
    // Entscheidungsnotiz zweimal — und stand damit chancenlos hinten.
    // Gezaehlt wird deshalb je 1.000 Zeichen, nicht absolut.
    const dichte = (imText * 1000) / Math.max(text.length, 500);
    const score = (dichte + imPfad * 6) * GEWICHT(rel);
    if (score > 0) bewertet.push({ rel, text, score });
  }
  bewertet.sort((a, b) => b.score - a.score);
  const top = bewertet.slice(0, 4);
  if (!top.length) return { ok: true, reply: "Dazu steht nichts im Gehirn." };

  let kontext = "";
  for (const t of top) {
    const stueck = `\n\n### ${t.rel}\n` + t.text.slice(0, 2500);
    if ((kontext + stueck).length > 8000) break;
    kontext += stueck;
  }
  const system =
    "Du bist Alexandras Wissens-Hand. Beantworte Lukas' Frage NUR aus den folgenden " +
    "Notizen aus seinem zweiten Gehirn. Antworte in 1-3 knappen Saetzen, direkt an Lukas " +
    "(per du), keine Dateinamen, keine Quellenliste.\n\n" +
    // TEILWISSEN IST BESSER ALS SCHWEIGEN (05.08.).
    //
    // Beim Wechsel auf Haiku kam auf "was haben wir mit Krotzer besprochen"
    // ploetzlich "Dazu steht nichts im Gehirn" — obwohl das Modell den Eintrag
    // gefunden hatte und im selben Satz beschrieb ("nur als Rechnungsadresse").
    // Haiku nimmt die Regel woertlicher als Sonnet: Steht nicht GENAU das da,
    // wonach gefragt wurde, verneint es. Fuer Lukas ist das die schlechteste
    // aller Antworten — er weiss dann weder, dass etwas da ist, noch was.
    "Findest du etwas, das die Frage nur TEILWEISE beantwortet, sag was du hast und " +
    "wobei es nicht passt. Ganz verneinen ('Dazu steht nichts im Gehirn.') nur, wenn " +
    "wirklich nichts zum Thema dasteht.\n\n" +
    // Wird VORGELESEN — Sternchen und Rauten spricht die Stimme mit.
    "Schreib reinen Fliesstext: keine Sternchen, keine Rauten, keine Aufzaehlungszeichen.\n\n" +
    "NOTIZEN:" + kontext;
  // HAIKU STATT SONNET (05.08.) — gemessen, nicht vermutet.
  //
  // Das Gehirn war mit 5,6 Sekunden der langsamste Baustein im ganzen System,
  // zehnmal langsamer als jede Datenbankabfrage. Aufgeschluesselt:
  //   86 Dateien auflisten, lesen und durchsuchen ...    16 ms
  //   der Modellaufruf .............................. 4.400 ms
  //
  // Die Suche war also nie das Problem. Drei Varianten mit demselben Kontext
  // und derselben Frage gegeneinander gemessen:
  //   Sonnet, Aufwand hoch (bisher)   4.409 ms
  //   Sonnet, Aufwand low             4.514 ms   (bringt hier NICHTS)
  //   Haiku                           1.631 ms   bei gleicher Antwortqualitaet
  //
  // Das ist keine Denkaufgabe, sondern eine Leseaufgabe: "beantworte das aus
  // diesen Notizen". Dafuer ist Haiku gebaut.
  //
  // Vorher geprueft, was hier wirklich zaehlt — ob Haiku ehrlich bleibt, wenn
  // die Antwort NICHT in den Notizen steht. Drei Gegenproben ("wie viel Umsatz
  // im Juli", "welche Farbe hat unser Logo"): zweimal korrekt "Dazu steht
  // nichts im Gehirn", einmal die richtige Antwort. Ein schnelles Modell, das
  // erfindet, waere hier schlimmer als ein langsames.
  // Der Prompt verbietet Markdown, aber Modelle formatieren gern trotzdem.
  // Eine Anweisung ist keine Garantie — und "Sternchen Sternchen Umsatz" ist
  // das Erste, was Lukas auffiele.
  const fuersOhr = (t) => String(t || "")
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1")
    .replace(/^#{1,6}\s*/gm, "").replace(/^[-*+]\s+/gm, "")
    .replace(/`([^`]*)`/g, "$1").trim();

  const modell = process.env.GEHIRN_MODELL || "claude-haiku-4-5";
  try {
    const reply = await schnell.frage(system, frage, { maxTokens: 350, timeoutMs: 25000, model: modell });
    return { ok: true, reply: fuersOhr(reply) };
  } catch (e) {
    // Faellt Haiku aus, antwortet Sonnet — langsamer, aber besser als stumm.
    try {
      const reply = await schnell.denke(system, frage, { webSuche: false, maxTokens: 350, timeoutMs: 25000, aufwand: "low" });
      return { ok: true, reply: fuersOhr(reply) };
    } catch { return { ok: false, hint: String(e.message).slice(0, 150) }; }
  }
}

module.exports = { durchsuchen };
