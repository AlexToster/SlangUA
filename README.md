# SlangUA

> AI-перекладач української мови у сучасні українські стилі мовлення.
>
> Українська може звучати по-різному: сучасно, влучно, дотепно, молодіжно чи поетично. Ми часто користуємося лише невеликою частиною її можливостей. **SlangUA** допоможе розкрити всю палітру сучасної української мови й знайти стиль, який пасує саме вам.

---

# Ідея проєкту

SlangUA — це сервіс стилізації тексту, а не буквального перекладу.

Мета проєкту — перетворювати звичайний український текст у різні стилі сучасної української мови зі збереженням змісту, але максимальною зміною форми.

Основна ідея:

> **Максимально змінити форму тексту.**
> **Повністю зберегти його зміст.**

Кожен стиль має бути миттєво впізнаваним.

---

# Філософія проєкту

SlangUA не є:

* словником;
* чат-ботом;
* генератором текстів;
* машинним перекладачем.

Це **AI Style Translator**.

Кожен стиль має власний характер, словник, правила, приклади та індивідуальну "особистість".

Стилі навмисно максимально контрастні між собою.

Наприклад:

* **GEN_Z** — молодіжний TikTok/Instagram/Discord;
* **STREET** — вуличний базар;
* **IT_SLANG** — технічний спіч;
* **POFENI** — зеківський жаргон: мова вʼязниці (18+);
* **KANCLER** — бюрократичний стиль, радянщина;
* **GALICIAN** — галицька ґвара, львівський діалект.

Не всі стилі однаково трансформують текст.

Наприклад:

* **KANCLER** навмисно може збільшувати довжину речення у 2–4 рази.
* **GEN_Z** намагається зберігати приблизно ту саму довжину тексту.
* **POFENI** говорить крізь тюремну ієрархію і «поняття», тому виглядає грубіше або нагліше; це інший регістр, ніж **STREET** (двір і вулиця).

---

# Принципи перекладу

Кожен переклад повинен відповідати таким правилам:

1. Повністю зберігати зміст оригінального тексту.
2. Максимально передавати характер обраного стилю.
3. Бути природним для носія української мови.
4. Не змішувати стилі між собою.
5. Давати користувачу відчутний WOW-ефект уже після першого перекладу.

---

# Основні можливості

## Функціональні можливості

* переклад українського тексту у різні стилі;
* Telegram Mini App (TWA);
* історія перекладів — до 100 записів на користувача (константа `HISTORY_MAX_ENTRIES` на сервері, не змінюється через env). Після кожного збереження найстаріші записи понад ліміт видаляються, але **улюблені не обрізаються ніколи**, тому користувач, який усе позначає зірочкою, може перевищити ліміт. `GET /history` повертає цей ліміт як `totalLimit`, щоб клієнт не зашивав число в себе.

## Архітектурні особливості

* Fastify Backend;
* підтримка декількох AI Provider;
* окремий Style Engine.

---

# Архітектура

```text
Telegram Mini App (TWA)
        │
        ▼
     Fastify
        │
        ▼
 Translation Service
        │
        ▼
    AI Service
        │
        ▼
   AI Provider
        │
        ▼
       LLM
```

Стилізація працює окремою підсистемою.

```text
BaseAdapter
      │
      ▼
 Style Engine
      │
      ├── Registry
      ├── Prompt
      ├── Examples
      └── Lexicon
```

Style Engine відповідає лише за побудову системного промпту.

Він не містить бізнес-логіки, не працює з базою даних та не викликає LLM.

---

# Технології

## Backend

* Node.js
* TypeScript
* Fastify
* Prisma
* PostgreSQL
* Redis

## Frontend

* Telegram Mini App (TWA)
* React
* Vite
* Звичайний CSS — по одному файлу на компонент (Tailwind навмисно не використовується)

## AI

* OpenAI
* Anthropic (Claude)
* Gemini
* Ollama (локальні моделі)
* OpenRouter
* Adapter Pattern

> Класів адаптерів три, а не п'ять: `OpenAICompatibleAdapter` обслуговує всіх, хто розмовляє форматом OpenAI Chat Completions (OpenAI, OpenRouter, локальна Ollama через `/v1`), а власні класи мають лише Anthropic і Gemini. Провайдер — це набір параметрів у `.env`, тому підключити ще один сумісний ендпоінт (Groq, DeepSeek, vLLM, проксі) можна без нового коду.

> Конкретні моделі, ключі, базові URL, пріоритет провайдерів і таймаути задаються через змінні середовища (див. розділ «Змінні середовища» та `src/config/index.ts` як джерело правди), тому не дублюються тут, щоб не застарівати.

> Список AI-провайдерів відкритий: новий інстанс додається змінними середовища (`AI_EXTRA_INSTANCES`), без міграції бази і без змін у клієнті. Ідентифікатор провайдера (`providerId`) — вільний рядок у нижньому регістрі, а не enum, саме щоб додавання провайдера залишалося налаштуванням, а не зміною схеми.

> Кожна змінна з ключем AI-провайдера приймає **кілька ключів через кому**: коли поточний ключ вичерпав ліміт, запит обслуговує наступний. Перед тим як складати кілька ключів разом, перевірте умови провайдера: деякі забороняють мати кілька безкоштовних акаунтів.

---

# Основні принципи проєкту

* Максимально зберігати зміст при максимальній зміні стилю.
* Кожен стиль повинен легко впізнаватися.
* Стилі повинні бути контрастними між собою.
* Архітектура має залишатися максимально простою до появи реальної потреби в її ускладненні.

---

# Future

Після MVP планується розвиток у таких напрямках.

## Style Engine

* нові стилі;
* розширення словників;
* збільшення кількості прикладів;
* Character Engine;
* Adaptive Examples;
* Prompt Builder;
* Style Validation.

## Адмін-панель

Можливість керування стилями без зміни коду:

* увімкнення та вимкнення стилів;
* редагування Prompt;
* редагування словників;
* редагування прикладів;
* керування версіями стилів;
* статистика використання стилів.

Архітектура Style Engine вже проєктується таким чином, щоб у майбутньому перейти від файлової системи до бази даних або API без зміни його публічного контракту.

> Шар доступу до адмінки вже реалізований: вхід за Telegram-allowlist плюс пароль, сесія з кроком підтвердження, і `GET /api/v1/admin/overview` зі станом ланцюжка AI-провайдерів. Реалізований і кіл-світч оператора: `PATCH /api/v1/admin/providers/:providerId` вимикає провайдера з ланцюжка fallback і повертає його назад — запис живе в Redis без TTL, тож сам собою не «вилікується» ні через кулдаун, ні після рестарту, і зняти його може лише людина. Додані два оглядові розділи: `GET /api/v1/admin/metrics` — навантаження по хвилинах і по добах (UTC) плюс найактивніші користувачі за сьогодні, і `GET /api/v1/admin/errors` — останні `5xx` із кодом, технічним повідомленням і `requestId` для пошуку в логах. Обидва читаються з лічильників у Redis, які пише хук `onResponse`; жоден не зберігає текст запиту чи Telegram-id, і жоден не рахує ні `/health*`, ні звернення самої адмінки. Налаштування — у розділі «Змінні середовища» (`ADMIN_*`, `METRICS_*`), контракт — у [`plans/docs/04-api.md`](plans/docs/04-api.md). Керування стилями з переліку вище — наступні етапи.

## AI

* нові AI Provider;
* fallback між моделями;
* локальні LLM.

## Клієнти

* Telegram Mini App;
* PWA;
* Web Version;
* Android;
* iOS.

---

# Статус

**Поточний статус:** активна розробка MVP.

Основна увага зараз приділяється побудові стабільної архітектури та Style Engine. Після завершення MVP розвиток буде зосереджений на розширенні функціональності, додаванні нових стилів і розвитку адміністративної панелі.

Основний принцип розвитку:

> **Спочатку просте рішення.**
> **Потім стабілізація.**
> **Лише після цього — нові абстракції.**

---

## Документація

Технічна документація починається з [plans/docs/README.md](plans/docs/README.md); звідти — посилання на [architecture.md](plans/architecture.md) та інші документи.

| Файл | Опис |
| ---- | ---- |
| [plans/docs/README.md](plans/docs/README.md) | Індекс архітектурної документації: огляд усіх документів у `plans/docs/` (01–10). |
| [plans/architecture.md](plans/architecture.md) | Високорівнева архітектура та діаграми. |
| [plans/ROADMAP.md](plans/ROADMAP.md) | Поетапний план реалізації зі статусами. |
| [plans/docs/01-backend.md](plans/docs/01-backend.md) | Backend Architecture — шари, потік комунікації, конфігурація AI-провайдерів. |
| [plans/docs/02-frontend.md](plans/docs/02-frontend.md) | Frontend Architecture — структура клієнта, Telegram Mini App, UI. |
| [plans/docs/03-database.md](plans/docs/03-database.md) | Database Design — концептуальна модель та Prisma-схема. |
| [plans/docs/04-api.md](plans/docs/04-api.md) | API Design — маршрути, DTO, контракти та валідація. |
| [plans/docs/05-decisions.md](plans/docs/05-decisions.md) | Architectural Decisions — прийняті рішення та обґрунтування. |
| [plans/docs/06-security.md](plans/docs/06-security.md) | Security — автентифікація, авторизація, rate limiting, захист даних. |
| [plans/docs/07-styles.md](plans/docs/07-styles.md) | Style Engine Specification. |
| [plans/docs/08-frontend-design.md](plans/docs/08-frontend-design.md) | Frontend Design Specification (Stage 6) — UX та acceptance criteria. |
| [plans/docs/09-telegram-sharing.md](plans/docs/09-telegram-sharing.md) | Telegram-native Sharing Architecture. |
| [plans/docs/10-repository-hygiene.md](plans/docs/10-repository-hygiene.md) | Repository hygiene audit та план очищення. |

> **Політика мови документації:** README, [AGENTS.md](AGENTS.md) і [CONTRIBUTING.md](CONTRIBUTING.md) ведуться українською (продуктовий і командний контекст); технічна документація в `plans/**` — англійською (architecture, ROADMAP, API, style engine). Дотримуйтеся цієї конвенції для нових документів.

---

# Швидкий старт (Getting Started)

## Передумови

- **Node.js ≥ 20** та npm.
- **PostgreSQL** і **Redis** (локально або у Docker).
- **Docker Desktop** — лише для інтеграційних тестів (Testcontainers).
- **Telegram Bot Token** — для реальної автентифікації Mini App.
- Щонайменше один AI-провайдер: ключ до OpenAI / Anthropic / Gemini / OpenRouter **або** локальний Ollama.

## Backend

```bash
# 1. Встановити залежності
npm install

# 2. Створити .env на основі шаблону та заповнити змінні (див. таблицю нижче)
cp .env.example .env

# 3. Згенерувати Prisma Client
npm run prisma:generate

# 4. Застосувати міграції до бази
npm run prisma:migrate

# 5. Запустити dev-сервер (http://localhost:3000)
npm run dev
```

Production-збірка: `npm run build`, запуск — `npm start`.

## Frontend

```bash
cd frontend

# 1. Встановити залежності
npm install

# 2. Запустити Vite dev-сервер (http://localhost:5173)
#    Запити на /api проксуються на backend (http://localhost:3000)
npm run dev
```

Production-збірка frontend: `npm run build` (у теці `frontend/`) — вона збирає лише app- і node-проєкти TypeScript, як це робить Docker. Типи тестів перевіряє окремий `npm run typecheck`.

## Змінні середовища

Джерело правди — Zod-схема у [`src/config/index.ts`](src/config/index.ts): невалідна конфігурація зупиняє запуск процесу. Нижче — обов'язкові та ключові опційні змінні.

### Обов'язкові

| Змінна | Опис |
| ------ | ---- |
| `DATABASE_URL` | URL підключення до PostgreSQL. |
| `REDIS_URL` | URL підключення до Redis. |
| `JWT_SECRET` | Секрет для підпису JWT (мінімум 32 символи). |
| `REFRESH_TOKEN_HMAC_SECRET` | Секрет для HMAC-хешування refresh-токенів (мінімум 32 символи). |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram-бота для перевірки `initData`. |
| `PREVIEW_ROOT_KEY` | Base64-кодований 32-байтовий ключ для шифрування preview-кешу. |

> Значення-заглушки з [`.env.example`](.env.example) (усі з позначкою `example-only`, а також демонстраційний `PREVIEW_ROOT_KEY`) відхиляються під час запуску при `NODE_ENV=production`. Копію прикладу неможливо задеплоїти як є.

### Ключові опційні (зі значеннями за замовчуванням)

| Змінна | За замовчуванням | Опис |
| ------ | ---------------- | ---- |
| `NODE_ENV` | `development` | Режим роботи (`development` / `production` / `test`). |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Адреса backend-сервера. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `7d` | Час життя access/refresh токенів. |
| `AUTH_DATE_TTL` | `86400` | TTL Telegram `auth_date` у секундах (захист від replay). |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | — | Ключі AI-провайдерів (опційні; потрібен хоча б один провайдер). Кожна змінна приймає **кілька ключів через кому** — вичерпаний ключ відкладається, запит обслуговує наступний. |
| `AI_KEY_COOLDOWN_RATE_MS` | `60000` | На скільки відкладається ключ, який упав у ліміт запитів. |
| `AI_KEY_COOLDOWN_QUOTA_MS` | `3600000` | Те саме для ключа з вичерпаною квотою. |
| `AI_KEY_COOLDOWN_INVALID_MS` | `3600000` | Те саме для ключа, який провайдер відхилив як недійсний. |
| `AI_MODEL_*` | див. конфіг | Назви моделей для кожного провайдера. |
| `AI_BASE_URL_OPENAI` | `https://api.openai.com/v1` | Базовий URL OpenAI-сумісного інстансу разом із версією API. Можна спрямувати на будь-який сумісний ендпоінт (Groq, DeepSeek, vLLM, проксі) без зміни коду. |
| `AI_BASE_URL_OPENROUTER` | `https://openrouter.ai/api/v1` | Те саме для OpenRouter. |
| `AI_EXTRA_INSTANCES` | — | Додаткові OpenAI-сумісні інстанси через кому, напр. `groq,deepseek`. Ідентифікатор — `[a-z0-9_-]`, до 32 символів, не може збігатися з вбудованим (`openai`, `anthropic`, `gemini`, `ollama`, `openrouter`). Кожен `<ID>` налаштовується через `AI_BASE_URL_<ID>`, `AI_MODEL_<ID>`, `<ID>_API_KEY` і опційний `AI_TIMEOUT_<ID>`; інстанс без URL, моделі або ключа пропускається з логом помилки, а не валить запуск. |
| `AI_PROVIDER_PRIORITY` | `openai,anthropic,gemini,ollama,openrouter` | Порядок fallback між провайдерами. Бере участь кожен налаштований інстанс: не згаданий у списку йде в кінець, а не вимикається. Невідомий ідентифікатор ігнорується з попередженням. |
| `AI_MAX_FALLBACK_ATTEMPTS` | — | Максимум провайдерів на один запит; без значення — стільки, скільки доступно. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Адреса локального Ollama. Власної змінної `AI_BASE_URL_OLLAMA` немає: до цього хоста додається OpenAI-сумісний шлях `/v1`. |
| `OLLAMA_ENABLED` | — | `true`/`false`. Без значення: увімкнено поза production, вимкнено в production (в Ollama немає API-ключа, за яким можна визначити «налаштований»). |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` / `CIRCUIT_BREAKER_RESET_MS` | `5` / `60000` | Скільки поспіль помилок відкриває breaker провайдера і на який час. |
| `TELEGRAM_INLINE_ENABLED` | `false` | Увімкнення Telegram inline-share. |
| `TELEGRAM_WEBHOOK_SECRET` | — | Обовʼязковий, якщо `TELEGRAM_INLINE_ENABLED=true`: очікуваний `x-telegram-bot-api-secret-token`. |
| `WEBHOOK_RATE_LIMIT_WINDOW_MS` / `WEBHOOK_RATE_LIMIT_MAX_REQUESTS` | `60000` / `30` | Ліміт запитів на `POST /telegram/webhook`. |
| `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX_REQUESTS` | `60000` / `20` | Ліміт на `POST /auth/telegram` за IP — окремий від загального `RATE_LIMIT_*`, бо ендпоінт видає токени. |
| `REFRESH_RATE_LIMIT_WINDOW_MS` / `REFRESH_RATE_LIMIT_MAX_REQUESTS` | `60000` / `20` | Те саме для `POST /auth/refresh`. |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Дозволені origin-и для CORS. |
| `TRUST_PROXY` | `false` | Довіряти заголовкам проксі для визначення IP. |
| `LOG_LEVEL` | `info` | Рівень логування. |

> Повний, синхронізований зі схемою перелік усіх змінних — у [`.env.example`](.env.example).

> Rate limiting, preview/save/share TTL та інші тонкі налаштування також конфігуруються через env — повний перелік дивіться у [`src/config/index.ts`](src/config/index.ts).

### Адмін-панель

Адмінка вимикається за замовчуванням: поки `ADMIN_TELEGRAM_IDS` порожній, усі маршрути `/api/v1/admin/*` віддають **404** — той самий, що й неіснуючий шлях. Доступ дають два незалежні фактори: Telegram-id зі списку і пароль, хеш якого лежить в `.env`. Ролі в базі немає — адміном робить конфігурація деплою, а не рядок у Postgres. Контракт маршрутів — у [`plans/docs/04-api.md`](plans/docs/04-api.md).

| Змінна | За замовчуванням | Опис |
| ------ | ---------------- | ---- |
| `ADMIN_TELEGRAM_IDS` | — (порожньо) | Числові Telegram-id через кому, яким дозволено вхід. Порожнє значення = адмінки не існує. Тільки id: username власник може змінити, і його не підписує Telegram в `initData`. |
| `ADMIN_PASSWORD_HASH` | — (порожньо) | scrypt-хеш пароля у форматі `scrypt$N=…,r=…,p=…$<salt>$<key>`. Генерується локально: `node scripts/hash-admin-password.mjs >> .env` (пароль вводиться на stdin, мінімум 12 символів, у виводі його немає). Форма хеша перевіряється при старті — зіпсована вставка впаде на запуску, а не виглядатиме як вічно неправильний пароль. Обовʼязковий, якщо заданий `ADMIN_TELEGRAM_IDS`: allowlist без пароля був би одним фактором. |
| `ADMIN_SESSION_TTL_SECONDS` | `900` | Idle-вікно admin-сесії: продовжується на кожному запиті до адмінки. |
| `ADMIN_SESSION_ABSOLUTE_TTL_SECONDS` | `28800` | Жорстке вікно: не продовжується ніколи, тому вкрадений admin-токен помирає протягом 8 годин навіть при активному використанні. Не може бути меншим за idle-вікно. |
| `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS` / `ADMIN_LOGIN_RATE_LIMIT_MAX` | `300000` / `5` | Ліміт спроб пароля (429). Окремий від загального бюджету, бо 100 запитів/хв — це не перешкода для перебору. |
| `ADMIN_LOGIN_MAX_FAILURES` / `ADMIN_LOGIN_LOCKOUT_MS` | `5` / `900000` | Блокування входу після N хибних паролів. Рахується **на кожен Telegram-id окремо**, тому один адмін не може заблокувати іншого; лічильник згасає разом із блокуванням. |
| `ADMIN_RATE_LIMIT_WINDOW_MS` / `ADMIN_RATE_LIMIT_MAX_REQUESTS` | `60000` / `120` | Бюджет уже автентифікованих admin-маршрутів. |
| `METRICS_MINUTE_SERIES_LENGTH` | `60` | Скільки хвилин показує графік навантаження (максимум 1440). Це і глибина серії, і час життя хвилинних лічильників: термін життя кожного ключа обчислюється з його ж кошика, тому «остання година» означає те саме для всіх ключів. |
| `METRICS_RETENTION_DAYS` | `7` | Скільки добових рядків (UTC) віддає `GET /admin/metrics` і скільки живуть добові лічильники. Прибирання немає — зберігання **і є** термін життя ключа. |
| `METRICS_TOP_USERS_LIMIT` | `10` | Скільки найактивніших користувачів за сьогодні показувати. У рядку лише внутрішній числовий id — ніколи Telegram-id і ніколи username. |
| `ADMIN_ERROR_FEED_MAX` | `100` | Довжина стрічки помилок: список у Redis обрізається до цього значення на кожному записі, тому рости він не може. `?limit=` більший за це число не помилка — його просто підріжуть. |
| `ADMIN_ERROR_FEED_TTL_SECONDS` | `604800` | Час життя всього ключа стрічки, що поновлюється при кожному записі: тиждень без збоїв спорожнює її сам. |

> `ADMIN_PASSWORD_HASH` свідомо **не** входить до переліку «заглушок», які відхиляються в production: у [`.env.example`](.env.example) ця змінна порожня, бо будь-яке правильне за формою значення-приклад було б хешем пароля, опублікованого в цьому репозиторії. Замість цього при старті працює інше правило — allowlist без хеша не дає запуститися.

> Кіл-світч провайдерів навмисно не має жодної змінної середовища: це рішення оператора, ухвалене під час роботи системи, а не налаштування деплою. Стан лежить у Redis (хеш `ai:provider:disabled`) **без TTL** і зберігається між рестартами; вимкнути й увімкнути провайдера можна лише через `PATCH /api/v1/admin/providers/:providerId` (або руками через `HDEL`). Уточнення: `FLUSHDB` увімкне назад усе, що було вимкнено, — це усвідомлений компроміс за те, що AI-шар не залежить від Postgres.

> Обидва оглядові розділи живуть виключно в Redis і нічого не пишуть у Postgres: лічильники (`metrics:req:*`, `metrics:err:*`, `metrics:users:d:*`) і стрічка помилок (`admin:errors`) самі згасають за термінами вище, тому окремого прибирання немає. Що саме туди потрапляє — обмежено списком дозволеного: статус-код, шаблон маршруту, наш код помилки, обрізане технічне повідомлення, внутрішній id користувача і `requestId`. Ні тексту запиту, ні заголовків, ні Telegram-id — див. [`plans/docs/06-security.md`](plans/docs/06-security.md).

### Frontend (Vite, build-time)

Ці змінні **не входять** до Zod-схеми backend: Vite вбудовує їх у бандл під час збірки (`VITE_*`), тому вони публічні за визначенням — секретів тут бути не може. Джерело правди для типів — [`frontend/src/vite-env.d.ts`](frontend/src/vite-env.d.ts).

| Змінна | За замовчуванням | Опис |
| ------ | ---------------- | ---- |
| `VITE_API_BASE_URL` | `http://localhost:3000/api/v1` | База для запитів до backend. У production передається як build-arg у [`Dockerfile`](Dockerfile). |
| `VITE_FEEDBACK_URL` | `https://t.me/+1lYdnphwsLBlZWMy` | Посилання на канал обговорення в розділі «Зворотний зв'язок» Налаштувань. Telegram-посилання відкриваються через `openTelegramLink`. |
| `VITE_SHARE_URL` | `https://t.me/SlangUA_bot` | Посилання, що супроводжує надісланий переклад: `t.me/share/url` вимагає параметр `url`. Вкажіть свого бота, якщо розгортаєте власний. |


---

# Тестування

## Залежності для інтеграційних тестів

**Docker Desktop** є обов'язковим для запуску інтеграційних тестів, оскільки вони використовують Testcontainers для створення тимчасових контейнерів PostgreSQL та Redis.

## Команди для запуску тестів

```bash
# Повний набір тестів (typecheck + smoke + unit + integration)
npm test

# Тільки перевірка типів
npm run test:typecheck

# Smoke-тест: production build + перевірка Style Engine
npm run test:smoke

# Модульні тести без Docker: AI-шар (пул ключів, ротація, fallback, кіл-світч провайдерів),
# Zod-схема конфігурації, хешування пароля адмінки (бібліотека + скрипт-генератор),
# метрики та стрічка помилок на фейковому Redis
npm run test:unit

# Інтеграційні тести (потрібен Docker)
npm run test:integration
```

Frontend має власний набір (тека `frontend/`): `npm test` — одноразовий прогін vitest + Testing Library, `npm run test:watch` — режим спостереження, `npm run lint`, `npm run typecheck`, `npm run build`.

Ті самі команди виконує GitHub Actions на кожен push і PR у `main` — [`.github/workflows/ci.yml`](.github/workflows/ci.yml), окремі jobs для backend (з Docker для інтеграційних тестів) і frontend.

## Особливості інтеграційних тестів

- Використовують **тимчасові контейнери** PostgreSQL та Redis (створюються автоматично через Testcontainers)
- Використовують **локальний OpenAI-сумісний мок** на `POST /v1/chat/completions` (детермінований, без зовнішніх мережевих викликів). Він підставляється замість локального Ollama, а через нього — під той самий `OpenAICompatibleAdapter`, яким працює продакшн.
- **Жодних зовнішніх викликів** до Telegram, OpenAI, Anthropic, Gemini, реального Ollama або інших сервісів
- Тести запускаються **послідовно** (серіально), оскільки конфігурація додатка та синглтони сервісів є глобальними для процесу
- Перед кожним тестом очищаються дані у Redis та PostgreSQL
- Усі секрети (`JWT_SECRET`, `REFRESH_TOKEN_HMAC_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `PREVIEW_ROOT_KEY`) — детерміновані тестові значення
- Адмінка теж має фікстуру: два `ADMIN_TELEGRAM_IDS` і `ADMIN_PASSWORD_HASH` разового пароля. Значення дублюються у [`test/integration/global-setup.ts`](test/integration/global-setup.ts) і в блоці `env` [`vitest.integration.config.mjs`](vitest.integration.config.mjs) — перший виконується до створення воркерів, другий доїжджає до них, тому обидва мусять залишатися синхронними

## Структура інтеграційних тестів

```
test/
├── integration/
│   ├── auth.integration.test.ts        # Автентифікація (Telegram, refresh, logout, rate limit)
│   ├── translate.integration.test.ts   # Переклад (усі стилі, age gate, prompt injection, AI failure)
│   ├── history.integration.test.ts     # Історія (пагінація, фільтри, favorite, власність записів)
│   ├── share.integration.test.ts       # Telegram inline share (токени, 18+ заборона)
│   ├── rate-limit.integration.test.ts  # Rate limiting (Redis-backed, headers, 429, webhook secret)
│   ├── health.integration.test.ts      # /health (liveness, без метрики) і /health/ready (DB + Redis)
│   ├── admin-auth.integration.test.ts  # Доступ до адмінки (404 для не-адмінів, пароль, крок-ап сесія)
│   ├── admin-providers.integration.test.ts # Кіл-світч провайдерів (Redis без TTL, 503 при вимкненні всього)
│   ├── admin-metrics.integration.test.ts # Метрики (хвилинна серія, добові цифри, що НЕ рахується)
│   ├── admin-errors.integration.test.ts # Стрічка помилок (реальний 5xx у стрічці, текст запиту — ні)
│   ├── global-setup.ts                 # Глобальний setup/teardown (контейнери, Prisma, mock server)
│   ├── setup-test-context.ts           # Per-file setup: контекст, очищення БД і Redis
│   └── test-context.ts                 # Спільний контекст (app, Prisma, Redis)
└── helpers/
    ├── mock-ollama-server.ts           # Детермінований OpenAI-сумісний мок (/v1/chat/completions)
    └── telegram-initdata.ts            # Генератор підписаних initData
```
