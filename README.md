# Budget Manager

Финансовый Telegram Mini App: учёт денег перетаскиванием. Доход тянут в кошелёк —
деньги зачисляются; кошелёк тянут в категорию — списываются. Прямая трата дохода
запрещена матрицей, лимиты категорий контролируются, бот присылает уведомления.

Живой адрес: <https://budgetbottelegram.duckdns.org> · бот: [@bugetmanagementbot](https://t.me/bugetmanagementbot)

## Стек и структура

Монорепо на npm workspaces (Node 22+, PostgreSQL 18, Redis 8).

```
packages/shared      общие типы, zod-схемы DTO, правила DnD-матрицы
apps/api             Fastify + TypeScript: REST, бот (grammY), воркеры
apps/web             Vite + React 19 + Tailwind 4: Mini App
```

**PostgreSQL — источник истины, Redis — производный быстрый слой.** Каждая операция
идёт одной PG-транзакцией; Redis-команды копятся и выполняются одним pipeline сразу
после коммита. Если PG откатился, кэш не трогается; если упал Redis — кэш
пересобирается из PG, поэтому расхождение самоисправляется.

Правила матрицы (`packages/shared/src/matrix.ts`) — единственный источник для фронта
и бэка: фронт не отправляет заведомо запрещённый жест, бэк не доверяет фронту.

## Запуск для разработки

```bash
npm install
npm run build --workspace packages/shared      # общий пакет собирается в JS

cp .env.example apps/api/.env                  # заполнить DATABASE_URL, REDIS_URL, токен бота
npm run migrate                                # применить миграции
npm run seed --workspace apps/api              # тестовый пользователь и категории

npm run dev:api                                # http://localhost:3000
npm run dev --workspace apps/web               # http://localhost:5173
```

Фронт вне Telegram требует подписанный `initData` — проверка подписи на бэке
остаётся строгой:

```bash
npm run dev-init-data --workspace apps/api > apps/web/.env.local   # живёт 24 часа
```

## Проверки

| Команда | Что покрывает |
|---|---|
| `npm run typecheck` | типы во всех воркспейсах |
| `npm run smoke --workspace apps/api` | DnD-ядро через HTTP: матрица, лимиты, сверка PG↔Redis, полный откат при ошибке |
| `npm run smoke:alerts --workspace apps/api` | триггеры уведомлений, дедупликация, доставка воркером, планировщик |
| `npm run smoke:bot --workspace apps/api` | команды бота (апдейты подаются в handleUpdate, Bot API не вызывается) |
| `npm run e2e --workspace apps/web` | сквозной сценарий в headless-браузере; `BASE_URL=https://…` прогоняет против прода |

`smoke:alerts` работает в отдельном namespace Redis (`REDIS_NAMESPACE`), иначе
запущенный воркер разбирает очередь у теста.

## Развёртывание

Собрать и разложить статику:

```bash
npm run build                                  # shared → api → web
cp -r apps/web/dist/* /var/www/budget-manager/
systemctl restart budget-api budget-bot budget-worker
```

Три systemd-юнита (`/etc/systemd/system/budget-*.service`):

| Юнит | Процесс |
|---|---|
| `budget-api` | REST API на :3000 (nginx проксирует `/api`) |
| `budget-bot` | long polling бота: `/start`, кнопка входа в Mini App |
| `budget-worker` | доставка уведомлений и планировщик напоминаний |

Бот и воркер разнесены намеренно: два процесса не могут делить один `getUpdates`.

nginx (`/etc/nginx/sites-available/budgetbottelegram.duckdns.org`) отдаёт статику и
проксирует `/api` на :3000 — один origin, поэтому CORS не нужен. Сертификат
Let's Encrypt продлевается таймером certbot.

Логи: `journalctl -u budget-api -f` (аналогично для `budget-bot`, `budget-worker`).

## Уведомления

Очередь на Redis: мгновенные пуши — LIST (воркер спит на `BRPOP`), отложенные — ZSET
по времени отправки. Триггеры:

- **лимит исчерпан** и **перерасход** — один раз на категорию за период;
- **слишком быстрые траты** — дневная трата вдвое выше нормы **и** накопленный факт
  обогнал план (одного дневного всплеска мало: кто неделю не тратил, тот в графике);
- **вечернее напоминание** — тем, кто за день ничего не записал.

Дедупликация — через `SET NX EX`, поэтому повторные операции не порождают спам.

## Что стоит доделать

- Сервисы работают от `root`, потому что проект лежит в `/root`. Для боевой
  эксплуатации — вынести код в `/srv` и завести отдельного пользователя.
- Токен бота светился в переписке: перевыпустить через BotFather и обновить
  `apps/api/.env`.
- Резервное копирование PostgreSQL не настроено.
