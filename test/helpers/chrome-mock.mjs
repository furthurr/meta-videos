/**
 * test/helpers/chrome-mock.mjs
 * Implementacion minima en memoria de las APIs de chrome.* usadas por la
 * extension, para tests unitarios del background fuera del navegador.
 */
export function makeChromeMock() {
  const localStore = {};
  const sessionStore = {};
  const downloads = [];
  const messageListeners = [];
  const sentToTabs = [];

  function makeArea(store) {
    return {
      get(keys, cb) {
        let out = {};
        if (keys == null) out = { ...store };
        else if (typeof keys === "string") out[keys] = store[keys];
        else if (Array.isArray(keys)) keys.forEach((k) => (out[k] = store[k]));
        else if (typeof keys === "object") Object.keys(keys).forEach((k) => (out[k] = k in store ? store[k] : keys[k]));
        cb && cb(out);
        return Promise.resolve(out);
      },
      set(obj, cb) {
        Object.assign(store, obj);
        cb && cb();
        return Promise.resolve();
      },
      remove(key, cb) {
        const keys = Array.isArray(key) ? key : [key];
        keys.forEach((k) => delete store[k]);
        cb && cb();
        return Promise.resolve();
      },
      clear(cb) {
        Object.keys(store).forEach((k) => delete store[k]);
        cb && cb();
        return Promise.resolve();
      },
    };
  }

  const chrome = {
    runtime: {
      lastError: null,
      id: "test-extension-id",
      sendMessage(msg, cb) {
        // entrega a los listeners registrados
        let responded = false;
        for (const fn of messageListeners) {
          fn(msg, { id: "test" }, (resp) => {
            if (!responded) { responded = true; cb && cb(resp); }
          });
        }
        if (!responded) cb && cb(undefined);
      },
      onMessage: {
        addListener(fn) { messageListeners.push(fn); },
        removeListener(fn) {
          const i = messageListeners.indexOf(fn);
          if (i >= 0) messageListeners.splice(i, 1);
        },
      },
      onClicked: { addListener() {} },
    },
    storage: {
      local: makeArea(localStore),
      session: makeArea(sessionStore),
      onChanged: { addListener() {} },
    },
    downloads: {
      download(opts, cb) {
        const id = downloads.length + 1;
        downloads.push(opts);
        cb && cb(id);
        return Promise.resolve(id);
      },
    },
    tabs: {
      query(q, cb) { cb && cb([]); },
      sendMessage(tabId, msg, cb) {
        sentToTabs.push({ tabId, msg });
        cb && cb(undefined);
      },
      create(opts, cb) { cb && cb({ id: 999, ...opts }); },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
    },
    scripting: {
      executeScript(opts, cb) { cb && cb([{ result: true }]); return Promise.resolve([{ result: true }]); },
    },
    windows: {
      getCurrent(cb) { cb && cb({ id: 1 }); },
    },
    sidePanel: {
      open() { return Promise.resolve(); },
      setOptions() { return Promise.resolve(); },
    },
    action: { onClicked: { addListener() {} } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
  };

  return { chrome, _state: { localStore, sessionStore, downloads, sentToTabs, messageListeners } };
}
