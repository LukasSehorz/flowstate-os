// Prueft die reine Logik der Kundenakte 2 (lib/crm-akte.js) — OHNE Datenbank.
//
//   node scripts/test-akte.js
//
// Laeuft in scripts/pruefen.js vor jedem Push. Was hier steht, entscheidet,
// welche Zeile eine Akte zeigt und welche Firma wie viel zur Pipeline
// beitraegt — beides Dinge, die man einer Seite nicht ansieht, wenn sie
// still falsch sind. Der Datenbank-Teil (anlegen, rendern, speichern) liegt
// in scripts/test-akte-db.js und braucht die Test-DB.

const akte = require("../lib/crm-akte.js");

let fehler = 0;
const ok = (bedingung, text) => { console.log((bedingung ? "✅" : "❌") + " " + text); if (!bedingung) fehler++; };
const gleich = (a, b, text) => ok(JSON.stringify(a) === JSON.stringify(b), `${text} — ${JSON.stringify(a)}`);

// ---------------------------------------------------------------- Zeilen
console.log("\n— Zeilenwahl —");
const lead = { status: "lead", geschaeftsfuehrer: "Anna Weber", telefon: "", email: null, mobil: "  ",
  hosting: false, retainer_monate_bezahlt: 0, argumente: [], akte_zeilen: { kontakt: ["website"] } };
const kontakt = akte.zeilenSichtbar("kontakt", lead, { istKunde: false, sparte: "webdesign" });
ok(kontakt.sichtbar.has("ansprechperson") && kontakt.sichtbar.has("telefon") && kontakt.sichtbar.has("email"),
  "Pflichtzeilen Ansprechperson/Telefon/E-Mail sind immer da — auch leer");
ok(!kontakt.sichtbar.has("mobil"), "leere optionale Zeile (Mobil, nur Leerzeichen) ist ausgeblendet");
ok(kontakt.sichtbar.has("website"), "gewaehlte leere Zeile (Website) ist eingeblendet");
ok(!kontakt.waehlbar.some((w) => w.id === "telefon"), "Pflichtzeilen stehen nicht im Popover");
ok(kontakt.waehlbar.find((w) => w.id === "website").gewaehlt === true, "Popover kennt die Wahl");

const kunde = { status: "kunde", mobil: "0172 1", hosting: false, retainer_monate_bezahlt: 0, argumente: ["schnell"],
  umsatz_geplant: "2500.00", akte_zeilen: {} };
const geldK = akte.zeilenSichtbar("geld", kunde, { istKunde: true, sparte: "webdesign" });
ok(geldK.sichtbar.has("umsatz_geschaetzt") && geldK.sichtbar.has("umsatz_geplant"), "Umsatz geschaetzt/geplant sind Pflicht");
ok(geldK.sichtbar.has("hosting"), "hosting = false zaehlt als Wert (jemand hat Nein gesagt) — sichtbar");
ok(!geldK.sichtbar.has("retainer_monate_bezahlt"), "Retainer-Monate 0 zaehlt NICHT als Wert — ausgeblendet");
ok(geldK.waehlbar.find((w) => w.id === "hosting").hatWert === true, "Popover markiert Zeilen mit Wert");
const geldP = akte.zeilenSichtbar("geld", kunde, { istKunde: true, sparte: "performance" });
ok(!geldP.sichtbar.has("hosting") && !geldP.waehlbar.some((w) => w.id === "hosting"), "Hosting gibt es nur bei Webdesign");
ok(geldP.waehlbar.some((w) => w.id === "leads"), "Leads Ziel/Ist nur bei Performance");
const geldL = akte.zeilenSichtbar("geld", lead, { istKunde: false, sparte: "webdesign" });
ok(!geldL.waehlbar.some((w) => w.id === "kunde_seit"), "Kunde seit gibt es beim Lead nicht");

const standK = akte.zeilenSichtbar("stand", kunde, { istKunde: true, sparte: "webdesign" });
const standL = akte.zeilenSichtbar("stand", lead, { istKunde: false, sparte: "webdesign" });
ok(standK.sichtbar.has("projekt_stufe") && !standK.sichtbar.has("score"), "Kunde: Projektphase Pflicht, kein Score");
ok(standL.sichtbar.has("score") && !standL.sichtbar.has("projekt_stufe"), "Lead: Score Pflicht, keine Projektphase");
ok(standK.sichtbar.has("naechste_aufgabe"), "Naechste Aufgabe ist Pflicht");

const firmaK = akte.zeilenSichtbar("firma", kunde, { istKunde: true, sparte: "webdesign" });
ok(firmaK.sichtbar.has("argumente") && !firmaK.waehlbar.some((w) => w.id === "argumente"),
  "Verkaufsargumente: sichtbar wenn vorhanden, nie waehlbar (nur lesen)");
ok(firmaK.sichtbar.has("branche") && firmaK.sichtbar.has("besitzer"), "Firma: Branche und Verantwortlich Pflicht");

console.log("\n— Zeilen pruefen (Whitelist) —");
gleich(akte.zeilenPruefen("kontakt", ["website", "telefon", "mobil", "quatsch", "website"]), ["mobil", "website"],
  "nur optionale Zeilen der Kategorie, einmal, in Listenreihenfolge");
gleich(akte.zeilenPruefen("kontakt", "website"), [], "kein Array -> leer");
ok(akte.zeilenPruefen("ueberblick", ["x"]) === null, "Kategorie ohne waehlbare Zeilen -> null");
ok(akte.zeilenPruefen("gibtsnicht", ["x"]) === null, "unbekannte Kategorie -> null");
gleich(akte.zeilenPruefen("firma", ["argumente", "notizen"]), ["notizen"], "Nur-lesen-Zeilen sind nicht waehlbar");

// ---------------------------------------------------------------- Pipeline
console.log("\n— Umsatz-Regel: Pipeline-Beitrag —");
const b = akte.pipelineBeitrag;
gleich(b({ status: "lead", umsatz_geplant: "2500.00", umsatz_geschaetzt: 9000 }), { betrag: 2500, art: "geplant", quelle: "umsatz_geplant" },
  "geplant schlaegt geschaetzt (numerische Strings aus pg)");
gleich(b({ status: "kunde", umsatz_geschaetzt: 3000 }), { betrag: 3000, art: "geschaetzt", quelle: "umsatz_geschaetzt" }, "geschaetzt als Rueckfall");
gleich(b({ status: "lead", deals_offen: "1800" }), { betrag: 1800, art: "geschaetzt", quelle: "deals" }, "offene Deal-Werte als letzter Rueckfall");
gleich(b({ status: "kunde", umsatz_geplant: 2500, rechnungen_gestellt: 1250 }), { betrag: 0, art: null, quelle: "rechnung" },
  "sobald eine Rechnung gestellt ist: 0 — zaehlt als fester Umsatz");
gleich(b({ status: "verloren", umsatz_geplant: 2500 }), { betrag: 0, art: null, quelle: "status" }, "verloren zaehlt nicht");
gleich(b({ status: "lead" }), { betrag: 0, art: null, quelle: "leer" }, "nichts eingetragen -> 0");
gleich(b({ status: "lead", umsatz_geplant: 0, umsatz_geschaetzt: 0 }), { betrag: 0, art: null, quelle: "leer" }, "Nullen sind kein Wert");
gleich(b(null), { betrag: 0, art: null, quelle: "status" }, "null vertraegt es");

console.log("\n— Pipeline-Volumen —");
gleich(akte.pipelineSumme([
  { status: "lead", umsatz_geplant: 2500 },
  { status: "kunde", umsatz_geschaetzt: 3000 },
  { status: "kunde", umsatz_geplant: 5000, rechnungen_gestellt: 5000 },
  { status: "lead", deals_offen: 800 },
  { status: "lead" },
]), { gesamt: 6300, geplant: 2500, geschaetzt: 3800, anzahl: 3 }, "Summe, davon geplant/geschaetzt, Anzahl beitragender Firmen");
gleich(akte.pipelineSumme([]), { gesamt: 0, geplant: 0, geschaetzt: 0, anzahl: 0 }, "leer -> Nullen");

console.log("\n— Bezahlt-Prozent und Abschlaege —");
ok(akte.bezahltProzent({ gestellt: 0, bezahlt: 0 }) === null, "ohne gestellte Rechnung: null (Anzeige sagt —)");
ok(akte.bezahltProzent({ gestellt: 5000, bezahlt: 2500 }) === 50, "50 % bezahlt");
ok(akte.bezahltProzent({ gestellt: 100, bezahlt: 150 }) === 100, "nie ueber 100");
const liste = [{ id: 1, abschlag_von: 9, abschlag_nr: 1 }, { id: 2, abschlag_von: 9, abschlag_nr: 2 }, { id: 3, abschlag_von: 7, abschlag_nr: 1 }];
ok(akte.abschlagText(liste[0], liste) === "Abschlag 1 von 2", "Abschlag 1 von 2");
ok(akte.abschlagText(liste[2], liste) === "Abschlag 1", "einzelner Abschlag ohne 'von'");
ok(akte.abschlagText({ id: 4 }, liste) === "", "keine Abschlagsrechnung -> leer");

// ---------------------------------------------------------------- Rendering
console.log("\n— Rendering (ohne Datenbank) —");
const ICON = new Proxy({}, { get: () => "<svg></svg>" });
const konst = {
  SPARTEN: { webdesign: "Webdesign", performance: "Performance Marketing", ki: "KI" },
  BRANCHEN: { gesundheit: "Gesundheit & Medizin", handwerk: "Handwerk & Bau" },
  QUELLEN: ["Meta Ads", "Cold Calling"], ANSPRECH_ROLLEN: ["Geschäftsführung", "Inhaber"],
  LAUFZEITEN: ["1 Monat", "12 Monate"], DRINGLICHKEIT: { Dringend: {}, Bald: {} },
  LEISTUNGEN_JE_SPARTE: { webdesign: ["Hosting", "Support"], performance: ["Reporting"], ki: ["Schulung"] },
  KONTAKT_KANAELE: ["E-Mail", "WhatsApp", "Telefon"], RECHNUNG_STAende: { offen: "Noch nicht bezahlt", "100": "Voll bezahlt" },
  UMGESETZT_VORSCHLAEGE: ["Webdesign"], ICON, MONATE_JE_LAUFZEIT: { "1 Monat": 1 }, DOKUMENT_ARTEN: ["Vertrag", "Sonstiges"],
};
const hilfen = {
  geld: (n) => (n == null ? "–" : Math.round(Number(n)).toLocaleString("de-DE") + " €"),
  datum: (d) => (d ? new Date(d).toLocaleDateString("de-DE") : "–"), zeit: (d) => (d ? new Date(d).toLocaleString("de-DE") : ""),
  datumFeld: () => "", datumZeitFeld: () => "", datumZeit: () => "", mitHerkunft: (p) => p, heuteFeld: () => "2026-09-05",
  monateJeLaufzeit: () => 1,
};
const team = [{ id: "u1", name: "Lukas" }, { id: "u2", name: "Louis" }];
const basis = { u: { id: "u1", rolle: "admin" }, mitarbeiter: team, projektStufen: [], projektJetzt: null,
  dok: { eigene: [], rechnungen: [] }, termine: [], zurueck: "/crm/kunden", akteUrl: "/crm/firma/1", admin: true,
  rechnungUrl: (art) => `/buchhaltung/rechnungen/neu?firma=1&art=${art}`, konst, hilfen };

const leadHtml = akte.akteSeite({ ...basis, f: { id: 1, name: "Test & Co", status: "lead", tags: ["webdesign"], deals: [], aufgaben: [], historie: [],
  akte_zeilen: { kontakt: ["website"] } }, rechnungen: { gestellt: 0, bezahlt: 0, offen: 0, anzahl: 0, liste: [] } });
ok(typeof leadHtml === "string" && leadHtml.length > 5000, "Lead-Akte rendert");
ok(leadHtml.includes('id="kat-ueberblick"') && akte.KATEGORIEN.every((k) => leadHtml.includes(`id="kat-${k.id}"`)), "alle acht Kategorien im DOM");
ok(leadHtml.includes('<form id="akte"') && leadHtml.includes('name="abschnitt" value="alles"'), "EIN Formular #akte mit abschnitt=alles");
ok(/data-zeile="mobil"[^>]*hidden/.test(leadHtml), "leere optionale Zeile (Mobil) liegt hidden im DOM");
ok(/data-zeile="website"(?![^>]*hidden)/.test(leadHtml), "gewaehlte Zeile (Website) ist sichtbar");
ok(leadHtml.includes("Test &amp; Co"), "Name ist HTML-sicher");
ok(!leadHtml.includes('value="stand" form="akte"'), "Lead: kein dabei=stand (die Felder gibt es dort nicht)");
ok(leadHtml.includes('name="verantwortlich"'), "To-do-Formular schickt verantwortlich mit (Vertrag mit Agent B)");
ok(leadHtml.includes("Angebot erstellen") && leadHtml.includes("art=rechnung"), "Admin sieht Angebot/Rechnung erstellen");
for (const dabei of ["stammdaten", "kontakt", "leistungen", "firma", "auftrag", "termine", "notizen"]) {
  ok(leadHtml.includes(`name="dabei" value="${dabei}"`), `dabei-Marker ${dabei} vorhanden`);
}

const kundeHtml = akte.akteSeite({ ...basis, admin: false, f: { id: 2, name: "Praxis", status: "kunde", tags: ["webdesign", "retainer"], deals: [], aufgaben: [
    { id: 5, titel: "Live stellen", erledigt: false, verantwortlich: "u2" }], historie: [{ text: "Angelegt", zeit: "2026-09-01", art: "system" }],
  kunde_seit: "2026-08-01", umsatz_geplant: 4000, hosting: false, akte_zeilen: {} },
  rechnungen: { gestellt: 4000, bezahlt: 2000, offen: 2000, anzahl: 2, liste: [
    { id: 11, nummer: "R-2026-131", art: "rechnung", betrag: 2000, bezahlt_betrag: 2000, status: "bezahlt", abschlag_nr: 1, abschlag_von: 10, url: "/x/11" },
    { id: 12, nummer: "R-2026-132", art: "rechnung", betrag: 2000, bezahlt_betrag: 0, status: "gestellt", abschlag_nr: 2, abschlag_von: 10, faellig: "2026-09-19", url: "/x/12" }] } });
ok(kundeHtml.includes('name="dabei" value="stand"'), "Kunde: dabei=stand vorhanden");
ok(kundeHtml.includes("Abschlag 1 von 2") && kundeHtml.includes("Abschlag 2 von 2"), "Abschlagsrechnungen lesbar im Ueberblick");
ok(kundeHtml.includes("<b>50 %</b> bezahlt"), "Fortschritt 50 % bezahlt");
ok(!kundeHtml.includes("Angebot erstellen"), "Mitarbeiter sieht keine Buchhaltungs-Knoepfe");
ok(kundeHtml.includes("für Louis"), "Aufgabe fuer jemand anderen zeigt 'fuer <Name>'");
ok(/data-zeile="hosting"(?![^>]*hidden)/.test(kundeHtml), "hosting=false ist als Zeile sichtbar");
ok(kundeHtml.includes("zählt als fester Umsatz"), "mit gestellter Rechnung: Pipeline-Beitrag erklaert sich");

const blatt = akte.kundeNeuBlatt({ u: { id: "u1", name: "Lukas" }, mitarbeiter: team, admin: true, konst });
ok(blatt.includes('class="os-blatt"') && blatt.includes('action="/crm/kunden/anlegen"'), "Neuer-Kunde-Blatt rendert");
for (const feld of ["name", "geschaeftsfuehrer", "telefon", "email", "ort", "branche", "sparte", "status", "besitzer",
  "umsatz_geschaetzt", "umsatz_geplant", "aufgabe_titel", "aufgabe_verantwortlich"]) {
  ok(blatt.includes(`name="${feld}"`), `Blatt hat Feld ${feld}`);
}

// ---------------------------------------------------------------- Pruefung 05.09.
console.log("\n— Pruefung 05.09.: Auswahlfelder, Altbestand, leere Gruppen —");
ok(akte.auswahlWert(undefined, ["a"]) === undefined, "Feld nicht mitgeschickt -> unangetastet");
ok(akte.auswahlWert("", ["a"]) === "", "'— offen —' gewaehlt -> loeschen");
ok(akte.auswahlWert("a", ["a"]) === "a", "bekannter Wert -> uebernehmen");
ok(akte.auswahlWert("manuell", ["Meta Ads"]) === undefined, "unbekannter Altbestand (quelle='manuell') -> unangetastet");
const altbestand = akte.akteSeite({ ...basis, f: { id: 3, name: "Altbestand", status: "lead", tags: [], deals: [{ status: "offen", sparte: "ki" }], aufgaben: [], historie: [],
  quelle: "manuell", ansprech_rolle: "Inhaberin", besitzer: "u-weg", gewonnen_durch: "u-weg", vertrag_laufzeit: "24 Monate", leistungen: ["Reporting"], akte_zeilen: {} },
  rechnungen: { gestellt: 0, bezahlt: 0, offen: 0, anzahl: 0, liste: [] } });
const select = (html, name) => (html.match(new RegExp('<select form="akte" name="' + name + '">[\\s\\S]*?</select>')) || [""])[0];
ok(select(altbestand, "quelle").includes('<option value="manuell" selected>'), "Quelle 'manuell' steht als gewaehlte Option (Altbestand)");
ok(select(altbestand, "ansprech_rolle").includes('<option value="Inhaberin" selected>'), "Position 'Inhaberin' steht als gewaehlte Option");
ok(select(altbestand, "vertrag_laufzeit").includes('<option value="24 Monate" selected>'), "Laufzeit '24 Monate' steht als gewaehlte Option");
ok(select(altbestand, "besitzer").includes('<option value="u-weg" selected>Nicht (mehr) im Team</option>'), "Verantwortlich ausserhalb des Teams bleibt erhalten");
ok(select(altbestand, "sparte").includes('<option value="" selected>') && !select(altbestand, "sparte").includes('value="webdesign" selected'), "Bereich ohne Tag: '— offen —' gewaehlt, kein Webdesign untergeschoben");
ok(altbestand.includes('name="leistungen" value="Reporting" checked'), "Leistung aus anderem Bereich steht als angehakter Chip");
const ohneBesitzer = akte.akteSeite({ ...basis, f: { id: 4, name: "Ohne", status: "lead", tags: ["webdesign"], deals: [], aufgaben: [], historie: [], besitzer: null, akte_zeilen: {} },
  rechnungen: { gestellt: 0, bezahlt: 0, offen: 0, anzahl: 0, liste: [] } });
ok(select(ohneBesitzer, "besitzer").includes('<option value="" selected>— offen —</option>'), "Firma ohne Besitzer: '— offen —' vorausgewaehlt, niemand wird still Besitzer");
ok(/<section class="os-gruppe" data-gruppe-zeilen="adresse,plz_ort" hidden>/.test(leadHtml), "Gruppe 'Adresse' ohne sichtbare Zeile ist ganz ausgeblendet");
ok(/<section class="os-gruppe" data-gruppe-zeilen="preis_setup,[^"]*" hidden>/.test(leadHtml), "Gruppe 'Vereinbart' beim leeren Lead ausgeblendet");
ok(/<section class="os-gruppe" data-gruppe-zeilen="ansprechperson,position,anrede">/.test(leadHtml), "Gruppe mit Pflichtzeile bleibt sichtbar");
ok(leadHtml.includes('class="akte2-kat-kopf"') && leadHtml.includes('id="pop-kontakt"') && leadHtml.includes('class="akte2-popover-gruppe">Adresse<'), "Zeilen-Werkzeug an der Kategorie, Popover gliedert nach Gruppen");
ok(leadHtml.includes('input[type=checkbox]:checked:not(:disabled)'), "Zeilenwahl merkt nur gewaehlte Zeilen, nicht die gesperrten mit Wert");
ok(leadHtml.includes('onclick="akteVerwerfen()"') && leadHtml.includes("window.akteVerwerfen=function(){speichertGerade=true;location.reload()}"), "Verwerfen setzt das Schmutz-Flag zurueck");
const blattLouis = akte.kundeNeuBlatt({ u: { id: "u2", name: "Louis" }, mitarbeiter: team, admin: false, konst });
ok(!blattLouis.includes('name="besitzer"') && blattLouis.includes("<select disabled><option>Louis</option></select>") && blattLouis.includes("Übergabe später in der Akte durch einen Admin"),
  "Mitarbeiter: Verantwortlich nur er selbst (deaktiviert, mit Hinweis)");
ok(blatt.includes('name="besitzer"'), "Admin: Verantwortlich waehlbar");
const blattFehler = akte.kundeNeuBlatt({ u: { id: "u1", name: "Lukas" }, mitarbeiter: team, admin: true, fehler: "name", konst });
ok(blattFehler.includes("Der Firmenname fehlt") && blattFehler.includes('document.getElementById("neu").showModal();'), "Blatt mit ?fehler=name: Hinweis und oeffnet sich von selbst");

console.log(fehler ? `\n${fehler} Problem(e).` : "\nAlles gut.");
process.exit(fehler ? 1 : 0);
