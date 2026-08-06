'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { ArrowLeft, Loader2, Bot, Workflow, Globe, Link2, Upload, File } from 'lucide-react';
import Link from 'next/link';
import { useCreateCozeCapability, useCreateCozeUrlCapability } from '@/features/admin/use-admin';
import { SkillForm } from './skill-form';

// ─── Platform Icons ──────────────────────────────────────────────────────────

function CozeIcon({ className = 'w-12 h-12' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cozeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1D53F0" />
          <stop offset="100%" stopColor="#4F7FFF" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="12" fill="url(#cozeGradient)" />
      <path
        d="M32 16C23.163 16 16 23.163 16 32s7.163 16 16 16c3.037 0 5.85-.847 8.267-2.316l8.316 2.773a1 1 0 001.267-1.267l-2.773-8.316A15.918 15.918 0 0048 32c0-8.837-7.163-16-16-16zm0 4c6.627 0 12 5.373 12 12s-5.373 12-12 12-12-5.373-12-12 5.373-12 12-12z"
        fill="white"
      />
      <circle cx="26" cy="30" r="2" fill="white" />
      <circle cx="38" cy="30" r="2" fill="white" />
      <path d="M26 36c2 2.667 4 2.667 6 2.667S36 38.667 38 36" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DifyIcon({ className = 'w-12 h-12' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="difyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#EA580C" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="12" fill="url(#difyGradient)" />
      <path
        d="M32 14l-18 10.392v20.784L32 56l18-10.392V24.824L32 14zm0 4.155l14 8.077v16.154L32 50.463l-14-8.077V26.232l14-8.077z"
        fill="white"
      />
      <path d="M32 24l-8 4.619v9.238L32 42.476l8-4.619v-9.238L32 24z" fill="white" />
    </svg>
  );
}

function N8NIcon({ className = 'w-12 h-12' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="12" fill="#EA4B71" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="white"
        fontSize="24"
        fontWeight="700"
        fontFamily="monospace"
      >
        n8n
      </text>
    </svg>
  );
}

function OpenCodeIcon({ className = 'w-12 h-12' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="opencodeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="12" fill="url(#opencodeGradient)" />
      <path d="M20 24l8 8-8 8" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 40h12" stroke="white" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ─── Platform Types ──────────────────────────────────────────────────────────

type PlatformType = 'COZE' | 'SKILL' | 'DIFY' | 'N8N' | 'OPENCODE';
type CozeRegion = 'CN' | 'GLOBAL';
type CozeRuntimeKind = 'BOT_CHAT' | 'WORKFLOW';

function SkillIcon({ className = 'w-12 h-12' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="skillGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="12" fill="url(#skillGradient)" />
      <path
        d="M32 16L16 24v16l16 8 16-8V24L32 16zm0 4l12 6v12l-12 6-12-6V26l12-6z"
        fill="white"
        opacity="0.9"
      />
      <circle cx="32" cy="32" r="4" fill="white" />
    </svg>
  );
}

const PLATFORMS = [
  {
    type: 'COZE' as PlatformType,
    name: 'Coze',
    description: '扣子 - Bot 对话或 Workflow 流程',
    icon: CozeIcon,
    available: true,
  },
  {
    type: 'SKILL' as PlatformType,
    name: 'Skills',
    description: 'SKILL.md - Claude Code 技能包',
    icon: SkillIcon,
    available: true,
  },
  {
    type: 'DIFY' as PlatformType,
    name: 'Dify',
    description: 'AI 应用开发平台',
    icon: DifyIcon,
    available: false,
  },
  {
    type: 'N8N' as PlatformType,
    name: 'n8n',
    description: '工作流自动化',
    icon: N8NIcon,
    available: false,
  },
  {
    type: 'OPENCODE' as PlatformType,
    name: 'OpenCode',
    description: 'Claude Code 能力',
    icon: OpenCodeIcon,
    available: false,
  },
];

const INDUSTRIES = ['电商', '跨境电商', '金融', '教育', '医疗', '通用'];
const POSITIONS = ['客服', '销售', '市场', '运营', '技术', '通用'];

// ─── Coze Form Schema ────────────────────────────────────────────────────────

const cozeFormSchema = z.object({
  region: z.enum(['CN', 'GLOBAL']),
  runtimeKind: z.enum(['BOT_CHAT', 'WORKFLOW']),
  resourceId: z.string().min(1, 'Bot ID 或 Workflow ID 不能为空'),
  apiKey: z.string().optional(),
  name: z.string().min(1, '能力名称不能为空'),
  description: z.string().min(10, '描述至少 10 个字符'),
  industry: z.array(z.string()),
  position: z.array(z.string()),
});

type CozeFormValues = z.infer<typeof cozeFormSchema>;

const cozeUrlFormSchema = z.object({
  webUrl: z.string().url('请输入有效的 URL（以 https:// 开头）'),
  name: z.string().min(1, '能力名称不能为空'),
  description: z.string().min(10, '描述至少 10 个字符'),
  industry: z.array(z.string()),
  position: z.array(z.string()),
});

type CozeUrlFormValues = z.infer<typeof cozeUrlFormSchema>;
type CozeConnectionMode = 'API' | 'URL';

// ─── Platform Selector ───────────────────────────────────────────────────────

function PlatformSelector({
  selected,
  onSelect,
}: {
  selected: PlatformType | null;
  onSelect: (platform: PlatformType) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {PLATFORMS.map((platform) => {
        const Icon = platform.icon;
        const isSelected = selected === platform.type;
        return (
          <button
            key={platform.type}
            onClick={() => platform.available && onSelect(platform.type)}
            disabled={!platform.available}
            className={`
              relative rounded-lg border-2 p-6 text-left transition-all
              ${
                isSelected
                  ? 'border-primary bg-primary/5 shadow-md'
                  : platform.available
                  ? 'border-border bg-card hover:border-primary/50 hover:bg-muted/30'
                  : 'border-border bg-muted/20 opacity-60 cursor-not-allowed'
              }
            `}
          >
            <div className="flex items-start gap-4">
              <Icon className="w-12 h-12 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-base">{platform.name}</h3>
                  {!platform.available && (
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">即将推出</span>
                  )}
                </div>
                <p className="text-sm text-fg-muted mt-1">{platform.description}</p>
              </div>
            </div>
            {isSelected && (
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Coze Form ───────────────────────────────────────────────────────────────

function CozeForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [connectionMode, setConnectionMode] = useState<CozeConnectionMode>('API');

  // API 接入模式
  const createApiMutation = useCreateCozeCapability();
  const {
    register: apiReg,
    handleSubmit: apiHandle,
    watch: apiWatch,
    setValue: apiSet,
    formState: { errors: apiErr, isSubmitting: apiBusy },
  } = useForm<CozeFormValues>({
    resolver: zodResolver(cozeFormSchema),
    defaultValues: { region: 'CN', runtimeKind: 'BOT_CHAT', resourceId: '', apiKey: '', name: '', description: '', industry: [], position: [] },
  });

  // URL 链接模式
  const createUrlMutation = useCreateCozeUrlCapability();
  const {
    register: urlReg,
    handleSubmit: urlHandle,
    watch: urlWatch,
    setValue: urlSet,
    formState: { errors: urlErr, isSubmitting: urlBusy },
  } = useForm<CozeUrlFormValues>({
    resolver: zodResolver(cozeUrlFormSchema),
    defaultValues: { webUrl: '', name: '', description: '', industry: [], position: [] },
  });

  const region = apiWatch('region');
  const runtimeKind = apiWatch('runtimeKind');
  const apiIndustry = apiWatch('industry');
  const apiPosition = apiWatch('position');
  const urlIndustry = urlWatch('industry');
  const urlPosition = urlWatch('position');

  const isSubmitting = connectionMode === 'API' ? apiBusy : urlBusy;

  const onApiSubmit = async (v: CozeFormValues) => {
    try {
      await createApiMutation.mutateAsync(v);
      toast.success('Coze 能力创建成功');
      router.push('/admin/capabilities');
    } catch (err) {
      toast.error(`创建失败：${(err as Error).message}`);
    }
  };

  const onUrlSubmit = async (v: CozeUrlFormValues) => {
    try {
      await createUrlMutation.mutateAsync(v);
      toast.success('Coze 能力创建成功');
      router.push('/admin/capabilities');
    } catch (err) {
      toast.error(`创建失败：${(err as Error).message}`);
    }
  };

  const handleSubmit = connectionMode === 'API' ? apiHandle(onApiSubmit) : urlHandle(onUrlSubmit);

  const industry = connectionMode === 'API' ? apiIndustry : urlIndustry;
  const position = connectionMode === 'API' ? apiPosition : urlPosition;
  const toggleIndustry = (ind: string) => {
    if (connectionMode === 'API') {
      apiSet('industry', apiIndustry.includes(ind) ? apiIndustry.filter((i) => i !== ind) : [...apiIndustry, ind]);
    } else {
      urlSet('industry', urlIndustry.includes(ind) ? urlIndustry.filter((i) => i !== ind) : [...urlIndustry, ind]);
    }
  };
  const togglePosition = (pos: string) => {
    if (connectionMode === 'API') {
      apiSet('position', apiPosition.includes(pos) ? apiPosition.filter((p) => p !== pos) : [...apiPosition, pos]);
    } else {
      urlSet('position', urlPosition.includes(pos) ? urlPosition.filter((p) => p !== pos) : [...urlPosition, pos]);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CozeIcon className="w-6 h-6" />
            Coze 能力配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* ── 接入方式 ── */}
          <div>
            <Label>接入方式 *</Label>
            <div className="flex gap-2 mt-2">
              {(['API', 'URL'] as CozeConnectionMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setConnectionMode(m)}
                  className={`flex-1 px-4 py-2 rounded border-2 transition-all ${
                    connectionMode === m
                      ? 'border-primary bg-primary/5 text-primary font-medium'
                      : 'border-border bg-background hover:border-primary/30'
                  }`}
                >
                  {m === 'API'
                    ? <><Bot className="w-4 h-4 inline mr-2" />API 接入</>
                    : <><Link2 className="w-4 h-4 inline mr-2" />URL 链接</>}
                </button>
              ))}
            </div>
            <p className="text-xs text-fg-subtle mt-1">
              {connectionMode === 'API'
                ? '通过 API 调用，对话在平台内完成，支持与其他能力串联'
                : '仅保存链接，用户点击后跳转 Coze 原生界面'}
            </p>
          </div>

          {/* ── API 模式字段 ── */}
          {connectionMode === 'API' && (
            <>
              <div>
                <Label>区域 *</Label>
                <div className="flex gap-2 mt-2">
                  {(['CN', 'GLOBAL'] as const).map((r) => (
                    <button key={r} type="button" onClick={() => apiSet('region', r)}
                      className={`flex-1 px-4 py-2 rounded border-2 transition-all ${
                        region === r ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-border bg-background hover:border-primary/30'
                      }`}>
                      <Globe className="w-4 h-4 inline mr-2" />
                      {r === 'CN' ? '中国区 (CN)' : '国际区 (GLOBAL)'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-fg-subtle mt-1">Bot/Workflow 所在区域，必须与您的 Coze 账号区域一致</p>
              </div>

              <div>
                <Label>运行类型 *</Label>
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => apiSet('runtimeKind', 'BOT_CHAT')}
                    className={`flex-1 px-4 py-2 rounded border-2 transition-all ${
                      runtimeKind === 'BOT_CHAT' ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-border bg-background hover:border-primary/30'
                    }`}>
                    <Bot className="w-4 h-4 inline mr-2" />Bot 对话
                  </button>
                  <button type="button" onClick={() => apiSet('runtimeKind', 'WORKFLOW')}
                    className={`flex-1 px-4 py-2 rounded border-2 transition-all ${
                      runtimeKind === 'WORKFLOW' ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-border bg-background hover:border-primary/30'
                    }`}>
                    <Workflow className="w-4 h-4 inline mr-2" />Workflow 流程
                  </button>
                </div>
              </div>

              <div>
                <Label htmlFor="resourceId">{runtimeKind === 'BOT_CHAT' ? 'Bot ID' : 'Workflow ID'} *</Label>
                <Input id="resourceId" {...apiReg('resourceId')}
                  placeholder={runtimeKind === 'BOT_CHAT' ? '例如: 7xxxxxxxxxxxxxx' : '例如: workflow_xxxxxxxxxxxxxx'} />
                {apiErr.resourceId && <p className="text-xs text-danger mt-1">{apiErr.resourceId.message}</p>}
                <p className="text-xs text-fg-subtle mt-1">
                  在 Coze 控制台的 {runtimeKind === 'BOT_CHAT' ? 'Bot 详情页' : 'Workflow 详情页'} 获取
                </p>
              </div>

              <div>
                <Label htmlFor="apiKey">Personal Access Token（可选）</Label>
                <Input id="apiKey" {...apiReg('apiKey')} type="password" placeholder="留空则使用全局 COZE_PAT" />
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p className="font-medium mb-1">🔒 安全提示</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>PAT 提交后将加密存储，无法再次读取</li>
                    <li>如不填写，运行时将使用服务端全局配置的 COZE_PAT</li>
                    <li>确保 PAT 拥有访问该 Bot/Workflow 的权限</li>
                  </ul>
                </div>
              </div>
            </>
          )}

          {/* ── URL 模式字段 ── */}
          {connectionMode === 'URL' && (
            <div>
              <Label htmlFor="webUrl">Coze Bot / Workflow 链接 *</Label>
              <Input id="webUrl" {...urlReg('webUrl')}
                placeholder="https://www.coze.cn/store/bot/7xxxxxxxxxxxxxx" />
              {urlErr.webUrl && <p className="text-xs text-danger mt-1">{urlErr.webUrl.message}</p>}
              <p className="text-xs text-fg-subtle mt-1">
                从 Coze 控制台 Bot / Workflow 详情页复制分享链接
              </p>
            </div>
          )}

          {/* ── 公共基本信息 ── */}
          <div className="border-t border-border pt-6 space-y-4">
            <h3 className="font-medium">基本信息</h3>

            <div>
              <Label>能力名称 *</Label>
              {connectionMode === 'API'
                ? <><Input {...apiReg('name')} placeholder="例如: 营销文案生成助手" />
                    {apiErr.name && <p className="text-xs text-danger mt-1">{apiErr.name.message}</p>}</>
                : <><Input {...urlReg('name')} placeholder="例如: 营销文案生成助手" />
                    {urlErr.name && <p className="text-xs text-danger mt-1">{urlErr.name.message}</p>}</>}
            </div>

            <div>
              <Label>能力描述 *</Label>
              {connectionMode === 'API'
                ? <><Textarea {...apiReg('description')} rows={3} placeholder="描述该能力的功能、使用场景和特点..." />
                    {apiErr.description && <p className="text-xs text-danger mt-1">{apiErr.description.message}</p>}</>
                : <><Textarea {...urlReg('description')} rows={3} placeholder="描述该能力的功能、使用场景和特点..." />
                    {urlErr.description && <p className="text-xs text-danger mt-1">{urlErr.description.message}</p>}</>}
            </div>

            <div>
              <Label>适用行业</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {INDUSTRIES.map((ind) => (
                  <label key={ind} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={industry.includes(ind)} onChange={() => toggleIndustry(ind)} className="rounded" />
                    <span className="text-sm">{ind}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label>适用岗位</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {POSITIONS.map((pos) => (
                  <label key={pos} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={position.includes(pos)} onChange={() => togglePosition(pos)} className="rounded" />
                    <span className="text-sm">{pos}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>取消</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />创建中...</> : '创建能力'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function NewCapabilityPage() {
  const router = useRouter();
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformType | null>(null);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/capabilities">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">新建 Agent 能力</h1>
          <p className="text-sm text-fg-muted mt-1">选择平台并配置能力参数</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. 选择平台</CardTitle>
        </CardHeader>
        <CardContent>
          <PlatformSelector selected={selectedPlatform} onSelect={setSelectedPlatform} />
        </CardContent>
      </Card>

      {selectedPlatform === 'COZE' && (
        <div className="animate-in slide-in-from-top-4 duration-300">
          <CozeForm onCancel={() => setSelectedPlatform(null)} />
        </div>
      )}

      {selectedPlatform === 'SKILL' && (
        <div className="animate-in slide-in-from-top-4 duration-300">
          <SkillForm onCancel={() => setSelectedPlatform(null)} />
        </div>
      )}

      {selectedPlatform && selectedPlatform !== 'COZE' && selectedPlatform !== 'SKILL' && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-fg-muted">该平台即将推出，敬请期待</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
