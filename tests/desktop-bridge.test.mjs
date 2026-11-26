import test from "node:test";
import assert from "node:assert/strict";

import {
  confirmDialog,
  isDesktop,
  pickFile,
  pickSavePath,
  readTextFile,
  statFile,
  writeTextFile
} from "../src/desktop/bridge.js";
import {
  LARGE_FILE_WARN_BYTES,
  baseName,
  confirmLargeFile,
  fileFromPath,
  largeFileWarningMessage,
  makeFile,
  needsLargeFileWarning,
  pickDataFile
} from "../src/desktop/intake.js";

test("detection is off outside the Tauri shell", () => {
  assert.equal(isDesktop, false);
});

test("bridge wrappers refuse outside the shell", async () => {
  await assert.rejects(() => pickFile(), /outside the Tauri shell/);
  await assert.rejects(() => pickSavePath("x.json"), /outside the Tauri shell/);
  assert.throws(() => statFile("/tmp/x"), /outside the Tauri shell/);
  assert.throws(() => readTextFile("/tmp/x"), /outside the Tauri shell/);
  assert.throws(() => writeTextFile("/tmp/x", "y"), /outside the Tauri shell/);
  await assert.rejects(() => fileFromPath("/tmp/x.csv"), /outside the Tauri shell/);
  assert.equal(await pickDataFile(), null);
});

test("large-file warning threshold is 250 MiB, inclusive", () => {
  assert.equal(LARGE_FILE_WARN_BYTES, 32 * 1024 * 1024);
  assert.equal(needsLargeFileWarning(LARGE_FILE_WARN_BYTES - 1), false);
  assert.equal(needsLargeFileWarning(LARGE_FILE_WARN_BYTES), true);
  assert.equal(needsLargeFileWarning(LARGE_FILE_WARN_BYTES * 2), true);
  assert.equal(needsLargeFileWarning(0), false);
  assert.equal(needsLargeFileWarning(undefined), false);
});

test("warning message names the file and its size", () => {
  const msg = largeFileWarningMessage("big.csv", 300 * 1024 * 1024);
  assert.match(msg, /big\.csv/);
  assert.match(msg, /300 MB/);
  assert.match(msg, /Continue\?/);
});

test("confirmLargeFile only asks at or above the threshold", async () => {
  let asked = 0;
  const yes = () => { asked++; return true; };
  assert.equal(await confirmLargeFile("a.csv", 10, yes), true);
  assert.equal(asked, 0);
  assert.equal(await confirmLargeFile("a.csv", LARGE_FILE_WARN_BYTES, yes), true);
  assert.equal(asked, 1);
  assert.equal(await confirmLargeFile("a.csv", LARGE_FILE_WARN_BYTES, () => false), false);
});

test("confirmLargeFile awaits an async confirm function, both branches", async () => {
  const seen = [];
  const yesAsync = async (message) => { seen.push(message); return true; };
  const noAsync = async () => false;
  assert.equal(await confirmLargeFile("big.csv", LARGE_FILE_WARN_BYTES, yesAsync), true);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /big\.csv/);
  assert.equal(await confirmLargeFile("big.csv", LARGE_FILE_WARN_BYTES, noAsync), false);
});

test("confirmDialog resolves a boolean outside the shell (no browser confirm in this harness)", async () => {
  assert.equal(await confirmDialog("Continue?"), false);
});

test("baseName takes the last path segment on either separator", () => {
  assert.equal(baseName("/home/user/data/sales.csv"), "sales.csv");
  assert.equal(baseName("C:\\Users\\nate\\sales.csv"), "sales.csv");
  assert.equal(baseName("sales.csv"), "sales.csv");
});

test("makeFile builds the File the upload pipeline consumes", async () => {
  const file = makeFile("a,b\n1,2\n", "tiny.csv");
  assert.equal(file.name, "tiny.csv");
  assert.equal(file.size, 8);
  assert.equal(await file.text(), "a,b\n1,2\n");
});
