import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { defaultScene, drawGeometry, RESOLUTIONS } from '../extension/lib/model.js';
import { createCompositorRenderer } from '../extension/lib/gpu-compositor.js';

const workerSource = fs.readFileSync(new URL('../extension/native-compositor-worker.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, '');
function fixture({ gpuFailure = false } = {}) {
  const sent = [], drawn = [], timers = new Map(); let now = 0, throwDraw = false, timer = 0;
  const self = { postMessage(message, transfer) { sent.push({ message, transfer }); } };
  const context = { self, performance: { now: () => now }, drawGeometry, RESOLUTIONS,
    createCompositorRenderer(width, height, options = {}) {
      if (gpuFailure && options.preferGpu !== false) return { canvas: { width, height }, info: { backend: 'webgl2' }, draw() { throw new Error('GPU reset'); }, close() {} };
      return createCompositorRenderer(width, height, { Canvas: context.OffscreenCanvas });
    },
    setTimeout(callback) { timers.set(++timer, callback); return timer; }, clearTimeout(id) { timers.delete(id); },
    OffscreenCanvas: class { constructor(width, height) { this.width = width; this.height = height; } getContext(type) { if (type !== '2d') return null; return { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, drawImage(frame) { if (throwDraw) throw new Error('draw failed'); drawn.push(frame); } }; } },
    VideoFrame: class { constructor(canvas, options) { this.timestamp = options.timestamp; this.width = canvas.width; this.height = canvas.height; } close() { this.closed = true; } }
  };
  vm.runInNewContext(workerSource, context);
  const receive = data => self.onmessage({ data }); receive({ type: 'start', scene: defaultScene() });
  return { sent, drawn, receive, timers, tick(value) { now = value; const tasks = [...timers.values()]; timers.clear(); for (const callback of tasks) callback(); }, set now(value) { now = value; }, set throwDraw(value) { throwDraw = value; },
    frame(id, timestamp = 0) { const frame = { timestamp, displayWidth: 1920, displayHeight: 1080, close() { this.closed = true; } }; receive({ type: 'source-frame', id, generation: 1, frame }); return frame; },
    outputs() { return sent.filter(entry => entry.message.type === 'frame'); }
  };
}

test('worker explicitly transfers one output frame at a time and closes replaced input frames', () => {
  const f = fixture(); const original = f.frame('A', 9000000);
  assert.equal(f.outputs().length, 1); const { message, transfer } = f.outputs()[0];
  assert.equal(transfer[0], message.frame); assert.equal(message.frame.width, 1920); assert.equal(message.frame.height, 1080);
  f.now = 40; f.frame('A', 500); assert.equal(original.closed, true);
  assert.equal(f.outputs().length, 1, 'Wait for the generator writer before producing another output');
  f.receive({ type: 'output-consumed' }); f.frame('B', 200);
  assert.equal(f.outputs().length, 2); assert.ok(f.outputs()[1].message.frame.timestamp > message.frame.timestamp);
  assert.equal(f.sent.filter(entry => entry.message.type === 'consumed').length, 3);
});

test('a GPU reset switches renderer without dropping input frames or breaking the live output clock', () => {
  const f = fixture({ gpuFailure: true }), frame = f.frame('A');
  assert.equal(f.outputs().length, 1); assert.equal(f.drawn[0], frame);
  assert.deepEqual(f.sent.filter(entry => entry.message.type === 'renderer-info').map(entry => entry.message.info.backend), ['webgl2', 'canvas2d']);
  assert.equal(f.sent.some(entry => entry.message.type === 'error'), false);
  f.receive({ type: 'output-consumed' }); f.tick(34); assert.equal(f.outputs().length, 2);
});

test('source seek or reconnect timestamps cannot stall the real-time output clock', () => {
  const f = fixture(); f.frame('A', 9000000000); f.receive({ type: 'output-consumed' });
  f.now = 40; f.frame('B', 0); f.receive({ type: 'output-consumed' });
  f.now = 80; f.frame('A', 1);
  assert.deepEqual(f.outputs().map(entry => entry.message.frame.timestamp), [0, 40000, 80000]);
});

test('worker releases backpressure after a draw error', () => {
  const f = fixture(); f.throwDraw = true; f.frame('A');
  assert.equal(f.sent.at(-1).message.type, 'error');
  f.throwDraw = false; f.now = 40; f.frame('A'); assert.equal(f.outputs().length, 1);
});

test('worker keeps a stable real-time output when an input has a gap and applies backpressure', () => {
  const f = fixture(); f.frame('A');
  assert.equal(f.timers.size, 0);
  f.receive({ type: 'output-consumed' }); assert.equal(f.timers.size, 1);
  f.tick(34); assert.equal(f.outputs().length, 2); assert.equal(f.timers.size, 0);
  f.tick(68); assert.equal(f.outputs().length, 2, 'No queue grows while the writer is still processing');
  f.receive({ type: 'output-consumed' }); f.tick(68);
  assert.deepEqual(f.outputs().map(entry => entry.message.frame.timestamp), [0, 34000, 68000]);
});
