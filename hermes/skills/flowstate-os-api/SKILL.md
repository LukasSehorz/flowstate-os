---
name: flowstate-os-api
description: So sprichst du das Flowstate OS (Dashboard) per HTTP an, um Meldungen zu schicken, Aufgaben anzulegen, Rechnungsentwürfe, Content-Posts und Notizen zu erzeugen. Nutzen, sobald ein Auftrag etwas im OS anlegen oder melden soll.
---

# Flowstate OS per HTTP

Basis-URL: `$FLOWSTATE_OS_URL` (im Docker-Netz `http://flowstate-dashboard:3000`).
Alle Aufrufe mit `curl -s --max-time 20`. Antworten sind JSON. Bei Fehler (kein 2xx) den Fehlertext in `offene_fragen` melden, nicht erneut raten.

## Heute schon nutzbar

**Meldung an Lukas** (Telegram oder Stimme, je nach Einstellung des OS):
```bash
curl -s -X POST "$FLOWSTATE_OS_URL/api/melde" \
  -H "content-type: application/json" -H "x-melde-secret: $MELDE_SECRET" \
  -d '{"text": "Kurz und konkret, ein bis zwei Sätze.", "stimme": false}'
```
Nur für Zwischenstände, die Lukas sofort wissen muss. Ergebnisse gehören in den JSON-Block der Antwort, nicht in eine Meldung.

## Ab Stufe 2 (Dienst-Token)

Kopfzeile bei allen JSON-Routen: `x-dienst-token: $FLOWSTATE_OS_TOKEN`.

| Zweck | Aufruf | Stand |
|---|---|---|
| Aufgabe anlegen | `POST /todos/anlegen` `{titel, faellig, verantwortlich, notiz}` | Stufe 2.6 |
| Rechnungsentwurf | `POST /buchhaltung/rechnungen/entwurf` `{firma_id, positionen[], notiz}` | Stufe 2.8 |
| Content-Post oder Idee | `POST /content/anlegen` `{kanal, titel, text, stufe}` | Stufe 2.8 |
| Notiz an Kundenakte | `POST /crm/firma/:id/notiz` `{text}` | Stufe 2.6 |
| Leads nachschieben | `POST /leads/nachschub` `{zielgruppe, anzahl}` | Stufe 2.8 |
| Auftrag als erledigt melden | `POST /api/agent/ergebnis` `{auftrag_id, ergebnis}` | Stufe 2.2 |

Die genauen Felder liefert Stufe 2. Bis dahin: nichts davon aufrufen, sondern das Ergebnis im JSON-Block zurückgeben und unter `offene_fragen` vermerken, was im OS angelegt werden müsste.

## Regeln
- Versand, Veröffentlichung und Geldbewegung gibt es hier nicht. Das sind ROT-Aktionen, die das OS nach Freigabe selbst auslöst.
- Keine Kundendaten in Meldungen, nur Bezeichner (Firma, Rechnungsnummer).
