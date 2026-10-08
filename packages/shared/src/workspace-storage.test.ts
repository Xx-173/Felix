import { describe, expect, it } from 'bun:test';
import { updateWorkspaceDocument } from './workspace-storage.ts';

describe('personal workspace groups', () => {
  const previous = { watchlist: ['AAPL.US', 'MSFT.US'], groups: [{ id: 'long-term', name: '长期关注', symbols: ['AAPL.US', 'MSFT.US'] }] };
  it('preserves groups for legacy callers and prunes removed symbols', () => {
    expect(updateWorkspaceDocument({ watchlist: ['MSFT.US', 'MSFT.US'] }, previous)).toEqual({ watchlist: ['MSFT.US'], groups: [{ id: 'long-term', name: '长期关注', symbols: ['MSFT.US'] }] });
  });
  it('keeps a plain legacy document compatible and allows explicit group removal', () => {
    expect(updateWorkspaceDocument({ watchlist: ['AAPL.US'] }, { watchlist: [] })).toEqual({ watchlist: ['AAPL.US'] });
    expect(updateWorkspaceDocument({ watchlist: previous.watchlist, groups: [] }, previous)).toEqual({ watchlist: previous.watchlist });
  });
  it('rejects duplicate group identity or name and excessive input', () => {
    expect(() => updateWorkspaceDocument({ ...previous, groups: [...previous.groups, { id: 'another', name: ' 长期关注 ', symbols: [] }] }, previous)).toThrow('unique');
    expect(() => updateWorkspaceDocument({ ...previous, groups: [...previous.groups, { id: 'long-term', name: '其他', symbols: [] }] }, previous)).toThrow('unique');
    expect(() => updateWorkspaceDocument({ watchlist: Array(41).fill('AAPL.US') }, previous)).toThrow();
    expect(() => updateWorkspaceDocument({ watchlist: [], groups: [{ id: 'bad', name: ' ', symbols: [] }] }, previous)).toThrow();
  });
});
