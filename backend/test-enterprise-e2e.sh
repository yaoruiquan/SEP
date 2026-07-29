#!/usr/bin/env bash
# P0 企业组织基座 + P1-1 部门/成员管理
# 覆盖多租户隔离、部门树环检测、成员安全守卫
set -euo pipefail

BASE="http://localhost:3001"
AUTH="$BASE/auth"
ENT="$BASE/enterprise"
JSON="Content-Type: application/json"

G='\033[0;32m' R='\033[0;31m' Y='\033[0;33m' NC='\033[0m'
pass() { echo -e "${G}✓${NC} $1"; }
fail() { echo -e "${R}✗${NC} $1"; exit 1; }
info() { echo -e "${Y}ℹ${NC} $1"; }

login() {
  curl -s -X POST "$AUTH/login" -H "$JSON" \
    -d "{\"email\":\"$1\",\"password\":\"Demo123456\"}" | jq -r '.token // empty'
}

info "P0 企业组织基座 + P1-1 部门/成员 E2E"

BOSS=$(login boss@acme.local);      [[ -z "$BOSS" ]]   && fail "boss 登录失败"
STAFF=$(login staff@acme.local);    [[ -z "$STAFF" ]]  && fail "staff 登录失败"
GLOBEX=$(login boss@globex.local);  [[ -z "$GLOBEX" ]] && fail "globex 登录失败"
A_BOSS="Authorization: Bearer $BOSS"
A_STAFF="Authorization: Bearer $STAFF"
A_GLOBEX="Authorization: Bearer $GLOBEX"
pass "三个账号登录成功"

# ── 登录响应形状 ───────────────────────────────────────────────────────────

RESP=$(curl -s -X POST "$AUTH/login" -H "$JSON" \
  -d '{"email":"boss@acme.local","password":"Demo123456"}')
for f in token user enterprise roleInEnterprise; do
  echo "$RESP" | jq -e "has(\"$f\")" >/dev/null || fail "登录响应缺 $f"
done
ROLE=$(echo "$RESP" | jq -r '.roleInEnterprise')
[[ "$ROLE" == "ENTERPRISE_ADMIN" ]] || fail "roleInEnterprise=$ROLE"
pass "登录响应含 token/user/enterprise/roleInEnterprise"

ACME_ENT=$(echo "$RESP" | jq -r '.enterprise.id')
GLOBEX_ENT=$(curl -s -X POST "$AUTH/login" -H "$JSON" \
  -d '{"email":"boss@globex.local","password":"Demo123456"}' | jq -r '.enterprise.id')
[[ "$ACME_ENT" != "$GLOBEX_ENT" ]] || fail "两个账号解析到同一企业"
# 变量后紧跟全角右括号时必须用 ${} 括起来 —— 否则 bash 会把「）」
# 当成变量名的一部分，在 set -u 下报 unbound variable
pass "两家企业 id 不同（${ACME_ENT} / ${GLOBEX_ENT}）"

# ── 多租户隔离 ─────────────────────────────────────────────────────────────

A_DEPTS=$(curl -s "$ENT/departments" -H "$A_BOSS")
G_DEPTS=$(curl -s "$ENT/departments" -H "$A_GLOBEX")
A_IDS=$(echo "$A_DEPTS" | jq -r '[..|.id?|select(.)]|sort|join(",")')
G_IDS=$(echo "$G_DEPTS" | jq -r '[..|.id?|select(.)]|sort|join(",")')
[[ -n "$A_IDS" ]] || fail "acme 部门树为空，无法验证隔离"
[[ "$A_IDS" != "$G_IDS" ]] || fail "两家企业看到相同部门"
# 逐个确认无交集
for id in $(echo "$A_IDS" | tr ',' ' '); do
  echo "$G_IDS" | grep -q "$id" && fail "globex 看到了 acme 的部门 $id"
done
pass "部门树按企业隔离，无交集"

A_MEM=$(curl -s "$ENT/members" -H "$A_BOSS" | jq -r '[.[].user.email]|sort|join(",")')
G_MEM=$(curl -s "$ENT/members" -H "$A_GLOBEX" | jq -r '[.[].user.email]|sort|join(",")')
[[ "$A_MEM" != "$G_MEM" ]] || fail "两家企业看到相同成员"
echo "$G_MEM" | grep -q "acme.local" && fail "globex 看到 acme 的成员"
pass "成员列表按企业隔离"

# ── 跨企业操作一律 404（不泄漏存在性）─────────────────────────────────────

A_DEPT_ID=$(echo "$A_DEPTS" | jq -r '.[0].id')
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$ENT/departments/$A_DEPT_ID" \
  -H "$A_GLOBEX" -H "$JSON" -d '{"name":"越权改名"}')
[[ "$CODE" == "404" ]] || fail "跨企业改部门返回 ${CODE}，期望 404"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$ENT/departments/$A_DEPT_ID" -H "$A_GLOBEX")
[[ "$CODE" == "404" ]] || fail "跨企业删部门返回 ${CODE}，期望 404"
pass "跨企业改/删部门均 404（不是 403，不泄漏存在性）"

# ── 部门 CRUD + 环检测 ─────────────────────────────────────────────────────

P_ID=$(curl -s -X POST "$ENT/departments" -H "$A_BOSS" -H "$JSON" \
  -d '{"name":"E2E父部门"}' | jq -r '.id')
[[ -n "$P_ID" && "$P_ID" != "null" ]] || fail "建父部门失败"
C_ID=$(curl -s -X POST "$ENT/departments" -H "$A_BOSS" -H "$JSON" \
  -d "{\"name\":\"E2E子部门\",\"parentId\":\"$P_ID\"}" | jq -r '.id')
[[ -n "$C_ID" && "$C_ID" != "null" ]] || fail "建子部门失败"
pass "部门创建（父 + 子）"

# 把父部门移到自己子部门下 → 成环，必须拒绝
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$ENT/departments/$P_ID" \
  -H "$A_BOSS" -H "$JSON" -d "{\"parentId\":\"$C_ID\"}")
[[ "$CODE" == "400" ]] || fail "成环移动返回 ${CODE}，期望 400"
pass "环检测生效：父部门不能移到自己子部门下（400）"

# 自己挂自己
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$ENT/departments/$P_ID" \
  -H "$A_BOSS" -H "$JSON" -d "{\"parentId\":\"$P_ID\"}")
[[ "$CODE" == "400" ]] || fail "自引用返回 ${CODE}，期望 400"
pass "自引用被拒（400）"

# 有子部门时不能删
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$ENT/departments/$P_ID" -H "$A_BOSS")
[[ "$CODE" == "409" ]] || fail "删有子部门的父部门返回 ${CODE}，期望 409"
pass "有子部门时拒绝删除（409，不级联）"

# 跨企业挂载：把 acme 的部门挂到 globex 的部门下
G_DEPT_ID=$(echo "$G_DEPTS" | jq -r '.[0].id // empty')
if [[ -n "$G_DEPT_ID" ]]; then
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$ENT/departments/$C_ID" \
    -H "$A_BOSS" -H "$JSON" -d "{\"parentId\":\"$G_DEPT_ID\"}")
  [[ "$CODE" == "404" ]] || fail "跨企业挂载返回 ${CODE}，期望 404"
  pass "跨企业挂载被拒（404）"
fi

# 清理（先子后父）
curl -s -o /dev/null -X DELETE "$ENT/departments/$C_ID" -H "$A_BOSS"
curl -s -o /dev/null -X DELETE "$ENT/departments/$P_ID" -H "$A_BOSS"
pass "部门清理完成"

# ── 成员权限 ───────────────────────────────────────────────────────────────

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENT/departments" \
  -H "$A_STAFF" -H "$JSON" -d '{"name":"成员越权建部门"}')
[[ "$CODE" == "403" ]] || fail "普通成员建部门返回 ${CODE}，期望 403"
pass "普通成员不能建部门（403）"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$ENT/departments" -H "$A_STAFF")
[[ "$CODE" == "200" ]] || fail "普通成员读部门返回 ${CODE}，期望 200"
pass "普通成员可读部门树（200）—— 读写分离"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENT/members" \
  -H "$A_STAFF" -H "$JSON" \
  -d '{"email":"x@acme.local","password":"Demo123456"}')
[[ "$CODE" == "403" ]] || fail "普通成员加成员返回 ${CODE}，期望 403"
pass "普通成员不能添加成员（403）"

# ── 成员安全守卫：最后一名管理员 ───────────────────────────────────────────

BOSS_MID=$(curl -s "$ENT/members" -H "$A_BOSS" \
  | jq -r '[.[]|select(.user.email=="boss@acme.local")][0].id')
ADMIN_CNT=$(curl -s "$ENT/members" -H "$A_BOSS" \
  | jq '[.[]|select(.role=="ENTERPRISE_ADMIN")]|length')

if [[ "$ADMIN_CNT" == "1" ]]; then
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$ENT/members/$BOSS_MID" \
    -H "$A_BOSS" -H "$JSON" -d '{"role":"MEMBER"}')
  [[ "$CODE" == "400" || "$CODE" == "409" ]] \
    || fail "降级唯一管理员返回 ${CODE}，期望 400/409"
  pass "最后一名管理员不可降级（${CODE}）—— 否则企业永久失去管理能力"

  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$ENT/members/$BOSS_MID" -H "$A_BOSS")
  [[ "$CODE" == "400" || "$CODE" == "409" ]] \
    || fail "移除唯一管理员返回 ${CODE}，期望 400/409"
  pass "最后一名管理员不可移除（${CODE}）"
else
  info "本企业有 $ADMIN_CNT 名管理员，跳过「最后一名管理员」检查"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$ENT/members/$BOSS_MID" -H "$A_BOSS")
  [[ "$CODE" == "400" ]] || fail "自我移除返回 ${CODE}，期望 400"
  pass "管理员不能移除自己（400）"
fi

# ── DEPT_MANAGER 不可新分配（本版按普通成员对待）─────────────────────────

STAFF_MID=$(curl -s "$ENT/members" -H "$A_BOSS" \
  | jq -r '[.[]|select(.user.email=="staff@acme.local")][0].id')
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$ENT/members/$STAFF_MID" \
  -H "$A_BOSS" -H "$JSON" -d '{"role":"DEPT_MANAGER"}')
[[ "$CODE" == "400" ]] || fail "设 DEPT_MANAGER 返回 ${CODE}，期望 400（不在可分配角色内）"
pass "DEPT_MANAGER 不可新分配（400）—— 枚举值保留但不开放"

# ── 客户端不能注入 enterpriseId ─────────────────────────────────────────────

NEW_D=$(curl -s -X POST "$ENT/departments" -H "$A_BOSS" -H "$JSON" \
  -d "{\"name\":\"E2E注入测试\",\"enterpriseId\":\"$GLOBEX_ENT\"}")
ND_ID=$(echo "$NEW_D" | jq -r '.id // empty')
if [[ -n "$ND_ID" ]]; then
  # 该部门必须属于 acme，而不是请求体里指定的 globex
  SEEN=$(curl -s "$ENT/departments" -H "$A_GLOBEX" | jq -r --arg i "$ND_ID" '[..|.id?|select(.==$i)]|length')
  [[ "$SEEN" == "0" ]] || fail "客户端注入 enterpriseId 生效了 —— 部门落到了 globex"
  curl -s -o /dev/null -X DELETE "$ENT/departments/$ND_ID" -H "$A_BOSS"
  pass "请求体里的 enterpriseId 被忽略（企业归属只认服务端上下文）"
fi

echo ""
echo -e "${G}════════════════════════════════════════${NC}"
echo -e "${G}  P0 + P1-1 企业组织 —— 全部通过${NC}"
echo -e "${G}════════════════════════════════════════${NC}"
