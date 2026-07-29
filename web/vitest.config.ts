import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // 只跑 src 下的测试，别去扫 .next 里的构建产物
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    // 与 tsconfig 的 paths 保持一致
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
