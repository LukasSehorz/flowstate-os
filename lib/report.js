// lib/report.js — der proaktive Tages-Report (Wunsch Lukas 22.07.).
//
// Jeden Abend kompiliert das Dashboard aus den Daten, die es ohnehin hat
// (Kalender, CRM), einen kurzen Report und laesst Sonnet ihn in Alexandras
// Stimme formulieren. Ausgeliefert wird er ueber die schnelle Stimme
// (Telegram, Text + Sprache) — Alexandra meldet sich also von selbst.
//
// Dashboard-nativ (nicht Hermes), weil die Daten hier liegen und es so
// zuverlaessig + mit Stimme kommt. Hermes bleibt fuer eigene Automatisierungen.

const fs = require("fs");
const path = require("path");
const zustand = require("./zustand.js");
const crm = require("./crm.js");
const schnell = require("./schnell.js");

const VAULT = process.env.VAULT_PATH || "/vault";
const STIMME = path.join(VAULT, "instanzen", "lukas", "STIMME-alexandra.md");

const berlinTag = (offsetTage = 0) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" })
    .format(new Date(Date.now() + offsetTage * 86400000));
const tagVon = (iso) => {
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? "" : new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ts));
};
const uhr = (iso) => (String(iso).match(/T(\d{2}:\d{2})/) || [, "ganztägig"])[1];
const eur = (n) => Number(n || 0).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " Euro";

// Rohdaten -> Report-Text in Alexandras Stimme (Sonnet).
async function baueReport({ art = "abend" } = {}) {
  const z = zustand.lesen();
  const morgen = berlinTag(1);
  const termine = (Array.isArray(z.kalender) ? z.kalender : [])
    .filter((t) => tagVon(t.start) === morgen)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((t) => `${uhr(t.start)} ${t.titel}`);

  const k = await crm.kennzahlenGesamt().catch(() => null);

  const langMorgen = new Date(morgen + "T12:00:00").toLocaleDateString("de-DE",
    { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });

  const daten =
    `Report-Art: ${art === "morgen" ? "Morgen-Briefing (heute)" : "Abend-Report (Blick auf morgen)"}\n` +
    `Termine morgen (${langMorgen}): ${termine.length ? termine.join(" · ") : "keine"}\n` +
    (k ? `Zahlen: ${k.leads} Leads, diesen Monat ${k.gewonnen_monat} Deal(s) gewonnen (${eur(k.umsatz_monat)}), ` +
      `${k.offene_aufgaben} offene Aufgaben, ${k.wiedervorlagen} faellige Wiedervorlagen, ${k.neue_leads_heute} neue Leads heute.`
      : "Zahlen gerade nicht abrufbar.");

  let stimme = "";
  try { stimme = fs.readFileSync(STIMME, "utf-8"); } catch {}

  const system = stimme +
    "\n\n## Aufgabe: Tages-Report\nFasse fuer Lukas kurz und persoenlich zusammen — als wuerdest du " +
    "dich abends bei ihm melden. Zuerst die wichtigsten Termine morgen (werte/priorisiere, nicht alles " +
    "aufzaehlen), dann kurz, was bei den Zahlen/To-Dos ansteht. 3-5 Saetze, natuerlich gesprochen, deine " +
    "Hoerregeln (Uhrzeiten wie 'elf Uhr', keine Rohzahlen). Beginne mit einer kurzen Anrede wie 'Hey, kurzer " +
    "Blick auf morgen:'. Nichts erfinden — nur was in den Daten steht.";
  try {
    const text = await schnell.frage(system, daten, { maxTokens: 320, timeoutMs: 25000 });
    return { ok: true, text: String(text).trim(), termine: termine.length };
  } catch (e) {
    // Fallback ohne Modell: schlicht, aber ehrlich.
    const t = termine.length ? `Morgen: ${termine.join(", ")}.` : "Morgen stehen keine Termine im Kalender.";
    return { ok: true, text: `Hey, kurzer Blick auf morgen. ${t}`, termine: termine.length };
  }
}

module.exports = { baueReport };
