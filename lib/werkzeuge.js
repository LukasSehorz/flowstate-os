// Der Werkzeugkasten (P2.2) — feste, direkt ausfuehrbare Handgriffe.
//
// Warum es diese Datei gibt: Hermes hat die gws-cli-Syntax wiederholt
// verhauen (vier dokumentierte Fehlversuche 19.-21.07., jedes Mal andere
// Argumentfehler) — ein Agent, der Kommandozeilen raet, ist fuer
// Standard-Aktionen die falsche Maschine. Hier steht jede Aktion als
// getestete Funktion mit fester Syntax. Kein Agent-Loop, keine Skills:
// Aufruf -> Ergebnis in 1-2 s.
//
// Freigabe-Regel (REGELN.md + Entscheidung 21.07.): Nach aussen nur mit
// Bestaetigung — AUSSER der Empfaenger steht auf der internen Whitelist
// (Lukas selbst, Jannik, weitere via INTERN_EMPFAENGER in .env).

const { execFile } = require("child_process");

const GWS_ENV = { ...process.env, GWS_ENCRYPTION: "none" };

// gws-cli gmail send {to} {subject} [body] — Positionsargumente, exakt diese
// Reihenfolge. Genau die Syntax, an der Hermes wiederholt gescheitert ist.
function gws(args, timeoutMs = 25000) {
  return new Promise((ok, fehler) => {
    execFile("gws-cli", args, { env: GWS_ENV, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return fehler(new Error(String(stderr || err.message).slice(0, 300)));
      ok(String(stdout || ""));
    });
  });
}

// Interne Empfaenger: Versand ohne Rueckfrage erlaubt.
function internAdressen() {
  return (process.env.INTERN_EMPFAENGER ||
    "lukas.sehorz@hotmail.com,lukas.sehorz@flowstate-ai.net")
    .toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
}

function istIntern(mail) {
  return internAdressen().includes(String(mail || "").toLowerCase().trim());
}

// Harter Riegel (REGELN.md §Freigabe): An EXTERNE Empfaenger wird nur mit
// ausdruecklicher Freigabe gesendet. Auch wenn ein Bug in der Weiche eine
// externe Mail durchreicht, kann sie hier nicht ungefragt rausgehen —
// Defense in Depth, nicht nur Vertrauen auf die Prompt-Logik.
async function mailSenden({ an, betreff, body }, { freigegeben = false } = {}) {
  if (!an || !betreff) throw new Error("mailSenden: Empfaenger und Betreff sind Pflicht.");
  if (!istIntern(an) && !freigegeben) {
    return { ok: false, gesperrt: true, an,
      grund: "Externer Empfaenger — braucht Freigabe (nicht auf der internen Whitelist)." };
  }
  const out = await gws(["gmail", "send", an, betreff, body || ""]);
  return { ok: true, an, betreff, raw: out.slice(0, 200) };
}

module.exports = { mailSenden, istIntern, internAdressen };
