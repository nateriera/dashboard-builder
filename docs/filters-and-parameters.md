# Dashboard filters and SQL parameters

Dashboard Builder can filter matching tiles and use named values in SQL queries. These controls are saved with the dashboard and work locally in your browser.

## Add a dashboard filter

Choose **Filters**, then **Add filter**. Select a source column and choose values for a categorical field, or enter both ends of a numeric range. The list offers up to 200 distinct categorical values; when a field has more, narrow the data first. Date fields are not offered yet.

Filters compare the selected source column name with each tile's materialized rows. A tile that has the field is filtered; a tile that does not have it is left alone. A filter that leaves a tile with no rows shows a neutral empty message. Remove a filter from its chip in the Filters tab.

## Cross-filter from a chart

Click a bar or donut slice to filter other tiles that contain the chart's mapped category column. Click the same mark again, or clear its chip in **Filters**, to remove the cross-filter. A click on a different eligible chart replaces the current cross-filter. The source chart is excluded from its own cross-filter so the selection stays visible. In a donut's **Other** slice, the filter includes the categories combined into that slice.

Cross-filtering is pointer-only in this phase. Keyboard support is a follow-up.

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

## Save and share

Filters and parameters are included in saved layouts and JSON backups. HTML export resolves the current filters and SQL parameter values into each tile's materialized rows, then opens without a server. It does not include editable filter or parameter controls.
