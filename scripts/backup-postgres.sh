#!/bin/sh
#
# Postgres backups for the production stack.
#
# Runs as the `db-backup` service in docker-compose.production.yml on the same
# postgres:16-alpine image as the database, so `pg_dump` always matches the
# server version. Keep the two image tags in step when Postgres is upgraded: a
# newer server dumped by an older client is refused outright.
#
# One dump per day at BACKUP_AT (UTC), kept as BACKUP_KEEP_DAILY files in
# $BACKUP_DIR/daily; the dump taken on BACKUP_WEEKLY_DAY is also linked into
# $BACKUP_DIR/weekly and kept BACKUP_KEEP_WEEKLY deep. Plain SQL, gzipped: it
# restores with nothing but `psql`, which is what a procedure carried out under
# pressure should need.
#
# `sh backup-postgres.sh --once` takes a single dump and exits - the ad-hoc
# backup before a migration, and the way to prove the job works without waiting
# for the schedule.
#
# `set -e` is deliberately not used: this is a long-lived loop, and a single
# failed dump must be loud in the logs, not the end of the schedule.
set -u

# Dumps are plain SQL: every translation, every Telegram id, every refresh-token
# row in one readable file. Default umask 022 would leave them 0644 inside a 0755
# directory, i.e. readable by any account on the host - so the container running
# as root would protect nothing. 077 makes the directories 0700 and the files
# 0600. Files created before this line existed keep their old mode; fix them once
# with `chmod -R go-rwx "$BACKUP_DIR"`.
umask 077

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_AT="${BACKUP_AT:-03:30}"
BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
BACKUP_KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
# ISO weekday, 1 = Monday .. 7 = Sunday.
BACKUP_WEEKLY_DAY="${BACKUP_WEEKLY_DAY:-7}"
# Optional dead-man's switch. A backup that quietly stops is the one failure in
# this stack that nothing else reports: `restart: unless-stopped` covers the
# container dying, but a pg_dump that fails every night only writes to stderr,
# and the log ceiling in docker-compose.production.yml eventually rotates even
# that away - so it gets discovered on the day a restore is needed. Hence a
# switch rather than a probe: the ping happens after a *successful* dump and
# nowhere else, and it is the monitor's silence that raises the alarm.
#
# Empty by default, and empty means the script behaves exactly as it did before
# this existed. Ten seconds is hardcoded on purpose: it is a value nobody tunes,
# and one more line in .env costs more than it saves.
BACKUP_HEARTBEAT_URL="${BACKUP_HEARTBEAT_URL:-}"
HEARTBEAT_TIMEOUT=10

DAILY_DIR="$BACKUP_DIR/daily"
WEEKLY_DIR="$BACKUP_DIR/weekly"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') backup: $*"; }
fail() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') backup: ERROR $*" >&2; }

# A typo in the schedule must stop the container with a readable message rather
# than quietly mean "never back up".
case "$BACKUP_AT" in
  [0-2][0-9]:[0-5][0-9]) ;;
  *) fail "BACKUP_AT must be HH:MM in UTC, got '$BACKUP_AT'"; exit 1 ;;
esac
AT_HOUR=${BACKUP_AT%:*}
AT_MINUTE=${BACKUP_AT#*:}
# Leading zeros are stripped everywhere a value reaches $(( )): POSIX arithmetic
# reads `08` as octal and fails on it, which would turn a perfectly ordinary
# 08:30 schedule into a crash.
AT_HOUR=${AT_HOUR#0}
AT_MINUTE=${AT_MINUTE#0}
[ "${AT_HOUR:-0}" -le 23 ] || { fail "BACKUP_AT hour out of range: '$BACKUP_AT'"; exit 1; }
AT_HOUR=${AT_HOUR:-0}
AT_MINUTE=${AT_MINUTE:-0}
for count in "$BACKUP_KEEP_DAILY" "$BACKUP_KEEP_WEEKLY"; do
  case "$count" in
    ''|*[!0-9]*) fail "BACKUP_KEEP_* must be whole numbers, got '$count'"; exit 1 ;;
    0) fail "BACKUP_KEEP_* must be at least 1, got '$count'"; exit 1 ;;
  esac
done

# Resolved once, at startup, rather than per dump. postgres:16-alpine is not
# guaranteed to carry curl - busybox `wget` is the fallback and takes different
# flags - so a URL set against an image that cannot reach it must be a loud line
# in the log now, not a silent non-ping every night. A missing scheme is caught
# here for the same reason: `hc-ping.com/<uuid>` pasted without `https://` fails
# in a way that is far more obvious at boot than at 03:30.
HEARTBEAT_CMD=''
if [ -n "$BACKUP_HEARTBEAT_URL" ]; then
  case "$BACKUP_HEARTBEAT_URL" in
    http://*|https://*) ;;
    *) fail "BACKUP_HEARTBEAT_URL must start with http:// or https:// (value not logged)"; exit 1 ;;
  esac
  if command -v curl >/dev/null 2>&1; then
    HEARTBEAT_CMD=curl
  elif command -v wget >/dev/null 2>&1; then
    HEARTBEAT_CMD=wget
  else
    fail "BACKUP_HEARTBEAT_URL is set but this image has neither curl nor wget; no heartbeat will be sent"
  fi
fi

# Never fails the backup: the dump is already on disk by the time this runs, and
# a monitoring endpoint being unreachable is not a reason to report a good dump
# as bad. The failure is logged, and an unanswered switch alerts by itself. The
# URL never reaches a log line - it is the shared secret of the switch, and
# anyone holding it can keep the monitor quiet while the backups stop, so curl's
# own stderr (which echoes the URL) is dropped too.
heartbeat() {
  [ -n "$HEARTBEAT_CMD" ] || return 0
  case "$HEARTBEAT_CMD" in
    curl) curl -fsS -m "$HEARTBEAT_TIMEOUT" -o /dev/null "$BACKUP_HEARTBEAT_URL" 2>/dev/null ;;
    wget) wget -q -T "$HEARTBEAT_TIMEOUT" -O /dev/null "$BACKUP_HEARTBEAT_URL" 2>/dev/null ;;
  esac
  if [ "$?" -eq 0 ]; then
    log "heartbeat sent"
  else
    fail "heartbeat failed; the dump itself is fine"
  fi
  return 0
}

wait_for_db() {
  attempt=0
  while ! pg_isready --quiet; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
      fail "database unreachable after 5 minutes of waiting"
      return 1
    fi
    sleep 5
  done
  return 0
}

# Newest first, drop everything past the keep count. Dump names carry no spaces
# by construction, so word-splitting the listing is safe here.
prune() {
  dir="$1"
  keep="$2"
  ls -1t "$dir" 2>/dev/null | grep '\.sql\.gz$' | tail -n "+$((keep + 1))" | while IFS= read -r stale; do
    rm -f "$dir/$stale" && log "pruned $dir/$stale"
  done
}

take_backup() {
  wait_for_db || return 1

  stamp=$(date -u '+%Y%m%dT%H%M%SZ')
  name="slangua-$stamp.sql.gz"
  work="$BACKUP_DIR/.in-progress-$stamp.sql"

  # Two steps instead of `pg_dump | gzip`: POSIX sh cannot read the exit status
  # of the left-hand side of a pipe, and a dump that failed halfway must never
  # be mistaken for a backup. The name only appears under daily/ once the file
  # is complete, so the pruner can never count a partial file either.
  if ! pg_dump --no-owner --no-privileges > "$work"; then
    fail "pg_dump failed; no file kept for $stamp"
    rm -f "$work"
    return 1
  fi
  if ! gzip -9 "$work"; then
    fail "gzip failed for $stamp"
    rm -f "$work" "$work.gz"
    return 1
  fi
  if ! mv "$work.gz" "$DAILY_DIR/$name"; then
    fail "could not move the finished dump into $DAILY_DIR"
    rm -f "$work.gz"
    return 1
  fi

  log "wrote daily/$name ($(wc -c < "$DAILY_DIR/$name") bytes)"

  if [ "$(date -u '+%u')" = "$BACKUP_WEEKLY_DAY" ]; then
    # A hard link, so the weekly copy costs no extra disk while both names
    # exist; `cp` covers the case where the two directories are not on one
    # filesystem. Pruning either name leaves the other file intact.
    if ln "$DAILY_DIR/$name" "$WEEKLY_DIR/$name" 2>/dev/null ||
      cp "$DAILY_DIR/$name" "$WEEKLY_DIR/$name"; then
      log "kept weekly/$name"
    else
      fail "could not create the weekly copy of $name"
    fi
  fi

  prune "$DAILY_DIR" "$BACKUP_KEEP_DAILY"
  prune "$WEEKLY_DIR" "$BACKUP_KEEP_WEEKLY"
  # Last, so the ping means "a whole cycle completed" rather than "pg_dump
  # returned 0". Sent for --once as well: the switch measures whether a good
  # dump exists, and an ad-hoc dump before a migration is one.
  heartbeat
  return 0
}

seconds_until_schedule() {
  # Same octal trap as BACKUP_AT above: `date` pads to two digits, so 08 and 09
  # have to lose the zero before any arithmetic touches them.
  now_hour=$(date -u '+%H'); now_hour=${now_hour#0}
  now_minute=$(date -u '+%M'); now_minute=${now_minute#0}
  now_second=$(date -u '+%S'); now_second=${now_second#0}
  now=$((${now_hour:-0} * 3600 + ${now_minute:-0} * 60 + ${now_second:-0}))
  target=$((AT_HOUR * 3600 + AT_MINUTE * 60))
  delta=$((target - now))
  [ "$delta" -le 0 ] && delta=$((delta + 86400))
  echo "$delta"
}

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR" || { fail "cannot write to $BACKUP_DIR"; exit 1; }

if [ "${1:-}" = "--once" ]; then
  take_backup || exit 1
  exit 0
fi

log "schedule ${BACKUP_AT} UTC, keeping $BACKUP_KEEP_DAILY daily and $BACKUP_KEEP_WEEKLY weekly in $BACKUP_DIR"
# The URL itself is never logged - it is the shared secret of the switch, and a
# third party who knows it can keep the monitor quiet while the backups stop.
if [ -n "$HEARTBEAT_CMD" ]; then
  log "heartbeat enabled, via $HEARTBEAT_CMD"
else
  log "heartbeat disabled (BACKUP_HEARTBEAT_URL is empty)"
fi

# A restart must not skip a day, and must not dump on every crash-loop turn
# either: one look at how old the newest dump is answers both.
if [ -z "$(find "$DAILY_DIR" -name '*.sql.gz' -mtime -1 2>/dev/null)" ]; then
  log "no dump from the last 24 hours; taking one now"
  take_backup
else
  log "a dump from the last 24 hours exists; waiting for the schedule"
fi

while true; do
  wait_seconds=$(seconds_until_schedule)
  log "next dump in $wait_seconds seconds"
  sleep "$wait_seconds"
  take_backup
done
