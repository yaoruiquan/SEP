'use client';

import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { usePublishPackage } from '@/features/employee/use-packages';

interface Props {
  employeeId: string;
  employeeName: string;
  currentVersion: string;
  onClose: () => void;
}

export function PublishPackageDialog({
  employeeId,
  employeeName,
  currentVersion,
  onClose,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [changelog, setChangelog] = useState('');
  const [versionErr, setVersionErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const publish = usePublishPackage();

  const validateVersion = (v: string) => {
    if (!v.trim()) return '版本号不能为空';
    if (!/^\d+\.\d+\.\d+$/.test(v.trim())) return '格式须为 x.y.z';
    return '';
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.endsWith('.zip')) {
      toast.error('只能上传 .zip 文件');
      e.target.value = '';
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error('文件不能超过 20MB');
      e.target.value = '';
      return;
    }
    setFile(f);
  };

  const handleSubmit = () => {
    const err = validateVersion(version);
    if (err) { setVersionErr(err); return; }
    if (!file) { toast.error('请选择要上传的 ZIP 文件'); return; }

    publish.mutate(
      { employeeId, file, version: version.trim(), changelog: changelog.trim() || undefined },
      {
        onSuccess: (pkg) => {
          toast.success(
            `已发布 v${pkg.version}，SHA-256: ${pkg.sha256.slice(0, 12)}…`,
          );
          onClose();
        },
        onError: (err) => toast.error((err as Error).message || '发布失败'),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h3 className="text-base font-semibold">发布新版本</h3>
            <p className="text-xs text-fg-muted">
              {employeeName} · 当前 v{currentVersion}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={publish.isPending}
            className="text-fg-muted hover:text-foreground disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* 文件上传 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              员工包（ZIP 文件）*
            </label>
            <Input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              disabled={publish.isPending}
              onChange={handleFile}
            />
            {file && (
              <p className="mt-1 text-xs text-fg-muted">
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
            <p className="mt-1 text-xs text-fg-subtle">
              包含 skills 目录与 README.md 说明，≤ 20MB
            </p>
          </div>

          {/* 版本号 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">版本号 *</label>
            <Input
              placeholder="1.2.0"
              value={version}
              disabled={publish.isPending}
              onChange={(e) => {
                setVersion(e.target.value);
                setVersionErr(validateVersion(e.target.value));
              }}
            />
            {versionErr && (
              <p className="mt-1 text-xs text-danger">{versionErr}</p>
            )}
            <p className="mt-1 text-xs text-fg-subtle">
              格式 x.y.z。发布后模板版本同步更新，触发已有实例的升级提示。
            </p>
          </div>

          {/* 更新说明 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              更新说明（可选）
            </label>
            <textarea
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              rows={3}
              placeholder="新增了什么能力、修复了什么问题…"
              disabled={publish.isPending}
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
            />
          </div>

          {/* 操作 */}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={publish.isPending}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={publish.isPending || !file || !version.trim()}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {publish.isPending ? '发布中…' : '发布'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
