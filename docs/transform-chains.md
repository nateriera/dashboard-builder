# Transform chains

Open a tile's Data control and choose Transform. Add steps from the operation
list — Group & summarize, Bucket dates, Between, Top, Moving average, Stats,
Cumulative, Change, Paired periods, Pivot, Histogram, and Ratio (a convenience
extension) — set their inputs and output names, then Preview transforms. A preview
shows the full input/output count for each step and every exclusion, plus up to
five final sample rows. Map the required chart fields before Apply. Add, remove,
reorder, form edits, parameter changes and data revisions invalidate the preview;
an in-flight result for an older configuration is discarded.

The existing Group & summarize tab remains the one-shot grouping tool. Its
preview can become a Transform source. Calculated fields retain their existing
separate tab and recipe format.

## Chain contract

`src/data/wranglingTransforms.js` validates and compiles chain version 1. A chain
has `version`, `source`, ordered `steps`, and `outputMapping` fields. The source
contains exactly one `table` or raw `sql`, explicit data `dependencies` (or null
for unknown dependencies), a `schema` of ordered `columns` and `types`, and
`order`. Order is null, `{kind: 'sourceOrdinal'}` for a registered source table,
or `{kind: 'columns', fields: [...]}`. Explicit order fields must uniquely order
the input; otherwise GroupBy is disabled with a tie-break explanation. A user
column named `rowid` prevents use of the implicit table ordinal.

Each step has a unique `id`, `op`, and `params`:

- `groupBy`: `groups` and `aggregations`.
- `bucket`: `dateField`, `grain`, `partitions`, `periodName`, and `aggregations`.
- `between`: `field`, explicit `mode` (`numeric` or `date`), and inclusive
  `lower`/`upper` bounds. A bound may be a literal or `{param: 'name'}`.
- `top`: numeric `field`, integer `n` (literal or parameter reference), and
  `direction` (`desc` or `asc`; defaults to `desc`).
- `movingAvg`: numeric `field`, trailing `window` length (literal or parameter
  reference), and optional `partitions`.
- `stats`: numeric `field`; the step returns `count`, `min`, `max`, `mean`,
  `median`, and `stddev` columns in one row.
- `cumulative`: numeric `field` and optional `partitions`; the field becomes its
  running total.
- `change`: numeric `currentField` and `previousField`, and an `outputName`
  (`change_pct` by default) for the added percentage-change column.
- `periodPair`: `dateField`, optional `categoryField`, `measureField`,
  `aggregate` (SUM, COUNT, or AVG), `currentWindow`, optional `previousWindow`,
  and `outputCurrent`/`outputPrevious` names (`current`/`previous` by default).
  A window is `{kind: 'relative', days}` (literal or parameter reference) or
  `{kind: 'range', start, end}`. It works on one source and cannot name a second.
- `pivot`: one or more `rowFields`, a `columnField`, an optional `measureField`,
  and `aggregate` (SUM, AVG, COUNT, MIN, MAX, or COUNT DISTINCT; anything but
  COUNT needs a measure). The three roles must use distinct fields.
- `histogram`: numeric `field`, integer `bins` from 1 to 500 (default 20), and
  optional `min`/`max` bounds (numbers or numeric parameter references).
- `ratio`: `numerator` and `denominator`, each either `{kind: 'field', field}` or
  `{kind: 'aggregate', operation, column}` computed over optional `partitions`;
  `percent` (boolean) and `outputName` (`ratio` by default).

Each aggregation has `column` (nullable for COUNT), `operation`, and output
`name`. Operations are SUM, COUNT, AVG, MIN, MAX, and the existing COUNT DISTINCT
extension. A Bucket grain is day, week, month, or `{param: 'existingName'}` for
an existing text parameter whose current value is one of those grains. The UI
offers validated parameter names. Raw source `{{placeholders}}` are preserved.

Compilation produces a CTE pipeline, output schema, disabled-step reasons, and
SQL diagnostics. A step compiles against the preceding schema. Missing inputs
disable that step and all dependent steps. Compiler columns are collision-safe
and removed from the chart-visible result. The engine checks the current source
schema and requires another preview when a saved schema changes.

## Values, ordering and provenance

GroupBy defaults to SUM when a value column is chosen, COUNT otherwise. COUNT
counts rows. Numeric aggregates accept numeric SQL types, excluding and counting
null, nonfinite and invalid values; numeric-looking VARCHAR text is not coerced.
SUM over no valid values is zero. AVG, MIN and MAX are null. COUNT DISTINCT
excludes and counts missing values. Null group keys display `(blank)`; empty
strings stay distinct. Groups follow their minimum incoming ordinal, so grouped
GroupBy needs a deterministic incoming order. A global aggregate needs no order.

Bucket uses stored date strings and zone-naive timestamps without timezone
conversion. Unparseable/missing dates are dropped and counted once, separately
from aggregate exclusions among valid-date rows. All-invalid dates yield no
rows. Weeks start Monday. Day/week keys are YYYY-MM-DD; month keys are YYYY-MM.
Periods ascend within each partition. SUM/COUNT fill gaps only between that
partition's valid minimum and maximum periods. AVG/MIN/MAX-only series produce
no gap rows; with mixed measures, gap rows have null for those measures.

Between does not coerce numeric text. Numeric bounds compare numeric values;
date bounds parse with DuckDB `TRY_CAST` to timestamps. Missing/invalid field
values are excluded and counted. Inverted or type-incompatible bounds produce
an empty step with a visible warning.

Top excludes and counts missing, nonnumeric, NaN, and infinite values. It sorts
by the selected numeric value and then the incoming ordinal, so ties retain
their input order. A deterministic incoming order is required; a parameter N
must resolve to an integer of at least one. There is no chart category limit on
Top N.

MovingAvg replaces the selected field while preserving every input row and its
order. Its trailing frame contains only rows already present (plus any explicit
Bucket gap rows upstream); invalid samples are ignored and counted, the average
uses only valid samples in the frame, and an all-invalid frame yields null.
Stats excludes and counts invalid numeric values; an even-sized median averages
its middle pair. With no valid values, count is zero and all other statistics
are null.

Cumulative replaces the field with a running SUM in incoming order within each
partition. Invalid values add nothing to the total and are counted; integer
columns stay integers. Change adds `(current − previous) / |previous| × 100`, or
null when either value is invalid or the previous value is zero, and counts the
null causes. Paired periods aggregate the measure over a current window and a
previous window (by category when one is set). A relative window of N days ends
on the app's local date at execution; with no previous window, the previous
period is the equal-length span immediately before the current one. An invalid
or inverted date range produces an empty step with a visible warning.

Pivot turns each distinct column-field value into an output column, one row per
row-key combination; at most 24 distinct column categories are allowed. The
Histogram transform returns `key`, `value`, `start`, and `end` per bin;
non-finite bounds or a minimum above the maximum produce an empty step with a
warning. Ratio adds an output column dividing the numerator by the denominator,
optionally as a percentage. Cumulative, Top, MovingAvg, grouped GroupBy,
categorized paired periods, and Pivot all need a deterministic incoming order.

The existing histogram chart also handles constant data: it draws one bin
centered on the shared value with width one and labels the range degenerate.

## Bench coverage

Gate A supports the sales, support, and satisfaction-trend bench dashboards
(benches 1, 2, and 7), plus bench 3's GroupBy alternative. The support bench's
“slowest teams” ranking uses `Top(desc)` on duration per the B6 correction.
Paired-period comparisons use Paired periods followed by Change.

The existing 10,000-row query budget applies. Bucket checks generated grid size
before expanding gaps. Chains allow at most 30 steps and 20 groups/aggregations
per step. Integer SUM stays exact within its integer output range; overflow is
a visible query error. Existing Decimal/exact-number display rules still apply.

## Persistence and portability

The chain is the editable source of truth. Saved `sql` must equal its unresolved
compiled artifact. Source data dependencies stay in `dependencies`; raw source
and step parameter references are derived into `parameterDependencies`. Changing
a parameter's value changes execution without rewriting the saved references.
SQL review displays compiled chain SQL read-only; use Transform to edit steps.
SQL-only queries acquire no chain and retain their prior editing behavior.

Local persistence, reload, serialization, inline JSON/HTML backups, import,
pruning, snapshots and rollback all carry chain metadata. Invalid chains or
SQL/chain disagreement reject the entire import before replacement mutations.
Imported queries remain untrusted until Run and Apply. HTML imports extract only
the embedded JSON backup; markup, scripts and remote resources are never loaded.

Chain metadata is an additive optional field on the query record in the
current layout version (5); versions 1–5 still load, and the old SQL-only record
shape remains unchanged. New HTML
exports add a `layout` backup to the existing materialized viewer payload. The
viewer continues to use materialized rows without SQL execution. Editable
backups retain the existing 500 KiB per-dataset inline budget and list omissions;
excluded saved views remain excluded from both parts of the HTML file.
