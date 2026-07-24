// Testet die Kontaktaufloesung — wer bekommt eine WhatsApp, wenn Lukas
// "schick Jannik ..." sagt.
//
// Hintergrund (24.07.2026): Eine Nachricht an Jannik kam nie an und tauchte in
// keinem Chat auf. Zwei Fehler kamen zusammen:
//   1. "@lid"-Eintraege (WhatsApp-interne Kennung) wurden als Telefonnummer
//      gelesen -> gesendet an eine Adresse, die es nicht gibt.
//   2. Ein fremdgewaehlter Profilname ("jannik") schlug den gespeicherten
//      Adressbuch-Namen ("jannik vom hofe").
//
// Aufruf: node scripts/test-kontakte.js

const fs = require("fs");
const os = require("os");
const path = require("path");

// Eigene Testumgebung, damit weder echte Kontakte noch data/ angefasst werden.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kontakte-test-"));
process.env.DATA_PATH = TMP;
process.env.WA_DIR = TMP;
process.env.INTERN_WA_NAMEN = "jannik";

// So sieht die Kontaktliste der Bruecke aus: echte Nummern-JIDs, LID-Eintraege
// mit Ruecklink (pn) und LID-Eintraege ohne — genau die Mischung vom Server.
fs.writeFileSync(path.join(TMP, "contacts.json"), JSON.stringify({
  "491700006888@s.whatsapp.net": { name: "jannik vom hofe", notify: "Jannik" },
  "123456785270@lid":            { name: "", notify: "jannik" },              // fremder Profilname, keine Nummer
  "491700001111@s.whatsapp.net": { name: "Janni", notify: "" },
  "987654321000@lid":            { name: "Jannis Turchan", notify: "", pn: "491700002222@s.whatsapp.net" },
  "491700003333@s.whatsapp.net": { name: "Mama", notify: "" },
}));

const kontakte = require("../lib/kontakte.js");

let fehler = 0;
function pruefe(name, wahr) {
  console.log((wahr ? "✅" : "❌") + " " + name);
  if (!wahr) fehler++;
}

// 1. Der Kernfall: "jannik" muss den echten Jannik treffen, nicht den Fremden.
const j = kontakte.finde("jannik");
pruefe("'jannik' trifft den gespeicherten Kontakt", j?.name === "jannik vom hofe");
pruefe("'jannik' bekommt die ECHTE Nummer (nicht die LID)", j?.nummer === "491700006888");
pruefe("'jannik' gilt als intern", j?.intern === true);

// 2. Voller Name funktioniert genauso.
const j2 = kontakte.finde("Jannik vom Hofe");
pruefe("'Jannik vom Hofe' trifft dieselbe Nummer", j2?.nummer === "491700006888");

// 3. LID ohne Ruecklink darf NIE als Nummer herauskommen.
const alleNummern = kontakte.finde("jannik")?.nummer || "";
pruefe("LID 123456785270 wird nie als Nummer geliefert", !alleNummern.includes("5270"));

// 4. LID MIT Ruecklink (pn) wird korrekt aufgeloest.
const t = kontakte.finde("Jannis Turchan");
pruefe("LID mit pn liefert die echte Nummer", t?.nummer === "491700002222");

// 5. Anderer Kontakt bleibt unberuehrt.
pruefe("'Mama' trifft weiterhin Mama", kontakte.finde("Mama")?.nummer === "491700003333");

// 6. Direkte Nummer bleibt moeglich.
pruefe("Direkte Nummer wird durchgereicht", kontakte.finde("+49 170 000 4444")?.nummer === "491700004444");

// 7. Unbekannter Name -> nichts (lieber nachfragen als raten).
pruefe("Unbekannter Name liefert null", kontakte.finde("Xaver Unbekannt") === null);

// 8. Mehrdeutigkeit: zwei gleich gute Treffer mit VERSCHIEDENEN Nummern ->
//    nicht raten, sondern melden.
fs.writeFileSync(path.join(TMP, "contacts.json"), JSON.stringify({
  "491700005555@s.whatsapp.net": { name: "Chris", notify: "" },
  "491700006666@s.whatsapp.net": { name: "Chris", notify: "" },
}));
const c = kontakte.finde("Chris");
pruefe("Zwei gleichnamige Kontakte -> mehrdeutig statt geraten", Array.isArray(c?.mehrdeutig) && c.mehrdeutig.length === 2);
pruefe("Mehrdeutig liefert keine Nummer zum Senden", !c?.nummer);

// 9. Das manuelle Buch schlaegt die WhatsApp-Kontakte (zum Festnageln).
fs.writeFileSync(path.join(TMP, "kontakte.json"), JSON.stringify([
  { name: "Chris", nummer: "491700009999", intern: true },
]));
const c2 = kontakte.finde("Chris");
pruefe("Manuelles Buch gewinnt und loest die Mehrdeutigkeit", c2?.nummer === "491700009999");

// --------------------------------------------------------------- Gruppen
//
// Gruppen erreichen viele Leute auf einmal. Deshalb gilt eine Freigabeliste:
// nur ausdruecklich genannte Arbeitsgruppen sind adressierbar, private nie.
fs.rmSync(path.join(TMP, "kontakte.json"), { force: true });
fs.writeFileSync(path.join(TMP, "gruppen.json"), JSON.stringify({
  "111111@g.us": { name: "Team Flowstate" },
  "222222@g.us": { name: "Flowstate" },
  "333333@g.us": { name: "KI" },
  "444444@g.us": { name: "Padel" },
  "555555@g.us": { name: "Social Media Flowstate" },
  "666666@g.us": { name: "Familie Sehorz" },          // privat — NIE freigegeben
  "777777@g.us": { name: "Flowstate privat" },        // aehnlicher Name, NICHT freigegeben
}));
process.env.WA_GRUPPEN = "Team Flowstate,Flowstate,KI,Padel,Social Media Flowstate";

pruefe("Freigegeben: genau 5 Gruppen sichtbar", kontakte.gruppen().length === 5);
pruefe("Freigegeben: 'Team Flowstate' gefunden", kontakte.findeGruppe("Team Flowstate")?.jid === "111111@g.us");
pruefe("Freigegeben: 'KI' gefunden", kontakte.findeGruppe("KI")?.jid === "333333@g.us");
pruefe("Freigegeben: 'Padel' gefunden", kontakte.findeGruppe("Padel")?.jid === "444444@g.us");
pruefe("Gesperrt: 'Familie Sehorz' NICHT erreichbar", kontakte.findeGruppe("Familie Sehorz") === null);
pruefe("Gesperrt: 'Flowstate privat' NICHT erreichbar", kontakte.findeGruppe("Flowstate privat") === null);
pruefe("'Flowstate' trifft die freigegebene, nicht die private",
  kontakte.findeGruppe("Flowstate")?.jid === "222222@g.us");
pruefe("Gruppe liefert eine JID, keine Telefonnummer",
  String(kontakte.findeGruppe("KI")?.jid || "").endsWith("@g.us"));

// Ohne Freigabeliste ist GAR NICHTS erreichbar — sicherer Grundzustand.
process.env.WA_GRUPPEN = "";
pruefe("Ohne Freigabeliste: keine Gruppe erreichbar", kontakte.gruppen().length === 0 && kontakte.findeGruppe("KI") === null);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
