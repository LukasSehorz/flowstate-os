// Computer Use — Alexandra bedient einen echten Browser (20.08.2026).
//
// WOZU: Bis heute konnte sie nachschlagen, rechnen, schreiben und eintragen.
// Was sie nicht konnte, war das, was ein Mensch am Rechner tut: eine Seite
// aufmachen, ein Formular ausfuellen, das Ergebnis lesen. Fuer die
// Werbeaufnahme ist genau das die Szene — "Buch mir den guenstigsten Flieger
// nach XYZ, abgestimmt mit meinem Terminkalender."
//
// DIE GRENZE STEHT IM REGELWERK, NICHT IN DIESER DATEI.
// Flowstate-Vault/REGELN.md, Zone SCHWARZ: "Zahlungen ausloesen · Vertraege
// abschliessen · Zugangsdaten eingeben · Accounts anlegen · AGB akzeptieren ·
// CAPTCHAs loesen." Also: suchen, vergleichen, vorschlagen — ja. Auf "Buchen"
// klicken — nie, auch nicht auf Zuruf. Das ist keine Vorsicht, das ist die
// Hausregel, und Alexandra sagt es in ihrer Antwort auch so. Wer das hier
// aufweicht, aendert das Regelwerk und nicht diese Datei.
//
// WAS DIESE DATEI TUT UND WAS NICHT
//   - Sie oeffnet Google Fluege mit einer fertigen Suche und liest die
//     Angebote aus der Seite. Kein Konto, keine Anmeldung, kein Klick auf
//     "Weiter zur Buchung".
//   - Sie stimmt das Reisefenster mit dem Kalender ab (aus dem STAND, ohne
//     zusaetzlichen Google-Aufruf) und sagt, welcher Termin die Wahl bestimmt
//     hat.
//   - Sie gibt die Quelle an. Ein Preis ohne Quelle ist eine Behauptung.
//
// ZEIT IST HIER DER GEGNER, NICHT DIE TECHNIK (gemessen am 20.08.):
// Google Fluege braucht headless allein zum Laden 25 Sekunden — mit
// abgeschalteten Bildern, Schriften und Stylesheets deutlich weniger. Deshalb
// laeuft der Aufruf mit einem harten Budget und liefert lieber ein
// unvollstaendiges Ergebnis als gar keins. Das Gespraech wartet ueber den
// bestehenden Auftrags-Mechanismus (lib/sprache-routes.js): Wird es zu lang,
// sagt Alexandra "das dauert laenger" und meldet sich, wenn es steht.
//
// EINE EINWILLIGUNGSWAND STAND IM WEG. Google zeigt in Europa vor jeder Seite
// den Cookie-Dialog; im ersten Versuch landete der Abruf dort und las den
// Datenschutztext statt der Preise. Die beiden Cookies unten setzen die
// Auswahl vorweg — das ist kein Umgehen einer Sperre, sondern dieselbe
// Entscheidung, die ein Mensch mit einem Klick trifft.

const fs = require("fs");
const path = require("path");
const schnell = require("./schnell.js");
const zustand = require("./zustand.js");

// 32 Sekunden, nicht 40 (nachgemessen 20.08.). Allein gemessen braucht der
// ganze Vorgang 31 s: Wunsch verstehen ~2 s, Chrome starten ~2 s, Google
// Fluege bis zu den Preisen ~20 s, Zumachen ~5 s. Unter Last (vier Suchen
// gleichzeitig im Probelauf) wurden daraus 49,7 s — und der Chat wartet nur
// 45 s, danach hoert Lukas "das dauert laenger" statt eines Preises. Lieber
// ein knapperes Budget und im Zweifel weniger Angebote als eine Antwort, die
// in der Aufnahme nicht mehr ankommt.
const BUDGET_MS = Number(process.env.COMPUTER_BUDGET_MS || 32000);

// Chrome liegt auf dem Entwicklungsrechner an einer von zwei Stellen, im
// Container unter /usr/bin. Gefunden statt geraten — ein falscher Pfad kostet
// sonst erst beim Start eine unverstaendliche Fehlermeldung.
function chromePfad() {
  const kandidaten = [
    process.env.CHROME_PFAD,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ].filter(Boolean);
  return kandidaten.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

// --------------------------------------------------------------- Verstehen
//
// Warum ein Modellaufruf und keine Regeln: "nach Barcelona", "naechste Woche",
// "im September fuer vier Tage", "von Muenchen aus, aber nicht Montag" — ein
// Ausdruck dafuer waere entweder loechrig oder unlesbar. Der Aufruf kostet
// rund eine Sekunde und ist der einzige Teil, der raten muss.
const VERSTEHEN = `Du liest einen Reisewunsch und gibst NUR JSON zurueck, ohne Rahmen:
{"von":"MUC","nach":"BCN","nachOrt":"Barcelona","hin":"JJJJ-MM-TT","zurueck":"JJJJ-MM-TT oder \\"\\"",
 "naechte":3,"kalender":true,"fehlt":""}

- von/nach sind IATA-Codes. Kein Startort genannt -> "MUC" (Lukas sitzt bei Muenchen).
- nachOrt ist der Stadtname zum Vorlesen.
- hin/zurueck nur, wenn ein Datum ableitbar ist. "naechste Woche", "im September"
  reichen dafuer: rechne aus. Voellig offen -> "" und naechte setzen.
- naechte = gewuenschte Aufenthaltsdauer in Naechten. Nicht genannt -> 3.
- kalender = true, wenn er den Kalender einbezogen haben will ("abgestimmt mit
  meinen Terminen") ODER kein Datum genannt hat.
- fehlt = ein deutscher Satz, NUR wenn das ZIEL unklar ist ("such mir einen
  Flug" ohne Stadt). Ein fehlendes DATUM ist nie ein Grund fuer "fehlt" —
  dafuer gibt es kalender und naechte. Sonst "".`;

async function verstehen(auftrag, heute) {
  const roh = await schnell.frage(VERSTEHEN, `HEUTE IST ${heute}.\n\nWUNSCH: ${auftrag}`,
    { maxTokens: 300, temp: 0, timeoutMs: 12000, model: process.env.COMPUTER_MODEL || "claude-haiku-4-5" });
  const t = String(roh || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const m = t.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : t); } catch { return null; }
}

// ------------------------------------------------------- Kalender abstimmen
//
// "Abgestimmt mit meinem Terminkalender" heisst nicht "irgendwann frei",
// sondern: ein zusammenhaengendes Fenster, in dem KEIN Termin steht. Gelesen
// wird aus dem STAND — der ist ohnehin frisch und kostet keinen zusaetzlichen
// Google-Aufruf. Steht dort nichts (Kalender nicht verbunden), sagt die
// Funktion das ehrlich, statt ein freies Fenster zu behaupten.
function fensterSuchen(naechte, abTag) {
  const z = zustand.lesen();
  const termine = Array.isArray(z.kalender) ? z.kalender : null;
  // "STAND" ist ein Wort aus dem Maschinenraum. Was Lukas hoert, muss ohne
  // dieses Wort auskommen (20.08.2026).
  if (!termine) return { ok: false, grund: "deinen Kalender krieg ich gerade nicht auf" };

  const tagVon = (iso) => String(iso || "").slice(0, 10);
  const belegt = new Set(termine.map((t) => tagVon(t.start)).filter(Boolean));

  const plus = (tag, n) => {
    const d = new Date(tag + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // Bis zu acht Wochen vorausschauen. Weiter ist kein Reisefenster mehr,
  // sondern Raten — und Flugpreise so weit draussen sagen ohnehin wenig.
  for (let start = 1; start <= 56; start++) {
    const hin = plus(abTag, start);
    let frei = true;
    for (let i = 0; i <= naechte; i++) if (belegt.has(plus(hin, i))) { frei = false; break; }
    if (frei) {
      // Was hat das Fenster bestimmt? Der letzte Termin davor — genau der Satz,
      // den Lukas hoeren will ("nach dem Kalhofer-Termin am Dienstag").
      const davor = termine
        .map((t) => ({ tag: tagVon(t.start), titel: t.titel || t.summary || "" }))
        .filter((t) => t.tag && t.tag < hin).sort((a, b) => (a.tag < b.tag ? 1 : -1))[0];
      return { ok: true, hin, zurueck: plus(hin, naechte), davor: davor || null,
               belegteTage: belegt.size };
    }
  }
  return { ok: false, grund: `In den nächsten acht Wochen ist kein Fenster von ${naechte + 1} Tagen frei.` };
}

// ------------------------------------------------------------ Google Fluege
//
// Die Auswertung laeuft in der SEITE (page.evaluate). Wichtig fuer den, der das
// prueft: node --check sieht diesen Code NICHT, er steht in einem
// Template-String. Er wird deshalb unten als eigene Funktion definiert und
// uebergeben — so parst ihn wenigstens der eigene Prozess, und
// scripts/test-computer.js kann ihn mit new Function() gegenspiegeln
// (Muster aus scripts/test-leads-zuweisen.js).
function angeboteLesen() {
  // Google Fluege stellt jedes Angebot als <li> dar. Die Klassennamen wechseln
  // — der Preis mit Waehrungszeichen tut es nicht. Deshalb wird ueber den Text
  // gefiltert und nicht ueber eine Klasse, die morgen anders heisst.
  const roh = Array.prototype.slice.call(document.querySelectorAll("li"))
    .map(function (e) { return String(e.innerText || "").replace(/\s*\n\s*/g, " | ").trim(); })
    .filter(function (t) { return /\d[\d.,]*\s*€/.test(t) && t.length > 25 && t.length < 400; });

  // Doppelte raus (Google rendert Listen verschachtelt, dasselbe Angebot kommt
  // sonst dreimal).
  const gesehen = {};
  const eindeutig = [];
  for (let i = 0; i < roh.length; i++) {
    const k = roh[i].slice(0, 60);
    if (gesehen[k]) continue;
    gesehen[k] = 1;
    eindeutig.push(roh[i]);
  }
  return eindeutig.slice(0, 8);
}

const preisAus = (text) => {
  const m = String(text).match(/(\d[\d.]*)\s*€/);
  return m ? Number(m[1].replace(/\./g, "")) : null;
};

// ------------------------------------------------- Aus Rohtext wird Sprache
//
// WARUM DIESER GANZE ABSCHNITT (20.08.2026, nachmittags): Die erste Fassung hat
// die Zeile, die Google Fluege anzeigt, unveraendert in die Antwort gelegt. Am
// laufenden Server kam dabei woertlich heraus:
//
//   "1. 185 € — 12:10, –, 20:20, IberiaDurchgeführt von Air Nostrum for
//    Iberia, 8 Std. 10 Min., MUC–BCN, 1 Stopp, 4 Std. 5 Min. MAD,
//    234 kg CO2e, +119 % (geschätzt), 185 €, Hin und zurück"
//
// Vorgelesen ist das unbrauchbar. Es ist derselbe Fehler wie beim Angebot, das
// einen Tag zuvor komplett vorgelesen wurde: Rohdaten wandern in die
// Sprachantwort. Der Preis stimmt — gehoert hat es trotzdem niemand.
//
// Ab hier gilt die Trennung, die der Beleg schon macht:
//   reply      — die Liste mit Details, fuer den Chat und zum Nachlesen.
//   gesprochen — EIN Satz, wie ein Mensch ihn sagt.
//
// UND DAS OHNE ZWEITEN MODELLAUFRUF. inStimme() koennte das auch, kostet aber
// 3,5 Sekunden — und die Flugsuche liegt schon bei 22 bis 31. Vor allem aber
// stuende dann ein Modell zwischen dem Preis und Lukas' Ohr. Ein umformulierter
// Preis ist ein falscher Preis. Hier wird gerechnet, nicht formuliert.

// Umsteigeflughaefen, die auf einer Muenchner Verbindung vorkommen. Nur zum
// Sprechen — ein unbekanntes Kuerzel fuehrt dazu, dass der Ort weggelassen
// wird ("ein Stopp"), nicht dazu, dass "M A D" buchstabiert wird.
const FLUGHAFEN = {
  MAD: "Madrid", BCN: "Barcelona", FRA: "Frankfurt", MUC: "München", VIE: "Wien",
  ZRH: "Zürich", CDG: "Paris", AMS: "Amsterdam", LIS: "Lissabon", FCO: "Rom",
  LHR: "London", IST: "Istanbul", BRU: "Brüssel", CPH: "Kopenhagen", DUB: "Dublin",
  PMI: "Palma", OPO: "Porto", ATH: "Athen", WAW: "Warschau", HAM: "Hamburg",
  DUS: "Düsseldorf", BER: "Berlin", TXL: "Berlin", STR: "Stuttgart",
};

// "IberiaDurchgeführt von Air Nostrum for Iberia" -> "Iberia"
// "VuelingIberia"                                 -> "Vueling"
// "Lufthansa City AirlinesLufthansa"              -> "Lufthansa City Airlines"
//
// Google klebt den ausfuehrenden Betreiber ohne Leerzeichen an den Namen. Der
// Schnitt laeuft an der Stelle, an der ein Kleinbuchstabe direkt auf einen
// Grossbuchstaben trifft — ein Leerzeichen dazwischen (Air France, Lufthansa
// City Airlines) schuetzt den Namen davor.
function fluglinieSaeubern(roh) {
  let s = String(roh || "").split(/Durchgef(?:ü|ue)hrt von/i)[0].trim();
  s = s.split(/(?<=[a-zäöüß])(?=[A-ZÄÖÜ])/)[0].trim();
  return s.replace(/\s+/g, " ").slice(0, 40);
}

// Eine Dauer, wie man sie sagt: "8 Std. 10 Min." -> "gut acht Stunden".
// Gerundet wird nur die ZEIT, nie ein Preis — und immer mit "gut" oder "knapp"
// davor, damit die Rundung hoerbar bleibt.
// Zahlwoerter statt Ziffern, weil hier zusammengesetzt wird ("zweieinhalb").
// "2einhalb Stunden" waere fuer lib/aussprache.js nicht mehr auseinanderzu-
// nehmen und kaeme als "zwei einhalb" heraus.
const STUNDENWORT = ["null", "eine", "zwei", "drei", "vier", "fünf", "sechs",
  "sieben", "acht", "neun", "zehn", "elf", "zwölf"];
const halbWort = ["", "eineinhalb", "zweieinhalb", "dreieinhalb", "viereinhalb",
  "fünfeinhalb", "sechseinhalb", "siebeneinhalb", "achteinhalb", "neuneinhalb"];

function dauerSprechbar(roh) {
  const m = String(roh || "").match(/(\d+)\s*Std\.?\s*(?:(\d+)\s*Min\.?)?/);
  if (!m) return "";
  const std = Number(m[1]), min = Number(m[2] || 0);
  if (!std) return `${min} Minuten`;
  // Einzahl beachten (Fix 20.08.): Die erste Fassung sagte bei einem Wiener
  // Flug "gut eins Stunden unterwegs".
  const wort = (n) => STUNDENWORT[n] || String(n);
  if (min < 15) return std === 1 ? "gut eine Stunde" : `gut ${wort(std)} Stunden`;
  if (min <= 45) return halbWort[std] ? `${halbWort[std]} Stunden` : `${wort(std)} Stunden`;
  return std + 1 === 1 ? "knapp eine Stunde" : `knapp ${wort(std + 1)} Stunden`;
}

// Ein Datum, wie man es ansagt: "2026-08-22" -> "Samstag, 22. August".
// lib/aussprache.js macht daraus "Samstag, zweiundzwanzigsten August".
function tagSprechbar(iso) {
  const d = new Date(String(iso) + "T12:00:00Z");
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long" });
}

// Der Titel eines Kalendertermins, wie Lukas ihn selbst getippt hat. Am
// laufenden Server hiess einer "Erstgespräch Albion (Seite muss noch gemacht
// werden +Zoom)" — die Klammer ist eine Notiz an sich selbst und hat in einer
// gesprochenen Begruendung nichts verloren.
function terminKurz(titel) {
  return String(titel || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\+\s*\w+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .replace(/[\s,;-]+$/, "");
}

// Eine Angebotszeile in ihre Bestandteile. Bewusst ueber MUSTER und nicht ueber
// Feldnummern: Bei einem Nonstop-Flug fehlt die Umsteigespalte, und ab da waere
// jede feste Position um eins verschoben.
function angebotZerlegen(roh) {
  const teile = String(roh).split("|").map((t) => t.trim()).filter((t) => t && t !== "–" && t !== "-");
  const a = { ab: "", an: "", linie: "", dauer: "", stopps: null, umstieg: "", preis: preisAus(roh) };

  const zeiten = teile.filter((t) => /^\d{1,2}:\d{2}$/.test(t));
  a.ab = zeiten[0] || ""; a.an = zeiten[1] || "";

  for (const t of teile) {
    if (/^\d{1,2}:\d{2}$/.test(t)) continue;
    if (/kg\s*CO2/i.test(t)) continue;                       // Umweltangabe — nicht gefragt
    if (/%\s*\(gesch/i.test(t)) continue;                    // "+119 % (geschätzt)" — Preisvergleich
    if (/^\d[\d.]*\s*€$/.test(t)) continue;                  // der Preis, steht schon in a.preis
    if (/^(Hin und zur(ü|ue)ck|Nur Hinflug|Einfach)$/i.test(t)) continue;
    if (/^[A-Z]{3}\s*[–-]\s*[A-Z]{3}$/.test(t)) continue;    // "MUC–BCN"
    if (/^Nonstop$/i.test(t)) { a.stopps = 0; continue; }
    const st = t.match(/^(\d+)\s*Stopp/i);
    if (st) { a.stopps = Number(st[1]); continue; }
    // "4 Std. 5 Min. MAD" — Umsteigedauer samt Flughafen.
    const um = t.match(/Std\.?.*?\b([A-Z]{3})\s*$/);
    if (um) { a.umstieg = um[1]; continue; }
    if (/^\d+\s*Std\.?/.test(t) && !a.dauer) { a.dauer = t; continue; }
    if (!a.linie && /[A-Za-zÄÖÜäöü]{3}/.test(t)) a.linie = fluglinieSaeubern(t);
  }
  return a;
}

// Die Zeile fuer den Chat: dieselben Angaben, nur ohne den Muell.
function angebotZeile(a) {
  const stueck = [
    `${a.preis} €`,
    a.linie,
    a.ab && a.an ? `${a.ab}–${a.an} Uhr` : "",
    a.dauer,
    a.stopps === 0 ? "nonstop"
      : a.stopps ? `${a.stopps} Stopp${a.stopps > 1 ? "s" : ""}${a.umstieg ? " in " + (FLUGHAFEN[a.umstieg] || a.umstieg) : ""}` : "",
  ].filter(Boolean);
  return stueck.join(" · ");
}

// Der eine Satz, den Lukas hoert.
//
// ECHTE UMLAUTE, IMMER (Fix 20.08.2026). In diesem Projekt werden Kommentare
// und interne Bezeichner bewusst in ASCII geschrieben — "naechste", "fuer",
// "guenstigst". Was in reply oder gesprochen landet, darf das NICHT: Die Stimme
// bekommt den Text so, wie er dasteht, und lib/aussprache.js hat keine
// Wortliste, die "Guenstigster" wieder zu "Günstigster" macht. Live gehoert
// wurde genau das — "Guenstigster Flug", "Google Fluege", "grundsaetzlich".
//
// Faustregel fuer den, der hier etwas aendert: Alles innerhalb eines Strings,
// den ein Mensch zu hoeren bekommt, wird mit ä ö ü ß geschrieben. Der Kommentar
// darueber darf ASCII bleiben. scripts/test-computer.js prueft das nach.
//
// KURZ HALTEN. Agent 2 hat den Rahmen gesetzt: Preis, Fluglinie, nonstop oder
// Stopp, Hin- und Rücktag als Wochentag. Keine Uhrzeit (die liest sich lang und
// niemand merkt sie sich), keine Nummernliste, keine Adresse. Wer die Details
// will, sieht sie im Chat — dafuer gibt es reply.
function wochentag(iso) {
  const d = new Date(String(iso) + "T12:00:00Z");
  return isNaN(d) ? "" : d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "long" });
}

function satzSprechen(a, { ort, hin, zurueck, grund }) {
  const kopf = [`Der günstigste ist ${a.preis} Euro`];
  if (a.linie) kopf.push(`mit ${a.linie}`);
  if (a.stopps === 0) kopf.push("nonstop");
  else if (a.stopps) {
    kopf.push(`${a.stopps === 1 ? "ein" : a.stopps} Stopp${a.stopps > 1 ? "s" : ""}` +
      (a.umstieg && FLUGHAFEN[a.umstieg] ? " in " + FLUGHAFEN[a.umstieg] : ""));
  }
  const d = dauerSprechbar(a.dauer);
  if (d) kopf.push(d);

  const tage = [];
  if (hin) tage.push(`Hin am ${wochentag(hin)}${ort ? " nach " + ort : ""}`);
  if (zurueck) tage.push(`zurück am ${wochentag(zurueck)}`);

  return kopf.join(", ") + "." +
    (tage.length ? ` ${tage.join(", ")}${grund ? " — " + grund : ""}.` : "") +
    " Gebucht hab ich nichts, das machst du selbst.";
}

// ------------------------------------------------------------- Der Auftrag
//
// Rueckgabe wie jeder andere Auftrag: { ok, reply }. reply geht anschliessend
// durch inStimme() und wird in Alexandras Ton gebracht — hier wird deshalb
// sachlich formuliert und nicht schon "gesprochen".
// Die eigentliche Suche im Browser. Diese Funktion ist beim Umlaut-Umbau am
// 20.08. VERSEHENTLICH GELOESCHT worden — zurueck blieb nur ihr Aufruf, und
// die Flugsuche antwortete im Betrieb "Die Flugsuche ist mir gerade
// weggebrochen". Der Testlauf meldete trotzdem "3/3 bestanden", weil er nur
// auf verbotene Wendungen prueft und nicht darauf, ob ein Preis drinsteht.
// Wiederhergestellt aus Commit 382d446.
async function googleFluege({ von, nach, hin, zurueck }, bisMs) {
  const CHROME = chromePfad();
  if (!CHROME) return { ok: false, grund: "Auf diesem Rechner ist kein Chrome installiert." };

  const suche = `Flights from ${von} to ${nach} on ${hin}` + (zurueck ? ` through ${zurueck}` : "");
  const url = "https://www.google.com/travel/flights?hl=de&curr=EUR&gl=DE&q=" + encodeURIComponent(suche);

  const puppeteer = require("puppeteer-core");
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: "new",
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=de-DE",
             "--blink-settings=imagesEnabled=false", "--window-size=1400,1100"],
    });
    // Die Einwilligung vorweg — sonst landet der Abruf auf consent.google.com
    // und liest den Datenschutztext statt der Preise (gemessen 20.08.).
    await browser.setCookie(
      { name: "CONSENT", value: "YES+cb.20220301-11-p0.de+FX+111", domain: ".google.com", path: "/" },
      { name: "SOCS", value: "CAISNQgQEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwMzA3LjA3X3AwGgJkZSACGgYIgOSsrwY", domain: ".google.com", path: "/" },
    );
    const seite = await browser.newPage();
    await seite.setViewport({ width: 1400, height: 1100 });
    await seite.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36");
    // Bilder, Schriften, Videos und Stylesheets abbestellen. Sie machen die
    // Seite huebsch und den Abruf langsam — hier wird nur Text gebraucht.
    await seite.setRequestInterception(true);
    seite.on("request", (r) => {
      const t = r.resourceType();
      if (t === "image" || t === "font" || t === "media" || t === "stylesheet") return r.abort();
      r.continue();
    });

    const rest = () => Math.max(3000, bisMs - Date.now());
    await seite.goto(url, { waitUntil: "domcontentloaded", timeout: rest() });
    // Auf den ersten Preis warten, nicht auf ein festes Zeitfenster: mal ist
    // die Seite in vier Sekunden da, mal in fuenfzehn.
    await seite.waitForFunction(
      "/\\d[\\d.,]*\\s*€/.test(document.body.innerText)",
      { timeout: Math.min(rest(), 25000), polling: 800 },
    ).catch(() => { /* dann eben lesen, was da ist */ });

    const angebote = await seite.evaluate(angeboteLesen);
    return { ok: angebote.length > 0, angebote, url,
             grund: angebote.length ? "" : "Die Seite hat in der Zeit keine Preise gezeigt." };
  } catch (e) {
    return { ok: false, grund: String(e.message).slice(0, 200), url };
  } finally {
    // ZUMACHEN MIT ABLAUFDATUM (20.08.2026). browser.close() bleibt unter
    // Windows haengen: Chrome raeumt sein Profil im Temp-Ordner ab und faellt
    // dabei ueber "EPERM: operation not permitted, unlink … Account Web
    // Data-journal". Gemessen: Der Aufruf kam nach 20 Sekunden mit dem
    // Ergebnis zurueck und der Prozess lief danach zweieinhalb Minuten
    // weiter — im Gespraech waere das ein Auftrag, der nie fertig wird.
    // Nach fuenf Sekunden wird der Prozess deshalb hart beendet.
    if (browser) {
      const hart = () => { try { browser.process()?.kill("SIGKILL"); } catch { /* schon weg */ } };
      await Promise.race([
        browser.close().catch(() => {}),
        new Promise((r) => setTimeout(() => { hart(); r(); }, 5000)),
      ]);
    }
  }
}

// ------------------------------------------------------------- Der Auftrag
//
// Rueckgabe wie jeder andere Auftrag: { ok, reply }. reply geht anschliessend
// durch inStimme() und wird in Alexandras Ton gebracht — hier wird deshalb
// sachlich formuliert und nicht schon "gesprochen".

async function computerAuftrag(auftrag) {
  const bisMs = Date.now() + BUDGET_MS;
  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

  if (!process.env.SCHNELL_API_KEY) {
    return { ok: false, reply: "Für die Suche fehlt mir der Modellzugang." };
  }

  const w = await verstehen(auftrag, heute).catch(() => null);
  if (!w) return { ok: false, reply: "Ich hab den Reisewunsch nicht sauber verstanden — sag mir Ziel und ungefähren Zeitraum." };
  if (w.fehlt) return { ok: true, reply: w.fehlt };

  const naechte = Math.min(Math.max(Number(w.naechte) || 3, 1), 21);
  let hin = w.hin || "", zurueck = w.zurueck || "", kalenderSatz = "", kalenderGrund = "";

  if (w.kalender || !hin) {
    const f = fensterSuchen(naechte, heute);
    if (f.ok) {
      hin = f.hin; zurueck = f.zurueck;
      const titel = f.davor ? terminKurz(f.davor.titel) : "";
      kalenderSatz = titel
        ? ` Ich hab's hinter "${f.davor.titel}" am ${f.davor.tag} gelegt, da ist der Kalender frei.`
        : " Im Kalender ist in dem Fenster nichts eingetragen.";
      // Die gesprochene Begruendung ist kuerzer als die geschriebene: Der
      // Kalendertitel wird geputzt (terminKurz) und der Wochentag genannt statt
      // des Datums — "weil du Freitag das Erstgespraech mit Albion hast" ist ein
      // Satz, den ein Mensch sagt.
      if (titel) {
        const wtag = new Date(f.davor.tag + "T12:00:00Z")
          .toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "long" });
        kalenderGrund = `weil du ${wtag} ${titel} hast`;
      }
    } else if (!hin) {
      // OHNE KALENDER TROTZDEM SUCHEN (20.08.2026). Erste Fassung stieg hier
      // aus: "Ohne Datum komm ich nicht weiter." Auf einem Rechner ohne
      // Kalenderanbindung war das JEDE Antwort — eine Flugsuche, die nie
      // stattfindet, weil ein anderer Dienst haengt. Jetzt wird ein
      // vernuenftiges Fenster angenommen und offen gesagt, dass es angenommen
      // ist. Lukas kann es in einem Satz korrigieren.
      const plus = (n) => {
        const d = new Date(heute + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
      };
      hin = plus(14); zurueck = plus(14 + naechte);
      kalenderSatz = ` Deinen Kalender konnte ich dafür nicht lesen (${f.grund}) — ich hab in zwei Wochen angesetzt. Sag mir andere Tage, dann such ich neu.`;
    } else {
      kalenderSatz = ` Den Kalender konnte ich nicht gegenprüfen: ${f.grund}`;
    }
  }

  const erg = await googleFluege({ von: w.von || "MUC", nach: w.nach, hin, zurueck }, bisMs);

  // DIE ABSAGE IST TEIL DER ANTWORT, NICHT IHR ERSATZ (REGELN.md, SCHWARZ).
  // Sie steht in JEDEM Fall drin — auch wenn die Suche scheitert. Sonst
  // entsteht der Eindruck, sie haette gebucht, wenn es nur geklappt haette.
  const NICHT_GEBUCHT = "Gebucht hab ich nichts — das mach ich grundsätzlich nicht selbst, das letzte Wort hast du.";

  if (!erg.ok) {
    return { ok: false,
      reply: `Die Flugsuche für ${w.nachOrt || w.nach} vom ${hin}${zurueck ? " bis " + zurueck : ""} ist nicht durchgelaufen: ${erg.grund}` +
        (erg.url ? ` Du kannst selbst nachsehen: ${erg.url}` : "") + " " + NICHT_GEBUCHT,
      // Auch das Scheitern bekommt seinen eigenen Sprechsatz — ohne ihn liest
      // der Chat die technische Begruendung samt Adresse vor.
      gesprochen: `Bei der Flugsuche nach ${w.nachOrt || w.nach} bin ich nicht durchgekommen. Sag nochmal, dann probier ich's neu.` };
  }

  // Nach Preis sortieren — "der guenstigste" war die Frage.
  const mitPreis = erg.angebote.map((t) => ({ text: t, preis: preisAus(t) }))
    .filter((a) => a.preis).sort((a, b) => a.preis - b.preis);
  const beste = mitPreis.slice(0, 3);
  if (!beste.length) {
    return { ok: false,
      reply: `Ich hab die Seite offen bekommen, aber keinen Preis herauslesen können. ${NICHT_GEBUCHT} Zum Selbernachsehen: ${erg.url}`,
      gesprochen: `Die Seite war da, Preise standen aber keine drauf. Probier's gleich nochmal.` };
  }

  // Zerlegen, statt die Rohzeile durchzureichen. Ab hier gibt es keine
  // CO2-Angabe, keinen Prozentvergleich und keinen zusammengeklebten
  // Fluglinien-Namen mehr — weder im Chat noch in der Stimme.
  const zerlegt = beste.map((a) => ({ ...angebotZerlegen(a.text), preis: a.preis }));
  const liste = zerlegt.map((a, i) => `${i + 1}. ${angebotZeile(a)}`).join("\n");
  const ort = w.nachOrt || w.nach;

  return {
    ok: true,
    // Fuer den Chat: alle drei mit Details und der Quelle zum Nachprufen.
    reply: `Günstigster Flug ${w.von || "MUC"} nach ${ort}, hin am ${hin}${zurueck ? ", zurück am " + zurueck : ""}: ${beste[0].preis} €.` +
      kalenderSatz + `\n\nDie drei günstigsten:\n${liste}\n\nQuelle: Google Flüge (${erg.url}).\n${NICHT_GEBUCHT}`,
    // Fuer die Stimme: EIN Satz. Wird von auftragStarten/inStimme respektiert —
    // ist gesprochen gesetzt, laeuft kein zweiter Modellaufruf mehr darueber
    // (siehe inStimme in lib/sprache-routes.js).
    gesprochen: satzSprechen(zerlegt[0], { ort, hin, zurueck, grund: kalenderGrund }),
    // Der getippte Chat zeigt beides: den Satz UND die Liste. Ohne diese
    // Markierung bekaeme er nur den Satz — beim Vergleichen von drei Fluegen
    // will man aber alle drei sehen. Siehe /api/chat in lib/sprache-routes.js.
    mitDetails: true,
    quelle: erg.url,
    treffer: beste.length,
  };
}

module.exports = { computerAuftrag, fensterSuchen, angeboteLesen, preisAus, chromePfad,
  // Fuer scripts/test-computer.js: Die Aufbereitung ist der Teil, der ohne
  // Netz pruefbar ist — und der Teil, an dem am 20.08. der rohe Google-Text in
  // die Sprachantwort geraten ist.
  angebotZerlegen, angebotZeile, satzSprechen, fluglinieSaeubern, dauerSprechbar,
  tagSprechbar, terminKurz };
