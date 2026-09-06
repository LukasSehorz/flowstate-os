// lib/whiteboard-speicher.js — Datenzugriff fuer die Whiteboard-Wand.
//
// Zwei Implementierungen mit IDENTISCHER Schnittstelle:
//
//   pgSpeicher()               Supabase-Postgres ueber lib/crm.js (RLS aktiv)
//   speicherImArbeitsspeicher() eine Map im Prozess — fuer scripts/whiteboard-probe.js,
//                              damit Oberflaeche und Ablauf OHNE Datenbank und ohne
//                              echte Konten getestet werden koennen. Im Betrieb
//                              laeuft IMMER pgSpeicher (server.js laedt das Modul
//                              nur mit DATABASE_URL); der Arbeitsspeicher ist kein
//                              stiller Ersatz, sondern wird von der Probe
//                              ausdruecklich uebergeben.
//
// Alle Funktionen nehmen den Sitzungs-Nutzer ({id, name, rolle, ...}) als erstes
// Argument. Lesen liefert ALLE Boards (jeder sieht jeden — wie an der Buerowand).
// Jedes Element kennt zwei Personen: besitzer (der AUTOR) und tafel (auf wessen
// Board es steht) — auseinander gehen die, wenn jemand einem anderen eine
// Aufgabe auf die Tafel schreibt (31.08.2026). Anlegen darf jeder ueberall
// (besitzer wird IMMER auf die eigene id gesetzt, egal was der Client schickt);
// aendern/loeschen duerfen genau zwei: Autor und Tafel-Besitzer. Das steht
// zusaetzlich in jeder WHERE-Klausel, obwohl RLS es schon erzwingt: Der
// Arbeitsspeicher hat kein RLS, und die Regel soll an beiden Orten dieselbe sein.
//
// "inhalt" reist hier als fertiger JSON-TEXT hinein (whiteboard-routes.js prueft
// und serialisiert vor dem Speichern) und kommt als geparstes Objekt heraus.
// Eine Zeile, deren JSON nicht parst, wird beim Lesen UEBERSPRUNGEN und gemeldet
// statt geworfen — ein kaputter Datensatz darf nie die ganze Wand reissen.
//
// Seit 05.09.2026 liest auch die Bruecke aus dem CRM hier (lib/aufgaben-tafel.js:
// eine Kunden-Aufgabe wird als Zeile auf die Tafel des Verantwortlichen
// geschrieben). Dafuer gibt es holen() und vonTafel(), aendern() liefert den
// VORHERIGEN Inhalt mit zurueck (vorher) — so sieht die Route, welche Zeile mit
// Aufgaben-Bezug gerade abgehakt wurde, ohne zweite Abfrage und ohne Wettlauf —
// und gesperrt(): mehrere Schritte (Block suchen, anhaengen oder neu anlegen)
// in EINER Transaktion, waehrend eine Sperre je Tafel gehalten wird. Ohne die
// Sperre legten vier gleichzeitig angelegte Aufgaben vier Kunden-Bloecke an,
// weil jede den Block der anderen noch nicht sah (Pruefung vom 05.09.).
//
// Deshalb sind die Postgres-Operationen als Funktionen der Abfrage q EINER
// Transaktion geschrieben (operationen(q, user)): einzeln aufgerufen bekommt
// jede ihre eigene alsNutzer-Transaktion, in gesperrt() teilen sie sich eine.

const crm = require("./crm.js");

// Delta-Abfragen fragen 10 Sekunden VOR dem uebergebenen Stand an. Grund:
// "geaendert" traegt die Zeit des Transaktionsbeginns. Eine langsame Transaktion
// kann also mit einem AELTEREN Stempel abschliessen, als ein parallel laufender
// Poll schon gemeldet hat — und das Element waere fuer immer verpasst ("steht
// erst nach Neuladen da"). Mit dem Fenster kommen solche Zeilen einfach noch
// einmal; das ist gratis, weil der Browser idempotent per id einpflegt.
const UEBERLAPPUNG_MS = 10000;

// Millisekunden-genau, wie date_trunc('milliseconds', now()) in der Migration:
// JavaScript kennt keine Mikrosekunden, und die Zeitstempel sollen verlustfrei
// als ISO-Text hin- und zurueckreisen.
const jetztMs = () => new Date(Math.floor(Date.now()));

// Der alte Inhalt, den aendern() zurueckgibt — geparst wie beim Lesen, und
// bei kaputtem JSON null statt Fehler: Das Schreiben ist da schon geglueckt.
const inhaltAus = (text) => { try { return JSON.parse(text); } catch { return null; } };

function elementAus(zeile) {
  let inhalt;
  try { inhalt = JSON.parse(zeile.inhalt); }
  catch {
    console.error("Whiteboard: Element", zeile.id, "hat kaputtes JSON — uebersprungen.");
    return null;
  }
  return {
    id: zeile.id, besitzer: zeile.besitzer, tafel: zeile.tafel, art: zeile.art,
    x: zeile.x, y: zeile.y, breite: zeile.breite, hoehe: zeile.hoehe,
    inhalt, version: zeile.version,
    erstellt: zeile.erstellt, geaendert: zeile.geaendert,
  };
}

// Die Namen, die beide Fassungen nach aussen tragen (jeweils mit user als
// erstem Argument). gesperrt() reicht dieselben Namen OHNE user herein.
const OPERATIONEN = ["alle", "delta", "anzahl", "holen", "vonTafel",
                     "anlegen", "aendern", "loeschen", "wiederherstellen", "wischen"];

// ---------------------------------------------------------------- Postgres
function pgSpeicher() {
  const FELDER = "id, besitzer, tafel, art, x, y, breite, hoehe, inhalt, version, erstellt, geaendert";

  // "Zuletzt aktiv" je BOARD (tafel, nicht Autor) — fuer das Namensschild am
  // Rahmen. Geloeschte zaehlen mit: Wer gerade die halbe Tafel gewischt hat,
  // war aktiv. "besitzer" steht als zweiter Schluessel mit demselben Wert
  // dabei, weil der Client der ersten Fassung das Feld so nennt — beide
  // Namen tragen die Tafel.
  const aktivitaetSql = `select tafel as besitzer, tafel, max(geaendert) as letzte
                           from whiteboard_elemente group by tafel`;

  // Alle Operationen gegen die Abfrage q EINER Transaktion, fuer EINEN Nutzer.
  function operationen(q, user) {
    return {
      // Der komplette Stand fuer den Seitenaufbau — ohne Tombstones.
      async alle() {
        const [elemente, aktivitaet, jetzt] = await Promise.all([
          q(`select ${FELDER} from whiteboard_elemente
              where geloescht is null order by erstellt, id`),
          q(aktivitaetSql),
          q(`select date_trunc('milliseconds', now()) as jetzt`),
        ]);
        return {
          jetzt: jetzt.rows[0].jetzt,
          elemente: elemente.rows.map(elementAus).filter(Boolean),
          aktivitaet: aktivitaet.rows,
        };
      },

      // Was sich seit "seit" getan hat (inkl. Tombstones), plus neuer Serverstand.
      // Der optionale Filter meint das BOARD (tafel), nicht den Autor — er ist
      // fuer spaeteres board-weises Nachladen gedacht.
      async delta({ seit, tafel = "" } = {}) {
        const args = [new Date(new Date(seit).getTime() - UEBERLAPPUNG_MS)];
        let filter = "";
        if (tafel) { args.push(tafel); filter = ` and tafel = $${args.length}`; }
        const [rows, aktivitaet, jetzt] = await Promise.all([
          q(`select ${FELDER}, geloescht from whiteboard_elemente
              where geaendert > $1${filter} order by erstellt, id`, args),
          q(aktivitaetSql),
          q(`select date_trunc('milliseconds', now()) as jetzt`),
        ]);
        const elemente = [], geloescht = [];
        for (const z of rows.rows) {
          if (z.geloescht) { geloescht.push(z.id); continue; }
          const el = elementAus(z);
          if (el) elemente.push(el);
        }
        return { jetzt: jetzt.rows[0].jetzt, elemente, geloescht, aktivitaet: aktivitaet.rows };
      },

      // Wie viele Elemente liegen auf einem Board? (Deckel gegen Wildwuchs —
      // gezaehlt wird das ZIEL-Board, denn dort landet das neue Element.)
      async anzahl(tafel) {
        const { rows } = await q(
          `select count(*)::int as n from whiteboard_elemente
            where tafel = $1 and geloescht is null`, [tafel || user.id]);
        return rows[0].n;
      },

      // EIN Element nach id — auch ein weich geloeschtes (dann mit "geloescht"
      // gesetzt), damit die Bruecke "Zeile ist weg" von "Element gibt es nicht"
      // unterscheiden kann. null, wenn es nie existiert hat.
      async holen(id) {
        const { rows } = await q(
          `select ${FELDER}, geloescht from whiteboard_elemente where id = $1`, [id]);
        if (!rows.length) return null;
        const el = elementAus(rows[0]);
        if (!el) return null;
        el.geloescht = rows[0].geloescht || null;
        return el;
      },

      // Alle lebenden Elemente EINES Boards, aelteste zuerst. Die Bruecke sucht
      // darin den Kunden-Block und freie Flaeche fuer einen neuen.
      async vonTafel(tafel) {
        const { rows } = await q(
          `select ${FELDER} from whiteboard_elemente
            where tafel = $1 and geloescht is null order by erstellt, id`, [tafel || user.id]);
        return rows.map(elementAus).filter(Boolean);
      },

      // id kommt vom Client; ein Doppelter (Retry nach Netzwackler) faellt still
      // durch "do nothing" — genau das gewuenschte Verhalten. besitzer ist IMMER
      // die angemeldete Person; die Tafel darf eine andere sein (Aufgabe geben).
      async anlegen(el) {
        await q(
          `insert into whiteboard_elemente (id, besitzer, tafel, art, x, y, breite, hoehe, inhalt)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (id) do nothing`,
          [el.id, user.id, el.tafel || user.id, el.art, el.x, el.y, el.breite, el.hoehe, el.inhalt]);
        return { ok: true, version: 1 };
      },

      // Schreibt nur, wenn der Client die Version nennt, die wirklich in der
      // Datenbank steht — sonst hat eine andere Sitzung (zweiter Tab, oder der
      // Autor bzw. Tafel-Besitzer auf der anderen Seite) dazwischen gespeichert,
      // und stilles Ueberschreiben waere Datenverlust. Der Aufrufer bekommt den
      // Grund und holt sich den echten Stand. Schreiben duerfen Autor UND
      // Tafel-Besitzer (abhaken einer erhaltenen Aufgabe).
      async aendern({ id, version, art, x, y, breite, hoehe, inhalt }) {
        const set = [], args = [id, user.id, version, art];
        const feld = (name, wert) => {
          if (wert === undefined) return;
          args.push(wert); set.push(`${name} = $${args.length}`);
        };
        feld("x", x); feld("y", y); feld("breite", breite); feld("hoehe", hoehe);
        feld("inhalt", inhalt);
        if (!set.length) return { ok: false, grund: "leer" };
        // Der alte Inhalt kommt aus einer Unterabfrage IM SELBEN Befehl: sie
        // sieht den Stand vor dem Update, und es ist derselbe Stand, gegen
        // den die Versionspruefung laeuft — kein zweites Lesen, kein Fenster,
        // in dem jemand dazwischenschreiben koennte.
        const r = await q(
          `update whiteboard_elemente w set ${set.join(", ")}
             from (select id, inhalt from whiteboard_elemente where id = $1) alt
            where w.id = alt.id and (w.besitzer = $2 or w.tafel = $2) and w.version = $3
              and w.art = $4 and w.geloescht is null
            returning w.version, w.geaendert, alt.inhalt as vorher`, args);
        if (r.rows.length) {
          return { ok: true, version: r.rows[0].version, geaendert: r.rows[0].geaendert,
                   vorher: inhaltAus(r.rows[0].vorher) };
        }
        // Nichts geschrieben — warum? Fuer die Antwort an den Browser macht es
        // den Unterschied zwischen "neu laden" (veraltet) und "weg damit" (fehlt).
        const da = await q(
          `select version, geloescht from whiteboard_elemente
            where id = $1 and (besitzer = $2 or tafel = $2)`, [id, user.id]);
        if (!da.rows.length || da.rows[0].geloescht) return { ok: false, grund: "fehlt" };
        return { ok: false, grund: "veraltet", version: da.rows[0].version };
      },

      async loeschen(ids) {
        const r = await q(
          `update whiteboard_elemente set geloescht = now()
            where id = any($1::uuid[]) and (besitzer = $2 or tafel = $2) and geloescht is null
            returning id`, [ids, user.id]);
        return { ok: true, ids: r.rows.map((z) => z.id) };
      },

      async wiederherstellen(ids) {
        const r = await q(
          `update whiteboard_elemente set geloescht = null
            where id = any($1::uuid[]) and (besitzer = $2 or tafel = $2) and geloescht is not null
            returning id`, [ids, user.id]);
        return { ok: true, ids: r.rows.map((z) => z.id) };
      },

      // Die ganze eigene Tafel auf einmal — EIN now() fuer alle, und die ids
      // kommen zurueck, damit Undo genau diese Menge wiederherstellen kann.
      // Gewischt wird das BOARD (tafel = ich), also auch Aufgaben, die andere
      // hingeschrieben haben — wie am echten Whiteboard. Undo holt alles zurueck.
      async wischen() {
        const r = await q(
          `update whiteboard_elemente set geloescht = now()
            where tafel = $1 and geloescht is null
            returning id`, [user.id]);
        return { ok: true, ids: r.rows.map((z) => z.id) };
      },
    };
  }

  const speicher = {
    // Mehrere Schritte in EINER Transaktion, waehrend eine Sperre je Tafel
    // gehalten wird (pg_advisory_xact_lock: faellt mit commit/rollback von
    // selbst). Wer die Tafel gerade gesperrt hat, laesst den Naechsten warten,
    // statt dass beide nebeneinander denselben Block anlegen. fn bekommt die
    // Operationen ohne user-Argument — sie laufen als der Nutzer, der sperrt.
    async gesperrt(user, tafel, fn) {
      return crm.alsNutzer(user.id, async (q) => {
        await q(`select pg_advisory_xact_lock(hashtext($1))`, [String(tafel || user.id)]);
        return fn(operationen(q, user));
      });
    },

    // Tombstones, deren Undo-Fenster laengst vorbei ist, endgueltig entfernen.
    // Laeuft ueber crm.system() als Datenbank-Eigentuemer an RLS vorbei —
    // der einzige harte Loeschweg.
    async aufraeumen() {
      const r = await crm.system(
        `delete from whiteboard_elemente where geloescht < now() - interval '30 days'`);
      return r.rowCount || 0;
    },
  };
  for (const name of OPERATIONEN) {
    speicher[name] = (user, ...args) => crm.alsNutzer(user.id, (q) => operationen(q, user)[name](...args));
  }
  return speicher;
}

// ---------------------------------------------------------------- Arbeitsspeicher
function speicherImArbeitsspeicher() {
  const ablage = new Map(); // id -> Zeile (inhalt als Text, wie in der Datenbank)

  // Bearbeiten duerfen genau zwei: Autor (besitzer) und Tafel-Besitzer —
  // dieselbe Regel wie die RLS-Policies der Postgres-Fassung.
  const bearbeitbar = (user, id) => {
    const z = ablage.get(id);
    return z && (z.besitzer === user.id || z.tafel === user.id) ? z : null;
  };
  const aktivitaet = () => {
    const je = new Map();
    for (const z of ablage.values()) {
      const bisher = je.get(z.tafel);
      if (!bisher || z.geaendert > bisher) je.set(z.tafel, z.geaendert);
    }
    return [...je.entries()].map(([tafel, letzte]) => ({ besitzer: tafel, tafel, letzte }));
  };
  const beruehren = (z) => { z.version += 1; z.geaendert = jetztMs(); };

  function operationen(user) {
    return {
      async alle() {
        const elemente = [...ablage.values()]
          .filter((z) => !z.geloescht)
          .sort((a, b) => a.erstellt - b.erstellt || String(a.id).localeCompare(String(b.id)))
          .map(elementAus).filter(Boolean);
        return { jetzt: jetztMs(), elemente, aktivitaet: aktivitaet() };
      },

      async delta({ seit, tafel = "" } = {}) {
        const ab = new Date(seit).getTime() - UEBERLAPPUNG_MS;
        const elemente = [], geloescht = [];
        for (const z of ablage.values()) {
          if (z.geaendert.getTime() <= ab) continue;
          if (tafel && z.tafel !== tafel) continue;
          if (z.geloescht) { geloescht.push(z.id); continue; }
          const el = elementAus(z);
          if (el) elemente.push(el);
        }
        elemente.sort((a, b) => new Date(a.erstellt) - new Date(b.erstellt));
        return { jetzt: jetztMs(), elemente, geloescht, aktivitaet: aktivitaet() };
      },

      async anzahl(tafel) {
        const ziel = tafel || user.id;
        let n = 0;
        for (const z of ablage.values()) if (z.tafel === ziel && !z.geloescht) n++;
        return n;
      },

      async holen(id) {
        const z = ablage.get(id);
        if (!z) return null;
        const el = elementAus(z);
        if (!el) return null;
        el.geloescht = z.geloescht || null;
        return el;
      },

      async vonTafel(tafel) {
        const ziel = tafel || user.id;
        return [...ablage.values()]
          .filter((z) => z.tafel === ziel && !z.geloescht)
          .sort((a, b) => a.erstellt - b.erstellt || String(a.id).localeCompare(String(b.id)))
          .map(elementAus).filter(Boolean);
      },

      async anlegen(el) {
        if (!ablage.has(el.id)) {
          ablage.set(el.id, {
            id: el.id, besitzer: user.id, tafel: el.tafel || user.id, art: el.art,
            x: el.x, y: el.y, breite: el.breite, hoehe: el.hoehe,
            inhalt: el.inhalt, version: 1, erstellt: jetztMs(), geaendert: jetztMs(),
            geloescht: null,
          });
        }
        return { ok: true, version: 1 };
      },

      async aendern({ id, version, art, x, y, breite, hoehe, inhalt }) {
        const z = bearbeitbar(user, id);
        if (!z || z.geloescht) return { ok: false, grund: "fehlt" };
        if (z.version !== version || z.art !== art) return { ok: false, grund: "veraltet", version: z.version };
        const vorher = inhaltAus(z.inhalt);
        if (x !== undefined) z.x = x;
        if (y !== undefined) z.y = y;
        if (breite !== undefined) z.breite = breite;
        if (hoehe !== undefined) z.hoehe = hoehe;
        if (inhalt !== undefined) z.inhalt = inhalt;
        beruehren(z);
        return { ok: true, version: z.version, geaendert: z.geaendert, vorher };
      },

      async loeschen(ids) {
        const weg = [];
        for (const id of ids) {
          const z = bearbeitbar(user, id);
          if (!z || z.geloescht) continue;
          z.geloescht = jetztMs(); beruehren(z); weg.push(id);
        }
        return { ok: true, ids: weg };
      },

      async wiederherstellen(ids) {
        const zurueck = [];
        for (const id of ids) {
          const z = bearbeitbar(user, id);
          if (!z || !z.geloescht) continue;
          z.geloescht = null; beruehren(z); zurueck.push(id);
        }
        return { ok: true, ids: zurueck };
      },

      // Gewischt wird das BOARD (tafel = ich) — wie in der Postgres-Fassung.
      async wischen() {
        const weg = [];
        for (const z of ablage.values()) {
          if (z.tafel !== user.id || z.geloescht) continue;
          z.geloescht = jetztMs(); beruehren(z); weg.push(z.id);
        }
        return { ok: true, ids: weg };
      },
    };
  }

  // Die Sperre je Tafel: eine Kette von Versprechen. Wer als Zweiter kommt,
  // startet erst, wenn der Erste fertig ist — dieselbe Wirkung wie die
  // Advisory-Sperre in Postgres, nur im Prozess.
  const sperren = new Map();

  const speicher = {
    async gesperrt(user, tafel, fn) {
      const schluessel = String(tafel || user.id);
      const vorher = sperren.get(schluessel) || Promise.resolve();
      const lauf = vorher.then(() => fn(operationen(user)));
      sperren.set(schluessel, lauf.catch(() => {}));
      return lauf;
    },

    async aufraeumen() {
      const grenze = Date.now() - 30 * 24 * 3600 * 1000;
      let n = 0;
      for (const [id, z] of ablage) {
        if (z.geloescht && z.geloescht.getTime() < grenze) { ablage.delete(id); n++; }
      }
      return n;
    },
  };
  for (const name of OPERATIONEN) {
    speicher[name] = (user, ...args) => operationen(user)[name](...args);
  }
  return speicher;
}

module.exports = { pgSpeicher, speicherImArbeitsspeicher };
