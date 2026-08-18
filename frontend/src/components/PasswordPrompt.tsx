import { useEffect, useRef, useState } from 'react';
import './PasswordPrompt.css';

interface PasswordPromptProps {
  title: string;
  text?: string;
  submitLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  /** Shown inside the dialog so the modal stays open after a wrong password. */
  error?: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/**
 * Password step-up dialog.
 *
 * Reuses the global .modal* / .btn* rules, like ConfirmDialog. Three details are
 * deliberate: the field is `type="password"` with autoComplete="current-password"
 * so a password manager can fill it, the value never leaves component state (no
 * URL, no query cache, no logging), and errors render inside the dialog instead
 * of dismissing it - being thrown out after a typo would be the wrong trade for
 * a screen behind two factors.
 */
export function PasswordPrompt({
  title,
  text,
  submitLabel = 'Увійти',
  cancelLabel = 'Скасувати',
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const submit = () => {
    if (busy || password.length === 0) return;
    onSubmit(password);
  };

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="password-prompt-title">
        <h2 className="modal-title" id="password-prompt-title">{title}</h2>
        {text && <p className="modal-text">{text}</p>}

        <form
          className="password-prompt-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            type="password"
            className="password-prompt-input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            aria-label="Пароль адміністратора"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'password-prompt-error' : undefined}
            disabled={busy}
            maxLength={512}
          />

          {error && (
            <p className="password-prompt-error" id="password-prompt-error" role="alert">
              {error}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || password.length === 0}>
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PasswordPrompt;
