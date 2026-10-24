import { watch } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStatusLineSettings, isCollectorCommand, sanitizeSnapshot } from '../core/statusline.js';

const sourceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'collector');
export function statusLinePaths(home) {
  const installDir = path.join(home, '.usage-monitor', 'statusline');
  return { installDir, collector: path.join(installDir, 'usage-monitor-statusline-collector.mjs'), core: path.join(installDir, 'statusline-core.mjs'), chainFile: path.join(installDir, 'statusline-chain.json'), snapshotDir: path.join(installDir, 'snapshots'), settingsFile: path.join(home, '.claude', 'settings.json') };
}
async function readJson(file, fallback = null) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }
async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}
export async function statusLineStatus(home) {
  const paths = statusLinePaths(home);
  const settings = await readJson(paths.settingsFile, {});
  return { installed: isCollectorCommand(settings?.statusLine?.command) };
}
export async function installStatusLine(home) {
  const paths = statusLinePaths(home);
  await mkdir(paths.snapshotDir, { recursive: true });
  await writeFile(paths.collector, await readFile(path.join(sourceDir, 'usage-monitor-statusline-collector.mjs')));
  await writeFile(paths.core, await readFile(path.join(sourceDir, '..', 'core', 'statusline.js')));
  const settings = await readJson(paths.settingsFile, {}) || {};
  const result = buildStatusLineSettings(settings, `node "${paths.collector}"`);
  if (result.changed) {
    await writeJsonAtomic(paths.chainFile, { chain: result.chain });
    await writeJsonAtomic(paths.settingsFile, result.settings);
  }
  return statusLineStatus(home);
}
export async function readSnapshots(home) {
  const paths = statusLinePaths(home);
  let entries;
  try { entries = await readdir(paths.snapshotDir); } catch { return []; }
  const snapshots = await Promise.all(entries.filter(name => name.endsWith('.json')).map(async name => sanitizeSnapshot(await readJson(path.join(paths.snapshotDir, name)))));
  return snapshots.filter(Boolean).sort((a, b) => b.capturedAt - a.capturedAt);
}
/**
 * Avisa en cuanto el colector escribe un snapshot. Relee solo los archivos que cambiaron,
 * porque el directorio acumula uno por sesión. Devuelve `null` si el directorio aún no existe;
 * si deja de existir, se cierra y llama a `onClosed` para que se vuelva a intentar.
 */
export function watchSnapshots(home, onSnapshot, onClosed = () => {}, delayMs = 100) {
  const { snapshotDir } = statusLinePaths(home);
  const changed = new Set();
  let timer;
  let watcher;
  async function flush() {
    const names = [...changed];
    changed.clear();
    for (const name of names) {
      const snapshot = sanitizeSnapshot(await readJson(path.join(snapshotDir, name)));
      if (snapshot) onSnapshot(snapshot);
    }
  }
  try {
    watcher = watch(snapshotDir, (_event, name) => {
      if (typeof name !== 'string' || !name.endsWith('.json')) return;
      changed.add(path.basename(name));
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    });
  } catch { return null; }
  const close = () => { clearTimeout(timer); watcher.close(); };
  watcher.on('error', () => { close(); onClosed(); });
  return { close };
}
