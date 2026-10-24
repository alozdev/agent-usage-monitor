import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installStatusLine, readSnapshots, statusLinePaths } from '../src/main/statusline.js';

test('el colector guarda únicamente el límite primario de Claude', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'usage-monitor-col-'));
  const paths = statusLinePaths(home);
  await installStatusLine(home);
  const payload = JSON.stringify({ session_id: 'viva', model: 'secreto', context_window: { used_tokens: 9 }, rate_limits: { five_hour: { utilization: 27 }, seven_day: { utilization: 80 } } });
  const run = spawnSync(process.execPath, [paths.collector], { input: payload, encoding: 'utf8' });
  assert.equal(run.status, 0);
  const [snapshot] = await readSnapshots(home);
  assert.equal(snapshot.rateLimits.five_hour.utilization, 27);
  assert.equal(JSON.stringify(snapshot).includes('secreto'), false);
  assert.equal(JSON.stringify(snapshot).includes('seven_day'), false);
});
