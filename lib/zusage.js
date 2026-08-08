// Die Sofortzusage — Alexandra reagiert, bevor sie zu Ende gedacht hat.
//
// Warum es das gibt (Lukas, 08.08.2026, fuer die Meta-Ads): "Es ist wichtig,
// dass sich das wie ein Gespraech anfuehlt und sie gleich sagt: ja, mach ich,
// ich setz mich ran. Ohne dass man feste Saetze baut — sie soll von sich aus
// beschreiben, was sie gerade macht."
//
// DAS GEMESSENE PROBLEM. Der Hauptaufruf braucht 3,4 bis 8,5 Sekunden, und
// erst danach existiert ueberhaupt ein Satz. Am 08.08. gemessen, am echten
// Strom:
//
//   4.424 ms  erster Satz geht raus ("Schau ich beides an.")
//   4.439 ms  Modell fertig
//
// Der Strom bringt hier also nichts: Das Modell schreibt den Text erst, wenn
// es fertig entschieden hat. Jede Zusage aus diesem Aufruf kommt zwangslaeufig
// zu spaet — Lukas sitzt vier Sekunden vor einem stummen Geraet.
//
// DIE LOESUNG IST EINE ZWEITE SPUR, kein Trick am ersten. Ein winziger Aufruf,
// der NUR das Gehoerte sieht und nichts entscheidet: keine Werkzeuge, kein
// STAND, kein Verlauf. Er beantwortet eine einzige Frage — "was sagt man
// darauf, bevor man loslegt?" — und ist in einer halben Sekunde zurueck.
//
// BEWUSST SEHR KURZ (ein bis vier Woerter). Sie reagiert nur; WAS sie tut,
// sagt gleich darauf der Hauptaufruf. Zwei vollstaendige Ansagen hintereinander
// waeren doppelt gemoppelt — "Mach ich." gefolgt von "Wetter schau ich nach und
// guck gleich nach den Mails" klingt dagegen wie ein Mensch.
//
// KEINE FESTE LISTE. Genau das wollte Lukas nicht, und die alte Blitz-Zusage
// (A1, 26.07.) ist daran gescheitert: Immer derselbe Satz klingt nach
// Warteschleife. Das Modell formuliert jedes Mal neu und passend zum Gehoerten.

const schnell = require("./schnell.js");
const stimme = require("./stimme.js");

// Was nicht angesagt wird: Rueckfragen, Bestaetigungen, Geplauder. Bei "ja,
// mach das" oder "danke" waere eine Zusage sinnlos — die Antwort selbst ist
// die Reaktion. Das entscheidet das Modell, nicht eine Wortliste hier.
const ANWEISUNG =
  "Lukas hat dir gerade etwas gesagt. Du hast es gehoert, aber noch nicht " +
  "verarbeitet — du brauchst gleich ein paar Sekunden dafuer.\n\n" +
  "Gib NUR die spontane Reaktion aus, ein bis vier Woerter, wie im Gespraech: " +
  "\"Mach ich.\" \"Schau ich nach.\" \"Bin dran.\" \"Klar, Moment.\" " +
  "Passend zum Gehoerten und jedes Mal anders formuliert.\n\n" +
  "NICHT sagen, WAS du nachsiehst oder findest — das kommt gleich von selbst. " +
  "Nichts versprechen, nichts beantworten, nicht nachfragen, keine Zahlen.\n\n" +
  "Antworte mit genau NICHTS, wenn eine Reaktion unpassend waere: bei blossem " +
  "Geplauder, Dank, Zustimmung (\"ja\", \"passt\", \"mhm\"), bei einer Frage, die " +
  "man in einem Wort beantwortet, oder wenn du gerade nur bestaetigen sollst.";

// Wie lange wir hoechstens darauf warten.
//
// 1,8 s waren zu knapp: Beim WhatsApp-Test am 08.08. kam die Zusage gar nicht,
// weil der Aufruf knapp darueber lag — und der Hauptaufruf brauchte dann 5,9 s.
// Ein Aufschlag von 2,5 s schadet nichts: Ist der Hauptaufruf frueher fertig,
// wird die Zusage ohnehin verworfen (gestroemt-Pruefung im Aufrufer). Zu spaet
// heisst hier nur "nicht gebraucht", nicht "stoert".
const GRENZE_MS = Number(process.env.ZUSAGE_TIMEOUT_MS || 2500);

async function sofort(gehoert) {
  const text = String(gehoert || "").trim();
  // Rauschen der Spracherkennung ("[Stille]", "[Geraeusch]") verdient keine
  // Reaktion — darauf antwortet der Hauptaufruf ohnehin passend.
  if (!text || text.length < 4 || /^\[[^\]]*\]$/.test(text)) return null;
  if (!process.env.SCHNELL_API_KEY) return null;
  try {
    const roh = await schnell.frage(
      // Der Charakter geht mit, sonst klingt die Zusage nach jemand anderem als
      // der Rest der Antwort — und das faellt genau im Gespraech auf.
      stimme.laden() + "\n\n## Aufgabe\n" + ANWEISUNG,
      text,
      { maxTokens: 24, temp: 0.8, timeoutMs: GRENZE_MS,
        model: process.env.ZUSAGE_MODEL || "claude-haiku-4-5" }
    );
    const s = String(roh || "").trim().replace(/^["„»]+|["“«]+$/g, "");
    if (!s || /^nichts\b/i.test(s)) return null;
    // REGIEANWEISUNGEN AUSSORTIEREN. Auf "alles klar, danke dir" antwortete das
    // Modell am 08.08. woertlich mit "*stille*" — und das waere vorgelesen
    // worden. Modelle beschreiben Schweigen gern, statt zu schweigen.
    if (/^[*_(\[<]/.test(s) || /\b(stille|schweigen|keine antwort|pause)\b/i.test(s)) return null;
    // Sicherung gegen einen ausufernden Satz: Was hier zu lang wird, nimmt dem
    // Hauptaufruf die Antwort vorweg.
    if (s.length > 60 || s.split(/\s+/).length > 8) return null;
    return s;
  } catch { return null; }
}

module.exports = { sofort, GRENZE_MS };
