import { expect, test } from 'bun:test';
import { WorkQueue } from './queue.ts';

test('queue serializes visitor work while allowing another visitor to run', async () => {
  const queue = new WorkQueue(2);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const calls: string[] = [];
  const first = queue.submit('a', async () => { calls.push('a1'); return 1; }, () => waiting);
  const second = queue.submit('a', async () => { calls.push('a2'); return 2; }, async () => {});
  const third = queue.submit('b', async () => { calls.push('b'); return 3; }, async () => {});
  expect(await first).toBe(1); expect(await third).toBe(3);
  expect(calls).toEqual(['a1', 'b']);
  release(); expect(await second).toBe(2);
});
test('cancelled queued request never starts and excess requests are rejected', async () => {
  const queue = new WorkQueue(1);
  let release!: () => void;
  await queue.submit('a', async () => 1, () => new Promise<void>((resolve) => { release = resolve; }));
  const controller = new AbortController(); let started = false;
  const cancelled = queue.submit('a', async () => { started = true; }, async () => {}, controller.signal);
  const next = queue.submit('a', async () => 2, async () => {});
  await expect(queue.submit('a', async () => 3, async () => {})).rejects.toHaveProperty('code', 'QUEUE_FULL');
  controller.abort(); release();
  await expect(cancelled).rejects.toHaveProperty('code', 'REQUEST_CANCELLED');
  expect(started).toBe(false); expect(await next).toBe(2);
});
