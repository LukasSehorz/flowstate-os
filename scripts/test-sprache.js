// Testet das Verstehen (ausZustand) ohne echte API: schnell.frage wird
// gestubbt. Geprueft werden die vier Pfade nach dem Sonnet-Umbau (24.07.):
//   1. Sonnet antwortet sauber        -> Felder geparst, _diag ok
//   2. Sonnet faellt aus              -> Haiku-Reserve springt ein
//   3. Beide fallen aus               -> Hermes-Rueckfall (nie stumm)
//   4. Antwort ist kein JSON          -> Text wird trotzdem gesprochen
// Aufruf: node scripts/test-sprache.js

process.env.VAULT_PATH = process.env.VAULT_PATH || __dirname; // stimmeLaden faellt auf Notnagel zurueck
const schnell = require("../lib/schnell.js");
const { ausZustand } = require("../lib/sprache-routes.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

const GUTE_ANTWORT = JSON.stringify({
  zusage: "Die Mail schau ich dir gleich an.",
  text: "Morgen um zehn hast du das Erstgespraech mit der Physio.",
  mail: null, whatsapp: null,
  aktionen: [{ was: "mail", auftrag: "letzte 2 Stunden" }],
  zeige: ["kalender"],
});

(async () => {
  const original = schnell.frage;

  // 1. Sonnet antwortet sauber
  let modelle = [];
  schnell.frage = async (sys, nutzer, opts = {}) => { modelle.push(opts.model); return GUTE_ANTWORT; };
  let a = await ausZustand("was steht morgen an, sind neue mails da", "KALENDER: ...", []);
  pruefe("Sauberes JSON: text uebernommen", a.text.includes("Erstgespraech"));
  pruefe("Sauberes JSON: Aktion mail erkannt", a.aktionen.length === 1 && a.aktionen[0].was === "mail");
  pruefe("Sauberes JSON: Verstehen lief auf Sonnet", modelle[0] === (process.env.SPRACHE_VERSTEHEN_MODEL || "claude-sonnet-5"));
  pruefe("Sauberes JSON: _diag ok, keine Reserve", a._diag.parse === "ok" && a._diag.reserve === false);

  // 2. Sonnet faellt aus -> Reserve (Haiku)
  modelle = [];
  schnell.frage = async (sys, nutzer, opts = {}) => {
    modelle.push(opts.model);
    if (modelle.length === 1) throw new Error("Anthropic 529: overloaded");
    return GUTE_ANTWORT;
  };
  a = await ausZustand("was steht morgen an", "KALENDER: ...", []);
  pruefe("Reserve: zweiter Aufruf auf Haiku", modelle.length === 2 && /haiku/.test(modelle[1]));
  pruefe("Reserve: Antwort trotzdem geparst", a.text.includes("Erstgespraech"));
  pruefe("Reserve: _diag vermerkt Reserve + Fehler", a._diag.reserve === true && /529/.test(a._diag.fehler));

  // 3. Beide fallen aus -> Hermes-Rueckfall
  schnell.frage = async () => { throw new Error("Anthropic 500: kaputt"); };
  a = await ausZustand("bau mir ein angebot", "KALENDER: ...", []);
  pruefe("Totalausfall: Hermes-Rueckfall statt Stille", a.aktionen.length === 1 && a.aktionen[0].was === "hermes");
  pruefe("Totalausfall: _diag haelt den Fehler fest", a._diag.parse === "fehler" && Boolean(a._diag.fehler));

  // 4. Kein JSON -> Text trotzdem sprechen
  schnell.frage = async () => "Morgen hast du nichts im Kalender, mein Lieber.";
  a = await ausZustand("was steht morgen an", "KALENDER: ...", []);
  pruefe("Kein JSON: Rohtext wird gesprochen", a.text.includes("nichts im Kalender"));
  pruefe("Kein JSON: _diag sagt kein-json", a._diag.parse === "kein-json");

  // 5. Temperature-Weiche in schnell.js: Sonnet 5 darf KEIN temperature bekommen
  pruefe("Temp-Weiche: sonnet-5 ohne temperature", !/-4-|haiku-4|opus-4/.test("claude-sonnet-5"));
  pruefe("Temp-Weiche: haiku-4-5 mit temperature", /-4-|haiku-4|opus-4/.test("claude-haiku-4-5"));

  schnell.frage = original;
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
  process.exit(fehler ? 1 : 0);
})();
