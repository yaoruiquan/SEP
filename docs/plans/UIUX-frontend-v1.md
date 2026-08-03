# 硅基员工平台 UI/UX 设计规范

> **版本**: v1.0  
> **日期**: 2026-07-31  
> **作者**: Claude Code  
> **状态**: 草稿

## 1. 设计理念

### 1.1 核心原则

**参考 Dify 风格**：简洁、现代、专业，重交互体验而非视觉装饰。

**设计目标**：
1. **清晰的信息层级** — 用户能快速找到需要的功能和数据
2. **即时反馈** — 每个操作都有明确的视觉响应
3. **状态可见** — 员工在线状态、任务执行进度随时可见
4. **减少认知负担** — 相似功能用相似的交互模式
5. **容错与可恢复** — 关键操作二次确认，支持撤销

### 1.2 设计语言关键词

- **Professional** 专业 — B2B SaaS，面向企业决策者
- **Efficient** 高效 — 减少点击次数，常用操作一键直达
- **Real-time** 实时 — 动态数据立即呈现，无需刷新
- **Predictable** 可预测 — 交互符合用户预期，无意外行为
- **Accessible** 可访问 — 支持键盘操作，颜色对比度达标

---

## 2. 设计系统基础

### 2.1 色彩系统

#### 主色调（Primary）

**蓝色系** — 科技感、专业、可信赖

```
Primary 50:  #EFF6FF  (浅背景)
Primary 100: #DBEAFE
Primary 200: #BFDBFE
Primary 300: #93C5FD
Primary 400: #60A5FA
Primary 500: #3B82F6  ← 主色
Primary 600: #2563EB
Primary 700: #1D4ED8
Primary 800: #1E40AF
Primary 900: #1E3A8A
```

**使用场景**:
- Primary 500: 主按钮、链接、当前选中状态
- Primary 100: 主按钮 hover 背景、选中项背景
- Primary 700: 主按钮 active 状态

#### 中性色（Neutral）

**灰色系** — 文字、边框、背景

```
Neutral 50:  #FAFAFA  (页面背景)
Neutral 100: #F5F5F5  (卡片背景)
Neutral 200: #E5E5E5  (禁用背景)
Neutral 300: #D4D4D4  (边框)
Neutral 400: #A3A3A3  (占位符文字)
Neutral 500: #737373  (次要文字)
Neutral 600: #525252  (正文)
Neutral 700: #404040
Neutral 800: #262626  (标题)
Neutral 900: #171717  (重点文字)
```

**使用场景**:
- Neutral 50: 页面整体背景
- Neutral 100: 卡片、Modal、侧边栏背景
- Neutral 300: 输入框边框、分割线
- Neutral 600: 正文文字（16px）
- Neutral 800: 标题文字（18px+）

#### 语义色（Semantic）

**成功** (Green):
```
Success 50:  #F0FDF4
Success 500: #22C55E  ← 主色
Success 700: #15803D
```

**警告** (Yellow):
```
Warning 50:  #FEFCE8
Warning 500: #EAB308  ← 主色
Warning 700: #A16207
```

**错误** (Red):
```
Error 50:  #FEF2F2
Error 500: #EF4444  ← 主色
Error 700: #B91C1C
```

**信息** (Blue):
```
Info 50:  #EFF6FF
Info 500: #3B82F6  ← 主色
Info 700: #1D4ED8
```

**使用场景**:
- Success: 已完成状态、通过按钮、成功 Toast
- Warning: 执行中状态、警告提示、预警通知
- Error: 失败状态、拒绝按钮、错误 Toast
- Info: 提示信息、帮助文案

#### 状态色（Status）

**员工在线状态**:
```
Online:  #22C55E (绿色)
Busy:    #EAB308 (黄色)
Offline: #94A3B8 (灰色)
```

**任务执行状态**:
```
执行中: #EAB308 (黄色)
已完成: #22C55E (绿色)
失败:   #EF4444 (红色)
暂停:   #94A3B8 (灰色)
```

**审核状态**:
```
草稿:     #94A3B8 (灰色)
待审核:   #EAB308 (黄色)
已通过:   #22C55E (绿色)
已拒绝:   #EF4444 (红色)
```

#### 能力类型色

```
AGENT:  #3B82F6 (蓝色)
SKILL:  #22C55E (绿色)
RPA:    #F97316 (橙色)
AI_APP: #A855F7 (紫色)
```

---

### 2.2 字体系统

#### 字体族

```css
font-family: 
  -apple-system, 
  BlinkMacSystemFont, 
  "Segoe UI", 
  Roboto, 
  "Helvetica Neue", 
  Arial, 
  "Noto Sans", 
  sans-serif, 
  "Apple Color Emoji", 
  "Segoe UI Emoji", 
  "Segoe UI Symbol", 
  "Noto Color Emoji";
```

**中文优化**（如需支持中文）:
```css
font-family: 
  "PingFang SC", 
  "Microsoft YaHei", 
  -apple-system, 
  BlinkMacSystemFont, 
  ...;
```

#### 字号与行高

| 用途 | 字号 | 行高 | 字重 | 使用场景 |
|------|------|------|------|---------|
| 页面标题 | 24px | 32px | 600 | 页面顶部主标题 |
| 区块标题 | 18px | 28px | 600 | 卡片标题、Tab 标题 |
| 小标题 | 16px | 24px | 500 | 列表项标题、表单 label |
| 正文 | 14px | 22px | 400 | 正文、描述、表格内容 |
| 辅助文字 | 12px | 20px | 400 | 时间戳、提示文字、标签 |
| 标签/徽章 | 12px | 16px | 500 | Badge、Tag |

**字重规范**:
- 400 (Regular): 正文
- 500 (Medium): 强调、按钮
- 600 (Semibold): 标题

---

### 2.3 间距系统

基于 4px 网格，使用 Tailwind 间距比例。

| Token | 值 | 使用场景 |
|-------|-----|---------|
| xs | 4px | 图标与文字间距 |
| sm | 8px | 紧密的元素间距 |
| md | 12px | 默认元素间距 |
| lg | 16px | 区块内边距 |
| xl | 24px | 区块间距 |
| 2xl | 32px | 大区块间距 |
| 3xl | 48px | 页面级间距 |

**组件内边距**:
- Button: padding: 8px 16px (sm lg)
- Input: padding: 8px 12px (sm md)
- Card: padding: 24px (xl)
- Modal: padding: 24px (xl)

**组件间距**:
- 列表项间距: 8px (sm)
- 卡片间距: 16px (lg)
- 区块间距: 24px (xl)

---

### 2.4 圆角系统

| Token | 值 | 使用场景 |
|-------|-----|---------|
| none | 0px | 表格单元格 |
| sm | 4px | Badge、Tag |
| md | 6px | Button、Input、Card |
| lg | 8px | Modal、Drawer |
| xl | 12px | 大卡片 |
| full | 9999px | 圆形头像、状态点 |

---

### 2.5 阴影系统

```css
/* 卡片悬浮 */
shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);

/* 卡片 hover */
shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1),
           0 2px 4px -1px rgba(0, 0, 0, 0.06);

/* Modal、Drawer */
shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1),
           0 4px 6px -2px rgba(0, 0, 0, 0.05);

/* Dropdown */
shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
           0 10px 10px -5px rgba(0, 0, 0, 0.04);
```

---

### 2.6 动画系统

#### 过渡时长

```css
transition-fast:   150ms  (hover, focus)
transition-normal: 200ms  (默认)
transition-slow:   300ms  (页面切换, Modal)
```

#### 缓动函数

```css
ease-out:     cubic-bezier(0, 0, 0.2, 1)    (元素进入)
ease-in:      cubic-bezier(0.4, 0, 1, 1)    (元素退出)
ease-in-out:  cubic-bezier(0.4, 0, 0.2, 1)  (默认)
```

#### 常用动画

**Fade In**:
```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

**Slide In (抽屉)**:
```css
@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
```

**Scale (Modal)**:
```css
@keyframes scaleIn {
  from { transform: scale(0.95); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
```

**Spin (加载)**:
```css
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

---

## 3. 布局与导航规范

### 3.1 全局布局

**结构**:
```
┌────────────────────────────────────────┐
│ 侧边栏 (240px) │ 顶部栏 (56px)       │
│                ├───────────────────────┤
│                │                       │
│                │ 主内容区              │
│                │                       │
│                │                       │
└────────────────┴───────────────────────┘
```

**侧边栏 (Sidebar)**:
- 宽度: 240px（固定）
- 背景: Neutral 100 (#F5F5F5)
- 顶部: Logo + 企业名称（56px 高）
- 中间: 一级导航菜单
- 底部: 用户信息（48px 高）

**顶部栏 (Header)**:
- 高度: 56px（固定）
- 背景: White (#FFFFFF)
- 底边框: 1px Neutral 300
- 左侧: 面包屑导航
- 右侧: 搜索 + 通知 + 用户头像

**主内容区 (Main Content)**:
- 背景: Neutral 50 (#FAFAFA)
- 内边距: 24px
- 最大宽度: 无限制（根据屏幕宽度自适应）
- 最小宽度: 1040px (1280 - 240)

---

### 3.2 侧边栏导航

#### 菜单项设计

**默认状态**:
```css
padding: 12px 16px;
border-radius: 6px;
color: Neutral 700;
font-size: 14px;
font-weight: 500;
```

**Hover 状态**:
```css
background: Neutral 200 (10% opacity);
color: Neutral 900;
cursor: pointer;
```

**选中状态**:
```css
background: Primary 100;
color: Primary 600;
font-weight: 600;
border-left: 3px solid Primary 500;
```

#### 图标规范

- 尺寸: 20×20px
- 颜色: 继承文字颜色
- 位置: 文字左侧，间距 8px
- 来源: Lucide Icons（或 Heroicons）

#### 徽章（Badge）

显示在菜单项右侧，用于未读数量等。

```css
min-width: 20px;
height: 20px;
padding: 0 6px;
border-radius: 10px;
background: Error 500;
color: White;
font-size: 12px;
font-weight: 600;
```

示例: `审核中心 (5)` — 红色圆角徽章显示 "5"

---

### 3.3 面包屑导航

**样式**:
```css
font-size: 14px;
color: Neutral 500;
```

**分隔符**: `/` (Neutral 400)

**当前页**: Neutral 800, font-weight: 500

**示例**:
```
我的员工 / 销售助理小李
       ↑ 可点击链接       ↑ 当前页（不可点击）
```

---

### 3.4 页面标题区

**结构**:
```
┌──────────────────────────────────────┐
│ 页面标题 (24px, 600)       [操作按钮]│
│ 描述文字 (14px, Neutral 600)        │
└──────────────────────────────────────┘
```

**间距**:
- 标题与描述: 4px
- 标题区与内容区: 24px

---

### 3.5 响应式断点

| 断点 | 宽度 | 布局调整 |
|------|------|---------|
| Desktop | ≥ 1280px | 标准布局 |
| Tablet | 768-1279px | 缩小侧边栏至 60px（仅图标） |
| Mobile | < 768px | 不支持（显示提示） |

**本期只支持 Desktop**，断点仅作参考。

---

## 4. 核心组件规范

### 4.1 按钮 (Button)

#### 主按钮 (Primary)

**默认**:
```css
background: Primary 500;
color: White;
padding: 8px 16px;
border-radius: 6px;
font-size: 14px;
font-weight: 500;
border: none;
cursor: pointer;
transition: all 150ms ease-out;
```

**Hover**:
```css
background: Primary 600;
transform: translateY(-1px);
box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
```

**Active**:
```css
background: Primary 700;
transform: translateY(0);
```

**Disabled**:
```css
background: Neutral 200;
color: Neutral 400;
cursor: not-allowed;
opacity: 0.6;
```

#### 次按钮 (Secondary)

**默认**:
```css
background: White;
color: Neutral 700;
border: 1px solid Neutral 300;
```

**Hover**:
```css
background: Neutral 50;
border-color: Neutral 400;
```

#### 危险按钮 (Danger)

用于删除、拒绝等操作。

```css
background: Error 500;
color: White;
```

#### 文字按钮 (Text)

无背景，用于次要操作。

```css
background: transparent;
color: Primary 600;
padding: 4px 8px;
```

**Hover**:
```css
background: Primary 50;
```

#### 图标按钮

**尺寸**: 32×32px  
**图标**: 16×16px  
**圆形**: border-radius: 50%

```css
width: 32px;
height: 32px;
display: flex;
align-items: center;
justify-content: center;
background: transparent;
color: Neutral 600;
border-radius: 50%;
```

**Hover**:
```css
background: Neutral 100;
color: Neutral 900;
```

---

### 4.2 输入框 (Input)

#### 文本输入框

**默认**:
```css
width: 100%;
height: 40px;
padding: 8px 12px;
border: 1px solid Neutral 300;
border-radius: 6px;
font-size: 14px;
color: Neutral 900;
background: White;
transition: border-color 150ms;
```

**Focus**:
```css
border-color: Primary 500;
outline: 2px solid Primary 100;
outline-offset: 0;
```

**Error**:
```css
border-color: Error 500;
```

**Disabled**:
```css
background: Neutral 100;
color: Neutral 400;
cursor: not-allowed;
```

#### 文本域 (Textarea)

同 Input，但 `min-height: 80px`，可调整大小。

#### 搜索框

左侧显示 🔍 图标（Neutral 400），占位符文字示例: "搜索员工名称..."

---

### 4.3 下拉选择 (Select)

**默认样式**: 与 Input 一致

**右侧图标**: ▼ (Chevron Down)

**下拉菜单**:
```css
background: White;
border: 1px solid Neutral 200;
border-radius: 6px;
box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
max-height: 300px;
overflow-y: auto;
```

**选项**:
```css
padding: 8px 12px;
font-size: 14px;
color: Neutral 700;
cursor: pointer;
```

**选项 Hover**:
```css
background: Neutral 50;
```

**选中项**:
```css
background: Primary 50;
color: Primary 700;
font-weight: 500;
```

---

### 4.4 复选框 (Checkbox)

**尺寸**: 16×16px  
**边框**: 1.5px solid Neutral 300  
**圆角**: 3px

**未选中 Hover**:
```css
border-color: Primary 500;
background: Primary 50;
```

**选中**:
```css
background: Primary 500;
border-color: Primary 500;
```

内部显示 ✓ 图标（White）

---

### 4.5 开关 (Switch)

**尺寸**: 宽 40px, 高 22px  
**圆角**: 11px (完全圆角)

**关闭状态**:
```css
background: Neutral 300;
```

**开启状态**:
```css
background: Primary 500;
```

**滑块**: 白色圆形，直径 18px，过渡动画 200ms

---

### 4.6 卡片 (Card)

**默认**:
```css
background: White;
border: 1px solid Neutral 200;
border-radius: 8px;
padding: 24px;
box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
```

**Hover**（可点击卡片）:
```css
box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
border-color: Primary 200;
cursor: pointer;
transform: translateY(-2px);
transition: all 200ms ease-out;
```

**高亮卡片**（新创建）:
```css
border-color: Primary 500;
border-width: 2px;
box-shadow: 0 0 0 3px Primary 100;
```

---

### 4.7 Modal 弹窗

**遮罩**:
```css
background: rgba(0, 0, 0, 0.5);
backdrop-filter: blur(4px);
```

**内容区**:
```css
background: White;
border-radius: 8px;
padding: 24px;
max-width: 600px (默认);
box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
animation: scaleIn 200ms ease-out;
```

**标题**:
```css
font-size: 18px;
font-weight: 600;
color: Neutral 900;
margin-bottom: 16px;
```

**关闭按钮**: 右上角 X 图标按钮（32×32px）

**底部按钮区**:
```css
margin-top: 24px;
display: flex;
justify-content: flex-end;
gap: 12px;
```

---

### 4.8 抽屉 (Drawer)

**宽度**: 600px（默认），可自定义

**动画**: 从右侧滑入，200ms ease-out

**背景**: White

**遮罩**: 同 Modal

**标题栏**:
```css
height: 56px;
padding: 0 24px;
border-bottom: 1px solid Neutral 200;
display: flex;
align-items: center;
justify-content: space-between;
```

**内容区**:
```css
padding: 24px;
overflow-y: auto;
max-height: calc(100vh - 56px);
```

**底部固定操作栏**（可选）:
```css
position: sticky;
bottom: 0;
padding: 16px 24px;
background: White;
border-top: 1px solid Neutral 200;
display: flex;
gap: 12px;
```

---

### 4.9 表格 (Table)

**容器**:
```css
background: White;
border: 1px solid Neutral 200;
border-radius: 8px;
overflow: hidden;
```

**表头**:
```css
background: Neutral 50;
height: 44px;
font-size: 12px;
font-weight: 600;
color: Neutral 600;
text-transform: uppercase;
letter-spacing: 0.05em;
border-bottom: 1px solid Neutral 200;
```

**表格行**:
```css
height: 56px;
font-size: 14px;
color: Neutral 700;
border-bottom: 1px solid Neutral 100;
```

**行 Hover**:
```css
background: Neutral 50;
```

**单元格内边距**: 12px 16px

**可排序列头**:
- 右侧显示 ↕ 图标（Neutral 400）
- Hover 时图标变为 Neutral 600
- 排序后显示 ↑ 或 ↓（Primary 500）

**空状态**: 见 6.1 节

---

### 4.10 标签 (Badge / Tag)

**基础样式**:
```css
display: inline-flex;
align-items: center;
padding: 2px 8px;
border-radius: 4px;
font-size: 12px;
font-weight: 500;
line-height: 16px;
```

**状态标签**（带背景）:
```css
/* 成功 */
background: Success 50;
color: Success 700;

/* 警告 */
background: Warning 50;
color: Warning 700;

/* 错误 */
background: Error 50;
color: Error 700;

/* 中性 */
background: Neutral 100;
color: Neutral 700;
```

**能力类型标签**:
```css
/* AGENT */
background: #EFF6FF;
color: #1D4ED8;

/* SKILL */
background: #F0FDF4;
color: #15803D;

/* RPA */
background: #FFF7ED;
color: #C2410C;

/* AI_APP */
background: #FAF5FF;
color: #7E22CE;
```

---

### 4.11 状态指示器 (Status Dot)

**尺寸**: 8×8px 圆点

**在线** (Online):
```css
background: Success 500;
box-shadow: 0 0 0 2px Success 50;
/* 呼吸动画 */
animation: pulse 2s infinite;
```

**忙碌** (Busy):
```css
background: Warning 500;
box-shadow: 0 0 0 2px Warning 50;
```

**离线** (Offline):
```css
background: Neutral 400;
box-shadow: none;
```

**呼吸动画**:
```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

### 4.12 进度条 (Progress Bar)

**容器**:
```css
width: 100%;
height: 6px;
background: Neutral 200;
border-radius: 3px;
overflow: hidden;
```

**填充**:
```css
height: 100%;
background: Primary 500;
border-radius: 3px;
transition: width 300ms ease-out;
```

**执行中动画**（条纹流动）:
```css
background: linear-gradient(
  90deg,
  Primary 500 0%,
  Primary 400 50%,
  Primary 500 100%
);
background-size: 200% 100%;
animation: shimmer 1.5s infinite;
```

```css
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

---

### 4.13 步骤条 (Steps)

**结构**:
```
●━━━━━●━━━━━○━━━━━○━━━━━○
1     2     3     4     5
基本  运行  知识  模型  权限
```

**已完成步骤**:
```css
/* 圆点 */
width: 24px;
height: 24px;
background: Primary 500;
color: White;
border-radius: 50%;
/* 显示 ✓ 图标 */

/* 连接线 */
height: 2px;
background: Primary 500;
```

**当前步骤**:
```css
width: 24px;
height: 24px;
background: Primary 500;
color: White;
border-radius: 50%;
box-shadow: 0 0 0 4px Primary 100;
/* 显示步骤数字 */
```

**未完成步骤**:
```css
width: 24px;
height: 24px;
background: White;
color: Neutral 400;
border: 2px solid Neutral 300;
border-radius: 50%;

/* 连接线 */
height: 2px;
background: Neutral 200;
```

**步骤标签**:
```css
font-size: 12px;
color: Neutral 600; /* 未完成 */
color: Primary 600; /* 当前 */
font-weight: 500;
margin-top: 8px;
```

---

### 4.14 Toast 提示

**位置**: 右上角，距顶部 24px，距右侧 24px

**容器**:
```css
min-width: 320px;
max-width: 480px;
padding: 12px 16px;
background: White;
border-radius: 8px;
box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
border-left: 4px solid;
display: flex;
align-items: flex-start;
gap: 12px;
animation: slideInRight 200ms ease-out;
```

**类型样式**:
```css
/* 成功 */
border-left-color: Success 500;
/* 图标: ✓ (Success 500) */

/* 错误 */
border-left-color: Error 500;
/* 图标: ✗ (Error 500) */

/* 警告 */
border-left-color: Warning 500;
/* 图标: ⚠ (Warning 500) */

/* 信息 */
border-left-color: Info 500;
/* 图标: ℹ (Info 500) */
```

**自动消失**: 3 秒（错误类型 5 秒）

**关闭按钮**: 右上角 X（16×16px）

**多个 Toast**: 垂直堆叠，间距 12px，最多显示 3 个

---

### 4.15 下拉菜单 (Dropdown Menu)

**触发器**: 通常是图标按钮（⋯）或带 ▼ 的按钮

**菜单容器**:
```css
min-width: 180px;
padding: 4px;
background: White;
border: 1px solid Neutral 200;
border-radius: 6px;
box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
animation: fadeIn 150ms ease-out;
```

**菜单项**:
```css
padding: 8px 12px;
font-size: 14px;
color: Neutral 700;
border-radius: 4px;
cursor: pointer;
display: flex;
align-items: center;
gap: 8px;
```

**菜单项 Hover**:
```css
background: Neutral 100;
```

**危险菜单项**（删除等）:
```css
color: Error 600;
```

**危险菜单项 Hover**:
```css
background: Error 50;
```

**分割线**:
```css
height: 1px;
background: Neutral 200;
margin: 4px 0;
```

---

## 5. 页面 UI 规格

### 5.1 工作台 (Dashboard)

#### 指标卡片

**尺寸**: 自适应宽度（4 列网格，间距 16px），高度 120px

**结构**:
```
┌──────────────────────┐
│ 在线员工        [图标]│  ← 标题 14px Neutral 600
│                      │
│ 12/15                │  ← 数值 32px 600 Neutral 900
│ ↑ 20% 较昨日         │  ← 趋势 12px Success 600
└──────────────────────┘
```

**趋势颜色**:
- 上升 ↑: Success 600（正向指标）或 Error 600（负向指标如失败率）
- 下降 ↓: Error 600（正向指标）或 Success 600（负向指标）
- 持平 →: Neutral 500

**图标**: 右上角 24×24px，颜色 Primary 300

**Hover**: 卡片阴影加深，cursor: pointer

---

#### 图表卡片

**算力消耗趋势图**:
```
┌────────────────────────────────────┐
│ 算力消耗趋势          [7天|30天|90天]│
├────────────────────────────────────┤
│                                    │
│    (recharts LineChart)            │
│    高度: 240px                     │
│                                    │
└────────────────────────────────────┘
```

**图表配置**:
- 线条颜色: Primary 500
- 线条宽度: 2px
- 数据点: 圆形，半径 3px，Hover 时 5px
- 网格线: Neutral 200，虚线
- 坐标轴文字: 12px Neutral 500
- Tooltip: 白色背景，阴影，圆角 6px

**时间范围切换**: 分段控制器（Segmented Control）
```css
background: Neutral 100;
border-radius: 6px;
padding: 2px;

/* 选中项 */
background: White;
box-shadow: 0 1px 2px rgba(0,0,0,0.05);
color: Neutral 900;
font-weight: 500;
```

---

#### 待处理事项列表

**列表项**:
```
┌────────────────────────────────────┐
│ [图标] 3 个跨部门申请待审批    [→] │
│        最早提交于 2 小时前          │
└────────────────────────────────────┘
```

**样式**:
```css
padding: 12px 16px;
border-radius: 6px;
border: 1px solid Neutral 200;
display: flex;
align-items: center;
gap: 12px;
cursor: pointer;
```

**Hover**:
```css
background: Neutral 50;
border-color: Primary 200;
```

**图标背景**（圆形）:
```css
width: 36px;
height: 36px;
border-radius: 50%;
background: Warning 50;  /* 根据类型变化 */
color: Warning 600;
display: flex;
align-items: center;
justify-content: center;
```

---

### 5.2 人才市场 (Market)

#### 市场员工卡片

**尺寸**: 280px × 240px

**结构**:
```
┌────────────────────────┐
│      [头像 80×80]      │  ← 居中，圆形
│                        │
│    销售助理小李         │  ← 18px 600 居中
│  帮您跟进客户，提升转化  │  ← 14px Neutral 600 居中，2行截断
├────────────────────────┤
│ ⭐ 4.8    156 家企业   │  ← 12px Neutral 600
│ [销售] [电商]          │  ← Tag
├────────────────────────┤
│ [查看详情]    [试用]   │  ← 按钮组
└────────────────────────┘
```

**卡片 Hover**:
```css
transform: translateY(-4px);
box-shadow: 0 12px 20px -4px rgba(0, 0, 0, 0.1);
border-color: Primary 300;
```

**官方标识**（如适用）: 右上角显示 ✓ 官方 徽章
```css
position: absolute;
top: 12px;
right: 12px;
background: Primary 500;
color: White;
padding: 2px 8px;
border-radius: 4px;
font-size: 11px;
```

---

#### 分类导航（左侧）

**结构**:
```
📂 全部              128
📂 官方推荐           24
📂 行业分类
   → 科技            32
   → 金融            18
   → 电商            25
📂 岗位分类
   → 客服            20
   → 销售            35
```

**一级分类**:
```css
padding: 10px 12px;
font-size: 14px;
font-weight: 500;
color: Neutral 700;
border-radius: 6px;
cursor: pointer;
display: flex;
justify-content: space-between;
```

**二级分类**:
```css
padding: 8px 12px 8px 32px;
font-size: 14px;
color: Neutral 600;
```

**选中状态**:
```css
background: Primary 50;
color: Primary 700;
font-weight: 500;
```

**数量标记**:
```css
font-size: 12px;
color: Neutral 400;
```

---

### 5.3 员工详情抽屉

**宽度**: 600px

**头部区域**:
```
┌────────────────────────────────────┐
│ [头像 64×64]  销售助理小李      [X]│
│               [销售] [电商] ⭐4.8  │
├────────────────────────────────────┤
│ [简介] [能力] [案例] [评价]        │  ← Tab
└────────────────────────────────────┘
```

**Tab 样式**:
```css
/* 容器 */
border-bottom: 1px solid Neutral 200;
display: flex;
gap: 24px;
padding: 0 24px;

/* Tab 项 */
padding: 12px 0;
font-size: 14px;
font-weight: 500;
color: Neutral 600;
cursor: pointer;
border-bottom: 2px solid transparent;

/* 选中 Tab */
color: Primary 600;
border-bottom-color: Primary 500;
```

**内容分区标题**:
```css
font-size: 16px;
font-weight: 600;
color: Neutral 900;
margin-bottom: 12px;
```

**使用数据展示**:
```
┌──────────┬──────────┬──────────┐
│ 156      │ 2.3K     │ 96.5%    │
│ 服务企业 │ 完成任务 │ 成功率   │
└──────────┴──────────┴──────────┘
```
```css
/* 数值 */
font-size: 24px;
font-weight: 600;
color: Neutral 900;

/* 标签 */
font-size: 12px;
color: Neutral 500;
```

**底部固定按钮**:
```css
position: sticky;
bottom: 0;
padding: 16px 24px;
background: White;
border-top: 1px solid Neutral 200;
display: flex;
gap: 12px;

/* 试用按钮：次按钮，flex: 1 */
/* 招聘按钮：主按钮，flex: 1 */
```

---

### 5.4 招聘入职 Modal

**宽度**: 800px  
**最大高度**: 80vh（内容超出时滚动）

**结构**:
```
┌──────────────────────────────────────┐
│ 招聘员工: 销售助理小李           [X] │  ← 标题栏 56px
├──────────────────────────────────────┤
│  ●━━━━━○━━━━━○━━━━━○━━━━━○          │  ← 步骤条 80px
│  基本   运行   知识   模型   权限    │
├──────────────────────────────────────┤
│                                      │
│  (当前步骤表单内容)                  │  ← 内容区
│                                      │
├──────────────────────────────────────┤
│              [取消] [下一步 →]       │  ← 底部按钮 72px
└──────────────────────────────────────┘
```

**表单字段布局**:
```css
/* 字段容器 */
margin-bottom: 20px;

/* Label */
font-size: 14px;
font-weight: 500;
color: Neutral 700;
margin-bottom: 6px;
display: block;

/* 必填标记 */
color: Error 500;
margin-left: 2px;

/* 帮助文字 */
font-size: 12px;
color: Neutral 500;
margin-top: 4px;

/* 错误提示 */
font-size: 12px;
color: Error 600;
margin-top: 4px;
```

**Radio 选项卡片**（运行环境选择）:
```
┌────────────────────────────────────┐
│ ○ 统一客户端 (推荐)                │
│   适用于大部分场景，无需额外配置    │
└────────────────────────────────────┘
```
```css
padding: 16px;
border: 1px solid Neutral 300;
border-radius: 6px;
cursor: pointer;
margin-bottom: 12px;

/* 选中 */
border-color: Primary 500;
background: Primary 50;
box-shadow: 0 0 0 3px Primary 100;
```

**文件上传区域**:
```css
border: 2px dashed Neutral 300;
border-radius: 8px;
padding: 32px;
text-align: center;
background: Neutral 50;
cursor: pointer;
transition: all 150ms;

/* Hover / 拖拽悬停 */
border-color: Primary 500;
background: Primary 50;
```

**内容**:
```
       [上传图标 32×32]
   点击或拖拽文件到此处上传
支持 PDF / Word / TXT / Markdown，单文件最大 50MB
```

**滑块 (Slider)** 算力预算:
```css
/* 轨道 */
height: 6px;
background: Neutral 200;
border-radius: 3px;

/* 已填充部分 */
background: Primary 500;

/* 滑块手柄 */
width: 20px;
height: 20px;
background: White;
border: 2px solid Primary 500;
border-radius: 50%;
box-shadow: 0 2px 4px rgba(0,0,0,0.1);
cursor: grab;
```

---

### 5.5 我的员工卡片

**尺寸**: 320px × 280px

**结构**:
```
┌──────────────────────────┐
│ ●在线              [⋯]   │  ← 状态 + 更多操作
│                          │
│      [头像 100×100]      │  ← 居中
│                          │
│    销售助理小李          │  ← 16px 600
│    销售部 | #EMP001      │  ← 12px Neutral 500
├──────────────────────────┤
│ 今日任务          15 个  │
│ 本周完成          68 个  │  ← 14px
│ 平均耗时       2.3 分钟  │
├──────────────────────────┤
│  [查看详情]   [⚙ 配置]   │
└──────────────────────────┘
```

**状态指示器**（左上角）:
```css
display: flex;
align-items: center;
gap: 6px;
font-size: 12px;
font-weight: 500;

/* 在线 */
color: Success 600;
/* 忙碌 */
color: Warning 600;
/* 离线 */
color: Neutral 500;
```

**统计数据行**:
```css
display: flex;
justify-content: space-between;
padding: 6px 0;
font-size: 14px;

/* 标签 */
color: Neutral 600;

/* 数值 */
color: Neutral 900;
font-weight: 500;
```

**无权限状态**（灰色卡片）:
```css
opacity: 0.6;
filter: grayscale(0.8);
cursor: not-allowed;

/* 覆盖层提示 */
position: absolute;
inset: 0;
background: rgba(255,255,255,0.7);
display: flex;
align-items: center;
justify-content: center;
```

覆盖层内容: `🔒 需要申请权限` + [申请使用] 按钮

---

### 5.6 任务执行 Trace 面板

**Modal 宽度**: 720px

**结构**:
```
┌──────────────────────────────────────┐
│ 任务执行详情 #244                [X] │
├──────────────────────────────────────┤
│ 执行步骤:                            │
│                                      │
│ ✓ 1. 读取客户资料          0.5s     │
│ ✓ 2. 分析需求场景          1.2s     │
│ ⚡ 3. 生成话术内容                   │
│    ▓▓▓▓▓▓░░░░ 65%                   │
│    ┌────────────────────────────┐   │
│    │ 尊敬的客户，根据您的需求... │   │
│    │ (流式输出，逐 token 显示)   │   │
│    └────────────────────────────┘   │
│ ○ 4. 质量检查                        │
│ ○ 5. 格式化输出                      │
├──────────────────────────────────────┤
│ 算力消耗: 1.8K / 预估 2.5K tokens    │
│           [终止任务]  [查看日志]     │
└──────────────────────────────────────┘
```

**步骤项样式**:

**已完成**:
```css
display: flex;
align-items: center;
gap: 12px;
padding: 10px 0;

/* 图标 ✓ */
width: 20px;
height: 20px;
background: Success 500;
color: White;
border-radius: 50%;

/* 文字 */
color: Neutral 700;
font-size: 14px;

/* 耗时 */
color: Neutral 500;
font-size: 12px;
margin-left: auto;
```

**执行中**:
```css
/* 图标 ⚡ */
background: Warning 500;
animation: pulse 1.5s infinite;

/* 文字 */
color: Neutral 900;
font-weight: 500;
```

**待执行**:
```css
/* 图标 ○ */
background: White;
border: 2px solid Neutral 300;
color: transparent;

/* 文字 */
color: Neutral 400;
```

**流式输出区域**:
```css
margin-top: 8px;
margin-left: 32px;
padding: 12px;
background: Neutral 50;
border-radius: 6px;
border-left: 3px solid Warning 500;
font-family: ui-monospace, monospace;
font-size: 13px;
line-height: 20px;
color: Neutral 700;
max-height: 200px;
overflow-y: auto;
```

**光标动画**（流式输出末尾）:
```css
&::after {
  content: '▊';
  animation: blink 1s step-end infinite;
  color: Warning 500;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
```

---

### 5.7 权限矩阵表格

**结构**:
```
┌──────┬──────┬──────┬──────┬────────────┐
│ 成员 │ 小李 │ 小王 │ 小刘 │ 操作       │
├──────┼──────┼──────┼──────┼────────────┤
│ 张三 │  ☑   │  ☑   │  ☐   │ [编辑详情] │
│ 李四 │  ☑   │  ☐   │  ☑   │ [编辑详情] │
├──────┼──────┼──────┼──────┼────────────┤
│销售部│  ☑   │  ☑   │  ☑   │ [批量设置] │  ← 部门行加粗
└──────┴──────┴──────┴──────┴────────────┘
```

**首列（成员名）**:
```css
position: sticky;
left: 0;
background: White;
font-weight: 500;
border-right: 1px solid Neutral 200;
min-width: 140px;
```

**部门行**:
```css
background: Neutral 50;
font-weight: 600;
```

**Checkbox 单元格**:
```css
text-align: center;
width: 80px;
```

**列头（员工名）**:
```css
writing-mode: horizontal-tb;
text-align: center;
font-size: 12px;
/* 名称过长时截断并显示 tooltip */
max-width: 80px;
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

**横向滚动**（员工较多时）:
```css
overflow-x: auto;
/* 首列固定 */
```

---

### 5.8 审核中心左右分屏

**布局**:
```
┌─────────────────┬────────────────────┐
│ 待审列表 (40%)  │ 审核详情 (60%)     │
│                 │                    │
│ [列表项]        │ (详情内容)         │
│ [列表项] ← 选中 │                    │
│ [列表项]        │                    │
│                 │                    │
│                 │ [通过] [拒绝]      │
└─────────────────┴────────────────────┘
```

**分隔线**:
```css
border-right: 1px solid Neutral 200;
```

**待审列表项**:
```css
padding: 16px;
border-bottom: 1px solid Neutral 100;
cursor: pointer;
transition: background 150ms;
```

**未读标记**:
```css
/* 左侧圆点 */
width: 8px;
height: 8px;
background: Primary 500;
border-radius: 50%;
position: absolute;
left: 8px;
top: 24px;
```

**选中列表项**:
```css
background: Primary 50;
border-left: 3px solid Primary 500;
padding-left: 13px;  /* 16 - 3 */
```

**Hover**:
```css
background: Neutral 50;
```

**列表项内容**:
```
┌────────────────────────────┐
│ ● 销售助理小李             │  ← 14px 500
│   提交人: 运营A            │  ← 12px Neutral 500
│   2 小时前                 │  ← 12px Neutral 400
└────────────────────────────┘
```

**详情区域**:
```css
padding: 24px;
overflow-y: auto;
max-height: calc(100vh - 56px - 72px);  /* 减去顶栏和底部按钮 */
```

**审核检查清单**:
```css
background: Warning 50;
border: 1px solid Warning 200;
border-radius: 6px;
padding: 16px;
margin: 24px 0;
```

内容:
```
⚠️ 审核检查清单
☐ 员工介绍清晰，能力边界明确
☐ 所有绑定能力已审核通过
☐ 输入输出 Schema 合理
☐ 定价合理
☐ 无违规内容
```

**底部操作栏**:
```css
position: sticky;
bottom: 0;
padding: 16px 24px;
background: White;
border-top: 1px solid Neutral 200;
display: flex;
gap: 12px;
justify-content: flex-end;
```

按钮: [拒绝]（危险按钮）[通过]（主按钮）

---

### 5.9 能力绑定拖拽排序

**列表项**:
```
┌──────────────────────────────────────┐
│ ⣿  1. 客户信息查询  [AGENT]          │
│    优先级: 1  |  ●启用                │
│    [配置] [禁用] [移除]              │
└──────────────────────────────────────┘
```

**拖拽手柄** (⣿):
```css
width: 20px;
color: Neutral 400;
cursor: grab;

&:hover {
  color: Neutral 600;
}

&:active {
  cursor: grabbing;
}
```

**拖拽中状态**:
```css
opacity: 0.5;
box-shadow: 0 8px 16px rgba(0,0,0,0.15);
transform: rotate(1deg);
```

**放置位置指示线**:
```css
height: 2px;
background: Primary 500;
margin: 4px 0;
border-radius: 1px;
```

**禁用状态列表项**:
```css
opacity: 0.6;
background: Neutral 50;
```

---

## 6. 交互状态规范

### 6.1 空状态 (Empty State)

**结构**:
```
┌────────────────────────────────────┐
│                                    │
│         [插图 120×120]             │
│                                    │
│      还没有招聘任何员工             │  ← 16px 500 Neutral 700
│  去人才市场看看有哪些合适的员工吧    │  ← 14px Neutral 500
│                                    │
│         [+ 去人才市场]             │  ← 主按钮
│                                    │
└────────────────────────────────────┘
```

**样式**:
```css
display: flex;
flex-direction: column;
align-items: center;
justify-content: center;
padding: 64px 24px;
text-align: center;
```

**各页面空状态文案**:

| 页面 | 主文案 | 副文案 | 操作按钮 |
|------|--------|--------|---------|
| 我的员工 | 还没有招聘任何员工 | 去人才市场看看有哪些合适的员工吧 | [+ 去人才市场] |
| 任务中心 | 还没有任务记录 | 选择一个员工，发起您的第一个任务 | [发起任务] |
| 知识库 | 还没有创建知识库 | 上传企业资料，让硅基员工更了解您的业务 | [+ 创建知识库] |
| 审核中心 | 太好了，没有待审核事项 | 所有提交都已处理完毕 | 无 |
| 搜索无结果 | 没有找到匹配的结果 | 试试其他关键词或调整筛选条件 | [清除筛选] |

---

### 6.2 加载状态 (Loading)

#### 骨架屏 (Skeleton)

**优先使用骨架屏**，而非 Loading Spinner。

**基础样式**:
```css
background: linear-gradient(
  90deg,
  Neutral 200 0%,
  Neutral 100 50%,
  Neutral 200 100%
);
background-size: 200% 100%;
animation: skeleton 1.5s infinite;
border-radius: 4px;
```

```css
@keyframes skeleton {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

**卡片骨架屏**:
```
┌────────────────────────┐
│ ▬▬▬▬             ▬     │  ← 状态行
│                        │
│      ⬤ (圆形)          │  ← 头像
│                        │
│   ▬▬▬▬▬▬▬▬            │  ← 名称
│   ▬▬▬▬▬                │  ← 副标题
├────────────────────────┤
│ ▬▬▬▬        ▬▬▬       │
│ ▬▬▬▬        ▬▬▬       │  ← 统计
├────────────────────────┤
│ ▬▬▬▬▬▬      ▬▬▬▬      │  ← 按钮
└────────────────────────┘
```

**表格骨架屏**: 显示 5 行占位，每个单元格一个骨架块

#### Spinner

用于按钮内、局部小范围加载。

```css
width: 16px;
height: 16px;
border: 2px solid rgba(255,255,255,0.3);
border-top-color: White;
border-radius: 50%;
animation: spin 0.6s linear infinite;
```

**按钮加载状态**:
```
[⟳ 提交中...]
```
- 显示 Spinner + 文字
- 按钮 disabled
- 保持原按钮宽度（避免抖动）

#### 页面切换加载

**顶部进度条**:
```css
position: fixed;
top: 0;
left: 0;
height: 2px;
background: Primary 500;
z-index: 9999;
transition: width 200ms;
```

从 0% 递增到 90%，加载完成后快速到 100% 并淡出。

---

### 6.3 错误状态 (Error)

#### 页面级错误

```
┌────────────────────────────────────┐
│                                    │
│         [错误插图 120×120]         │
│                                    │
│         出错了                     │  ← 18px 600
│  加载数据时遇到问题，请稍后重试     │  ← 14px Neutral 600
│                                    │
│   [刷新页面]  [返回首页]           │
│                                    │
│   ▸ 查看错误详情 (可展开)          │  ← 12px Neutral 500
└────────────────────────────────────┘
```

#### 表单字段错误

```css
/* 输入框 */
border-color: Error 500;

/* 错误提示 */
display: flex;
align-items: center;
gap: 4px;
margin-top: 4px;
font-size: 12px;
color: Error 600;
```

图标: ⚠ (12×12px)

#### 内联错误提示

```css
padding: 12px 16px;
background: Error 50;
border: 1px solid Error 200;
border-radius: 6px;
display: flex;
gap: 12px;
```

内容: `⚠ 图标` + 错误标题（500）+ 错误描述（Neutral 600）

---

### 6.4 确认对话框 (Confirm Dialog)

**用于危险操作**（删除、冻结、拒绝等）。

**结构**:
```
┌──────────────────────────────────┐
│ [⚠] 确认停用该员工？             │  ← 18px 600
│                                  │
│ 停用后，所有成员将无法向该员工    │  ← 14px Neutral 600
│ 发起新任务。已在执行的任务会      │
│ 继续完成。                       │
│                                  │
│ 此操作可以撤销。                 │  ← 12px Neutral 500
│                                  │
│            [取消] [确认停用]     │
└──────────────────────────────────┘
```

**图标样式**（危险操作）:
```css
width: 40px;
height: 40px;
border-radius: 50%;
background: Error 50;
color: Error 600;
display: flex;
align-items: center;
justify-content: center;
margin-bottom: 16px;
```

**需要二次确认的高危操作**（要求输入确认文字）:
```
┌──────────────────────────────────┐
│ [⚠] 确认冻结企业？               │
│                                  │
│ 冻结后企业所有成员将无法使用平台。│
│                                  │
│ 请输入企业名称以确认:            │
│ ┌──────────────────────────────┐│
│ │ 龙道集团                      ││
│ └──────────────────────────────┘│
│                                  │
│            [取消] [确认冻结]     │  ← 输入正确才启用
└──────────────────────────────────┘
```

---

### 6.5 实时更新视觉反馈

#### 数据变化高亮

当 WebSocket 推送新数据时，短暂高亮变化的元素。

```css
@keyframes highlight {
  0% { background: Primary 100; }
  100% { background: transparent; }
}

.data-updated {
  animation: highlight 1s ease-out;
}
```

#### 状态切换过渡

员工状态从"在线"变为"忙碌"时：
```css
transition: background-color 300ms ease-out;
```

状态点使用平滑颜色过渡，而非突变。

#### 新增项动画

新任务出现在列表顶部时：
```css
@keyframes slideInTop {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

#### 连接状态指示

**WebSocket 断开时**，顶部显示提示条：
```css
position: fixed;
top: 0;
width: 100%;
padding: 8px;
background: Warning 500;
color: White;
text-align: center;
font-size: 13px;
z-index: 9998;
```

文案: `⚠ 实时连接已断开，正在重连... (已切换为定时刷新)`

重连成功后，提示条变绿并在 2 秒后消失：
```
✓ 实时连接已恢复
```

---

### 6.6 Hover 与 Focus 状态

#### Hover 规范

| 元素 | Hover 效果 |
|------|-----------|
| 按钮 | 背景加深 + 轻微上移 1px |
| 卡片 | 阴影加深 + 上移 2-4px |
| 表格行 | 背景变为 Neutral 50 |
| 链接 | 下划线 + 颜色加深 |
| 图标按钮 | 圆形背景 Neutral 100 |
| 列表项 | 背景 Neutral 50 |

#### Focus 规范（键盘导航）

**所有可交互元素必须有可见的 focus 状态**：

```css
&:focus-visible {
  outline: 2px solid Primary 500;
  outline-offset: 2px;
}
```

**输入框 focus**:
```css
border-color: Primary 500;
box-shadow: 0 0 0 3px Primary 100;
```

**跳过链接**（可访问性）:
页面顶部提供隐藏的"跳转到主内容"链接，Tab 时显示。

---

### 6.7 Tooltip 提示

**触发**: Hover 后延迟 500ms 显示

**样式**:
```css
padding: 6px 10px;
background: Neutral 800;
color: White;
border-radius: 4px;
font-size: 12px;
line-height: 16px;
max-width: 240px;
box-shadow: 0 4px 6px rgba(0,0,0,0.1);
animation: fadeIn 150ms;
```

**箭头**: 6px 三角形，颜色同背景

**位置**: 优先显示在上方，空间不足时自动调整

**使用场景**:
- 截断文字的完整内容
- 图标按钮的功能说明
- 数据指标的计算方式说明
- 禁用按钮的禁用原因

---

## 7. 图标规范

### 7.1 图标库

**推荐**: [Lucide Icons](https://lucide.dev/)（已在 Shadcn/ui 生态中）

**备选**: Heroicons

### 7.2 尺寸规范

| 尺寸 | 使用场景 |
|------|---------|
| 14px | 行内文字旁的小图标 |
| 16px | 按钮内图标、表格操作图标 |
| 20px | 侧边栏菜单图标 |
| 24px | 卡片标题图标、指标卡片 |
| 32px | 空状态、上传区域 |
| 48px | 页面级插图 |

### 7.3 常用图标映射

| 功能 | 图标名 |
|------|--------|
| 工作台 | LayoutDashboard |
| 人才市场 | Store |
| 我的员工 | Users |
| 任务中心 | ClipboardList |
| 组织管理 | Building2 |
| 权限管理 | ShieldCheck |
| 知识库 | BookOpen |
| 算力账户 | Wallet |
| 数据看板 | BarChart3 |
| 企业管理 | Building |
| 能力管理 | Puzzle |
| 审核中心 | CheckCircle2 |
| 搜索 | Search |
| 筛选 | Filter |
| 更多操作 | MoreHorizontal |
| 编辑 | Pencil |
| 删除 | Trash2 |
| 配置 | Settings |
| 添加 | Plus |
| 关闭 | X |
| 成功 | CheckCircle |
| 错误 | XCircle |
| 警告 | AlertTriangle |
| 信息 | Info |
| 上传 | Upload |
| 下载 | Download |
| 刷新 | RefreshCw |
| 拖拽手柄 | GripVertical |

---

## 8. 无障碍设计 (Accessibility)

### 8.1 键盘导航

**必须支持的键盘操作**:

| 按键 | 行为 |
|------|------|
| Tab | 向前移动焦点 |
| Shift + Tab | 向后移动焦点 |
| Enter | 激活按钮/链接 |
| Space | 勾选 Checkbox / 激活按钮 |
| Esc | 关闭 Modal / Drawer / Dropdown |
| ↑ ↓ | 下拉菜单中移动选项 |
| Home / End | 跳到列表首/尾 |

**焦点陷阱**: Modal / Drawer 打开时，焦点限制在其内部，关闭后返回触发元素。

### 8.2 语义化 HTML

```html
<!-- 使用语义化标签 -->
<nav>侧边栏导航</nav>
<main>主内容区</main>
<aside>侧边信息栏</aside>

<!-- 表格 -->
<table>
  <thead><tr><th scope="col">列名</th></tr></thead>
  <tbody><tr><td>数据</td></tr></tbody>
</table>

<!-- 表单 -->
<label for="name">员工名称</label>
<input id="name" aria-describedby="name-error" aria-invalid="true" />
<span id="name-error">名称不能为空</span>
```

### 8.3 ARIA 属性

| 场景 | ARIA 属性 |
|------|----------|
| 图标按钮 | `aria-label="删除员工"` |
| Modal | `role="dialog" aria-modal="true" aria-labelledby="title"` |
| Tab | `role="tablist"` / `role="tab"` / `aria-selected` |
| 加载中 | `aria-busy="true"` / `aria-live="polite"` |
| 表单错误 | `aria-invalid="true"` / `aria-describedby="error-id"` |
| 实时更新 | `aria-live="polite"` (状态变化) |
| 进度条 | `role="progressbar" aria-valuenow="65"` |
| 折叠面板 | `aria-expanded="true"` |

### 8.4 颜色对比度

**WCAG 2.1 AA 标准**（最低 4.5:1）:

| 组合 | 对比度 | 是否达标 |
|------|--------|---------|
| Neutral 600 on White | 7.0:1 | ✅ |
| Neutral 500 on White | 4.6:1 | ✅ |
| Neutral 400 on White | 2.8:1 | ❌ 仅用于装饰 |
| White on Primary 500 | 4.6:1 | ✅ |
| Primary 600 on Primary 50 | 8.2:1 | ✅ |
| Success 700 on Success 50 | 7.5:1 | ✅ |
| Error 700 on Error 50 | 8.1:1 | ✅ |

**不依赖颜色传达信息**: 状态除颜色外还有图标或文字（如 ✓已完成、⚡执行中）。

---

## 9. 实现建议

### 9.1 技术栈映射

| 设计需求 | 技术方案 |
|---------|---------|
| 设计 Token | Tailwind CSS 配置 (`tailwind.config.ts`) |
| 组件库 | Shadcn/ui（基于 Radix UI） |
| 图标 | lucide-react |
| 图表 | recharts |
| 拖拽 | @dnd-kit/core + @dnd-kit/sortable |
| 动画 | Tailwind CSS + framer-motion（复杂动画） |
| Toast | Shadcn/ui Toast（已实现） |
| 表单 | react-hook-form + zod |
| 骨架屏 | 自定义 Skeleton 组件 |
| 虚拟滚动 | @tanstack/react-virtual |

### 9.2 Tailwind 配置示例

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          // ... 完整色阶
          500: '#3B82F6',
          600: '#2563EB',
        },
        // 状态色
        status: {
          online: '#22C55E',
          busy: '#EAB308',
          offline: '#94A3B8',
        },
        // 能力类型色
        capability: {
          agent: '#3B82F6',
          skill: '#22C55E',
          rpa: '#F97316',
          aiapp: '#A855F7',
        },
      },
      animation: {
        'skeleton': 'skeleton 1.5s infinite',
        'pulse-slow': 'pulse 2s infinite',
        'slide-in-right': 'slideInRight 200ms ease-out',
        'slide-in-top': 'slideInTop 200ms ease-out',
        'highlight': 'highlight 1s ease-out',
      },
      keyframes: {
        skeleton: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        // ... 其他动画
      },
    },
  },
}
```

### 9.3 组件开发优先级

**P0 — 基础组件（已有部分）**:
- [x] Button, Input, Card, Dialog, Badge, Switch, Select, Tabs
- [ ] Skeleton（骨架屏）
- [ ] Drawer（抽屉）
- [ ] Steps（步骤条）
- [ ] Table（表格，含排序）
- [ ] StatusDot（状态指示器）
- [ ] EmptyState（空状态）
- [ ] ConfirmDialog（确认对话框）

**P1 — 业务组件**:
- [ ] EmployeeCard（员工卡片，市场版 + 我的员工版）
- [ ] MetricCard（指标卡片）
- [ ] TraceePanel（任务执行面板）
- [ ] PermissionMatrix（权限矩阵表格）
- [ ] CapabilityBindingList（能力绑定拖拽列表）
- [ ] FileUploadZone（文件上传区域）
- [ ] RecruitmentWizard（招聘向导 Modal）

**P2 — 增强组件**:
- [ ] VirtualTable（虚拟滚动表格）
- [ ] RichTextEditor（富文本编辑器）
- [ ] JsonEditor（JSON 编辑器，带校验）
- [ ] DateRangePicker（日期范围选择器）
- [ ] SegmentedControl（分段控制器）

---

## 10. 设计交付清单

### 10.1 需要设计师提供的资源

- [ ] Logo（SVG，深色/浅色版本）
- [ ] 默认员工头像（至少 10 个不同风格）
- [ ] 空状态插图（5-8 个场景）
- [ ] 错误页面插图（404、500、无权限）
- [ ] 能力类型图标（AGENT / SKILL / RPA / AI_APP）
- [ ] 加载动画（可选，Lottie 格式）

### 10.2 设计规范文件

- [ ] Figma 设计文件（含组件库）
- [ ] 设计 Token 导出（JSON 格式）
- [ ] 交互原型（关键流程：招聘、审核、任务执行）

### 10.3 开发对接

- [ ] Tailwind 配置文件（含完整色板）
- [ ] Shadcn/ui 组件定制清单
- [ ] 动画时长和缓动函数常量文件

---

## 附录 A: 设计检查清单

开发完成后，逐项检查：

### 视觉一致性
- [ ] 所有按钮使用统一的尺寸和圆角
- [ ] 所有卡片使用统一的内边距和阴影
- [ ] 所有文字使用规范中的字号和行高
- [ ] 所有间距符合 4px 网格
- [ ] 所有颜色来自设计 Token（无硬编码色值）

### 交互完整性
- [ ] 所有可点击元素有 hover 状态
- [ ] 所有可交互元素有 focus 状态
- [ ] 所有异步操作有 loading 状态
- [ ] 所有列表有空状态
- [ ] 所有危险操作有确认对话框
- [ ] 所有表单有验证错误提示

### 实时性
- [ ] WebSocket 推送数据有视觉反馈
- [ ] 连接断开有提示并降级到轮询
- [ ] 状态变化有平滑过渡动画

### 无障碍
- [ ] 所有图标按钮有 aria-label
- [ ] 所有表单字段有关联的 label
- [ ] 所有 Modal 有焦点陷阱
- [ ] Tab 键能遍历所有交互元素
- [ ] Esc 键能关闭浮层
- [ ] 颜色对比度达到 4.5:1

### 性能
- [ ] 首屏使用骨架屏，不是白屏
- [ ] 长列表（>1000 条）使用虚拟滚动
- [ ] 图片使用 next/image 优化
- [ ] 动画使用 transform / opacity（GPU 加速）

---

**文档结束**
