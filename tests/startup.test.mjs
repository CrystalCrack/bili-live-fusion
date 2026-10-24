import test from 'node:test';
import assert from 'node:assert/strict';
import { openStudio } from '../extension/lib/launch.js';

function mockApi(overrides = {}) {
  const calls = [];
  const api = {
    runtime: { getURL: file => `chrome-extension://test/${file}` },
    tabs: {
      async query(options) { calls.push(['query', options]); return []; },
      async create(options) { calls.push(['create', options]); return { id: 10, windowId: 1, ...options }; },
      async update(id, options) { calls.push(['activate', id, options]); return { id, windowId: 1, ...options }; }
    },
    windows: { async update(id, options) { calls.push(['focus', id, options]); return { id }; } }
  };
  Object.assign(api.tabs, overrides);
  return { api, calls };
}

test('first launch opens an active studio tab', async () => {
  const { api, calls } = mockApi();
  const tab = await openStudio(api);
  assert.equal(tab.url, 'chrome-extension://test/studio.html');
  assert.deepEqual(calls.map(call => call[0]), ['query', 'create']);
  assert.equal(calls[1][1].active, true);
});

test('repeat launch activates the existing studio instead of creating another', async () => {
  const { api, calls } = mockApi({ query: async () => [{ id: 20, windowId: 1 }] });
  assert.equal((await openStudio(api)).id, 20);
  assert.deepEqual(calls.map(call => call[0]), ['activate', 'focus']);
});

test('a closed studio tab is recreated', async () => {
  const { api, calls } = mockApi({ query: async () => [{ id: 20 }], update: async () => { throw new Error('Tab closed'); } });
  assert.equal((await openStudio(api)).id, 10);
  assert.deepEqual(calls.map(call => call[0]), ['create']);
});

test('a failed tab lookup still allows the studio to open', async () => {
  const { api, calls } = mockApi({ query: async () => { throw new Error('Lookup failed'); } });
  assert.equal((await openStudio(api)).id, 10);
  assert.equal(calls[0][0], 'create');
});

test('a window focus error does not duplicate a successfully activated studio', async () => {
  const { api, calls } = mockApi({ query: async () => [{ id: 20 }] });
  api.windows.update = async () => { throw new Error('Window unavailable'); };
  assert.equal((await openStudio(api)).id, 20);
  assert.equal(calls.some(call => call[0] === 'create'), false);
});

test('concurrent launches create one studio and the lock clears after completion', async () => {
  const { api, calls } = mockApi();
  const [a, b] = await Promise.all([openStudio(api), openStudio(api)]);
  assert.equal(a.id, b.id);
  assert.equal(calls.filter(call => call[0] === 'create').length, 1);
  await openStudio(api);
  assert.equal(calls.filter(call => call[0] === 'create').length, 2);
});

test('a launch error is reported and a subsequent retry is permitted', async () => {
  const { api } = mockApi();
  api.tabs.create = async () => { throw new Error('Create failed'); };
  await assert.rejects(openStudio(api), /Create failed/);
  api.tabs.create = async () => ({ id: 30 });
  assert.equal((await openStudio(api)).id, 30);
});
