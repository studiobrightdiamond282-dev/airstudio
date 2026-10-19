# AirStudio — Run in VS Code & Publish to GitHub

A beginner-friendly, click-by-click guide. Total time: ~10 minutes.

## What you need first (free)

1. **Node.js LTS** — https://nodejs.org (click the big green LTS button, install with defaults)
2. **Visual Studio Code** — https://code.visualstudio.com
3. **Git** — https://git-scm.com/downloads (install with defaults)
4. A free **GitHub account** — https://github.com/join

## Step 1 — Open the project in VS Code

1. Unzip `AirStudio-App.zip` anywhere (e.g. Desktop).
2. Open VS Code → **File → Open Folder…** → select the `airstudio` folder.
3. If asked *"Do you trust the authors?"* → **Yes, I trust the authors**.

## Step 2 — Install & run

Open VS Code's terminal: **Terminal → New Terminal** (or `` Ctrl + ` ``), then:

```bash
npm install      # one-time: downloads the 3 small dependencies
npm start        # starts AirStudio
```

You'll see:

```
AirStudio server running on http://0.0.0.0:3000
Demo Premium license key: AIRS-....
```

Open **http://localhost:3000** in your browser — that's your app. 🎉

> Prefer buttons? Click the **Run and Debug** icon (left sidebar) →
> **▶ AirStudio Server** — same thing.

## Step 3 — Test with your phone while developing

Browsers only allow phone cameras on **HTTPS** pages, so `localhost` won't
work from your phone. Easiest fix — VS Code port forwarding gives you a
public HTTPS link for free:

1. With the server running, open the **PORTS** tab (next to TERMINAL at the bottom).
2. **Forward a Port** → type `3000` → sign in with GitHub/Microsoft if asked.
3. You get a URL like `https://xxxx-3000.xxx.devtunnels.ms` — open it on your
   **PC** (Studio) and scan the QR code with your **phone**. Done!

(Alternative: `npx ngrok http 3000` in a second terminal.)

## Step 4 — Publish to GitHub (the easy way)

This project is already a Git repository with a first commit, so:

**Option A — VS Code button (recommended)**
1. Click the **Source Control** icon (branch icon, left sidebar).
2. Click **Publish to GitHub** → sign in → choose **Publish to GitHub private repository** (recommended while developing).
3. Done — your code is at `github.com/YOUR-USERNAME/airstudio`.

**Option B — Manual commands**
1. On github.com click **+ → New repository**, name it `airstudio`, **do not** add a README/license (this project has them) → Create.
2. In VS Code's terminal:

```bash
git remote add origin https://github.com/YOUR-USERNAME/airstudio.git
git branch -M main
git push -u origin main
```

## Step 5 — Day-to-day workflow

1. Edit files (the app is plain HTML/CSS/JS in `public/` + `server.js` — no build step).
2. Refresh the browser to see changes; restart the server (`Ctrl+C`, `npm start`) only after editing `server.js`.
3. Save your work to GitHub: **Source Control** → write a short message → **✓ Commit** → **Sync Changes**.

Set your own name on commits (one-time):

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## Useful commands

| Command | What it does |
|---|---|
| `npm start` | Run the app on http://localhost:3000 |
| `node tools/genkey.js 5` | Generate 5 Premium license keys |
| `curl localhost:3000/api/health` | Check the server is alive |

## Configuration & going live

- Copy `.env.example` → `.env` and fill in values (never commit `.env` — it's git-ignored).
- Real payments: follow **[STRIPE_SETUP.md](STRIPE_SETUP.md)** (10 min).
- Deploy anywhere Node runs — Render, Railway, Fly.io, or any VPS:
  `npm install && npm start` behind HTTPS. Set `NODE_ENV=production` and a
  private `LICENSE_SECRET` before real users arrive.

## App icon & branding assets

- `icon-master-1024.png` (project root) — full-size round icon for app stores / future native apps.
- `public/icons/` — web sizes (favicon, Apple touch icon, PWA 192/512).
- `public/logo-full.png` — the full AirStudio PREMIUM lockup used on the landing page.
- `public/manifest.webmanifest` — makes the web app installable ("Add to Home Screen") with the round icon.
