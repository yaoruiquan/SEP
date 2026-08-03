import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // semantic tokens wired to CSS variables in globals.css
        background: 'var(--background)',
        sidebar: 'var(--sidebar)',
        card: 'var(--card)',
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--fg-muted)',
        },
        border: 'var(--border)',
        input: 'var(--border)',
        ring: 'var(--brand-ring)',
        foreground: 'var(--fg)',
        primary: {
          DEFAULT: 'var(--brand)',
          hover: 'var(--brand-hover)',
          subtle: 'var(--brand-subtle)',
          foreground: '#ffffff',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius-sm)',
        lg: 'var(--radius)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
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
