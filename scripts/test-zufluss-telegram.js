// Testet die Telegram-Verdichtung (P3.3) — OHNE Netz und OHNE echten Vault:
// eigener Vault im Temp-Ordner, schnell.frage gestubbt.
//
// Die drei Fallen, die hier abgesichert werden:
//   1. Idempotenz — ohne Marker stehen die Fakten nach jedem Lauf erneut drin.
//   2. Leere Notizen — findet das Modell nichts, darf KEINE Datei entstehen.
//   3. Modellausfall — muss ok:false liefern, nicht den Server mitnehmen.
//
// Aufruf: node scripts/test-zufluss-telegram.js

const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tg-verdicht-"));
process.env.VAULT_PATH = TMP;
process.env.VAULT_SCHREIB = "chronik,eingang";
process.env.TELEGRAM_BOT_TOKEN = "test:token";   // Kanal gilt als konfiguriert
process.env.SCHNELL_API_KEY = "test";            // Modell "erreichbar" (wird gestubbt)

const schnell = require("../lib/schnell.js");
const zufluss = require("../lib/zufluss-telegram.js");

// --- Stub: kein Netz. antwort kann ein Text oder ein Error sein. -------------
let antwort = "";
const aufrufe = [];
schnell.frage = async (system, nutzer, opts) => {
  aufrufe.push({ system, nutzer, opts });
  if (antwort instanceof Error) throw antwort;
  return antwort;
};

const tag = (versatz = 0) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() - versatz * 86400000));
const HEUTE = tag(0), GESTERN = tag(1);

const quellDatei = (d) => path.join(TMP, "eingang", "telegram", d + ".md");
const zielDatei = (d) => path.join(TMP, "eingang", "erkenntnisse", d + ".md");
const lies = (p) => { try { return fs.readFileSync(p, "utf-8"); } catch { return ""; } };
const treffer = (text, stueck) => text.split(stueck).length - 1;

function gespraech(datei, inhalt) {
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei, inhalt, "utf-8");
}

let fehler = 0;
function pruefe(name, wahr, hinweis) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) { fehler++; if (hinweis) console.log("      " + hinweis); }
}

// So schreibt lib/telegram.js (insGehirn) das Rohprotokoll — inklusive Geplauder.
const PROTOKOLL =
  `---\ntyp: telegram\ndatum: ${HEUTE}\n---\n\n# Telegram · heute\n\n` +
  "**Lukas** · 09:12\nMorgen!\n\n" +
  "**Alexandra** · 09:12\nGuten Morgen — wie kann ich helfen? 😊\n\n" +
  "**Lukas** · 09:15\nWir machen den Preis für das Ads-Paket auf 1.900 Euro im Monat fest.\n\n" +
  "**Alexandra** · 09:15\nNotiert. Soll ich Jannik Bescheid geben?\n\n" +
  "**Lukas** · 09:16\nJa, und schick Krotzer & Eisele bis Freitag das Angebot.\n\n";

// So antwortet das Modell (letzte Zeile ist Geplauder und muss rausfallen).
const ANTWORT_1 =
  "Entscheidung: Preis für das Ads-Paket steht bei 1.900 EUR pro Monat fest.\n" +
  "Aufgabe: Jannik über den neuen Ads-Paket-Preis informieren.\n" +
  "Aufgabe: Angebot an Krotzer & Eisele bis Freitag verschicken.\n" +
  "Idee: Ads-Paket später als Staffelpreis anbieten.\n" +
  "Geplauder: Lukas hat guten Morgen gewünscht.\n";

(async () => {
  // --- 1. Fakten werden geschrieben ---------------------------------------
  gespraech(quellDatei(HEUTE), PROTOKOLL);
  antwort = ANTWORT_1;
  const r1 = await zufluss.verdichte();
  const d1 = lies(zielDatei(HEUTE));
  pruefe("Lauf 1: ok mit neuen Fakten", r1.ok && r1.neu === 4, JSON.stringify(r1));
  pruefe("Tagesnotiz in eingang/erkenntnisse angelegt", Boolean(d1));
  pruefe("Entscheidung steht drin", /1\.900 EUR pro Monat/.test(d1));
  pruefe("Aufgaben stehen als eigene Rubrik drin", /\*\*Aufgaben\*\*/.test(d1) && /Krotzer & Eisele/.test(d1));
  pruefe("Idee steht drin", /\*\*Ideen\*\*/.test(d1) && /Staffelpreis/.test(d1));
  pruefe("Geplauder fliegt raus (keine Begrüßung im Vault)", !/Morgen gewünscht/.test(d1) && !/Guten Morgen/.test(d1));
  pruefe("Kein Rohprotokoll — die Chatzeilen selbst fehlen", !/Soll ich Jannik Bescheid geben/.test(d1));
  pruefe("Idempotenz-Marker gesetzt", new RegExp("<!-- id:telegram-" + HEUTE + "-5 -->").test(d1));
  pruefe("Quelle bleibt unangetastet", lies(quellDatei(HEUTE)) === PROTOKOLL);

  // Das guenstige Modell — keine Denk-Spur fuer eine taegliche Routine.
  pruefe("Nutzt das günstige Modell (Haiku)", aufrufe[0].opts.model === "claude-haiku-4-5",
    "model=" + String(aufrufe[0].opts.model));
  pruefe("Prompt verbietet Geplauder/Zusammenfassung ausdrücklich",
    /VERBOTEN/.test(aufrufe[0].system) && /Zusammenfassung/i.test(aufrufe[0].system));

  // --- 2. Zweiter Lauf schreibt NICHTS doppelt ----------------------------
  const vorher = lies(zielDatei(HEUTE));
  const rufeVorher = aufrufe.length;
  const r2 = await zufluss.verdichte();
  const nachher = lies(zielDatei(HEUTE));
  pruefe("Lauf 2: nichts Neues", r2.ok && r2.neu === 0, JSON.stringify(r2));
  pruefe("Lauf 2: Datei unverändert", vorher === nachher);
  pruefe("Lauf 2: Fakt steht genau EINMAL da", treffer(nachher, "1.900 EUR pro Monat") === 1);
  pruefe("Lauf 2: gar kein Modellaufruf nötig", aufrufe.length === rufeVorher);

  // --- 3. Gespräch geht weiter: nur das Neue wird verdichtet --------------
  fs.appendFileSync(quellDatei(HEUTE),
    "**Lukas** · 17:40\nJannik übernimmt ab August die Ads-Betreuung.\n\n", "utf-8");
  antwort = "Fakt: Jannik vom Hofe übernimmt ab August 2026 die Ads-Betreuung.\n";
  const r3 = await zufluss.verdichte();
  const d3 = lies(zielDatei(HEUTE));
  pruefe("Nachschlag: nur der neue Fakt kommt dazu", r3.ok && r3.neu === 1, JSON.stringify(r3));
  pruefe("Nachschlag: neuer Fakt steht drin", /ab August 2026 die Ads-Betreuung/.test(d3));
  pruefe("Nachschlag: alter Fakt bleibt einmalig", treffer(d3, "1.900 EUR pro Monat") === 1);
  pruefe("Nachschlag: nur der neue Beitrag ging ans Modell",
    !/Morgen!/.test(aufrufe[aufrufe.length - 1].nutzer) && /Ads-Betreuung/.test(aufrufe[aufrufe.length - 1].nutzer));

  // --- 4. Leeres Modell-Ergebnis erzeugt KEINE Datei ----------------------
  gespraech(quellDatei(GESTERN),
    `---\ntyp: telegram\ndatum: ${GESTERN}\n---\n\n# Telegram\n\n` +
    "**Lukas** · 20:01\nAlles gut bei dir?\n\n**Alexandra** · 20:01\nJa klar, danke! 😊\n\n");
  antwort = "NICHTS";
  const r4 = await zufluss.verdichte({ tage: 2 });
  pruefe("Leeres Ergebnis: ok, aber neu = 0", r4.ok && r4.neu === 0, JSON.stringify(r4));
  pruefe("Leeres Ergebnis: keine Tagesnotiz angelegt", !fs.existsSync(zielDatei(GESTERN)));

  // --- 5. Modellausfall -> ok:false statt Absturz -------------------------
  fs.appendFileSync(quellDatei(HEUTE),
    "**Lukas** · 18:05\nDas Angebot für Sachbearbeiter-Web geht auf 4.200 Euro.\n\n", "utf-8");
  const vorAusfall = lies(zielDatei(HEUTE));
  antwort = new Error("Anthropic 529: overloaded_error");
  // tage:1 — nur heute, damit der Stub (der jeden Tag gleich beantwortet) das
  // Ergebnis nicht verwaessert.
  let geflogen = null, r5;
  try { r5 = await zufluss.verdichte({ tage: 1 }); } catch (e) { geflogen = e; }
  pruefe("Modellausfall: wirft nicht", geflogen === null, String(geflogen && geflogen.message));
  pruefe("Modellausfall: ok:false mit Grund", Boolean(r5 && r5.ok === false && r5.grund), JSON.stringify(r5));
  pruefe("Modellausfall: nichts halb Geschriebenes", lies(zielDatei(HEUTE)) === vorAusfall);

  // Nach dem Ausfall wird der Tag beim naechsten Lauf erneut versucht.
  antwort = "Entscheidung: Angebot Sachbearbeiter-Webseite liegt bei 4.200 EUR.\n";
  const r6 = await zufluss.verdichte({ tage: 1 });
  pruefe("Nach dem Ausfall wird nachgeholt", r6.ok && r6.neu === 1, JSON.stringify(r6));
  pruefe("Nachgeholter Fakt steht drin", /4\.200 EUR/.test(lies(zielDatei(HEUTE))));

  // --- 6. Nicht konfigurierter Kanal --------------------------------------
  delete process.env.TELEGRAM_BOT_TOKEN;
  pruefe("Ohne Bot-Token: verfuegbar() ist false", zufluss.verfuegbar() === false);
  const r7 = await zufluss.verdichte();
  pruefe("Ohne Bot-Token: ok:false mit Grund", r7.ok === false && /konfiguriert/i.test(r7.grund), JSON.stringify(r7));
  process.env.TELEGRAM_BOT_TOKEN = "test:token";
  pruefe("Mit Bot-Token: verfuegbar() ist true", zufluss.verfuegbar() === true);

  // --- 7. Kein Protokoll vorhanden ---------------------------------------
  fs.rmSync(path.join(TMP, "eingang", "telegram"), { recursive: true, force: true });
  antwort = "Entscheidung: darf nie gefragt werden.\n";
  const rufeVorLeer = aufrufe.length;
  const r8 = await zufluss.verdichte();
  pruefe("Ohne Protokoll: ok, neu = 0, kein Modellaufruf",
    r8.ok && r8.neu === 0 && aufrufe.length === rufeVorLeer, JSON.stringify(r8));

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("❌ Test selbst geflogen:", e); process.exit(1); });
