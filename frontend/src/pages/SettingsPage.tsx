import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { triggerHapticFeedback, openExternalLink } from '../services/telegram';
import { getLocalSettings, setLocalSettings, applyTheme, LOCAL_SETTINGS_STORAGE_KEY } from '../utils/localSettings';
import { Toast } from '../components/Toast';
import { ErrorBanner } from '../components/ErrorBanner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PasswordPrompt } from '../components/PasswordPrompt';
import { SelectField, type SelectFieldOption } from '../components/SelectField';
import type { UserProfile, SlangStyle, Style } from '../types/api';
import { getStyleLabel } from '../utils/styleLabels';
import './SettingsPage.css';

// Public discussion channel. Overridable per deployment; the built-in value is
// the project's own channel, so the row is always available.
const FEEDBACK_URL = import.meta.env.VITE_FEEDBACK_URL?.trim() || 'https://t.me/+1lYdnphwsLBlZWMy';

const THEME_OPTIONS: SelectFieldOption<'system' | 'light' | 'dark'>[] = [
  { value: 'system', label: 'Системна' },
  { value: 'light', label: 'Світла' },
  { value: 'dark', label: 'Темна' },
];

// '' stands for "no default style" (null on the server) - SelectField works on
// plain strings, so the empty value is mapped back to null on change.
const AUTO_STYLE_VALUE = '';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [errorBanner, setErrorBanner] = useState<{ message: string; code?: string } | null>(null);
  const [localSettings, setLocalSettingsState] = useState(() => getLocalSettings());
  const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [adminPromptError, setAdminPromptError] = useState<string | null>(null);

  // Fetch profile
  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiService.getProfile(),
    enabled: apiService.isAuthenticated(),
  });

  // Fetch styles for default style selector
  const { data: styles } = useQuery({
    queryKey: ['styles', profile?.ageConfirmedAdult],
    queryFn: () => apiService.getStyles(),
    enabled: apiService.isAuthenticated(),
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: (data: Partial<UserProfile>) => apiService.updateProfile(data),
    onSuccess: (updatedProfile) => {
      setToast({ message: 'Налаштування збережено', type: 'success' });
      triggerHapticFeedback('notification');
      queryClient.setQueryData(['profile'], updatedProfile);
      queryClient.invalidateQueries({ queryKey: ['styles'] });
    },
    onError: (error: any) => {
      handleApiError(error);
    },
  });

  // Clear history mutation
  const clearHistoryMutation = useMutation({
    mutationFn: () => apiService.clearHistory(),
    onSuccess: ({ deletedCount }) => {
      setShowClearHistoryConfirm(false);
      setToast({
        message: deletedCount > 0
          ? `Історію очищено (${deletedCount})`
          : 'Історія вже порожня',
        type: 'success',
      });
      triggerHapticFeedback('notification');
      // The list and its counter are rendered from these queries.
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
    onError: (error: any) => {
      setShowClearHistoryConfirm(false);
      handleApiError(error);
    },
  });

  // Admin step-up. The password is never stored anywhere: it goes straight from
  // the dialog into this call, and only the returned token is kept (in memory,
  // inside apiService).
  const adminLoginMutation = useMutation({
    mutationFn: (password: string) => apiService.openAdminSession(password),
    onSuccess: () => {
      setShowAdminPrompt(false);
      setAdminPromptError(null);
      triggerHapticFeedback('notification');
      navigate('/admin');
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      if (status === 401) {
        // Deliberately vague: the server answers the same 401 for a wrong
        // password and for a lockout, and guessing which one it was is exactly
        // the information an attacker wants.
        setAdminPromptError('Невірний пароль або тимчасове блокування. Спробуйте пізніше.');
        return;
      }
      if (status === 429) {
        setAdminPromptError('Забагато спроб. Зачекайте кілька хвилин.');
        return;
      }
      if (status === 404) {
        // The panel is invisible to non-admins, so this is what a revoked
        // allowlist entry looks like from the client side.
        setShowAdminPrompt(false);
        setAdminPromptError(null);
        setToast({ message: 'Адмінпанель недоступна', type: 'error' });
        queryClient.invalidateQueries({ queryKey: ['profile'] });
        return;
      }
      setAdminPromptError('Не вдалося увійти. Спробуйте ще раз.');
    },
  });

  // Handle online/offline
  useEffect(() => {
    const handleOnline = () => setErrorBanner(null);
    const handleOffline = () => setErrorBanner({ message: 'Немає з\'єднання', code: 'OFFLINE' });
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync local settings to state when they change externally (e.g., from another tab)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === LOCAL_SETTINGS_STORAGE_KEY) {
        setLocalSettingsState(getLocalSettings());
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleApiError = (error: any) => {
    const status = error?.response?.status;
    const message = error?.response?.data?.message || error?.message;

    switch (status) {
      case 400:
        setErrorBanner({ message: `Невалідний запит: ${message}`, code: 'BAD_REQUEST' });
        break;
      case 401:
        // Handled by axios interceptor
        break;
      case 403:
        setErrorBanner({ message: 'Доступ заборонено', code: 'FORBIDDEN' });
        break;
      case 422:
        setErrorBanner({ message: 'Не вдалося обробити запит', code: 'UNPROCESSABLE' });
        break;
      case 429:
        setErrorBanner({ message: `Забагато запитів. Зачекайте перед повторною спробою.`, code: 'RATE_LIMITED' });
        break;
      case 503:
        setErrorBanner({ message: 'Сервіс тимчасово недоступний', code: 'SERVICE_UNAVAILABLE' });
        break;
      default:
        if (!navigator.onLine) {
          setErrorBanner({ message: 'Немає з\'єднання', code: 'OFFLINE' });
        } else {
          setErrorBanner({ message: 'Сталася помилка. Спробуйте ще раз.', code: 'UNKNOWN' });
        }
    }
  };

  const clearToast = useCallback(() => setToast(null), []);
  const clearErrorBanner = useCallback(() => setErrorBanner(null), []);

  // Local settings handlers
  const handleThemeChange = useCallback((theme: 'system' | 'light' | 'dark') => {
    const newSettings = setLocalSettings({ theme });
    setLocalSettingsState(newSettings);
    applyTheme(theme);
    triggerHapticFeedback('selection');
  }, []);

  const handleSoundToggle = useCallback(() => {
    const newSettings = setLocalSettings({ soundEnabled: !localSettings.soundEnabled });
    setLocalSettingsState(newSettings);
    triggerHapticFeedback('selection');
  }, [localSettings.soundEnabled]);

  const handleHapticToggle = useCallback(() => {
    const newSettings = setLocalSettings({ hapticEnabled: !localSettings.hapticEnabled });
    setLocalSettingsState(newSettings);
    if (newSettings.hapticEnabled) {
      triggerHapticFeedback('selection');
    }
  }, [localSettings.hapticEnabled]);

  // Server settings handlers
  const handleNotificationsToggle = useCallback(() => {
    if (!profile) return;
    updateProfileMutation.mutate({ notificationsEnabled: !profile.notificationsEnabled });
  }, [profile, updateProfileMutation]);

  const handleDefaultStyleChange = useCallback((value: string) => {
    updateProfileMutation.mutate({
      defaultSlangStyle: value === AUTO_STYLE_VALUE ? null : (value as SlangStyle),
    });
  }, [updateProfileMutation]);

  const handleClearHistory = useCallback(() => {
    setShowClearHistoryConfirm(true);
  }, []);

  const confirmClearHistory = useCallback(() => {
    clearHistoryMutation.mutate();
  }, [clearHistoryMutation]);

  const handleFeedback = useCallback(() => {
    openExternalLink(FEEDBACK_URL);
  }, []);

  const handleAbout = useCallback(() => {
    setToast({ message: `SlangUA v${__APP_VERSION__}\nПереклад української сленговою мовою`, type: 'info' });
  }, []);

  const handleAdminOpen = useCallback(() => {
    // A session already held in memory means the password was entered earlier in
    // this app run; asking again would be theatre.
    if (apiService.hasAdminSession()) {
      navigate('/admin');
      return;
    }
    setAdminPromptError(null);
    setShowAdminPrompt(true);
  }, [navigate]);

  const handleAdminCancel = useCallback(() => {
    setShowAdminPrompt(false);
    setAdminPromptError(null);
  }, []);

  // Age-restricted styles stay out of the "default style" list until the age is
  // confirmed (on the translate screen). A cosmetic lock only - the server
  // rejects a restricted style on its own.
  const selectableStyles = (styles ?? []).filter(
    (style: Style) => profile?.ageConfirmedAdult || !style.ageRestricted,
  );

  const styleOptions: SelectFieldOption<string>[] = [
    { value: AUTO_STYLE_VALUE, label: 'Автоматично' },
    ...selectableStyles.map((style: Style) => ({ value: style.id as string, label: getStyleLabel(style.id) })),
  ];

  if (isLoading) {
    return (
      <div className="settings-page loading" role="status" aria-label="Завантаження налаштувань">
        <div className="loading-spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1 className="page-title">Налаштування</h1>
      </header>

      {errorBanner && (
        <ErrorBanner
          message={errorBanner.message}
          code={errorBanner.code}
          onRetry={() => refetch()}
          onDismiss={clearErrorBanner}
        />
      )}

      <main className="settings-main">
        <section className="settings-section">
          <h2 className="settings-section-title">Вигляд і взаємодія</h2>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Тема</span>
            </div>
            <div className="settings-item-control">
              <SelectField
                value={localSettings.theme}
                options={THEME_OPTIONS}
                onChange={handleThemeChange}
                label="Тема"
              />
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Звук</span>
            </div>
            <div className="settings-item-control">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={localSettings.soundEnabled}
                  onChange={handleSoundToggle}
                  aria-label="Увімкнути звук"
                />
                <span className="settings-toggle-slider" aria-hidden="true" />
              </label>
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Вібрація</span>
            </div>
            <div className="settings-item-control">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={localSettings.hapticEnabled}
                  onChange={handleHapticToggle}
                  aria-label="Увімкнути хаптичну відповідь"
                />
                <span className="settings-toggle-slider" aria-hidden="true" />
              </label>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Переклад</h2>

          {/* Stacked: the label is its own line and the picker takes the full
              width below it — the longest style names did not fit into the 48%
              control column. */}
          <div className="settings-item settings-item-stacked">
            <div className="settings-item-info">
              <span className="settings-item-label">Стиль за замовчуванням</span>
            </div>
            <div className="settings-item-control">
              <SelectField
                value={profile?.defaultSlangStyle ?? AUTO_STYLE_VALUE}
                options={styleOptions}
                onChange={handleDefaultStyleChange}
                label="Стиль за замовчуванням"
                disabled={selectableStyles.length === 0}
              />
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Сповіщення</span>
            </div>
            <div className="settings-item-control">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={profile?.notificationsEnabled || false}
                  onChange={handleNotificationsToggle}
                  aria-label="Увімкнути сповіщення"
                />
                <span className="settings-toggle-slider" aria-hidden="true" />
              </label>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Зворотний зв'язок</h2>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Канал обговорення</span>
            </div>
            <div className="settings-item-control">
              <button
                className="settings-btn settings-btn-secondary"
                onClick={handleFeedback}
                aria-label="Відкрити канал обговорення в Telegram"
              >
                Відкрити
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Додаток</h2>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Про додаток</span>
            </div>
            <div className="settings-item-control">
              <button
                className="settings-btn settings-btn-secondary"
                onClick={handleAbout}
                aria-label="Інформація про додаток"
              >
                Детальніше
              </button>
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Очистити історію</span>
            </div>
            <div className="settings-item-control">
              <button
                className="settings-btn settings-btn-danger"
                onClick={handleClearHistory}
                disabled={clearHistoryMutation.isPending}
                aria-label="Очистити всю збережену історію"
              >
                Очистити
              </button>
            </div>
          </div>
        </section>

        {/* Rendered only for the deployment's own operator. The flag comes from
            the server (`/user/me`), and the panel itself answers 404 to anyone
            else - so this is convenience, not the access control. */}
        {profile?.isAdmin && (
          <section className="settings-section">
            <h2 className="settings-section-title">Адміністрування</h2>

            <div className="settings-item">
              <div className="settings-item-info">
                <span className="settings-item-label">Адмінка</span>
                <span className="settings-item-description">Потрібен пароль</span>
              </div>
              <div className="settings-item-control">
                <button
                  className="settings-btn settings-btn-secondary"
                  onClick={handleAdminOpen}
                  aria-label="Відкрити адмінпанель"
                >
                  Відкрити
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      {showAdminPrompt && (
        <PasswordPrompt
          title="Вхід в адмінку"
          text="Введіть пароль адміністратора. Сесія закриється сама після періоду неактивності."
          busy={adminLoginMutation.isPending}
          error={adminPromptError}
          onSubmit={(password) => adminLoginMutation.mutate(password)}
          onCancel={handleAdminCancel}
        />
      )}
      {showClearHistoryConfirm && (
        <ConfirmDialog
          title="Очистити всю історію?"
          text="Усі збережені переклади, включно з улюбленими, будуть видалені без можливості відновлення."
          confirmLabel="Очистити"
          danger
          busy={clearHistoryMutation.isPending}
          onConfirm={confirmClearHistory}
          onCancel={() => setShowClearHistoryConfirm(false)}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={clearToast} />
      )}
    </div>
  );
}

export default SettingsPage;
