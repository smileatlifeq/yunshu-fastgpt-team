import { yunshuAccountEntry } from '@/service/yunshu/entry';
import { YunshuCollaborationResponseSchema } from '@fastgpt/global/openapi/support/yunshu/api';
import { isYunshuCollaborationTeam } from '@fastgpt/service/support/yunshu/collaborationPolicy';
import { synchronizeYunshuCollaboration } from '@fastgpt/service/support/yunshu/collaboration';

/** 独立内部协作入口，不依赖商业版接口；团队和 root 身份均由服务端核验。 */
export default yunshuAccountEntry({
  methods: ['GET', 'POST'],
  handler: async ({ req, actor, repository }) => {
    await repository.transaction((unit) => unit.assertRoot(actor));
    return YunshuCollaborationResponseSchema.parse(
      req.method === 'GET'
        ? { enabled: isYunshuCollaborationTeam(actor.teamId) }
        : await synchronizeYunshuCollaboration({ repository, actor })
    );
  }
});
