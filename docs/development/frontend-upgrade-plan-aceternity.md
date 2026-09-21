# 前端升级方案一：Aceternity 科技感升级

**版本**：v1.0  
**日期**：2026-09-21  
**状态**：待实施  
**推荐度**：⭐⭐⭐⭐⭐

---

## 📋 方案概述

### 定位
**AI 平台的未来感** — 保留现有 Glassmorphism 基础，叠加 Aceternity UI 的高级动效和 3D 卡片，打造"硅基员工"的科技感。

### 核心优势
✅ **风格统一**：Aceternity 与现有 Glassmorphism 完美匹配  
✅ **实现成本低**：Aceternity 组件可直接复制粘贴，适配 Tailwind  
✅ **科技感强**：3D 卡片、Spotlight、动态边框强化"硅基员工"定位  
✅ **性能友好**：所有动效基于 Framer Motion（项目已安装 v13.4.0）  
✅ **快速交付**：3-4 个工作日可完成全部改造

### 技术栈兼容性
- ✅ Next.js 15 App Router
- ✅ Tailwind CSS 3.4
- ✅ Framer Motion 13.4（已安装）
- ✅ 现有 Glass 主题令牌体系
- ✅ Radix UI 组件库

---

## 🎯 改造范围与优先级

### P0（核心页面，第一阶段）
1. **Dashboard 工作台**（`web/src/app/(enterprise)/dashboard/page.tsx`）
2. **My Employees 员工卡片墙**（`web/src/app/(enterprise)/my-employees/page.tsx`）
3. **Chat 对话界面**（`web/src/features/chat/`）

### P1（增强体验，第二阶段）
4. **全局导航优化**（`web/src/components/shell/`）
5. **Dashboard 图表升级**（图表组件玻璃化）

---

## 📦 依赖安装与准备

### 1. 无需额外依赖
Aceternity UI 组件基于 Framer Motion + Tailwind CSS，项目已具备全部依赖：
- ✅ `framer-motion`: `^13.4.0`
- ✅ `tailwindcss`: `^3.4.17`
- ✅ `clsx` + `tailwind-merge`: 已安装

### 2. 创建 Aceternity 组件目录
```bash
mkdir -p web/src/components/aceternity
```

### 3. 下载参考组件（手动复制）
访问 https://ui.aceternity.com/components/ 并复制以下组件代码：
- `3d-card.tsx`
- `hover-effect.tsx`
- `spotlight.tsx`
- `text-generate-effect.tsx`
- `background-gradient.tsx`（增强版）
- `floating-dock.tsx`

---

## 🔧 改造详细步骤

---

## 📍 P0-1: Dashboard 工作台升级

### 当前状态
- 文件：`web/src/app/(enterprise)/dashboard/page.tsx`
- 组件：使用 `<StatCard>` 展示统计数据
- 问题：平面化，缺乏层次感和交互动效

### 改造目标
使用 Aceternity **3D Card Effect** 替换现有 StatCard，增加鼠标悬停的 3D 倾斜效果。

---

### 步骤 1.1：创建 3D Card 组件

**文件路径**：`web/src/components/aceternity/3d-card.tsx`

```typescript
'use client';

import { useMotionValue, useSpring, useTransform, motion } from 'framer-motion';
import React, { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export const CardContainer = ({
  children,
  className,
  containerClassName,
}: {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [5, -5]), {
    stiffness: 150,
    damping: 20,
  });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-5, 5]), {
    stiffness: 150,
    damping: 20,
  });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
    setIsHovered(false);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      className={cn('relative flex items-center justify-center', containerClassName)}
      style={{ perspective: '1000px' }}
    >
      <motion.div
        style={{
          rotateX,
          rotateY,
          transformStyle: 'preserve-3d',
        }}
        className={cn('relative', className)}
      >
        <div
          className={cn(
            'transition-shadow duration-200',
            isHovered && 'shadow-glow-brand',
          )}
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
};

export const CardBody = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return <div className={cn('relative', className)}>{children}</div>;
};

export const CardItem = ({
  as: Tag = 'div',
  children,
  className,
  translateX = 0,
  translateY = 0,
  translateZ = 0,
  rotateX = 0,
  rotateY = 0,
  rotateZ = 0,
  ...rest
}: {
  as?: React.ElementType;
  children: React.ReactNode;
  className?: string;
  translateX?: number | string;
  translateY?: number | string;
  translateZ?: number | string;
  rotateX?: number | string;
  rotateY?: number | string;
  rotateZ?: number | string;
  [key: string]: any;
}) => {
  return (
    <Tag
      className={className}
      style={{
        transform: `translateX(${translateX}px) translateY(${translateY}px) translateZ(${translateZ}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
};
```

---

### 步骤 1.2：创建增强版 StatCard3D

**文件路径**：`web/src/components/ui/stat-card-3d.tsx`

```typescript
'use client';

import { LucideIcon } from 'lucide-react';
import { CardContainer, CardBody, CardItem } from '@/components/aceternity/3d-card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface StatCard3DProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  description?: string;
  className?: string;
  onClick?: () => void;
}

export function StatCard3D({
  label,
  value,
  icon: Icon,
  trend,
  trendUp,
  description,
  className,
  onClick,
}: StatCard3DProps) {
  return (
    <CardContainer className="w-full" containerClassName={cn('w-full', onClick && 'cursor-pointer')}>
      <CardBody
        className={cn(
          'glass-card group relative h-full w-full p-6',
          'hover:border-glassline-brand transition-all duration-300',
          className,
        )}
        onClick={onClick}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <CardItem
                translateZ="30"
                className="text-sm font-medium text-gtext-secondary"
              >
                {label}
              </CardItem>
              {trend && (
                <CardItem translateZ="40">
                  <Badge
                    variant="default"
                    className={cn(
                      'text-xs font-normal backdrop-blur-sm',
                      trendUp
                        ? 'bg-gsuccess/10 text-gsuccess border-gsuccess/20'
                        : 'bg-glass-2 text-gtext-muted border-glassline',
                    )}
                  >
                    {trend}
                  </Badge>
                </CardItem>
              )}
            </div>

            <CardItem
              translateZ="50"
              className="text-3xl font-bold text-gtext-primary"
            >
              {value}
            </CardItem>

            {description && (
              <CardItem
                translateZ="30"
                className="text-xs text-gtext-muted"
              >
                {description}
              </CardItem>
            )}
          </div>

          <CardItem
            translateZ="60"
            rotateZ={-5}
            className="ml-4"
          >
            <div className="rounded-full bg-gbrand/10 p-3 backdrop-blur-sm border border-glassline group-hover:border-glassline-brand group-hover:shadow-glow-brand transition-all duration-300">
              <Icon className="h-6 w-6 text-gbrand-text" />
            </div>
          </CardItem>
        </div>
      </CardBody>
    </CardContainer>
  );
}
```

---

### 步骤 1.3：更新 Dashboard 页面

**文件路径**：`web/src/app/(enterprise)/dashboard/page.tsx`

**修改位置**：第 30 行附近的 import 语句

```typescript
// 原代码（注释掉）
// import { StatCard } from '@/components/ui/stat-card';

// 新代码
import { StatCard3D } from '@/components/ui/stat-card-3d';
```

**修改位置**：找到所有 `<StatCard` 使用处（约 4-6 处），替换为 `<StatCard3D`

示例：
```typescript
// 原代码
<StatCard
  label="硅基员工"
  value={stats.employeeCount}
  icon={Users}
  trend="+12%"
  trendUp={true}
/>

// 新代码
<StatCard3D
  label="硅基员工"
  value={stats.employeeCount}
  icon={Users}
  trend="+12%"
  trendUp={true}
/>
```

---

### 验收标准
- [ ] Dashboard 页面的统计卡片鼠标悬停时有 3D 倾斜效果
- [ ] 卡片边框在 hover 时显示品牌色辉光
- [ ] 图标在 3D 空间中略微突出
- [ ] 动效流畅，无卡顿（≥60fps）
- [ ] 移动端正常显示（3D 效果自动降级）

---

## 📍 P0-2: My Employees 员工卡片墙升级

### 当前状态
- 文件：`web/src/app/(enterprise)/my-employees/page.tsx` + `EmployeeCard.tsx`
- 组件：自研 `EmployeeCard`，静态展示
- 问题：卡片墙缺乏悬停效果和动态感

### 改造目标
使用 Aceternity **Hover Effect** + **Spotlight** 增强卡片墙视觉吸引力。

---

### 步骤 2.1：创建 Spotlight 组件

**文件路径**：`web/src/components/aceternity/spotlight.tsx`

```typescript
'use client';

import React from 'react';
import { cn } from '@/lib/utils';

type SpotlightProps = {
  className?: string;
  fill?: string;
};

export const Spotlight = ({ className, fill = 'white' }: SpotlightProps) => {
  return (
    <svg
      className={cn(
        'pointer-events-none absolute z-[1] h-[169%] w-[138%] animate-spotlight opacity-0',
        className,
      )}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 3787 2842"
      fill="none"
    >
      <g filter="url(#filter)">
        <ellipse
          cx="1924.71"
          cy="273.501"
          rx="1924.71"
          ry="273.501"
          transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
          fill={fill}
          fillOpacity="0.21"
        ></ellipse>
      </g>
      <defs>
        <filter
          id="filter"
          x="0.860352"
          y="0.838989"
          width="3785.16"
          height="2840.26"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix"></feFlood>
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="BackgroundImageFix"
            result="shape"
          ></feBlend>
          <feGaussianBlur
            stdDeviation="151"
            result="effect1_foregroundBlur_1065_8"
          ></feGaussianBlur>
        </filter>
      </defs>
    </svg>
  );
};
```

**对应 CSS 动画**（添加到 `web/src/app/globals.css`）：

```css
@keyframes spotlight {
  0% {
    opacity: 0;
    transform: translate(-72%, -62%) scale(0.5);
  }
  100% {
    opacity: 1;
    transform: translate(-50%, -40%) scale(1);
  }
}

.animate-spotlight {
  animation: spotlight 2s ease 0.75s 1 forwards;
}
```

---

### 步骤 2.2：创建 Hover Effect 组件

**文件路径**：`web/src/components/aceternity/card-hover-effect.tsx`

```typescript
'use client';

import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export const HoverEffect = ({
  items,
  className,
}: {
  items: {
    title: string;
    description: string;
    link: string;
    component?: React.ReactNode;
  }[];
  className?: string;
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4',
        className,
      )}
    >
      {items.map((item, idx) => (
        <Link
          href={item?.link}
          key={item?.link}
          className="group relative block h-full w-full p-2"
          onMouseEnter={() => setHoveredIndex(idx)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <AnimatePresence>
            {hoveredIndex === idx && (
              <motion.span
                className="absolute inset-0 block h-full w-full rounded-glass-lg bg-gbrand/10 backdrop-blur-glass-sm"
                layoutId="hoverBackground"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: { duration: 0.15 },
                }}
                exit={{
                  opacity: 0,
                  transition: { duration: 0.15, delay: 0.2 },
                }}
              />
            )}
          </AnimatePresence>
          {item.component ? (
            <div className="relative z-20">{item.component}</div>
          ) : (
            <Card>
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </Card>
          )}
        </Link>
      ))}
    </div>
  );
};

export const Card = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <div
      className={cn(
        'glass-card relative z-20 h-full w-full overflow-hidden rounded-glass-lg p-4',
        'border border-glassline group-hover:border-glassline-brand',
        'transition-all duration-300',
        className,
      )}
    >
      <div className="relative z-50">
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
};

export const CardTitle = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <h4 className={cn('text-lg font-semibold text-gtext-primary tracking-wide', className)}>
      {children}
    </h4>
  );
};

export const CardDescription = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <p
      className={cn(
        'mt-4 text-sm leading-relaxed text-gtext-secondary tracking-wide',
        className,
      )}
    >
      {children}
    </p>
  );
};
```

---

### 步骤 2.3：创建增强版 EmployeeCard

**文件路径**：`web/src/app/(enterprise)/my-employees/EmployeeCard3D.tsx`

```typescript
'use client';

import Link from 'next/link';
import { memo } from 'react';
import {
  Activity,
  ArrowUpRight,
  Clock3,
  MessageSquare,
  Users,
  Wallet,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Avatar } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import type { MyEmployee } from '@/lib/types';
import {
  formatLastUsed,
  formatSuccessRate,
  giftProgress,
} from '@/features/employee/usage-summary';
import { cn } from '@/lib/utils';

export const EmployeeCard3D = memo(function EmployeeCard3D({
  employee,
}: {
  employee: MyEmployee;
}) {
  const {
    subscriptionId,
    name,
    employee: template,
    usage,
    grantSource,
  } = employee;
  const gift = giftProgress(employee);
  const bindings = template.bindings ?? [];
  const detailUrl = `/my-employees/${subscriptionId}`;

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-card group relative flex min-w-0 flex-col overflow-hidden rounded-glass-lg border border-glassline p-4 transition-all duration-300 hover:border-glassline-brand hover:shadow-glow-brand"
    >
      {/* 悬停光效 */}
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="absolute -top-24 right-0 h-48 w-48 rounded-full bg-gbrand-text/10 blur-3xl" />
      </div>

      <Link
        href={detailUrl}
        className="relative z-10 flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-primary"
      >
        <motion.div
          whileHover={{ scale: 1.05 }}
          transition={{ type: 'spring', stiffness: 300 }}
        >
          <Avatar
            name={name}
            src={template.avatar}
            asset={template.avatarAsset}
            portrait
            className="h-[104px] w-[104px] shrink-0 rounded-glass-md border-2 border-glassline group-hover:border-glassline-brand"
          />
        </motion.div>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold leading-6 text-gtext-primary">
            {name}
          </h2>
          {name !== template.name && (
            <p
              className="mt-1 truncate text-xs text-gtext-muted"
              title={template.name}
            >
              {template.name}
            </p>
          )}
          <p className="mt-2 text-xs tabular-nums text-gtext-muted">
            v{employee.templateVersion}
          </p>
          <p className="mt-1 text-xs text-gtext-muted">
            {grantSource === 'DIRECT' ? '直接授权' : '部门授权'}
          </p>
        </div>
      </Link>

      <p
        className="relative z-10 mb-3 mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-gtext-secondary"
        title={template.description || template.position || undefined}
      >
        {template.description || template.position || '暂无员工简介'}
      </p>

      {usage && (
        <dl
          aria-label="本企业使用情况"
          className="relative z-10 space-y-2 border-t border-glassline py-3 text-xs"
        >
          <UsageRow icon={<Users />} label="近 30 天在用">
            <span className="font-medium text-gtext-primary">
              {usage.activeUserCount30d} 人
            </span>
            <span> / 已授权 {usage.grantedUserCount} 人</span>
          </UsageRow>
          <UsageRow icon={<Clock3 />} label="上次使用">
            {formatLastUsed(usage.lastUsedAt)}
          </UsageRow>
          <UsageRow icon={<Wallet />} label="本月消费">
            <span className="font-medium text-gtext-primary">
              ¥{Number(usage.monthCostCNY).toFixed(2)}
            </span>
            <span> · {usage.monthCallCount} 次调用</span>
          </UsageRow>
          <UsageRow icon={<Activity />} label="近 30 天成功率">
            <span
              className={
                usage.successRate30d === null
                  ? ''
                  : usage.successRate30d >= 90
                    ? 'text-gsuccess'
                    : 'text-gwarning'
              }
            >
              {formatSuccessRate(usage.successRate30d)}
            </span>
            <span> · {usage.executionCount30d} 次执行</span>
          </UsageRow>
        </dl>
      )}

      {gift && (
        <div className="relative z-10 mb-3 mt-1 space-y-2">
          <div className="flex flex-wrap justify-between gap-1 text-xs text-gtext-muted">
            <span>赠送算力</span>
            <span className="tabular-nums">
              剩余 ¥{gift.remainingCNY.toFixed(2)} / ¥
              {gift.grantedCNY.toFixed(2)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="赠送算力剩余比例"
            aria-valuenow={gift.remainingPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            className={cn(
              'h-1.5 overflow-hidden rounded-full bg-glass-2',
              gift.exhausted && 'bg-gdanger/20',
            )}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${gift.remainingPercent}%` }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className={cn(
                'h-full rounded-full',
                gift.low ? 'bg-gwarning' : 'bg-gsuccess',
              )}
              style={{
                minWidth: gift.exhausted ? undefined : 3,
              }}
            />
          </div>
          {gift.exhausted && (
            <p className="text-xs text-gtext-muted">赠送算力已用尽</p>
          )}
        </div>
      )}

      <div className="relative z-10 mb-4">
        <h3 className="mb-2 text-xs font-medium text-gtext-muted">
          已绑定技能与能力
        </h3>
        <div className="flex min-h-6 flex-wrap gap-1.5">
          {bindings.slice(0, 3).map(({ id, capability }) => (
            <motion.span
              key={id}
              title={capability.name}
              whileHover={{ scale: 1.05 }}
              className="max-w-full truncate rounded-md border border-glassline bg-gbrand/10 px-2 py-1 text-xs text-gbrand-text backdrop-blur-sm"
            >
              {capability.name}
            </motion.span>
          ))}
          {bindings.length > 3 && (
            <Link
              href={detailUrl}
              className="py-1 text-xs text-gtext-muted hover:text-gbrand-text"
            >
              还有 {bindings.length - 3} 项
            </Link>
          )}
          {!bindings.length && (
            <span className="text-xs text-gtext-muted">暂无绑定能力</span>
          )}
        </div>
      </div>

      <div className="relative z-10 mt-auto flex items-center justify-between gap-3 border-t border-glassline pt-3">
        <Link
          href={`/chat?employeeId=${template.id}`}
          className={cn(
            buttonVariants({ size: 'sm' }),
            'bg-gbrand text-white hover:bg-gbrand-hover',
          )}
        >
          <MessageSquare className="h-4 w-4" />
          开始对话
        </Link>
        <Link
          href={detailUrl}
          className="inline-flex items-center gap-1 py-1.5 text-sm text-gtext-muted hover:text-gbrand-text"
        >
          查看详情
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </motion.article>
  );
});

function UsageRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="flex shrink-0 items-center gap-2 text-gtext-muted">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0 text-right tabular-nums text-gtext-muted">
        {children}
      </dd>
    </div>
  );
}
```

---

### 步骤 2.4：更新 My Employees 页面

**文件路径**：`web/src/app/(enterprise)/my-employees/page.tsx`

**修改 1**：添加 Spotlight 和导入新卡片

```typescript
// 在顶部添加导入
import { Spotlight } from '@/components/aceternity/spotlight';
import { EmployeeCard3D } from './EmployeeCard3D';
```

**修改 2**：在卡片网格外层添加 Spotlight

找到卡片网格渲染部分（约第 233-240 行），替换为：

```typescript
// 原代码
<div className={styles.container}>
  <div className={styles.grid}>
    {filteredEmployees.map((emp) => (
      <EmployeeCard key={emp.subscriptionId} employee={emp} />
    ))}
  </div>
</div>

// 新代码
<div className={cn(styles.container, 'relative')}>
  {/* Aceternity Spotlight 效果 */}
  <Spotlight
    className="absolute -top-40 left-0 z-0 md:left-60 md:-top-20"
    fill="#818cf8"
  />
  
  <div className={cn(styles.grid, 'relative z-10')}>
    {filteredEmployees.map((emp) => (
      <EmployeeCard3D key={emp.subscriptionId} employee={emp} />
    ))}
  </div>
</div>
```

---

### 验收标准
- [ ] 页面加载时，左上角有淡入的 Spotlight 光效
- [ ] 卡片有淡入 + 上移的进场动画
- [ ] 鼠标悬停时，卡片边框变为品牌色并显示辉光
- [ ] 头像有轻微缩放效果
- [ ] 进度条有动画填充效果
- [ ] 移动端正常显示（动效降级）

---

## 📍 P0-3: Chat 对话界面升级

### 当前状态
- 文件：`web/src/features/chat/chat-window.tsx` + `message-bubble.tsx`
- 组件：自研消息气泡
- 问题：AI 回复没有打字机效果，消息展示单调

### 改造目标
使用 Aceternity **Text Generate Effect** 为 AI 消息添加打字机效果。

---

### 步骤 3.1：创建 Text Generate Effect 组件

**文件路径**：`web/src/components/aceternity/text-generate-effect.tsx`

```typescript
'use client';

import { useEffect } from 'react';
import { motion, stagger, useAnimate, useInView } from 'framer-motion';
import { cn } from '@/lib/utils';

export const TextGenerateEffect = ({
  words,
  className,
  filter = true,
  duration = 0.5,
}: {
  words: string;
  className?: string;
  filter?: boolean;
  duration?: number;
}) => {
  const [scope, animate] = useAnimate();
  const isInView = useInView(scope, { once: true });
  const wordsArray = words.split(' ');

  useEffect(() => {
    if (isInView) {
      animate(
        'span',
        {
          opacity: 1,
          filter: filter ? 'blur(0px)' : 'none',
        },
        {
          duration: duration,
          delay: stagger(0.05),
        },
      );
    }
  }, [isInView, animate, duration, filter]);

  const renderWords = () => {
    return (
      <motion.div ref={scope}>
        {wordsArray.map((word, idx) => {
          return (
            <motion.span
              key={word + idx}
              className="opacity-0"
              style={{
                filter: filter ? 'blur(10px)' : 'none',
              }}
            >
              {word}{' '}
            </motion.span>
          );
        })}
      </motion.div>
    );
  };

  return (
    <div className={cn('', className)}>
      <div className="text-gtext-primary">
        {renderWords()}
      </div>
    </div>
  );
};
```

---

### 步骤 3.2：更新 Message Bubble 组件

**文件路径**：`web/src/features/chat/message-bubble.tsx`

**修改位置**：找到 AI 消息渲染部分，添加条件渲染

```typescript
// 在顶部添加导入
import { TextGenerateEffect } from '@/components/aceternity/text-generate-effect';

// 找到 assistant 消息内容渲染部分（约第 50-70 行）
// 原代码
{role === 'assistant' && (
  <div className="markdown-body">
    <Markdown>{content}</Markdown>
  </div>
)}

// 新代码（添加是否为最新消息的判断）
{role === 'assistant' && (
  <div className="markdown-body">
    {isLatestMessage ? (
      <TextGenerateEffect words={content} duration={0.3} />
    ) : (
      <Markdown>{content}</Markdown>
    )}
  </div>
)}
```

**添加 Props**：在 `MessageBubbleProps` 接口添加 `isLatestMessage?: boolean`

```typescript
interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  avatar?: string | null;
  name?: string;
  timestamp?: string;
  isLatestMessage?: boolean; // 新增
}
```

---

### 步骤 3.3：更新 Chat Window 调用

**文件路径**：`web/src/features/chat/chat-window.tsx`

找到消息列表渲染部分（约第 200-250 行），添加 `isLatestMessage` 判断：

```typescript
// 原代码
{messages.map((msg, index) => (
  <MessageBubble
    key={msg.id}
    role={msg.role}
    content={msg.content}
    avatar={msg.avatar}
    name={msg.name}
  />
))}

// 新代码
{messages.map((msg, index) => (
  <MessageBubble
    key={msg.id}
    role={msg.role}
    content={msg.content}
    avatar={msg.avatar}
    name={msg.name}
    isLatestMessage={index === messages.length - 1 && msg.role === 'assistant'}
  />
))}
```

---

### 验收标准
- [ ] 最新的 AI 消息有逐字淡入的打字机效果
- [ ] 历史消息直接显示完整内容（无动效）
- [ ] 用户消息不受影响
- [ ] 流式输出过程中不触发动效（只在完成后触发）
- [ ] 移动端正常显示

---

## 📍 P1-4: 全局导航优化（可选）

### 改造目标
在移动端/折叠状态使用 Aceternity **Floating Dock** 替代传统侧边栏。

### 步骤 4.1：创建 Floating Dock 组件

**文件路径**：`web/src/components/aceternity/floating-dock.tsx`

```typescript
'use client';

import { cn } from '@/lib/utils';
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRef, useState } from 'react';

export const FloatingDock = ({
  items,
  desktopClassName,
  mobileClassName,
}: {
  items: { title: string; icon: React.ReactNode; href: string }[];
  desktopClassName?: string;
  mobileClassName?: string;
}) => {
  return (
    <>
      <FloatingDockDesktop items={items} className={desktopClassName} />
      <FloatingDockMobile items={items} className={mobileClassName} />
    </>
  );
};

const FloatingDockMobile = ({
  items,
  className,
}: {
  items: { title: string; icon: React.ReactNode; href: string }[];
  className?: string;
}) => {
  return (
    <div className={cn('fixed bottom-4 right-4 z-50 block md:hidden', className)}>
      <div className="glass-card flex h-16 gap-4 rounded-full border border-glassline px-4">
        {items.map((item, idx) => (
          <Link
            key={idx}
            href={item.href}
            className="flex h-16 w-16 items-center justify-center"
          >
            <div className="h-6 w-6 text-gtext-primary">{item.icon}</div>
          </Link>
        ))}
      </div>
    </div>
  );
};

const FloatingDockDesktop = ({
  items,
  className,
}: {
  items: { title: string; icon: React.ReactNode; href: string }[];
  className?: string;
}) => {
  const mouseX = useMotionValue(Infinity);
  return (
    <motion.div
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn(
        'glass-card mx-auto hidden h-16 items-end gap-4 rounded-full border border-glassline px-4 pb-3 md:flex',
        className,
      )}
    >
      {items.map((item, idx) => (
        <IconContainer mouseX={mouseX} key={idx} {...item} />
      ))}
    </motion.div>
  );
};

function IconContainer({
  mouseX,
  title,
  icon,
  href,
}: {
  mouseX: any;
  title: string;
  icon: React.ReactNode;
  href: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthTransform = useTransform(distance, [-150, 0, 150], [40, 80, 40]);
  const heightTransform = useTransform(distance, [-150, 0, 150], [40, 80, 40]);

  const widthIcon = useTransform(distance, [-150, 0, 150], [20, 40, 20]);
  const heightIcon = useTransform(distance, [-150, 0, 150], [20, 40, 20]);

  const width = useSpring(widthTransform, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });
  const height = useSpring(heightTransform, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });

  const widthIconSpring = useSpring(widthIcon, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });
  const heightIconSpring = useSpring(heightIcon, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });

  const [hovered, setHovered] = useState(false);

  return (
    <Link href={href}>
      <motion.div
        ref={ref}
        style={{ width, height }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative flex items-center justify-center rounded-full bg-glass-2 backdrop-blur-glass-sm"
      >
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, y: 10, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 2, x: '-50%' }}
              className="absolute -top-8 left-1/2 w-fit whitespace-pre rounded-md border border-glassline bg-glass-4 px-2 py-0.5 text-xs text-gtext-primary backdrop-blur-glass-md"
            >
              {title}
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          style={{ width: widthIconSpring, height: heightIconSpring }}
          className="flex items-center justify-center text-gtext-primary"
        >
          {icon}
        </motion.div>
      </motion.div>
    </Link>
  );
}
```

---

### 步骤 4.2：集成到 Shell

**文件路径**：`web/src/components/shell/enterprise-shell.tsx`

```typescript
// 在底部添加 Floating Dock（移动端显示）
import { FloatingDock } from '@/components/aceternity/floating-dock';
import { Home, Users, MessageSquare, Settings } from 'lucide-react';

// 在 return 的最外层 div 末尾添加
<FloatingDock
  items={[
    { title: '工作台', icon: <Home />, href: '/dashboard' },
    { title: '硅基员工', icon: <Users />, href: '/my-employees' },
    { title: '对话', icon: <MessageSquare />, href: '/chat' },
    { title: '设置', icon: <Settings />, href: '/settings' },
  ]}
  mobileClassName="md:hidden"
/>
```

---

### 验收标准
- [ ] 移动端右下角显示浮动 Dock
- [ ] 桌面端底部居中显示 Dock（可选）
- [ ] 鼠标悬停时图标放大
- [ ] 显示工具提示标签
- [ ] 玻璃形态效果正确

---

## 📍 P1-5: Dashboard 图表升级

### 改造目标
为 Recharts 图表添加玻璃形态容器和渐变边框。

### 步骤 5.1：更新 Dashboard 图表容器

**文件路径**：`web/src/app/(enterprise)/dashboard/page.tsx`

找到图表组件渲染部分，包裹 Background Gradient：

```typescript
import { BackgroundGradient } from '@/components/aceternity/background-gradient';

// 原代码
<Card>
  <CardHeader>
    <CardTitle>模型调用分布</CardTitle>
  </CardHeader>
  <CardContent>
    <ModelDistributionChart data={modelDistribution} />
  </CardContent>
</Card>

// 新代码
<BackgroundGradient className="rounded-glass-lg p-[2px]">
  <Card className="glass-card border-none">
    <CardHeader>
      <CardTitle className="text-gtext-primary">模型调用分布</CardTitle>
    </CardHeader>
    <CardContent>
      <ModelDistributionChart data={modelDistribution} />
    </CardContent>
  </Card>
</BackgroundGradient>
```

---

### 步骤 5.2：创建 Background Gradient 组件（如果未从 Aceternity 复制）

**文件路径**：`web/src/components/aceternity/background-gradient.tsx`

```typescript
'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export const BackgroundGradient = ({
  children,
  className,
  containerClassName,
  animate = true,
}: {
  children?: React.ReactNode;
  className?: string;
  containerClassName?: string;
  animate?: boolean;
}) => {
  const variants = {
    initial: {
      backgroundPosition: '0 50%',
    },
    animate: {
      backgroundPosition: ['0, 50%', '100% 50%', '0 50%'],
    },
  };
  return (
    <div className={cn('group relative', containerClassName)}>
      <motion.div
        variants={animate ? variants : undefined}
        initial={animate ? 'initial' : undefined}
        animate={animate ? 'animate' : undefined}
        transition={
          animate
            ? {
                duration: 5,
                repeat: Infinity,
                repeatType: 'reverse',
              }
            : undefined
        }
        style={{
          backgroundSize: animate ? '400% 400%' : undefined,
        }}
        className={cn(
          'absolute inset-0 z-[1] rounded-glass-lg opacity-60 blur-xl transition duration-500 will-change-transform group-hover:opacity-100',
          'bg-gradient-to-br from-gbrand-text via-gbrand to-gsecondary-text',
        )}
      />
      <motion.div
        variants={animate ? variants : undefined}
        initial={animate ? 'initial' : undefined}
        animate={animate ? 'animate' : undefined}
        transition={
          animate
            ? {
                duration: 5,
                repeat: Infinity,
                repeatType: 'reverse',
              }
            : undefined
        }
        style={{
          backgroundSize: animate ? '400% 400%' : undefined,
        }}
        className={cn(
          'absolute inset-0 z-[1] rounded-glass-lg will-change-transform',
          'bg-gradient-to-br from-gbrand-text via-gbrand to-gsecondary-text',
        )}
      />

      <div className={cn('relative z-10', className)}>{children}</div>
    </div>
  );
};
```

---

### 验收标准
- [ ] 图表卡片有渐变边框
- [ ] 悬停时边框渐变动画
- [ ] 玻璃背景模糊效果
- [ ] 图表内容清晰可见
- [ ] 性能无明显下降

---

## 🧪 测试计划

### 功能测试
- [ ] Dashboard 页面所有 StatCard 都有 3D 效果
- [ ] My Employees 页面卡片有 Hover Effect 和 Spotlight
- [ ] Chat 最新 AI 消息有打字机效果
- [ ] Floating Dock 在移动端正常显示
- [ ] 图表卡片有渐变边框动画

### 兼容性测试
- [ ] Chrome/Edge 最新版
- [ ] Firefox 最新版
- [ ] Safari 最新版（macOS/iOS）
- [ ] 移动端 Chrome/Safari

### 性能测试
- [ ] Dashboard 页面加载时间 < 2s
- [ ] 3D 卡片动效流畅度 ≥ 60fps
- [ ] Chat 滚动流畅度 ≥ 60fps
- [ ] Lighthouse Performance Score > 90

### 无障碍测试
- [ ] 键盘导航正常
- [ ] 屏幕阅读器兼容
- [ ] 色彩对比度符合 WCAG AA
- [ ] `prefers-reduced-motion` 支持

---

## 📦 交付物清单

### 新增组件
- [ ] `web/src/components/aceternity/3d-card.tsx`
- [ ] `web/src/components/aceternity/spotlight.tsx`
- [ ] `web/src/components/aceternity/card-hover-effect.tsx`
- [ ] `web/src/components/aceternity/text-generate-effect.tsx`
- [ ] `web/src/components/aceternity/floating-dock.tsx`
- [ ] `web/src/components/aceternity/background-gradient.tsx`
- [ ] `web/src/components/ui/stat-card-3d.tsx`
- [ ] `web/src/app/(enterprise)/my-employees/EmployeeCard3D.tsx`

### 修改文件
- [ ] `web/src/app/(enterprise)/dashboard/page.tsx`
- [ ] `web/src/app/(enterprise)/my-employees/page.tsx`
- [ ] `web/src/features/chat/message-bubble.tsx`
- [ ] `web/src/features/chat/chat-window.tsx`
- [ ] `web/src/components/shell/enterprise-shell.tsx`
- [ ] `web/src/app/globals.css`（添加 Spotlight 动画）

### 文档
- [ ] 本开发文档
- [ ] 组件使用说明（Storybook 或 README）
- [ ] 性能测试报告

---

## ⏱️ 时间估算

| 阶段 | 任务 | 预估时间 |
|------|------|----------|
| **P0-1** | Dashboard 3D Card | 2-3h |
| **P0-2** | My Employees Hover Effect | 4-5h |
| **P0-3** | Chat Text Generate Effect | 3-4h |
| **P1-4** | Floating Dock（可选）| 3-4h |
| **P1-5** | 图表 Background Gradient | 2-3h |
| **测试** | 全量测试与调试 | 6-8h |
| **文档** | 组件文档与总结 | 2h |
| **总计** | | **22-29h（3-4 工作日）** |

---

## 🚀 实施建议

### 分阶段交付
1. **Day 1**：P0-1 Dashboard（立竿见影，快速看效果）
2. **Day 2**：P0-2 My Employees（核心页面，视觉冲击力强）
3. **Day 3**：P0-3 Chat（用户高频使用，体验提升明显）
4. **Day 4**：P1-4/P1-5 + 测试（锦上添花，全量验收）

### 风险控制
- ✅ **渐进式升级**：保留原组件，新组件并存，出问题可快速回滚
- ✅ **特性开关**：通过环境变量控制是否启用 Aceternity 组件
- ✅ **性能监控**：用 Lighthouse CI 监控每次改动的性能影响
- ✅ **移动端优先**：确保移动端体验不受影响（3D 效果可降级）

### 代码审查要点
- [ ] 动画是否支持 `prefers-reduced-motion`
- [ ] 是否有内存泄漏（Framer Motion 清理）
- [ ] 是否有不必要的重渲染
- [ ] CSS 变量是否正确引用 Glass 令牌

---

## 📚 参考资源

### Aceternity UI 官方文档
- 3D Card: https://ui.aceternity.com/components/3d-card
- Hover Effect: https://ui.aceternity.com/components/hover-effect
- Spotlight: https://ui.aceternity.com/components/spotlight
- Text Generate Effect: https://ui.aceternity.com/components/text-generate-effect
- Floating Dock: https://ui.aceternity.com/components/floating-dock
- Background Gradient: https://ui.aceternity.com/components/background-gradient

### 项目现有设计系统
- Glass 令牌定义：`web/src/app/globals.css` 行 381-575
- Tailwind 配置：`web/tailwind.config.ts`
- 动画预设：`web/src/lib/animation.ts`

### 性能优化指南
- Framer Motion 性能：https://www.framer.com/motion/guide-reduce-bundle-size/
- CSS Backdrop Filter 优化：https://web.dev/backdrop-filter/

---

## ✅ 验收标准

### 视觉效果
- [ ] 所有 Aceternity 组件与 Glass 主题完美融合
- [ ] 动效流畅，无卡顿
- [ ] 玻璃质感正确（边框、模糊、阴影）
- [ ] 品牌色一致（Indigo 系）

### 功能完整性
- [ ] 所有交互功能正常（点击、悬停、滚动）
- [ ] 无 Console 错误或警告
- [ ] TypeScript 类型检查通过
- [ ] 单元测试通过（如有）

### 性能指标
- [ ] First Contentful Paint < 1.5s
- [ ] Largest Contentful Paint < 2.5s
- [ ] Time to Interactive < 3.5s
- [ ] Cumulative Layout Shift < 0.1
- [ ] 动画帧率 ≥ 60fps

### 兼容性
- [ ] 桌面端三大浏览器（Chrome, Firefox, Safari）
- [ ] 移动端 iOS Safari + Android Chrome
- [ ] 响应式布局正确（375px - 1920px）
- [ ] 支持 `prefers-reduced-motion`

---

## 🎉 预期效果

实施完成后，SEP 前端将呈现：

1. **Dashboard**：3D 倾斜卡片，鼠标悬停时数据"浮"起来
2. **My Employees**：聚光灯扫射 + 卡片悬停放大，科技感拉满
3. **Chat**：AI 消息逐字淡入，像真人在打字
4. **移动端**：底部悬浮 Dock，macOS 风格导航
5. **整体**：保留 Glassmorphism 基础，叠加高级动效，"硅基员工"概念视觉化

---

**文档版本**：v1.0  
**最后更新**：2026-09-21  
**维护者**：Frontend Team
