'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu, ChevronDown, Check } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { useEnabledModels } from '@/features/model/use-models';

interface ModelSwitcherProps {
  conversationId: string;
  /** 会话当前模型；null 表示用员工默认 */
  currentModelId: string | null;
  /** 员工默认模型（会话未指定时的兜底显示） */
  employeeModelId?: string | null;
}

/**
 * 对话窗口顶部的模型切换下拉。
 * 切换后 PATCH 会话，后续消息即用新模型。
 */
export function ModelSwitcher({
  conversationId,
  currentModelId,
  employeeModelId,
}: ModelSwitcherProps) {
  const qc = useQueryClient();
  const { data: models, isLoading } = useEnabledModels();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const switchModel = useMutation({
    mutationFn: (modelId: string) =>
      api.patch(`/conversations/${conversationId}/model`, { modelId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
      setIsOpen(false);
    },
  });

  // 生效模型：会话级 > 员工默认
  const effective = currentModelId ?? employeeModelId ?? '';
  const currentModel = models?.find((m) => m.id === effective);

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // 格式化价格
  const formatPrice = (price: number | null) => {
    if (price === null) return '未配置';
    return `¥${price.toFixed(2)}`;
  };

  // 格式化上下文长度
  const formatContext = (length: number | null) => {
    if (!length) return '';
    if (length >= 1000000) return `${(length / 1000000).toFixed(1)}M`;
    if (length >= 1000) return `${(length / 1000).toFixed(0)}k`;
    return `${length}`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading || switchModel.isPending}
        className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-xs text-fg-muted hover:bg-bg-subtle focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        title="切换该会话使用的模型"
      >
        <Cpu className="h-3.5 w-3.5 text-fg-subtle" />
        <span>{currentModel?.label || effective || '加载中...'}</span>
        <ChevronDown className="h-3 w-3 text-fg-subtle" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-border bg-background shadow-lg">
          <div className="max-h-96 overflow-y-auto">
            {isLoading && (
              <div className="px-3 py-2 text-xs text-fg-muted">加载模型...</div>
            )}
            {!isLoading && (!models || models.length === 0) && (
              <div className="px-3 py-2 text-xs text-fg-muted">上游未配置模型</div>
            )}
            {models?.map((model) => {
              const isActive = model.id === effective;
              const hasPricing =
                model.pricingInputPer1M !== null &&
                model.pricingOutputPer1M !== null;

              return (
                <button
                  key={model.id}
                  onClick={() => switchModel.mutate(model.id)}
                  disabled={switchModel.isPending}
                  className={`w-full px-3 py-2 text-left hover:bg-bg-subtle focus:bg-bg-subtle focus:outline-none disabled:opacity-60 ${
                    isActive ? 'bg-bg-subtle' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-medium text-xs text-fg">
                          {model.label}
                        </span>
                        {isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
                      </div>
                      {model.vendor && (
                        <div className="text-[10px] text-fg-muted mb-1">
                          {model.vendor}
                          {model.category && ` · ${model.category}`}
                        </div>
                      )}
                      {model.description && (
                        <div className="text-[10px] text-fg-subtle line-clamp-2 mb-1">
                          {model.description}
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-[10px] text-fg-muted">
                        {model.contextLength && (
                          <span title="上下文长度">
                            📄 {formatContext(model.contextLength)}
                          </span>
                        )}
                        {hasPricing ? (
                          <>
                            <span title="输入价格（每百万 tokens）">
                              ↓ {formatPrice(model.pricingInputPer1M)}/1M
                            </span>
                            <span title="输出价格（每百万 tokens）">
                              ↑ {formatPrice(model.pricingOutputPer1M)}/1M
                            </span>
                          </>
                        ) : (
                          <span className="text-amber-600">保底价计费</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
