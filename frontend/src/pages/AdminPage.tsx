import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { triggerHapticFeedback } from '../services/telegram';
import { ErrorBanner } from '../components/ErrorBanner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { AdminOverview, AdminProviderStatus } from '../types/api';
import './AdminPage.css';

/** HTTP status of an axios error, when it has one. */
function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}

/** `HH:MM` of an ISO moment, in the operator's own timezone. */
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Badge text and colour for one provider row. Operator intent wins over health:
 * a switched-off provider reads as switched off even while its instance answers.
 */
function badgeOf(provider: AdminProviderStatus): { label: string; modifier: string } {
  if (provider.disabled) return { label: 'вимкнено вручну', modifier: 'admin-badge-off' };
  if (provider.available) return { label: 'працює', modifier: 'admin-badge-up' };
  if (provider.configured) return { label: 'недоступний', modifier: 'admin-badge-warn' };
  return { label: 'без ключа', modifier: 'admin-badge-off' };
}

/**
 * Admin panel, stages A-D: the door, the provider chain and its switch, the
 * usage figures, and the error feed.
 *
 * What this screen can do is take an AI provider out of the fallback chain and
 * put it back - an operator action, so switching one off asks for confirmation
 * and switching the last usable one off says out loud what it costs. Everything
 * else here is read-only.
 *
 * The page is ordered by how often it is needed: the provider chain is one row
 * per provider, the load figures are minutes and then the rolling 24 hours, and
 * the error feed - the longest section and the least often read - is collapsed
 * until someone asks for it.
 *
 * The route is reachable only with a step-up token in memory. Landing here
 * without one - a reload, or a deep link - sends the operator back to Settings
 * rather than showing an empty shell, because the token deliberately does not
 * survive a reload.
 */
export function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [hasSession, setHasSession] = useState(() => apiService.hasAdminSession());
  const [pending, setPending] = useState<AdminProviderStatus | null>(null);

  useEffect(() => {
    if (!hasSession) {
      navigate('/settings', { replace: true });
    }
  }, [hasSession, navigate]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => apiService.getAdminOverview(),
    enabled: hasSession,
    // The panel shows live state; a cached provider list would be misleading.
    staleTime: 0,
    retry: false,
  });

  // Two more read-only views, each with its own query so a failure in one does
  // not blank the others: an unreachable error feed must not hide the provider
  // chain, which is the part an operator can act on.
  const metrics = useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: () => apiService.getAdminMetrics(),
    enabled: hasSession,
    staleTime: 0,
    retry: false,
  });

  const errorFeed = useQuery({
    queryKey: ['admin', 'errors'],
    queryFn: () => apiService.getAdminErrors(),
    enabled: hasSession,
    staleTime: 0,
    retry: false,
  });

  // The overview is fetched once, so an expired session usually shows up on one
  // of these two instead. Treat it the same way: drop the token and send the
  // operator back to the password prompt rather than leaving a dead page.
  useEffect(() => {
    if (statusOf(metrics.error) === 401 || statusOf(errorFeed.error) === 401) {
      setHasSession(false);
    }
  }, [metrics.error, errorFeed.error]);

  const toggle = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      apiService.setAdminProvider(id, disabled),
    onSuccess: (result) => {
      triggerHapticFeedback('notification');
      // The server already returned the whole chain, so write it straight into
      // the cache instead of refetching what we were just told.
      queryClient.setQueryData<AdminOverview>(['admin', 'overview'], (previous) =>
        previous ? { ...previous, providers: result.providers, generatedAt: result.generatedAt } : previous
      );
    },
    onError: () => triggerHapticFeedback('impact'),
    onSettled: () => setPending(null),
  });

  const handleLock = useCallback(async () => {
    triggerHapticFeedback('selection');
    await apiService.closeAdminSession();
    setHasSession(false);
  }, []);

  const usableCount = useMemo(
    () => (data?.providers ?? []).filter((p) => p.available && !p.disabled).length,
    [data]
  );

  // Memoized, not just read: `?? []` builds a fresh array on every render, which
  // would make the two derived memos below recompute on every render as well.
  const series = useMemo(() => metrics.data?.perMinute.series ?? [], [metrics.data]);

  /** Totals over the whole minute series - the header figure of that section. */
  const minuteTotals = useMemo(
    () =>
      series.reduce(
        (acc, minute) => ({
          requests: acc.requests + minute.requests,
          errors: acc.errors + minute.errors,
        }),
        { requests: 0, errors: 0 }
      ),
    [series]
  );

  /** Scale of the bar chart. At least 1, so an idle hour is flat, not empty. */
  const peakMinute = useMemo(
    () => Math.max(1, ...series.map((minute) => minute.requests)),
    [series]
  );

  /**
   * The rolling window. Its totals arrive computed by the server - the unique
   * count in particular cannot be derived here, because a person active in three
   * of those hours is one person and the series does not say who was who.
   */
  const hourSeries = useMemo(() => metrics.data?.last24h.series ?? [], [metrics.data]);

  const peakHour = useMemo(
    () => Math.max(1, ...hourSeries.map((hour) => hour.requests)),
    [hourSeries]
  );

  if (!hasSession) {
    return null;
  }

  const status = statusOf(error);
  const toggleStatus = statusOf(toggle.error);

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1 className="page-title">Адмінка</h1>
      </header>

      <main className="admin-main">
        {error && (
          <ErrorBanner
            message={
              status === 401
                ? 'Сесія адміністратора завершилась. Введіть пароль ще раз.'
                : 'Не вдалося завантажити стан системи.'
            }
            code={status === 401 ? 'ADMIN_SESSION_INVALID' : 'UNKNOWN'}
            onRetry={status === 401 ? undefined : () => refetch()}
            onDismiss={status === 401 ? () => setHasSession(false) : undefined}
          />
        )}

        {toggle.isError && (
          <ErrorBanner
            message={
              toggleStatus === 401
                ? 'Сесія адміністратора завершилась. Введіть пароль ще раз.'
                : 'Не вдалося змінити стан провайдера.'
            }
            code={toggleStatus === 401 ? 'ADMIN_SESSION_INVALID' : 'UNKNOWN'}
            onDismiss={
              toggleStatus === 401 ? () => setHasSession(false) : () => toggle.reset()
            }
          />
        )}

        {isLoading && (
          <div className="admin-loading" role="status" aria-label="Завантаження стану системи">
            <div className="loading-spinner" aria-hidden="true" />
          </div>
        )}

        {data && (
          <>
            <section className="admin-section">
              <h2 className="admin-section-title">Провайдери ШІ</h2>
              {usableCount === 0 && (
                <p className="admin-alert" role="status">
                  Жодного робочого провайдера. Переклад зараз відповідає помилкою 503.
                </p>
              )}
              <ul className="admin-provider-list">
                {data.providers.map((provider) => {
                  const badge = badgeOf(provider);
                  return (
                    <li className="admin-provider" key={provider.id}>
                      {/* One row per provider: name, state and the switch on the
                          same line. A chain of five used to be a screenful. */}
                      <div className="admin-provider-row">
                        <span className="admin-provider-name">
                          {provider.priority}. {provider.id}
                        </span>
                        <span className={`admin-badge ${badge.modifier}`}>{badge.label}</span>
                        <button
                          type="button"
                          className={
                            provider.disabled
                              ? 'btn btn-secondary admin-provider-btn'
                              : 'btn btn-danger admin-provider-btn'
                          }
                          disabled={toggle.isPending}
                          onClick={() => {
                            triggerHapticFeedback('selection');
                            if (provider.disabled) {
                              // Turning traffic back on needs no confirmation: the
                              // reversible direction is the safe one.
                              toggle.mutate({ id: provider.id, disabled: false });
                            } else {
                              setPending(provider);
                            }
                          }}
                        >
                          {provider.disabled ? 'Увімкнути' : 'Вимкнути'}
                        </button>
                      </div>
                      {provider.disabled && (provider.disabledAt || provider.disabledBy) && (
                        <p className="admin-provider-note">
                          {provider.disabledBy ? `Вимкнув ${provider.disabledBy}` : 'Вимкнено'}
                          {provider.disabledAt
                            ? `, ${new Date(provider.disabledAt).toLocaleString('uk-UA')}`
                            : ''}
                          {provider.disabledReason ? `. ${provider.disabledReason}` : ''}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="admin-note">
                Вимкнення діє одразу і зберігається після перезапуску. Автоматичний брейкер не
                вмикає провайдера назад — це робить лише людина.
              </p>
            </section>

            <section className="admin-section">
              <h2 className="admin-section-title">Навантаження</h2>
              {metrics.isLoading && <p className="admin-note">Завантаження метрик…</p>}
              {metrics.isError && statusOf(metrics.error) !== 401 && (
                <p className="admin-alert" role="status">
                  Не вдалося завантажити метрики.{' '}
                  <button
                    type="button"
                    className="admin-inline-btn"
                    onClick={() => metrics.refetch()}
                  >
                    Спробувати ще
                  </button>
                </p>
              )}
              {metrics.data && (
                <>
                  <p className="admin-metrics-lead">
                    За останні {metrics.data.perMinute.minutes} хв:{' '}
                    <strong>{minuteTotals.requests}</strong> запитів, з них помилок{' '}
                    {minuteTotals.errors}.
                  </p>
                  <div
                    className="admin-chart"
                    role="img"
                    aria-label={`Запити за хвилину, найбільше за хвилину — ${peakMinute}`}
                  >
                    {series.map((minute) => (
                      <span
                        key={minute.startedAt}
                        className={minute.errors > 0 ? 'admin-bar admin-bar-error' : 'admin-bar'}
                        style={{ height: `${Math.round((minute.requests / peakMinute) * 100)}%` }}
                        title={`${timeLabel(minute.startedAt)} — ${minute.requests} запитів, помилок ${minute.errors}`}
                      />
                    ))}
                  </div>
                  {series.length > 0 && (
                    <div className="admin-chart-axis">
                      <span>{timeLabel(series[0].startedAt)}</span>
                      <span>{timeLabel(series[series.length - 1].startedAt)}</span>
                    </div>
                  )}

                  {/* The rolling window, not "since midnight": at 01:00 UTC the
                      daily row is an hour old and says nothing about the night. */}
                  <h3 className="admin-subtitle">За останні {metrics.data.last24h.hours} години</h3>
                  <p className="admin-metrics-lead">
                    <strong>{metrics.data.last24h.requests}</strong> запитів, помилок{' '}
                    {metrics.data.last24h.errors}, людей {metrics.data.last24h.users}.
                  </p>
                  <div
                    className="admin-chart admin-chart-hours"
                    role="img"
                    aria-label={`Запити за годину, найбільше за годину — ${peakHour}`}
                  >
                    {hourSeries.map((hour) => (
                      <span
                        key={hour.startedAt}
                        className={hour.errors > 0 ? 'admin-bar admin-bar-error' : 'admin-bar'}
                        style={{ height: `${Math.round((hour.requests / peakHour) * 100)}%` }}
                        title={`${timeLabel(hour.startedAt)} — ${hour.requests} запитів, помилок ${hour.errors}`}
                      />
                    ))}
                  </div>
                  {hourSeries.length > 0 && (
                    <div className="admin-chart-axis">
                      <span>{timeLabel(hourSeries[0].startedAt)}</span>
                      <span>{timeLabel(hourSeries[hourSeries.length - 1].startedAt)}</span>
                    </div>
                  )}

                  <table className="admin-table">
                    <caption>Дні за UTC, до {metrics.data.retentionDays} останніх</caption>
                    <thead>
                      <tr>
                        <th scope="col">Дата</th>
                        <th scope="col">Запити</th>
                        <th scope="col">Помилки</th>
                        <th scope="col">Люди</th>
                        <th scope="col">На людину</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.data.daily.map((day) => (
                        <tr key={day.date}>
                          <th scope="row">{day.date}</th>
                          <td>{day.requests}</td>
                          <td>{day.errors}</td>
                          <td>{day.users}</td>
                          <td>{day.averagePerUser}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <h3 className="admin-subtitle">Найактивніші сьогодні</h3>
                  {metrics.data.topUsers.length === 0 ? (
                    <p className="admin-note">Сьогодні ще нікого.</p>
                  ) : (
                    <ol className="admin-top-users">
                      {metrics.data.topUsers.map((user) => (
                        <li key={user.userId}>
                          <span className="admin-top-user-id">#{user.userId}</span>
                          <span>{user.requests}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {/* From the database, not from the counters above: Redis buckets
                      expire, so a Redis-derived total would shrink over a quiet
                      week and read as people leaving. */}
                  <p className="admin-metrics-total">
                    Усього людей за весь час: <strong>{metrics.data.totalUsers}</strong>
                  </p>
                  <p className="admin-note">
                    Помилка — це відповідь 5xx. Перевірки стану, preflight-запити браузера і сама
                    адмінка не враховуються, тож графік показує лише живий трафік.
                  </p>
                </>
              )}
            </section>

            {/*
              Collapsed by default, and a native `details` rather than a state
              flag: the feed is the longest thing on the page and the least often
              needed - on a healthy day it is a list of nothing worth scrolling
              past. The count in the summary is there so it can be checked
              without opening anything.
            */}
            <details className="admin-section admin-collapsible">
              <summary className="admin-summary">
                <h2 className="admin-section-title">Останні помилки</h2>
                {errorFeed.data && (
                  <span
                    className={
                      errorFeed.data.entries.length > 0
                        ? 'admin-summary-count admin-summary-count-warn'
                        : 'admin-summary-count'
                    }
                  >
                    {errorFeed.data.entries.length}
                  </span>
                )}
              </summary>
              {errorFeed.isLoading && <p className="admin-note">Завантаження стрічки…</p>}
              {errorFeed.isError && statusOf(errorFeed.error) !== 401 && (
                <p className="admin-alert" role="status">
                  Не вдалося завантажити стрічку помилок.{' '}
                  <button
                    type="button"
                    className="admin-inline-btn"
                    onClick={() => errorFeed.refetch()}
                  >
                    Спробувати ще
                  </button>
                </p>
              )}
              {errorFeed.data &&
                (errorFeed.data.entries.length === 0 ? (
                  <p className="admin-note">Помилок немає.</p>
                ) : (
                  <ul className="admin-error-list">
                    {errorFeed.data.entries.map((entry) => (
                      <li className="admin-error" key={`${entry.at}-${entry.requestId ?? ''}`}>
                        <div className="admin-error-head">
                          <span className="admin-error-code">{entry.statusCode}</span>
                          <span className="admin-error-route">
                            {entry.method} {entry.route}
                          </span>
                          <time dateTime={entry.at}>{new Date(entry.at).toLocaleString('uk-UA')}</time>
                        </div>
                        {entry.code && <p className="admin-error-kind">{entry.code}</p>}
                        {entry.message && <p className="admin-error-message">{entry.message}</p>}
                        <p className="admin-error-meta">
                          {entry.userId != null ? `Користувач #${entry.userId}` : 'Без входу'}
                          {entry.requestId ? ` · запит ${entry.requestId}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                ))}
              {errorFeed.data && (
                <p className="admin-note">
                  Останні {errorFeed.data.max} помилок, зберігаються{' '}
                  {Math.round(errorFeed.data.retentionSeconds / 86400)} дн. Стрічка чиститься сама —
                  повний запис із стеком лишається в логах, за номером запиту.
                </p>
              )}
            </details>

            <section className="admin-section">
              <h2 className="admin-section-title">Сесія</h2>
              <dl className="admin-facts">
                <dt>Telegram ID</dt>
                <dd>{data.admin.telegramId}</dd>
                <dt>Неактивність до</dt>
                <dd>{new Date(data.admin.sessionExpiresAt).toLocaleTimeString('uk-UA')}</dd>
                <dt>Жорсткий строк</dt>
                <dd>{new Date(data.admin.sessionAbsoluteExpiresAt).toLocaleString('uk-UA')}</dd>
              </dl>
            </section>
          </>
        )}

        <div className="admin-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/settings')}>
            До налаштувань
          </button>
          <button type="button" className="btn btn-danger" onClick={handleLock}>
            Закрити сесію
          </button>
        </div>
      </main>

      {pending && (
        <ConfirmDialog
          title={`Вимкнути ${pending.id}?`}
          text={
            usableCount <= 1
              ? 'Це останній робочий провайдер. Після вимкнення переклад перестане працювати, доки хтось не увімкне провайдера назад.'
              : 'Провайдер вийде з ланцюга запасних варіантів, доки його не увімкнуть вручну.'
          }
          confirmLabel="Вимкнути"
          danger
          busy={toggle.isPending}
          onConfirm={() => toggle.mutate({ id: pending.id, disabled: true })}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

export default AdminPage;
