// Alexandras Ohr — laeuft auf JEDER Seite des OS.
//
// Auf /sprache uebernimmt es die grosse Kugel und zeigt Karten. Ueberall sonst
// blendet es eine kleine Kugel unten rechts ein. Das Wake-Word gilt in beiden
// Faellen, damit "Hey Alexandra" auch aus dem CRM heraus funktioniert.
//
// GESPRAECHSMODELL (Wunsch Lukas 22.07.): Ein Gespraech laeuft am Stueck. Man
// sagt EINMAL "Hey Alexandra", danach bleibt das Mikro nach jeder Antwort offen
// — auf eine Rueckfrage antwortet man einfach, ohne erneut zu wecken. Das
// Gespraech endet erst, wenn man nichts mehr sagt (Stille) oder wenn Alexandra
// einen langen Auftrag abgeschickt hat und im Hintergrund arbeitet. Begruesst
// wird nur beim ERSTEN Mal voll ("Grosser Herrscher..."), danach nur kurz und
// rotierend, damit es nicht nervt.
//
// Der WAECHTER (setInterval) sorgt dafuer, dass das Wake-Word laeuft, wann immer
// wir in Ruhe sind — egal wie ein Gespraech geendet ist, der Lauscher kommt von
// selbst zurueck.

(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const WAKE_SPEICHER = "flowstate-wake";

  let konfig = { elevenlabs: false, hermes: false, wakeWord: "alexandra", begruessung: "" };
  let zustand = "ruhe";
  const AGENT_IM_HTML =
    (document.getElementById("kugel-wort")?.textContent || "Alexandra").trim();
  // Standardmaessig AN: "Hey Alexandra" soll ohne Vorbereitung funktionieren,
  // auf jeder Seite. Nur wer es ausdruecklich abschaltet, bekommt Ruhe —
  // deshalb Vergleich auf "aus" statt auf "an".
  let wakeAn = localStorage.getItem(WAKE_SPEICHER) !== "aus";
  let erkennung = null, wakeErkennung = null, wakeLaeuft = false;
  let audio = null, audioCtx = null, analyser = null, mikroStrom = null;
  let playbackAnalyser = null;    // analysiert ALEXANDRAS Stimme (fuer die Kugel beim Sprechen)
  let pegelLaeuft = false;
  let begruessungUrl = null;      // einmal erzeugt, danach wiederverwendet
  let letzteFrageAt = 0;

  // ------------------------------------------------------- Drehbuch (Dreh)
  //
  // Fuer die Werbeaufnahmen. Alles laeuft wie immer — Klatschen weckt, das
  // Mikro hoert zu, die Stille beendet den Zug, das Gehirn wechselt seine
  // Zustaende. NUR die Antwort kommt nicht vom Modell, sondern als fertige
  // Tonspur aus einer Liste.
  //
  // WARUM UEBERHAUPT: In einer Anzeige darf keine Formulierung ueberraschen
  // und keine Wartezeit entstehen. Das Modell braucht je nach Frage zwei bis
  // zwoelf Sekunden und formuliert jedes Mal anders — beides ist in einer
  // 55-Sekunden-Aufnahme toedlich.
  //
  // WARUM NICHT EINFACH ABSPIELEN: Weil dann das Gehirn stillstuende. Der Weg
  // durch sagen() setzt "spricht", haengt den Playback-Analyser an und laesst
  // die Kugel zur Stimme atmen. Man sieht der Aufnahme an, dass da wirklich
  // jemand redet.
  //
  // OHNE ?drehbuch=… IST NICHTS DAVON AKTIV. Im Betrieb aendert sich nichts.
  // Die Wahl bleibt haengen, solange der Tab offen ist.
  //
  // WARUM (20.08.2026): Beim ersten Drehversuch war die Frage im Link weg —
  // einmal ueber die Navigation auf /sprache geklickt und der Drehbuch-Modus
  // war aus, ohne dass man es der Seite ansieht. Am Set merkt man das erst an
  // der falschen Antwort. "?drehbuch=aus" schaltet wieder zurueck.
  // Wie viele Zeichen eine Antwort mindestens haben muss, damit sie als
  // Antwort zaehlt. Janniks kuerzeste Zeile ist "Ja, schick's ab." (16).
  const DREH_MIN_ZEICHEN = 12;
  const DREH_SPEICHER = "flowstate-drehbuch";

  // ZWEI SCHREIBWEISEN, weil die eine zu Verwechslungen fuehrt.
  //
  // "drehbuch" zaehlt ab null: drehbuch=1 ist Creative ZWEI. Das ist intern
  // richtig und im Gespraech eine Falle — wer "Creative 3" drehen will, tippt
  // eine 3 und landet bei Creative 4.
  //
  // "creative" zaehlt so, wie alle reden: creative=3 ist Creative 3. Das ist
  // die Schreibweise fuer die Zettel am Set; "drehbuch" bleibt fuer alles,
  // was schon darauf zeigt.
  const suche = new URLSearchParams(location.search);
  const creativeFrage = suche.get("creative");
  const drehFrage = creativeFrage !== null
    ? (creativeFrage === "aus" ? "aus" : String(Math.max(0, (Number(creativeFrage) || 1) - 1)))
    : suche.get("drehbuch");
  if (drehFrage === "aus") sessionStorage.removeItem(DREH_SPEICHER);
  else if (drehFrage !== null) sessionStorage.setItem(DREH_SPEICHER, drehFrage);
  // Rangfolge: Link schlaegt SERVER schlaegt Tab-Gedaechtnis (21.08.2026).
  //
  // Vorher stand das Gedaechtnis vor dem Server, und genau daran ist der Dreh
  // auf dem zweiten Laptop gescheitert: Auf dem Server stand C2, im Tab lag
  // noch eine 0 von einem frueheren Aufruf — und die Seite zeigte "C1 —
  // Sales-Zahlen und Leads". Am Bildschirm sah alles richtig aus, nur eben
  // das falsche Skript. Wer das Creative auf dem Server umstellt, erwartet,
  // dass alle dasselbe sehen; ein alter Wert in irgendeinem Tab darf das
  // nicht ueberstimmen.
  //
  // Das Gedaechtnis bleibt fuer den Fall, dass der Server GAR NICHTS vorgibt
  // — dann ueberlebt ein ?drehbuch=… weiterhin einen neuen Tab.
  let DREHBUCH_NR = drehFrage === "aus" ? null
    : (drehFrage !== null ? drehFrage : sessionStorage.getItem(DREH_SPEICHER));
  // Merken, WOHER der Wert kommt: Nur ein Wert aus dem Gedaechtnis darf spaeter
  // von der Servervorgabe ueberschrieben werden. Ein Link bleibt ein Link.
  const nrAusGedaechtnis = drehFrage === null && DREHBUCH_NR !== null;
  let drehAus = drehFrage === "aus";
  let drehbuch = null;      // { titel, zuege: [{id, text, audio, oeffnen}] }
  let drehZug = 0;
  // Wie viele Belege gebucht waren, als das Drehbuch losging. Creative 3
  // vergleicht dagegen, um zu merken, dass der fotografierte Bon durch ist.
  let drehBelegBasis = null;
  // DIE INHALTE LIEGEN IN DER DREHMAPPE, NICHT HIER.
  //
  // WARUM (20.08.2026): window.open landet in dem Fenster, aus dem es
  // aufgerufen wird. Von hier kamen die Tabs auf dem Laptop an, wo das Gehirn
  // steht — und jeder neue Tab nahm dem Gehirn die Sicht. Sobald es nicht
  // sichtbar ist, drosselt Chrome seine Zeitgeber auf einmal pro Minute; die
  // Stille-Erkennung stand still, und es ging nicht mehr weiter.
  //
  // Jetzt geht beim ersten Klick EIN Tab auf: die Drehmappe. Die wird auf den
  // zweiten Bildschirm gezogen und laedt dort alle Inhalte vor. Im Take wird
  // nur noch der passende Tab nach vorn geholt — mappe.open() oeffnet in der
  // Mappe, nicht hier.
  let mappe = null;
  let mappeGeladen = false;

  function tabName(datei) {
    const basis = String(datei).split("?")[0].split("#")[0];
    return "dreh-" + basis.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  }

  // Ist die Drehmappe da und offen?
  const mappeOffen = () => Boolean(mappe && !mappe.closed);

  // Die Drehmappe aufmachen. Gibt zurueck, ob sie jetzt steht.
  //
  // MUSS AUS EINER NUTZERGESTE HERAUS AUFGERUFEN WERDEN — Klick oder
  // Tastendruck. Ohne Geste blockt jeder Browser das Fenster.
  function mappeOeffnen() {
    if (mappeOffen()) { try { mappe.focus(); } catch {} return true; }
    try {
      mappe = window.open("/regie/mappe?c=" + encodeURIComponent(DREHBUCH_NR || 0), "drehmappe");
    } catch (e) { console.error("Drehmappe:", e.message); mappe = null; }
    if (!mappeOffen()) {
      console.warn("Drehmappe blockiert — Pop-ups für diese Seite erlauben.");
      if (el.hinweis) el.hinweis.textContent =
        "Drehmappe blockiert — im Schloss-Symbol der Adresszeile Pop-ups erlauben, dann hier klicken.";
      knopfZeigen();
      return false;
    }
    knopfWeg();
    return true;
  }

  // Ein sichtbarer Knopf, wenn die Mappe nicht aufgeht.
  //
  // WARUM (21.08.2026): Bisher hing das Aufgehen an einem unsichtbaren
  // Zuhoerer auf dem ersten Klick irgendwo auf der Seite — und der entfernte
  // sich SOFORT wieder, auch wenn der Browser das Fenster gerade geblockt
  // hatte. Ein blockierter Versuch, und fuer den Rest des Takes ging kein
  // einziges Dokument mehr auf. Wer geklatscht statt geklickt hat, hatte nie
  // eine Geste und damit nie eine Mappe.
  //
  // Am Set ist beides nicht zu erkennen: Erik redet weiter, die Bildschirme
  // bleiben leer. Darum jetzt ein Knopf, den man sieht, der beliebig oft
  // gedrueckt werden darf und erst verschwindet, wenn die Mappe wirklich steht.
  // Was der Blocker geschluckt hat. Ein Klick auf den Knopf holt es nach:
  // Ein Klick IST eine Nutzergeste, und die laesst jeder Browser durch, auch
  // ohne dauerhafte Erlaubnis. Chrome oeffnet allerdings nur EIN Fenster je
  // Geste — darum steht die Anzahl auf dem Knopf, und man drueckt so oft, wie
  // noch offen ist.
  const nachzuholen = [];
  let knopf = null;
  function knopfBeschriften() {
    if (!knopf) return;
    knopf.textContent = nachzuholen.length
      ? "Dokument öffnen (" + nachzuholen.length + " offen)"
      : "Drehmappe öffnen";
  }
  function knopfZeigen() {
    if (knopf) { knopfBeschriften(); return; }
    knopf = document.createElement("button");
    knopf.type = "button";
    knopf.textContent = "Drehmappe öffnen";
    knopf.setAttribute("style",
      "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;"
      + "padding:12px 22px;border-radius:999px;border:none;cursor:pointer;"
      + "background:#111;color:#fff;font:600 15px/1 -apple-system,'Segoe UI',sans-serif;"
      + "box-shadow:0 6px 24px rgba(0,0,0,.28)");
    knopf.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!mappeOeffnen()) return;              // erst die Mappe, dann Inhalte
      const naechstes = nachzuholen.shift();
      if (naechstes) {
        try { mappe.open(naechstes.url, naechstes.name); }
        catch (err) { console.error("Nachholen:", err.message); }
      }
      if (nachzuholen.length) knopfBeschriften(); else knopfWeg();
    });
    document.body.appendChild(knopf);
    knopfBeschriften();
  }
  function knopfWeg() {
    if (!knopf) return;
    knopf.remove();
    knopf = null;
  }

  function mappeVorbereiten() {
    // Der Zuhoerer bleibt, bis die Mappe wirklich steht. Vorher wurde er beim
    // ERSTEN Klick entfernt — auch wenn dabei nichts aufgegangen ist.
    const beiKlick = () => {
      if (mappeOeffnen()) document.removeEventListener("click", beiKlick);
    };
    document.addEventListener("click", beiKlick);
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin) return;
      const d = e.data || {};
      if (d.typ === "mappe-geladen") {
        mappeGeladen = true;
        console.log("Drehbuch: " + d.offen + " Inhalte in der Drehmappe vorgeladen");
        if (el.hinweis) el.hinweis.textContent = "Drehmappe bereit — " + d.offen + " Inhalte geladen.";
      }
    });
  }

  function mappeZeigen(dateien) {
    const liste = Array.isArray(dateien) ? dateien : (dateien ? [dateien] : []);
    liste.forEach((datei) => {
      let url;
      if (/^https?:\/\//.test(datei)) {
        url = datei;
      } else if (datei.startsWith("/")) {
        // Eigene Seiten zwingend mit drehbuch=aus: Jede Seite des OS laedt die
        // Sprachsteuerung mit und wuerde sonst die Fuehrung uebernehmen.
        url = datei + (datei.includes("?") ? "&" : "?") + "drehbuch=aus";
      } else {
        url = "/regie/datei/" + encodeURIComponent(datei);
      }

      if (!mappeOffen()) {
        // Noch einen Versuch, statt nur zu klagen: Manchmal steht die Mappe
        // einfach noch nicht, weil bis hierher niemand geklickt hat (geklatscht
        // ist keine Geste). Klappt es nicht, kommt der sichtbare Knopf — und
        // der Rest des Takes laeuft weiter, statt an dieser Stelle blind zu
        // werden.
        console.warn("Drehmappe fehlt:", url);
        if (!mappeOeffnen()) { knopfZeigen(); return; }
      }
      try {
        // Oeffnet IN der Mappe. Ist der Tab dort schon geladen (vorgeladen),
        // wird er nur nach vorn geholt — ohne Wartezeit.
        const tab = mappe.open(url, tabName(datei));

        // NULL HEISST: DER POP-UP-BLOCKER HAT ES GESCHLUCKT (21.08.2026).
        //
        // Dieser Aufruf kommt aus dem Ablauf des Drehbuchs, nicht aus einem
        // Klick. Ohne Nutzergeste laesst Chrome ihn nur durch, wenn Pop-ups
        // fuer DIESE Adresse erlaubt sind — und diese Erlaubnis haengt am
        // Hostnamen. Nach dem Umzug auf dreh.…hstgr.cloud war sie weg.
        //
        // Am Set sah das so aus: Erik redet weiter, Telegram und WhatsApp
        // kommen an, aber kein Dokument geht auf, und nichts sagt warum.
        //
        // Gemessen am 21.08. im selben Browser, einmal mit und einmal ohne
        // Erlaubnis: Die Drehmappe geht BEIDE Male auf (sie haengt an einem
        // Klick), die Dokumente nur mit Erlaubnis. Der Unterschied ist also
        // genau diese Einstellung — und sie haengt am Hostnamen.
        //
        // Ein geblocktes window.open gibt null zurueck. Darauf verlassen wir
        // uns nicht allein: Der Knopf unten ist der sichtbare Teil, und er
        // erscheint auch schon, bevor der erste Zug laeuft.
        if (!tab) {
          console.warn("Pop-up-Blocker: Tab wurde nicht geoeffnet —", url);
          if (el.hinweis) el.hinweis.textContent =
            "Pop-ups sind für diese Seite blockiert — im Schloss-Symbol der "
            + "Adresszeile erlauben, sonst geht kein Dokument auf.";
          nachzuholen.push({ url, name: tabName(datei) });
          knopfZeigen();
        }
      } catch (e) { console.error("Tab nicht erreichbar:", e.message); }
    });
  }

  // Nach dem Eintragen im Kalender muss der schon offene Tab den neuen Termin
  // zeigen. Frisches Anhaengsel = neu laden. Seit der Kalender direkt bei
  // Google liest (0,4 s statt 9 s) faellt das im Bild nicht mehr auf.
  function mappeNeuLaden(datei) {
    if (!mappe || mappe.closed) return;
    const basis = datei + (datei.includes("?") ? "&" : "?") + "drehbuch=aus&_=" + Date.now();
    try { mappe.open(basis, tabName(datei)); } catch { /* Fenster weg */ }
  }

  // NUR EIN TAB DARF DAS DREHBUCH FUEHREN.
  //
  // Im Protokoll standen doppelte Aufnahmen zur selben Sekunde: zwei Seiten
  // hoerten gleichzeitig zu, beide schalteten weiter, und pro Antwort liefen
  // ZWEI Zuege. Auf dem Bildschirm sieht das aus, als haette der Agent einen
  // Schritt uebersprungen.
  //
  // Der zuletzt geoeffnete Tab gewinnt: Wer gerade eine Seite aufmacht, will
  // mit dieser arbeiten.
  // Hat ein anderer Tab die Fuehrung uebernommen? Stand bis eben neben einer
  // Variablen, die bei einem Umbau wegfiel — und ohne Deklaration bricht das
  // ganze Skript beim ersten Zugriff ab. Jetzt bei den anderen Drehbuch-Werten.
  let drehPassiv = false;
  let drehKanal = null;

  function drehPassivSchalten() {
    if (drehPassiv) return;
    drehPassiv = true;
    drehbuch = null;
    try { klatschWacheStoppen(); } catch {}
    try { erkennung?.abort?.(); } catch {}
    imGespraech = false;
    setzeZustand("ruhe");
    if (el.hinweis) {
      el.hinweis.textContent = "Ein anderer Tab führt das Drehbuch — diese Seite hält still.";
    }
    console.warn("Drehbuch: anderer Tab hat uebernommen, diese Seite ist passiv.");
  }

  function drehFuehrungUebernehmen() {
    try {
      drehKanal = new BroadcastChannel("flowstate-drehbuch");
      drehKanal.onmessage = (e) => { if (e.data === "uebernehme") drehPassivSchalten(); };
      drehKanal.postMessage("uebernehme");
    } catch { /* alter Browser ohne BroadcastChannel — dann eben ohne Riegel */ }
  }

  async function drehbuchLaden() {
    if (DREHBUCH_NR === null) return;
    try {
      const r = await fetch("/regie/drehbuch.json?c=" + encodeURIComponent(DREHBUCH_NR));
      if (!r.ok) throw new Error("HTTP " + r.status);
      drehbuch = await r.json();
      drehZug = 0;
      mappeVorbereiten();          // beim ersten Klick geht die Drehmappe auf
      drehFuehrungUebernehmen();
      if (el.hinweis) el.hinweis.textContent =
        "Drehbuch: " + drehbuch.titel + " · " + drehbuch.zuege.length + " Züge";
      console.log("Drehbuch geladen:", drehbuch.titel, drehbuch.zuege.length + " Züge");
      // Den Knopf gleich zeigen, nicht erst wenn das erste Dokument fehlt.
      // Wer klatscht statt zu klicken, hat nie eine Nutzergeste — und ohne die
      // laesst kein Browser ein Fenster aufgehen. Am Set soll man das VOR dem
      // Take sehen und nicht mittendrin merken.
      if (!mappeOffen()) knopfZeigen();
    } catch (e) {
      console.error("Drehbuch nicht geladen:", e.message);
      if (el.hinweis) el.hinweis.textContent = "Drehbuch fehlt: " + e.message;
    }
  }

  // NUR IM DREH: ein Griff von aussen, um eine Zeile von Jannik zu setzen.
  //
  // WOZU: Ein Drehbuch laesst sich sonst nicht pruefen, ohne dass jemand ins
  // Mikrofon spricht. Im Testbrowser gibt es kein Mikrofon, und mit einem
  // erfundenen Tonsignal erkennt Chrome nichts — die Kette bleibt nach dem
  // ersten Zug stehen und man weiss danach nichts ueber die restlichen vier.
  //
  // Der Griff geht bewusst auf verarbeiten() und nicht auf drehbuchZug(): So
  // laeuft auch die Mindestlaenge mit, an der beim ersten Take von Creative 2
  // das halbe Skript durchgerauscht ist (das Mikro hatte den Lautsprecher
  // gehoert). Ein Test, der diese Pruefung umgeht, prueft das Falsche.
  //
  // Der Griff wird IMMER gelegt und entscheidet erst beim Aufruf, ob er etwas
  // tut. Er hing zuerst an "if (DREHBUCH_NR !== null)" — und genau dann fehlte
  // er, wenn man ihn am meisten braucht: Steht keine Nummer im Link, kommt sie
  // erst mit der Serverantwort, also LANGE nach dieser Zeile. Beim Aufruf von
  // /sprache ohne Parameter war window.__drehSagen darum nie da, und der Test
  // von Creative 2 brach nach dem ersten Zug ab.
  window.__drehSagen = (t) => {
    if (DREHBUCH_NR === null) {
      console.warn("Kein Drehbuch aktiv — __drehSagen tut nichts.");
      return;
    }
    return verarbeiten(String(t || ""));
  };

  // Auf den Beleg warten, den Lukas gerade mit dem Handy fotografiert.
  //
  // Der Stand wird beim Start des Drehbuchs gemerkt (drehBelegBasis). Sobald
  // die Buchhaltung einen gebuchten Beleg mehr zaehlt als damals, ist der Bon
  // durch. Zwei Minuten Geduld — laenger dauert kein Take, und danach lieber
  // weiterreden als stehenbleiben: Ein Video mit einer falschen Zahl im Bild
  // laesst sich schneiden, ein Take, der nie weitergeht, nicht.
  const DREH_BELEG_FRIST = 120000;
  async function belegStand() {
    try {
      const r = await fetch("/regie/belegstand", { cache: "no-store" });
      const d = await r.json();
      return typeof d.gebucht === "number" ? d.gebucht : null;
    } catch { return null; }
  }
  async function aufBelegWarten() {
    if (drehBelegBasis === null) drehBelegBasis = await belegStand();
    if (drehBelegBasis === null) return false;   // ohne Ausgangswert kein Vergleich
    const bis = Date.now() + DREH_BELEG_FRIST;
    console.log("Drehbuch: warte auf den Beleg — Stand", drehBelegBasis);
    while (Date.now() < bis) {
      // Den Hinweis bei JEDEM Durchgang neu setzen, nicht nur einmal davor.
      // Die Spracherkennung schreibt zwischendurch ihre eigenen Meldungen
      // dorthin ("… (zu kurz, ich warte weiter)"), und dann steht am Set
      // nichts mehr davon, dass hier auf etwas gewartet wird — es sieht aus,
      // als haenge die Aufnahme.
      if (el.hinweis) {
        const rest = Math.ceil((bis - Date.now()) / 1000);
        el.hinweis.textContent = "Warte auf den Beleg aus Telegram … (" + rest + " s)";
      }
      const jetzt = await belegStand();
      if (jetzt !== null && jetzt > drehBelegBasis) {
        drehBelegBasis = jetzt;
        console.log("Drehbuch: Beleg ist da —", jetzt, "gebuchte Belege.");
        return true;
      }
      await new Promise((f) => setTimeout(f, 1500));
    }
    return false;
  }

  // Der naechste Zug. Wird nach dem Klatschen einmal aufgerufen und danach
  // jedes Mal, wenn Jannik zu Ende geredet hat.
  async function drehbuchZug() {
    if (drehPassiv) {
      console.warn("Drehbuch: dieser Tab ist passiv, ein anderer fuehrt.");
      if (el.hinweis) el.hinweis.textContent =
        "Dieser Tab ist passiv — ein anderer Tab hat die Sprachseite offen.";
      return;
    }
    if (!drehbuch) {
      console.warn("Drehbuch: nicht geladen.");
      if (el.hinweis) el.hinweis.textContent = "Drehbuch nicht geladen — Seite neu laden.";
      return;
    }
    const z = drehbuch.zuege[drehZug];
    if (!z) {
      zeile("sie", "— Drehbuch zu Ende —");
      return gespraechBeenden();
    }
    drehZug++;
    // Erst warten, wenn dieser Zug auf etwas draussen wartet.
    //
    // In Creative 3 fotografiert Lukas den Bon vom Team-Essen mit dem Handy und
    // schickt ihn in den Telegram-Chat. Das dauert eine halbe Minute: Foto,
    // Rueckfrage vom Bot, "ja". Erst danach darf C3_04 "Beleg ist erfasst"
    // sagen — davor waere es eine Behauptung, und im Bild stuende noch die alte
    // Zahl.
    if (z.wartenAuf === "beleg" && !(await aufBelegWarten())) {
      console.warn("Drehbuch: kein Beleg angekommen — Zug laeuft trotzdem weiter.");
    }
    // Das Dokument geht auf, BEVOR die Stimme laeuft: Im Video soll der
    // Bildschirm schon leuchten, waehrend der Satz dazu gesprochen wird.
    // Erst die Handlung, dann das Fenster. Beim Kalender ist die Reihenfolge
    // entscheidend: Wer die Seite laedt, bevor der Termin steht, sieht ihn
    // nicht — und ein zweites Neuladen gibt es im Take nicht.
    if (z.tat) {
      const lauf = fetch("/regie/tat/" + encodeURIComponent(z.tat), { method: "POST" })
        .then((r) => r.json()).then((d) => console.log("Drehbuch-Tat:", z.tat, d))
        .catch((e) => console.error("Drehbuch-Tat fehlgeschlagen:", e.message));
      if (z.tatWarten) await lauf;
    }
    if (z.oeffnen && z.oeffnen.length) {
      // Nach einer Tat hat sich der Inhalt geaendert (C2_07: der Termin ist
      // neu). Dann neu laden statt nur nach vorn holen.
      if (z.tat && z.tatWarten) z.oeffnen.forEach((d) => {
        if (String(d).startsWith("/")) mappeNeuLaden(d); else mappeZeigen([d]);
      });
      else mappeZeigen(z.oeffnen);
    }
    zeile("sie", z.text || "");
    if (el.hinweis) {
      el.hinweis.textContent = "Zug " + drehZug + " von " + drehbuch.zuege.length
        + " · " + (z.id || "");
    }
    if (z.audio) {
      await sagen("/regie/datei/" + encodeURIComponent(z.audio), true, z.text);
      // Kam kein Ton, wird die Zeile GESPROCHEN statt verschluckt. Lieber eine
      // andere Stimme als Stille vor der Kamera — und im Protokoll steht dann
      // ein "stimme"-Eintrag, an dem man es hinterher sieht.
      if (!ausgabeOk && z.text) {
        console.warn("Tonspur fehlgeschlagen, spreche den Text:", z.id);
        if (el.hinweis) el.hinweis.textContent = "Tonspur klemmt (" + z.id + ") — spreche live.";
        await sprich(z.text);
      }
    } else if (z.text) await sprich(z.text);
    // Steht der naechste Zug direkt dahinter (keine Zeile von Jannik dazwischen),
    // gleich weiterreden statt auf eine Antwort zu warten, die es nicht gibt.
    const naechster = drehbuch && drehbuch.zuege[drehZug];
    if (naechster && naechster.sofort) return drehbuchZug();
    weiter();
  }
  let imGespraech = false;        // laeuft gerade ein zusammenhaengendes Gespraech?
  let redetGerade = false;        // genau EIN Sprech-Kanal, nie ueberlappend
  let bargeSR = null;             // lauscht WAEHREND des Sprechens auf Unterbrechung
  let bargeStartZeit = 0;         // Gnadenfrist am Redeanfang gegen Selbstabbruch
  let redeText = "";              // was Alexandra gerade sagt (Echo-Abgleich)
  let aktuellerStop = null;       // stoppt die laufende Sprachausgabe sofort
  let gespraechsId = 0;           // Runden-Token: eine unterbrochene Antwort bricht ab
  let stilleTimer = null;         // wartet nach dem Reden auf echte Stille
  let letzteAktivitaet = 0;       // wann zuletzt gesprochen/geantwortet wurde
  let lausche = false;            // laeuft gerade eine Zuhoer-Erkennung? (verhindert Doppelstart)
  // (offeneArbeit ist mit A2 entfallen: Der Browser verfolgt keine langen
  //  Auftraege mehr, also gibt es nichts mehr offenzuhalten.)
  let pausiert = false;           // Mikro auf Pause — Gespraech bleibt aber offen
  // Tempo-Wuensche Lukas 22.07.: ausreden lassen, aber nicht ewig nachlaufen.
  const ENDE_STILLE_MS = 1400;    // so lange Pause NACH Sprache = fertig geredet
  // Geduld (Lukas 24.07.): Das Gespraech bleibt OFFEN, bis er es beendet — vorher
  // fiel es nach 10 s Stille zu und er musste staendig neu wecken. Jetzt drei
  // Minuten Ruhe, und solange im Hintergrund etwas laeuft, schliesst es GAR NICHT:
  // er soll jederzeit "wie schaut's aus?" dazwischenfragen koennen.
  const GEDULD_MS = 180000;
  // Klare Stopp-Kommandos: sofort aufhoeren, egal ob sie gerade redet oder zuhoert.
  // Bewusst eng: nur eindeutige Stopp-Befehle. "halt"/"genug"/"ruhe" sind im
  // Deutschen zu alltaeglich — sonst stoppt sie sich beim eigenen "das ist halt so".
  const STOPP_RE = /\b(stopp?|aufh[oö]ren|h[oö]r auf|sei (?:still|ruhig))\b/i;
  // Das Gespraech WIRKLICH beenden — nur auf eine klare Verabschiedung
  // (Lukas 24.07.). Wichtig: "ok, ich mach mich an die Arbeit" beendet NICHT,
  // da bleibt sie an. Fragen ("bist du fertig?") beenden ebenfalls nie.
  const ENDE_RE = new RegExp(
    "(?:^|\\b)(?:" +
    "das war'?s(?: erst ?mal| f[uü]r jetzt| danke)?" +
    "|passt(?:,? (?:so|danke|fertig|erst ?mal))" +
    "|fertig f[uü]r (?:jetzt|heute)" +
    "|schalt\\w*(?: ich)?(?: dich)?(?: wieder)? (?:ab|aus)" +
    "|mach(?:e|st)?(?: ich)?(?: dich)?(?: wieder)? aus" +
    "|(?:bis (?:sp[aä]ter|dann|morgen))|tsch[uü]ss|ciao|feierabend" +
    "|danke,? das war'?s" +
    ")(?:\\b|$)", "i");
  // Alles Fragende beendet nie — "bist du fertig?" ist eine Zwischenfrage.
  const FRAGE_RE = /\?|^\s*(?:bist|hast|habt|wie|was|wann|wo|warum|wieso|kannst|ist|sind|gibt)\b/i;

  const willBeenden = (t) => ENDE_RE.test(t) && !FRAGE_RE.test(t);

  // ---------------------------------------------------------------- Oberflaeche

  const grosseKugel = document.getElementById("kugel");
  const istGrosseSeite = Boolean(grosseKugel);
  let el = {};

  if (istGrosseSeite) {
    el = {
      kugel: grosseKugel,
      wort: document.getElementById("kugel-wort"),
      zustandText: document.getElementById("zustand-text"),
      hinweis: document.getElementById("kugel-hinweis"),
      karten: document.getElementById("karten"),
      verlauf: document.getElementById("verlauf"),
      wakeKnopf: document.getElementById("btn-wake"),
      wakePunkt: document.getElementById("wake-punkt"),
      stimmeInfo: document.getElementById("stimme-info"),
    };
  } else {
    el = mini();
  }

  // Kleine Kugel unten rechts fuer alle anderen Seiten.
  function mini() {
    const huelle = document.createElement("div");
    huelle.className = "sprache-mini";
    huelle.innerHTML = `
      <div class="sm-blase" id="sm-blase" hidden></div>
      <button class="sm-kugel" id="sm-kugel" data-zustand="ruhe" title="Sprechen — oder sag „Hey Alexandra“">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle class="sm-ring" cx="32" cy="32" r="27"/>
          <circle class="sm-kern" cx="32" cy="32" r="14"/>
          <g class="sm-pegel">${Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            const x1 = 32 + Math.cos(a) * 17, y1 = 32 + Math.sin(a) * 17;
            const x2 = 32 + Math.cos(a) * 21, y2 = 32 + Math.sin(a) * 21;
            return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
          }).join("")}</g>
        </svg>
      </button>`;
    document.body.appendChild(huelle);

    const stil = document.createElement("style");
    stil.textContent = `
.sprache-mini{position:fixed;right:22px;bottom:22px;z-index:900;
  display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.sm-kugel{width:58px;height:58px;border-radius:50%;padding:0;cursor:pointer;
  background:var(--surface);border:1px solid var(--border);
  box-shadow:0 6px 22px rgba(0,0,0,.13);transition:transform .16s,border-color .16s}
.sm-kugel:hover{transform:scale(1.06)}
.sm-kugel svg{width:100%;height:100%;overflow:visible}
.sm-ring{fill:none;stroke:var(--border-stark);stroke-width:1.2;stroke-dasharray:3 7;
  transform-origin:32px 32px;opacity:.7}
.sm-kern{fill:var(--primary);opacity:.22;transform-origin:32px 32px}
.sm-pegel line{stroke:var(--primary);stroke-width:2;stroke-linecap:round;opacity:.15;
  transform-origin:32px 32px}
.sm-kugel[data-zustand="ruhe"] .sm-ring{animation:sm-dreh 40s linear infinite}
.sm-kugel[data-zustand="ruhe"] .sm-kern{animation:sm-atmen 5s ease-in-out infinite}
.sm-kugel[data-zustand="lauschen"]{border-color:var(--primary)}
.sm-kugel[data-zustand="lauschen"] .sm-ring{stroke:var(--primary);animation:sm-dreh 8s linear infinite}
.sm-kugel[data-zustand="lauschen"] .sm-pegel line{opacity:.85}
.sm-kugel[data-zustand="lauschen"] .sm-kern{opacity:.5}
.sm-kugel[data-zustand="denken"]{border-color:var(--warning)}
.sm-kugel[data-zustand="denken"] .sm-ring{stroke:var(--warning);stroke-dasharray:20 60;
  animation:sm-dreh 1.1s linear infinite}
.sm-kugel[data-zustand="pause"]{border-color:var(--border);opacity:.6}
.sm-kugel[data-zustand="pause"] .sm-pegel line{opacity:.12}
.sm-kugel[data-zustand="pause"] .sm-ring{animation:none}
.sm-kugel[data-zustand="sprechen"]{border-color:var(--success)}
.sm-kugel[data-zustand="sprechen"] .sm-ring{stroke:var(--success)}
.sm-kugel[data-zustand="sprechen"] .sm-pegel line{stroke:var(--success);opacity:.9}
.sm-blase{max-width:330px;background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r-md);padding:12px 15px;font-size:13.5px;line-height:1.5;
  box-shadow:0 6px 22px rgba(0,0,0,.13);animation:sm-rein .25s ease}
@keyframes sm-dreh{to{transform:rotate(360deg)}}
@keyframes sm-atmen{0%,100%{opacity:.18;transform:scale(1)}50%{opacity:.4;transform:scale(1.1)}}
@keyframes sm-rein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sm-ring,.sm-kern,.sm-pegel line{animation:none!important}}`;
    document.head.appendChild(stil);

    const blase = huelle.querySelector("#sm-blase");
    return {
      kugel: huelle.querySelector("#sm-kugel"),
      blase,
      sagen(text) {
        blase.hidden = false;
        blase.textContent = text;
        clearTimeout(blase._weg);
        blase._weg = setTimeout(() => { blase.hidden = true; }, 14000);
      },
    };
  }

  // ---------------------------------------------------------------- Zustand

  const WORTE = { ruhe: "bereit", lauschen: "hört zu", denken: "denkt nach", sprechen: "spricht", pause: "hört gerade nicht zu" };

  function setzeZustand(z, text) {
    zustand = z;
    el.kugel.dataset.zustand = z;
    if (el.zustandText) el.zustandText.textContent = text || WORTE[z] || z;
    // Im Ruhezustand steht der Name des Agenten da.
    //
    // ZWEI QUELLEN, und das ist Absicht (20.08.2026): konfig.agent kommt erst
    // mit /api/sprache/status an, also einen Wimpernschlag zu spaet. Bis dahin
    // gilt, was der SERVER schon ins HTML geschrieben hat — sonst ueberschreibt
    // der erste setzeZustand-Aufruf das gerenderte JARVIS mit dem Standardwert,
    // und es bleibt so stehen, bis jemand den Zustand wechselt. Genau das war
    // im ersten Drehversuch auf dem Bildschirm zu sehen.
    if (el.wort) el.wort.textContent = z === "ruhe"
      ? (konfig.agent || AGENT_IM_HTML).toUpperCase()
      : (WORTE[z] || "").toUpperCase();
  }

  // ---------------------------------------------------------------- Waechter
  //
  // Sorgt dafuer, dass der Wake-Lauscher laeuft, wann immer er laufen soll.
  // Egal wie ein Gespraech geendet ist — hier kommt er zurueck. Nur in Ruhe:
  // waehrend eines Gespraechs (lauschen/denken/sprechen) bleibt er still.
  setInterval(() => {
    if (!SR || !wakeAn) return;
    if (zustand !== "ruhe") return;
    if (wakeLaeuft) return;
    wakeStarten();
  }, 1000);

  function wakeStarten() {
    if (!SR || !wakeAn || wakeLaeuft || zustand !== "ruhe") return;
    let w;
    try { w = new SR(); } catch { return; }
    wakeErkennung = w;
    w.lang = "de-DE";
    w.continuous = true;
    w.interimResults = true;

    w.onstart = () => { wakeLaeuft = true; wakePunktSetzen(); };
    w.onresult = (ev) => {
      const t = Array.from(ev.results).map((r) => r[0].transcript).join(" ").toLowerCase();
      if (t.includes(konfig.wakeWord) && zustand === "ruhe") {
        try { w.stop(); } catch {}
        geweckt();
      }
    };
    // Chrome beendet Dauererkennung nach ~60 s von selbst. Der Waechter
    // startet sie wieder — hier nur den Merker zuruecksetzen.
    w.onend = () => { wakeLaeuft = false; wakePunktSetzen(); };
    w.onerror = (ev) => {
      wakeLaeuft = false;
      // Ohne Mikrofonfreigabe wuerde der Waechter im Sekundentakt weiter
      // versuchen. Also abschalten und sagen, woran es liegt.
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        wakeAn = false;
        if (el.hinweis) el.hinweis.textContent =
          "Mikrofon nicht freigegeben — im Schloss-Symbol der Adresszeile erlauben, dann Seite neu laden.";
      }
      wakePunktSetzen();
    };

    try { w.start(); } catch { wakeLaeuft = false; }
  }

  function wakeStoppen() {
    wakeAn = false;
    localStorage.setItem(WAKE_SPEICHER, "aus");
    try { wakeErkennung?.stop(); } catch {}
    wakeLaeuft = false;
    wakePunktSetzen();
  }

  function wakeUmschalten() {
    if (wakeAn) return wakeStoppen();
    wakeAn = true;
    localStorage.setItem(WAKE_SPEICHER, "an");
    wakePunktSetzen();
    wakeStarten();
  }

  function wakePunktSetzen() {
    el.wakePunkt?.classList.toggle("an", wakeAn && wakeLaeuft);
    if (el.wakeKnopf) el.wakeKnopf.title = wakeAn
      ? (wakeLaeuft ? "Lauscht auf „Hey Alexandra“" : "Wake-Word an — verbindet…")
      : "Wake-Word aus";
  }

  // ---------------------------------------------------------------- Gespraech

  // Auf das Wake-Word: Gespraech mit Begruessung starten.
  // Wecken — durch Klatschen, Klick auf die Kugel oder Leertaste.
  //
  // WARUM MEHRERE WEGE (20.08.2026): Die Klatsch-Erkennung laeuft auf
  // requestAnimationFrame, und das steht in einem Tab, der nicht sichtbar ist,
  // KOMPLETT still. Sobald die Drehmappe aufgeht und den Vordergrund nimmt,
  // hoert die Sprachseite auf, Klatschen zu bemerken. Am Set faellt das als
  // "ich klatsche und nichts passiert" auf, und man sucht am falschen Ende.
  //
  // Der Klick auf die Kugel und die Leertaste brauchen kein Mikrofon und
  // keinen Vordergrund-Zufall. Im Video sieht man davon nichts — geklatscht
  // wird trotzdem, das bleibt die Geste fuer die Kamera.
  async function drehbuchStarten() {
    if (imGespraech) return;
    try { document.dispatchEvent(new CustomEvent("alexandra-geweckt")); } catch {}
    klatschWacheStoppen();
    try { wakeErkennung?.stop(); } catch {}
    await gespraechStarten(false, true);   // erst der Zug, dann das Mikrofon
    drehZug = 0;
    // Den Belegstand JETZT merken, am Anfang des Takes. Erst beim Warten zu
    // fragen waere zu spaet: Wenn Lukas den Bon frueher losschickt, waere der
    // Ausgangswert schon der neue, und C3_04 wartete auf einen zweiten.
    drehBelegBasis = await belegStand();
    await drehbuchZug();
    geduld();
  }

  function geweckt() {
    if (drehbuch) return void drehbuchStarten();
    gespraechStarten(true);
  }

  // ------------------------------------------------------ Zweimal klatschen
  //
  // Gewuenscht am 20.08.2026 fuer die Meta-Ads: reinkommen, zweimal klatschen,
  // Alexandra meldet sich. Kein Knopf, kein Wake-Wort — das ist der Moment,
  // der die Anzeige traegt.
  //
  // WARUM EIN EIGENER LAUSCHER und nicht der vorhandene Pegel: Der laeuft nur
  // waehrend einer Aufnahme, und das Mikro wird zwischen den Runden bewusst
  // geschlossen (siehe pegelStoppen — sonst frisst die Echounterdrueckung
  // Alexandras eigene Woerter). Der Klatsch-Lauscher braucht das Gegenteil:
  // ein offenes Ohr, solange NICHTS passiert.
  //
  // WARUM noiseSuppression AUS: Genau dafuer ist sie gebaut — ein kurzer
  // lauter Knall gilt ihr als Stoergeraeusch und wird entfernt. Mit
  // eingeschalteter Unterdrueckung kommt vom Klatschen fast nichts an.
  // autoGainControl aus demselben Grund aus: Sie wuerde den Pegel nachregeln
  // und den Unterschied zwischen Sprache und Knall einebnen.
  const KLATSCH = {
    schwelle: 0.55,   // Spitze (0..1) — deutlich ueber normaler Sprache
    ruhe: 0.18,       // davor muss es leise gewesen sein: ein Knall, kein Anschwellen
    minAbstand: 120,  // ms — schneller klatscht niemand zweimal
    maxAbstand: 900,  // ms — laenger ist es kein Doppelklatschen mehr
    sperre: 2500,     // ms Ruhe nach dem Ausloesen, damit es nicht doppelt zuendet
  };
  let klatschStrom = null, klatschAnalyser = null, klatschRAF = 0;
  let klatschDaten = null, letzterKnall = 0, letztesAusloesen = 0, warLaut = false;

  async function klatschWacheStarten() {
    if (klatschAnalyser || konfig.klatsch === false) return;
    try {
      const ctx = audioKontext();
      klatschStrom = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
      const q = ctx.createMediaStreamSource(klatschStrom);
      klatschAnalyser = ctx.createAnalyser();
      klatschAnalyser.fftSize = 512;
      q.connect(klatschAnalyser);
      klatschDaten = new Uint8Array(klatschAnalyser.fftSize);
      klatschPruefen();
    } catch { /* ohne Mikrofonfreigabe gibt es die Klatsch-Wache eben nicht */ }
  }

  function klatschWacheStoppen() {
    if (klatschRAF) cancelAnimationFrame(klatschRAF);
    klatschRAF = 0;
    try { klatschStrom?.getTracks().forEach((t) => t.stop()); } catch {}
    klatschStrom = null;
    klatschAnalyser = null;
  }

  function klatschPruefen() {
    klatschRAF = requestAnimationFrame(klatschPruefen);
    if (!klatschAnalyser) return;
    // Nur im Ruhezustand. Waehrend sie spricht oder zuhoert, hat ein Knall
    // nichts auszuloesen — und ihre eigene Stimme soll ihn gar nicht erst
    // ausloesen koennen.
    if (imGespraech || zustand !== "ruhe") { warLaut = false; return; }

    // Zeitbereich, nicht Frequenz: Ein Klatschen ist ein AUSSCHLAG, kein Ton.
    klatschAnalyser.getByteTimeDomainData(klatschDaten);
    let spitze = 0;
    for (let i = 0; i < klatschDaten.length; i++) {
      const v = Math.abs(klatschDaten[i] - 128) / 128;
      if (v > spitze) spitze = v;
    }

    const jetzt = Date.now();
    if (spitze < KLATSCH.ruhe) { warLaut = false; return; }
    if (spitze < KLATSCH.schwelle || warLaut) return;

    // Ein Knall aus der Stille heraus.
    warLaut = true;
    const seitAusloesen = jetzt - letztesAusloesen;
    if (seitAusloesen < KLATSCH.sperre) { letzterKnall = 0; return; }

    const abstand = jetzt - letzterKnall;
    if (letzterKnall && abstand >= KLATSCH.minAbstand && abstand <= KLATSCH.maxAbstand) {
      letzterKnall = 0;
      letztesAusloesen = jetzt;
      klatschAusgeloest();
    } else {
      letzterKnall = jetzt;
    }
  }

  async function klatschAusgeloest() {
    if (el.hinweis) el.hinweis.textContent = "…";
    // Die Buehne (/buehne) haengt hier ihre Inszenierung an: Gehirn auffahren,
    // dann das Command Center dazuschieben. Auf /sprache hoert niemand zu,
    // dann passiert nichts weiter.
    try { document.dispatchEvent(new CustomEvent("alexandra-geweckt")); } catch {}
    // Das Mikro der Wache freigeben, bevor die Aufnahme startet — zwei
    // gleichzeitige Zugriffe handelt Android als neue Tonsitzung aus, und
    // jede Neuaushandlung ist ein Aussetzer in der Ausgabe.
    klatschWacheStoppen();
    try { wakeErkennung?.stop(); } catch {}
    // Im Drehbuch-Modus NICHT gleich zuhoeren — erst der Zug, dann das Mikrofon.
    await gespraechStarten(false, Boolean(drehbuch));
    // Im Dreh ist der erste Zug der Gruss — der steht im Drehbuch und darf
    // nicht von einem zweiten, selbst gebauten ueberlagert werden.
    if (drehbuch) { drehZug = 0; await drehbuchZug(); geduld(); return; }
    hoeren();
    await sprich(klatschGruss()).catch(() => {});
    geduld();                                // ab hier normal zuhoeren
  }

  // "Guten Morgen, Boss" ist der Satz aus dem Drehbuch. Nach der Tageszeit
  // abgewandelt, damit sie nachmittags nicht guten Morgen wuenscht — das
  // faellt in einer Aufnahme sofort auf.
  function klatschGruss() {
    const h = new Date().getHours();
    if (h < 11) return "Guten Morgen, Boss.";
    if (h < 18) return "Guten Tag, Boss.";
    return "Guten Abend, Boss.";
  }

  async function gespraechStarten(mitGruss, ohneHoeren) {
    imGespraech = true;
    letzteAktivitaet = Date.now();
    // Den Wake-Lauscher fuer die Dauer des Gespraechs wirklich abschalten.
    //
    // Er wurde bisher nur gestoppt, wenn er das Wake-Wort selbst gehoert hat —
    // beim Antippen der Kugel lief er weiter. Dann greifen ZWEI Dinge
    // gleichzeitig aufs Mikro zu: die Dauererkennung (die ihren Ton laufend an
    // Google schickt) und unsere eigene Aufnahme. Android handelt die
    // Tonsitzung dabei neu aus, und jede Neuaushandlung ist ein Aussetzer in
    // der Ausgabe. Genau deshalb lief es bei Lukas fluessig, sobald er den
    // Wake-Modus ausschaltete, und ruckelte wieder, sobald er ihn anschaltete.
    try { wakeErkennung?.stop(); } catch {}
    wakeLaeuft = false;
    wakePunktSetzen();
    if (mitGruss) await begruessung();
    // ohneHoeren: Das Drehbuch spielt zuerst seinen Zug und macht das Mikrofon
    // DANACH auf. Sonst laufen Aufnahme und Ausgabe gleichzeitig los — die
    // Aufnahme haelt "erkennung" fest, sagen() findet sie noch nicht und kann
    // sie nicht stoppen, und der erste Satz geht ins offene Mikrofon.
    if (!ohneHoeren) hoeren();
  }

  // Gespraech ist zu Ende — zurueck in Ruhe, der Waechter horcht wieder aufs
  // Wake-Word. Erst hier darf wieder "Hey Alexandra" noetig sein.
  function gespraechBeenden() {
    imGespraech = false;
    lausche = false;
    // Die Klatsch-Wache uebernimmt wieder, sobald das Gespraech vorbei ist.
    // Kurz verzoegert: Sonst hoert sie den letzten Satz aus dem Lautsprecher
    // noch mit und koennte sich am eigenen Schlusswort verschlucken.
    setTimeout(() => { if (!imGespraech) klatschWacheStarten(); }, 1200);
    pausiert = false;               // beim naechsten Wecken wieder normal zuhoeren
    pauseKnopfSetzen();
    clearTimeout(stilleTimer);
    setzeZustand("ruhe");
  }

  // Nach einer Antwort weiterhoeren, solange das Gespraech laeuft. Kurze Pause,
  // damit die eigene Stimme nicht als Nutzereingabe ins Mikro nachhallt.
  function weiter() {
    if (!imGespraech) { setzeZustand("ruhe"); return; }
    letzteAktivitaet = Date.now();   // frische Geduld nach jeder Antwort
    if (pausiert) { setzeZustand("pause"); return; }   // Mikro aus -> nicht wieder anfangen
    // Im Dreh laenger warten: Der Lautsprecher klingt nach, und das Mikro
    // sitzt im selben Raum. 350 ms reichten nicht.
    setTimeout(() => { if (imGespraech && !pausiert) hoeren(); }, drehbuch ? 900 : 350);
  }

  // Stille Runde: Gespraech offen halten, solange die Geduld reicht — nicht
  // gleich schliessen (sonst muesste Lukas staendig neu wecken). Laeuft im
  // Hintergrund noch Arbeit, bleibt es unbegrenzt offen: er soll jederzeit
  // "wie schaut's aus?" dazwischenwerfen koennen (Lukas 24.07.).
  // Was passiert, wenn der Server nicht erreichbar ist (20.08.2026).
  //
  // Nicht schweigen und nicht so tun, als haette man den Nutzer nicht
  // verstanden. Beim ersten Mal genuegt ein kurzer Hinweis und ein neuer
  // Anlauf — meist ist der Server binnen Sekunden zurueck (Neustart nach
  // einem Deploy dauert rund zehn). Bleibt es dabei, muss sie es SAGEN:
  // Wer ins Mikrofon spricht und nichts hoert, hat keine Chance zu erkennen,
  // ob es an ihm, am Mikrofon oder an der Leitung liegt.
  let netzFehlerZaehler = 0;
  async function netzAussetzer() {
    netzFehlerZaehler++;
    if (el.hinweis) {
      el.hinweis.textContent = netzFehlerZaehler === 1
        ? "Verbindung weg — ich versuch's gleich nochmal."
        : "Keine Verbindung zum Server. Prüf das Netz oder lad die Seite neu.";
    }
    setzeZustand("ruhe");
    if (netzFehlerZaehler === 2) {
      // Einmal laut, nicht bei jedem Anlauf — sonst redet sie im Kreis.
      await sprich("Ich komme gerade nicht an den Server. Sag es nochmal, sobald die Verbindung steht.")
        .catch(() => {});
    }
    // Warten und neu ansetzen: beim ersten Mal kurz, danach laenger.
    await new Promise((r) => setTimeout(r, netzFehlerZaehler === 1 ? 1500 : 4000));
    if (lausche) geduld();
  }

  function geduld() {
    if (!imGespraech) { setzeZustand("ruhe"); return; }
    if (pausiert) { setzeZustand("pause"); return; }   // Pause laeuft nicht ab
    if (Date.now() - letzteAktivitaet > GEDULD_MS)
    setTimeout(() => { if (imGespraech && !pausiert) hoeren(); }, 250);
  }

  // Mikro-Pause (Wunsch Lukas 24.07.): Sie soll ansprechbereit BLEIBEN, aber
  // gerade nicht zuhoeren — z. B. wenn er nebenher telefoniert oder laut denkt.
  // Wichtig: Das Gespraech bleibt offen. Beim Fortsetzen kann er direkt
  // weiterreden, OHNE "Hey Alexandra" zu sagen. Ergebnisse aus dem Hintergrund
  // sagt sie auch waehrend der Pause weiterhin an.
  function pauseUmschalten() {
    // Aus der Ruhe heraus: im Dreh das Drehbuch, sonst ein normales Gespraech.
    if (!imGespraech && drehbuch) return void drehbuchStarten();
    if (!imGespraech) return gespraechStarten(false);
    pausiert ? fortsetzen() : pausieren();
  }

  function pausieren() {
    pausiert = true;
    clearTimeout(stilleTimer);
    try { erkennung?.abort(); } catch {}
    lausche = false;
    setzeZustand("pause");
    if (el.hinweis) el.hinweis.textContent = "Mikro pausiert — klick auf die Kugel, dann rede einfach weiter";
    pauseKnopfSetzen();
  }

  function fortsetzen() {
    pausiert = false;
    letzteAktivitaet = Date.now();      // frische Geduld, nicht sofort zufallen
    pauseKnopfSetzen();
    if (el.hinweis) el.hinweis.textContent = "…";
    hoeren();                            // direkt weiter — kein Weckwort noetig
  }

  function pauseKnopfSetzen() {
    const k = document.getElementById("btn-pause");
    if (!k) return;
    k.textContent = pausiert ? "Weiter" : "Pause";
    k.title = pausiert
      ? "Wieder zuhören — du kannst direkt weiterreden"
      : "Mikro pausieren — sie bleibt ansprechbereit, hört aber nicht zu";
    k.classList.toggle("an", pausiert);
  }

  // Verabschiedung auf einen klaren Schlusssatz ("passt, das war's").
  async function verabschieden() {
    const s = "Alles klar, bis später.";
    zeile("sie", s);
    await sprich(s).catch(() => {});
    gespraechBeenden();
  }

  // Begruessung: beim ERSTEN Mal die volle Ansage ("Grosser Herrscher..."),
  // danach nur eine kurze, rotierende Ansprache — jedes Mal eine andere, damit
  // es nicht nervt. Der Merker liegt in sessionStorage: einmal pro Tab-Sitzung
  // voll, ueber Seitenwechsel und Neuladen hinweg.
  const REENTRY = [
    "Ja, was gibt's?",
    "Bin da — was brauchst du?",
    "Leg los, ich hör zu.",
    "Was kann ich für dich tun?",
    "Ja? Schieß los.",
    "Hier bin ich. Was liegt an?",
  ];

  async function begruessung() {
    setzeZustand("sprechen", "meldet sich");
    if (!sessionStorage.getItem("flowstate-begruesst")) {
      sessionStorage.setItem("flowstate-begruesst", "1");
      if (konfig.begruessung) { zeile("sie", konfig.begruessung); return begruessungCache(); }
    }
    const i = (Number(sessionStorage.getItem("flowstate-reentry")) || 0) % REENTRY.length;
    sessionStorage.setItem("flowstate-reentry", String((i + 1) % REENTRY.length));
    zeile("sie", REENTRY[i]);
    return sprich(REENTRY[i]);
  }

  // Die volle Begruessung wird EINMAL als Audio erzeugt und wiederverwendet —
  // spart bei jedem Wecken Wartezeit und ElevenLabs-Guthaben.
  async function begruessungCache() {
    const text = konfig.begruessung;
    if (!text) return;
    if (begruessungUrl) return sagen(begruessungUrl, true, text);
    if (!konfig.elevenlabs) return sprich(text);
    try {
      const r = await fetch("/api/sprache/stimme", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) return sprich(text);
      begruessungUrl = URL.createObjectURL(await r.blob());
      return sagen(begruessungUrl, true, text);
    } catch { return sprich(text); }
  }

  // ---------------------------------------------------------------- Zuhoeren

  // Zuhoeren laeuft seit A3 (26.07.) ueber den SERVER, nicht mehr im Browser.
  //
  // Wir nehmen mit MediaRecorder auf, erkennen das Satzende am Mikrofonpegel
  // und schicken die Aufnahme an /api/sprache/hoeren (ElevenLabs Scribe).
  //
  // Warum der Wechsel:
  //   - webkitSpeechRecognition verhoerte sich staendig. Aus dem Protokoll vom
  //     24.07.: "es war mein Job sein", "das kann aus okay ja ich klappte doch
  //     keine Zeit" — und ein Termin landete real im Kalender als "Ganz
  //     schlimm gehen".
  //   - Auf dem iPhone gibt es sie in der installierten App zwar, sie fragt
  //     aber nie nach dem Mikrofon und liefert weder Ergebnis noch Fehler.
  //     Genau der Fall "unterwegs" funktionierte also gar nicht. Mit Aufnahme
  //     + Server-Transkription faellt das weg — MediaRecorder kann iOS.
  //
  // Das WECK-Wort laeuft weiter ueber die Browser-Erkennung: Dauerlauschen als
  // Aufnahme waere teuer und daten-unsauber. Auf dem iPhone gibt es kein
  // Weckwort — dort tippt man die Kugel an, und genau das geht jetzt.
  const AUFNAHME_MAX_MS = 30000;   // Reissleine, falls die Stille nie kommt
  const OHNE_WORT_MS = 9000;       // nichts gesagt -> Gespraech offen halten
  const PEGEL_SCHWELLE = 12;       // ab hier gilt es als Sprache (0-255, RMS)

  async function hoeren() {
    if (lausche) return;                                // laeuft schon
    if (pausiert) { setzeZustand("pause"); return; }    // Mikro bewusst aus
    if (!window.MediaRecorder || !navigator.mediaDevices) { geduld(); return; }
    try { wakeErkennung?.stop(); } catch {}
    lausche = true;

    await pegelStarten();                 // besorgt mikroStrom + analyser
    if (!mikroStrom) { lausche = false; geduld(); return; }

    let rec;
    // Der Container haengt am Geraet: Chrome/Android koennen webm/opus, iOS
    // liefert mp4/aac. Wir nehmen, was der Browser anbietet, und sagen dem
    // Server im Content-Type, was es geworden ist.
    const kandidaten = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
    const typ = kandidaten.find((t) => !t || (window.MediaRecorder.isTypeSupported?.(t)));
    try { rec = new MediaRecorder(mikroStrom, typ ? { mimeType: typ } : undefined); }
    catch { lausche = false; geduld(); return; }

    const stuecke = [];
    let gestoppt = false, gesprochen = false;
    const start = Date.now();

    const stoppen = () => { if (!gestoppt) { gestoppt = true; try { rec.stop(); } catch {} } };
    // Damit hartStop()/pause() weiterhin greifen, ohne dass ich alle
    // Aufrufstellen anfassen muss: dieselbe Schnittstelle wie die Erkennung.
    erkennung = { stop: stoppen, abort: () => { gesprochen = false; stoppen(); } };

    rec.ondataavailable = (e) => { if (e.data?.size) stuecke.push(e.data); };

    rec.onstop = async () => {
      clearInterval(wache);
      lausche = false;
      if (!gesprochen || !stuecke.length) { geduld(); return; }

      if (el.hinweis) el.hinweis.textContent = "…";
      setzeZustand("denken");
      const blob = new Blob(stuecke, { type: rec.mimeType || "audio/webm" });
      // NETZFEHLER IST NICHT "NICHTS VERSTANDEN" (20.08.2026).
      //
      // Hier stand ein leeres catch mit dem Kommentar "Netz weg". Danach war
      // d = null, der Text leer, und die Seite sagte "Nichts verstanden —
      // sag's nochmal." Also genau das, was sie auch sagt, wenn jemand ins
      // Leere gehustet hat. Lukas hat daraufhin weitergesprochen, es kam
      // wieder nichts an, und das ging endlos so weiter: Die Kugel zeigte
      // "hoert zu", der Server bekam nie etwas.
      //
      // Ausgeloest hat es an dem Tag vermutlich ein Neustart des Servers
      // mitten im Gespraech. Der Grund spielt aber keine Rolle — eine
      // Oberflaeche, die einen Verbindungsabbruch als Hoerfehler des Nutzers
      // ausgibt, laesst ihn gegen eine Wand reden.
      let d = null, netzWeg = false;
      try {
        const r = await fetch("/api/sprache/hoeren", {
          method: "POST",
          headers: { "Content-Type": blob.type || "application/octet-stream" },
          body: blob,
        });
        if (!r.ok) netzWeg = true;               // 502/503 beim Neustart
        else d = await r.json().catch(() => null);
      } catch { netzWeg = true; }                // abgebrochen, offline

      if (netzWeg) { await netzAussetzer(); return; }
      netzFehlerZaehler = 0;

      const text = (d && d.ok && d.text || "").trim();
      if (!text) {
        if (el.hinweis) el.hinweis.textContent = "Nichts verstanden — sag's nochmal.";
        geduld();
        return;
      }
      if (STOPP_RE.test(text)) { hartStop(); return; }     // "Stopp" -> Gespraech aus
      if (willBeenden(text)) { verabschieden(); return; }  // "passt, das war's" -> aus
      verarbeiten(text);
    };

    // Satzende am Pegel erkennen: erst wenn wirklich gesprochen wurde, zaehlt
    // die Stille. Sonst wuerde jede Aufnahme sofort nach 1,4 s abbrechen.
    const daten = new Uint8Array(64);
    let letzterTon = Date.now();
    const wache = setInterval(() => {
      if (!analyser) return;
      analyser.getByteFrequencyData(daten);
      let summe = 0;
      for (const v of daten) summe += v;
      const pegel = summe / daten.length;

      if (pegel > PEGEL_SCHWELLE) {
        if (!gesprochen && el.hinweis) el.hinweis.textContent = "…";
        gesprochen = true;
        letzterTon = Date.now();
        letzteAktivitaet = Date.now();
      }
      const seitTon = Date.now() - letzterTon;
      const gesamt = Date.now() - start;
      if (gesprochen && seitTon >= ENDE_STILLE_MS) stoppen();   // ausgeredet
      else if (!gesprochen && gesamt >= OHNE_WORT_MS) stoppen(); // gar nichts gesagt
      else if (gesamt >= AUFNAHME_MAX_MS) stoppen();             // Reissleine
    }, 100);

    try {
      rec.start(250);
      setzeZustand("lauschen");
      if (el.hinweis) el.hinweis.textContent = "Ich höre …";
    } catch { clearInterval(wache); lausche = false; geduld(); }
  }

  // ---------------------------------------------------------------- Pegel

  function audioKontext() {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  let mikroQuelle = null;

  async function pegelStarten() {
    if (analyser) return;
    try {
      const ctx = audioKontext();
      // Echo-/Rauschunterdbrueckung: sonst hoert das Mikro Alexandras eigene
      // Stimme ueber die Lautsprecher und "antwortet sich selbst".
      mikroStrom ||= await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mikroQuelle = ctx.createMediaStreamSource(mikroStrom);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      mikroQuelle.connect(analyser);
    } catch { /* ohne Mikro-Pegel laeuft alles weiter */ }
  }

  // Mikrofon WIRKLICH freigeben, sobald nicht zugehoert wird.
  //
  // Vorher wurde es einmal geoeffnet und nie geschlossen — getTracks().stop()
  // kam im ganzen Browsercode nicht vor. Ein offenes Mikro ist auf Android
  // aber kein passiver Zustand: Das Geraet schaltet die Tonausgabe in den
  // Gespraechsmodus, und die Echounterdrueckung tut genau ihre Aufgabe — sie
  // entfernt aus dem Signal, was gleichzeitig aus dem Lautsprecher kommt.
  // Das ist Alexandras eigene Stimme. Deshalb fielen Woerter aus.
  //
  // Halbduplex ist hier das Richtige: Entweder sie spricht, oder wir hoeren
  // zu. Das Wiederoeffnen kostet 100-300 ms und faellt nicht auf; die
  // Freigabe ist schon erteilt, es wird nicht neu gefragt.
  function pegelStoppen() {
    try { mikroQuelle?.disconnect(); } catch {}
    try { mikroStrom?.getTracks().forEach((t) => t.stop()); } catch {}
    mikroQuelle = null;
    analyser = null;
    mikroStrom = null;
  }

  // Alexandras Sprachausgabe an einen Analyser haengen, damit die Kugel beim
  // Sprechen zu IHRER Stimme tanzt (nicht zum Mikro, das sie kaum hoert).
  function verbindePlayback(elAudio) {
    try {
      const ctx = audioKontext();
      const src = ctx.createMediaElementSource(elAudio);
      src.connect(ctx.destination);   // ZUERST hoerbar machen
      playbackAnalyser ||= (() => { const a = ctx.createAnalyser(); a.fftSize = 128; return a; })();
      src.connect(playbackAnalyser);  // dann zusaetzlich analysieren
    } catch { /* dann tragen die CSS-Animationen die Kugel */ }
  }

  // Eine Schleife fuer beide Quellen: beim Sprechen Alexandras Stimme, beim
  // Lauschen das Mikro. Laeuft dauerhaft; ruht die Balken, wenn nichts los ist.
  function pegelSchleife() {
    if (pegelLaeuft) return;
    pegelLaeuft = true;
    const daten = new Uint8Array(64);
    const striche = el.kugel.querySelectorAll(".pegel, .sm-pegel line");
    const tick = () => {
      const quelle = zustand === "sprechen" ? playbackAnalyser
        : zustand === "lauschen" ? analyser : null;
      if (quelle) {
        quelle.getByteFrequencyData(daten);
        // Direkte Leitung (19.08.): Das Partikelgehirn liest die Frequenzdaten
        // hier ab. Bis dahin lief der Pegel ueber 40 SVG-Linien — geschrieben
        // als style.transform, 60 Mal je Sekunde, und drueben wieder als Text
        // ausgelesen und geparst. Gemessen kostete allein dieser Umweg rund
        // 24 Bilder je Sekunde: In "hoeren" und "sprechen" lief das Gehirn mit
        // 34, in "ruhe" mit 58.
        window.__pegelDaten = daten;
        // Die Linien werden nur noch beschrieben, wenn KEIN Gehirn laeuft —
        // also fuer die alte Kugeldarstellung. Sie setzt window.__gehirn nicht.
        if (!window.__gehirn) {
          striche.forEach((s, i) => {
            const v = daten[i % daten.length] / 255;
            s.style.transform = `scale(${(1 + v * 1.5).toFixed(3)})`;
          });
        }
      } else {
        window.__pegelDaten = null;
        if (!window.__gehirn) striche.forEach((s) => (s.style.transform = ""));
      }
      requestAnimationFrame(tick);
    };
    tick();
  }

  // ---------------------------------------------------------------- Fragen
  //
  // STROM (A4 zweite Haelfte, 27.07.). Der Server schickt jeden fertigen Satz
  // sofort, statt auf die ganze Antwort zu warten. Bei einer erzaehlenden
  // Antwort ("was steht morgen an") spart das die Sekunden, in denen bisher
  // nichts passierte, obwohl der erste Satz laengst fertig war.
  //
  // Das Schlussereignis enthaelt dieselben Felder wie bisher — nur "sprich"
  // traegt dann nur noch, was der SERVER zusaetzlich sagt (Bestaetigungen wie
  // "Steht — Sport, Dienstag um elf"). Was schon gesprochen wurde, zieht der
  // Server selbst ab; hier braucht es dafuer keine Logik.
  //
  // Abschaltbar ueber localStorage flowstate-strom = "aus". Faellt irgendetwas
  // aus (kein ReadableStream, Netz bricht ab, Server antwortet nicht als
  // Strom), geht es unveraendert auf dem alten Weg weiter — der bleibt.
  const STROM_SPEICHER = "flowstate-strom";
  const stromAn = () => localStorage.getItem(STROM_SPEICHER) !== "aus" && Boolean(window.ReadableStream);

  async function frageStellen(text, meine) {
    const koerper = JSON.stringify({ text });
    const kopf = { method: "POST", headers: { "Content-Type": "application/json" }, body: koerper };

    if (stromAn()) {
      try {
        const r = await fetch("/api/sprache/frage?strom=1", kopf);
        if (r.ok && (r.headers.get("content-type") || "").includes("event-stream") && r.body) {
          const leser = r.body.getReader();
          const dek = new TextDecoder();
          let puffer = "";
          while (true) {
            const { done, value } = await leser.read();
            if (done) break;
            puffer += dek.decode(value, { stream: true });
            const zeilen = puffer.split("\n");
            puffer = zeilen.pop() || "";
            for (const z of zeilen) {
              if (!z.startsWith("data:")) continue;
              let e;
              try { e = JSON.parse(z.slice(5).trim()); } catch { continue; }
              if (e.typ === "satz") {
                // Wurde die Runde unterbrochen (Stopp, neue Frage), nicht
                // weitersprechen — sonst redet sie in die naechste hinein.
                if (meine !== gespraechsId) { try { leser.cancel(); } catch {} return null; }
                zeile("sie", e.text);
                await sprich(e.text).catch(() => {});
              } else if (e.typ === "fertig") {
                return e;
              }
            }
          }
          return null;   // Strom endete ohne Schluss — wie ein Verbindungsfehler
        }
        // Kein Strom zurueckgekommen: die Antwort ist trotzdem gueltiges JSON.
        return await r.json().catch(() => null);
      } catch { /* faellt unten auf den alten Weg zurueck */ }
    }

    return fetch("/api/sprache/frage", kopf).then((r) => r.json()).catch(() => null);
  }

  // ---------------------------------------------------------------- Verarbeiten

  async function verarbeiten(text) {
    const meine = ++gespraechsId;   // diese Runde; wird sie unterbrochen, bricht sie ab
    const begonnen = performance.now();
    letzteFrageAt = Date.now();
    zeile("ich", text);
    // Im Dreh geht die Frage NICHT ans Modell. Was Jannik gesagt hat, steht im
    // Verlauf — die Antwort ist der naechste Zug aus dem Drehbuch. Kein
    // "denkt nach", weil es nichts nachzudenken gibt und die Pause im Video
    // wie ein Aussetzer aussaehe.
    if (drehbuch) {
      // NUR ECHTE SAETZE SCHALTEN WEITER (20.08.2026).
      //
      // Beim ersten Durchlauf von Creative 2 lief das ganze Skript durch, ohne
      // dass Jannik ein Wort gesagt hatte. Im Protokoll stand bei JEDEM Zug ein
      // "hoeren" mit acht Zeichen: Das Mikro hatte den Nachhall aus dem
      // Lautsprecher aufgeschnappt, die Erkennung machte einen Wortfetzen
      // daraus, und der galt als Antwort.
      //
      // Janniks Zeilen sind ganze Saetze. Alles darunter ist Raum, Rascheln
      // oder Echo — und wird verworfen, statt die Aufnahme zu ruinieren.
      if (text.replace(/\s+/g, " ").trim().length < DREH_MIN_ZEICHEN) {
        console.log("Drehbuch: zu kurz, ignoriert —", JSON.stringify(text));
        if (el.hinweis) el.hinweis.textContent = "… (zu kurz, ich warte weiter)";
        return weiter();
      }
      return drehbuchZug();
    }
    setzeZustand("denken");
    if (el.karten) el.karten.innerHTML = "";

    // Kein Fuellsatz mehr waehrend des Wartens (A1, 26.07.). Die Blitz-Zusage
    // war ein Pflaster fuer die Wartezeit und hat das Dreifach-Sagen erzeugt:
    // sie wusste nichts von der eigentlichen Antwort und kuendigte an, was
    // gleich nochmal gesagt wurde. Der Strom nimmt die Wartezeit selbst weg,
    // statt sie zu ueberdecken: Jeder fertige Satz geht sofort an die Stimme.
    const d = await frageStellen(text, meine);

    if (meine !== gespraechsId) return;
    if (!d) {
      zeile("sie", "⚠️ Verbindung fehlgeschlagen.");
      await sprich("Verbindung hakt gerade — sag's gleich nochmal.").catch(() => {});
      return weiter();
    }
    if (!d.ok) { zeile("sie", "⚠️ " + (d.hint || "Fehler")); return weiter(); }

    (d.karten || []).forEach(karteZeigen);

    if (d.sprich) {
      const zel = zeile("sie", d.sprich);
      if (zel && el.verlauf) {
        const marke = document.createElement("span");
        marke.className = "sv-quelle";
        const wie = d.quelle === "hermes" ? "Hermes" : d.quelle === "sonnet" ? "Recherche" : "Zustand";
        marke.textContent = wie + " · " + ((performance.now() - begonnen) / 1000).toFixed(1) + " s";
        zel.appendChild(marke);
      }
      await sprich(d.sprich);
    }
    if (meine !== gespraechsId) return;   // waehrend des Sprechens unterbrochen -> abbrechen

    // Mehrere Aktionen laufen parallel (Multi-Action), in zwei Sorten:
    //   kurz — Wetter, Mail, Recherche, WhatsApp lesen. Sekunden. Wird hier im
    //          Gespraech abgewartet und das Ergebnis gesprochen.
    //   lang — Hermes. Minuten. Laeuft auf dem SERVER weiter und stellt sich
    //          ueber Telegram zu (A2); hier wird nur noch Bescheid gesagt.
    // Faellt eine alte Antwort mit nur auftragId rein, bauen wir sie um.
    const auftraege = Array.isArray(d.auftraege) && d.auftraege.length
      ? d.auftraege
      : (d.auftragId ? [{ id: d.auftragId, art: d.quelle === "hermes" ? "lang" : "kurz" }] : []);
    const lang = auftraege.filter((a) => a.art === "lang");
    const kurz = auftraege.filter((a) => a.art !== "lang");

    // Lange Arbeit laeuft auf dem SERVER weiter und meldet sich ueber
    // Telegram (A2, 26.07.). Der Browser verfolgt sie nicht mehr.

    if (kurz.length) {
      // Alle kurzen Aktionen parallel verfolgen; jede spricht ihr Ergebnis,
      // sobald es da ist (das Sprechen selbst ist serialisiert). Bei mehreren
      // keine gesprochenen Zwischenansagen — sonst reden sie durcheinander.
      await Promise.all(kurz.map((a) => auftragKurz(a.id)));
      if (meine !== gespraechsId) return;            // unterbrochen -> nicht weiterhoeren
      return weiter();                               // Gespraech bleibt offen
    }

    if (lang.length) {
      // Ein Satz, dann ist die Sache aus dem Gespraech heraus. Frueher hiess
      // es hier "ich bleib dran" und der Browser pollte zehn Minuten — schloss
      // Lukas die Seite, war das Ergebnis weg. Jetzt sagt sie, WO es ankommt.
      if (!d.sprich) await sprich("Mach ich — ich schick's dir per Telegram, sobald es steht.");
      return weiter();
    }

    weiter();
  }

  // Kurzer Auftrag (Wetter, Mail, Recherche) — laeuft im Gespraech. Waehrend er
  // laeuft, bleibt es still: Die Wartemarke im Verlauf zeigt, dass etwas
  // passiert, gesprochen wird erst das Ergebnis. Genau ein Sprechakt (A1).
  async function auftragKurz(id) {
    const warte = zeile("sie", "…einen Moment", true);
    setzeZustand("denken");
    for (let i = 0; i < 45; i++) {
      // ERST FRAGEN, DANN WARTEN (07.08.2026). Vorher stand das Warten davor,
      // und selbst ein Auftrag, der beim Eintreffen schon fertig war, kostete
      // 1,2 Sekunden Stille. Wetter braucht 57 ms, WhatsApp 1 ms — die
      // Wartezeit war zuletzt fast vollstaendig hausgemacht.
      if (i) await new Promise((r) => setTimeout(r, 700));
      const d = await fetch("/api/sprache/auftrag/" + id).then((r) => r.json()).catch(() => null);
      if (!d || !d.ok) break;
      if (d.fertig) {
        warte?.remove?.();
        const text = d.reply || ("Das hat gerade nicht geklappt — " + (d.hint || "frag mich gleich nochmal") + ".");
        zeile("sie", text);
        await sprich(text);
        return;
      }
      const sek = Math.round(i * 1.2 + 1);
      if (warte) warte.textContent = "…einen Moment (" + sek + " s)";
    }
    if (warte) warte.textContent = "Hat länger gedauert — frag gleich nochmal.";
  }

  // ---------------------------------------------------------------- Sprechen
  //
  // Alles Sprechen laeuft ueber EINEN Kanal (redetGerade), damit sich
  // Vordergrund-Antwort und Hintergrund-Ergebnis nie ueberlagern. Vor dem
  // Sprechen werden beide Erkenner gestoppt — sonst hoert Alexandra sich selbst.

  async function sagen(quelle, istUrl, anzeige) {
    while (redetGerade) await new Promise((r) => setTimeout(r, 150));
    redetGerade = true;
    redeText = norm(istUrl ? (anzeige || "") : quelle);
    try { wakeErkennung?.stop(); } catch {}
    try { erkennung?.stop(); } catch {}
    // Das Mikro WIRKLICH freigeben, bevor der Lautsprecher losgeht. Solange es
    // offen ist, laeuft die Tonausgabe auf Android im Gespraechsmodus und die
    // Echounterdrueckung schneidet Alexandras eigene Stimme heraus. hoeren()
    // oeffnet es danach wieder — das kostet 100-300 ms und faellt nicht auf.
    pegelStoppen();
    setzeZustand("sprechen");
    bargeStart();   // nur wenn ausdruecklich eingeschaltet (siehe dort)
    try {
      if (istUrl) { await abspielen(quelle, false); return; }
      if (konfig.elevenlabs) {
        try {
          const r = await fetch("/api/sprache/stimme", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: quelle }),
          });
          if (r.ok) { await abspielen(URL.createObjectURL(await r.blob()), true); return; }
        } catch { /* faellt auf die Browser-Stimme zurueck */ }
      }
      await browserStimme(quelle);
    } finally { bargeStop(); redetGerade = false; redeText = ""; aktuellerStop = null; }
  }

  function sprich(text) { return sagen(text, false); }

  const norm = (s) => String(s).toLowerCase().replace(/[^a-zäöüß0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  // BARGE-IN (Wunsch Lukas 22.07.): Faengt Lukas waehrend Alexandras Rede an zu
  // sprechen, hoert sie sofort auf und lauscht frisch. Damit sie sich nicht
  // selbst unterbricht (ihre Stimme leckt trotz Echo-Unterdrueckung ins Mikro),
  // wird ignoriert, was in ihrem gerade gesprochenen Satz (redeText) vorkommt.
  // Standardmaessig AUS (27.07.). Der Grund ist gemessen am Verhalten, nicht
  // vermutet: Lukas' Handy gab die Sprache irgendwann so aus, "als wuerde man
  // ein Video schauen, das die ganze Zeit haengt" — Woerter fielen aus, der
  // Rest kam stockend. Und es verschwand, sobald er den Wake-Modus ausschaltete.
  //
  // Diese Funktion oeffnete waehrend JEDES gesprochenen Satzes eine
  // Dauererkennung — die schickt auf Android laufend Ton an Google — und
  // startete sie in onend sofort wieder, wenn Chrome sie beendet. Bei einer
  // langen Antwort sind das mehrere Mikrofonzugriffe hintereinander, waehrend
  // der Lautsprecher laeuft. Android handelt die Tonsitzung bei jedem Zugriff
  // neu aus, und jede Neuaushandlung ist ein Aussetzer in der Ausgabe. Dazu
  // entfernt die Echounterdrueckung genau das, was gleichzeitig aus dem
  // Lautsprecher kommt: ihre eigene Stimme.
  //
  // WAS DAS KOSTET, ehrlich: Sie laesst sich mitten im Satz nicht mehr per
  // "Stopp" unterbrechen. Der Stopp-Knopf und ein Tippen auf die Kugel gehen
  // weiter, und sobald sie fertig ist, hoert sie ohnehin wieder zu. Wer den
  // Zuruf zurueckwill, setzt im Browser localStorage flowstate-barge auf "an"
  // — dann ist der Ton wieder unruhig. Erst messen, dann entscheiden.
  const BARGE_SPEICHER = "flowstate-barge";
  const bargeErlaubt = () => localStorage.getItem(BARGE_SPEICHER) === "an";

  function bargeStart() {
    if (!SR || !bargeErlaubt()) return;
    bargeStop();
    let b;
    try { b = new SR(); } catch { return; }
    bargeSR = b;
    bargeStartZeit = Date.now();
    b.lang = "de-DE"; b.interimResults = true; b.continuous = true;
    b.onresult = (ev) => {
      const roh = Array.from(ev.results).map((r) => r[0].transcript).join("");
      // WAEHREND des Sprechens NUR auf ein klares "Stopp" reagieren — NICHT auf
      // allgemeine Sprache. Grund: Spracherkennung + Lautsprecher-Echo verwechselt
      // ihre eigene Stimme staendig mit dem Nutzer und bricht mitten im Satz ab
      // (der "liest nur die Haelfte vor"-Fehler). Lieber sie immer ausreden lassen.
      if (STOPP_RE.test(roh) && !(redeText && redeText.includes(norm(roh)))) hartStop();
    };
    b.onerror = () => {};
    // Frueher wurde hier neu gestartet, sobald Chrome die Erkennung beendet —
    // also mitten im Sprechen ein weiterer Mikrofonzugriff. Genau diese Kette
    // hat die Ausgabe zerhackt. Eine Sitzung je Aeusserung muss reichen; endet
    // sie vorzeitig, entfaellt der Zuruf fuer den Rest des Satzes.
    b.onend = () => {};
    try { b.start(); } catch {}
  }

  function bargeStop() { const b = bargeSR; bargeSR = null; try { b?.stop(); } catch {} }

  function unterbrechen() {
    bargeStop();
    gespraechsId++;                 // die laufende Antwort ist damit ueberholt
    const stop = aktuellerStop; aktuellerStop = null;
    if (stop) stop();               // stoppt Audio/TTS sofort
    redetGerade = false;
    imGespraech = true;
    letzteAktivitaet = Date.now();
    hoeren();                       // frisch zuhoeren, was Lukas jetzt sagt
  }

  // Harter Stopp: sofort still + Gespraech beenden (auf "Stopp"). Danach muss
  // wieder "Hey Alexandra" kommen — genau das, was Lukas als Aus-Knopf will.
  function hartStop() {
    gespraechsId++;
    const stop = aktuellerStop; aktuellerStop = null;
    if (stop) stop();
    stoppen();
  }

  // EIN Abspielelement fuer die ganze Sitzung — nicht eines pro Satz.
  //
  // Der Fehler, den das behebt (Lukas am Handy, 27.07.): "Nach einer Zeit
  // hoert sich das an, als wuerde man ein Video schauen, das die ganze Zeit
  // haengt." Vorher entstand fuer JEDEN gesprochenen Satz ein neues
  // Audio-Element, das verbindePlayback() ueber createMediaElementSource in
  // den Web-Audio-Graphen haengte — und dort blieb es. Nichts wurde je
  // getrennt. Nach zwanzig Saetzen hingen zwanzig Quellknoten dauerhaft am
  // Ausgang, alle wurden bei jedem Ton mitgerechnet. Der Ton wurde nicht
  // langsam geladen, er wurde langsam VERARBEITET — deshalb klang es wie ein
  // ruckelndes Video und wurde mit der Gespraechsdauer schlimmer.
  //
  // Ein Element, ein Quellknoten, einmal verbunden. createMediaElementSource
  // darf ohnehin nur einmal je Element aufgerufen werden.
  let stimmAudio = null;
  function stimmElement() {
    if (!stimmAudio) {
      stimmAudio = new Audio();
      stimmAudio.preload = "auto";
      verbindePlayback(stimmAudio);   // genau EINMAL, nicht pro Satz
    }
    return stimmAudio;
  }

  // Hat die letzte Ausgabe wirklich geklungen? Wird von abspielen() gesetzt und
  // vom Drehbuch geprueft — sonst laeuft ein Zug stumm durch und niemand weiss,
  // warum nichts kommt.
  let ausgabeOk = true;

  function abspielen(url, freigeben) {
    ausgabeOk = true;
    return new Promise((fertig) => {
      const a = stimmElement();
      audio = a;
      let fertigGemeldet = false;
      const ende = () => {
        if (fertigGemeldet) return;      // onended UND onerror koennen feuern
        fertigGemeldet = true;
        a.onended = a.onerror = null;
        if (freigeben) URL.revokeObjectURL(url);
        aktuellerStop = null;
        fertig();
      };
      a.onended = ende;
      // Ein Fehler ist KEIN normales Ende. Bisher liefen beide in dieselbe
      // Funktion, und eine Tonspur, die gar nicht lief, sah aus wie eine
      // fertig gespielte — im Dreh hoert man dann nichts und sieht nichts.
      a.onerror = () => {
        ausgabeOk = false;
        console.error("Ton nicht abspielbar:", url, a.error && a.error.code);
        ende();
      };
      // Barge-in kann die Ausgabe sofort abwuergen.
      aktuellerStop = () => { try { a.pause(); } catch {} ende(); };
      a.src = url;
      a.play().catch((e) => {
        ausgabeOk = false;
        console.error("Ton blockiert:", e && e.name, url);
        ende();
      });
    });
  }

  function browserStimme(text) {
    return new Promise((fertig) => {
      if (!window.speechSynthesis) return fertig();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "de-DE";
      u.rate = 1.05;
      const de = speechSynthesis.getVoices().find((v) => v.lang.startsWith("de"));
      if (de) u.voice = de;
      const ende = () => { aktuellerStop = null; fertig(); };
      u.onend = u.onerror = ende;
      aktuellerStop = () => { try { window.speechSynthesis.cancel(); } catch {} ende(); };
      speechSynthesis.speak(u);
    });
  }

  function stoppen() {
    imGespraech = false;
    redetGerade = false;
    lausche = false;
    gespraechsId++;
    clearTimeout(stilleTimer);
    bargeStop();
    aktuellerStop = null;
    try { audio?.pause(); } catch {}
    window.speechSynthesis?.cancel();
    try { erkennung?.abort(); } catch {}
    setzeZustand("ruhe");
  }

  // ---------------------------------------------------------------- Anzeige

  function zeile(wer, text, warte = false) {
    if (!el.verlauf) { if (wer === "sie") el.sagen?.(text); return null; }
    const d = document.createElement("div");
    d.className = "sv " + wer + (warte ? " warte" : "");
    d.textContent = text;
    el.verlauf.appendChild(d);
    el.verlauf.scrollTop = el.verlauf.scrollHeight;
    return d;
  }

  function karteZeigen(k) {
    if (!el.karten) return;
    const d = document.createElement("div");
    d.className = "sk";
    if (k.art === "kalender") {
      const zeilen = (k.termine || []).map((t) =>
        `<tr><td class='zeit'>${t.von ? t.von + (t.bis ? "–" + t.bis : "") : "—"}</td><td>${esc(t.titel)}</td></tr>`).join("");
      d.innerHTML = `<h3>${esc(k.titel)} · ${esc(k.label)}</h3>` +
        (zeilen ? `<table>${zeilen}</table>` : "<div class='leer'>Keine Termine eingetragen.</div>");
    } else if (k.art === "zahlen") {
      const w = k.werte || {};
      d.innerHTML = "<h3>Kennzahlen</h3><table>" +
        (w.offen != null ? `<tr><td class='zeit'>Pipeline</td><td>${fmt(w.offen)} €</td></tr>` : "") +
        (w.monat != null ? `<tr><td class='zeit'>Monat</td><td>${fmt(w.monat)} €</td></tr>` : "") +
        (w.leads != null ? `<tr><td class='zeit'>Leads</td><td>${w.leads}</td></tr>` : "") + "</table>";
    } else if (k.art === "briefing") {
      d.innerHTML = `<h3>Briefing${k.alterMin != null ? " · vor " + k.alterMin + " Min." : ""}</h3>` +
        `<div class='leer' style='white-space:pre-wrap;color:var(--text-secondary)'>${esc(String(k.text).slice(0, 1200))}</div>`;
    }
    el.karten.appendChild(d);
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n).toLocaleString("de-DE", { maximumFractionDigits: 0 });

  // ---------------------------------------------------------------- Start

  // Klick auf die Kugel: in Ruhe startet es ein Gespraech (ohne Begruessung —
  // man hat ja aktiv geklickt); waehrend eines Gespraechs bricht es ab.
  // Klick auf die Kugel (Lukas 24.07.): aus der Ruhe startet er das Gespraech,
  // waehrend eines Gespraechs pausiert/loest er das Mikro — er beendet NICHT
  // mehr das ganze Gespraech. Zum Beenden gibt es "Stopp" (Knopf oder gesagt)
  // und die Verabschiedung ("passt, fertig").
  el.kugel.addEventListener("click", () => {
    // Im Dreh startet ein Klick auf die Kugel das Drehbuch — derselbe Weg wie
    // das Klatschen, nur ohne Mikrofon. Gebraucht wird er, weil die
    // Klatsch-Erkennung auf requestAnimationFrame laeuft und in einem Tab, der
    // gerade nicht sichtbar ist, komplett still steht.
    if (drehbuch && zustand === "ruhe" && !imGespraech) return void drehbuchStarten();
    if (zustand === "ruhe" && !imGespraech) return gespraechStarten(false);
    if (redetGerade) return unterbrechen();   // sie redet -> reinreden bleibt reinreden
    pauseUmschalten();
  });
  el.kugel.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); el.kugel.click(); }
  });
  el.wakeKnopf?.addEventListener("click", wakeUmschalten);
  document.getElementById("btn-pause")?.addEventListener("click", pauseUmschalten);
  document.getElementById("btn-stop")?.addEventListener("click", stoppen);
  document.getElementById("btn-frisch")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget, alt = b.textContent;
    b.textContent = "frischt auf…"; b.disabled = true;
    try {
      const d = await fetch("/api/sprache/auffrischen", { method: "POST" }).then((r) => r.json());
      b.textContent = d.ok ? "aufgefrischt ✓" : "fehlgeschlagen";
    } catch { b.textContent = "fehlgeschlagen"; }
    setTimeout(() => { b.textContent = alt; b.disabled = false; }, 2200);
  });

  // Zuhoeren braucht seit A3 nur noch Mikrofon + MediaRecorder — das koennen
  // alle aktuellen Browser, iPhone eingeschlossen.
  if ((!window.MediaRecorder || !navigator.mediaDevices) && el.hinweis) {
    el.hinweis.textContent = "Dieser Browser kann nicht aufnehmen. Nimm Chrome, Edge oder Safari.";
    el.kugel.style.opacity = ".5";
  }

  // Die iPhone-Falle ist mit A3 (26.07.) erledigt.
  //
  // Vorher stand hier eine Warnung: In der vom Homescreen installierten App
  // gibt es webkitSpeechRecognition auf iOS zwar, sie fragt aber nie nach dem
  // Mikrofon und liefert weder Ergebnis noch Fehler — man tippte die Kugel an
  // und es passierte schlicht nichts. (Seit Jahren offen bei Apple.) Der
  // Kommentar von damals endete mit: "Sobald wir Aufnahme + serverseitige
  // Transkription haben, faellt das weg." Genau das ist jetzt der Fall.
  //
  // Was auf dem iPhone weiterhin fehlt, ist das WECKWORT — dafuer braeuchte es
  // Dauererkennung im Browser. Dort tippt man die Kugel an. Deshalb hier nur
  // noch ein Hinweis auf die Bedienung, keine Fehlermeldung mehr.
  const istIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (istIOS && !SR && el.hinweis) {
    el.hinweis.textContent = "Tipp die Kugel an und sprich.";
  }

  setzeZustand("ruhe");
  wakePunktSetzen();
  pegelSchleife();   // laeuft dauerhaft; nutzt Mikro (Lauschen) bzw. Stimme (Sprechen)

  fetch("/api/sprache/status").then((r) => r.json()).then((k) => {
    konfig = { ...konfig, ...k };
    setzeZustand(zustand);   // Name neu setzen, jetzt ist er bekannt
    if (el.stimmeInfo) {
      el.stimmeInfo.textContent = k.elevenlabs ? "Stimme: ElevenLabs" : "Stimme: Browser (ElevenLabs nicht eingerichtet)";
    }
    // Im Dreh ist das Wake-Wort im Weg: "Hey Jarvis" steht in keinem Skript,
    // und die Dauererkennung greift parallel aufs Mikro. Geweckt wird
    // ausschliesslich durch Klatschen.
    // Die Servervorgabe gilt NUR auf der Sprachbuehne.
    //
    // WARUM (20.08.2026): Jede Seite des OS laedt diese Datei mit — auch die
    // Zentrale auf dem Fernseher und der Kalender im zweiten Fenster. Mit
    // DREH_CREATIVE wurde jede davon zum Drehbuch-Tab, und wer zuletzt lud,
    // riss die Fuehrung an sich. Die Sprachbuehne wurde dadurch passiv,
    // drehbuch stand auf null — und die naechste Frage ging ans Modell. Genau
    // das war zu hoeren: geklatscht, verstanden, aber frei geantwortet.
    //
    // Wer eine andere Seite ausdruecklich mit ?drehbuch=… aufruft, bekommt es
    // weiterhin. Nur die stille Vorgabe bleibt auf der Buehne.
    //
    // Sie schlaegt seit dem 21.08. auch das TAB-GEDAECHTNIS — siehe die
    // Rangfolge oben. Ein Wert, der aus einem Link kam, bleibt unangetastet.
    if (!drehAus && istGrosseSeite && konfig.drehbuch != null
        && (DREHBUCH_NR === null || nrAusGedaechtnis)) {
      const vorher = DREHBUCH_NR;
      DREHBUCH_NR = String(konfig.drehbuch);
      // Das Gedaechtnis mitziehen, sonst zeigt derselbe Tab beim naechsten
      // Laden wieder den alten Wert und der Fehler kaeme zurueck.
      try { sessionStorage.setItem(DREH_SPEICHER, DREHBUCH_NR); } catch (e) { /* privater Modus */ }
      if (vorher !== null && vorher !== DREHBUCH_NR) {
        console.log("Drehbuch: Tab-Gedaechtnis " + vorher + " durch Servervorgabe "
          + DREHBUCH_NR + " ersetzt.");
      }
    }
    // "?drehbuch=aus" heisst: Diese Seite fasst das Mikrofon NICHT an.
    //
    // WARUM (20.08.2026): Die Inhalte im zweiten Fenster sind teils eigene
    // Seiten — der Kalender etwa. Jede OS-Seite laedt diese Datei mit und
    // startet die Klatsch-Wache, also einen zweiten Zugriff aufs Mikrofon.
    // Der Sprachbuehne wurde es damit unter den Fuessen weggezogen: geklatscht,
    // geredet, nichts kam an. Ein "aus" muss deshalb wirklich alles abschalten,
    // nicht nur das Drehbuch.
    if (drehAus) {
      console.log("Sprachsteuerung auf dieser Seite aus (drehbuch=aus).");
      return;
    }
    if (wakeAn && DREHBUCH_NR === null) wakeStarten();
    // Zweimal klatschen weckt sie — ohne Knopf, ohne Wake-Wort. Braucht die
    // Mikrofonfreigabe; ohne sie tut klatschWacheStarten() still nichts.
    klatschWacheStarten();
    drehbuchLaden();
  }).catch(() => {});

  // STANDORT MELDEN (07.08.2026, Wunsch Lukas: "er soll immer wissen, wo ich
  // bin"). Anlass: "Wie warm wird es morgen, da wo ich gerade bin?" — das
  // System kannte nur den fest hinterlegten Ort Dorfen, er stand in Nizza.
  //
  // Der Browser fragt EINMAL um Erlaubnis; danach merkt er sie sich und es
  // laeuft still. Ohne Erlaubnis passiert nichts und alles bleibt wie bisher —
  // darum auch kein Hinweis, keine Aufforderung, kein zweites Fragen.
  //
  // enableHighAccuracy ist AUS: Fuer "wie warm wird es hier" reicht die Stadt,
  // und GPS einzuschalten kostet Akku und wartet auf Satellitenempfang.
  // maximumAge erlaubt eine Viertelstunde alte Position — in der Zeit aendert
  // sich das Wetter nicht.
  function standortMelden() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        fetch("/api/sprache/standort", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: p.coords.latitude, lon: p.coords.longitude }),
        }).catch(() => {});
      },
      () => { /* abgelehnt oder nicht verfuegbar — stillschweigend weiter */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 900000 }
    );
  }
  // Leertaste startet den Dreh, wenn die Kugel nichts tut. Nur auf der grossen
  // Seite und nur, solange ein Drehbuch geladen ist — sonst scrollt sie normal.
  document.addEventListener("keydown", (e) => {
    if (!drehbuch || !istGrosseSeite) return;
    if (e.code !== "Space" && e.code !== "Enter") return;
    const z = document.activeElement && document.activeElement.tagName;
    if (z === "INPUT" || z === "TEXTAREA") return;
    e.preventDefault();
    if (!imGespraech) drehbuchStarten();
    else if (!redetGerade) { try { erkennung?.stop(); } catch {} }  // Zug vorziehen
  });

  standortMelden();
  // Alle 15 Minuten nachfassen, solange die Seite offen ist: Lukas arbeitet
  // unterwegs, und ein Ort von heute Morgen ist kein "wo ich gerade bin".
  setInterval(standortMelden, 15 * 60 * 1000);
})();
