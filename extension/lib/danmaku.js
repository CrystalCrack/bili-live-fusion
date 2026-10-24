const encoder = new TextEncoder(), decoder = new TextDecoder();
const MAX_PACKET = 16 * 1024 * 1024;
export function packet(operation, body = '', version = 1) {
  const payload = typeof body === 'string' ? encoder.encode(body) : body;
  const buffer = new Uint8Array(16 + payload.length), view = new DataView(buffer.buffer);
  view.setUint32(0, buffer.length); view.setUint16(4, 16); view.setUint16(6, version);
  view.setUint32(8, operation); view.setUint32(12, 1); buffer.set(payload, 16); return buffer;
}
export async function decodePackets(input, depth = 0) {
  if (depth > 3) throw new Error('弹幕压缩层数异常');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_PACKET) throw new Error('弹幕数据包过大');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = [];
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 16 > bytes.length) throw new Error('弹幕数据包不完整');
    const length = view.getUint32(offset), header = view.getUint16(offset + 4);
    const version = view.getUint16(offset + 6), operation = view.getUint32(offset + 8);
    if (length < 16 || header < 16 || header > length || offset + length > bytes.length) throw new Error('弹幕数据包格式错误');
    const body = bytes.subarray(offset + header, offset + length);
    if (operation === 5 && version === 2) {
      const reader = new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
      const chunks = []; let total = 0;
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length;
          if (total > MAX_PACKET) throw new Error('弹幕解压数据过大'); chunks.push(value); }
      } finally { await reader.cancel().catch(() => {}); }
      const unpacked = new Uint8Array(total); let position = 0;
      for (const chunk of chunks) { unpacked.set(chunk, position); position += chunk.length; }
      result.push(...await decodePackets(unpacked, depth + 1));
    } else if ([5, 8].includes(operation) && [0, 1].includes(version)) {
      for (const text of decoder.decode(body).split('\0').filter(Boolean)) {
        try { result.push({ operation, data: JSON.parse(text) }); } catch { /* Non-JSON notification. */ }
      }
    } else if (operation === 3) result.push({ operation, data: {} });
    else if (operation === 5 && version > 2) throw new Error('弹幕服务需要重新协商压缩格式');
    offset += length;
    if (result.length > 4000) throw new Error('弹幕数据包消息过多');
  }
  return result;
}
export function toDanmaku(data) {
  if (!String(data?.cmd || '').startsWith('DANMU_MSG') || !Array.isArray(data.info)) return null;
  const [meta, text, user] = data.info;
  if (typeof text !== 'string' || !text.trim()) return null;
  const timestamp = Number(meta?.[4]);
  return { text: text.slice(0, 300), user: String(user?.[1] || '观众'), uid: String(user?.[0] || ''),
    timestamp: timestamp > 1e12 ? timestamp : timestamp > 1e9 ? timestamp * 1000 : Date.now() };
}

export class DanmakuClient {
  constructor({ session, onMessage, onState, socket = url => new WebSocket(url) }) {
    Object.assign(this, { session, onMessage, onState, socket });
    this.generation = 0; this.running = false; this.attempt = 0; this.connection = null;
  }
  start() { this.stop(); this.running = true; this.attempt = 0; this.connect(this.generation); }
  stop() {
    this.running = false; this.generation++; clearTimeout(this.retry); clearTimeout(this.authTimer); clearInterval(this.heartbeat);
    this.connection?.close(); this.connection = null;
  }
  async connect(generation) {
    if (!this.running || generation !== this.generation) return;
    this.onState('connecting', '弹幕连接中');
    try {
      const session = await this.session();
      if (!this.running || generation !== this.generation) return;
      const host = session.hosts[this.attempt % session.hosts.length];
      const ws = this.socket(`wss://${host.host}:${host.wss_port}/sub`); this.connection = ws; ws.binaryType = 'arraybuffer';
      let chain = Promise.resolve(), authenticated = false, lastReply = Date.now();
      const current = () => this.running && this.generation === generation && this.connection === ws;
      this.authTimer = setTimeout(() => { if (current() && !authenticated) ws.close(); }, 12000);
      ws.onopen = () => {
        if (!current()) { ws.close(); return; }
        ws.send(packet(7, JSON.stringify({ uid: session.uid || 0, roomid: Number(session.roomId), protover: 2,
          buvid: session.buvid || '', platform: 'web', type: 2, key: session.token })));
        clearTimeout(this.authTimer);
        this.authTimer = setTimeout(() => { if (current() && !authenticated) ws.close(); }, 12000);
      };
      ws.onmessage = event => {
        chain = chain.then(async () => {
          const messages = await decodePackets(event.data instanceof Blob ? await event.data.arrayBuffer() : event.data);
          if (!current()) return;
          for (const message of messages) {
            if (message.operation === 8) {
              if (message.data.code !== 0) throw new Error(`弹幕认证失败（${message.data.code}）`);
              authenticated = true; this.attempt = 0; lastReply = Date.now(); clearTimeout(this.authTimer);
              this.onState('connected', '弹幕已连接'); ws.send(packet(2, '[object Object]'));
              clearInterval(this.heartbeat);
              this.heartbeat = setInterval(() => { if (!current()) return; if (Date.now() - lastReply > 75000) ws.close(); else if (ws.readyState === 1) ws.send(packet(2, '[object Object]')); }, 25000);
            } else if (message.operation === 3) lastReply = Date.now();
            else if (authenticated) {
              const item = toDanmaku(message.data);
              if (item) this.onMessage({ ...item, self: Number(session.uid) > 0 && item.uid === String(session.uid) });
            }
          }
        }).catch(error => { if (current()) { this.onState('error', error.message); ws.close(); } });
      };
      ws.onerror = () => { if (current()) ws.close(); };
      ws.onclose = () => { if (current()) this.schedule(generation); };
    } catch (error) { if (this.running && generation === this.generation) this.schedule(generation, error.message); }
  }
  schedule(generation, message = '弹幕已断开，正在重连') {
    clearInterval(this.heartbeat); clearTimeout(this.authTimer); this.connection = null;
    this.onState('reconnecting', message); const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5));
    this.retry = setTimeout(() => this.connect(generation), delay);
  }
}
