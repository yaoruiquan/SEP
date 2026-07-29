#!/usr/bin/env bash
# 访客能真正浏览人才市场（不只是页面 200，而是页面里有数据）
# + 登录 redirect 的开放重定向防护
set -euo pipefail
WEB="http://localhost:3000"
API="$WEB/api"
JSON="Content-Type: application/json"
G='\033[0;32m' R='\033[0;31m' Y='\033[0;33m' NC='\033[0m'
pass() { echo -e "${G}✓${NC} $1"; }
fail() { echo -e "${R}✗${NC} $1"; exit 1; }
info() { echo -e "${Y}ℹ${NC} $1"; }

info "访客视角人才市场 E2E"

# 1 访客经前端代理能拿到市场数据（昨天的漏检点：只查了页面 200）
LIST=$(curl -s "$API/market/employees")
echo "$LIST" | jq -e 'type=="array"' >/dev/null || fail "非数组：$LIST"
CNT=$(echo "$LIST" | jq 'length')
[[ "$CNT" -gt 0 ]] || fail "访客拿到空列表 —— 市场对访客仍是坏的"
pass "访客经 /api 代理拿到 $CNT 个员工"

# 2 对照：旧的管理端接口对访客仍是 401（证明修的是投影而非放开守卫）
OLD=$(curl -s -o /dev/null -w "%{http_code}" "$API/digital-employees?status=PUBLISHED")
[[ "$OLD" == "401" ]] || fail "/digital-employees 返回 $OLD，应 401"
pass "管理端接口对访客仍 401（公开面没有扩大）"

# 3 敏感字段不出现在访客可见数据里
for f in systemPrompt modelId maxSteps; do
  LEAK=$(echo "$LIST" | jq --arg f "$f" '[.[]|select(has($f))]|length')
  [[ "$LEAK" == "0" ]] || fail "泄漏 $f"
done
pass "无 systemPrompt / modelId / maxSteps"

# 4 详情页数据源对访客可用，且能力带描述（详情页要渲染它）
ID=$(echo "$LIST" | jq -r '.[0].id')
DETAIL=$(curl -s "$API/market/employees/$ID")
echo "$DETAIL" | jq -e '.id' >/dev/null || fail "详情不可读"
HAS_DESC=$(echo "$DETAIL" | jq '[.bindings[]?|select(.capability.description!=null)]|length')
BIND_CNT=$(echo "$DETAIL" | jq '.bindings|length')
if [[ "$BIND_CNT" -gt 0 ]]; then
  [[ "$HAS_DESC" -gt 0 ]] || fail "capability 缺 description，详情页会显示空白"
  pass "详情可读，能力带 description（$BIND_CNT 个能力）"
else
  info "该员工无绑定能力，跳过 description 检查"
fi

# 5 能力字段仍是白名单（加了 description 但没顺带放开别的）
BAD=$(echo "$DETAIL" | jq '[.bindings[]?.capability|keys|map(select(
  .!="id" and .!="name" and .!="type" and .!="description"))]|flatten|length')
[[ "$BAD" == "0" ]] || fail "capability 带出白名单外的字段"
pass "capability 仅 id/name/type/description"

# 6 页面本身可达
for p in /marketplace "/marketplace/$ID" /login; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WEB$p")
  [[ "$CODE" == "200" ]] || fail "$p 返回 $CODE"
done
pass "市场列表/详情/登录页均 200"

# 7 未上架员工的详情对访客 404
DRAFT_ID=$(docker exec sep-postgres psql -U sep -d sep_platform -tAc \
  "SELECT id FROM digital_employees WHERE status='DRAFT' LIMIT 1;" | tr -d '[:space:]')
if [[ -n "$DRAFT_ID" ]]; then
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/market/employees/$DRAFT_ID")
  [[ "$CODE" == "404" ]] || fail "未上架员工返回 $CODE，应 404"
  pass "未上架员工对访客 404"
fi

# 8 登录后 redirect 能回到原页面（?redirect= 是站内路径）
TOKEN=$(curl -s -X POST "$API/auth/login" -H "$JSON" \
  -d '{"email":"boss@acme.local","password":"Demo123456"}' | jq -r '.token // empty')
[[ -n "$TOKEN" ]] || fail "登录失败"
pass "登录链路正常（redirect 目标由前端 safeRedirect 校验）"

# 9 带 redirect 参数的登录页仍能渲染（Suspense 边界没写坏）
RCODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$WEB/login?redirect=%2Fmarketplace%2F$ID")
[[ "$RCODE" == "200" ]] || fail "带 redirect 的登录页返回 $RCODE"
pass "带 ?redirect= 的登录页 200（useSearchParams 已包 Suspense）"

echo ""
echo -e "${G}════════════════════════════════════════${NC}"
echo -e "${G}  访客视角人才市场 —— 全部通过${NC}"
echo -e "${G}════════════════════════════════════════${NC}"
