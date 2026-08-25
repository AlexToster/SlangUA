import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchParams } from './services/telegram';

/**
 * The bootstrap and the router, which nothing else covers.
 *
 * `App` is four screens behind one state machine: a passive spinner, "open in
 * Telegram", "sign-in failed" with a retry, and the routed app. Three of those
 * are only reachable when something has gone wrong, so they are exactly the
 * screens nobody sees during development — and a user who is shown "open in
 * Telegram" inside Telegram has no way around it.
 *
 * The `/admin` case is here for a specific regression: `LoadingScreen` used to
 * navigate to `/` on mount, which turned the Suspense fallback for the lazily
 * loaded panel into a redirect away from it. The chunk is therefore held
 * deliberately unresolved below, because a fallback that renders for one tick
 * cannot demonstrate that it stays put.
 */

const telegram = vi.hoisted(() => ({
  initTelegramApp: vi.fn(),
  applyTelegramTheme: vi.fn(),
  setupTelegramThemeListener: vi.fn(),
  setupSafeAreaInsets: vi.fn(),
}));

// Partial mock: `AppLayout` renders the real `BottomNav`, which needs the rest of
// this module (haptics, link helpers) to behave normally.
vi.mock('./services/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/telegram')>()),
  ...telegram,
}));

// The pages are stubs on purpose: this file is about which one is mounted, not
// about what any of them does. Each is covered on its own.
vi.mock('./pages/TranslatePage', () => ({ default: () => <div>translate page</div> }));
vi.mock('./pages/HistoryPage', () => ({ default: () => <div>history page</div> }));
vi.mock('./pages/SettingsPage', () => ({ default: () => <div>settings page</div> }));
vi.mock('@tanstack/react-query-devtools', () => ({ ReactQueryDevtools: () => null }));

/** Resolved by the one test that wants the admin chunk to arrive. */
let deliverAdminChunk: () => void = () => {};
const adminChunkArrived = new Promise<void>((resolve) => {
  deliverAdminChunk = resolve;
});

vi.mock('./pages/AdminPage', async () => {
  await adminChunkArrived;
  return { default: () => <div>admin page</div> };
});

import App from './App';

const LAUNCH_PARAMS: LaunchParams = {
  initData: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=stub',
  initDataRaw: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=stub',
  themeParams: { bg_color: '#17212b' },
  tgWebAppPlatform: 'android',
  tgWebAppVersion: '7.0',
  version: '7.0',
};

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

describe('App bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('shows the passive spinner while Telegram init is still pending', async () => {
    telegram.initTelegramApp.mockReturnValue(new Promise(() => {}));

    renderAt('/');

    expect(await screen.findByRole('status')).toHaveTextContent('Завантаження SlangUA');
    expect(screen.queryByText('translate page')).not.toBeInTheDocument();
  });

  it('asks the user to open the app in Telegram when there are no launch params', async () => {
    // `null`, not a throw: the SDK found no initData, which means this is a plain
    // browser tab and no amount of retrying will help.
    telegram.initTelegramApp.mockResolvedValue(null);

    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Відкрийте в Telegram' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers a retry after a failed sign-in, and recovers on the second attempt', async () => {
    telegram.initTelegramApp.mockRejectedValueOnce(new Error('handshake rejected'));

    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Не вдалося увійти' })).toBeInTheDocument();

    // The transient case this exists for: the server was unreachable for one
    // request. Nothing about the app is broken, so the button must actually
    // re-run the handshake rather than just re-render the error.
    telegram.initTelegramApp.mockResolvedValue(LAUNCH_PARAMS);
    await userEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));

    expect(await screen.findByText('translate page')).toBeInTheDocument();
    expect(telegram.initTelegramApp).toHaveBeenCalledTimes(2);
  });

  it('applies the Telegram theme and insets exactly once when init succeeds', async () => {
    telegram.initTelegramApp.mockResolvedValue(LAUNCH_PARAMS);

    renderAt('/');

    await screen.findByText('translate page');
    expect(telegram.applyTelegramTheme).toHaveBeenCalledWith(LAUNCH_PARAMS.themeParams);
    expect(telegram.setupTelegramThemeListener).toHaveBeenCalledTimes(1);
    expect(telegram.setupSafeAreaInsets).toHaveBeenCalledTimes(1);
  });
});

describe('App routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    telegram.initTelegramApp.mockResolvedValue(LAUNCH_PARAMS);
    window.history.pushState({}, '', '/');
  });

  it('mounts the history tab inside the shared layout', async () => {
    renderAt('/history');

    expect(await screen.findByText('history page')).toBeInTheDocument();
    // The bottom nav comes from `AppLayout`, so its presence is what proves the
    // page was mounted through the layout route and not beside it.
    expect(screen.getByRole('navigation', { name: 'Основна навігація' })).toBeInTheDocument();
  });

  it('mounts the settings tab inside the shared layout', async () => {
    renderAt('/settings');

    expect(await screen.findByText('settings page')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Основна навігація' })).toBeInTheDocument();
  });

  it('sends an unknown path back to the translate page', async () => {
    // Telegram can reopen a Mini App on whatever path it last remembered, and a
    // deploy that renames a route would otherwise leave the user on a blank
    // screen with no navigation at all.
    renderAt('/history/42/edit');

    expect(await screen.findByText('translate page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('stays on /admin while the panel chunk is still in flight', async () => {
    renderAt('/admin');

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Завантаження панелі');
    });
    // The regression: the fallback used to navigate to `/`, so the operator was
    // bounced home on the one render where the chunk had not arrived yet.
    expect(window.location.pathname).toBe('/admin');

    deliverAdminChunk();

    expect(await screen.findByText('admin page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin');
  });
});
