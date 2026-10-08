import { z } from 'zod';
import { MAX_WATCHLIST_GROUPS, MAX_WATCHLIST_SYMBOLS, type PersonalWorkspace } from '@finagent/core';

const symbol = z.string().regex(/^[A-Z0-9]{1,6}\.(US|HK|SG|SH|SZ|HAS)$/);
const group = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().trim().min(1).max(40),
  symbols: z.array(symbol).max(MAX_WATCHLIST_SYMBOLS),
});
const schema = z.object({
  watchlist: z.array(symbol).max(MAX_WATCHLIST_SYMBOLS),
  groups: z.array(group).max(MAX_WATCHLIST_GROUPS).optional(),
});

/** One validation policy for SQLite desktop and SQLite/PostgreSQL web documents. */
export function updateWorkspaceDocument(input: unknown, previous: PersonalWorkspace): PersonalWorkspace {
  const value = schema.parse(input);
  const watchlist = [...new Set(value.watchlist)];
  const groups = (value.groups ?? previous.groups ?? []).map((entry) => ({
    ...entry, symbols: [...new Set(entry.symbols)].filter((symbol) => watchlist.includes(symbol)),
  }));
  if (new Set(groups.map((entry) => entry.id)).size !== groups.length
      || new Set(groups.map((entry) => entry.name.toLowerCase())).size !== groups.length) {
    throw new Error('分组名称和标识必须唯一（Group names and IDs must be unique）。');
  }
  return { watchlist, ...(groups.length > 0 ? { groups } : {}) };
}
