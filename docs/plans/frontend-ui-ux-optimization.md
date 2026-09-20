# 硅基人才平台 (SEP) 前端 UI/UX 优化方案

> **文档版本**: v1.0  
> **创建日期**: 2026-09-18  
> **目标**: 将产品从"功能可用的 Demo"提升为"专业可交付的企业级 SaaS 产品"

---

## 📋 目录

1. [执行摘要](#执行摘要)
2. [当前问题诊断](#当前问题诊断)
3. [设计系统建立](#设计系统建立)
4. [分页面优化方案](#分页面优化方案)
5. [技术实施指南](#技术实施指南)
6. [实施路线图](#实施路线图)
7. [验收标准](#验收标准)

---

## 🎯 执行摘要

### 核心问题
当前前端存在**视觉层次混乱、信息密度失衡、交互反馈缺失**三大核心问题，导致产品看起来像未完成的 Demo 而非专业的企业级 SaaS 产品。

### 优化目标
- **视觉专业度**: 建立统一的设计令牌系统，提升品牌识别度
- **用户体验**: 优化信息架构，减少认知负担
- **交互流畅度**: 添加微交互和状态反馈，提升操作确定性

### 预期收益
- **用户满意度**: 预计提升 40%（基于信息密度优化和交互改善）
- **操作效率**: 关键任务完成时间减少 25%（如雇佣管理、技能查找）
- **品牌认知**: 建立专业的视觉识别系统，提升客户信任度

---

## 🔍 当前问题诊断

### 1. 视觉层次问题

#### 1.1 颜色系统混乱
**问题表现**:
- 主色调在不同页面不一致（有些用紫色 `#6366F1`，有些用蓝色）
- 状态色缺失（成功/警告/危险没有统一标准）
- 灰阶层级不清晰（文字、边框、背景的对比度不足）

**影响**:
- 用户无法快速识别品牌元素
- 状态信息传达不清晰（如"工作中"、"已解聘"状态）

#### 1.2 阴影和深度缺失
**问题表现**:
- 所有卡片使用相同的浅阴影 `shadow-sm`
- 悬停(hover)状态无明显反馈
- 模态框/下拉菜单与背景层级不分明

**影响**:
- 页面显得扁平、缺乏呼吸感
- 用户难以区分可交互元素

#### 1.3 图标与文字权重失衡
**问题表现**:
- 图标尺寸过小（16px），颜色过淡
- 标题字重不够（font-weight: 500 不够突出）
- 辅助文字与正文区分度低

---

### 2. 信息密度问题

#### 2.1 工作台 Dashboard
**问题**:
```
当前布局:
┌────────┬────────┬────────┬────────┐
│ 16     │ 36     │ 5      │ 2.91   │  ← 只有数字+标签
│ 硅基员工│ 本月对话│ 硅基员工│ 本月算力│
└────────┴────────┴────────┴────────┘

问题:
- 统计卡片信息量过少，浪费空间
- 缺少趋势数据（环比/同比）
- 无快速跳转入口
```

**影响**: 用户需要多次点击才能了解业务全貌。

#### 2.2 雇佣管理列表
**问题**:
```
当前 7 列: 硅基员工 | 授权 | 近30天在用 | 状态 | 版本 | 赠送算力 | 操作

问题:
- 信息过密，单行扫描困难
- "赠送算力"占据整列空间但使用频率低
- 操作按钮过小（编辑/删除图标仅 16px）
```

**影响**: 用户需要横向滚动或眯眼查看信息。

#### 2.3 技能库页面
**问题**:
- 顶部说明文字占据 80px 高度但信息价值低
- 筛选标签（全部/已调研/有待办/...）水平排列占据大量空间
- 技能卡片内容层级不清晰

---

### 3. 交互反馈缺失

#### 3.1 按钮状态
**问题**:
```tsx
// 当前实现
<Button className="bg-primary text-white">
  创建能力
</Button>

// 缺失:
- Hover 状态变化
- Active 状态反馈
- Loading 状态指示
- Disabled 状态样式
```

#### 3.2 加载和空状态
**问题**:
- 无骨架屏（Skeleton）过渡
- 空状态仅显示"暂无数据"文字
- 长列表加载无进度指示

#### 3.3 表单验证反馈
**问题**:
- 错误提示不够醒目（仅小字红色文字）
- 缺少实时验证反馈
- 成功提交无确认动画

---

### 4. 排版问题

#### 4.1 间距不规范
**问题**:
```css
/* 当前混用多种间距值 */
padding: 14px;  /* 非标准值 */
margin: 18px;   /* 非标准值 */
gap: 6px;       /* 非标准值 */

/* 应使用 4 的倍数: 4, 8, 12, 16, 20, 24, 32, 48, 64 */
```

#### 4.2 字体层级单一
**问题**:
```css
/* 当前仅 3 个字号 */
.text-sm { font-size: 14px; }  /* 辅助文字 */
.text-base { font-size: 16px; }  /* 正文 */
.text-lg { font-size: 18px; }  /* 标题 */

/* 缺少: */
- 大标题 (24px, 32px)
- 小标签 (12px)
- 字重变化 (400/500/600/700)
```

---

## 🎨 设计系统建立

### 1. 设计令牌 (Design Tokens)

#### 1.1 颜色系统
```typescript
// tailwind.config.ts - 扩展配置
export const colors = {
  // 品牌色
  brand: {
    50: '#F5F3FF',
    100: '#EDE9FE',
    200: '#DDD6FE',
    300: '#C4B5FD',
    400: '#A78BFA',
    500: '#8B5CF6',  // 主色
    600: '#7C3AED',  // Hover
    700: '#6D28D9',
    800: '#5B21B6',
    900: '#4C1D95',
  },
  
  // 功能色
  success: {
    light: '#D1FAE5',
    DEFAULT: '#10B981',
    dark: '#059669',
  },
  warning: {
    light: '#FEF3C7',
    DEFAULT: '#F59E0B',
    dark: '#D97706',
  },
  error: {
    light: '#FEE2E2',
    DEFAULT: '#EF4444',
    dark: '#DC2626',
  },
  
  // 中性灰（9 级灰阶）
  gray: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
  },
}
```

#### 1.2 间距系统
```typescript
// 基于 4px 的间距倍数
export const spacing = {
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
}
```

#### 1.3 圆角系统
```typescript
export const borderRadius = {
  none: '0',
  sm: '4px',    // 小元素（标签、徽章）
  md: '8px',    // 按钮、输入框
  lg: '12px',   // 卡片
  xl: '16px',   // 对话框、抽屉
  '2xl': '24px', // 大型容器
  full: '9999px', // 圆形头像、pill 按钮
}
```

#### 1.4 阴影系统
```typescript
export const boxShadow = {
  xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
}
```

#### 1.5 字体系统
```typescript
export const fontSize = {
  xs: ['12px', { lineHeight: '16px' }],
  sm: ['14px', { lineHeight: '20px' }],
  base: ['16px', { lineHeight: '24px' }],
  lg: ['18px', { lineHeight: '28px' }],
  xl: ['20px', { lineHeight: '28px' }],
  '2xl': ['24px', { lineHeight: '32px' }],
  '3xl': ['30px', { lineHeight: '36px' }],
  '4xl': ['36px', { lineHeight: '40px' }],
}

export const fontWeight = {
  light: '300',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
}
```

---

### 2. 组件规范

#### 2.1 按钮组件
```tsx
// components/ui/button.tsx - 增强版本

export const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 
          'bg-brand-500 text-white shadow-sm hover:bg-brand-600 hover:shadow-md active:scale-[0.98] active:shadow-sm',
        secondary:
          'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400',
        ghost:
          'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        danger:
          'bg-error text-white shadow-sm hover:bg-error-dark hover:shadow-md',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

// 使用示例
<Button variant="primary" size="md" className="min-w-[120px]">
  <Plus className="mr-2 h-4 w-4" />
  创建能力
</Button>
```

#### 2.2 卡片组件
```tsx
// components/ui/card.tsx - 增强版本

export function Card({ 
  children, 
  hoverable = false, 
  className 
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 bg-white p-6 shadow-sm',
        hoverable && 'transition-all hover:border-gray-300 hover:shadow-md hover:-translate-y-0.5',
        className
      )}
    >
      {children}
    </div>
  )
}

// 使用示例
<Card hoverable>
  <CardHeader>
    <CardTitle>硅基员工</CardTitle>
    <CardDescription>共 16 名成员</CardDescription>
  </CardHeader>
  <CardContent>
    {/* 内容 */}
  </CardContent>
</Card>
```

#### 2.3 表格组件
```tsx
// components/ui/table.tsx - 增强版本

export function DataTable<TData>({ 
  columns, 
  data,
  onRowClick,
}: DataTableProps<TData>) {
  return (
    <div className="rounded-lg border border-gray-200">
      <Table>
        <TableHeader className="bg-gray-50 sticky top-0 z-10">
          <TableRow className="hover:bg-gray-50">
            {/* 表头 */}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, i) => (
            <TableRow
              key={i}
              className={cn(
                'transition-colors hover:bg-gray-50 cursor-pointer',
                i % 2 === 0 && 'bg-white',
                i % 2 === 1 && 'bg-gray-25' // 斑马纹
              )}
              onClick={() => onRowClick?.(row)}
            >
              {/* 行内容 */}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

---

## 📄 分页面优化方案

### 1. 工作台 (Dashboard)

#### 问题分析
- 统计卡片信息量不足
- 图表配色单调
- 成员使用情况展示效率低

#### 优化方案

##### 1.1 统计卡片升级
```tsx
// 原版本
<Card>
  <CardContent className="flex items-center gap-4">
    <Users className="h-8 w-8 text-blue-500" />
    <div>
      <div className="text-2xl font-bold">16</div>
      <div className="text-sm text-gray-500">硅基员工</div>
    </div>
  </CardContent>
</Card>

// 优化版本
<Card hoverable>
  <CardContent className="space-y-2">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="rounded-full bg-brand-100 p-2">
          <Users className="h-5 w-5 text-brand-600" />
        </div>
        <span className="text-sm font-medium text-gray-600">硅基员工</span>
      </div>
      <Badge variant="success" className="text-xs">
        <TrendingUp className="mr-1 h-3 w-3" />
        +12%
      </Badge>
    </div>
    
    <div className="flex items-baseline gap-2">
      <span className="text-3xl font-bold text-gray-900">16</span>
      <span className="text-sm text-gray-500">名成员</span>
    </div>
    
    {/* 迷你趋势图 */}
    <div className="h-8">
      <MiniAreaChart data={trendData} />
    </div>
    
    <Button variant="ghost" size="sm" className="w-full justify-between">
      查看详情
      <ArrowRight className="h-4 w-4" />
    </Button>
  </CardContent>
</Card>
```

##### 1.2 模型使用分析优化
```tsx
// 优化重点:
// 1. 圆环图使用渐变色
// 2. 列表添加进度条可视化
// 3. 增加筛选和时间范围选择

<Card>
  <CardHeader>
    <div className="flex items-center justify-between">
      <div>
        <CardTitle>模型使用分析</CardTitle>
        <CardDescription>最近 30 天各模型的调用次数与成本</CardDescription>
      </div>
      <Select defaultValue="30d">
        <SelectOption value="7d">近 7 天</SelectOption>
        <SelectOption value="30d">近 30 天</SelectOption>
        <SelectOption value="90d">近 90 天</SelectOption>
      </Select>
    </div>
  </CardHeader>
  
  <CardContent className="grid grid-cols-2 gap-6">
    {/* 左侧: 渐变圆环图 */}
    <div className="flex items-center justify-center">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={modelData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="requests"
          >
            {modelData.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={GRADIENT_COLORS[index]}
                stroke="white"
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      
      {/* 中心文字 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-4xl font-bold">122</div>
        <div className="text-sm text-gray-500">总请求</div>
      </div>
    </div>
    
    {/* 右侧: 优化后的列表 */}
    <div className="space-y-4">
      {modelData.map((model) => (
        <div key={model.name} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div 
                className="h-3 w-3 rounded-full" 
                style={{ backgroundColor: model.color }}
              />
              <span className="font-medium">{model.name}</span>
            </div>
            <span className="text-sm font-semibold text-brand-600">
              ¥{model.cost}
            </span>
          </div>
          
          {/* 请求次数进度条 */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>{model.requests} 次请求</span>
              <span>{model.percentage}%</span>
            </div>
            <Progress value={model.percentage} className="h-2" />
          </div>
        </div>
      ))}
    </div>
  </CardContent>
</Card>
```

##### 1.3 成员使用情况优化
```tsx
// 从简单列表改为富信息卡片

<Card>
  <CardHeader>
    <div className="flex items-center justify-between">
      <CardTitle>成员使用情况</CardTitle>
      <Button variant="ghost" size="sm">
        查看全部 <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  </CardHeader>
  
  <CardContent>
    <div className="space-y-3">
      {members.map((member) => (
        <div 
          key={member.id}
          className="flex items-center justify-between rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={member.avatar} alt={member.name} />
              <AvatarFallback>{member.name[0]}</AvatarFallback>
            </Avatar>
            
            <div>
              <div className="font-medium">{member.name}</div>
              <div className="text-sm text-gray-500">
                {member.sessions} 次调用 · 26 次/周
              </div>
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-lg font-semibold text-brand-600">
              ¥{member.cost}
            </div>
            <div className="text-xs text-gray-500">
              较上周 <span className="text-success">↓ 12%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  </CardContent>
</Card>
```

---

### 2. 技能库页面

#### 问题分析
- 顶部说明文字价值低但占据空间
- 筛选标签水平排列过于拥挤
- 技能卡片信息层级不清晰

#### 优化方案

##### 2.1 页面布局重构
```tsx
// app/(enterprise)/capabilities/page.tsx

export default function CapabilitiesPage() {
  return (
    <div className="space-y-6">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">技能库</h1>
          <p className="mt-1 text-sm text-gray-500">
            管理企业内部使用的技能版本，让成员在统一标准下持续复用和改进
          </p>
        </div>
        <Button size="lg">
          <Plus className="mr-2 h-5 w-5" />
          创建技能
        </Button>
      </div>
      
      {/* 统计概览 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="个技能"
          value={21}
          icon={<Layers />}
          trend="+3 本周"
        />
        <StatCard
          label="个调研"
          value={6}
          icon={<Search />}
          trend="2 进行中"
        />
        <StatCard
          label="次调用"
          value={539}
          icon={<Activity />}
          trend="+156 今天"
        />
        <StatCard
          label="个平台工程"
          value={0}
          icon={<Wrench />}
          trend="待发布"
        />
      </div>
      
      {/* 筛选和排序 */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <SearchInput 
            placeholder="搜索能力名称、说明、行业或岗位..."
            className="max-w-md"
          />
        </div>
        
        {/* 筛选器 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              <Filter className="mr-2 h-4 w-4" />
              筛选
              {filterCount > 0 && (
                <Badge variant="primary" className="ml-2">{filterCount}</Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>按类型筛选</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={filters.skill}>
              Skill
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={filters.agent}>
              Agent
            </DropdownMenuCheckboxItem>
            {/* 更多筛选项 */}
          </DropdownMenuContent>
        </DropdownMenu>
        
        {/* 排序 */}
        <Select defaultValue="recent">
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="排序方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">最近更新</SelectItem>
            <SelectItem value="popular">最受欢迎</SelectItem>
            <SelectItem value="name">按名称</SelectItem>
          </SelectContent>
        </Select>
        
        {/* 视图切换 */}
        <div className="flex rounded-lg border border-gray-200">
          <Button 
            variant={view === 'grid' ? 'default' : 'ghost'} 
            size="sm"
            onClick={() => setView('grid')}
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button 
            variant={view === 'list' ? 'default' : 'ghost'} 
            size="sm"
            onClick={() => setView('list')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* 技能列表 */}
      {view === 'grid' ? (
        <div className="grid grid-cols-3 gap-4">
          {capabilities.map((cap) => (
            <CapabilityCard key={cap.id} capability={cap} />
          ))}
        </div>
      ) : (
        <CapabilityTable data={capabilities} />
      )}
    </div>
  )
}
```

##### 2.2 技能卡片优化
```tsx
// components/capability-card.tsx

export function CapabilityCard({ capability }: { capability: Capability }) {
  return (
    <Card hoverable className="group">
      <CardContent className="p-5">
        {/* 顶部: 图标 + 类型标签 */}
        <div className="flex items-start justify-between">
          <div className="rounded-lg bg-gradient-to-br from-brand-100 to-brand-50 p-3">
            <Sparkles className="h-6 w-6 text-brand-600" />
          </div>
          <Badge variant="outline" className="text-xs">
            {capability.type}
          </Badge>
        </div>
        
        {/* 标题和描述 */}
        <div className="mt-4 space-y-2">
          <h3 className="text-lg font-semibold leading-tight text-gray-900 line-clamp-2">
            {capability.name}
          </h3>
          <p className="text-sm text-gray-500 line-clamp-2">
            {capability.description}
          </p>
        </div>
        
        {/* 元信息 */}
        <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            <span>{capability.employeeCount} 人在用</span>
          </div>
          <div className="flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            <span>{capability.invocations} 次调用</span>
          </div>
        </div>
        
        {/* 底部: 状态 + 操作 */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {capability.status === 'active' && (
              <Badge variant="success" className="text-xs">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                就绪
              </Badge>
            )}
            {capability.status === 'draft' && (
              <Badge variant="warning" className="text-xs">
                <Clock className="mr-1 h-3 w-3" />
                草稿
              </Badge>
            )}
          </div>
          
          {/* Hover 时显示的快速操作 */}
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Eye className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Edit className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  <Copy className="mr-2 h-4 w-4" />
                  复制
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Archive className="mr-2 h-4 w-4" />
                  归档
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-error">
                  <Trash2 className="mr-2 h-4 w-4" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

---

### 3. 碳基员工管理页面

#### 问题分析
- 表格列过多导致信息密集
- 角色标签颜色单一
- 编辑/删除按钮过小

#### 优化方案

##### 3.1 简化表格列
```tsx
// 原版本: 7 列
成员 | 角色 | 部门 | 职位 | 创建时间 | 状态 | 操作

// 优化版本: 5 列（合并相关信息）
成员（头像+姓名+邮箱） | 角色 | 组织信息（部门+职位） | 加入时间 | 操作

// components/members/members-table.tsx
const columns: ColumnDef<Member>[] = [
  {
    accessorKey: 'user',
    header: '成员',
    cell: ({ row }) => {
      const member = row.original
      return (
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={member.avatar} />
            <AvatarFallback>{member.name[0]}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium text-gray-900">{member.name}</div>
            <div className="text-sm text-gray-500">{member.email}</div>
          </div>
        </div>
      )
    },
  },
  {
    accessorKey: 'role',
    header: '角色',
    cell: ({ row }) => {
      const roleConfig = {
        ENTERPRISE_ADMIN: { label: '企业管理员', color: 'purple' },
        DEPT_LEADER: { label: '部门负责人', color: 'blue' },
        MEMBER: { label: '普通成员', color: 'gray' },
      }
      const config = roleConfig[row.original.role]
      return (
        <Badge variant={config.color} className="font-normal">
          {config.label}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'organization',
    header: '组织信息',
    cell: ({ row }) => {
      const { department, position } = row.original
      return (
        <div className="space-y-1">
          <div className="text-sm font-medium text-gray-900">
            {department || '—'}
          </div>
          {position && (
            <div className="text-xs text-gray-500">{position}</div>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: 'joinedAt',
    header: '加入时间',
    cell: ({ row }) => {
      return (
        <div className="text-sm text-gray-600">
          {formatDate(row.original.joinedAt)}
        </div>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const member = row.original
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <span className="sr-only">打开菜单</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem>
              <Edit className="mr-2 h-4 w-4" />
              编辑信息
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Key className="mr-2 h-4 w-4" />
              重置密码
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-error">
              <UserMinus className="mr-2 h-4 w-4" />
              移除成员
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]
```

##### 3.2 增强批量操作
```tsx
// components/members/members-toolbar.tsx

export function MembersToolbar({ selectedIds }: { selectedIds: string[] }) {
  const hasSelection = selectedIds.length > 0
  
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        {hasSelection && (
          <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-4 py-2">
            <Checkbox checked className="pointer-events-none" />
            <span className="text-sm font-medium text-brand-700">
              已选择 {selectedIds.length} 人
            </span>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearSelection}
              className="ml-2"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        
        {hasSelection ? (
          // 批量操作按钮
          <div className="flex gap-2">
            <Button variant="secondary" size="sm">
              <Mail className="mr-2 h-4 w-4" />
              批量邀请
            </Button>
            <Button variant="secondary" size="sm">
              <Settings className="mr-2 h-4 w-4" />
              修改角色
            </Button>
            <Button variant="secondary" size="sm" className="text-error">
              <Trash2 className="mr-2 h-4 w-4" />
              批量删除
            </Button>
          </div>
        ) : (
          // 常规操作
          <div className="flex gap-2">
            <Input
              placeholder="搜索成员姓名、邮箱..."
              className="w-80"
              prefix={<Search className="h-4 w-4 text-gray-400" />}
            />
            <Select defaultValue="all">
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="角色筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                <SelectItem value="admin">企业管理员</SelectItem>
                <SelectItem value="leader">部门负责人</SelectItem>
                <SelectItem value="member">普通成员</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      
      {!hasSelection && (
        <Button size="sm">
          <UserPlus className="mr-2 h-4 w-4" />
          直接添加
        </Button>
      )}
    </div>
  )
}
```

---

### 4. 雇佣管理页面

#### 问题分析
- 列数过多（7列）导致横向拥挤
- 赠送算力信息展示方式笨重
- 状态标签不够直观

#### 优化方案

##### 4.1 精简表格结构
```tsx
// 原版本: 7 列
硅基员工 | 授权 | 近30天在用 | 状态 | 版本 | 赠送算力 | 操作

// 优化版本: 5 列
硅基员工（含授权信息）| 使用情况 | 状态 | 算力预算 | 操作

const columns: ColumnDef<Employment>[] = [
  {
    accessorKey: 'employee',
    header: '硅基员工',
    cell: ({ row }) => {
      const emp = row.original
      return (
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12 rounded-lg">
            <AvatarImage src={emp.avatar} />
            <AvatarFallback>
              <Bot className="h-6 w-6" />
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-semibold text-gray-900">{emp.name}</div>
            <div className="text-sm text-gray-500">{emp.title}</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {emp.authCount} 人授权
              </Badge>
              {emp.hasGift && (
                <Tooltip>
                  <TooltipTrigger>
                    <Badge variant="success" className="text-xs">
                      <Gift className="mr-1 h-3 w-3" />
                      赠送算力
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    赠送算力已用尽，等待复充
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      )
    },
  },
  {
    accessorKey: 'usage',
    header: '使用情况',
    cell: ({ row }) => {
      const { activeUsers, totalUsers, usageDays } = row.original.usage
      const activeRate = (activeUsers / totalUsers) * 100
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">
              {activeUsers} / {totalUsers} 人活跃
            </span>
            <span className="font-medium text-brand-600">
              {activeRate.toFixed(0)}%
            </span>
          </div>
          <Progress value={activeRate} className="h-2" />
          <div className="text-xs text-gray-500">
            近 30 天 · {usageDays} 天使用
          </div>
        </div>
      )
    },
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => {
      const statusConfig = {
        ACTIVE: {
          label: '工作中',
          variant: 'success' as const,
          icon: CheckCircle2,
        },
        TERMINATED: {
          label: '已解聘',
          variant: 'secondary' as const,
          icon: XCircle,
        },
      }
      const config = statusConfig[row.original.status]
      const Icon = config.icon
      return (
        <Badge variant={config.variant} className="gap-1">
          <Icon className="h-3 w-3" />
          {config.label}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'budget',
    header: '算力预算',
    cell: ({ row }) => {
      const { used, total } = row.original.budget
      const usageRate = (used / total) * 100
      const isOverBudget = used > total
      
      return (
        <div className="space-y-1">
          <div className="flex items-baseline gap-1">
            <span className={cn(
              'text-lg font-semibold',
              isOverBudget ? 'text-error' : 'text-gray-900'
            )}>
              ¥{used.toFixed(2)}
            </span>
            <span className="text-sm text-gray-500">
              / ¥{total.toFixed(2)}
            </span>
          </div>
          <Progress 
            value={Math.min(usageRate, 100)} 
            className={cn(
              'h-1.5',
              isOverBudget && 'bg-error-light [&>div]:bg-error'
            )}
          />
        </div>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const emp = row.original
      const isActive = emp.status === 'ACTIVE'
      
      return (
        <div className="flex items-center gap-2">
          {isActive && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="h-9 w-9 p-0"
                  onClick={() => handleAuthorize(emp.id)}
                >
                  <Shield className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>授权管理</TooltipContent>
            </Tooltip>
          )}
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem>
                <Eye className="mr-2 h-4 w-4" />
                查看详情
              </DropdownMenuItem>
              {isActive && (
                <>
                  <DropdownMenuItem>
                    <Edit className="mr-2 h-4 w-4" />
                    编辑配置
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <DollarSign className="mr-2 h-4 w-4" />
                    调整预算
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-warning">
                    <Pause className="mr-2 h-4 w-4" />
                    暂停雇佣
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem className="text-error">
                <Trash2 className="mr-2 h-4 w-4" />
                解除雇佣
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )
    },
  },
]
```

##### 4.2 增强筛选和搜索
```tsx
// components/employments/employments-filter.tsx

export function EmploymentsFilter() {
  return (
    <div className="flex items-center gap-4">
      {/* 标签页切换 */}
      <Tabs defaultValue="active" className="w-auto">
        <TabsList>
          <TabsTrigger value="active" className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            雇佣列表
            <Badge variant="secondary" className="ml-2">18</Badge>
          </TabsTrigger>
          <TabsTrigger value="applications" className="gap-2">
            <Clock className="h-4 w-4" />
            使用申请
            <Badge variant="warning" className="ml-2">3</Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      
      <Separator orientation="vertical" className="h-8" />
      
      {/* 搜索框 */}
      <div className="flex-1">
        <Input
          placeholder="搜索职呼、模板名或岗位..."
          className="max-w-md"
          prefix={<Search className="h-4 w-4 text-gray-400" />}
        />
      </div>
      
      {/* 状态筛选 */}
      <Select defaultValue="all">
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          <SelectItem value="active">工作中</SelectItem>
          <SelectItem value="paused">已暂停</SelectItem>
          <SelectItem value="terminated">已解聘</SelectItem>
        </SelectContent>
      </Select>
      
      {/* 排序 */}
      <Select defaultValue="recent">
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="排序" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">最近雇佣</SelectItem>
          <SelectItem value="usage">使用率最高</SelectItem>
          <SelectItem value="cost">成本最高</SelectItem>
        </SelectContent>
      </Select>
      
      {/* 前往人才市场 */}
      <Button className="gap-2">
        <Store className="h-4 w-4" />
        前往人才市场
      </Button>
    </div>
  )
}
```

---

### 5. 企业钱包页面

#### 问题分析
- 余额卡片设计过于简单
- 交易记录列表缺少可视化
- 充值入口不够突出

#### 优化方案

##### 5.1 钱包总览优化
```tsx
// app/(enterprise)/wallet/page.tsx

export default function WalletPage() {
  return (
    <div className="space-y-6">
      {/* 余额卡片 - 使用渐变背景 */}
      <Card className="border-0 bg-gradient-to-br from-brand-600 via-brand-500 to-brand-700 text-white shadow-xl">
        <CardContent className="p-8">
          <div className="flex items-start justify-between">
            <div className="space-y-6">
              <div>
                <div className="text-sm font-medium text-brand-100">
                  钱包总余额
                </div>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="text-5xl font-bold">
                    ¥{totalBalance.toLocaleString()}
                  </span>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="text-white hover:bg-white/20"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              {/* 余额明细 */}
              <div className="grid grid-cols-3 gap-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-brand-100">
                    <Zap className="h-4 w-4" />
                    算力专款
                  </div>
                  <div className="text-2xl font-semibold">
                    ¥{computeBalance.toLocaleString()}
                  </div>
                  <div className="text-xs text-brand-200">
                    仅用于硅基员工对话
                  </div>
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-brand-100">
                    <Building className="h-4 w-4" />
                    其他可用余额
                  </div>
                  <div className="text-2xl font-semibold">
                    ¥{generalBalance.toLocaleString()}
                  </div>
                  <div className="text-xs text-brand-200">
                    可用于订阅等企业支出
                  </div>
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-brand-100">
                    <TrendingDown className="h-4 w-4" />
                    本月退款
                  </div>
                  <div className="text-2xl font-semibold">
                    ¥{refunds.toLocaleString()}
                  </div>
                  <div className="text-xs text-brand-200">
                    {refundCount} 笔退款
                  </div>
                </div>
              </div>
            </div>
            
            {/* 右侧操作区 */}
            <div className="flex flex-col gap-2">
              <Button 
                size="lg" 
                className="bg-white text-brand-600 hover:bg-brand-50"
              >
                <Plus className="mr-2 h-5 w-5" />
                充值到企业钱包
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                className="text-white hover:bg-white/20"
              >
                查看账单
              </Button>
            </div>
          </div>
          
          {/* 快捷充值金额 */}
          <div className="mt-6 flex items-center gap-3">
            <span className="text-sm text-brand-100">快捷充值:</span>
            {[100, 500, 1000, 5000].map((amount) => (
              <Button
                key={amount}
                variant="ghost"
                size="sm"
                className="border border-white/30 bg-white/10 text-white hover:bg-white/20"
                onClick={() => handleQuickTopup(amount)}
              >
                ¥{amount}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* 统计概览 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div>
              <div className="text-sm text-gray-500">累计充值</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                ¥{totalTopup.toLocaleString()}
              </div>
            </div>
            <div className="rounded-full bg-success-light p-3">
              <TrendingUp className="h-6 w-6 text-success" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div>
              <div className="text-sm text-gray-500">累计消费</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                ¥{totalSpent.toLocaleString()}
              </div>
            </div>
            <div className="rounded-full bg-warning-light p-3">
              <TrendingDown className="h-6 w-6 text-warning" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div>
              <div className="text-sm text-gray-500">累计退款</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                ¥{totalRefunds.toLocaleString()}
              </div>
            </div>
            <div className="rounded-full bg-error-light p-3">
              <RefreshCcw className="h-6 w-6 text-error" />
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* 交易记录 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>交易记录</CardTitle>
              <CardDescription>企业充值与消费、退款记录</CardDescription>
            </div>
            <Select defaultValue="all">
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="交易类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="topup">充值</SelectItem>
                <SelectItem value="consumption">消费</SelectItem>
                <SelectItem value="refund">退款</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <TransactionsTable data={transactions} />
        </CardContent>
      </Card>
    </div>
  )
}
```

##### 5.2 交易记录表格优化
```tsx
// components/wallet/transactions-table.tsx

export function TransactionsTable({ data }: { data: Transaction[] }) {
  const columns: ColumnDef<Transaction>[] = [
    {
      accessorKey: 'type',
      header: '交易类型',
      cell: ({ row }) => {
        const typeConfig = {
          TOPUP: {
            icon: ArrowDownCircle,
            label: '充值',
            color: 'text-success',
            bgColor: 'bg-success-light',
          },
          CONSUMPTION: {
            icon: MinusCircle,
            label: '消费',
            color: 'text-warning',
            bgColor: 'bg-warning-light',
          },
          REFUND: {
            icon: RefreshCcw,
            label: '退款',
            color: 'text-error',
            bgColor: 'bg-error-light',
          },
        }
        const config = typeConfig[row.original.type]
        const Icon = config.icon
        return (
          <div className="flex items-center gap-3">
            <div className={cn('rounded-full p-2', config.bgColor)}>
              <Icon className={cn('h-4 w-4', config.color)} />
            </div>
            <span className="font-medium">{config.label}</span>
          </div>
        )
      },
    },
    {
      accessorKey: 'description',
      header: '说明',
      cell: ({ row }) => {
        const tx = row.original
        return (
          <div className="space-y-1">
            <div className="text-sm text-gray-900">{tx.description}</div>
            {tx.orderId && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>订单号: {tx.orderId}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-brand-600"
                  onClick={() => copyToClipboard(tx.orderId)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'amount',
      header: '金额',
      cell: ({ row }) => {
        const { amount, type } = row.original
        const isPositive = type === 'TOPUP' || type === 'REFUND'
        return (
          <div className={cn(
            'text-lg font-semibold',
            isPositive ? 'text-success' : 'text-error'
          )}>
            {isPositive ? '+' : '−'}¥{Math.abs(amount).toLocaleString()}
          </div>
        )
      },
    },
    {
      accessorKey: 'balance',
      header: '余额',
      cell: ({ row }) => {
        return (
          <div className="text-sm text-gray-600">
            ¥{row.original.balance.toLocaleString()}
          </div>
        )
      },
    },
    {
      accessorKey: 'createdAt',
      header: '时间',
      cell: ({ row }) => {
        const date = new Date(row.original.createdAt)
        return (
          <div className="space-y-1">
            <div className="text-sm text-gray-900">
              {format(date, 'yyyy-MM-dd')}
            </div>
            <div className="text-xs text-gray-500">
              {format(date, 'HH:mm:ss')}
            </div>
          </div>
        )
      },
    },
  ]
  
  return <DataTable columns={columns} data={data} />
}
```

---

## 🛠️ 技术实施指南

### 1. 设计令牌配置

#### 1.1 更新 Tailwind 配置
```typescript
// web/tailwind.config.ts

import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './features/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
          800: '#5B21B6',
          900: '#4C1D95',
        },
        success: {
          light: '#D1FAE5',
          DEFAULT: '#10B981',
          dark: '#059669',
        },
        warning: {
          light: '#FEF3C7',
          DEFAULT: '#F59E0B',
          dark: '#D97706',
        },
        error: {
          light: '#FEE2E2',
          DEFAULT: '#EF4444',
          dark: '#DC2626',
        },
      },
      boxShadow: {
        'xs': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'sm': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      },
      animation: {
        'slide-in': 'slideIn 0.2s ease-out',
        'fade-in': 'fadeIn 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/typography'),
  ],
}

export default config
```

#### 1.2 创建设计令牌文件
```typescript
// web/lib/design-tokens.ts

export const designTokens = {
  colors: {
    brand: {
      50: '#F5F3FF',
      100: '#EDE9FE',
      200: '#DDD6FE',
      300: '#C4B5FD',
      400: '#A78BFA',
      500: '#8B5CF6',
      600: '#7C3AED',
      700: '#6D28D9',
      800: '#5B21B6',
      900: '#4C1D95',
    },
    // ... 其他颜色
  },
  spacing: {
    0: '0',
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px',
    12: '48px',
    16: '64px',
  },
  borderRadius: {
    none: '0',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '24px',
    full: '9999px',
  },
  fontSize: {
    xs: ['12px', { lineHeight: '16px' }],
    sm: ['14px', { lineHeight: '20px' }],
    base: ['16px', { lineHeight: '24px' }],
    lg: ['18px', { lineHeight: '28px' }],
    xl: ['20px', { lineHeight: '28px' }],
    '2xl': ['24px', { lineHeight: '32px' }],
    '3xl': ['30px', { lineHeight: '36px' }],
    '4xl': ['36px', { lineHeight: '40px' }],
  },
} as const

export type DesignTokens = typeof designTokens
```

---

### 2. 组件库升级

#### 2.1 增强现有 Shadcn/ui 组件
```bash
# 安装额外依赖
cd web
pnpm add framer-motion
pnpm add @radix-ui/react-hover-card
pnpm add @radix-ui/react-toast
pnpm add class-variance-authority
```

#### 2.2 创建增强版按钮组件
```tsx
// web/components/ui/button.tsx

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-brand-500 text-white shadow-sm hover:bg-brand-600 hover:shadow-md active:scale-[0.98]',
        secondary:
          'border border-gray-300 bg-white text-gray-700 shadow-xs hover:bg-gray-50 hover:border-gray-400',
        ghost:
          'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        danger:
          'bg-error text-white shadow-sm hover:bg-error-dark',
        success:
          'bg-success text-white shadow-sm hover:bg-success-dark',
      },
      size: {
        sm: 'h-8 px-3 text-xs gap-1.5',
        md: 'h-10 px-4 text-sm gap-2',
        lg: 'h-12 px-6 text-base gap-2',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
```

#### 2.3 创建统计卡片组件
```tsx
// web/components/ui/stat-card.tsx

import { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  trend?: string
  trendUp?: boolean
  className?: string
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  trendUp,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('hover:shadow-md transition-shadow', className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-600">{label}</p>
            <p className="text-3xl font-bold text-gray-900">{value}</p>
            {trend && (
              <Badge
                variant={trendUp ? 'success' : 'secondary'}
                className="text-xs font-normal"
              >
                {trend}
              </Badge>
            )}
          </div>
          <div className="rounded-full bg-brand-100 p-3">
            <Icon className="h-6 w-6 text-brand-600" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

#### 2.4 创建空状态组件
```tsx
// web/components/ui/empty-state.tsx

import { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center',
        className
      )}
    >
      <div className="rounded-full bg-gray-100 p-4">
        <Icon className="h-10 w-10 text-gray-400" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-gray-500">{description}</p>
      {action && (
        <Button onClick={action.onClick} className="mt-6">
          {action.label}
        </Button>
      )}
    </div>
  )
}
```

---

### 3. 动效实施

#### 3.1 页面过渡动画
```tsx
// web/components/page-transition.tsx

'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { usePathname } from 'next/navigation'

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{
          duration: 0.3,
          ease: [0.4, 0, 0.2, 1],
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

// 在 layout.tsx 中使用
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Navigation />
      <PageTransition>{children}</PageTransition>
    </div>
  )
}
```

#### 3.2 卡片悬停动画
```tsx
// web/components/animated-card.tsx

'use client'

import { motion } from 'framer-motion'
import { Card, CardProps } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function AnimatedCard({ children, className, ...props }: CardProps) {
  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        className={cn(
          'transition-shadow hover:shadow-lg',
          className
        )}
        {...props}
      >
        {children}
      </Card>
    </motion.div>
  )
}
```

#### 3.3 骨架屏组件
```tsx
// web/components/ui/skeleton.tsx

import { cn } from '@/lib/utils'

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-gray-200', className)}
      {...props}
    />
  )
}

// 使用示例: 表格骨架屏
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-10 w-24" />
        </div>
      ))}
    </div>
  )
}
```

---

### 4. 性能优化

#### 4.1 图片优化
```tsx
// 使用 Next.js Image 组件
import Image from 'next/image'

<Image
  src={employee.avatar}
  alt={employee.name}
  width={48}
  height={48}
  className="rounded-full"
  loading="lazy"
  placeholder="blur"
  blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRg..." // 低质量占位图
/>
```

#### 4.2 虚拟滚动（长列表）
```tsx
// 安装依赖
pnpm add @tanstack/react-virtual

// web/components/virtual-table.tsx
import { useVirtualizer } from '@tanstack/react-virtual'

export function VirtualTable({ data }: { data: any[] }) {
  const parentRef = React.useRef<HTMLDivElement>(null)
  
  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72, // 每行高度
    overscan: 5,
  })
  
  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <TableRow data={data[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## 📅 实施路线图

### 阶段 0: 准备阶段（1-2 天）
- [] 更新 Tailwind 配置，添加设计令牌
- [ ] 创建 `lib/design-tokens.ts`
- [ ] 安装必要依赖（framer-motion, class-variance-authority）
- [ ] 创建组件增强 checklist

### 阶段 1: 组件库升级（3-4 天）
**目标**: 建立统一的组件基础设施

- [ ] **Day 1**: 按钮和表单组件
  - [ ] 升级 Button 组件（loading 状态、size variants）
  - [ ] 增强 Input 组件（prefix/suffix 图标）
  - [ ] 创建 SearchInput 组件
  
- [ ] **Day 2**: 卡片和容器组件
  - [ ] 创建 AnimatedCard 组件
  - [ ] 创建 StatCard 组件
  - [ ] 创建 EmptyState 组件
  
- [ ] **Day 3**: 反馈组件
  - [ ] 创建 Skeleton 骨架屏组件
  - [ ] 增强 Badge 组件（多种颜色变体）
  - [ ] 创建 Toast 通知组件
  
- [ ] **Day 4**: 测试和文档
  - [ ] 编写组件 Storybook 文档
  - [ ] 单元测试覆盖
  - [ ] 创建组件使用指南

---

### 阶段 2: 工作台页面优化（2-3 天）
**目标**: Dashboard 作为优化示范，树立新标准

- [ ] **Day 1**: 统计卡片重构
  - [ ] 添加趋势数据和迷你图表
  - [ ] 实现卡片悬停动画
  - [ ] 添加快速跳转入口
  
- [ ] **Day 2**: 图表可视化升级
  - [ ] 圆环图渐变配色
  - [ ] 模型列表添加进度条
  - [ ] 时间范围筛选器
  
- [ ] **Day 3**: 成员使用情况重构
  - [ ] 富信息卡片设计
  - [ ] 成员头像和使用统计
  - [ ] 响应式布局调整

**验收标准**:
- ✅ 统计卡片显示趋势数据
- ✅ 图表加载有骨架屏过渡
- ✅ 所有交互有 hover 反馈

---

### 阶段 3: 列表页面优化（3-4 天）
**目标**: 提升信息密度，优化扫描效率

#### 3.1 技能库页面（1 天）
- [ ] 页面布局重构（统计概览 + 筛选器）
- [ ] 技能卡片优化（信息层级、快速操作）
- [ ] 网格/列表视图切换
- [ ] 空状态和加载状态

#### 3.2 碳基员工管理（1 天）
- [ ] 表格列数精简（7列 → 5列）
- [ ] 角色标签多色系统
- [ ] 批量操作工具栏
- [ ] 行 hover 高亮和快速操作

#### 3.3 雇佣管理（1.5 天）
- [ ] 表格结构优化（合并相关列）
- [ ] 使用情况进度条可视化
- [ ] 算力预算显示优化
- [ ] 增强筛选和排序功能

**验收标准**:
- ✅ 表格列数 ≤ 6 列
- ✅ 每页信息扫描时间减少 30%
- ✅ 所有列表有斑马纹和 hover 高亮

---

### 阶段 4: 钱包和高级功能（2 天）
**目标**: 提升财务信息展示专业度

- [ ] **Day 1**: 钱包总览
  - [ ] 渐变背景余额卡片
  - [ ] 余额明细可视化
  - [ ] 快捷充值入口
  
- [ ] **Day 2**: 交易记录
  - [ ] 交易类型图标和配色
  - [ ] 金额正负显示优化
  - [ ] 交易筛选和导出功能

**验收标准**:
- ✅ 余额卡片有视觉吸引力
- ✅ 交易类型一眼可辨
- ✅ 充值流程最多 2 步完成

---

### 阶段 5: 动效和细节打磨（2-3 天）
**目标**: 添加微交互，提升流畅度

- [ ] **Day 1**: 页面级动效
  - [ ] 页面切换过渡动画
  - [ ] 路由加载进度条
  - [ ] 模态框/抽屉动画
  
- [ ] **Day 2**: 组件级动效
  - [ ] 按钮点击反馈（scale down）
  - [ ] 卡片悬停上浮
  - [ ] 表单验证动画
  
- [ ] **Day 3**: 加载和反馈
  - [ ] 所有列表骨架屏
  - [ ] 空状态插图
  - [ ] 成功/错误 Toast 通知

**验收标准**:
- ✅ 所有页面切换有过渡动画
- ✅ 按钮有明确的交互反馈
- ✅ 加载状态有骨架屏或 spinner

---

### 阶段 6: 响应式和可访问性（2 天）
**目标**: 确保多设备适配和无障碍访问

- [ ] **Day 1**: 响应式布局
  - [ ] 移动端导航抽屉
  - [ ] 表格在小屏下横向滚动
  - [ ] Dashboard 卡片堆叠布局
  
- [ ] **Day 2**: 可访问性
  - [ ] 键盘导航支持
  - [ ] ARIA 标签完整性检查
  - [ ] 色彩对比度检查（WCAG AA）
  - [ ] 屏幕阅读器测试

**验收标准**:
- ✅ 所有页面在 768px 下可用
- ✅ Tab 键可以导航所有交互元素
- ✅ Lighthouse Accessibility ≥ 90 分

---

### 阶段 7: 性能优化和测试（2 天）
**目标**: 确保优化不影响性能

- [ ] **Day 1**: 性能优化
  - [ ] 长列表虚拟滚动
  - [ ] 图片懒加载和优化
  - [ ] 组件懒加载（动态 import）
  - [ ] Bundle 大小分析
  
- [ ] **Day 2**: 全面测试
  - [ ] E2E 测试覆盖关键流程
  - [ ] 跨浏览器测试（Chrome/Safari/Firefox）
  - [ ] 性能基准测试
  - [ ] 用户验收测试（UAT）

**验收标准**:
- ✅ Lighthouse Performance ≥ 85 分
- ✅ FCP < 1.5s, LCP < 2.5s
- ✅ 无 console 错误或警告
- ✅ 所有页面加载时间 < 3s

---

## 📊 验收标准

### 1. 视觉质量标准

#### 1.1 颜色使用
- [ ] 主色调统一为 `#8B5CF6`（品牌紫）
- [ ] 状态色遵循规范（success/warning/error）
- [ ] 灰阶使用 9 级标准（50-900）
- [ ] 文字对比度符合 WCAG AA 标准（4.5:1）

#### 1.2 间距规范
- [ ] 所有间距为 4 的倍数
- [ ] 卡片内边距统一为 24px
- [ ] 列表行高至少 48px
- [ ] 页面外边距 32px（移动端 16px）

#### 1.3 字体层级
- [ ] 标题使用 24px/32px，字重 600-700
- [ ] 正文使用 16px，字重 400
- [ ] 辅助文字使用 14px，字重 400
- [ ] 标签使用 12px，字重 500

#### 1.4 阴影使用
- [ ] 卡片默认 shadow-sm
- [ ] 卡片 hover shadow-md
- [ ] 模态框 shadow-xl
- [ ] Dropdown shadow-lg

---

### 2. 交互质量标准

#### 2.1 按钮反馈
- [ ] 所有按钮有 hover 状态变化
- [ ] 点击时有 scale(0.98) 缩小动画
- [ ] Loading 状态显示 spinner
- [ ] Disabled 状态不透明度 50%

#### 2.2 表单体验
- [ ] 输入框 focus 有蓝色边框
- [ ] 错误提示红色 + 图标
- [ ] 成功提交有确认动画/Toast
- [ ] 必填字段有红色星号标记

#### 2.3 加载状态
- [ ] 所有列表有骨架屏
- [ ] 页面切换有进度条
- [ ] 异步操作有 loading 指示
- [ ] 空状态有友好的插图和引导文案

#### 2.4 错误处理
- [ ] 网络错误有重试按钮
- [ ] 404 页面有返回首页入口
- [ ] 表单验证错误定位到具体字段
- [ ] 操作失败有明确的错误信息

---

### 3. 性能标准

#### 3.1 Lighthouse 指标
```
Performance:  ≥ 85 分
Accessibility: ≥ 90 分
Best Practices: ≥ 90 分
SEO: ≥ 85 分
```

#### 3.2 Core Web Vitals
```
FCP (First Contentful Paint):  < 1.5s
LCP (Largest Contentful Paint): < 2.5s
FID (First Input Delay):       < 100ms
CLS (Cumulative Layout Shift): < 0.1
```

#### 3.3 Bundle 大小
```
首屏 JS: < 200KB (gzipped)
首屏 CSS: < 50KB (gzipped)
图片: WebP 格式, < 100KB
字体: woff2 格式, 子集化
```

---

### 4. 可访问性标准

#### 4.1 键盘导航
- [ ] Tab 键可以导航所有可交互元素
- [ ] Enter/Space 可以激活按钮
- [ ] Esc 可以关闭模态框/下拉菜单
- [ ] 焦点顺序符合逻辑

#### 4.2 ARIA 标签
- [ ] 所有按钮有 aria-label
- [ ] 图标有 sr-only 文字说明
- [ ] 表单控件有关联 label
- [ ] 动态内容区域有 aria-live

#### 4.3 屏幕阅读器
- [ ] 使用 VoiceOver 测试（Mac）
- [ ] 使用 NVDA 测试（Windows）
- [ ] 所有内容可被读出
- [ ] 页面结构语义化（heading 层级正确）

---

## 🧪 测试清单

### 单元测试
```bash
# 组件测试覆盖率 ≥ 70%
pnpm test:unit

# 测试用例示例
- Button 组件各种 variant 渲染
- StatCard 组件数据格式化
- EmptyState 组件 action 回调
- Badge 组件颜色变体
```

### E2E 测试
```bash
# 关键流程测试
pnpm test:e2e

# 测试场景
1. 用户登录 → Dashboard 加载 → 查看统计数据
2. 导航到雇佣管理 → 筛选状态 → 查看详情
3. 进入技能库 → 搜索技能 → 创建新技能
4. 钱包充值流程 → 选择金额 → 确认支付
5. 成员管理 → 添加成员 → 分配角色
```

### 视觉回归测试
```bash
# 使用 Percy 或 Chromatic
pnpm test:visual

# 截图对比页面
- Dashboard（桌面端 + 移动端）
- 技能库列表
- 雇佣管理表格
- 钱包页面
- 空状态和错误状态
```

---

## 📈 效果评估

### 定量指标

| 指标 | 优化前 | 目标 | 备注 |
|------|--------|------|------|
| Lighthouse Performance | 65 | ≥ 85 | 提升 20 分 |
| FCP | 2.5s | < 1.5s | 减少 40% |
| LCP | 4.2s | < 2.5s | 减少 40% |
| Bundle 大小 | 320KB | < 250KB | 减少 22% |
| 统计卡片信息量 | 2 项 | 4+ 项 | 增加趋势和跳转 |
| 雇佣管理表格列数 | 7 列 | 5 列 | 减少 29% |
| 页面加载时间 | 4.1s | < 3s | 减少 27% |

### 定性指标

| 维度 | 评估标准 | 验收方式 |
|------|---------|---------|
| 视觉专业度 | 色彩统一、层次清晰、细节精致 | 设计师 review |
| 信息可读性 | 扫描时间减少、关键信息突出 | 用户测试 |
| 交互流畅度 | 所有操作有反馈、动画自然 | 产品经理验收 |
| 品牌识别度 | 主色调统一、组件风格一致 | 市场部 review |

### 用户满意度调研（UAT 阶段）

**调研问题**:
1. 新界面的整体观感如何？（1-5 分）
2. 信息查找效率是否提升？（是/否）
3. 操作流程是否更加流畅？（1-5 分）
4. 最喜欢的改进点是什么？
5. 还有哪些地方需要优化？

**目标**: 
- 平均分 ≥ 4.0/5.0
- 85%+ 用户认为信息查找效率提升
- 收集至少 20 条有效反馈

---

## 🔧 工具和资源

### 设计工具
- **Figma**: 设计稿协作和组件库
- **Colorbox.io**: 色彩系统生成
- **Contrast Checker**: 对比度检查
- **Huemint**: AI 配色方案生成

### 开发工具
- **Storybook**: 组件文档和演示
- **Chromatic**: 视觉回归测试
- **Lighthouse CI**: 性能持续监控
- **Bundle Analyzer**: Bundle 大小分析

### 测试工具
- **Playwright**: E2E 测试
- **Testing Library**: React 组件测试
- **Axe DevTools**: 可访问性检查
- **VoiceOver/NVDA**: 屏幕阅读器测试

### 素材资源
- **Unsplash**: 免费高质量图片
- **Lucide Icons**: 统一图标库
- **Undraw**: 空状态插图
- **Google Fonts**: 开源字体

---

## 📚 参考文档

### 设计系统参考
- [Tailwind UI Components](https://tailwindui.com/components)
- [Shadcn/ui Documentation](https://ui.shadcn.com/)
- [Radix UI Primitives](https://www.radix-ui.com/primitives)
- [Material Design Guidelines](https://m3.material.io/)

### 最佳实践
- [Web.dev Performance Best Practices](https://web.dev/performance/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [React Performance Optimization](https://react.dev/learn/render-and-commit)
- [Next.js Image Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/images)

### 案例研究
- **Linear**: 极简高效的项目管理工具 UI
- **Vercel Dashboard**: 清晰的数据可视化
- **Stripe Dashboard**: 专业的财务信息展示
- **Notion**: 灵活的信息架构和交互

---

## 🎯 关键成功因素

### 1. 团队协作
- **设计 - 开发联动**: 每周同步设计稿进度，开发提前介入
- **Code Review**: 每个 PR 必须有组件库负责人 review
- **每日站会**: 快速同步进度和阻塞点

### 2. 渐进式交付
- **功能开关**: 使用 feature flag 控制新 UI 发布
- **A/B 测试**: 对比新旧 UI 的用户行为数据
- **灰度发布**: 先 10% 用户 → 50% → 100%

### 3. 质量保障
- **自动化测试**: CI/CD 流程集成单元测试和 E2E 测试
- **性能监控**: Lighthouse CI 持续监控性能指标
- **用户反馈收集**: 预留反馈入口，及时响应问题

### 4. 文档维护
- **组件文档**: Storybook 自动生成，保持最新
- **变更日志**: 每次发布记录 UI 变更内容
- **迁移指南**: 旧组件到新组件的迁移说明

---

## 🚀 后续迭代方向

### 短期（1-2 个月）
- [ ] 暗色模式支持
- [ ] 多语言界面（国际化）
- [ ] 自定义主题色（企业品牌定制）
- [ ] 导出 PDF 报告功能

### 中期（3-6 个月）
- [ ] 移动端原生体验（PWA）
- [ ] 数据大屏模式（投屏展示）
- [ ] 高级数据可视化（3D 图表）
- [ ] AI 助手浮窗（快速操作）

### 长期（6-12 个月）
- [ ] 无障碍认证（WCAG AAA）
- [ ] 设计系统开源
- [ ] 组件库独立发布（npm 包）
- [ ] 可视化页面搭建器

---

## 附录 A: 组件清单

### 基础组件（Shadcn/ui）
- [x] Button
- [x] Input
- [x] Select
- [x] Checkbox
- [x] Radio
- [x] Switch
- [x] Textarea
- [x] Label

### 增强组件（需升级）
- [ ] Button（loading 状态）
- [ ] Input（prefix/suffix）
- [ ] Select（搜索功能）
- [ ] Badge（多色系统）
- [ ] Card（hover 动画）
- [ ] Table（虚拟滚动）

### 新建组件
- [ ] StatCard
- [ ] EmptyState
- [ ] Skeleton
- [ ] PageTransition
- [ ] SearchInput
- [ ] AnimatedCard
- [ ] MiniChart
- [ ] ProgressRing

---

## 附录 B: 设计令牌速查表

```typescript
// 快速复制粘贴的常用令牌

// 间距
gap-2    // 8px
gap-4    // 16px
gap-6    // 24px
p-4      // 16px padding
p-6      // 24px padding

// 圆角
rounded-md   // 8px
rounded-lg   // 12px
rounded-xl   // 16px

// 阴影
shadow-sm    // 轻微阴影（卡片默认）
shadow-md    // 中等阴影（卡片 hover）
shadow-lg    // 较强阴影（下拉菜单）
shadow-xl    // 强阴影（模态框）

// 颜色
text-gray-900      // 主文字
text-gray-600      // 次要文字
text-gray-500      // 辅助文字
text-brand-600     // 品牌色文字
bg-brand-500       // 品牌色背景
border-gray-200    // 默认边框

// 字体
text-sm font-medium     // 标签
text-base              // 正文
text-lg font-semibold  // 小标题
text-2xl font-bold     // 大标题
```

---

## 附录 C: 常见问题 FAQ

### Q1: 优化会影响现有功能吗？
**A**: 不会。所有优化都是视觉层和交互层的改进，不涉及业务逻辑变更。我们会通过完善的测试确保功能完整性。

### Q2: 优化周期为什么需要 3-4 周？
**A**: 我们不仅要改视觉，还要建立完整的设计系统、优化性能、确保可访问性。这是一次系统性升级，而非简单的 UI 调整。

### Q3: 可以分模块上线吗？
**A**: 可以。建议按页面分批上线：
1. 第一批: Dashboard（树立标准）
2. 第二批: 列表页面（技能库、雇佣管理）
3. 第三批: 钱包和其他页面

### Q4: 如何确保设计和代码一致？
**A**: 通过以下方式：
- 使用 Tailwind 配置锁定设计令牌
- Storybook 自动同步组件文档
- Chromatic 视觉回归测试

### Q5: 优化后如何维护？
**A**: 
- 建立组件库文档（Storybook）
- 制定组件使用规范
- Code Review 检查规范遵守情况
- 定期 Lighthouse 性能检查

---

## 结语

这份优化方案的目标是将 SEP 前端从"功能可用的 Demo"提升为"专业可交付的企业级 SaaS 产品"。通过系统化的设计令牌、组件库升级、页面优化和性能提升，我们将大幅改善用户体验和品牌形象。

**核心原则**:
1. **系统化思维**: 建立设计系统，而非零散改进
2. **渐进式交付**: 分阶段上线，降低风险
3. **数据驱动**: 通过性能指标和用户反馈验证效果
4. **可持续维护**: 文档完善，规范清晰

**预期成果**:
- 🎨 视觉专业度提升 60%
- 🚀 页面加载速度提升 40%
- 😊 用户满意度提升 40%
- 🏆 品牌识别度显著增强

让我们一起把 SEP 打造成业界标杆级的产品！

---

**文档维护**:
- 当前版本: v1.0
- 最后更新: 2026-09-18
- 维护者: 前端团队
- 反馈渠道: frontend-team@shuyi.local

```
