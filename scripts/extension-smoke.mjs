import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : await import('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const extension = path.join(root, 'extension'), artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const profile = fs.mkdtempSync(path.join(artifacts, 'edge-extension-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'],
  ignoreDefaultArgs: ['--disable-extensions']
});
const errors = [];
try {
  const fixture = `<!doctype html><html lang="zh-CN"><title>集成测试直播间</title><body><h1>集成测试直播间</h1><video style="width:640px;height:360px"></video><div id="chat-items"><div class="chat-item danmaku-item" data-danmaku="历史弹幕" data-uid="1"><span class="user-name">老观众</span><span class="danmaku-content">历史弹幕</span></div></div><div class="chat-control-panel"><div class="chat-input-ctnr"><textarea maxlength="30"></textarea><button id="mock-send">发送</button></div></div></body></html>`;
  await context.route('https://live.bilibili.com/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const studio = await context.newPage(); studio.on('pageerror', error => errors.push(error.message));
  await studio.goto(`chrome-extension://${extensionId}/studio.html`); await studio.locator('#room-A').fill('12345');
  const roomPromise = context.waitForEvent('page'); await studio.locator('[data-open="A"]').click(); const room = await roomPromise;
  await room.waitForURL('https://live.bilibili.com/12345');
  // Extension-created tabs can navigate before Playwright attaches its request
  // interception. Navigate again after attachment to use the local fixture.
  await room.goto('https://live.bilibili.com/12345?integration=1');
  await room.locator('#mock-send').waitFor();
  await room.evaluate(() => { globalThis.mockSubmissions = []; const button = document.querySelector('#mock-send'); button.disabled = true; document.querySelector('textarea').addEventListener('input', event => { button.disabled = !event.target.value; }); button.addEventListener('click', () => globalThis.mockSubmissions.push(document.querySelector('textarea').value)); });
  await studio.bringToFront(); await studio.locator('#refresh-rooms').click();
  await studio.waitForFunction(() => document.querySelector('#tab-A').value !== '');
  const tabId = Number(await studio.locator('#tab-A').inputValue());
  const state = await studio.evaluate(async id => chrome.runtime.sendMessage({ type: 'ROOM_COMMAND', tabId: id, command: { type: 'GET_STATE' } }), tabId);
  assert.equal(state.ok, true); assert.equal(state.data.ok, true); assert.equal(state.data.data.roomId, '12345'); assert.equal(state.data.data.hasChat, true); assert.ok(state.data.data.videoRect.width > 100);
  console.log('PASS unpacked MV3 extension loads with service worker and content script');
  assert.equal(await studio.locator('#danmaku-feed').textContent().then(t => t.includes('历史弹幕')), false);
  await room.evaluate(() => { const el = document.createElement('div'); el.className = 'chat-item danmaku-item'; el.dataset.danmaku = '来自真实内容脚本的弹幕'; el.dataset.uid = '42'; const user = document.createElement('span'); user.className = 'user-name'; user.textContent = '测试观众'; el.append(user); document.querySelector('#chat-items').append(el); });
  await studio.waitForFunction(() => document.querySelector('#danmaku-feed').textContent.includes('来自真实内容脚本的弹幕'));
  console.log('PASS fresh room DOM comments route to the bound studio source; history is excluded');
  await studio.locator('#send-text').fill('工作台发送集成测试'); await studio.locator('#send-form button').click();
  await room.waitForFunction(() => globalThis.mockSubmissions.length === 1);
  assert.deepEqual(await room.evaluate(() => globalThis.mockSubmissions), ['工作台发送集成测试']);
  await studio.locator('#send-text').fill('第二条'); await studio.locator('#send-form button').click();
  await studio.waitForFunction(() => document.querySelector('#toast-region').textContent.includes('5 秒'));
  assert.equal(await room.evaluate(() => globalThis.mockSubmissions.length), 1);
  console.log('PASS real extension messaging submits into the linked page and enforces cooldown');
  const invalid = await studio.evaluate(async () => chrome.runtime.sendMessage({ type: 'OPEN_ROOM', roomId: 'https://evil.com/' }));
  assert.equal(invalid.ok, false);
  const unknown = await studio.evaluate(async id => chrome.runtime.sendMessage({ type: 'ROOM_COMMAND', tabId: id, command: { type: 'DELETE_DATA' } }), tabId);
  assert.equal(unknown.ok, false);
  await studio.locator('#auto-crop').click();
  await studio.waitForFunction(() => Number(document.querySelector('#crop-w').value) < 100);
  console.log('PASS room validation, command allowlist and live player crop detection');
  assert.deepEqual(errors, []);
  await studio.screenshot({ path: path.join(artifacts, 'extension-integration.png'), fullPage: true });
  console.log(JSON.stringify({ passed: 4, extensionId, errors }, null, 2));
} finally { await context.close(); }
