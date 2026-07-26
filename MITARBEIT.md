# Mitarbeit am flowstateOS

Kurzanleitung für Lukas & Jannik. Alles ist **eine** Anwendung
(`flowstate-dashboard`) — deshalb ein paar einfache Regeln.

---

## Einmal einrichten

Voraussetzung: [Node.js](https://nodejs.org) (Version 22) und [Git](https://git-scm.com).

```bash
git clone https://github.com/LukasSehorz/flowstate-dashboard.git
cd flowstate-dashboard
npm install

copy .env.beispiel .env      # Werte bekommst du separat von Lukas
git config core.hooksPath .githooks   # aktiviert die Prüfung vor dem Push

npm start                    # läuft auf http://localhost:3000
```

Anmelden mit deinem persönlichen Konto (E-Mail + Passwort).

> Der **Vault** (`flowstate-vault`) ist Alexandras Wissen und für die
> Bereichsarbeit kaum nötig. Wenn du ihn willst: daneben klonen und `VAULT_PATH`
> in der `.env` daraufsetzen.

---

## So arbeiten wir (neu ab 26.07.2026)

**Wir arbeiten beide direkt auf `main`.** Keine eigenen Branches, keine Pull
Requests. Wenn einer pusht, sieht der andere es sofort.

Das geht, weil wir uns die **Bereiche** aufteilen: Wer einen Bereich hat, hat
ihn allein. Zwei Leute in getrennten Dateien behindern sich nie — Git führt das
von selbst zusammen.

### Der Ablauf

```bash
git pull                     # morgens und zwischendurch
# ... arbeiten ...
git add -A
git commit -m "kurz, was du gemacht hast"
git pull --rebase            # falls der andere zwischendurch gepusht hat
git push                     # sofort beim anderen sichtbar
```

**Mehrmals am Tag pushen, nicht einmal am Ende.** Das ist die wichtigste Regel.
Grund: Am 26.07. war ein Branch nur zwei Commits alt — und hätte beim
Zusammenführen beinahe stillschweigend den Weiß-Modus gelöscht. Je länger man
getrennt arbeitet, desto größer der Knall.

### Wer macht was

| Bereich | Zuständig |
|---|---|
| CRM, Marketing, Buchhaltung, Angebote, Projekte | **Jannik** |
| Alexandra (Sprache, Chat), Zustand, Zufluss ins Gehirn | **Lukas** |

Wer einen Bereich hat, arbeitet allein darin — der andere fasst die Dateien
nicht an, auch nicht „mal eben".

### Die drei geteilten Dateien

Nur hier können wir uns treffen. Vorher kurz im Raum Bescheid sagen:

- `lib/schale.js` — die Hülle (Rail, Kopfzeile)
- `public/crm.css` — das Design für alles
- `server.js` — verdrahtet die Bereiche

**Neuen Bereich anlegen? Dann brauchst du `schale.js` NICHT anzufassen.**
Dein Modul trägt sich selbst in die Navigation ein:

```js
// in lib/marketing-routes.js
const { schale, eintragen } = require("./schale.js");

eintragen({
  id: "marketing", titel: "Marketing & Content",
  icon: "marketing", href: "/marketing",
  nach: "buchhaltung",                    // optional: Platz in der Rail
  unter: [                                // optional: Unterpunkte
    { id: "marketing-kampagnen", titel: "Kampagnen", icon: "megafon", href: "/marketing/kampagnen" },
  ],
});

module.exports = function (app) {
  app.get("/marketing", (req, res) => {
    res.send(schale({ titel: "Marketing", aktiv: "marketing", inhalt: "<p>…</p>", nutzer: req.session.crm }));
  });
};
```

In `server.js` kommt dann **eine** Zeile dazu (Muster wie beim CRM-Modul).
Icons: Namen aus `ICON` in `schale.js` — ein unbekannter Name fällt still auf
ein Standard-Icon zurück, statt die Rail zu zerlegen.

---

## Design

**In deinen eigenen Bereichen gestaltest du frei.** Keine Vorgaben zu Farben,
Aufbau oder Stil — du kennst deine Seiten am besten.

Zwei Dinge, die nichts mit Geschmack zu tun haben, sondern damit, dass wir uns
nicht gegenseitig die Seiten kaputt machen:

- **Bestehende Klassen in `public/crm.css` nicht umschreiben.** Was dort schon
  steht, nutzen CRM und die OS-Seiten gemeinsam — eine Änderung an `.karte`
  trifft sofort alles. Eigene Klassen anlegen statt vorhandene anpassen; wenn
  dir an einer bestehenden etwas fehlt, kurz Bescheid sagen.
- **Eigene Klassen mit Bereichs-Präfix** (`.marketing-…`). Sonst kollidiert
  irgendwann ein `.karte-gross` mit einem anderen `.karte-gross`.

Wer sein Bereichs-CSS lieber in einer eigenen Datei hat statt in `crm.css`:
`public/marketing.css` anlegen und in der eigenen Seite einbinden — dann gibt es
dort nie einen Konflikt.

---

## Vor dem Push: die Prüfung

Weil wir direkt auf `main` arbeiten, bremst kaputter Code den anderen sofort.
Deshalb läuft vor jedem Push automatisch ein Selbsttest (wenige Sekunden):
Syntax der geänderten Dateien plus alle Testskripte.

```bash
node scripts/pruefen.js      # kann man auch von Hand starten
git push --no-verify         # Notausgang — dann bitte Bescheid sagen
```

Das ersetzt kein Ausprobieren im Browser. Es verhindert nur, dass offensichtlich
Kaputtes beim anderen landet.

---

## Datenbank: Migrationen

Neue Tabellen oder Spalten kommen als SQL-Datei nach `supabase/`, fortlaufend
nummeriert (`0019_…sql`). **Wichtig: `git pull` bringt sie NICHT in die
Datenbank** — die liegt bei Supabase und muss getrennt aktualisiert werden.

```bash
node scripts/migrieren.js                # zeigt, was fehlt
node scripts/migrieren.js --einspielen   # spielt die offenen ein
```

Der Server warnt beim Start, wenn Code und Datenbank auseinanderlaufen. Am
26.07. fehlten 14 Migrationen in Supabase, während der Code sie erwartete —
das sieht im Betrieb aus wie kaputter Code („Spalte gibt es nicht"), und man
sucht an der falschen Stelle.

Migrationen bitte **wiederholbar** schreiben (`if not exists`,
`where not exists`), damit ein zweiter Lauf nichts anrichtet.

---

## Auf den Server bringen (nur Lukas)

```bash
cd /opt/flowstate-dashboard
git pull
docker exec flowstate-dashboard node scripts/migrieren.js   # erst schauen
docker compose up -d --build
```

Danach im Browser **Strg+F5** (nur nötig, wenn sich am Aussehen etwas ändert —
CSS und JS tragen einen Cache-Stempel).

---

## Testen

```bash
node scripts/pruefen.js       # alles Wichtige auf einmal (das läuft auch vor dem Push)

node scripts/test-crm.js      # CRM-Logik + Rechtetrennung (räumt selbst auf, braucht DB)
node scripts/test-navigation.js  # Rail: Bereiche tragen sich selbst ein
node scripts/test-prompt.js   # Regeln + Größe des System-Prompts
node scripts/test-sprache.js  # Sprach-Verstehen (Sonnet + Haiku-Reserve)
node scripts/test-kontakte.js # WhatsApp-Kontakte (LID vs. Nummer) + Gruppen-Freigabe
node scripts/test-termin.js   # Termine anlegen/verschieben/absagen (Zeitzonen!)
node scripts/test-crm-sprache.js # CRM per Sprache: Lead, Notiz, Wiedervorlage, Anruf
node scripts/shot-alles.js    # Screenshots aller Seiten in hell & dunkel (braucht Chrome)
```

---

## Wichtig: Sicherheit

- Die **`.env`** enthält alle Passwörter und Schlüssel. Sie ist bewusst **nicht**
  im Repo. Niemals committen, niemals über WhatsApp/Mail schicken — und
  **niemals als Screenshot verschicken** (ist schon zweimal passiert, danach
  müssen alle Schlüssel neu erzeugt werden).
- **Keine Kundendaten** ins Repo. Die gehören nur in die Datenbank.
- Aktuell hängt die lokale Entwicklung an **derselben echten Datenbank** wie der
  Server. Solange kaum echte Daten drin sind, ist das ok — zum Ausprobieren
  `test-crm.js` nutzen, das räumt hinter sich auf. Sobald echte Kundendaten
  wachsen, richten wir eine getrennte Test-Datenbank ein.
