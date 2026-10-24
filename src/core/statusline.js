export const SNAPSHOT_VERSION = 1;
export const COLLECTOR_MARKER = 'usage-monitor-statusline-collector';

const finite = value => {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const epochMs = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
  if (typeof value === 'string') { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
  return null;
};
const sessionId = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value) ? value : null;

function sanitizeFiveHour(value) {
  if (!value || typeof value !== 'object') return null;
  const utilization = finite(value.used_percentage ?? value.utilization ?? value.used_percent ?? value.usedPercent);
  if (utilization === null) return null;
  return { utilization: Math.min(100, utilization), resets_at: epochMs(value.resets_at ?? value.resetsAt) };
}

export function sanitizeStatusLineInput(raw, now = Date.now()) {
  const id = sessionId(raw?.session_id ?? raw?.sessionId);
  if (!id) return null;
  const source = raw?.rate_limits ?? raw?.rateLimits ?? {};
  const five_hour = sanitizeFiveHour(source.five_hour ?? source.session ?? source.primary);
  return five_hour ? { version: SNAPSHOT_VERSION, sessionId: id, rateLimits: { five_hour }, capturedAt: now } : null;
}

export function sanitizeSnapshot(raw) {
  const id = sessionId(raw?.sessionId);
  const capturedAt = epochMs(raw?.capturedAt);
  const five_hour = sanitizeFiveHour(raw?.rateLimits?.five_hour);
  if (!id || raw?.version !== SNAPSHOT_VERSION || !capturedAt || !five_hour) return null;
  return { version: SNAPSHOT_VERSION, sessionId: id, rateLimits: { five_hour }, capturedAt };
}

export function isCollectorCommand(command) {
  return typeof command === 'string' && command.includes(COLLECTOR_MARKER);
}

export function buildStatusLineSettings(settings, command) {
  const base = settings && typeof settings === 'object' ? settings : {};
  const current = base.statusLine;
  if (isCollectorCommand(current?.command)) return { settings: base, changed: false, chain: null };
  const chain = current?.command ? { ...current } : null;
  const { command: _command, ...options } = current && typeof current === 'object' ? current : {};
  return { settings: { ...base, statusLine: { ...options, type: 'command', command } }, changed: true, chain };
}
