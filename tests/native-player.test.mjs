import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/native-player.js', import.meta.url), 'utf8');
function fixture() {
  const listeners = new Map(), messages = [], tracks = [];
  let current, observer, peer; const timers = new Map(); let timer = 0;
  class Element extends EventTarget {
    constructor() { super(); this.attributes = new Map(); }
    getAttribute(name) { return this.attributes.get(String(name).toLowerCase()) ?? null; }
    hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }
    setAttribute(name, value) { name = String(name).toLowerCase(); this.attributes.set(name, String(value)); if (name === 'src') { this.object = null; this.loads++; } }
    removeAttribute(name) { name = String(name).toLowerCase(); this.attributes.delete(name); if (name === 'src') { this.object = null; this.loads++; } }
    setAttributeNS(namespace, name, value) { this.setAttribute(name, value); }
    removeAttributeNS(namespace, name) { this.removeAttribute(name); }
  }
  class Media extends Element {
    constructor() { super(); this.object = null; this.position = 18; this.rate = 1; this.paused = false; this.volume = .7; this.muted = false; this.isConnected = true; this.loads = 0; this.clientWidth = 1280; this.clientHeight = 720; this.readyState = 4; this.videoWidth = 1920; this.videoHeight = 1080; this.attributes.set('src', 'blob:original'); }
    get srcObject() { return this.object; } set srcObject(value) { this.object = value; }
    get src() { return this.getAttribute('src') || ''; } set src(value) { this.attributes.set('src', String(value)); this.object = null; this.loads++; }
    get currentTime() { return this.position; } set currentTime(value) { this.position = value; }
    get playbackRate() { return this.rate; } set playbackRate(value) { this.rate = value; }
    load() { this.loads++; }
    async play() { this.paused = false; } pause() { this.paused = true; }
  }
  class Peer {
    constructor(config) { peer = this; this.config = config; this.candidates = []; }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async createAnswer() { return { type: 'answer', sdp: 'local-answer' }; }
    async setLocalDescription(description) { this.localDescription = description; }
    async addIceCandidate(candidate) { this.candidates.push(candidate); }
    close() { this.closed = true; }
  }
  const original = new Media(); current = original;
  const location = { origin: 'https://live.bilibili.com' };
  const window = { addEventListener(name, callback) { listeners.set(name, callback); } };
  const port = { postMessage(data, transfer) { assert.equal(transfer, undefined); messages.push(structuredClone(data)); }, start() {}, close() { this.closed = true; } };
  const context = { window, location, HTMLMediaElement: Media, Element, RTCPeerConnection: Peer,
    setInterval(callback) { timers.set(++timer, callback); return timer; }, clearInterval(id) { timers.delete(id); },
    MediaStream: class { constructor() { this.tracks = []; } addTrack(track) { this.tracks.push(track); } getTracks() { return this.tracks; } getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); } },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() { this.disconnected = true; } },
    document: { querySelector() { return { contains(video) { return video === current; }, querySelectorAll() { return [current]; } }; } }
  };
  vm.runInNewContext(source, context);
  const start = () => listeners.get('message')({ source: window, origin: location.origin, ports: [port], data: { type: 'BILI_FUSION_NATIVE_INIT', token: '12345678-1234-1234-1234-123456789abc' } });
  const receive = data => port.onmessage({ data });
  return { Media, Element, original, messages, tracks, port, start, receive, timers, get peer() { return peer; },
    ready() { receive({ type: 'stream-ready' }); },
    track(kind, muted = false) { const track = new EventTarget(); Object.assign(track, { kind, muted, stop() { this.stopped = true; } }); tracks.push(track); peer.ontrack({ track }); return track; },
    replace(video) { current = video; observer(); }
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('native playback exchanges only cloneable SDP/ICE and waits for a live video track', async () => {
  const f = fixture(); f.start();
  assert.equal(f.messages[0].type, 'ready'); assert.equal(f.peer.config.iceServers.length, 0);
  f.receive({ type: 'candidate', candidate: { candidate: 'early' } }); await flush();
  assert.equal(f.peer.candidates.length, 0);
  f.receive({ type: 'offer', sdp: 'producer-offer' }); await flush();
  assert.equal(f.peer.remoteDescription.sdp, 'producer-offer');
  assert.equal(f.peer.candidates[0].candidate, 'early');
  assert.deepEqual(f.messages.at(-1), { type: 'answer', sdp: 'local-answer' });
  f.peer.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'local' }) } });
  assert.deepEqual(f.messages.at(-1), { type: 'candidate', candidate: { candidate: 'local' } });
  f.ready(); f.track('audio'); const track = f.track('video', true);
  assert.equal(f.original.srcObject, null, 'Keep original live until a received video frame is available');
  track.muted = false; track.dispatchEvent(new Event('unmute'));
  assert.equal(f.original.srcObject.getTracks().length, 2);
  f.original.dispatchEvent(new Event('loadeddata')); assert.equal(f.messages.at(-1).type, 'attached');
});

test('native stream preserves playback controls and restores the original video exactly once', async () => {
  const f = fixture(), video = f.original;
  f.start(); f.track('video'); f.track('audio'); f.ready(); const stream = video.srcObject;
  assert.equal(stream.getTracks().length, 2); assert.equal(video.volume, .7); assert.equal(video.muted, false);
  video.pause(); assert.equal(video.paused, true); await video.play(); assert.equal(video.paused, false);
  video.volume = .25; video.muted = true;
  video.srcObject = null; video.load(); video.currentTime = 99; video.playbackRate = 1.2;
  assert.equal(video.srcObject, stream); assert.equal(video.loads, 0); assert.equal(video.currentTime, 18);
  f.receive({ type: 'close' }); f.receive({ type: 'close' });
  assert.equal(video.srcObject, null); assert.equal(video.loads, 1); assert.equal(f.peer.closed, true);
  assert.equal(video.playbackRate, 1.2); assert.equal(f.timers.size, 0);
  assert.equal(video.volume, .25); assert.equal(video.muted, true); assert.ok(f.tracks.every(track => track.stopped));
  video.currentTime = 22; assert.equal(video.currentTime, 22);
  for (const name of ['srcObject', 'src', 'load', 'currentTime', 'playbackRate']) assert.equal(Object.hasOwn(video, name), false);
});

test('site source resets and cached prototype operations cannot restart the fused video', () => {
  const f = fixture();
  const src = Object.getOwnPropertyDescriptor(f.Media.prototype, 'src').set;
  const object = Object.getOwnPropertyDescriptor(f.Media.prototype, 'srcObject').set;
  const cachedSet = f.Element.prototype.setAttribute, cachedLoad = f.Media.prototype.load;
  const untouched = new f.Media(); untouched.src = 'blob:other'; assert.equal(untouched.loads, 1);
  f.start(); f.ready(); f.track('video'); const video = f.original, stream = video.srcObject;
  video.src = 'blob:restart-1'; video.setAttribute('SRC', 'blob:restart-2'); video.removeAttribute('src');
  video.setAttributeNS(null, 'src', 'blob:restart-3'); video.removeAttributeNS(null, 'src');
  src.call(video, 'blob:restart-4'); cachedSet.call(video, 'src', 'blob:latest'); cachedLoad.call(video); object.call(video, null);
  assert.equal(video.srcObject, stream); assert.equal(video.src, 'blob:original'); assert.equal(video.loads, 0);
  [...f.timers.values()][0](); const health = f.messages.at(-1);
  assert.equal(health.type, 'native-health'); assert.equal(health.data.sourceMatches, true);
  assert.equal(health.data.blocked.src, 7); assert.equal(health.data.blocked.load, 1); assert.equal(health.data.blocked.srcObject, 1);
  video.pause(); f.receive({ type: 'close' });
  assert.equal(video.srcObject, null); assert.equal(video.src, 'blob:latest'); assert.equal(video.paused, true);
  assert.equal(Object.hasOwn(video, 'src'), false);
  video.src = 'blob:after'; assert.equal(video.src, 'blob:after');
});

test('native player replacement rebinds the same fusion stream and restores both elements', () => {
  const f = fixture(); f.start(); f.ready(); f.track('video');
  const stream = f.original.srcObject, next = new f.Media(); next.paused = true;
  f.replace(next);
  assert.equal(f.original.srcObject, null); assert.equal(next.srcObject, stream); assert.equal(next.paused, true);
  f.receive({ type: 'close' }); assert.equal(next.srcObject, null); assert.equal(next.paused, true);
});

test('transport failure restores the original stream and ignores late tracks and readiness', () => {
  const f = fixture(); f.start(); f.ready(); f.track('video');
  f.peer.connectionState = 'failed'; f.peer.onconnectionstatechange(); f.peer.onconnectionstatechange();
  assert.equal(f.original.srcObject, null); assert.equal(f.original.loads, 1);
  assert.equal(f.messages.filter(message => message.type === 'error').length, 1);
  f.ready(); const late = f.track('video'); f.replace(f.original);
  assert.equal(late.stopped, true); assert.equal(f.original.srcObject, null);
  f.receive({ type: 'close' }); assert.equal(f.port.closed, true); assert.equal(f.original.loads, 1);
});
