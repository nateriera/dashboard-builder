# Transform chains (Gate A)

Open a tile's Data control and choose Transform. Add Group & summarize or Bucket
dates steps, set their inputs and output names, then Preview transforms. A preview
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

The existing histogram chart also handles constant data: it draws one bin
centered on the shared value with width one and labels the range degenerate.

## Bench coverage

Gate A supports the sales, support, and satisfaction-trend bench dashboards
(benches 1, 2, and 7), plus bench 3's GroupBy alternative. The support bench's
“slowest teams” ranking uses `Top(desc)` on duration per the B6 correction.
Between paired-period comparisons that also require Change remain Gate B work.

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

Layout version 4 is unchanged: the query record gains additive optional fields.
Versions 1–4 still load; old SQL-only record shape remains unchanged. New HTML
exports add a `layout` backup to the existing materialized viewer payload. The
viewer continues to use materialized rows without SQL execution. Editable
backups retain the existing 500 KiB per-dataset inline budget and list omissions;
excluded saved views remain excluded from both parts of the HTML file.

Gate A contains GroupBy, Bucket, Between, Top, MovingAvg, Stats, and the
all-equal histogram chart fix. Gate B operations—including Cumulative, Change,
true Pivot, Histogram transform, and ratio helpers—remain outside this contract.
