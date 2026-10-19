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
   In production, keys are issued by the payment webhook (Stripe/Paddle)
   after checkout; the checkout-demo endpoint simulates that flow locally. */
const LICENSE_SECRET = process.env.LICENSE_SECRET || 'airstudio-dev-secret-change-me';
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
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
function validKey(k) {
  if (typeof k !== 'string') return false;
  const parts = k.trim().toUpperCase().split('-');
  if (parts.length !== 4 || parts[0] !== 'AIRS') return false;
  return keyChecksum(parts.slice(0, 3).join('-')) === parts[3];
}
const DEMO_KEY = makeKey();
const IS_PROD = process.env.NODE_ENV === 'production';

/* ------------------------------------------------- Stripe (optional)
   Enabled when STRIPE_SECRET_KEY is set. See docs/STRIPE_SETUP.md.
   Flow: Studio -> POST /api/checkout/stripe -> Stripe-hosted checkout ->
   webhook /api/webhook/stripe issues a license key -> Studio polls
   /api/license/by-session and activates automatically. */
const STRIPE_SK = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WHSEC = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY || '',
  yearly: process.env.STRIPE_PRICE_YEARLY || '',
  lifetime: process.env.STRIPE_PRICE_LIFETIME || '',
};
let stripe = null;
if (STRIPE_SK) {
  try { stripe = require('stripe')(STRIPE_SK); }
  catch { console.warn('stripe package missing — run: npm install stripe'); }
}
const ISSUED_FILE = path.join(__dirname, 'issued-licenses.json');
let issued = {};
try { issued = JSON.parse(fs.readFileSync(ISSUED_FILE, 'utf8')); } catch {}
function recordIssued(sessionId, rec) {
  issued[sessionId] = rec;
  fs.writeFile(ISSUED_FILE, JSON.stringify(issued, null, 2), () => {});
}

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

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
};

const server = http.createServer(async (req, res) => {
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

  // Public config (which checkout path the Studio should use)
  if (url.pathname === '/api/config/public') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stripeEnabled: !!stripe, demoEnabled: !IS_PROD }));
    return;
  }

  // Create a Stripe Checkout session (real payments)
  if (url.pathname === '/api/checkout/stripe' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', async () => {
      if (!stripe) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'stripe_not_configured' })); return; }
      let plan = 'yearly';
      try { plan = JSON.parse(body).plan || plan; } catch {}
      const price = STRIPE_PRICES[plan];
      if (!price) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'unknown_plan_or_missing_price' })); return; }
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const base = process.env.BASE_URL || `${proto}://${req.headers.host}`;
      try {
        const session = await stripe.checkout.sessions.create({
          mode: plan === 'lifetime' ? 'payment' : 'subscription',
          line_items: [{ price, quantity: 1 }],
          success_url: `${base}/studio?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${base}/studio?checkout=cancel`,
          metadata: { plan },
          allow_promotion_codes: true,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, url: session.url }));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'stripe_error', message: String(e.message || e).slice(0, 200) }));
      }
    });
    return;
  }

  // Stripe webhook — issues the license key after payment (raw body required for signature check)
  if (url.pathname === '/api/webhook/stripe' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      let event = null;
      if (stripe && STRIPE_WHSEC) {
        try { event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], STRIPE_WHSEC); }
        catch { res.writeHead(400); res.end('bad signature'); return; }
      } else {
        if (IS_PROD) { res.writeHead(400); res.end('webhook secret not configured'); return; }
        try { event = JSON.parse(raw.toString('utf8')); } catch { res.writeHead(400); res.end('bad json'); return; }
      }
      if (event.type === 'checkout.session.completed') {
        const s = event.data.object || {};
        const plan = (s.metadata && s.metadata.plan) || 'premium';
        const email = (s.customer_details && s.customer_details.email) || null;
        const key = makeKey();
        recordIssued(s.id, { key, plan, email, at: new Date().toISOString() });
        console.log(`[stripe] paid (${plan}) -> license ${key}${email ? ' for ' + email : ''}`);
        // Launch TODO: also email the key (Resend/SendGrid/SES). The Studio retrieves it via /api/license/by-session.
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
    return;
  }

  // Studio polls this after returning from Stripe Checkout
  if (url.pathname === '/api/license/by-session') {
    const rec = issued[url.searchParams.get('session') || ''];
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
  // Demo helpers (disabled in production): fetch a test key / simulate checkout
  if (url.pathname === '/api/license/demo' && !IS_PROD) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: DEMO_KEY }));
    return;
  }
  if (url.pathname === '/api/license/checkout-demo' && req.method === 'POST' && !IS_PROD) {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let plan = 'yearly';
      try { plan = JSON.parse(body).plan || plan; } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, key: makeKey(), plan, note: 'Demo checkout — in production this key is emailed after Stripe/Paddle payment.' }));
    });
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, peers: [...rooms.values()].reduce((n, r) => n + r.size, 0) }));
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
});

// ---------------------------------------------------------------- signaling
/** rooms: Map<code, Map<peerId, peer>>  peer = {id, role, name, caps, ws} */
const rooms = new Map();
let peerSeq = 1;

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

      // Cap cameras at 4 per room (multi-cam switcher limit)
      if (msg.role === 'camera' && [...room.values()].filter(p => p.role === 'camera').length >= 4) {
        send(ws, { type: 'error', message: 'This studio already has 4 cameras connected.' });
        return;
      }

      me = {
        id: 'p' + (peerSeq++).toString(36) + Date.now().toString(36).slice(-3),
        role: ['studio', 'camera', 'output'].includes(msg.role) ? msg.role : 'camera',
        name: String(msg.name || 'Device').slice(0, 40),
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
}, 20000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AirStudio server running on http://0.0.0.0:${PORT}`);
  if (!IS_PROD) console.log(`Demo Premium license key: ${DEMO_KEY}  (generate more: node tools/genkey.js)`);
});
