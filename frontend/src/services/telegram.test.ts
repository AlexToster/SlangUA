import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTextFromClipboard } from './telegram';

describe('readTextFromClipboard', () => {
  const webApp = window.Telegram.WebApp;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('');
    vi.mocked(webApp.readTextFromClipboard).mockReset();
  });

  it('uses the browser clipboard while the click user gesture is active', async () => {
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('Текст із браузера');

    await expect(readTextFromClipboard()).resolves.toBe('Текст із браузера');
    expect(webApp.readTextFromClipboard).not.toHaveBeenCalled();
  });

  it('falls back to Telegram clipboard when the browser denies access', async () => {
    vi.mocked(navigator.clipboard.readText).mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    vi.mocked(webApp.readTextFromClipboard).mockImplementation((callback) => callback('Текст із Telegram'));

    await expect(readTextFromClipboard()).resolves.toBe('Текст із Telegram');
  });

  it('rejects when Telegram does not grant clipboard access', async () => {
    vi.mocked(navigator.clipboard.readText).mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    vi.mocked(webApp.readTextFromClipboard).mockImplementation((callback) => callback(null));

    await expect(readTextFromClipboard()).rejects.toThrow('Clipboard access is unavailable');
  });
});
