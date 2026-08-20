// "Wie viele Leads hat Ioannis heute bekommen?" — Alexandra schaut selbst nach.
//
// Warum es das gibt (Lukas, 07.08.2026): "Wichtig ist, dass das keine
// vorgegebene Antwort ist. Wenn ich frage, soll Alexandra wirklich selber
// nachschauen. Denn wenn man davor einen vorqualifizierten Baukasten baut,
// dann kommt immer mal ein Fall, der nicht dem Baukasten entspricht, und dann
// kommen falsche Antworten raus."
//
// Genau das war passiert. Am 05.08. um 19:07 kamen drei verschiedene Fragen —
// "was hat sich im CRM getan", "kam was Neues bei Jannik und Ioannis", "wurden
// Erstgespräche gebucht" — und dreimal WORTGLEICH dieselbe Antwort. Das alte
// Werkzeug las aus dem Auftrag nur zwei Dinge (Zeitraum, Bereich) und warf den
// Rest weg; alle drei Fragen fielen auf denselben Aufruf zusammen. Schlimmer
// noch: Es zaehlte "6 neue Firmen", weil die Abfrage ein "limit 6" trug und die
// Zeilenzahl als Anzahl vorgelesen wurde. Tatsaechlich waren es 273.
//
// Hier gibt es keinen Katalog moeglicher Fragen. Das Modell bekommt das echte
// Tabellenschema und schreibt die Abfrage selbst. Was es nicht gibt, kann auch
// nicht fehlen.
//
// DREI SICHERUNGEN, weil ein Modell Abfragen gegen die Produktivdatenbank stellt:
//
//   1. "begin transaction read only" — Postgres verweigert jeden Schreibbefehl
//      auf Engine-Ebene. Keine Stichwortliste, die man umgehen koennte.
//   2. statement_timeout — eine verungluecke Abfrage kann das Gespraech nicht
//      aufhaengen. Lieber "hat zu lange gedauert" als Stille.
//   3. Zeilenrechte gelten weiter: Der Aufruf laeuft als 'authenticated' mit
//      der Kennung des Nutzers. Alexandra sieht nie mehr, als er sehen darf.
//
// Das Schema kommt AUS DER DATENBANK, nicht aus einer Liste hier. Eine
// handgeschriebene Beschreibung veraltet still, und dann raet das Modell ueber
// Spalten, die es nicht mehr gibt.
//
// WARUM DAS SCHEMA NICHT IN DIE WERKZEUGLISTE GEHOERT: Die geht bei JEDEM
// Aufruf mit (siehe Kopf von sprache-werkzeuge.js). Ein Schema von ~3.000
// Zeichen wuerde jede Wetterfrage mitbezahlen. Es steht darum hier und kostet
// nur, wenn wirklich jemand etwas wissen will.

const crm = require("./crm.js");
const schnell = require("./schnell.js");

// Tabellen, in denen Geschaeftsfragen beantwortet werden. Bewusst eine feste
// Auswahl: Das Schema hat ueber 30 Tabellen, die meisten sind Innenleben
// (Sitzungen, Protokolle, Migrationen) und wuerden das Modell nur ablenken.
const TABELLEN = [
  "firmen", "deals", "projekte", "aufgaben", "aktivitaeten", "profiles",
  "pipeline_stages", "kontakte", "belege", "buchungen", "content_posts",
  "content_ideen", "kampagnen", "dokumente",
  // Am 07.08. nachgetragen: Auf "wie viele Abonnenten haben wir" kam "Dazu
  // habe ich keine Daten im System" — die Zahlen lagen die ganze Zeit in
  // content_kanalstand. Das Modell kann nur abfragen, was es im Schema sieht;
  // eine fehlende Tabelle sieht fuer Lukas aus wie fehlendes Wissen.
  "content_kanalstand", "content_zahlen", "kampagnen_zahlen", "zeiterfassung",
];

const ZEILEN_MAX = 60;      // mehr liest niemand vor
const ZEIT_LIMIT = "6s";    // Notbremse in der Datenbank

let schemaText = null, schemaAt = 0;

// Das Schema als knappe Textform: eine Zeile je Tabelle.
async function schema() {
  if (schemaText && Date.now() - schemaAt < 10 * 60 * 1000) return schemaText;
  const { rows } = await crm.system(
    `select table_name, column_name, data_type
       from information_schema.columns
      where table_schema = 'public' and table_name = any($1::text[])
      order by table_name, ordinal_position`, [TABELLEN]);
  const proTabelle = new Map();
  const kurz = (t) => (t.startsWith("timestamp") ? "zeit" : t === "character varying" ? "text"
    : t === "ARRAY" ? "liste" : t === "double precision" || t === "numeric" ? "zahl"
      : t === "integer" || t === "bigint" ? "zahl" : t);
  for (const r of rows) {
    if (!proTabelle.has(r.table_name)) proTabelle.set(r.table_name, []);
    proTabelle.get(r.table_name).push(`${r.column_name}:${kurz(r.data_type)}`);
  }
  schemaText = [...proTabelle].map(([t, s]) => `${t}(${s.join(", ")})`).join("\n");
  schemaAt = Date.now();
  return schemaText;
}

// Was das Modell wissen muss, um brauchbares SQL zu schreiben. Die Hinweise
// unten sind keine Kosmetik — jeder steht fuer einen Fall, der sonst schiefgeht.
const ANWEISUNG = `Du schreibst EINE Postgres-Abfrage, die Lukas' Frage beantwortet.

Antworte NUR mit JSON, ohne Rahmen:
{"sql":"select ...","thema":"kurz, was gezaehlt/geholt wird"}

REGELN
- Nur SELECT. Kein insert/update/delete/alter, keine Transaktion, kein Semikolon am Ende.
- Zaehlen heisst count(*). NIE eine Zeilenzahl aus einem "limit" als Anzahl ausgeben —
  genau daran ist die alte Fassung gescheitert ("6 neue Firmen", es waren 273).
- Wer will beides (Anzahl UND Beispiele), holt beides in EINER Abfrage:
  select count(*) over () as anzahl, name from ... limit 5
- Zeit: heute = erstellt >= current_date. Gestern = >= current_date - 1.
  Diese Woche = >= date_trunc('week', current_date). Die Spalte heisst
  ueberall "erstellt", nur bei aktivitaeten "zeit".
- aktivitaeten IST DAS VERLAUFSPROTOKOLL — dort steht, WAS passiert ist.
  Spalte art: 'anruf' | 'notiz' | 'stufenwechsel' | 'uebergabe' | 'aussortiert'
  | 'mail' | 'termin' | 'system'. Spalte text beschreibt den Vorgang
  ("Erstgespraech -> Follow-up"), firma_id und deal_id verweisen darauf.
  Also: "welche Deals sind weitergerueckt" -> art='stufenwechsel', mit
  firmen verknuepfen und name + text ausgeben. "was ist heute passiert" ->
  ebenfalls hier. Sag NIE, es gebe keinen Zeitstempel fuer Stufenwechsel —
  es gibt ihn, er heisst aktivitaeten.zeit.
- Personen stehen in profiles(name). Ueber firmen.besitzer / deals.besitzer
  verknuepfen. Namen mit ilike vergleichen, nie exakt — gesprochene Namen sind
  ungenau ("Johannes" ist Ioannis, "Jannik vom Hofe" wird als "Jannik" gesagt).
- firmen.status: 'lead' | 'kunde' | 'verloren'. deals.status: 'offen' |
  'gewonnen' | 'verloren'. Der Bereich einer Firma steht als Tag in firmen.tags
  ('webdesign','performance','ki'), die Branche ebenfalls als Tag.
- Ein gebuchtes Erstgespraech erkennt man am Tag 'gebucht' in firmen.tags oder
  an firmen.erstgespraech_am.
- "WIE VIELE LEADS HABEN WIR (FUER MORGEN) ZUR VERFUEGUNG" beantwortest du
  NICHT hier — die Zahl steht schon im STAND ("Leads zum Anrufen"). Diese Frage
  darf gar nicht bei dir landen.
  Wird trotzdem danach gefragt: Ein Lead steht zur Verfuegung, wenn er eine
  Telefonnummer hat und noch nie angerufen wurde — ein Datum braucht es dafuer
  NICHT. KEIN "group by besitzer", solange keine Person genannt ist: Die Frage
  lautet "haben WIR", die Antwort ist eine Gesamtzahl.
- GELDFRAGEN GEBEN EINE SUMME ZURUECK, NIE EINE LISTE. Faellt in der Frage
  eines dieser Woerter — Umsatz, umgesetzt, eingenommen, Einnahmen, verdient,
  Geschaeft gemacht, wie viel Geld —, dann MUSS die erste Spalte eine Summe
  sein: sum(...) as umsatz. Namen der Kunden darfst du danebenstellen, aber nie
  STATT der Summe.
  UMSATZ heisst in diesem Haus: gewonnene Deals.
    select coalesce(sum(wert),0) as umsatz from deals
     where status='gewonnen' and geschlossen_am >= <von> and geschlossen_am < <bis>
  Immer nach deals.geschlossen_am datieren, NIE nach erstellt. Genau so rechnet
  die Zentrale (crm.kennzahlen), und nur so stimmt die Zahl mit dem ueberein,
  was Lukas auf dem Dashboard sieht.
  Das gilt fuer JEDEN Zeitraum gleich — "im Juli", "diesen Monat"
  (>= date_trunc('month', current_date)), "letzte Woche", "dieses Jahr",
  ohne Angabe (dann laufender Monat).
  buchungen und belege sind die BUCHHALTUNG — die nimmst du nur, wenn nach
  Ein-/Ausgaben, Kosten, Kontostand, Gewinn oder Belegen gefragt wird
  (art: 'einnahme' | 'ausgabe').
  Zwei gemessene Fehlschlaege, beide am 20.08., beide dieselbe Ursache:
  "wie viel Umsatz im Juli" lief gegen buchungen und sagte "null Euro" (in den
  gewonnenen Deals standen 5.000); "wie viel Umsatz diesen Monat" lieferte
  "9 Deals diesen Monat: Ralph Richter Malereibetrieb, Frau Ladenhauf …" statt
  der 7.000, die die Zentrale zeigt. Gefragt war beide Male nach Geld.
- thema ist die Beschriftung fuers Vorlesen. Sie wird HINTER die Zahl gesetzt
  ("273 <thema>."), muss also im Plural stehen und darf das Wort "Anzahl" NICHT
  enthalten. Richtig: "neue Firmen heute", "Leads von Ioannis",
  "gebuchte Erstgespraeche diese Woche". Falsch: "Anzahl der Kunden".
- Hol immer eine Spalte mit, an der man die Treffer erkennt (name, titel),
  wenn es nicht rein um eine Zahl geht — sonst kann nur die Zahl vorgelesen
  werden und nicht, WER oder WAS gemeint ist.
- Geht die Frage wirklich aus KEINER dieser Tabellen zu beantworten, dann
  {"sql":"","thema":"<ein vollstaendiger deutscher Satz zum Vorlesen>"} — also
  z. B. "Dazu habe ich keine Daten im System." NICHT die Worte "warum nicht"
  hinschreiben, das wird woertlich vorgelesen. Und erst gruendlich suchen:
  fast alles steht irgendwo, meist in aktivitaeten.`;

function jsonAus(text) {
  const roh = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(roh); } catch { /* weiter unten */ }
  const t = roh.match(/\{[\s\S]*\}/);
  if (t) { try { return JSON.parse(t[0]); } catch { /* aufgeben */ } }
  return null;
}

// Die Abfrage ausfuehren — schreibgeschuetzt, mit Zeitlimit, unter den
// Zeilenrechten des Nutzers.
async function ausfuehren(sql, nutzerId) {
  const c = await crm.pool.connect();
  try {
    await c.query("begin transaction read only");
    await c.query(`set local statement_timeout = '${ZEIT_LIMIT}'`);
    await c.query("set local role authenticated");
    await c.query(`set local request.jwt.claims = '${JSON.stringify({ sub: nutzerId, role: "authenticated" })}'`);
    const r = await c.query(`select * from (${sql}) als_frage limit ${ZEILEN_MAX}`);
    await c.query("rollback");
    return { ok: true, zeilen: r.rows, spalten: r.fields.map((f) => f.name) };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { ok: false, fehler: String(e.message).split("\n")[0].slice(0, 180) };
  } finally {
    c.release();
  }
}

const zahlDe = (n) => Number(n).toLocaleString("de-DE");
const istZahl = (v) => v !== null && v !== "" && !Number.isNaN(Number(v));

// Ein einzelner Wert, wie man ihn vorliest. Datumswerte kommen als JS-Date aus
// dem Treiber — ohne diese Zeile stand im ersten Lauf "Fri Aug 07 2026
// 10:06:32 GMT+0000 (Coordinated Universal Time)" in der gesprochenen Antwort.
// Spalten, in denen Geld steht. Der Treiber liefert numeric als STRING, nicht
// als Zahl — ohne diese Liste ging der Wert ungeformt durch.
const GELD_SPALTE = /(wert|betrag|umsatz|summe|preis|honorar|einnahm|ausgab|kosten|gewinn|saldo)/i;

function wertText(v, spalte = "") {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) {
    return v.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
  }
  if (typeof v === "number") return GELD_SPALTE.test(spalte) ? `${zahlDe(v)} €` : zahlDe(v);
  // GELD KOMMT ALS TEXT AN (20.08.2026). Postgres gibt numeric als String
  // zurueck, damit nichts an Genauigkeit verlorengeht. Die Folge stand im
  // Probelauf woertlich da: "Euro Umsatz im Juli 2026: 5000.00." — roh aus der
  // Datenbank, ohne Tausenderpunkt, ohne Waehrung. lib/aussprache.js kann
  // daraus nichts machen, weil ihr das "€" fehlt, an dem sie Geld erkennt;
  // vorgelesen wurde "fuenftausend Punkt null null". In einer Werbeaufnahme
  // ist das der Satz, der die Einstellung kostet.
  if (typeof v === "string" && /^-?\d+(\.\d{1,2})?$/.test(v) && GELD_SPALTE.test(spalte)) {
    return `${zahlDe(Number(v))} €`;
  }
  return String(v).replace(/\s+/g, " ").trim().slice(0, 70);
}

// "Anzahl der neuen Firmen" wuerde zu "27 Anzahl der neuen Firmen" — die Zahl
// steht ja schon davor. Genau das kam im ersten Lauf heraus ("27 Anzahl Kunden").
const putzen = (t) => String(t || "Treffer").trim()
  .replace(/^(die |der |das )?anzahl( der| von| an)?\s+/i, "")
  // "Euro Umsatz im Juli" (so beschriftete das Modell am 20.08.) wird zu
  // "Euro Umsatz im Juli: fuenftausend Euro" — die Waehrung zweimal. Sie
  // gehoert an die Zahl, nicht an die Beschriftung.
  .replace(/^(euro|eur|€)\s+/i, "")
  .replace(/\.$/, "");

// Aus Zeilen wird ein Satz. Mechanisch — und das ist der Unterschied zum alten
// Baukasten: Dort war die FRAGE vorgegeben, hier nur die Formulierung. WAS
// gefragt und geholt wird, entscheidet jedes Mal neu das Modell.
function satzBauen(thema, spalten, zeilen) {
  const th = putzen(thema);
  if (!zeilen.length) return `Keine Treffer — ${th}.`;

  // Trägt das Ergebnis eine echte Gesamtzahl, gilt sie — nicht die Zahl der
  // gelieferten Zeilen. Das ist der Fehler, an dem die alte Fassung starb.
  const anzahlSpalte = spalten.find((s) => /^(anzahl|gesamt|count|n)$/i.test(s));
  const rest = spalten.filter((s) => s !== anzahlSpalte);
  // Eine Gesamtzahl ist sie nur, wenn in JEDER Zeile dieselbe steht — so
  // verhaelt sich count(*) over (). Bei "union all" oder "group by" steht dort
  // dagegen die Zahl JE ZEILE. Ohne diese Unterscheidung las die erste Fassung
  // die erste Teilzahl als Gesamtsumme vor: "100 Ereignisse im CRM heute",
  // wobei 100 nur die Aktivitaeten waren.
  const einheitlich = anzahlSpalte &&
    zeilen.every((z) => Number(z[anzahlSpalte]) === Number(zeilen[0][anzahlSpalte]));
  const gesamt = einheitlich ? Number(zeilen[0][anzahlSpalte]) : null;

  // Nur eine Zahl — der Normalfall bei "wie viele".
  if (!rest.length) return `${zahlDe(gesamt ?? zeilen.length)} ${th}.`;

  // Eine Zeile mit mehreren Zaehlspalten — das Muster fuer "was hat sich
  // getan": select (…) as neue_firmen, (…) as neue_deals, (…) as anrufe.
  // Ohne diesen Zweig las die erste Fassung daraus "1 Aenderungen, darunter
  // 100" — die Zeilenzahl als Anzahl und eine Kennzahl als Name.
  if (zeilen.length === 1 && rest.length > 1 && rest.every((s) => istZahl(zeilen[0][s]))) {
    const teile = rest
      .filter((s) => Number(zeilen[0][s]) !== 0)
      // Geld traegt seine Waehrung mit — sonst steht da "5000 gesamtumsatz".
      .map((s) => (GELD_SPALTE.test(s)
        ? `${wertText(zeilen[0][s], s)} ${s.replace(/_/g, " ")}`
        : `${zahlDe(zeilen[0][s])} ${s.replace(/_/g, " ")}`));
    return teile.length ? `${th}: ${teile.join(", ")}.` : `Keine Treffer — ${th}.`;
  }

  // Beschriftung + Zahl je Zeile ("group by berater", "union all je Bereich").
  // Jede Zahl gehoert zu ihrer Beschriftung und muss mit ihr zusammen gesagt
  // werden — sonst hoert Lukas eine Liste von Woertern ohne Zahlen.
  if (anzahlSpalte && !einheitlich && rest.length >= 1) {
    const label = rest.find((s) => !istZahl(zeilen[0][s])) || rest[0];
    const teile = zeilen
      .filter((z) => Number(z[anzahlSpalte]) !== 0)
      .slice(0, 6)
      .map((z) => `${zahlDe(z[anzahlSpalte])} ${wertText(z[label], label)}`);
    return teile.length ? `${th}: ${teile.join(", ")}.` : `Keine Treffer — ${th}.`;
  }

  // Ein einzelner Wert.
  if (zeilen.length === 1 && rest.length === 1) {
    const v = zeilen[0][rest[0]];
    return istZahl(v) && !anzahlSpalte && typeof v !== "string"
      ? `${zahlDe(v)} ${th}.`
      : `${th}: ${wertText(v, rest[0])}.`;
  }

  // GELD GEHT NIE VERLOREN (Fix 20.08.2026).
  //
  // Eine Geldspalte, die in JEDER Zeile denselben Wert traegt, ist eine
  // Gesamtsumme — genau das liefert sum(...) over (). Sie ist die Antwort auf
  // "wie viel Umsatz", und dieser Zweig hat sie bisher weggeworfen.
  //
  // Live gemessen: Die Abfrage holte anzahl, gesamtumsatz und titel. Vorgelesen
  // wurde "5 gewonnene Deals im Juli 2026, darunter Baugeschaeft Stefan
  // Huber …" — die 5.000 € standen in den Daten und kamen nie an. Auf die
  // Nachfrage "in Euro?" folgte "Die Zahl hab ich hier gerade nicht vorliegen".
  // Die Zahl lag vor. Sie fiel eine Zeile weiter unten heraus.
  const geldSpalte = rest.find((s) => GELD_SPALTE.test(s)
    && zeilen.every((z) => istZahl(z[s]) && Number(z[s]) === Number(zeilen[0][s])));

  // Zahl plus Beispiele. Bevorzugt eine Namensspalte; gibt es keine, tut es die
  // erste, die kein Geld ist — sonst wuerden Betraege als "Namen" aufgezaehlt.
  const nameSpalte = rest.find((s) => /name|titel|firma|betreff/i.test(s))
    || rest.find((s) => s !== geldSpalte) || rest[0];
  const namen = nameSpalte === geldSpalte ? [] : [...new Set(zeilen.map((z) => z[nameSpalte])
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => wertText(v, nameSpalte)))].slice(0, 5);
  const n = gesamt ?? zeilen.length;
  return `${zahlDe(n)} ${th}` +
    (geldSpalte ? `, zusammen ${wertText(zeilen[0][geldSpalte], geldSpalte)}` : "") +
    (namen.length ? `, darunter ${namen.join(", ")}` : "") + ".";
}

// Aus den Zeilen einen Satz machen, den ein Mensch so sagen wuerde.
//
// Warum ein zweiter Modellaufruf (07.08.2026, Entscheidung Lukas): Der
// mechanische Satz aus satzBauen() ist immer richtig und kostet nichts — aber
// er klingt nach Aufzaehlung: "5 Deals mit Stufenwechsel heute, darunter A, B,
// C." Ein Mensch sagt "Fuenf Stueck — beim Mattenfuchs, bei Eigner Elektro und
// zwei anderen." Lukas' Ziel ist ein Gespraech, kein Vorlesegeraet, und die
// rund anderthalb Sekunden dafuer sind ihm den Unterschied wert.
//
// HAIKU, nicht Sonnet: Hier ist nichts mehr zu entscheiden, nur zu
// formulieren. Das Nachdenken ist bei der Abfrage passiert.
//
// Die Sicherung ist wichtiger als der Gewinn: Faellt der Aufruf aus, ist er zu
// langsam oder erfindet er etwas, gilt der mechanische Satz. Eine schoen
// formulierte falsche Zahl waere schlimmer als eine hoelzern vorgetragene
// richtige.
async function satzSprechen(frage, thema, spalten, zeilen, vonMehreren = false) {
  const mechanisch = satzBauen(thema, spalten, zeilen);
  if (!process.env.SCHNELL_API_KEY) return mechanisch;

  // DAS MODELL BEKOMMT DEN FERTIGEN SATZ, NICHT DIE ROHDATEN.
  //
  // Der erste Versuch reichte die Zeilen durch und liess formulieren. Ergebnis
  // im Test am 07.08.: "Ioannis hat insgesamt neunhundertfuenfzehn Leads" —
  // richtig waeren 183 gewesen. Die Abfrage liefert die Gesamtzahl per
  // count(*) over () in JEDER Zeile mit; bei fuenf Zeilen hat das Modell
  // 5 x 183 addiert. Auch die Stufenwechsel wurden frei erfunden ("drei Deals").
  //
  // Also andersherum: Die Zahl steht schon fest und ist geprueft. Das Modell
  // darf nur noch die WORTE aendern, nicht den Inhalt. Damit kann es die
  // Zahlen gar nicht mehr falsch verstehen — es sieht sie nur als Text.
  const zahlen = (mechanisch.match(/\d[\d.]*/g) || []);
  try {
    // Der CHARAKTER geht mit (07.08.): Ohne ihn klang die Antwort korrekt und
    // tonlos — "5 Deals mit Stufenwechsel heute". Lukas hoerte deshalb keinen
    // Unterschied, obwohl der Charakter frisch festgelegt war. Kostet hier
    // nichts extra, der Aufruf passiert ohnehin.
    const satz = await schnell.frage(
      require("./stimme.js").laden() +
      "\n\n## Aufgabe\nFormuliere den SATZ unten so um, wie DU es Lukas sagen wuerdest " +
      "— gesprochen, hoechstens zwei Saetze. Du darfst NUR die Formulierung " +
      "aendern: Jede Zahl und jeder Name bleibt exakt erhalten, Zahlen als Ziffern. " +
      "Nichts hinzufuegen, nichts weglassen, nichts ausrechnen. Rechtsformen (GmbH, " +
      "e.K., & Co. KG) darfst du streichen, die spricht sich schlecht. Keine " +
      "Einleitung wie 'Die Daten zeigen', kein Doppelpunkt-Aufzaehlen. Antworte nur " +
      "mit dem Satz." +
      // Bei mehreren gleichzeitigen Auftraegen kommen die Ergebnisse in der
      // Reihenfolge, in der sie fertig werden. Ohne Zuordnung hoert Lukas
      // mehrere Antworten und muss raten, welche zu welcher Frage gehoert.
      (vonMehreren
        ? " Es laufen mehrere Sachen gleichzeitig und das hier ist EINE davon: Stell " +
          "drei, vier Woerter voran, WOZU es gehoert — 'Die Zahlen sind da: …'."
        : ""),
      `FRAGE WAR: ${frage}\n\nSATZ: ${mechanisch}`,
      { maxTokens: 160, temp: 0.4, timeoutMs: 6000,
        model: process.env.DATEN_SATZ_MODEL || "claude-haiku-4-5" }
    );
    const s = String(satz || "").trim().replace(/^["„]|["“]$/g, "");
    if (!s || s.length > 400) return mechanisch;
    // Die Probe: Jede Zahl aus dem geprueften Satz muss noch da sein. Fehlt
    // eine oder ist eine neue dazugekommen, hat das Modell gerechnet statt
    // formuliert — dann gilt der mechanische Satz. Ein schoener falscher Satz
    // ist schlimmer als ein hoelzerner richtiger.
    const raus = s.match(/\d[\d.]*/g) || [];
    const alleDa = zahlen.every((z) => raus.includes(z));
    const nichtsNeu = raus.every((z) => zahlen.includes(z));
    return alleDa && nichtsNeu ? s : mechanisch;
  } catch { return mechanisch; }
}

// --------------------------------------------------------------------------
async function datenFragen(frage, { nutzerId, vonMehreren = false } = {}) {
  if (!process.env.DATABASE_URL) return { ok: false, hint: "Keine Datenbankverbindung." };
  if (!schnell.verfuegbar || !process.env.SCHNELL_API_KEY) {
    return { ok: false, hint: "Kein Modellzugang fuer die Abfrage eingerichtet." };
  }
  // Ohne Kennung keine Abfrage: Die Zeilenrechte haengen daran, und ein
  // Rueckfall auf "irgendeinen Nutzer" waere genau die Art stiller Annahme,
  // die spaeter niemand mehr findet.
  const kennung = nutzerId || (await crm.system(
    `select id from profiles where aktiv and rolle = 'admin' order by name limit 1`)).rows[0]?.id;
  if (!kennung) return { ok: false, hint: "Kein Konto fuer die Abfrage gefunden." };

  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const tabellen = await schema();

  let sql = "", thema = "", versuche = 0, letzterFehler = null;
  const gestellt = [];

  while (versuche < 2) {
    versuche++;
    const zusatz = letzterFehler
      ? `\n\nDein letzter Versuch schlug fehl:\n${sql}\nFEHLER: ${letzterFehler}\nSchreib die Abfrage neu.`
      : "";
    const roh = await schnell.frage(
      ANWEISUNG,
      `HEUTE IST ${heute}.\n\nTABELLEN:\n${tabellen}\n\nFRAGE: ${frage}${zusatz}`,
      // Zeitlimit am 19.08. von 12 auf 22 Sekunden. Anlass: Im Gespraech
      // fragte Lukas nach zwei CRM-Tagen UND dem Cold-Calling-Tag. Der
      // Auftrag scheiterte nach 21 Sekunden. Nachgemessen brauchte genau
      // diese Frage 11,8 Sekunden — bei 12 Sekunden Grenze. Sie lag also
      // nicht daneben, sondern auf der Kippe, und zwei Anlaeufe kippten
      // beide. Eine Doppelfrage braucht laenger, weil das Modell mehrere
      // Tabellen verbinden muss.
      //
      // Der Auftrag laeuft ohnehin im Hintergrund und meldet sich, wenn er
      // fertig ist — laenger warten kostet hier kein Gespraech.
      // 1600 statt 700 (20.08.2026). Die Dreifachfrage aus Creative 1 — Cold
      // Calls, davon Erstgespraeche, davon Abschluesse — wird zu einer Abfrage
      // mit drei Unterabfragen plus dem JSON-Rahmen drumherum. Bei 700 Token
      // riss sie mittendrin ab, und was ankam, war kein gueltiges JSON mehr.
      // Ungenutzte Token kosten nichts; ein abgeschnittenes SELECT kostet den
      // ganzen Zug.
      { maxTokens: 1600, temp: 0, timeoutMs: 22000,
        model: process.env.DATEN_SQL_MODEL || "claude-sonnet-5" }
    ).catch((e) => {
      // Ehrlich unterscheiden: Ein Zeitueberlauf ist KEIN Formatfehler.
      // Vorher landete beides als "Antwort war kein JSON" im Protokoll —
      // die Fehlersuche lief damit zwangslaeufig in die falsche Richtung.
      const m = String(e.message || "");
      letzterFehler = /timeout|abort|zeit/i.test(m)
        ? `Zeit ueberschritten (${22}s) beim Erzeugen der Abfrage`
        : m.slice(0, 120);
      return "";
    });

    const j = jsonAus(roh);
    // Nur wenn wirklich etwas da war, ist es ein Formatfehler. Leerer Text
    // heisst: der Aufruf oben ist gescheitert, und dessen Grund steht schon
    // in letzterFehler.
    if (!j) {
      if (roh && roh.trim()) letzterFehler = "Antwort war kein JSON";
      else if (!letzterFehler) letzterFehler = "Das Modell hat nichts geliefert";
      continue;
    }
    sql = String(j.sql || "").trim().replace(/;+\s*$/, "");
    thema = String(j.thema || "").trim();
    if (!sql) return { ok: true, reply: thema || "Das kann ich aus den Daten nicht beantworten." };

    gestellt.push(sql);
    const r = await ausfuehren(sql, kennung);
    if (r.ok) {
      return {
        ok: true,
        reply: await satzSprechen(frage, thema, r.spalten, r.zeilen, vonMehreren),
        // Fuer das Sprachprotokoll: Bei "die Zahl stimmt nicht" muss man sehen
        // koennen, WAS gefragt wurde. Sonst debuggt man eine Formulierung,
        // waehrend die Abfrage danebenlag.
        sql: gestellt.join(" || "), zeilen: r.zeilen.length, versuche,
      };
    }
    letzterFehler = r.fehler;
  }

  return { ok: false, hint: `Die Abfrage ging nicht durch: ${letzterFehler}`, sql: gestellt.join(" || ") };
}

module.exports = { datenFragen, schema, satzBauen, jsonAus };
