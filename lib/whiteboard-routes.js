// lib/whiteboard-routes.js — die Whiteboard-Wand des OS (/whiteboard).
//
// Eine Tafel je Person, alle nebeneinander an einer Wand: schreiben per
// Tastatur oder freihaendig mit dem Stift, abhaken, durchstreichen, mit dem
// Schwamm wegwischen. Jeder sieht alle Boards (wie im Buero) und darf auch
// auf jede Tafel SCHREIBEN — so gibt man jemandem eine Aufgabe (31.08.2026).
// Jedes Element kennt darum zwei Personen: besitzer (der Autor, immer die
// angemeldete Person) und tafel (auf wessen Board es steht); die Oberflaeche
// zeigt "von Lukas", wenn beide auseinandergehen. Bearbeiten und Loeschen
// duerfen genau diese zwei — mehr nie. Gleichzeitige Schreiber pro Element
// bleiben damit selten ("zwei Tabs" oder "Autor und Empfaenger zugleich"),
// und genau dafuer gibt es die Versionspruefung beim Aendern.
//
// WICHTIG: Das ist KEINE zweite To-Do-Verwaltung. /todos (Tabelle "aufgaben")
// bleibt die Aufgabenliste mit Frist und Wichtigkeit; das Whiteboard ist die
// freie Flaeche daneben — Tinte, Textbloecke, Haftnotizen, eigene Tabelle
// "whiteboard_elemente" (Migration 0056). Von der Tafel wird nichts zur
// Aufgabe. Den EINEN Weg in die andere Richtung gibt es seit 05.09.2026:
// Eine Kunden-Aufgabe aus dem CRM landet als Zeile (mit "aufgabe": id) im
// Kunden-Block auf der Tafel des Verantwortlichen, und der Haken laeuft in
// beide Richtungen mit (lib/aufgaben-tafel.js). Mehr nicht — die Tafel
// bleibt frei.
//
// Die Seite selbst ist bewusst clientseitig aufgebaut (public/lib/whiteboard.js
// rendert in #wb-wurzel): Eine Zeichenflaeche mit Zoom, Pan und Canvas IST
// Client-Arbeit — serverseitige Templates haetten hier nichts zu sagen. Der
// Server liefert die Daten (unten eingebettet) und die API; die Wahrheit
// liegt wie ueberall in der Datenbank.

const fs = require("fs");
const path = require("path");
const { schale, eintragen, darfModul } = require("./schale.js");
const crm = require("./crm.js");
const { pgSpeicher } = require("./whiteboard-speicher.js");
// Die Bruecke zur Aufgabenliste. Sie braucht pruefeElement von HIER und laedt
// dieses Modul darum erst beim Aufruf — ein require in beide Richtungen beim
// Laden gaebe eine halbe Exportliste.
const aufgabenTafel = require("./aufgaben-tafel.js");

// Haengt als vierter Unterpunkt unter die Zentrale, hinter die To-Dos.
// eintragen() fuehrt Unterpunkte zusammen (siehe schale.js) — Kalender- und
// To-Do-Eintrag bleiben stehen, egal in welcher Reihenfolge geladen wird.
eintragen({
  id: "zentrale", titel: "Zentrale", icon: "zentrale", href: "/", gruppe: "Übersicht",
  unter: [{ id: "zentrale-whiteboard", modul: "whiteboard", titel: "Whiteboard",
            icon: "whiteboard", href: "/whiteboard", nach: "zentrale-todos" }],
});

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Cache-Stempel wie v() in schale.js (dort nicht exportiert): neue Datei ->
// neue URL -> der Browser holt sie frisch, ohne Strg+F5.
const stempel = new Map();
function v(datei) {
  const jetzt = Date.now();
  const c = stempel.get(datei);
  if (c && jetzt - c.geprueft < 5000) return c.url;
  let url = datei;
  try {
    const st = fs.statSync(path.join(__dirname, "..", "public", datei.replace(/^\//, "")));
    url = `${datei}?v=${Math.round(st.mtimeMs).toString(36)}`;
  } catch { /* Datei fehlt: ohne Stempel ausliefern */ }
  stempel.set(datei, { url, geprueft: jetzt });
  return url;
}

// ------------------------------------------------------------- Pruefregeln
//
// Der Server prueft JEDES Schreiben und baut den Inhalt als SAUBERES Objekt
// neu auf (nur bekannte Schluessel). Grund: Eine einzige unguelige Zeile in
// der Datenbank wuerde sonst bei JEDEM Betrachter im Render landen — der
// Client faengt das zwar ab (try/catch je Element), aber gar nicht erst
// hineinschreiben ist die bessere Haelfte der Regel.
//
// Farben sind NAMEN, keine Hex-Werte: Der Client uebersetzt sie je Theme.
// So bleibt "blau" im Dunkelmodus lesbar, ohne dass Daten angefasst werden.
const ARTEN = new Set(["strich", "text", "notiz"]);
const FARBEN = new Set(["schwarz", "blau", "rot", "gruen", "orange", "lila"]);
const ZETTEL = new Set(["gelb", "rosa", "mint", "blau"]);
const LISTEN = new Set(["keine", "zahl", "buchstabe", "punkt", "check"]);
// Optionale Einordnung eines Blocks — die Reihenfolge IST die Rangfolge:
//   1 Kunden · 2 Vertrieb · 3 Content & Wissen · 4 Intern & System
// Kunden gehen immer vor, das Interne kommt zuletzt. (Am 31.08.2026 zuerst
// mit Intern auf Platz 3 gebaut und noch am selben Tag getauscht — Content
// bringt Umsatz, das Interne kann warten. Wer die Rangfolge aendert, aendert
// sie HIER und im Client, sonst sortiert die Oberflaeche anders, als der
// Server sie beschreibt.)
//
// Wer eine Aufgabe einordnet, muss sie nicht mehr von Hand an die richtige
// Stelle schieben; ohne Angabe bleibt ein Block liegen, wo er liegt. Die
// Namen stehen hier, damit der Server nichts durchlaesst, was die
// Oberflaeche nicht einsortieren kann.
const KATEGORIEN = ["kunden", "vertrieb", "content", "intern"];
const GRENZEN = {
  punkte: 6000,        // Zahlen je Strich (x und y zusammen) — ~3000 Stuetzpunkte
  zeilen: 200,         // Zeilen je Textblock/Notiz
  zeichenJeZeile: 400,
  striche: 20,         // Teilstriche je Zeile — mehr sind keine Zeile mehr, sondern ein Muster
  inhalt: 120000,      // Zeichen des fertigen JSON
  elementeJeBoard: 20000,
  ids: 500,            // je loeschen/wiederherstellen-Aufruf
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Eine Zeile darf einen Link tragen ("100 Cold Calls" -> die Anrufliste im
// CRM, "Webseite bauen" -> die Seite, "E-Mail an X" -> mailto). Nur http(s),
// mailto und eigene Pfade ("/crm/firma/12", seit 05.09.2026 fuer die Zeilen
// aus dem CRM; der Client liess sie schon zu, LINK_ERLAUBT in whiteboard.js).
// Ein eigener Pfad beginnt mit GENAU einem Schraegstrich: "//boese.de" waere
// eine fremde Adresse ohne Protokoll. javascript:-Adressen und alles andere
// fliegen raus, BEVOR sie in der Datenbank landen: Ein Klick auf einen Link
// darf nie Code ausfuehren.
const LINK = /^(?:(?:https?:\/\/|mailto:)\S{1,500}|\/[^\/\s]\S{0,498})$/i;

const ganz = (wert, min, max) => {
  const n = Math.round(Number(wert));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// Steuerzeichen und unsichtbare Breiten raus — sie kommen ueber Paste herein
// und machen spaeter "gleiche" Zeilen ungleich.
const textSaeubern = (s) => String(s ?? "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF]/g, "")
  .slice(0, GRENZEN.zeichenJeZeile);

// Prueft ein Element und liefert die Werte zurueck, wie sie gespeichert werden.
// inhaltNoetig=false beim Aendern: dort darf inhalt fehlen (nur Position bewegt).
function pruefeElement(roh, { inhaltNoetig = true } = {}) {
  if (!roh || typeof roh !== "object") return { ok: false, grund: "leer" };
  if (!ARTEN.has(roh.art)) return { ok: false, grund: "art" };

  const raus = { art: roh.art };
  for (const [feld, min, max] of [["x", -100000, 100000], ["y", -100000, 100000],
                                  ["breite", 0, 100000], ["hoehe", 0, 100000]]) {
    if (roh[feld] === undefined) continue;
    const n = ganz(roh[feld], min, max);
    if (n === null) return { ok: false, grund: feld };
    raus[feld] = n;
  }

  if (roh.inhalt === undefined) {
    if (inhaltNoetig) return { ok: false, grund: "inhalt" };
    return { ok: true, ...raus };
  }
  const i = roh.inhalt;
  if (!i || typeof i !== "object") return { ok: false, grund: "inhalt" };

  let sauber;
  if (roh.art === "strich") {
    const p = i.punkte;
    if (!Array.isArray(p) || p.length < 4 || p.length > GRENZEN.punkte || p.length % 2)
      return { ok: false, grund: "punkte" };
    const punkte = new Array(p.length);
    for (let k = 0; k < p.length; k++) {
      const n = ganz(p[k], -100000, 100000);
      if (n === null) return { ok: false, grund: "punkte" };
      punkte[k] = n;
    }
    const dicke = ganz(i.dicke, 1, 40);
    if (!FARBEN.has(i.farbe) || dicke === null) return { ok: false, grund: "stift" };
    sauber = { punkte, farbe: i.farbe, dicke };
  } else {
    if (!Array.isArray(i.zeilen) || !i.zeilen.length || i.zeilen.length > GRENZEN.zeilen)
      return { ok: false, grund: "zeilen" };
    const zeilen = i.zeilen.map((z) => {
      const zeile = {
        t: textSaeubern(z && z.t),
        erledigt: Boolean(z && z.erledigt),
        gestrichen: Boolean(z && z.gestrichen),
      };
      const link = String((z && z.link) || "").trim();
      if (link && LINK.test(link)) zeile.link = link;
      // Eine Antwort auf die Zeile (31.08.2026): "Partner angefragt, warte auf
      // Rueckmeldung". Sie beantwortet nicht die Frage "erledigt?", sondern
      // "kann ich hier gerade weiterarbeiten?" — die Oberflaeche blendet eine
      // beantwortete Zeile darum ab. Nimmt man die Antwort weg, steht die
      // Aufgabe wieder normal da. Gleiche Saeuberung und Laengengrenze wie der
      // Zeilentext selbst.
      const antwort = textSaeubern(z && z.antwort).trim();
      if (antwort) zeile.antwort = antwort;
      // Der Aufgaben-Bezug (05.09.2026): aufgaben.id der CRM-Aufgabe, aus der
      // die Zeile stammt. Nur eine positive ganze Zahl kommt durch — und sie
      // MUSS durchkommen, sonst verloere jeder Tastendruck im Block die
      // Verbindung, und der Haken liefe nicht mehr in die Aufgabenliste.
      const aufgabe = ganz(z && z.aufgabe, 1, 9e15);
      if (aufgabe !== null) zeile.aufgabe = aufgabe;
      // Teilstriche (31.08.2026): "Matten beantworten und Anpassung umsetzen"
      // ist zwei Dinge — geantwortet ist er schon, die Anpassung steht noch
      // aus. Darum darf nicht nur die GANZE Zeile durchgestrichen werden,
      // sondern auch ein Stueck davon. Gespeichert als Zeichenbereiche in "t":
      // [[0,11]] streicht "beantworten" durch.
      //
      // Der Server raeumt sie auf, statt sie nur durchzuwinken: Bereiche
      // ausserhalb des Textes waeren beim Anzeigen ein Griff ins Leere, und
      // ueberlappende oder unsortierte wuerden beim Aufteilen der Zeile in
      // Stuecke Zeichen doppelt zeigen. Was hier herauskommt, ist immer
      // sortiert, ueberschneidungsfrei und liegt im Text.
      const striche = Array.isArray(z && z.striche) ? z.striche : null;
      if (striche && striche.length) {
        const laenge = zeile.t.length;
        const sauber = [];
        for (const paar of striche.slice(0, GRENZEN.striche)) {
          if (!Array.isArray(paar) || paar.length !== 2) continue;
          const von = ganz(paar[0], 0, laenge);
          const bis = ganz(paar[1], 0, laenge);
          if (von === null || bis === null || bis <= von) continue;
          sauber.push([von, bis]);
        }
        sauber.sort((a, b) => a[0] - b[0]);
        const verschmolzen = [];
        for (const [von, bis] of sauber) {
          const letzter = verschmolzen[verschmolzen.length - 1];
          // Aneinandergrenzende Bereiche werden EIN Bereich — sonst waechst
          // die Liste bei jedem Streichen weiter, ohne dass man es sieht.
          if (letzter && von <= letzter[1]) letzter[1] = Math.max(letzter[1], bis);
          else verschmolzen.push([von, bis]);
        }
        // Deckt ein Bereich die ganze Zeile, ist das schlicht "durchgestrichen".
        if (verschmolzen.length === 1 && verschmolzen[0][0] === 0
            && verschmolzen[0][1] === laenge && laenge > 0) {
          zeile.gestrichen = true;
        } else if (verschmolzen.length) {
          zeile.striche = verschmolzen;
        }
      }
      return zeile;
    });
    const groesse = ganz(i.groesse, 14, 64);
    if (!LISTEN.has(i.liste) || !FARBEN.has(i.farbe) || groesse === null)
      return { ok: false, grund: "block" };
    sauber = { zeilen, liste: i.liste, farbe: i.farbe, groesse };
    // Nur setzen, wenn sie da UND gueltig ist: Ein Block ohne Einordnung ist
    // ausdruecklich erlaubt (freies Kritzeln bleibt frei).
    if (KATEGORIEN.includes(i.kategorie)) sauber.kategorie = i.kategorie;
    if (roh.art === "notiz") {
      if (!ZETTEL.has(i.zettel)) return { ok: false, grund: "zettel" };
      sauber.zettel = i.zettel;
    }
  }

  const inhalt = JSON.stringify(sauber);
  if (inhalt.length > GRENZEN.inhalt) return { ok: false, grund: "zu-gross" };
  return { ok: true, ...raus, inhalt };
}

// Wer hat in den letzten Sekunden gepollt? Fuer den gruenen Punkt am
// Namensschild. Bewusst nur im Arbeitsspeicher: Anwesenheit ist fluechtig,
// eine Tabelle dafuer waere Buchhaltung ueber nichts.
const zuletztGesehen = new Map();
const ANWESEND_MS = 15000;
const anwesende = () => {
  const grenze = Date.now() - ANWESEND_MS;
  return [...zuletztGesehen.entries()].filter(([, t]) => t > grenze).map(([id]) => id);
};

module.exports = function (app, optionen = {}) {
  const speicher = optionen.speicher || pgSpeicher();
  const teamHolen = optionen.team || ((user) => crm.team(user));

  // Auf wessen Tafel darf geschrieben werden? Auf jede, die es GIBT — aber
  // nur auf die. Ohne diese Pruefung wuerde eine getippte fremde uuid am
  // Fremdschluessel zerschellen (haesslicher 500er) oder, schlimmer, im
  // Arbeitsspeicher der Probe ein Geister-Board erzeugen. Die Team-Liste
  // aendert sich selten, darum reicht ein 60-Sekunden-Gedaechtnis.
  let teamMerker = { ids: null, bis: 0 };
  const tafelGueltig = async (user, tafel) => {
    if (!tafel || tafel === user.id) return true;
    if (Date.now() > teamMerker.bis) {
      const team = await teamHolen(user);
      teamMerker = { ids: new Set(team.map((p) => p.id)), bis: Date.now() + 60000 };
    }
    return teamMerker.ids.has(tafel);
  };

  // Boards haengen am persoenlichen Konto (besitzer). Ohne persoenliche
  // Anmeldung gibt es keine Tafel — gleiche Regel wie bei den To-Dos.
  const angemeldet = (req, res, next) => {
    if (!req.session || !req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    next();
  };
  // Die API antwortet mit 401 statt Umleitung: Der Poll-Fetch einer laengst
  // offenen Seite wuerde einer Umleitung folgen und HTML als JSON parsen —
  // das gaebe den nutzlosesten aller Fehler. So sieht der Client "anmeldung"
  // und zeigt das Anmelde-Overlay.
  const angemeldetApi = (req, res, next) => {
    if (!req.session || !req.session.crm)
      return res.status(401).json({ ok: false, anmeldung: true, grund: "anmeldung" });
    req.nutzer = req.session.crm;
    next();
  };

  // ------------------------------------------------------------- Seite
  app.get("/whiteboard", angemeldet, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const [team, stand] = await Promise.all([teamHolen(u), speicher.alle(u)]);
      const daten = {
        ich: { id: u.id, name: u.name, rolle: u.rolle },
        team, // [{id, name, rolle}] — Reihenfolge = Reihenfolge der Boards an der Wand
        elemente: stand.elemente,
        aktivitaet: stand.aktivitaet,
        anwesend: anwesende(),
        jetzt: stand.jetzt,
        grenzen: { zeilen: GRENZEN.zeilen, zeichenJeZeile: GRENZEN.zeichenJeZeile, punkte: GRENZEN.punkte },
      };
      res.send(schale({
        titel: "Whiteboard", aktiv: "zentrale-whiteboard", nutzer: u,
        unterzeile: "Eine Tafel je Person — aufschreiben, abhaken, wegwischen",
        inhalt: `
        <link rel="stylesheet" href="${v("/whiteboard.css")}">
        <div id="wb-wurzel" class="wb-wurzel">
          <noscript><div class="hinweis warn" style="margin:24px">
            Das Whiteboard braucht JavaScript — ohne geht hier nichts.
          </div></noscript>
        </div>
        ${/* "<" wird maskiert, damit ein boesartiger Textinhalt ("</script>…")
              das Skript-Tag nicht verlassen kann. */""}
        <script>window.WB_DATEN = ${JSON.stringify(daten).replace(/</g, "\\u003c")};</script>
        <script src="${v("/lib/gsap.min.js")}"></script>
        <script src="${v("/lib/whiteboard.js")}"></script>`,
      }));
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------- Lesen
  // Ohne "seit": kompletter Stand (Erstaufbau, Aufraeumen nach Fehlern).
  // Mit "seit": nur was sich getan hat — inklusive Tombstones. Als naechstes
  // "seit" IMMER das mitgelieferte "jetzt" verwenden, nie die eigene Uhr:
  // Client-Uhren gehen falsch, die des Servers ist die einzige, die zaehlt.
  app.get("/api/whiteboard/elemente", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      // "tafel" filtert aufs Board; "besitzer" bleibt als alter Name desselben
      // Filters bestehen, damit kein Aufrufer der ersten Fassung bricht.
      const tafel = String(req.query.tafel || req.query.besitzer || "");
      if (tafel && !UUID.test(tafel))
        return res.status(400).json({ ok: false, grund: "tafel" });
      const seit = String(req.query.seit || "");
      const stand = seit && !Number.isNaN(new Date(seit).getTime())
        ? await speicher.delta(req.nutzer, { seit, tafel })
        : await speicher.alle(req.nutzer);
      res.json({ ok: true, anwesend: anwesende(), ...stand });
    } catch (fehler) {
      console.error("Whiteboard lesen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  // ------------------------------------------------------------- Verknuepfen
  //
  // Vorschlaege fuer den Link einer Zeile (Wunsch vom 31.08.2026): Wer
  // "100 Cold Calls für YoKan" schreibt, soll die Anrufliste danebenhaengen
  // koennen; bei "E-Mail an Herrn Müller" die Adresse, bei "Webseite bauen
  // für X" deren Seite. Die Daten liegen laengst im CRM — sie noch einmal von
  // Hand einzutippen waere die schlechteste Art, sie zu haben.
  //
  // Gesucht wird ueber crm.firmenListe(): eine Firma liefert bis zu drei
  // Vorschlaege (Kundenakte, E-Mail, Webseite), dazu die Anruflisten. Die
  // Suche laeuft ueber crm.alsNutzer, also mit Zeilenrechten — ein
  // Mitarbeiter bekommt nur Firmen vorgeschlagen, die er ohnehin sehen darf.
  //
  // Zusaetzlich der Bereichs-Riegel: Wer das CRM gar nicht geoeffnet bekommt,
  // bekommt hier auch keine Kundennamen zu sehen. Der Torwaechter in
  // server.js kann das nicht leisten — fuer ihn ist das hier "whiteboard".
  app.get("/api/whiteboard/verknuepfung", angemeldetApi, async (req, res) => {
    const q = String(req.query.q || "").trim().slice(0, 80);
    if (q.length < 2) return res.json({ ok: true, treffer: [] });
    if (!darfModul(req.nutzer, "crm"))
      return res.json({ ok: true, treffer: [], grund: "kein-crm" });
    try {
      const [firmen, listen] = await Promise.all([
        crm.firmenListe(req.nutzer, { suche: q, limit: 8 }),
        crm.leadListen(req.nutzer).catch(() => []),
      ]);
      const treffer = [];
      for (const f of firmen) {
        treffer.push({ art: "kunde", titel: f.name, unter: f.ort || "Kundenakte",
                       url: `/crm/firma/${f.id}` });
        if (f.email) treffer.push({ art: "mail", titel: `E-Mail an ${f.name}`,
                                    unter: f.email, url: `mailto:${f.email}` });
        // Webseiten stehen im CRM oft ohne Vorsilbe ("kunde.de") — ohne
        // https:// wuerde der Browser das als Unterseite des Dashboards lesen.
        if (f.website) {
          const url = /^https?:\/\//i.test(f.website) ? f.website : `https://${f.website}`;
          treffer.push({ art: "web", titel: `Webseite ${f.name}`, unter: f.website, url });
        }
      }
      const suchwort = q.toLowerCase();
      for (const l of listen) {
        if (!String(l.name || "").toLowerCase().includes(suchwort)) continue;
        treffer.push({ art: "liste", titel: l.name,
                       unter: `Anrufliste${l.offen ? ` · ${l.offen} offen` : ""}`,
                       url: `/crm/leads?liste=${l.id}` });
      }
      res.json({ ok: true, treffer: treffer.slice(0, 12) });
    } catch (fehler) {
      console.error("Whiteboard verknuepfen:", fehler.message);
      // Keine 500er-Kaskade im Tippfluss: Die Zeile wird auch ohne
      // Vorschlaege geschrieben, der Link laesst sich von Hand einfuegen.
      res.json({ ok: true, treffer: [], grund: "fehler" });
    }
  });

  // ------------------------------------------------------------- Schreiben
  app.post("/api/whiteboard/anlegen", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      const id = String(req.body.id || "");
      if (!UUID.test(id)) return res.status(400).json({ ok: false, grund: "id" });
      // Ohne "tafel" landet das Element auf der eigenen; mit einer fremden
      // wird eine Aufgabe vergeben — die Tafel muss dann jemandem gehoeren.
      const tafel = String(req.body.tafel || req.nutzer.id);
      if (!UUID.test(tafel) || !(await tafelGueltig(req.nutzer, tafel)))
        return res.status(400).json({ ok: false, grund: "tafel" });
      const p = pruefeElement(req.body);
      if (!p.ok) return res.status(400).json({ ok: false, grund: p.grund });
      if (await speicher.anzahl(req.nutzer, tafel) >= GRENZEN.elementeJeBoard)
        return res.status(400).json({ ok: false, grund: "voll" });
      const r = await speicher.anlegen(req.nutzer, {
        id, tafel, art: p.art, x: p.x ?? 0, y: p.y ?? 0,
        breite: p.breite ?? 0, hoehe: p.hoehe ?? 0, inhalt: p.inhalt,
      });
      // Zeilen mit Aufgaben-Bezug, die in einem NEUEN Block landen (eine
      // abgegebene Zeile wandert mit ihrer Aufgabe): die Aufgabe merkt sich
      // ihren neuen Block. Ohne Vorher-Stand — hier wechselt kein Haken.
      if (r.ok && p.art !== "strich") {
        const ab = await aufgabenTafel.zeilenAbgleichen(req.nutzer,
          { element: id, vorher: null, nachher: JSON.parse(p.inhalt) });
        if (ab.neu.length) await aufgabenTafel.elementeNachziehen(req.nutzer, [id], { speicher });
      }
      res.json(r);
    } catch (fehler) {
      console.error("Whiteboard anlegen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  app.post("/api/whiteboard/aendern", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      const id = String(req.body.id || "");
      const version = ganz(req.body.version, 1, 1e9);
      if (!UUID.test(id) || version === null)
        return res.status(400).json({ ok: false, grund: "id" });
      const p = pruefeElement(req.body, { inhaltNoetig: false });
      if (!p.ok) return res.status(400).json({ ok: false, grund: p.grund });
      const { vorher, ...r } = await speicher.aendern(req.nutzer, {
        id, version, art: p.art,
        x: p.x, y: p.y, breite: p.breite, hoehe: p.hoehe, inhalt: p.inhalt,
      });
      // "veraltet" = eine andere Sitzung derselben Person hat dazwischen
      // gespeichert -> 409, der Client holt den echten Stand. "fehlt" = weg
      // (geloescht oder nie angekommen) -> 404, der Client raeumt lokal auf.
      if (!r.ok && r.grund === "veraltet") return res.status(409).json(r);
      if (!r.ok && r.grund === "fehlt") return res.status(404).json(r);
      // Haken auf einer Zeile aus dem CRM gewechselt? Dann in die Aufgaben-
      // liste durchreichen — als handelnde Person (RLS: Besitzer oder
      // Verantwortlicher; wer keins von beiden ist, aendert dort still
      // nichts). Der alte Stand kommt aus demselben Update (vorher), nur
      // der Browser bekommt ihn nicht: er hat ihn ja gerade selbst ersetzt.
      if (r.ok && p.inhalt !== undefined && p.art !== "strich") {
        const ab = await aufgabenTafel.zeilenAbgleichen(req.nutzer,
          { element: id, vorher, nachher: JSON.parse(p.inhalt) });
        // Eine Aufgaben-Zeile, die in diesem Block NEU auftaucht, kommt
        // entweder aus einem anderen Block (verschoben) oder aus dem
        // Rueckgaengig-Stapel des Browsers (die Zeile war geloescht). Im
        // zweiten Fall traegt sie den Haken von damals — und derweil kann
        // die Liste laengst etwas anderes sagen. Dieselbe Regel wie beim
        // wiederhergestellten Block (05.09.2026): die Liste ist die
        // Wahrheit, die Zeile zieht nach. Beim blossen Verschieben stimmen
        // beide ueberein, dann schreibt elementeNachziehen gar nichts.
        if (ab.neu.length) await aufgabenTafel.elementeNachziehen(req.nutzer, [id], { speicher });
      }
      res.json(r);
    } catch (fehler) {
      console.error("Whiteboard aendern:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  const idListe = (roh) => {
    if (!Array.isArray(roh) || !roh.length || roh.length > GRENZEN.ids) return null;
    const ids = roh.map(String);
    return ids.every((id) => UUID.test(id)) ? ids : null;
  };

  app.post("/api/whiteboard/loeschen", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      const ids = idListe(req.body.ids);
      if (!ids) return res.status(400).json({ ok: false, grund: "ids" });
      res.json(await speicher.loeschen(req.nutzer, ids));
    } catch (fehler) {
      console.error("Whiteboard loeschen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  app.post("/api/whiteboard/wiederherstellen", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      const ids = idListe(req.body.ids);
      if (!ids) return res.status(400).json({ ok: false, grund: "ids" });
      const r = await speicher.wiederherstellen(req.nutzer, ids);
      // Ein zurueckgeholter Block traegt die Haken von vor dem Wischen. Was
      // derweil in der Aufgabenliste abgehakt (oder wieder geoeffnet) wurde,
      // gilt — die Zeilen mit Aufgaben-Bezug ziehen nach. Die Antwort an den
      // Browser bleibt dieselbe; den neuen Stand bringt der Delta-Abgleich.
      if (r.ok && r.ids.length) await aufgabenTafel.elementeNachziehen(req.nutzer, r.ids, { speicher });
      res.json(r);
    } catch (fehler) {
      console.error("Whiteboard wiederherstellen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  // Die ganze eigene Tafel wischen. Die Bestaetigung ist Sache der Oberflaeche
  // (Dialog mit Elementzahl); zurueck kommen die ids — Undo stellt genau diese
  // Menge wieder her.
  app.post("/api/whiteboard/wischen", angemeldetApi, async (req, res) => {
    try {
      zuletztGesehen.set(req.nutzer.id, Date.now());
      res.json(await speicher.wischen(req.nutzer));
    } catch (fehler) {
      console.error("Whiteboard wischen:", fehler.message);
      res.status(500).json({ ok: false, grund: "fehler" });
    }
  });

  // ------------------------------------------------------------- Aufraeumen
  // Tombstones aelter als 30 Tage endgueltig weg — sonst wachsen die
  // Schwamm-Sitzungen der naechsten Monate zu totem Gewicht in jedem Delta.
  // Nur im echten Betrieb (die Probe reicht ihren eigenen Speicher herein).
  if (!optionen.speicher) {
    const aufraeumen = () => speicher.aufraeumen()
      .then((n) => { if (n) console.log(`Whiteboard: ${n} alte Tombstones entfernt.`); })
      .catch((fehler) => console.error("Whiteboard aufraeumen:", fehler.message));
    setTimeout(aufraeumen, 60 * 1000).unref();
    setInterval(aufraeumen, 6 * 3600 * 1000).unref();
  }
};

// Fuer die Bruecke (lib/aufgaben-tafel.js) und ihren Test: Was das CRM auf
// die Tafel schreibt, geht durch DIESELBE Pruefung wie ein Browser-Schreiben.
// Eine zweite Fassung der Regeln waere die sicherste Art, dass eine Zeile vom
// Server anders aussieht als eine vom Client.
module.exports.pruefeElement = pruefeElement;
module.exports.KATEGORIEN = KATEGORIEN;
module.exports.GRENZEN = GRENZEN;
