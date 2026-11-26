// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import YunshuAccounts from '../../src/pages/yunshu';
import { yunshuAccountNavigation } from '../../src/web/support/yunshu/navigation';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/web/common/api/request', () => api);
const account = {
  userId: '0123456789abcdef01234567',
  username: 'yunshu_admin_01',
  name: '管理员01',
  teamId: '1123456789abcdef01234567',
  tmbId: '2123456789abcdef01234567',
  role: 'project_admin',
  enabled: true,
  revision: 3,
  createdAt: '2026-11-26T00:00:00.000Z'
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('root 界面展示独立账号，角色修改带已读版本，分页能显示后续账号', async () => {
  api.GET.mockImplementation(async (url: string, params?: { afterId?: string }) => {
    if (url === '/yunshu/team')
      return { currentTeamId: account.teamId, configuredTeamId: account.teamId };
    if (params?.afterId)
      return {
        items: [{ ...account, userId: '3123456789abcdef01234567', username: 'yunshu_admin_02' }],
        nextAfterId: null
      };
    return { items: [account], nextAfterId: account.userId };
  });
  api.POST.mockResolvedValue(account);
  await act(async () =>
    root.render(
      <ChakraProvider>
        <YunshuAccounts />
      </ChakraProvider>
    )
  );
  expect(host.textContent).toContain('yunshu_admin_01');
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((item) => item.textContent === label)!;
  await act(async () => button('切换角色').click());
  expect(api.POST).toHaveBeenCalledWith('/yunshu/accounts/' + account.userId, {
    expectedRevision: 3,
    role: 'query_user'
  });
  await act(async () => button('加载更多账号').click());
  expect(host.textContent).toContain('yunshu_admin_02');
});

it('未获得 root 身份时创建按钮不可用，页面提供登录说明', async () => {
  api.GET.mockRejectedValue(new Error('unauthorized'));
  await act(async () =>
    root.render(
      <ChakraProvider>
        <YunshuAccounts />
      </ChakraProvider>
    )
  );
  expect(host.textContent).toContain('请先登录 FastGPT');
  const create = [...host.querySelectorAll('button')].find(
    (item) => item.textContent === '创建账号'
  )!;
  expect(create.disabled).toBe(true);
  await act(async () => create.click());
  expect(api.POST).not.toHaveBeenCalled();
});

it('root独占侧边栏入口，开发权限修改须明确保存并携带已读版本', async () => {
  expect(yunshuAccountNavigation('root')[0].link).toBe('/yunshu');
  expect(yunshuAccountNavigation('yunshu_admin_01')).toEqual([]);
  api.GET.mockImplementation(async (url: string) => {
    if (url === '/yunshu/team')
      return { currentTeamId: account.teamId, configuredTeamId: account.teamId };
    if (url === '/yunshu/collaboration') return { enabled: true };
    return { items: [{ ...account, permissions: { skills: true, mcp: true } }], nextAfterId: null };
  });
  api.POST.mockResolvedValue(account);
  await act(async () =>
    root.render(
      <ChakraProvider>
        <YunshuAccounts />
      </ChakraProvider>
    )
  );
  const checkbox = host.querySelector<HTMLInputElement>(
    'input[aria-label="yunshu_admin_01技能共同开发"]'
  )!;
  await act(async () => checkbox.click());
  expect(api.POST).not.toHaveBeenCalled();
  const save = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === '保存开发权限'
  )!;
  await act(async () => save.click());
  expect(api.POST).toHaveBeenCalledWith('/yunshu/accounts/' + account.userId, {
    expectedRevision: 3,
    permissions: { skills: false, mcp: true }
  });
});
