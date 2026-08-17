import { useState } from 'react';
import { Copy, Check, Save, Send, AlertCircle, Loader2 } from 'lucide-react';
import type { PreviewResult as PreviewResultType } from '../types/api';
import { getStyleLabel } from '../utils/styleLabels';
import { getProviderLabel } from '../utils/providerLabels';
import './PreviewResult.css';

interface PreviewResultProps {
  preview: PreviewResultType | null;
  isLoading: boolean;
  isError: boolean;
  errorBanner: { message: string; code?: string } | null;
  onRetry: () => void;
  canRetry?: boolean;
  draftText: string;
  onCopy: (text: string) => void;
  onSave: () => void;
  canSave: boolean;
  isSaving: boolean;
  onShare: () => void;
  canShare: boolean;
  isSharing: boolean;
}

export function PreviewResult({ 
  preview, 
  isLoading, 
  isError, 
  errorBanner, 
  onRetry, 
  canRetry = true,
  draftText,
  onCopy,
  onSave,
  canSave,
  isSaving,
  onShare,
  canShare,
  isSharing,
}: PreviewResultProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (preview?.translatedText) {
      onCopy(preview.translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Show empty state when no draft text
  if (!draftText.trim()) {
    return (
      <div className="preview-result empty" role="status" aria-live="polite">
        <div className="preview-empty">
          <p>Переклад з'явиться автоматично</p>
          <span className="preview-hint">Почніть вводити текст (мін. 3 символи)</span>
        </div>
      </div>
    );
  }

  // Show loading state for first preview
  if (isLoading && !preview) {
    return (
      <div className="preview-result loading" role="status" aria-live="polite" aria-label="Перекладаємо">
        <div className="preview-skeleton">
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
          <div className="skeleton-line" />
        </div>
        <p className="preview-loading-text">Перекладаємо…</p>
      </div>
    );
  }

  // Show updating state (has previous preview, loading new)
  if (isLoading && preview) {
    return (
      <div className="preview-result updating" role="status" aria-live="polite" aria-label="Оновлюємо переклад">
        <div className="preview-content">
          <div className="preview-text">{preview.translatedText}</div>
          <div className="preview-meta">
            <span className="preview-style">{getStyleLabel(preview.slangStyle)}</span>
            <span className="preview-updating-indicator" aria-hidden="true">
              <Loader2 className="spinning" size={14} />
              Оновлюємо…
            </span>
          </div>
        </div>
        <div className="preview-actions">
          <button
            className="preview-action-btn copy-btn"
            onClick={handleCopy}
            disabled={copied || isSaving}
            aria-label={copied ? 'Скопійовано' : 'Копіювати результат'}
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
            <span>{copied ? 'Скопійовано' : 'Копіювати'}</span>
          </button>
          {canShare && (
            <button
              className="preview-action-btn share-btn"
              onClick={onShare}
              disabled={isSharing || isSaving}
              aria-label={isSharing ? 'Відкриваємо Telegram...' : 'Надіслати в Telegram'}
            >
              {isSharing ? <Loader2 className="spinning" size={18} /> : <Send size={18} />}
              <span>{isSharing ? 'Відкриваємо…' : 'Надіслати'}</span>
            </button>
          )}
          <button
            className="preview-action-btn save-btn"
            onClick={onSave}
            disabled={!canSave || isSaving}
            aria-label={isSaving ? 'Зберігаємо...' : 'Зберегти в історію'}
          >
            {isSaving ? <Loader2 className="spinning" size={18} /> : <Save size={18} />}
            <span>{isSaving ? 'Зберігаємо…' : 'Зберегти'}</span>
          </button>
        </div>
      </div>
    );
  }

  // Show error state
  if (isError || errorBanner) {
    return (
      <div className="preview-result error" role="alert" aria-live="assertive">
        <div className="preview-error">
          <AlertCircle size={24} />
          <p>{errorBanner?.message || 'Сталася помилка при перекладі'}</p>
          {canRetry && (
            <button className="retry-btn" onClick={onRetry}>
              Оновити
            </button>
          )}
        </div>
      </div>
    );
  }

  // Show success state with preview result
  if (preview) {
    return (
      <div className="preview-result success" role="region" aria-label="Результат перекладу">
        <div className="preview-content">
          <div className="preview-text">{preview.translatedText}</div>
          <div className="preview-meta">
            <span className="preview-style">{getStyleLabel(preview.slangStyle)}</span>
            <span className="preview-provider">{getProviderLabel(preview.providerId)}</span>
          </div>
        </div>
        <div className="preview-actions">
          <button
            className="preview-action-btn copy-btn"
            onClick={handleCopy}
            disabled={copied || isSaving}
            aria-label={copied ? 'Скопійовано' : 'Копіювати результат'}
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
            <span>{copied ? 'Скопійовано' : 'Копіювати'}</span>
          </button>
          <button
            className="preview-action-btn save-btn"
            onClick={onSave}
            disabled={!canSave || isSaving}
            aria-label={isSaving ? 'Зберігаємо...' : 'Зберегти в історію'}
          >
            {isSaving ? <Loader2 className="spinning" size={18} /> : <Save size={18} />}
            <span>{isSaving ? 'Зберігаємо…' : 'Зберегти'}</span>
          </button>
          {canShare && (
            <button
              className="preview-action-btn share-btn"
              onClick={onShare}
              disabled={isSharing || isSaving}
              aria-label={isSharing ? 'Відкриваємо Telegram...' : 'Надіслати в Telegram'}
            >
              {isSharing ? <Loader2 className="spinning" size={18} /> : <Send size={18} />}
              <span>{isSharing ? 'Відкриваємо…' : 'Надіслати'}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Fallback - text too short
  return (
    <div className="preview-result empty" role="status" aria-live="polite">
      <div className="preview-empty">
        <p>Переклад з'явиться автоматично</p>
        <span className="preview-hint">Мінімум 3 символи для перекладу</span>
      </div>
    </div>
  );
}
