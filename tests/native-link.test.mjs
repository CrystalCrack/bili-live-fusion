import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeLink } from '../extension/lib/native-link.js';

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
