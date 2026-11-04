// Regenerates docs/screenshots/*.png from the production build.
//
// Usage:
//   npm run shots                 # builds, then captures all shots headlessly
//   CHROME_PATH=/path/to/chrome npm run shots   # override browser location
//
// The script launches headless Chromium via puppeteer-core (no browser
// download — it uses a Chrome/Chromium already on the machine) and captures
// the composer, theme-picker and Dusk screenshots. Themes are chosen through
// the app's own Theme picker (More actions → Theme).
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pageUrl, { timeout: 60000 });
  // Wait for at least one rendered chart before shooting.
  await page.waitForFunction(
    () => document.querySelectorAll(".tile svg, .tile .kpi-value").length > 0,
    { timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 800));
  // Since UX-6 the Theme button lives in the "More actions" disclosure, and
  // the starter layout applies its own saved theme at load, so a theme is
  // chosen through the real picker rather than seeded into storage.
  const openThemePicker = async () => {
    await page.click(".header-more > summary");
    await page.waitForSelector("#btn-theme", { visible: true, timeout: 10000 });
    await page.click("#btn-theme");
    await page.waitForSelector(".theme-popover", { timeout: 10000 });
    await page.evaluate(() => { document.querySelector(".header-more").open = false; });
  };
  if (theme) {
    await openThemePicker();
    await page.evaluate((id) => {
      const option = [...document.querySelectorAll(".theme-popover .theme-option")]
        .find((b) => b.textContent.toLowerCase().includes(id));
      if (!option) throw new Error(`theme option ${id} not found`);
      option.click();
    }, theme);
    await page.waitForFunction((id) => document.documentElement.dataset.theme === id, { timeout: 10000 }, theme);
    await page.waitForFunction(() => !document.querySelector(".theme-popover"), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 800));
  }
  if (clickThemeButton) {
    await openThemePicker();
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
