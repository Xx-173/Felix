export interface LimitLadderStock {
  symbol: string;
  name: string;
  boards: number;
  price: number;
  changePercent: number;
  industry?: string;
  brokenCount?: number;
}
export interface LimitLadderSnapshot {
  date: string;
  fetchedAt: number;
  source: 'eastmoney' | 'demo';
  stocks: LimitLadderStock[];
}
