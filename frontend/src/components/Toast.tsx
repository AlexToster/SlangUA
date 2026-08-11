import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import clsx from 'clsx';
import './Toast.css';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
  onClose: () => void;
}

export function Toast({ message, type, action, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onClose(), 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const icons = {
    success: <CheckCircle size={20} />,
    error: <AlertCircle size={20} />,
    info: <Info size={20} />,
  };

  return (
    <div className={clsx('toast', `toast-${type}`)} role="alert" aria-live="polite">
      <div className="toast-icon">{icons[type]}</div>
      <p className="toast-message">{message}</p>
      {action && (
        <button className="toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      <button className="toast-close" onClick={onClose} aria-label="Закрити">
        <X size={16} />
      </button>
    </div>
  );
}