"use client";

import { useState, useMemo } from "react";
import { RefreshCw, AlertTriangle, Play, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import {
  usePlatformModels,
  useSyncModels,
  useUpdatePlatformModel,
  useTestModel,
} from "@/features/model/use-models";

// 厂商分组配置
const VENDOR_CONFIG = {
  OpenAI: { label: "OpenAI", color: "#10a37f" },
  Anthropic: { label: "Anthropic", color: "#c5a572" },
  Google: { label: "Google", color: "#4285f4" },
  Meta: { label: "Meta", color: "#0668e1" },
  Other: { label: "其他", color: "#64748b" },
};

// 根据 modelId 推断厂商
function inferVendor(modelId: string): keyof typeof VENDOR_CONFIG {
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("text-")) {
    return "OpenAI";
  }
  if (modelId.startsWith("claude-")) {
    return "Anthropic";
  }
  if (modelId.startsWith("gemini-") || modelId.startsWith("palm-")) {
    return "Google";
  }
  if (modelId.startsWith("llama-")) {
    return "Meta";
  }
  return "Other";
}

export default function ModelsPageNew() {
  const { data: models, isLoading } = usePlatformModels();
  const sync = useSyncModels();
  const updateModel = useUpdatePlatformModel();
  const testModel = useTestModel();

  const [hideDisabled, setHideDisabled] = useState(false);
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(
    new Set(Object.keys(VENDOR_CONFIG))
  );

  // 按厂商分组
  const groupedModels = useMemo(() => {
    if (!models) return {};

    const groups: Record<string, typeof models> = {};

    for (const model of models) {
      const vendor = inferVendor(model.modelId);
      if (!groups[vendor]) {
        groups[vendor] = [];
      }
      groups[vendor].push(model);
    }

    return groups;
  }, [models]);

  const handleSync = async () => {
    try {
      const r = await sync.mutateAsync();
      toast.success(
        `同步完成：上游 ${r.upstreamTotal} 个 · 新增 ${r.added} · 恢复 ${r.restored} · 失效 ${r.staled}`
      );
    } catch (err) {
      toast.error(`同步失败：${(err as Error).message}`);
    }
  };

  const toggle = async (id: string, enabled: boolean, label: string) => {
    try {
      await updateModel.mutateAsync({ id, enabled });
      toast.success(`${label} 已${enabled ? "启用" : "禁用"}`);
    } catch (err) {
      toast.error(`操作失败：${(err as Error).message}`);
    }
  };

  const handleTest = async (modelId: string, label: string) => {
    try {
      const result = await testModel.mutateAsync(modelId);
      toast.success(`${label} 测试成功\n响应: ${result.response}\n延迟: ${result.latency}ms`);
    } catch (err) {
      toast.error(`${label} 测试失败：${(err as Error).message}`);
    }
  };

  const toggleVendor = (vendor: string) => {
    setExpandedVendors((prev) => {
      const next = new Set(prev);
      if (next.has(vendor)) {
        next.delete(vendor);
      } else {
        next.add(vendor);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">可用模型</h1>
          <p className="mt-1 text-sm text-fg-muted">
            管理平台可用的 AI 模型，从上游同步后启用供用户使用
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideDisabled}
              onChange={(e) => setHideDisabled(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            只看已启用
          </label>
          <Button
            variant="primary"
            onClick={handleSync}
            disabled={sync.isPending}
          >
            {sync.isPending ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                同步中...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                同步上游模型
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 按厂商分组展示 */}
      <div className="space-y-4">
        {Object.entries(groupedModels).map(([vendor, vendorModels]) => {
          const config = VENDOR_CONFIG[vendor as keyof typeof VENDOR_CONFIG];
          const isExpanded = expandedVendors.has(vendor);
          const visibleModels = hideDisabled
            ? vendorModels.filter((m) => m.enabled)
            : vendorModels;

          if (visibleModels.length === 0) return null;

          return (
            <Card key={vendor} variant="solid">
              <CardHeader
                className="cursor-pointer"
                onClick={() => toggleVendor(vendor)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: config.color }}
                    />
                    <CardTitle className="text-lg">{config.label}</CardTitle>
                    <Badge variant="glass-info">{visibleModels.length} 个模型</Badge>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-fg-muted" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-fg-muted" />
                  )}
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {visibleModels.map((model) => (
                    <Card
                      key={model.id}
                      className={`transition-all ${
                        model.enabled
                          ? "border-success/30 bg-success/5"
                          : "opacity-60"
                      }`}
                    >
                      <CardContent className="space-y-3 p-4">
                        {/* 模型名称和状态 */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-semibold text-sm">{model.label}</h3>
                            <code className="text-xs text-fg-muted break-all">
                              {model.modelId}
                            </code>
                          </div>
                          <label className="shrink-0">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-primary"
                              checked={model.enabled}
                              disabled={model.isStale || updateModel.isPending}
                              onChange={(e) =>
                                toggle(model.id, e.target.checked, model.label)
                              }
                            />
                          </label>
                        </div>

                        {/* 状态标签 */}
                        <div className="flex flex-wrap gap-1.5">
                          {model.isStale && (
                            <Badge className="bg-warning/10 text-warning text-xs">
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              已下架
                            </Badge>
                          )}
                          {!model.hasPricing && (
                            <Badge
                              className="bg-warning/10 text-warning text-xs"
                              title="未配置价格，按保底价计费"
                            >
                              保底计费
                            </Badge>
                          )}
                        </div>

                        {/* 测试按钮 */}
                        {model.enabled && !model.isStale && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            disabled={testModel.isPending}
                            onClick={() => handleTest(model.modelId, model.label)}
                          >
                            <Play className="mr-2 h-3 w-3" />
                            测试模型
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {models && models.length === 0 && (
        <Card variant="solid">
          <CardContent className="py-12 text-center">
            <p className="text-fg-muted">
              🔌 还没有模型，点击「同步上游模型」拉取
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
