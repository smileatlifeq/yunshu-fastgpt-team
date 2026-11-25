import { z } from 'zod';

export const YunshuRoleSchema = z.enum(['project_admin', 'query_user']).meta({
  description: '图谱管理员可以管理指定内部团队；查询用户不获得团队管理权限。',
  example: 'project_admin'
});
export type YunshuRole = z.infer<typeof YunshuRoleSchema>;

export const YunshuIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/)
  .meta({
    description: 'FastGPT MongoDB 标识，必须为 24 位小写十六进制。',
    example: '0123456789abcdef01234567'
  });

export const YunshuAccountMetaSchema = z
  .object({
    schemaVersion: z.literal(1),
    teamId: YunshuIdSchema,
    tmbId: YunshuIdSchema,
    permissionId: YunshuIdSchema,
    role: YunshuRoleSchema,
    revision: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER - 1)
  })
  .strict();
export type YunshuAccountMeta = z.infer<typeof YunshuAccountMetaSchema>;

export const YunshuAccountViewSchema = z
  .object({
    userId: YunshuIdSchema,
    username: z.string().meta({ description: '专用登录账号', example: 'yunshu_admin_01' }),
    name: z.string().meta({ description: '团队成员显示名称', example: '云枢图谱·管理员01' }),
    teamId: YunshuIdSchema,
    tmbId: YunshuIdSchema,
    role: YunshuRoleSchema,
    enabled: z.boolean().meta({ description: '用户和团队成员均处于启用状态', example: true }),
    revision: z.number().int().positive().meta({ description: '账号修改版本', example: 1 }),
    createdAt: z.iso
      .datetime()
      .meta({ description: '账号创建时间，UTC', example: '2026-11-26T00:00:00.000Z' })
  })
  .strict();
export type YunshuAccountView = z.infer<typeof YunshuAccountViewSchema>;
