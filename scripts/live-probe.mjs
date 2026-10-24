// Read-only check against a real, public Bilibili room. Uses an isolated browser
// profile and never sends chat messages. Pass the room ID on the command line.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseRoomId } from '../extension/lib/model.js';
const room = parseRoomId(process.argv[2]); if (!room) throw new Error('Usage: node scripts/live-probe.mjs ROOM_ID');
const headed = process.argv.includes('--headed'), checkOutput = process.argv.includes('--output');
const secondRoomOption = process.argv.find(arg => arg.startsWith('--second-room='));
const secondRoom = secondRoomOption ? parseRoomId(secondRoomOption.slice('--second-room='.length)) : null;
if (secondRoomOption && !secondRoom) throw new Error('Invalid second room');
const assignments = secondRoom ? [['A', room], ['B', secondRoom]] : [['A', room]];
const blockLiveWorker = process.argv.includes('--block-live-worker');
const artifactName = `live-${assignments.map(([, roomId]) => roomId).join('-')}`;
const duration = Number(process.argv.find(arg => arg.startsWith('--duration='))?.split('=')[1] || 2);
assert.ok(Number.isFinite(duration) && duration >= 2 && duration <= 90, 'Duration must be 2–90 seconds');
const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : await import('playwright');
const root = fileURLToPath(new URL('../', import.meta.url)), extension = path.join(root, 'extension'), artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(artifacts, 'edge-probe-')), {
  executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: !headed,
  viewport: { width: 1600, height: 1180 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions']
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage(), failures = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => { const u = new URL(request.url()); if (u.protocol === 'https:') failures.push({ host: u.hostname, path: u.pathname, error: request.failure()?.errorText }); });
  await page.goto(`chrome-extension://${extensionId}/studio.html`);
  if (blockLiveWorker) await page.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime); window.liveWorkerRequests = 0;
    chrome.runtime.sendMessage = message => {
      if (message.type.startsWith('LIVE_')) { window.liveWorkerRequests++; return new Promise(() => {}); }
      return send(message);
    };
  });
  for (const [id, roomId] of assignments) { await page.locator(`#room-${id}`).fill(roomId); await page.locator(`[data-connect="${id}"]`).click(); }
  try {
    const ids = assignments.map(([id]) => id);
    await page.waitForFunction(ids => ids.every(id => { const v = document.querySelector(`#video-${id}`); return v.videoWidth > 0 && !v.paused && v.currentTime > 0; }), ids, { timeout: 35000 });
    await page.waitForFunction(ids => ids.every(id => document.querySelector(`[data-danmaku-status="${id}"]`).textContent.includes('已连接')), ids, { timeout: 20000 });
    const starts = Object.fromEntries(await Promise.all(ids.map(async id => [id, await page.locator(`#video-${id}`).evaluate(v => v.currentTime)])));
    let output, outputStart;
    if (checkOutput) {
      await page.locator(`[data-preset="${secondRoom ? 'split' : 'a'}"]`).click();
      const opened = context.waitForEvent('page'); await page.locator('#live-output-button').click(); output = await opened;
      output.on('pageerror', error => errors.push(error.message));
      await output.waitForFunction(() => { const v = document.querySelector('video'); return v.videoWidth > 0 && v.currentTime > 0 && !v.paused; });
      outputStart = await output.locator('video').evaluate(v => v.currentTime);
    }
    await page.waitForTimeout(duration * 1000);
    const readSource = id => page.evaluate(id => { const v = document.querySelector(`#video-${id}`); return {
      width: v.videoWidth, height: v.videoHeight, time: v.currentTime, paused: v.paused, srcObject: Boolean(v.srcObject),
      status: document.querySelector(`[data-status="${id}"]`).textContent, quality: document.querySelector(`[data-quality-status="${id}"]`).textContent,
      danmaku: document.querySelector(`[data-danmaku-status="${id}"]`).textContent, audio: document.querySelector(`#db-${id}`).textContent,
      sync: document.querySelector(`#sync-status-${id}`).textContent, frames: v.getVideoPlaybackQuality().totalVideoFrames };
    }, id);
    const sourceDetails = Object.fromEntries(await Promise.all(ids.map(async id => [id, await readSource(id)])));
    for (const id of ids) { assert.ok(sourceDetails[id].time > starts[id] + duration * .6); assert.equal(sourceDetails[id].srcObject, false); }
    let outputDetail;
    if (output) {
      outputDetail = await output.locator('video').evaluate(v => ({ width: v.videoWidth, height: v.videoHeight,
        time: v.currentTime, paused: v.paused, audioTracks: v.srcObject.getAudioTracks().length, frames: v.getVideoPlaybackQuality().totalVideoFrames }));
      assert.ok(outputDetail.time > outputStart + duration * .6); assert.equal(outputDetail.audioTracks, 1);
      await output.screenshot({ path: path.join(artifacts, `${artifactName}-output.png`) });
      await output.close(); await page.bringToFront();
    }
    await page.screenshot({ path: path.join(artifacts, `${artifactName}-studio.png`), fullPage: true });
    await page.locator('#connection-button').click();
    const connection = JSON.parse(await page.locator('#connection-info').textContent());
    for (const id of ids) assert.equal(connection.sources[id].pending, false);
    assert.equal(connection.audio, 'running'); assert.equal(connection.transport, 'studio-fetch');
    if (blockLiveWorker) assert.equal(await page.evaluate(() => window.liveWorkerRequests), 0);
    assert.deepEqual(errors, []);
    const report = { timestamp: new Date().toISOString(), version: connection.version, browser: context.browser()?.version(), room, headed, autoplay: 'browser-default', observedSeconds: duration,
      secondRoom, blockLiveWorker, connected: true, sources: sourceDetails, output: outputDetail, errors, connection };
    fs.writeFileSync(path.join(artifacts, `${artifactName}-report.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, connection: undefined }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ room, state: await page.evaluate(() => ({
      source: document.querySelector('[data-source-title="A"]').textContent, chat: document.querySelector('[data-danmaku-status="A"]').textContent,
      sync: document.querySelector('#sync-status-A').textContent, toasts: document.querySelector('#toast-region').textContent
    })), failures: failures.slice(-10), errors }, null, 2)); throw error;
  }
} finally { await context.close(); }
