(() => {
  if (!/^\/\d+(?:\/|$)/.test(location.pathname)) return;
  const itemSelector = '.chat-item.danmaku-item, .danmaku-item[data-danmaku], .chat-item[data-danmaku], [data-type="danmaku"]';
  const textSelectors = ['.danmaku-content', '.danmaku-text', '.danmaku-item-right', '.text', '[data-danmaku]'];
  const seenNodes = new WeakMap();
  let batch = [], flushTimer = null, lastSent = 0, observer = null, root = null, connected = true;
  const emit = (event, data) => {
    if (!connected) return;
    try { chrome.runtime.sendMessage({ type: 'ROOM_EVENT', event, data }).catch(() => { connected = false; cleanup(); }); }
    catch { connected = false; cleanup(); }
  };
  function flush() { flushTimer = null; if (batch.length) { emit('danmaku', batch); batch = []; } }
  function collect(element, initial = false) {
    if (!(element instanceof Element)) return;
    const elements = element.matches(itemSelector) ? [element] : [...element.querySelectorAll(itemSelector)];
    for (const node of elements.slice(-80)) {
      const content = textSelectors.map(selector => node.querySelector(selector)).find(Boolean);
      const raw = node.getAttribute('data-danmaku') || content?.textContent || '';
      const text = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
      const userElement = node.querySelector('.user-name, .user-name-content, .username, [data-user-name]');
      const user = (node.getAttribute('data-uname') || userElement?.getAttribute('data-user-name') || userElement?.textContent || '').replace(/[:：]\s*$/, '').trim().slice(0, 50);
      const uid = (node.getAttribute('data-uid') || userElement?.getAttribute('data-uid') || '').slice(0, 30);
      const fingerprint = `${uid}\u0000${user}\u0000${text}`;
      if (seenNodes.get(node) === fingerprint) continue;
      // Mark after extracting text, so a reused virtual-list node can emit again.
      seenNodes.set(node, fingerprint);
      if (initial || !text) continue;
      batch.push({ text, user, uid, timestamp: Date.now() });
      if (batch.length > 80) batch.shift();
    }
    if (batch.length && !flushTimer) flushTimer = setTimeout(flush, 120);
  }
  function attachObserver() {
    if (!connected) return;
    const nextRoot = document.querySelector('#chat-items, .chat-history-list, .chat-history-panel .chat-list, .chat-items');
    if (nextRoot === root && root?.isConnected) return;
    if (!nextRoot) { observer?.disconnect(); root = null; return; }
    observer?.disconnect(); root = nextRoot; collect(root, true);
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (node instanceof Element) { const item = node.closest(itemSelector); collect(item || node); }
            else if (node.parentElement) { const item = node.parentElement.closest(itemSelector); if (item) collect(item); }
          }
        } else { const el = record.target instanceof Element ? record.target : record.target.parentElement; const item = el?.closest(itemSelector); if (item) collect(item); }
      }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-danmaku', 'data-uid', 'data-uname'] });
  }
  function getState() {
    const videos = [...document.querySelectorAll('video')].filter(video => { const r = video.getBoundingClientRect(); return r.width > 100 && r.height > 80; });
    const video = videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const rect = video?.getBoundingClientRect();
    return {
      roomId: location.pathname.match(/^\/(\d+)/)?.[1] || '',
      title: document.querySelector('.live-title .text, .room-title, h1')?.textContent?.trim()?.slice(0, 100) || document.title.slice(0, 100),
      hasChat: Boolean(root?.isConnected), playing: Boolean(video && !video.paused),
      viewport: { width: innerWidth, height: innerHeight },
      videoRect: rect ? { x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: Math.min(innerWidth, rect.right) - Math.max(0, rect.left), height: Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top) } : null
    };
  }
  function visible(element) { return Boolean(element && element.getClientRects().length && !element.disabled); }
  async function sendDanmaku(text) {
    const message = String(text || '').trim();
    if (!message || message.length > 200) throw new Error('请输入 1–200 字的弹幕');
    if (Date.now() - lastSent < 5000) throw new Error('请等待 5 秒后再发送');
    const candidates = [...document.querySelectorAll('.chat-input-ctnr textarea, .chat-input textarea, textarea.chat-input, #chat-control-panel-vm textarea, .chat-input [contenteditable="true"], .chat-control-panel [contenteditable="true"]')];
    const input = candidates.find(visible);
    if (!input) throw new Error('请先在直播间登录并打开弹幕输入区');
    if (input.maxLength > 0 && message.length > input.maxLength) throw new Error(`该直播间当前最多支持 ${input.maxLength} 字`);
    const container = input.closest('.chat-control-panel, .chat-control-panel-ctnr, #chat-control-panel-vm') || input.closest('.chat-input-ctnr')?.parentElement || input.parentElement?.parentElement;
    const findSendButton = () => [...(container?.querySelectorAll('button, .bl-button, .send-btn, .chat-send-btn, [role="button"]') || [])]
      .find(button => /^(发送|发射)$/.test(button.textContent.trim()) && button.getClientRects().length);
    let sendButton = findSendButton();
    if (!sendButton) throw new Error('请在直播间完成登录或平台提示后再发送');
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      setter.call(input, message); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      input.textContent = message; input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
    }
    // Vue/React can enable or replace the send control on their next render.
    await new Promise(resolve => setTimeout(resolve, 60));
    sendButton = findSendButton();
    if (!visible(sendButton) || sendButton.getAttribute('aria-disabled') === 'true' || sendButton.classList.contains('disabled')) throw new Error('请在直播间完成登录或平台提示后再发送');
    sendButton.click(); lastSent = Date.now();
    return { submitted: true, roomId: getState().roomId };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    try {
      if (message?.type === 'GET_STATE') { attachObserver(); respond({ ok: true, data: getState() }); }
      if (message?.type === 'SEND_DANMAKU') {
        sendDanmaku(message.text).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
        return true;
      }
    } catch (error) { respond({ ok: false, error: error.message }); }
  });
  const poll = setInterval(() => { attachObserver(); emit('state', getState()); }, 4000);
  function cleanup() { observer?.disconnect(); clearInterval(poll); clearTimeout(flushTimer); batch = []; }
  addEventListener('pagehide', cleanup, { once: true });
  attachObserver(); emit('state', getState());
})();
