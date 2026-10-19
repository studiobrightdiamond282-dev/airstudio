# AirStudio — Roadmap vs the Blueprint

Legend: ✅ shipped in this repo · 🟡 partial / browser-limited · ⏳ planned (native phase)

## Phase 1 — Superior Performance & Core Engine

| Blueprint item | Status | Notes |
|---|---|---|
| Dynamic Multi-Lens Engine (0.5×/1×/tele/macro) | ✅ | Every `videoinput` the phone exposes becomes a switchable lens button. Android Chrome exposes physical sub-cameras on most flagships; native app guarantees it. |
| 60 FPS & 4K streaming | ✅ | Resolution presets to 3840×2160, 24/30/60 fps, adaptive max-bitrate (8–22 Mb/s). Actual ceiling = phone sensor + browser. |
| H.265 / AV1 encoding | 🟡 | WebRTC negotiates H.264/VP9/AV1 (browser-dependent). H.265 lands with native MediaCodec/VideoToolbox pipelines. |
| Zero-setup connectivity (no IP typing) | ✅ | 6-char pairing code + QR deep link; ICE/STUN NAT traversal replaces Iriun's fragile LAN-IP pairing. |
| Wi-Fi Direct bypass | ⏳ | Native Android build (WiFiP2pManager). Browser can't access it. |
| USB mode | 🟡 | Works today over USB tethering (same WebRTC stack on the tether subnet). One-tap wired mode in native apps. |
| Battery-saver & thermal management | ✅ | One-tap near-black dim screen (remote-controllable), WakeLock, raw-track passthrough when FX off, live battery telemetry in Studio. Thermal-adaptive resolution comes with native Thermal APIs. |

## Phase 2 — AI Studio & Desktop Controls

| Blueprint item | Status | Notes |
|---|---|---|
| AI portrait blur / virtual background | ✅ | MediaPipe segmentation on the phone: adjustable blur **and** virtual backgrounds — 4 on-phone generated presets (Office/Studio/Gradient/Solid) plus custom image upload from the Studio. |
| Subject tracking & auto-framing | ✅ | MediaPipe face detection on the phone drives the digital PTZ: smooth pan/zoom with deadband + easing, face held at ~34% of frame height on the upper third, graceful ease-back to wide when the subject leaves. Manual PTZ also shipped. |
| AI beauty filters | ✅ | Soft-skin frequency-blend slider, on-device. |
| Low-light enhancement | ✅ | Real-time lift/contrast/saturation in pipeline; native phase adds temporal denoise. |
| Remote ISO / shutter / focus / WB / zoom | 🟡 | Full set implemented capability-driven: whatever the phone browser exposes (Android ≈ everything, iOS ≈ subset) works remotely. Native Camera2/AVFoundation removes all limits. |
| LUT color profiles | ⏳ | `.cube` LUT loader into the canvas/WebGL pipeline — planned with the WebGL2 renderer upgrade. |
| Resizable preview + histograms/grids | 🟡 | Fully responsive Studio + fullscreen monitor shipped. Histogram/scope overlays planned (cheap: sample program canvas). |

## Phase 3 — Pro Streamer & Creator Ecosystem

| Blueprint item | Status | Notes |
|---|---|---|
| Multi-cam switching (up to 4 phones) | ✅ | 4-camera switcher with CUT-to-program, per-camera control target, live badges. |
| Virtual camera for Zoom/Teams/Meet | 🟡 | Today: clean output → OBS Virtual Camera or window share. Native MF/CMIO/v4l2loopback drivers in the desktop build (see ARCHITECTURE.md §4). |
| Native OBS plugin | 🟡 | Browser Source output works now with ~1–2 frame overhead; C++ shared-memory plugin in native phase. |
| Teleprompter overlay synced from desktop | ✅ | Text, play/pause, restart, speed, size — all remote-controlled live. |
| NDI / SRT output | ⏳ | Desktop native build (NDI SDK / libsrt). |
| Snapshot & recording | ✅ | PNG snapshot + WebM program recording built into Studio (not in the blueprint — creators asked, we shipped). |
| Live telemetry dashboard | ✅ | Bitrate sparkline, RTT, jitter, packet loss, fps, phone battery (not in the blueprint — a trust/debug win vs rivals' black box). |

## Marketing differentiators — status check

1. **"Zero Desktop CPU Usage"** — ✅ true today: segmentation/beauty/low-light all execute on the phone; the PC only decodes one video stream.
2. **"True Plug-and-Play / QR Auto-Connect"** — ✅ QR pairing shipped; NFC tap-to-pair in the native Android app.
3. **Clean universal UX** — ✅ dark-mode responsive web UI today; same UI becomes the Tauri desktop app shell unchanged.

## Suggested build order from here

1. **WebGL2 pipeline** on the phone (LUTs, virtual-background images, face-track auto-framing) — pure software, ships to every current user.
2. **Tauri desktop app** embedding this server + Studio → mDNS auto-discovery on LAN, works offline.
3. **Virtual camera drivers** (Windows MF first — largest user base).
4. **Native Android app** (Camera2 full manual + Wi-Fi Direct + USB) → then iOS (AVFoundation).
5. **OBS C++ plugin + NDI/SRT** for the pro tier.
6. **Monetization split:** ✅ **implemented** — free = 720p30, 1 phone, core controls · Premium = 4K60, 4 phones, AI suite, pro manual controls, teleprompter, recording, no watermark. HMAC-signed license keys (`/api/license/*`, `tools/genkey.js`), in-Studio upgrade modal with pricing + demo checkout. **Stripe Checkout + webhook key issuance now wired** — add your keys per `docs/STRIPE_SETUP.md` to take real payments (demo checkout remains as automatic fallback until then).
