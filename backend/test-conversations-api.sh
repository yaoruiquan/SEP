#!/bin/bash
set -e

echo "=== 测试会话列表 API ==="
echo ""

# 1. 登录获取 token
echo "1. 登录..."
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"boss@acme.local","password":"Demo1234"}' \
  | jq -r '.token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ 登录失败"
  exit 1
fi
echo "✅ 登录成功"
echo ""

# 2. 获取会话列表
echo "2. 获取会话列表..."
RESPONSE=$(curl -s http://localhost:3001/conversations \
  -H "Authorization: Bearer $TOKEN")

echo "$RESPONSE" | jq '.'
echo ""

# 3. 检查每个会话的员工名称
echo "3. 检查员工名称..."
echo "$RESPONSE" | jq -r '.[] | "会话: \(.title // "(无标题)") - 员工: \(.employee.name)"'
echo ""

# 4. 统计不同员工的数量
UNIQUE_EMPLOYEES=$(echo "$RESPONSE" | jq -r '.[].employee.name' | sort -u | wc -l)
echo "不同员工数量: $UNIQUE_EMPLOYEES"
echo ""

if [ "$UNIQUE_EMPLOYEES" -gt 1 ]; then
  echo "✅ API 返回了多个不同的员工"
else
  echo "⚠️  API 只返回了一个员工，或数据有问题"
fi
