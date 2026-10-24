import test from 'node:test';
import assert from 'node:assert/strict';
import { drawLiveSources, viewingSize, videoLayerGeometry } from '../extension/lib/live-surface.js';
import { defaultScene, drawGeometry } from '../extension/lib/model.js';

test('viewing canvas follows display pixels and scene aspect instead of fixed output size', () => {
  const scene = defaultScene();
  assert.deepEqual(viewingSize(scene, 1280, 800, 1), [1280, 720]);
  assert.deepEqual(viewingSize(scene, 1920, 1080, 2), [3840, 2160]);
  assert.deepEqual(viewingSize(scene, 7680, 4320, 1), [3840, 2160]);
  scene.resolution = '720p'; assert.deepEqual(viewingSize(scene, 1920, 1080, 1), [1920, 1080]);
  scene.resolution = 'portrait'; assert.deepEqual(viewingSize(scene, 1920, 1080, 1), [608, 1080]);
});

test('viewing draws original decoders with crop, layer order, opacity and high quality scaling', () => {
  const scene = defaultScene(), draws = [];
  scene.layers = ['B', 'A']; scene.sources.A.opacity = 50; scene.sources.A.crop = { x: 25, y: 0, w: 50, h: 100 };
  const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 };
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, drawImage(...args) { draws.push([this.globalAlpha, ...args]); } };
  drawLiveSources(ctx, scene, { A: { video, player: { connected: true } }, B: { video, player: { connected: true } } }, 1920, 1080);
  assert.equal(draws.length, 2); assert.equal(draws[0][0], 1); assert.equal(draws[1][0], .5);
  assert.equal(draws[1][2], 480); assert.equal(draws[1][4], 960);
  assert.equal(ctx.imageSmoothingQuality, 'high');
});

test('direct video layers preserve crop and fit geometry', () => {
  const scene = defaultScene(), settings = scene.sources.A;
  Object.assign(settings, { x: 0, y: 0, w: 100, h: 100, crop: { x: 25, y: 0, w: 50, h: 100 }, fit: 'contain' });
  const g = videoLayerGeometry(settings, 1920, 1080, 1920, 1080);
  assert.deepEqual(g, { x: 0, y: 0, width: 1920, height: 1080, clipX: 480, clipY: 0, clipWidth: 960, clipHeight: 1080, videoX: -480, videoY: 0, videoWidth: 1920, videoHeight: 1080 });
  settings.fit = 'cover'; const cover = videoLayerGeometry(settings, 1920, 1080, 1920, 1080);
  assert.equal(cover.videoWidth, 3840); assert.equal(cover.videoHeight, 2160); assert.equal(cover.videoX, -960); assert.equal(cover.videoY, -540);
  settings.fit = 'stretch'; const stretch = videoLayerGeometry(settings, 1920, 1080, 1920, 1080);
  assert.equal(stretch.videoWidth, 3840); assert.equal(stretch.videoHeight, 1080); assert.equal(stretch.videoX, -960); assert.equal(stretch.videoY, 0);
});

test('direct layer clipping matches canvas sampling for all fit modes and off-center crops', () => {
  const scene = defaultScene(), settings = scene.sources.A;
  Object.assign(settings, { x: 13, y: 17, w: 61, h: 72, crop: { x: 14, y: 21, w: 67, h: 48 } });
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8);
  for (const fit of ['contain', 'cover', 'stretch']) {
    settings.fit = fit;
    const g = videoLayerGeometry(settings, 1920, 1080, 1440, 900);
    const [sx, sy, sw, sh, dx, dy, dw, dh] = drawGeometry(settings, 1920, 1080, 1440, 900);
    close(g.x + g.clipX, dx); close(g.y + g.clipY, dy); close(g.clipWidth, dw); close(g.clipHeight, dh);
    close(g.videoX + sx * g.videoWidth / 1920, 0); close(g.videoY + sy * g.videoHeight / 1080, 0);
    close(sw * g.videoWidth / 1920, dw); close(sh * g.videoHeight / 1080, dh);
  }
});
