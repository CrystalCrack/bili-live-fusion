export class OutputServer {
  constructor(getStream, onStatus) {
    this.getStream = getStream; this.onStatus = onStatus;
    this.token = crypto.randomUUID(); this.peers = new Map(); this.windows = new Set();
    this.channel = new BroadcastChannel(`fusion-output-${this.token}`);
    this.channel.onmessage = event => this.receive(event.data).catch(error => this.onStatus?.(error.message));
  }
  open() {
    const output = window.open(`output.html#${this.token}`, `fusion-output-${this.token}`, 'popup,width=1200,height=740');
    if (!output) throw new Error('请允许本页面打开输出窗口');
    this.windows.add(output); output.focus();
  }
  async receive(message) {
    if (!message || typeof message.peerId !== 'string') return;
    const id = message.peerId;
    if (message.type === 'ready') {
      this.removePeer(id);
      const connection = new RTCPeerConnection({ iceServers: [] });
      const stream = this.getStream();
      const peer = { connection, stream, candidates: [], timeout: null }; this.peers.set(id, peer);
      for (const track of stream.getTracks()) {
        if (track.kind === 'video') {
          track.contentHint = 'detail';
          connection.addTransceiver(track, { direction: 'sendonly', streams: [stream], sendEncodings: [{ scaleResolutionDownBy: 1, maxBitrate: 16000000, maxFramerate: 60 }] });
        } else connection.addTrack(track, stream);
      }
      connection.onicecandidate = event => { if (event.candidate) this.channel.postMessage({ type: 'candidate', peerId: id, candidate: event.candidate.toJSON() }); };
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'connected') clearTimeout(peer.timeout);
        if (['closed', 'failed'].includes(connection.connectionState)) this.removePeer(id);
      };
      peer.timeout = setTimeout(() => { if (connection.connectionState !== 'connected') { this.removePeer(id); this.onStatus?.('输出连接超时，请关闭输出窗口后重试'); } }, 20000);
      await connection.setLocalDescription(await connection.createOffer());
      this.channel.postMessage({ type: 'offer', peerId: id, sdp: connection.localDescription.toJSON() });
    } else if (message.type === 'answer') {
      const peer = this.peers.get(id); if (!peer) return;
      await peer.connection.setRemoteDescription(message.sdp);
      for (const sender of peer.connection.getSenders()) {
        if (sender.track?.kind !== 'video') continue;
        const parameters = sender.getParameters();
        parameters.degradationPreference = 'maintain-resolution';
        await sender.setParameters(parameters);
      }
      for (const candidate of peer.candidates.splice(0)) await peer.connection.addIceCandidate(candidate);
    } else if (message.type === 'candidate-answer') {
      const peer = this.peers.get(id); if (!peer) return;
      if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(message.candidate);
      else peer.candidates.push(message.candidate);
    } else if (message.type === 'bye') this.removePeer(id);
  }
  removePeer(id) {
    const peer = this.peers.get(id); if (!peer) return;
    clearTimeout(peer.timeout); peer.connection.close(); peer.stream.getVideoTracks().forEach(track => track.stop()); this.peers.delete(id);
  }
  close() {
    this.channel.postMessage({ type: 'closed' });
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.channel.close();
  }
}
