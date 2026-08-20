// Erstgespraech auswerten — und daraus ein Angebot machen (20.08.2026).
//
// Warum es das gibt: Auf "Werte das Erstgespraech mit der Zahnarztpraxis
// Bergmann aus und erstell mir auf dieser Basis ein Angebot" antwortete
// Alexandra am 19.08. mit "Bei welcher Firma es genau geht, weiss ich gerade
// nicht — magst du mir sagen, welche du meinst?". Der Firmenname stand im Satz.
//
// Das ist keine Formulierungspanne, sondern eine Luecke im Werkzeugkasten:
//   · beleg_erstellen kann ein Angebot schreiben, verlangt aber Betrag UND
//     Leistungstext vom Modell. Beides steht in der Kundenakte, nicht im Satz.
//   · nachschlagen kann den Stand einer Firma vorlesen, erzeugt aber nichts.
// Zwischen beiden fehlte die Kette: nachschauen -> auswerten -> fuellen. Ohne
// sie musste das Modell den Betrag raten (verboten, zu Recht) und ist deshalb
// in die Rueckfrage ausgewichen.
//
// DIE HALTUNG HIER: nie mit einer blossen Rueckfrage enden. Steht nichts im
// System, wird das ehrlich gesagt UND ein Weg angeboten ("sag mir Leistung und
// Preis, dann schreib ich das Angebot"). Eine Rueckfrage ohne Angebot ist vor
// laufender Kamera eine Absage; eine Rueckfrage MIT Angebot ist ein Gespraech.
//
// WAS HIER NICHT PASSIERT: einen Preis erfinden. Ein Angebot mit geratener Zahl
// geht an einen echten Kunden. Steht keine Zahl im Material, wird genau danach
// gefragt — und alles andere ist trotzdem schon ausgewertet, damit die eine
// Antwort von Lukas reicht.

const crm = require("./crm.js");
const firmaNach = require("./firma-nachschlagen.js");
const belegErstellen = require("./beleg-erstellen.js");
const schnell = require("./schnell.js");

// Haiku statt Sonnet (20.08.): Das Material ist kurz — ein paar hundert Zeichen
// Gespraechsnotiz — und die Aufgabe ist Entnehmen, nicht Formulieren. Der
// eigentliche Angebotstext entsteht danach ohnehin in angebot-text.js mit
// Sonnet. Zwei grosse Modelle hintereinander waeren im Gespraech spuerbar:
// Lukas wartet auf beide, bevor der erste Ton kommt.
//
// Gemessen am 20.08. im Container, gleiche Aufgabe:
//   Haiku 4.5 ueber frage()            0,9 s
//   Sonnet 5 ueber mitWerkzeugen()     2,7 s
//   Haiku 4.5 ueber mitWerkzeugen()    Fehler 400
// Die letzte Zeile ist der Grund, warum hier frage() steht und nicht das sonst
// uebliche mitWerkzeugen(): Das setzt seit dem 27.07. immer output_config.effort,
// und Haiku 4.5 lehnt den Parameter ab ("This model does not support the effort
// parameter"). Beim ersten Live-Lauf fiel deshalb JEDE Auswertung in den
// Rueckfall — sichtbar nur daran, dass die Kernpunkte wie Rohnotizen klangen.
const MODELL = process.env.GESPRAECH_MODELL || "claude-haiku-4-5";

// Nur die Sparten, die beleg_erstellen kennt. Was das Modell sonst zurueckgibt,
// faellt auf "Website" zurueck statt eine unbekannte Sparte durchzureichen.
const SPARTEN = ["Website", "SocialMedia", "Performance Marketing"];

async function frag(sql, args) {
  try { const r = await crm.system(sql, args); return r.rows; }
  catch (e) { console.error("Gespraech auswerten:", e.message); return null; }
}

// --- Die Firma finden -------------------------------------------------------
//
// Der Normalfall laeuft ueber firmaNach.suchen(): Dort steht die Regel, wann ein
// Treffer eindeutig ist und wann gefragt wird. Sie gehoert an EINE Stelle — ein
// zweiter Satz Regeln waere ein zweiter Ort, an dem ein Angebot beim falschen
// Kunden landen kann.
//
// NEU HIER ist nur der Fall "gar nichts gefunden". Lukas spricht Firmen so aus,
// wie sie im Gespraech heissen ("Zahnarztpraxis Bergmann"), im CRM stehen sie
// anders ("Bergmann Zahntechnik"). Eine ilike-Suche ueber den ganzen Satz
// findet dann nichts, obwohl die Firma da ist. Also wird ein zweites Mal
// gesucht — mit dem tragenden Wort statt mit der ganzen Bezeichnung.
//
// Was dabei gefunden wird, wird NICHT stillschweigend genommen. "Bergmann
// Immobilien" ist nicht die "Zahnarztpraxis Bergmann", und ein Angebot an den
// Falschen ist der teuerste Fehler in dieser Kette. Der Fund wird beim Namen
// genannt und Lukas entscheidet.
const BALLAST = new Set([
  "praxis", "zahnarztpraxis", "arztpraxis", "firma", "betrieb", "unternehmen",
  "gmbh", "ug", "ag", "kg", "gbr", "ohg", "mbh", "ek", "inh", "herr", "frau",
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "und", "co",
]);

function tragendeWorte(name) {
  return String(name || "")
    .replace(/[^\wäöüßÄÖÜ\s-]/g, " ")
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !BALLAST.has(w.toLowerCase()));
}

async function firmaFinden(gesucht) {
  const name = String(gesucht || "").trim();
  if (name.length < 3) return { ok: false, grund: "zu-kurz" };

  const r = await firmaNach.suchen(name);
  if (r.ok) return { ok: true, firma: r.firma };
  if (r.grund !== "nicht-gefunden") return r;   // mehrdeutig / nicht erreichbar

  // Zweiter Anlauf: jedes tragende Wort einzeln suchen und das Wort nehmen, das
  // am WENIGSTEN findet.
  //
  // Der erste Entwurf nahm das laengste Wort, weil das meistens der Eigenname
  // ist. Am 20.08. live widerlegt: Zu "Dachdecker Restle" gewann "Dachdecker"
  // (zehn Zeichen) gegen "Restle" (sechs) und lieferte drei fremde
  // Dachdeckerbetriebe, waehrend "Restle" genau die eine richtige Firma
  // gefunden haette. Die Laenge sagt nichts, die Trefferzahl schon: Ein Wort,
  // das nur einmal vorkommt, ist der Name. Eines, das dreissigmal vorkommt,
  // ist die Branche.
  const worte = tragendeWorte(name);
  const laeufe = await Promise.all(worte.map((wort) => frag(
    "select name from firmen where name ilike $1 order by letzte_aktivitaet desc nulls last limit 4",
    ["%" + wort + "%"])));
  const beste = laeufe
    .filter((t) => t && t.length)
    .sort((a, b) => a.length - b.length)[0];
  if (beste) return { ok: false, grund: "aehnlich", namen: beste.slice(0, 3).map((f) => f.name) };
  return { ok: false, grund: "nicht-gefunden" };
}

// --- Das Material zusammentragen -------------------------------------------
//
// Vier Quellen, absichtlich in dieser Reihenfolge:
//   1. die Gespraechsnotizen aus dem Verlauf (aktivitaeten) — das Konkreteste
//   2. stand / besonderes / anruf_notiz / notizen an der Firma
//   3. argumente (die Verkaufsargumente aus der Recherche)
//   4. offene Deals — dort steht der Wert, ueber den schon gesprochen wurde
//
// NICHT dabei: art 'system', 'stufenwechsel', 'uebergabe', 'aussortiert'. Das
// ist Protokoll, kein Gespraech. Nachgezaehlt am 20.08. am lebenden System:
// von 1.445 Aktivitaeten tragen 626 solche Zeilen wie "Erstgespraech ->
// Follow-up" oder "Kundenakte angelegt". Wer sie mitgibt, gibt dem Modell
// hauptsaechlich Rauschen — und bekommt ein Angebot ueber einen Stufenwechsel.
const GESPRAECHSARTEN = ["anruf", "notiz", "termin", "mail"];

// Die Anruf-Eintraege beginnen mit dem Ausgang, den crm.js davorsetzt
// ("Erstgespraech gebucht — ...", "Spaeter anrufen: 2026-08-05 — ..."). Der
// Ausgang steht schon als Feld daneben; im Text ist er nur Vorspann. Und
// "Termin 2026-08-12T14:00" ist eine Uhrzeit, kein Gespraechsinhalt — bleibt
// sie drin, taucht sie als Zahl im Material auf und kann bei der Preispruefung
// weiter unten falschen Rueckhalt geben.
const VORSPANN = /^(Erstgespräch gebucht|Follow-up[^—]*|Später (?:anrufen|nochmal)[^—]*|Absage|Nicht erreicht[^—]*|Erreicht)\s*(?:—\s*)?/i;

function kern(text) {
  return String(text || "")
    .replace(VORSPANN, "")
    .replace(/\bTermin \d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?/g, "")
    .split("·")
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !/^\?+$/.test(t))
    .join(". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function materialHolen(f) {
  const [verlauf, deals] = await Promise.all([
    frag(
      "select art, text, zeit from aktivitaeten where firma_id = $1 and art = any($2) " +
      "and coalesce(text, '') <> '' order by zeit desc limit 12",
      [f.id, GESPRAECHSARTEN]),
    frag(
      "select titel, wert, sparte from deals where firma_id = $1 and status <> 'verloren' " +
      "order by erstellt desc limit 3", [f.id]),
  ]);

  // Aeltestes zuerst: So liest sich das Material wie ein Gespraechsverlauf und
  // nicht rueckwaerts. Das Modell soll das ZULETZT Gesagte als das Gueltige
  // erkennen, und dafuer muss es wissen, was zuletzt kam.
  const zeilen = (verlauf || [])
    .map((a) => ({ ...a, kern: kern(a.text) }))
    .filter((a) => a.kern.length >= 12)
    .reverse();

  const felder = [
    f.stand ? `Stand: ${String(f.stand).slice(0, 400)}` : null,
    f.besonderes ? `Besonderes: ${String(f.besonderes).slice(0, 300)}` : null,
    f.anruf_notiz ? `Aus dem Telefonat: ${String(f.anruf_notiz).slice(0, 400)}` : null,
    f.notizen ? `Notiz aus der Akte: ${String(f.notizen).slice(0, 400)}` : null,
    Array.isArray(f.argumente) && f.argumente.length
      ? `Verkaufsargumente: ${f.argumente.join(", ").slice(0, 300)}` : null,
    Array.isArray(f.leistungen) && f.leistungen.length
      ? `Vereinbarte Leistungen: ${f.leistungen.join(", ").slice(0, 300)}` : null,
  ].filter(Boolean);

  const text = [
    ...zeilen.map((z) => `${new Date(z.zeit).toLocaleDateString("de-DE")}: ${z.kern}`),
    ...felder,
  ].join("\n");

  return {
    text,
    zeilen,
    deals: deals || [],
    // Die Substanzfrage. Ein einziger Halbsatz ("Herr Astner") ist zu wenig fuer
    // ein Angebot — dann ist ehrlich sein besser als etwas zusammenzureimen.
    verwertbar: text.replace(/\s+/g, " ").length >= 40,
  };
}

// --- Den Preis finden -------------------------------------------------------
//
// Der Preis ist die einzige Zahl in dieser Kette, die beim Kunden landet.
// Deshalb wird er NICHT vom Modell geholt, sondern gesucht — und wenn das
// Modell doch einen nennt, muss er sich im Material wiederfinden lassen
// (siehe belegbar() weiter unten).
//
// Reihenfolge, und die ist eine Entscheidung:
//   1. was Lukas GERADE sagt — er sitzt beim Kunden, alles andere ist aelter
//   2. preis_setup aus der Kundenakte — gepflegt, nicht dahingesagt
//   3. der Wert eines offenen Deals
//   4. eine Zahl aus dem Gespraechstext ("Budget waeren 500€ einmalig")
//
// Untergrenze 100, Obergrenze 100.000: Darunter sind es Stueckzahlen und
// Uhrzeiten, darueber Tippfehler. Beides waere ein Angebot, das niemand
// nachrechnet, bevor es rausgeht.
const PREIS_MUSTER = /(\d{1,3}(?:\.\d{3})+|\d{2,6})(?:,(\d{2}))?\s*(?:€|EUR\b|Euro\b)/gi;

function preiseAus(text) {
  const raus = [];
  for (const m of String(text || "").matchAll(PREIS_MUSTER)) {
    const n = Number(m[1].replace(/\./g, "")) + (m[2] ? Number(m[2]) / 100 : 0);
    if (n >= 100 && n <= 100000) raus.push(n);
  }
  return raus;
}

// Steht die Zahl, die das Modell nennt, so auch im Material? Ohne diese Pruefung
// waere die Preisfindung genau die Stelle, an der ein Sprachmodell etwas
// Plausibles erfindet — und das Plausible steht dann in einem Angebot.
function belegbar(preis, text) {
  if (!preis) return false;
  const flach = String(text).replace(/\./g, "");
  const ganz = String(Math.round(preis));
  return flach.includes(ganz);
}

function preisFinden({ auftrag, firma, material }) {
  const gesagt = Number(auftrag.betrag);
  if (gesagt > 0) return { preis: gesagt, woher: "gesagt" };

  const setup = Number(firma?.preis_setup);
  if (setup >= 100) return { preis: setup, woher: "akte" };

  const deal = material.deals.map((d) => Number(d.wert)).find((w) => w >= 100);
  if (deal) return { preis: deal, woher: "deal" };

  // Aus dem Text: die Zahl aus dem JUENGSTEN Eintrag gewinnt. Wer zweimal ueber
  // Geld gesprochen hat, meint beim zweiten Mal den gueltigen Preis.
  for (const z of [...material.zeilen].reverse()) {
    const p = preiseAus(z.kern);
    if (p.length) return { preis: p[0], woher: "gespraech" };
  }
  const rest = preiseAus(material.text);
  if (rest.length) return { preis: rest[rest.length - 1], woher: "gespraech" };

  return { preis: null, woher: null };
}

// --- Auswerten --------------------------------------------------------------
const SYSTEM = `Du wertest fuer Flowstate (Webdesign, SEO, KI-Suchoptimierung, Social Media) die Notizen zu EINEM Kunden aus, damit daraus ein Angebot geschrieben werden kann.

Du bekommst rohe Gespraechsnotizen aus dem CRM. Sie sind stichwortartig, teils halbe Saetze, teils Tippfehler. Deine Aufgabe ist ENTNEHMEN, nicht Ausschmuecken.

ALLES, WAS DU SCHREIBST, WIRD VORGELESEN. Schreib echte Umlaute — ä, ö, ü, ß — niemals ae, oe, ue oder ss. Eine Stimme buchstabiert "Rueckrufzeiten" als "R-u-e-ck-ruf-zeiten". Schreib ganze, richtige Wörter, keine Stichworte wie "Webseite überarbeitung".

REGELN:
· Erfinde nichts. Steht von Social Media nichts da, kommt auch nichts davon vor.
· Der Preis kommt NUR aus den Notizen. Steht dort keine Zahl, gib null zurueck — raten ist verboten.
· "leistung" ist die Vorlage fuer den Angebotstext: zwei bis vier Saetze, die sagen, was der Kunde bekommen soll und was ihm dabei wichtig ist. Schreib sie so, wie Lukas das Projekt beschreiben wuerde — sachlich, konkret, ohne Werbesprache und ohne Anrede.
· Widersprechen sich zwei Notizen, gilt die spaetere.

WANN "verwertbar" true ist — und das ist keine hohe Huerde:
· Sobald erkennbar ist, WAS der Kunde will (neue Webseite, Ueberarbeitung, Social Media) ODER ueber welchen Preis gesprochen wurde. Ein Halbsatz reicht. Notizen aus dem Vertrieb sind immer knapp; knapp ist nicht dasselbe wie leer.
· false NUR, wenn ausschliesslich Organisatorisches dasteht: Rueckrufzeiten, Namen, Termine, "nicht erreicht", "war auf Baustelle". Aus einer Rueckrufzeit laesst sich kein Angebot schreiben.
· Bei false gehoert in "warum" ein kurzer Halbsatz, was stattdessen dasteht ("nur Rückrufzeiten, nichts zum Vorhaben"). Er wird Lukas vorgelesen und faengt klein an.

DIE KERNPUNKTE sind das, was Lukas zu hoeren bekommt. Sie sagen, was der Kunde WILL — nicht, was er ist. Also "eine neue Webseite" und "vorab eine Demo-Seite sehen", nicht "Elektroinstallateur aus Bad Woerishofen". Hoechstens sechs Woerter je Punkt. Sie werden mit "und" aneinandergehaengt und in einen laufenden Satz gesetzt, fangen also mit einem kleinen Wort an ("eine neue Webseite", nicht "Neue Webseite") und tragen keinen Punkt am Ende.

Antworte AUSSCHLIESSLICH mit diesem JSON-Objekt, ohne ein Wort davor oder danach:
{"verwertbar": true oder false,
 "leistung": "2-4 Saetze: was angeboten werden soll und worauf der Kunde Wert legt",
 "kernpunkte": ["hoechstens zwei kurze Halbsaetze zum Vorlesen, ohne Aufzaehlungszeichen"],
 "preis": Zahl in Euro oder null,
 "sparte": "Website" oder "SocialMedia" oder "Performance Marketing",
 "warum": "nur bei verwertbar false, sonst leer"}`;

// Notnagel gegen ae/oe/ue aus dem Modell (20.08.).
//
// Der System-Prompt verlangt echte Umlaute, und trotzdem kam im ersten
// Live-Lauf "Nur Rueckrufzeiten und Organisatorisches" zurueck. Vorgelesen wird
// daraus "R-u-e-ck-ruf-zeiten" — genau der Patzer, den Lukas am 07.08. als
// "hoert sich nicht an wie ein echter Mensch" beschrieben hat.
//
// aussprache.js hat dafuer eine Wortliste, aber sie kennt nur, was ihr schon
// einmal begegnet ist ("Rueckrufzeiten" steht nicht drin). Hier stehen deshalb
// STAEMME statt ganzer Woerter — und bewusst nur solche, bei denen die
// Buchstabenfolge im Deutschen nichts anderes sein KANN. Eine allgemeine Regel
// ue->ü verbietet sich: sie machte aus "neue" ein "nü".
const STAEMME = [
  [/\bRueck/g, "Rück"], [/rueck/g, "rück"], [/\bUeber/g, "Über"], [/ueberarbeit/g, "überarbeit"],
  [/moecht/g, "möcht"], [/koenn/g, "könn"], [/wuensch/g, "wünsch"], [/spaeter/g, "später"],
  [/Gespraech/g, "Gespräch"], [/gespraech/g, "gespräch"], [/naechst/g, "nächst"],
  [/zusaetzlich/g, "zusätzlich"], [/moeglich/g, "möglich"], [/persoenlich/g, "persönlich"],
  [/Woerishofen/g, "Wörishofen"], [/groess/g, "größ"], [/\bfuer\b/g, "für"], [/\bueber\b/g, "über"],
];

function umlaute(s) {
  let t = String(s || "");
  for (const [muster, ersatz] of STAEMME) t = t.replace(muster, ersatz);
  return t;
}

// Das Modell packt die Antwort gern in einen Codeblock (gemessen 20.08.:
// Haiku 4.5 antwortet mit ```json … ```). Ohne dieses Auspacken scheitert
// JSON.parse zuverlaessig — und der Rueckfall greift, obwohl das Modell
// sauber geantwortet hat.
function jsonAus(text) {
  const roh = String(text || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const anfang = roh.indexOf("{");
  const ende = roh.lastIndexOf("}");
  if (anfang < 0 || ende <= anfang) throw new Error("kein JSON in der Antwort");
  return JSON.parse(roh.slice(anfang, ende + 1));
}

// Fallback ohne Modell. Er ist nicht schoen, aber er ist da — und morgen wird
// gedreht (20.08.). Ein Werkzeug, das bei einem Modellausfall gar nichts sagt,
// ist im Video schlimmer als eines, das die Rohnotiz weiterreicht: angebot-text.js
// kann daraus immer noch ein Angebot schreiben, es steht ja alles drin.
function ohneModell(material) {
  const roh = material.text.replace(/\s+/g, " ").trim();
  return {
    verwertbar: material.verwertbar,
    leistung: roh.slice(0, 1200),
    kernpunkte: material.zeilen.length ? [material.zeilen[material.zeilen.length - 1].kern.slice(0, 90)] : [],
    preis: null,
    sparte: "Website",
    warum: "",
    geschaetzt: true,
  };
}

async function deuten(firma, material) {
  if (!material.verwertbar) return { ...ohneModell(material), verwertbar: false };
  try {
    const nutzer = [
      `Kunde: ${firma.name}`,
      firma.branche ? `Branche: ${firma.branche}` : null,
      firma.taetigkeit ? `Taetigkeit: ${firma.taetigkeit}` : null,
      firma.ort ? `Ort: ${firma.ort}` : null,
      material.deals.length ? `Offener Deal: ${material.deals[0].titel} (${material.deals[0].sparte || "?"})` : null,
      "",
      "Notizen aus dem CRM, aelteste zuerst:",
      material.text.slice(0, 3000),
    ].filter((x) => x !== null).join("\n");

    const roh = await schnell.frage(SYSTEM, nutzer,
      { maxTokens: 700, temp: 0.2, model: MODELL, timeoutMs: 20000 });
    const w = jsonAus(roh);

    const preis = Number(w.preis);
    return {
      verwertbar: w.verwertbar !== false,
      leistung: umlaute(String(w.leistung || "").replace(/\s+/g, " ").trim()).slice(0, 1200),
      kernpunkte: (Array.isArray(w.kernpunkte) ? w.kernpunkte : [])
        .map((k) => umlaute(String(k)).replace(/\s+/g, " ").replace(/[.;]+$/, "").trim())
        // Hart gekappt. Der Sprechsatz traegt zwei Kernpunkte plus die Zahl
        // plus die Rueckfrage von beleg-erstellen — wird ein Punkt zum Satz,
        // ist die ganze Antwort zu lang zum Zuhoeren.
        .filter((k) => k.length > 3).map((k) => k.slice(0, 60)).slice(0, 2),
      // Nur was sich im Material wiederfindet. Alles andere waere geraten.
      preis: belegbar(preis, material.text) ? preis : null,
      sparte: SPARTEN.includes(w.sparte) ? w.sparte : "Website",
      warum: umlaute(String(w.warum || "")).replace(/\s+/g, " ").replace(/[.;]+$/, "").trim().slice(0, 120),
    };
  } catch (e) {
    console.error("Gespraech deuten:", e.message);
    return ohneModell(material);
  }
}

// Die ausgewertete Fassung, ohne dass etwas erzeugt wird. Eigene Funktion, weil
// Lukas auch nur "werte das Gespraech aus" sagen kann — und weil sich das so
// testen laesst, ohne eine Angebotsnummer zu verbrauchen.
async function auswerten(auftrag = {}) {
  const gesucht = String(auftrag.firma || "").trim();
  if (!gesucht) return { ok: false, grund: "keine-firma" };

  const g = await firmaFinden(gesucht);
  if (!g.ok) return { ok: false, grund: g.grund, namen: g.namen || [], gesucht };

  const f = g.firma;
  // suchen() liefert nur die Beleg-Felder. Was das GESPRAECH ausmacht — stand,
  // argumente, notizen, der Termin des Erstgespraechs — steht in anderen
  // Spalten und wird hier nachgeholt. Zwei kleine Abfragen statt einer grossen
  // Feldliste an einer Stelle, die Belege fuellt und davon nichts wissen muss.
  const mehr = await frag(
    "select stand, argumente, notizen, erstgespraech_am, preis_setup, preis_monatlich, status " +
    "from firmen where id = $1", [f.id]);
  const firma = { ...f, ...(mehr?.[0] || {}) };

  const material = await materialHolen(firma);
  const gedeutet = await deuten(firma, material);
  const { preis, woher } = preisFinden({ auftrag, firma, material });

  return {
    ok: true,
    firma,
    material,
    verwertbar: Boolean(gedeutet.verwertbar && material.verwertbar),
    leistung: gedeutet.leistung,
    kernpunkte: gedeutet.kernpunkte,
    sparte: auftrag.sparte && SPARTEN.includes(auftrag.sparte) ? auftrag.sparte : gedeutet.sparte,
    // Der gefundene Preis gewinnt gegen den gedeuteten: preisFinden() kennt die
    // gepflegten Felder, das Modell nur den Fliesstext.
    preis: preis || gedeutet.preis || null,
    preisWoher: preis ? woher : (gedeutet.preis ? "gespraech" : null),
    // Warum nichts zu holen war — fuer den ehrlichen Satz. Ohne ihn klingt jede
    // Absage gleich, und Lukas weiss nicht, ob die Akte leer ist oder nur voller
    // Rueckrufzeiten.
    warum: gedeutet.warum || "",
    erstgespraechAm: firma.erstgespraech_am || null,
  };
}

// --- Saetze zum Vorlesen ----------------------------------------------------
//
// Alles hier ist fuers Ohr geschrieben: kurz, keine Aufzaehlung, keine
// Aktenzeichen, echte Umlaute. lib/aussprache.js macht daraus die gesprochene
// Fassung — es kann Zahlen und Daten wandeln, aber keinen Listenpunkt retten.
const euroWort = (n) => Math.round(Number(n)) + " Euro";

function worumEsGing(a) {
  const k = a.kernpunkte.filter(Boolean);
  if (k.length >= 2 && k[0].length + k[1].length <= 85) return `${k[0]} und ${k[1]}`;
  if (k.length) return k[0];
  // Ohne Kernpunkte der erste Satz der Leistungsbeschreibung — nie der ganze
  // Absatz. Vorgelesen ist ein Absatz eine Zumutung.
  const satz = String(a.leistung || "").split(/(?<=[.!?])\s/)[0] || "";
  return satz.slice(0, 110).replace(/[.;]+$/, "");
}

// Firmennamen so, wie man sie sagen kann.
//
// Zwei Dinge aus dem Bestand (20.08. live gesehen): Importierte Namen tragen
// Trennstriche aus dem Verzeichnis — "Dachdecker | Erwin Restle GmbH |
// München" —, und dieselbe Firma steht manchmal zweimal drin, einmal kurz und
// einmal lang. Beides vorgelesen klingt nach einem Systemfehler, nicht nach
// einer Frage.
function fuersOhr(namen) {
  const sauber = namen
    .map((n) => String(n).replace(/\s*\|\s*/g, ", ").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);
  const raus = [];
  for (const n of sauber) {
    // Steht ein kuerzerer Name schon drin und dieser hier enthaelt ihn, ist es
    // derselbe Betrieb in einer laengeren Schreibweise.
    if (raus.some((k) => n.toLowerCase().includes(k.toLowerCase()))) continue;
    raus.push(n);
  }
  return raus;
}

// Der Satz, der aus einer Absage ein Angebot macht. Er steht an vier Stellen
// unten und heisst deshalb hier einmal.
const WEITERHELFEN = "Sag mir Leistung und Preis, dann schreib ich dir das Angebot sofort.";

// --- Die ganze Kette --------------------------------------------------------
//
// Das ist, was die Route aufruft. Rueckgabe wie bei beleg-erstellen.js:
// "reply" fuer den Chat, "gesprochen" fuer die Stimme.
async function ausGespraech(auftrag = {}) {
  const gesucht = String(auftrag.firma || "").trim();
  if (!gesucht) {
    // Der EINZIGE Fall, in dem nach der Firma gefragt werden darf: es stand
    // wirklich keine im Satz.
    const satz = "Zu welcher Firma soll ich das Erstgespräch auswerten?";
    return { ok: false, reply: satz, gesprochen: satz };
  }

  const a = await auswerten(auftrag);

  // --- Firma nicht auffindbar ----------------------------------------------
  if (!a.ok) {
    if (a.grund === "mehrdeutig" || a.grund === "aehnlich") {
      const namen = fuersOhr(a.namen || []).slice(0, 3);
      const liste = namen.length > 1
        ? `${namen.slice(0, -1).join(", ")} und ${namen[namen.length - 1]}`
        : namen[0];
      const satz = a.grund === "mehrdeutig"
        ? `Auf ${gesucht} passen bei mir mehrere: ${liste}. Welche meinst du?`
        // Kein stiller Zugriff auf den Beinahe-Treffer: "Bergmann Immobilien"
        // ist nicht die "Zahnarztpraxis Bergmann", und ein Angebot beim
        // Falschen holt keiner zurueck.
        : `Eine ${gesucht} finde ich nicht — ich hab ${liste} im System. Meinst du die? Sonst ${WEITERHELFEN.charAt(0).toLowerCase()}${WEITERHELFEN.slice(1)}`;
      return { ok: false, reply: satz, gesprochen: satz };
    }
    if (a.grund === "nicht-erreichbar") {
      const satz = "An die Kundenakten komm ich gerade nicht ran. Sag mir Leistung und Preis, dann schreib ich das Angebot trotzdem.";
      return { ok: false, reply: satz, gesprochen: satz };
    }
    // Nicht gefunden oder Name zu kurz — ehrlich UND mit Weg nach vorn.
    const satz = `Zum Erstgespräch mit ${gesucht} steht bei mir nichts im System — die Firma finde ich gar nicht erst. ${WEITERHELFEN}`;
    return { ok: false, reply: satz, gesprochen: satz };
  }

  const name = a.firma.name;

  // --- Firma da, Gespraech nicht -------------------------------------------
  //
  // "warum" macht aus einer Absage eine Auskunft: "nur Rueckrufzeiten, nichts
  // zum Vorhaben" sagt Lukas, dass die Akte nicht leer ist, sondern dass beim
  // Gespraech nichts notiert wurde. Das ist ein Unterschied, auf den er
  // reagieren kann.
  if (!a.verwertbar) {
    // Kleingeschrieben angehaengt: Das Modell liefert den Halbsatz mal mit,
    // mal ohne grossen Anfangsbuchstaben, und "— Nur Rueckrufzeiten" mitten im
    // Satz klingt vorgelesen nach zwei Saetzen.
    const warum = a.warum ? a.warum.charAt(0).toLowerCase() + a.warum.slice(1) : "";
    const woran = warum ? ` — ${warum}` : " — keine Notiz, aus der ich ein Angebot bauen könnte";
    const satz = `Zum Erstgespräch mit ${name} steht nichts Verwertbares im System${woran}. ${WEITERHELFEN}`;
    return { ok: false, reply: satz, gesprochen: satz, firma: name, auswertung: a };
  }

  const worum = worumEsGing(a);

  // --- Nur auswerten, nichts erzeugen --------------------------------------
  if (auftrag.nur_auswerten) {
    const preisSatz = a.preis ? ` Über den Preis habt ihr ${euroWort(a.preis)} gesprochen.` : "";
    const satz = `Aus dem Erstgespräch mit ${name}: ${worum}.${preisSatz}`;
    return {
      ok: true, firma: name, auswertung: a,
      reply: `${satz}\n\n${a.leistung}`,
      gesprochen: `${satz} Soll ich daraus ein Angebot machen?`,
    };
  }

  // --- Material ja, Preis nein ---------------------------------------------
  //
  // Hier NICHT erzeugen. Ein Angebot mit geratenem Betrag geht an einen echten
  // Kunden, und die Zahl ist das Einzige, was er zuerst liest. Die Rueckfrage
  // ist trotzdem keine Absage: Alles andere ist schon ausgewertet, ein Satz von
  // Lukas reicht.
  if (!a.preis) {
    const satz = `Das Erstgespräch mit ${name} hab ich durch: ${worum}. Ein Preis steht nirgends — sag mir die Zahl, dann geht das Angebot raus.`;
    return { ok: false, reply: `${satz}\n\n${a.leistung}`, gesprochen: satz, firma: name, auswertung: a };
  }

  // --- Alles da: Angebot schreiben lassen ----------------------------------
  //
  // Ab hier uebernimmt beleg-erstellen.js unveraendert: Nummer, Vorlage, PDF,
  // und vor allem die Rueckfrage "soll ich es raussenden?". Deren Zustand lebt
  // dort — deshalb wird hier NICHT nachgebaut, sondern aufgerufen. Ein "ja"
  // danach findet dieselbe offene Rueckfrage wie sonst auch.
  const b = await belegErstellen.erstellen({
    art: "angebot",
    firma: name,
    betrag: a.preis,
    leistung: a.leistung,
    sparte: a.sparte,
    // Anschrift, Anrede und Mailadresse holt beleg-erstellen selbst aus dem
    // CRM. Was Lukas gerade dazugesagt hat, wird durchgereicht — es gewinnt
    // dort gegen den CRM-Eintrag, und das soll so bleiben.
    anrede: auftrag.anrede || "",
    strasse: auftrag.strasse || "",
    plz_ort: auftrag.plz_ort || "",
    email: auftrag.email || "",
  });

  // Woher der Preis kam, gehoert in den Satz. Ohne diese Angabe hoert Lukas nur
  // eine Zahl und weiss nicht, ob sie aus dem Gespraech, aus der Akte oder von
  // ihm selbst stammt — und prueft sie dann nicht.
  const HERKUNFT = {
    gespraech: "aus dem Gespräch",
    akte: "aus der Kundenakte",
    deal: "aus dem offenen Deal",
    gesagt: "",
  };
  const woher = HERKUNFT[a.preisWoher] || "";
  const vorspann = `Ich hab das Erstgespräch mit ${name} ausgewertet: ${worum}, ${euroWort(a.preis)}${woher ? " " + woher : ""}.`;

  return {
    ...b,
    firma: name,
    auswertung: a,
    reply: `${vorspann}\n\n${b.reply}`,
    // Zwei Saetze plus die Rueckfrage von beleg-erstellen. Mehr darf es nicht
    // werden: Am 19.08. wurde ein ganzes Angebot am Stueck vorgelesen, und
    // genau das soll hier nicht zurueckkommen.
    gesprochen: `${vorspann} ${b.gesprochen || b.reply}`,
  };
}

module.exports = {
  ausGespraech, auswerten, firmaFinden,
  // fuer scripts/test-gespraech-angebot.js
  kern, preiseAus, preisFinden, tragendeWorte, belegbar, worumEsGing, fuersOhr, umlaute, SPARTEN,
};
