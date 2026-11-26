import type {
  YunshuCreateBody,
  YunshuListQuery,
  YunshuUpdateBody
} from '@fastgpt/global/openapi/support/yunshu/api';
import type { YunshuActor, YunshuRepository } from './types';
import { YunshuAccountError } from './utils';

/** 列表只覆盖本模块创建的专用账号，不暴露或管理其他团队用户。 */
export const listYunshuAccounts = async ({
  repository,
  actor,
  query
}: {
  repository: YunshuRepository;
  actor: YunshuActor;
  query: YunshuListQuery;
}) =>
  repository.transaction(async (unit) => {
    await unit.assertRoot(actor);
    const items = await unit.list(actor.teamId, query);
    return {
      teamId: actor.teamId,
      items,
      nextAfterId: items.length === query.limit ? items[items.length - 1].userId : null
    };
  });

/** 原生用户、成员与个人团队 ACL 在一个 Mongo 事务内创建，失败不留下半个账号。 */
export const createYunshuAccount = async ({
  repository,
  actor,
  body
}: {
  repository: YunshuRepository;
  actor: YunshuActor;
  body: YunshuCreateBody;
}) => {
  const account = await repository
    .transaction(async (unit) => {
      await unit.assertRoot(actor);
      return unit.create(actor.teamId, body);
    })
    .catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new YunshuAccountError(409, 'USERNAME_EXISTS', '账号名已存在');
      }
      throw error;
    });
  repository.audit({
    action: 'create',
    actorId: actor.userId,
    targetId: account.userId,
    teamId: actor.teamId,
    revision: account.revision
  });
  return account;
};

/**
 * 在原生用户锁内修改；先撤销旧会话，再提交权限或密码更新。
 * 撤销失败时不改变数据库。提交失败允许用户重新登录，但不会复活旧会话。
 */
export const updateYunshuAccount = async ({
  repository,
  actor,
  userId,
  body
}: {
  repository: YunshuRepository;
  actor: YunshuActor;
  userId: string;
  body: YunshuUpdateBody;
}) =>
  repository.withUserLock(userId, async () => {
    const snapshot = await repository.transaction(async (unit) => {
      await unit.assertRoot(actor);
      const record = await unit.find(userId, actor.teamId);
      if (record === null) throw new YunshuAccountError(404, 'ACCOUNT_NOT_FOUND', '专用账号不存在');
      if (record.meta.revision !== body.expectedRevision) {
        throw new YunshuAccountError(409, 'REVISION_CONFLICT', '账号已更新，请刷新后重试');
      }
      return record;
    });

    const securityChange =
      (body.permissions !== undefined &&
        (body.permissions.skills !== snapshot.view.permissions.skills ||
          body.permissions.mcp !== snapshot.view.permissions.mcp)) ||
      body.newPassword !== undefined ||
      (body.role !== undefined && body.role !== snapshot.view.role) ||
      (body.enabled !== undefined && body.enabled !== snapshot.view.enabled);
    if (securityChange) {
      try {
        await repository.revokeSessions(userId);
      } catch {
        throw new YunshuAccountError(503, 'SESSION_REVOKE_FAILED', '会话服务暂不可用，账号未修改');
      }
    }

    const updated = await repository.transaction(async (unit) => {
      await unit.assertRoot(actor);
      const current = await unit.find(userId, actor.teamId);
      if (current === null)
        throw new YunshuAccountError(404, 'ACCOUNT_NOT_FOUND', '专用账号不存在');
      if (current.meta.revision !== body.expectedRevision) {
        throw new YunshuAccountError(409, 'REVISION_CONFLICT', '账号已更新，请刷新后重试');
      }
      return unit.update(current, body);
    });
    repository.audit({
      action: 'update',
      actorId: actor.userId,
      targetId: userId,
      teamId: actor.teamId,
      revision: updated.revision
    });
    return updated;
  });
