import { SkillPermission } from '@fastgpt/global/support/permission/skill/controller';
import { ReadRoleVal } from '@fastgpt/global/support/permission/constant';
import { isYunshuManagedTeam } from './collaborationPolicy';

/** 内部真人成员的开发限制独立于自动共享开关；系统 Agent 保留原生私有资源行为。 */
export const isYunshuSkillReadOnly = (
  teamId: string,
  tmbId: string,
  team: { isOwner: boolean; hasSkillCreatePer?: boolean }
) =>
  isYunshuManagedTeam(teamId) &&
  !team.isOwner &&
  !team.hasSkillCreatePer &&
  !global.agentUserTmbIds?.has(tmbId);

/** 列表和详情展示与后台写入校验一致；撤销开发能力后仍可使用已共享的技能。 */
export const yunshuSkillViewPermission = (
  teamId: string,
  tmbId: string,
  team: { isOwner: boolean; hasSkillCreatePer?: boolean },
  resource: SkillPermission
) =>
  isYunshuSkillReadOnly(teamId, tmbId, team) && resource.hasReadPer
    ? new SkillPermission({ role: ReadRoleVal })
    : resource;
