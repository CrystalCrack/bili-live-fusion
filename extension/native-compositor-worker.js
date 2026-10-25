import { drawGeometry, RESOLUTIONS } from './lib/model.js';

let scene, canvas, context, writer, painting = false, lastPaint = -Infinity, announced = false;
const inputs = new Map(), frames = new Map();
async function paint(timestamp) {
  if (!writer || painting || performance.now() - lastPaint < 1000 / scene.fps - 1 || writer.desiredSize <= 0) return;
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
    output = new VideoFrame(canvas, { timestamp, duration: Math.round(1000000 / scene.fps) });
    if (!announced) { announced = true; self.postMessage({ type: 'ready' }); }
    await writer.write(output);
  } catch (error) { self.postMessage({ type: 'error', error: error.message }); }
  finally { output?.close(); painting = false; }
}
async function consume(id, readable) {
  const reader = readable.getReader(), previous = inputs.get(id); inputs.set(id, reader);
  previous?.cancel().catch(() => {}); frames.get(id)?.close(); frames.delete(id);
  try {
    while (inputs.get(id) === reader) {
      const { value, done } = await reader.read(); if (done) break;
      if (inputs.get(id) !== reader) { value.close(); break; }
      frames.get(id)?.close(); frames.set(id, value); paint(value.timestamp);
    }
  } catch (error) { if (inputs.get(id) === reader) self.postMessage({ type: 'error', error: error.message }); }
  finally { reader.releaseLock(); }
}
self.onmessage = event => {
  const message = event.data;
  if (message.type === 'start') {
    scene = message.scene; const [width, height] = RESOLUTIONS[scene.resolution];
    canvas = new OffscreenCanvas(width, height); context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; writer = message.writable.getWriter();
  } else if (message.type === 'source' && ['A', 'B'].includes(message.id)) consume(message.id, message.readable);
};
