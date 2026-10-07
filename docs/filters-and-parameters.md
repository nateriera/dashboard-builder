# Dashboard filters and SQL parameters

Dashboard Builder can filter matching tiles and use named values in SQL queries. These controls are saved with the dashboard and work locally in your browser.

## Add a dashboard filter

Choose **Filters**, then **Add filter**. Select a source chart and field, then choose values for a category or enter a number or date range. Date ranges include both calendar dates and offer last 7 days, last 30 days, month-to-date, last month, and year-to-date presets. Time-series charts also accept a drag selection over the x-axis to create a date cross-filter. The list offers up to 200 distinct categorical values; when a field has more, narrow the data first.

Each filter shows the charts it affects and the field used in each chart. Matching field names are connected automatically; change a chart's field or choose **Do not filter** to scope the control. This lets one dashboard filter connect fields with different names while leaving unrelated charts unchanged. Older saved filters without explicit connections keep their prior same-name behavior. A filter that leaves a chart with no rows shows a neutral empty message. Remove a filter from its chip in the Filters tab.

Date fields are inferred from ISO date and timestamp values. Date filters compare calendar dates, so a selected end date includes rows later that day when the source contains timestamps. Date input values are stored as `YYYY-MM-DD` strings.

## Cross-filter from a chart

Activate a category mark in a bar, column, dot, stacked bar/column, or donut chart to create a cross-filter from that source. Selections from different charts remain independent and combine. Focus a mark and press Enter to use it with the keyboard. Hold Control or Command while selecting to add or remove values; click the same mark again, or clear its chip in **Filters**, to remove the selection. Each category chart can filter incoming selections, highlight matching marks, or ignore them. In a donut's **Other** slice, the filter includes the categories combined into that slice.

Open a tile's **Settings** to choose whether mark activation filters charts, inspects the contributing records, or does both. The record table is paginated and includes source columns.

Selections support mouse, touch, and keyboard activation. Multi-selection uses Control or Command with the keyboard or pointer.

## Use an SQL parameter

Choose **Filters** → **Parameters** → **Add parameter**. Give it a name made of letters, numbers, or underscores (starting with a letter or underscore), then choose **Number** or **Text**. Numeric parameters can have minimum and maximum bounds; when both are set, the value appears as a slider.

Reference a parameter in a SQL tile with double braces:

```sql
SELECT *, value * {{growth}} AS projected FROM categorical
```

Number values are inserted as numeric literals. Text values are quoted and embedded apostrophes are escaped, so `O'Brien` becomes a valid SQL string. If a query refers to a missing parameter, the tile shows an error that names the parameter and points to the Parameters tab. Changing a parameter re-runs SQL tiles that use it.

## Sort, limit, and reference lines

Bar, column, and dot charts can sort descending, ascending, or in source order. Category sorting is based on the value field. **Show top N categories** keeps the selected number of categories after sorting; rows are then passed to the chart's integrity checks. The remainder is omitted, not grouped as **Other**. Stacked charts rank categories by their combined series total and keep every series row for selected categories. Donut charts keep their existing top-five-plus-Other display so the whole remains readable; they do not use the top-N control.

Charts with numeric value axes can show an optional reference value and label. Clear the value to turn the line off. A reference line can extend beyond the data range, including to zero or a negative number.

## Change a chart type

Open a tile's **Settings** and choose **Chart type**. The list is limited to chart types whose required fields are present in the tile's current data. The data connection stays attached to the tile; type-specific settings reset when the chart changes.

## Save and share

Filters and parameters are included in saved layouts and JSON backups. HTML export materializes each tile's source rows and filter definitions so category, numeric, and date filters can be changed offline. Category cross-filtering also works in the standalone file. SQL parameters are resolved during export; the offline viewer does not rerun SQL. Wrangling recipes are stored locally in the current browser and can be loaded into a later pivot or calculated-field session.
