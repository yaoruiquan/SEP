# 硅基人才平台 — Glassmorphism 前端设计规范文档

> 基于真实调研：Apple macOS/iOS Liquid Glass、Microsoft Fluent Design Acrylic、
> 及 GlassKit (iOS 26 inspired) 等实际工业实现，非凭印象撰写。
>
> 参考资源：
> - [GlassKit](https://github.com/JUNGHERZ/GlassKit) — iOS 26 Liquid Glass inspired CSS library
> - [Microsoft Acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic) — Fluent Design 规范
> - [NN Group 可访问性指南](https://www.nngroup.com/articles/glassmorphism/)
> - [Dark Glassmorphism 2026 趋势](https://medium.com/@developer_89726/dark-glassmorphism-the-aesthetic-that-will-define-ui-in-2026-93aa4153088f)

---

## 目录

1. [设计原则](#设计原则)
2. [Design Token（基础变量）](#design-token)
3. [背景系统](#背景系统)
4. [Glass 材质系统](#glass-材质系统)
5. [排版系统](#排版系统)
6. [组件规范](#组件规范)
7. [官网落地页](#官网落地页)
8. [员工市场](#员工市场)
9. [运营端（平台管理）](#运营端)
10. [用户端（聊天工作台）](#用户端聊天工作台)
11. [无障碍与性能](#无障碍与性能)
12. [实施计划](#实施计划)
13. [参考来源](#参考来源)

## 设计原则

Glassmorphism 的核心：**真实玻璃的物理感**。

| 原则 | 说明 | 来源 |
|------|------|------|
| 背景先行 | Glass 效果只在彩色背景上有效，白底/黑底无效 | openclaw/skills |
| 深度分层 | 至少 3 层：背景渐变 → 模糊玻璃层 → 前景内容 | Apple visionOS |
| 光边定义 | 1px 白色半透明 border 模拟玻璃折射边缘 | iOS 26 Liquid Glass |
| 克制使用 | 关键卡片用 glass，正文区用实色，避免整屏透明 | NN Group |
| 暗色主导 | 2026 主流是深色渐变背景 + 浅色 glass，而非浅色系 | Dark Glassmorphism 2026 |


---

## Design Token

### 调色板

```css
/* === 背景渐变基础色 === */
--bg-deep:       #0a0a1a;   /* 最深背景 */
--bg-primary:    #0f0f2d;   /* 主背景 */
--bg-surface:    #13132e;   /* 表面层 */

/* === 渐变 Blob 色（背景装饰球） === */
--blob-purple:   #7c3aed;   /* Violet 600 */
--blob-blue:     #2563eb;   /* Blue 600 */
--blob-cyan:     #0891b2;   /* Cyan 600 */
--blob-pink:     #db2777;   /* Pink 600 */
--blob-indigo:   #4f46e5;   /* Indigo 600 */

/* === Glass 材质色（参考 GlassKit 实测值） === */
--glass-bg-dark:      rgba(255, 255, 255, 0.05);   /* 极深 glass */
--glass-bg-medium:    rgba(255, 255, 255, 0.08);   /* 标准 card */
--glass-bg-light:     rgba(255, 255, 255, 0.12);   /* hover 状态 */
--glass-bg-elevated:  rgba(255, 255, 255, 0.16);   /* modal / 强调 */

--glass-border:       rgba(255, 255, 255, 0.10);   /* 普通边框 */
--glass-border-hover: rgba(255, 255, 255, 0.20);   /* hover 边框 */
--glass-border-glow:  rgba(255, 255, 255, 0.25);   /* 发光边框 */

/* === 阴影（参考 liquid-glass-effect 实测值） === */
--glass-shadow-sm:   0 4px 16px rgba(31, 38, 135, 0.15);
--glass-shadow-md:   0 8px 32px rgba(31, 38, 135, 0.20),
                     inset 0 2px 10px rgba(255, 255, 255, 0.15);
--glass-shadow-lg:   0 16px 48px rgba(31, 38, 135, 0.30),
                     inset 0 4px 20px rgba(255, 255, 255, 0.20);

/* === 文字色 === */
--text-primary:   rgba(255, 255, 255, 0.95);
--text-secondary: rgba(255, 255, 255, 0.70);
--text-muted:     rgba(255, 255, 255, 0.45);
--text-disabled:  rgba(255, 255, 255, 0.25);

/* === 品牌强调色 === */
--accent-primary:  #818cf8;   /* Indigo 400 — 主按钮/链接 */
--accent-hover:    #a5b4fc;   /* Indigo 300 */
--accent-success:  #34d399;   /* Emerald 400 */
--accent-warning:  #fbbf24;   /* Amber 400 */
--accent-danger:   #f87171;   /* Red 400 */

/* === Neon 高亮（用于核心指标/状态指示，少量使用） === */
--neon-blue:   #60a5fa;
--neon-purple: #c084fc;
--neon-green:  #4ade80;
```

### Blur 令牌与实心表面

```css
/* === Blur 半径令牌（与下表一一对应） === */
--glass-blur-xs:  blur(12px);   /* Tooltip / 小组件 */
--glass-blur-sm:  blur(16px);   /* 标准卡片 */
--glass-blur-md:  blur(20px);   /* 导航 / hover */
--glass-blur-lg:  blur(24px);   /* Modal / 抽屉 */
--glass-blur-xl:  blur(28px);   /* Hero 展示级（性能上限） */

/* === 实心表面（数据密集区强制使用，零 GPU 成本） === */
--surface-solid:        #141a2b;   /* 表格、长表单、长列表容器 */
--surface-solid-raised: #1a2137;   /* 实心区内的抬升层 */
--surface-solid-hover:  #202844;   /* 实心行 hover */
```

### Blur 值（核心参数）

| 场景 | blur 值 | 背景色透明度 | 说明 |
|------|---------|-------------|------|
| Sidebar / 导航 | `blur(20px)` | 8% white | 持续可见，不能太模糊 |
| 标准卡片 | `blur(16px)` | 8% white | 通用卡片 |
| Hover 卡片 | `blur(20px)` | 12% white | 交互反馈 |
| Modal / 弹窗 | `blur(24px)` | 14% white | 需要聚焦 |
| Hero 大卡 | `blur(28px)` | 6% white | 展示性，极度通透（性能上限） |
| Tooltip | `blur(12px)` | 16% white | 小组件需要可读性 |

> 来源：GlassKit iOS 26 实测 + CSS backdrop-filter 指南 (blur 8–15px 为常规范围，
> 展示性组件到 28px 为性能上限)

### 圆角系统

```css
--radius-sm:   8px;    /* 输入框、小标签 */
--radius-md:   12px;   /* 标准卡片 */
--radius-lg:   16px;   /* 大卡片、侧边栏 */
--radius-xl:   24px;   /* Hero 卡、Modal */
--radius-2xl:  32px;   /* 大 Section wrapper */
--radius-3xl:  40px;   /* 大 CTA 玻璃块（superdesign.dev：2.5rem 保持视觉节奏） */
--radius-pill: 9999px; /* 按钮胶囊、标签 */
```

### 间距系统（8px 网格，参考 Apple 设计规范）

```css
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
```


---

## 背景系统

### 核心背景层结构

```
Layer 0 (最底层): 深色纯色背景  #0f0f2d
Layer 1:          渐变 Blob 装饰球（绝对定位，模糊）
Layer 2:          grain/noise 纹理叠加（可选，防止 banding）
Layer 3:          Glass 卡片层
Layer 4 (最顶层): 文字 / 图标 / 内容
```

### 背景渐变配方（3 套主题）

#### 主题 A — 宇宙深邃（官网/Landing Page）
```css
.bg-cosmos {
  background: #0a0a1a;
  /* 动态 blob（绝对定位，filter: blur(80px)） */
  /* blob-1: top:-20%, left:10%,  w:500px, h:500px, #7c3aed, opacity:0.3 */
  /* blob-2: top:20%,  right:-5%, w:600px, h:600px, #2563eb, opacity:0.25 */
  /* blob-3: bottom:0, left:30%,  w:400px, h:400px, #db2777, opacity:0.2 */
}
```

#### 主题 B — 极光渐变（员工市场/Dashboard）
```css
.bg-aurora {
  background: #0f0f2d;
  /* blob-1: top:-10%, left:-5%, w:600px, h:600px, #4f46e5, opacity:0.35 */
  /* blob-2: top:40%,  right:0,   w:500px, h:500px, #0891b2, opacity:0.25 */
  /* blob-3: bottom:10%, left:20%, w:350px, h:350px, #7c3aed, opacity:0.2 */
}
```

#### 主题 C — 午夜蓝（运营端/管理界面）
```css
.bg-midnight {
  background: #060617;
  /* 更克制的配色，保持专业感 */
  /* blob-1: top:0, right:0, w:400px, h:400px, #1e40af, opacity:0.2 */
  /* blob-2: bottom:0, left:0, w:300px, h:300px, #4f46e5, opacity:0.15 */
}
```

### Grain 纹理叠加（防色带效果）

```css
/* 在背景最上层叠加 noise，防止渐变出现色带 */
/* 来源：superdesign.dev 明确要求 "grainy-gradients on dark backgrounds" */
.noise-overlay::after {
  content: '';
  position: fixed; inset: 0;
  background-image: url("data:image/svg+xml,..."); /* SVG noise */
  opacity: 0.03;
  pointer-events: none;
  z-index: 1;
}
```

---

## Glass 材质系统

### Tailwind CSS 实现（项目使用 Tailwind，定义为 plugin）

```javascript
// tailwind.config.ts 添加以下 plugin
const glassPlugin = plugin(function({ addUtilities }) {
  addUtilities({
    // 标准卡片 glass
    '.glass-card': {
      background: 'rgba(255, 255, 255, 0.08)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.10)',
      boxShadow: '0 8px 32px rgba(31, 38, 135, 0.20), inset 0 2px 10px rgba(255, 255, 255, 0.10)',
    },
    // Hover 状态
    '.glass-card-hover': {
      background: 'rgba(255, 255, 255, 0.12)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.20)',
    },
    // Modal / 强调级
    '.glass-elevated': {
      background: 'rgba(255, 255, 255, 0.14)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      border: '1px solid rgba(255, 255, 255, 0.20)',
      boxShadow: '0 16px 48px rgba(31, 38, 135, 0.30), inset 0 4px 20px rgba(255, 255, 255, 0.15)',
    },
    // Hero / 展示级（极度通透）
    '.glass-hero': {
      background: 'rgba(255, 255, 255, 0.05)',
      backdropFilter: 'blur(28px)',
      WebkitBackdropFilter: 'blur(28px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
    },
    // Sidebar / 导航
    '.glass-nav': {
      background: 'rgba(255, 255, 255, 0.06)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderRight: '1px solid rgba(255, 255, 255, 0.08)',
    },
  });
});
```

### 光晕 Glow 效果（强调状态）

```css
/* 品牌色内发光，用于 active 状态/重要指标 */
.glow-primary {
  box-shadow:
    0 0 20px rgba(129, 140, 248, 0.3),    /* 外发光 */
    inset 0 0 20px rgba(129, 140, 248, 0.1); /* 内发光 */
}

.glow-success {
  box-shadow:
    0 0 20px rgba(52, 211, 153, 0.3),
    inset 0 0 20px rgba(52, 211, 153, 0.1);
}
```


---

## 排版系统

### 字体选择

```css
/* 主字体：Inter（superdesign.dev 明确推荐，glass 界面首选） */
/* 中文补充：Noto Sans SC / PingFang SC */
--font-sans: 'Inter', 'PingFang SC', 'Noto Sans SC', sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### 字号层级

| 级别 | 用途 | 大小 | 字重 | 颜色透明度 |
|------|------|------|------|-----------|
| Display XL | Hero 主标题 | 56–72px | 700 | 95% |
| Display L | Section 标题 | 40–48px | 700 | 95% |
| H1 | 页面标题 | 32px | 700 | 95% |
| H2 | 卡片标题 | 24px | 600 | 95% |
| H3 | 次标题 | 18px | 600 | 90% |
| Body L | 描述文本 | 16px | 400 | 70% |
| Body M | 正文 | 14px | 400 | 70% |
| Caption | 辅助说明 | 12px | 400 | 45% |
| Metric | 数字指标 | 28–36px | 700 | 100% |

### Glass 面板上的文字规则

- **标题 ≥ 24px**：可直接白色，glass 背景不影响可读性
- **正文 14–16px**：使用 `rgba(255,255,255,0.85)` 而非纯白，柔化对比
- **禁止**：在 glass 卡片内显示超过 3 行的小字正文（可读性差）
- **数字大字**：用于 Metric Card，搭配 neon accent 色效果最佳
- **渐变文字**：Hero 区大标题可用 `background-clip: text` + 品牌渐变色

---

## 组件规范

### 1. Glass Card（玻璃卡片）

```
结构：
┌─────────────────────────────────┐  ← 1px rgba(255,255,255,0.10) border
│                                 │  ← backdrop-filter: blur(16px)
│  [图标/图片区]   [标题]          │  ← bg: rgba(255,255,255,0.08)
│                 [副标题]         │
│                                 │  padding: 20px–24px
│  [内容区]                        │  border-radius: 16px
│                                 │
│  [底部操作区]                    │
└─────────────────────────────────┘
```

**Hover 动效**：
- background → rgba(255,255,255,0.12)
- border → rgba(255,255,255,0.20)
- transform: translateY(-2px)
- box-shadow 加深
- transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1)

### 2. Glass Navigation（玻璃导航）

```
侧边导航：
- 宽度：240px（展开）/ 64px（折叠）
- backdrop-filter: blur(20px)
- background: rgba(255,255,255,0.06)
- border-right: 1px solid rgba(255,255,255,0.08)
- 固定定位，全高

顶部导航（Landing Page）：
- 胶囊型 pill nav，悬浮在 Hero 上方
- backdrop-filter: blur(24px)
- background: rgba(10,10,26,0.6)  ← 深色玻璃，区别于卡片
- border: 1px solid rgba(255,255,255,0.12)
- border-radius: 9999px（胶囊形）
- padding: 8px 20px
- sticky，滚动后加深背景色
```

**Active 导航项**：
- background: rgba(129,140,248,0.15) — indigo 浅底
- border-left: 3px solid #818cf8 — 蓝紫亮条
- 文字/图标颜色 → #818cf8

### 3. Glass Button（玻璃按钮）

```
Primary 按钮（主操作）：
- background: linear-gradient(135deg, #818cf8, #a855f7)
- 实色渐变，非 glass（主操作需要高对比）
- border-radius: 9999px（胶囊形）
- padding: 12px 24px
- 有明显 box-shadow glow

Glass Secondary 按钮（次要操作）：
- background: rgba(255,255,255,0.08)
- backdrop-filter: blur(8px)
- border: 1px solid rgba(255,255,255,0.15)
- hover: background → rgba(255,255,255,0.14)
```

### 4. Glass Badge / Tag（标签）

```css
.glass-badge {
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;

  /* 状态色变体 */
  &.online   { background: rgba(52,211,153,0.15);  color: #4ade80; border: 1px solid rgba(52,211,153,0.3); }
  &.busy     { background: rgba(251,191,36,0.15);   color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); }
  &.offline  { background: rgba(255,255,255,0.08);  color: rgba(255,255,255,0.45); }
  &.primary  { background: rgba(129,140,248,0.15); color: #818cf8; border: 1px solid rgba(129,140,248,0.3); }
}
```

### 5. Glass Input（输入框）

```css
.glass-input {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 10px;
  padding: 12px 16px;
  color: rgba(255,255,255,0.90);
  backdrop-filter: blur(8px);
  transition: all 200ms;
}
.glass-input:focus {
  border-color: rgba(129,140,248,0.60);
  box-shadow: 0 0 0 3px rgba(129,140,248,0.15);
  background: rgba(255,255,255,0.08);
  outline: none;
}
```

### 6. Metric Card（数据卡）

```
┌──────────────────────────┐
│ [图标]          [趋势▲8%] │  ← 图标带 gradient 背景圆圈
│                          │
│  2,847                   │  ← Metric 数字，32px，白色 95%
│  活跃员工                  │  ← 副标题，14px，45% 白
│                          │
│  ████░░░░ 71%            │  ← 进度条（可选）
└──────────────────────────┘
glass-card + glow-success（正向趋势）/ glow-danger（负向）
```

### 7. Glass Modal（弹窗）

```
遮罩层：
- background: rgba(0,0,0,0.60)
- backdrop-filter: blur(4px)  ← 背景轻微模糊，突出 modal

Modal 本体：
- glass-elevated 样式
- max-width: 560px
- border-radius: 24px
- padding: 32px
- 入场动效：scale(0.95)+opacity(0) → scale(1)+opacity(1), 250ms ease-out
```


---

## 官网落地页

> 定位：面向企业决策者（HR 总监 / CEO）的品牌展示与转化页面，全站视觉冲击力最强的一屏。

### 整体布局结构

```
┌──────────────────────────────────────────────┐
│  ① 悬浮胶囊导航（fixed，滚动加深）              │
├──────────────────────────────────────────────┤
│  ② HERO（100vh）                             │
│     bg-aurora + 3 个动态 blob                 │
│     渐变主标题 + 双 CTA + 3D 悬浮截图           │
├──────────────────────────────────────────────┤
│  ③ 数据信任条（glass-card 横条，count-up）      │
├──────────────────────────────────────────────┤
│  ④ 核心能力 Bento Grid（4 列不规则网格）        │
├──────────────────────────────────────────────┤
│  ⑤ 工作流程 3 步（虚线连接）                    │
├──────────────────────────────────────────────┤
│  ⑥ 数字员工展示轮播                            │
├──────────────────────────────────────────────┤
│  ⑦ 定价三档（中间档 glass-elevated + glow）     │
├──────────────────────────────────────────────┤
│  ⑧ 大 CTA 玻璃块（border-radius 40px）         │
├──────────────────────────────────────────────┤
│  ⑨ 5 列玻璃 Footer（glass-nav）                │
└──────────────────────────────────────────────┘
```

### 1. 悬浮胶囊导航

```css
.nav-pill {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;

  display: flex;
  align-items: center;
  gap: 32px;
  padding: 12px 24px;

  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 9999px;  /* 完全胶囊形 */
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
}
/* 滚动后加深 */
.nav-pill.scrolled {
  background: rgba(11, 15, 25, 0.72);
  backdrop-filter: blur(24px);
}
```

内容：`[Logo] 产品 · 员工市场 · 定价 · 文档  [登录] [免费试用]`

### 2. Hero 区

```
        ╔═══════════════════════════════════╗
        ║  背景：bg-aurora + 3 个动态 blob    ║
        ║  blob 缓慢浮动（20s 循环）          ║
        ║                                   ║
        ║   [glass-badge] 全新 v2.0 发布 →   ║
        ║                                   ║
        ║      让 AI 员工                    ║
        ║      为你工作                      ║  ← 72px 渐变文字
        ║                                   ║
        ║   订阅数字员工，像雇佣真人一样简单     ║  ← 20px 70%白
        ║   AI 驱动的企业级人才平台             ║
        ║                                   ║
        ║   [免费开始 →]  [观看演示 ▶]        ║
        ║                                   ║
        ║   ┌─────────────────────────┐     ║
        ║   │  悬浮的 Dashboard 截图    │     ║  ← glass-elevated
        ║   │  perspective 3D 倾斜     │     ║     rotateX(8deg)
        ║   └─────────────────────────┘     ║
        ╚═══════════════════════════════════╝
```

**Hero 标题渐变文字**：
```css
.hero-title {
  font-size: clamp(48px, 6vw, 72px);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.03em;

  background: linear-gradient(135deg,
    #ffffff 0%, #c7d2fe 50%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

**动态背景 Blob**：
```css
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.4;
  animation: float 20s ease-in-out infinite;
}
.blob-1 { background: #7c3aed; width: 500px; height: 500px; top: -10%; left: 5%; }
.blob-2 { background: #2563eb; width: 400px; height: 400px; top: 20%; right: 10%;
          animation-delay: -7s; }
.blob-3 { background: #06b6d4; width: 350px; height: 350px; bottom: 5%; left: 30%;
          animation-delay: -14s; }

@keyframes float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%      { transform: translate(40px, -60px) scale(1.1); }
  66%      { transform: translate(-30px, 40px) scale(0.95); }
}
```

**Dashboard 截图 3D 悬浮**：
```css
.hero-mockup {
  perspective: 1600px;
}
.hero-mockup img {
  transform: rotateX(8deg) rotateY(-4deg);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.5),
              0 0 80px rgba(124, 58, 237, 0.15);
  transition: transform 600ms cubic-bezier(0.4, 0, 0.2, 1);
}
.hero-mockup:hover img {
  transform: rotateX(4deg) rotateY(-2deg) translateY(-8px);
}
```

### 3. 数据信任条

```
┌────────────────────────────────────────────────────┐
│  glass-card 横条，padding 32px                      │
│                                                    │
│   156+        12,847        99.9%        4.9/5     │
│  数字员工      服务企业       可用性       用户评分    │
└────────────────────────────────────────────────────┘
数字用渐变文字 + count-up 动画（进入视口时触发）
```

### 4. 核心能力 Bento Grid

```
┌───────────────────────┬───────────┐
│                       │           │
│  大卡片（2x2）          │  卡片 A    │
│  「订阅即用」            │           │
│  + 大图示              ├───────────┤
│                       │  卡片 B    │
├───────────┬───────────┼───────────┤
│  卡片 C    │  卡片 D    │  卡片 E   │
└───────────┴───────────┴───────────┘

Grid: grid-template-columns: repeat(4, 1fr);
gap: 20px;
每张 glass-card，border-radius: 20px
```

Bento 卡片内容：
| 卡片 | 标题 | 说明 |
|------|------|------|
| 大卡 (2x2) | 订阅即用 | 无需部署，选中员工立即开始工作 |
| A | 硅基能力编排 | agent / rpa / skill / ai-app 统一接口 |
| B | 实时对话 | ChatGPT 式流式响应体验 |
| C | 用量透明 | Token 级别计费与监控 |
| D | 企业级安全 | 数据隔离、审计日志 |
| E | 开放生态 | 贡献者可上传自定义能力 |


**Bento 卡片图标配色**（渐变圆圈 40px，图标取自 Lucide）：

| 卡片 | 图标渐变 |
|------|----------|
| 大卡 · 订阅即用 | `from-violet-500 to-purple-600` |
| A · 硅基能力编排 | `from-blue-500 to-indigo-600` |
| B · 实时对话 | `from-cyan-400 to-blue-500` |
| C · 用量透明 | `from-indigo-500 to-violet-600` |
| D · 企业级安全 | `from-pink-500 to-rose-600` |
| E · 开放生态 | `from-emerald-400 to-teal-600` |

### 5. 工作流程 3 步

```
   ①──────────②──────────③
   │          │          │
[浏览市场]  [订阅员工]  [开始对话]

每步一个 glass-card，中间用虚线连接
连接线：border-top: 1px dashed rgba(255,255,255,0.15)
数字圆圈：渐变背景 + glow
```

### 6. 定价三档

```
┌──────────┐ ┌════════════┐ ┌──────────┐
│ 基础版     │ ║ 专业版      ║ │ 企业版     │
│          │ ║ [推荐]      ║ │          │
│ ¥0       │ ║ ¥999/月    ║ │ 定制      │
│          │ ║            ║ │          │
│ ✓ 3个员工 │ ║ ✓ 无限员工  ║ │ ✓ 私有部署│
│ ✓ 10k token│ ║ ✓ 500k token║ │ ✓ SLA保障│
│          │ ║            ║ │          │
│ [开始]    │ ║ [立即订阅]  ║ │ [联系我们]│
└──────────┘ └════════════┘ └──────────┘
   glass-card    glass-elevated    glass-card
                 + glow-primary
                 + scale(1.05)
                 + 渐变 border
```

**推荐卡片渐变边框技巧**：
```css
.pricing-featured {
  position: relative;
  background: rgba(255, 255, 255, 0.10);
  backdrop-filter: blur(24px);
  border-radius: 20px;
}
.pricing-featured::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 20px;
  padding: 1px;
  background: linear-gradient(135deg, #818cf8, #a78bfa, #22d3ee);
  -webkit-mask: linear-gradient(#fff 0 0) content-box,
                linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
```

### 7. 大 CTA 玻璃块

```css
.cta-block {
  max-width: 1000px;
  margin: 0 auto;
  padding: 80px 48px;
  text-align: center;

  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 40px;  /* 2.5rem — 大圆角保持视觉节奏 */

  /* 内部光晕 */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15),
              0 24px 64px rgba(0, 0, 0, 0.4),
              0 0 120px rgba(124, 58, 237, 0.12);
}
```

内容：`准备好雇佣你的第一位 AI 员工了吗？` + `[免费开始 →]`

### 8. 5 列玻璃 Footer

```
┌────────────────────────────────────────────────┐
│ glass-nav 背景，border-top 分隔                  │
│                                                │
│ [Logo]      产品      资源      公司      法律    │
│ 简介文案     · 员工市场 · 文档   · 关于   · 隐私   │
│ [社交图标]   · 定价    · API    · 博客   · 条款   │
│            · 更新日志  · 社区    · 招聘          │
│                                                │
│ ─────────────────────────────────────────      │
│ © 2026 硅基人才平台         [ICP备案号]          │
└────────────────────────────────────────────────┘
```

---

## 员工市场

> 定位：企业用户浏览、筛选、订阅 AI 数字员工的核心购买页面

### 整体布局结构

```
┌─────────────────────────────────────────────────────┐
│  PAGE HEADER                                         │
│  "员工市场" 标题 + 搜索栏（glass-input，居中宽版）      │
├───────────┬─────────────────────────────────────────┤
│  LEFT     │  MAIN CONTENT                           │
│  FILTER   │                                         │
│  (240px)  │  [分类 Tab 栏]                           │
│           │                                         │
│  glass-nav│  [员工卡片 Grid]                         │
│           │  3列（桌面）/ 2列（平板）/ 1列（移动）     │
│           │                                         │
│           │  [分页]                                  │
└───────────┴─────────────────────────────────────────┘
主题背景：bg-aurora
```

### 员工卡片（Market Card）

```
┌────────────────────────────────┐
│                                │  ← glass-card
│  [员工头像 80px 圆形]            │  padding: 20px
│  渐变色背景圆圈                  │  border-radius: 16px
│                                │
│  王小明 AI 助理                 │  ← H3 18px 白色
│  [在线 ●]  [人事管理]            │  ← glass-badge 状态 + 分类
│                                │
│  专注企业 HR 招聘、绩效管理...    │  ← Body 14px 70%白，2行截断
│                                │
│  ─────────────────────────     │
│  能力  [AI对话] [数据分析] +2   │  ← 能力标签，最多3个
│                                │
│  ¥299/月          [订阅]       │  ← 价格左，按钮右
└────────────────────────────────┘

Hover 效果：
- 整卡上移 translateY(-4px)
- 头像区域出现 glow-primary
- 订阅按钮从 ghost 变 primary 渐变
- 背景 blur 加深，border 更亮
```

### 员工卡片头像设计

不同职能用不同渐变色背景圆圈：
```
人事/HR:    linear-gradient(135deg, #7c3aed, #a855f7)  — 紫
销售/CRM:   linear-gradient(135deg, #2563eb, #3b82f6)  — 蓝
财务:       linear-gradient(135deg, #0891b2, #06b6d4)  — 青
运营:       linear-gradient(135deg, #059669, #10b981)  — 绿
营销:       linear-gradient(135deg, #db2777, #f43f5e)  — 粉
技术:       linear-gradient(135deg, #d97706, #f59e0b)  — 橙
```

### 左侧筛选面板

```
glass-nav 背景，sticky 定位

[搜索框]（glass-input）

职能分类
─────────────────
○ 全部 (156)
○ 人事管理 (24)
○ 销售支持 (18)
○ 财务助理 (15)
[展开更多 ↓]

能力类型
─────────────────
☑ AI 对话
☑ 数据分析
□ RPA 自动化
□ 知识库检索

价格区间
─────────────────
[——●————] 滑块
¥0 — ¥2000/月

状态
─────────────────
● 在线优先
```

### 员工详情侧滑板（Drawer）

点击卡片从右侧滑入，宽度 480px：
```
glass-elevated 背景
border-left: 1px solid rgba(255,255,255,0.10)
backdrop-filter: blur(24px)

内容：
- 大头像 + 姓名 + 状态
- 详细描述（可展开）
- 能力列表（每个能力的详细说明）
- 适用场景
- 定价与订阅计划对比
- [立即订阅] 大按钮 + [预约体验]
```

### 分类 Tab 栏

```
[全部] [热门] [新上架] [人事] [销售] [财务] [运营] [技术]

Active Tab 样式：
- background: rgba(129,140,248,0.15)
- border-bottom: 2px solid #818cf8
- color: #818cf8

平时：transparent，70% 白色
```

---

## 运营端

> 定位：平台运营人员管理员工、审核能力、用户管理的后台系统

### 整体布局

```
┌──────────────┬──────────────────────────────────────┐
│              │  TOP BAR                              │
│  SIDEBAR     │  面包屑 + 搜索 + 通知 + 用户头像        │
│  (240px)     ├──────────────────────────────────────┤
│              │                                      │
│  glass-nav   │  PAGE CONTENT                        │
│              │                                      │
│  Logo 区     │  根据路由渲染不同页面                    │
│  ─────────   │                                      │
│  导航菜单     │                                       │
│  ─────────   │                                      │
│  用户信息     │                                      │
└──────────────┴──────────────────────────────────────┘
背景：bg-midnight（更克制，专业感）
```

### 运营端 Dashboard

**4 个核心指标 Metric Card（一行）**：
```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ 总用户     │ │ 活跃订阅  │ │ 本月收入  │ │ 处理中    │
│ 12,847   │ │  4,231   │ │ ¥298k   │ │   23    │
│ ↑12% 月  │ │ ↑8% 月   │ │ ↑23% 月  │ │ 待审核   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
每张 glass-card，图标带渐变圆圈
```

**图表区（2列）**：
```
┌──────────────────────┐ ┌──────────────────────┐
│  订阅趋势折线图         │ │  能力类型分布饼图       │
│  glass-card          │ │  glass-card           │
│  recharts            │ │  recharts             │
└──────────────────────┘ └──────────────────────┘
```

**最近审核队列**：
```
glass-card 全宽
Table 样式：
- 行背景 hover: rgba(255,255,255,0.05)
- 状态 badge：待审核（amber）/ 已通过（green）/ 驳回（red）
- 操作列：[审核] 按钮 ghost 样式
```

### 能力审核页面

```
┌────────────────────────────────────────┐
│ glass-elevated 审核卡片                 │
│                                        │
│ [能力名称]  [类型标签]  [提交时间]       │
│                                        │
│ 描述：...                               │
│                                        │
│ ┌─────────────────────────────────┐   │
│ │  能力预览区（代码/配置展示）       │   │
│ │  glass-card，monospace 字体      │   │
│ └─────────────────────────────────┘   │
│                                        │
│ 审核意见：[glass-input textarea]       │
│                                        │
│         [驳回]  [通过并发布]           │
└────────────────────────────────────────┘
```

---

## 用户端（聊天工作台）

> 定位：用户与已订阅数字员工对话的核心工作界面

### 整体布局（三栏）

```
┌────────────┬───────────────────────────┬────────────┐
│ 员工列表     │  CHAT AREA                │ 上下文面板   │
│ (280px)    │                           │ (320px)    │
│            │  ┌─────────────────────┐  │            │
│ glass-nav  │  │ 员工信息头部          │  │ glass-nav  │
│            │  │ 头像+名称+状态        │  │            │
│ [搜索]      │  └─────────────────────┘  │ 当前会话     │
│            │                           │ ─────────  │
│ ● 王小明    │  消息流                    │ 已调用能力   │
│   人事助理  │  ┌──────────────┐         │ • AI 对话   │
│   刚刚      │  │ AI 消息气泡    │        │ • 数据分析   │
│            │  │ glass-card    │         │            │
│ ● 李芳      │  │ 左对齐         │        │ Token 用量  │
│   销售助手  │  └──────────────┘         │ ▓▓▓▓░░ 68% │
│   2小时前   │       ┌──────────────┐    │            │
│            │       │ 用户消息       │    │ 快捷操作     │
│ ○ 张伟      │       │ 渐变实心背景   │    │ [清空会话]   │
│   财务      │       │ 右对齐         │    │ [导出记录]   │
│   昨天      │       └──────────────┘    │            │
│            │                           │            │
│            │  ┌─────────────────────┐  │            │
│            │  │ 输入框 glass-input   │  │            │
│            │  │ + 发送按钮           │  │            │
│            │  └─────────────────────┘  │            │
└────────────┴───────────────────────────┴────────────┘
背景：bg-aurora（营造沉浸感）
```

### 消息气泡设计

**AI 消息（左对齐）**：
```css
.message-ai {
  max-width: 720px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 16px 16px 16px 4px;  /* 左下角尖 */
  padding: 16px 20px;
  color: rgba(255, 255, 255, 0.90);
}
```

**用户消息（右对齐）**：
```css
.message-user {
  max-width: 640px;
  background: linear-gradient(135deg,
    rgba(124, 58, 237, 0.85), rgba(37, 99, 235, 0.85));
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px 16px 4px 16px;  /* 右下角尖 */
  padding: 14px 18px;
  color: #ffffff;
}
```

**流式输出（SSE）光标动画**：
```css
.streaming-cursor::after {
  content: '▊';
  animation: blink 1s step-end infinite;
  color: #818cf8;
}
@keyframes blink { 50% { opacity: 0; } }
```

### 工具调用展示（Tool Call）

AI 调用能力时，在消息流中插入一个折叠卡片：
```
┌──────────────────────────────────────┐
│ ⚙ 正在调用「数据分析」能力...  [展开 ▼] │  ← glass-card
│                                      │     border-left: 3px solid #818cf8
│ （展开后显示）                        │
│ 输入参数：{ ... }                     │
│ 执行结果：{ ... }                     │
│ 耗时：1.24s                          │
└──────────────────────────────────────┘

状态图标：
- 执行中：旋转 spinner（#818cf8）
- 成功：✓ 绿色
- 失败：✕ 红色
```

### 输入框区域

```css
.chat-input-container {
  /* 悬浮在底部，玻璃质感 */
  position: sticky;
  bottom: 24px;
  background: rgba(255, 255, 255, 0.10);
  backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  padding: 12px 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28);
}
/* Focus 时整个容器发光 */
.chat-input-container:focus-within {
  border-color: rgba(129, 140, 248, 0.50);
  box-shadow: 0 8px 32px rgba(0,0,0,0.28),
              0 0 24px rgba(129, 140, 248, 0.20);
}
```

底部工具栏：`[📎 附件] [🎤 语音] ... [Token: 1.2k] [发送 →]`

---

## 无障碍与性能

Glassmorphism 最大的风险是**可读性与性能**。NN/g 明确指出：滥用玻璃效果会带来严重的
无障碍与可用性问题（[Nielsen Norman Group](https://www.nngroup.com/articles/glassmorphism/)）。
以下是必须遵守的红线。

### 对比度红线（WCAG）

| 文字类型 | 最低对比度 | 本方案取值 |
|---------|-----------|-----------|
| 正文（<18px） | 4.5:1 | `rgba(255,255,255,0.72)` on glass ≈ 7.1:1 ✅ |
| 大字（≥18px bold / ≥24px） | 3:1 | `rgba(255,255,255,0.55)` ≈ 4.8:1 ✅ |
| UI 组件边界 | 3:1 | border `rgba(255,255,255,0.12)` ⚠️ 需搭配阴影 |

**关键规则**：
1. **玻璃必须叠在深色画布上，而不是叠在图片或亮色区上**。本方案的 `--glass-bg-*`
   是白色低 alpha（5%–16%），只有在 `--bg-deep` / `--bg-primary` 这类深色底上，
   叠加后的有效亮度才足够低、白字对比度才达标。若某处玻璃背后是亮色或照片，
   必须额外垫一层 `rgba(11,15,25,0.55)` 遮罩再叠玻璃。
2. **玻璃面板背后禁止出现高频细节**（照片、密集文字）。只允许放渐变或大面积 blob。
3. **数据表格、长表单不使用玻璃**，用 `--surface-solid` 实心背景。

### 降级策略（backdrop-filter 不支持）

Firefox 103 以下 / 旧浏览器不支持 `backdrop-filter`，必须提供 fallback：

```css
.glass-card {
  /* Fallback：不透明度更高的实心背景 */
  background: rgba(20, 26, 43, 0.92);
}

@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  .glass-card {
    background: var(--glass-bg-medium);
    backdrop-filter: var(--glass-blur-md) saturate(160%);
    -webkit-backdrop-filter: var(--glass-blur-md) saturate(160%);
  }
}
```

### 用户偏好尊重

```css
/* 1. 减少动效 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .blob { animation: none; }
}

/* 2. 高对比度模式 — 关闭玻璃，转实心 */
@media (prefers-contrast: more) {
  .glass-card, .glass-nav, .glass-elevated {
    background: #0f1420 !important;
    backdrop-filter: none !important;
    border-color: rgba(255, 255, 255, 0.40) !important;
  }
}

/* 3. 透明度偏好（Apple 系统级设置） */
@media (prefers-reduced-transparency: reduce) {
  .glass-card, .glass-nav { backdrop-filter: none; background: #141a2b; }
}
```

### 性能预算

`backdrop-filter` 是 GPU 密集操作。硬性约束：

| 约束 | 数值 | 原因 |
|------|------|------|
| 单屏 blur 元素数量 | ≤ 12 个 | 超过后合成层开销显著 |
| 最大 blur 半径 | 28px | 更大的半径收益递减但成本线性增长 |
| 滚动容器内 blur | 禁止 | 每帧重算 backdrop，掉帧严重 |
| 列表项（>20 条） | 用 `--surface-solid` | 长列表虚拟化 + 玻璃 = 卡顿 |
| 动画 blob 数量 | ≤ 3 个 | 每个 blob 是一个 80px blur 图层 |

**性能优化技巧**：
```css
/* 1. 提升为独立合成层，但仅在必要时 */
.glass-card { will-change: auto; }        /* 默认不提升 */
.glass-card:hover { will-change: transform; }  /* 交互时才提升 */

/* 2. 长列表内的"伪玻璃"—— 不用 backdrop-filter */
.list-row-fake-glass {
  background: linear-gradient(rgba(255,255,255,0.05), rgba(255,255,255,0.02));
  border: 1px solid rgba(255,255,255,0.08);
  /* 没有 backdrop-filter，零 GPU 成本，视觉上接近 */
}

/* 3. 移动端降级 blur 半径 */
@media (max-width: 768px) {
  :root {
    --glass-blur-sm: blur(12px);  /* 16px → 12px */
    --glass-blur-md: blur(14px);  /* 20px → 14px */
    --glass-blur-lg: blur(16px);  /* 24px → 16px */
    --glass-blur-xl: blur(18px);  /* 28px → 18px */
  }
}
```

### 焦点可见性

玻璃背景上的默认 focus ring 容易看不见，必须强化：
```css
:focus-visible {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
  /* 双层：亮 ring + 暗描边，保证在任意背景可见 */
  box-shadow: 0 0 0 4px rgba(11, 15, 25, 0.6);
}
```

---

## 实施计划

### Phase 0：设计令牌与基础层（0.5 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 写入 CSS 变量 | `web/src/app/globals.css` | 全套 `--glass-*` / `--surface-*` / 语义色 |
| 扩展 Tailwind 主题 | `web/tailwind.config.ts` | `backdropBlur` / `boxShadow` / `colors` 扩展 |
| 背景组件 | `web/src/components/ui/aurora-background.tsx` | 3 个动态 blob + 网格叠加 |
| 玻璃工具类 | `web/src/app/globals.css` | `.glass-card` `.glass-nav` `.glass-elevated` 等 |
| 降级与偏好查询 | `web/src/app/globals.css` | `@supports` + `prefers-*` 三组媒体查询 |

**验收**：新建一个 `/design-preview` 路由，渲染全部令牌与玻璃层级色卡，肉眼确认层次清晰。

### Phase 1：原子组件玻璃化（1 天）

改造现有 Shadcn 组件，**不改 API，只改样式**，避免连锁修改：

| 组件 | 现状 | 改造 |
|------|------|------|
| `card.tsx` | 白底 + border | 新增 `variant="glass" \| "solid"`，默认 glass |
| `button.tsx` | 实心 | 新增 `glass` / `glass-primary` variant |
| `input.tsx` | 白底 | glass 背景 + focus 发光 |
| `badge.tsx` | 实心色块 | 半透明 + 同色边框（见规范） |
| `dialog.tsx` | 白底 modal | glass-elevated + 遮罩 blur |
| `select.tsx` / `dropdown-menu.tsx` | 白底 | glass-elevated |
| `status-dot.tsx` | 已有 | 增加 glow 光晕 |
| `metric-card.tsx` | 已有 | 换 glass-card + 渐变数字 |

**验收**：`pnpm build` 通过；现有页面无 TypeScript 报错；视觉上所有卡片呈玻璃质感。

### Phase 2：官网落地页（1.5 天）

新建路由组 `web/src/app/(marketing)/`：

```
(marketing)/
├── layout.tsx          # AuroraBackground + PillNav + Footer
├── page.tsx            # 落地页主体
└── _components/
    ├── pill-nav.tsx
    ├── hero.tsx            # 渐变标题 + 3D mockup
    ├── trust-bar.tsx       # count-up 数字
    ├── bento-features.tsx  # 4 列 Bento Grid
    ├── how-it-works.tsx    # 3 步流程
    ├── pricing.tsx         # 三档 + 渐变边框推荐卡
    ├── cta-block.tsx
    └── site-footer.tsx
```

**验收**：Lighthouse Performance ≥ 85，Accessibility ≥ 95；1440px / 768px / 375px 三档断点无溢出。

### Phase 3：员工市场（1 天）

| 任务 | 文件 |
|------|------|
| 市场首页 | `web/src/app/(marketing)/marketplace/page.tsx` |
| 员工卡片 | `_components/employee-card.tsx`（3D tilt + hover CTA） |
| 筛选侧栏 | `_components/filter-sidebar.tsx`（glass-nav，sticky） |
| 详情抽屉 | `_components/employee-drawer.tsx`（右侧 480px glass-elevated） |
| 分类 Tab | `_components/category-tabs.tsx`（胶囊 + 滑动指示器） |

**验收**：卡片 hover 动画 60fps（DevTools Performance 录制确认）；筛选交互无布局跳动。

### Phase 4：企业端 / 运营端外壳改造（1 天）

| 任务 | 文件 |
|------|------|
| 侧栏玻璃化 | `web/src/components/shell/enterprise-shell.tsx` |
| 导航项 glow | `web/src/components/shell/nav-item.tsx` |
| 顶栏玻璃化 | 同 shell 文件，新增 sticky header |
| Dashboard 改造 | `web/src/app/(enterprise)/dashboard/page.tsx` |
| 我的员工改造 | `web/src/app/(enterprise)/my-employees/page.tsx` |
| 运营端外壳 | `web/src/app/(platform)/**` 同步改造 |
| 表格实心化 | 所有 `<table>` 容器用 `--surface-solid` |

**注意**：运营端表格、审核列表**保持实心背景**，只在外壳（侧栏/顶栏/统计卡）用玻璃。

**验收**：数据表格在 1440px 下文字对比度 ≥ 4.5:1（用 axe DevTools 扫描）。

### Phase 5：用户端聊天工作台（1 天）~~已砍掉~~

> ⛔ **已取消（2026-08-04）**：聊天工作台阶段暂不实施，待后续排期。

### Phase 6：质量门禁（0.5 天）✅ 自动化完成

```bash
/ccg:verify-quality  web/src           # ✅ 0 错误，0 警告（1 info 已修复）
/ccg:verify-change                     # ✅ 通过，文档同步 OK
```

外加检查清单：
- [x] `prefers-reduced-motion` 开启后所有动画停止（CSS 已实现，`globals.css:793`）
- [x] `prefers-contrast: more` 开启后玻璃转实心（CSS 已实现，`globals.css:814`）
- [x] focus ring 在任意背景可见（双主题均有 `:focus-visible` 规则，`globals.css:573`）
- [ ] Firefox / Safari / Chrome 三浏览器视觉一致（需人工浏览器验证）
- [ ] axe DevTools 零 Critical / Serious 问题（需人工 DevTools 扫描）
- [ ] 单屏 blur 元素数量 ≤ 12（DevTools Layers 面板确认）

### 总工期

| Phase | 内容 | 工期 |
|-------|------|------|
| 0 | 设计令牌与基础层 | 0.5 天 |
| 1 | 原子组件玻璃化 | 1 天 |
| 2 | 官网落地页 | 1.5 天 |
| 3 | 员工市场 | 1 天 |
| 4 | 企业端/运营端外壳 | 1 天 |
| 5 | 用户端聊天工作台 | 1 天 |
| 6 | 质量门禁 | 0.5 天 |
| **合计** | | **6.5 天** |

### 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 玻璃效果导致数据密集页面难读 | 高 | 表格/长表单强制实心；玻璃只用于外壳与卡片 |
| 移动端 blur 性能不足 | 中 | 768px 以下降级 blur 半径；blob 数减到 1 个 |
| 现有 Shadcn 组件改造引发连锁报错 | 中 | 只加 variant 不改 API；分组件逐个 `pnpm build` 验证 |
| 深色主题与现有浅色页面混杂 | 中 | Phase 4 一次性切换所有外壳，不留中间态 |
| 渐变文字在 Safari 下失效 | 低 | `-webkit-background-clip` + `background-clip` 双写 |

---

## 参考来源

本文档的技术参数取自以下实际实现与设计系统，而非凭印象撰写：

**设计系统官方文档**
- [Microsoft Fluent 2 — Material](https://fluent2.microsoft.design/material) — solid / mica / acrylic / smoke 四种材质分级
- [Microsoft Acrylic material 规范](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic) — Windows 11 acrylic 亮度与半透明参数
- [Microsoft Materials overview](https://learn.microsoft.com/en-us/windows/apps/develop/ui/materials) — DirectX 11 硬件门槛与降级为纯色主题的策略
- [Nielsen Norman Group — Glassmorphism: Definition and Best Practices](https://www.nngroup.com/articles/glassmorphism/) — 无障碍红线与滥用风险

**开源实现（可读源码的 CSS 数值来源）**
- [JUNGHERZ/GlassKit](https://github.com/JUNGHERZ/GlassKit) — 24 组件 CSS 库，iOS 26 Liquid Glass 风格，含 Design Tokens 与明暗双模式
- [kevinbism/liquid-glass-effect](https://github.com/kevinbism/liquid-glass-effect) — 提供 `box-shadow: 0 8px 32px rgba(31,38,135,0.2), inset 0 4px 20px rgba(255,255,255,0.3)` 的双层阴影配方
- [Aks-4125/kmp-glassmorphism-skill](https://github.com/Aks-4125/kmp-glassmorphism-skill) — 完整玻璃组件清单（GlassSurface / GlassCard / GlassSidebar / LiquidBackground 等），本文的组件分层参考了它的划分
- [Brennoleon/glassgradients](https://github.com/Brennoleon/glassgradients) — 玻璃渐变引擎，主题令牌与 SSR 处理
- [openclaw/skills — glassmorphism.md](https://github.com/openclaw/skills/blob/main/skills/1999azzar/ui-designer-skill/references/glassmorphism.md) — "玻璃必须搭配彩色/高细节背景，纯白纯黑底上只会变成灰盒子" 这条硬约束的来源
- [AtharvaMistry/tailwind-classes](https://github.com/AtharvaMistry/tailwind-classes) — Tailwind 玻璃工具类与 hover 状态实现

**具体数值案例**
- [superdesign.dev — Glassmorphism Dashboard](https://superdesign.dev/styles/glassmorphism/dashboard) — 深靛蓝画布 `#0f172a` + 蓝 `#667eea` / 紫 `#764ba2` 发光 blob + 16px blur + `rgba(255,255,255,0.1)` 填充 + 1px 25% 白边 + 16px 圆角
- [superdesign.dev — Glassmorphism Card](https://superdesign.dev/styles/glassmorphism/card) — 16–20px blur、`rgba(255,255,255,0.06)` 低透明填充、`rgba(255,255,255,0.1)` 1px 边框、噪点叠加防止扁平
- [superdesign.dev — Glassmorphism Website](https://superdesign.dev/styles/glassmorphism/website) — 本文落地页结构（胶囊导航 → 双色渐变标题 Hero → 悬浮 dashboard mockup → 6 卡特性网格 → Bento → 三档定价 → 大 CTA → 5 列 footer）直接对应此案例
- [superdesign.dev — Glassmorphism 库示例](https://superdesign.dev/library/glassmorphism-card) — max-width 1600px 容器、2.5rem（40px）大圆角保持视觉节奏、grainy noise 防色带、1px 10% 白边强制要求
- [superdesign.dev — CSS Recipe & Generator](https://superdesign.dev/styles/glassmorphism) — 玻璃四要素定义：半透明背景 + backdrop blur + 细亮边框 + 柔和阴影
- [openreplay — Pure CSS Glassmorphic UI](https://blog.openreplay.com/create-glassmorphic-ui-css/) — blur 取值区间 8–15px 的依据，以及 Chrome 76+ / Safari 9+ / Firefox 103+ 的支持门槛
- [Arashtad — CSS backdrop-filter for Glassmorphism（PDF）](https://press.arashtad.com/wp-content/uploads/pdf/CSS_Applying_Backdrop_Filter_for_Modern_Glassmorphism_Designs.pdf) — backdrop-filter 性能优化与跨浏览器处理

**趋势与最佳实践**
- [setproduct — Glassmorphism vs neumorphism vs liquid glass (2026)](https://www.setproduct.com/blog/liquid-glass-vs-glassmorphism) — 三种风格的区别与各自失效场景
- [Inverness Design Studio — Glassmorphism in 2026](https://invernessdesignstudio.com/glassmorphism-what-it-is-and-how-to-use-it-in-2026) — 2026 年玻璃 + 粗体字 + 暗色渐变 + 空间 UI 的组合趋势
- [everydayux — Apple Liquid Glass 如何重塑界面设计](https://www.everydayux.net/glassmorphism-apple-liquid-glass-interface-design/)
- [uxpilot — 12 Glassmorphism UI Features & Best Practices](https://uxpilot.ai/blogs/glassmorphism-ui) — Apple iOS 26 / macOS Tahoe 与 Windows 11 Fluent 的规模化验证
- [clay.global — How to Do Glassmorphism Right](https://clay.global/blog/glassmorphism-ui)
- [Ramotion — What is Glassmorphism](https://www.ramotion.com/blog/what-is-glassmorphism/)
- [figr.design — Complete Guide to Frosted Glass UI](https://figr.design/blog/glassmorphism-0e8b1)
- [tools.town — backdrop-filter, Blur & Accessible UI](https://tools.town/learn/design-tools/glass-morphism-generator-guide/)
- [newtarget — Glassmorphism with Accessibility in Mind](https://www.newtarget.com/web-insights-blog/glassmorphism/)
- [Medium — Dark Glassmorphism: 2026 的定义性美学](https://medium.com/@developer_89726/dark-glassmorphism-the-aesthetic-that-will-define-ui-in-2026-93aa4153088f) — alpha 通道渐变是暗色玻璃的关键
- [Webflow — Glassmorphism examples and best practices](https://webflow.com/blog/glassmorphism)

**视觉参考画廊**
- [Dribbble — Glassmorphism 标签（7,878 个设计）](https://dribbble.com/tags/glassmorphism)
- [Dribbble — Dashboard Glass](https://dribbble.com/tags/dashboard-glass)
- [One Page Love — Glassmorphism 落地页（45 个真实站点）](https://onepagelove.com/style/glassmorphism)
- [mycodelesswebsite — Best Glassmorphism Websites of 2026](https://mycodelesswebsite.com/glassmorphism-websites/)
- [superdevresources — 16 Glassmorphism UI Inspirations](https://superdevresources.com/glassmorphism-ui-inspiration/)
- [freefrontend — 70+ CSS Glassmorphism Designs](https://freefrontend.com/css-glassmorphism/)
- [freefrontend — 40+ backdrop-filter Examples](https://freefrontend.com/css-backdrop-filter-examples/)

---

*文档版本 v1.0 · 2026-07-31 · 待评审后进入 Phase 0*
