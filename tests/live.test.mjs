import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { md5, signWbi } from '../extension/lib/wbi.js';
import { parsePlayInfo, isMediaUrl, synchronizationTarget } from '../extension/lib/live-model.js';
import { packet, decodePackets, toDanmaku, DanmakuClient } from '../extension/lib/danmaku.js';
import { BilibiliApi } from '../extension/lib/bilibili-api.js';
import { defaultScene, sanitizeScene } from '../extension/lib/model.js';

const images = { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' };
const codec = (quality = 250) => ({ codec_name: 'avc', current_qn: quality, accept_qn: [10000, 400, 250], base_url: '/live/index.m3u8?', url_info: [{ host: 'https://live-test.bilivideo.com', extra: 'token=test' }] });
const play = () => ({ code: 0, data: { room_id: 123, live_status: 1, playurl_info: { playurl: {
  g_qn_desc: [{ qn: 10000, desc: '原画' }, { qn: 250, desc: '超清' }],
  stream: [{ protocol_name: 'http_stream', format: [{ format_name: 'flv', codec: [codec()] }] },
    { protocol_name: 'http_hls', format: [{ format_name: 'ts', codec: [codec()] }, { format_name: 'fmp4', codec: [codec()] }] }]
} } } });

test('WBI digest matches MD5 standard and Unicode/long-input vectors', () => {
  for (const input of ['', 'a', 'abc', 'message digest', '弹幕测试🎉', 'a'.repeat(1000)]) assert.equal(md5(input), createHash('md5').update(input).digest('hex'));
  const query = signWbi({ foo: "1!'()* 2", bar: 3 }, images, 1702204169000);
  assert.match(query, /^bar=3&foo=1%202&wts=1702204169&w_rid=[0-9a-f]{32}$/);
  assert.throws(() => signWbi({}, {}));
});
test('play info resolves canonical room, actual quality, available choices and CDN order', () => {
  const info = parsePlayInfo(play());
  assert.equal(info.roomId, '123'); assert.equal(info.streams[0].format, 'fmp4');
  assert.equal(info.streams[0].quality, 250); assert.equal(info.streams.at(-1).type, 'flv');
  assert.deepEqual(info.qualities.map(item => item.value), [10000, 400, 250]);
  assert.equal(info.streams[0].url, 'https://live-test.bilivideo.com/live/index.m3u8?token=test');
  const offline = play(); offline.data.live_status = 0; assert.throws(() => parsePlayInfo(offline), /未开播/);
  assert.throws(() => parsePlayInfo({ code: -1, message: 'test error' }), /test error/);
  const invalid = play(); invalid.data.playurl_info.playurl.stream = []; assert.throws(() => parsePlayInfo(invalid));
});
test('only HTTPS Bilibili media domains are accepted', () => {
  for (const url of ['https://a.bilivideo.com/live.flv', 'https://a.bilivideo.cn/live.m3u8']) assert.equal(isMediaUrl(url), true);
  for (const url of ['http://a.bilivideo.com/x', 'https://bilivideo.com.evil.com/x', 'javascript:alert(1)', 'https://localhost/x']) assert.equal(isMediaUrl(url), false);
});
test('whole-source timeline delay moves audio and video together and interpolates segment edges', () => {
  const now = 100000, args = { ranges: [[0, 30]], latency: 4, currentTime: 24, now };
  assert.equal(synchronizationTarget(args).time, 26);
  assert.equal(synchronizationTarget({ ...args, latency: 6 }).time, 24);
  assert.equal(synchronizationTarget({ ...args, now: 100500, edgeTime: now }).time, 26.5);
  assert.equal(synchronizationTarget({ ...args, playingDate: new Date(now - 6000) }).time, 26);
  assert.equal(synchronizationTarget({ ...args, ranges: [[20, 22]] }).wait, true);
  assert.equal(synchronizationTarget({ ...args, ranges: [] }), null);
});
test('direct quality and AV delay survive scene imports, including older scene defaults', () => {
  const scene = defaultScene(); scene.sources.B.syncDelay = 1550; scene.sources.A.quality = 250; scene.sync.latency = 5;
  assert.deepEqual(sanitizeScene(scene), scene);
  delete scene.sync; delete scene.sources.A.quality; scene.sources.B.syncDelay = 90000;
  const clean = sanitizeScene(scene); assert.equal(clean.sync.latency, 4); assert.equal(clean.sources.A.quality, 10000); assert.equal(clean.sources.B.syncDelay, 20000);
});
test('danmaku protocol decodes concatenated and zlib-compressed packet batches', async () => {
  const data = { cmd: 'DANMU_MSG:4:0:2:2:2:0', info: [[0, 1, 25, 16777215, 1700000000], '你好 🎉', [42, '观众']] };
  const first = packet(5, JSON.stringify(data), 0), second = packet(5, JSON.stringify({ cmd: 'LIVE' }), 0);
  const combined = new Uint8Array(first.length + second.length); combined.set(first); combined.set(second, first.length);
  const decoded = await decodePackets(packet(5, deflateSync(combined), 2));
  assert.equal(decoded.length, 2); assert.deepEqual(toDanmaku(decoded[0].data), { text: '你好 🎉', user: '观众', uid: '42', timestamp: 1700000000000 });
  assert.equal(toDanmaku(decoded[1].data), null);
  const malformed = packet(5, '{}'); new DataView(malformed.buffer).setUint32(0, 10000);
  await assert.rejects(decodePackets(malformed), /格式错误/);
  await assert.rejects(decodePackets(new Uint8Array(3)), /不完整/);
});
test('danmaku client authenticates, receives server messages and cleans up sockets', async () => {
  let ws; const states = [], messages = [];
  const client = new DanmakuClient({ session: async () => ({ roomId: '123', token: 'token', uid: 0, buvid: 'id', hosts: [{ host: 'test.chat.bilibili.com', wss_port: 443 }] }),
    socket: url => (ws = { url, readyState: 1, sent: [], send(data) { this.sent.push(data); }, close() { this.onclose?.(); } }),
    onState: (...value) => states.push(value), onMessage: item => messages.push(item) });
  client.start(); await new Promise(resolve => setImmediate(resolve)); ws.onopen();
  assert.equal(new DataView(ws.sent[0].buffer).getUint32(8), 7);
  assert.equal(JSON.parse(new TextDecoder().decode(ws.sent[0].slice(16))).protover, 2);
  ws.onmessage({ data: packet(8, '{"code":0}').buffer }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(states.at(-1)[0], 'connected');
  ws.onmessage({ data: packet(5, JSON.stringify({ cmd: 'DANMU_MSG', info: [[], 'hello', [7, 'user']] }), 0).buffer });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(messages[0].text, 'hello');
  client.stop(); assert.equal(client.connection, null); assert.equal(client.running, false);
});
test('API signs danmaku sessions, uses canonical play data, sends with CSRF and limits duplicates', async () => {
  const requests = []; let now = 100000;
  const api = new BilibiliApi({ now: () => now, cookie: async name => name === 'bili_jct' ? 'test-csrf' : 'test-buvid', fetcher: async (url, options) => {
    requests.push({ url, options }); let data;
    if (url.includes('/nav')) data = { code: -101, data: { isLogin: false, wbi_img: images } };
    else if (url.includes('getDanmuInfo')) { assert.match(url, /w_rid=/); data = { code: 0, data: { token: 't', host_list: [{ host: 'test.chat.bilibili.com', wss_port: 443 }] } }; }
    else if (url.includes('getRoomPlayInfo')) data = play();
    else data = { code: 0, data: {} };
    return { ok: true, json: async () => data };
  } });
  assert.equal((await api.play('https://live.bilibili.com/6', 250)).roomId, '123');
  assert.equal((await api.danmaku('123')).uid, 0);
  await api.send('123', 'hello'); const submission = requests.at(-1); assert.equal(submission.options.body.get('csrf'), 'test-csrf');
  assert.equal(submission.options.body.get('roomid'), '123'); await assert.rejects(api.send('123', 'hello'), /5 秒/);
  now += 5000; await api.send('123', '再来一条');
  await assert.rejects(api.play('https://evil.com/123'), /房间号/);
});
