# supabase/ — база данных Bunprise (пилот)

Здесь живёт **вся** схема базы: таблицы, права, RLS-политики, RPC-функции. Единственный способ изменить
базу — новый файл в `migrations/`. В дашборде Supabase схему **никогда не правим руками** (ни Table Editor,
ни SQL Editor для DDL): всё, что не записано миграцией, потеряется при следующем `db push`, не попадёт в
тесты и не будет видно в git.

Источник истины для решений: `docs/spec/pilot-decisions.md` (перекрывает `docs/spec/data-and-secrecy.md`).

## Миграции (13 файлов, применяются по алфавиту, каждая — своя транзакция)

| Файл | Что делает |
|---|---|
| `20261019120000_pilot_schema.sql` | Схема `private` (вспомогательные функции для политик, недоступна через API). Таблицы: `profiles` (+ `onboarding_done_at`, `last_seen_at`), `legal_versions`, `consents`, `occasions`, `occasion_addresses` (задел), `invites` (только sha256 токена), `occasion_members`, `wishlists`, `wishes` (`priority` 1–3 вместо `position`), `reservations` (тайная бронь: `status active/ended`, `end_reason`, снимок названия), `blocks`, `reports` (задел). Триггеры: профиль создаётся вместе с `auth.users`; при создании повода хост становится участником и получает **один** список; удаление желания завершает бронь (`wish_deleted`); неизменяемые поля (хост, владелец списка, получатель); проверка часового пояса. Индексы, в т. ч. под ленту (`occasion_members (profile_id, occasion_id) where status = 'active'`) и под сортировку желаний (`wishlist_id, priority desc, created_at`). |
| `20261019120100_pilot_rls.sql` | Сброс прав для `anon`/`authenticated`, RLS **включён и forced** на всех 12 таблицах, политики и гранты по колонкам. `reservations`: **ни одного гранта** — через REST таблица недоступна никому (ни select, ни count); политика остаётся страховкой. `profiles`: через REST читаются **только** `id` и `display_name` (грант по колонкам; `locale`, `onboarding_done_at`, `last_seen_at`, даты — только свои и только через `get_me()` / `export_my_data()`). `consents`: insert только в `profile_id, kind, version, locale` — `accepted_at` всегда ставит база. `occasions_insert` требует имя + все согласия; `wishlists_insert` — только хост и только пока списка нет. |
| `20261019120200_pilot_rpc.sql` | RPC: `get_me`, `get_feed`, `get_occasion_screen`, `create_invite`, `accept_invite`, `reserve_wish`, `cancel_reservation`, `my_reservations`, `leave_occasion`, `remove_member` (**отзывает активную ссылку повода** — убранный гость возвращается только по новой), `block_user`/`unblock_user` (задел), `export_my_data` (единственная `security invoker`; свой профиль и свои брони берёт через `private.my_profile_export()` / `private.my_reservations_export()`), `delete_my_account`. Все остальные `security definer` с `search_path = ''`. Ошибки — `raise exception` с кодом (`not_allowed`, `not_found`, `already_reserved`, `invite_invalid`, `consent_required`, `profile_incomplete`), клиент переводит код через i18n. Права: только `authenticated`, для `anon`/`public` — ничего. |
| `20261019120300_legal_versions_seed.sql` | Текущие версии текстов: `terms-2026-10-pilot-1`, `privacy-2026-10-pilot-1`, `age-18plus-2026-10-pilot-1`. Новая версия AGB/Datenschutz = новая миграция с новой строкой → у всех `consents_ok = false`, пока не примут заново. Константа `LEGAL_VERSIONS` в `apps/web/src/lib/legal.ts` должна совпадать. |
| `20261019120400_pilot_cron.sql` | Условно (если расширение `pg_cron` доступно) создаёт исходную ежедневную задачу `bunprise_purge_unconfirmed_users`: удалять `auth.users`, у которых `last_sign_in_at is null` и возраст > 24 ч (обещание из Datenschutzerklärung 3.1). Следующая миграция заменяет это расписание. На PGlite и локальном Postgres без `pg_cron` ничего не делает. |
| `20261019120500_pilot_security_v11.sql` | Финальные изменения v1.1: `privacy_notice` вместо `privacy`, удаление `profiles.last_seen_at` и `reserved_by_name` из ответа RPC, поколоночные SELECT, защита истории/экспорта и блокировки конкурентных операций. При доступном `pg_cron` устанавливает две задачи: `bunprise_purge_unconfirmed_users` каждый час (`17 * * * *`, `private.purge_unconfirmed_users()`, не входившие аккаунты старше 24 часов) и `bunprise_purge_expired_records` ежедневно (`37 3 * * *`, `private.purge_expired_records()`, завершённые брони и обработанные жалобы старше 90 дней). |
| `20261020120000_concurrency_fix.sql` | Неизменяемое исправление пилотных блокировок. Следующие файлы опираются на него; не редактировать задним числом. |
| `20261020160000_occasion_photos.sql` | Фото повода в Postgres, закрытая таблица/RPC, квота, каскады; проверка JPEG/WebP по фактическим размерам и структуре. Клиент ≤1600px, SQL 1…2048px и ≤409600 байт. |
| `20261020200000_lists_standalone.sql` | M1: списки без повода, собственный получатель, поколоночные права, баннер/обложки, лимиты, безопасные record вместо изменившихся rowtype. |
| `20261020200100_follows.sql` | M2: запросы/принятие, ссылки и тихое отклонение, блок, граф/экспорт; таблицы отношений недоступны через REST. |
| `20261020200200_follow_sharing.sql` | M3: доступ принятых подписчиков, предел 5 активных броней у получателя, закрытие при потере доступа, повторная проверка UUID после ожидания, безопасная история; statement DELETE сериализуется на профиле. |
| `20261020200300_free_wishes.sql` | M4: `get_free_wishes` только для дарителя и доступных ему желаний; на себя — `not_found`, без сигналов владельцу. |
| `20261020221230_feed_host_identity.sql` | Добавляет `host_id` уже доступного участнику хозяина в `get_feed` для цвета/выбора получателя; существующие фильтры и owner-ветка без изменений. |

### Локальный статус и порядок блокировок · 21.10.2026

Это описание **локального дерева**, не журнал применений в Supabase. Облако в текущей работе не открывалось и не изменялось. Все новые файлы после пилота считаются unshipped до отдельной сверки migration list при разрешённом выпуске. Исходные шесть файлов и concurrency_fix сохранены неизменными. M5/legal-version seed отсутствует; production-флаг не включён этой работой.

Для mutating RPC общий верхний порядок — профили пары по UUID → нижние строки повода/списка/желания → accepted follow → reservation. DELETE через REST на `occasions`, `wishlists`, `wishes` берёт собственный профиль `FOR NO KEY UPDATE` в BEFORE DELETE FOR EACH STATEMENT (`private.lock_owned_delete`) до блокировки удаляемых строк. Это одинаково при 0/5 бронях и устраняет воспроизведённый `40P01`-оракул. Прямой профильный lock не вызывает `require_user`, поэтому каскад удаления аккаунта не ломается после удаления профиля. После ожидания reserve/cancel заново проверяют связку wish/list/owner/recipient; история не берёт live-данные из чужой восстановленной UUID-связки.

Аварийный шаблон `emergency/follower_lists_off.sql` **не входит в migrations**. В одной транзакции: `LOCK profiles EXCLUSIVE` → `LOCK follows EXCLUSIVE` → выключение `private.features.follower_lists` → завершение активных standalone-броней. Профили сначала нужны против цикла с delete_my_account. Возврат флага не восстанавливает завершённые брони.

Проверки перед выпуском: `npm run test:db`, `npm run test:concurrency`, `npm run check`; конкурентный локальный harness использует PG17.10 и strict_multi_assignment. Эти результаты не заменяют разрешённую проверку hosted PG17.11, PostgREST, RLS/Performance Advisor и конфигурации cloud. Регрессии: `test/concurrency/follows-hardening.test.ts`, `test/follows/review-hardening.test.ts`, `test/pilot/occasion-photos.test.ts`, `test/concurrency/photos.test.ts`.

**Выпускной gate:** до готовых и проверенных pilot-2 (Кирилл и дядя) и отдельного разрешения не выполнять db push новых M1–M4/фото/identity и не включать VITE_LISTS в production. Команды ниже — инструкция для будущего разрешённого выпуска, а не действие этой сессии. Юридические черновики не активируют версии согласий.

### Главное правило тайны (проверяется тестами)

Владелец списка (= хост в пилоте) не узнаёт о бронях **ничем**: `get_occasion_screen` отдаёт ему ключи
`reserved`, `reserved_by_me` всегда `null` (`reserved_by_name` удалён в v1.1), и ответ байт-идентичен при любом состоянии
броней (ветка владельца вообще не читает `reservations`); `get_feed` у хоста всегда `my_reservation_count: null`;
`my_reservations` и `export_my_data` отдают только свои брони как бронирующего; `reserve_wish` отвечает
владельцу и чужаку одинаково `not_allowed`; бронь никогда не пишет в `wishes` (ни `updated_at`, ни порядок);
через REST таблица `reservations` не читается никем; realtime на ней нет.

### Что решено после атаки раунда 1 (2026-10-19, находки F-1…F-5 + «low»)

- **Убрать гостя = ссылка сгорает.** `remove_member` отзывает активную ссылку повода: у убранного гостя она осталась в чате и
  иначе впускала бы его обратно сразу. Хост после этого видит `invite: null` и создаёт новую ссылку (она работает и для
  убранного — «по новой ссылке», pilot-decisions §1). Добровольный выход (`leave_occasion`) ссылку **не** трогает.
- **Участники видят друг о друге только имя.** Через REST из `profiles` читаются `id` и `display_name` — ни `last_seen_at`
  (когда человек последний раз открывал приложение), ни `locale`, ни даты. Свои поля — через `get_me()` и `export_my_data()`.
  В DSE писать: друзья видят только отображаемое имя.
- **Согласия — доказательство.** `accepted_at` в `consents` ставит база (колонка не входит в insert-грант), клиент не может
  поставить дату задним или передним числом.
- **Блокировка скрывает имена везде.** Для заблокированной пары `reserved_by_name` в `get_occasion_screen` и
  `recipient_name` в экспорте — `null` (факт «занято» остаётся, чтобы не дарили дважды). Блокировка гостем хоста выглядит для
  хоста как обычный выход (`status = 'left'`), блокировка хостом гостя — как «Убрать гостя» (`removed`); сам факт блокировки
  не виден никому.
- **Ошибки `not_found` / `not_allowed` — оракул существования id** (любой вошедший может узнать, существует ли uuid желания /
  повода / профиля, но никогда — состояние брони). Принято осознанно: id — только uuid v4 (data-spec P8), перебор невозможен.
  **Никогда** не вводить короткие id или slug'и.
- **Социальный канал не закрыть базой:** владельцу списка достаточно одного сговорчивого друга (или второго аккаунта), чтобы
  узнать брони — участники видят `reserved_by_name` по решению pilot-decisions §3. Сказать это прямо в AGB/DSE.

## Как Кирилл применяет миграции

Нужен аккаунт Supabase и созданный проект (регион **EU West (Paris)** — Франкфурт при создании не предлагался; для DSGVO
равноценно, в текстах писать «EU (Paris)»). Команды из корня репозитория:

```bash
npx supabase login                       # один раз, откроет браузер
npx supabase link --project-ref <REF>    # <REF> — id проекта из URL дашборда (Settings → General)
npx supabase db push                     # применяет все ещё не применённые файлы из supabase/migrations
npx supabase migration list              # проверить, что локально и в облаке один и тот же список
npx supabase gen types typescript --linked > apps/web/src/lib/database.types.ts   # типы для клиента
```

Правила:
- Новое изменение схемы = **новый файл** `YYYYMMDDHHMMSS_имя.sql`. Уже применённый файл не редактируем
  (облако его не перечитает; для отката пишем новую миграцию).
- Перед `db push` всегда прогоняем тесты: `npm run test:db` из корня (PGlite поднимает те же файлы).
- Пароль базы и ключи `service_role` нигде в репозитории не хранятся; `db push` спрашивает пароль сам.

## Чек-лист дашборда (data-spec §9 с правками pilot-decisions §5)

Названия пунктов в дашборде меняются от версии к версии — ориентируйся на смысл. После настройки прогнать
Security Advisor (Database → Advisors): ожидаем 0 замечаний `rls_disabled_in_public`,
`function_search_path_mutable`, `auth_otp_long_expiry`.

| Область | Настройка | Значение |
|---|---|---|
| Проект | регион | EU West (Paris) — выбран при создании 19.10.2026, потом не поменять (pilot-decisions §5) |
| База | RLS | включён миграцией на всех таблицах (`force` тоже); в дашборде ничего не трогать |
| База | `pg_graphql` | **отключить** (Database → Extensions) |
| База | `pg_cron` | включается миграцией при доступности расширения; `select jobname, schedule from cron.job` должен показать обе задачи v1.1: `bunprise_purge_unconfirmed_users` (`17 * * * *`) и `bunprise_purge_expired_records` (`37 3 * * *`); проверить роль выполнения, часовой пояс и успешные запуски |
| Data API | exposed schemas | только `public` (не `private`, не `graphql_public`). **Жёсткое правило навсегда:** функции `private.*` принимают любые `(occasion, profile)` и, став доступными через API, отвечали бы «состоит ли X в Y», «идёт ли X», «заблокированы ли X и Y», «дал ли X согласие» про кого угодно |
| Data API | max rows | 200 |
| Data API | aggregates | выключены (по умолчанию) |
| Realtime | публикация `supabase_realtime` | **пустая**, ни одной таблицы; тумблер Realtime выключен везде; на `reservations` — никогда (`select * from pg_publication_tables` → 0 строк) |
| Storage | бакеты | нет |
| Edge Functions / Webhooks | — | нет |
| `pg_net` + Vault (Web Push) | `20261027150000_web_push.sql` включает `pg_net`, если доступно; секрет `push_dispatch_secret` в Vault кладёт Кирилл (`docs/handoffs/2026-10-27-web-push.md`) | пока выключатель `private.features.web_push` = false, задачи `bunprise_push_dispatch` нет и ничего не отправляется; ежедневная `bunprise_purge_push` (`57 3 * * *`) |
| Ключи | клиент | только **publishable** (`sb_publishable_…`) → `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Ключи | service role / secret | нигде в репо и ни на одном устройстве, кроме секретов CI для бэкапа |
| Auth | провайдеры | Email (только код, без пароля); Google — после настройки (код готов, кнопка за флагом `VITE_GOOGLE_ENABLED`) |
| Auth | анонимный вход | выключен |
| Auth | OTP | длина **6 цифр**, срок **600 с (10 минут)**, одноразовый; шаблон письма только с `{{ .Token }}` (без `{{ .ConfirmationURL }}`); **один двуязычный шаблон** (DE сверху, EN ниже); тема письма **без кода** |
| Auth | rate limits | отправка писем ≤ 10/час на адрес; проверка кодов ≤ 30/5 мин/IP; sign-in ≤ 30/5 мин/IP (дефолты Supabase или строже) |
| Auth | Captcha (Turnstile) | **выключена** в пилоте (защита — rate limits); код за флагом `VITE_TURNSTILE_SITE_KEY` |
| Auth | сообщения | клиент всегда показывает «Если адрес есть — код отправлен» |
| Auth | склейка аккаунтов | автоматически только по подтверждённому e-mail провайдера; manual linking выключен; Secure email change включён |
| Auth | сессии | JWT 900 с (15 минут); refresh token rotation включена; «Выйти» = `signOut({ scope: 'global' })`; список сессий — MVP |
| Auth | Site URL / Redirect URLs | только наш домен (prod) + `http://localhost:5173` (dev) |
| SMTP | Brevo | свой отправитель `no-reply@<DOMAIN>`, SPF/DKIM/DMARC в Cloudflare DNS |
| Бэкапы | ежедневно | free-план без бэкапов → `docs/ops-pilot.md` (dump → `age` → приватное хранилище, 30 дней ❓, пробное восстановление) |
| Проект | сон после 7 дней без активности | пилот даёт трафик; иначе keep-alive пинг |
| Логи | API/Postgres | retention 1 день на free; приложение не логирует e-mail и токены |

## Что проверить на настоящем Supabase при первом `db push` (⚠️ — PGlite этого проверить не может)

Обязательные проверки: на PGlite владелец миграций — настоящий суперпользователь, на Supabase роль `postgres` — нет.

- **`force row level security` + `security definer`:** все RPC и триггеры принадлежат `postgres` и работают только если у
  `postgres` есть `BYPASSRLS` (на Supabase по умолчанию есть). Проверить: `select rolbypassrls from pg_roles where rolname =
  'postgres'` → `true`. Иначе после `db push` падают `reserve_wish`, `accept_invite`, триггер создания повода — это
  **отказ в обслуживании, не утечка**, но заметный сразу: прогнать smoke-тест (создать повод, ссылку, бронь) тестовыми
  аккаунтами до приглашения друзей.
- Роль `postgres` может `delete from auth.users` (нужно для `delete_my_account` и задачи cron). Если нет —
  Edge Function с `auth.admin.deleteUser` (единственный случай с ключом service role, живёт только в секретах функции).
- Расширение `pg_cron` доступно на Free-плане; миграция создаёт его `with schema pg_catalog` (как в документации Supabase).
  Проверить: `select jobname, schedule from cron.job` → `bunprise_purge_unconfirmed_users` (`17 * * * *`) и
  `bunprise_purge_expired_records` (`37 3 * * *`). Наличие задач не подтверждает успешные запуски; проверить их
  отдельно по [эксплуатационному чек-листу](../docs/ops-pilot.md).
- Data API → exposed schemas = только `public`; схемы `private` там нет и не будет (см. чек-лист выше).
- Версия Postgres проекта ≥ 15 (миграции написаны консервативно; тесты идут на Postgres 18 в PGlite).
- После `db push`: Security Advisor без замечаний, `select * from pg_publication_tables` пусто.

## Тесты

155 проверок на PGlite (Postgres в WebAssembly, без Docker), 14 тестовых файлов. Запуск: `npm run test:db` из корня
(`npm run typecheck -w @bunprise/db-tests` — типы).

- `packages/db-tests/test/pilot/*.test.ts`: таблицы под RLS по ролям, недоступность `reservations` через REST,
  формы ответов RPC, байт-идентичность ответа владельца, приглашения, брони, жизненный цикл, экспорт/удаление,
  мета-проверки (search_path, RLS везде, никаких прав у `anon`/`public`, нет views и публикаций);
  `round1-fixes.test.ts` — закрепляет поведение после атаки раунда 1 (отзыв ссылки при удалении гостя, «тихая»
  блокировка, `my_profile_export`, серверный `accepted_at`). Контракт Auth покрывает профиль и текущие legal versions
  в `get_me`, отказ старым claims после удаления аккаунта, экспорт и удаление без актуальных legal records.
  `security-v11.test.ts` дополнительно проверяет системные колонки, закрытые поля жалоб, снимки после отзыва доступа,
  приглашения, ограничения данных, очистку по срокам и недоступность служебных функций через API.
- `packages/db-tests/test/attack/*.test.ts`: атака раунда 1 (все SQL-формы доступа к броням, оракулы жизненного
  цикла, ошибки RPC, эскалация прав, точный allow-list функций для `authenticated`).
- `packages/db-tests/test/harness.test.ts`: сам стенд (роли, RLS, шимы).
