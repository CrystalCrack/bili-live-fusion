import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeLink, preferredVideoCodecs } from '../extension/lib/native-link.js';

function fixture() {
  let peer; const sent = [], errors = [], tracks = [{ kind: 'video' }, { kind: 'audio' }];
  class Peer {
    constructor(config) { peer = this; this.config = config; this.senders = []; this.candidates = []; }
    addTransceiver(track, options) { this.options = options; this.senders.push({ track, getParameters: () => ({}), setParameters: async parameters => { this.parameters = parameters; } }); }
    addTrack(track) { this.senders.push({ track }); }
    async createOffer() { return { type: 'offer', sdp: 'producer-offer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    async addIceCandidate(candidate) { this.candidates.push(candidate); }
    getSenders() { return this.senders; }
    async getStats() { return this.stats || new Map(); }
    close() { this.closed = true; }
  }
  const link = new NativeLink({ Peer, send: message => sent.push(structuredClone(message)), onError: error => errors.push(error) });
  return { link, peer, sent, errors, tracks, stream: { getTracks: () => tracks } };
}

test('local link sends full-resolution video and mixed audio with no relay server', async () => {
  const f = fixture(); await f.link.start(f.stream, 60);
  assert.deepEqual(f.peer.config, { iceServers: [] }); assert.equal(f.tracks[0].contentHint, 'detail');
  assert.equal(f.peer.options.direction, 'sendonly');
  assert.deepEqual(f.peer.options.sendEncodings, [{ scaleResolutionDownBy: 1, maxBitrate: 40000000, maxFramerate: 60 }]);
  assert.deepEqual(f.peer.senders.map(sender => sender.track.kind), ['video', 'audio']);
  assert.deepEqual(f.sent, [{ type: 'offer', sdp: 'producer-offer' }]);
  f.peer.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'local' }) } });
  assert.deepEqual(f.sent.at(-1), { type: 'candidate', candidate: { candidate: 'local' } });
});

test('H264 preference keeps all original codec alternatives and repair formats', () => {
  const codecs = [{ mimeType: 'video/VP8' }, { mimeType: 'video/rtx' }, { mimeType: 'video/H264' }, { mimeType: 'video/VP9' }];
  assert.deepEqual(preferredVideoCodecs(codecs), [codecs[2], codecs[0], codecs[1], codecs[3]]);
  assert.equal(codecs[0].mimeType, 'video/VP8');
});

test('the local video transceiver applies H264 preferences before creating its offer', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'RTCRtpSender');
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'RTCRtpSender', previous); else delete globalThis.RTCRtpSender; });
  const codecs = [{ mimeType: 'video/VP8' }, { mimeType: 'video/H264' }, { mimeType: 'video/rtx' }];
  globalThis.RTCRtpSender = { getCapabilities: () => ({ codecs }) };
  const f = fixture(); let preferred;
  const add = f.peer.addTransceiver.bind(f.peer);
  f.peer.addTransceiver = (...args) => { add(...args); return { setCodecPreferences(value) { preferred = value; } }; };
  f.peer.createOffer = async () => { assert.equal(preferred[0].mimeType, 'video/H264'); return { type: 'offer', sdp: 'preferred' }; };
  await f.link.start(f.stream, 30); assert.equal(preferred.length, 3);
});

test('encoder diagnostics use measured rates and browser hardware flags without identifying a device from a codec name', async () => {
  const f = fixture();
  const report = (timestamp, framesEncoded, bytesSent, totalEncodeTime, extra = {}) => new Map([
    ['codec', { type: 'codec', mimeType: 'video/H264' }],
    ['video', { id: 'video', type: 'outbound-rtp', kind: 'video', codecId: 'codec', timestamp, framesEncoded, bytesSent, totalEncodeTime, frameWidth: 1920, frameHeight: 1080, encoderImplementation: 'MediaFoundation', ...extra }]
  ]);
  f.peer.stats = report(1000, 30, 1000000, .3); let info = await f.link.collectStats();
  assert.equal(info.powerEfficient, null); assert.equal(info.fps, null); assert.equal(info.bitrateMbps, null);
  f.peer.stats = report(3000, 150, 6000000, .9, { powerEfficientEncoder: true, qualityLimitationReason: 'none' }); info = await f.link.collectStats();
  assert.equal(info.codec, 'video/H264'); assert.equal(info.implementation, 'MediaFoundation'); assert.equal(info.powerEfficient, true);
  assert.equal(info.fps, 60); assert.equal(info.bitrateMbps, 20); assert.equal(info.encodeMs, 5);
  f.peer.stats = report(4000, 170, 6500000, 1, { powerEfficientEncoder: false, qualityLimitationReason: 'cpu' });
  info = await f.link.collectStats(); assert.equal(info.powerEfficient, false); assert.equal(info.qualityLimitation, 'cpu');
  f.peer.getStats = async () => { throw new Error('stats unavailable'); }; assert.equal(await f.link.collectStats(), info); assert.deepEqual(f.errors, []);
  f.link.close(); assert.equal(await f.link.collectStats(), info);
});

test('local link queues ICE until the answer and retains output resolution', async () => {
  const f = fixture(); await f.link.start(f.stream, 30);
  await f.link.receive({ type: 'candidate', candidate: { candidate: 'early' } });
  assert.equal(f.peer.candidates.length, 0);
  await f.link.receive({ type: 'answer', sdp: 'native-answer' });
  assert.deepEqual(f.peer.remoteDescription, { type: 'answer', sdp: 'native-answer' });
  assert.deepEqual(f.peer.candidates, [{ candidate: 'early' }]);
  assert.equal(f.peer.parameters.degradationPreference, 'maintain-resolution');
  await f.link.receive({ type: 'candidate', candidate: { candidate: 'late' } });
  assert.equal(f.peer.candidates.length, 2);
  f.link.close(); await f.link.receive({ type: 'candidate', candidate: { candidate: 'closed' } });
  assert.equal(f.peer.closed, true); assert.equal(f.peer.candidates.length, 2);
});

test('closing while creating an offer does not send or restart a connection', async () => {
  const f = fixture(); let resolve;
  f.peer.createOffer = () => new Promise(done => { resolve = done; });
  const starting = f.link.start(f.stream, 30); f.link.close(); resolve({ type: 'offer', sdp: 'late' }); await starting;
  assert.deepEqual(f.sent, []); assert.equal(f.peer.localDescription, undefined);
  await f.link.start(f.stream, 30); assert.equal(f.peer.senders.length, 2);
});

test('failed negotiations reach the failure handler and closed peers stay quiet', async () => {
  const f = fixture(); f.peer.setRemoteDescription = async () => { throw new Error('answer failed'); };
  await f.link.receive({ type: 'answer', sdp: 'invalid' });
  assert.equal(f.errors[0].message, 'answer failed');
  f.peer.connectionState = 'failed'; f.peer.onconnectionstatechange(); assert.equal(f.errors.length, 2);
  f.link.close(); f.peer.onconnectionstatechange(); assert.equal(f.errors.length, 2);
});
