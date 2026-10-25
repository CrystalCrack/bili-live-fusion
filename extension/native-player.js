// Runs in the page's MAIN world. Only media-source ownership changes;
// the original player's controls, element and danmaku remain in place.
(() => {
  // Install before the site caches these methods. Only a video explicitly
  // owned by this session is protected; every other media element delegates.
  const owners = new WeakMap();
  const media = HTMLMediaElement.prototype, element = Element.prototype;
  const properties = Object.fromEntries(['srcObject', 'src', 'currentTime', 'playbackRate'].map(name => [name, Object.getOwnPropertyDescriptor(media, name)]));
  const methods = { load: media.load, setAttribute: element.setAttribute, removeAttribute: element.removeAttribute, setAttributeNS: element.setAttributeNS, removeAttributeNS: element.removeAttributeNS };
  function blocked(owner, kind) { owner.blocked[kind] = (owner.blocked[kind] || 0) + 1; }
  function setSource(owner, value) { owner.restoreSrc = { present: true, value: String(value) }; blocked(owner, 'src'); }
  for (const [name, descriptor] of Object.entries(properties)) {
    Object.defineProperty(media, name, { ...descriptor, set(value) {
      const owner = owners.get(this);
      if (!owner) { descriptor.set.call(this, value); return; }
      if (name === 'src') setSource(owner, value);
      else { if (name === 'srcObject') owner.restoreObject = value; if (name === 'playbackRate') owner.restoreRate = value; blocked(owner, name); }
    } });
  }
  media.load = function (...args) { const owner = owners.get(this); if (owner) { blocked(owner, 'load'); return; } return methods.load.apply(this, args); };
  element.setAttribute = function (name, value) { const owner = owners.get(this); if (owner && String(name).toLowerCase() === 'src') { setSource(owner, value); return; } return methods.setAttribute.call(this, name, value); };
  element.removeAttribute = function (name) { const owner = owners.get(this); if (owner && String(name).toLowerCase() === 'src') { owner.restoreSrc = { present: false, value: null }; blocked(owner, 'src'); return; } return methods.removeAttribute.call(this, name); };
  element.setAttributeNS = function (namespace, name, value) { if (!namespace && owners.has(this) && String(name).toLowerCase() === 'src') return element.setAttribute.call(this, name, value); return methods.setAttributeNS.call(this, namespace, name, value); };
  element.removeAttributeNS = function (namespace, name) { if (!namespace && owners.has(this) && String(name).toLowerCase() === 'src') return element.removeAttribute.call(this, name); return methods.removeAttributeNS.call(this, namespace, name); };
  let current;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'BILI_FUSION_NATIVE_INIT' || !/^[a-f0-9-]{36}$/i.test(event.data.token || '') || !event.ports[0]) return;
    current?.close();
    const token = event.data.token, port = event.ports[0];
    const host = document.querySelector('[data-bili-fusion-host="' + token + '"]');
    let stream, peer, binding, video, closed = false, failed = false, observer, started = false, healthTimer;
    let pending = Promise.resolve(); const candidates = [];
    const send = data => { if (!closed) port.postMessage(data); };
    const source = properties.srcObject;
    function release(reload = true) {
      if (!binding) return;
      const saved = binding; binding = null;
      const resume = !saved.video.paused;
      saved.video.removeEventListener('loadeddata', saved.ready); saved.video.removeEventListener('playing', saved.ready);
      owners.delete(saved.video);
      for (const [name, descriptor] of Object.entries(saved.own)) { if (descriptor) Object.defineProperty(saved.video, name, descriptor); else delete saved.video[name]; }
      if (saved.restoreSrc.present) { if (saved.video.getAttribute('src') !== saved.restoreSrc.value) methods.setAttribute.call(saved.video, 'src', saved.restoreSrc.value); }
      else if (saved.video.hasAttribute('src')) methods.removeAttribute.call(saved.video, 'src');
      source.set.call(saved.video, saved.restoreObject);
      properties.playbackRate.set.call(saved.video, saved.restoreRate);
      if (reload && saved.video.isConnected) { methods.load.call(saved.video); if (resume) saved.video.play().catch(() => {}); }
    }
    function attach() {
      const next = binding?.video.isConnected && host.contains(binding.video) ? binding.video : host && [...host.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (closed || failed || !started || !stream?.getVideoTracks().some(track => !track.muted) || !next || next === video && binding) return;
      release(false); video = next;
      binding = { video, restoreObject: source.get.call(video), restoreSrc: { present: video.hasAttribute('src'), value: video.getAttribute('src') }, restoreRate: video.playbackRate, own: Object.fromEntries([...Object.keys(properties), 'load'].map(name => [name, Object.getOwnPropertyDescriptor(video, name)])), blocked: {}, paused: video.paused };
      const saved = binding;
      saved.ready = () => { if (binding === saved && !closed && !failed) send({ type: 'attached' }); };
      video.addEventListener('loadeddata', saved.ready, { once: true }); video.addEventListener('playing', saved.ready, { once: true });
      owners.set(video, saved);
      for (const name of Object.keys(properties)) Object.defineProperty(video, name, { configurable: true, get() { return properties[name].get.call(this); }, set(value) { Object.getOwnPropertyDescriptor(media, name).set.call(this, value); } });
      Object.defineProperty(video, 'load', { configurable: true, writable: true, value: media.load });
      properties.playbackRate.set.call(video, 1); source.set.call(video, stream);
      if (!binding.paused) video.play().catch(() => { if (binding === saved && !failed) send({ type: 'play-needed', text: '点击 B 站播放按钮继续播放' }); });
    }
    function stopMedia() { clearInterval(healthTimer); observer?.disconnect(); peer?.close(); release(); stream?.getTracks().forEach(track => track.stop()); candidates.length = 0; }
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
      healthTimer = setInterval(() => {
        if (closed || failed || !binding) return;
        const current = binding.video;
        send({ type: 'native-health', data: { connection: peer.connectionState, sourceMatches: source.get.call(current) === stream, blocked: { ...binding.blocked }, ready: current.readyState, paused: current.paused, time: current.currentTime, width: current.videoWidth, height: current.videoHeight, frames: current.getVideoPlaybackQuality?.().totalVideoFrames, error: current.error?.message || null } });
      }, 2000);
      send({ type: 'ready' });
    } catch (error) { fail(error); }
  });
  window.addEventListener('pagehide', () => current?.close());
})();
