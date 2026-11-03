# JSON backup or HTML sharing?

Both exports use the current dashboard and bundled sample data. The screenshots
below were captured from the built-in starter dashboard.

| Export | Use it for | What it contains |
| --- | --- | --- |
| **Export JSON** | An editable backup to import into Dashboard Builder | Layout, bindings, options, saved SQL, and eligible uploaded inputs. Each upload has a 500 KiB inline budget. |
| **Export HTML** | Sharing a finished dashboard as a viewer, with an embedded editable backup | A single HTML file with materialized tile rows, theme, options, and a layout backup. The viewer opens without the composer, SQL engine, or network access. |

![The built-in dashboard after loading the saved JSON backup; it remains editable in the composer](screenshots/json-backup-composer.png)

![The exported standalone HTML viewer opened offline](screenshots/html-sharing-viewer.png)

## JSON backup details

Choose **Export JSON** to save a dashboard backup. To load it later, choose
**Import JSON / HTML** and select that file; the restored dashboard stays editable in
the composer. The screenshot above shows the built-in dashboard after loading
its backup. Built-in sample bindings remain references to the samples bundled
with the app. Uploaded datasets are included only when available and within
the per-dataset size budget. Before downloading, the app lists missing,
oversized, or failed-query dependencies. Continuing preserves those references
and records the omissions in `omittedDependencies`; an affected tile shows
**Data unavailable** after import.

To repair a missing upload, bind a replacement CSV through the tile’s **Data**
button. Follow [Map a CSV to a chart](csv-mapping-walkthrough.md).

## HTML sharing details

Use **Export HTML** for a portable viewer. The export materializes the rows for
each tile, so recipients do not need the source upload or SQL query to view the
charts. The viewer has no composer, SQL tab, upload controls, or promise of
offline composer startup. New HTML exports also embed the editable layout,
saved queries (including transform chains), and eligible source uploads. Choose
**Import JSON / HTML** in Dashboard Builder to restore that backup; import reads
only its embedded JSON and never executes the HTML. Imported queries require
Run and Apply before they can execute in tiles.

The editable backup has the same 500 KiB per-dataset inline budget as JSON.
Omitted inputs remain listed in `omittedDependencies`, and the export status
reports unavailable editable dependencies. The static viewer still carries its
materialized rows. Keep the source files or a separate backup for omitted inputs.
Older viewer exports without an embedded layout cannot be imported this way.
