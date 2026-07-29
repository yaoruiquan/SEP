#!/usr/bin/env bash
# P3：员工包发布与下载
# 覆盖运营上传、版本同步触发升级提示、下载鉴权、SHA-256 完整性
set -euo pipefail

BASE="http://localhost:3001"
AUTH="$BASE/auth"; ENT="$BASE/enterprise"
JSON="Content-Type: application/json"
TMPD="${TMPDIR:-/tmp}"
PKG="${PKG_PATH:-/Users/yao/.claude/jobs/7a1cc777/tmp/employee-package-copy-1.1.0.zip}"

G='\033[0;32m' R='\033[0;31m' Y='\033[0;33m' NC='\033[0m'
pass() { echo -e "${G}✓${NC} $1"; }
fail() { echo -e "${R}✗${NC} $1"; exit 1; }
info() { echo -e "${Y}ℹ${NC} $1"; }

login() {
  curl -s -X POST "$AUTH/login" -H "$JSON" \
    -d "{\"email\":\"$1\",\"password\":\"Demo123456\"}" | jq -r '.token // empty'
}

info "员工包发布与下载 E2E"

[[ -f "$PKG" ]] || fail "测试用 ZIP 不存在：$PKG"
EXPECT_SHA=$(shasum -a 256 "$PKG" | awk '{print $1}')

ADMIN=$(login admin@sep.local);   [[ -z "$ADMIN" ]]  && fail "运营登录失败"
BOSS=$(login boss@acme.local);    [[ -z "$BOSS" ]]   && fail "boss 登录失败"
STAFF=$(login staff@acme.local);  [[ -z "$STAFF" ]]  && fail "staff 登录失败"
GLOBEX=$(login boss@globex.local)
A_ADMIN="Authorization: Bearer $ADMIN"
A_BOSS="Authorization: Bearer $BOSS"
A_STAFF="Authorization: Bearer $STAFF"
A_GLOBEX="Authorization: Bearer $GLOBEX"
pass "四个账号登录成功"

# 取一个 acme 已订阅、且 staff 有授权的模板
TPL=$(curl -s "$ENT/my-employees" -H "$A_STAFF" | jq -r '.[0].template.id // empty')
[[ -n "$TPL" ]] || fail "staff 无任何被授权员工，无法测下载鉴权"
pass "测试模板：${TPL}（staff 有授权）"

# ── 1 上传前：无包可下 ─────────────────────────────────────────────────────

CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/digital-employees/$TPL/package/download" -H "$A_STAFF")
if [[ "$CODE" == "404" ]]; then
  pass "上传前下载返回 404（尚无包）"
else
  info "该模板已有包（${CODE}），继续测新版本发布"
fi

# ── 2 非运营不能上传 ───────────────────────────────────────────────────────

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/digital-employees/$TPL/packages" -H "$A_BOSS" \
  -F "file=@$PKG" -F "version=9.9.9")
[[ "$CODE" == "403" ]] || fail "企业管理员上传返回 ${CODE}，期望 403（仅平台运营）"
pass "企业管理员不能上传员工包 [403]"

# ── 3 非 ZIP 被拒 ──────────────────────────────────────────────────────────

echo "#!/bin/sh" > "$TMPD/fake.zip"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/digital-employees/$TPL/packages" -H "$A_ADMIN" \
  -F "file=@$TMPD/fake.zip" -F "version=9.9.8")
[[ "$CODE" == "400" ]] || fail "伪造 .zip 返回 ${CODE}，期望 400（校验魔数）"
pass "扩展名为 .zip 但内容不是 ZIP —— 被拒 [400]"

# ── 4 版本号格式校验 ───────────────────────────────────────────────────────

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/digital-employees/$TPL/packages" -H "$A_ADMIN" \
  -F "file=@$PKG" -F "version=不是版本号")
[[ "$CODE" == "400" ]] || fail "非法版本号返回 ${CODE}，期望 400"
pass "版本号须为 x.y.z [400]"

# ── 5 运营发布新版本 ───────────────────────────────────────────────────────

VER="1.$(date +%s | tail -c 4).0"
RESP=$(curl -s -X POST "$BASE/digital-employees/$TPL/packages" -H "$A_ADMIN" \
  -F "file=@$PKG" -F "version=$VER" -F "changelog=E2E 测试发布")
PKG_ID=$(echo "$RESP" | jq -r '.id // empty')
[[ -n "$PKG_ID" ]] || fail "发布失败：$(echo "$RESP" | jq -c .)"
GOT_SHA=$(echo "$RESP" | jq -r '.sha256')
[[ "$GOT_SHA" == "$EXPECT_SHA" ]] \
  || fail "服务端算的 SHA 与本地不符：$GOT_SHA vs $EXPECT_SHA"
pass "已发布 v${VER}，SHA-256 与本地一致"

# ── 6 同版本重复发布被拒 ───────────────────────────────────────────────────

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/digital-employees/$TPL/packages" -H "$A_ADMIN" \
  -F "file=@$PKG" -F "version=$VER")
[[ "$CODE" == "400" ]] || fail "重复版本返回 ${CODE}，期望 400"
pass "同模板同版本不可重复发布 [400]"

# ── 7 版本已同步到模板，触发升级提示 ───────────────────────────────────────

LATEST=$(curl -s "$ENT/instances" -H "$A_BOSS" \
  | jq -r --arg t "$TPL" '[.[]|select(.template.id==$t)][0].latestVersion // empty')
[[ "$LATEST" == "$VER" ]] || fail "模板版本未同步：latestVersion=${LATEST}，期望 $VER"
UPG=$(curl -s "$ENT/instances" -H "$A_BOSS" \
  | jq -r --arg t "$TPL" '[.[]|select(.template.id==$t and .status!="REVOKED")][0].upgradeAvailable // empty')
[[ "$UPG" == "true" ]] || fail "upgradeAvailable=${UPG}，期望 true —— 发版未触发升级提示"
pass "发版同步了模板版本，已有实例出现升级提示"

# ── 8 有授权的成员可下载，且内容完整 ───────────────────────────────────────

OUT="$TMPD/downloaded-pkg.zip"
HDRS=$(curl -s -D - -o "$OUT" \
  "$BASE/digital-employees/$TPL/package/download" -H "$A_STAFF")
DL_SHA=$(shasum -a 256 "$OUT" | awk '{print $1}')
[[ "$DL_SHA" == "$EXPECT_SHA" ]] \
  || fail "下载内容损坏：$DL_SHA vs $EXPECT_SHA"
pass "有授权成员下载成功，SHA-256 与原文件一致"

echo "$HDRS" | grep -qi "x-sha256: *$EXPECT_SHA" \
  || fail "响应头 X-SHA256 缺失或不符"
echo "$HDRS" | grep -qi "content-disposition: *attachment" \
  || fail "缺少 Content-Disposition: attachment"
pass "响应头含 X-SHA256 与 Content-Disposition"

# 解压确认结构
rm -rf "$TMPD/unz" && mkdir -p "$TMPD/unz" && unzip -q "$OUT" -d "$TMPD/unz"
[[ -d "$TMPD/unz/skills" ]] || fail "包内缺 skills 目录"
[[ -f "$TMPD/unz/README.md" ]] || fail "包内缺 README.md 说明"
find "$TMPD/unz/skills" -name "SKILL.md" | grep -q . || fail "包内缺 SKILL.md"
pass "包内结构正确：skills/*/SKILL.md + README.md 说明"

# ── 9 无授权不能下载（跨企业）─────────────────────────────────────────────

CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/digital-employees/$TPL/package/download" -H "$A_GLOBEX")
[[ "$CODE" == "404" ]] || fail "跨企业下载返回 ${CODE}，期望 404（不泄漏包存在）"
pass "跨企业无授权下载 404（不是 403，不泄漏存在性）"

# ── 10 运营无需授权可下载（验包用）────────────────────────────────────────

CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/digital-employees/$TPL/package/download" -H "$A_ADMIN")
[[ "$CODE" == "200" ]] || fail "运营下载返回 ${CODE}，期望 200"
pass "平台运营无需授权可下载 [200]"

# ── 11 未登录不能下载 ─────────────────────────────────────────────────────

CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/digital-employees/$TPL/package/download")
[[ "$CODE" == "401" ]] || fail "未登录下载返回 ${CODE}，期望 401"
pass "未登录不能下载 [401] —— 员工包不对公众开放"

# ── 12 my-employees 标注 packageAvailable ─────────────────────────────────

AVAIL=$(curl -s "$ENT/my-employees" -H "$A_STAFF" \
  | jq -r --arg t "$TPL" '[.[]|select(.template.id==$t)][0].packageAvailable // empty')
[[ "$AVAIL" == "true" ]] || fail "packageAvailable=${AVAIL}，期望 true"
pass "my-employees 标注了 packageAvailable=true"

# ── 13 历史版本列表（仅运营）──────────────────────────────────────────────

CNT=$(curl -s "$BASE/digital-employees/$TPL/packages" -H "$A_ADMIN" | jq 'length')
[[ "$CNT" -ge 1 ]] || fail "历史列表为空"
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/digital-employees/$TPL/packages" -H "$A_STAFF")
[[ "$CODE" == "403" ]] || fail "成员看历史列表返回 ${CODE}，期望 403"
pass "历史版本列表仅运营可见（$CNT 条 / 成员 403）"

rm -f "$TMPD/fake.zip" "$OUT"; rm -rf "$TMPD/unz"

echo ""
echo -e "${G}════════════════════════════════════════${NC}"
echo -e "${G}  员工包发布与下载 —— 全部通过${NC}"
echo -e "${G}════════════════════════════════════════${NC}"
