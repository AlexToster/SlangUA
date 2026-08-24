# Внесок у SlangUA

Дякуємо за інтерес до проєкту! Цей документ описує базовий процес контриб'юції. Робочі принципи для змін (scope, джерела правди, перевірки) закріплені в [AGENTS.md](AGENTS.md) — прочитайте його перед першим PR.

## Перш ніж почати

- Підніміть проєкт локально за інструкцією [Локальний запуск](#локальний-запуск) нижче.
- Ознайомтеся з архітектурою: [plans/docs/README.md](plans/docs/README.md) → [architecture.md](plans/architecture.md).
- Один раз на початку роботи перевіряйте `git status`; наявні незв'язані зміни вважаються чужими й не чіпаються.

## Локальний запуск

~5 хвилин, якщо PostgreSQL і Redis уже запущені. Без жодного AI-провайдера сервер підніметься, але переклад повертатиме помилку.

### Передумови

- **Node.js ≥ 20** та npm.
- **PostgreSQL** і **Redis** — локально або у Docker.
- **Docker Desktop** — лише для інтеграційних тестів (Testcontainers).
- **Telegram Bot Token** — для реальної автентифікації Mini App.
- Щонайменше один AI-провайдер: ключ до OpenAI / Anthropic / Gemini / OpenRouter **або** локальний Ollama, якому ключ не потрібен.

### Крок за кроком

```bash
git clone https://github.com/AlexToster/SlangUA.git
cd SlangUA
npm install
cp .env.example .env
```

`.env.example` — синхронізована зі схемою копія всіх змінних із коментарями. Мінімум, який треба заповнити своїми значеннями:

```dotenv
DATABASE_URL="postgresql://user:password@localhost:5432/slangua?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="щонайменше-32-символи"
REFRESH_TOKEN_HMAC_SECRET="інший-секрет-щонайменше-32-символи"
TELEGRAM_BOT_TOKEN="123456789:токен-від-BotFather"
PREVIEW_ROOT_KEY="base64-рівно-32-байтів"
```

Плюс хоча б один AI-ключ — `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` чи `OPENROUTER_API_KEY` (кожен приймає список ключів через кому) — або локальний Ollama.

```bash
npm run prisma:generate   # Prisma Client
npm run prisma:migrate    # міграції до локальної бази
npm run dev               # http://localhost:3000
```

Production-збірка: `npm run build`, запуск — `npm start`; на сервері міграції застосовуються через `npx prisma migrate deploy`.

Frontend — окремий процес:

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173, запити на /api ідуть на localhost:3000
```

### Секрети

Випадкові секрети — однією командою (формати різні: hex для рядкових, base64 рівно з 32 байтів для `PREVIEW_ROOT_KEY`, що схема перевіряє строго):

```bash
node -e "const c=require('crypto');const hex=()=>c.randomBytes(32).toString('hex');console.log('JWT_SECRET='+hex());console.log('REFRESH_TOKEN_HMAC_SECRET='+hex());console.log('PREVIEW_ROOT_KEY='+c.randomBytes(32).toString('base64'));console.log('TELEGRAM_WEBHOOK_SECRET='+c.randomBytes(24).toString('hex'));"
```

`JWT_SECRET` і `REFRESH_TOKEN_HMAC_SECRET` мусять бути різні: перший підписує access-токени, другий хешує refresh-токени, які в базі лежать тільки як HMAC. `TELEGRAM_WEBHOOK_SECRET` потрібен лише при `TELEGRAM_INLINE_ENABLED=true`, і те саме значення передається Telegram у `setWebhook`.

Пароль адмінки — окремим скриптом: `node scripts/hash-admin-password.mjs` (пароль читається зі stdin, ніколи з argv, і друкується готовий рядок `ADMIN_PASSWORD_HASH=`). Значення з `$` — а цей хеш містить його завжди — беріть у `.env` в **одинарні лапки**: у production файл читає парсер Docker Compose, який без лапок вирізає `$N`, і застосунок відмовляється стартувати на насправді коректному хеші. Повне пояснення — на початку [docs/configuration.md](docs/configuration.md).

Решта не генерується, а видається: `TELEGRAM_BOT_TOKEN` — у BotFather, ключі провайдерів і `STT_API_KEY` — у кабінетах сервісів. Кожен інстанс має власні секрети.

### Що вимкнено за замовчуванням

- **Адмін-панель** — поки `ADMIN_TELEGRAM_IDS` порожній, усі маршрути `/api/v1/admin/*` віддають 404.
- **Голосовий ввід** — поки `STT_API_KEY` порожній, клієнт не показує мікрофон, а `POST /api/v1/transcribe` віддає `503 STT_UNAVAILABLE`.

### Не запускається?

- `Config validation failed` — не заповнений обов'язковий ключ у `.env`; повний перелік з описами: [docs/configuration.md](docs/configuration.md).
- Порт `3000` зайнятий — змінити `PORT`.
- Переклад повертає помилку, хоча сервер піднявся — не задано жодного AI-ключа або провайдер відключений кіл-світчем (`ai:provider:disabled` у Redis).
- 🖼 ⟨додати 1–2 реальні граблі, на які власник наступив під час деплою⟩

## Робочий процес

1. Створіть окрему гілку від актуальної основної (`feature/...`, `fix/...`, `docs/...`).
2. Робіть маленькі, цілісні коміти; за можливості тримайте refactor, cleanup і функціональну зміну окремими.
3. При зміні API-контракту синхронно оновлюйте маршрут, сервіс, інтеграційний тест і [plans/docs/04-api.md](plans/docs/04-api.md). Для змін безпеки/UX оновлюйте відповідний документ у `plans/docs/`.
4. Не послаблюйте age gate, auth, ownership, rate limits, prompt-injection перевірки або серверну валідацію заради UI.

## Перевірки перед PR

**Backend (корінь проєкту):**

```bash
npm run test:typecheck      # перевірка типів
npm test                    # typecheck + smoke + unit + integration (потрібен Docker)
```

**Frontend (тека `frontend/`):**

```bash
npm run lint
npm test                    # vitest run (одноразово); npm run test:watch — у режимі спостереження
npm run typecheck           # tsc -b, включно з тестовим проєктом
npm run build               # без тестового проєкту — як у Docker
```

Ті самі команди виконує CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) на кожен push і PR у `main`: окрема job для backend (з `npx prisma generate` перед перевірками і Docker для integration-тестів) і окрема для frontend. Локальний прогін перед PR все одно потрібен — CI ловить те, що ви забули, а не замінює перевірку.

Обсяг перевірок — пропорційно до ризику зміни (див. [AGENTS.md](AGENTS.md)). Невдалий тест спочатку ізолюйте: не маскуйте його зміною очікування чи вимкненням без доказів, що контракт змінився навмисно.

## Тестування

**Docker Desktop** обов'язковий для інтеграційних тестів: вони підіймають тимчасові контейнери PostgreSQL і Redis через Testcontainers.

```bash
npm test                  # усе: typecheck + smoke + unit + integration
npm run test:typecheck    # тільки перевірка типів
npm run test:smoke        # production build + перевірка Style Engine
npm run test:unit         # без Docker
npm run test:integration  # потрібен Docker
```

`test:unit` покриває AI-шар (пул ключів, ротація, fallback, кіл-світч провайдерів), Zod-схему конфігурації, хешування пароля адмінки (бібліотека + скрипт-генератор), метрики та стрічку помилок на фейковому Redis.

Frontend має власний набір у теці `frontend/`: `npm test` (одноразовий прогін vitest + Testing Library), `npm run test:watch`, `npm run lint`, `npm run typecheck`, `npm run build`.

### Особливості інтеграційних тестів

- **Тимчасові контейнери** PostgreSQL і Redis, створюються автоматично через Testcontainers.
- **Локальний OpenAI-сумісний мок** на `POST /v1/chat/completions` — детермінований, без зовнішніх мережевих викликів. Він підставляється замість локального Ollama, а через нього — під той самий `OpenAICompatibleAdapter`, яким працює продакшн.
- **Жодних зовнішніх викликів** до Telegram, OpenAI, Anthropic, Gemini, реального Ollama чи інших сервісів.
- Тести виконуються **послідовно**: конфігурація додатка та синглтони сервісів глобальні для процесу.
- Перед кожним тестом дані у Redis і PostgreSQL очищаються.
- Усі секрети (`JWT_SECRET`, `REFRESH_TOKEN_HMAC_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `PREVIEW_ROOT_KEY`) — детерміновані тестові значення.
- Адмінка має власну фікстуру: два `ADMIN_TELEGRAM_IDS` і `ADMIN_PASSWORD_HASH` разового пароля. Значення дублюються у [`test/integration/global-setup.ts`](test/integration/global-setup.ts) і в блоці `env` [`vitest.integration.config.mjs`](vitest.integration.config.mjs) — перший виконується до створення воркерів, другий доїжджає до них, тому обидва мусять залишатися синхронними.

### Структура тестів

```text
test/
├── integration/
│   ├── auth.integration.test.ts        # Автентифікація (Telegram, refresh, logout, rate limit)
│   ├── translate.integration.test.ts   # Переклад (усі стилі, age gate, prompt injection, AI failure)
│   ├── history.integration.test.ts     # Історія (пагінація, фільтри, favorite, власність записів)
│   ├── share.integration.test.ts       # Telegram inline share (токени, 18+ заборона)
│   ├── rate-limit.integration.test.ts  # Rate limiting (Redis-backed, headers, 429, webhook secret)
│   ├── health.integration.test.ts      # /health (liveness) і /health/ready (DB + Redis)
│   ├── admin-auth.integration.test.ts  # Доступ до адмінки (404 для не-адмінів, пароль, крок-ап сесія)
│   ├── admin-providers.integration.test.ts # Кіл-світч провайдерів (Redis без TTL, 503 при вимкненні всього)
│   ├── admin-metrics.integration.test.ts   # Метрики (хвилинна серія, добові цифри, що НЕ рахується)
│   ├── admin-errors.integration.test.ts    # Стрічка помилок (реальний 5xx у стрічці, текст запиту — ні)
│   ├── global-setup.ts                 # Глобальний setup/teardown (контейнери, Prisma, mock server)
│   ├── setup-test-context.ts           # Per-file setup: контекст, очищення БД і Redis
│   └── test-context.ts                 # Спільний контекст (app, Prisma, Redis)
└── helpers/
    ├── mock-ollama-server.ts           # Детермінований OpenAI-сумісний мок (/v1/chat/completions)
    └── telegram-initdata.ts            # Генератор підписаних initData
```

## Мова документації

- README, `AGENTS.md`, `CONTRIBUTING.md` — українською.
- Технічна документація в `plans/**` (architecture, ROADMAP, API, style engine, briefing) — англійською.
- Виняток: документи, **предметом** яких є український текст, пишуться українською — [`plans/docs/07-styles.md`](plans/docs/07-styles.md) (лексикони стилів, заборонені слова, приклади «до/після») і [`plans/docs/08-frontend-design.md`](plans/docs/08-frontend-design.md) (тексти інтерфейсу). Переклад спотворив би сам матеріал, який ці документи специфікують.

Дотримуйтеся цієї конвенції для нових документів. Англійська в `plans/**` потрібна, щоб технічний контракт можна було передати будь-якому інструменту чи контриб'ютору; там, де вміст документа — це власне українські рядки, ця причина не діє.

## Секрети та конфігурація

- Ніколи не комітьте `.env` чи реальні секрети. Використовуйте `.env.example` як шаблон.
- Нові змінні середовища додавайте у Zod-схему [`src/config/index.ts`](src/config/index.ts), у [`.env.example`](.env.example) і в довідник [`docs/configuration.md`](docs/configuration.md).

## Кінці рядків

Усі текстові файли в репозиторії зберігаються з `LF`. Це закріплено в [`.gitattributes`](.gitattributes) (`* text=auto eol=lf`), тому Git нормалізує кінці рядків при коміті навіть якщо редактор на Windows записав `CRLF`. Не додавайте `core.autocrlf=true` локально й не комітьте файли з `CRLF` в обхід нормалізації — перевірити стан можна через `git ls-files --eol`.

