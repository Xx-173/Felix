/** Fixed product metadata only. Never apply this to notes, news or generated prose. */
const terms: Record<string, string> = {
  '1m': '1 分钟', '5m': '5 分钟', '15m': '15 分钟', '1h': '小时线', '1d': '日线', '1w': '周线',
  'S&P 500': '标普 500', 'Nasdaq 100': '纳斯达克 100', open: '开市', closed: '休市',
  Off: '关闭', Minimal: '极低', Low: '低', Medium: '中', High: '高', Xhigh: '极高',
  off: '关闭', low: '低', medium: '中', high: '高', local: '本地规则',
  'web-api': '网页接口', 'pi-runtime': '智能体运行时', idle: '空闲', running: '运行中',
  Ready: '就绪', Partial: '部分可用', Unavailable: '不可用',
  Quote: '行情', KLine: 'K 线', News: '新闻', Financials: '财务', Portfolio: '投资组合',
  Watchlist: '自选', Thesis: '投资论点', Alert: '提醒', Automation: '自动研究',
  'Not installed': '未安装', 'Not connected': '未连接', Connecting: '连接中',
  Connected: '已连接', 'Permission limited': '权限受限', Expired: '已过期', Error: '错误',
  read_only: '只读', read: '读取', standard: '标准', minimal: '最少', full: '完整',
};
export function uiTerm(value: string): string { return terms[value] ?? value; }
const skillNames: Record<string, string> = {
  longbridge: '长桥金融工具', 'longbridge-market-data': '长桥行情数据',
  'longbridge-fundamentals': '长桥基本面分析', 'longbridge-technical': '长桥技术分析',
  'longbridge-research': '长桥综合研究', 'longbridge-portfolio': '长桥组合分析',
  'longbridge-earnings': '长桥财报研究', 'longbridge-value-investing': '长桥价值投资',
  'longbridge-quant': '长桥量化分析', 'longbridge-content': '长桥资讯研究',
  'longbridge-intel': '长桥市场情报', 'longbridge-derivatives': '长桥衍生品分析',
  'longbridge-watchlist': '长桥自选管理',
};
export function skillDisplayName(id: string, name: string): string {
  return skillNames[id] ?? name;
}
const skillDescriptions: Record<string, string> = {
  longbridge: '使用长桥金融工具获取行情、财务信息和组合数据。',
  'longbridge-market-data': '查询证券行情、K 线、交易数据和市场状态。',
  'longbridge-fundamentals': '研究公司财务、估值、盈利预测和机构评级。',
  'longbridge-technical': '使用价格、成交量和技术指标分析趋势与风险。',
  'longbridge-research': '组织证据、开展多维研究并形成投资研究报告。',
  'longbridge-portfolio': '分析持仓结构、资产配置和组合风险。',
  'longbridge-earnings': '研究财报、盈利预期及相关事件。',
  'longbridge-value-investing': '使用格雷厄姆和巴菲特的方法评估价值、安全边际与护城河，并交叉核对财务报表。',
  'longbridge-quant': '使用量化方法进行证券分析与比较。',
  'longbridge-content': '检索和研究新闻、公告及相关金融内容。',
  'longbridge-intel': '筛选证券机会并研究市场异动与情报。',
  'longbridge-derivatives': '研究期权、权证等衍生品与风险指标。',
  'longbridge-watchlist': '组织自选证券、观察列表和提醒。',
};
export function skillDisplayDescription(id: string, description: string): string {
  return skillDescriptions[id] && description && !/[\u4e00-\u9fff]/.test(description.slice(0, 120))
    ? skillDescriptions[id] : description;
}

const metricNames: Record<string, string> = { Last: '最新价', 'Change %': '涨跌幅', Open: '开盘价', High: '最高价', Low: '最低价', 'Prev close': '昨收价', Volume: '成交量', Symbol: '证券代码', Qty: '数量', Value: '市值', Weight: '权重', 'P&L %': '盈亏比例', '30d volatility': '30 日波动率', 'Day change': '当日涨跌', price: '价格', percent: '百分比', count: '数量', ratio: '比率' };
export function metricDisplayLabel(value: string): string { return metricNames[value] ?? value; }
export function blockDisplayTitle(value: string): string {
  const match = /^([A-Z0-9.]+) (key metrics|daily close \(30d\))$/.exec(value);
  return match ? `${match[1]} ${match[2] === 'key metrics' ? '关键指标' : '每日收盘价（30 日）'}` : value;
}
