// Beleg-Versand — die Nachricht zum Beleg schreiben und rausschicken.
//
// Warum (Lukas, 05.09.2026): "Danach soll ich gleich die Möglichkeit haben,
// dass eine E-Mail dafür gestellt wird oder eine WhatsApp-Nachricht, und dann
// kann ich im nächsten Schritt die Rechnung per E-Mail oder WhatsApp
// abschicken."
//
// Also zwei Schritte, nicht einer: erst SCHREIBEN und ansehen, dann SENDEN.
// Dieselbe Zweistufigkeit wie in lib/beleg-erstellen.js — und aus demselben
// Grund: Eine Rechnung, die an den falschen Empfaenger oder mit schiefem Text
// rausgeht, laesst sich nicht zurueckholen.
//
// DAS GERUEST IST FEST, NUR DIE WORTE SIND FREI.
// Der Text darf vom Sprachmodell kommen — er klingt dann natuerlicher als drei
// zusammengesetzte Bausteine. Aber drei Angaben MUESSEN wörtlich drinstehen:
// Nummer, Betrag und Faelligkeit. Fehlt eine davon, wird der Modelltext
// verworfen und die feste Fassung genommen. Begruendung: Diese drei sind der
// eigentliche Inhalt der Nachricht. Eine hoefliche Mail ohne Betrag ist keine
// hoeflichere Mail, sondern eine unbrauchbare. Und ein Modell, das den Betrag
// "rund 1.200 €" nennt, hat eine Rechnung falsch angekuendigt.
//
// OHNE MODELLZUGANG laeuft die Funktion vollstaendig: Sie nimmt sofort die
// feste Fassung. Kein Zustand, in dem hier nichts herauskommt.
//
// WHATSAPP KANN KEINE DATEI (geprueft an lib/whatsapp.js: senden({an, text}),
// die Bruecke nimmt nur Text). Deshalb bekommt die WhatsApp-Nachricht einen
// LINK auf das PDF — signiert, 30 Tage gueltig, ohne Anmeldung abrufbar, weil
// der Kunde kein Konto in diesem System hat. Der Schluessel ist die ganze
// Berechtigung: 24 Zufallsbytes, nicht ableitbar aus der Rechnungsnummer, und
// es gibt kein Verzeichnis und keine Auflistung.

const crypto = require("crypto");
const rg = require("./rechnungen.js");
const crm = require("./crm.js");
const schnell = require("./schnell.js");

const MODELL = process.env.VERSAND_MODELL || "claude-sonnet-5";

// Wie lange ein PDF-Link gilt. 30 Tage deckt das Zahlungsziel (14) mit Puffer
// ab; danach ist der Link tot und die Rechnung liegt beim Kunden im Chat.
const LINK_TAGE = 30;

// WhatsApp ist ein Chat, keine Mail. Alles ueber ~700 Zeichen liest niemand,
// und die Bruecke schneidet im Protokoll ohnehin bei 800 ab.
const WA_MAX = 700;

const KANAELE = ["mail", "whatsapp"];
const MODI = ["senden", "entwurf"];

const s = (x, max) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const mehrzeilig = (x, max) => String(x ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const MAIL_MUSTER = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[a-z]{2,}$/i;

// ------------------------------------------------------------ Empfaenger
//
// Mail steht am Beleg (Schnappschuss aus der Akte). Die WhatsApp-Nummer steht
// NICHT am Beleg — sie gehoert zur Person, nicht zum Vorgang — und kommt
// deshalb aus firmen.mobil, ersatzweise firmen.telefon.
function mailVorschlag(r, firma) {
  return s((r && r.empfaenger && r.empfaenger.email) || (firma && firma.email) || "", 160);
}

// "08071 1234" -> "+498071 1234" waere geraten; deshalb wird NICHT geraten,
// sondern nur geputzt und die Landesvorwahl ergaenzt, wenn die Nummer wie eine
// deutsche Nummer mit fuehrender Null aussieht. Alles andere geht so raus, wie
// es in der Akte steht — die Bruecke meldet dann sauber "nicht zustellbar",
// und das ist ehrlicher als eine erfundene Vorwahl.
function nummerPutzen(roh) {
  let t = String(roh || "").replace(/[^\d+]/g, "");
  if (!t) return "";
  if (t.startsWith("00")) t = "+" + t.slice(2);
  else if (t.startsWith("0")) t = "+49" + t.slice(1);
  if (!t.startsWith("+")) return t;
  return t.length >= 8 && t.length <= 17 ? t : "";
}
function whatsappVorschlag(r, firma) {
  return nummerPutzen((firma && (firma.mobil || firma.telefon)) || "");
}

// ------------------------------------------------------------ Feste Fassung
//
// Die Fassung ohne Sprachmodell. Fuer die Mail ist das wortgleich
// rechnungen.mailTexten (D1) — zwei Fassungen desselben Briefs waeren zwei
// Stellen, an denen der Ton auseinanderlaufen kann.
function festeFassung(r, { kanal = "mail", user = null, pdfLink = "" } = {}) {
  const abs = rg.absender(r && r.art);
  if (kanal !== "whatsapp") return rg.mailTexten(r, user, abs);

  const e = (r && r.empfaenger) || {};
  const wort = r.art === "angebot" ? "Angebot" : (r.abschlag_von ? "Abschlagsrechnung" : "Rechnung");
  // Im Chat wird geduzt gegruesst, aber gesiezt geschrieben — "Guten Tag, Herr
  // Anderka" ist der Ton, den Lukas auch selbst tippt.
  const anrede = e.anrede && e.ansprechperson
    ? `Guten Tag ${e.anrede === "Frau" ? "Frau" : "Herr"} ${nachname(e.ansprechperson)},`
    : (e.ansprechperson ? `Guten Tag ${e.ansprechperson},` : "Guten Tag,");
  const wofuer = r.titel ? ` für ${r.titel}` : "";
  const kern = r.art === "angebot"
    ? `anbei unser Angebot ${r.nummer} über ${rg.euro(r.summe)}${wofuer}. Es ist gültig bis ${rg.datumDe(r.faellig)}.`
    : `anbei die ${wort} ${r.nummer} über ${rg.euro(r.summe)}${wofuer}, zahlbar bis ${rg.datumDe(r.faellig)}.`;
  // WhatsApp haengt keine Datei an — entweder es gibt einen Link, oder es wird
  // ehrlich angekuendigt, dass das PDF per Mail kommt.
  const anhang = pdfLink
    ? `Das PDF liegt hier: ${pdfLink}`
    : "Das PDF schicke ich Ihnen gleich per E-Mail.";
  const gruss = `Viele Grüße, ${(user && user.name) || abs.unterschrift || "Lukas Sehorz"} – ${abs.name}`;
  return {
    betreff: "",
    text: `${anrede}\n${kern}\n${anhang}\n\n${gruss}`.slice(0, WA_MAX),
  };
}

const nachname = (name) => {
  const teile = String(name || "").trim().split(/\s+/);
  return teile.length > 1 ? teile[teile.length - 1] : (teile[0] || "");
};

// ------------------------------------------------------------ Nachpruefung
//
// Steht die Nummer drin? Der Betrag? Die Faelligkeit? Beim Betrag und beim
// Datum werden mehrere Schreibweisen anerkannt — "1.250,00 €", "1250,00 €" und
// "1.250 €" sind dieselbe Zahl, und wer eine davon verlangt, verwirft
// brauchbare Texte. "rund 1.200 €" wird nicht anerkannt, und genau darum geht es.
function betragFormen(n) {
  const zahl = Number(n) || 0;
  const mitCent = zahl.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ohneCent = zahl.toLocaleString("de-DE", { maximumFractionDigits: 0 });
  const formen = new Set([mitCent, mitCent.replace(/\./g, ""), rg.euro(zahl)]);
  // "1.250 €" nur, wenn der Betrag glatt ist — bei 1.250,50 waere das falsch.
  if (Math.abs(zahl - Math.round(zahl)) < 0.005) { formen.add(ohneCent); formen.add(ohneCent.replace(/\./g, "")); }
  return [...formen].filter(Boolean);
}
function datumFormen(tag) {
  const t = rg.tagFeld(tag);
  if (!t) return [];
  const [j, m, d] = t.split("-");
  return [...new Set([
    rg.datumDe(t),                    // 20.09.2026
    `${Number(d)}.${Number(m)}.${j}`, // 20.9.2026
    rg.datumLang(t),                  // 20. September 2026
    rg.datumLang(t).replace(/^0/, ""), // 20. September 2026 ohne fuehrende Null
  ])].filter(Boolean);
}

// Liefert die Liste der FEHLENDEN Angaben — leer heisst: der Text taugt.
function fehlendeAngaben(text, r, kanal = "mail") {
  const t = String(text || "");
  const fehlt = [];
  if (r && r.nummer && !t.includes(r.nummer)) fehlt.push("Nummer");
  if (!betragFormen(r && r.summe).some((f) => t.includes(f))) fehlt.push("Betrag");
  const daten = datumFormen(r && r.faellig);
  if (daten.length && !daten.some((f) => t.includes(f))) fehlt.push("Fälligkeit");
  if (kanal === "whatsapp" && t.length > WA_MAX) fehlt.push("Länge");
  return fehlt;
}

// ------------------------------------------------------------ Text bauen
const SCHEMA = {
  name: "nachricht",
  description: "Die Nachricht, mit der der Beleg zum Kunden geht.",
  input_schema: {
    type: "object",
    properties: {
      betreff: { type: "string", description: "Nur bei E-Mail: kurze Betreffzeile mit Belegart, Nummer und Kundenname. Bei WhatsApp leerer Text." },
      text: { type: "string", description: "Der Nachrichtentext, mit Anrede und Grußformel." },
    },
    required: ["betreff", "text"],
  },
};

function anweisung(kanal, r, { user, pdfLink } = {}) {
  const abs = rg.absender(r && r.art);
  const wort = r.art === "angebot" ? "das Angebot" : "die Rechnung";
  const gemeinsam = `Du schreibst die Nachricht, mit der ${wort} ${r.nummer} zum Kunden geht. Absender ist ${abs.name}, unterschrieben wird mit ${(user && user.name) || abs.unterschrift}.

Diese drei Angaben MÜSSEN wörtlich und unverändert in der Nachricht stehen:
· die Nummer ${r.nummer}
· der Betrag ${rg.euro(r.summe)}
· ${r.art === "angebot" ? `das Datum, bis zu dem das Angebot gilt: ${rg.datumDe(r.faellig)}` : `das Zahlungsziel: ${rg.datumDe(r.faellig)}`}

Sonst gilt: kurz, höflich, Sie-Form, keine Floskelketten ("wir würden uns sehr freuen, wenn"), keine Ausrufezeichen, keine Superlative. Erfinde nichts dazu — keine Rabatte, keine Termine, keine Zusagen. Umsatzsteuer wird nirgends erwähnt (Kleinunternehmerregelung).`;

  if (kanal === "whatsapp") {
    return `${gemeinsam}

Das hier ist eine WhatsApp-Nachricht: höchstens ${WA_MAX} Zeichen, vier bis fünf Zeilen, keine Betreffzeile (lass "betreff" leer), keine förmliche Briefanrede ("Sehr geehrter Herr") — im Chat schreibt man "Guten Tag Herr Müller,". ${pdfLink
      ? `Nenne diesen Link auf das PDF wörtlich, in einer eigenen Zeile: ${pdfLink}`
      : "Sag, dass das PDF gleich per E-Mail kommt — an eine WhatsApp-Nachricht lässt sich hier keine Datei hängen."}`;
  }
  return `${gemeinsam}

Das hier ist eine E-Mail. Die Betreffzeile hat die Form "${r.art === "angebot" ? "Angebot" : "Rechnung"} ${r.nummer} – ${(r.empfaenger && r.empfaenger.name) || "Kunde"}". Der Text hat eine förmliche Anrede, zwei bis drei kurze Absätze und die Grußformel "Mit freundlichen Grüßen". Erwähne, dass der Beleg als PDF anhängt.`;
}

// Wirft nie. Liefert { betreff, text, quelle: "modell" | "fest", verworfen }.
// verworfen sagt, WARUM der Modelltext nicht genommen wurde — die Oberflaeche
// zeigt das als leisen Hinweis, damit niemand raetselt, warum der Text nach
// Baukasten klingt.
async function textBauen(user, r, { kanal = "mail", pdfLink = "" } = {}) {
  const k = KANAELE.includes(kanal) ? kanal : "mail";
  const fest = festeFassung(r, { kanal: k, user, pdfLink });
  const modellDa = schnell.verfuegbar() && (process.env.SCHNELL_PROVIDER || "").toLowerCase() === "anthropic";
  if (!modellDa) return { ...fest, quelle: "fest", verworfen: "" };

  let antwort;
  try {
    antwort = await schnell.mitWerkzeugen(
      anweisung(k, r, { user, pdfLink }),
      [
        `Belegart: ${r.art === "angebot" ? "Angebot" : (r.abschlag_von ? "Abschlagsrechnung" : "Rechnung")}`,
        `Nummer: ${r.nummer}`,
        `Kunde: ${(r.empfaenger && r.empfaenger.name) || ""}`,
        r.empfaenger && r.empfaenger.ansprechperson ? `Ansprechperson: ${[r.empfaenger.anrede, r.empfaenger.ansprechperson].filter(Boolean).join(" ")}` : null,
        `Betrag: ${rg.euro(r.summe)}`,
        `${r.art === "angebot" ? "Gültig bis" : "Fällig am"}: ${rg.datumDe(r.faellig)}`,
        r.titel ? `Worum es geht: ${r.titel}` : null,
        (r.positionen || []).length ? `Leistungen:\n${(r.positionen || []).map((p) => `- ${p.titel}`).join("\n")}` : null,
      ].filter(Boolean).join("\n"),
      [SCHEMA],
      { maxTokens: 1200, model: MODELL, timeoutMs: 30000, aufwand: "low", denken: "aus" },
    );
  } catch (fehler) {
    return { ...fest, quelle: "fest", verworfen: `Das Formulieren hat nicht geklappt (${String(fehler.message).slice(0, 120)}).` };
  }

  const auf = (antwort.aufrufe || []).find((a) => a.name === SCHEMA.name);
  if (!auf) return { ...fest, quelle: "fest", verworfen: "Das Modell hat keinen Text zurückgegeben." };

  const text = mehrzeilig(auf.input.text, k === "whatsapp" ? WA_MAX + 200 : 4000);
  const betreff = k === "whatsapp" ? "" : (s(auf.input.betreff, 200) || fest.betreff);
  const fehlt = fehlendeAngaben(text, r, k);
  if (fehlt.length) {
    return { ...fest, quelle: "fest",
      verworfen: `Im vorgeschlagenen Text fehlte: ${fehlt.join(", ")}. Deshalb steht hier die feste Fassung.` };
  }
  // Der Link ist der einzige Weg zum PDF — fehlt er, ist die Nachricht wertlos.
  if (k === "whatsapp" && pdfLink && !text.includes(pdfLink)) {
    return { ...fest, quelle: "fest", verworfen: "Im vorgeschlagenen Text fehlte der Link auf das PDF. Deshalb steht hier die feste Fassung." };
  }
  return { betreff, text, quelle: "modell", verworfen: "" };
}

// ------------------------------------------------------------ PDF-Link
//
// 24 Zufallsbytes als base64url = 32 Zeichen, 192 Bit. Nicht ableitbar aus der
// Rechnungsnummer, nicht durchprobierbar, kein Verzeichnis dahinter.
function schluesselNeu() {
  return crypto.randomBytes(24).toString("base64url");
}

// Legt einen Link an — oder gibt den bestehenden zurueck, solange er noch
// mindestens eine Woche gilt. Sonst entstuende bei jedem Seitenaufruf ein
// neuer Schluessel, und der Kunde haette am Ende zwanzig gueltige Links auf
// dieselbe Rechnung.
async function linkHolen(user, rechnungId, { basis = "" } = {}) {
  if (!user || !/^\d+$/.test(String(rechnungId))) return null;
  try {
    return await crm.alsNutzer(user.id, async (q) => {
      const { rows: [alt] } = await q(
        `select schluessel, to_char(gueltig_bis,'YYYY-MM-DD') as bis from beleg_links
          where rechnung_id = $1 and gueltig_bis > now() + interval '7 days'
          order by gueltig_bis desc limit 1`, [rechnungId]);
      if (alt) return { schluessel: alt.schluessel, gueltig_bis: alt.bis, url: linkUrl(basis, alt.schluessel), neu: false };
      const schluessel = schluesselNeu();
      const { rows: [neu] } = await q(
        `insert into beleg_links (schluessel, rechnung_id, gueltig_bis, erstellt_von)
         values ($1, $2, now() + ($3 || ' days')::interval, $4)
         returning to_char(gueltig_bis,'YYYY-MM-DD') as bis`,
        [schluessel, rechnungId, String(LINK_TAGE), user.id]);
      return { schluessel, gueltig_bis: neu.bis, url: linkUrl(basis, schluessel), neu: true };
    });
  } catch { return null; }
}

// OS_URL gibt es schon (oeffentliche Adresse des OS, siehe .env.beispiel) —
// eine zweite Variable braucht es nur, wenn der Kundenlink bewusst woanders
// hinzeigen soll als die Oberflaeche. Ohne beides baut die Route die Adresse
// aus der Anfrage; im Testlauf ist genau das richtig.
function linkUrl(basis, schluessel) {
  const b = String(basis || process.env.BELEG_LINK_BASIS || process.env.OS_URL || "").replace(/\/+$/, "");
  return `${b}/r/${schluessel}`;
}

// Ohne Anmeldung: der Kunde hat kein Konto. Deshalb crm.system statt alsNutzer —
// der Schluessel IST die Berechtigung, und die Abfrage liefert genau eine Zeile
// oder nichts. Kein Verzeichnis, keine Auflistung, keine Fehlermeldung, die
// verraet, ob es die Rechnung gibt.
async function linkAufloesen(schluessel) {
  const k = String(schluessel || "");
  // Formpruefung vorweg: spart der Datenbank jede Anfrage von Suchmaschinen
  // und Scannern, die auf /r/ irgendetwas probieren.
  if (!/^[A-Za-z0-9_-]{32}$/.test(k)) return { ok: false, grund: "unbekannt" };
  let rows;
  try {
    ({ rows } = await crm.system(
      `select l.rechnung_id, l.gueltig_bis < now() as abgelaufen,
              r.nummer, r.art, r.status, r.empfaenger, r.pdf
         from beleg_links l join rechnungen r on r.id = l.rechnung_id
        where l.schluessel = $1`, [k]));
  } catch { return { ok: false, grund: "fehler" }; }
  const z = rows[0];
  if (!z) return { ok: false, grund: "unbekannt" };
  if (z.abgelaufen) return { ok: false, grund: "abgelaufen" };
  // Ein stornierter Beleg wird nicht mehr ausgeliefert — er gilt nicht mehr.
  if (z.status === "storniert") return { ok: false, grund: "storniert" };
  if (!z.pdf) return { ok: false, grund: "kein-pdf" };
  const name = `${z.nummer || "Beleg"}_${String((z.empfaenger || {}).name || "Kunde").replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, "_").slice(0, 40)}.pdf`;
  return { ok: true, rechnung_id: Number(z.rechnung_id), nummer: z.nummer, daten: z.pdf, name };
}

// ------------------------------------------------------------ Protokoll
async function protokollieren(user, { rechnung_id, kanal, an, abgefangen = false, fehler = "", gesendet = true }) {
  try {
    await crm.alsNutzer(user.id, (q) => q(
      `insert into beleg_versand (rechnung_id, kanal, an, gesendet_am, abgefangen, fehler, erstellt_von)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [rechnung_id, kanal, s(an, 200), gesendet && !abgefangen && !fehler ? new Date() : null,
       Boolean(abgefangen), s(fehler, 400) || null, user.id]));
  } catch (e) {
    // Ein kaputtes Protokoll darf den Versand nicht anhalten — die Nachricht
    // ist dann schon raus, und ein Fehler hier wuerde sie fuer den Nutzer wie
    // gescheitert aussehen lassen.
    console.error("Versandprotokoll:", String(e.message).slice(0, 120));
  }
}

async function protokoll(user, rechnungId) {
  if (!user || !/^\d+$/.test(String(rechnungId))) return [];
  try {
    return await crm.alsNutzer(user.id, async (q) => {
      const { rows } = await q(
        `select id, kanal, an, gesendet_am, abgefangen, fehler, erstellt
           from beleg_versand where rechnung_id = $1 order by erstellt desc limit 50`, [rechnungId]);
      return rows.map((x) => ({ ...x, id: Number(x.id) }));
    });
  } catch { return []; }
}

// ------------------------------------------------------------ Senden
//
// Der Riegel fuer Probelaeufe sitzt NICHT hier, sondern in gmail-direkt.senden
// bzw. whatsapp.senden (ADS_PROBE, lib/probemodus.js) — an der letzten Stelle
// vor dem Netz. Hier wird nur gemeldet, dass er zugeschlagen hat, und das
// Protokoll bekommt seine Zeile: Ein Testmodus, der so tut, als waere alles
// rausgegangen, macht den Test wertlos.
async function senden(user, r, { kanal = "mail", an = "", betreff = "", text = "", modus = "senden" } = {}) {
  const k = KANAELE.includes(kanal) ? kanal : "mail";
  const m = MODI.includes(modus) ? modus : "senden";
  const probemodus = require("./probemodus.js");
  if (!r) return { ok: false, grund: "nicht-gefunden" };
  if (r.status === "storniert") return { ok: false, grund: "storniert" };
  if (r.status === "entwurf") return { ok: false, grund: "entwurf" };
  const koerper = mehrzeilig(text, 20000);
  if (!koerper) return { ok: false, grund: "text" };

  if (k === "whatsapp") {
    if (m === "entwurf") return { ok: false, grund: "kein-whatsapp-entwurf" };
    const nummer = nummerPutzen(an);
    if (!nummer) return { ok: false, grund: "nummer" };
    const wa = require("./whatsapp.js");
    try {
      const erg = await wa.senden({ an: nummer, text: koerper.slice(0, WA_MAX + 300) });
      // Die Bruecke meldet den Probemodus als "probe", Gmail als "abgefangen" —
      // beide Schreibweisen werden hier abgefangen, damit die Oberflaeche eine
      // einzige Meldung kennt.
      const abgefangen = Boolean(erg && (erg.probe || erg.abgefangen)) || probemodus.aktiv();
      if (!erg || erg.ok === false) {
        await protokollieren(user, { rechnung_id: r.id, kanal: k, an: nummer, fehler: "Die WhatsApp-Brücke hat die Nachricht abgelehnt." });
        return { ok: false, grund: "versand", hint: "Die WhatsApp-Brücke hat die Nachricht abgelehnt." };
      }
      await protokollieren(user, { rechnung_id: r.id, kanal: k, an: nummer, abgefangen });
      if (!abgefangen) await versendetVermerken(user, r.id, nummer);
      return { ok: true, abgefangen, an: nummer, nummer: r.nummer };
    } catch (e) {
      const hint = String(e.message).slice(0, 140);
      await protokollieren(user, { rechnung_id: r.id, kanal: k, an: nummer, fehler: hint });
      return { ok: false, grund: "versand", hint };
    }
  }

  // --- Mail
  const adresse = s(an, 160);
  if (!MAIL_MUSTER.test(adresse)) return { ok: false, grund: "mail" };
  const gmail = require("./gmail-direkt.js");
  if (!probemodus.aktiv() && !gmail.bereit()) return { ok: false, grund: "kein-mailzugang" };
  let datei;
  try { datei = await rg.pdfHolen(user, r.id); } catch { datei = null; }
  if (!datei || !datei.daten) return { ok: false, grund: "kein-pdf" };
  const abs = rg.absender(r.art);
  try {
    const erg = await (m === "entwurf" ? gmail.entwurf : gmail.senden)({
      an: adresse, betreff: s(betreff, 200) || festeFassung(r, { kanal: "mail", user }).betreff,
      text: koerper, absender: abs.mailAbsender,
      anhaenge: [{ name: datei.name, typ: "application/pdf", daten: datei.daten }],
    });
    const abgefangen = Boolean(erg && erg.abgefangen) || probemodus.aktiv();
    await protokollieren(user, { rechnung_id: r.id, kanal: m === "entwurf" ? "mail-entwurf" : "mail",
      an: adresse, abgefangen, gesendet: m !== "entwurf" });
    // Ein Gmail-Entwurf ist NICHT versendet — das Feld bleibt leer, sonst
    // stuende auf der Vorgangsseite "verschickt", waehrend die Mail noch im
    // Entwurfsordner liegt.
    if (!abgefangen && m !== "entwurf") await versendetVermerken(user, r.id, adresse);
    return { ok: true, abgefangen, an: adresse, nummer: r.nummer, modus: m, anhang: datei.name };
  } catch (e) {
    const hint = String(e.message).slice(0, 140);
    await protokollieren(user, { rechnung_id: r.id, kanal: k, an: adresse, fehler: hint });
    return { ok: false, grund: "versand", hint };
  }
}

// versendet_am/versendet_an sind Spalten von Agent D1 (0060) und werden dort
// gelesen. Geschrieben werden sie hier, weil rechnungen.versenden() den
// eigenen, festen Text nimmt und diesen hier nicht kennt.
async function versendetVermerken(user, id, an) {
  try {
    await crm.alsNutzer(user.id, (q) => q(
      `update rechnungen set versendet_am = now(), versendet_an = $2 where id = $1`, [id, s(an, 200)]));
  } catch (e) { console.error("versendet_am:", String(e.message).slice(0, 120)); }
}

module.exports = {
  // Reine Funktionen (testbar ohne Datenbank, ohne Netz)
  KANAELE, MODI, WA_MAX, LINK_TAGE, MODELL, SCHEMA,
  festeFassung, fehlendeAngaben, betragFormen, datumFormen, anweisung,
  schluesselNeu, linkUrl, nummerPutzen, mailVorschlag, whatsappVorschlag, nachname,
  // Mit Modell / Datenbank / Netz
  textBauen, linkHolen, linkAufloesen, protokollieren, protokoll, senden,
};
