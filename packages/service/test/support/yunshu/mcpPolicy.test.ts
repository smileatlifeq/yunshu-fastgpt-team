import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { serviceEnv } from '@fastgpt/service/env';
import { TeamPermission } from '@fastgpt/global/support/permission/user/controller';
import {
  TeamMcpCreateRoleVal,
  TeamReadRoleVal
} from '@fastgpt/global/support/permission/user/constant';
import { ReadPermissionVal, WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import { canManageYunshuMcp, yunshuMcpListFilter } from '@fastgpt/service/support/yunshu/mcpPolicy';
const mocks = vi.hoisted(() => ({ user: vi.fn(), find: vi.fn() }));
vi.mock('@fastgpt/service/support/permission/user/auth', () => ({ authUserPer: mocks.user }));
vi.mock('@fastgpt/service/support/mcp/schema', () => ({ MongoMcpKey: { findOne: mocks.find } }));
import { authMcp } from '@fastgpt/service/support/permission/mcp/auth';
import { yunshuSkillViewPermission } from '@fastgpt/service/support/yunshu/skillPolicy';
import { SkillPermission } from '@fastgpt/global/support/permission/skill/controller';

const teamId = '1123456789abcdef01234567';
const oldEnabled = serviceEnv.YUNSHU_TEAM_COLLABORATION_ENABLED;
const member = () => ({
  teamId,
  tmbId: 'member',
  permission: new TeamPermission({ role: TeamMcpCreateRoleVal })
});
beforeEach(() => {
  serviceEnv.YUNSHU_TEAM_COLLABORATION_ENABLED = true;
  vi.stubEnv('YUNSHU_ADMIN_TEAM_ID', teamId);
  global.agentUserTmbIds = new Set(['agent']);
  mocks.user.mockResolvedValue(member());
  mocks.find.mockReturnValue({
    lean: async () => ({ teamId, tmbId: 'colleague', authProxy: false })
  });
});
afterEach(() => {
  serviceEnv.YUNSHU_TEAM_COLLABORATION_ENABLED = oldEnabled;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('MCP开发角色与API密钥创建分离，可跨成员读取、修改普通服务', async () => {
  expect(member().permission.hasMcpCreatePer).toBe(true);
  expect(member().permission.hasApikeyCreatePer).toBe(false);
  expect(yunshuMcpListFilter(member())).toHaveProperty('$or');
  await expect(
    authMcp({ req: {} as never, mcpId: 'mcp', per: WritePermissionVal })
  ).resolves.toHaveProperty('mcp.tmbId', 'colleague');
});
it('其他团队、代理授权和Agent私有服务保持拒绝', () => {
  for (const resource of [
    { teamId: 'other', tmbId: 'colleague' },
    { teamId, tmbId: 'colleague', authProxy: true },
    { teamId, tmbId: 'agent' }
  ]) {
    expect(canManageYunshuMcp(member(), resource)).toBe(false);
  }
});
it('收回MCP开发后不能查看同事服务或修改本人服务，原本人读取保持', async () => {
  const disabled = { ...member(), permission: new TeamPermission({ role: TeamReadRoleVal }) };
  mocks.user.mockResolvedValue(disabled);
  expect(yunshuMcpListFilter(disabled)).toEqual({ teamId, tmbId: 'member' });
  await expect(
    authMcp({ req: {} as never, mcpId: 'mcp', per: ReadPermissionVal })
  ).rejects.toBeDefined();
  mocks.find.mockReturnValue({ lean: async () => ({ teamId, tmbId: 'member' }) });
  await expect(
    authMcp({ req: {} as never, mcpId: 'mcp', per: WritePermissionVal })
  ).rejects.toBeDefined();
  await expect(
    authMcp({ req: {} as never, mcpId: 'mcp', per: ReadPermissionVal })
  ).resolves.toHaveProperty('mcp');
});

it('关闭自动共享仍保留开发限制，系统Agent私有资源的原生行为保持', async () => {
  serviceEnv.YUNSHU_TEAM_COLLABORATION_ENABLED = false;
  mocks.find.mockReturnValue({ lean: async () => ({ teamId, tmbId: 'member' }) });
  mocks.user.mockResolvedValue({
    ...member(),
    permission: new TeamPermission({ role: TeamReadRoleVal })
  });
  await expect(
    authMcp({ req: {} as never, mcpId: 'mcp', per: WritePermissionVal })
  ).rejects.toBeDefined();
  mocks.find.mockReturnValue({ lean: async () => ({ teamId, tmbId: 'agent' }) });
  mocks.user.mockResolvedValue({
    ...member(),
    tmbId: 'agent',
    permission: new TeamPermission({ role: TeamReadRoleVal })
  });
  await expect(
    authMcp({ req: {} as never, mcpId: 'mcp', per: WritePermissionVal })
  ).resolves.toHaveProperty('mcp');
});

it('技能权限收回不依赖自动共享开关，系统Agent私有技能保持原行为', () => {
  serviceEnv.YUNSHU_TEAM_COLLABORATION_ENABLED = false;
  const team = { isOwner: false, hasSkillCreatePer: false };
  const owner = new SkillPermission({ isOwner: true });
  expect(yunshuSkillViewPermission(teamId, 'member', team, owner).hasWritePer).toBe(false);
  expect(yunshuSkillViewPermission(teamId, 'agent', team, owner).isOwner).toBe(true);
});
