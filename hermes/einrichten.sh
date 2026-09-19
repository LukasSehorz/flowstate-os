#!/bin/sh
# Hermes auf dem Server neu aufsetzen (Stufe 1 des Plans vom 19.09.2026).
#
#   ssh flowstate 'cd /opt/flowstate-dashboard && git pull --ff-only && sh hermes/einrichten.sh'
#
# Idempotent: kann mehrfach laufen. Loescht nichts. Der alte Stack
# (/docker/hermes-agent-pocv) wird nur angehalten und als Archiv gesichert.
#
# Befunde vom 19.09.2026, auf die das Skript reagiert:
#   - Der alte Hermes (v0.18.2, Hostinger-Image) hatte den Abo-Login schon
#     (auth.json, Provider openai-codex). Er wird uebernommen; klappt das
#     nicht, bleibt der Geraetecode-Login (Ausgabe am Ende).
#   - Der Vault lag IM Datenordner des alten Hermes und haengt an einer
#     HTTPS-Adresse ohne Zugangsdaten. Er wird nach /opt/flowstate-vault
#     verschoben (mv, kein Kopieren: das laufende Dashboard behaelt seinen
#     Mount) und bekommt einen Symlink am alten Ort plus eine SSH-Adresse.
set -e
HIER=$(cd "$(dirname "$0")" && pwd)
ZIEL=/docker/hermes
VAULT=/opt/flowstate-vault
ALT=/docker/hermes-agent-pocv
KEY=/root/.ssh/flowstate_vault
STAMP=$(date '+%Y%m%d-%H%M')

echo "== 1. Voraussetzungen"
command -v docker >/dev/null || { echo "docker fehlt"; exit 1; }
command -v git >/dev/null || { echo "git fehlt"; exit 1; }
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -f "$KEY" -N "" -C "flowstate-vault-sync@$(hostname)"
echo "   Speicher: $(free -m | awk '/^Mem:/{print $2" MB gesamt, "$7" MB frei"}') · CPUs: $(nproc)"

echo "== 2. Vault als eigener Git-Klon unter $VAULT"
if [ ! -d "$VAULT/.git" ]; then
  if [ -d "$ALT/data/vault/.git" ] && [ ! -L "$ALT/data/vault" ]; then
    echo "   verschiebe den Klon aus dem alten Stack (alle lokalen Commits bleiben)"
    mv "$ALT/data/vault" "$VAULT"
    ln -s "$VAULT" "$ALT/data/vault"
  else
    GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes" git clone -q git@github.com:LukasSehorz/flowstate-vault.git "$VAULT"
  fi
fi
git config --global --add safe.directory "$VAULT" >/dev/null 2>&1 || true
git -C "$VAULT" remote set-url origin git@github.com:LukasSehorz/flowstate-vault.git
chown -R 10000:10000 "$VAULT"
echo "   Stand: $(git -C "$VAULT" log --format='%h %ad %s' --date=short -1)"

echo "== 3. Vault-Sync per Cron (alle 5 Minuten, ueber den Deploy-Key)"
mkdir -p "$ZIEL"
cp "$HIER/vault-sync.sh" "$ZIEL/vault-sync.sh" && chmod +x "$ZIEL/vault-sync.sh"
printf 'SHELL=/bin/sh\nPATH=/usr/local/bin:/usr/bin:/bin\n*/5 * * * * root %s/vault-sync.sh >/dev/null 2>&1\n' "$ZIEL" > /etc/cron.d/flowstate-vault-sync
chmod 644 /etc/cron.d/flowstate-vault-sync
if crontab -l 2>/dev/null | grep -q "vault-sync"; then
  crontab -l | grep -v "vault-sync" | crontab -
  echo "   alten Crontab-Eintrag (/root/vault-sync.sh, HTTPS ohne Zugang) entfernt"
fi
if ! GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15" git -C "$VAULT" ls-remote -q origin >/dev/null 2>&1; then
  echo "   HINWEIS: GitHub nimmt den Deploy-Key noch nicht an. Auf GitHub im Repo"
  echo "   flowstate-vault unter Settings > Deploy keys eintragen (Allow write access):"
  cat "$KEY.pub" | sed 's/^/     /'
fi

echo "== 4. Alten Stack anhalten und sichern (nichts wird geloescht)"
if [ -f "$ALT/docker-compose.yml" ]; then
  (cd "$ALT" && docker compose stop >/dev/null 2>&1 || true)
  if ! ls /docker/hermes-agent-pocv-archiv-*.tgz >/dev/null 2>&1; then
    # --exclude MUSS vor den Pfaden stehen (GNU tar wertet spaetere Optionen nicht mehr).
    tar --exclude='hermes-agent-pocv/data/vault' --exclude='hermes-agent-pocv/data/node_modules' \
        --exclude='hermes-agent-pocv/data/lazy-packages' --exclude='hermes-agent-pocv/data/cache' \
        --exclude='hermes-agent-pocv/data/image_cache' --exclude='hermes-agent-pocv/data/audio_cache' \
        -czf "/docker/hermes-agent-pocv-archiv-$STAMP.tgz" -C /docker hermes-agent-pocv
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
# Aus dem alten Stack mitnehmen: Abo-Login, Google-Token (Mail, Kalender).
for f in auth.json google_token.json gws-client.json; do
  if [ -f "$ALT/data/$f" ] && [ ! -f "$ZIEL/data/$f" ]; then cp -a "$ALT/data/$f" "$ZIEL/data/$f"; echo "   $f uebernommen"; fi
done
if [ -d "$ALT/data/.config/gws-cli" ] && [ ! -d "$ZIEL/data/.config/gws-cli" ]; then
  cp -a "$ALT/data/.config/gws-cli" "$ZIEL/data/.config/"
  echo "   gws-cli-Token uebernommen"
fi
chown -R 10000:10000 "$ZIEL/data"

echo "== 6. Starten"
cd "$ZIEL"
docker compose pull -q
docker compose up -d
echo "   Image-Digest (zum Pinnen): $(docker inspect --format='{{index .RepoDigests 0}}' nousresearch/hermes-agent:v2026.9.14 2>/dev/null)"
echo "   warte auf /health ..."
i=0
until docker exec hermes python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8642/health', timeout=5)" >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 30 ] && { echo "   Hermes antwortet nach 2,5 Minuten nicht. docker logs hermes"; exit 1; }
  sleep 5
done
echo "   Hermes antwortet. Version: $(docker exec hermes hermes --version 2>/dev/null | head -1)"

echo
echo "== FERTIG. Pruefen, ob der uebernommene Abo-Login gilt:"
echo "   docker exec hermes hermes chat -q 'Antworte nur mit OK'"
echo "   Kommt kein OK: ssh -t flowstate 'docker exec -it hermes hermes model'"
echo "   -> 'ChatGPT or Codex Subscription', Link oeffnen, Code eingeben, gpt-6-astra waehlen."
