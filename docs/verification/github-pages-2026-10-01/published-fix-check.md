# Published fix verification

Verified October 1, 2026 in the in-app Chromium browser against [GitHub Pages](https://nateriera.github.io/dashboard-builder/).

- Release commit: `7baf5a1e859b199eae32afbc7b572140bbb1670c`.
- [Pages workflow 36955267350](https://github.com/nateriera/dashboard-builder/actions/runs/36955267350): completed successfully at 2026-10-02 02:22:32 UTC.
- Published status: `Restored autosaved layout · build 2f-pages-fit`.
- Published asset: `/dashboard-builder/assets/index-CYaQo98c.js`, matching the local production build.
- At 1160×884, opening the bar Data → SQL panel and pointer-clicking Run returned eight rows. After results expanded, Run was at y=406.25–437.25 and enabled Apply at y=697.75–730.75, both inside the viewport. The panel was at y=8–753.75.
- After narrowing to 1024×768, Apply remained enabled and inside the viewport at y=697.75–730.75. A pointer click applied the query, closed the panel and changed the bar binding to Query 1.
- All five frames fit horizontally and vertically at 1160×884, 1024×768 and 1440×900. At 1024, KPI client/scroll heights are 243/243 and donut 411/411. Visual inspection confirms readable donut total 48,240, wrapped Other label, aligned values, source and retained-contribution notice.
- The published GitHub README displays Open the live demo linking to the Pages URL. About metadata remains blocked by the account access limitation described in [local verification](fix-verification.md).
- No captured warning/error messages during these live checks. Temporary viewport emulation was cleared. The live app and repository tabs remain available.

The live browser retains the previously resized bar (seven columns, eighteen rows) and now contains a synthetic sample query. No user uploads were used. These checks cover the identified public-app failures; local regressions separately cover pointer resizing, storage faults, precision and offline exports. Live download contents were not revalidated.

Evidence:

- [SQL controls inside the normal viewport](fixed-sql-1160.jpg)
- [KPI and applied query at 1024](fixed-1024.jpg)
- [Narrow donut at 1024](fixed-donut-1024.jpg)
- [Published README link](fixed-repository.jpg)
