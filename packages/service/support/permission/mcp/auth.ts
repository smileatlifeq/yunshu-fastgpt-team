import { type PermissionValueType } from '@fastgpt/global/support/permission/type';
import { type AuthModeType, type AuthResponseType } from '../type';
import { type McpKeyType } from '@fastgpt/global/support/mcp/type';
import { authUserPer } from '../user/auth';
import { MongoMcpKey } from '../../mcp/schema';
import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';
import { TeamErrEnum } from '@fastgpt/global/common/error/code/team';
import {
  WritePermissionVal,
  ManagePermissionVal
} from '@fastgpt/global/support/permission/constant';
import { isYunshuManagedTeam } from '../../yunshu/collaborationPolicy';
import { canManageYunshuMcp } from '../../yunshu/mcpPolicy';

export const authMcp = async ({
  mcpId,
  per,
  ...props
}: AuthModeType & {
  mcpId: string;
  per: PermissionValueType;
}): Promise<
  AuthResponseType & {
    mcp: McpKeyType;
  }
> => {
  const { userId, teamId, tmbId, permission, isRoot } = await authUserPer(props);

  const mcp = await MongoMcpKey.findOne({ _id: mcpId }).lean();

  if (!mcp) {
    return Promise.reject(CommonErrEnum.invalidResource);
  }

  if (teamId !== String(mcp.teamId)) {
    return Promise.reject(TeamErrEnum.unPermission);
  }

  const shared = canManageYunshuMcp({ teamId, tmbId, permission }, mcp);
  if (tmbId !== String(mcp.tmbId) && !shared) {
    return Promise.reject(TeamErrEnum.unPermission);
  }
  if (
    isYunshuManagedTeam(teamId) &&
    !global.agentUserTmbIds?.has(tmbId) &&
    !permission.hasApikeyCreatePer &&
    !permission.hasMcpCreatePer &&
    (per & (WritePermissionVal | ManagePermissionVal)) !== 0
  ) {
    return Promise.reject(TeamErrEnum.unPermission);
  }

  return {
    mcp,
    userId,
    teamId,
    tmbId,
    isRoot,
    permission
  };
};
