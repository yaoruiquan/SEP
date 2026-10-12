#!/usr/bin/env bash
# Mock-only: no daemon, network, production paths, or credentials are accessed.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
export SEP_DEPLOY_LIBRARY=true
export SEP_DEPLOY_STATE_DIR="$TMP_DIR/state"
export SEP_DEPLOY_LOCK_FILE="$TMP_DIR/lock"
export SEP_CADDYFILE="$TMP_DIR/caddy"
export SEP_CADDY_BACKUP_DIR="$TMP_DIR/backups"
source "$ROOT_DIR/deploy/production/sep-deploy.sh"
EVENTS="$TMP_DIR/events"
MOCK_DIR="$TMP_DIR/containers"
BOOT=11111111-1111-4111-8111-111111111111
NEW_BOOT=22222222-2222-4222-8222-222222222222

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
event() { printf '%s\n' "$*" >> "$EVENTS"; }
expect_failure() { if "$@"; then fail "expected failure: $*"; fi; }
no_signal() { if grep -q '^TERM ' "$EVENTS"; then fail 'unexpected stop signal'; fi; }
before() {
  local a b
  a=$(awk -v needle="$1" '$0 == needle { print NR; exit }' "$EVENTS")
  b=$(awk -v needle="$2" '$0 == needle { print NR; exit }' "$EVENTS")
  [[ -n "$a" && -n "$b" && "$a" -lt "$b" ]] || fail "order: $1 before $2"
}
container() {
  local name=$1 state=${2:-running} active=${3:-0}
  printf '%s\n' "$state" > "$MOCK_DIR/$name.state"
  printf '%s\n' "$BOOT" > "$MOCK_DIR/$name.boot"
  printf '%s\n' "$active" > "$MOCK_DIR/$name.active"
  printf '%s\n' unless-stopped > "$MOCK_DIR/$name.policy"
}
reset() {
  rm -rf "$MOCK_DIR" "$STATE_DIR"
  mkdir -p "$MOCK_DIR" "$STATE_DIR"
  : > "$EVENTS"
  SECONDS=0
  unset SEP_DRAIN_TIMEOUT_SECONDS
  SEP_DRAIN_POLL_SECONDS=1
  SEP_STOP_GRACE_SECONDS=3
  # SECONDS also advances with wall time; keep successful mock paths clear of
  # deadline jitter while fake sleep still exercises timeout paths immediately.
  MOCK_BUDGET=2000 MOCK_GRACE=1000 MOCK_TIMEOUT=10000
  MOCK_HOLD=0 MOCK_SNAPSHOT_FAIL=0 MOCK_MARKER_FAIL=0 MOCK_BOOT_CHANGE=0
  MOCK_STOP_FAIL=0 MOCK_READINESS_FAIL=0 MOCK_DAEMON_FAIL=0 MOCK_INSPECT_FAIL=0
  MOCK_OBSERVE_FAIL=0 MOCK_SWITCH_FAIL=0
  MOCK_START_FAIL= MOCK_HEALTH_FAIL= MOCK_WEB_READY_FAIL=0 MOCK_RESUME_FAIL=0
  MOCK_RESTORE_POLICY_FAIL= MOCK_READINESS_ACTIVE=0
  container sep-blue-backend running 2
  container sep-blue-web
  container sep-green-backend exited
  container sep-green-web exited
  container sep-backend exited
  container sep-web exited
  printf '%s\n' sep-blue-web > "$ACTIVE_COLOR_FILE"
  printf '%s\n' sep-green-web > "$STATE_DIR/previous-target"
}

# Persist mock state in files: probes are called inside shell substitutions.
docker() {
  local operation=$1 name code state boot active marker policy
  shift
  case "$operation" in
    info) [[ "$MOCK_DAEMON_FAIL" == 0 ]] ;;
    container)
      [[ "$MOCK_DAEMON_FAIL" == 0 ]] || return 1
      for name in "$MOCK_DIR"/*.state; do basename "${name%.state}"; done
      ;;
    inspect)
      code=$1 name=$2
      [[ "$MOCK_DAEMON_FAIL" == 0 && "$MOCK_INSPECT_FAIL" == 0 && -f "$MOCK_DIR/$name.state" ]] || return 1
      case "$code" in
        *State.Status*) cat "$MOCK_DIR/$name.state" ;;
        *State.Health.Status*)
          if [[ "$MOCK_HEALTH_FAIL" == "$name" ]]; then echo unhealthy; else echo healthy; fi
          ;;
        *RestartPolicy.Name*) cat "$MOCK_DIR/$name.policy" ;;
        *) fail "unsupported inspect: $code" ;;
      esac
      ;;
    update)
      policy=${1#--restart=} name=$2
      event "policy $name $policy"
      [[ "$policy" == no || "$MOCK_RESTORE_POLICY_FAIL" != "$name" ]] || return 1
      printf '%s\n' "$policy" > "$MOCK_DIR/$name.policy"
      ;;
    kill)
      [[ "$1" == --signal=SIGTERM ]] || fail 'only SIGTERM is permitted'
      name=$2
      [[ "$(cat "$MOCK_DIR/$name.policy")" == no ]] || fail 'restart policy must be disabled before TERM'
      event "TERM $name"
      if [[ "$MOCK_STOP_FAIL" == 0 ]]; then printf '%s\n' exited > "$MOCK_DIR/$name.state"; fi
      ;;
    start)
      name=$1
      event "start $name"
      [[ "$MOCK_START_FAIL" != "$name" ]] || return 1
      printf '%s\n' running > "$MOCK_DIR/$name.state"
      printf '%s\n' "$NEW_BOOT" > "$MOCK_DIR/$name.boot"
      ;;
    exec)
      if [[ "$1" == --user ]]; then [[ "$2" == node ]] || fail 'control must use node user'; shift 2; fi
      name=$1
      [[ "$2" == node && "$3" == -e ]] || fail "unsupported exec: $*"
      code=$4
      shift 4
      case "$code" in
        *activeGatewayRequests*)
          [[ "$code" == *'3001/health"'* ]] || fail 'poll must use unthrottled liveness'
          [[ "$MOCK_SNAPSHOT_FAIL" == 0 ]] || return 1
          boot=$(cat "$MOCK_DIR/$name.boot")
          active=$(cat "$MOCK_DIR/$name.active")
          state=ready
          marker=0
          if [[ -f "$MOCK_DIR/$name.marker" && "$(cat "$MOCK_DIR/$name.marker")" == "$boot" ]]; then
            state=draining marker=1
            [[ "$MOCK_BOOT_CHANGE" == 0 ]] || boot=$NEW_BOOT
            event "poll $name $active"
            if [[ "$MOCK_HOLD" == 0 && "$active" -gt 0 ]]; then printf '%s\n' "$((active - 1))" > "$MOCK_DIR/$name.active"; fi
          fi
          printf '%s %s %s %s %s %s %s\n' "$boot" "$state" "$marker" "$active" "$MOCK_BUDGET" "$MOCK_GRACE" "$MOCK_TIMEOUT"
          ;;
        *renameSync*)
          [[ "$MOCK_MARKER_FAIL" == 0 ]] || return 1
          event "mark $name"
          printf '%s\n' "$1" > "$MOCK_DIR/$name.marker"
          ;;
        *unlinkSync*)
          event "resume $name"
          [[ "$MOCK_RESUME_FAIL" == 0 ]] || return 1
          [[ "$(cat "$MOCK_DIR/$name.marker")" == "$1" ]] || return 1
          rm "$MOCK_DIR/$name.marker"
          ;;
        *health/ready*)
          event "ready $name"
          if [[ -f "$MOCK_DIR/$name.marker" && "$(cat "$MOCK_DIR/$name.marker")" == "$(cat "$MOCK_DIR/$name.boot")" ]]; then
            fail 'readiness cannot pass with current drain marker'
          fi
          if [[ "$MOCK_READINESS_FAIL" != 0 ]]; then
            printf '%s\n' "$MOCK_READINESS_ACTIVE" > "$MOCK_DIR/$name.active"
            MOCK_HOLD=1
          fi
          [[ "$MOCK_READINESS_FAIL" == 0 ]] || return 1
          ;;
        *UPLOAD_LOCAL_DIR*) event "upload $name" ;;
        *3000/*) event "web-ready $name"; [[ "$MOCK_WEB_READY_FAIL" == 0 ]] ;;
        *) fail 'unexpected node operation' ;;
      esac
      ;;
    compose)
      code="$*"
      if [[ "$code" == *' config --services'* ]]; then echo blue-backend; echo blue-web
      elif [[ "$code" == *' up -d --force-recreate '* ]]; then
        name=${@: -2:1}
        name=${name%-backend}
        event "compose-up $name"
        container "sep-$name-backend"
        container "sep-$name-web"
      elif [[ "$code" == *' build '* ]]; then event compose-build
      else fail "unsupported compose: $code"; fi
      ;;
    ps) event status ;;
    logs) event "logs $*" ;;
    *) fail "unexpected Docker operation: $operation $*" ;;
  esac
}
sleep() { SECONDS=$((SECONDS + $1)); }
flock() { return 0; }
# Release orchestration uses real drain/stop/readiness functions; unrelated
# revision/build/migration/Caddy work is stubbed and recorded, never executed.
check_env() { return 0; }
prepare_deploy_revision() { DEPLOY_TAG=test; }
prune_build_cache() { return 0; }
ensure_upload_volume_permissions() { return 0; }
run_migrations() { event migrate; }
switch_caddy_upstream() { event "switch $1"; [[ "$MOCK_SWITCH_FAIL" == 0 ]]; }
observe_candidate() { event "observe $1"; [[ "$MOCK_OBSERVE_FAIL" == 0 ]]; }

reset
retire_target sep-blue-web
before 'mark sep-blue-backend' 'poll sep-blue-backend 2'
before 'poll sep-blue-backend 0' 'TERM sep-blue-backend'
before 'TERM sep-blue-backend' 'TERM sep-blue-web'
[[ "$(cat "$MOCK_DIR/sep-blue-backend.state")" == exited ]] || fail 'backend not stopped'
[[ "$(cat "$STATE_DIR/sep-blue-backend.restart-policy")" == unless-stopped ]] || fail 'policy not saved'

reset
MOCK_HOLD=1
expect_failure retire_target sep-blue-web
no_signal
[[ -f "$MOCK_DIR/sep-blue-backend.marker" ]] || fail 'timeout must retain drain marker'
[[ "$(cat "$MOCK_DIR/sep-blue-web.state")" == running ]] || fail 'timeout must retain old Web'

reset
SEP_DRAIN_TIMEOUT_SECONDS=2
expect_failure drain_gateway sep-blue-backend
[[ ! -f "$MOCK_DIR/sep-blue-backend.marker" ]] || fail 'invalid budget must not mutate control'
no_signal

reset
MOCK_BUDGET=1200000 MOCK_GRACE=45000 MOCK_TIMEOUT=1245000
SEP_DRAIN_TIMEOUT_SECONDS=1245
drain_gateway sep-blue-backend
reset
MOCK_BUDGET=1200000 MOCK_GRACE=45000 MOCK_TIMEOUT=1245000
SEP_DRAIN_TIMEOUT_SECONDS=630
expect_failure drain_gateway sep-blue-backend
no_signal

for fault in MOCK_SNAPSHOT_FAIL MOCK_MARKER_FAIL MOCK_BOOT_CHANGE; do
  reset
  printf -v "$fault" '%s' 1
  expect_failure retire_target sep-blue-web
  no_signal
done

reset
MOCK_STOP_FAIL=1
expect_failure retire_target sep-blue-web
[[ "$(cat "$MOCK_DIR/sep-blue-backend.state")" == running ]] || fail 'stop timeout must retain container'
[[ "$(cat "$MOCK_DIR/sep-blue-backend.policy")" == no ]] || fail 'timed out process must not auto-restart'
if grep -q '^TERM sep-blue-web$' "$EVENTS"; then fail 'Web must remain on backend stop failure'; fi

reset
expect_failure assert_target_inactive sep-blue-web
assert_target_inactive sep-green-web
MOCK_DAEMON_FAIL=1
expect_failure assert_target_inactive sep-green-web
reset
MOCK_INSPECT_FAIL=1
expect_failure assert_target_inactive sep-green-web
reset
rm "$MOCK_DIR/sep-backend.state" "$MOCK_DIR/sep-web.state"
retire_target legacy
no_signal

reset
MOCK_READINESS_FAIL=1
expect_failure check_service_readiness blue
if grep -q '^web-ready ' "$EVENTS"; then fail 'backend readiness failure must propagate'; fi

reset
cmd_rollback_bluegreen
before 'start sep-green-backend' 'switch sep-green-web'
before 'switch sep-green-web' 'mark sep-blue-backend'
before 'poll sep-blue-backend 0' 'TERM sep-blue-backend'
if grep -q '^compose-' "$EVENTS"; then fail 'rollback must use retained image, not recreate'; fi
[[ "$(cat "$ACTIVE_COLOR_FILE")" == sep-green-web ]] || fail 'rollback active target'
reset
MOCK_HOLD=1
expect_failure cmd_rollback_bluegreen
before 'switch sep-green-web' 'mark sep-blue-backend'
no_signal
reset
MOCK_SWITCH_FAIL=1
expect_failure cmd_rollback_bluegreen
no_signal

for role in all sep-backend sep-web; do
  reset
  cmd_restart "$role"
  before 'poll sep-blue-backend 0' "TERM $([[ "$role" == sep-web ]] && echo sep-blue-web || echo sep-blue-backend)"
  [[ "$(cat "$MOCK_DIR/sep-blue-backend.policy")" == unless-stopped ]] || fail 'restart must restore policy'
  [[ "$(cat "$MOCK_DIR/sep-blue-web.policy")" == unless-stopped ]] || fail 'restart must restore Web policy'
  if [[ "$role" == sep-web ]]; then
    before 'TERM sep-blue-web' 'resume sep-blue-backend'
    if grep -q '^TERM sep-blue-backend$' "$EVENTS"; then fail 'Web-only restart must not stop backend'; fi
    if grep -q '^start sep-blue-backend$' "$EVENTS"; then fail 'Web-only restart must not start running backend'; fi
  elif [[ "$role" == sep-backend ]]; then
    if grep -Eq '^(TERM|start) sep-blue-web$' "$EVENTS"; then fail 'backend-only restart must leave running Web alone'; fi
  fi
  reset
  MOCK_HOLD=1
  expect_failure cmd_restart "$role"
  no_signal
done

# Recovery validates the pair; it starts a stopped partner without TERMing it.
for role in sep-web sep-backend; do
  reset
  partner=sep-blue-web
  [[ "$role" != sep-web ]] || partner=sep-blue-backend
  printf '%s\n' exited > "$MOCK_DIR/$partner.state"
  cmd_restart "$role"
  before "start $partner" 'ready sep-blue-backend'
  if grep -q "^TERM $partner$" "$EVENTS"; then fail 'stopped partner must not receive TERM'; fi
done

# All recovery failures retain/fence the current boot and never force a stop.
for role in sep-web sep-backend; do
  for fault in readiness web-readiness start health resume policy; do
    reset
    case "$fault" in
      readiness) MOCK_READINESS_FAIL=1 MOCK_READINESS_ACTIVE=1 ;;
      web-readiness) MOCK_WEB_READY_FAIL=1 ;;
      start) MOCK_START_FAIL=sep-blue-web ;;
      health) MOCK_HEALTH_FAIL=sep-blue-web ;;
      resume) MOCK_RESUME_FAIL=1 ;;
      policy)
        MOCK_RESTORE_POLICY_FAIL=sep-blue-backend
        [[ "$role" != sep-web ]] || MOCK_RESTORE_POLICY_FAIL=sep-blue-web
        ;;
    esac
    # A new backend boot ignores old markers; unlink faults apply to the
    # same-boot Web-only path. Start faults need a stopped Web partner.
    if [[ "$role" == sep-backend && "$fault" == start ]]; then
      printf '%s\n' exited > "$MOCK_DIR/sep-blue-web.state"
    elif [[ "$role" == sep-backend && "$fault" == resume ]]; then
      continue
    fi
    expect_failure cmd_restart "$role"
    [[ "$(cat "$MOCK_DIR/sep-blue-backend.marker")" == "$(cat "$MOCK_DIR/sep-blue-backend.boot")" ]] || fail "$role/$fault must fence current boot"
    [[ "$(gateway_snapshot sep-blue-backend)" == *' draining 1 '* ]] || fail "$role/$fault must report draining"
    partner=sep-blue-web
    [[ "$role" != sep-web ]] || partner=sep-blue-backend
    if grep -q "^TERM $partner$" "$EVENTS"; then fail "$role/$fault must not stop partner"; fi
    [[ "$(awk '/^TERM / {n++} END {print n+0}' "$EVENTS")" == 1 ]] || fail 'recovery failure must not send extra signals'
    if [[ "$fault" == readiness ]]; then
      [[ "$(cat "$MOCK_DIR/sep-blue-backend.active")" == 1 ]] || fail 'recovery must retain admitted request count'
      if grep -q '^policy .* unless-stopped$' "$EVENTS"; then fail 'readiness failure must not restore restart policy'; fi
    fi
  done
done

# An old image without lifecycle fields makes the snapshot validator fail.
# The command must not claim rollback support or switch to that started image.
reset
MOCK_SNAPSHOT_FAIL=1
expect_failure cmd_rollback_bluegreen
no_signal
if grep -q '^switch ' "$EVENTS"; then fail 'unreadable old lifecycle must block rollback switch'; fi
[[ "$(cat "$ACTIVE_COLOR_FILE")" == sep-blue-web ]] || fail 'failed legacy rollback must retain active target'
[[ "$(cat "$MOCK_DIR/sep-green-backend.state")" == running ]] || fail 'failed legacy rollback must preserve started container'
reset
expect_failure cmd_restart postgres
no_signal

reset
cmd_stop
before 'poll sep-blue-backend 0' 'TERM sep-blue-backend'
reset
MOCK_HOLD=1
expect_failure cmd_stop
no_signal

for command in cmd_deploy cmd_deploy_web cmd_deploy_backend cmd_deploy_bluegreen; do
  reset
  "$command"
  before 'switch sep-green-web' 'mark sep-blue-backend'
  before 'poll sep-blue-backend 0' 'TERM sep-blue-backend'
  reset
  MOCK_HOLD=1
  expect_failure "$command"
  no_signal
  [[ "$(cat "$ACTIVE_COLOR_FILE")" == sep-green-web ]] || fail 'drain failure must retain switched target'
done
reset
MOCK_OBSERVE_FAIL=1
expect_failure cmd_deploy_bluegreen
before 'switch sep-blue-web' 'mark sep-green-backend'
before 'poll sep-green-backend 0' 'TERM sep-green-backend'
reset
container sep-green-backend running
expect_failure cmd_deploy_bluegreen
if grep -q '^compose-' "$EVENTS"; then fail 'must not recreate retained running candidate'; fi

printf '%s\n' 'sep-drain mock tests passed (drain, TERM-only, readiness, rollback, restart, deployment aliases)'
