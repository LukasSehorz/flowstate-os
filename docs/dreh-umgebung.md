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

Zurück in den Betrieb:

```bash
docker compose up -d
```

**Wichtig:** Das gilt nur für die Datenbank. Mail, WhatsApp, Telegram und
Kalender laufen weiter über die echten Zugänge — das ist Absicht, denn in
Creative 3 und 4 sollen Beleg und Rechnung wirklich durchgehen. Die Empfänger
sind Testadressen, siehe Skript.

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
