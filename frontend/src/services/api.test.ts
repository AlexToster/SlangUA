import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The axios layer of `services/api.ts`, driven through HTTP and nothing else.
 *
 * Everything interesting in this file lives in two interceptors, and neither is
 * reachable from a unit test of a method: the request one decides which calls
 * carry which credential, and the response one owns the refresh-and-retry
 * dance. A 401 that quietly stopped being retried would show up as users being
 * bounced to the loading screen every fifteen minutes; a refresh that stopped
 * being single-flight would fire one rotation per concurrent request and
 * invalidate its own successors. Both fail silently in every other test.
 *
 * So the axios adapter is replaced instead of the module: the real interceptor
 * chain, the real `_retry` flag and the real `refreshPromise` all run, and each
 * test is written as a script of replies plus assertions on the calls that were
 * actually attempted. The adapter must be installed before `./api` is imported —
 * axios captures the adapter into instance defaults at `create` time, and the
 * module builds its instance on import.
 */

type Reply = { status: number; data?: unknown };
type Handler = (call: Call) => Reply;

interface Call {
  url: string;
  method?: string;
  authorization?: string;
  adminToken?: string;
  csrf?: string;
  params?: Record<string, unknown>;
  body?: unknown;
}

/** Every request the client attempted, in order, including refreshes and retries. */
const calls: Call[] = [];
let handler: Handler = () => ({ status: 200, data: {} });

/** The refresh call is the one made with a bare, absolute URL. */
const isRefresh = (url: string): boolean => url.endsWith('/auth/refresh');

const adapter: AxiosAdapter = async (config) => {
  // A macrotask of latency, so no reply ever lands in the same microtask that
  // sent it. Real requests never do, and the single-flight test depends on the
  // refresh still being in flight when its siblings reach the interceptor.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const headerOf = (name: string): string | undefined => {
    const value = config.headers?.get(name);
    return value === undefined || value === null ? undefined : String(value);
  };
  const call: Call = {
    url: config.url ?? '',
    method: config.method,
    authorization: headerOf('Authorization'),
    adminToken: headerOf('X-Admin-Token'),
    csrf: headerOf('X-CSRF-Token'),
    params: config.params as Record<string, unknown> | undefined,
    body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
  };
  calls.push(call);

  const reply = handler(call);
  const response = {
    data: reply.data ?? {},
    status: reply.status,
    statusText: String(reply.status),
    headers: {},
    config,
  } as AxiosResponse;

  if (reply.status >= 400) {
    throw new AxiosError(`Request failed with status code ${reply.status}`, 'ERR_BAD_REQUEST', config, {}, response);
  }
  return response;
};

axios.defaults.adapter = adapter;

let apiService: typeof import('./api').apiService;

beforeAll(async () => {
  apiService = (await import('./api')).apiService;
});

beforeEach(() => {
  calls.length = 0;
  handler = () => ({ status: 200, data: {} });
  // State is reset through the public surface rather than by re-importing the
  // module: a second instance would get a second `refreshPromise`, and the
  // single-flight test below would then pass for the wrong reason.
  apiService.clearTokens();
});

describe('request credentials', () => {
  it('sends no Authorization header before a token is set', async () => {
    await apiService.getStyles();

    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBeUndefined();
  });

  it('attaches the bearer token to every call once authenticated', async () => {
    apiService.setTokens({ accessToken: 'token-1' });

    await apiService.getStyles();
    await apiService.getProfile();

    expect(calls.map((call) => call.authorization)).toEqual(['Bearer token-1', 'Bearer token-1']);
  });

  it('keeps the admin token on /admin calls and off everything else', async () => {
    apiService.setTokens({ accessToken: 'token-1' });
    handler = (call) => ({
      status: 200,
      data: call.url === '/admin/session'
        ? { token: 'step-up-1', expiresAt: new Date().toISOString(), absoluteExpiresAt: new Date().toISOString() }
        : {},
    });

    await apiService.openAdminSession('correct horse');
    expect(apiService.hasAdminSession()).toBe(true);

    await apiService.getAdminOverview();
    await apiService.getProfile();

    // The leak this guards against is the step-up token riding along on a
    // translate or history call, where it would reach far more log lines.
    expect(calls.map((call) => [call.url, call.adminToken])).toEqual([
      ['/admin/session', undefined],
      ['/admin/overview', 'step-up-1'],
      ['/user/me', undefined],
    ]);
  });

  it('drops undefined history params instead of sending them empty', async () => {
    apiService.setTokens({ accessToken: 'token-1' });

    await apiService.getHistory({ cursor: undefined, limit: 20, favorite: undefined, search: '' });

    // `favorite=undefined` in the query string is parsed by the server as the
    // string "undefined" and fails validation; an absent key is the filter
    // being off.
    expect(calls[0].params).toEqual({ limit: 20, search: '' });
  });
});

describe('401 refresh and retry', () => {
  /** Replies 401 to anything carrying `stale`, 200 to anything carrying `fresh`. */
  const tokenAwareHandler: Handler = (call) => {
    if (isRefresh(call.url)) return { status: 200, data: { accessToken: 'fresh' } };
    if (call.authorization === 'Bearer fresh') return { status: 200, data: { telegramId: '42' } };
    return { status: 401, data: { code: 'INVALID_TOKEN' } };
  };

  it('refreshes once and replays the request with the new token', async () => {
    apiService.setTokens({ accessToken: 'stale' });
    document.cookie = 'slangua_csrf=csrf-value';
    handler = tokenAwareHandler;

    const profile = await apiService.getProfile();

    // The caller sees a resolved promise: the 401 never surfaces.
    expect(profile.telegramId).toBe('42');
    expect(calls.map((call) => call.url)).toEqual([
      '/user/me',
      'http://localhost:3000/api/v1/auth/refresh',
      '/user/me',
    ]);
    expect(calls[2].authorization).toBe('Bearer fresh');
    // The refresh is a cookie-authenticated POST, so it needs the double-submit
    // token; without it the server answers 403 and the retry never happens.
    expect(calls[1].csrf).toBe('csrf-value');
    expect(apiService.getAccessToken()).toBe('fresh');
  });

  it('gives up after one retry instead of looping', async () => {
    apiService.setTokens({ accessToken: 'stale' });
    // A refresh that succeeds but hands back a token the server still rejects:
    // the shape of a revoked session, and the shape that turns a missing
    // `_retry` guard into an infinite request loop.
    handler = (call) => (isRefresh(call.url)
      ? { status: 200, data: { accessToken: 'also-stale' } }
      : { status: 401, data: { code: 'INVALID_TOKEN' } });

    await expect(apiService.getProfile()).rejects.toMatchObject({ response: { status: 401 } });

    expect(calls.filter((call) => isRefresh(call.url))).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it('refreshes once for several requests that fail together', async () => {
    apiService.setTokens({ accessToken: 'stale' });
    handler = tokenAwareHandler;

    // Three calls in flight when the token expires is the ordinary case on app
    // start. Each of them enters the interceptor, and only the first may rotate:
    // a refresh token is single-use, so two rotations mean the second invalidates
    // the first and one request dies for no reason.
    const [styles, profile, history] = await Promise.all([
      apiService.getStyles(),
      apiService.getProfile(),
      apiService.getHistory(),
    ]);

    expect(calls.filter((call) => isRefresh(call.url))).toHaveLength(1);
    expect(calls).toHaveLength(7); // 3 rejected + 1 refresh + 3 replayed
    expect(styles).toBeDefined();
    expect(profile.telegramId).toBe('42');
    expect(history).toBeDefined();
  });
});

describe('when the refresh itself fails', () => {
  it('drops both tokens and rejects with the original error', async () => {
    apiService.setTokens({ accessToken: 'stale' });
    handler = () => ({ status: 401, data: { code: 'INVALID_TOKEN' } });

    // `window.location.reload()` runs in the catch branch. jsdom cannot navigate
    // and cannot have `location` redefined either, so it logs "Not implemented:
    // navigation to another Document" and continues - the noise in the output is
    // expected, and the assertions below are about the state it leaves behind.
    await expect(apiService.getProfile()).rejects.toMatchObject({ response: { status: 401 } });

    expect(apiService.isAuthenticated()).toBe(false);
    expect(apiService.hasAdminSession()).toBe(false);
    // The request is not replayed with a token that was never issued.
    expect(calls.map((call) => call.url)).toEqual(['/user/me', 'http://localhost:3000/api/v1/auth/refresh']);
  });

  it('does not try to refresh when there was no access token to begin with', async () => {
    handler = () => ({ status: 401, data: { code: 'UNAUTHORIZED' } });

    await expect(apiService.getProfile()).rejects.toMatchObject({ response: { status: 401 } });

    // Before the handshake there is no refresh cookie either, so a refresh here
    // would be a guaranteed second failure and a reload of a working app.
    expect(calls).toHaveLength(1);
  });
});

describe('admin gate', () => {
  beforeEach(() => {
    apiService.setTokens({ accessToken: 'stale' });
  });

  async function openSession(): Promise<void> {
    handler = () => ({
      status: 200,
      data: { token: 'step-up-1', expiresAt: new Date().toISOString(), absoluteExpiresAt: new Date().toISOString() },
    });
    await apiService.openAdminSession('correct horse');
    calls.length = 0;
  }

  it('retries an admin 404 once, because that is how a stale token looks there', async () => {
    await openSession();
    handler = (call) => {
      if (isRefresh(call.url)) return { status: 200, data: { accessToken: 'fresh' } };
      if (call.authorization === 'Bearer fresh') return { status: 200, data: { providers: [] } };
      return { status: 404, data: { code: 'NOT_FOUND' } };
    };

    await expect(apiService.getAdminOverview()).resolves.toBeDefined();

    expect(calls.map((call) => call.url)).toEqual([
      '/admin/overview',
      'http://localhost:3000/api/v1/auth/refresh',
      '/admin/overview',
    ]);
    // The step-up token survives a JWT rotation: it is a separate credential and
    // the operator should not be asked for the password again.
    expect(calls[2].adminToken).toBe('step-up-1');
  });

  it('does not refresh on an admin 401, which means the panel session expired', async () => {
    await openSession();
    handler = () => ({ status: 401, data: { code: 'ADMIN_SESSION_EXPIRED' } });

    await expect(apiService.getAdminOverview()).rejects.toMatchObject({ response: { status: 401 } });

    // Rotating the JWT would not bring the admin session back; only the password
    // will, so the error has to reach the caller unchanged.
    expect(calls).toHaveLength(1);
    expect(apiService.isAuthenticated()).toBe(true);
  });
});
