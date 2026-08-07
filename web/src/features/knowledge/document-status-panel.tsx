'use client';

import { useState } from 'react';
import { RefreshCw, AlertCircle, CheckCircle, Clock, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  useDocumentStatus,
  useBatchReprocess,
  type DocumentStatusItem,
} from './use-knowledge-test';

interface DocumentStatusPanelProps {
  knowledgeBaseId: string;
}

const STATUS_CONFIG = {
  PENDING: {
    label: '等待处理',
    variant: 'glass-info' as const,
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  PROCESSING: {
    label: '处理中',
    variant: 'glass-info' as const,
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  },
  READY: {
    label: '已完成',
    variant: 'default' as const,
    icon: <CheckCircle className="h-3.5 w-3.5" />,
  },
  FAILED: {
    label: '处理失败',
    variant: 'glass-danger' as const,
    icon: <AlertCircle className="h-3.5 w-3.5" />,
  },
} as const;

export function DocumentStatusPanel({ knowledgeBaseId }: DocumentStatusPanelProps) {
  const [polling, setPolling] = useState(false);

  // 开启轮询时每 3s 刷新一次
  const { data, isLoading, refetch } = useDocumentStatus(knowledgeBaseId, {
    refetchInterval: polling ? 3000 : false,
  });

  const batchReprocess = useBatchReprocess(knowledgeBaseId);

  const hasProcessing = (data?.processing ?? 0) > 0 || (data?.pending ?? 0) > 0;
  const hasFailed = (data?.failed ?? 0) > 0;

  const handleBatchRetry = () => {
    batchReprocess.mutate({ statuses: ['FAILED'] });
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gtext-muted" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* 状态汇总 + 操作栏 */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <StatChip label="全部" count={data.total} />
          <StatChip label="待处理" count={data.pending} variant="info" />
          <StatChip label="处理中" count={data.processing} variant="info" />
          <StatChip label="已完成" count={data.ready} variant="success" />
          <StatChip label="失败" count={data.failed} variant="danger" />
        </div>

        <div className="flex items-center gap-2">
          {/* 自动刷新开关 */}
          <Button
            variant={polling ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setPolling((p) => !p)}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${polling ? 'animate-spin' : ''}`} />
            {polling ? '自动刷新中' : '自动刷新'}
          </Button>

          {/* 手动刷新 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="h-8 w-8 p-0"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>

          {/* 批量重试失败文档 */}
          {hasFailed && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBatchRetry}
              disabled={batchReprocess.isPending}
              className="gap-1.5 text-xs text-danger border-danger/30 hover:bg-danger/5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重试全部失败 ({data.failed})
            </Button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      {data.total > 0 && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-glassbg border border-glassline">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${(data.ready / data.total) * 100}%` }}
            />
          </div>
          <p className="text-xs text-gtext-muted text-right">
            {data.ready} / {data.total} 文档已向量化
          </p>
        </div>
      )}

      {/* 自动轮询提示 */}
      {hasProcessing && !polling && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
          <span>有文档正在处理中，建议开启自动刷新</span>
        </div>
      )}

      {/* 文档列表 */}
      <div className="space-y-2">
        {data.documents.map((doc) => (
          <DocumentStatusRow
            key={doc.id}
            doc={doc}
            knowledgeBaseId={knowledgeBaseId}
          />
        ))}
      </div>
    </div>
  );
}

// ── 单文档行 ──────────────────────────────────────────────────────────────────

function DocumentStatusRow({
  doc,
  knowledgeBaseId,
}: {
  doc: DocumentStatusItem;
  knowledgeBaseId: string;
}) {
  const config = STATUS_CONFIG[doc.status] ?? STATUS_CONFIG.PENDING;
  const batchReprocess = useBatchReprocess(knowledgeBaseId);

  const handleRetry = () => {
    batchReprocess.mutate({ documentIds: [doc.id] });
  };

  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-3">
        {/* 文档名 */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gtext-primary truncate">
            {doc.originalName}
          </p>
          {doc.status === 'FAILED' && doc.lastError && (
            <p className="mt-0.5 text-xs text-danger line-clamp-1">{doc.lastError}</p>
          )}
          {doc.status === 'READY' && doc.processedAt && (
            <p className="mt-0.5 text-xs text-gtext-muted">
              完成于 {new Date(doc.processedAt).toLocaleString('zh-CN')}
              {doc.embeddingModel && ` · ${doc.embeddingModel}`}
            </p>
          )}
        </div>

        {/* 版本号 */}
        {doc.version > 1 && (
          <span className="text-xs text-gtext-muted">v{doc.version}</span>
        )}

        {/* 状态徽章 */}
        <Badge variant={config.variant} className="flex items-center gap-1 text-xs">
          {config.icon}
          {config.label}
        </Badge>

        {/* 重试按钮 */}
        {doc.status === 'FAILED' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRetry}
            disabled={batchReprocess.isPending}
            className="h-7 px-2 text-xs"
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            重试
          </Button>
        )}
      </div>
    </Card>
  );
}

// ── 辅助组件 ──────────────────────────────────────────────────────────────────

function StatChip({
  label,
  count,
  variant,
}: {
  label: string;
  count: number;
  variant?: 'info' | 'success' | 'danger';
}) {
  const colorMap = {
    info: 'text-primary',
    success: 'text-success',
    danger: 'text-danger',
  };
  const textColor = variant ? colorMap[variant] : 'text-gtext-primary';

  return (
    <div className="text-center">
      <p className={`text-lg font-bold ${textColor}`}>{count}</p>
      <p className="text-xs text-gtext-muted">{label}</p>
    </div>
  );
}
