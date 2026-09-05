<!-- Herkunft: Design-Leitfaden vom 05.09.2026, erstellt beim Umbau auf das Bausteinsystem os-ui. Die dort erwähnte Demo-Seite liegt nicht im Repo. -->
# Design-Leitfaden „os-ui" — die Bausteine für alle neuen Seiten (Stand 05.09.2026)

Datei: `public/os-ui.css` (additiv über `crm.css`, Präfix `os-`). **Global geladen** — `lib/schale.js` bindet sie direkt nach `/crm.css` und `/style.css` ein, mit Cache-Stempel `v("/os-ui.css")`. Kein Modul muss sie selbst verlinken. Eigene Bereichs-Klassen (`.akte-…`, `.buch-…`, `.kal-…`) kommen weiterhin in `public/<bereich>.css` und werden im `inhalt` per `<link rel="stylesheet" href="${v("/<bereich>.css")}">` eingebunden (Muster `lib/whiteboard-routes.js:294`).

Demo mit jedem Baustein: `scratchpad/design/demo.html` (hell/dunkel als Screenshot daneben: `demo_hell.png`, `demo_dunkel.png`, `demo_graphit.png`).

---

## 1. Die fünf Grundsätze (Lukas: „Orientierung Apple")

1. **Gruppe statt Karte.** Zusammengehörige Felder stehen als *eingelassene Liste* (`.os-gruppe`) mit Zeilen untereinander — nicht als Karte mit Kästen-Formular. Eine Gruppe hat 3–7 Zeilen. Mehr → zweite Gruppe. Viele Gruppen → Kategorien per `.os-segment`.
2. **Beschriftung oben, Wert darunter.** Jede Zeile trägt eine kleine, sekundäre Beschriftung (12 px) und darunter den Wert oder das Feld (14 px). Felder sind randlos; die Zeile ist das Feld.
3. **Genau eine Primäraktion je Seite** — dunkel (`button.dunkel`), rechts oben in `.os-kopf-aktionen` oder `.os-werkzeugleiste-aktionen`. Alles andere `.sekundaer` (Rand) oder `.still` (ohne Fläche).
4. **Leerzustände sind gestaltet** und sagen, was zu tun ist: `.os-leer` mit Satz und einem Knopf, oder `data-leer="Noch nicht eingetragen"` in der Zeile. Nie eine leere weiße Fläche, nie „0" ohne Zusammenhang.
5. **Ruhe.** 8-px-Raster, eine Schattenstufe, Trennlinien statt Kästen, keine Großbuchstaben, keine Balken-Hinweise. Zahlen `tabular-nums` (erbt sich von `body`), Datum `05.09.2026`, Geld `1.250,00 €`.

**Do/Don't am Ist-Stand** (`scratchpad/shots/`):
- `kundenakte_voll.png` — elf verschieden hohe Karten in drei Spalten, ~40 Felder auf einmal, Knöpfe „+" ohne Wort, Datumsfelder in Monospace. **Stattdessen:** `.os-kopf` mit Name, Pillen (Kunde · Webdesign) und *einem* „Speichern"; darunter `.os-segment` (Stammdaten · Auftrag · Stand · Dokumente · Verlauf); je Kategorie 2–4 Gruppen à 3–6 Zeilen in `.os-breite-mittel`.
- `form_kunde_neu.png` — Dialog mit acht gleich wichtigen Kästen. **Stattdessen:** `.os-blatt` mit zwei Gruppen („Firma", „Zuständigkeit"), Pflichtfeld zuerst, Fuß „Abbrechen · Kunden anlegen".
- `buchhaltung.png` — zwei graue Balken-Hinweise übereinander, Zeitraum-Schiene und Aktionen versetzt. **Stattdessen:** ein `.os-hinweis` (einzeilig, mit Aktion rechts), eine `.os-werkzeugleiste` mit `.os-segment` links und Aktionen rechts.
- `crm_kunden.png` — Leerzustand als riesige Karte mit dem Tabellentitel. **Stattdessen:** `.os-leer` („Noch keine Kunden. Leg den ersten an — oder wandle einen Lead um.") mit Knopf.
- `kalender.png` — Termin-Details fehlen ganz. **Dafür:** `.os-popover--ohne-zipfel`, frei positioniert (Kopf = Titel, Rumpf = Zeit/Ort/Teilnehmer, Fuß = Öffnen · Löschen).

---

## 2. Maße und Marken

| Was | Wert |
|---|---|
| Schriftgrößen | 11 Fußnoten · 12 Beschriftungen/Hilfen · 13 Nebentext/Segment · 14 Werte, Fließtext · 16 Bereichstitel · 18 Blatt-Titel · 24 Kennzahl · 26 Seitentitel |
| Gewichte | 400 Text · 500 Beschriftung · 600 Titel/Knöpfe · 650 Zahlen/Seitentitel |
| Radien | 10 px Hinweise/Segmente · 14 px Gruppen, Kacheln, Tabellen · 16 px Blatt · 99 px Pillen/Chips/Schalter |
| Höhen | Knopf 36 px · Feld 36 px · Zeile ≥ 56 px · Segment 30 px · Pille 22 px · Chip 30 px · Schalter 44×26 |
| Schatten | `--s1` für liegende Flächen, `--s3` nur für Blatt und Popover. Sonst Ränder. |
| Abstände | Gruppe zu Gruppe 22 px · Zeile innen 9/16 px · Kacheln 12 px · Spalten 24 px |

**Farben nur über Marken** aus `crm.css` (`--foreground`, `--text-secondary`, `--text-muted`, `--primary`, `--success`, `--warning`, `--danger`, `--info` + `*-flaeche`, `--border`, `--border-stark`). Damit laufen Hell, Dunkel, Graphit (`body.crm-dashboard-design` — bekommen alle Seiten, deren `aktiv` mit `crm|buchhaltung|content|zentrale` beginnt, also auch To-Dos und Whiteboard) und Weiß automatisch mit.

**Flache Flächen:** Im Graphit-Design sind `--surface`, `--surface-2`, `--background` Verläufe. Für Zeilen, Hover, Schienen, Blatt-Rumpf nimmt man deshalb die flachen Marken aus `os-ui.css` — auch im eigenen Bereichs-CSS:

| Marke | Zweck |
|---|---|
| `--os-flaeche` | Gruppen, Kacheln, Tabellen, Blatt, Dialoge |
| `--os-flaeche-2` | Hover-Fläche, Hinweise, eingelassene Flächen |
| `--os-flaeche-3` | Schienen (Segment, Schalter, Fortschritt), graue Pillen |
| `--os-hebung` | das erhobene Stück: aktives Segment, Popover |
| `--os-grund` | flacher Seitengrund (Blatt-Rumpf) |
| `--os-trenner` | Linie zwischen Zeilen (heller als `--border`) |
| `--os-r` 14 px · `--os-r-klein` 10 px · `--os-r-blatt` 16 px · `--os-hoehe` 36 px | Radien, Knopfhöhe |

**Icons:** wie überall `ICON.*` bzw. `S()` aus `lib/schale.js` (24er-Viewbox, Strich 1.8). In `.os-hinweis`, `.os-leer-icon`, `.os-zeile-icon`, Knöpfen werden sie automatisch auf 14–20 px skaliert.

---

## 3. Die Bausteine

### 3.1 `.os-kopf` — Seitenkopf (Akte, Rechnung, Beleg)

Der Titel ist der **Name der Sache**, nicht der Bereich (den zeigt die Topbar). Pillen tragen den Zustand. Rechts die Aktionen, genau eine dunkel.

```html
<header class="os-kopf">
  <a class="os-kopf-zurueck" href="/crm/kunden">Kunden</a>
  <div class="os-kopf-zeile">
    <div class="os-kopf-text">
      <div class="os-kopf-avatar">TS</div>                       <!-- optional; oder <img> -->
      <div>
        <h1 class="os-kopf-titel">Testpraxis Sonnenhof</h1>
        <p class="os-kopf-unter">Physiotherapie · Dorfen · Anna Weber</p>
        <div class="os-kopf-pillen">
          <span class="os-pille os-pille--gruen os-pille--punkt">Kunde</span>
          <span class="os-pille">Webdesign</span>
          <span class="os-pille os-pille--bernstein">Rechnung offen</span>
        </div>
      </div>
    </div>
    <div class="os-kopf-aktionen">
      <button type="button" class="sekundaer">${ICON.telefon} Anrufen</button>
      <button type="submit" form="akte-form" class="dunkel">Speichern</button>
    </div>
  </div>
</header>
```

### 3.2 `.os-unternav` — Reiter unter dem Seitenkopf

Für `schale({ reiter })` — sitzt dann zwischen Topbar und `main`. Steht sie **in** `main` (z. B. unter `.os-kopf`), fällt der Außenabstand automatisch weg. Kein Umbruch; auf schmalen Schirmen scrollt sie waagerecht. Zähler als `<small>`.

```html
<nav class="os-unternav" aria-label="Bereiche der Akte">
  <a href="/crm/firma/12" class="aktiv" aria-current="page">Übersicht</a>
  <a href="/crm/firma/12/belege">Belege <small>3</small></a>
  <a href="/crm/firma/12/rechnungen">Rechnungen</a>
  <a href="/crm/firma/12/verlauf">Verlauf</a>
</nav>
```

### 3.3 `.os-werkzeugleiste` — Kopfzeile eines Bereichs

```html
<div class="os-werkzeugleiste">
  <h2 class="os-werkzeugleiste-titel">Rechnungen
    <span class="os-werkzeugleiste-unter">12 offen · 48.200 € ausstehend</span></h2>
  <div class="os-werkzeugleiste-aktionen">
    <div class="os-segment" role="tablist" aria-label="Zeitraum">
      <a href="?zeitraum=monat" class="aktiv">Monat</a><a href="?zeitraum=quartal">Quartal</a><a href="?zeitraum=jahr">Jahr</a>
    </div>
    <button type="button" class="sekundaer">Exportieren</button>
    <button type="button" class="dunkel" onclick="document.getElementById('blatt-neu').showModal()">${ICON.plus} Rechnung stellen</button>
  </div>
</div>
```

### 3.4 `.os-segment` — Segmented Control

Umschalter zwischen **Kategorien einer Sache**. Kinder sind `<button role="tab">` (mit Skript) oder `<a>` (serverseitig, `?kategorie=`). Aktiv = `.aktiv` **oder** `aria-selected="true"`. `.os-segment--voll` verteilt die Segmente auf die ganze Breite. Bei Platznot scrollt die Schiene, nichts bricht um.

```html
<div class="os-segment" role="tablist" aria-label="Kategorie" data-os-segment>
  <button type="button" role="tab" id="tab-stamm" aria-controls="kat-stamm" aria-selected="true" class="aktiv">Stammdaten</button>
  <button type="button" role="tab" id="tab-auftrag" aria-controls="kat-auftrag" aria-selected="false" tabindex="-1">Auftrag</button>
  <button type="button" role="tab" id="tab-stand" aria-controls="kat-stand" aria-selected="false" tabindex="-1">Stand</button>
</div>
<section id="kat-stamm" role="tabpanel" aria-labelledby="tab-stamm">…Gruppen…</section>
<section id="kat-auftrag" role="tabpanel" aria-labelledby="tab-auftrag" hidden>…</section>
<section id="kat-stand" role="tabpanel" aria-labelledby="tab-stand" hidden>…</section>
```

Skript dazu (einmal je Seite, im `inhalt`; schaltet `.aktiv`, `aria-selected`, `hidden`, Pfeiltasten, merkt die Kategorie im Hash):

```html
<script>
(function(){
  document.querySelectorAll("[data-os-segment]").forEach(function(seg){
    var tabs=[].slice.call(seg.querySelectorAll("[role=tab]"));
    function waehle(tab,fokus){
      tabs.forEach(function(t){var an=t===tab;t.classList.toggle("aktiv",an);t.setAttribute("aria-selected",an);t.tabIndex=an?0:-1;
        var p=document.getElementById(t.getAttribute("aria-controls"));if(p)p.hidden=!an});
      if(fokus)tab.focus();if(tab.id)history.replaceState(null,"","#"+tab.id);
    }
    tabs.forEach(function(t,i){
      t.addEventListener("click",function(){waehle(t,false)});
      t.addEventListener("keydown",function(e){var j=e.key==="ArrowRight"?i+1:e.key==="ArrowLeft"?i-1:null;
        if(j===null)return;e.preventDefault();waehle(tabs[(j+tabs.length)%tabs.length],true)});
    });
    var start=location.hash&&seg.querySelector(location.hash);if(start)waehle(start,false);
  });
})();
</script>
```

### 3.5 `.os-gruppe` + `.os-zeile` — die eingelassene Liste (das Herzstück)

Titel klein und sekundär **über** der Fläche, rechts optional ein Werkzeug (Link oder leiser Knopf). Der Rumpf `.os-gruppe-rumpf` ist die gerundete Fläche — er darf ein `<form>` sein. Zeilen sind **Geschwister** im Rumpf (Trennlinie kommt von selbst, auch wenn ein `<input type=hidden>` dazwischen steht). Fußnote `.os-gruppe-fuss` für Erklärungen.

```html
<section class="os-gruppe">
  <div class="os-gruppe-titel">Stammdaten
    <span class="os-gruppe-werkzeug"><a href="/crm/firma/12/bearbeiten">Bearbeiten</a></span></div>
  <form class="os-gruppe-rumpf" method="post" action="/crm/firma/12/stammdaten" id="akte-form">

    <!-- Nur lesen -->
    <div class="os-zeile os-zeile--text">
      <span class="os-zeile-label">Firma</span>
      <div class="os-zeile-wert">Testpraxis Sonnenhof</div>
    </div>

    <!-- Leerer Wert: Strich oder eigener Satz -->
    <div class="os-zeile os-zeile--text">
      <span class="os-zeile-label">Kunde seit</span>
      <div class="os-zeile-wert" data-leer="Noch nicht eingetragen"></div>
    </div>

    <!-- Eingabe: Feld liegt randlos in der Zeile, Fokus hebt die Zeile hervor -->
    <label class="os-zeile os-zeile--eingabe">
      <span class="os-zeile-label">Ansprechperson</span>
      <div class="os-zeile-wert"><input name="ansprechperson" value="${e(f.ansprechperson)}" placeholder="z. B. Anna Weber"></div>
    </label>
    <label class="os-zeile os-zeile--eingabe">
      <span class="os-zeile-label">Verantwortlich</span>
      <div class="os-zeile-wert"><select name="verantwortlich">…</select></div>
      <span class="os-zeile-hilfe">Betreut den Kunden und sieht ihn in seinem CRM.</span>
    </label>
    <label class="os-zeile os-zeile--eingabe">
      <span class="os-zeile-label">Notiz</span>
      <div class="os-zeile-wert"><textarea name="notiz" rows="2" placeholder="Was man wissen sollte …"></textarea></div>
    </label>

    <!-- Paar: zwei kurze Felder nebeneinander, unter 700 px untereinander -->
    <div class="os-zeile os-zeile--eingabe os-zeile--paar">
      <label class="os-zeile-teil"><span class="os-zeile-label">Setup (einmalig)</span>
        <div class="os-zeile-wert"><input name="setup" inputmode="decimal" placeholder="0,00 €"></div></label>
      <label class="os-zeile-teil"><span class="os-zeile-label">Retainer (pro Monat)</span>
        <div class="os-zeile-wert"><input name="retainer" inputmode="decimal" placeholder="0,00 €"></div></label>
    </div>

    <!-- Chips: Mehrfachauswahl -->
    <div class="os-zeile os-zeile--chips">
      <span class="os-zeile-label">Leistungen</span>
      <div class="os-zeile-wert"><div class="os-chips">
        <label class="os-chip"><input type="checkbox" name="leistung" value="betreuung" checked> Monatliche Betreuung</label>
        <label class="os-chip"><input type="checkbox" name="leistung" value="hosting"> Hosting</label>
        <label class="os-chip"><input type="checkbox" name="leistung" value="support"> Support</label>
      </div></div>
    </div>

    <!-- Schalter: Ja/Nein -->
    <label class="os-zeile os-zeile--schalter">
      <span class="os-zeile-label">Hosten wir die Seite?<span class="os-zeile-hilfe">Wird monatlich abgerechnet.</span></span>
      <span class="os-schalter"><input type="checkbox" name="hosting" checked></span>
    </label>

    <!-- Aktion: klickbare Zeile mit Chevron -->
    <a class="os-zeile os-zeile--aktion" href="/crm/firma/12/dokumente">
      <span class="os-zeile-icon">${ICON.beleg}</span>
      <span class="os-zeile-wert">Dokumente</span>
      <span class="os-zeile-neben">4 Dateien</span>
    </a>
  </form>
  <div class="os-gruppe-fuss">Änderungen werden erst mit „Speichern" übernommen.</div>
</section>
```

Regeln für Zeilen:
- `--eingabe`: Zeile als `<label>` bauen (Klick überall fokussiert). Für `<select>` zeichnet die Zeile den Chevron selbst. Datumsfelder bekommen die Hausschrift. `disabled` graut den Wert.
- `--text`: Wert kann Links und Pillen enthalten. Leer → „—" (automatisch) oder `data-leer="…"`.
- `--paar`: beide Hälften sind `.os-zeile-teil` (je mit Label + Wert). Fokus gilt je Hälfte.
- `--chips`: jede Chip ist `<label class="os-chip">` mit einem Häkchen darin. Gewählt = gefüllt mit Haken.
- `--schalter`: Beschriftung links in Fließtextgröße, Schalter rechts. **Grün = an**, auch im Graphit-Design.
- `--aktion`: `<a>` oder `<button type="button">`; optional `.os-zeile-icon` links, `.os-zeile-neben` rechts. Für Formularaktionen (Löschen) `<button class="os-zeile os-zeile--aktion" formaction="…">`.
- `--fehler`: rote Kante, Beschriftung und `.os-zeile-hilfe` rot — für die Rückmeldung nach dem Absenden.
- Breite: Gruppen in `.os-breite-schmal` (760 px, Formulare) oder `.os-breite-mittel` (1080 px, Akten) legen; zwei Gruppen nebeneinander mit `.os-spalten` / `.os-spalten--2`.

### 3.6 `.os-pille` — Statuspille

```html
<span class="os-pille">Entwurf</span>
<span class="os-pille os-pille--blau">Versendet</span>
<span class="os-pille os-pille--gruen os-pille--punkt">Bezahlt</span>
<span class="os-pille os-pille--bernstein os-pille--punkt">Fällig in 3 Tagen</span>
<span class="os-pille os-pille--rot os-pille--punkt">Überfällig</span>
<span class="os-pille os-pille--gross">Retainer</span>
```
Bedeutungen fest: grau = neutral/Entwurf, blau = unterwegs/in Arbeit, grün = erledigt/bezahlt/gewonnen, bernstein = wartet/fällig bald, rot = überfällig/verloren/Fehler.

### 3.7 `.os-kacheln` / `.os-kachel` — Kennzahlen

2–5 nebeneinander, ruhig, Zahl tabular. Variante `--gruen/--rot/--bernstein/--blau` färbt nur die Zahl. Als `<a class="os-kachel">` klickbar.

```html
<div class="os-kacheln">
  <div class="os-kachel"><span class="os-kachel-label">Einnahmen</span>
    <span class="os-kachel-zahl">12.480 <small>€</small></span>
    <span class="os-kachel-fuss">September · 8 Rechnungen</span></div>
  <div class="os-kachel os-kachel--rot"><span class="os-kachel-label">Offen</span>
    <span class="os-kachel-zahl">3.200 <small>€</small></span>
    <span class="os-kachel-fuss"><span class="os-pille os-pille--rot os-pille--punkt">2 überfällig</span></span></div>
</div>
```

### 3.8 `.os-fortschritt` — Fortschritt mit Beschriftung

```html
<div class="os-fortschritt os-fortschritt--gruen" role="progressbar" aria-valuenow="50" aria-valuemin="0" aria-valuemax="100" aria-label="Bezahlt">
  <div class="os-fortschritt-text"><span><b>50 %</b> bezahlt</span><span>1.250 € von 2.500 €</span></div>
  <div class="os-fortschritt-balken"><span style="width:50%"></span></div>
</div>
```

### 3.9 `.os-tabelle` — schlanke Tabelle

Kopf klein/sekundär, Zeilen-Hover, Zahlen rechtsbündig (`.rechts`), Summenzeile in `<tfoot>`. **Zeile als Link:** `data-href` auf dem `<tr>` **plus** ein echter `<a>` in der ersten Zelle (Tastatur, Vorschau, Mittelklick). `.os-tabelle--dicht` für lange Listen. Leerzustand: eine Zeile mit `<td colspan>` und `.os-leer os-leer--klein` darin.

```html
<div class="os-tabelle-huelle">
<table class="os-tabelle">
  <thead><tr><th>Nummer</th><th>Kunde</th><th>Fällig</th><th class="rechts">Betrag</th><th>Status</th></tr></thead>
  <tbody>
    <tr data-href="/buchhaltung/rechnungen/2026-014">
      <td><a href="/buchhaltung/rechnungen/2026-014"><span class="os-tabelle-titel">2026-014</span></a>
          <div class="os-tabelle-unter">Webdesign · Setup</div></td>
      <td>Testpraxis Sonnenhof</td><td>19.09.2026</td>
      <td class="rechts">2.500,00 €</td>
      <td><span class="os-pille os-pille--bernstein os-pille--punkt">Offen</span></td>
    </tr>
  </tbody>
  <tfoot><tr><td colspan="3">Summe offen</td><td class="rechts">3.200,00 €</td><td></td></tr></tfoot>
</table>
</div>
<script>
document.addEventListener("click",function(e){var tr=e.target.closest("tr[data-href]");
  if(!tr||e.target.closest("a,button,input,select,label"))return;location.href=tr.dataset.href});
</script>
```

### 3.10 `.os-blatt` — Sheet auf Basis von `<dialog>`

Kopf (Titel, Untertitel, Schließen-X), Rumpf scrollbar mit Gruppen auf flachem Grund, Fuß mit Knöpfen. Unter 700 px fährt es von unten hoch, volle Breite. Breiten: Standard 620 px, `--schmal` 440, `--breit` 880. Das `<form>` darf direkt im Dialog liegen (es ist `display:contents`).

```html
<dialog class="os-blatt" id="blatt-neu" aria-labelledby="blatt-neu-titel">
  <form method="post" action="/buchhaltung/rechnungen/anlegen">
    <header class="os-blatt-kopf">
      <div><h2 id="blatt-neu-titel">Rechnung stellen</h2><p class="os-blatt-unter">Testpraxis Sonnenhof · Webdesign</p></div>
      <button type="button" class="os-blatt-schliessen" aria-label="Schließen" onclick="this.closest('dialog').close()">${ICON.x}</button>
    </header>
    <div class="os-blatt-rumpf">
      <div class="os-hinweis os-hinweis--info">${ZT.info}<div>Die Nummer vergibt das System beim Stellen.</div></div>
      <section class="os-gruppe">
        <div class="os-gruppe-titel">Position</div>
        <div class="os-gruppe-rumpf">
          <label class="os-zeile os-zeile--eingabe"><span class="os-zeile-label">Leistung *</span>
            <div class="os-zeile-wert"><input name="leistung" required placeholder="z. B. Webdesign Setup"></div></label>
          <div class="os-zeile os-zeile--eingabe os-zeile--paar">
            <label class="os-zeile-teil"><span class="os-zeile-label">Betrag netto *</span>
              <div class="os-zeile-wert"><input name="betrag" required inputmode="decimal" placeholder="0,00 €"></div></label>
            <label class="os-zeile-teil"><span class="os-zeile-label">Fällig am</span>
              <div class="os-zeile-wert"><input type="date" name="faellig"></div></label>
          </div>
        </div>
      </section>
    </div>
    <footer class="os-blatt-fuss">
      <button type="button" class="still links">Als Entwurf sichern</button>
      <button type="button" class="sekundaer" onclick="this.closest('dialog').close()">Abbrechen</button>
      <button type="submit" class="dunkel">Rechnung stellen</button>
    </footer>
  </form>
</dialog>
<script>
// Öffnen: document.getElementById("blatt-neu").showModal()  — Klick auf den Hintergrund schließt:
document.querySelectorAll("dialog.os-blatt").forEach(function(d){d.addEventListener("click",function(e){if(e.target===d)d.close()})});
</script>
```

**Blatt oder Dialog?** Alles, was ein Formular mit mehr als zwei Feldern ist, oder eine Sache anlegt/ändert → `.os-blatt`. Eine kurze Ja/Nein-Frage („Wirklich löschen?") → der schlichte `<dialog>` aus crm.css mit `.dialog-fuss`. Fehler nach dem Absenden kommen wie bisher per Query zurück (`?fehler=…`) und stehen als `.os-hinweis os-hinweis--fehler` oben im Rumpf; die betroffene Zeile bekommt `.os-zeile--fehler`.

### 3.11 `.os-popover` — kleines Popover mit Zipfel

Für „Zeilen wählen" (Häkchen-Liste), Menüs und das Termin-Popover im Kalender. Verankert in einem Elternelement mit `.os-popover-anker`; Varianten `--rechts` (Zipfel rechts), `--oben` (öffnet nach oben), `--ohne-zipfel` (frei per Skript positioniert, `position:fixed` + `top/left` selbst setzen), `--breit`. **Nicht** im `.os-gruppe-rumpf` verankern (der schneidet ab) — im Titel-Werkzeug ist der richtige Platz.

```html
<span class="os-popover-anker">
  <button type="button" class="sekundaer klein" aria-expanded="false" aria-controls="pop-zeilen" onclick="osPopover(this)">Zeilen wählen</button>
  <div class="os-popover os-popover--rechts" id="pop-zeilen" hidden role="dialog" aria-label="Zeilen wählen">
    <div class="os-popover-kopf">Zeilen anzeigen</div>
    <div class="os-popover-liste">
      <label><input type="checkbox" name="z" value="telefon" checked> Telefon</label>
      <label><input type="checkbox" name="z" value="email" checked> E-Mail</label>
      <label><input type="checkbox" name="z" value="website"> Website</label>
      <div class="os-popover-trenner"></div>
      <button type="button">Alle</button>
    </div>
    <div class="os-popover-fuss"><button type="button" class="sekundaer" onclick="osPopover(this.closest('.os-popover-anker').querySelector('[aria-controls]'))">Fertig</button></div>
  </div>
</span>
<script>
function osPopover(knopf){var p=document.getElementById(knopf.getAttribute("aria-controls"));var auf=p.hidden;p.hidden=!auf;knopf.setAttribute("aria-expanded",auf);
  if(!auf)return;function zu(e){if(e.type==="keydown"&&e.key!=="Escape")return;if(e.type==="click"&&(p.contains(e.target)||knopf.contains(e.target)))return;
    p.hidden=true;knopf.setAttribute("aria-expanded",false);document.removeEventListener("click",zu,true);document.removeEventListener("keydown",zu,true)}
  setTimeout(function(){document.addEventListener("click",zu,true);document.addEventListener("keydown",zu,true)},0)}
</script>
```

Termin-Popover (Kalender): `.os-popover os-popover--ohne-zipfel os-popover--breit`, Kopf mit `<b>Titel</b>` + Schließen-X (`button.os-blatt-schliessen` passt), `.os-popover-rumpf` mit Zeit/Ort/Teilnehmern als kurze Zeilen, `.os-popover-fuss` mit „Öffnen" und „Löschen".

### 3.12 `.os-leer` — Leerzustand

```html
<div class="os-leer">
  <div class="os-leer-icon">${ICON.beleg}</div>
  <h3>Noch keine Belege</h3>
  <p>Lade den ersten Beleg hoch oder leite eine Mail an den Belegeingang weiter — er landet dann hier.</p>
  <button type="button" class="dunkel">Beleg hochladen</button>
</div>
```
Wortlaut: erster Satz sagt, **was fehlt** („Noch keine Rechnungen"), zweiter Satz sagt, **was zu tun ist** — konkret, mit dem Wort, das auch auf dem Knopf steht. Keine Ausrufezeichen, kein „Ups". Kompakt in Tabellen/Gruppen: `.os-leer--klein` (ohne Knopf).

### 3.13 `.os-hinweis` — ruhige Inline-Meldung

Getönte Fläche, Text in Textfarbe, nur das Icon trägt die Bedeutung. Aktion rechts als `.os-hinweis-aktion`.

```html
<div class="os-hinweis os-hinweis--warn">${ZT.warnung}
  <div><b>Kontostand ist noch nie eingetragen.</b> Trag den heutigen Stand ein, dann stimmt die Zahl.</div>
  <a class="os-hinweis-aktion" href="#kontostand">Eintragen</a>
</div>
```
Varianten: (ohne) neutral · `--info` · `--warn` · `--erfolg` · `--fehler`. Höchstens **zwei** Hinweise je Seite; was dauerhaft gilt, gehört in eine Zeile oder Fußnote, nicht in einen Hinweis.

---

## 4. Knöpfe und Felder (aus crm.css, hier nur die Regeln)

- Primär: `<button class="dunkel">` — genau einer je Seite/Blatt. Sekundär: `.sekundaer`. Leise: `.still`. Klein: zusätzlich `.klein`. Gefährlich: `.gefahr` — nur im Fuß eines Bestätigungs-Dialogs.
- Knöpfe tragen ein **Verb** („Rechnung stellen", „Speichern"), nie nur ein Icon oder ein „+". Icon + Wort ist gut.
- Felder außerhalb von Zeilen (Filterleisten, Suche) bleiben wie in crm.css. In Gruppen immer `.os-zeile--eingabe`.
- Pflichtfelder: `*` im Label **und** `required`. Beträge: `inputmode="decimal"`, Platzhalter `0,00 €`. Datum: `type="date"`.

---

## 5. Was os-ui.css an bestehenden Seiten ändert (global, Zentrale/Sprachbühne ausgenommen)

1. **Knöpfe und Felder in der Hausschrift** (13,5 px, Knöpfe 600, Felder 400). Bisher standen sie in Arial — `font:600 13.5px/1.2 inherit` in crm.css ist ungültig (`inherit` als Familie), der Browser hat die ganze Angabe verworfen. Datumsfelder verlieren dadurch auch ihr Monospace.
2. **Knöpfe 36 px hoch** (Standardknöpfe ohne Klasse, `.dunkel`, `.sekundaer`, `.gefahr`, `.knopf`) — Felder sind jetzt ebenfalls 36 px. `.still`/`.klein`/`.tiny` und Icon-Knöpfe bleiben.
3. **Fokusring** 2 px in Primärfarbe per `:focus-visible` auf Knöpfen, Links, `summary`, `[tabindex]`. Felder behalten ihren Leuchtrand.
4. **Dialog-Hintergrund** im Dunkelmodus (`background-color: var(--os-flaeche)`) — vorher weiß mit heller Schrift.
5. **`color-scheme: dark`** im Dunkelmodus (Rollbalken, Auswahllisten, Datumswähler, Häkchen dunkel).
6. Kein Tap-Highlight auf Touch-Geräten.

---

## 6. Anschlussvertrag — Namen, auf die sich alle verlassen können

Aus dem Auftrag, unverändert: `.os-gruppe`, `.os-gruppe-titel`, `.os-gruppe-werkzeug`, `.os-zeile`, `.os-zeile-label`, `.os-zeile-wert`, `.os-zeile--eingabe|--text|--chips|--schalter|--paar|--aktion`, `.os-schalter`, `.os-segment` (+ `button.aktiv`), `.os-unternav` (+ `a.aktiv`), `.os-pille` (+ `--grau|--blau|--gruen|--bernstein|--rot`), `.os-kacheln`/`.os-kachel` (+ `-label`, `-zahl`, `-fuss`), `.os-fortschritt` (+ `-balken`, `-text`), `.os-tabelle`, `.os-blatt` (+ `-kopf`, `-rumpf`, `-fuss`), `.os-popover` (+ `-kopf`, `-liste`), `.os-leer`, `.os-hinweis` (+ `--info|--warn|--erfolg`), `.os-werkzeugleiste`, `.os-kopf` (+ `-titel`, `-unter`, `-pillen`, `-aktionen`).

**Ergänzt** (nötig, damit das Markup eindeutig ist):

| Baustein | Zusätzliche Namen |
|---|---|
| Gruppe | `.os-gruppe-rumpf` (die gerundete Fläche — Pflicht), `.os-gruppe-unter`, `.os-gruppe-fuss` |
| Zeile | `.os-zeile-teil` (Hälften in `--paar`), `.os-zeile-hilfe`, `.os-zeile-neben`, `.os-zeile-icon`, `.os-zeile--fehler`, `data-leer="…"` |
| Chips | `.os-chips` (Behälter), `.os-chip` (`<label>` mit Häkchen) |
| Pille | `.os-pille--punkt`, `.os-pille--gross` |
| Kachel | `.os-kachel--gruen|--rot|--bernstein|--blau`, `<small>` in der Zahl für die Einheit |
| Fortschritt | `.os-fortschritt--gruen|--bernstein|--rot|--klein` |
| Tabelle | `.os-tabelle-huelle` (Pflicht, scrollt waagerecht), `.os-tabelle-titel`, `.os-tabelle-unter`, `.rechts`, `tr[data-href]`, `.os-tabelle--dicht` |
| Blatt | `.os-blatt-schliessen`, `.os-blatt-unter`, `.os-blatt--schmal|--breit`, `.links` im Fuß |
| Popover | `.os-popover-anker`, `.os-popover-rumpf`, `.os-popover-fuss`, `.os-popover-trenner`, `--rechts|--oben|--ohne-zipfel|--breit` |
| Leer | `.os-leer-icon`, `.os-leer--klein` |
| Hinweis | `.os-hinweis--fehler`, `.os-hinweis-aktion` |
| Kopf | `.os-kopf-zurueck`, `.os-kopf-zeile`, `.os-kopf-text`, `.os-kopf-avatar` |
| Werkzeugleiste | `.os-werkzeugleiste-titel`, `.os-werkzeugleiste-unter`, `.os-werkzeugleiste-aktionen` |
| Layout | `.os-breite-schmal`, `.os-breite-mittel`, `.os-spalten`, `.os-spalten--2`, `.os-spalten--3` |
| Marken | `--os-flaeche`, `--os-flaeche-2`, `--os-flaeche-3`, `--os-hebung`, `--os-grund`, `--os-trenner`, `--os-r`, `--os-r-klein`, `--os-r-blatt`, `--os-hoehe` |

Wer einen Namen anders braucht: hier eintragen, nicht nur im eigenen CSS — dieser Leitfaden ist der Vertrag.
