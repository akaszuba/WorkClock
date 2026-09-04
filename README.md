# WorkClock

WorkClock is a small, static time-recording app for answering two questions quickly: how much has been worked this week, and when the daily or weekly target will be reached.

It has no server, account, database, or network dependency. Entries and timer state are stored locally in the browser under `workclock.data.v1`.

## Run locally

The app is static and can be opened directly by opening `index.html`. For a more representative browser deployment, serve this directory with any static file server, for example:

```text
python -m http.server 8000
```

Then open `http://localhost:8000`. No build step or dependency installation is required.

Run the unit tests with:

```text
npm test
```

## Data and backup

- The work week is Monday through Sunday in the user’s local timezone.
- The default weekly target is 40 hours.
- Weekdays default to 8 hours; weekends default to no target.
- Interval entries must have an end after their start. Overnight manual entries should be split across dates.
- Overlapping interval entries on the same date are rejected. Duration-only entries do not participate in interval overlap checks because they have no exact time range.
- A running timer stores its ISO start timestamp and is reconstructed after refresh. Stopping a timer that crosses midnight splits it at local midnight.
- `Export JSON` creates a portable versioned backup. `Import JSON` validates the version and shape and asks for confirmation before replacing current data.

The app displays timestamps in local time but stores them as ISO strings. It stores no secrets or personally identifiable information.

## Structure

- `index.html` — semantic application shell.
- `styles.css` — responsive, dark-mode-aware, print-friendly styles.
- `src/app.js` — rendering and browser event wiring.
- `src/state.js` — versioned state, schema validation, storage adapter, and mutations.
- `src/time.js` — local date/time calculations, totals, and projection helpers.
- `tests/` — Node test-runner coverage for date boundaries, totals, projections, and validation.
