'use client';

import { useState } from 'react';
import { Bot, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { useCreateContribution } from './use-contributions';

export function ContributionCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const hasEnterprise = Boolean(useAuthStore((state) => state.enterprise));
  const create = useCreateContribution();
  const [type, setType] = useState<'skill' | 'agent'>('skill');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [platform, setPlatform] = useState<'coze' | 'dify' | 'n8n' | 'opencode'>('coze');
  const [workflowUrl, setWorkflowUrl] = useState('');

  const reset = () => {
    setType('skill'); setName(''); setDescription(''); setContent(''); setPlatform('coze'); setWorkflowUrl('');
  };
  const close = (value: boolean) => { if (!value) reset(); onOpenChange(value); };
  const submit = () => {
    if (!name.trim() || description.trim().length < 10) { toast.error('请补充能力名称和至少 10 个字的说明'); return; }
    if (type === 'skill' && content.trim().length < 20) { toast.error('Skill 模板至少需要 20 个字符'); return; }
    if (type === 'agent' && !workflowUrl.trim()) { toast.error('请输入 Agent 工作流地址'); return; }
    create.mutate({
      name: name.trim(), description: description.trim(), type,
      ...(type === 'skill' ? { skillConfig: { template: content.trim() } } : { agentConfig: { platform, workflowUrl: workflowUrl.trim() } }),
    }, {
      onSuccess: () => { toast.success('能力草稿已创建', '接下来可以提交企业审核'); close(false); },
      onError: (error) => toast.error(error instanceof Error ? error.message : '创建失败，请稍后重试'),
    });
  };

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent glass className="max-w-2xl">
      <DialogHeader><DialogTitle className="text-gtext-primary">创建能力贡献</DialogTitle><DialogDescription className="text-gtext-muted">{hasEnterprise ? '先保存为企业私有草稿，企业管理员通过后才可申请进入平台审核。' : '先保存为个人草稿，自动校验通过后可直接进入平台审核。'}</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <TypeChoice active={type === 'skill'} onClick={() => setType('skill')} icon={<Sparkles className="h-4 w-4" />} title="Skill" desc="可复用的提示词与执行规范" />
          <TypeChoice active={type === 'agent'} onClick={() => setType('agent')} icon={<Bot className="h-4 w-4" />} title="Agent" desc="连接外部工作流或智能体" />
        </div>
        <label className="block text-sm text-gtext-secondary">能力名称<Input glass value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：竞品周报生成器" className="mt-1.5" /></label>
        <label className="block text-sm text-gtext-secondary">能力说明<Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="说明它解决什么问题、适用什么场景" className="mt-1.5 min-h-20 border-glassline bg-glass-2 text-gtext-primary placeholder:text-gtext-muted focus-visible:ring-gbrand-ring" /></label>
        {type === 'skill' ? <label className="block text-sm text-gtext-secondary">Skill 模板<Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="写出角色、输入、步骤、输出和边界条件" className="mt-1.5 min-h-36 border-glassline bg-glass-2 font-mono text-xs text-gtext-primary placeholder:text-gtext-muted focus-visible:ring-gbrand-ring" /></label> : <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm text-gtext-secondary">平台<select value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)} className="mt-1.5 h-10 w-full rounded border border-glassline bg-glass-2 px-3 text-sm text-gtext-primary"><option value="coze">Coze</option><option value="dify">Dify</option><option value="n8n">n8n</option><option value="opencode">OpenCode</option></select></label><label className="block text-sm text-gtext-secondary">工作流地址<Input glass value={workflowUrl} onChange={(e) => setWorkflowUrl(e.target.value)} placeholder="https://..." className="mt-1.5" /></label></div>}
      </div>
      <DialogFooter><Button variant="glass" onClick={() => close(false)}>取消</Button><Button variant="glass-primary" loading={create.isPending} onClick={submit}><Plus className="h-4 w-4" />创建草稿</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function TypeChoice({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return <button type="button" onClick={onClick} className={`flex items-start gap-3 rounded-md border p-3 text-left transition-colors ${active ? 'border-glassline-brand bg-gbrand/15' : 'border-glassline bg-glass-1 hover:bg-glass-2'}`}><span className="mt-0.5 text-gbrand-text">{icon}</span><span><span className="block text-sm font-semibold text-gtext-primary">{title}</span><span className="mt-0.5 block text-xs text-gtext-muted">{desc}</span></span></button>;
}
