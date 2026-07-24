'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/feedback';
import {
  useAllCapabilities,
  useApproveCapability,
  useRejectCapability,
} from '@/features/admin/use-admin';
import { CAPABILITY_TYPE_META } from '@/lib/utils';
import type { Capability } from '@/lib/types';

const STATUS_META: Record<string, { label: string; tone: string }> = {
  PENDING: { label: '待审核', tone: 'bg-warning/10 text-warning' },
  APPROVED: { label: '已通过', tone: 'bg-success/10 text-success' },
  REJECTED: { label: '已拒绝', tone: 'bg-danger/10 text-danger' },
};

function TypeBadge({ type }: { type: string }) {
  const meta = CAPABILITY_TYPE_META[type];
  return <Badge className={meta?.tone ?? ''}>{meta?.label ?? type}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status];
  return <Badge className={meta?.tone ?? ''}>{meta?.label ?? status}</Badge>;
}

function PendingRow({ cap }: { cap: Capability }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const approve = useApproveCapability();
  const reject = useRejectCapability();

  const handleApprove = () => approve.mutate(cap.id);
  const handleReject = () => {
    if (!reason.trim()) return;
    reject.mutate(
      { id: cap.id, reason: reason.trim() },
      { onSuccess: () => { setRejectOpen(false); setReason(''); } },
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{cap.name}</span>
            <TypeBadge type={cap.type} />
          </div>
          <p className="mt-1 text-sm text-fg-muted line-clamp-2">{cap.description}</p>
          <p className="mt-1 text-xs text-fg-subtle">
            提交于 {format(new Date(cap.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={handleApprove}
            disabled={approve.isPending}
          >
            通过
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRejectOpen((v) => !v)}
          >
            拒绝
          </Button>
        </div>
      </div>

      {rejectOpen && (
        <div className="flex items-center gap-2 border-t border-border pt-2">
          <input
            className="h-8 flex-1 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="请输入拒绝原因…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            size="sm"
            variant="danger"
            onClick={handleReject}
            disabled={!reason.trim() || reject.isPending}
          >
            确认拒绝
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setRejectOpen(false); setReason(''); }}
          >
            取消
          </Button>
        </div>
      )}
    </div>
  );
}

type TabKey = 'pending' | 'all';

export default function CapabilitiesPage() {
  const [tab, setTab] = useState<TabKey>('pending');
  const pendingQuery = useAllCapabilities('PENDING');
  const allQuery = useAllCapabilities();

  const pendingItems = pendingQuery.data?.items ?? [];
  const allItems = allQuery.data?.items ?? [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">能力审核</h1>

      <div className="flex gap-1 border-b border-border">
        {(
          [
            { key: 'pending', label: `待审核 (${pendingItems.length})` },
            { key: 'all', label: '全部' },
          ] as { key: TabKey; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-fg-muted hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <div className="space-y-3">
          {pendingQuery.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))
          ) : pendingItems.length === 0 ? (
            <p className="text-sm text-fg-subtle py-8 text-center">暂无待审核能力</p>
          ) : (
            pendingItems.map((cap) => <PendingRow key={cap.id} cap={cap} />)
          )}
        </div>
      )}

      {tab === 'all' && (
        <Card>
          <CardHeader>
            <CardTitle>全部能力</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {allQuery.isLoading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : allItems.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-subtle">暂无数据</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-fg-muted">
                    <th className="px-5 py-2 text-left font-medium">名称</th>
                    <th className="px-5 py-2 text-left font-medium">类型</th>
                    <th className="px-5 py-2 text-left font-medium">状态</th>
                    <th className="px-5 py-2 text-left font-medium">提交时间</th>
                  </tr>
                </thead>
                <tbody>
                  {allItems.map((cap) => (
                    <tr key={cap.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3 font-medium">{cap.name}</td>
                      <td className="px-5 py-3">
                        <TypeBadge type={cap.type} />
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={cap.status} />
                      </td>
                      <td className="px-5 py-3 text-fg-muted">
                        {format(new Date(cap.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
