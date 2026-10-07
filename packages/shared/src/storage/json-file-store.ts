import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { createCodeError } from '../agent/errors.ts';

export interface JsonStoreBackend {
  read<T>(path: string, fallback: T): Promise<T>;
  write(path: string, data: unknown): Promise<void>;
  remove(path: string): Promise<void>;
  listFiles?(directory: string): Promise<string[]>;
}
const backends = new Map<string, JsonStoreBackend>();
/** Register the desktop/server database boundary; standalone stores use atomic files. */
export function registerJsonStoreBackend(root: string, backend: JsonStoreBackend): () => void {
  const prefix = resolve(root) + sep;
  if (backends.has(prefix)) throw new Error('Storage root already registered');
  backends.set(prefix, backend);
  return () => { if (backends.get(prefix) === backend) backends.delete(prefix); };
}
function backendFor(path: string): JsonStoreBackend | undefined {
  const target = resolve(path);
  return [...backends.entries()].sort((a, b) => b[0].length - a[0].length).find(([prefix]) => target.startsWith(prefix))?.[1];
}

const publishLocks = new Map<string, Promise<void>>();

/**
 * Serialize only the final replacement for a target. Temporary files can be
 * prepared concurrently, while Windows gets a deterministic replacement
 * order when several store instances publish the same target at once.
 */
async function publish(target: string, tmp: string): Promise<void> {
  const previous = publishLocks.get(target) ?? Promise.resolve();
  let current: Promise<void>;
  current = previous
    .catch(() => undefined)
    .then(() => rename(tmp, target));
  publishLocks.set(target, current);
  try {
    await current;
  } finally {
    if (publishLocks.get(target) === current) publishLocks.delete(target);
  }
}

/**
 * Repository persistence routed to a registered database or atomic JSON files.
 *
 * Writes go to an exclusively created, per-write temporary file in the target
 * directory and are renamed into place, so concurrent writers never share a
 * staging file. Database-backed repositories keep the same document interface.
 */
export class JsonFileStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  resolve(file: string): string {
    return join(this.rootDir, file);
  }

  isBackendManaged(file: string): boolean { return !!backendFor(this.resolve(file)); }

  async listFiles(directory: string): Promise<string[]> {
    const backend = backendFor(this.resolve(join(directory, '.listing')));
    if (backend) {
      if (!backend.listFiles) throw new Error('Storage backend does not support file listing.');
      return backend.listFiles(this.resolve(directory));
    }
    try { return await readdir(this.resolve(directory)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }

  async read<T>(file: string, fallback: T): Promise<T> {
    const backend = backendFor(this.resolve(file));
    if (backend) return backend.read(this.resolve(file), fallback);
    try {
      const contents = await readFile(join(this.rootDir, file), 'utf8');
      return JSON.parse(contents) as T;
    } catch (error) {
      if (
        error instanceof Error &&
        typeof (error as NodeJS.ErrnoException).code === 'string' &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return fallback;
      }
      throw createCodeError(
        'STORAGE_READ_FAILED',
        `Failed to read ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async write(file: string, data: unknown): Promise<void> {
    const target = this.resolve(file);
    const backend = backendFor(target);
    if (backend) return backend.write(target, data);
    const tmp = `${target}.${randomUUID()}.tmp`;
    let ownsTemp = false;
    try {
      const contents = `${JSON.stringify(data, null, 2)}\n`;
      await mkdir(dirname(target), { recursive: true });
      const handle = await open(tmp, 'wx', 0o600);
      ownsTemp = true;
      try {
        await handle.writeFile(contents, 'utf8');
      } finally {
        await handle.close();
      }
      await publish(target, tmp);
      ownsTemp = false;
    } catch (error) {
      throw createCodeError(
        'STORAGE_WRITE_FAILED',
        `Failed to write ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      if (ownsTemp) {
        // Only clean up this writer's file; never remove the last good target
        // or another writer's staging file. Preserve the original write error.
        await unlink(tmp).catch((cleanupError: unknown) => {
          const code = (cleanupError as NodeJS.ErrnoException)?.code;
          if (code !== 'ENOENT') {
            console.warn('[JsonFileStore] Temporary-file cleanup failed:', code ?? 'UNKNOWN');
          }
        });
      }
    }
  }

  async remove(file: string): Promise<void> {
    const backend = backendFor(this.resolve(file));
    if (backend) return backend.remove(this.resolve(file));
    try {
      await unlink(join(this.rootDir, file));
    } catch (error) {
      if (
        error instanceof Error &&
        typeof (error as NodeJS.ErrnoException).code === 'string' &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }
}
