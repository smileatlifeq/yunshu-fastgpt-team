import { z } from 'zod';
import { IntSchema } from '../../../common/zod';
import {
  YunshuAccountViewSchema,
  YunshuIdSchema,
  YunshuRoleSchema,
  YunshuDevelopmentPermissionsSchema
} from '../../../support/yunshu/type';

const passwordDigest = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .meta({
    description: '浏览器按照 FastGPT 原有协议生成的单层 SHA256 摘要；不能返回或记录。',
    example: 'f'.repeat(64)
  });

export const YunshuListQuerySchema = z
  .object({
    limit: IntSchema.min(1).max(100).default(50).meta({ description: '每页账号数量', example: 50 }),
    afterId: YunshuIdSchema.optional().meta({
      description: '上一页最后一个用户 ID；按 ID 降序继续读取'
    })
  })
  .strict();
export type YunshuListQuery = z.infer<typeof YunshuListQuerySchema>;

export const YunshuCreateBodySchema = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^yunshu_[a-z0-9_]{2,73}$/)
      .meta({
        description: '专用账号名，以 yunshu_ 开头，只允许小写字母、数字和下划线。',
        example: 'yunshu_admin_01'
      }),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .meta({ description: '成员显示名称', example: '云枢图谱·管理员01' }),
    password: passwordDigest,
    role: YunshuRoleSchema,
    permissions: YunshuDevelopmentPermissionsSchema.optional()
  })
  .strict();
export type YunshuCreateBody = z.infer<typeof YunshuCreateBodySchema>;

export const YunshuAccountQuerySchema = z.object({ userId: YunshuIdSchema }).strict();
export type YunshuAccountQuery = z.infer<typeof YunshuAccountQuerySchema>;

export const YunshuUpdateBodySchema = z
  .object({
    expectedRevision: IntSchema.min(1)
      .max(Number.MAX_SAFE_INTEGER - 1)
      .meta({
        description: '界面读取到的账号版本；过期修改被拒绝，防止覆盖其他操作。',
        example: 1
      }),
    name: z.string().trim().min(1).max(80).optional().meta({ description: '新的成员显示名称' }),
    role: YunshuRoleSchema.optional(),
    permissions: YunshuDevelopmentPermissionsSchema.optional(),
    // 权限相关停用字段严格拒绝字符串和数字，避免真假值解释不同。
    enabled: z
      .boolean()
      .optional()
      .meta({ description: '是否启用账号，必须为 JSON 布尔值', example: false }),
    newPassword: passwordDigest.optional()
  })
  .strict()
  .refine(
    (body) =>
      body.name !== undefined ||
      body.role !== undefined ||
      body.permissions !== undefined ||
      body.enabled !== undefined ||
      body.newPassword !== undefined,
    '至少提供一个修改字段'
  );
export type YunshuUpdateBody = z.infer<typeof YunshuUpdateBodySchema>;

export const YunshuListResponseSchema = z
  .object({
    teamId: YunshuIdSchema,
    items: z.array(YunshuAccountViewSchema).meta({ description: '当前页的专用账号' }),
    nextAfterId: YunshuIdSchema.nullable().meta({ description: '下一页游标；null 表示读取结束' })
  })
  .strict();
export type YunshuListResponse = z.infer<typeof YunshuListResponseSchema>;

export const YunshuTeamResponseSchema = z
  .object({
    currentTeamId: YunshuIdSchema.meta({ description: 'root 当前登录团队 ID' }),
    configuredTeamId: YunshuIdSchema.nullable().meta({
      description: '配置的图谱管理团队 ID，尚未配置时为 null'
    })
  })
  .strict();

export const YunshuCollaborationResponseSchema = z
  .object({
    enabled: z.boolean().meta({ description: '指定内部团队是否启用全员协作', example: true }),
    apps: IntSchema.min(0).optional().meta({ description: '本次同步的共享应用数量', example: 2 }),
    datasets: IntSchema.min(0)
      .optional()
      .meta({ description: '本次同步的配套知识库数量', example: 1 }),
    skills: IntSchema.min(0)
      .optional()
      .meta({ description: '本次同步的共享技能与目录数量', example: 1 })
  })
  .strict();
