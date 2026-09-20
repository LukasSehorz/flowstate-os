# hermes/ · Hermes Agent, neu aufgesetzt

Stand 19.09.2026. Gehört zu Stufe 1 des Plans im Vault: `projekte/2026-09-hermes-neuaufbau.md`.

## Was hier liegt

| Datei | Wohin auf dem Server | Zweck |
|---|---|---|
| `docker-compose.yml` | `/docker/hermes/` | Container, Vault-Mount als `/opt/data/wissen`, Netz `hermes_default`, kein Port nach außen |
| `.env.beispiel` | `/docker/hermes/.env` (mit frischen Schlüsseln) | API-Server, Dashboard-Login, OS-Token |
| `config.yaml` | `/docker/hermes/data/config.yaml` | Modelle über das ChatGPT-Pro-Abo, Hilfsaufgaben auf dem kleinen Modell, Freigaben, Sperren |
| `SOUL.md` | `/docker/hermes/data/SOUL.md` | Rolle, Zonen aus REGELN.md, Antwortformat (JSON) |
| `skills/flowstate-os-api/` | `/docker/hermes/data/skills/` | Wie Hermes das OS anspricht |
| `vault-sync.sh` | `/docker/hermes/` + `/etc/cron.d/flowstate-vault-sync` | Vault alle 5 min nach GitHub und zurück |
| `einrichten.sh` | wird auf dem Server ausgeführt | alles oben in einem Lauf, idempotent |

Die Kontextdatei für den Vault (`AGENTS.md`) liegt im Vault-Repo selbst, nicht hier.

## Ausrollen

```
ssh flowstate 'cd /opt/flowstate-dashboard && git pull --ff-only && sh hermes/einrichten.sh'
ssh -t flowstate 'docker exec -it hermes hermes model'      # Abo-Login, einmalig, mit Lukas
ssh flowstate 'docker exec hermes hermes doctor'
```

## Was das Dashboard danach braucht (Stufe 2)

- `docker-compose.yml` des Dashboards: Netz `hermes_default` statt `hermes-agent-pocv_default`, Vault-Mount von `/opt/flowstate-vault`, gws-cli-Token aus `/docker/hermes/data/.config`, Lesemounts für die Seite Agenten aus `/docker/hermes/data`.
- `.env` des Dashboards: `HERMES_CHAT_URL=http://hermes:8642/v1/chat/completions`, `HERMES_API_KEY` = `API_SERVER_KEY` aus `/docker/hermes/.env`, `DIENST_TOKEN` = `FLOWSTATE_OS_TOKEN`.

## Zweites Profil `schnell` (nach der Abnahme von Stufe 1)

Für Kurzantworten ohne Werkzeuge und mit dem kleinen Modell:

```
docker exec hermes hermes profile create schnell
# in /docker/hermes/data/profiles/schnell/.env: API_SERVER_ENABLED=true, API_SERVER_PORT=8643, eigener API_SERVER_KEY
# in /docker/hermes/data/profiles/schnell/config.yaml: model.default = kleines Modell, alle Werkzeuge aus
docker exec hermes hermes -p schnell gateway start
```

Ob der Login pro Profil nötig ist und ob der zweite Gateway beim Neustart des Containers von selbst mitstartet, wird beim Einrichten geprüft (F15). Bis dahin läuft alles über das eine Profil.

## Was bewusst fehlt

Kein Telegram-Bot für Hermes (der Chat läuft über das OS), kein API-Schlüssel (Abo), keine Ports nach außen, keine Browser-Automation (kommt in Stufe 4).
