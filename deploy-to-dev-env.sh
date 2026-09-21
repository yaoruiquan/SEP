#!/usr/bin/env bash
# =============================================================================
# 部署头像功能到联调环境的快速脚本
# =============================================================================
set -euo pipefail

SERVER="64.83.39.223"
SSH_USER="root"  # 根据实际情况修改
DEPLOY_DIR="/opt/sep-dev/app"

echo "=========================================="
echo "🚀 开始部署头像功能到联调环境"
echo "=========================================="
echo ""
echo "服务器: $SERVER"
echo "部署目录: $DEPLOY_DIR"
echo "环境: sep-dev.longdaoSEP.cn"
echo ""

# 检查 SSH 连接
echo "1️⃣  检查服务器连接..."
if ! ssh -o ConnectTimeout=5 ${SSH_USER}@${SERVER} "echo 'SSH 连接成功'" 2>/dev/null; then
    echo "❌ 无法连接到服务器 $SERVER"
    echo "请检查："
    echo "  - 服务器 IP 是否正确"
    echo "  - SSH 密钥是否配置"
    echo "  - 防火墙是否开放"
    exit 1
fi
echo "✅ 服务器连接正常"
echo ""

# 拉取最新代码
echo "2️⃣  拉取最新代码..."
ssh ${SSH_USER}@${SERVER} << 'ENDSSH'
    set -e
    cd /opt/sep-dev/app

    echo "当前分支和提交："
    git branch --show-current
    git log --oneline -1

    echo ""
    echo "拉取最新代码..."
    git fetch origin
    git pull origin main

    echo ""
    echo "最新提交："
    git log --oneline -3

    echo ""
    echo "检查头像文档是否存在..."
    ls -lh docs/对接/*头像* docs/对接/README-头像* 2>/dev/null || echo "⚠️  头像文档未找到"

    echo ""
    echo "检查头像素材..."
    ls web/public/assets/employees/silicon/*.webp | wc -l | xargs echo "头像素材文件数："
ENDSSH

echo "✅ 代码更新完成"
echo ""

# 重新构建和部署
echo "3️⃣  重新构建和部署..."
ssh ${SSH_USER}@${SERVER} << 'ENDSSH'
    set -e
    cd /opt/sep-dev/app/deploy/production

    # 检查是否使用 docker-compose.dev.yml
    if [[ -f docker-compose.dev.yml ]]; then
        echo "使用 docker-compose.dev.yml 部署联调环境..."

        # 停止旧容器
        echo "停止旧容器..."
        docker-compose -f docker-compose.dev.yml down

        # 构建新镜像
        echo "构建新镜像（包含头像功能）..."
        DEPLOY_TAG="$(git rev-parse --short HEAD)" docker-compose -f docker-compose.dev.yml build

        # 启动新容器
        echo "启动新容器..."
        DEPLOY_TAG="$(git rev-parse --short HEAD)" docker-compose -f docker-compose.dev.yml up -d

        echo "✅ 部署完成"
    else
        echo "❌ docker-compose.dev.yml 未找到"
        exit 1
    fi
ENDSSH

echo ""

# 验证部署
echo "4️⃣  验证部署..."
sleep 5  # 等待容器启动

ssh ${SSH_USER}@${SERVER} << 'ENDSSH'
    set -e

    echo "检查容器状态..."
    docker ps | grep sep-dev

    echo ""
    echo "检查健康状态..."
    curl -fsS https://sep-dev.longdaoSEP.cn/api/health/ready && echo "✅ 健康检查通过" || echo "❌ 健康检查失败"

    echo ""
    echo "检查静态资源..."
    curl -I https://sep-dev.longdaoSEP.cn/assets/employees/silicon/frontend-engineer.webp 2>&1 | grep "HTTP" || echo "⚠️  静态资源检查失败"
ENDSSH

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo ""
echo "📋 下一步操作："
echo "  1. 测试 API 接口："
echo "     curl -H 'Authorization: Bearer <token>' https://sep-dev.longdaoSEP.cn/api/client/subscriptions"
echo ""
echo "  2. 测试静态资源："
echo "     curl -I https://sep-dev.longdaoSEP.cn/assets/employees/silicon/frontend-engineer.webp"
echo ""
echo "  3. 通知客户端开发者："
echo "     - 阅读 docs/对接/客户端头像对接指南-v1.md"
echo "     - 开始联调测试"
echo ""
echo "📞 如有问题，联系后端团队"
echo ""
