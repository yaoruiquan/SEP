#!/bin/bash
set -e

echo "=== 清理并重启前后端 ==="
echo ""

# 1. 停止所有进程
echo "1. 停止后端进程..."
pkill -f "node.*nest" || true
pkill -f "node.*next" || true
sleep 2

# 2. 清理构建缓存
echo "2. 清理前端缓存..."
cd /Users/yao/LLM/SEP/web
rm -rf .next

# 3. 重启后端
echo "3. 启动后端..."
cd /Users/yao/LLM/SEP
pnpm run dev:backend > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
echo "后端 PID: $BACKEND_PID"

# 4. 等待后端启动
echo "4. 等待后端启动..."
sleep 5

# 5. 启动前端
echo "5. 启动前端..."
cd /Users/yao/LLM/SEP/web
pnpm run dev > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "前端 PID: $FRONTEND_PID"

echo ""
echo "✅ 服务启动完成"
echo "后端: http://localhost:3001"
echo "前端: http://localhost:3000"
echo ""
echo "查看日志:"
echo "  tail -f /tmp/backend.log"
echo "  tail -f /tmp/frontend.log"
