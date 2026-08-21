#!/bin/sh
# Deployen — und dabei nicht aus Versehen die Dreh-Umgebung abraeumen.
#
# WARUM ES DAS GIBT (21.08.2026): Der gewohnte Befehl lautet
#   git pull && docker compose up -d --build
# Der nimmt IMMER .env, also die echte Datenbank. Waehrend der Anzeigen-Aufnahmen
# laeuft das Dashboard aber auf .env.dreh — erfundene Kunden, erfundene Zahlen.
# Ein Deploy zwischendurch hat die Kulisse still abgeraeumt: Das Dashboard zeigte
# wieder echte Kundennamen, und die Anmeldung der Dreh-Konten ging ins Leere.
# Gemerkt haben wir es erst, weil ein Test sich nicht mehr anmelden konnte.
#
# Jetzt entscheidet eine Datei: Liegt DREH-LAEUFT im Verzeichnis, wird mit
# .env.dreh gebaut, sonst mit .env.
#
#   ./deploy.sh            deployen, Umgebung bleibt wie sie ist
#   ./deploy.sh dreh-an    auf die Dreh-Umgebung umstellen und deployen
#   ./deploy.sh dreh-aus   zurueck auf den Betrieb und deployen
set -e
cd "$(dirname "$0")"
case "$1" in
  dreh-an)  touch DREH-LAEUFT ;;
  dreh-aus) rm -f DREH-LAEUFT ;;
esac
if [ -f DREH-LAEUFT ]; then UMGEBUNG=.env.dreh; else UMGEBUNG=.env; fi
echo "Umgebung: $UMGEBUNG"
git pull --ff-only
docker compose --env-file "$UMGEBUNG" up -d --build
sleep 8
ZIEL=$(docker exec flowstate-dashboard printenv DATABASE_URL | grep -oE "postgres\.[a-z]+")
echo "Datenbank: $ZIEL"
if [ -f DREH-LAEUFT ]; then
  echo "DREH LAEUFT — Creative $(( $(docker exec flowstate-dashboard printenv DREH_CREATIVE) + 1 ))"
else
  echo "Normalbetrieb."
fi
