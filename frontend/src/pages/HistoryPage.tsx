import { useState, useCallback, useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiService } from '../services/api';
import {
  triggerHapticFeedback,
  canUseTelegramSharing,
  shareTranslationText,
  openTelegramInlineQuery,
} from '../services/telegram';
import { Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';
import { Toast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SelectField, type SelectFieldOption } from '../components/SelectField';
import { ErrorBanner } from '../components/ErrorBanner';
import type { Translation } from '../types/api';
import { getStyleLabel } from '../utils/styleLabels';
import './HistoryPage.css';

const PAGE_SIZE = 20;

type FavoriteFilter = 'all' | 'favorite';

const FAVORITE_FILTER_OPTIONS: SelectFieldOption<FavoriteFilter>[] = [
  { value: 'all', label: 'Усі' },
  { value: 'favorite', label: 'Тільки обране' },
];

/**
 * Shown only until the first response arrives - GET /history reports the real
 * cap as `totalLimit` (HISTORY_MAX_ENTRIES on the server).
 */
const HISTORY_LIMIT_FALLBACK = 100;

export function HistoryPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [errorBanner, setErrorBanner] = useState<{ message: string; code?: string } | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Translation | null>(null);

  // Debounce search. 500ms instead of 300ms: every committed value swaps the
  // query key, and a request in flight on every other keystroke made the list
  // flicker while typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Keep cursor pages under one key so later pages cannot replace earlier results.
  const { data: historyData, isLoading, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['history', debouncedSearch, favoriteFilter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiService.getHistory({
      cursor: pageParam,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      // 'all' must not send the param at all, otherwise favorites are filtered out.
      favorite: favoriteFilter === 'all' ? undefined : true,
    }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: apiService.isAuthenticated(),
    // The search term is part of the query key, so each committed term used to
    // start from "no data" -> the page fell back to the full-screen spinner,
    // the search <input> was unmounted and the on-screen keyboard closed
    // mid-word. Keeping the previous page's data mounted fixes that.
    placeholderData: keepPreviousData,
  });

  // Style registry drives the age-restricted sharing rule (same source as TranslatePage).
  const { data: styles = [] } = useQuery({
    queryKey: ['styles'],
    queryFn: () => apiService.getStyles(),
    enabled: apiService.isAuthenticated(),
  });

  // Needed for the same rule: an 18+ result may be shared only by a user who
  // confirmed adulthood. Same query key as TranslatePage, so it is served from
  // cache when the user arrives from the main screen.
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiService.getProfile(),
    enabled: apiService.isAuthenticated(),
  });

  // Favorite mutation: always an explicit set, never a toggle.
  const setFavoriteMutation = useMutation({
    mutationFn: ({ id, favorite }: { id: number; favorite: boolean }) =>
      apiService.setFavorite(id, favorite),
    onSuccess: (_, variables) => {
      setToast({ message: variables.favorite ? 'Додано в обране' : 'Видалено з обраного', type: 'success' });
      triggerHapticFeedback('selection');
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
    onError: (error: any) => {
      handleApiError(error);
    },
  });

  // Delete translation mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteTranslation(id),
    onSuccess: () => {
      setToast({ message: 'Переклад видалено', type: 'success' });
      triggerHapticFeedback('notification');
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
    onError: (error: any) => {
      handleApiError(error);
    },
  });

  const shareMutation = useMutation({
    mutationFn: (translationId: number) => apiService.createInlineShare({ translationId }),
    onSuccess: ({ inlineQuery, shareText }) => {
      try {
        // Prefer the finished text: switchInlineQuery only types `@bot s_<uuid>`
        // into the composer and leaves it unsendable when the bot cannot answer
        // the inline query.
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
        setToast({ message: 'Результати 18+ не можна надіслати в Telegram.', type: 'info' });
      } else if (code === 'SHARE_TEXT_TOO_LONG') {
        setToast({ message: 'Цей результат задовгий для Telegram. Скопіюй текст.', type: 'error' });
      } else if (status === 429) {
        setToast({ message: 'Забагато спроб надсилання. Зачекай і повтори.', type: 'error' });
      } else if (code === 'TELEGRAM_INLINE_UNAVAILABLE' || status === 503) {
        setToast({ message: 'Надсилання в Telegram тимчасово недоступне.', type: 'error' });
      } else {
        setToast({ message: 'Не вдалося підготувати надсилання.', type: 'error' });
      }
    },
  });

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

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

  const handleRetry = useCallback(() => {
    setErrorBanner(null);
    refetch();
  }, [refetch]);

  const handleToggleFavorite = useCallback((translation: Translation) => {
    setFavoriteMutation.mutate({ id: translation.id, favorite: !translation.favorite });
  }, [setFavoriteMutation]);

  const handleDelete = useCallback((translation: Translation) => {
    setPendingDelete(translation);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    deleteMutation.mutate(pendingDelete.id, {
      onSettled: () => setPendingDelete(null),
    });
  }, [deleteMutation, pendingDelete]);

  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  // 18+ results are shareable only for a confirmed adult — the flag comes from
  // the registry, not a style id, and the server re-checks the same rule.
  const canShareTranslation = useCallback((translation: Translation) => {
    if (!canUseTelegramSharing()) return false;
    const ageRestricted = styles.find((style) => style.id === translation.slangStyle)?.ageRestricted === true;
    return !ageRestricted || profile?.ageConfirmedAdult === true;
  }, [styles, profile]);

  const handleShare = useCallback((translation: Translation) => {
    if (canShareTranslation(translation)) {
      shareMutation.mutate(translation.id);
    }
  }, [canShareTranslation, shareMutation]);

  const translations = historyData?.pages.flatMap((page) => page.data) || [];
  const totalCount = historyData?.pages[0]?.totalCount || 0;
  // The cap is server-owned (HISTORY_MAX_ENTRIES); the fallback only covers the
  // very first render, before any response has arrived.
  const totalLimit = historyData?.pages[0]?.totalLimit ?? HISTORY_LIMIT_FALLBACK;

  // No early full-page return while loading: it unmounted the search <input>
  // on every committed search term, which closed the on-screen keyboard
  // mid-word. The spinner is rendered in place instead.
  return (
    <div className="history-page">
      <div className="history-topbar">
        <header className="history-header">
          <h1 className="page-title">Історія</h1>
          <div className="history-stats" aria-label="Збережено перекладів">
            <span>{totalCount}/{totalLimit}</span>
          </div>
        </header>

        <div className="history-filters">
          <input
            type="search"
            className="history-search"
            placeholder="Пошук в історії…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Пошук в історії"
          />
          {/*
            The type argument is explicit: a bare setState is
            Dispatch<SetStateAction<FavoriteFilter>>, whose parameter includes the
            updater function, so inference cannot narrow T past its `string`
            constraint and the prop check fails.
          */}
          <SelectField<FavoriteFilter>
            value={favoriteFilter}
            options={FAVORITE_FILTER_OPTIONS}
            onChange={setFavoriteFilter}
            label="Фільтр"
          />
        </div>
      </div>

      {errorBanner && (
        <ErrorBanner
          message={errorBanner.message}
          code={errorBanner.code}
          onRetry={handleRetry}
          onDismiss={clearErrorBanner}
        />
      )}

      {isLoading && !historyData && (
        <div className="history-loading" role="status" aria-label="Завантаження історії">
          <div className="loading-spinner" aria-hidden="true" />
        </div>
      )}

      {translations.length === 0 && !isLoading && (
        <div className="history-empty" role="status">
          <p>{debouncedSearch || favoriteFilter === 'favorite' ? 'Нічого не знайдено' : 'Історія порожня'}</p>
          {(!debouncedSearch && favoriteFilter === 'all') && (
            <p className="history-empty-hint">Переклади з'являться тут після натискання «Зберегти» на головній сторінці</p>
          )}
        </div>
      )}

      <ul className="history-list" role="list" aria-label="Історія перекладів">
        {translations.map((translation) => (
          <li key={translation.id} className="history-item">
            <article className="history-entry">
              <div className="history-entry-header">
                <span className={`history-style-badge history-style-${translation.slangStyle.toLowerCase()}`}>
                  {getStyleLabel(translation.slangStyle)}
                </span>
                <time className="history-time" dateTime={translation.createdAt}>
                  {formatDistanceToNow(new Date(translation.createdAt), { addSuffix: true, locale: uk })}
                </time>
              </div>
              <div className="history-entry-content">
                <p className="history-original">{translation.originalText}</p>
                <p className="history-translated">{translation.translatedText}</p>
              </div>
              <div className="history-entry-actions">
                {canShareTranslation(translation) && (
                  <button
                    className="history-share-btn"
                    onClick={() => handleShare(translation)}
                    disabled={shareMutation.isPending}
                    aria-label="Надіслати в Telegram"
                  >
                    <Send size={20} aria-hidden="true" />
                  </button>
                )}
                <button
                  className={`history-favorite-btn ${translation.favorite ? 'active' : ''}`}
                  onClick={() => handleToggleFavorite(translation)}
                  aria-label={translation.favorite ? 'Видалити з обраного' : 'Додати в обране'}
                  aria-pressed={translation.favorite}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={translation.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </button>
                <button
                  className="history-delete-btn"
                  onClick={() => handleDelete(translation)}
                  aria-label="Видалити переклад"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </article>
          </li>
        ))}
      </ul>

      {hasNextPage && (
        <button
          className="history-load-more"
          onClick={loadMore}
          disabled={isFetchingNextPage}
          aria-label={isFetchingNextPage ? 'Завантаження…' : 'Завантажити ще'}
        >
          {isFetchingNextPage ? (
            <>
              <span className="spinner-sm" aria-hidden="true" />
              Завантаження…
            </>
          ) : (
            'Завантажити ще'
          )}
        </button>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Видалити цей переклад з історії?"
          confirmLabel="Так"
          cancelLabel="Скасувати"
          danger
          busy={deleteMutation.isPending}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={clearToast} />
      )}
    </div>
  );
}

export default HistoryPage;
