// Testet den Telefon-Endpunkt gegen den Vertrag, den ElevenLabs erwartet.
//
// Warum das streng geprueft wird: Wenn hier etwas nicht stimmt, merkt man es
// nicht an einer Fehlermeldung, sondern daran, dass Jarvis am Telefon schweigt
// oder mitten im Satz abbricht — und zwar erst beim Dreh, vor laufender Kamera.
//
// Zwei Dinge stehen im Mittelpunkt:
//
//   1. DAS FORMAT. ElevenLabs erwartet Server-Sent Events mit
//      ChatCompletionChunk-Objekten und einem abschliessenden [DONE]. Fehlt das
//      [DONE], wartet die Leitung, bis sie abbricht.
//   2. DAS GEHEIMNIS. Der Endpunkt steht offen im Netz und kann WhatsApp
//      verschicken und Rechnungen anlegen. Ohne Ausweis darf nichts durch.
//
// Aufruf: node scripts/test-telefon.js

const http = require("http");

process.env.TELEFON_SECRET = "test-geheim";
process.env.SELF_URL = "http://127.0.0.1:39117";
process.env.DASHBOARD_PASSWORD = "egal";

let fehler = 0;
function pruefe(name, wahr, zusatz) {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
}

// --- Eine Attrappe der Sprachroute ------------------------------------------
//
// Sie stroemt zwei Saetze und ein Schlussereignis — genau wie die echte.
let gefragt = [];
let zuruecksetzen = 0;
const attrappe = http.createServer((req, res) => {
  if (req.url.startsWith("/login")) {
    res.writeHead(302, { "set-cookie": "connect.sid=test; Path=/", location: "/" });
    return res.end();
  }
  if (req.url.startsWith("/intern/dienst-anmelden")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }
  if (req.url.startsWith("/api/sprache/neu")) {
    zuruecksetzen++;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }
  if (req.url.startsWith("/api/sprache/frage")) {
    let koerper = "";
    req.on("data", (c) => (koerper += c));
    req.on("end", () => {
      gefragt.push({ text: JSON.parse(koerper || "{}").text, keks: req.headers.cookie || "" });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ typ: "satz", text: "Klar." })}\n\n`);
      res.write(`data: ${JSON.stringify({ typ: "satz", text: "Die WhatsApp ist raus." })}\n\n`);
      res.write(`data: ${JSON.stringify({ typ: "fertig", ok: true, sprich: "Das Angebot kommt gleich auf Telegram." })}\n\n`);
      res.end();
    });
    return;
  }
  res.writeHead(404); res.end();
});

// --- Ein Express-Ersatz, gerade gross genug fuer routen() -------------------
const strecken = {};
const app = { post: (pfad, fn) => { strecken[pfad] = fn; } };

const telefon = require("../lib/telefon.js");
telefon.routen(app);

// Ruft den Endpunkt auf und sammelt, was er stroemt.
function ruf(koerper, ausweis = "test-geheim") {
  return new Promise((fertig) => {
    let stuecke = [], status = 200, kopf = {};
    const res = {
      writeHead(s, h) { status = s; kopf = h || {}; return res; },
      status(s) { status = s; return { json: (o) => fertig({ status, json: o, stuecke: [] }) }; },
      write(t) { stuecke.push(t); return true; },
      end(t) { if (t) stuecke.push(t); fertig({ status, kopf, stuecke, roh: stuecke.join("") }); },
      json(o) { fertig({ status, json: o, stuecke: [] }); },
    };
    strecken["/telefon/v1/chat/completions"](
      { headers: { authorization: "Bearer " + ausweis }, body: koerper }, res);
  });
}

const NACHRICHT = (...texte) => ({
  model: "alexandra", stream: true,
  messages: [{ role: "system", content: "…" }, ...texte.map((t) => ({ role: "user", content: t }))],
});

(async () => {
  await new Promise((r) => attrappe.listen(39117, r));
  await telefon.anmelden();

  // --- Ohne Ausweis geht nichts ---------------------------------------------
  //
  // Der wichtigste Fall. Der Endpunkt steht offen im Netz.
  for (const [ausweis, was] of [["", "ohne Geheimnis"], ["falsch", "mit falschem Geheimnis"],
    ["test-gehei", "mit fast richtigem Geheimnis"]]) {
    const r = await ruf(NACHRICHT("Hallo"), ausweis);
    pruefe(`Abgewiesen ${was}`, r.status === 401, `Status ${r.status}`);
  }
  pruefe("Dabei wurde nichts an Alexandra weitergereicht", gefragt.length === 0, JSON.stringify(gefragt));

  // --- Der normale Weg -------------------------------------------------------
  gefragt = [];
  const r = await ruf(NACHRICHT("Schick Jannik die WhatsApp"));
  pruefe("Antwortet als Ereignisstrom", /text\/event-stream/.test(r.kopf["content-type"] || ""), JSON.stringify(r.kopf));
  pruefe("Die Frage geht an die normale Sprachroute", gefragt[0]?.text === "Schick Jannik die WhatsApp", JSON.stringify(gefragt));
  pruefe("Und zwar angemeldet", /connect\.sid/.test(gefragt[0]?.keks || ""), gefragt[0]?.keks);

  // --- Das Format, das ElevenLabs erwartet ----------------------------------
  const zeilen = r.roh.split("\n\n").filter(Boolean);
  pruefe("Jede Zeile beginnt mit 'data: '", zeilen.every((z) => z.startsWith("data: ")), zeilen[0]);
  pruefe("Der Strom endet mit [DONE]", /data: \[DONE\]/.test(zeilen[zeilen.length - 1]),
    "Ohne [DONE] wartet die Leitung, bis sie abbricht.");

  const bloecke = zeilen.filter((z) => !z.includes("[DONE]"))
    .map((z) => JSON.parse(z.replace(/^data:\s*/, "")));
  pruefe("Jedes Stueck ist ein ChatCompletionChunk",
    bloecke.every((b) => b.object === "chat.completion.chunk" && Array.isArray(b.choices)),
    JSON.stringify(bloecke[0]));
  pruefe("Genau ein Stueck schliesst mit finish_reason ab",
    bloecke.filter((b) => b.choices[0].finish_reason === "stop").length === 1);
  pruefe("Das abschliessende Stueck ist das letzte",
    bloecke[bloecke.length - 1].choices[0].finish_reason === "stop");

  // --- Kommt der Text vollstaendig an? --------------------------------------
  const gesagt = bloecke.map((b) => b.choices[0].delta?.content || "").join("");
  pruefe("Beide Saetze kommen an", /Klar\./.test(gesagt) && /WhatsApp ist raus/.test(gesagt), gesagt);
  pruefe("Auch der Schlusssatz kommt an", /Angebot kommt gleich auf Telegram/.test(gesagt), gesagt);
  pruefe("Nichts steht doppelt drin", (gesagt.match(/Klar\./g) || []).length === 1, gesagt);
  pruefe("Die Saetze sind getrennt, kleben nicht aneinander",
    /Klar\. Die WhatsApp/.test(gesagt), JSON.stringify(gesagt));

  // --- Ein Anruf ist ein eigenes Gespraech ----------------------------------
  //
  // Ohne das bezoege sich Alexandra am Telefon auf etwas, das Lukas vorgestern
  // getippt hat.
  zuruecksetzen = 0;
  await ruf(NACHRICHT("Erster Satz im Anruf"));
  pruefe("Beim ersten Satz wird der Verlauf zurueckgesetzt", zuruecksetzen === 1, `${zuruecksetzen}×`);
  await ruf(NACHRICHT("Erster Satz", "Zweiter Satz"));
  pruefe("Beim zweiten NICHT mehr", zuruecksetzen === 1, `${zuruecksetzen}×`);

  // --- Nur die LETZTE Aeusserung geht weiter --------------------------------
  //
  // ElevenLabs schickt den ganzen Verlauf mit. Wuerde man ihn weiterreichen,
  // haette Alexandra ihn doppelt: einmal aus der Sitzung, einmal von hier.
  gefragt = [];
  await ruf(NACHRICHT("Alter Satz", "Neuer Satz"));
  pruefe("Nur die letzte Aeusserung wird weitergereicht", gefragt[0]?.text === "Neuer Satz", gefragt[0]?.text);

  // --- Stille darf die Leitung nicht haengen lassen -------------------------
  const leer = await ruf(NACHRICHT(""));
  pruefe("Auch bei leerer Eingabe endet der Strom sauber", /data: \[DONE\]/.test(leer.roh), leer.roh);

  // --- Anrufen ohne Zugangsdaten ---------------------------------------------
  const ohne = await telefon.anrufen({ an: "+491701234567", ansage: "Test" });
  pruefe("Ohne Zugangsdaten wird nicht angerufen, aber klar gemeldet",
    !ohne.ok && /Zugangsdaten|Agent-ID/.test(ohne.reply), ohne.reply);

  // --- Unbrauchbare Nummern --------------------------------------------------
  process.env.ELEVENLABS_API_KEY = "k"; process.env.ELEVENLABS_AGENT_ID = "a"; process.env.ELEVENLABS_TELEFON_ID = "n";
  delete require.cache[require.resolve("../lib/telefon.js")];
  const t2 = require("../lib/telefon.js");
  for (const [nr, was] of [["0170 1234567", "ohne Laendervorwahl"], ["", "leer"], ["+49", "zu kurz"]]) {
    const x = await t2.anrufen({ an: nr, ansage: "Test" });
    pruefe(`Keine Waehlversuche bei Nummer ${was}`, !x.ok && /\+49/.test(x.reply), `${nr} -> ${x.reply}`);
  }
  const ohneSatz = await t2.anrufen({ an: "+491701234567", ansage: "" });
  pruefe("Kein Anruf ohne Ansage", !ohneSatz.ok && /sagen/.test(ohneSatz.reply), ohneSatz.reply);

  // --- Die Kostenbremse -------------------------------------------------------
  //
  // Lukas hatte mit einem frueheren Aufbau 300 € Monatsrechnung. Die Hoechstdauer
  // beim Agenten deckelt den EINZELNEN Anruf; diese Grenze deckelt die ANZAHL.
  // Ohne sie koennte eine Schleife hundertmal anrufen, jeder Anruf brav unter
  // der Hoechstdauer.
  process.env.TELEFON_MAX_AM_TAG = "3";
  process.env.TELEFON_ZIEL = "+491701234567";
  delete require.cache[require.resolve("../lib/telefon.js")];
  const t3 = require("../lib/telefon.js");

  // Waehlen wird abgefangen — es soll niemand angerufen werden.
  const echterFetch = global.fetch;
  let gewaehlt = 0;
  global.fetch = async (u, o) => {
    if (String(u).includes("convai/twilio/outbound-call")) {
      gewaehlt++;
      return { ok: true, status: 200, json: async () => ({ conversation_id: "c" + gewaehlt }) };
    }
    return echterFetch(u, o);
  };

  for (let i = 1; i <= 3; i++) {
    const r = await t3.anrufen({ ansage: "Test " + i });
    pruefe(`Anruf ${i} von 3 geht durch`, r.ok, r.reply);
  }
  const zuviel = await t3.anrufen({ ansage: "Einer zu viel" });
  pruefe("Der vierte wird abgewiesen", !zuviel.ok, zuviel.reply);
  pruefe("Und es wurde WIRKLICH nicht gewaehlt", gewaehlt === 3, `${gewaehlt}× gewaehlt`);
  pruefe("Die Meldung sagt, woran es liegt", /Tagesgrenze/.test(zuviel.reply), zuviel.reply);
  pruefe("Der Stand ist ablesbar", t3.stand().anrufe === 3 && t3.stand().hoechstens === 3, JSON.stringify(t3.stand()));

  // Ein gescheiterter Anruf darf NICHT auf die Grenze angerechnet werden —
  // sonst sperrt ein kaputter Zugang den ganzen Tag.
  global.fetch = async (u, o) => {
    if (String(u).includes("convai/twilio/outbound-call")) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return echterFetch(u, o);
  };
  process.env.TELEFON_MAX_AM_TAG = "2";
  delete require.cache[require.resolve("../lib/telefon.js")];
  const t4 = require("../lib/telefon.js");
  await t4.anrufen({ ansage: "geht schief" });
  pruefe("Ein gescheiterter Anruf zaehlt nicht mit", t4.stand().anrufe === 0, JSON.stringify(t4.stand()));
  global.fetch = echterFetch;

  attrappe.close();
  console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Fälle bestanden.");
  process.exitCode = fehler ? 1 : 0;
})();
