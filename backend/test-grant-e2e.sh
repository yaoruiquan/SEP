#!/usr/bin/env bash
set -euo pipefail

TMPD="${TMPDIR:-/tmp}"
BASE="http://localhost:3001"
AUTH_EP="$BASE/auth"
ENT_EP="$BASE/enterprise"
JSON="Content-Type: application/json"

G='\033[0;32m' R='\033[0;31m' Y='\033[0;33m' NC='\033[0m'
pass() { echo -e "${G}✓${NC} $1"; }
fail() { echo -e "${R}✗${NC} $1"; exit 1; }
info() { echo -e "${Y}ℹ${NC} $1"; }

login() { # $1=email → token
  curl -s -X POST "$AUTH_EP/login" -H "$JSON" \
    -d "{\"email\":\"$1\",\"password\":\"Demo123456\"}" | jq -r '.token // empty'
}

info "P1 第三块：员工授权 E2E"

BOSS=$(login boss@acme.local);   [[ -z "$BOSS" ]]   && fail "boss 登录失败"
STAFF=$(login staff@acme.local); [[ -z "$STAFF" ]]  && fail "staff 登录失败"
GLOBEX=$(login boss@globex.local); [[ -z "$GLOBEX" ]] && fail "globex 登录失败"
A_BOSS="Authorization: Bearer $BOSS"
A_STAFF="Authorization: Bearer $STAFF"
A_GLOBEX="Authorization: Bearer $GLOBEX"
pass "三个账号登录成功"

# ── 准备：拿一个 ACTIVE 订阅建实例 ─────────────────────────────────────────

TEMPLATE=$(curl -s "$BASE/subscriptions" -H "$A_BOSS" \
  | jq -r '[.[] | select(.status=="ACTIVE")][0].employeeId // empty')
[[ -z "$TEMPLATE" ]] && fail "无 ACTIVE 订阅"

INST=$(curl -s -X POST "$ENT_EP/instances" -H "$A_BOSS" -H "$JSON" \
  -d "{\"templateId\":\"$TEMPLATE\",\"name\":\"授权测试实例\"}" | jq -r '.id')
[[ -z "$INST" || "$INST" == "null" ]] && fail "建实例失败"
curl -s -o /dev/null -X PATCH "$ENT_EP/instances/$INST/status" -H "$A_BOSS" -H "$JSON" \
  -d '{"status":"ACTIVE"}'
pass "实例已建并激活：$INST"

# staff 的成员 id 与所在部门
MEMBERS=$(curl -s "$ENT_EP/members" -H "$A_BOSS")
STAFF_MID=$(echo "$MEMBERS" | jq -r '[.[] | select(.user.email=="staff@acme.local")][0].id')
STAFF_DEPT=$(echo "$MEMBERS" | jq -r '[.[] | select(.user.email=="staff@acme.local")][0].department.id // empty')
[[ -z "$STAFF_MID" || "$STAFF_MID" == "null" ]] && fail "找不到 staff 成员记录"
pass "staff 成员 id=$STAFF_MID 部门=${STAFF_DEPT:-无}"

# ── 1/11 授权前「我的员工」不含该实例 ──────────────────────────────────────

info "1/11 授权前 staff 看不到该实例"
BEFORE=$(curl -s "$ENT_EP/my-employees" -H "$A_STAFF" \
  | jq -r --arg i "$INST" '[.[] | select(.instanceId==$i)] | length')
[[ "$BEFORE" == "0" ]] || fail "授权前就能看到，实际 $BEFORE 条"
pass "授权前不可见"

# ── 2/11 直接授权给个人 ────────────────────────────────────────────────────

info "2/11 直接授权给 staff"
GRANT=$(curl -s -X POST "$ENT_EP/instances/$INST/grants" -H "$A_BOSS" -H "$JSON" \
  -d "{\"memberId\":\"$STAFF_MID\"}")
GID=$(echo "$GRANT" | jq -r '.id // empty')
[[ -z "$GID" ]] && fail "授权失败：$(echo "$GRANT" | jq -c .)"
pass "已授权：$GID"

info "3/11 staff 现在能看到，且 grantSource=DIRECT"
SRC=$(curl -s "$ENT_EP/my-employees" -H "$A_STAFF" \
  | jq -r --arg i "$INST" '[.[] | select(.instanceId==$i)][0].grantSource // empty')
[[ "$SRC" == "DIRECT" ]] || fail "grantSource 应为 DIRECT，实际：$SRC"
pass "可见且来源正确：DIRECT"

# ── 4/11 重复授权 409 ──────────────────────────────────────────────────────

info "4/11 重复授权应 409"
DUP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENT_EP/instances/$INST/grants" \
  -H "$A_BOSS" -H "$JSON" -d "{\"memberId\":\"$STAFF_MID\"}")
[[ "$DUP" == "409" ]] || fail "应 409，实际 $DUP"
pass "重复授权被拒：409"

# ── 5/11 二选一约束 ────────────────────────────────────────────────────────

info "5/11 同时传 departmentId 与 memberId 应 400"
BOTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENT_EP/instances/$INST/grants" \
  -H "$A_BOSS" -H "$JSON" -d "{\"memberId\":\"$STAFF_MID\",\"departmentId\":\"${STAFF_DEPT:-x}\"}")
[[ "$BOTH" == "400" ]] || fail "应 400，实际 $BOTH"

info "   都不传也应 400"
NEITHER=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENT_EP/instances/$INST/grants" \
  -H "$A_BOSS" -H "$JSON" -d '{}')
[[ "$NEITHER" == "400" ]] || fail "应 400，实际 $NEITHER"
pass "二选一约束生效（都传/都不传均 400）"

# ── 6/11 普通成员不能授权 ──────────────────────────────────────────────────

info "6/11 staff 自己不能开授权"
SELF=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENT_EP/instances/$INST/grants" \
  -H "$A_STAFF" -H "$JSON" -d "{\"memberId\":\"$STAFF_MID\"}")
[[ "$SELF" == "403" ]] || fail "应 403，实际 $SELF"
pass "非管理员开授权被拒：403"

# ── 7/11 授权列表 ──────────────────────────────────────────────────────────

info "7/11 管理员可看授权列表"
LIST=$(curl -s "$ENT_EP/instances/$INST/grants" -H "$A_BOSS")
CNT=$(echo "$LIST" | jq -r --arg g "$GID" '[.[] | select(.id==$g)] | length')
[[ "$CNT" == "1" ]] || fail "列表里找不到该授权"
EXPIRED=$(echo "$LIST" | jq -r --arg g "$GID" '[.[] | select(.id==$g)][0].expired')
[[ "$EXPIRED" == "false" ]] || fail "长期授权 expired 应为 false"
pass "授权列表正确，expired=false"

# ── 8/11 停用实例后授权不生效但记录保留 ────────────────────────────────────

info "8/11 停用实例 → staff 看不到，但授权记录仍在"
curl -s -o /dev/null -X PATCH "$ENT_EP/instances/$INST/status" -H "$A_BOSS" -H "$JSON" \
  -d '{"status":"SUSPENDED"}'
HIDDEN=$(curl -s "$ENT_EP/my-employees" -H "$A_STAFF" \
  | jq -r --arg i "$INST" '[.[] | select(.instanceId==$i)] | length')
[[ "$HIDDEN" == "0" ]] || fail "停用后仍可见"
STILL=$(curl -s "$ENT_EP/instances/$INST/grants" -H "$A_BOSS" \
  | jq -r --arg g "$GID" '[.[] | select(.id==$g)] | length')
[[ "$STILL" == "1" ]] || fail "授权记录被误删"
pass "停用后不可用，但授权记录保留（恢复即生效）"

info "   恢复启用 → 又可见"
curl -s -o /dev/null -X PATCH "$ENT_EP/instances/$INST/status" -H "$A_BOSS" -H "$JSON" \
  -d '{"status":"ACTIVE"}'
BACK=$(curl -s "$ENT_EP/my-employees" -H "$A_STAFF" \
  | jq -r --arg i "$INST" '[.[] | select(.instanceId==$i)] | length')
[[ "$BACK" == "1" ]] || fail "恢复后仍不可见 —— 授权没有自动复用"
pass "恢复启用后原授权继续有效"

# ── 9/11 跨企业隔离 ────────────────────────────────────────────────────────

info "9/11 globex 不能给 acme 的实例授权"
CROSS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENT_EP/instances/$INST/grants" \
  -H "$A_GLOBEX" -H "$JSON" -d "{\"memberId\":\"$STAFF_MID\"}")
[[ "$CROSS" == "404" ]] || fail "应 404，实际 $CROSS"

info "   globex 也不能收回 acme 的授权"
CROSS_DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$ENT_EP/grants/$GID" -H "$A_GLOBEX")
[[ "$CROSS_DEL" == "404" ]] || fail "应 404，实际 $CROSS_DEL"
pass "跨企业授权/收回均 404，未泄漏存在性"

# ── 10/11 收回授权 ─────────────────────────────────────────────────────────

info "10/11 收回授权"
DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$ENT_EP/grants/$GID" -H "$A_BOSS")
[[ "$DEL" == "200" ]] || fail "收回失败：$DEL"
GONE=$(curl -s "$ENT_EP/my-employees" -H "$A_STAFF" \
  | jq -r --arg i "$INST" '[.[] | select(.instanceId==$i)] | length')
[[ "$GONE" == "0" ]] || fail "收回后仍可见"
pass "已收回，staff 不再可见"

# ── 11/11 部门授权路径 ─────────────────────────────────────────────────────

if [[ -n "$STAFF_DEPT" ]]; then
  info "11/11 授权给 staff 所在部门 → grantSource=DEPARTMENT"
  DG=$(curl -s -X POST "$ENT_EP/instances/$INST/grants" -H "$A_BOSS" -H "$JSON" \
    -d "{\"departmentId\":\"$STAFF_DEPT\"}" | jq -r '.id // empty')
  [[ -z "$DG" ]] && fail "部门授权失败"
  DSRC=$(curl -s "$ENT_EP/my-employees" -H "$A_STAFF" \
    | jq -r --arg i "$INST" '[.[] | select(.instanceId==$i)][0].grantSource // empty')
  [[ "$DSRC" == "DEPARTMENT" ]] || fail "应为 DEPARTMENT，实际：$DSRC"
  pass "部门授权路径生效：DEPARTMENT"
  curl -s -o /dev/null -X DELETE "$ENT_EP/grants/$DG" -H "$A_BOSS"
else
  info "11/11 跳过 —— staff 不属于任何部门"
fi

# ── 清理 ───────────────────────────────────────────────────────────────────

curl -s -o /dev/null -X PATCH "$ENT_EP/instances/$INST/status" -H "$A_BOSS" -H "$JSON" \
  -d '{"status":"REVOKED"}'

echo ""
echo -e "${G}══════════════════════════════════════════════════════${NC}"
echo -e "${G}  P1 第三块：员工授权 E2E —— 全部通过${NC}"
echo -e "${G}══════════════════════════════════════════════════════${NC}"
