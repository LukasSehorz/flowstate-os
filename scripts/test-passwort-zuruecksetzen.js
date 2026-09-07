#!/usr/bin/env node
// Prueft "Passwort vergessen" OHNE Datenbank und ohne Netz: die Regeln, an
// denen die Sicherheit haengt. Der Weg mit echter Datenbank steht in
// scripts/test-passwort-db.js.
const path = require("path");
const M = path.join(__dirname, "..", "lib", "passwort-zuruecksetzen.js");

let fehler = 0;
const pruefe = (name, gut, info) => {
  console.log((gut ? "✅ " : "❌ ") + name + (info ? "   " + info : ""));
  if (!gut) fehler++;
};

// --- Attrappen: crm und gmail-direkt werden ersetzt, BEVOR das Modul laedt.
const crmPfad = require.resolve(path.join(__dirname, "..", "lib", "crm.js"));
const mailPfad = require.resolve(path.join(__dirname, "..", "lib", "gmail-direkt.js"));
let abfragen = [];      // alles, was an die Datenbank ginge
let mails = [];         // alles, was rausginge
let zeilen = [];        // was "in der Tabelle steht"
let geaendert = [];     // welche Passwoerter gesetzt wurden
let mailAntwort = { ok: true };

require.cache[crmPfad] = { id: crmPfad, filename: crmPfad, loaded: true, exports: {
  system: async (sql, args) => {
    abfragen.push({ sql: sql.replace(/\s+/g, " ").trim(), args });
    if (/from auth\.users u join public\.profiles/.test(sql) && /lower\(u\.email\)/.test(sql))
      return { rows: zeilen.filter((z) => z.email.toLowerCase() === String(args[0]).toLowerCase()) };
    if (/count\(\*\)/.test(sql)) return { rows: [{ n: zeilen.anfragen || 0 }] };
    if (/from public\.passwort_zuruecksetzen z/.test(sql))
      return { rows: (zeilen.schluessel || []).filter((z) => z.schluessel_abdruck === args[0]) };
    if (/^update public\.passwort_zuruecksetzen set benutzt_am/.test(sql.trim()))
      return { rowCount: zeilen.einloesbar === false ? 0 : 1 };
    return { rows: [], rowCount: 0 };
  },
  passwortAendern: async (id, neu) => { geaendert.push({ id, neu }); },
} };
require.cache[mailPfad] = { id: mailPfad, filename: mailPfad, loaded: true, exports: {
  senden: async (m) => { mails.push(m); return mailAntwort; },
} };

const pwz = require(M);
const zuruecksetzen = () => { abfragen = []; mails = []; geaendert = []; zeilen = []; mailAntwort = { ok: true }; };
const konto = (ueber = {}) => Object.assign(
  { id: "u-1", email: "ioannis@svhconsult.de", name: "Ioannis Tsimeridis", aktiv: true }, ueber);

(async () => {
  // ---------------------------------------------------- Der Schluessel selbst
  const a = pwz.schluesselBauen(), b = pwz.schluesselBauen();
  pruefe("Schluessel sind lang genug", a.length >= 40, a.length + " Zeichen");
  pruefe("Schluessel wiederholen sich nicht", a !== b);
  pruefe("Schluessel passt in eine Adresszeile", a === encodeURIComponent(a));
  pruefe("Abdruck ist nicht der Schluessel", pwz.abdruck(a) !== a && pwz.abdruck(a).length === 64);
  pruefe("Gleicher Schluessel, gleicher Abdruck", pwz.abdruck(a) === pwz.abdruck(a));

  // ---------------------------------------------------- Anfordern
  zuruecksetzen(); zeilen = [konto()];
  let r = await pwz.anfordern("ioannis@svhconsult.de", { basisUrl: "https://os.example" });
  pruefe("Anfrage nimmt an", r.ok && r.gesendet);
  pruefe("Genau eine Mail, an die richtige Adresse", mails.length === 1 && mails[0].an === "ioannis@svhconsult.de");
  const url = (mails[0].text.match(/https:\/\/\S+/) || [""])[0];
  pruefe("Mail traegt den Link", /^https:\/\/os\.example\/passwort-neu\?schluessel=/.test(url), url.slice(0, 46) + "…");
  const inMail = decodeURIComponent(url.split("schluessel=")[1] || "");
  const gemerkt = (abfragen.find((q) => /^insert into public\.passwort_zuruecksetzen/.test(q.sql)) || {}).args || [];
  pruefe("Gemerkt wird der ABDRUCK, nie der Schluessel",
    gemerkt[1] === pwz.abdruck(inMail) && !JSON.stringify(abfragen).includes(inMail));
  pruefe("Aeltere offene Schluessel verfallen",
    abfragen.some((q) => /update public\.passwort_zuruecksetzen set benutzt_am/.test(q.sql) && /benutzt_am is null/.test(q.sql)));
  pruefe("Gueltigkeit eine Stunde", pwz.GUELTIG_MINUTEN === 60 && gemerkt[2] === "60");

  // ---------------------------------------------------- Was NICHT passieren darf
  zuruecksetzen(); zeilen = [];
  r = await pwz.anfordern("gibtesnicht@svhconsult.de");
  pruefe("Unbekannte Adresse: gleiche Antwort, keine Mail", r.ok === true && !r.gesendet && mails.length === 0);

  zuruecksetzen(); zeilen = [konto({ aktiv: false })];
  r = await pwz.anfordern("ioannis@svhconsult.de");
  pruefe("Stillgelegtes Konto bekommt keinen Link", r.ok === true && !r.gesendet && mails.length === 0);

  zuruecksetzen(); zeilen = [konto()]; zeilen.anfragen = pwz.MAX_JE_STUNDE;
  r = await pwz.anfordern("ioannis@svhconsult.de");
  pruefe("Vierte Anfrage in einer Stunde wird nicht geschickt", !r.gesendet && r.grund === "zu-oft");

  zuruecksetzen(); zeilen = [konto()]; mailAntwort = { ok: false, hint: "kein Zugang" };
  r = await pwz.anfordern("ioannis@svhconsult.de");
  pruefe("Mail scheitert: Antwort bleibt gleich, kein Absturz", r.ok === true && !r.gesendet && r.grund === "mail");

  zuruecksetzen();
  r = await pwz.anfordern("keine-adresse");
  pruefe("Kein @ in der Eingabe: nichts passiert", r.ok === true && !r.gesendet && abfragen.length === 0);

  // ---------------------------------------------------- Einloesen
  const guter = pwz.schluesselBauen();
  const eintrag = (ueber = {}) => Object.assign({
    id: 7, nutzer: "u-1", schluessel_abdruck: pwz.abdruck(guter),
    gueltig_bis: new Date(Date.now() + 30 * 60000), benutzt_am: null,
    email: "ioannis@svhconsult.de", name: "Ioannis", aktiv: true }, ueber);

  zuruecksetzen(); zeilen.schluessel = [eintrag()];
  pruefe("Gueltiger Schluessel wird erkannt", (await pwz.pruefen(guter)).ok);
  pruefe("Falscher Schluessel wird abgewiesen", (await pwz.pruefen(pwz.schluesselBauen())).grund === "unbekannt");
  pruefe("Leerer Schluessel wird abgewiesen", (await pwz.pruefen("")).grund === "kein-schluessel");

  zeilen.schluessel = [eintrag({ gueltig_bis: new Date(Date.now() - 60000) })];
  pruefe("Abgelaufener Schluessel gilt nicht", (await pwz.pruefen(guter)).grund === "abgelaufen");
  zeilen.schluessel = [eintrag({ benutzt_am: new Date() })];
  pruefe("Benutzter Schluessel gilt nicht", (await pwz.pruefen(guter)).grund === "benutzt");
  zeilen.schluessel = [eintrag({ aktiv: false })];
  pruefe("Stillgelegtes Konto kann nicht setzen", (await pwz.pruefen(guter)).grund === "stillgelegt");

  // ---------------------------------------------------- Setzen
  zuruecksetzen(); zeilen.schluessel = [eintrag()];
  let s = await pwz.setzen(guter, "kurz");
  pruefe("Zu kurzes Passwort wird abgelehnt", !s.ok && s.grund === "zu-kurz" && geaendert.length === 0);

  zuruecksetzen(); zeilen.schluessel = [eintrag()];
  s = await pwz.setzen(guter, "Wintergarten-7Fluss");
  pruefe("Gueltiger Schluessel setzt das Passwort", s.ok && geaendert.length === 1
    && geaendert[0].neu === "Wintergarten-7Fluss" && geaendert[0].id === "u-1");
  pruefe("Schluessel wird beim Setzen verbraucht",
    abfragen.some((q) => /update public\.passwort_zuruecksetzen set benutzt_am/.test(q.sql) && /where id = \$1 and benutzt_am is null/.test(q.sql)));

  // Zwei Anfragen gleichzeitig: die zweite darf nicht durchgehen. Der Riegel
  // ist "where benutzt_am is null" — die Attrappe meldet dann 0 Zeilen.
  zuruecksetzen(); zeilen.schluessel = [eintrag()]; zeilen.einloesbar = false;
  s = await pwz.setzen(guter, "Wintergarten-7Fluss");
  pruefe("Zweiter Versuch im selben Augenblick geht ins Leere",
    !s.ok && s.grund === "benutzt" && geaendert.length === 0);
  zeilen.einloesbar = true;

  zuruecksetzen(); zeilen.schluessel = [eintrag({ gueltig_bis: new Date(Date.now() - 1000) })];
  s = await pwz.setzen(guter, "Wintergarten-7Fluss");
  pruefe("Abgelaufener Schluessel setzt nichts", !s.ok && geaendert.length === 0);

  // ---------------------------------------------------- Der Mailtext
  const t = pwz.mailText({ name: "Ioannis", url: "https://os.example/passwort-neu?schluessel=abc" });
  pruefe("Betreff sagt, worum es geht", /Passwort/i.test(t.betreff));
  pruefe("Mail nennt die Gueltigkeit", /eine Stunde/.test(t.text));
  pruefe("Mail sagt, was bei Irrtum zu tun ist", /nicht/i.test(t.text) && /wegwerfen|ignorieren/i.test(t.text));
  pruefe("Mail enthaelt kein Passwort im Klartext", !/passwort ist|dein neues passwort lautet/i.test(t.text));

  console.log(fehler ? `\n${fehler} Fall/Faelle offen.` : "\nAlle Fälle bestanden.");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
