import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/page-embed.js', import.meta.url), 'utf8');
function fixture() {
  const listeners = new Map(), channels = [], lifecycle = [], timers = new Map();
  let onMessage, frame, timer = 0;
  const host = { tagName: 'DIV', isConnected: true, setAttribute() {}, removeAttribute() {} };
  const video = { clientWidth: 1280, clientHeight: 720, getBoundingClientRect: () => ({ width: 1280, height: 720 }), closest: () => host };
  const window = { addEventListener(name, callback) { listeners.set(name, callback); }, postMessage() {} };
  class Port {
    constructor() { this.sent = []; }
    postMessage(data, transfer) { assert.equal(transfer, undefined, 'No media objects transfer between page and extension'); this.sent.push(structuredClone(data)); }
    start() {} close() { this.closed = true; }
  }
  class Channel { constructor() { this.port1 = new Port(); this.port2 = new Port(); channels.push(this); } }
  const context = { window, location: { pathname: '/6', origin: 'https://live.bilibili.com' }, MessageChannel: Channel,
    setTimeout(callback) { timers.set(++timer, callback); return timer; }, clearTimeout(id) { timers.delete(id); }, setInterval() { return 99; }, clearInterval() {},
    chrome: { runtime: { id: 'fixture', getURL: path => 'chrome-extension://fixture/' + path, getManifest: () => ({ version: '0.3.12' }),
      sendMessage(data) { lifecycle.push(data.active); return Promise.resolve(); }, onMessage: { addListener(callback) { onMessage = callback; } } } },
    document: { querySelectorAll: () => [video], documentElement: { append() {} }, createElement() {
      frame = { isConnected: true, style: {}, setAttribute() {}, remove() { this.isConnected = false; }, contentWindow: { postMessage() {} } }; return frame;
    } }
  };
  vm.runInNewContext(source, context);
  const request = message => { let response; onMessage(message, { id: 'fixture', url: 'chrome-extension://fixture/launcher.html' }, value => { response = value; }); return response; };
  return { lifecycle, timers, request, get frame() { return frame; },
    apply() {
      const token = '12345678-1234-1234-1234-123456789abc';
      assert.equal(request({ type: 'FUSION_EMBED_APPLY', token }).ok, true);
      listeners.get('message')({ source: frame.contentWindow, origin: 'chrome-extension://fixture', data: { type: 'BILI_FUSION_PROCESSOR_READY', token } });
    },
    get native() { return channels.at(-2).port1; }, get producer() { return channels.at(-1).port1; },
    status() { return request({ type: 'FUSION_EMBED_STATUS' }); }
  };
}

test('page relay exchanges connection metadata and preserves native playback reporting', () => {
  const f = fixture(); f.apply();
  for (const data of [{ type: 'ready' }, { type: 'answer', sdp: 'answer' }, { type: 'candidate', candidate: { candidate: 'native' } }]) f.native.onmessage({ data });
  assert.deepEqual(f.producer.sent.map(data => data.type), ['ready', 'answer', 'candidate']);
  for (const data of [{ type: 'offer', sdp: 'offer' }, { type: 'candidate', candidate: { candidate: 'producer' } }, { type: 'stream-ready' }]) f.producer.onmessage({ data });
  assert.deepEqual(f.native.sent.map(data => data.type), ['offer', 'candidate', 'stream-ready']);
  f.native.onmessage({ data: { type: 'attached' } });
  assert.equal(f.status().status, 'playing'); assert.equal(f.timers.size, 0); assert.deepEqual(f.lifecycle, [true]);
});

test('actual playback state wins over attached and audio status updates', () => {
  const f = fixture(); f.apply(); f.native.onmessage({ data: { type: 'attached' } });
  f.native.onmessage({ data: { type: 'playback-state', state: 'paused', text: '融合直播已暂停' } });
  f.producer.onmessage({ data: { type: 'state', text: '融合直播已暂停', audioNeeded: false } });
  assert.equal(f.status().status, 'paused');
  f.native.onmessage({ data: { type: 'playback-state', state: 'playing', text: '融合直播正在播放' } });
  assert.equal(f.status().status, 'playing');
  f.native.onmessage({ data: { type: 'play-needed', text: '点击播放' } });
  f.producer.onmessage({ data: { type: 'state', text: '点击播放' } });
  assert.equal(f.status().status, 'blocked');
});

test('waiting for a playback click keeps the connected session available past the startup deadline', () => {
  const f = fixture(); f.apply();
  assert.equal(f.timers.size, 1);
  f.native.onmessage({ data: { type: 'play-needed', text: '点击播放' } });
  assert.equal(f.timers.size, 0); assert.equal(f.status().status, 'blocked');
  assert.equal(f.native.sent.some(data => data.type === 'failed'), false);
  f.native.onmessage({ data: { type: 'attached' } });
  assert.equal(f.status().status, 'playing');
});

test('playback diagnostics expose source ownership and frame counters without connection tokens', () => {
  const f = fixture(); f.apply();
  const native = { sourceMatches: true, blocked: { src: 5 }, frames: 45 };
  const producer = { compositor: { frames: 46, sources: { A: { frames: 44 } } } };
  f.native.onmessage({ data: { type: 'native-health', data: native } });
  f.producer.onmessage({ data: { type: 'producer-health', data: producer } });
  assert.deepEqual(structuredClone(f.status().diagnostics), { version: '0.3.12', status: 'connecting', native, producer });
  assert.equal(f.native.sent.length, 0); assert.equal(f.producer.sent.length, 0);
});

test('producer failure restores native live once and blocks late media status while keeping restore usable', () => {
  const f = fixture(); f.apply(); f.native.onmessage({ data: { type: 'attached' } });
  f.producer.onmessage({ data: { type: 'state', error: true, text: 'stream failed' } });
  assert.deepEqual(f.native.sent, [{ type: 'failed' }]); assert.equal(f.status().status, 'error');
  f.native.onmessage({ data: { type: 'attached' } });
  f.producer.onmessage({ data: { type: 'state', text: 'late ready' } });
  f.producer.onmessage({ data: { type: 'stream-ready' } });
  assert.equal(f.status().text, 'stream failed'); assert.equal(f.native.sent.length, 1);
  f.producer.onmessage({ data: { type: 'close' } });
  assert.equal(f.frame.isConnected, false); assert.equal(f.status().active, false);
  f.apply(); assert.equal(f.status().status, 'connecting');
});

test('connection timeout stops both endpoints and native errors cannot overwrite each other', () => {
  const f = fixture(); f.apply(); [...f.timers.values()][0]();
  assert.deepEqual(f.native.sent, [{ type: 'failed' }]); assert.equal(f.producer.sent[0].type, 'error');
  assert.equal(f.status().status, 'error'); assert.equal(f.timers.size, 0);
  f.native.onmessage({ data: { type: 'error', text: 'late error' } });
  assert.match(f.status().text, /连接超时/);
  f.request({ type: 'FUSION_EMBED_RESTORE' }); assert.equal(f.status().active, false);
});
