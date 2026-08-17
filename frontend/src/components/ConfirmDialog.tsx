import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  /** Optional body copy; omit when the title already asks the whole question. */
  text?: string;
  /** Defaults to "Так" - window.confirm() renders "Гаразд"/"OK" and cannot be relabelled. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive style. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Themed replacement for window.confirm().
 *
 * The native dialog is drawn by the OS: it ignores the Telegram theme and its
 * buttons are locked to "Гаразд"/"Скасувати". This one reuses the global
 * .modal* / .btn* rules, so it follows the app theme and the labels are ours.
 */
export function ConfirmDialog({
  title,
  text,
  confirmLabel = 'Так',
  cancelLabel = 'Скасувати',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
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

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <h2 className="modal-title" id="confirm-dialog-title">{title}</h2>
        {text && <p className="modal-text">{text}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
