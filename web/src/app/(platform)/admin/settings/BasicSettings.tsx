'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CenteredSpinner } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { useSettings, useUpdateSettings } from '@/features/admin/use-admin';
import { useUpstreamModels } from '@/features/model/use-models';

export default function BasicSettings() {
  const { data: settings, isLoading } = useSettings();
  const update = useUpdateSettings();
  const {
    data: models,
    refetch: refetchModels,
    isFetching: modelsFetching,
    error: modelsError,
  } = useUpstreamModels();

  // 本地编辑态：key -> 输入值
  const [edits, setEdits] = useState<Record<string, string>>({});

  // settings 加载后，用非敏感项的现值初始化输入框（敏感项留空=不改）
  useEffect(() => {
    if (!settings) return;
    const init: Record<string, string> = {};
    for (const s of settings) {
      init[s.key] = s.secret ? '' : (s.value ?? '');
    }
    setEdits(init);
  }, [settings]);

  if (isLoading) return <CenteredSpinner label="加载设置…" />;

  const handleSave = async () => {
    // 只提交有改动的项：非敏感项全提交；敏感项仅当填了新值才提交
    const payload: Record<string, string> = {};
    for (const s of settings ?? []) {
      const v = edits[s.key] ?? '';
      if (s.secret) {
        if (v.trim() !== '') payload[s.key] = v.trim();
      } else {
        payload[s.key] = v.trim();
      }
    }
    try {
      await update.mutateAsync(payload);
      toast.success('设置已保存');
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  };

  // 辅助函数：渲染输入字段
  const renderField = (key: string, label: string, type: 'text' | 'email' | 'number' | 'switch' | 'textarea' = 'text', tooltip?: string) => {
    const setting = settings?.find((s) => s.key === key);
    const value = edits[key] ?? '';
    const isSecret = setting?.secret ?? false;

    if (type === 'switch') {
      return (
        <div className="flex items-center justify-between" title={tooltip}>
          <div>
            <label className="text-sm font-medium">{label}</label>
            {tooltip && <p className="text-xs text-muted-foreground">{tooltip}</p>}
          </div>
          <Switch
            checked={value === 'true'}
            onCheckedChange={(checked) =>
              setEdits((prev) => ({ ...prev, [key]: checked ? 'true' : 'false' }))
            }
          />
        </div>
      );
    }

    if (type === 'textarea') {
      return (
        <div title={tooltip}>
          <label className="text-sm font-medium block mb-1.5">
            {label}
            {isSecret && setting?.configured && (
              <span className="ml-2 text-success">已配置</span>
            )}
          </label>
          {tooltip && <p className="text-xs text-muted-foreground mb-1.5">{tooltip}</p>}
          <Textarea
            value={value}
            placeholder={isSecret ? '留空则不修改' : ''}
            onChange={(e) =>
              setEdits((prev) => ({ ...prev, [key]: e.target.value }))
            }
            rows={3}
          />
        </div>
      );
    }

    return (
      <div title={tooltip}>
        <label className="text-sm font-medium block mb-1.5">
          {label}
          {isSecret && setting?.configured && (
            <span className="ml-2 text-success">已配置</span>
          )}
        </label>
        {tooltip && <p className="text-xs text-muted-foreground mb-1.5">{tooltip}</p>}
        <Input
          type={isSecret ? 'password' : type}
          value={value}
          placeholder={isSecret ? '留空则不修改' : ''}
          onChange={(e) =>
            setEdits((prev) => ({ ...prev, [key]: e.target.value }))
          }
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. 平台基础信息 */}
      <Card>
        <CardHeader>
          <CardTitle>平台基础信息</CardTitle>
          <CardDescription>配置平台对外展示的基本信息</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderField('PLATFORM_NAME', '平台名称', 'text', '显示在页面标题、页脚等位置')}
          {renderField('PLATFORM_LOGO_URL', '平台Logo地址', 'text', '完整URL，留空则使用默认Logo')}
          {renderField('SUPPORT_EMAIL', '客服邮箱', 'email', '用户联系客服的邮箱地址')}
          {renderField('SUPPORT_PHONE', '客服电话', 'text', '用户联系客服的电话号码（可选）')}
          {renderField('ICP_NUMBER', '备案号', 'text', '网站ICP备案号，显示在页脚')}
        </CardContent>
      </Card>

      {/* 2. 上游渠道配置 */}
      <Card>
        <CardHeader>
          <CardTitle>上游渠道配置</CardTitle>
          <CardDescription>配置sub2api模型中继服务连接</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings
            ?.filter((s) => s.key === 'SUB2API_BASE_URL' || s.key === 'SUB2API_API_KEY')
            .map((s) => (
              <div key={s.key}>
                <label className="text-sm font-medium block mb-1.5">
                  {s.label}
                  {s.secret && s.configured && (
                    <span className="ml-2 text-success">已配置</span>
                  )}
                </label>
                <Input
                  type={s.secret ? 'password' : 'text'}
                  value={edits[s.key] ?? ''}
                  placeholder={s.secret ? '留空则不修改' : ''}
                  onChange={(e) =>
                    setEdits((prev) => ({ ...prev, [s.key]: e.target.value }))
                  }
                />
              </div>
            ))}

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? '保存中…' : '保存'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => refetchModels()}
              disabled={modelsFetching}
            >
              {modelsFetching ? '测试中…' : '测试连接'}
            </Button>
            {modelsError ? (
              <span className="text-sm text-danger">
                ✗ {(modelsError as Error).message}
              </span>
            ) : models ? (
              <span className="text-sm text-success">
                ✓ 上游可用，共 {models.length} 个模型
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* 3. 计费配置 */}
      <Card>
        <CardHeader>
          <CardTitle>计费配置</CardTitle>
          <CardDescription>
            算力财务口径统一为人民币。Token 只用于计价和用量审计，不是可扣减余额。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderField(
            'DEFAULT_EMPLOYEE_GIFT_CNY',
            '订阅赠送算力默认值（元）',
            'number',
            '员工未单独配置赠送金额时生效。改动只影响之后创建的新订阅，不追溯已有订阅。',
          )}
          {renderField(
            'FALLBACK_PRICE_INPUT',
            '保底计费 - 输入价格（元/1K tokens）',
            'number',
            '仅对未配价的模型生效。两项都填才启用，否则回退「已知模型最高单价」。',
          )}
          {renderField(
            'FALLBACK_PRICE_OUTPUT',
            '保底计费 - 输出价格（元/1K tokens）',
            'number',
            '仅对未配价的模型生效。两项都填才启用，否则回退「已知模型最高单价」。',
          )}
          {renderField(
            'LOW_BALANCE_THRESHOLD',
            '低余额告警阈值（元）',
            'number',
            '企业钱包余额低于此金额时发送提醒',
          )}
          <FallbackPricingStatus
            input={edits['FALLBACK_PRICE_INPUT']}
            output={edits['FALLBACK_PRICE_OUTPUT']}
          />
        </CardContent>
      </Card>

      {/* 4. 安全与限制 */}
      <Card>
        <CardHeader>
          <CardTitle>安全与限制</CardTitle>
          <CardDescription>配置使用限额和访问控制</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderField('MAX_TOKENS_PER_CONVERSATION', '单次对话最大tokens', 'number', '防止单次对话消耗过多资源')}
          {renderField('MAX_CONCURRENT_SESSIONS', '单企业并发会话数', 'number', '0表示不限制，防止滥用')}
          {renderField('ADMIN_IP_WHITELIST', '管理员IP白名单', 'text', '逗号分隔，留空则不限制')}
        </CardContent>
      </Card>

      {/* 5. 注册与审核 */}
      <Card>
        <CardHeader>
          <CardTitle>注册与审核</CardTitle>
          <CardDescription>配置企业注册流程</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderField('ENTERPRISE_REGISTRATION_APPROVAL', '企业注册需人工审核', 'switch', '开启后，新企业注册需等待运营审核')}
          {renderField('SEND_WELCOME_EMAIL', '审核通过发送欢迎邮件', 'switch', '自动向新企业管理员发送欢迎邮件')}
        </CardContent>
      </Card>

      {/* 6. 内容审核 */}
      <Card>
        <CardHeader>
          <CardTitle>内容审核</CardTitle>
          <CardDescription>配置内容过滤策略</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderField('CONTENT_FILTER_ENABLED', '敏感词过滤开关', 'switch', '开启后将过滤用户输入和模型输出中的敏感词')}
        </CardContent>
      </Card>

      {/* 7. 数据保留 */}
      <Card>
        <CardHeader>
          <CardTitle>数据保留</CardTitle>
          <CardDescription>配置历史数据清理策略</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderField('CONVERSATION_RETENTION_DAYS', '对话记录保留天数', 'number', '0表示永久保留')}
          {renderField('OPERATION_LOG_RETENTION_DAYS', '操作日志保留天数', 'number', '0表示永久保留')}
          {renderField('SOFT_DELETE_RETENTION_DAYS', '软删除数据保留天数', 'number', '超过此天数后物理删除')}
        </CardContent>
      </Card>

      {/* 8. 性能与缓存 */}
      <Card>
        <CardHeader>
          <CardTitle>性能与缓存</CardTitle>
          <CardDescription>配置缓存和超时策略</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderField('REDIS_CACHE_ENABLED', 'Redis缓存开关', 'switch', '关闭后将不使用Redis缓存（仅用于调试）')}
          {renderField('CONVERSATION_CACHE_TTL', '对话历史缓存时长（秒）', 'number', 'Redis中缓存对话历史的时间')}
          {renderField('MODEL_RESPONSE_TIMEOUT', '模型响应超时（秒）', 'number', '超过此时间未响应则中断请求')}
        </CardContent>
      </Card>

      {/* 9. 通知配置 */}
      <Card>
        <CardHeader>
          <CardTitle>通知配置</CardTitle>
          <CardDescription>配置系统告警与公告</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderField('ADMIN_NOTIFICATION_EMAIL', '管理员通知邮箱', 'email', '接收系统告警的邮箱地址')}
          {renderField('ABNORMAL_USAGE_THRESHOLD', '异常消耗告警阈值（单小时tokens）', 'number', '企业单小时消耗超过此值时发送告警')}
          {renderField('SYSTEM_MAINTENANCE_NOTICE', '系统维护公告', 'textarea', '显示在用户端页面顶部的公告信息')}
        </CardContent>
      </Card>

      {/* 全局保存按钮 */}
      <div className="flex justify-end pb-6">
        <Button onClick={handleSave} disabled={update.isPending} size="lg">
          {update.isPending ? '保存中…' : '保存所有设置'}
        </Button>
      </div>
    </div>
  );
}

/**
 * 保底价的真实生效状态。
 *
 * 后端只在**两项都填了合法值**时才启用运营配置的保底价，否则回退「已知模型最高单价」。
 * 只填一项而界面不提示，运营会以为配置生效了，实际账单走的是另一套价格。
 */
function FallbackPricingStatus({
  input,
  output,
}: {
  input?: string;
  output?: string;
}) {
  const parse = (raw?: string) => {
    const n = Number((raw ?? '').trim());
    return (raw ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const parsedInput = parse(input);
  const parsedOutput = parse(output);
  const active = parsedInput !== null && parsedOutput !== null;

  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        active
          ? 'border-success/40 bg-success/5 text-success'
          : 'border-warning/40 bg-warning/5 text-warning'
      }`}
    >
      {active ? (
        <>
          ✓ 保底价已生效：未配价模型按 输入 ¥{parsedInput.toFixed(4)} / 输出 ¥
          {parsedOutput.toFixed(4)} 每 1K tokens 计费
        </>
      ) : (
        <>
          ⚠ 保底价未生效：需两项都填写合法数值。当前未配价的模型按「已知模型最高单价」计费
        </>
      )}
    </div>
  );
}
