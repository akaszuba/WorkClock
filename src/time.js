const MINUTE = 60 * 1000;

export function pad(value) {
  return String(value).padStart(2, '0');
}

export function dateKeyFromDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateFromKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

export function localDateTimeIso(dateKey, time) {
  const date = dateFromKey(dateKey);
  if (!date || typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

export function getWeekRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const daysFromMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysFromMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

export function getWeekRangeFromKey(key) {
  const date = dateFromKey(key);
  return date ? getWeekRange(date) : getWeekRange();
}

export function getDateKeysInRange(start, end) {
  const keys = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  while (cursor <= last) {
    keys.push(dateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

export function formatWeekLabel(start, end, locale = undefined) {
  const options = { month: 'short', day: 'numeric' };
  const startText = start.toLocaleDateString(locale, options);
  const endText = end.toLocaleDateString(locale, { ...options, year: 'numeric' });
  return `${startText} – ${endText}`;
}

export function formatDate(dateKey, locale = undefined) {
  const date = dateFromKey(dateKey);
  return date ? date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : dateKey;
}

export function formatDayName(dateKey, locale = undefined) {
  const date = dateFromKey(dateKey);
  return date ? date.toLocaleDateString(locale, { weekday: 'long' }) : '';
}

export function formatDuration(totalMinutes, { compact = false } = {}) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (compact) return `${hours}h ${pad(remainder)}m`;
  return `${hours} h ${pad(remainder)} m`;
}

export function formatSignedBalance(minutes) {
  const rounded = Math.round(Number(minutes) || 0);
  if (rounded === 0) return 'On target';
  return rounded > 0 ? `${formatDuration(rounded)} over` : `${formatDuration(Math.abs(rounded))} under`;
}

export function formatTime(dateOrIso, locale = undefined) {
  const date = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function entryDurationMinutes(entry) {
  if (Number.isFinite(entry?.durationMinutes)) return Math.max(0, Math.round(entry.durationMinutes));
  if (entry?.start && entry?.end) return Math.max(0, Math.round((new Date(entry.end) - new Date(entry.start)) / MINUTE));
  return 0;
}

function overlapMinutes(start, end, rangeStart, rangeEnd) {
  const from = Math.max(start.getTime(), rangeStart.getTime());
  const to = Math.min(end.getTime(), rangeEnd.getTime());
  return to > from ? Math.floor((to - from) / MINUTE) : 0;
}

export function activeTimerMinutesForDate(activeTimer, dateKey, now = new Date()) {
  if (!activeTimer?.startedAt || !dateFromKey(dateKey)) return 0;
  const startedAt = new Date(activeTimer.startedAt);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(current.getTime())) return 0;
  const dayStart = dateFromKey(dateKey);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return overlapMinutes(startedAt, current, dayStart, dayEnd);
}

export function entriesForDate(entries, dateKey) {
  return entries.filter((entry) => entry.date === dateKey).sort((a, b) => {
    const aTime = a.start ? new Date(a.start).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.start ? new Date(b.start).getTime() : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });
}

export function dailyWorkedMinutes(entries, activeTimer, dateKey, now = new Date()) {
  const completed = entriesForDate(entries, dateKey).reduce((sum, entry) => sum + entryDurationMinutes(entry), 0);
  return completed + activeTimerMinutesForDate(activeTimer, dateKey, now);
}

export function weeklyWorkedMinutes(entries, activeTimer, start, end, now = new Date()) {
  const startTime = start.getTime();
  const endOfWeek = new Date(end);
  endOfWeek.setDate(endOfWeek.getDate() + 1);
  const endTime = endOfWeek.getTime();
  const completed = entries.reduce((sum, entry) => {
    const date = dateFromKey(entry.date);
    return date && date >= start && date <= end ? sum + entryDurationMinutes(entry) : sum;
  }, 0);
  const timerStart = activeTimer?.startedAt ? new Date(activeTimer.startedAt).getTime() : NaN;
  const timerEnd = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const active = Number.isFinite(timerStart) ? Math.max(0, Math.floor((Math.min(timerEnd, endTime) - Math.max(timerStart, startTime)) / MINUTE)) : 0;
  return completed + active;
}

export function dailyTargetMinutes(settings, dateKey) {
  const date = dateFromKey(dateKey);
  return date ? Number(settings?.weekdayTargetMinutes?.[date.getDay()] || 0) : 0;
}

export function findTargetReachedAt(entries, activeTimer, weeklyTargetMinutes, start, end, now = new Date()) {
  const relevant = entries.filter((entry) => {
    const date = dateFromKey(entry.date);
    return date && date >= start && date <= end;
  }).sort((a, b) => new Date(a.start || `${a.date}T23:59:59`).getTime() - new Date(b.start || `${b.date}T23:59:59`).getTime());
  let accumulated = 0;
  for (const entry of relevant) {
    const duration = entryDurationMinutes(entry);
    if (accumulated + duration >= weeklyTargetMinutes) {
      if (entry.start) return new Date(new Date(entry.start).getTime() + (weeklyTargetMinutes - accumulated) * MINUTE);
      return null;
    }
    accumulated += duration;
  }
  if (activeTimer?.startedAt) {
    const timerStart = new Date(activeTimer.startedAt);
    const current = now instanceof Date ? now : new Date(now);
    const activeMinutes = Math.max(0, Math.floor((current - timerStart) / MINUTE));
    if (accumulated + activeMinutes >= weeklyTargetMinutes) return new Date(timerStart.getTime() + (weeklyTargetMinutes - accumulated) * MINUTE);
  }
  return null;
}

export function projectWeeklyTarget({ entries, activeTimer, settings, weekStart, weekEnd, now = new Date() }) {
  const worked = weeklyWorkedMinutes(entries, activeTimer, weekStart, weekEnd, now);
  const remaining = Math.max(0, Number(settings.weeklyTargetMinutes) - worked);
  if (remaining === 0) {
    const reachedAt = findTargetReachedAt(entries, activeTimer, settings.weeklyTargetMinutes, weekStart, weekEnd, now);
    return { kind: 'reached', remaining: 0, reachedAt };
  }
  const todayKey = dateKeyFromDate(now);
  const currentWeek = getWeekRange(now);
  const isCurrentWeek = currentWeek.start.getTime() === weekStart.getTime();
  if (!isCurrentWeek) return { kind: 'estimate', remaining, plannedDays: 0 };
  let plannedDays = 0;
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  for (; cursor <= weekEnd; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKeyFromDate(cursor);
    const target = dailyTargetMinutes(settings, key);
    const workedToday = dailyWorkedMinutes(entries, activeTimer, key, now);
    if (target > workedToday) plannedDays += 1;
  }
  return { kind: 'estimate', remaining, plannedDays, todayKey };
}

export const TIME_CONSTANTS = { MINUTE };
