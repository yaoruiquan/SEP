#!/usr/bin/env bash
set -euo pipefail

TMPD="${TMPDIR:-/tmp}"
BASE="http://localhost:3001"
AUTH_EP="$BASE/auth"
ENT_EP="$BASE/enterprise"

# 颜色
G='\033[0;32m' R='\033[0;31m' Y='\033[0;33m' NC='\033[0m'

pass() { echo -e "${G}✓${NC} $1"; }
fail() { echo -e "${R}✗${NC} $1"; exit 1; }
info() { echo -e "${Y}ℹ${NC} $1"; }

info "P1 block 2: 员工实例管理 E2E"

# ── 准备 ────────────────────────────────────────────────────────────────────

info "登录 boss@acme.local (示例科技的企业管理员)"
BOSS_RESP=$(curl -s -X POST "$AUTH_EP/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"boss@acme.local","password":"Demo123456"}')
BOSS_TOKEN=$(echo "$BOSS_RESP" | jq -r '.token // empty')
[[ -z "$BOSS_TOKEN" ]] && fail "Boss 登录失败：$(echo "$BOSS_RESP" | jq -c .)"
BOSS_ENT=$(echo "$BOSS_RESP" | jq -r '.enterprise.id')
pass "Boss token: ${BOSS_TOKEN:0:20}... 企业 $BOSS_ENT"

AUTH_BOSS="Authorization: Bearer $BOSS_TOKEN"

info "登录 staff@acme.local (示例科技的普通成员)"
STAFF_RESP=$(curl -s -X POST "$AUTH_EP/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"staff@acme.local","password":"Demo123456"}')
STAFF_TOKEN=$(echo "$STAFF_RESP" | jq -r '.token // empty')
[[ -z "$STAFF_TOKEN" ]] && fail "Staff 登录失败"
AUTH_STAFF="Authorization: Bearer $STAFF_TOKEN"
pass "Staff token: ${STAFF_TOKEN:0:20}..."

info "查询示例科技的订阅列表（需至少一个 ACTIVE 订阅）"
SUBS=$(curl -s -X GET "$BASE/subscriptions" -H "$AUTH_BOSS")
ACTIVE_SUB=$(echo "$SUBS" | jq -r '[.[] | select(.status=="ACTIVE")] | .[0] // empty')
[[ -z "$ACTIVE_SUB" ]] && fail "无 ACTIVE 订阅，无法测试实例创建"
TEMPLATE_ID=$(echo "$ACTIVE_SUB" | jq -r '.employeeId')
TEMPLATE_NAME=$(echo "$ACTIVE_SUB" | jq -r '.employee.name')
pass "找到订阅：员工 $TEMPLATE_NAME ($TEMPLATE_ID)"

# ── E2E 1/10: 创建实例（需订阅） ─────────────────────────────────────────────

info "E2E 1/10: 创建员工实例"
INST1=$(curl -s -X POST "$ENT_EP/instances" \
  -H "$AUTH_BOSS" -H "Content-Type: application/json" \
  -d "{\"templateId\":\"$TEMPLATE_ID\",\"name\":\"客服小美\",\"config\":{\"greeting\":\"您好\"}}")
INST1_ID=$(echo "$INST1" | jq -r '.id // empty')
[[ -z "$INST1_ID" ]] && fail "创建实例失败：$(echo "$INST1" | jq -c .)"
INST1_STATUS=$(echo "$INST1" | jq -r '.status')
[[ "$INST1_STATUS" != "PENDING_ACTIVATION" ]] && fail "初始状态应为 PENDING_ACTIVATION，实际：$INST1_STATUS"
pass "实例已创建：$INST1_ID 状态 $INST1_STATUS"

# ── E2E 2/10: 列出实例，含升级提示 ──────────────────────────────────────────

info "E2E 2/10: 列出实例（upgradeAvailable 字段存在）"
LIST=$(curl -s -X GET "$ENT_EP/instances" -H "$AUTH_BOSS")
FOUND=$(echo "$LIST" | jq -r --arg id "$INST1_ID" '[.[] | select(.id==$id)] | length')
[[ "$FOUND" != "1" ]] && fail "列表中未找到刚创建的实例"
UPGRADE_FIELD=$(echo "$LIST" | jq -r --arg id "$INST1_ID" '[.[] | select(.id==$id)][0] | has("upgradeAvailable")')
[[ "$UPGRADE_FIELD" != "true" ]] && fail "列表响应缺少 upgradeAvailable 字段"
pass "实例出现在列表中，upgradeAvailable 字段存在"

# ── E2E 3/10: 非管理员创建实例被拒 ──────────────────────────────────────────

info "E2E 3/10: 普通成员尝试创建实例（应拒绝）"
STAFF_CREATE=$(curl -s -w "%{http_code}" -o /dev/null -X POST "$ENT_EP/instances" \
  -H "$AUTH_STAFF" -H "Content-Type: application/json" \
  -d "{\"templateId\":\"$TEMPLATE_ID\",\"name\":\"客服小帅\"}")
[[ "$STAFF_CREATE" == "403" ]] || fail "非管理员创建应返回 403，实际：$STAFF_CREATE"
pass "非管理员创建被拒，403"

# ── E2E 4/10: 改名 / 改配置 ──────────────────────────────────────────────────

info "E2E 4/10: 改名并更新配置"
UPD=$(curl -s -X PATCH "$ENT_EP/instances/$INST1_ID" \
  -H "$AUTH_BOSS" -H "Content-Type: application/json" \
  -d '{"name":"客服小美（改）","config":{"greeting":"欢迎"}}')
UPD_NAME=$(echo "$UPD" | jq -r '.name // empty')
[[ "$UPD_NAME" != "客服小美（改）" ]] && fail "改名失败：$UPD_NAME"
UPD_CFG=$(echo "$UPD" | jq -r '.config.greeting // empty')
[[ "$UPD_CFG" != "欢迎" ]] && fail "配置未更新：$UPD_CFG"
pass "实例已更新：$UPD_NAME config.greeting=$UPD_CFG"

# ── E2E 5/10: 状态流转 PENDING → ACTIVE ─────────────────────────────────────

info "E2E 5/10: 激活实例 (PENDING_ACTIVATION → ACTIVE)"
ACT=$(curl -s -X PATCH "$ENT_EP/instances/$INST1_ID/status" \
  -H "$AUTH_BOSS" -H "Content-Type: application/json" \
  -d '{"status":"ACTIVE"}')
ACT_STATUS=$(echo "$ACT" | jq -r '.status // empty')
[[ "$ACT_STATUS" != "ACTIVE" ]] && fail "状态流转失败：$ACT_STATUS"
ACT_CHANGED=$(echo "$ACT" | jq -r '.changed')
[[ "$ACT_CHANGED" != "true" ]] && fail "changed 应为 true"
pass "实例已激活：$ACT_STATUS changed=$ACT_CHANGED"

# ── E2E 6/10: 幂等——状态不变时 changed=false ───────────────────────────────

info "E2E 6/10: 再次激活（幂等，changed=false）"
ACT2=$(curl -s -X PATCH "$ENT_EP/instances/$INST1_ID/status" \
  -H "$AUTH_BOSS" -H "Content-Type: application/json" \
  -d '{"status":"ACTIVE"}')
ACT2_CHANGED=$(echo "$ACT2" | jq -r '.changed')
[[ "$ACT2_CHANGED" != "false" ]] && fail "幂等调用 changed 应为 false，实际：$ACT2_CHANGED"
pass "幂等成功：changed=false"

# ── E2E 7/10: ACTIVE → SUSPENDED ────────────────────────────────────────────

info "E2E 7/10: 停用实例 (ACTIVE → SUSPENDED)"
SUSP=$(curl -s -X PATCH "$ENT_EP/instances/$INST1_ID/status" \
  -H "$AUTH_BOSS" -H "Content-Type: application/json" \
  -d '{"status":"SUSPENDED"}')
SUSP_STATUS=$(echo "$SUSP" | jq -r '.status')
[[ "$SUSP_STATUS" != "SUSPENDED" ]] && fail "停用失败：$SUSP_STATUS"
pass "实例已停用：$SUSP_STATUS"

# ── E2E 8/10: SUSPENDED → ACTIVE（恢复） ────────────────────────────────────

info "E2E 8/10: 恢复启用 (SUSPENDED → ACTIVE)"
RESUME=$(curl -s -X PATCH "$ENT_EP/instances/$INST1_ID/status" \
  -H "$AUTH_BOSS" -H "Content-Type: application/json" \
  -d '{"status":"ACTIVE"}')
RESUME_STATUS=$(echo "$RESUME" | jq -r '.status')
[[ "$RESUME_STATUS" != "ACTIVE" ]] && fail "恢复失败：$RESUME_STATUS"
pass "实例已恢复：$RESUME_STATUS"

# ── E2E 9/10: 升级（模板版本与实例版本相同时拒绝） ──────────────────────

info "E2E 9/10: 尝试升级（当前已是最新版，应拒绝）"
UPG_CODE=$(curl -s -w "%{http_code}" -o "$TMPD/upg.json" -X POST "$ENT_EP/instances/$INST1_ID/upgrade" -H "$AUTH_BOSS")
if [[ "$UPG_CODE" == "409" ]]; then
  pass "已是最新版，升级被拒：409"
elif [[ "$UPG_CODE" == "200" ]]; then
  # 可能模板确实更新了版本，检查返回值
  UPG=$(cat "$TMPD/upg.json")
  UPG_FROM=$(echo "$UPG" | jq -r '.from // empty')
  UPG_TO=$(echo "$UPG" | jq -r '.to // empty')
  CFG_REVIEW=$(echo "$UPG" | jq -r '.configReviewRequired')
  [[ "$CFG_REVIEW" != "true" ]] && fail "升级响应缺少 configReviewRequired"
  pass "升级成功（模板发了新版）：$UPG_FROM → $UPG_TO configReviewRequired=$CFG_REVIEW"
else
  fail "升级返回意外状态码：$UPG_CODE"
fi

# ── E2E 10/10: REVOKED 终态 ─────────────────────────────────────────────────

info "E2E 10/10: 回收实例 (ACTIVE → REVOKED，终态)"
REV=$(curl -s -X PATCH "$ENT_EP/instances/$INST1_ID/status" \
  -H "$AUTH_BOSS" -H "Content-Type: application/json" \
  -d '{"status":"REVOKED"}')
REV_STATUS=$(echo "$REV" | jq -r '.status')
[[ "$REV_STATUS" != "REVOKED" ]] && fail "回收失败：$REV_STATUS"
pass "实例已回收：$REV_STATUS"

info "尝试从 REVOKED 恢复（应拒绝）"
REV_BACK=$(curl -s -w "%{http_code}" -o /dev/null -X PATCH "$ENT_EP/instances/$INST1_ID/status" \
  -H "$AUTH_BOSS" -H "Content-Type: application/json" \
  -d '{"status":"ACTIVE"}')
[[ "$REV_BACK" == "409" ]] || fail "REVOKED 复活应拒绝，实际：$REV_BACK"
pass "REVOKED 是终态，复活被拒：409"

info "尝试修改已回收的实例（应拒绝）"
REV_UPD=$(curl -s -w "%{http_code}" -o /dev/null -X PATCH "$ENT_EP/instances/$INST1_ID" \
  -H "$AUTH_BOSS" -H "Content-Type: application/json" \
  -d '{"name":"不该成功"}')
[[ "$REV_UPD" == "409" ]] || fail "修改已回收实例应拒绝，实际：$REV_UPD"
pass "修改已回收实例被拒：409"

# ── E2E 11/12: 跨企业隔离：globex 登录后不能看到 acme 的实例 ────────────────

info "登录 boss@globex.local（另一家企业）"
GLOBEX_RESP=$(curl -s -X POST "$AUTH_EP/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"boss@globex.local","password":"Demo123456"}')
GLOBEX_TOKEN=$(echo "$GLOBEX_RESP" | jq -r '.token // empty')
[[ -z "$GLOBEX_TOKEN" ]] && fail "Globex 登录失败"
AUTH_GLOBEX="Authorization: Bearer $GLOBEX_TOKEN"
pass "Globex token: ${GLOBEX_TOKEN:0:20}..."

info "E2E 11/12: Globex 列出自己的实例（不应看到 acme 的实例）"
GLOBEX_LIST=$(curl -s "$ENT_EP/instances" -H "$AUTH_GLOBEX")
CROSS=$(echo "$GLOBEX_LIST" | jq -r --arg id "$INST1_ID" '[.[] | select(.id==$id)] | length')
[[ "$CROSS" != "0" ]] && fail "跨企业隔离失败：Globex 看到了 Acme 的实例 $INST1_ID"
pass "多租户隔离正确：Globex 看不到 Acme 的实例"

info "E2E 12/12: Globex 直接访问 Acme 实例的 id 返回 404（不泄漏存在性）"
CROSS_CODE=$(curl -s -w "%{http_code}" -o /dev/null \
  -X PATCH "$ENT_EP/instances/$INST1_ID/status" \
  -H "$AUTH_GLOBEX" -H "Content-Type: application/json" \
  -d '{"status":"SUSPENDED"}')
[[ "$CROSS_CODE" == "404" ]] || fail "跨企业操作应返回 404，实际：$CROSS_CODE"
pass "跨企业操作返回 404，未泄漏存在性：$CROSS_CODE"

# ── 总结 ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${G}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${G}  P1 block 2: 员工实例管理 E2E —— 12/12 通过${NC}"
echo -e "${G}════════════════════════════════════════════════════════════════════${NC}"
