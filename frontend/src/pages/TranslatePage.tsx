import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import clsx from 'clsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import {
  canUseTelegramSharing,
  openTelegramInlineQuery,
  shareTranslationText,
  readTextFromClipboard,
  triggerHapticFeedback,
} from '../services/telegram';
import { countGraphemes } from '../utils/text';
import { consumePreviewAttempt, MAX_AUTOMATIC_PREVIEW_ATTEMPTS } from '../utils/previewAttempts';
import { StyleDropdown } from '../components/StyleDropdown';
import { TextInput } from '../components/TextInput';
import { PreviewResult } from '../components/PreviewResult';
import { Toast } from '../components/Toast';
import type { PreviewResult as PreviewResultType, ShareSource, SlangStyle } from '../types/api';
import { localizeStyles } from '../utils/styleLabels';
import { getRandomSamplePhrase, type SamplePhrase } from '../data/samplePhrases';
import './TranslatePage.css';

const DEBOUNCE_MS = 900;
const MIN_CHARS_FOR_PREVIEW = 3;
const MAX_GRAPHEMES = 1000;

export function TranslatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedStyle, setSelectedStyle] = useState<SlangStyle | null>(null);
  const [draftText, setDraftText] = useState('');
  const [showAgeGateToast, setShowAgeGateToast] = useState(false);
  const [showPofeniAgeConfirm, setShowPofeniAgeConfirm] = useState(false);
  const [pendingRandomPhrase, setPendingRandomPhrase] = useState<SamplePhrase | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [errorBanner, setErrorBanner] = useState<{ message: string; code?: string } | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);
  const [currentPreview, setCurrentPreview] = useState<PreviewResultType | null>(null);
  const [savedTranslationId, setSavedTranslationId] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastPreviewKeyRef = useRef<string | null>(null);
  const previewVersionRef = useRef(0);
  const previousStyleRef = useRef<SlangStyle | null>(null);
  const previousInputKeyRef = useRef<string | null>(null);
  const previewAttemptRef = useRef({ key: '', retryNonce: 0, count: 0 });
  const pendingRestrictedStyleRef = useRef<SlangStyle | null>(null);
  const lastRandomPhraseIdRef = useRef<string | null>(null);
  const isDemoDraftRef = useRef(false);

  // Fetch styles and profile
  const {
    data: styles = [],
    isLoading: stylesLoading,
  } = useQuery({
    queryKey: ['styles'],
    queryFn: () => apiService.getStyles(),
    enabled: apiService.isAuthenticated(),
  });

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiService.getProfile(),
    enabled: apiService.isAuthenticated(),
  });

  // Initialize selected style from profile or first available style.
  // profileLoading у гварді — обов'язковий: /styles і /user/me летять паралельно,
  // і коли список стилів приходив першим, ми фіксували styles[0], а
  // defaultSlangStyle з профілю вже ніколи не застосовувався (гвард !selectedStyle
  // не давав перезаписати). Саме через це стиль за замовчуванням «не зберігався»
  // між запусками застосунку. Для вимкненого запиту (без авторизації)
  // isLoading === false, тож екран не блокується.
  useEffect(() => {
    if (selectedStyle || styles.length === 0 || profileLoading) return;
    const defaultStyle = profile?.defaultSlangStyle;
    if (defaultStyle && styles.some(s => s.id === defaultStyle)) {
      setSelectedStyle(defaultStyle);
    } else {
      setSelectedStyle(styles[0].id);
    }
  }, [styles, profile, selectedStyle, profileLoading]);

  // Save default style when changed
  const updateDefaultStyleMutation = useMutation({
    mutationFn: (style: SlangStyle) => apiService.updateProfile({ defaultSlangStyle: style }),
    // Кеш ['profile'] — те, з чого «Стиль за замовчуванням» малюється в
    // Налаштуваннях і з чого цей екран стартує наступного разу. Без цього рядка
    // там лишався попередній стиль, поки запит не став stale.
    onSuccess: (updatedProfile) => {
      queryClient.setQueryData(['profile'], updatedProfile);
    },
    onError: () => {
      setToast({ message: 'Не вдалося запам\'ятати вибір стилю', type: 'error' });
    },
  });

  const handleApiError = useCallback((error: any) => {
    const status = error?.response?.status;
    const code = error?.response?.data?.code;
    const message = error?.response?.data?.message || error?.message;

    switch (status) {
      case 400:
        setErrorBanner({ message: `Невалідний запит: ${message}`, code: 'BAD_REQUEST' });
        break;
      case 401:
        break;
      case 403:
        if (code === 'AGE_RESTRICTED_STYLE') setShowAgeGateToast(true);
        else setErrorBanner({ message: 'Доступ заборонено', code: 'FORBIDDEN' });
        break;
      case 422:
        setErrorBanner({ message: 'Не вдалося обробити цей текст', code: 'UNPROCESSABLE' });
        break;
      case 429:
        setErrorBanner({ message: 'Забагато запитів. Зачекайте перед повторною спробою.', code: 'RATE_LIMITED' });
        break;
      case 503:
        setErrorBanner({ message: 'Сервіс перекладу тимчасово недоступний', code: 'SERVICE_UNAVAILABLE' });
        break;
      default:
        setErrorBanner(!navigator.onLine
          ? { message: 'Немає з\'єднання. Автопереклад відновиться після повернення мережі.', code: 'OFFLINE' }
          : { message: 'Сталася помилка. Спробуйте ще раз.', code: 'UNKNOWN' });
    }
  }, []);

  const confirmAgeMutation = useMutation({
    mutationFn: () => apiService.updateProfile({ ageConfirmedAdult: true }),
    onSuccess: (updatedProfile) => {
      queryClient.setQueryData(['profile'], updatedProfile);
      queryClient.invalidateQueries({ queryKey: ['styles'] });
      setShowPofeniAgeConfirm(false);

      const pendingStyle = pendingRestrictedStyleRef.current;
      pendingRestrictedStyleRef.current = null;
      if (pendingStyle) {
        setSelectedStyle(pendingStyle);
        setSavedTranslationId(null);
        setErrorBanner(null);
        updateDefaultStyleMutation.mutate(pendingStyle);
        triggerHapticFeedback('selection');
      }
    },
    onError: handleApiError,
  });

  // Preview translation mutation
  const previewMutation = useMutation({
    mutationFn: ({ text, style, signal }: { text: string; style: SlangStyle; signal: AbortSignal; version: number }) =>
      apiService.translatePreview(text, style, signal),
    onSuccess: (data, variables) => {
      if (variables.version !== previewVersionRef.current || variables.signal.aborted) return;

      const currentKey = `${variables.text}|${variables.style}`;
      if (currentKey === lastPreviewKeyRef.current) {
        setCurrentPreview(data);
        setSavedTranslationId(null);
        queryClient.setQueryData(['preview', currentKey], data);
      }
    },
    onError: (error: any, variables) => {
      const isCanceled = axios.isCancel(error)
        || error?.code === 'ERR_CANCELED'
        || error?.name === 'CanceledError'
        || error?.name === 'AbortError';

      if (variables.version !== previewVersionRef.current || variables.signal.aborted || isCanceled) return;

      // A rate-limited request must not spend two more automatic attempts.
      if (error?.response?.status === 429) {
        previewAttemptRef.current = { ...previewAttemptRef.current, count: MAX_AUTOMATIC_PREVIEW_ATTEMPTS };
      }
      handleApiError(error);
    },
  });

  // Save translation mutation
  const saveMutation = useMutation({
    mutationFn: (previewId: string) => apiService.saveFromPreview(previewId),
    onSuccess: (translation) => {
      setSavedTranslationId(translation.id);
      setToast({ message: 'Збережено в історію', type: 'success' });
      triggerHapticFeedback('notification');
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
    onError: (error: any) => {
      handleApiError(error);
    },
  });

  const shareMutation = useMutation({
    mutationFn: (source: ShareSource) => apiService.createInlineShare(source),
    onSuccess: ({ inlineQuery, shareText }) => {
      try {
        // Prefer the server-rendered text: switchInlineQuery only types
        // `@bot s_<uuid>` into the composer and leaves it unsendable when the
        // bot cannot answer the inline query.
        if (shareText) {
          shareTranslationText(shareText);
        } else {
          openTelegramInlineQuery(inlineQuery);
        }
        triggerHapticFeedback('notification');
      } catch {
        setToast({ message: 'Telegram не підтримує надсилання у цьому клієнті. Скопіюй результат.', type: 'error' });
      }
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      const code = error?.response?.data?.code;
      if (code === 'AGE_RESTRICTED_SHARE') {
        setToast({ message: 'Результати 18+ не можна надіслати в Telegram. Скопіюй текст.', type: 'info' });
      } else if (code === 'SHARE_TEXT_TOO_LONG') {
        setToast({ message: 'Цей результат задовгий для Telegram. Скопіюй текст.', type: 'error' });
      } else if (code === 'SHARE_SOURCE_NOT_FOUND' || status === 410) {
        setToast({ message: 'Результат більше недоступний для надсилання. Скопіюй або створи новий preview.', type: 'error' });
      } else if (status === 429) {
        setToast({ message: 'Забагато спроб надсилання. Зачекай і повтори.', type: 'error' });
      } else if (code === 'TELEGRAM_INLINE_UNAVAILABLE' || status === 503) {
        setToast({ message: 'Надсилання в Telegram тимчасово недоступне. Скопіюй результат.', type: 'error' });
      } else {
        setToast({ message: 'Не вдалося підготувати надсилання. Скопіюй результат.', type: 'error' });
      }
    },
  });

  // Handle online/offline
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Cancel a previous preview immediately when its input or style changes.
  useEffect(() => {
    const inputKey = `${draftText}|${selectedStyle ?? ''}`;
    if (previousInputKeyRef.current !== null && previousInputKeyRef.current !== inputKey) {
      previewVersionRef.current += 1;
      abortControllerRef.current?.abort();
    }
    previousInputKeyRef.current = inputKey;
  }, [draftText, selectedStyle]);

  // Debounced preview. A style change is the one exception: it refreshes immediately.
  useEffect(() => {
    const previewVersion = previewVersionRef.current;
    const normalizedDraft = draftText.trim();
    const graphemeCount = countGraphemes(normalizedDraft);
    if (!selectedStyle || graphemeCount < MIN_CHARS_FOR_PREVIEW) {
      abortControllerRef.current?.abort();
      setCurrentPreview(null);
      return;
    }

    if (graphemeCount > MAX_GRAPHEMES) {
      abortControllerRef.current?.abort();
      return;
    }

    const styleChanged = previousStyleRef.current !== null && previousStyleRef.current !== selectedStyle;
    previousStyleRef.current = selectedStyle;

    const runPreview = () => {
      if (!isOnline) {
        setErrorBanner({ message: 'Немає з\'єднання. Автопереклад відновиться після повернення мережі.', code: 'OFFLINE' });
        return;
      }

      const previewKey = `${draftText}|${selectedStyle}`;
      lastPreviewKeyRef.current = previewKey;

      const cached = queryClient.getQueryData<PreviewResultType>(['preview', previewKey]);
      if (cached) {
        setCurrentPreview(cached);
        return;
      }

      const nextAttempt = consumePreviewAttempt(previewAttemptRef.current, previewKey, retryNonce);
      if (!nextAttempt) return;
      previewAttemptRef.current = nextAttempt;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      previewMutation.mutate({ text: draftText, style: selectedStyle, signal: controller.signal, version: previewVersion });
    };

    if (styleChanged) {
      runPreview();
      return;
    }

    const timer = window.setTimeout(runPreview, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [draftText, selectedStyle, isOnline, retryNonce, queryClient, previewMutation]);

  // Handle style change
  const handleStyleChange = useCallback((style: SlangStyle) => {
    setSelectedStyle(style);
    setSavedTranslationId(null);
    setErrorBanner(null);
    updateDefaultStyleMutation.mutate(style);
    triggerHapticFeedback('selection');
  }, [updateDefaultStyleMutation]);

  const handleLockedStyleSelect = useCallback((style: SlangStyle) => {
    pendingRestrictedStyleRef.current = style;
    setShowPofeniAgeConfirm(true);
  }, []);

  const cancelAgeConfirm = useCallback(() => {
    pendingRestrictedStyleRef.current = null;
    setShowPofeniAgeConfirm(false);
  }, []);

  // Handle text change
  const handleTextChange = useCallback((text: string) => {
    isDemoDraftRef.current = false;
    setDraftText(text);
    setSavedTranslationId(null);
    setErrorBanner(null);
  }, []);

  // Handle paste
  const handlePaste = useCallback(async () => {
    try {
      const text = await readTextFromClipboard();
      const graphemeCount = countGraphemes(text);
      if (graphemeCount > MAX_GRAPHEMES) {
        setToast({ message: `Текст занадто довгий (макс. ${MAX_GRAPHEMES} символів)`, type: 'error' });
        return;
      }
      isDemoDraftRef.current = false;
      setDraftText(text);
      triggerHapticFeedback('impact');
    } catch {
      document.getElementById('translate-input')?.focus();
      setToast({
        message: 'Telegram не надав доступ до буфера. Поле активне: затисніть його та оберіть «Вставити».',
        type: 'info',
      });
    }
  }, []);

  const insertRandomPhrase = useCallback((phrase: SamplePhrase) => {
    lastRandomPhraseIdRef.current = phrase.id;
    isDemoDraftRef.current = true;
    setDraftText(phrase.text);
    setSavedTranslationId(null);
    setErrorBanner(null);
    triggerHapticFeedback('selection');
  }, []);

  const handleRandomPhrase = useCallback(() => {
    const phrase = getRandomSamplePhrase(lastRandomPhraseIdRef.current);
    if (draftText && !isDemoDraftRef.current) {
      setPendingRandomPhrase(phrase);
      return;
    }
    insertRandomPhrase(phrase);
  }, [draftText, insertRandomPhrase]);

  const cancelRandomPhrase = useCallback(() => setPendingRandomPhrase(null), []);

  const confirmRandomPhrase = useCallback(() => {
    if (pendingRandomPhrase) insertRandomPhrase(pendingRandomPhrase);
    setPendingRandomPhrase(null);
  }, [insertRandomPhrase, pendingRandomPhrase]);

  // Handle copy result
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ message: 'Скопійовано', type: 'success' });
      triggerHapticFeedback('impact');
    } catch {
      setToast({ message: 'Не вдалося скопіювати', type: 'error' });
    }
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    if (currentPreview?.previewId) {
      saveMutation.mutate(currentPreview.previewId);
    }
  }, [currentPreview, saveMutation]);

  const handleShare = useCallback(() => {
    if (!currentPreview || !canUseTelegramSharing()) return;
    const source: ShareSource = savedTranslationId !== null
      ? { translationId: savedTranslationId }
      : { previewId: currentPreview.previewId };
    shareMutation.mutate(source);
  }, [currentPreview, savedTranslationId, shareMutation]);

  // Handle retry
  const handleRetry = useCallback(() => {
    if (selectedStyle && draftText.length >= MIN_CHARS_FOR_PREVIEW) {
      setErrorBanner(null);
      setRetryNonce(v => v + 1);
    }
  }, [selectedStyle, draftText]);

  // Handle age gate toast action
  const handleOpenSettings = useCallback(() => {
    setShowAgeGateToast(false);
    navigate('/settings');
  }, [navigate]);

  // Clear toast
  const clearToast = useCallback(() => setToast(null), []);

  // Compute grapheme count
  const graphemeCount = countGraphemes(draftText);
  const isOverLimit = graphemeCount > MAX_GRAPHEMES;
  const isWarningZone = graphemeCount >= 850 && !isOverLimit;
  const localizedStyles = localizeStyles(styles);
  const selectorStyles = localizedStyles;

  // 18+ results are shareable, but only by a user who confirmed adulthood.
  // The `ageRestricted` flag comes from the registry, never from a style id;
  // the server re-checks the same rule, so this is only about hiding the button.
  const previewStyleIsAgeRestricted = styles.find(s => s.id === currentPreview?.slangStyle)?.ageRestricted === true;
  const canSharePreview = canUseTelegramSharing()
    && !!currentPreview
    && (!previewStyleIsAgeRestricted || profile?.ageConfirmedAdult === true);

  // The accent ring marks the step the user is on. While typing it belongs to the
  // editor (:focus-within in TextInput.css); once a translation is running or a
  // result is on screen it moves down to the style+result card.
  const isOutputActive = previewMutation.isPending || !!currentPreview;

  if (stylesLoading) {
    return (
      <div className="translate-page loading" role="status" aria-label="Завантаження стилів">
        <div className="loading-spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="translate-page">
      <main className="translate-main">
        <TextInput
          value={draftText}
          onChange={handleTextChange}
          onPaste={handlePaste}
          onRandomPhrase={handleRandomPhrase}
          isRandomPhraseDisabled={!selectedStyle || previewMutation.isPending}
          graphemeCount={graphemeCount}
          maxGraphemes={MAX_GRAPHEMES}
          isWarningZone={isWarningZone}
          isOverLimit={isOverLimit}
          placeholder="Напиши щось українською…"
        />

        {/* The style trigger and the result are one card: the trigger is the
            highlighted header, the contrasting rule below it is the only
            separator. */}
        <section className={clsx('translate-output', isOutputActive && 'active')} aria-label="Стиль і результат перекладу">
          <StyleDropdown
            styles={selectorStyles}
            selectedStyle={selectedStyle}
            onSelect={handleStyleChange}
            lockedStyleIds={profile?.ageConfirmedAdult ? [] : styles.filter(s => s.ageRestricted).map(s => s.id)}
            onLockedSelect={handleLockedStyleSelect}
          />

          <PreviewResult
            preview={currentPreview}
            isLoading={previewMutation.isPending}
            isError={previewMutation.isError}
            errorBanner={errorBanner}
            onRetry={handleRetry}
            canRetry={previewAttemptRef.current.count >= MAX_AUTOMATIC_PREVIEW_ATTEMPTS}
            draftText={draftText}
            onCopy={handleCopy}
            onSave={handleSave}
            canSave={!!currentPreview?.previewId && !saveMutation.isPending}
            isSaving={saveMutation.isPending}
            onShare={handleShare}
            canShare={canSharePreview}
            isSharing={shareMutation.isPending}
          />
        </section>
      </main>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={clearToast} />
      )}

      {showAgeGateToast && (
        <Toast
          message="Цей стиль доступний лише для повнолітніх. Підтвердь вік у налаштуваннях."
          type="info"
          action={{ label: 'Відкрити налаштування', onClick: handleOpenSettings }}
          onClose={() => setShowAgeGateToast(false)}
        />
      )}

      {showPofeniAgeConfirm && (
        <div className="translate-age-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pofeni-age-confirm-title">
          <div className="translate-age-modal">
            <h2 id="pofeni-age-confirm-title">Підтвердження 18+</h2>
            <p>«Зеківський жаргон» може містити лексику для повнолітніх. Підтверджуючи, ви стверджуєте, що вам є 18+.</p>
            <div className="translate-age-modal-actions">
              <button type="button" onClick={cancelAgeConfirm}>Скасувати</button>
              <button type="button" className="confirm" onClick={() => confirmAgeMutation.mutate()} disabled={confirmAgeMutation.isPending}>
                {confirmAgeMutation.isPending ? 'Підтверджуємо…' : 'Так, мені є 18+'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRandomPhrase && (
        <div className="translate-age-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="random-phrase-confirm-title">
          <div className="translate-age-modal">
            <h2 id="random-phrase-confirm-title">Замінити поточний текст?</h2>
            <p>Поточна чернетка буде замінена випадковою фразою.</p>
            <div className="translate-age-modal-actions">
              <button type="button" onClick={cancelRandomPhrase}>Скасувати</button>
              <button type="button" className="confirm" onClick={confirmRandomPhrase}>Замінити</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TranslatePage;
