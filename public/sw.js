/* =====================================================================
   Service Worker — nur fuer die App-HUELLE (P5.1, PWA auf dem iPhone).

   WARUM ueberhaupt ein Service Worker?
   Ohne ihn darf iOS die Seite nicht als eigenstaendige App vom Homescreen
   starten (kein Splash, kein eigenes Fenster). Er ist hier also in erster
   Linie die Eintrittskarte zur Installation — NICHT ein Offline-Modus.
   Alexandra kann ohne Server ohnehin nichts: Verstehen, Antworten und Stimme
   entstehen serverseitig. "Offline" waere eine Luege.

   ────────────────────────────────────────────────────────────────────
   DIE EISERNE REGEL: /api/ WIRD NIEMALS GECACHED.
   ────────────────────────────────────────────────────────────────────
   Alle Daten der Sprachseite laufen ueber /api/sprache/... (Status, Kalender,
   Zahlen, Auftraege, Stimme). Wuerde hier auch nur eine Antwort im Cache
   landen, liest Alexandra beim naechsten Start ALTE Termine vor — sie klingt
   dabei vollkommen ueberzeugt, und niemand merkt, dass die Uhrzeit von
   gestern stammt. Ein Netzwerkfehler ist harmlos (man hoert "geht nicht"),
   eine falsche Uhrzeit ist es nicht. Deshalb: /api/ geht immer und
   ausschliesslich ans Netz, ohne Cache-Rueckfall.

   Dasselbe gilt fuer HTML-Seiten: die Huelle (lib/schale.js) rendert Name,
   Rolle, Termin-Badge und Benachrichtigungen serverseitig pro Sitzung. Eine
   gecachte Seite wuerde einen abgemeldeten oder fremden Zustand zeigen.

   Gecached wird also nur, was fuer alle gleich und statisch ist:
   CSS, JS, Icons, Bilder, Schriften, manifest.json.

   ZUSAMMENSPIEL MIT DEM CACHE-STEMPEL aus lib/schale.js (Funktion v()):
   Dateien kommen als "/crm.css?v=abc123" herein — der Stempel ist Teil der
   URL. Deshalb ist "erst Cache, dann Netz" hier gefahrlos: nach einem Deploy
   aendert sich der Stempel, die URL ist neu, im Cache liegt nichts dazu und
   die Datei wird frisch geholt. Genau darum wird beim Abgleich die
   Query-Zeichenkette NICHT ignoriert (kein ignoreSearch) — sonst wuerde der
   Stempel wirkungslos und der alte Fehler lebte weiter.
   ===================================================================== */

// Version im Namen: ein neuer Name = ein frischer Cache. Beim Aufraeumen
// (activate) fliegt alles Aeltere raus. Bei Aenderungen an dieser Datei
// hochzaehlen.
const CACHE = "flowstate-huelle-v1";

// Grundstock, der schon bei der Installation im Cache liegen soll. Bewusst
// KURZ: nur Dateien, die ohne Stempel angefragt werden. Die gestempelten
// CSS/JS-Dateien landen beim ersten echten Aufruf von selbst im Cache
// (siehe unten) — sie hier vorzuladen waere sinnlos, weil der Stempel zur
// Installationszeit nicht bekannt ist.
const GRUNDSTOCK = [
  "/manifest.json",
  "/bilder/pwa-icon-192.png",
  "/bilder/pwa-icon-512.png",
];

// Endungen, die als "Huelle" gelten und gecached werden duerfen.
const HUELLE_RE = /\.(?:css|js|mjs|png|jpe?g|svg|webp|avif|gif|ico|woff2?|ttf|otf|webmanifest)$/i;

// ---------------------------------------------------------------- Installation

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      // Absichtlich EINZELN statt cache.addAll(): addAll bricht komplett ab,
      // wenn nur eine Datei fehlt (z.B. ein Icon noch nicht deployed) — dann
      // waere der ganze Service Worker nicht installierbar. So ueberlebt die
      // Installation jeden Einzelausfall.
      await Promise.allSettled(GRUNDSTOCK.map((pfad) => cache.add(pfad)));
    } catch {
      // Selbst ohne Cache soll installiert werden: der Worker faellt dann
      // einfach immer aufs Netz zurueck (siehe fetch).
    }
    // Sofort uebernehmen. Ein wartender alter Worker wuerde weiter alte
    // Dateien ausliefern — genau die Falle, die der Stempel in schale.js
    // verhindern soll.
    await self.skipWaiting();
  })());
});

// ---------------------------------------------------------------- Aktivierung

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    try {
      const namen = await caches.keys();
      await Promise.all(namen.filter((n) => n.startsWith("flowstate-huelle-") && n !== CACHE)
        .map((n) => caches.delete(n)));
    } catch { /* Aufraeumen ist Kosmetik, kein Grund zu scheitern */ }
    try { await self.clients.claim(); } catch {}
  })());
});

// ---------------------------------------------------------------- Auslieferung

self.addEventListener("fetch", (ev) => {
  const anfrage = ev.request;

  // Nur GET. POST/PUT (z.B. /api/sprache/stimme) gehen den Worker nichts an.
  if (anfrage.method !== "GET") return;

  let url;
  try { url = new URL(anfrage.url); } catch { return; }

  // Nur eigene Herkunft. Fremde Hosts (ElevenLabs & Co.) bleiben unberuehrt.
  if (url.origin !== self.location.origin) return;

  // ── HARTE SPERRE: Live-Daten ───────────────────────────────────────────
  // /api/ nie anfassen. Kein Cache-Schreiben, kein Cache-Lesen, auch nicht
  // als Notnagel bei Netzausfall — lieber ein sichtbarer Fehler als ein
  // vorgelesener Termin von gestern.
  if (url.pathname.startsWith("/api/")) return;

  // ── HTML-Seiten: immer frisch vom Server ───────────────────────────────
  // Sitzungsabhaengig gerendert (Nutzername, Rolle, Termin-Badge). Ein
  // gecachtes Dokument zeigt fremde oder abgemeldete Zustaende.
  const willHtml = anfrage.mode === "navigate"
    || (anfrage.headers.get("accept") || "").includes("text/html");
  if (willHtml) return;

  // Alles Uebrige nur cachen, wenn es wirklich eine Huellen-Datei ist.
  if (!HUELLE_RE.test(url.pathname)) return;

  ev.respondWith(huelleLiefern(anfrage));
});

async function huelleLiefern(anfrage) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch { cache = null; }

  // 1. Treffer im Cache? Exakt inklusive ?v=-Stempel abgleichen (siehe Kopf).
  if (cache) {
    try {
      const treffer = await cache.match(anfrage);
      if (treffer) return treffer;
    } catch { /* Cache kaputt/gesperrt -> weiter zum Netz */ }
  }

  // 2. Netz. Faellt der Cache komplett aus, ist das hier der normale Weg —
  //    die Seite funktioniert dann wie ohne Service Worker.
  let antwort;
  try {
    antwort = await fetch(anfrage);
  } catch (fehler) {
    // 3. Netz weg: letzter Versuch, irgendeine aeltere Fassung derselben
    //    Datei zu finden (anderer Stempel, gleicher Pfad). Nur fuer Layout
    //    und Skript — bei Daten waere das verboten, hier ist es der
    //    Unterschied zwischen "sieht alt aus" und "weisse Seite".
    const ersatz = cache ? await aeltereFassung(cache, anfrage) : null;
    if (ersatz) return ersatz;
    throw fehler;
  }

  // Nur brauchbare, eigene Antworten aufbewahren: keine 404er, keine
  // Weiterleitungen, keine opaken Cross-Origin-Antworten.
  if (cache && antwort && antwort.ok && antwort.type === "basic") {
    try {
      await cache.put(anfrage, antwort.clone());
      // Alte Stempel derselben Datei wegwerfen. Ohne das waechst der Cache
      // mit jedem Deploy — und iOS gibt einer PWA nur rund 50 MB, danach
      // raeumt das System selbst auf, meist zum unpassendsten Zeitpunkt.
      await alteStempelWegwerfen(cache, anfrage);
    } catch { /* Speichern darf nie die Auslieferung kippen */ }
  }

  return antwort;
}

// Sucht einen Cache-Eintrag mit demselben Pfad, aber anderem ?v=-Stempel.
async function aeltereFassung(cache, anfrage) {
  try {
    const pfad = new URL(anfrage.url).pathname;
    for (const eintrag of await cache.keys()) {
      if (new URL(eintrag.url).pathname === pfad) {
        const treffer = await cache.match(eintrag);
        if (treffer) return treffer;
      }
    }
  } catch { /* egal */ }
  return null;
}

// Behaelt nur den gerade geholten Stempel je Datei.
async function alteStempelWegwerfen(cache, aktuell) {
  try {
    const pfad = new URL(aktuell.url).pathname;
    for (const eintrag of await cache.keys()) {
      if (eintrag.url === aktuell.url) continue;
      if (new URL(eintrag.url).pathname === pfad) await cache.delete(eintrag);
    }
  } catch { /* egal */ }
}
