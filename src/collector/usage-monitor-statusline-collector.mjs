#!/usr/bin/env node
/**
 * Colector `statusLine` de Agent Usage Monitor.
 *
 * Se instala mediante el botón explícito de la aplicación. Lee el JSON oficial que
 * Claude Code entrega por stdin, guarda solo métricas permitidas y vuelve a ejecutar
 * la `statusLine` que existiera antes, reenviándole el mismo stdin y su salida.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeStatusLineInput } from './statusline-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chainFile = path.join(here, 'statusline-chain.json');
const snapshotDir = path.join(here, 'snapshots');

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function writeSnapshot(snapshot) {
  mkdirSync(snapshotDir, { recursive: true });
  const target = path.join(snapshotDir, `${snapshot.sessionId}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(snapshot));
  renameSync(temporary, target);
}

function runChain(payload) {
  let chain;
  try { chain = JSON.parse(readFileSync(chainFile, 'utf8')).chain; } catch { return null; }
  if (!chain?.command) return null;
  const result = spawnSync(chain.command, {
    shell: true,
    input: payload,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  return result.stdout || null;
}

const payload = readStdin();
let parsed = null;
try { parsed = JSON.parse(payload); } catch { parsed = null; }

const snapshot = sanitizeStatusLineInput(parsed);
if (snapshot) {
  try { writeSnapshot(snapshot); } catch { /* la statusLine nunca falla por el colector */ }
}

const chained = runChain(payload);
process.stdout.write(chained ?? 'agent-usage-monitor\n');
