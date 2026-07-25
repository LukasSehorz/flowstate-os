# Hermes-Gedaechtnis: USER.md ist voll (Bauplan-Schritt P1.5)

Recherche-Stand: 25.07.2026. Reine Recherche, es wurde nichts geaendert.
Kein Serverzugriff vorhanden — alle Aussagen zur laufenden Installation muessen
mit den Befehlen in Abschnitt 4 selbst geprueft werden.

---

## 1. Was das Problem konkret ist

Hermes fuehrt zwei Gedaechtnisdateien. `USER.md` haelt, was ueber den Nutzer
gilt (Vorlieben, Arbeitsweise, Erwartungen). Diese Datei ist mit 1.356 von
1.375 Einheiten praktisch voll.

Die gemeldeten 1.375 sind **Zeichen**, nicht Tokens oder Zeilen — und 1.375 ist
exakt der dokumentierte Standardwert des Limits. Das ist ein starker Hinweis,
dass auf dem VPS der unveraenderte Standard laeuft und bisher niemand daran
gedreht hat.

Eine Korrektur an der Ausgangsannahme, und sie ist wichtig fuer die Loesung:
Hermes ueberschreibt **nicht** automatisch Altes, wenn Neues dazukommt. Laut
Doku bricht der Schreibvorgang mit einer Fehlermeldung ab, und der Agent wird
aufgefordert, selbst zusammenzufassen oder zu loeschen und den Schreibvorgang
im selben Zug erneut zu versuchen. Der Verlust entsteht also nicht durch einen
Automatismus, sondern durch eine **Entscheidung des Agenten** in genau diesem
Moment. Das ist die gute Nachricht: eine Entscheidung kann man per Anweisung
lenken, einen Automatismus nicht.

---

## 2. Was die Recherche BELEGT hat

Alles in diesem Abschnitt stammt aus der offiziellen Dokumentation von Nous
Research. Die Doku ist oeffentlich zugaenglich. Die entscheidenden Angaben
habe ich doppelt geholt: einmal von der gerenderten Doku-Seite und einmal aus
der Rohdatei im GitHub-Repository — beide stimmen ueberein.

### 2.1 Die Limits und ihre Standardwerte

| Datei | Limit | entspricht ca. |
|---|---|---|
| `MEMORY.md` | 2.200 Zeichen | ~800 Tokens, ~8-15 Eintraege |
| `USER.md` | 1.375 Zeichen | ~500 Tokens, ~5-10 Eintraege |

Beide Dateien liegen unter `~/.hermes/memories/`.

Quellen:
- https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md

### 2.2 Es gibt einen Konfigurationsschalter (dokumentiert)

Die Doku nennt einen `memory:`-Block in `~/.hermes/config.yaml` mit diesen
Schluesseln und Standardwerten:

```yaml
memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200        # ~800 Tokens
  user_char_limit: 1375          # ~500 Tokens
  write_approval: false
```

Der gesuchte Schalter heisst also `memory.user_char_limit`. Dieser YAML-Block
steht wortgleich auf der Konfigurationsseite **und** auf der Gedaechtnisseite
der Doku.

Quelle:
- https://hermes-agent.nousresearch.com/docs/user-guide/configuration
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/configuration.md

Vorrangregel der Konfiguration (laut derselben Seite, hoechste zuerst):
CLI-Argumente → `~/.hermes/config.yaml` → `~/.hermes/.env` → eingebaute
Standardwerte. Lesen und Setzen ueber `hermes config get KEY` bzw.
`hermes config set KEY VALUE`.

Zusaetzlich belegt ein offener GitHub-Vorschlag (Issue #5320, eroeffnet
05.04.2026), dass das Anheben ueber `config.yaml` funktioniert, aber kaum
bekannt ist. Woertlich dort: *"most users never discover this until they hit
the ceiling."* Der Vorschlag will die Standardwerte vervierfachen. Wichtig:
Der Text ist von einem Community-Mitglied, **nicht** von den Maintainern, und
das Issue war zum Recherchezeitpunkt offen und unbeantwortet.

Quelle: https://github.com/NousResearch/hermes-agent/issues/5320

### 2.3 Was beim Ueberlauf wirklich passiert

Woertliches Zitat aus der Gedaechtnis-Doku:

> "Memory does **not** auto-compact: when a write would exceed the limit, the
> `memory` tool returns an error instead of silently dropping entries."

Und der Fehlertext, den der Agent zu sehen bekommt:

> "Memory at 2,100/2,200 chars. Adding this entry (250 chars) would exceed the
> limit. Consolidate now: use 'replace' to merge overlapping entries into
> shorter ones or 'remove' stale or less important entries (see
> current_entries below), then retry this add — all in this turn."

Ausserdem belegt:
- `replace` unterliegt demselben Limit — ein Eintrag gegen einen laengeren zu
  tauschen kann ebenfalls ueberlaufen.
- Ab 80 % Fuellstand soll der Agent von sich aus zusammenfassen, bevor er
  Neues hinzufuegt. Der Fuellstand steht im System-Prompt-Kopf, im Format
  `MEMORY (your personal notes) [67% — 1,474/2,200 chars]`.
- Eintraege sind durch `§` getrennt.
- Das Gedaechtnis wird beim Sitzungsstart als eingefrorener Schnappschuss in
  den Prompt gelegt. Schreibvorgaenge landen sofort auf der Platte, wirken im
  Prompt aber erst in der naechsten Sitzung.

### 2.4 Gelöschtes ist nicht zwingend verloren

Laut Doku kann der Agent alte Unterhaltungen mit dem Werkzeug `session_search`
durchsuchen (FTS5-Volltextsuche ueber eine SQLite-Datei, dokumentiert als
`~/.hermes/state.db`). Das laeuft ausserhalb des Zeichenlimits. Ein aus
`USER.md` entfernter Eintrag ist damit nicht aus der Welt, aber er wird auch
nicht mehr automatisch mitgedacht — er muss aktiv gesucht werden.

### 2.5 Kontextdateien: der zweite, groessere Speicherort

Belegt, und fuer die Empfehlung zentral: Hermes laedt automatisch
Kontextdateien in jede Sitzung. Reihenfolge, erster Treffer gewinnt:
`.hermes.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`. `SOUL.md` wird
davon unabhaengig immer als Identitaet geladen (`~/.hermes/SOUL.md` bzw.
`$HERMES_HOME/SOUL.md`).

Deren Limit ist `context_file_max_chars`, Standard **20.000 Zeichen**
(~7.000 Tokens) — also rund das Vierzehnfache von `USER.md`. Wird es
ueberschritten, wird gekuerzt (70 % Anfang, 20 % Ende, Markierung in der
Mitte).

Der Ratgeber der Doku formuliert die Arbeitsteilung so:

> "Use memory for 'what,' skills for 'how.'"

und zum Gedaechtnis selbst:

> "Memory is intentionally bounded (~2,200 chars for MEMORY.md, ~1,375 chars
> for USER.md)." / "When it fills up, the agent consolidates entries. You can
> help by saying 'clean up your memory'"

Ebenfalls belegt: Nicht ins Gedaechtnis gehoeren laut Doku Belanglosigkeiten,
leicht auffindbare Fakten, grosse Code-Bloecke, Logdateien, Rohdaten,
temporaere Pfade und alles, was schon in einer Kontextdatei steht.

Quellen:
- https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files
- https://hermes-agent.nousresearch.com/docs/guides/tips/
- https://hermes-agent.nousresearch.com/docs/developer-guide/prompt-assembly

### 2.6 Externe Speicher-Anbieter

Es gibt einen Schluessel `memory.provider` und ein interaktives
`hermes memory setup`. Die Doku listet neun Anbieter (u. a. Holographic =
lokales SQLite mit Volltextsuche, ByteRover = lokal, Mem0, Hindsight,
OpenViking, Honcho, RetainDB, Supermemory, Memori).

Entscheidender Satz, woertlich:

> "The built-in memory (MEMORY.md / USER.md) continues to work exactly as
> before. The external provider is additive."

Das heisst: Ein Anbieter hebt das `USER.md`-Limit **nicht** auf. Er stellt
einen zweiten Speicher daneben.

Quelle: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers

---

## 3. Was unklar geblieben ist

Strikt getrennt vom Abschnitt oben — das Folgende ist **nicht** belegt:

1. **Keine Gegenprobe im Quellcode.** Die Schluesselnamen
   `user_char_limit` / `memory_char_limit` stehen nur in der Dokumentation.
   Ich habe im Repository `agent/memory_manager.py`, `agent/memory_provider.py`
   und `agent/curator.py` geprueft — in keiner dieser Dateien steht die
   Limit-Logik. Das Modul, das das Limit tatsaechlich durchsetzt, habe ich
   nicht gefunden. Die Doku ist eine gute Quelle, aber sie ist nicht der Code.
   **Deshalb steht `hermes config get memory` in Abschnitt 4 an erster Stelle:
   Das ist die einzige Pruefung, die fuer deine Version wirklich gilt.**
2. **Widerspruch in der Doku.** Beim Auslesen der Konfigurationsseite tauchte
   die Aussage auf, ein Ueberschreiten loese eine automatische
   Zusammenfassung aus. Das widerspricht dem woertlichen Zitat der
   Gedaechtnisseite ("does not auto-compact"). Ich halte die Gedaechtnisseite
   fuer maßgeblich, weil dort der Fehlertext im Original steht. Sicher ist es
   nicht.
3. **Obergrenze unbekannt.** Ob `user_char_limit` beliebig hoch gesetzt werden
   darf oder ob Hermes den Wert prueft/begrenzt, ist nicht dokumentiert. Es
   gibt auch keinen dokumentierten "empfohlenen" Wert. Jede konkrete Zahl in
   Abschnitt 5 ist deshalb ausdruecklich als Abwaegung markiert und nicht als
   Doku-Aussage.
4. **Deine Version.** Ob der `memory:`-Block in der `config.yaml` auf dem VPS
   ueberhaupt existiert, haengt vom Alter der Installation ab. Die Doku nennt
   `hermes config migrate`, um nach Updates fehlende Optionen zu ergaenzen —
   dieser Befehl **schreibt** und steht daher bewusst nicht in Abschnitt 4.
5. **Pfad-Annahme.** Aus den Mounts in unserer `docker-compose.yml`
   (`/docker/hermes-agent-pocv/data/config.yaml`, `.../data/skills`) schliesse
   ich, dass `/docker/hermes-agent-pocv/data` das Hermes-Heimatverzeichnis ist
   und die Gedaechtnisdateien folglich unter
   `/docker/hermes-agent-pocv/data/memories/` liegen. Das ist ein Schluss,
   keine Messung — Befehl 3 in Abschnitt 4 prueft es.
6. **Kosten.** Dass ein hoeheres Limit den Prompt und damit Tokenverbrauch und
   Prefix-Cache belastet, ist logisch und wird im Issue #5320 auch so
   diskutiert — eine Zahl dazu ist mir nicht bekannt.

---

## 4. Befehle zum Selbstpruefen auf dem Server (alle nur lesend)

Nichts hier veraendert Konfiguration oder Dateien. Auf dem VPS als root
ausfuehren.

**1) Existiert der Schalter in deiner Version, und welcher Wert gilt?**
Zuerst den Containernamen bestaetigen, dann die aufgeloeste Konfiguration
abfragen. `config get` gibt laut Doku nur aus.

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i hermes
docker exec hermes-agent-pocv-hermes-agent-1 hermes config get memory
docker exec hermes-agent-pocv-hermes-agent-1 hermes config get memory.user_char_limit
docker exec hermes-agent-pocv-hermes-agent-1 hermes --version
```

Falls der Containername abweicht, den Namen aus der ersten Zeile einsetzen.
Kommt bei `config get` ein Fehler oder nichts, kennt deine Version den
Schluessel womoeglich nicht — dann greift die Empfehlung in 5.2.

**2) Steht der `memory:`-Block schon in der Konfigurationsdatei?**

```bash
grep -n -A 8 '^memory:' /docker/hermes-agent-pocv/data/config.yaml
grep -rn 'char_limit' /docker/hermes-agent-pocv/data/config.yaml
```

Keine Ausgabe heisst: kein Block vorhanden, es gelten die eingebauten
Standardwerte.

**3) Wo liegen die Gedaechtnisdateien wirklich?**

```bash
ls -la /docker/hermes-agent-pocv/data/memories/
find /docker/hermes-agent-pocv/data -maxdepth 2 -name 'USER.md' -o -maxdepth 2 -name 'MEMORY.md'
```

**4) Wie voll sind sie exakt?**
`wc -m` zaehlt Zeichen, `wc -c` zaehlt Bytes. Weil Umlaute zwei Bytes
belegen, ist bei deutschem Text `-m` der Wert, der mit dem Limit vergleichbar
ist.

```bash
wc -m /docker/hermes-agent-pocv/data/memories/USER.md /docker/hermes-agent-pocv/data/memories/MEMORY.md
wc -c /docker/hermes-agent-pocv/data/memories/USER.md /docker/hermes-agent-pocv/data/memories/MEMORY.md
```

Liegt `wc -m` bei `USER.md` nahe 1.375, ist die Meldung des Agenten bestaetigt
und der Standardwert aktiv.

**5) Was steht drin — lohnt Zusammenfassen ueberhaupt?**
Vor jeder Aenderung am Limit lesen, ob die Datei voll ist oder nur unordentlich.

```bash
cat /docker/hermes-agent-pocv/data/memories/USER.md
```

**6) Heimatverzeichnis und Mounts des Hermes-Containers bestaetigen**
(bestaetigt oder widerlegt die Pfad-Annahme aus 3.5):

```bash
docker inspect hermes-agent-pocv-hermes-agent-1 --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
docker inspect hermes-agent-pocv-hermes-agent-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i -E 'home|hermes'
```

**7) Gibt es die Sitzungsdatenbank fuer die Rueckwaertssuche?**

```bash
ls -lh /docker/hermes-agent-pocv/data/state.db
```

**8) Existiert eine Identitaets- oder Kontextdatei, in die Dauerhaftes gehoert?**

```bash
ls -la /docker/hermes-agent-pocv/data/SOUL.md
wc -m /docker/hermes-agent-pocv/data/SOUL.md
ls -la /docker/hermes-agent-pocv/data/vault/ | head -30
```

---

## 5. Empfehlung

Zur Kernfrage, klar beantwortet: **Ein Schalter existiert und ist
dokumentiert — `memory.user_char_limit` in `~/.hermes/config.yaml`.** Das ist
kein geratener Wert, der YAML-Block steht wortgleich auf zwei Doku-Seiten. Was
fehlt, ist die Gegenprobe im Quellcode und die Bestaetigung fuer die auf dem
VPS installierte Version. Genau diese Luecke schliesst Befehl 1 in Abschnitt 4
in dreissig Sekunden. Bitte erst messen, dann schrauben.

### 5.1 Das Limit anheben — moeglich, aber nicht die eigentliche Loesung

Wenn Befehl 1 den Schluessel bestaetigt, ist das Anheben legitim. Zwei
Einschraenkungen:

- Der Wert kostet in **jeder** Sitzung Prompt-Platz, dauerhaft. Das Limit ist
  laut Doku Absicht ("Character limits keep memory focused"), nicht
  Schlamperei.
- Es verschiebt das Problem nur. Bei einem lernenden Agenten laeuft auch ein
  doppeltes Limit irgendwann voll — dann steht dieselbe Frage nochmal, nur mit
  mehr Ballast im Prompt.

Wenn angehoben, dann maßvoll und in einem Schritt, den man wieder
zurueckdrehen kann. Zum Vergleich: Der offene Community-Vorschlag in Issue
#5320 arbeitet mit `user_char_limit: 5000`. Das ist **keine Empfehlung der
Maintainer** und keine Doku-Aussage, sondern der einzige konkrete Wert, der
mir belegt begegnet ist. Eine Verdoppelung auf etwa 2.750 waere die
vorsichtigere Variante. Vor jeder Aenderung die `config.yaml` einmal kopieren
und danach mit `hermes config get memory` pruefen, ob der Wert wirklich
angekommen ist.

### 5.2 Der eigentliche Fix: Auslagern statt Verdraengen

Unabhaengig davon, ob der Schalter greift, ist das Folgende die Loesung, die
zum Bauplan passt — und sie stuetzt sich auf die dokumentierte Arbeitsteilung
aus 2.5, nicht auf Vermutungen:

1. **`USER.md` wird ein Inhaltsverzeichnis, kein Archiv.** Dort stehen nur
   kurze, dauerhaft gueltige Saetze plus Verweise ("Details zu X stehen im
   Vault unter `...`"). 1.375 Zeichen reichen fuer Verweise muehelos.
2. **Der Vault wird das Langzeitgedaechtnis.** Er liegt ohnehin schon im
   Hermes-Datenverzeichnis, Hermes kann ihn mit seinen Dateiwerkzeugen lesen
   und schreiben. Eine Datei wie `vault/gedaechtnis/USER-archiv.md` nimmt
   auf, was aus `USER.md` herausfaellt — mit Datum, damit die Chronologie
   erhalten bleibt.
3. **Die Regel gehoert in die Kontextdatei, nicht ins Gedaechtnis.** In
   `SOUL.md` bzw. die Projekt-Kontextdatei (`.hermes.md`/`AGENTS.md`, Limit
   20.000 Zeichen) kommt die Anweisung: *Bevor du einen Eintrag aus `USER.md`
   entfernst oder zusammenfasst, haenge ihn im Original mit Datum an
   `vault/gedaechtnis/USER-archiv.md` an. Erst danach entfernen.* Damit wird
   aus dem Verdraengen ein Umziehen. Das ist der Hebel an genau der Stelle,
   an der Hermes laut 2.3 die Entscheidung faellt.
4. **Aufraeumen anstossen, wenn es eng wird.** Die Doku nennt woertlich den
   Zuruf "clean up your memory". Der Fuellstand steht im Prompt-Kopf, das
   Dashboard liest die `config.yaml` bereits lesend (`server.js:795`) — den
   Fuellstand von `USER.md` dort anzuzeigen, waere ein kleiner, ehrlicher
   Zusatz und macht das Problem sichtbar, bevor es beisst.
5. **Nichts geht wirklich verloren.** Dank `session_search` bleibt Aelteres
   auffindbar (2.4). Der Vault macht es zusaetzlich verlaesslich auffindbar,
   weil es dort strukturiert liegt.

### 5.3 Wovon ich abrate

- **Kein externer Speicher-Anbieter fuer dieses Problem.** Er hebt das
  `USER.md`-Limit belegt nicht auf ("additive"), bringt aber einen weiteren
  Dienst, weitere Zugangsdaten und eine weitere Fehlerquelle in ein Setup, das
  gerade laeuft. Falls spaeter doch, dann eine lokale Variante ohne Cloud
  (Holographic/SQLite) — und als eigener Bauplan-Schritt, nicht als
  Nebenwirkung von P1.5.
- **Kein `hermes config migrate` ins Blaue.** Der Befehl schreibt in die
  Konfiguration. Erst Abschnitt 4 auswerten.
- **Keinen Wert setzen, den Befehl 1 nicht bestaetigt hat.** Ein Schluessel,
  den die installierte Version nicht kennt, wird stillschweigend ignoriert —
  und dann glaubt man, das Problem sei geloest, waehrend es weiterlaeuft.

### 5.4 Reihenfolge

1. Befehle 1-5 aus Abschnitt 4 laufen lassen, Ausgaben hier eintragen.
2. Erst dann entscheiden, ob 5.1 (Limit) oder nur 5.2 (Auslagern) gemacht wird.
3. 5.2 lohnt in jedem Fall — auch bei angehobenem Limit.

---

## Quellenliste

- Gedaechtnis (Doku): https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- Gedaechtnis (Rohtext im Repo): https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md
- Konfiguration: https://hermes-agent.nousresearch.com/docs/user-guide/configuration
- Speicher-Anbieter: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers
- Kontextdateien: https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files
- Prompt-Aufbau: https://hermes-agent.nousresearch.com/docs/developer-guide/prompt-assembly
- Tipps: https://hermes-agent.nousresearch.com/docs/guides/tips/
- Issue #5320 (offen, Community-Vorschlag zum Anheben der Standardwerte): https://github.com/NousResearch/hermes-agent/issues/5320
