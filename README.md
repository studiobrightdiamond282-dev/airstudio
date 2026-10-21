# AirStudio — Elevate Your Vision — Your Phone Is a 4K Studio Camera

Smartphone-to-PC webcam software built to outclass Iriun Webcam, DroidCam and
Camo: multi-lens switching, on-device AI background blur, a 4-phone production
switcher, full remote studio controls, a synced teleprompter, and QR pairing —
with **zero app installs**: the phone client runs in the mobile browser.

![status](https://img.shields.io/badge/phase-1%2F2%20web%20engine-brightgreen)
![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20WebRTC-blueviolet)

## Quick start

```bash
npm install
npm start           # → http://localhost:3000
```

1. **On the PC:** open `/studio`. A pairing code + QR code appear.
2. **On the phone:** scan the QR (or open `/camera` and type the code),
   allow camera/mic. You're live.
3. **Direct your shot:** switch lenses, ride exposure/zoom, enable AI blur,
   roll the teleprompter. Add up to 4 phones and CUT between them.
4. **Go live:** add the *OBS output URL* (`/output?code=XXXXXX`) as an OBS
   Browser Source, or full-screen it for Zoom/Teams screen-share.

> **HTTPS note:** browsers only allow camera access on `https://` or
> `localhost`. For use on your LAN, put AirStudio behind any HTTPS endpoint —
> e.g. `ngrok http 3000`, Cloudflare Tunnel, Tailscale Funnel, or your own
> reverse proxy with Let's Encrypt. Media itself stays peer-to-peer.

## Install on your phone (no App Store)

AirStudio is a Progressive Web App — install it straight from the mobile browser,
no App Store or Play Store needed:

- **Android (Chrome):** open your AirStudio URL, tap **⋮ → Install app** (or the
  **📲 Install AirStudio App** button on the camera page). It lands on your home
  screen, opens in its own window, works offline, and remembers your pairing code.
- **iPhone/iPad (Safari):** tap **Share** → **Add to Home Screen**. Open it from
  your home screen — it runs full-screen like a native app.

Once installed, open the app, scan the Studio's QR code (or type the pairing code),
allow camera/mic, and you're live as a wireless studio camera.

> Camera access requires `https://` (or `localhost`). For LAN use, put AirStudio
> behind HTTPS — `ngrok http 3000`, Cloudflare Tunnel, Tailscale Funnel, or your
> own Let's Encrypt reverse proxy.

## What's inside

| Path | Purpose |
|---|---|
| `server.js` | Static host + WebSocket signaling (pairing rooms, control relay, QR endpoint) |
| `public/index.html` | Product landing page + competitor scorecard |
| `public/studio.html` | Desktop control room: switcher, remote controls, AI panel, teleprompter, telemetry, record/snapshot |
| `public/camera.html` | Phone client: multi-lens capture, on-device AI/canvas pipeline, remote-control endpoint, battery-saver |
| `public/output.html` | Borderless program feed for OBS / fullscreen (`?code=&fit=cover&audio=1`) |
| `docs/ARCHITECTURE.md` | Full technical architecture: WebRTC-vs-UDP decision, native app plans, virtual-camera drivers per OS, OBS/NDI/SRT |
| `docs/ROADMAP.md` | Blueprint feature-by-feature status (shipped / partial / planned) + monetization split |

## Highlights vs Iriun / DroidCam / Camo

- **All phone lenses**, not just front/back — ultra-wide, telephoto, macro.
- **60 fps + 4K** over WebRTC with adaptive bitrate up to 22 Mb/s.
- **AI on the phone, not your PC** — background blur, beauty, low-light.
  Desktop CPU stays free for gaming/rendering.
- **4-phone switcher** with CUT-to-program and per-camera remote control.
- **No IP pairing failures** — QR/code + ICE NAT traversal; works on guest
  networks where Iriun gives up.
- **Battery-saver dim mode** + live battery/bitrate/latency telemetry.
- **Synced teleprompter** scrolling under the phone lens.

## Free vs Premium ⭐

AirStudio ships with a working freemium license system:

| | Free | Premium |
|---|---|---|
| Cameras | 1 | up to 4 (switcher) |
| Max quality | 720p30 | 4K · 60 fps |
| AI blur / beauty / low-light / PTZ | – | ✓ |
| Pro manual (ISO, WB, focus) | – | ✓ |
| Teleprompter · recording · no watermark | – | ✓ |

**Try Premium instantly:** in the Studio, click **FREE PLAN — Upgrade ⭐** →
*Checkout (demo)* or *Use demo key*. A real HMAC-signed license key
(`AIRS-XXXX-XXXX-XXXX`) is issued and activated; it persists in the browser.

**Operators:** generate keys with `node tools/genkey.js 5` (set the same
`LICENSE_SECRET` env var on the server and the tool).

**💳 Real payments are pre-wired (Stripe):** set the Stripe env vars from
[`docs/STRIPE_SETUP.md`](docs/STRIPE_SETUP.md) and the Studio automatically
switches from demo checkout to real Stripe Checkout — the webhook mints the
license key and the Studio auto-activates Premium when the buyer returns.
Set `NODE_ENV=production` to disable all demo endpoints.

## Development

```bash
node server.js        # same as npm start; PORT env var overrides 3000
curl localhost:3000/api/health
```

No build step — vanilla JS front-ends by design (instant load on phones,
trivially embeddable in the future Tauri desktop shell).

## License

MIT — see `LICENSE` (add before public release).
