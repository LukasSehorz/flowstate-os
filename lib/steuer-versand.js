// Den Monatsordner an die Steuerberaterin schicken — auf Zuruf, mit Freigabe.
//
// WARUM ES DAS GIBT (Lukas, 20.08.2026, Szene 3c im Anzeigen-Drehbuch):
// "Schick den kompletten Ordner mit den Rechnungen an unsere Steuerberaterin."
// Live geantwortet hat Alexandra darauf sinngemaess "Den Ordner kann ich nicht
// anfassen — Dateien verschicken geht bei mir nicht". Das stimmte nie: Der
// Monatsordner existiert seit dem 28.07. fertig gepackt (buchhaltung.js,
// monatsExport) und wird im Dashboard mit einem Klick heruntergeladen. Es
// fehlte nur der Weg von der Sprache dorthin.
//
// Dieses Modul baut GENAU diesen Weg und sonst nichts:
//   1. Zeitraum aus dem gesprochenen Satz verstehen ("vom Juli", "letzten
//      Monat", "das Quartal") — und wenn nichts gesagt wurde, den letzten
//      abgeschlossenen Monat nehmen UND ihn aussprechen, damit Lukas
//      widersprechen kann.
//   2. Das ZIP holen: buch.monatsExport(). Hier wird KEIN zweiter Packer
//      gebaut — zwei Ordner mit unterschiedlichem Inhalt waeren genau die
//      zweite Wahrheit, die das Archiv vermeiden soll.
//   3. Die Mail texten und VORLEGEN.
//   4. Erst nach einem gesprochenen Ja wirklich senden.
//
// SCHRITT 4 IST DIE GANZE POINTE. REGELN.md fuehrt jeden Mailversand nach
// aussen unter ROT ("fragt immer vorher"), und die Steuerberaterin ist aussen.
// Deshalb ist die Freigabe hier gebaut wie die fuer Rechnungen in
// beleg-erstellen.js: EIN offener Vorgang, eine Frist, und antwortAuf() faengt
// das "ja" ab, BEVOR das Sprachmodell den Satz zu sehen bekommt. Ein Modell,
// das den Zusammenhang beim naechsten Mal anders deutet, darf ueber das
// Rausschicken der Buchhaltung nicht entscheiden.
//
// BEWUSST NUR EINE RUECKFRAGE (nicht zwei wie bei der Rechnung): Der Auftrag
// "schick den Ordner an die Steuerberaterin" sagt das Senden schon. Ein
// vorgeschaltetes "Soll ich eine Mail aufsetzen?" waere eine Frage nach etwas,
// das gerade befohlen wurde. Vorgelegt wird trotzdem: Empfaenger, Zeitraum,
// Anzahl und Summe kommen vor dem Ja zur Sprache.

const buch = require("./buchhaltung.js");
const gmail = require("./gmail-direkt.js");
const kontakte = require("./kontakte.js");
const probemodus = require("./probemodus.js");
const sprachlog = require("./sprachlog.js");
const aussprache = require("./aussprache.js");
const belegErstellen = require("./beleg-erstellen.js");

const ABSENDER = process.env.MAIL_ABSENDER || "Lukas Sehorz <lukas.sehorz@flowstate-ai.net>";

// Wie lange die Rueckfrage gilt. Dieselben 20 Minuten wie bei der Rechnung —
// ein "ja" eine Stunde spaeter meint mit ziemlicher Sicherheit etwas anderes.
const GILT_MS = 20 * 60 * 1000;

// Obergrenze fuer die Anhaenge zusammen. Gmail nimmt rund 25 MB, und die
// base64-Kodierung blaeht die Datei um ein Drittel auf — 17 MB roh sind also
// schon knapp 23 MB im Umschlag. Was darueber liegt, wird NICHT gesendet und
// auch nicht stillschweigend halbiert: Eine Mail, die beim Anbieter haengen
// bleibt, sieht fuer Lukas aus wie eine gesendete.
const MAX_ANHANG = Number(process.env.STEUER_MAX_ANHANG || 17 * 1024 * 1024);

// Hoechstens ein Jahr am Stueck. "Schick alles" ueber vier Jahre waeren
// achtundvierzig ZIPs — dafuer gibt es das Dashboard, nicht die Mail.
const MAX_MONATE = 12;

const MONATSNAME = buch.MONATSNAME;

// Was gerade zur Freigabe aussteht. Bewusst nur EINS, wie in
// beleg-erstellen.js: Zwei offene Rueckfragen gleichzeitig, und ein blosses
// "ja" ist nicht mehr zuordenbar.
let offen = null;

function frisch() {
  if (offen && Date.now() - offen.seit > GILT_MS) offen = null;
  return offen;
}

const wasOffen = () => (frisch()
  ? { schritt: offen.schritt, zeitraum: offen.zeitraum?.titel || null, an: offen.an || null }
  : null);

function vergessen() { offen = null; }

const euro = (n) => Number(n || 0).toLocaleString("de-DE",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

// Betrag fuers Ohr: "2400" -> "zweitausendvierhundert Euro". Die Cent fallen
// weg — im Gespraech zaehlt die Groessenordnung, und "zweitausendvierhundert
// Euro null null" hoert sich an wie ein Kontoauszug.
function euroGesprochen(n) {
  const gerundet = Math.round(Number(n) || 0);
  return `${aussprache.zahlWort(gerundet, "ein")} Euro`;
}

// -------------------------------------------------------------- Zeitraum
//
// Was verstanden werden muss, steht so im Drehbuch: "die Rechnungen vom Juli",
// "letzten Monat", "das Quartal". Dazu das, was im Auto sonst noch faellt —
// "den Juli", "im Juni", "das zweite Quartal", "letztes Jahr".
//
// BEWUSST OHNE SPRACHMODELL. Ein Monat ist ein geschlossener Wertebereich, und
// ein Modell, das gelegentlich Juni statt Juli versteht, verschickt die falsche
// Buchhaltung. Regeln raten hier nicht, sie treffen oder sie treffen nicht.

const MONATSWORTE = {
  januar: 1, jaenner: 1, jänner: 1, februar: 2, maerz: 3, märz: 3, april: 4,
  mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10,
  november: 11, dezember: 12,
};

const ORDNUNG = { erste: 1, zweite: 2, dritte: 3, vierte: 4, "1": 1, "2": 2, "3": 3, "4": 4 };

// Ein Monat als {jahr, monat}, n Monate vor dem Stichmonat.
function minusMonate(jahr, monat, n) {
  const i = jahr * 12 + (monat - 1) - n;
  return { jahr: Math.floor(i / 12), monat: (i % 12) + 1 };
}

function spanne(vonJahr, vonMonat, anzahl) {
  const raus = [];
  for (let i = 0; i < anzahl; i++) {
    const m = minusMonate(vonJahr, vonMonat, -i);
    raus.push(m);
  }
  return raus;
}

// Zukunft abschneiden: Fuer den September 2026 gibt es am 20.08. nichts zu
// packen, und ein leerer Ordner ist eine Fehlermeldung mit Umweg.
function ohneZukunft(monate, jetzt) {
  const grenze = jetzt.getFullYear() * 12 + jetzt.getMonth();
  return monate.filter((m) => m.jahr * 12 + (m.monat - 1) <= grenze);
}

// titel = fuer Betreff und Chat, immer mit Jahr. kopf = fuer den Sprechtext.
//
// Das Jahr wird nur AUSGESPROCHEN, wenn es nicht das laufende ist: "Die
// Juli-Rechnungen" ist ein Satz, "Die Juli-Rechnungen von 2026" ein Formular.
// Beim September 2025 dagegen ist die Jahreszahl die halbe Information.
function benennen(monate, jetzt) {
  if (!monate.length) return { titel: "", kopf: "" };
  const a = monate[0], b = monate[monate.length - 1];
  const anders = a.jahr !== jetzt.getFullYear() || b.jahr !== jetzt.getFullYear();

  if (monate.length === 1) {
    const name = MONATSNAME[a.monat - 1];
    return {
      titel: `${name} ${a.jahr}`,
      // "Die Juli-Rechnungen" — so sagt man es, und so steht es im Drehbuch.
      kopf: `Die ${name}-Rechnungen${anders ? ` von ${a.jahr}` : ""}`,
    };
  }

  // Ein ganzes Jahr am Stueck heisst auch so.
  if (monate.length === 12 && a.jahr === b.jahr) {
    return { titel: `Jahr ${a.jahr}`, kopf: `Die Rechnungen aus ${a.jahr}` };
  }

  const von = MONATSNAME[a.monat - 1], bis = MONATSNAME[b.monat - 1];
  const titel = a.jahr === b.jahr
    ? `${von} bis ${bis} ${a.jahr}`
    : `${von} ${a.jahr} bis ${bis} ${b.jahr}`;
  const kopf = a.jahr === b.jahr
    ? `Die Rechnungen von ${von} bis ${bis}${anders ? ` ${a.jahr}` : ""}`
    : `Die Rechnungen von ${von} ${a.jahr} bis ${bis} ${b.jahr}`;
  return { titel, kopf };
}

// text: der gesprochene Satz. Gibt {monate, titel, kopf, geraten} zurueck.
// geraten = im Satz stand kein Zeitraum; dann MUSS die Antwort ihn aussprechen.
function zeitraumVerstehen(text, jetzt = new Date()) {
  const t = String(text || "").toLowerCase();
  const jahrJetzt = jetzt.getFullYear(), monatJetzt = jetzt.getMonth() + 1;
  const letzter = minusMonate(jahrJetzt, monatJetzt, 1);
  const jahrImSatz = (t.match(/\b(20\d{2})\b/) || [])[1];

  const fertig = (monate, geraten = false) => {
    const m = ohneZukunft(monate, jetzt).slice(-MAX_MONATE);
    if (!m.length) return null;
    return { monate: m, ...benennen(m, jetzt), geraten };
  };

  // 1. Ein Monatsname im Satz gewinnt immer — er ist die genaueste Angabe.
  const monatTreffer = t.match(
    /\b(januar|j[aä]nner|februar|m[aä]rz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/);
  if (monatTreffer) {
    const m = MONATSWORTE[monatTreffer[1]];
    // Ohne Jahresangabe das zuletzt VERGANGENE Vorkommen: Am 20.08. meint
    // "September" den vom letzten Jahr, nicht den in zwei Wochen. Wer den
    // laufenden Monat meint, sagt seinen Namen — der ist nicht in der Zukunft.
    const jahr = jahrImSatz ? Number(jahrImSatz) : (m <= monatJetzt ? jahrJetzt : jahrJetzt - 1);
    return fertig([{ jahr, monat: m }]);
  }

  // 2. Quartal. "das Quartal" ohne weitere Angabe = das letzte ABGESCHLOSSENE:
  // Wer im August die Buchhaltung wegschickt, meint April bis Juni, nicht die
  // angefangenen zwei Monate seit Juli.
  if (/\bquartal|\bq[1-4]\b/.test(t)) {
    const nummer = (t.match(/\bq([1-4])\b/) || [])[1]
      || ORDNUNG[(t.match(/\b(erste|zweite|dritte|vierte)/) || [])[1]]
      || null;
    if (nummer) {
      const q = Number(nummer);
      const jahr = jahrImSatz ? Number(jahrImSatz)
        : (q * 3 <= monatJetzt ? jahrJetzt : jahrJetzt - 1);
      return fertig(spanne(jahr, q * 3 - 2, 3));
    }
    if (/\b(diese|laufend|aktuell)/.test(t)) {
      const start = Math.floor((monatJetzt - 1) / 3) * 3 + 1;
      return fertig(spanne(jahrJetzt, start, 3));
    }
    const letztesQ = Math.floor((monatJetzt - 1) / 3) - 1;   // 0-basiert, eins zurueck
    const jahr = letztesQ < 0 ? jahrJetzt - 1 : jahrJetzt;
    const q = letztesQ < 0 ? 3 : letztesQ;
    return fertig(spanne(jahr, q * 3 + 1, 3));
  }

  // 3. "die letzten drei Monate" / "die letzten 6 Monate"
  const mehrere = t.match(/\b(?:letzte|vergangene|vorige)[mnrs]?\s+(\d{1,2}|zwei|drei|vier|sechs|zw[oö]lf)\s+monate/);
  if (mehrere) {
    const wort = { zwei: 2, drei: 3, vier: 4, sechs: 6, zwolf: 12, zwölf: 12 };
    const n = Math.min(Number(mehrere[1]) || wort[mehrere[1]] || 3, MAX_MONATE);
    const start = minusMonate(jahrJetzt, monatJetzt, n);
    return fertig(spanne(start.jahr, start.monat, n));
  }

  // 4. Jahr. "letztes Jahr" oder eine Jahreszahl mit dem Wort Jahr daneben.
  if (/\b(letztes|vergangenes|voriges)\s+jahr\b/.test(t)) {
    return fertig(spanne(jahrJetzt - 1, 1, 12));
  }
  if (/\bjahr\b/.test(t) && jahrImSatz) {
    return fertig(spanne(Number(jahrImSatz), 1, 12));
  }
  if (/\b(dieses|laufende[ns]?)\s+jahr\b/.test(t)) {
    return fertig(spanne(jahrJetzt, 1, monatJetzt));
  }

  // 5. Monat, relativ. Alle Beugungen mitnehmen: Gesagt wird "von letztem
  // Monat", "der letzte Monat", "den letzten" — und ein nicht erkanntes
  // "letztem" fiele stumm auf die Vermutung unten zurueck.
  if (/\b(letzte|vergangene|vorige|vorherige)[mnrs]?\b|\bvormonat\b/.test(t)) {
    return fertig([letzter]);
  }
  if (/\b(diese[nmr]?|laufende[ns]?|aktuelle[ns]?)\s+monat\b/.test(t)) {
    return fertig([{ jahr: jahrJetzt, monat: monatJetzt }]);
  }

  // 6. Nichts gesagt. Dann der letzte ABGESCHLOSSENE Monat — das ist der
  // Ordner, den man am Monatsende wegschickt, und der laufende ist per
  // Definition unvollstaendig. Als "geraten" markiert: Der Zeitraum wird in
  // der Rueckfrage genannt, damit ein "nein, den Juni" ihn umbiegen kann.
  return fertig([letzter], true);
}

// -------------------------------------------------------------- Empfaengerin
//
// GERATEN WIRD HIER NICHTS. Eine Mailadresse, die ein Modell "plausibel"
// ergaenzt, schickt die komplette Buchhaltung an einen Fremden — das ist der
// teuerste Fehler, den dieses Modul machen koennte. Gesucht wird an genau drei
// Stellen, alle drei ausdruecklich gepflegt:
//
//   1. STEUER_MAIL in der Umgebung (die Buchhaltungs-Konfiguration)
//   2. das Kontaktbuch (data/kontakte.json), Eintrag mit Mailadresse
//   3. die Notiz in den Finanz-Einstellungen
//
// BEWUSST NICHT im CRM: Dort stehen 1.290 akquirierte Firmen, darunter
// Steuerkanzleien als LEADS. Ein Treffer auf "Steuer" waere dort mit hoher
// Wahrscheinlichkeit ein fremdes Buero — und das bekaeme unsere Belege.
const STEUER_MUSTER = /steuer|kanzlei|buchhalt/i;
const MAIL_MUSTER = /[^\s@<>,;"']+@[^\s@<>,;"']+\.[a-z]{2,}/i;

function nameAusZeile(zeile, mail) {
  // "Steuerberaterin: Frau Meier <meier@kanzlei.de>" -> "Frau Meier"
  const ohneMail = String(zeile).replace(mail, "").replace(/[<>()]/g, "");
  const teil = ohneMail.split(/[:,;|]/).map((s) => s.trim()).filter(Boolean);
  const kandidat = teil.reverse().find((s) => /[a-zäöüß]/i.test(s) && !STEUER_MUSTER.test(s));
  return kandidat ? kandidat.replace(/\s{2,}/g, " ").slice(0, 60) : "";
}

async function empfaengerinFinden(nutzer) {
  // 1. Umgebung
  const ausEnv = String(process.env.STEUER_MAIL || "").trim();
  if (MAIL_MUSTER.test(ausEnv)) {
    return {
      an: (ausEnv.match(MAIL_MUSTER) || [])[0],
      name: String(process.env.STEUER_NAME || "").trim() || nameAusZeile(ausEnv, (ausEnv.match(MAIL_MUSTER) || [])[0]),
      quelle: "Einstellungen",
    };
  }

  // 2. Kontaktbuch. Eintraege duerfen dort eine "email" tragen; finde() sucht
  // nur nach WhatsApp-Nummern und wuerde so einen Eintrag uebersehen — darum
  // hier ueber die rohe Liste.
  try {
    const treffer = kontakte.alle().find((k) =>
      MAIL_MUSTER.test(String(k.email || "")) &&
      (STEUER_MUSTER.test(String(k.name || "")) || STEUER_MUSTER.test(String(k.rolle || ""))));
    if (treffer) return { an: String(treffer.email).trim(), name: String(treffer.name || "").trim(), quelle: "Kontaktbuch" };
  } catch { /* kein Kontaktbuch ist kein Fehler, nur eine Quelle weniger */ }

  // 3. Notiz in den Finanz-Einstellungen. Gesucht wird die Zeile, in der BEIDES
  // steht — Mailadresse und das Wort. Eine beliebige Adresse aus der Notiz zu
  // nehmen waere genau das Raten, das hier nicht passieren darf.
  try {
    const e = await buch.einstellungen(nutzer);
    const zeile = String(e?.notiz || "").split("\n")
      .find((z) => MAIL_MUSTER.test(z) && STEUER_MUSTER.test(z));
    if (zeile) {
      const mail = (zeile.match(MAIL_MUSTER) || [])[0];
      return { an: mail, name: nameAusZeile(zeile, mail), quelle: "Buchhaltung" };
    }
  } catch (e) { console.error("Steuer-Empfaengerin (Einstellungen):", e.message); }

  return null;
}

// Wie sie im Satz vorkommt: "an Frau Meier" — und wenn kein Name hinterlegt
// ist, "an die Steuerberaterin". Eine vorgelesene Mailadresse ist im Auto
// wertlos (P1.4) und klingt ausserdem nach Formular.
//
// KEIN "Frau" davorsetzen, wenn keins hinterlegt ist. Der erste Entwurf machte
// aus "Meier" ein "Frau Meier" — bei einem Herrn Meier waere das ein Fehler,
// den Alexandra jedes Mal wiederholt. Wer die Anrede hoeren will, pflegt sie
// mit ein (STEUER_NAME="Frau Meier" oder so im Kontaktbuch).
function anredeKurz(name) {
  const n = String(name || "").trim();
  return n || "die Steuerberaterin";
}

// Merken, was Lukas gerade diktiert hat — damit dieselbe Frage nicht beim
// naechsten Monatsende nochmal kommt. Nur die Adresse, nichts sonst.
function merken(an, name) {
  try {
    const liste = kontakte.alle().filter((k) => !STEUER_MUSTER.test(String(k.name || "")));
    liste.push({ name: name || "Steuerberaterin", email: an, intern: false });
    kontakte.speichern(liste);
  } catch { /* nicht merken zu koennen darf den Versand nicht aufhalten */ }
}

// -------------------------------------------------------------- Der Ordner
//
// HIER WIRD NICHTS NEU GEBAUT. buch.monatsExport() packt seit dem 28.07. genau
// das, was die Steuerberaterin bekommt: Uebersicht als CSV und HTML, die
// Belegdateien, die Pruefsummen. Ein zweiter Packer haette einen zweiten
// Inhalt, und spaetestens bei der ersten Nachfrage der Kanzlei waere unklar,
// welcher der beiden galt.
//
// Zuerst monatsDaten (nur lesen), dann erst monatsExport: monatsExport
// schreibt eine Zeile nach monats_exporte ("schon geholt"). Fuer einen leeren
// Monat, der ohnehin nicht rausgeht, waere das ein Eintrag ueber einen
// Vorgang, den es nie gab.
async function paketBauen(nutzer, monate) {
  const teile = [];
  let anzahl = 0, ein = 0, aus = 0, ohneBeleg = 0, dateien = 0, bytes = 0;

  for (const m of monate) {
    const d = await buch.monatsDaten(nutzer, m.jahr, m.monat);
    if (!d || !d.zeilen.length) continue;          // leerer Monat: still uebergehen
    const r = await buch.monatsExport(nutzer, m.jahr, m.monat);
    if (!r.ok) continue;
    teile.push({
      name: r.dateiname, typ: "application/zip", daten: r.zip,
      titel: r.titel, jahr: m.jahr, monat: m.monat,
    });
    anzahl += d.zeilen.length;
    ein += d.summe_ein;
    aus += d.summe_aus;
    ohneBeleg += d.ohneBeleg;
    dateien += r.dateien;
    bytes += r.zip.length;
  }

  return { teile, anzahl, ein, aus, summe: ein + aus, ohneBeleg, dateien, bytes };
}

// -------------------------------------------------------------- Die Mail
//
// Bewusst ohne Sprachmodell, wie das Rechnungsanschreiben in
// beleg-erstellen.js: Drei Saetze an die eigene Kanzlei haben keinen Spielraum,
// und jeder Modellaufruf ist eine weitere Stelle, an der etwas Falsches nach
// aussen gehen kann.
function mailTexten(p) {
  const anrede = p.name ? `Guten Tag ${anredeKurz(p.name)},` : "Guten Tag,";
  const monatsListe = p.teile.length === 1
    ? `den Monat ${p.teile[0].titel}`
    : `die Monate ${p.teile.map((t) => t.titel).join(", ")}`;
  const zeilen = [
    anrede,
    "",
    `anbei erhalten Sie die Buchhaltungsunterlagen für ${monatsListe}.`,
    "",
    `Jede Datei enthält eine Übersicht als CSV und als HTML, die Belegdateien im ` +
    `Unterordner "Belege" sowie eine Prüfsummenliste (SHA-256) zu jeder Datei.`,
    "",
    `Insgesamt ${p.anzahl} ${p.anzahl === 1 ? "Bewegung" : "Bewegungen"}: ` +
    `${euro(p.ein)} Einnahmen, ${euro(p.aus)} Ausgaben.`,
    "",
    `Maßgeblich für die Zuordnung zum Monat ist der Zahltag (Zufluss-Prinzip), ` +
    `nicht das Belegdatum. Offene Rechnungen sind darum nicht enthalten.`,
    p.ohneBeleg ? `\nZu ${p.ohneBeleg} ${p.ohneBeleg === 1 ? "Buchung" : "Buchungen"} liegt keine Belegdatei vor; sie stehen in der Übersicht.` : "",
    "",
    "Bei Rückfragen melden Sie sich gerne jederzeit.",
    "",
    "Viele Grüße",
    "Lukas Sehorz",
    "Flowstate – Sehorz & vom Hofe GbR",
  ].filter((z) => z !== "");
  return {
    betreff: `Buchhaltung ${p.zeitraumTitel} – Sehorz & vom Hofe GbR`,
    text: zeilen.join("\n"),
  };
}

// -------------------------------------------------------------- Schritt 1
//
// nutzer: das Profil aus der Sitzung (req.session.crm) — buchhaltung.js
// arbeitet ueber alsNutzer(nutzer.id) und damit unter den Rechten dieses
// Nutzers, nicht als System.
async function vorbereiten(nutzer, auftrag = {}) {
  if (!nutzer || !nutzer.id) {
    return { ok: false, reply: "Dafür muss ich wissen, wer fragt — melde dich bitte im Dashboard an.",
      gesprochen: "Dafür muss ich wissen, wer fragt." };
  }

  const gesagt = [auftrag.zeitraum, auftrag.text].filter(Boolean).join(" ");
  const zeitraum = zeitraumVerstehen(gesagt);
  if (!zeitraum) {
    return { ok: false, reply: "Für welchen Monat soll ich die Unterlagen zusammenstellen?",
      gesprochen: "Für welchen Monat soll ich die Unterlagen zusammenstellen?" };
  }

  const paket = await paketBauen(nutzer, zeitraum.monate);

  // Nichts gebucht. Statt "geht nicht" den naechstbesten Monat NENNEN — der
  // haeufigste Fall ist, dass Lukas einen Monat danebenliegt, nicht dass es
  // keine Belege gibt.
  if (!paket.teile.length) {
    let hinweis = "";
    try {
      const monate = await buch.monateMitDaten(nutzer);
      if (monate.length) {
        const m = monate[0];
        offen = { schritt: "monat-klaeren", seit: Date.now(), nutzer,
          vorschlag: { jahr: m.jahr, monat: m.monat } };
        hinweis = ` Der letzte Monat mit gebuchten Belegen ist ${MONATSNAME[m.monat - 1]}. Soll ich den nehmen?`;
      }
    } catch { /* ohne Vorschlag bleibt die ehrliche Auskunft */ }
    const satz = `Für ${zeitraum.titel} ist noch nichts gebucht und bezahlt — da liegt kein Ordner.${hinweis}`;
    return { ok: false, reply: satz, gesprochen: satz };
  }

  // ZU GROSS FUER EINE MAIL (gemessen am 20.08.2026 an den echten Daten: der
  // Juli-Ordner wiegt 19,3 MB, weil elf Belege als Handyfotos drinstecken).
  //
  // Gmail nimmt 25 MB pro Nachricht, und base64 macht aus 19 MB rund 26 —
  // die Mail waere abgewiesen worden. Hier wird darum NICHT gesendet und auch
  // nichts weggelassen: Ein Ordner, aus dem stillschweigend Belege fehlen,
  // faellt erst der Steuerberaterin auf, und dann ist es Lukas' Problem.
  //
  // Ueber mehrere Monate hilft der Vorschlag "dann einen einzelnen Monat".
  // Bei EINEM Monat hilft er nicht — dann ist der Weg der Download im
  // Dashboard, und das muss auch so gesagt werden.
  if (paket.bytes > MAX_ANHANG) {
    offen = null;
    const mb = Math.round(paket.bytes / 1048576);
    const einer = paket.teile.length === 1;
    const rat = einer
      ? "Lade ihn dir unter Buchhaltung herunter, dann geht er als Link oder über die Kanzlei-Ablage raus."
      : "Sag mir einen einzelnen Monat, dann passt es — sonst liegt alles unter Buchhaltung zum Herunterladen.";
    return { ok: false, zuGross: true,
      reply: `Das Paket für ${zeitraum.titel} ist mit ${mb} Megabyte zu groß für eine Mail (Gmail nimmt 25). ${rat}`,
      gesprochen: `${zeitraum.kopf} sind zusammen ${aussprache.zahlWort(mb, "ein")} Megabyte — das ist zu groß für eine Mail. ${rat}` };
  }

  // Empfaengerin: erst das, was Lukas gerade gesagt hat, dann die gepflegten
  // Quellen. Steht sie nirgends, wird GEFRAGT.
  const ausSatz = (String(auftrag.an || gesagt).match(MAIL_MUSTER) || [])[0];
  const gefunden = ausSatz ? { an: ausSatz, name: "", quelle: "gesagt" } : await empfaengerinFinden(nutzer);

  // Der Vorgang wird auch ohne Adresse gemerkt — sonst muesste das ZIP nach
  // der Rueckfrage ein zweites Mal gebaut werden (und ein zweites Mal im
  // Export-Verlauf stehen).
  offen = {
    schritt: gefunden ? "freigabe" : "adresse-fehlt",
    seit: Date.now(), nutzer, zeitraum, paket,
    an: gefunden?.an || "", name: gefunden?.name || "", quelle: gefunden?.quelle || "",
  };

  // Damit ein spaeteres "ja" nicht die falsche Sache verschickt: Steht noch
  // eine Rechnung zur Freigabe, faengt beleg-erstellen.js das "ja" vorher ab
  // (es wird in sprache-routes.js zuerst gefragt). Zwei offene Rueckfragen
  // gleichzeitig sind nicht zuordenbar — die aeltere faellt weg.
  try { belegErstellen.vergessen(); } catch { /* egal */ }

  if (!gefunden) {
    const satz = `${zeitraum.kopf} liegen als Paket bereit. An welche Mailadresse soll ich sie schicken? Ich hab keine hinterlegt.`;
    return { ok: true, reply: satz, gesprochen: satz, wartetAuf: "adresse" };
  }

  return vorlegen();
}

// Den fertigen Vorgang aussprechen. Getrennt, weil hier drei Wege
// zusammenlaufen: frisch vorbereitet, Adresse nachgereicht, Monat korrigiert.
function vorlegen() {
  const b = frisch();
  if (!b || !b.paket) return { ok: false, reply: "Da ist gerade kein Ordner offen." };

  const p = { ...b.paket, name: b.name, zeitraumTitel: b.zeitraum.titel, teile: b.paket.teile };
  b.mail = mailTexten(p);
  b.schritt = "freigabe";
  b.seit = Date.now();

  const wer = anredeKurz(b.name);
  const belegWort = b.paket.anzahl === 1 ? "Beleg" : "Belege";

  // GESPROCHEN: keine Dateinamen, keine Pfade, keine Aufzaehlung. Zeitraum,
  // Anzahl, Summe, Empfaengerin — das sind die vier Angaben, an denen Lukas im
  // Auto merkt, ob etwas schiefgelaufen ist, und mehr passt in einen Satz auch
  // nicht. Die Zahlen stehen als Wort da, damit die Stimme sie nicht raet.
  const gesprochen =
    `${b.zeitraum.kopf} liegen als Paket bereit, ` +
    `${aussprache.zahlWort(b.paket.anzahl, "ein")} ${belegWort}, ` +
    `zusammen ${euroGesprochen(b.paket.summe)}. ` +
    `Soll ich sie an ${wer} schicken?`;

  // REPLY darf mehr zeigen — der Chat wird gelesen, nicht gehoert. Hier steht,
  // was im Ohr nichts verloren hat: Adresse, Betreff, Dateien.
  const reply = [
    `${b.zeitraum.kopf} liegen als Paket bereit: ${b.paket.anzahl} ${belegWort}, ` +
    `${euro(b.paket.ein)} Einnahmen, ${euro(b.paket.aus)} Ausgaben.`,
    b.paket.ohneBeleg ? `${b.paket.ohneBeleg} davon ohne Belegdatei.` : "",
    "",
    `An: ${b.an}${b.name ? ` (${b.name})` : ""}`,
    `Betreff: ${b.mail.betreff}`,
    `Anhang: ${b.paket.teile.map((t) => t.name).join(", ")}`,
    "",
    "Soll sie so rausgehen?",
  ].filter((z) => z !== "").join("\n");

  return { ok: true, reply, gesprochen, wartetAuf: "freigabe", an: b.an, zeitraum: b.zeitraum.titel };
}

// -------------------------------------------------------------- Schritt 2
async function senden() {
  const b = frisch();
  if (!b || b.schritt !== "freigabe") {
    return { ok: false, reply: "Da ist gerade nichts zum Rausschicken offen.",
      gesprochen: "Da ist gerade nichts zum Rausschicken offen." };
  }

  const merk = b;
  offen = null;   // vor dem Senden leeren: ein zweites "ja" darf nicht doppelt senden

  const anhaenge = merk.paket.teile.map((t) => ({ name: t.name, typ: t.typ, daten: t.daten }));

  // PROBEMODUS ZUERST — und zwar HIER, nicht im Aufrufer (20.08.2026).
  //
  // werkzeuge.mailSenden hat den Riegel schon eingebaut, aber dieser Weg geht
  // nicht dort entlang: Anhaenge kann gws-cli nicht, also laeuft der Versand
  // ueber gmail-direkt.js — und das kennt den Probemodus nicht. Ohne diese
  // vier Zeilen wuerde ein Probelauf, der die Freigabe durchspielt, die echte
  // Buchhaltung an die echte Steuerberaterin schicken.
  if (probemodus.aktiv()) {
    probemodus.notieren("mail", {
      an: merk.an, betreff: merk.mail.betreff,
      body: merk.mail.text.slice(0, 800),
      anhaenge: anhaenge.map((a) => `${a.name} (${a.daten.length} B)`),
    });
    sprachlog.schreiben({ art: "steuer-versand", an: merk.an, zeitraum: merk.zeitraum.titel,
      belege: merk.paket.anzahl, ausgang: "probe" });
    const satz = `Im Probemodus: die Mail an ${anredeKurz(merk.name)} ist NICHT rausgegangen.`;
    return { ok: true, probe: true, reply: satz, gesprochen: satz };
  }

  if (!gmail.bereit()) {
    return { ok: false, reply: "Kein Mailzugang hinterlegt — ich kann sie nicht verschicken. Der Ordner liegt fertig unter Buchhaltung.",
      gesprochen: "Ich hab gerade keinen Mailzugang — der Ordner liegt aber fertig in der Buchhaltung." };
  }

  try {
    await gmail.senden({
      an: merk.an, betreff: merk.mail.betreff, text: merk.mail.text,
      absender: ABSENDER, anhaenge,
    });
    sprachlog.schreiben({ art: "steuer-versand", an: merk.an, zeitraum: merk.zeitraum.titel,
      belege: merk.paket.anzahl, dateien: anhaenge.length, ausgang: "gesendet" });

    // Die Adresse erst NACH dem geglueckten Versand merken. Eine falsch
    // verstandene Adresse, die nie ankam, soll nicht als gepflegter Kontakt
    // liegenbleiben.
    if (merk.quelle === "gesagt") merken(merk.an, merk.name);

    const wer = anredeKurz(merk.name);
    const satz = `Raus an ${wer} — ${merk.zeitraum.kopf.replace(/^Die /, "")}, ${aussprache.zahlWort(merk.paket.anzahl, "ein")} Belege.`;
    return { ok: true, gesendet: true, an: merk.an,
      reply: `Raus an ${merk.an}: ${merk.mail.betreff}, ${merk.paket.anzahl} Belege in ${anhaenge.length} ${anhaenge.length === 1 ? "Datei" : "Dateien"}.`,
      gesprochen: satz };
  } catch (e) {
    sprachlog.schreiben({ art: "steuer-versand", an: merk.an, zeitraum: merk.zeitraum.titel,
      ausgang: "fehlgeschlagen", grund: String(e.message).slice(0, 200) });
    // Der Vorgang bleibt offen: Der Ordner ist gepackt, nur der Versand hakt.
    // Ein zweites "ja" soll es nochmal versuchen koennen, ohne alles neu zu
    // bauen — und ohne einen zweiten Eintrag im Export-Verlauf.
    offen = merk;
    merk.seit = Date.now();
    return { ok: false,
      reply: `Das Verschicken hat nicht geklappt: ${String(e.message).slice(0, 140)}. Das Paket liegt fertig — sag Bescheid, dann versuch ich es nochmal.`,
      gesprochen: "Beim Verschicken hakt's gerade. Das Paket liegt fertig — soll ich es nochmal versuchen?" };
  }
}

// -------------------------------------------------------------- Die Rueckfrage
//
// Gibt null zurueck, wenn der Satz KEINE Antwort auf die offene Rueckfrage war.
// Dann gehoert er Alexandra und wird ganz normal beantwortet. Gebaut wie
// belegErstellen.antwortAuf und dafuer gedacht, in sprache-routes.js direkt
// daneben zu stehen — VOR dem Modellaufruf.
const JA = /^(ja|jap|jo|jep|klar|passt|genau|gerne|bitte|mach|mach das|schick|schicke|schick sie|senden|send|raus|rausschicken|abschicken|los|ok|okay|jawohl)\b/;
const NEIN = /^(nein|ne|nee|n[oö]|nicht|kein|stopp|stop|lass|warte|abbrechen|verwerfen|verwirf|doch nicht|vergiss|noch nicht|sp[aä]ter)\b/;

async function antwortAuf(text) {
  const b = frisch();
  if (!b) return null;
  const roh = String(text || "").trim();
  const t = roh.toLowerCase();

  // Eine Mailadresse im Satz ist immer eine Antwort — egal, wie er sonst
  // lautet. Auch dann, wenn schon eine hinterlegt war: Wer eine Adresse
  // diktiert, korrigiert damit.
  const adr = (roh.match(MAIL_MUSTER) || [])[0];
  if (adr && b.paket) {
    b.an = adr;
    b.quelle = "gesagt";
    return vorlegen();
  }

  // Ein Zeitraum im Satz biegt den Vorgang um, statt ihn zu verwerfen.
  // "Nein, den Juni" faengt mit "nein" an und meint trotzdem: anderer Monat.
  // Das kostet nichts — gesendet wird auch danach erst nach einem klaren Ja.
  const neuerZeitraum = zeitraumVerstehen(roh);
  if (neuerZeitraum && !neuerZeitraum.geraten &&
      (!b.zeitraum || neuerZeitraum.titel !== b.zeitraum.titel)) {
    const nutzer = b.nutzer;
    const an = b.an, name = b.name, quelle = b.quelle;
    offen = null;
    const r = await vorbereiten(nutzer, { zeitraum: roh, an });
    // Die schon bekannte Empfaengerin nicht verlieren: vorbereiten() erkennt
    // zwar die Adresse wieder, aber den Namen dazu kennt nur der alte Vorgang.
    if (offen && offen.an === an && an && !offen.name && name) {
      offen.name = name;
      offen.quelle = quelle;
      return vorlegen();
    }
    return r;
  }

  const ja = JA.test(t);
  const nein = NEIN.test(t);
  if (!ja && !nein) return null;

  if (nein) {
    const was = b.zeitraum ? b.zeitraum.titel : "der Ordner";
    offen = null;
    sprachlog.schreiben({ art: "steuer-versand", an: b.an || null, zeitraum: was, ausgang: "verworfen" });
    const satz = "Alles klar, ich schick nichts. Der Ordner liegt fertig in der Buchhaltung.";
    return { ok: true, reply: satz, gesprochen: satz };
  }

  // "ja" auf den Monatsvorschlag ("Der letzte Monat mit Belegen ist Juni —
  // soll ich den nehmen?")
  if (b.schritt === "monat-klaeren") {
    const nutzer = b.nutzer, v = b.vorschlag;
    offen = null;
    return vorbereiten(nutzer, { zeitraum: `${MONATSNAME[v.monat - 1]} ${v.jahr}` });
  }

  if (b.schritt === "adresse-fehlt") {
    // "ja" ohne Adresse bringt nichts weiter — die Frage bleibt stehen.
    return { ok: true, wartetAuf: "adresse",
      reply: "Ich brauch die Mailadresse der Steuerberaterin — die hab ich nirgends stehen.",
      gesprochen: "Ich brauch die Mailadresse der Steuerberaterin — die hab ich nirgends stehen." };
  }

  if (b.schritt === "freigabe") return senden();
  return null;
}

module.exports = {
  vorbereiten, antwortAuf, senden, vorlegen, wasOffen, vergessen,
  zeitraumVerstehen, empfaengerinFinden, mailTexten, anredeKurz, GILT_MS,
};
