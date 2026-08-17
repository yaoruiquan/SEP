#!/usr/bin/env bash
#
# kill-dev.sh —— 一键清理 SEP 项目所有残留的 dev 进程
#
# 背景：pnpm dev 是前台常驻命令，若直接关终端/IDE 标签（而非 Ctrl+C），
# 其子进程（nest watch、next dev、tsc/webpack worker）会变成孤儿继续空转，
# 多开几次就叠成几十个进程，把 CPU 烧满。这个脚本把它们一次性清干净。
#
# 用法：
#   pnpm kill-dev                # 推荐
#   或  bash scripts/kill-dev.sh
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PIDS=""
add() {  # $1 = pgrep 正则（匹配完整命令行）
  local found
  found="$(pgrep -f "$1" 2>/dev/null || true)"
  [ -n "$found" ] && PIDS="$PIDS $found"
}

# 记录自身进程树（脚本 + 所有祖先），避免通过 pnpm kill-dev 运行时误杀自己
EXCLUDE=" $$ "
_walk=$PPID
while [ "${_walk:-0}" -gt 1 ]; do
  EXCLUDE="$EXCLUDE $_walk "
  _walk="$(ps -o ppid= -p "$_walk" 2>/dev/null | tr -d '[:space:]')"
  [ -z "$_walk" ] && break
done

# —— 1) dev 子进程：命令行里带项目绝对路径，直接命中 ——
add "$ROOT/backend/node_modules/.bin/../@nestjs/cli/bin/nest.js start --watch"
add "$ROOT/backend/dist/main"
add "$ROOT/web/node_modules/.bin/../next/dist/bin/next dev"
add "$ROOT/node_modules/.pnpm/fork-ts-checker-webpack-plugin"
add "$ROOT/node_modules/.pnpm/jest-worker"

# —— 2) 父进程：pnpm dev / concurrently 命令行不带项目路径，按工作目录反查 ——
for _pid in $(pgrep -f 'pnpm .*dev|concurrently' 2>/dev/null || true); do
  case " $EXCLUDE " in
    *" $_pid "*) continue ;;
  esac
  _cwd="$(lsof -a -p "$_pid" -d cwd 2>/dev/null | awk 'NR>1 {print $NF}')"
  case "$_cwd" in
    "$ROOT"|"$ROOT"/*) PIDS="$PIDS $_pid" ;;
  esac
done

# 去重、去空
PIDS="$(printf '%s\n' $PIDS | sort -un | grep -v '^$' | tr '\n' ' ' | sed 's/^ *//;s/ *$//')"

if [ -z "$PIDS" ]; then
  echo "✅ 没有运行中的 SEP dev 进程，已经很干净。"
  exit 0
fi

echo "→ 将结束 PID: $PIDS"
# shellcheck disable=SC2086
kill $PIDS 2>/dev/null
sleep 2

REMAIN=""
for _p in $PIDS; do
  kill -0 "$_p" 2>/dev/null && REMAIN="$REMAIN $_p"
done
if [ -n "$REMAIN" ]; then
  echo "→ SIGTERM 未结束，改用 SIGKILL: $REMAIN"
  # shellcheck disable=SC2086
  kill -9 $REMAIN 2>/dev/null
fi

echo "✅ 清理完成。要恢复开发请重新运行一次 pnpm dev（用完记得 Ctrl+C）。"
