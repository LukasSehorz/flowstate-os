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
- fehlt = ein deutscher Satz, WENN das Reiseziel unklar ist. Sonst "".`;

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
  if (!termine) return { ok: false, grund: "Kalender steht gerade nicht im Stand." };

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
  return { ok: false, grund: `In den naechsten acht Wochen ist kein Fenster von ${naechte + 1} Tagen frei.` };
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
    return { ok: false, reply: "Fuer die Suche fehlt mir der Modellzugang." };
  }

  const w = await verstehen(auftrag, heute).catch(() => null);
  if (!w) return { ok: false, reply: "Ich hab den Reisewunsch nicht sauber verstanden — sag mir Ziel und ungefaehren Zeitraum." };
  if (w.fehlt) return { ok: true, reply: w.fehlt };

  const naechte = Math.min(Math.max(Number(w.naechte) || 3, 1), 21);
  let hin = w.hin || "", zurueck = w.zurueck || "", kalenderSatz = "";

  if (w.kalender || !hin) {
    const f = fensterSuchen(naechte, heute);
    if (f.ok) {
      hin = f.hin; zurueck = f.zurueck;
      kalenderSatz = f.davor
        ? ` Ich hab's hinter "${f.davor.titel}" am ${f.davor.tag} gelegt, da ist der Kalender frei.`
        : " Im Kalender ist in dem Fenster nichts eingetragen.";
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
      kalenderSatz = ` Deinen Kalender konnte ich dafuer nicht lesen (${f.grund}) — ich hab in zwei Wochen angesetzt. Sag mir andere Tage, dann such ich neu.`;
    } else {
      kalenderSatz = ` Den Kalender konnte ich nicht gegenpruefen: ${f.grund}`;
    }
  }

  const erg = await googleFluege({ von: w.von || "MUC", nach: w.nach, hin, zurueck }, bisMs);

  // DIE ABSAGE IST TEIL DER ANTWORT, NICHT IHR ERSATZ (REGELN.md, SCHWARZ).
  // Sie steht in JEDEM Fall drin — auch wenn die Suche scheitert. Sonst
  // entsteht der Eindruck, sie haette gebucht, wenn es nur geklappt haette.
  const NICHT_GEBUCHT = "Gebucht hab ich nichts — das mach ich grundsaetzlich nicht selbst, das letzte Wort hast du.";

  if (!erg.ok) {
    return { ok: false,
      reply: `Die Flugsuche fuer ${w.nachOrt || w.nach} vom ${hin}${zurueck ? " bis " + zurueck : ""} ist nicht durchgelaufen: ${erg.grund}` +
        (erg.url ? ` Du kannst selbst nachsehen: ${erg.url}` : "") + " " + NICHT_GEBUCHT };
  }

  // Nach Preis sortieren — "der guenstigste" war die Frage.
  const mitPreis = erg.angebote.map((t) => ({ text: t, preis: preisAus(t) }))
    .filter((a) => a.preis).sort((a, b) => a.preis - b.preis);
  const beste = mitPreis.slice(0, 3);
  if (!beste.length) {
    return { ok: false, reply: `Ich hab die Seite offen bekommen, aber keinen Preis herauslesen koennen. ${NICHT_GEBUCHT} Zum Selbernachsehen: ${erg.url}` };
  }

  const liste = beste.map((a, i) => `${i + 1}. ${a.preis} € — ${a.text.replace(/\s*\|\s*/g, ", ").slice(0, 180)}`).join("\n");
  return {
    ok: true,
    reply: `Guenstigster Flug ${w.von || "MUC"} nach ${w.nachOrt || w.nach}, hin am ${hin}${zurueck ? ", zurueck am " + zurueck : ""}: ${beste[0].preis} €.` +
      kalenderSatz + `\n\nDie drei guenstigsten:\n${liste}\n\nQuelle: Google Fluege (${erg.url}).\n${NICHT_GEBUCHT}`,
    quelle: erg.url,
    treffer: beste.length,
  };
}

module.exports = { computerAuftrag, fensterSuchen, angeboteLesen, preisAus, chromePfad };
