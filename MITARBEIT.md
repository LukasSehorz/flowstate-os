# Mitarbeit am flowstateOS

Kurzanleitung für die gemeinsame Entwicklung von Lukas & Jannik.
Jannik arbeitet vor allem am **CRM**, Lukas am **Operating System** drumherum.
Beides ist dieselbe Anwendung (`flowstate-dashboard`), deshalb ein paar einfache Regeln.

---

## Einmal einrichten (Jannik)

Voraussetzung: [Node.js](https://nodejs.org) (Version 22) und [Git](https://git-scm.com) installiert.

```bash
# 1. Repo klonen (du bist schon als Collaborator eingeladen)
git clone https://github.com/LukasSehorz/flowstate-dashboard.git
cd flowstate-dashboard

# 2. Pakete installieren
npm install

# 3. Zugangsdaten einrichten
#    Vorlage kopieren und die echten Werte von Lukas eintragen (bekommst du separat)
copy .env.beispiel .env
#    -> .env in einem Editor oeffnen und die Werte einsetzen

# 4. Starten
npm start
#    Laeuft dann auf http://localhost:3000
```

Anmelden mit deinem persönlichen Konto (E-Mail + Passwort, das Lukas dir gibt).

> Der **Vault** (`flowstate-vault`) ist Alexandras Wissen und für die CRM-Arbeit
> kaum nötig. Wenn du ihn trotzdem willst, klon ihn daneben und setz `VAULT_PATH`
> in der `.env` auf den Ordner.

---

## Wo was liegt

| Bereich | Dateien |
|---|---|
| **CRM** (Janniks Baustelle) | `lib/crm.js`, `lib/crm-routes.js`, `public/crm.css` |
| **Operating System** (Lukas) | `server.js`, `lib/sprache-routes.js`, `lib/zustand.js`, die OS-Seiten |
| **Gemeinsam** (Absprache nötig!) | `lib/schale.js` (Hülle), `public/crm.css` (Design für beides), `server.js` (verdrahtet alles) |
| Datenbank-Struktur | `supabase/*.sql` |

---

## So arbeiten wir zusammen — ohne uns zu überschreiben

**`main` ist heilig.** Das ist die Version, die auf dem Server läuft. Da wird nie
direkt drin gebastelt — nur fertige, getestete Sachen landen dort.

Jeder arbeitet in seiner eigenen Spur (Branch):
- Jannik → `crm`
- Lukas → `os`

### Der Ablauf im Alltag

```bash
# Morgens, bevor du anfängst: den neuesten Stand holen
git checkout main
git pull
git checkout crm        # (Lukas: os)
git merge main          # deinen Branch auf den neuesten Stand bringen

# ... arbeiten ...

# Kleine Häppchen, oft speichern:
git add -A
git commit -m "kurz was du geändert hast"
git push
```

### Wenn ein Stück fertig und getestet ist → in `main`

Am einfachsten über GitHub:
1. Auf github.com beim Repo erscheint „Compare & pull request" — draufklicken.
2. Der andere schaut kurz drüber, dann **Merge**.
3. Danach spielt **Lukas** es auf den Server (siehe unten).

### Vier Regeln, die 90 % der Probleme lösen

1. **Morgens immer zuerst `git pull`** — dann hast du den Stand des anderen.
2. **Klein und oft pushen**, nicht tagelang sammeln. Je kleiner die Häppchen, desto seltener kollidiert etwas.
3. **Bei den geteilten Dateien** (`schale.js`, `crm.css`, `server.js`) kurz im Raum Bescheid sagen, wer sie gerade anfasst.
4. **Nur Lukas deployt auf den Server.** Jannik entwickelt lokal und pusht zu GitHub.

Wenn Git beim `merge` oder `pull` „conflict" meldet: nicht raten — kurz zusammensetzen.
Das passiert nur, wenn beide dieselbe Zeile geändert haben, und ist schnell gelöst.

---

## Auf den Server bringen (nur Lukas)

```bash
cd /opt/flowstate-dashboard
git pull
docker compose up -d --build
```
Danach im Browser **Strg+F5**.

---

## Testen

```bash
node scripts/test-crm.js      # CRM-Logik + Rechtetrennung (räumt seine Testdaten selbst weg)
node scripts/test-kalender.js # Kalender-Auswertung
node scripts/test-sprache.js  # Sprach-Verstehen (Sonnet + Haiku-Reserve, ohne echte API)
node scripts/test-kontakte.js # WhatsApp-Kontaktaufloesung (LID vs. echte Nummer) + Gruppen-Freigabe
node scripts/test-gespraech.js  # Welche Saetze beenden das Gespraech, welche nicht
node scripts/test-erzaehlspur.js # Streaming-Empfang von Hermes (Zwischenstaende)
node scripts/test-plan.js     # Vorgehensplan, den sie waehrend der Arbeit erzaehlt
node scripts/test-prompt.js   # Wacht ueber die Regeln im System-Prompt (Groesse + Inhalt)
node scripts/test-suche.js    # Schnelles Nachschlagen (--netz fuer den Wikipedia-Teil)
node scripts/test-termin.js   # Termin direkt eintragen (Zeitumrechnung, Zeitzonen)
node scripts/shot-alles.js    # Screenshots aller Seiten in hell & dunkel (braucht Chrome)
```

---

## Wichtig: Sicherheit

- Die **`.env`** enthält alle Passwörter und Schlüssel. Sie ist bewusst **nicht** im Repo
  (steht in `.gitignore`). Niemals committen, niemals über WhatsApp/Mail schicken.
- **Keine Kundendaten** ins Repo. Die gehören nur in die Datenbank.
- Aktuell hängt die lokale Entwicklung an **derselben echten Datenbank** wie der Server.
  Solange kaum echte Daten drin sind, ist das ok — beim Ausprobieren mit `test-crm.js`
  arbeiten, das räumt hinter sich auf. Sobald echte Kundendaten wachsen, richten wir
  eine getrennte Test-Datenbank ein.
