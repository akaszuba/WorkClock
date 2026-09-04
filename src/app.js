import {
  activeTimerMinutesForDate,
  dailyTargetMinutes,
  dailyWorkedMinutes,
  dateFromKey,
  dateKeyFromDate,
  entriesForDate,
  formatDate,
  formatDayName,
  formatDuration,
  formatSignedBalance,
  formatTime,
  formatWeekLabel,
  getDateKeysInRange,
  getWeekRange,
  getWeekRangeFromKey,
  localDateTimeIso,
  projectWeeklyTarget,
  weeklyWorkedMinutes,
} from './time.js';
import { createLocalStorageAdapter, createStateStore, loadState, validateDocument } from './state.js';

const adapter = createLocalStorageAdapter();
const loaded = loadState(adapter);
const store = createStateStore(adapter, loaded.state);
let selectedWeekStartKey = dateKeyFromDate(getWeekRange().start);
let timerInterval = null;

const $ = (selector) => document.querySelector(selector);
const elements = {
  headerTotal: $('#header-total'), weekHeading: $('#week-heading'), days: $('#days'),
  weeklyTotal: $('#weekly-total'), weeklyStatus: $('#weekly-status'), weeklyProgress: $('#weekly-progress'),
  weeklyTargetLabel: $('#weekly-target-label'), weeklyBalance: $('#weekly-balance'), proposedEnd: $('#proposed-end'),
  projection: $('#week-projection'), storageError: $('#storage-error'), liveAnnouncer: $('#live-announcer'),
  entryDialog: $('#entry-dialog'), entryForm: $('#entry-form'), entryId: $('#entry-id'), entryDate: $('#entry-date'),
  entryStart: $('#entry-start'), entryEnd: $('#entry-end'), entryDuration: $('#entry-duration'), entryNote: $('#entry-note'),
  entryDialogTitle: $('#entry-dialog-title'), formError: $('#form-error'), startField: $('#start-field'), endField: $('#end-field'),
  durationField: $('#duration-field'), settingsForm: $('#settings-form'), weeklyTargetInput: $('#weekly-target-input'),
  weekdayTargets: $('#weekday-targets'), importData: $('#import-data'),
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function showError(message) {
  elements.formError.textContent = message;
  elements.formError.hidden = !message;
}

function showStorageError(message) {
  elements.storageError.textContent = message;
  elements.storageError.hidden = !message;
}

function announce(message) {
  elements.liveAnnouncer.textContent = '';
  window.setTimeout(() => { elements.liveAnnouncer.textContent = message; }, 20);
}

function setWeek(offset) {
  const range = getWeekRangeFromKey(selectedWeekStartKey);
  range.start.setDate(range.start.getDate() + offset * 7);
  selectedWeekStartKey = dateKeyFromDate(range.start);
  render();
}

function balanceClass(balance) {
  return balance > 0 ? 'is-over' : balance < 0 ? 'is-under' : 'is-neutral';
}

function render() {
  const state = store.getState();
  const now = new Date();
  const { start, end } = getWeekRangeFromKey(selectedWeekStartKey);
  const weekKeys = getDateKeysInRange(start, end);
  const total = weeklyWorkedMinutes(state.entries, state.activeTimer, start, end, now);
  const target = state.settings.weeklyTargetMinutes;
  const balance = total - target;
  const progress = target > 0 ? Math.min(100, Math.round((total / target) * 100)) : 100;

  elements.weekHeading.textContent = formatWeekLabel(start, end);
  elements.headerTotal.textContent = `${formatDuration(total)} / ${formatDuration(target)}`;
  elements.weeklyTotal.textContent = formatDuration(total);
  elements.weeklyTargetLabel.textContent = `Target: ${formatDuration(target)}`;
  elements.weeklyBalance.textContent = balance === 0 ? 'On target' : `${formatDuration(Math.abs(balance))} ${balance > 0 ? 'over' : 'under'}`;
  elements.weeklyStatus.className = `status-pill ${balance > 0 ? 'status-positive' : balance < 0 ? 'status-neutral' : 'status-positive'}`;
  elements.weeklyStatus.textContent = balance > 0 ? `${formatDuration(balance)} over target` : balance < 0 ? `${formatDuration(-balance)} remaining` : 'Target reached';
  elements.weeklyProgress.setAttribute('aria-valuenow', String(progress));
  elements.weeklyProgress.querySelector('span').style.width = `${progress}%`;
  elements.proposedEnd.textContent = proposedEndText(state, now);
  elements.projection.textContent = projectionText(state, start, end, now);
  elements.days.innerHTML = weekKeys.map((key) => renderDay(state, key, now)).join('');
  renderSettings(state);
  showStorageError(loaded.error || (adapter.available ? '' : 'Browser storage is unavailable. Data will not persist after refresh.'));
}

function proposedEndText(state, now) {
  const todayKey = dateKeyFromDate(now);
  const target = dailyTargetMinutes(state.settings, todayKey);
  if (target === 0) return 'No scheduled target';
  const worked = dailyWorkedMinutes(state.entries, state.activeTimer, todayKey, now);
  const remaining = Math.max(0, target - worked);
  if (remaining === 0) return `Target reached - ${formatDuration(worked - target)} over`;
  return `${formatTime(new Date(now.getTime() + remaining * 60 * 1000))} today`;
}

function projectionText(state, start, end, now) {
  const projection = projectWeeklyTarget({ entries: state.entries, activeTimer: state.activeTimer, settings: state.settings, weekStart: start, weekEnd: end, now });
  if (projection.kind === 'reached') return projection.reachedAt ? `Reached ${formatTime(projection.reachedAt)}` : 'Weekly target reached';
  if (!projection.plannedDays) return `${formatDuration(projection.remaining)} remaining`;
  return `${formatDuration(projection.remaining)} - ${projection.plannedDays} planned day${projection.plannedDays === 1 ? '' : 's'}`;
}

function renderDay(state, dateKey, now) {
  const todayKey = dateKeyFromDate(now);
  const isToday = dateKey === todayKey;
  const target = dailyTargetMinutes(state.settings, dateKey);
  const worked = dailyWorkedMinutes(state.entries, state.activeTimer, dateKey, now);
  const balance = worked - target;
  const entries = entriesForDate(state.entries, dateKey);
  const activeMinutes = activeTimerMinutesForDate(state.activeTimer, dateKey, now);
  const hasActiveTimer = Boolean(state.activeTimer && activeMinutes >= 0 && dateKey === dateKeyFromDate(new Date(state.activeTimer.startedAt)));
  const entryMarkup = entries.map((entry) => renderEntry(entry)).join('');
  const runningMarkup = hasActiveTimer ? `<div class="entry-row running"><div class="entry-main"><span>Timer running</span><span data-live-timer="${escapeHtml(state.activeTimer.startedAt)}">${formatElapsed(state.activeTimer.startedAt, now)}</span></div><div class="entry-note">Started ${formatTime(state.activeTimer.startedAt)}</div><div class="entry-actions"><button class="text-button delete" type="button" data-action="stop-timer">Stop timer</button></div></div>` : '';
  const actionMarkup = isToday
    ? state.activeTimer ? `<button class="button timer-button day-actions" type="button" data-action="stop-timer">Stop timer</button>` : `<button class="button timer-button day-actions" type="button" data-action="start-timer">Start timer</button>`
    : `<button class="button button-secondary day-actions" type="button" data-action="add-entry" data-date="${dateKey}">Add entry</button>`;
  return `<article class="day-card ${isToday ? 'is-today' : ''}">
    <div class="day-card-header"><div><div class="day-name">${escapeHtml(formatDayName(dateKey))}</div><div class="day-date">${escapeHtml(formatDate(dateKey))}</div></div>${isToday ? '<span class="today-tag">Today</span>' : ''}</div>
    <p class="day-total">${formatDuration(worked)}</p><div class="day-target">Target: ${target ? formatDuration(target) : 'No target'}</div>
    <div class="day-balance ${balanceClass(balance)}">${target ? escapeHtml(formatSignedBalance(balance)) : `${formatDuration(worked)} logged`}</div>
    <div class="entry-list">${runningMarkup}${entryMarkup || (!runningMarkup ? '<div class="empty-day">No entries yet</div>' : '')}</div>
    ${actionMarkup}
    ${!isToday ? `<button class="text-button day-actions" type="button" data-action="add-entry" data-date="${dateKey}">+ Add manual entry</button>` : '<button class="text-button day-actions" type="button" data-action="add-entry" data-date="'+dateKey+'">+ Add manual entry</button>'}
  </article>`;
}

function renderEntry(entry) {
  const timeText = entry.start && entry.end ? `${formatTime(entry.start)} - ${formatTime(entry.end)}` : `${formatDuration(entry.durationMinutes)} - duration only`;
  return `<div class="entry-row"><div class="entry-main"><span>${escapeHtml(timeText)}</span><span>${formatDuration(entry.durationMinutes, { compact: true })}</span></div>${entry.note ? `<div class="entry-note" title="${escapeHtml(entry.note)}">${escapeHtml(entry.note)}</div>` : ''}<div class="entry-actions"><button class="text-button" type="button" data-action="edit-entry" data-id="${escapeHtml(entry.id)}">Edit</button><button class="text-button delete" type="button" data-action="delete-entry" data-id="${escapeHtml(entry.id)}">Delete</button></div></div>`;
}

function formatElapsed(startedAt, now = new Date()) {
  const milliseconds = Math.max(0, now - new Date(startedAt));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function renderSettings(state) {
  elements.weeklyTargetInput.value = String(state.settings.weeklyTargetMinutes / 60);
  elements.weekdayTargets.innerHTML = [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const date = new Date(2024, 0, day === 0 ? 7 : day + 1);
    const label = date.toLocaleDateString(undefined, { weekday: 'short' });
    return `<label>${label}<input name="weekday-target-${day}" type="number" min="0" max="24" step="0.25" value="${state.settings.weekdayTargetMinutes[day] / 60}" required></label>`;
  }).join('');
}

function toggleEntryMode() {
  const mode = elements.entryForm.querySelector('input[name="entry-mode"]:checked').value;
  const durationMode = mode === 'duration';
  elements.startField.hidden = durationMode;
  elements.endField.hidden = durationMode;
  elements.durationField.hidden = !durationMode;
  elements.entryStart.required = !durationMode;
  elements.entryEnd.required = !durationMode;
  elements.entryDuration.required = durationMode;
}

function openEntryDialog(dateKey, entryId = '') {
  const entry = entryId ? store.getState().entries.find((item) => item.id === entryId) : null;
  elements.entryForm.reset();
  showError('');
  elements.entryId.value = entry?.id || '';
  elements.entryDate.value = entry?.date || dateKey;
  elements.entryNote.value = entry?.note || '';
  elements.entryDialogTitle.textContent = entry ? 'Edit entry' : 'Add entry';
  if (entry?.start && entry?.end) {
    elements.entryForm.querySelector('input[value="interval"]').checked = true;
    elements.entryStart.value = localTimeValue(entry.start);
    elements.entryEnd.value = localTimeValue(entry.end);
  } else if (entry) {
    elements.entryForm.querySelector('input[value="duration"]').checked = true;
    elements.entryDuration.value = String(entry.durationMinutes);
  } else {
    elements.entryForm.querySelector('input[value="interval"]').checked = true;
  }
  toggleEntryMode();
  elements.entryDialog.showModal();
  elements.entryDate.focus();
}

function localTimeValue(iso) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function saveEntry(event) {
  event.preventDefault();
  showError('');
  const date = elements.entryDate.value;
  if (!dateFromKey(date)) return showError('Choose a valid date.');
  const mode = elements.entryForm.querySelector('input[name="entry-mode"]:checked').value;
  const input = { date, note: elements.entryNote.value.trim(), source: 'manual' };
  if (mode === 'duration') {
    const duration = Number(elements.entryDuration.value);
    if (!Number.isInteger(duration) || duration < 1) return showError('Duration must be a whole number of minutes greater than zero.');
    input.durationMinutes = duration; input.start = null; input.end = null;
  } else {
    input.start = localDateTimeIso(date, elements.entryStart.value);
    input.end = localDateTimeIso(date, elements.entryEnd.value);
    if (!input.start || !input.end) return showError('Enter both a valid start and end time.');
    if (new Date(input.end) <= new Date(input.start)) return showError('End time must be after start time. Overnight entries must be split across dates.');
    input.durationMinutes = Math.round((new Date(input.end) - new Date(input.start)) / 60000);
  }
  try {
    if (elements.entryId.value) store.updateEntry(elements.entryId.value, input); else store.addEntry(input);
    elements.entryDialog.close();
    announce('Entry saved.');
    render();
  } catch (error) { showError(error.message); showStorageError(error.message); }
}

function handleDayAction(event) {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const action = control.dataset.action;
  try {
    if (action === 'add-entry') openEntryDialog(control.dataset.date);
    if (action === 'edit-entry') openEntryDialog('', control.dataset.id);
    if (action === 'delete-entry') {
      if (window.confirm('Delete this entry? This cannot be undone.')) { store.deleteEntry(control.dataset.id); announce('Entry deleted.'); render(); }
    }
    if (action === 'start-timer') {
      store.startTimer(); announce('Timer started.'); render();
    }
    if (action === 'stop-timer') {
      const timer = store.getState().activeTimer;
      if (timer && dateKeyFromDate(new Date(timer.startedAt)) !== dateKeyFromDate(new Date()) && !window.confirm('This timer crossed midnight. It will be split across the two dates. Stop it?')) return;
      store.stopTimer(); announce('Timer stopped and saved.'); render();
    }
  } catch (error) { showStorageError(error.message); }
}

async function importData(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const result = validateDocument(parsed);
    if (!result.valid) throw new Error(result.error);
    if (!window.confirm('Replace all current WorkClock data with this backup?')) return;
    store.replace(parsed);
    announce('Backup imported.'); render();
  } catch (error) { showStorageError(`Import failed: ${error.message}`); }
}

function exportData() {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `workclock-${dateKeyFromDate(new Date())}.json`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  announce('Backup exported.');
}

function saveSettings(event) {
  event.preventDefault();
  try {
    const weeklyHours = Number(elements.weeklyTargetInput.value);
    const weeklyTargetMinutes = Math.round(weeklyHours * 60);
    const weekdayTargetMinutes = {};
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      const hours = Number(elements.settingsForm.querySelector(`[name="weekday-target-${day}"]`).value);
      if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw new Error('Daily targets must be between 0 and 24 hours.');
      weekdayTargetMinutes[day] = Math.round(hours * 60);
    }
    if (!Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > 168) throw new Error('Weekly target must be between 0 and 168 hours.');
    store.updateSettings({ weeklyTargetMinutes, weekdayTargetMinutes });
    announce('Targets saved.'); render();
  } catch (error) { showStorageError(error.message); }
}

$('#previous-week').addEventListener('click', () => setWeek(-1));
$('#next-week').addEventListener('click', () => setWeek(1));
$('#today-week').addEventListener('click', () => { selectedWeekStartKey = dateKeyFromDate(getWeekRange().start); render(); });
elements.days.addEventListener('click', handleDayAction);
elements.entryForm.addEventListener('submit', saveEntry);
elements.entryForm.querySelectorAll('input[name="entry-mode"]').forEach((input) => input.addEventListener('change', toggleEntryMode));
$('#close-entry').addEventListener('click', () => elements.entryDialog.close());
$('#cancel-entry').addEventListener('click', () => elements.entryDialog.close());
elements.settingsForm.addEventListener('submit', saveSettings);
$('#export-data').addEventListener('click', exportData);
elements.importData.addEventListener('change', importData);
elements.entryDialog.addEventListener('click', (event) => { if (event.target === elements.entryDialog) elements.entryDialog.close(); });

store.subscribe(() => { if (!adapter.available) showStorageError('Browser storage is unavailable or full. Changes are only in memory.'); });
timerInterval = window.setInterval(() => { if (store.getState().activeTimer) render(); }, 1000);
toggleEntryMode();
render();
