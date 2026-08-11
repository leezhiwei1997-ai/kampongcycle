// src/utils/time.js

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Returns { label, urgency } for a collectByTimestamp (epoch ms). */
export function formatCollectBy(collectByTimestamp) {
  if (!collectByTimestamp) return { label: null, urgency: 'normal' };

  const remainingMs = collectByTimestamp - Date.now();
  if (remainingMs <= 0) return { label: 'Pickup window closed', urgency: 'expired' };

  const endLabel = new Date(collectByTimestamp)
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const mins = Math.ceil(remainingMs / MINUTE_MS);
  let left;
  if (mins < 60) left = `${mins} min left`;
  else if (mins < 24 * 60) left = `${Math.round(mins / 60)} hr left`;
  else left = `${Math.round(mins / (60 * 24))} days left`;

  // Thresholds: under 15 min is act-now, 15-30 is decide-now, beyond that
  // it's simply information.
  let urgency = 'ok';
  if (mins < 15) urgency = 'urgent';
  else if (mins <= 30) urgency = 'warning';

  // NOTE: only the END of the pickup window is stored (`collectByTimestamp`,
  // set as now + collectMinutes when the merchant publishes). There is no
  // start time anywhere in the schema, so "Pickup 6:00-7:00 PM" can't be
  // shown without inventing one. "Pickup by 7:00 PM" is what the data
  // actually supports.
  return { label: `Pickup by ${endLabel} · ${left}`, urgency };
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

/**
 * Same data as formatCollectBy, split into its two halves so the Discover
 * card can put the countdown on the photo and the clock time in the body.
 */
export function formatCollectByParts(collectByTimestamp) {
  const { label, urgency } = formatCollectBy(collectByTimestamp);
  if (!label) return { endLabel: null, leftLabel: null, urgency };
  if (urgency === 'expired') return { endLabel: null, leftLabel: 'Closed', urgency };
  const [byPart, leftPart] = label.split(' · ');
  return { endLabel: byPart, leftLabel: leftPart, urgency };
}
