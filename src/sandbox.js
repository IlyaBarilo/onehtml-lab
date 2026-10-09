// Prototype helpers are concatenated into one private closure by build.mjs.
function previewPolicy(networkAllowed) {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'${networkAllowed ? ' https:' : ''} data:`,
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

// Shared bounded description for visual selection and quality observations.
function previewElementDescription(element) {
  const text = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
    const tag = element.localName.toLowerCase(), path = [];
    let node = element;
    while (node && path.length < 12) {
      let index = 1, sibling = node.previousElementSibling;
      while (sibling) { if (sibling.localName === node.localName) index++; sibling = sibling.previousElementSibling; }
      path.unshift(node.localName + ':nth-of-type(' + index + ')'); node = node.parentElement;
    }
    // Do not read form values, passwords, scripts or embedded resource bytes.
    const parts = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) { return node.parentElement?.closest('script,style,textarea,input,select,[contenteditable]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    let length = 0, count = 0;
    while (length < 240 && count++ < 1000 && walker.nextNode()) {
      const part = text(walker.currentNode.textContent, 240 - length); parts.push(part); length += part.length;
    }
    const resource = element.getAttribute('src') || '';
    return { tag, id: text(element.id, 100), classes: text(element.getAttribute('class'), 160),
      label: text(element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title'), 160),
      text: text(parts.join(' '), 240), path: path.join(' > ').slice(-700),
      resource: /^(?:data:|blob:)/i.test(resource) ? '' : text(resource, 240), viewport: [innerWidth, innerHeight] };
}

// Runs before application listeners, in the opaque-origin frame only.
function previewElementPicker(token, describe) {
  let enabled = false, generation = 0, selected = null, overlay = null, border = null, raf = 0, press = null;
  const send = (type, element) => parent.postMessage({ type: 'onehtml-lab:' + type, token, generation, element }, '*');
  const draw = () => {
    raf = 0;
    if (!enabled) return;
    if (selected && !selected.isConnected) { selected = null; send('picked', null); }
    if (selected) {
      const rect = selected.getBoundingClientRect();
      border.style.cssText = 'position:fixed;box-sizing:border-box;pointer-events:none;border:3px solid #4285ff;box-shadow:0 0 0 2px #fff;border-radius:3px;'
        + 'left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;';
    } else border.style.display = 'none';
    raf = requestAnimationFrame(draw);
  };
  const disable = () => {
    enabled = false; selected = null; press = null;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    overlay?.remove(); overlay = border = null;
  };
  const pick = target => {
    if (!(target instanceof Element)) return;
    const element = target.closest('button,a,input,select,textarea,[role="button"],svg') || target;
    if (['html', 'head', 'script', 'style'].includes(element.localName) || element === overlay) return;
    selected = element; send('picked', describe(element));
  };
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || data?.type !== 'onehtml-lab:pick-control' || data.token !== token || !Number.isSafeInteger(data.generation)) return;
    disable(); generation = data.generation;
    if (data.enabled !== true) return;
    enabled = true;
    overlay = document.createElement('div');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;';
    border = document.createElement('div');
    overlay.attachShadow({ mode: 'closed' }).append(border);
    document.documentElement.append(overlay); draw(); send('pick-armed');
  });
  const intercept = event => {
    if (!enabled) return;
    // Keep native scrolling and focus navigation, but block application handlers.
    event.stopImmediatePropagation();
    if (event.type === 'pointerdown') {
      press = event.isPrimary && event.button === 0 ? { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target } : null;
      if (event.target.closest?.('input,select,textarea,[contenteditable]')) event.preventDefault();
    } else if (event.type === 'pointermove' && press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) press = null;
    else if (event.type === 'pointercancel' || event.type === 'wheel') press = null;
    else if (event.type === 'pointerup') {
      if (press && press.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 10 && press.target.isConnected) pick(press.target);
      press = null;
    } else if (event.type === 'click') {
      event.preventDefault();
      // Pointer gestures are decided on pointerup. WebKit can still emit click after a drag.
      if (!window.PointerEvent || event.detail === 0) pick(event.target);
    }
    else if (event.type === 'keydown') {
      if (event.key === 'Escape') { event.preventDefault(); send('pick-cancel'); disable(); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(event.target); }
    } else if (['dblclick', 'contextmenu', 'submit', 'dragstart', 'beforeinput', 'mousedown', 'mouseup'].includes(event.type)) event.preventDefault();
  };
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'touchstart', 'touchend', 'touchmove', 'touchcancel',
    'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'keypress', 'beforeinput', 'submit', 'dragstart', 'wheel']) {
    addEventListener(type, intercept, { capture: true, passive: false });
  }
  addEventListener('pagehide', disable, { once: true });
  send('pick-ready');
}

function makePreview(code, networkAllowed = true, storageEntries = null) {
  const frame = document.createElement('iframe');
  frame.pickerToken = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(36)).join('-');
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
    + '<script>(()=>{const describe=' + previewElementDescription.toString() + ';('
    + previewQuality.toString() + ')(' + JSON.stringify(frame.pickerToken) + ',describe);('
    + previewElementPicker.toString() + ')(' + JSON.stringify(frame.pickerToken) + ',describe);})();</script>'
    + (networkAllowed ? trafficProbe : '');
  frame.previewOffset = { lines: prefix.split('\n').length - 1, column: prefix.length - prefix.lastIndexOf('\n') - 1 };
  frame.srcdoc = prefix + code;
  return frame;
}
