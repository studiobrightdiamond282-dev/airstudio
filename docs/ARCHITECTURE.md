# AirStudio — Technical Architecture

This document covers the system as built today (the WebRTC web engine in this repo)
and the engineered path to the native product described in the product blueprint.

---

## 1. System overview (current build)

```
┌──────────────────┐        WebSocket (signaling only)      ┌──────────────────┐
│  Phone (browser) │ ◄───────────────────────────────────► │  Signaling server │
│  /camera         │                                        │  Node.js + ws     │
│                  │        WebRTC media (DTLS-SRTP, P2P)   │  rooms = 6-char   │
│  capture → FX/AI │ ════════════════════════════════════► │  pairing codes    │
│  pipeline        │                                        └────────┬─────────┘
└──────────────────┘                                                 │ signaling
        ▲                                                            ▼
        │  control channel (lens, exposure, torch,        ┌──────────────────┐
        │  teleprompter, PTZ…) via signaling relay         │  PC (browser)     │
        └──────────────────────────────────────────────────│  /studio  /output │
                                                            └──────────────────┘
```

- **Media path is peer-to-peer.** The server never touches video. On a LAN the
  stream never leaves the network; over the internet it uses STUN hole-punching.
  This is what eliminates Iriun-style "IP pair failures" on guest networks —
  there is no IP to type and no port to open; pairing is a 6-char code / QR scan.
- **Mesh topology:** each phone opens one `RTCPeerConnection` per viewer
  (Studio + each Output). With ≤4 phones and ≤2 viewers this is ≤8 encodes,
  and hardware H.264/H.265 encoders on modern phones handle it easily.
- **On-device FX pipeline:** when any visual effect is enabled, frames flow
  `camera → <canvas> → captureStream()`; otherwise the raw camera track is sent
  untouched (true zero-copy passthrough, best quality + lowest battery).
  Track switching is seamless via `RTCRtpSender.replaceTrack()` — no renegotiation.
- **AI background blur:** MediaPipe Selfie Segmentation (WASM + GPU delegate)
  runs entirely on the phone. Person mask is composited over a blurred plate
  in the canvas pipeline. Desktop CPU usage: zero — a headline differentiator.

### Signaling protocol (JSON over WebSocket)

| Message | Direction | Purpose |
|---|---|---|
| `join {room, role, name}` | client → server | Enter a pairing-code room as `camera` / `studio` / `output` |
| `welcome {id, peers[]}` | server → client | Your id + who's already here |
| `peer-joined / peer-left / peer-updated` | server → room | Presence + capability changes |
| `relay {to, kind:'signal', data}` | peer ↔ peer | SDP offers/answers + ICE candidates |
| `relay {to, kind:'control', data}` | studio → camera | Lens, resolution, fps, zoom, EV, WB, focus, ISO, torch, FX, PTZ, dim, mic |
| `relay-role {role:'camera', kind:'teleprompter'}` | studio → all phones | Script text / play / speed / size |
| `relay-role {role:'studio', kind:'state'}` | camera → studios | 2 s telemetry: settings, bitrate, battery, lens list, track capabilities |
| `relay-role {role:'output', kind:'program'}` | studio → outputs | Which camera is on air (switcher CUT) |

### Capability-driven control surface

The phone reports `MediaStreamTrack.getCapabilities()` (zoom range, torch,
exposure compensation, color temperature, focus distance, ISO…) and the Studio
builds its sliders from the *actual* ranges, disabling what the browser can't
expose. Android Chrome exposes nearly everything; iOS Safari exposes little —
the UI degrades gracefully and tells the user why. The native apps remove
these limits entirely (see §3).

---

## 2. WebRTC vs custom UDP — the decision record

| Criterion | WebRTC (chosen) | Custom RTP/UDP |
|---|---|---|
| NAT traversal (guest Wi-Fi, double NAT) | ✅ ICE/STUN built in | ❌ You rebuild ICE |
| Congestion control / adaptive bitrate | ✅ GCC + TWCC | ❌ Months of R&D |
| Encryption | ✅ DTLS-SRTP mandatory | DIY |
| Browser support (zero-install phone client) | ✅ Everywhere | ❌ Impossible |
| Latency floor | ~40–80 ms glass-to-glass LAN | ~25–50 ms possible |
| Codec freedom (AV1/H.265) | H.264/VP8/VP9/AV1 (H.265 in Safari) | Anything |

**Verdict:** WebRTC for the product; reserve a custom QUIC/UDP transport as a
future "USB Pro Mode" where the native apps can chase the last 20 ms.
Iriun/DroidCam's brittle raw-socket approach is exactly why their pairing
breaks on real-world networks.

**USB path (native phase):** Android via ADB-style localhost forwarding or
USB tethering network interface — the *same* WebRTC stack then runs over the
cable with LAN-class latency and charging-while-streaming. iOS via
`usbmuxd` tunnel to the app's local peer. One transport, two physical layers.

---

## 3. Native apps (Phase 2) — unlocking full hardware

### Android — Kotlin + Camera2 (CameraX for preview glue)
- `CameraManager.getCameraIdList()` + logical multi-camera APIs → every
  physical lens (0.5×/1×/3×/5×/macro) with instant switching.
- Full manual: `SENSOR_SENSITIVITY` (ISO), `SENSOR_EXPOSURE_TIME` (shutter),
  `LENS_FOCUS_DISTANCE`, `COLOR_CORRECTION_GAINS` (WB), `CONTROL_ZOOM_RATIO`.
- Hardware encode via `MediaCodec` H.265/AV1 where the SoC supports it.
- ML Kit / NNAPI delegate for segmentation + face-mesh auto-framing on the NPU.
- Thermal API (`PowerManager.getThermalHeadroom`) → adaptive resolution
  before throttling, not after.

### iOS — Swift + AVFoundation
- `AVCaptureDevice.DiscoverySession` with `.builtInUltraWideCamera`,
  `.builtInTelephotoCamera`, `.builtInLiDARDepthCamera`; virtual
  multi-cam devices for smooth focal ramps.
- `setExposureModeCustom(duration:iso:)`, `setWhiteBalanceModeLocked(with:)`,
  `setFocusModeLocked(lensPosition:)`.
- Subject tracking: `AVCaptureMetadataOutput` face rects → Center-Stage-style
  crop computed in the sample-buffer delegate (NEON/Metal).
- Segmentation via Vision `VNGeneratePersonSegmentationRequest` (ANE-accelerated).

### Shared core
A Rust core (signaling, WebRTC via `webrtc-rs` or libwebrtc binding, control
protocol) compiled to both platforms keeps behaviour identical and the codebase DRY.

---

## 4. Desktop app + virtual camera (Phase 2/3)

**Shell:** Tauri (Rust) — ~10 MB binary vs Electron's ~150 MB, native webview
reuses this repo's Studio UI as-is.

**Virtual camera drivers** (so AirStudio appears in Zoom/Teams camera menus):

| OS | Mechanism | Notes |
|---|---|---|
| Windows 11 | Media Foundation Virtual Camera (`IMFVirtualCamera`) | Modern, signed driver package; Win10 fallback: DirectShow filter DLL |
| macOS 13+ | Core Media IO Camera Extension (`CMIOExtensionProvider`) | System extension, notarization required; legacy DAL plugin is deprecated |
| Linux | `v4l2loopback` kernel module + PipeWire bridge | Ship DKMS package / depend on distro module |

**Virtual microphone:** Windows WASAPI virtual audio device (or bundle a
signed VAC-style driver), macOS CoreAudio HAL plugin / aggregate device,
Linux PipeWire/PulseAudio null-sink monitor.

**OBS plugin:** native C++ plugin registering a "AirStudio Source" that pulls
frames straight from the WebRTC receiver via shared-memory ring buffer —
bypasses the virtual driver, ~1 frame faster than Browser Source.

**NDI / SRT outputs:** NDI SDK sender from the decoded program frame;
SRT via libsrt with the encoded H.264 elementary stream re-muxed to MPEG-TS.

---

## 5. Performance budget

| Metric | Target | Current web build (LAN) |
|---|---|---|
| Glass-to-glass latency | < 50 ms USB / < 80 ms Wi-Fi | ~60–120 ms (browser jitter buffer) |
| Max stream | 4K60 | 4K60 where phone + browser allow |
| Desktop CPU (AI on) | ~0 % (phone NPU) | ~0 % (phone WASM/GPU) |
| Phone thermal | no throttle ≥ 60 min @1080p30 | dim mode + raw passthrough minimize load |

---

## 6. Security & privacy

- Media is DTLS-SRTP encrypted end-to-end between phone and PC; the signaling
  server only exchanges session descriptions.
- Pairing codes are single-room, ephemeral, and rate-limited by room size caps.
- Production hardening list: TURN server with time-limited credentials for
  symmetric-NAT users, optional room PIN, and signed device identity
  (remembered trusted PCs skip the code).

## 7. Scaling the signaling layer

The Node server is stateless per-room in memory — horizontally scalable with
sticky sessions by room code or a Redis pub/sub fan-out. A single $5 VPS
handles thousands of concurrent pairings because media never touches it.
For the LAN-only desktop app, the same server is embedded in the Tauri binary
(phones connect via mDNS/Bonjour discovery + QR deep link — works with no internet).
