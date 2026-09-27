'use client';

import { useMemo, useRef, useState } from 'react';
import { FolderSearch, Loader2, Package, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SkillCandidate = {
  key: string;
  name: string;
  description: string | null;
  files: File[];
  totalBytes: number;
};

export function LocalSkillScanner({ onPackaged }: { onPackaged: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.key === selectedKey) ?? null,
    [candidates, selectedKey],
  );

  async function handleFiles(fileList: FileList | null) {
    setMessage(null);
    setCandidates([]);
    setSelectedKey('');
    if (!fileList?.length) return;

    const files = Array.from(fileList);
    const paths = files.map((file) => ({ file, path: normalizeRelativePath(file) }));
    const skillRoots = paths
      .filter(({ path }) => path.split('/').pop() === 'SKILL.md')
      .map(({ path }) => path.split('/').slice(0, -1).join('/'));
    const uniqueRoots = [...new Set(skillRoots)].sort((a, b) => b.split('/').length - a.split('/').length);

    const grouped = new Map<string, File[]>();
    for (const { file, path } of paths) {
      const skillRoot = uniqueRoots.find((root) => root === '' || path === `${root}/SKILL.md` || path.startsWith(`${root}/`));
      if (skillRoot === undefined) continue;
      const current = grouped.get(skillRoot) ?? [];
      current.push(file);
      grouped.set(skillRoot, current);
    }

    const next: SkillCandidate[] = [];
    for (const [key, groupedFiles] of grouped) {
      const filesForSkill = groupedFiles.sort((a, b) => normalizeRelativePath(a).localeCompare(normalizeRelativePath(b)));
      const skillFile = filesForSkill.find((file) => normalizeRelativePath(file).split('/').pop() === 'SKILL.md');
      if (!skillFile) continue;
      const content = await skillFile.text();
      const metadata = parseFrontmatter(content);
      next.push({
        key,
        name: metadata.name || key.split('/').filter(Boolean).pop() || '未命名 Skill',
        description: metadata.description,
        files: filesForSkill,
        totalBytes: filesForSkill.reduce((sum, file) => sum + file.size, 0),
      });
    }

    next.sort((a, b) => a.name.localeCompare(b.name));
    setCandidates(next);
    if (next.length) setSelectedKey(next[0].key);
    else setMessage('没有识别到 Skill。请选择包含一个或多个一级 SKILL.md 的本地目录。');
  }

  async function packageSelected() {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const files = await Promise.all(selected.files.map(async (file) => ({
        name: normalizeArchivePath(file, selected.key),
        data: new Uint8Array(await file.arrayBuffer()),
      })));
      const bytes = createStoredZip(files);
      const filename = `${safeFilename(selected.name)}.zip`;
      onPackaged(new File([bytes], filename, { type: 'application/zip' }));
      setMessage(`已打包 ${selected.name}，接下来会自动上传并校验。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '本地 Skill 打包失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-glass-lg border border-glassline bg-glass-1 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-gbrand-text"><FolderSearch className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gtext-primary">从本地 Agent 目录扫描</p>
          <p className="mt-1 text-xs leading-5 text-gtext-muted">
            选择本地的 skills 根目录或某个 Skill 目录。浏览器不会后台读取磁盘，只有你主动选择并确认后才会上传。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />选择本地目录
            </Button>
            {selected && (
              <Button type="button" size="sm" onClick={() => void packageSelected()} disabled={busy}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Package className="mr-1.5 h-3.5 w-3.5" />}
                使用选中的 Skill
              </Button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={(event) => void handleFiles(event.target.files)}
            className="hidden"
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />
          {candidates.length > 0 && (
            <div className="mt-4 grid gap-2">
              {candidates.map((candidate) => (
                <button
                  key={candidate.key}
                  type="button"
                  onClick={() => setSelectedKey(candidate.key)}
                  className={cn(
                    'rounded-glass-md border p-3 text-left transition-colors',
                    candidate.key === selectedKey ? 'border-glassline-brand bg-gbrand/10' : 'border-glassline bg-glass-2 hover:border-glassline-brand/60',
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-gtext-primary">{candidate.name}</span>
                    <span className="shrink-0 text-[11px] text-gtext-muted">{candidate.files.length} 个文件 · {formatBytes(candidate.totalBytes)}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-gtext-muted">{candidate.description || candidate.key || '未提供描述'}</span>
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

function normalizeRelativePath(file: File) {
  return (file.webkitRelativePath || file.name).replaceAll('\\', '/').replace(/^\/+/, '');
}

function normalizeArchivePath(file: File, skillKey: string) {
  const relativePath = normalizeRelativePath(file);
  const marker = skillKey ? `${skillKey}/` : '';
  const index = marker ? relativePath.indexOf(marker) : -1;
  const path = index >= 0 ? relativePath.slice(index + marker.length) : relativePath.split('/').pop() || file.name;
  return path.replaceAll('\\', '/').replace(/^\/+/, '');
}

function parseFrontmatter(content: string) {
  if (!content.startsWith('---')) return { name: null, description: null };
  const end = content.indexOf('\n---', 3);
  if (end < 0) return { name: null, description: null };
  const result: { name: string | null; description: string | null } = { name: null, description: null };
  for (const line of content.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^(name|description)\s*:\s*(.*)$/i);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '') || null;
    if (match[1].toLowerCase() === 'name') result.name = value;
    else result.description = value;
  }
  return result;
}

function safeFilename(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'skill';
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

type ZipEntry = { name: string; data: Uint8Array };

/** 生成无压缩 ZIP，避免为了本地导入引入新的前端依赖。 */
function createStoredZip(entries: ZipEntry[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x800, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concatBytes([...localParts, ...centralParts, end]);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
