import { drawGeometry, RESOLUTIONS } from './model.js';

// Both views read the existing decoders. Viewing never opens a second live source.
export function drawLiveSources(ctx, scene, sources, width, height) {
  ctx.globalAlpha = 1; ctx.fillStyle = scene.background; ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (const id of scene.layers) {
    const settings = scene.sources[id], video = sources[id]?.video;
    if (!settings.visible) continue;
    const x = settings.x / 100 * width, y = settings.y / 100 * height;
    const w = settings.w / 100 * width, h = settings.h / 100 * height;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.globalAlpha = settings.opacity / 100;
    ctx.fillStyle = '#0c1014'; ctx.fillRect(x, y, w, h);
    if (video?.readyState >= 2 && video.videoWidth > 0 && (sources[id]?.player?.connected || sources[id]?.stream?.getVideoTracks().some(track => track.readyState === 'live'))) {
      ctx.drawImage(video, ...drawGeometry(settings, video.videoWidth, video.videoHeight, width, height));
    } else if (Object.values(sources).some(source => source.stream || source.player)) {
      ctx.fillStyle = id === 'A' ? '#719e8a' : '#9589b0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `500 ${Math.max(12, 28 * width / 1920)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.fillText(`直播间 ${id} · 等待连接`, x + w / 2, y + h / 2, Math.max(1, w - 20));
    }
    ctx.restore();
  }
}

export function viewingSize(scene, displayWidth, displayHeight, pixelRatio = 1) {
  const [baseWidth, baseHeight] = RESOLUTIONS[scene.resolution];
  const scale = Math.min(displayWidth / baseWidth, displayHeight / baseHeight) * Math.max(1, pixelRatio);
  const limited = Math.min(scale, Math.sqrt(3840 * 2160 / (baseWidth * baseHeight)));
  return [Math.max(2, Math.round(baseWidth * limited)), Math.max(2, Math.round(baseHeight * limited))];
}

// CSS and canvas share one geometry definition. Video pixels stay on the
// browser compositor during viewing, without a continuously copied canvas.
export function videoLayerGeometry(settings, inputWidth, inputHeight, width, height) {
  const [sx, sy, sw, sh, dx, dy, dw, dh] = drawGeometry(settings, inputWidth, inputHeight, width, height);
  const x = settings.x / 100 * width, y = settings.y / 100 * height;
  return { x, y, width: settings.w / 100 * width, height: settings.h / 100 * height,
    clipX: dx - x, clipY: dy - y, clipWidth: dw, clipHeight: dh,
    videoX: -(sx * dw / sw) || 0, videoY: -(sy * dh / sh) || 0,
    videoWidth: inputWidth * dw / sw, videoHeight: inputHeight * dh / sh };
}

export class LiveSurface {
  constructor(canvas, read, onResize, layer) {
    this.canvas = canvas; this.read = read; this.onResize = onResize; this.layer = layer; this.frames = 0; this.running = false; this.paused = false; this.items = new Map();
  }
  resize(width, height, pixelRatio = devicePixelRatio) { this.display = [width, height, pixelRatio]; this.layout(); }
  start() {
    if (this.running) return; this.running = true;
    for (const [id, source] of Object.entries(this.read().sources)) {
      const wrapper = document.createElement('div'); wrapper.className = 'watch-source'; wrapper.dataset.layer = id; this.layer.append(wrapper);
      const clip = document.createElement('div'); clip.className = 'watch-crop'; wrapper.append(clip); clip.append(source.video);
      const item = { wrapper, clip, video: source.video, frames: 0 }; this.items.set(id, item);
      const next = () => { if (!this.running) return; item.frames++; this.frames++; wrapper.dataset.frames = String(item.frames); this.canvas.dataset.frames = String(this.frames); item.callback = item.video.requestVideoFrameCallback(next); };
      item.callback = item.video.requestVideoFrameCallback(next); item.resize = () => this.layout(); item.video.addEventListener('resize', item.resize);
    }
    this.layout();
  }
  layout() {
    if (!this.running || !this.display) return;
    const { scene } = this.read(), [displayWidth, displayHeight] = this.display;
    const [baseWidth, baseHeight] = RESOLUTIONS[scene.resolution], scale = Math.min(displayWidth / baseWidth, displayHeight / baseHeight);
    const width = baseWidth * scale, height = baseHeight * scale;
    Object.assign(this.layer.style, { left: (displayWidth - width) / 2 + 'px', top: (displayHeight - height) / 2 + 'px', width: width + 'px', height: height + 'px', background: scene.background });
    const [pixelWidth, pixelHeight] = viewingSize(scene, ...this.display); this.canvas.width = pixelWidth; this.canvas.height = pixelHeight;
    for (const [index, id] of scene.layers.entries()) {
      const item = this.items.get(id); if (!item) continue; const settings = scene.sources[id], video = item.video;
      const g = videoLayerGeometry(settings, video.videoWidth || 1280, video.videoHeight || 720, width, height);
      Object.assign(item.wrapper.style, { display: settings.visible ? 'block' : 'none', left: g.x + 'px', top: g.y + 'px', width: g.width + 'px', height: g.height + 'px', opacity: settings.opacity / 100, zIndex: index });
      Object.assign(item.clip.style, { left: g.clipX + 'px', top: g.clipY + 'px', width: g.clipWidth + 'px', height: g.clipHeight + 'px' });
      Object.assign(video.style, { left: g.videoX + 'px', top: g.videoY + 'px', width: g.videoWidth + 'px', height: g.videoHeight + 'px' });
    }
    if (this.paused) this.freeze(); this.onResize?.(width, height);
  }
  freeze() { const { scene, sources } = this.read(); drawLiveSources(this.canvas.getContext('2d', { alpha: false }), scene, sources, this.canvas.width, this.canvas.height); }
  setPaused(value) { this.paused = value; if (value) this.freeze(); this.canvas.classList.toggle('frozen', value); }
  stop() {
    this.running = false;
    for (const item of this.items.values()) { item.video.cancelVideoFrameCallback(item.callback); item.video.removeEventListener('resize', item.resize); for (const key of ['left', 'top', 'width', 'height']) item.video.style.removeProperty(key); item.wrapper.remove(); }
    this.items.clear(); this.setPaused(false);
  }
}
