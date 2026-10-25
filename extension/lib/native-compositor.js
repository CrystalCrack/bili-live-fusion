export class NativeCompositor {
  constructor(scene, onReady, onError) {
    if (!globalThis.MediaStreamTrackProcessor || !globalThis.MediaStreamTrackGenerator) throw new Error('请更新 Edge 后使用网页融合');
    this.track = new MediaStreamTrackGenerator({ kind: 'video' });
    this.track.contentHint = 'detail'; this.writer = this.track.writable.getWriter();
    this.worker = new Worker(new URL('../native-compositor-worker.js', import.meta.url), { type: 'module' });
    this.inputs = new Map(); this.closed = false; this.generation = 0; this.ready = false;
    this.worker.onerror = event => { if (!this.closed) onError(new Error(event.message || '融合画面处理已中断，请重新应用场景')); };
    this.onError = onError;
    this.worker.onmessage = async event => {
      const data = event.data;
      if (data?.type === 'consumed') {
        const input = this.inputs.get(data.id); if (input?.generation === data.generation) input.pending = false;
      } else if (data?.type === 'frame') {
        const frame = data.frame;
        try {
          if (this.closed) return;
          await this.writer.write(frame);
          if (!this.closed && !this.ready) { this.ready = true; onReady(); }
        } catch (error) { if (!this.closed) onError(error); }
        finally { frame.close(); if (!this.closed) this.worker.postMessage({ type: 'output-consumed' }); }
      } else if (data?.type === 'error' && !this.closed) onError(new Error(data.error));
    };
    this.worker.postMessage({ type: 'start', scene });
  }
  attach(id, video) {
    const old = this.inputs.get(id);
    if (old?.track.readyState === 'live') return;
    const captured = video.captureStream(), track = captured.getVideoTracks()[0];
    captured.getAudioTracks().forEach(track => track.stop());
    if (!track) return;
    old?.track.stop(); old?.reader.cancel().catch(() => {});
    const processor = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 });
    const input = { track, reader: processor.readable.getReader(), generation: ++this.generation, pending: false };
    this.inputs.set(id, input); this.consume(id, input);
  }
  async consume(id, input) {
    try {
      while (!this.closed && this.inputs.get(id) === input) {
        const { value, done } = await input.reader.read(); if (done) break;
        if (this.closed || this.inputs.get(id) !== input || input.pending) { value.close(); continue; }
        try {
          input.pending = true;
          this.worker.postMessage({ type: 'source-frame', id, generation: input.generation, frame: value }, [value]);
        } catch (error) { value.close(); throw error; }
      }
    } catch (error) { if (!this.closed && this.inputs.get(id) === input) this.onError(error); }
    finally { input.reader.releaseLock(); }
  }
  close() {
    if (this.closed) return; this.closed = true;
    this.worker.terminate(); this.track.stop(); this.writer.abort().catch(() => {});
    for (const { track, reader } of this.inputs.values()) { track.stop(); reader.cancel().catch(() => {}); } this.inputs.clear();
  }
}
