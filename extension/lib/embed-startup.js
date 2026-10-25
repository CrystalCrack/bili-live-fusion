import { isLiveRoomUrl, validEmbedGrant } from './embed-model.js';
import { withTimeout } from './async.js';

// A web-accessible extension page can read its own session grant directly.
// Starting playback must not depend on waking a worker or a message reply.
export async function authorizeEmbed(token, url, browser = globalThis.chrome, timeout = 4000) {
  if (!/^[a-f0-9-]{36}$/i.test(token || '')) throw new Error('请从插件小窗重新应用场景');
  const key = 'fusion-embed-' + token;
  const [stored, tab] = await Promise.all([
    withTimeout(browser.storage.session.get(key), timeout, '启动授权读取超时，请重新加载扩展后刷新直播页'),
    withTimeout(browser.tabs.getCurrent(), timeout, '当前直播页识别超时，请刷新直播页后重试')
  ]);
  const sender = { id: browser.runtime.id, tab, frameId: 1, url };
  if (!isLiveRoomUrl(tab?.url) || !validEmbedGrant(stored[key], sender, token, browser.runtime.id)) throw new Error('启动授权已失效，请在当前直播页重新应用场景');
  await withTimeout(browser.storage.session.remove(key), timeout, '启动授权确认超时，请重新应用场景');
  return { tabId: tab.id };
}
