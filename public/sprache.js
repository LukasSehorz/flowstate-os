// Alexandras Ohr — laeuft auf JEDER Seite des OS.
//
// Auf /sprache uebernimmt es die grosse Kugel und zeigt Karten. Ueberall sonst
// blendet es eine kleine Kugel unten rechts ein. Das Wake-Word gilt in beiden
// Faellen, damit "Hey Alexandra" auch aus dem CRM heraus funktioniert.
//
// Die erste Fassung hatte einen Konstruktionsfehler: An sechs Stellen wurde der
// Zustand auf "ruhe" gesetzt, aber nur an einer das Wake-Word neu gestartet.
// Jeder andere Weg — Fehler, nichts verstanden, Abbruch — liess den Lauscher
// tot zurueck, und man musste den Knopf neu druecken.
//
// Deshalb jetzt ein WAECHTER statt verteilter Aufrufe: Er prueft im Sekundentakt,
// ob gelauscht werden soll, und startet neu, falls nicht. Damit ist es egal,
// ueber welchen Weg ein Gespraech endet — der Lauscher kommt von selbst zurueck.

(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const WAKE_SPEICHER = "flowstate-wake";

  let konfig = { elevenlabs: false, hermes: false, wakeWord: "alexandra", begruessung: "" };
  let zustand = "ruhe";
  let wakeAn = localStorage.getItem(WAKE_SPEICHER) === "an";
  let erkennung = null, wakeErkennung = null, wakeLaeuft = false;
  let audio = null, audioCtx = null, analyser = null, mikroStrom = null;
  let begruessungUrl = null;      // einmal erzeugt, danach wiederverwendet
  let letzteFrageAt = 0;

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

  const WORTE = { ruhe: "bereit", lauschen: "hört zu", denken: "denkt nach", sprechen: "spricht" };

  function setzeZustand(z, text) {
    zustand = z;
    el.kugel.dataset.zustand = z;
    if (el.zustandText) el.zustandText.textContent = text || WORTE[z] || z;
    if (el.wort) el.wort.textContent = z === "ruhe" ? "ALEXANDRA" : (WORTE[z] || "").toUpperCase();
  }

  // ---------------------------------------------------------------- Waechter
  //
  // Sorgt dafuer, dass der Wake-Lauscher laeuft, wann immer er laufen soll.
  // Egal wie ein Gespraech geendet ist — hier kommt er zurueck.
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
    w.onerror = () => { wakeLaeuft = false; wakePunktSetzen(); };

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

  // Auf das Wake-Word: kurz gruessen, dann zuhoeren.
  async function geweckt() {
    setzeZustand("sprechen", "meldet sich");
    await begruessen();
    hoeren();
  }

  // Die Begruessung wird EINMAL erzeugt und danach wiederverwendet —
  // spart bei jedem Wecken Wartezeit und ElevenLabs-Guthaben.
  async function begruessen() {
    const text = konfig.begruessung;
    if (!text) return;
    if (begruessungUrl) return abspielen(begruessungUrl, false);
    if (!konfig.elevenlabs) return browserStimme(text);
    try {
      const r = await fetch("/api/sprache/stimme", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) return browserStimme(text);
      begruessungUrl = URL.createObjectURL(await r.blob());
      return abspielen(begruessungUrl, false);
    } catch { return browserStimme(text); }
  }

  // ---------------------------------------------------------------- Zuhoeren

  function hoeren() {
    if (!SR || zustand === "lauschen") return;
    try { wakeErkennung?.stop(); } catch {}
    let r;
    try { r = new SR(); } catch { return; }
    erkennung = r;
    r.lang = "de-DE";
    r.interimResults = true;
    r.continuous = false;
    let letzter = "";

    r.onstart = () => { setzeZustand("lauschen"); pegelStarten(); };
    r.onresult = (ev) => {
      letzter = Array.from(ev.results).map((x) => x[0].transcript).join("");
      if (el.hinweis) el.hinweis.textContent = letzter || "…";
    };
    r.onerror = () => setzeZustand("ruhe", "nichts gehört");
    r.onend = () => {
      if (el.hinweis) el.hinweis.textContent = "Klick auf die Kugel oder sag „Hey Alexandra“";
      const text = letzter.trim();
      if (text) fragen(text);
      else setzeZustand("ruhe");   // Waechter uebernimmt wieder
    };
    try { r.start(); } catch { setzeZustand("ruhe"); }
  }

  // ---------------------------------------------------------------- Pegel

  async function pegelStarten() {
    if (analyser) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      mikroStrom ||= await navigator.mediaDevices.getUserMedia({ audio: true });
      const q = audioCtx.createMediaStreamSource(mikroStrom);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      q.connect(analyser);
      pegelSchleife();
    } catch { /* ohne Pegel laeuft alles weiter, nur weniger huebsch */ }
  }

  function pegelSchleife() {
    const daten = new Uint8Array(analyser.frequencyBinCount);
    const striche = el.kugel.querySelectorAll(".pegel, .sm-pegel line");
    const tick = () => {
      if (!analyser) return;
      if (zustand !== "lauschen" && zustand !== "sprechen") {
        striche.forEach((s) => (s.style.transform = ""));
        requestAnimationFrame(tick);
        return;
      }
      analyser.getByteFrequencyData(daten);
      striche.forEach((s, i) => {
        const v = daten[i % daten.length] / 255;
        s.style.transform = `scale(${(1 + v * 0.9).toFixed(3)})`;
      });
      requestAnimationFrame(tick);
    };
    tick();
  }

  // ---------------------------------------------------------------- Fragen

  async function fragen(text) {
    const begonnen = performance.now();
    letzteFrageAt = Date.now();
    zeile("ich", text);
    setzeZustand("denken");
    if (el.karten) el.karten.innerHTML = "";
    try {
      const r = await fetch("/api/sprache/frage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!d.ok) { zeile("sie", "⚠️ " + (d.hint || "Fehler")); return; }

      (d.karten || []).forEach(karteZeigen);
      if (d.sprich) {
        const zel = zeile("sie", d.sprich);
        if (zel && el.verlauf) {
          const marke = document.createElement("span");
          marke.className = "sv-quelle";
          marke.textContent = (d.quelle === "hermes" ? "Hermes" : "Zustand") +
            " · " + ((performance.now() - begonnen) / 1000).toFixed(1) + " s";
          zel.appendChild(marke);
        }
        await sprich(d.sprich);
      }
      if (d.auftragId) await auftragVerfolgen(d.auftragId);
    } catch {
      zeile("sie", "⚠️ Verbindung fehlgeschlagen.");
    } finally {
      // EIN Ausgang fuer alle Wege. Der Waechter startet das Wake-Word neu,
      // egal ob es gut ging, fehlschlug oder abgebrochen wurde.
      setzeZustand("ruhe");
    }
  }

  async function auftragVerfolgen(id) {
    const warte = zeile("sie", "…arbeitet noch", true);
    setzeZustand("denken");
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 900));
      const d = await fetch("/api/sprache/auftrag/" + id).then((r) => r.json()).catch(() => null);
      if (!d || !d.ok) break;
      if (d.fertig) {
        warte?.remove?.();
        const text = d.reply || ("⚠️ " + (d.hint || "kein Ergebnis"));
        zeile("sie", text);
        await sprich(text);
        return;
      }
      if (warte) warte.textContent = "…arbeitet noch (" + Math.round(i * 0.9 + 1) + " s)";
    }
    if (warte) warte.textContent = "Das dauert länger — schau später im Chat nach.";
  }

  // ---------------------------------------------------------------- Sprechen

  async function sprich(text) {
    setzeZustand("sprechen");
    if (konfig.elevenlabs) {
      try {
        const r = await fetch("/api/sprache/stimme", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (r.ok) {
          const url = URL.createObjectURL(await r.blob());
          await abspielen(url, true);
          return;
        }
      } catch { /* faellt auf die Browser-Stimme zurueck */ }
    }
    await browserStimme(text);
  }

  function abspielen(url, freigeben) {
    return new Promise((fertig) => {
      audio = new Audio(url);
      audio.onended = audio.onerror = () => {
        if (freigeben) URL.revokeObjectURL(url);
        fertig();
      };
      audio.play().catch(() => fertig());
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
      u.onend = u.onerror = () => fertig();
      speechSynthesis.speak(u);
    });
  }

  function stoppen() {
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

  el.kugel.addEventListener("click", () => (zustand === "ruhe" ? hoeren() : stoppen()));
  el.kugel.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); el.kugel.click(); }
  });
  el.wakeKnopf?.addEventListener("click", wakeUmschalten);
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

  if (!SR && el.hinweis) {
    el.hinweis.textContent = "Dieser Browser kann keine Spracherkennung. Nimm Chrome oder Edge.";
    el.kugel.style.opacity = ".5";
  }

  setzeZustand("ruhe");
  wakePunktSetzen();

  fetch("/api/sprache/status").then((r) => r.json()).then((k) => {
    konfig = { ...konfig, ...k };
    if (el.stimmeInfo) {
      el.stimmeInfo.textContent = k.elevenlabs ? "Stimme: ElevenLabs" : "Stimme: Browser (ElevenLabs nicht eingerichtet)";
    }
    if (wakeAn) wakeStarten();   // Wunsch ueberlebt den Seitenwechsel
  }).catch(() => {});
})();
