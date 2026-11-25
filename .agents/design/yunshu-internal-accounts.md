# 云枢图谱内部账号与 GraphRAG 管理接通

基础：官方 FastGPT v4.17.5；GraphRAG 使用 smileatlifeq/graph-rag-agent-new 的 FastgptPlugins，起点 a60886b990d497ba1ccadcdbc946c5b972f62f10。

目标是一个内部团队、多名独立图谱管理员，不实现完整商业版多租户后台。复用 FastGPT 原生用户、成员、个人团队 ACL 和登录会话；GraphRAG 沿用每次向 tokenLogin 核验身份、指定团队管理权限和独立 CSRF 镜像的现有机制。

## 边界与配置

- 原生 root 负责创建、停用、恢复、重置密码和授予角色；图谱管理员没有 root 身份，成员不设为 owner。
- 专用用户名限制在 yunshu_ 命名空间。只操作本模块创建并绑定指定团队的账户；不物理删除用户或历史数据。
- 密码采用当前原生浏览器摘要与 MongoUser setter 的双层协议，不新建密码库，不返回或记录摘要。
- 创建用户、成员、ACL 与元数据绑定在一个 Mongo 事务中完成。
- 修改必须携带已读版本。改变密码、启用状态或权限时，在原生用户锁内先撤销旧会话；撤销失败不改变数据库。
- FastGPT 配置 YUNSHU_ADMIN_TEAM_ID、YUNSHU_ADMIN_ORIGINS；GraphRAG 配置同一 GRAPHRAG_FASTGPT_ADMIN_TEAM_ID、固定 FastGPT 内部地址与来源。
- 登录使用原有 /login，root 登录后访问 /yunshu。图谱工作台通过既有同源网关 /graphrag/ 访问。
- 不开启 isPlus，不伪造商业授权，不修改部署 YAML。测试只用独立数据库、目录和端口。

## 验证与待办

- [x] 请求字段、角色、用户名和来源严格校验。
- [x] 创建失败回滚；重复用户名不留下成员或 ACL。
- [x] 更新版本冲突和会话撤销失败保持数据库状态。
- [x] 新成员通过真实原生 ACL 获得管理权限，不使用 owner 捷径。
- [x] 两位管理员使用原生 Cookie 独立建立 GraphRAG 身份和 CSRF。
- [x] 查询用户、伪造角色、错误团队和已停用账号无法执行管理操作。
- [x] FastGPT 类型检查、局部自动测试及新副本 HTTP/页面交互验证（范围见下）。

## 已实现行为

新增 `/yunshu` 账号入口：root 创建账号、切换角色、启用/停用、重置密码及分页查看账号。账号名例如 `yunshu_admin_01`、`yunshu_admin_02`、`yunshu_reader_01`；显示名可使用“云枢图谱·张三”。所有图谱管理员共同管理同一实例中的领域，不新增按成员隔离的领域或多租户平台。

原生密码登录的创建会话步骤纳入现有用户锁，消除“旧密码已验证、管理员改密后才创建会话”的空隙。GraphRAG 兼容旧身份返回，同时拒绝新版返回的非 active 用户状态。

## 配置与迁移

1. 使用官方 v4.17.5 所需的 Node 与 pnpm 版本构建 FastGPT，安装依赖并执行官方 SDK、工作流和 app 构建命令。部署新增入口需要从这份修改后的 FastGPT 源码构建镜像，直接拉官方预制镜像不会包含 `/yunshu`。测试新增入口不需要开启商业授权。
2. root 登录 `/yunshu`，读取页面显示的内部团队 ID；FastGPT 设置 `YUNSHU_ADMIN_TEAM_ID`、`YUNSHU_ADMIN_ORIGINS`。示例在 `projects/app/.env.yunshu.example`，需要补充到实际服务环境，它不会自动加载。
3. GraphRAG 使用 `GRAPH_RAG_RUNTIME_MODE=managed`，将 `GRAPHRAG_FASTGPT_ADMIN_TEAM_ID` 设为同一个团队 ID。设置固定的 `GRAPHRAG_FASTGPT_INTERNAL_URL`、稳定实例名 `GRAPHRAG_FASTGPT_ISSUER`、`GRAPHRAG_ADMIN_ORIGINS` 和独立随机 `GRAPHRAG_ADMIN_SESSION_HASH_KEY`（至少 32 字符）。
4. 同一 HTTPS 域名下，现有网关将 `/graphrag/` 显示为图谱界面、`/graphrag-api/` 转发至 GraphRAG API，其余路径转发至 FastGPT；浏览器 Cookie 跟随此同源入口。开发测试 HTTP 仅允许回环地址。
5. Mongo 必须支持事务（副本集）；Redis 必须可用以提供原生会话及用户锁。GraphRAG managed 数据库沿用当前分支自己的迁移流程。账号创建没有替代图谱数据迁移，旧域、旧构建及生产数据需另按项目迁移文档处理。

本次不修改部署 YAML，不连接华为云，不向 GitHub 推送，不写现有 FastGPT、Mongo 或图谱数据。源码及补丁可先合入统一集成分支，再按上述配置连接服务。

## 实际验证范围

- 账号服务 7 项自动检查：使用独立 Mongo 副本集，恢复真实事务，覆盖回滚、字段及来源、权限、停用 root、版本冲突、撤销失败、单独改密与审计字段。
- 原生密码登录已有 30 项检查通过。
- GraphRAG 管理身份 15 项检查通过，新增用户状态核验；其中 2 位管理员的 CSRF 不能互用。
- 无认证/事务/Redis 模拟的 HTTP 联调通过：真实 FastGPT 原生密码登录和 tokenLogin、真实 Mongo 与 Redis、独立 GraphRAG SQLite 迁移；两个管理员创建领域，查询用户被拒绝，降权、停用、改密后旧会话失效。
- 账号页面 2 项交互检查通过：root 角色操作携带版本、加载下一页、未授权时不能创建账号。
- 最终 FastGPT app TypeScript 类型检查通过；原生 SDK、工作流包和 4 个 app workers 构建通过。

HTTP 联调启动器 `projects/app/scripts/yunshu-auth-smoke.ts` 只用于隔离检查，不能替代完整 Next.js 启动。测试未执行模型调用、全量构图、生产 Docker 镜像、完整浏览器页面验收或华为云发布。

重复局部验证可用 service/app 各自 Vitest 配置及新 `test/support/yunshu/accounts.test.ts`、`test/yunshu/accounts-page.test.tsx`；无模拟 HTTP 使用 `vitest.yunshu.config.ts`，需独立回环 Mongo（27018）、Redis（6380）、随机专用 DB、临时密钥与 GraphRAG 测试路径。测试账号和密码均为临时生成，收尾删除专用数据库，不提供固定默认管理员密码。
