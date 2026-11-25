import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startYunshuIdentitySmoke } from '../../scripts/yunshu-auth-smoke';

let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  stop = (await startYunshuIdentitySmoke()).cleanup;
});
afterAll(async () => {
  await stop?.();
});

it('真实原生登录、Mongo/Redis 会话与两个 GraphRAG 管理员完成 HTTP 联调', async () => {
  const python = process.env.YUNSHU_TEST_PYTHON;
  const graph = process.env.YUNSHU_TEST_GRAPHRAG;
  const output = process.env.YUNSHU_TEST_OUTPUT;
  if (!python || !graph || !output) throw new Error('Test runner paths required');
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(python, ['-m', 'unittest', 'test_yunshu_identity_integration', '-v'], {
      cwd: graph,
      env: {
        ...process.env,
        GRAPHRAG_TEST_FASTGPT_BASE_URL: 'http://127.0.0.1:3040',
        GRAPHRAG_TEST_FASTGPT_ROOT_PASSWORD: process.env.YUNSHU_TEST_ROOT_PASSWORD,
        PYTHONIOENCODING: 'utf-8'
      }
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output: Buffer.concat(chunks).toString() }));
    const timer = setTimeout(() => child.kill(), 120000);
    child.once('close', () => clearTimeout(timer));
  });
  await writeFile(output, result.output, 'utf-8');
  expect(result.code, 'See isolated GraphRAG integration log').toBe(0);
});
