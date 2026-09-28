'use client';

import { useMemo, useState } from 'react';
import { Check, CloudUpload, FolderSearch, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SkillCandidate = {
  id: string;
  name: string;
  description: string | null;
  path: string;
  source: string;
  scope: 'user' | 'project';
  sha256: string;
  fileCount: number;
  totalBytes: number;
  files: string[];
};

type ScanResponse = { scannerVersion: string; items: SkillCandidate[] };

const DEFAULT_BRIDGE = 'http://127.0.0.1:3210';

/**
 * 通过本地 SEP Skill CLI/Bridge 扫描，不再使用浏览器目录选择器。
 * 扫描只在用户点击后发生；只有用户明确确认某一项后才会打包并上传。
 */
export function LocalSkillScanner({ onPackaged }: { onPackaged: (file: File) => void }) {
  const [items, setItems] = useState<SkillCandidate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [scannerVersion, setScannerVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const bridge = process.env.NEXT_PUBLIC_SEP_SKILL_BRIDGE_URL || DEFAULT_BRIDGE;

  async function scan() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${bridge}/scan?scope=all`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const body = await response.json() as ScanResponse | { message?: string };
      if (!response.ok || !('items' in body)) throw new Error('本地扫描器返回了无效结果');
      setItems(body.items);
      setScannerVersion(body.scannerVersion);
      setSelectedId(body.items[0]?.id ?? '');
      setMessage(body.items.length ? `已发现 ${body.items.length} 个本地 Skill，请选择后确认导入。` : '没有发现本地 Skill，请先在支持的 Agent 目录安装或创建 SKILL.md。');
    } catch (error) {
      setItems([]);
      setSelectedId('');
      setMessage(error instanceof Error ? `${error.message}。请先运行：node scripts/skill-scanner/sep-skill.mjs serve` : '无法连接本地 Skill CLI');
    } finally {
      setBusy(false);
    }
  }

  async function importSelected() {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${bridge}/package?id=${encodeURIComponent(selected.id)}&scope=all`, { cache: 'no-store' });
      if (!response.ok) throw new Error('本地 Skill 打包失败，请重新扫描后重试');
      const bytes = await response.arrayBuffer();
      onPackaged(new File([bytes], `${safeFilename(selected.name)}.zip`, { type: 'application/zip' }));
      setMessage(`已确认导入「${selected.name}」，平台正在进行服务端校验。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '本地 Skill 导入失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-glass-lg border border-glassline bg-glass-1 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-gbrand-text"><FolderSearch className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gtext-primary">自动扫描本地 Agent Skills</p>
          <p className="mt-1 text-xs leading-5 text-gtext-muted">
            由本机 SEP Skill CLI 扫描用户级和项目级 Agent Skills 目录。网页不会读取未授权的本地文件，也不会执行 Skill 内脚本。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void scan()} disabled={busy}>
              {busy && !selected ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              {items.length ? '重新扫描' : '扫描本地 Skills'}
            </Button>
            {selected && (
              <Button type="button" size="sm" onClick={() => void importSelected()} disabled={busy}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="mr-1.5 h-3.5 w-3.5" />}
                确认导入选中的 Skill
              </Button>
            )}
          </div>
          {scannerVersion && <p className="mt-2 text-[11px] text-gtext-muted">扫描器 v{scannerVersion} · 仅上传你确认的项目</p>}
          {items.length > 0 && (
            <div className="mt-4 grid gap-2" aria-label="本地 Skill 扫描结果">
              {items.map((item) => (
                <button key={`${item.id}:${item.path}`} type="button" onClick={() => setSelectedId(item.id)} className={cn('rounded-glass-md border p-3 text-left transition-colors', item.id === selectedId ? 'border-glassline-brand bg-gbrand/10' : 'border-glassline bg-glass-2 hover:border-glassline-brand/60')}>
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-gtext-primary">
                      {item.id === selectedId && <Check className="h-3.5 w-3.5 shrink-0 text-gbrand-text" />}
                      <span className="truncate">{item.name}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-gtext-muted">{item.fileCount} 个文件 · {formatBytes(item.totalBytes)}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-gtext-muted">{item.description || '未提供描述'}</span>
                  <span className="mt-1 flex items-center gap-1 text-[10px] text-gtext-muted"><Terminal className="h-3 w-3" />{item.source} · {item.scope} · {item.path}</span>
                </button>
              ))}
            </div>
          )}
          {message && <p className="mt-3 text-xs text-gtext-secondary" role="status">{message}</p>}
        </div>
      </div>
    </div>
  );
}

function safeFilename(value: string) { return (value || 'skill').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'skill'; }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
