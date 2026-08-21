#!/bin/sh
# Die Drehkulisse starten, ansehen, stoppen — ohne den Betrieb anzufassen.
#
# WOZU: Waehrend der Anzeigen-Aufnahmen laeuft ein ZWEITES Dashboard auf der
# Drehdatenbank. Der Betrieb bleibt daneben stehen und wird deployt wie immer.
#
#   flowstate.srv1044804.hstgr.cloud   Betrieb, echte Daten
#   dreh.srv1044804.hstgr.cloud        Kulisse, erfundene Daten
#
#   ./dreh.sh an          Kulisse bauen und starten
#   ./dreh.sh aus         Kulisse stoppen und entfernen
#   ./dreh.sh stand       worauf steht welcher Container?
#   ./dreh.sh creative N  Creative 1–4 als Vorgabe der Kulisse setzen
#   ./dreh.sh kalender    die vier Calls aus C2_05 auf HEUTE setzen
#   ./dreh.sh log         die letzten Zeilen aus dem Kulissen-Container
set -e
cd "$(dirname "$0")"

COMPOSE="docker compose -p flowstate-dreh --env-file .env.dreh \
  -f docker-compose.yml -f docker-compose.dreh.yml"

ref() { docker exec "$1" printenv DATABASE_URL 2>/dev/null | grep -oE 'postgres\.[a-z]+' || echo "—"; }
laeuft() { docker ps --format '{{.Names}}' | grep -qx "$1"; }

stand() {
  echo "Betrieb   flowstate-dashboard   $(laeuft flowstate-dashboard && ref flowstate-dashboard || echo 'steht nicht')"
  if laeuft flowstate-dreh; then
    N=$(docker exec flowstate-dreh printenv DREH_CREATIVE 2>/dev/null || echo 0)
    echo "Kulisse   flowstate-dreh        $(ref flowstate-dreh)   Creative $(( N + 1 ))"
    echo "          https://dreh.srv1044804.hstgr.cloud/sprache"
  else
    echo "Kulisse   flowstate-dreh        steht nicht"
  fi
}

case "$1" in
  an)
    [ -f .env.dreh ] || { echo "FEHLER: .env.dreh fehlt."; exit 1; }
    # Die Sicherung gegen den schlimmsten Fall: Wenn in .env.dreh dieselbe
    # Datenbank steht wie im Betrieb, laeuft der ganze Dreh auf echten Daten und
    # niemandem faellt es auf, bis ein Kundenname im Bild steht.
    A=$(grep -oE 'postgres\.[a-z]+' .env.dreh | head -1)
    B=$(grep -oE 'postgres\.[a-z]+' .env | head -1)
    if [ "$A" = "$B" ]; then
      echo "ABBRUCH: .env.dreh zeigt auf dieselbe Datenbank wie .env ($A)."
      exit 1
    fi
    $COMPOSE up -d --build dashboard
    sleep 8
    stand
    ;;
  aus)
    $COMPOSE down
    echo "Kulisse abgebaut. Der Betrieb lief die ganze Zeit weiter."
    ;;
  creative)
    N="$2"
    case "$N" in
      1|2|3|4) ;;
      *) echo "Welches Creative? 1, 2, 3 oder 4."; exit 1 ;;
    esac
    # Intern wird ab null gezaehlt. Diese eine Stelle rechnet um, damit am Set
    # niemand mehr ueber die Verschiebung stolpert.
    grep -v '^DREH_CREATIVE=' .env.dreh > .env.dreh.neu
    echo "DREH_CREATIVE=$(( N - 1 ))" >> .env.dreh.neu
    mv .env.dreh.neu .env.dreh
    chmod 600 .env.dreh
    $COMPOSE up -d dashboard
    sleep 6
    stand
    ;;
  kalender)
    # Die vier Calls aus C2_05 auf HEUTE setzen. Vor jedem Drehtag einmal.
    # Ohne das steht am naechsten Tag ein leeres Tagesraster im Bild, waehrend
    # Erik vier Termine vorliest.
    docker cp scripts/dreh-kalender.js flowstate-dreh:/app/scripts/dreh-kalender.js >/dev/null
    docker exec -w /app flowstate-dreh node scripts/dreh-kalender.js "$2"
    ;;
  log)  docker logs --tail "${2:-40}" flowstate-dreh ;;
  stand|"") stand ;;
  *) echo "Unbekannt: $1  —  an | aus | stand | creative N | kalender | log"; exit 1 ;;
esac
