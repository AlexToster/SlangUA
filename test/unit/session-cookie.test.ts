/**
 * Session cookie attribute unit tests.
 *
 * These attributes are the kind of thing that breaks in exactly one client and
 * says nothing anywhere: a browser that rejects a `Set-Cookie` answers the
 * request normally, so a wrong combination looks like "the session sometimes
 * does not stick" on Telegram Web and works everywhere else. The production
 * branch is also the branch tests never take by accident - the suite runs with
 * `NODE_ENV=test` - so it is pinned here explicitly rather than trusted.
 *
 * The invariant worth more than any single assertion: `SameSite=None` never
 * appears without `Secure`. Browsers drop that cookie silently.
 */

import { describe, it, expect } from 'vitest';
import { serializeSessionCookie, type SessionCookie } from '../../src/lib/session-cookie';

/** The refresh cookie as `/auth/telegram` sends it, minus the environment. */
function refreshCookie(overrides: Partial<SessionCookie> = {}): SessionCookie {
  return {
    name: 'slangua_refresh',
    value: 'opaque-refresh-token',
    maxAge: 604800,
    path: '/api/v1/auth',
    httpOnly: true,
    crossSite: false,
    ...overrides,
  };
}

function attributesOf(cookie: string): string[] {
  return cookie.split('; ').slice(1);
}

describe('serializeSessionCookie', () => {
  describe('development and test (crossSite: false)', () => {
    it('keeps SameSite=Lax and stays usable over plain http', () => {
      const cookie = serializeSessionCookie(refreshCookie());

      expect(attributesOf(cookie)).toEqual(['Path=/api/v1/auth', 'Max-Age=604800', 'SameSite=Lax', 'HttpOnly']);
      expect(cookie).not.toContain('Secure');
      expect(cookie).not.toContain('Partitioned');
    });
  });

  describe('production (crossSite: true)', () => {
    it('sends SameSite=None with Secure and Partitioned', () => {
      const cookie = serializeSessionCookie(refreshCookie({ crossSite: true }));

      expect(attributesOf(cookie)).toEqual([
        'Path=/api/v1/auth',
        'Max-Age=604800',
        'SameSite=None',
        'Secure',
        'Partitioned',
        'HttpOnly',
      ]);
    });

    it('never emits SameSite=None without Secure', () => {
      // Every shape the two callers can produce: refresh and csrf, set and cleared.
      const shapes: SessionCookie[] = [
        refreshCookie({ crossSite: true }),
        refreshCookie({ crossSite: true, value: '', maxAge: 0 }),
        refreshCookie({ crossSite: true, name: 'slangua_csrf', path: '/', httpOnly: false }),
        refreshCookie({ crossSite: true, name: 'slangua_csrf', path: '/', httpOnly: false, value: '', maxAge: 0 }),
      ];

      for (const shape of shapes) {
        const cookie = serializeSessionCookie(shape);
        expect(cookie).toContain('SameSite=None');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('Partitioned');
      }
    });
  });

  it('marks only the refresh cookie HttpOnly', () => {
    const refresh = serializeSessionCookie(refreshCookie({ crossSite: true }));
    const csrf = serializeSessionCookie(
      refreshCookie({ crossSite: true, name: 'slangua_csrf', path: '/', httpOnly: false }),
    );

    expect(refresh).toContain('HttpOnly');
    // The frontend reads this one through document.cookie to fill X-CSRF-Token;
    // HttpOnly here would break refresh with a 403 rather than an error.
    expect(csrf).not.toContain('HttpOnly');
  });

  it('clears a cookie with the same attributes it was set with', () => {
    // A deletion only lands if it matches the cookie it replaces - same Path,
    // same SameSite context. Only Max-Age and the value differ.
    const set = serializeSessionCookie(refreshCookie({ crossSite: true }));
    const cleared = serializeSessionCookie(refreshCookie({ crossSite: true, value: '', maxAge: 0 }));

    expect(cleared).toBe('slangua_refresh=; Path=/api/v1/auth; Max-Age=0; SameSite=None; Secure; Partitioned; HttpOnly');
    expect(attributesOf(cleared).filter((a) => !a.startsWith('Max-Age')))
      .toEqual(attributesOf(set).filter((a) => !a.startsWith('Max-Age')));
  });

  it('percent-encodes the value so a token cannot forge an attribute', () => {
    const cookie = serializeSessionCookie(refreshCookie({ value: 'a; Domain=evil.example' }));

    expect(cookie.startsWith('slangua_refresh=a%3B%20Domain%3Devil.example;')).toBe(true);
    expect(attributesOf(cookie)).not.toContain('Domain=evil.example');
  });

  it('passes the path through unchanged', () => {
    const cookie = serializeSessionCookie(refreshCookie({ name: 'slangua_csrf', path: '/', httpOnly: false }));

    expect(cookie).toContain('Path=/');
  });
});
