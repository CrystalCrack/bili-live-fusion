import { drawGeometry, RESOLUTIONS } from './lib/model.js';

let scene, canvas, context, painting = false, lastPaint = -Infinity, lastTimestamp = -Infinity, timer = null;
const frames = new Map();
function schedule() {
  if (timer !== null || painting || !context || !frames.size) return;
  timer = setTimeout(() => { timer = null; paint(); }, Math.max(0, 1000 / scene.fps - (performance.now() - lastPaint)));
}
function paint() {
  if (!context || painting || !frames.size) return;
  if (performance.now() - lastPaint < 1000 / scene.fps - 1) { schedule(); return; }
  if (timer !== null) { clearTimeout(timer); timer = null; }
  painting = true; lastPaint = performance.now();
  let output;
  try {
    const width = canvas.width, height = canvas.height;
    context.globalAlpha = 1; context.fillStyle = scene.background; context.fillRect(0, 0, width, height);
    for (const id of scene.layers) {
      const settings = scene.sources[id], frame = frames.get(id);
      if (!settings.visible || !frame) continue;
      context.save(); context.globalAlpha = settings.opacity / 100;
      context.beginPath(); context.rect(settings.x / 100 * width, settings.y / 100 * height, settings.w / 100 * width, settings.h / 100 * height); context.clip();
      context.drawImage(frame, ...drawGeometry(settings, frame.displayWidth, frame.displayHeight, width, height)); context.restore();
    }
    // Source media timelines can reset after a seek or reconnect. The output
    // clock always follows this worker's monotonic real-time clock instead.
    lastTimestamp = Math.max(lastTimestamp + 1, Math.round(performance.now() * 1000));
    output = new VideoFrame(canvas, { timestamp: lastTimestamp, duration: Math.round(1000000 / scene.fps) });
    self.postMessage({ type: 'frame', frame: output }, [output]);
    output = null;
  } catch (error) { painting = false; self.postMessage({ type: 'error', error: error.message }); }
  finally { if (output) { output.close(); painting = false; } }
}
self.onmessage = event => {
  const message = event.data;
  if (message.type === 'start') {
    scene = message.scene; const [width, height] = RESOLUTIONS[scene.resolution];
    canvas = new OffscreenCanvas(width, height); context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  } else if (message.type === 'source-frame' && ['A', 'B'].includes(message.id)) {
    frames.get(message.id)?.close(); frames.set(message.id, message.frame);
    self.postMessage({ type: 'consumed', id: message.id, generation: message.generation }); paint();
  } else if (message.type === 'output-consumed') { painting = false; schedule(); }
};
