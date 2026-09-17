'use client';

import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { adminApi, type EmployeeAvatarSetting, type ManagedAvatarStyle } from './admin-api';

const message = (error: unknown) => error instanceof Error ? error.message : '保存失败，请重试';
const selectClass = 'h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm';

export function AvatarLibraryForms({ employees, styles, onSaved }: {
  employees: EmployeeAvatarSetting[];
  styles: ManagedAvatarStyle[];
  onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'register' | 'bind' | null>(null);
  const [styleId, setStyleId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [portraitUrl, setPortraitUrl] = useState('');
  const [faceUrl, setFaceUrl] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('');
  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === 'register') {
        return adminApi.registerAvatarStyle({ id: styleId.trim(), name: name.trim(), description: description.trim(), category: '自有素材' });
      }
      return adminApi.bindEmployeeAvatar(employeeId, {
        styleId, portraitUrl: portraitUrl.trim(), faceUrl: faceUrl.trim() || undefined,
        version: version.trim() || undefined,
      });
    },
    onSuccess: async () => {
      await onSaved();
      toast.success(mode === 'register' ? '新风格已添加，可以开始绑定员工素材' : '员工素材绑定已保存');
      setMode(null);
    },
  });
  const open = (next: 'register' | 'bind') => {
    mutation.reset(); setStyleId(''); setEmployeeId(''); setPortraitUrl(''); setFaceUrl('');
    setName(''); setDescription(''); setVersion(''); setMode(next);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate(); };
  return <>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => open('register')}>添加头像风格</Button>
      <Button variant="outline" size="sm" onClick={() => open('bind')} disabled={!employees.length}>绑定员工素材</Button>
    </div>
    <Dialog open={mode !== null} onOpenChange={(value) => { if (!value && !mutation.isPending) setMode(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{mode === 'register' ? '添加头像风格' : '绑定员工素材'}</DialogTitle>
          <DialogDescription>{mode === 'register'
            ? '先建立风格，再为员工逐个绑定图片。覆盖全部员工后即可设为平台默认。'
            : '填写已部署的图片地址。该员工正在使用此风格时，保存会立即更新头像。'}</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {mode === 'register' ? <>
            <label className="block space-y-2 text-sm"><span>风格名称</span><Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：写实职业形象" /></label>
            <label className="block space-y-2 text-sm"><span>风格标识</span><Input required minLength={2} maxLength={64} pattern="[a-z0-9][a-z0-9_-]{1,63}" value={styleId} onChange={(e) => setStyleId(e.target.value)} placeholder="例如：professional-photo" /><span className="text-xs text-fg-muted">使用小写英文、数字、连字符或下划线，建立后保持不变。</span></label>
            <label className="block space-y-2 text-sm"><span>风格说明</span><Input required maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="描述这套素材的视觉风格与用途" /></label>
          </> : <>
            <label className="block space-y-2 text-sm"><span>员工</span><select required className={selectClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">请选择员工</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.position || '未设置岗位'}</option>)}</select></label>
            <label className="block space-y-2 text-sm"><span>素材风格</span><select required className={selectClass} value={styleId} onChange={(e) => setStyleId(e.target.value)}><option value="">请选择风格</option>{styles.filter((style) => style.source === 'platform').map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}</select></label>
            <label className="block space-y-2 text-sm"><span>人物图地址</span><Input required value={portraitUrl} onChange={(e) => setPortraitUrl(e.target.value)} placeholder="https://… 或 /assets/…" /></label>
            <label className="block space-y-2 text-sm"><span>头像裁切图地址（选填）</span><Input value={faceUrl} onChange={(e) => setFaceUrl(e.target.value)} placeholder="用于聊天、列表等小尺寸头像" /></label>
            <label className="block space-y-2 text-sm"><span>素材版本（选填）</span><Input maxLength={100} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="例如：2026-09-v1" /></label>
            <p className="text-xs leading-5 text-fg-muted">先将图片发布到平台素材目录或图片存储，再填写可访问的地址。更换图片建议使用新文件名，方便两端更新缓存。</p>
          </>}
          {mutation.isError && <p role="alert" className="text-sm text-red-600">{message(mutation.error)}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setMode(null)}>取消</Button><Button type="submit" loading={mutation.isPending}>保存{mode === 'register' ? '风格' : '绑定'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
