# Failure risks and remediation plan

Date: 2026-10-01. Source baseline: local `main`, commit `b5dfa245071ddb59e681fbfb1a8cdad345bd3390`. The checkout was clean when inspected. This is a plan for implementation approval, not an implemented remediation release.

## Assessment

The strongest potential criticism is that the software can produce convincing charts that omit data, mislabel metrics, or substitute sample data when real data is unavailable. Those outcomes undermine a dashboard tool's central promise before its feature count or visual polish matters. The next most serious risks concern whether a dashboard survives saving, sharing, storage failure, and larger inputs.

These priorities are based on executable probes and source control-flow inspection. They are not measured customer failure rates. Conditional failures are described with their triggers rather than presented as already observed production incidents.

## Evidence and limits

- Source inspected: composer, chart registry and chart kit, upload normalization and parsing, dataset/query persistence, SQL execution and caching, templates, export viewer, README, build configuration, and render tests.
- Sample-data probe: `categorical.json` has 8 rows with a total of **48,240**. The first 6 rows total **44,520**. The donut registry passes only those first 6 rows into the renderer.
- Capacity probe in Node v24.18.0: `Math.min(...Array(250000).fill(1))` throws `RangeError: Maximum call stack size exceeded`. Actual chart code uses this pattern, while uploads allow 250,000 rows. Browser thresholds may differ; this is proof of an unsafe implementation pattern, not a measured browser capacity limit.
- Precision probe: `sanitizeValue(9007199254740993n, 'Int64')` returns `9007199254740992`.
- Prior numeric fix verified by a direct module probe: normalizing `1e309` produces `null` and increments the invalid-value count. Template theme handling and pre-restoration layout validation are present in the current source.
- `npm test` was attempted and exited before running cases because `jsdom` is not installed in this checkout. This is an environment prerequisite failure, not evidence that the chart suite fails. No browser, SQL-WASM runtime, production build, deployed site, screen-reader, or cross-browser acceptance was verified during this assessment.
- The existing render suite primarily checks for SVG/KPI markup. It does not verify totals, units, data round trips, storage failures, SQL races, or keyboard workflows; its choropleth case calls the chart kit directly rather than the registry renderer.

## Ranked risks

### R1 — Charts can communicate false totals or units

**Priority:** first release gate. **Evidence:** confirmed source behavior and sample-data calculation.

`src/tiles/registry.js:207` truncates donut input with `slice(0, 6)`. `src/charts/charts.js:387` computes the displayed total from that truncated input. Even the bundled sample therefore displays a total of 44,520 rather than 48,240. Rows after the sixth are omitted without an explicit partial-data label. Negative values also need a deliberate policy because a parts-of-a-whole chart cannot meaningfully represent signed values using ordinary pie slices.

The same registry hardcodes sample units for arbitrary uploads: `Requests` at lines 89, 109, 133, and 185, and `Rent burden (%)` / `Rate per 10k` at lines 163–164. A revenue or temperature upload can acquire those unrelated axis labels. Small multiples default to a nonzero shared minimum (`registry.js:266–280`, `charts.js:364–371`) even though the panels are column charts, which can exaggerate magnitude differences.

**Contributing factors:** demo assumptions are mixed into reusable chart contracts; limiting categories is implemented as data deletion; units and domain policies are not stored as user choices.

**Remediation:** preserve all donut contributions by grouping categories before selecting the largest categories and an explicitly labeled Other bucket, or show a clear unsupported-data state. Define negative/zero-total behavior. Add axis-label/unit metadata with neutral defaults for uploaded/query data and preserve it through layout, templates, and HTML export. Make zero the default baseline for magnitude bars; make any cropped-domain choice explicit.

**Acceptance:** the bundled eight-category donut displays 48,240; reordered rows preserve the total; duplicate labels and signed/zero data have defined behavior. A revenue upload has no rent-burden or request units unless explicitly selected. Small-multiple bars use the same zero-inclusive domain by default. Composer and exported HTML agree on totals, units, and domain choices.

### R2 — Portable JSON can lose query inputs and show sample data instead

**Priority:** first release gate. **Evidence:** confirmed export and fallback paths; clean-browser reproduction still required.

`src/main.js:776–793` gathers uploads only from direct tile references and the dashboard default. A query tile references `query:<id>`, so its uploaded SQL-table inputs can be omitted even when they fit the inline budget. Only the query text/mapping is exported. On import into a fresh browser, a missing SQL table reaches `main.js:448–455`, which replaces the query binding with a sample binding and schedules autosave. Missing upload/query references also fall back during tile creation (`main.js:299–306`). The original title can remain above plausible sample values.

**Contributing factors:** queries do not declare dataset dependencies; portability is determined from direct references; missing data is treated as permission to switch data sources.

**Remediation:** record query dependencies using structured table selection or supported SQL dependency analysis. Conservatively include all eligible registered uploads if dependency extraction is uncertain. List every omitted dependency and size reason before export. Preserve broken references and show a blocking data-unavailable state with an explicit repair/rebind action. Sample fallback must require a deliberate user choice.

**Acceptance:** a query over a small uploaded table exports/imports into empty storage and reproduces its result. Oversized or missing dependencies are named. Missing data never silently changes a real-data chart into a sample chart or destroys its saved query binding. HTML export continues to carry materialized query results without requiring SQL execution in the viewer.

### R3 — Reloading changes explicit data bindings

**Priority:** first release gate. **Evidence:** confirmed source migration condition.

`src/main.js:537` changes every explicit sample reference equal to a tile type's default into `null`, which means follow the dashboard default. The condition applies to current layouts as well as old layouts. For example, explicitly choose categorical sample data for a bar tile while the dashboard default is an upload; saving and reloading converts the tile into an upload follower.

**Contributing factors:** an old-format migration infers intent from a value that is also valid in the current format; current and historical schemas share the same version.

**Remediation:** define a new schema version with explicit binding modes. Restrict legacy migration to an identified old version, preserve current explicit references, and avoid mutating the parsed input object. Legacy intent that cannot be recovered must be handled with a documented migration rule.

**Acceptance:** explicit sample, upload, query, and dashboard-following bindings each survive reload and JSON round trips unchanged. A differing dashboard default does not override explicit sample choices. Migration fixtures demonstrate that legacy conversion happens once.

### R4 — Asynchronous SQL can attach the wrong query or keep stale results

**Priority:** first release gate. **Evidence:** confirmed race-capable control flow; deferred-query runtime reproduction required.

`src/ui/dataPopover.js:567–568` runs the textarea's value, awaits the result, then assigns the textarea's current value to `qstate.sql`. Editing while the query is running can associate results from SQL A with SQL B and re-enable Apply through `updateQueryPreview`. Mapping changes can also re-enable Apply after SQL was marked dirty because the preview only checks mappings.

Cache freshness has a separate contributing risk: `main.js:428` checks the cache before ensuring current dataset tables. `getCachedRows` checks the table epoch, but that epoch changes only after synchronization, not immediately when datasets change (`duckdb.js:80,132–151`). Different dataset versions can start overlapping sync operations (`duckdb.js:90`). These paths warrant a controlled runtime test before claiming automatic freshness.

**Remediation:** capture immutable SQL and a request token before execution. Enable Apply only when input text, request token, mapping, and dataset revision match the successful result. Invalidate preview eligibility on edit and on the start/failure of a new run. Serialize table synchronization, key caches to dataset revisions as well as query identity, and discard results from superseded revisions.

**Acceptance:** delay SQL A, edit to B, resolve A: Apply stays disabled until B runs successfully. Changing mappings cannot bypass that rule. Changing datasets while sync/query work is in flight cannot publish or export results from an older revision. Failed runs cannot reuse a previous successful preview as current.

### R5 — Storage migration can erase the durable copy before replacement succeeds

**Priority:** first release gate for installations with legacy data. **Evidence:** confirmed failure path.

`src/data/store.js:104–105` removes legacy localStorage keys before opening/writing IndexedDB succeeds. Failed writes are ignored at lines 141–146, while ingested records are marked `persisted: true` at line 133. If IndexedDB is unavailable or a migration write fails, data can survive only in memory for that session and disappear on reload after its old durable copy was deleted.

**Contributing factors:** migration cleanup precedes durable acknowledgement; loading a record is conflated with successful persistence.

**Remediation:** retain the legacy source until every destination write has succeeded and been read back. Track per-record persistence honestly, expose migration failure, and allow retry or backup export. Avoid deleting corrupt migration input without a recoverable backup path. Apply the same staged-write principle to future schema migrations.

**Acceptance:** fault injection for unavailable IndexedDB, quota failure, partial write failure, and reload proves legacy records remain recoverable. The UI identifies session-only data correctly. Successful migration verifies the complete destination before removing old storage.

### R6 — The accepted data limit exceeds safe chart operations

**Priority:** next release gate, before advertising the existing maximum. **Evidence:** reproduced unsafe array operation and confirmed code paths.

Uploads accept 250,000 rows (`src/data/parse.js:9`). Trend calculation and numeric-domain calculation spread arrays into `Math.min`/`Math.max` (`charts.js:117–118,297–298,364–365`), which can exceed the runtime's argument limit. Render work also creates marks/panels from large data, while file parsing has a row cap but no byte/column/facet budget. SQL materializes complete results without a separate result cap (`duckdb.js:106–109`). A row cap alone cannot bound memory use or chart complexity.

**Remediation:** replace argument spreading with streaming reductions and handle empty/all-null domains. Set separate supported budgets for file bytes, columns, query results, categories, facets, and rendered marks. Aggregate or deliberately sample dense plots, label that transformation, and preserve authoritative underlying totals. Provide progress/cancellation for expensive work; avoid making the main UI unresponsive.

**Acceptance:** supported maximum-size fixtures render without RangeError or uncaught exceptions in the browsers selected for support. Oversized bytes/columns/facets/query results yield actionable limits. Define and record performance thresholds after measuring representative target devices; do not invent a universal row capacity from the parser limit.

### R7 — Import validation is still too shallow for a safe replacement

**Priority:** next release gate. **Evidence:** confirmed validator and restore behavior.

The previous fix correctly calls `validateLayout` before restoring records. The validator (`src/main.js:512–517`) still checks only the tiles array and truthy registry lookup. It does not check schema/version, own registry membership, unique IDs, finite bounded geometry, dataset/query shapes, mappings, or size budgets. `loadLayout` clears the current grid before constructing every imported tile. `restoreDatasets` skips existing IDs (`store.js:245`), so conflicting contents can silently resolve to an existing browser record instead of the file's intended data.

**Remediation:** validate the entire envelope into a normalized candidate without side effects, using explicit allowed values and own-property checks. Detect ID/content collisions and remap references or reject them clearly. Stage the replacement, persist only after validation/construction succeeds, and retain the prior layout for rollback. Reuse the schema across autosave, imports, and templates.

**Acceptance:** malformed types, inherited registry names, duplicate IDs, invalid geometry, malformed rows/mappings, unsupported versions, and ID collisions fail before changing the active dashboard or durable records. An injected construction/persistence failure leaves the previous dashboard recoverable.

### R8 — SQL materialization silently changes large integer values

**Priority:** next release gate for trustworthy numeric data. **Evidence:** reproduced precision loss.

`src/data/sql.js:133` converts every BigInt to Number, including values outside the exact integer range. The observed conversion changed 9007199254740993 into 9007199254740992. Numeric normalization also uses Number conversion, so preserving a large integer as a string only at the SQL boundary is insufficient if it is then mapped to a numeric chart field.

**Remediation:** keep exact integers as decimal strings outside the safe Number range. Define supported representations for identifiers, currency/decimals, and timestamps. At a numeric chart boundary, require an explicit approximation policy or a clear precision error. Preserve exact KPI display and JSON export values where no numeric plotting conversion is needed.

**Acceptance:** values at and beyond the safe integer boundary remain exact through materialization, persistence, JSON, and KPI display; plotting either documents an explicit approximation or refuses it. Timestamp tests cover supported timezones and fractional precision before expanding date-support claims.

### R9 — Core creation is inaccessible by keyboard, and documentation overstates guarantees

**Priority:** next release gate for a usable public tool. **Evidence:** source and README inconsistencies; browser/accessibility acceptance pending.

The palette creates clickable `div` elements without keyboard focus or activation (`src/main.js:622–635`), making the primary add-chart action unavailable through that control to keyboard users. Modal focus management, chart alternatives, responsive editor behavior, and print output need browser-level verification rather than inference from rendered SVG.

The README says runtime network calls occur only during installation (`README.md:31–32`), while HTML export fetches a template (`main.js:808`) and SQL lazy-loads assets from the static host. These calls are compatible with local data processing, but the literal no-runtime-network statement is inaccurate. The generated template is now ignored (`.gitignore:3`); the documented clean-checkout dev flow does not explicitly build it first. JSON portability should be qualified until R2 is fixed.

**Remediation:** use native keyboard-operable controls, manage modal focus entry/trap/return, and add meaningful chart text/data alternatives. Define supported viewport, print, browser, and offline modes. Document local processing separately from asset downloads, and make export-template generation part of the documented dev lifecycle. State portability and limits according to verified behavior.

**Acceptance:** a keyboard-only user can add, configure, remove, save, import, and export charts with visible focus and appropriate focus return. A clean install followed by documented commands can export HTML. A downloaded HTML file renders with networking disabled. Composer startup/SQL availability offline are described only to the extent directly verified.

## Implementation sequence

1. **Establish reproducible evidence.** Install locked dependencies in an approved working environment; run the existing sweep and production build. Add meaningful regression fixtures for R1–R8 and a browser harness for SQL/deferred work and storage failures. Record baseline outputs; passing SVG-presence tests alone cannot approve these fixes.
2. **Repair data integrity (R1, R3, R8).** Introduce versioned chart/binding metadata, exact numeric policies, correct donut totals, and meaningful axis units/domains. This establishes contracts needed by exports and persistence. Gate: analytical fixtures and all binding round trips pass.
3. **Repair SQL and portable data (R2, R4).** Introduce dependency/revision metadata, deterministic asynchronous execution, and missing-data states. Update JSON export/import together; keep HTML export based on verified materialized rows. Gate: clean-storage query portability and deferred-operation tests pass.
4. **Repair durability and replacement (R5, R7).** Implement staged migration/import, collision handling, rollback, and honest persistence states. Gate: injected failures and reload tests preserve user data.
5. **Bound resource use and complete core usability (R6, R9).** Remove unsafe reductions, define measured budgets, make creation keyboard-operable, verify browser/print/offline behavior, and reconcile documentation. Gate: capacity fixtures, keyboard acceptance, and clean-checkout export work.
6. **Release review.** Re-run the chart sweep, focused regression suite, production build, and browser acceptance after the final combined changes. Review a PR with evidence for every gate. Publishing or deployment requires a separate authorized release action.

## Definition of completion for the remediation

The remediation is complete only when all acceptance criteria above have retained evidence, the versioned schema has documented migration behavior, and a clean-checkout reviewer can reproduce the checks. The plan does not claim that those implementation gates have passed. Existing visual attractiveness, a successful build, or a render sweep cannot substitute for correctness, data recovery, and portable-data evidence.

No implementation or release changes are included in this assessment. The immediate implementation priority is R1–R5 because those failures can change the meaning of a dashboard or lose its data.
