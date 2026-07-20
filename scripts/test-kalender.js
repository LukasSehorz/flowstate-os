// Prueft termineLesen() gegen die Formen, die gws-cli tatsaechlich liefert.
// Der Container ist in einer Neustart-Schleife gestorben, weil die Sicherheits-
// Huelle (data als JSON-String) nicht erkannt wurde und .map auf einem String lief.
const { termineLesen } = require("../lib/zustand.js");

const termin = { summary: "Erstgespräch Physio Schwabing", location: "München",
  start: { dateTime: "2026-07-21T10:00:00+02:00" }, end: { dateTime: "2026-07-21T11:00:00+02:00" } };

const faelle = [
  ["Sicherheits-Huelle (data als String)", JSON.stringify({
    events: { warning: "EXTERNAL CONTENT", data: JSON.stringify([termin]),
              security_warnings: [{ matched_text: "irgendwas" }] } }), 1],
  ["blanke Liste", JSON.stringify([termin]), 1],
  ["unter events", JSON.stringify({ events: [termin] }), 1],
  ["unter items", JSON.stringify({ items: [termin] }), 1],
  ["leere Huelle", JSON.stringify({ events: { data: "[]" } }), 0],
  ["abgesagter Termin", JSON.stringify([{ ...termin, status: "cancelled" }]), 0],
  ["nur Sicherheitswarnungen", JSON.stringify({ data: [{ matched_text: "x" }] }), 0],
  ["kaputtes JSON", "das ist kein json", 0],
  ["leerer String", "", 0],
  ["null", "null", 0],
  ["Zahl", "42", 0],
  ["Termin ohne Start", JSON.stringify([{ summary: "ohne Zeit" }]), 0],
];

let fehler = 0;
for (const [name, eingabe, erwartet] of faelle) {
  let ergebnis, absturz = null;
  try { ergebnis = termineLesen(eingabe); } catch (e) { absturz = e.message; }
  const ok = !absturz && Array.isArray(ergebnis) && ergebnis.length === erwartet;
  if (!ok) fehler++;
  console.log(`${ok ? "✅" : "❌"} ${name}` +
    (absturz ? ` — ABSTURZ: ${absturz}` : ` — ${ergebnis.length} Termin(e), erwartet ${erwartet}`));
}

const echt = termineLesen(JSON.stringify({ events: { data: JSON.stringify([termin]) } }))[0];
const titelOk = echt && echt.titel === "Erstgespräch Physio Schwabing" && echt.start.startsWith("2026-07-21");
console.log(`${titelOk ? "✅" : "❌"} Titel und Startzeit korrekt gelesen` + (echt ? ` — "${echt.titel}" um ${echt.start}` : ""));
if (!titelOk) fehler++;

console.log(fehler ? `\n${fehler} Fehler` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
