'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { TestSearchDtoSchema } from 'shared/knowledge.dto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTestSearch } from './use-knowledge-test';
import { DocumentPreview } from './document-preview';
import { knowledgeError } from './knowledge-ui';

export function KnowledgeSearchPanel({ knowledgeBaseId, maxQueryCharacters }: { knowledgeBaseId: string; maxQueryCharacters: number }) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const search = useTestSearch(knowledgeBaseId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (search.isPending) return;
    const parsed = TestSearchDtoSchema.pick({ query: true }).safeParse({ query: query.trim() });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请输入有效的查询内容'); return; }
    if ([...parsed.data.query].length > maxQueryCharacters) { setError(`查询最多 ${maxQueryCharacters} 个字符`); return; }
    setError(null);
    search.reset();
    try { await search.mutateAsync(parsed.data); } catch (cause) { setError(knowledgeError(cause)); }
  }

  return <section className="min-w-0 space-y-4"><div><h2 className="font-medium">检索验证</h2><p className="mt-1 text-sm text-gtext-muted">输入问题，检查资料能否被正确检索，并查看正文和来源。</p></div>
    <form onSubmit={submit} className="flex flex-wrap gap-2"><Input aria-label="检索问题" placeholder="输入问题或关键词" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1" /><Button type="submit" disabled={!query.trim() || search.isPending}><Search className="mr-2 h-4 w-4" />{search.isPending ? '检索中…' : '验证检索'}</Button></form>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!error && search.data && <div className="space-y-3"><p className="text-sm text-gtext-muted">找到 {search.data.results.length} 条相关内容</p>
      {!search.data.results.length && <p className="rounded-lg border border-dashed border-glassline p-8 text-center text-sm text-gtext-muted">未找到相关内容，请确认文档已处理完成或更换关键词。</p>}
      {search.data.results.map((result, index) => <article key={`${result.chunkId}-${index}`} className="min-w-0 space-y-3 rounded-lg border border-glassline p-4">
        <p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{result.content}</p>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="break-all text-xs text-gtext-muted">来源：{result.documentName || result.source || '文档正文'}</p>
          {result.documentId && <Button variant="outline" size="sm" onClick={() => setPreviewId(result.documentId!)}>查看文档正文</Button>}
        </div>
      </article>)}
    </div>}
    <DocumentPreview knowledgeBaseId={knowledgeBaseId} documentId={previewId} onClose={() => setPreviewId(null)} />
  </section>;
}
