import test from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../extension/lib/async.js';
import { AudioMixer } from '../extension/lib/audio.js';
import { LivePlayer } from '../extension/lib/live-player.js';

test('browser promises resolve, reject or time out and late results are ignored', async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 50, 'deadline'), 42);
  await assert.rejects(withTimeout(Promise.reject(new Error('original')), 50, 'deadline'), /original/);
  let finish;
  const promise = withTimeout(new Promise(resolve => { finish = resolve; }), 5, 'deadline');
  await assert.rejects(promise, { name: 'TimeoutError', message: 'deadline' });
  finish('late');
  await assert.rejects(promise, /deadline/);
});

test('pending audio activation does not gate the media graph and can be retried', async () => {
  const mixer = new AudioMixer(), video = { muted: true, volume: 0 };
  let resumeCalls = 0, attachments = 0;
  mixer.context = { state: 'suspended', resume() { resumeCalls++; return new Promise(() => {}); },
    createMediaElementSource() { attachments++; return {}; } };
  mixer.install = () => true;
  const first = mixer.init(), second = mixer.init();
  assert.equal(mixer.attachElement('A', video), true);
  assert.equal(mixer.attachElement('A', video), true);
  assert.equal(attachments, 1); assert.equal(resumeCalls, 1); assert.equal(video.muted, false);
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.name === 'TimeoutError'));
  mixer.context.resume = async () => { mixer.context.state = 'running'; };
  assert.equal((await mixer.init()).state, 'running');
});

test('live connection waits for playback, exposes autoplay action and resumes without refetching', async t => {
  const original = globalThis.Hls;
  globalThis.Hls = class {
    static isSupported() { return true; }
    static Events = { ERROR: 'error' };
    constructor(config) { this.config = config; }
    on() {} attachMedia() {} loadSource() {} destroy() {}
  };
  t.after(() => { globalThis.Hls = original; });
  let playCalls = 0, lookups = 0, allowed = false;
  const states = [], video = { currentTime: 0, paused: true, playbackRate: 1,
    buffered: { length: 1, start: () => 0, end: () => 30 },
    pause() { this.paused = true; }, removeAttribute() {}, load() {},
    async play() { playCalls++; if (!allowed) throw new DOMException('Gesture required', 'NotAllowedError'); this.paused = false; this.onplaying?.(); }
  };
  const player = new LivePlayer(video, { resolve: async () => { lookups++; return { streams: [{ type: 'hls', url: 'fixture' }] }; },
    getLatency: () => 4, onInfo() {}, onSync() {}, onState: (...value) => states.push(value) });
  t.after(() => player.stop());
  await player.start('84074', 250);
  video.onloadedmetadata();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states.some(([state]) => state === 'playing'), false);
  assert.equal(states.at(-1)[0], 'blocked');
  player.synchronize(); player.synchronize(); assert.equal(playCalls, 1);
  allowed = true; player.resume(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(states.at(-1)[0], 'playing'); assert.equal(lookups, 1); assert.equal(video.paused, false);
  player.stop(); assert.equal(video.onplaying, null); assert.equal(player.running, false);
});

test('disconnect ignores a late room response and does not reopen the decoder', async () => {
  let respond, opened = false;
  const states = [], video = { pause() {}, removeAttribute() {}, load() {} };
  const player = new LivePlayer(video, { resolve: () => new Promise(resolve => { respond = resolve; }),
    onState: state => states.push(state), onInfo: () => { opened = true; } });
  const connecting = player.start('84074', 250);
  player.stop(); respond({ streams: [{ type: 'hls', url: 'fixture' }] }); await connecting;
  assert.equal(opened, false); assert.equal(player.running, false); assert.deepEqual(states, ['connecting']);
});
