# Frontend Architecture

The frontend is a React 18 + Vite + TypeScript Telegram Mini App. This document covers structure and responsibilities only; the visual system, layout rules and component behaviour live in [Frontend Design](08-frontend-design.md), and the endpoints it consumes in [API](04-api.md).

## Boot sequence

`App.tsx` owns a four-state machine — `loading`, `not-in-telegram`, `auth-failed`, `ready` — and renders routes only in `ready`. On mount it restores the saved theme from `localStorage`, then calls `initTelegramApp()`, which reads `initData` from the Telegram SDK and exchanges it for an access token. A missing SDK or missing `initData` produces `not-in-telegram`; a rejected exchange produces `auth-failed` with a retry button. There is no anonymous or browser-only mode: without a valid Telegram session the app renders an explanation instead of the UI.

Once ready, `applyTelegramTheme`, `setupTelegramThemeListener` and `setupSafeAreaInsets` map Telegram's theme parameters and insets onto CSS custom properties, so the app follows the host's light/dark theme without re-rendering React.

## Layers

- **`services/telegram.ts`** — the only module that touches `window.Telegram.WebApp`: init and auth handshake, theme and safe-area sync, haptics, clipboard reads, external links, and the sharing bridge (`openTelegramLink` with `t.me/share/url`, `switchInlineQuery` as fallback). Every call is guarded, so the module is inert outside Telegram rather than throwing.
- **`services/api.ts`** — a single typed Axios client class holding the access token in memory, refreshing it through the HttpOnly cookie + CSRF header pair on `401`, and exposing one method per endpoint. Nothing else in the app constructs a request.
- **`types/api.ts`** — request/response shapes shared with the backend contract. `types/telegram.d.ts` describes the host SDK surface.
- **`pages/`** — three routed screens (`TranslatePage`, `HistoryPage`, `SettingsPage`) wrapped by `AppLayout`, which provides the single-scroll shell and the in-flow bottom navigation.
- **`components/`** — presentational units: `TextInput`, `StyleDropdown`, `PreviewResult`, `BottomNav`, `SelectField`, `ConfirmDialog`, `Toast`, `ErrorBanner`, `LoadingScreen`. Each ships its own CSS file; there is no CSS-in-JS and no utility framework.
- **`utils/`** — `localSettings` (theme and default-style persistence), `previewAttempts` (client-side regeneration accounting), `styleLabels` / `providerLabels` (display names), `text` (grapheme-aware counting).

## Server state

TanStack Query is the only cache: 5-minute `staleTime`, one retry, no refetch on window focus. Translation uses the preview/save split — `POST /translate/preview` returns an unsaved result held in component state, and `POST /translate/save` persists it by `previewId`. History is an infinite-scroll cursor list with favourite and search filters, invalidated after a save, a favourite toggle or a delete. The client never sends translated text back to the server for persistence.
