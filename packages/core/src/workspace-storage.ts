export const MAX_WATCHLIST_SYMBOLS = 40;
export const MAX_WATCHLIST_GROUPS = 20;

export interface WatchlistGroup {
  id: string;
  name: string;
  symbols: string[];
}

/** Legacy documents contain only watchlist; groups are optional for compatibility. */
export interface PersonalWorkspace {
  watchlist: string[];
  groups?: WatchlistGroup[];
}
