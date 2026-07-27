// lib/kalender.js — der Google Kalender IM Operating System.
//
// Warum es diese Datei gibt: Termine LESEN gab es bisher zweimal — in
// server.js fuer die Kachel "Termine heute" und in lib/zustand.js fuer die
// Sprache — und beide Male nur fuer ein fest verdrahtetes Fenster (ein Tag
// bzw. 35 Tage voraus). Eine Kalenderseite braucht eine FREIE Spanne: der
// Monatsraster faengt am Montag vor dem Ersten an und hoert am Sonntag nach
// dem Letzten auf. Ausserdem gehoeren Lesen und Schreiben an einen Ort.
//
// GESCHRIEBEN wird bewusst NICHT hier, sondern ueber lib/werkzeuge.js. Dort
// steht die gws-cli-Syntax, die am 25.07. am Server geprueft wurde
// (calendar create/update/delete), samt der Wandzeit-Rechnung, an der es
// vorher schon einmal gescheitert ist (Zeitzone doppelt abgezogen, Google
// lehnte den Termin ab). Diese Rechnung wird hier nicht nachgebaut.
//
// Es ist EIN Kalender: der von Lukas' Google-Konto, ueber das gemeinsame
// gws-cli-Token. Wer im OS angemeldet ist, sieht und schreibt denselben.

const { execFile } = require("child_process");
const { termineLesen } = require("./zustand.js");
const werkzeuge = require("./werkzeuge.js");

const GWS_ENV = { ...process.env, GWS_ENCRYPTION: "none" };

// ------------------------------------------------------------------ Datum
//
// Alles rechnet in Berliner Wandzeit. new Date().toISOString() ist hier
// verboten: oestlich von UTC dreht das nach 22 Uhr auf den Vortag — derselbe
// Fehler, der in marketing-routes.js schon als Kommentar steht.

function berlinDatum(d) {
  try { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}

// Sommerzeit grob wie in werkzeuge.js: Ende Maerz bis Ende Oktober +02:00.
const berlinOffset = (d) => (d.getUTCMonth() > 2 && d.getUTCMonth() < 10 ? "+02:00" : "+01:00");

const heuteTag = () => berlinDatum(new Date());

// "2026-07-27" -> Date auf 12:00 UTC. Mittag statt Mitternacht, damit ein
// Tagesversatz durch die Zeitzone den Tag nicht kippen kann.
const alsDate = (tag) => new Date(String(tag).slice(0, 10) + "T12:00:00Z");

// Tage addieren, ohne die Uhrzeit anzufassen — reine Kalenderarithmetik.
function tagPlus(tag, n) {
  const d = alsDate(tag);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Womit faengt die Woche an? Lukas' Google Kalender steht auf Sonntag (im
// Screenshot vom 27.07.: SUN MON TUE …) — und weil die Seite genau so
// aussehen soll wie dort, ist Sonntag die Vorgabe. Wer lieber die deutsche
// Gewohnheit will, setzt KALENDER_WOCHENSTART=mo in der .env; das ist die
// einzige Stelle, an der es haengt.
const WOCHENSTART = /^mo/i.test(process.env.KALENDER_WOCHENSTART || "so") ? 1 : 0;

// Erster Tag der Woche, in der dieser Tag liegt.
function wochenAnfang(tag, start = WOCHENSTART) {
  const d = alsDate(tag);
  const wt = (d.getUTCDay() - start + 7) % 7;
  return tagPlus(tag, -wt);
}

// Alter Name, weiterhin gueltig: liefert immer den MONTAG, unabhaengig von der
// Einstellung. Wird von scripts/test-kalender-seite.js benutzt und von allem,
// was wirklich den Montag meint (Kalenderwoche).
const montagVon = (tag) => wochenAnfang(tag, 1);

const ersterDesMonats = (tag) => String(tag).slice(0, 7) + "-01";

function letzterDesMonats(tag) {
  const d = alsDate(ersterDesMonats(tag));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function monatPlus(tag, n) {
  const d = alsDate(ersterDesMonats(tag));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

// Gueltiger Tag oder heute. Faengt ab, dass ein manipuliertes ?datum= die
// ganze Seite mit "Invalid Date" fuellt.
function tagOderHeute(wert) {
  const s = String(wert || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return heuteTag();
  const d = alsDate(s);
  return Number.isNaN(d.getTime()) ? heuteTag() : s;
}

// ------------------------------------------------------------------ Lesen

// Termine einer freien Spanne. vonTag/bisTag sind Tage (JJJJ-MM-TT), bisTag
// ist EINSCHLIESSLICH — gws-cli --to ist es nicht, darum ein Tag drauf.
// max bewusst 200 und nicht hoeher: das ist der Wert, der in lib/zustand.js
// seit Wochen laeuft. Ich hatte hier zuerst 400 stehen — ein Wert, den noch nie
// jemand gegen das echte gws-cli geprueft hat. Ein sechswoechiges Monatsraster
// hat ohnehin nie 200 Termine, also gibt es nichts zu gewinnen und einen
// stillen Fehlschlag zu verlieren.
function spanne(vonTag, bisTag, max = 200) {
  return new Promise((fertig) => {
    const von = alsDate(vonTag), bis = alsDate(tagPlus(bisTag, 1));
    execFile(
      "gws-cli",
      ["calendar", "list",
        "--from", `${vonTag}T00:00:00${berlinOffset(von)}`,
        "--to", `${tagPlus(bisTag, 1)}T00:00:00${berlinOffset(bis)}`,
        "--max", String(max)],
      { env: GWS_ENV, timeout: 30000 },
      // Alles in try/catch: Der Rueckruf laeuft ausserhalb der Promise-Kette.
      // Was hier fliegt, faengt kein .catch() beim Aufrufer — es beendet den
      // Prozess. Genau daran ist der Container schon einmal gestorben.
      (err, stdout, stderr) => {
        try {
          if (err) {
            const text = String(stderr || err.message || "");
            return fertig({
              ok: false,
              // ENOENT heisst: gws-cli gibt es auf dieser Maschine nicht. Das
              // ist der Normalfall auf dem Laptop und KEIN Defekt — die
              // Seite sagt das dann auch so, statt "Fehler" zu schreien.
              fehlt: /ENOENT|not found|command not found/i.test(text),
              fehler: text.slice(0, 300),
            });
          }
          fertig({ ok: true, termine: termineLesen(stdout) });
        } catch (e) {
          fertig({ ok: false, fehler: "Kalender-Antwort nicht lesbar: " + String(e.message).slice(0, 200) });
        }
      }
    );
  });
}

// ------------------------------------------------------------- Einsortieren

const istGanztags = (t) => !String(t.start || "").includes("T");

// Minuten seit Mitternacht — die Position im Wochenraster.
function minuten(wert) {
  const m = String(wert || "").match(/T(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

// Auf welchen Tagen liegt ein Termin? Fast immer genau einer, aber ein
// mehrtaegiger gehoert in jede Zelle, die er beruehrt.
//
// Achtung Google-Eigenheit: Bei GANZTAEGIGEN Terminen ist end.date der Tag
// DANACH. Ein eintaegiger Termin am 27. kommt als start 27., ende 28. — wer
// das nicht abzieht, malt jeden ganztaegigen Termin einen Tag zu lang.
function tageVon(t) {
  const von = String(t.start).slice(0, 10);
  let bis = String(t.ende || t.start).slice(0, 10);
  if (istGanztags(t) && bis > von) bis = tagPlus(bis, -1);
  if (!istGanztags(t)) {
    // Ein Termin, der exakt um Mitternacht endet, gehoert noch zum Vortag.
    if (bis > von && minuten(t.ende) === 0) bis = tagPlus(bis, -1);
  }
  if (bis < von) bis = von;

  const tage = [];
  for (let tag = von; tag <= bis && tage.length < 60; tag = tagPlus(tag, 1)) tage.push(tag);
  return tage;
}

// { "2026-07-27": [termin, …] } — je Tag chronologisch, ganztaegige zuerst.
function nachTagen(termine) {
  const karte = {};
  for (const t of termine || []) {
    for (const tag of tageVon(t)) (karte[tag] ??= []).push(t);
  }
  for (const tag of Object.keys(karte)) {
    karte[tag].sort((a, b) => {
      const ga = istGanztags(a), gb = istGanztags(b);
      if (ga !== gb) return ga ? -1 : 1;
      return minuten(a.start) - minuten(b.start) || String(a.titel).localeCompare(String(b.titel), "de");
    });
  }
  return karte;
}

// hh:mm aus einem Zeitstempel — leer bei ganztaegigen Terminen.
const uhrzeit = (wert) => {
  const m = String(wert || "").match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "";
};

// Dauer in Minuten; mindestens 30, damit ein Kurztermin im Raster noch
// anklickbar bleibt.
function dauer(t) {
  const von = minuten(t.start);
  let bis = minuten(t.ende);
  if (String(t.ende || "").slice(0, 10) > String(t.start).slice(0, 10)) bis = 24 * 60;
  return Math.max(30, bis - von || 60);
}

module.exports = {
  spanne, nachTagen, tageVon, istGanztags, minuten, uhrzeit, dauer,
  berlinDatum, heuteTag, tagPlus, montagVon, wochenAnfang, WOCHENSTART,
  ersterDesMonats, letzterDesMonats, monatPlus, tagOderHeute, alsDate,
  // Schreiben bleibt in werkzeuge.js — hier nur durchgereicht, damit die
  // Routen nur EINE Kalender-Datei kennen muessen.
  terminEintragen: werkzeuge.terminEintragen,
  terminAendern: werkzeuge.terminAendern,
  terminAbsagen: werkzeuge.terminAbsagen,
};
