import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

test('widget IPC expands inside the display, collapses and rejects invalid movement', async () => {
  const source = (await readFile(new URL('../src/main/index.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  const handlers = {};
  let saved;
  const contents = {};
  let bounds = { x: 1750, y: 850, width: 98, height: 194 };
  const widget = {
    webContents: contents, isDestroyed: () => false, getBounds: () => ({ ...bounds, width: bounds.width + 1, height: bounds.height + 1 }),
    setBounds: value => { bounds = value; },
    setPosition: (x, y) => { bounds = { ...bounds, x, y }; },
  };
  const context = vm.createContext({
    path: { dirname: () => '', join: (...parts) => parts.join('/') }, fileURLToPath: () => '',
    createClaudeClient: () => ({}), createCodexClient: () => ({}),
    app: { requestSingleInstanceLock: () => false, quit() {}, getPath: () => '' },
    process: { pid: 1 }, mkdir: async () => {}, rename: async () => {}, writeFile: async (_target, data) => { saved = JSON.parse(data); },
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
    widget,
  });
  vm.runInContext(source.replaceAll('import.meta.url', '"file:///widget"'), context);
  vm.runInContext('mainWindow = widget', context);
  const event = { sender: contents, senderFrame: { url: 'file:///widget' } };
  assert.equal(typeof handlers['monitor:expand'], 'function', 'the real window must resize when the panel opens');
  handlers['monitor:expand'](event, true);
  assert.equal(bounds.width, 384);
  assert.equal(bounds.height, 256);
  assert.equal(bounds.x, 1464, 'fractional display scaling must not move the right edge on each toggle');
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1920);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 1040);
  await vm.runInContext('writePosition()', context);
  assert.equal(saved.x, 1750, 'restarting must restore the capsule position, even when closed from the expanded card');
  const opened = { ...bounds };
  handlers['monitor:expand'](event, true);
  assert.deepEqual({ ...bounds }, opened, 'opening an open panel must not move it');
  handlers['monitor:expand'](event, false);
  assert.equal(bounds.width, 98);
  assert.equal(bounds.height, 194);
  handlers['monitor:move'](event, 100, 200);
  assert.equal(bounds.x, 100);
  assert.equal(bounds.y, 200);
  assert.throws(() => handlers['monitor:move'](event, NaN, 200));
  assert.throws(() => handlers['monitor:expand'](event, 'true'));
  assert.throws(() => handlers['monitor:expand']({ sender: {} }, true), /IPC no autorizado/);
});

test('native glass follows the capsule, expansion and display scale, and closes with the widget', async () => {
  const source = (await readFile(new URL('../src/main/index.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '').replaceAll('import.meta.url', '"file:///widget"');
  const panels = [];
  const messages = [];
  const handlers = {};
  let scaleFactor = 1.25;
  let window;
  class Widget extends EventEmitter {
    constructor(options) { super(); window = this; this.bounds = options; this.visible = false; this.webContents = Object.assign(new EventEmitter(), { send: (...args) => messages.push(args), setWindowOpenHandler() {}, session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }); }
    getBounds() { return this.bounds; }
    getContentBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; this.emit('resize'); this.emit('move'); }
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    setAlwaysOnTop() {}
    async loadFile() { this.webContents.emit('did-finish-load'); }
    show() { this.visible = true; this.emit('show'); }
  }
  const glass = { isSupported: () => true, setWindowCapturePolicy: () => true, createPanel: options => {
    const panel = { options, bounds: options, params: options, shown: false, destroyed: false,
      setBounds(bounds) { this.bounds = bounds; }, setParams(params) { this.params = params; },
      setLumaBands(bands) { this.bands = bands; }, show() { this.shown = true; }, hide() { this.shown = false; }, destroy() { this.destroyed = true; },
    };
    panels.push(panel);
    return panel;
  } };
  const context = vm.createContext({
    path: { dirname: () => '', join: (...parts) => parts.join('/') }, fileURLToPath: () => '',
    createClaudeClient: () => ({}), createCodexClient: () => ({}), glass, BrowserWindow: Widget, nativeTheme: {},
    readFile: async () => '{"x":100,"y":200}',
    app: { requestSingleInstanceLock: () => false, quit() {}, getPath: () => '' },
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getDisplayMatching: () => ({ scaleFactor, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      dipToScreenPoint: ({ x, y }) => ({ x: Math.round(x * scaleFactor), y: Math.round(y * scaleFactor) }),
    },
  });
  vm.runInContext(source, context);
  await vm.runInContext('createWindow()', context);
  assert.equal(panels.length, 1, 'the real window must have a native glass backdrop');
  const panel = panels[0];
  assert.equal(panel.options.anchorWindow, window);
  assert.deepEqual(JSON.parse(JSON.stringify(panel.bounds, ['x', 'y', 'width', 'height'])), { x: 160, y: 275, width: 53, height: 173 });
  assert.equal(panel.options.cornerRadius, 26.25);
  assert.equal(panel.shown, true);
  const event = { sender: window.webContents, senderFrame: { url: 'file:///widget' } };
  handlers['monitor:expand'](event, true);
  assert.deepEqual(JSON.parse(JSON.stringify(panel.bounds)), { x: 35, y: 275, width: 410, height: 250 });
  assert.equal(panel.params.cornerRadius, 27.5);
  assert.equal(panel.bands.length, 3, 'the two provider columns and footer need separate contrast samples');
  const sample = value => ({ r: value, g: value, b: value, darkTail: value, lightTail: value });
  panel.options.onLuma({ 0: sample(10), 1: sample(240), 2: sample(240) });
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), ['monitor:glass', { claude: true, codex: false, footer: false }]);
  const count = messages.length;
  panel.options.onLuma({ 0: sample(12), 1: sample(240), 2: sample(240) });
  assert.equal(messages.length, count, 'unchanged contrast must not flood IPC');
  window.webContents.emit('did-finish-load');
  assert.equal(messages.length, count + 1, 'reloading the renderer must restore glass without waiting for a background change');
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), ['monitor:glass', { claude: true, codex: false, footer: false }]);
  assert.equal(window.bounds.width, 98, 'reloading must match the renderer, which starts collapsed');
  assert.equal(panel.bounds.width, 53, 'reloading must not leave expanded glass behind a collapsed capsule');
  handlers['monitor:expand'](event, true);
  panel.options.onLuma({ 0: sample(240), 1: sample(10), 2: sample(10) });
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), ['monitor:glass', { claude: false, codex: true, footer: true }]);
  window.visible = false;
  window.emit('hide');
  assert.equal(panel.shown, false);
  scaleFactor = 2;
  window.show();
  assert.equal(panel.destroyed, true, 'changing display scale must recreate the native DPR');
  assert.equal(panels.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(panels[1].bounds, ['x', 'y', 'width', 'height'])), { x: 56, y: 440, width: 656, height: 400 });
  window.emit('closed');
  assert.equal(panels[1].destroyed, true, 'closing must not leave a native window behind');
});
