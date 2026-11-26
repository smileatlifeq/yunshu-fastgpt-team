import { MongoApp } from '../../core/app/schema';
import { MongoDataset } from '../../core/dataset/schema';
import { MongoResourcePermission } from '../permission/schema';
import { MongoMemberGroupModel } from '../permission/memberGroup/memberGroupSchema';
import { resourcePermissionRepo } from '../permission/repository/resourcePermissionRepo';
import {
  PerResourceTypeEnum,
  ReadRoleVal,
  WriteRoleVal
} from '@fastgpt/global/support/permission/constant';
import { sumPer } from '@fastgpt/global/support/permission/utils';
import { DefaultGroupName } from '@fastgpt/global/support/user/team/group/constant';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import type { YunshuActor, YunshuRepository } from './types';
import { isYunshuCollaborationTeam } from './collaborationPolicy';
import { YunshuAccountError } from './utils';

/** root 为绑定团队同步存量资源；只补权限，保留 owner、资源归属、内容和版本。 */
export const synchronizeYunshuCollaboration = async ({
  repository,
  actor
}: {
  repository: YunshuRepository;
  actor: YunshuActor;
}) => {
  await repository.transaction((unit) => unit.assertRoot(actor));
  if (!isYunshuCollaborationTeam(actor.teamId)) {
    throw new YunshuAccountError(
      409,
      'COLLABORATION_DISABLED',
      '请先在服务配置中启用内部团队协作并重启'
    );
  }
  if (!global.agentUserTmbIds) throw new Error('Agent memberships are not initialized');
  const { mongoSessionRun } = await import('../../common/mongo/sessionRun');
  const result = await mongoSessionRun(async (session) => {
    const group = await MongoMemberGroupModel.findOne({
      teamId: actor.teamId,
      name: DefaultGroupName
    })
      .session(session)
      .lean();
    if (!group) throw new Error('The internal team default group is missing');
    const excluded = Array.from(global.agentUserTmbIds!);
    const apps = await MongoApp.find(
      {
        teamId: actor.teamId,
        deleteTime: null,
        type: { $ne: AppTypeEnum.hidden },
        tmbId: { $nin: excluded }
      },
      '_id'
    )
      .session(session)
      .lean();
    const datasets = await MongoDataset.find(
      { teamId: actor.teamId, deleteTime: null, tmbId: { $nin: excluded } },
      '_id'
    )
      .session(session)
      .lean();
    for (const entry of [
      {
        resourceType: PerResourceTypeEnum.app,
        ids: apps.map((item) => String(item._id)),
        role: WriteRoleVal
      },
      {
        resourceType: PerResourceTypeEnum.dataset,
        ids: datasets.map((item) => String(item._id)),
        role: ReadRoleVal
      }
    ]) {
      // 存量个人 ACL 优先于全员组；补足读取/写入，原 owner 和更高权限保持。
      const rows = await MongoResourcePermission.find({
        teamId: actor.teamId,
        resourceType: entry.resourceType,
        resourceId: { $in: entry.ids }
      })
        .session(session)
        .lean();
      for (const row of rows) {
        const permission = sumPer(row.permission, entry.role)!;
        if (permission !== row.permission)
          await MongoResourcePermission.updateOne(
            { _id: row._id, teamId: actor.teamId },
            { $set: { permission } },
            { session }
          );
      }
      const existingGroupIds = new Set(
        rows
          .filter((row) => String(row.groupId) === String(group._id))
          .map((row) => String(row.resourceId))
      );
      await resourcePermissionRepo.grantCollaboratorOnResources({
        teamId: actor.teamId,
        resourceTypes: [entry.resourceType],
        resourceIds: entry.ids.filter((id) => !existingGroupIds.has(id)),
        collaborator: { groupId: String(group._id) },
        permission: entry.role,
        session
      });
    }
    return { enabled: true, apps: apps.length, datasets: datasets.length };
  });
  repository.audit({
    action: 'synchronize_collaboration',
    actorId: actor.userId,
    targetId: actor.teamId,
    revision: 1,
    teamId: actor.teamId,
    ...result
  });
  return result;
};
