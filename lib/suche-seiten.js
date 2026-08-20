// lib/suche-seiten.js — aus einer Trefferliste echte Seiten lesen (20.08.2026).
//
// Warum es diese Datei gibt: Google-Auszuege (die "Snippets") sind fuer den
// harten Fall nicht gut genug. Gemessen am 20.08. an Lukas' Pruefsatz "Wie
// steht der SV Oberbergkirchen in der Tabelle?" lieferte Serper GLEICHZEITIG:
//
//   fussball.de: "Kreisliga 1 Inn/Salzach. 4. Tabellenplatz. 3. Punkte."
//   bfv.de:      "Platz 1 in der Liga Kreisliga 1 Inn/Salzach, Torverhaeltnis 0:0"
//
// Beides steht so bei Google. Eines davon ist alt. Wer nur Auszuege liest,
// wuerfelt zwischen "Platz eins" und "Platz vier" — und eine erfundene
// Tabellenposition ist genau das, was Lukas ausdruecklich nicht will.
//
// Die echte Seite entscheidet: bfv.de trug beim direkten Abruf "tabellenplatz
// 4 | torverhaeltnis 1:0" und die vollstaendige Tabelle. Der Abruf kostete
// 257 ms — billiger als jede Modellrunde.
//
// DREI EIGENHEITEN, die hier bewusst behandelt werden:
//
//   1. Tabellen. "<td>4</td><td>Punkte</td>" wird bei naiver Tag-Entfernung zu
//      "4 Punkte" ohne Trennung zum Nachbarn — Zahlen kleben zusammen und der
//      Sinn ist weg. Zellengrenzen werden deshalb zu " | ".
//   2. Verschleierte Ziffern. fussball.de setzt Spielergebnisse als
//      Symbolschrift (&#xE69A; im Bereich U+E000-U+F8FF). Wer die stehen laesst,
//      gibt dem Modell Zeichensalat, aus dem es sich eine Zahl reimt. Sie
//      fliegen ersatzlos raus: lieber keine Zahl als eine geratene.
//   3. Nur die passende Stelle. Eine Vereinsseite hat 28.000 Zeichen, davon
//      26.000 Menue. Alles ans Modell zu geben waere langsam UND schlechter —
//      die Antwort ertrinkt im Rauschen.

const { erlaubt } = require("./website-lesen.js");

const MAX_BYTES = 900 * 1024;

// Ein echter Browser-Kopf. Nicht als Tarnung, sondern weil mehrere Seiten
// (kicker.de) auf unbekannte Kennungen mit 403 antworten und dann gar nichts
// liefern. Wir lesen nur, was jeder Besucher auch sieht.
const KOPF = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml",
  "accept-language": "de-DE,de;q=0.9,en;q=0.5",
};

const ENTITIES = {
  auml: "ä", Auml: "Ä", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü", szlig: "ß",
  amp: "&", quot: '"', apos: "'", nbsp: " ", shy: "", ndash: "–", mdash: "—",
  hellip: "…", euro: "€", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“",
  rdquo: "”", lt: "<", gt: ">", deg: "°", middot: "·", times: "×", minus: "−",
};

// Zeichen aus dem privaten Unicode-Bereich sind Symbolschrift — bei fussball.de
// sind das genau die Spielstaende. Ohne Schriftdatei bedeuten sie nichts.
const PRIVAT = new RegExp("[\u{E000}-\u{F8FF}\uFFFD]", "gu");

function entschluesseln(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => (n in ENTITIES ? ENTITIES[n] : " "));
}

// HTML -> lesbarer Text mit " | " an jeder Zellen-, Listen- und Absatzgrenze.
function textAus(html) {
  let t = String(html)
    .replace(/<(script|style|noscript|svg|head|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, " | ")
    .replace(/<\/(td|th|tr|li|p|div|h[1-6]|section|option|dd|dt|span)>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  t = entschluesseln(t)
    .replace(PRIVAT, "")
    // Angular/Vue-Platzhalter ("{{streamitem.content.date}}") stehen im
    // Quelltext, aber nie auf dem Bildschirm. Fuer das Modell sind sie Muell.
    .replace(/\{\{[^}]{0,200}\}\}/g, " ")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n+/g, " | ")
    .replace(/(?:\s*\|\s*)+/g, " | ")
    .trim();
  // paareOrdnen steht weiter unten, mit der Begruendung an der Stelle.
  return paareOrdnen(t);
}

// --- Wert-vor-Bezeichnung wieder zusammensetzen ----------------------------
//
// WARUM (gemessen 20.08.2026, zwei falsche Antworten hintereinander): Auf der
// Vereinsseite von fussball.de steht der Kopfblock als Kacheln — erst die Zahl,
// darunter das Wort. Als Text hintereinander gelesen ergibt das:
//
//   ... | 4 | Tabellenplatz | 3 | Punkte | 1:0 | Torverhältnis | Kreisliga | ...
//
// Das Modell las daraus "vier absolvierte Spiele, Platz drei". Nachvollziehbar:
// In der ueblichen Leserichtung gehoert eine Zahl zu dem, was DAVOR steht, hier
// aber zu dem, was DANACH kommt. Das ist keine Modellschwaeche, sondern eine
// Falle im Text — und sie wird hier entschaerft, nicht im Prompt.
//
// Bewusst nur mit einer festen Wortliste: Eine allgemeine Regel "Zahl gehoert
// zum naechsten Wort" wuerde echte Tabellenzeilen zerlegen, in denen Zahl auf
// Zahl folgt.
const BEZEICHNUNGEN = [
  "Tabellenplatz", "Punkte", "Torverhältnis", "Torverhaeltnis", "Tordifferenz",
  "Spielklasse", "Wettbewerb", "Spiele", "Tore", "Platz", "Rang",
  "Einwohner", "Fläche", "Höhe", "Gründung", "Mitglieder", "Mitgliederzahl",
];
// Der Anfang des Textes zaehlt wie ein Trennstrich: textAus setzt "|" nur an
// SCHLIESSENDEN Tags, die allererste Zelle einer Seite hat also keinen davor.
const PAAR = new RegExp(
  "(^|\\|)\\s*([\\d]+(?:[.,:]\\d+)?)\\s*\\|\\s*(" + BEZEICHNUNGEN.join("|") + ")\\s*\\|",
  "gi"
);

function paareOrdnen(text) {
  // Zweimal laufen lassen: Die Treffer ueberlappen sich an den Trennstrichen,
  // ein einzelner Durchgang erwischt deshalb nur jedes zweite Paar.
  let t = String(text);
  for (let i = 0; i < 2; i++) {
    t = t.replace(PAAR, (_, vor, wert, name) => `${vor || ""} ${name}: ${wert} |`);
  }
  return t.replace(/^\s*\|?\s*/, "").replace(/\s{2,}/g, " ");
}

// --- Die passende Stelle finden --------------------------------------------
//
// Der Text wird an " | " in Abschnitte zerlegt. Dann laeuft ein Fenster
// darueber, das so viele Abschnitte umfasst, wie in ~500 Zeichen passen, und
// zaehlt, wie viele Suchbegriffe darin vorkommen. Die besten, sich NICHT
// ueberlappenden Fenster kommen ins Ergebnis.
//
// Warum Fenster statt Einzelabschnitten: In einer Tabelle steht der Begriff in
// der einen Zelle ("Tabellenplatz") und die Zahl in der Nachbarzelle ("4").
// Wer nur den Treffer-Abschnitt nimmt, liefert das Wort ohne den Wert.
// begriffe: Zeichenketten (Gewicht 3) oder { wort, gewicht }.
//
// GEWICHTE SIND NOETIG (gemessen 20.08.2026). Mit gleichem Gewicht fuer alle
// Begriffe gewann auf der Vereinsseite die ABGESCHLOSSENE Tabelle der Vorsaison
// gegen den aktuellen Stand: Sie ist lang, und in jeder ihrer 18 Zeilen stehen
// "Pkt.", "Sp." und Zahlen. Der aktuelle Stand ist ein kurzer Kopfblock — er
// verliert jeden Zaehlwettbewerb, obwohl genau er die Antwort traegt.
//
// Deshalb: Der NAME, nach dem gefragt wurde, wiegt schwer (er steht im
// Kopfblock mehrfach, in der Tabelle einmal), Fachbegriffe wie "Pkt." wiegen
// wenig. Dazu ein Frische-Bonus auf das laufende Jahr und der Anfangsbonus —
// aktuelle Angaben stehen auf solchen Seiten oben, Archive unten.
function passendeStellen(text, begriffe, { max = 1400, fensterZeichen = 500, jahr = null } = {}) {
  const teile = String(text).split(" | ").map((s) => s.trim()).filter(Boolean);
  if (!teile.length) return "";
  const worte = begriffe
    .map((b) => (typeof b === "string" ? { wort: b.toLowerCase(), gewicht: 3 }
      : { wort: String(b.wort || "").toLowerCase(), gewicht: Number(b.gewicht) || 3 }))
    .filter((b) => b.wort.length > 2);
  if (!worte.length) return teile.join(" | ").slice(0, max);

  const jetztJahr = String(jahr || new Date().getFullYear());

  const punkte = teile.map((s) => {
    const k = s.toLowerCase();
    let p = 0;
    for (const w of worte) if (k.includes(w.wort)) p += w.gewicht;
    // Eine Zahl im kurzen Abschnitt ist bei diesen Fragen oft die Antwort —
    // aber nur ein Hauch, sonst gewinnt jede beliebige Tabelle.
    if (/\d/.test(s) && s.length < 120) p += 0.25;
    // Das laufende Jahr ist das staerkste Frischesignal, das eine Seite hergibt.
    if (s.includes(jetztJahr)) p += 5;
    return p;
  });
  const laengen = teile.map((s) => s.length + 3);

  // Zwei Zeiger: [a..b) bleibt unter fensterZeichen.
  const fenster = [];
  let b = 0, summeL = 0, summeP = 0;
  for (let a = 0; a < teile.length; a++) {
    if (b < a) { b = a; summeL = 0; summeP = 0; }
    while (b < teile.length && summeL + laengen[b] <= fensterZeichen) {
      summeL += laengen[b]; summeP += punkte[b]; b++;
    }
    // Anfangsbonus: bis zu +25 % fuer den Seitenanfang, linear auslaufend.
    if (summeP > 0) fenster.push({ a, b, p: summeP * (1 + 0.25 * (1 - a / teile.length)), l: summeL });
    summeL -= laengen[a]; summeP -= punkte[a];
  }
  if (!fenster.length) return teile.slice(0, 8).join(" | ").slice(0, max);

  fenster.sort((x, y) => y.p - x.p || x.a - y.a);
  const genommen = [];
  let laenge = 0;
  for (const f of fenster) {
    if (laenge >= max) break;
    if (genommen.some((g) => f.a < g.b && g.a < f.b)) continue;   // Ueberlappung
    genommen.push(f);
    laenge += f.l;
    if (genommen.length >= 3) break;
  }
  genommen.sort((x, y) => x.a - y.a);
  return genommen.map((f) => teile.slice(f.a, f.b).join(" | ")).join("  …  ").slice(0, max);
}

// --- Eine Seite holen -------------------------------------------------------
//
// Wirft nie. Liefert { ok, text, url } oder { ok:false, grund }.
// Die Adresspruefung kommt aus website-lesen.js — dieselbe Schranke gegen
// Abrufe im eigenen Netz, kein zweites Regelwerk daneben.
async function seiteHolen(url, { timeoutMs = 2500 } = {}) {
  try {
    const pruefung = await erlaubt(url);
    if (!pruefung.ok) return { ok: false, grund: pruefung.grund };
    const r = await fetch(pruefung.url, {
      headers: KOPF,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { ok: false, grund: "HTTP " + r.status };
    const typ = r.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(typ)) return { ok: false, grund: "kein HTML" };
    const puffer = Buffer.from(await r.arrayBuffer());
    if (puffer.length > MAX_BYTES) return { ok: false, grund: "zu gross" };
    const text = textAus(puffer.toString("utf-8"));
    if (text.length < 150) return { ok: false, grund: "kaum Text" };
    return { ok: true, text, url: pruefung.url };
  } catch (e) {
    const m = String(e.message || "");
    return { ok: false, grund: /timeout|abort/i.test(m) ? "antwortet nicht" : m.slice(0, 60) };
  }
}

// Mehrere Seiten NEBENEINANDER lesen, mit einer harten Gesamtfrist.
//
// Die Frist ist der eigentliche Punkt: Lukas wartet. Was in der Frist da ist,
// kommt mit; der Rest faellt weg, ohne dass jemand darauf wartet. Deshalb
// Promise.race gegen einen Wecker statt Promise.all.
async function seitenLesen(links, begriffe, { timeoutMs = 2500, anzahl = 3, jeSeite = 1100, jahr = null } = {}) {
  const ziele = links.slice(0, anzahl);
  if (!ziele.length) return [];
  const ergebnisse = new Array(ziele.length).fill(null);

  const laeufe = ziele.map((l, i) =>
    seiteHolen(l.url, { timeoutMs }).then((r) => {
      if (r.ok) {
        ergebnisse[i] = {
          titel: l.titel || "", url: r.url, domain: l.domain || domainVon(r.url),
          text: passendeStellen(r.text, begriffe, { max: jeSeite, jahr }),
        };
      }
    }).catch(() => {})
  );

  const wecker = new Promise((r) => { const t = setTimeout(r, timeoutMs + 300); t.unref?.(); });
  await Promise.race([Promise.all(laeufe), wecker]);
  return ergebnisse.filter(Boolean);
}

function domainVon(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

module.exports = { textAus, passendeStellen, seiteHolen, seitenLesen, domainVon, entschluesseln, paareOrdnen };
