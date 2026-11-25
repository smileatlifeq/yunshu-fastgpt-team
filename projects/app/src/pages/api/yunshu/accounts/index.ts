import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import {
  YunshuCreateBodySchema,
  YunshuListQuerySchema,
  YunshuListResponseSchema
} from '@fastgpt/global/openapi/support/yunshu/api';
import { YunshuAccountViewSchema } from '@fastgpt/global/support/yunshu/type';
import { createYunshuAccount, listYunshuAccounts } from '@fastgpt/service/support/yunshu/service';
import { yunshuAccountEntry } from '@/service/yunshu/entry';

export default yunshuAccountEntry({
  methods: ['GET', 'POST'],
  handler: async ({ req, actor, repository }) => {
    if (req.method === 'GET') {
      const { query } = parseApiInput({ req, querySchema: YunshuListQuerySchema });
      return YunshuListResponseSchema.parse(await listYunshuAccounts({ repository, actor, query }));
    }
    const { body } = parseApiInput({ req, bodySchema: YunshuCreateBodySchema });
    return YunshuAccountViewSchema.parse(await createYunshuAccount({ repository, actor, body }));
  }
});
