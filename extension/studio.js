import { CHANNELS, RESOLUTIONS, clamp, number, defaultScene, parseRoomId, sanitizeScene, normalizeCrop, applyPreset, DanmakuFilter, compileFilterRegex } from './lib/model.js';
import { AudioMixer } from './lib/audio.js';
import { Compositor } from './lib/renderer.js';
import { createDemo } from './lib/demo.js';
import { OutputServer } from './lib/output-channel.js';
import { CropEditor } from './lib/crop-editor.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const extension = Boolean(globalThis.chrome?.runtime?.id);
const STORAGE_KEY = 'fusion-scene-v1';
let scene = defaultScene();
let rooms = [], savedTimer, meterTimer, demoTimer, demoCounter = 0, filteredCount = 0;
let recorder = null, recordStream = null, recordChunks = [], recordingStarted = 0, recordTimer = null, recordingUrl = null;
let hasUnsavedRecording = false, outputServer = null, sendBusy = false, restoring = false, recordPending = false, demoPending = false;
const sources = Object.fromEntries(CHANNELS.map(id => [id, { video: $(`#video-${id}`), stream: null, tabId: null, state: null, demo: null, pending: false }]));
const mixer = new AudioMixer();
const compositor = new Compositor($('#composite'), () => scene, () => sources);
let filter = new DanmakuFilter();
let cropEditor;

function toast(message, type = 'success') {
  const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = message;
  $('#toast-region').append(el); setTimeout(() => el.remove(), type === 'error' ? 6500 : 4200);
  while ($('#toast-region').children.length > 4) $('#toast-region').firstElementChild.remove();
}
async function request(message) {
  if (!extension) throw new Error('请在 Edge 加载 extension 文件夹后使用直播间功能；当前页面可体验演示');
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '直播间连接中断，请刷新直播间后重试');
  return response.data;
}
async function roomCommand(id, command) {
  if (!sources[id].tabId) throw new Error(`请先为 ${id} 关联一个直播间标签页`);
  const response = await request({ type: 'ROOM_COMMAND', tabId: sources[id].tabId, command });
  if (!response?.ok) throw new Error(response?.error || '直播间操作失败');
  return response.data;
}
function saveScene() {
  if (restoring) return;
  clearTimeout(savedTimer);
  $('#save-status').textContent = '正在保存…';
  savedTimer = setTimeout(async () => {
    try {
      const data = sanitizeScene(scene);
      if (extension) await chrome.storage.local.set({ [STORAGE_KEY]: data });
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      $('#save-status').replaceChildren();
      const dot = document.createElement('span'); dot.className = 'tiny-dot';
      $('#save-status').append(dot, document.createTextNode(' 场景已保存'));
    } catch { $('#save-status').textContent = '保存失败，可导出场景'; }
  }, 400);
}
function changed() { mixer.update(scene); saveScene(); }
function setValue(selector, value, force = false) {
  const input = $(selector); if (force || document.activeElement !== input) input.value = value;
}
function segmented(selector, value) {
  $$(selector + ' button').forEach(button => { button.classList.toggle('active', button.dataset.mode === value); button.setAttribute('aria-pressed', String(button.dataset.mode === value)); });
}
function updatePresetUI() {
  $$('[data-preset]').forEach(button => { const active = scene.layout === button.dataset.preset; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
}
function updateSelection() {
  const settings = scene.sources[scene.selected], box = $('#selection-box');
  const any = CHANNELS.some(id => sources[id].stream);
  box.classList.toggle('visible', any && settings.visible);
  box.classList.toggle('b', scene.selected === 'B');
  Object.assign(box.style, { left: `${settings.x}%`, top: `${settings.y}%`, width: `${settings.w}%`, height: `${settings.h}%` });
  $('#selection-label').textContent = `直播间 ${scene.selected}`;
  $('#empty-stage').hidden = any;
}
function updateInspector() {
  const id = scene.selected, source = scene.sources[id];
  $$('[data-source-card]').forEach(card => card.classList.toggle('selected', card.dataset.sourceCard === id));
  $('#inspector-badge').textContent = id; $('#inspector-badge').className = `source-badge ${id.toLowerCase()}`;
  $('#inspector-title').textContent = `直播间 ${id}`; $('#source-visible').checked = source.visible;
  for (const key of ['x', 'y', 'w', 'h']) { setValue(`#position-${key}`, Math.round(source[key] * 10) / 10); setValue(`#crop-${key}`, Math.round(source.crop[key] * 10) / 10); }
  $('#position-x').max = String(100 - source.w); $('#position-y').max = String(100 - source.h);
  $('#position-w').max = String(100 - source.x); $('#position-h').max = String(100 - source.y);
  setValue('#source-fit', source.fit); setValue('#source-opacity', source.opacity); $('#opacity-value').textContent = `${source.opacity}%`;
  updateSelection();
}
function selectSource(id) { scene.selected = id; updateInspector(); saveScene(); }
function updateConnected() {
  let count = 0, demo = false;
  for (const id of CHANNELS) {
    const source = sources[id], stream = source.stream, connected = Boolean(stream?.getVideoTracks().some(track => track.readyState === 'live'));
    if (connected) count++; if (source.demo) demo = true;
    const status = $(`[data-status="${id}"]`); status.textContent = source.pending ? '选择中' : source.demo ? '演示中' : connected ? '采集中' : '未连接';
    status.classList.toggle('connected', connected); status.classList.toggle('warning', Boolean(source.pending));
    $(`[data-thumbnail="${id}"]`).classList.toggle('connected', connected);
    const connect = $(`[data-connect="${id}"]`); connect.disabled = source.pending; connect.querySelector('span').textContent = connected ? `重新采集 ${id}` : `采集直播间 ${id}`;
    $(`[data-disconnect="${id}"]`).disabled = !stream;
    $(`[data-source-title="${id}"]`).textContent = source.demo ? '演示画面 · 合成音频' : connected ? `${stream.getAudioTracks().some(track => track.readyState === 'live') ? '音频已接入' : '仅画面'} · ${source.tabId ? '弹幕已关联' : '未关联弹幕'}` : '画面 · 音频 · 弹幕';
  }
  $('#source-count').textContent = `${count} / 2 已接入`; $('#demo-status').hidden = !demo;
  $('#demo-button').classList.toggle('demo-running', demo);
  updateSelection();
  if (!demo && demoTimer) { clearInterval(demoTimer); demoTimer = null; }
}
function syncScene() {
  for (const id of CHANNELS) {
    setValue(`#room-${id}`, scene.sources[id].room, true);
    setValue(`#volume-${id}`, scene.sources[id].volume, true); $(`#volume-value-${id}`).textContent = `${scene.sources[id].volume}%`;
    $(`#voice-${id}`).checked = scene.sources[id].voice;
    setValue(`#pan-${id}`, scene.sources[id].pan, true); setValue(`#delay-${id}`, scene.sources[id].delay, true);
    $(`[data-mute="${id}"]`).classList.toggle('muted', scene.sources[id].muted);
    $(`[data-mute="${id}"]`).setAttribute('aria-pressed', String(scene.sources[id].muted));
    $(`[data-mute="${id}"] use`).setAttribute('href', scene.sources[id].muted ? '#i-muted' : '#i-volume');
  }
  segmented('#audio-mode', scene.audio.mode); segmented('#danmaku-mode', scene.danmaku.mode);
  setValue('#master-volume', scene.audio.master, true); $('#master-value').textContent = `${scene.audio.master}%`;
  $('#monitor-toggle').checked = scene.audio.monitor; $('#danmaku-toggle').checked = scene.danmaku.show;
  setValue('#resolution', scene.resolution, true); setValue('#fps', scene.fps, true); setValue('#background-color', scene.background, true);
  $('#background-value').textContent = scene.background.toUpperCase();
  const [width, height] = RESOLUTIONS[scene.resolution];
  $('#canvas-size').textContent = `${width} × ${height}`; $('#fps-label').textContent = `${scene.fps} FPS`;
  $('#canvas-stage').style.aspectRatio = `${width} / ${height}`;
  $('#scene-name').value = scene.name;
  updateInspector(); updatePresetUI(); updateConnected(); updateFilterIndicator(); mixer.update(scene);
}
function buildAudioTracks() {
  // Only fixed channel identifiers enter this markup; live text uses textContent.
  for (const id of CHANNELS) {
    const wrapper = document.createElement('div'); wrapper.className = 'audio-track-wrapper';
    wrapper.innerHTML = `<div class="audio-track"><span class="source-badge ${id.toLowerCase()}">${id}</span><div class="audio-track-info"><strong>直播间 ${id}</strong><small id="db-${id}">−∞ dB</small></div><div class="meter-stack" aria-label="${id} 音频电平"><div class="meter-bar"><div class="meter-fill" id="meter-${id}-1"></div></div><div class="meter-bar"><div class="meter-fill" id="meter-${id}-2"></div></div></div><button class="icon-button mute-button" data-mute="${id}" title="静音 / 取消静音 ${id}" aria-label="静音 / 取消静音 ${id}" aria-pressed="false"><svg><use href="#i-volume"/></svg></button><input id="volume-${id}" type="range" min="0" max="150" value="80" aria-label="${id} 音量"><output id="volume-value-${id}" class="audio-value">80%</output><label class="voice-toggle" title="人声频段增强与动态压缩"><input id="voice-${id}" type="checkbox">语音增强</label></div><div class="audio-track-options"><label>声像 <input id="pan-${id}" type="number" min="-100" max="100" value="0" title="-100 左声道，100 右声道"></label><label>延迟 <input id="delay-${id}" type="number" min="0" max="2000" step="10" value="0">ms</label></div>`;
    $('#audio-tracks').append(wrapper);
    $(`#volume-${id}`).addEventListener('input', event => { scene.sources[id].volume = number(event.target.value, 80); $(`#volume-value-${id}`).textContent = `${scene.sources[id].volume}%`; changed(); });
    $(`#voice-${id}`).addEventListener('change', event => { scene.sources[id].voice = event.target.checked; changed(); });
    $(`#pan-${id}`).addEventListener('change', event => { scene.sources[id].pan = clamp(number(event.target.value), -100, 100); event.target.value = scene.sources[id].pan; changed(); });
    $(`#delay-${id}`).addEventListener('change', event => { scene.sources[id].delay = clamp(number(event.target.value), 0, 2000); event.target.value = scene.sources[id].delay; changed(); });
    $(`[data-mute="${id}"]`).addEventListener('click', () => { scene.sources[id].muted = !scene.sources[id].muted; syncScene(); changed(); });
  }
}
async function refreshRooms({ quiet = false } = {}) {
  if (!extension) return;
  try {
    rooms = await request({ type: 'LIST_ROOMS' });
    for (const id of CHANNELS) {
      const select = $(`#tab-${id}`), previous = sources[id].tabId;
      select.replaceChildren(new Option('关联已打开的直播间 · 弹幕', ''));
      for (const room of rooms) select.add(new Option(room.title, String(room.id)));
      const matching = rooms.find(room => room.id === previous) || (!previous && rooms.find(room => parseRoomId(room.url) === parseRoomId(scene.sources[id].room)));
      sources[id].tabId = matching?.id || null; select.value = matching ? String(matching.id) : '';
      if (matching) await refreshRoomState(id, true);
    }
    updateConnected(); if (!quiet) toast(`找到 ${rooms.length} 个直播间标签页`);
  } catch (error) { if (!quiet) toast(error.message, 'error'); }
}
async function refreshRoomState(id, quiet = false) {
  try { sources[id].state = await roomCommand(id, { type: 'GET_STATE' }); return sources[id].state; }
  catch (error) { sources[id].state = null; if (!quiet) toast(error.message, 'error'); return null; }
}
async function openRoom(id) {
  const roomId = parseRoomId($(`#room-${id}`).value);
  if (!roomId) { toast('请输入正确的房间号，或完整的 Bilibili 直播间链接', 'error'); return; }
  try {
    scene.sources[id].room = roomId; $(`#room-${id}`).value = roomId; saveScene();
    const existing = rooms.find(room => parseRoomId(room.url) === roomId);
    if (existing) { sources[id].tabId = existing.id; await refreshRooms({ quiet: true }); toast(`已关联直播间 ${roomId}`); return; }
    const tab = await request({ type: 'OPEN_ROOM', roomId });
    sources[id].tabId = tab.id;
    if (!rooms.some(room => room.id === tab.id)) rooms.push(tab);
    for (const key of CHANNELS) {
      if (![...$(`#tab-${key}`).options].some(option => option.value === String(tab.id))) $(`#tab-${key}`).add(new Option(tab.title, String(tab.id)));
    }
    $(`#tab-${id}`).value = String(tab.id); updateConnected();
    toast(`直播间 ${roomId} 已在新标签页打开，开始播放后即可采集`);
  } catch (error) { toast(error.message, 'error'); }
}
function disconnectSource(id, notify = true) {
  const source = sources[id], stream = source.stream;
  source.stream = null; source.video.srcObject = null;
  source.demo?.stop(); source.demo = null;
  stream?.getTracks().forEach(track => track.stop()); mixer.detach(id);
  updateConnected(); if (notify) toast(`已断开直播间 ${id} 的画面和音频`);
}
async function attachSource(id, stream, demo = null) {
  disconnectSource(id, false);
  const source = sources[id]; source.stream = stream; source.demo = demo;
  source.video.srcObject = stream; source.video.muted = true;
  await source.video.play();
  try { await mixer.attach(id, stream); }
  catch (error) { toast(`音频接入失败：${error.message}`, 'warning'); }
  stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (source.stream === stream) disconnectSource(id); }, { once: true });
  stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (source.stream === stream) { mixer.detach(id); updateConnected(); toast(`直播间 ${id} 的音频采集已结束`, 'warning'); } }, { once: true }));
  mixer.update(scene); selectSource(id); updateConnected();
}
async function captureSource(id) {
  if (CHANNELS.some(key => sources[key].pending) || demoPending) return;
  if (!navigator.mediaDevices?.getDisplayMedia) { toast('请在 Edge 扩展页面或本机预览地址中打开工作台', 'error'); return; }
  sources[id].pending = true; updateConnected();
  let stream;
  try {
    // Keep the browser picker in the initiating user gesture. Each source has
    // its own explicit browser consent; no background or automatic capture.
    const capture = navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: { ideal: scene.fps, max: 60 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: true },
      selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', systemAudio: 'exclude'
    });
    const [captured, audioReady] = await Promise.allSettled([capture, mixer.init()]);
    if (captured.status === 'rejected') throw captured.reason;
    stream = captured.value;
    if (audioReady.status === 'rejected') toast('音频引擎正在等待浏览器授权，请点击“本机监听”开启', 'warning');
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('没有获取到画面，请重新选择直播间标签页');
    if (track.getSettings().displaySurface && track.getSettings().displaySurface !== 'browser') {
      stream.getTracks().forEach(item => item.stop()); throw new Error('请选择“标签页”中的直播间，以便分别混合两路声音');
    }
    await attachSource(id, stream);
    // New screen shares start with their full source frame. An existing crop is
    // preserved, and can be aligned with the linked player's region explicitly.
    await refreshRoomState(id, true);
    toast(`直播间 ${id} 画面已接入${stream.getAudioTracks().length ? '，音频已接入' : '；需要声音时请重新采集并勾选标签页音频'}`);
  } catch (error) {
    if (stream && sources[id].stream !== stream) stream.getTracks().forEach(track => track.stop());
    if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') toast(error.message || '采集失败，请重试', 'error');
  } finally { sources[id].pending = false; updateConnected(); }
}
async function startDemo() {
  if (CHANNELS.some(id => sources[id].pending) || demoPending) return;
  if (CHANNELS.some(id => sources[id].stream && !sources[id].demo)) { toast('请先断开正在采集的直播源，再体验演示', 'warning'); return; }
  demoPending = true; $('#demo-button').disabled = true;
  try {
    await mixer.init();
    for (const id of CHANNELS) { const demo = createDemo(id, mixer.context); await attachSource(id, demo.stream, demo); }
    if (!demoTimer) demoTimer = setInterval(() => {
      const samples = ['这个同屏好舒服', '两个现场，一起听见', '晚上好呀 ✨', '自由布局有点好看', '今天也要开心', '前排入座！', '这氛围刚刚好', '山野与夜航，同屏了'];
      const source = demoCounter++ % 2 ? 'B' : 'A';
      if (sources[source].demo) acceptDanmaku({ source, text: samples[Math.floor(Math.random() * samples.length)], user: source === 'A' ? '山间来客' : '夜航旅人', uid: `demo-${source}`, timestamp: Date.now() });
    }, 1700);
    updateConnected(); selectSource('A'); toast('演示已开启：两路动画、合成音频与示例弹幕已接入');
  } catch (error) { toast(`演示启动失败：${error.message}`, 'error'); }
  finally { demoPending = false; $('#demo-button').disabled = false; }
}
function acceptDanmaku(item) {
  try {
    if (!filter.accept(item, scene.danmaku)) { filteredCount++; return; }
  } catch (error) { toast(error.message, 'error'); return; }
  compositor.addDanmaku(item);
  const feed = $('#danmaku-feed');
  const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  feed.querySelector('.feed-empty')?.remove();
  const row = document.createElement('div'); row.className = `danmaku-row ${item.source.toLowerCase()}`;
  const badge = document.createElement('span'); badge.className = `source-badge ${item.source.toLowerCase()}`; badge.textContent = item.source;
  const user = document.createElement('span'); user.className = 'dm-user'; user.textContent = item.user || '观众';
  const text = document.createElement('span'); text.className = 'dm-text'; text.textContent = String(item.text).slice(0, 300);
  const time = document.createElement('time'); time.textContent = new Date(item.timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  row.append(badge, user, text, time); feed.append(row);
  while (feed.children.length > 150) feed.firstElementChild.remove();
  $('#danmaku-count').textContent = String(Number($('#danmaku-count').textContent) + 1);
  if (stick) feed.scrollTop = feed.scrollHeight;
}
function clearDanmaku() {
  compositor.clearDanmaku(); filter = new DanmakuFilter(); filteredCount = 0; $('#danmaku-count').textContent = '0';
  $('#danmaku-feed').replaceChildren();
  const empty = document.createElement('div'); empty.className = 'feed-empty'; empty.textContent = '弹幕已清空，等待新的消息'; $('#danmaku-feed').append(empty);
}
function updateFilterIndicator() {
  const active = Boolean(scene.danmaku.keywords.trim() || scene.danmaku.regex.trim() || scene.danmaku.blockedUsers.trim());
  $('#filter-indicator').classList.toggle('active', active); $('#filter-button').classList.toggle('active', active);
}
function openFilter() {
  const d = scene.danmaku;
  $('#filter-keywords').value = d.keywords; $('#filter-users').value = d.blockedUsers; $('#filter-regex').value = d.regex;
  $('#filter-dedupe').checked = d.dedupe; $('#filter-rate').value = d.maxPerSecond;
  $('#show-source').checked = d.showSource; $('#show-user').checked = d.showUser;
  for (const key of ['size', 'opacity', 'speed', 'area']) { $(`#dm-${key}`).value = d[key]; $(`#dm-${key}-value`).textContent = `${d[key]}${key === 'size' ? ' px' : key === 'speed' ? ' s' : '%'}`; }
  $('#regex-error').textContent = ''; $('#filter-dialog').showModal();
}
function applyFilter() {
  const pattern = $('#filter-regex').value.trim();
  try { compileFilterRegex(pattern); } catch (error) { $('#regex-error').textContent = error.message; $('#filter-regex').focus(); return; }
  Object.assign(scene.danmaku, {
    keywords: $('#filter-keywords').value.slice(0, 2000), blockedUsers: $('#filter-users').value.slice(0, 2000), regex: pattern,
    dedupe: $('#filter-dedupe').checked, maxPerSecond: clamp(number($('#filter-rate').value, 5), 1, 20),
    showSource: $('#show-source').checked, showUser: $('#show-user').checked
  });
  for (const key of ['size', 'opacity', 'speed', 'area']) scene.danmaku[key] = Number($(`#dm-${key}`).value);
  // Recheck visible content immediately when the rule set changes.
  clearDanmaku(); updateFilterIndicator(); changed(); $('#filter-dialog').close(); toast('弹幕规则与样式已应用');
}
async function sendDanmaku(event) {
  event.preventDefault(); if (sendBusy) return;
  const text = $('#send-text').value.trim(); if (!text) return;
  const target = $('#send-target').value;
  const ids = target === 'both' ? CHANNELS : [target];
  const demoIds = ids.filter(id => sources[id].demo);
  if (demoIds.length) {
    for (const source of demoIds) acceptDanmaku({ source, text, user: '我 · 演示', uid: 'demo-self', timestamp: Date.now() });
    if (demoIds.length === ids.length) { $('#send-text').value = ''; toast('演示弹幕已加入画布'); return; }
  }
  sendBusy = true; $('#send-form button').disabled = true;
  const sentTabIds = new Set(), errors = [], submitted = [];
  for (const id of ids.filter(source => !sources[source].demo)) {
    const tabId = sources[id].tabId;
    if (tabId && sentTabIds.has(tabId)) continue;
    try { await roomCommand(id, { type: 'SEND_DANMAKU', text }); submitted.push(id); if (tabId) sentTabIds.add(tabId); }
    catch (error) { errors.push(`${id}：${error.message}`); }
  }
  sendBusy = false; $('#send-form button').disabled = false;
  if (submitted.length) { $('#send-text').value = ''; toast(`已向直播间 ${submitted.join('、')} 提交弹幕`); }
  if (errors.length) toast(errors.join('；'), 'error');
}
function bindTransform() {
  for (const key of ['x', 'y', 'w', 'h']) {
    $(`#position-${key}`).addEventListener('change', event => {
      const source = scene.sources[scene.selected]; source[key] = number(event.target.value, source[key]);
      if (key === 'x' || key === 'y') source[key] = clamp(source[key], 0, 100 - source[key === 'x' ? 'w' : 'h']);
      else source[key] = clamp(source[key], 1, 100 - source[key === 'w' ? 'x' : 'y']);
      event.target.value = Math.round(source[key] * 10) / 10; scene.layout = 'custom'; updateInspector(); updatePresetUI(); changed();
    });
    $(`#crop-${key}`).addEventListener('change', event => {
      const source = scene.sources[scene.selected]; source.crop = normalizeCrop({ ...source.crop, [key]: number(event.target.value, source.crop[key]) });
      event.target.value = Math.round(source.crop[key] * 10) / 10; updateInspector(); changed();
    });
  }
  $('#source-visible').addEventListener('change', event => { scene.sources[scene.selected].visible = event.target.checked; scene.layout = 'custom'; updateSelection(); updatePresetUI(); changed(); });
  $('#source-fit').addEventListener('change', event => { scene.sources[scene.selected].fit = event.target.value; changed(); });
  $('#source-opacity').addEventListener('input', event => { scene.sources[scene.selected].opacity = Number(event.target.value); $('#opacity-value').textContent = `${event.target.value}%`; changed(); });
  $('#crop-reset').addEventListener('click', () => { scene.sources[scene.selected].crop = { x: 0, y: 0, w: 100, h: 100 }; updateInspector(); changed(); });
  $('#auto-crop').addEventListener('click', autoCrop);
  $('#open-crop-editor').addEventListener('click', () => openCropEditor(scene.selected));
  $('#to-front').addEventListener('click', () => { const id = scene.selected; scene.layers = scene.layers.filter(key => key !== id).concat(id); changed(); toast(`直播间 ${id} 已移到最上层`); });
  $('#reset-transform').addEventListener('click', () => { Object.assign(scene.sources[scene.selected], { x: 0, y: 0, w: 100, h: 100, visible: true, opacity: 100 }); scene.layout = 'custom'; updateInspector(); updatePresetUI(); changed(); });
  let drag = null;
  const layer = $('#selection-layer'), box = $('#selection-box');
  layer.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !CHANNELS.some(id => sources[id].stream)) return;
    const rect = layer.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * 100, y = (event.clientY - rect.top) / rect.height * 100;
    const handle = event.target.dataset.handle;
    if (!handle) {
      const picked = [...scene.layers].reverse().find(id => { const s = scene.sources[id]; return s.visible && x >= s.x && y >= s.y && x <= s.x + s.w && y <= s.y + s.h; });
      if (!picked) return; selectSource(picked);
    }
    drag = { id: scene.selected, startX: x, startY: y, source: { ...scene.sources[scene.selected] }, handle, rect, pointer: event.pointerId };
    layer.setPointerCapture(event.pointerId); box.focus({ preventScroll: true }); event.preventDefault();
  });
  layer.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = (event.clientX - drag.rect.left) / drag.rect.width * 100 - drag.startX;
    const dy = (event.clientY - drag.rect.top) / drag.rect.height * 100 - drag.startY;
    const original = drag.source, next = scene.sources[drag.id], handle = drag.handle;
    if (!handle) {
      next.x = clamp(original.x + dx, 0, 100 - original.w); next.y = clamp(original.y + dy, 0, 100 - original.h);
      if (!event.altKey) { for (const key of ['x', 'y']) { const extent = next[key === 'x' ? 'w' : 'h']; for (const snap of [0, 50 - extent / 2, 100 - extent]) if (Math.abs(next[key] - snap) < .7) next[key] = snap; } }
    } else {
      let left = original.x, top = original.y, right = original.x + original.w, bottom = original.y + original.h;
      if (handle.includes('w')) left = clamp(original.x + dx, 0, right - 2);
      if (handle.includes('e')) right = clamp(original.x + original.w + dx, left + 2, 100);
      if (handle.includes('n')) top = clamp(original.y + dy, 0, bottom - 2);
      if (handle.includes('s')) bottom = clamp(original.y + original.h + dy, top + 2, 100);
      Object.assign(next, { x: left, y: top, w: right - left, h: bottom - top });
    }
    scene.layout = 'custom'; updateInspector(); updatePresetUI();
  });
  const finish = () => { if (drag) { drag = null; changed(); } };
  layer.addEventListener('pointerup', finish); layer.addEventListener('pointercancel', finish); layer.addEventListener('lostpointercapture', finish);
  box.addEventListener('keydown', event => {
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; if (!offsets[event.key]) return;
    const s = scene.sources[scene.selected], [dx, dy] = offsets[event.key], step = event.shiftKey ? 2 : .2;
    s.x = clamp(s.x + dx * step, 0, 100 - s.w); s.y = clamp(s.y + dy * step, 0, 100 - s.h); scene.layout = 'custom'; updateInspector(); updatePresetUI(); changed(); event.preventDefault();
  });
}
async function openCropEditor(id) {
  try { await cropEditor.open(id, sources[id].stream, scene.sources[id].crop); }
  catch (error) { toast(error.message, 'warning'); }
}
async function autoCrop() {
  const id = scene.selected;
  if (sources[id].demo) { scene.sources[id].crop = { x: 0, y: 0, w: 100, h: 100 }; updateInspector(); changed(); toast('演示素材已完整填入'); return; }
  const state = await refreshRoomState(id); if (!state) return;
  const r = state.videoRect, v = state.viewport;
  if (!r || r.width <= 0 || r.height <= 0 || !v?.width || !v?.height) { toast('请在关联的直播间播放视频，并把播放器滚动到可见区域', 'warning'); return; }
  scene.sources[id].crop = normalizeCrop({ x: r.x / v.width * 100, y: r.y / v.height * 100, w: r.width / v.width * 100, h: r.height / v.height * 100 });
  updateInspector(); changed(); toast('已按关联标签页的播放器区域裁剪');
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function stamp() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`; }
function hasSource() { return CHANNELS.some(id => sources[id].stream?.getVideoTracks().some(track => track.readyState === 'live')); }
async function outputStream() { await mixer.init(); mixer.update(scene); return compositor.createStream(mixer.outputTracks()); }
async function openOutput() {
  if (!hasSource()) { toast('请先采集直播间或开启演示，再打开输出窗口', 'warning'); return; }
  try {
    // Open synchronously to retain user activation; the peer requests a stream
    // after its output page is ready.
    if (!outputServer) outputServer = new OutputServer(() => compositor.createStream(mixer.outputTracks()), message => toast(message, 'error'));
    outputServer.open(); await mixer.init(); mixer.update(scene);
  } catch (error) { toast(error.message, 'error'); }
}
function lockRecordingSettings(lock) { $('#resolution').disabled = lock; $('#fps').disabled = lock; $('#import-scene').disabled = lock; $('#reset-scene').disabled = lock; }
async function toggleRecording() {
  if (recordPending) return;
  if (recorder && recorder.state !== 'inactive') { recorder.stop(); return; }
  if (!hasSource()) { toast('请先采集直播间或开启演示，再开始录制', 'warning'); return; }
  if (!globalThis.MediaRecorder) { toast('请使用支持 WebM 录制的 Edge 浏览器', 'error'); return; }
  if (hasUnsavedRecording) { toast('请先保存上一段录制，再开始下一段', 'warning'); $('#record-download').focus(); return; }
  recordPending = true; $('#record-button').disabled = true;
  try {
    recordStream = await outputStream(); recordChunks = [];
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('当前浏览器没有可用的 WebM 编码器');
    recorder = new MediaRecorder(recordStream, { mimeType, videoBitsPerSecond: scene.resolution === '720p' ? 4500000 : 8000000, audioBitsPerSecond: 192000 });
    recorder.addEventListener('dataavailable', event => { if (event.data.size) recordChunks.push(event.data); });
    recorder.addEventListener('error', () => { toast('录制中断，可保存已录制的片段', 'error'); if (recorder.state !== 'inactive') recorder.stop(); });
    recorder.addEventListener('stop', finishRecording, { once: true });
    recorder.start(1000); recordingStarted = Date.now(); lockRecordingSettings(true);
    $('#record-dot').classList.add('recording'); $('#record-label').textContent = '正在录制';
    $('#record-button span').textContent = '停止并生成文件'; $('#record-button use').setAttribute('href', '#i-stop'); $('#record-download').hidden = true;
    recordTimer = setInterval(() => { const seconds = Math.floor((Date.now() - recordingStarted) / 1000); $('#record-timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }, 500);
    toast('录制已开始，融合内容会保存为 WebM 文件');
  } catch (error) { recordStream?.getVideoTracks().forEach(track => track.stop()); recordStream = null; toast(error.message, 'error'); }
  finally { recordPending = false; $('#record-button').disabled = false; }
}
function finishRecording() {
  clearInterval(recordTimer); recordTimer = null; lockRecordingSettings(false);
  $('#record-dot').classList.remove('recording'); $('#record-label').textContent = '本地录制';
  $('#record-button span').textContent = '开始录制'; $('#record-button use').setAttribute('href', '#i-record');
  recordStream?.getVideoTracks().forEach(track => track.stop()); recordStream = null;
  if (!recordChunks.length) { recorder = null; toast('没有生成录制内容，请重新开始', 'error'); return; }
  const blob = new Blob(recordChunks, { type: recorder.mimeType }); recordChunks = []; recorder = null;
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingUrl = URL.createObjectURL(blob); hasUnsavedRecording = true;
  const link = $('#record-download'); link.href = recordingUrl; link.download = `三路融合姬-${stamp()}.webm`; link.hidden = false;
  link.textContent = `保存录制文件 · ${(blob.size / 1024 / 1024).toFixed(1)} MB`;
  toast('录制完成，点击“保存录制文件”下载');
}
function exportScene() {
  const data = sanitizeScene(scene);
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `三路融合姬-${scene.name.replace(/[<>:"/\\|?*]/g, '_')}.json`);
  toast('场景文件已导出');
}
async function importScene(file) {
  if (!file) return;
  if (recorder?.state === 'recording') { toast('请先停止录制后再导入场景', 'warning'); return; }
  try {
    if (file.size > 100000) throw new Error('场景文件应小于 100 KB');
    const next = sanitizeScene(JSON.parse(await file.text())); compileFilterRegex(next.danmaku.regex);
    scene = next; for (const id of CHANNELS) { sources[id].tabId = null; sources[id].state = null; }
    clearDanmaku(); syncScene(); changed(); await refreshRooms({ quiet: true }); toast(`已导入场景「${scene.name}」`);
  } catch (error) { toast(`导入失败：${error.message}`, 'error'); }
  finally { $('#scene-file').value = ''; }
}
function bindEvents() {
  for (const id of CHANNELS) {
    $(`[data-connect="${id}"]`).addEventListener('click', () => captureSource(id));
    $(`[data-disconnect="${id}"]`).addEventListener('click', () => disconnectSource(id));
    $(`[data-select="${id}"]`).addEventListener('click', () => selectSource(id));
    $(`[data-thumbnail="${id}"]`).addEventListener('click', () => selectSource(id));
    $(`[data-thumbnail="${id}"]`).addEventListener('dblclick', () => openCropEditor(id));
    $(`[data-open="${id}"]`).addEventListener('click', () => openRoom(id));
    $(`#room-${id}`).addEventListener('input', event => { scene.sources[id].room = event.target.value.slice(0, 160); saveScene(); });
    $(`#room-${id}`).addEventListener('keydown', event => { if (event.key === 'Enter') openRoom(id); });
    $(`#tab-${id}`).addEventListener('change', async event => {
      sources[id].tabId = event.target.value ? Number(event.target.value) : null; sources[id].state = null;
      const room = rooms.find(tab => tab.id === sources[id].tabId);
      if (room) { scene.sources[id].room = parseRoomId(room.url) || room.url; $(`#room-${id}`).value = scene.sources[id].room; await refreshRoomState(id); }
      updateConnected(); saveScene();
    });
  }
  $('#refresh-rooms').addEventListener('click', () => refreshRooms());
  $('#demo-button').addEventListener('click', startDemo); $('#empty-demo').addEventListener('click', startDemo);
  $$('[data-preset]').forEach(button => button.addEventListener('click', () => {
    const preset = button.dataset.preset;
    if (preset === 'custom') scene.layout = 'custom'; else applyPreset(scene, preset);
    if (preset === 'a') scene.selected = 'A'; if (preset === 'b') scene.selected = 'B';
    compositor.clearDanmaku(); updatePresetUI(); updateInspector(); changed();
  }));
  $('#swap-button').addEventListener('click', () => {
    const a = scene.sources.A, b = scene.sources.B; const keys = ['x', 'y', 'w', 'h', 'visible'];
    for (const key of keys) [a[key], b[key]] = [b[key], a[key]];
    scene.layers.reverse(); scene.layout = 'custom'; updatePresetUI(); updateInspector(); changed();
  });
  $$('#audio-mode button').forEach(button => button.addEventListener('click', () => { scene.audio.mode = button.dataset.mode; segmented('#audio-mode', scene.audio.mode); changed(); }));
  $$('#danmaku-mode button').forEach(button => button.addEventListener('click', () => { scene.danmaku.mode = button.dataset.mode; clearDanmaku(); segmented('#danmaku-mode', scene.danmaku.mode); changed(); }));
  $('#master-volume').addEventListener('input', event => { scene.audio.master = Number(event.target.value); $('#master-value').textContent = `${scene.audio.master}%`; changed(); });
  $('#monitor-toggle').addEventListener('change', async event => { scene.audio.monitor = event.target.checked; try { if (scene.audio.monitor) await mixer.init(); changed(); } catch (error) { toast(error.message, 'error'); } });
  $('#danmaku-toggle').addEventListener('change', event => { scene.danmaku.show = event.target.checked; compositor.clearDanmaku(); changed(); });
  $('#filter-button').addEventListener('click', openFilter); $('#apply-filter').addEventListener('click', applyFilter); $('#clear-danmaku').addEventListener('click', () => { clearDanmaku(); toast('弹幕记录与画布已清空'); });
  for (const key of ['size', 'opacity', 'speed', 'area']) $(`#dm-${key}`).addEventListener('input', event => { $(`#dm-${key}-value`).textContent = `${event.target.value}${key === 'size' ? ' px' : key === 'speed' ? ' s' : '%'}`; });
  $('#send-form').addEventListener('submit', sendDanmaku);
  $('#output-button').addEventListener('click', openOutput);
  $('#live-output-button').addEventListener('click', openOutput);
  $('#fullscreen-button').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#canvas-stage').requestFullscreen(); } catch (error) { toast(error.message, 'error'); } });
  $('#resolution').addEventListener('change', event => { scene.resolution = event.target.value; syncScene(); changed(); });
  $('#fps').addEventListener('change', event => { scene.fps = Number(event.target.value); syncScene(); changed(); });
  $('#background-color').addEventListener('input', event => { scene.background = event.target.value; $('#background-value').textContent = scene.background.toUpperCase(); changed(); });
  $('#record-button').addEventListener('click', toggleRecording);
  $('#record-download').addEventListener('click', () => { hasUnsavedRecording = false; });
  $('#snapshot-button').addEventListener('click', () => {
    if (!hasSource()) { toast('请先接入画面后再保存', 'warning'); return; }
    compositor.render(performance.now()); $('#composite').toBlob(blob => { if (blob) { downloadBlob(blob, `三路融合姬-${stamp()}.png`); toast('当前融合画面已保存'); } }, 'image/png');
  });
  $('#crop-full').addEventListener('click', () => cropEditor.reset());
  $('#crop-apply').addEventListener('click', () => cropEditor.apply());
  for (const selector of ['#help-button', '#rail-help', '#footer-help']) $(selector).addEventListener('click', () => $('#help-dialog').showModal());
  $('#scene-button').addEventListener('click', () => $('#scene-dialog').showModal());
  $('#settings-button').addEventListener('click', () => { $('#output-settings').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#resolution').focus({ preventScroll: true }); });
  $('#scene-name').addEventListener('input', event => { scene.name = event.target.value.slice(0, 60) || '未命名场景'; saveScene(); });
  $('#export-scene').addEventListener('click', exportScene); $('#import-scene').addEventListener('click', () => $('#scene-file').click());
  $('#scene-file').addEventListener('change', event => importScene(event.target.files[0]));
  $('#reset-scene').addEventListener('click', () => { scene = defaultScene(); clearDanmaku(); for (const id of CHANNELS) { sources[id].tabId = null; sources[id].state = null; $(`#tab-${id}`).value = ''; } syncScene(); changed(); toast('已恢复默认布局与设置'); });
  $$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
  window.addEventListener('focus', () => refreshRooms({ quiet: true }));
  if (extension) chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'SOURCE_EVENT') return;
    for (const id of CHANNELS) {
      if (sources[id].tabId !== message.tabId || sources[id].demo) continue;
      if (message.event === 'state') sources[id].state = message.data;
      else if (message.event === 'danmaku' && Array.isArray(message.data)) {
        for (const item of message.data.slice(0, 80)) if (item && typeof item.text === 'string') acceptDanmaku({ ...item, source: id });
      }
    }
  });
  window.addEventListener('beforeunload', event => {
    if (recorder?.state === 'recording' || hasUnsavedRecording) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => {
    clearInterval(meterTimer); clearInterval(demoTimer); clearInterval(recordTimer);
    outputServer?.close(); compositor.stop();
    for (const id of CHANNELS) { sources[id].demo?.stop(); sources[id].stream?.getTracks().forEach(track => track.stop()); }
    mixer.close(); if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  }, { once: true });
}
async function init() {
  restoring = true;
  try {
    const stored = extension ? (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] : JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored) { scene = sanitizeScene(stored); compileFilterRegex(scene.danmaku.regex); }
  } catch { scene = defaultScene(); }
  cropEditor = new CropEditor({ dialog: $('#crop-dialog'), stage: $('#crop-stage'), box: $('#crop-box'), video: $('#crop-video'), label: $('#crop-dimensions'),
    onApply(id, crop) { scene.sources[id].crop = crop; scene.selected = id; updateInspector(); changed(); toast(`直播间 ${id} 裁剪已应用到实时画布`); }
  });
  buildAudioTracks(); bindTransform(); bindEvents(); syncScene(); restoring = false; compositor.start();
  meterTimer = setInterval(() => {
    for (const id of CHANNELS) {
      const { percent, db } = mixer.level(id);
      $(`#db-${id}`).textContent = db > -80 ? `${db.toFixed(1)} dB` : '−∞ dB';
      $(`#meter-${id}-1`).style.width = `${percent}%`; $(`#meter-${id}-2`).style.width = `${percent}%`;
    }
    $('#render-status').textContent = hasSource() ? `${compositor.actualFps} FPS · 本地渲染` : '本地渲染';
  }, 120);
  await refreshRooms({ quiet: true });
}
init().catch(error => toast(`工作台初始化失败：${error.message}`, 'error'));
