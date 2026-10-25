import { openStudio } from './lib/launch.js';
import { BilibiliApi } from './lib/bilibili-api.js';
import { ensureLiveNetwork } from './lib/live-network.js';
import { validEmbedGrant } from './lib/embed-model.js';

const studioUrl = chrome.runtime.getURL('studio.html');
const api = new BilibiliApi({ cookie: async name => (await chrome.cookies.get({ url: 'https://www.bilibili.com/', name }))?.value || null });
// Only this extension's API, media and WebSocket requests receive these headers.
const networkReady = ensureLiveNetwork();
// Keep startup errors available for the first request without an unhandled
// rejection when the worker starts before a studio is open.
networkReady.catch(() => {});
let embeddedTabsUpdate = Promise.resolve();
function updateEmbeddedTab(tabId, active) {
  embeddedTabsUpdate = embeddedTabsUpdate.catch(() => {}).then(async () => {
    if (active) await roomTab(tabId);
    const key = 'fusion-embedded-tabs', stored = await chrome.storage.session.get(key);
    const previous = stored[key] || [], ids = new Set(previous);
    if (active) ids.add(tabId); else ids.delete(tabId);
    if (ids.size !== previous.length || previous.some(id => !ids.has(id))) await chrome.storage.session.set({ [key]: [...ids] });
  });
  return embeddedTabsUpdate;
}

chrome.action.onClicked.addListener(() => {
  openStudio().catch(error => console.error('打开工作台失败', error));
});

function isStudio(sender) {
  return sender.id === chrome.runtime.id && sender.url === studioUrl;
}

async function roomTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('请选择直播间标签页');
  const tab = await chrome.tabs.get(tabId);
  if (!/^https:\/\/live\.bilibili\.com\/\d+(?:[/?#]|$)/.test(tab.url || '')) {
    throw new Error('目标标签页不是 Bilibili 直播间');
  }
  return tab;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'EMBED_LIFECYCLE' && sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && sender.frameId === 0) {
    updateEmbeddedTab(sender.tab.id, message.active === true).catch(() => {});
    return;
  }
  if (message?.type === 'EMBED_AUTHORIZE') {
    (async () => {
      const token = message.token, key = 'fusion-embed-' + token;
      const grant = (await chrome.storage.session.get(key))[key];
      if (!validEmbedGrant(grant, sender, token, chrome.runtime.id)) throw new Error('请在当前直播间通过插件小窗开启融合播放');
      await roomTab(sender.tab.id); await chrome.storage.session.remove(key);
      return { ok: true };
    })().then(respond, error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'ROOM_EVENT') {
    if (sender.id !== chrome.runtime.id || !sender.tab?.id ||
        !/^https:\/\/live\.bilibili\.com\/\d+(?:[/?#]|$)/.test(sender.url || '')) return;
    if (!['danmaku', 'state'].includes(message.event)) return;
    (async () => {
      let data = message.data;
      if (message.event === 'danmaku' && Array.isArray(data)) {
        const uid = (await chrome.cookies.get({ url: 'https://www.bilibili.com/', name: 'DedeUserID' }))?.value;
        data = data.slice(0, 80).map(item => ({ ...item, self: Boolean(uid && String(item?.uid) === uid) }));
      }
      await chrome.runtime.sendMessage({ type: 'SOURCE_EVENT', tabId: sender.tab.id, event: message.event, data });
    })().catch(() => {});
    return;
  }
  if (!isStudio(sender)) return;
  (async () => {
    switch (message?.type) {
      case 'LIVE_PLAY_INFO': await networkReady; return api.play(message.roomId, message.quality);
      case 'LIVE_DANMAKU_SESSION': await networkReady; return api.danmaku(message.roomId);
      case 'LIVE_SEND_DANMAKU': await networkReady; return api.send(message.roomId, message.text);
      case 'LIST_ROOMS': {
        const tabs = await chrome.tabs.query({ url: 'https://live.bilibili.com/*' });
        return tabs.filter(tab => /^https:\/\/live\.bilibili\.com\/\d+(?:[/?#]|$)/.test(tab.url || ''))
          .map(tab => ({ id: tab.id, title: tab.title || 'Bilibili 直播间', url: tab.url, muted: tab.mutedInfo?.muted }));
      }
      case 'OPEN_ROOM': {
        const roomId = String(message.roomId || '');
        if (!/^[1-9]\d{0,17}$/.test(roomId)) throw new Error('请输入正确的房间号或直播间链接');
        const tab = await chrome.tabs.create({ url: `https://live.bilibili.com/${roomId}`, active: false });
        return { id: tab.id, title: `直播间 ${roomId}`, url: `https://live.bilibili.com/${roomId}` };
      }
      case 'ROOM_COMMAND': {
        await roomTab(message.tabId);
        if (!['GET_STATE', 'SEND_DANMAKU'].includes(message.command?.type)) throw new Error('无效的直播间操作');
        try { return await chrome.tabs.sendMessage(message.tabId, message.command); }
        catch { throw new Error('无法连接直播间，请刷新该直播间页面后重试'); }
      }
      default: throw new Error('未知操作');
    }
  })().then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  updateEmbeddedTab(tabId, false).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') updateEmbeddedTab(tabId, false).catch(() => {});
});
