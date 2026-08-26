/**
 * Usage metrics for the admin panel: how much traffic the service is taking,
 * how much of it failed, and which users account for it.
 *
 * Everything lives in Redis and nothing is ever deleted by us. Each counter is
 * written with an absolute `EXPIREAT` derived from the bucket it belongs to, so
 * a bucket dies at a moment fixed when it was created rather than a fixed span
 * after the last write - a per-write TTL reset would keep a busy minute alive
 * forever and make "the last hour" mean something different for every key.
 *
 * Three granularities, because they answer different questions: minutes for "is
 * it happening right now", hours for a rolling 24h window that does not jump at
 * midnight, and UTC days for the history.
 *
 * Two deliberate limits on what is measured:
 *
 * - **Day buckets are UTC.** A local-time boundary would move with the server's
 *   timezone and make yesterday's row change value on a deploy. The panel labels
 *   the dates as UTC instead of pretending otherwise. The 24h window exists
 *   precisely because that boundary is useless at 01:00 UTC, when "today" is one
 *   hour old.
 * - **Only the internal numeric user id is stored.** Never a Telegram id, never
 *   text, never a translation. The metrics are a load picture, not an audit
 *   trail, and Redis is the wrong place to accumulate identity.
 */

import { getRedisClient } from '../../lib/redis.js';
import { config } from '../../config/index.js';

/** Requests per minute bucket: `metrics:req:m:<epoch minute>`. */
const MINUTE_REQUESTS_PREFIX = 'metrics:req:m:';
/** Failed requests (5xx) per minute bucket. */
const MINUTE_ERRORS_PREFIX = 'metrics:err:m:';
/** Requests per hour bucket: `metrics:req:h:<epoch hour>`. */
const HOUR_REQUESTS_PREFIX = 'metrics:req:h:';
/** Failed requests (5xx) per hour bucket. */
const HOUR_ERRORS_PREFIX = 'metrics:err:h:';
/**
 * Plain set per hour, member = internal user id. A set and not a sorted set:
 * the hour granularity exists only so that 24 of them can be unioned into an
 * exact "unique people in the last 24 hours", and per-hour ranking is a question
 * nobody asks.
 */
const HOUR_USERS_PREFIX = 'metrics:users:h:';
/** Requests per UTC day: `metrics:req:d:<YYYY-MM-DD>`. */
const DAY_REQUESTS_PREFIX = 'metrics:req:d:';
/** Failed requests (5xx) per UTC day. */
const DAY_ERRORS_PREFIX = 'metrics:err:d:';
/** Sorted set per UTC day, member = internal user id, score = request count. */
const DAY_USERS_PREFIX = 'metrics:users:d:';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
/**
 * Length of the rolling window, in hours. Fixed rather than configurable: "the
 * last 24 hours" is the thing the panel promises, and a deployment that could
 * set it to 6 would make that heading a lie.
 */
const ROLLING_HOURS = 24;

/** What the request lifecycle reports once a reply has been sent. */
export interface MetricsSample {
  /** Internal user id, or null for an unauthenticated request. */
  userId: number | null;
  /** True when the reply was a 5xx - the same definition the error feed uses. */
  isError: boolean;
  /** Injectable clock, for tests. */
  at?: number;
}

export interface MetricsMinuteBucket {
  /** ISO-8601 start of the minute, always `:00` seconds. */
  startedAt: string;
  requests: number;
  errors: number;
}

export interface MetricsHourBucket {
  /** ISO-8601 start of the hour, always `:00:00` minutes and seconds. */
  startedAt: string;
  requests: number;
  errors: number;
}

export interface MetricsRollingWindow {
  /** Length of the window in hours, and of the series below. */
  hours: number;
  requests: number;
  errors: number;
  /** Distinct authenticated users over the whole window, counted exactly. */
  users: number;
  /** Oldest hour first, zero-filled. */
  series: MetricsHourBucket[];
}

export interface MetricsDayBucket {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  requests: number;
  errors: number;
  /** Distinct authenticated users seen that day. */
  users: number;
  /** requests / users, rounded to two decimals; 0 when nobody was seen. */
  averagePerUser: number;
}

export interface MetricsTopUser {
  /** Internal user id as a string - it is an opaque handle to the panel. */
  userId: string;
  requests: number;
}

export interface MetricsSnapshot {
  generatedAt: string;
  /** How many daily rows exist at most, i.e. how far back Redis keeps anything. */
  retentionDays: number;
  perMinute: {
    /** Length of the series, oldest first. */
    minutes: number;
    series: MetricsMinuteBucket[];
  };
  /** The rolling window, independent of the UTC day boundary. */
  last24h: MetricsRollingWindow;
  /** Newest first, so the client reads "today" as `daily[0]`. */
  daily: MetricsDayBucket[];
  /** Today's heaviest users, descending. */
  topUsers: MetricsTopUser[];
}

/** `YYYY-MM-DD` in UTC. */
function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Start of an epoch minute as ISO-8601. */
function minuteStartedAt(minute: number): string {
  return new Date(minute * MS_PER_MINUTE).toISOString();
}

/** Start of an epoch hour as ISO-8601. */
function hourStartedAt(hour: number): string {
  return new Date(hour * MS_PER_HOUR).toISOString();
}

/**
 * When an hour bucket dies: the window plus two hours of slack, measured from
 * the start of the hour itself. Same rule as the minute buckets, and for the same
 * reason - a per-write reset would keep a busy hour alive past the window and
 * make the union of 24 keys mean something different every time.
 */
function hourExpiryAt(hour: number): number {
  return hour * SECONDS_PER_HOUR + (ROLLING_HOURS + 2) * SECONDS_PER_HOUR;
}

/**
 * When a minute bucket dies: the series length plus two minutes of slack, so a
 * bucket survives exactly as long as the panel can still ask for it.
 */
function minuteExpiryAt(minute: number, seriesLength: number): number {
  return minute * SECONDS_PER_MINUTE + (seriesLength + 2) * SECONDS_PER_MINUTE;
}

/**
 * When a day bucket dies: retention days after the day itself ended. Derived
 * from the date string, so every write inside that day computes the same second.
 */
function dayExpiryAt(date: string, retentionDays: number): number {
  const startOfDay = Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 1000);
  return startOfDay + (retentionDays + 1) * SECONDS_PER_DAY;
}

function toCount(value: string | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export class MetricsService {
  /**
   * Records one finished request. Callers treat a failure here as tolerable -
   * see the observability hook - but the method itself does not swallow errors,
   * so tests and future callers can decide for themselves.
   */
  async record(sample: MetricsSample): Promise<void> {
    const now = sample.at ?? Date.now();
    const minute = Math.floor(now / MS_PER_MINUTE);
    const hour = Math.floor(now / MS_PER_HOUR);
    const date = dayOf(now);
    const seriesLength = config.METRICS_MINUTE_SERIES_LENGTH;
    const retentionDays = config.METRICS_RETENTION_DAYS;

    const minuteDeadline = minuteExpiryAt(minute, seriesLength);
    const hourDeadline = hourExpiryAt(hour);
    const dayDeadline = dayExpiryAt(date, retentionDays);

    const multi = getRedisClient().multi();

    const minuteRequests = `${MINUTE_REQUESTS_PREFIX}${minute}`;
    multi.incr(minuteRequests);
    multi.expireat(minuteRequests, minuteDeadline);

    const hourRequests = `${HOUR_REQUESTS_PREFIX}${hour}`;
    multi.incr(hourRequests);
    multi.expireat(hourRequests, hourDeadline);

    const dayRequests = `${DAY_REQUESTS_PREFIX}${date}`;
    multi.incr(dayRequests);
    multi.expireat(dayRequests, dayDeadline);

    if (sample.isError) {
      const minuteErrors = `${MINUTE_ERRORS_PREFIX}${minute}`;
      multi.incr(minuteErrors);
      multi.expireat(minuteErrors, minuteDeadline);

      const hourErrors = `${HOUR_ERRORS_PREFIX}${hour}`;
      multi.incr(hourErrors);
      multi.expireat(hourErrors, hourDeadline);

      const dayErrors = `${DAY_ERRORS_PREFIX}${date}`;
      multi.incr(dayErrors);
      multi.expireat(dayErrors, dayDeadline);
    }

    if (sample.userId != null) {
      const hourUsers = `${HOUR_USERS_PREFIX}${hour}`;
      multi.sadd(hourUsers, String(sample.userId));
      multi.expireat(hourUsers, hourDeadline);

      const dayUsers = `${DAY_USERS_PREFIX}${date}`;
      multi.zincrby(dayUsers, 1, String(sample.userId));
      multi.expireat(dayUsers, dayDeadline);
    }

    await multi.exec();
  }

  /**
   * The whole panel view in a handful of Redis round trips: MGETs for the minute
   * and hour series, one SUNION for the people behind the rolling window, one
   * pipeline for the daily rows, one ZREVRANGE for today's top users. A Redis
   * failure propagates rather than resolving to a page of zeros, which would read
   * as "no traffic" instead of "no data".
   */
  async snapshot(at: number = Date.now()): Promise<MetricsSnapshot> {
    const redis = getRedisClient();
    const seriesLength = config.METRICS_MINUTE_SERIES_LENGTH;
    const retentionDays = config.METRICS_RETENTION_DAYS;
    const topLimit = config.METRICS_TOP_USERS_LIMIT;

    const currentMinute = Math.floor(at / MS_PER_MINUTE);
    const minutes: number[] = [];
    for (let offset = seriesLength - 1; offset >= 0; offset -= 1) {
      minutes.push(currentMinute - offset);
    }

    // The current hour counts as one of the 24, so the window is "the last 24
    // hour buckets" - between 23h and 24h of wall clock, and never more.
    const currentHour = Math.floor(at / MS_PER_HOUR);
    const hours: number[] = [];
    for (let offset = ROLLING_HOURS - 1; offset >= 0; offset -= 1) {
      hours.push(currentHour - offset);
    }

    const today = dayOf(at);
    const dates: string[] = [];
    for (let offset = 0; offset < retentionDays; offset += 1) {
      dates.push(dayOf(at - offset * SECONDS_PER_DAY * 1000));
    }

    const [minuteRequests, minuteErrors, hourRequests, hourErrors, windowUsers] = await Promise.all([
      redis.mget(minutes.map((minute) => `${MINUTE_REQUESTS_PREFIX}${minute}`)),
      redis.mget(minutes.map((minute) => `${MINUTE_ERRORS_PREFIX}${minute}`)),
      redis.mget(hours.map((hour) => `${HOUR_REQUESTS_PREFIX}${hour}`)),
      redis.mget(hours.map((hour) => `${HOUR_ERRORS_PREFIX}${hour}`)),
      // SUNION and not 24 SCARDs summed: a user active in three of those hours is
      // one person, and summing per-hour counts would report three.
      redis.sunion(...hours.map((hour) => `${HOUR_USERS_PREFIX}${hour}`)),
    ]);

    const dayPipeline = redis.pipeline();
    for (const date of dates) {
      dayPipeline.get(`${DAY_REQUESTS_PREFIX}${date}`);
      dayPipeline.get(`${DAY_ERRORS_PREFIX}${date}`);
      dayPipeline.zcard(`${DAY_USERS_PREFIX}${date}`);
    }
    const dayResults = await dayPipeline.exec();

    const topRaw = await redis.zrevrange(
      `${DAY_USERS_PREFIX}${today}`,
      0,
      topLimit - 1,
      'WITHSCORES',
    );

    const series: MetricsMinuteBucket[] = minutes.map((minute, index) => ({
      startedAt: minuteStartedAt(minute),
      requests: toCount(minuteRequests[index]),
      errors: toCount(minuteErrors[index]),
    }));

    const hourSeries: MetricsHourBucket[] = hours.map((hour, index) => ({
      startedAt: hourStartedAt(hour),
      requests: toCount(hourRequests[index]),
      errors: toCount(hourErrors[index]),
    }));

    const last24h: MetricsRollingWindow = {
      hours: ROLLING_HOURS,
      requests: hourSeries.reduce((total, bucket) => total + bucket.requests, 0),
      errors: hourSeries.reduce((total, bucket) => total + bucket.errors, 0),
      users: windowUsers.length,
      series: hourSeries,
    };

    const daily: MetricsDayBucket[] = dates.map((date, index) => {
      const base = index * 3;
      const requests = toCount(readPipelineString(dayResults, base));
      const errors = toCount(readPipelineString(dayResults, base + 1));
      const users = toCount(readPipelineString(dayResults, base + 2));

      return {
        date,
        requests,
        errors,
        users,
        averagePerUser: users > 0 ? round2(requests / users) : 0,
      };
    });

    const topUsers: MetricsTopUser[] = [];
    for (let index = 0; index + 1 < topRaw.length; index += 2) {
      topUsers.push({
        userId: topRaw[index] as string,
        requests: toCount(topRaw[index + 1] as string),
      });
    }

    return {
      generatedAt: new Date(at).toISOString(),
      retentionDays,
      perMinute: { minutes: seriesLength, series },
      last24h,
      daily,
      topUsers,
    };
  }
}

/**
 * ioredis reports a pipeline as `[error, value][]`, and a single failed command
 * must not be read as a zero: it is rethrown, so the route answers honestly.
 */
function readPipelineString(
  results: [Error | null, unknown][] | null,
  index: number,
): string | null {
  if (!results) throw new Error('Redis pipeline returned no result');
  const entry = results[index];
  if (!entry) throw new Error(`Redis pipeline is missing result ${index}`);
  const [error, value] = entry;
  if (error) throw error;
  if (value == null) return null;
  return String(value);
}

export const metricsService = new MetricsService();
