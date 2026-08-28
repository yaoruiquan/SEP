'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Check, FileArchive, Loader2, RotateCcw, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { useUploadSkillPackage } from '../use-contributions';
import type { SkillPackageParseResult } from '../../../../../backend/src/shared';

/** 正文预览折叠前显示的行数。SKILL.md 动辄几百行，全展开会把弹窗撑爆。 */
const PREVIEW_LINES = 12;

export function SkillPackageUpload({
  value,
  onChange,
}: {
  value: SkillPackageParseResult | null;
  onChange: (result: SkillPackageParseResult | null) => void;
}) {
  const upload = useUploadSkillPackage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const submit = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('只支持 .zip 文件', '包内需要包含 SKILL.md');
      return;
    }
    upload.mutate(file, {
      onSuccess: (result) => {
        onChange(result);
        toast.success('包已解析', `SKILL.md 已读取，共 ${result.fileCount} 个文件`);
      },
      onError: (error) => {
        onChange(null);
        toast.error(error instanceof Error ? error.message : '上传失败');
      },
    });
  };

  if (value) {
    return <ParsedPackage value={value} onReplace={() => onChange(null)} />;
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(event) => {
          submit(event.target.files?.[0]);
          // 清空 value，否则同一个文件改完再选不会触发 change
          event.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          submit(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          'flex w-full flex-col items-center gap-3 rounded-glass-lg border border-dashed px-6 py-10 text-center transition-colors duration-200',
          dragging
            ? 'border-glassline-brand bg-gbrand/10'
            : 'border-glassline bg-glass-1/50 hover:border-glassline-brand/60 hover:bg-glass-2',
        )}
      >
        <span className="grid h-11 w-11 place-items-center rounded-glass-lg border border-glassline-brand bg-gbrand/10 text-gbrand-text">
          {upload.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        </span>
        <span className="text-sm font-medium text-gtext-primary">
          {upload.isPending ? '正在解析包...' : '拖入 zip 包，或点击选择'}
        </span>
        <span className="text-xs leading-5 text-gtext-muted">
          包内必须包含 SKILL.md，可以带附件与示例。单个包不超过 20MB。
        </span>
      </button>
    </div>
  );
}

function ParsedPackage({
  value,
  onReplace,
}: {
  value: SkillPackageParseResult;
  onReplace: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = value.content.split('\n');
  const truncated = !expanded && lines.length > PREVIEW_LINES;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-glass-lg border border-glassline bg-glass-1 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-glass-md border border-glassline-brand bg-gbrand/10 text-gbrand-text">
            <FileArchive className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gtext-primary">{value.filename}</p>
            <p className="mt-1 text-xs text-gtext-muted">
              {value.fileCount} 个文件 · {formatBytes(value.totalBytes)} · sha256 {value.sha256.slice(0, 12)}
            </p>
          </div>
        </div>
        <Button variant="glass" size="sm" onClick={onReplace}>
          <RotateCcw className="h-3.5 w-3.5" />
          换一个包
        </Button>
      </div>

      <ValidationSummary validation={value.validation} />

      <div>
        <p className="text-sm text-gtext-secondary">SKILL.md 正文</p>
        <pre className="mt-1.5 max-h-64 overflow-auto rounded-glass-md border border-glassline bg-glass-2 p-3 font-mono text-xs leading-6 text-gtext-primary scroll-thin">
          {truncated ? `${lines.slice(0, PREVIEW_LINES).join('\n')}\n…` : value.content}
        </pre>
        {lines.length > PREVIEW_LINES && (
          <button
            type="button"
            className="mt-1.5 text-xs text-gbrand-text hover:underline"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '收起' : `展开全部 ${lines.length} 行`}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 上传即校验的结论。
 * 校验不通过不拦创建 —— 草稿可以先存，门禁在提交审核那一步（后端同样如此）。
 * 这里的作用是让问题在第二步就可见，而不是三步走完点提交才报错。
 */
function ValidationSummary({
  validation,
}: {
  validation: SkillPackageParseResult['validation'];
}) {
  const failed = validation.checks.filter((check) => !check.passed);

  return (
    <div
      className={cn(
        'rounded-glass-lg border p-4',
        validation.valid
          ? 'border-gsuccess/28 bg-gsuccess/10'
          : 'border-gwarning/28 bg-gwarning/10',
      )}
    >
      <p className="flex items-center gap-2 text-sm font-medium text-gtext-primary">
        {validation.valid ? (
          <Check className="h-4 w-4 text-gsuccess" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-gwarning" />
        )}
        {validation.valid ? '自动校验通过' : `还有 ${failed.length} 项待补齐`}
      </p>
      {!validation.valid && (
        <p className="mt-1 text-xs leading-5 text-gtext-secondary">
          现在仍可创建草稿，但提交审核前需要修掉这些问题。
        </p>
      )}
      <ul className="mt-3 grid gap-1.5">
        {validation.checks.map((check) => (
          <li key={check.code} className="flex items-start gap-2 text-xs leading-5">
            {check.passed ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gsuccess" />
            ) : (
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gwarning" />
            )}
            <span className={check.passed ? 'text-gtext-muted' : 'text-gtext-primary'}>
              {check.message}
            </span>
          </li>
        ))}
        {validation.warnings.map((warning) => (
          <li key={warning.code} className="flex items-start gap-2 text-xs leading-5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gtext-muted" />
            <span className="text-gtext-muted">{warning.message}（建议）</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
