import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^shared$': '<rootDir>/shared/index.ts',
    // `ai` / `@ai-sdk/*` 是纯 ESM，ts-jest 加载不了。没有测试断言模型行为，
    // 所以统一换成 CJS 替身，让依赖图/装配类测试能 import 到运行器。
    '^ai$': '<rootDir>/../test/stubs/ai-sdk.stub.ts',
    '^@ai-sdk/openai-compatible$': '<rootDir>/../test/stubs/ai-sdk.stub.ts',
  },
};

export default config;
