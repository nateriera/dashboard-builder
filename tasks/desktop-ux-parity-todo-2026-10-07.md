# Desktop UX and UI Parity Follow-up

Implementation checklist corresponding to [desktop-ux-parity-plan-2026-10-07.md](desktop-ux-parity-plan-2026-10-07.md).

## Phase 1: Header and navigation — complete

- [x] Group actions into a clear desktop hierarchy.
- [x] Separate page/saved-view navigation from save/export/present/destructive actions.
- [x] Verify header geometry at 1024, 1280, and 1440 widths; preserve keyboard access, labels, and stable IDs.

## Phase 2: Filter feedback — complete

- [x] Clarify active selection context and source field.
- [x] Distinguish filtered, highlighted, ignored, and unmapped chart behavior with text.
- [x] Preserve saved views, date filters, page scope, and export semantics.

## Phase 3: Drill-through and table inspection — complete

- [x] Add a named tile-toolbar action to reach selected-mark records.
- [x] Keep selected records in a separate, initially collapsed table from the full chart data table.
- [x] Show source chart, selected field/value, and row count in the selected-record label.
- [x] Open and focus the selected-record table from the keyboard-operable action.
- [x] Preserve table search, sorting, pagination, and configured destination behavior.
- [x] Verify selected-record action for bar and donut marks; configured navigation is covered by existing browser tests.

## Phase 4: First-run hint — complete

- [x] Move help into the palette so it does not cover charts.
- [x] Preserve dismissal, discoverability, accessibility, and present-mode behavior.

## Phase 5: Parity and finish — complete

- [x] Keep scope to the desktop composer; mobile path/branch remains untouched.
- [x] Run `npm test`, `npm run test:browser`, and `npm run build`.
- [x] Review and discard browser-generated screenshots/diagnostics before committing.

## Follow-up opportunities

- [ ] Revisit scatter mark activation and selected-record inspection; the focused browser attempt did not reliably invoke the chart selection handler.
- [ ] Consider splitting the main app bundle, which remains above Vite's 500 kB warning threshold.
