import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { initTelegramApp, applyTelegramTheme, setupTelegramThemeListener, setupSafeAreaInsets, isTMA } from './services/telegram';
import { initThemeFromStorage } from './utils/localSettings';
import TranslatePage from './pages/TranslatePage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import LoadingScreen from './components/LoadingScreen';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

type InitState = 'loading' | 'not-in-telegram' | 'auth-failed' | 'ready';

function App() {
  const [initState, setInitState] = useState<InitState>('loading');
  const mountedRef = useRef(true);

  const initialize = useCallback(async () => {
    if (!mountedRef.current) return;
    
    // Initialize theme from localStorage (before Telegram theme)
    initThemeFromStorage();

    if (!isTMA()) {
      if (mountedRef.current) setInitState('not-in-telegram');
      return;
    }

    try {
      const params = await initTelegramApp();
      if (!mountedRef.current) return;
      
      if (!params) {
        // SDK-level failure (initData missing, etc.)
        setInitState('not-in-telegram');
        return;
      }

      applyTelegramTheme(params.themeParams);
      setupTelegramThemeListener();
      setupSafeAreaInsets();
      
      if (mountedRef.current) setInitState('ready');
    } catch {
      if (!mountedRef.current) return;
      // authenticateWithTelegram threw
      setInitState('auth-failed');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    initialize();
    return () => { mountedRef.current = false; };
  }, [initialize]);

  const handleRetry = () => {
    setInitState('loading');
    initialize();
  };

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {initState === 'loading' && <LoadingScreen />}
        {initState === 'not-in-telegram' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '20px', textAlign: 'center' }}>
            <h1>Open in Telegram</h1>
            <p>This app works only inside Telegram Mini App.</p>
            <p>Please open it via the Telegram link.</p>
          </div>
        )}
        {initState === 'auth-failed' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '20px', textAlign: 'center' }}>
            <h1>Authentication Failed</h1>
            <p>Failed to authenticate with the server. Please try again.</p>
            <button onClick={handleRetry} style={{ marginTop: '16px', padding: '12px 24px', fontSize: '16px' }}>
              Retry
            </button>
          </div>
        )}
        {initState === 'ready' && (
          <Routes>
            <Route path="/" element={<TranslatePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default App;
