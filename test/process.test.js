import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveExecutable } from '../src/main/process.js';

test('resolveExecutable busca en el PATH sin usar el shell', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'usage-monitor-bin-'));
  const name = process.platform === 'win32' ? 'herramienta.cmd' : 'herramienta';
  const file = path.join(dir, name);
  await writeFile(file, '');
  chmodSync(file, 0o755);

  // La extensión sale del PATHEXT, que en Windows viene en mayúsculas y no distingue caso.
  const env = { PATH: dir, PATHEXT: '.CMD' };
  assert.equal(resolveExecutable('herramienta', env).toLowerCase(), file.toLowerCase());
  assert.equal(resolveExecutable('no-existe', env), null);
});
