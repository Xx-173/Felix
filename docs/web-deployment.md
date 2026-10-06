# Felix 网页版、桌面版与部署

网页版直接使用桌面版的 `AppShell`、全部导航和三栏布局。今日、机会发现、工作台、投资组合、对比、提醒、研究、投资逻辑、技能、评测、事件、个人与安全、设置均保留。两端界面统一显示“中文（English）”；语言偏好仍用于日期格式和模型回答语言。文章站与笔记问答是后续独立项目。

## 本地启动

```sh
bun install --frozen-lockfile --ignore-scripts
bun run web:build
bun run web:start
```

打开 http://127.0.0.1:8787 。默认使用示例行情与确定性的本地规则，不产生模型费用。开发时分别启动 `bun run web:server:dev` 和 `bun run web:dev`，访问 http://127.0.0.1:5174 。

## 试用者使用自己的密钥

进入“设置 → 大语言模型”，填写自己的供应商密钥，保存、选择模型，并点击“测试”。模型费用由该访客的供应商账户承担。支持 OpenAI Chat Completions 兼容的流式响应与工具调用；内置 OpenAI、DeepSeek、通义千问、硅基流动入口。也可添加自定义提供商及模型标识。

自定义接口必须使用 HTTPS，域名需在内置允许列表或管理员配置的 `FELIX_MODEL_ALLOWED_HOSTS` 中。填写域名时不包含协议、端口、路径或通配符。管理员应仅批准可信供应商的公网域名；访问跳转会被拒绝。没有通过此入口开放任意服务器地址、Shell、文件执行或券商交易工具。

密钥按访客使用 AES-256-GCM 加密落盘，访客标识作为认证数据；API 只返回配置状态，不返回密钥。访客可在设置中移除密钥。签名 Cookie 隔离工作区：会话、报告、投资论点、导入组合、技能开关、提醒和评测记录均分开存储。没有账号系统，清除 Cookie 或换设备不会找回旧工作区。服务器管理员仍控制数据与加密材料，这是服务端加密存储，不是端到端加密。

默认未连接模型时提供本地规则演示。研究报告可继续保存为投资论点、复查、对比及导出；CSV/粘贴导入须先解析、审阅、确认才保存。技能沿用桌面技能资源与启停状态，网页模型仅通过注册的金融工具使用研究方法，不执行技能里的本地脚本。

行情密钥在“设置 → 连接”由各访客自己填写。已有 Massive 适配器支持美股行情、K 线和公司资料；完整财报、新闻等需要相应供应商连接，未接通的能力会明确失败。`FELIX_DEMO_DATA=1` 允许示例回退并标注示例；`0` 禁止回退。数据延迟及权限取决于访客订阅。

长桥 CLI 本地登录及桌面 Pi 环境依然由桌面版提供；网页保留相关页面和连接状态说明。网页版评测页可读取自己的本地记录、基线及反馈；远端 LangSmith/Langfuse 凭据和追踪集成目前使用桌面版。自动研究默认关闭，访客开启后仅在其浏览器连接保持打开时调度；不保证关闭网页后的后台定时任务。规则时间使用服务器时区，部署可设置 `TZ`。

## 持久化部署

当前后端使用本地文件，需要常驻进程和持久磁盘。可部署在已申请到的 Oracle 免费实例或其他 Linux 云主机；免费的静态网页托管只能承担前端。免费临时磁盘服务重启后会丢失工作区和签名密钥，当前尚未接入外部数据库。有关平台条件请查看 [Oracle 官方说明](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)、[Render 免费服务说明](https://render.com/docs/free)。本配置尚未通过目标 Linux/ARM 容器或负载验收。

1. 准备有持久磁盘的 Linux 实例并安装 Docker/Compose，拉取此仓库。不要上传桌面凭据、本地 `.env` 或 `.felix-web-data`。
2. 将 `deploy/web.env.example` 复制为 `deploy/web.env`，设置 `FELIX_DOMAIN=felix.你的域名`。
3. 在阿里云 DNS 添加该子域名的 A 记录，指向实例 IPv4；开放 TCP 80、443。
4. 在仓库根目录执行：

```sh
docker compose --env-file deploy/web.env -f deploy/compose.yml config --quiet
docker compose --env-file deploy/web.env -f deploy/compose.yml up -d --build
docker compose --env-file deploy/web.env -f deploy/compose.yml ps
```

Caddy 提供 HTTPS，前端/API 同源，生产模式 Cookie 使用 Secure、HttpOnly、SameSite=Lax。8787 不对公网开放。签名及加密密钥自动生成并保存到 `/data`；容器更新保留命名卷。若自行设置 `FELIX_COOKIE_SECRET`，必须保持不变，否则旧 Cookie 与加密凭据无法使用。

配置预期在 1–2 vCPU、至少 2GB 主机内存上起步，实际资源取决于负载。单实例文件存储不支持多副本共享；镜像版本验收后宜固定摘要。

## 配额与运维

- 数据目录默认为 `.felix-web-data/`；Docker 命名卷 `felix-data` 挂载到 `/data`，请安排备份和数据保留策略。
- 后台队列默认并发 2、等待最多 32，同一访客串行；最多缓存 32 个访客内核，回收内核后文件仍保留。
- 默认全站每天 100 次、每访客 20 次模型对话/研究，按 UTC 日期重置；失败或取消的已开始任务计入次数。可通过环境变量调整。
- 每访客最多 100 个会话、每会话最多 100 次对话、4 个 SSE 连接；组合导入最多 200 行，提醒最多 50 条。
- API 按实际连接 IP 每分钟最多 240 次；当前反向代理后会按代理连接地址聚合，不信任客户端伪造的转发头。
- 没有自动删除旧访客文件。更新执行 `up -d --build`，不要删除命名卷。服务端配额限制资源用量，不替代访客供应商的账单上限。

## 桌面版

原 Electron 入口和打包脚本保留，修改的双语资源与网页共用。运行 `bun run build:electron` 构建桌面代码，沿用原有 `bun run release:check` / `bun run release:package` 发版流程。目前仓库已有 macOS arm64 打包配置；本次不将 Windows 安装包或新版 GitHub Release 视为已发布。

## 验证

```sh
bun run web:test
bun run test:unit
bun run typecheck
bun run i18n:check
bun run web:build
bun run web:server:build
bun run build:electron
# 后端启动后，使用本机 Chrome；可通过 FELIX_BROWSER_PATH 指定路径
bun run web:e2e
```

后端验证覆盖访客隔离、密钥加密/重启/移除、访客自己的密钥实际用于模型请求、地址允许列表、导入确认、投资论点、技能及完整页面接口。模型流式工具调用和取消使用本地模拟服务验证。浏览器检查全部导航、对话、刷新恢复、研究、投资论点、报告下载、密钥设置和窄屏交互。

真实供应商调用、云主机发布、域名 DNS/HTTPS 和目标容器运行尚待实际账号/实例验收。Windows 本机 Docker 引擎未启动，因此只验证 Compose 配置，不声称镜像构建和容器启动已经通过。
