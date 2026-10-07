/* global document, addEventListener, innerWidth, scrollTo -- browser callbacks */
import { launch } from 'puppeteer-core';
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
const output = resolve(process.argv[2] ?? '/tmp/stint-designer-setup.mp4');
const url = process.env.DEMO_URL;
const project = process.env.DEMO_PROJECT;
if (!url || !project) throw new Error('Set DEMO_URL to a fresh wizard link and DEMO_PROJECT to its temporary project.');
mkdirSync(dirname(output), { recursive: true });
const browser = await launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium', headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const pause = ms => new Promise(r => setTimeout(r, ms));
let recorder, preview;
try {
 await page.goto(url, { waitUntil: 'networkidle0' });
 await page.waitForSelector('#choose:not(:disabled)');
 await page.screenshot({ path: output.replace('.mp4', '-start.png') });
 await page.setViewport({ width: 390, height: 844 });
 if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile layout overflows');
 await page.screenshot({ path: output.replace('.mp4', '-mobile.png') });
 await page.setViewport({ width: 1440, height: 900 });
 await page.evaluate(() => {
  const cursor = document.createElement('div');
  cursor.style.cssText='position:fixed;top:0;left:0;pointer-events:none;z-index:9999;font-size:26px;filter:drop-shadow(0 1px 2px #fff)';cursor.textContent='↖';document.body.append(cursor);
  addEventListener('mousemove',e=>{cursor.style.transform=`translate(${e.clientX}px,${e.clientY}px)`});
 });
 recorder = await page.screencast({ path: output, format: 'mp4', fps: 25 });
 await pause(2500);
 const chooser = page.waitForFileChooser();
 await page.click('#choose');
 await (await chooser).accept([resolve('packages/stint-cli/test/fixtures/documents/grouped-profile.png')]);
 await page.waitForSelector('#review:not([hidden])', { timeout: 20000 });
 await pause(2800);
 await page.screenshot({ path: output.replace('.mp4', '-review.png') });
 const company = await page.$('#entries .field input');
 await company.click({ clickCount: 3 });
 await company.type('Example Design Studio', { delay: 55 });
 await pause(1200);
 await page.evaluate(() => scrollTo({ top: 700, behavior: 'smooth' }));
 await pause(2200);
 await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
 await pause(2200);
 await page.click('#save');
 await page.waitForSelector('#complete:not([hidden])', { timeout: 60000 });
 await page.screenshot({ path: output.replace('.mp4', '-complete.png') });
 await pause(2500);
 // Perform the integration that the copied prompt assigns to the coding agent.
 copyFileSync(new URL('./main.tsx', import.meta.url), join(project, 'src/main.tsx'));
 execFileSync('npm', ['run', 'build'], { cwd: project, stdio: 'pipe' });
 preview = await createServer({ root: project, configFile: false, server: { host: '127.0.0.1', port: 4190, strictPort: true } });
 await preview.listen();
 await page.goto('http://127.0.0.1:4190/', { waitUntil: 'networkidle0' });
 await page.waitForSelector('[role="slider"]');
 await page.focus('[role="slider"]');
 for(let i=0;i<30;i++){await page.keyboard.press('ArrowLeft');await pause(65)}
 await pause(2200);
 await page.screenshot({ path: output.replace('.mp4', '-timeline.png') });
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({ browserErrors: errors, saved: true, consumerBuild: 'passed', video: output }));
} finally { await recorder?.stop(); await browser.close(); await preview?.close(); }
