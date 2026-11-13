# @bunprise/db-tests — тесты миграций и RLS без Docker

## Что это

Настоящий Postgres (18.x), скомпилированный в WebAssembly — **PGlite** — запускается прямо в Node внутри Vitest.
Перед тестом хелпер `createTestDb()`:

1. накатывает `shims/000_supabase_shims.sql` — схема `auth`, таблица `auth.users`, функции `auth.uid()` / `auth.role()` / `auth.jwt()`, роли `anon` / `authenticated` / `service_role`, гранты;
2. накатывает все `*.sql` из `../../supabase/migrations/` по алфавиту (каждый файл — своя транзакция, как `supabase db push`). Папки нет или она пуста — пишет заметку в консоль и едет дальше;
3. отдаёт объект с `asUser / asAnon / asService`, чтобы выполнять SQL «от имени» пользователя, анонима или сервиса.

Зачем: каждое правило RLS («владелец списка не видит резервы») проверяется в базе, а не глазами. На машине нет Docker, поэтому локальный стек Supabase не поднять — PGlite его заменяет для SQL-части.

## Как запустить

```bash
cd packages/db-tests
npm install          # один раз
npm test             # vitest run
npm run typecheck    # tsc --noEmit
```

Первый запуск тест-файла ждёт ~1–2 с, пока стартует WASM-Postgres. Браузер и сеть не нужны.

## Как написать новый RLS-тест

```ts
import { beforeAll, afterAll, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, type TestDb } from '../src/harness'

let t: TestDb
beforeAll(async () => { t = await createTestDb() })   // шимы + все миграции
afterAll(() => t.close())

it('владелец списка не видит резервы', async () => {
  const owner = await t.createUser('owner@example.test')
  const friend = await t.createUser('friend@example.test')
  // ...создать список и желание через t.asUser(owner, ...)...
  await t.asUser(friend, (tx) => tx.query('insert into reservations (wish_id) values ($1)', [wishId]))
  expect(await t.asUser(owner, (tx) => rows(tx, 'select * from reservations'))).toEqual([])
  await expectDbError(t.asUser(owner, (tx) => tx.query('delete from reservations')), '42501')
})
```

Правила:

- `asUser(id, fn)` — **одна** транзакция: `set local role authenticated` + JWT-claims через `set_config(..., true)`. После `fn` всё откатывается к суперпользователю само. Исключение внутри `fn` = rollback.
- Вызовы `asUser / asAnon / asService` **не вкладывать** друг в друга и не запускать параллельно: у PGlite одно соединение, вложенная транзакция повиснет. Только `await` по очереди.
- Хелперы: `rows(tx, sql, params)` → массив строк; `one()` → строка или `null`; `scalar()` → одно значение; `expectDbError(promise, '42501')` → проверяет код SQLSTATE (42501 = нет прав / RLS, 23505 = уникальность, 23503 = FK).
- `createTestDb({ extraSql: [...] })` — свои таблицы-заглушки; `migrationsDir: false` — вообще без миграций (так работает `test/harness.test.ts`); `migrationsDir: '<папка>'` — другая папка (см. `test/fixtures/migrations/`).
- Один `createTestDb()` на тест-файл (в `beforeAll`), не на каждый тест: старт дорогой, а данные между `it` можно убирать через `asService`.

## Чем шим отличается от настоящего Supabase

- **Нет PostgREST** — тесты шлют SQL напрямую, а не REST-запросы. Поэтому не проверяются: формат ответа API, фильтры `?select=`, лимиты, заголовки, `Prefer: return=…`.
- **Нет GoTrue (Auth)** — `createUser()` просто вставляет строку в `auth.users` (4 колонки вместо ~35). Нет OTP, сессий, refresh-токенов, триггеров GoTrue. Claims в JWT — только `sub` и `role`; `auth.jwt()` вернёт `{"sub":…,"role":…}`, а не полный токен с `email`, `aud`, `exp`.
- **Нет Realtime, Storage, Edge Functions**, нет `supabase_functions`/`storage`/`realtime` схем.
- **Гранты упрощены**: `usage` на `public`/`auth`/`extensions` + `alter default privileges ... grant all on tables/sequences/functions` для трёх ролей. Это повторяет «всё разрешено, фильтрует RLS» из Supabase, но без `postgres`-роли-не-суперпользователя, без `supabase_admin`, без `pg_graphql`, без `extensions`-функций.
- **Суперпользователь** PGlite зовётся `postgres` и **настоящий** superuser (на Supabase `postgres` — нет). `asService` = этот суперпользователь, то есть он сильнее реального `service_role` (может DDL). Для проверок «кто что видит» это не мешает: важны `anon` и `authenticated`, а они — честные non-superuser роли.
- `current_setting('request.jwt.claim.sub', true)` после первой транзакции возвращает `''`, а не `NULL` — поэтому в шиме все `auth.*` функции обёрнуты в `nullif(..., '')`, как в настоящем Supabase.
- Одно соединение — честную гонку двух одновременных `insert` не воспроизвести, только последовательную (второй получает 23505 — этого достаточно, уникальный индекс одинаково ведёт себя и под конкуренцией). Настоящие одновременные транзакции проверяет отдельный набор на настоящем PostgreSQL — см. раздел ниже.
- Версия Postgres: PGlite 0.5.x = Postgres 18. В проекте Supabase версия может быть ниже (проверить в дашборде) — синтаксис в миграциях держать консервативным, новинки 17/18 не использовать.

## Одновременные операции на настоящем PostgreSQL (`test/concurrency`, ADR-0002)

PGlite не умеет две транзакции сразу, поэтому блокировки строк проверяются на настоящем PostgreSQL 17 из npm-пакета `embedded-postgres` (без Docker). Подробно — [ADR-0002](../../docs/decisions/0002-concurrency-tests-real-postgres.md).

```bash
npm run test:concurrency            # из корня репо; входит и в npm run check
npm run test:concurrency -w @bunprise/db-tests
```

- Хелпер `src/realpg.ts`: `startRealPg()` → свой сервер на тест-файл (временная папка, случайный порт на 127.0.0.1, удаляется в `close()`), те же шимы и все миграции; `db.session('имя')` — новое независимое соединение; `session.begin(uid)` — транзакция от имени пользователя (как PostgREST); `db.waitUntilBlocked(ждущий, держащий, обещание)` — дождаться, что вторая транзакция действительно ждёт первую.
- Пары операций и ожидаемый итог для обоих порядков — таблица `test/concurrency/pairs.ts`. Новая пара = новая запись; тесты «держи и жди» и гонки появляются из неё сами.
- Первый запуск файла ждёт ~4 с (initdb). Весь набор — ~11–15 с.
- Обычный `npm test` / `npm run test:db` эту папку не запускает (`vitest.config.ts` → `exclude`).

## Проверенные факты о RLS в PGlite (test/harness.test.ts, 2026-10-19)

- `set local role authenticated` внутри `db.transaction()` работает: `current_user = authenticated`, `session_user = postgres`, `rolsuper = false`, `rolbypassrls = false`.
- **RLS реально применяется** после смены роли: пользователь B получает 0 строк из чужой таблицы; `insert` с чужим `owner` падает с `42501 new row violates row-level security policy`; транзакция при этом откатывается.
- Контрольная проверка: те же claims **без** `set role` (суперпользователь) видят все строки — значит, именно смена роли включает RLS, а не что-то другое.
- `anon` с грантом, но без policy → пустой результат (default deny). Без гранта → `42501 permission denied for table`. Обе ветки проверены.
- `security definer`-функция, принадлежащая суперпользователю, видит все строки; обычная (`security invoker`) — только то, что разрешает RLS вызывающему.
- Частичный уникальный индекс `where status = 'active'` даёт `23505` на второй активный резерв и пропускает новый после отмены.
- После транзакции роль и claims сбрасываются: `current_user = postgres`, `auth.uid() is null`.
- Альтернативы (`set session authorization`, `set role` вне транзакции) не понадобились.
