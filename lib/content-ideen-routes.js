// Flowstate Content — Ideenwerkstatt: von der Idee bis online, auf einer Seite.
//
// Der Ablauf, wie Jannik ihn beschrieben hat:
//
//   1. Ideen kommen herein — je Lauf drei, eine fuer JEDE Funnel-Stufe. Sonst
//      waere alles Reichweite und unten kaeme nichts an; genau der Fehler, den
//      beide Quellen (digibrood, funnel.io) als den haeufigsten beschreiben.
//   2. Haken oder X. Haken -> Skript wird geschrieben.
//   3. Das Kaertchen wandert auf die Produktionstafel:
//        Video aufnehmen -> Video schneiden -> Hochladen & Termin -> Geplant
//      Verschoben wird mit der Maus, gespeichert wird sofort.
//   4. Auf JEDEM Kaertchen steht das geplante Veroeffentlichungsdatum — schon
//      bevor gedreht wird. Beim Vorproduzieren ist das die einzige Frage, die
//      zaehlt: fuer wann ist das hier eigentlich?
//   5. Unter der Tafel steht, bis wann alles gedeckt ist. Reicht der Vorrat,
//      muss nicht gesucht werden — dann setzt der Abendlauf von selbst aus.
//
// Verworfene Ideen bleiben stehen. Sie sagen, was NICHT gefaellt, und gehen in
// den naechsten Auftrag, damit dieselbe Idee nicht in zwei Wochen wiederkommt.

const express = require("express");
const fs = require("fs");
const path = require("path");
const { schale } = require("./schale.js");
const ct = require("./content.js");
const ideen = require("./content-ideen.js");

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const datum = (d) => (d ? new Date(d).toLocaleDateString("de-DE",
  { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
const datumKurz = (d) => (d ? new Date(d).toLocaleDateString("de-DE",
  { weekday: "short", day: "2-digit", month: "2-digit" }) : null);
const datumFeld = (w) => {
  if (!w) return "";
  const d = new Date(w);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const tageSeit = (d) => (d ? Math.floor((Date.now() - new Date(d)) / 86400000) : 0);
// Tagesschluessel aus den ORTSZEIT-Bestandteilen. Nicht toISOString() (das dreht
// oestlich von UTC auf den Vortag) und erst recht nicht String(datum).slice(0,10):
// aus Postgres kommt ein Date-Objekt, das ergaebe "Sun Jul 26" — daraus wurde ein
// falsches Datum, und der Tagestrenner zeigte einen anderen Wochentag als die
// Karte direkt darunter.
const tagSchluessel = (d) => {
  if (!d) return "";
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  warnung: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  pfeilLinks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  funke: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M3 12h3M18 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>',
  datei: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  uhr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

// Wohin die Videodateien gehen. Ein Short in guter Qualitaet sind 50 bis 200 MB
// — das gehoert nicht in die Datenbank und nicht ins Git.
const VIDEO_ORDNER = process.env.VIDEO_ORDNER || path.join(__dirname, "..", "daten", "videos");
// Zwei Videos am Tag, so ist der Plan. Daraus rechnet sich die Abdeckung.
const PRO_TAG = Number(process.env.CONTENT_PRO_TAG || 2);
// Solange so viele Tage im Voraus gedeckt sind, sucht der Abendlauf nicht weiter.
const VORLAUF_TAGE = Number(process.env.IDEEN_VORLAUF_TAGE || 21);
// Und auch nicht, solange so viele Vorschlaege unentschieden herumliegen.
const OFFEN_GENUG = Number(process.env.IDEEN_OFFEN_GENUG || 6);
// So viele Vorschlaege bleiben je Funnel-Stufe stehen. Mehr macht die
// Entscheidung nicht besser, nur laenger.
const BEHALTEN_JE_STUFE = Number(process.env.IDEEN_JE_STUFE || 2);

// Ein Modellaufruf dauert eine bis zwei Minuten. Ihn im Request abzuwarten
// heisst: der Browser haengt zwei Minuten auf einer weissen Seite und man denkt,
// es sei kaputt. Darum laeuft er im Hintergrund und die Seite laedt sich nach.
const laeuft = new Map();
const laufKey = (art, wert) => art + ":" + wert;
const laufStart = (art, wert, text) => laeuft.set(laufKey(art, wert), { seit: Date.now(), text });
const laufEnde = (art, wert) => laeuft.delete(laufKey(art, wert));
const laufAktiv = () => {
  // Sicherheitsnetz: bleibt ein Lauf haengen, soll die Seite nicht fuer immer
  // "laeuft" anzeigen.
  for (const [k, v] of laeuft) if (Date.now() - v.seit > 5 * 60 * 1000) laeuft.delete(k);
  return [...laeuft.values()];
};

const FEHLERTEXT = {
  "kein-schluessel": "Es ist kein Zugang zum Modell hinterlegt (ANTHROPIC_API_KEY in der .env). Ohne den kann nichts gesucht werden.",
  "schon-entschieden": "Diese Idee war schon entschieden — die Seite war vermutlich veraltet.",
  "nicht-angenommen": "Erst annehmen, dann in den Plan übernehmen.",
  "schon-uebernommen": "Diese Idee liegt schon auf der Produktionstafel.",
  "keine-verwertbare-idee": "Das Modell hat nichts Brauchbares geliefert. Noch einmal versuchen.",
  "kein-video": "Es kam keine Datei an.",
  "zu-gross": "Die Datei ist größer als 500 MB.",
  "kein-videotyp": "Das war keine Videodatei (erlaubt: mp4, mov, webm, m4v).",
};

module.exports = function (app) {
  const angemeldet = (req, res, next) => {
    if (!req.session || !req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    next();
  };
  const formular = express.urlencoded({ extended: true });

  // =================================================================
  //                          Die Werkstatt
  // =================================================================

  app.get("/content/ideen", angemeldet, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const marken = await ct.marken(u);
      const marke = marken.some((m) => m.id === req.query.marke) ? req.query.marke : (marken[0]?.id || u.id);
      const kanal = ct.KANAELE.includes(req.query.kanal) ? req.query.kanal : null;
      const rub = ct.RUBRIKEN.some((r) => r.id === req.query.rubrik) ? req.query.rubrik : null;

      // Ein Tag aus der Tagesleiste. Filtert die Tafel auf genau diesen Tag —
      // das ist die Antwort auf "ich schaue die Tafel an und kenne mich nicht aus":
      // Tag anklicken, und es steht nur noch das da, was an dem Tag rausgeht.
      // Die Tafel ist TAGESBEZOGEN. Ohne Angabe gilt heute — eine Tafel mit
      // allen Tagen auf einmal war genau das, was den Ueberblick gekostet hat:
      // dreissig Kaertchen untereinander, und keines sagte, ob es dringend ist.
      // "alle" bleibt als ausdrueckliche Wahl erhalten, ist aber nicht die
      // Voreinstellung.
      const heuteKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
      const tagRoh = req.query.tag;
      const tag = tagRoh === "alle" ? null
        : (/^\d{4}-\d{2}-\d{2}$/.test(tagRoh || "") || tagRoh === "spaet") ? tagRoh
        : heuteKey;

      const [alle, tafel, deckung, plan, faellig, freierTag] = await Promise.all([
        ideen.ideen(u, { marke, kanal }),
        ct.tafel(u, marke, kanal),
        ct.abdeckung(u, marke),
        ct.tagesplan(u, marke, 21),
        ct.faellige(u, marke),
        ct.naechsterFreierTag(u, marke, PRO_TAG),
      ]);

      // Die Rubrik filtert erst hier: die Ablage kennt sie nicht als Parameter,
      // und bei hoechstens 80 Ideen ist das billiger als eine weitere Abfrage.
      const passt = (i) => !rub || i.rubrik === rub;
      const vorschlaege = alle.filter((i) => i.status === "vorschlag" && passt(i));
      const angenommen = alle.filter((i) => i.status === "angenommen" && !i.post_id && passt(i));
      const verworfen = alle.filter((i) => i.status === "verworfen" && passt(i));
      const laufend = laufAktiv();
      const hinweis = req.query.hinweis || "";
      const fehler = req.query.fehler || "";

      // Die Adresse traegt alle drei Filter, damit ein Wechsel nicht die anderen
      // zurücksetzt.
      const url = (aend = {}) => {
        const w = { marke, kanal, rubrik: rub, tag, ...aend };
        const t = Object.entries(w).filter(([, v]) => v).map(([k, v]) => k + "=" + encodeURIComponent(v));
        return "/content/ideen" + (t.length ? "?" + t.join("&") : "");
      };

      const stufeMarke = (i) => {
        const f = ct.FUNNEL.find((x) => x.id === i.funnel);
        return f ? `<span class="id-stufe id-${f.id}" title="${e(f.frage || "")}">${e(f.kurz || f.titel)}</span>` : "";
      };
      const rubrikMarke = (i) => (i.rubrik && ct.RUBRIK_TITEL[i.rubrik]
        ? `<span class="badge">${e(ct.RUBRIK_TITEL[i.rubrik])}</span>` : "");

      // ---------------------------------------------- Vorschlagskarte
      const karteVorschlag = (i) => `
        <div class="karte id-karte">
          <div class="id-kopf">
            <div class="id-marken">${rubrikMarke(i)}
              <span class="badge">${e(i.kanal)}</span></div>
            <div class="id-tasten">
              <form method="post" action="/content/idee/entscheiden" class="id-form">
                <input type="hidden" name="id" value="${i.id}">
                <input type="hidden" name="status" value="verworfen">
                <input type="hidden" name="zurueck" value="${e(url())}">
                <button type="submit" class="id-nein" title="Verwerfen — bleibt gespeichert, damit sie nicht wiederkommt">${ICON.x}</button>
              </form>
              <form method="post" action="/content/idee/entscheiden" class="id-form">
                <input type="hidden" name="id" value="${i.id}">
                <input type="hidden" name="status" value="angenommen">
                <input type="hidden" name="zurueck" value="${e(url())}">
                <button type="submit" class="id-ja" title="Annehmen — danach wird das Skript geschrieben">${ICON.check}</button>
              </form>
            </div>
          </div>
          ${i.ueberschrift && i.ueberschrift !== i.titel
            ? `<span class="id-etikett">${e(i.ueberschrift)}</span>` : ""}
          <h3 class="id-titel">${e(i.titel)}</h3>
          <!-- Zugeklappt steht nur, was zum Entscheiden reicht: Etikett, Hook,
               Rubrik, Kanal. Der Rest — Ablauf, Begründung, Beleg — liegt hinter
               dem Aufklapper. Ausgeschrieben waren die Kästen so hoch, dass in
               eine Spalte kaum zwei Vorschläge passten und man scrollen musste,
               um überhaupt zu sehen, wie viele offen sind.
               <details> statt eigenem Javascript: es klappt ohne Skript auf,
               ist mit der Tastatur bedienbar und wird beim Suchen im Browser
               von selbst geöffnet. -->
          <details class="id-mehr">
            <summary>Ablauf, Begründung und Beleg</summary>
            <p class="id-text">${e(i.idee)}</p>
            ${i.warum ? `<div class="id-warum"><span>Warum das zieht</span><p>${e(i.warum)}</p></div>` : ""}
            ${i.beispiel_quelle ? `<p class="id-beispiel">Vergleichbares Format: ${e(i.beispiel_quelle)}</p>` : ""}
            <p class="caption id-fuss">vorgeschlagen ${datum(i.erstellt)}</p>
          </details>
        </div>`;

      // ---------------------------------------------- Angenommen, noch nicht auf der Tafel
      // Zweite Entscheidung: Skript lesen, dann Haken (auf die Tafel) oder X.
      // Das Skript entsteht schon beim ERSTEN Haken von selbst — hier wird nur
      // noch gewartet, gelesen und entschieden.
      const skriptLaeuft = (i) => laeuft.has("skript:" + i.id);
      const karteAngenommen = (i) => `
        <div class="karte id-karte id-karte--ja">
          <div class="id-kopf">
            <div class="id-marken">${stufeMarke(i)}${rubrikMarke(i)}
              <span class="badge">${e(i.kanal)}</span></div>
            <div class="id-tasten">
              <form method="post" action="/content/idee/entscheiden" class="id-form">
                <input type="hidden" name="id" value="${i.id}">
                <input type="hidden" name="status" value="verworfen">
                <input type="hidden" name="zurueck" value="${e(url())}">
                <button type="submit" class="id-nein" title="Doch nicht — zurück in die verworfenen">${ICON.x}</button>
              </form>
              <button type="button" class="id-ja" ${i.skript ? "" : "disabled"}
                onclick="tafelOeffnen(${i.id}, ${JSON.stringify(i.titel).replace(/"/g, "&quot;")})"
                title="${i.skript ? "Auf die Produktionstafel — Tag wählen" : "Erst wenn das Skript da ist"}">${ICON.check}</button>
            </div>
          </div>
          ${i.ueberschrift && i.ueberschrift !== i.titel
            ? `<span class="id-etikett">${e(i.ueberschrift)}</span>` : ""}
          <h3 class="id-titel">${e(i.titel)}</h3>
          <div class="id-skriptstand">
            ${skriptLaeuft(i)
              ? `<span class="id-spinner klein"></span><span>Skript wird gerade geschrieben …</span>`
              : i.skript
                ? `<a href="/content/idee/${i.id}" class="knopf sekundaer klein">Skript ansehen →</a>
                   <span class="caption">${i.skript.split(/\s+/).length} Wörter</span>`
                : `<form method="post" action="/content/idee/skript" class="id-form">
                     <input type="hidden" name="id" value="${i.id}">
                     <button type="submit" class="sekundaer klein">Skript schreiben</button>
                   </form>
                   <span class="caption">Kein Skript — der Lauf ist wohl fehlgeschlagen.</span>`}
          </div>
        </div>`;

      // ---------------------------------------------- Ein Kaertchen auf der Tafel
      //
      // Das geplante Datum steht GROSS und zuerst. Beim Vorproduzieren ist das
      // die einzige Frage, die zaehlt: fuer wann ist das hier?
      // Welches Datum auf dem Kaertchen zaehlt: solange es nicht draussen ist, das
      // GEPLANTE — danach richtet sich das Vorproduzieren. Ist es draussen, das
      // Veroeffentlichungsdatum. Sonst stand bei allen gelaufenen Videos "kein
      // Datum", weil die nie einen Plantag hatten.
      const kartenTag = (p) => (p.status === "veroeffentlicht"
        ? (p.veroeffentlicht_am || p.geplant_am) : p.geplant_am);
      const kaertchen = (p) => {
        const liegt = tageSeit(p.stufe_seit);
        const ueberfaellig = p.geplant_am && new Date(p.geplant_am) < new Date(new Date().toDateString())
          && p.status !== "veroeffentlicht";
        return `<article class="pt-karte${ueberfaellig ? " pt-karte--spaet" : ""}" draggable="true" data-id="${p.id}">
          <div class="pt-karte-kopf">
            <span class="pt-datum${ueberfaellig ? " spaet" : ""}">${
              kartenTag(p) ? datumKurz(kartenTag(p)) : "kein Datum"}</span>
            ${p.funnel && ct.FUNNEL.find((f) => f.id === p.funnel)
              ? `<span class="id-stufe id-${p.funnel}">${e(ct.FUNNEL.find((f) => f.id === p.funnel).kurz)}</span>` : ""}
          </div>
          <h4 class="pt-titel">${e(p.ueberschrift || p.titel)}</h4>
          ${p.headline && p.headline !== (p.ueberschrift || p.titel)
            ? `<p class="pt-headline">„${e(p.headline)}"</p>` : ""}
          <div class="pt-zeile">
            ${p.rubrik && ct.RUBRIK_TITEL[p.rubrik] ? `<span class="pt-chip">${e(ct.RUBRIK_TITEL[p.rubrik])}</span>` : ""}
            ${(p.kanaele || []).map((k) => `<span class="pt-chip pt-chip--kanal">${e(k)}</span>`).join("")}
          </div>
          ${p.geplant_um ? `<div class="pt-termin">${ICON.uhr} ${
            new Date(p.geplant_um).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} Uhr</div>` : ""}
          ${p.datei_pfad ? `<div class="pt-datei">${ICON.datei} Datei liegt bereit</div>` : ""}
          <div class="pt-fuss">
            ${p.idee_id ? `<a href="/content/idee/${p.idee_id}">Skript</a>` : ""}
            <a href="/content/post/${p.id}">Akte</a>
            ${p.status === "hochladen" || p.status === "geplant"
              ? `<button type="button" class="pt-mini" onclick="hochladenOeffnen(${p.id}, ${JSON.stringify(p.titel).replace(/"/g, "&quot;")})">Datei &amp; Termin</button>`
              : ""}
            ${liegt >= 4 && p.status !== "veroeffentlicht"
              ? `<span class="pt-liegt" title="So lange liegt das Kärtchen schon in dieser Spalte">${liegt} T</span>` : ""}
          </div>
        </article>`;
      };

      // Innerhalb einer Spalte je Tag ein kleiner Trenner. Genau das gibt den
      // Ueberblick, den Jannik beschrieben hat: zwei fuer den 5., zwei fuer den
      // 6., zwei fuer den 7. — man sieht die Deckung, ohne zu zaehlen.
      const spalte = (s) => {
        // Ist ein Tag gewaehlt, zeigt die Tafel nur dessen Kaertchen.
        const heuteKey = tagSchluessel(new Date());
        const karten = (tafel[s.id] || []).filter((x) => {
          if (!tag) return true;
          const k = tagSchluessel(kartenTag(x));
          if (tag === "spaet") return k && k < heuteKey && x.status !== "veroeffentlicht";
          return k === tag;
        });
        let letzterTag = "keiner";
        const inhalt = karten.map((p) => {
          const tag = tagSchluessel(kartenTag(p));
          let kopf = "";
          if (tag !== letzterTag) {
            letzterTag = tag;
            const wieViele = karten.filter((x) => tagSchluessel(kartenTag(x)) === tag).length;
            // Bewusst OHNE "von 2": das Tagesziel gilt fuer die ganze Tafel, nicht
            // fuer eine einzelne Spalte. "1 von 2" in "Schneiden" waere ein falscher
            // Alarm, wenn das zweite Video des Tages schon in "Hochladen" liegt. Die
            // Deckung ueber alle Spalten steht unter der Tafel.
            kopf = `<div class="pt-tagtrenner">
              <span>${tag ? datumKurz(kartenTag(p)) : "ohne Datum"}</span>
              <i>${wieViele}</i></div>`;
          }
          return kopf + kaertchen(p);
        }).join("");
        return `<section class="pt-spalte" data-stufe="${s.id}">
          <header class="pt-spalte-kopf">
            <span class="pt-spalte-titel">${e(s.titel)}</span>
            ${s.id === "aufnehmen"
              ? `<button type="button" class="pt-plus" onclick="eigeneOeffnen()"
                   title="Eigene Idee mit Skript einfügen">+</button>` : ""}
            <span class="pt-spalte-zahl">${karten.length}</span>
          </header>
          <p class="pt-spalte-hilfe">${e(s.hilfe)}</p>
          <div class="pt-ablage">${inhalt || `<p class="pt-leer">leer</p>`}</div>
        </section>`;
      };

      // ---------------------------------------------- Abdeckung
      const gedeckt = deckung.tage;
      const genugVorrat = gedeckt >= VORLAUF_TAGE || vorschlaege.length >= OFFEN_GENUG;
      const luecken = deckung.jeTag.filter((t) => t.anzahl < PRO_TAG);

      res.send(schale({
        titel: "Ideenwerkstatt", unterzeile: "Von der Idee bis online",
        aktiv: "content", nutzer: u,
        inhalt: `
        <div class="seiten-kopf">
          <div><a href="/content" class="ct-zurueck">${ICON.pfeilLinks} Zurück zu Content</a></div>
          <div class="id-markenwahl">
            ${marken.map((m) => `<a href="${e(url({ marke: m.id }))}"
              class="${m.id === marke ? "aktiv" : ""}">${e(m.name.split(" ")[0])}</a>`).join("")}
          </div>
        </div>

        ${fehler ? `<div class="hinweis warnung">${ICON.warnung}<div>${
          e(FEHLERTEXT[fehler] || fehler)}</div></div>` : ""}
        ${hinweis === "gestartet" ? `<div class="hinweis info">${ICON.info}<div>
          Die Suche läuft. Sie braucht eine bis zwei Minuten — die Seite lädt sich
          selbst nach, du musst nichts tun.</div></div>` : ""}
        ${hinweis === "gespeichert" ? `<div class="hinweis erfolg">${ICON.check}<div>
          Datei und Termin sind gespeichert.</div></div>` : ""}
        ${hinweis === "auf-tafel" ? `<div class="hinweis erfolg">${ICON.check}<div>
          Liegt jetzt in „Video aufnehmen". Der Termin wurde auf den nächsten
          freien Platz gelegt — in der Tagesleiste oben siehst du, auf welchen.</div></div>` : ""}

        ${laufend.length ? `<div class="karte id-laeuft">
          <div class="id-spinner"></div>
          <div><strong>${e(laufend[0].text)}</strong>
            <div class="caption">Läuft im Hintergrund. Die Seite lädt sich alle 15 Sekunden nach.</div></div>
        </div>` : ""}

        <!-- Was JETZT raus muss. Steht vor allem anderen: es ist das Einzige auf
             der Seite mit einer Uhr im Nacken. -->
        ${faellig.length ? `<div class="karte id-faellig">
          <div class="karte-kopf"><div>
            <h2>${faellig.length === 1 ? "Ein Video muss raus" : faellig.length + " Videos müssen raus"}</h2>
            <div class="sub">Der geplante Zeitpunkt ist erreicht.</div></div></div>
          ${faellig.map((f) => `<div class="id-faellig-zeile">
            <div>
              <strong>${e(f.titel)}</strong>
              <span class="caption">${new Date(f.geplant_um).toLocaleString("de-DE",
                { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} Uhr
                · ${(f.kanaele || []).map(e).join(", ")}${f.datei_pfad ? " · Datei liegt bereit" : " · KEINE Datei"}</span>
            </div>
            <form method="post" action="/content/stufe-formular" class="id-form">
              <input type="hidden" name="id" value="${f.id}">
              <input type="hidden" name="status" value="veroeffentlicht">
              <input type="hidden" name="zurueck" value="${e(url())}">
              <button type="submit" class="dunkel klein">${ICON.check} Ist raus</button>
            </form>
          </div>`).join("")}
          <p class="caption id-faellig-fuss">${ICON.warnung}<span>Es wird
            <strong>nicht von selbst gepostet</strong>. Dafür fehlen ein je Plattform
            freigegebener Zugang und ein Server, der durchläuft — ein Häkchen
            „veröffentlicht" ohne beides wäre eine Behauptung, auf der dann alle
            Zahlen der nächsten Wochen fußen würden. Was hier steht, ist verlässlich:
            der Zeitpunkt wird überwacht und im richtigen Moment gemeldet.</span></p>
        </div>` : ""}

        <!-- Filter: erst Kanal, dann Rubrik. Beide wirken auf Vorschläge UND Tafel. -->
        <div class="id-filter">
          <div class="id-filterblock">
            <span class="id-filterkopf">Kanal</span>
            <nav>
              <a href="${e(url({ kanal: null }))}" class="${!kanal ? "aktiv" : ""}">alle</a>
              ${ct.KANAELE.map((k) => `<a href="${e(url({ kanal: k }))}"
                class="${kanal === k ? "aktiv" : ""}">${e(k)}</a>`).join("")}
            </nav>
          </div>
          <div class="id-filterblock">
            <span class="id-filterkopf">Rubrik</span>
            <nav>
              <a href="${e(url({ rubrik: null }))}" class="${!rub ? "aktiv" : ""}">alle</a>
              ${ct.RUBRIKEN.map((r) => `<a href="${e(url({ rubrik: r.id }))}"
                class="${rub === r.id ? "aktiv" : ""}">${e(r.titel)}</a>`).join("")}
            </nav>
          </div>
        </div>

        <h2 class="id-abschnitt">Warten auf deine Entscheidung <span>${vorschlaege.length}</span></h2>
        ${vorschlaege.length ? `
        <!-- Eine Spalte JE FUNNEL-STUFE statt einer gemischten Liste. In einer
             Reihe nebeneinander sieht man sofort, wo nichts nachkommt: drei
             TOFU-Ideen und eine leere BOFU-Spalte heisst, dass Reichweite
             entsteht und unten nichts ankommt. Genau der Fehler, den beide
             Quellen als den haeufigsten beschreiben — in einer Mischliste faellt
             er nicht auf, hier kann man ihn nicht uebersehen. -->
        <div class="id-stufen-raster">
          ${ct.FUNNEL.filter((f) => f.id !== "bindung").map((f) => {
            const dazu = vorschlaege.filter((i) => i.funnel === f.id);
            return `<section class="id-stufe-spalte">
              <header class="id-stufe-kopf id-kopf-${f.id}">
                <div>
                  <span class="id-stufe-kurz">${e(f.kurz)}</span>
                  <span class="id-stufe-name">${e(f.titel)}</span>
                </div>
                <span class="id-stufe-zahl">${dazu.length}</span>
              </header>
              <p class="id-stufe-frage">Der Zuschauer denkt: „${e(f.frage)}"</p>
              ${dazu.length
                ? dazu.map(karteVorschlag).join("")
                : `<p class="id-stufe-leer">Nichts offen für diese Stufe.</p>`}
            </section>`;
          }).join("")}
        </div>` : `<div class="karte"><p class="caption">Keine offenen Vorschläge${
              kanal || rub ? " in diesem Filter" : ""}. Hol dir welche über den Kasten unten.</p></div>`}

        ${angenommen.length ? `
        <h2 class="id-abschnitt">Angenommen — noch nicht auf der Tafel <span>${angenommen.length}</span></h2>
        <div class="id-liste">${angenommen.map(karteAngenommen).join("")}</div>` : ""}

        <h2 class="id-abschnitt">Produktionstafel
          <span class="id-tagfilter">${tag === "spaet"
            ? "überfällig"
            : tag ? datumKurz(tag) : "alle Tage"}
            ${tag
              ? `· <a href="${e(url({ tag: "alle" }))}">alle Tage zeigen</a>`
              : `· <a href="${e(url({ tag: heuteKey }))}">nur heute</a>`}</span></h2>

        <!-- DIE TAGESLEISTE. Die Tafel ist nach ARBEIT sortiert (was muss gedreht,
             was geschnitten werden). Beim Vorproduzieren denkt man aber nach TAGEN:
             was geht am 27. raus, und wo steckt das gerade? Beides aus einer
             Kanban-Ansicht herauszulesen geht nicht — darum stehen dieselben
             Kaertchen hier noch einmal nach Tagen gebuendelt. Ein Klick auf einen
             Tag filtert die Tafel darunter. -->
        <!-- Anker: die Tageslinks springen hierher zurueck statt an den
             Seitenanfang. Beim Durchklicken der Tage will man die Spalten
             sehen, nicht jedes Mal wieder die Vorschlaege von oben. -->
        <div id="tafel"></div>
        <div class="tp-leiste">
          <!-- Ueberfaelliges zuerst. Die Leiste beginnt sonst bei heute, und
               ausgerechnet das, was der Termin schon ueberholt hat, waere in der
               Uebersicht nicht zu sehen. -->
          ${deckung.ueberfaellig ? `<a class="tp-tag tp-spaet${
            tag === "spaet" ? " tp-gewaehlt" : ""}" href="${e(url({ tag: tag === "spaet" ? "alle" : "spaet" }))}#tafel"
            title="Termin verstrichen, noch nicht draußen">
            <span class="tp-wochentag">überfällig</span>
            <span class="tp-datum">vor heute</span>
            <span class="tp-zahl">${deckung.ueberfaellig}</span>
            <span class="tp-stufen"><span class="tp-stufe tp-s-spaet">Termin verstrichen</span></span>
          </a>` : ""}
          ${plan.map((d) => {
            const key = tagSchluessel(d.tag);
            const offen = d.aufnehmen + d.schneiden + d.hochladen + d.geplant;
            const zustand = d.anzahl === 0 ? "leer" : d.anzahl < PRO_TAG ? "knapp" : "voll";
            const heute = key === tagSchluessel(new Date());
            const stufen = [
              ["aufnehmen", d.aufnehmen, "Aufn"],
              ["schneiden", d.schneiden, "Schn"],
              ["hochladen", d.hochladen, "Hoch"],
              ["geplant",   d.geplant,   "Fertig"],
              ["raus",      d.raus,      "Online"],
            ].filter(([, n]) => n > 0);
            return `<a class="tp-tag tp-${zustand}${heute ? " tp-heute" : ""}${
              tag === key ? " tp-gewaehlt" : ""}"
              href="${e(url({ tag: tag === key ? "alle" : key }))}#tafel"
              title="${d.anzahl} von ${PRO_TAG} Videos für diesen Tag">
              <span class="tp-wochentag">${new Date(d.tag).toLocaleDateString("de-DE", { weekday: "short" })}${
                heute ? " · heute" : ""}</span>
              <span class="tp-datum">${new Date(d.tag).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}</span>
              <span class="tp-zahl">${d.anzahl}<i>/${PRO_TAG}</i></span>
              <span class="tp-stufen">${stufen.length
                ? stufen.map(([id, n, kurz]) =>
                    `<span class="tp-stufe tp-s-${id}">${n} ${kurz}</span>`).join("")
                : `<span class="tp-stufe tp-s-leer">nichts geplant</span>`}</span>
            </a>`;
          }).join("")}
        </div>

        <p class="pt-anleitung">${ICON.info} Die Tafel zeigt <strong>einen Tag</strong> —
          oben umschalten. Kärtchen mit der Maus in die nächste Spalte ziehen, das wird
          sofort gespeichert.</p>
        <div class="pt-tafel">${ct.STUFEN.map(spalte).join("")}</div>

        <!-- Die Deckung: die Frage, ob überhaupt neue Ideen gebraucht werden. -->
        <!-- Die Zusammenfassung rechnet aus GENAU DEN DATEN der Leiste darueber.
             Vorher kam sie aus einer eigenen Abfrage, die nur Tage MIT Eintraegen
             kannte — sie meldete "1 Tag unter 2 Videos", waehrend die Leiste sechs
             leere Tage zeigte. Zwei Zahlen nebeneinander, die sich widersprechen,
             sind schlimmer als gar keine. -->
        <p class="pt-deckung">
          ${(() => {
            const luecken = plan.filter((d) => d.anzahl < PRO_TAG);
            const erste = luecken[0];
            const voll = plan.length - luecken.length;
            return `Die nächsten ${plan.length} Tage: <strong>${voll}</strong> sind mit ${PRO_TAG} Videos gedeckt` +
              (erste
                ? `, die erste Lücke ist <strong>${datumKurz(erste.tag)}</strong>`
                : `, keine Lücke`) + ".";
          })()}
          ${deckung.ueberfaellig
            ? `<span class="pt-deckung-luecke">${deckung.ueberfaellig} überfällig</span>` : ""}
          ${plan.filter((d) => d.anzahl < PRO_TAG).length
            ? `<span class="pt-deckung-luecke">${plan.filter((d) => d.anzahl < PRO_TAG).length}
               Tage unter ${PRO_TAG} Videos</span>`
            : `<span class="pt-deckung-voll">Jeder Tag ist voll.</span>`}
        </p>

        <div class="karte id-holen">
          <div class="karte-kopf"><div>
            <h2>Ideen suchen</h2>
            <div class="sub">Drei Ideen je Lauf — eine für jede Funnel-Stufe, damit nicht
              alles Reichweite ist und unten nichts ankommt.</div></div>
            ${genugVorrat ? `<span class="badge b-gruen">Vorrat reicht</span>` : ""}</div>
          <form method="post" action="/content/idee/erzeugen" class="id-holen-form">
            <input type="hidden" name="marke" value="${e(marke)}">
            <input type="hidden" name="zurueck" value="${e(url())}">
            <div class="feld"><label>Kanal</label>
              <select name="kanal">
                ${ct.KANAELE.map((k) => `<option ${(kanal || "TikTok") === k ? "selected" : ""}>${e(k)}</option>`).join("")}
              </select></div>
            <div class="feld"><label>Rubrik</label>
              <select name="rubrik">
                ${ct.RUBRIKEN.map((r) => `<option value="${r.id}" ${
                  (rub || "lifestyle") === r.id ? "selected" : ""}>${e(r.titel)}</option>`).join("")}
              </select></div>
            <button type="submit" class="dunkel" ${laufend.length ? "disabled" : ""}>
              ${ICON.funke} Ideen holen</button>
          </form>
          <p class="caption id-holen-fuss">${ICON.info}<span>
            Der Abendlauf um ${process.env.IDEEN_STUNDE || 19} Uhr sucht <strong>jeden Tag</strong>.
            Liegt schon genug vor (${VORLAUF_TAGE} Tage gedeckt oder ${OFFEN_GENUG} offene
            Vorschläge), wird danach <strong>aussortiert</strong>: je Stufe bleiben die besten
            ${BEHALTEN_JE_STUFE} stehen, schwächere wandern mit Begründung zu den verworfenen.
            So stapelt sich nichts, und eine bessere Idee von heute verdrängt eine
            schwächere von vorgestern.
            ${genugVorrat ? `<strong>Gerade greift das Aussortieren.</strong>` : ""}
            Und er läuft überhaupt nur, solange der Server an ist — auf einem zugeklappten
            Laptop passiert nichts. Der Knopf oben ist immer der verlässliche Weg.</span></p>
        </div>

        ${verworfen.length ? `
        <h2 class="id-abschnitt">Verworfen <span>${verworfen.length}</span></h2>
        <div class="karte">
          <p class="caption" style="margin-bottom:12px">Bleiben absichtlich stehen: sie gehen
            in den nächsten Auftrag, damit dieselbe Idee nicht in zwei Wochen wiederkommt.</p>
          <ul class="id-verworfen">${verworfen.slice(0, 25).map((i) =>
            `<li><span>${e(i.titel)}</span><i>${datum(i.entschieden_am)}</i></li>`).join("")}</ul>
        </div>` : ""}

        <div class="hinweis info" style="margin-top:16px">${ICON.info}<div>
          <strong>Woraus die Ideen kommen.</strong>
          Drei Quellen, in dieser Reihenfolge: erstens die eigenen gemessenen Zahlen —
          was bei euch gezogen hat und was nicht; zweitens das Funnel-Modell aus den
          beiden Quellen (digibrood, funnel.io); drittens Muster, die in Erklärinhalten
          beschrieben werden. <strong>Nicht</strong> dabei sind ausgelesene
          TikTok-Trenddaten: eine Trend-Schnittstelle gibt es nicht, und Auslesen
          verstößt gegen die Nutzungsbedingungen. Was hier steht, ist ein begründeter
          Vorschlag — keine Messung fremder Videos.</div></div>

        <dialog id="dlg-tafel"><form method="post" action="/content/idee/auf-tafel">
          <div class="todo-dlg-kopf"><div><h2>Auf die Produktionstafel</h2>
            <div class="sub" id="tf-titel">—</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <input type="hidden" name="id" id="tf-id">
          <input type="hidden" name="zurueck" value="${e(url())}">
          <div class="feld"><label>Für wann geplant</label>
            <input type="date" name="geplant_am" id="tf-tag" value="${datumFeld(freierTag)}" required></div>
          <p class="caption" style="margin:-4px 0 14px">Vorgeschlagen ist der nächste
            Tag mit einem freien Platz (${PRO_TAG} Videos je Tag). In der Tagesleiste
            siehst du, welche Tage noch Lücken haben — verschieben kannst du das
            Kärtchen danach jederzeit mit der Maus.</p>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.check} Auf die Tafel</button></div>
        </form></dialog>

        <dialog id="dlg-eigene"><form method="post" action="/content/idee/eigene">
          <div class="todo-dlg-kopf"><div><h2>Eigene Idee</h2>
            <div class="sub">Landet direkt in „Video aufnehmen"</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <input type="hidden" name="marke" value="${e(marke)}">
          <input type="hidden" name="zurueck" value="${e(url())}">
          <div class="feld"><label>Überschrift <span class="caption">— 3 bis 6 Wörter, zum Wiedererkennen</span></label>
            <input name="ueberschrift" maxlength="80" placeholder="z. B. „Ladezeit 8,4 auf 1,1"></div>
          <div class="feld"><label>Headline — der erste Satz im Video</label>
            <input name="titel" required maxlength="300"
              placeholder="z. B. „Diese eine Zeile kostet dich jeden Monat vier Patienten."></div>
          <div class="feld"><label>Worum geht es</label>
            <textarea name="idee" rows="3"
              placeholder="Was passiert im Video, was sieht man, wie endet es?"></textarea></div>
          <div class="feld-paar">
            <div class="feld"><label>Kanal</label>
              <select name="kanal">${ct.KANAELE.map((k) =>
                `<option ${k === "TikTok" ? "selected" : ""}>${e(k)}</option>`).join("")}</select></div>
            <div class="feld"><label>Rubrik</label>
              <select name="rubrik"><option value="">—</option>${ct.RUBRIKEN.map((r) =>
                `<option value="${r.id}">${e(r.titel)}</option>`).join("")}</select></div>
          </div>
          <div class="feld"><label>Funnel-Stufe</label>
            <select name="funnel"><option value="">—</option>${ct.FUNNEL.map((f) =>
              `<option value="${f.id}">${e(f.titel)}${f.kurz ? " (" + e(f.kurz) + ")" : ""}</option>`).join("")}</select></div>
          <div class="feld"><label>Skript <span class="caption">— wenn du schon eines hast</span></label>
            <textarea name="skript" rows="6"
              placeholder="Optional. Leer lassen und später schreiben lassen."></textarea></div>
          <p class="caption" style="margin:-4px 0 12px">Der Termin wird auf den nächsten
            freien Platz gelegt (${PRO_TAG} Videos je Tag). Verschieben kannst du das
            Kärtchen danach jederzeit mit der Maus.</p>
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
            <button type="submit" class="dunkel">${ICON.check} Auf die Tafel</button></div>
        </form></dialog>

        <dialog id="dlg-hochladen">
          <div class="todo-dlg-kopf"><div><h2>Datei &amp; Termin</h2>
            <div class="sub" id="hl-titel">—</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="feld"><label>Videodatei</label>
            <input type="file" id="hl-datei" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v">
            <p class="caption" style="margin-top:6px">mp4, mov, webm oder m4v, bis 500 MB.
              Die Datei bleibt auf diesem Rechner (Ordner <code>daten/videos</code>) —
              sie liegt nicht in der Datenbank und nicht im Git.</p></div>
          <div id="hl-fortschritt" class="hl-fortschritt" hidden><div></div></div>
          <form method="post" action="/content/termin" id="hl-form">
            <input type="hidden" name="post_id" id="hl-post">
            <input type="hidden" name="zurueck" value="${e(url())}">
            <div class="feld-paar">
              <div class="feld"><label>Veröffentlichen am</label>
                <input type="date" name="tag" id="hl-tag"></div>
              <div class="feld"><label>um</label>
                <input type="time" name="zeit" id="hl-zeit" value="18:30"></div>
            </div>
            <p class="caption" style="margin:-4px 0 12px">${ICON.warnung}
              <strong>Wichtig:</strong> Der Termin wird gespeichert, aber es wird
              <strong>nichts von selbst veröffentlicht</strong>. Dafür fehlen zwei Dinge:
              ein freigegebener Zugang je Plattform (TikTok, YouTube und Instagram prüfen
              jede App einzeln, das dauert Wochen) und ein Server, der durchläuft.
              Bis dahin ist das hier eine verbindliche Erinnerung, kein Automat.</p>
            <div class="dialog-fuss">
              <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
              <button type="submit" class="dunkel">${ICON.check} Speichern</button></div>
          </form>
        </dialog>

        <script>
        // ---------- Kärtchen verschieben ----------
        (function(){
          var gezogen = null;
          function zielKarte(ablage, y){
            var karten = Array.prototype.slice.call(ablage.querySelectorAll('.pt-karte:not(.pt-zieht)'));
            var naechste = { abstand: -Infinity, el: null };
            karten.forEach(function(k){
              var box = k.getBoundingClientRect();
              var versatz = y - box.top - box.height/2;
              if (versatz < 0 && versatz > naechste.abstand) naechste = { abstand: versatz, el: k };
            });
            return naechste.el;
          }
          document.querySelectorAll('.pt-karte').forEach(function(el){
            el.addEventListener('dragstart', function(ev){
              gezogen = el; setTimeout(function(){ el.classList.add('pt-zieht'); }, 0);
              ev.dataTransfer.effectAllowed = 'move';
            });
            el.addEventListener('dragend', function(){
              el.classList.remove('pt-zieht'); gezogen = null;
              document.querySelectorAll('.pt-spalte').forEach(function(s){ s.classList.remove('pt-ziel'); });
            });
          });
          document.querySelectorAll('.pt-spalte').forEach(function(sp){
            var ablage = sp.querySelector('.pt-ablage');
            sp.addEventListener('dragover', function(ev){
              ev.preventDefault(); sp.classList.add('pt-ziel');
              if (!gezogen) return;
              var nach = zielKarte(ablage, ev.clientY);
              if (nach == null) ablage.appendChild(gezogen); else ablage.insertBefore(gezogen, nach);
            });
            sp.addEventListener('dragleave', function(ev){
              if (!sp.contains(ev.relatedTarget)) sp.classList.remove('pt-ziel');
            });
            sp.addEventListener('drop', function(ev){
              ev.preventDefault(); sp.classList.remove('pt-ziel');
              if (!gezogen) return;
              var id = gezogen.getAttribute('data-id');
              var stufe = sp.getAttribute('data-stufe');
              // Sofort speichern. Bei einem Fehler wird neu geladen, damit die
              // Tafel nie etwas anzeigt, was gar nicht gespeichert ist.
              fetch('/content/stufe', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id, status: stufe })
              }).then(function(r){
                if (!r.ok) throw new Error('nicht gespeichert');
                // Neu laden, damit Tagestrenner und Zähler wieder stimmen.
                location.reload();
              }).catch(function(){
                alert('Das Verschieben wurde nicht gespeichert. Die Seite wird neu geladen.');
                location.reload();
              });
            });
          });
        })();

        // ---------- Datei & Termin ----------
        function eigeneOeffnen(){ document.getElementById("dlg-eigene").showModal(); }
        function tafelOeffnen(id, titel){
          document.getElementById("tf-id").value = id;
          document.getElementById("tf-titel").textContent = titel;
          document.getElementById("dlg-tafel").showModal();
        }
        function hochladenOeffnen(id, titel){
          document.getElementById('hl-post').value = id;
          document.getElementById('hl-titel').textContent = titel;
          var d = document.getElementById('hl-datei'); d.value = '';
          document.getElementById('hl-fortschritt').hidden = true;
          document.getElementById('dlg-hochladen').showModal();
        }
        // Die Datei geht als eigener Strom raus, NICHT über das Formular: 200 MB
        // durch einen Formular-Parser zu schicken hiesse, sie erst komplett in den
        // Speicher zu legen. So wandert sie direkt auf die Platte.
        document.getElementById('hl-datei').addEventListener('change', function(){
          var f = this.files && this.files[0];
          if (!f) return;
          var post = document.getElementById('hl-post').value;
          var bar = document.getElementById('hl-fortschritt');
          var innen = bar.firstElementChild;
          bar.hidden = false; innen.style.transform = 'scaleX(0)';
          var x = new XMLHttpRequest();
          x.open('POST', '/content/video/' + encodeURIComponent(post));
          x.setRequestHeader('Content-Type', 'application/octet-stream');
          x.setRequestHeader('X-Dateiname', encodeURIComponent(f.name));
          x.upload.onprogress = function(ev){
            if (ev.lengthComputable) innen.style.transform = 'scaleX(' + (ev.loaded / ev.total) + ')';
          };
          x.onload = function(){
            if (x.status === 200) { innen.style.transform = 'scaleX(1)'; bar.classList.add('fertig'); }
            else { bar.classList.add('kaputt'); alert('Die Datei kam nicht an: ' + x.responseText); }
          };
          x.onerror = function(){ bar.classList.add('kaputt'); alert('Die Datei kam nicht an.'); };
          x.send(f);
        });
        </script>
        ${laufend.length ? `<script>setTimeout(function(){ location.href = ${
          JSON.stringify(url())}; }, 15000);</script>` : ""}
        `,
      }) + "</body></html>");
    } catch (err) { next(err); }
  });

  // =================================================================
  //                        Ein Skript ansehen
  // =================================================================

  app.get("/content/idee/:id", angemeldet, async (req, res, next) => {
    try {
      const u = req.nutzer;
      if (!/^\d+$/.test(req.params.id)) return res.status(400).send("Ungültige Kennung");
      const i = await ideen.idee(u, req.params.id);
      if (!i) return res.status(404).send("Diese Idee gibt es nicht.");
      const laufend = laufAktiv();
      const f = ct.FUNNEL.find((x) => x.id === i.funnel);
      const fehler = req.query.fehler || "";

      res.send(schale({
        titel: i.titel, unterzeile: `${i.kanal}${i.rubrik ? " · " + ct.RUBRIK_TITEL[i.rubrik] : ""}${
          f ? " · " + f.titel : ""}`,
        aktiv: "content", nutzer: u,
        inhalt: `
        <div class="seiten-kopf">
          <div><a href="/content/ideen?marke=${encodeURIComponent(i.marke)}" class="ct-zurueck">
            ${ICON.pfeilLinks} Zurück zur Werkstatt</a></div>
        </div>

        ${fehler ? `<div class="hinweis warnung">${ICON.warnung}<div>${
          e(FEHLERTEXT[fehler] || fehler)}</div></div>` : ""}

        ${laufend.length ? `<div class="karte id-laeuft">
          <div class="id-spinner"></div>
          <div><strong>${e(laufend[0].text)}</strong>
            <div class="caption">Die Seite lädt sich alle 15 Sekunden nach.</div></div>
        </div>
        <script>setTimeout(function(){ location.reload(); }, 15000);</script>` : ""}

        <div class="karte" style="margin-bottom:16px">
          <h2>${e(i.titel)}</h2>
          <p class="id-text" style="margin-top:10px">${e(i.idee)}</p>
          ${i.warum ? `<div class="id-warum"><span>Warum das zieht</span><p>${e(i.warum)}</p></div>` : ""}
          ${f ? `<div class="id-warum"><span>${e(f.titel)} — wofür diese Stufe da ist</span>
            <p>${e(f.ziel || f.frage || "")}</p></div>` : ""}
        </div>

        <div class="karte">
          <div class="karte-kopf"><div><h2>Skript</h2>
            <div class="sub">${i.skript
              ? "geschrieben " + datum(i.skript_am) + " — zum Ändern neu schreiben lassen"
              : "noch nicht geschrieben"}</div></div>
            <form method="post" action="/content/idee/skript" class="id-form">
              <input type="hidden" name="id" value="${i.id}">
              <button type="submit" class="sekundaer klein" ${laufend.length ? "disabled" : ""}>${
                i.skript ? "Neu schreiben" : "Skript schreiben"}</button>
            </form></div>
          ${i.skript
            ? `<pre class="id-skript">${e(i.skript)}</pre>`
            : `<p class="caption">Noch kein Skript. Über den Knopf oben schreiben lassen —
               dauert eine bis zwei Minuten.</p>`}
        </div>

        ${i.skript && !i.post_id ? `
        <div class="karte" style="margin-top:16px">
          <div class="karte-kopf"><div><h2>Auf die Produktionstafel</h2>
            <div class="sub">Landet in „Video aufnehmen". Ein Kurzvideo läuft dabei
              automatisch auf TikTok, YouTube Shorts und Instagram — dasselbe Video,
              drei Kanäle.</div></div></div>
          <form method="post" action="/content/idee/plan" class="id-plan-form">
            <input type="hidden" name="id" value="${i.id}">
            <div class="feld"><label>Soll veröffentlicht werden am</label>
              <input type="date" name="geplant_am" value="${datumFeld(new Date())}" required></div>
            <button type="submit" class="dunkel">${ICON.check} Auf die Tafel</button>
          </form>
          <p class="caption" style="margin-top:10px">Das Datum steht danach auf dem
            Kärtchen — damit beim Vorproduzieren immer klar ist, für wann gedreht wird.</p>
        </div>` : ""}

        ${i.post_id ? `<div class="hinweis info" style="margin-top:16px">${ICON.info}<div>
          Liegt auf der Produktionstafel.
          <a href="/content/ideen?marke=${encodeURIComponent(i.marke)}">Zur Werkstatt →</a> ·
          <a href="/content/post/${i.post_id}">Zur Videoakte →</a></div></div>` : ""}
        `,
      }) + "</body></html>");
    } catch (err) { next(err); }
  });

  // =================================================================
  //                           Handlungen
  // =================================================================

  const sicherZurueck = (w) => (typeof w === "string" && w.startsWith("/content") ? w : "/content/ideen");
  // Die Rueckadresse traegt seit der Tagesansicht schon einen "tag"-Parameter.
  // Einen zweiten anzuhaengen half nichts: Express nimmt den ERSTEN, und die
  // Tafel blieb auf dem alten Tag stehen, statt zu dem zu springen, auf den
  // man das Kaertchen gerade gelegt hat.
  const mitTag = (adresse, tagWert) => {
    const ohne = adresse.replace(/([?&])tag=[^&]*&?/g, "$1").replace(/[?&]$/, "");
    return ohne + (ohne.includes("?") ? "&" : "?") + "tag=" + encodeURIComponent(tagWert);
  };

  app.post("/content/idee/erzeugen", angemeldet, formular, async (req, res) => {
    const b = req.body || {};
    const zurueck = sicherZurueck(b.zurueck);
    const trenn = zurueck.includes("?") ? "&" : "?";
    if (!ideen.bereit()) return res.redirect(zurueck + trenn + "fehler=kein-schluessel");
    const u = req.nutzer;
    laufStart("ideen", b.marke || u.id, "Ideen werden gesucht");
    // Absichtlich NICHT abgewartet: der Aufruf dauert ein bis zwei Minuten.
    ideen.ideenErzeugen(u, { marke: b.marke, kanal: b.kanal, rubrik: b.rubrik })
      .then((r) => { if (!r.ok) console.error("Ideen:", r.grund, r.text || ""); })
      .catch((err) => console.error("Ideen:", err.message))
      .finally(() => laufEnde("ideen", b.marke || u.id));
    res.redirect(zurueck + trenn + "hinweis=gestartet");
  });

  app.post("/content/idee/entscheiden", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const zurueck = sicherZurueck(b.zurueck);
      const trenn = zurueck.includes("?") ? "&" : "?";
      const r = await ideen.entscheiden(req.nutzer, b.id, b.status);
      if (!r.ok) return res.redirect(zurueck + trenn + "fehler=" + encodeURIComponent(r.grund));
      // Beim Haken gleich das Skript anstossen — dafuer soll man nicht noch
      // einmal klicken muessen.
      // Der Haken loest das Skript SOFORT aus, ohne zweite Bestaetigung. Der
      // Blick bleibt aber in der Werkstatt: die Idee rutscht sichtbar nach
      // "Angenommen" und schreibt dort im Hintergrund. Auf die Skriptseite zu
      // springen riss aus dem Entscheiden heraus — man will erst die naechsten
      // Vorschlaege durchgehen und danach lesen.
      if (b.status === "angenommen" && ideen.bereit()) {
        laufStart("skript", b.id, "Skript wird geschrieben");
        ideen.skriptErzeugen(req.nutzer, b.id)
          .then((x) => { if (!x.ok) console.error("Skript:", x.grund, x.text || ""); })
          .catch((err) => console.error("Skript:", err.message))
          .finally(() => laufEnde("skript", b.id));
      }
      res.redirect(zurueck);
    } catch (err) { next(err); }
  });

  app.post("/content/idee/skript", angemeldet, formular, async (req, res) => {
    const b = req.body || {};
    const zurueck = "/content/idee/" + encodeURIComponent(b.id);
    if (!ideen.bereit()) return res.redirect(zurueck + "?fehler=kein-schluessel");
    laufStart("skript", b.id, "Skript wird geschrieben");
    ideen.skriptErzeugen(req.nutzer, b.id)
      .then((x) => { if (!x.ok) console.error("Skript:", x.grund, x.text || ""); })
      .catch((err) => console.error("Skript:", err.message))
      .finally(() => laufEnde("skript", b.id));
    res.redirect(zurueck);
  });

  // Zweiter Haken: auf die Tafel. Der Termin wird NICHT abgefragt, sondern
  // auf den naechsten freien Platz gelegt (zwei Videos je Tag). Von Hand
  // entstuenden genau die Luecken und Doppelbelegungen, die den Ueberblick
  // kaputt machen — und einen Tag zu tippen ist Arbeit ohne Ertrag, solange
  // ohnehin der Reihe nach produziert wird. Verschieben geht danach jederzeit.
  app.post("/content/idee/auf-tafel", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const zurueck = sicherZurueck(b.zurueck);
      const trenn = zurueck.includes("?") ? "&" : "?";
      const i = await ideen.idee(req.nutzer, b.id);
      if (!i) return res.redirect(zurueck + trenn + "fehler=nicht-gefunden");
      // Der Tag kommt aus dem Dialog. Fehlt er, faellt es auf den naechsten
      // freien Platz zurueck — besser als ein Kaertchen ohne Datum, das in
      // keiner Tagesspalte auftaucht und damit unsichtbar waere.
      const tagWahl = /^\d{4}-\d{2}-\d{2}$/.test(b.geplant_am || "")
        ? b.geplant_am
        : await ct.naechsterFreierTag(req.nutzer, i.marke, PRO_TAG);
      const r = await ideen.inPlanUebernehmen(req.nutzer, b.id, tagWahl);
      if (!r.ok) return res.redirect(zurueck + trenn + "fehler=" + encodeURIComponent(r.grund));
      res.redirect(mitTag(zurueck, tagWahl) + "&hinweis=auf-tafel");
    } catch (err) { next(err); }
  });

  // Eigene Idee von Hand — landet direkt in "Video aufnehmen".
  app.post("/content/idee/eigene", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const zurueck = sicherZurueck(b.zurueck);
      const trenn = zurueck.includes("?") ? "&" : "?";
      const r = await ideen.eigeneIdee(req.nutzer, b);
      if (!r.ok) return res.redirect(zurueck + trenn + "fehler=" + encodeURIComponent(r.grund));
      const frei = b.geplant_am || await ct.naechsterFreierTag(req.nutzer, b.marke, PRO_TAG);
      const t = await ideen.inPlanUebernehmen(req.nutzer, r.id, frei);
      if (!t.ok) return res.redirect(zurueck + trenn + "fehler=" + encodeURIComponent(t.grund));
      res.redirect(mitTag(zurueck, frei instanceof Date
        ? frei.toISOString().slice(0, 10) : String(frei).slice(0, 10)) + "&hinweis=auf-tafel");
    } catch (err) { next(err); }
  });

  app.post("/content/idee/plan", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const r = await ideen.inPlanUebernehmen(req.nutzer, b.id, b.geplant_am || null);
      if (!r.ok) return res.redirect("/content/idee/" + encodeURIComponent(b.id) +
        "?fehler=" + encodeURIComponent(r.grund));
      res.redirect("/content/ideen");
    } catch (err) { next(err); }
  });

  // Stufe per Formular statt per fetch — fuer Knoepfe ausserhalb der Tafel,
  // etwa "Ist raus" im Faellig-Kasten.
  app.post("/content/stufe-formular", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const zurueck = sicherZurueck(b.zurueck);
      const r = await ct.stufeSetzen(req.nutzer, b.id, b.status);
      if (!r.ok) return res.redirect(zurueck);
      // Ist es draussen, ist der Veroeffentlichungsauftrag erledigt.
      const crm = require("./crm.js");
      await crm.alsNutzer(req.nutzer.id, async (q) => {
        await q(`update content_posts set veroeff_status = 'fertig' where id = $1`, [b.id]);
      });
      res.redirect(zurueck);
    } catch (err) { next(err); }
  });

  // Kaertchen verschieben. Antwortet knapp — die Seite laedt danach selbst neu.
  app.post("/content/stufe", angemeldet, express.json({ limit: "4kb" }), async (req, res) => {
    try {
      const b = req.body || {};
      const r = await ct.stufeSetzen(req.nutzer, b.id, b.status);
      if (!r.ok) return res.status(400).send(r.grund);
      res.json({ ok: true });
    } catch (err) { res.status(500).send(err.message); }
  });

  // Die Videodatei. Sie wird direkt auf die Platte GESTREAMT, nicht in den
  // Speicher gelesen: bei 200 MB je Video waere jeder Formular-Parser der falsche
  // Weg. Kein express.raw, kein Zwischenpuffer — der Request IST der Datenstrom.
  const VIDEO_TYPEN = new Set([".mp4", ".mov", ".webm", ".m4v"]);
  app.post("/content/video/:id", angemeldet, (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).send("Ungültige Kennung");
    let name = "video.mp4";
    try { name = decodeURIComponent(req.get("X-Dateiname") || "video.mp4"); } catch { /* Rohwert behalten */ }
    const endung = path.extname(name).toLowerCase();
    if (!VIDEO_TYPEN.has(endung)) return res.status(415).send("Nur mp4, mov, webm oder m4v.");

    fs.mkdirSync(VIDEO_ORDNER, { recursive: true });
    // Der Dateiname kommt aus dem Browser und wird NICHT uebernommen: er koennte
    // "../" enthalten und damit aus dem Ordner herausschreiben. Nur die Endung
    // wird behalten, der Name ist die Beitragsnummer.
    const ziel = path.join(VIDEO_ORDNER, req.params.id + endung);
    const strom = fs.createWriteStream(ziel);
    let bytes = 0;
    const GRENZE = 500 * 1024 * 1024;
    let abgebrochen = false;

    req.on("data", (stueck) => {
      bytes += stueck.length;
      if (bytes > GRENZE && !abgebrochen) {
        abgebrochen = true;
        strom.destroy();
        fs.rm(ziel, { force: true }, () => {});
        res.status(413).send("Größer als 500 MB.");
        req.destroy();
      }
    });
    req.pipe(strom);
    strom.on("error", (err) => {
      if (!abgebrochen) { abgebrochen = true; res.status(500).send(err.message); }
    });
    strom.on("finish", async () => {
      if (abgebrochen) return;
      try {
        const crm = require("./crm.js");
        await crm.alsNutzer(req.nutzer.id, async (q) => {
          await q(`update content_posts set datei_pfad = $2, datei_groesse = $3 where id = $1`,
            [req.params.id, path.relative(path.join(__dirname, ".."), ziel), bytes]);
        });
        res.json({ ok: true, bytes });
      } catch (err) { res.status(500).send(err.message); }
    });
  });

  // Veroeffentlichungszeitpunkt setzen.
  app.post("/content/termin", angemeldet, formular, async (req, res, next) => {
    try {
      const b = req.body || {};
      const zurueck = sicherZurueck(b.zurueck);
      const trenn = zurueck.includes("?") ? "&" : "?";
      if (!/^\d+$/.test(String(b.post_id || ""))) return res.redirect(zurueck);
      // Tag und Uhrzeit kommen getrennt aus dem Formular. Zusammengesetzt wird
      // OHNE Zeitzonen-Umrechnung im Browser — die Datenbank steht auf
      // Europe/Berlin, und "18:30" soll 18:30 in Traunstein heissen.
      const zeit = /^\d{2}:\d{2}$/.test(b.zeit || "") ? b.zeit : "18:30";
      const crm = require("./crm.js");
      await crm.alsNutzer(req.nutzer.id, async (q) => {
        await q(
          `update content_posts
              set geplant_um = case when $2 = '' then null
                    else ($2 || ' ' || $3)::timestamp at time zone 'Europe/Berlin' end,
                  geplant_am = case when $2 = '' then geplant_am else $2::date end,
                  veroeff_status = case when $2 = '' then null else 'wartet' end,
                  -- Sobald Datei UND Termin stehen, rueckt das Kaertchen selbst nach
                  -- "Geplant". Die Spalte bedeutet genau das ("Datei und Termin
                  -- stehen") — es dort liegen zu lassen wuerde die Tafel unwahr
                  -- machen, und niemand soll ein Kaertchen von Hand nachziehen
                  -- muessen, nur damit die Beschriftung wieder stimmt.
                  status = case
                    when status = 'hochladen' and datei_pfad is not null and $2 <> ''
                    then 'geplant' else status end,
                  stufe_seit = case
                    when status = 'hochladen' and datei_pfad is not null and $2 <> ''
                    then now() else stufe_seit end
            where id = $1`,
          [b.post_id, b.tag || "", zeit]);
      });
      res.redirect(zurueck + trenn + "hinweis=gespeichert");
    } catch (err) { next(err); }
  });

  // =================================================================
  //     Abendlauf — aber nur, wenn der Vorrat nicht schon reicht
  // =================================================================
  //
  // Jannik hat es genau so gesagt: reichen die Ideen fuer drei Wochen, muss
  // nicht jeden Abend gesucht werden. Ideen auf Ideen zu stapeln hilft nicht,
  // es kostet nur Geld und macht die Liste unlesbar.
  //
  // EHRLICH: Das laeuft nur, solange der Server laeuft. Auf einem zugeklappten
  // Laptop passiert um 19 Uhr nichts. Steht auch so auf der Seite.
  const IDEEN_STUNDE = Number(process.env.IDEEN_STUNDE || 19);
  const berlinStunde = () => Number(new Intl.DateTimeFormat("de-DE",
    { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(new Date()));
  const berlinTag = () => new Intl.DateTimeFormat("sv-SE",
    { timeZone: "Europe/Berlin" }).format(new Date());
  const FACH = ["ki", "webdesign", "performance"];
  let letzterIdeenTag = "";

  const abendlauf = async () => {
    if (!ideen.bereit()) return;
    const heute = berlinTag();
    if (letzterIdeenTag === heute) return;
    if (berlinStunde() !== IDEEN_STUNDE) return;
    letzterIdeenTag = heute;
    try {
      const crm = require("./crm.js");
      const { rows } = await crm.system(
        `select distinct z.marke, p.name from content_ziele z
           join profiles p on p.id = z.marke`);
      if (!rows.length) return;
      // Der Tag bestimmt die Fachrubrik — einfach, nachvollziehbar, und ohne
      // Zustand, der beim Neustart verloren gehen koennte.
      const fach = FACH[Math.floor(Date.now() / 86400000) % FACH.length];
      for (const m of rows) {
        const nutzer = { id: m.marke, name: m.name };
        const [deckung, offen] = await Promise.all([
          ct.abdeckung(nutzer, m.marke),
          ideen.ideen(nutzer, { marke: m.marke, status: "vorschlag" }),
        ]);
        if (deckung.tage >= VORLAUF_TAGE) {
          console.log(`Ideen ${m.name}: ausgesetzt — ${deckung.tage} Tage gedeckt.`);
          continue;
        }
        if (offen.length >= OFFEN_GENUG) {
          console.log(`Ideen ${m.name}: ausgesetzt — ${offen.length} Vorschläge offen.`);
          continue;
        }
        for (const r of ["lifestyle", fach]) {
          const erg = await ideen.ideenErzeugen(nutzer, { marke: m.marke, kanal: "TikTok", rubrik: r });
          console.log(`Ideen ${m.name} / ${r}: ${erg.ok ? erg.anzahl + " Ideen" : "Fehler " + erg.grund}`);
        }
      }
    } catch (err) { console.error("Abendlauf Ideen:", err.message); }
  };
  setInterval(abendlauf, 10 * 60 * 1000).unref();

  // Faelligkeits-Waechter: alle zwei Minuten pruefen, ob ein Termin erreicht ist.
  //
  // Hier wuerde das Absetzen stehen. Solange kein freigegebener Plattformzugang
  // da ist, waere ein Status "veroeffentlicht" an dieser Stelle gelogen — und
  // saemtliche Zahlen der Folgewochen fussten auf einer Behauptung. Darum wird
  // gemeldet statt behauptet. Kommt der Zugang, tritt der Aufruf genau hier
  // hinein; am Ablauf drumherum aendert sich nichts.
  const faelligPruefen = async () => {
    try {
      const neu = await ct.faelligPruefen();
      if (neu.length) console.log(`Content: ${neu.length} Video(s) faellig — ${
        neu.map((x) => x.titel).join(", ")}`);
    } catch (err) { console.error("Faelligkeit:", err.message); }
  };
  setInterval(faelligPruefen, 2 * 60 * 1000).unref();
  faelligPruefen();
  console.log(`Content: Ideen-Abendlauf ${IDEEN_STUNDE} Uhr, setzt bei ${VORLAUF_TAGE} Tagen Vorlauf aus (nur bei laufendem Server).`);
};
