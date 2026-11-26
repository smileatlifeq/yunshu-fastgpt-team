# 云枢图谱内部账号与 GraphRAG 管理接通

> **当前版本说明（2026-11-26）**：本文件同时记录“独立账号管理”和“全员协作授权”两轮改造。开启 `YUNSHU_TEAM_COLLABORATION_ENABLED` 后，指定内部团队全体活跃成员（包括基础角色为 query_user 的账号）都可以管理图谱和编辑共享工作流；关闭时仍按原基础角色判断。下文早期“查询用户不能管理”的验收只对应关闭开关的行为。升级移植以末尾“社区版升级与合并记录”为准。

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

## 社区版升级与合并记录

### 1. 保存位置与版本基线

本段是团队用户管理改造的持续开发记录。以后调整这些功能时，同一提交更新本文件、相关局部测试和接口说明，不依赖聊天记忆。2026-11-26 本轮仅整理开发记录并保存已有功能改动，不再修改运行中的授权逻辑。

| 对象 | 已核对的基线或位置 |
|---|---|
| 官方源码版本 | `projects/app/package.json` 为 `4.17.5` |
| 本地官方源码快照 | `c44c8816787b147d874376393a4646e9d9643226` |
| 第一轮：独立账号管理 | `44e525f544ebcb4daec7045dddc364c2e69918a1`，19 个文件；其中仅密码登录路由是在官方现有逻辑上插入修改 |
| 第二轮：全员协作 | 当前功能分支新增的独立提交；精确 commit ID 记录在随补丁生成的 `merge-manifest.json` 中 |
| 当前维护分支 | `yunshu-internal-accounts` |
| 本文 | `.agents/design/yunshu-internal-accounts.md` |
| 配套 GraphRAG | 单独仓库；不是 FastGPT 的子目录，不能把它的改动当成 FastGPT 补丁 |

**历史来源边界：**这个本地仓库从官方源码快照建库，当前没有 Git remote。`c44c881...` 是本地快照提交，不等于官方 Git 仓库的提交 ID。基于同一份本地仓库的团队副本可以直接 merge/cherry-pick；一个全新的官方仓库不能据此假定有共同历史。不要为此使用 `--allow-unrelated-histories` 合并整棵源码树。

### 2. 两轮改造记录

| 轮次 | 原问题 | 当前实现 | 后续必须保留 |
|---|---|---|---|
| 独立账号管理 | 多人共用 root，权限及审计混在同一身份；退出登录会影响同账号其他会话 | `/yunshu` 由 root 创建和维护 `yunshu_` 账号，复用原生用户、团队成员、ACL、密码与会话 | 成员有独立用户 ID；不设为 owner；不伪造 root；不另建密码数据库 |
| 账号修改 | 停用、改密、降权后旧会话可能继续操作；旧密码验证与新会话创建之间存在空隙 | 用户锁包住登录收尾及账号修改；先撤销会话，再提交更新；版本号拒绝过期修改 | 撤销失败时不能提交新密码/新角色；不能缩短用户锁而重新引入登录竞争 |
| 全员图谱维护 | 只读基础角色不能进入图谱管理 | 默认关闭的开关只对配置的内部团队生效，活跃真人成员增加团队管理和应用创建能力 | 不给成员 root/owner；其他团队、停用成员及系统 Agent 身份不扩大权限 |
| 全员共享工作流 | 社区版协作者页面依赖未配置的 Pro API；单有团队管理不等于应用写入 | 新应用初始化时补全员组 ACL；root 使用独立 `/api/yunshu/collaboration` 补现有应用权限 | 继续使用原生应用写入校验，不改 isPlus，不依赖商业版授权接口，不降低已有更高权限 |
| 工作流配套资源 | 成员编辑应用时可能读不到引用的知识库 | 指定团队的配套知识库补全员读取；系统模型继续按既有规则使用 | 知识库读取不等于知识库编辑；个人团队模型、技能等仍按原权限检查，不宣称所有引用自动可用 |
| GraphRAG 跨成员任务 | 各自登录后仍不能查看/处理同事创建的任务 | 配套 GraphRAG 显式开关建立逐请求的同实例认证范围；原创建者保留，实际操作人记任务事件 | 身份/来源/CSRF、版本、领域写锁、执行资格及恢复证据不删除；该部分须在 GraphRAG 仓库独立维护 |

### 3. 官方代码的四个合并接点

大部分代码在 `yunshu` 独立目录。下列四处是升级时需要对照新版本重新接线的位置；**合并最小调用逻辑，不覆盖整个官方文件**。

| 官方文件 | 当前接入位置与职责 | 官方升级时要核对什么 |
|---|---|---|
| `projects/app/src/pages/api/support/user/account/loginByPassword.ts` | 查真实 user ID，使用 `withUserLock` 覆盖凭据验证到 `finishPasswordLogin` 完成会话创建的全过程 | 若官方拆分登录、增加多因素验证或迁移会话服务，把相同并发边界接到新的登录收尾处；保留官方新增验证分支 |
| `packages/service/support/user/team/controller.ts` | `getTeamMember` 先读原团队 ACL，再仅为绑定团队活跃真人成员补管理/创建应用角色 | 若角色位、状态枚举、成员读取入口或 Agent 身份初始化变化，改用新服务的等效接口；基础 ACL 原值仍是关闭开关后的依据 |
| `packages/service/support/permission/resourcePermissionService.ts` | `createResourcePermissions` 保留父级继承和创建者 owner，追加绑定团队默认全员组的共享权限 | 若官方重构 ACL 初始化、个人权限优先级或资源继承快照，重新定位“新资源创建时”的统一入口；同时保证已有个人读取记录不阻断全员编辑 |
| `packages/service/env.ts` | 注册默认 false 的 `YUNSHU_TEAM_COLLABORATION_ENABLED` | 沿用新版本环境变量校验方式，默认关闭，团队 ID 仍来自受控服务配置 |

`packages/service/support/user/session.ts`、用户/团队/权限 Schema 是依赖，**本改造没有直接修改它们**。升级时需要核对这些依赖的签名和行为，但不要把整份旧文件复制到新版。

### 4. 自有目录与文件职责

| 文件或目录 | 内容 |
|---|---|
| `packages/global/support/yunshu/type.ts` | 两种基础角色、专用 ID、账号绑定元数据及安全视图 |
| `packages/global/openapi/support/yunshu/api.ts` | 创建/列表/修改/团队/协作同步的输入输出 Schema |
| `packages/service/support/yunshu/entity.ts` | 原生 Mongo 用户、成员与 ACL 的事务适配；root 和团队所有者校验；会话撤销及安全审计 |
| `packages/service/support/yunshu/service.ts` | 创建/更新业务流程、用户名冲突、版本检查及撤销失败处理 |
| `packages/service/support/yunshu/types.ts`、`utils.ts` | 适配接口、固定团队配置、精确 Origin 校验及安全错误 |
| `packages/service/support/yunshu/collaborationPolicy.ts` | 指定团队协作开关、系统 Agent 排除、新资源全员组授权 |
| `packages/service/support/yunshu/collaboration.ts` | 现有普通应用及知识库的事务内补权，保留原 owner 和更高权限 |
| `projects/app/src/service/yunshu/entry.ts` | 原生会话认证、root-only、精确请求来源、方法和错误响应 |
| `projects/app/src/pages/api/yunshu/` | `team`、`accounts`、`accounts/[userId]`、`collaboration` 路由 |
| `projects/app/src/pages/yunshu/index.tsx` | 账号维护页面；开启全员协作时显示真实协作状态与存量同步按钮 |
| `projects/app/.env.yunshu.example` | 无密钥的配置示例，不自动加载 |
| `packages/service/test/support/yunshu/` | 账号事务和协作授权局部回归 |
| `projects/app/test/yunshu/`、`projects/app/vitest.yunshu.config.ts`、`projects/app/scripts/yunshu-auth-smoke.ts` | 页面测试及独立原生 HTTP 验收工具；启动前核对隔离数据库和测试依赖 |

完整导出文件及每个文件的基线/结果 SHA256 由 `merge-manifest.json` 自动登记，新增文件也必须出现在补丁里。不要只使用普通 `git diff HEAD` 导出，这样会漏掉未跟踪的新文件。

### 5. 配置、数据和权限约定

FastGPT 使用：

```dotenv
YUNSHU_ADMIN_TEAM_ID=<从 root 的 /yunshu 页面读取的固定团队 ID>
YUNSHU_ADMIN_ORIGINS=https://your-team.example.com
YUNSHU_TEAM_COLLABORATION_ENABLED=false
```

- 开关默认关闭；明确需要全员协作的实例改为 true 后重启，并由 root 在 `/yunshu` 同步现有应用。新资源随后自动补权，新成员通过默认全员组获得权限。
- 两种基础角色仍保存在账号绑定和原团队 ACL 中。开启协作时，query_user 也获得本团队的图谱管理和共享应用编辑能力；页面不再将它显示为只读限制。
- 应用“写入”包含工作流保存和版本发布，不等于应用 owner，也不开放系统账号管理。当前没有多人实时合并同一草稿的能力。
- 复用既有 Mongo 用户/团队/成员/ACL，用户元数据使用 `meta.yunshu.schemaVersion=1`，通过 `revision` 做并发修改检查；未增加用户表、Mongo 索引或数据库迁移。
- Mongo 必须支持事务，Redis 负责原生会话与用户锁。账号名全局唯一；不按同名账号继承历史身份。
- 关闭协作开关只停止动态加权和新资源自动共享，**不会撤销已经物化的应用 ACL**。回退先备份并核对授权差异，不能把“关开关”当作权限已恢复。
- 密码、Cookie、真实模型密钥、数据库和本机 private 文件不进入补丁、Git 提交或交接包。

配套 GraphRAG 的 `GRAPHRAG_FASTGPT_ADMIN_TEAM_ID` 必须相同。它另外使用 `GRAPHRAG_TEAM_COLLABORATION_ENABLED`，只对当前固定 issuer 的已验证映射身份开放批次/任务/日志协作。换团队或认证实例不能直接复用旧数据身份映射；旧图盘点/接管计划未在本轮扩大授权。

### 6. 以后跟进社区版的合并方式

先在独立升级分支上操作，保留当前能运行的版本。此处的分支名和路径是示例，执行前换成实际目标。

**情况 A：团队仓库继承了本地快照历史。**将独立功能分支或 Git bundle 导入后，使用正常的 `git merge` 或按顺序 cherry-pick 两个功能提交。导出的 bundle 保留基线提交作为前置依赖；如果目标没有该提交，先改用下面的完整补丁路线，不能强行拼无关历史。

**情况 B：目标是官方最新源码仓库，没有这份快照历史。**优先使用从官方 v4.17.5 本地基线导出的完整补丁，在新分支先检查：

```bash
git switch -c integration/yunshu-team-management
git apply --check /path/to/fastgpt-user-team-complete.patch
git apply --index /path/to/fastgpt-user-team-complete.patch
```

若不能干净应用，不加 `--reject` 后忽略失败继续发布。可以在旧版基线的临时集成分支应用并提交，再逐个处理上面四个接点；或者在目标对象库包含旧 blob 时使用 `git apply --3way --index` 并人工解决冲突。三方合并不是跨大版本兼容保证，冲突解决后必须重新验证角色、登录和权限行为。

已经有第一轮账号提交 `44e525f...` 的目标，使用“协作增量”补丁或第二个功能提交即可，不能重复套完整补丁。完全没有改造的目标才按顺序使用账号补丁＋协作增量，或者使用一次完整补丁；两种路线任选一种，不能重复应用。

合并后检查：

1. 列出本补丁的文件，确认独立目录、四个官方接点、测试和配置示例均存在。
2. 重新核对新版本的权限角色位、登录会话、用户锁、成员启停、Agent 身份集合、默认全员组、ACL 优先级和模型资源鉴权。
3. 运行局部测试及类型/构建检查；不要用旧版本的“通过”记录替代新版本验证。
4. 在隔离环境验证 root 和两个独立成员：登录、共享应用可见、互相保存/发布、其他团队拒绝、系统 Agent 私有应用拒绝、账号停用和旧会话失效、错误 CSRF 和过期版本拒绝。
5. 如配套 GraphRAG 更新，再验证同事任务可见、日志导出、取消和按原证据恢复，保留创建者及真实操作人记录。
6. 备份原环境的授权和业务数据，再构建新镜像/启动新版本；保存回退版本。合并成功不等于已经部署。

### 7. 验证记录与复核命令

2026-11-26 上一轮功能实施已实际通过：FastGPT service/app 类型检查、账号与协作服务共 11 项局部测试、FastGPT 生产构建；本机三个独立账号轮流编辑并互读同一个工作流，一位成员发布测试版本。配套 GraphRAG 新增 5 项协作测试通过；既有 33 项回归中 32 通过，1 项需要显式独立 MySQL 环境的五分钟容量测试未运行。真实本机还验证了跨成员上传、排队任务取消、日志导出、原创建者保留、实际操作人记录及错误 CSRF/过期版本拒绝。

这些是 v4.17.5 本机功能记录，不表示任何未来社区版已验证兼容。界面已有测试主要覆盖原账号管理，尚未完整覆盖新增协作按钮；多浏览器拖拽编辑和完整账号生命周期仍需人工验收。完整构图语义、真实吞吐和本轮华为云发布不在上述通过范围。

在支持正常 pnpm 调用的开发环境中，局部服务验证命令为：

```bash
pnpm --dir packages/service exec vitest run --config vitest.config.ts --coverage.enabled=false --maxWorkers=1 --no-fileParallelism test/support/yunshu/accounts.test.ts test/support/yunshu/collaboration.test.ts
pnpm --dir projects/app exec tsc --noEmit
pnpm --filter @fastgpt/app build
```

本机 Windows 根测试包装器曾出现 `spawn pnpm ENOENT`；可直接用拥有相同配置的 workspace 命令，不为了测试修改全局 PATH。app 类型检查需要约 4 GiB Node 堆空间；实际使用的 Node/pnpm 应以当前目标版本的 package.json 为准。

升级完成后，补充目标官方版本/commit、合并提交、冲突解决位置、新测试结果和发布结果到本文件；下一轮继续沿同一维护分支记录。

### 8. 2026-11-26 技能与 MCP 细粒度开发权限接续

本轮在 yunshu-internal-accounts 分支完成技能与 MCP 权限收口，并保存为本地提交。账号元数据新增 permissions.skills 与 permissions.mcp，由 root 在 /yunshu 创建或单独修改；二者默认关闭，不扩展 API key、模型、root 或 owner 权限。技能权限沿原技能 ACL 读取/写入校验，撤权后保留已共享技能的读取但禁止借旧 ACL 写入；协作同步覆盖指定团队的个人技能。MCP 仅允许指定团队真人成员共同维护普通服务，系统 Agent、代理授权和其他团队保持原边界，列表与单项鉴权共用归属过滤。

本轮新增/修改的代码与验证清单见 E:/work/graphrag_plugin/project_checkpoints/fastgpt_permission_extension_20261126_r1/implementation-receipt.json 和 source-sha256.json。packages/service 局部测试 18/18、账号页面测试 3/3、app TypeScript 检查和生产构建均通过，git diff --check 通过。构建提示当前 Node 版本低于声明范围，并有既有 styled-jsx/style.js 非阻断警告。

当前仍未重启本机 FastGPT 运行时做两个独立成员的真实技能/MCP 登录与 HTTP 验收；本地提交已保存但未推送，也未发布云端；这些静态验证不能代替运行时权限验收。后续先在隔离运行时验证创建、跨成员读写、撤权、代理授权和系统 Agent 排除，再决定提交。
