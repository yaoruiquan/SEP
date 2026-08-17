#!/bin/bash

# E2E 测试脚本：P2 计算配额系统
# 完整验证：登录 → 查询配额 → 创建会话 → 发送消息 → 验证扣费

set -e

API_BASE="http://localhost:3001"
EMAIL="boss@acme.local"
PASSWORD="Demo123456"

echo "🧪 P2 计算配额系统 E2E 测试"
echo "================================"
echo ""

# 1. 登录获取 token
echo "1️⃣  登录 ${EMAIL}..."
LOGIN_RESPONSE=$(curl -s -X POST "${API_BASE}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ 登录失败"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo "✅ 登录成功，token: ${TOKEN:0:20}..."
echo ""

# 2. 查询初始配额
echo "2️⃣  查询初始配额..."
QUOTA_RESPONSE=$(curl -s -X GET "${API_BASE}/compute-quota" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$QUOTA_RESPONSE" | jq '.'
echo ""

# 提取免费配额 ID 和初始使用量
FREE_QUOTA_ID=$(echo "$QUOTA_RESPONSE" | jq -r '.[] | select(.type=="FREE") | .id')
INITIAL_USED=$(echo "$QUOTA_RESPONSE" | jq '.[] | select(.type=="FREE") | .usedTokens')

echo "📊 免费配额 ID: ${FREE_QUOTA_ID}"
echo "📊 初始已用: ${INITIAL_USED} tokens"
echo ""

# 3. 查询可用员工
echo "3️⃣  查询企业订阅..."
SUBSCRIPTIONS_RESPONSE=$(curl -s -X GET "${API_BASE}/subscriptions" \
  -H "Authorization: Bearer ${TOKEN}")

EMPLOYEE_ID=$(echo "$SUBSCRIPTIONS_RESPONSE" | jq -r '.[0].employeeId')

if [ -z "$EMPLOYEE_ID" ] || [ "$EMPLOYEE_ID" = "null" ]; then
  echo "❌ 未找到活跃订阅"
  exit 1
fi

echo "✅ 使用已订阅员工: ${EMPLOYEE_ID}"
echo ""

# 4. 创建会话（触发配额前置检查）
echo "4️⃣  创建会话（触发配额检查）..."
SESSION_RESPONSE=$(curl -s -X POST "${API_BASE}/conversations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"employeeId\":\"${EMPLOYEE_ID}\"}")

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.id')

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo "❌ 创建会话失败（可能配额不足）"
  echo "$SESSION_RESPONSE"
  exit 1
fi

echo "✅ 会话创建成功: ${SESSION_ID}"
echo ""

# 5. 发送消息（触发 AI 对话和配额消费）
echo "5️⃣  发送消息触发 AI 对话..."
MESSAGE_RESPONSE=$(curl -s -X POST "${API_BASE}/conversations/${SESSION_ID}/messages" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"content":"你好，请用一句话介绍你自己"}')

echo "$MESSAGE_RESPONSE" | head -50
echo ""

# 等待 AI 响应完成
echo "⏳ 等待 AI 响应和计费..."
sleep 5
echo ""

# 6. 再次查询配额（验证扣费）
echo "6️⃣  查询扣费后的配额..."
QUOTA_AFTER=$(curl -s -X GET "${API_BASE}/compute-quota" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$QUOTA_AFTER" | jq '.'
echo ""

AFTER_USED=$(echo "$QUOTA_AFTER" | jq '.[] | select(.type=="FREE") | .usedTokens')
CONSUMED=$((AFTER_USED - INITIAL_USED))

echo "📊 扣费前已用: ${INITIAL_USED} tokens"
echo "📊 扣费后已用: ${AFTER_USED} tokens"
echo "📊 本次消费: ${CONSUMED} tokens"
echo ""

# 7. 查询配额详情（验证交易记录）
echo "7️⃣  查询配额详情（交易记录）..."
QUOTA_DETAIL=$(curl -s -X GET "${API_BASE}/compute-quota/${FREE_QUOTA_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$QUOTA_DETAIL" | jq '.transactions | .[0:2]'
echo ""

# 8. 验证结果
echo "================================"
echo "📋 测试结果汇总"
echo "================================"

if [ "$CONSUMED" -gt 0 ]; then
  echo "✅ 配额消费正常: 本次对话消耗 ${CONSUMED} tokens"
else
  echo "⚠️  配额未扣费或扣费延迟"
fi

# 检查交易记录是否包含 quotaId 和 tokens
HAS_QUOTA_ID=$(echo "$QUOTA_DETAIL" | jq '.transactions | .[0].quotaId' | grep -v null || echo "")
HAS_TOKENS=$(echo "$QUOTA_DETAIL" | jq '.transactions | .[0].tokens' | grep -v null || echo "")

if [ -n "$HAS_QUOTA_ID" ]; then
  echo "✅ 交易记录包含 quotaId"
else
  echo "❌ 交易记录缺少 quotaId"
fi

if [ -n "$HAS_TOKENS" ]; then
  echo "✅ 交易记录包含 tokens"
else
  echo "❌ 交易记录缺少 tokens"
fi

echo ""
echo "✅ E2E 测试完成"
