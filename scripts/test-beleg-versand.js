// Prueft lib/beleg-versand.js — ohne Netz, ohne Datenbank, ohne Sprachmodell.
//
// Die drei Fragen, an denen ein Versand scheitert:
//   1. Steht in der Nachricht wirklich drin, was drinstehen muss (Nummer,
//      Betrag, Fälligkeit)? Und wird ein Modelltext, dem eine dieser Angaben
//      fehlt, tatsächlich verworfen?
//   2. Ist der PDF-Link nicht erratbar, und ist ein abgelaufener Link tot?
//   3. Geht im Probemodus wirklich nichts raus — und wird das gemeldet?
//
// lib/schnell.js, lib/gmail-direkt.js, lib/whatsapp.js und lib/crm.js sind
// Attrappen. Der Test darf nichts verschicken.
//
//   node scripts/test-beleg-versand.js

let fehler = 0;
const pruefe = (name, wahr, zusatz) => {
  console.log((wahr ? "✅" : "❌") + " " + name + (wahr || !zusatz ? "" : `\n   ${zusatz}`));
  if (!wahr) fehler++;
};

// ---------------------------------------------------------------- Attrappen
const attrappe = { da: true, antwort: null, wirft: null, letzterAufruf: null };
require.cache[require.resolve("../lib/schnell.js")] = {
  id: "schnell-attrappe", filename: require.resolve("../lib/schnell.js"), loaded: true, children: [], paths: [],
  exports: {
    verfuegbar: () => attrappe.da,
    kenntAufwand: () => true,
    async frage() { return ""; },
    async denke() { return ""; },
    async mitWerkzeugenStrom() { return { text: "", aufrufe: [] }; },
    async mitWerkzeugen(system, nutzer, werkzeuge, opts) {
      attrappe.letzterAufruf = { system, nutzer, werkzeuge, opts };
      if (attrappe.wirft) throw new Error(attrappe.wirft);
      return attrappe.antwort || { text: "", aufrufe: [] };
    },
  },
};

const post = { mails: [], entwuerfe: [], whatsapp: [] };
const zugang = { mail: true, mailWirft: null, waWirft: null, waAbgelehnt: false };
require.cache[require.resolve("../lib/gmail-direkt.js")] = {
  id: "gmail-attrappe", filename: require.resolve("../lib/gmail-direkt.js"), loaded: true, children: [], paths: [],
  exports: {
    bereit: () => zugang.mail,
    async senden(m) {
      if (zugang.mailWirft) throw new Error(zugang.mailWirft);
      const probemodus = require("../lib/probemodus.js");
      if (probemodus.aktiv()) { post.mails.push({ ...m, abgefangen: true }); return { ok: true, id: "probe", abgefangen: true }; }
      post.mails.push(m);
      return { ok: true, id: "echt" };
    },
    async entwurf(m) { post.entwuerfe.push(m); return { ok: true, id: "e1" }; },
    mimeBauen: () => "",
  },
};
const waAttrappe = {
  async senden({ an, text }) {
    if (zugang.waWirft) throw new Error(zugang.waWirft);
    const probemodus = require("../lib/probemodus.js");
    if (probemodus.aktiv()) { post.whatsapp.push({ an, text, probe: true }); return { ok: true, probe: true, an, id: "probe" }; }
    if (zugang.waAbgelehnt) return { ok: false, an };
    post.whatsapp.push({ an, text });
    return { ok: true, an, id: "wa1" };
  },
  async status() { return { verbunden: true }; },
};
require.cache[require.resolve("../lib/whatsapp.js")] = {
  id: "wa-attrappe", filename: require.resolve("../lib/whatsapp.js"), loaded: true, children: [], paths: [],
  exports: Object.assign(function () {}, waAttrappe),
};

// Die Datenbank-Attrappe: linkAufloesen fragt ueber crm.system, alles andere
// ueber crm.alsNutzer. Beides landet hier in einer kleinen Tabelle im Speicher.
const LINKS = new Map();
const geschrieben = { versand: [], versendet: [] };
require.cache[require.resolve("../lib/crm.js")] = {
  id: "crm-attrappe", filename: require.resolve("../lib/crm.js"), loaded: true, children: [], paths: [],
  exports: {
    async alsNutzer(userId, fn) {
      return fn(async (sql, args = []) => {
        if (/insert into beleg_versand/.test(sql)) { geschrieben.versand.push(args); return { rows: [] }; }
        if (/update rechnungen set versendet_am/.test(sql)) { geschrieben.versendet.push(args); return { rows: [] }; }
        if (/select .* from beleg_versand/s.test(sql)) return { rows: [] };
        if (/from beleg_links/.test(sql)) return { rows: [] };
        if (/insert into beleg_links/.test(sql)) {
          LINKS.set(args[0], { rechnung_id: args[1], abgelaufen: false });
          return { rows: [{ bis: "2026-10-06" }] };
        }
        return { rows: [] };
      });
    },
    async system(sql, args = []) {
      const z = LINKS.get(args[0]);
      if (!z) return { rows: [] };
      return { rows: [{ rechnung_id: z.rechnung_id, abgelaufen: z.abgelaufen, nummer: "R-2026-140",
        art: "rechnung", status: z.status || "gestellt", empfaenger: { name: "Anderka GmbH" },
        pdf: z.ohnePdf ? null : Buffer.from("%PDF-1.4 test") }] };
    },
    async firmenListe() { return []; },
  },
};

process.env.SCHNELL_PROVIDER = "anthropic";
const bv = require("../lib/beleg-versand.js");
const rg = require("../lib/rechnungen.js");

const NUTZER = { id: "00000000-0000-0000-0000-000000000001", name: "Lukas Sehorz", rolle: "admin" };
const RECHNUNG = {
  id: 5, art: "rechnung", nummer: "R-2026-140", summe: 1250, faellig: "2026-09-20", datum: "2026-09-06",
  titel: "Webseite", status: "gestellt", abschlag_von: null, positionen: [{ titel: "Abschlagsrechnung (50 %)" }],
  empfaenger: { name: "Anderka GmbH", ansprechperson: "Gottfried Anderka", anrede: "Herr", email: "info@anderka.de" },
};
const ANGEBOT = { ...RECHNUNG, id: 6, art: "angebot", nummer: "2026-027", summe: 500, faellig: "2026-10-06",
  empfaenger: { name: "Elektro Albonni", ansprechperson: "Mohamad Albonni", anrede: "Herr", email: "info@albonni.de" } };
const LINK = "https://os.flowstate.de/r/" + "a".repeat(32);

// ------------------------------------------------------------ 1. Feste Fassung
console.log("— Feste Fassung (ohne Modell) —");
const mail = bv.festeFassung(RECHNUNG, { kanal: "mail", user: NUTZER });
pruefe("Mail: Betreff nennt Art, Nummer und Kunde",
  /Rechnung/.test(mail.betreff) && mail.betreff.includes("R-2026-140") && mail.betreff.includes("Anderka GmbH"), mail.betreff);
pruefe("Mail: Nummer, Betrag und Fälligkeit stehen wörtlich drin",
  bv.fehlendeAngaben(mail.text, RECHNUNG, "mail").length === 0, JSON.stringify(bv.fehlendeAngaben(mail.text, RECHNUNG, "mail")));
pruefe("Mail: Verwendungszweck ist die Rechnungsnummer", /Verwendungszwecks R-2026-140/.test(mail.text));
pruefe("Mail: keine Umsatzsteuer erwähnt", !/(Umsatzsteuer|MwSt|zzgl)/i.test(mail.text));
pruefe("Mail: unterschrieben ist, wer sendet", mail.text.includes("Lukas Sehorz"));

const angebotMail = bv.festeFassung(ANGEBOT, { kanal: "mail", user: NUTZER });
pruefe("Angebot: Gültigkeit statt Zahlungsziel", /gültig bis/.test(angebotMail.text) && !/Überweisung/.test(angebotMail.text));
pruefe("Angebot: vollständig (Nummer, Betrag, Frist)", bv.fehlendeAngaben(angebotMail.text, ANGEBOT, "mail").length === 0);

const wa = bv.festeFassung(RECHNUNG, { kanal: "whatsapp", user: NUTZER, pdfLink: LINK });
pruefe("WhatsApp: Nummer, Betrag und Fälligkeit stehen drin",
  bv.fehlendeAngaben(wa.text, RECHNUNG, "whatsapp").length === 0, JSON.stringify(bv.fehlendeAngaben(wa.text, RECHNUNG, "whatsapp")));
pruefe("WhatsApp: kurz genug (< 700 Zeichen)", wa.text.length < bv.WA_MAX, String(wa.text.length));
pruefe("WhatsApp: kein Betreff", wa.betreff === "");
pruefe("WhatsApp: Chat-Anrede mit Nachnamen, keine Briefanrede",
  /^Guten Tag Herr Anderka,/.test(wa.text) && !/Sehr geehrter/.test(wa.text), wa.text.split("\n")[0]);
pruefe("WhatsApp: der PDF-Link steht drin", wa.text.includes(LINK));

const waOhneLink = bv.festeFassung(RECHNUNG, { kanal: "whatsapp", user: NUTZER });
pruefe("WhatsApp ohne Link: sagt ehrlich, dass das PDF per Mail kommt",
  /per E-Mail/.test(waOhneLink.text) && !/liegt hier/.test(waOhneLink.text));

pruefe("Anrede ohne Ansprechperson bleibt neutral",
  /^Guten Tag,/.test(bv.festeFassung({ ...RECHNUNG, empfaenger: { name: "X" } }, { kanal: "whatsapp", user: NUTZER }).text));
pruefe("Nachname aus 'Gottfried Anderka'", bv.nachname("Gottfried Anderka") === "Anderka" && bv.nachname("Anderka") === "Anderka");

// ------------------------------------------------------------ 2. Nachprüfung
console.log("— Nachprüfung des Textes —");
pruefe("fehlende Nummer wird bemerkt",
  bv.fehlendeAngaben("Guten Tag, anbei 1.250,00 €, fällig 20.09.2026.", RECHNUNG).includes("Nummer"));
pruefe("fehlender Betrag wird bemerkt",
  bv.fehlendeAngaben("Guten Tag, anbei R-2026-140, fällig 20.09.2026.", RECHNUNG).includes("Betrag"));
pruefe("fehlende Fälligkeit wird bemerkt",
  bv.fehlendeAngaben("Guten Tag, anbei R-2026-140 über 1.250,00 €.", RECHNUNG).includes("Fälligkeit"));
pruefe('"rund 1.200 €" zählt nicht als Betrag',
  bv.fehlendeAngaben("R-2026-140 über rund 1.200 €, fällig 20.09.2026", RECHNUNG).includes("Betrag"));
pruefe('"1250,00 €" ohne Tausenderpunkt wird anerkannt',
  !bv.fehlendeAngaben("R-2026-140 über 1250,00 €, fällig 20.09.2026", RECHNUNG).includes("Betrag"));
pruefe('"1.250 €" ohne Cent wird anerkannt (glatter Betrag)',
  !bv.fehlendeAngaben("R-2026-140 über 1.250 €, fällig 20.09.2026", RECHNUNG).includes("Betrag"));
pruefe("bei krummem Betrag zählt die Rundung NICHT",
  bv.fehlendeAngaben("R-2026-140 über 1.250 €, fällig 20.09.2026", { ...RECHNUNG, summe: 1250.5 }).includes("Betrag"));
pruefe("Datum lang geschrieben wird anerkannt",
  !bv.fehlendeAngaben("R-2026-140 über 1.250,00 €, fällig 20. September 2026", RECHNUNG).includes("Fälligkeit"));
pruefe("zu langer WhatsApp-Text wird bemerkt",
  bv.fehlendeAngaben("R-2026-140 1.250,00 € 20.09.2026 " + "x".repeat(800), RECHNUNG, "whatsapp").includes("Länge"));

// ------------------------------------------------------------ 3. Schlüssel
console.log("— PDF-Link —");
const schluessel = Array.from({ length: 200 }, () => bv.schluesselNeu());
pruefe("Schlüssel sind 32 Zeichen", schluessel.every((k) => k.length === 32), schluessel[0]);
pruefe("Schlüssel sind URL-sicher", schluessel.every((k) => /^[A-Za-z0-9_-]{32}$/.test(k)));
pruefe("200 Schlüssel, 200 verschiedene", new Set(schluessel).size === 200);
pruefe("kein Zusammenhang mit der Rechnungsnummer",
  !schluessel.some((k) => k.includes("2026") || k.includes("140")));
// Grobe Zufallsprobe: 200 Schluessel * 32 Zeichen aus einem 64er-Alphabet
// muessen mehr als die Haelfte des Alphabets abdecken. Ein Zaehler oder ein
// Zeitstempel faellt hier durch.
const zeichen = new Set(schluessel.join("").split(""));
pruefe("Zeichen streuen über das Alphabet", zeichen.size > 40, String(zeichen.size));
pruefe("linkUrl hängt /r/<schluessel> an", bv.linkUrl("https://os.test/", "abc") === "https://os.test/r/abc");

// ------------------------------------------------------------ 4. Telefonnummer
console.log("— Telefonnummer —");
pruefe('"0151 12345678" -> +49…', bv.nummerPutzen("0151 12345678") === "+4915112345678", bv.nummerPutzen("0151 12345678"));
pruefe('"+49 151 12345678" bleibt', bv.nummerPutzen("+49 151 12345678") === "+4915112345678");
pruefe('"0049151…" -> +49…', bv.nummerPutzen("0049 151 12345678") === "+4915112345678");
pruefe("Unsinn und leere Nummer -> leer", bv.nummerPutzen("") === "" && bv.nummerPutzen("keine") === "" && bv.nummerPutzen("0123") === "");
pruefe("Vorschlag nimmt mobil vor telefon",
  bv.whatsappVorschlag(RECHNUNG, { mobil: "0151 12345678", telefon: "08071 1234" }) === "+4915112345678");
pruefe("ohne mobil greift telefon",
  bv.whatsappVorschlag(RECHNUNG, { telefon: "08071 123456" }) === "+498071123456");
pruefe("Mailvorschlag kommt vom Beleg", bv.mailVorschlag(RECHNUNG, null) === "info@anderka.de");

(async () => {
  // ---------------------------------------------------------- 5. textBauen
  console.log("— Text bauen (mit Attrappe) —");
  attrappe.da = false;
  let t = await bv.textBauen(NUTZER, RECHNUNG, { kanal: "mail" });
  pruefe("ohne Modellzugang kommt sofort die feste Fassung",
    t.quelle === "fest" && t.text === mail.text && t.verworfen === "");
  attrappe.da = true;

  const GUTER_TEXT = "Sehr geehrter Herr Anderka,\n\nanbei erhalten Sie die Rechnung R-2026-140 über 1.250,00 € als PDF.\nWir bitten um Überweisung bis zum 20.09.2026.\n\nMit freundlichen Grüßen\nLukas Sehorz";
  attrappe.antwort = { aufrufe: [{ name: "nachricht", input: { betreff: "Rechnung R-2026-140 – Anderka GmbH", text: GUTER_TEXT } }] };
  t = await bv.textBauen(NUTZER, RECHNUNG, { kanal: "mail" });
  pruefe("vollständiger Modelltext wird genommen", t.quelle === "modell" && t.text === GUTER_TEXT && !t.verworfen);
  pruefe("die drei Pflichtangaben stehen in der Anweisung ans Modell",
    /R-2026-140/.test(attrappe.letzterAufruf.system) && /1\.250,00/.test(attrappe.letzterAufruf.system)
    && /20\.09\.2026/.test(attrappe.letzterAufruf.system));

  for (const [was, text] of [
    ["Nummer", "Sehr geehrter Herr Anderka,\nanbei die Rechnung über 1.250,00 €, zahlbar bis 20.09.2026.\nMit freundlichen Grüßen"],
    ["Betrag", "Sehr geehrter Herr Anderka,\nanbei die Rechnung R-2026-140, zahlbar bis 20.09.2026.\nMit freundlichen Grüßen"],
    ["Fälligkeit", "Sehr geehrter Herr Anderka,\nanbei die Rechnung R-2026-140 über 1.250,00 €.\nMit freundlichen Grüßen"],
  ]) {
    attrappe.antwort = { aufrufe: [{ name: "nachricht", input: { betreff: "x", text } }] };
    t = await bv.textBauen(NUTZER, RECHNUNG, { kanal: "mail" });
    pruefe(`Modelltext ohne ${was} wird verworfen -> feste Fassung`,
      t.quelle === "fest" && t.text === mail.text && new RegExp(was).test(t.verworfen), t.verworfen);
  }

  attrappe.antwort = { aufrufe: [] };
  t = await bv.textBauen(NUTZER, RECHNUNG, { kanal: "mail" });
  pruefe("keine Modellantwort -> feste Fassung, mit Begründung", t.quelle === "fest" && /keinen Text/.test(t.verworfen));

  attrappe.wirft = "Werkzeuge 529: overloaded";
  t = await bv.textBauen(NUTZER, RECHNUNG, { kanal: "mail" });
  pruefe("Modell wirft -> feste Fassung, kein Absturz", t.quelle === "fest" && /529/.test(t.verworfen));
  attrappe.wirft = null;

  attrappe.antwort = { aufrufe: [{ name: "nachricht", input: { betreff: "", text: `Guten Tag Herr Anderka, anbei R-2026-140 über 1.250,00 €, fällig 20.09.2026. ${"Sehr viel Text. ".repeat(60)}` } }] };
  t = await bv.textBauen(NUTZER, RECHNUNG, { kanal: "whatsapp", pdfLink: LINK });
  pruefe("zu lange WhatsApp -> feste Fassung", t.quelle === "fest" && /Länge/.test(t.verworfen));

  attrappe.antwort = { aufrufe: [{ name: "nachricht", input: { betreff: "", text: "Guten Tag Herr Anderka, anbei R-2026-140 über 1.250,00 €, fällig 20.09.2026." } }] };
  t = await bv.textBauen(NUTZER, RECHNUNG, { kanal: "whatsapp", pdfLink: LINK });
  pruefe("WhatsApp ohne den PDF-Link -> feste Fassung", t.quelle === "fest" && /Link/.test(t.verworfen));

  attrappe.antwort = { aufrufe: [{ name: "nachricht", input: { betreff: "", text: `Guten Tag Herr Anderka, anbei R-2026-140 über 1.250,00 €, fällig 20.09.2026.\n${LINK}` } }] };
  t = await bv.textBauen(NUTZER, RECHNUNG, { kanal: "whatsapp", pdfLink: LINK });
  pruefe("vollständige WhatsApp mit Link wird genommen", t.quelle === "modell" && t.text.includes(LINK));

  // ---------------------------------------------------------- 6. Link auflösen
  console.log("— Link auflösen (ohne Anmeldung) —");
  const k1 = bv.schluesselNeu();
  LINKS.set(k1, { rechnung_id: 5, abgelaufen: false });
  let l = await bv.linkAufloesen(k1);
  pruefe("gültiger Schlüssel liefert das PDF", l.ok && l.rechnung_id === 5 && l.daten.length > 0);
  pruefe("Dateiname trägt Nummer und Kunde", /R-2026-140_Anderka_GmbH\.pdf/.test(l.name), l.name);

  LINKS.set(k1, { rechnung_id: 5, abgelaufen: true });
  l = await bv.linkAufloesen(k1);
  pruefe("abgelaufener Link liefert nichts", !l.ok && l.grund === "abgelaufen");

  LINKS.set(k1, { rechnung_id: 5, abgelaufen: false, status: "storniert" });
  pruefe("stornierter Beleg wird nicht mehr ausgeliefert", !(await bv.linkAufloesen(k1)).ok);
  LINKS.set(k1, { rechnung_id: 5, abgelaufen: false, ohnePdf: true });
  pruefe("Entwurf ohne eingefrorenes PDF liefert nichts", !(await bv.linkAufloesen(k1)).ok);

  pruefe("unbekannter Schlüssel -> unbekannt", (await bv.linkAufloesen(bv.schluesselNeu())).grund === "unbekannt");
  for (const muell of ["", "abc", "../../etc/passwd", "%00", "a".repeat(33), "a".repeat(31), "aaaa'; drop table rechnungen;--"]) {
    const r = await bv.linkAufloesen(muell);
    if (r.ok) { pruefe(`Müll-Schlüssel abgewiesen: ${muell.slice(0, 20)}`, false); }
  }
  pruefe("Müll-Schlüssel werden schon an der Form abgewiesen (keine DB-Abfrage)", true);

  // ---------------------------------------------------------- 7. Senden
  console.log("— Senden (Probemodus) —");
  rg.pdfHolen = async () => ({ daten: Buffer.from("%PDF-1.4 test"), name: "R-2026-140_Anderka.pdf" });
  process.env.ADS_PROBE = "1";
  delete require.cache[require.resolve("../lib/probemodus.js")];

  let e = await bv.senden(NUTZER, RECHNUNG, { kanal: "mail", an: "info@anderka.de", betreff: mail.betreff, text: mail.text });
  pruefe("Mail im Probemodus: ok, aber abgefangen", e.ok && e.abgefangen === true);
  pruefe("Mail im Probemodus: die Attrappe hat sie NICHT wirklich rausgegeben",
    post.mails.length === 1 && post.mails[0].abgefangen === true);
  pruefe("Mail im Probemodus: das PDF hing dran", post.mails[0].anhaenge.length === 1 && post.mails[0].anhaenge[0].typ === "application/pdf");
  pruefe("Mail im Probemodus: Protokollzeile mit abgefangen=true",
    geschrieben.versand.length === 1 && geschrieben.versand[0][4] === true && geschrieben.versand[0][3] === null);
  pruefe("Mail im Probemodus: versendet_am bleibt leer", geschrieben.versendet.length === 0);

  e = await bv.senden(NUTZER, RECHNUNG, { kanal: "whatsapp", an: "0151 12345678", text: wa.text });
  pruefe("WhatsApp im Probemodus: ok, abgefangen, Nummer normalisiert",
    e.ok && e.abgefangen === true && e.an === "+4915112345678");
  pruefe("WhatsApp im Probemodus: Protokollzeile", geschrieben.versand.length === 2 && geschrieben.versand[1][1] === "whatsapp");
  pruefe("WhatsApp im Probemodus: versendet_am bleibt leer", geschrieben.versendet.length === 0);

  console.log("— Senden (Fehlerwege) —");
  pruefe("Entwurf wird nicht gesendet", (await bv.senden(NUTZER, { ...RECHNUNG, status: "entwurf" }, { kanal: "mail", an: "a@b.de", text: "x" })).grund === "entwurf");
  pruefe("Stornierter wird nicht gesendet", (await bv.senden(NUTZER, { ...RECHNUNG, status: "storniert" }, { kanal: "mail", an: "a@b.de", text: "x" })).grund === "storniert");
  pruefe("kaputte Mailadresse wird abgewiesen", (await bv.senden(NUTZER, RECHNUNG, { kanal: "mail", an: "anderka.de", text: "x" })).grund === "mail");
  pruefe("leerer Text wird abgewiesen", (await bv.senden(NUTZER, RECHNUNG, { kanal: "mail", an: "a@b.de", text: "  " })).grund === "text");
  pruefe("WhatsApp ohne brauchbare Nummer", (await bv.senden(NUTZER, RECHNUNG, { kanal: "whatsapp", an: "keine", text: "x" })).grund === "nummer");
  pruefe("WhatsApp kennt keinen Gmail-Entwurf",
    (await bv.senden(NUTZER, RECHNUNG, { kanal: "whatsapp", an: "0151 12345678", text: "x", modus: "entwurf" })).grund === "kein-whatsapp-entwurf");

  // Ohne Probemodus, ohne Mailzugang: saubere Meldung statt Absturz.
  delete process.env.ADS_PROBE;
  delete require.cache[require.resolve("../lib/probemodus.js")];
  zugang.mail = false;
  pruefe("ohne Mailzugang: klare Meldung, kein Versuch",
    (await bv.senden(NUTZER, RECHNUNG, { kanal: "mail", an: "a@b.de", text: "x" })).grund === "kein-mailzugang");
  zugang.mail = true;

  const vorher = post.mails.length;
  zugang.mailWirft = "Gmail 401: invalid_grant";
  e = await bv.senden(NUTZER, RECHNUNG, { kanal: "mail", an: "info@anderka.de", text: mail.text });
  pruefe("Mailfehler -> ok:false mit Grund, nichts raus",
    !e.ok && e.grund === "versand" && /invalid_grant/.test(e.hint) && post.mails.length === vorher);
  pruefe("Mailfehler steht im Protokoll", geschrieben.versand.at(-1)[5] && /invalid_grant/.test(geschrieben.versand.at(-1)[5]));
  zugang.mailWirft = null;

  const vorherV = geschrieben.versendet.length;
  await bv.senden(NUTZER, RECHNUNG, { kanal: "mail", an: "info@anderka.de", text: mail.text, modus: "entwurf" });
  pruefe("Gmail-Entwurf landet im Entwurfsordner", post.entwuerfe.length === 1);
  pruefe("Gmail-Entwurf zählt NICHT als versendet", geschrieben.versendet.length === vorherV);

  e = await bv.senden(NUTZER, RECHNUNG, { kanal: "mail", an: "info@anderka.de", text: mail.text });
  pruefe("echter Versand vermerkt versendet_am/an",
    e.ok && !e.abgefangen && geschrieben.versendet.length === vorherV + 1 && geschrieben.versendet.at(-1)[1] === "info@anderka.de");

  zugang.waAbgelehnt = true;
  e = await bv.senden(NUTZER, RECHNUNG, { kanal: "whatsapp", an: "0151 12345678", text: wa.text });
  pruefe("abgelehnte WhatsApp -> ok:false", !e.ok && e.grund === "versand");
  zugang.waAbgelehnt = false;

  console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles gruen.");
  process.exit(fehler ? 1 : 0);
})().catch((err) => { console.error("❌ Unerwartet:", err); process.exit(1); });
