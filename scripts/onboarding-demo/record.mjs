/* global document, addEventListener -- callbacks execute inside Chromium */
import { launch } from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
const url = process.env.DEMO_URL ?? 'http://127.0.0.1:4187/';
const output = resolve(process.argv[2] ?? '/tmp/stint-onboarding.mp4');
mkdirSync(dirname(output), { recursive: true });
const browser = await launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium', headless: true, defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 }, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
let recorder;
try {
  await page.goto(url, { waitUntil: 'networkidle0' });
  const initial = await page.evaluate(async () => (await fetch('/api/state')).json());
  if (initial.step !== 0) throw new Error('Start a new demo service before recording; this workspace has already advanced.');
  // Headless Chromium has no system cursor; expose actual mouse events in the capture.
  await page.evaluate(() => {
    const cursor = document.createElement('div'); cursor.id = 'recording-cursor';
    cursor.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:99999;width:18px;height:24px;filter:drop-shadow(0 2px 2px #0004)';
    cursor.innerHTML = '<svg viewBox="0 0 18 24"><path d="M2 1v19l5-5 4 8 3-2-4-8h7z" fill="#fff" stroke="#263328" stroke-width="1.5"/></svg>';
    document.body.append(cursor); addEventListener('mousemove', e => { cursor.style.transform=`translate(${e.clientX}px,${e.clientY}px)`; });
  });
  await page.screenshot({ path: output.replace(/\.mp4$/, '-start.png') });
  recorder = await page.screencast({ path: output, format: 'mp4', fps: 25 });
  await pause(1800);
  for (let step = 0; step < 7; step++) {
    const button = await page.$('#next');
    const bounds = await button.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 16 });
    await pause(350);
    await button.click();
    await page.waitForFunction(expected => document.querySelector('#eyebrow').textContent.startsWith(expected), { timeout: 120000 }, step === 6 ? 'SETUP COMPLETE' : String(step + 2).padStart(2, '0'));
    await pause(step === 0 ? 2200 : 3600);
    if (step === 3 || step === 4) {
      await page.evaluate(() => document.querySelector('.term-body').scrollTo({ top: 500, behavior: 'smooth' }));
      await pause(2000);
    }
    console.log(`Recorded step ${step + 1}`);
  }
  const frame = page.frames().find(frame => frame.url().includes('/project/'));
  if (!frame) throw new Error('Live project frame missing');
  await frame.waitForSelector('[role="slider"]', { timeout: 15000 });
  const slider = await frame.$('[role="slider"]');
  await slider.focus();
  for (let i = 0; i < 18; i++) { await page.keyboard.press('ArrowLeft'); await pause(65); }
  await pause(1500);
  const bounds = await slider.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .25, bounds.y + bounds.height / 2, { steps: 30 });
  await pause(1500);
  await page.mouse.move(bounds.x + bounds.width * .82, bounds.y + bounds.height / 2, { steps: 50 });
  await pause(2000);
  await page.screenshot({ path: output.replace(/\.mp4$/, '-complete.png') });
  if (errors.length) throw new Error(errors.join('\n'));
  const state = await page.evaluate(async () => (await fetch('/api/state')).json());
  console.log(JSON.stringify({ steps: state.step, configWritten: state.history.at(-1).configWritten, video: output, browserErrors: errors }));
} finally {
  await recorder?.stop();
  await browser.close();
}
