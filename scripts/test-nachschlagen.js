// Testet, WORAUF eine Frage nach dem Stand zielt.
//
// Warum es das gibt (Lukas, 05.08.2026): "Das Ziel ist, dass Alexandra immer
// alles ueber das Unternehmen weiss wenn wir fragen: was ist der aktuelle Stand
// bei Projekt xyz, wie hat das Reel xyz performt, wie viele neue Formate haben
// wir, wie sieht es in der Buchhaltung aus."
//
// Geprueft wird hier die Deutung, nicht die Datenbank: Welche Art ist gemeint,
// und welcher Name steht in der Frage? Daran haengt alles — wer "Projekt
// Krotzer" als Firma sucht, findet die Firma statt des Projekts, und wer
// "laufen" fuer einen Projektnamen haelt, findet gar nichts.
//
// Aufruf: node scripts/test-nachschlagen.js

const { deuten } = require("../lib/nachschlagen.js");

let fehler = 0;
function pruefe(frage, art, name) {
  const d = deuten(frage);
  const ok = d.art === art && d.name === name;
  console.log((ok ? "✅" : "❌") + ` "${frage}"` +
    (ok ? "" : `\n   erwartet: ${art}/"${name}"   bekommen: ${d.art}/"${d.name}"`));
  if (!ok) fehler++;
}

// --- Lukas' eigene Beispiele ----------------------------------------------
pruefe("was ist der aktuelle Stand bei Projekt Krotzer", "projekt", "Krotzer");
pruefe("wie hat das Reel Fassade performt", "post", "Fassade");
pruefe("wie sieht es in der Buchhaltung aus", "buchhaltung", "");
pruefe("wie viele neue Rechnungen kamen rein", "buchhaltung", "");
pruefe("wie viele neue Formate haben wir", "post", "");

// --- Firmen: mit und ohne Schluesselwort -----------------------------------
pruefe("was ist der Stand bei Kunde Sykora", "firma", "Sykora");
pruefe("wie laeuft es bei Krotzer und Eisele", "firma", "Krotzer und Eisele");
pruefe("wie ist der Stand im CRM", "firma", "");

// --- Ueberblicke ohne Namen ------------------------------------------------
//
// "laufen" und "gerade" sind Frageworte, keine Projektnamen. Der erste Entwurf
// hielt "laufen" fuer einen Namen und suchte ein Projekt namens "laufen" —
// gefunden haette er nie etwas.
pruefe("welche Projekte laufen gerade", "projekt", "");
pruefe("was ist bei den Projekten offen", "projekt", "");

// --- Content ---------------------------------------------------------------
pruefe("was macht das Video Fassadenreinigung", "post", "Fassadenreinigung");
pruefe("wie viele Abonnenten haben wir", "post", "");
pruefe("wie stehen die Kanäle", "post", "");

// --- Die Abgrenzung, an der es haengt --------------------------------------
//
// "Projekt X" darf NICHT als Firma gesucht werden, auch wenn die Firma so
// heisst. Umgekehrt genauso.
const p = deuten("Stand bei Projekt Sykora");
console.log((p.art === "projekt" ? "✅" : "❌") + " 'Projekt Sykora' sucht das PROJEKT, nicht die Firma");
if (p.art !== "projekt") fehler++;
const f = deuten("Stand bei Firma Sykora");
console.log((f.art === "firma" ? "✅" : "❌") + " 'Firma Sykora' sucht die FIRMA, nicht das Projekt");
if (f.art !== "firma") fehler++;

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen.` : "\nAlle Faelle bestanden.");
process.exit(fehler ? 1 : 0);
