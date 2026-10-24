import { BilibiliApi } from './bilibili-api.js';
import { ensureLiveNetwork } from './live-network.js';
import { withTimeout } from './async.js';

const actions = { LIVE_PLAY_INFO: 'play', LIVE_DANMAKU_SESSION: 'danmaku', LIVE_SEND_DANMAKU: 'send' };

export class LiveSession {
  constructor({ browser = globalThis.chrome, configure = () => ensureLiveNetwork(browser), api, onEvent = () => {} } = {}) {
    this.configure = configure; this.onEvent = onEvent;
    this.api = api || new BilibiliApi({
      cookie: async name => (await withTimeout(browser.cookies.get({ url: 'https://www.bilibili.com/', name }), 3000, '浏览器登录信息读取超时'))?.value || null,
      onRequest: (stage, detail) => onEvent(`http:${stage}`, detail)
    });
  }
  accepts(message) { return Object.hasOwn(actions, message?.type); }
  async request(message) {
    if (!this.accepts(message)) throw new Error('未知的直播操作');
    this.onEvent('network:setup', '正在检查直播网站权限与网络设置');
    await this.configure();
    this.onEvent('network:ready', '工作台直连网络已就绪');
    const args = message.type === 'LIVE_PLAY_INFO' ? [message.roomId, message.quality] : message.type === 'LIVE_SEND_DANMAKU' ? [message.roomId, message.text] : [message.roomId];
    return this.api[actions[message.type]](...args);
  }
}
