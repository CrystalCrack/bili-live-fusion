import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeEmbed } from '../extension/lib/embed-startup.js';

const token = '12345678-1234-1234-1234-123456789abc';
const url = 'chrome-extension://fixture/embed.html#' + token;
function fixture() {
  const grants = { ['fusion-embed-' + token]: { tabId: 9, expires: Date.now() + 30000 } };
  const calls = [], tab = { id: 9, url: 'https://live.bilibili.com/84074' };
  const browser = {
    runtime: { id: 'fixture', sendMessage() { calls.push('worker'); return new Promise(() => {}); } },
    tabs: { async getCurrent() { calls.push('tab'); return tab; } },
    storage: { session: { async get(key) { calls.push('grant'); return { [key]: grants[key] }; }, async remove(key) { calls.push('consume'); delete grants[key]; } } }
  };
  return { grants, calls, tab, browser };
}

test('embedded startup authorizes directly even when background messaging never replies', async () => {
  const { browser, calls, grants } = fixture();
  assert.deepEqual(await authorizeEmbed(token, url, browser), { tabId: 9 });
  assert.equal(calls.includes('worker'), false); assert.equal(grants['fusion-embed-' + token], undefined);
  await assert.rejects(authorizeEmbed(token, url, browser), /授权已失效/);
});

test('direct startup rejects another tab, an expired grant and a non-live page', async () => {
  for (const change of [f => { f.tab.id = 10; }, f => { f.grants['fusion-embed-' + token].expires = Date.now() - 1; }, f => { f.tab.url = 'https://example.com/84074'; }]) {
    const f = fixture(); change(f);
    await assert.rejects(authorizeEmbed(token, url, f.browser), /授权已失效/);
    assert.equal(f.calls.includes('consume'), false);
  }
});

test('each browser-owned startup request has its own bounded failure', async () => {
  for (const stage of ['grant', 'tab', 'consume']) {
    const f = fixture();
    const pending = () => new Promise(() => {});
    if (stage === 'grant') f.browser.storage.session.get = pending;
    if (stage === 'tab') f.browser.tabs.getCurrent = pending;
    if (stage === 'consume') f.browser.storage.session.remove = pending;
    await assert.rejects(authorizeEmbed(token, url, f.browser, 5), { name: 'TimeoutError' });
  }
});

test('invalid startup nonce and wrong extension document never consume the grant', async () => {
  const f = fixture();
  await assert.rejects(authorizeEmbed('invalid', url, f.browser), /插件小窗/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(authorizeEmbed(token, 'https://live.bilibili.com/84074', f.browser), /授权已失效/);
  assert.equal(f.calls.includes('consume'), false);
});
