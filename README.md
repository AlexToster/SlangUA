<div align="center">

<!-- 🖼 ⟨docs/assets/logo.svg 112×112 — розкоментувати, коли файл з'явиться⟩
<img src="docs/assets/logo.svg" width="112" alt="SlangUA" />
-->

# SlangUA

<img src="docs/assets/hero-styles.png" width="360" alt="Шість голосів SlangUA за столиками кав'ярні: Gen Z із TikTok-стаканчиком, айтівець за ноутбуком, вуличний у спортивці, «пофені» у смугастому, кабінетний чиновник зі «ЗВІТОМ» і галичанин у капелюсі" />

**Один текст. Шість українських стилів.**

Демонстрація того, як AI працює з українським контекстом — гумором, діалектами
і соціальними регістрами мовлення. Зміст тексту залишається, форма змінюється
до невпізнання.

[![CI](https://github.com/AlexToster/SlangUA/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexToster/SlangUA/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-5FA04E?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Telegram Mini App](https://img.shields.io/badge/Telegram-Mini%20App-26A5E4?logo=telegram&logoColor=white)](https://t.me/SlangUA_bot)
[![Stage](https://img.shields.io/badge/%D1%81%D1%82%D0%B0%D1%82%D1%83%D1%81-MVP%20%D0%B2%20%D1%80%D0%BE%D0%B7%D1%80%D0%BE%D0%B1%D1%86%D1%96-orange)](plans/ROADMAP.md)

### [🚀 Спробувати в Telegram](https://t.me/SlangUA_bot) · [🎬 Демо](#демо) · [🎨 Стилі](#стилі) · [📚 Документація](plans/docs/README.md)

<sub><b>English:</b> SlangUA rewrites plain Ukrainian into six contrasting
registers — Gen Z, street, IT, bureaucratic, prison and Galician — keeping the
meaning intact while changing the form as far as it will go. It is a Telegram
Mini App built to show what an LLM can do with Ukrainian context: humour,
dialect and social register.</sub>

</div>

## Демо

Один і той самий текст у різних стилях:

> **Оригінал:** «Я йду додому, там мене чекають друзі.»

| Стиль | Результат |
| ----- | --------- |
| 🚬 **STREET** — двір і вулиця | «Йду в хату, там братва... ой, пацани вже чекають.» |
| ⛓ **POFENI** — жаргон, 18+ | «Двигаю до себе — там кореші вже чекають.» |

🖼 ⟨додати вивід GEN_Z, IT_SLANG, KANCLER і GALICIAN для цього ж речення⟩

Решта стилів із прикладами — у таблиці [Стилі](#стилі).

<div align="center">

🖼 ⟨demo.gif, 10–15 с: вставив текст → GEN_Z → перемкнув на KANCLER → «Поділитися»⟩

<!-- <img src="docs/assets/demo.gif" width="320" alt="SlangUA у Telegram: один текст у різних стилях" /> -->

</div>

| Переклад | Вибір стилю | Історія |
| :------: | :---------: | :-----: |
| 🖼 ⟨screenshot-translate.png⟩ | 🖼 ⟨screenshot-styles.png⟩ | 🖼 ⟨screenshot-history.png⟩ |

<!-- Після появи файлів замінити рядок вище на:
| <img src="docs/assets/screenshot-translate.png" width="240" alt="Екран перекладу"> | <img src="docs/assets/screenshot-styles.png" width="240" alt="Вибір стилю"> | <img src="docs/assets/screenshot-history.png" width="240" alt="Історія перекладів"> |
-->

> **Чесно про стан:** якість виводу залежить від обраної LLM — локальна
> 7B-модель дасть слабший результат, ніж модель класу GPT-4. Стиль `POFENI` —
> 18+. Де проєкт зараз за етапами — у [Статусі](#статус).

## Що це таке

SlangUA — **AI style translator**, а не словник, чат-бот, генератор текстів чи
машинний перекладач. Він бере твій текст і переписує його в інший стиль:

> зміст зберігається повністю, форма змінюється максимально.

За цим стоїть питання цікавіше за сам переклад: чи здатна модель триматися
українського контексту — гумору, діалекту, соціального регістру — там, де
загальний «переклад у сленг» зазвичай дає кальку з англійської. Тому кожен
стиль має власний словник, промпт, приклади та «особистість», а стилі навмисно
контрастні між собою: результат мусить бути впізнаваним з першого рядка, без
підпису, який це стиль.

Різниця між ними не лише в лексиці. **POFENI** говорить крізь тюремну ієрархію
і «поняття» — це інший регістр, ніж **STREET** (двір і вулиця), а **GALICIAN**
тримає львівську ґвару, а не «західний акцент».

Технічно: [як побудований Style Engine](plans/docs/07-styles.md).

## Стилі

Шість стилів. Ідентифікатори — значення enum `SlangStyle`.

| Стиль | Голос | Як звучить |
| ----- | ----- | ---------- |
| `GEN_Z` | TikTok, Instagram, Discord | «Сквад фармить лобі всю ніч, грінд не для слабких.» |
| `STREET` | дворовий, вулиця, базар | «Це бабло велике, на таку роздачу у мене немає.» |
| `IT_SLANG` | технічний спіч, продакшн і деплої | «Продакшн даун, алерт спрацював — лезу дебажити.» |
| `KANCLER` | бюрократ, радянщина; текст довшає у 2–4 рази | «Прошу надати вичерпну відповідь у визначений термін, беручи до уваги вищевикладені обставини…» |
| `POFENI` **18+** | тюремний жаргон, «поняття» | «Не гони. Базар по поняттях, інакше буде зашквар.» |
| `GALICIAN` | львівська ґвара | «Ходи борше до склепу за булкою, най ся не спізнимо.» |

`POFENI` доступний лише після підтвердження повноліття.
Приклади вище — справжні пари з `src/style-engine/styles/*/examples.json`.
Додати свій стиль — [чекліст в AGENTS.md](AGENTS.md).

## Можливості

- **Шість контрастних стилів** — у кожного власний словник, промпт і приклади;
  `POFENI` — 18+, за age gate.
- **Telegram Mini App** — працює всередині Telegram, без реєстрації та паролів:
  вхід через `initData`, шеринг результату в обраний чат.
- **Історія та улюблені** — останні 100 перекладів; позначені зірочкою
  зберігаються без обмежень.
- **Голосовий ввід** — надиктувати текст українською замість набирати;
  розпізнане дописується в чернетку, аудіо не зберігається ніде.
- **«Випадкова фраза»** — готова фраза одним дотиком, щоб спробувати стиль
  без придумування тексту.
- **Будь-яка LLM** — від OpenAI чи Gemini до локального Ollama і будь-якого
  OpenAI-сумісного ендпоінта; провайдер додається змінними середовища, без
  зміни коду, з автоматичним fallback і ротацією ключів за лімітами.
- **Панель оператора** — кіл-світч провайдера, навантаження по хвилинах і
  добах, стрічка останніх `5xx`. Вимкнена за замовчуванням.

## Спробувати

**Найшвидший шлях —** [@SlangUA_bot](https://t.me/SlangUA_bot) у Telegram.
Реєстрація не потрібна: вхід через Telegram-акаунт.

Свій інстанс — потрібні Node ≥ 20, PostgreSQL, Redis, токен бота від BotFather
і хоча б один AI-ключ (або локальний Ollama):

```bash
git clone https://github.com/AlexToster/SlangUA.git && cd SlangUA
npm install
cp .env.example .env      # заповнити DATABASE_URL, REDIS_URL, секрети, TELEGRAM_BOT_TOKEN, AI-ключ
npm run prisma:generate
npm run prisma:migrate
npm run dev               # http://localhost:3000
```

Frontend окремо: `cd frontend && npm install && npm run dev` — Vite на
`:5173` проксує `/api` на `:3000`.

Повна інструкція — передумови, генерація секретів, тести й типові граблі —
у [CONTRIBUTING.md](CONTRIBUTING.md#локальний-запуск). Усі змінні середовища з
описами — у [docs/configuration.md](docs/configuration.md).

## Технології

- **Backend** — Node.js, TypeScript, Fastify, Prisma, PostgreSQL, Redis.
- **Frontend** — React і Vite всередині Telegram Mini App, без CSS-фреймворків.
- **Автентифікація** — Telegram `initData` з перевіркою HMAC, далі власні JWT:
  короткий access-токен і refresh-токен, що живе в базі.
- **AI** — OpenAI, Anthropic, Gemini, OpenRouter, Ollama і будь-який
  OpenAI-сумісний ендпоінт. Порядок за замовчуванням —
  `openai → anthropic → gemini → ollama → openrouter`, змінюється однією
  змінною `AI_PROVIDER_PRIORITY`.
- **Транскрипція** — будь-який OpenAI-сумісний Whisper-ендпоінт, за
  замовчуванням Groq `whisper-large-v3-turbo`.

Як додати провайдера — [AGENTS.md](AGENTS.md).

## Архітектура

```text
Telegram Mini App → Fastify → Translation Service → AI Service → AI Provider → LLM
                                                         ↑
                                              Style Engine (бібліотека)
                                    registry · prompt · examples · lexicon
```

- **Прагматичний layered-дизайн** — `Route → Service → Prisma` без проміжних
  шарів: для MVP це свідоме рішення, зафіксоване в
  [архітектурних рішеннях](plans/docs/05-decisions.md).
- **Style Engine** будує системний промпт — і більше нічого: без бізнес-логіки,
  без бази даних, без викликів LLM. Його споживає `base.adapter.ts`, тому це не
  ланка в ланцюжку виклику, а бібліотека збоку.
- **Кеш прев'ю** — щойно перекладений текст лежить у Redis зашифрованим
  (ключі HKDF від `PREVIEW_ROOT_KEY`) із TTL 10 хвилин і стає рядком у базі лише
  після явного «Зберегти».
- **Rate limiting** — за внутрішнім id користувача, а до автентифікації за IP;
  окремі бюджети на рукостискання, збереження і транскрипцію. Лімітер fails
  closed: недоступний Redis дає `503`, а не безкоштовний прохід до платної LLM.
- **Конфігурація як контракт** — Zod-схема у `src/config/index.ts`: невалідний
  `.env` зупиняє процес на старті, а значення-заглушки з `.env.example`
  відхиляються при `NODE_ENV=production`, тому копію прикладу неможливо
  задеплоїти як є.

Інтеграційні тести піднімають тимчасові PostgreSQL і Redis через Testcontainers
і не роблять жодного зовнішнього запиту — LLM підміняється локальним
OpenAI-сумісним моком. Той самий набір проганяє
[CI](.github/workflows/ci.yml) на кожен PR; що покриває кожен файл —
[CONTRIBUTING.md](CONTRIBUTING.md#тестування).

## Статус

Стан по етапах — у [ROADMAP](plans/ROADMAP.md), тут коротко:

| Що | Стан |
| --- | --- |
| Backend, API, база, Style Engine (6 стилів) | ✅ готово для MVP |
| Шар доступу до адмінки: allowlist + пароль, кіл-світч, метрики, стрічка помилок | ✅ готово |
| Frontend + Telegram Mini App | 🚧 Stage 7, у роботі |
| Інтеграція і тестування | ⏭ Stage 8, наступний |
| Публічний деплой | 🗓 Stage 9, запланований |

**Далі:** нові стилі та ширші словники · керування стилями з адмінки без зміни
коду (промпти, словники, приклади, версії) · fallback між моделями · PWA, web і
мобільні клієнти.

Принцип розвитку: спочатку просте рішення, потім стабілізація, і лише після
цього — нові абстракції.

## Документація

Повний індекс — [plans/docs/README.md](plans/docs/README.md). Найкорисніше:

- [Архітектура](plans/architecture.md) — діаграми і побудова
- [Архітектурні рішення](plans/docs/05-decisions.md) — що вибрано і чому саме так
- [Style Engine](plans/docs/07-styles.md) — стилі, словники, приклади
- [API](plans/docs/04-api.md) — маршрути, DTO, контракти
- [Безпека](plans/docs/06-security.md) — автентифікація, rate limiting, дані
- [Конфігурація](docs/configuration.md) — усі змінні середовища
- [ROADMAP](plans/ROADMAP.md) — етапи і статуси
- [AGENTS.md](AGENTS.md) — робочі правила та інваріанти проєкту
- [CONTRIBUTING.md](CONTRIBUTING.md) — локальний запуск, секрети, перевірки перед PR
- [SLANGUA-BRIEFING.md](plans/SLANGUA-BRIEFING.md) — самодостатній технічний
  дамп, який можна віддати будь-якій моделі

> **Мова документації:** README, [AGENTS.md](AGENTS.md) і
> [CONTRIBUTING.md](CONTRIBUTING.md) — українською; технічна документація в
> `plans/**` — англійською, крім двох файлів про сам текст
> ([07-styles](plans/docs/07-styles.md), [08-frontend-design](plans/docs/08-frontend-design.md)),
> де приклади й копірайт UI лишаються українськими. Дотримуйтеся цього для
> нових документів.

---

## Внесок

PR і issue вітаються. Перед початком — [CONTRIBUTING.md](CONTRIBUTING.md) та
[AGENTS.md](AGENTS.md) (інваріанти, які легко порушити випадково).

Особливо цінний внесок — **словники і приклади для стилів**: за них не потрібно
знати архітектуру, достатньо чуття мови.
🖼 ⟨якщо готовий приймати такі PR — постав теґ `good first issue` на кілька
конкретних задач і посилайся тут на них⟩

## Зворотний зв'язок

Обговорення і повідомлення про баги —
[канал у Telegram](https://t.me/+1lYdnphwsLBlZWMy) або
[GitHub Issues](https://github.com/AlexToster/SlangUA/issues).

## Ліцензія

[MIT](LICENSE) © 2026 Oleksandr Shkutia
([@AlexToster](https://github.com/AlexToster))

Код можна вільно використовувати, змінювати й форкати, зокрема в комерційних
проєктах: MIT вимагає лише зберігати текст ліцензії разом зі згадкою автора.

Понад це — прохання, а не умова ліцензії: якщо розгортаєте власну версію або
берете код у свій проєкт, залиште десь посилання на
[github.com/AlexToster/SlangUA](https://github.com/AlexToster/SlangUA) — у
`README.md` чи в описі проєкту. Так простіше знайти оригінал і повернутися з
правками.

<div align="center">
Якщо ідея зайшла — ⭐ репозиторію допомагає її знайти іншим.
</div>

