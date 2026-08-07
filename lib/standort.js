// Wo ist Lukas gerade?
//
// Warum es das gibt (Lukas, 07.08.2026): "Kannst du mir sagen, wie warm es
// morgen wird, da wo ich gerade bin?" — Alexandra musste zurueckfragen, weil
// im System nur ein fester Standardort (Dorfen) hinterlegt war. Er war in
// Nizza. Drei Rueckfragen spaeter kam die Antwort, und die Spracherkennung
// hatte "in Nizza" zweimal als "'n Nutzer" verstanden.
//
// Der Browser weiss es. Er darf es nur nicht ungefragt sagen — die Position
// gibt er erst heraus, wenn Lukas es einmal ausdruecklich erlaubt.
//
// WAS HIER NICHT PASSIERT: Es wird keine Spur aufgezeichnet. Gespeichert ist
// immer nur der ZULETZT gemeldete Ort, im Arbeitsspeicher und in EINER Datei,
// die beim naechsten Mal ueberschrieben wird. Es gibt keine Historie, aus der
// sich ein Bewegungsprofil bauen liesse — das waere etwas anderes als "weiss,
// wo ich gerade bin", und danach hat niemand gefragt.
//
// Genauigkeit bewusst grob: Fuer "wie warm wird es hier" reicht die Stadt.
// Die Koordinaten werden auf drei Nachkommastellen gerundet (~100 m), bevor
// irgendetwas davon gespeichert oder verschickt wird.

const fs = require("fs");
const path = require("path");

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, "..", "data");
const DATEI = path.join(DATA_PATH, "standort.json");

// Aelter als das? Dann ist "wo ich gerade bin" nicht mehr belegt. Lieber der
// Standardort mit klarer Herkunft als eine Stadt von gestern.
const HALTBAR_MIN = Number(process.env.STANDORT_HALTBAR_MIN || 180);

let jetzt = null;
try { jetzt = JSON.parse(fs.readFileSync(DATEI, "utf-8")); } catch { /* noch keiner */ }

const rund = (n) => Math.round(Number(n) * 1000) / 1000;

// Aus Koordinaten einen Ortsnamen machen. Ohne Schluessel und ohne Konto:
// BigDataCloud beantwortet genau diese eine Frage frei. Faellt der Dienst aus,
// bleibt es bei den Koordinaten — das Wetter braucht ohnehin nur die, der Name
// ist fuers Vorlesen.
async function ortsName(lat, lon) {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=de`,
      { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.city || d.locality || d.principalSubdivision || null;
  } catch { return null; }
}

// Der Browser meldet eine Position. Gibt den erkannten Ort zurueck.
async function melden(lat, lon) {
  const la = rund(lat), lo = rund(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;

  // Ist es derselbe Ort wie zuletzt, sparen wir den Namensabruf — das passiert
  // bei jedem Seitenaufruf, und der Ort aendert sich selten zwischen zweien.
  const gleich = jetzt && Math.abs(jetzt.lat - la) < 0.02 && Math.abs(jetzt.lon - lo) < 0.02;
  const name = gleich ? jetzt.name : await ortsName(la, lo);

  jetzt = { lat: la, lon: lo, name: name || null, zeit: Date.now() };
  try {
    fs.mkdirSync(DATA_PATH, { recursive: true });
    fs.writeFileSync(DATEI, JSON.stringify(jetzt));
  } catch { /* fluechtig ist besser als gar nicht */ }
  return jetzt;
}

// Der aktuelle Ort — oder null, wenn keiner gemeldet oder zu alt.
function aktuell() {
  if (!jetzt) return null;
  if ((Date.now() - jetzt.zeit) / 60000 > HALTBAR_MIN) return null;
  return jetzt;
}

// Eine Zeile fuer den STAND. Nur wenn wirklich etwas bekannt ist — eine Zeile
// "Standort: unbekannt" wuerde nur Platz kosten und das Modell zu Ausreden
// einladen.
function fuerStand() {
  const o = aktuell();
  if (!o) return null;
  const alter = Math.round((Date.now() - o.zeit) / 60000);
  const wo = o.name || `${o.lat}, ${o.lon}`;
  return `LUKAS IST GERADE IN: ${wo}` +
    (alter > 20 ? ` (Stand vor ${alter} Min.)` : "") +
    ` — bei "hier", "wo ich bin" o. ae. gilt dieser Ort, NICHT nachfragen.`;
}

module.exports = { melden, aktuell, fuerStand, DATEI };
