'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Search, Clock, Zap, AlertCircle } from 'lucide-react';
import { useTestSearch, type TestSearchResult } from './use-knowledge-test';

interface KnowledgeTestDialogProps {
  open: boolean;
  onClose: () => void;
  knowledgeBaseId: string;
  knowledgeBaseName?: string;
}

export function KnowledgeTestDialog({
  open,
  onClose,
  knowledgeBaseId,
  knowledgeBaseName,
}: KnowledgeTestDialogProps) {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(5);
  const [scoreThreshold, setScoreThreshold] = useState(0.5);
  const [useRerank, setUseRerank] = useState(false);

  const testSearch = useTestSearch(knowledgeBaseId);

  const handleSearch = () => {
    if (!query.trim()) return;
    testSearch.mutate({ query: query.trim(), topK, scoreThreshold, useRerank });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  const results = testSearch.data;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            检索测试
            {knowledgeBaseName && (
              <span className="text-sm font-normal text-gtext-muted ml-1">
                — {knowledgeBaseName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* 查询输入 */}
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="输入问题或关键词..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
              autoFocus
            />
            <Button
              onClick={handleSearch}
              disabled={!query.trim() || testSearch.isPending}
            >
              {testSearch.isPending ? '搜索中...' : '搜索'}
            </Button>
          </div>

          {/* 参数配置 */}
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-glassline bg-glassbg p-4">
            {/* topK */}
            <div className="space-y-2">
              <Label className="text-xs text-gtext-secondary flex items-center justify-between">
                <span>返回结果数</span>
                <span className="font-semibold text-gtext-primary">{topK}</span>
              </Label>
              <Slider
                value={[topK]}
                onValueChange={([v]) => setTopK(v)}
                min={1}
                max={20}
                step={1}
                className="w-full"
              />
            </div>

            {/* scoreThreshold */}
            <div className="space-y-2">
              <Label className="text-xs text-gtext-secondary flex items-center justify-between">
                <span>相似度阈值</span>
                <span className="font-semibold text-gtext-primary">
                  {scoreThreshold.toFixed(2)}
                </span>
              </Label>
              <Slider
                value={[scoreThreshold * 100]}
                onValueChange={([v]) => setScoreThreshold(v / 100)}
                min={0}
                max={100}
                step={5}
                className="w-full"
              />
            </div>

            {/* rerank */}
            <div className="flex items-center justify-between col-span-2">
              <Label className="text-xs text-gtext-secondary">启用重排序 (Rerank)</Label>
              <Switch checked={useRerank} onCheckedChange={setUseRerank} />
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {testSearch.isError && (
          <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>搜索失败，请稍后重试</span>
          </div>
        )}

        {/* 结果 */}
        {results && (
          <div className="space-y-3">
            {/* 元信息 */}
            <div className="flex items-center gap-3 text-xs text-gtext-muted">
              <span className="flex items-center gap-1">
                <Search className="h-3.5 w-3.5" />
                找到 {results.hitCount} 条结果
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                耗时 {results.durationMs}ms
              </span>
              <Badge variant="glass-info" className="text-xs">
                <Zap className="mr-1 h-3 w-3" />
                {results.strategy === 'vector' ? '向量检索' : '全文检索'}
              </Badge>
            </div>

            {results.hitCount === 0 ? (
              <div className="rounded-lg border border-glassline bg-glassbg p-6 text-center">
                <Search className="mx-auto mb-2 h-8 w-8 text-gtext-muted" />
                <p className="text-sm text-gtext-muted">没有找到相关内容</p>
                <p className="mt-1 text-xs text-gtext-muted">
                  尝试降低相似度阈值或使用不同的关键词
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {results.results.map((result, idx) => (
                  <ResultCard key={result.chunkId} result={result} rank={idx + 1} />
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResultCard({
  result,
  rank,
}: {
  result: TestSearchResult;
  rank: number;
}) {
  const scoreColor =
    result.score >= 0.8
      ? 'text-success'
      : result.score >= 0.6
      ? 'text-warning'
      : 'text-gtext-muted';

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
            {rank}
          </span>
          <span className="text-xs text-gtext-muted truncate max-w-48">
            来源: {result.source}
          </span>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${scoreColor}`}>
          {(result.score * 100).toFixed(1)}%
        </span>
      </div>
      <p className="text-sm text-gtext-secondary line-clamp-4 leading-relaxed">
        {result.content}
      </p>
    </Card>
  );
}
