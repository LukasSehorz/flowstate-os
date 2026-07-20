// Flowstate CRM — Datenbank (SQLite) + Row-Level-Security
// Grundsatz aus E1: "Sieht nur eigene" wird in JEDER Abfrage durchgesetzt,
// nicht durch ausgeblendete Menues. Jede Funktion bekommt den Nutzer mit.
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const DATA_PATH = process.env.DATA_PATH || "/data";
if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });
const db = new Database(path.join(DATA_PATH, "crm.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  passwort_hash TEXT NOT NULL,
  rolle TEXT NOT NULL CHECK(rolle IN ('admin','mitarbeiter')),
  aktiv INTEGER NOT NULL DEFAULT 1,
  erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  firma TEXT,
  telefon TEXT,
  email TEXT,
  website TEXT,
  adresse TEXT,
  branche TEXT,
  quelle TEXT,                      -- cold-call, meta-ads, google-ads, funnel, empfehlung, mail, csv, lead-maschine
  topf TEXT,                        -- webdesign | performance | ki   (E4: drei Toepfe)
  status TEXT NOT NULL DEFAULT 'neu',        -- Pipeline-Stufe (E5)
  temperatur TEXT DEFAULT 'warm',            -- heiss | warm | kalt   (E10)
  tags TEXT DEFAULT '',                      -- kommagetrennt
  score INTEGER,                             -- aus der Lead-Maschine (1-10)
  argumente TEXT,                            -- Verkaufsargumente, kommagetrennt
  besitzer_id INTEGER REFERENCES users(id),
  liste TEXT,                                -- Name der Call-Liste (E4)
  versuche INTEGER NOT NULL DEFAULT 0,
  wiedervorlage TEXT,                        -- ISO-Datum
  verlust_grund TEXT,
  notiz TEXT,
  kunde_id INTEGER REFERENCES kunden(id),
  erstellt TEXT NOT NULL DEFAULT (datetime('now')),
  letzte_aktivitaet TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kunden (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firma TEXT NOT NULL,
  stand TEXT,                                -- E2: der Satz, den man vor dem Anruf wissen muss
  besonderes TEXT,                           -- aus "merk dir ..." (A2)
  besitzer_id INTEGER REFERENCES users(id),
  kunde_seit TEXT,
  aktiv INTEGER NOT NULL DEFAULT 1,
  erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kontakte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kunde_id INTEGER NOT NULL REFERENCES kunden(id) ON DELETE CASCADE,
  name TEXT NOT NULL, rolle TEXT, email TEXT, telefon TEXT, hinweis TEXT
);

CREATE TABLE IF NOT EXISTS aktivitaeten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  kunde_id INTEGER REFERENCES kunden(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  art TEXT NOT NULL,                         -- anruf, mail, notiz, termin, stufenwechsel, uebergabe, system
  text TEXT,
  zeit TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kunde_id INTEGER REFERENCES kunden(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  titel TEXT NOT NULL,
  faellig TEXT,
  erledigt INTEGER NOT NULL DEFAULT 0,
  besitzer_id INTEGER REFERENCES users(id),
  erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_besitzer ON leads(besitzer_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_akt_lead ON aktivitaeten(lead_id);
`);

// ---------- Nutzer ----------
function hash(pw) { return crypto.scryptSync(pw, "flowstate-crm", 32).toString("hex"); }

function seedUsers() {
  const n = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  if (n > 0) return;
  const startPw = process.env.DASHBOARD_PASSWORD || "flowstate";
  const anlegen = db.prepare("INSERT INTO users (name, login, passwort_hash, rolle) VALUES (?,?,?,?)");
  // E1: zwei Admins, drei Mitarbeiter. Startpasswort = Dashboard-Passwort, danach aendern.
  anlegen.run("Lukas Sehorz", "lukas", hash(startPw), "admin");
  anlegen.run("Jannik vom Hofe", "jannik", hash(startPw), "admin");
  anlegen.run("Ioannis", "ioannis", hash(startPw), "mitarbeiter");
  anlegen.run("Louis", "louis", hash(startPw), "mitarbeiter");
  anlegen.run("Simon", "simon", hash(startPw), "mitarbeiter");
}
seedUsers();

const users = {
  pruefe(login, pw) {
    const u = db.prepare("SELECT * FROM users WHERE login = ? AND aktiv = 1").get(String(login).toLowerCase().trim());
    if (!u) return null;
    const eingabe = Buffer.from(hash(pw));
    const gespeichert = Buffer.from(u.passwort_hash);
    if (eingabe.length !== gespeichert.length || !crypto.timingSafeEqual(eingabe, gespeichert)) return null;
    return { id: u.id, name: u.name, login: u.login, rolle: u.rolle };
  },
  alle() { return db.prepare("SELECT id, name, login, rolle, aktiv FROM users ORDER BY rolle, name").all(); },
  passwortSetzen(id, pw) { db.prepare("UPDATE users SET passwort_hash=? WHERE id=?").run(hash(pw), id); },
};

// ---------- Row-Level-Security ----------
// Admin sieht alles, Mitarbeiter nur eigene Datensaetze. Wird in JEDER Abfrage angewandt.
function rls(user, spalte = "besitzer_id") {
  if (!user) return { sql: " AND 1=0 ", args: [] };
  if (user.rolle === "admin") return { sql: "", args: [] };
  return { sql: ` AND (${spalte} = ? OR ${spalte} IS NULL)`, args: [user.id] };
}

// ---------- Leads ----------
const STUFEN = ["neu", "kontaktiert", "termin", "angebot", "verhandlung", "gewonnen", "verloren"];

const leads = {
  liste(user, { suche = "", status = "", topf = "", liste = "", limit = 200 } = {}) {
    const r = rls(user);
    let sql = `SELECT l.*, u.name AS besitzer FROM leads l LEFT JOIN users u ON u.id = l.besitzer_id WHERE 1=1`;
    const args = [];
    if (suche) { sql += ` AND (l.name LIKE ? OR l.firma LIKE ? OR l.email LIKE ? OR l.telefon LIKE ?)`; const s = `%${suche}%`; args.push(s, s, s, s); }
    if (status) { sql += ` AND l.status = ?`; args.push(status); }
    if (topf) { sql += ` AND l.topf = ?`; args.push(topf); }
    if (liste) { sql += ` AND l.liste = ?`; args.push(liste); }
    sql += r.sql.replace(/besitzer_id/g, "l.besitzer_id");
    args.push(...r.args);
    sql += ` ORDER BY (l.wiedervorlage IS NOT NULL AND l.wiedervorlage <= date('now')) DESC, l.score DESC, l.letzte_aktivitaet DESC LIMIT ?`;
    args.push(limit);
    return db.prepare(sql).all(...args);
  },

  einer(user, id) {
    const r = rls(user);
    return db.prepare(`SELECT l.*, u.name AS besitzer FROM leads l LEFT JOIN users u ON u.id=l.besitzer_id WHERE l.id = ?${r.sql.replace(/besitzer_id/g, "l.besitzer_id")}`).get(id, ...r.args);
  },

  anlegen(user, d) {
    // E11: Dubletten-Wache — Name, Telefon oder Website
    let dublette = null;
    if (d.telefon || d.website || d.name) {
      dublette = db.prepare(`SELECT l.id, l.name, u.name AS besitzer FROM leads l LEFT JOIN users u ON u.id=l.besitzer_id
        WHERE (? != '' AND l.telefon = ?) OR (? != '' AND l.website = ?) OR (? != '' AND lower(l.name) = lower(?)) LIMIT 1`)
        .get(d.telefon || "", d.telefon || "", d.website || "", d.website || "", d.name || "", d.name || "");
    }
    const info = db.prepare(`INSERT INTO leads (name, firma, telefon, email, website, adresse, branche, quelle, topf, status, tags, score, argumente, besitzer_id, liste, notiz)
      VALUES (@name,@firma,@telefon,@email,@website,@adresse,@branche,@quelle,@topf,@status,@tags,@score,@argumente,@besitzer_id,@liste,@notiz)`).run({
      name: d.name, firma: d.firma || null, telefon: d.telefon || null, email: d.email || null, website: d.website || null,
      adresse: d.adresse || null, branche: d.branche || null, quelle: d.quelle || "manuell", topf: d.topf || null,
      status: d.status || "neu", tags: d.tags || "", score: d.score || null, argumente: d.argumente || null,
      besitzer_id: d.besitzer_id || user.id, liste: d.liste || null, notiz: d.notiz || null,
    });
    aktivitaeten.anlegen(user, { lead_id: info.lastInsertRowid, art: "system", text: `Lead angelegt (Quelle: ${d.quelle || "manuell"})` });
    return { id: info.lastInsertRowid, dublette };
  },

  aendern(user, id, felder) {
    const lead = leads.einer(user, id);
    if (!lead) return false;
    const erlaubt = ["name", "firma", "telefon", "email", "website", "branche", "topf", "status", "temperatur", "tags", "notiz", "besitzer_id", "wiedervorlage", "verlust_grund", "liste"];
    const sets = [], args = [];
    for (const [k, v] of Object.entries(felder)) if (erlaubt.includes(k)) { sets.push(`${k} = ?`); args.push(v); }
    if (!sets.length) return false;
    sets.push("letzte_aktivitaet = datetime('now')");
    db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
    if (felder.status && felder.status !== lead.status) {
      aktivitaeten.anlegen(user, { lead_id: id, art: "stufenwechsel", text: `${lead.status} → ${felder.status}${felder.verlust_grund ? " (" + felder.verlust_grund + ")" : ""}` });
    }
    return true;
  },

  // E4: Call-Ausgaenge
  callErgebnis(user, id, ausgang, extra = {}) {
    const lead = leads.einer(user, id);
    if (!lead) return false;
    const jetzt = "datetime('now')";
    if (ausgang === "termin") {
      leads.aendern(user, id, { status: "termin", temperatur: "heiss", wiedervorlage: null });
      aktivitaeten.anlegen(user, { lead_id: id, art: "anruf", text: `Erstgespräch gebucht${extra.notiz ? ": " + extra.notiz : ""}` });
    } else if (ausgang === "absage") {
      leads.aendern(user, id, { status: "verloren", verlust_grund: extra.grund || "kein Grund angegeben", temperatur: "kalt", wiedervorlage: null });
      aktivitaeten.anlegen(user, { lead_id: id, art: "anruf", text: `Absage — Grund: ${extra.grund || "?"}` });
    } else if (ausgang === "nicht-erreicht") {
      db.prepare(`UPDATE leads SET versuche = versuche + 1, letzte_aktivitaet = ${jetzt} WHERE id = ?`).run(id);
      aktivitaeten.anlegen(user, { lead_id: id, art: "anruf", text: `Nicht erreicht (Versuch ${(lead.versuche || 0) + 1})` });
    } else if (ausgang === "spaeter") {
      leads.aendern(user, id, { wiedervorlage: extra.datum || null });
      aktivitaeten.anlegen(user, { lead_id: id, art: "anruf", text: `Später anrufen: ${extra.datum || "?"}${extra.notiz ? " — " + extra.notiz : ""}` });
    }
    return true;
  },

  listenNamen(user) {
    const r = rls(user);
    return db.prepare(`SELECT liste, COUNT(*) anzahl FROM leads WHERE liste IS NOT NULL${r.sql} GROUP BY liste ORDER BY liste`).all(...r.args);
  },

  pipeline(user) {
    const r = rls(user);
    const rows = db.prepare(`SELECT l.*, u.name AS besitzer FROM leads l LEFT JOIN users u ON u.id=l.besitzer_id
      WHERE l.status NOT IN ('gewonnen','verloren')${r.sql.replace(/besitzer_id/g, "l.besitzer_id")} ORDER BY l.letzte_aktivitaet DESC`).all(...r.args);
    const nach = {}; for (const s of STUFEN) nach[s] = [];
    for (const l of rows) (nach[l.status] ||= []).push(l);
    return nach;
  },

  zahlen(user) {
    const r = rls(user);
    const g = (sql, ...a) => db.prepare(sql).get(...a) || {};
    return {
      gesamt: g(`SELECT COUNT(*) c FROM leads WHERE 1=1${r.sql}`, ...r.args).c || 0,
      offen: g(`SELECT COUNT(*) c FROM leads WHERE status NOT IN ('gewonnen','verloren')${r.sql}`, ...r.args).c || 0,
      gewonnen: g(`SELECT COUNT(*) c FROM leads WHERE status='gewonnen'${r.sql}`, ...r.args).c || 0,
      heute_faellig: g(`SELECT COUNT(*) c FROM leads WHERE wiedervorlage <= date('now')${r.sql}`, ...r.args).c || 0,
    };
  },
};

// ---------- Aktivitäten ----------
const aktivitaeten = {
  anlegen(user, { lead_id = null, kunde_id = null, art, text }) {
    db.prepare("INSERT INTO aktivitaeten (lead_id, kunde_id, user_id, art, text) VALUES (?,?,?,?,?)")
      .run(lead_id, kunde_id, user?.id || null, art, text);
  },
  zuLead(id, limit = 30) {
    return db.prepare(`SELECT a.*, u.name AS wer FROM aktivitaeten a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.lead_id = ? ORDER BY a.zeit DESC LIMIT ?`).all(id, limit);
  },
  zuKunde(id, limit = 50) {
    return db.prepare(`SELECT a.*, u.name AS wer FROM aktivitaeten a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.kunde_id = ? ORDER BY a.zeit DESC LIMIT ?`).all(id, limit);
  },
};

// ---------- Kunden (E2) ----------
const kunden = {
  liste(user) {
    const r = rls(user);
    return db.prepare(`SELECT k.*, u.name AS besitzer,
      (SELECT COUNT(*) FROM todos t WHERE t.kunde_id=k.id AND t.erledigt=0) AS offene_todos
      FROM kunden k LEFT JOIN users u ON u.id=k.besitzer_id WHERE k.aktiv=1${r.sql.replace(/besitzer_id/g, "k.besitzer_id")}
      ORDER BY k.firma`).all(...r.args);
  },
  einer(user, id) {
    const r = rls(user);
    const k = db.prepare(`SELECT k.*, u.name AS besitzer FROM kunden k LEFT JOIN users u ON u.id=k.besitzer_id WHERE k.id=?${r.sql.replace(/besitzer_id/g, "k.besitzer_id")}`).get(id, ...r.args);
    if (!k) return null;
    k.kontakte = db.prepare("SELECT * FROM kontakte WHERE kunde_id=?").all(id);
    k.todos = db.prepare("SELECT * FROM todos WHERE kunde_id=? ORDER BY erledigt, faellig").all(id);
    k.historie = aktivitaeten.zuKunde(id);
    return k;
  },
  anlegen(user, d) {
    const info = db.prepare("INSERT INTO kunden (firma, stand, besonderes, besitzer_id, kunde_seit) VALUES (?,?,?,?,date('now'))")
      .run(d.firma, d.stand || null, d.besonderes || null, d.besitzer_id || user.id);
    aktivitaeten.anlegen(user, { kunde_id: info.lastInsertRowid, art: "system", text: "Kunde angelegt" });
    return info.lastInsertRowid;
  },
  ausLead(user, lead_id) {
    const l = leads.einer(user, lead_id);
    if (!l) return null;
    const id = kunden.anlegen(user, { firma: l.firma || l.name, stand: `Aus Lead gewonnen (${l.quelle || "?"})`, besitzer_id: l.besitzer_id });
    db.prepare("UPDATE leads SET kunde_id=?, status='gewonnen' WHERE id=?").run(id, lead_id);
    if (l.telefon || l.email) db.prepare("INSERT INTO kontakte (kunde_id, name, telefon, email) VALUES (?,?,?,?)").run(id, l.name, l.telefon, l.email);
    aktivitaeten.anlegen(user, { lead_id, art: "system", text: "Lead → Kunde übernommen" });
    return id;
  },
};

const todos = {
  anlegen(user, d) {
    db.prepare("INSERT INTO todos (kunde_id, lead_id, titel, faellig, besitzer_id) VALUES (?,?,?,?,?)")
      .run(d.kunde_id || null, d.lead_id || null, d.titel, d.faellig || null, d.besitzer_id || user.id);
  },
  umschalten(user, id) { db.prepare("UPDATE todos SET erledigt = 1 - erledigt WHERE id=?").run(id); },
  offene(user, limit = 20) {
    const r = rls(user);
    return db.prepare(`SELECT t.*, k.firma FROM todos t LEFT JOIN kunden k ON k.id=t.kunde_id
      WHERE t.erledigt=0${r.sql.replace(/besitzer_id/g, "t.besitzer_id")} ORDER BY t.faellig IS NULL, t.faellig LIMIT ?`).all(...r.args, limit);
  },
};

// ---------- Team-Performance (E7) ----------
function teamZahlen() {
  return db.prepare(`SELECT u.id, u.name, u.rolle,
    (SELECT COUNT(*) FROM leads l WHERE l.besitzer_id=u.id) AS leads,
    (SELECT COUNT(*) FROM leads l WHERE l.besitzer_id=u.id AND l.status='gewonnen') AS gewonnen,
    (SELECT COUNT(*) FROM leads l WHERE l.besitzer_id=u.id AND l.status='verloren') AS verloren,
    (SELECT COUNT(*) FROM leads l WHERE l.besitzer_id=u.id AND l.status='termin') AS termine,
    (SELECT COUNT(*) FROM aktivitaeten a WHERE a.user_id=u.id AND a.art='anruf' AND date(a.zeit)=date('now')) AS anrufe_heute
    FROM users u WHERE u.aktiv=1 ORDER BY u.rolle, u.name`).all();
}

module.exports = { db, users, leads, kunden, kontakte: null, aktivitaeten, todos, teamZahlen, STUFEN, rls };
