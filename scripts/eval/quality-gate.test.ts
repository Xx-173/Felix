import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('exits nonzero for an answered fixture case with missing tools despite the old baseline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'felix-quality-gate-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/eval/run.ts', '--smoke', '--mode', 'fixture',
      '--max-cases', '1', '--baseline', 'folio-agent-v1', '--store', dir, '--out', join(dir, 'result.json')], {
      cwd: join(import.meta.dir, '..', '..'), encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, FINAGENT_JUDGE_PROVIDER: '', FINAGENT_JUDGE_MODEL: '', FINAGENT_JUDGE_API_KEY: '',
        LANGFUSE_TRACING: '0', TRACE_TO_LANGSMITH: '0' },
    });
    expect(result.status).toBe(1);
    const artifact = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
    expect(artifact.results[0].verdict).toBe('fail');
    expect(artifact.results[0].failureModes).toContain('missing_tool');
    expect(artifact.qualityPassed).toBe(false);
    expect(artifact.minPassRate).toBe(1);
    expect(artifact.exitCode).toBe(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
