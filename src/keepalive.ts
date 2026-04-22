/**
 * keepalive.ts — runs as a standalone PM2 process.
 *
 * Every 6 hours, opens YouTube in a persistent Chromium session so the
 * browser cookies stay fresh and session activity is maintained.
 * PM2 restarts this process on its cron_restart schedule (0 *\/6 * * *).
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import * as path from 'path';
import * as os from 'os';

const CHROME_PROFILE = process.env.CHROME_USER_DATA_DIR || path.join(os.homedir(), 'chrome-profile');
const KEEPALIVE_URL = 'https://music.youtube.com';

async function keepalive(): Promise<void> {
  console.log(`[keepalive] Starting session warm-up against ${KEEPALIVE_URL}`);
  console.log(`[keepalive] Chrome profile: ${CHROME_PROFILE}`);

  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const page = await browser.newPage();

  try {
    await page.goto(KEEPALIVE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    console.log(`[keepalive] Page loaded: ${page.url()}`);

    // Brief wait so cookies are written back to the profile
    await page.waitForTimeout(5_000);

    const title = await page.title();
    console.log(`[keepalive] ✓ Page title: "${title}" — session is alive`);
  } catch (err: any) {
    console.error(`[keepalive] Failed to load ${KEEPALIVE_URL}:`, err.message);
  } finally {
    await browser.close();
  }
}

keepalive()
  .then(() => {
    console.log('[keepalive] Done');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[keepalive] Fatal error:', err);
    process.exit(1);
  });
