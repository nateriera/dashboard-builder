# Implementation Plan: Guided Start from Data

## Overview

Help a first-time or occasional user turn a local CSV/JSON file into a useful dashboard quickly. After the existing upload parser returns rows and columns, offer a compact data summary and a small set of explainable chart and layout suggestions. Let the user preview and apply suggestions into the current composer, then continue editing and exporting with the existing controls. Keep processing local, preserve explicit user choices, and do not replace the active dashboard without confirmation.

This plan selects the highest-value recommendation from the product review. Saved preparation recipes, dashboard-wide filters, annotations, and refresh-from-file remain follow-on candidates; they are not part of this implementation slice.

## Product decisions

- Keep the current direct-upload path available; the guided flow is an optional next step after parsing.
- Use deterministic, local heuristics over the parsed sample and column metadata. Do not send data to a service or introduce an AI dependency.
- Explain every suggestion with the field roles and signals that led to it. Suggestions are drafts, never silently applied.
- Respect current parser/resource limits and chart registry contracts. If data is too large or unsupported for a suggestion, explain why and offer a supported alternative where possible.
- Applying into an empty dashboard may proceed directly. Replacing a non-empty dashboard must use the existing replacement confirmation/backup behavior.
- Keep this additive: do not change layout schema, persistence format, export format, or existing template definitions unless implementation discovery shows a necessary compatibility issue. Stop and revise this plan if that occurs.

## Architecture fit

The existing `readUpload` flow parses in a worker and returns `{columns, rows}`; `parse.js` and `limits.js` bound accepted input. `main.js` owns upload handling, dashboard state, and chart creation. `src/tiles/registry.js` defines chart field requirements, while `src/templates.js` and the template gallery establish the existing starter-layout pattern. Reuse these contracts rather than creating a second import or chart-rendering path.

## Task List

### Phase 1: Define suggestions and data summary

#### Task 1: Specify deterministic profiling and suggestion rules

**Description:** Define how to classify fields and choose a small set of chart suggestions using column names, observed values, null counts, distinct counts, and row count. Use chart registry requirements to ensure every suggestion is mappable.

**Acceptance criteria:**
- [ ] Rules cover numeric, date-like, categorical, identifier-like, and unusable columns, including ambiguous and mixed values.
- [ ] Suggestions name their selected fields and give a short reason; unsupported combinations are omitted with a clear explanation.
- [ ] The maximum suggestion count and thresholds are bounded and documented; no data values are emitted into logs or remote services.

**Verification:** Add focused fixtures for representative CSV/JSON shapes, empty/null-heavy columns, ambiguous dates, high-cardinality categories, and unsupported row shapes; confirm deterministic output.

**Dependencies:** None.

**Files likely touched:**
- `src/data/` (new profiling/suggestion module)
- `src/tiles/registry.js` (read-only integration expected; edit only if registry metadata proves insufficient)
- `tests/` (focused unit fixtures)

**Estimated scope:** Medium.

#### Task 2: Build a reviewable upload summary panel

**Description:** After successful upload, present a compact profile: row/column counts, likely field types, missing-value counts, and any parser limits or caveats. Give the user actions to continue directly or review suggested starts.

**Acceptance criteria:**
- [ ] Summary is based on the successfully parsed local dataset and updates when a new file is uploaded.
- [ ] User can dismiss/skip it and continue with current upload behavior.
- [ ] Missing values and inferred field types are labeled as observations, not corrections; the source data is unchanged.

**Verification:** Browser walkthrough for CSV and JSON, keyboard navigation, narrow supported viewport, dismissal, and upload failure/cancel paths.

**Dependencies:** Task 1.

**Files likely touched:**
- `src/main.js`
- `index.html`
- `src/style.css`
- `tests/browser/`

**Estimated scope:** Medium.

### Checkpoint: Summary and suggestion rules

- [ ] Focused unit fixtures pass and suggestions remain deterministic.
- [ ] Upload, cancel, dismiss, and direct-to-composer flows continue to work.
- [ ] No dataset is changed by profiling.
- [ ] Review the rules and UI before implementing dashboard application behavior.

### Phase 2: Create and apply a suggested dashboard

#### Task 3: Generate a small set of chart/layout suggestions

**Description:** Combine valid field mappings into a few relevant chart options, such as a time trend, category comparison, distribution, or KPI, then compose a balanced starter layout sized for the existing grid. Reuse chart types, field normalization, and sizing contracts already in the app.

**Acceptance criteria:**
- [ ] Every proposed tile has a valid registry type and complete required field mapping.
- [ ] Suggestions avoid misleading defaults, including treating identifier columns as measures or silently truncating categories.
- [ ] Each option shows its chart type, fields, and rationale before application.
- [ ] If no trustworthy chart is available, the UI explains why and offers the existing manual/template routes.

**Verification:** Unit and browser cases cover numeric-only, time-plus-value, category-plus-value, multiple candidate fields, high-cardinality categories, and no-suggestion datasets.

**Dependencies:** Tasks 1–2.

**Files likely touched:**
- `src/data/` (suggestion generation)
- `src/main.js`
- `src/tiles/registry.js` (only if needed to expose existing metadata)
- `tests/`

**Estimated scope:** Medium.

#### Task 4: Apply suggestions safely to the composer

**Description:** On explicit selection, create mapped tiles bound to the uploaded dataset and set the dashboard default only when the existing data-binding model supports that intent. Preserve undo/recovery expectations and existing replacement confirmation for non-empty dashboards.

**Acceptance criteria:**
- [ ] User preview is not mutated until Apply is selected.
- [ ] Applying to a non-empty dashboard follows existing replace confirmation and backup guidance.
- [ ] Created tiles use explicit, valid mappings and survive save, reload, JSON export/import, and standalone HTML export.
- [ ] Cancelled application leaves the active layout and stored records unchanged.

**Verification:** Browser flow from upload through Apply, edit, save/reload, JSON round trip, and HTML export; include cancellation and invalid-mapping cases.

**Dependencies:** Task 3.

**Files likely touched:**
- `src/main.js`
- `src/data/layout.js` (only if current layout contract requires a compatible integration)
- `tests/browser/`
- `tests/` (round-trip coverage)

**Estimated scope:** Medium.

### Checkpoint: End-to-end guided start

- [ ] A user can upload, understand the data summary, inspect suggestions, and apply a dashboard without leaving the browser.
- [ ] Existing upload, template, SQL, persistence, import, and export flows remain intact.
- [ ] Review the complete flow at supported viewport sizes and with keyboard-only interaction.

### Phase 3: Polish and release readiness

#### Task 5: Refine empty, ambiguous, and constrained states

**Description:** Make the flow useful when profiling cannot confidently classify a column or when chart/resource limits prevent a suggestion. Keep the user oriented toward manual mapping, templates, or SQL.

**Acceptance criteria:**
- [ ] Ambiguous inference is explicitly marked and can be changed before application.
- [ ] Large/high-cardinality or unsupported inputs receive a specific explanation, not a blank suggestion area.
- [ ] Accessible names, focus order, focus return, and status announcements are verified.

**Verification:** Browser checks for empty results, ambiguous dates, all-null columns, high cardinality, keyboard usage, and screen-reader semantics in markup.

**Dependencies:** Task 4.

**Files likely touched:**
- `src/main.js`
- `src/style.css`
- `tests/browser/`

**Estimated scope:** Small to medium.

#### Task 6: Document the behavior and supported limits

**Description:** Update product and contributor documentation to describe local profiling, inference limits, supported upload scope, and the choice-driven nature of suggestions.

**Acceptance criteria:**
- [ ] README accurately explains the guided flow and keeps local processing/network claims precise.
- [ ] Known inference limitations and row/category limits are discoverable.
- [ ] Clean documented development flow builds and launches the upload path.

**Verification:** Review README against implementation and reproduce the documented build/test/browser commands.

**Dependencies:** Task 5.

**Files likely touched:**
- `README.md`
- `docs/` (feature notes if needed)

**Estimated scope:** Small.

### Checkpoint: Ready for review

- [ ] Focused tests, full existing suite, production build, and browser acceptance pass.
- [ ] Existing retained correctness, persistence, keyboard, and export guarantees remain satisfied.
- [ ] Changes are reviewed with the user before any publishing or deployment.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Heuristics mistake identifiers, dates, or codes for meaningful measures | Misleading charts reduce trust | Use conservative rules, expose chosen fields, require review, and provide easy manual correction |
| Profiling adds latency for large uploads | Upload feels slower | Reuse worker parsing and bounded/sample analysis; keep summary optional and show progress if needed |
| Suggestion flow overwrites work | Data/layout loss | Preserve existing replace confirmation, backup guidance, and transactional import/layout behavior |
| Chart-type contracts drift from suggestion logic | Invalid or misleading tiles | Derive required fields from the chart registry and validate before showing/applying suggestions |
| Additional UI makes upload feel heavier | More friction for experienced users | Keep skip/direct continuation prominent and remember no preference unless user explicitly opts in |
| Feature expands into cleaning/ETL or AI recommendations | Schedule and correctness risk | Limit this slice to profiling and chart/layout suggestions; defer transformations and external services |

## Deferred candidates

1. Reusable data preparation and mappings for recurring files.
2. Dashboard-wide filters and linked chart interaction.
3. Chart annotations, metric definitions, and source/refresh context.
4. Refresh from a replacement file with schema-difference preview.

Re-rank these after observing guided-start use; each needs a separate scope and acceptance criteria.

## Open question

This plan assumes the primary goal is helping a general user make a first dashboard from a local file. If the intended audience is specifically analysts, nonprofit teams, or one-off report authors, adjust the suggestion rules and examples before implementation.

## Approval boundary

The user approved implementation on October 1, 2026. The guided upload summary,
worker-side profiling, chart suggestions, explicit apply/keep choices, and
replacement confirmation are implemented in the working tree. On October 1,
2026, `npm test` passed (36 renderer cases and 14 focused tests),
`npm run build` passed, and `npm run test:browser` passed all 17 browser cases,
including the two new guided-start acceptance flows. No publishing or
deployment is included in this plan.
