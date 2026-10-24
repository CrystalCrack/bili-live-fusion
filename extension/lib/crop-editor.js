import { clamp, normalizeCrop } from './model.js';

export class CropEditor {
  constructor({ dialog, stage, box, video, label, onApply }) {
    Object.assign(this, { dialog, stage, box, video, label, onApply });
    this.draft = { x: 0, y: 0, w: 100, h: 100 }; this.sourceId = 'A'; this.drag = null;
    stage.addEventListener('pointerdown', event => this.startDrag(event));
    stage.addEventListener('pointermove', event => this.move(event));
    stage.addEventListener('pointerup', () => { this.drag = null; });
    stage.addEventListener('pointercancel', () => { this.drag = null; });
    stage.addEventListener('lostpointercapture', () => { this.drag = null; });
    dialog.addEventListener('close', () => { video.srcObject = null; this.drag = null; });
  }
  async open(sourceId, stream, crop) {
    if (!stream?.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('请先接入此直播源，再框选裁剪区域');
    this.sourceId = sourceId; this.draft = { ...crop }; this.video.srcObject = stream;
    await this.video.play();
    this.stage.style.aspectRatio = `${this.video.videoWidth || 16} / ${this.video.videoHeight || 9}`;
    this.dialog.querySelector('[data-crop-source]').textContent = `直播间 ${sourceId}`;
    this.update(); this.dialog.showModal();
  }
  point(event, rect) { return { x: clamp((event.clientX - rect.left) / rect.width * 100, 0, 100), y: clamp((event.clientY - rect.top) / rect.height * 100, 0, 100) }; }
  startDrag(event) {
    if (event.button !== 0) return;
    const rect = this.stage.getBoundingClientRect(), point = this.point(event, rect);
    this.drag = { rect, point, original: { ...this.draft }, mode: event.target.dataset.cropHandle || (this.box.contains(event.target) ? 'move' : 'draw') };
    this.stage.setPointerCapture(event.pointerId); event.preventDefault();
  }
  move(event) {
    if (!this.drag) return;
    const { rect, point, original, mode } = this.drag, p = this.point(event, rect), dx = p.x - point.x, dy = p.y - point.y;
    if (mode === 'move') this.draft = { ...original, x: clamp(original.x + dx, 0, 100 - original.w), y: clamp(original.y + dy, 0, 100 - original.h) };
    else if (mode === 'draw') this.draft = normalizeCrop({ x: Math.min(point.x, p.x, 99), y: Math.min(point.y, p.y, 99), w: Math.max(1, Math.abs(dx)), h: Math.max(1, Math.abs(dy)) });
    else {
      let x = original.x, y = original.y, right = original.x + original.w, bottom = original.y + original.h;
      if (mode.includes('w')) x = clamp(original.x + dx, 0, right - 1);
      if (mode.includes('e')) right = clamp(right + dx, x + 1, 100);
      if (mode.includes('n')) y = clamp(original.y + dy, 0, bottom - 1);
      if (mode.includes('s')) bottom = clamp(bottom + dy, y + 1, 100);
      this.draft = { x, y, w: right - x, h: bottom - y };
    }
    this.update();
  }
  update() {
    Object.assign(this.box.style, { left: `${this.draft.x}%`, top: `${this.draft.y}%`, width: `${this.draft.w}%`, height: `${this.draft.h}%` });
    this.label.textContent = `${this.draft.w.toFixed(1)}% × ${this.draft.h.toFixed(1)}%`;
  }
  reset() { this.draft = { x: 0, y: 0, w: 100, h: 100 }; this.update(); }
  apply() { this.onApply(this.sourceId, normalizeCrop(this.draft)); this.dialog.close(); }
}
