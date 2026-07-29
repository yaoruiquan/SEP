#!/usr/bin/env bash
# 全量端到端：依次跑所有 E2E 脚本，任一失败即整体失败。
# 前置：后端 :3001、前端 :3000 已启动，PostgreSQL/Redis 在跑。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
B='\033[1m' G='\033[0;32m' R='\033[0;31m' Y='\033[0;33m' NC='\033[0m'

declare -a NAMES=(
  "P0/P1-1 企业组织基座 + 部门/成员"
  "P1-2 员工实例生命周期"
  "P1-3 员工授权"
  "P2 实例创建全链路"
  "P2 人才市场公开接口"
  "P2 访客视角人才市场"
  "前端三页面数据源"
)
declare -a SCRIPTS=(
  "backend/test-enterprise-e2e.sh"
  "backend/test-instance-e2e.sh"
  "backend/test-grant-e2e.sh"
  "backend/test-instance-crud-e2e.sh"
  "backend/test-market-public-e2e.sh"
  "web/test-market-visitor-e2e.sh"
  "web/test-pages-e2e.sh"
)

echo -e "${B}══ 全量端到端测试 ══${NC}"
echo ""

# 前置检查：服务在不在
for probe in "http://localhost:3001/api/docs:后端" "http://localhost:3000/marketplace:前端"; do
  url="${probe%:*}"; label="${probe##*:}"
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo 000)
  if [[ "$code" != "200" ]]; then
    echo -e "${R}✗ $label 未就绪（$url → $code）${NC}"
    echo "  后端：cd backend && node dist/main.js"
    echo "  前端：cd web && npx next start -p 3000"
    exit 1
  fi
done
echo -e "${G}✓${NC} 后端 :3001 与前端 :3000 均就绪"
echo ""

PASSED=0; FAILED=0
declare -a FAILED_NAMES=()

for i in "${!SCRIPTS[@]}"; do
  script="$ROOT/${SCRIPTS[$i]}"
  name="${NAMES[$i]}"

  if [[ ! -f "$script" ]]; then
    echo -e "${Y}⊘${NC} $name — 脚本不存在，跳过（${SCRIPTS[$i]}）"
    continue
  fi

  echo -e "${B}▶ $name${NC}"
  # 脚本内多用相对路径与 docker exec，统一在其所在目录执行
  if (cd "$(dirname "$script")" && bash "$script" > /tmp/e2e-out.txt 2>&1); then
    # 只回显通过项的条数，细节留在文件里
    n=$(grep -c '✓' /tmp/e2e-out.txt || true)
    echo -e "  ${G}通过${NC}（$n 项）"
    PASSED=$((PASSED + 1))
  else
    echo -e "  ${R}失败${NC}"
    echo "───────── 输出 ─────────"
    tail -25 /tmp/e2e-out.txt | sed 's/^/  /'
    echo "────────────────────────"
    FAILED=$((FAILED + 1))
    FAILED_NAMES+=("$name")
  fi
  echo ""
done

echo -e "${B}══ 汇总 ══${NC}"
echo -e "脚本通过：${G}$PASSED${NC}   失败：$([[ $FAILED -eq 0 ]] && echo -e "${G}0${NC}" || echo -e "${R}$FAILED${NC}")"
if [[ $FAILED -gt 0 ]]; then
  for n in "${FAILED_NAMES[@]}"; do echo -e "  ${R}✗${NC} $n"; done
  exit 1
fi
echo -e "${G}全部端到端测试通过${NC}"
