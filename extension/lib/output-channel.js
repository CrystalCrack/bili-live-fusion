export class OutputServer {
  constructor(getStream, onStatus, { getState = () => ({}), onSend, onFocus, onWatching } = {}) {
    this.getStream = getStream; this.onStatus = onStatus;
    this.getState = getState; this.onSend = onSend; this.onFocus = onFocus; this.onWatching = onWatching;
    this.token = crypto.randomUUID(); this.peers = new Map(); this.windows = new Set();
    this.channel = new BroadcastChannel(`fusion-output-${this.token}`);
    this.channel.onmessage = event => this.receive(event.data).catch(error => this.onStatus?.(error.message));
  }
  open() {
    const page = 'output';
    const output = window.open(`${page}.html#${this.token}`, `fusion-${page}-${this.token}`, 'popup,width=1200,height=780');
    if (!output) throw new Error('请允许本页面打开播放窗口');
    this.windows.add(output); output.focus();
  }
  async receive(message) {
    if (!message || typeof message.peerId !== 'string') return;
    const id = message.peerId;
    if (message.type === 'ready') {
      this.removePeer(id);
      const connection = new RTCPeerConnection({ iceServers: [] });
      const view = message.view === 'watch' ? 'watch' : 'output';
      const stream = this.getStream(view);
      const peer = { connection, stream, view, candidates: [], timeout: null, requests: new Set(), sending: false }; this.peers.set(id, peer);
      if (view === 'watch') this.sendTo(id, { type: 'watch-state', state: this.getState() });
      for (const track of stream.getTracks()) {
        if (track.kind === 'video') {
          track.contentHint = 'detail';
          connection.addTransceiver(track, { direction: 'sendonly', streams: [stream], sendEncodings: [{ scaleResolutionDownBy: 1, maxBitrate: 16000000, maxFramerate: 60 }] });
        } else connection.addTrack(track, stream);
      }
      connection.onicecandidate = event => { if (event.candidate) this.channel.postMessage({ type: 'candidate', peerId: id, candidate: event.candidate.toJSON() }); };
      connection.onconnectionstatechange = () => {
        if (this.peers.get(id) !== peer) return;
        if (connection.connectionState === 'connected') { clearTimeout(peer.timeout); if (view === 'watch') this.onWatching?.(this.watching); }
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
    } else if (message.type === 'watch-send') {
      const peer = this.peers.get(id);
      if (peer?.view !== 'watch' || typeof message.requestId !== 'string' || message.requestId.length > 80 || peer.requests.has(message.requestId)) return;
      peer.requests.add(message.requestId);
      if (peer.requests.size > 100) peer.requests.delete(peer.requests.values().next().value);
      if (peer.sending) { this.sendTo(id, { type: 'watch-sent', requestId: message.requestId, ok: false, message: '正在发送，请稍候' }); return; }
      try {
        const text = String(message.text || '').trim();
        if (!text || [...text].length > 30) throw new Error('弹幕请输入 1–30 个字');
        if (!['A', 'B', 'both'].includes(message.target)) throw new Error('请选择发送直播间');
        if (!this.onSend) throw new Error('请返回工作台连接直播间');
        peer.sending = true;
        const result = await this.onSend(text, message.target);
        this.sendTo(id, { type: 'watch-sent', requestId: message.requestId, ok: true, ...result });
      } catch (error) { this.sendTo(id, { type: 'watch-sent', requestId: message.requestId, ok: false, message: error.message }); }
      finally { peer.sending = false; }
    } else if (message.type === 'watch-focus' && this.peers.get(id)?.view === 'watch') this.onFocus?.();
    else if (message.type === 'bye') this.removePeer(id);
  }
  get watching() { return [...this.peers.values()].some(peer => peer.view === 'watch' && peer.connection.connectionState === 'connected'); }
  sendTo(peerId, message) { this.channel.postMessage({ ...message, peerId }); }
  publish(type, payload = {}) { for (const [id, peer] of this.peers) if (peer.view === 'watch') this.sendTo(id, { ...payload, type }); }
  updateState() { if ([...this.peers.values()].some(peer => peer.view === 'watch')) this.publish('watch-state', { state: this.getState() }); }
  removePeer(id) {
    const peer = this.peers.get(id); if (!peer) return;
    this.peers.delete(id); clearTimeout(peer.timeout); peer.connection?.close();
    peer.stream.getVideoTracks().forEach(track => track.stop());
    if (peer.view === 'watch') this.onWatching?.(this.watching);
  }
  close() {
    this.channel.postMessage({ type: 'closed' });
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.channel.close();
  }
}
