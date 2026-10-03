# Implementation Plan: Mobile and First-Run UX

Date: 2026-10-02 · Status: Implemented locally; verification passing; awaiting visual review.

## Overview

Make the dashboard builder easier to understand and use from a phone, make CSV/JSON upload an obvious starting action, and reduce wrapping in the desktop toolbar. Keep the existing starter dashboard, sample data, local upload profiling, chart types, save formats, and export behavior. Treat this as an additive responsive pass: desktop authoring remains stable while core authoring becomes practical at phone widths.

## Evidence and scope

- At 375×812, the chart palette takes 160px and the grid gets about 176px; charts and controls are cramped. The header actions measured 31px high.
- At 1280×800, several toolbar labels wrap onto two lines. The global data popover is discoverable only after clicking “Data: Tile samples”; the popover then offers a CSV/JSON drop target.
- The live demo had no browser-console errors or warnings at the reviewed sizes and no document-level horizontal overflow at 375px.
- The current README documents desktop Chrome as the verified editor scope and excludes mobile editing from its retained acceptance evidence.
- Existing app contracts to reuse: `#app-header`, `#palette`, and `#grid-wrap` in `index.html`; dashboard upload/profile flow in `src/ui/dashboardDataPopover.js` and `src/ui/guidedStart.js`; grid and tile controls in `src/main.js`; responsive styling in `src/style.css`.

## Product decisions

- Preserve the sample dashboard as the live demo’s useful starting state. Add a clear “Add data” path without making first-run onboarding modal or blocking.
- Reuse the existing CSV/JSON worker, dashboard-data popover, guided profile, and suggestion flow. Do not add another parser or transmit data to a service.
- On phones, prioritize visible controls and click-to-add. Drag-and-drop is optional; it must not be the only way to add a chart.
- Target core editing at 320px and above: add/remove charts, rename a tile, choose data, open settings, and save/export. SQL remains reachable in a viewport-fitting panel. Keep existing desktop behavior and file/schema contracts.
- Keep interactive targets at least 44×44 CSS pixels at phone widths where practical; provide visible focus, Escape-to-close, and focus return for drawers or menus.

## Dependency order

```text
Responsive contract and shell
        ├── Mobile chart drawer ──┐
        └── Data entry path       ├── Mobile canvas and tile controls
                                  └── Desktop toolbar polish
                                             └── Docs and full verification
```

## Task list

### Phase 1: Set the mobile interaction contract

#### Task 1: Add a compact mobile action shell

**Description:** At phone widths, replace the wrapping desktop action row with a compact, labeled action hierarchy. Keep “Add data” and “Charts” easy to reach; put lower-frequency theme, import, and presentation actions in a clearly named menu. Preserve the current desktop header.

**Acceptance criteria:**
- [x] At 320px and 375px widths, the product name, primary actions, and status remain readable without clipped or wrapped button labels.
- [x] Every existing action remains reachable by pointer, touch-sized targets, and keyboard; menu state has an accessible name, expanded state, Escape behavior, and focus return.
- [x] Desktop toolbar content and behavior remain unchanged at 1024px, 1280px, and 1440px except for the separately scoped label polish in Task 5.

**Verification:** Add Playwright viewport and keyboard cases; capture desktop/tablet/phone screenshots; verify focus order and `aria-expanded` changes.

**Dependencies:** None.

**Files likely touched:** `index.html`, `src/main.js`, `src/style.css`, `tests/browser/`.

**Estimated scope:** Medium.

#### Task 2: Make the chart palette a phone-sized drawer

**Description:** Convert the fixed phone sidebar into a dismissible chart drawer launched from the “Charts” action. Keep the existing chart descriptions and click-to-add behavior; after adding a chart, return the user to the canvas and restore focus predictably.

**Acceptance criteria:**
- [x] The palette no longer permanently consumes dashboard width below the mobile breakpoint; opening and closing it never causes document-level horizontal scrolling.
- [x] All chart types are available through a touch-sized, keyboard-operable control; drag is not required on touch devices.
- [x] The drawer has a clear close action, Escape handling, visible focus, and focus return; reduced-motion settings suppress its movement animation.

**Verification:** Browser checks at 320px and 375px for opening, selecting, closing, Escape, focus return, and adding each representative chart class; inspect accessibility names and reduced-motion behavior.

**Dependencies:** Task 1.

**Files likely touched:** `index.html`, `src/main.js`, `src/style.css`, `tests/browser/`.

**Estimated scope:** Medium.

### Checkpoint: Mobile navigation

- [x] The chart drawer and action menu work at 320px and 375px without losing keyboard access.
- [x] Desktop and tablet screenshots show no regression in the palette or toolbar.

### Phase 2: Give the canvas room and clarify upload

#### Task 3: Reflow the phone canvas and tile controls

**Description:** Let the dashboard use the available phone width, stack tiles into a readable single-column flow, and adapt tile headers, data/settings controls, popovers, and SQL panels for narrow screens. Keep source notes, chart data alternatives, and resize affordances reachable without nested scroll traps.

**Acceptance criteria:**
- [x] At 320px and 375px, no document-level horizontal overflow occurs; the chart area is full-width after the palette drawer closes.
- [x] Add/remove, title, data, settings, data-table, save, JSON export, and HTML export controls remain usable with touch targets at least 44×44px where applicable.
- [x] At 768px, 1024px, 1280px, and 1440px, existing responsive grid, chart sizing, resize persistence, and present mode continue to work.

**Verification:** Extend the layout browser suite for phone widths, viewport-contained popovers/SQL, keyboard access, and chart/table legibility; capture screenshots at 320×740, 375×812, 768×1024, 1024×768, 1280×800, and 1440×900.

**Dependencies:** Tasks 1–2.

**Files likely touched:** `src/style.css`, `src/main.js`, `tests/browser/layout-resize.spec.js`, `tests/browser/`.

**Estimated scope:** Medium.

#### Task 4: Make adding a dataset an obvious starting action

**Description:** Rename and promote the current global “Data: Tile samples” entry to a clear “Add data” action. In its existing popover, present “Upload CSV or JSON” before sample choices and explain that processing is local. Preserve the current guided profile, suggestion review, keep-dashboard, and replace-confirmation behavior.

**Acceptance criteria:**
- [x] A first-time user can identify how to upload a CSV/JSON from the first viewport without knowing that “Data: Tile samples” opens a menu.
- [x] Upload uses the existing dashboard-data path and guided-start review; sample choices remain available and are not silently applied over uploaded data.
- [x] Cancelling/keeping the current dashboard preserves its layout and data; replacing still uses the existing confirmation behavior.

**Verification:** Extend guided-start browser cases for the renamed entry, upload-first hierarchy, local processing copy, cancel/keep, and replace confirmation.

**Dependencies:** Task 1. This can proceed independently of Task 2 once the mobile action shell exists.

**Files likely touched:** `index.html`, `src/main.js`, `src/ui/dashboardDataPopover.js`, `src/style.css`, `tests/browser/guided-start.spec.js`.

**Estimated scope:** Medium.

### Checkpoint: Core mobile authoring

- [x] A user can open Charts, add a chart, choose data, rename/configure a tile, and save/export at 375px.
- [x] Upload, keep, and replacement flows preserve data and layout contracts.
- [x] 320px and tablet views remain free of document-level horizontal overflow.

### Phase 3: Finish desktop polish and supported-scope evidence

#### Task 5: Prevent desktop toolbar labels from wrapping

**Description:** Shorten visible labels and group lower-frequency actions so the toolbar remains scannable at 1280px. Keep accessible names and tooltips descriptive; keep destructive “Clear grid” visually distinct and out of the primary action group.

**Acceptance criteria:**
- [x] At 1280px, toolbar labels do not wrap or collide with the brand or status message.
- [x] Upload, Templates, and HTML export retain strong visibility; import/save/JSON/presentation actions remain one step away.
- [x] Keyboard order, focus style, and current button semantics remain intact.

**Verification:** Screenshot at 1024px, 1280px, and 1440px; browser-check keyboard traversal and action-menu open/close.

**Dependencies:** Task 1.

**Files likely touched:** `index.html`, `src/style.css`, `tests/browser/`.

**Estimated scope:** Small.

#### Task 6: Document mobile editor support and close acceptance gaps

**Description:** Update the README’s supported editor viewport statement only after the mobile acceptance checks pass. Record any remaining browser, assistive-technology, or advanced-SQL limits precisely.

**Acceptance criteria:**
- [x] README distinguishes verified phone/tablet viewport emulation from unverified physical-device, browser, and assistive-technology acceptance.
- [x] `npm test`, `npm run build`, and all 20 browser tests pass with a clean process exit.
- [x] Reviewed screenshots and Git diff contain only intentional UX/test evidence; prior diagnostic evidence is preserved.

**Verification:** Run unit/render and build suites; exercise pointer and keyboard flows in browser viewport emulation at the target widths; check `git diff --check` and final status. Physical-device touch and assistive-technology acceptance remain unverified.

**Dependencies:** Tasks 1–5.

**Files likely touched:** `README.md`, `docs/`, `tests/browser/`.

**Estimated scope:** Small.

### Checkpoint: Ready for review

- [x] All six tasks meet their acceptance criteria.
- [x] Existing 36 renderer cases, 14 unit tests, and all 20 browser tests pass.
- [x] No existing layout, data-binding, local-upload, JSON, or HTML-export contracts regress.
- [ ] Review the product changes and screenshots before any merge or publishing step.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| GridStack and chart labels become unreadable at phone widths | High | Use a drawer for palette space, single-column tiles, and minimum readable plot dimensions; show an explicit scroll fallback only inside a constrained chart/data region. |
| More compact navigation hides important actions | Medium | Keep Add data and Charts visible; test every existing action through keyboard and touch paths. |
| Drawer or popover focus is lost | High | Reuse `src/ui/focus.js` patterns; verify open, Escape, close button, and focus return in browser tests. |
| Upload CTA duplicates or bypasses current upload safety | High | Reuse `dashboardDataPopover.js`, `readUpload`, and guided-start; do not add a second parser or direct-apply path. |
| Mobile screenshots/test probes overwrite retained diagnostics | Medium | Save new evidence under a new UX-specific path; inspect initial/final `git status` and never overwrite the existing layout-resize evidence. |
| Browser test runner again fails to exit after reporting results | Medium | Treat clean process exit as a gate; diagnose test-server teardown if it recurs instead of counting printed passes alone. |

## Deferred

- Native mobile chart drag-and-drop; click-to-add is the required phone path.
- Redesign of SQL editing beyond fitting the existing panel to narrow viewports.
- New onboarding tour, product analytics, or remote data processing.

## Approval boundary

The UX changes and evidence remain local and uncommitted for owner review. No publishing or release action was taken.
