import { CHANNELS } from './lib/model.js';
import { embeddedScene } from './lib/embed-model.js';
import { LiveSession } from './lib/live-session.js';
import { LivePlayer } from './lib/live-player.js';
import { NativeCompositor } from './lib/native-compositor.js';
import { NativeLink } from './lib/native-link.js';
import { AudioMixer } from './lib/audio.js';
import { withTimeout } from './lib/async.js';
import { authorizeEmbed } from './lib/embed-startup.js';

const token = location.hash.slice(1), label = document.querySelector('#state');
const mixer = new AudioMixer(), session = new LiveSession();
const sources = Object.fromEntries(CHANNELS.map(id => { const video = document.createElement('video'); video.playsInline = true; video.crossOrigin = 'anonymous'; video.muted = true; document.querySelector('#sources').append(video); return [id, { video }]; }));
let scene, compositor, link, port, closed = false, failed = false, audioNeeded = true, attached = false, giveReady, healthTimer, playback = 'connecting';
const receiverReady = new Promise(resolve => { giveReady = resolve; });
function send(data) { if (!closed) port?.postMessage(data); }
function status(text, error = false) { label.textContent = text; send({ type: 'state', text, error, audioNeeded }); }
function playbackText() { return playback === 'paused' ? '融合直播已暂停' : playback === 'buffering' ? '融合画面正在缓冲' : playback === 'blocked' ? '点击 B 站播放按钮启动融合直播' : attached ? '融合直播已接入原生播放器' : '正在接入融合直播'; }
function stopMedia() {
  clearInterval(healthTimer);
  link?.close(); compositor?.close();
  for (const source of Object.values(sources)) source.player?.stop();
  mixer.close().catch(() => {});
}
function fail(error) {
  if (closed || failed) return;
  failed = true; audioNeeded = false; document.querySelector('#audio').hidden = true;
  status('融合连接已停止：' + (error.message || error), true); stopMedia();
}
async function activateAudio() {
  if (closed || failed) return;
  try { await mixer.init(); if (closed || failed) return; for (const source of Object.values(sources)) source.video.muted = false; audioNeeded = false; document.querySelector('#audio').hidden = true; status(playbackText()); }
  catch { if (closed || failed) return; audioNeeded = true; document.querySelector('#audio').hidden = false; status('点击开启声音，音量使用 B 站控制栏调整'); }
}
async function start() {
  try {
    status('正在读取启动授权…');
    await authorizeEmbed(token, location.href);
    if (closed || failed) return;
    status('正在读取已保存的场景…');
    const saved = await withTimeout(chrome.storage.local.get('fusion-scene-v1'), 4000, '场景读取超时，请重新加载扩展后重试');
    const config = embeddedScene(saved['fusion-scene-v1']);
    scene = config.scene;
    if (closed || failed) return;
    status('正在连接 B 站原生播放器…');
    await withTimeout(receiverReady, 8000, '原生播放器连接超时，请刷新直播页后重新应用');
    if (closed || failed) return;
    compositor = new NativeCompositor(scene, () => send({ type: 'stream-ready' }), fail);
    mixer.prepare(); mixer.setMonitorSuppressed(true);
    for (const id of CHANNELS) mixer.attachElement(id, sources[id].video);
    mixer.update(scene);
    link = new NativeLink({ send, onError: fail });
    await link.start(new MediaStream([compositor.track, ...mixer.outputTracks()]), scene.fps);
    if (closed || failed) return;
    activateAudio();
    healthTimer = setInterval(async () => {
      if (closed || failed) return;
      const encoding = await link.collectStats(); if (closed || failed) return;
      send({ type: 'producer-health', data: { compositor: compositor.snapshot(), encoding, connection: link.peer.connectionState, audio: mixer.context?.state, sources: Object.fromEntries(CHANNELS.map(id => { const video = sources[id].video; return [id, { time: video.currentTime, ready: video.readyState, paused: video.paused, width: video.videoWidth, height: video.videoHeight, error: video.error?.message || null }]; })) } });
    }, 2000);
    for (const { id, room } of config.rooms) {
      if (closed || failed) break;
      const source = sources[id];
      source.video.addEventListener('playing', () => { if (!closed && !failed) { try { compositor.attach(id, source.video); } catch (error) { fail(error); } } });
      source.player = new LivePlayer(source.video, {
        resolve: (roomId, quality) => session.request({ type: 'LIVE_PLAY_INFO', roomId, quality }),
        getLatency: () => scene.sync.latency + scene.sources[id].syncDelay / 1000,
        onState(state, text) { if (closed || failed) return; if (state === 'error') fail(new Error(id + '：' + text)); }, onInfo() {}, onSync() {}
      });
      source.video.muted = audioNeeded;
      source.player.start(room, scene.sources[id].quality).catch(fail);
    }
  } catch (error) { fail(error); }
}
function close() {
  if (closed) return; closed = true; stopMedia(); port?.close();
}
window.addEventListener('message', event => {
  if (port || event.source !== parent || event.origin !== 'https://live.bilibili.com' || event.data?.token !== token || event.data.type !== 'BILI_FUSION_PROCESSOR_PORT' || !event.ports[0]) return;
  port = event.ports[0];
  port.onmessage = event => {
    const data = event.data;
    if (data?.type === 'close') { close(); return; }
    if (failed) return;
    if (data?.type === 'ready') { giveReady(); return; }
    if (data?.type === 'answer' || data?.type === 'candidate') { link?.receive(data); return; }
    if (data?.type === 'attached') { attached = true; playback = 'playing'; status(audioNeeded ? '点击开启声音，音量使用 B 站控制栏调整' : playbackText()); return; }
    if (data?.type === 'playback-state') { playback = data.state; status(audioNeeded && playback === 'playing' ? '点击开启声音，音量使用 B 站控制栏调整' : data.text); return; }
    if (data?.type === 'error') { fail(new Error(data.text)); return; }
    if (data?.type === 'play-needed') { playback = 'blocked'; status(data.text); }
  };
  port.start(); start();
});
document.querySelector('#audio').addEventListener('click', activateAudio);
document.querySelector('#restore').addEventListener('click', () => send({ type: 'close' }));
window.addEventListener('pagehide', close, { once: true });
if (parent !== window && /^[a-f0-9-]{36}$/i.test(token)) parent.postMessage({ type: 'BILI_FUSION_PROCESSOR_READY', token }, 'https://live.bilibili.com');
else label.textContent = '在 B 站直播间点击插件，选择“在当前直播页播放”';
