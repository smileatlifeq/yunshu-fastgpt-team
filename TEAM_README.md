# 云枢团队版 FastGPT

本仓库由 GitHub 用户 **smileatlifeq** 独立维护，用于共同开发和部署 FastGPT，基于官方 **v4.17.5**，真实上游提交为
`e74f923690170e8f438061380b75617ecd28b5fd`。本公开仓库专供团队部署，只维护一个 `main` 分支，放本机已验收的版本。
不属于官方 fork 网络。官方升级另开分支验证，不能用官方镜像覆盖定制代码后期待新功能仍然存在。

本仓库保留完整的本地快照历史（源码快照与上面官方提交逐文件一致）。它与官方 Git 历史没有共同祖先，
后续升级按维护记录导出补丁移植，不强行合并无关历史。

仓库所有者、提交作者和原项目作者是不同信息。仓库归属为 `smileatlifeq`；官方 FastGPT 的来源、LICENSE、LOGO 和版权信息保持原样。旧提交中的作者信息描述该提交的来源，不表示其他人拥有本仓库。

## 团队部署与本机调试

本仓库只交付团队部署版本。本机调试继续在开发者电脑的独立副本进行；同一套源码按环境分别配置，不需要维护两份分叉代码。

| 项目 | 自己电脑调试 | 团队协作部署 |
|---|---|---|
| 代码 | 在本机独立副本开发和调试 | 从本仓库拉取 main，核对验收提交 |
| 数据 | 独立测试数据库、缓存、端口和私有配置 | 团队环境自己的数据库、备份和私有配置 |
| 团队共享 | 不需要共同编辑时保持协作开关 false；本机测试协作时也可开启 | 固定团队绑定后显式开启协作，root 同步共享权限 |
| 成员 | 可以独立登录调试 | 每位成员独立登录，共享工作流及已授权普通 MCP |
| 技能沙盒 | 可选，使用下文的本机启动器 | 可选，由管理员为部署实例集中配置 |

不要把本机测试密码、模型密钥、数据库内容或生成的沙盒私有配置提交到仓库。关掉协作开关不会撤销此前已经保存的资源共享授权，详见下文。

本仓库只保留 `main`，上游的数据库重构、历史版本维护和实验分支不复制到此仓库。本机验证通过不代表任意服务器已经验证。

团队下载源码：

```bash
git clone --branch main https://github.com/smileatlifeq/yunshu-fastgpt-team.git
cd yunshu-fastgpt-team
```

源码下载不需要 GitHub 私有仓库权限；运行时仍需各自配置数据库、服务和私有密钥。

## 包含的改造

- root 在 `/yunshu` 创建和维护独立账号，支持启停、改密、修改版本校验及旧会话撤销。
- 绑定团队开启协作后，成员可以维护共享工作流；不需要共用 root，不依赖商业版协作者接口。
- 技能共同开发和普通 MCP 服务共同维护分别控制，新账号默认均开启，root 可逐人关闭。
- 成员不获得 root、owner、API 密钥管理或 MCP 身份代理权限；系统 Agent 和其他团队排除。
- 可选官方 Agent Sandbox 提供技能文件编辑、终端和脚本执行。普通工作流及 MCP 使用不要求启用它。

GraphRAG 在另一仓库独立维护，配套改动由其维护同事审核；本仓库不分发 GraphRAG 私有代码、数据或配置，GraphRAG 不引入技能沙盒依赖。

## 构建和配置

按 [官方开发说明](dev.md) 安装当前 `package.json` 声明的 Node.js 和 pnpm 版本，
使用本仓库源码完成依赖安装、SDK/工作流包与主站构建。MongoDB 必须支持事务，Redis 必须可用。
部署基础配置沿用官方文档和已有部署方式；本次没有更改部署 YAML。

将 [无凭据配置示例](projects/app/.env.yunshu.example) 合入 FastGPT 的实际服务环境：

```dotenv
YUNSHU_ADMIN_TEAM_ID=<root 登录 /yunshu 后读出的固定团队 ID>
YUNSHU_ADMIN_ORIGINS=https://your-team.example.com
YUNSHU_TEAM_COLLABORATION_ENABLED=true
```

重启主站后，root 在 `/yunshu` 同步现有应用和技能的共享权限。新账号的两个开发开关默认开启；
原账号的旧授权不会因升级自动扩大，应由 root 逐人确认。修改授权后成员重新登录。

关闭协作开关不会自动撤销已经保存的应用 ACL（资源共享授权记录），回退时须核对真实授权。
固定团队、来源地址和登录 Cookie 使用同一部署实例，不跨业务实例复用身份。

## 可选技能沙盒

适合需要开发和执行技能脚本的成员。管理员为一套 FastGPT 部署一次，成员共用受权限管理的服务；
仅使用工作流和普通 MCP 时可以暂不部署。需要 Docker 已启动及 Python 3.10+，不会安装或升级 Docker。

以下命令用于 **FastGPT 主站运行在本机 3040 端口** 的开发验收环境：

```powershell
python scripts/yunshu-agent-sandbox.py up --registry cn --fastgpt-url http://host.docker.internal:3040
```

`--registry cn` 使用官方部署文件列出的国内镜像；不加时使用 Docker Hub/GHCR。
固定版本包括 OpenSandbox 1.2.0、FastGPT proxy/volume-manager 0.3.0、运行镜像 0.3.1。
私有随机密钥和配置保存在已忽略的 `local/yunshu-agent-sandbox/`；禁止提交或分享此目录。
可通过 `--state-dir` 指定仓库外目录。

将生成的 `fastgpt.env` 合入主站**实际加载的环境**，保持原有数据库、账号、模型等配置，再重启主站。
脚本不会替你覆盖主站环境。默认本机端口：8098 控制服务、3015 持久卷管理、3016 编辑与预览代理，
均绑定 127.0.0.1；主站回调地址必须能被 Docker 容器访问。

控制服务需要 Docker 接口权限，应由管理员部署；执行容器不挂载主机源码、凭据或 Docker 接口。
默认每实例 1 CPU/1024 MiB，最多 4 个活跃实例，闲置 15 分钟暂停。
多人服务器部署应按官方方案使用内网控制服务及 HTTPS/WSS 代理，不能把本机 127.0.0.1 示例照搬给远程成员。

```powershell
python scripts/yunshu-agent-sandbox.py status --registry cn --fastgpt-url http://host.docker.internal:3040
python scripts/yunshu-agent-sandbox.py stop --registry cn --fastgpt-url http://host.docker.internal:3040
```

停止命令只停止本启动器管理的三个控制服务，保留沙盒实例与持久卷；不会删除其他容器或业务数据。
复用私有配置时须使用相同端口、namespace、回调地址和镜像源参数。

## 维护记录

权限接点、会话和升级边界见 [.agents/design/yunshu-internal-accounts.md](.agents/design/yunshu-internal-accounts.md)。
保留官方 LICENSE、LOGO 和版权信息。仓库包含源码和配置示例，不包含本机账号、密钥、业务数据或依赖目录。
