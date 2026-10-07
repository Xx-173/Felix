import { afterEach, describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import {
  getPiCwd,
  getPiExtensionEntry,
  getRuntimeRoot,
  getSkillsDir,
  isPackaged,
} from './resource-locator.ts';

const PACKAGED = 'FINAGENT_PACKAGED';
const saved = process.env[PACKAGED];

afterEach(() => {
  if (saved === undefined) {
    delete process.env[PACKAGED];
  } else {
    process.env[PACKAGED] = saved;
  }
});

describe('ResourceLocator (dev mode)', () => {
  it('resolves the repo root from import.meta.url, not process.cwd()', () => {
    delete process.env[PACKAGED];
    // Bun tests run under the repo root; the module must not depend on it.
    const root = getRuntimeRoot();
    expect(getSkillsDir()).toBe(resolve(root, 'skills'));
    expect(getPiCwd()).toBe(root);
  });

  it('resolves the dev Pi extension entry to the source .ts file', () => {
    delete process.env[PACKAGED];
    expect(getPiExtensionEntry()).toBe(resolve(getRuntimeRoot(), '.pi', 'extensions', 'finagent', 'index.ts'));
  });

  it('does not report packaged without a real resourcesPath (non-Electron env)', () => {
    process.env[PACKAGED] = '1';
    // No process.resourcesPath in a bare Node/Bun process -> still dev.
    expect(isPackaged()).toBe(false);
  });
});

it('accepts Windows lowercase resources and macOS Resources in packaged mode', () => {
  const proc = process as NodeJS.Process & { resourcesPath?: string };
  const previous = proc.resourcesPath;
  try {
    process.env[PACKAGED] = '1';
    proc.resourcesPath = resolve('windows-package', 'resources');
    expect(isPackaged()).toBe(true);
    expect(getSkillsDir()).toBe(resolve(proc.resourcesPath, 'skills'));
    proc.resourcesPath = resolve('mac-package', 'Resources');
    expect(isPackaged()).toBe(true);
  } finally { if (previous === undefined) Reflect.deleteProperty(proc, 'resourcesPath'); else proc.resourcesPath = previous; }
});
