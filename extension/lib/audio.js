import { CHANNELS, clamp } from './model.js';

export class AudioMixer {
  constructor() {
    this.context = null; this.tracks = new Map(); this.master = null;
    this.destination = null; this.monitor = null; this.limiter = null;
  }
  async init() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 3; this.limiter.ratio.value = 16;
      this.limiter.attack.value = 0.003; this.limiter.release.value = 0.15;
      this.destination = this.context.createMediaStreamDestination();
      this.monitor = this.context.createGain(); this.monitor.gain.value = 0;
      this.master.connect(this.limiter);
      this.limiter.connect(this.destination); this.limiter.connect(this.monitor);
      this.monitor.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }
  async attach(id, stream) {
    await this.init(); this.detach(id);
    if (!stream.getAudioTracks().length) return false;
    const source = this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const gain = this.context.createGain(); gain.gain.value = 0;
    const highpass = this.context.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 150;
    const lowpass = this.context.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 4200;
    const compressor = this.context.createDynamicsCompressor(); compressor.threshold.value = -25;
    compressor.knee.value = 20; compressor.ratio.value = 3; compressor.attack.value = 0.01; compressor.release.value = 0.2;
    const delay = this.context.createDelay(2); const pan = this.context.createStereoPanner();
    const analyser = this.context.createAnalyser(); analyser.fftSize = 256;
    source.connect(gain); gain.connect(delay); delay.connect(pan); pan.connect(analyser); analyser.connect(this.master);
    this.tracks.set(id, { source, gain, highpass, lowpass, compressor, delay, pan, analyser, voice: false, bytes: new Float32Array(256) });
    return true;
  }
  detach(id) {
    const track = this.tracks.get(id);
    if (track) { for (const node of Object.values(track)) if (node && typeof node.disconnect === 'function') node.disconnect(); this.tracks.delete(id); }
  }
  update(scene) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(scene.audio.master / 100, now, 0.02);
    this.monitor.gain.setTargetAtTime(scene.audio.monitor ? 1 : 0, now, 0.02);
    for (const id of CHANNELS) {
      const track = this.tracks.get(id); if (!track) continue;
      const settings = scene.sources[id];
      const allowed = scene.audio.mode === 'both' || scene.audio.mode === id.toLowerCase();
      track.gain.gain.setTargetAtTime(allowed && !settings.muted ? settings.volume / 100 : 0, now, 0.02);
      track.pan.pan.setTargetAtTime(settings.pan / 100, now, 0.02);
      track.delay.delayTime.setTargetAtTime(settings.delay / 1000, now, 0.02);
      if (track.voice !== settings.voice) {
        track.source.disconnect(); track.highpass.disconnect(); track.lowpass.disconnect(); track.compressor.disconnect();
        if (settings.voice) { track.source.connect(track.highpass); track.highpass.connect(track.lowpass); track.lowpass.connect(track.compressor); track.compressor.connect(track.gain); }
        else track.source.connect(track.gain);
        track.voice = settings.voice;
      }
    }
  }
  level(id) {
    const track = this.tracks.get(id); if (!track) return { percent: 0, db: -Infinity };
    track.analyser.getFloatTimeDomainData(track.bytes);
    let sum = 0; for (const value of track.bytes) sum += value * value;
    const rms = Math.sqrt(sum / track.bytes.length); const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    return { percent: clamp((db + 60) / 60 * 100, 0, 100), db };
  }
  outputTracks() { return this.destination?.stream.getAudioTracks() || []; }
  async close() { for (const id of CHANNELS) this.detach(id); if (this.context) await this.context.close(); }
}
