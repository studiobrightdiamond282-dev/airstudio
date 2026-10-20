// Temporary test: WS signaling through the given entry point.
// Usage: node test-ws.js <port>
const WebSocket = require('ws');
const port = process.argv[2] || '3100';
const url = `ws://localhost:${port}`;
const results = [];

function step(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const ws = new WebSocket(url);
const timeout = setTimeout(() => {
  step('WS connect', false, 'timeout after 5s');
  finish();
}, 5000);

ws.on('open', () => {
  clearTimeout(timeout);
  step('WS connect', true, url);
  ws.send(JSON.stringify({ type: 'join', room: 'TST1', role: 'studio', name: 'Tester' }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'welcome') {
    step('join → welcome', true, `id=${msg.id} room=${msg.room}`);
    // Simulate a camera joining the same room
    const cam = new WebSocket(url);
    cam.on('open', () => cam.send(JSON.stringify({ type: 'join', room: 'TST1', role: 'camera', name: 'Cam' })));
    cam.on('message', (raw2) => {
      const m2 = JSON.parse(raw2.toString());
      if (m2.type === 'welcome') {
        step('camera join → welcome', true, `peers=${m2.peers.length}`);
        // studio should be notified
      }
      if (m2.type === 'relay') {
        step('relay delivery', true, `kind=${m2.kind}`);
        cam.close();
        ws.close();
        finish();
      }
    });
    cam.on('error', (e) => { step('camera join', false, e.message); finish(); });
    // once camera is in, studio sends a relay to it (we poll welcome peers)
    const iv = setInterval(() => {
      // send relay targeting camera peer id — get it from our peer-joined event
    }, 100);
    setTimeout(() => clearInterval(iv), 100);
  }
  if (msg.type === 'peer-joined') {
    step('peer-joined broadcast', true, `role=${msg.peer.role}`);
    ws.send(JSON.stringify({ type: 'relay', to: msg.peer.id, kind: 'ping', data: { t: Date.now() } }));
  }
});

ws.on('error', (e) => {
  clearTimeout(timeout);
  step('WS connect', false, e.message);
  finish();
});

function finish() {
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
