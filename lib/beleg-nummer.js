// Die naechste Rechnungs- oder Angebotsnummer.
//
// Warum (Lukas, 07.08.2026): "Wichtig ist, dass ab jetzt immer die Nummer
// richtig nummeriert ist. Es soll sich ab jetzt immer aufsteigend nummeriert
// werden."
//
// EIN durchlaufender Kreis je Art, nicht getrennt nach Sparte — so ist es im
// Bestand gewachsen (R-2026-126 Social Media liegt mitten in der
// Website-Reihe), und ein Wechsel mitten im Jahr ist genau die Art Bruch, die
// bei einer Betriebspruefung auffaellt.
//
// Stand am 07.08. aus Lukas' Ordner ausgelesen:
//   Rechnungen  bis R-2026-130
//   Angebote    bis A-2026-118
//
// WO DER ZAEHLER LEBT: in der Datenbank, nicht im Ordner. Der Ordner liegt auf
// Lukas' Rechner in OneDrive — der Server kommt nicht heran, und selbst wenn:
// Zwei Quellen fuer dieselbe Nummer sind zwei Gelegenheiten, sie doppelt zu
// vergeben. Eine doppelte Rechnungsnummer ist ein echter Buchhaltungsfehler.
//
// Die Vergabe laeuft in EINER Anweisung (insert ... returning), damit zwei
// gleichzeitige Anfragen nicht dieselbe Nummer bekommen. Das ist kein
// theoretischer Fall: Lukas und Jannik arbeiten parallel.

const { Pool } = require("pg");

// Startwerte, falls die Tabelle noch leer ist. Bewusst die zuletzt VERGEBENEN
// Nummern — die naechste ist dann eins hoeher.
const START = { rechnung: 130, angebot: 118 };
const PRAEFIX = { rechnung: "R", angebot: "A" };

let pool = null;
function db() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 2, idleTimeoutMillis: 20000,
    });
    pool.on("error", () => {});
  }
  return pool;
}

// Die Tabelle wird beim ersten Aufruf angelegt — kein eigener Migrationsschritt
// fuer zwei Spalten.
let bereit = false;
async function tabelle(q) {
  if (bereit) return;
  await q(`create table if not exists beleg_nummern (
             art text not null,
             jahr int not null,
             nummer int not null,
             vergeben_am timestamptz not null default now(),
             wofuer text,
             primary key (art, jahr, nummer)
           )`);
  bereit = true;
}

// Vergibt die naechste Nummer und HAELT SIE FEST. Wer sie holt, hat sie
// verbraucht — auch wenn die Rechnung danach nicht fertig wird.
//
// Das ist Absicht: Eine Luecke im Nummernkreis ist erklaerbar ("storniert"),
// eine doppelt vergebene Nummer nicht. Lukas hat am 07.08. selbst gesehen, dass
// R-2026-129 im Bestand fehlt — das ist unschoen, aber harmlos.
async function naechste(art = "rechnung", wofuer = "") {
  const a = PRAEFIX[art] ? art : "rechnung";
  const jahr = new Date().getFullYear();
  const c = await db().connect();
  try {
    await tabelle((sql, w) => c.query(sql, w));
    // Hoechste bekannte Nummer — aus der Tabelle ODER dem Startwert.
    const { rows } = await c.query(
      `insert into beleg_nummern (art, jahr, nummer, wofuer)
       select $1, $2,
              greatest(coalesce((select max(nummer) from beleg_nummern where art = $1 and jahr = $2), 0), $3) + 1,
              $4
       returning nummer`,
      [a, jahr, jahr === 2026 ? START[a] : 0, String(wofuer || "").slice(0, 200)]);
    const n = rows[0].nummer;
    return { ok: true, nummer: `${PRAEFIX[a]}-${jahr}-${n}`, zahl: n, jahr };
  } catch (e) {
    return { ok: false, hint: String(e.message).slice(0, 150) };
  } finally {
    c.release();
  }
}

// Nur nachsehen, ohne zu vergeben — fuer "welche Nummer bekaeme die naechste?"
async function stand(art = "rechnung") {
  const a = PRAEFIX[art] ? art : "rechnung";
  const jahr = new Date().getFullYear();
  try {
    const c = await db().connect();
    try {
      await tabelle((sql, w) => c.query(sql, w));
      const { rows } = await c.query(
        `select coalesce(max(nummer), 0) as n from beleg_nummern where art = $1 and jahr = $2`, [a, jahr]);
      const hoechste = Math.max(Number(rows[0].n) || 0, jahr === 2026 ? START[a] : 0);
      return { ok: true, letzte: `${PRAEFIX[a]}-${jahr}-${hoechste}`, naechste: `${PRAEFIX[a]}-${jahr}-${hoechste + 1}` };
    } finally { c.release(); }
  } catch (e) {
    return { ok: false, hint: String(e.message).slice(0, 150) };
  }
}

module.exports = { naechste, stand, START };
