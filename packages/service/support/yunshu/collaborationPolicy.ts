import { serviceEnv } from '../../env';
import type { ClientSession } from '../../common/mongo';
import {
  PerResourceTypeEnum,
  ReadRoleVal,
  WriteRoleVal
} from '@fastgpt/global/support/permission/constant';
import { DefaultGroupName } from '@fastgpt/global/support/user/team/group/constant';
import { MongoMemberGroupModel } from '../permission/memberGroup/memberGroupSchema';
import type { CollaboratorItemType } from '@fastgpt/global/support/permission/collaborator';

/** 全员协作只作用于部署明确绑定的内部团队，不改变其他团队或系统 root 权限。 */
export const isYunshuManagedTeam = (teamId: string) =>
  /^[a-f0-9]{24}$/.test(process.env.YUNSHU_ADMIN_TEAM_ID ?? '') &&
  String(teamId) === process.env.YUNSHU_ADMIN_TEAM_ID;

/** 共享开关控制自动补权，不取消 root 已经保存的单个成员开发限制。 */
export const isYunshuCollaborationTeam = (teamId: string) =>
  serviceEnv.YUNSHU_TEAM_COLLABORATION_ENABLED && isYunshuManagedTeam(teamId);

/** 共享应用及技能可编辑，配套知识库可读取；系统 Agent 的私有资源保持原授权。 */
export const getYunshuSharedCollaborator = async ({
  teamId,
  resourceType,
  ownerTmbId,
  session
}: {
  teamId: string;
  resourceType: PerResourceTypeEnum;
  ownerTmbId: string;
  session: ClientSession;
}): Promise<CollaboratorItemType | undefined> => {
  if (!isYunshuCollaborationTeam(teamId)) return;
  if (
    resourceType !== PerResourceTypeEnum.app &&
    resourceType !== PerResourceTypeEnum.dataset &&
    resourceType !== PerResourceTypeEnum.agentSkill
  )
    return;
  if (!global.agentUserTmbIds) throw new Error('Agent memberships are not initialized');
  if (global.agentUserTmbIds.has(String(ownerTmbId))) return;
  const group = await MongoMemberGroupModel.findOne({ teamId, name: DefaultGroupName })
    .session(session)
    .lean();
  if (!group) throw new Error('The internal team default group is missing');
  return {
    groupId: String(group._id),
    permission: resourceType === PerResourceTypeEnum.dataset ? ReadRoleVal : WriteRoleVal
  };
};
