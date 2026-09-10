import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';

const tsRecommended = tseslint.configs['flat/recommended'];
const recommended = Array.isArray(tsRecommended) ? tsRecommended : [tsRecommended];

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'test/**/*.d.ts'],
  },
  ...recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'prisma/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // 历史代码里 alipay-sdk 是 CJS，测试用 require('shared')；先降级为 warn，
      // 让 CI lint 门禁只阻断真正的 error，不因存量风格问题全线失败。
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  eslintConfigPrettier,
];
