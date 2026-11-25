import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRootUser } from '@test/datas/users';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { MongoTeamMember } from '@fastgpt/service/support/user/team/teamMemberSchema';
import { MongoResourcePermission } from '@fastgpt/service/support/permission/schema';
import { TeamPermission } from '@fastgpt/global/support/permission/user/controller';
import { hashStr } from '@fastgpt/global/common/string/tools';
import {
  YunshuCreateBodySchema,
  YunshuUpdateBodySchema
} from '@fastgpt/global/openapi/support/yunshu/api';
import { YunshuAccountViewSchema } from '@fastgpt/global/support/yunshu/type';
import { createYunshuRepository } from '@fastgpt/service/support/yunshu/entity';
import {
  createYunshuAccount,
  listYunshuAccounts,
  updateYunshuAccount
} from '@fastgpt/service/support/yunshu/service';
import { assertYunshuOrigin, configuredYunshuTeam } from '@fastgpt/service/support/yunshu/utils';

// 此文件验证原子性，必须恢复真实事务；通用测试 setup 默认关闭 Mongo 事务。
vi.unmock('@fastgpt/service/common/mongo/sessionRun');

describe('云枢内部账号事务与权限', () => {
  const body = {
    username: 'yunshu_admin_01',
    name: '图谱管理员01',
    password: hashStr('a-test-password'),
    role: 'project_admin' as const
  };
  const repository = createYunshuRepository();
  let actor: { userId: string; teamId: string };

  beforeEach(async () => {
    actor = await getRootUser();
    vi.restoreAllMocks();
  });

  it('严格拒绝伪造角色、额外字段和非布尔启停值', () => {
    for (const fields of [
      { role: 'owner' },
      { userId: actor.userId },
      { teamId: actor.teamId },
      { isRoot: true }
    ]) {
      expect(YunshuCreateBodySchema.safeParse({ ...body, ...fields }).success).toBe(false);
    }
    for (const enabled of ['false', 0, 1, null]) {
      expect(YunshuUpdateBodySchema.safeParse({ expectedRevision: 1, enabled }).success).toBe(
        false
      );
    }
    expect(YunshuUpdateBodySchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
  });

  it('固定团队与来源配置，公网 HTTP、通配来源和缺少 Origin 均被拒绝', () => {
    vi.stubEnv('YUNSHU_ADMIN_TEAM_ID', actor.teamId);
    expect(configuredYunshuTeam()).toBe(actor.teamId);
    vi.stubEnv('YUNSHU_ADMIN_ORIGINS', 'https://yunshu.example.com,http://127.0.0.1:3040');
    expect(() => assertYunshuOrigin('http://127.0.0.1:3040')).not.toThrow();
    for (const origin of [undefined, 'https://evil.example.com', ['https://yunshu.example.com']]) {
      expect(() => assertYunshuOrigin(origin)).toThrow();
    }
    for (const origin of ['*', 'http://yunshu.example.com', 'https://yunshu.example.com/path']) {
      vi.stubEnv('YUNSHU_ADMIN_ORIGINS', origin);
      expect(() => assertYunshuOrigin(origin)).toThrow();
    }
    vi.unstubAllEnvs();
  });

  it('用户、成员与 ACL 共同创建，原生权限允许管理但不授予 owner', async () => {
    const account = await createYunshuAccount({ repository, actor, body });
    const member = await MongoTeamMember.findById(account.tmbId).lean();
    const user = await MongoUser.findById(account.userId).lean();
    const acl = await MongoResourcePermission.findOne({ tmbId: account.tmbId }).lean();
    expect(member?.role).not.toBe('owner');
    expect(new TeamPermission({ role: acl!.permission }).hasManagePer).toBe(true);
    expect(YunshuAccountViewSchema.parse(account)).toEqual(account);
    expect(JSON.stringify(account)).not.toContain('password');
    expect(String(user?.lastLoginTmbId)).toBe(account.tmbId);
    const stored = await MongoUser.collection.findOne({ username: body.username });
    expect(stored?.password).toBe(hashStr(body.password));
  });

  it('成员创建失败回滚，重复用户名不留下额外成员或 ACL', async () => {
    const before = [
      await MongoUser.countDocuments(),
      await MongoTeamMember.countDocuments(),
      await MongoResourcePermission.countDocuments()
    ];
    const failure = vi
      .spyOn(MongoTeamMember, 'create')
      .mockRejectedValueOnce(new Error('injected failure'));
    await expect(createYunshuAccount({ repository, actor, body })).rejects.toThrow(
      'injected failure'
    );
    failure.mockRestore();
    expect([
      await MongoUser.countDocuments(),
      await MongoTeamMember.countDocuments(),
      await MongoResourcePermission.countDocuments()
    ]).toEqual(before);
    await createYunshuAccount({ repository, actor, body });
    const createdCounts = [
      await MongoUser.countDocuments(),
      await MongoTeamMember.countDocuments(),
      await MongoResourcePermission.countDocuments()
    ];
    await expect(createYunshuAccount({ repository, actor, body })).rejects.toMatchObject({
      status: 409
    });
    expect([
      await MongoUser.countDocuments(),
      await MongoTeamMember.countDocuments(),
      await MongoResourcePermission.countDocuments()
    ]).toEqual(createdCounts);
  });

  it('非 root、已停用 root 和不属于 root 的团队被数据库授权拒绝', async () => {
    const account = await createYunshuAccount({ repository, actor, body });
    await expect(
      createYunshuAccount({
        repository,
        actor: { ...actor, userId: account.userId },
        body: { ...body, username: 'yunshu_admin_02' }
      })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      listYunshuAccounts({
        repository,
        actor: { ...actor, teamId: account.userId },
        query: { limit: 10 }
      })
    ).rejects.toMatchObject({ status: 403 });
    await MongoUser.updateOne({ _id: actor.userId }, { $set: { status: 'forbidden' } });
    await expect(
      listYunshuAccounts({ repository, actor, query: { limit: 10 } })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('撤销会话失败时不提交更新；旧版本修改也不能覆盖账号', async () => {
    const account = await createYunshuAccount({ repository, actor, body });
    const revoke = vi
      .spyOn(repository, 'revokeSessions')
      .mockRejectedValue(new Error('redis unavailable'));
    await expect(
      updateYunshuAccount({
        repository,
        actor,
        userId: account.userId,
        body: { expectedRevision: 1, enabled: false }
      })
    ).rejects.toMatchObject({ status: 503 });
    const first = await listYunshuAccounts({ repository, actor, query: { limit: 10 } });
    expect(first.items[0]).toMatchObject({ revision: 1, enabled: true });
    revoke.mockResolvedValue(undefined);
    await updateYunshuAccount({
      repository,
      actor,
      userId: account.userId,
      body: { expectedRevision: 1, role: 'query_user' }
    });
    await expect(
      updateYunshuAccount({
        repository,
        actor,
        userId: account.userId,
        body: { expectedRevision: 1, enabled: false }
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('降权和单独改密可成功，查询角色不获得管理权；审计事件没有密码', async () => {
    const audit = vi.spyOn(repository, 'audit');
    const revoke = vi.spyOn(repository, 'revokeSessions').mockResolvedValue(undefined);
    const account = await createYunshuAccount({ repository, actor, body });
    const reader = await updateYunshuAccount({
      repository,
      actor,
      userId: account.userId,
      body: { expectedRevision: 1, role: 'query_user' }
    });
    expect(reader).toMatchObject({ revision: 2, role: 'query_user' });
    const acl = await MongoResourcePermission.findOne({ tmbId: account.tmbId }).lean();
    expect(new TeamPermission({ role: acl!.permission }).hasManagePer).toBe(false);
    const newPassword = hashStr('a-new-test-password');
    const updated = await updateYunshuAccount({
      repository,
      actor,
      userId: account.userId,
      body: { expectedRevision: 2, newPassword }
    });
    expect(updated.revision).toBe(3);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(newPassword);
    const stored = await MongoUser.findOne({ _id: account.userId, password: newPassword });
    expect(stored).not.toBeNull();
  });
});
