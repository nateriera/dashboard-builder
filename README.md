# Dashboard Builder

**A free, local-first dashboard composer.** Drag-and-drop grid, 18 chart and content tile types, in-browser SQL, and export to a self-contained HTML file. No account, no subscription, and nothing leaves your device until you send it.

**[Open the live demo](https://nateriera.github.io/dashboard-builder/)**

![Dashboard Builder: drag a donut chart onto the Meridian County homeless-response dashboard and resize it, brush January–June 2026 on the monthly count to cross-filter the other charts, move a what-if parameter to change the projection, then share the dashboard as a standalone offline HTML file](docs/screenshots/demo.gif)

The demo is the bundled Meridian County homeless-response example, built on synthetic data for a fictitious county. A donut dragged in from the palette shows who is entering homelessness. Brushing January–June 2026 on the monthly count cross-filters the other charts: entries ran ahead of exits in every one of those months, and families were 37% of the people entering, against 23% across all three years. A number parameter, `extra_exits`, asks what the next twelve months look like with that many more exits to housing each month. **Share as HTML** then writes the whole dashboard to one file that opens offline with that control still live. The demo opens on this example in a fresh browser profile. To restore it later, choose **More actions → Import JSON / HTML** and select [`docs/examples/meridian-homeless-response.json`](docs/examples/meridian-homeless-response.json).

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Deploy demo](https://github.com/nateriera/dashboard-builder/actions/workflows/pages.yml/badge.svg)](https://github.com/nateriera/dashboard-builder/actions)

## Features

- Drag-and-drop, resizable 12-column grid with content-aware tile sizing
- 18 tile types: bar, column, line, scatter + trend, dot, donut, choropleth, small multiples, KPI, table, text/annotation, stacked bar, stacked column, histogram, box plot, area, heatmap, and treemap
- CSV/JSON upload processed locally — nothing leaves your device until you send it — plus built-in sample datasets
- Guided upload summary with column-type and missing-value observations plus explainable chart suggestions
- In-browser SQL via DuckDB-WASM: query your uploads, apply results straight to tiles
- Dashboard category, numeric, and date filters connect explicitly to chart fields, including relative date presets, and apply at dashboard, page, or selected-chart scope across named report pages
- Save named dashboard views that restore the active page, filters, parameters, and theme
- Move and resize tiles from the keyboard: **Move and resize** enters arrangement mode, arrow keys move, Shift + arrow keys resize, Enter finishes, and Escape restores every tile on the page to where it was
- Brush a time-series range or select category marks to create independent cross-filters from multiple charts; each category chart can filter rows, highlight matching marks, or ignore incoming cross-filters
- Configure chart mark clicks to filter charts, inspect source records, or navigate to a drill-through page
- Inspect the data behind any chart: a paginated table of its source columns, and the contributing source rows behind a selected category
- **Share as HTML** exports a standalone dashboard — one self-contained, offline HTML document with working filters and chart cross-filtering, every page in one scrollable file, labeled as an offline snapshot, with a Restore exported filters button and print rules. You add its title, author, data period and an optional cover note at share time, and on narrow screens the shared file stacks its tiles in reading order. Email it or host it anywhere; no server needed
- Switch a tile among chart types supported by its current data columns
- Typed parameters — number, text, boolean, date, number range, date range, single select and multi-select — feed SQL `{{name}}` placeholders and transform steps, or bind to a dashboard filter so one control drives it
- Optional per-tile reference lines, with labels, mark targets and thresholds
- Wrangle data locally: save and reuse recipes for grouping and calculated fields, and build ordered transform chains in the Transform tab — GroupBy, day/week/month Bucket, Between, Top, MovingAvg, Stats, Cumulative, Change, paired periods, Pivot, Histogram, and Ratio
- Sort category charts ascending, descending, or by source order; optionally show the top 1–100 categories
- 4 themes, 13 built-in templates plus a preloaded Meridian County starter dashboard, save/load multi-page dashboards as JSON
- **CoC edition**: a board packet and a funder report for Continuum of Care reporting, built on the HUD System Performance Measures (1a, 2, 3.1 HMIS-based, 4, 5 and 7; 6 not applicable per HUD) with plain-language definitions carried in the file and the gaps named there, over synthetic HMIS-shaped sample data for the fictional Meridian County
- Data-integrity guardrails: explicit binding modes and visible sampling notices

## Quick start

No install needed — open the **[live demo](https://nateriera.github.io/dashboard-builder/)** and start dragging. To run it locally:

```sh
npm ci
npm run dev
```

## Desktop app

The same composer also ships as an installed desktop app (Tauri) for
Windows and Linux. It opens and saves the same project JSON and HTML
shares as the web app — files move between the two freely — and uses
native open and save dialogs and native confirmations in place of the
browser's. The installed app runs from local files, and nothing leaves
your device until you send it, as in the browser.

**Download:** prebuilt installers are on the [latest release page](https://github.com/nateriera/dashboard-builder/releases/latest). Packages are built per platform: MSI and NSIS installers on Windows;
.deb, .rpm and AppImage on Linux. To build from source you need the Rust
toolchain and your platform's Tauri prerequisites, then:

```sh
npm ci
npm run desktop:build
```

## Template gallery

The composer opens on a Meridian County starter dashboard: 311 timeliness and
homelessness at a glance, on synthetic data for a fictitious county. Thirteen
original built-in templates — eleven general-purpose, from homeless system
performance and behavioral health quality to 311 operations, scorecards and
sales, plus the two-template CoC edition for Continuum of Care board and
funder reporting — are pictured in the
[template gallery](docs/template-gallery.md).

Choose **More actions → Templates** in the composer to try any of the thirteen.

## Beginner guides

- [Map a CSV to a chart and repair a missing upload](docs/csv-mapping-walkthrough.md)
- [Run a categorical SQL aggregation](docs/sql-aggregation-recipe.md)
- [Choose between JSON backup and HTML sharing](docs/json-backup-html-sharing.md)
- [Filter a dashboard and use parameters](docs/filters-and-parameters.md)

## Start from an upload

Choose **Manage data** and upload a CSV or JSON file to see its row and column counts,
full-file missing-value counts, and inferred column types. Type inference uses
up to 5,000 evenly spaced rows; it is a suggestion, not a change to the source
data. The composer may offer a small set of charts when existing column-name
mapping rules can map the fields conservatively. Review, change field choices,
or uncheck suggestions before building. You can also set the upload as dashboard data or keep the
current dashboard. Profiling and chart suggestions run locally in the browser.

## What a shared file contains

Exports are deliberately narrow. A JSON or HTML export carries only the
uploaded datasets the dashboard actually uses — bound to a tile, following
the dashboard default, or read by a saved query's SQL — and each carried
dataset is projected to the columns its tiles and queries reference. An
upload the dashboard never reads cannot leak into a shared file, and
neither can a column no chart uses. The in-browser SQL engine runs with
external access disabled and its configuration locked, so a query cannot
reach the network or the filesystem. One exception: a table tile bound
directly to an upload carries that upload's columns in full, because the
table displays them.

## Known issues

- The households multi-select listbox clips its fifth row in both layouts. Scroll within the listbox to reach the last option.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and PR guidelines.
New contributors can browse [good first issues](https://github.com/nateriera/dashboard-builder/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22).

## Reference

The development guide, architecture, layout schema, parameters,
persistence, SQL and portability contracts, exact-number rules,
budgets, and the stack and license table live in the
[reference](docs/reference.md).
