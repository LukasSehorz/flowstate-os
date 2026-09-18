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
// Betrag faellt sonst erst beim Steuerberater auf. Was sauber gelesen wurde,
// laesst sich auf der Belege-Seite in EINEM Klick sammelbuchen
// (buchhaltung.js: belegeSammelBuchen) — das ist die Bestaetigung, nur nicht
// mehr Beleg fuer Beleg.
//
// ZWEI SICHERUNGEN GEGEN DOPPELTE ARBEIT:
//   1. Gmail selbst merkt sich, was erledigt ist — jede verarbeitete Mail
//      bekommt das Etikett "Flowstate/verbucht". Damit ueberlebt der Merker
//      jeden Neustart und ist im Postfach nachvollziehbar.
//   2. Die Belegablage erkennt gleiche Dateien an ihrer Pruefsumme und meldet
//      "doppelt" statt ein zweites Mal anzulegen.
//
// Die Suche ist bewusst eng: nur Mails MIT PDF-Anhang, deren Betreff oder
// Absender nach Rechnung klingt — oder deren PDF selbst so heisst (seit
// 18.09.2026: "Ihre Bestellung" mit Rechnung_4711.pdf im Anhang ist eine
// Rechnung). Lieber eine uebersehen, die Lukas dann selbst weiterleitet, als
// jeden Newsletter mit Anhang in die Buchhaltung zu kippen.
//
// MEHRERE POSTFAECHER (18.09.2026): Lukas' Konto haengt ueber gws-cli dran,
// weitere (Jannik) ueber Token-Dateien im Ordner postfaecher/ — siehe
// lib/gmail-direkt.js. Jeder Lauf geht alle durch; die Rueckschau
// ("alles seit Tag X") laeuft im Hintergrund, weil hunderte Belege lesen
// laenger dauert, als ein Browser auf eine Antwort wartet.

const { execFile } = require("child_process");
const gmail = require("./gmail-direkt.js");

const ETIKETT = "Flowstate/verbucht";
const MAX_MB = 24;
// Wie viele Mails ein Lauf hoechstens anfasst. Der Tageslauf braucht wenige;
// die Rueckschau ueber Monate darf mehr — und wird von Gmail seitenweise
// bedient (gmail-direkt.js) bzw. per --max (gws-cli).
const MAX_TAEGLICH = 25;
const MAX_RUECKSCHAU = 500;

// Woran man eine Rechnung erkennt. Deutsch und englisch, weil Dienste wie
// Paddle, Anthropic oder Netlify auf Englisch abrechnen.
const RECHNUNG = /rechnung|invoice|receipt|beleg|quittung|zahlungsbestätigung|payment|billing|abrechnung/i;

// Eigene Absender. Was von hier kommt, ist eine gestellte Rechnung — also eine
// Forderung, keine Ausgabe. Sie gehoert nicht in den Belegeingang.
// svhconsult.de steht seit 18.09.2026 in der Vorgabe: Das angeschlossene
// Postfach IST lukas.sehorz@svhconsult.de (DIENST_KONTO), und ohne die Domaene
// hier waere eine von Jannik weitergeleitete eigene Rechnung als Ausgabe
// durchgegangen.
const EIGEN = new RegExp(
  (process.env.EIGENE_DOMAENEN || "flowstate-ai.net,svhconsult.de").split(/[,\s]+/).filter(Boolean)
    .map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");

const istTag = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

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

// ------------------------------------------------------------ Reine Rechnerei

// Die Gmail-Anfrage. tage ODER seit (JJJJ-MM-TT) — seit gewinnt.
//
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
function frageBauen({ tage = 2, seit = "" } = {}) {
  const zusatz = String(process.env.MAIL_BELEGE_SUCHE || "").trim();
  const zeit = istTag(seit) ? `after:${seit.replace(/-/g, "/")}` : `newer_than:${tage}d`;
  return `has:attachment filename:pdf ${zeit} -label:${ETIKETT.replace(/\//g, "-")} -from:me -in:sent${zusatz ? " " + zusatz : ""}`;
}

// Betreff oder Absender klingt nach Rechnung — und der Absender ist nicht wir.
const sicherRechnung = (m) =>
  (RECHNUNG.test(String(m.subject || "")) || RECHNUNG.test(String(m.from || "")))
  && !EIGEN.test(String(m.from || ""));

// Von uns selbst? Dann nie — egal wie die Datei heisst.
const vonUns = (m) => EIGEN.test(String(m.from || ""));

// Der Dateiname als zweite Chance: "Rechnung_4711.pdf", "invoice-2026-08.pdf".
// Ein PDF, das "Angebot" oder "Vertrag" heisst, bleibt draussen.
const passtDateiname = (name) => /\.pdf$/i.test(String(name || "")) && RECHNUNG.test(String(name || ""));

// ------------------------------------------------------------- Die Postfaecher
//
// Zwei Wege, ein Gesicht: { name, suchen(frage, max), anhaenge(id),
// anhangHolen(id, aid), etikettSetzen(id) }.

// Das Hauptkonto ueber gws-cli — Suche und Etikett gehen durch dessen
// Sicherheitshuelle, die Anhaenge (die gws-cli nicht kann) direkt.
function hauptPostfach() {
  return {
    name: "",
    async suchen(frage, max) {
      return auspacken(await gws(["gmail", "search", frage, "--max", String(max)], max > 50 ? 120000 : 30000));
    },
    anhaenge: (id) => gmail.anhaenge(id),
    anhangHolen: (id, aid) => gmail.anhangHolen(id, aid),
    async etikettSetzen(id) {
      try { await gws(["gmail", "add-labels", id, ETIKETT]); return true; }
      catch {
        // Das Etikett gibt es beim ersten Lauf noch nicht.
        try { await gws(["gmail", "create-label", ETIKETT]); await gws(["gmail", "add-labels", id, ETIKETT]); return true; }
        catch { return false; }
      }
    },
  };
}

// Ein weiteres Konto (Jannik) — alles direkt ueber dessen Token.
function direktPostfach(k) {
  return {
    name: k.name,
    suchen: (frage, max) => k.suchen(frage, max),
    anhaenge: (id) => k.anhaenge(id),
    anhangHolen: (id, aid) => k.anhangHolen(id, aid),
    etikettSetzen: (id) => k.etikettSetzen(id, ETIKETT),
  };
}

// Alle angeschlossenen Postfaecher: Hauptkonto zuerst, dann der Ordner.
function allePostfaecher() {
  const raus = [];
  if (gmail.bereit()) raus.push(hauptPostfach());
  for (const k of gmail.postfaecher()) raus.push(direktPostfach(k));
  return raus;
}

// Was im Postfach nach Rechnung aussieht: sicher (Betreff/Absender) und
// unklar (nur ein PDF dabei — entscheidet der Dateiname, siehe laufen).
async function kandidaten(postfach, { tage = 2, seit = "", max = MAX_TAEGLICH } = {}) {
  const liste = await postfach.suchen(frageBauen({ tage, seit }), max);
  const sicher = [], unklar = [];
  // Das Etikett-Ausschlusskriterium greift erst, wenn es das Etikett gibt.
  // Zur Sicherheit wird zusaetzlich am Betreff gefiltert — und noch einmal am
  // Absender: Was von einer eigenen Adresse kommt, ist keine Ausgabe. Auch
  // dann nicht, wenn Gmail es durchgelassen hat.
  for (const m of liste) {
    if (vonUns(m)) continue;
    (sicherRechnung(m) ? sicher : unklar).push(m);
  }
  return { sicher, unklar };
}

// tage: wie weit zurueck gesucht wird. Der taegliche Lauf nimmt 2 — ein Tag
// waere knapp, wenn ein Lauf einmal ausfaellt. (Hauptkonto, nur die sicheren
// Treffer — so prueft es scripts/test-mail-belege.js.)
async function suchen(tage = 2, opt = {}) {
  return (await kandidaten(hauptPostfach(), { tage, ...opt })).sicher;
}

// ---------------------------------------------------------------- Ein Lauf
//
// dash kommt von aussen (Telegram, server.js oder die Belege-Seite), damit
// dieses Modul nicht selbst wissen muss, wie man sich am Dashboard anmeldet.
//   tage / seit   Zeitraum (seit gewinnt)
//   max           Mails je Postfach hoechstens
//   melden        Funktion fuer den Bericht (Telegram), optional
//   fortschritt   Funktion (stand) fuer die Anzeige, optional
async function laufen({ dash, tage = 2, seit = "", max = null, melden = null, fortschritt = null } = {}) {
  const postfaecher = allePostfaecher();
  if (!postfaecher.length) return { ok: false, hint: "Kein Google-Zugang hinterlegt." };
  const hoechstens = max || (istTag(seit) ? MAX_RUECKSCHAU : MAX_TAEGLICH);

  const neu = [];
  const uebersprungen = [];
  const konten = [];
  let geprueft = 0;
  const sagen = () => { if (fortschritt) try { fortschritt({ geprueft, neu: neu.length, uebersprungen: uebersprungen.length, konten: konten.slice() }); } catch { /* Anzeige ist Beiwerk */ } };

  for (const pf of postfaecher) {
    const kontoName = pf.name || "Hauptkonto";
    let k;
    try { k = await kandidaten(pf, { tage, seit, max: hoechstens }); }
    catch (e) {
      // Ein Postfach, das nicht antwortet, haelt die anderen nicht auf — aber
      // es wird gesagt. Ist es das einzige, ist der Lauf gescheitert.
      const grund = "Postfach nicht erreichbar: " + String(e.message).slice(0, 120);
      konten.push({ name: kontoName, fehler: grund, mails: 0, neu: 0 });
      if (postfaecher.length === 1) return { ok: false, hint: grund };
      continue;
    }
    const stand = { name: kontoName, mails: k.sicher.length + k.unklar.length, neu: 0, fehler: null };
    konten.push(stand);

    // Erst die sicheren, dann die unklaren — bei denen entscheidet der
    // Dateiname, und dafuer muss man die Anhangsliste holen.
    const arbeit = [...k.sicher.map((m) => ({ m, nurBeiName: false })), ...k.unklar.map((m) => ({ m, nurBeiName: true }))];
    for (const { m, nurBeiName } of arbeit) {
      geprueft += 1;
      let anh;
      try { anh = await pf.anhaenge(m.id); }
      catch { sagen(); continue; }
      let pdfs = anh.filter((a) => /pdf/i.test(a.typ) || /\.pdf$/i.test(a.name));
      if (nurBeiName) pdfs = pdfs.filter((a) => passtDateiname(a.name));
      if (!pdfs.length) { sagen(); continue; }

      let etwasGetan = false;
      for (const a of pdfs) {
        if (a.groesse > MAX_MB * 1024 * 1024) { uebersprungen.push(`${a.name} (zu groß)`); continue; }
        let daten;
        try { daten = await pf.anhangHolen(m.id, a.id); }
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

        stand.neu += 1;
        neu.push({
          konto: kontoName,
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
      if (etwasGetan) await pf.etikettSetzen(m.id);
      sagen();
    }
  }

  const bericht = berichtBauen(neu, uebersprungen, { tage, seit, konten });
  if (melden && (neu.length || uebersprungen.length)) await melden(bericht);
  return { ok: true, neu: neu.length, uebersprungen: uebersprungen.length, geprueft, konten, reply: bericht };
}

function berichtBauen(neu, uebersprungen, { tage = 2, seit = "", konten = [] } = {}) {
  const zeitraum = istTag(seit) ? `seit ${seit.split("-").reverse().join(".")}` : `${tage} Tage geprüft`;
  const kaputt = konten.filter((k) => k.fehler).map((k) => `${k.name}: ${k.fehler}`);
  const kaputtText = kaputt.length ? `\n\nNicht erreichbar — ${kaputt.join("; ")}.` : "";
  if (!neu.length && !uebersprungen.length) {
    return `Keine neuen Rechnungen im Postfach (${zeitraum}).${kaputtText}`;
  }
  const euro = (n) => Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " Euro";
  const mehrere = konten.filter((k) => !k.fehler).length > 1;
  const zeilen = neu.map((r) => {
    const wer = r.gegenstelle || r.von || "unbekannt";
    return `· Beleg ${r.laufnummer}: ${wer}` + (r.betrag ? `, ${euro(r.betrag)}` : " (Betrag nicht erkannt)")
      + (mehrere ? ` — ${r.konto}` : "");
  });
  const rest = uebersprungen.length
    ? `${neu.length ? "\n\n" : ""}Nicht verarbeitet: ${uebersprungen.join(", ")}.`
    : "";

  // Kam nichts durch, darf da NICHT "0 neue Rechnungen:" mit leerer Liste
  // stehen (07.08. beim ersten echten Lauf so gesehen). Das las sich, als sei
  // alles in Ordnung — dabei war jede einzelne gescheitert.
  if (!neu.length) {
    return `Keine Rechnung ließ sich aus dem Postfach übernehmen (${uebersprungen.length} versucht).${rest}${kaputtText}`;
  }

  const kopf = neu.length === 1
    ? "Eine neue Rechnung aus dem Postfach:"
    : `${neu.length} neue Rechnungen aus dem Postfach (${zeitraum}):`;
  return `${kopf}\n${zeilen.join("\n")}\n\nLiegen im Belegeingang — schau kurz drüber und hak sie ab.${rest}${kaputtText}`;
}

// ------------------------------------------------------------- Die Rueckschau
//
// "Alle Rechnungen, die wir bis jetzt bekommen haben" (Lukas, 18.09.2026).
// Hunderte Mails, jede mit einem Lesevorgang von einigen Sekunden: Das dauert
// Minuten, und ein Browser wartet keine Minuten. Darum laeuft der Lauf hier
// im Hintergrund, und die Belege-Seite zeigt den Stand. Es laeuft immer nur
// EINE Rueckschau — eine zweite waehrenddessen wird abgewiesen, nicht
// angestellt.
let rueckschau = null;   // { laeuft, seit, gestartet, fertig, stand, ergebnis }

function rueckschauStatus() { return rueckschau; }

function rueckschauStarten({ dash, seit, melden = null }) {
  if (!istTag(seit)) return { ok: false, grund: "seit" };
  if (rueckschau?.laeuft) return { ok: false, grund: "laeuft" };
  rueckschau = { laeuft: true, seit, gestartet: new Date(), fertig: null, stand: { geprueft: 0, neu: 0, uebersprungen: 0, konten: [] }, ergebnis: null };
  const eigene = rueckschau;
  laufen({ dash, seit, melden, fortschritt: (s) => { eigene.stand = s; } })
    .then((r) => { eigene.ergebnis = r; })
    .catch((e) => { eigene.ergebnis = { ok: false, hint: String(e.message).slice(0, 200) }; })
    .finally(() => { eigene.laeuft = false; eigene.fertig = new Date(); console.log(`Postfach-Rückschau seit ${seit}: ${eigene.ergebnis?.ok ? `${eigene.ergebnis.neu} neu, ${eigene.ergebnis.geprueft} geprüft` : eigene.ergebnis?.hint}`); });
  return { ok: true };
}

module.exports = {
  laufen, suchen, kandidaten, frageBauen, passtDateiname, allePostfaecher,
  rueckschauStarten, rueckschauStatus,
  MAX_TAEGLICH, MAX_RUECKSCHAU,
};
