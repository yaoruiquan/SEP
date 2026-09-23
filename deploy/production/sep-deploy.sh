#!/usr/bin/env bash
# =============================================================================
# sep-deploy.sh — SEP 生产部署脚本
# 用法: ./sep-deploy.sh <command> [options]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="/opt/sep/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
BLUE_GREEN_COMPOSE_FILE="$SCRIPT_DIR/docker-compose.blue-green.yml"
STATE_DIR="${SEP_DEPLOY_STATE_DIR:-/opt/sep/.deploy}"
ACTIVE_COLOR_FILE="$STATE_DIR/active-color"
# SEP 的站点配置已从龙道主 Caddyfile 拆出来单独成文件（主 Caddyfile 用 import 引入），
# 两个应用的发布流程不再改同一个文件。
CADDYFILE="${SEP_CADDYFILE:-/opt/longdao/deploy/production/conf.d/sep.caddy}"
CADDY_CONTAINER="${SEP_CADDY_CONTAINER:-longdao-caddy}"
# 切换前的配置备份放在 SEP 自己的目录，不要落在龙道仓库里 ——
# 那边 build_production_image.sh 有干净工作区检查（REL-002），多一个文件就构建失败。
CADDY_BACKUP_DIR="${SEP_CADDY_BACKUP_DIR:-/opt/sep/backups/caddy}"
LOCK_FILE="${SEP_DEPLOY_LOCK_FILE:-/opt/sep/.deploy.lock}"
SHARED_NETWORK="${SEP_SHARED_NETWORK:-longdao-network}"

# docker compose 统一入口，始终带 --env-file
dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

dc_bg() {
  docker compose --project-name sep-blue-green --env-file "$ENV_FILE" -f "$BLUE_GREEN_COMPOSE_FILE" "$@"
}

# ── 颜色输出 ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[SEP]${NC} $*"; }
success() { echo -e "${GREEN}[SEP]${NC} $*"; }
warn()    { echo -e "${YELLOW}[SEP]${NC} $*"; }
error()   { echo -e "${RED}[SEP]${NC} $*" >&2; }

# ── 前置检查 ──────────────────────────────────────────────────────────────────
check_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    error "env 文件不存在: $ENV_FILE"
    exit 1
  fi
}

# The CI runner checks out the exact GitHub SHA before invoking this script.
# Never fetch or merge inside a release command: doing so can silently build a
# newer commit than the one that passed CI.
prepare_deploy_revision() {
  local current expected
  current=$(git -C "$SCRIPT_DIR/../.." rev-parse HEAD)
  if [[ -n "${DEPLOY_SHA:-}" ]]; then
    expected=$(git -C "$SCRIPT_DIR/../.." rev-parse "${DEPLOY_SHA}^{commit}") || {
      error "DEPLOY_SHA 不是当前工作树可解析的 commit: ${DEPLOY_SHA}"
      return 1
    }
    [[ "$current" == "$expected" ]] || {
      error "当前 checkout (${current}) 与 DEPLOY_SHA (${expected}) 不一致，拒绝部署"
      return 1
    }
  fi

  DEPLOY_TAG=${DEPLOY_TAG:-${current:0:12}}
  [[ "$DEPLOY_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || {
    error "DEPLOY_TAG 只能包含字母、数字、点、下划线和连字符"
    return 1
  }
  export DEPLOY_TAG
  info "使用已检出的版本：${current}（镜像标签：${DEPLOY_TAG}）"
}

# SEP intentionally uses the existing longdao network, but it must never own
# or recreate the shared PostgreSQL/Redis/Caddy services.
check_compose_scope() {
  local services
  services=$(dc config --services)
  if grep -Eq '^(postgres|redis|caddy|sub2api|sub2api-blue|sub2api-green)$' <<<"$services"; then
    error "SEP compose 包含共享 longdao 服务，已终止部署"
    return 1
  fi

  services=$(dc_bg config --services)
  if grep -Eq '^(postgres|redis|caddy|sub2api|sub2api-blue|sub2api-green)$' <<<"$services"; then
    error "SEP 蓝绿 compose 包含共享 longdao 服务，已终止部署"
    return 1
  fi
}

env_value() {
  local key=$1
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE"
}

find_shared_container() {
  local service=$1
  docker ps --filter "network=$SHARED_NETWORK" \
    --filter "label=com.docker.compose.service=$service" \
    --format '{{.Names}}' | head -n 1
}

check_shared_infrastructure() {
  local postgres redis db_user
  docker network inspect "$SHARED_NETWORK" >/dev/null 2>&1 || {
    error "共享 Docker 网络不存在: $SHARED_NETWORK"
    return 1
  }

  postgres=$(find_shared_container postgres)
  [[ -n "$postgres" ]] || {
    error "共享 PostgreSQL 容器未运行，拒绝继续部署"
    return 1
  }
  db_user=$(env_value POSTGRES_USER)
  db_user=${db_user:-sub2api}
  docker exec "$postgres" pg_isready -U "$db_user" -d postgres >/dev/null 2>&1 || {
    error "共享 PostgreSQL 尚未接受连接（容器: $postgres），拒绝执行迁移"
    return 1
  }

  redis=$(find_shared_container redis)
  [[ -n "$redis" ]] || {
    error "共享 Redis 容器未运行，拒绝继续部署"
    return 1
  }

  info "共享基础设施已就绪：PostgreSQL=$postgres，Redis=$redis，网络=$SHARED_NETWORK"
}

run_migrations() {
  check_shared_infrastructure
  # 迁移镜像必须先重建：镜像里打包的是构建时刻的 migrations 目录，
  # 复用旧镜像会让新迁移永远不被执行，而容器仍然以 exit 0 结束（静默漏迁移）。
  info "重建迁移镜像（打包当前 migrations 目录）..."
  dc build sep-migrate
  info "执行数据库迁移（仅操作 SEP 迁移容器）..."
  dc up --no-deps --force-recreate sep-migrate
  local migration_exit
  migration_exit=$(docker inspect --format='{{.State.ExitCode}}' sep-migrate 2>/dev/null || echo 1)
  [[ "$migration_exit" == "0" ]] || {
    error "数据库迁移失败（exit code $migration_exit），终止部署"
    docker logs --tail=80 sep-migrate 2>&1 | sed 's/^/  /'
    return 1
  }
  success "数据库迁移完成"
}

# ── 等待容器健康 ──────────────────────────────────────────────────────────────
wait_healthy() {
  local container=$1
  local retries=${2:-24}   # 默认最多等 2 分钟（每 5 秒一次）
  info "等待 $container 健康..."
  for i in $(seq 1 "$retries"); do
    local status
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "missing")
    case "$status" in
      healthy) success "$container 已就绪"; return 0 ;;
      missing) warn "$container 容器不存在"; return 1 ;;
    esac
    echo -ne "  [$i/$retries] $status...\r"
    sleep 5
  done
  error "$container 未能在规定时间内变为 healthy"
  docker logs --tail=20 "$container" 2>&1 | sed 's/^/  /'
  return 1
}

# =============================================================================
# 命令实现
# =============================================================================

# -- status -------------------------------------------------------------------
cmd_status() {
  echo ""
  docker ps -a --filter "name=sep-" \
    --format "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}"
  echo ""
}

# -- logs ---------------------------------------------------------------------
cmd_logs() {
  local service="${1:-}"
  if [[ -z "$service" ]]; then
    dc logs --tail=50 -f
  else
    dc logs --tail=100 -f "$service"
  fi
}

ensure_state_dir() {
  mkdir -p "$STATE_DIR"
}

current_target() {
  if [[ -f "$ACTIVE_COLOR_FILE" ]]; then
    cat "$ACTIVE_COLOR_FILE"
  elif grep -Eq 'reverse_proxy sep-(blue|green)-web:3000' "$CADDYFILE" 2>/dev/null; then
    grep -Eo 'reverse_proxy sep-(blue|green)-web:3000' "$CADDYFILE" | head -1 | sed -E 's/^reverse_proxy (sep-(blue|green)-web):3000$/\1/'
  else
    echo "legacy"
  fi
}

color_target() {
  echo "sep-$1-web"
}

# color_target 的逆运算：sep-green-web → green。
# 状态文件里存的是完整目标名，直接 ${x#sep-} 会留下 "green-web"，
# 拼出 green-web-backend 这种不存在的服务名。
target_color() {
  local target=${1#sep-}
  echo "${target%-web}"
}

target_backend() {
  case "$1" in
    sep-blue-web) echo "sep-blue-backend" ;;
    sep-green-web) echo "sep-green-backend" ;;
    legacy|sep-web) echo "sep-backend" ;;
    *) return 1 ;;
  esac
}

wait_service_healthy() {
  local container=$1
  local retries=${2:-36}
  for i in $(seq 1 "$retries"); do
    local status
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo missing)
    [[ "$status" == healthy ]] && return 0
    [[ "$status" == unhealthy ]] && break
    sleep 5
  done
  docker logs --tail=80 "$container" 2>&1 | sed 's/^/  /'
  return 1
}

restore_caddy_backup() {
  local backup=$1
  cp "$backup" "$CADDYFILE"
  docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile >/dev/null || {
    error "恢复的 Caddy 旧配置校验失败，需要立即人工介入"
    return 1
  }
  docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile >/dev/null || {
    error "恢复 Caddy 旧配置后 reload 仍失败，需要立即人工介入"
    return 1
  }
}

verify_caddy_upstreams() {
  local web_target=$1 backend_target=$2 runtime
  runtime=$(docker exec "$CADDY_CONTAINER" wget -qO- http://127.0.0.1:2019/reverse_proxy/upstreams) || return 1
  grep -Fq "${web_target}:3000" <<<"$runtime" && grep -Fq "${backend_target}:3001" <<<"$runtime"
}

switch_caddy_upstream() {
  local web_target=$1 backend_target temp backup
  backend_target=$(target_backend "$web_target") || {
    error "不支持的 Caddy 发布目标: $web_target"
    return 1
  }
  [[ -f "$CADDYFILE" ]] || { error "Caddyfile 不存在: $CADDYFILE"; return 1; }
  temp=$(mktemp)
  mkdir -p "$CADDY_BACKUP_DIR"
  backup="$CADDY_BACKUP_DIR/$(basename "$CADDYFILE").$(date +%Y%m%d%H%M%S).bak"
  sed -E \
    -e "s#reverse_proxy (@sep_ws )?(sep-backend|sep-(blue|green)-backend):3001#reverse_proxy \\1${backend_target}:3001#" \
    -e "s#reverse_proxy (sep-web|sep-(blue|green)-web):3000#reverse_proxy ${web_target}:3000#" \
    "$CADDYFILE" > "$temp"
  if ! grep -Fq "reverse_proxy @sep_ws ${backend_target}:3001" "$temp" || \
     ! grep -Fq "reverse_proxy ${web_target}:3000" "$temp"; then
    rm -f "$temp"
    error "未找到可同时替换 Web 与 WebSocket 的 Caddy upstream"
    return 1
  fi
  cp "$CADDYFILE" "$backup"
  # 原地覆盖内容（不要 mv）：单文件 bind mount 时改名会让容器继续读旧 inode；
  # 现在 conf.d 是目录挂载，原地覆盖同样安全。
  cp "$temp" "$CADDYFILE"
  rm -f "$temp"
  if ! docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile >/dev/null; then
    if ! restore_caddy_backup "$backup"; then
      error "Caddy 配置校验失败，且旧配置恢复失败"
    fi
    error "Caddy 配置校验失败，已尝试恢复旧配置"
    return 1
  fi
  if ! docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile >/dev/null; then
    error "Caddy reload 失败，尝试恢复旧配置"
    if ! restore_caddy_backup "$backup"; then
      error "Caddy reload 失败，且旧配置恢复失败"
    fi
    return 1
  fi
  # caddy reload 内部应用失败时会回滚到旧配置，但 CLI 退出码仍是 0 —— 不能只看退出码。
  # 通过 admin API 确认 Web 和 WebSocket 都切到了同一颜色。
  if ! verify_caddy_upstreams "$web_target" "$backend_target"; then
    error "reload 后 Caddy 未同时指向 ${web_target} 与 ${backend_target}，尝试恢复旧配置"
    if ! restore_caddy_backup "$backup"; then
      error "Caddy 运行态校验失败，且旧配置恢复失败"
    fi
    return 1
  fi
}

check_service_readiness() {
  local color=$1 backend web
  if [[ "$color" == "legacy" ]]; then
    backend=sep-backend
    web=sep-web
  else
    backend="sep-${color}-backend"
    web="sep-${color}-web"
  fi

  docker exec "$backend" node -e "fetch('http://127.0.0.1:3001/api/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
  docker exec "$web" node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
}

observe_candidate() {
  local color=$1 checks=${SEP_POST_DEPLOY_CHECKS:-} interval=${SEP_POST_DEPLOY_INTERVAL_SECONDS:-}
  local i
  [[ -n "$checks" ]] || checks=$(env_value SEP_POST_DEPLOY_CHECKS)
  [[ -n "$interval" ]] || interval=$(env_value SEP_POST_DEPLOY_INTERVAL_SECONDS)
  checks=${checks:-6}
  interval=${interval:-10}
  [[ "$checks" =~ ^[1-9][0-9]*$ && "$interval" =~ ^[0-9]+$ ]] || {
    error "发布后观察参数无效：SEP_POST_DEPLOY_CHECKS=${checks}, SEP_POST_DEPLOY_INTERVAL_SECONDS=${interval}"
    return 1
  }
  info "候选 ${color} 进入发布后观察：${checks} 次，每次间隔 ${interval}s；旧环境保持运行"
  for i in $(seq 1 "$checks"); do
    if ! check_service_readiness "$color"; then
      error "候选 ${color} 在发布后观察第 ${i}/${checks} 次检查失败"
      return 1
    fi
    [[ "$i" == "$checks" ]] || sleep "$interval"
  done
}

stop_legacy() {
  docker stop sep-backend sep-web 2>/dev/null || true
}

stop_color() {
  local color=$1
  dc_bg stop "${color}-web" "${color}-backend" 2>/dev/null || true
}

# 构建失败时 BuildKit 缓存可能占满生产机磁盘，导致下一次发布在
# pnpm deploy 或 Next.js 类型检查阶段以 ENOSPC 失败。只清理未被容器
# 使用的构建缓存，不触碰运行中的容器、镜像、数据卷或共享基础设施。
prune_build_cache() {
  if [[ "${SEP_PRUNE_BUILDER_CACHE:-true}" != "true" ]]; then
    info "已跳过 Docker 构建缓存清理（SEP_PRUNE_BUILDER_CACHE != true）"
    return 0
  fi
  info "清理未使用的 Docker 构建缓存..."
  docker builder prune --all --force
}

cmd_deploy_bluegreen() {
  check_env
  check_compose_scope
  prepare_deploy_revision
  ensure_state_dir
  exec 9>"$LOCK_FILE"
  flock -n 9 || { error "已有部署正在执行"; exit 1; }

  local active candidate previous target
  active=$(current_target)
  if [[ "$active" == "sep-blue-web" ]]; then
    candidate=green
    previous=blue
  elif [[ "$active" == "sep-green-web" ]]; then
    candidate=blue
    previous=green
  else
    candidate=blue
    previous=legacy
  fi
  target=$(color_target "$candidate")

  info "蓝绿发布：当前=${active}，候选=${candidate}，版本=${DEPLOY_TAG}"

  prune_build_cache
  info "构建候选后端和前端镜像..."
  dc_bg build "${candidate}-backend" "${candidate}-web"

  run_migrations

  info "启动候选环境..."
  dc_bg up -d --force-recreate "${candidate}-backend" "${candidate}-web"
  wait_service_healthy "sep-${candidate}-backend"
  wait_service_healthy "sep-${candidate}-web"
  check_service_readiness "$candidate"

  info "切换 Caddy 到 ${target}..."
  if ! switch_caddy_upstream "$target"; then
    stop_color "$candidate" 2>/dev/null || true
    error "Caddy 切换失败，候选环境已停止，旧环境保持不变"
    return 1
  fi

  if ! observe_candidate "$candidate"; then
    error "候选观察失败，自动切回 ${active}；旧环境仍在运行"
    if [[ "$active" == "legacy" ]]; then
      if ! switch_caddy_upstream sep-web; then
        error "自动切回 legacy 失败，候选环境保持运行以便人工排障"
        return 1
      fi
    else
      if ! switch_caddy_upstream "$active"; then
        error "自动切回 ${active} 失败，候选环境保持运行以便人工排障"
        return 1
      fi
    fi
    stop_color "$candidate" 2>/dev/null || true
    return 1
  fi

  printf '%s\n' "$active" > "$STATE_DIR/previous-target"
  printf '%s\n' "$target" > "$ACTIVE_COLOR_FILE"

  # 只有候选完整通过有界观察期后，才排空并停止旧环境。
  if [[ "$active" == "legacy" ]]; then
    sleep "${SEP_DRAIN_SECONDS:-15}"
    stop_legacy
  elif [[ "$active" == sep-blue-web || "$active" == sep-green-web ]]; then
    sleep "${SEP_DRAIN_SECONDS:-15}"
    stop_color "$previous" 2>/dev/null || true
  fi
  success "蓝绿发布完成：${target}"
  cmd_status
}

cmd_rollback_bluegreen() {
  check_env
  ensure_state_dir
  exec 9>"$LOCK_FILE"
  flock -n 9 || { error "已有部署正在执行"; exit 1; }
  local active previous previous_color
  active=$(current_target)
  previous=$(cat "$STATE_DIR/previous-target" 2>/dev/null || true)
  [[ -n "$previous" && "$previous" != "$active" ]] || { error "没有可回滚版本"; exit 1; }
  if [[ "$previous" == legacy ]]; then
    docker start sep-backend sep-web >/dev/null
    wait_healthy sep-backend
    wait_healthy sep-web
    check_service_readiness legacy
  else
    previous_color=$(target_color "$previous")
    dc_bg up -d "${previous_color}-backend" "${previous_color}-web"
    wait_service_healthy "sep-${previous_color}-backend"
    wait_service_healthy "sep-${previous_color}-web"
    check_service_readiness "$previous_color"
  fi
  local previous_target
  previous_target=$([[ "$previous" == legacy ]] && echo sep-web || echo "$previous")
  switch_caddy_upstream "$previous_target" || {
    error "回滚时 Caddy 切换失败；保留当前流量与已启动的 previous 环境，需人工介入"
    return 1
  }
  printf '%s\n' "$previous" > "$ACTIVE_COLOR_FILE"
  printf '%s\n' "$active" > "$STATE_DIR/previous-target"
  success "已回滚到 ${previous}"
}

# -- deploy-web ---------------------------------------------------------------
# 只重建并重启前端，最常用（改了前端代码/配置后）
cmd_deploy_web() {
  check_env
  check_compose_scope
  prepare_deploy_revision

  info "重建 sep-web 镜像（含 build args）..."
  dc build --no-cache sep-web

  info "重启 sep-web..."
  docker restart sep-web

  success "sep-web 已更新 ✓"
  cmd_status
}

# -- deploy-backend -----------------------------------------------------------
# 只重建并重启后端（改了后端代码后）
cmd_deploy_backend() {
  check_env
  check_compose_scope
  prepare_deploy_revision

  info "重建 sep-backend 镜像..."
  dc build --no-cache sep-backend

  run_migrations

  info "重启 sep-backend（保留容器配置，不重新创建）..."
  docker stop sep-backend 2>/dev/null || true
  dc up --no-deps -d sep-backend

  wait_healthy sep-backend

  success "sep-backend 已更新 ✓"
  cmd_status
}

# -- deploy -------------------------------------------------------------------
# 全量部署：拉代码 → 构建所有镜像 → 迁移 → 启动
cmd_deploy() {
  check_env
  check_compose_scope
  prepare_deploy_revision

  if [[ "${SEP_ASSUME_YES:-false}" == "true" ]]; then
    info "已启用自动确认：仅部署 SEP 容器"
  else
    warn "⚠️  全量部署将重建并重启 SEP 容器，确认继续? [y/N] "
    read -r confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { info "已取消"; exit 0; }
  fi

  info "构建所有镜像..."
  dc build --no-cache sep-backend sep-web

  run_migrations

  info "启动 sep-backend..."
  dc up --no-deps -d sep-backend
  wait_healthy sep-backend

  info "启动 sep-web..."
  dc up --no-deps -d sep-web
  sleep 3

  success "全量部署完成 ✓"
  cmd_status
}

# -- restart ------------------------------------------------------------------
# 重启容器（不重建镜像，用于恢复崩溃的服务）
cmd_restart() {
  local service="${1:-all}"
  check_env
  case "$service" in
    all|sep-backend|sep-web) ;;
    *)
      error "只允许重启 SEP 服务：sep-backend、sep-web 或 all"
      return 1
      ;;
  esac
  if [[ "$service" == "all" ]]; then
    info "重启所有 SEP 服务..."
    docker restart sep-backend sep-web 2>/dev/null || true
    wait_healthy sep-backend
  else
    info "重启 $service..."
    docker restart "$service"
    [[ "$service" == "sep-backend" ]] && wait_healthy sep-backend
  fi
  success "重启完成 ✓"
  cmd_status
}

# =============================================================================
# 入口
# =============================================================================
usage() {
  cat <<EOF

用法: $(basename "$0") <command> [options]

命令:
  deploy           全量部署（构建所有镜像 + 迁移 + 启动）
  deploy-web       仅重建并重启前端（最常用）
  deploy-backend   仅重建并重启后端
  restart [svc]    重启容器，不重建镜像（svc 默认 all）
  status           显示所有容器状态
  logs [svc]       跟踪日志（svc 不指定则跟踪所有）

示例:
  ./sep-deploy.sh deploy-web          # 前端代码有更新
  ./sep-deploy.sh deploy-backend      # 后端代码有更新
  ./sep-deploy.sh restart sep-backend # 后端崩溃，快速重启
  ./sep-deploy.sh logs sep-web        # 查看前端日志

EOF
}

if [[ "${SEP_DEPLOY_LIBRARY:-false}" != "true" ]]; then
  case "${1:-}" in
    deploy)          cmd_deploy ;;
    deploy-web)      cmd_deploy_web ;;
    deploy-backend)  cmd_deploy_backend ;;
    restart)         cmd_restart "${2:-all}" ;;
    status)          cmd_status ;;
    logs)            cmd_logs "${2:-}" ;;
    deploy-bluegreen) cmd_deploy_bluegreen ;;
    rollback-bluegreen) cmd_rollback_bluegreen ;;
    *)               usage; exit 1 ;;
  esac
fi
