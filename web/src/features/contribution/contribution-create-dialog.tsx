'use client';

import { useState } from 'react';
import { AppWindow, ArrowLeft, ArrowRight, Bot, Check, LockKeyhole, Plus, Sparkles, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { SkillPackageUpload } from './components/skill-package-upload';
import { useCreateContribution } from './use-contributions';
import type { SkillPackageParseResult } from '../../../../backend/src/shared';

type ContributionType = 'skill' | 'agent';
/** Skill 正文来源。上传是主路径 —— 能力本来就是一个 SKILL.md 包，不是现场写的提示词。 */
type SkillSource = 'upload' | 'inline';
type Step = 1 | 2 | 3;

export function ContributionCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const hasEnterprise = Boolean(useAuthStore((state) => state.enterprise));
  const create = useCreateContribution();
  const [step, setStep] = useState<Step>(1);
  const [type, setType] = useState<ContributionType>('skill');
  const [source, setSource] = useState<SkillSource>('upload');
  const [pkg, setPkg] = useState<SkillPackageParseResult | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [industry, setIndustry] = useState('');
  const [position, setPosition] = useState('');
  const [content, setContent] = useState('');
  const [platform, setPlatform] = useState<'coze' | 'dify' | 'n8n' | 'opencode'>('coze');
  const [workflowUrl, setWorkflowUrl] = useState('');

  const reset = () => {
    setStep(1); setType('skill'); setSource('upload'); setPkg(null); setName(''); setDescription('');
    setIndustry(''); setPosition(''); setContent(''); setPlatform('coze'); setWorkflowUrl('');
  };
  const close = (value: boolean) => { if (!value) reset(); onOpenChange(value); };

  /** 包解析成功后用 frontmatter 预填能力信息，但不覆盖用户已经手填的值。 */
  const acceptPackage = (result: SkillPackageParseResult | null) => {
    setPkg(result);
    if (!result) return;
    setName((current) => current.trim() || result.suggested.name || '');
    setDescription((current) => current.trim() || result.suggested.description || '');
  };

  const configReady = type === 'agent'
    ? Boolean(workflowUrl.trim())
    : source === 'upload' ? Boolean(pkg) : content.trim().length >= 20;
  const canContinue = step === 1 || (step === 2 && configReady);

  const next = () => {
    if (step === 2 && !configReady) {
      toast.error(type === 'agent'
        ? '请输入 Agent 工作流地址'
        : source === 'upload' ? '请先上传 SKILL 包' : 'Skill 正文至少需要 20 个字符');
      return;
    }
    setStep((current) => Math.min(3, current + 1) as Step);
  };

  const submit = () => {
    if (!name.trim()) { toast.error('请填写能力名称'); return; }
    if (description.trim().length < 10) { toast.error('能力说明至少需要 10 个字'); return; }
    create.mutate({
      name: name.trim(), description: description.trim(), type, industry: splitTags(industry), position: splitTags(position),
      ...(type === 'agent'
        ? { agentConfig: { platform, workflowUrl: workflowUrl.trim() } }
        // 上传路径只送 sha256：正文由服务端按哈希重新解包，客户端改不动它
        : { skillConfig: pkg && source === 'upload'
            ? { packageSha256: pkg.sha256, packageFilename: pkg.filename }
            : { template: content.trim() } }),
    }, {
      onSuccess: () => { toast.success('能力草稿已创建', '接下来可以提交企业审核'); close(false); },
      onError: (error) => toast.error(error instanceof Error ? error.message : '创建失败，请稍后重试'),
    });
  };

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent glass className="max-w-3xl overflow-hidden p-0">
      <DialogHeader className="border-b border-glassline px-6 py-5">
        <div className="flex items-start justify-between gap-4"><div><DialogTitle className="text-gtext-primary">创建能力贡献</DialogTitle><DialogDescription className="mt-1 max-w-xl text-gtext-muted">{hasEnterprise ? '先保存为企业私有草稿，企业管理员通过后才可申请进入平台审核。' : '先保存为个人草稿，自动校验通过后可直接进入平台审核。'}</DialogDescription></div><span className="rounded-full border border-glassline bg-glass-1 px-2.5 py-1 text-[11px] text-gtext-muted">草稿模式</span></div>
        <div className="mt-5 flex items-center gap-2" aria-label="创建步骤"><StepIndicator step={1} current={step} label="选择类型" /><StepLine active={step > 1} /><StepIndicator step={2} current={step} label={type === 'agent' ? '执行配置' : '能力内容'} /><StepLine active={step > 2} /><StepIndicator step={3} current={step} label="能力信息" /></div>
      </DialogHeader>
      <div className="max-h-[min(560px,calc(100vh-230px))] overflow-y-auto px-6 py-5 scroll-thin">
        {step === 1 && <TypeStep type={type} onTypeChange={setType} />}
        {step === 2 && <ConfigStep type={type} source={source} pkg={pkg} content={content} platform={platform} workflowUrl={workflowUrl} onSourceChange={setSource} onPackageChange={acceptPackage} onContentChange={setContent} onPlatformChange={setPlatform} onWorkflowUrlChange={setWorkflowUrl} />}
        {step === 3 && <InfoStep prefilled={Boolean(pkg && source === 'upload')} name={name} description={description} industry={industry} position={position} onNameChange={setName} onDescriptionChange={setDescription} onIndustryChange={setIndustry} onPositionChange={setPosition} />}
      </div>
      <DialogFooter className="border-t border-glassline bg-glass-1/40 px-6 py-4"><Button variant="glass" onClick={() => step === 1 ? close(false) : setStep((current) => Math.max(1, current - 1) as Step)}>{step === 1 ? '取消' : <><ArrowLeft className="h-4 w-4" />上一步</>}</Button>{step < 3 ? <Button variant="glass-primary" disabled={!canContinue} onClick={next}>下一步<ArrowRight className="h-4 w-4" /></Button> : <Button variant="glass-primary" loading={create.isPending} onClick={submit}><Plus className="h-4 w-4" />创建草稿</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}

function StepIndicator({ step, current, label }: { step: Step; current: Step; label: string }) {
  const complete = current > step; const active = current === step;
  return <div className="flex min-w-0 items-center gap-2"><span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors', complete ? 'border-gsuccess bg-gsuccess/15 text-gsuccess' : active ? 'border-gbrand-ring bg-gbrand/15 text-gbrand-text' : 'border-glassline bg-glass-1 text-gtext-muted')}>{complete ? <Check className="h-3.5 w-3.5" /> : step}</span><span className={cn('truncate text-xs', active || complete ? 'text-gtext-primary' : 'text-gtext-muted')}>{label}</span></div>;
}

function StepLine({ active }: { active: boolean }) { return <span className={cn('h-px min-w-4 flex-1 transition-colors', active ? 'bg-gbrand' : 'bg-glassline')} />; }

function TypeStep({ type, onTypeChange }: { type: ContributionType; onTypeChange: (type: ContributionType) => void }) {
  return <div><SectionIntro eyebrow="01 / 类型" title="先确定这项能力如何工作" description="类型会决定后续配置项和审核路径，创建后仍可在能力详情中继续完善。" /><div className="mt-6 grid gap-3 sm:grid-cols-2"><TypeChoice active={type === 'skill'} onClick={() => onTypeChange('skill')} icon={<Sparkles className="h-5 w-5" />} title="Skill" desc="可复用的提示词、步骤和执行规范" /><TypeChoice active={type === 'agent'} onClick={() => onTypeChange('agent')} icon={<Bot className="h-5 w-5" />} title="Agent" desc="连接 Coze、Dify、n8n 等外部执行流" /><SoonChoice icon={<Workflow className="h-5 w-5" />} title="RPA" desc="浏览器与桌面流程自动化" /><SoonChoice icon={<AppWindow className="h-5 w-5" />} title="AI App" desc="可嵌入或跳转的 AI 应用" /></div></div>;
}

function InfoStep({ prefilled, name, description, industry, position, onNameChange, onDescriptionChange, onIndustryChange, onPositionChange }: { prefilled: boolean; name: string; description: string; industry: string; position: string; onNameChange: (value: string) => void; onDescriptionChange: (value: string) => void; onIndustryChange: (value: string) => void; onPositionChange: (value: string) => void }) {
  return <div><SectionIntro eyebrow="03 / 能力信息" title="让别人一眼理解它的价值" description={prefilled ? '名称与说明已从 SKILL.md 的 frontmatter 预填，可以直接改。' : '清晰的名称和适用范围会直接影响企业审核与后续复用。'} /><div className="mt-6 grid gap-4"><label className="block text-sm text-gtext-secondary">能力名称<Input glass value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="例如：竞品周报生成器" className="mt-1.5" /></label><label className="block text-sm text-gtext-secondary">能力说明<Textarea glass value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="说明它解决什么问题、适用什么场景，至少 10 个字" className="mt-1.5 min-h-24 resize-y" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-gtext-secondary">适用行业<span className="mb-1 block text-[11px] text-gtext-muted">多个标签用逗号分隔</span><Input glass value={industry} onChange={(event) => onIndustryChange(event.target.value)} placeholder="例如：互联网、软件服务" /></label><label className="block text-sm text-gtext-secondary">适用岗位<span className="mb-1 block text-[11px] text-gtext-muted">多个标签用逗号分隔</span><Input glass value={position} onChange={(event) => onPositionChange(event.target.value)} placeholder="例如：研发负责人、项目经理" /></label></div></div></div>;
}

function ConfigStep({ type, source, pkg, content, platform, workflowUrl, onSourceChange, onPackageChange, onContentChange, onPlatformChange, onWorkflowUrlChange }: { type: ContributionType; source: SkillSource; pkg: SkillPackageParseResult | null; content: string; platform: 'coze' | 'dify' | 'n8n' | 'opencode'; workflowUrl: string; onSourceChange: (value: SkillSource) => void; onPackageChange: (value: SkillPackageParseResult | null) => void; onContentChange: (value: string) => void; onPlatformChange: (value: 'coze' | 'dify' | 'n8n' | 'opencode') => void; onWorkflowUrlChange: (value: string) => void }) {
  if (type === 'agent') {
    return <div><SectionIntro eyebrow="02 / 执行配置" title="接入它的执行入口" description="保存外部工作流地址后，系统会在审核阶段检查接入信息。" /><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="block text-sm text-gtext-secondary">执行平台<select value={platform} onChange={(event) => onPlatformChange(event.target.value as typeof platform)} className="mt-1.5 h-10 w-full rounded-glass-md border border-glassline bg-glass-2 px-3 text-sm text-gtext-primary outline-none focus:border-glassline-brand"><option value="coze">Coze</option><option value="dify">Dify</option><option value="n8n">n8n</option><option value="opencode">OpenCode</option></select></label><label className="block text-sm text-gtext-secondary">工作流地址<Input glass value={workflowUrl} onChange={(event) => onWorkflowUrlChange(event.target.value)} placeholder="https://..." className="mt-1.5" /><span className="mt-2 block text-[11px] text-gtext-muted">需要可访问的 HTTPS 地址</span></label></div></div>;
  }

  return (
    <div>
      <SectionIntro
        eyebrow="02 / 能力内容"
        title="上传它的 SKILL 包"
        description="能力的正文是一个 SKILL.md 包。上传后系统会立刻解析并校验，名称和说明也会从 frontmatter 预填。"
      />
      <div className="mt-5 inline-flex items-center gap-1 rounded-glass-md border border-glassline bg-glass-2 p-1">
        <SourceTab active={source === 'upload'} onClick={() => onSourceChange('upload')}>上传 SKILL 包</SourceTab>
        <SourceTab active={source === 'inline'} onClick={() => onSourceChange('inline')}>在线编写</SourceTab>
      </div>
      <div className="mt-4">
        {source === 'upload' ? (
          <SkillPackageUpload value={pkg} onChange={onPackageChange} />
        ) : (
          <label className="block text-sm text-gtext-secondary">
            Skill 正文
            <Textarea glass value={content} onChange={(event) => onContentChange(event.target.value)} placeholder={'# 角色\n# 输入\n# 步骤\n# 输出\n# 边界条件'} className="mt-1.5 min-h-56 resize-y font-mono text-xs leading-6" />
            <span className="mt-2 block text-[11px] text-gtext-muted">
              {content.trim().length} / 至少 20 个字符 · 建议包含角色、输入、步骤、输出和边界条件
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

function SourceTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn('h-7 rounded-glass-pill px-3 text-xs transition-all duration-200', active ? 'bg-gbg-raised text-gtext-primary shadow-glass-sm' : 'text-gtext-muted hover:bg-glass-3 hover:text-gtext-secondary')}>{children}</button>;
}

function SectionIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gbrand-text">{eyebrow}</p><h3 className="mt-2 text-lg font-semibold text-gtext-primary">{title}</h3><p className="mt-1 max-w-xl text-sm leading-6 text-gtext-muted">{description}</p></div>; }

function TypeChoice({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) { return <button type="button" onClick={onClick} className={cn('group flex min-h-28 items-start gap-3 rounded-glass-lg border p-4 text-left transition-all duration-150', active ? 'border-glassline-brand bg-gbrand/10 shadow-glass-sm' : 'border-glassline bg-glass-1 hover:border-glassline-brand/60 hover:bg-glass-2')}><span className={cn('mt-0.5 transition-colors', active ? 'text-gbrand-text' : 'text-gtext-muted group-hover:text-gbrand-text')}>{icon}</span><span><span className="flex items-center gap-2 text-sm font-semibold text-gtext-primary">{title}{active && <Check className="h-3.5 w-3.5 text-gbrand-text" />}</span><span className="mt-1 block text-xs leading-5 text-gtext-muted">{desc}</span></span></button>; }

function SoonChoice({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) { return <div className="flex min-h-28 items-start gap-3 rounded-glass-lg border border-dashed border-glassline bg-glass-1/40 p-4 opacity-60"><span className="mt-0.5 text-gtext-muted">{icon}</span><span><span className="flex items-center gap-2 text-sm font-semibold text-gtext-secondary">{title}<LockKeyhole className="h-3.5 w-3.5" /></span><span className="mt-1 block text-xs leading-5 text-gtext-muted">{desc}</span><span className="mt-2 inline-flex text-[10px] text-gtext-muted">即将支持</span></span></div>; }

function splitTags(value: string) { return value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean); }
