import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : await import('playwright');
const root = fileURLToPath(new URL('../', import.meta.url)), artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage(), errors = [], results = [];
context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
page.on('pageerror', error => errors.push(error.message));
const check = async (name, action) => { const result = await action(); results.push({ name, result }); console.log('PASS ' + name + ' ' + JSON.stringify(result ?? {})); };
try {
  await page.goto('http://127.0.0.1:4173'); await page.locator('#demo-button').click();
  await page.waitForFunction(() => document.querySelector('#source-count').textContent.includes('2 / 2'));
  await page.locator('[data-preset=a]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fusion-scene-v1') || 'null')?.layout === 'a');
  await page.locator('#watch-button').click(); const watch = page;
  await watch.waitForFunction(() => document.querySelector('#watch-state').hidden && Number(document.querySelector('#watch-canvas').dataset.frames) > 10);
  await check('viewer shares source decoders without encoded video', async () => {
    assert.equal(await watch.locator('#watch-player').evaluate(el => el.classList.contains('direct')), true);
    assert.equal(await watch.locator('#watch-video').evaluate(el => el.srcObject.getVideoTracks().length), 0);
    return { audioTracks: await watch.locator('#watch-video').evaluate(el => el.srcObject.getAudioTracks().length) };
  });
  await watch.setViewportSize({ width: 640, height: 500 });
  await watch.waitForFunction(() => document.querySelector('#watch-canvas').width === (640 - document.querySelector('.rail').getBoundingClientRect().width) * 2);
  await check('single source freeze pixels equal direct decoder draw', async () => {
    await watch.locator('#video-A').evaluate(v => v.pause());
    await watch.locator('#watch-play').click();
    const result = await watch.evaluate(async () => {
    const { drawGeometry } = await import('./lib/model.js');
    const actual = document.querySelector('#watch-canvas'), source = document.querySelector('#video-A');
    const scene = JSON.parse(localStorage.getItem('fusion-scene-v1'));
    const expected = document.createElement('canvas'); expected.width = actual.width; expected.height = actual.height;
    const ctx = expected.getContext('2d', { alpha: false }); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, ...drawGeometry(scene.sources.A, source.videoWidth, source.videoHeight, actual.width, actual.height));
    const a = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data, b = ctx.getImageData(0, 0, actual.width, actual.height).data;
    let changed = 0, maximum = 0; for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); if (delta) changed++; maximum = Math.max(maximum, delta); }
    if (changed) throw new Error('Pixel mismatch: ' + changed + ' channels, max ' + maximum);
    return { width: actual.width, height: actual.height, changedChannels: changed, maximumChannelDelta: maximum };
    });
    await watch.locator('#video-A').evaluate(v => v.play()); await watch.locator('#watch-play').click(); return result;
  });
  await check('fullscreen directly presents source frames at physical display resolution', async () => {
    await watch.setViewportSize({ width: 1920, height: 1240 }); await watch.locator('#watch-fullscreen').click();
    await watch.waitForFunction(() => document.fullscreenElement && document.querySelector('#watch-canvas').width === 3840);
    const read = () => watch.locator('#watch-canvas').evaluate(el => ({ width: el.width, height: el.height, frames: Number(el.dataset.frames) }));
    const before = await read(); await watch.waitForTimeout(6000); const after = await read();
    assert.equal(after.height, 2160); assert.ok(after.frames - before.frames > 90);
    assert.equal(await watch.locator('#watch-canvas').isVisible(), false);
    assert.equal(await watch.locator('#video-A').isVisible(), true);
    await watch.screenshot({ path: path.join(artifacts, 'watch-hidpi-fullscreen.png') });
    await watch.locator('#watch-fullscreen').click();
    await watch.locator('#watch-send-text').fill('自己发的弹幕使用金色'); await watch.locator('#watch-send').click();
    await watch.waitForFunction(() => { const comment = document.querySelector('.watch-comment.self'); if (!comment) return false; const rect = comment.getBoundingClientRect(), layer = document.querySelector('#watch-danmaku').getBoundingClientRect(); return rect.right < layer.right - 30 && rect.left > layer.left; });
    await watch.locator('.watch-comment.self').focus(); await watch.screenshot({ path: path.join(artifacts, 'watch-self-color.png') });
    return { ...after, framesInSixSeconds: after.frames - before.frames };
  });
  await check('direct video clipping matches preview in contain, cover and stretch', async () => {
    for (const fit of ['contain', 'cover', 'stretch']) {
      await page.locator('#studio-tab').click();
      for (const [key, value] of Object.entries({ x: 20, y: 10, w: 55, h: 70 })) { const input = page.locator('#crop-' + key); await input.fill(String(value)); await input.dispatchEvent('change'); }
      await page.locator('#source-fit').selectOption(fit);
      await page.waitForFunction(fit => { const source = JSON.parse(localStorage.getItem('fusion-scene-v1'))?.sources.A; return source?.fit === fit && source.crop.x === 20 && source.crop.y === 10 && source.crop.w === 55 && source.crop.h === 70; }, fit);
      await page.locator('#watch-tab').click();
      await page.evaluate(async () => {
        const { drawGeometry } = await import('./lib/model.js'), scene = JSON.parse(localStorage.getItem('fusion-scene-v1'));
        const layer = document.querySelector('#watch-decoders'), wrapper = layer.querySelector('[data-layer=A]'), clip = wrapper.querySelector('.watch-crop'), video = document.querySelector('#video-A');
        const [sx, sy, sw, sh, dx, dy, dw, dh] = drawGeometry(scene.sources.A, video.videoWidth, video.videoHeight, layer.clientWidth, layer.clientHeight);
        const r = clip.getBoundingClientRect(), parent = layer.getBoundingClientRect(), v = video.getBoundingClientRect();
        const close = (a, b) => { if (Math.abs(a - b) > 1) throw new Error('Video crop geometry mismatch: ' + a + ' vs ' + b); };
        close(r.x - parent.x, dx); close(r.y - parent.y, dy); close(r.width, dw); close(r.height, dh);
        close(v.x - r.x, -sx * dw / sw); close(v.y - r.y, -sy * dh / sh);
        if (getComputedStyle(clip).overflow !== 'hidden') throw new Error('Crop must clip source pixels');
      });
    }
    return { fitModes: 3, crop: '20%,10%,55%,70%' };
  });
  await check('studio output resolution does not downscale viewer', async () => {
    await page.locator('#studio-tab').click(); await page.locator('#resolution').selectOption('720p'); await page.locator('#watch-tab').click(); await watch.waitForTimeout(150);
    assert.ok(await watch.locator('#watch-canvas').evaluate(el => el.width) > 3000);
    await page.locator('#studio-tab').click(); await page.locator('[data-preset=stacked]').click(); await page.locator('#resolution').selectOption('portrait'); await page.locator('#watch-tab').click();
    await watch.waitForFunction(() => { const c = document.querySelector('#watch-canvas'); return Math.abs(c.width / c.height - 9 / 16) < .002; });
    return await watch.locator('#watch-canvas').evaluate(el => ({ width: el.width, height: el.height }));
  });
  assert.deepEqual(errors, []); fs.writeFileSync(path.join(artifacts, 'render-report.json'), JSON.stringify({ passed: results.length, results, errors }, null, 2));
} finally { await browser.close(); }
