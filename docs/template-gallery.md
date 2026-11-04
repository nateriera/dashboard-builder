# Starter template gallery

Open [Dashboard Builder](https://nateriera.github.io/dashboard-builder/), choose
**More actions** → **Templates**, then select **Use template** and confirm
**Replace** for a starter below. Replacement changes the current dashboard; use
**More actions** → **Export JSON** first to keep a backup.
These original layouts use built-in sample data, not client records.

## Executive overview

KPI strip, monthly trend, category share, ranked categories, and monthly volume.
Use this as a starting point for a leadership summary.

![Executive overview](screenshots/template-executive-overview.png)

## Trend deep dive

Monthly line chart, small multiples by group, and volume/value scatter plot.
Use this to explore one metric from several angles.

![Trend deep dive](screenshots/template-trend-deep-dive.png)

## Geographic snapshot

State map, key figures, category breakdown, and category share.
Use this for a geographic view with supporting detail.

![Geographic snapshot](screenshots/template-geographic-snapshot.png)

All six starter definitions live in [src/templates.js](../src/templates.js).
This page embeds the captures in `docs/screenshots/`. The in-app gallery shows
bundled thumbnails for the starters and schematic previews for custom saved
templates, so private chart contents are not captured into an image.
Custom uploads and saved queries must travel with your dashboard to work in
another browser; missing data references require repair.
