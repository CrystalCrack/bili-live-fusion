import { RESOLUTIONS } from './model.js';
import { drawLiveSources } from './live-surface.js';

export class Compositor {
  constructor(canvas, getScene, getSources) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
    this.getScene = getScene; this.getSources = getSources; this.comments = [];
    this.lastDraw = 0; this.frameCount = 0; this.actualFps = 0; this.lastStats = 0;
    this.running = false; this.previewEnabled = true; this.timer = null; this.streams = new Set(); this.cleanStreams = new Set();
  }
  start() {
    if (this.running) return;
    this.running = true;
    // A timer keeps output moving when a separate output tab has focus.
    this.timer = setInterval(() => this.tick(performance.now()), 8);
    this.tick(performance.now());
  }
  tick(now) {
    for (const stream of this.streams) if (!stream.getVideoTracks().some(track => track.readyState === 'live')) { this.streams.delete(stream); this.cleanStreams.delete(stream); }
    if ((!this.previewEnabled || document.hidden) && !this.streams.size) return;
    const scene = this.getScene();
    const interval = 1000 / scene.fps, elapsed = now - this.lastDraw;
    if (elapsed < interval) return;
    this.lastDraw = now - elapsed % interval; this.render(now); this.frameCount++;
    if (now - this.lastStats >= 1000) { this.actualFps = Math.round(this.frameCount * 1000 / (now - this.lastStats)); this.frameCount = 0; this.lastStats = now; }
  }
  resize() {
    const [w, h] = RESOLUTIONS[this.getScene().resolution];
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.comments = []; }
  }
  render(now) {
    this.resize();
    const scene = this.getScene(), ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    drawLiveSources(ctx, scene, this.getSources(), w, h);
    // Watch pages draw interactive comments above a video without burned-in text.
    if (this.cleanStreams.size) {
      if (this.cleanCanvas.width !== w || this.cleanCanvas.height !== h) { this.cleanCanvas.width = w; this.cleanCanvas.height = h; }
      this.cleanContext.drawImage(this.canvas, 0, 0);
    }
    this.renderDanmaku(now, scene);
    // requestFrame is available on CanvasCaptureMediaStreamTrack, and keeps a
    // zero-frame-rate capture in step with the selected render FPS.
    for (const stream of this.streams) {
      const track = stream.getVideoTracks()[0];
      if (track?.readyState === 'live') track.requestFrame?.(); else { this.streams.delete(stream); this.cleanStreams.delete(stream); }
    }
  }
  addDanmaku(item) {
    const settings = this.getScene().danmaku;
    if (!settings.show || settings.mode === 'none') return;
    const scale = this.canvas.width / 1920;
    const size = settings.size * scale, spacing = size * 1.65;
    const rows = Math.max(1, Math.floor(this.canvas.height * settings.area / 100 / spacing));
    const now = performance.now();
    const prefix = `${settings.showSource ? `[${item.source}] ` : ''}${settings.showUser && item.user ? `${item.user}：` : ''}`;
    const text = prefix + String(item.text).slice(0, 180);
    this.ctx.font = `600 ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    const width = this.ctx.measureText(text).width;
    const velocity = this.canvas.width / (settings.speed * 1000);
    let row = -1;
    for (let i = 0; i < rows; i++) {
      const lane = this.comments.filter(comment => comment.row === i);
      if (lane.every(comment => this.canvas.width - (now - comment.start) * comment.velocity + comment.width + 45 * scale < this.canvas.width)) { row = i; break; }
    }
    if (row === -1 || this.comments.length >= 100) return;
    this.comments.push({ text, source: item.source, self: item.self === true, row, width, start: now, velocity, size, y: row * spacing + size * 1.3 });
  }
  renderDanmaku(now, scene) {
    const ctx = this.ctx, w = this.canvas.width;
    this.comments = this.comments.filter(comment => w - (now - comment.start) * comment.velocity + comment.width > 0);
    if (!scene.danmaku.show || scene.danmaku.mode === 'none') return;
    ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.globalAlpha = scene.danmaku.opacity / 100;
    for (const comment of this.comments) {
      if (scene.danmaku.mode !== 'both' && scene.danmaku.mode !== comment.source.toLowerCase()) continue;
      const x = w - (now - comment.start) * comment.velocity;
      ctx.font = `600 ${comment.size}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.lineWidth = Math.max(1.5, comment.size / 10); ctx.strokeStyle = '#0c1119cc';
      ctx.strokeText(comment.text, x, comment.y);
      ctx.fillStyle = comment.self ? '#ffd166' : comment.source === 'A' ? '#d3ffe7' : '#e5dcff'; ctx.fillText(comment.text, x, comment.y);
    }
    ctx.restore();
  }
  createStream(audioTracks = [], { danmaku = true } = {}) {
    if (!danmaku && !this.cleanCanvas) {
      this.cleanCanvas = document.createElement('canvas'); this.cleanCanvas.width = this.canvas.width; this.cleanCanvas.height = this.canvas.height;
      this.cleanContext = this.cleanCanvas.getContext('2d', { alpha: false });
    }
    const stream = (danmaku ? this.canvas : this.cleanCanvas).captureStream(0);
    if (!danmaku) this.cleanStreams.add(stream);
    stream.getVideoTracks()[0].contentHint = 'detail';
    for (const track of audioTracks) stream.addTrack(track);
    this.streams.add(stream); stream.getVideoTracks()[0]?.requestFrame?.();
    return stream;
  }
  clearDanmaku() { this.comments = []; }
  stop() { clearInterval(this.timer); this.running = false; for (const stream of this.streams) stream.getVideoTracks().forEach(track => track.stop()); this.streams.clear(); this.cleanStreams.clear(); }
}
