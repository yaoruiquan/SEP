# 前端升级方案二：shadcn/ui + Tremor 企业级重构

**版本**：v1.0  
**日期**：2026-09-21  
**状态**：待实施  
**推荐度**：⭐⭐⭐⭐

---

## 📋 方案概述

### 定位
**企业级数据平台标准** — 替换现有 UI 组件库为 shadcn/ui + Tremor，打造专业、规范、易维护的企业管理后台。

### 核心优势
✅ **行业标准**：shadcn/ui 是当前 React 生态最流行的企业级组件库  
✅ **数据可视化强**：Tremor 专为数据密集型应用设计，图表开箱即用  
✅ **维护成本低**：组件源码在项目内，可完全控制，无黑盒依赖  
✅ **类型安全**：TypeScript 优先，100% 类型覆盖  
✅ **设计系统成熟**：自带完整的 Design Tokens 体系  
✅ **社区活跃**：GitHub 60k+ stars，持续维护

### 技术栈兼容性
- ✅ Next.js 15 App Router
- ✅ Tailwind CSS 3.4
- ✅ Radix UI（项目已安装，shadcn/ui 底层依赖）
- ✅ React 19
- ✅ TypeScript 5.7

---

## 🎯 改造范围与优先级

### P0（核心基础设施，第一阶段）
1. **安装 shadcn/ui + Tremor**
2. **统一 Design Tokens**（与现有 Glass 主题桥接）
3. **全局组件替换**（Button, Card, Input, Select 等）

### P1（数据展示升级，第二阶段）
4. **Dashboard 图表重构**（Tremor Charts）
5. **表格组件升级**（TanStack Table + shadcn/ui Data Table）
6. **表单组件统一**（react-hook-form + shadcn/ui Form）

### P2（高级组件，第三阶段）
7. **Command Palette**（shadcn/ui Command）
8. **全局搜索**（Algolia 风格）
9. **通知系统重构**（shadcn/ui Toast + Sonner）

---

## 📦 依赖安装与准备

### 1. 安装 shadcn/ui CLI

```bash
cd web
npx shadcn@latest init
```

**交互式配置**（推荐选项）：
```
✔ Would you like to use TypeScript? … yes
✔ Which style would you like to use? › New York
✔ Which color would you like to use as base color? › Slate
✔ Where is your global CSS file? … src/app/globals.css
✔ Would you like to use CSS variables for colors? … yes
✔ Where is your tailwind.config.js located? … tailwind.config.ts
✔ Configure the import alias for components: … @/components
✔ Configure the import alias for utils: … @/lib/utils
✔ Are you using React Server Components? … yes
```

### 2. 安装 Tremor

```bash
pnpm add @tremor/react
```

### 3. 安装初始组件集

```bash
# 基础组件（P0 必需）
npx shadcn@latest add button card input label select separator badge avatar dialog dropdown-menu

# 数据展示组件（P1）
npx shadcn@latest add table tabs accordion collapsible

# 表单组件（P1）
npx shadcn@latest add form checkbox radio-group switch textarea

# 高级组件（P2）
npx shadcn@latest add command toast sonner
```

---

## 🎨 Design Tokens 桥接

### 问题
项目现有 **Glassmorphism 设计系统**（5 层玻璃、极光球、深色底），shadcn/ui 默认是 **浅色企业风格**。需要：
1. **保留 Glass 主题作为可选主题**
2. **shadcn/ui 默认使用企业浅色主题**
3. **两套主题可通过按钮切换**

---

### 步骤 1：扩展 shadcn/ui 颜色令牌

**文件路径**：`web/tailwind.config.ts`

在 `theme.extend.colors` 中，**保留现有 Glass 令牌**，添加 shadcn/ui 标准令牌：

```typescript
// 在现有 colors 对象中添加（不删除现有 gbg-*, glass-* 等令牌）

colors: {
  // ─────────────────────────────────────────────────────────────────
  // shadcn/ui 标准令牌（浅色主题默认值）
  // ─────────────────────────────────────────────────────────────────
  border: 'hsl(var(--border))',
  input: 'hsl(var(--input))',
  ring: 'hsl(var(--ring))',
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
  primary: {
    DEFAULT: 'hsl(var(--primary))',
    foreground: 'hsl(var(--primary-foreground))',
  },
  secondary: {
    DEFAULT: 'hsl(var(--secondary))',
    foreground: 'hsl(var(--secondary-foreground))',
  },
  destructive: {
    DEFAULT: 'hsl(var(--destructive))',
    foreground: 'hsl(var(--destructive-foreground))',
  },
  muted: {
    DEFAULT: 'hsl(var(--muted))',
    foreground: 'hsl(var(--muted-foreground))',
  },
  accent: {
    DEFAULT: 'hsl(var(--accent))',
    foreground: 'hsl(var(--accent-foreground))',
  },
  popover: {
    DEFAULT: 'hsl(var(--popover))',
    foreground: 'hsl(var(--popover-foreground))',
  },
  card: {
    DEFAULT: 'hsl(var(--card))',
    foreground: 'hsl(var(--card-foreground))',
  },

  // ─────────────────────────────────────────────────────────────────
  // 现有 Glass 令牌保持不变（gbg-*, glass-*, glassline-*, etc.）
  // ─────────────────────────────────────────────────────────────────
  gbg: { /* ... 保持现有定义 */ },
  glass: { /* ... 保持现有定义 */ },
  // ...
},
```

---

### 步骤 2：更新 globals.css 添加 shadcn/ui 令牌

**文件路径**：`web/src/app/globals.css`

在 `:root` 作用域**末尾**添加 shadcn/ui 标准令牌（不删除现有变量）：

```css
@layer base {
  :root {
    /* ═══════════════════════════════════════════════════════════════
       shadcn/ui 标准颜色令牌（Light Theme）
       ═══════════════════════════════════════════════════════════════ */
    --background: 0 0% 100%;           /* 纯白背景 */
    --foreground: 222.2 84% 4.9%;      /* 深色文字 */
    --card: 0 0% 100%;                 /* 卡片背景（白） */
    --card-foreground: 222.2 84% 4.9%; /* 卡片文字 */
    --popover: 0 0% 100%;              /* 弹出层背景 */
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;      /* Indigo-600 品牌色 */
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;        /* 浅灰 */
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;            /* 静音色 */
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;           /* 强调色 */
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;      /* 危险红 */
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;       /* 边框灰 */
    --input: 214.3 31.8% 91.4%;        /* 输入框边框 */
    --ring: 221.2 83.2% 53.3%;         /* 聚焦环（品牌色）*/
    --radius: 0.5rem;                  /* 默认圆角 */

    /* ═══════════════════════════════════════════════════════════════
       现有 Glass 令牌保持不变
       ═══════════════════════════════════════════════════════════════ */
    /* --gbg-deep-rgb, --glass-1, etc. 全部保留 */
  }

  .dark {
    /* shadcn/ui Dark Theme */
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
  }

  /* Glass 主题保持独立作用域 .theme-glass { ... } */
}
```

---

### 步骤 3：主题切换器

**文件路径**：`web/src/components/theme-switcher.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun, Droplet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Theme = 'light' | 'dark' | 'glass';

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    const initial = stored ?? 'light';
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'theme-glass');
    
    if (newTheme === 'glass') {
      root.classList.add('theme-glass');
    } else {
      root.classList.add(newTheme);
    }
    
    localStorage.setItem('theme', newTheme);
    setTheme(newTheme);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          {theme === 'light' && <Sun className="h-5 w-5" />}
          {theme === 'dark' && <Moon className="h-5 w-5" />}
          {theme === 'glass' && <Droplet className="h-5 w-5" />}
          <span className="sr-only">切换主题</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => applyTheme('light')}>
          <Sun className="mr-2 h-4 w-4" />
          浅色
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => applyTheme('dark')}>
          <Moon className="mr-2 h-4 w-4" />
          深色
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => applyTheme('glass')}>
          <Droplet className="mr-2 h-4 w-4" />
          玻璃形态
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

**集成到导航栏**：在 `enterprise-shell.tsx` 的顶栏添加 `<ThemeSwitcher />`。

---

## 🔧 改造详细步骤

---

## 📍 P0-1: 全局组件替换

### 当前状态
项目有 **自研基础组件**（`web/src/components/ui/` 下约 40 个组件），部分基于 Radix UI，但缺乏统一设计规范。

### 改造目标
**逐步替换为 shadcn/ui 组件**，保留自研组件作为备份。

---

### 步骤 1.1：Button 组件替换

shadcn/ui 的 Button 已通过 `npx shadcn@latest add button` 安装到 `web/src/components/ui/button.tsx`。

**检查差异**：
```bash
# 备份现有 Button
mv web/src/components/ui/button.tsx web/src/components/ui/button.old.tsx

# 安装 shadcn/ui Button
npx shadcn@latest add button
```

**迁移步骤**：
1. **对比 API 差异**：现有 Button 的 `variants` 是否与 shadcn/ui 一致？
2. **全局搜索替换**：`grep -r "from '@/components/ui/button'" web/src/` 找到所有使用处
3. **逐文件检查**：确认 `variant` prop 值是否兼容（`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`）
4. **测试**：运行 `pnpm dev:web`，逐页检查按钮样式

**兼容性注意**：
- 现有项目使用 `variant="primary"`，shadcn/ui 是 `variant="default"`
- 需全局替换：`variant="primary"` → `variant="default"`

---

### 步骤 1.2：Card 组件替换

```bash
# 备份
mv web/src/components/ui/card.tsx web/src/components/ui/card.old.tsx

# 安装
npx shadcn@latest add card
```

**shadcn/ui Card 结构**：
```tsx
<Card>
  <CardHeader>
    <CardTitle>标题</CardTitle>
    <CardDescription>描述</CardDescription>
  </CardHeader>
  <CardContent>内容</CardContent>
  <CardFooter>底部</CardFooter>
</Card>
```

**迁移检查清单**：
- [ ] 现有 Card 是否使用 `<CardHeader>` 子组件？
- [ ] 是否有自定义 `className` 覆盖？
- [ ] 是否有 onClick 事件？（shadcn/ui Card 支持）

---

### 步骤 1.3：Input / Select / Label 替换

```bash
npx shadcn@latest add input select label
```

**表单组件迁移优先级**：
1. **Label**：最简单，直接替换
2. **Input**：检查 `type` prop 兼容性
3. **Select**：API 变化较大，需重点测试

**Select 迁移示例**：

**原代码**（假设项目现有 Select）：
```tsx
<Select value={value} onValueChange={setValue}>
  <option value="1">选项 1</option>
  <option value="2">选项 2</option>
</Select>
```

**shadcn/ui Select**：
```tsx
<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="请选择" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="1">选项 1</SelectItem>
    <SelectItem value="2">选项 2</SelectItem>
  </SelectContent>
</Select>
```

---

### 步骤 1.4：全局组件替换脚本

**文件路径**：`web/scripts/migrate-to-shadcn.sh`

```bash
#!/bin/bash
# 自动化组件迁移脚本

echo "开始迁移到 shadcn/ui..."

# 1. 备份现有组件
mkdir -p web/src/components/ui/legacy
mv web/src/components/ui/{button,card,input,select,label}.tsx web/src/components/ui/legacy/ 2>/dev/null

# 2. 安装 shadcn/ui 组件
npx shadcn@latest add button card input select label badge avatar dialog dropdown-menu --yes

# 3. 全局替换 variant 名称
find web/src -type f -name "*.tsx" -exec sed -i '' 's/variant="primary"/variant="default"/g' {} \;

echo "迁移完成！请运行 'pnpm dev:web' 检查页面。"
```

---

### 验收标准
- [ ] 所有基础组件使用 shadcn/ui 版本
- [ ] 样式与 shadcn/ui 标准一致
- [ ] 无 TypeScript 类型错误
- [ ] 所有页面正常渲染
- [ ] 交互功能正常（点击、悬停、聚焦）

---

## 📍 P1-4: Dashboard 图表重构（Tremor Charts）

### 当前状态
- 文件：`web/src/app/(enterprise)/dashboard/page.tsx`
- 图表库：Recharts
- 问题：配置复杂，样式不统一

### 改造目标
使用 **Tremor Charts** 替换 Recharts，简化代码，统一风格。

---

### 步骤 4.1：Tremor 配置

**文件路径**：`web/tailwind.config.ts`

```typescript
// 在 content 数组中添加 Tremor
content: [
  './src/**/*.{ts,tsx}',
  './node_modules/@tremor/**/*.{js,ts,jsx,tsx}', // Tremor 组件
],
```

---

### 步骤 4.2：创建 Tremor 图表组件

**文件路径**：`web/src/components/charts/tremor-area-chart.tsx`

```typescript
'use client';

import { AreaChart, Card, Title } from '@tremor/react';

interface TremorAreaChartProps {
  title: string;
  data: Array<{ date: string; [key: string]: string | number }>;
  categories: string[];
  colors?: ('indigo' | 'cyan' | 'amber' | 'rose')[];
  valueFormatter?: (value: number) => string;
}

export function TremorAreaChart({
  title,
  data,
  categories,
  colors = ['indigo', 'cyan'],
  valueFormatter,
}: TremorAreaChartProps) {
  return (
    <Card>
      <Title>{title}</Title>
      <AreaChart
        className="mt-4 h-72"
        data={data}
        index="date"
        categories={categories}
        colors={colors}
        valueFormatter={valueFormatter}
        showLegend
        showGridLines
        yAxisWidth={60}
      />
    </Card>
  );
}
```

---

### 步骤 4.3：更新 Dashboard 使用 Tremor

**文件路径**：`web/src/app/(enterprise)/dashboard/page.tsx`

**原代码（Recharts）**：
```tsx
<Card>
  <CardHeader>
    <CardTitle>模型调用趋势</CardTitle>
  </CardHeader>
  <CardContent>
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Area type="monotone" dataKey="calls" stroke="#6366f1" fill="#6366f1" />
      </AreaChart>
    </ResponsiveContainer>
  </CardContent>
</Card>
```

**新代码（Tremor）**：
```tsx
import { TremorAreaChart } from '@/components/charts/tremor-area-chart';

<TremorAreaChart
  title="模型调用趋势"
  data={chartData}
  categories={['calls']}
  colors={['indigo']}
  valueFormatter={(value) => `${value} 次`}
/>
```

**代码量对比**：
- Recharts：~20 行
- Tremor：~5 行

---

### 步骤 4.4：其他 Tremor 图表

**DonutChart（环形图）**：
```tsx
import { DonutChart, Card, Title } from '@tremor/react';

<Card>
  <Title>模型调用分布</Title>
  <DonutChart
    className="mt-6"
    data={modelDistribution}
    category="count"
    index="modelName"
    colors={['indigo', 'cyan', 'amber', 'rose']}
    valueFormatter={(value) => `${value} 次`}
  />
</Card>
```

**BarChart（柱状图）**：
```tsx
import { BarChart } from '@tremor/react';

<BarChart
  data={employeeUsage}
  index="name"
  categories={['calls', 'cost']}
  colors={['indigo', 'cyan']}
  valueFormatter={(value) => `¥${value}`}
  yAxisWidth={48}
/>
```

---

### 验收标准
- [ ] Dashboard 所有图表使用 Tremor 重构
- [ ] 图表交互正常（悬停显示数值）
- [ ] 响应式布局正确
- [ ] 图表加载性能 < 500ms
- [ ] 主题切换时图表颜色自动适配

---

## 📍 P1-5: 表格组件升级（TanStack Table + shadcn/ui）

### 当前状态
项目中多处使用简单的 `<table>` 标签，缺乏排序、分页、筛选功能。

### 改造目标
统一使用 **shadcn/ui Data Table**（基于 TanStack Table v8）。

---

### 步骤 5.1：安装依赖

```bash
pnpm add @tanstack/react-table
npx shadcn@latest add table
```

---

### 步骤 5.2：创建通用 Data Table 组件

**文件路径**：`web/src/components/data-table/data-table.tsx`

```typescript
'use client';

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

export function DataTable<TData, TValue>({
  columns,
  data,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting,
    },
  });

  return (
    <div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  暂无数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
```

---

### 步骤 5.3：使用示例（Subscriptions 订阅列表）

**文件路径**：`web/src/app/(enterprise)/subscriptions/columns.tsx`

```typescript
'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpDown } from 'lucide-react';

export type Subscription = {
  id: string;
  employeeName: string;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  monthCost: number;
  subscribedAt: string;
};

export const columns: ColumnDef<Subscription>[] = [
  {
    accessorKey: 'employeeName',
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        员工名称
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => {
      const status = row.getValue('status') as string;
      return (
        <Badge
          variant={
            status === 'ACTIVE'
              ? 'default'
              : status === 'PAUSED'
                ? 'secondary'
                : 'destructive'
          }
        >
          {status === 'ACTIVE'
            ? '正常'
            : status === 'PAUSED'
              ? '已暂停'
              : '已取消'}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'monthCost',
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        月消费
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const cost = parseFloat(row.getValue('monthCost'));
      return <span className="font-medium">¥{cost.toFixed(2)}</span>;
    },
  },
  {
    accessorKey: 'subscribedAt',
    header: '订阅时间',
    cell: ({ row }) => {
      const date = new Date(row.getValue('subscribedAt'));
      return date.toLocaleDateString('zh-CN');
    },
  },
];
```

**页面使用**：
```tsx
import { DataTable } from '@/components/data-table/data-table';
import { columns } from './columns';

export default function SubscriptionsPage() {
  const subscriptions = [/* ... */];

  return (
    <div className="container mx-auto py-10">
      <DataTable columns={columns} data={subscriptions} />
    </div>
  );
}
```

---

### 验收标准
- [ ] 表格支持排序（点击表头）
- [ ] 表格支持分页（上一页/下一页按钮）
- [ ] 空状态正确显示
- [ ] 表格响应式布局（移动端横向滚动）
- [ ] 行悬停高亮
- [ ] TypeScript 类型安全

---

## 📍 P1-6: 表单组件统一（react-hook-form + shadcn/ui）

### 当前状态
项目中表单使用 `react-hook-form` + 自研表单组件，缺乏统一的错误提示样式。

### 改造目标
统一使用 **shadcn/ui Form**（内置 react-hook-form + zod 校验）。

---

### 步骤 6.1：安装 Form 组件

```bash
npx shadcn@latest add form
```

---

### 步骤 6.2：创建表单示例（创建员工）

**文件路径**：`web/src/features/employee/employee-form.tsx`

```typescript
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const formSchema = z.object({
  name: z.string().min(2, { message: '名称至少 2 个字符' }).max(50),
  description: z.string().optional(),
  position: z.string().min(1, { message: '请填写职位' }),
});

export function EmployeeForm({
  onSubmit,
}: {
  onSubmit: (values: z.infer<typeof formSchema>) => void;
}) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      position: '',
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>员工名称</FormLabel>
              <FormControl>
                <Input placeholder="例如：客服小智" {...field} />
              </FormControl>
              <FormDescription>
                硅基员工的显示名称
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="position"
          render={({ field }) => (
            <FormItem>
              <FormLabel>职位</FormLabel>
              <FormControl>
                <Input placeholder="例如：客服专员" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>简介</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="描述这个员工的主要职责..."
                  className="resize-none"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit">创建员工</Button>
      </form>
    </Form>
  );
}
```

---

### 验收标准
- [ ] 表单校验实时生效（失焦时显示错误）
- [ ] 错误提示样式统一（红色文字 + 图标）
- [ ] 提交前全量校验
- [ ] 表单重置功能正常
- [ ] 无障碍支持（label 关联 input）

---

## 📍 P2-7: Command Palette（全局快捷搜索）

### 改造目标
添加 **Cmd+K / Ctrl+K** 快捷搜索，类似 Algolia DocSearch。

---

### 步骤 7.1：安装 Command 组件

```bash
npx shadcn@latest add command dialog
```

---

### 步骤 7.2：创建 Command Menu

**文件路径**：`web/src/components/command-menu.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { LayoutDashboard, Users, MessageSquare, Settings } from 'lucide-react';

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="搜索页面、功能..." />
      <CommandList>
        <CommandEmpty>未找到相关结果</CommandEmpty>
        <CommandGroup heading="页面">
          <CommandItem
            onSelect={() => runCommand(() => router.push('/dashboard'))}
          >
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>工作台</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push('/my-employees'))}
          >
            <Users className="mr-2 h-4 w-4" />
            <span>硅基员工</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push('/chat'))}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            <span>对话</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push('/settings'))}
          >
            <Settings className="mr-2 h-4 w-4" />
            <span>设置</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```

---

### 步骤 7.3：集成到 Shell

**文件路径**：`web/src/components/shell/enterprise-shell.tsx`

```tsx
import { CommandMenu } from '@/components/command-menu';

export function EnterpriseShell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <CommandMenu />
      {/* ... 其他内容 */}
    </div>
  );
}
```

---

### 验收标准
- [ ] Cmd+K / Ctrl+K 打开搜索
- [ ] ESC 关闭搜索
- [ ] 输入关键词实时筛选
- [ ] 回车跳转到对应页面
- [ ] 键盘上下键选择项目

---

## 📍 P2-9: 通知系统重构（Sonner）

### 改造目标
统一使用 **Sonner**（shadcn/ui 推荐的 Toast 库）。

---

### 步骤 9.1：安装 Sonner

```bash
npx shadcn@latest add sonner
```

---

### 步骤 9.2：集成到 RootLayout

**文件路径**：`web/src/app/layout.tsx`

```tsx
import { Toaster } from '@/components/ui/sonner';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

---

### 步骤 9.3：使用示例

```tsx
import { toast } from 'sonner';

// 成功通知
toast.success('员工创建成功！');

// 错误通知
toast.error('创建失败，请重试');

// 加载状态
const promise = createEmployee(data);
toast.promise(promise, {
  loading: '创建中...',
  success: '创建成功！',
  error: '创建失败',
});

// 带操作按钮的通知
toast('新消息', {
  description: '您有一条新的任务通知',
  action: {
    label: '查看',
    onClick: () => router.push('/tasks'),
  },
});
```

---

### 验收标准
- [ ] 通知显示位置正确（右下角）
- [ ] 支持成功/错误/警告/普通 4 种类型
- [ ] 自动消失（3-5 秒）
- [ ] 可手动关闭
- [ ] 支持富文本和操作按钮

---

## 🧪 测试计划

### 功能测试
- [ ] 所有 shadcn/ui 组件渲染正确
- [ ] Tremor 图表交互正常
- [ ] TanStack Table 排序/分页正常
- [ ] 表单校验逻辑正确
- [ ] Command Menu 快捷键响应
- [ ] Sonner 通知显示正确

### 主题测试
- [ ] Light Theme 所有页面正常
- [ ] Dark Theme 所有页面正常
- [ ] Glass Theme 所有页面正常
- [ ] 主题切换无闪烁
- [ ] 刷新页面主题保持

### 兼容性测试
- [ ] Chrome/Edge/Firefox/Safari 最新版
- [ ] 移动端响应式布局
- [ ] Tailwind JIT 编译正常
- [ ] TypeScript 类型检查通过

### 性能测试
- [ ] Dashboard 加载时间 < 2s
- [ ] 表格渲染 1000 行数据无卡顿
- [ ] 图表动画流畅度 ≥ 60fps
- [ ] Bundle Size 增加 < 50KB（gzip 后）

---

## 📦 交付物清单

### 新增组件
- [ ] `web/src/components/ui/` shadcn/ui 标准组件集（20+ 个）
- [ ] `web/src/components/charts/tremor-*.tsx` Tremor 图表封装（3 个）
- [ ] `web/src/components/data-table/data-table.tsx` 通用表格组件
- [ ] `web/src/components/theme-switcher.tsx` 主题切换器
- [ ] `web/src/components/command-menu.tsx` 全局搜索

### 修改文件
- [ ] `web/tailwind.config.ts` 添加 shadcn/ui 令牌
- [ ] `web/src/app/globals.css` 添加 shadcn/ui CSS 变量
- [ ] `web/src/app/(enterprise)/dashboard/page.tsx` 图表重构
- [ ] `web/src/app/(enterprise)/subscriptions/page.tsx` 表格重构
- [ ] 所有表单页面 `**/form.tsx` 统一使用 shadcn/ui Form

### 删除文件（可选）
- [ ] `web/src/components/ui/legacy/` 旧组件备份目录

### 文档
- [ ] 本开发文档
- [ ] `web/COMPONENT_MIGRATION_GUIDE.md` 组件迁移指南
- [ ] `web/DESIGN_TOKENS.md` 设计令牌说明
- [ ] Storybook stories（可选）

---

## ⏱️ 时间估算

| 阶段 | 任务 | 预估时间 |
|------|------|----------|
| **P0-1** | 全局组件替换 | 8-10h |
| **P0-2** | Design Tokens 桥接 | 3-4h |
| **P0-3** | 主题切换器 | 2-3h |
| **P1-4** | Tremor 图表重构 | 6-8h |
| **P1-5** | TanStack Table 升级 | 6-8h |
| **P1-6** | 表单统一 | 5-6h |
| **P2-7** | Command Palette | 4-5h |
| **P2-9** | Sonner 通知系统 | 2-3h |
| **测试** | 全量测试与调试 | 8-10h |
| **文档** | 组件文档与总结 | 3-4h |
| **总计** | | **47-61h（6-8 工作日）** |

---

## 🚀 实施建议

### 分阶段交付
1. **Week 1 Day 1-2**：P0 基础设施（组件替换 + 主题桥接）
2. **Week 1 Day 3-4**：P1 数据展示（图表 + 表格）
3. **Week 1 Day 5 + Week 2 Day 1**：P1 表单统一
4. **Week 2 Day 2-3**：P2 高级组件（Command + Sonner）
5. **Week 2 Day 4**：全量测试与文档

### 风险控制
- ✅ **组件共存**：shadcn/ui 组件与旧组件共存，逐页替换
- ✅ **类型检查**：每次改动后运行 `pnpm tsc` 确保类型安全
- ✅ **性能监控**：Lighthouse CI + Bundle Analyzer 监控打包体积
- ✅ **回滚方案**：保留 `ui/legacy/` 目录，出问题可快速回退

### 代码审查要点
- [ ] 所有组件是否使用 shadcn/ui 标准 API
- [ ] Design Tokens 是否正确引用 CSS 变量
- [ ] 表单校验是否覆盖所有边界情况
- [ ] 表格是否支持虚拟滚动（大数据量场景）
- [ ] 是否有不必要的客户端组件（能用 RSC 就用 RSC）

---

## 📚 参考资源

### shadcn/ui 官方文档
- 官网：https://ui.shadcn.com/
- GitHub：https://github.com/shadcn-ui/ui
- 组件列表：https://ui.shadcn.com/docs/components/
- 主题配置：https://ui.shadcn.com/docs/theming

### Tremor 官方文档
- 官网：https://www.tremor.so/
- GitHub：https://github.com/tremorlabs/tremor
- 图表示例：https://www.tremor.so/docs/visualizations/area-chart

### TanStack Table 官方文档
- 官网：https://tanstack.com/table/latest
- React Table v8：https://tanstack.com/table/v8/docs/guide/introduction
- shadcn/ui Data Table：https://ui.shadcn.com/docs/components/data-table

### 性能优化指南
- Next.js Bundle Analyzer：https://nextjs.org/docs/app/building-your-application/optimizing/bundle-analyzer
- shadcn/ui 性能优化：https://ui.shadcn.com/docs/dark-mode/next

---

## ✅ 验收标准

### 视觉效果
- [ ] 所有组件符合 shadcn/ui 设计规范
- [ ] 三套主题（Light/Dark/Glass）切换正常
- [ ] 图表颜色与主题一致
- [ ] 间距、圆角、阴影统一

### 功能完整性
- [ ] 所有交互功能正常（点击、悬停、拖拽）
- [ ] 表单校验逻辑完整
- [ ] 表格排序/分页/筛选正常
- [ ] 通知系统支持所有类型
- [ ] Command Menu 快捷键响应

### 性能指标
- [ ] First Contentful Paint < 1.2s
- [ ] Largest Contentful Paint < 2.0s
- [ ] Time to Interactive < 3.0s
- [ ] Cumulative Layout Shift < 0.05
- [ ] Bundle Size 增量 < 50KB（gzip）

### 代码质量
- [ ] TypeScript 类型检查通过
- [ ] ESLint 无错误
- [ ] 所有组件有 JSDoc 注释
- [ ] 测试覆盖率 > 70%

---

## 🎉 预期效果

实施完成后，SEP 前端将呈现：

1. **统一的设计语言**：所有组件遵循 shadcn/ui 标准
2. **强大的数据可视化**：Tremor 图表开箱即用，配置简单
3. **高性能表格**：TanStack Table 支持万行数据流畅渲染
4. **完善的表单体验**：实时校验 + 友好错误提示
5. **Cmd+K 快捷搜索**：类似 VS Code 的全局导航
6. **优雅的通知系统**：Sonner 提供现代化 Toast 体验
7. **三套主题自由切换**：Light（日间办公）/ Dark（夜间办公）/ Glass（演示场景）

---

**文档版本**：v1.0  
**最后更新**：2026-09-21  
**维护者**：Frontend Team