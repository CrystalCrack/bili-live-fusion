import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/native-player.js', import.meta.url), 'utf8');
function fixture() {
  const listeners = new Map(), messages = [], tracks = [];
  let current, observer;
  class Media {
    constructor() { this.object = null; this.position = 18; this.paused = false; this.volume = .7; this.muted = false; this.isConnected = true; this.loads = 0; this.clientWidth = 1280; this.clientHeight = 720; }
    get srcObject() { return this.object; } set srcObject(value) { this.object = value; }
    get currentTime() { return this.position; } set currentTime(value) { this.position = value; }
    load() { this.loads++; }
    addEventListener() {} removeEventListener() {}
    async play() { this.paused = false; } pause() { this.paused = true; }
  }
  const original = new Media(); current = original;
  const location = { origin: 'https://live.bilibili.com' };
  const window = { addEventListener(name, callback) { listeners.set(name, callback); } };
  const port = { postMessage(data) { messages.push(data); }, start() {}, close() { this.closed = true; } };
  const context = { window, location, HTMLMediaElement: Media,
    MediaStreamTrackGenerator: class { constructor({ kind }) { this.kind = kind; this.writable = {}; tracks.push(this); } stop() { this.stopped = true; } },
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() {} },
    document: { documentElement: {}, querySelector() { return { querySelectorAll() { return [current]; } }; } }
  };
  vm.runInNewContext(source, context);
  const start = () => listeners.get('message')({ source: window, origin: location.origin, ports: [port], data: { type: 'BILI_FUSION_NATIVE_INIT', token: '12345678-1234-1234-1234-123456789abc' } });
  return { Media, original, messages, tracks, port, start, ready() { port.onmessage({ data: { type: 'stream-ready' } }); }, replace(video) { current = video; observer(); } };
}

test('native stream binds to the existing video and keeps its controls and volume', async () => {
  const f = fixture(), video = f.original;
  f.start(); assert.equal(video.srcObject, null, 'Keep original live until fusion frames arrive');
  assert.equal(f.messages[0].type, 'sinks');
  f.ready(); const stream = video.srcObject;
  assert.equal(stream.getTracks().length, 2); assert.equal(video.volume, .7); assert.equal(video.muted, false);
  video.pause(); assert.equal(video.paused, true); await video.play(); assert.equal(video.paused, false);
  video.volume = .25; video.muted = true;
  video.srcObject = null; video.load(); video.currentTime = 99;
  assert.equal(video.srcObject, stream); assert.equal(video.loads, 0); assert.equal(video.currentTime, 18);
  f.port.onmessage({ data: { type: 'close' } });
  assert.equal(video.srcObject, null); assert.equal(video.loads, 1);
  assert.equal(video.volume, .25); assert.equal(video.muted, true); assert.ok(f.tracks.every(track => track.stopped));
  video.currentTime = 22; assert.equal(video.currentTime, 22);
  assert.equal(Object.hasOwn(video, 'srcObject'), false); assert.equal(Object.hasOwn(video, 'load'), false);
});

test('native player replacement rebinds the same fusion stream and restores both elements', () => {
  const f = fixture(); f.start(); f.ready();
  const stream = f.original.srcObject, next = new f.Media(); next.paused = true;
  f.replace(next);
  assert.equal(f.original.srcObject, null); assert.equal(next.srcObject, stream); assert.equal(next.paused, true);
  f.port.onmessage({ data: { type: 'close' } }); assert.equal(next.srcObject, null); assert.equal(next.paused, true);
});
