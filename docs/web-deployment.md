# Felix 本机使用、桌面下载和多人网页版

三种运行方式共用完整桌面界面和 13 个导航入口，界面采用“中文（English）”。文章站和笔记问答机器人属于独立项目。

| 方式 | 启动与存储 | 使用者 |
| --- | --- | --- |
| Electron 桌面版 | 本机进程，业务资料默认保存在 userData/felix.sqlite，凭据由系统安全存储保护 | 本机用户，支持本地 CLI 和 Pi 扩展 |
| 本机网页版 | 浏览器 + 本机 Bun 后端，默认 SQLite，可选 PostgreSQL，只监听 127.0.0.1 | 在自己电脑上使用 |
| 服务器网页版 | 常驻 Bun 后端 + HTTPS + 可选 SQLite／PostgreSQL | 多人注册登录，各用自己的模型密钥 |

桌面本地资料与服务器账号工作区分别保存；当前没有自动双向同步。两端都保留完整页面，数据能力仍取决于连接的供应商。

## 本机网页版

需要 Bun 1.4.2；Node 22 或更高版本用于浏览器测试及打包脚本。首次从源码安装需要联网。

```sh
bun install --frozen-lockfile
bun run web:build
bun run web:start
```

打开 http://127.0.0.1:8787 。默认是示例行情和本地规则演示，不产生模型费用。开发时分别启动 `bun run web:server:dev` 和 `bun run web:dev`，访问 http://127.0.0.1:5174 。

## 账号与自己的密钥

可匿名试用，注册会保留当前匿名记录。用户名使用 3–40 个英文字母、数字或 `_.-`，密码至少 12 个字符。注册时展示一次恢复码，请保存；忘记密码可用恢复码设置新密码并撤销旧登录。修改密码也撤销其他登录。账号可在其他浏览器登录，退出后恢复独立匿名工作区。

管理员可设置 `FELIX_INVITE_CODE`，只允许持有邀请码的人注册。密码使用 Argon2id 哈希；会话令牌只通过 HttpOnly Cookie 传递，数据库仅保存其哈希。每账号最多保留 10 个登录会话，登录有效期 30 天。

进入“设置 → 大语言模型”，填写自己的供应商密钥、选择模型并测试。模型费用计入使用者的供应商账户。支持兼容的流式 Chat Completions 和金融工具调用；内置 OpenAI、DeepSeek、通义千问、硅基流动入口。

自定义模型接口必须使用 HTTPS，域名须在内置列表或 `FELIX_MODEL_ALLOWED_HOSTS` 中。管理员只填写可信公网供应商域名，不含协议、端口、路径或通配符；不开放任意地址、Shell、文件执行或交易工具。

模型及行情密钥使用 AES-256-GCM 加密保存，工作区标识作为认证数据；接口只返回配置状态。服务管理员控制数据及加密材料，这属于服务端加密。个人“导出数据”下载 JSON，不含密钥、密码和登录令牌；包括会话、报告、投资论点、组合、自选股和技能开关等工作区资料。删除账号需要密码，会删除当前服务器的账号、会话、工作区资料及密钥；运维历史备份按照管理员保留策略清理。该 JSON 导出当前用于留档，完整恢复使用下述管理员备份流程。

## 行情与研究能力

| 能力 | 当前网页真实来源 |
| --- | --- |
| 美股报价、K 线、公司资料 | 用户配置自己的 Massive 密钥；实际权限由订阅决定 |
| 手动组合与组合风险 | CSV/粘贴后解析、审阅、确认；风险分析使用当前选中的组合 |
| 券商同步持仓、本地长桥 CLI | 使用桌面版本地连接，网页版不共享服务器管理员的券商账号 |
| 完整财报、新闻、事件等 | 当前网页适配器未提供全部真实来源；页面保留，须后续接入相应数据接口 |

`FELIX_DEMO_DATA=1` 允许后端示例回退；`0` 禁止后端回退。部分共用界面在数据缺失时仍显示带“示例数据”标识的展示资料，不代表真实数据已接通。提供商覆盖和真实调用权限应分别检查，配置了密钥不等于已经验收供应商访问。

网页版评测记录保存在个人工作区；远端 LangSmith/Langfuse 追踪以及桌面 Pi 扩展仍使用桌面环境。真实模型和行情服务需要实际密钥验证，本地测试使用模拟服务。

## 后台自动研究

默认关闭。开启的日/周定时规则保存在数据库中，服务器每分钟检查一次；关闭网页或重启服务器后仍会加载执行。规则使用服务器时区，默认部署 `TZ=Asia/Shanghai`；自选研究使用已保存的自选股或规则指定的证券。

调度先写入当天任务记录，再进入有界队列。同一规则当天自动触发一次；完成记录和执行状态持久保存。异常退出留下的任务标记为中断，不会当天自动重复扣用模型次数，可在自动研究页面手动重试；诊断导出包含失败或中断提示。事件驱动的财报前/后规则依赖可用的财报数据，当前不等同于完整后台事件监控。桌面定时任务需要桌面应用在运行；服务器必须常驻。

## 服务器部署

服务器部署时可选 SQLite 或 PostgreSQL，默认 SQLite；静态托管可承担前端，但不能独立运行此后端。免费方案需同时满足常驻进程、持久磁盘和可用内存，不能仅凭“免费”标签判断。云平台实际配额、休眠和回收条件以其官方说明为准。

1. 准备 Linux 主机及 Docker/Compose，拉取仓库；不要上传桌面 `.env`、个人凭据或本机运行数据库。
2. 复制 `deploy/web.env.example` 为 `deploy/web.env`，设置 `FELIX_DOMAIN=felix.你的域名`，将 `FELIX_PROXY_SECRET` 替换为随机长字符串。可运行 `bun -e "console.log(crypto.randomUUID())"` 生成。按需填写邀请码和时区。
3. 在阿里云 DNS 添加子域名 A 记录指向主机 IPv4，开放 TCP 80、443；阿里云注册的域名可解析到其他云主机。
4. 从仓库根目录执行：

```sh
docker compose --env-file deploy/web.env -f deploy/compose.yml config --quiet
docker compose --env-file deploy/web.env -f deploy/compose.yml up -d --build
docker compose --env-file deploy/web.env -f deploy/compose.yml ps
```

Caddy 提供 HTTPS，页面和 API 同源；生产 Cookie 使用 Secure、HttpOnly、SameSite=Lax。8787 不对公网开放。Caddy 覆盖客户端 IP 和共享校验头，后端只接受经过 `FELIX_PROXY_SECRET` 验证的代理信息。直接暴露后端时不能信任客户端自填的转发头。

SQLite 数据库、加密材料和辅助运行文件保存在 `/data` 命名卷；PostgreSQL 业务资料保存在所选数据库，更新容器仍需保留 `/data` 中的加密材料及运行文件。单实例起步配置建议 1–2 vCPU、至少 2GB 主机内存，尚未进行 200 日访客的目标服务器压力验收。不要用多个后端副本同时挂载同一数据目录。服务使用排他锁避免同机误启动多个实例；Linux 容器重启通过 PID 和进程启动标识识别失效锁。跨主机/容器迁移若遗留 `.server-lock`，须确认原实例已停止后再移除该失效锁。

已有 JSON 业务资料第一次启动会迁移至所选数据库，原文件保留；之后以数据库为准，直接编辑旧 JSON 不会更新数据库。技能开关也进入数据库，部分运行日志仍为辅助文件，完整恢复应使用管理员备份。桌面版会将原有 JSON 业务资料一次性迁移到本机 SQLite，系统加密凭据和 Pi 运行文件仍保留原来的本机存储方式。

## 部署时选择数据库

数据库由部署者选择，访客只填写自己的模型密钥。这里的选择用于本机网页版和服务器后端；Electron 桌面版本地业务资料固定使用 SQLite，离线使用不要求 PostgreSQL。

### SQLite：无需单独安装数据库

在 `deploy/web.env` 中设置：

```dotenv
FELIX_DATABASE_TYPE=sqlite
FELIX_DATABASE_URL=
```

使用前面的 `deploy/compose.yml` 启动命令即可。

### PostgreSQL：连接已有的自建或托管数据库

先建立专供 Felix 使用的空数据库，账号需要在该数据库建表及读写的权限。连接字符串只放在后端私有配置中，不放网页或 GitHub：

```dotenv
FELIX_DATABASE_TYPE=postgresql
FELIX_DATABASE_URL=postgresql://用户名:密码@数据库地址:5432/felix?sslmode=verify-full
```

URL 中的特殊字符需百分号编码。公网数据库使用校验服务器证书的 TLS，按供应商提供的证书配置；数据库无需对所有公网 IP 开放。填写错误、连接失败不会自动回退 SQLite，启动会明确失败。账号、登录会话、模型密钥密文、自选股、研究资料、技能开关、配额和定时任务都使用所选数据库。

### PostgreSQL：在同一 VPS 上自建

将 `POSTGRES_PASSWORD` 设置为随机的 URL 安全长密码（例如 64 位十六进制字符串），采用附加 Compose 文件：

```sh
docker compose --env-file deploy/web.env -f deploy/compose.yml -f deploy/compose.postgresql.yml config --quiet
docker compose --env-file deploy/web.env -f deploy/compose.yml -f deploy/compose.postgresql.yml up -d --build
```

附加文件自动让 Felix 连接内网 `postgres` 服务，数据库使用独立的 `postgres-data` 命名卷，5432 不映射到公网。Felix、Caddy、PostgreSQL 同时占用主机资源，不等于增加免费的硬件容量；更新时保留两个数据卷，不要执行 `down -v`。自建模式内网连接不使用公网 TLS 参数。

PostgreSQL 模式目前仍限制一个 Felix 后端实例：进程内的研究队列、配额缓存和运行文件尚未设计成多副本共享，数据库连接会取得排他锁，第二个实例拒绝启动。PostgreSQL 应提供直连／会话级连接，不使用事务级连接池代理。

### 切换数据库并保留资料

改配置不会自动搬迁已有数据库。数据目录记录数据库类型，发现类型不一致或遗留 SQLite 数据时会拒绝启动，避免读取旧 JSON 导致资料回退。按以下步骤迁移：

1. 停止后端，用当前数据库配置运行 `web:backup backup`。
2. 准备一个新的空数据目录；迁入 PostgreSQL 时同时准备空的专用数据库。
3. 用目标数据库配置运行 `web:backup restore`；账号、密文凭据、调度记录和辅助文件随备份恢复。
4. 用目标配置启动，验证登录和资料后切换正式服务，保留原数据库和备份以便回退。保持加密密钥一致；备份内已保存有效密钥。

例如从 SQLite 迁入外部 PostgreSQL（以下是占位地址，实际密钥放私有环境变量）：

```sh
FELIX_DATABASE_TYPE=sqlite bun run web:backup backup .felix-web-data /private/felix-backup
FELIX_DATABASE_TYPE=postgresql FELIX_DATABASE_URL="$FELIX_TARGET_DATABASE_URL" bun run web:backup restore /private/felix-backup /private/felix-postgresql-data
# 设置 FELIX_DATA_DIR=/private/felix-postgresql-data 并使用相同的目标数据库配置启动。
```

Compose 自建 PostgreSQL 模式做备份／恢复时也添加 `-f deploy/compose.postgresql.yml`。先仅启动 PostgreSQL，停止 Felix，再用 `run --rm --no-deps --entrypoint bun felix /app/backup.js ...` 操作；恢复使用新 Felix 数据卷和空 PostgreSQL 数据库。备份包含全部账号和解密材料，需私有保存并离机备份。

## 配额与日常运维

- 数据目录默认 `.felix-web-data/`；SQLite 采用 WAL，PostgreSQL 使用独立数据库。保持 `FELIX_COOKIE_SECRET` 稳定，或保留自动生成的 `.cookie-signing-key`，否则无法解密旧模型凭据。
- 默认并发 2、等待最多 32，同一工作区串行；缓存最多 32 个内核，回收内核不删除个人数据。
- 全站默认每天 1000 次、每工作区 20 次模型对话/研究，按 UTC 日期重置；失败或取消的已开始任务计入次数。分别由 `FELIX_DAILY_RUN_LIMIT`、`FELIX_VISITOR_DAILY_RUN_LIMIT` 设置。
- 每工作区每分钟最多 600 次 API 请求，连接 IP 最多 2000 次；注册、登录、密码恢复等各操作每 IP 每分钟最多 10 次，并限制密码哈希并发。
- 每工作区最多 100 个会话、每会话最多 100 次对话、4 条 SSE；单次组合导入最多 200 行，提醒最多 50 条。
- 容器日志轮转；定期检查磁盘并保留离机备份。没有自动删除长期未用账号或匿名工作区，管理员应制定保留策略。
- 更新使用 `up -d --build`，避免删除命名卷。站内配额控制后端资源，使用者仍应在模型供应商处设置账单上限。

## 备份和恢复

操作工具要求停止后端，拒绝覆盖非空目标目录／数据库，并校验恢复文件的 SHA-256。新版备份包含数据库逻辑快照，可跨 SQLite／PostgreSQL 恢复；旧版 SQLite 备份仍可恢复到 SQLite，需重新备份后才能迁移至 PostgreSQL。备份包含账号及有效加密密钥，保持私有，不上传 GitHub。若使用环境变量覆盖签名密钥，备份命令也应传入相同 `FELIX_COOKIE_SECRET`；CLI 会把有效密钥写入私有备份。

本机/普通 Linux 进程，先停止 `web:start`：

```sh
bun run web:backup backup .felix-web-data /private/felix-backup-2026-10-07
bun run web:backup restore /private/felix-backup-2026-10-07 /private/felix-restored
# 让 FELIX_DATA_DIR 指向新恢复目录再启动；使用备份中的密钥，或保留一致的环境密钥。
```

Windows 可用绝对目录，例如 `D:/FelixBackups/2026-10-07`。容器镜像也包含 `/app/backup.js`。Linux Docker 备份示例：

```sh
mkdir -p "$PWD/private-backups"
# 备份进程按镜像 bun 用户运行，确保此私有目录对该 UID 可写；查询实际 UID：
# docker compose --env-file deploy/web.env -f deploy/compose.yml run --rm --no-deps --entrypoint id felix
# 然后只调整这个备份目录的所有者/权限，不要放宽整个仓库权限。
docker compose --env-file deploy/web.env -f deploy/compose.yml stop felix
docker compose --env-file deploy/web.env -f deploy/compose.yml run --rm --no-deps \
  -v "$PWD/private-backups:/backups" --entrypoint bun felix \
  /app/backup.js backup /data /backups/2026-10-07
docker compose --env-file deploy/web.env -f deploy/compose.yml up -d felix
```

恢复到新命名卷/新数据目录并验证登录后，再切换正式挂载；不要先清空旧卷。历史备份不会因用户删除账号而自动改写，应按约定过期清理。

## Windows 桌面下载

新增 Windows x64 NSIS 安装包配置，支持选择安装目录，卸载默认保留本机数据；修正 Windows `resources` 目录识别。需要构建依赖已安装：

```sh
bun run release:package
bun run test:package-smoke
bun run --cwd apps/electron test:storage-smoke
```

本机若打包工具因 macOS 资源的符号链接权限失败，可以完成源码构建后运行：

```sh
cd apps/electron
bun run package:builder --win nsis --x64 --publish never --config.win.signAndEditExecutable=false
```

该参数跳过 EXE 签名及元数据编辑，用于内部未签名试用包；此包不等于已完成正式签名发布。CI 的 Windows 工作流构建并上传安装包及校验文件，源码推送不等于创建 GitHub Release。正式发布仍遵循仓库 release gates。

桌面版的 AI 当前沿用外部 Pi CLI/Bun 环境：普通安装包没有捆绑 Bun/Pi 运行时，下载者使用 AI 前仍须安装 Bun，首次启动 Pi 需能访问 npm；长桥实时连接还需要本机 Longbridge CLI。包内的本地演示、手动组合及界面不需要模型密钥。安装包冒烟测试验证了本地演示，未声称已在完全无 Bun 的新机器上完成真实模型测试。

## 验证和当前边界

```sh
bun run web:test
bun run test:unit
bun run typecheck
bun run i18n:check
bun run web:build
bun run web:server:build
bun run build:electron
# 后端启动后，使用 Chrome；FELIX_BROWSER_PATH 可指定路径
bun run web:e2e
bun run test:package-smoke
```

本次存储修改的本机验证：全仓 1745 个测试通过、16 个测试跳过（8 个 PostgreSQL 用例转由真实数据库 CI 执行，另 8 个需要真实账户或符号链接权限）；类型检查通过。Chrome 覆盖全部导航、两轮对话、研究、投资论点、报告下载、模型密钥、自选股、账号注册/跨浏览器登录/导出/退出/删除及手机宽度。实际 Electron 进程已验证旧 JSON 迁移、SQLite 读写、会话和技能开关保留、关闭后重启，以及旧文件不会覆盖新数据。SQLite JSON 迁移、账号恢复、关闭浏览器后的定时调度、重启去重、跨库备份恢复均有自动测试。

PostgreSQL CI 使用 PostgreSQL 17，执行全部服务器测试、浏览器流程、SQLite→PostgreSQL→SQLite 的资料恢复，以及正常／异常容器重启。Windows CI 构建当前修改的未签名 NSIS 包，并执行包内资源／IPC／本地运行和 SQLite 重启测试；安装包及 SHA-256 文件位于对应运行的 `Felix-Windows-x64` artifact。当前结果见 [GitHub Actions](https://github.com/Xx-173/Felix/actions)。

Linux x64 的完整单元测试、浏览器操作流程、镜像构建、SQLite 持久化、正常重启和异常退出后的重启测试已在 [GitHub Actions](https://github.com/Xx-173/Felix/actions/runs/37622696070) 通过。桌面版和网页版使用同一完整应用样式；构建安装包不会自动发布 GitHub Release。本机 Docker 引擎未运行，ARM 容器和目标服务器容量尚未验收。实际云主机、域名 DNS/HTTPS、真实供应商密钥和桌面外部 Pi 环境仍需在目标环境完成验收。
