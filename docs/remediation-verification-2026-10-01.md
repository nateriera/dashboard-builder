# Remediation implementation and verification

Date: October 1, 2026. Project baseline: `b5dfa245071ddb59e681fbfb1a8cdad345bd3390`.

The R1–R9 implementation is present in the local working tree. The correctness,
durability, portability, resource and core keyboard gates below pass within the
documented desktop Chrome scope. No publishing or deployment was performed.
The original assessment document is preserved unchanged.

## Reproduction and retained evidence

Use Node v24.18.0 and installed desktop Google Chrome. Run from the project root:

```sh
npm ci
npm test
npm run build
npm run test:browser
```

`npm run dev` automatically generates the HTML viewer template. Browser tests
start their own localhost server on port 4173 and use fresh isolated contexts.
The locked dependencies now include Playwright and fake-indexeddb for acceptance
and transactional storage tests. Chrome tested: **154.0.8037.58**, Windows.

| Check | Result | Retained evidence |
| --- | --- | --- |
| Baseline render sweep | 36/36 passed before changes | This report; baseline stdout inspected during implementation |
| Final registry render sweep | 36/36 passed, including choropleth through registry | [unit-results.txt](verification/unit-results.txt) |
| Focused integrity/recovery suite | 12/12 passed | [unit-results.txt](verification/unit-results.txt), [test source](../tests/remediation.test.mjs) |
| Real Chrome acceptance | 10/10 passed; zero skipped or flaky | [browser-results.json](verification/browser-results.json), [test source](../tests/browser/remediation.spec.js) |
| Production viewer + composer build | Passed | [build-results.txt](verification/build-results.txt) |
| Offline exported HTML print | One A4 page generated from query-backed export with networking disabled | [offline-export-print.pdf](verification/offline-export-print.pdf) |
| Supported smaller desktop viewport | Header actions remain accessible at 1024×768 | [composer screenshot](verification/composer-1024.png) |

The initial default Vite config loader hit a Windows sandbox path restriction.
Using the runner loader resolved production compilation. The dev/browser child
processes required running outside that sandbox. These were environment issues;
the final commands passed. Vite still warns about its composer chunk exceeding
500 kB; DuckDB's package omits its worker source map, causing a nonfatal dev
warning. Neither warning is hidden by the implementation.

## Acceptance by risk

| Risk | Implemented behavior | Verification |
| --- | --- | --- |
| R1 | Donut groups duplicate labels and largest categories plus Other; rejects signed/zero totals. Neutral editable units, shared zero-inclusive columns, visible cropped-domain choice. | Eight-category total **48,240**, reverse order, duplicate labels, negative/zero data, neutral/upload units and explicit USD. Shared domains recorded as `[0,20]` for both panels. HTML carries USD and the same rows. |
| R2 | Query dependency metadata conservatively includes registered uploads; unknown legacy dependency sets use all registered uploads. Export lists missing/oversized inputs and query errors before download. Broken references remain blocked with repair controls. | Query over a two-row upload survives JSON export/import into a separate empty browser context and reproduces values **12/30**. Missing upload/query bindings survive reload/export without sample SVG. Oversized dependency reason includes name, id and byte limit. HTML carries materialized rows and renders with networking disabled. |
| R3 | V2 explicitly distinguishes dashboard followers from per-tile bindings. V1 migration preserves every nonnull reference; input is cloned. | Sample, upload, query and follower references survive validation and JSON round trips. An explicit categorical sample survives browser reload with a different uploaded dashboard default. |
| R4 | Immutable SQL and request/revision tokens gate Apply. Editing, mapping changes, run failure, discard and dataset changes cannot publish stale previews. Synchronization/execution share one queue; caches compare revisions immediately. | Deferred A resolves after edit to B: Apply stays disabled. B succeeds; mapping edits cannot bypass dirty SQL. A later dataset revision disables Apply immediately. Failed SQL cannot reuse prior success. Controlled revision changes reject in-flight results. Real WASM cache invalidates before synchronization, overlapping syncs register the latest upload. |
| R5 | Legacy sources remain until all writes pass read-back; persisted status is per record. Migration failures expose retained-source status and retry. | Unavailable IndexedDB, quota, partial write and read-back faults retain both legacy records across simulated reload. Corrupt source is retained. Chrome with IndexedDB disabled reloads the source and labels it session only; retry control is visible. Successful migration removes the legacy key only after full verification. |
| R6 | Streaming numeric domains; file/column/query/category/facet/mark budgets; dense line/scatter sampling is labeled and underlying rows retained. Upload workers show progress and can be terminated. | 250,000-row line/scatter fixtures render without RangeError; numeric extent is `[0,249999]`. File byte, column, facet, parser row and SQL returned-row limits produce actionable errors. Worker CSV upload and cancellation run in Chrome. |
| R7 | Side-effect-free normalized envelope validation; own registry membership, schema, IDs, geometry, bindings, options, cells and mappings. Conflicting records reject. Detached construction, IndexedDB transactions and retained recovery journal protect replacement. | Malformed/inherited types, duplicate IDs, invalid geometry, malformed rows/mappings and unsupported versions reject. Conflicting dataset contents leave the existing chart intact. Injected construction, partial IndexedDB add and layout quota failures preserve the old dashboard across reload; new dataset records are rolled back. |
| R8 | Unsafe SQL integers become exact decimal strings. Text/KPI/storage/export keep exact values; plotting refuses unsafe integer conversion. Exact decimals require text casts; timestamps support milliseconds and explicit UTC serialization. | Safe boundary, **9007199254740992**, **9007199254740993**, and negative unsafe integer cases survive SQL helper, JSON, IndexedDB and KPI rendering. Real WASM returns **9007199254740993** exactly. Unsafe numeric plotting is rejected. Millisecond offsets agree at UTC; finer fractional values and uncast Decimal arrays are refused. |
| R9 | Native chart palette buttons; focus entry/trap/return; visible focus; chart text tables; keyboard save/import/export/remove; print rules and accurate local-processing/asset-download docs. | Chrome keyboard flows add, configure uploaded data, remove, save, import, export and close dialogs with focus return. Fresh dev lifecycle generates export template. Offline HTML renders and prints to one page. README specifies supported editor/print/browser/offline contracts. |

## Schema and policy decisions

Layouts are now **version 2**. Autosave keeps its original storage key for
compatibility. V1 did not encode enough information to determine whether an
explicit sample was intended as a follower. The migration rule preserves that
explicit reference; undefined/null becomes a dashboard follower. This prevents
reinterpreting a saved choice when the dashboard default differs. Validation
never mutates the caller's parsed object. Unsupported schema versions fail.

V2 keeps `dataset` for compatibility and adds `binding`. The two must agree:
`{mode:"dashboard"}` corresponds to null; `{mode:"explicit",ref}` corresponds
to that sample/upload/query reference. Chart units and baseline choices live in
`tileOptions` and pass through the same template/layout/export contracts.

SQL dependencies are conservative rather than guessed from arbitrary SQL.
Including all registered inputs can increase export size, but avoids omitting
eligible query inputs. Per-dataset inline limits and missing dependencies are
named before export. A reference without its data remains an unavailable-data
state. Users explicitly rebind via Data or the repair control.

Imports reject conflicting record IDs instead of remapping table names embedded
in SQL. Imported datasets commit atomically and only new import records are
removed during rollback. The recovery journal contains the prior layout and
query snapshot. The separate localStorage/IndexedDB stores are not a shared
database transaction; the prior durable layout and old records remain recoverable
through that journal and staged-write design.

## Measured resource scope

The 250,000-row browser fixtures render **2,000** evenly spaced points, with a
visible notice. The full rows remain available to persistence, JSON, HTML and
the paginated table. In the retained final run, scatter rendering took **30.3 ms**
and line rendering took **24.2 ms** on this desktop Chrome environment. The
fixture gate is **under 1,000 ms per render** on the verification machine.
Those times exclude file parsing and SQL table registration; they do not prove
250,000 rendered marks, mobile performance or universal device capacity.

Engineering budgets: uploads 16 MiB/250,000 rows/100 columns; SQL results
10,000 rows/100 columns; plotted dense marks 2,000; category/KPI rows 100;
facets 12; layouts 32 MiB/100 tiles. Unsupported categorical/facet inputs display
limits rather than silently discard rows. Donut grouping retains all numeric
contributions. SQL aggregation is the supported path to authoritative large
category/trend summaries.

Upload cancellation terminates its worker. Discarding SQL invalidates preview
eligibility while the DuckDB worker finishes; it does not interrupt engine
computation. The UI remains available, and another Run waits for execution to
settle. No unbounded SQL engine-memory guarantee is claimed.

## Release and remaining scope

The local implementation and automated gates are ready for review. The diff,
fixtures and evidence form the review packet; no GitHub PR, push, publishing or
deployment was performed. Public release still requires owner authorization.

Acceptance is limited to the documented desktop Chrome contract. Screen-reader
testing, Firefox/Safari/Edge engine acceptance, mobile editing, physical printer
drivers and composer startup/first SQL use without network were not verified.
The exported HTML viewer's offline rendering and Chrome PDF printing were
verified. Broader compatibility or performance claims require additional retained
device/browser evidence.
