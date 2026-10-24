import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildStatusLineSettings, sanitizeSnapshot, sanitizeStatusLineInput } from '../src/core/statusline.js';
import { installStatusLine, readSnapshots, statusLinePaths, statusLineStatus, watchSnapshots } from '../src/main/statusline.js';

test('statusLine conserva solo la ventana de cinco horas', () => {
  const snapshot = sanitizeStatusLineInput({ session_id: 'abc', model: 'secreto', context_window: { used_tokens: 10 }, transcript_path: 'secreto', rate_limits: { five_hour: { used_percentage: 27.4, resets_at: '2026-09-05T20:30:00Z' }, seven_day: { used_percentage: 80 } } }, 1234);
  assert.deepEqual(snapshot, { version: 1, sessionId: 'abc', rateLimits: { five_hour: { utilization: 27.4, resets_at: Date.parse('2026-09-05T20:30:00Z') } }, capturedAt: 1234 });
  assert.equal(JSON.stringify(snapshot).includes('secreto'), false);
  assert.equal(JSON.stringify(snapshot).includes('seven_day'), false);
});

test('statusLine falla cerrado sin id o porcentaje válido', () => {
  assert.equal(sanitizeStatusLineInput({ session_id: '../x', rate_limits: { five_hour: { used_percentage: 1 } } }), null);
  assert.equal(sanitizeStatusLineInput({ session_id: 'x', rate_limits: { five_hour: { used_percentage: null } } }), null);
  assert.equal(sanitizeSnapshot({ version: 1, sessionId: 'x', capturedAt: 1, rateLimits: {} }), null);
});

test('instalación es explícita, idempotente y conserva statusLine previa', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'usage-monitor-sl-'));
  const paths = statusLinePaths(home);
  await mkdir(path.dirname(paths.settingsFile), { recursive: true });
  await writeFile(paths.settingsFile, JSON.stringify({ statusLine: { type: 'command', command: 'mi-linea.sh', padding: 0 } }));
  assert.deepEqual(await statusLineStatus(home), { installed: false });
  assert.equal((await installStatusLine(home)).installed, true);
  assert.equal((await installStatusLine(home)).installed, true);
  const chain = JSON.parse(await readFile(paths.chainFile, 'utf8'));
  assert.equal(chain.chain.command, 'mi-linea.sh');
  const settings = JSON.parse(await readFile(paths.settingsFile, 'utf8'));
  assert.equal(settings.statusLine.padding, 0);
  assert.equal(buildStatusLineSettings(settings, 'otra').changed, false);
});

test('readSnapshots descarta archivos corruptos y ordena por fecha', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'usage-monitor-sl-'));
  const paths = statusLinePaths(home);
  await mkdir(paths.snapshotDir, { recursive: true });
  const snapshot = capturedAt => ({ version: 1, sessionId: `s${capturedAt}`, capturedAt, rateLimits: { five_hour: { utilization: 1 } } });
  await writeFile(path.join(paths.snapshotDir, 'a.json'), JSON.stringify(snapshot(10)));
  await writeFile(path.join(paths.snapshotDir, 'b.json'), JSON.stringify(snapshot(20)));
  await writeFile(path.join(paths.snapshotDir, 'bad.json'), 'bad');
  assert.deepEqual((await readSnapshots(home)).map(item => item.capturedAt), [20000, 10000]);
});

test('watchSnapshots entrega solo el snapshot saneado que escribe el colector', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'usage-monitor-sl-'));
  assert.equal(watchSnapshots(home, () => {}), null);
  const paths = statusLinePaths(home);
  await mkdir(paths.snapshotDir, { recursive: true });
  const received = [];
  const watcher = watchSnapshots(home, snapshot => received.push(snapshot));
  try {
    await writeFile(path.join(paths.snapshotDir, 'roto.json'), '{');
    // Mismo patrón que el colector: temporal y rename atómico.
    const target = path.join(paths.snapshotDir, 'abc.json');
    await writeFile(`${target}.1.tmp`, JSON.stringify({ version: 1, sessionId: 'abc', capturedAt: 1790000000000, transcript: 'secreto', rateLimits: { five_hour: { utilization: 61, resets_at: 1800000000000 } } }));
    await rename(`${target}.1.tmp`, target);
    for (let waited = 0; !received.length && waited < 3000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(received, [{ version: 1, sessionId: 'abc', rateLimits: { five_hour: { utilization: 61, resets_at: 1800000000000 } }, capturedAt: 1790000000000 }]);
  } finally { watcher.close(); }
});
