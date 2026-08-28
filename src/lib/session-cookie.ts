/**
 * Serialization of the session cookie pair, in one place.
 *
 * Two cookies leave `/auth/telegram` and `/auth/refresh`: the HttpOnly
 * `slangua_refresh` and the readable `slangua_csrf` half of the double-submit
 * pair. They share every attribute except HttpOnly and Path, and those shared
 * attributes are the whole reason this file exists - the combination is not
 * obvious, and getting it wrong fails silently in one client only.
 *
 * **SameSite.** On Telegram Web the Mini App is an iframe inside
 * web.telegram.org, so a request from our own page to our own API is
 * *cross-site* as far as the cookie jar is concerned: the site for cookies is
 * computed over the whole frame-ancestor chain, not from the request URL. A
 * `SameSite=Lax` cookie is therefore neither stored on the way in nor sent on
 * the way out, and the silent refresh degrades into a full reload. `None` is
 * what makes that context work; the native clients, where Telegram loads the
 * page as the top-level document, never needed it.
 *
 * **Secure.** Browsers reject `SameSite=None` unless the cookie is also
 * `Secure`, and a rejected `Set-Cookie` raises nothing anywhere - the response
 * is a normal 200 with no session attached. So both attributes are decided by
 * one flag and cannot drift apart: `crossSite` means "None and Secure", its
 * absence means "Lax and no Secure". That is also why the caller derives the
 * flag from `NODE_ENV === 'production'` instead of a setting of its own -
 * production is HTTPS by contract (see docs/operations.md), while an
 * independent switch could be turned on over plain http, where it would drop
 * every session cookie without a word.
 *
 * **Partitioned.** CHIPS: the cookie is stored under a key that includes the
 * embedding top-level site, which is how a cookie survives in a browser that
 * blocks unpartitioned third-party ones. It costs nothing where it is not
 * implemented, since an unknown attribute is ignored, and the semantics are the
 * ones we want anyway - this session is only ever used inside our own frame, so
 * a separate session per embedder is correct rather than a limitation.
 *
 * **What holds CSRF up once SameSite is None:** nothing in this file. `Lax` was
 * never the defence. `/auth/refresh` requires the `slangua_csrf` cookie echoed
 * in an `X-CSRF-Token` header and compares the two with `timingSafeEqual`
 * (src/routes/auth.ts), and a third-party page can neither read that cookie nor
 * see a cross-origin response body: CORS is an explicit allowlist, not a
 * reflector. Widening SameSite gives up a second layer, not the only one.
 */

export interface SessionCookie {
  name: string;
  value: string;
  /** Lifetime in seconds. `0` clears the cookie. */
  maxAge: number;
  path: string;
  httpOnly: boolean;
  /**
   * True when the cookie has to work inside a cross-site iframe, which also
   * forces `Secure` and opts into `Partitioned`. See the note above: callers
   * pass `NODE_ENV === 'production'`, not a configuration value of its own.
   */
  crossSite: boolean;
}

export function serializeSessionCookie(cookie: SessionCookie): string {
  const attributes = [
    `${cookie.name}=${encodeURIComponent(cookie.value)}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAge}`,
    `SameSite=${cookie.crossSite ? 'None' : 'Lax'}`,
  ];
  // Never separated from `SameSite=None`: see the note above.
  if (cookie.crossSite) attributes.push('Secure', 'Partitioned');
  if (cookie.httpOnly) attributes.push('HttpOnly');
  return attributes.join('; ');
}
