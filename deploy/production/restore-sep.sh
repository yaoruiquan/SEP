#!/usr/bin/env bash
set -euo pipefail

# 恢复是破坏性操作，必须显式确认，并建议先在隔离数据库演练。
[[ "${CONFIRM_RESTORE:-}" == "YES" ]] || { echo "恢复会覆盖目标数据库，请设置 CONFIRM_RESTORE=YES" >&2; exit 2; }
ENV_FILE="${SEP_ENV_FILE:-/opt/sep/.env}"
BACKUP_DIR="${SEP_BACKUP_DIR:-/opt/sep/backups}"
BACKUP_PATH="${1:-$BACKUP_DIR/latest}"
[[ -f "$ENV_FILE" ]] || { echo "env 文件不存在: $ENV_FILE" >&2; exit 1; }
[[ -f "$BACKUP_PATH/sep.dump" ]] || { echo "备份不存在: $BACKUP_PATH/sep.dump" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${DATABASE_URL:?DATABASE_URL 未配置}"

(cd "$BACKUP_PATH" && shasum -a 256 -c SHA256SUMS)
pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$DATABASE_URL" "$BACKUP_PATH/sep.dump"
echo "数据库恢复完成。上传文件请按备份目录中的 uploads.tar.gz 单独恢复并执行完整性核验。"
