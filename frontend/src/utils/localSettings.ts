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

   З палітри Telegram беремо ЛИШЕ яскравість — світло чи темно. Самі фарби
   завжди наші (див. styles/global.css): різограф — це папір і дві фарби, і
   якщо в «Системній» темі підставити bg_color/text_color/button_color від
   Telegram, застосунок стане звичайним сірим Telegram-діалогом.

   Історично цей модуль тримав знімок кольорів Telegram і писав його інлайном
   на <html>. Інлайн сильніший за будь-яке правило стилелиста, тож поки він був
   там, палітра `[data-theme="dark"]` у global.css не могла подіяти: перемикач
   міняв атрибут, а видимо не змінювалося нічого. Тепер інлайнових фарб немає
   взагалі, і єдине, що приходить від Telegram — прапорець isDark. */

let telegramIsDark: boolean | null = null;

/**
 * Hand Telegram's brightness over to the theme layer. Called by
 * services/telegram.ts on start-up and on every `themeChanged` event; it
 * re-applies the user's choice, so an incoming Telegram theme never overrides
 * an explicit selection.
 */
export function setTelegramTheme(isDark: boolean) {
  telegramIsDark = isDark;
  applyTheme(getLocalSettings().theme);
}

export function applyTheme(theme: LocalSettings['theme']) {
  const root = document.documentElement;

  if (theme !== 'system') {
    root.setAttribute('data-theme-override', theme);
    root.setAttribute('data-theme', theme);
    return;
  }

  root.removeAttribute('data-theme-override');

  if (telegramIsDark !== null) {
    root.setAttribute('data-theme', telegramIsDark ? 'dark' : 'light');
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