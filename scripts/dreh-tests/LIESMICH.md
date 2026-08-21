# Drehproben im echten Browser

Diese drei Skripte fahren einen echten Chromium im Container hoch, melden sich
an und pruefen, was auf dem Bildschirm tatsaechlich passiert.

**Warum im Browser und nicht mit curl:** Die Fehler, die den Dreh am 20.08.2026
aufgehalten haben, waren alle Browser-Eigenheiten — gedrosselte Zeitgeber in
unsichtbaren Tabs, nur ein Fenster pro Nutzergeste, eine kaputte Regex, die das
ganze Seitenskript stillschweigend abbricht. `node --check` und ein HTTP-Aufruf
sehen davon nichts.

## Ausfuehren

```bash
docker cp scripts/dreh-tests/kette-test.js flowstate-dashboard:/tmp/
docker exec -w /app flowstate-dashboard node /tmp/kette-test.js
```

| Datei | prueft |
|---|---|
| `laden-test.js` | Laedt die Sprachbuehne das Drehbuch? Fehler in der Konsole? |
| `kette-test.js` | Startet ein Klick den ersten Zug? Geht es danach ins Zuhoeren? |
| `tabs-test.js` | Geht jeder Inhalt erst auf, wenn er dran ist? Springt WhatsApp nach vorn? |

## Nach jedem Umbau an public/sprache.js

`kette-test.js` laufen lassen. Die Datei hat dreimal bei einem Blockersatz eine
Deklaration verloren; ein `is not defined` in einem Ereignis-Zuhoerer bricht die
ganze Kette ab, ohne sichtbare Meldung.

## Zurueck auf den Stand, der nachweislich lief

```bash
git checkout dreh-c2-laeuft -- public/sprache.js lib/regie-routes.js
```
