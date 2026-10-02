# Chart placement, scaling and resize build plan

Status: approved by owner and implemented. Verification: [results](layout-resize-verification-2026-10-01.md).
Source: local main, commit `074cb85`. Browser: Chrome 154.0.8037.58, isolated storage.

## Diagnosis

| Current behavior | Proposed change | Why |
| --- | --- | --- |
| Starter layouts omit placement; validation assigns every chart x=0 with sequential y. Half-width charts stack down the left. | Give fresh starter layouts explicit, balanced positions: KPI across the top, bar/line paired beneath, donut/scatter paired beneath them. | Restores use of the full dashboard width and a readable hierarchy. |
| Tile header repeats the chart title, axis settings wrap into multiple toolbar rows, and titles inside cards use 28px regardless of tile width. | Keep one chart heading, compact editor controls, and place unit/baseline controls in a settings disclosure. Scale chart headings to the tile. | Controls and duplicated headings currently consume substantial plotting space. Preserve accessible settings and current themes. |
| `.tile-chart` and `.db-card` both scroll; `.db-card` is forced to 100% height. The fit calculation reads the outer scroll height rather than the complete inner content. | Use one scrolling fallback, measure intrinsic content for automatic sizing, and separate plot space from headings/footer/data disclosure. | Removes clipping and avoids a size calculation based on the existing viewport. |
| Auto-fit assumes 84px rows, but GridStack actually uses 72px rows with margins inside the cell. | Derive fit geometry from GridStack's actual row height and margins. | Prevents fitting content into too few rows. |
| Most charts receive width but no available height. Fixed margins consume 210px in a bar chart and at least 210px in a dot plot. Small multiples require three 220px panels even in narrow tiles. | Use the available plot width and height, bounded responsive margins, and a responsive facet-column count. Fit donut/map within their aspect ratios. | Plot size should respond to the tile in both dimensions without cutting labels or overflowing narrow tiles. |
| During pointer resize, the SVG width stays unchanged; only `resizestop` rerenders it. | Schedule bounded chart redraws during resizing and a final redraw after cleanup. Never replace resize handles. | Makes the chart visibly follow the tile instead of freezing and snapping after release. |
| Geometry snaps in roughly 98px horizontal and 72px vertical increments at 1440px. GridStack uses 300ms transitions after release. | Use finer 24px vertical rows, retain twelve horizontal columns, and disable resize/layout transitions that lag behind direct manipulation. | Makes vertical adjustment more precise while retaining a predictable column grid. |
| Manual sizing is only remembered in live tile metadata, not saved/imported. | Persist automatic/manual sizing intent with the layout and provide an explicit Fit content action. | Reload, data changes and present mode should respect manual sizing choices. |

## Retained measurements

Evidence: [probe.json](diagnostics/layout-resize-2026-10-01/probe.json),
[starter screenshot](diagnostics/layout-resize-2026-10-01/before-1440.png),
[resize screenshot](diagnostics/layout-resize-2026-10-01/after-resize-1440.png),
[smaller viewport](diagnostics/layout-resize-2026-10-01/before-1024.png).

- KPI: 3 rows / 216px outer height; toolbar 43px; chart viewport 147px;
  card content 263px. Content is clipped behind internal scrolling.
- Bar: 562px chart container; SVG 514×220px; toolbar 73px.
- Donut: toolbar 100px; chart viewport 306px; card content 545px.
- Immediate resize: moving the pointer 120×90px grows the bar shell from
  588×360 to 708×450px, while its SVG stays 514×220px throughout the gesture.
  After release, the shell snaps to 686×432px and SVG width becomes 612px.
- A second resize produces the same pattern. SVG height remains 220px even
  when the tile reaches 504px tall.
- Pointer movement after mouseup leaves the tile unchanged; this probe did
  not reproduce a persistent mouse-release fault. A long hold was unnecessary
  for desktop resize activation.

## Approved implementation would proceed in this order

1. **Lock down layout and sizing contracts.** Preserve the four existing themes
   and current fonts. Add regression fixtures for current saved layouts, explicit
   starter geometry and sizing intent. Introduce a versioned row-height contract
   so old 72px y/h geometry converts exactly to 24px rows (multiply y/h by three)
   without altering horizontal positions or chart/data bindings. The schema,
   imports, templates and HTML viewer must agree before changing row height.
2. **Repair the chart frame.** Remove repeated headings, move settings out of
   the always-visible toolbar, remove nested scrolling, and correct content-fit
   measurements. Give new starter tiles balanced placements; saved dashboards
   preserve their existing positions and physical dimensions through migration.
3. **Make chart sizing responsive.** Pass measured plotting width/height through
   the registry to charts. Bound label margins, adapt facets to available width,
   and fit fixed-aspect charts. Keep source notes, sampling notices and data
   alternatives available. Apply the same rules in exported HTML.
4. **Repair direct resize feedback.** Mark manual intent at gesture start,
   coalesce/throttle chart renders during motion, and render once after release
   outside GridStack's synchronous cleanup. Stop automatic fitting from fighting
   a manual gesture. Add clear corner/edge handles and a Fit content control.
5. **Verify the combined result.** Run the existing integrity suites and build,
   add real pointer-resize regressions, retain screenshots at desktop viewports,
   and check present mode, JSON reload/import, HTML export and print geometry.

## Acceptance

- Fresh startup uses the full grid, with bar and line charts beside one another.
- Starter content and labels are visible at 1440×900 and 1024×768 without nested
  scrollbars; smaller tiles show an explicit readable minimum/fallback.
- Increasing a chart tile's height visibly increases useful plotting space;
  headings, controls and source notes do not scale as chart marks do.
- Resizing updates the chart before release. The first visible redraw target is
  within 100ms on the diagnostic machine; further redraws are coalesced rather
  than rebuilding every chart on every mousemove.
- Mouseup, release outside the tile, rapid consecutive gestures and Escape leave
  no active resize state. No size changes occur when moving the pointer afterward.
- Manual dimensions survive reload/import, data changes and present mode.
- Legacy dashboard pixel positions/heights and all data bindings survive the new
  row-height schema. Templates and HTML use the same geometry contract.
- Existing 36 render cases, integrity regressions, browser acceptance and production
  build continue to pass. New screenshot and pointer evidence is retained.

Approval authorizes these application changes and regression tests. The plan is
required by the supplied AGENTS.md instruction: "For complex tasks, begin by
generating a step-by-step build plan or a Product Requirements Document (PRD).
Wait for my approval before executing the main plan."
