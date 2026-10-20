/**
 * AirStudio signaling + static server
 * - Serves the web app (landing, studio, camera, clean output)
 * - WebSocket signaling: pairing-code rooms, multi-cam mesh, control relay
 * - QR code endpoint for zero-typing phone pairing
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

/* ------------------------------------------------------------- licensing
   Key format: AIRS-XXXX-XXXX-CCCC  where CCCC = HMAC checksum of the body.
   Generate real keys with:  node tools/genkey.js
   In production, keys are issued by the payment webhook (Paystack)
   after checkout; the checkout-demo endpoint simulates that flow locally. */
const LICENSE_SECRET = process.env.LICENSE_SECRET || 'airstudio-dev-secret-change-me';
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Operator-owned lifetime keys (e.g. AIRS-OWNER-XXXX-XXXX) — set via env so the
// owner's key validates on every deploy regardless of secret rotation.
const OWNER_KEYS_ENV = (process.env.OWNER_LICENSE_KEYS || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
// Built-in operator lifetime key — validates on every deploy even before env is set.
// Keep this secret; it bypasses HMAC by design for the product owner only.
const BUILT_IN_OWNER_KEYS = ['AIRS-OWNER-7Z8D-VHDJ', 'AIRS-YCQM-PWJR-8QGW'];
const OWNER_KEYS = new Set([...BUILT_IN_OWNER_KEYS, ...OWNER_KEYS_ENV]);
function keyChecksum(body) {
  const h = crypto.createHmac('sha256', LICENSE_SECRET).update(body).digest();
  let out = '';
  for (let i = 0; i < 4; i++) out += KEY_ALPHABET[h[i] % KEY_ALPHABET.length];
  return out;
}
function makeKey() {
  const grp = () => Array.from({ length: 4 }, () => KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)]).join('');
  const body = `AIRS-${grp()}-${grp()}`;
  return `${body}-${keyChecksum(body)}`;
}
const DEV_LICENSE_SECRET = 'airstudio-dev-secret-change-me';
function keyChecksumWithSecret(body, secret) {
  const h = crypto.createHmac('sha256', secret).update(body).digest();
  let out = '';
  for (let i = 0; i < 4; i++) out += KEY_ALPHABET[h[i] % KEY_ALPHABET.length];
  return out;
}
function validKey(k) {
  if (typeof k !== 'string') return false;
  const norm = k.trim().toUpperCase();
  // Owner lifetime keys bypass HMAC (built-in + OWNER_LICENSE_KEYS env)
  if (OWNER_KEYS.has(norm)) return true;
  const parts = norm.split('-');
  if (parts.length !== 4 || parts[0] !== 'AIRS') return false;
  const body = parts.slice(0, 3).join('-');
  // Accept keys signed with either the production LICENSE_SECRET or the dev fallback
  return keyChecksumWithSecret(body, LICENSE_SECRET) === parts[3]
    || keyChecksumWithSecret(body, DEV_LICENSE_SECRET) === parts[3];
}
const DEMO_KEY = makeKey();
const IS_PROD = process.env.NODE_ENV === 'production';

/* ------------------------------------------------- Paystack (optional)
   Enabled when PAYSTACK_SECRET_KEY is set. Works in Nigeria.
   Flow: Studio -> POST /api/checkout/paystack -> Paystack-hosted checkout ->
   webhook /api/webhook/paystack issues a license key -> Studio polls
   /api/license/by-reference and activates automatically. */
const PAYSTACK_SK = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PK = process.env.PAYSTACK_PUBLIC_KEY || '';
const PAYSTACK_PRICES = {
  monthly: process.env.PAYSTACK_PRICE_MONTHLY || '',   // amount in kobo (e.g. 49900 for ₦499)
  yearly: process.env.PAYSTACK_PRICE_YEARLY || '',       // amount in kobo (e.g. 299900 for ₦2,999)
  lifetime: process.env.PAYSTACK_PRICE_LIFETIME || '',   // amount in kobo (e.g. 599900 for ₦5,999)
};
const ISSUED_FILE = path.join(__dirname, 'issued-licenses.json');
let issued = {};
try { issued = JSON.parse(fs.readFileSync(ISSUED_FILE, 'utf8')); } catch {}
function recordIssued(sessionId, rec) {
  issued[sessionId] = rec;
  fs.writeFile(ISSUED_FILE, JSON.stringify(issued, null, 2), () => {});
}

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// Signaling room state — MUST live above handleRequest so serverless
// (Vercel catch-all) invocations can read /api/health without a TDZ error.
const rooms = new Map();
let peerSeq = 1;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

const ROUTES = {
  '/': 'index.html',
  '/studio': 'studio.html',
  '/camera': 'camera.html',
  '/output': 'output.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
};

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');

  // QR code for pairing links
  if (url.pathname === '/api/qr') {
    const text = url.searchParams.get('text') || '';
    try {
      const png = await QRCode.toBuffer(text, { width: 320, margin: 1, color: { dark: '#0b0f1a', light: '#ffffff' } });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(png);
    } catch (e) {
      res.writeHead(400); res.end('bad qr');
    }
    return;
  }

  // Public config (which checkout + signaling path the clients should use).
  // signalUrl: when set (e.g. Vercel static deploy pointing at the Render WS
  // server), clients open their WebSocket there instead of their own host.
  if (url.pathname === '/api/config/public') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      paystackEnabled: !!PAYSTACK_SK,
      demoEnabled: !IS_PROD,
      signalUrl: process.env.SIGNAL_URL || '',
      version: '0.1.0',
    }));
    return;
  }

  // Create a Paystack transaction (real payments)
  if (url.pathname === '/api/checkout/paystack' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', async () => {
      if (!PAYSTACK_SK) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'paystack_not_configured' })); return; }
      let plan = 'yearly';
      let email = '';
      try { const parsed = JSON.parse(body); plan = parsed.plan || plan; email = parsed.email || ''; } catch {}
      const amountKobo = PAYSTACK_PRICES[plan];
      if (!amountKobo) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'unknown_plan_or_missing_price' })); return; }
      if (!email) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'email_required' })); return; }
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const base = process.env.BASE_URL || `${proto}://${req.headers.host}`;
      const reference = `AIRS-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        const resp = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${PAYSTACK_SK}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            amount: parseInt(amountKobo, 10),
            reference,
            metadata: { plan, product: 'AirStudio Premium' },
            callback_url: `${base}/studio?checkout=success&reference=${reference}`,
          }),
        });
        const data = await resp.json();
        if (!data.status) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'paystack_error', message: data.message || 'initialize failed' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, url: data.data.authorization_url, reference }));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'paystack_error', message: String(e.message || e).slice(0, 200) }));
      }
    });
    return;
  }

  // Paystack webhook — issues the license key after payment
  if (url.pathname === '/api/webhook/paystack' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      let event = null;
      try { event = JSON.parse(raw.toString('utf8')); } catch { res.writeHead(400); res.end('bad json'); return; }
      const eventType = event.event || event.type || '';
      const data = event.data || {};
      if (eventType === 'charge.success') {
        const reference = data.reference || data.id || '';
        const plan = (data.metadata && data.metadata.plan) || 'premium';
        const email = data.customer && data.customer.email ? data.customer.email : (data.email || null);
        const key = makeKey();
        recordIssued(reference, { key, plan, email, at: new Date().toISOString() });
        console.log(`[paystack] paid (${plan}) -> license ${key}${email ? ' for ' + email : ''} ref=${reference}`);
        // The Studio retrieves it via /api/license/by-reference?reference=...
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
    return;
  }

  // Studio polls this after returning from Paystack Checkout
  if (url.pathname === '/api/license/by-reference') {
    const rec = issued[url.searchParams.get('reference') || ''];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rec ? { ok: true, key: rec.key, plan: rec.plan } : { ok: false }));
    return;
  }

  // License activation / verification
  if (url.pathname === '/api/license/activate' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let key = '';
      try { key = JSON.parse(body).key || ''; } catch {}
      const ok = validKey(key);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok, plan: ok ? 'premium' : 'free', message: ok ? 'Premium activated. Welcome to the full studio! ⭐' : 'That license key is not valid.' }));
    });
    return;
  }
  // Demo helpers: fetch a test key / simulate checkout (LOCAL DEV ONLY — disabled in production)
  if (url.pathname === '/api/license/demo' && !IS_PROD) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: DEMO_KEY }));
    return;
  }
  if (url.pathname === '/api/license/checkout-demo' && req.method === 'POST') {
    if (IS_PROD) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'demo_disabled', message: 'Demo checkout is disabled in production. Please complete Paystack checkout to receive a license key.' }));
      return;
    }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let plan = 'yearly';
      try { plan = JSON.parse(body).plan || plan; } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, key: makeKey(), plan, note: 'Demo checkout — in production this key is emailed after Paystack payment.' }));
    });
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, peers: [...rooms.values()].reduce((n, r) => n + r.size, 0), standalone: server.listening }));
    return;
  }

  const file = ROUTES[url.pathname] || url.pathname.replace(/^\//, '');
  const filePath = path.join(PUBLIC, path.normalize(file));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(handleRequest);
module.exports = handleRequest;

// ---------------------------------------------------------------- signaling
/** rooms: Map<code, Map<peerId, peer>>  peer = {id, role, name, caps, ws} */

// Attach the WebSocket signaling server UNCONDITIONALLY — Render boots via
// index.js (which requires this module), so gating on `require.main` left
// production serving HTTP but failing every WS upgrade
// ("Signaling server unreachable", diag sig-*).
const wss = new WebSocketServer({ server });

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function peerInfo(p) { return { id: p.id, role: p.role, name: p.name, caps: p.caps || null }; }

wss.on('connection', (ws) => {
  let me = null; // peer record after join

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      const code = String(msg.room || '').toUpperCase().trim();
      if (!code) { send(ws, { type: 'error', message: 'Missing room code' }); return; }
      if (!rooms.has(code)) rooms.set(code, new Map());
      const room = rooms.get(code);

      // Allow multiple cameras (Iriun-style: each camera is a separate source)
      let camIp = '';
      try {
        const addr = ws._socket?.remoteAddress || ws.remoteAddress || '';
        camIp = addr.replace('::ffff:', '');
      } catch {}
      if (msg.role === 'camera') {
        const camCount = [...room.values()].filter(p => p.role === 'camera').length;
        // Auto-assign Camera N name if no custom name or default name
        if (!msg.name || msg.name === 'Device' || msg.name === 'Phone Camera') {
          msg.name = camIp ? `Camera ${camCount + 1} (${camIp})` : `Camera ${camCount + 1}`;
        } else if (/^camera\s*\d*$/i.test(msg.name) || msg.name.trim() === '') {
          msg.name = camIp ? `Camera ${camCount + 1} (${camIp})` : `Camera ${camCount + 1}`;
        }
      }

      me = {
        id: 'p' + (peerSeq++).toString(36) + Date.now().toString(36).slice(-3),
        role: ['studio', 'camera', 'output'].includes(msg.role) ? msg.role : 'camera',
        name: String(msg.name || `Camera ${[...room.values()].filter(p => p.role === 'camera').length + 1}`).slice(0, 80),
        caps: msg.caps || null,
        room: code,
        ws,
      };
      room.set(me.id, me);
      console.log(`[+] ${me.role} "${me.name}" joined room ${code} (${me.id})`);

      send(ws, { type: 'welcome', id: me.id, room: code, peers: [...room.values()].filter(p => p.id !== me.id).map(peerInfo) });
      for (const p of room.values()) if (p.id !== me.id) send(p.ws, { type: 'peer-joined', peer: peerInfo(me) });
      return;
    }

    if (!me) return;
    const room = rooms.get(me.room);
    if (!room) return;

    // Direct relay (SDP / ICE / control / state)
    if (msg.type === 'relay' && msg.to) {
      const target = room.get(msg.to);
      if (target) send(target.ws, { type: 'relay', from: me.id, kind: msg.kind, data: msg.data });
      return;
    }
    // Relay to every peer with a role (e.g. teleprompter -> all cameras, program switch -> outputs)
    if (msg.type === 'relay-role' && msg.role) {
      for (const p of room.values()) if (p.role === msg.role && p.id !== me.id)
        send(p.ws, { type: 'relay', from: me.id, kind: msg.kind, data: msg.data });
      return;
    }
    // Update own advertised capabilities (lens list etc.) and rebroadcast
    if (msg.type === 'caps') {
      me.caps = msg.caps;
      for (const p of room.values()) if (p.id !== me.id) send(p.ws, { type: 'peer-updated', peer: peerInfo(me) });
      return;
    }
  });

  ws.on('close', () => {
    if (!me) return;
    const room = rooms.get(me.room);
    if (room) {
      room.delete(me.id);
      for (const p of room.values()) send(p.ws, { type: 'peer-left', id: me.id });
      if (room.size === 0) rooms.delete(me.room);
    }
    console.log(`[-] ${me.role} "${me.name}" left room ${me.room}`);
  });
});

// Heartbeat: drop dead sockets
setInterval(() => {
  for (const room of rooms.values())
    for (const p of room.values()) {
      if (p.ws.readyState !== p.ws.OPEN) continue;
      if (p.ws._dead) { try { p.ws.terminate(); } catch {} continue; }
      p.ws._dead = true;
      p.ws.ping();
      p.ws.once('pong', () => { p.ws._dead = false; });
    }
}, 20000).unref();

// Standalone entry (`node server.js`): listen here. When Render boots via
// index.js, listen() is called by that shim on the SAME exported server —
// so WebSockets are attached either way.
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AirStudio server running on http://0.0.0.0:${PORT}`);
    if (!IS_PROD) console.log(`Demo Premium license key: ${DEMO_KEY}  (generate more: node tools/genkey.js)`);
  });
}

// Export the HTTP server WITH the WebSocket signaling server attached so
// entry-point shims (index.js on Render) never lose WebSockets.
module.exports = handleRequest;
module.exports.server = server;
