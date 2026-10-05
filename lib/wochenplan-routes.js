// lib/wochenplan-routes.js — der Wochenplan des Teams (/wochenplan).
//
// Lukas, 05.10.2026: "Es soll einfach nur ein Wochenplan sein, wo wir kurz
// darauf schauen koennen: In welcher Phase sind wir gerade? Was muessen wir
// jetzt erledigen?" Vorlage ist das Whiteboard im Buero (links Montag bis
// Freitag mit festen Zeiten, rechts Sa/So ohne Zeiten). Die Seite uebernimmt
// diesen Aufbau, damit Tafel und OS dasselbe zeigen.
//
// Bewusst NUR zum Ansehen: nichts anklicken, nichts auswaehlen, nichts
// speichern. Der Plan steht unten als Konstante — wer ihn aendert, aendert
// ihn hier. Keine Tabelle, kein Formular: Ein Plan, den man nebenbei
// umklicken kann, ist bald nicht mehr der gemeinsame.
//
// Das Einzige, was sich bewegt, ist die Anzeige "Jetzt": welcher Block gerade
// laeuft, wie lange noch, was danach kommt. Der Server rechnet sie beim
// Ausliefern einmal vor (kein Flackern), das Skript im Browser haelt sie jede
// halbe Minute aktuell. Beide rechnen mit DERSELBEN Funktion (wpPhase, als
// Text ins Skript gelegt) und in deutscher Zeit — der Server laeuft im
// Container auf UTC, und eine zweite Rechnung im Browser wuerde irgendwann
// anders runden als die erste.

const fs = require("fs");
const path = require("path");
const { schale, eintragen } = require("./schale.js");

// Haengt unter der Zentrale an der Stelle, an der bis 05.10.2026 die To-Dos
// standen (Lukas: "Mach To-Do's raus und fuege da den Wochenplan ein").
// Die To-Do-Seite selbst gibt es weiter, sie ist ueber die Kacheln der
// Zentrale erreichbar — nur der Menuepunkt ist weg.
// Kein "modul": Der Wochenplan ist Teil der Zentrale, wer sie sieht, sieht ihn.
eintragen({
  id: "zentrale", titel: "Zentrale", icon: "zentrale", href: "/", gruppe: "Übersicht",
  unter: [{ id: "zentrale-wochenplan", titel: "Wochenplan", icon: "wochenplan",
            href: "/wochenplan", nach: "kalender" }],
});

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Cache-Stempel wie v() in schale.js (dort nicht exportiert).
const stempel = new Map();
function v(datei) {
  const jetzt = Date.now();
  const c = stempel.get(datei);
  if (c && jetzt - c.geprueft < 5000) return c.url;
  let url = datei;
  try {
    const st = fs.statSync(path.join(__dirname, "..", "public", datei.replace(/^\//, "")));
    url = `${datei}?v=${Math.round(st.mtimeMs).toString(36)}`;
  } catch { /* Datei fehlt: ohne Stempel ausliefern */ }
  stempel.set(datei, { url, geprueft: jetzt });
  return url;
}

// ------------------------------------------------------------- Der Plan
//
// Stand 05.10.2026, Lukas. Gegenueber der Tafel geaendert: Session 1 endet
// um 10:00, Session 2 ist Cold Calling statt Content, Session 3 hat um 15:00
// eine halbe Stunde Pause, Funnel-Optimierung wandert in Session 4.
// Die Pausen stehen als eigene Bloecke drin, damit "Jetzt" auch zwischen zwei
// Sessions eine ehrliche Antwort gibt.
//
// art bestimmt die Farbe (public/wochenplan.css). bis: null = offenes Ende
// ("EOD" auf der Tafel).
const WERKTAG = [
  { id: "plan", von: "08:00", bis: "08:30", titel: "Besprechung / Plan", art: "plan" },
  { id: "dw1", von: "08:30", bis: "10:00", titel: "Deep-Work-Session 1", art: "content",
    punkte: ["Content: LinkedIn, YouTube, Instagram", "LinkedIn-Follow-ups"] },
  { id: "pause1", von: "10:00", bis: "10:15", titel: "Pause", art: "pause" },
  { id: "dw2", von: "10:15", bis: "12:00", titel: "Deep-Work-Session 2", art: "calling",
    punkte: ["Cold Calling"] },
  { id: "daily", von: "12:00", bis: "13:00", titel: "Daily Call MMS", art: "daily" },
  { id: "pause2", von: "13:00", bis: "13:15", titel: "Pause", art: "pause" },
  { id: "dw3", von: "13:15", bis: "15:00", titel: "Deep-Work-Session 3", art: "calling",
    punkte: ["Cold Calling"] },
  { id: "pause3", von: "15:00", bis: "15:30", titel: "Pause", art: "pause" },
  { id: "dw3b", von: "15:30", bis: "17:00", titel: "Deep-Work-Session 3", art: "calling",
    punkte: ["Cold Calling"] },
  { id: "dw4", von: "17:00", bis: null, titel: "Deep-Work-Session 4", art: "fulfillment",
    punkte: ["Fulfillment, sobald Kunden da sind", "Sonst interne To-dos: Funnel-Optimierung, Webseiten-Optimierung, was gerade anfällt"] },
];

// Wie auf der Tafel. Keine Uhrzeiten: Am Wochenende ist oft ein Fussballspiel,
// mal samstags, mal sonntags — das laesst sich nicht fest einplanen.
const WOCHENENDE = ["Buchhaltung", "Netzwerk", "Fulfillment", "Leads (CL)", "Content", "Resümee / Skalierung"];

const TAGE = [
  { nr: 1, kurz: "Mo", lang: "Montag" },
  { nr: 2, kurz: "Di", lang: "Dienstag" },
  { nr: 3, kurz: "Mi", lang: "Mittwoch" },
  { nr: 4, kurz: "Do", lang: "Donnerstag" },
  { nr: 5, kurz: "Fr", lang: "Freitag" },
];

const ARTEN = [
  ["plan", "Besprechung"], ["content", "Content & Follow-ups"], ["calling", "Cold Calling"],
  ["daily", "Daily Call"], ["fulfillment", "Fulfillment & interne To-dos"], ["pause", "Pause"],
];

// Das Raster zeigt 08:00 bis 19:30. Session 4 hat kein Ende, sie laeuft unten
// sichtbar aus — die Seite soll nicht bis Mitternacht leer weiterlaufen. Die
// halbe Stunde ueber 19:00 hinaus braucht ihr Text in schmalen Spalten.
// Aendert sich das, auch --wp-hoehe in wochenplan.css anpassen.
const RASTER_VON = 8 * 60;
const RASTER_BIS = 19 * 60 + 30;

const minuten = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const PLAN = {
  tag: WERKTAG.map((b) => ({ id: b.id, von: minuten(b.von), bis: b.bis ? minuten(b.bis) : null,
    titel: b.titel, punkte: b.punkte || [], art: b.art })),
  wochenende: WOCHENENDE,
};

// ------------------------------------------------- Jetzt (Server UND Browser)
//
// Beide Funktionen laufen auf dem Server und werden als Text ins Skript der
// Seite gelegt. Darum: nur ES5, keine Bezuege nach aussen, alles ueber die
// Parameter.

// Wochentag (0 = Sonntag) und Minute des Tages in deutscher Zeit.
function wpJetzt(d) {
  var teile = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", weekday: "short",
    hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(d).forEach(function (p) { teile[p.type] = p.value; });
  return {
    tag: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(teile.weekday),
    min: (Number(teile.hour) % 24) * 60 + Number(teile.minute),
  };
}

// Was laeuft gerade? Liefert reine Daten, das Einsetzen macht der Aufrufer.
function wpPhase(tag, min, P) {
  function hhmm(m) {
    var h = Math.floor(m / 60), x = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (x < 10 ? "0" : "") + x;
  }
  function dauer(m) {
    var h = Math.floor(m / 60), x = m % 60;
    return h ? h + " Std." + (x ? " " + x + " Min." : "") : x + " Min.";
  }
  function kurz(b) { return hhmm(b.von) + " · " + b.titel + (b.punkte.length ? " · " + b.punkte[0] : ""); }
  var NAMEN = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  var erster = P.tag[0];
  var r = { tag: tag, min: min, label: NAMEN[tag] + ", " + hhmm(min), block: null, art: "plan",
    titel: "", punkte: [], rest: "", anteil: null, danach: "" };

  if (tag === 0 || tag === 6) {
    r.modus = "wochenende"; r.art = "wochenende"; r.titel = "Wochenende";
    r.punkte = P.wochenende; r.rest = "Keine festen Zeiten";
    r.danach = "Montag, " + kurz(erster);
    return r;
  }
  if (min < erster.von) {
    r.modus = "vorher"; r.titel = "Noch vor dem Start";
    r.rest = "noch " + dauer(erster.von - min);
    r.danach = kurz(erster);
    return r;
  }
  for (var i = 0; i < P.tag.length; i++) {
    var b = P.tag[i], ende = b.bis === null ? 24 * 60 : b.bis;
    if (min < b.von || min >= ende) continue;
    var naechster = P.tag[i + 1];
    r.modus = "block"; r.block = b.id; r.art = b.art; r.titel = b.titel; r.punkte = b.punkte;
    r.rest = b.bis === null ? "Offenes Ende" : "noch " + dauer(b.bis - min) + " · bis " + hhmm(b.bis);
    r.anteil = b.bis === null ? null : (min - b.von) / (b.bis - b.von);
    r.danach = naechster ? kurz(naechster)
      : tag === 5 ? "Wochenende · keine festen Zeiten" : "Morgen, " + kurz(erster);
    return r;
  }
  return r;
}

// ------------------------------------------------------------- Darstellung

const zeitText = (b) => `${b.von} – ${b.bis || "EOD"}`;

// "Deep-Work-" faellt in schmalen Spalten weg (wochenplan.css, unter 1100 px),
// sonst bricht der Titel zu "Deep-Work-Session / 1" um.
const titelHtml = (t) => e(t).replace("Deep-Work-", '<span class="wp-dw">Deep-Work-</span>');

// Ein Block im Raster. Die Lage kommt als Minuten seit 08:00 in CSS-Variablen,
// die Hoehe einer Minute steht einmal in wochenplan.css (--wp-px).
function block(b, roh, ph, tagNr) {
  const heute = ph.tag === tagNr;
  const ende = roh.bis === null ? RASTER_BIS : roh.bis;
  const zust = !heute || ph.modus === "vorher" ? ""
    : ph.block === b.id ? " wp-block--jetzt"
    : roh.bis !== null && ph.min >= roh.bis ? " wp-block--vorbei" : "";
  const dauer = ende - roh.von;
  const form = b.art === "pause" ? " wp-block--pause" : dauer <= 30 ? " wp-block--kurz" : "";
  const offen = b.bis ? "" : " wp-block--offen";
  return `<div class="wp-block wp-art-${b.art}${form}${offen}${zust}" data-block="${b.id}"
      data-bis="${roh.bis === null ? "" : roh.bis}"
      style="--von:${roh.von - RASTER_VON};--dauer:${dauer}">
      <div class="wp-block-zeile"><span class="wp-block-zeit">${e(zeitText(b))}</span>
        <span class="wp-block-titel">${titelHtml(b.titel)}</span></div>
      ${b.punkte ? `<ul class="wp-block-punkte">${b.punkte.map((p) => `<li>${e(p)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

function seite(ph) {
  const roh = (id) => PLAN.tag.find((b) => b.id === id);
  const werktag = ph.tag >= 1 && ph.tag <= 5;

  // Stundenmarken links, volle Stunden bis 19:00.
  const stunden = [];
  for (let m = RASTER_VON; m < RASTER_BIS; m += 60) stunden.push(m);
  // Liegt die Uhr-Pille naeher als 15 Min. an einer Stundenmarke, verschwindet
  // die Marke — sonst schaut ihre halbe Beschriftung unter der Pille hervor.
  const nahe = (m) => werktag && Math.abs(m - ph.min) < 15;
  const achse = stunden.map((m) => `<span data-min="${m}"${nahe(m) ? ' class="wp-verdeckt"' : ""} style="--von:${m - RASTER_VON}">${String(m / 60).padStart(2, "0")}:00</span>`).join("");

  const kopfzellen = TAGE.map((t) => `<div class="wp-tag-kopf${ph.tag === t.nr ? " wp-heute" : ""}" data-tag="${t.nr}">
      <span class="wp-tag-kurz">${t.kurz}</span><span class="wp-tag-lang">${t.lang}</span>
      <span class="wp-heute-marke">Heute</span></div>`).join("");

  // "Jetzt" im Raster (Befund Pruefung 05.10.): Ein roter Strich UEBER den
  // Bloecken las sich wie Durchstreichen — in der ersten halben Stunde jedes
  // Blocks lag er genau auf dem Titel. Jetzt fuellt sich der laufende Block
  // von oben bis zur aktuellen Minute, die rote Kante liegt UNTER der Schrift
  // (wochenplan.css, .wp-block--jetzt::before). Dazu ein Punkt am Spaltenrand
  // und die Uhrzeit an der Achse. --jetzt steht an der Spalte und vererbt sich.
  // Nach 19:30 laeuft Session 4 weiter, das Raster aber nicht: --jetzt bleibt
  // dann am unteren Rand stehen (Block ganz gefuellt), Punkt und Uhr verschwinden.
  const imRaster = werktag && ph.min >= RASTER_VON && ph.min <= RASTER_BIS;
  const jetztStil = imRaster ? ` style="--jetzt:${ph.min - RASTER_VON}"` : "";
  const spaltenStil = werktag && ph.min >= RASTER_VON
    ? ` style="--jetzt:${Math.min(ph.min, RASTER_BIS) - RASTER_VON}"` : "";
  const spalten = TAGE.map((t) => `<div class="wp-tag${ph.tag === t.nr ? " wp-heute" : ""}" data-tag="${t.nr}"${ph.tag === t.nr ? spaltenStil : ""}>
      ${WERKTAG.map((b) => block(b, roh(b.id), ph, t.nr)).join("")}
      <div class="wp-punkt"${ph.tag === t.nr && imRaster ? "" : " hidden"}></div></div>`).join("");
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  // Fuers Handy: dieselben Bloecke als Liste. Sieben Spalten auf 390 px waeren
  // 45 px je Tag — dieselbe Falle wie bei den CRM-Listen (30.09.).
  const liste = WERKTAG.map((b) => {
    const r = roh(b.id);
    const zust = !werktag || ph.modus === "vorher" ? ""
      : ph.block === b.id ? " wp-block--jetzt"
      : r.bis !== null && ph.min >= r.bis ? " wp-block--vorbei" : "";
    return `<li class="wp-zeile wp-art-${b.art}${b.art === "pause" ? " wp-zeile--pause" : ""}${zust}"
        data-block="${b.id}" data-bis="${r.bis === null ? "" : r.bis}">
      <span class="wp-zeile-zeit">${e(b.von)}<span>${e(b.bis || "EOD")}</span></span>
      <span class="wp-zeile-text"><b>${e(b.titel)}</b>${(b.punkte || []).map((p) => `<span>${e(p)}</span>`).join("")}</span>
    </li>`;
  }).join("");

  const punkte = (ph.punkte || []).map((p) => `<li>${e(p)}</li>`).join("");
  const anteil = ph.anteil === null ? "" : `${Math.round(ph.anteil * 1000) / 10}%`;

  return `
  <link rel="stylesheet" href="${v("/wochenplan.css")}">
  <div class="wp-seite">

    <section class="wp-jetzt wp-art-${e(ph.art)}" data-wp-jetzt>
      <div class="wp-jetzt-haupt">
        <div class="wp-jetzt-label"><span class="wp-puls"></span>Jetzt · <span data-wp="label">${e(ph.label)}</span></div>
        <div class="wp-jetzt-titel" data-wp="titel" aria-live="polite">${e(ph.titel)}</div>
        <ul class="wp-jetzt-punkte" data-wp="punkte">${punkte}</ul>
        <div class="wp-jetzt-fuss">
          <div class="wp-balken" data-wp="balken-huelle"${ph.anteil === null ? " hidden" : ""}><i data-wp="balken" style="width:${anteil}"></i></div>
          <span class="wp-jetzt-rest" data-wp="rest">${e(ph.rest)}</span>
        </div>
      </div>
      <div class="wp-jetzt-danach">
        <span class="wp-jetzt-danach-label">Danach</span>
        <span class="wp-jetzt-danach-text" data-wp="danach">${e(ph.danach)}</span>
      </div>
    </section>

    <div class="wp-woche">
      <section class="wp-tafel wp-werktage">
        <header class="wp-tafel-kopf">
          <h2>Montag – Freitag</h2>
          <span class="wp-tafel-unter">Feste Zeiten, jeden Werktag gleich</span>
        </header>

        <div class="wp-raster">
          <div class="wp-ecke"></div>
          ${kopfzellen}
          <div class="wp-achse"${jetztStil}>${achse}<b class="wp-uhr" data-wp-uhr${imRaster ? "" : " hidden"}>${imRaster ? hhmm(ph.min) : ""}</b></div>
          ${spalten}
        </div>

        <ol class="wp-liste">${liste}</ol>
      </section>

      <section class="wp-tafel wp-wochenende${werktag ? "" : " wp-heute"}" data-tag="we">
        <header class="wp-tafel-kopf">
          <h2>Sa / So</h2>
          <span class="wp-tafel-unter">Keine festen Zeiten</span>
          <span class="wp-heute-marke">Heute</span>
        </header>
        <ul class="wp-we-liste">${WOCHENENDE.map((p) => `<li>${e(p)}</li>`).join("")}</ul>
        <p class="wp-we-hinweis">Am Wochenende ist oft ein Fußballspiel. Deshalb gibt es hier keine Uhrzeiten:
          Die Punkte erledigen wir am Samstag oder am Sonntag, je nachdem, welcher Tag frei ist.</p>
      </section>
    </div>

    <div class="wp-legende" aria-label="Farben">
      ${ARTEN.map(([art, name]) => `<span class="wp-art-${art}"><i></i>${e(name)}</span>`).join("")}
    </div>
  </div>

  <script>
  (function () {
    var P = ${JSON.stringify(PLAN).replace(/</g, "\\u003c")};
    var VON = ${RASTER_VON}, BIS = ${RASTER_BIS};
    ${wpJetzt.toString()}
    ${wpPhase.toString()}
    var wurzel = document.querySelector(".wp-seite");
    var karte = wurzel.querySelector("[data-wp-jetzt]");
    var uhr = wurzel.querySelector("[data-wp-uhr]");
    function feld(n) { return karte.querySelector('[data-wp="' + n + '"]'); }
    // Nur schreiben, was sich geaendert hat — sonst meldet eine Vorlesehilfe
    // die Karte alle 30 Sekunden neu.
    function text(el, t) { if (el.textContent !== t) el.textContent = t; }

    function zustand(el, ph, werktag) {
      el.classList.remove("wp-block--jetzt", "wp-block--vorbei");
      if (!werktag || ph.modus === "vorher") return;
      var bis = el.getAttribute("data-bis");
      if (el.getAttribute("data-block") === ph.block) el.classList.add("wp-block--jetzt");
      else if (bis !== "" && ph.min >= Number(bis)) el.classList.add("wp-block--vorbei");
    }

    function aktualisieren() {
      var j = wpJetzt(new Date());
      var ph = wpPhase(j.tag, j.min, P);
      var werktag = j.tag >= 1 && j.tag <= 5;

      karte.className = "wp-jetzt wp-art-" + ph.art;
      text(feld("label"), ph.label);
      text(feld("titel"), ph.titel);
      var ul = feld("punkte");
      if (ul.getAttribute("data-stand") !== ph.punkte.join("|")) {
        ul.textContent = "";
        ph.punkte.forEach(function (p) { var li = document.createElement("li"); li.textContent = p; ul.appendChild(li); });
        ul.setAttribute("data-stand", ph.punkte.join("|"));
      }
      text(feld("rest"), ph.rest);
      text(feld("danach"), ph.danach);
      feld("balken-huelle").hidden = ph.anteil === null;
      if (ph.anteil !== null) feld("balken").style.width = (Math.round(ph.anteil * 1000) / 10) + "%";

      // Heute markieren: Spaltenkopf, Spalte, Wochenend-Tafel.
      wurzel.querySelectorAll("[data-tag]").forEach(function (el) {
        var t = el.getAttribute("data-tag");
        el.classList.toggle("wp-heute", t === "we" ? !werktag : Number(t) === j.tag);
      });
      var imRaster = werktag && j.min >= VON && j.min <= BIS;
      wurzel.querySelectorAll(".wp-tag").forEach(function (spalte) {
        var heute = Number(spalte.getAttribute("data-tag")) === j.tag;
        spalte.querySelectorAll(".wp-block").forEach(function (b) { zustand(b, ph, heute); });
        if (heute && j.min >= VON) spalte.style.setProperty("--jetzt", Math.min(j.min, BIS) - VON);
        else spalte.style.removeProperty("--jetzt");
        spalte.querySelector(".wp-punkt").hidden = !(heute && imRaster);
      });
      uhr.hidden = !imRaster;
      uhr.parentNode.querySelectorAll("span[data-min]").forEach(function (s) {
        s.classList.toggle("wp-verdeckt", imRaster && Math.abs(Number(s.getAttribute("data-min")) - j.min) < 15);
      });
      if (imRaster) {
        uhr.parentNode.style.setProperty("--jetzt", j.min - VON);
        text(uhr, ph.label.slice(-5));
      }
      wurzel.querySelectorAll(".wp-zeile").forEach(function (z) { zustand(z, ph, werktag); });
    }

    aktualisieren();
    setInterval(aktualisieren, 30000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) aktualisieren(); });
  })();
  </script>`;
}

module.exports = function (app) {
  app.get("/wochenplan", (req, res) => {
    const j = wpJetzt(new Date());
    res.send(schale({
      // Ohne Unterzeile: Mit ihr brach die Kopfzeile bei 1280 px um ("Paus/e",
      // "Feieraben/d"). Was sie sagte, steht ohnehin auf den beiden Tafeln.
      titel: "Wochenplan", aktiv: "zentrale-wochenplan", nutzer: req.session.crm || null,
      inhalt: seite(wpPhase(j.tag, j.min, PLAN)),
    }));
  });
};

// Fuer den Selbsttest (scripts/test-wochenplan.js).
module.exports.wpPhase = wpPhase;
module.exports.wpJetzt = wpJetzt;
module.exports.PLAN = PLAN;
