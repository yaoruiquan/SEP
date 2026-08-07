'use client';

import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import { ModelConfigForm } from '@/features/enterprise-settings/model-config-form';
import {
  useModelConfig,
  useAvailableModels,
  useUpdateModelConfig,
} from '@/features/enterprise-settings/use-model-config';
import { Loader2 } from 'lucide-react';

export default function ModelsSettingsPage() {
  const { enterprise, roleInEnterprise } = useAuth();
  const enterpriseId = enterprise?.id ?? '';
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const configQuery = useModelConfig(enterpriseId);
  const modelsQuery = useAvailableModels(enterpriseId);
  const updateMutation = useUpdateModelConfig(enterpriseId);

  const isLoading = configQuery.isLoading || modelsQuery.isLoading;
  const error = configQuery.error ?? modelsQuery.error;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-2xl font-bold">模型配置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          配置企业级模型策略、白名单与预算控制
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              {error instanceof ApiError ? error.message : '加载配置失败'}
            </div>
          ) : configQuery.data && modelsQuery.data ? (
            <>
              {!isAdmin && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                  只有企业管理员可以修改模型配置，当前为只读视图。
                </div>
              )}
              <ModelConfigForm
                config={configQuery.data}
                availableModels={modelsQuery.data}
                readOnly={!isAdmin}
                isSaving={updateMutation.isPending}
                onSave={(dto) => {
                  updateMutation.mutate(dto, {
                    onSuccess: () => toast.success('模型配置已更新'),
                    onError: (e) =>
                      toast.error(e instanceof ApiError ? e.message : '更新失败'),
                  });
                }}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
