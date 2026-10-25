export class NativeCompositor {
  constructor(scene, writable, onReady, onError) {
    if (!globalThis.MediaStreamTrackProcessor) throw new Error('请更新 Edge 后使用网页融合');
    this.worker = new Worker(new URL('../native-compositor-worker.js', import.meta.url), { type: 'module' });
    this.inputs = new Map(); this.closed = false;
    this.worker.onerror = event => onError(new Error(event.message || '融合画面处理已中断，请重新应用场景'));
    this.worker.onmessage = event => { if (event.data?.type === 'error') onError(new Error(event.data.error)); else if (event.data?.type === 'ready') onReady(); };
    this.worker.postMessage({ type: 'start', scene, writable }, [writable]);
  }
  attach(id, video) {
    const old = this.inputs.get(id);
    if (old?.track.readyState === 'live') return;
    const captured = video.captureStream(), track = captured.getVideoTracks()[0];
    captured.getAudioTracks().forEach(track => track.stop());
    if (!track) return;
    old?.track.stop();
    const processor = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 });
    this.inputs.set(id, { track, processor });
    this.worker.postMessage({ type: 'source', id, readable: processor.readable }, [processor.readable]);
  }
  close() {
    if (this.closed) return; this.closed = true;
    this.worker.terminate();
    for (const { track } of this.inputs.values()) track.stop(); this.inputs.clear();
  }
}
