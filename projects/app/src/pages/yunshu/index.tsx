import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Heading,
  Input,
  Select,
  Text,
  VStack,
  HStack,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Link,
  Image
} from '@chakra-ui/react';
import { GET, POST } from '@/web/common/api/request';
import { LOGO_ICON } from '@fastgpt/global/common/system/constants';
import { hashStr } from '@fastgpt/global/common/string/tools';
import { checkPasswordRule } from '@fastgpt/global/common/string/password';
import {
  YunshuRoleSchema,
  type YunshuAccountView,
  type YunshuRole
} from '@fastgpt/global/support/yunshu/type';
import type { YunshuListResponse } from '@fastgpt/global/openapi/support/yunshu/api';

/** 单一内部团队的账号入口；复用 FastGPT 原生登录，图谱操作仍由 GraphRAG 独立复核。 */
const YunshuAccounts = () => {
  const [accounts, setAccounts] = useState<YunshuAccountView[]>([]);
  const [team, setTeam] = useState('');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<YunshuRole>('project_admin');
  const [message, setMessage] = useState('正在检查登录和配置…');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [collaboration, setCollaboration] = useState(false);
  const [nextAfterId, setNextAfterId] = useState<string | null>(null);
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});

  /** 刷新当前已配置团队的专用账号，不从浏览器传入团队或管理角色。 */
  const refresh = async () => {
    setReady(false);
    try {
      const context = await GET<{ currentTeamId: string; configuredTeamId: string | null }>(
        '/yunshu/team'
      );
      setTeam(context.configuredTeamId ?? context.currentTeamId);
      if (context.configuredTeamId === null) {
        setMessage(
          '请将下方团队 ID 配置为 YUNSHU_ADMIN_TEAM_ID，并在 GraphRAG 配置同一管理员团队。'
        );
        return;
      }
      const result = await GET<YunshuListResponse>('/yunshu/accounts', { limit: 100 });
      setAccounts(result.items);
      const collaborationState = await GET<{ enabled: boolean }>('/yunshu/collaboration');
      setCollaboration(collaborationState.enabled);
      setNextAfterId(result.nextAfterId);
      setReady(true);
      setMessage(
        collaborationState.enabled
          ? '全员协作已开启：本团队活跃成员均可管理图谱、编辑共享工作流。root 负责账号维护。'
          : 'root 负责账号管理；图谱管理员各自登录后进入图谱工作台。'
      );
    } catch {
      setAccounts([]);
      setNextAfterId(null);
      setMessage('账号管理仅供 root 使用。请先登录 FastGPT；图谱管理员可直接进入图谱工作台。');
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  /** 按后台游标继续读取，避免账号数量超过一页时被界面遗漏。 */
  const loadMore = async () => {
    if (nextAfterId === null) return;
    setBusy(true);
    try {
      const result = await GET<YunshuListResponse>('/yunshu/accounts', {
        limit: 100,
        afterId: nextAfterId
      });
      setAccounts((current) => [...current, ...result.items]);
      setNextAfterId(result.nextAfterId);
    } catch {
      setMessage('读取下一页失败，请刷新后重试。');
    } finally {
      setBusy(false);
    }
  };

  /** 只传递原生单层摘要；成功后立即清空密码，不将其写入页面日志。 */
  const create = async () => {
    if (!checkPasswordRule(password)) {
      setMessage('密码不符合 FastGPT 当前规则，请增加长度和字符种类。');
      return;
    }
    setBusy(true);
    try {
      await POST('/yunshu/accounts', { username, name, password: hashStr(password), role });
      setPassword('');
      setUsername('');
      setName('');
      await refresh();
    } catch {
      setMessage('创建失败，请检查账号名、团队配置或是否重复；提交的密码不会显示。');
    } finally {
      setBusy(false);
    }
  };

  /** 修改携带已读版本；冲突后刷新，防止旧界面覆盖新权限。 */
  const update = async (account: YunshuAccountView, fields: Record<string, unknown>) => {
    setBusy(true);
    try {
      await POST('/yunshu/accounts/' + account.userId, {
        expectedRevision: account.revision,
        ...fields
      });
      await refresh();
    } catch {
      setMessage('修改未完成，账号可能已更新；请刷新后重试。');
    } finally {
      setBusy(false);
    }
  };

  /** 管理员重置成功后清除输入；后台先撤销该用户所有旧会话。 */
  const resetPassword = async (account: YunshuAccountView) => {
    const value = resetPasswords[account.userId] ?? '';
    if (!checkPasswordRule(value)) {
      setMessage('新密码不符合 FastGPT 当前规则。');
      return;
    }
    setBusy(true);
    try {
      await POST('/yunshu/accounts/' + account.userId, {
        expectedRevision: account.revision,
        newPassword: hashStr(value)
      });
      setResetPasswords((current) => ({ ...current, [account.userId]: '' }));
      await refresh();
    } catch {
      setMessage('重置未完成，请刷新账号版本后重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box maxW="1100px" mx="auto" p={8}>
      <HStack justify="space-between">
        <Image src={LOGO_ICON} alt="FastGPT" boxSize={8} />
        <Heading size="lg">云枢图谱 · 账号管理</Heading>
        <Link href="/app/list">返回 FastGPT</Link>
        <Link href="/graphrag/">进入图谱工作台</Link>
      </HStack>
      <Text my={4}>{message}</Text>
      {team !== '' && <Text fontSize="sm">内部团队 ID：{team}</Text>}
      {collaboration && (
        <VStack align="stretch" my={4}>
          <Text>
            共享应用包含保存和发布权限。新建应用自动共享；基础角色不再限制本团队的协作能力。停用账号仍立即阻断访问。
          </Text>
          <Button
            isDisabled={busy || !ready}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await POST<{ apps: number; datasets: number }>(
                  '/yunshu/collaboration'
                );
                setMessage(
                  `权限已同步：${result.apps} 个共享应用、${result.datasets} 个配套知识库。成员刷新页面后可使用。`
                );
              } catch {
                setMessage('权限同步未完成，请刷新后重试。');
              } finally {
                setBusy(false);
              }
            }}
          >
            同步现有共享应用权限
          </Button>
        </VStack>
      )}
      <VStack align="stretch" my={6} opacity={ready ? 1 : 0.6}>
        <Input
          placeholder="账号，例如 yunshu_admin_01"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Input
          placeholder="显示名，例如 云枢图谱·张三"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="初始密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Select
          isDisabled={collaboration}
          value={role}
          onChange={(event) => setRole(YunshuRoleSchema.parse(event.target.value))}
        >
          <option value="project_admin">图谱管理员</option>
          <option value="query_user">查询用户</option>
        </Select>
        <HStack>
          <Button isDisabled={busy || !ready} onClick={() => void create()}>
            创建账号
          </Button>
          <Button isDisabled={busy} onClick={() => void refresh()}>
            刷新
          </Button>
        </HStack>
      </VStack>
      <Table>
        <Thead>
          <Tr>
            <Th>账号</Th>
            <Th>成员名称</Th>
            <Th>角色</Th>
            <Th>状态</Th>
            <Th>管理</Th>
          </Tr>
        </Thead>
        <Tbody>
          {accounts.map((account) => (
            <Tr key={account.userId}>
              <Td>{account.username}</Td>
              <Td>{account.name}</Td>
              <Td>
                {collaboration
                  ? '团队协作成员'
                  : account.role === 'project_admin'
                    ? '图谱管理员'
                    : '查询用户'}
              </Td>
              <Td>{account.enabled ? '启用' : '停用'}</Td>
              <Td>
                <HStack>
                  <Button
                    size="sm"
                    isDisabled={busy}
                    onClick={() => void update(account, { enabled: !account.enabled })}
                  >
                    {account.enabled ? '停用' : '启用'}
                  </Button>
                  {!collaboration && (
                    <Button
                      size="sm"
                      isDisabled={busy}
                      onClick={() =>
                        void update(account, {
                          role: account.role === 'project_admin' ? 'query_user' : 'project_admin'
                        })
                      }
                    >
                      切换角色
                    </Button>
                  )}
                </HStack>
                <HStack mt={2}>
                  <Input
                    type="password"
                    size="sm"
                    autoComplete="new-password"
                    placeholder="新的密码"
                    value={resetPasswords[account.userId] ?? ''}
                    onChange={(event) =>
                      setResetPasswords((current) => ({
                        ...current,
                        [account.userId]: event.target.value
                      }))
                    }
                  />
                  <Button size="sm" isDisabled={busy} onClick={() => void resetPassword(account)}>
                    重置密码
                  </Button>
                </HStack>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      {nextAfterId !== null && (
        <Button mt={4} isDisabled={busy || !ready} onClick={() => void loadMore()}>
          加载更多账号
        </Button>
      )}
    </Box>
  );
};
export default YunshuAccounts;
