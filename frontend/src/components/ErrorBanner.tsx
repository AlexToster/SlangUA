import { AlertCircle, WifiOff, RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';
import './ErrorBanner.css';

interface ErrorBannerProps {
  message: string;
  code?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, code, onRetry, onDismiss }: ErrorBannerProps) {
  const getIcon = () => {
    switch (code) {
      case 'OFFLINE':
        return <WifiOff size={20} />;
      case 'RATE_LIMITED':
        return <AlertCircle size={20} />;
      default:
        return <AlertCircle size={20} />;
    }
  };

  const getActionLabel = () => {
    switch (code) {
      case 'RATE_LIMITED':
        return 'Зачекати';
      case 'OFFLINE':
        return 'Спробувати знову';
      default:
        return onRetry ? 'Повторити' : undefined;
    }
  };

  return (
    <div className={clsx('error-banner', code && `error-banner-${code.toLowerCase()}`)} role="alert" aria-live="assertive">
      <div className="error-banner-icon">{getIcon()}</div>
      <p className="error-banner-message">{message}</p>
      {onRetry && (
        <button className="error-banner-retry" onClick={onRetry}>
          <RefreshCw size={16} />
          <span>{getActionLabel()}</span>
        </button>
      )}
      {onDismiss && (
        <button className="error-banner-dismiss" onClick={onDismiss} aria-label="Закрити">
          <X size={16} />
        </button>
      )}
    </div>
  );
}