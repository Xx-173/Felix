import { createCodeError } from '../../../packages/shared/src/agent/errors.ts';

/** Bound admission globally and serialize each visitor's background jobs. */
export class WorkQueue {
  private active = 0;
  private readonly visitors = new Set<string>();
  private readonly pending: Array<{ visitor: string; execute: () => Promise<void>; reject: (error: Error) => void }> = [];
  constructor(private readonly concurrency = 2, private readonly capacity = 32) {}
  get busyVisitors() { return new Set([...this.visitors, ...this.pending.map((item) => item.visitor)]); }

  submit<T>(visitor: string, start: () => Promise<T>, settled: (value: T) => Promise<void>, signal?: AbortSignal): Promise<T> {
    if (this.pending.length >= this.capacity) return Promise.reject(createCodeError('QUEUE_FULL', 'The research queue is full. Try again shortly.'));
    if (this.pending.filter((item) => item.visitor === visitor).length >= 2) {
      return Promise.reject(createCodeError('QUEUE_FULL', 'This visitor already has two waiting requests.'));
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ visitor, reject, execute: async () => {
        try {
          if (signal?.aborted) throw createCodeError('REQUEST_CANCELLED', 'Request cancelled before it started.');
          const result = await start();
          resolve(result);
          await settled(result);
        } catch (error) { reject(error); }
      } });
      this.drain();
    });
  }

  close() {
    for (const item of this.pending.splice(0)) item.reject(createCodeError('SERVER_STOPPING', 'Server is stopping.'));
  }

  private drain() {
    while (this.active < this.concurrency) {
      const index = this.pending.findIndex((item) => !this.visitors.has(item.visitor));
      if (index < 0) return;
      const item = this.pending.splice(index, 1)[0];
      this.active++;
      this.visitors.add(item.visitor);
      void item.execute().finally(() => {
        this.active--;
        this.visitors.delete(item.visitor);
        this.drain();
      });
    }
  }
}
