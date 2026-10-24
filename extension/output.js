const $ = selector => document.querySelector(selector);
const token = location.hash.slice(1);
let channel, connection, candidates = [], readyTimer, hideTimer, timeout, offered = false;
const peerId = crypto.randomUUID();
function showState(title, detail) { $('#output-state').hidden = false; $('#output-state h1').textContent = title; $('#output-state p').textContent = detail; $('#output-stage').classList.remove('quiet'); }
function send(message) { channel?.postMessage({ ...message, peerId }); }
async function receive(message) {
  if (message?.type === 'closed') { clearInterval(readyTimer); showState('工作台已关闭', '重新打开工作台，再开启输出窗口'); return; }
  if (message?.peerId !== peerId) return;
  if (message.type === 'offer') {
    offered = true; clearInterval(readyTimer);
    await connection.setRemoteDescription(message.sdp);
    for (const candidate of candidates.splice(0)) await connection.addIceCandidate(candidate);
    await connection.setLocalDescription(await connection.createAnswer());
    send({ type: 'answer', sdp: connection.localDescription.toJSON() });
  } else if (message.type === 'candidate') {
    if (connection.remoteDescription) await connection.addIceCandidate(message.candidate); else candidates.push(message.candidate);
  }
}
function connect() {
  clearInterval(readyTimer); clearTimeout(timeout); connection?.close(); channel?.close(); candidates = []; offered = false;
  if (!/^[a-f0-9-]{36}$/i.test(token)) { showState('从工作台开启输出', '返回三路融合姬，点击“打开输出窗口”'); return; }
  connection = new RTCPeerConnection({ iceServers: [] }); channel = new BroadcastChannel(`fusion-output-${token}`);
  channel.onmessage = event => receive(event.data).catch(() => showState('连接已中断', '点击重新连接，继续输出'));
  connection.onicecandidate = event => { if (event.candidate) send({ type: 'candidate-answer', candidate: event.candidate.toJSON() }); };
  connection.ontrack = event => {
    const stream = event.streams[0];
    if (stream && $('#output-video').srcObject !== stream) { $('#output-video').srcObject = stream; $('#output-video').play().catch(() => {}); }
  };
  connection.onconnectionstatechange = () => {
    if (connection.connectionState === 'connected') { clearTimeout(timeout); clearInterval(readyTimer); }
    if (['failed', 'disconnected'].includes(connection.connectionState)) showState('输出连接已断开', '保持工作台打开，点击重新连接');
  };
  send({ type: 'ready' }); readyTimer = setInterval(() => { if (!offered) send({ type: 'ready' }); }, 3000);
  timeout = setTimeout(() => { clearInterval(readyTimer); showState('等待工作台连接', '请保持工作台打开，然后点击重新连接'); }, 20000);
  showState('正在连接融合画布', '画面和声音由工作台实时输出');
}
function showControls() {
  $('#output-stage').classList.remove('quiet'); clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if ($('#output-state').hidden) $('#output-stage').classList.add('quiet'); }, 2500);
}
async function fullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#output-stage').requestFullscreen(); }
  catch { showControls(); }
}
$('#output-video').addEventListener('playing', () => { $('#output-state').hidden = true; showControls(); });
$('#output-video').addEventListener('resize', () => { $('#output-resolution').textContent = `${$('#output-video').videoWidth} × ${$('#output-video').videoHeight}`; });
$('#output-stage').addEventListener('pointermove', showControls);
$('#output-stage').addEventListener('keydown', showControls);
$('#output-video').addEventListener('dblclick', fullscreen);
$('#output-fullscreen').addEventListener('click', fullscreen);
$('#output-audio').addEventListener('click', async () => {
  const video = $('#output-video'); video.muted = !video.muted;
  if (!video.muted) { try { await video.play(); } catch { video.muted = true; } }
  $('#output-audio').textContent = video.muted ? '开启声音' : '关闭声音'; $('#output-audio').setAttribute('aria-pressed', String(!video.muted));
});
$('#output-pip').disabled = !document.pictureInPictureEnabled;
$('#output-pip').addEventListener('click', async () => {
  try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else if ($('#output-video').readyState >= 2) await $('#output-video').requestPictureInPicture(); }
  catch { $('#output-tip').textContent = '请先连接画面，再开启画中画'; showControls(); }
});
$('#retry').addEventListener('click', connect);
window.addEventListener('pagehide', () => { send({ type: 'bye' }); clearInterval(readyTimer); clearTimeout(hideTimer); clearTimeout(timeout); connection?.close(); channel?.close(); }, { once: true });
connect();
