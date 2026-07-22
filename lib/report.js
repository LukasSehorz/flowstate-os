// lib/report.js — der proaktive Tages-Report (Wunsch Lukas 22.07.).
//
// Architektur (Entscheidung 22.07., nach dem Cron-Drift-Vorfall):
//   Dashboard PLANT (server.js, zuverlaessig, keine Cron-Drift-Sperre)
//   -> HERMES GENERIERT den Report (Lukas: "solche Aufgaben macht Hermes")
//   -> Dashboard LIEST per Stimme vor (telegram.push, bewaehrter Weg).
//
// Warum nicht der Hermes-eigene Cron: dessen Kosten-Schutz stoppt bei jedem
// Modellwechsel (Drift), und er liefert nur Text ueber seinen eigenen Kanal —
// die Stimme kann nur das Dashboard. Deshalb generiert Hermes hier auf Zuruf
// (Chat-API, kein Cron) und wir liefern selbst aus.
//
// Faellt Hermes aus (Timeout/Fehler), springt Sonnet aus den Dashboard-Daten
// ein — so kommt der Report IMMER, nur eben etwas schlichter.

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

// Dashboard-Daten (Kalender + CRM) einsammeln — als Kontext fuer Hermes UND als
// Grundlage fuer den Sonnet-Fallback. Art-bewusst: Morgen-Briefing blickt auf
// HEUTE (der Tag, der beginnt), Abend-Report auf MORGEN (der Tag, der kommt).
async function datenSammeln(art) {
  const z = zustand.lesen();
  const istMorgen = art === "morgen";
  const tag = berlinTag(istMorgen ? 0 : 1);
  const wort = istMorgen ? "heute" : "morgen";
  const termine = (Array.isArray(z.kalender) ? z.kalender : [])
    .filter((t) => tagVon(t.start) === tag)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((t) => `${uhr(t.start)} ${t.titel}`);
  const k = await crm.kennzahlenGesamt().catch(() => null);
  const langTag = new Date(tag + "T12:00:00").toLocaleDateString("de-DE",
    { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });
  const daten =
    `Report-Art: ${istMorgen ? "Morgen-Briefing (Blick auf HEUTE)" : "Abend-Report (Blick auf morgen)"}\n` +
    `Termine ${wort} (${langTag}): ${termine.length ? termine.join(" · ") : "keine"}\n` +
    (k ? `Zahlen: ${k.leads} Leads, diesen Monat ${k.gewonnen_monat} Deal(s) gewonnen (${eur(k.umsatz_monat)}), ` +
      `${k.offene_aufgaben} offene Aufgaben, ${k.wiedervorlagen} faellige Wiedervorlagen, ${k.neue_leads_heute} neue Leads heute.`
      : "Zahlen gerade nicht abrufbar.");
  return { daten, termine };
}

// Die 3 wichtigsten Weltnachrichten (Wunsch Lukas 22.07., nur fuers Morgen-
// Briefing). Ueber Sonnet mit Websuche — aktuell und verlaesslich; Hermes webt
// sie danach in seiner Stimme ein. Faellt sie aus, laeuft das Briefing ohne News.
async function weltNews() {
  const heute = new Date().toLocaleDateString("de-DE",
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
  const system =
    `Du bist ein knapper Nachrichten-Kurator. Heute ist ${heute}. Nenne die 3 WICHTIGSTEN ` +
    `aktuellen Nachrichten aus der Welt (global relevant: Politik, Wirtschaft, Technologie, ` +
    `groessere Ereignisse; deutscher Bezug zaehlt mit). Nutze die Websuche fuer aktuelle Fakten, ` +
    `nichts erfinden. Antworte als GENAU 3 sehr kurze Punkte, je EIN faktischer Satz, ohne Meinung, ` +
    `ohne Quellen-URLs. Format: "1. … 2. … 3. …"`;
  try {
    const t = await schnell.denke(system, "Die 3 wichtigsten Weltnachrichten heute.",
      { maxSuchen: 3, maxTokens: 320, timeoutMs: 45000 });
    return String(t || "").trim();
  } catch { return ""; }
}

// Hermes den Report bauen lassen (Chat-API, KEIN Cron -> keine Drift-Sperre).
// Kurz & sprechfreundlich, denn er wird laut vorgelesen. Art-bewusst.
async function hermesReport(daten, art) {
  const url = process.env.HERMES_CHAT_URL;
  if (!url) throw new Error("HERMES_CHAT_URL fehlt");
  const headers = { "Content-Type": "application/json" };
  if (process.env.HERMES_API_KEY) headers["Authorization"] = "Bearer " + process.env.HERMES_API_KEY;
  const istMorgen = art === "morgen";
  const auftrag =
    `Erstelle ein KURZES, sprechfreundliches ${istMorgen ? "Morgen-Briefing" : "Abend-Report"} ` +
    "fuer Lukas — 3 bis 5 Saetze, es wird laut vorgelesen. " +
    (istMorgen
      ? "Blick auf HEUTE: die wichtigsten Termine heute (werte und priorisiere, nicht alles aufzaehlen), " +
        "dann kurz die wichtigsten offenen To-Dos fuer heute und auffaellige neue Geschaeftsmails, die ueber Nacht kamen. " +
        "ZUM SCHLUSS die 3 wichtigsten Weltnachrichten (sie stehen im Kontext unten unter 'Weltnachrichten') — " +
        "je ein knapper Satz, natuerlich eingeleitet mit 'Und kurz aus der Welt:'. "
      : "Blick auf morgen: die wichtigsten Termine morgen (werte und priorisiere, nicht alles aufzaehlen), " +
        "dann kurz die wichtigsten offenen To-Dos und auffaellige neue Geschaeftsmails von heute. ") +
    "Nutze fuer Kalender und Gmail deine Tools (Anleitung: /opt/data/vault/referenzen/google-workspace.md, " +
    "GWS_ENCRYPTION=none). Sprechregeln: gesprochene Uhrzeiten wie 'elf Uhr', KEINE roh vorgelesenen Zahlen, " +
    "IDs, Adressen oder URLs. Beginne mit " +
    (istMorgen ? "'Guten Morgen! Dein Tag im Blick:'" : "'Hey, kurzer Blick auf morgen:'") +
    ". Sende KEINE Mails, aendere nichts. Gib NUR den fertigen Text zurueck, sonst nichts.\n\n" +
    "Als Kontext aus dem Dashboard (nutze ihn, falls deine Tools klemmen):\n" + daten;
  const r = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({ model: process.env.HERMES_MODEL || "hermes-agent",
      messages: [{ role: "user", content: auftrag }], stream: false }),
    signal: AbortSignal.timeout(170000),
  });
  const d = await r.json();
  const text = d?.choices?.[0]?.message?.content;
  if (!text || !text.trim()) throw new Error(d?.error?.message || "Hermes leer");
  // Sicherheitsnetz: interne Marker/Codefences entfernen, die nie vorgelesen werden.
  return text.replace(/```[\s\S]*?```/g, "").replace(/\[SILENT\]/gi, "").trim();
}

// Sonnet-Fallback aus den Dashboard-Daten — schnell und zuverlaessig. Art-bewusst.
async function sonnetReport(daten, art) {
  const istMorgen = art === "morgen";
  let stimme = "";
  try { stimme = fs.readFileSync(STIMME, "utf-8"); } catch {}
  const system = stimme +
    `\n\n## Aufgabe: ${istMorgen ? "Morgen-Briefing" : "Abend-Report"}\nFasse fuer Lukas kurz und ` +
    `persoenlich zusammen — als wuerdest du dich ${istMorgen ? "morgens bei ihm melden und den Tag anschieben" : "abends bei ihm melden"}. ` +
    `Zuerst die wichtigsten Termine ${istMorgen ? "heute" : "morgen"} (werte/priorisiere, nicht alles ` +
    "aufzaehlen), dann kurz, was bei den Zahlen/To-Dos ansteht. " +
    (istMorgen ? "Zum Schluss die 3 Weltnachrichten aus den Daten, je ein knapper Satz, eingeleitet mit 'Und kurz aus der Welt:'. " : "") +
    `${istMorgen ? "4-6" : "3-5"} Saetze, natuerlich gesprochen, deine ` +
    `Hoerregeln (Uhrzeiten wie 'elf Uhr', keine Rohzahlen). Beginne mit ` +
    (istMorgen ? "'Guten Morgen! Dein Tag im Blick:'" : "'Hey, kurzer Blick auf morgen:'") +
    ". Nichts erfinden — nur was in den Daten steht.";
  return (await schnell.frage(system, daten, { maxTokens: istMorgen ? 450 : 320, timeoutMs: 25000 })).trim();
}

// Rohdaten -> Report-Text. Hermes zuerst (reich), Sonnet als Ausfallnetz.
// Morgens zusaetzlich die 3 wichtigsten Weltnachrichten (parallel geholt).
async function baueReport({ art = "abend" } = {}) {
  const istMorgen = art === "morgen";
  const [{ daten, termine }, news] = await Promise.all([
    datenSammeln(art),
    istMorgen ? weltNews() : Promise.resolve(""),
  ]);
  const datenPlus = news
    ? daten + `\n\nWeltnachrichten (schon recherchiert — gib diese 3 sinngemaess wieder, nichts hinzuerfinden):\n${news}`
    : daten;
  try {
    const text = await hermesReport(datenPlus, art);
    if (text) return { ok: true, text, termine: termine.length, quelle: "hermes" };
  } catch (e) {
    console.error("Report via Hermes fehlgeschlagen, nutze Sonnet:", String(e.message).slice(0, 120));
  }
  try {
    return { ok: true, text: await sonnetReport(datenPlus, art), termine: termine.length, quelle: "sonnet" };
  } catch {
    const t = termine.length ? `Morgen: ${termine.join(", ")}.` : "Morgen stehen keine Termine im Kalender.";
    return { ok: true, text: `Hey, kurzer Blick auf morgen. ${t}`, termine: termine.length, quelle: "fallback" };
  }
}

module.exports = { baueReport };
