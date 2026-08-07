// Rechnung per Telegram schicken — auslesen, ablegen, buchen.
//
// Warum (Lukas, 07.08.2026): "Ein Agent, der zum Beispiel automatisch, wenn ich
// auf Telegram eine Rechnung schicke, das auswertet, ablegt und das System
// abbucht."
//
// KEIN AGENT — eine bekannte Abfolge. Datei holen, ablegen, auslesen,
// bestaetigen, buchen. Fuenf Schritte, immer dieselben, jeder kann einzeln
// scheitern und einzeln wiederholt werden. Ein Agent wuerde hier nur Sekunden
// und Ausfallwahrscheinlichkeit hinzufuegen (gemessen an Hermes: 43 % Fehler,
// Median 142 s) — ohne dass er etwas koennte, was diese fuenf Aufrufe nicht tun.
//
// DIE STUECKE GAB ES SCHON, sie waren nur nie verbunden:
//   lib/belegleser.js       liest Betrag, Datum, Lieferant, Kategorie
//   /buchhaltung/beleg/*    legt ab, liest aus, bucht
//   lib/telegram.js         empfaengt — warf Fotos und PDFs aber weg
//     ("if (!text.trim()) return" — eine Rechnung ohne Bildunterschrift
//      landete im Nichts)
//
// Angesprochen werden die HTTP-Endpunkte, nicht die Bibliothek direkt: Die
// Buchhaltung arbeitet mit Zeilenrechten (alsNutzer), und Telegram hat ueber
// dash() ohnehin schon eine angemeldete Sitzung. Der direkte Bibliotheksweg
// haette einen zweiten, rechtefreien Zugang geschaffen — genau das, was man in
// einer Buchhaltung nicht will.
//
// GEBUCHT WIRD NICHT VON SELBST. Lukas bekommt die gelesenen Werte und
// antwortet "passt" oder korrigiert. Grund steht in belegleser.js: Das Auslesen
// macht einen VORSCHLAG. Ein falsch erkannter Betrag, still gebucht, faellt
// erst beim Steuerberater auf.

const MAX = 20 * 1024 * 1024;   // Telegram gibt Dateien bis 20 MB heraus

// Was gerade auf eine Bestaetigung wartet. Bewusst nur im Arbeitsspeicher:
// Nach einem Neustart ist der Beleg trotzdem abgelegt und im Eingang sichtbar —
// verloren geht nichts, nur die Rueckfrage. Eine Tabelle dafuer waere Aufwand
// fuer einen Zustand, der Sekunden lebt.
let offen = null;

const euro = (n) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " Euro";
const datumLang = (d) => {
  if (!d) return "";
  const t = new Date(d);
  return isNaN(t) ? String(d) : t.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
};

// Aus einer Telegram-Nachricht die Datei herausziehen — Foto ODER Dokument.
//
// Fotos kommen als Liste in mehreren Aufloesungen; die letzte ist die groesste.
// Wer die erste nimmt, bekommt eine Vorschau von 90 Pixeln, auf der kein Betrag
// zu lesen ist.
function dateiAus(msg) {
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const gross = msg.photo[msg.photo.length - 1];
    return { fileId: gross.file_id, name: "Foto.jpg", typ: "image/jpeg", groesse: gross.file_size || 0 };
  }
  const d = msg.document;
  if (d) {
    return { fileId: d.file_id, name: d.file_name || "Beleg", typ: d.mime_type || null, groesse: d.file_size || 0 };
  }
  return null;
}

// Sieht das nach einem Beleg aus? Telegram bekommt auch Screenshots und Memes.
//
// Bewusst grosszuegig: Lieber einmal zu viel gefragt ("das sieht nicht nach
// einem Beleg aus") als eine echte Rechnung stillschweigend zu verwerfen.
// Ausgeschlossen wird nur, was sicher keiner ist.
const KEIN_BELEG = /\.(zip|exe|dmg|apk|mp4|mov|mp3|ogg|wav|pptx?|xlsx?)$/i;

function koennteBelegSein(datei) {
  if (!datei) return false;
  if (KEIN_BELEG.test(datei.name)) return false;
  const typ = String(datei.typ || "");
  return typ.startsWith("image/") || typ === "application/pdf" || /\.pdf$/i.test(datei.name);
}

// Der Ablauf. dash() und holeDatei() kommen aus telegram.js — dieses Modul
// kennt Telegram nicht selbst, damit es einzeln testbar bleibt.
async function verarbeiten({ datei, holeDatei, dash, sagen }) {
  if (datei.groesse > MAX) {
    return sagen(`Die Datei ist mit ${Math.round(datei.groesse / 1024 / 1024)} MB zu groß — Telegram gibt mir höchstens 20 MB. Schick sie mir als Foto oder kleineres PDF.`);
  }

  await sagen("Schau ich mir an…");

  let daten;
  try { daten = await holeDatei(datei.fileId); }
  catch (e) { return sagen("Die Datei kam nicht durch — schick sie nochmal."); }

  // 1. Ablegen. Ab hier ist der Beleg sicher, auch wenn das Lesen scheitert.
  let ab;
  try {
    const r = await dash("/buchhaltung/beleg/hochladen", daten, {
      "X-Art": "ausgabe",
      "X-Dateiname": encodeURIComponent(datei.name),
      "X-Dateityp": datei.typ || "application/octet-stream",
    });
    ab = await r.json();
  } catch (e) {
    return sagen("Das Ablegen hat gehakt — versuch's gleich nochmal.");
  }
  if (!ab?.ok) return sagen("Konnte den Beleg nicht ablegen" + (ab?.grund ? ` (${ab.grund})` : "") + ".");
  if (ab.doppelt) {
    return sagen(`Den hab ich schon — Beleg Nummer ${ab.laufnummer} liegt bereits im Eingang.`);
  }

  // 2. Auslesen. Schlaegt es fehl, liegt der Beleg trotzdem im Eingang; Lukas
  // traegt die Werte dann im Dashboard nach.
  let werte = null;
  try {
    const r = await dash("/buchhaltung/beleg/lesen", { id: ab.id });
    const d = await r.json();
    if (d?.ok) werte = d.werte || d;
  } catch { /* Vorschlag entfaellt, Beleg bleibt */ }

  if (!werte || (!werte.betrag && !werte.gegenstelle)) {
    offen = null;
    return sagen(`Beleg ${ab.laufnummer} liegt im Eingang — auslesen hat nicht geklappt. Trag die Werte im Dashboard nach, dann ist er gebucht.`);
  }

  offen = { id: ab.id, laufnummer: ab.laufnummer, werte };

  const zeilen = [
    `Beleg ${ab.laufnummer}:`,
    werte.gegenstelle ? `${werte.gegenstelle}` : null,
    werte.betrag ? `${euro(werte.betrag)}` : null,
    werte.datum ? `vom ${datumLang(werte.datum)}` : null,
    werte.kategorie ? `Kategorie ${werte.kategorie}` : null,
  ].filter(Boolean);

  return sagen(zeilen.join(" · ") + "\n\nSoll ich das so buchen?");
}

// Antwort auf die Rueckfrage. Gibt true zurueck, wenn sie hier behandelt wurde —
// dann laeuft sie NICHT zusaetzlich als Frage an Alexandra.
async function antwortAuf(text, { dash, sagen }) {
  if (!offen) return false;
  const t = String(text || "").trim().toLowerCase();

  // Nur eindeutige Antworten fangen. Bei allem anderen war es keine Antwort auf
  // die Rueckfrage, sondern eine neue Frage — die gehoert zu Alexandra.
  const ja = /^(ja|jap|passt|passt so|buchen|buch das|stimmt|korrekt|genau|ok|okay|jo)\b/.test(t);
  const nein = /^(nein|ne|nee|nicht|stopp|stop|lass|abbrechen|verwerfen|falsch)\b/.test(t);
  if (!ja && !nein) return false;

  const b = offen;
  offen = null;

  if (nein) {
    await sagen(`Alles klar, Beleg ${b.laufnummer} bleibt im Eingang — du kannst ihn im Dashboard prüfen oder verwerfen.`);
    return true;
  }

  try {
    // Der Endpunkt leitet nach dem Buchen auf die Seite um (er ist fuer das
    // Formular gebaut). Eine Weiterleitung IST hier der Erfolg — deshalb wird
    // sie nicht verfolgt, sondern als Ergebnis gelesen.
    const r = await dash("/buchhaltung/beleg/buchen", { id: b.id, ...b.werte });
    const gelungen = r.status === 302 || r.status === 200;
    const ziel = r.headers.get("location") || "";
    if (!gelungen || /fehler=/.test(ziel)) {
      return sagen(`Das Buchen hat nicht geklappt — Beleg ${b.laufnummer} liegt weiter im Eingang.`) || true;
    }
    await sagen(/offen=/.test(ziel)
      ? `Gebucht — steht jetzt unter offenen Rechnungen.`
      : `Gebucht. ${b.werte.betrag ? euro(b.werte.betrag) + " " : ""}ist raus aus dem Eingang.`);
  } catch {
    await sagen(`Das Buchen hat gehakt — Beleg ${b.laufnummer} liegt weiter im Eingang.`);
  }
  return true;
}

// Fuer den Fall, dass eine neue Datei kommt, waehrend noch eine Rueckfrage
// offen ist: Die alte verfaellt, sonst bucht ein spaeteres "ja" den falschen.
function vergessen() { offen = null; }

module.exports = { dateiAus, koennteBelegSein, verarbeiten, antwortAuf, vergessen };
