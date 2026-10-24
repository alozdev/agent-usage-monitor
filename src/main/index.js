import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen } from 'electron';
import glass from '@hicccc77/electron-liquid-glass';
import { watch } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_STALE_MS, isStale, projectClaude } from '../core/limits.js';
import { createClaudeClient, createCodexClient } from './data.js';
import { installStatusLine, statusLineStatus } from './statusline.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SIZE = { width: 98, height: 194 };
const EXPANDED_SIZE = { width: 384, height: 256 };
// Codex no avisa de lo que consumen otras instancias: su app-server solo emite cambios de sus
// propios turnos, así que se lee al backend cuando cambia una sesión local y, para el uso desde
// otros equipos, también cada 15 s. Claude consulta el uso de cuenta sin enviar prompts.
const CLAUDE_POLL_MS = 60000;
const CODEX_POLL_MS = 15000;
const CODEX_RETRY_MS = 60000;
const CODEX_KICK_MS = 2000;
let mainWindow;
let panelExpanded = false;
let glassPanel;
let glassScale;
let glassLightText = { claude: false, codex: false, footer: false };
let glassCapturePolicy = 'all';
let saveTimer;
let codexTimer;
let codexKick;
let codexRead = null;
let codexWatcher = null;
let claudeTimer;
let claudeRead = null;
const claude = createClaudeClient();
const codex = createCodexClient();
let limitsCache = { claude: { value: null }, codex: { value: null } };
const settingsPath = () => path.join(app.getPath('userData'), 'window.json');

async function readSettings() { try { return JSON.parse(await readFile(settingsPath(), 'utf8')); } catch { return {}; } }
async function writePosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { x, y } = mainWindow.getBounds();
  const target = settingsPath();
  const temporary = `${target}.${process.pid}.tmp`;
  const capsuleX = x + (panelExpanded ? EXPANDED_SIZE.width - SIZE.width : 0);
  try { await mkdir(path.dirname(target), { recursive: true }); await writeFile(temporary, JSON.stringify({ x: capsuleX, y })); await rename(temporary, target); } catch { /* no impide cerrar */ }
}
function schedulePositionSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => void writePosition(), 400); }
function harden(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
}
function updateGlassContrast(bands) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const contrast = { ...glassLightText };
  for (const [id, key] of ['claude', 'codex', 'footer'].entries()) {
    if (!bands[id]) continue;
    const { r, g, b } = bands[id];
    const luma = .2126 * r + .7152 * g + .0722 * b;
    // La separación entre umbrales evita parpadeos al moverlo sobre tonos medios.
    contrast[key] = luma < (glassLightText[key] ? 145 : 115);
  }
  if (Object.keys(contrast).every(key => contrast[key] === glassLightText[key])) return;
  glassLightText = contrast;
  mainWindow.webContents.send('monitor:glass', contrast);
}
function syncGlass() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getContentBounds();
  const { scaleFactor } = screen.getDisplayMatching(bounds);
  const origin = screen.dipToScreenPoint({ x: bounds.x + 28, y: bounds.y + 20 });
  const size = panelExpanded ? EXPANDED_SIZE : SIZE;
  // Los márgenes CSS son 28 a cada lado y 20 arriba + 36 abajo.
  const rect = { ...origin, width: Math.round((size.width - 56) * scaleFactor), height: Math.round((size.height - 56) * scaleFactor) };
  const cornerRadius = (panelExpanded ? 22 : 21) * scaleFactor;
  if (glassPanel && glassScale !== scaleFactor) { glassPanel.destroy(); glassPanel = null; }
  if (!glassPanel) {
    glassScale = scaleFactor;
    glassPanel = glass.createPanel({ ...rect, cornerRadius, dpr: scaleFactor, capturePolicy: glassCapturePolicy, anchorWindow: mainWindow, onLuma: updateGlassContrast });
    if (!glassPanel) throw new Error('No se pudo crear el panel nativo Liquid Glass.');
  } else {
    glassPanel.setBounds(rect);
    glassPanel.setParams({ cornerRadius });
  }
  const halfWidth = Math.round(rect.width / 2);
  const halfHeight = Math.round(rect.height / 2);
  const footerY = Math.round(158 * scaleFactor);
  glassPanel.setLumaBands(panelExpanded ? [
    { id: 0, x: 0, y: 0, width: halfWidth, height: footerY },
    { id: 1, x: halfWidth, y: 0, width: rect.width - halfWidth, height: footerY },
    { id: 2, x: 0, y: footerY, width: rect.width, height: rect.height - footerY },
  ] : [
    { id: 0, x: 0, y: 0, width: rect.width, height: halfHeight },
    { id: 1, x: 0, y: halfHeight, width: rect.width, height: rect.height - halfHeight },
  ]);
  if (mainWindow.isVisible()) glassPanel.show(0);
}
async function createWindow() {
  if (!glass.isSupported()) throw new Error('Liquid Glass requiere Windows 10 2004 o posterior y su módulo nativo para Windows x64.');
  const saved = await readSettings();
  nativeTheme.themeSource = 'light';
  const area = screen.getPrimaryDisplay().workArea;
  const x = Math.min(Math.max(Number.isFinite(saved.x) ? saved.x : area.x + area.width - SIZE.width - 24, area.x), area.x + area.width - SIZE.width);
  const y = Math.min(Math.max(Number.isFinite(saved.y) ? saved.y : area.y + 80, area.y), area.y + area.height - SIZE.height);
  mainWindow = new BrowserWindow({ ...SIZE, x, y, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, show: false, webPreferences: { preload: path.join(dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, spellcheck: false } });
  // En Windows, 'floating' (el nivel por omisión) reinserta la ventana tras la barra de tareas al
  // activarse; si una app en pantalla completa le quitó el topmost a la barra, el widget lo pierde.
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  glassCapturePolicy = glass.setWindowCapturePolicy(mainWindow, 'dda-only') ? 'dda-only' : 'all';
  harden(mainWindow.webContents);
  mainWindow.on('move', syncGlass);
  mainWindow.on('resize', syncGlass);
  mainWindow.on('show', syncGlass);
  mainWindow.on('hide', () => glassPanel?.hide(0));
  mainWindow.on('moved', schedulePositionSave);
  mainWindow.on('close', () => void writePosition());
  mainWindow.on('closed', () => { glassPanel?.destroy(); glassPanel = null; mainWindow = null; });
  mainWindow.webContents.on('did-finish-load', () => { expandWindow(false); mainWindow.webContents.send('monitor:glass', glassLightText); });
  await mainWindow.loadFile(path.join(dirname, '..', 'renderer', 'index.html'));
  mainWindow.show();
}
async function update(key, read) {
  try {
    const value = await read();
    limitsCache[key] = { value, fetchedAt: value.fetchedAt, error: null };
    return true;
  } catch (error) {
    limitsCache[key] = { ...limitsCache[key], error: error?.message || 'Sin datos' };
    return false;
  }
}
async function dashboard(force = false) {
  if (force) await readClaude();
  const now = Date.now();
  const codexEntry = limitsCache.codex;
  const codexView = { ...codexEntry, fetchedAt: codexEntry.fetchedAt || null, stale: codexEntry.value ? Boolean(codexEntry.error) || isStale(codexEntry.fetchedAt, CODEX_STALE_MS, now) : false };
  return { limits: { claude: projectClaude(limitsCache.claude, now), codex: codexView }, statusLine: await statusLineStatus(os.homedir()) };
}
// fetchedAt cambia en cada lectura; sin él, la firma solo cambia cuando cambia lo que se ve.
const signature = data => JSON.stringify(data, (key, value) => key === 'fetchedAt' ? undefined : value);
let lastPublished = '';
async function publish() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const data = await dashboard();
  const current = signature(data);
  if (current === lastPublished || !mainWindow || mainWindow.isDestroyed()) return;
  lastPublished = current;
  mainWindow.webContents.send('monitor:update', data);
}
function readClaude() {
  return claudeRead ||= update('claude', () => claude.read()).then(publish).finally(() => { claudeRead = null; });
}
async function pollClaude() {
  clearTimeout(claudeTimer);
  await readClaude();
  claudeTimer = setTimeout(() => void pollClaude(), CLAUDE_POLL_MS);
}
// Lecturas solapadas comparten la que está en curso.
function readCodex() {
  return codexRead ||= update('codex', () => codex.read()).then(async ok => { await publish(); return ok; }).finally(() => { codexRead = null; });
}
// Solo se observa que una sesión de Codex cambió, nunca su contenido; la primera escritura de un
// turno programa una lectura y las demás se absorben hasta que ocurra.
function watchCodex() {
  if (codexWatcher) return;
  const sessions = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  try { codexWatcher = watch(sessions, { recursive: true }, () => { codexKick ||= setTimeout(() => { codexKick = null; void readCodex(); }, CODEX_KICK_MS); }); }
  catch { return; }
  codexWatcher.on('error', () => { codexWatcher.close(); codexWatcher = null; });
}
async function pollCodex() {
  clearTimeout(codexTimer);
  watchCodex();
  const ok = await readCodex();
  codexTimer = setTimeout(() => void pollCodex(), ok ? CODEX_POLL_MS : CODEX_RETRY_MS);
}
// Arranca con Windows. Se registra solo si falta para no reactivarlo si el usuario lo desactivó en
// el Administrador de tareas; el portable se registra por su exe real, no por la copia temporal.
function startAtLogin() {
  if (!app.isPackaged) return;
  const login = { path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath };
  if (!app.getLoginItemSettings(login).openAtLogin) app.setLoginItemSettings({ ...login, openAtLogin: true });
}
function fromWidget(event) { return Boolean(mainWindow) && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents && event.senderFrame?.url?.startsWith('file://'); }
function handle(channel, listener) { ipcMain.handle(channel, (event, ...args) => { if (!fromWidget(event)) throw new Error('IPC no autorizado'); return listener(...args); }); }
handle('monitor:read', force => dashboard(force === true));
handle('monitor:connect-claude', () => installStatusLine(os.homedir()));
handle('monitor:quit', () => app.quit());
function expandWindow(expanded) {
  if (typeof expanded !== 'boolean') throw new Error('Estado de panel inválido');
  if (expanded === panelExpanded) return;
  const bounds = mainWindow.getBounds();
  const size = expanded ? EXPANDED_SIZE : SIZE;
  const previous = panelExpanded ? EXPANDED_SIZE : SIZE;
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.max(area.x, Math.min(bounds.x + previous.width - size.width, area.x + area.width - size.width));
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - size.height));
  panelExpanded = expanded;
  mainWindow.setBounds({ x, y, ...size });
}
handle('monitor:expand', expandWindow);
handle('monitor:move', (x, y) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Posición inválida');
  mainWindow.setPosition(Math.round(x), Math.round(y));
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });
  app.on('web-contents-created', (_event, contents) => harden(contents));
  app.whenReady().then(() => { startAtLogin(); void pollClaude(); void pollCodex(); return createWindow(); }).catch(error => { dialog.showErrorBox('Agent Usage Monitor', error.message); app.quit(); });
  app.on('will-quit', () => { clearTimeout(claudeTimer); clearTimeout(codexTimer); clearTimeout(codexKick); codexWatcher?.close(); claude.close(); codex.close(); glass.shutdown(); });
  app.on('window-all-closed', () => app.quit());
}
