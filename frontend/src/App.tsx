import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
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

function App() {
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    async function initialize() {
      // Initialize theme from localStorage (before Telegram theme)
      initThemeFromStorage();

      if (isTMA()) {
        const params = await initTelegramApp();
        if (params) {
          applyTelegramTheme(params.themeParams);
          setupTelegramThemeListener();
          setupSafeAreaInsets();
        }
      }

      setIsInitialized(true);
    }

    initialize();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {isInitialized ? (
          <Routes>
            <Route path="/" element={<TranslatePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        ) : (
          <LoadingScreen />
        )}
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default App;
