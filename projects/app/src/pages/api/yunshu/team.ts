import { yunshuAccountEntry } from '@/service/yunshu/entry';
import { YunshuTeamResponseSchema } from '@fastgpt/global/openapi/support/yunshu/api';
import { configuredYunshuTeam } from '@fastgpt/service/support/yunshu/utils';

/** 配置前只向真正 root 返回当前团队 ID，方便绑定同一 GraphRAG 实例。 */
export default yunshuAccountEntry({
  methods: ['GET'],
  allowUnconfiguredTeam: true,
  handler: async ({ actor, repository }) => {
    await repository.transaction((unit) => unit.assertRoot(actor));
    return YunshuTeamResponseSchema.parse({
      currentTeamId: actor.teamId,
      configuredTeamId:
        process.env.YUNSHU_ADMIN_TEAM_ID === undefined ? null : configuredYunshuTeam()
    });
  }
});
