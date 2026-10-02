// Regenerates docs/screenshots/*.png from the production build.
//
// Usage:
//   npm run shots                 # builds, then captures all shots headlessly
//   CHROME_PATH=/path/to/chrome npm run shots   # override browser location
//
// The script launches headless Chromium via puppeteer-core (no browser
// download — it uses a Chrome/Chromium already on the machine) and captures
// the three screenshots referenced by the README. Themes are seeded through
// localStorage before the app boots, the same key the app itself uses.
//
// The production build is loaded over file:// with
// --allow-file-access-from-files (ES modules are blocked on file://
// otherwise). No local server is needed.

import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "screenshots");
const pageUrl = pathToFileURL(join(root, "dist", "index.html")).href;

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/opt/meta-chromium/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const hit = candidates.find(existsSync);
  if (!hit) {
    throw new Error(
      "No Chrome/Chromium found. Install Chrome or set CHROME_PATH to its executable."
    );
  }
  return hit;
}

async function capture(browser, { theme, clickThemeButton, out, width = 1440, height = 900 }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  if (theme) {
    await page.evaluateOnNewDocument(
      (id) => localStorage.setItem("dashbuilder.theme.v1", id),
      theme
    );
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pageUrl, { timeout: 60000 });
  // Wait for at least one rendered chart before shooting.
  await page.waitForFunction(
    () => document.querySelectorAll(".tile svg, .tile .kpi-value").length > 0,
    { timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 800));
  if (clickThemeButton) {
    await page.click("#btn-theme");
    await page.waitForSelector(".theme-popover", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 400));
  }
  await page.screenshot({ path: join(outDir, out) });
  await page.close();
  if (errors.length) throw new Error(`page errors on ${out}: ${errors.join(" | ")}`);
  console.log("wrote", out);
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-proxy-server",
    "--allow-file-access-from-files",
  ],
});

try {
  await capture(browser, { out: "composer-paper.png" });
  await capture(browser, { clickThemeButton: true, out: "theme-picker.png" });
  await capture(browser, { theme: "dusk", out: "composer-dusk.png" });
} finally {
  await browser.close();
}
console.log("done");
