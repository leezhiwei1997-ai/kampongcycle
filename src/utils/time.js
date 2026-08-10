// src/utils/time.js

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Returns { label, urgency } for a collectByTimestamp (epoch ms). */
export function formatCollectBy(collectByTimestamp) {
  if (!collectByTimestamp) return { label: null, urgency: 'normal' };

  const remainingMs = collectByTimestamp - Date.now();

  if (remainingMs <= 0) {
    return { label: 'Collection window closed', urgency: 'expired' };
  }

  if (remainingMs < HOUR_MS) {
    const mins = Math.ceil(remainingMs / MINUTE_MS);
    return {
      label: `Collect within ${mins} min`,
      urgency: mins <= 15 ? 'urgent' : 'warning',
    };
  }

  if (remainingMs < 24 * HOUR_MS) {
    const hours = Math.round(remainingMs / HOUR_MS);
    return { label: `Collect within ${hours} hr`, urgency: 'normal' };
  }

  const date = new Date(collectByTimestamp);
  const timeLabel = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return { label: `Collect by ${timeLabel}`, urgency: 'normal' };
}

/** "5 min ago" / "2 hr ago" / "3d ago" style relative time from an epoch ms timestamp. */
export function formatRelativeTime(timestampMs) {
  if (!timestampMs) return '';
  const diffMs = Date.now() - timestampMs;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Preset durations (in minutes) merchants pick from when listing/editing. */
export const COLLECT_BY_PRESETS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '2 hr', minutes: 120 },
  { label: '4 hr', minutes: 240 },
];
