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

### 7. vMix Output Fix #2 — Missing Variable Declarations (FIXED + DEPLOYED)
**Problem:** vMix Browser input loading `/output?code=X` still showed "Waiting for camera..." after fix #6.
**Root cause:** `output.html` used `peers` (a Map) and `programId` throughout its script but **never declared them**. With `'use strict'` at the top, every access threw a `ReferenceError`, silently breaking the WebRTC signaling/ontrack logic — so no video track was ever attached to the `<video>` element.
**Fix (`public/output.html`):** Added `let peers = new Map();` and `let programId = null;` declarations.
**Verification:** Syntax check passed; local server + WS test passed (14/14 tests).
**Status:** Committed `14108ff` and pushed to `main`; Render auto-deploy ON COMMIT → live at `https://airstudio.onrender.com`.

### 8. vMix Output Fix #3 — Autoplay Blocked by Chrome Policy (FIXED + DEPLOYED)
**Problem:** vMix Browser input shows video element but video never starts playing (stuck on "Waiting for camera…" or black).
**Root cause:** With `audio=1`, `video.muted` was set to `false`. Chrome's autoplay policy blocks unmuted videos from autoplaying without a user gesture — vMix browser sources have no user gesture, so the video never starts even after a stream attaches.
**Fix (`public/output.html`):** Video now starts `muted = true` (guaranteeing autoplay) and unmutes on the `playing` event when `audio=1` is requested.
**Verification:** Syntax check passed.
**Status:** Committed `a8b7dc8` and pushed to `main`; Render auto-deploy ON COMMIT → live at `https://airstudio.onrender.com`.

### 9. Professional Studio Auto Camera Settings (FIXED + DEPLOYED)
**Problem:** Phone camera output was raw/natural — no professional photo quality, no background blur, no skin smoothing, no vibrant colour, no automatic white balance. User had to manually tweak every setting.
**Fix (`public/camera.html`):** New automatic "Studio Auto" mode that turns ON by default the moment the camera starts — zero user action needed:
- **Dual resolution:** Auto-picks 4K (3840×2160) if device supports it, else 1080p; manual Photo/Video/Auto toggle (⭐ + 📐 buttons in botbar)
- **White balance:** Daylight studio 5500K continuous auto WB via track constraints
- **Exposure:** Continuous auto with slight compensation lift
- **Smooth face (beauty):** Auto-enabled at ~28% soft-skin frequency separation
- **Background blur:** AI segmentation ready (MediaPipe selfie segmentation, on-device)
- **Vibrant colour:** Saturation 1.18×, brightness 1.03×, contrast 1.05×, sharpness 1.03× applied via canvas colour grade in every frame
- **Lowlight:** Auto brightness/contrast boost when sensor is dim
**UI:** ⭐ Studio Auto toggle + 📐 Resolution cycle (Auto/Photo/Video) in camera botbar. Remote-controllable from Studio via `studioAuto`, `studioRes`, `studioWB`, `studioExposure`, `studioSaturation`, `studioBrightness`, `studioContrast` control actions.
**Verification:** camera.html script syntax OK; 14/14 server+WS tests pass.
**Status:** Committed `6e2fb71` and pushed to `main`; Render auto-deploy ON COMMIT → live at `https://airstudio.onrender.com`.

### 10. Phone Camera Crash Fix — "Cannot read properties of undefined (reading 'w')" (FIXED + DEPLOYED)
**Problem:** Phone camera showed `Camera access failed: Cannot read properties of undefined (reading 'w'). Allow camera permission and retry.` and would never start — QR code, barcode, and direct URL all failed identically.
**Root cause:** `pickBestResolution()` in `public/camera.html` called `state.videoTrack.getCapabilities?.()` which on many mobile browsers **returns `undefined`** (not an object). The `?.` only guards if `getCapabilities` itself is missing, not its return value. So `caps` was `undefined`, and `caps.width` threw, crashing `applyStudioAuto`, which is `await`-ed from `join()` — so `startCapture` succeeded but the subsequent `applyStudioAuto` throw aborted `join()` before the camera UI ever appeared.
**Fix (`public/camera.html`):**
- `pickBestResolution()`: `caps = state.videoTrack.getCapabilities?.() || {}` — always defaults to `{}`; uses optional chaining `caps?.width` throughout; all `state.fx.*` accesses use `?.` with fallbacks.
- `applyStudioAuto()`: Entire body wrapped in `try/catch` — Studio Auto can NEVER break camera startup. If pro settings fail, the camera still starts and shows a non-fatal toast.
**Verification:** camera.html script syntax OK.
**Status:** Committed `60b0a20` and pushed to `main`; Render auto-deploy ON COMMIT → live at `https://airstudio.onrender.com`.

### 11. Phone Overheating + Lag Fix — Adaptive Quality System (FIXED + DEPLOYED)
**Problem:** Phone overheated and camera lagged badly during livestream even on 5G/fiber. Root causes: 4K default resolution, up to 22Mbps bitrate, uncapped render loop running at max FPS, no thermal/battery awareness, wake lock keeping screen at full brightness.
**Fix (`public/camera.html`):**
- **Default resolution lowered:** 1920×1080 → 1280×720 (much less encoder load)
- **pickBestResolution():** Thermal-aware — 720p when warm/hot, 1080p only when cool; never defaults to 4K for streaming
- **tuneSender():** Bitrates aggressively cut (22Mbps→6Mbps max, 12Mbps→3.5Mbps), maxFramerate capped at targetFps, keyframe interval optimized
- **tuneSenderForAll():** Re-applies tuned params to all peer connections when quality tier changes
- **Render loop FPS throttle:** Skips frames to hit targetFps (default 30), measures actual FPS, prevents CPU from running at max speed
- **collectStats() adaptive quality:** Monitors outKbps → infers network quality (good/degraded/poor); infers thermal from FPS drops → auto-increments thermalLevel; re-tunes sender on tier change
- **Battery-aware quality:** <20% battery → 20fps; <40% → 24fps; ≥40% → 30fps (only when not charging)
- **setDim() wake-lock release:** Battery-saver dim mode releases the screen wake lock, letting the screen dim/sleep, reducing heat
**Verification:** camera.html script syntax OK; 14/14 server+WS tests pass.
**Status:** Committed `db8ddf5` and pushed to `main`; Render auto-deploy ON COMMIT → live at `https://airstudio.onrender.com`.

### 12. Live-Stream Lag, Frame-Rate Mismatch & Telemetry Fix (FIXED + DEPLOYED)
**Problem:** Live stream lagged, reported FPS was wrong, bitrate telemetry read 0, and dragging a slider/PTZ pad flooded the signaling socket.

**Root causes found & fixed:**
- **Telemetry stuck at 0 (pre-existing bug):** `state.lastStatT` was only assigned *inside* a block gated on `state.lastStatT` being truthy — but it starts at `0` (falsy), so the baseline was **never** set. The camera reported 0 kbps / 0 fps forever, and the adaptive-quality logic ran against a permanently-zero reading. Baselines now always advance (including the first sample), with guards against counter resets on track replacement.
- **FPS reported wrong:** `framesPerSecond` is absent on many mobile browsers. Now derived from the cumulative `framesEncoded` (camera) / `framesDecoded` (Studio) counters, with a `framesPerSecond` fallback.
- **Frame-rate mismatch:** `state.want.fps` (Studio-requested) and `state.targetFps` (actual render rate) diverged — the render loop pushed 30 fps into a 24 fps `captureStream`, dropping/duplicating frames. Added `setTargetFps()` as the single owner of the frame rate; the canvas capture stream is now **recreated** when the rate changes (`captureStream(fps)` locks the rate at creation).
- **Battery saver fought the Studio:** it hard-reset the rate to 30 fps, overriding a Studio request for 24/60. It now only *lowers* the Studio-requested ceiling.
- **Encoder thrash:** `setParameters()` was called unconditionally ~60×/minute, re-initialising the hardware encoder and forcing keyframes. Now only called when the bitrate/framerate actually changed.
- **Background blur cost:** a full-res `ctx.filter = blur()` per frame was the main frame-rate collapse. Now blurs a quarter-resolution plate (~16× cheaper) and scales it up.
- **Control overhead:** slider `input` / PTZ `pointermove` fired up to ~60 signals/sec, each triggering a telemetry round-trip and a full Studio card re-render. Now throttled to an 80 ms trailing edge that flushes the final value (and any pending value when the action changes) → ~12 msgs/sec, identical end state. Camera telemetry replies to controls are coalesced (250 ms) instead of echoing a full payload per control.
- **Studio DOM churn:** `renderCamLinks()` rebuilt its DOM on every card render (every telemetry message + 1 s poll). Now rebuilds only when the camera set changes.

**Also included:** PWA support — new `public/service-worker.js` (installable app shell + offline fallback), registered from index/camera/studio/output, Apple meta tags, an in-page "Install AirStudio App" button (`beforeinstallprompt` + iOS Share→Add-to-Home-Screen hint), and `.webmanifest` served with the correct MIME type. Service worker uses **network-first** for pages/CSS/JS so hot-fixes reach installed clients immediately (icons stay cache-first).

**Verification:** all inline `<script>` blocks parse; camera `state` object has no duplicate keys; runtime assertions confirm throttle coalescing/final-value/flush, exact bitrate+FPS computation, counter-reset guards and the `framesPerSecond` fallback; `test-ws.js` 5/5 pass against both `server.js` and `index.js` locally **and against live `wss://airstudio.onrender.com`**; every shell asset returns 200.
**Status:** Committed `55868dd` + `b9f26c5`, pushed to `main`; Render auto-deploy ON COMMIT → live at `https://airstudio.onrender.com`; Vercel redeployed via CLI (`airstudio-b2qxf1sdd-velora-7d47.vercel.app`, aliased to `https://airstudiocam.vercel.app`). Both live builds verified to contain the new code. **Still needs on-device validation** (real capture at 24/30/60 fps, background blur, slider/PTZ feel, latency/jitter, offline PWA behaviour).

### 13. Paystack Production Setup (PENDING)
**Current state:** Paystack env vars are set in Render (`PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, prices, `BASE_URL`), `NODE_ENV=production` is set.
**Plan:** Test live Paystack checkout → webhook key issuance flow end-to-end.

### 14. Mic Toggle Audio Renegotiation (FIXED)
**Problem:** Turning the mic ON after initial capture did nothing — the Studio never received the audio track. `startCapture()` sends an offer with `audio: false`, so no audio track exists on any `RTCPeerConnection`. The mic toggle handler called `pc.addTrack(audioTrack)` but never renegotiated, so the remote side (Studio/Output) never learned about the new track.
**Fix (`camera.html`):**
- Added `pc.onnegotiationneeded` handler in `makePeer()` — when tracks are added/removed, it creates an offer, sets local description, and relays it to the remote peer. The remote side’s `onSignal` already handles the answer (existing flow).
- Rewrote the mic toggle handler: acquires audio via `getUserMedia`, adds to `rawStream`, replaces/removes audio senders on all peer connections, then per peer: `createOffer` → `setLocalDescription` → relay. Also handles `replaceTrack` when an audio sender already exists.
- `makePeer()` now adds `state.audioTrack` immediately if it already exists (reconnect case).
**Verification:** `test-ws.js` 5/5 pass against local `server.js` and `index.js`. WebRTC-level renegotiation requires live browser testing.

### 15. Studio `ontrack` Stream Merging (FIXED)
**Problem:** Studio’s `ontrack` handler did `cam.stream = e.streams[0]`, replacing the entire stream on every event. When the camera renegotiates to add audio (mic toggle ON), the new `ontrack` event for audio would overwrite the video-only stream, dropping video from the program feed.
**Fix (`studio.html`):** `ontrack` now merges tracks — first event sets `cam.stream`; subsequent events add any tracks not already present (by track ID). `e.track`-only events are also handled. `srcObject` is set once after all tracks are merged.
**Verification:** `test-ws.js` 5/5 pass. Browser-level track-merge requires live testing with mic toggle.

### 16. Output `programId` Validation (FIXED)
**Problem:** `output.html` set `programId = m.data.cameraId` from any relay `program` message without validating that the camera exists. An unvalidated/`null` `programId` caused `peers.get(programId)` to return `undefined`, breaking the program feed.
**Fix (`output.html`):** Only switch program when `cameraId` is present **and** `peers.has(cid)`. Unknown/absent camera IDs are silently ignored.
**Verification:** `test-ws.js` 5/5 pass. Unit-level logic change; no browser needed.

### 17. Telemetry Payload Minimization (FIXED)
**Problem:** Camera telemetry sent the entire `state.fx` object (including internal/derived fields) on every telemetry tick (~1–2 Hz), wasting bandwidth and triggering unnecessary Studio re-renders.
**Fix (`camera.html`):** `sendState()` now sends only the `fx` fields the Studio actually consumes: `bgmode`, `bgPreset`, `bgstrength`, `mirror`, `lowlight`, `beauty`, `autoframe`. Internal fields (e.g. `bgImg`, `fgCanvas`, `lastFrame`) are excluded.

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
| Vercel | `https://airstudiocam.vercel.app` | Static site + API health check only |

Both are auto-deployed from `main` (Render on commit; Vercel via `vercel --prod`).

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
