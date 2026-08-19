/* =====================================================================
   ALEXANDRA — Partikelgehirn (Canvas 2D)
   =====================================================================

   Was das ist (19.08.2026): Die Sprachseite zeigt statt der alten SVG-Kugel
   ein Gehirn aus mehreren tausend feinen Faeden. Vorbild ist das gepinnte
   Referenzbild — ein Nervenfaser-Praeparat, das aus sich heraus leuchtet.
   In der Referenz ist es orange; bei uns ist es blau (#4B8DF8), das ist
   ausdruecklicher Wunsch und gilt in allen Zustaenden. Ein Zustand aendert
   BEWEGUNG und HELLIGKEIT, nicht die Grundfarbe.

   Warum Canvas und nicht SVG: Es sind bis zu 11.000 Faeden zu je acht
   Punkten, also rund 88.000 Stuetzpunkte, die jedes Bild neu gedreht, verformt und
   projiziert werden. Als DOM-Knoten waere das unbezahlbar; auf dem Canvas
   sind es acht stroke()-Aufrufe pro Bild. Der Glut-Eindruck entsteht durch
   additives Ueberlagern (globalCompositeOperation = "lighter"): wo viele
   Faeden uebereinanderliegen, laeuft die Farbe von selbst ins Weisse. Genau
   so sieht die Referenz aus — keine gemalte Textur, nur Linien.

   Warum es die Zustandslogik NICHT nachbaut: public/sprache.js ist die eine
   Wahrheit ueber ruhe/lauschen/denken/sprechen/pause. Diese Datei haengt sich
   mit einem MutationObserver an das data-zustand am #kugel und liest den
   Mikrofon- bzw. Stimmpegel aus den unsichtbaren .pegel-Linien, die dieselbe
   Datei ohnehin Bild fuer Bild beschriftet. So musste an der Bedienlogik
   keine Zeile geaendert werden.

   Was die Seite aushalten muss: Sie laeuft im Buero stundenlang offen und
   wird abgefilmt. Deshalb feste Partikelzahl (waechst nie), Pause bei
   document.hidden, weniger Faeden auf kleinen Geraeten und eine Notbremse,
   die die sichtbare Menge senkt, wenn der Abstand zweier Bilder ueber
   20,5 ms steigt.
   ===================================================================== */

(function () {
  "use strict";

  var buehne = document.getElementById("gh-buehne");
  var leinwand = document.getElementById("gh-canvas");
  var kugel = document.getElementById("kugel");
  if (!buehne || !leinwand || !kugel) return;

  var ctx = leinwand.getContext("2d", { alpha: false });
  if (!ctx) return;

  var sanft = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------ Werkzeug

  var TAU = Math.PI * 2;

  // Sinus-Tabelle. Pro Bild fallen zwei Sinusse je Stuetzpunkt an, also gut
  // 22.000 — als Math.sin messbar, als Tabellenzugriff nicht.
  var LUT = 2048;
  var SIN = new Float32Array(LUT);
  for (var s = 0; s < LUT; s++) SIN[s] = Math.sin((s / LUT) * TAU);
  function sinL(x) { return SIN[((x * (LUT / TAU)) | 0) & (LUT - 1)]; }

  // Zufall mit Startwert: Das Gehirn muss bei jedem Laden GLEICH aussehen.
  // Beim Abfilmen ist eine Form, die sich nach jedem Neuladen aendert, ein
  // Fehler — man kann keine zweite Aufnahme derselben Einstellung machen.
  function wuerfel(saat) {
    return function () {
      saat |= 0; saat = (saat + 0x6D2B79F5) | 0;
      var t = Math.imul(saat ^ (saat >>> 15), 1 | saat);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function streu(x, y, z) {
    var n = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
    n ^= n >>> 13;
    n = Math.imul(n, 0xc2b2ae35);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  // Wertrauschen in 3D, trilinear geglaettet. Damit bekommt die Gehirnform
  // ihre Windungen — ohne das waere sie ein glattes Ei.
  function rausch(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    var c000 = streu(xi, yi, zi), c100 = streu(xi + 1, yi, zi);
    var c010 = streu(xi, yi + 1, zi), c110 = streu(xi + 1, yi + 1, zi);
    var c001 = streu(xi, yi, zi + 1), c101 = streu(xi + 1, yi, zi + 1);
    var c011 = streu(xi, yi + 1, zi + 1), c111 = streu(xi + 1, yi + 1, zi + 1);
    var x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    var x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    var y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  }

  function weich(x, a, b) {
    var t = (x - a) / (b - a);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  // ------------------------------------------------------- Die Gehirnform
  //
  // Kein Modell, keine Datei: der Radius wird fuer jede Richtung auf der
  // Einheitskugel ausgerechnet. Sechs Eingriffe machen aus der Kugel ein
  // Gehirn — Ellipsoid, flache Unterseite, Schlaefenwulst, Windungen und,
  // das Wichtigste fuers Wiedererkennen, die LAENGSFURCHE in der Mittelebene.
  //
  // Achsen: x = links/rechts, y = oben/unten, z = hinten/vorn.

  function formRadius(dx, dy, dz) {
    var a = 0.700, b = 0.655, c = 1.000;
    var r = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b) + (dz * dz) / (c * c));

    // Der Stirnlappen ist schmaler und niedriger als das Hinterhaupt.
    var vorn = dz > 0 ? dz : 0;
    r *= 1 - 0.12 * vorn * vorn;

    // Unterseite abgeflacht — ein Gehirn liegt auf der Schaedelbasis auf.
    var unten = -dy - 0.34; if (unten < 0) unten = 0;
    r *= 1 - 0.72 * unten * unten;

    // Schlaefenlappen: seitlicher Wulst, unten und leicht nach vorn.
    var ty = (dy + 0.40) / 0.30, tz = (dz - 0.22) / 0.60;
    r *= 1 + 0.17 * Math.exp(-(ty * ty + tz * tz)) * (dx < 0 ? -dx : dx);

    // Windungen: drei Rauschstufen. Ohne die feinste Stufe wirkt die
    // Oberflaeche geschliffen, und ein Gehirn ist alles andere als das.
    r += 0.062 * (rausch(dx * 3.1 + 11.3, dy * 3.1 + 5.7, dz * 3.1 + 3.1) - 0.5) * 2;
    r += 0.030 * (rausch(dx * 7.4 + 31.1, dy * 7.4 + 17.9, dz * 7.4 + 23.3) - 0.5) * 2;
    r += 0.013 * (rausch(dx * 15.7 + 61.3, dy * 15.7 + 47.1, dz * 15.7 + 53.9) - 0.5) * 2;

    // Laengsfurche. Tiefe Kerbe entlang x = 0, oben am tiefsten, nach unten
    // auslaufend. Ohne sie liest niemand die Form als Gehirn — sie ist das
    // eine Merkmal, das eine Kugel von einem Grosshirn unterscheidet.
    var f = dx / 0.115;
    r -= 0.275 * Math.exp(-f * f) * weich(dy, -0.52, 0.26);

    // Und quer dazu die Zentralfurche: eine flache Rinne, die von oben ueber
    // die Seiten nach vorn unten laeuft. Sie teilt Stirn- und Scheitellappen
    // und macht aus der glatten Haube zwei erkennbare Felder.
    var g = (dz - 0.10 + dy * 0.42) / 0.13;
    r -= 0.075 * Math.exp(-g * g) * weich(dy, -0.30, 0.10);

    return r;
  }

  // Kleinhirn: eigener, kleinerer und dichter gestreifter Koerper hinten unten.
  var KH = { x: 0, y: -0.45, z: -0.63, r: 0.345 };

  // ------------------------------------------------------ Fadenerzeugung
  //
  // Ein Faden ist ein kurzer Spaziergang ueber die Oberflaeche: Startrichtung
  // wuerfeln, Tangentialrichtung aus dem Rauschfeld nehmen, acht Schritte
  // gehen und dabei bei jedem Schritt wieder auf die Form zurueckprojizieren.
  // Das ergibt gekruemmte Faeden, die sich der Form anschmiegen — genau der
  // Wollknaeuel-Eindruck aus der Referenz.

  var K = 8;                       // Stuetzpunkte je Faden

  // Wie viele Faeden? Die Referenz lebt von DICHTE — einzeln erkennbare
  // Straehnen sehen aus wie ein Wollknaeuel, erst die Masse sieht aus wie ein
  // Praeparat. Deshalb lieber viele KURZE Faeden als wenige lange.
  // Die Zahlen wurden am 19.08. gemessen statt geschaetzt: bei 5.200 Faeden
  // brauchte ein Bild auf 1920x1080 rund 2,9 ms — ein Sechstel des Budgets.
  // Das Bild war entsprechend duenn: einzelne Straehnen waren zu zaehlen, und
  // die Referenz zaehlt man nicht, sie ist ein Praeparat. Die Menge liegt
  // jetzt bei rund dem Zweieinhalbfachen; die Notbremse unten faengt Geraete
  // ab, denen das zu viel ist.
  function fadenZahl() {
    var w = window.innerWidth, kerne = navigator.hardwareConcurrency || 4;
    var n = w < 620 ? 2000 : w < 1000 ? 3800 : w < 1500 ? 5800 : 7600;
    if (kerne <= 4) n = Math.round(n * 0.70);
    return n;
  }

  var nF = fadenZahl(), nP = nF * K;
  var nrm = new Float32Array(nP * 3);   // Richtung je Stuetzpunkt (Einheitsvektor)
  var rad = new Float32Array(nP);       // Radius je Stuetzpunkt
  var spitze = new Float32Array(nP);    // 0 am Fadenanfang, 1 an der Spitze
  var fPhase = new Float32Array(nF);    // Eigenphase (Flackern, Impulsversatz)
  var fLage = new Float32Array(nF);     // Lage entlang der Impulsachse, 0..1
  var fSchale = new Float32Array(nF);   // 1 = an der Oberflaeche, klein = innen
  var fSpin = new Float32Array(nF);     // nur fuers Erwachen: Startverdrehung
  var fWeit = new Float32Array(nF);     // nur fuers Erwachen: Startstreuung

  // Der Hirnstamm. Ein duenner, sich verjuengender Strang von unter dem
  // Kleinhirn nach vorn unten. Er kostet vier Prozent der Faeden und ist nach
  // der Laengsfurche das staerkste Erkennungszeichen: eine Kugel mit einem
  // Stiel liest niemand mehr als Kugel.
  var ST_A = { x: 0, y: -0.30, z: -0.22 }, ST_B = { x: 0, y: -0.74, z: 0.06 };

  (function bauen() {
    var zuf = wuerfel(20260819);
    var p = 0;
    for (var i = 0; i < nF; i++) {
      // Welcher Koerper? 0 = Grosshirn, 1 = Kleinhirn, 2 = Hirnstamm.
      var wahl = zuf();
      var koerper = wahl < 0.782 ? 0 : wahl < 0.976 ? 1 : 2;

      // Gleichverteilte Richtung auf der Kugel. Beim Grosshirn wird ein
      // schmaler Streifen ueber der Mittelebene AUSGESPART — sonst waechst das
      // Fadenwerk ueber die Laengsfurche hinweg und deckt sie zu. Die Kerbe in
      // formRadius() allein genuegt dafuer nicht: sie zieht die Faeden nur
      // tiefer, sie nimmt sie nicht weg.
      var dx, dy, dz, versuch = 0;
      do {
        var u = zuf() * 2 - 1, ph = zuf() * TAU, sr = Math.sqrt(1 - u * u);
        dx = sr * Math.cos(ph); dy = u; dz = sr * Math.sin(ph);
        versuch++;
      } while (koerper === 0 && versuch < 10 && (dx < 0.085 && dx > -0.085) && dy > -0.14);

      // Schale: die meisten Faeden liegen dicht unter der Oberflaeche, ein
      // Siebtel liegt tief innen (die tragen die durchscheinende Glut), und
      // wenige fransen nach aussen aus.
      var t = zuf();
      var schale = t < 0.045 ? 1.02 + zuf() * 0.13        // ausgefranst
        : t < 0.190 ? 0.40 + zuf() * 0.37                 // tief innen
          : 1.0 - Math.pow(zuf(), 1.7) * 0.16;            // Rinde
      fSchale[i] = schale > 1 ? 1 : schale;
      fPhase[i] = zuf();
      fSpin[i] = (zuf() - 0.5) * 2.6;
      fWeit[i] = 0.35 + zuf() * 1.25;

      // Schrittweite in Bogenmass. Acht Schritte a ~0.026 ergeben rund 0.18
      // Bogenmass, also etwa ein Zehntel des Umfangs — kurze Fasern, die die
      // Form zeigen, statt langer Straehnen, die sie zudecken.
      var schritt = (0.013 + zuf() * 0.026) * (koerper === 1 ? 0.62 : 1);
      var winkel = rausch(dx * 2.2 + 7, dy * 2.2 + 2, dz * 2.2 + 9) * TAU;
      var dreh = (zuf() - 0.5) * 0.62;
      var mittelZ = 0;

      // Der Hirnstamm laeuft nicht auf einer Kugel, sondern einen Schlauch
      // entlang: u wandert von oben nach unten, der Faden liegt auf dem Mantel.
      var su = zuf() * 0.86, sw = zuf() * TAU;
      var sSchritt = 0.028 + zuf() * 0.022;

      for (var k = 0; k < K; k++) {
        var wx, wy, wz, len;
        if (koerper === 2) {
          var rr = (0.105 - 0.052 * su) * schale;
          wx = ST_A.x + (ST_B.x - ST_A.x) * su + Math.cos(sw) * rr;
          wy = ST_A.y + (ST_B.y - ST_A.y) * su;
          wz = ST_A.z + (ST_B.z - ST_A.z) * su + Math.sin(sw) * rr * 0.9;
          len = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1e-6;
          nrm[p * 3] = wx / len; nrm[p * 3 + 1] = wy / len; nrm[p * 3 + 2] = wz / len;
          rad[p] = len;
          mittelZ += wz;
          su += sSchritt; sw += dreh * 0.5;
          if (su > 1) su = 1;
        } else if (koerper === 1) {
          // Kleinhirn: eigene, flach gedrueckte Kugel hinten unten. Ihre
          // Faeden sind kuerzer und dichter — im Praeparat sieht das Kleinhirn
          // deutlich feiner gestreift aus als die Rinde darueber.
          var kr = KH.r * (0.86 + 0.16 * rausch(dx * 9 + 41, dy * 9 + 13, dz * 9 + 27)) * schale;
          wx = KH.x + dx * kr; wy = KH.y + dy * kr * 0.72; wz = KH.z + dz * kr;
          len = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1e-6;
          nrm[p * 3] = wx / len; nrm[p * 3 + 1] = wy / len; nrm[p * 3 + 2] = wz / len;
          rad[p] = len;
          mittelZ += wz;
        } else {
          var r = formRadius(dx, dy, dz) * schale;
          nrm[p * 3] = dx; nrm[p * 3 + 1] = dy; nrm[p * 3 + 2] = dz;
          rad[p] = r;
          mittelZ += dz * r;
        }
        spitze[p] = k / (K - 1);
        p++;

        if (koerper === 2) continue;   // der Stamm ist oben schon weitergelaufen

        // Einen Schritt weiterlaufen: irgendeine Richtung senkrecht zu d
        // suchen, daraus eine Tangentialbasis bauen, um "winkel" drehen.
        var ax = Math.abs(dx) < 0.8 ? 1 : 0, ay = Math.abs(dx) < 0.8 ? 0 : 1;
        var t1x = ay * dz, t1y = -ax * dz, t1z = ax * dy - ay * dx;
        var l1 = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1e-6;
        t1x /= l1; t1y /= l1; t1z /= l1;
        var t2x = dy * t1z - dz * t1y, t2y = dz * t1x - dx * t1z, t2z = dx * t1y - dy * t1x;
        var cw = Math.cos(winkel), sw2 = Math.sin(winkel);
        var gx = t1x * cw + t2x * sw2, gy = t1y * cw + t2y * sw2, gz = t1z * cw + t2z * sw2;
        dx += gx * schritt; dy += gy * schritt; dz += gz * schritt;
        var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        dx /= dl; dy /= dl; dz /= dl;
        winkel += dreh + (rausch(dx * 3.3 + 19, dy * 3.3 + 29, dz * 3.3 + 37) - 0.5) * 0.55;
      }

      // Die Impulsachse laeuft von hinten nach vorn. Daran haengt, wann eine
      // Denkwelle diesen Faden erreicht — dadurch WANDERT der Impuls sichtbar
      // durchs Netz, statt dass alles gleichzeitig blinkt.
      fLage[i] = (mittelZ / K + 1.15) / 2.3;
    }
  })();

  // Glutzonen: feste Punkte IM Gehirn, die durch das Fadenwerk scheinen.
  // Sie drehen mit, deshalb liegen sie in Modellkoordinaten.
  //
  // Bis zum 19.08. waren es fuenf weiche, grosse Hoefe — im Bild ergab das
  // einen gleichmaessigen Schimmer statt der hellen, fast weissen Kerne der
  // Referenz. Jetzt sind es sieben KLEINE Kerne mit hartem Zentrum: sie
  // liegen tief genug (Radius < 0,45), dass immer Fadenwerk davor haengt.
  //
  // Und sie sitzen ABSICHTLICH unsymmetrisch. Zwei gleich helle Kerne links
  // und rechts auf gleicher Hoehe lasen sich im ersten Versuch als Augenpaar —
  // ein Gesicht, wo ein Praeparat stehen soll. Keine zwei Kerne spiegeln sich
  // jetzt noch in x.
  var GLUT = [
    { x: 0.26, y: 0.06, z: 0.22, g: 1.00 },
    { x: -0.20, y: -0.03, z: -0.06, g: 0.84 },
    { x: 0.04, y: -0.11, z: -0.33, g: 0.76 },
    { x: 0.17, y: 0.25, z: -0.13, g: 0.60 },
    { x: -0.30, y: 0.15, z: 0.29, g: 0.70 },
    { x: -0.08, y: -0.26, z: 0.31, g: 0.48 },
    { x: 0.29, y: -0.15, z: -0.25, g: 0.42 },
  ];

  // ---------------------------------------------------------- Zustaende
  //
  // Jeder Zustand ist ein Satz Zahlen. Zwischen zwei Zustaenden wird
  // GEGLAETTET (siehe naehern()) — ein harter Sprung sieht im Video nach
  // Fehler aus, ein Uebergang nach Reaktion.
  //
  //   dreh    Drehung um die Hochachse, Bogenmass je Sekunde
  //   atmen   globale Groessenaenderung, atemHz deren Takt
  //   grund   Grundhelligkeit der Faeden
  //   tilgen  wie stark der Grund je Bild uebermalt wird.
  //           KLEIN = lange Nachleuchtspur (Kometenschweife beim Denken)
  //   impuls  Staerke der Helligkeitswelle, tempo/breite ihr Lauf
  //   aussen  wie weit sich die Fadenspitzen nach aussen richten (mit Pegel)
  //   welle   Ringwelle vom Kern nach aussen (mit Pegel)
  //   kuehl   -1 entsaettigt (Pause), 0 unser Blau, +1 Richtung Cyan
  //   glut    Helligkeit der inneren Glutzonen

  var Z = {
    ruhe: { dreh: 0.052, atmen: 0.020, atemHz: 0.13, grund: 0.44, tilgen: 0.34, impuls: 0.45, tempo: 0.16, dichte: 1.0, breite: 0.30, aussen: 0.00, welle: 0.00, kuehl: 0.00, glut: 0.98 },
    // lauschen bekam am 19.08. eine eigene Ringwelle (0.55). Vorher war welle
    // hier 0 — die Stimme des Sprechenden bewegte also nichts ausser den
    // Fadenspitzen, und das sah man aus zwei Metern nicht.
    lauschen: { dreh: 0.028, atmen: 0.012, atemHz: 0.34, grund: 0.54, tilgen: 0.32, impuls: 0.34, tempo: 0.46, dichte: 1.4, breite: 0.40, aussen: 0.75, welle: 0.18, kuehl: 0.55, glut: 0.90 },
    // "denken" war bis 19.08. der lauteste Zustand: 3,4 gleichzeitige Impulse,
    // schmal (0.11) und schnell (1.55) — das las sich nicht als Nachdenken,
    // sondern als Flimmern. Lukas: "zu wuselig, zu hektisch".
    //
    // Umgestellt auf WENIGE, BREITE, LANGSAME Wellen: ein Drittel der Impulse,
    // doppelt so breit, halbes Tempo, halbe Drehung. Damit wandert sichtbar
    // etwas durch das Fadenwerk, statt dass es zuckt. Die Nachleuchtspur ist
    // kuerzer (tilgen hoeher) — lange Schweife waren der zweite Grund fuers
    // Gewusel, weil sich alte und neue Impulse ueberlagerten.
    denken: { dreh: 0.105, atmen: 0.010, atemHz: 0.38, grund: 0.50, tilgen: 0.30, impuls: 0.62, tempo: 0.58, dichte: 1.15, breite: 0.30, aussen: 0.00, welle: 0.00, kuehl: -0.15, glut: 0.84 },
    sprechen: { dreh: 0.095, atmen: 0.024, atemHz: 0.55, grund: 0.58, tilgen: 0.30, impuls: 0.55, tempo: 0.75, dichte: 1.2, breite: 0.34, aussen: 0.22, welle: 0.42, kuehl: 0.18, glut: 1.00 },
    pause: { dreh: 0.009, atmen: 0.004, atemHz: 0.07, grund: 0.24, tilgen: 0.44, impuls: 0.08, tempo: 0.10, dichte: 1.0, breite: 0.50, aussen: 0.00, welle: 0.00, kuehl: -1.00, glut: 0.26 },
  };

  var ziel = Z.ruhe;
  var P = {};
  for (var sch in Z.ruhe) P[sch] = Z.ruhe[sch];

  function zustandSetzen(z) {
    ziel = Z[z] || (z === "hoeren" ? Z.lauschen : Z.ruhe);
    buehne.setAttribute("data-zustand", z);
  }
  zustandSetzen(kugel.getAttribute("data-zustand") || "ruhe");

  // public/sprache.js schreibt data-zustand — das ist die einzige Quelle.
  new MutationObserver(function () {
    zustandSetzen(kugel.getAttribute("data-zustand") || "ruhe");
  }).observe(kugel, { attributes: true, attributeFilter: ["data-zustand"] });

  // ------------------------------------------------------------- Pegel
  //
  // public/sprache.js haengt beim Lauschen das Mikro und beim Sprechen
  // Alexandras Stimme an einen Analyser und schreibt das Frequenzband Bild
  // fuer Bild als style.transform="scale(...)" auf die .pegel-Linien in
  // #kugel. Die Linien sind hier unsichtbar (0x0 px) — sie sind nur noch die
  // Leitung. So bleibt public/sprache.js unangetastet.

  var pegelLinien = kugel.querySelectorAll(".pegel");
  var balken = buehne.querySelectorAll(".gh-pegel span");
  var pegel = 0, pegelTief = 0;

  // Der Ausschlag der Signalbalken wird nur noch bei jedem ZWEITEN Bild
  // geschrieben (19.08.). Sie sind Beiwerk am unteren Rand; ob sie mit 60 oder
  // 30 Bildern zappeln, sieht niemand — die Haelfte der DOM-Arbeit im
  // Pegel-Pfad dagegen schon.
  var balkenTakt = 0;

  function pegelLesen() {
    // Erster Weg: die Frequenzdaten direkt aus public/sprache.js. Kein DOM,
    // kein Textparsen — nur ein Byte-Feld lesen.
    var d = window.__pegelDaten;
    var n = d && d.length ? Math.min(d.length, 40) : pegelLinien.length;
    if (!n) return 0;
    var malen = (++balkenTakt & 1) === 0;
    var summe = 0, tief = 0, tn = 0;
    for (var i = 0; i < n; i++) {
      var v;
      if (d) {
        v = d[i] / 255;
      } else {
        // Rueckfall auf die alte Leitung ueber die SVG-Linien. Bleibt drin,
        // damit das Gehirn auch dann etwas anzeigt, wenn sprache.js nicht
        // laedt oder eine aeltere Fassung ausgeliefert wird.
        var t = pegelLinien[i].style.transform;
        v = t ? (parseFloat(t.slice(6)) - 1) / 1.5 : 0;
      }
      if (!(v > 0)) v = 0; else if (v > 1) v = 1;
      summe += v;
      if (i < 10) { tief += v; tn++; }
      // scaleY statt height: siehe Begruendung in public/jarvis-gehirn.css.
      if (malen && i < balken.length) {
        balken[i].style.transform = "scaleY(" + (0.08 + v * 0.92).toFixed(3) + ")";
      }
    }
    if (malen) {
      for (var j = n; j < balken.length; j++) balken[j].style.transform = "scaleY(.08)";
    }
    pegelTief = tn ? tief / tn : 0;
    return summe / n;
  }

  // ---------------------------------------------------------- Leinwand

  var breite = 0, hoehe = 0, dpr = 1, mitteX = 0, mitteY = 0, MASS = 1;

  function messen() {
    var r = buehne.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // Pixeldichte. Der groesste Hebel fuer die Fluessigkeit ueberhaupt — und
    // am 19.08. der Grund fuers Ruckeln: Auf einem Retina-Bildschirm stand
    // hier 2, also die VIERFACHE Flaeche. Gemessen wurden dabei 8 bis 14
    // Bilder je Sekunde.
    //
    // Ein Fadenwerk aus weichen, additiv gezeichneten Strichen gewinnt durch
    // die doppelte Dichte fast nichts — es gibt keine harten Kanten, die
    // schaerfer wuerden. Deshalb 1.35 als Obergrenze und 1.15 auf grossen
    // Flaechen. Das spart rund die Haelfte der zu fuellenden Pixel und ist im
    // Bild nicht zu unterscheiden.
    var flaeche = r.width * r.height;
    dpr = Math.min(window.devicePixelRatio || 1, flaeche > 1.6e6 ? 1.15 : 1.35);
    breite = r.width; hoehe = r.height;
    leinwand.width = Math.round(breite * dpr);
    leinwand.height = Math.round(hoehe * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Das Gehirn soll rund 60 % der Bildhoehe fuellen. Seine Hoehe in
    // Modellmass ist 2 * 0.70 = 1.4, daher MASS = 0.60 * hoehe / 1.4.
    MASS = Math.min(hoehe * 0.405, breite * 0.250);

    // Mittelpunkt ist die Mitte der freien Zeile zwischen Kopf und Fuss —
    // nicht die Mitte der Buehne. Sonst schoebe die Bedienleiste das Gehirn
    // optisch nach oben aus dem Bild.
    var m = buehne.querySelector(".gh-mitte");
    var mr = m ? m.getBoundingClientRect() : r;
    mitteX = mr.left - r.left + mr.width / 2;
    mitteY = mr.top - r.top + mr.height / 2;

    // Der Klickbereich folgt dem, was man sieht. Ohne das klickt man auf
    // einer 4K-Anzeige neben das Gehirn ins Leere.
    var kb = Math.min(MASS * 2.35, breite * 0.86);
    var kh = Math.min(MASS * 1.75, mr.height * 0.98);
    kugel.style.width = Math.round(kb) + "px";
    kugel.style.height = Math.round(kh) + "px";

    ctx.fillStyle = "#04070E";
    ctx.fillRect(0, 0, breite, hoehe);
  }

  messen();
  if (window.ResizeObserver) new ResizeObserver(messen).observe(buehne);
  else window.addEventListener("resize", messen);

  // -------------------------------------------------------- Zeichnen

  var NB = 8;                       // Helligkeitsstufen (= stroke-Aufrufe)
  var stufeFarbe = new Array(NB);
  var stufeBreit = new Float32Array(NB);
  var pfade = new Array(NB);
  var stufenStand = 99;             // fuer welches "kuehl" die Farben gelten

  // Arbeitsspeicher fuer EINEN Faden. Steht hier oben, damit nicht 60-mal je
  // Sekunde 1.650 kurzlebige Arrays entstehen — das waere die Sorte Muell,
  // die eine Seite nach zwei Stunden ruckeln laesst.
  var punkteX = new Float32Array(K), punkteY = new Float32Array(K);

  function stufenBauen(kuehl) {
    // Von tiefem Blau bis fast Weiss. Bei kuehl < 0 wird entsaettigt (Pause),
    // bei kuehl > 0 dreht der Ton Richtung Cyan (Lauschen).
    for (var i = 0; i < NB; i++) {
      var t = i / (NB - 1);
      var r = 46 + 168 * t * t;
      var g = 118 + 116 * t;
      var b = 232 + 24 * t;
      if (kuehl > 0) { g += 26 * kuehl * (1 - t * 0.5); r -= 22 * kuehl * (1 - t * 0.5); }
      if (kuehl < 0) {
        var d = -kuehl, grau = 0.30 * r + 0.59 * g + 0.11 * b;
        r += (grau * 0.92 - r) * d; g += (grau * 0.96 - g) * d; b += (grau * 1.02 - b) * d;
      }
      // Deckkraft und Strichbreite haengen an der Fadenzahl: mit dem
      // Zweieinhalbfachen an Faeden ergaebe die alte Kurve eine blaue Flaeche
      // statt eines Praeparats. Duenner und blasser — die DICHTE macht die
      // Helligkeit, nicht der einzelne Strich.
      var alpha = 0.050 + 0.52 * Math.pow(t, 1.42);
      stufeFarbe[i] = "rgba(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + "," + alpha.toFixed(3) + ")";
      stufeBreit[i] = 0.46 + 0.80 * t;
    }
  }

  // Startlage der Kamera. Bei gier = 0 blickte man dem Gehirn frontal ins
  // Gesicht — und von vorn ist es rund, da sieht man weder die Laenge noch
  // die Laengsfurche. Aus knapp 55 Grad Dreiviertelansicht liest die Form
  // sofort. Die Neigung ist POSITIV: wir schauen leicht von oben darauf, sonst
  // liegt die Furche auf der abgewandten Seite.
  var zeit = 0, gier = -0.95, aufbau = sanft ? 1 : 0, letzte = 0, laeuft = 0;
  var bildZeit = 16, bildAbstand = 16.7, anteil = 1;   // Notbremse: Anteil der gezeichneten Faeden

  function naehern(k, dt) {
    var f = 1 - Math.exp(-dt / 0.30);
    P[k] += (ziel[k] - P[k]) * f;
  }

  function bild(jetzt) {
    laeuft = requestAnimationFrame(bild);
    var dt = letzte ? Math.min((jetzt - letzte) / 1000, 0.05) : 0.016;
    letzte = jetzt;
    if (!breite || !hoehe) return;

    var t0 = performance.now();

    for (var k in ziel) naehern(k, dt);

    var roh = pegelLesen();
    // Anstieg schnell, Abfall traege: so zuckt das Gehirn auf ein Wort an und
    // faellt danach weich zurueck, statt zu flimmern.
    //
    // Am 19.08. nachgezogen (Wunsch Lukas: "wenn man mit Alexandra redet, soll
    // es sich bewegen"): Der Abfall lag bei 0.07 und war damit so traege, dass
    // zwischen zwei Woertern nichts zurueckschwang — das Gehirn stand auf einem
    // Mittelwert, statt zu atmen. Anstieg noch etwas schneller, Abfall knapp
    // doppelt so flott. Kostet nichts: es sind Zahlen, keine Striche.
    pegel += (roh - pegel) * (roh > pegel ? 0.55 : 0.13);

    if (!sanft) {
      zeit += dt;
      gier += P.dreh * dt;
      if (aufbau < 1) aufbau = Math.min(1, aufbau + dt / 1.9);
    }
    // Erwachen: exponentiell ausklingend aus einer Streuwolke heraus.
    var e = aufbau >= 1 ? 1 : 1 - Math.pow(2, -10 * aufbau);
    var restE = 1 - e;

    // ---- Grund. Kein clearRect: die halbdurchsichtige Flaeche laesst eine
    // Nachleuchtspur stehen. Beim Denken ist sie lang (Kometenschweife),
    // in der Pause kurz (das Bild steht).
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(4,7,14," + P.tilgen.toFixed(3) + ")";
    ctx.fillRect(0, 0, breite, hoehe);
    ctx.globalCompositeOperation = "lighter";

    // Der Pegel-Anteil lag bis 19.08. bei 0.030 und haing ausserdem allein an
    // P.welle — also nur waehrend SIE spricht. Wer selbst redete, sah das
    // Gehirn unbewegt. Jetzt atmet es in jedem Zustand mit der Stimme mit
    // (Grundanteil 0.40), und der Ausschlag ist rund dreimal so gross.
    var atem = 1 + P.atmen * sinL(zeit * P.atemHz * TAU)
      + 0.150 * pegel * (0.55 + P.welle);
    var neige = 0.34 + (sanft ? 0 : 0.045 * sinL(zeit * 0.055 * TAU));
    var cg = Math.cos(gier), sg = Math.sin(gier);
    var cn = Math.cos(neige), sn = Math.sin(neige);
    var FOV = 4.2;

    // ---- Glutzonen zuerst: sie liegen HINTER dem Fadenwerk und scheinen
    // hindurch. Genau der Eindruck aus der Referenz.
    // Die Glut folgt den tiefen Frequenzen — das ist der Teil, den man beim
    // Sprechen am staerksten sieht. Vorher 0.80 + 0.40: der Unterschied
    // zwischen Stille und Rede betrug ein Drittel und ging im Leuchten unter.
    // Jetzt schlaegt sie gut doppelt so weit aus.
    var glutStark = P.glut * (0.55 + 1.35 * pegelTief) * e;
    for (var q = 0; q < GLUT.length; q++) {
      var G = GLUT[q];
      var gx1 = G.x * cg + G.z * sg, gz1 = -G.x * sg + G.z * cg;
      var gy2 = G.y * cn - gz1 * sn, gz2 = G.y * sn + gz1 * cn;
      var gs = FOV / (FOV - gz2);
      var sx = mitteX + gx1 * atem * MASS * gs;
      var sy = mitteY - gy2 * atem * MASS * gs;
      var puls = 0.72 + 0.28 * sinL((zeit * (0.21 + q * 0.06) + q * 0.37) * TAU);
      var rr = MASS * (0.21 + 0.17 * G.g) * gs * (0.9 + 0.2 * puls);
      var st = glutStark * G.g * puls;
      if (st <= 0.01) continue;
      // Vier Stufen statt drei: ein fast weisser Kern, ein enger heller Hof,
      // ein weiter blauer Abfall, dann nichts. Das ist der Unterschied
      // zwischen "leuchtet von innen" und "ist blau angehaucht".
      var vl = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
      vl.addColorStop(0, "rgba(226,240,255," + (0.60 * st).toFixed(3) + ")");
      vl.addColorStop(0.16, "rgba(168,206,255," + (0.38 * st).toFixed(3) + ")");
      vl.addColorStop(0.42, "rgba(84,144,246," + (0.14 * st).toFixed(3) + ")");
      vl.addColorStop(1, "rgba(37,99,235,0)");
      ctx.fillStyle = vl;
      ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
    }

    // ---- Die Faeden.
    if (Math.abs(P.kuehl - stufenStand) > 0.01) { stufenBauen(P.kuehl); stufenStand = P.kuehl; }
    for (var b0 = 0; b0 < NB; b0++) pfade[b0] = new Path2D();

    // Fadenspitzen und Ringwelle: beide ebenfalls angehoben (19.08.). Die
    // Ringwelle hatte einen Grundanteil von 0.014, der auch bei Stille lief —
    // dadurch war kaum zu unterscheiden, ob gerade jemand spricht. Der Grund
    // ist jetzt kleiner, der Pegel-Anteil deutlich groesser.
    var aussenA = P.aussen * (0.15 + 1.10 * pegel);
    var welleA = P.welle * (0.008 + 0.120 * pegel);
    var wellT = zeit * 6.4;
    var impT = zeit * P.tempo;
    var grundH = P.grund * (0.12 + 0.88 * e);
    var zeichen = (anteil >= 1 ? nF : Math.max(1, (nF * anteil) | 0));

    for (var i = 0; i < zeichen; i++) {
      // --- Helligkeit dieses Fadens: Grundwert, Tiefenlage, Impulswelle.
      var ph = impT - fLage[i] * P.dichte + fPhase[i] * 0.05;
      ph -= Math.floor(ph);
      var d = ph < 0.5 ? ph : 1 - ph;
      var stoss = Math.exp(-(d * d) / (P.breite * P.breite));
      var hell = grundH * (0.40 + 0.60 * fSchale[i]) *
        (1 + P.impuls * stoss) *
        (1 + 0.16 * sinL((zeit * 0.9 + fPhase[i]) * TAU));

      // Beim Erwachen dreht jeder Faden aus einer eigenen Lage herein.
      var ci = cg, si = sg;
      if (restE > 0.001) {
        var w = gier + fSpin[i] * restE;
        ci = Math.cos(w); si = Math.sin(w);
      }
      var weit = restE > 0.001 ? 1 + fWeit[i] * restE : 1;

      var basis = i * K, zSum = 0;
      for (var k2 = 0; k2 < K; k2++) {
        var pi = basis + k2, p3 = pi * 3;
        var r0 = rad[pi];
        var rr2 = r0 * atem * weit;
        // LAUSCHEN: die Spitzen richten sich nach aussen, die Wurzel bleibt.
        if (aussenA > 0) rr2 *= 1 + aussenA * (0.06 + 0.50 * spitze[pi] * spitze[pi]);
        // SPRECHEN: eine Ringwelle laeuft vom Kern nach aussen.
        if (welleA > 0) rr2 += welleA * sinL(r0 * 9.0 - wellT);

        var x = nrm[p3] * rr2, y = nrm[p3 + 1] * rr2, z = nrm[p3 + 2] * rr2;
        var x1 = x * ci + z * si, z1 = -x * si + z * ci;   // Gierung um die Hochachse
        var y2 = y * cn - z1 * sn, z2 = y * sn + z1 * cn;  // Neigung nach vorn
        var sk = FOV / (FOV - z2);                         // Zentralperspektive
        punkteX[k2] = mitteX + x1 * MASS * sk;
        punkteY[k2] = mitteY - y2 * MASS * sk;
        zSum += z2;
      }

      // Tiefenwirkung: was vorn liegt, ist heller.
      var tiefe = 0.55 + 0.225 * (zSum / K + 1);
      var stufe = (hell * tiefe * NB) | 0;
      if (stufe < 0) stufe = 0; else if (stufe > NB - 1) stufe = NB - 1;

      // Der Faden wird als Kette quadratischer Kurven durch die Mittelpunkte
      // gelegt. Als gerade Strecken bekaeme er bei acht Punkten sichtbare
      // Knicke — und die Referenz kennt nur weiche, gekruemmte Faeden.
      var pfad = pfade[stufe];
      pfad.moveTo(punkteX[0], punkteY[0]);
      for (var k3 = 1; k3 < K - 1; k3++) {
        pfad.quadraticCurveTo(punkteX[k3], punkteY[k3],
          (punkteX[k3] + punkteX[k3 + 1]) * 0.5, (punkteY[k3] + punkteY[k3 + 1]) * 0.5);
      }
      pfad.lineTo(punkteX[K - 1], punkteY[K - 1]);
    }

    // Zwei Durchgaenge auf DENSELBEN Pfaden: erst breit und schwach (das ist
    // der Schein), dann schmal und hell (das ist der Faden). Zusammen ergibt
    // das den Eindruck von Licht, ohne einen teuren Weichzeichner.
    // Der Schein liegt nur noch auf den drei hellsten Stufen und ist schmaler
    // als vorher. Grund ist gemessen, nicht geschmacklich: ein breiter Strich
    // kostet Flaeche, und Flaeche ist bei dieser Fadenzahl das, was die
    // Bildrate frisst — drei Stufen a 3,2 statt vier a 4,2 kosten rund ein
    // Drittel weniger und sehen im Bild gleich aus.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (var b1 = 5; b1 < NB; b1++) {
      ctx.strokeStyle = stufeFarbe[b1];
      ctx.lineWidth = stufeBreit[b1] * 3.6;
      ctx.globalAlpha = 0.24;
      ctx.stroke(pfade[b1]);
    }
    ctx.globalAlpha = 1;
    for (var b2 = 0; b2 < NB; b2++) {
      ctx.strokeStyle = stufeFarbe[b2];
      ctx.lineWidth = stufeBreit[b2];
      ctx.stroke(pfade[b2]);
    }

    ctx.globalCompositeOperation = "source-over";

    // ---- Notbremse. Bounded heisst: die Menge kann nur sinken und wieder
    // bis 100 % zurueckkehren, nie darueber.
    //
    // Gemessen wird der ABSTAND ZWEIER BILDER, nicht mehr die Rechenzeit. Am
    // 19.08. gemessen: bei 13.000 Faeden brauchte das Rechnen 5 ms, das Bild
    // aber 26 — die Zeit steckt im Zeichnen der Striche, nicht im Rechnen.
    // Eine Bremse, die nur die Rechenzeit ansieht, loest darum nie aus,
    // waehrend die Seite sichtbar ruckelt. Die Rechenzeit bleibt als Ablesung
    // in window.__gehirn stehen, sie ist beim Nachmessen nuetzlich.
    bildZeit += (performance.now() - t0 - bildZeit) * 0.05;
    if (dt > 0) bildAbstand += (dt * 1000 - bildAbstand) * 0.04;
    window.__gehirn = { bildZeit: bildZeit, bildAbstand: bildAbstand, anteil: anteil, faeden: nF };
    // Die Bremse zieht ab 19.08. frueher, haerter und tiefer (Wunsch Lukas:
    // "es darf nicht leggen"). Vorher regelte sie mit 0.015 je Bild herunter
    // und stoppte bei 45 % der Faeden: Auf einem ausgelasteten Rechner
    // brauchte sie ueber eine Sekunde bis zur Wirkung — genau die Sekunde, in
    // der man das Ruckeln sieht. Jetzt greift sie in etwa einem Drittel der
    // Zeit und darf bis auf 25 % heruntergehen. Hoch geht es weiter langsam:
    // ein Bild, das zwischen dicht und duenn hin- und herspringt, ist
    // schlimmer als ein dauerhaft duenneres.
    // Zweistufig (19.08.): Bei leichtem Ruecklauf wird sanft ausgeduennt, bei
    // echtem Ruckeln (ueber 28 ms, also unter 36 Bildern je Sekunde) faellt
    // die Dichte sofort in grossen Schritten. Vorher regelte eine einzige
    // sanfte Stufe, und auf einem ausgelasteten Rechner dauerte der Weg von
    // voller auf halbe Dichte laenger als die Geduld des Zuschauers.
    // Untergrenze 0.16: Ein duenneres Gehirn ist immer noch ein Gehirn, ein
    // ruckelndes ist unbrauchbar.
    if (bildAbstand > 28 && anteil > 0.16) anteil = Math.max(0.16, anteil - 0.10);
    else if (bildAbstand > 19.5 && anteil > 0.16) anteil = Math.max(0.16, anteil - 0.035);
    else if (bildAbstand < 16.8 && anteil < 1) anteil = Math.min(1, anteil + 0.005);
  }

  // ----------------------------------------------------------- Steuerung

  function starten() {
    if (laeuft) return;
    letzte = 0;
    laeuft = requestAnimationFrame(bild);
  }
  function anhalten() {
    if (!laeuft) return;
    cancelAnimationFrame(laeuft);
    laeuft = 0;
  }

  // Im Hintergrund wird nichts gerechnet. Die Seite steht auf dem Bildschirm
  // im Buero den ganzen Tag offen — ohne das laeuft der Luefter mit.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) anhalten(); else starten();
  });

  if (!document.hidden) starten();
})();
