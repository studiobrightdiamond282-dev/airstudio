/* AirStudio connection helper — every client (studio, camera, output) uses this
   so all three always talk to the same signaling server.
   - Same-host default (local dev + Render full-stack).
   - When the page was served from a host with no WebSocket support (e.g. a
     static Vercel deploy), SIGNAL_URL (injected via /api/config/public) points
     the socket at the real signaling server (Render).
   Usage: const ws = openSignalSocket('/api/config/public', onOpen, onMessage, onClose);
   Returns the WebSocket immediately (same-host fast path) and upgrades to the
   configured SIGNAL_URL host once the config fetch resolves (if different). */
function openSignalSocket(configPath, onOpen, onMessage, onClose) {
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws = new WebSocket(`${wsProto}://${location.host}`);
  let upgraded = false;
  wire(ws);
  function wire(socket) {
    ws = socket;
    socket.onopen = e => !upgraded && onOpen(socket, e);
    socket.onmessage = e => !upgraded && onMessage(socket, e);
    socket.onclose = e => !upgraded && onClose(socket, e);
    socket.onerror = () => { try { socket.close(); } catch {} };
  }
  fetch(configPath || '/api/config/public').then(r => r.json()).then(cfg => {
    const target = String(cfg && cfg.signalUrl || '').trim();
    if (!target) return;
    const want = `${wsProto}://${target}`;
    const current = `${wsProto}://${location.host}`;
    if (want === current) return;
    upgraded = true;
    try { ws.close(); } catch {}
    const s2 = new WebSocket(want);
    s2.onopen = e => onOpen(s2, e);
    s2.onmessage = e => onMessage(s2, e);
    s2.onclose = e => onClose(s2, e);
    s2.onerror = () => { try { s2.close(); } catch {} };
    ws = s2;
  }).catch(() => {});
  return ws;
}
function signalTargetHint() {
  return fetch('/api/config/public').then(r => r.json()).then(cfg => cfg.signalUrl || location.host).catch(() => location.host);
}