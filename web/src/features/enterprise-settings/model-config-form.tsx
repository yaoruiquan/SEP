'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { ModelWhitelistPicker } from './model-whitelist-picker';
import { BudgetControlCard } from './budget-control-card';
import type { EnterpriseModelConfig, PlatformModel } from './use-model-config';
import type {
  UpdateEnterpriseModelConfigDto,
  EmployeeModelPolicy,
} from '@/lib/types';

interface ModelConfigFormProps {
  config: EnterpriseModelConfig;
  availableModels: PlatformModel[];
  onSave: (dto: UpdateEnterpriseModelConfigDto) => void;
  isSaving: boolean;
  readOnly?: boolean;
}

/** 表单内部状态：monthlyBudgetCNY 用 number 便于输入控件，提交时后端接受 number。 */
type FormState = {
  defaultChatModel: string;
  allowedChatModels: string[];
  allowUserSwitchModel: boolean;
  embeddingModel: string;
  rerankModel: string | null;
  embeddingBatchSize: number;
  embeddingTimeoutMs: number;
  employeeModelPolicy: EmployeeModelPolicy;
  employeeDefaultModel: string | null;
  monthlyBudgetCNY: number | null;
  alertThreshold: number;
  hardStopOnBudget: boolean;
};

function toFormState(config: EnterpriseModelConfig): FormState {
  return {
    defaultChatModel: config.defaultChatModel,
    allowedChatModels: config.allowedChatModels,
    allowUserSwitchModel: config.allowUserSwitchModel,
    embeddingModel: config.embeddingModel,
    rerankModel: config.rerankModel,
    embeddingBatchSize: config.embeddingBatchSize,
    embeddingTimeoutMs: config.embeddingTimeoutMs,
    employeeModelPolicy: config.employeeModelPolicy,
    employeeDefaultModel: config.employeeDefaultModel,
    monthlyBudgetCNY: config.monthlyBudgetCNY
      ? Number(config.monthlyBudgetCNY)
      : null,
    alertThreshold: config.alertThreshold,
    hardStopOnBudget: config.hardStopOnBudget,
  };
}

/**
 * 模型配置表单。
 *
 * 四个 Tab：会话模型 / 知识库模型 / 员工模型 / 预算控制。
 */
export function ModelConfigForm({
  config,
  availableModels,
  onSave,
  isSaving,
  readOnly = false,
}: ModelConfigFormProps) {
  const initial = useMemo(() => toFormState(config), [config]);
  const [form, setForm] = useState<FormState>(initial);
  const [activeTab, setActiveTab] = useState('chat');

  const patch = (next: Partial<FormState>) => setForm((f) => ({ ...f, ...next }));

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  // PlatformModel.category 目前几乎全为 null（同步任务还没补元数据），
  // 所以「非 embedding 即可用于会话」比「category === 'chat'」更贴近现实，
  // 否则白名单会是空列表。
  const chatModels = useMemo(
    () => availableModels.filter((m) => m.category !== 'embedding'),
    [availableModels],
  );
  const labelOf = (modelId: string) =>
    availableModels.find((m) => m.modelId === modelId)?.label ?? modelId;

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="chat">会话模型</TabsTrigger>
          <TabsTrigger value="knowledge">知识库模型</TabsTrigger>
          <TabsTrigger value="employee">员工模型</TabsTrigger>
          <TabsTrigger value="budget">预算控制</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: 会话模型 ─────────────────────────────────────────── */}
        <TabsContent value="chat" className="mt-4 space-y-6">
          <section className="space-y-4 rounded-lg border border-border bg-card p-6">
            <div>
              <h3 className="text-lg font-semibold">默认会话模型</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                成员发起新会话时使用的默认模型
              </p>
            </div>
            <div className="space-y-2">
              <Label>模型</Label>
              <Select
                value={form.defaultChatModel}
                onValueChange={(v) => patch({ defaultChatModel: v })}
                disabled={readOnly}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {chatModels.map((m) => (
                    <SelectItem key={m.modelId} value={m.modelId}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.allowedChatModels.length > 0 &&
                !form.allowedChatModels.includes(form.defaultChatModel) && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    默认模型不在白名单内，保存后成员将无法使用它。
                  </p>
                )}
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-border bg-card p-6">
            <div>
              <h3 className="text-lg font-semibold">可用模型白名单</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                成员在会话中可切换的模型范围。留空表示不限制，等同于平台全部已启用模型。
              </p>
            </div>
            <ModelWhitelistPicker
              models={chatModels}
              selectedModels={form.allowedChatModels}
              onChange={(ids) => patch({ allowedChatModels: ids })}
              disabled={readOnly}
            />
          </section>

          <section className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-6">
            <div className="space-y-1">
              <Label htmlFor="allow-switch" className="cursor-pointer font-medium">
                允许成员自行切换模型
              </Label>
              <p className="text-sm text-muted-foreground">
                关闭后，成员会话强制使用默认模型，聊天界面不再显示模型选择器
              </p>
            </div>
            <Switch
              id="allow-switch"
              checked={form.allowUserSwitchModel}
              onCheckedChange={(v) => patch({ allowUserSwitchModel: v })}
              disabled={readOnly}
            />
          </section>
        </TabsContent>

        {/* ── Tab 2: 知识库模型 ───────────────────────────────────────── */}
        <TabsContent value="knowledge" className="mt-4 space-y-6">
          <section className="space-y-4 rounded-lg border border-border bg-card p-6">
            <div>
              <h3 className="text-lg font-semibold">Embedding 模型</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                文档向量化由平台统一部署，变更模型后需要全量重建向量索引
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="embedding-model">模型</Label>
              <Input id="embedding-model" value={form.embeddingModel} disabled />
              <p className="text-xs text-muted-foreground">
                当前生效值来自平台环境变量 EMBEDDING_MODEL，企业成员不可修改。
              </p>
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-border bg-card p-6">
            <div>
              <h3 className="text-lg font-semibold">Rerank 模型（可选）</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                检索后重排序模型，留空则不使用
              </p>
            </div>
            <Input
              value={form.rerankModel ?? ''}
              onChange={(e) => patch({ rerankModel: e.target.value || null })}
              placeholder="留空表示不使用"
              disabled={readOnly}
            />
          </section>

          <section className="grid gap-4 rounded-lg border border-border bg-card p-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="batch-size">向量化批大小</Label>
              <Input
                id="batch-size"
                type="number"
                min={1}
                max={512}
                value={form.embeddingBatchSize}
                disabled
              />
              <p className="text-xs text-muted-foreground">
                平台部署参数 EMBEDDING_BATCH_SIZE
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeout">向量化超时（毫秒）</Label>
              <Input
                id="timeout"
                type="number"
                min={1000}
                step={1000}
                value={form.embeddingTimeoutMs}
                disabled
              />
              <p className="text-xs text-muted-foreground">
                平台部署参数 EMBEDDING_TIMEOUT_MS
              </p>
            </div>
          </section>
        </TabsContent>

        {/* ── Tab 3: 员工模型 ─────────────────────────────────────────── */}
        <TabsContent value="employee" className="mt-4 space-y-6">
          <section className="space-y-4 rounded-lg border border-border bg-card p-6">
            <div>
              <h3 className="text-lg font-semibold">硅基员工模型策略</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                决定硅基员工执行任务时使用哪个模型
              </p>
            </div>
            <div className="space-y-2">
              <Label>策略</Label>
              <Select
                value={form.employeeModelPolicy}
                onValueChange={(v) =>
                  patch({ employeeModelPolicy: v as EmployeeModelPolicy })
                }
                disabled={readOnly}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FOLLOW_TEMPLATE">
                    跟随员工模板（推荐）
                  </SelectItem>
                  <SelectItem value="FORCE_DEFAULT">强制使用指定模型</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.employeeModelPolicy === 'FOLLOW_TEMPLATE'
                  ? `员工使用自身模板配置的模型，未配置时回退到「${labelOf(form.defaultChatModel)}」。`
                  : '忽略员工模板配置，所有员工统一使用下方指定的模型。'}
              </p>
            </div>

            {form.employeeModelPolicy === 'FORCE_DEFAULT' && (
              <div className="space-y-2">
                <Label>指定模型</Label>
                <Select
                  value={form.employeeDefaultModel ?? form.defaultChatModel}
                  onValueChange={(v) => patch({ employeeDefaultModel: v })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {chatModels.map((m) => (
                      <SelectItem key={m.modelId} value={m.modelId}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  建议选择支持 function calling 的模型，否则员工无法调用工具。
                </p>
              </div>
            )}
          </section>
        </TabsContent>

        {/* ── Tab 4: 预算控制 ─────────────────────────────────────────── */}
        <TabsContent value="budget" className="mt-4">
          <BudgetControlCard
            monthlyBudget={form.monthlyBudgetCNY}
            alertThreshold={form.alertThreshold}
            hardStopOnBudget={form.hardStopOnBudget}
            onBudgetChange={(v) => patch({ monthlyBudgetCNY: v })}
            onThresholdChange={(v) => patch({ alertThreshold: v })}
            onHardStopChange={(v) => patch({ hardStopOnBudget: v })}
            disabled={readOnly}
          />
        </TabsContent>
      </Tabs>

      {!readOnly && (
        <div className="flex items-center justify-end gap-3">
          {isDirty && (
            <span className="text-sm text-muted-foreground">有未保存的修改</span>
          )}
          <Button
            variant="ghost"
            onClick={() => setForm(initial)}
            disabled={!isDirty || isSaving}
          >
            重置
          </Button>
          <Button onClick={() => onSave(form)} disabled={!isDirty || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存配置
          </Button>
        </div>
      )}
    </div>
  );
}
