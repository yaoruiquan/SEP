import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // semantic tokens wired to CSS variables in globals.css
        //
        // ⚠️ 不透明令牌写成 `rgb(var(--x-rgb) / <alpha-value>)` 而非 `var(--x)`：
        // Tailwind v3 对 var() 形式的颜色会静默丢弃 alpha 修饰符，全站 147 处
        // bg-primary/10、bg-muted/40、bg-danger/10 之类一直编译不出声明。
        // 半透明令牌（border / sidebar / fg*）保持 var()，转通道会丢自带透明度。
        background: 'rgb(var(--background-rgb) / <alpha-value>)',
        sidebar: 'var(--sidebar)',
        card: 'rgb(var(--card-rgb) / <alpha-value>)',
        muted: {
          DEFAULT: 'rgb(var(--muted-rgb) / <alpha-value>)',
          foreground: 'var(--fg-muted)',
        },
        border: 'var(--border)',
        input: 'var(--border)',
        ring: 'var(--brand-ring)',
        foreground: 'var(--fg)',
        // 270+ 处用 text-fg-muted 但从未定义 fg key → 所有 text-fg-muted 编译后
        // 是空的。补上 fg 颜色键，挂到 :root 的 --fg-* 变量。
        fg: {
          DEFAULT: 'var(--fg)',
          muted: 'var(--fg-muted)',
          subtle: 'var(--fg-subtle)',
        },
        // select.tsx / dropdown-menu.tsx / admin/audit 一直在用 bg-popover、
        // bg-accent，但之前从未定义 → 这些 class 编译后是空的（浮层透明）。
        // 挂到已有变量上，这样 .theme-glass 的令牌桥自动覆盖它们。
        popover: {
          DEFAULT: 'rgb(var(--card-rgb) / <alpha-value>)',
          foreground: 'var(--fg)',
        },
        accent: {
          DEFAULT: 'rgb(var(--muted-rgb) / <alpha-value>)',
          foreground: 'var(--fg)',
        },
        primary: {
          DEFAULT: 'rgb(var(--brand-rgb) / <alpha-value>)',
          hover: 'var(--brand-hover)',
          subtle: 'var(--brand-subtle)',
          foreground: '#ffffff',
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        // 完整的中性色阶
        neutral: {
          50: '#FAFAFA',
          100: '#F5F5F5',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
        },
        // 语义色完整色阶（DEFAULT 走通道形式，让 bg-danger/10 这类真正生效）
        success: {
          DEFAULT: 'rgb(var(--success-rgb) / <alpha-value>)',
          50: '#F0FDF4',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning-rgb) / <alpha-value>)',
          50: '#FEFCE8',
          500: '#EAB308',
          600: '#D97706',
          700: '#A16207',
        },
        danger: {
          DEFAULT: 'rgb(var(--danger-rgb) / <alpha-value>)',
          50: '#FEF2F2',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
        },
        error: {
          DEFAULT: 'rgb(var(--danger-rgb) / <alpha-value>)',
          50: '#FEF2F2',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
        },
        info: {
          DEFAULT: 'rgb(var(--info-rgb) / <alpha-value>)',
          50: '#EFF6FF',
          500: '#3B82F6',
          700: '#1D4ED8',
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

        // ─────────────────────────────────────────────────────────────────
        // Glassmorphism 令牌（仅在 .theme-glass 作用域内有值）
        // 全部指向 globals.css 的 CSS 变量，不覆盖任何浅色主题键
        // ─────────────────────────────────────────────────────────────────

        // 画布底色 → bg-gbg-canvas
        // 写成 rgb(var(--x-rgb) / <alpha-value>) 而非 var(--x)，
        // 否则 Tailwind v3 会静默丢弃 /alpha 修饰符（bg-gbg-deep/80 编译不出东西）。
        gbg: {
          deep: 'rgb(var(--gbg-deep-rgb) / <alpha-value>)',
          canvas: 'rgb(var(--gbg-canvas-rgb) / <alpha-value>)',
          raised: 'rgb(var(--gbg-raised-rgb) / <alpha-value>)',
        },
        // 玻璃填充 → bg-glass-2
        glass: {
          1: 'var(--glass-1)',
          2: 'var(--glass-2)',
          3: 'var(--glass-3)',
          4: 'var(--glass-4)',
          'accent-2': 'var(--glass-accent-2)',
          'accent-3': 'var(--glass-accent-3)',
        },
        // 背景装饰球 → bg-blob-violet（一般直接用 .aurora-blob-* 类，这里备用）
        blob: {
          violet: 'var(--blob-violet)',
          blue: 'var(--blob-blue)',
          cyan: 'var(--blob-cyan)',
          indigo: 'var(--blob-indigo)',
          pink: 'var(--blob-pink)',
        },
        // 玻璃描边 → border-glassline / border-glassline-brand
        glassline: {
          DEFAULT: 'var(--glass-border)',
          hover: 'var(--glass-border-hover)',
          glow: 'var(--glass-border-glow)',
          brand: 'var(--glass-border-brand)',
        },
        // 实心表面（表格/长列表强制使用）→ bg-solid-raised
        solid: {
          DEFAULT: 'var(--surface-solid)',
          raised: 'var(--surface-solid-raised)',
          hover: 'var(--surface-solid-hover)',
          border: 'var(--surface-solid-border)',
        },
        // 深底文字 → text-gtext-secondary
        gtext: {
          primary: 'var(--gtext-primary)',
          secondary: 'var(--gtext-secondary)',
          muted: 'var(--gtext-muted)',
          disabled: 'var(--gtext-disabled)',
        },
        // 深底品牌色 —— 填充与文字必须分开取值，别混用：
        //   bg-gbrand      白字压上去 6.29:1 ✅ AA
        //   text-gbrand-text  压在画布上 6.25:1 ✅ AA
        // 反过来用（bg-gbrand-text + 白字）只有 2.98:1，不合规。
        gbrand: {
          DEFAULT: 'rgb(var(--gbrand-rgb) / <alpha-value>)',
          hover: 'var(--gbrand-hover)',
          text: 'rgb(var(--gbrand-text-rgb) / <alpha-value>)',
          'text-hover': 'var(--gbrand-text-hover)',
          subtle: 'var(--gbrand-subtle)',
          ring: 'var(--gbrand-ring)',
        },
        // 深底语义色（rgb 通道形式，支持 bg-gsuccess/20 这类 alpha 修饰）
        gsuccess: 'rgb(var(--gsuccess-rgb) / <alpha-value>)',
        gwarning: 'rgb(var(--gwarning-rgb) / <alpha-value>)',
        gdanger: 'rgb(var(--gdanger-rgb) / <alpha-value>)',
        ginfo: 'rgb(var(--ginfo-rgb) / <alpha-value>)',
        // Neon 高亮（核心指标 / 状态指示，少量使用）
        gneon: {
          blue: 'var(--gneon-blue)',
          purple: 'var(--gneon-purple)',
          green: 'var(--gneon-green)',
        },
      },
      borderRadius: {
        none: '0px',
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        full: '9999px',
        // Glass 圆角阶（独立命名，避免与上面浅色主题的 sm/md/lg 混淆）
        'glass-sm': 'var(--gradius-sm)',
        'glass-md': 'var(--gradius-md)',
        'glass-lg': 'var(--gradius-lg)',
        'glass-xl': 'var(--gradius-xl)',
        'glass-2xl': 'var(--gradius-2xl)',
        'glass-3xl': 'var(--gradius-3xl)',
        'glass-pill': 'var(--gradius-pill)',
      },
      // backdrop-filter 模糊阶 —— 28px 是性能上限，不要新增更大的值
      backdropBlur: {
        'glass-xs': '12px',
        'glass-sm': '16px',
        'glass-md': '20px',
        'glass-lg': '24px',
        'glass-xl': '28px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        card: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'card-hover': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        modal: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        // Glass 阴影阶（蓝紫投影 rgba(31,38,135) + 内高光，md 以上自带 inset）
        'glass-sm': 'var(--glass-shadow-sm)',
        'glass-md': 'var(--glass-shadow-md)',
        'glass-lg': 'var(--glass-shadow-lg)',
        'glass-xl': 'var(--glass-shadow-xl)',
        // 品牌辉光，用于强调卡片 / 主 CTA
        'glow-brand': '0 0 32px rgba(129, 140, 248, 0.28)',
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'Microsoft YaHei', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
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
      // 自定义动画
      animation: {
        skeleton: 'skeleton 1.5s infinite',
        'pulse-slow': 'pulse 2s infinite',
        'slide-in-right': 'slideInRight 200ms ease-out',
        'slide-in-top': 'slideInTop 200ms ease-out',
        'fade-in': 'fadeIn 150ms ease-out',
        'scale-in': 'scaleIn 200ms ease-out',
        'highlight': 'highlight 1s ease-out',
        // aurora-drift-a/b/c 的 keyframes 定义在 globals.css（全局作用域），
        // 这里只提供 Tailwind 简写，避免同一套 keyframes 定义两遍。
        'blob-drift-a': 'aurora-drift-a 24s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'blob-drift-b': 'aurora-drift-b 30s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'blob-drift-c': 'aurora-drift-c 27s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
      keyframes: {
        skeleton: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        slideInRight: {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        slideInTop: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        highlight: {
          '0%': { backgroundColor: 'rgb(219, 234, 254)' }, // Primary 100
          '100%': { backgroundColor: 'transparent' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
