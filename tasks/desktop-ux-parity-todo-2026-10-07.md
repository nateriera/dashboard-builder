# Desktop UX and UI Parity Follow-up

Checklist corresponding to [desktop-ux-parity-plan-2026-10-07.md](desktop-ux-parity-plan-2026-10-07.md). Planning only; no implementation has started.

## Phase 1: Header and navigation

- [ ] Group actions into a clear desktop hierarchy.
- [ ] Separate page/saved-view navigation from save/export/present/destructive actions.
- [ ] Verify 1024×768, 1280×800, and 1440×900, keyboard order, focus, labels, and stable IDs.

## Phase 2: Filter feedback

- [ ] Improve source-field and scope clarity in filter creation.
- [ ] Make active selections and affected chart behavior apparent.
- [ ] Differentiate filtered-empty, ignored, and unmapped states without color-only cues.
- [ ] Preserve saved views, date filters, page scope, and export semantics.

### Checkpoint: Header and filter feedback

- [ ] Focused browser cases and full browser suite pass.
- [ ] Production build passes; desktop screenshots show no clipping or obstruction.

## Phase 3: Drill-through and table inspection

- [ ] Add an explicit route to selected-mark records.
- [ ] Distinguish selected-mark records from the full tile data table.
- [ ] Verify chart type, keyboard, search, sort, pagination, and destination behavior.

## Phase 4: First-run hint

- [ ] Relocate the hint so it does not cover charts.
- [ ] Preserve dismissal, discoverability, accessibility, and present-mode behavior.

## Phase 5: Parity and finish

- [ ] Compare desktop action hierarchy, filtering, drill-through, and orientation against the selected reference set.
- [ ] Run `npm test`, `npm run test:browser`, and `npm run build`.
- [ ] Review screenshots, generated artifacts, and working tree before any release action.

## Scope guard

- [ ] Desktop composer only; mobile path/branch is excluded.
- [ ] No filter-semantic or export-viewer changes without a reproduced defect and explicit scope update.
- [ ] No implementation, commit, or push has been performed as part of this planning task.
