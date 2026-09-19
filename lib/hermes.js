// lib/hermes.js — Aufträge an Hermes, asynchron, mit Auftragsbuch (Stufe 2, 19.09.2026).
//
// DIE EINE STELLE, durch die alles läuft, was an Hermes geht. Vorher gab es
// fünf Aufrufstellen mit je eigenem Timeout, und alle warteten synchron auf
// eine Chat-Completion. Nodes HTTP-Client brach nach 300 s ab, Fehler wurden
// mit .catch(() => {}) verschluckt, und niemand konnte hinterher sagen, welcher
// Auftrag wann lief und was daraus wurde.
//
// Jetzt:
//   1. Jeder Auftrag bekommt eine Nummer in der Tabelle auftraege (0070),
//      mit Quelle, Status, Ergebnis, Dauer. Das ist das Auftragsbuch.
//   2. Hermes bekommt den Auftrag über seine Runs-API (POST /v1/runs) und
//      arbeitet im Hintergrund. Wir lesen den Ereignisstrom (SSE) mit: Er
//      schickt alle 10 s ein Lebenszeichen, darum gibt es keinen 300-s-Abbruch
//      mehr, und Zwischenstände kommen als message.delta an.
//   3. Am Ende steht das Ergebnis im Auftragsbuch. Kommt es erst nach der
//      Frist des Aufrufers (spaetMelden), geht es von hier aus per Telegram
//      raus — nichts geht mehr verloren, nur weil jemand nicht mehr wartete.
//
// Hermes antwortet laut SOUL.md mit genau einem JSON-Block:
//   {zusammenfassung, ergebnis, freigabe_noetig[], vault_aenderungen[], offene_fragen[]}
// ergebnisLesen() holt ihn heraus, antwortText() macht Klartext daraus.
// Steht freigabe_noetig drin, bekommt der Auftrag den Status "freigabe":
// Hermes hat etwas vorbereitet, das nach REGELN.md ein Mensch freigeben muss.

const crm = require("./crm.js");
const sprachlog = require("./sprachlog.js");

function basis() {
  const u = process.env.HERMES_URL || String(process.env.HERMES_CHAT_URL || "").replace(/\/v1\/.*$/, "");
  return u.replace(/\/+$/, "");
}
function verfuegbar() { return Boolean(basis()); }
function kopf() {
  const h = { "content-type": "application/json" };
  if (process.env.HERMES_API_KEY) h.authorization = "Bearer " + process.env.HERMES_API_KEY;
  return h;
}

// ---------------------------------------------------------------- Ergebnis lesen

// Eine SSE-Zeile in ein Ereignis verwandeln. Hermes schickt "data: {json}";
// Kommentarzeilen (": keepalive") und Leerzeilen ergeben null.
function sseZeile(zeile) {
  const z = String(zeile || "");
  if (!z.startsWith("data:")) return null;
  try { return JSON.parse(z.slice(5).trim()); } catch { return null; }
}

// Den JSON-Block aus Hermes' Ausgabe holen. Reihenfolge: die ganze Ausgabe
// ist JSON — ein ```json-Zaun — der letzte {…}-Block, der sich parsen lässt.
function ergebnisLesen(output) {
  const s = String(output || "").trim();
  if (!s) return null;
  const versuch = (t) => { try { const o = JSON.parse(t); return o && typeof o === "object" ? o : null; } catch { return null; } };
  let o = versuch(s);
  if (o) return o;
  const zaun = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (zaun && (o = versuch(zaun[1].trim()))) return o;
  // Von hinten: jede öffnende Klammer als Startpunkt probieren.
  for (let i = s.lastIndexOf("{"); i >= 0; i = s.lastIndexOf("{", i - 1)) {
    let tiefe = 0, inText = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inText) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inText = false; continue; }
      if (c === '"') inText = true;
      else if (c === "{") tiefe++;
      else if (c === "}") { tiefe--; if (tiefe === 0) { if ((o = versuch(s.slice(i, j + 1)))) return o; break; } }
    }
    if (i === 0) break;
  }
  return null;
}

// Klartext für Lukas: Zusammenfassung, Ergebnis, dann Freigaben und Fragen.
function antwortText(erg, output) {
  if (!erg) return String(output || "").trim();
  const teile = [];
  const zf = String(erg.zusammenfassung || "").trim();
  if (zf) teile.push(zf);
  const e = erg.ergebnis;
  if (typeof e === "string") { const t = e.trim(); if (t && t !== zf) teile.push(t); }
  else if (e && typeof e === "object") teile.push(JSON.stringify(e, null, 2));
  const freigaben = Array.isArray(erg.freigabe_noetig) ? erg.freigabe_noetig : [];
  if (freigaben.length) {
    teile.push("Freigabe nötig:\n" + freigaben.map((f) => "- " + (typeof f === "string" ? f
      : [f.was, f.warum].filter(Boolean).join(" · "))).join("\n"));
  }
  const fragen = Array.isArray(erg.offene_fragen) ? erg.offene_fragen : [];
  if (fragen.length) teile.push("Offene Fragen:\n" + fragen.map((f) => "- " + String(f)).join("\n"));
  return teile.join("\n\n").trim() || String(output || "").trim();
}

// ---------------------------------------------------------------- Auftragsbuch

async function buchen(sql, args = []) {
  try { return await crm.system(sql, args); }
  catch (e) { console.error("Auftragsbuch:", String(e.message).slice(0, 160)); return null; }
}

async function anlegen({ quelle, nutzerId, text, sessionId }) {
  const r = await buchen(
    `insert into public.auftraege (quelle, nutzer_id, text, session_id, status)
     values ($1, $2, $3, $4, 'neu') returning id`,
    [String(quelle || "web").slice(0, 40), nutzerId || null, String(text || "").slice(0, 8000), sessionId || null]);
  return r?.rows?.[0]?.id || null;
}

async function abschliessen(id, { status, ergebnis = null, antwort = null, fehler = null, dauerMs = null }) {
  if (!id) return;
  await buchen(
    `update public.auftraege
        set status = $2, ergebnis = $3, antwort = $4, fehler = $5, dauer_ms = $6, beendet = now()
      where id = $1`,
    [id, status, ergebnis ? JSON.stringify(ergebnis) : null, antwort ? String(antwort).slice(0, 20000) : null,
      fehler ? String(fehler).slice(0, 500) : null, dauerMs]);
}

async function liste(anzahl = 30) {
  const r = await buchen(
    `select id, quelle, status, left(text, 160) as text, left(coalesce(antwort, fehler, ''), 240) as antwort,
            hermes_run_id, gestartet, beendet, dauer_ms
       from public.auftraege order by id desc limit $1`, [Math.min(Number(anzahl) || 30, 200)]);
  return r?.rows || [];
}

async function laufende() {
  const r = await buchen(`select id, quelle, left(text, 120) as text, gestartet from public.auftraege
                            where status in ('neu', 'laeuft') order by id desc limit 20`);
  return r?.rows || [];
}

// ---------------------------------------------------------------- Runs-API

// Den Ereignisstrom eines Laufs lesen, bis er endet. Liefert die Ausgabe.
async function ereignisseLesen(runId, { melde = null, fristMs = 30 * 60 * 1000 } = {}) {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), fristMs);
  uhr.unref?.();
  let text = "";
  try {
    const r = await fetch(`${basis()}/v1/runs/${runId}/events`, { headers: kopf(), signal: abbruch.signal });
    if (!r.ok || !r.body) throw new Error(`Ereignisstrom ${r.status}`);
    const leser = r.body.getReader();
    const dec = new TextDecoder();
    let rest = "";
    for (;;) {
      const { value, done } = await leser.read();
      if (done) break;
      rest += dec.decode(value, { stream: true });
      const zeilen = rest.split("\n");
      rest = zeilen.pop();
      for (const z of zeilen) {
        const ev = sseZeile(z);
        if (!ev) continue;
        const art = ev.event || ev.type || "";
        if (art === "message.delta" || art === "assistant.delta") {
          text += typeof ev.delta === "string" ? ev.delta : (ev.delta?.content || "");
          if (melde) { try { melde(text); } catch {} }
        } else if (art === "run.completed") {
          return typeof ev.output === "string" && ev.output ? ev.output : text;
        } else if (art === "run.failed") {
          throw new Error(String(ev.error || "Lauf gescheitert").slice(0, 300));
        } else if (art === "run.cancelled" || art === "run.interrupted") {
          throw new Error("Lauf abgebrochen");
        }
      }
    }
  } catch (e) {
    if (abbruch.signal.aborted) throw new Error(`Nach ${Math.round(fristMs / 1000)} s kein Ende`);
    // Strom weg, Lauf vielleicht trotzdem fertig: einmal nachsehen.
    const stand = await zustand(runId).catch(() => null);
    if (stand?.status === "completed") return stand.output || text;
    throw e;
  } finally { clearTimeout(uhr); }
  // Strom endete ohne Abschluss-Ereignis: den Zustand abfragen.
  const stand = await zustand(runId).catch(() => null);
  if (stand?.status === "completed") return stand.output || text;
  if (stand?.status === "failed") throw new Error("Lauf gescheitert");
  return text;
}

async function zustand(runId) {
  const r = await fetch(`${basis()}/v1/runs/${runId}`, { headers: kopf(), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Zustand ${r.status}`);
  return r.json();
}

async function stoppen(runId) {
  if (!runId) return false;
  const r = await fetch(`${basis()}/v1/runs/${runId}/stop`, { method: "POST", headers: kopf(), signal: AbortSignal.timeout(10000) }).catch(() => null);
  return Boolean(r && r.ok);
}

// Nachreichen per Telegram, wenn der Aufrufer nicht mehr wartet.
async function nachreichen(id, text) {
  try {
    await require("./telegram.js").push(`Auftrag #${id}: ${text}`.slice(0, 3500), { stimme: false });
  } catch (e) { console.error("Nachreichen:", String(e.message).slice(0, 120)); }
}

// DER Weg für einen Auftrag. Liefert { ok, reply, hint, ergebnis, auftragId, runId }.
//   quelle      web | telegram | stimme | cron | routine  (fürs Auftragsbuch)
//   sessionId   gleiche Kennung = Hermes kennt den Verlauf (Rückfragen, Freigaben)
//   melde(text) bekommt den bisherigen Antworttext, während Hermes arbeitet
//   fristMs     harte Obergrenze, danach wird der Lauf gestoppt (Standard 30 min)
//   spaetMelden Millisekunden, nach denen der Aufrufer nicht mehr wartet: kommt
//               das Ergebnis später, geht es von hier per Telegram raus.
async function auftrag(text, { quelle = "web", nutzerId = null, sessionId = null, melde = null,
  fristMs = 30 * 60 * 1000, spaetMelden = 0 } = {}) {
  if (!verfuegbar()) return { ok: false, hint: "HERMES_URL fehlt." };
  const gestartet = Date.now();
  const id = await anlegen({ quelle, nutzerId, text, sessionId });
  sprachlog.schreiben({ art: "hermes-auftrag", id, quelle, auftrag: String(text).slice(0, 120) });
  let runId = null;
  try {
    const r = await fetch(`${basis()}/v1/runs`, {
      method: "POST", headers: kopf(),
      body: JSON.stringify({ input: String(text), ...(sessionId ? { session_id: String(sessionId) } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Hermes ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    runId = (await r.json()).run_id;
    if (!runId) throw new Error("Hermes gab keine Lauf-Kennung zurück.");
    await buchen(`update public.auftraege set hermes_run_id = $2, status = 'laeuft' where id = $1`, [id, runId]);

    const output = await ereignisseLesen(runId, { melde, fristMs }).catch(async (e) => {
      if (/kein Ende/.test(e.message)) await stoppen(runId);
      throw e;
    });
    const ergebnis = ergebnisLesen(output);
    const reply = antwortText(ergebnis, output);
    const freigabe = Array.isArray(ergebnis?.freigabe_noetig) && ergebnis.freigabe_noetig.length > 0;
    const dauerMs = Date.now() - gestartet;
    await abschliessen(id, { status: freigabe ? "freigabe" : "fertig", ergebnis, antwort: reply, dauerMs });
    sprachlog.schreiben({ art: "hermes-auftrag", id, ok: true, dauerMs, freigabe, runId });
    if (spaetMelden && dauerMs > spaetMelden) await nachreichen(id, reply);
    return { ok: true, reply, ergebnis, auftragId: id, runId, dauerMs, freigabe };
  } catch (e) {
    const dauerMs = Date.now() - gestartet;
    const hint = String(e.message || e).slice(0, 300);
    await abschliessen(id, { status: "fehler", fehler: hint, dauerMs });
    sprachlog.schreiben({ art: "hermes-auftrag", id, ok: false, dauerMs, fehler: hint, runId });
    if (spaetMelden && dauerMs > spaetMelden) await nachreichen(id, "gescheitert: " + hint);
    return { ok: false, hint, auftragId: id, runId, dauerMs };
  }
}

// Anstoßen ohne zu warten. Fehler landen im Auftragsbuch und im Protokoll,
// nie mehr in einem leeren .catch.
function feuern(text, opts = {}) {
  const p = auftrag(text, { spaetMelden: 1, ...opts });
  p.catch((e) => console.error("Hermes-Auftrag:", String(e.message).slice(0, 160)));
  return p;
}

async function gesund() {
  if (!verfuegbar()) return { online: false };
  try {
    const r = await fetch(`${basis()}/health`, { signal: AbortSignal.timeout(4000) });
    let details = null; try { details = await r.json(); } catch {}
    return { online: r.ok, details };
  } catch { return { online: false }; }
}

module.exports = { auftrag, feuern, liste, laufende, stoppen, gesund, verfuegbar, basis,
  sseZeile, ergebnisLesen, antwortText };
