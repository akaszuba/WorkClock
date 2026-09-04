import { dateFromKey, dateKeyFromDate, entryDurationMinutes } from './time.js';

export const STORAGE_KEY = 'workclock.data.v1';
export const CURRENT_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  weeklyTargetMinutes: 2400,
  weekdayTargetMinutes: Object.freeze({ 0: 0, 1: 480, 2: 480, 3: 480, 4: 480, 5: 480, 6: 0 }),
  weekStartsOn: 1,
});

export function createDefaultState() {
  return {
    version: CURRENT_VERSION,
    settings: {
      weeklyTargetMinutes: DEFAULT_SETTINGS.weeklyTargetMinutes,
      weekdayTargetMinutes: { ...DEFAULT_SETTINGS.weekdayTargetMinutes },
      weekStartsOn: DEFAULT_SETTINGS.weekStartsOn,
    },
    entries: [],
    activeTimer: null,
  };
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function isIsoString(value) {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function isEntry(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.id !== 'string' || !value.id || !dateFromKey(value.date)) return false;
  if (!['manual', 'timer'].includes(value.source)) return false;
  if (typeof value.note !== 'string' || value.note.length > 120) return false;
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 0) return false;
  if (value.start === null && value.end === null) return value.durationMinutes > 0;
  if (!isIsoString(value.start) || !isIsoString(value.end)) return false;
  return new Date(value.end) > new Date(value.start) && value.durationMinutes > 0;
}

export function validateDocument(value) {
  if (!value || typeof value !== 'object') return { valid: false, error: 'The document is not an object.' };
  if (value.version !== CURRENT_VERSION) return { valid: false, error: `Unsupported data version. Expected version ${CURRENT_VERSION}.` };
  if (!value.settings || typeof value.settings !== 'object') return { valid: false, error: 'Settings are missing.' };
  const weekly = value.settings.weeklyTargetMinutes;
  const weekday = value.settings.weekdayTargetMinutes;
  if (!Number.isInteger(weekly) || weekly < 0 || weekly > 10080) return { valid: false, error: 'Weekly target must be between 0 and 10,080 minutes.' };
  if (!weekday || typeof weekday !== 'object') return { valid: false, error: 'Daily targets are missing.' };
  for (let day = 0; day < 7; day += 1) {
    if (!Number.isInteger(weekday[day]) || weekday[day] < 0 || weekday[day] > 1440) return { valid: false, error: 'Daily targets must be whole minutes between 0 and 1,440.' };
  }
  if (value.settings.weekStartsOn !== 1) return { valid: false, error: 'Only Monday week starts are supported.' };
  if (!Array.isArray(value.entries) || value.entries.some((entry) => !isEntry(entry))) return { valid: false, error: 'One or more entries are invalid.' };
  const ids = new Set();
  for (const entry of value.entries) {
    if (ids.has(entry.id)) return { valid: false, error: 'Entries must have unique IDs.' };
    ids.add(entry.id);
  }
  if (value.activeTimer !== null) {
    if (!value.activeTimer || typeof value.activeTimer.entryId !== 'string' || ids.has(value.activeTimer.entryId) || !isIsoString(value.activeTimer.startedAt)) {
      return { valid: false, error: 'The active timer is invalid.' };
    }
  }
  return { valid: true };
}

export function createLocalStorageAdapter(storage = undefined) {
  let backend = storage;
  let available = true;
  if (backend === undefined) {
    try { backend = globalThis.localStorage; } catch { backend = null; }
  }
  if (!backend) available = false;
  return {
    get available() { return available; },
    read() {
      if (!available) return null;
      try { return backend.getItem(STORAGE_KEY); } catch { available = false; return null; }
    },
    write(value) {
      if (!available) throw new Error('Browser storage is unavailable.');
      try { backend.setItem(STORAGE_KEY, value); } catch (error) { available = false; throw new Error('Browser storage is unavailable or full.', { cause: error }); }
    },
  };
}

export function loadState(adapter = createLocalStorageAdapter()) {
  const fallback = createDefaultState();
  const raw = adapter.read();
  if (!raw) return { state: fallback, error: adapter.available ? null : 'Browser storage is unavailable. Data will not persist after refresh.' };
  try {
    const parsed = JSON.parse(raw);
    const result = validateDocument(parsed);
    return result.valid ? { state: parsed, error: null } : { state: fallback, error: `Saved data could not be loaded: ${result.error}` };
  } catch {
    return { state: fallback, error: 'Saved data could not be loaded because it is malformed.' };
  }
}

function assertNoOverlap(entries, candidate, ignoreId = null) {
  if (!candidate.start || !candidate.end) return;
  const start = new Date(candidate.start).getTime();
  const end = new Date(candidate.end).getTime();
  const overlap = entries.some((entry) => {
    if (entry.id === ignoreId || entry.date !== candidate.date || !entry.start || !entry.end) return false;
    return start < new Date(entry.end).getTime() && end > new Date(entry.start).getTime();
  });
  if (overlap) throw new Error('This interval overlaps another entry on the same day.');
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createStateStore(adapter = createLocalStorageAdapter(), initialState = undefined) {
  let state = clone(initialState || loadState(adapter).state);
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener(state));
  const persist = () => { adapter.write(JSON.stringify(state)); };
  const mutate = (operation) => {
    const previous = clone(state);
    try { operation(); persist(); notify(); } catch (error) { state = previous; throw error; }
    return state;
  };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    save() { persist(); notify(); },
    addEntry(input) {
      const entry = { id: input.id || createId(), date: input.date, start: input.start ?? null, end: input.end ?? null, durationMinutes: input.durationMinutes, note: input.note || '', source: input.source || 'manual' };
      if (!isEntry(entry)) throw new Error('Entry details are invalid.');
      assertNoOverlap(state.entries, entry);
      return mutate(() => state.entries.push(entry));
    },
    updateEntry(id, input) {
      const index = state.entries.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error('Entry no longer exists.');
      const entry = { ...state.entries[index], ...input, id };
      if (!isEntry(entry)) throw new Error('Entry details are invalid.');
      assertNoOverlap(state.entries, entry, id);
      return mutate(() => { state.entries[index] = entry; });
    },
    deleteEntry(id) {
      if (!state.entries.some((entry) => entry.id === id)) throw new Error('Entry no longer exists.');
      return mutate(() => { state.entries = state.entries.filter((entry) => entry.id !== id); });
    },
    startTimer(startedAt = new Date().toISOString()) {
      if (state.activeTimer) throw new Error('A timer is already running.');
      if (!isIsoString(startedAt)) throw new Error('Timer start time is invalid.');
      return mutate(() => { state.activeTimer = { entryId: createId(), startedAt }; });
    },
    stopTimer(endedAt = new Date().toISOString()) {
      if (!state.activeTimer) throw new Error('No timer is running.');
      if (!isIsoString(endedAt)) throw new Error('Timer end time is invalid.');
      const timer = state.activeTimer;
      const start = new Date(timer.startedAt);
      const end = new Date(endedAt);
      if (end <= start) throw new Error('Timer end must be after its start.');
      const firstDate = dateKeyFromDate(start);
      const secondDate = dateKeyFromDate(end);
      const newEntries = [];
      if (firstDate === secondDate) {
        newEntries.push({ id: timer.entryId, date: firstDate, start: start.toISOString(), end: end.toISOString(), durationMinutes: entryDurationMinutes({ start: start.toISOString(), end: end.toISOString() }), note: '', source: 'timer' });
      } else {
        let segmentStart = start;
        let segmentId = timer.entryId;
        while (dateKeyFromDate(segmentStart) !== secondDate) {
          const nextDay = new Date(segmentStart);
          nextDay.setHours(0, 0, 0, 0);
          nextDay.setDate(nextDay.getDate() + 1);
          const segmentEnd = nextDay < end ? nextDay : end;
          const duration = entryDurationMinutes({ start: segmentStart.toISOString(), end: segmentEnd.toISOString() });
          if (duration > 0) newEntries.push({ id: segmentId, date: dateKeyFromDate(segmentStart), start: segmentStart.toISOString(), end: segmentEnd.toISOString(), durationMinutes: duration, note: '', source: 'timer' });
          segmentStart = segmentEnd;
          segmentId = createId();
        }
        const finalDuration = entryDurationMinutes({ start: segmentStart.toISOString(), end: end.toISOString() });
        if (finalDuration > 0) newEntries.push({ id: segmentId, date: secondDate, start: segmentStart.toISOString(), end: end.toISOString(), durationMinutes: finalDuration, note: '', source: 'timer' });
      }
      for (const entry of newEntries) assertNoOverlap(state.entries, entry);
      return mutate(() => { state.entries.push(...newEntries); state.activeTimer = null; });
    },
    updateSettings(settings) {
      const next = { ...state.settings, ...settings, weekdayTargetMinutes: { ...state.settings.weekdayTargetMinutes, ...(settings.weekdayTargetMinutes || {}) } };
      const result = validateDocument({ ...state, settings: next });
      if (!result.valid) throw new Error(result.error);
      return mutate(() => { state.settings = next; });
    },
    replace(nextState) {
      const result = validateDocument(nextState);
      if (!result.valid) throw new Error(result.error);
      return mutate(() => { state = clone(nextState); });
    },
    exportJson() { return JSON.stringify(state, null, 2); },
  };
}
