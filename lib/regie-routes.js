// Die Regie-Seite fuer die Werbeaufnahmen.
//
// WOZU (20.08.2026): Beim Dreh sollen zwei Dinge im richtigen Moment passieren
// — die Stimme sagt ihre Zeile, und das passende Dokument geht auf dem zweiten
// Bildschirm auf. Beides von Hand zu bedienen heisst: jemand sucht eine MP3,
// jemand sucht eine PDF, und die Einstellung ist tot.
//
// Hier laeuft beides an einer Taste. Wer die Seite offen hat, drueckt
// Leertaste, und der naechste Schritt geschieht: Ton ab, Dokument auf.
//
// WARUM DAS DOKUMENT AUS DEM SYSTEM KOMMT und nicht vom Dateisystem des
// Laptops: Ein Browser darf von einer https-Seite aus keine lokale Datei
// oeffnen. Die Dateien liegen darum im Ordner /dreh auf dem Server und werden
// hier ausgeliefert — dann ist es ein normaler Link, und der Tab bleibt beim
// zweiten Mal derselbe (window.open mit festem Namen).
//
// WARUM window.open AN EINER TASTE HAENGT: Ohne Nutzergeste blockt jeder
// Browser das Fenster. Die Leertaste IST die Geste — deshalb geht die Datei
// beim Druecken auf und nicht ueber einen Zeitgeber.
//
// NUR IM DREH: Ohne DREH_REGIE=1 wird die Seite nicht registriert. Im Betrieb
// gibt es sie nicht, auch nicht als 403.

const fs = require("fs");
const path = require("path");

const ORDNER = process.env.DREH_ORDNER || "/dreh";
const SKRIPT = () => path.join(ORDNER, "skript.json");

const TYPEN = {
  ".mp3": "audio/mpeg", ".pdf": "application/pdf", ".png": "image/png",
  // .html ausdruecklich: Ohne Angabe raet der Browser, und eine geratene
  // Tabellenseite landet schon mal in den Downloads statt im Tab.
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function skriptLesen() {
  try { return JSON.parse(fs.readFileSync(SKRIPT(), "utf-8")); }
  catch (e) { return { fehler: e.message, creatives: [] }; }
}

// WELCHES CREATIVE LAEUFT — EINE QUELLE FUER ALLE SEITEN (21.08.2026).
//
// Der Fehler, den das behebt: Die Sprachseite holte die Nummer vom Server
// (DREH_CREATIVE, sprache-routes.js), die Regie-Seite fing stur bei 0 an. Wer
// /regie ohne ?c= aufrief, hatte die Regie auf C1 und Alexandra auf C2 —
// zwei verschiedene Drehbuecher gleichzeitig. Am Bildschirm sieht man das
// nicht: Beide Seiten zeigen ein plausibles Skript, nur eben nicht dasselbe.
// Aufgefallen erst, als der Dreh auf einen zweiten Laptop sollte.
//
// Rangfolge wie auf der Sprachseite: Der Link schlaegt den Server. Wer im
// Reiter auf ein anderes Creative klickt, bekommt auch dieses — die
// Servervorgabe gilt nur, wenn nichts danebensteht.
function creativeNr(req, s) {
  const anzahl = (s.creatives || []).length;
  const roh = req.query.c != null && req.query.c !== ""
    ? req.query.c
    : process.env.DREH_CREATIVE;
  const n = Number(roh);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(anzahl - 1, Math.trunc(n)));
}

module.exports = function (app) {
  // Dateien ausliefern. Bewusst nur der Basisname: ein Pfad mit ".." wuerde
  // sonst aus dem Ordner herausfuehren.
  app.get("/regie/datei/:name", (req, res) => {
    const name = path.basename(String(req.params.name || ""));
    const datei = path.join(ORDNER, name);
    if (!fs.existsSync(datei)) return res.status(404).send("Nicht gefunden: " + esc(name));
    const typ = TYPEN[path.extname(name).toLowerCase()];
    if (typ) res.type(typ);
    // inline, damit die PDF im Tab AUFGEHT statt in den Downloads zu landen.
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    fs.createReadStream(datei).pipe(res);
  });

  // Das Drehbuch fuer die Sprachbuehne: nur die ZUEGE des Agenten, in der
  // Reihenfolge, in der sie kommen. Die Zeilen von Jannik und die reine
  // Bildregie stehen nicht drin — dazwischen redet er ja selbst, und der Zug
  // wird von der Stille ausgeloest, nicht von einer Liste.
  //
  // Was an einem Bild-Schritt haengt (ein Dokument), wandert an den NAECHSTEN
  // Zug des Agenten. Sonst gaebe es einen Schritt, den niemand ausloest.
  app.get("/regie/drehbuch.json", (req, res) => {
    const s = skriptLesen();
    const nr = creativeNr(req, s);
    const c = (s.creatives || [])[nr];
    if (!c) return res.status(404).json({ fehler: "Kein Creative " + nr });

    // oeffnen ist eine LISTE, nicht ein Wert. In Creative 3 haengen an einem
    // Zug zwei Dateien — die Rechnung aus dem Schritt davor und die Excel des
    // Zuges selbst. Mit einem Einzelwert hatte die zweite die erste
    // ueberschrieben, und die Rechnung waere nie aufgegangen. Die Bildregie
    // verlangt ohnehin beide nebeneinander.
    // "sofort" heisst: Zwischen diesem Zug und dem davor steht KEINE Zeile von
    // Jannik. Dann darf der Agent gleich weiterreden, statt auf eine Antwort zu
    // warten, die im Skript gar nicht vorgesehen ist.
    //
    // WARUM (20.08.2026): C2_04 endet mit "die brauchen deine Freigabe", danach
    // kommt nur Bildregie und dann C2_05. Im Dreh stand das Gespraech an dieser
    // Stelle still — Jannik hatte nichts zu sagen, und der Agent wartete.
    const zuege = [];
    let warten = [];
    let seitStimmeGeredet = true;   // vor dem ersten Zug wartet der Klatscher
    for (const b of c.beats || []) {
      if (b.art !== "stimme") {
        if (b.oeffnen) warten.push(b.oeffnen);
        if (b.art === "du") seitStimmeGeredet = true;
        continue;
      }
      // b.oeffnen darf ein Wert ODER eine Liste sein — C2_04 macht Angebot und
      // Creatives gleichzeitig auf, weil der Satz beides ankuendigt.
      const eigene = Array.isArray(b.oeffnen) ? b.oeffnen : (b.oeffnen ? [b.oeffnen] : []);
      const dateien = warten.concat(eigene);
      zuege.push({
        id: b.id || "", text: b.text || "", audio: b.audio || "",
        oeffnen: dateien, tat: b.tat || null, tatWarten: Boolean(b.tatWarten),
        sofort: zuege.length > 0 && !seitStimmeGeredet,
        // "wartenAuf" haelt den Zug an, bis in der Welt draussen etwas passiert
        // ist. Bisher gab es nur zwei Ausloeser: eine Zeile von Jannik oder gar
        // keinen. In Creative 3 gibt es einen dritten — Lukas fotografiert den
        // Bon mit dem Handy und schickt ihn in den Telegram-Chat. Das dauert
        // eine halbe Minute, und "Beleg ist erfasst" darf erst danach kommen.
        wartenAuf: b.wartenAuf || null,
      });
      warten = [];
      seitStimmeGeredet = false;
    }
    res.json({ titel: c.titel, zuege });
  });

  // Wie viele Belege sind gebucht?
  //
  // Zwei Dinge horchen hier: die Buchhaltungsseite, damit der Zaehler von
  // selbst hochspringt, sobald der Bon per Telegram durch ist — und die
  // Sprachbuehne, die C3_04 erst spricht, WENN er wirklich da ist. Ohne das
  // zweite redet Erik "Beleg ist erfasst" in dem Moment, in dem Lukas gerade
  // erst das Handy in die Hand nimmt.
  //
  // Bewusst nur eine Zahl und keine Belegdaten: Diese Antwort geht alle zwei
  // Sekunden ueber die Leitung, und mehr braucht niemand, um zu merken, dass
  // sich etwas getan hat.
  app.get("/regie/belegstand", async (req, res) => {
    const nutzer = req.session && req.session.crm;
    if (!nutzer || !nutzer.id) return res.status(401).json({ ok: false });
    try {
      const crm = require("./crm.js");
      const { rows: [z] } = await crm.system(
        `select (select count(*) from belege where status = 'gebucht')::int as gebucht`);
      res.json({ ok: true, gebucht: z.gebucht });
    } catch (e) {
      res.status(500).json({ ok: false, fehler: e.message });
    }
  });

  // Handlungen, die ein Zug ausloesen darf.
  //
  // WARUM EINE FESTE LISTE: Hier wird wirklich etwas verschickt. Ein Name aus
  // dem Drehbuch darf bestimmen, WELCHE der drei Handlungen laeuft — nicht,
  // WAS sie tut. Alles andere waere eine offene Tuer im Netz.
  const KALENDER = () => process.env.KALENDER_ID || "primary";

  // Gym und der geblockte Abend wieder weg. Wird VOR dem Kalender-Moment
  // ausgeloest, damit jeder Take mit einem leeren Abend beginnt — sonst stehen
  // die Termine aus dem vorigen Versuch schon da, und C2_07 hat nichts zu
  // zeigen. Spart das Zuruecksetzen von Hand zwischen zwei Takes.
  async function abendLeeren() {
    const kalender = require("./kalender.js");
    const werkzeuge = require("./werkzeuge.js");
    const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    let weg = 0;
    try {
      // Die Lesefunktion heisst spanne(von, bis, max) — kalender.termine gibt
      // es nicht, und ein Aufruf ins Leere haette hier still nichts geloescht.
      const r = await kalender.spanne(heute, heute, 40);
      for (const t of (r && r.termine) || []) {
        const titel = String(t.titel || t.summary || "");
        if (/^(Gym|Privat)/.test(titel) && t.id) {
          await werkzeuge.terminAbsagen({ id: t.id });
          weg++;
        }
      }
    } catch (e) { return { ok: false, grund: e.message }; }
    return { ok: true, entfernt: weg };
  }

  const TATEN = {
    // C2_05 — der Kalender geht auf. Vorher aufraeumen, damit der Abend leer
    // ist und man in C2_07 wirklich sieht, wie etwas dazukommt.
    "kalender-frisch": abendLeeren,
    // C2_04 "…dir per Telegram geschickt, damit du ihn am Handy
    // gegenzeichnen kannst." Bis eben kam nichts an — der Satz behauptete
    // etwas, das niemand ausloeste. Jetzt geht der Vertrag wirklich raus.
    vertrag: async () => {
      const fs = require("fs");
      const datei = path.join(ORDNER, "Vertrag-Bergmann-Solar-Performance-Marketing.pdf");
      const puffer = fs.readFileSync(datei);
      return require("./telegram.js").pushDatei(
        puffer, "Vertrag-Bergmann-Solar.pdf",
        "Der Vertrag mit Bergmann Solar — schau ihn dir am Handy an und zeichne gegen.",
        { stimme: false });   // im Dreh keine zweite Stimme aus dem Handy
    },
    // C2_07 "Alles klar, erledigt." — Gym und der geblockte Abend entstehen
    // WAEHREND der Aufnahme. Vorher darf nichts davon im Kalender stehen,
    // sonst gibt es nichts zu sehen.
    gym: async () => {
      const werkzeuge = require("./werkzeuge.js");
      const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
      // Die Felder heissen titel/start/ende, nicht name/von/bis — mit den
      // falschen Namen meldet terminEintragen nur "kein Titel" zurueck und
      // legt still nichts an.
      const a = await werkzeuge.terminEintragen({
        titel: "Gym", start: `${heute}T19:00:00`, ende: `${heute}T20:00:00`,
        ort: "Fitnessstudio",
      });
      const b = await werkzeuge.terminEintragen({
        titel: "Privat — Abend mit den Eltern",
        start: `${heute}T20:00:00`, ende: `${heute}T22:30:00`, beschreibung: "Geblockt",
      });
      return { gym: a, abend: b };
    },
    // C2_09 "Ist raus." — die Nachricht geht wirklich in die Teamgruppe.
    whatsapp: async () => {
      const name = process.env.DREH_WA_ZIEL || "Team Flowstate";
      const text = "Hey zusammen, wer hätte Lust, dass wir von Sonntag bis Dienstag "
        + "zum Arbeiten in die Berge fahren? Wer dabei ist, sagt kurz Bescheid — "
        + "dann suche ich ein Hotel raus und reserviere.";

      // DEN NAMEN ERST IN EINE JID AUFLOESEN (20.08.2026).
      //
      // Die Bruecke kann das nicht: /senden macht aus allem ohne "@" eine
      // Telefonnummer, indem es alle Nicht-Ziffern wegwirft. Aus "Team
      // Flowstate" wird dabei eine LEERE Nummer, und der Versand haengt bis
      // zum Zeitablauf. Im Log stand nur "aborted due to timeout" — dem sieht
      // man den Grund nicht an.
      //
      // findeGruppe sucht ausschliesslich unter den in WA_GRUPPEN
      // freigegebenen Gruppen. Was dort nicht steht, existiert nicht.
      const kontakte = require("./kontakte.js");
      const g = kontakte.findeGruppe(name);
      if (!g || !g.jid) {
        const da = kontakte.gruppen().map((x) => x.name);
        return { ok: false, grund: `Gruppe "${name}" nicht gefunden. Freigegeben: `
          + (da.join(", ") || "keine") };
      }
      const r = await require("./whatsapp.js").senden({ an: g.jid, text });
      return { ...r, gruppe: g.name };
    },
    // ---------------------------------------------------------- Creative 3

    // C3_04 "Der Ordner ist ausserdem an eure Steuerberaterin Frau Keller raus,
    // mit kurzem Begleittext."
    //
    // Der Juli-Ordner geht wirklich raus. Gebaut wird er von
    // buchhaltung.monatsExport — kein zweiter Packer, damit im Video dieselbe
    // Datei liegt, die das Dashboard herausgibt.
    //
    // BEWUSST NICHT ueber lib/steuer-versand.js: Der legt seit dem 20.08. einen
    // ENTWURF an und wartet auf ein gesprochenes Ja. Richtig im Alltag, falsch
    // vor der Kamera — der Satz ist schon gesprochen, wenn diese Tat laeuft,
    // und das Schlussbild zeigt den Ordner im Postausgang. Die Empfaengerin
    // kommt trotzdem aus derselben Quelle wie dort: dem Kanzlei-Feld der
    // Buchhaltung, das auch auf der Seite im Klartext steht.
    "steuerordner": async (req) => {
      const buch = require("./buchhaltung.js");
      const gmail = require("./gmail-direkt.js");
      // req.nutzer setzt jedes Modul selbst in seiner eigenen Zwischenschicht
      // (buchhaltung-routes, crm-routes …). Die Regie-Routen haben keine, also
      // hier direkt aus der Sitzung. Ohne den Rueckfall waere nutzer undefined
      // und der Versand braeche mit einem nichtssagenden Fehler ab.
      const nutzer = req.nutzer || (req.session && req.session.crm);
      if (!nutzer || !nutzer.id) return { ok: false, grund: "nicht angemeldet" };

      const kanzlei = await buch.steuerkanzlei(nutzer);
      if (!kanzlei.an) return { ok: false, grund: "keine Kanzlei-Adresse hinterlegt" };

      // Der letzte abgeschlossene Monat — im Dreh ist das der Juli, und genau
      // den nennt C3_04.
      const jetzt = new Date();
      const vormonat = new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 1);
      const jahr = vormonat.getFullYear(), monat = vormonat.getMonth() + 1;

      const r = await buch.monatsExport(nutzer, jahr, monat);
      if (!r.ok) return { ok: false, grund: "Monatsordner: " + r.grund };

      const anrede = kanzlei.name ? `Guten Tag ${kanzlei.name},` : "Guten Tag,";
      const versand = await gmail.senden({
        an: kanzlei.an,
        absender: process.env.MAIL_ABSENDER || "Lukas Sehorz <lukas.sehorz@flowstate-ai.net>",
        betreff: `Buchhaltung ${r.titel} – Sehorz & vom Hofe GbR`,
        text: [anrede, "",
          `anbei die Buchhaltungsunterlagen für ${r.titel}.`, "",
          `Die Datei enthält eine Übersicht als CSV und als HTML, die Belegdateien im `
          + `Unterordner "Belege" sowie eine Prüfsummenliste (SHA-256).`, "",
          `Insgesamt ${r.anzahl} ${r.anzahl === 1 ? "Bewegung" : "Bewegungen"}, `
          + `davon ${r.dateien} mit Belegdatei.`, "",
          "Bei Rückfragen melden Sie sich gerne jederzeit.", "",
          "Viele Grüße", "Lukas Sehorz", "Flowstate – Sehorz & vom Hofe GbR"].join("\n"),
        anhaenge: [{ name: r.dateiname, typ: "application/zip", daten: r.zip }],
      });
      return { ok: true, an: kanzlei.an, monat: r.titel,
        bewegungen: r.anzahl, dateien: r.dateien,
        groesse: r.zip.length, mail: versand.id };
    },

    // C3_05 "Ist raus." — die Rechnung samt Randdaten an die Kundin.
    //
    // Frau Bergmann gibt es nicht. Die Mail geht darum an eine Testadresse:
    // DREH_MAIL_ZIEL, sonst dieselbe wie in Creative 4. Was hier rausgeht, ist
    // eine echte Mail an einen echten Posteingang — nur eben an unseren
    // eigenen.
    "rechnung-mail": async () => {
      const gmail = require("./gmail-direkt.js");
      const ziel = process.env.DREH_MAIL_ZIEL || "jannikvomhofe@svhconsult.de";
      const dateien = ["Rechnung-2026-0184-Nordlicht-Media.pdf",
        "Randdaten-Deal-Nordlicht-Media.xlsx"];
      const anhaenge = dateien.map((n) => {
        const datei = path.join(ORDNER, n);
        if (!fs.existsSync(datei)) throw new Error("Fehlt im Drehordner: " + n);
        return {
          name: n, daten: fs.readFileSync(datei),
          typ: TYPEN[path.extname(n).toLowerCase()] || "application/octet-stream",
        };
      });
      const r = await gmail.senden({
        an: ziel,
        absender: process.env.MAIL_ABSENDER || "Lukas Sehorz <lukas.sehorz@flowstate-ai.net>",
        betreff: "Ihre Rechnung – Voice Agent für zwei Standorte",
        text: ["Guten Tag Frau Bergmann,", "",
          "vielen Dank für das Gespräch und Ihre Zusage.", "",
          "Anbei die Rechnung über 8.000 Euro für den Voice Agent an Ihren beiden "
          + "Standorten sowie eine Übersicht der vereinbarten Eckdaten — Projektstart, "
          + "Umsetzungsdauer und Ansprechpartner.", "",
          "Wir melden uns zum Projektstart bei Ihnen.", "",
          "Viele Grüße", "Lukas Sehorz", "Flowstate – Sehorz & vom Hofe GbR"].join("\n"),
        anhaenge,
      });
      return { ok: true, an: ziel, anhaenge: dateien, mail: r.id };
    },
  };

  app.post("/regie/tat/:name", async (req, res) => {
    const tat = TATEN[String(req.params.name || "")];
    if (!tat) return res.status(404).json({ ok: false, fehler: "Unbekannte Tat" });
    try {
      // req wird durchgereicht, seit "steuerordner" dazugekommen ist: Der
      // Monatsordner wird ueber alsNutzer(nutzer.id) gebaut und laeuft damit
      // unter den Rechten des Angemeldeten, nicht als System.
      const r = await tat(req);
      console.log("Regie-Tat:", req.params.name, JSON.stringify(r).slice(0, 200));
      res.json({ ok: true, ergebnis: r });
    } catch (e) {
      console.error("Regie-Tat fehlgeschlagen:", req.params.name, e.message);
      res.status(500).json({ ok: false, fehler: e.message });
    }
  });

  // Die Drehmappe: EIN Fenster, viele Reiter.
  //
  // WARUM (20.08.2026): Vorher bekam jeder Inhalt ein eigenes Browserfenster.
  // Im Dreh ging genau eines auf, die naechsten nicht — Chrome erlaubt pro
  // Nutzergeste nur EIN window.open, alles weitere blockt der Popup-Schutz
  // stillschweigend. Headless faellt das nicht auf: dort sind vier von vier
  // durchgegangen, im echten Browser eines von vier.
  //
  // Also ein einziges Fenster, das beim ersten Klick aufgeht, und darin eigene
  // Reiter. Nichts wird mehr ersetzt, alles Geoeffnete bleibt erreichbar.
  //
  // WHATSAPP KANN HIER NICHT REIN: web.whatsapp.com verbietet die Einbettung
  // (X-Frame-Options). Das Fenster muss vor dem Dreh von Hand offen sein.
  app.get("/regie/mappe", (req, res) => {
    // Das Fenster fuer den zweiten Bildschirm.
    //
    // WIE ES GEDACHT IST: Es geht als normaler Tab auf, wird auf den rechten
    // Bildschirm gezogen und ist dort ein eigenes Chrome-Fenster MIT Tableiste.
    // Ein Klick auf "Alles vorladen" oeffnet darin alle Inhalte des Drehbuchs
    // als echte Tabs — vorgeladen, im Hintergrund. Im Take holt die Sprachseite
    // nur noch den passenden Tab nach vorn.
    //
    // WARUM VON HIER AUS UND NICHT VON DER SPRACHSEITE: window.open landet in
    // dem Fenster, aus dem es aufgerufen wird. Von der Sprachseite kaemen die
    // Tabs auf dem Laptop an. Von hier kommen sie dorthin, wo dieses Fenster
    // steht.
    //
    // WARUM EIN KNOPF: Ohne Nutzergeste blockt Chrome mehrere Fenster. Der
    // Klick ist die Geste — und er kommt ohnehin, weil vorher gezogen wird.
    const s = skriptLesen();
    const nr = creativeNr(req, s);
    const c = (s.creatives || [])[nr] || { beats: [] };
    // NUR WAS AUSDRUECKLICH MARKIERT IST (20.08.2026).
    //
    // Vorher lud die Mappe alles vor — und dann standen beim Klatschen schon
    // fuenf Tabs offen. Im Video sieht man dann nicht mehr, wie der Agent
    // etwas oeffnet; es lag ja alles schon da.
    //
    // Vorgeladen wird nur, was ohne Vorlauf nicht geht: WhatsApp Web will
    // angemeldet sein. Alles andere macht der jeweilige Zug selbst auf.
    const dateien = [];
    for (const b of c.beats || []) {
      if (!b.vorladen) continue;
      const eigene = Array.isArray(b.oeffnen) ? b.oeffnen : (b.oeffnen ? [b.oeffnen] : []);
      eigene.forEach((d) => { if (!dateien.includes(d)) dateien.push(d); });
    }
    res.send(`<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Neuer Tab</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 /* Sieht aus wie ein leeres Tab — dieses Fenster wird abgefilmt.
    Die Anleitung ist nur da, solange sie gebraucht wird, und verschwindet,
    sobald die Inhalte geladen sind. Danach: weisse Flaeche, sonst nichts. */
 html,body{height:100%;margin:0;background:#fff}
 #hilfe{position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);
   max-width:520px;width:calc(100% - 48px);
   font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#5f6b7d;
   text-align:center;transition:opacity .4s}
 #hilfe b{color:#1f2937}
 #hilfe.weg{opacity:0;pointer-events:none}
 button{margin-top:14px;background:#eef2f7;color:#5f6b7d;border:1px solid #dbe2ea;
   border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer}
</style></head><body>
<div id="hilfe">
  <div><b>Dieses Fenster auf den rechten Bildschirm ziehen.</b></div>
  <div>Hier gehen im Dreh die Inhalte auf — jeder, wenn er dran ist.</div>
  <div id="stand" style="margin-top:10px"></div>
  <button id="laden">Jetzt laden</button>
</div>
<script>
(function(){
  var dateien = ${JSON.stringify(dateien)};
  var hilfe = document.getElementById("hilfe");
  var knopf = document.getElementById("laden");
  var stand = document.getElementById("stand");
  var schonGeladen = false;

  function name(d){
    var basis = String(d).split("?")[0].split("#")[0];
    return "dreh-" + basis.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  }
  function adresse(d){
    // KEINE Regex hier: Diese Seite steht in einer Vorlagen-Zeichenkette,
    // und Node macht aus einem einfachen Rueckstrich nichts. Beim Browser
    // kam /^https?:/// an — kaputt, und das brach das GANZE Seitenskript ab.
    // Der Knopf tat deshalb nichts, ohne jede Fehlermeldung.
    if (d.indexOf("http") === 0) return d;
    if (d.charAt(0) === "/") return d + (d.indexOf("?") >= 0 ? "&" : "?") + "drehbuch=aus";
    return "/regie/datei/" + encodeURIComponent(d);
  }

  function laden(){
    if (schonGeladen) return;
    schonGeladen = true;
    // Nichts vorzuladen? Dann ist dieses Fenster nur die Buehne fuer die
    // Inhalte, die spaeter kommen. Anleitung weg, weisse Flaeche.
    if (!dateien.length) {
      hilfe.classList.add("weg");
      try { if (window.opener) window.opener.postMessage({ typ: "mappe-geladen", offen: 0 }, location.origin); } catch(e){}
      return;
    }
    var offen = 0, blockiert = 0;
    dateien.forEach(function(d){
      var w = null;
      try { w = window.open(adresse(d), name(d)); } catch(e){}
      if (w) offen++; else blockiert++;
    });
    try { window.focus(); } catch(e){}

    if (blockiert) {
      // Nicht verstecken, wenn etwas fehlt — im Take faellt es sonst erst auf,
      // wenn der Inhalt nicht kommt.
      schonGeladen = false;
      stand.textContent = blockiert + " von " + dateien.length
        + " blockiert. Pop-ups für diese Seite erlauben, dann erneut.";
      return;
    }
    // Alles da: Fenster leerraeumen. Ab hier sieht man nur noch ein leeres Tab.
    stand.textContent = offen + " Inhalte geladen.";
    setTimeout(function(){ hilfe.classList.add("weg"); }, 900);
    try { if (window.opener) window.opener.postMessage({ typ: "mappe-geladen", offen: offen }, location.origin); } catch(e){}
  }

  knopf.addEventListener("click", laden);

  // VON SELBST LADEN, SOBALD DAS FENSTER GEZOGEN WURDE.
  //
  // Vorher darf nicht geladen werden: window.open landet in dem Fenster, aus
  // dem es kommt — solange dieser Tab noch auf dem Laptop haengt, kaemen alle
  // Inhalte dort an. Ein herausgezogener Tab wird zu einem eigenen Fenster,
  // und genau das ist an screenX zu sehen: Der Wert springt.
  var startX = window.screenX, ruhe = 0;
  setInterval(function(){
    if (schonGeladen) return;
    if (Math.abs(window.screenX - startX) < 250) { ruhe = 0; return; }
    if (++ruhe >= 2) laden();      // ~600 ms still an der neuen Stelle
  }, 300);

  try { if (window.opener) window.opener.postMessage({ typ: "mappe-bereit" }, location.origin); } catch(e){}
})();
</script></body></html>`);
  });

  app.get("/regie", (req, res) => {
    const s = skriptLesen();
    const nr = creativeNr(req, s);
    const c = (s.creatives || [])[nr];

    if (!c) {
      return res.send(`<!doctype html><meta charset="utf-8"><title>Regie</title>
        <body style="background:#0b1220;color:#e5e7eb;font:16px system-ui;padding:40px">
        <h1>Kein Drehbuch geladen</h1>
        <p>Erwartet: <code>${esc(SKRIPT())}</code></p>
        <p style="color:#f87171">${esc(s.fehler || "")}</p></body>`);
    }

    const reiter = (s.creatives || []).map((x, i) =>
      `<a href="/regie?c=${i}" class="reiter ${i === nr ? "an" : ""}">${esc(x.titel)}</a>`
    ).join("");

    // Auf welchem Creative die SPRACHSEITE steht — dieselbe Rechnung wie in
    // sprache-routes.js (drehbuch: process.env.DREH_CREATIVE). Nur zum
    // Anzeigen; die Regie folgt weiterhin dem Link, wenn einer da ist.
    const serverNr = creativeNr({ query: {} }, s);
    const serverTitel = (s.creatives || [])[serverNr]?.titel || ("Creative " + serverNr);

    const schritte = (c.beats || []).map((b, i) => {
      const art = b.art || "regie";
      const marke = art === "stimme" ? esc(b.id || "STIMME")
        : art === "du" ? "DU" : art === "tat" ? "TUN" : "BILD";
      return `<li class="s ${art}" data-i="${i}"
                  data-audio="${esc(b.audio || "")}"
                  data-oeffnen="${esc(b.oeffnen || "")}"
                  data-tat="${esc(b.tat || "")}">
        <span class="marke">${marke}</span>
        <span class="txt">${esc(b.text || "")}</span>
        ${b.oeffnen ? `<span class="datei">öffnet ${esc(b.oeffnen)}</span>` : ""}
      </li>`;
    }).join("");

    res.send(`<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Regie — ${esc(c.titel)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0b1220;--karte:#121a2b;--rand:#1f2b45;--text:#e5e7eb;--grau:#8b97ad;--blau:#4b8df8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--rand);padding:14px 22px;z-index:5}
h1{margin:0 0 8px;font-size:19px;letter-spacing:.02em}
.reiter{display:inline-block;padding:5px 12px;margin-right:6px;border:1px solid var(--rand);
  border-radius:999px;color:var(--grau);text-decoration:none;font-size:13px}
.reiter.an{background:var(--blau);border-color:var(--blau);color:#fff}
.hinweis{color:var(--grau);font-size:13px;margin-top:10px}
kbd{background:#1e2a44;border:1px solid var(--rand);border-radius:5px;padding:1px 7px;font-size:12px}
ol{list-style:none;margin:0;padding:18px 22px 60vh;counter-reset:n}
.s{display:grid;grid-template-columns:96px 1fr;gap:14px;padding:12px 16px;margin-bottom:8px;
  border:1px solid transparent;border-radius:12px;opacity:.42;transition:opacity .15s,background .15s}
.s.fertig{opacity:.22}
.s.jetzt{opacity:1;background:var(--karte);border-color:var(--blau)}
.marke{font-size:11px;letter-spacing:.09em;color:var(--grau);padding-top:3px;font-weight:700}
.s.stimme .marke{color:var(--blau)}
.s.du .txt{font-weight:600}
.s.regie .txt,.s.tat .txt{color:var(--grau);font-style:italic}
.datei{grid-column:2;font-size:12px;color:var(--blau);margin-top:4px}
.fuss{position:fixed;left:0;right:0;bottom:0;background:var(--karte);border-top:1px solid var(--rand);
  padding:12px 22px;display:flex;gap:18px;align-items:center;font-size:14px}
button{background:var(--blau);color:#fff;border:0;border-radius:9px;padding:9px 18px;font-size:14px;cursor:pointer}
button.leise{background:#1e2a44;color:var(--text)}
</style></head><body>
<header>
  <h1>Regie · ${esc(c.titel)}</h1>
  <div>${reiter}</div>
  <div class="hinweis"><kbd>Leertaste</kbd> nächster Schritt · <kbd>←</kbd> zurück ·
     <kbd>R</kbd> Zeile wiederholen · <kbd>0</kbd> an den Anfang</div>
  <!-- Sagt AUSDRUECKLICH, ob Alexandra auf demselben Creative steht. Genau
       das war unsichtbar: Regie auf C1, Stimme auf C2, beide Seiten sahen
       richtig aus. Lieber eine Zeile zu viel als ein Take fuer die Tonne. -->
  <div class="hinweis" style="margin-top:6px">${
    serverNr === nr
      ? `Alexandra läuft auf demselben Creative (Servervorgabe <code>DREH_CREATIVE=${esc(String(serverNr))}</code>).`
      : `<b style="color:#f87171">Achtung:</b> Alexandra läuft auf <b>${esc(serverTitel)}</b>
         (Servervorgabe <code>DREH_CREATIVE=${esc(String(serverNr))}</code>), die Regie zeigt
         <b>${esc(c.titel)}</b>. Für den Dreh muss beides gleich sein.`
  }</div>
</header>
<ol id="liste">${schritte}</ol>
<div class="fuss">
  <button id="weiter">Weiter (Leertaste)</button>
  <button class="leise" id="wieder">Wiederholen</button>
  <button class="leise" id="anfang">Anfang</button>
  <span id="stand" style="color:var(--grau)"></span>
</div>
<audio id="ton"></audio>
<script>
(function(){
  var schritte = [].slice.call(document.querySelectorAll('.s'));
  var ton = document.getElementById('ton');
  var stand = document.getElementById('stand');
  var i = -1;

  // EIN fester Fenstername: Beim zweiten Dokument wird derselbe Tab
  // wiederverwendet statt einen dritten aufzumachen. Auf dem zweiten
  // Bildschirm bleibt damit immer genau ein Fenster stehen.
  function oeffnen(name){ window.open('/regie/datei/' + encodeURIComponent(name), 'drehmappe'); }

  function zeigen(){
    schritte.forEach(function(s, k){
      s.classList.toggle('jetzt', k === i);
      s.classList.toggle('fertig', k < i);
    });
    var s = schritte[i];
    if (s) s.scrollIntoView({block:'center', behavior:'smooth'});
    stand.textContent = (i + 1) + ' von ' + schritte.length;
  }

  function spielen(s){
    var a = s.getAttribute('data-audio');
    if (a){ ton.src = '/regie/datei/' + encodeURIComponent(a); ton.play(); }
    var d = s.getAttribute('data-oeffnen');
    if (d) oeffnen(d);
  }

  function weiter(){
    if (i >= schritte.length - 1) return;
    i++; zeigen(); spielen(schritte[i]);
  }
  function zurueck(){ if (i > 0){ i--; zeigen(); } }
  function wieder(){ if (i >= 0){ zeigen(); spielen(schritte[i]); } }

  document.getElementById('weiter').addEventListener('click', weiter);
  document.getElementById('wieder').addEventListener('click', wieder);
  document.getElementById('anfang').addEventListener('click', function(){
    i = -1; ton.pause(); zeigen(); });
  document.addEventListener('keydown', function(e){
    if (e.code === 'Space' || e.code === 'Enter'){ e.preventDefault(); weiter(); }
    else if (e.code === 'ArrowLeft'){ e.preventDefault(); zurueck(); }
    else if (e.key === 'r' || e.key === 'R'){ e.preventDefault(); wieder(); }
    else if (e.key === '0'){ e.preventDefault(); i = -1; ton.pause(); zeigen(); }
  });
  zeigen();
})();
</script></body></html>`);
  });
};
