#!/bin/sh
# Den BETRIEB deployen. Fasst die Drehkulisse nicht an.
#
#   ./deploy.sh          ziehen, bauen, starten — und sagen, worauf es steht
#   ./deploy.sh stand    nur nachsehen
#
# Die Kulisse laeuft in einem EIGENEN Container und hat ein eigenes Skript:
# ./dreh.sh an | aus | stand | creative N
#
# WARUM DIESES SKRIPT UEBERHAUPT: Weil .env am 21.08.2026 dreimal an der
# falschen Datenbank hing und es jedes Mal erst auffiel, als jemand sich nicht
# mehr anmelden konnte. Es passiert leicht — das Dashboard sieht mit
# erfundenen Kunden genauso normal aus wie mit echten. Darum sagt jeder Deploy
# jetzt hinterher, in welcher Datenbank er gelandet ist.
#
# WAS HIER BEWUSST NICHT MEHR DRINSTEHT: Ein Umschalten der Umgebung. Kurz gab
# es hier ein "dreh-an", das .env gegen .env.dreh tauschte. Solange zwei Leute
# gleichzeitig am Server arbeiten, ist eine Datei, die beide Bedeutungen haben
# kann, genau die Falle, die sie vermeiden sollte: .env stand danach auf der
# Drehdatenbank, ohne dass es jemand gemerkt hatte. Jetzt gilt fest —
#
#     .env      = Betrieb, echte Daten     (dieses Skript)
#     .env.dreh = Kulisse, erfundene Daten (./dreh.sh)
#
# und keines der beiden Skripte schreibt in die Datei des anderen.
set -e
cd "$(dirname "$0")"

stand() {
  ECHT=$(grep -oE 'postgres\.[a-z]+' .env | head -1)
  KULISSE=$(grep -oE 'postgres\.[a-z]+' .env.dreh 2>/dev/null | head -1)
  echo "in .env:      $ECHT"
  if docker ps --format '{{.Names}}' | grep -qx flowstate-dashboard; then
    IST=$(docker exec flowstate-dashboard printenv DATABASE_URL | grep -oE 'postgres\.[a-z]+')
    echo "im Container: $IST"
    if [ -n "$KULISSE" ] && [ "$IST" = "$KULISSE" ]; then
      echo
      echo "ACHTUNG: Der Betrieb laeuft auf der DREHDATENBANK."
      echo "Im Dashboard stehen dann erfundene Kunden, und die echten Konten"
      echo "koennen sich nicht anmelden. Richtige .env wiederherstellen:"
      echo "    cp .env.betrieb .env && ./deploy.sh"
    fi
  else
    echo "im Container: (laeuft nicht)"
  fi
}

if [ "$1" = "stand" ]; then stand; exit 0; fi

git pull --ff-only
# --env-file ausdruecklich: Compose merkt sich, womit ein Projekt zuletzt
# gestartet wurde, und nimmt es beim naechsten Mal wieder. Ein einziger Aufruf
# mit der falschen Datei wirkte darum weiter, auch als der Befehl schon wieder
# der gewohnte war.
docker compose --env-file .env up -d --build
sleep 8
stand
