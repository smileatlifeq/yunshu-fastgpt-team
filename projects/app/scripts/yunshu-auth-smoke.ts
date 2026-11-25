/**
 * 仅用于隔离身份联调：真实原生 API、Mongo 事务、Redis 会话与用户锁。
 * 不是完整 Next.js 应用启动器，不初始化模型、向量库、任务队列或正式数据。
 */
import { createServer } from 'node:http';
import {
  connectionMongo,
  connectionLogMongo,
  MongoIndexManager
} from '@fastgpt/service/common/mongo';
import { configureRedisRuntime, closeRedisRuntime } from '@fastgpt/dal/redis/runtime';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { MongoTeam } from '@fastgpt/service/support/user/team/teamSchema';
import { MongoTeamMember } from '@fastgpt/service/support/user/team/teamMemberSchema';
import { hashStr } from '@fastgpt/global/common/string/tools';
import { SystemEnvSchema } from '@fastgpt/global/common/system/types';
import { initGlobalVariables } from '../src/service/common/system';
import preLogin from '../src/pages/api/support/user/account/preLogin';
import loginByPassword from '../src/pages/api/support/user/account/loginByPassword';
import tokenLogin from '../src/pages/api/support/user/account/tokenLogin';
import loginout from '../src/pages/api/support/user/account/loginout';
import accounts from '../src/pages/api/yunshu/accounts/index';
import updateAccount from '../src/pages/api/yunshu/accounts/[userId]';
import team from '../src/pages/api/yunshu/team';
import type { NextApiRequest, NextApiResponse } from '@fastgpt/next/type';

/** 固定回环测试 Mongo 和 DB 前缀，避免测试脚本接到现有数据。 */
export async function startYunshuIdentitySmoke() {
  const mongoUrl = process.env.MONGODB_URI ?? '';
  const parsed = new URL(mongoUrl);
  if (
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '27018' ||
    !parsed.pathname.startsWith('/yunshu_auth_smoke_') ||
    process.env.REDIS_URL !== 'redis://127.0.0.1:6380' ||
    !process.env.YUNSHU_TEST_ROOT_PASSWORD
  )
    throw new Error('Disposable test environment required');
  await connectionMongo.connect(mongoUrl);
  await connectionLogMongo.connect(mongoUrl);
  configureRedisRuntime({ redisUrl: process.env.REDIS_URL });
  initGlobalVariables();
  global.feConfigs = { ...global.feConfigs, isPlus: false };
  global.systemEnv = SystemEnvSchema.parse({});
  global.agentUserTmbIds = new Set();
  // 等待已加载的原生索引同步结束，包含 username 唯一约束。
  for (const model of Object.values(connectionMongo.models)) {
    await MongoIndexManager.syncModelIndexes({ model });
  }
  const user = await MongoUser.create({
    username: 'root',
    password: hashStr(process.env.YUNSHU_TEST_ROOT_PASSWORD),
    status: 'active'
  });
  const rootTeam = await MongoTeam.create({
    name: '云枢隔离账号测试',
    ownerId: user._id,
    balance: 0
  });
  const member = await MongoTeamMember.create({
    userId: user._id,
    teamId: rootTeam._id,
    name: 'root',
    role: 'owner',
    status: 'active',
    isSetMemberName: true
  });
  await MongoUser.updateOne({ _id: user._id }, { $set: { lastLoginTmbId: member._id } });
  process.env.YUNSHU_ADMIN_TEAM_ID = String(rootTeam._id);

  const routes = new Map([
    ['/api/support/user/account/preLogin', preLogin],
    ['/api/support/user/account/loginByPassword', loginByPassword],
    ['/api/support/user/account/tokenLogin', tokenLogin],
    ['/api/support/user/account/loginout', loginout],
    ['/api/yunshu/accounts', accounts],
    ['/api/yunshu/team', team]
  ]);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:3040');
    const match = /^\/api\/yunshu\/accounts\/([a-f0-9]{24})$/.exec(url.pathname);
    const handler = match ? updateAccount : routes.get(url.pathname);
    if (!handler) {
      res.writeHead(404).end();
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      // 将 Node HTTP 请求转换为原生 Next API 所需字段，不添加任何认证信息。
      const nextReq = Object.assign(req, {
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {},
        query: { ...Object.fromEntries(url.searchParams), ...(match ? { userId: match[1] } : {}) },
        cookies: Object.fromEntries(
          (req.headers.cookie ?? '')
            .split(';')
            .filter(Boolean)
            .map((part) => {
              const index = part.indexOf('=');
              return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
            })
        )
      });
      const nextRes = Object.assign(res, {
        status: (code: number) => {
          res.statusCode = code;
          return nextRes;
        },
        json: (value: unknown) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(value));
        }
      });
      await handler(nextReq as NextApiRequest, nextRes as unknown as NextApiResponse);
    } catch (error) {
      // 不打印请求、Cookie、密码摘要或数据库异常内容。
      console.error('HTTP harness failed', error instanceof Error ? error.name : typeof error);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(3040, '127.0.0.1', resolve);
  });

  /** 收尾只删除本次随机 DB，保留其他容器和数据库。 */
  const cleanup = async () => {
    server.close();
    await connectionMongo.connection.db?.dropDatabase();
    await connectionMongo.disconnect();
    await connectionLogMongo.disconnect();
    await closeRedisRuntime();
  };
  return { cleanup };
}
