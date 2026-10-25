import { RESOLUTIONS } from './lib/model.js';
import { createCompositorRenderer } from './lib/gpu-compositor.js';

let scene, renderer, painting = false, lastPaint = -Infinity, lastTimestamp = -Infinity, timer = null;
const frames = new Map();
function schedule() {
  if (timer !== null || painting || !renderer || !frames.size) return;
  timer = setTimeout(() => { timer = null; paint(); }, Math.max(0, 1000 / scene.fps - (performance.now() - lastPaint)));
}
function paint() {
  if (!renderer || painting || !frames.size) return;
  if (performance.now() - lastPaint < 1000 / scene.fps - 1) { schedule(); return; }
  if (timer !== null) { clearTimeout(timer); timer = null; }
  painting = true; lastPaint = performance.now();
  let output;
  try {
    try { renderer.draw(scene, frames); }
    catch (error) {
      if (renderer.info.backend !== 'webgl2') throw error;
      renderer.close();
      renderer = createCompositorRenderer(...RESOLUTIONS[scene.resolution], { preferGpu: false, reason: error.message });
      self.postMessage({ type: 'renderer-info', info: renderer.info });
      renderer.draw(scene, frames);
    }
    // Source media timelines can reset after a seek or reconnect. The output
    // clock always follows this worker's monotonic real-time clock instead.
    lastTimestamp = Math.max(lastTimestamp + 1, Math.round(performance.now() * 1000));
    output = new VideoFrame(renderer.canvas, { timestamp: lastTimestamp, duration: Math.round(1000000 / scene.fps) });
    self.postMessage({ type: 'frame', frame: output }, [output]);
    output = null;
  } catch (error) { painting = false; self.postMessage({ type: 'error', error: error.message }); }
  finally { if (output) { output.close(); painting = false; } }
}
self.onmessage = event => {
  const message = event.data;
  if (message.type === 'start') {
    try {
      scene = message.scene; renderer = createCompositorRenderer(...RESOLUTIONS[scene.resolution]);
      self.postMessage({ type: 'renderer-info', info: renderer.info });
    } catch (error) { self.postMessage({ type: 'error', error: error.message }); }
  } else if (message.type === 'source-frame' && ['A', 'B'].includes(message.id)) {
    frames.get(message.id)?.close(); frames.set(message.id, message.frame);
    self.postMessage({ type: 'consumed', id: message.id, generation: message.generation }); paint();
  } else if (message.type === 'output-consumed') { painting = false; schedule(); }
};
