import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScene, sanitizeScene, applyPreset, drawGeometry, normalizeCrop, parseRoomId, DanmakuFilter, compileFilterRegex, CHANNELS } from '../extension/lib/model.js';

test('room parser accepts numeric room IDs and exact HTTPS live room links', () => {
  assert.equal(parseRoomId(' 6 '), '6');
  assert.equal(parseRoomId('https://live.bilibili.com/12345?from=live'), '12345');
  assert.equal(parseRoomId('https://live.bilibili.com/12345/'), '12345');
  for (const bad of ['https://evil.com/6', 'https://live.bilibili.com.evil.com/6', 'javascript:alert(1)', '0', '-1', 'http://live.bilibili.com/6', '6e4', 'https://live.bilibili.com/6/extra']) assert.equal(parseRoomId(bad), null, bad);
});
test('presets set both sources, preserve crop and audio, and select correct visibility', () => {
  const scene = defaultScene(); scene.sources.A.crop.x = 12; scene.sources.A.volume = 112;
  for (const name of ['split', 'stacked', 'pip', 'a', 'b']) {
    assert.equal(applyPreset(scene, name), true);
    assert.equal(scene.layout, name); assert.equal(scene.sources.A.crop.x, 12); assert.equal(scene.sources.A.volume, 112);
    for (const id of CHANNELS) { const s = scene.sources[id]; assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= 100 && s.y + s.h <= 100); }
  }
  applyPreset(scene, 'a'); assert.equal(scene.sources.B.visible, false); applyPreset(scene, 'b'); assert.equal(scene.sources.A.visible, false);
  assert.equal(applyPreset(scene, '__proto__'), false);
});
test('scene validation clamps fields, drops unknown data and preserves legitimate zero values', () => {
  const raw = defaultScene(); raw.sources.A = { ...raw.sources.A, x: 110, y: -99, w: 1000, h: -4, volume: 999, opacity: 0, delay: 9999, pan: -200 };
  raw.sources.B.room = 'x'.repeat(300); raw.audio.master = 0; raw.audio.mode = 'evil'; raw.resolution = '__proto__'; raw.background = 'url(evil)'; raw.layers = ['A', 'A'];
  raw.danmaku = { ...raw.danmaku, size: 999, maxPerSecond: -4, dedupe: false }; raw.secret = 'drop';
  const result = sanitizeScene(raw);
  assert.deepEqual([result.sources.A.x, result.sources.A.y, result.sources.A.w, result.sources.A.h], [99, 0, 1, 1]);
  assert.equal(result.sources.A.volume, 150); assert.equal(result.sources.A.opacity, 0); assert.equal(result.sources.A.delay, 2000); assert.equal(result.sources.A.pan, -100);
  assert.equal(result.audio.master, 0); assert.equal(result.audio.mode, 'both'); assert.equal(result.sources.B.room.length, 160);
  assert.equal(result.resolution, '1080p'); assert.equal(result.background, '#11131a'); assert.deepEqual(result.layers, ['A', 'B']); assert.equal(result.secret, undefined);
  assert.equal(result.danmaku.size, 64); assert.equal(result.danmaku.maxPerSecond, 1); assert.equal(result.danmaku.dedupe, false);
});
test('invalid scene schemas are rejected and valid scenes round trip', () => {
  for (const bad of [null, [], { version: 2 }, 'test']) assert.throws(() => sanitizeScene(bad));
  const scene = defaultScene(); scene.layers.reverse(); scene.sources.B.voice = true; scene.audio.mode = 'b'; scene.danmaku.regex = '广告.*加群';
  assert.deepEqual(sanitizeScene(JSON.parse(JSON.stringify(scene))), scene);
});
test('crop rectangle remains in source bounds and never has a zero dimension', () => {
  assert.deepEqual(normalizeCrop({ x: -5, y: 105, w: 0, h: 100 }), { x: 0, y: 99, w: 1, h: 1 });
  assert.deepEqual(normalizeCrop({ x: 25, y: 20, w: 90, h: 90 }), { x: 25, y: 20, w: 75, h: 80 });
});
test('contain, cover and stretch produce the expected source and destination geometry', () => {
  const s = { ...defaultScene().sources.A, x: 0, y: 0, w: 100, h: 100 };
  const contained = drawGeometry(s, 1920, 1080, 1000, 1000), expected = [0, 0, 1920, 1080, 0, 218.75, 1000, 562.5];
  contained.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9));
  assert.deepEqual(drawGeometry({ ...s, fit: 'cover' }, 1920, 1080, 1000, 1000), [420, 0, 1080, 1080, 0, 0, 1000, 1000]);
  assert.deepEqual(drawGeometry({ ...s, fit: 'stretch', crop: { x: 25, y: 0, w: 50, h: 100 } }, 1920, 1080, 1000, 1000), [480, 0, 960, 1080, 0, 0, 1000, 1000]);
});
test('danmaku filters channel, keywords, user names and UIDs, and regex', () => {
  const d = defaultScene().danmaku, filter = new DanmakuFilter();
  const item = { source: 'A', text: 'hello', user: 'user', uid: '42' };
  assert.equal(filter.accept(item, { ...d, mode: 'b' }), false);
  assert.equal(filter.accept(item, { ...d, mode: 'none' }), false);
  assert.equal(filter.accept(item, { ...d, keywords: 'HELLO, 广告' }), false);
  assert.equal(filter.accept(item, { ...d, blockedUsers: 'user' }), false);
  assert.equal(filter.accept(item, { ...d, blockedUsers: '42' }), false);
  assert.equal(filter.accept(item, { ...d, regex: '^hel.*o$' }), false);
  assert.equal(filter.accept(item, d), true);
  assert.equal(filter.accept({ ...item, text: '<script>alert(1)</script>', source: 'X' }, d), false);
});
test('dedupe applies across channels for eight seconds and can be disabled', () => {
  const d = defaultScene().danmaku, filter = new DanmakuFilter();
  assert.equal(filter.accept({ source: 'A', text: 'same' }, d, 1000), true);
  assert.equal(filter.accept({ source: 'B', text: 'same' }, d, 2000), false);
  assert.equal(filter.accept({ source: 'B', text: 'same' }, d, 9001), true);
  assert.equal(filter.accept({ source: 'A', text: 'same' }, { ...d, dedupe: false }, 9002), true);
});
test('rate limit resets each second and counts accepted comments only', () => {
  const d = { ...defaultScene().danmaku, maxPerSecond: 2 }, filter = new DanmakuFilter();
  assert.equal(filter.accept({ source: 'A', text: '1' }, d, 1000), true);
  assert.equal(filter.accept({ source: 'B', text: '2' }, d, 1100), true);
  assert.equal(filter.accept({ source: 'A', text: '3' }, d, 1200), false);
  assert.equal(filter.accept({ source: 'A', text: '3' }, d, 2000), true);
});
test('regex validator rejects expensive patterns and accepts simple useful filters', () => {
  for (const pattern of ['(a+)+$', '(a|aa)+$', 'a*a*a*b', 'a?a?a?a?a?a?', '\\\\*\\\\*x', '[', 'a'.repeat(121), '(?=a)', '(a)\\1']) assert.throws(() => compileFilterRegex(pattern), pattern);
  assert.equal(compileFilterRegex(''), null);
  assert.equal(compileFilterRegex('广告.*加群').test('广告：欢迎加群'), true);
  assert.equal(compileFilterRegex('^spam$').test('SPAM'), true);
  assert.equal(compileFilterRegex('[0-9]+').test('123'), true);
  assert.equal(compileFilterRegex('[*+?]+').test('**+?'), true);
});

test('repeating an audience message keeps own highlight while own duplicates remain filtered', () => {
  const d = defaultScene().danmaku, filter = new DanmakuFilter();
  assert.equal(filter.accept({ source: 'A', text: '一起看', self: false }, d, 1000), true);
  assert.equal(filter.accept({ source: 'A', text: '一起看', self: true }, d, 1100), true);
  assert.equal(filter.accept({ source: 'B', text: '一起看', self: true }, d, 1200), false);
});
