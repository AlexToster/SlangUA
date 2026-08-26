import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Style, UserProfile } from '../types/api';

/**
 * The «Додаток» section, and only it: two buttons that look alike but do very
 * different things, and a popup whose whole content is one line.
 *
 * Worth a test because both are easy to break silently. The GitHub link used to
 * live as an action *inside* the about toast, so it existed only while the
 * message was on screen; moving it out is the behaviour under test, and a
 * regression would look like a section that still has two buttons. And the
 * external link must go through `openExternalLink` — a plain `<a href>` or
 * `window.open` would keep the page inside Telegram's webview, which is not
 * something the rendered markup reveals.
 */

const api = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => true),
  hasAdminSession: vi.fn(() => false),
  getProfile: vi.fn(),
  getStyles: vi.fn(),
  updateProfile: vi.fn(),
  clearHistory: vi.fn(),
  openAdminSession: vi.fn(),
}));

vi.mock('../services/api', () => ({ apiService: api }));

// The Telegram bridge does not exist in jsdom; these two are the only parts of
// it this screen reaches for.
const telegram = vi.hoisted(() => ({
  openExternalLink: vi.fn(),
  triggerHapticFeedback: vi.fn(),
}));

vi.mock('../services/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/telegram')>()),
  ...telegram,
}));

import SettingsPage from './SettingsPage';

const STYLES: Style[] = [
  { id: 'GEN_Z', title: 'Молодіжний тікток-сленг', ageRestricted: false },
];

const PROFILE: UserProfile = {
  telegramId: '744000202',
  username: null,
  firstName: 'Flow',
  lastName: null,
  languageCode: 'uk',
  defaultSlangStyle: 'GEN_Z',
  ageConfirmedAdult: false,
  isAdmin: false,
  voiceInputAvailable: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SettingsPage, the «Додаток» section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.isAuthenticated.mockReturnValue(true);
    api.hasAdminSession.mockReturnValue(false);
    api.getProfile.mockResolvedValue(PROFILE);
    api.getStyles.mockResolvedValue(STYLES);
  });

  it('opens GitHub through the Telegram bridge, without a popup', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Відкрити GitHub автора' }));

    expect(telegram.openExternalLink).toHaveBeenCalledWith('https://github.com/AlexToster');
    // The link is a button of its own now, so nothing has to be open for it to
    // be reachable - and nothing opens when it is used.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the about line and nothing to press inside it', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Інформація про додаток' }));

    // The version is injected at build time from package.json, so the test
    // pins the wording around it rather than the number itself.
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent(/^SlangUA v\d+\.\d+\.\d+ перекладач українських стилів 2026$/);
    // The only button left inside the message is the one that dismisses it: the
    // GitHub action that used to sit here is a section button now. Scoped to the
    // toast on purpose - that section button is on screen and would match too.
    expect(
      within(toast)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Закрити']);
    expect(telegram.openExternalLink).not.toHaveBeenCalled();
  });
});
