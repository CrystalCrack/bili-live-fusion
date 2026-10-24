import { WatchDanmaku } from './lib/watch-danmaku.js';

const $ = selector => document.querySelector(selector);
const player = $('#watch-player'), video = $('#watch-video'), peerId = crypto.randomUUID(), token = location.hash.slice(1);
let channel, connection, readyTimer, timeout, hideTimer, candidates = [], offered = false, connected = false, sending = false, danmakuEnabled = true;
let state = { sources: [], danmaku: {} };
const pending = new Map();
const comments = new WatchDanmaku($('#watch-danmaku'), { onCopy: copyText, onRepeat: sendDanmaku });
video.volume = .8;
function notice(text, error = false) { $('#watch-notice').textContent = text; $('#watch-notice').classList.toggle('error', error); }
function send(message) { channel?.postMessage({ ...message, peerId }); }
function showState(title, detail) { $('#watch-state').hidden = false; $('#watch-state h1').textContent = title; $('#watch-state p').textContent = detail; showControls(); }
function setConnected(value) { connected = value; updateSend(); }
function updateSend() {
  const text = $('#watch-send-text').value.trim(), count = [...text].length;
  $('#watch-text-count').textContent = `${count}/30`; $('#watch-text-count').classList.toggle('over-limit', count > 30);
  const targetAvailable = !$('#watch-send-target').selectedOptions[0]?.disabled;
  $('#watch-send').disabled = !connected || !targetAvailable || sending || count === 0 || count > 30;
  $('#watch-send').textContent = sending ? '发送中' : '发送';
}
function applyState(next) {
  if (state.sources.length && next.sources?.some(source => state.sources.find(previous => previous.id === source.id)?.room !== source.room)) comments.clear();
  state = next; comments.configure(next.danmaku || {});
  const select = $('#watch-send-target');
  for (const option of select.options) {
    const ids = option.value === 'both' ? ['A', 'B'] : [option.value];
    option.disabled = !ids.every(id => next.sources?.some(source => source.id === id && source.available));
    const source = next.sources?.find(source => source.id === option.value);
    option.textContent = option.value === 'both' ? 'A + B' : `发送到 ${option.value}${source?.room ? ` · ${source.room}` : ''}`;
  }
  if (select.selectedOptions[0]?.disabled) select.value = [...select.options].find(option => !option.disabled)?.value || 'A';
  updateSend();
}
async function receive(message) {
  if (message?.type === 'closed') {
    setConnected(false); clearInterval(readyTimer); clearTimeout(timeout); comments.clear();
    showState('工作台已关闭', '重新打开工作台，点击“进入观看”'); rejectPending('工作台已关闭'); return;
  }
  if (message?.peerId !== peerId) return;
  if (message.type === 'offer') {
    offered = true; clearInterval(readyTimer); await connection.setRemoteDescription(message.sdp);
    for (const candidate of candidates.splice(0)) await connection.addIceCandidate(candidate);
    await connection.setLocalDescription(await connection.createAnswer()); send({ type: 'answer', sdp: connection.localDescription.toJSON() });
  } else if (message.type === 'candidate') {
    if (connection.remoteDescription) await connection.addIceCandidate(message.candidate); else candidates.push(message.candidate);
  } else if (message.type === 'watch-state') applyState(message.state);
  else if (message.type === 'watch-danmaku') comments.add(message.item);
  else if (message.type === 'watch-clear') comments.clear();
  else if (message.type === 'watch-sent') {
    const request = pending.get(message.requestId); if (!request) return;
    clearTimeout(request.timer); pending.delete(message.requestId); request.resolve(message);
  }
}
function rejectPending(message) { for (const request of pending.values()) { clearTimeout(request.timer); request.resolve({ ok: false, message }); } pending.clear(); }
function connect() {
  clearInterval(readyTimer); clearTimeout(timeout); rejectPending('连接已更新，请再次发送');
  if (channel) send({ type: 'bye' });
  if (connection) { connection.onconnectionstatechange = null; connection.close(); }
  channel?.close(); candidates = []; offered = false; setConnected(false); comments.clear();
  if (!/^[a-f0-9-]{36}$/i.test(token)) { showState('从工作台进入观看', '打开三路融合姬，点击“进入观看”'); return; }
  connection = new RTCPeerConnection({ iceServers: [] }); channel = new BroadcastChannel(`fusion-output-${token}`);
  channel.onmessage = event => receive(event.data).catch(() => { setConnected(false); showState('连接已中断', '点击重新连接，继续观看'); });
  connection.onicecandidate = event => { if (event.candidate) send({ type: 'candidate-answer', candidate: event.candidate.toJSON() }); };
  connection.ontrack = event => {
    if (event.streams[0] && video.srcObject !== event.streams[0]) { video.srcObject = event.streams[0]; video.play().catch(() => showState('点击开始观看', '点击下方“播放”继续直播')); }
  };
  connection.onconnectionstatechange = () => {
    if (connection.connectionState === 'connected') { clearTimeout(timeout); clearInterval(readyTimer); setConnected(true); }
    if (['failed', 'disconnected', 'closed'].includes(connection.connectionState)) { setConnected(false); rejectPending('观看连接已断开'); showState('观看连接已断开', '保持工作台打开，点击重新连接'); }
  };
  send({ type: 'ready', view: 'watch' }); readyTimer = setInterval(() => { if (!offered) send({ type: 'ready', view: 'watch' }); }, 3000);
  timeout = setTimeout(() => { clearInterval(readyTimer); showState('等待工作台连接', '保持工作台打开，然后点击重新连接'); }, 20000);
  showState('正在连接融合直播', '画面和声音由工作台实时传来');
}
function fitComments() {
  const picture = $('#watch-picture'), width = picture.clientWidth, height = picture.clientHeight;
  if (!video.videoWidth || !video.videoHeight) return;
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight), w = video.videoWidth * scale, h = video.videoHeight * scale;
  comments.resize((width - w) / 2, (height - h) / 2, w, h);
}
function showControls() {
  player.classList.remove('quiet'); clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if ($('#watch-state').hidden && !player.querySelector('.watch-chrome:focus-within') && !player.querySelector('.watch-comment:hover, .watch-comment:focus-within') && !player.querySelector('.watch-controls:hover, .watch-heading:hover')) player.classList.add('quiet'); }, 2500);
}
async function fullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await player.requestFullscreen(); }
  catch { notice('请在浏览器菜单中开启全屏', true); }
  showControls();
}
async function togglePlay() {
  if (video.paused) { try { await video.play(); } catch { notice('请等待直播画面连接后再次播放', true); } } else video.pause();
  showControls();
}
async function toggleAudio() {
  video.muted = !video.muted; if (!video.muted && !video.volume) { video.volume = .8; $('#watch-volume').value = '80'; }
  if (!video.muted) { try { await video.play(); } catch { video.muted = true; } }
  updateAudio(); showControls();
}
function updateAudio() { const audible = !video.muted && video.volume > 0; $('#watch-audio').textContent = audible ? '静音' : '开启声音'; $('#watch-audio').setAttribute('aria-pressed', String(audible)); }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); notice('已复制弹幕'); }
  catch { $('#watch-send-text').value = text; $('#watch-send-text').focus(); $('#watch-send-text').select(); updateSend(); notice('弹幕已放入输入框，可编辑或复制'); }
}
async function sendDanmaku(rawText, target) {
  const text = String(rawText || '').trim();
  if (sending) { notice('正在发送，请稍候'); return false; }
  if (!connected) { notice('请先连接融合直播', true); return false; }
  if (!text || [...text].length > 30) { notice('弹幕请输入 1–30 个字', true); return false; }
  const ids = target === 'both' ? ['A', 'B'] : [target];
  if (!ids.every(id => state.sources?.some(source => source.id === id && source.available))) { notice('请返回工作台连接所选直播间', true); return false; }
  sending = true; updateSend();
  try {
    const requestId = crypto.randomUUID();
    const response = await new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, message: '发送响应超时，请查看直播间消息后再操作' }); }, 50000);
      pending.set(requestId, { resolve, timer }); send({ type: 'watch-send', requestId, text, target });
    });
    notice(response.message || (response.ok ? '弹幕已发送' : '弹幕发送失败'), !response.ok || Boolean(response.errors?.length)); return response.ok;
  } finally { sending = false; updateSend(); }
}
video.addEventListener('playing', () => { $('#watch-state').hidden = true; comments.setPaused(false); showControls(); });
video.addEventListener('pause', () => { comments.setPaused(true); $('#watch-play').textContent = '播放'; $('#watch-play').setAttribute('aria-label', '播放'); });
video.addEventListener('play', () => { comments.setPaused(false); $('#watch-play').textContent = '暂停'; $('#watch-play').setAttribute('aria-label', '暂停'); });
video.addEventListener('resize', fitComments); video.addEventListener('volumechange', updateAudio);
video.addEventListener('dblclick', fullscreen);
new ResizeObserver(fitComments).observe($('#watch-picture'));
player.addEventListener('pointermove', showControls); player.addEventListener('focusin', showControls);
document.addEventListener('fullscreenchange', () => { const active = Boolean(document.fullscreenElement); $('#watch-fullscreen').textContent = active ? '退出全屏' : '全屏'; $('#watch-fullscreen').setAttribute('aria-pressed', String(active)); fitComments(); showControls(); });
document.addEventListener('keydown', event => {
  if (event.target.closest('input, select, textarea, button, [contenteditable]') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); fullscreen(); }
  if (event.key.toLowerCase() === 'm') { event.preventDefault(); toggleAudio(); }
});
$('#watch-play').addEventListener('click', togglePlay); $('#watch-audio').addEventListener('click', toggleAudio);
$('#watch-volume').addEventListener('input', event => { video.volume = Number(event.target.value) / 100; video.muted = video.volume === 0; });
$('#watch-toggle-danmaku').addEventListener('click', () => { danmakuEnabled = !danmakuEnabled; comments.setEnabled(danmakuEnabled); $('#watch-toggle-danmaku').textContent = `弹幕 ${danmakuEnabled ? '开' : '关'}`; $('#watch-toggle-danmaku').setAttribute('aria-pressed', String(danmakuEnabled)); });
$('#watch-fullscreen').addEventListener('click', fullscreen); $('#watch-retry').addEventListener('click', connect);
$('#watch-studio').addEventListener('click', () => send({ type: 'watch-focus' }));
$('#watch-send-text').addEventListener('input', updateSend);
$('#watch-send-target').addEventListener('change', updateSend);
$('#watch-send-form').addEventListener('submit', async event => { event.preventDefault(); const input = $('#watch-send-text'), text = input.value; if (await sendDanmaku(text, $('#watch-send-target').value)) { if (input.value === text) input.value = ''; updateSend(); } });
window.addEventListener('pagehide', () => { send({ type: 'bye' }); clearInterval(readyTimer); clearTimeout(timeout); clearTimeout(hideTimer); rejectPending('观看页面已关闭'); connection?.close(); channel?.close(); comments.clear(); }, { once: true });
connect();
