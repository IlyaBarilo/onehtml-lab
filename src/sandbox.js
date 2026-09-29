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

function makePreview(code, networkAllowed = true) {
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
    + (networkAllowed ? trafficProbe : '')
    + code;
  return frame;
}
