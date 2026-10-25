import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/native-player.js', import.meta.url), 'utf8');
function fixture() {
  const listeners = new Map(), messages = [], tracks = [], children = [], timers = new Map();
  let current, observer, peer, output, playError = null, timer = 0;
  class Style {
    constructor() { this.values = new Map(); }
    getPropertyValue(name) { return this.values.get(name)?.value || ''; }
    getPropertyPriority(name) { return this.values.get(name)?.priority || ''; }
    setProperty(name, value, priority = '') { this.values.set(name, { value, priority }); }
    removeProperty(name) { this.values.delete(name); }
  }
  const parent = {};
  class Element extends EventTarget {
    constructor() { super(); this.attributes = new Map(); this.style = new Style(); this.isConnected = false; }
    getAttribute(name) { return this.attributes.get(String(name).toLowerCase()) ?? null; }
    hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }
    setAttribute(name, value) { name = String(name).toLowerCase(); this.attributes.set(name, String(value)); if (name === 'src') { this.object = null; this.loads++; } }
    removeAttribute(name) { name = String(name).toLowerCase(); this.attributes.delete(name); if (name === 'src') { this.object = null; this.loads++; } }
    setAttributeNS(namespace, name, value) { this.setAttribute(name, value); }
    removeAttributeNS(namespace, name) { this.removeAttribute(name); }
    after(video) { video.remove(); children.splice(children.indexOf(this) + 1, 0, video); video.parentElement = this.parentElement; video.isConnected = true; }
    remove() { const i = children.indexOf(this); if (i >= 0) children.splice(i, 1); this.parentElement = null; this.isConnected = false; }
  }
  class Media extends Element {
    constructor() { super(); this.object = null; this.position = 18; this.rate = 1; this.paused = false; this.nativeVolume = .7; this.nativeMuted = false; this.loads = 0; this.clientWidth = 1280; this.clientHeight = 720; this.readyState = 4; this.videoWidth = 1920; this.videoHeight = 1080; this.attributes.set('src', 'blob:original'); this.callbacks = new Map(); this.callbackId = 0; this.frameCount = 0; }
    get srcObject() { return this.object; } set srcObject(value) { this.object = value; }
    get src() { return this.getAttribute('src') || ''; } set src(value) { this.attributes.set('src', String(value)); this.object = null; this.loads++; }
    get currentTime() { return this.position; } set currentTime(value) { this.position = value; }
    get playbackRate() { return this.rate; } set playbackRate(value) { this.rate = value; }
    get volume() { return this.nativeVolume; } set volume(value) { if (value < 0 || value > 1) throw new RangeError('volume'); this.nativeVolume = Number(value); }
    get muted() { return this.nativeMuted; } set muted(value) { this.nativeMuted = Boolean(value); }
    load() { this.loads++; }
    async play() { this.playCalls = (this.playCalls || 0) + 1; if (playError && this === output) throw playError; this.paused = false; }
    pause() { this.paused = true; }
    cloneNode() { output = new Media(); output.attributes = new Map(this.attributes); output.style.values = new Map(this.style.values); output.paused = true; output.position = 0; output.loads = 0; return output; }
    requestVideoFrameCallback(callback) { this.callbacks.set(++this.callbackId, callback); return this.callbackId; }
    cancelVideoFrameCallback(id) { this.callbacks.delete(id); }
    getVideoPlaybackQuality() { return { totalVideoFrames: this.frameCount }; }
  }
  class Peer {
    constructor(config) { peer = this; this.config = config; this.candidates = []; }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async createAnswer() { return { type: 'answer', sdp: 'local-answer' }; }
    async setLocalDescription(description) { this.localDescription = description; }
    async addIceCandidate(candidate) { this.candidates.push(candidate); }
    close() { this.closed = true; }
  }
  const original = new Media(); current = original; original.isConnected = true; original.parentElement = parent; children.push(original);
  const location = { origin: 'https://live.bilibili.com' };
  const host = new Element(); host.contains = video => video.isConnected && children.includes(video); host.querySelectorAll = () => [...children];
  const player = { getVideoEl: () => current, getPlayerInfo: () => ({ playingStatus: !current.paused, quality: '10000' }), play() { if (current.paused) return current.play(); }, pause() { current.pause(); } };
  const window = { livePlayer: player, addEventListener(name, callback) { listeners.set(name, callback); } };
  const port = { postMessage(data, transfer) { assert.equal(transfer, undefined); messages.push(structuredClone(data)); }, start() {}, close() { this.closed = true; } };
  const nativePause = Media.prototype.pause;
  const context = { window, location, Event, HTMLMediaElement: Media, Element, RTCPeerConnection: Peer,
    setInterval(callback) { timers.set(++timer, callback); return timer; }, clearInterval(id) { timers.delete(id); },
    MediaStream: class { constructor() { this.tracks = []; } addTrack(track) { this.tracks.push(track); } getTracks() { return this.tracks; } getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); } },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() { this.disconnected = true; } },
    document: { querySelector() { return host; }, createElement() { return new Element(); }, documentElement: { append() {} } }
  };
  vm.runInNewContext(source, context);
  const receive = data => port.onmessage({ data });
  return { Media, Element, original, messages, tracks, port, timers, children, player, host, get peer() { return peer; }, get output() { return output; },
    start() { listeners.get('message')({ source: window, origin: location.origin, ports: [port], data: { type: 'BILI_FUSION_NATIVE_INIT', token: '12345678-1234-1234-1234-123456789abc' } }); },
    receive, set playError(value) { playError = value; },
    user(action, options = {}) {
      const event = { type: 'click', isTrusted: true, eventPhase: 1, target: current, ...options };
      listeners.get(event.type)(event); event.eventPhase = 3;
      try { return action(); } finally { event.eventPhase = 0; }
    },
    health() { [...timers.values()][0](); return messages.at(-1).data; },
    present(time) { const callbacks = [...output.callbacks.values()]; output.callbacks.clear(); output.position = time; output.frameCount++; for (const callback of callbacks) callback(0, { mediaTime: time }); },
    browserPause() { nativePause.call(output); output.dispatchEvent(new Event('pause')); },
    ready() { receive({ type: 'stream-ready' }); },
    track(kind, muted = false) { const track = new EventTarget(); Object.assign(track, { kind, muted, stop() { this.stopped = true; } }); tracks.push(track); peer.ontrack({ track }); return track; },
    replace(video, clearOutput = false, keepOld = false) { if (!keepOld) current.remove(); if (clearOutput) output?.remove(); current = video; video.parentElement = parent; video.isConnected = true; children.push(video); observer([]); },
    mutate() { observer([]); }
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('fusion presents on an independent media element without detaching the site engine', async () => {
  const f = fixture(); f.original.paused = true;
  f.start(); f.ready(); f.track('video'); await flush();
  assert.notEqual(f.output, f.original); assert.equal(f.output.paused, false);
  assert.equal(f.original.paused, true); assert.equal(f.original.src, 'blob:original'); assert.equal(f.original.loads, 0); assert.equal(f.original.srcObject, null);
  assert.equal(f.original.style.getPropertyValue('visibility'), 'hidden'); assert.equal(f.output.style.getPropertyValue('visibility'), 'visible');
  assert.equal(f.original.nativeMuted, true); assert.equal(f.output.muted, false);
  assert.equal(f.health().mode, 'isolated-media');
});

test('site engine source reloads, synthetic errors and pauses do not interrupt fusion', async () => {
  const f = fixture(); f.start(); f.ready(); f.track('video'); await flush(); const output = f.output, stream = output.srcObject;
  for (let i = 0; i < 5; i++) {
    f.original.src = 'blob:restart-' + i; f.original.load(); f.original.pause();
    f.original.dispatchEvent(new Event('ended')); f.original.dispatchEvent(new Event('error'));
    f.original.currentTime = 0; f.original.playbackRate = 1.2; f.present(i + 1);
  }
  assert.equal(output.srcObject, stream); assert.equal(output.paused, false); assert.equal(output.currentTime, 5);
  assert.equal(f.original.loads, 10); assert.equal(output.loads, 1, 'Only initial clone source removal, no fusion reload');
  const health = f.health(); assert.equal(health.presentedFrames, 5); assert.equal(health.controlBindings, 1); assert.equal(health.outputMounts, 1);
});

test('native playback controls and keyboard gestures drive fusion while engine pauses stay isolated', async () => {
  const f = fixture(); f.start(); f.ready(); f.track('video'); await flush();
  f.original.pause(); assert.equal(f.output.paused, false);
  f.user(() => f.original.pause()); assert.equal(f.output.paused, true); assert.equal(f.health().wantPlaying, false);
  await f.original.play(); assert.equal(f.output.paused, true);
  f.user(() => f.original.play(), { type: 'keydown', code: 'Space', key: ' ' }); await flush();
  assert.equal(f.output.paused, false); assert.equal(f.messages.at(-1).state, 'playing');
});

test('volume and mute use native controls while the hidden original stays physically muted', () => {
  const f = fixture(); f.start(); f.ready(); f.track('video');
  const volume = Object.getOwnPropertyDescriptor(f.Media.prototype, 'volume');
  f.original.volume = .25; assert.equal(f.output.volume, .25); assert.equal(f.original.volume, .25);
  f.original.muted = true; assert.equal(f.output.muted, true);
  f.original.muted = false; assert.equal(f.output.muted, false); assert.equal(f.original.muted, false); assert.equal(f.original.nativeMuted, true);
  volume.set.call(f.original, .4); assert.equal(f.output.volume, .4); assert.equal(volume.get.call(f.original), .4);
  assert.throws(() => { f.original.volume = 2; }, RangeError); assert.equal(f.output.volume, .4);
});

test('public native player controls target fusion even if the old engine skips an already-playing call', async () => {
  const f = fixture(), previousGetVideo = f.player.getVideoEl, previousPlay = f.player.play;
  f.start(); f.ready(); f.track('video'); await flush();
  assert.equal(f.player.getVideoEl(), f.output); assert.equal(f.health().apiBridged, true);
  f.user(() => f.player.pause()); assert.equal(f.output.paused, true);
  assert.equal(f.player.getPlayerInfo().playingStatus, false); assert.equal(f.player.getPlayerInfo().quality, '10000');
  await f.original.play(); assert.equal(f.original.paused, false); assert.equal(f.output.paused, true);
  f.user(() => f.player.play()); await flush(); assert.equal(f.output.paused, false);
  f.receive({ type: 'close' }); assert.equal(f.player.getVideoEl, previousGetVideo); assert.equal(f.player.play, previousPlay);
});

test('repeated site video replacement keeps the same fusion timeline and presentation counters', async () => {
  const f = fixture(); f.start(); f.ready(); f.track('video'); await flush(); const output = f.output, stream = output.srcObject;
  for (let i = 0; i < 4; i++) { f.present(i + 1); f.replace(new f.Media(), true); }
  assert.equal(f.output, output); assert.equal(output.srcObject, stream); assert.equal(output.currentTime, 4);
  assert.equal(output.paused, false); assert.equal(f.children.filter(video => video.hasAttribute('data-bili-fusion-output')).length, 1);
  const health = f.health(); assert.equal(health.controlBindings, 5); assert.equal(health.outputMounts, 5); assert.equal(health.presentedFrames, 4);
});

test('browser pause recovery preserves an explicit user pause across site video replacement', async () => {
  const f = fixture(); f.start(); f.ready(); f.track('video'); await flush();
  f.browserPause(); await flush(); assert.equal(f.output.paused, false);
  f.user(() => f.original.pause()); f.browserPause(); await flush(); assert.equal(f.output.paused, true);
  f.replace(new f.Media(), true); assert.equal(f.health().wantPlaying, false); assert.equal(f.output.paused, true);
});

test('native API selects the new control video even when the old last-frame node remains attached', async () => {
  const f = fixture(); f.start(); f.ready(); f.track('video'); await flush(); const next = new f.Media();
  f.replace(next, false, true); assert.equal(f.original.isConnected, true); assert.equal(f.health().controlBindings, 2);
  next.volume = .2; assert.equal(f.output.volume, .2); assert.equal(next.nativeMuted, true);
  f.user(() => next.pause()); assert.equal(f.output.paused, true);
});

test('fullscreen layout follows native geometry while fusion remains visible and retains its controls', () => {
  const f = fixture(); f.original.style.setProperty('width', '100%'); f.start(); f.ready(); f.track('video');
  f.original.style.setProperty('height', 'calc(100% - 48px)'); f.original.style.setProperty('transform', 'scaleX(-1)'); f.mutate();
  assert.equal(f.output.style.getPropertyValue('height'), 'calc(100% - 48px)');
  assert.equal(f.output.style.getPropertyValue('transform'), 'scaleX(-1)');
  assert.equal(f.output.style.getPropertyValue('visibility'), 'visible'); assert.equal(f.output.style.getPropertyValue('pointer-events'), 'none');
  f.original.volume = .3; f.original.muted = true; f.replace(new f.Media(), true);
  assert.equal(f.output.volume, .3); assert.equal(f.output.muted, true);
});

test('autoplay rejection waits for a native playback gesture without announcing playing', async () => {
  const f = fixture(); f.playError = Object.assign(new Error('gesture needed'), { name: 'NotAllowedError' });
  f.start(); f.ready(); f.track('video'); f.output.dispatchEvent(new Event('loadeddata')); await flush();
  assert.equal(f.messages.some(message => message.type === 'attached'), false); assert.equal(f.messages.at(-1).type, 'play-needed');
  const attempts = f.output.playCalls; f.health(); f.health(); assert.equal(f.output.playCalls, attempts); assert.equal(f.health().playBlocked, true);
  f.playError = null; f.user(() => f.original.play()); await flush();
  assert.equal(f.output.paused, false); assert.ok(f.messages.some(message => message.type === 'attached')); assert.equal(f.messages.at(-1).state, 'playing');
});

test('SDP and ICE stay cloneable and original remains visible until a live video track arrives', async () => {
  const f = fixture(); f.start(); assert.equal(f.messages[0].type, 'ready'); assert.equal(f.peer.config.iceServers.length, 0);
  f.receive({ type: 'candidate', candidate: { candidate: 'early' } }); await flush(); assert.equal(f.peer.candidates.length, 0);
  f.receive({ type: 'offer', sdp: 'producer-offer' }); await flush(); assert.equal(f.peer.candidates[0].candidate, 'early');
  assert.deepEqual(f.messages.at(-1), { type: 'answer', sdp: 'local-answer' });
  f.ready(); f.track('audio'); const track = f.track('video', true); assert.equal(f.output, undefined); assert.equal(f.original.style.getPropertyValue('visibility'), '');
  track.muted = false; track.dispatchEvent(new Event('unmute')); assert.equal(f.output.srcObject.getTracks().length, 2);
});

test('stopping fusion restores native visibility and sound without reloading its media source', () => {
  const f = fixture(); f.original.style.setProperty('visibility', 'visible', 'important');
  f.start(); f.ready(); f.track('video'); const output = f.output;
  f.original.src = 'blob:latest'; f.original.volume = .25; f.original.muted = true; f.present(1);
  assert.equal(f.host.hasAttribute('data-bili-fusion-presenting'), true);
  f.receive({ type: 'close' }); f.receive({ type: 'close' });
  assert.equal(f.original.src, 'blob:latest'); assert.equal(f.original.loads, 1);
  assert.equal(f.original.style.getPropertyValue('visibility'), 'visible'); assert.equal(f.original.style.getPropertyPriority('visibility'), 'important');
  assert.equal(f.original.volume, .25); assert.equal(f.original.muted, true); assert.equal(output.isConnected, false); assert.equal(output.srcObject, null);
  assert.equal(output.callbacks.size, 0); assert.equal(f.timers.size, 0); assert.ok(f.tracks.every(track => track.stopped));
  assert.equal(f.host.hasAttribute('data-bili-fusion-presenting'), false);
  for (const name of ['volume', 'muted', 'play', 'pause']) assert.equal(Object.hasOwn(f.original, name), false);
});

test('transport failure removes fusion and restores native presentation exactly once', () => {
  const f = fixture(); f.start(); f.ready(); f.track('video');
  f.peer.connectionState = 'failed'; f.peer.onconnectionstatechange(); f.peer.onconnectionstatechange();
  assert.equal(f.original.style.getPropertyValue('visibility'), ''); assert.equal(f.original.nativeMuted, false); assert.equal(f.original.loads, 0);
  assert.equal(f.output.isConnected, false); assert.equal(f.messages.filter(message => message.type === 'error').length, 1);
  f.ready(); const late = f.track('video'); assert.equal(late.stopped, true);
  f.receive({ type: 'close' }); assert.equal(f.port.closed, true);
});
