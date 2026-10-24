export class WatchDanmaku {
  constructor(layer, { onCopy, onRepeat } = {}) {
    this.layer = layer; this.onCopy = onCopy; this.onRepeat = onRepeat; this.items = new Set();
    this.settings = {}; this.enabled = true; this.paused = false; this.width = 0; this.height = 0;
  }
  configure(settings) {
    if (JSON.stringify(this.settings) !== JSON.stringify(settings)) this.clear();
    this.settings = { ...settings }; this.updateVisibility();
  }
  resize(left, top, width, height) {
    if (Math.abs(width - this.width) > 1 || Math.abs(height - this.height) > 1) this.clear();
    this.width = width; this.height = height;
    Object.assign(this.layer.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }
  setEnabled(enabled) { this.enabled = enabled; this.updateVisibility(); }
  updateVisibility() { this.layer.hidden = !this.enabled || !this.settings.show || this.settings.mode === 'none'; }
  setPaused(paused) { this.paused = paused; for (const item of this.items) this.updateAnimation(item); }
  updateAnimation(item) {
    const held = this.paused || item.element.matches(':hover') || item.element.contains(document.activeElement) || item.busy;
    if (held) item.animation.pause(); else item.animation.play();
    item.element.classList.toggle('held', held);
    if (held) {
      const actions = item.element.querySelector('.comment-actions'), rect = item.element.getBoundingClientRect(), bounds = this.layer.getBoundingClientRect();
      const actionsWidth = actions.getBoundingClientRect().width;
      actions.style.left = `${Math.max(bounds.left - rect.left, Math.min(0, bounds.right - rect.left - actionsWidth))}px`;
    }
  }
  add(raw) {
    const settings = this.settings;
    if (this.layer.hidden || this.paused || !this.width || !Number.isFinite(settings.size) || this.items.size >= 100 || !['A', 'B'].includes(raw?.source) || typeof raw.text !== 'string') return;
    if (settings.mode !== 'both' && settings.mode !== raw.source.toLowerCase()) return;
    const scale = Math.max(.5, this.width / 1920), size = settings.size * scale;
    const spacing = size * 1.8, top = 56;
    const rows = Math.max(1, Math.floor((Math.min(this.height * settings.area / 100, this.height - 70) - top) / spacing));
    let row = -1;
    for (let candidate = 0; candidate < rows; candidate++) {
      const occupied = [...this.items].filter(item => item.row === candidate);
      if (occupied.every(item => item.animation.playState !== 'paused' && this.position(item) + item.width + 30 * scale < this.width)) { row = candidate; break; }
    }
    if (row < 0) return;
    const element = document.createElement('div'); element.className = `watch-comment source-${raw.source.toLowerCase()}${raw.self ? ' self' : ''}`; element.tabIndex = 0;
    element.dataset.source = raw.source; element.dataset.text = raw.text;
    element.setAttribute('aria-label', `${raw.source}：${raw.text}，复制或加一发送`);
    Object.assign(element.style, { top: `${row * spacing + top}px`, fontSize: `${size}px`, opacity: String(settings.opacity / 100) });
    const label = document.createElement('span'); label.className = 'comment-text';
    label.textContent = `${settings.showSource ? `[${raw.source}] ` : ''}${settings.showUser && raw.user ? `${raw.user}：` : ''}${raw.text.slice(0, 180)}`;
    const actions = document.createElement('div'); actions.className = 'comment-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制'; copy.setAttribute('aria-label', '复制弹幕');
    const repeat = document.createElement('button'); repeat.type = 'button'; repeat.textContent = '+1'; repeat.title = `发送到 ${raw.source}`; repeat.setAttribute('aria-label', `+1 发送到 ${raw.source}`);
    actions.append(copy, repeat); element.append(label, actions); this.layer.append(element);
    const width = element.getBoundingClientRect().width, duration = settings.speed * 1000 * (1 + width / this.width);
    const animation = element.animate([{ transform: `translateX(${this.width}px)` }, { transform: `translateX(${-width}px)` }], { duration, easing: 'linear', fill: 'forwards' });
    const item = { element, animation, row, width, duration, busy: false }; this.items.add(item);
    animation.onfinish = () => { element.remove(); this.items.delete(item); };
    const update = () => this.updateAnimation(item);
    element.addEventListener('pointerenter', update); element.addEventListener('pointerleave', update);
    element.addEventListener('focusin', update); element.addEventListener('focusout', () => queueMicrotask(update));
    copy.addEventListener('click', () => this.onCopy?.(raw.text));
    repeat.disabled = [...raw.text.trim()].length > 30; if (repeat.disabled) repeat.title = '弹幕发送限 30 个字，可复制后编辑';
    repeat.addEventListener('click', async () => {
      if (item.busy) return; item.busy = true; element.classList.add('sending'); update();
      try { await this.onRepeat?.(raw.text, raw.source); }
      finally { item.busy = false; element.classList.remove('sending'); update(); }
    });
  }
  position(item) { return this.width - (this.width + item.width) * Math.min(1, Number(item.animation.currentTime || 0) / item.duration); }
  clear() { for (const item of this.items) { item.animation.cancel(); item.element.remove(); } this.items.clear(); }
}
