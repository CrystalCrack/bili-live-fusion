import test from 'node:test';
import assert from 'node:assert/strict';
import { OutputServer } from '../extension/lib/output-channel.js';
import { AudioMixer } from '../extension/lib/audio.js';

function server(onSend) {
  const value = Object.create(OutputServer.prototype), messages = [];
  value.peers = new Map([['viewer', { view: 'watch', requests: new Set(), sending: false }], ['output', { view: 'output' }]]);
  value.onSend = onSend; value.sendTo = (id, message) => messages.push({ id, ...message });
  return { value, messages };
}
const message = (extra = {}) => ({ type: 'watch-send', peerId: 'viewer', requestId: 'one', text: '原始文本', target: 'A', ...extra });

test('watch sends only from a registered viewer, validates text and target, and deduplicates requests', async () => {
  const calls = [], { value, messages } = server(async (text, target) => { calls.push({ text, target }); return { ok: true, message: '已发送' }; });
  await value.receive(message({ peerId: 'stranger' })); await value.receive(message({ peerId: 'output' }));
  assert.equal(calls.length, 0);
  await value.receive(message({ requestId: 'long', text: '😀'.repeat(31) }));
  await value.receive(message({ requestId: 'target', target: 'C' }));
  assert.equal(calls.length, 0); assert.equal(messages.every(reply => !reply.ok), true);
  await value.receive(message()); await value.receive(message());
  assert.deepEqual(calls, [{ text: '原始文本', target: 'A' }]);
  assert.equal(messages.at(-1).ok, true);
});

test('parallel viewer sends cannot clear the active send lock and partial failures remain failures', async () => {
  let complete, calls = 0;
  const { value, messages } = server(() => { calls++; return new Promise(resolve => { complete = resolve; }); });
  const first = value.receive(message());
  await value.receive(message({ requestId: 'two' })); await value.receive(message({ requestId: 'three' }));
  assert.equal(calls, 1); assert.equal(value.peers.get('viewer').sending, true);
  complete({ ok: false, sent: ['A'], errors: ['B：发送失败'], message: 'A 已发送；B：发送失败' }); await first;
  assert.equal(messages.at(-1).ok, false); assert.deepEqual(messages.at(-1).sent, ['A']);
  assert.equal(value.peers.get('viewer').sending, false);
});

test('watch events stay scoped to viewers and closing video does not stop shared audio', () => {
  const { value, messages } = server(); value.getState = () => ({ sources: ['A', 'B'] });
  value.updateState(); value.publish('watch-clear');
  assert.equal(messages.length, 2); assert.equal(messages.every(item => item.id === 'viewer'), true);
  let videoStopped = false, audioStopped = false, closed = false, watching;
  const audio = { stop() { audioStopped = true; } }, video = { stop() { videoStopped = true; } };
  value.peers.set('viewer', { view: 'watch', connection: { connectionState: 'connected', close() { closed = true; } }, stream: { getVideoTracks: () => [video], getAudioTracks: () => [audio] } });
  value.onWatching = status => { watching = status; }; value.removePeer('viewer');
  assert.equal(videoStopped, true); assert.equal(audioStopped, false); assert.equal(closed, true); assert.equal(watching, false);
});

test('watch monitor handoff silences only studio monitoring and restores the current preference', () => {
  const mixer = new AudioMixer(), gains = [];
  mixer.context = { currentTime: 2 }; mixer.monitor = { gain: { setTargetAtTime: value => gains.push(value) } };
  mixer.monitorEnabled = true; mixer.setMonitorSuppressed(true); mixer.setMonitorSuppressed(false);
  mixer.monitorEnabled = false; mixer.setMonitorSuppressed(true); mixer.setMonitorSuppressed(false);
  assert.deepEqual(gains, [0, 1, 0, 0]);
});
