import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useNavigate } from 'react-router-dom';
import './LoadingScreen.css';

function LoadingScreen() {
  const navigate = useNavigate();

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiService.getProfile(),
    enabled: apiService.isAuthenticated(),
    retry: false,
  });

  useEffect(() => {
    if (!isLoading && !isError) {
      if (profile) {
        navigate('/', { replace: true });
      } else {
        // Not authenticated, but we're in Telegram - should not happen normally
        navigate('/', { replace: true });
      }
    }
  }, [isLoading, isError, profile, navigate]);

  return (
    <div className="loading-screen" role="status" aria-label="Завантаження">
      <div className="loading-spinner" aria-hidden="true" />
      <p className="loading-text">Завантаження SlangUA…</p>
    </div>
  );
}

export default LoadingScreen;