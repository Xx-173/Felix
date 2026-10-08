import type { SameKeysAs } from '../keys.ts';
import type { events as enEvents } from '../en-US/events.ts';

export const events = {
  eyebrow: '市场日历',
  title: '重要事件',
  subtitle: '关注即将发布的财报，以及可能影响持仓的重要事件。',
  upcomingEyebrow: '今日及之后',
  upcomingTitle: '即将发生',
  loading: '正在加载即将发生的事件…',
  empty: '暂无近期事件。连接支持事件数据的数据源后，可在这里查看。',
  loadError: '暂时无法获取事件。请重试或检查行情数据连接。',
  event: '事件',
  marketEvent: '市场事件',
  noDescription: '暂无描述。',
  openResearch: '打开 {{symbol}} 的研究',
  catalystEyebrow: '事件影响',
  catalystTitle: 'Felix 研究助手',
  catalystEmpty: '选择与股票相关的事件，可进入研究页，或交给 AI 助手进一步分析。',
  catalystHint: '事件或研究数据不足时，会提示缺少哪些信息。',
} satisfies SameKeysAs<typeof enEvents>;
