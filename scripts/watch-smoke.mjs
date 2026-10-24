import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : await import('playwright');
const root = fileURLToPath(new URL('../', import.meta.url)), artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
const page = await context.newPage(), errors = [], results = [];
context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
page.on('pageerror', error => errors.push(error.message));
const check = async (name, action) => { await action(); results.push(name); console.log(`PASS ${name}`); };
let watch;
async function studioSend(text, source = 'A') {
  await page.locator('#send-target').selectOption(source); await page.locator('#send-text').fill(text); await page.locator('#send-form button').click();
}
async function visibleComment(text) {
    const comment = watch.locator('.watch-comment').filter({ has: watch.locator('.comment-text', { hasText: text }) }).first();
  await comment.waitFor();
  await watch.waitForFunction(text => { const el = [...document.querySelectorAll('.watch-comment')].find(el => el.dataset.text === text); if (!el) return false; const r = el.getBoundingClientRect(), layer = document.querySelector('#watch-danmaku').getBoundingClientRect(); return r.x > layer.x + 50 && r.right < layer.right - 25; }, text);
  return comment;
}
try {
  await page.goto('http://127.0.0.1:4173/'); await page.locator('#demo-button').click();
  await page.waitForFunction(() => document.querySelector('#source-count').textContent === '2 / 2 已接入');
  await page.locator('#filter-button').click(); await page.locator('label').filter({ has: page.locator('#filter-dedupe') }).click(); await page.locator('#apply-filter').click();
  await check('watch page receives advancing live video and mixed audio', async () => {
    const opened = page.waitForEvent('popup'); await page.locator('#watch-button').click(); watch = await opened;
    await watch.waitForFunction(() => document.querySelector('#watch-video')?.videoWidth === 1920 && document.querySelector('#watch-state').hidden);
    assert.match(watch.url(), /watch\.html#/);
    assert.equal(await watch.locator('#watch-video').evaluate(v => v.srcObject.getAudioTracks().length), 1);
    const before = await watch.locator('#watch-video').evaluate(v => v.currentTime);
    await watch.waitForFunction(t => document.querySelector('#watch-video').currentTime > t + 1, before);
    assert.equal(await watch.locator('.watch-footer').isVisible(), true);
  });
  await check('footer sends literal text to selected B source and clears input', async () => {
    await watch.locator('#watch-send-target').selectOption('B');
    await watch.locator('#watch-send-text').fill('<b>观看页发送</b>'); await watch.locator('#watch-send').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.danmaku-row.b')].some(el => el.textContent.includes('<b>观看页发送</b>')));
    await watch.waitForFunction(() => document.querySelector('#watch-send-text').value === '');
    assert.equal(await watch.locator('.watch-comment b').count(), 0);
  });
  await check('hover freezes one comment while video continues; copy keeps original text', async () => {
    await studioSend('悬停复制这条弹幕');
    const comment = await visibleComment('悬停复制这条弹幕'); await comment.hover({ force: true });
    await watch.waitForFunction(() => [...document.querySelectorAll('.watch-comment')].some(el => el.dataset.text === '悬停复制这条弹幕' && el.getAnimations()[0]?.playState === 'paused'));
    const x = (await comment.boundingBox()).x, time = await watch.locator('#watch-video').evaluate(v => v.currentTime);
    await watch.waitForTimeout(700); assert.ok(Math.abs((await comment.boundingBox()).x - x) < 1);
    assert.ok(await watch.locator('#watch-video').evaluate(v => v.currentTime) > time + .3);
    await comment.getByRole('button', { name: '复制弹幕', exact: true }).click();
    assert.equal(await watch.evaluate(() => navigator.clipboard.readText()), '悬停复制这条弹幕');
    await watch.locator('#watch-send-text').click(); await watch.mouse.move(1, 1);
    await watch.waitForFunction(() => [...document.querySelectorAll('.watch-comment')].some(el => el.dataset.text === '悬停复制这条弹幕' && el.getAnimations()[0]?.playState === 'running'));
  });
  await check('+1 sends original text to its source, independently of footer target', async () => {
    await studioSend('加一发回原房间', 'A'); const comment = await visibleComment('加一发回原房间');
    await watch.locator('#watch-send-target').selectOption('B'); await comment.hover({ force: true });
    await watch.waitForFunction(() => [...document.querySelectorAll('.watch-comment')].some(el => el.dataset.text === '加一发回原房间' && el.matches(':hover') && el.getAnimations()[0]?.playState === 'paused'));
    await comment.getByRole('button', { name: '+1 发送到 A', exact: true }).click();
    await watch.waitForFunction(() => document.querySelector('#watch-notice').textContent.includes('已向 A 发送'));
    assert.equal(await page.locator('.danmaku-row.a').filter({ hasText: '加一发回原房间' }).count(), 2);
    assert.equal(await page.locator('.danmaku-row.b').filter({ hasText: '加一发回原房间' }).count(), 0);
    await watch.locator('#watch-send-text').click();
  });
  await check('fullscreen contains footer and supports sending before exit', async () => {
    await watch.locator('#watch-fullscreen').click();
    await watch.waitForFunction(() => document.fullscreenElement?.id === 'watch-player');
    assert.equal(await watch.locator('#watch-send-form').isVisible(), true);
    await watch.locator('#watch-send-target').selectOption('both'); await watch.locator('#watch-send-text').fill('全屏一起看');
    await watch.locator('#watch-send-text').press('Enter');
    await page.waitForFunction(() => ['a', 'b'].every(id => [...document.querySelectorAll(`.danmaku-row.${id}`)].some(el => el.textContent.includes('全屏一起看'))));
    await watch.locator('#watch-fullscreen').click(); await watch.waitForFunction(() => !document.fullscreenElement);
    await watch.locator('#watch-video').dblclick(); await watch.waitForFunction(() => Boolean(document.fullscreenElement));
    await watch.locator('#watch-fullscreen').click();
  });
  await check('playback, audio, volume and viewer-only danmaku controls work', async () => {
    await watch.locator('#watch-play').click(); assert.equal(await watch.locator('#watch-video').evaluate(v => v.paused), true);
    await watch.locator('#watch-play').click(); await watch.waitForFunction(() => !document.querySelector('#watch-video').paused);
    await watch.locator('#watch-audio').click(); assert.equal(await watch.locator('#watch-video').evaluate(v => v.muted), false);
    await watch.locator('#watch-volume').fill('35'); assert.equal(await watch.locator('#watch-video').evaluate(v => v.volume), .35);
    await watch.locator('#watch-toggle-danmaku').click(); assert.equal(await watch.locator('#watch-danmaku').isVisible(), false);
    assert.equal(await page.locator('#danmaku-toggle').isChecked(), true);
    await watch.locator('#watch-toggle-danmaku').click();
    await watch.locator('#watch-send-text').fill('😀'.repeat(31)); assert.equal(await watch.locator('#watch-send').isDisabled(), true);
    assert.equal(await watch.locator('#watch-text-count').textContent(), '31/30');
    await watch.locator('#watch-send-text').fill('长'.repeat(31)); assert.equal(await watch.locator('#watch-send').isDisabled(), true);
    await watch.locator('#watch-send-text').fill('');
  });
  await check('studio filter, visibility and clears propagate to watch page', async () => {
    await page.locator('#filter-button').click(); await page.locator('#filter-keywords').fill('过滤内容'); await page.locator('#apply-filter').click();
    await studioSend('过滤内容不进入观看'); await studioSend('保留内容进入观看', 'B');
    await watch.waitForFunction(() => [...document.querySelectorAll('.watch-comment')].some(el => el.dataset.text === '保留内容进入观看'));
    assert.equal(await watch.locator('.watch-comment').filter({ hasText: '过滤内容' }).count(), 0);
    await page.locator('label').filter({ has: page.locator('#danmaku-toggle') }).click(); await watch.waitForFunction(() => document.querySelector('#watch-danmaku').hidden);
    await page.locator('label').filter({ has: page.locator('#danmaku-toggle') }).click(); await watch.waitForFunction(() => !document.querySelector('#watch-danmaku').hidden);
    await page.locator('#filter-button').click(); await page.locator('#clear-danmaku').click(); await watch.waitForFunction(() => !document.querySelector('.watch-comment'));
    await page.locator('#filter-dialog .close-dialog').click();
  });
  await check('keyboard interaction keeps action buttons within picture edges', async () => {
    await studioSend('边缘弹幕操作'); const comment = await visibleComment('边缘弹幕操作');
    await comment.focus();
    await comment.evaluate(el => { el.getAnimations()[0].currentTime = el.getAnimations()[0].effect.getTiming().duration * .99; el.dispatchEvent(new FocusEvent('focusin')); });
    const actions = await comment.locator('.comment-actions').boundingBox(), layer = await watch.locator('#watch-danmaku').boundingBox();
    assert.ok(actions.x >= layer.x - 1); assert.ok(actions.x + actions.width <= layer.x + layer.width + 1);
    await comment.getByRole('button', { name: '复制弹幕', exact: true }).click();
    assert.equal(await watch.evaluate(() => navigator.clipboard.readText()), '边缘弹幕操作');
    await watch.locator('#watch-send-text').click();
  });
  await check('control auto-hide retains footer; responsive letterbox matches video', async () => {
    await watch.locator('#watch-send-text').click(); await watch.mouse.move(1, 1);
    await watch.waitForFunction(() => document.querySelector('#watch-player').classList.contains('quiet'));
    assert.equal(await watch.locator('.watch-footer').isVisible(), true);
    await watch.setViewportSize({ width: 390, height: 844 }); await watch.waitForTimeout(150);
    assert.equal(await watch.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const rect = await watch.locator('#watch-danmaku').boundingBox(); assert.ok(Math.abs(rect.width / rect.height - 16 / 9) < .02);
    await watch.screenshot({ path: path.join(artifacts, 'watch-mobile.png') });
    await watch.setViewportSize({ width: 1200, height: 780 }); await watch.mouse.move(200, 100);
    await studioSend('一起看，两路现场', 'B'); const comment = await visibleComment('一起看，两路现场'); await comment.hover({ force: true });
    await watch.screenshot({ path: path.join(artifacts, 'watch-hover.png') });
  });
  await check('retry replaces peer; unavailable source and studio closure remain actionable', async () => {
    await watch.locator('#watch-retry').evaluate(button => button.click());
    await watch.waitForFunction(() => document.querySelector('#watch-state').hidden && document.querySelector('#watch-video').readyState >= 2);
    await page.locator('[data-disconnect="B"]').click();
    await watch.waitForFunction(() => document.querySelector('#watch-send-target option[value="B"]').disabled);
    await page.close(); await watch.waitForFunction(() => document.querySelector('#watch-state h1').textContent === '工作台已关闭');
    assert.equal(await watch.locator('#watch-send').isDisabled(), true);
  });
  assert.deepEqual(errors, []); fs.writeFileSync(path.join(artifacts, 'watch-report.json'), JSON.stringify({ passed: results.length, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: results.length, results, errors }, null, 2));
} catch (error) {
  if (watch && !watch.isClosed()) {
    await watch.screenshot({ path: path.join(artifacts, 'watch-failed.png') });
    console.error(JSON.stringify(await watch.evaluate(() => ({ errors: document.querySelector('#watch-notice').textContent, comments: [...document.querySelectorAll('.watch-comment')].map(el => ({ text: el.dataset.text, hover: el.matches(':hover'), focused: el.contains(document.activeElement), animation: el.getAnimations()[0]?.playState, html: el.outerHTML })) })), null, 2));
  }
  throw error;
} finally { await browser.close(); }
