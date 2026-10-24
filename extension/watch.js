import { WatchDanmaku } from './lib/watch-danmaku.js';
import { LiveSurface } from './lib/live-surface.js';

export class WatchView {
  constructor(player, { read, getState, getAudio, onSend, onStudio }) {
    this.player = player; this.read = read; this.getState = getState; this.getAudio = getAudio; this.onSend = onSend;
    this.$ = selector => player.querySelector(selector);
    const $ = this.$; this.video = $('#watch-video'); this.video.volume = .8; this.video.muted = false;
    this.state = { sources: [], danmaku: {} }; this.active = false; this.sending = false; this.danmakuEnabled = true; this.homes = [];
    this.comments = new WatchDanmaku($('#watch-danmaku'), { onCopy: text => this.copyText(text), onRepeat: (text, target) => this.sendDanmaku(text, target) });
    this.surface = new LiveSurface($('#watch-canvas'), read, (w, h) => { const picture = $('#watch-picture'); this.comments.resize((picture.clientWidth - w) / 2, (picture.clientHeight - h) / 2, w, h); }, $('#watch-decoders'));
    this.observer = new ResizeObserver(() => this.fit()); this.observer.observe($('#watch-picture'));
    player.addEventListener('pointermove', () => this.showControls()); player.addEventListener('focusin', () => this.showControls());
    $('#watch-picture').addEventListener('dblclick', event => { if (!event.target.closest('button, input, select, .watch-comment')) this.fullscreen(); });
    $('#watch-play').addEventListener('click', () => this.togglePlay());
    $('#watch-audio').addEventListener('click', () => { this.video.muted = !this.video.muted; if (!this.video.muted && !this.video.volume) { this.video.volume = .8; $('#watch-volume').value = '80'; } this.updateAudio(); });
    $('#watch-volume').addEventListener('input', event => { this.video.volume = Number(event.target.value) / 100; this.video.muted = this.video.volume === 0; });
    this.video.addEventListener('volumechange', () => this.updateAudio());
    $('#watch-toggle-danmaku').addEventListener('click', () => { this.danmakuEnabled = !this.danmakuEnabled; this.comments.setEnabled(this.danmakuEnabled); $('#watch-toggle-danmaku').textContent = '弹幕 ' + (this.danmakuEnabled ? '开' : '关'); $('#watch-toggle-danmaku').setAttribute('aria-pressed', String(this.danmakuEnabled)); });
    $('#watch-fullscreen').addEventListener('click', () => this.fullscreen());
    for (const id of ['#watch-studio', '#watch-retry']) $(id).addEventListener('click', onStudio);
    $('#watch-send-text').addEventListener('input', () => this.updateSend()); $('#watch-send-target').addEventListener('change', () => this.updateSend());
    $('#watch-send-form').addEventListener('submit', async event => { event.preventDefault(); const input = $('#watch-send-text'), text = input.value; if (await this.sendDanmaku(text, $('#watch-send-target').value)) { if (input.value === text) input.value = ''; this.updateSend(); } });
    document.addEventListener('fullscreenchange', () => { if (!this.active) return; const active = document.fullscreenElement === player; $('#watch-fullscreen').textContent = active ? '退出全屏' : '全屏'; $('#watch-fullscreen').setAttribute('aria-pressed', String(active)); this.fit(); this.showControls(); });
    document.addEventListener('keydown', event => {
      if (!this.active || event.target.closest('input, select, textarea, button, [contenteditable]') || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === 'Space') { event.preventDefault(); this.togglePlay(); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); this.fullscreen(); }
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); $('#watch-audio').click(); }
    });
  }
  enter() {
    if (this.active) return; this.active = true;
    // Moving existing decoder nodes preserves MediaSource and Web Audio
    // state, and keeps them inside the visible fullscreen document.
    for (const source of Object.values(this.read().sources)) {
      const video = source.video, home = document.createComment('source preview'); video.before(home); this.homes.push({ video, home }); this.$('#watch-decoders').append(video);
    }
    this.audio = this.getAudio(); this.video.srcObject = this.audio; this.surface.setPaused(false); this.surface.start();
    this.setState(this.getState()); this.fit(); this.comments.setPaused(false); this.updatePlay(); this.updateAudio(); this.showControls();
    this.video.play().catch(() => { if (this.active) this.notice('点击播放，开启直播声音'); });
    this.player.focus({ preventScroll: true });
  }
  leave() {
    if (!this.active) return; this.active = false; clearTimeout(this.hideTimer); this.comments.clear(); this.comments.setPaused(true);
    this.video.pause(); this.video.srcObject = null; this.audio?.getTracks().forEach(track => track.stop()); this.audio = null;
    for (const { video, home } of this.homes) { home.before(video); home.remove(); } this.homes = [];
    this.surface.stop();
  }
  close() { this.leave(); this.observer.disconnect(); }
  setState(next) {
    if (this.state.sources.length && next.sources?.some(source => this.state.sources.find(previous => previous.id === source.id)?.room !== source.room)) this.comments.clear();
    this.state = next; this.comments.configure(next.danmaku || {}); const select = this.$('#watch-send-target');
    for (const option of select.options) {
      const ids = option.value === 'both' ? ['A', 'B'] : [option.value]; option.disabled = !ids.every(id => next.sources?.some(source => source.id === id && source.available));
      const source = next.sources?.find(source => source.id === option.value); option.textContent = option.value === 'both' ? 'A + B' : '发送到 ' + option.value + (source?.room ? ' · ' + source.room : '');
    }
    if (select.selectedOptions[0]?.disabled) select.value = [...select.options].find(option => !option.disabled)?.value || 'A';
    const ready = Object.values(this.read().sources).some(source => source.video.readyState >= 2 && (source.player?.connected || source.stream?.getVideoTracks().some(track => track.readyState === 'live')));
    this.$('#watch-state').hidden = ready; if (this.active) this.surface.layout(); this.updateSend();
  }
  add(item) { if (this.active) this.comments.add(item); }
  clear() { this.comments.clear(); }
  fit() {
    if (!this.active) return; const picture = this.$('#watch-picture'), width = picture.clientWidth, height = picture.clientHeight;
    this.surface.resize(width, height);
  }
  showControls() {
    if (!this.active) return; this.player.classList.remove('quiet'); clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { if (this.$('#watch-state').hidden && !this.player.querySelector('.watch-chrome:focus-within, .watch-comment:hover, .watch-comment:focus-within, .watch-controls:hover, .watch-heading:hover')) this.player.classList.add('quiet'); }, 2500);
  }
  async fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await this.player.requestFullscreen(); } catch { this.notice('请在浏览器菜单中开启全屏', true); } this.showControls(); }
  async togglePlay() {
    this.surface.setPaused(!this.surface.paused); this.comments.setPaused(this.surface.paused);
    if (this.surface.paused) this.video.pause(); else { try { await this.video.play(); } catch { this.notice('点击开启声音，继续直播'); } }
    this.updatePlay(); this.showControls();
  }
  updatePlay() { const text = this.surface.paused ? '播放' : '暂停'; this.$('#watch-play').textContent = text; this.$('#watch-play').setAttribute('aria-label', text); }
  updateAudio() { const audible = !this.video.muted && this.video.volume > 0; this.$('#watch-audio').textContent = audible ? '静音' : '开启声音'; this.$('#watch-audio').setAttribute('aria-pressed', String(audible)); }
  notice(text, error = false) { this.$('#watch-notice').textContent = text; this.$('#watch-notice').classList.toggle('error', error); }
  updateSend() {
    const text = this.$('#watch-send-text').value.trim(), count = [...text].length; this.$('#watch-text-count').textContent = count + '/30'; this.$('#watch-text-count').classList.toggle('over-limit', count > 30);
    this.$('#watch-send').disabled = !this.active || this.$('#watch-send-target').selectedOptions[0]?.disabled || this.sending || count === 0 || count > 30; this.$('#watch-send').textContent = this.sending ? '发送中' : '发送';
  }
  async copyText(text) { try { await navigator.clipboard.writeText(text); this.notice('已复制弹幕'); } catch { this.$('#watch-send-text').value = text; this.$('#watch-send-text').focus(); this.$('#watch-send-text').select(); this.updateSend(); this.notice('弹幕已放入输入框，可编辑或复制'); } }
  async sendDanmaku(rawText, target) {
    const text = String(rawText || '').trim(); if (this.sending) { this.notice('正在发送，请稍候'); return false; }
    if (!text || [...text].length > 30) { this.notice('弹幕请输入 1–30 个字', true); return false; }
    const ids = target === 'both' ? ['A', 'B'] : [target]; if (!ids.every(id => this.state.sources?.some(source => source.id === id && source.available))) { this.notice('请返回工作台连接所选直播间', true); return false; }
    this.sending = true; this.updateSend();
    try { const result = await this.onSend(text, target); this.notice(result.message || (result.ok ? '弹幕已发送' : '弹幕发送失败'), !result.ok || Boolean(result.errors?.length)); return result.ok; }
    catch (error) { this.notice(error.message, true); return false; } finally { this.sending = false; this.updateSend(); }
  }
}
