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
const WISSEN = ["kontext", "wiki", "entscheidungen", "referenzen", "chronik", "projekte"];
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

function schluessel(frage) {
  return [...new Set(String(frage).toLowerCase().replace(/[^a-zäöüß0-9 ]/g, " ")
    .split(/\s+/).filter((w) => w.length > 3 && !STOPP.has(w)))];
}

async function durchsuchen(frage) {
  const woerter = schluessel(frage);
  if (!woerter.length) return { ok: true, reply: "Dazu bräuchte ich einen konkreteren Anhaltspunkt." };

  const bewertet = [];
  for (const rel of alleNotizen()) {
    let text;
    try { text = fs.readFileSync(path.join(VAULT, rel), "utf-8"); } catch { continue; }
    const klein = text.toLowerCase();
    let score = 0;
    for (const w of woerter) score += klein.split(w).length - 1;
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
    "Notizen aus seinem zweiten Gehirn. Steht die Antwort nicht drin, sag ehrlich " +
    "'Dazu steht nichts im Gehirn.' Antworte in 1-3 knappen Saetzen, direkt an Lukas " +
    "(per du), keine Dateinamen, keine Quellenliste.\n\nNOTIZEN:" + kontext;
  try {
    const reply = await schnell.denke(system, frage, { webSuche: false, maxTokens: 350, timeoutMs: 25000 });
    return { ok: true, reply };
  } catch (e) {
    return { ok: false, hint: String(e.message).slice(0, 150) };
  }
}

module.exports = { durchsuchen };
