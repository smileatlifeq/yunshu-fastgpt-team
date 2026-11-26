import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRootUser } from '@test/datas/users';
import { serviceEnv } from '@fastgpt/service/env';
import { MongoApp } from '@fastgpt/service/core/app/schema';
import { MongoMemberGroupModel } from '@fastgpt/service/support/permission/memberGroup/memberGroupSchema';
import { MongoResourcePermission } from '@fastgpt/service/support/permission/schema';
import { MongoTeamMember } from '@fastgpt/service/support/user/team/teamMemberSchema';
import { MongoTeam } from '@fastgpt/service/support/user/team/teamSchema';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { getTmbInfoByTmbId } from '@fastgpt/service/support/user/team/controller';
import { authAppByTmbId } from '@fastgpt/service/support/permission/app/auth';
import { createResourcePermissions } from '@fastgpt/service/support/permission/resourcePermissionService';
import { createYunshuRepository } from '@fastgpt/service/support/yunshu/entity';
import { synchronizeYunshuCollaboration } from '@fastgpt/service/support/yunshu/collaboration';
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { DefaultGroupName } from '@fastgpt/global/support/user/team/group/constant';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import {
  OwnerRoleVal,
  PerResourceTypeEnum,
  ReadRoleVal,
  WritePermissionVal
} from '@fastgpt/global/support/permission/constant';

vi.unmock('@fastgpt/service/common/mongo/sessionRun');

describe('内部团队全员图谱与工作流协作', () => {
  let root: Awaited<ReturnType<typeof getRootUser>>;
  let member: { userId: string; teamId: string; tmbId: string };
  const originalEnabled = serviceEnv.YUNSHU_TEAM_COLLABORATION_ENABLED;
  beforeEach(async () => {
    root = await getRootUser();
    const memberUser = await MongoUser.create({
      username: 'collaboration_member',
      password: '123456'
    });
    const memberTmb = await MongoTeamMember.create({
      teamId: root.teamId,
      userId: memberUser._id,
      name: '协作成员',
      status: 'active'
    });
    member = { userId: String(memberUser._id), teamId: root.teamId, tmbId: String(memberTmb._id) };
    await MongoMemberGroupModel.create({ teamId: root.teamId, name: DefaultGroupName });
    global.agentUserTmbIds = new Set();
    serviceEnv.YUNSHU_TEAM_COLLABORATION_ENABLED = true;
    vi.stubEnv('YUNSHU_ADMIN_TEAM_ID', root.teamId);
  });
  afterEach(() => {
    serviceEnv.YUNSHU_TEAM_COLLABORATION_ENABLED = originalEnabled;
    vi.unstubAllEnvs();
  });
  const createApp = async (owner = root.tmbId) =>
    MongoApp.create({
      teamId: root.teamId,
      tmbId: owner,
      name: '共享工作流',
      type: AppTypeEnum.workflow,
      modules: []
    });

  it('活跃成员获得团队管理及创建应用能力，停用和其他团队不获得', async () => {
    const info = await getTmbInfoByTmbId({ tmbId: member.tmbId });
    expect(info.permission.hasManagePer).toBe(true);
    expect(info.permission.hasAppCreatePer).toBe(true);
    expect(info.permission.isOwner).toBe(false);
    await MongoTeamMember.updateOne({ _id: member.tmbId }, { status: 'forbidden' });
    await expect(getTmbInfoByTmbId({ tmbId: member.tmbId })).rejects.toBeDefined();
    const outsiderUser = await MongoUser.create({ username: 'other_team', password: '123456' });
    const outsider = await MongoTeam.create({ name: '外部团队', ownerId: outsiderUser._id });
    const outsiderTmb = await MongoTeamMember.create({
      teamId: outsider._id,
      userId: outsiderUser._id,
      name: '外部成员',
      status: 'active'
    });
    expect((await getTmbInfoByTmbId({ tmbId: String(outsiderTmb._id) })).teamId).not.toBe(
      root.teamId
    );
  });

  it('root 同步旧应用后独立成员可编辑，个人读取 ACL 不阻断，原 owner 保持', async () => {
    const app = await createApp();
    await MongoResourcePermission.create([
      {
        teamId: root.teamId,
        resourceType: PerResourceTypeEnum.app,
        resourceId: app._id,
        tmbId: root.tmbId,
        permission: OwnerRoleVal
      },
      {
        teamId: root.teamId,
        resourceType: PerResourceTypeEnum.app,
        resourceId: app._id,
        tmbId: member.tmbId,
        permission: ReadRoleVal
      }
    ]);
    await synchronizeYunshuCollaboration({ repository: createYunshuRepository(), actor: root });
    const allowed = await authAppByTmbId({
      appId: String(app._id),
      tmbId: member.tmbId,
      per: WritePermissionVal
    });
    expect(allowed.app.permission.hasWritePer).toBe(true);
    expect(allowed.app.permission.isOwner).toBe(false);
    expect(
      (await MongoResourcePermission.findOne({ resourceId: app._id, tmbId: root.tmbId }))
        ?.permission
    ).toBe(OwnerRoleVal);
    await expect(
      synchronizeYunshuCollaboration({ repository: createYunshuRepository(), actor: member })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('新建应用自动共享，新加入成员无需逐个补应用 ACL', async () => {
    const app = await createApp();
    await mongoSessionRun((session) =>
      createResourcePermissions({
        resource: app,
        resourceType: PerResourceTypeEnum.app,
        tmbId: root.tmbId,
        session
      })
    );
    const lateUser = await MongoUser.create({ username: 'new_collaborator', password: '123456' });
    const lateTmb = await MongoTeamMember.create({
      teamId: root.teamId,
      userId: lateUser._id,
      name: '新成员',
      status: 'active'
    });
    expect(
      (
        await authAppByTmbId({
          appId: String(app._id),
          tmbId: String(lateTmb._id),
          per: WritePermissionVal
        })
      ).app.permission.hasWritePer
    ).toBe(true);
    const outsiderUser = await MongoUser.create({
      username: 'external_member',
      password: '123456'
    });
    const outsiderTeam = await MongoTeam.create({ name: '外部团队', ownerId: outsiderUser._id });
    const outsiderTmb = await MongoTeamMember.create({
      teamId: outsiderTeam._id,
      userId: outsiderUser._id,
      name: '外部成员',
      status: 'active'
    });
    await expect(
      authAppByTmbId({
        appId: String(app._id),
        tmbId: String(outsiderTmb._id),
        per: WritePermissionVal
      })
    ).rejects.toBeDefined();
  });

  it('关闭开关维持原权限，系统 Agent 私有应用不共享', async () => {
    const app = await createApp();
    global.agentUserTmbIds = new Set([root.tmbId]);
    await mongoSessionRun((session) =>
      createResourcePermissions({
        resource: app,
        resourceType: PerResourceTypeEnum.app,
        tmbId: root.tmbId,
        session
      })
    );
    await synchronizeYunshuCollaboration({ repository: createYunshuRepository(), actor: root });
    await expect(
      authAppByTmbId({ appId: String(app._id), tmbId: member.tmbId, per: WritePermissionVal })
    ).rejects.toBeDefined();
    serviceEnv.YUNSHU_TEAM_COLLABORATION_ENABLED = false;
    expect((await getTmbInfoByTmbId({ tmbId: member.tmbId })).permission.hasManagePer).toBe(false);
    await expect(
      synchronizeYunshuCollaboration({ repository: createYunshuRepository(), actor: root })
    ).rejects.toMatchObject({ status: 409 });
  });
});
