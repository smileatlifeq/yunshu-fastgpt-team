# 云枢团队版 FastGPT

本仓库是用户自己名下的独立私有仓库，用于共同维护 FastGPT，基于官方 **v4.17.5**，真实上游提交为
`e74f923690170e8f438061380b75617ecd28b5fd`。团队使用默认分支 `yunshu-team`。
不属于官方 fork 网络，改造只推送本私有仓库。官方升级另开分支验证，不能用官方镜像覆盖定制代码后期待新功能仍然存在。

本私有仓库保留完整的本地快照历史（源码快照与上面官方提交逐文件一致）。它与官方 Git 历史没有共同祖先，
后续升级按维护记录导出补丁移植，不强行合并无关历史。

## 包含的改造

- root 在 `/yunshu` 创建和维护独立账号，支持启停、改密、修改版本校验及旧会话撤销。
- 绑定团队开启协作后，成员可以维护共享工作流；不需要共用 root，不依赖商业版协作者接口。
- 技能共同开发和普通 MCP 服务共同维护分别控制，新账号默认均开启，root 可逐人关闭。
- 成员不获得 root、owner、API 密钥管理或 MCP 身份代理权限；系统 Agent 和其他团队排除。
- 可选官方 Agent Sandbox 提供技能文件编辑、终端和脚本执行。普通工作流及 MCP 使用不要求启用它。

GraphRAG 另在 [graph-rag-agent-new](https://github.com/smileatlifeq/graph-rag-agent-new) 维护。
团队权限配套 PR 由该仓库维护同事审核；GraphRAG 不引入技能沙盒依赖。

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
