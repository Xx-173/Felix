# 研究可信度与验收

本次改动在评测和报告之间明确区分了三件事：运行完成、存在来源、结论获来源支持。

## 行为评测

评测将缺少必需工具、调用禁止工具、参数无效、缺少必需证据、超过工具次数和空回答转为失败标签，参与案例判定。无需工具的解释性任务仍可通过。

必需证据不满足新鲜度要求时也判失败；有独立 judge 的运行，groundedness 低于 0.8 对应“关键事实未获支持”，进入失败判定。judge 错误保持未测状态，不冒充零分或通过。

CLI 默认要求通过率达到 1，使用 `--min-pass-rate 0.8` 可显式设定实验门槛。门槛和相对基线分别判断；低质量基线不能使未完成任务变成通过。产物保留 `qualityPassed`、门槛、逐例评分和失败标签。旧实验不重写，旧基线不为使新检查变绿而降低。

`eval-smoke.yml` 当前仅手动执行；PR 的类型检查和工作区测试会覆盖新增判定回归测试。15 条 fixture benchmark 运行的是能力有限的本地规则 Agent，不能代表 Pi/LLM 的能力；修正后暴露的失败需要作为真实能力缺口保留。

## 报告验证

研究报告新增 `claimVerification`：分别检查摘要、各章节文字及看多、看空、催化和风险列表项。每个文本单元按整体核查，尚未进行原子事实拆分。

状态为：`supported`（来源支持）、`contradicted`（矛盾）、`insufficient_evidence`（不足）、`not_checked`（未验证）。模型判断仍可能出错，不是事实证明。章节仅使用该章节对应能力的成功结果；全局分析使用本次运行的成功结果。失败工具、生成的章节摘要和验证器理由不充当源证据。

UI 显示支持数量与总数，逐条展开结果；旧报告明确标注尚未验证。Markdown 导出保留验证状态和来源执行 ID。研究置信度不表示经过校准的投资成功概率。

默认不增加付费调用。桌面端通过以下环境配置启用独立验证模型：

```text
FINAGENT_VERIFY_CLAIMS=1
FINAGENT_JUDGE_PROVIDER=openai-compatible
FINAGENT_JUDGE_MODEL=<独立验证模型>
FINAGENT_JUDGE_API_KEY=<由外部环境提供>
FINAGENT_JUDGE_BASE_URL=<可选的兼容服务地址>
```

选择与研究模型不同的验证模型。启用后，本次研究源数据会发送到你配置的验证提供商；如报告包含组合上下文，该上下文也可能进入验证请求。不要把真实密钥写入仓库。缺少必要配置会明确报错，不静默跳过。

每份报告最多增加 12 次验证调用，每次 15 秒超时，计入持久研究预算。超时或无效输出标为证据不足；超出调用上限标为未验证。结果逐条保存，重启后复用已保存结果，不退还已经发起的调用预算。取消不会发布新的验证报告。验证中断且未保存结果的调用，在剩余预算内可重试。

## 可复现的验收

```powershell
# 默认离线验收：脚本化数据和验证器，验证不支持的因果结论被标记
bun run research:acceptance -- --mode fixture

# 独立模型与真实公开数据：先在外部环境配置下面列出的变量
bun run research:acceptance -- --mode live --symbol NVDA.US

# Agent 行为评测：失败时退出 1 并保留诊断
bun run eval:smoke -- --mode fixture --store artifacts/eval-store --out artifacts/eval-smoke.json
```

真实验收还需要安装并认证 Longbridge CLI；研究模型使用 `FINAGENT_ACCEPTANCE_AGENT_PROVIDER`、`FINAGENT_ACCEPTANCE_AGENT_MODEL`、`FINAGENT_ACCEPTANCE_AGENT_API_KEY`、可选 `FINAGENT_ACCEPTANCE_AGENT_BASE_URL`，验证模型使用上述 `FINAGENT_JUDGE_*` 配置。两个模型必须不同。

验收使用 `value` 策略，只保留公开只读能力，不调用持仓、资产、现金流或交易接口。产物包含公开数据快照、来源时间、持久检查点、报告和验证结果。真实模式要求所有计划能力完成且所有声明获来源支持才通过；错误、证据不足或未验证均不能冒充成功。

该脚本验证 ResearchService/ResearchRunner 和直接模型调用，不验证 Pi RPC、Electron IPC、桌面交互或投资收益。fixture 产物只证明回归链路，不能写成真实金融研究验收通过。

发布前还应人工抽查财务单位、币种、报告期、复权口径、数字引用及因果推断。校准权重仍只供观察，尚不影响研究规划。
