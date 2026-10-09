#!/usr/bin/env bash
# Mock-only regression tests: no Docker daemon or production paths are touched.
# Run with: bash deploy/production/test-maintenance-sep.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/maintenance-sep.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sep-maintenance-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/bin"

cat > "$TMP_DIR/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '<%s>' "$@" >> "$MOCK_CASE/docker.calls"
printf '\n' >> "$MOCK_CASE/docker.calls"
# Any rm, stop, container/image/system/volume prune, etc. is a test failure.
if [[ "${1:-}" != builder || "${2:-}" != prune ]]; then
  printf '<%s>' "$@" >> "$MOCK_CASE/unsafe.calls"
  printf '\n' >> "$MOCK_CASE/unsafe.calls"
  exit 97
fi
MOCK

cat > "$TMP_DIR/bin/flock" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
# Validate the actual open file behind each descriptor, not its chosen number.
[[ "$#" == 2 && "$1" == -n && "$2" =~ ^[0-9]+$ ]] || exit 98
file_identity() {
  # Both temporary locks share a filesystem. Compare inode numbers because
  # macOS /dev/fd reports the descriptor filesystem's device number.
  stat -Lc '%i' "$1" 2>/dev/null || stat -f '%i' "$1"
}
identity="$(file_identity "/dev/fd/$2")"
if [[ "$identity" == "$(file_identity "$SEP_MAINTENANCE_LOCK")" ]]; then
  lock=maintenance
elif [[ "$identity" == "$(file_identity "$SEP_DEPLOY_LOCK_FILE")" ]]; then
  lock=deploy
else
  printf 'unexpected lock descriptor: %s\n' "$2" >&2
  exit 98
fi
printf '%s\n' "$lock" >> "$MOCK_CASE/flock.calls"
[[ "$MOCK_BUSY_LOCK" != "$lock" ]]
MOCK

cat > "$TMP_DIR/bin/df" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$#" == 2 && "$1" == -P && "$2" == "$SEP_MAINTENANCE_MOUNT" ]]
printf '<%s>' "$@" >> "$MOCK_CASE/df.calls"
printf '\n' >> "$MOCK_CASE/df.calls"
count="$(cat "$MOCK_CASE/df.count")"
case "$count" in
  0) percent="$MOCK_DISK_BEFORE" ;;
  1) percent="$MOCK_DISK_AFTER" ;;
  *) printf 'unexpected extra df invocation\n' >&2; exit 98 ;;
esac
printf '%s\n' "$((count + 1))" > "$MOCK_CASE/df.count"
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf 'mock-sep 100000 50000 50000 %s%% %s\n' "$percent" "$SEP_MAINTENANCE_MOUNT"
MOCK

cat > "$TMP_DIR/bin/journalctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '<%s>' "$@" >> "$MOCK_CASE/journal.calls"
printf '\n' >> "$MOCK_CASE/journal.calls"
MOCK

cat > "$TMP_DIR/bin/logger" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$#" == 4 && "$1" == -t && "$2" == sep-maintenance && "$3" == -- ]]
printf '%s\n' "$4" >> "$MOCK_CASE/logger.calls"
MOCK
chmod +x "$TMP_DIR/bin/"*

fail() { printf '  FAIL: %s\n' "$*" >&2; return 1; }

assert_equal() {
  [[ "$1" == "$2" ]] || fail "$3 (expected: $2; actual: $1)"
}

assert_contains() {
  grep -Fq -- "$2" "$1" || fail "missing '$2' in $(basename "$1")"
}

assert_absent() {
  if grep -Fq -- "$2" "$1"; then
    fail "unexpected '$2' in $(basename "$1")"
  fi
}

run_maintenance() {
  local name="$1" before="$2" after="$3" busy="${4:-none}"
  shift 4
  CASE_DIR="$TMP_DIR/$name"
  mkdir -p "$CASE_DIR/locks" "$CASE_DIR/logs" "$CASE_DIR/mount" "$CASE_DIR/home" "$CASE_DIR/tmp"
  local call
  for call in docker unsafe flock df journal logger; do
    : > "$CASE_DIR/$call.calls"
  done
  printf '0\n' > "$CASE_DIR/df.count"
  # env -i prevents inherited production settings from overriding test defaults.
  # Every log, mount and lock path is inside this case's temporary directory.
  if OUTPUT="$(env -i \
    PATH="$TMP_DIR/bin:$PATH" HOME="$CASE_DIR/home" TMPDIR="$CASE_DIR/tmp" \
    MOCK_CASE="$CASE_DIR" MOCK_DISK_BEFORE="$before" MOCK_DISK_AFTER="$after" \
    MOCK_BUSY_LOCK="$busy" \
    SEP_MAINTENANCE_LOCK="$CASE_DIR/locks/maintenance.lock" \
    SEP_DEPLOY_LOCK_FILE="$CASE_DIR/locks/deploy.lock" \
    SEP_MAINTENANCE_LOG="$CASE_DIR/logs/maintenance.log" \
    SEP_MAINTENANCE_MOUNT="$CASE_DIR/mount" \
    "$@" "$BASH" "$SCRIPT" 2>&1)"; then
    STATUS=0
  else
    STATUS=$?
  fi
  printf '%s\n' "$OUTPUT" > "$CASE_DIR/output.log"
  [[ ! -s "$CASE_DIR/unsafe.calls" ]] || fail "dangerous Docker call: $(cat "$CASE_DIR/unsafe.calls")"
}

assert_completed() {
  local expected_status="$1" expected_prune="$2" journal="${3:-<--vacuum-time=14d><--vacuum-size=500M>}"
  assert_equal "$STATUS" "$expected_status" "maintenance exit status"
  assert_equal "$(cat "$CASE_DIR/flock.calls")" $'maintenance\ndeploy' "both file locks acquired"
  assert_equal "$(cat "$CASE_DIR/docker.calls")" "$expected_prune" "exactly one permitted Docker call"
  assert_equal "$(cat "$CASE_DIR/journal.calls")" "$journal" "journal retention"
  assert_equal "$(cat "$CASE_DIR/df.count")" 2 "disk checked before and after cleanup"
  assert_contains "$CASE_DIR/logger.calls" 'maintenance started'
  assert_contains "$CASE_DIR/logger.calls" 'maintenance finished'
  assert_contains "$CASE_DIR/logs/maintenance.log" 'maintenance started'
  assert_contains "$CASE_DIR/logs/maintenance.log" 'maintenance finished'
}

normal_cleanup() {
  run_maintenance normal 40 38 none
  assert_completed 0 '<builder><prune><-af><--filter><until=168h><--keep-storage><20GB>'
  assert_absent "$CASE_DIR/logger.calls" 'warning threshold'
  assert_absent "$CASE_DIR/logger.calls" 'WARNING:'
  assert_absent "$CASE_DIR/logger.calls" 'CRITICAL:'
}

warning_boundary() {
  run_maintenance warning 75 75 none
  assert_completed 0 '<builder><prune><-af><--filter><until=168h><--keep-storage><20GB>'
  assert_contains "$CASE_DIR/logger.calls" 'disk usage is above warning threshold (75%)'
  assert_contains "$CASE_DIR/logger.calls" 'WARNING: disk usage remains above 75%'
  assert_absent "$CASE_DIR/logger.calls" 'CRITICAL:'
}

below_critical_boundary() {
  run_maintenance below-critical 84 74 none
  assert_completed 0 '<builder><prune><-af><--filter><until=168h><--keep-storage><20GB>'
  assert_absent "$CASE_DIR/logger.calls" 'critical threshold'
  assert_absent "$CASE_DIR/logger.calls" 'WARNING:'
}

critical_boundary() {
  run_maintenance critical 85 70 none
  assert_completed 0 '<builder><prune><-af><--keep-storage><20GB>'
  assert_contains "$CASE_DIR/logger.calls" 'disk usage is above critical threshold (85%)'
  assert_absent "$CASE_DIR/logger.calls" 'CRITICAL:'
}

critical_remains() {
  run_maintenance critical-remains 90 85 none
  assert_completed 2 '<builder><prune><-af><--keep-storage><20GB>'
  assert_contains "$CASE_DIR/logger.calls" 'CRITICAL: disk usage remains at 85%, manual investigation required'
}

custom_cache_and_journal() {
  run_maintenance custom 40 39 none \
    SEP_BUILD_CACHE_AGE=48h SEP_BUILD_CACHE_KEEP_STORAGE=5GB \
    SEP_JOURNAL_RETENTION=7d SEP_JOURNAL_MAX_SIZE=200M
  assert_completed 0 '<builder><prune><-af><--filter><until=48h><--keep-storage><5GB>' \
    '<--vacuum-time=7d><--vacuum-size=200M>'
}

custom_critical_storage() {
  run_maintenance custom-critical 85 70 none \
    SEP_BUILD_CACHE_AGE=48h SEP_BUILD_CACHE_KEEP_STORAGE=5GB
  assert_completed 0 '<builder><prune><-af><--keep-storage><5GB>'
}

assert_lock_skip() {
  local busy="$1" expected_locks="$2" call
  run_maintenance "busy-$busy" 90 90 "$busy"
  assert_equal "$STATUS" 0 "occupied $busy lock exits successfully"
  assert_equal "$(cat "$CASE_DIR/flock.calls")" "$expected_locks" "nonblocking lock attempts"
  for call in docker journal df logger; do
    [[ ! -s "$CASE_DIR/$call.calls" ]] || fail "occupied $busy lock still called $call"
  done
  assert_equal "$(cat "$CASE_DIR/df.count")" 0 "occupied lock skips disk checks"
  [[ ! -s "$CASE_DIR/logs/maintenance.log" ]] || fail "occupied lock wrote maintenance log"
}

maintenance_lock_busy() { assert_lock_skip maintenance maintenance; }
deploy_lock_busy() { assert_lock_skip deploy $'maintenance\ndeploy'; }

deploy_lock_default() {
  # Check the default without opening /opt/sep/.deploy.lock on the test host.
  assert_contains "$SCRIPT" '${SEP_DEPLOY_LOCK_FILE:-/opt/sep/.deploy.lock}'
}

PASSED=0
FAILED=0
run_test() {
  local name="$1" result
  # A subshell gives each case fail-fast assertions without aborting the suite.
  set +e
  (
    set -Ee
    trap 'result=$?; if [[ -n "${CASE_DIR:-}" && -f "$CASE_DIR/output.log" ]]; then cat "$CASE_DIR/output.log" >&2; fi; exit "$result"' ERR
    "$name"
  )
  result=$?
  set -e
  if (( result == 0 )); then
    PASSED=$((PASSED + 1))
    printf 'PASS %s\n' "$name"
  else
    FAILED=$((FAILED + 1))
    printf 'FAIL %s\n' "$name" >&2
  fi
}

run_test normal_cleanup
run_test warning_boundary
run_test below_critical_boundary
run_test critical_boundary
run_test critical_remains
run_test custom_cache_and_journal
run_test custom_critical_storage
run_test maintenance_lock_busy
run_test deploy_lock_busy
run_test deploy_lock_default
printf 'sep-maintenance mock tests: %s passed, %s failed\n' "$PASSED" "$FAILED"
(( FAILED == 0 ))
