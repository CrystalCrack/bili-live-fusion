import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { defaultScene, drawGeometry, RESOLUTIONS } from '../extension/lib/model.js';

const workerSource = fs.readFileSync(new URL('../extension/native-compositor-worker.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/, '');
function fixture() {
  const sent = [], drawn = []; let now = 0, throwDraw = false;
  const self = { postMessage(message, transfer) { sent.push({ message, transfer }); } };
  const context = { self, performance: { now: () => now }, drawGeometry, RESOLUTIONS,
    OffscreenCanvas: class { constructor(width, height) { this.width = width; this.height = height; } getContext() { return { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, drawImage(frame) { if (throwDraw) throw new Error('draw failed'); drawn.push(frame); } }; } },
    VideoFrame: class { constructor(canvas, options) { this.timestamp = options.timestamp; this.width = canvas.width; this.height = canvas.height; } close() { this.closed = true; } }
  };
  vm.runInNewContext(workerSource, context);
  const receive = data => self.onmessage({ data }); receive({ type: 'start', scene: defaultScene() });
  return { sent, drawn, receive, set now(value) { now = value; }, set throwDraw(value) { throwDraw = value; },
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
