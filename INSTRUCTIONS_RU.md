# Инструкция по запуску и эксплуатации ZalypaSPB (продакшен)

Эта инструкция дополняет DEPLOYMENT_UBUNTU.md и описывает настройку env, миграции, начальные данные, роли и основные API/UX-потоки. Демо-юнитов и мок-данных больше нет: вся логика работает через БД PostgreSQL.

## 1) Технологии
- Node.js 18+
- Express + JWT (cookie)
- PostgreSQL + Prisma ORM
- Nginx (reverse proxy + TLS)

## 2) Переменные окружения (.env)
Скопируйте .env.example в .env и заполните:
- PORT=3000
- NODE_ENV=production
- JWT_SECRET=<длинная_строка>
- COOKIE_NAME=access_token
- COOKIE_SECURE=true
- DATABASE_URL=postgresql://USER:PASS@HOST:5432/zalypa?schema=public
- TELEGRAM_BOT_TOKEN=<опц., если нужен Telegram>
- TELEGRAM_GROUP_ID=<опц., ID группы для банов/рассылки>
- TELEGRAM_API_BASE=https://api.telegram.org
- WEBAPP_URL=https://<домен> (для кнопки «Открыть панель» в боте)

## 3) Установка зависимостей и Prisma
```
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
```

## 4) Сид начальных данных
```
npm run seed
```
Скрипт создаст пользователей:
- testuser (User) / пароль demo
- testreseller (Reseller) / пароль demo
- testadmin (Admin) / пароль demo
А также баланс реселлера, продукты и релиз лоадера.

## 5) Запуск сервера
- Через systemd (см. deployment/systemd/zalypa.service)
- Локально: `node server.js` (для отладки)

## 6) Nginx и TLS
- Конфиг: deployment/nginx/dinozavrikgugl.ru.conf
- Настройте certbot для выпуска сертификатов Let’s Encrypt.

## 7) Маршруты API (основные)
Аутентификация:
- POST /api/auth/login { username, password }
- POST /api/auth/logout
- GET /api/auth/me (проверка сессии, использует cookie)
- POST /api/auth/register { username, email?, password, invite } (требуется invite)
- POST /api/auth/telegram/webapp { initData, invite? } (поддержка Telegram WebApp логина)

Профиль:
- GET /api/me — данные пользователя
- GET /api/me/subscriptions — подписки с продуктами

Продукты/лоадер/ключи:
- GET /api/products — список включённых продуктов
- GET /api/loader/latest — последний релиз лоадера (404 если нет)
- POST /api/keys/activate { key, product_id? } — активация ключа → обновление подписки

Admin (требует роль Admin):
- GET /api/admin/users — все пользователи
- GET /api/admin/logs — аудит последние 100
- GET /api/admin/invites — список инвайтов
- POST /api/admin/invites { count|codes[], expiresDays? } — создание инвайтов
- DELETE /api/admin/invites/:id — удаление инвайта (если не использован)
- POST /api/admin/keys/upload { productId, keysText, ownerResellerId? } — загрузка ключей, при ownerResellerId списывает баланс реселлера
- POST /api/admin/products { name, priceCents, defaultDurationDays?, enabled? } — создать продукт
- PATCH /api/admin/products/:id — изменить продукт
- DELETE /api/admin/products/:id — удалить продукт
- POST /api/admin/users/:id/block|unblock — блок/разблок
- POST /api/admin/users/:id/role { role } — смена роли (User|Reseller|Admin)
- POST /api/admin/users/:id/password { password } — смена пароля

Reseller (требует роль Reseller или Admin):
- GET /api/reseller/users — пользователи, пришедшие по инвайтам реселлера
- GET /api/reseller/products — продукты с количеством зарезервированных ключей
- GET /api/reseller/balance — баланс реселлера (в копейках)
- POST /api/reseller/keys/buy { productId } — покупка/резервация ключа из пула (списывает баланс)

Telegram:
- POST /api/telegram/webhook — webhook (пока ACK)
- POST /api/telegram/broadcast { text, roles?, include_group? } — рассылка по телеграму (роль фильтрует аудиторию)

## 8) UI
- Вся демо-логика удалена.
- Файл public/index.html подключает только /assets/js/api-bridge.js
- api-bridge.js осуществляет вход/выход, загрузку данных и отрисовку таблиц через API.

## 9) Загрузка лоадера
- Положите бинарники в папку /downloads в корне проекта (например /opt/zalypa/downloads)
- Открывается по https://<домен>/downloads/<файл>
- Последнюю версию отдаёт /api/loader/latest (берётся из таблицы LoaderRelease)

## 10) Обновление версии
```
# в каталоге проекта
git pull
npm ci
npm run prisma:migrate:deploy
sudo systemctl restart zalypa
sudo systemctl reload nginx
```

## 11) Безопасность
- **CSP (Helmet)**: включена с политикой по умолчанию и разрешёнными источниками
  - default-src 'self'
  - script-src 'self' 'unsafe-inline' (оставляем как есть под текущий UI)
  - style-src 'self' 'unsafe-inline'
  - connect-src 'self' https://fonts.gstatic.com
  - img-src 'self' data:
  - font-src 'self' https://fonts.gstatic.com data:
  - frame-ancestors 'none'
- **Cookies**: JWT хранится в httpOnly cookie, SameSite=Lax, Secure=true (за HTTPS через Nginx).
- **Rate limiting**: /api — 300 запросов/15мин; /api/auth — 20 запросов/15мин.
- **Express-validator**: установлен. Общая прослойка — `api/middleware/validate.js`.
  - При расширении API добавляйте схемы проверок для тел/строк/чисел.

## 12) Telegram
- Переменные окружения: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_ID` (опц.), `TELEGRAM_API_BASE`.
- Webhook:
  - Команда установки webhook:
    - `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://<домен>/api/telegram/webhook"`
  - Эндпоинт сейчас возвращает ACK, логику можно расширять под команды.
- Рассылка (админ):
  - POST `/api/telegram/broadcast` `{ text, roles?, include_group? }`
  - Рассылает пользователям с привязанным `telegramId` (фильтр по ролям, вызов в батчах).
- Бан/разбан в группе:
  - При блокировке/разблокировке пользователя (Admin) бот пытается (un)ban по `TELEGRAM_GROUP_ID`.
- Привязка Telegram:
  - Пользователь: на вкладке Telegram → «Привязать Telegram» → получить ссылку `t.me/<bot>?start=<code>` → отправить `/start <code>` боту.
  - В боте доступны `/help`, `/unlink`.
- Отвязка Telegram (по заявке):
  - Пользователь: на вкладке Telegram → «Отвязать Telegram» создаёт заявку (PENDING).
  - Админ: вкладка Admin → Telegram: таблица заявок (approve/reject), поля: id, пользователь, статус, причина, дата.
  - При approve — Telegram отвязывается от аккаунта; при reject — можно указать причину.

UI Админа (вкладка Telegram):
- Форма рассылки: текст, аудитория (Все/User/Reseller/Admin), флаг «Также отправить в группу».
- Таблица заявок на отвязку: кнопки «Одобрить»/«Отклонить» для заявок со статусом PENDING.

## 13) Примечания
- Сид-аккаунты (testuser/testreseller/testadmin, пароль `demo`) созданы для проверки. В проде смените пароли или удалите эти записи.
- Для публикации новых версий лоадера добавьте файл в `/downloads` и запись в таблицу `LoaderRelease`.
