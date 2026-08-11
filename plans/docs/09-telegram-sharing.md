# Telegram-native Sharing Architecture

## 1. Decision and scope

SlangUA treats sharing as an explicit, user-initiated action on a completed result. The product goal is to make a memorable translation easy to send to a Telegram chat without turning every preview into public content.

The first supported destination is Telegram inline mode. The Mini App must not attempt to implement sharing by putting translated text in a deep link, opening a generic browser share sheet, or silently creating a public URL.

The backend endpoint, encrypted payload store and webhook handler are implemented. The client button remains intentionally deferred until production inline-bot configuration is complete and tested in Telegram.

## 2. User flow

1. A completed preview displays `Copy`, `Send in Telegram`, and `Save` as distinct actions.
2. `Send in Telegram` is available only when the host supports `Telegram.WebApp.switchInlineQuery` and the result is eligible to share.
3. The client calls `POST /share/inline` with an opaque `previewId` or a saved `translationId`.
4. The backend resolves only a result owned by the authenticated user, creates a short-lived encrypted share payload, and returns an opaque inline query token.
5. The Mini App calls `switchInlineQuery(token, ['users', 'bots', 'groups', 'channels'])`.
6. Telegram opens the selected chat in inline mode. The bot receives the token, resolves it server-side, and returns exactly one inline article result.
7. The user explicitly selects that result to send it. The message contains the translated text and its style label; it does not contain the original input by default.

Copy remains the universal fallback. Saving to History remains independent: sharing never creates a `Translation` record.

## 3. Privacy, access, and content policy

- Preview content is private by default. A share payload exists only after the user presses `Send in Telegram`.
- The share token is a cryptographically random opaque UUID; it contains no input text, translated text, user ID, or style.
- Share payloads are AES-256-GCM encrypted in Redis, are bound to the originating SlangUA user and Telegram user, are never logged, and expire after 10 minutes.
- The inline bot must verify that `inlineQuery.from.id` belongs to the user who created the payload. A leaked token must not let another Telegram account retrieve the text.
- `POFENI` is **not shareable in the first version**. A recipient cannot be age-gated before an inline message is sent. `POST /share/inline` returns `403 AGE_RESTRICTED_SHARE`; the UI explains that this 18+ result can be copied but not shared.
- Saving a preview deletes its Redis preview payload. Therefore the share endpoint accepts either a still-live `previewId` or a persisted `translationId` owned by the caller. This preserves sharing after Save without exposing History to another user.

## 4. Telegram and deployment prerequisites

The feature requires all of the following before the UI action can be enabled in production:

- Inline mode enabled for the SlangUA bot in BotFather.
- A configured bot token and HTTPS webhook (or a deliberately operated long-polling worker) that handles `inline_query` updates.
- A server-side call to Telegram `answerInlineQuery`; the Mini App itself cannot send a message on the user’s behalf.
- A configured bot username/domain consistent with the Mini App deployment.

If the client lacks `switchInlineQuery`, if the bot integration is disabled, or if the endpoint returns a recoverable error, no public URL fallback is used. The UI keeps `Copy` available and shows a concise explanation.

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
{ "inlineQuery": "s_<opaque-token>", "expiresAt": "2026-08-08T12:00:00.000Z" }
```

Errors: `400` invalid body; `401` unauthenticated; `403 AGE_RESTRICTED_SHARE`; `404` source not found or not owned; `410` preview expired; `422 SHARE_TEXT_TOO_LONG`; `429` rate limit; `503` Telegram integration unavailable.

The endpoint must use a separate `share` rate limit, initially 10 requests/minute per user. It must not call an LLM, persist a History record, or accept raw `originalText`/`translatedText` from the client.

### Inline-query bot handler

The handler accepts only the `s_<opaque-token>` query format. It resolves the encrypted payload, verifies the Telegram sender, and returns exactly one `InlineQueryResultArticle` with:

- title: `SlangUA · <style title>`;
- `input_message_content.message_text`: style label plus translated text only;
- no original text, user ID, provider, preview ID, or internal metadata;
- zero cache time for user-bound content.

An invalid, expired, or foreign token returns no results. The handler must never disclose which condition occurred.

## 6. Length and failure handling

Telegram inline messages have a practical text limit. Before creating a share payload, the server counts the final rendered message as Unicode grapheme clusters and rejects content above a conservative 3,800-cluster limit with `422 SHARE_TEXT_TOO_LONG`. It never silently truncates a translation.

This is especially relevant to KANCLER, whose result may be 2–4× longer than its input. The UI offers Copy on a rejected share and retains the completed result.

## 7. Acceptance criteria for the implementation task

- No preview or History record becomes public before an explicit Share action.
- A successful inline result contains exactly the translation and style label that the user saw.
- A user can share a saved result after its preview TTL has expired, using an owned `translationId`.
- An inline token cannot be resolved by a different Telegram user.
- POFENI sharing is rejected server-side and has a clear client explanation.
- Expired previews, unsupported clients, disabled bot integration, rate limits, and oversized KANCLER output have recoverable UI states.
- Tests cover ownership, expiry, token opacity, no History side effect, POFENI rejection, and the 3,800-cluster boundary.

## 8. Implementation order

1. Add the backend share service, encrypted Redis payload, endpoint, rate limiter, and tests.
2. Add webhook/inline-query bot handling and production bot configuration.
3. [x] Add the frontend `Send in Telegram` action for eligible live previews and saved History items. It calls `POST /share/inline` and passes only the returned opaque inline query to `switchInlineQuery`.
4. [ ] Validate light/dark themes, 320 px layout, keyboard behavior, and Copy fallback manually in a production-configured Telegram client.
