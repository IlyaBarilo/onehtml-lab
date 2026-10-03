// Prototype helpers are concatenated into one private closure by build.mjs.
function previewPolicy(networkAllowed) {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'${networkAllowed ? ' https:' : ''}`,
    `style-src 'unsafe-inline'${networkAllowed ? ' https:' : ''}`,
    `img-src data: blob:${networkAllowed ? ' https:' : ''}`,
    `media-src data: blob:${networkAllowed ? ' https:' : ''}`,
    `font-src data:${networkAllowed ? ' https:' : ''}`,
    `connect-src ${networkAllowed ? 'https: wss:' : "'none'"}`,
    "webrtc 'block'", "frame-src 'none'", "object-src 'none'",
    "base-uri 'none'", "form-action 'none'", "worker-src 'none'"
  ].join('; ');
}

// Resource Timing reports downloads, but cross-origin sizes can be hidden.
// The probe sends diagnostics only; it does not enforce a traffic quota.
const trafficProbe = `<script>
(() => {
  if (!window.PerformanceObserver) return;
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.name.startsWith('https://')) continue;
        parent.postMessage({ type: 'onehtml-lab:network-resource', bytes: entry.transferSize || 0 }, '*');
      }
    });
    observer.observe({ type: 'resource', buffered: true });
    addEventListener('pagehide', () => observer.disconnect(), { once: true });
  } catch {}
})();
</script>`;

const errorProbe = `<script>
(() => {
  const report = (kind, message, filename, line, column) => {
    try {
      parent.postMessage({
        type: 'onehtml-lab:runtime-error',
        kind,
        message: String(message || 'Неизвестная ошибка').slice(0, 500),
        filename: String(filename || '').slice(0, 160),
        line: Number.isInteger(line) && line > 0 ? line : 0,
        column: Number.isInteger(column) && column > 0 ? column : 0
      }, '*');
    } catch {}
  };
  addEventListener('error', event => {
    if (typeof event.message === 'string') report('error', event.message, event.filename, event.lineno, event.colno);
  });
  addEventListener('unhandledrejection', event => {
    let message = 'Необработанное отклонение Promise';
    try { message = event.reason?.message || String(event.reason); } catch {}
    report('rejection', message, '', 0, 0);
  });
})();
</script>`;

function virtualStorageProbe(entries) {
  // Escaping '<' prevents stored text from ending the injected script element.
  const initial = JSON.stringify(entries).replace(/</g, '\\u003c');
  return `<script>
(() => {
  const values = new Map(${initial});
  const limit = ${gameStorageLimit};
  const report = (action, key, value) => {
    try { parent.postMessage({ type: 'onehtml-lab:game-storage', action, key, value }, '*'); } catch {}
  };
  const methods = {
    getItem(key) { key = String(key); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      key = String(key); value = String(value);
      let size = key.length + value.length;
      for (const [name, text] of values) if (name !== key) size += name.length + text.length;
      if (size > limit) throw new DOMException('Хранилище игры заполнено', 'QuotaExceededError');
      values.set(key, value);
      report('set', key, value);
    },
    removeItem(key) { key = String(key); values.delete(key); report('remove', key); },
    clear() { values.clear(); report('clear'); },
    key(index) { return [...values.keys()][Number(index)] ?? null; }
  };
  const storage = new Proxy(Object.create(null), {
    get(_, name) {
      if (name === 'length') return values.size;
      if (name in methods) return methods[name];
      return typeof name === 'string' ? values.get(name) : undefined;
    },
    set(_, name, value) {
      if (typeof name === 'symbol') return false;
      methods.setItem(name, value);
      return true;
    },
    deleteProperty(_, name) { if (typeof name === 'string') methods.removeItem(name); return true; },
    has(_, name) { return name === 'length' || name in methods || values.has(name); },
    ownKeys() { return [...values.keys()]; },
    getOwnPropertyDescriptor(_, name) {
      return values.has(name) ? { configurable: true, enumerable: true, writable: true, value: values.get(name) } : undefined;
    }
  });
  try { Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get() { return storage; } }); }
  catch { report('unavailable'); }
})();
</script>`;
}

// Report reads of local browser APIs. When enabled, localStorage has already
// been replaced by the isolated virtual store; the other getters stay native.
const localAccessProbe = `<script>
(() => {
  const report = api => {
    try { parent.postMessage({ type: 'onehtml-lab:local-access', api }, '*'); } catch {}
  };
  const watch = (target, name, label) => {
    let owner = target, descriptor;
    while (owner && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(owner, name);
      owner = Object.getPrototypeOf(owner);
    }
    if (!descriptor || typeof descriptor.get !== 'function') return;
    const wrapped = {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() { report(label); return descriptor.get.call(target); }
    };
    if (typeof descriptor.set === 'function') {
      wrapped.set = value => { report(label); return descriptor.set.call(target, value); };
    }
    try { Object.defineProperty(target, name, wrapped); } catch {}
  };
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) watch(window, name, name);
  watch(document, 'cookie', 'document.cookie');
})();
</script>`;

function makePreview(code, networkAllowed = true, storageEntries = null) {
  const frame = document.createElement('iframe');
  frame.title = 'Запущенная игра';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'");
  // Policy is parsed before any user markup. The original source is never
  // assigned to the host DOM and remains unchanged in the editor and export.
  // The host's frame-src policy additionally restricts frame self-navigation.
  frame.srcdoc = '<!doctype html><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="' + previewPolicy(networkAllowed) + '">'
    + errorProbe
    + (storageEntries ? virtualStorageProbe(storageEntries) : '')
    + localAccessProbe
    + (networkAllowed ? trafficProbe : '')
    + code;
  return frame;
}
