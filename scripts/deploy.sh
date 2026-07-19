#!/usr/bin/env bash
# Сборка и выкладка Budget Manager на этот сервер.
# Запуск: ./scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT=/var/www/budget-manager

cd "$ROOT"

echo "▸ Сборка (shared → api → web)"
npm run build

echo "▸ Миграции"
npm run migrate

echo "▸ Выкладка статики в $WEB_ROOT"
# Сначала новые ассеты, потом index.html: пользователь не поймает страницу,
# ссылающуюся на ещё не залитый бандл.
mkdir -p "$WEB_ROOT"
rsync -a --delete --exclude index.html apps/web/dist/ "$WEB_ROOT/"
cp apps/web/dist/index.html "$WEB_ROOT/index.html"
chown -R www-data:www-data "$WEB_ROOT"

echo "▸ Перезапуск сервисов"
systemctl restart budget-api budget-worker budget-bot

sleep 3
for svc in budget-api budget-worker budget-bot; do
  printf '  %-15s %s\n' "$svc" "$(systemctl is-active "$svc")"
done

echo "▸ Проверка"
curl -fsS https://budgetbottelegram.duckdns.org/health && echo
echo "Готово."
