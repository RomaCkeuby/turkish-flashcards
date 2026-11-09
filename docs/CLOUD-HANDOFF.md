# Turkish Flashcards — работа из облака

Состояние проверено 5 ноября 2026 года. Есть три разные версии приложения.

| Версия | Где работает | Что доступно при выключенном ПК |
| --- | --- | --- |
| Опубликованная гостевая | [GitHub Pages](https://romackeuby.github.io/turkish-flashcards/) | Публичный словарь из 600 записей, поиск, фильтры и тренировка в двух направлениях. Оценки относятся к текущему проходу. |
| Рабочая персональная | Node.js и SQLite на домашнем ПК, HTTPS через Cloudflare Tunnel | При выключенном ПК сервер и текущий личный прогресс недоступны. |
| Облачный пилот | Код в рабочей копии, целевой хостинг Cloudflare Pages + Supabase | После выпуска пилота доступны вход, чтение закрытого словаря и отдельный прогресс каждого аккаунта. Действующий адрес пилота не подтверждён. |

## Опубликованный код и сайт

- Репозиторий `RomaCkeuby/turkish-flashcards`. Удалённая ветка `codex/hybrid-offline-accounts` указывает на `0a69f955c6616f649368c31d38c15e6250bb8c39` от 2 ноября. `main` указывает на `ed788852370edda97c61c99c7cf09aa949ac0c38`. [Рабочая ветка на GitHub](https://github.com/RomaCkeuby/turkish-flashcards/tree/codex/hybrid-offline-accounts)
- Последний успешный выпуск GitHub Pages собран из `0a69f95` 2 ноября в 17:04 МСК. 5 ноября главная страница вернула HTTP 200. [Выпуск в GitHub Actions](https://github.com/RomaCkeuby/turkish-flashcards/actions/runs/41458436925)
- Для занятий сразу открывается [тренировка TR → RU](https://romackeuby.github.io/turkish-flashcards/#/study?direction=tr-ru). Для первого открытия нужен интернет. Пункт перехода на свой сервер в гостевом интерфейсе ведёт к экземпляру, которому нужен работающий ПК.
- Поверх `0a69f95` на ПК есть незакоммиченные изменения, включая новые файлы. Среди них облачный адаптер и Auth, миграции PostgreSQL, скрипты снимка и импорта, CI пилота, изменения фильтров и учебных клавиш, серверные исправления и Windows-автозапуск. У этой версии пока нет SHA на GitHub. Состояние кабинетов Cloudflare и Supabase в этой проверке не подтверждалось. [Описание реализации](CLOUD-MIGRATION.md)

## Редактирование и запуск в браузере

1. Для опубликованного кода откройте ветку `codex/hybrid-offline-accounts` на GitHub и выберите **Code → Codespaces**. Доступ зависит от аккаунта GitHub и его квоты. [Создание Codespace](https://docs.github.com/en/codespaces/developing-in-a-codespace/creating-a-codespace-for-a-repository)
2. Для самой свежей рабочей копии сначала сохраните её с включённого ПК. Проверьте `git status --short --untracked-files=all`, просмотрите новые файлы и подготовьте коммит из исходников, тестов, миграций и документации. Отправка в отдельную ветку, например `codex/cloud-pilot`, позволит открыть её в Codespaces и запустить проверки без автоматической публикации гостевого сайта. Workflow GitHub Pages срабатывает на push в `main` и `codex/hybrid-offline-accounts`, если в ветке есть этот workflow. Перед отправкой проверьте `git diff --cached --name-status` и содержимое коммита.
3. В корне проекта выполните команды ниже. CI закрепляет Node.js `22.18.0` и pnpm `11.9.0`. В Codespaces при наличии `nvm` версия Node выбирается командами `nvm install 22.18.0` и `nvm use 22.18.0`. Если нужной версии pnpm ещё нет, установите `npm install --global pnpm@11.9.0`. [Установка pnpm](https://pnpm.io/installation)

   ```bash
   node --version
   pnpm --version
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm test
   pnpm dev
   ```

4. Откройте приватный порт `5173` из панели **Ports**. Vite отправляет `/api` внутри Codespace на порт `3001`. Для разработки достаточно открыть `5173`, а SQLite создастся в окружении Codespace с начальными данными. Сайт в Codespace доступен, пока запущено окружение. [Проброс портов в Codespaces](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)

| Команда из корня | Результат |
| --- | --- |
| `pnpm dev` | React/Vite на `5173`, Node API на `3001`, отдельная SQLite в текущем окружении |
| `pnpm build` | `apps/web/dist` и `apps/server/dist` для серверного режима |
| `VITE_BASE_PATH=/turkish-flashcards/ pnpm build:static` | `apps/web/dist-static` для GitHub Pages, hash-маршруты и публичная подборка |
| `pnpm dev:cloud` | Облачный интерфейс на `5173` с выбранным Supabase, доступен в свежей рабочей копии |
| `pnpm build:cloud` | `apps/web/dist-cloud` для Cloudflare Pages с проверкой состава артефакта, доступен в свежей рабочей копии |

В PowerShell для GitHub Pages сначала выполните `$env:VITE_BASE_PATH='/turkish-flashcards/'`, затем `pnpm build:static`. У гостевой и облачной сборок общий воспроизводимый экспорт подборки из отслеживаемого пакета `apps/server/update-packages/current/`. Личная SQLite в этом экспорте не участвует.

## Закрытый пилот Cloudflare Pages + Supabase

Текущий пилот реализует вход, учебную очередь, оценки, отмену последней оценки, статистику и чтение общего закрытого словаря. Персональные запросы идут в Supabase. Редактирование и слияние карточек, удаление и восстановление, обновления пакетов, откат и внешние словари пока относятся к этапу M6. [Карта API и прав](CLOUD-CONTRACT.md)

1. После публикации исходников создать отдельный тестовый проект Supabase в европейском регионе и связать CLI с его `project ref`. Применить миграции из `supabase/migrations/` по порядку. Для пустого пилота использовать синтетический `supabase/seed.sql`, например через `supabase db push --include-seed` после проверки привязки. Для production нужен отдельный проект. [Развёртывание миграций](https://supabase.com/docs/guides/deployment/database-migrations)
2. В Supabase Auth закрыть публичную регистрацию, включить подтверждение email, задать Site URL будущего Pages-сайта и разрешить его точный `/auth/callback`. Для запуска на ПК разрешить `http://127.0.0.1:5173/auth/callback`. Для Codespaces добавить точный callback адреса приватного проброса `5173`. Настроить SMTP для доставки на внешние адреса и завести два тестовых аккаунта. Ссылку PKCE открывать в браузере, который инициировал запрос. [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
3. Для разработки скопировать `apps/web/.env.example` в `apps/web/.env.cloud.local`. Задать `VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co`, `VITE_SUPABASE_PUBLISHABLE_KEY` и `VITE_BASE_PATH=/`. Все `VITE_*` доступны браузеру. Держать пароли БД, service-role/secret keys и SMTP вне браузерной конфигурации. `VITE_API_URL` в облачном режиме запрещён валидатором.
4. В Cloudflare Pages указать ветку с кодом пилота, корень репозитория, `pnpm build:cloud`, выход `apps/web/dist-cloud`, `NODE_VERSION=22.18.0` и `PNPM_VERSION=11.9.0`. Добавить публичные переменные Supabase для нужного окружения. Точный URL `pages.dev` взять из панели и сверить с Auth Site URL и callback. [Параметры сборки](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Версии инструментов](https://developers.cloudflare.com/pages/configuration/build-image/)
5. С выключенным домашним сервером открыть `/study` и `/dictionary` напрямую на телефоне и ПК. Проверить вход, письмо восстановления, истечение сессии и сетевые сбои. С двух аккаунтов проверить чтение общего каталога и изоляцию оценок, статистики и отмены. При смене аккаунта проверить, что черновики и состояние предыдущего аккаунта очищены. В сетевых запросах личные операции должны идти в Supabase.

## Личная база и переключение

- Источник рабочего прогресса `apps/server/storage/turkish-flashcards.db`. Предварительный согласованный снимок от 3 ноября находится в `backups/supabase-2026-11-03-m0/`. В нём 542 записи, 1 084 направления, 216 состояний повторения и 362 ответа. Эти числа относятся к снимку. В исходной статистике используется `Europe/Moscow`.
- Для переноса снять свежую копию через SQLite backup API командой `pnpm cloud:snapshot create apps/server/storage/turkish-flashcards.db backups/FINAL-SNAPSHOT`, проверить `pnpm cloud:snapshot verify backups/FINAL-SNAPSHOT` и восстановить в изолированном тесте `pnpm cloud:restore-check backups/FINAL-SNAPSHOT`. Для проверки статистики задать часовой пояс процесса `Europe/Moscow`. Копия одного открытого `.db` может пропустить изменения из WAL.
- На этапе M8 `pnpm cloud:import backups/FINAL-SNAPSHOT OWNER-AUTH-UUID` проверяет снимок локально. Третий аргумент `backups/FINAL-SNAPSHOT/import.sql` создаёт закрытый транзакционный SQL. Импорт требует пустого production-каталога и UUID подтверждённого владельца из production Supabase Auth. Старый прогресс назначается этому аккаунту. Обратного переноса новых облачных ответов в SQLite пока нет. [Процедура импорта](CLOUD-MIGRATION.md#подготовка-импорта)
- SQLite, снимки, SQL импорта, `.personal/`, `.tools/`, `.env*` с реальными значениями и ключи хранить отдельно от Git и артефактов Pages. Сохранить закрытую резервную копию вне домашнего ПК, если она должна быть доступна при выключении. Синхронизация или внешний бэкап этой копии не проверялись.
- До переключения закончить M6, отрепетировать импорт и восстановление в отдельном окружении M7, затем остановить запись на домашнем сервере для финального снимка и принять выпуск M8. После приёмки начинается M9 с наблюдением за облачной версией. [Дорожная карта](../ROADMAP-SUPABASE.md)

## Карта кода и проверки

| Где | Что искать |
| --- | --- |
| `apps/web/src/App.tsx`, `appMode.ts`, `api.ts` | Режимы `local`, `guest`, `cloud`, маршрутизация и выбор API |
| `apps/web/src/cloud/` | Supabase Auth, настройки клиента, RPC, очистка данных при смене аккаунта |
| `apps/server/src/index.ts`, `database.ts`, `hosting.ts` | Домашний API, SQLite и раздача серверной версии |
| `supabase/migrations/`, `supabase/tests/database/` | Каталог, RLS, очередь, оценки, отмена, изоляция и pgTAP |
| `scripts/cloud/` | Снимки, транзакционный импорт, проверка восстановления и состава сборки |
| `.github/workflows/pages.yml`, `.github/workflows/cloud-check.yml` | Публикация гостевой версии и проверки пилота. CI пилота не публикует сайт. |

5 ноября локально прошли `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm build:static` и `pnpm build:cloud`. Для последней сборки использованы фиктивные настройки CI. Проверка состава подтвердила 22 файла интерфейса и публичной подборки. Снимок M0 прошёл проверку целостности и восстановление в PGlite с проверкой словаря, обеих очередей и назначения прогресса. Эти проверки выполнялись на Node.js `22.18.0` и pnpm `11.25.0`. Удалённые Supabase Auth/JWT, SMTP, конкурентные запросы, запуск в Codespaces и публикация пилота ещё требуют проверки в реальных окружениях.
