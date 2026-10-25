import { openStudio } from './lib/launch.js';
import { embeddedScene, isLiveRoomUrl } from './lib/embed-model.js';
import { withTimeout } from './lib/async.js';
import { accelerationStatus } from './lib/acceleration-status.js';

const $ = selector => document.querySelector(selector);
let tabId, applying = false, healthTimer;
function status(text, error = false) { $('#launch-status').textContent = text; $('#launch-status').classList.toggle('error', error); }
function updateAcceleration(state) {
  const info = state?.active ? accelerationStatus(state.diagnostics) : null;
  $('#acceleration').hidden = !info;
  if (!info) return;
  $('#acceleration-title').textContent = info.title; $('#acceleration-device').textContent = info.device; $('#acceleration-details').textContent = info.details;
}
async function roomMessage(type, data = {}) {
  try { return await withTimeout(chrome.tabs.sendMessage(tabId, { type, ...data }), 5000, '网页响应超时，请刷新直播间后重试'); }
  catch { throw new Error('请刷新当前直播间页面，再点击插件'); }
}
async function initialize() {
  const [tabs, stored] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), chrome.storage.local.get('fusion-scene-v1')]);
  const tab = tabs[0]; tabId = tab?.id;
  let config;
  try { config = embeddedScene(stored['fusion-scene-v1']); } catch { /* Offer setup when a saved live source is absent. */ }
  $('#scene-name').textContent = config?.scene.name || '先在工作台保存场景';
  $('#scene-rooms').textContent = config ? config.rooms.map(({ id, room }) => id + ' · ' + room).join('　/　') : '连接直播间并调整布局、画质和声音';
  if (!Number.isInteger(tabId) || !isLiveRoomUrl(tab?.url)) { status('打开 B 站直播间后，可在这里应用融合画面'); return; }
  const state = await roomMessage('FUSION_EMBED_STATUS');
  updateAcceleration(state);
  if (state?.active) healthTimer = setInterval(async () => { try { updateAcceleration(await roomMessage('FUSION_EMBED_STATUS')); } catch { clearInterval(healthTimer); } }, 2000);
  $('#restore-player').hidden = !state?.active;
  $('#copy-diagnostics').hidden = !state?.active;
  if (!config) { status('先打开工作台，配置并保存直播间'); return; }
  $('#embed-live').disabled = false; $('#restore-player').hidden = !state?.active;
  $('#embed-live span').textContent = state?.active ? '应用最新配置' : '在当前直播页播放';
  status(state?.active ? state.text || '当前直播页正在播放融合画面' : '准备就绪，使用已保存的布局、画质和混音', state?.status === 'error');
}
$('#open-studio').addEventListener('click', async event => {
  event.preventDefault();
  try { await openStudio(); window.close(); } catch (error) { status(error.message || '打开工作台失败，请重试', true); }
});
$('#embed-live').addEventListener('click', async () => {
  if (applying) return; applying = true; $('#embed-live').disabled = true; status('正在接入网页播放器…');
  const token = crypto.randomUUID(), key = 'fusion-embed-' + token;
  try {
    await chrome.storage.session.set({ [key]: { tabId, expires: Date.now() + 60000 } });
    const result = await roomMessage('FUSION_EMBED_APPLY', { token });
    if (!result?.ok) throw new Error(result?.error || '接入失败，请重试'); window.close();
  }
  catch (error) { await chrome.storage.session.remove(key).catch(() => {}); status(error.message, true); }
  finally { applying = false; $('#embed-live').disabled = false; }
});
$('#restore-player').addEventListener('click', async () => {
  try { await roomMessage('FUSION_EMBED_RESTORE'); window.close(); } catch (error) { status(error.message, true); }
});
$('#copy-diagnostics').addEventListener('click', async () => {
  try { const state = await roomMessage('FUSION_EMBED_STATUS'); await navigator.clipboard.writeText(JSON.stringify(state?.diagnostics || {}, null, 2)); status('播放信息已复制'); }
  catch (error) { status(error.message || '复制失败，请重试', true); }
});
initialize().catch(error => status(error.message || '配置读取失败，请重新打开插件', true));
window.addEventListener('pagehide', () => clearInterval(healthTimer), { once: true });
