import { CHANNELS } from './lib/model.js';
import { embeddedScene } from './lib/embed-model.js';
import { LiveSession } from './lib/live-session.js';
import { LivePlayer } from './lib/live-player.js';
import { NativeCompositor } from './lib/native-compositor.js';
import { AudioMixer } from './lib/audio.js';
import { withTimeout } from './lib/async.js';

const token = location.hash.slice(1), label = document.querySelector('#state');
const mixer = new AudioMixer(), session = new LiveSession();
const sources = Object.fromEntries(CHANNELS.map(id => { const video = document.createElement('video'); video.playsInline = true; video.crossOrigin = 'anonymous'; video.muted = true; document.querySelector('#sources').append(video); return [id, { video }]; }));
let scene, compositor, port, audioReader, audioWriter, closed = false, audioNeeded = true, attached = false, giveOutputs;
const outputsReady = new Promise(resolve => { giveOutputs = resolve; });
function send(data) { if (!closed) port?.postMessage(data); }
function status(text, error = false) { label.textContent = text; send({ type: 'state', text, error, audioNeeded }); }
async function activateAudio() {
  try { await mixer.init(); if (closed) return; for (const source of Object.values(sources)) source.video.muted = false; audioNeeded = false; document.querySelector('#audio').hidden = true; status(attached ? '融合直播已接入原生播放器' : '正在接入融合直播'); }
  catch { audioNeeded = true; document.querySelector('#audio').hidden = false; status('点击开启声音，音量使用 B 站控制栏调整'); }
}
async function start() {
  try {
    const permission = await withTimeout(chrome.runtime.sendMessage({ type: 'EMBED_AUTHORIZE', token }), 8000, '连接响应超时，请重新应用场景');
    if (!permission?.ok) throw new Error(permission?.error || '请通过插件小窗开启融合播放');
    const config = embeddedScene((await chrome.storage.local.get('fusion-scene-v1'))['fusion-scene-v1']);
    scene = config.scene;
    if (closed) return;
    const outputs = await withTimeout(outputsReady, 8000, '原生播放器连接超时，请重新应用场景');
    if (closed) return;
    compositor = new NativeCompositor(scene, outputs.video, () => send({ type: 'stream-ready' }), error => status(error.message, true));
    mixer.prepare(); mixer.setMonitorSuppressed(true);
    for (const id of CHANNELS) mixer.attachElement(id, sources[id].video);
    mixer.update(scene);
    forwardAudio(outputs.audio);
    activateAudio();
    for (const { id, room } of config.rooms) {
      const source = sources[id];
      source.video.addEventListener('playing', () => { if (!closed) { try { compositor.attach(id, source.video); } catch (error) { status(error.message, true); } } });
      source.player = new LivePlayer(source.video, {
        resolve: (roomId, quality) => session.request({ type: 'LIVE_PLAY_INFO', roomId, quality }),
        getLatency: () => scene.sync.latency + scene.sources[id].syncDelay / 1000,
        onState(state, text) { if (closed) return; if (state === 'error') status(id + '：' + text, true); }, onInfo() {}, onSync() {}
      });
      source.video.muted = audioNeeded;
      source.player.start(room, scene.sources[id].quality).catch(error => status(error.message, true));
    }
  } catch (error) { status(error.message, true); }
}
async function forwardAudio(writable) {
  try {
    audioReader = new MediaStreamTrackProcessor({ track: mixer.outputTracks()[0], maxBufferSize: 4 }).readable.getReader();
    audioWriter = writable.getWriter();
    while (!closed) {
      const { value, done } = await audioReader.read(); if (done) break;
      try { await audioWriter.write(value); } finally { value.close(); }
    }
  } catch (error) { if (!closed) status(error.message, true); }
}
function close() {
  if (closed) return; closed = true; compositor?.close();
  audioReader?.cancel().catch(() => {}); audioWriter?.abort().catch(() => {});
  for (const source of Object.values(sources)) source.player?.stop();
  mixer.close().catch(() => {}); port?.close();
}
window.addEventListener('message', event => {
  if (port || event.source !== parent || event.origin !== 'https://live.bilibili.com' || event.data?.token !== token || event.data.type !== 'BILI_FUSION_PROCESSOR_PORT' || !event.ports[0]) return;
  port = event.ports[0];
  port.onmessage = event => {
    const data = event.data;
    if (data?.type === 'close') { close(); return; }
    if (data?.type === 'attached') { attached = true; status(audioNeeded ? '点击开启声音，音量使用 B 站控制栏调整' : '融合直播已接入原生播放器'); return; }
    if (data?.type === 'error' || data?.type === 'play-needed') { status(data.text, data.type === 'error'); if (data.type === 'error') close(); return; }
    if (data?.type === 'sinks') giveOutputs(data);
  };
  port.start(); start();
});
document.querySelector('#audio').addEventListener('click', activateAudio);
document.querySelector('#restore').addEventListener('click', () => send({ type: 'close' }));
window.addEventListener('pagehide', close, { once: true });
if (parent !== window && /^[a-f0-9-]{36}$/i.test(token)) parent.postMessage({ type: 'BILI_FUSION_PROCESSOR_READY', token }, 'https://live.bilibili.com');
else label.textContent = '在 B 站直播间点击插件，选择“在当前直播页播放”';
