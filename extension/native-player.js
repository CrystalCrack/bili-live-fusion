// Runs in the page's MAIN world. Only media-source ownership changes;
// the original player's controls, element and danmaku remain in place.
(() => {
  let current;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'BILI_FUSION_NATIVE_INIT' || !/^[a-f0-9-]{36}$/i.test(event.data.token || '') || !event.ports[0]) return;
    current?.close();
    const token = event.data.token, port = event.ports[0];
    const host = document.querySelector('[data-bili-fusion-host="' + token + '"]');
    let stream, peer, binding, video, closed = false, failed = false, observer, started = false;
    let pending = Promise.resolve(); const candidates = [];
    const send = data => { if (!closed) port.postMessage(data); };
    const source = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
    const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    function release(reload = true) {
      if (!binding) return;
      const saved = binding; binding = null;
      saved.video.removeEventListener('loadeddata', saved.ready); saved.video.removeEventListener('playing', saved.ready);
      if (saved.srcObject) Object.defineProperty(saved.video, 'srcObject', saved.srcObject); else delete saved.video.srcObject;
      if (saved.load) Object.defineProperty(saved.video, 'load', saved.load); else delete saved.video.load;
      if (saved.currentTime) Object.defineProperty(saved.video, 'currentTime', saved.currentTime); else delete saved.video.currentTime;
      source.set.call(saved.video, saved.previous);
      if (reload && saved.video.isConnected) { HTMLMediaElement.prototype.load.call(saved.video); if (!saved.paused) saved.video.play().catch(() => {}); }
    }
    function attach() {
      const next = host && [...host.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (closed || failed || !started || !stream?.getVideoTracks().some(track => !track.muted) || !next || next === video && binding) return;
      release(false); video = next;
      binding = { video, previous: source.get.call(video), srcObject: Object.getOwnPropertyDescriptor(video, 'srcObject'), load: Object.getOwnPropertyDescriptor(video, 'load'), currentTime: Object.getOwnPropertyDescriptor(video, 'currentTime'), paused: video.paused };
      const saved = binding;
      saved.ready = () => { if (binding === saved && !closed && !failed) send({ type: 'attached' }); };
      video.addEventListener('loadeddata', saved.ready, { once: true }); video.addEventListener('playing', saved.ready, { once: true });
      source.set.call(video, stream);
      Object.defineProperty(video, 'srcObject', { configurable: true, get: () => stream, set() {} });
      Object.defineProperty(video, 'load', { configurable: true, writable: true, value() {} });
      Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time.get.call(video), set() {} });
      if (!binding.paused) video.play().catch(() => { if (binding === saved && !failed) send({ type: 'play-needed', text: '点击 B 站播放按钮继续播放' }); });
    }
    function stopMedia() { observer?.disconnect(); peer?.close(); release(); stream?.getTracks().forEach(track => track.stop()); candidates.length = 0; }
    function fail(error) { if (closed || failed) return; failed = true; send({ type: 'error', text: '原生播放器连接失败：' + error.message }); stopMedia(); }
    const state = { close() { if (closed) return; closed = true; stopMedia(); port.close(); if (current === state) current = null; } }; current = state;
    port.onmessage = event => {
      const data = event.data;
      if (data?.type === 'close') { state.close(); return; }
      if (closed || failed) return;
      if (data?.type === 'failed') { failed = true; stopMedia(); return; }
      if (data?.type === 'stream-ready') { started = true; try { attach(); } catch (error) { fail(error); } return; }
      if (data?.type !== 'offer' && data?.type !== 'candidate') return;
      pending = pending.then(async () => {
        if (closed || failed) return;
        if (data.type === 'offer') {
          await peer.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          if (closed || failed) return;
          for (const candidate of candidates.splice(0)) await peer.addIceCandidate(candidate);
          await peer.setLocalDescription(await peer.createAnswer());
          if (closed || failed) return;
          send({ type: 'answer', sdp: peer.localDescription.sdp });
        } else if (peer.remoteDescription) await peer.addIceCandidate(data.candidate);
        else candidates.push(data.candidate);
      }).catch(fail);
    };
    port.start();
    try {
      if (!globalThis.RTCPeerConnection) throw new Error('请更新 Edge 后使用网页融合');
      if (!host) throw new Error('原生播放器已变化，请重新应用场景');
      stream = new MediaStream(); peer = new RTCPeerConnection({ iceServers: [] });
      peer.onicecandidate = event => { if (!closed && !failed && event.candidate) send({ type: 'candidate', candidate: event.candidate.toJSON() }); };
      peer.onconnectionstatechange = () => { if (peer.connectionState === 'failed') fail(new Error('本机音视频连接已中断，请重新应用场景')); };
      peer.ontrack = event => {
        if (closed || failed) { event.track.stop(); return; }
        if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
        const ready = () => { try { attach(); } catch (error) { fail(error); } };
        event.track.addEventListener('unmute', ready, { once: true }); ready();
      };
      observer = new MutationObserver(() => { try { attach(); } catch (error) { fail(error); } }); observer.observe(host, { childList: true, subtree: true });
      send({ type: 'ready' });
    } catch (error) { fail(error); }
  });
  window.addEventListener('pagehide', () => current?.close());
})();
