import { NextAPI } from '../middleware/entry';
import { authSystemAdmin } from '@fastgpt/service/support/permission/user/auth';
import { createYunshuRepository } from '@fastgpt/service/support/yunshu/entity';
import {
  configuredYunshuTeam,
  assertYunshuOrigin,
  YunshuAccountError
} from '@fastgpt/service/support/yunshu/utils';
import type { YunshuActor, YunshuRepository } from '@fastgpt/service/support/yunshu/types';
import type { NextApiRequest, NextApiResponse } from '@fastgpt/next/type';
import { ApiRequestInputParseError } from '@fastgpt/service/common/zod/requestParseError';
import { getLogger, LogCategories } from '@fastgpt/service/common/logger';

/** 复用原生 Cookie 会话；API key、请求中的 userId/role 不能成为管理凭据。 */
export const yunshuAccountEntry = ({
  methods,
  allowUnconfiguredTeam = false,
  handler
}: {
  methods: string[];
  allowUnconfiguredTeam?: boolean;
  handler: (props: {
    req: NextApiRequest;
    res: NextApiResponse;
    actor: YunshuActor;
    repository: YunshuRepository;
  }) => Promise<unknown>;
}) =>
  NextAPI(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const root = await authSystemAdmin({ req });
      if (!methods.includes(req.method ?? '')) {
        throw new YunshuAccountError(405, 'METHOD_NOT_ALLOWED', '该操作方式不受支持');
      }
      if (req.method !== 'GET') assertYunshuOrigin(req.headers.origin);
      const actor = {
        userId: String(root.userId),
        teamId: allowUnconfiguredTeam ? String(root.teamId) : configuredYunshuTeam()
      };
      return await handler({ req, res, actor, repository: createYunshuRepository() });
    } catch (error) {
      const known = error instanceof YunshuAccountError;
      const badInput = error instanceof ApiRequestInputParseError;
      // 原生认证错误可能是字符串枚举，不向浏览器回显其内部实现或提交的摘要。
      const authError = typeof error === 'string';
      const status = known ? error.status : badInput ? 400 : authError ? 401 : 500;
      if (status >= 500) {
        getLogger(LogCategories.HTTP.ERROR).error('Yunshu account request failed', {
          errorType: error instanceof Error ? error.name : typeof error
        });
      }
      res
        .status(status)
        .json({
          code: status,
          statusText: 'error',
          data: null,
          message: known
            ? error.message
            : badInput
              ? '请求字段格式无效'
              : authError
                ? '请使用 root 登录'
                : '账号服务暂不可用'
        });
    }
  });
