// Desktop bridge — the web app's only door to the Tauri shell.
//
// Every export is a thin wrapper over `window.__TAURI__` (exposed because
// tauri.conf.json sets `withGlobalTauri: true`). Outside the shell — a
// plain browser — `isDesktop` is false and the wrappers reject, so no
// existing module changes behavior when the bridge is unused. The one
// exception is confirmDialog, which degrades to the browser's own
// window.confirm outside the shell (see its comment).
//
// File access never goes through a broad filesystem API: reads and writes
// call the three narrow commands in src-tauri/src/lib.rs (stat_file,
// read_text_file, write_text_file), and path selection goes through the
// Tauri dialog plugin (dialog:allow-open / dialog:allow-save).

const tauri = typeof window !== "undefined" ? window.__TAURI__ : undefined;

export const isDesktop = !!tauri;

function requireTauri() {
  if (!isDesktop) throw new Error("Desktop bridge used outside the Tauri shell.");
  return tauri;
}

/** Native open dialog for a single file. Resolves to the chosen path, or
 * null when the user cancels. `filters` is a Tauri dialog filter list,
 * e.g. [{ name: "CSV or JSON", extensions: ["csv", "json"] }]. */
export async function pickFile(filters) {
  const t = requireTauri();
  const selected = await t.dialog.open({ multiple: false, directory: false, filters });
  return typeof selected === "string" ? selected : null;
}

/** Native save dialog. Resolves to the chosen path, or null on cancel. */
export async function pickSavePath(defaultName, filters) {
  const t = requireTauri();
  const selected = await t.dialog.save({ defaultPath: defaultName, filters });
  return typeof selected === "string" && selected ? selected : null;
}

/** Ask the user a yes/no question; resolves to their answer. In the
 * shell this is the dialog plugin's native confirm — `window.confirm`
 * presents no UI in the WebView and returns true immediately, which
 * would silently auto-approve every prompt routed through it. In a
 * browser it is `window.confirm` itself, with unchanged semantics. */
export async function confirmDialog(message) {
  if (isDesktop) return !!(await requireTauri().dialog.confirm(message));
  return typeof window !== "undefined" && typeof window.confirm === "function"
    ? window.confirm(message)
    : false;
}

/** Byte size of the file at `path` (the stat_file command). */
export function statFile(path) {
  return requireTauri().core.invoke("stat_file", { path });
}

/** Whole file at `path`, decoded as UTF-8 text (the read_text_file command). */
export function readTextFile(path) {
  return requireTauri().core.invoke("read_text_file", { path });
}

/** Write `text` to `path`, replacing any existing file (the write_text_file command). */
export function writeTextFile(path, text) {
  return requireTauri().core.invoke("write_text_file", { path, contents: text });
}

/** Register a handler for files dropped on the window. The handler receives
 * the raw Tauri drag-drop payload ({ type, paths, position }); it fires for
 * type "drop" with the dropped file paths. Resolves to an unlisten function. */
export function onDragDrop(handler) {
  const t = requireTauri();
  return t.webview.getCurrentWebview().onDragDropEvent((event) => handler(event.payload));
}
