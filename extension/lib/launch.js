const openingByApi = new WeakMap();

async function open(api) {
  const url = api.runtime.getURL('studio.html');
  let tabs;
  try {
    tabs = await api.tabs.query({ url });
  } catch {
    tabs = [];
  }

  for (const tab of tabs) {
    if (!Number.isInteger(tab.id)) continue;
    try {
      const activated = await api.tabs.update(tab.id, { active: true });
      if (Number.isInteger(activated.windowId)) {
        // A focus failure must not prevent an already activated studio tab.
        await api.windows.update(activated.windowId, { focused: true }).catch(() => {});
      }
      return activated;
    } catch {
      // The tab may close between the query and activation.
    }
  }

  return api.tabs.create({ url, active: true });
}

export function openStudio(api = globalThis.chrome) {
  if (openingByApi.has(api)) return openingByApi.get(api);
  const pending = open(api).finally(() => openingByApi.delete(api));
  openingByApi.set(api, pending);
  return pending;
}
