import type { SameKeysAs } from '../keys.ts';
import type { thesis as enThesis } from '../en-US/thesis.ts';

/** 投资逻辑界面(规格 §30)。 */
export const thesis = {
  thesis: '投资逻辑',
  saveAsThesis: '存为投资逻辑',
  selectSymbol: '请选择一个标的以查看其投资逻辑。',
  noReportFor: "{{symbol}} 还没有研究报告。先完成深度研究，再把结论保存为投资逻辑。",
  noneSaved: '尚未保存投资逻辑。',
  reEvaluateComplete: "已重新评估，请查看下方结果。",
  reEvaluationHistory: '重新评估历史',
  lastReviewed: '最近复核 {{date}}',
  edit: '编辑',
  reEvaluate: '重新评估',
  bull: '看多',
  bear: '看空',
  catalysts: "潜在催化因素",
  risks: '风险',
  stance: {
    bullish: '看多',
    bearish: '看空',
    neutral: '中性',
  },
  empty: {
    title: '跟踪你的投资逻辑',
    subtitle: '先对一只股票做深度研究，再把结论保存到这里。',
    goResearch: '开始研究',
  },
  monitor: '跟踪',
  monitoredHint: '重要变化发生时我们会提醒你。',
  editor: {
    stance: "投资判断",
    coreThesis: '核心逻辑',
    bullCase: '看多逻辑',
    bearCase: '看空逻辑',
    catalysts: "潜在催化因素",
    risks: '风险',
    onePointPerLine: '每行一个要点',
    targetPriceOptional: '目标价(选填)',
    targetPricePlaceholder: '例如 250.00',
    saving: '保存中…',
  },
  impact: {
    noneYet: '暂无重新评估。',
    unchanged: '未变化',
    strengthened: '增强',
    weakened: '减弱',
    invalidated: '失效',
  },
} satisfies SameKeysAs<typeof enThesis>;
