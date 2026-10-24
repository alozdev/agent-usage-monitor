export function meterTone(percent) {
  if (!Number.isFinite(percent)) return 'unknown';
  if (percent >= 100) return 'danger';
  if (percent >= 80) return 'warn';
  return 'good';
}

export function providerState(entry) {
  if (!Number.isFinite(entry?.value?.usedPercent)) return { key: 'unknown' };
  if (entry.stale || entry.error) return { key: 'stale' };
  return { key: entry.aged ? 'aged' : 'live' };
}

export function formatAge(at, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  return minutes < 60 ? `hace ${minutes} min` : `hace ${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}

export function formatCountdown(resetAt, now = Date.now()) {
  if (!Number.isFinite(resetAt) || resetAt <= 0) return '—';
  const minutes = Math.max(0, Math.ceil((resetAt - now) / 60000));
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}
