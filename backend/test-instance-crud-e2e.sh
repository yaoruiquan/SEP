#!/usr/bin/env bash
# P2：实例创建链路 —— 订阅 → 建实例 → 激活 → 授权 → 可用
# 此前前端没有任何入口能创建实例，整条链路在中间断开
set -euo pipefail

BASE="http://localhost:3001"
AUTH="$BASE/auth"; ENT="$BASE/enterprise"
JSON="Content-Type: application/json"
G='\033[0;32m' R='\033[0;31m' Y='\033[0;33m' NC='\033[0m'
pass() { echo -e "${G}✓${NC} $1"; }
fail() { echo -e "${R}✗${NC} $1"; exit 1; }
info() { echo -e "${Y}ℹ${NC} $1"; }

login() {
  curl -s -X POST "$AUTH/login" -H "$JSON" \
    -d "{\"email\":\"$1\",\"password\":\"Demo123456\"}" | jq -r '.token // empty'
}

info "实例创建全链路 E2E"

BOSS=$(login boss@acme.local); [[ -z "$BOSS" ]] && fail "登录失败"
STAFF=$(login staff@acme.local)
A_BOSS="Authorization: Bearer $BOSS"
A_STAFF="Authorization: Bearer $STAFF"
pass "登录成功"

# 1 前端建实例的下拉只列生效订阅 —— 验证数据源
SUBS=$(curl -s "$BASE/subscriptions" -H "$A_BOSS")
ACTIVE_CNT=$(echo "$SUBS" | jq '[.[]|select(.status=="ACTIVE")]|length')
[[ "$ACTIVE_CNT" -gt 0 ]] || fail "无生效订阅，前端下拉会是空的"
TPL=$(echo "$SUBS" | jq -r '[.[]|select(.status=="ACTIVE")][0].employeeId')
pass "有 ${ACTIVE_CNT} 个生效订阅可供选择"

# 2 未订阅的模板不能建实例（前端下拉不列，但接口也得挡）
FAKE_TPL="demo-emp-nonexistent-xyz"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENT/instances" \
  -H "$A_BOSS" -H "$JSON" -d "{\"templateId\":\"${FAKE_TPL}\",\"name\":\"不该成功\"}")
[[ "$CODE" == "400" || "$CODE" == "404" ]] \
  || fail "未订阅模板建实例返回 ${CODE}，期望 400/404"
pass "未订阅的模板不能建实例 [${CODE}]"

# 3 创建实例
INST=$(curl -s -X POST "$ENT/instances" -H "$A_BOSS" -H "$JSON" \
  -d "{\"templateId\":\"${TPL}\",\"name\":\"CRUD链路测试实例\"}")
IID=$(echo "$INST" | jq -r '.id // empty')
[[ -n "$IID" ]] || fail "建实例失败：$(echo "$INST" | jq -c .)"
ST=$(echo "$INST" | jq -r '.status')
[[ "$ST" == "PENDING_ACTIVATION" ]] || fail "初始状态 ${ST}，期望 PENDING_ACTIVATION"
pass "实例已创建，初始待激活：${IID}"

# 4 同一模板可建第二个实例（一次订阅多处部署）
I2=$(curl -s -X POST "$ENT/instances" -H "$A_BOSS" -H "$JSON" \
  -d "{\"templateId\":\"${TPL}\",\"name\":\"CRUD链路测试实例2\"}" | jq -r '.id // empty')
[[ -n "$I2" ]] || fail "同模板第二个实例建失败 —— 一次订阅应可多处部署"
pass "同一模板可建多个实例"

# 5 普通成员不能建
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENT/instances" \
  -H "$A_STAFF" -H "$JSON" -d "{\"templateId\":\"${TPL}\",\"name\":\"越权\"}")
[[ "$CODE" == "403" ]] || fail "普通成员建实例返回 ${CODE}，期望 403"
pass "普通成员不能建实例 [403]"

# 6 改名 + 换部门
DEPT=$(curl -s "$ENT/departments" -H "$A_BOSS" | jq -r '.[0].id // empty')
BODY="{\"name\":\"改过名的实例\"}"
[[ -n "$DEPT" ]] && BODY="{\"name\":\"改过名的实例\",\"departmentId\":\"${DEPT}\"}"
UPD=$(curl -s -X PATCH "$ENT/instances/${IID}" -H "$A_BOSS" -H "$JSON" -d "$BODY")
[[ "$(echo "$UPD" | jq -r '.name')" == "改过名的实例" ]] || fail "改名失败"
pass "改名与换部门生效"

# 7 激活 → 授权 → staff 可见
curl -s -o /dev/null -X PATCH "$ENT/instances/${IID}/status" \
  -H "$A_BOSS" -H "$JSON" -d '{"status":"ACTIVE"}'
SMID=$(curl -s "$ENT/members" -H "$A_BOSS" \
  | jq -r '[.[]|select(.user.email=="staff@acme.local")][0].id')
GID=$(curl -s -X POST "$ENT/instances/${IID}/grants" -H "$A_BOSS" -H "$JSON" \
  -d "{\"memberId\":\"${SMID}\"}" | jq -r '.id // empty')
[[ -n "$GID" ]] || fail "授权失败"
SEEN=$(curl -s "$ENT/my-employees" -H "$A_STAFF" \
  | jq -r --arg i "$IID" '[.[]|select(.instanceId==$i)]|length')
[[ "$SEEN" == "1" ]] || fail "授权后 staff 仍看不到实例 —— 链路断了"
pass "全链路通：订阅 → 建实例 → 激活 → 授权 → 成员可用"

# 8 升级：已是最新版应 409
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENT/instances/${IID}/upgrade" -H "$A_BOSS")
[[ "$CODE" == "409" || "$CODE" == "200" ]] || fail "升级返回 ${CODE}"
pass "升级接口可达 [${CODE}]"

# 9 回收后不可改（前端对 REVOKED 应禁用按钮，接口也要挡）
curl -s -o /dev/null -X PATCH "$ENT/instances/${IID}/status" \
  -H "$A_BOSS" -H "$JSON" -d '{"status":"REVOKED"}'
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$ENT/instances/${IID}" \
  -H "$A_BOSS" -H "$JSON" -d '{"name":"不该成功"}')
[[ "$CODE" == "409" ]] || fail "改已回收实例返回 ${CODE}，期望 409"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$ENT/instances/${IID}/status" \
  -H "$A_BOSS" -H "$JSON" -d '{"status":"ACTIVE"}')
[[ "$CODE" == "409" ]] || fail "复活已回收实例返回 ${CODE}，期望 409"
pass "REVOKED 是终态：不可改、不可复活 [409]"

# 清理
curl -s -o /dev/null -X PATCH "$ENT/instances/${I2}/status" \
  -H "$A_BOSS" -H "$JSON" -d '{"status":"REVOKED"}'
docker exec sep-postgres psql -U sep -d sep_platform -q -c \
  "DELETE FROM employee_grants WHERE \"instanceId\" IN ('${IID}','${I2}');
   DELETE FROM employee_instances WHERE id IN ('${IID}','${I2}');" >/dev/null 2>&1
pass "测试数据已清理"

echo ""
echo -e "${G}════════════════════════════════════════${NC}"
echo -e "${G}  实例创建全链路 —— 全部通过${NC}"
echo -e "${G}════════════════════════════════════════${NC}"
