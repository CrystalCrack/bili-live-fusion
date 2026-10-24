import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : await import('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const executablePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1180 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const check = async (name, action) => { await action(); results.push(name); console.log(`PASS ${name}`); };
try {
  await page.goto('http://127.0.0.1:4173/');
  await check('studio initializes with both source controls', async () => {
    await page.locator('#source-count').waitFor();
    assert.equal(await page.locator('#source-count').textContent(), '0 / 2 已接入');
    assert.equal(await page.locator('.audio-track').count(), 2);
    assert.equal(await page.locator('#empty-stage').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, 'studio-initial.png'), fullPage: true });
  });
  await check('demo connects two actual video/audio streams', async () => {
    await page.locator('#demo-button').click();
    await page.waitForFunction(() => document.querySelector('#source-count').textContent === '2 / 2 已接入');
    await page.waitForFunction(() => ['A', 'B'].every(id => { const v = document.querySelector(`#video-${id}`); return v.readyState >= 2 && v.srcObject.getAudioTracks().length === 1; }));
    await page.waitForFunction(() => document.querySelector('#db-A').textContent !== '−∞ dB');
    assert.equal(await page.locator('#empty-stage').isVisible(), false);
    await page.screenshot({ path: path.join(artifacts, 'studio-demo.png'), fullPage: true });
  });
  await check('presets, drag, resize, crop and volume controls update scene', async () => {
    await page.locator('[data-preset="pip"]').click();
    const stage = await page.locator('#canvas-stage').boundingBox();
    await page.mouse.click(stage.x + stage.width * .82, stage.y + stage.height * .80);
    assert.equal(await page.locator('#inspector-badge').textContent(), 'B');
    assert.equal(await page.locator('#position-x').inputValue(), '68');
    const box = await page.locator('#selection-box').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 50, box.y + box.height / 2 - 30, { steps: 5 }); await page.mouse.up();
    assert.ok(Number(await page.locator('#position-x').inputValue()) < 68);
    await page.locator('#crop-x').fill('10'); await page.locator('#crop-x').press('Tab');
    assert.equal(await page.locator('#crop-w').inputValue(), '90');
    await page.locator('#volume-A').fill('45');
    assert.equal(await page.locator('#volume-value-A').textContent(), '45%');
    await page.locator('#voice-B').check();
    await page.locator('#pan-B').fill('-25'); await page.locator('#pan-B').press('Tab');
    await page.locator('#delay-B').fill('130'); await page.locator('#delay-B').press('Tab');
    await page.locator('#audio-mode [data-mode="a"]').click();
    await page.waitForFunction(() => document.querySelector('#db-B').textContent === '−∞ dB');
    await page.locator('#audio-mode [data-mode="both"]').click();
    await page.locator('#crop-reset').click(); await page.locator('[data-preset="split"]').click();
  });
  await check('visual crop editor applies a live source region', async () => {
    await page.locator('#open-crop-editor').click(); await page.locator('#crop-dialog').waitFor({ state: 'visible' });
    const handle = await page.locator('[data-crop-handle="se"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2 - 2, handle.y + handle.height / 2 - 2);
    await page.mouse.down(); await page.mouse.move(handle.x - 100, handle.y - 60, { steps: 5 }); await page.mouse.up();
    await page.locator('#crop-apply').click();
    assert.ok(Number(await page.locator('#crop-w').inputValue()) < 99);
    assert.ok(Number(await page.locator('#crop-h').inputValue()) < 99);
    await page.locator('#crop-reset').click();
  });
  await check('danmaku submission, filter validation and filter application', async () => {
    await page.locator('#send-text').fill('<script>安全文本</script>'); await page.locator('#send-form button').click();
    await page.waitForFunction(() => document.querySelector('#danmaku-feed').textContent.includes('<script>安全文本</script>'));
    assert.equal(await page.locator('#danmaku-feed script').count(), 0);
    await page.locator('#filter-button').click(); await page.locator('#filter-regex').fill('(a+)+$'); await page.locator('#apply-filter').click();
    assert.ok((await page.locator('#regex-error').textContent()).length > 0);
    await page.locator('#filter-regex').fill(''); await page.locator('#filter-keywords').fill('屏蔽词'); await page.locator('#apply-filter').click();
    assert.equal(await page.locator('#filter-dialog').isVisible(), false);
    await page.locator('#send-text').fill('这是屏蔽词消息'); await page.locator('#send-form button').click();
    assert.equal(await page.locator('#danmaku-feed').textContent().then(t => t.includes('这是屏蔽词消息')), false);
    await page.locator('#send-text').fill('浏览器测试弹幕'); await page.locator('#send-form button').click();
    await page.waitForFunction(() => document.querySelector('#danmaku-feed').textContent.includes('浏览器测试弹幕'));
  });
  await check('output receives live composed video and mixed audio over local WebRTC', async () => {
    const outputPromise = page.waitForEvent('popup'); await page.locator('#output-button').click(); const output = await outputPromise;
    output.on('pageerror', error => errors.push(`output: ${error.message}`));
    await output.waitForFunction(() => { const v = document.querySelector('#output-video'); return v?.readyState >= 2 && v.videoWidth === 1920 && v.srcObject?.getAudioTracks().length === 1; }, null, { timeout: 25000 });
    const initialFrames = await output.locator('#output-video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames);
    await output.waitForFunction(count => document.querySelector('#output-video').getVideoPlaybackQuality().totalVideoFrames > count + 5, initialFrames);
    await page.locator('[data-preset="pip"]').click();
    await output.waitForFunction(count => document.querySelector('#output-video').getVideoPlaybackQuality().totalVideoFrames > count + 10, initialFrames);
    assert.equal(await output.locator('#output-state').isVisible(), false);
    await output.locator('#output-audio').click(); assert.equal(await output.locator('#output-video').evaluate(v => v.muted), false);
    await output.screenshot({ path: path.join(artifacts, 'output.png') }); await output.close();
    await page.locator('[data-preset="split"]').click();
  });
  await check('recording creates a playable WebM with video and audio', async () => {
    await page.bringToFront(); await page.locator('#record-button').click();
    await page.waitForFunction(() => document.querySelector('#record-dot').classList.contains('recording'));
    await page.waitForFunction(() => document.querySelector('#record-timer').textContent >= '00:02');
    assert.equal(await page.locator('#resolution').isDisabled(), true);
    await page.locator('#record-button').click(); await page.locator('#record-download').waitFor({ state: 'visible' });
    const details = await page.evaluate(async () => {
      const response = await fetch(document.querySelector('#record-download').href); const blob = await response.blob();
      const video = document.createElement('video'); video.muted = true; video.src = URL.createObjectURL(blob); document.body.append(video);
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
      const result = { size: blob.size, type: blob.type, width: video.videoWidth, height: video.videoHeight }; URL.revokeObjectURL(video.src); video.remove(); return result;
    });
    assert.ok(details.size > 20000); assert.equal(details.width, 1920); assert.equal(details.height, 1080); assert.match(details.type, /video\/webm/);
    const downloadPromise = page.waitForEvent('download'); await page.locator('#record-download').click(); const download = await downloadPromise; await download.saveAs(path.join(artifacts, 'recording-test.webm'));
    assert.equal(await page.locator('#resolution').isDisabled(), false);
  });
  await check('snapshot and scene export produce local files', async () => {
    const pngPromise = page.waitForEvent('download'); await page.locator('#snapshot-button').click(); const png = await pngPromise; await png.saveAs(path.join(artifacts, 'snapshot-test.png'));
    assert.ok(fs.statSync(path.join(artifacts, 'snapshot-test.png')).size > 1000);
    await page.locator('#scene-button').click(); await page.locator('#scene-name').fill('测试融合场景');
    const jsonPromise = page.waitForEvent('download'); await page.locator('#export-scene').click(); const json = await jsonPromise; await json.saveAs(path.join(artifacts, 'scene-test.json'));
    const scene = JSON.parse(fs.readFileSync(path.join(artifacts, 'scene-test.json'), 'utf8'));
    assert.equal(scene.name, '测试融合场景'); assert.equal(scene.sources.A.volume, 45); assert.equal(scene.sources.B.voice, true);
    await page.locator('#scene-dialog .close-dialog').click();
  });
  await check('settings persist after reload without reauthorizing streams', async () => {
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('已保存'));
    await page.reload(); await page.waitForFunction(() => document.querySelector('#volume-A')?.value === '45');
    assert.equal(await page.locator('#voice-B').isChecked(), true); assert.equal(await page.locator('#source-count').textContent(), '0 / 2 已接入');
  });
  await check('narrow layout stays inside viewport', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, 'studio-mobile.png'), fullPage: true });
  });
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: results.length, errors, results }, null, 2));
} finally { await browser.close(); }
