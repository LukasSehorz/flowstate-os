// Prueft die Kundenakte 2 gegen die TEST-Datenbank (nicht in pruefen.js).
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5499/flowstate node scripts/test-akte-db.js
//
// Was hier laeuft: anlegen (mit geschaetztem Umsatz) -> Akte rendern ->
// speichern (geplanter Umsatz, Adresse, Branche, Score, Zeilenwahl) -> Werte
// pruefen -> Pipeline-Volumen mit RLS (Lukas sieht alles, Louis nur seins)
// -> Kurzakte fuer den Kalender -> aufraeumen.
//
// Verweigert sich gegen alles, was nicht lokal ist: Der Test schreibt und
// loescht Firmen, und das darf nie in der echten Datenbank passieren.

const url = process.env.DATABASE_URL || "";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  console.error("❌ DATABASE_URL zeigt nicht auf eine lokale Test-Datenbank — abgebrochen.");
  process.exit(1);
}
const crm = require("../lib/crm.js");
const akte = require("../lib/crm-akte.js");

let fehler = 0;
const ok = (b, text) => { console.log((b ? "✅" : "❌") + " " + text); if (!b) fehler++; };
const MARKE = "Testakte";

(async () => {
  const lukas = await crm.anmelden("lukas.sehorz@svhconsult.de", "flowstate2026");
  const louis = await crm.anmelden("louis.tournier@svhconsult.de", "flowstate2026");
  ok(lukas && lukas.rolle === "admin", "Login Lukas (admin)");
  ok(louis && louis.rolle === "mitarbeiter", "Login Louis (mitarbeiter)");

  // Altlasten eines abgebrochenen Laufs wegraeumen.
  await crm.system(`delete from projekte where firma_id in (select id from firmen where name like $1)`, [MARKE + "%"]);
  await crm.system(`delete from firmen where name like $1`, [MARKE + "%"]);

  const vorherL = await crm.pipelineVolumen(lukas);
  const vorherLouis = await crm.pipelineVolumen(louis);

  // ---- anlegen mit geschaetztem Umsatz (wie aus dem Blatt "Neuer Kunde") ----
  const r = await crm.firmaAnlegen(lukas, { name: MARKE + " Nord", status: "lead", geschaeftsfuehrer: "Anna Weber",
    telefon: "+49 8081 1234567", email: "info@testakte-nord.de", ort: "Dorfen", branche: "Gesundheit & Medizin",
    umsatz_geschaetzt: "3000", umsatz_geplant: "", tags: ["webdesign", "gesundheit"] });
  ok(r.id && r.angelegt, "Firma angelegt: " + r.id);
  let f = await crm.firma(lukas, r.id);
  ok(Number(f.umsatz_geschaetzt) === 3000 && f.umsatz_geplant === null, "geschaetzt 3000, geplant leer");
  ok(f.geschaeftsfuehrer === "Anna Weber", "Ansprechperson gespeichert");
  ok(JSON.stringify(f.akte_zeilen) === "{}", "akte_zeilen startet leer");

  // ---- Akte rendern mit echten Daten ----
  const team = await crm.team(lukas);
  const ICON = new Proxy({}, { get: () => "<svg></svg>" });
  const konst = { SPARTEN: { webdesign: "Webdesign", performance: "Performance Marketing", ki: "KI" },
    BRANCHEN: { gesundheit: "Gesundheit & Medizin" }, QUELLEN: [], ANSPRECH_ROLLEN: [], LAUFZEITEN: [], DRINGLICHKEIT: {},
    LEISTUNGEN_JE_SPARTE: { webdesign: ["Hosting"] }, KONTAKT_KANAELE: ["E-Mail"], RECHNUNG_STAende: {}, UMGESETZT_VORSCHLAEGE: [],
    ICON, MONATE_JE_LAUFZEIT: crm.MONATE_JE_LAUFZEIT, DOKUMENT_ARTEN: crm.DOKUMENT_ARTEN };
  const hilfen = { geld: (n) => Math.round(Number(n)).toLocaleString("de-DE") + " €", datum: (d) => String(d), zeit: (d) => String(d),
    datumFeld: () => "", datumZeitFeld: () => "", datumZeit: () => "", mitHerkunft: (p) => p, heuteFeld: () => "2026-09-05",
    monateJeLaufzeit: crm.monateJeLaufzeit };
  const html = akte.akteSeite({ u: lukas, f, mitarbeiter: team, projektStufen: [], projektJetzt: null, dok: { eigene: [], rechnungen: [] },
    rechnungen: await crm.rechnungenJeFirmaSicher(lukas, f.id), termine: await crm.termineVonFirmaSicher(lukas, f.id),
    zurueck: "/crm/kunden", akteUrl: "/crm/firma/" + f.id, admin: true, rechnungUrl: (a) => "/x?" + a, konst, hilfen });
  ok(html.includes("Testakte Nord") && html.includes('id="kat-geld"'), "Akte rendert mit echten Daten");
  ok(/data-zeile="mobil"[^>]*hidden/.test(html), "Mobil (leer, nicht gewaehlt) ist ausgeblendet");
  ok(html.includes("3.000 €"), "Pipeline-Beitrag 3.000 € (geschaetzt) steht in der Akte");

  // ---- Zeilenwahl speichern ----
  const z1 = await crm.akteZeilenSetzen(lukas, f.id, "kontakt", akte.zeilenPruefen("kontakt", ["mobil", "website", "telefon", "quatsch"]));
  ok(z1.ok && JSON.stringify(z1.akte_zeilen.kontakt) === JSON.stringify(["mobil", "website"]), "Zeilenwahl gespeichert: " + JSON.stringify(z1.akte_zeilen));
  const z2 = await crm.akteZeilenSetzen(lukas, f.id, "firma", ["notizen"]);
  ok(z2.ok && z2.akte_zeilen.kontakt && z2.akte_zeilen.firma, "zweite Kategorie ergaenzt, erste bleibt");
  const z3 = await crm.akteZeilenSetzen(lukas, f.id, "firma", []);
  ok(z3.ok && !z3.akte_zeilen.firma && z3.akte_zeilen.kontakt, "leere Liste entfernt den Schluessel");
  const zLouis = await crm.akteZeilenSetzen(louis, f.id, "kontakt", ["mobil"]);
  ok(!zLouis.ok, "Louis darf die Zeilenwahl einer fremden Firma nicht aendern (RLS)");

  // ---- speichern wie der POST-Handler: geplant, Adresse, Branche, Score, Mobil ----
  await crm.kundeAendern(lukas, f.id, { umsatz_geplant: "4500", umsatz_geschaetzt: "3000", mobil: "0172 1234567",
    adresse: "Marktplatz 3", plz: "84405", ort: "Dorfen", branche: "Gesundheit & Medizin", branche_tag: "gesundheit",
    branchen_alle: ["gesundheit", "handwerk"], score: "7", naechste_aufgabe: "Angebot schreiben" });
  f = await crm.firma(lukas, f.id);
  ok(Number(f.umsatz_geplant) === 4500, "umsatz_geplant 4500 gespeichert");
  ok(f.mobil === "0172 1234567" && f.adresse === "Marktplatz 3" && f.plz === "84405", "Mobil, Strasse, PLZ gespeichert");
  ok(f.score === 7, "Score ueber das Akte-Formular gespeichert");
  await crm.kundeAendern(lukas, f.id, { score: "99" });
  ok((await crm.firma(lukas, f.id)).score === 7, "score 99 (ungueltig) laesst den Score 7 unangetastet");
  ok((f.tags || []).includes("gesundheit") && (f.tags || []).includes("webdesign"), "Branchen-Tag gesetzt, Sparte bleibt: " + JSON.stringify(f.tags));
  ok(JSON.stringify(f.akte_zeilen.kontakt) === JSON.stringify(["mobil", "website"]), "Zeilenwahl ueberlebt das Speichern");
  const sicht = akte.zeilenSichtbar("kontakt", f, { istKunde: false, sparte: "webdesign" });
  ok(sicht.sichtbar.has("mobil") && sicht.sichtbar.has("website") && sicht.sichtbar.has("adresse") && sicht.sichtbar.has("plz_ort"),
    "sichtbar: Mobil (Wert+Wahl), Website (Wahl), Adresse und PLZ/Ort (Wert)");

  // ---- Erstgespraech setzen: Kalender-Sync darf das Speichern nie stoeren ----
  await crm.kundeAendern(lukas, f.id, { erstgespraech_am: "2026-09-10T14:00" });
  f = await crm.firma(lukas, f.id);
  ok(f.erstgespraech_am && new Date(f.erstgespraech_am).getHours() === 14, "Erstgespraech gespeichert (Kalender-Sync nur geloggt)");

  // ---- Pipeline-Volumen: geplant schlaegt geschaetzt, RLS ----
  const nachherL = await crm.pipelineVolumen(lukas);
  ok(nachherL.geplant - vorherL.geplant === 4500, "Lukas: Pipeline geplant +4500 (" + nachherL.geplant + ")");
  ok(nachherL.geschaetzt === vorherL.geschaetzt, "Lukas: geschaetzt unveraendert (geplant schlaegt geschaetzt)");
  ok(nachherL.anzahl - vorherL.anzahl === 1, "Lukas: eine Firma mehr in der Pipeline");
  const louisFirma = await crm.firmaAnlegen(louis, { name: MARKE + " Süd", status: "lead", umsatz_geschaetzt: 1000, tags: ["ki"] });
  const nachherLouis = await crm.pipelineVolumen(louis);
  ok(nachherLouis.gesamt - vorherLouis.gesamt === 1000, "Louis: sieht nur sein Volumen (+1000, nicht +5500) — " + nachherLouis.gesamt);
  const nochmalL = await crm.pipelineVolumen(lukas);
  ok(nochmalL.gesamt - vorherL.gesamt === 5500, "Lukas (admin): sieht beides (+5500)");

  // ---- Kurzakte fuer den Kalender ----
  const kurz = await crm.firmaKurz(lukas, f.id);
  ok(kurz && kurz.name === MARKE + " Nord" && kurz.umsatz_geplant === 4500 && kurz.url === "/crm/firma/" + f.id
    && kurz.ansprechperson === "Anna Weber" && kurz.sparte === "webdesign" && kurz.naechste_aufgabe === "Angebot schreiben",
    "firmaKurz liefert die Kurzakte: " + JSON.stringify(kurz).slice(0, 120));
  ok((await crm.firmaKurz(louis, f.id)) === null, "firmaKurz fuer Louis: null (fremde Firma)");
  ok((await crm.firmaKurz(lukas, 999999999)) === null, "firmaKurz fuer unbekannte id: null");

  // ---- Nachbarn ohne Modul: Nullen statt Fehler ----
  const rj = await crm.rechnungenJeFirmaSicher(lukas, f.id);
  ok(rj && typeof rj.gestellt === "number" && Array.isArray(rj.liste), "rechnungenJeFirmaSicher: Zahlen + Liste, wirft nie");
  const uf = await crm.umsatzFestSicher(lukas);
  ok(uf && typeof uf.offen === "number", "umsatzFestSicher: Zahlen, wirft nie");
  const tv = await crm.termineVonFirmaSicher(lukas, f.id);
  ok(Array.isArray(tv), "termineVonFirmaSicher: Liste, wirft nie");

  // ---- Pruefung 05.09.: Kunde direkt anlegen, leerer Name, Unzahlen ----
  const k = await crm.firmaAnlegen(lukas, { name: MARKE + " Kunde", status: "kunde", umsatz_geplant: "abc", tags: ["ki"] });
  const fk = await crm.firma(lukas, k.id);
  ok(fk.status === "kunde" && Boolean(fk.kunde_seit), "Status Kunde beim Anlegen: kunde_seit gesetzt (" + (fk.kunde_seit ? String(fk.kunde_seit).slice(0, 15) : "leer") + ")");
  ok((fk.historie || []).some((h) => /Als Kunde angelegt/.test(h.text)), "Verlaufseintrag 'Als Kunde angelegt'");
  ok(fk.umsatz_geplant === null, "umsatz_geplant 'abc' beim Anlegen -> null");
  let warf = false;
  try { await crm.firmaAnlegen(lukas, { name: "   " }); } catch (e2) { warf = /Firmenname/.test(e2.message); }
  ok(warf, "firmaAnlegen mit leerem Namen wirft ('Firmenname fehlt')");
  await crm.kundeAendern(lukas, k.id, { umsatz_geplant: "abc", umsatz_geschaetzt: "12x", mitarbeiter_zahl: "abc", preis_setup: "" });
  const fk2 = await crm.firma(lukas, k.id);
  ok(fk2.umsatz_geplant === null && fk2.umsatz_geschaetzt === null && fk2.mitarbeiter_zahl === null && fk2.preis_setup === null,
    "kundeAendern: Unzahlen werden null, kein NaN, kein 500er");
  await crm.kundeAendern(lukas, k.id, { quelle: "Meta Ads" });
  await crm.kundeAendern(lukas, k.id, {});
  ok((await crm.firma(lukas, k.id)).quelle === "Meta Ads", "Speichern ohne Felder laesst die Quelle stehen");

  // ---- aufraeumen ----
  await crm.system(`delete from projekte where firma_id in (select id from firmen where name like $1)`, [MARKE + "%"]);
  const weg = await crm.system(`delete from firmen where name like $1`, [MARKE + "%"]);
  ok(weg.rowCount === 3, "aufgeraeumt (" + weg.rowCount + " Firmen)");
  void louisFirma;

  await crm.pool.end();
  console.log(fehler ? `\n${fehler} Problem(e).` : "\nAlles gut.");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("❌", e); crm.pool.end().catch(() => {}); process.exit(1); });
