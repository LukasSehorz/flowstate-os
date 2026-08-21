#!/bin/sh
# Deployen — und dabei nicht aus Versehen die Drehkulisse abraeumen.
#
# WAS AM 21.08.2026 ZWEIMAL PASSIERT IST: Der gewohnte Befehl
#     git pull && docker compose up -d --build
# nimmt IMMER .env, also die echte Datenbank. Waehrend der Anzeigen-Aufnahmen
# laeuft das Dashboard aber auf der Drehdatenbank mit erfundenen Kunden und
# Zahlen. Ein Deploy zwischendurch hat die Kulisse still abgeraeumt: Das
# Dashboard zeigte wieder echte Kundennamen, und die Dreh-Konten konnten sich
# nicht mehr anmelden. Beide Male ist es erst aufgefallen, weil ein Test sich
# nicht mehr einloggen konnte.
#
# WARUM NICHT EINFACH --env-file: Weil dann jeder, der den Befehl aus der
# Historie holt, die Kulisse wieder abraeumt. Die sichere Stellung muss die
# VORGABE sein, nicht die Ausnahme. Darum tauscht dieses Skript die Dateien:
# Waehrend des Drehs IST .env die Drehumgebung, und der Betrieb liegt daneben
# in .env.betrieb. Dann ist es gleichgueltig, welchen Befehl jemand tippt.
#
#   ./deploy.sh            deployen, Umgebung bleibt wie sie ist
#   ./deploy.sh dreh-an    auf die Drehumgebung umstellen und deployen
#   ./deploy.sh dreh-aus   zurueck in den Betrieb und deployen
#   ./deploy.sh stand      nur nachsehen, worauf das System gerade steht
set -e
cd "$(dirname "$0")"

ref() { grep -oE 'postgres\.[a-z]+' "$1" 2>/dev/null | head -1; }

stand() {
  if [ -f DREH-LAEUFT ]; then
    echo "Umgebung:  DREH  (erfundene Daten)"
  else
    echo "Umgebung:  Betrieb  (echte Daten)"
  fi
  echo "in .env:   $(ref .env)"
  if [ -x "$(command -v docker)" ] && docker ps --format '{{.Names}}' | grep -q flowstate-dashboard; then
    echo "im Container: $(docker exec flowstate-dashboard printenv DATABASE_URL | grep -oE 'postgres\.[a-z]+')"
    if [ -f DREH-LAEUFT ]; then
      echo "Creative:  $(( $(docker exec flowstate-dashboard printenv DREH_CREATIVE) + 1 ))"
    fi
  fi
}

case "$1" in
  stand) stand; exit 0 ;;
  dreh-an)
    [ -f .env.dreh ] || { echo "FEHLER: .env.dreh gibt es nicht."; exit 1; }
    # Den Betrieb sichern, BEVOR .env ueberschrieben wird — und nur beim ersten
    # Mal, sonst waere die Sicherung nach dem zweiten Aufruf die Drehumgebung.
    [ -f .env.betrieb ] || cp .env .env.betrieb
    cp .env.dreh .env
    chmod 600 .env .env.betrieb
    touch DREH-LAEUFT
    echo "Umgestellt auf die Drehumgebung. Der Betrieb liegt in .env.betrieb."
    ;;
  dreh-aus)
    [ -f .env.betrieb ] || { echo "FEHLER: .env.betrieb fehlt — .env nicht angefasst."; exit 1; }
    cp .env.betrieb .env
    chmod 600 .env
    rm -f DREH-LAEUFT
    echo "Zurueck im Betrieb."
    ;;
esac

git pull --ff-only
docker compose up -d --build
sleep 8
stand
