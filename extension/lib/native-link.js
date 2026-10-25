// Only SDP and ICE metadata cross the page boundary. Audio/video stay on
// browser media tracks and travel over a local peer connection without STUN.
export class NativeLink {
  constructor({ send, onError, Peer = globalThis.RTCPeerConnection }) {
    this.send = send; this.onError = onError; this.closed = false;
    this.peer = new Peer({ iceServers: [] }); this.candidates = []; this.pending = Promise.resolve();
    this.peer.onicecandidate = event => { if (!this.closed && event.candidate) this.send({ type: 'candidate', candidate: event.candidate.toJSON() }); };
    this.peer.onconnectionstatechange = () => {
      if (!this.closed && this.peer.connectionState === 'failed') this.onError(new Error('本机音视频连接已中断，请重新应用场景'));
    };
  }
  async start(stream, fps) {
    if (this.closed) return;
    for (const track of stream.getTracks()) {
      if (track.kind === 'video') {
        track.contentHint = 'detail';
        this.peer.addTransceiver(track, { direction: 'sendonly', streams: [stream], sendEncodings: [{ scaleResolutionDownBy: 1, maxBitrate: 40000000, maxFramerate: fps }] });
      } else this.peer.addTrack(track, stream);
    }
    const offer = await this.peer.createOffer();
    if (this.closed) return;
    await this.peer.setLocalDescription(offer);
    if (!this.closed) this.send({ type: 'offer', sdp: this.peer.localDescription.sdp });
  }
  receive(message) {
    this.pending = this.pending.then(async () => {
      if (this.closed) return;
      if (message?.type === 'answer') {
        await this.peer.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        if (this.closed) return;
        for (const sender of this.peer.getSenders()) {
          if (sender.track?.kind !== 'video') continue;
          const parameters = sender.getParameters(); parameters.degradationPreference = 'maintain-resolution';
          await sender.setParameters(parameters);
        }
        for (const candidate of this.candidates.splice(0)) await this.peer.addIceCandidate(candidate);
      } else if (message?.type === 'candidate') {
        if (this.peer.remoteDescription) await this.peer.addIceCandidate(message.candidate);
        else this.candidates.push(message.candidate);
      }
    }).catch(error => { if (!this.closed) this.onError(error); });
    return this.pending;
  }
  close() { if (this.closed) return; this.closed = true; this.candidates = []; this.peer.close(); }
}
