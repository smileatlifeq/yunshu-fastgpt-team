import type { YunshuAccountMeta, YunshuAccountView } from '@fastgpt/global/support/yunshu/type';
import type {
  YunshuCreateBody,
  YunshuListQuery,
  YunshuUpdateBody
} from '@fastgpt/global/openapi/support/yunshu/api';

export type YunshuActor = { userId: string; teamId: string };
export type YunshuStoredAccount = {
  view: YunshuAccountView;
  meta: YunshuAccountMeta;
};
export type YunshuUnitOfWork = {
  assertRoot: (actor: YunshuActor) => Promise<void>;
  find: (userId: string, teamId: string) => Promise<YunshuStoredAccount | null>;
  list: (teamId: string, query: YunshuListQuery) => Promise<YunshuAccountView[]>;
  create: (teamId: string, body: YunshuCreateBody) => Promise<YunshuAccountView>;
  update: (record: YunshuStoredAccount, body: YunshuUpdateBody) => Promise<YunshuAccountView>;
};
export type YunshuRepository = {
  transaction: <T>(fn: (unit: YunshuUnitOfWork) => Promise<T>) => Promise<T>;
  withUserLock: <T>(userId: string, fn: () => Promise<T>) => Promise<T>;
  revokeSessions: (userId: string) => Promise<void>;
  audit: (event: {
    action: string;
    actorId: string;
    targetId: string;
    teamId: string;
    revision: number;
  }) => void;
};
