// lib/suche-web.js — Alexandra schaut im Internet nach (20.08.2026).
//
// Der Pruefsatz von Lukas, woertlich:
//
//   "Wie steht der SV Oberbergkirchen in der Tabelle?"
//   "Wie haben sie am Wochenende gespielt?"
//
// Das ist absichtlich der haerteste Fall: Ein Kreisliga-Verein aus Oberbayern
// steht in keinem Sprachmodell und in keiner Wikipedia. Die Antwort steht auf
// fussball.de und bfv.de — und die zweite Frage nennt den Verein nicht mehr.
//
// VIER ANFORDERUNGEN, und der Bau folgt ihnen der Reihe nach:
//
//  1. SCHNELL. Ueber 10 s Stille wirken im Gespraech wie ein Absturz. Der Weg
//     hier ist deshalb fest verdrahtet statt agentisch — drei Stufen, jede mit
//     eigener Frist, und ALLES, was nebeneinander laufen kann, laeuft auch so:
//
//       Stufe 1  Suchtreffer UND Nachrichten gleichzeitig   ~0,9 s
//       Stufe 2  bis zu vier echte Seiten gleichzeitig      ~0,2 s
//       Stufe 3  ein Modellaufruf, der daraus einen Satz macht  ~1,0 s
//
//     Kein Modell entscheidet unterwegs, ob es nochmal sucht — genau daran ist
//     die alte Denk-Spur gestorben (25.07.: 40 s Timeout ohne jede Antwort).
//     Gemessen ueber 27 echte Fragen am 20.08.: Median 2,4 s, langsamste 5,6 s.
//
//  2. RICHTIG ODER EHRLICH. Steht die Antwort nicht im Gefundenen, sagt das
//     Modell "NICHT GEFUNDEN" und Lukas hoert "Das finde ich gerade nicht".
//     Eine erfundene Tabellenposition waere schlimmer als keine.
//
//  3. VORLESBAR. `gesprochen` ist ein Satz fuer die Stimme — Zahlen als Worte,
//     keine URL, keine Aufzaehlung. `reply` darf die Quelle tragen, weil sie
//     im Chat nachschlagbar sein soll.
//
//  4. RUECKBEZUG. "Wie haben SIE am Wochenende gespielt" muss ohne erneute
//     Nennung funktionieren. Das loest hier ein Gedaechtnis ueber das zuletzt
//     gesuchte Thema, nicht das Modell: Ein Modellaufruf mehr waere eine
//     Sekunde mehr Stille fuer etwas, das ein Woerterbuchvergleich kann.
//
// WARUM NICHT schnell.denke() (Sonnet mit Anthropic-Websuche): Dort sucht das
// Modell selbst und entscheidet selbst, wie oft. Gemessen 22.-25.07.: 9 bis
// 35 s, teils Timeout. Das Modell kommt hier NUR noch ans Ende und formuliert.

const seiten = require("./suche-seiten.js");
const schnell = require("./schnell.js");
const aussprache = require("./aussprache.js");

let sprachlog = null;
try { sprachlog = require("./sprachlog.js"); } catch { /* Protokoll ist Kuer */ }

// Haiku 4.5 formuliert. Grund: Es ist der schnellste Weg zu einem deutschen
// Satz (gemessen 20.08.: 0,9 s mit Werkzeugen, ~1,2 s fuer diesen Satz), und
// es soll hier nichts entscheiden — nur wiedergeben, was dasteht.
const FORMULIER_MODELL = process.env.SUCHE_SATZ_MODELL || "claude-haiku-4-5";

// --- Zeitbudget ------------------------------------------------------------
//
// Die Summe ist die Zusage: unter 6 s bis zum gesprochenen Satz. Jede Stufe hat
// ihre eigene Frist, damit eine lahme Seite nicht das Ganze aufhaelt.
const FRIST_SUCHE = Number(process.env.SUCHE_FRIST_SUCHE_MS || 3500);
// 2,2 s fuer die Seiten, nicht 2,6 (nachgemessen 20.08.2026): Bei zwoelf von
// dreizehn Fragen waren alle vier Seiten in unter 800 ms da. Die Ausnahme war
// der Wikipedia-Artikel zur Champions League — 300.000 Zeichen, die die Frist
// voll ausschoepften und den Gesamtlauf einmal auf 6,2 s hoben. Genau das soll
// nicht passieren: Die vierte, langsamste Seite ist eine Zugabe, keine
// Bedingung — und Lukas wartet lieber nicht darauf.
const FRIST_SEITEN = Number(process.env.SUCHE_FRIST_SEITEN_MS || 2200);
const FRIST_SATZ = Number(process.env.SUCHE_FRIST_SATZ_MS || 7000);

// --- Frage saeubern --------------------------------------------------------
//
// Google versteht ganze Fragen besser als Stichwoerter. Weg muss nur der
// Gespraechs-Vorspann ("Hey Alexandra, kannst du mal googeln, ...") — der
// verschiebt die Treffer auf Seiten ueber Sprachassistenten.
function frageSaeubern(frage) {
  return String(frage || "")
    .replace(/^\s*(?:hey|hallo|he)\s+\w+\s*[,!.]?\s*/i, "")
    .replace(/^\s*(?:kannst du (?:mir )?(?:mal )?(?:kurz )?(?:bitte )?(?:sagen|nachschauen|nachsehen|raussuchen|rausfinden|googeln|schauen|gucken)|schau (?:mal )?(?:kurz )?nach|google(?:st du)?(?: mal)?|such(?:e|st du)?(?: mal)?(?: kurz)?|recherchier(?:e|st du)?(?: mal)?(?: kurz)?|weisst du(?: eigentlich)?|sag mir(?: mal)?)\b[,:]?\s*/i, "")
    .replace(/\bim internet\b|\bim netz\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,;:]\s*/, "")
    .trim() || String(frage || "").trim();
}

// --- Rueckbezug ------------------------------------------------------------
//
// Woerter, die auf etwas vorher Gesagtes zeigen statt selbst etwas zu benennen.
//
// ZWEI STAERKEN, und der Unterschied ist keine Feinheit (gemessen 20.08.2026):
//
// "Und wer ist dort Bürgermeister?" wurde nach "Wie viele Einwohner hat
// Erding?" NICHT aufgeloest — und Alexandra antwortete ueber Lollar in Hessen.
// Der Grund: Die Frage enthaelt das grossgeschriebene Wort "Bürgermeister", und
// die Pruefung "traegt die Frage selbst einen Namen?" hielt das fuer einen.
// Deutsch schreibt jedes Substantiv gross; diese Pruefung kann darum NIE sicher
// sein.
//
// STARKE Zeiger ("dort", "sie", "deren") zeigen aber IMMER nach hinten. Sie
// setzen sich deshalb ueber jede Namensvermutung hinweg. Nur die SCHWACHEN
// ("die", "der", "das", "es") sind zweideutig — bei ihnen entscheidet weiter,
// ob die Frage schon selbst ein Thema hat.
const STARKE_ANAPHER = /(^|\s)(sie|ihnen|ihre[nmrs]?|deren|dessen|denen|dort|davon|dazu|damit|dagegen|dieselben?|derselben?|ihn)(\s|[,.?!]|$)/i;
const SCHWACHE_ANAPHER = /(^|\s)(die|der|das|den|dem|er|es|ihr|seine[nmrs]?|da)(\s|[,.?!]|$)/i;
const ANAPHER = new RegExp(STARKE_ANAPHER.source + "|" + SCHWACHE_ANAPHER.source, "i");

// Ortszeiger brauchen eine Praeposition, sonst entsteht Kauderwelsch: Aus
// "Und wer ist dort Buergermeister?" wuerde sonst "wer ist Erding
// Buergermeister" statt "wer ist in Erding Buergermeister".
const ZEIGER_ERSATZ = {
  dort: "in ", da: "in ", davon: "von ", dazu: "zu ", damit: "mit ", dagegen: "gegen ",
};

// Alles, was in einer deutschen Frage grossgeschrieben ist, ohne ein Name zu
// sein. Deutsch schreibt JEDES Substantiv gross — ohne diese Liste haelt jede
// Heuristik "Tabelle" fuer einen Vereinsnamen.
const KEIN_NAME = new Set([
  "tabelle", "tabellenplatz", "platz", "punkte", "spiel", "spiele", "ergebnis", "ergebnisse",
  "wochenende", "samstag", "sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag",
  "woche", "monat", "jahr", "saison", "liga", "verein", "mannschaft", "team", "tor", "tore",
  "einwohner", "preis", "preise", "kosten", "entfernung", "kilometer", "meter", "grad", "wetter",
  "nachrichten", "news", "uhr", "uhrzeit", "prozent", "euro", "stadt", "land", "firma", "kunde",
  "was", "wer", "wie", "wann", "wo", "warum", "welche", "welcher", "welches", "wieso", "wieviel",
  "hat", "haben", "ist", "sind", "steht", "stehen", "gibt", "und", "oder", "aber", "der", "die",
  "das", "den", "dem", "des", "ein", "eine", "einen", "heute", "gestern", "morgen", "aktuell",
  "moment", "zeit", "leute", "menschen", "sachen", "dinge", "frage", "antwort", "quelle",
]);

// Kuerzel, an denen ein Eigenname sicher zu erkennen ist.
const NAMENSMARKE = /^(SV|FC|TSV|SC|SpVgg|DJK|ASV|TuS|VfB|VfL|BSC|MTV|1\.|GmbH|AG|KG|UG|e\.?V\.?)$/i;

// Aus einer Frage die moeglichen Eigennamen ziehen — laengste zuerst.
//
// Ein Kandidat ist eine ununterbrochene Folge grossgeschriebener Woerter, das
// erste Wort des Satzes ausgenommen (dort ist Grossschreibung bedeutungslos).
function namensKandidaten(frage) {
  const worte = String(frage || "").replace(/[?!.,;:„“"']/g, " ").split(/\s+/).filter(Boolean);
  const kandidaten = [];
  let lauf = [];
  const abschliessen = () => {
    if (lauf.length) {
      // Jede zusammenhaengende Teilfolge, laengste zuerst.
      for (let l = lauf.length; l >= 1; l--) {
        for (let a = 0; a + l <= lauf.length; a++) kandidaten.push(lauf.slice(a, a + l).join(" "));
      }
    }
    lauf = [];
  };
  worte.forEach((w, i) => {
    const gross = /^[A-ZÄÖÜ0-9]/.test(w) && w.length > 1;
    const brauchbar = gross && (i > 0 || NAMENSMARKE.test(w)) && !KEIN_NAME.has(w.toLowerCase());
    if (brauchbar) lauf.push(w); else abschliessen();
  });
  abschliessen();
  return [...new Set(kandidaten)].sort((a, b) => b.split(" ").length - a.split(" ").length);
}

// Traegt die Frage selbst einen Namen? Dann braucht sie kein Gedaechtnis.
function hatEigenesThema(frage) {
  const k = namensKandidaten(frage);
  return k.some((x) => NAMENSMARKE.test(x.split(" ")[0]) || x.split(" ").length >= 2 || x.length >= 6);
}

// thema: das gemerkte Thema, falls vorhanden. Steht es schon in der Frage, ist
// nichts aufzuloesen — "und wie viele Einwohner hat Erding sonst so" braucht
// kein Gedaechtnis, auch wenn ein Zeigewort darin vorkommt.
function brauchtRueckbezug(frage, thema = "") {
  const t = String(frage || "");
  if (thema && t.toLowerCase().includes(String(thema).toLowerCase())) return false;
  if (STARKE_ANAPHER.test(t)) return true;
  return SCHWACHE_ANAPHER.test(t) && !hatEigenesThema(t);
}

// Das Thema aus einer Frage bestimmen, MIT den Suchtreffern als Schiedsrichter:
// Ein echter Eigenname taucht in den Titeln und Adressen der Treffer wieder
// auf, ein zufaellig grossgeschriebenes Substantiv meistens nicht.
function themaBestimmen(frage, treffer = []) {
  const kandidaten = namensKandidaten(frage);
  if (!kandidaten.length) return "";
  const heuhaufen = treffer.map((t) => `${t.titel || ""} ${t.url || ""}`.toLowerCase()).join(" \n ");
  let bester = "", bestPunkte = -1;
  for (const k of kandidaten) {
    const worte = k.split(" ");
    let p = worte.length * 2;
    if (NAMENSMARKE.test(worte[0])) p += 4;
    const klein = k.toLowerCase();
    if (heuhaufen.includes(klein)) p += 5;
    // Auch der Adress-Schreibweise nachgehen: "SV Oberbergkirchen" -> "sv-oberbergkirchen".
    if (heuhaufen.includes(klein.replace(/\s+/g, "-"))) p += 3;
    if (p > bestPunkte) { bestPunkte = p; bester = k; }
  }
  return bestPunkte >= 4 ? bester : "";
}

// Gedaechtnis je Gespraech. Bewusst im Arbeitsspeicher und bewusst kurzlebig:
// Ein "sie" bezieht sich auf das, worueber gerade geredet wurde — nicht auf
// etwas von vorgestern. Nach 30 Minuten ist der Bezug weg, und dann ist
// nachfragen richtiger als raten.
const GEDAECHTNIS = new Map();
const GEDAECHTNIS_MS = 30 * 60 * 1000;

// Gemerkt wird nicht nur das Thema, sondern auch WO es stand.
//
// Grund (gemessen 20.08.2026): Die Anschlussfrage "Wie haben sie am Wochenende
// gespielt?" wurde richtig zu "Wie hat SV Oberbergkirchen am Wochenende
// gespielt?" aufgeloest — und Google lieferte darauf trotzdem Muell: die
// E-Junioren-Seite, die Vereins-Startseite, einen Spielplan ohne Ergebnisse.
// Die Antwort stand die ganze Zeit auf den Seiten, die die VORIGE Frage schon
// geoeffnet hatte (fussball.de-Mannschaftsseite, bfv.de-Tabelle).
//
// Genau so arbeitet auch ein Mensch: Er sucht nicht neu, er schaut auf
// derselben Seite weiter. Die alten Adressen kommen deshalb bei einer
// Anschlussfrage VOR die neuen Treffer.
function themaMerken(sitzung, thema, treffer = []) {
  if (!thema) return;
  GEDAECHTNIS.set(String(sitzung || "standard"), {
    thema, zeit: Date.now(), treffer: treffer.slice(0, 6),
  });
  // Aufraeumen, damit die Karte in einem langen Serverlauf nicht waechst.
  if (GEDAECHTNIS.size > 200) {
    for (const [k, v] of GEDAECHTNIS) if (Date.now() - v.zeit > GEDAECHTNIS_MS) GEDAECHTNIS.delete(k);
  }
}

function eintragHolen(sitzung) {
  const e = GEDAECHTNIS.get(String(sitzung || "standard"));
  if (!e || Date.now() - e.zeit > GEDAECHTNIS_MS) return null;
  return e;
}

function themaHolen(sitzung) {
  const e = eintragHolen(sitzung);
  return e ? e.thema : "";
}

function trefferHolen(sitzung) {
  const e = eintragHolen(sitzung);
  return e && e.treffer ? e.treffer : [];
}

// Aus einem uebergebenen Gespraechsverlauf das juengste Thema ziehen. Das ist
// der zuverlaessigere Weg, wenn der Aufrufer den Verlauf hat — das eigene
// Gedaechtnis ist der Rueckfall, damit die Verdrahtung eine Zeile bleibt.
function themaAusVerlauf(verlauf = []) {
  for (let i = verlauf.length - 1; i >= 0; i--) {
    const h = verlauf[i];
    const text = typeof h === "string" ? h : (h && h.role === "user" ? h.content : "");
    if (!text || typeof text !== "string") continue;
    const k = namensKandidaten(text).filter(
      (x) => NAMENSMARKE.test(x.split(" ")[0]) || x.split(" ").length >= 2);
    if (k.length) return k[0];
  }
  return "";
}

// Die Frage aufloesen. Liefert { frage, thema, ersetzt }.
function aufloesen(frage, { sitzung = "standard", verlauf = [] } = {}) {
  const sauber = frageSaeubern(frage);
  const thema = themaAusVerlauf(verlauf) || themaHolen(sitzung);
  if (!thema || !brauchtRueckbezug(sauber, thema)) {
    return { frage: sauber, thema: "", ersetzt: false };
  }
  // Das zeigende Wort durch den Namen ersetzen — dann liest sich die Frage fuer
  // Google UND fuers Modell wie eine vollstaendige Frage.
  //
  // Ersetzt wird der STARKE Zeiger, wenn es einen gibt. Sonst stand in "Und wie
  // ist das Wetter dort?" das schwache "das" zuerst im Satz und es entstand
  // "Und wie ist Erding Wetter dort?" — der Zeiger blieb stehen, der Artikel
  // war weg. Der starke Zeiger ist immer der gemeinte.
  const muster = STARKE_ANAPHER.test(sauber) ? STARKE_ANAPHER : SCHWACHE_ANAPHER;
  const ersetzt = sauber.replace(muster, (m, vor, wort, nach) =>
    `${vor}${ZEIGER_ERSATZ[String(wort).toLowerCase()] || ""}${thema}${nach}`);
  return { frage: ersetzt, thema, ersetzt: true };
}

// --- Suchen ----------------------------------------------------------------
//
// Serper (serper.dev) liefert echte Google-Treffer ueber einen legitimen
// Anbieter: ein POST, gemessen 0,9-1,2 s. Google selbst wie im Browser
// abzufragen waere ein Verstoss gegen die Nutzungsbedingungen — also bewusst
// nicht.
// zeitraum: Googles "tbs"-Filter. "qdr:d" = letzte 24 Stunden, "qdr:w" = Woche.
//
// Der Filter ist bei Nachrichten der Unterschied zwischen brauchbar und
// wertlos (gemessen 20.08.2026): Ohne ihn lieferte der Nachrichten-Endpunkt auf
// "Was ist heute in Deutschland passiert?" Beitraege vom April und aus dem
// Vorjahr — Google sortiert nach Relevanz, nicht nach Datum. Mit "qdr:d" kamen
// dieselben Schlagzeilen, die auch auf tagesschau.de oben stehen, alle
// hoechstens drei Stunden alt.
async function serper(frage, { pfad = "search", anzahl = 8, timeoutMs = FRIST_SUCHE, zeitraum = null } = {}) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { ok: false, grund: "kein Serper-Schluessel" };
  const r = await fetch(`https://google.serper.dev/${pfad}`, {
    method: "POST",
    headers: { "X-API-KEY": key, "content-type": "application/json" },
    body: JSON.stringify({ q: frage, gl: "de", hl: "de", num: anzahl, ...(zeitraum ? { tbs: zeitraum } : {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error("Serper HTTP " + r.status);
  return { ok: true, d: await r.json() };
}

// --- Der zweite Griff: Nachrichten -----------------------------------------
//
// WARUM (gemessen 20.08.2026, der Fall, der sich am laengsten gewehrt hat):
// "Wie haben sie am Wochenende gespielt?" war ueber die normale Websuche NICHT
// zu beantworten. Auf fussball.de steht der Spielstand als Symbolschrift, auf
// bfv.de nur die Tabelle, auf fupa.net der Spielplan ohne Ergebnisse. Drei
// Laeufe, dreimal ein ehrliches "finde ich nicht".
//
// Ueber den Nachrichten-Endpunkt von Serper, gefragt nach dem VEREINSNAMEN
// allein, kam dagegen sofort:
//
//   [Wasserburger Stimme, vor 2 Tagen] "Der FC Gruenthal musste sich dem
//   SV 66 Oberbergkirchen aeusserst unglueklich mit 0:1 geschlagen geben."
//
// Das ist der Unterschied zwischen einer Datenbank und einem Bericht: Die
// Datenbank zeigt Ergebnisse als Bild, die Lokalzeitung schreibt sie hin.
//
// Zwei Dinge sind wichtig:
//   - Die Nachrichtenfrage ist NICHT die Nutzerfrage, sondern der NAME. Mit
//     "Wie hat SV Oberbergkirchen am Wochenende gespielt" lieferte derselbe
//     Endpunkt Berichte aus November 2025.
//   - Beide Abrufe laufen NEBENEINANDER. Der zweite kostet damit keine
//     Wartezeit, nur einen Suchabruf mehr — und nur bei Fragen, die von
//     Berichten ueberhaupt profitieren.
const NACHRICHTLICH = /\b(gespielt|spiel|ergebnis|gewonnen|verloren|unentschieden|wochenende|passiert|neues|news|nachricht\w*|meldung\w*|schlagzeile\w*|st[öo]rung|streik|unfall|aktuell\w*|gerade|heute|gestern)\b/i;

// Woerter, die eine Nachrichtensuche nur verwaessern. Eine ganze Frage als
// Suchbegriff war der Grund, warum "Was ist heute in Deutschland passiert?"
// Beitraege ueber Sonnenfinsternisse lieferte: Google sucht dann nach dem
// Satzbau mit, nicht nach dem Thema.
const NICHT_IM_SUCHBEGRIFF = new Set([
  "was", "wer", "wie", "wann", "wo", "warum", "wieso", "welche", "welcher", "welches",
  "ist", "sind", "war", "waren", "hat", "haben", "gibt", "gab", "steht", "stehen",
  "passiert", "passierte", "los", "neues", "neu", "kostet", "kosten", "viel", "viele",
  "heute", "gerade", "jetzt", "aktuell", "aktuelle", "aktuellen", "momentan",
  "eine", "einen", "einem", "eines", "der", "die", "das", "den", "dem", "des",
  "bei", "von", "mit", "fuer", "für", "aus", "auf", "und", "oder", "man", "sich",
]);

function nachrichtenFrage(frage, thema) {
  // Der Name allein trifft am besten (Begruendung oben).
  if (thema) return thema;
  const k = namensKandidaten(frage).filter(
    (x) => NAMENSMARKE.test(x.split(" ")[0]) || x.split(" ").length >= 2);
  if (k[0]) return k[0];
  // Kein Name — dann die tragenden Woerter der Frage, ohne Satzbau.
  const kern = String(frage).replace(/[?!.,;:]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !NICHT_IM_SUCHBEGRIFF.has(w.toLowerCase()))
    .slice(0, 4).join(" ");
  return kern ? `Nachrichten ${kern}` : "Nachrichten Deutschland";
}

// "heute", "gerade", "jetzt" heisst 24 Stunden. Alles andere (Wochenende,
// letztes Spiel, diese Woche) heisst eine Woche — der Bericht ueber ein
// Freitagsspiel erscheint am Sonntag.
function nachrichtenZeitraum(frage) {
  return /\b(heute|gerade|jetzt|momentan|soeben|aktuell\w*)\b/i.test(frage) ? "qdr:d" : "qdr:w";
}

// Seiten, deren Abruf nichts bringt: Anmeldemauern, Endlosstroeme, Videos.
// Sie stehen oft weit oben und wuerden das Zeitbudget verbrennen.
const NICHT_LESEN = /(facebook|instagram|x\.com|twitter|tiktok|youtube|pinterest|linkedin|reddit|amazon|ebay|threads\.net)\./i;

// Aus der Serper-Antwort den Fundtext und die Kandidatenliste bauen.
function fundBauen(d) {
  const teile = [];
  const treffer = [];
  let direkt = false;

  const box = d.answerBox;
  if (box) {
    const a = box.answer || box.snippet || (box.snippetHighlighted || []).join(", ") || "";
    if (a) { teile.push(`[Google-Direktantwort] ${box.title ? box.title + ": " : ""}${a}`); direkt = true; }
  }
  const kg = d.knowledgeGraph;
  if (kg) {
    const eck = Object.entries(kg.attributes || {}).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(" · ");
    const z = [kg.title, kg.type, kg.description, eck].filter(Boolean).join(" — ");
    if (z) { teile.push(`[Google-Wissenskarte] ${z}`); direkt = true; }
  }
  // Nachrichten kommen in einen EIGENEN Block (Fix 20.08.2026): Zusammen mit
  // den Suchtreffern gingen sie unter. Die Trefferliste traegt die Warnung
  // "kann veraltet sein" — und die faerbte auf die Meldungen ab, obwohl genau
  // sie das juengste Material sind. Im Lauf davor stand die Antwort ("mit 0:1
  // geschlagen geben", vor zwei Tagen) im Fundstueck und wurde trotzdem nicht
  // genommen.
  const meldungen = (d.news || []).slice(0, 8).map(
    (n) => `[${n.source || "News"}${n.date ? ", " + n.date : ""}] ${n.title}: ${n.snippet || ""}`.trim());

  for (const t of (d.organic || []).slice(0, 7)) {
    const dom = seiten.domainVon(t.link || "");
    if (t.snippet || t.title) {
      teile.push(`[${dom}${t.date ? ", " + t.date : ""}] ${t.title}: ${t.snippet || ""}`.trim());
    }
    if (t.link && !NICHT_LESEN.test(t.link)) treffer.push({ titel: t.title || "", url: t.link, domain: dom });
  }
  return { text: teile.join("\n"), meldungen: meldungen.join("\n"), treffer, direkt };
}

// --- Wann lohnt es, die echte Seite zu lesen? ------------------------------
//
// Immer waere ehrlicher, aber es kostet bis zu 2,6 s. Die Regel unten ist
// deshalb: Bei allem, was sich VON WOCHE ZU WOCHE aendert (Tabellen,
// Ergebnisse, Kurse, Preise, "aktuell"), wird nachgelesen. Bei Google-
// Direktantworten auf stabile Fakten ("wie hoch ist der Eiffelturm") nicht —
// da steht die Antwort schon fertig da und ein Seitenabruf brauchte nur Zeit.
//
// 20.08.2026: Auch hier stand `\btabelle\b` und `\bpreis\b` — "Tabellenstand"
// und "Dieselpreis" fielen durch, und damit wurde die echte Seite gar nicht
// erst gelesen. Dieselbe Regel wie bei ZUSATZBEGRIFFE: vordere Grenze reicht.
const FRISCH = /\btabelle|preis|\b(tabellenplatz|platz|punkte|spielt?ag|spiel|spiele|gespielt|ergebnis|ergebnisse|gewonnen|verloren|unentschieden|torverh|liga|saison|kurs|aktien|kostet|kosten|wetter|heute|gestern|wochenende|aktuell\w*|gerade|momentan|jetzt|neueste|letzte[nrs]?|news|nachrichten)\b/i;

function brauchtSeiten(frage, fund) {
  if (!fund.treffer.length) return false;
  if (FRISCH.test(frage)) return true;
  return !fund.direkt;
}

// --- Womit in der Seite gesucht wird ---------------------------------------
//
// Die Frage allein reicht als Suchbegriff nicht. "Wie haben sie am Wochenende
// gespielt" enthaelt kein einziges Wort, das auf einer Vereinsseite steht —
// dort heisst es "Letztes Spiel", "Ergebnis", "Pkt.". Ohne diese Bruecke
// findet das Fenster die Tabelle nicht und liefert das Menue.
//
// 20.08.2026 — WORTENDEN STATT WORTGRENZEN. Der schwerste gemessene Fehler des
// Tages hing an genau einem Zeichen: Das Muster pruefte `\btabelle\b`, und das
// trifft "Tabellenstand" NICHT. Kam die Frage als "Aktueller Tabellenstand SV
// Oberbergkirchen ..." herein (so schrieb sie das Verstehen-Modell um, siehe
// lib/sprache-werkzeuge.js), fehlten damit alle Brueckenbegriffe,
// passendeStellen griff das falsche Fenster und das Modell meldete voellig
// korrekt "NICHT GEFUNDEN" — auf eine Frage, die direkt aufgerufen 5 von 5 mal
// richtig beantwortet wurde.
//
// Deutsch klebt zusammen: Tabellenstand, Tabellenplatz, Tabellenfuehrer,
// Dieselpreis, Spritpreis. Wo ein Wort der ANFANG einer solchen Kette sein
// kann, steht deshalb nur noch die vordere Grenze (\btabelle statt
// \btabelle\b). Bei kurzen, mehrdeutigen Woertern (platz, steht) bleibt die
// hintere Grenze stehen — "Platzhalter" ist kein Tabellenplatz.
const ZUSATZBEGRIFFE = [
  [/\b(gespielt|ergebnis|gewonnen|verloren|unentschieden|spiel|partie|wochenende)\b/i,
    ["Letztes Spiel", "Ergebnis", "Spieltag", "Meisterschaften", "Pkt", "Torv", "Sp.", "Pl."]],
  [/\btabelle|\b(tabellenplatz|tabellenstand|platz|rang|steht|punkte)\b/i,
    ["Tabellenplatz", "Tabellenstand", "Punkte", "Pkt", "Pl.", "Torverh", "Sp."]],
  [/\b(einwohner|bev[öo]lkerung)\b/i, ["Einwohner", "Bevölkerung"]],
  // "preis" ganz ohne Grenzen: Dieselpreis, Spritpreis, Strompreis, Preisliste —
  // im Deutschen haengt es hinten dran, und ein Wort mit "preis" drin ist immer
  // eine Preisfrage. \bpreis\b hat "Dieselpreis" verfehlt.
  [/\b(kostet|kosten|teuer)\b|preis/i, ["Preis", "Euro", "€"]],
  // Sprit hat eigene Brueckenbegriffe: Auf den Preisseiten steht "Diesel",
  // "Super E10" und "je Liter", nicht "Preis". Ohne diese Zeile fand
  // "Dieselpreis" (ein Wort!) frueher nicht einmal die Preis-Bruecke.
  [/\b(diesel|benzin|sprit|super e10|e10|tanken)/i,
    ["Diesel", "Super", "E10", "Liter", "Euro", "€"]],
  [/\b(wetter|grad|regn|sonn)\b/i, ["Temperatur", "Grad", "Regen", "bewölkt"]],
];

// Die Gewichte sind die eigentliche Aussage (siehe passendeStellen in
// suche-seiten.js): Der NAME zaehlt am meisten, die Woerter der Frage mittel,
// die Fachbegriffe der Bruecke am wenigsten. Ohne dieses Gefaelle gewinnt jede
// lange Tabelle gegen den kurzen Block, in dem die Antwort steht.
function suchbegriffe(frage, thema) {
  const raus = new Map();
  const rein = (wort, gewicht) => {
    const w = String(wort || "").trim();
    if (w.length < 3) return;
    if (!raus.has(w.toLowerCase()) || raus.get(w.toLowerCase()).gewicht < gewicht) {
      raus.set(w.toLowerCase(), { wort: w, gewicht });
    }
  };
  for (const w of (thema ? thema.split(" ") : [])) rein(w, 9);
  for (const w of String(frage).replace(/[?!.,;:]/g, " ").split(/\s+/)) {
    if (w.length > 3) rein(w, 3);
  }
  for (const [muster, extra] of ZUSATZBEGRIFFE) {
    if (muster.test(frage)) for (const w of extra) rein(w, 1.5);
  }
  return [...raus.values()];
}

// --- Formulieren -----------------------------------------------------------
//
// Der einzige Modellaufruf im ganzen Weg. Er darf NICHTS wissen — nur lesen.

// Die laufende Fussballsaison. Sie beginnt im Juli und laeuft ueber den
// Jahreswechsel — im August 2026 ist "2026/2027" die aktuelle.
function saison(d = new Date()) {
  const j = d.getFullYear();
  const start = d.getMonth() >= 6 ? j : j - 1;   // ab Juli neue Saison
  return `${start}/${start + 1}`;
}

function anweisung(heute, jetzt) {
  return (
    `Heute ist ${heute}. Du bist die Nachschlage-Hand von Lukas' Assistentin.\n\n` +
    "Beantworte seine Frage AUSSCHLIESSLICH aus dem Fundstueck unten. Dein eigenes " +
    "Wissen ist hier verboten — auch wenn du die Antwort zu kennen glaubst.\n\n" +
    "REGELN:\n" +
    "- Steht die Antwort nicht eindeutig im Fundstueck, schreibe exakt: NICHT GEFUNDEN\n" +
    "- Widersprechen sich zwei Quellen, gilt die mit dem juengeren Datum oder der " +
    "detaillierteren Angabe. Bleibt es unklar: NICHT GEFUNDEN.\n" +
    "- Rate NIE eine Zahl. Fehlt sie im Fundstueck, fehlt sie in der Antwort.\n" +
    // NAHE DRAN SCHLAEGT GAR NICHTS (20.08.2026, Fall Dieselpreis).
    //
    // "Was kostet ein Liter Diesel gerade in Bayern?" scheiterte dreimal, obwohl
    // im Fundstueck stand: "Dieselkraftstoff kostete in Deutschland am
    // 17. August 2026 im Tagesdurchschnitt 2,27 Euro pro Liter." Die Zahl gilt
    // fuer Deutschland statt Bayern und ist drei Tage alt — beides Gruende,
    // vorsichtig zu sein, aber keiner, zu schweigen. Wer fragt, was Diesel
    // kostet, ist mit "bundesweit 2,27, Stand Montag" bedient; mit "finde ich
    // nicht" ist er es nicht.
    "- Passt die gefundene Zahl nur ungefaehr (Deutschland statt Bayern, " +
    "vorgestern statt heute), dann NENNE sie und sag dazu, worauf sie sich " +
    "bezieht. Schweigen ist nur richtig, wenn gar nichts Passendes dasteht.\n" +
    // UEBERBLICKSFRAGEN HABEN KEINE EINE ANTWORT (20.08.2026).
    //
    // Auf "Was ist heute in Deutschland passiert?" lagen acht aktuelle
    // Schlagzeilen vor — und das Modell meldete NICHT GEFUNDEN, weil keine
    // einzelne davon "die Antwort" war. Sie sind es zusammen.
    "- Fragt Lukas allgemein nach Neuigkeiten ('was ist heute passiert', 'was " +
    "gibt es Neues'), sind die zwei bis drei wichtigsten Meldungen die Antwort. " +
    "Nenne sie in einem fliessenden Satz, nicht als Liste.\n" +
    "- Antworte in 1-2 kurzen Saetzen, gesprochen, wie ein Mensch am Telefon.\n" +
    "- KEINE Aufzaehlung, KEINE Tabelle, KEINE URL, KEINE Quellenangabe, kein Vorwort.\n" +
    // ZIFFERN, NICHT ZAHLWOERTER (20.08.2026). Zuerst stand hier die
    // Anweisung, Ergebnisse auszuschreiben ("drei zu null") — das klang
    // gesprochen gut, machte aber den Chat-Text unbrauchbar: Auf "Wann wurde
    // der SV Oberbergkirchen gegruendet?" kam "wurde neunzehnhundert-
    // sechsundsechzig gegruendet", und in `reply` steht damit keine Jahreszahl
    // mehr, die man ueberfliegen koennte.
    //
    // Es braucht die Anweisung auch gar nicht: sprechtext() weiter unten macht
    // aus "1:0" ein "eins zu null" und aus "1966" laesst es die Jahreszahl in
    // Ruhe (lib/aussprache.js). Beide Felder werden so richtig — eines mit
    // Ziffern zum Lesen, eines mit Worten zum Hoeren.
    "- Zahlen IMMER als Ziffern: \"Platz 4\", \"3 Punkte\", \"1:0\", \"2,27 Euro\", " +
    "\"1966\". Schreibe sie NIE als Wort aus — das erledigt die Sprachausgabe.\n" +
    // DER SATZ WIRD VORGELESEN (20.08.2026). Auf "In welcher Liga spielt der TSV
    // Dorfen?" kam "Der TSV Dorfen spielt in der BZL Oberbayern Ost". Inhaltlich
    // richtig — nur steht "BZL" so auf der Verbandsseite, und eine Stimme sagt
    // dazu "Beh-Zett-El". Fachkuerzel sind fuer Tabellenspalten gemacht, nicht
    // fuers Ohr.
    "- Schreibe Fachkuerzel aus: BZL = Bezirksliga, KL = Kreisliga, KK = " +
    "Kreisklasse, LL = Landesliga, MwSt = Mehrwertsteuer. Der Satz wird " +
    "vorgelesen — was man nicht sagen wuerde, schreibst du nicht.\n" +
    "- Nur die Antwort. Kein \"laut der Seite\", kein \"ich habe gefunden\".\n\n" +
    // FUSSBALLSEITEN ZEIGEN MEHRERE SAISONS AUF EINER SEITE (gemessen 20.08.2026).
    //
    // Auf der Vereinsseite von fussball.de stand oben "4 | Tabellenplatz |
    // 3 | Punkte" — der heutige Stand — und weiter unten die ABGESCHLOSSENE
    // Tabelle der Vorsaison, in der derselbe Verein mit 56 Punkten aus 26
    // Spielen auf Platz 1 steht. Das Modell nahm im ersten Lauf die zweite und
    // meldete "Platz eins mit sechsundfuenfzig Punkten". Beides steht wirklich
    // da; nur eines ist die Antwort auf "wie steht er JETZT".
    //
    // Der Unterschied ist am Kalender abzulesen und deshalb hier als Regel:
    `SPORT — LAUFENDE SAISON: Es zaehlt ausschliesslich die Saison ${saison(jetzt || new Date())}. ` +
    "Eine Tabelle mit vielen absolvierten Spielen (z. B. 26 Spiele) gehoert zu einer " +
    "ABGESCHLOSSENEN Saison und ist NICHT der aktuelle Stand — ausser Lukas fragt " +
    "ausdruecklich nach der letzten Saison. Erkennbar ist der aktuelle Stand an der " +
    "Zahl der bisher gespielten Spiele: Ende August sind das ein bis drei.\n\n" +
    // SPIELSTAENDE STEHEN AUF fussball.de ALS SYMBOLSCHRIFT (20.08.2026).
    //
    // Die Ziffern eines Ergebnisses sind dort keine Ziffern, sondern Zeichen aus
    // dem privaten Unicode-Bereich. suche-seiten.js wirft sie weg, weil sie ohne
    // die zugehoerige Schriftdatei nichts bedeuten — es bleibt "FC Gruenthal -
    // SV 66 Oberbergkirchen | : |". Das Modell meldete daraufhin voellig
    // korrekt "NICHT GEFUNDEN".
    //
    // Der Ausgang steht aber trotzdem da, nur eine Zeile hoeher: "Punkte: 3,
    // Torverhaeltnis 1:0" nach EINEM Spiel laesst genau eine Lesart zu. Das ist
    // Rechnen, kein Raten — und deshalb ausdruecklich erlaubt, aber eng
    // begrenzt: Ab dem zweiten Spiel mischen sich mehrere Ergebnisse im
    // Torverhaeltnis, und dann gilt wieder NICHT GEFUNDEN.
    "SPIELAUSGANG OHNE ZIFFERN: Fehlt beim letzten Spiel der Spielstand, sage " +
    "trotzdem, was dasteht — Gegner und Tag. Das ist eine Antwort, kein " +
    "Fehlschlag. Den AUSGANG darfst du aus dem Tabellenstand ableiten, wenn er " +
    "eindeutig ist: 3 Punkte nach einem Spiel = Sieg, 1 = Unentschieden, " +
    "0 = Niederlage; das Torverhaeltnis ist dann genau der Stand dieses Spiels. " +
    "Bist du beim STAND unsicher, lass ihn weg — aber schreibe NICHT GEFUNDEN " +
    "nur, wenn du auch Gegner und Tag nicht hast."
  );
}

async function formulieren(frage, fundText, { heute, jetzt, timeoutMs = FRIST_SATZ }) {
  const satz = await schnell.frage(
    anweisung(heute, jetzt),
    `FRAGE VON LUKAS: ${frage}\n\nFUNDSTUECK:\n${fundText}`,
    { maxTokens: 220, temp: 0.2, timeoutMs, model: FORMULIER_MODELL, denken: "aus" }
  );
  return String(satz || "").trim();
}

// --- Sprechtext ------------------------------------------------------------
//
// Was in `gesprochen` steht, wird VORGELESEN. "Platz 4" liest jede Stimme mal
// als "Platz vier", mal als "Platz Nummer vier" — deshalb steht es hier schon
// als Wort da (dieselbe Begruendung wie in lib/aussprache.js).
//
// Ergebnisse zuerst: "3:0" wuerde die Uhrzeitregel nicht fassen und die
// Zahlregel machte "drei:null" daraus. Bei Sportfragen wird daraus "drei zu
// null" — bei allem anderen bleibt der Doppelpunkt in Ruhe, damit aus "18:30
// Uhr" keine Ergebnismeldung wird.
const SPORT = /\b(spiel\w*|gespielt|gewonnen|verloren|unentschieden|tor\w*|liga|tabelle|verein|mannschaft|fussball|fußball|kick|saison|spieltag)\b/i;

function sprechtext(satz, { sport = false } = {}) {
  let t = String(satz || "");
  if (sport) t = t.replace(/\b(\d{1,2})\s*:\s*(\d{1,2})\b/g, (_, a, b) => `${a} zu ${b}`);
  // Saison-Schreibweise "2025/26" ausschreiben (gemessen 20.08.2026): Die
  // Zahlregel in aussprache.js laesst vierstellige Jahre stehen, macht aus der
  // zweistelligen Haelfte aber ein Wort. Vorgelesen kam heraus: "Saison
  // zweitausendfuenfundzwanzig Schraegstrich sechsundzwanzig". Zwei volle
  // Jahreszahlen bleiben beide stehen und klingen wie eine Saison.
  t = t.replace(/\b(19|20)(\d{2})\s*\/\s*(\d{2})\b/g, (_, jh, jj, kurz) => {
    const start = Number(jh + jj);
    const ende = Number(String(start + 1).slice(2)) === Number(kurz) ? start + 1 : Number(jh + kurz);
    return `${start}/${ende}`;
  });
  return aussprache.fuerStimme(t);
}

// --- Der Einstieg ----------------------------------------------------------
//
// websuche(frage, opts) -> { ok, reply, gesprochen, quelle, quellen, dauerMs, stufen }
// Wirft nie. Bei ok:false steht in `gesprochen` schon der ehrliche Satz.
async function websuche(rohFrage, {
  sitzung = "standard",
  verlauf = [],
  jetzt = null,
  timeoutMs = 12000,
} = {}) {
  const start = Date.now();
  const stufen = {};
  const heute = (jetzt ? new Date(jetzt) : new Date()).toLocaleDateString("de-DE", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Berlin",
  });

  const bezug = aufloesen(rohFrage, { sitzung, verlauf });
  const frage = bezug.frage;
  stufen.frage = frage;
  stufen.rueckbezug = bezug.ersetzt ? bezug.thema : null;

  if (!process.env.SERPER_API_KEY) {
    return scheitern(start, stufen, "kein Serper-Schluessel");
  }

  // 1. Suchen — Treffer und (wo es hilft) Nachrichten NEBENEINANDER.
  let fund;
  try {
    const t0 = Date.now();
    const frist = Math.min(FRIST_SUCHE, timeoutMs);
    const nachrichten = NACHRICHTLICH.test(frage);
    stufen.nachrichten = nachrichten ? nachrichtenFrage(frage, bezug.thema) : null;
    const [a, b] = await Promise.allSettled([
      serper(frage, { timeoutMs: frist }),
      nachrichten
        ? serper(stufen.nachrichten, {
            pfad: "news", anzahl: 8, timeoutMs: frist, zeitraum: nachrichtenZeitraum(frage),
          })
        : Promise.resolve({ ok: false }),
    ]);
    stufen.sucheMs = Date.now() - t0;
    if (a.status !== "fulfilled" || !a.value.ok) {
      return scheitern(start, stufen, a.status === "fulfilled" ? a.value.grund : String(a.reason?.message).slice(0, 120));
    }
    // Ein gescheiterter Nachrichtenabruf ist kein Fehler — die Hauptsuche steht.
    const news = (b.status === "fulfilled" && b.value.ok) ? b.value.d.news : null;
    fund = fundBauen(news ? { ...a.value.d, news } : a.value.d);
  } catch (e) {
    stufen.fehler = String(e.message).slice(0, 120);
    return scheitern(start, stufen, stufen.fehler);
  }
  if (!fund.text.trim() && !fund.meldungen.trim()) return scheitern(start, stufen, "keine Treffer");
  stufen.treffer = fund.treffer.length;

  // Thema fuer die naechste Frage merken — mit den Treffern als Schiedsrichter.
  const thema = bezug.ersetzt ? bezug.thema : themaBestimmen(frage, fund.treffer);
  stufen.thema = thema || null;

  // Bei einer Anschlussfrage kommen die Seiten der VORIGEN Frage zuerst dran
  // (Begruendung oben bei themaMerken). Doppelte fliegen raus.
  let kandidaten = [...fund.treffer];
  if (bezug.ersetzt) {
    // VORZIEHEN, NICHT NUR ANHAENGEN (Fix 20.08.2026): Beim ersten Versuch wurden
    // nur die Adressen vorangestellt, die in der NEUEN Trefferliste fehlten. Die
    // entscheidende Seite (fussball.de) stand aber in beiden Listen — nur in der
    // neuen weit hinten. Sie wurde damit als "schon vorhanden" uebersprungen und
    // fiel trotzdem aus den vier gelesenen Seiten heraus. Jetzt bestimmt die
    // ALTE Reihenfolge den Anfang, der Rest haengt sich hinten an.
    const alt = trefferHolen(sitzung);
    if (alt.length) {
      const bekannt = new Set(alt.map((a) => a.url));
      kandidaten = [...alt, ...fund.treffer.filter((n) => !bekannt.has(n.url))];
      stufen.altQuellen = alt.map((a) => a.domain);
    }
  }

  // 2. Bei allem Frischen die echten Seiten nachlesen — nebeneinander, mit
  //    harter Frist. Was nicht rechtzeitig kommt, faellt weg.
  let seitenText = "";
  if (brauchtSeiten(frage, fund) && Date.now() - start < timeoutMs - FRIST_SEITEN - 1500) {
    const t0 = Date.now();
    const begriffe = suchbegriffe(frage, thema);
    // Vier Seiten statt drei (20.08.2026): Sie laufen NEBENEINANDER, gemessen
    // 83-600 ms fuer alle zusammen — die vierte kostet also fast nichts. Sie hat
    // aber im Anschlussfall den Unterschied gemacht: Die fussball.de-Seite mit
    // "Letztes Spiel: Fr, 14.08.2026 FC Gruenthal - SV 66 Oberbergkirchen" stand
    // auf Platz vier der Trefferliste und fiel bei dreien jedes Mal heraus.
    const gelesen = await seiten.seitenLesen(kandidaten, begriffe, {
      timeoutMs: FRIST_SEITEN, anzahl: 4, jeSeite: 1000,
      jahr: (jetzt ? new Date(jetzt) : new Date()).getFullYear(),
    });
    stufen.seitenMs = Date.now() - t0;
    stufen.seiten = gelesen.map((g) => g.domain);
    seitenText = gelesen
      .map((g) => `[Seite ${g.domain}] ${g.titel}\n${g.text}`)
      .join("\n\n");
  }

  // Erst JETZT merken, und in der Reihenfolge, in der sich die Seiten bewaehrt
  // haben: Was gelesen werden konnte, kommt bei der naechsten Frage zuerst dran.
  // Eine Seite, die schon einmal Text geliefert hat, liefert ihn wieder — eine,
  // die 403 gab oder nur ein Menue hatte, nicht.
  if (thema) {
    const gelesenZuerst = [
      ...kandidaten.filter((k) => (stufen.seiten || []).includes(k.domain)),
      ...kandidaten.filter((k) => !(stufen.seiten || []).includes(k.domain)),
    ];
    themaMerken(sitzung, thema, gelesenZuerst);
  }

  // Die Reihenfolge ist die Rangfolge, und sie steht in den Ueberschriften:
  // datierte Meldungen zuerst (sie sagen, WAS passiert ist), dann die gelesenen
  // Seiten (sie sagen, WIE es steht), zuletzt die Trefferauszuege (sie koennen
  // Monate alt sein — Google zeigt gecachte Staende).
  const fundText = [
    fund.meldungen && `AKTUELLE MELDUNGEN MIT DATUM — verlaesslichste Quelle fuer Ereignisse:\n${fund.meldungen}`,
    seitenText && `AUS DEN ECHTEN SEITEN (heute abgerufen):\n${seitenText}`,
    fund.text && `AUS DER TREFFERLISTE (Auszuege, koennen veraltet sein):\n${fund.text}`,
  ].filter(Boolean).join("\n\n").slice(0, 7000);

  // 3. Einen Satz daraus machen.
  let satz;
  try {
    const t0 = Date.now();
    satz = await formulieren(frage, fundText, { heute, jetzt, timeoutMs: FRIST_SATZ });
    stufen.satzMs = Date.now() - t0;
  } catch (e) {
    stufen.fehler = String(e.message).slice(0, 120);
    return scheitern(start, stufen, stufen.fehler);
  }

  const dauerMs = Date.now() - start;
  if (!satz || /NICHT GEFUNDEN/i.test(satz)) {
    protokoll(rohFrage, { ok: false, dauerMs, grund: "nicht gefunden", stufen });
    return {
      ok: true,          // der WEG hat funktioniert — nur die Antwort gibt es nicht
      gefunden: false,
      reply: `Dazu finde ich gerade nichts Belastbares.`,
      gesprochen: "Dazu finde ich gerade nichts Belastbares.",
      quelle: null, quellen: [], dauerMs, stufen,
    };
  }

  // Quelle: bevorzugt die Seite, die wirklich gelesen wurde.
  const beste = (stufen.seiten && stufen.seiten.length)
    ? kandidaten.find((t) => t.domain === stufen.seiten[0]) || kandidaten[0]
    : kandidaten[0];

  const sport = SPORT.test(frage);
  const gesprochen = sprechtext(satz, { sport });
  const reply = beste
    ? `${satz}\n\nQuelle: ${beste.domain}${beste.url ? " — " + beste.url : ""}`
    : satz;

  protokoll(rohFrage, { ok: true, dauerMs, antwort: satz.slice(0, 300), stufen });
  return {
    ok: true, gefunden: true, reply, gesprochen,
    quelle: beste ? beste.domain : null,
    quellen: fund.treffer.slice(0, 3).map((t) => ({ titel: t.titel, url: t.url, domain: t.domain })),
    dauerMs, stufen,
  };
}

function scheitern(start, stufen, grund) {
  const dauerMs = Date.now() - start;
  protokoll(stufen.frage, { ok: false, dauerMs, grund, stufen });
  return {
    ok: false, gefunden: false, hint: grund,
    reply: "Da komm ich gerade nicht durch — frag mich gleich nochmal.",
    gesprochen: "Da komm ich gerade nicht durch — frag mich gleich nochmal.",
    quelle: null, quellen: [], dauerMs, stufen,
  };
}

function protokoll(frage, daten) {
  if (!sprachlog || typeof sprachlog.schreiben !== "function") return;
  try {
    sprachlog.schreiben({ art: "websuche", frage: String(frage || "").slice(0, 140), ...daten });
  } catch { /* ein fehlendes Protokoll darf keine Antwort kosten */ }
}

module.exports = {
  websuche,
  // fuer die Tests und fuer andere Aufrufer
  frageSaeubern, aufloesen, brauchtRueckbezug, hatEigenesThema, namensKandidaten,
  themaBestimmen, themaMerken, themaHolen, themaAusVerlauf, trefferHolen, suchbegriffe,
  fundBauen, brauchtSeiten, sprechtext, serper, formulieren, saison, anweisung,
  nachrichtenFrage, nachrichtenZeitraum, NACHRICHTLICH, GEDAECHTNIS,
  // Die Fristen als Zahlen, damit ein Test sie pruefen kann statt sie zu erraten.
  FRISTEN: { suche: FRIST_SUCHE, seiten: FRIST_SEITEN, satz: FRIST_SATZ },
};
