'use client';

import { useRef } from 'react';
import { FileArchive, Loader2, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useUploadSkillPackage } from '../use-contributions';
import type { SkillPackageParseResult } from '../../../../../backend/src/shared';

export function SkillPackageUpload({ value, onChange }: { value: SkillPackageParseResult | null; onChange: (value: SkillPackageParseResult | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadSkillPackage();

  const choose = (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('请选择 .zip 文件');
      if (input.current) input.current.value = '';
      return;
    }
    upload.mutate(file, {
      onSuccess: onChange,
      onError: (error) => toast.error(error instanceof Error ? error.message : 'SKILL 包上传失败'),
    });
    if (input.current) input.current.value = '';
  };

  return (
    <div>
      <input ref={input} type="file" accept=".zip,application/zip" className="sr-only" onChange={(event) => choose(event.currentTarget.files?.[0])} />
      {value ? (
        <div className="rounded-glass-lg border border-glassline bg-glass-1 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-glass-md border border-glassline-brand bg-gbrand/10 text-gbrand-text"><FileArchive className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gtext-primary">{value.filename}</p>
                <p className="mt-1 text-xs text-gtext-muted">{value.fileCount} 个文件 · {formatBytes(value.totalBytes)} · SHA256 {value.sha256.slice(0, 12)}</p>
              </div>
            </div>
            <Button type="button" variant="glass" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
              {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              更换
            </Button>
          </div>
          <div className={`mt-3 text-xs ${value.validation.valid ? 'text-gsuccess' : 'text-gerror'}`} role="status">
            {value.validation.valid ? '服务端自动校验通过' : '服务端自动校验未通过，暂不能提交审核'}
          </div>
          {value.validation.issues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-gerror">
              {value.validation.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}</li>)}
            </ul>
          )}
          {value.validation.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-gtext-muted">
              {value.validation.warnings.map((warning, index) => <li key={`${warning.code}:${index}`}>{warning.message}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <button type="button" disabled={upload.isPending} onClick={() => input.current?.click()} className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-glass-lg border border-dashed border-glassline-brand bg-gbrand/5 p-6 text-center hover:bg-gbrand/10 disabled:opacity-60">
          <span className="grid h-11 w-11 place-items-center rounded-glass-lg border border-glassline-brand bg-gbrand/10 text-gbrand-text">{upload.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}</span>
          <span className="text-sm font-medium text-gtext-primary">{upload.isPending ? '正在检查 SKILL ZIP…' : '点击选择 SKILL ZIP 包'}</span>
          <span className="max-w-md text-xs leading-5 text-gtext-muted">ZIP 内必须包含 SKILL.md，压缩包最大 20MB。平台会校验内容，不会执行其中的脚本。</span>
        </button>
      )}
    </div>
  );
}

function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
