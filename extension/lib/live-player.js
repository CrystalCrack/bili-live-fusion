import { availableRanges, synchronizationTarget } from './live-model.js';

export class LivePlayer {
  constructor(video, { resolve, onState, onInfo, getLatency, onSync }) {
    Object.assign(this, { video, resolve, onState, onInfo, getLatency, onSync });
    this.generation = 0; this.connected = false; this.running = false; this.syncReady = false;
  }
  async start(room, quality) {
    this.stop(); this.room = room; this.quality = quality; this.running = true;
    const generation = this.generation;
    this.onState('connecting', '正在获取直播流');
    await this.load(generation);
  }
  async load(generation) {
    try {
      const info = await this.resolve(this.room, this.quality);
      if (!this.running || generation !== this.generation) return;
      this.onInfo(info); this.info = info; this.index = 0;
      await this.open(info.streams[this.index], generation);
    } catch (error) {
      if (!this.running || generation !== this.generation) return;
      this.onState('error', error.message);
      this.retry = setTimeout(() => this.load(generation), 10000);
    }
  }
  clearEngine() {
    clearInterval(this.syncTimer); clearTimeout(this.startTimer);
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    if (this.flv) { this.flv.destroy(); this.flv = null; }
    this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    this.connected = false; this.syncReady = false;
    this.lastEdge = null; this.edgeTime = null;
  }
  async open(candidate, generation) {
    this.clearEngine(); this.onState('buffering', '正在缓冲直播流');
    let failed = false;
    const fail = error => {
      if (failed || !this.running || generation !== this.generation) return;
      failed = true; this.clearEngine();
      const next = this.info.streams[++this.index];
      this.onState('reconnecting', error?.message || '直播线路重连中');
      this.retry = setTimeout(() => next ? this.open(next, generation) : this.load(generation), next ? 500 : 4000);
    };
    const ready = () => {
      if (failed || !this.running || generation !== this.generation) return;
      if (this.connected) return;
      clearTimeout(this.startTimer); this.connected = true;
      this.onState('playing', `直播已连接 · ${candidate.type.toUpperCase()}`);
      this.syncTimer = setInterval(() => this.synchronize(), 500); this.synchronize(true);
    };
    this.video.onloadedmetadata = ready;
    this.video.onerror = () => fail(new Error('直播解码中断，正在切换线路'));
    this.video.onended = () => fail(new Error('直播流已结束，正在更新房间状态'));
    this.recover = fail;
    this.startTimer = setTimeout(() => fail(new Error('直播线路响应超时，正在切换')), 20000);
    if (candidate.type === 'hls' && globalThis.Hls?.isSupported()) {
      const hls = this.hls = new Hls({ enableWorker: false, lowLatencyMode: false,
        liveSyncDuration: this.getLatency(), liveMaxLatencyDuration: this.getLatency() + 15,
        maxLiveSyncPlaybackRate: 1, maxBufferLength: 45, maxMaxBufferLength: 60, backBufferLength: 45,
        xhrSetup(xhr) { xhr.withCredentials = false; } });
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) fail(new Error('直播线路中断，正在切换')); });
      hls.attachMedia(this.video); hls.loadSource(candidate.url);
    } else if (candidate.type === 'flv' && globalThis.mpegts?.isSupported()) {
      const flv = this.flv = mpegts.createPlayer({ type: 'flv', isLive: true, url: candidate.url, cors: true }, {
        enableWorker: false, enableStashBuffer: true, stashInitialSize: 128,
        liveBufferLatencyChasing: false, liveSync: false, lazyLoad: false,
        autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 45, autoCleanupMinBackwardDuration: 30 });
      flv.on(mpegts.Events.ERROR, () => fail(new Error('直播线路中断，正在切换')));
      flv.attachMediaElement(this.video); flv.load();
    } else { fail(new Error('正在切换可播放的直播格式')); }
  }
  synchronize(force = false, now = Date.now()) {
    if (!this.connected || !this.running) return;
    const video = this.video, latency = this.getLatency();
    if (this.hls) { this.hls.config.liveSyncDuration = latency; this.hls.config.liveMaxLatencyDuration = latency + 15; }
    const ranges = availableRanges(video.buffered), end = ranges.at(-1)?.[1];
    if (end !== this.lastEdge || force) { this.lastEdge = end; this.edgeTime = now; }
    if (this.edgeTime && now - this.edgeTime > 45000) { this.recover?.(new Error('直播片段接收中断，正在重连')); return; }
    const target = synchronizationTarget({ ranges, latency,
      playingDate: this.hls?.playingDate, currentTime: video.currentTime, now, edgeTime: this.edgeTime });
    if (!target) return;
    if (target.wait) { video.pause(); this.syncReady = false; this.onSync({ ...target, latency }); return; }
    const drift = target.time - video.currentTime;
    if (force || !this.syncReady || Math.abs(drift) > 0.65) video.currentTime = target.time;
    video.playbackRate = Math.abs(drift) > 0.12 && Math.abs(drift) <= 0.65 ? (drift > 0 ? 1.02 : 0.98) : 1;
    this.syncReady = true;
    if (video.paused) video.play().catch(error => this.onState('error', `请点击连接继续播放：${error.message}`));
    this.onSync({ ...target, latency, drift });
  }
  stop() {
    this.running = false; this.generation++; clearTimeout(this.retry);
    this.video.onloadedmetadata = null; this.video.onerror = null; this.video.onended = null; this.recover = null; this.clearEngine();
  }
}
