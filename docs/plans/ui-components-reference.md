# UI 组件快速参考指南

> 前端 UI/UX 优化后的组件使用指南

---

## 🎨 新增组件

### 1. StatCard - 统计卡片

显示关键指标,支持趋势和图标。

```tsx
import { StatCard } from '@/components/ui/stat-card';
import { Users } from 'lucide-react';

<StatCard
  label="硅基员工"
  value={16}
  icon={Users}
  trend="+12%"
  trendUp={true}
  description="较上月增长"
  onClick={() => router.push('/employees')}
/>
```

### 2. Progress - 进度条

显示进度或完成度。

```tsx
import { Progress } from '@/components/ui/progress';

<Progress value={65} variant="success" showValue />
<Progress value={30} variant="warning" />
<Progress value={85} variant="brand" />
```

### 3. Skeleton - 骨架屏

加载状态占位符。

```tsx
import { Skeleton, TableSkeleton, CardSkeleton } from '@/components/ui/skeleton';

// 自定义骨架屏
<Skeleton className="h-4 w-48" />

// 表格骨架屏
<TableSkeleton rows={5} />

// 卡片骨架屏
<CardSkeleton count={3} />
```

### 4. Tooltip - 工具提示

鼠标悬停显示提示信息。

```tsx
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon">
        <HelpCircle className="h-4 w-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>
      <p>点击查看帮助文档</p>
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

### 5. Tabs - 标签页

切换不同内容区域。

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

<Tabs defaultValue="active">
  <TabsList>
    <TabsTrigger value="active">雇佣列表</TabsTrigger>
    <TabsTrigger value="applications">使用申请</TabsTrigger>
  </TabsList>
  <TabsContent value="active">
    {/* 雇佣列表内容 */}
  </TabsContent>
  <TabsContent value="applications">
    {/* 申请列表内容 */}
  </TabsContent>
</Tabs>
```

### 6. AnimatedCard - 动画卡片

带悬停动画的卡片。

```tsx
import { AnimatedCard } from '@/components/ui/animated-card';
import { CardHeader, CardTitle, CardContent } from '@/components/ui/card';

<AnimatedCard hoverY={-4} hoverScale={1.01}>
  <CardHeader>
    <CardTitle>技能名称</CardTitle>
  </CardHeader>
  <CardContent>
    {/* 内容 */}
  </CardContent>
</AnimatedCard>
```

### 7. PageTransition - 页面过渡

页面切换动画(自动)。

```tsx
// 在 layout.tsx 中使用
import { PageTransition } from '@/components/ui/page-transition';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Navigation />
      <PageTransition>{children}</PageTransition>
    </div>
  );
}
```

### 8. SearchInput - 搜索输入框

带搜索图标的输入框。

```tsx
import { SearchInput } from '@/components/ui/search-input';

<SearchInput
  placeholder="搜索能力名称、说明..."
  className="max-w-md"
  onSearch={(value) => console.log(value)}
/>
```

---

## 🎨 设计令牌使用

### 颜色

```tsx
import { designTokens } from '@/lib/design-tokens';

// 品牌色
bg-brand-500  // 主色 #8B5CF6
bg-brand-600  // 悬停 #7C3AED

// 功能色
bg-success    // #10B981
bg-warning    // #F59E0B
bg-error      // #EF4444
bg-info       // #3B82F6

// 灰阶
text-gray-900 // 主文字
text-gray-600 // 次要文字
text-gray-500 // 辅助文字
```

### 间距

```tsx
// 基于 4px 倍数
gap-2   // 8px
gap-4   // 16px
gap-6   // 24px
p-4     // 16px padding
p-6     // 24px padding
```

### 圆角

```tsx
rounded-md   // 8px
rounded-lg   // 12px
rounded-xl   // 16px
rounded-2xl  // 24px
```

### 阴影

```tsx
shadow-sm    // 轻微阴影 (卡片默认)
shadow-md    // 中等阴影 (卡片 hover)
shadow-lg    // 较强阴影 (下拉菜单)
shadow-xl    // 强阴影 (模态框)
```

---

## 🎯 常见模式

### 统计概览卡片组

```tsx
<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
  <StatCard label="硅基员工" value={16} icon={Users} trend="+12%" trendUp />
  <StatCard label="本月对话" value={36} icon={MessageSquare} />
  <StatCard label="技能数量" value={5} icon={Layers} />
  <StatCard label="本月算力" value="¥2.91" icon={Zap} trend="-8%" />
</div>
```

### 带筛选的列表

```tsx
<div className="space-y-4">
  {/* 筛选栏 */}
  <div className="flex items-center gap-4">
    <SearchInput placeholder="搜索..." className="max-w-md" />
    <Select defaultValue="all">
      <SelectTrigger className="w-[140px]">
        <SelectValue placeholder="状态筛选" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">全部</SelectItem>
        <SelectItem value="active">激活</SelectItem>
      </SelectContent>
    </Select>
  </div>

  {/* 列表内容 */}
  <div className="space-y-2">
    {/* 列表项 */}
  </div>
</div>
```

### 加载状态

```tsx
{isLoading ? (
  <TableSkeleton rows={5} />
) : data.length === 0 ? (
  <EmptyState
    icon={Inbox}
    title="暂无数据"
    description="还没有任何记录"
    action={{
      label: '创建第一条',
      onClick: handleCreate,
    }}
  />
) : (
  <Table>
    {/* 表格内容 */}
  </Table>
)}
```

### 进度可视化

```tsx
<div className="space-y-2">
  <div className="flex items-center justify-between text-sm">
    <span className="text-gray-600">
      {activeUsers} / {totalUsers} 人活跃
    </span>
    <span className="font-medium text-brand-600">
      {activeRate.toFixed(0)}%
    </span>
  </div>
  <Progress value={activeRate} variant="brand" className="h-2" />
  <div className="text-xs text-gray-500">
    近 30 天 · {usageDays} 天使用
  </div>
</div>
```

---

## 📏 布局规范

### 页面结构

```tsx
export default function Page() {
  return (
    <div className="space-y-6">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">页面标题</h1>
          <p className="mt-1 text-sm text-gray-500">页面描述</p>
        </div>
        <Button size="lg">
          <Plus className="mr-2 h-5 w-5" />
          主操作
        </Button>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-4 gap-4">
        {/* StatCard 组件 */}
      </div>

      {/* 主内容区 */}
      <Card>
        <CardHeader>
          <CardTitle>内容标题</CardTitle>
        </CardHeader>
        <CardContent>
          {/* 内容 */}
        </CardContent>
      </Card>
    </div>
  );
}
```

### 卡片间距

```tsx
// 页面级间距
<div className="space-y-6">

// 卡片内间距
<CardContent className="p-6">

// 表单间距
<div className="space-y-4">
```

---

## ♿ 可访问性检查清单

- [ ] 所有按钮有明确的文字或 `aria-label`
- [ ] 图标有 `aria-hidden="true"` 或配套文字
- [ ] 表单控件有关联的 `<label>`
- [ ] 键盘可以导航所有交互元素
- [ ] Focus 状态清晰可见
- [ ] 色彩对比度 ≥ 4.5:1 (正文)
- [ ] 色彩对比度 ≥ 3:1 (大字号/控件)

---

## 🚀 性能优化建议

1. **长列表使用虚拟滚动**
   ```bash
   pnpm add @tanstack/react-virtual
   ```

2. **图片使用 Next.js Image**
   ```tsx
   import Image from 'next/image';
   <Image src="..." alt="..." width={48} height={48} />
   ```

3. **组件懒加载**
   ```tsx
   const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
     loading: () => <Skeleton className="h-96 w-full" />,
   });
   ```

4. **避免过度动画**
   - 移动端降低 blur 半径
   - 长列表避免使用 backdrop-filter
   - 尊重 `prefers-reduced-motion`

---

## 📚 相关文档

- [优化方案原文](./frontend-ui-ux-optimization.md)
- [实施进度报告](./frontend-optimization-progress.md)
- [设计令牌定义](/web/src/lib/design-tokens.ts)
- [Tailwind 配置](/web/tailwind.config.ts)

---

**最后更新**: 2026-09-18
