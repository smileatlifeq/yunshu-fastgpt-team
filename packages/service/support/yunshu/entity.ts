import { MongoUser } from '../user/schema';
import { MongoTeam } from '../user/team/teamSchema';
import { MongoTeamMember } from '../user/team/teamMemberSchema';
import { MongoResourcePermission } from '../permission/schema';
import { mongoSessionRun } from '../../common/mongo/sessionRun';
import type { ClientSession } from '../../common/mongo';
import { withUserLock } from '../user/lock';
import { delUserAllSession } from '../user/session';
import { getLogger, LogCategories } from '../../common/logger';
import { UserStatusEnum } from '@fastgpt/global/support/user/constant';
import { TeamMemberStatusEnum } from '@fastgpt/global/support/user/team/constant';
import { PerResourceTypeEnum } from '@fastgpt/global/support/permission/constant';
import {
  TeamManageRoleVal,
  TeamReadRoleVal,
  TeamSkillCreateRoleVal,
  TeamMcpCreateRoleVal
} from '@fastgpt/global/support/permission/user/constant';
import {
  YunshuAccountMetaSchema,
  defaultYunshuDevelopmentPermissions,
  type YunshuRole,
  type YunshuDevelopmentPermissions
} from '@fastgpt/global/support/yunshu/type';
import { sumPer } from '@fastgpt/global/support/permission/utils';
import type { YunshuRepository, YunshuUnitOfWork } from './types';
import { YunshuAccountError } from './utils';

/** 按现有 FastGPT 角色位授予团队权限；不把每个新成员设成 owner。 */
export const yunshuRoleValue = (
  role: YunshuRole,
  permissions: YunshuDevelopmentPermissions = defaultYunshuDevelopmentPermissions
) =>
  sumPer(
    role === 'project_admin' ? TeamManageRoleVal : TeamReadRoleVal,
    ...(permissions.skills ? [TeamSkillCreateRoleVal] : []),
    ...(permissions.mcp ? [TeamMcpCreateRoleVal] : [])
  )!;

/** Mongo 适配器复用原生 Schema setter、事务与会话撤销机制。 */
export const createYunshuRepository = (): YunshuRepository => {
  const bind = (session: ClientSession): YunshuUnitOfWork => {
    const find = async (userId: string, teamId: string) => {
      const user = await MongoUser.findOne({
        _id: userId,
        'meta.yunshu.schemaVersion': 1,
        'meta.yunshu.teamId': teamId,
        username: /^yunshu_/
      })
        .session(session)
        .lean();
      if (user === null) return null;
      const parsed = YunshuAccountMetaSchema.safeParse(
        user.meta && 'yunshu' in user.meta ? user.meta.yunshu : undefined
      );
      if (!parsed.success) throw new YunshuAccountError(409, 'INVALID_BINDING', '账号绑定数据异常');
      const meta = parsed.data;
      const member = await MongoTeamMember.findOne({ _id: meta.tmbId, userId, teamId })
        .session(session)
        .lean();
      const acl = await MongoResourcePermission.findOne({
        _id: meta.permissionId,
        tmbId: meta.tmbId,
        teamId,
        resourceType: PerResourceTypeEnum.team,
        resourceId: { $exists: false },
        resourceName: { $exists: false },
        groupId: { $exists: false },
        orgId: { $exists: false }
      })
        .session(session)
        .lean();
      if (
        member === null ||
        acl === null ||
        member.role === 'owner' ||
        acl.permission !== yunshuRoleValue(meta.role, meta.permissions)
      ) {
        throw new YunshuAccountError(409, 'INVALID_BINDING', '账号成员或权限绑定异常');
      }
      return {
        meta,
        view: {
          userId: String(user._id),
          username: user.username,
          name: member.name,
          teamId,
          tmbId: meta.tmbId,
          role: meta.role,
          permissions: meta.permissions ?? { ...defaultYunshuDevelopmentPermissions },
          enabled:
            user.status === UserStatusEnum.active && member.status === TeamMemberStatusEnum.active,
          revision: meta.revision,
          createdAt: new Date(user.createTime).toISOString()
        }
      };
    };

    return {
      /** 同时核验真实 root 账号和该团队所有者，客户端角色与 teamId 不参与授权。 */
      assertRoot: async (actor) => {
        const user = await MongoUser.findById(actor.userId).session(session).lean();
        const team = await MongoTeam.findById(actor.teamId).session(session).lean();
        if (
          user === null ||
          user.username !== 'root' ||
          user.status !== UserStatusEnum.active ||
          team === null ||
          String(team.ownerId) !== actor.userId ||
          team.deleteTime
        ) {
          throw new YunshuAccountError(403, 'ROOT_REQUIRED', '请使用该内部团队的 root 管理账号');
        }
      },
      find,
      list: async (teamId, query) => {
        const rows = await MongoUser.find({
          'meta.yunshu.schemaVersion': 1,
          'meta.yunshu.teamId': teamId,
          username: /^yunshu_/,
          ...(query.afterId === undefined ? {} : { _id: { $lt: query.afterId } })
        })
          .select('_id')
          .sort({ _id: -1 })
          .limit(query.limit)
          .session(session)
          .lean();
        const result = [];
        // 同一事务内不并行使用 session；读取也不包含密码字段。
        for (const row of rows) {
          const account = await find(String(row._id), teamId);
          if (account !== null) result.push(account.view);
        }
        return result;
      },
      create: async (teamId, body) => {
        if (await MongoUser.exists({ username: body.username }).session(session)) {
          throw new YunshuAccountError(409, 'USERNAME_EXISTS', '账号名已存在');
        }
        // password 已为原生浏览器摘要；MongoUser setter 完成原有第二层哈希。
        const [user] = await MongoUser.create(
          [
            {
              username: body.username,
              password: body.password,
              status: UserStatusEnum.active,
              passwordUpdateTime: new Date()
            }
          ],
          { session, ordered: true }
        );
        const [member] = await MongoTeamMember.create(
          [
            {
              teamId,
              userId: user._id,
              name: body.name,
              isSetMemberName: true,
              status: TeamMemberStatusEnum.active
            }
          ],
          { session, ordered: true }
        );
        const [acl] = await MongoResourcePermission.create(
          [
            {
              teamId,
              tmbId: member._id,
              resourceType: PerResourceTypeEnum.team,
              permission: yunshuRoleValue(body.role, body.permissions)
            }
          ],
          { session, ordered: true }
        );
        await MongoUser.updateOne(
          { _id: user._id },
          {
            $set: {
              lastLoginTmbId: member._id,
              'meta.yunshu': {
                schemaVersion: 1,
                teamId,
                tmbId: String(member._id),
                permissionId: String(acl._id),
                role: body.role,
                permissions: body.permissions ?? { ...defaultYunshuDevelopmentPermissions },
                revision: 1
              }
            }
          },
          { session }
        );
        const created = await find(String(user._id), teamId);
        if (created === null) throw new Error('Created account could not be read back');
        return created.view;
      },
      update: async (record, body) => {
        const { meta, view } = record;
        const role = body.role ?? meta.role;
        const permissions =
          body.permissions ?? meta.permissions ?? defaultYunshuDevelopmentPermissions;
        const updated = await MongoUser.updateOne(
          {
            _id: view.userId,
            'meta.yunshu.teamId': meta.teamId,
            'meta.yunshu.revision': body.expectedRevision
          },
          {
            $set: {
              'meta.yunshu.role': role,
              'meta.yunshu.permissions': permissions,
              ...(body.enabled === undefined
                ? {}
                : { status: body.enabled ? UserStatusEnum.active : UserStatusEnum.forbidden }),
              ...(body.newPassword === undefined
                ? {}
                : { password: body.newPassword, passwordUpdateTime: new Date() })
            },
            $inc: { 'meta.yunshu.revision': 1 }
          },
          { session }
        );
        if (updated.matchedCount !== 1)
          throw new YunshuAccountError(409, 'REVISION_CONFLICT', '账号已更新');
        if (body.name !== undefined || body.enabled !== undefined) {
          const member = await MongoTeamMember.updateOne(
            { _id: meta.tmbId, userId: view.userId, teamId: meta.teamId },
            {
              $set: {
                ...(body.name === undefined ? {} : { name: body.name, isSetMemberName: true }),
                ...(body.enabled === undefined
                  ? {}
                  : {
                      status: body.enabled
                        ? TeamMemberStatusEnum.active
                        : TeamMemberStatusEnum.forbidden
                    })
              }
            },
            { session }
          );
          if (member.matchedCount !== 1)
            throw new YunshuAccountError(409, 'INVALID_BINDING', '成员绑定已变化');
        }
        const acl = await MongoResourcePermission.updateOne(
          {
            _id: meta.permissionId,
            teamId: meta.teamId,
            tmbId: meta.tmbId,
            resourceType: PerResourceTypeEnum.team
          },
          { $set: { permission: yunshuRoleValue(role, permissions) } },
          { session }
        );
        if (acl.matchedCount !== 1)
          throw new YunshuAccountError(409, 'INVALID_BINDING', '权限绑定已变化');
        const result = await find(view.userId, meta.teamId);
        if (result === null) throw new Error('Updated account could not be read back');
        return result.view;
      }
    };
  };

  return {
    transaction: (fn) => mongoSessionRun((session) => fn(bind(session))),
    withUserLock,
    revokeSessions: (userId) => delUserAllSession(userId),
    audit: (event) =>
      getLogger(LogCategories.MODULE.USER.ACCOUNT).info('Yunshu account changed', event)
  };
};
