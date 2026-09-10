#!/usr/bin/env bash
set -euo pipefail

# 生产备份：只操作 SEP 数据库和上传目录，不触碰共享 PostgreSQL/Redis 容器本身。
ENV_FILE="${SEP_ENV_FILE:-/opt/sep/.env}"
BACKUP_DIR="${SEP_BACKUP_DIR:-/opt/sep/backups}"
UPLOADS_DIR="${SEP_UPLOADS_DIR:-/opt/sep/uploads}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

[[ -f "$ENV_FILE" ]] || { echo "env 文件不存在: $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${DATABASE_URL:?DATABASE_URL 未配置}"
mkdir -p "$BACKUP_DIR/$TIMESTAMP"

pg_dump --format=custom --no-owner --file="$BACKUP_DIR/$TIMESTAMP/sep.dump" "$DATABASE_URL"
if [[ -d "$UPLOADS_DIR" ]]; then
  tar -C "$UPLOADS_DIR" -czf "$BACKUP_DIR/$TIMESTAMP/uploads.tar.gz" .
fi
(cd "$BACKUP_DIR/$TIMESTAMP" && shasum -a 256 * > SHA256SUMS)
ln -sfn "$BACKUP_DIR/$TIMESTAMP" "$BACKUP_DIR/latest"
echo "SEP 备份完成: $BACKUP_DIR/$TIMESTAMP"
