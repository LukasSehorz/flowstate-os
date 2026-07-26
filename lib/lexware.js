// Anbindung an die Lexware-Office-Schnittstelle (frueher lexoffice).
//
// Der Schluessel steht in LEXWARE_API_KEY und wird bei app.lexware.de/addons/public-api
// erzeugt. Er laeuft nach hoechstens 24 Monaten ab — dann neu erzeugen und in der
// .env austauschen. bereit() sagt, ob ueberhaupt einer da ist.
//
// Lexware erlaubt 2 Anfragen pro Sekunde. Alle Aufrufe laufen darum durch eine
// Warteschlange, die 550 ms Abstand haelt — sonst antwortet die Schnittstelle mit
// 429 und der Beleg geht verloren.
const BASIS = "https://api.lexware.io";
const ABSTAND_MS = 550;

let letzterRuf = 0;
let kette = Promise.resolve();

const schluessel = () => (process.env.LEXWARE_API_KEY || "").trim();
module.exports.bereit = () => schluessel().length > 0;

// Reiht einen Aufruf ein und haelt den Mindestabstand ein.
function inReihe(fn) {
  const lauf = kette.then(async () => {
    const wartezeit = Math.max(0, ABSTAND_MS - (Date.now() - letzterRuf));
    if (wartezeit) await new Promise((r) => setTimeout(r, wartezeit));
    letzterRuf = Date.now();
    return fn();
  });
  // Die Kette darf nicht abreissen, wenn ein Aufruf scheitert.
  kette = lauf.then(() => {}, () => {});
  return lauf;
}

async function ruf(pfad, { methode = "GET", koerper = null, formular = null } = {}) {
  if (!module.exports.bereit()) throw new Error("LEXWARE_API_KEY fehlt");
  return inReihe(async () => {
    const kopf = { Authorization: `Bearer ${schluessel()}`, Accept: "application/json" };
    let leib;
    if (formular) {
      leib = formular; // FormData setzt Content-Type samt Grenze selbst
    } else if (koerper) {
      kopf["Content-Type"] = "application/json";
      leib = JSON.stringify(koerper);
    }
    const a = await fetch(BASIS + pfad, { method: methode, headers: kopf, body: leib });
    const text = await a.text();
    if (!a.ok) {
      // Lexware antwortet mit einer Fehlerliste — die ist fuer die Anzeige wertvoll.
      let grund = text.slice(0, 400);
      try {
        const j = JSON.parse(text);
        grund = (j.IssueList || []).map((i) => i.i18nKey || i.type || i.source).join(", ") || j.message || grund;
      } catch {}
      const f = new Error(`Lexware ${a.status}: ${grund}`);
      f.status = a.status;
      throw f;
    }
    return text ? JSON.parse(text) : null;
  });
}

module.exports.profil = () => ruf("/v1/profile");
module.exports.kategorien = () => ruf("/v1/posting-categories");

// Das Konto bestimmt, welche Steuersaetze erlaubt sind. Steht es auf Kleinunternehmer
// (§19 UStG), weist Lexware jeden Beleg mit 7 % oder 19 % ab — dort darf nur 0 %
// stehen. Wir holen das Profil einmal und merken es uns; ohne diese Pruefung wuerde
// jeder Beleg mit "invalid_taxrate_19" scheitern.
let profilMerker = null;
let profilZeit = 0;
const PROFIL_FRISCH_MS = 10 * 60 * 1000;

module.exports.kontoArt = async function () {
  if (!module.exports.bereit()) return { bereit: false };
  if (profilMerker && Date.now() - profilZeit < PROFIL_FRISCH_MS) return profilMerker;
  try {
    const p = await ruf("/v1/profile");
    profilMerker = {
      bereit: true,
      firma: p.companyName || "",
      kleinunternehmer: p.smallBusiness === true,
      // vatfree = keine Umsatzsteuer, net/gross = mit Umsatzsteuer
      steuerfrei: p.taxType === "vatfree" || p.smallBusiness === true,
      taxType: p.taxType || "",
    };
    profilZeit = Date.now();
    return profilMerker;
  } catch (f) {
    return { bereit: true, fehler: f.message };
  }
};
// Welche Saetze darf der Nutzer waehlen?
module.exports.erlaubteSaetze = async function () {
  const k = await module.exports.kontoArt();
  return k.steuerfrei ? [0] : [19, 7, 0];
};

// ---------------------------------------------------------------- Kategorien
// Unsere Kategorien auf die Buchungskategorien in Lexware abgebildet. Die Kennungen
// stammen aus /v1/posting-categories und sind bei Lexware fest — sie unterscheiden
// sich nicht je Konto.
// "Lizenzen und Konzessionen" ist bewusst gewaehlt: dort hat Lexware selbst das
// eigene Abo verbucht, es ist die richtige Kategorie fuer Software-Abos.
const AUSGABE_KATEGORIE = {
  "Software & Tools":       "b49aae5f-4121-4262-b8bd-f49278b66423", // Lizenzen und Konzessionen
  "Werbung & Ads":          "d22989b0-fd89-11e1-a21f-0800200c9a66", // Anzeigen Print- und Online
  "Personal":               "efa82f44-fd85-11e1-a21f-0800200c9a66", // Personal
  "Honorare & Freelancer":  "205cae71-fd88-11e1-a21f-0800200c9a66", // Freelancer/Freie Mitarbeiter
  "Büro & Ausstattung":     "16d04a21-fd91-11e1-a21f-0800200c9a66", // Bürobedarf
  "Fahrzeug & Tanken":      "9eaf6ff0-fd89-11e1-a21f-0800200c9a66", // Kraftstoff/Ladestrom
  "Reisekosten":            "efa82f49-fd85-11e1-a21f-0800200c9a66", // Reisen
  "Steuern & Abgaben":      "f13b89bc-d104-11ec-9d64-0242ac120002", // Sonstige Abgaben
  "Versicherungen":         "efa82f46-fd85-11e1-a21f-0800200c9a66", // Versicherungen (betrieblich)
  "Sonstiges":              "16d04a28-fd91-11e1-a21f-0800200c9a66", // Sonstige Ausgaben
};
const EINNAHME_KATEGORIE = {
  "Webdesign":              "8f8664a0-fd86-11e1-a21f-0800200c9a66", // Dienstleistung
  "Performance Marketing":  "8f8664a0-fd86-11e1-a21f-0800200c9a66", // Dienstleistung
  "KI-Projekte":            "8f8664a0-fd86-11e1-a21f-0800200c9a66", // Dienstleistung
  "Hosting & Wartung":      "8f8664a9-fd86-11e1-a21f-0800200c9a66", // Wartung
  "Sonstiges":              "cfddcc50-fd86-11e1-a21f-0800200c9a66", // Sonstige Einnahmen
};
module.exports.AUSGABE_KATEGORIE = AUSGABE_KATEGORIE;
module.exports.EINNAHME_KATEGORIE = EINNAHME_KATEGORIE;

// Tagesdatum im Format, das Lexware erwartet (mit Zeitzone).
const tagStempel = (d) => {
  const x = d ? new Date(d) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T00:00:00.000+02:00`;
};

// ---------------------------------------------------------------- Beleg anlegen
// b = { art, betrag (brutto), steuersatz, datum, gegenstelle, kategorie, belegnummer, bezahlt }
// Wir buchen BRUTTO (taxType 'gross'): auf einem Beleg steht der Bruttobetrag, und
// Lexware rechnet die Steuer daraus zurueck. Das vermeidet Rundungsfehler.
// useCollectiveContact spart das Anlegen eines Kontakts je Lieferant — der Name
// steht als Text am Beleg, was fuer Tankrechnungen und Quittungen genau richtig ist.
module.exports.belegAnlegen = async function (b) {
  const einnahme = b.art === "einnahme";
  const brutto = Math.round(Number(b.betrag) * 100) / 100;
  const konto = await module.exports.kontoArt();

  // Bei Kleinunternehmern erlaubt Lexware ausschliesslich 0 % — jeder andere Satz
  // wird mit "invalid_taxrate_19" abgewiesen. Darum richtet sich der Satz nach dem
  // Konto und nicht nach der Auswahl im Formular.
  const gewaehlt = Number(b.steuersatz);
  const steuersatz = konto.steuerfrei ? 0 : ([0, 7, 19].includes(gewaehlt) ? gewaehlt : 19);
  // Der Bruttobetrag enthaelt die Steuer: netto = brutto / (1 + satz)
  const steuer = steuersatz === 0 ? 0
    : Math.round((brutto - brutto / (1 + steuersatz / 100)) * 100) / 100;

  const tabelle = einnahme ? EINNAHME_KATEGORIE : AUSGABE_KATEGORIE;
  const kategorieId = tabelle[b.kategorie] || tabelle["Sonstiges"];

  // voucherNumber ist Pflicht — ohne sie antwortet Lexware mit "missing_entity".
  // Steht keine auf dem Beleg, erzeugen wir eine nachvollziehbare aus Datum und Zeit.
  const stempel = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const nummer = String(b.belegnummer || "").trim()
    || `FS-${stempel.getFullYear()}${p(stempel.getMonth() + 1)}${p(stempel.getDate())}-${p(stempel.getHours())}${p(stempel.getMinutes())}${p(stempel.getSeconds())}`;

  const koerper = {
    type: einnahme ? "salesinvoice" : "purchaseinvoice",
    // "paid" ist beim Anlegen nicht erlaubt. Der Beleg entsteht offen; Lexware
    // ordnet die Zahlung selbst zu, sobald sie auf dem verbundenen Bankkonto
    // auftaucht. Genau dafuer ist das Konto verbunden.
    voucherStatus: "open",
    voucherNumber: nummer,
    voucherDate: tagStempel(b.datum),
    dueDate: tagStempel(b.faellig || b.datum),
    totalGrossAmount: brutto,
    totalTaxAmount: steuer,
    taxType: "gross",
    useCollectiveContact: true,
    contactName: String(b.gegenstelle || "").trim() || "Ohne Angabe",
    voucherItems: [{
      amount: brutto,
      taxAmount: steuer,
      taxRatePercent: steuersatz,
      categoryId: kategorieId,
    }],
  };
  const angelegt = await ruf("/v1/vouchers", { methode: "POST", koerper });
  return { ...angelegt, nummer, steuersatz, steuer };
};

// ---------------------------------------------------------------- Beleg hochladen
//
// DAS ist der Weg fuer Belege mit Datei. Getestet gegen die echte Schnittstelle:
//
//   POST /v1/files (type=voucher)  ->  202 { id, voucherId }
//       Die Datei landet im Belegeingang von Lexware und dort entsteht ein Beleg
//       im Zustand "unchecked" — mit der Datei daran. Lexware laesst seine eigene
//       Belegerkennung darueber laufen.
//
// Warum nicht Daten per PUT nachtragen: Jedes PUT auf einen Beleg LOESCHT die
// Dateiverknuepfung (files wird leer), und erneutes Setzen wird mit
// "invalid_file_ids" abgewiesen. POST /v1/vouchers/{id}/file antwortet mit 500.
// Beides mehrfach geprueft. Wer die Datei am Beleg behalten will, darf den Beleg
// also nicht per Schnittstelle beschreiben — die Zuordnung passiert in Lexware.
module.exports.dateiHochladen = async function ({ name, typ, daten }) {
  const form = new FormData();
  form.append("file", new Blob([daten], { type: typ || "application/octet-stream" }), name || "beleg");
  form.append("type", "voucher");
  // Antwort: { id: <Datei-Id>, voucherId: <neuer Beleg im Eingang> }
  return ruf("/v1/files", { methode: "POST", formular: form });
};

module.exports.beleg = (id) => ruf(`/v1/vouchers/${id}`);
