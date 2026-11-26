import type { TeamPermission } from '@fastgpt/global/support/permission/user/controller';
import { isYunshuCollaborationTeam } from './collaborationPolicy';

type Member = { teamId: string; tmbId: string; permission: TeamPermission };

/** 专用开发角色只共享本团队真人创建的普通 MCP，不开放代理授权和系统 Agent 凭据。 */
export const canCollaborateYunshuMcp = ({ teamId, tmbId, permission }: Member) =>
  isYunshuCollaborationTeam(teamId) &&
  permission.hasMcpCreatePer &&
  global.agentUserTmbIds !== undefined &&
  !global.agentUserTmbIds.has(tmbId);

/** 列表与单项鉴权共用同一归属边界；未授权者仍按原创建者范围读取。 */
export const yunshuMcpListFilter = (member: Member) => {
  if (!canCollaborateYunshuMcp(member)) return { teamId: member.teamId, tmbId: member.tmbId };
  return {
    teamId: member.teamId,
    $or: [
      { tmbId: member.tmbId },
      { authProxy: { $ne: true }, tmbId: { $nin: Array.from(global.agentUserTmbIds!) } }
    ]
  };
};

/** 保留创建者；共享成员只能维护普通服务，原创建者和原生 APIKey 角色保持原读取行为。 */
export const canManageYunshuMcp = (
  member: Member,
  mcp: { teamId: unknown; tmbId: unknown; authProxy?: boolean }
) =>
  String(mcp.teamId) === member.teamId &&
  canCollaborateYunshuMcp(member) &&
  !mcp.authProxy &&
  !global.agentUserTmbIds!.has(String(mcp.tmbId));
