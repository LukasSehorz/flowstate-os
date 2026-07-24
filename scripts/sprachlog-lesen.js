// Sprachprotokoll lesbar anzeigen — was hat Alexandra verstanden, wie lange
// hat es gedauert, was ging schief.
//
// Aufruf (auf dem Server):
//   docker exec flowstate-dashboard node scripts/sprachlog-lesen.js
//   docker exec flowstate-dashboard node scripts/sprachlog-lesen.js 2026-07-24
//   docker exec flowstate-dashboard node scripts/sprachlog-lesen.js --fehler
//
// Ohne Datum: der heutige Tag. --fehler zeigt nur Eintraege, bei denen etwas
// schieflief (Reserve gesprungen, kein JSON, Auftrag fehlgeschlagen).

const fs = require("fs");
const path = require("path");

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, "..", "data");
const LOG_PFAD = path.join(DATA_PATH, "sprachlog");

const args = process.argv.slice(2);
const nurFehler = args.includes("--fehler");
const datum = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ||
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

const datei = path.join(LOG_PFAD, datum + ".jsonl");
if (!fs.existsSync(datei)) {
  const da = fs.existsSync(LOG_PFAD) ? fs.readdirSync(LOG_PFAD).join(", ") : "(noch keine)";
  console.log(`Kein Protokoll fuer ${datum}.\nVorhanden: ${da}`);
  process.exit(0);
}

const zeilen = fs.readFileSync(datei, "utf-8").trim().split("\n")
  .map((z) => { try { return JSON.parse(z); } catch { return null; } })
  .filter(Boolean);

const uhr = (iso) => new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const sek = (ms) => (ms == null ? "?" : (ms / 1000).toFixed(1) + "s");

function istFehler(e) {
  if (e.fehler) return true;
  if (e.art === "frage") return e.verstehen?.reserve || e.verstehen?.parse !== "ok" || e.stand?.frisch === false;
  if (e.art === "auftrag") return e.ok === false;
  if (e.art === "stimme") return e.ok === false;
  return false;
}

let zaehler = { frage: 0, reserve: 0, keinJson: 0, standAlt: 0, auftragFehler: 0, erzaehlt: 0, streamAus: 0 };
const dauern = [];

// Gestartete Auftraege, die nie fertig wurden — das faellt sonst niemandem auf.
const gestartet = new Map(), beendet = new Set();
for (const e of zeilen) {
  if (e.art === "auftrag-start") gestartet.set(e.id, e);
  if (e.art === "auftrag") beendet.add(e.id);
}
const haengen = [...gestartet.entries()].filter(([id]) => !beendet.has(id));

for (const e of zeilen) {
  if (e.art === "erzaehlspur" && e.satz) zaehler.erzaehlt++;
  if (e.art === "hermes-stream" && e.moeglich === false) zaehler.streamAus++;
  if (e.art === "frage") {
    zaehler.frage++;
    if (e.verstehen?.reserve) zaehler.reserve++;
    if (e.verstehen?.parse && e.verstehen.parse !== "ok") zaehler.keinJson++;
    if (e.stand?.frisch === false) zaehler.standAlt++;
    if (e.verstehen?.dauerMs) dauern.push(e.verstehen.dauerMs);
  }
  if (e.art === "auftrag" && e.ok === false) zaehler.auftragFehler++;

  if (nurFehler && !istFehler(e)) continue;

  if (e.art === "frage") {
    const v = e.verstehen || {};
    console.log(`\n[${uhr(e.zeit)}] DU: ${e.frage}`);
    console.log(`   ALEXANDRA: ${e.gesagt || "(nichts gesagt)"}`);
    const marker = [];
    if (v.reserve) marker.push("RESERVE eingesprungen");
    if (v.parse && v.parse !== "ok") marker.push("Antwort war " + v.parse);
    if (e.stand?.frisch === false) marker.push("Stand NICHT frisch");
    console.log(`   verstanden von ${v.modell || "?"} in ${sek(v.dauerMs)} · gesamt ${sek(e.gesamtMs)}` +
      (e.aktionen?.length ? ` · Aktionen: ${e.aktionen.join(", ")}` : " · keine Aktion") +
      (marker.length ? `\n   ⚠️  ${marker.join(" | ")}` : ""));
    if (v.fehler) console.log(`   Fehler: ${v.fehler}`);
  } else if (e.art === "auftrag") {
    console.log(`   └─ Auftrag "${e.was}" ${e.ok ? "fertig" : "FEHLGESCHLAGEN"} nach ${sek(e.dauerMs)}${e.hint ? " — " + e.hint : ""}`);
    if (e.antwort) console.log(`        ANTWORT: ${e.antwort.replace(/\s+/g, " ").slice(0, 240)}`);
  } else if (e.art === "schnellsuche") {
    console.log(`   └─ SCHNELLSUCHE ${e.genutzt ? "genutzt" : "NICHT genutzt"} (${e.titel || "?"}, ${sek(e.dauerMs)})${e.grund ? " — " + e.grund : ""}`);
  } else if (e.art === "zusage-verworfen") {
    console.log(`   └─ ZUSAGE VERWORFEN (${e.grund}): „${e.zusage}“`);
  } else if (e.art === "zusage") {
    console.log(`[${uhr(e.zeit)}] Blitz-Zusage (${sek(e.dauerMs)}): "${e.zusage}"${e.fehler ? " — FEHLER: " + e.fehler : ""}`);
  } else if (e.art === "stimme" && (!e.ok || !nurFehler)) {
    console.log(`   └─ Stimme ${e.ok ? "ok" : "FEHLGESCHLAGEN"} (${e.zeichen} Zeichen, ${sek(e.dauerMs)})${e.fehler ? " — " + e.fehler : ""}`);
  } else if (e.art === "wa-freigabe") {
    console.log(`   └─ WhatsApp an ${e.an}: ${e.ausgang}${e.grund ? " — " + e.grund : ""}`);
  } else if (e.art === "erzaehlspur") {
    console.log(e.satz
      ? `   └─ ERZAEHLT${e.schritt ? " (Schritt " + e.schritt + ")" : ""}: „${e.satz}“`
      : `   └─ ERZAEHLSPUR: kein Satz${e.fehler ? " — " + e.fehler : ""}`);
  } else if (e.art === "plan") {
    console.log((e.schritte || []).length
      ? `   └─ VORGEHENSPLAN (${e.schritte.length} Schritte):\n` + e.schritte.map((s) => `        · ${s}`).join("\n")
      : `   └─ VORGEHENSPLAN: keiner${e.fehler ? " — " + e.fehler : ""}`);
  } else if (e.art === "hermes-stream") {
    console.log(`   └─ HERMES-STREAMING ${e.moeglich === false ? "NICHT MOEGLICH" : "ok (erste Daten nach " + sek(e.ersteDatenMs) + ")"}${e.grund ? " — " + e.grund : ""}`);
  } else if (e.art === "auftrag-start") {
    console.log(`   └─ Auftrag "${e.was}" GESTARTET (${e.id}): ${String(e.auftrag || "").slice(0, 80)}`);
  } else if (e.art === "kalender-frisch") {
    console.log(`   └─ Kalender nach Auftrag ${e.nach} neu eingelesen`);
  } else {
    // Auffangnetz: lieber roh anzeigen als verschlucken. Genau das ist am
    // 24.07. passiert — neue Eintragsarten fielen still hinten runter und
    // die Suche im Protokoll fand nichts, obwohl alles drinstand.
    const { zeit, art, ...rest } = e;
    console.log(`   └─ ${String(art || "?").toUpperCase()}: ${JSON.stringify(rest).slice(0, 300)}`);
  }
}

const schnitt = dauern.length ? Math.round(dauern.reduce((a, b) => a + b, 0) / dauern.length) : 0;
console.log(`\n───────────────────────────────────────────────`);
console.log(`${datum}: ${zaehler.frage} Fragen · Verstehen im Schnitt ${sek(schnitt)}`);
console.log(`Reserve eingesprungen: ${zaehler.reserve} · kein sauberes JSON: ${zaehler.keinJson} · ` +
  `Stand nicht frisch: ${zaehler.standAlt} · Auftraege fehlgeschlagen: ${zaehler.auftragFehler}`);
console.log(`Erzaehlspur: ${zaehler.erzaehlt} Zwischensaetze` +
  (zaehler.streamAus ? ` · Hermes-Streaming ${zaehler.streamAus}x nicht moeglich` : ""));
if (haengen.length) {
  console.log(`\n⚠️  ${haengen.length} Auftrag/Auftraege gestartet, aber NIE fertig geworden:`);
  for (const [id, e] of haengen) console.log(`   ${uhr(e.zeit)} "${e.was}" (${id}): ${String(e.auftrag || "").slice(0, 70)}`);
}
