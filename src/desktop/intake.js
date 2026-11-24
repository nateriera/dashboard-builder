// Shared intake helper for file uploads — the bridge's caller.
//
// Both upload popovers (per-tile and dashboard-wide) and the desktop
// window-drop path funnel files through here, so the large-file warning
// (Nov 24 ruling) lives in exactly one place instead of per popover.
//
// The warning is an intake-layer guard only: it fires before a file is
// read, and cancelling aborts the intake cleanly. It does not change the
// parse pipeline — parseFile's 16 MiB cap (LIMITS.fileBytes) still applies
// afterwards, unchanged.

import { isDesktop, pickFile, readTextFile, statFile } from "./bridge.js";

/** Files at or above this size get a confirm-to-proceed warning on intake. */
export const LARGE_FILE_WARN_BYTES = 250 * 1024 * 1024;

export function needsLargeFileWarning(sizeBytes) {
  return typeof sizeBytes === "number" && sizeBytes >= LARGE_FILE_WARN_BYTES;
}

export function largeFileWarningMessage(name, sizeBytes) {
  const mb = Math.round(sizeBytes / (1024 * 1024));
  return `This file (${name}) is ${mb} MB. Files this large can be slow or run into the in-browser engine's limits. Continue?`;
}

/** True when the intake may proceed: either the file is below the warning
 * threshold, or the user confirmed the warning. `confirmFn` is injectable
 * for tests; in the app it is window.confirm. */
export function confirmLargeFile(name, sizeBytes, confirmFn = (message) => window.confirm(message)) {
  if (!needsLargeFileWarning(sizeBytes)) return true;
  return !!confirmFn(largeFileWarningMessage(name, sizeBytes));
}

/** Last path segment of a filesystem path (POSIX or Windows separators). */
export function baseName(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(path);
}

/** Construct the File the existing upload pipeline consumes. */
export function makeFile(text, name) {
  return new File([text], name);
}

/** Desktop only: turn a filesystem path into a File for the upload
 * pipeline — size check (with the large-file warning) first, then read.
 * Resolves to null when the user cancels the warning. */
export async function fileFromPath(path) {
  const size = await statFile(path);
  const name = baseName(path);
  if (!confirmLargeFile(name, size)) return null;
  const text = await readTextFile(path);
  return makeFile(text, name);
}

/** Desktop only: native open dialog (CSV/JSON) → fileFromPath. Resolves
 * to null when the dialog or the warning is cancelled. */
export async function pickDataFile() {
  if (!isDesktop) return null;
  const path = await pickFile([{ name: "CSV or JSON data", extensions: ["csv", "json"] }]);
  if (!path) return null;
  return fileFromPath(path);
}
