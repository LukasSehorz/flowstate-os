#!/bin/sh
# Vault-Sync auf dem Server (Stufe 0.8): alle fuenf Minuten per Cron.
#
#   /etc/cron.d/flowstate-vault-sync  ->  */5 * * * * root /docker/hermes/vault-sync.sh
#
# Was passiert: lokale Aenderungen (Hermes, Dashboard-Chronik, Eingang)
# werden committet, dann wird von GitHub geholt (rebase, damit Aenderungen
# vom Mac oder aus Obsidian nicht verloren gehen), dann gepusht. Zum Schluss
# gehoeren alle Dateien wieder dem Container-Nutzer 10000, sonst kann Hermes
# nicht schreiben, was root beim Pull angelegt hat.
#
# Warum ein neues Skript: Der alte Sync stand seit dem 07.08.2026 still
# (letzter auto-sync-Commit). Der alte Crontab-Eintrag muss weg (crontab -l).
set -e
VAULT=/opt/flowstate-vault
LOG=/var/log/flowstate-vault-sync.log
cd "$VAULT"
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=15"
git config --global --add safe.directory "$VAULT" >/dev/null 2>&1 || true

git add -A
if ! git diff --cached --quiet; then
  git -c user.name="Flowstate Server" -c user.email="server@svhconsult.de" \
    commit -q -m "server: $(date '+%Y-%m-%d %H:%M')"
fi
if ! git pull -q --rebase --autostash origin main; then
  git rebase --abort >/dev/null 2>&1 || true
  echo "$(date '+%F %T') pull fehlgeschlagen, naechster Lauf versucht es erneut" >> "$LOG"
  exit 1
fi
git push -q origin main
chown -R 10000:10000 "$VAULT"
echo "$(date '+%F %T') ok $(git rev-parse --short HEAD)" >> "$LOG"
