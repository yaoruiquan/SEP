#!/usr/bin/env bash
# 三个企业管理页面的真机验证：
# 页面能否 200、SSR 有无异常、前端经 rewrite 代理调后端接口是否通。
set -euo pipefail

WEB="http://localhost:3000"
API="$WEB/api"   # Next rewrite → backend
JSON="Content-Type: application/json"

G='\033[0;32m' R='\033[0;31m' Y='\033[0;33m' NC='\033[0m'
pass() { echo -e "${G}✓${NC} $1"; }
fail() { echo -e "${R}✗${NC} $1"; exit 1; }
info() { echo -e "${Y}ℹ${NC} $1"; }

login() {
  curl -s -X POST "$API/auth/login" -H "$JSON" \
    -d "{\"email\":\"$1\",\"password\":\"Demo123456\"}" | jq -r '.token // empty'
}

info "三个企业管理页面 —— 真机验证"

# ── 页面可达性 ─────────────────────────────────────────────────────────────

info "页面 HTTP 状态（客户端渲染，未登录也应 200 而非 404/500）"
for p in /departments /members /my-employees /marketplace /dashboard; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WEB$p")
  [[ "$CODE" == "200" ]] || fail "$p 返回 $CODE"
done
pass "5 个页面均 200（含之前 404 的三个新页）"

info "根路径应重定向到 /marketplace"
ROOT=$(curl -s -o /dev/null -w "%{redirect_url}" "$WEB/")
[[ "$ROOT" == *"/marketplace" ]] || fail "根路径跳向 ${ROOT}，期望 /marketplace"
pass "/ → /marketplace"

# ── 前端代理链路 ───────────────────────────────────────────────────────────

info "前端 /api 代理是否打通后端"
BOSS=$(login boss@acme.local)
[[ -z "$BOSS" ]] && fail "经 Next rewrite 登录失败 —— 代理链路不通"
A_BOSS="Authorization: Bearer $BOSS"
pass "经 /api 代理登录成功"

info "登录响应含 enterprise 与 roleInEnterprise（前端角色过滤依赖）"
RESP=$(curl -s -X POST "$API/auth/login" -H "$JSON" \
  -d '{"email":"boss@acme.local","password":"Demo123456"}')
ENT=$(echo "$RESP" | jq -r '.enterprise.name // empty')
ROLE=$(echo "$RESP" | jq -r '.roleInEnterprise // empty')
[[ -n "$ENT" ]]  || fail "缺 enterprise 字段"
[[ "$ROLE" == "ENTERPRISE_ADMIN" ]] || fail "roleInEnterprise=$ROLE"
pass "enterprise=$ENT roleInEnterprise=$ROLE"

# ── 三个页面各自的数据源 ───────────────────────────────────────────────────

info "部门页数据源：GET /enterprise/departments"
DEPTS=$(curl -s "$API/enterprise/departments" -H "$A_BOSS")
echo "$DEPTS" | jq -e 'type == "array"' >/dev/null || fail "非数组：$DEPTS"
D_CNT=$(echo "$DEPTS" | jq 'length')
HAS_CHILDREN=$(echo "$DEPTS" | jq -e '.[0] | has("children")' >/dev/null && echo yes || echo no)
[[ "$HAS_CHILDREN" == "yes" ]] || fail "缺 children 字段，树形组件会崩"
pass "$D_CNT 个顶级部门，含 children 字段"

info "成员页数据源：GET /enterprise/members"
MEMBERS=$(curl -s "$API/enterprise/members" -H "$A_BOSS")
M_CNT=$(echo "$MEMBERS" | jq 'length')
# 页面读的是 m.user.email / m.user.name，不是顶层
echo "$MEMBERS" | jq -e '.[0].user.email' >/dev/null || fail "缺 user.email 嵌套结构"
pass "$M_CNT 名成员，user 嵌套结构正确"

info "我的员工数据源：GET /enterprise/my-employees"
MINE=$(curl -s "$API/enterprise/my-employees" -H "$A_BOSS")
echo "$MINE" | jq -e 'type == "array"' >/dev/null || fail "非数组：$MINE"
pass "返回数组（$(echo "$MINE" | jq 'length') 条）"

info "授权面板数据源：GET /enterprise/instances"
INSTS=$(curl -s "$API/enterprise/instances" -H "$A_BOSS")
echo "$INSTS" | jq -e 'type == "array"' >/dev/null || fail "非数组"
I_CNT=$(echo "$INSTS" | jq 'length')
if [[ "$I_CNT" -gt 0 ]]; then
  echo "$INSTS" | jq -e '.[0] | has("upgradeAvailable")' >/dev/null \
    || fail "缺 upgradeAvailable 字段"
fi
pass "$I_CNT 个实例，字段完整"

# ── 普通成员视角 ───────────────────────────────────────────────────────────

info "普通成员：读得到部门/成员（页面不该崩），但写被拒"
STAFF=$(login staff@acme.local)
A_STAFF="Authorization: Bearer $STAFF"
S_DEPTS=$(curl -s -o /dev/null -w "%{http_code}" "$API/enterprise/departments" -H "$A_STAFF")
[[ "$S_DEPTS" == "200" ]] || fail "成员读部门返回 $S_DEPTS"
S_WRITE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/enterprise/departments" \
  -H "$A_STAFF" -H "$JSON" -d '{"name":"越权部门"}')
[[ "$S_WRITE" == "403" ]] || fail "成员建部门返回 ${S_WRITE}，期望 403"
pass "成员可读不可写（读 200 / 写 403）—— 前端隐藏菜单只是体验，后端才是闸门"

info "普通成员的 my-employees 独立于管理员"
S_MINE=$(curl -s "$API/enterprise/my-employees" -H "$A_STAFF")
echo "$S_MINE" | jq -e 'type == "array"' >/dev/null || fail "非数组：$S_MINE"
pass "成员视角返回 $(echo "$S_MINE" | jq 'length') 条"

echo ""
echo -e "${G}══════════════════════════════════════════════════════${NC}"
echo -e "${G}  三个企业管理页面 —— 真机验证通过${NC}"
echo -e "${G}══════════════════════════════════════════════════════${NC}"
