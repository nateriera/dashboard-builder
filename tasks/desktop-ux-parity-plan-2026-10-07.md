# Implementation Plan: Desktop UX and UI Parity Follow-up

## Overview

Improve the desktop composer around the audit’s weakest areas: the crowded global toolbar, unclear cross-filter consequences, hidden selected-mark drill-through, and the first-run hint covering chart content. Keep the charting/data behavior that the existing browser suite already verifies. Use the chosen reference set—Power BI, Tableau, Looker Studio, and Metabase—as a qualitative desktop-parity lens, while preserving Dashboard Builder’s local-first composer model.

This document records the requested plan; implementation and release status remain governed by the existing project approvals and the user's next instruction.

## Scope and constraints

- Desktop composer only. Do not work in the mobile path or branch.
- Keep chart rendering, data formats, filter operators, persistence schemas, and exported viewer behavior stable unless implementation reveals a concrete, reproducible defect that requires a scoped change.
- Preserve current control IDs and keyboard-operable flows where practical so existing automation and user workflows remain stable.
- Do not make no-result tiles disappear or silently ignore filters. Explain the current result and the target’s mapping/interaction state.
- No product-wide redesign; use current theme tokens and component conventions.

## Architecture fit

The current desktop shell and responsive header styles are in `src/style.css`; toolbar markup is in `index.html` and its action wiring is in `src/main.js`. Filters are constructed in `src/ui/filtersPopover.js`, while cross-filter chips and neutral empty states are rendered in `src/main.js`. Selected-mark record tables are also built from `src/main.js`. Browser acceptance coverage lives under `tests/browser/`.

Keep this sequence vertical: first clarify navigation/action hierarchy, then explain filter outcomes, then make record inspection discoverable, and finally remove the first-run obstruction and perform the visual polish pass.

## Proposed tasks

### Phase 1: Reorganize the desktop header and navigation

**Description:** Group actions into a compact hierarchy so data/filter controls, view/page navigation, and layout/export/presentation actions scan as distinct clusters. Preserve all actions; reduce the always-visible competition and prevent the product title and status from being clipped at common desktop widths.

**Acceptance criteria:**
- [ ] At 1280×800 and 1440×900, the app title, primary actions, and status are visible without horizontal clipping or accidental horizontal scrolling.
- [ ] Page tabs and saved-view controls are visually distinct from export and destructive actions.
- [ ] Every existing toolbar action remains reachable by keyboard, has a visible focus state, and retains its accessible name and stable ID where possible.
- [ ] At 1024×768, controls wrap or collapse deliberately without obscuring the canvas or making primary actions unavailable.

**Verification:** Browser walkthrough of data, filters, saved views, pages, theme, templates, save/import/export, present, and clear actions; screenshots at the three desktop sizes; keyboard-only focus-order check.

**Dependencies:** None.

**Likely files:** `index.html`, `src/style.css`, `src/main.js`, `tests/browser/`.

**Estimated scope:** Medium.

### Phase 2: Explain filter scope and chart response

**Description:** Improve the filter popover and active-filter feedback. Make it apparent which field and scope a filter uses, which charts receive it, and whether a tile was filtered, highlighted, ignored, or returned no matching rows. Keep the existing filter semantics and neutral empty state unless a reproducible mismatch is found.

**Acceptance criteria:**
- [ ] The filter creation flow keeps source chart, source field, and scope legible, including the selected-chart mapping step.
- [ ] Active filter chips identify the source and selected field/value; users can remove one selection without clearing unrelated selections.
- [ ] Tiles configured to filter, highlight, or ignore show distinguishable feedback, with concise text or status that does not rely on color alone.
- [ ] A genuinely empty filtered result stays visible and explains the filter context; unmapped or ignored relationships are not presented as equivalent to an empty result.
- [ ] Existing saved-view, page-scope, date-filter, export-resolution, and cross-filter tests continue to pass.

**Verification:** Extend browser cases for filter creation, field mapping, all three target behaviors, no-result state, clear-one/clear-all, saved-view restore, and desktop popover placement. Compare editor behavior to the existing offline/export behavior only as a regression check; do not redesign the viewer.

**Dependencies:** Task 1 for final header placement; interaction model can be prototyped before Task 1 is merged.

**Likely files:** `src/ui/filtersPopover.js`, `src/main.js`, `src/style.css`, `tests/browser/phase2-interactivity.spec.js`.

**Estimated scope:** Medium.

### Checkpoint: Header and filter feedback

- [ ] Full browser suite and production build pass.
- [ ] Desktop screenshots show the header hierarchy and filter popover without clipped controls or chart obstruction.
- [ ] Existing filter semantics remain intact; any behavior change has a reproducer and a regression test.

### Phase 3: Make drill-through and table inspection discoverable

**Description:** Clarify the difference between a tile’s full data table and the table of records for a selected chart mark. Add an explicit, consistently placed route to inspect selected-mark records and make the current selection evident.

**Acceptance criteria:**
- [ ] A chart mark selection exposes a named “Inspect selected records” (or equivalent) action without requiring users to infer that a table appeared below the chart.
- [ ] The selected value and originating chart are visible in the record view, and clearing/changing the mark updates the records predictably.
- [ ] Search, sort, pagination, and close/collapse actions remain keyboard accessible and retain state where current behavior already supports it.
- [ ] The all-rows table and selected-mark table are clearly differentiated in labels and headings.

**Verification:** Browser walkthrough for bar, donut, and scatter selections; keyboard activation; empty selection; search/sort/pagination; verify no regression in configured drill-through destinations.

**Dependencies:** None; can proceed after the header/filter checkpoint to avoid concurrent changes to shared tile chrome.

**Likely files:** `src/main.js`, `src/style.css`, `tests/browser/phase2-interactivity.spec.js`.

**Estimated scope:** Medium.

### Phase 4: Move the first-run hint out of chart content

**Description:** Keep onboarding instructions available while avoiding the fixed lower-right overlay over chart content. Prefer an inline, dismissible getting-started panel within the palette or an explicitly opened help surface; preserve dismissal behavior.

**Acceptance criteria:**
- [ ] The initial dashboard’s charts and data remain unobstructed at 1280×800 and 1440×900.
- [ ] The help content is still discoverable, dismissible, keyboard accessible, and hidden in present mode.
- [ ] Dismissal persists according to current behavior and does not alter dashboard data or layout.

**Verification:** First-run and returning-user browser cases, keyboard check, screenshot comparison, and present-mode check.

**Dependencies:** Tasks 1–3, so the final available palette and header space are known.

**Likely files:** `src/main.js`, `src/style.css`, `tests/browser/prelaunch-fixes.spec.js`.

**Estimated scope:** Small.

### Phase 5: Desktop parity and finish checkpoint

**Description:** Compare the revised desktop composer against the four selected reference applications for action hierarchy, filter feedback, chart-to-record navigation, and first-run orientation. Record remaining parity opportunities separately rather than expanding this implementation slice.

**Acceptance criteria:**
- [ ] All Phase 1–4 criteria pass at 1024×768, 1280×800, and 1440×900.
- [ ] Keyboard and accessibility checks cover names, focus visibility/order, popover dismissal, announcements, and non-color state cues.
- [ ] Existing browser suite and production build pass; generated documentation screenshots/diagnostics are reviewed for unintended changes.
- [ ] No mobile branch/path work, export redesign, or unrelated feature expansion is included.

**Verification:** Full `npm run test:browser`, `npm test`, and `npm run build`; manual desktop walkthrough; review changed screenshots and `git status` before any release action.

**Dependencies:** Tasks 1–4.

**Estimated scope:** Small.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Toolbar regrouping reduces discoverability or breaks stable selectors | High | Keep familiar labels, preserve IDs where possible, and cover every action in browser checks. |
| Filter feedback changes are mistaken for filter-logic changes | High | Keep operators and target behavior stable; distinguish “no matching rows” from ignored/unmapped state. Require evidence before changing semantics. |
| Drill-through controls increase tile-header density | Medium | Keep the action near the chart interaction and use progressive disclosure rather than adding another permanent header button. |
| Moving onboarding consumes palette space | Medium | Measure chart-canvas width at desktop breakpoints and allow dismissal; avoid adding a second persistent column. |
| CSS-only polish masks layout behavior at narrower desktop widths | Medium | Verify 1024×768 alongside 1280×800 and 1440×900. |

## Decisions and open questions

- Keep existing filter and export semantics; the audit did not establish a reproducible data-logic defect.
- Decide during Task 1 whether secondary toolbar actions belong in labeled groups or one overflow menu. Prefer labeled groups unless the 1024px layout still clips.
- Decide during Task 3 whether selected records expand inline or use a side panel. Prefer inline disclosure for the first pass to preserve the current interaction model.
- No new product decision is needed before implementation beyond reviewing this plan and its priority order.
