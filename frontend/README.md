# SlangUA Frontend

Клієнтська частина SlangUA — Telegram Mini App для стилізації українського тексту в різні сучасні стилі мовлення. Це React SPA на Vite, що працює всередині Telegram WebApp і спілкується з [backend-API](../plans/docs/04-api.md).

Загальний контекст проєкту — у [кореневому README](../README.md); UX-специфікація — у [08-frontend-design.md](../plans/docs/08-frontend-design.md).

## Стек

- **React 19** + **TypeScript**, збірка через **Vite**
- **@telegram-apps/sdk** — інтеграція з Telegram WebApp (тема, initData, viewport)
- **@tanstack/react-query** — робота з серверним станом і кешування запитів
- **react-router-dom** — навігація (Translate / History / Settings)
- **axios** — HTTP-клієнт до backend-API
- **oxlint** — лінтер; **vitest** + Testing Library — тести
- `lucide-react`, `clsx`, `date-fns` — UI-утиліти

## Передумови

- **Node.js ≥ 20** та npm
- Запущений backend на `http://localhost:3000` (див. [Швидкий старт](../README.md#швидкий-старт))

## Скрипти

```bash
npm install        # встановити залежності

npm run dev        # Vite dev-сервер на http://localhost:5173
npm run build      # production-збірка (tsc -b && vite build)
npm run preview    # локальний перегляд production-збірки
npm run lint       # статичний аналіз (oxlint)
npm run test       # модульні/компонентні тести (vitest)
```

## Проксі до API

У режимі розробки Vite проксує всі запити з префіксом `/api` на backend `http://localhost:3000` (див. [`vite.config.ts`](vite.config.ts)), тож CORS у dev не потрібен. У production фронтенд роздається як статика, а `/api/v1` проксується через Nginx.

## Тести

Тести виконуються під **vitest** із середовищем **jsdom**; глобальний setup — `src/test/setup.ts` (див. блок `test` у [`vite.config.ts`](vite.config.ts)). Файли тестів: `src/**/*.test.{ts,tsx}`.

## Структура `src/`

| Тека | Призначення |
| ---- | ----------- |
| `components/` | Перевикористовувані UI-компоненти |
| `pages/` | Екрани застосунку (Translate, History, Settings) |
| `context/` | React-контексти (глобальний стан, тема) |
| `hooks/` | Кастомні хуки |
| `services/` | Клієнт до backend-API та інтеграції |
| `data/` | Статичні дані/константи |
| `types/` | Спільні TypeScript-типи |
| `utils/` | Допоміжні функції |
| `styles/`, `assets/` | Стилі та статичні ресурси |
| `test/` | Налаштування та хелпери для тестів |
