---
name: flowstate-os-api
description: So sprichst du das Flowstate OS (Dashboard von svh Consulting) per HTTP an, um Meldungen zu schicken, Aufgaben anzulegen, Rechnungsentwürfe, Content-Posts und Notizen zu erzeugen. Nutzen, sobald ein Auftrag etwas im OS anlegen oder melden soll.
---

# Flowstate OS per HTTP

Basis-URL: `$FLOWSTATE_OS_URL` (im Docker-Netz `http://flowstate-dashboard:3000`).
Alle Aufrufe mit `curl -s --max-time 20`. Antworten sind JSON. Bei Fehler (kein 2xx) den Fehlertext in `offene_fragen` melden, nicht erneut raten.

## 1. Anmelden (einmal je Auftrag)

Das OS kennt dich über den Dienst-Token. Er ergibt eine Sitzung als Dienstkonto (Admin), die du als Cookie mitschickst:

```bash
curl -s -c /tmp/os.cookie -X POST "$FLOWSTATE_OS_URL/intern/dienst-anmelden" \
  -H "content-type: application/json" -H "x-dienst-token: $FLOWSTATE_OS_TOKEN" -d '{}'
# Antwort: {"ok":true,"konto":"…"}  — danach bei jedem Aufruf: -b /tmp/os.cookie
```

## 2. Meldung an Lukas (Telegram)

```bash
curl -s -X POST "$FLOWSTATE_OS_URL/api/melde" \
  -H "content-type: application/json" -H "x-melde-secret: $MELDE_SECRET" \
  -d '{"text": "Kurz und konkret, ein bis zwei Sätze.", "stimme": false}'
```
Nur für Zwischenstände, die Lukas sofort wissen muss. Ergebnisse gehören in den JSON-Block deiner Antwort, nicht in eine Meldung.

## 3. Lesen (mit Cookie)

| Zweck | Aufruf |
|---|---|
| Kennzahlen CRM | `GET /api/crm/stats` |
| Aufgaben heute | `GET /api/todos/stats` |
| Kalender heute | `GET /api/kalender/tag` |
| Buchhaltung | `GET /api/buchhaltung/stats` |
| Auftragsbuch (deine Aufträge) | `GET /api/agent/auftraege` |

## 4. Anlegen (mit Cookie)

| Zweck | Aufruf | Stand |
|---|---|---|
| Aufgabe anlegen | `POST /todos/anlegen` Formularfelder `titel, faellig (JJJJ-MM-TT), notiz` | vorhanden |
| Notiz an Kundenakte | über das CRM-Modul, Route wird in Stufe 2.8 ergänzt | offen |
| Rechnungsentwurf | Stufe 2.8 | offen |
| Content-Post oder Idee | Stufe 2.8 | offen |
| Leads nachschieben | Stufe 2.8 | offen |

Was hier "offen" steht, nicht erraten: Ergebnis im JSON-Block zurückgeben und unter `offene_fragen` vermerken, was im OS angelegt werden müsste.

## Regeln
- Versand, Veröffentlichung und Geldbewegung gibt es hier nicht. Das sind ROT-Aktionen, die das OS nach Freigabe selbst auslöst.
- Keine Kundendaten in Meldungen, nur Bezeichner (Firma, Rechnungsnummer).
