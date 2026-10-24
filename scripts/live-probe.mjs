// Read-only check against a real, public Bilibili room. Uses an isolated browser
// profile and never sends chat messages. Pass the room ID on the command line.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseRoomId } from '../extension/lib/model.js';
const room = parseRoomId(process.argv[2]); if (!room) throw new Error('Usage: node scripts/live-probe.mjs ROOM_ID');
const headed = process.argv.includes('--headed'), checkWatch = process.argv.includes('--watch'), checkOutput = process.argv.includes('--output') || checkWatch;
const checkFullscreen = process.argv.includes('--fullscreen');
const checkOcclusion = process.argv.includes('--occluded');
const viewportOption = process.argv.find(arg => arg.startsWith('--viewport='))?.slice('--viewport='.length);
const viewerViewport = viewportOption?.split('x').map(Number);
if (viewerViewport) assert.ok(viewerViewport.length === 2 && viewerViewport.every(value => Number.isInteger(value) && value >= 320 && value <= 7680), 'Viewport must be WIDTHxHEIGHT');
if (checkFullscreen && !checkWatch) throw new Error('--fullscreen requires --watch');
const secondRoomOption = process.argv.find(arg => arg.startsWith('--second-room='));
const secondRoom = secondRoomOption ? parseRoomId(secondRoomOption.slice('--second-room='.length)) : null;
if (secondRoomOption && !secondRoom) throw new Error('Invalid second room');
const assignments = secondRoom ? [['A', room], ['B', secondRoom]] : [['A', room]];
const blockLiveWorker = process.argv.includes('--block-live-worker');
const artifactName = `live-${assignments.map(([, roomId]) => roomId).join('-')}${checkWatch ? '-watch' : ''}${checkOcclusion ? '-maximized' : ''}`;
const duration = Number(process.argv.find(arg => arg.startsWith('--duration='))?.split('=')[1] || 2);
assert.ok(Number.isFinite(duration) && duration >= 2 && duration <= 600, 'Duration must be 2–600 seconds');
const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : await import('playwright');
const root = fileURLToPath(new URL('../', import.meta.url)), extension = path.join(root, 'extension'), artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(artifacts, 'edge-probe-')), {
  executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: !headed,
  viewport: checkOcclusion ? null : { width: 1600, height: 1180 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  ignoreDefaultArgs: ['--disable-extensions', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
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
      if (checkWatch) { await page.locator('#watch-tab').click(); output = page; }
      else { const opened = context.waitForEvent('page'); await page.locator('#live-output-button').click(); output = await opened; }
      if (viewerViewport) await output.setViewportSize({ width: viewerViewport[0], height: viewerViewport[1] });
      if (output !== page) output.on('pageerror', error => errors.push(error.message));
      await output.waitForFunction(watch => { const v = document.querySelector(watch ? '#watch-video' : 'video'); return (watch ? document.querySelector('#watch-player').classList.contains('direct') && Number(document.querySelector('#watch-canvas').dataset.frames) > 0 : v.videoWidth > 0) && v.currentTime > 0 && !v.paused; }, checkWatch);
      outputStart = await output.locator(checkWatch ? '#watch-video' : 'video').evaluate(v => v.currentTime);
    }
    const samples = [];
    const inspectMotion = () => output.evaluate(async () => {
      const { drawLiveSources } = await import('./lib/live-surface.js');
      const scene = (await chrome.storage.local.get('fusion-scene-v1'))['fusion-scene-v1'];
      const sources = Object.fromEntries(['A', 'B'].map(id => [id, { video: document.querySelector('#video-' + id), player: { connected: true } }]));
      const sample = document.createElement('canvas'); sample.width = 48; sample.height = 27;
      const ctx = sample.getContext('2d', { willReadFrequently: true }); let previous, changed = 0;
      for (let i = 0; i < 25; i++) {
        drawLiveSources(ctx, scene, sources, 48, 27); const data = ctx.getImageData(0, 0, 48, 27).data;
        if (previous && data.some((value, j) => value !== previous[j])) changed++;
        previous = data; await new Promise(resolve => setTimeout(resolve, 100));
      }
      return { comparisons: 24, changed, fullscreen: Boolean(document.fullscreenElement) };
    });
    const snapshot = () => output.evaluate(() => { const v = document.querySelector('#watch-video') || document.querySelector('video'), canvas = document.querySelector('#watch-canvas'), sourceDocument = window.opener?.document || document; return {
      timestamp: performance.now(), fullscreen: Boolean(document.fullscreenElement), visibility: document.visibilityState, studioVisibility: sourceDocument.visibilityState,
      frames: Number(canvas?.dataset.frames || v.getVideoPlaybackQuality().totalVideoFrames),
      width: canvas?.width || v.videoWidth, height: canvas?.height || v.videoHeight, audioTime: v.currentTime,
      comments: document.querySelectorAll('.watch-comment').length,
      sources: ['A', 'B'].map(id => { const source = sourceDocument.querySelector(`#video-${id}`); return { id, frames: source.getVideoPlaybackQuality().totalVideoFrames, presented: Number(source.closest('.watch-source')?.dataset.frames || 0), time: source.currentTime, dropped: source.getVideoPlaybackQuality().droppedVideoFrames }; })
    }; });
    if (checkOcclusion) {
      const watchSession = await context.newCDPSession(output);
      const watchWindow = await watchSession.send('Browser.getWindowForTarget');
      if (output !== page) { const studioSession = await context.newCDPSession(page), studioWindow = await studioSession.send('Browser.getWindowForTarget'); await studioSession.send('Browser.setWindowBounds', { windowId: studioWindow.windowId, bounds: { windowState: 'minimized' } }); }
      await watchSession.send('Browser.setWindowBounds', { windowId: watchWindow.windowId, bounds: { windowState: 'maximized' } });
      await output.bringToFront();
    }
    if (checkFullscreen) { await output.locator('#watch-fullscreen').click(); await output.waitForFunction(() => Boolean(document.fullscreenElement)); }
    const until = Date.now() + duration * 1000;
    if (output) samples.push(await snapshot());
    while (Date.now() < until) {
      await page.waitForTimeout(Math.min(15000, until - Date.now()));
      if (output) { samples.push(await snapshot()); console.log(JSON.stringify({ observation: samples.at(-1) })); fs.writeFileSync(path.join(artifacts, `${artifactName}-samples.json`), JSON.stringify(samples, null, 2)); }
    }
    const fullscreenMotion = checkFullscreen ? await inspectMotion() : undefined;
    if (fullscreenMotion) { console.log(JSON.stringify({ fullscreenMotion })); assert.ok(fullscreenMotion.changed > 8, 'Fullscreen live source pixels must change'); }
    if (checkFullscreen) {
      await output.locator('#watch-fullscreen').click(); await output.waitForFunction(() => !document.fullscreenElement);
      samples.push(await snapshot()); await output.waitForTimeout(10000); samples.push(await snapshot());
      const fullscreenSamples = samples.filter(sample => sample.fullscreen);
      for (let i = 1; i < fullscreenSamples.length; i++) { const previous = fullscreenSamples[i - 1], sample = fullscreenSamples[i];
        const fps = (sample.frames - previous.frames) * 1000 / (sample.timestamp - previous.timestamp);
        assert.ok(fps > 15, `Fullscreen source frames must keep advancing: ${fps.toFixed(1)} callbacks/second`);
      }
    }
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
      outputDetail = await output.locator(checkWatch ? '#watch-video' : 'video').evaluate(v => { const canvas = document.querySelector('#watch-canvas'); return { width: canvas?.width || v.videoWidth, height: canvas?.height || v.videoHeight,
        time: v.currentTime, paused: v.paused, audioTracks: v.srcObject.getAudioTracks().length, frames: Number(canvas?.dataset.frames || v.getVideoPlaybackQuality().totalVideoFrames),
        direct: document.querySelector('#watch-player')?.classList.contains('direct'), videoTracks: v.srcObject.getVideoTracks().length }; });
      assert.ok(outputDetail.time > outputStart + duration * .6); assert.equal(outputDetail.audioTracks, 1);
      if (checkWatch) {
        outputDetail.motion = await inspectMotion(); outputDetail.fullscreenMotion = fullscreenMotion;
        console.log(JSON.stringify({ motion: outputDetail.motion }));
        assert.ok(outputDetail.motion.changed > 8, 'Live source pixels must change independently of frame callback counts');
        outputDetail.comments = await output.locator('.watch-comment').count();
        outputDetail.footer = await output.locator('#watch-send-form').isVisible(); assert.equal(outputDetail.footer, true);
        if (outputDetail.comments) {
          const comment = output.locator('.watch-comment').first(); await comment.focus();
          assert.equal(await comment.evaluate(el => el.getAnimations()[0].playState), 'paused');
          outputDetail.interaction = await comment.getByRole('button', { name: '复制弹幕', exact: true }).isVisible(); assert.equal(outputDetail.interaction, true);
        }
      }
      await output.screenshot({ path: path.join(artifacts, `${artifactName}-output.png`) });
      if (checkWatch) { assert.equal(output, page); await page.locator('#studio-tab').click(); }
      else { await output.close(); await page.bringToFront(); }
    }
    await page.screenshot({ path: path.join(artifacts, `${artifactName}-studio.png`), fullPage: true });
    await page.locator('#connection-button').click();
    const connection = JSON.parse(await page.locator('#connection-info').textContent());
    for (const id of ids) assert.equal(connection.sources[id].pending, false);
    assert.equal(connection.audio, 'running'); assert.equal(connection.transport, 'studio-fetch');
    if (blockLiveWorker) assert.equal(await page.evaluate(() => window.liveWorkerRequests), 0);
    assert.deepEqual(errors, []);
    const report = { timestamp: new Date().toISOString(), version: connection.version, browser: context.browser()?.version(), room, headed, autoplay: 'browser-default', observedSeconds: duration,
      secondRoom, checkWatch, checkFullscreen, checkOcclusion, samples, blockLiveWorker, connected: true, sources: sourceDetails, output: outputDetail, errors, connection };
    fs.writeFileSync(path.join(artifacts, `${artifactName}-report.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, connection: undefined }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ room, state: await page.evaluate(() => ({
      source: document.querySelector('[data-source-title="A"]').textContent, chat: document.querySelector('[data-danmaku-status="A"]').textContent,
      sync: document.querySelector('#sync-status-A').textContent, toasts: document.querySelector('#toast-region').textContent
    })), failures: failures.slice(-10), errors }, null, 2)); throw error;
  }
} finally { await context.close(); }
