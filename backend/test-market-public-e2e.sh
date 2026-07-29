#!/usr/bin/env bash
# 人才市场公开接口：可访问性 + 字段投影 + 未上架不泄漏
set -euo pipefail
BASE="http://localhost:3001"
G='\033[0;32m' R='\033[0;31m' Y='\033[0;33m' NC='\033[0m'
pass() { echo -e "${G}✓${NC} $1"; }
fail() { echo -e "${R}✗${NC} $1"; exit 1; }
info() { echo -e "${Y}ℹ${NC} $1"; }

info "人才市场公开接口 E2E（全程不带 token）"

# 1 无需登录即可读列表
LIST=$(curl -s "$BASE/market/employees")
echo "$LIST" | jq -e 'type == "array"' >/dev/null || fail "列表非数组：$LIST"
CNT=$(echo "$LIST" | jq 'length')
[[ "$CNT" -gt 0 ]] || fail "列表为空，无法验证字段"
pass "无 token 可读列表（$CNT 条）"

# 2 敏感字段不得出现
for f in systemPrompt modelId maxSteps; do
  LEAK=$(echo "$LIST" | jq --arg f "$f" '[.[] | select(has($f))] | length')
  [[ "$LEAK" == "0" ]] || fail "列表泄漏敏感字段 $f"
done
pass "列表不含 systemPrompt / modelId / maxSteps"

# 3 只返回已上架
NOT_PUB=$(curl -s "$BASE/market/employees" | jq '[.[] | select(.status != null and .status != "PUBLISHED")] | length')
[[ "$NOT_PUB" == "0" ]] || fail "列表含非 PUBLISHED 员工"
# 直接按名字确认 DRAFT 员工没出现
DRAFT_LEAK=$(echo "$LIST" | jq '[.[] | select(.name == "待上架员工")] | length')
[[ "$DRAFT_LEAK" == "0" ]] || fail "DRAFT 员工「待上架员工」出现在公开列表"
pass "DRAFT 员工未出现在公开列表"

# 4 status 参数不可被调用方操纵
INJECT=$(curl -s "$BASE/market/employees?status=DRAFT" | jq '[.[] | select(.name == "待上架员工")] | length')
[[ "$INJECT" == "0" ]] || fail "传 ?status=DRAFT 竟能看到未上架员工"
pass "?status=DRAFT 无效，服务端硬编码 PUBLISHED"

# 5 详情页同样公开且字段受限
ID=$(echo "$LIST" | jq -r '.[0].id')
DETAIL=$(curl -s "$BASE/market/employees/$ID")
echo "$DETAIL" | jq -e '.id' >/dev/null || fail "详情读取失败：$DETAIL"
for f in systemPrompt modelId maxSteps; do
  echo "$DETAIL" | jq -e --arg f "$f" 'has($f)' >/dev/null && fail "详情泄漏 $f"
done
pass "详情公开可读且不含敏感字段"

# 6 bindings 只给 capability 的 id/name/type
# 白名单：加字段到公开投影时，这里和单测都必须同步改 —— 两处都是刻意的闸门
BAD_CAP=$(echo "$DETAIL" | jq '[.bindings[]?.capability | keys | map(select(
  . != "id" and . != "name" and . != "type" and . != "description"))] | flatten | length')
[[ "$BAD_CAP" == "0" ]] || fail "capability 带出了白名单外的字段"
pass "bindings 的 capability 仅 id/name/type/description"

# 7 未上架员工的详情应 404（不泄漏存在性）
DRAFT_ID=$(docker exec sep-postgres psql -U sep -d sep_platform -tAc \
  "SELECT id FROM digital_employees WHERE status='DRAFT' LIMIT 1;" | tr -d '[:space:]')
if [[ -n "$DRAFT_ID" ]]; then
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/market/employees/$DRAFT_ID")
  [[ "$CODE" == "404" ]] || fail "未上架员工详情返回 ${CODE}，期望 404"
  pass "未上架员工详情 404（不泄漏存在性）"
else
  info "库中无 DRAFT 员工，跳过第 7 项"
fi

# 8 搜索可用（中文需 URL 编码，用 --data-urlencode 而非拼字符串）
SEARCH=$(curl -s --get "$BASE/market/employees" \
  --data-urlencode "search=文案" | jq 'length')
[[ "$SEARCH" -ge 1 ]] || fail "搜索「文案」无结果"
pass "搜索生效（文案 → $SEARCH 条）"

# 8b 搜索也不能绕过 PUBLISHED 过滤
SEARCH_DRAFT=$(curl -s --get "$BASE/market/employees" \
  --data-urlencode "search=待上架" | jq 'length')
[[ "$SEARCH_DRAFT" == "0" ]] || fail "搜索能命中未上架员工"
pass "搜索不会命中未上架员工"

# 9 原管理端接口仍要求登录
ADMIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/digital-employees")
[[ "$ADMIN_CODE" == "401" ]] || fail "管理端 /digital-employees 返回 ${ADMIN_CODE}，应 401"
pass "管理端接口仍需登录（401），公开面未扩大"

echo ""
echo -e "${G}════════════════════════════════════════${NC}"
echo -e "${G}  人才市场公开接口 —— 全部通过${NC}"
echo -e "${G}════════════════════════════════════════${NC}"
