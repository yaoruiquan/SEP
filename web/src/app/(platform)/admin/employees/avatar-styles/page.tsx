'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Search } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { AvatarLibraryForms } from '@/features/admin/avatar-library-forms';
import { groupAvatarStyles } from '@/features/admin/avatar-source-groups';
import { Button, buttonVariants } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/feedback';
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  adminApi, type EmployeeAvatarSetting, type ManagedAvatarStyle,
} from '@/features/admin/admin-api';

const PAGE_SIZE = 12;
const selectClass = 'h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '保存失败，请重试';

function EmployeeStyleRow({ employee, styles, onSaved }: {
  employee: EmployeeAvatarSetting;
  styles: ManagedAvatarStyle[];
  onSaved: () => Promise<void>;
}) {
  const [selection, setSelection] = useState(employee.avatarStyle);
  const mutation = useMutation({
    mutationFn: () => adminApi.updateEmployeeAvatarStyle(employee.id, selection),
    onSuccess: async () => { await onSaved(); toast.success(`${employee.name}的头像设置已保存`); },
  });
  const currentStyle = styles.find((style) => style.id === employee.effectiveStyleId)?.name
    ?? (employee.effectiveStyleId === 'custom' ? '自定义头像' : employee.effectiveStyleId);
  return (
    <li className="grid items-center gap-4 border-b border-neutral-100 py-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(180px,240px)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={employee.name} src={employee.avatar} asset={employee.avatarAsset} portrait className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <Link href={`/admin/employees/${employee.id}`} className="font-medium hover:text-primary">{employee.name}</Link>
          <p className="truncate text-sm text-fg-muted">{employee.position || '未设置岗位'} · {currentStyle}</p>
          <span className="text-xs text-fg-subtle">{employee.avatarStyle === 'follow-default' ? '跟随平台默认' : '单独设置，不随默认切换'}</span>
        </div>
      </div>
      <select aria-label={`${employee.name}的头像风格`} value={selection} className={selectClass}
        disabled={mutation.isPending} onChange={(event) => { setSelection(event.target.value); mutation.reset(); }}>
        <option value="follow-default" disabled={!employee.availableStyleIds.includes('follow-default')}>跟随平台默认</option>
        {!['follow-default', 'custom'].includes(employee.avatarStyle) && !styles.some((style) => style.id === employee.avatarStyle)
          && <option value={employee.avatarStyle} disabled>原风格（已停用）</option>}
        {groupAvatarStyles(styles).map((group) => <optgroup key={group.id} label={group.name}>{group.styles.map((style) => <option key={style.id} value={style.id} disabled={!employee.availableStyleIds.includes(style.id)}>
          {style.name}{!employee.availableStyleIds.includes(style.id) ? '（未绑定素材）' : ''}
        </option>)}</optgroup>)}
        {(employee.availableStyleIds.includes('custom') || employee.avatarStyle === 'custom') && <option value="custom">自定义头像</option>}
      </select>
      <Button variant="outline" size="sm" disabled={selection === employee.avatarStyle} loading={mutation.isPending}
        onClick={() => mutation.mutate()} aria-label={`保存${employee.name}的头像设置`}>保存</Button>
      {mutation.isError && <p role="alert" className="text-sm text-red-600 sm:col-span-3">{errorMessage(mutation.error)}</p>}
    </li>
  );
}

export default function AvatarStylesPage() {
  const queryClient = useQueryClient();
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const [source, setSource] = useState('all');
  const [styleSearch, setStyleSearch] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['avatar-styles'], queryFn: adminApi.getAvatarStyles });
  const refreshAvatars = async () => {
    await Promise.all([
      ['avatar-styles'], ['admin-employees'], ['admin-employee'], ['digital-employees'],
      ['market', 'employees'], ['subscriptions'], ['enterprise', 'my-employees'],
      ['subscription-employee-detail'], ['conversations'],
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  };
  const mutation = useMutation({
    mutationFn: (input: { styleId: string; applyToAll: boolean }) => adminApi.batchUpdateAvatarStyle(input.styleId, input.applyToAll),
    onSuccess: async (result) => {
      await refreshAvatars();
      setSelectedStyle(null);
      setApplyToAll(false);
      toast.success(`平台默认风格已更新，已同步 ${result.updated} 位员工`);
    },
  });
  const data = query.data;
  const styles = data?.styles ?? [];
  const defaultStyle = styles.find((style) => style.id === data?.defaultStyleId);
  const selected = styles.find((style) => style.id === selectedStyle);
  const employees = (data?.employees ?? []).filter((employee) =>
    `${employee.name} ${employee.position}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const totalPages = Math.max(1, Math.ceil(employees.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleEmployees = employees.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const sourceGroups = groupAvatarStyles(styles, data?.sources);
  const styleTerm = styleSearch.trim().toLocaleLowerCase();
  const visibleGroups = sourceGroups.filter((group) => source === 'all' || group.id === source)
    .map((group) => ({ ...group, styles: group.styles.filter((style) =>
      `${style.name} ${style.description} ${group.name}`.toLocaleLowerCase().includes(styleTerm)) }))
    .filter((group) => group.styles.length > 0);

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-8">
      <header className="flex items-start gap-3">
        <Link href="/admin/employees" aria-label="返回员工管理" className={buttonVariants({ variant: 'ghost', size: 'icon' })}><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">头像风格管理</h1>
          <p className="mt-2 text-sm leading-6 text-fg-muted">统一管理员工形象，Web 与客户端读取同一份头像。切换风格后，各风格原有的人物绑定会保留。</p>
        </div>
      </header>

      {query.isLoading ? <div aria-label="正在加载头像设置" className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-48" />)}</div>
        : query.isError ? <div role="alert" className="rounded-xl border border-neutral-200 bg-white p-6">
          <p className="mb-4">加载头像设置失败：{errorMessage(query.error)}</p><Button onClick={() => query.refetch()}>重新加载</Button>
        </div> : data && <>
          <AvatarLibraryForms employees={data.employees} styles={styles} onSaved={refreshAvatars} />
          <section aria-label="当前头像设置" className="grid overflow-hidden rounded-xl border border-neutral-200 bg-white sm:grid-cols-3">
            {[
              ['平台默认风格', defaultStyle?.name ?? data.defaultStyleId],
              ['跟随平台默认', `${data.followersCount} 位员工`],
              ['单独设置', `${data.overridesCount} 位员工`],
            ].map(([label, value]) => <div key={label} className="border-b border-neutral-100 px-6 py-5 last:border-0 sm:border-b-0 sm:border-r">
              <p className="text-sm text-fg-muted">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p>
            </div>)}
          </section>

          <section aria-labelledby="platform-styles-title" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><h2 id="platform-styles-title" className="text-lg font-semibold">平台默认风格</h2>
                <p className="mt-1 text-sm text-fg-muted">默认只影响跟随默认的员工；如需统一全部员工，可在确认时选择覆盖单独设置。</p></div>
              <div className="flex w-full flex-wrap gap-3 sm:w-auto">
                <div className="relative min-w-0 flex-1 sm:w-56"><Search className="absolute left-3 top-3 h-4 w-4 text-fg-subtle" />
                  <Input aria-label="搜索头像风格" placeholder="搜索风格名称或用途" className="pl-9" value={styleSearch} onChange={(event) => setStyleSearch(event.target.value)} /></div>
                <select aria-label="筛选风格来源" value={source} onChange={(event) => setSource(event.target.value)} className={`${selectClass} w-full sm:w-56`}>
                  <option value="all">全部来源（{styles.length}）</option>
                  {sourceGroups.map((group) => <option key={group.id} value={group.id}>{group.name}（{group.styles.length}）</option>)}
                </select>
              </div>
            </div>
            {visibleGroups.map((group) => <section key={group.id} aria-label={`${group.name}风格`} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-3">
                <div><div className="flex items-center gap-2"><h3 className="font-semibold">{group.name}</h3><Badge variant="secondary">{group.styles.length} 种风格</Badge></div>
                  {group.description && <p className="mt-1 text-sm text-fg-muted">{group.description}</p>}</div>
                {group.website && <a href={group.website} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline" aria-label={`查看${group.name}来源`}>查看来源 ↗</a>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.styles.map((style) => {
                const isDefault = style.id === data.defaultStyleId;
                return <article key={style.id} aria-label={style.name} className={`flex flex-col rounded-xl border bg-white p-5 ${isDefault ? 'border-primary ring-1 ring-primary/15' : 'border-neutral-200'}`}>
                  <div className="mb-5 flex min-h-24 items-center justify-center gap-3 rounded-lg bg-neutral-50 p-3">
                    {style.examples.length ? style.examples.slice(0, 3).map((url, index) => <Avatar key={`${url}-${index}`} src={url} portrait name={style.name} className="h-20 w-20 rounded-xl" />)
                      : <p className="text-sm text-fg-muted">绑定员工素材后显示预览</p>}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{style.name}</h4>
                    {isDefault && <Badge className="gap-1 bg-primary/10 text-primary"><Check className="h-3 w-3" />当前默认</Badge>}</div>
                  <p className="mt-2 flex-1 text-sm leading-6 text-fg-muted">{style.description}</p>
                  <div className="mb-3 mt-5 flex items-center justify-between text-xs text-fg-subtle">
                    <span>{group.name}{style.totalAssets ? ` · ${style.totalAssets} 个形象` : ''}</span><span>已匹配 {style.coverage.matched} / {style.coverage.total} 位</span>
                  </div>
                  {style.license && <p className="mb-3 text-xs leading-5 text-fg-muted">
                    <a href={style.license.url} target="_blank" rel="noreferrer" title={style.license.attribution} className="hover:text-primary hover:underline">
                      {style.license.name.startsWith('Free for personal') ? '免费商用' : style.license.name}
                    </a>{style.license.requiresAttribution ? ' · 需保留署名 / 授权说明' : ''}
                  </p>}
                  {group.id === 'robohash' && style.license?.requiresAttribution && <p className="mb-3 break-words text-xs leading-5 text-fg-muted">{style.license.attribution}</p>}
                  <Button variant={isDefault ? 'secondary' : 'outline'} className="w-full" disabled={isDefault || !style.canSetDefault || mutation.isPending}
                    onClick={() => { mutation.reset(); setApplyToAll(false); setSelectedStyle(style.id); }}> {isDefault ? '正在使用' : '设为平台默认'}</Button>
                  {!style.canSetDefault && !isDefault && <p className="mt-2 text-xs leading-5 text-fg-muted">尚未覆盖全部员工，可在下方为已匹配的员工单独使用。</p>}
                </article>;
              })}
              </div>
            </section>)}
            {!visibleGroups.length && <div role="status" className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
              <p className="text-sm text-fg-muted">没有匹配的头像风格，请调整搜索或来源筛选。</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => { setStyleSearch(''); setSource('all'); }}>清除筛选</Button>
            </div>}
          </section>

          <section aria-labelledby="employee-styles-title" className="rounded-xl border border-neutral-200 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><h2 id="employee-styles-title" className="text-lg font-semibold">员工单独设置</h2>
                <p className="mt-1 text-sm text-fg-muted">可指定固定风格，或恢复跟随平台默认。未绑定的素材不可选择。</p></div>
              <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-3 h-4 w-4 text-fg-subtle" />
                <Input aria-label="搜索员工" placeholder="搜索姓名或岗位" className="pl-9" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
            </div>
            <ul className="mt-4">{visibleEmployees.map((employee) => <EmployeeStyleRow key={`${employee.id}-${employee.avatarStyle}-${employee.effectiveStyleId}-${employee.avatar}`} employee={employee} styles={styles} onSaved={refreshAvatars} />)}</ul>
            {!employees.length && <p className="py-10 text-center text-sm text-fg-muted">{search ? '没有匹配的员工，请调整搜索内容。' : '暂无员工，创建员工后可在此管理头像。'}</p>}
            {totalPages > 1 && <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-100 pt-4 text-sm text-fg-muted">
              <span>共 {employees.length} 位 · 第 {currentPage} / {totalPages} 页</span><div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</Button>
                <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>下一页</Button>
              </div></div>}
          </section>
          <p className="text-sm leading-6 text-fg-subtle">两端在重新获取员工数据后同步新头像；离线客户端暂时显示已缓存的图片。</p>
        </>}

      <AlertDialog open={Boolean(selectedStyle)} onOpenChange={(open) => { if (!open && !mutation.isPending) setSelectedStyle(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>将「{selected?.name}」设为平台默认？</AlertDialogTitle>
            <AlertDialogDescription>默认更新 {data?.followersCount ?? 0} 位跟随默认的员工。{data?.overridesCount ?? 0} 位单独设置的员工会保持原设置；原头像会保留，之后可以切回。</AlertDialogDescription></AlertDialogHeader>
          {(data?.overridesCount ?? 0) > 0 && <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <input type="checkbox" aria-label="同步全部员工" className="mt-0.5 h-4 w-4 accent-primary" checked={applyToAll} onChange={(event) => setApplyToAll(event.target.checked)} />
            <span><strong className="font-medium text-amber-900">同步全部员工</strong><span className="mt-1 block text-amber-800">将另外 {data?.overridesCount ?? 0} 位单独设置员工也切换到「{selected?.name}」，并保留原头像以便恢复。</span></span>
          </label>}
          {mutation.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(mutation.error)}</p>}
          <AlertDialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={() => setSelectedStyle(null)}>取消</Button>
            <Button loading={mutation.isPending} loadingText="正在切换" disabled={!selected?.canSetDefault} onClick={() => selectedStyle && mutation.mutate({ styleId: selectedStyle, applyToAll })}>确认切换</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
