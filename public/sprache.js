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
    if (el.wort) el.wort.textContent = z === "ruhe" ? "ALEXANDRA" : (WORTE[z] || "").toUpperCase();
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
  function geweckt() { gespraechStarten(true); }

  async function gespraechStarten(mitGruss) {
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
    hoeren();
  }

  // Gespraech ist zu Ende — zurueck in Ruhe, der Waechter horcht wieder aufs
  // Wake-Word. Erst hier darf wieder "Hey Alexandra" noetig sein.
  function gespraechBeenden() {
    imGespraech = false;
    lausche = false;
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
    setTimeout(() => { if (imGespraech && !pausiert) hoeren(); }, 350);
  }

  // Stille Runde: Gespraech offen halten, solange die Geduld reicht — nicht
  // gleich schliessen (sonst muesste Lukas staendig neu wecken). Laeuft im
  // Hintergrund noch Arbeit, bleibt es unbegrenzt offen: er soll jederzeit
  // "wie schaut's aus?" dazwischenwerfen koennen (Lukas 24.07.).
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
    if (!imGespraech) return gespraechStarten(false);   // aus der Ruhe: Gespraech starten
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
      let d = null;
      try {
        d = await fetch("/api/sprache/hoeren", {
          method: "POST",
          headers: { "Content-Type": blob.type || "application/octet-stream" },
          body: blob,
        }).then((r) => r.json());
      } catch { /* Netz weg */ }

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
        striche.forEach((s, i) => {
          const v = daten[i % daten.length] / 255;
          s.style.transform = `scale(${(1 + v * 1.5).toFixed(3)})`;
        });
      } else {
        striche.forEach((s) => (s.style.transform = ""));
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

  function abspielen(url, freigeben) {
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
      a.onended = a.onerror = ende;
      // Barge-in kann die Ausgabe sofort abwuergen.
      aktuellerStop = () => { try { a.pause(); } catch {} ende(); };
      a.src = url;
      a.play().catch(() => ende());
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
    if (el.stimmeInfo) {
      el.stimmeInfo.textContent = k.elevenlabs ? "Stimme: ElevenLabs" : "Stimme: Browser (ElevenLabs nicht eingerichtet)";
    }
    if (wakeAn) wakeStarten();   // Wunsch ueberlebt den Seitenwechsel
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
  standortMelden();
  // Alle 15 Minuten nachfassen, solange die Seite offen ist: Lukas arbeitet
  // unterwegs, und ein Ort von heute Morgen ist kein "wo ich gerade bin".
  setInterval(standortMelden, 15 * 60 * 1000);
})();
