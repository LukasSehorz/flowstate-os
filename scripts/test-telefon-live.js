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

// Misst ZWEI Zeiten getrennt, und das ist der Punkt:
//
//   erstesWort — bis das erste hoerbare Stueck kommt. Das ist die Stille in der
//                Leitung, und nur die merkt der Anrufer.
//   gesamt     — bis alles durch ist. Gut fuers Protokoll, aber der Anrufer
//                hoert da laengst zu.
//
// Der erste Entwurf mass nur "gesamt" und meldete 6,8 s, als waere das die
// Wartezeit. Das war irrefuehrend: Gesprochen wurde da schon lange.
async function ruf(koerper, ausweis) {
  const kopf = { "content-type": "application/json", accept: "text/event-stream" };
  if (ausweis) kopf.authorization = "Bearer " + ausweis;
  const los = Date.now();
  const r = await fetch(BASIS + PFAD, {
    method: "POST", headers: kopf, body: JSON.stringify(koerper),
    redirect: "manual", signal: AbortSignal.timeout(90000),
  });
  const typ = r.headers.get("content-type") || "";
  if (!r.body || r.status !== 200) {
    return { status: r.status, typ, text: await r.text(), erstesWort: 0, gesamt: Date.now() - los };
  }
  const leser = r.body.getReader();
  const dek = new TextDecoder();
  let text = "", erstesWort = 0;
  while (true) {
    const { done, value } = await leser.read();
    if (done) break;
    const teil = dek.decode(value, { stream: true });
    text += teil;
    // Erst wenn wirklich INHALT kommt, nicht beim ersten leeren Stueck.
    if (!erstesWort && /"content":"[^"]/.test(teil)) erstesWort = Date.now() - los;
  }
  return { status: r.status, typ, text, erstesWort, gesamt: Date.now() - los };
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
  const r = await ruf(FRAGE("Wie viele offene Aufgaben habe ich?"), GEHEIM);

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

  console.log(`\n  Stille in der Leitung: ${(r.erstesWort / 1000).toFixed(1)}s`);
  console.log(`  Antwort komplett nach: ${(r.gesamt / 1000).toFixed(1)}s`);
  console.log(`  „${gesagt.slice(0, 200)}"`);
  // Nur die Stille zaehlt. Was danach kommt, hoert der Anrufer schon.
  if (r.erstesWort > 2500) console.log(`  ⚠  ${(r.erstesWort / 1000).toFixed(1)}s Stille ist am Telefon zu lang.`);
  else if (r.erstesWort > 1500) console.log(`  ·  ${(r.erstesWort / 1000).toFixed(1)}s Stille — spuerbar, aber tragbar.`);

  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exitCode = fehler ? 1 : 0;
})().catch((e) => { console.error("FEHLER:", e.message); process.exitCode = 1; });
