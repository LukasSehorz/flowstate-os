// lib/todo-routes.js — die To-Do-Seite des OS (/todos).
//
// Warum sie hier liegt und nicht im CRM: To-Dos sind nicht nur Vertrieb.
// "TikTok schneiden", "Steuerunterlagen raussuchen", "Server neu starten" haben
// mit keinem Kunden zu tun, gehoeren aber in dieselbe Liste — sonst fuehrt man
// zwei und vergisst die zweite. Darum haengt die Seite unter der Zentrale, wo
// der Tag steht, direkt neben dem Kalender.
//
// WICHTIG: Das ist KEINE zweite To-Do-Verwaltung. Gelesen und geschrieben wird
// dieselbe Tabelle "aufgaben" ueber dieselben Funktionen in lib/crm.js, aus
// denen auch /crm/todos und "Heute zu tun" im CRM-Dashboard leben. Wer hier
// abhakt, hat es auch dort abgehakt. Eine zweite Tabelle waere die sicherste
// Art, zwei Wahrheiten zu erzeugen.
//
// Der Unterschied zu /crm/todos ist die Sicht, nicht die Sache: dort die
// Vertriebsliste neben den Kundenakten, hier der Tag — was heute ansteht, was
// ueberfaellig ist, was noch keinen Tag hat.

const express = require("express");
const { schale, eintragen } = require("./schale.js");
const crm = require("./crm.js");

// Haengt als dritter Unterpunkt unter die Zentrale, hinter den Kalender.
// eintragen() fuehrt Unterpunkte zusammen (siehe schale.js), der Eintrag des
// Kalenders bleibt also stehen, egal welches Modul zuerst geladen wird.
eintragen({
  id: "zentrale", titel: "Zentrale", icon: "zentrale", href: "/", gruppe: "Übersicht",
  unter: [{ id: "zentrale-todos", titel: "To-Dos", icon: "todo", href: "/todos", nach: "kalender" }],
});

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Lokale Datumsfelder — nie toISOString(), das dreht oestlich von UTC auf den
// Vortag. Derselbe Grund wie in buchhaltung-routes.js und content-routes.js.
const tagVon = (w) => {
  if (!w) return "";
  const d = new Date(w);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const heuteTag = () => tagVon(new Date());
const datum = (d) => (d ? new Date(d).toLocaleDateString("de-DE",
  { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  uhr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  warnung: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  kunden: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
  stapel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg>',
  haken: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
};

// Wichtigkeit 1-4 wie im CRM. Die Zahl steht in der Datenbank, hier steht,
// was sie bedeutet — und in welcher Farbe sie erscheint.
const WICHTIG = {
  1: { titel: "Sehr wichtig", ton: "b-rot" },
  2: { titel: "Wichtig", ton: "b-bernstein" },
  3: { titel: "Sollte erledigt werden", ton: "b-blau" },
  4: { titel: "Kann warten", ton: "" },
};
// Die vier Spalten der Tafel — dieselbe Skala und dieselben Namen wie im
// CRM-Dashboard unter "Heute zu tun". Zwei Skalen fuer dasselbe waeren der
// sichere Weg, dass "wichtig" hier und dort etwas anderes heisst.
const SPALTEN = crm.WICHTIGKEITEN;
// Dringlichkeit ist die zweite Achse: wichtig sagt, was es bringt, dringend
// sagt, wann es weg muss. Die Farben sind die des CRM-Dashboards.
const DRING_FARBE = {
  "Extrem dringend": "b-rot", "Dringend": "b-rot", "ASAP": "b-bernstein",
  "Bald": "b-blau", "Wenn Zeit da ist": "",
};
const DRINGEND_HART = ["Extrem dringend", "Dringend"];
// Die drei Sparten faerben die Karte. Dieselben Namen wie im CRM.
const SPARTE_LABEL = { webdesign: "Webdesign", performance: "Performance Marketing", ki: "KI-Projekte" };
// Rang fuer die Sortierung INNERHALB einer Spalte: 0 ist am dringendsten.
// Ohne Angabe landet ganz unten (99) — nicht oben: eine Aufgabe, bei der
// niemand gesagt hat, wann sie weg muss, verdraengt keine, bei der es jemand
// gesagt hat.
const DRING_RANG = Object.fromEntries(
  ["Extrem dringend", "Dringend", "ASAP", "Bald", "Wenn Zeit da ist"].map((d, i) => [d, i]));
const rang = (t) => (t.dringlichkeit && DRING_RANG[t.dringlichkeit] !== undefined
  ? DRING_RANG[t.dringlichkeit] : 99);

module.exports = function (app) {
  const formular = express.urlencoded({ extended: true });

  // To-Dos haengen am persoenlichen Konto (aufgaben.besitzer), nicht am
  // gemeinsamen Passwort. Ohne persoenliche Anmeldung gibt es nichts zu zeigen.
  const angemeldet = (req, res, next) => {
    if (!req.session || !req.session.crm) return res.redirect("/crm/anmelden");
    req.nutzer = req.session.crm;
    next();
  };

  // Auszug fuer die Karte auf der Zentrale. Nicht die ganze Liste, sondern
  // was heute zaehlt: die Zahlen und hoechstens fuenf Zeilen — ueberfaellige
  // zuerst, danach die von heute. Die Karte soll sagen, ob etwas brennt, und
  // fuer alles Weitere auf diese Seite zeigen.
  app.get("/api/todos/stats", async (req, res) => {
    const u = req.session && req.session.crm;
    if (!u) return res.json({ ok: false, anmeldung: true, hint: "Mit persönlichem Konto anmelden." });
    try {
      const alle = await crm.todoListe(u, { nurOffen: false });
      const heute = heuteTag();
      const offen = alle.filter((t) => !t.erledigt);
      const ueberfaellig = offen.filter((t) => t.faellig && tagVon(t.faellig) < heute);
      const heuteListe = offen.filter((t) => t.geplant_am && tagVon(t.geplant_am) === heute
        && !ueberfaellig.includes(t));
      const ohnePlan = offen.filter((t) => !t.geplant_am);
      const heuteFertig = alle.filter((t) => t.erledigt && t.geplant_am && tagVon(t.geplant_am) === heute);
      const kurz = (t) => ({
        titel: t.titel, firma: t.firma_name || null,
        faellig: t.faellig ? datum(t.faellig) : null,
        spaet: Boolean(t.faellig && tagVon(t.faellig) < heute),
      });
      res.json({
        ok: true,
        heute: heuteListe.length, ueberfaellig: ueberfaellig.length,
        offen: offen.length, ohne_plan: ohnePlan.length, heute_erledigt: heuteFertig.length,
        naechste: [...ueberfaellig, ...heuteListe].slice(0, 5).map(kurz),
      });
    } catch (e) {
      console.error("To-Do-Kennzahlen:", e.message);
      res.json({ ok: false, hint: "To-Dos nicht erreichbar." });
    }
  });

  app.get("/todos", angemeldet, async (req, res, next) => {
    try {
      const u = req.nutzer;
      const [alle, firmen] = await Promise.all([
        crm.todoListe(u),
        crm.firmenListe(u, { limit: 300 }),
      ]);
      const heute = heuteTag();

      const offen = alle.filter((t) => !t.erledigt);
      const erledigt = alle.filter((t) => t.erledigt);
      // Ueberfaellig zuerst und getrennt: eine Aufgabe, deren Frist verstrichen
      // ist, gehoert nicht unter "spaeter geplant" versteckt.
      const ueberfaellig = offen.filter((t) => t.faellig && tagVon(t.faellig) < heute);
      const nichtUeber = offen.filter((t) => !ueberfaellig.includes(t));
      const heuteListe = nichtUeber.filter((t) => t.geplant_am && tagVon(t.geplant_am) === heute);
      const spaeter = nichtUeber.filter((t) => t.geplant_am && tagVon(t.geplant_am) > heute);
      // Geplant, aber der Tag ist vorbei: nicht verschwinden lassen.
      const liegengeblieben = nichtUeber.filter((t) => t.geplant_am && tagVon(t.geplant_am) < heute);
      const ohnePlan = nichtUeber.filter((t) => !t.geplant_am);
      const heuteFertig = erledigt.filter((t) => t.geplant_am && tagVon(t.geplant_am) === heute);

      const kachel = (label, zahl, icon, ton, fuss) => `
        <div class="kachel"><div class="kachel-kopf">
          <span class="kachel-label">${label}</span>
          <span class="kachel-icon ${ton || ""}">${icon}</span></div>
          <div class="kachel-zahl">${zahl}</div>
          <div class="kachel-fuss"><span class="caption">${fuss}</span></div></div>`;

      // ---------- Die Tafel: heute, nach Wichtigkeit in vier Spalten ----------
      //
      // Zwei Achsen, und sie beantworten verschiedene Fragen. Die SPALTE sagt,
      // was es bringt (sehr wichtig … kann warten). Das BADGE sagt, wann es weg
      // muss (extrem dringend … wenn Zeit da ist). Wichtig und nicht dringend
      // ist Arbeit, die man planen kann; dringend und unwichtig ist der Grund,
      // warum Abende lang werden. Erst beide Achsen zusammen machen daraus eine
      // Entscheidung — deshalb stehen sie nebeneinander und nicht als eine
      // sortierte Liste.
      //
      // Ueberfaellige stehen MIT auf der Tafel, auch wenn ihr geplanter Tag in
      // der Vergangenheit liegt: was die Frist gerissen hat, ist heute faellig,
      // egal was einmal geplant war.
      //
      // Innerhalb einer Spalte steht das Dringendste oben. Die Reihenfolge:
      //   1. ueberfaellig vor allem anderen, aelteste Frist zuerst
      //   2. danach der Dringlichkeitsrang (extrem dringend … ohne Angabe)
      //   3. bei gleichem Rang die naeher liegende Frist
      // Die Spalte ordnet also nach WICHTIGKEIT, die Reihenfolge darin nach
      // DRINGLICHKEIT — so liest man von links oben nach rechts unten genau in
      // der Reihenfolge, in der man arbeiten sollte.
      const tafelKarten = [...ueberfaellig, ...heuteListe].sort((a, b) => {
        const uA = a.faellig && tagVon(a.faellig) < heute, uB = b.faellig && tagVon(b.faellig) < heute;
        if (uA !== uB) return uA ? -1 : 1;
        if (uA && uB) return String(a.faellig).localeCompare(String(b.faellig));
        const r = rang(a) - rang(b);
        if (r) return r;
        if (a.faellig && b.faellig) return String(a.faellig).localeCompare(String(b.faellig));
        if (a.faellig !== b.faellig) return a.faellig ? -1 : 1;
        return Number(a.id) - Number(b.id);
      });
      const tafelKarte = (t) => {
        const spaet = t.faellig && tagVon(t.faellig) < heute;
        const dring = t.dringlichkeit || "";
        // Klick auf die Karte oeffnet das Detailfenster — dasselbe wie im
        // CRM-Dashboard. Der Haken und das Ziehen duerfen es NICHT ausloesen,
        // darum stoppen die ihre Ereignisse selbst.
        return `<div class="heute-todo td-karte${t.sparte ? ` sp-${e(t.sparte)}` : ""}${
            DRINGEND_HART.includes(dring) || spaet ? " heute-todo--dringend" : ""}"
            draggable="true" data-id="${t.id}"
            onclick="document.getElementById('td-dlg-${t.id}').showModal()">
          <form method="post" action="/todos/erledigt" class="todo-check" onclick="event.stopPropagation()">
            <input type="hidden" name="id" value="${t.id}">
            <input type="hidden" name="erledigt" value="1">
            <button type="submit" class="todo-haken" title="Erledigt">${ICON.check}</button>
          </form>
          <div class="heute-todo-text">
            <div class="heute-todo-titel">${e(t.titel)}</div>
            <span class="heute-todo-kunde">${t.firma_name ? e(t.firma_name) : "Allgemein"}${
              t.faellig ? ` · ${spaet ? "seit" : "bis"} ${datum(t.faellig)}` : ""}</span>
            ${/* Immer ein Dringlichkeits-Abzeichen, auch ohne Angabe. Eine Karte
                  ohne jedes Abzeichen sieht aus, als fehlte etwas — und man
                  kann nicht unterscheiden, ob die Dringlichkeit niedrig ist
                  oder nie festgelegt wurde. Genau das war der Fall bei allem,
                  was ueber /crm/todos angelegt wurde: das Formular dort kannte
                  die zweite Achse nicht. */""}
            ${dring
              ? `<span class="badge dring ${DRING_FARBE[dring] || ""}">${e(dring)}</span>`
              : `<span class="badge dring still" title="Keine Dringlichkeit festgelegt">ohne Angabe</span>`}
            ${spaet ? `<span class="badge dring b-rot">überfällig</span>` : ""}
          </div>
        </div>`;
      };

      // Das Detailfenster zu einer Karte. Gleicher Aufbau wie im CRM-Dashboard,
      // damit dieselbe Aufgabe an beiden Orten gleich aussieht — und mit dem
      // Weg in die Kundenakte, wenn ein Kunde dranhaengt.
      const tafelFenster = (t) => {
        const spaet = t.faellig && tagVon(t.faellig) < heute;
        const w = WICHTIG[t.wichtigkeit] || WICHTIG[3];
        return `<dialog id="td-dlg-${t.id}" class="todo-dialog">
          <div class="todo-dlg-kopf"><div>
            <h2>${t.firma_name ? e(t.firma_name) : "Allgemeine Aufgabe"}</h2>
            <div class="sub">${e(t.titel)}</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <div class="todo-dlg-badges">
            <span class="badge">Wichtigkeit: ${e(w.titel)}</span>
            ${t.dringlichkeit ? `<span class="badge ${DRING_FARBE[t.dringlichkeit] || ""}">${e(t.dringlichkeit)}</span>` : ""}
            ${t.sparte ? `<span class="badge sp-abzeichen sp-${e(t.sparte)}">${e(SPARTE_LABEL[t.sparte] || t.sparte)}</span>` : ""}
            ${spaet ? `<span class="badge b-rot">überfällig</span>` : ""}</div>
          <div class="todo-dlg-grid">
            <div><span>Bis wann</span><b>${t.faellig ? datum(t.faellig) : "—"}</b></div>
            <div><span>An wen</span><b>${t.geschaeftsfuehrer
              ? e(t.geschaeftsfuehrer) + (t.ansprech_rolle ? ` · ${e(t.ansprech_rolle)}` : "")
              : "—"}</b></div></div>
          <h3>Was genau</h3>
          <p class="todo-dlg-text">${t.notiz ? e(t.notiz) : "—"}</p>
          ${t.firma_name ? `<h3>Kundenakte · ${e(t.firma_name)}</h3>
            <dl class="def">
              <dt>Telefon</dt><dd>${t.telefon ? `<a href="tel:${e(t.telefon)}">${e(t.telefon)}</a>` : "—"}</dd>
              <dt>E-Mail</dt><dd>${t.email ? `<a href="mailto:${e(t.email)}">${e(t.email)}</a>` : "—"}</dd>
              <dt>Ort</dt><dd>${e(t.ort || "—")}</dd></dl>` : ""}
          <div class="dialog-fuss">
            <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Schließen</button>
            ${t.firma_id
              ? `<a class="knopf dunkel" href="/crm/firma/${t.firma_id}?von=todos">Zur vollständigen Kundenakte →</a>`
              : ""}
          </div>
        </dialog>`;
      };
      const tafel = `
        <div class="karte td-tafel">
          <div class="karte-kopf"><div>
            <h2>Heute ${tafelKarten.length ? `<span class="badge">${tafelKarten.length}</span>` : ""}</h2>
            <div class="sub">Spalte = Wichtigkeit · Abzeichen = Dringlichkeit ·
              zum Umsortieren einfach in eine andere Spalte ziehen</div></div></div>
          <div class="heute-spalten td-spalten">
            ${SPALTEN.map((sp) => {
              const drin = tafelKarten.filter((t) => (Number(t.wichtigkeit) || 3) === sp.n);
              return `<div class="heute-spalte" data-wichtigkeit="${sp.n}">
                <div class="heute-spalte-kopf">${e(sp.titel)}${drin.length ? ` · ${drin.length}` : ""}</div>
                ${drin.map(tafelKarte).join("") || `<p class="caption td-spalte-leer">—</p>`}
              </div>`;
            }).join("")}
          </div>
          ${/* Die Fenster liegen NACH den Spalten, nicht in den Karten: ein
               <dialog> in einem ziehbaren Element wandert beim Ziehen mit und
               verliert dabei seinen Platz im Dokument. */""}
          ${tafelKarten.map(tafelFenster).join("")}
          ${tafelKarten.length ? "" : `<p class="caption" style="margin-top:14px">
            Für heute ist nichts eingeplant und nichts überfällig. Unten bei einer Aufgabe
            das Datum auf heute setzen, dann steht sie hier.</p>`}
        </div>`;

      const zeile = (t) => {
        const gepl = t.geplant_am ? tagVon(t.geplant_am) : "";
        const spaet = t.faellig && tagVon(t.faellig) < heute;
        const w = WICHTIG[t.wichtigkeit] || WICHTIG[3];
        return `<div class="todo-zeile ${t.erledigt ? "todo-erledigt" : ""}">
          <form method="post" action="/todos/erledigt" class="todo-check">
            <input type="hidden" name="id" value="${t.id}">
            <input type="hidden" name="erledigt" value="${t.erledigt ? "0" : "1"}">
            <button type="submit" class="todo-haken ${t.erledigt ? "an" : ""}"
              title="${t.erledigt ? "Wieder öffnen" : "Erledigt"}">${t.erledigt ? ICON.check : ""}</button>
          </form>
          <div class="todo-text">
            <div class="todo-titel">${e(t.titel)}</div>
            <div class="todo-meta">
              ${t.firma_name
                ? `<a href="/crm/firma/${t.firma_id}">${ICON.kunden} ${e(t.firma_name)}</a>`
                : `<span class="caption">Allgemein</span>`}
              ${t.faellig ? `<span class="badge ${spaet ? "b-rot" : "b-bernstein"}">bis ${datum(t.faellig)}</span>` : ""}
              ${t.wichtigkeit && t.wichtigkeit <= 2 ? `<span class="badge ${w.ton}">${w.titel}</span>` : ""}
              ${t.notiz ? `<span class="caption td-notiz">${e(t.notiz)}</span>` : ""}
            </div>
          </div>
          <form method="post" action="/todos/planen" class="todo-plan">
            <input type="hidden" name="id" value="${t.id}">
            <input type="date" name="geplant_am" value="${gepl}" onchange="this.form.submit()"
              title="Für welchen Tag einplanen">
          </form>
          <form method="post" action="/todos/loeschen" onsubmit="return confirm('To-Do löschen?')">
            <input type="hidden" name="id" value="${t.id}">
            <button type="submit" class="still todo-weg" title="Löschen">${ICON.x}</button>
          </form>
        </div>`;
      };

      // Ein leerer Block wird gar nicht erst gebaut — mit einer Ausnahme:
      // "Heute" steht immer, weil "heute ist nichts eingeplant" eine Aussage
      // ist und kein fehlender Inhalt. Vier Karten, in denen "nichts" steht,
      // sind dagegen nur Rauschen.
      //
      // Und der rote Rand haengt an der Liste, nicht am Blocktyp: ein roter
      // Rahmen um den Satz "Nichts überfällig" schreit ohne Grund.
      const block = (titel, unter, liste, leer, ton) => {
        if (!liste.length && !leer) return "";
        const rot = ton === "td-spaet" && liste.length;
        return `
        <div class="karte td-block${rot ? " td-spaet" : ""}">
          <div class="karte-kopf"><div>
            <h2>${titel} ${liste.length ? `<span class="badge ${rot ? "b-rot" : ""}">${liste.length}</span>` : ""}</h2>
            <div class="sub">${unter}</div></div></div>
          ${liste.length ? liste.map(zeile).join("") : `<p class="caption">${leer}</p>`}
        </div>`;
      };

      res.send(schale({
        titel: "To-Dos", aktiv: "zentrale-todos", nutzer: u, suche: "To-Dos durchsuchen …",
        inhalt: `
        <div class="seiten-kopf">
          <div><p class="sub">Alles, was ansteht — mit und ohne Kunde. Dieselbe Liste wie im CRM.</p></div>
          <div class="zt-tasten">
            <button type="button" class="dunkel" onclick="document.getElementById('dlg-todo').showModal()">
              ${ICON.plus} Aufgabe anlegen</button>
          </div>
        </div>

        ${ueberfaellig.length ? `<div class="hinweis warn" style="margin-bottom:16px">${ICON.warnung}<div>
          <strong>${ueberfaellig.length} ${ueberfaellig.length === 1 ? "Aufgabe ist" : "Aufgaben sind"} überfällig.</strong>
          Die Frist ist verstrichen — erledigen oder ein neues Datum setzen.</div></div>` : ""}

        <div class="kacheln">
          ${kachel("Heute", tafelKarten.length, ICON.uhr, "",
            `${heuteListe.length} geplant${ueberfaellig.length ? ` · ${ueberfaellig.length} überfällig` : ""}`)}
          ${kachel("Überfällig", ueberfaellig.length, ICON.warnung, ueberfaellig.length ? "rot" : "",
            ueberfaellig.length ? "Frist verstrichen" : "nichts überfällig")}
          ${kachel("Offen insgesamt", offen.length, ICON.stapel, "",
            `${ohnePlan.length} ohne Tag`)}
          ${/* Zaehlt HEUTE erledigt, nicht seit Beginn: auf einer Tagesansicht ist
                "was habe ich heute geschafft" die Frage, nicht "wie viele jemals".
                Die Gesamtzahl steht daneben. */""}
          ${kachel("Heute erledigt", heuteFertig.length, ICON.haken, "gruen",
            `${erledigt.length} seit Beginn`)}
        </div>

        ${alle.length ? `
          ${tafel}
          ${block("Liegengeblieben", "War für einen vergangenen Tag geplant und ist noch offen", liegengeblieben, "")}
          ${block("Später geplant", "Hat einen Tag, aber nicht heute", spaeter, "")}
          ${block("Ohne Tag", "Noch nicht eingeplant — hier verschwindet Arbeit am ehesten", ohnePlan, "")}
          ${block("Zuletzt erledigt", "Die letzten zwanzig", erledigt.slice(0, 20), "")}`
        : `<div class="karte"><div class="leer">
            <div class="leer-icon">${ICON.haken}</div>
            <h3>Noch keine Aufgabe</h3>
            <p>Alles, was ansteht — mit Kunde oder ohne. Was hier einen Tag bekommt,
               erscheint an dem Tag unter „Heute" und im CRM-Dashboard unter „Heute zu tun".</p>
            <p style="margin-top:16px"><button type="button" class="dunkel"
              onclick="document.getElementById('dlg-todo').showModal()">${ICON.plus} Erste Aufgabe anlegen</button></p>
          </div></div>`}

        <dialog id="dlg-todo" class="todo-dialog">
          <div class="todo-dlg-kopf"><div><h2>Neue Aufgabe</h2>
            <div class="sub">Frei formuliert oder mit einem Kunden verknüpft</div></div>
            <button type="button" class="still" onclick="this.closest('dialog').close()">${ICON.x}</button></div>
          <form method="post" action="/todos/anlegen">
            <div class="feld"><label>Aufgabe *</label>
              <input name="titel" required autofocus
                placeholder="z. B. Angebot schicken · TikTok schneiden · Steuerunterlagen"></div>
            <div class="feld-paar">
              <div class="feld"><label>Kunde (optional)</label>
                <select name="firma_id">
                  <option value="">— Allgemein, kein Kunde —</option>
                  ${firmen.map((f) => `<option value="${f.id}">${e(f.name)}</option>`).join("")}
                </select></div>
              <div class="feld"><label>Wichtigkeit <span class="caption">was es bringt</span></label>
                <select name="wichtigkeit">
                  ${[1, 2, 3, 4].map((n) => `<option value="${n}"${n === 3 ? " selected" : ""}>${WICHTIG[n].titel}</option>`).join("")}
                </select></div>
            </div>
            <div class="feld-paar">
              <div class="feld"><label>Dringlichkeit <span class="caption">wann es weg muss</span></label>
                <select name="dringlichkeit">
                  <option value="">— nicht festgelegt —</option>
                  ${crm.DRINGLICHKEITEN.map((d) => `<option value="${e(d)}"${d === "Bald" ? " selected" : ""}>${e(d)}</option>`).join("")}
                </select></div>
              <div class="feld"><label>Geplant für</label>
                <input type="date" name="geplant_am" value="${heute}"></div>
            </div>
            <div class="feld-paar">
              <div class="feld"><label>Fällig bis (optional)</label>
                <input type="date" name="faellig"></div>
              <div class="feld"><label>Notiz (optional)</label>
                <input name="notiz" placeholder="Kurz, was zu tun ist"></div>
            </div>
            <div class="dialog-fuss">
              <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
              <button type="submit" class="dunkel">${ICON.plus} Anlegen</button>
            </div>
          </form>
        </dialog>

        <script>
        // Ziehen zwischen den Wichtigkeits-Spalten. Anders als die gleich
        // aussehende Tafel im CRM-Dashboard wird hier GESPEICHERT: die Karte
        // meldet ihre neue Spalte an /todos/wichtigkeit. Ohne das wäre das
        // Ziehen eine Geste, die beim Neuladen vergessen ist — und das ist
        // schlimmer als gar kein Ziehen, weil man sich darauf verlässt.
        (function () {
          var gezogen = null;
          document.querySelectorAll(".td-karte").forEach(function (k) {
            k.addEventListener("dragstart", function (ev) {
              gezogen = k;
              setTimeout(function () { k.classList.add("todo-zieht"); }, 0);
              ev.dataTransfer.effectAllowed = "move";
            });
            k.addEventListener("dragend", function () {
              k.classList.remove("todo-zieht"); gezogen = null;
              document.querySelectorAll(".spalte-ziel").forEach(function (s) { s.classList.remove("spalte-ziel"); });
            });
          });
          document.querySelectorAll(".td-spalten .heute-spalte").forEach(function (sp) {
            sp.addEventListener("dragover", function (ev) {
              if (!gezogen) return;
              ev.preventDefault(); ev.dataTransfer.dropEffect = "move";
              sp.classList.add("spalte-ziel");
            });
            sp.addEventListener("dragleave", function () { sp.classList.remove("spalte-ziel"); });
            sp.addEventListener("drop", function (ev) {
              if (!gezogen) return;
              ev.preventDefault();
              sp.classList.remove("spalte-ziel");
              var karte = gezogen, ziel = sp.dataset.wichtigkeit;
              var leer = sp.querySelector(".td-spalte-leer");
              if (leer) leer.remove();
              sp.appendChild(karte);
              fetch("/todos/wichtigkeit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: karte.dataset.id, wichtigkeit: ziel }),
              }).then(function (r) { return r.json(); })
                .then(function (d) { if (!d.ok) location.reload(); })
                // Wenn das Speichern scheitert, wird neu geladen: dann steht die
                // Karte wieder da, wo sie wirklich ist. Eine Karte an einer
                // Stelle liegen zu lassen, an der sie nicht gespeichert ist,
                // wäre die schlechteste aller Antworten.
                .catch(function () { location.reload(); });
            });
          });
        })();
        </script>`,
      }));
    } catch (err) { next(err); }
  });

  // Schreiben. Alles landet in derselben Tabelle wie /crm/todos — hier stehen
  // nur eigene Routen, damit der Redirect wieder auf /todos zeigt und nicht ins
  // CRM springt (dessen todoZiel() laesst nur /crm-Adressen zu).
  app.post("/todos/anlegen", angemeldet, formular, async (req, res, next) => {
    try {
      if (String(req.body.titel || "").trim()) await crm.todoAnlegen(req.nutzer, req.body);
      res.redirect("/todos");
    } catch (err) { next(err); }
  });
  app.post("/todos/planen", angemeldet, formular, async (req, res, next) => {
    try { await crm.todoPlanen(req.nutzer, req.body.id, req.body.geplant_am || null); res.redirect("/todos"); }
    catch (err) { next(err); }
  });
  app.post("/todos/erledigt", angemeldet, formular, async (req, res, next) => {
    try { await crm.todoErledigt(req.nutzer, req.body.id, req.body.erledigt === "1"); res.redirect("/todos"); }
    catch (err) { next(err); }
  });
  app.post("/todos/loeschen", angemeldet, formular, async (req, res, next) => {
    try { await crm.todoLoeschen(req.nutzer, req.body.id); res.redirect("/todos"); }
    catch (err) { next(err); }
  });

  // Neue Spalte nach dem Ziehen. Antwortet JSON statt einem Redirect — die
  // Karte liegt schon an ihrem neuen Platz, die Seite soll nicht springen.
  // Bei ok:false laedt die Seite neu und zeigt den echten Stand.
  app.post("/todos/wichtigkeit", async (req, res) => {
    const u = req.session && req.session.crm;
    if (!u) return res.status(401).json({ ok: false, grund: "anmeldung" });
    try {
      const r = await crm.todoEinstufen(u, req.body.id, { wichtigkeit: req.body.wichtigkeit });
      res.json(r);
    } catch (e) {
      console.error("To-Do einstufen:", e.message);
      res.json({ ok: false, grund: "fehler" });
    }
  });
};
