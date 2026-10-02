# Public GitHub and GitHub Pages browser test

Tested October 1, 2026 using the Codex in-app Chromium browser against the published site, with GitHub API deployment verification. Application source and repository settings were not changed.

## Target and version

- [Public repository](https://github.com/nateriera/dashboard-builder)
- [Published app](https://nateriera.github.io/dashboard-builder/)
- Latest repository commit: `5f6d4ab26a6f2cde0112e7be96ac79fe54f18701`.
- [Successful Pages deployment](https://github.com/nateriera/dashboard-builder/actions/runs/36952270637) uses that same commit, completed at 2026-10-02 01:43:49 UTC.
- Published composer asset: `/dashboard-builder/assets/index-CuE3A3fN.js`, matching the locally verified production build.
- The displayed build label still says `2f-remediation`; the deployment SHA and asset identify the version more precisely.

## Findings

### P2: SQL controls can fall below the viewport

On the sample bar tile, open Data, then SQL. The popover expands after its initial positioning. At the normal 1160×884 browser viewport, Run had bounds x=533.64, y=896.25, width=63.27, height=31: the entire button was below the viewport. A normal pointer click failed. Apply is still farther down when preview rows and mappings appear.

Keyboard activation of Run succeeds: DuckDB returns eight categorical rows and enables Apply. The engine works; the obstruction is popover layout. Recalculate placement when tab/preview content changes and constrain the panel to the available viewport height, with scrolling inside the panel. Verify this on lower tiles and after query results appear.

Evidence: [offscreen controls](sql-controls-offscreen.jpg).

### P3: small chart-frame overflows remain at narrower desktop sizes

At 1160×884, the initial KPI frame was 243px high with 247px of scroll content, producing a small scrollbar. At an emulated 1024×768 viewport, the KPI had the same four-pixel excess and the four-column donut frame was 411px high with 463px of content. Horizontal frame overflow was absent in the measured tiles. The remaining vertical overflow keeps content accessible through the outer scrollbar, but undermines the desired fit.

At 1440×900, all five measured frames fit without overflow. These measurements use this browser's fonts and scrollbar behavior; the prior headless Chrome verification does not rule out this difference. Recheck intrinsic KPI sizing and narrow donut legends/notes across both environments.

### P3: the public repository does not advertise its working demo

The repository About section says no description, website, or topics are provided. API metadata confirms `homepage: null`. The README has no direct link to the published app. Add the Pages URL to About and a prominent demo link to the README so visitors can find the app.

## Checks completed

| Check | Result |
| --- | --- |
| Public repository and README load | Pass; latest commit and successful check visible |
| Pages deployment matches pushed fix | Pass; deployment SHA matches `5f6d4ab` |
| Starter composition | Pass; full-width KPI, paired bar/line, paired donut/scatter |
| Donut total | Pass; 48,240 with Other and retained-contribution notice |
| Pointer resizing before mouseup | Pass; bar plot changed from 383×212 to 467×254 during the held gesture |
| Mouseup cleanup | Pass; settled plot 456×260, no resizing class, subsequent pointer movement did not change geometry |
| Save and reload | Pass; manual grid size 7 columns × 18 rows survived reload |
| Present and exit | Pass; editor controls hide and return, with no active resizing state |
| Settings | Pass; unit input is accessible through the disclosure |
| Template gallery | Pass; six starters appear; Escape dismisses and returns focus to Templates |
| Chart data alternative | Pass; all eight bar rows appear and the table can be collapsed |
| Hosted DuckDB initialization | Pass; engine becomes ready and lists six sample tables |
| Sample SQL preview | Pass by keyboard; SELECT * FROM categorical LIMIT 10 returns eight rows and enables Apply |
| JSON export preparation | UI reports Exported layout JSON |
| HTML export preparation | UI reports Exported dashboard.html, 433 KB, five tiles |
| Captured app console | No warning/error messages observed during load, resize, export preparation, present mode, or SQL preview |

## Scope and evidence

This was a live browser smoke test, not a repeat of all fourteen local acceptance tests. Downloads were triggered, but the in-app browser's download event timed out; file contents, re-import, and offline execution of those live downloads were not verified. Uploads, full fault injection, mobile editing, screen readers, other browser engines, and printer output were not tested here.

Screenshots at 1440×900 and 1024×768 use temporary CDP device-metric emulation, with dimensions confirmed from the live DOM. The default viewport was 1160×884. Temporary sizing overrides were cleared afterward. The sample bar was resized and saved in the test browser, so the later screenshots show the resulting arrangement rather than a pristine starter. The app and repository tabs remain available for review.

- [1440×900 published app](live-1440.jpg)
- [1024×768 published app](live-1024.jpg)
- [SQL obstruction at the default viewport](sql-controls-offscreen.jpg)
- [Public repository](repository.jpg)

Only this report and screenshot evidence were added locally. The unrelated APPLY.txt modifications were preserved.
