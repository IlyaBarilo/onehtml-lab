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
        parent.postMessage({ type: 'onehtml-lab:network-resource', bytes: entry.transferSize || 0, url: entry.name.slice(0, 1000), kind: entry.initiatorType }, '*');
      }
    });
    observer.observe({ type: 'resource', buffered: true });
    addEventListener('pagehide', () => observer.disconnect(), { once: true });
  } catch {}
})();
</script>`;

const errorProbe = `<script>
(() => {
  let reports = 0, windowStart = Date.now();
  const report = (kind, message, filename, line, column) => {
    try {
      if (Date.now() - windowStart >= 1000) { reports = 0; windowStart = Date.now(); }
      if (++reports > 101) return;
      if (reports === 101) { kind = 'warning'; message = 'Слишком много сообщений: часть пропущена.'; filename = ''; line = column = 0; }
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
    else if (event.target && event.target !== window) {
      const url = event.target.currentSrc || event.target.src || event.target.href;
      if (url) report('resource', 'Не удалось загрузить ресурс: ' + String(url).slice(0, 300), url, 0, 0);
    }
  }, true);
  addEventListener('unhandledrejection', event => {
    let message = 'Необработанное отклонение Promise';
    try { message = event.reason?.message || String(event.reason); } catch {}
    report('rejection', message, '', 0, 0);
  });
  for (const [method, kind] of [['warn', 'warning'], ['error', 'console-error']]) {
    const original = console[method];
    console[method] = function(...args) {
      try {
        const message = args.slice(0, 8).map(value => {
          if (value instanceof Error) return value.message;
          if (value && typeof value === 'object') return Object.prototype.toString.call(value);
          return String(value).slice(0, 500);
        }).join(' ');
        report(kind, message, '', 0, 0);
      } catch {}
      return original.apply(this, args);
    };
  }
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

// The clock counts only intervals between consecutive foreground animation callbacks.
function createFrameClock() {
  let previous = null, active = false;
  let frames = 0, elapsed = 0, max = 0, slow = 0;
  return {
    active(value) { if (active !== value) previous = null; active = value; },
    reset() { previous = null; frames = elapsed = max = slow = 0; },
    frame(now) {
      if (!active || !Number.isFinite(now)) return;
      if (previous !== null && now > previous) {
        const interval = now - previous;
        frames++; elapsed += interval; max = Math.max(max, interval);
        if (interval > 100) slow++;
      }
      previous = now;
    },
    snapshot() { return { frames, elapsed, max, slow }; }
  };
}

function previewReadiness(createClock) {
  const clock = createClock();
  const send = data => { try { parent.postMessage(data, '*'); } catch {} };
  let enabled = false, paused = false, generation = -1, raf = 0, lastReport = 0;
  const report = () => { send({ type: 'onehtml-lab:speed', generation, ...clock.snapshot() }); lastReport = performance.now(); };
  const tick = now => {
    raf = 0;
    if (!enabled || paused || document.hidden) return;
    clock.frame(now);
    if (now - lastReport >= 1000) report();
    raf = requestAnimationFrame(tick);
  };
  const sync = () => {
    const active = enabled && !paused && !document.hidden;
    clock.active(active);
    if (active && !raf) raf = requestAnimationFrame(tick);
    if (!active && raf) { cancelAnimationFrame(raf); raf = 0; report(); }
  };
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || data?.type !== 'onehtml-lab:speed-control' || !Number.isSafeInteger(data.generation)) return;
    if (generation !== data.generation) { clock.reset(); generation = data.generation; lastReport = performance.now(); }
    enabled = data.enabled === true; paused = data.paused === true; sync();
  });
  document.addEventListener('visibilitychange', sync);
  addEventListener('pagehide', () => { enabled = false; sync(); }, { once: true });
  let reports = 0, since = Date.now();
  const resource = (url, status, kind) => {
    if (Date.now() - since >= 1000) { reports = 0; since = Date.now(); }
    if (++reports > 100 || typeof url !== 'string' || !url || /^(?:data:|blob:|about:|inline$|eval$)/i.test(url)) return;
    send({ type: 'onehtml-lab:resource-result', url: url.slice(0, 1000), status, kind });
  };
  addEventListener('securitypolicyviolation', event => resource(event.blockedURI, 'blocked', event.effectiveDirective));
  addEventListener('error', event => {
    if (event.target && event.target !== window) resource(event.target.currentSrc || event.target.src || event.target.href, 'error', event.target.localName);
  }, true);
  send({ type: 'onehtml-lab:readiness-ready' });
}

const readinessProbe = '<script>(' + previewReadiness.toString() + ')(' + createFrameClock.toString() + ');</script>';

function makePreview(code, networkAllowed = true, storageEntries = null) {
  const frame = document.createElement('iframe');
  frame.title = 'Запущенная игра';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'");
  // Policy is parsed before any user markup. The original source is never
  // assigned to the host DOM and remains unchanged in the editor and export.
  // The host's frame-src policy additionally restricts frame self-navigation.
  const prefix = '<!doctype html><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="' + previewPolicy(networkAllowed) + '">'
    + errorProbe
    + (storageEntries ? virtualStorageProbe(storageEntries) : '')
    + localAccessProbe
    + readinessProbe
    + (networkAllowed ? trafficProbe : '');
  frame.previewOffset = { lines: prefix.split('\n').length - 1, column: prefix.length - prefix.lastIndexOf('\n') - 1 };
  frame.srcdoc = prefix + code;
  return frame;
}
