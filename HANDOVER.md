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
- Created `/airstudio/index.js` — entry-point shim that creates HTTP server from `server.js`'s exported `handleRequest` and listens on `process.env.PORT`
- Refactored `/airstudio/server.js` to export `handleRequest` function; `server.listen()` and WebSocket setup now only run in standalone mode (`require.main === module`)
- Fixed `package.json` `"main"` from `index.js` → `server.js`
- Fixed `vercel.json` route ordering (API routes before static catch-all)
- **Status:** Deployed to Render at `https://airstudio.onrender.com`; auto-deploy ON COMMIT enabled

### 2. Vercel Serverless Deployment
**Problem:** Vercel requires serverless handler export, not `server.listen()`.
**Fix:**
- Refactored `server.js` to export `handleRequest` (Vercel-compatible)
- Created `/airstudio/api/[[...path]].js` — Vercel catch-all serverless function for `/api/*` routes
- Simplified `vercel.json` to file-based routing
- **Status:** Deployed to Vercel at `https://airstudio-one.vercel.app`; `/api/health` returns `{"ok":true}` ✅

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

### 6. Paystack Production Setup (PENDING)
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
