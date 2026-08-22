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
CADDYFILE="${SEP_CADDYFILE:-/opt/longdao/deploy/production/Caddyfile}"
CADDY_CONTAINER="${SEP_CADDY_CONTAINER:-longdao-caddy}"
LOCK_FILE="${SEP_DEPLOY_LOCK_FILE:-/opt/sep/.deploy.lock}"

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

switch_caddy_upstream() {
  local target=$1
  [[ -f "$CADDYFILE" ]] || { error "Caddyfile 不存在: $CADDYFILE"; return 1; }
  local temp backup
  temp=$(mktemp)
  backup="$CADDYFILE.blue-green.$(date +%Y%m%d%H%M%S).bak"
  sed -E "s#reverse_proxy (sep-web|sep-(blue|green)-web):3000#reverse_proxy $target:3000#" "$CADDYFILE" > "$temp"
  if ! grep -q "reverse_proxy $target:3000" "$temp"; then
    rm -f "$temp"
    error "未找到可替换的 Caddy upstream"
    return 1
  fi
  cp "$CADDYFILE" "$backup"
  mv "$temp" "$CADDYFILE"
  if ! docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile >/dev/null; then
    cp "$backup" "$CADDYFILE"
    error "Caddy 配置校验失败，已恢复旧配置"
    return 1
  fi
  docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile >/dev/null
}

stop_legacy() {
  docker stop sep-backend sep-web 2>/dev/null || true
}

stop_color() {
  local color=$1
  dc_bg stop "${color}-web" "${color}-backend" 2>/dev/null || true
}

cmd_deploy_bluegreen() {
  check_env
  ensure_state_dir
  exec 9>"$LOCK_FILE"
  flock -n 9 || { error "已有部署正在执行"; exit 1; }

  local active candidate previous target tag
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
  tag=${DEPLOY_TAG:-$(git -C "$SCRIPT_DIR/../.." rev-parse --short HEAD)}
  export DEPLOY_TAG="$tag"

  info "蓝绿发布：当前=${active}，候选=${candidate}，版本=${tag}"
  info "同步代码..."
  git -C "$SCRIPT_DIR/../.." fetch origin main
  git -C "$SCRIPT_DIR/../.." merge --ff-only origin/main

  info "构建候选后端和前端镜像..."
  dc_bg build "${candidate}-backend" "${candidate}-web"

  info "执行数据库迁移..."
  dc up --no-deps sep-migrate
  local migration_exit
  migration_exit=$(docker inspect --format='{{.State.ExitCode}}' sep-migrate 2>/dev/null || echo 1)
  [[ "$migration_exit" == "0" ]] || { error "数据库迁移失败"; docker logs --tail=80 sep-migrate; exit 1; }

  info "启动候选环境..."
  dc_bg up -d --force-recreate "${candidate}-backend" "${candidate}-web"
  wait_service_healthy "sep-${candidate}-backend"
  wait_service_healthy "sep-${candidate}-web"

  info "切换 Caddy 到 ${target}..."
  printf '%s\n' "$active" > "$STATE_DIR/previous-target"
  switch_caddy_upstream "$target"
  printf '%s\n' "$target" > "$ACTIVE_COLOR_FILE"

  if [[ "$active" == "legacy" ]]; then
    sleep "${SEP_DRAIN_SECONDS:-15}"
    stop_legacy
  elif [[ "$active" == sep-blue-web || "$active" == sep-green-web ]]; then
    sleep "${SEP_DRAIN_SECONDS:-15}"
    stop_color "${active#sep-}" 2>/dev/null || true
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
  else
    previous_color=${previous#sep-}
    dc_bg up -d "${previous_color}-backend" "${previous_color}-web"
    wait_service_healthy "sep-${previous_color}-backend"
    wait_service_healthy "sep-${previous_color}-web"
  fi
  switch_caddy_upstream "$previous"
  printf '%s\n' "$previous" > "$ACTIVE_COLOR_FILE"
  printf '%s\n' "$active" > "$STATE_DIR/previous-target"
  success "已回滚到 ${previous}"
}

# -- deploy-web ---------------------------------------------------------------
# 只重建并重启前端，最常用（改了前端代码/配置后）
cmd_deploy_web() {
  check_env
  info "拉取最新代码..."
  git -C "$SCRIPT_DIR/../.." pull origin main

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
  info "拉取最新代码..."
  git -C "$SCRIPT_DIR/../.." pull origin main

  info "重建 sep-backend 镜像..."
  dc build --no-cache sep-backend

  info "运行数据库迁移..."
  # 使用 up 替代 run，设置超时并检查退出状态
  dc up --no-deps sep-migrate

  # 等待迁移容器退出（最多60秒）
  for i in $(seq 1 12); do
    status=$(docker inspect --format='{{.State.Status}}' sep-migrate 2>/dev/null || echo "missing")
    [[ "$status" == "exited" ]] && break
    sleep 5
  done

  local exit_code
  exit_code=$(docker inspect --format='{{.State.ExitCode}}' sep-migrate 2>/dev/null || echo "1")
  if [[ "$exit_code" != "0" ]]; then
    warn "数据库迁移非零退出码（$exit_code），检查是否已是最新"
    docker logs --tail=30 sep-migrate 2>&1 | sed 's/^/  /'
  else
    success "数据库迁移完成"
  fi

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

  warn "⚠️  全量部署将重建并重启所有容器，确认继续? [y/N] "
  read -r confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { info "已取消"; exit 0; }

  info "拉取最新代码..."
  git -C "$SCRIPT_DIR/../.." pull origin main

  info "构建所有镜像..."
  dc build --no-cache sep-backend sep-web

  info "运行数据库迁移..."
  dc up --no-deps sep-migrate
  # 等迁移完成
  for i in $(seq 1 12); do
    status=$(docker inspect --format='{{.State.Status}}' sep-migrate 2>/dev/null || echo "missing")
    [[ "$status" == "exited" ]] && break
    sleep 5
  done
  local exit_code
  exit_code=$(docker inspect --format='{{.State.ExitCode}}' sep-migrate 2>/dev/null || echo "1")
  if [[ "$exit_code" != "0" ]]; then
    error "数据库迁移失败（exit code $exit_code），终止部署"
    docker logs --tail=30 sep-migrate 2>&1 | sed 's/^/  /'
    exit 1
  fi
  success "数据库迁移完成"

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
