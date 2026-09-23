#!/usr/bin/env bash
# Mock-only regression tests for sep-deploy.sh.
# No Docker daemon, compose project, network, or production path is touched.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export SEP_DEPLOY_LIBRARY=true
export SEP_DEPLOY_STATE_DIR="$TMP_DIR/state"
export SEP_CADDYFILE="$TMP_DIR/sep.caddy"
export SEP_CADDY_BACKUP_DIR="$TMP_DIR/backups"
export SEP_CADDY_CONTAINER=mock-caddy
export MOCK_UPSTREAM_FILE="$TMP_DIR/upstreams"

mkdir -p "$TMP_DIR/bin" "$SEP_DEPLOY_STATE_DIR"
printf '%s\n' \
  'your.example {' \
  '    @sep_ws path /ws/*' \
  '    reverse_proxy @sep_ws sep-backend:3001' \
  '    reverse_proxy sep-web:3000' \
  '}' > "$SEP_CADDYFILE"

cat > "$TMP_DIR/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == exec ]]; then
  shift
  shift
  case "${1:-}" in
    caddy)
      case "${2:-}" in
        validate) exit 0 ;;
        reload)
          if [[ "${MOCK_RELOAD_FAIL_ONCE:-0}" == 1 && ! -f "${MOCK_RELOAD_MARKER}" ]]; then
            : > "$MOCK_RELOAD_MARKER"
            exit 1
          fi
          exit 0
          ;;
      esac
      ;;
    wget)
      if [[ "$*" == *"health/ready"* || "$*" == *"http://127.0.0.1:3000/"* ]]; then
        printf '%s\n' '{"status":"ok"}'
      else
        cat "$MOCK_UPSTREAM_FILE"
      fi
      ;;
    node)
      if [[ "${MOCK_EXPECT_READINESS:-0}" == 1 && "${1:-}" == *"127.0.0.1:3001"* ]]; then
        [[ "$*" == *"127.0.0.1:3001/api/health/ready"* ]]
      fi
      exit 0
      ;;
  esac
  exit 0
fi

if [[ "${1:-}" == inspect ]]; then
  printf '%s\n' healthy
  exit 0
fi

if [[ "${1:-}" == logs ]]; then
  exit 0
fi

exit 0
MOCK_DOCKER
chmod +x "$TMP_DIR/bin/docker"
export MOCK_RELOAD_MARKER="$TMP_DIR/reload-failed"
export PATH="$TMP_DIR/bin:$PATH"

# Source function definitions only; the script's command dispatcher is disabled
# by SEP_DEPLOY_LIBRARY=true.
# shellcheck source=sep-deploy.sh
source "$ROOT_DIR/deploy/production/sep-deploy.sh"

[[ "$(color_target blue)" == sep-blue-web ]]
[[ "$(target_color sep-green-web)" == green ]]
[[ "$(target_backend sep-green-web)" == sep-green-backend ]]

printf '%s\n' '[{"dial":"sep-green-backend:3001"},{"dial":"sep-green-web:3000"}]' > "$MOCK_UPSTREAM_FILE"
switch_caddy_upstream sep-green-web
grep -Fq 'reverse_proxy @sep_ws sep-green-backend:3001' "$SEP_CADDYFILE"
grep -Fq 'reverse_proxy sep-green-web:3000' "$SEP_CADDYFILE"

# A failed reload must restore both upstreams from the backup and report failure.
printf '%s\n' '[{"dial":"sep-blue-backend:3001"},{"dial":"sep-blue-web:3000"}]' > "$MOCK_UPSTREAM_FILE"
export MOCK_RELOAD_FAIL_ONCE=1
if switch_caddy_upstream sep-blue-web; then
  printf '%s\n' 'expected Caddy reload failure' >&2
  exit 1
fi
grep -Fq 'reverse_proxy @sep_ws sep-green-backend:3001' "$SEP_CADDYFILE"
grep -Fq 'reverse_proxy sep-green-web:3000' "$SEP_CADDYFILE"

export SEP_POST_DEPLOY_CHECKS=1
export SEP_POST_DEPLOY_INTERVAL_SECONDS=0
export MOCK_EXPECT_READINESS=1
check_service_readiness blue
observe_candidate blue

printf '%s\n' 'sep-deploy mock tests passed'
