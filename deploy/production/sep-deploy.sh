#!/usr/bin/env bash
# =============================================================================
# sep-deploy.sh — SEP 生产部署脚本
# 用法: ./sep-deploy.sh <command> [options]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="/opt/sep/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# docker compose 统一入口，始终带 --env-file
dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
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
  dc run --no-deps --rm sep-migrate || warn "迁移失败或已是最新，继续..."

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
  *)               usage; exit 1 ;;
esac
