import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeCompositor } from '../extension/lib/native-compositor.js';
import { defaultScene } from '../extension/lib/model.js';

test('source capture is reused while active and rebuilt after a muted or finished track', async t => {
  const names = ['MediaStreamTrackProcessor', 'MediaStreamTrackGenerator', 'Worker'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => { for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; } });
  const readers = [], tracks = [], errors = [];
  class Reader {
    constructor() { this.pending = []; }
    read() { return new Promise(resolve => { this.pending.push(resolve); }); }
    finish() { for (const resolve of this.pending.splice(0)) resolve({ done: true }); }
    async cancel() { this.cancelled = true; this.finish(); }
    releaseLock() { this.released = true; }
  }
  globalThis.MediaStreamTrackProcessor = class { constructor() { const reader = new Reader(); readers.push(reader); this.readable = { getReader: () => reader }; } };
  globalThis.MediaStreamTrackGenerator = class { constructor() { this.writable = { getWriter: () => ({ write: async () => {}, abort: async () => {} }) }; } stop() { this.stopped = true; } };
  globalThis.Worker = class { postMessage() {} terminate() { this.terminated = true; } };
  const video = { captureStream() { const track = { readyState: 'live', muted: false, stop() { this.readyState = 'ended'; } }; tracks.push(track); return { getVideoTracks: () => [track], getAudioTracks: () => [] }; } };
  const compositor = new NativeCompositor(defaultScene(), () => {}, error => errors.push(error));
  compositor.attach('A', video); compositor.attach('A', video); assert.equal(tracks.length, 1);
  tracks[0].muted = true; compositor.attach('A', video);
  assert.equal(tracks.length, 2); assert.equal(tracks[0].readyState, 'ended'); assert.equal(readers[0].cancelled, true);
  readers[1].finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(compositor.snapshot().sources.A.done, true);
  compositor.attach('A', video); assert.equal(tracks.length, 3);
  compositor.close(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(tracks[2].readyState, 'ended'); assert.deepEqual(errors, []);
  compositor.attach('A', video); assert.equal(tracks.length, 3);
});
