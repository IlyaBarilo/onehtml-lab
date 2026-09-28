// Prototype helpers are concatenated into one private closure by build.mjs.
const previewPolicy = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
  'img-src data: blob:', 'media-src data: blob:', 'font-src data:',
  "connect-src 'none'", "webrtc 'block'", "frame-src 'none'", "object-src 'none'",
  "base-uri 'none'", "form-action 'none'", "worker-src 'none'"
].join('; ');

function makePreview(code) {
  const frame = document.createElement('iframe');
  frame.title = 'Запущенная игра';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'");
  // Policy is parsed before any user markup. The original source is never
  // assigned to the host DOM and remains unchanged in the editor and export.
  // The host's frame-src policy additionally restricts frame self-navigation.
  frame.srcdoc = '<!doctype html><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="' + previewPolicy + '">'
    + code;
  return frame;
}
