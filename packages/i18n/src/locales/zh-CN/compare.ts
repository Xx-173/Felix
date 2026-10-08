import type { SameKeysAs } from '../keys.ts';
import type { compare as enCompare } from '../en-US/compare.ts';

/** Compare slice (spec §32) — Simplified Chinese (glossary-aligned). */
export const compare = {
  metric: '指标',
  title: "股票对比（2–4 只）",
  symbolPlaceholder: '代码，例如 AAPL.US',
  addTwo: "添加至少两只股票，查看财务、估值和行情差异。",
  agentContext: "打开 AI 助手时，可选择这些股票继续比较。",
  unavailable: '当前环境无法进行对比。',
  metrics: {
    price: '价格',
    marketCap: '市值',
    pe: '市盈率',
    pb: '市净率',
    revenueGrowth: '营收增长',
    grossMargin: '毛利率',
    roe: '净资产收益率',
    dividendYield: '股息率',
    return1m: "近 1 个月涨跌幅",
    return3m: "近 3 个月涨跌幅",
    return1y: "近 1 年涨跌幅",
    analystRating: '分析师评级',
    momentum: '动量',
  },
} satisfies SameKeysAs<typeof enCompare>;
