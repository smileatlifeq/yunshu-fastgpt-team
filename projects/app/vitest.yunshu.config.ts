import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// 真实身份联调单独运行，不载入将认证、HTTP、Redis 和事务替换掉的通用 mocks。
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': resolve('src'),
      '@fastgpt': resolve('../../packages'),
      '@fastgpt-sdk/storage/access-link': resolve('../../sdk/storage/src/access-link/index.ts'),
      '@fastgpt-sdk/storage': resolve('../../sdk/storage/src/index.ts'),
      '@fastgpt-sdk/otel/logger': resolve('../../sdk/otel/src/logger-entry.ts'),
      '@fastgpt-sdk/otel/metrics': resolve('../../sdk/otel/src/metrics-entry.ts'),
      '@fastgpt-sdk/otel/tracing': resolve('../../sdk/otel/src/tracing-entry.ts'),
      '@fastgpt-sdk/otel': resolve('../../sdk/otel/src/index.ts')
    }
  },
  test: {
    include: ['test/yunshu/native-http.test.ts', 'test/yunshu/accounts-page.test.tsx'],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 60000
  }
});
