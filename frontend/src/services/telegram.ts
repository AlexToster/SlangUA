import { init as initTelegram, retrieveLaunchParams, retrieveRawInitData, restoreInitData } from '@telegram-apps/sdk';
import { apiService } from './api';
import { getLocalSettings } from '../utils/localSettings';

export function isTMA(): boolean {
  if (window.Telegram?.WebApp?.initData) return true;
  return Boolean(getSdkInitData());
}

function getSdkInitData(): string {
  try {
    return retrieveRawInitData() || '';
  } catch {
    return '';
  }
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface LaunchParams {
  initData: string;
  initDataRaw: string;
  startParam?: string;
  themeParams: Record<string, string>;
  tgWebAppPlatform: string;
  tgWebAppVersion: string;
  version: string;
  user?: TelegramUser;
  chat?: any;
  chat_type?: string;
  chat_instance?: string;
}

// Type for the raw launch params from SDK
interface RawLaunchParams {
  themeParams?: Record<string, string>;
  tgWebAppPlatform?: string;
  tgWebAppVersion?: string;
  version?: string;
  user?: TelegramUser;
  startParam?: string;
}

export async function initTelegramApp(): Promise<LaunchParams | null> {
  let launchParams: RawLaunchParams = {};

  try {
    // The SDK can recover launch parameters from Telegram's URL fragment.
    initTelegram();
    launchParams = retrieveLaunchParams() as RawLaunchParams;
    restoreInitData();
  } catch {
    // Some Android clients expose initData only through the official WebApp bridge.
    // The server still verifies its Telegram HMAC before issuing any token.
  }

  const webApp = window.Telegram?.WebApp;
  const initData = webApp?.initData || getSdkInitData();
  
  if (!initData) {
    console.error('No initData found');
    return null;
  }

  // Authenticate with backend - let errors propagate
  await apiService.authenticateWithTelegram(initData);

  // Signal to Telegram that the app is ready
  webApp?.ready();

  // Expand to full height
  webApp?.expand();

  return {
    initData,
    initDataRaw: initData,
    themeParams: webApp?.themeParams || launchParams.themeParams || {},
    tgWebAppPlatform: launchParams.tgWebAppPlatform || 'unknown',
    tgWebAppVersion: launchParams.tgWebAppVersion || 'unknown',
    version: launchParams.version || 'unknown',
    user: launchParams.user,
    startParam: launchParams.startParam,
  };
}

export function applyTelegramTheme(themeParams: Record<string, string>) {
  const root = document.documentElement;
  
  // Map Telegram theme params to CSS variables
  const themeMap: Record<string, string> = {
    bg_color: '--tg-bg-color',
    text_color: '--tg-text-color',
    hint_color: '--tg-hint-color',
    link_color: '--tg-link-color',
    button_color: '--tg-button-color',
    button_text_color: '--tg-button-text-color',
    secondary_bg_color: '--tg-secondary-bg-color',
  };

  Object.entries(themeMap).forEach(([tgKey, cssVar]) => {
    if (themeParams[tgKey]) {
      root.style.setProperty(cssVar, themeParams[tgKey]);
    }
  });

  // Set data-theme attribute for CSS selectors
  const isDark = themeParams.bg_color && isDarkColor(themeParams.bg_color);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

function isDarkColor(color: string): boolean {
  // Simple heuristic: check if color is dark
  const hex = color.replace('#', '');
  if (hex.length !== 6) return false;
  
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

export function setupTelegramThemeListener() {
  if (!isTMA() || !window.Telegram?.WebApp) return;

  window.Telegram.WebApp.onEvent('themeChanged', () => {
    const themeParams = window.Telegram.WebApp.themeParams || {};
    applyTelegramTheme(themeParams);
  });
}

export function setupSafeAreaInsets() {
  if (!isTMA() || !window.Telegram?.WebApp) return;

  const updateSafeArea = () => {
    // safeAreaInset might be a getter or method depending on SDK version
    const safeArea = (window.Telegram.WebApp as any).safeAreaInset || { top: 0, bottom: 0, left: 0, right: 0 };
    const root = document.documentElement;
    
    root.style.setProperty('--safe-area-top', `${safeArea.top}px`);
    root.style.setProperty('--safe-area-bottom', `${safeArea.bottom}px`);
    root.style.setProperty('--safe-area-left', `${safeArea.left}px`);
    root.style.setProperty('--safe-area-right', `${safeArea.right}px`);
  };

  updateSafeArea();
  
  window.Telegram.WebApp.onEvent('safeAreaChanged', updateSafeArea);
}

export function triggerHapticFeedback(type: 'impact' | 'notification' | 'selection' = 'impact') {
  const settings = getLocalSettings();

  if (settings.soundEnabled) {
    try {
      const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextConstructor) {
        const context = new AudioContextConstructor();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = type === 'notification' ? 880 : 660;
        gain.gain.setValueAtTime(0.025, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.07);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.07);
        oscillator.addEventListener('ended', () => void context.close());
      }
    } catch {
      // Sound feedback is best-effort and must never block the product action.
    }
  }

  if (!settings.hapticEnabled || !isTMA() || !window.Telegram?.WebApp?.HapticFeedback) return;

  try {
    switch (type) {
      case 'impact':
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
        break;
      case 'notification':
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        break;
      case 'selection':
        window.Telegram.WebApp.HapticFeedback.selectionChanged();
        break;
    }
  } catch (error) {
    console.warn('Haptic feedback failed:', error);
  }
}

export function showMainButton(text: string, onClick: () => void, options?: { isVisible?: boolean; isActive?: boolean; color?: string; textColor?: string }) {
  if (!isTMA() || !window.Telegram?.WebApp?.MainButton) return;

  const btn = window.Telegram.WebApp.MainButton;
  btn.setText(text);
  btn.onClick(onClick);
  
  if (options?.color) btn.setParams({ color: options.color });
  if (options?.textColor) btn.setParams({ textColor: options.textColor });
  if (options?.isVisible !== false) btn.show();
  if (options?.isActive !== false) btn.enable();
  else btn.disable();
}

export function hideMainButton() {
  if (!isTMA() || !window.Telegram?.WebApp?.MainButton) return;
  window.Telegram.WebApp.MainButton.hide();
}

export function showBackButton(onClick: () => void) {
  if (!isTMA() || !window.Telegram?.WebApp?.BackButton) return;
  window.Telegram.WebApp.BackButton.onClick(onClick);
  window.Telegram.WebApp.BackButton.show();
}

export function hideBackButton() {
  if (!isTMA() || !window.Telegram?.WebApp?.BackButton) return;
  window.Telegram.WebApp.BackButton.hide();
}

/** Inline sharing is available only in Telegram clients that expose this API. */
export function canUseTelegramInlineSharing(): boolean {
  return isTMA() && typeof window.Telegram?.WebApp?.switchInlineQuery === 'function';
}

/**
 * Reads from the browser clipboard first, while the click's user activation
 * is still active. Telegram's bridge is the fallback for WebViews where the
 * browser Clipboard API is unavailable.
 */
export async function readTextFromClipboard(): Promise<string> {
  if (navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      // Telegram's WebView commonly denies the browser Clipboard API.
      // Try its native bridge while the originating click is still recent.
    }
  }

  const telegramClipboard = window.Telegram?.WebApp?.readTextFromClipboard;

  if (typeof telegramClipboard === 'function') {
    try {
      const text = await new Promise<string | null>((resolve, reject) => {
        try {
          telegramClipboard.call(window.Telegram.WebApp, resolve);
        } catch (error) {
          reject(error);
        }
      });

      if (typeof text === 'string') return text;
    } catch {
      // Fall through to a single, actionable unavailable-access error.
    }
  }

  throw new Error('Clipboard access is unavailable in this Telegram context');
}

/** Must be called directly from an explicit user-initiated share action. */
export function openTelegramInlineQuery(query: string): void {
  if (!canUseTelegramInlineSharing()) {
    throw new Error('Telegram inline sharing is unavailable in this client');
  }
  window.Telegram.WebApp.switchInlineQuery(query, ['users', 'groups', 'channels']);
}
