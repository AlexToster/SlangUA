import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { triggerHapticFeedback } from '../services/telegram';
import { getLocalSettings, setLocalSettings, applyTheme } from '../utils/localSettings';
import { Toast } from '../components/Toast';
import { ErrorBanner } from '../components/ErrorBanner';
import type { UserProfile, SlangStyle, Style } from '../types/api';
import { getStyleLabel } from '../utils/styleLabels';
import './SettingsPage.css';

export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [errorBanner, setErrorBanner] = useState<{ message: string; code?: string } | null>(null);
  const [localSettings, setLocalSettingsState] = useState(() => getLocalSettings());
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showAgeConfirm, setShowAgeConfirm] = useState(false);

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

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: () => apiService.logout(),
    onSuccess: () => {
      queryClient.clear();
      navigate('/');
    },
    onError: (error: any) => {
      handleApiError(error);
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
      if (e.key === 'slangua_settings') {
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

  const handleDefaultStyleChange = useCallback((style: SlangStyle | null) => {
    updateProfileMutation.mutate({ defaultSlangStyle: style });
  }, [updateProfileMutation]);

  const handleAgeConfirm = useCallback(() => {
    setShowAgeConfirm(false);
    updateProfileMutation.mutate({ ageConfirmedAdult: true });
  }, [updateProfileMutation]);

  const handleLogout = useCallback(() => {
    setShowLogoutConfirm(true);
  }, []);

  const confirmLogout = useCallback(() => {
    setShowLogoutConfirm(false);
    logoutMutation.mutate();
  }, [logoutMutation]);

  const handleFeedback = useCallback(() => {
    // Open feedback form - could be mailto: or external link
    window.open('https://github.com/slangua/feedback', '_blank');
  }, []);

  const handleAbout = useCallback(() => {
    setToast({ message: 'SlangUA v1.0.0\nПереклад української сленговою мовою', type: 'info' });
  }, []);

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
        <h1>Налаштування</h1>
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
        {/* Appearance Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">Вигляд</h2>
          
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Тема</span>
              <span className="settings-item-hint">Системна / Світла / Темна</span>
            </div>
            <div className="settings-item-control">
              <select
                className="settings-select"
                value={localSettings.theme}
                onChange={(e) => handleThemeChange(e.target.value as 'system' | 'light' | 'dark')}
                aria-label="Обрати тему"
              >
                <option value="system">Системна</option>
                <option value="light">Світла</option>
                <option value="dark">Темна</option>
              </select>
            </div>
          </div>
        </section>

        {/* Interaction Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">Взаємодія</h2>
          
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Звук</span>
              <span className="settings-item-hint">Звукові ефекти при діях</span>
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
              <span className="settings-item-label">Хаптична відповідь</span>
              <span className="settings-item-hint">Вібрація при натисканні (якщо підтримується)</span>
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

        {/* Translation & Age Gate Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">Переклад та вік</h2>
          
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Стиль за замовчуванням</span>
              <span className="settings-item-hint">Використовується при відкритті додатку</span>
            </div>
            <div className="settings-item-control">
              <select
                className="settings-select"
                value={profile?.defaultSlangStyle || ''}
                onChange={(e) => handleDefaultStyleChange(e.target.value ? e.target.value as SlangStyle : null)}
                aria-label="Обрати стиль за замовчуванням"
                disabled={!styles || styles.length === 0}
              >
                <option value="">Автоматично</option>
                {styles?.map((style: Style) => (
                  <option key={style.id} value={style.id}>
                    {getStyleLabel(style.id)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Сповіщення</span>
              <span className="settings-item-hint">Отримувати пуш-сповіщення про нові функції</span>
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

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Підтвердження 18+</span>
              <span className="settings-item-hint">
                {profile?.ageConfirmedAdult ? 'Вік підтверджено' : 'Необхідно для доступу до обмежених стилів'}
              </span>
            </div>
            <div className="settings-item-control">
              {profile?.ageConfirmedAdult ? (
                <span className="settings-badge success">Підтверджено</span>
              ) : (
                <button
                  className="settings-btn settings-btn-primary"
                  onClick={() => setShowAgeConfirm(true)}
                  aria-label="Підтвердити вік"
                >
                  Підтвердити, що мені є 18+
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Support & About Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">Підтримка та про додаток</h2>
          
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Зворотний зв'язок</span>
              <span className="settings-item-hint">Повідомити про помилку чи запропонувати ідею</span>
            </div>
            <div className="settings-item-control">
              <button
                className="settings-btn settings-btn-secondary"
                onClick={handleFeedback}
                aria-label="Відкрити форму зворотного зв'язку"
              >
                Написати нам
              </button>
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Про додаток</span>
              <span className="settings-item-hint">Версія та інформація про розробників</span>
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
        </section>

        {/* Danger Zone */}
        <section className="settings-section settings-section-danger">
          <h2 className="settings-section-title">Небезпечна зона</h2>
          
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Вийти з акаунту</span>
              <span className="settings-item-hint">Видасть з Telegram Mini App, токени будуть видалені</span>
            </div>
            <div className="settings-item-control">
              <button
                className="settings-btn settings-btn-danger"
                onClick={handleLogout}
                aria-label="Вийти з акаунту"
              >
                Вийти
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Age Confirmation Modal */}
      {showAgeConfirm && (
        <div className="settings-modal-overlay" onClick={() => setShowAgeConfirm(false)} role="dialog" aria-modal="true" aria-labelledby="age-confirm-title">
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="age-confirm-title">Підтвердження віку</h3>
            <p>Деякі стилі перекладу (наприклад, «Зеківський жаргон») можуть містити лексику 18+.</p>
            <p>Підтверджуючи, ви стверджуєте, що вам виповнилося 18 років.</p>
            <div className="settings-modal-actions">
              <button className="settings-btn settings-btn-secondary" onClick={() => setShowAgeConfirm(false)}>
                Скасувати
              </button>
              <button className="settings-btn settings-btn-primary" onClick={handleAgeConfirm}>
                Так, мені є 18+
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="settings-modal-overlay" onClick={() => setShowLogoutConfirm(false)} role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title">
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="logout-confirm-title">Вийти з акаунту?</h3>
            <p>Ви будете вийшли з додатку. Історія перекладів залишиться на сервері.</p>
            <div className="settings-modal-actions">
              <button className="settings-btn settings-btn-secondary" onClick={() => setShowLogoutConfirm(false)}>
                Скасувати
              </button>
              <button className="settings-btn settings-btn-danger" onClick={confirmLogout}>
                Вийти
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={clearToast} />
      )}
    </div>
  );
}

export default SettingsPage;
