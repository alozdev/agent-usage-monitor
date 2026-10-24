import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
app.setPath('userData', path.join(root, 'dist', 'qa-profile'));
app.on('window-all-closed', () => {});
let fixture;
ipcMain.handle('qa:read', () => fixture);
ipcMain.handle('qa:expand', (event, expanded) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.setBounds({ ...win.getBounds(), ...(expanded ? { width: 384, height: 256 } : { width: 98, height: 194 }) });
});
ipcMain.handle('qa:move', (event, x, y) => BrowserWindow.fromWebContents(event.sender).setPosition(Math.round(x), Math.round(y)));
const inspect = `(() => {
  const widget = document.querySelector('.widget');
  const style = getComputedStyle(widget);
  return {
    fonts: [...document.fonts].map(font => font.status),
    widget: widget.getBoundingClientRect().toJSON(),
    radius: style.borderTopLeftRadius,
    closeOpacity: getComputedStyle(document.querySelector('#quit')).opacity,
    cells: [...document.querySelectorAll('.provider')].map(element => ({
      key: element.dataset.provider,
      bounds: element.getBoundingClientRect().toJSON(),
      gauge: element.querySelector('.gauge').getBoundingClientRect().toJSON(),
      figure: element.querySelector('.figure').getBoundingClientRect().toJSON(),
      arc: element.querySelector('.fill').style.strokeDasharray,
      iconLoaded: element.querySelector('img').complete && element.querySelector('img').naturalWidth > 0,
      overflow: element.scrollWidth > element.clientWidth,
    })),
    controls: [...document.querySelectorAll('.connect')].map(element => element.getBoundingClientRect().toJSON()),
    text: [...document.querySelectorAll('.figure')].map(element => element.textContent),
    expanded: document.querySelector('#toggle').getAttribute('aria-expanded'),
    bars: [...document.querySelectorAll('.bar-fill')].map(element => element.style.height),
    details: [...document.querySelectorAll('.detail-figure')].map(element => element.textContent),
    footer: document.querySelector('#footer').getBoundingClientRect().toJSON(),
    footerText: document.querySelector('#footer').textContent,
  };
})()`;
// capturePage sobre ventanas ocultas falla a veces con UnknownVizError del compositor.
async function capture(win) {
  for (let attempt = 1; ; attempt++) {
    try { return await win.webContents.capturePage(); }
    catch (error) { if (attempt === 3) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
  }
}
app.whenReady().then(async () => {
  let win;
  try {
    nativeTheme.themeSource = 'light';
    const entry = usedPercent => ({ value: { usedPercent, resetsAt: Date.now() + 600000 }, fetchedAt: Date.now() });
    const cases = [
      ['normal', entry(42), entry(27)],
      ['aviso', entry(80), entry(94)],
      ['agotado', entry(100), entry(100)],
      ['sin-datos-stale', { value: null }, { ...entry(55), stale: true }],
      ['instalacion', { value: null }, entry(0)],
      ['envejecido', { ...entry(64), aged: true, fetchedAt: Date.now() - 42 * 60000 }, entry(12)],
    ];
    await mkdir(path.join(root, 'artifacts/wireframe'), { recursive: true });
    for (const [name, claude, codex] of cases) {
      fixture = { limits: { claude, codex }, statusLine: { installed: name !== 'instalacion' } };
      win = new BrowserWindow({ width: 98, height: 194, frame: false, transparent: true, resizable: false, show: false, webPreferences: { preload: path.join(root, 'scripts/visual-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      const errors = [];
      win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
      await win.loadFile(path.join(root, 'src/renderer/index.html'));
      await win.webContents.executeJavaScript('document.fonts.ready');
      await new Promise(resolve => setTimeout(resolve, 200));
      const result = await win.webContents.executeJavaScript(inspect);
      assert.deepEqual(result.fonts, ['loaded']);
      assert.equal(result.closeOpacity, '0');
      assert.deepEqual([result.widget.width, result.widget.height], [42, 138]);
      assert.equal(result.radius, '21px');
      assert.deepEqual(result.cells.map(cell => cell.key), ['claude', 'codex']);
      assert.ok(result.cells[0].figure.bottom < result.cells[1].gauge.top);
      for (const [index, cell] of result.cells.entries()) {
        const source = [claude, codex][index];
        assert.equal(cell.arc, `${source.value && !source.stale ? source.value.usedPercent : 0}, 100`);
        assert.equal(cell.gauge.width, cell.gauge.height);
        assert.ok(cell.gauge.bottom < cell.figure.top);
        assert.equal(cell.iconLoaded, true);
        assert.equal(cell.overflow, false);
      }
      for (const rect of [...result.cells.flatMap(cell => [cell.gauge, cell.figure]), ...result.controls]) {
        assert.ok(rect.left >= result.widget.left && rect.right <= result.widget.right && rect.top >= result.widget.top && rect.bottom <= result.widget.bottom, `${name}: elemento fuera de la cápsula`);
      }
      if (name === 'agotado') assert.deepEqual(result.text, ['100%', '100%']);
      if (name === 'sin-datos-stale') assert.deepEqual(result.text, ['—', 'Stale']);
      assert.deepEqual(errors, []);
      await writeFile(path.join(root, `artifacts/wireframe/${name}.png`), (await capture(win)).toPNG());
      win.webContents.sendInputEvent({ type: 'mouseDown', x: 49, y: 43, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: 49, y: 43, button: 'left', clickCount: 1 });
      await new Promise(resolve => setTimeout(resolve, 100));
      const detail = await win.webContents.executeJavaScript(inspect);
      assert.equal(detail.expanded, 'true');
      assert.deepEqual(win.getContentSize(), [384, 256]);
      assert.deepEqual([detail.widget.width, detail.widget.height], [328, 200]);
      assert.deepEqual(detail.details, [claude, codex].map(source => Number.isFinite(source.value?.usedPercent) ? `${Math.floor(source.value.usedPercent)}%` : '?'));
      assert.deepEqual(detail.bars, [claude, codex].map(source => `${source.value?.usedPercent || 0}%`));
      assert.ok(detail.cells[0].bounds.right < detail.cells[1].bounds.left);
      assert.ok(detail.cells.every(cell => !cell.overflow), `${name}: texto fuera del panel`);
      assert.ok(detail.footer.bottom < detail.widget.bottom);
      assert.deepEqual(errors, []);
      await writeFile(path.join(root, `artifacts/wireframe/${name}-detalle.png`), (await capture(win)).toPNG());
      await win.webContents.executeJavaScript("document.querySelector('#toggle').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
      await new Promise(resolve => setTimeout(resolve, 100));
      // Windows redondea hasta un píxel al volver a la cápsula con escala fraccionaria.
      const [width, height] = win.getContentSize();
      assert.ok(width >= 98 && width <= 99 && height >= 194 && height <= 195);
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('#toggle').getAttribute('aria-expanded')"), 'false');
      console.log(name, 'OK');
      win.destroy();
      win = null;
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win?.destroy(); app.exit(process.exitCode || 0); }
});
