const pad = value => String(value).padStart(2, '0');

// Returns: 'YYYY-MM-DD HH:MM' in the viewer's time zone, or '' for no time.
export function clock(iso) {
  const at = new Date(iso || '');
  if (Number.isNaN(at.getTime())) return '';
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

// Returns: a span as h:mm:ss, or m:ss below an hour.
export function elapsed(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const [hours, minutes, rest] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

// Args:
//   run: a workflow run as GitHub lists it.
//   now: the time an unfinished run is measured up to.
// Returns: how long the run took, or has taken so far, in ms; null when it
//   carries no start.
export function runSpan(run, now = Date.now()) {
  const start = Date.parse(run.run_started_at || run.created_at || '');
  if (Number.isNaN(start)) return null;
  const end = run.status === 'completed' ? Date.parse(run.updated_at || '') : now;
  return Number.isNaN(end) ? null : end - start;
}
