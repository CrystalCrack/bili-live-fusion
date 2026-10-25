import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScene } from '../extension/lib/model.js';
import { embeddedScene, isLiveRoomUrl, validEmbedGrant } from '../extension/lib/embed-model.js';

test('page embedding accepts only HTTPS Bilibili room pages', () => {
  for (const url of ['https://live.bilibili.com/84074', 'https://live.bilibili.com/6/?from=search']) assert.equal(isLiveRoomUrl(url), true);
  for (const url of ['http://live.bilibili.com/6', 'https://live.bilibili.com.evil.test/6', 'https://live.bilibili.com/', 'https://live.bilibili.com/6/extra', 'https://www.bilibili.com/6', 'invalid']) assert.equal(isLiveRoomUrl(url), false);
});

test('page playback preserves saved layout, quality and A/V alignment without changing the saved scene', () => {
  const saved = defaultScene(); saved.sources.A.room = '6'; saved.sources.B.room = 'https://live.bilibili.com/84074';
  saved.sources.A.quality = 250; saved.sources.B.syncDelay = 4300; saved.sources.A.delay = 180;
  saved.sources.B.crop = { x: 20, y: 10, w: 50, h: 60 }; saved.layers = ['B', 'A']; saved.audio.monitor = false; saved.audio.mode = 'b';
  const { scene, rooms } = embeddedScene(saved);
  assert.deepEqual(rooms, [{ id: 'A', room: '6' }, { id: 'B', room: '84074' }]);
  assert.equal(scene.sources.A.quality, 250); assert.equal(scene.sources.B.syncDelay, 4300); assert.equal(scene.sources.A.delay, 180);
  assert.deepEqual(scene.sources.B.crop, saved.sources.B.crop); assert.deepEqual(scene.layers, ['B', 'A']);
  assert.equal(scene.audio.mode, 'b'); assert.equal(scene.audio.monitor, true); assert.equal(saved.audio.monitor, false);
  scene.sources.A.x = 80; assert.equal(saved.sources.A.x, 0);
});

test('missing scenes and invalid room inputs cannot start page playback', () => {
  assert.throws(() => embeddedScene(null), /保存场景/);
  assert.throws(() => embeddedScene(defaultScene()), /填写直播间/);
  const scene = defaultScene(); scene.sources.B.room = 'https://evil.test/6'; assert.throws(() => embeddedScene(scene), /填写直播间/);
  scene.sources.A.room = '84074'; assert.deepEqual(embeddedScene(scene).rooms, [{ id: 'A', room: '84074' }]);
});

test('webpage playback grants are short-lived and bound to one tab, extension frame and nonce', () => {
  const token = '12345678-1234-1234-1234-123456789abc', now = 100000;
  const grant = { tabId: 9, expires: now + 60000 };
  const sender = { id: 'fixture', tab: { id: 9 }, frameId: 2, url: 'chrome-extension://fixture/embed.html#' + token };
  assert.equal(validEmbedGrant(grant, sender, token, 'fixture', now), true);
  for (const invalid of [undefined, { ...grant, tabId: 10 }, { ...grant, expires: now - 1 }, { ...grant, expires: now + 60001 }]) assert.equal(validEmbedGrant(invalid, sender, token, 'fixture', now), false);
  for (const invalid of [{ ...sender, id: 'other' }, { ...sender, frameId: 0 }, { ...sender, url: 'https://live.bilibili.com/6#' + token }, { ...sender, url: 'chrome-extension://fixture/studio.html#' + token }, { ...sender, url: 'chrome-extension://fixture/embed.html#wrong' }]) assert.equal(validEmbedGrant(grant, invalid, token, 'fixture', now), false);
});
