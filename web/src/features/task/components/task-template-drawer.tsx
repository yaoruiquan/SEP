'use client';

import { Bookmark, Loader2, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskTemplate } from '../task-run';

/** 工作流模板抽屉。模板与任务记录分开存，载入时生成一份全新的待确认计划。 */
export function TaskTemplateDrawer({
  open,
  templates,
  loading,
  busyId,
  onOpenChange,
  onLoad,
  onDelete,
}: {
  open: boolean;
  templates: TaskTemplate[];
  loading: boolean;
  busyId?: string;
  onOpenChange: (open: boolean) => void;
  onLoad: (template: TaskTemplate) => void;
  onDelete: (template: TaskTemplate) => void;
}) {
  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-40 flex justify-end bg-gbg-deep/55 backdrop-blur-glass-xs"
      onClick={() => onOpenChange(false)}
      role="presentation"
    >
      <aside
        className="flex h-full w-[min(23rem,100vw)] flex-col border-l border-glassline bg-gbg-raised shadow-glass-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-glassline px-4 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-gtext-primary">
              <Bookmark className="h-4 w-4 text-gbrand-text" />
              工作流模板
            </p>
            <p className="mt-1 text-[11px] text-gtext-muted">载入后会生成一份新的待确认计划</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-glass-md text-gtext-muted transition-colors hover:bg-glass-2 hover:text-gtext-primary"
            aria-label="关闭模板列表"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 scroll-thin">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-gtext-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在读取模板
            </div>
          ) : templates.length === 0 ? (
            <div className="grid place-items-center py-12 text-center">
              <Bookmark className="h-6 w-6 text-gtext-disabled" />
              <p className="mt-3 text-sm font-medium text-gtext-secondary">还没有保存的模板</p>
              <p className="mt-1 text-[11px] text-gtext-muted">在执行计划页点「存为模板」</p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={cn(
                    'group rounded-glass-lg border border-glassline bg-glass-1 px-3 py-2.5 transition-colors duration-200 hover:border-glassline-brand hover:bg-glass-2',
                    busyId === template.id && 'opacity-60',
                  )}
                >
                  <button type="button" onClick={() => onLoad(template)} className="w-full text-left">
                    <p className="line-clamp-2 text-xs font-medium leading-5 text-gtext-primary">{template.name}</p>
                    <p className="mt-1.5 text-[10px] text-gtext-muted">
                      {template.steps.length} 位员工 · 存于 {new Date(template.createdAt).toLocaleDateString('zh-CN')}
                    </p>
                  </button>
                  <div className="mt-1.5 flex justify-end opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => onDelete(template)}
                      className="grid h-6 w-6 place-items-center rounded-glass-md text-gtext-muted transition-colors hover:bg-gdanger/12 hover:text-gdanger"
                      aria-label="删除模板"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
