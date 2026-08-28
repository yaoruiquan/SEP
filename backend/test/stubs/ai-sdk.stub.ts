/**
 * Vercel AI SDK 的 CJS 替身。
 *
 * `ai` 与 `@ai-sdk/*` 都是纯 ESM，ts-jest 的 CJS 管线加载不了
 * （"Cannot use import statement outside a module"），任何 import 链能碰到
 * DigitalEmployeeRunner / ConversationStreamService 的测试都会在加载阶段就崩。
 *
 * 这里只补齐**模块作用域**用到的导出名。断言模型行为的测试不该走这个替身，
 * 它服务的是依赖图与装配类测试（见 src/app.module.di.spec.ts）。
 */
export const generateText = () => {
  throw new Error('ai-sdk stub: generateText 不可在测试中真实调用');
};

export const streamText = () => {
  throw new Error('ai-sdk stub: streamText 不可在测试中真实调用');
};

export const isStepCount = () => false;

export const jsonSchema = <T>(schema: T) => schema;

export const createOpenAICompatible = () => () => {
  throw new Error('ai-sdk stub: 模型工厂不可在测试中真实调用');
};
