"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { RefreshCw, Play, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import {
  usePlatformModels,
  useSyncModels,
  useUpdatePlatformModel,
  useTestModel,
} from "@/features/model/use-models";

// 厂商配置（图标路径和颜色）
const VENDOR_CONFIG: Record<string, { logo: string; name: string }> = {
  OpenAI: { logo: "/vendors/openai.png", name: "OpenAI" },
  Anthropic: { logo: "/vendors/anthropic.png", name: "Anthropic" },
  Google: { logo: "/vendors/google.png", name: "Google" },
  Meta: { logo: "/vendors/meta.png", name: "Meta" },
  Minimax: { logo: "/vendors/minimax.png", name: "Minimax" },
  Zhipu: { logo: "/vendors/zhipu.png", name: "智谱AI" },
  DeepSeek: { logo: "/vendors/deepseek.png", name: "DeepSeek" },
  Moonshot: { logo: "/vendors/kimi.png", name: "月之暗面" },
  Grok: { logo: "/vendors/grok.png", name: "Grok" },
};

// 根据 modelId 推断厂商
function inferVendor(modelId: string): keyof typeof VENDOR_CONFIG | "Other" {
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("text-")) {
    return "OpenAI";
  }
  if (modelId.startsWith("claude-")) return "Anthropic";
  if (modelId.startsWith("gemini-") || modelId.startsWith("palm-")) return "Google";
  if (modelId.startsWith("llama-")) return "Meta";
  if (modelId.startsWith("abab")) return "Minimax";
  if (modelId.startsWith("glm-")) return "Zhipu";
  if (modelId.startsWith("deepseek-")) return "DeepSeek";
  if (modelId.startsWith("moonshot-")) return "Moonshot";
  if (modelId.startsWith("grok-")) return "Grok";
  return "Other";
}

export default function ModelManagement() {
  const { data: models, isLoading } = usePlatformModels();
  const sync = useSyncModels();
  const updateModel = useUpdatePlatformModel();
  const testModel = useTestModel();

  const [searchQuery, setSearchQuery] = useState("");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // 筛选逻辑
  const filteredModels = useMemo(() => {
    if (!models) return [];

    return models.filter((model) => {
      const vendor = inferVendor(model.modelId);

      // 搜索过滤
      if (searchQuery && !model.modelId.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !model.label.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      // 厂商过滤
      if (vendorFilter !== "all" && vendor !== vendorFilter) {
        return false;
      }

      // 状态过滤
      if (statusFilter === "enabled" && !model.enabled) return false;
      if (statusFilter === "disabled" && model.enabled) return false;
      if (statusFilter === "stale" && !model.isStale) return false;

      return true;
    });
  }, [models, searchQuery, vendorFilter, statusFilter]);

  // 获取所有厂商列表
  const vendors = useMemo(() => {
    if (!models) return [];
    const vendorSet = new Set(models.map((m) => inferVendor(m.modelId)));
    return Array.from(vendorSet).sort();
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

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 操作栏 */}
      <Card variant="solid">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* 搜索框 */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
              <Input
                placeholder="搜索模型名称或ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* 厂商筛选 */}
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="px-3 py-2 border border-border rounded-md bg-bg-base text-sm"
            >
              <option value="all">全部厂商</option>
              {vendors.map((v) => (
                <option key={v} value={v}>
                  {VENDOR_CONFIG[v]?.name || v}
                </option>
              ))}
            </select>

            {/* 状态筛选 */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-border rounded-md bg-bg-base text-sm"
            >
              <option value="all">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已禁用</option>
              <option value="stale">已下架</option>
            </select>

            {/* 同步按钮 */}
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
                  同步上游
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 表格 */}
      <Card variant="solid">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-bg-subtle border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted">
                    厂商
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted">
                    模型ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted">
                    显示名称
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-fg-muted">
                    状态
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-fg-muted">
                    启用
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-fg-muted">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredModels.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
                      {searchQuery || vendorFilter !== "all" || statusFilter !== "all"
                        ? "没有符合条件的模型"
                        : "暂无模型，点击「同步上游」拉取"}
                    </td>
                  </tr>
                ) : (
                  filteredModels.map((model) => {
                    const vendor = inferVendor(model.modelId);
                    const vendorInfo = VENDOR_CONFIG[vendor];

                    return (
                      <tr key={model.id} className="hover:bg-bg-subtle transition-colors">
                        {/* 厂商图标 */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {vendorInfo ? (
                              <Image
                                src={vendorInfo.logo}
                                alt={vendorInfo.name}
                                width={24}
                                height={24}
                                className="rounded"
                              />
                            ) : (
                              <div className="w-6 h-6 bg-bg-subtle rounded flex items-center justify-center text-xs text-fg-muted">
                                ?
                              </div>
                            )}
                            <span className="text-sm text-fg-muted">
                              {vendorInfo?.name || vendor}
                            </span>
                          </div>
                        </td>

                        {/* 模型ID */}
                        <td className="px-4 py-3">
                          <code className="text-xs text-fg-base">{model.modelId}</code>
                        </td>

                        {/* 显示名称 */}
                        <td className="px-4 py-3 text-sm text-fg-base">
                          {model.label}
                        </td>

                        {/* 状态标签 */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {model.isStale && (
                              <Badge className="bg-warning/10 text-warning text-xs">
                                已下架
                              </Badge>
                            )}
                            {!model.hasPricing && (
                              <Badge className="bg-warning/10 text-warning text-xs">
                                保底计费
                              </Badge>
                            )}
                          </div>
                        </td>

                        {/* 启用开关 */}
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-primary"
                            checked={model.enabled}
                            disabled={model.isStale || updateModel.isPending}
                            onChange={(e) =>
                              toggle(model.id, e.target.checked, model.label)
                            }
                          />
                        </td>

                        {/* 操作 */}
                        <td className="px-4 py-3 text-center">
                          {model.enabled && !model.isStale && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={testModel.isPending}
                              onClick={() => handleTest(model.id, model.label)}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 统计信息 */}
          {filteredModels.length > 0 && (
            <div className="px-4 py-3 border-t border-border bg-bg-subtle text-xs text-fg-muted">
              显示 {filteredModels.length} / {models?.length || 0} 个模型
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
