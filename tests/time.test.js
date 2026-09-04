import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyWorkedMinutes,
  dateFromKey,
  dateKeyFromDate,
  getDateKeysInRange,
  getWeekRange,
  projectWeeklyTarget,
  weeklyWorkedMinutes,
} from '../src/time.js';
import { createDefaultState, createStateStore, validateDocument } from '../src/state.js';

const entry = (date, durationMinutes, start = null, end = null) => ({ id: `${date}-${durationMinutes}-${start || 'duration'}`, date, start, end, durationMinutes, note: '', source: 'manual' });

test('week range is Monday through Sunday and includes seven local dates', () => {
  const range = getWeekRange(new Date(2026, 8, 4, 14, 30));
  assert.equal(dateKeyFromDate(range.start), '2026-08-31');
  assert.equal(dateKeyFromDate(range.end), '2026-09-06');
  assert.deepEqual(getDateKeysInRange(range.start, range.end), ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
});

test('date parsing rejects calendar rollovers', () => {
  assert.equal(dateFromKey('2026-02-30'), null);
  assert.equal(dateFromKey('not-a-date'), null);
  assert.equal(dateKeyFromDate(new Date(2026, 8, 4)), '2026-09-04');
});

test('daily and weekly totals include active timer minutes without mutating state', () => {
  const now = new Date(2026, 8, 4, 12, 30);
  const started = new Date(2026, 8, 4, 10, 0).toISOString();
  const state = createDefaultState();
  state.entries.push(entry('2026-09-04', 120));
  state.activeTimer = { entryId: 'running', startedAt: started };
  assert.equal(dailyWorkedMinutes(state.entries, state.activeTimer, '2026-09-04', now), 270);
  const range = getWeekRange(now);
  assert.equal(weeklyWorkedMinutes(state.entries, state.activeTimer, range.start, range.end, now), 270);
  assert.equal(state.entries[0].durationMinutes, 120);
});

test('a timer crossing local midnight is counted on both local dates', () => {
  const startedAt = new Date(2026, 9, 31, 23, 30).toISOString();
  const now = new Date(2026, 10, 1, 1, 0);
  const active = { entryId: 'running', startedAt };
  assert.equal(dailyWorkedMinutes([], active, '2026-10-31', now), 30);
  assert.equal(dailyWorkedMinutes([], active, '2026-11-01', now), 60);
});

test('projection reports remaining work and configured planned days', () => {
  const now = new Date(2026, 8, 2, 17, 0);
  const settings = createDefaultState().settings;
  const range = getWeekRange(now);
  const result = projectWeeklyTarget({ entries: [entry('2026-09-01', 480)], activeTimer: null, settings, weekStart: range.start, weekEnd: range.end, now });
  assert.equal(result.kind, 'estimate');
  assert.equal(result.remaining, 1920);
  assert.equal(result.plannedDays, 3);
});

test('state validation rejects malformed documents and duplicate IDs', () => {
  const state = createDefaultState();
  state.entries.push(entry('2026-09-04', 60));
  const valid = validateDocument(state);
  assert.equal(valid.valid, true);
  state.entries.push({ ...state.entries[0] });
  const invalid = validateDocument(state);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /unique IDs/);
});

test('store rejects overlapping interval entries and supports round-trip persistence', () => {
  const memory = new Map();
  const adapter = { available: true, read: () => memory.get('workclock.data.v1') || null, write: (value) => memory.set('workclock.data.v1', value) };
  const store = createStateStore(adapter);
  store.addEntry({ date: '2026-09-04', start: new Date(2026, 8, 4, 9).toISOString(), end: new Date(2026, 8, 4, 10).toISOString(), durationMinutes: 60, note: '', source: 'manual' });
  assert.throws(() => store.addEntry({ date: '2026-09-04', start: new Date(2026, 8, 4, 9, 30).toISOString(), end: new Date(2026, 8, 4, 10, 30).toISOString(), durationMinutes: 60, note: '', source: 'manual' }), /overlaps/);
  assert.equal(JSON.parse(memory.get('workclock.data.v1')).entries.length, 1);
});
