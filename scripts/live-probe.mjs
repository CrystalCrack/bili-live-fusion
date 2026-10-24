// Read-only check against a real, public Bilibili room. Uses an isolated browser
// profile and never sends chat messages. Pass the room ID on the command line.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseRoomId } from '../extension/lib/model.js';
const room = parseRoomId(process.argv[2]); if (!room) throw new Error('Usage: node scripts/live-probe.mjs ROOM_ID');
const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : await import('playwright');
const root = fileURLToPath(new URL('../', import.meta.url)), extension = path.join(root, 'extension'), artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(artifacts, 'edge-probe-')), {
  executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'], ignoreDefaultArgs: ['--disable-extensions']
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage(), failures = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => { const u = new URL(request.url()); if (u.protocol === 'https:') failures.push({ host: u.hostname, path: u.pathname, error: request.failure()?.errorText }); });
  await page.goto(`chrome-extension://${extensionId}/studio.html`); await page.locator('#room-A').fill(room); await page.locator('[data-connect="A"]').click();
  try {
    await page.waitForFunction(() => { const v = document.querySelector('#video-A'); return v.videoWidth > 0 && !v.paused && v.currentTime > 0; }, null, { timeout: 35000 });
    await page.waitForFunction(() => document.querySelector('[data-danmaku-status="A"]').textContent.includes('已连接'), null, { timeout: 20000 });
    const start = await page.locator('#video-A').evaluate(v => v.currentTime); await page.waitForTimeout(2000);
    const detail = await page.evaluate(() => { const v = document.querySelector('#video-A'); return {
      width: v.videoWidth, height: v.videoHeight, time: v.currentTime, paused: v.paused, srcObject: Boolean(v.srcObject),
      status: document.querySelector('[data-status="A"]').textContent, quality: document.querySelector('[data-quality-status="A"]').textContent,
      danmaku: document.querySelector('[data-danmaku-status="A"]').textContent, audio: document.querySelector('#db-A').textContent,
      sync: document.querySelector('#sync-status-A').textContent, frames: v.getVideoPlaybackQuality().totalVideoFrames };
    });
    assert.ok(detail.time > start + 1); assert.equal(detail.srcObject, false); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ room, connected: true, ...detail, errors }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ room, state: await page.evaluate(() => ({
      source: document.querySelector('[data-source-title="A"]').textContent, chat: document.querySelector('[data-danmaku-status="A"]').textContent,
      sync: document.querySelector('#sync-status-A').textContent, toasts: document.querySelector('#toast-region').textContent
    })), failures: failures.slice(-10), errors }, null, 2)); throw error;
  }
} finally { await context.close(); }
