#!/bin/sh
# Hermes auf dem Server neu aufsetzen (Stufe 1 des Plans vom 19.09.2026).
#
#   ssh flowstate 'cd /opt/flowstate-dashboard && git pull --ff-only && sh hermes/einrichten.sh'
#
# Idempotent: kann mehrfach laufen. Loescht nichts. Der alte Stack
# (/docker/hermes-agent-pocv) wird nur angehalten und als Archiv gesichert.
#
# Danach bleibt EIN Schritt fuer Lukas: der Geraetecode-Login mit dem
# ChatGPT-Pro-Abo (siehe Ausgabe am Ende).
set -e
HIER=$(cd "$(dirname "$0")" && pwd)
ZIEL=/docker/hermes
VAULT=/opt/flowstate-vault
ALT=/docker/hermes-agent-pocv
STAMP=$(date '+%Y%m%d-%H%M')

echo "== 1. Voraussetzungen"
command -v docker >/dev/null || { echo "docker fehlt"; exit 1; }
command -v git >/dev/null || { echo "git fehlt"; exit 1; }
echo "   Speicher: $(free -m | awk '/^Mem:/{print $2" MB gesamt, "$7" MB frei"}') · CPUs: $(nproc)"

echo "== 2. Vault als eigener Git-Klon unter $VAULT"
if [ ! -d "$VAULT/.git" ]; then
  if [ -d "$ALT/data/vault/.git" ]; then
    echo "   uebernehme den Klon aus dem alten Stack (mit allen lokalen Aenderungen)"
    cp -a "$ALT/data/vault" "$VAULT"
  else
    GIT_SSH_COMMAND="ssh -o BatchMode=yes" git clone -q git@github.com:LukasSehorz/flowstate-vault.git "$VAULT"
  fi
fi
git config --global --add safe.directory "$VAULT" >/dev/null 2>&1 || true
chown -R 10000:10000 "$VAULT"
echo "   Stand: $(git -C "$VAULT" log --format='%h %ad %s' --date=short -1)"

echo "== 3. Vault-Sync per Cron (alle 5 Minuten)"
mkdir -p "$ZIEL"
cp "$HIER/vault-sync.sh" "$ZIEL/vault-sync.sh" && chmod +x "$ZIEL/vault-sync.sh"
printf 'SHELL=/bin/sh\nPATH=/usr/local/bin:/usr/bin:/bin\n*/5 * * * * root %s/vault-sync.sh >/dev/null 2>&1\n' "$ZIEL" > /etc/cron.d/flowstate-vault-sync
chmod 644 /etc/cron.d/flowstate-vault-sync
if crontab -l 2>/dev/null | grep -q vault-sync; then
  echo "   ACHTUNG: In 'crontab -l' steht noch der alte vault-sync. Bitte entfernen (crontab -e)."
fi

echo "== 4. Alten Stack anhalten und sichern (nichts wird geloescht)"
if [ -f "$ALT/docker-compose.yml" ]; then
  (cd "$ALT" && docker compose stop >/dev/null 2>&1 || true)
  if [ ! -f "/docker/hermes-agent-pocv-archiv-$STAMP.tgz" ] && ! ls /docker/hermes-agent-pocv-archiv-*.tgz >/dev/null 2>&1; then
    tar -czf "/docker/hermes-agent-pocv-archiv-$STAMP.tgz" -C /docker hermes-agent-pocv --exclude='hermes-agent-pocv/data/vault'
    echo "   Archiv: /docker/hermes-agent-pocv-archiv-$STAMP.tgz"
  fi
fi

echo "== 5. Neuer Stack unter $ZIEL"
mkdir -p "$ZIEL/data/skills" "$ZIEL/data/.config"
cp "$HIER/docker-compose.yml" "$ZIEL/docker-compose.yml"
cp "$HIER/config.yaml" "$ZIEL/data/config.yaml"
cp "$HIER/SOUL.md" "$ZIEL/data/SOUL.md"
cp -R "$HIER/skills/flowstate-os-api" "$ZIEL/data/skills/"
if [ ! -f "$ZIEL/.env" ]; then
  sed -e "s|^API_SERVER_KEY=.*|API_SERVER_KEY=$(openssl rand -hex 24)|" \
      -e "s|^HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=.*|HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=$(openssl rand -hex 12)|" \
      -e "s|^FLOWSTATE_OS_TOKEN=.*|FLOWSTATE_OS_TOKEN=$(openssl rand -hex 24)|" \
      -e "s|^MELDE_SECRET=.*|MELDE_SECRET=$(grep -E '^MELDE_SECRET=' /opt/flowstate-dashboard/.env 2>/dev/null | cut -d= -f2-)|" \
      "$HIER/.env.beispiel" > "$ZIEL/.env"
  chmod 600 "$ZIEL/.env"
  echo "   .env mit frischen Schluesseln erzeugt"
fi
# Google-Token (Mail, Kalender) aus dem alten Stack mitnehmen, falls vorhanden.
if [ -d "$ALT/data/.config/gws-cli" ] && [ ! -d "$ZIEL/data/.config/gws-cli" ]; then
  cp -a "$ALT/data/.config/gws-cli" "$ZIEL/data/.config/"
  echo "   gws-cli-Token uebernommen"
fi
chown -R 10000:10000 "$ZIEL/data"

echo "== 6. Starten"
cd "$ZIEL"
docker compose pull -q
docker compose up -d
echo "   Image-Digest (zum Pinnen): $(docker inspect --format='{{index .RepoDigests 0}}' nousresearch/hermes-agent:latest 2>/dev/null)"
echo "   warte auf /health ..."
i=0
until docker exec hermes python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8642/health', timeout=5)" >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 24 ] && { echo "   Hermes antwortet nach 2 Minuten nicht. docker logs hermes"; exit 1; }
  sleep 5
done
echo "   Hermes antwortet. Version: $(docker exec hermes hermes --version 2>/dev/null | head -1)"

echo
echo "== FERTIG. Ein Schritt fuer Lukas bleibt: der Abo-Login."
echo "   ssh -t flowstate 'docker exec -it hermes hermes model'"
echo "   -> 'ChatGPT or Codex Subscription' waehlen, Link im Browser oeffnen,"
echo "      Code eingeben, dann gpt-6-astra als Modell waehlen (F1) und"
echo "      notieren, welche kleinen Modelle der Picker anbietet (F13)."
echo "   Danach: docker exec hermes hermes doctor  ·  docker exec hermes hermes chat -q 'Wer bist du?'"
