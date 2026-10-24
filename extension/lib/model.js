export const CHANNELS = ['A', 'B'];
export const RESOLUTIONS = { '1080p': [1920, 1080], '720p': [1280, 720], portrait: [1080, 1920], square: [1080, 1080] };
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseRoomId(input) {
  const text = String(input || '').trim();
  if (/^[1-9]\d{0,17}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol === 'https:' && url.hostname === 'live.bilibili.com') {
      const match = url.pathname.match(/^\/([1-9]\d{0,17})\/?$/);
      if (match) return match[1];
    }
  } catch { /* Plain invalid room input. */ }
  return null;
}

export function defaultScene() {
  return {
    version: 1, name: '未命名场景', resolution: '1080p', fps: 30, background: '#11131a',
    layout: 'split', selected: 'A',
    sources: Object.fromEntries(CHANNELS.map((id, index) => [id, {
      room: '', visible: true, x: index * 50, y: 0, w: 50, h: 100,
      crop: { x: 0, y: 0, w: 100, h: 100 }, fit: 'contain', opacity: 100,
      volume: 80, muted: false, pan: 0, voice: false, delay: 0, quality: 10000, syncDelay: 0
    }])),
    layers: ['A', 'B'], audio: { mode: 'both', master: 80, monitor: true }, sync: { latency: 4 },
    danmaku: { mode: 'both', show: true, opacity: 85, size: 30, speed: 10, area: 50,
      keywords: '', regex: '', blockedUsers: '', dedupe: true, maxPerSecond: 5,
      showUser: false, showSource: true }
  };
}

export function applyPreset(scene, name) {
  const presets = {
    split: [[0, 0, 50, 100], [50, 0, 50, 100]],
    stacked: [[0, 0, 100, 50], [0, 50, 100, 50]],
    pip: [[0, 0, 100, 100], [68, 64, 30, 33]],
    a: [[0, 0, 100, 100], [0, 0, 100, 100]],
    b: [[0, 0, 100, 100], [0, 0, 100, 100]]
  };
  if (!Object.hasOwn(presets, name)) return false;
  CHANNELS.forEach((id, i) => {
    const [x, y, w, h] = presets[name][i];
    Object.assign(scene.sources[id], { x, y, w, h, visible: name === 'a' ? id === 'A' : name === 'b' ? id === 'B' : true });
  });
  scene.layers = ['A', 'B'];
  scene.layout = name;
  return true;
}

function sourceSettings(raw, fallback) {
  const result = { ...fallback };
  result.room = String(raw?.room || '').slice(0, 160);
  for (const key of ['visible', 'muted', 'voice']) if (typeof raw?.[key] === 'boolean') result[key] = raw[key];
  for (const key of ['x', 'y']) result[key] = clamp(number(raw?.[key], fallback[key]), 0, 99);
  for (const key of ['w', 'h']) result[key] = clamp(number(raw?.[key], fallback[key]), 1, 100 - result[key === 'w' ? 'x' : 'y']);
  result.crop = normalizeCrop(raw?.crop || fallback.crop);
  result.fit = ['contain', 'cover', 'stretch'].includes(raw?.fit) ? raw.fit : fallback.fit;
  result.opacity = clamp(number(raw?.opacity, fallback.opacity), 0, 100);
  result.volume = clamp(number(raw?.volume, fallback.volume), 0, 150);
  result.pan = clamp(number(raw?.pan, fallback.pan), -100, 100);
  result.delay = clamp(number(raw?.delay, fallback.delay), 0, 2000);
  result.quality = Math.round(clamp(number(raw?.quality, fallback.quality), 1, 100000));
  result.syncDelay = clamp(number(raw?.syncDelay, 0), 0, 20000);
  return result;
}

export function normalizeCrop(crop) {
  const x = clamp(number(crop.x), 0, 99);
  const y = clamp(number(crop.y), 0, 99);
  return { x, y, w: clamp(number(crop.w, 100), 1, 100 - x), h: clamp(number(crop.h, 100), 1, 100 - y) };
}

export function sanitizeScene(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1) throw new Error('不是受支持的场景文件（需要 version: 1）');
  const result = defaultScene();
  result.name = String(raw.name || result.name).slice(0, 60);
  result.resolution = Object.hasOwn(RESOLUTIONS, raw.resolution) ? raw.resolution : result.resolution;
  result.fps = [24, 30, 60].includes(raw.fps) ? raw.fps : 30;
  result.background = /^#[0-9a-f]{6}$/i.test(raw.background) ? raw.background : result.background;
  result.layout = ['split', 'stacked', 'pip', 'a', 'b', 'custom'].includes(raw.layout) ? raw.layout : 'custom';
  result.selected = CHANNELS.includes(raw.selected) ? raw.selected : 'A';
  if (Array.isArray(raw.layers) && raw.layers.length === 2 && new Set(raw.layers).size === 2 && raw.layers.every(id => CHANNELS.includes(id))) result.layers = [...raw.layers];
  for (const id of CHANNELS) result.sources[id] = sourceSettings(raw.sources?.[id], result.sources[id]);
  const a = raw.audio || {};
  result.sync.latency = clamp(number(raw.sync?.latency, 4), 2, 15);
  result.audio.mode = ['a', 'b', 'both', 'none'].includes(a.mode) ? a.mode : 'both';
  result.audio.master = clamp(number(a.master, 80), 0, 100);
  result.audio.monitor = typeof a.monitor === 'boolean' ? a.monitor : true;
  const d = raw.danmaku || {};
  result.danmaku.mode = ['a', 'b', 'both', 'none'].includes(d.mode) ? d.mode : 'both';
  for (const key of ['show', 'dedupe', 'showUser', 'showSource']) if (typeof d[key] === 'boolean') result.danmaku[key] = d[key];
  for (const [key, min, max] of [['opacity', 0, 100], ['size', 16, 64], ['speed', 4, 20], ['area', 20, 100], ['maxPerSecond', 1, 20]]) {
    result.danmaku[key] = clamp(number(d[key], result.danmaku[key]), min, max);
  }
  for (const key of ['keywords', 'blockedUsers']) result.danmaku[key] = String(d[key] || '').slice(0, 2000);
  result.danmaku.regex = String(d.regex || '').slice(0, 120);
  return result;
}

export function drawGeometry(source, inputWidth, inputHeight, canvasWidth, canvasHeight) {
  const crop = normalizeCrop(source.crop);
  const sx = crop.x / 100 * inputWidth, sy = crop.y / 100 * inputHeight;
  let sw = crop.w / 100 * inputWidth, sh = crop.h / 100 * inputHeight;
  let dx = source.x / 100 * canvasWidth, dy = source.y / 100 * canvasHeight;
  let dw = source.w / 100 * canvasWidth, dh = source.h / 100 * canvasHeight;
  let sourceX = sx, sourceY = sy;
  if (source.fit === 'contain') {
    const scale = Math.min(dw / sw, dh / sh);
    dx += (dw - sw * scale) / 2; dy += (dh - sh * scale) / 2;
    dw = sw * scale; dh = sh * scale;
  } else if (source.fit === 'cover') {
    const targetRatio = dw / dh;
    if (sw / sh > targetRatio) { const newWidth = sh * targetRatio; sourceX += (sw - newWidth) / 2; sw = newWidth; }
    else { const newHeight = sw / targetRatio; sourceY += (sh - newHeight) / 2; sh = newHeight; }
  }
  return [sourceX, sourceY, sw, sh, dx, dy, dw, dh];
}

// Restrict regex to linear-time patterns: no groups, alternation, backreferences,
// lookarounds or repeated wildcard quantifiers. This prevents imported ReDoS rules.
export function compileFilterRegex(pattern) {
  if (!pattern) return null;
  if (pattern.length > 120) throw new Error('正则最多 120 个字符');
  let inClass = false, quantifiers = 0;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') {
      const escaped = pattern[++i];
      if (escaped && /[1-9]/.test(escaped)) throw new Error('请使用关键词或字符类规则');
      continue;
    }
    if (char === '[' && !inClass) { inClass = true; continue; }
    if (char === ']' && inClass) { inClass = false; continue; }
    if (inClass) continue;
    if ('()|{}'.includes(char)) throw new Error('请使用关键词或字符类规则');
    if ('*+?'.includes(char) && ++quantifiers > 1) throw new Error('正则最多使用一个量词（*、+ 或 ?）');
  }
  try { return new RegExp(pattern, 'iu'); } catch { throw new Error('正则表达式格式错误'); }
}

export class DanmakuFilter {
  constructor() { this.seen = new Map(); this.second = -1; this.count = 0; this.cachedPattern = undefined; this.regex = null; }
  accept(item, settings, now = Date.now()) {
    if (!CHANNELS.includes(item.source) || !String(item.text || '').trim()) return false;
    if (settings.mode === 'none' || (settings.mode !== 'both' && settings.mode !== item.source.toLowerCase())) return false;
    const text = String(item.text).slice(0, 300);
    const tokens = String(settings.keywords).split(/[\n,，]/).map(s => s.trim().toLocaleLowerCase()).filter(Boolean);
    if (tokens.some(token => text.toLocaleLowerCase().includes(token))) return false;
    const blocked = String(settings.blockedUsers).split(/[\n,，]/).map(s => s.trim()).filter(Boolean);
    if (blocked.includes(String(item.uid)) || blocked.includes(String(item.user))) return false;
    if (this.cachedPattern !== settings.regex) { this.regex = compileFilterRegex(settings.regex); this.cachedPattern = settings.regex; }
    if (this.regex?.test(text)) return false;
    const key = `${item.self ? 'self:' : 'audience:'}${text.trim().toLocaleLowerCase()}`;
    if (settings.dedupe && this.seen.has(key) && now - this.seen.get(key) < 8000) return false;
    const second = Math.floor(now / 1000);
    if (second !== this.second) { this.second = second; this.count = 0; }
    if (this.count >= settings.maxPerSecond) return false;
    this.count++;
    this.seen.set(key, now);
    if (this.seen.size > 800) for (const [k, time] of this.seen) if (now - time >= 8000) this.seen.delete(k);
    if (this.seen.size > 1200) this.seen.delete(this.seen.keys().next().value);
    return true;
  }
}
