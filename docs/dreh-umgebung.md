# Dreh-Umgebung für die Meta-Anzeigen

Für die vier Werbeaufnahmen läuft das Dashboard gegen eine **zweite Datenbank**,
die nichts enthält außer der Kulisse. Die echte Datenbank wird dabei nicht
angefasst — nicht gelesen, nicht geschrieben.

Zurückschalten heißt: eine Zeile in der Konfiguration ändern. Es gibt nichts
zurückzurollen.

---

## Warum nicht Dummy-Zeilen in der echten Datenbank

`scripts/ads-proben.js` macht genau das — mit `ADSTEST`-Präfix, und das ist für
eine Generalprobe richtig: dort sollen die echten Zahlen mitspielen.

Beim **Drehen** ist es falsch. Sobald in Creative 1 das CRM aufgeht oder in
Creative 2 die Aufgabenliste, stehen die echten Kundennamen daneben im Bild.
Das lässt sich nicht wegschneiden, ohne die Einstellung zu verlieren.

---

## Einmal einrichten

### 1. Zweite Datenbank anlegen

Ein **zweites Supabase-Projekt** (kostenlos reicht). Kein blankes Postgres —
Migration `0001_schema.sql` hängt `profiles.id` an `auth.users(id)`, und die
Zeilenrechte in `0002_rls.sql` rufen `auth.uid()`. Beides gibt es nur bei
Supabase.

Region Frankfurt wie beim echten Projekt, dann fühlt sich das Dashboard im
Dreh genauso schnell an.

### 2. Schema einspielen

```bash
DATABASE_URL="<dreh-url>" node scripts/migrieren.js --einspielen
```

Das legt alle Tabellen und die Pipeline-Stufen an.

### 3. Konten anlegen

```bash
DATABASE_URL="<dreh-url>" node scripts/nutzer-anlegen.js
```

Mindestens ein Konto, sonst gibt es keine `profiles`-Zeile, an der Anrufe und
Deals hängen können. Zwei bis drei Konten sind besser — dann verteilen sich die
Cold Calls auf ein Team statt auf eine Person.

### 4. Als Dreh-Datenbank markieren

```bash
DREH_DATABASE_URL="<dreh-url>" node scripts/drehdaten.js --markieren
```

Das legt die Tabelle `dreh_marke` an. Ohne sie verweigert `--laden` und
`--leeren` den Dienst.

**Warum die Marke:** Ein Verbindungsstring kann falsch sein, ohne dass man es
ihm ansieht. Supabase schreibt dieselbe Datenbank auf zwei Arten — direkt
(`db.<kennung>.supabase.co`) und über den Pooler (Kennung im *Benutzernamen*).
Am 20.08. hat ein reiner Wirt-Vergleich genau diesen Fall durchgelassen. Jetzt
muss die Datenbank selbst sagen, dass sie die Kulisse ist. `--markieren`
verweigert sich in jeder Datenbank, in der schon Firmen oder Buchungen stehen.

---

## Vor jedem Drehtag

```bash
DREH_DATABASE_URL="<dreh-url>" node scripts/drehdaten.js --laden
```

Baut die Kulisse auf und zeigt danach den Stand mit einem Soll-Ist-Vergleich
gegen die Zahlen im Skript. Steht dort „Alles passt zum Skript", kann gedreht
werden.

`--laden` leert vorher. Zwei Läufe hintereinander verdoppeln also nichts.

Nur nachsehen, ohne etwas zu ändern:

```bash
DREH_DATABASE_URL="<dreh-url>" node scripts/drehdaten.js --stand
```

## Umschalten

Im Dreh zeigt `DATABASE_URL` des Dashboards auf die Dreh-Datenbank. Am
einfachsten über eine `.env.dreh` neben der `.env`:

```bash
docker compose --env-file .env.dreh up -d
```

**Sitzungen löschen — sonst sieht niemand die Kulisse:**

```bash
docker exec flowstate-dashboard sh -c 'rm -f /data/sessions/*.json'
```

Die Anmeldungen liegen als Dateien in `/data/sessions` und überleben den
Neustart mit Absicht ([server.js](../server.js), `session-file-store`). In der
Sitzung steckt die komplette Nutzerzeile — **samt der Kennung aus der
Datenbank, in der man sich angemeldet hat.** Nach dem Umschalten gibt es diese
Kennung nicht mehr: Die Zeilenrechte zeigen dann nichts an (überall Null,
obwohl die Daten da sind), und jedes Schreiben scheitert an einem
Fremdschlüssel auf `profiles`.

Am 20.08. stand das Dashboard nach dem zweiten Laden deshalb komplett auf
Null — die Datenbank war die ganze Zeit voll. Der Befehl oben gehört zum
Umschalten dazu, in beide Richtungen.

Zurück in den Betrieb:

```bash
docker compose up -d
docker exec flowstate-dashboard sh -c 'rm -f /data/sessions/*.json'
```

**Wichtig:** Das gilt nur für die Datenbank. Mail, WhatsApp und Telegram laufen
weiter über die echten Zugänge — das ist Absicht, denn in Creative 3 und 4
sollen Beleg und Rechnung wirklich durchgehen. Die Empfänger sind
Testadressen, siehe Skript.

## Der Kalender

Termine stecken nicht in der Datenbank, sondern kommen über `gws-cli` aus
Lukas' Google-Konto. In Creative 2 geht die Tagesansicht auf — dort standen
sonst seine echten Termine.

Gelöst über einen **zweiten Kalender im selben Konto**, kein zweites
Google-Konto und keine neue Anmeldung. `KALENDER_ID` entscheidet, welcher
gilt; leer heißt Hauptkalender, also unverändert
([lib/kalender-id.js](../lib/kalender-id.js)).

Angelegt am 20.08.2026:

```
Flowstate Dreh
c_54a6aed2087b46dd6e31975e007bfb62ce92401babfd46f991477a9ad24384fd@group.calendar.google.com
```

Die Kennung steht in der `.env.dreh` auf dem Server. Lesen, Anlegen, Ändern
und Absagen gehen damit alle in den Dreh-Kalender — auch das, was Alexandra im
Dreh selbst tut.

**Die Termine des Drehtags setzen** (die zwei aus Creative 2 — wenn an einem
anderen Tag gedreht wird, hier das Datum anpassen):

```bash
KAL="c_54a6aed2087b46dd6e31975e007bfb62ce92401babfd46f991477a9ad24384fd@group.calendar.google.com"
T=$(date +%Y-%m-%d)
G() { docker exec -e GWS_ENCRYPTION=none flowstate-dashboard gws-cli "$@"; }
G calendar create "Erstgespräch Nordlicht Media" "${T}T11:00:00+02:00" "${T}T11:45:00+02:00" \
  -c "$KAL" -l "Zoom" -d "Voice-Agent für zwei Standorte. Ansprechpartnerin: Anke Carstens."
G calendar create "Team-Weekly" "${T}T15:30:00+02:00" "${T}T16:00:00+02:00" -c "$KAL" -l "Büro"
```

Leerräumen nach dem Dreh: `G calendar clear-calendar -c "$KAL"`.

## Was NICHT abgedeckt ist: das Postfach

Die 23 Mails aus Creative 2 lassen sich nicht auf demselben Weg stellen — für
Gmail gibt es kein Gegenstück zum zweiten Kalender, das OS fragt
`in:inbox newer_than:Nd` im echten Postfach ([lib/posteingang.js](../lib/posteingang.js)).

Drei Möglichkeiten, keine davon gebaut:
1. Die Zahl bleibt gesprochen, das Bild zeigt die Zentrale statt der Inbox.
2. Ein zweites Google-Konto nur fürs Postfach (eine Anmeldung, `GWS_HOME` umbiegen).
3. Ein Dreh-Schalter, der `posteingang.js` aus einer JSON-Datei speisen lässt.

## Danach

```bash
DREH_DATABASE_URL="<dreh-url>" node scripts/drehdaten.js --leeren
```

Optional — die Dreh-Datenbank kann auch stehenbleiben. Für die nächste
Aufnahme spart das die Einrichtung.

---

## Was die Kulisse enthält

Alle Zahlen stehen im Kopf von `scripts/drehdaten.js` unter `K`. Wer eine
ändert, muss die Sprechzeile im Skript mitändern — deshalb stehen sie an einer
Stelle und nicht über die Datei verteilt.

| Was | Zahl | Wo im Skript |
|---|---|---|
| Cold Calls gestern | 142 | C1_02 |
| davon Erstgespräche | 19 | C1_02 |
| Cold Calls heute (Kachel) | 18 | — |
| Umsatz Vormonat | 87.400 € | C1_03 |
| Leads für morgen | 50 | C1_04 |
| Nachschub (liegt bereit) | 100 | C1_05 |
| Umsatz laufender Monat | 62.800 € | C4_03 (wird zu 66.800) |
| Belege im Vormonat | 33 | C3_04 (wird zu 34) |

Die Firmen `Nordlicht Media`, `Meridian Consulting` und `Bergmann Solar` sind
die drei, die im Skript beim Namen genannt werden. Der Rest ist Füllung für die
Listen.

**Meridian steht bewusst auf `offen`.** Der Deal wird im Dreh gewonnen, nicht
vorher — sonst springt der Umsatzzähler in Creative 4 nicht.
