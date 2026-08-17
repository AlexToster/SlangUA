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
* історія перекладів.

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

> Список AI-провайдерів відкритий: нові провайдери можуть додаватися без зміни архітектури, завдяки Adapter Pattern.

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

### Ключові опційні (зі значеннями за замовчуванням)

| Змінна | За замовчуванням | Опис |
| ------ | ---------------- | ---- |
| `NODE_ENV` | `development` | Режим роботи (`development` / `production` / `test`). |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Адреса backend-сервера. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `7d` | Час життя access/refresh токенів. |
| `AUTH_DATE_TTL` | `86400` | TTL Telegram `auth_date` у секундах (захист від replay). |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | — | Ключі AI-провайдерів (опційні; потрібен хоча б один провайдер). |
| `AI_MODEL_*` | див. конфіг | Назви моделей для кожного провайдера. |
| `AI_BASE_URL_OPENAI` | `https://api.openai.com/v1` | Базовий URL OpenAI-сумісного інстансу разом із версією API. Можна спрямувати на будь-який сумісний ендпоінт (Groq, DeepSeek, vLLM, проксі) без зміни коду. |
| `AI_BASE_URL_OPENROUTER` | `https://openrouter.ai/api/v1` | Те саме для OpenRouter. |
| `AI_PROVIDER_PRIORITY` | `openai,anthropic,gemini,ollama,openrouter` | Порядок fallback між провайдерами. |
| `AI_MAX_FALLBACK_ATTEMPTS` | — | Максимум провайдерів на один запит; без значення — стільки, скільки доступно. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Адреса локального Ollama. Власної змінної `AI_BASE_URL_OLLAMA` немає: до цього хоста додається OpenAI-сумісний шлях `/v1`. |
| `OLLAMA_ENABLED` | — | `true`/`false`. Без значення: увімкнено поза production, вимкнено в production (в Ollama немає API-ключа, за яким можна визначити «налаштований»). |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` / `CIRCUIT_BREAKER_RESET_MS` | `5` / `60000` | Скільки поспіль помилок відкриває breaker провайдера і на який час. |
| `TELEGRAM_INLINE_ENABLED` | `false` | Увімкнення Telegram inline-share. |
| `TELEGRAM_WEBHOOK_SECRET` | — | Обовʼязковий, якщо `TELEGRAM_INLINE_ENABLED=true`: очікуваний `x-telegram-bot-api-secret-token`. |
| `WEBHOOK_RATE_LIMIT_WINDOW_MS` / `WEBHOOK_RATE_LIMIT_MAX_REQUESTS` | `60000` / `30` | Ліміт запитів на `POST /telegram/webhook`. |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Дозволені origin-и для CORS. |
| `TRUST_PROXY` | `false` | Довіряти заголовкам проксі для визначення IP. |
| `LOG_LEVEL` | `info` | Рівень логування. |

> Повний, синхронізований зі схемою перелік усіх змінних — у [`.env.example`](.env.example).

> Rate limiting, preview/save/share TTL та інші тонкі налаштування також конфігуруються через env — повний перелік дивіться у [`src/config/index.ts`](src/config/index.ts).

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
# Повний набір тестів (typecheck + smoke + integration)
npm test

# Тільки перевірка типів
npm run test:typecheck

# Smoke-тест: production build + перевірка Style Engine
npm run test:smoke

# Інтеграційні тести (потрібен Docker)
npm run test:integration
```

## Особливості інтеграційних тестів

- Використовують **тимчасові контейнери** PostgreSQL та Redis (створюються автоматично через Testcontainers)
- Використовують **локальний OpenAI-сумісний мок** на `POST /v1/chat/completions` (детермінований, без зовнішніх мережевих викликів). Він підставляється замість локального Ollama, а через нього — під той самий `OpenAICompatibleAdapter`, яким працює продакшн.
- **Нікаких зовнішніх викликів** до Telegram, OpenAI, Anthropic, Gemini, реального Ollama або інших сервісів
- Тести запускаються **послідовно** (серіально), оскільки конфігурація додатка та синглтони сервісів є глобальними для процесу
- Перед кожним тестом очищаються дані у Redis та PostgreSQL
- Усі секрети (`JWT_SECRET`, `REFRESH_TOKEN_HMAC_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `PREVIEW_ROOT_KEY`) — детерміновані тестові значення

## Структура інтеграційних тестів

```
test/
├── integration/
│   ├── auth.integration.test.ts        # Автентифікація (Telegram, refresh, logout, rate limit)
│   ├── translate.integration.test.ts   # Переклад (усі стилі, age gate, prompt injection, AI failure)
│   ├── history.integration.test.ts     # Історія (пагінація, фільтри, favorite, власність записів)
│   ├── share.integration.test.ts       # Telegram inline share (токени, 18+ заборона)
│   ├── rate-limit.integration.test.ts  # Rate limiting (Redis-backed, headers, 429, webhook secret)
│   ├── global-setup.ts                 # Глобальний setup/teardown (контейнери, Prisma, mock server)
│   ├── setup-test-context.ts           # Per-file setup: контекст, очищення БД і Redis
│   └── test-context.ts                 # Спільний контекст (app, Prisma, Redis)
└── helpers/
    ├── mock-ollama-server.ts           # Детермінований OpenAI-сумісний мок (/v1/chat/completions)
    └── telegram-initdata.ts            # Генератор підписаних initData
```
