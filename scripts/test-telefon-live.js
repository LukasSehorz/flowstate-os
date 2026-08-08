// Prueft den Telefon-Endpunkt gegen den LAUFENDEN Server, von aussen.
//
// Warum es diesen Test zusaetzlich gibt (07.08.2026):
//
// scripts/test-telefon.js prueft die Route mit einer Attrappe statt Express.
// Sie hat 25 Faelle bestanden — und der erste echte Aufruf von aussen bekam
// trotzdem eine Umleitung zur Anmeldeseite. Grund: Der Torwaechter des
// Dashboards stand VOR der Telefonroute und fing sie ab. Eine Attrappe kann das
// nicht sehen; sie kennt die Reihenfolge der Middleware nicht.
//
// Genau das prueft dieser Test: nicht die Logik, sondern ob der Endpunkt am
// richtigen Platz haengt und von aussen erreichbar ist.
//
// Aufruf (auf dem Server oder mit gesetzter Adresse):
//   TELEFON_URL=https://… TELEFON_SECRET=… node scripts/test-telefon-live.js

const BASIS = process.env.TELEFON_URL || process.env.SELF_URL || "http://127.0.0.1:3000";
const GEHEIM = process.env.TELEFON_SECRET || "";
const PFAD = "/telefon/v1/chat/completions";

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

async function ruf(koerper, ausweis) {
  const kopf = { "content-type": "application/json", accept: "text/event-stream" };
  if (ausweis) kopf.authorization = "Bearer " + ausweis;
  const r = await fetch(BASIS + PFAD, {
    method: "POST", headers: kopf, body: JSON.stringify(koerper),
    redirect: "manual", signal: AbortSignal.timeout(90000),
  });
  return { status: r.status, typ: r.headers.get("content-type") || "", text: await r.text() };
}

const FRAGE = (t) => ({ model: "alexandra", stream: true,
  messages: [{ role: "system", content: "x" }, { role: "user", content: t }] });

(async () => {
  if (!GEHEIM) { console.log("TELEFON_SECRET nicht gesetzt — nichts zu pruefen."); process.exit(0); }
  console.log(`Gegen ${BASIS}${PFAD}\n`);

  // --- DER FALL, DEN DIE ATTRAPPE NICHT SEHEN KANN --------------------------
  //
  // Steht die Route hinter dem Torwaechter, kommt hier eine 302 auf /login —
  // und ElevenLabs bekaeme eine HTML-Anmeldeseite statt einer Antwort.
  const ohne = await ruf(FRAGE("Hallo"), "");
  pruefe("Ohne Ausweis kommt 401, KEINE Umleitung zur Anmeldeseite",
    ohne.status === 401, `Status ${ohne.status}${ohne.status === 302 ? " — die Route haengt hinter dem Torwaechter!" : ""}`);
  pruefe("Und keine HTML-Seite", !/<html|Redirecting to \/login/i.test(ohne.text), ohne.text.slice(0, 120));

  const falsch = await ruf(FRAGE("Hallo"), GEHEIM.slice(0, -2) + "xx");
  pruefe("Falscher Ausweis wird abgewiesen", falsch.status === 401, `Status ${falsch.status}`);

  // --- Der echte Weg ---------------------------------------------------------
  const los = Date.now();
  const r = await ruf(FRAGE("Wie viele offene Aufgaben habe ich?"), GEHEIM);
  const ms = Date.now() - los;

  pruefe("Mit Ausweis antwortet der Endpunkt", r.status === 200, `Status ${r.status}: ${r.text.slice(0, 150)}`);
  pruefe("Als Ereignisstrom", /text\/event-stream/.test(r.typ), r.typ);
  pruefe("Der Strom endet mit [DONE]", /data: \[DONE\]/.test(r.text),
    "Ohne [DONE] wartet die Leitung, bis sie abbricht.");

  const bloecke = r.text.split("\n\n").filter((z) => z.startsWith("data: ") && !z.includes("[DONE]"))
    .map((z) => { try { return JSON.parse(z.slice(6)); } catch { return null; } }).filter(Boolean);
  pruefe("Es kamen Stuecke im ChatCompletionChunk-Format", bloecke.length > 0
    && bloecke.every((b) => b.object === "chat.completion.chunk"), `${bloecke.length} Stuecke`);
  pruefe("Genau eines schliesst ab",
    bloecke.filter((b) => b.choices?.[0]?.finish_reason === "stop").length === 1);

  const gesagt = bloecke.map((b) => b.choices?.[0]?.delta?.content || "").join("").trim();
  pruefe("Alexandra hat wirklich geantwortet", gesagt.length > 5, JSON.stringify(gesagt));
  // Kein Platzhalter, keine Ausrede — das waere ein stiller Fehlschlag.
  pruefe("Und zwar nicht mit einer Notfallmeldung",
    !/nicht verstanden|schiefgelaufen/i.test(gesagt), gesagt);

  console.log(`\n  Antwort nach ${(ms / 1000).toFixed(1)}s: „${gesagt.slice(0, 200)}"`);
  // Am Telefon ist Wartezeit anders zu bewerten als im Chat: Stille in der
  // Leitung wirkt doppelt so lang.
  if (ms > 6000) console.log(`  ⚠  ${(ms / 1000).toFixed(1)}s ist am Telefon spuerbar lang.`);

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exitCode = fehler ? 1 : 0;
})().catch((e) => { console.error("FEHLER:", e.message); process.exitCode = 1; });
