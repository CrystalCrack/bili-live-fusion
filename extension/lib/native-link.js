// Only SDP and ICE metadata cross the page boundary. Audio/video stay on
// browser media tracks and travel over a local peer connection without STUN.
export function preferredVideoCodecs(codecs = []) {
  // Keep every negotiated alternative, including repair codecs. H.264 is
  // requested first; the browser still chooses the actual encoder device.
  return [...codecs.filter(codec => codec.mimeType?.toLowerCase() === 'video/h264'), ...codecs.filter(codec => codec.mimeType?.toLowerCase() !== 'video/h264')];
}

export class NativeLink {
  constructor({ send, onError, Peer = globalThis.RTCPeerConnection }) {
    this.send = send; this.onError = onError; this.closed = false;
    this.peer = new Peer({ iceServers: [] }); this.candidates = []; this.pending = Promise.resolve(); this.encoding = null; this.previousStats = null; this.statsPending = null;
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
        const transceiver = this.peer.addTransceiver(track, { direction: 'sendonly', streams: [stream], sendEncodings: [{ scaleResolutionDownBy: 1, maxBitrate: 40000000, maxFramerate: fps }] });
        try {
          const codecs = globalThis.RTCRtpSender?.getCapabilities?.('video')?.codecs;
          if (codecs?.some(codec => codec.mimeType.toLowerCase() === 'video/h264') && transceiver?.setCodecPreferences) transceiver.setCodecPreferences(preferredVideoCodecs(codecs));
        } catch { /* The browser's codec order remains usable. */ }
      } else this.peer.addTrack(track, stream);
    }
    const offer = await this.peer.createOffer();
    if (this.closed) return;
    await this.peer.setLocalDescription(offer);
    if (!this.closed) this.send({ type: 'offer', sdp: this.peer.localDescription.sdp });
  }
  async collectStats() {
    if (this.closed || !this.peer.getStats) return this.encoding;
    if (this.statsPending) return this.statsPending;
    this.statsPending = (async () => {
      try {
        const report = await this.peer.getStats(); if (this.closed) return this.encoding;
        let video;
        report.forEach(item => { if (item.type === 'outbound-rtp' && (item.kind || item.mediaType) === 'video' && !item.isRemote && (!video || (item.framesEncoded || 0) > (video.framesEncoded || 0))) video = item; });
        if (!video) return this.encoding;
        const previous = this.previousStats, elapsed = previous && previous.id === video.id ? (video.timestamp - previous.timestamp) / 1000 : 0;
        const frameDelta = previous ? video.framesEncoded - previous.framesEncoded : 0;
        const codec = report.get(video.codecId);
        this.encoding = { codec: codec?.mimeType || '', implementation: video.encoderImplementation || '', powerEfficient: typeof video.powerEfficientEncoder === 'boolean' ? video.powerEfficientEncoder : null,
          width: video.frameWidth ?? null, height: video.frameHeight ?? null, fps: video.framesPerSecond ?? (elapsed > 0 && frameDelta >= 0 ? Math.round(frameDelta / elapsed * 10) / 10 : null),
          bitrateMbps: elapsed > 0 && video.bytesSent >= previous.bytesSent ? Math.round((video.bytesSent - previous.bytesSent) * 8 / elapsed / 100000) / 10 : null,
          encodeMs: elapsed > 0 && frameDelta > 0 && video.totalEncodeTime >= previous.totalEncodeTime ? Math.round((video.totalEncodeTime - previous.totalEncodeTime) * 10000 / frameDelta) / 10 : null,
          frames: video.framesEncoded ?? null, qualityLimitation: video.qualityLimitationReason || '' };
        this.previousStats = { id: video.id, timestamp: video.timestamp, bytesSent: video.bytesSent, framesEncoded: video.framesEncoded, totalEncodeTime: video.totalEncodeTime };
      } catch { /* Diagnostics must not interrupt a live connection. */ }
      return this.encoding;
    })();
    try { return await this.statsPending; } finally { this.statsPending = null; }
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
