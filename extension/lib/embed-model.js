import { CHANNELS, parseRoomId, sanitizeScene } from './model.js';

export function isLiveRoomUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'live.bilibili.com' && /^\/[1-9]\d{0,17}\/?$/.test(url.pathname); }
  catch { return false; }
}
export function embeddedScene(saved) {
  if (!saved) throw new Error('请先在工作台连接直播间并保存场景');
  const scene = sanitizeScene(saved);
  const rooms = CHANNELS.map(id => ({ id, room: parseRoomId(scene.sources[id].room) })).filter(item => item.room);
  if (!rooms.length) throw new Error('请先在工作台填写直播间，再应用到网页');
  scene.audio.monitor = true;
  return { scene, rooms };
}

export function validEmbedGrant(grant, sender, token, extensionId, now = Date.now()) {
  if (!/^[a-f0-9-]{36}$/i.test(token || '') || sender?.id !== extensionId || !Number.isInteger(sender.tab?.id) || !(sender.frameId > 0)) return false;
  try {
    const url = new URL(sender.url);
    if (url.protocol !== 'chrome-extension:' || url.hostname !== extensionId || url.pathname !== '/embed.html' || url.search || url.hash !== '#' + token) return false;
  } catch { return false; }
  return Boolean(grant && grant.tabId === sender.tab.id && grant.expires > now && grant.expires <= now + 60000);
}
