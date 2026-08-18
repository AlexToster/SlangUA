# Telegram-native Sharing Architecture

## 1. Decision and scope

SlangUA treats sharing as an explicit, user-initiated action on a completed result. The product goal is to make a memorable translation easy to send to a Telegram chat without turning every preview into public content.

Sharing goes through Telegram's own chat chooser: the Mini App hands the server-rendered text to `t.me/share/url` with `Telegram.WebApp.openTelegramLink`, and Telegram delivers it as a normal, sendable message in the chosen chat. Inline mode (`switchInlineQuery`) is the fallback for clients without that bridge. The order is deliberate: `switchInlineQuery` only *types* `@bot s_<uuid>` into the composer and then waits for the bot to answer an inline query, so with no inline mode configured the raw token is left sitting in the input box and cannot be sent at all.

The rule the Mini App must respect is narrower than "no deep links": it must not open a generic browser share sheet, must not create a public URL for a result, and must not put anything but the message text into a share intent — no token, no preview id, no app-internal link a recipient could resolve. A `t.me/share/url` intent satisfies that: it stays inside Telegram, carries only what the server rendered, and reaches a chat only after the user picks one and sends.

The backend endpoint, encrypted payload store and webhook handler are implemented, and both client paths are wired: the share response carries `shareText` for the primary path and `inlineQuery` for the fallback.

## 2. User flow

1. A completed preview displays `Copy`, `Send in Telegram`, and `Save` as distinct actions.
2. `Send in Telegram` is available only when the host exposes `Telegram.WebApp.openTelegramLink` or `Telegram.WebApp.switchInlineQuery`, and the result is eligible to share.
3. The client calls `POST /share/inline` with an opaque `previewId` or a saved `translationId`.
4. The backend resolves only a result owned by the authenticated user, renders the message text server-side, creates a short-lived encrypted share payload, and returns both the finished `shareText` and an opaque inline query token.
5. Primary path: the Mini App passes `shareText` to `t.me/share/url` through `openTelegramLink`. Telegram opens its own chat chooser with the message prepared, and the user picks a chat and sends it explicitly.
6. Fallback path, used only when the response carries no `shareText`: the Mini App calls `switchInlineQuery(token, ['users', 'bots', 'groups', 'channels'])`, Telegram opens the selected chat in inline mode, and the bot resolves the token server-side and returns exactly one inline article result that the user selects to send.
7. Either way the sent message contains the translated text only — no app name, no style label, and not the original input. An `SlangUA · <style>` header used to be prepended; Telegram rendered the app name as a link to the bot inside what looked like the user's own message, so it was removed from the message body. The style label survives only as the title of the inline result card in Telegram's picker, which is never sent.

Copy remains the universal fallback. Saving to History remains independent: sharing never creates a `Translation` record.

## 3. Privacy, access, and content policy

- Preview content is private by default. A share payload exists only after the user presses `Send in Telegram`.
- The share token is a cryptographically random opaque UUID; it contains no input text, translated text, user ID, or style.
- Share payloads are AES-256-GCM encrypted in Redis, are bound to the originating SlangUA user and Telegram user, are never logged, and expire after 10 minutes.
- The inline bot must verify that `inlineQuery.from.id` belongs to the user who created the payload. A leaked token must not let another Telegram account retrieve the text.
- `POFENI` and any other `ageRestricted` style is shareable **only by a user who has confirmed adulthood** (`User.ageConfirmedAdult`). A recipient still cannot be age-gated, so this is a deliberate, documented narrowing of the original "never shareable" rule: the sender takes responsibility through the same self-attestation that unlocked the style. `POST /share/inline` reads the flag from the profile — `request.user` carries only `{ id, telegramId }` — and returns `403 AGE_RESTRICTED_SHARE` when it is false, including the case where a previously confirmed user withdrew the confirmation. The UI hides the share button in exactly that case; the server check is the real gate.
- Saving a preview deletes its Redis preview payload. Therefore the share endpoint accepts either a still-live `previewId` or a persisted `translationId` owned by the caller. This preserves sharing after Save without exposing History to another user.

## 4. Telegram and deployment prerequisites

The primary path needs nothing configured on the bot side: `t.me/share/url` is handled by the Telegram client itself, so a Mini App running inside Telegram can share as soon as `POST /share/inline` returns `shareText`.

The inline fallback requires all of the following before it can work in production:

- Inline mode enabled for the SlangUA bot in BotFather.
- A configured bot token and HTTPS webhook (or a deliberately operated long-polling worker) that handles `inline_query` updates.
- A server-side call to Telegram `answerInlineQuery`; the Mini App itself cannot send a message on the user’s behalf.
- A configured bot username/domain consistent with the Mini App deployment.

If neither path is available — no `openTelegramLink`, no `switchInlineQuery`, bot integration disabled, or a recoverable endpoint error — no public URL fallback is used. The UI keeps `Copy` available and shows a concise explanation.

## 5. API contract to implement

### `POST /share/inline`

JWT required. Request body is exactly one source:

```json
{ "previewId": "uuid" }
```

or

```json
{ "translationId": 123 }
```

Success (200):

```json
{ "inlineQuery": "s_<opaque-token>", "shareText": "<the finished message>", "expiresAt": "2026-08-08T12:00:00.000Z" }
```

`shareText` is the message body rendered server-side (the translation and nothing else), so the client never composes what gets sent; the Mini App hands it to Telegram's own share sheet.

Errors: `400` invalid body; `401` unauthenticated; `403 AGE_RESTRICTED_SHARE` (age-restricted style without `ageConfirmedAdult`); `404 SHARE_SOURCE_NOT_FOUND` — one code for missing, expired, and not-owned sources alike, so a caller cannot probe which one it hit; `422 SHARE_TEXT_TOO_LONG`; `429` rate limit; `503 TELEGRAM_INLINE_UNAVAILABLE`.

The endpoint must use a separate `share` rate limit, initially 10 requests/minute per user. It must not call an LLM, persist a History record, or accept raw `originalText`/`translatedText` from the client.

### Inline-query bot handler

The handler accepts only the `s_<opaque-token>` query format. It resolves the encrypted payload, verifies the Telegram sender, and returns exactly one `InlineQueryResultArticle` with:

- title: `SlangUA · <style title>` — the label of the result card in Telegram's picker, which is not part of the sent message;
- `input_message_content.message_text`: the translated text only, with no app name or style header;
- no original text, user ID, provider, preview ID, or internal metadata;
- zero cache time for user-bound content.

An invalid, expired, or foreign token returns no results. The handler must never disclose which condition occurred.

## 6. Length and failure handling

Both a `t.me/share/url` intent and an inline message have a practical text limit. Before creating a share payload, the server counts the final rendered message as Unicode grapheme clusters and rejects content above a conservative 3,800-cluster limit with `422 SHARE_TEXT_TOO_LONG`. It never silently truncates a translation.

This is especially relevant to KANCLER, whose result may be 2–4× longer than its input. The UI offers Copy on a rejected share and retains the completed result.

## 7. Acceptance criteria for the implementation task

- No preview or History record becomes public before an explicit Share action.
- A sent message contains exactly the translation the user saw, with no header — on both the `t.me/share/url` path and the inline fallback.
- A user can share a saved result after its preview TTL has expired, using an owned `translationId`.
- An inline token cannot be resolved by a different Telegram user.
- POFENI sharing is rejected server-side unless the caller has `ageConfirmedAdult: true`, and the client hides the button in the same case.
- Expired previews, unsupported clients, disabled bot integration, rate limits, and oversized KANCLER output have recoverable UI states.
- Tests cover ownership, expiry, token opacity, no History side effect, the header-free `shareText`, POFENI acceptance for a confirmed adult and rejection after the confirmation is withdrawn, and the 3,800-cluster boundary.

## 8. Implementation order

1. Add the backend share service, encrypted Redis payload, endpoint, rate limiter, and tests.
2. Add webhook/inline-query bot handling and production bot configuration.
3. [x] Add the frontend `Send in Telegram` action for eligible live previews and saved History items. It calls `POST /share/inline`, hands the returned `shareText` to `t.me/share/url` via `openTelegramLink`, and falls back to `switchInlineQuery` with the opaque token when no `shareText` is present.
4. [ ] Validate light/dark themes, 320 px layout, keyboard behavior, and Copy fallback manually in a production-configured Telegram client.
