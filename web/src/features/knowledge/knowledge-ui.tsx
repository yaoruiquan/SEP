'use client';

import { Fragment, type ComponentType, type ReactNode } from 'react';
import { useKnowledgeCacheScope } from './knowledge-cache';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/feedback';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';

export function useKnowledgeAdmin() {
  return useAuthStore((state) => !!state.enterprise && state.roleInEnterprise === 'ENTERPRISE_ADMIN');
}

export function KnowledgeAdminOnly({ children }: { children: ReactNode }) {
  const admin = useKnowledgeAdmin();
  const scope = useKnowledgeCacheScope();
  return admin ? <Fragment key={scope}>{children}</Fragment> : <ErrorState title="仅企业管理员可管理知识库" message="请在客户端使用已获授权的知识库。" />;
}

export function knowledgeError(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return '没有知识库管理权限，或企业成员身份已失效。';
  if (error instanceof ApiError && error.status === 404) return '资源不存在或当前账号无权访问。';
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后重试。';
}

export function KnowledgeError({ error, retry }: { error: unknown; retry?: () => void }) {
  return <ErrorState title="请求失败" message={knowledgeError(error)} onRetry={retry} />;
}

export function KnowledgeIconButton({ label, icon: Icon, onClick, disabled, danger }: {
  label: string; icon: ComponentType<{ className?: string }>; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <Button type="button" variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick} className={`h-8 w-8 shrink-0 ${danger ? 'text-danger' : ''}`}>
      <Icon className="h-4 w-4" />
    </Button>
  </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip></TooltipProvider>;
}

export function KnowledgePagination({ page, pageSize, total, onPage, disabled }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void; disabled?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm text-gtext-muted">
    <span>共 {total} 条</span><div className="flex items-center gap-2">
      <KnowledgeIconButton label="上一页" icon={ChevronLeft} disabled={disabled || page <= 1} onClick={() => onPage(page - 1)} />
      <span className="min-w-16 text-center">{page} / {pages}</span>
      <KnowledgeIconButton label="下一页" icon={ChevronRight} disabled={disabled || page >= pages} onClick={() => onPage(page + 1)} />
    </div>
  </div>;
}
