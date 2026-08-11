export interface LocalSettings {
  theme: 'system' | 'light' | 'dark';
  soundEnabled: boolean;
  hapticEnabled: boolean;
}

const STORAGE_KEY = 'slangua_local_settings';

const DEFAULT_SETTINGS: LocalSettings = {
  theme: 'system',
  soundEnabled: false,
  hapticEnabled: true,
};

export function getLocalSettings(): LocalSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to save local settings:', error);
  }
  return updated;
}

export function applyTheme(theme: LocalSettings['theme']) {
  const root = document.documentElement;
  
  if (theme === 'system') {
    // Remove explicit theme, let Telegram theme listener handle it
    root.removeAttribute('data-theme-override');
  } else {
    root.setAttribute('data-theme-override', theme);
    root.setAttribute('data-theme', theme);
  }
}

export function initThemeFromStorage() {
  const settings = getLocalSettings();
  applyTheme(settings.theme);
  return settings;
}