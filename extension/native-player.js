// Runs in the page's MAIN world. Keep the site's media engine on its own
// video and present fusion beside it, inside the same native player.
(() => {
  // Install before the site caches these methods. Only a video explicitly
  // owned by this session is protected; every other media element delegates.
  const owners = new WeakMap(), controls = new WeakMap();
  const media = HTMLMediaElement.prototype, element = Element.prototype;
  const properties = Object.fromEntries(['srcObject', 'src', 'currentTime', 'playbackRate', 'volume', 'muted'].map(name => [name, Object.getOwnPropertyDescriptor(media, name)]));
  const methods = { load: media.load, play: media.play, pause: media.pause, setAttribute: element.setAttribute, removeAttribute: element.removeAttribute, setAttributeNS: element.setAttributeNS, removeAttributeNS: element.removeAttributeNS };
  let interaction;
  for (const type of ['click', 'dblclick', 'keydown']) window.addEventListener(type, event => { if (event.isTrusted) interaction = event; }, true);
  function userPlayback(owner) {
    const event = interaction;
    if (!event?.isTrusted || !event.eventPhase) return false;
    if (event.type === 'keydown') {
      const target = event.target;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '')) return false;
      return ['Space', 'KeyK', 'MediaPlayPause', 'MediaPlay', 'MediaPause'].includes(event.code) || [' ', 'k', 'K', 'MediaPlayPause', 'MediaPlay', 'MediaPause'].includes(event.key);
    }
    return owner.host.contains(event.target);
  }
  function blocked(owner, kind) { owner.blocked[kind] = (owner.blocked[kind] || 0) + 1; }
  function setSource(owner, value) { owner.restoreSrc = { present: true, value: String(value) }; blocked(owner, 'src'); }
  for (const [name, descriptor] of Object.entries(properties)) {
    Object.defineProperty(media, name, { ...descriptor, get() {
      const control = controls.get(this);
      return control && (name === 'volume' || name === 'muted') ? control[name] : descriptor.get.call(this);
    }, set(value) {
      const control = controls.get(this);
      if (control && (name === 'volume' || name === 'muted')) { control.setAudio(name, value); return; }
      const owner = owners.get(this);
      if (!owner) { descriptor.set.call(this, value); return; }
      if (name === 'volume' || name === 'muted') { descriptor.set.call(this, value); return; }
      if (name === 'src') setSource(owner, value);
      else { if (name === 'srcObject') owner.restoreObject = value; if (name === 'playbackRate') owner.restoreRate = value; blocked(owner, name); }
    } });
  }
  media.load = function (...args) { const owner = owners.get(this); if (owner) { blocked(owner, 'load'); return; } return methods.load.apply(this, args); };
  media.play = function (...args) {
    const owner = owners.get(this); if (owner) return owner.play(userPlayback(owner));
    const control = controls.get(this); if (control?.owner && userPlayback(control)) control.owner.play(true);
    return methods.play.apply(this, args);
  };
  media.pause = function (...args) {
    const owner = owners.get(this); if (owner) return owner.pause(userPlayback(owner));
    const control = controls.get(this); if (control?.owner && userPlayback(control)) control.owner.pause(true);
    return methods.pause.apply(this, args);
  };
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
    let stream, peer, binding, control, api, presentationStyle, closed = false, failed = false, observer, started = false, healthTimer, playbackWanted = true;
    let bindings = 0, mounts = 0;
    let pending = Promise.resolve(); const candidates = [];
    const send = data => { if (!closed) port.postMessage(data); };
    const source = properties.srcObject;
    function releaseApi() {
      if (!api) return;
      const saved = api; api = null;
      for (const [name, wrapper] of Object.entries(saved.wrappers)) {
        if (saved.player[name] !== wrapper) continue;
        const descriptor = saved.own[name];
        if (descriptor) Object.defineProperty(saved.player, name, descriptor); else delete saved.player[name];
      }
    }
    function bridgeApi() {
      const player = window.livePlayer;
      if (!binding || !control || !player || api?.player === player || typeof player.getVideoEl !== 'function') return;
      let target; try { target = player.getVideoEl(); } catch { return; }
      if (target !== control.video) return;
      releaseApi();
      const saved = { player, own: {}, wrappers: {}, originals: {} }; api = saved;
      const patch = (name, create) => {
        const original = player[name], descriptor = Object.getOwnPropertyDescriptor(player, name);
        if (typeof original !== 'function' || descriptor && !descriptor.configurable) return;
        const wrapper = create(original); saved.own[name] = descriptor; saved.wrappers[name] = wrapper; saved.originals[name] = original;
        Object.defineProperty(player, name, { configurable: true, writable: true, enumerable: descriptor?.enumerable ?? true, value: wrapper });
      };
      for (const name of ['play', 'pause']) patch(name, original => function (...args) {
        if (binding && control && userPlayback(control)) binding[name](true);
        return original.apply(this, args);
      });
      patch('getPlayerInfo', original => function (...args) {
        const result = original.apply(this, args);
        return binding ? { ...result, playingStatus: !binding.video.paused } : result;
      });
      patch('getVideoEl', original => function (...args) { return binding?.video || original.apply(this, args); });
    }
    function releaseControl() {
      if (!control) return;
      const saved = control; control = null;
      saved.video.removeEventListener('volumechange', saved.audioListener);
      controls.delete(saved.video);
      for (const [name, descriptor] of Object.entries(saved.own)) { if (descriptor) Object.defineProperty(saved.video, name, descriptor); else delete saved.video[name]; }
      if (saved.visibility.value) saved.video.style.setProperty('visibility', saved.visibility.value, saved.visibility.priority);
      else saved.video.style.removeProperty('visibility');
      properties.volume.set.call(saved.video, saved.volume); properties.muted.set.call(saved.video, saved.muted);
    }
    function release() {
      host?.removeAttribute('data-bili-fusion-presenting'); presentationStyle?.remove(); presentationStyle = null;
      releaseApi();
      releaseControl();
      if (!binding) return;
      const saved = binding; binding = null;
      if (saved.frameCallback !== undefined) saved.video.cancelVideoFrameCallback?.(saved.frameCallback);
      for (const [type, listener] of Object.entries(saved.listeners)) saved.video.removeEventListener(type, listener);
      owners.delete(saved.video);
      methods.pause.call(saved.video); source.set.call(saved.video, null); saved.video.remove();
    }
    function mount() {
      if (!binding || !control) return;
      const original = control.video, output = binding.video;
      if (original.style.getPropertyValue('visibility') !== 'hidden' || original.style.getPropertyPriority('visibility') !== 'important') original.style.setProperty('visibility', 'hidden', 'important');
      if (output.parentElement !== original.parentElement || !output.isConnected) {
        original.after(output); mounts++; binding.record('remount');
        if (binding.wantPlaying) binding.play();
      }
    }
    function layout() {
      if (!binding || !control) return;
      const original = control.video, output = binding.video;
      // Follow the site's geometry during resize/fullscreen without copying
      // its transient hidden/loading styles onto the fusion presentation.
      for (const name of ['position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'object-fit', 'object-position', 'transform', 'z-index']) {
        const value = original.style.getPropertyValue(name), priority = original.style.getPropertyPriority(name);
        if (output.style.getPropertyValue(name) === value && output.style.getPropertyPriority(name) === priority) continue;
        if (value) output.style.setProperty(name, value, priority); else output.style.removeProperty(name);
      }
    }
    function attach() {
      if (closed || failed || !started || !stream?.getVideoTracks().some(track => !track.muted)) return;
      let activeVideo;
      try { const player = window.livePlayer; activeVideo = api?.player === player ? api.originals.getVideoEl?.call(player) : player?.getVideoEl?.(); } catch { /* DOM lookup below also supports players without the public API. */ }
      const next = activeVideo && activeVideo !== binding?.video && host.contains(activeVideo) ? activeVideo : control?.video.isConnected && host.contains(control.video) ? control.video : [...host.querySelectorAll('video')].filter(item => item !== binding?.video && !item.hasAttribute('data-bili-fusion-output')).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (!next) return;
      if (control?.video !== next) {
        const volume = control?.volume ?? properties.volume.get.call(next), muted = control?.muted ?? properties.muted.get.call(next);
        releaseControl(); bindings++;
        control = { video: next, host, volume, muted, own: Object.fromEntries(['volume', 'muted', 'play', 'pause'].map(name => [name, Object.getOwnPropertyDescriptor(next, name)])), visibility: { value: next.style.getPropertyValue('visibility'), priority: next.style.getPropertyPriority('visibility') } };
        const bridge = control;
        controls.set(next, bridge);
        control.setAudio = (name, value) => {
          // Validate through a native descriptor before changing the UI value.
          if (binding) { properties[name].set.call(binding.video, value); bridge[name] = properties[name].get.call(binding.video); }
          else bridge[name] = value;
          properties.muted.set.call(next, true);
        };
        bridge.audioListener = () => { if (controls.get(next) !== bridge) return; if (!properties.muted.get.call(next)) properties.muted.set.call(next, true); };
        next.addEventListener('volumechange', bridge.audioListener);
        for (const name of ['volume', 'muted']) Object.defineProperty(next, name, { configurable: true, get() { return controls.get(this)[name]; }, set(value) { controls.get(this).setAudio(name, value); } });
        Object.defineProperty(next, 'play', { configurable: true, writable: true, value: media.play });
        Object.defineProperty(next, 'pause', { configurable: true, writable: true, value: media.pause });
        properties.muted.set.call(next, true);
        next.style.setProperty('visibility', 'hidden', 'important');
      }
      if (binding) {
        control.owner = binding;
        mount(); layout();
        properties.volume.set.call(binding.video, control.volume); properties.muted.set.call(binding.video, control.muted); bridgeApi();
        return;
      }
      const video = next.cloneNode(false);
      video.removeAttribute('id'); video.removeAttribute('src'); video.removeAttribute('autoplay'); video.removeAttribute('controls'); video.removeAttribute('onplay'); video.removeAttribute('onpause'); video.removeAttribute('onerror');
      video.setAttribute('data-bili-fusion-output', ''); video.playsInline = true;
      video.style.setProperty('visibility', 'visible', 'important'); video.style.setProperty('opacity', '1', 'important'); video.style.setProperty('display', 'block', 'important');
      video.style.setProperty('pointer-events', 'none', 'important');
      binding = { video, host, blocked: {}, wantPlaying: playbackWanted, events: [], playBlocked: false, playPending: null, playGeneration: 0, announced: false, listeners: {}, presentedFrames: 0, lastPresented: null, lastMediaTime: null, maxFrameGap: 0 };
      const saved = binding;
      control.owner = saved;
      const active = () => binding === saved && !closed && !failed;
      saved.record = type => { saved.events.push({ type, at: Date.now(), paused: saved.video.paused, time: saved.video.currentTime }); if (saved.events.length > 12) saved.events.shift(); };
      saved.report = (state, text) => { if (active()) send({ type: 'playback-state', state, text }); };
      saved.presentation = () => {
        const showing = saved.presentedFrames > 0 && (!saved.wantPlaying || Date.now() - saved.lastPresented < 2000);
        if (showing) host.setAttribute('data-bili-fusion-presenting', token); else host.removeAttribute('data-bili-fusion-presenting');
        return showing;
      };
      saved.play = (user = false) => {
        if (!active()) return Promise.resolve();
        if (user) { saved.wantPlaying = playbackWanted = true; saved.playBlocked = false; saved.record('user-play'); }
        if (!saved.wantPlaying) { blocked(saved, 'play'); return Promise.resolve(); }
        if (saved.playBlocked) return Promise.resolve();
        if (saved.playPending) return saved.playPending;
        const generation = ++saved.playGeneration;
        saved.record('play');
        let result;
        try { result = methods.play.call(saved.video); } catch (error) { result = Promise.reject(error); }
        const pending = Promise.resolve(result).then(() => {
          if (!active() || generation !== saved.playGeneration || !saved.wantPlaying || saved.video.paused) return;
          saved.lastPlayError = null;
          if (!saved.announced) { saved.announced = true; send({ type: 'attached' }); }
          saved.report('playing', '融合直播正在播放');
        }).catch(error => {
          if (!active() || generation !== saved.playGeneration || !saved.wantPlaying) return;
          saved.lastPlayError = { name: error.name, message: error.message }; saved.record('play-rejected');
          if (error.name === 'AbortError') { saved.report('buffering', '融合画面正在接入'); return; }
          saved.playBlocked = true;
          send({ type: 'play-needed', text: '点击 B 站播放按钮启动融合直播' });
        }).finally(() => { if (saved.playPending === pending) saved.playPending = null; });
        saved.playPending = pending; return pending;
      };
      saved.pause = (user = false) => {
        if (!active()) return;
        if (!user) { blocked(saved, 'pause'); saved.record('page-pause-blocked'); if (saved.video.paused) saved.play(); return; }
        saved.wantPlaying = playbackWanted = false; saved.record('user-pause');
        saved.playGeneration++; saved.playPending = null;
        methods.pause.call(saved.video); saved.report('paused', '融合直播已暂停');
      };
      saved.listeners = Object.fromEntries(['loadeddata', 'playing', 'pause', 'waiting', 'stalled', 'emptied'].map(type => [type, () => {
        if (!active()) return;
        saved.record(type);
        if (type === 'playing' && !saved.video.paused) {
          if (!saved.wantPlaying) { methods.pause.call(saved.video); return; }
          if (!saved.announced) { saved.announced = true; send({ type: 'attached' }); }
          saved.report('playing', '融合直播正在播放');
        } else if (type === 'pause') {
          if (saved.wantPlaying) saved.play();
          else saved.report('paused', '融合直播已暂停');
        } else if (type === 'loadeddata' && saved.wantPlaying) saved.play();
        else if (saved.wantPlaying) saved.report('buffering', '融合画面正在缓冲');
      }]));
      for (const [type, listener] of Object.entries(saved.listeners)) video.addEventListener(type, listener);
      owners.set(video, saved);
      for (const name of Object.keys(properties)) Object.defineProperty(video, name, { configurable: true, get() { return properties[name].get.call(this); }, set(value) { Object.getOwnPropertyDescriptor(media, name).set.call(this, value); } });
      Object.defineProperty(video, 'load', { configurable: true, writable: true, value: media.load });
      Object.defineProperty(video, 'play', { configurable: true, writable: true, value: media.play });
      Object.defineProperty(video, 'pause', { configurable: true, writable: true, value: media.pause });
      const presented = (_now, metadata) => {
        if (!active()) return;
        const now = Date.now();
        if (saved.lastPresented !== null) saved.maxFrameGap = Math.max(saved.maxFrameGap, now - saved.lastPresented);
        saved.presentedFrames++; saved.lastPresented = now; saved.lastMediaTime = metadata.mediaTime;
        saved.presentation();
        saved.frameCallback = video.requestVideoFrameCallback(presented);
      };
      if (video.requestVideoFrameCallback) saved.frameCallback = video.requestVideoFrameCallback(presented);
      presentationStyle = document.createElement('style');
      presentationStyle.textContent = '[data-bili-fusion-presenting="' + token + '"] .web-player-loading,[data-bili-fusion-presenting="' + token + '"] .web-player-video-cover-img-wrap{display:none!important}';
      document.documentElement.append(presentationStyle);
      properties.volume.set.call(video, control.volume); properties.muted.set.call(video, control.muted);
      properties.playbackRate.set.call(video, 1); source.set.call(video, stream); next.after(video); mounts++; layout();
      if (saved.wantPlaying) saved.play(); else methods.pause.call(video);
      bridgeApi();
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
      observer = new MutationObserver(records => {
        if (records.length && records.every(record => record.type === 'attributes' && record.target === binding?.video)) return;
        try { attach(); } catch (error) { fail(error); }
      }); observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      healthTimer = setInterval(() => {
        if (closed || failed || !binding) return;
        bridgeApi();
        binding.presentation();
        const current = binding.video;
        if (binding.wantPlaying && current.paused && !binding.playBlocked) binding.play();
        send({ type: 'native-health', data: { connection: peer.connectionState, sourceMatches: source.get.call(current) === stream, mode: 'isolated-media', apiBridged: Boolean(api), controlBindings: bindings, outputMounts: mounts, presentedFrames: binding.presentedFrames, lastPresented: binding.lastPresented, lastMediaTime: binding.lastMediaTime, maxFrameGap: binding.maxFrameGap, blocked: { ...binding.blocked }, wantPlaying: binding.wantPlaying, playBlocked: binding.playBlocked, lastPlayError: binding.lastPlayError || null, events: [...binding.events], ready: current.readyState, paused: current.paused, time: current.currentTime, width: current.videoWidth, height: current.videoHeight, frames: current.getVideoPlaybackQuality?.().totalVideoFrames, error: current.error?.message || null } });
      }, 2000);
      send({ type: 'ready' });
    } catch (error) { fail(error); }
  });
  window.addEventListener('pagehide', () => current?.close());
})();
