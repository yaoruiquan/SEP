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
  const [mode, setMode] = useState<'zip' | 'ref'>('zip');
  const [file, setFile] = useState<File | null>(null);
  const [refType, setRefType] = useState<'npm' | 'git'>('npm');
  const [refSpec, setRefSpec] = useState('');
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
    if (mode === 'zip' && !file) { toast.error('请选择要上传的 ZIP 文件'); return; }
    if (mode === 'ref' && !refSpec.trim()) { toast.error('请输入 package 引用'); return; }

    const payload = {
      employeeId,
      version: version.trim(),
      changelog: changelog.trim() || undefined,
      ...(mode === 'zip'
        ? { file: file! }
        : { packageRef: { type: refType, spec: refSpec.trim() } }),
    };

    publish.mutate(payload, {
      onSuccess: (pkg) => {
        const info = pkg.sha256
          ? `SHA-256: ${pkg.sha256.slice(0, 12)}…`
          : `packageRef: ${JSON.stringify(pkg.packageRef)}`;
        toast.success(`已发布 v${pkg.version}，${info}`);
        onClose();
      },
      onError: (err) => toast.error((err as Error).message || '发布失败'),
    });
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
          {/* 分发方式切换 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">分发方式 *</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('zip')}
                className={`flex-1 rounded border px-3 py-1.5 text-sm ${mode === 'zip' ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-background text-fg-muted hover:bg-muted/40'}`}
                disabled={publish.isPending}
              >
                ZIP 文件上传
              </button>
              <button
                type="button"
                onClick={() => setMode('ref')}
                className={`flex-1 rounded border px-3 py-1.5 text-sm ${mode === 'ref' ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-background text-fg-muted hover:bg-muted/40'}`}
                disabled={publish.isPending}
              >
                Package 引用
              </button>
            </div>
          </div>

          {/* ZIP 上传 */}
          {mode === 'zip' && (
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
          )}

          {/* Package 引用 */}
          {mode === 'ref' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">引用类型</label>
                <select
                  value={refType}
                  onChange={(e) => setRefType(e.target.value as 'npm' | 'git')}
                  disabled={publish.isPending}
                  className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="npm">npm</option>
                  <option value="git">git</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  {refType === 'npm' ? 'npm 包名（含版本）*' : 'git 仓库地址 *'}
                </label>
                <Input
                  placeholder={refType === 'npm' ? '@company/my-employee@1.2.0' : 'https://github.com/org/repo.git#v1.2.0'}
                  value={refSpec}
                  disabled={publish.isPending}
                  onChange={(e) => setRefSpec(e.target.value)}
                />
                <p className="mt-1 text-xs text-fg-subtle">
                  客户端将通过 pi 的 package 机制安装此引用
                </p>
              </div>
            </div>
          )}

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
            {/* 提示式升级：只提示，不自动跟进已有雇佣关系锁定的版本 */}
            <p className="mt-1 text-xs text-fg-subtle">
              格式 x.y.z。发布后模板版本同步更新，已雇佣的企业会收到升级提示。
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
              disabled={
                publish.isPending ||
                !version.trim() ||
                (mode === 'zip' ? !file : !refSpec.trim())
              }
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
