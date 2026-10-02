import { TILE_TYPES } from "../tiles/registry.js";
import { LIMITS } from "../data/limits.js";
import { focusDialog } from "./focus.js";

let activeDialog = null;
let releaseFocus = null;

function formatDistinct(field) {
  return field.distinctCount == null ? "more than 100" : field.distinctCount.toLocaleString();
}

function buildSuggestions(profile) {
  const suggestions = [];
  const numeric = profile.fields.filter((field) => field.kind === "number");
  const categories = profile.fields.filter((field) => field.kind === "category");
  const dates = profile.fields.filter((field) => field.kind === "date" && field.uniqueDates);

  function add(type, mapping, title, reason) {
    const entry = TILE_TYPES[type];
    if (suggestions.some((suggestion) => suggestion.type === type)) return;
    suggestions.push({ type, mapping, title, reason, label: entry.label });
  }

  const dateField = dates.find((field) => field.distinctCount !== 1);
  if (dateField && profile.rowCount > 1) {
    const valueField = numeric[0];
    if (valueField) add("line", { date: dateField.name, value: valueField.name }, `${dateField.name} trend`, `Uses ${dateField.name} and the detected numeric measure. Each date occurs once.`);
  }

  if (profile.rowCount <= LIMITS.categories) {
    const category = categories.find((field) => field.distinctCount === profile.rowCount);
    const valueField = numeric[0];
    if (category && valueField) add("bar", { label: category.name, value: valueField.name }, `${category.name} comparison`, `Compares ${category.name} across ${formatDistinct(category)} distinct rows.`);
  }

  if (numeric.length >= 2 && profile.rowCount >= 3) {
    const [x, y] = numeric;
    add("scatter", { x: x.name, y: y.name }, `${x.name} vs. ${y.name}`, `Compares two detected numeric fields; plotted marks follow the app's visible sampling notice.`);
  }

  return suggestions.slice(0, 3);
}

function closeGuidedStart() {
  if (!activeDialog) return;
  const dialog = activeDialog;
  activeDialog = null;
  dialog.remove();
  releaseFocus?.();
  releaseFocus = null;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function profileSummary(profile) {
  const wrap = element("div", "guided-summary");
  const stats = element("div", "guided-stats");
  stats.append(
    element("strong", "", profile.rowCount.toLocaleString()),
    element("span", "", "rows"),
    element("strong", "", profile.fields.length.toLocaleString()),
    element("span", "", "columns")
  );
  wrap.append(stats);

  const note = element("p", "guided-note", `Column types were inferred from ${profile.sampledRows.toLocaleString()} evenly spaced rows; missing-value counts cover the full file.`);
  wrap.append(note);

  const list = element("div", "guided-fields");
  list.setAttribute("role", "list");
  for (const field of profile.fields) {
    const row = element("div", "guided-field");
    row.setAttribute("role", "listitem");
    row.append(
      element("span", "guided-field-name", field.name),
      element("span", "guided-field-kind", field.kind.replaceAll("-", " ")),
      element("span", "guided-field-meta", `${field.missingCount.toLocaleString()} missing · ${formatDistinct(field)} distinct`)
    );
    list.append(row);
  }
  wrap.append(list);
  return wrap;
}

function mappingControls(suggestion, fields) {
  const row = element("div", "guided-mapping");
  const requirements = TILE_TYPES[suggestion.type].fields.filter((field) => !field.optional);
  for (const requirement of requirements) {
    const expected = requirement.numeric ? "number" : requirement.key === "date" ? "date" : requirement.key === "label" ? "category" : null;
    let candidates = fields.filter((field) => expected ? field.kind === expected : ["category", "identifier"].includes(field.kind));
    if (suggestion.type === "scatter") {
      const otherKey = requirement.key === "x" ? "y" : "x";
      candidates = candidates.filter((field) => field.name !== suggestion.mapping[otherKey] || field.name === suggestion.mapping[requirement.key]);
    }
    const label = element("label", "guided-map-label", requirement.label);
    const select = document.createElement("select");
    select.setAttribute("aria-label", `${suggestion.label}: ${requirement.label}`);
    for (const field of candidates) {
      if (requirement.key === "date" && !field.uniqueDates) continue;
      const option = document.createElement("option");
      option.value = field.name;
      option.textContent = field.name;
      option.selected = field.name === suggestion.mapping[requirement.key];
      select.append(option);
    }
    if (!select.value && select.options.length) select.selectedIndex = 0;
    if (select.value) suggestion.mapping[requirement.key] = select.value;
    select.addEventListener("change", () => {
      suggestion.mapping[requirement.key] = select.value;
      if (suggestion.type === "line") suggestion.title = `${suggestion.mapping.date} trend`;
      else if (suggestion.type === "bar") suggestion.title = `${suggestion.mapping.label} comparison`;
      else if (suggestion.type === "scatter") suggestion.title = `${suggestion.mapping.x} vs. ${suggestion.mapping.y}`;
      label.closest(".guided-suggestion")?.querySelector(".guided-suggestion-copy strong")?.replaceChildren(document.createTextNode(suggestion.title));
    });
    label.append(select);
    row.append(label);
  }
  return row;
}

export function openGuidedStart({ name, id, profile, onUseData, onApply, onKeep }) {
  closeGuidedStart();
  let applying = false;
  const suggestions = buildSuggestions(profile);
  const backdrop = element("div", "guided-backdrop");
  const dialog = element("section", "guided-dialog");
  dialog.setAttribute("aria-label", "Review uploaded data and dashboard suggestions");
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !applying) { onKeep(); closeGuidedStart(); }
  });
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop && !applying) { onKeep(); closeGuidedStart(); }
  });

  const head = element("header", "guided-head");
  const headingGroup = element("div", "");
  headingGroup.append(element("h2", "", "Your data is ready"), element("p", "", name));
  const close = element("button", "guided-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close upload summary");
  close.addEventListener("click", () => { if (!applying) { onKeep(); closeGuidedStart(); } });
  head.append(headingGroup, close);

  const content = element("div", "guided-content");
  content.append(profileSummary(profile));
  content.append(element("h3", "guided-section-title", "Suggested charts"));
  content.append(element("p", "guided-note", "Suggestions are based on column names and sampled values. Review the fields before building; the uploaded file is unchanged."));

  const choices = [];
  if (suggestions.length) {
    const cards = element("div", "guided-suggestions");
    for (const suggestion of suggestions) {
      const label = element("label", "guided-suggestion");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = true;
      check.value = suggestion.type;
      const copy = element("span", "guided-suggestion-copy");
      copy.append(
        element("strong", "", suggestion.title),
        element("span", "guided-suggestion-type", suggestion.label),
        element("span", "guided-suggestion-reason", suggestion.reason)
      );
      copy.append(mappingControls(suggestion, profile.fields));
      label.append(check, copy);
      cards.append(label);
      choices.push({ check, suggestion });
    }
    content.append(cards);
  } else {
    content.append(element("p", "guided-empty", "No chart suggestion met the conservative mapping rules. You can still use this file with the existing chart tools, templates, or SQL."));
  }

  const footer = element("footer", "guided-actions");
  const keep = element("button", "guided-secondary", "Keep current dashboard");
  keep.type = "button";
  keep.addEventListener("click", () => { if (!applying) { onKeep(); closeGuidedStart(); } });
  const use = element("button", "guided-secondary", "Set as dashboard data");
  use.type = "button";
  use.addEventListener("click", () => { if (!applying) { onUseData(); closeGuidedStart(); } });
  const apply = element("button", "guided-primary", "Build selected charts");
  apply.type = "button";
  apply.disabled = choices.length === 0;
  for (const { check } of choices) check.addEventListener("change", () => {
    apply.disabled = !choices.some((choice) => choice.check.checked);
  });
  apply.addEventListener("click", () => {
    const selected = choices.filter((choice) => choice.check.checked).map((choice) => choice.suggestion);
    if (!selected.length) return;
    applying = true;
    apply.disabled = true;
    close.disabled = true;
    keep.disabled = true;
    use.disabled = true;
    apply.textContent = "Building…";
    Promise.resolve(onApply({ id, name, suggestions: selected })).then((result) => {
      if (result === false) {
        applying = false;
        apply.disabled = false;
        close.disabled = false;
        keep.disabled = false;
        use.disabled = false;
        apply.textContent = "Build selected charts";
        return;
      }
      closeGuidedStart();
    }).catch(() => {
      applying = false;
      apply.disabled = false;
      close.disabled = false;
      keep.disabled = false;
      use.disabled = false;
      apply.textContent = "Build selected charts";
    });
  });
  footer.append(keep, use, apply);

  dialog.append(head, content, footer);
  backdrop.append(dialog);
  document.body.append(backdrop);
  activeDialog = backdrop;
  releaseFocus = focusDialog(dialog, document.activeElement);
}
