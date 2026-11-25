import { parseApiInput } from '@fastgpt/service/common/zod/requestParseError';
import {
  YunshuAccountQuerySchema,
  YunshuUpdateBodySchema
} from '@fastgpt/global/openapi/support/yunshu/api';
import { updateYunshuAccount } from '@fastgpt/service/support/yunshu/service';
import { yunshuAccountEntry } from '@/service/yunshu/entry';
import { YunshuAccountViewSchema } from '@fastgpt/global/support/yunshu/type';

export default yunshuAccountEntry({
  methods: ['POST'],
  handler: async ({ req, actor, repository }) => {
    const { query, body } = parseApiInput({
      req,
      querySchema: YunshuAccountQuerySchema,
      bodySchema: YunshuUpdateBodySchema
    });
    return YunshuAccountViewSchema.parse(
      await updateYunshuAccount({ repository, actor, userId: query.userId, body })
    );
  }
});
