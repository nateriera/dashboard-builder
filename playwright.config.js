import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 60000, workers: 1,
  reporter: [['list'],['json',{outputFile:'test-results/browser-results.json'}]],
  use: { browserName: 'chromium', channel: 'chrome', baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173', viewport: {width:1440,height:900} },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command:'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url:'http://127.0.0.1:4173', reuseExistingServer:false, timeout:60000 }
});
