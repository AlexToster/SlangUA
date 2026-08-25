import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewResult, Style, UserProfile } from '../types/api';

/**
 * The three behaviours of the translate screen that cost something when they
 * break: the debounce, the minimum length, and the 403 recovery.
 *
 * The first two are money. Every automatic preview is a paid LLM call, so a
 * debounce that stopped coalescing keystrokes would turn one translation into
 * one per character, and nothing in the UI would look wrong while it happened.
 *
 * The third is the reason this file exists at all. A user whose saved default
 * style is the 18+ one - a choice that outlives any local flag - lands on this
 * screen, the automatic preview fires, and the server answers
 * `403 AGE_RESTRICTED_STYLE`. Until recently that produced a toast pointing at
 * Settings, where age confirmation does not exist; the only place it has ever
 * existed is the dialog below. The test therefore drives the whole path: stale
 * default -> 403 -> dialog -> confirm -> a preview that succeeds.
 */

const api = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => true),
  getStyles: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  translatePreview: vi.fn(),
  saveFromPreview: vi.fn(),
  createInlineShare: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock('../services/api', () => ({ apiService: api }));

// Haptics are the only part of the Telegram bridge this screen reaches for, and
// jsdom has no bridge to reach.
vi.mock('../services/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/telegram')>()),
  triggerHapticFeedback: vi.fn(),
}));

import TranslatePage from './TranslatePage';

/** Mirrors the constants in the page; the test would be meaningless if it drifted. */
const DEBOUNCE_MS = 900;

const STYLES: Style[] = [
  { id: 'GEN_Z', title: 'Молодіжний тікток-сленг', ageRestricted: false },
  { id: 'POFENI', title: 'Зеківський жаргон', ageRestricted: true },
];

function profileWith(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
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
    ...overrides,
  };
}

const DRAFT = 'Кіт розбудив мене о шостій';

function previewOf(style: PreviewResult['slangStyle'], translatedText: string): PreviewResult {
  return {
    originalText: DRAFT,
    translatedText,
    slangStyle: style,
    providerId: 'ollama',
    previewId: '11111111-2222-3333-4444-555555555555',
  };
}

function renderPage() {
  // retry: false everywhere - a retried query would hide a rejection the test is
  // asserting about, and a retried mutation would double the call counts.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TranslatePage />
    </QueryClientProvider>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('TranslatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.isAuthenticated.mockReturnValue(true);
    api.getStyles.mockResolvedValue(STYLES);
    api.getProfile.mockResolvedValue(profileWith());
  });

  it('shows only a spinner until the style list arrives', async () => {
    // The editor must not appear before the styles do: a draft typed into it
    // would have no style to translate into and the first preview would be lost.
    api.getStyles.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(await screen.findByRole('status', { name: 'Завантаження стилів' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('coalesces a burst of keystrokes into a single preview request', async () => {
    api.translatePreview.mockResolvedValue(previewOf('GEN_Z', 'Кіт зробив вейкап о шостій'));

    renderPage();
    const editor = await screen.findByRole('textbox');
    await userEvent.type(editor, DRAFT);

    // Typing 26 characters takes far less than the debounce window, so at this
    // point a per-keystroke implementation would already have spent 24 requests.
    expect(api.translatePreview).not.toHaveBeenCalled();

    await waitFor(() => expect(api.translatePreview).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(api.translatePreview.mock.calls[0].slice(0, 2)).toEqual([DRAFT, 'GEN_Z']);
    expect(await screen.findByText('Кіт зробив вейкап о шостій')).toBeInTheDocument();
  });

  it('never translates a draft shorter than three characters', async () => {
    renderPage();
    const editor = await screen.findByRole('textbox');
    await userEvent.type(editor, 'Пр');

    // An explicit wait past the debounce, because the assertion is about
    // something that must not happen: a `waitFor` would pass instantly and prove
    // nothing.
    await sleep(DEBOUNCE_MS + 300);

    expect(api.translatePreview).not.toHaveBeenCalled();
    expect(screen.getByText('Мінімум 3 символи для перекладу')).toBeInTheDocument();
  });
});

describe('TranslatePage and the 18+ style', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.isAuthenticated.mockReturnValue(true);
    api.getStyles.mockResolvedValue(STYLES);
    // The stale state that produces the 403: the style was saved as the default
    // on some earlier install, the confirmation flag was not.
    api.getProfile.mockResolvedValue(profileWith({ defaultSlangStyle: 'POFENI' }));
  });

  it('turns a 403 on a restricted style into the confirmation dialog, then retries', async () => {
    api.translatePreview.mockRejectedValue({
      response: { status: 403, data: { code: 'AGE_RESTRICTED_STYLE' } },
    });
    api.updateProfile.mockResolvedValue(
      profileWith({ defaultSlangStyle: 'POFENI', ageConfirmedAdult: true })
    );

    renderPage();
    await userEvent.type(await screen.findByRole('textbox'), DRAFT);

    const dialog = await screen.findByRole('dialog', { name: 'Підтвердження 18+' }, { timeout: 4000 });
    expect(dialog).toBeInTheDocument();
    // The dead end this replaced: a toast sending the user to Settings.
    expect(screen.queryByText('Доступ заборонено')).not.toBeInTheDocument();

    const translated = 'Кіт підняв мене о шостій зі шконки';
    api.translatePreview.mockResolvedValue(previewOf('POFENI', translated));
    const attemptsBeforeConfirm = api.translatePreview.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: 'Так, мені є 18+' }));

    // Self-attestation, so the only thing sent is the flag itself.
    expect(api.updateProfile).toHaveBeenCalledWith({ ageConfirmedAdult: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Confirming is not the end of the story: the draft is still on screen and
    // the user never asked twice, so the page owes them the translation. The
    // style did not change, so nothing but the retry nonce can restart it.
    expect(await screen.findByText(translated, undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(api.translatePreview.mock.calls.length).toBeGreaterThan(attemptsBeforeConfirm);
  });

  it('keeps the draft and asks nothing when the dialog is dismissed', async () => {
    api.translatePreview.mockRejectedValue({
      response: { status: 403, data: { code: 'AGE_RESTRICTED_STYLE' } },
    });

    renderPage();
    await userEvent.type(await screen.findByRole('textbox'), DRAFT);
    await screen.findByRole('dialog', { name: 'Підтвердження 18+' }, { timeout: 4000 });

    await userEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Declining must not be recorded as anything: no profile write, and the text
    // the user typed is still there to switch styles for.
    expect(api.updateProfile).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue(DRAFT);
  });
});
