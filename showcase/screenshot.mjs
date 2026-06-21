import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:5199/demo.html';
const OUT = path.resolve('showcase/screenshots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const shoot = async (name, { url = BASE, width, height, mobile = false, prep, fullPage = true } = {}) => {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  if (prep) await prep(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  await ctx.close();
  console.log('✓', name);
};

const desktop = { width: 1280, height: 900 };
const mobile = { width: 414, height: 896, mobile: true };

// 1. Onboarding / goal selection
await shoot('01-onboarding', { url: `${BASE}?screen=onboarding`, ...desktop });

// 2. Main dashboard (hero) — desktop
await shoot('02-dashboard-desktop', { ...desktop });

// 3. This Week's Plan expanded — desktop
await shoot('03-week-plan-desktop', {
  ...desktop,
  prep: async (p) => { await p.getByText(/Show.*This Week's Plan/).click(); },
});

// 4. Progress Tracker expanded — desktop
await shoot('04-progress-desktop', {
  ...desktop,
  prep: async (p) => { await p.getByText(/Show Progress Tracker/).click(); },
});

// 5. Calendar / date picker modal — desktop
await shoot('05-calendar-modal-desktop', {
  ...desktop,
  fullPage: false,
  prep: async (p) => { await p.locator('button:has-text("📅")').first().click(); },
});

// 6. Omnibox "which meal are you logging?" slot modal — desktop
await shoot('06-omnibox-slot-modal-desktop', {
  ...desktop,
  fullPage: false,
  prep: async (p) => {
    await p.getByPlaceholder(/Tell me what you ate/).click();
  },
});

// 7. Main dashboard — mobile
await shoot('07-dashboard-mobile', { ...mobile });

// 8. This Week's Plan — mobile
await shoot('08-week-plan-mobile', {
  ...mobile,
  prep: async (p) => { await p.getByText(/Show.*This Week's Plan/).click(); },
});

await browser.close();
console.log('All screenshots written to', OUT);
