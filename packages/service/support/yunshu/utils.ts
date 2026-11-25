export class YunshuAccountError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'YunshuAccountError';
  }
}

/** 固定一个由操作员配置的内部团队，禁止请求体选择任意团队。 */
export const configuredYunshuTeam = () => {
  const teamId = process.env.YUNSHU_ADMIN_TEAM_ID;
  if (teamId === undefined || !/^[a-f0-9]{24}$/.test(teamId)) {
    throw new YunshuAccountError(503, 'TEAM_NOT_CONFIGURED', '尚未配置云枢图谱内部团队');
  }
  return teamId;
};

/** 账号变更需要明确来源；不依赖全局 CSRF 开关或客户端提供的角色。 */
export const assertYunshuOrigin = (origin: string | string[] | undefined) => {
  const origins = (process.env.YUNSHU_ADMIN_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new YunshuAccountError(503, 'ORIGINS_NOT_CONFIGURED', '尚未配置管理入口来源');
  }
  for (const value of origins) {
    try {
      const parsed = new URL(value);
      const localHttp =
        parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if (
        !(parsed.protocol === 'https:' || localHttp) ||
        parsed.origin !== value ||
        parsed.username !== '' ||
        parsed.password !== ''
      )
        throw new Error('invalid origin');
    } catch {
      throw new YunshuAccountError(503, 'INVALID_ORIGIN_CONFIG', '管理入口来源配置无效');
    }
  }
  if (typeof origin !== 'string' || !origins.includes(origin)) {
    throw new YunshuAccountError(403, 'ORIGIN_REJECTED', '请求来源未获允许');
  }
};
