(() => {
  if (!/^\/[1-9]\d{0,17}\/?$/.test(location.pathname)) return;
  let active = null;
  function notifyStudio(value) { chrome.runtime.sendMessage({ type: 'EMBED_LIFECYCLE', active: value }).catch(() => {}); }
  function findPlayer() {
    const videos = [...document.querySelectorAll('video')].filter(video => { const rect = video.getBoundingClientRect(); return rect.width >= 240 && rect.height >= 120; });
    const video = videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!video) return null;
    const host = video.closest('#live-player, #player-mounter, .bilibili-live-player, #player-ctnr, .live-player-mounter, #player-container, .live-player') || video.parentElement;
    return host && !['HTML', 'BODY'].includes(host.tagName) ? host : null;
  }
  function restore() {
    const state = active; if (!state) return; active = null;
    clearTimeout(state.timeout); clearInterval(state.timer); state.native?.postMessage({ type: 'close' }); state.producer?.postMessage({ type: 'close' });
    state.native?.close(); state.producer?.close(); state.frame.remove(); state.host.removeAttribute('data-bili-fusion-host'); notifyStudio(false);
  }
  function showProcessor(state, visible) {
    state.frame.style.width = visible ? '350px' : '1px'; state.frame.style.height = visible ? '100px' : '1px'; state.frame.style.opacity = visible ? '1' : '0';
    state.frame.style.pointerEvents = visible ? 'auto' : 'none'; state.frame.setAttribute('aria-hidden', String(!visible)); state.frame.tabIndex = visible ? 0 : -1;
  }
  function fail(state, text, notifyProducer = true) {
    if (active !== state || state.failed) return;
    state.failed = true; state.attached = false; state.audioNeeded = false; state.status = 'error'; state.text = text;
    clearTimeout(state.timeout); state.native?.postMessage({ type: 'failed' });
    if (notifyProducer) state.producer?.postMessage({ type: 'error', text });
    notifyStudio(false); showProcessor(state, true);
  }
  function apply(token) {
    if (!/^[a-f0-9-]{36}$/i.test(token || '')) throw new Error('请重新打开插件后应用场景');
    const host = active?.host?.isConnected ? active.host : findPlayer();
    if (!host) throw new Error('请等待 B 站原生播放器出现画面后重试');
    restore();
    const frame = document.createElement('iframe');
    const state = { host, frame, token, path: location.pathname, status: 'connecting', text: '正在接入融合直播', attached: false, audioNeeded: false, failed: false };
    active = state; host.setAttribute('data-bili-fusion-host', token);
    frame.title = '融合直播连接'; frame.allow = 'autoplay'; frame.referrerPolicy = 'no-referrer'; frame.src = chrome.runtime.getURL('embed.html') + '#' + token;
    frame.style.cssText = 'position:fixed!important;bottom:20px!important;right:20px!important;max-width:calc(100vw - 24px)!important;border:0!important;border-radius:12px!important;z-index:2147483000!important;';
    showProcessor(state, true); document.documentElement.append(frame);
    state.timeout = setTimeout(() => { if (!state.attached) fail(state, '融合流连接超时，请在插件小窗重新应用'); }, 30000);
    state.timer = setInterval(() => { if (active === state && (!host.isConnected || !frame.isConnected || location.pathname !== state.path)) restore(); }, 1000);
    return { ok: true };
  }
  window.addEventListener('message', event => {
    const state = active;
    if (!state || event.source !== state.frame.contentWindow || event.origin !== 'chrome-extension://' + chrome.runtime.id || event.data?.token !== state.token || event.data.type !== 'BILI_FUSION_PROCESSOR_READY' || state.producer) return;
    const nativeChannel = new MessageChannel(), producerChannel = new MessageChannel();
    state.native = nativeChannel.port1; state.producer = producerChannel.port1;
    state.native.onmessage = event => {
      if (active !== state || state.failed) return; const data = event.data;
      if (['ready', 'answer', 'candidate'].includes(data?.type)) state.producer.postMessage(data);
      else if (data?.type === 'attached') { state.attached = true; state.status = 'playing'; state.text = '已接入 B 站原生播放器'; clearTimeout(state.timeout); notifyStudio(true); state.producer.postMessage(data); showProcessor(state, state.audioNeeded); }
      else if (data?.type === 'error') fail(state, data.text);
      else if (data?.type === 'play-needed') { state.text = data.text; state.producer.postMessage(data); showProcessor(state, true); }
    };
    state.producer.onmessage = event => {
      if (active !== state) return; const data = event.data;
      if (data?.type === 'close') { restore(); return; }
      if (state.failed) return;
      if (['offer', 'candidate', 'stream-ready'].includes(data?.type)) state.native.postMessage(data);
      else if (data?.type === 'state') {
        if (data.error) { fail(state, data.text, false); return; }
        state.text = data.text; state.audioNeeded = data.audioNeeded === true; state.status = state.attached ? 'playing' : 'connecting'; showProcessor(state, !state.attached || state.audioNeeded);
      }
    };
    state.native.start(); state.producer.start();
    window.postMessage({ type: 'BILI_FUSION_NATIVE_INIT', token: state.token }, location.origin, [nativeChannel.port2]);
    state.frame.contentWindow.postMessage({ type: 'BILI_FUSION_PROCESSOR_PORT', token: state.token }, event.origin, [producerChannel.port2]);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('launcher.html')) return;
    try {
      if (message?.type === 'FUSION_EMBED_STATUS') respond({ active: Boolean(active), status: active?.status, text: active?.text });
      else if (message?.type === 'FUSION_EMBED_APPLY') respond(apply(message.token));
      else if (message?.type === 'FUSION_EMBED_RESTORE') { restore(); respond({ ok: true }); }
    } catch (error) { respond({ ok: false, error: error.message }); }
  });
  window.addEventListener('pagehide', restore, { once: true });
})();
