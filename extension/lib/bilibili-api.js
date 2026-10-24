import { parseRoomId } from './model.js';
import { parsePlayInfo } from './live-model.js';
import { signWbi } from './wbi.js';
import { withTimeout } from './async.js';

export class BilibiliApi {
  constructor({ fetcher = (url, options) => globalThis.fetch(url, options), cookie = async () => null, now = () => Date.now(), onRequest = () => {}, timeout = 15000 } = {}) {
    this.fetcher = fetcher; this.cookie = cookie; this.now = now; this.navigation = null; this.lastSend = new Map();
    this.onRequest = onRequest; this.timeout = timeout;
  }
  async json(url, options = {}) {
    const controller = new AbortController(), path = new URL(url).pathname, started = this.now();
    this.onRequest('request', path);
    try {
      return await withTimeout((async () => {
        let response;
        try { response = await this.fetcher(url, { credentials: 'include', cache: 'no-store', ...options, signal: controller.signal }); }
        catch { throw new Error('无法连接 B 站直播服务，请检查网络后重连'); }
        this.onRequest('response', `${path} · HTTP ${response.status || (response.ok ? 200 : '错误')} · ${this.now() - started} ms`);
        if (!response.ok) throw new Error(`直播服务连接失败（${response.status}），请稍后重连`);
        try { return await response.json(); } catch { throw new Error('直播服务响应异常，请稍后重连'); }
      })(), this.timeout, 'B 站直播接口响应超时，请检查网络后重连');
    } catch (error) {
      this.onRequest('error', `${path} · ${error.message}`); throw error;
    } finally { controller.abort(); }
  }
  async nav(refresh = false) {
    if (!refresh && this.navigation && this.now() - this.navigation.time < 60000) return this.navigation.data;
    const result = await this.json('https://api.bilibili.com/x/web-interface/nav');
    if (!result.data?.wbi_img) throw new Error('获取直播服务签名失败，请稍后重连');
    this.navigation = { data: result.data, time: this.now() }; return result.data;
  }
  async play(room, quality = 10000) {
    const roomId = parseRoomId(room);
    if (!roomId) throw new Error('请输入正确的房间号或直播间链接');
    const qn = Number(quality);
    if (!Number.isInteger(qn) || qn < 1 || qn > 100000) throw new Error('请选择直播画质');
    const params = new URLSearchParams({ room_id: roomId, protocol: '0,1', format: '0,1,2', codec: '0',
      qn: String(qn), platform: 'web', ptype: '8', dolby: '0', panorama: '0' });
    return parsePlayInfo(await this.json(`https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?${params}`));
  }
  async danmaku(room) {
    const roomId = parseRoomId(room); if (!roomId) throw new Error('请输入正确的房间号');
    for (let attempt = 0; attempt < 2; attempt++) {
      const nav = await this.nav(true);
      const query = signWbi({ id: roomId, type: 0, web_location: '444.8' }, nav.wbi_img, this.now());
      const result = await this.json(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${query}`);
      if (result.code === 0 && result.data?.token) {
        let buvid = await this.cookie('buvid3');
        if (!buvid) { const fingerprint = await this.json('https://api.bilibili.com/x/frontend/finger/spi'); buvid = fingerprint.data?.b_3 || ''; }
        const hosts = (result.data.host_list || []).filter(item => /^[a-z\d.-]+\.bilibili\.com$/i.test(item.host) && Number.isInteger(item.wss_port));
        if (!hosts.length) throw new Error('弹幕服务暂时没有可用线路');
        return { roomId, token: result.data.token, uid: nav.isLogin ? Number(nav.mid) : 0, buvid, hosts };
      }
      if (attempt === 1) throw new Error(result.message && result.message !== String(result.code) ? result.message : `弹幕认证失败（${result.code}），请登录 B 站后重连弹幕`);
    }
  }
  async send(room, rawText) {
    const roomId = parseRoomId(room), text = String(rawText || '').trim();
    if (!roomId) throw new Error('请先连接直播间');
    if (!text || [...text].length > 30) throw new Error('弹幕请输入 1–30 个字');
    if (this.lastSend.has(roomId) && this.now() - this.lastSend.get(roomId) < 5000) throw new Error('两次发送请间隔 5 秒');
    const csrf = await this.cookie('bili_jct');
    if (!csrf) throw new Error('请先在此浏览器登录 B 站，再发送弹幕');
    // Reserve the slot before awaiting the request to prevent duplicate sends.
    this.lastSend.set(roomId, this.now());
    const form = new URLSearchParams({ bubble: '0', msg: text, color: '16777215', mode: '1', fontsize: '25',
      rnd: String(Math.floor(this.now() / 1000)), roomid: roomId, csrf, csrf_token: csrf });
    const result = await this.json('https://api.live.bilibili.com/msg/send', { method: 'POST', body: form });
    if (result.code !== 0 || (result.data?.msg && result.data.msg !== 'success')) throw new Error(result.data?.msg || result.message || '弹幕发送失败');
    return { sent: true, roomId };
  }
}
