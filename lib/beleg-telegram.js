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
//
// NACHGEFRAGT STATT GERATEN (20.08.2026). Bis hierher gab es einen Fall, in dem
// der Ablauf ins Leere lief: Der Leser erkennt den Haendler, aber nicht den
// Betrag — bei einem geknickten Kassenbon der Normalfall. Dann wurde trotzdem
// "Soll ich das so buchen?" gefragt, und auf ein "ja" antwortete die
// Buchhaltung mit "fehler=betrag" (belegBuchen verlangt Betrag UND Datum).
// Lukas hatte dann bestaetigt, nichts war gebucht, und warum, stand nirgends.
//
// Jetzt wird gefragt, was fehlt — erst der Betrag, dann das Datum — und erst
// mit vollstaendigen Werten kommt die Buchungsfrage. Ein falsch erkannter
// Betrag in der Buchhaltung ist schlimmer als eine Rueckfrage; ein
// stillschweigend nicht gebuchter Beleg ist es auch.

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

// ---------------------------------------------------------- Nachgefragtes
//
// Was Lukas auf "was hat's gekostet?" tippt oder diktiert. BEWUSST STRENG:
// Findet sich keine Zahl, ist es keine Antwort auf die Rueckfrage, sondern eine
// neue Nachricht an Alexandra. Lieber einmal nicht erkennen als aus "sag mal,
// wie war das mit den 3 Terminen" einen Belegbetrag machen.
function betragAus(text) {
  const t = String(text || "").replace(/\s*€|\s*eur\b|\s*euro\b/gi, "");
  // Deutsch: Punkt trennt Tausender, Komma die Cent. "1.234,56" -> 1234.56
  // Englisch/Tastatur: "19.90" ohne Tausendergruppe sind 19,90 Euro.
  const m = t.match(/(?<!\d)(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?(?!\d)/);
  if (!m) return null;
  const ganz = Number(m[1].replace(/\./g, ""));
  const cent = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  const n = ganz + cent / 100;
  // Dieselben Grenzen wie im Belegleser: 0 Euro ist eine gueltige Zahl und
  // trotzdem kein Betrag.
  if (!Number.isFinite(n) || n <= 0 || n > 1000000) return null;
  return Math.round(n * 100) / 100;
}

const alsTag = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Ein Datum aus der Antwort. "heute" und "gestern" sind erlaubt, weil man den
// Bon meist am selben oder am naechsten Tag fotografiert — beides sagt Lukas
// dann AUSDRUECKLICH. Von selbst auf heute zu raten waere etwas anderes: Das
// haette den Beleg mit einem erfundenen Datum in den falschen Monat gebucht.
function datumAus(text, jetzt = new Date()) {
  const t = String(text || "").toLowerCase();
  if (/\bheute\b/.test(t)) return alsTag(jetzt);
  if (/\bgestern\b/.test(t)) return alsTag(new Date(jetzt.getTime() - 86400000));
  if (/\bvorgestern\b/.test(t)) return alsTag(new Date(jetzt.getTime() - 2 * 86400000));

  const iso = t.match(/(?<!\d)(20\d{2})-(\d{1,2})-(\d{1,2})(?!\d)/);
  const de = t.match(/(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})?(?!\d)/);
  let jahr, monat, tag;
  if (iso) { [, jahr, monat, tag] = iso; }
  else if (de) {
    tag = de[1]; monat = de[2];
    // Ohne Jahresangabe das laufende — und wenn das in der Zukunft laege, das
    // davor. Einen Bon vom 28.12., im Januar hochgeladen, sonst ins neue Jahr
    // zu buchen waere der teuerste stille Fehler hier: falsches Steuerjahr.
    jahr = de[3] ? (de[3].length === 2 ? "20" + de[3] : de[3]) : String(jetzt.getFullYear());
  } else return null;

  const d = new Date(`${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  if (!de?.[3] && !iso && d.getTime() > jetzt.getTime() + 36 * 3600 * 1000) {
    d.setUTCFullYear(d.getUTCFullYear() - 1);
  }
  const jahrZahl = d.getUTCFullYear();
  // Dieselbe Plausibilitaet wie im Belegleser: vor 2015 oder in der Zukunft ist
  // kein Beleg von uns, sondern ein Vertipper.
  if (jahrZahl < 2015 || d.getTime() > jetzt.getTime() + 36 * 3600 * 1000) return null;
  return d.toISOString().slice(0, 10);
}

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

  offen = { id: ab.id, laufnummer: ab.laufnummer, werte, frage: null };
  return naechsteFrage(sagen);
}

// Was als Naechstes gefragt wird: der fehlende Betrag, das fehlende Datum,
// sonst die Buchungsfrage. Eine Stelle fuer alle drei Wege — die Rueckfrage
// nach dem Betrag muendet danach in dieselbe Bestaetigung wie ein Beleg, bei
// dem gleich alles zu lesen war.
function naechsteFrage(sagen) {
  const b = offen;
  if (!b) return;
  const w = b.werte;
  const wer = w.gegenstelle ? ` von ${w.gegenstelle}` : "";

  if (!w.betrag) {
    b.frage = "betrag";
    return sagen(`Beleg ${b.laufnummer}${wer} liegt im Eingang. Den Betrag konnte ich nicht lesen — was hat's gekostet?`);
  }
  if (!w.datum) {
    b.frage = "datum";
    return sagen(`${euro(w.betrag)}${wer} — welches Datum steht auf dem Beleg? Sag „heute“, wenn er von heute ist.`);
  }

  b.frage = "buchen";
  const zeilen = [
    `Beleg ${b.laufnummer}:`,
    w.gegenstelle ? `${w.gegenstelle}` : null,
    `${euro(w.betrag)}`,
    `vom ${datumLang(w.datum)}`,
    w.kategorie ? `Kategorie ${w.kategorie}` : null,
  ].filter(Boolean);

  return sagen(zeilen.join(" · ") + "\n\nSoll ich das so buchen?");
}

// Antwort auf die Rueckfrage. Gibt true zurueck, wenn sie hier behandelt wurde —
// dann laeuft sie NICHT zusaetzlich als Frage an Alexandra.
async function antwortAuf(text, { dash, sagen }) {
  if (!offen) return false;
  const t = String(text || "").trim().toLowerCase();

  const nein = /^(nein|ne|nee|nicht|stopp|stop|lass|abbrechen|verwerfen|falsch|weiss nicht|weiß nicht)\b/.test(t);

  // Auf eine Rueckfrage nach Betrag oder Datum ist die Antwort eine ZAHL, kein
  // Ja. Sie wird uebernommen und der Ablauf geht einen Schritt weiter; gebucht
  // wird auch dann erst nach der Bestaetigung am Ende.
  //
  // Findet sich nichts Verwertbares, gibt diese Funktion false zurueck und der
  // Satz laeuft normal an Alexandra. Das ist Absicht: Wer mitten in der
  // Rueckfrage etwas ganz anderes fragt, soll eine Antwort bekommen und nicht
  // "ich brauch den Betrag".
  if (offen.frage === "betrag" || offen.frage === "datum") {
    const b0 = offen;
    if (nein) {
      offen = null;
      await sagen(`Alles klar, Beleg ${b0.laufnummer} bleibt im Eingang — trag ihn im Dashboard fertig aus.`);
      return true;
    }
    if (b0.frage === "betrag") {
      const betrag = betragAus(text);
      if (betrag === null) return false;
      b0.werte.betrag = betrag;
    } else {
      const datum = datumAus(text);
      if (datum === null) return false;
      b0.werte.datum = datum;
    }
    await naechsteFrage(sagen);
    return true;
  }

  // Nur eindeutige Antworten fangen. Bei allem anderen war es keine Antwort auf
  // die Rueckfrage, sondern eine neue Frage — die gehoert zu Alexandra.
  const ja = /^(ja|jap|passt|passt so|buchen|buch das|stimmt|korrekt|genau|ok|okay|jo)\b/.test(t);
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
      // Den Grund NENNEN. Vorher stand hier nur "hat nicht geklappt", und der
      // haeufigste Grund (Betrag oder Datum fehlt) war damit unsichtbar —
      // dabei ist genau er in einer Nachricht zu beheben.
      const grund = decodeURIComponent((ziel.match(/fehler=([^&]*)/) || [])[1] || "");
      const klartext = { betrag: "der Betrag fehlt", datum: "das Datum fehlt",
        "schon-gebucht": "der ist schon gebucht", verworfen: "der wurde verworfen",
        "nicht-gefunden": "ich finde ihn nicht mehr" }[grund];
      // BEWUSST await statt "return sagen(...) || true": sagen() gibt ein
      // Promise zurueck, und das await im Aufrufer haette daraus undefined
      // gemacht — die Nachricht waere zusaetzlich als Frage an Alexandra
      // gelaufen.
      await sagen(`Das Buchen hat nicht geklappt${klartext ? ` — ${klartext}` : ""}. Beleg ${b.laufnummer} liegt weiter im Eingang.`);
      return true;
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

// Nur zum Nachsehen (Test, Protokoll) — nicht zum Verstellen.
const wasOffen = () => (offen ? { laufnummer: offen.laufnummer, frage: offen.frage } : null);

module.exports = { dateiAus, koennteBelegSein, verarbeiten, antwortAuf, vergessen,
  wasOffen, betragAus, datumAus };
