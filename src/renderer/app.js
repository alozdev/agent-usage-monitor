import { formatReset } from '../core/limits.js';
import { formatAge, formatCountdown, meterTone, providerState } from '../core/presentation.js';

const providers = document.querySelector('#providers');
const widget = document.querySelector('.widget');
const toggle = document.querySelector('#toggle');
const footer = document.querySelector('#footer');
let latest = { limits: {}, statusLine: { installed: true } };
let connecting = false;
let connectFailed = false;
let expanded = false;
let pointer = null;
let dragged = false;
let glassContrast = null;

// Un dato envejecido se sigue mostrando: es el mínimo de su ventana.
const shown = state => state.key === 'live' || state.key === 'aged';

function cell(name, key, entry, canConnect) {
  const state = providerState(entry);
  const live = shown(state);
  const value = live ? entry.value.usedPercent : null;
  const tone = meterTone(value);
  const exhausted = tone === 'danger';
  const reset = live ? formatReset(entry.value.resetsAt) : '—';
  const figure = !live ? (state.key === 'stale' ? 'Stale' : '—') : `${Math.floor(value)}<span>%</span>`;
  const countdown = state.key === 'aged' ? formatAge(entry.fetchedAt) : live ? formatCountdown(entry.value.resetsAt) : state.key === 'stale' ? 'Dato desactualizado' : 'Sin datos';
  const cached = Number.isFinite(entry?.value?.usedPercent);
  const connect = key === 'claude' && canConnect
    ? `<button class="connect" data-action="connect" ${connecting ? 'disabled' : ''} title="Instalar el colector statusLine de Claude">${connecting ? 'Instalando…' : connectFailed ? 'Reintentar' : 'Instalar colector'}</button>` : '';
  return `<article class="provider ${state.key} ${tone}${glassContrast?.[key] ? ' light-text' : ''}" data-provider="${key}" title="${name}${exhausted ? ': Sin cuota' : ''} · ${countdown} · Reset ${reset}">
    <strong class="name">${name}</strong>
    <div class="gauge" aria-hidden="true">
      <svg viewBox="0 0 80 80">
        <circle class="track" cx="40" cy="40" r="36"></circle>
        <circle class="fill" cx="40" cy="40" r="36" pathLength="100"></circle>
      </svg>
      <img class="provider-icon" src="icons/${key === 'claude' ? 'claude.svg' : 'codex.png'}" alt="">
    </div>
    <div class="figure ${state.key === 'stale' ? 'label' : ''}">${figure}</div>
    <div class="bar" aria-hidden="true"><div class="bar-fill"></div></div>
    <div class="detail-figure">${cached ? `${Math.floor(entry.value.usedPercent)}%` : '?'}</div>
    <div class="detail-label">${exhausted ? 'AGOTADO' : cached ? 'Reinicia en' : 'Sin datos'}</div>
    <div class="detail-countdown">${cached ? formatCountdown(entry.value.resetsAt).replace(/ m$/, ' min') : 'Esperando lectura'}</div>
    <div class="countdown">${countdown}</div>
    <div class="reset">Reset ${cached ? formatReset(entry.value.resetsAt) : '—'}</div>
    ${connect}
  </article>`;
}

function render() {
  providers.innerHTML = [
    cell('Claude', 'claude', latest.limits.claude, !latest.statusLine.installed),
    cell('Codex', 'codex', latest.limits.codex, false),
  ].join('');
  for (const element of providers.children) {
    const entry = latest.limits[element.dataset.provider];
    // CSSOM actualiza el arco sin abrir la CSP a estilos inline.
    element.querySelector('.fill').style.strokeDasharray = `${shown(providerState(entry)) ? entry.value.usedPercent : 0} 100`;
    element.querySelector('.bar-fill').style.height = `${Number.isFinite(entry?.value?.usedPercent) ? entry.value.usedPercent : 0}%`;
  }
  const entries = ['claude', 'codex'].map(key => latest.limits[key]);
  const old = entries.find(entry => ['aged', 'stale'].includes(providerState(entry).key));
  const stamps = entries.map(entry => entry?.fetchedAt).filter(Number.isFinite);
  footer.innerHTML = `<span class="${old ? 'outdated' : ''}">${old ? '⚠ Dato desactualizado' : 'Cuota de 5 h'}</span><span>${old ? `${old === entries[0] ? 'Claude' : 'Codex'} · ${Number.isFinite(old.fetchedAt) ? formatAge(old.fetchedAt) : 'Sin lectura reciente'}` : stamps.length ? `Actualizado ${formatReset(Math.min(...stamps))}` : 'Esperando lectura'}</span>`;
  footer.classList.toggle('light-text', glassContrast?.footer === true);
}

function setExpanded(value) {
  expanded = value;
  widget.classList.toggle('expanded', expanded);
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', expanded ? 'Ocultar detalle de uso' : 'Mostrar detalle de uso');
  window.usageMonitor.expand(expanded);
}

toggle.addEventListener('click', event => { if (!dragged || event.detail === 0) setExpanded(!expanded); });
toggle.addEventListener('keydown', event => { if (event.key === 'Escape') setExpanded(false); });
toggle.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  dragged = false;
  pointer = { x: event.screenX, y: event.screenY, windowX: window.screenX, windowY: window.screenY };
  toggle.setPointerCapture(event.pointerId);
});
toggle.addEventListener('pointermove', event => {
  if (!pointer) return;
  const dx = event.screenX - pointer.x;
  const dy = event.screenY - pointer.y;
  if (Math.hypot(dx, dy) > 4) dragged = true;
  if (dragged) window.usageMonitor.move(pointer.windowX + dx, pointer.windowY + dy);
});
toggle.addEventListener('pointerup', event => { pointer = null; toggle.releasePointerCapture(event.pointerId); });
toggle.addEventListener('pointercancel', () => { pointer = null; dragged = true; });

async function refresh(force = false) {
  try { latest = await window.usageMonitor.read(force); }
  catch { for (const entry of Object.values(latest.limits)) entry.stale = true; }
  render();
}

providers.addEventListener('click', async event => {
  if (event.target.dataset.action !== 'connect' || connecting) return;
  connecting = true;
  connectFailed = false;
  render();
  try { await window.usageMonitor.connectClaude(); await refresh(true); }
  catch { connectFailed = true; }
  finally { connecting = false; render(); }
});
document.querySelector('#quit').addEventListener('click', () => window.usageMonitor.quit());
// El proceso principal empuja cada dato nuevo; la lectura periódica solo recalcula caducidad.
window.usageMonitor.onUpdate(data => { latest = data; render(); });
window.usageMonitor.onGlass(contrast => {
  glassContrast = contrast;
  widget.classList.toggle('glass', true);
  render();
});
render();
refresh();
setInterval(() => void refresh(), 30000);
setInterval(render, 60000);
