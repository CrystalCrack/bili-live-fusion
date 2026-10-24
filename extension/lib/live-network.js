import { withTimeout } from './async.js';

const readyByApi = new WeakMap();

// Extension pages can set their own already-granted network rules. Live media
// must not wait for a background worker to receive or reply to a message.
export function ensureLiveNetwork(api = globalThis.chrome) {
  if (readyByApi.has(api)) return readyByApi.get(api);
  const ready = withTimeout((async () => {
    const origins = ['https://*.bilibili.com/*', 'https://*.bilivideo.com/*', 'https://*.bilivideo.cn/*', 'https://*.biliapi.net/*'];
    if (!await api.permissions.contains({ origins })) throw new Error('请在扩展详情的“网站访问权限”中允许访问 B 站和直播资源');
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1001], addRules: [{ id: 1001, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://live.bilibili.com/' },
        { header: 'Origin', operation: 'set', value: 'https://live.bilibili.com' }
      ] }, condition: { initiatorDomains: [api.runtime.id],
        requestDomains: ['bilibili.com', 'bilivideo.com', 'bilivideo.cn', 'biliapi.net'],
        resourceTypes: ['xmlhttprequest', 'media', 'websocket'] } }]
    });
  })(), 5000, '直播网络设置响应超时，请重新加载扩展');
  readyByApi.set(api, ready);
  ready.catch(() => { if (readyByApi.get(api) === ready) readyByApi.delete(api); });
  return ready;
}
