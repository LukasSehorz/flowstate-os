// Die Regie-Seite fuer die Werbeaufnahmen.
//
// WOZU (20.08.2026): Beim Dreh sollen zwei Dinge im richtigen Moment passieren
// — die Stimme sagt ihre Zeile, und das passende Dokument geht auf dem zweiten
// Bildschirm auf. Beides von Hand zu bedienen heisst: jemand sucht eine MP3,
// jemand sucht eine PDF, und die Einstellung ist tot.
//
// Hier laeuft beides an einer Taste. Wer die Seite offen hat, drueckt
// Leertaste, und der naechste Schritt geschieht: Ton ab, Dokument auf.
//
// WARUM DAS DOKUMENT AUS DEM SYSTEM KOMMT und nicht vom Dateisystem des
// Laptops: Ein Browser darf von einer https-Seite aus keine lokale Datei
// oeffnen. Die Dateien liegen darum im Ordner /dreh auf dem Server und werden
// hier ausgeliefert — dann ist es ein normaler Link, und der Tab bleibt beim
// zweiten Mal derselbe (window.open mit festem Namen).
//
// WARUM window.open AN EINER TASTE HAENGT: Ohne Nutzergeste blockt jeder
// Browser das Fenster. Die Leertaste IST die Geste — deshalb geht die Datei
// beim Druecken auf und nicht ueber einen Zeitgeber.
//
// NUR IM DREH: Ohne DREH_REGIE=1 wird die Seite nicht registriert. Im Betrieb
// gibt es sie nicht, auch nicht als 403.

const fs = require("fs");
const path = require("path");

const ORDNER = process.env.DREH_ORDNER || "/dreh";
const SKRIPT = () => path.join(ORDNER, "skript.json");

const TYPEN = {
  ".mp3": "audio/mpeg", ".pdf": "application/pdf", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function skriptLesen() {
  try { return JSON.parse(fs.readFileSync(SKRIPT(), "utf-8")); }
  catch (e) { return { fehler: e.message, creatives: [] }; }
}

module.exports = function (app) {
  // Dateien ausliefern. Bewusst nur der Basisname: ein Pfad mit ".." wuerde
  // sonst aus dem Ordner herausfuehren.
  app.get("/regie/datei/:name", (req, res) => {
    const name = path.basename(String(req.params.name || ""));
    const datei = path.join(ORDNER, name);
    if (!fs.existsSync(datei)) return res.status(404).send("Nicht gefunden: " + esc(name));
    const typ = TYPEN[path.extname(name).toLowerCase()];
    if (typ) res.type(typ);
    // inline, damit die PDF im Tab AUFGEHT statt in den Downloads zu landen.
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    fs.createReadStream(datei).pipe(res);
  });

  // Das Drehbuch fuer die Sprachbuehne: nur die ZUEGE des Agenten, in der
  // Reihenfolge, in der sie kommen. Die Zeilen von Jannik und die reine
  // Bildregie stehen nicht drin — dazwischen redet er ja selbst, und der Zug
  // wird von der Stille ausgeloest, nicht von einer Liste.
  //
  // Was an einem Bild-Schritt haengt (ein Dokument), wandert an den NAECHSTEN
  // Zug des Agenten. Sonst gaebe es einen Schritt, den niemand ausloest.
  app.get("/regie/drehbuch.json", (req, res) => {
    const s = skriptLesen();
    const nr = Math.max(0, Math.min((s.creatives || []).length - 1,
      Number(req.query.c || 0) || 0));
    const c = (s.creatives || [])[nr];
    if (!c) return res.status(404).json({ fehler: "Kein Creative " + nr });

    // oeffnen ist eine LISTE, nicht ein Wert. In Creative 3 haengen an einem
    // Zug zwei Dateien — die Rechnung aus dem Schritt davor und die Excel des
    // Zuges selbst. Mit einem Einzelwert hatte die zweite die erste
    // ueberschrieben, und die Rechnung waere nie aufgegangen. Die Bildregie
    // verlangt ohnehin beide nebeneinander.
    // "sofort" heisst: Zwischen diesem Zug und dem davor steht KEINE Zeile von
    // Jannik. Dann darf der Agent gleich weiterreden, statt auf eine Antwort zu
    // warten, die im Skript gar nicht vorgesehen ist.
    //
    // WARUM (20.08.2026): C2_04 endet mit "die brauchen deine Freigabe", danach
    // kommt nur Bildregie und dann C2_05. Im Dreh stand das Gespraech an dieser
    // Stelle still — Jannik hatte nichts zu sagen, und der Agent wartete.
    const zuege = [];
    let warten = [];
    let seitStimmeGeredet = true;   // vor dem ersten Zug wartet der Klatscher
    for (const b of c.beats || []) {
      if (b.art !== "stimme") {
        if (b.oeffnen) warten.push(b.oeffnen);
        if (b.art === "du") seitStimmeGeredet = true;
        continue;
      }
      // b.oeffnen darf ein Wert ODER eine Liste sein — C2_04 macht Angebot und
      // Creatives gleichzeitig auf, weil der Satz beides ankuendigt.
      const eigene = Array.isArray(b.oeffnen) ? b.oeffnen : (b.oeffnen ? [b.oeffnen] : []);
      const dateien = warten.concat(eigene);
      zuege.push({
        id: b.id || "", text: b.text || "", audio: b.audio || "",
        oeffnen: dateien, tat: b.tat || null, tatWarten: Boolean(b.tatWarten),
        sofort: zuege.length > 0 && !seitStimmeGeredet,
      });
      warten = [];
      seitStimmeGeredet = false;
    }
    res.json({ titel: c.titel, zuege });
  });

  // Handlungen, die ein Zug ausloesen darf.
  //
  // WARUM EINE FESTE LISTE: Hier wird wirklich etwas verschickt. Ein Name aus
  // dem Drehbuch darf bestimmen, WELCHE der drei Handlungen laeuft — nicht,
  // WAS sie tut. Alles andere waere eine offene Tuer im Netz.
  const KALENDER = () => process.env.KALENDER_ID || "primary";

  // Gym und der geblockte Abend wieder weg. Wird VOR dem Kalender-Moment
  // ausgeloest, damit jeder Take mit einem leeren Abend beginnt — sonst stehen
  // die Termine aus dem vorigen Versuch schon da, und C2_07 hat nichts zu
  // zeigen. Spart das Zuruecksetzen von Hand zwischen zwei Takes.
  async function abendLeeren() {
    const kalender = require("./kalender.js");
    const werkzeuge = require("./werkzeuge.js");
    const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    let weg = 0;
    try {
      // Die Lesefunktion heisst spanne(von, bis, max) — kalender.termine gibt
      // es nicht, und ein Aufruf ins Leere haette hier still nichts geloescht.
      const r = await kalender.spanne(heute, heute, 40);
      for (const t of (r && r.termine) || []) {
        const titel = String(t.titel || t.summary || "");
        if (/^(Gym|Privat)/.test(titel) && t.id) {
          await werkzeuge.terminAbsagen({ id: t.id });
          weg++;
        }
      }
    } catch (e) { return { ok: false, grund: e.message }; }
    return { ok: true, entfernt: weg };
  }

  const TATEN = {
    // C2_05 — der Kalender geht auf. Vorher aufraeumen, damit der Abend leer
    // ist und man in C2_07 wirklich sieht, wie etwas dazukommt.
    "kalender-frisch": abendLeeren,
    // C2_04 "…dir per Telegram geschickt, damit du ihn am Handy
    // gegenzeichnen kannst." Bis eben kam nichts an — der Satz behauptete
    // etwas, das niemand ausloeste. Jetzt geht der Vertrag wirklich raus.
    vertrag: async () => {
      const fs = require("fs");
      const datei = path.join(ORDNER, "Vertrag-Bergmann-Solar-Performance-Marketing.pdf");
      const puffer = fs.readFileSync(datei);
      return require("./telegram.js").pushDatei(
        puffer, "Vertrag-Bergmann-Solar.pdf",
        "Der Vertrag mit Bergmann Solar — schau ihn dir am Handy an und zeichne gegen.",
        { stimme: false });   // im Dreh keine zweite Stimme aus dem Handy
    },
    // C2_07 "Alles klar, erledigt." — Gym und der geblockte Abend entstehen
    // WAEHREND der Aufnahme. Vorher darf nichts davon im Kalender stehen,
    // sonst gibt es nichts zu sehen.
    gym: async () => {
      const werkzeuge = require("./werkzeuge.js");
      const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
      // Die Felder heissen titel/start/ende, nicht name/von/bis — mit den
      // falschen Namen meldet terminEintragen nur "kein Titel" zurueck und
      // legt still nichts an.
      const a = await werkzeuge.terminEintragen({
        titel: "Gym", start: `${heute}T19:00:00`, ende: `${heute}T20:00:00`,
        ort: "Fitnessstudio",
      });
      const b = await werkzeuge.terminEintragen({
        titel: "Privat — Abend mit den Eltern",
        start: `${heute}T20:00:00`, ende: `${heute}T22:30:00`, beschreibung: "Geblockt",
      });
      return { gym: a, abend: b };
    },
    // C2_09 "Ist raus." — die Nachricht geht wirklich in die Teamgruppe.
    whatsapp: async () => {
      const ziel = process.env.DREH_WA_ZIEL || "Team Flowstate";
      const text = "Hey zusammen, wer hätte Lust, dass wir von Sonntag bis Dienstag "
        + "zum Arbeiten in die Berge fahren? Wer dabei ist, sagt kurz Bescheid — "
        + "dann suche ich ein Hotel raus und reserviere.";
      return require("./whatsapp.js").senden({ an: ziel, text });
    },
  };

  app.post("/regie/tat/:name", async (req, res) => {
    const tat = TATEN[String(req.params.name || "")];
    if (!tat) return res.status(404).json({ ok: false, fehler: "Unbekannte Tat" });
    try {
      const r = await tat();
      console.log("Regie-Tat:", req.params.name, JSON.stringify(r).slice(0, 200));
      res.json({ ok: true, ergebnis: r });
    } catch (e) {
      console.error("Regie-Tat fehlgeschlagen:", req.params.name, e.message);
      res.status(500).json({ ok: false, fehler: e.message });
    }
  });

  app.get("/regie", (req, res) => {
    const s = skriptLesen();
    const nr = Math.max(0, Math.min((s.creatives || []).length - 1,
      Number(req.query.c || 0) || 0));
    const c = (s.creatives || [])[nr];

    if (!c) {
      return res.send(`<!doctype html><meta charset="utf-8"><title>Regie</title>
        <body style="background:#0b1220;color:#e5e7eb;font:16px system-ui;padding:40px">
        <h1>Kein Drehbuch geladen</h1>
        <p>Erwartet: <code>${esc(SKRIPT())}</code></p>
        <p style="color:#f87171">${esc(s.fehler || "")}</p></body>`);
    }

    const reiter = (s.creatives || []).map((x, i) =>
      `<a href="/regie?c=${i}" class="reiter ${i === nr ? "an" : ""}">${esc(x.titel)}</a>`
    ).join("");

    const schritte = (c.beats || []).map((b, i) => {
      const art = b.art || "regie";
      const marke = art === "stimme" ? esc(b.id || "STIMME")
        : art === "du" ? "DU" : art === "tat" ? "TUN" : "BILD";
      return `<li class="s ${art}" data-i="${i}"
                  data-audio="${esc(b.audio || "")}"
                  data-oeffnen="${esc(b.oeffnen || "")}"
                  data-tat="${esc(b.tat || "")}">
        <span class="marke">${marke}</span>
        <span class="txt">${esc(b.text || "")}</span>
        ${b.oeffnen ? `<span class="datei">öffnet ${esc(b.oeffnen)}</span>` : ""}
      </li>`;
    }).join("");

    res.send(`<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Regie — ${esc(c.titel)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0b1220;--karte:#121a2b;--rand:#1f2b45;--text:#e5e7eb;--grau:#8b97ad;--blau:#4b8df8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--rand);padding:14px 22px;z-index:5}
h1{margin:0 0 8px;font-size:19px;letter-spacing:.02em}
.reiter{display:inline-block;padding:5px 12px;margin-right:6px;border:1px solid var(--rand);
  border-radius:999px;color:var(--grau);text-decoration:none;font-size:13px}
.reiter.an{background:var(--blau);border-color:var(--blau);color:#fff}
.hinweis{color:var(--grau);font-size:13px;margin-top:10px}
kbd{background:#1e2a44;border:1px solid var(--rand);border-radius:5px;padding:1px 7px;font-size:12px}
ol{list-style:none;margin:0;padding:18px 22px 60vh;counter-reset:n}
.s{display:grid;grid-template-columns:96px 1fr;gap:14px;padding:12px 16px;margin-bottom:8px;
  border:1px solid transparent;border-radius:12px;opacity:.42;transition:opacity .15s,background .15s}
.s.fertig{opacity:.22}
.s.jetzt{opacity:1;background:var(--karte);border-color:var(--blau)}
.marke{font-size:11px;letter-spacing:.09em;color:var(--grau);padding-top:3px;font-weight:700}
.s.stimme .marke{color:var(--blau)}
.s.du .txt{font-weight:600}
.s.regie .txt,.s.tat .txt{color:var(--grau);font-style:italic}
.datei{grid-column:2;font-size:12px;color:var(--blau);margin-top:4px}
.fuss{position:fixed;left:0;right:0;bottom:0;background:var(--karte);border-top:1px solid var(--rand);
  padding:12px 22px;display:flex;gap:18px;align-items:center;font-size:14px}
button{background:var(--blau);color:#fff;border:0;border-radius:9px;padding:9px 18px;font-size:14px;cursor:pointer}
button.leise{background:#1e2a44;color:var(--text)}
</style></head><body>
<header>
  <h1>Regie · ${esc(c.titel)}</h1>
  <div>${reiter}</div>
  <div class="hinweis"><kbd>Leertaste</kbd> nächster Schritt · <kbd>←</kbd> zurück ·
     <kbd>R</kbd> Zeile wiederholen · <kbd>0</kbd> an den Anfang</div>
</header>
<ol id="liste">${schritte}</ol>
<div class="fuss">
  <button id="weiter">Weiter (Leertaste)</button>
  <button class="leise" id="wieder">Wiederholen</button>
  <button class="leise" id="anfang">Anfang</button>
  <span id="stand" style="color:var(--grau)"></span>
</div>
<audio id="ton"></audio>
<script>
(function(){
  var schritte = [].slice.call(document.querySelectorAll('.s'));
  var ton = document.getElementById('ton');
  var stand = document.getElementById('stand');
  var i = -1;

  // EIN fester Fenstername: Beim zweiten Dokument wird derselbe Tab
  // wiederverwendet statt einen dritten aufzumachen. Auf dem zweiten
  // Bildschirm bleibt damit immer genau ein Fenster stehen.
  function oeffnen(name){ window.open('/regie/datei/' + encodeURIComponent(name), 'drehmappe'); }

  function zeigen(){
    schritte.forEach(function(s, k){
      s.classList.toggle('jetzt', k === i);
      s.classList.toggle('fertig', k < i);
    });
    var s = schritte[i];
    if (s) s.scrollIntoView({block:'center', behavior:'smooth'});
    stand.textContent = (i + 1) + ' von ' + schritte.length;
  }

  function spielen(s){
    var a = s.getAttribute('data-audio');
    if (a){ ton.src = '/regie/datei/' + encodeURIComponent(a); ton.play(); }
    var d = s.getAttribute('data-oeffnen');
    if (d) oeffnen(d);
  }

  function weiter(){
    if (i >= schritte.length - 1) return;
    i++; zeigen(); spielen(schritte[i]);
  }
  function zurueck(){ if (i > 0){ i--; zeigen(); } }
  function wieder(){ if (i >= 0){ zeigen(); spielen(schritte[i]); } }

  document.getElementById('weiter').addEventListener('click', weiter);
  document.getElementById('wieder').addEventListener('click', wieder);
  document.getElementById('anfang').addEventListener('click', function(){
    i = -1; ton.pause(); zeigen(); });
  document.addEventListener('keydown', function(e){
    if (e.code === 'Space' || e.code === 'Enter'){ e.preventDefault(); weiter(); }
    else if (e.code === 'ArrowLeft'){ e.preventDefault(); zurueck(); }
    else if (e.key === 'r' || e.key === 'R'){ e.preventDefault(); wieder(); }
    else if (e.key === '0'){ e.preventDefault(); i = -1; ton.pause(); zeigen(); }
  });
  zeigen();
})();
</script></body></html>`);
  });
};
