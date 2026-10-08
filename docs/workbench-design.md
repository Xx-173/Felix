# 桌面版与网页版界面调整

两端共用 `packages/ui/src/styles/workbench.css` 和组件。参考
[tickflow-stock-panel 的布局](https://github.com/hzy1522/tickflow-stock-panel/blob/main/frontend/src/components/Layout.tsx)
及其细边框、紧凑导航和明暗配色的组织方式；本次没有引入该项目的组件、图片、业务功能或依赖。

## 调整内容

- 侧栏默认 224px，可拖动至 200–280px。隐藏研究助手时保持侧栏宽度，拖动偏好继续保存。
- 顶部显示当前页面和主题／助手开关。股票详情的四个标签页集中在行情卡片下方，完整页面入口保留。
- 浏览器账号栏收紧为身份、管理员入口和账号菜单；导出、修改密码、退出和删除仍可使用。桌面版沿用本地账户行为。
- `BilingualLabel` 将中文和括号内英文区分主次；按钮及表单保留完整的无障碍名称。图表提示也使用中文（English）。
- 通用字体重置进入 Tailwind base 层，避免覆盖按钮、输入框和标签页的明确字号。设置标签保持单行，可横向滚动；内容区域独立滚动。
- 卡片、周期按钮、输入框、导航和主操作使用统一配色。主题按钮支持浅色、深色及系统主题，图表文字随主题变化。
- 修正内置示例 K 线的指数放大公式：从最新行情向前逐日生成价格，最新收盘／开盘／最高／最低／成交量与行情卡片一致，保留示例标记。真实供应商的数据继续原样使用。

## 验证

2026-10-08 本机完成 `bun run typecheck`、`bun run i18n:check`、网页与 Electron 构建；全仓单元测试 1749 通过、18 跳过、0 失败。示例行情回归测试覆盖四种标的的最新价与历史一致、每日涨跌连续、OHLC 区间有效、确定性及真实数据不变。

`bun run web:e2e` 覆盖完整导航、研究与下载、BYOK、账户生命周期和手机宽度，并检查助手隐藏前后的侧栏宽度及页面溢出。`node apps/web/e2e/admin-smoke.mjs` 使用独立数据库验证管理员权限和模型域名设置。

`bun run --cwd apps/electron test:storage-smoke` 使用独立临时配置和真实 Electron 进程，验证中文行情标签、主题切换、SQLite 迁移、资料持久化和重启。截图阶段使用现有的离屏渲染选项，避免隐藏窗口停止绘制，不打开用户窗口。

截图输出在忽略目录 `artifacts/web/`：`workbench-light.png`、`workbench-dark.png`、`settings-models.png`、`web-account-desktop.png`、`web-mobile.png`、`admin-settings.png`、`desktop-workbench.png` 和 `desktop-workbench-dark.png`。
