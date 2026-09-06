// Rechnungen aus dem Postfach in den Belegeingang holen.
//
// Warum (Lukas, 07.08.2026): "Wenn eine Rechnung an meine Mail kommt,
// lukas.sehorz@flowstate-ai.net, dann soll am Ende des Tages das immer
// ueberprueft werden. Wenn da eine neue Rechnung kommt, soll das rausgezogen
// werden und abgebucht werden."
//
// Derselbe Weg wie bei Telegram (lib/beleg-telegram.js), nur mit dem Postfach
// als Quelle: ablegen, auslesen, melden. Auch hier wird NICHT von selbst
// gebucht — der Belegleser macht einen Vorschlag, und ein falsch erkannter
// Betrag faellt sonst erst beim Steuerberater auf.
//
// ZWEI SICHERUNGEN GEGEN DOPPELTE ARBEIT:
//   1. Gmail selbst merkt sich, was erledigt ist — jede verarbeitete Mail
//      bekommt das Etikett "Flowstate/verbucht". Damit ueberlebt der Merker
//      jeden Neustart und ist im Postfach nachvollziehbar.
//   2. Die Belegablage erkennt gleiche Dateien an ihrer Pruefsumme und meldet
//      "doppelt" statt ein zweites Mal anzulegen.
//
// Die Suche ist bewusst eng: nur Mails MIT PDF-Anhang, deren Betreff oder
// Absender nach Rechnung klingt. Lieber eine uebersehen, die Lukas dann selbst
// weiterleitet, als jeden Newsletter mit Anhang in die Buchhaltung zu kippen.

const { execFile } = require("child_process");
const gmail = require("./gmail-direkt.js");

const ETIKETT = "Flowstate/verbucht";
const MAX_MB = 24;

// Woran man eine Rechnung erkennt. Deutsch und englisch, weil Dienste wie
// Paddle, Anthropic oder Netlify auf Englisch abrechnen.
const RECHNUNG = /rechnung|invoice|receipt|beleg|quittung|zahlungsbestätigung|payment|billing|abrechnung/i;

// Eigene Absender. Was von hier kommt, ist eine gestellte Rechnung — also eine
// Forderung, keine Ausgabe. Sie gehoert nicht in den Belegeingang.
const EIGEN = new RegExp(
  (process.env.EIGENE_DOMAENEN || "flowstate-ai.net").split(/[,\s]+/).filter(Boolean)
    .map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");

function gws(args, timeoutMs = 30000) {
  return new Promise((fertig, fehler) => {
    execFile("gws-cli", args, { env: { ...process.env, GWS_ENCRYPTION: "none" }, timeout: timeoutMs, maxBuffer: 20e6 },
      (err, stdout, stderr) => (err ? fehler(new Error(String(stderr || err.message).slice(0, 200))) : fertig(stdout)));
  });
}

// gws-cli verpackt externe Inhalte in eine Sicherheitshuelle: die Nutzdaten
// stehen als JSON-STRING in .data. Wer nur .messages nimmt, bekommt ein Objekt
// statt der Liste.
function auspacken(stdout) {
  try {
    const o = JSON.parse(stdout);
    const roh = o?.messages?.data ?? o?.data ?? "[]";
    return typeof roh === "string" ? JSON.parse(roh) : (Array.isArray(roh) ? roh : []);
  } catch { return []; }
}

async function etikettSetzen(id) {
  try { await gws(["gmail", "add-labels", id, ETIKETT]); return true; }
  catch {
    // Das Etikett gibt es beim ersten Lauf noch nicht.
    try { await gws(["gmail", "create-label", ETIKETT]); await gws(["gmail", "add-labels", id, ETIKETT]); return true; }
    catch { return false; }
  }
}

// tage: wie weit zurueck gesucht wird. Der taegliche Lauf nimmt 2 — ein Tag
// waere knapp, wenn ein Lauf einmal ausfaellt.
async function suchen(tage = 2) {
  // -from:me schliesst aus, was Lukas SELBST verschickt hat (07.08. beim ersten
  // echten Lauf aufgefallen). Der erste Durchgang zog seine eigene Rechnung an
  // die Estera GmbH ueber 3.500 € in den Belegeingang — als AUSGABE. Das ist
  // eine Einnahme, und in der falschen Spalte verschiebt sie das Ergebnis um
  // den doppelten Betrag.
  //
  // -in:sent zusaetzlich, weil "from:me" bei Adress-Weiterleitungen nicht immer
  // greift. Zwei Schranken sind hier billiger als eine falsch gebuchte Rechnung.
  // MAIL_BELEGE_SUCHE (05.09.2026): ein Zusatzfilter in Gmail-Syntax, z. B.
  // "-from:newsletter@" oder "label:Rechnungen" — fuer Postfaecher, in denen
  // die Betreff-Regel unten zu grob oder zu fein ist. Leer = wie bisher.
  const zusatz = String(process.env.MAIL_BELEGE_SUCHE || "").trim();
  const frage = `has:attachment filename:pdf newer_than:${tage}d -label:${ETIKETT.replace(/\//g, "-")} -from:me -in:sent${zusatz ? " " + zusatz : ""}`;
  let liste = auspacken(await gws(["gmail", "search", frage, "--max", "25"]));
  // Das Etikett-Ausschlusskriterium greift erst, wenn es das Etikett gibt.
  // Zur Sicherheit wird zusaetzlich am Betreff gefiltert.
  return liste
    .filter((m) => RECHNUNG.test(String(m.subject || "")) || RECHNUNG.test(String(m.from || "")))
    // Und noch einmal am Absender: Was von einer eigenen Adresse kommt, ist
    // keine Ausgabe. Auch dann nicht, wenn Gmail es durchgelassen hat.
    .filter((m) => !EIGEN.test(String(m.from || "")));
}

// Ein Lauf. dash kommt von aussen (Telegram oder server.js), damit dieses Modul
// nicht selbst wissen muss, wie man sich am Dashboard anmeldet.
async function laufen({ dash, tage = 2, melden = null } = {}) {
  if (!gmail.bereit()) return { ok: false, hint: "Kein Google-Zugang hinterlegt." };

  let mails;
  try { mails = await suchen(tage); }
  catch (e) { return { ok: false, hint: "Postfach nicht erreichbar: " + String(e.message).slice(0, 120) }; }

  const neu = [];
  const uebersprungen = [];

  for (const m of mails) {
    let anh;
    try { anh = await gmail.anhaenge(m.id); }
    catch { continue; }
    const pdfs = anh.filter((a) => /pdf/i.test(a.typ) || /\.pdf$/i.test(a.name));
    if (!pdfs.length) continue;

    let etwasGetan = false;
    for (const a of pdfs) {
      if (a.groesse > MAX_MB * 1024 * 1024) { uebersprungen.push(`${a.name} (zu groß)`); continue; }
      let daten;
      try { daten = await gmail.anhangHolen(m.id, a.id); }
      catch { uebersprungen.push(a.name); continue; }

      let ab;
      try {
        const r = await dash("/buchhaltung/beleg/hochladen", daten, {
          "X-Art": "ausgabe",
          "X-Dateiname": encodeURIComponent(a.name),
          "X-Dateityp": "application/pdf",
          // Woher der Beleg kam (Migration 0061). Der Leser darf einen
          // Postfach-Beleg umsortieren, wenn er sicher eine Kundenrechnung
          // erkennt — dafuer muss er wissen, dass hier kein Mensch die
          // Richtung gewaehlt hat.
          "X-Quelle": "mail",
        });
        ab = await r.json();
      } catch { uebersprungen.push(a.name); continue; }

      if (!ab?.ok) { uebersprungen.push(a.name); continue; }
      etwasGetan = true;
      // Schon bekannt? Dann Etikett setzen und weiter — nicht nochmal melden.
      if (ab.doppelt) continue;

      let werte = null;
      try {
        const r = await dash("/buchhaltung/beleg/lesen", { id: ab.id });
        const d = await r.json();
        if (d?.ok) werte = d.werte || d;
      } catch { /* Beleg liegt trotzdem */ }

      neu.push({
        laufnummer: ab.laufnummer,
        von: String(m.from || "").replace(/<[^>]*>/, "").replace(/["']/g, "").trim(),
        betreff: String(m.subject || "").slice(0, 80),
        datei: a.name,
        betrag: werte?.betrag ?? null,
        gegenstelle: werte?.gegenstelle ?? null,
      });
    }
    // Erst NACH erfolgreicher Ablage markieren. Wer vorher markiert, verliert
    // die Mail, wenn die Ablage scheitert.
    if (etwasGetan) await etikettSetzen(m.id);
  }

  const bericht = berichtBauen(neu, uebersprungen, tage);
  if (melden && (neu.length || uebersprungen.length)) await melden(bericht);
  return { ok: true, neu: neu.length, uebersprungen: uebersprungen.length, reply: bericht };
}

function berichtBauen(neu, uebersprungen, tage) {
  if (!neu.length && !uebersprungen.length) {
    return `Keine neuen Rechnungen im Postfach (${tage} Tage geprüft).`;
  }
  const euro = (n) => Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " Euro";
  const zeilen = neu.map((r) => {
    const wer = r.gegenstelle || r.von || "unbekannt";
    return `· Beleg ${r.laufnummer}: ${wer}` + (r.betrag ? `, ${euro(r.betrag)}` : " (Betrag nicht erkannt)");
  });
  const rest = uebersprungen.length
    ? `${neu.length ? "\n\n" : ""}Nicht verarbeitet: ${uebersprungen.join(", ")}.`
    : "";

  // Kam nichts durch, darf da NICHT "0 neue Rechnungen:" mit leerer Liste
  // stehen (07.08. beim ersten echten Lauf so gesehen). Das las sich, als sei
  // alles in Ordnung — dabei war jede einzelne gescheitert.
  if (!neu.length) {
    return `Keine Rechnung ließ sich aus dem Postfach übernehmen (${uebersprungen.length} versucht).${rest}`;
  }

  const kopf = neu.length === 1
    ? "Eine neue Rechnung aus dem Postfach:"
    : `${neu.length} neue Rechnungen aus dem Postfach:`;
  return `${kopf}\n${zeilen.join("\n")}\n\nLiegen im Belegeingang — schau kurz drüber und hak sie ab.${rest}`;
}

module.exports = { laufen, suchen };
