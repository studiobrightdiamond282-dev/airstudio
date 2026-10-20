# AirStudio — Handover Notes

## Project Overview
AirStudio — Phone-as-4K-Studio-Webcam software. Node.js + WebRTC server with web front-ends:
- `/` — Landing page
- `/studio` — Desktop control room (switcher, remote controls, recording, teleprompter)
- `/camera` — Phone client (multi-lens capture, AI FX, remote control endpoint)
- `/output?code=X` — Borderless program feed for OBS

---

## Completed Tasks

### 1. Render Deploy Fix (MODULE_NOT_FOUND: index.js)
**Problem:** Render was running `node index.js` but `index.js` didn't exist; entry point is `server.js`.
**Fix:**
- Created `/airstudio/index.js` — entry-point shim that listens on `process.env.PORT` using the server exported by `server.js`
- Refactored `/airstudio/server.js` to export `handleRequest` (for Vercel) **and** `module.exports.server` (the HTTP server with WebSocket signaling attached); `server.listen()` runs standalone when `server.js` is the main module, otherwise the shim listens
- Fixed `package.json` `"main"` from `index.js` → `server.js`
- Fixed `vercel.json` route ordering (API routes before static catch-all)
- **Status:** Deployed to Render at `https://airstudio.onrender.com`; auto-deploy ON COMMIT enabled

### 1b. Render Signaling Fix — "Signaling server unreachable" (diag sig-*)
**Problem:** Studio showed `⚠ Signaling server unreachable … check that the signaling server supports WebSockets` on Render (diag `sig-5sahu9`), while HTTP/pages worked fine.
**Root cause:** The whole `WebSocketServer` block in `server.js` was gated behind `if (require.main === module)`. Render boots via `node index.js`, which **requires** `server.js` → the condition was false → **no `WebSocketServer` was ever attached**, and `index.js` created its own bare `http.createServer(handleRequest)` (HTTP only, no upgrade handler). Every `wss://airstudio.onrender.com` upgrade was dropped.
**Fix:**
- `server.js`: `new WebSocketServer({ server })` + join/relay/heartbeat logic now attach **unconditionally** to the module-level server; heartbeat uses `.unref()` (safe under serverless); `/api/health` reports `standalone: server.listening`
- `index.js`: listens on `handleRequest.server` (the WS-attached server) instead of creating a new server
- Verified locally: `node index.js` (Render path) and `node server.js` (standalone path) both pass a 5-step WS test (`test-ws.js`: connect → join/welcome → camera join → peer-joined → relay delivery); `require('./server.js')` without listening (Vercel path) returns a function handler + non-listening server

### 1c. Camera UX Fixes — Landscape View + Lens/Front-Camera Swap
**Problem A:** "Landscape view is not activated" — the codebase contained **zero** orientation/fullscreen code (no `requestFullscreen`, no `screen.orientation.lock`), so the phone never rotated to landscape even with auto-rotate off.
**Fix A (`camera.html`):**
- New ⛶ botbar button + `enterLandscape()/exitLandscape()/syncLandscape()`; auto-invoked on **Start Camera** (while the click is still a user gesture)
- Android Chrome: `documentElement.requestFullscreen()` + `screen.orientation.lock('landscape')` → true native landscape; the orientation lock is demoted if fullscreen exits (`fullscreenchange` re-syncs)
- iOS Safari / no-lock-API fallback: `body.force-landscape #camScreen` CSS rule rotates the whole camera UI 90° (`rotate(90deg)` sized `100dvh × 100dvw` at `left:100dvw`) — only applied while actually portrait; removed on orientation change or ⛶ toggle; landscape layout works even with device auto-rotate OFF
- `.botbar` now `flex-wrap` (8 buttons fit small phones); disconnect runs `exitLandscape()` before reload

**Problem B:** "Front camera is not swapping" — three compounding bugs:
1. `startCapture()` **stopped the old video track before** `refreshOutbound()` ran `replaceTrack()`, and the sender lookup (`s.track && kind==='video'`) fails when `sender.track` is already `null` after `stop()` → the Studio view never switched (only the phone's local preview did)
2. Studio sent a raw `deviceId` with no label; a stale ID → `OverconstrainedError` silently swallowed by `onControl`'s `console.warn`
3. Flip/front-back switching relied solely on `facingMode`, which iOS Safari ignores, and `state.facing` was read from `getSettings().facingMode` (often undefined there) — flip errors were also unhandled

**Fix B:**
- `camera.html`: stores `pc._vSender` per peer + `videoSenderOf()` helper (tolerates `track === null`); `startCapture()` now does **replaceTrack → then stop old track** (renegotiates via offer if a peer has no video sender yet)
- `pickDeviceByHint()`: resolves `'user'/'environment'` or a lens label (`Front`, `Back · Ultra-Wide…`) to an exact `deviceId` by label match → works where `facingMode` is unsupported; `resolveVideoOpts()` prefers label-resolved IDs over `facingMode`
- Stale-ID retry: exact-`deviceId` failure re-resolves by label hint, then falls back without the constraint — never a silent no-op
- `state.facing` resolved from `getSettings().facingMode` → device label → requested hint → previous value (correct mirroring on iOS)
- Lens switch now toasts `Switching lens…` → `Lens switched ✓` / `⚠️ Lens switch failed (name)`; flip button catches errors with a toast
- `studio.html`: lens buttons send `label` (raw/friendly, HTML-escaped) alongside `deviceId` so the phone can re-resolve stale IDs by name; verified: `node index.js` boots, `/api/health` ok, `/camera` 200, all inline `<script>` blocks pass syntax check
- **Status:** Committed for Render auto-deploy; needs on-device verification (rotate phone → landscape engages; Studio lens/flip buttons switch front camera and program view follows)

### 2. Vercel Serverless Deployment
**Problem:** Vercel requires serverless handler export, not `server.listen()`.
**Fix:**
- Refactored `server.js` to export `handleRequest` (Vercel-compatible)
- Created `/airstudio/api/[[...path]].js` — Vercel catch-all serverless function for `/api/*` routes
- Simplified `vercel.json` to file-based routing
- **Status (2026-10-20):** Redeployed to Vercel via CLI (`vercel --prod`, team velora-7d47, project `airstudio`). Live at **https://airstudiocam.vercel.app** (deployment `airstudio-1zlhobles-velora-7d47.vercel.app`); `/api/health` returns `{"ok":true,"standalone":false}` ✅ (serverless — signaling/WebRTC relay requires Render; Vercel hosts static pages + HTTP API only). NOTE: the old `airstudio-one.vercel.app` subdomain is now owned by a different Vercel account (serves a login page) — do not use it; QR/links must point to `airstudio.onrender.com` or `airstudiocam.vercel.app`

### 3. Lifetime License Key Generated
**Key:** `AIRS-YCQM-PWJR-8QGW`
- Generated via `node tools/genkey.js 1` using the server's `LICENSE_SECRET`
- Activate in Studio: FREE PLAN → Upgrade → "Use demo key" → paste this key
- Premium features unlocked: 4K 60fps, up to 4 phones, AI suite, pro manual controls, teleprompter, recording, no watermark

---

## In Progress / Pending Tasks

### 4. Studio Disconnect/Kick Button ✅ COMPLETED
**Added:** "✕ Disconnect" button on each camera card in Studio control room.
**Changes:**
- `studio.html`: Added `<button class="btn small kick">✕</button>` to each camcard meta section
- `studio.html`: Event listener calls `removeCam(peer.id)` which closes the WebRTC peer connection and removes the camera card
- `style.css`: Added `.btn.kick` styling (red/danger theme)
- **Effect:** Studio operator can now disconnect any specific phone camera from the livestream

### 5. Phone-Side Zoom Controls + Pinch-to-Zoom ✅ COMPLETED
**Added:** Local zoom controls on phone camera client + pinch-to-zoom gesture.
**Changes:**
- `camera.html`: Added 🔍− (zoom out) and 🔍+ (zoom in) buttons to botbar
- `camera.html`: `applyZoom()` applies CSS `scale()` transform on `#previewWrap` (1× to 4× range)
- `camera.html`: Pinch-to-zoom gesture detection via touchstart/touchmove/touchend events
- `camera.html`: Zoom level stored in `state.fx.ptz.scale` and synced via `sendState()`
- **Effect:** Phone user can zoom with buttons or two-finger pinch gesture during livestreaming

### 6. vMix Output Fix — Cameras Already in Room Not Displaying (FIXED + DEPLOYED)
**Problem:** vMix Browser input loading `/output?code=X` showed only "Waiting for camera..." even when a phone camera was already streaming in the same room.
**Root cause:** `output.html` ignored the `welcome` message's `peers` array — it only created WebRTC peer connections for cameras joining *after* the output page loaded. Cameras already in the room were never offered a connection, so no video track ever arrived.
**Fix (`public/output.html`):** On the `welcome` message, iterate `m.peers` and create an `RTCPeerConnection` (with `onicecandidate` + `ontrack` handlers) for every camera already in the room, so output is ready to receive the camera's WebRTC offer immediately.
**Verification:** Local server + WS test passed (14/14 tests incl. HTTP routes + signaling relay).
**Status:** Committed `8ccef18` and pushed to `main`; Render auto-deploy ON COMMIT → live at `https://airstudio.onrender.com`.

### 7. Paystack Production Setup (PENDING)
**Current state:** Paystack env vars are set in Render (`PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, prices, `BASE_URL`), `NODE_ENV=production` is set.
**Plan:** Test live Paystack checkout → webhook key issuance flow end-to-end.

---

## Known Limitations
- **WebSockets don't work on Vercel** — multi-cam signaling, PTZ control, teleprompter sync require a persistent server (Render). Vercel only serves static + `/api/*` routes.
- **iOS camera permissions** — iOS limits remote manual controls (ISO, WB, focus) due to WebRTC API restrictions; Android has full support.
- **LUT color profiles** — planned with WebGL2 renderer upgrade (not yet implemented).
- **NDI/SRT output** — requires native desktop build (Tauri + NDI SDK/libsrt).
- **Wi-Fi Direct / USB mode** — native Android build only.

---

## Deployment URLs
| Platform | URL | Purpose |
|----------|-----|---------|
| Render | `https://airstudio.onrender.com` | Primary — full WebSocket signaling, multi-cam |
| Vercel | `https://airstudio-one.vercel.app` | Static site + API health check only |

---

## Local Development
```bash
cd airstudio
npm install
npm start          # → http://localhost:3000
# Studio: open /studio, scan QR on phone to open /camera
curl localhost:3000/api/health
```

---

## Git
Repository: `https://github.com/studiobrightdiamond282-dev/airstudio.git`
Branch: `main`
