import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { packet } from '../extension/lib/danmaku.js';

const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : await import('playwright');
const root = fileURLToPath(new URL('../', import.meta.url)), extension = path.join(root, 'extension');
const artifacts = path.join(root, 'artifacts'), media = path.join(artifacts, 'live-fixtures'); fs.mkdirSync(media, { recursive: true });
for (const quality of [250, 80]) {
  const directory = path.join(media, String(quality)); fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(path.join(directory, 'segment-034.ts'))) execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${quality === 250 ? '640x360' : '320x180'}:rate=24`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '70', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-g', '48', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '64k', '-f', 'hls', '-hls_time', '2',
    '-hls_list_size', '0', '-hls_segment_filename', path.join(directory, 'segment-%03d.ts'), path.join(directory, 'fixture.m3u8')
  ], { stdio: 'pipe' });
}
const flvFile = path.join(media, 'fixture.flv');
if (!fs.existsSync(flvFile)) execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-i', path.join(media, '250', 'fixture.m3u8'), '-t', '35', '-c', 'copy', '-f', 'flv', flvFile], { stdio: 'pipe' });
const profile = fs.mkdtempSync(path.join(artifacts, 'edge-live-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true,
  viewport: { width: 1600, height: 1180 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'],
  ignoreDefaultArgs: ['--disable-extensions']
});
const errors = [], requests = [], sockets = new Map(); let worker, page;
const epoch = Date.now() - 12000;
try {
  await context.route('https://api.bilibili.com/**', async route => {
    const url = new URL(route.request().url());
    let body = { code: 0, data: {} };
    if (url.pathname.endsWith('/nav')) body.data = { isLogin: false, wbi_img: {
      img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } };
    else if (url.pathname.endsWith('/spi')) body.data = { b_3: 'test-buvid' };
    else throw new Error(`Unexpected API request: ${url.pathname}`);
    await route.fulfill({ json: body });
  });
  await context.route('https://api.live.bilibili.com/**', async route => {
    const url = new URL(route.request().url()), roomId = url.searchParams.get('room_id') || url.searchParams.get('id'); requests.push(url);
    if (url.pathname.endsWith('getDanmuInfo')) {
      assert.ok(url.searchParams.get('w_rid')); await route.fulfill({ json: { code: 0, data: { token: 'fixture-token', host_list: [{ host: 'fixture.chat.bilibili.com', wss_port: 443 }] } } }); return;
    }
    if (!url.pathname.endsWith('getRoomPlayInfo')) throw new Error(`Unexpected API request: ${url.pathname}`);
    const quality = Number(url.searchParams.get('qn')) === 80 ? 80 : 250;
    const flv = roomId === '99999';
    await route.fulfill({ json: { code: 0, data: { room_id: Number(roomId), live_status: 1, playurl_info: { playurl: {
      g_qn_desc: [{ qn: 250, desc: '超清' }, { qn: 80, desc: '流畅' }], stream: [{ protocol_name: flv ? 'http_stream' : 'http_hls', format: [{ format_name: flv ? 'flv' : 'ts', codec: [{
        codec_name: 'avc', current_qn: quality, accept_qn: [250, 80], base_url: flv ? '/250/fixture.flv' : `/${quality}/index.m3u8`,
        url_info: [{ host: 'https://fixture.bilivideo.com', extra: '' }]
      }] }] }] } } } } });
  });
  await context.route('https://fixture.bilivideo.com/**', async route => {
    const url = new URL(route.request().url()), [quality, file] = url.pathname.slice(1).split('/');
    if (file === 'index.m3u8') {
      const count = Math.min(34, Math.floor((Date.now() - epoch) / 2000)), first = Math.max(0, count - 20);
      let playlist = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${first}\n`;
      for (let i = first; i < count; i++) playlist += `#EXT-X-PROGRAM-DATE-TIME:${new Date(epoch + i * 2000).toISOString()}\n#EXTINF:2.000,\nsegment-${String(i).padStart(3, '0')}.ts\n`;
      await route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: playlist });
    } else if (file === 'fixture.flv') { await route.fulfill({ contentType: 'video/x-flv', path: flvFile }); }
    else { assert.match(file, /^segment-\d{3}\.ts$/); await route.fulfill({ contentType: 'video/mp2t', path: path.join(media, quality, file) }); }
  });
  await context.routeWebSocket(/^wss:\/\/fixture\.chat\.bilibili\.com(?::443)?\/sub$/, ws => {
    let room;
    ws.onMessage(message => {
      const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : new Uint8Array(message);
      const operation = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8);
      if (operation === 7) {
        const auth = JSON.parse(new TextDecoder().decode(bytes.slice(16))); assert.equal(auth.protover, 2); room = String(auth.roomid); sockets.set(room, ws);
        ws.send(Buffer.from(packet(8, '{"code":0}'))); ws.send(Buffer.from(packet(5, deflateSync(packet(5, JSON.stringify({ cmd: 'DANMU_MSG', info: [[], `房间 ${room} 的实时弹幕`, [42, '测试观众']] }), 0)), 2)));
      } else if (operation === 2) ws.send(Buffer.from(packet(3, new Uint8Array([0, 0, 0, 1]))));
    });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/studio.html`);
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = () => { throw new Error('Screen capture must not be called for direct live sources'); };
    window.testPlayers = new Map(); const attach = Hls.prototype.attachMedia;
    Hls.prototype.attachMedia = function(video) { window.testPlayers.set(video.id, this); return attach.call(this, video); };
  });
  for (const [id, room] of [['A', '12345'], ['B', '67890']]) { await page.locator(`#room-${id}`).fill(room); await page.locator(`[data-connect="${id}"]`).click(); }
  await page.waitForFunction(() => ['A', 'B'].every(id => { const v = document.querySelector(`#video-${id}`); return v.readyState >= 2 && v.currentTime > 0 && !v.paused; }), { timeout: 30000 });
  assert.equal(await page.locator('#source-count').textContent(), '2 / 2 已接入');
  assert.equal(context.pages().some(tab => tab.url().startsWith('https://live.bilibili.com/')), false);
  assert.equal(await page.evaluate(() => document.querySelector('#video-A').srcObject), null);
  await page.waitForFunction(() => document.querySelector('#db-A').textContent !== '−∞ dB');
  console.log('PASS direct HLS playback and Web Audio mixing with no screen sharing or room tabs');
  await page.waitForFunction(() => document.querySelector('#danmaku-feed').textContent.includes('房间 12345') && document.querySelector('#danmaku-feed').textContent.includes('房间 67890'));
  assert.ok(await page.locator('[data-danmaku-status="A"]').textContent().then(text => text.includes('已连接')));
  console.log('PASS direct WebSocket authentication and compressed room danmaku reach both sources');
  await page.locator('#sync-delay-A').fill('2000'); await page.locator('#sync-delay-A').press('Tab');
  await page.waitForFunction(() => { const a = document.querySelector('#video-A'), b = document.querySelector('#video-B'); return Math.abs((b.currentTime - a.currentTime) - 2) < .35; });
  const first = await page.locator('#video-A').evaluate(video => video.currentTime); await page.waitForTimeout(1200);
  const later = await page.locator('#video-A').evaluate(video => video.currentTime); assert.ok(later - first > .7, `Playback must advance: ${first} -> ${later}`);
  console.log('PASS 2000ms whole-source AV delay and advancing synchronized playback');
  await page.locator('#quality-A').selectOption('80');
  await page.waitForFunction(() => document.querySelector('#video-A').videoWidth === 320 && !document.querySelector('#video-A').paused);
  assert.equal(await page.locator('#video-B').evaluate(video => video.videoWidth), 640);
  assert.equal(await page.locator('[data-quality-status="A"]').textContent(), '当前：流畅');
  await page.waitForFunction(() => { const a = window.testPlayers.get('video-A')?.playingDate, b = window.testPlayers.get('video-B')?.playingDate;
    return a && b && Math.abs((b.getTime() - a.getTime()) - 2000) < 400; });
  console.log('PASS per-room quality changes actual decoder resolution and preserves whole-source alignment');
  await page.locator('#filter-button').click(); await page.locator('#filter-keywords').fill('屏蔽词'); await page.locator('#apply-filter').click();
  sockets.get('12345').send(Buffer.from(packet(5, JSON.stringify({ cmd: 'DANMU_MSG', info: [[], '屏蔽词消息', [45, '观众']] }), 0)));
  sockets.get('67890').send(Buffer.from(packet(5, JSON.stringify({ cmd: 'DANMU_MSG', info: [[], '过滤后正常显示', [46, '观众']] }), 0)));
  await page.waitForFunction(() => document.querySelector('#danmaku-feed').textContent.includes('过滤后正常显示'));
  assert.equal(await page.locator('#danmaku-feed').textContent().then(text => text.includes('屏蔽词消息')), false);
  const priorSocket = sockets.get('12345'); priorSocket.close({ code: 1011, reason: 'Fixture reconnection' });
  await page.waitForFunction(() => document.querySelector('[data-danmaku-status="A"]').textContent.includes('重连'));
  await page.waitForFunction(() => document.querySelector('[data-danmaku-status="A"]').textContent.includes('已连接'));
  assert.notEqual(sockets.get('12345'), priorSocket);
  console.log('PASS keyword filtering and automatic danmaku reconnection');
  const outputOpened = context.waitForEvent('page'); await page.locator('#live-output-button').click(); const output = await outputOpened;
  await output.waitForFunction(() => document.querySelector('video')?.videoWidth === 1920);
  const outputTime = await output.locator('video').evaluate(video => video.currentTime); await output.waitForTimeout(1200);
  assert.ok(await output.locator('video').evaluate(video => video.currentTime) > outputTime + .5);
  assert.equal(await output.locator('video').evaluate(video => video.srcObject.getAudioTracks().length), 1);
  console.log('PASS continuous real-time composed output with video and mixed audio');
  await output.close(); await page.bringToFront();
  await page.locator('#open-crop-editor').click(); await page.locator('#crop-dialog').waitFor({ state: 'visible' }); await page.locator('#crop-apply').click();
  console.log('PASS visual crop editor accepts a decoded direct-live source');
  await page.locator('#room-B').fill('99999'); await page.locator('[data-connect="B"]').click();
  await page.waitForFunction(() => { const v = document.querySelector('#video-B'); return v.videoWidth === 640 && v.currentTime > 0 && !v.paused && document.querySelector('[data-source-title="B"]').textContent.includes('FLV'); });
  await page.waitForFunction(() => document.querySelector('#db-B').textContent !== '−∞ dB');
  const flvStart = await page.locator('#video-B').evaluate(v => v.currentTime); await page.waitForTimeout(1200);
  assert.ok(await page.locator('#video-B').evaluate(v => v.currentTime) > flvStart + .5);
  console.log('PASS HTTP-FLV direct decoder, live timeline and mixed audio');
  await page.screenshot({ path: path.join(artifacts, 'direct-live-integration.png'), fullPage: true });
  await page.locator('[data-disconnect="A"]').click(); await page.locator('[data-disconnect="B"]').click();
  assert.equal(await page.locator('#source-count').textContent(), '0 / 2 已接入'); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: 9, errors, playRequests: requests.filter(url => url.pathname.endsWith('getRoomPlayInfo')).length }, null, 2));
} catch (error) {
  if (page) { console.error(await page.evaluate(() => ({ toasts: document.querySelector('#toast-region')?.textContent,
    sources: [...document.querySelectorAll('[data-source-title]')].map(el => el.textContent), danmaku: [...document.querySelectorAll('[data-danmaku-status]')].map(el => el.textContent),
    videos: [...document.querySelectorAll('.source-thumbnail video')].map(v => ({ ready: v.readyState, time: v.currentTime, paused: v.paused, error: v.error?.message, ranges: Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)]) })) }))); }
  throw error;
} finally { await context.close(); }
