/* ====================================================================
   hud-zentrale.js — die Bewegung im Command Center (19.08.2026)
   ====================================================================

   Wofuer: Die Zentrale wird abgefilmt. Ein Pult, das beim Laden fertig
   dasteht, sieht auf dem Video aus wie ein Screenshot. Hier steht die
   Choreografie — EIN Startlauf (Panels herein, Zahlen hoch, Zeiger fahren,
   Saeulen leuchten auf), danach ruhige Dauerlaeufer (Band, Lauftext, Puls)
   und alle 45 Sekunden ein stiller Nachzug der echten Werte.

   Grundsaetze:
   - Ohne dieses Skript ist die Seite VOLLSTAENDIG. Der Server rendert jede
     Zahl, jeden Balken, jeden Zeiger im Endzustand. Wir setzen sie kurz auf
     Anfang und fahren sie hoch — nicht umgekehrt. Faellt das Skript aus,
     fehlt Bewegung, keine Information.
   - Es wird NICHTS gerechnet, was nicht vom Server kommt. Zwischenwerte beim
     Hochzaehlen sind Animation, kein Messwert; am Ende steht immer exakt die
     Zahl aus der Datenbank.
   - GSAP liegt unter /lib/gsap.min.js. Ist es nicht da, springt alles
     sofort auf den Endwert.

   Der Nachzug holt /api/hud/zentrale. Dieser Endpunkt liefert dieselben
   Zahlen wie die Seite UND die fertigen HTML-Stuecke fuer die Listen —
   gebaut von denselben Funktionen in server.js. So gibt es keine zweite
   Darstellung derselben Aufgabe, die auseinanderlaufen koennte.
   ==================================================================== */

(function () {
  "use strict";

  var hud = document.getElementById("hud");
  if (!hud) return;

  var ruhig = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var G = window.gsap || null;

  // ------------------------------------------------------------ Werkzeug

  function hesc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Dieselbe Schreibweise wie eur()/eurK() in server.js. Muss hier stehen,
  // weil beim Hochzaehlen jeder Zwischenwert formatiert wird — der Server
  // kann nur den Endwert liefern.
  function eur(n) { return Math.round(Number(n) || 0).toLocaleString("de-DE") + " €"; }
  function eurK(n) {
    var v = Number(n) || 0;
    if (v >= 10000) return Math.round(v / 1000) + "k €";
    if (v >= 1000) return (v / 1000).toFixed(1).replace(".0", "").replace(".", ",") + "k €";
    return Math.round(v) + " €";
  }
  function zahl(n) { return Math.round(Number(n) || 0).toLocaleString("de-DE"); }
  function prozent(n) { return (Number(n) > 0 ? "+" : "") + Math.round(Number(n) || 0) + " %"; }

  var FORMAT = { eur: eur, eurk: eurK, zahl: zahl, prozent: prozent };
  function formatiere(art, wert) { return (FORMAT[art] || zahl)(wert); }

  // Ein Tween, der auch ohne GSAP funktioniert: dann springt der Wert.
  function fahre(dauer, verzoegerung, schritt, fertig) {
    if (ruhig || !G) { schritt(1); if (fertig) fertig(); return; }
    var stand = { t: 0 };
    G.to(stand, {
      t: 1, duration: dauer, delay: verzoegerung, ease: "power2.out",
      onUpdate: function () { schritt(stand.t); },
      onComplete: function () { schritt(1); if (fertig) fertig(); },
    });
  }

  // ------------------------------------------------------- Zahlen hochfahren

  // Jede Zahl im Pult traegt data-wert (Schluessel) und data-format. Der
  // Textinhalt ist bereits der Endwert — wir merken ihn uns als Ziel und
  // zaehlen von der letzten bekannten Zahl dorthin.
  function zaehle(el, ziel, dauer, verzoegerung) {
    var art = el.getAttribute("data-format") || "zahl";
    var von = Number(el.getAttribute("data-stand"));
    if (!isFinite(von)) von = 0;
    var nach = Number(ziel);
    if (!isFinite(nach)) return;
    el.setAttribute("data-stand", String(nach));
    // Winzige Zahlen (0…3) zaehlen nicht sichtbar hoch — sie wuerden nur
    // flackern. Sie erscheinen mit dem Panel.
    if (Math.abs(nach - von) < 1) { el.textContent = formatiere(art, nach); return; }
    fahre(dauer, verzoegerung || 0, function (t) {
      el.textContent = formatiere(art, von + (nach - von) * t);
    });
  }

  function alleZahlen(wurzel, werte, dauer, basisVerzug) {
    var felder = wurzel.querySelectorAll("[data-wert]");
    for (var i = 0; i < felder.length; i++) {
      var el = felder[i];
      var s = el.getAttribute("data-wert");
      if (!(s in werte)) continue;
      zaehle(el, werte[s], dauer, (basisVerzug || 0) + Math.min(i, 14) * 0.035);
    }
  }

  // ---------------------------------------------------------------- Messuhr

  // Geometrie der Uhr: Mittelpunkt 100/100, der Bogen laeuft von 135° ueber
  // oben bis 405° — 270° Skala, wie bei einem Zeigerinstrument. 0° zeigt nach
  // rechts, y waechst nach unten (SVG-Koordinaten).
  var UHR_START = 135, UHR_SPANNE = 270, UHR_R = 78;

  function uhrPunkt(grad, r) {
    var b = (grad * Math.PI) / 180;
    return [100 + r * Math.cos(b), 100 + r * Math.sin(b)];
  }

  function uhrBogen(anteil) {
    var ende = UHR_START + UHR_SPANNE * Math.max(0, Math.min(1, anteil));
    var a = uhrPunkt(UHR_START, UHR_R), b = uhrPunkt(ende, UHR_R);
    var gross = UHR_SPANNE * anteil > 180 ? 1 : 0;
    return "M" + a[0].toFixed(2) + "," + a[1].toFixed(2) +
           " A" + UHR_R + "," + UHR_R + " 0 " + gross + " 1 " + b[0].toFixed(2) + "," + b[1].toFixed(2);
  }

  function uhrStellen(anteil) {
    var svg = document.getElementById("hud-uhr-svg");
    if (!svg) return;
    var bogen = svg.querySelector(".hud-uhr-bogen");
    var zeiger = svg.querySelector(".hud-uhr-zeiger");
    // Ein Bogen von exakt 0 zeichnet nichts — wir lassen ihn dann leer.
    if (bogen) bogen.setAttribute("d", anteil <= 0.0005 ? "" : uhrBogen(anteil));
    if (zeiger) zeiger.setAttribute("transform", "rotate(" + (UHR_START + UHR_SPANNE * anteil).toFixed(2) + " 100 100)");
  }

  function uhrFahren(anteil, verzoegerung) {
    var svg = document.getElementById("hud-uhr-svg");
    if (!svg) return;
    var von = Number(svg.getAttribute("data-stand"));
    if (!isFinite(von)) von = 0;
    svg.setAttribute("data-stand", String(anteil));
    if (ruhig || !G) { uhrStellen(anteil); return; }
    var w = { a: von };
    // back.out gibt dem Zeiger das kurze Ueberschwingen eines echten
    // Drehspulinstruments — das ist der Moment, auf den die Kamera wartet.
    G.to(w, {
      a: anteil, duration: 1.5, delay: verzoegerung || 0, ease: "back.out(1.4)",
      onUpdate: function () { uhrStellen(w.a); },
    });
  }

  // ------------------------------------------------------------- Balken

  function balkenFahren(verzoegerung) {
    var b = hud.querySelectorAll(".hud-balken-fuell");
    for (var i = 0; i < b.length; i++) {
      (function (el, i) {
        var ziel = Number(el.getAttribute("data-anteil")) || 0;
        var von = Number(el.getAttribute("data-stand"));
        if (!isFinite(von)) von = 0;
        el.setAttribute("data-stand", String(ziel));
        fahre(0.9, (verzoegerung || 0) + i * 0.08, function (t) {
          el.style.width = ((von + (ziel - von) * t) * 100).toFixed(2) + "%";
        });
      })(b[i], i);
    }
  }

  // ---------------------------------------------------------- Histogramm

  // Die Saeulen bestehen aus einzelnen Zellen. Beim Start gehen sie von unten
  // nach oben an, Saeule fuer Saeule von links nach rechts — das ist das
  // Aufbauen aus der Referenz. Der Server hat die Zellen schon richtig
  // gesetzt; wir loeschen sie kurz und lassen sie zurueckkommen.
  //
  // Bewusst mit setTimeout statt GSAP: hier wandern Klassen, keine Werte —
  // ein Tween haette nichts zu interpolieren.
  function histAufbauen(verzoegerung) {
    var saeulen = hud.querySelectorAll(".hud-hist-saeule");
    if (!saeulen.length || ruhig) return;
    Array.prototype.forEach.call(saeulen, function (s, i) {
      var zellen = s.querySelectorAll(".hud-hist-zelle");
      var an = [];
      Array.prototype.forEach.call(zellen, function (z) {
        if (z.classList.contains("an")) { an.push(z); z.classList.remove("an"); }
      });
      if (!an.length) return;
      setTimeout(function () {
        an.forEach(function (z, k) { setTimeout(function () { z.classList.add("an"); }, k * 24); });
      }, (verzoegerung || 0) * 1000 + i * 70);
    });
  }

  // ------------------------------------------------------------- Startlauf

  function startlauf() {
    var teile = hud.children;
    if (ruhig || !G) {
      hud.classList.remove("startet");
      hud.classList.add("laeuft");
    } else {
      G.set(teile, { opacity: 0, y: 14 });
      hud.classList.remove("startet");
      hud.classList.add("laeuft");
      G.to(teile, { opacity: 1, y: 0, duration: 0.55, ease: "power3.out", stagger: 0.045 });
    }

    // Zahlen: aus dem gerenderten Text den Endwert holen. Der Server legt ihn
    // als data-ziel an, damit wir nicht aus formatiertem Text zurueckrechnen.
    var felder = hud.querySelectorAll("[data-ziel]");
    Array.prototype.forEach.call(felder, function (el, i) {
      var ziel = Number(el.getAttribute("data-ziel"));
      if (!isFinite(ziel)) return;
      el.setAttribute("data-stand", "0");
      zaehle(el, ziel, 1.25, 0.25 + Math.min(i, 16) * 0.04);
    });

    var svg = document.getElementById("hud-uhr-svg");
    if (svg) {
      var anteil = Number(svg.getAttribute("data-anteil")) || 0;
      svg.setAttribute("data-stand", "0");
      uhrStellen(0);
      uhrFahren(anteil, 0.45);
    }

    Array.prototype.forEach.call(hud.querySelectorAll(".hud-balken-fuell"), function (el) {
      el.setAttribute("data-stand", "0");
      el.style.width = "0%";
    });
    balkenFahren(0.5);
    histAufbauen(0.4);
  }

  // ------------------------------------------------------------- Nachzug

  var NACHZUG_MS = 45000;

  function stueckSetzen(id, html) {
    var el = document.getElementById(id);
    if (!el || typeof html !== "string") return;
    el.innerHTML = html;
  }

  function nachziehen() {
    if (document.hidden) return;
    fetch("/api/hud/zentrale", { headers: { "x-requested-with": "hud" } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) return;
        if (d.werte) alleZahlen(hud, d.werte, 0.8, 0);
        if (typeof d.uhr_anteil === "number") {
          var svg = document.getElementById("hud-uhr-svg");
          if (svg) svg.setAttribute("data-anteil", String(d.uhr_anteil));
          uhrFahren(d.uhr_anteil, 0);
        }
        if (d.balken) {
          d.balken.forEach(function (b) {
            var el = hud.querySelector('.hud-balken-fuell[data-schluessel="' + b.schluessel + '"]');
            if (el) el.setAttribute("data-anteil", String(b.anteil));
          });
          balkenFahren(0);
        }
        if (d.html) {
          stueckSetzen("hud-todo-liste", d.html.todos);
          stueckSetzen("hud-alarm", d.html.alarme);
          stueckSetzen("hud-team-koerper", d.html.team);
          stueckSetzen("hud-band-lauf", d.html.band);
          stueckSetzen("hud-ticker-lauf", d.html.ticker);
          if (d.html.hist) {
            stueckSetzen("hud-hist-saeulen", d.html.hist);
            histAufbauen(0);
          }
        }
      })
      .catch(function () { /* Netz weg: das Pult zeigt weiter den letzten Stand. */ });
  }

  // Die Uhrzeit im Kopf laeuft sekundengenau mit — das ist der billigste und
  // ehrlichste Beweis, dass die Seite lebt (und keine Aufnahme ist). Einen
  // zweiten Zeitstempel fuer den Nachzug gibt es bewusst nicht: zwei Uhren
  // nebeneinander laden dazu ein, die falsche zu lesen.
  function uhrzeitLaufen() {
    var el = document.getElementById("hud-uhrzeit");
    if (!el) return;
    function tick() {
      var d = new Date();
      function p(n) { return (n < 10 ? "0" : "") + n; }
      el.textContent = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    }
    tick();
    setInterval(tick, 1000);
  }

  // --------------------------------------------------------- Termine (Tag)

  // Quelle ist /api/kalender/tag aus lib/kalender-routes.js — dieselbe
  // Leseroutine wie die Kalenderseite. Kein zweiter Kalender.
  var TAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  var versatz = 0;

  function terminZeit(t) {
    return t.uhrzeit ? '<time>' + hesc(t.uhrzeit) + "</time>" : '<time class="ganz">GANZTÄGIG</time>';
  }

  function termineLaden() {
    var koerper = document.getElementById("hud-termine");
    if (!koerper) return;
    var beschriftung = document.getElementById("hud-termine-tag");
    var d = new Date(Date.now() + versatz * 86400000);
    if (beschriftung) {
      beschriftung.textContent = versatz === 0 ? "HEUTE"
        : versatz === 1 ? "MORGEN"
        : versatz === -1 ? "GESTERN"
        : (TAGE[d.getDay()] + " " + d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })).toUpperCase();
    }
    fetch("/api/kalender/tag?versatz=" + versatz)
      .then(function (r) { return r.json(); })
      .then(function (dd) {
        if (!dd.ok) {
          // Der Text steht in einem eigenen Kasten, nicht direkt neben dem <b>.
          // Sonst stellt der Flexkasten Ueberschrift und Satz NEBENeinander —
          // der Leerzustand sah dadurch anders aus als jeder andere.
          koerper.innerHTML = '<div class="hud-leer"><div><b>Kalender offline</b>' +
            hesc(dd.hint || "Auf dieser Maschine besteht keine Verbindung zu Google.") + "</div></div>";
          return;
        }
        if (!dd.termine.length) {
          koerper.innerHTML = '<div class="hud-leer"><div><b>Frei</b>' +
            hesc(d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })) +
            " — keine Termine.</div></div>";
          return;
        }
        var jetzt = new Date();
        var minuten = jetzt.getHours() * 60 + jetzt.getMinutes();
        koerper.innerHTML = dd.termine.map(function (t) {
          var vorbei = false;
          if (versatz < 0) vorbei = true;
          else if (versatz === 0 && t.uhrzeit) {
            var teile = String(t.uhrzeit).split(":");
            vorbei = Number(teile[0]) * 60 + Number(teile[1] || 0) < minuten;
          }
          return '<div class="hud-zeile' + (vorbei ? " vorbei" : "") + '">' + terminZeit(t) +
            '<span class="hud-zeile-text">' + hesc(t.titel) +
            (t.ort ? "<i>" + hesc(t.ort) + "</i>" : "") + "</span></div>";
        }).join("");
      })
      .catch(function () {
        koerper.innerHTML = '<div class="hud-leer"><b>Kalender</b>Nicht erreichbar.</div>';
      });
  }

  window.hudTagWechseln = function (n) { versatz += n; termineLaden(); };

  // ------------------------------------------------------------- Briefing

  function briefingLaden() {
    var el = document.getElementById("hud-briefing");
    if (!el) return;
    fetch("/api/briefing")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.leer) {
          el.innerHTML = '<div class="hud-leer"><div><b>Kein Briefing</b>' +
            "Oben auf „Briefing erstellen“ — der Agent stellt Termine, Mails und Prioritäten zusammen.</div></div>";
          return;
        }
        // d.html kommt aus dem eigenen Vault (Markdown, von Alexandra
        // geschrieben) und wird bereits serverseitig gerendert.
        el.innerHTML = '<div class="hud-briefing-text">' + d.html + "</div>";
        var stand = document.getElementById("hud-briefing-stand");
        if (stand && d.stand) stand.textContent = String(d.stand).toUpperCase();
      })
      .catch(function () {
        el.innerHTML = '<div class="hud-leer"><div><b>Briefing</b>Nicht erreichbar.</div></div>';
      });
  }

  // ------------------------------------------------------- Meldungen (Post)

  // Mail-Triage und offene Entscheidungen haengen nicht an der Datenbank,
  // sondern an Dateien — sie kommen darum nachtraeglich in die Alarmzeile,
  // statt den ersten Aufbau der Seite aufzuhalten.
  function meldungenLaden() {
    var ziel = document.getElementById("hud-alarm");
    if (!ziel || ziel.getAttribute("data-post") !== "1") return;

    function anhaengen(text, ziel2, klasse) {
      var ruhige = ziel.querySelector(".hud-alarm-zeile.ruhig");
      if (ruhige) ruhige.remove();
      var a = document.createElement("a");
      a.className = "hud-alarm-zeile " + (klasse || "gelb");
      a.href = ziel2;
      a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg>' +
        "<span>" + text + "</span><span>ANSEHEN</span>";
      ziel.appendChild(a);
    }

    fetch("/api/mail").then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.leer || !d.koerbe) return;
      var n = (d.koerbe.dringend || []).length;
      if (n) anhaengen("<b>" + n + "</b> Mail" + (n === 1 ? "" : "s") + " wichtig und dringend", "/chat", "gelb");
    }).catch(function () {});

    fetch("/api/inbox").then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.gesamt) return;
      anhaengen("<b>" + d.gesamt + "</b> Entscheidung" + (d.gesamt === 1 ? "" : "en") + " wartet auf dich", "/chat", "gelb");
    }).catch(function () {});
  }

  // ---------------------------------------------------------------- Start

  startlauf();
  uhrzeitLaufen();
  termineLaden();
  briefingLaden();
  meldungenLaden();
  setInterval(nachziehen, NACHZUG_MS);
  // Zurueck auf dem Tab: sofort nachziehen statt bis zum naechsten Takt zu
  // warten — sonst steht dort eine halbe Minute lang ein alter Stand.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) nachziehen();
  });
  // Termine alle fuenf Minuten neu: der Google-Kalender ist die einzige
  // Quelle hier, die sich ohne unser Zutun aendert.
  setInterval(function () { if (!document.hidden && versatz === 0) termineLaden(); }, 300000);
})();
