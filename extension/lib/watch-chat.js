// Accepted messages only. Hidden views retain bounded history without DOM work.
export class WatchChat {
  constructor(panel, { onCopy, onRepeat }) {
    this.panel = panel; this.feed = panel.querySelector('#watch-chat-feed');
    this.latest = panel.querySelector('#watch-chat-latest'); this.count = panel.querySelector('#watch-chat-count');
    this.onCopy = onCopy; this.onRepeat = onRepeat;
    this.history = []; this.pending = []; this.filter = 'both'; this.active = false;
    this.stick = true; this.unread = 0; this.needsRebuild = false; this.available = new Set();
    this.feed.addEventListener('scroll', () => {
      this.stick = this.feed.scrollHeight - this.feed.scrollTop - this.feed.clientHeight < 40;
      if (this.stick) this.unread = 0;
      this.updateLatest();
    }, { passive: true });
    this.latest.addEventListener('click', () => { this.stick = true; this.unread = 0; this.feed.scrollTop = this.feed.scrollHeight; this.updateLatest(); this.feed.focus({ preventScroll: true }); });
    panel.querySelectorAll('[data-chat-source]').forEach(button => button.addEventListener('click', () => {
      this.filter = button.dataset.chatSource; this.stick = true; this.unread = 0; this.needsRebuild = true;
      panel.querySelectorAll('[data-chat-source]').forEach(tab => { const active = tab.dataset.chatSource === this.filter; tab.classList.toggle('active', active); tab.setAttribute('aria-pressed', String(active)); });
      this.schedule();
    }));
  }
  setActive(active) {
    this.active = active;
    if (active) this.schedule();
    else { cancelAnimationFrame(this.frame); this.frame = null; this.pending = []; this.needsRebuild = true; }
  }
  setSources(sources) {
    this.available = new Set(sources.filter(source => source.available).map(source => source.id));
    for (const button of this.feed.querySelectorAll('[data-repeat-source]')) button.disabled = !this.available.has(button.dataset.repeatSource) || button.dataset.tooLong === 'true' || button.dataset.busy === 'true';
  }
  matches(item) { return this.filter === 'both' || item.source === this.filter; }
  add(raw) {
    if (!['A', 'B'].includes(raw?.source) || typeof raw.text !== 'string') return;
    const item = { source: raw.source, text: raw.text.slice(0, 300), user: String(raw.user || '观众').slice(0, 60), self: raw.self === true,
      timestamp: Number.isFinite(Number(raw.timestamp)) ? Number(raw.timestamp) : Date.now() };
    this.history.push(item); if (this.history.length > 150) this.history.shift();
    if (!this.active) { this.needsRebuild = true; return; }
    this.pending.push(item);
    if (this.pending.length > 150) { this.pending = []; this.needsRebuild = true; }
    this.schedule();
  }
  schedule() {
    if (!this.active || this.frame != null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.flush(); });
  }
  flush() {
    if (!this.active) return;
    const oldHeight = this.feed.scrollHeight, oldTop = this.feed.scrollTop;
    const items = this.needsRebuild ? this.history.filter(item => this.matches(item)) : this.pending.filter(item => this.matches(item));
    const rebuilding = this.needsRebuild; this.pending = []; this.needsRebuild = false;
    const fragment = document.createDocumentFragment(); items.forEach(item => fragment.append(this.createRow(item)));
    if (rebuilding) this.feed.replaceChildren(fragment);
    else if (items.length) { this.feed.querySelector('.watch-chat-empty')?.remove(); this.feed.append(fragment); }
    let removedHeight = 0;
    while (this.feed.children.length > 150) { removedHeight += this.feed.firstElementChild.getBoundingClientRect().height; this.feed.firstElementChild.remove(); }
    if (!this.feed.children.length) this.renderEmpty();
    const count = this.history.filter(item => this.matches(item)).length;
    this.count.textContent = String(count); this.count.title = '最近 ' + count + ' 条弹幕';
    if (this.stick) this.feed.scrollTop = this.feed.scrollHeight;
    else { this.feed.scrollTop = Math.max(0, oldTop - removedHeight); if (!rebuilding && this.feed.scrollHeight !== oldHeight) this.unread += items.length; }
    this.updateLatest();
  }
  createRow(item) {
    const row = document.createElement('article'); row.className = 'watch-chat-row source-' + item.source.toLowerCase() + (item.self ? ' self' : ''); row.tabIndex = 0;
    row.dataset.source = item.source; row.dataset.text = item.text;
    const meta = document.createElement('div'); meta.className = 'watch-chat-row-meta';
    const badge = document.createElement('span'); badge.className = 'source-badge ' + item.source.toLowerCase(); badge.textContent = item.source;
    const user = document.createElement('span'); user.className = 'watch-chat-user'; user.textContent = item.user; user.title = item.user;
    const time = document.createElement('time'); const date = new Date(item.timestamp);
    if (Number.isFinite(date.getTime())) { time.dateTime = date.toISOString(); time.textContent = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
    meta.append(badge, user);
    if (item.self) { const self = document.createElement('span'); self.className = 'watch-chat-self'; self.textContent = '我'; meta.append(self); }
    meta.append(time);
    const text = document.createElement('div'); text.className = 'watch-chat-text'; text.textContent = item.text;
    const actions = document.createElement('div'); actions.className = 'watch-chat-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制'; copy.setAttribute('aria-label', '复制这条弹幕');
    copy.addEventListener('click', () => this.onCopy(item.text));
    const repeat = document.createElement('button'); repeat.type = 'button'; repeat.textContent = '+1'; repeat.title = '发送到直播间 ' + item.source;
    repeat.setAttribute('aria-label', '+1 发送到直播间 ' + item.source); repeat.dataset.repeatSource = item.source;
    repeat.dataset.tooLong = String([...item.text.trim()].length > 30);
    repeat.disabled = repeat.dataset.tooLong === 'true' || !this.available.has(item.source);
    if (repeat.dataset.tooLong === 'true') repeat.title = '复制后编辑为 30 字以内';
    repeat.addEventListener('click', async () => {
      if (repeat.disabled) return; repeat.disabled = true; repeat.dataset.busy = 'true'; repeat.textContent = '发送中';
      try { await this.onRepeat(item.text, item.source); }
      finally { repeat.dataset.busy = 'false'; repeat.textContent = '+1'; repeat.disabled = !this.available.has(item.source) || repeat.dataset.tooLong === 'true'; }
    });
    actions.append(copy, repeat); row.append(meta, text, actions); return row;
  }
  renderEmpty() {
    const empty = document.createElement('div'); empty.className = 'watch-chat-empty';
    const title = document.createElement('strong'); title.textContent = '好弹幕，一起看';
    const note = document.createElement('span'); note.textContent = this.filter === 'both' ? '来自两个现场的消息会出现在这里' : '等待直播间 ' + this.filter + ' 的新消息';
    empty.append(title, note); this.feed.append(empty);
  }
  updateLatest() { this.latest.hidden = this.stick || !this.unread; this.latest.textContent = this.unread ? this.unread + ' 条新弹幕 ↓' : '回到最新弹幕 ↓'; }
  clear() {
    this.history = []; this.pending = []; this.needsRebuild = true; this.stick = true; this.unread = 0;
    this.count.textContent = '0'; this.updateLatest();
    if (this.active) this.schedule(); else this.feed.replaceChildren();
  }
  close() { cancelAnimationFrame(this.frame); this.frame = null; this.active = false; }
}
