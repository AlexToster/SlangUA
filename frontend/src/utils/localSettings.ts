export interface LocalSettings {
  theme: 'system' | 'light' | 'dark';
  soundEnabled: boolean;
  hapticEnabled: boolean;
}

// Single source of truth for the storage key — also used by the cross-tab `storage` listener.
export const LOCAL_SETTINGS_STORAGE_KEY = 'slangua_local_settings';

const DEFAULT_SETTINGS: LocalSettings = {
  theme: 'system',
  soundEnabled: false,
  hapticEnabled: true,
};

export function getLocalSettings(): LocalSettings {
  try {
    const stored = localStorage.getItem(LOCAL_SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.warn('Failed to parse local settings:', error);
  }
  return DEFAULT_SETTINGS;
}

export function setLocalSettings(settings: Partial<LocalSettings>): LocalSettings {
  const current = getLocalSettings();
  const updated = { ...current, ...settings };
  try {
    localStorage.setItem(LOCAL_SETTINGS_STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to save local settings:', error);
  }
  return updated;
}

/* Theme application.

   Telegram delivers its palette as themeParams, which used to be written
   straight onto <html> as inline custom properties (--tg-bg-color and friends).
   Inline styles beat every stylesheet rule, so while they were present the
   `[data-theme="dark"]` palette in global.css could never take effect: the
   picker changed the attribute and nothing visibly happened. The snapshot is
   therefore kept here and *withdrawn* from the element whenever the user picks
   an explicit theme, and reinstated when they go back to "Системна". */

const TELEGRAM_THEME_VARS = [
  '--tg-bg-color',
  '--tg-text-color',
  '--tg-hint-color',
  '--tg-link-color',
  '--tg-button-color',
  '--tg-button-text-color',
  '--tg-secondary-bg-color',
] as const;

let telegramTheme: { vars: Record<string, string>; isDark: boolean } | null = null;

/**
 * Hand the Telegram palette over to the theme layer. Called by
 * services/telegram.ts on start-up and on every `themeChanged` event; it
 * re-applies the user's choice, so an incoming Telegram theme never overrides
 * an explicit selection.
 */
export function setTelegramTheme(vars: Record<string, string>, isDark: boolean) {
  telegramTheme = { vars, isDark };
  applyTheme(getLocalSettings().theme);
}

export function applyTheme(theme: LocalSettings['theme']) {
  const root = document.documentElement;

  // Always start from a clean slate: no inline palette, so the stylesheet wins.
  TELEGRAM_THEME_VARS.forEach((name) => root.style.removeProperty(name));

  if (theme !== 'system') {
    root.setAttribute('data-theme-override', theme);
    root.setAttribute('data-theme', theme);
    return;
  }

  root.removeAttribute('data-theme-override');

  if (telegramTheme) {
    Object.entries(telegramTheme.vars).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });
    root.setAttribute('data-theme', telegramTheme.isDark ? 'dark' : 'light');
    return;
  }

  // Outside Telegram: leave the attribute off entirely so the
  // `prefers-color-scheme` block in global.css decides, and keeps deciding when
  // the OS setting changes.
  root.removeAttribute('data-theme');
}

export function initThemeFromStorage() {
  const settings = getLocalSettings();
  applyTheme(settings.theme);
  return settings;
}