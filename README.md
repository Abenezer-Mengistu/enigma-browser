<p align="center">
  <img src="assets/icons/icon_128.png" alt="Enigma" width="96" height="96">
</p>

<h1 align="center">Enigma</h1>

<p align="center">
  <strong>A privacy-first desktop browser with isolated sessions, multi-user profiles, and controls you can actually see.</strong>
</p>

<p align="center">
  <a href="https://github.com/Abenezer-Mengistu/enigma-browser/releases/latest">Download</a> ·
  <a href="https://abenezer-mengistu.github.io/enigma-browser/">Website</a> ·
  <a href="#features">Features</a> ·
  <a href="#building-from-source">Build</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/Abenezer-Mengistu/enigma-browser?label=version&color=9061f9" alt="Latest release">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/github/actions/workflow/status/Abenezer-Mengistu/enigma-browser/build.yml?branch=main&label=build" alt="Build status">
</p>

---

## What is Enigma?

**Enigma** is a free, open-source desktop browser built for people who want **real separation** between how they browse — without giving up a fast, familiar Chromium experience.

Most browsers treat everything as one big bucket: one set of cookies, one history, one identity. Enigma is different. It is organized around **sessions** — isolated containers that keep work, shopping, banking, and personal browsing apart. Each session has its own cookies, storage, tabs, and privacy rules. Switch between them like workspaces, not like clearing cookies every time you change hats.

On top of that, Enigma supports **multiple users** on the same machine. Each user gets their own profiles, bookmarks, history, settings, and sessions — ideal for shared computers or keeping a work identity completely separate from a personal one.

Your data stays **on your device by default**. There is no required cloud account. If you want to move settings between machines, you can export an encrypted vault with a passphrase — but only when you choose to.

---

## Why Enigma?

| Problem | How Enigma helps |
|--------|-------------------|
| Logged into the wrong account because cookies leaked across sites | **Session containers** keep cookies and storage isolated per session |
| Shared family or work PC | **Multi-user profiles** with separate data per person |
| Trackers following you everywhere | **Built-in tracker & ad blocking** with filter lists and per-site exceptions |
| Privacy tools buried in settings | **Transparent controls** — HTTPS-only, fingerprint protection, WebRTC leak protection, and more |
| Incognito that forgets everything | **Persistent private sessions** — isolated like incognito, but organized and reusable |
| Need different rules for different tasks | **Session templates** (Work, Shopping, Banking, Research) with preset privacy levels |

---

## Features

### Session containers

Sessions are Enigma's core idea. Each session is a fully isolated browsing environment:

- **Separate cookies & storage** — sites in one session cannot read data from another
- **Independent tab sets** — each session remembers its own open tabs
- **Per-session privacy rules** — override global settings for a specific container
- **Optional proxy routing** — route a session through SOCKS5 or HTTP proxy
- **Ephemeral mode** — discard all data when the session closes (like incognito, but named and reusable)
- **Burn session** — wipe cookies, cache, and storage instantly from the session dashboard

Create sessions from built-in templates or customize your own.

#### Session templates

| Template | Best for | Defaults |
|----------|----------|----------|
| **Work** | Accounts, docs, email | HTTPS-only, tracker blocking, fingerprint protection |
| **Shopping** | Stores & checkout | Tracker blocking, isolated cookies, DuckDuckGo search |
| **Banking** | Finance & payments | Maximum blocking, HTTPS-only, mixed content blocked |
| **Research** | Reading & exploration | Balanced protection, flexible HTTPS |
| **Custom** | Anything else | You pick name, color, and rules |

### Multi-user profiles

- Create **browser users** with their own color, name, and data directory
- Each user has independent bookmarks, history, notes, settings, and sessions
- Switch users from Settings — no overlap unless you export/import a vault
- Great for shared desktops: one install, many completely separate browsers

### Privacy & security

Privacy controls are on by default and visible in Settings:

- **Tracker & ad blocking** — EasyList-style filter lists block known tracking domains
- **HTTPS-Only mode** — upgrade insecure HTTP navigations when possible
- **Fingerprint protection** — reduce canvas and device fingerprinting
- **WebRTC leak protection** — limit local IP exposure through WebRTC
- **Mixed content blocking** — block insecure HTTP resources on HTTPS pages
- **Do Not Track** — send DNT headers to requesting sites
- **Pop-up handling** — open pop-ups in new tabs instead of separate windows
- **Permission prompts** — location, camera/microphone, and notifications require your approval
- **Per-site exceptions** — allow or force-block trackers on specific domains
- **Shield counter** — see how many trackers were blocked in the current session

### Everyday browsing tools

Enigma is a full desktop browser, not just a privacy shell:

- Tabs with pin, mute, duplicate, and tab preview
- Bookmarks & history panels with import/export
- Built-in **find on page**, **reading mode**, **screenshot**, and **print**
- **Notes panel** for quick scratchpad text (saved per user)
- **Download manager** with pause, resume, cancel, and open-file actions
- **Auto-updates** with progress bar, release notes, and one-click restart
- **Themes** — Dark, Light, and gradient wallpapers; compact tab mode
- **Keyboard shortcuts** — press `?` in the app for the full list
- **Developer tools** — standard Chromium DevTools (`Ctrl+Shift+I`)

### Optional encrypted vault

Move your setup between machines without a cloud account:

- Export bookmarks, settings, and session config into an **encrypted vault**
- Protect with a passphrase (8+ characters)
- Import on another device when you are ready

Nothing syncs automatically. You stay in control.

---

## Download

**Latest release:** [GitHub Releases](https://github.com/Abenezer-Mengistu/enigma-browser/releases/latest)

**Website:** [abenezer-mengistu.github.io/enigma-browser](https://abenezer-mengistu.github.io/enigma-browser/)

| Platform | Installer | Notes |
|----------|-----------|-------|
| **Windows** | `Enigma-Setup-x.x.x.exe` | Recommended — NSIS installer with Start Menu shortcut |
| **Windows** | `Enigma-Portable-x.x.x.exe` | No install; runs from any folder or USB |
| **macOS** | `Enigma-x.x.x-mac-arm64.zip` / `-x64.zip` | Unzip and drag **Enigma.app** to Applications |
| **Linux** | `.AppImage` | Make executable and run — no install needed |
| **Linux** | `.deb` / `.rpm` | Native package for Debian/Ubuntu or Fedora/RHEL |

Enigma checks for updates on startup and every 8 hours. You can also check manually in **Settings → Updates**.

---

## Getting started

1. **Install** the build for your platform (see table above).
2. **Launch Enigma** — a short onboarding walkthrough introduces sessions, privacy, and setup.
3. **Choose guest or create a user** — guest works immediately; a named user keeps data organized on shared PCs.
4. **Browse in the default session**, or press **Ctrl+Shift+N** (or the menu) to create a new isolated session.
5. **Open Settings** (`⚙` in the toolbar) to tune privacy, themes, users, and updates.

### Quick tips

- **New session:** `Ctrl+Shift+N` or right-click the tab bar → New session
- **Session dashboard:** Settings → Sessions → Dashboard — view stats, burn data, or manage the container
- **Switch user:** Settings → Users
- **Keyboard shortcuts:** press `?` anywhere in the app

---

## How it works (under the hood)

Enigma is built on **Electron** and **Chromium**. Each session maps to a separate Chromium storage partition — the same isolation technique used by container tabs in Firefox, but first-class in Enigma's UI.

```
┌─────────────────────────────────────────────────────────┐
│  Enigma (one app install)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  User A     │  │  User B     │  │  …          │     │
│  │  ┌───────┐  │  │  ┌───────┐  │  │             │     │
│  │  │ Work  │  │  │  │ Main  │  │  │             │     │
│  │  │ Shop  │  │  │  │ Bank  │  │  │             │     │
│  │  └───────┘  │  │  └───────┘  │  │             │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│         Each session = isolated cookies, cache, tabs    │
└─────────────────────────────────────────────────────────┘
```

Data is stored in your OS app-data directory (not beside a portable `.exe`), so profiles survive moves and reinstalls on the same machine.

---

## Building from source

### Requirements

- **Node.js** 20+ (24 recommended — matches CI)
- **npm**
- Platform tools for native builds (Windows: none extra; macOS: Xcode CLT; Linux: `rpm`, `dpkg` for packages)

### Install & run (development)

```bash
git clone https://github.com/Abenezer-Mengistu/enigma-browser.git
cd enigma-browser
npm install
npm run start:dev
```

### Build installers

```bash
# Windows (Setup + Portable + latest.yml for auto-update)
npm run build:win

# macOS (DMG + zip, x64 + arm64)
npm run build:mac

# Linux (AppImage + deb + rpm)
npm run build:linux

# All platforms (on a machine that supports them)
npm run build:all
```

Output lands in `dist/`. On Windows you can also double-click **`CLICK ME TO BUILD.bat`** for a guided build.

### Other scripts

| Script | Purpose |
|--------|---------|
| `npm start` | Launch built app via PowerShell launcher |
| `npm run setup` | Build unpacked dir + desktop shortcut |
| `npm run build:manifest` | Regenerate `website/downloads.json` |
| `npm run shortcut` | Create Windows desktop shortcut |

---

## Project structure

```
enigma-browser/
├── assets/           # UI (index.html, CSS, wallpapers, icons)
├── src/
│   ├── main.js       # Electron main process, IPC, sessions, downloads
│   ├── preload.js    # Secure renderer ↔ main bridge
│   ├── updater.js    # Auto-update (GitHub releases)
│   ├── security.js   # Tracker blocking, HTTPS upgrade, permissions
│   ├── privacy-store.js
│   └── session-templates.js
├── scripts/          # Build helpers (icons, manifest, latest.yml)
├── website/          # GitHub Pages download site
└── .github/workflows # CI builds & release on version tags
```

---

## Contributing

Contributions are welcome — bug reports, feature ideas, and pull requests.

1. Fork the repository
2. Create a branch for your change
3. Test locally with `npm run start:dev`
4. Open a pull request with a clear description of what changed and why

Please keep changes focused. Match the existing code style in the files you touch.

---

## License

Enigma is released under the **MIT License**. See [LICENSE.txt](LICENSE.txt).

Enigma is built on [Electron](https://www.electronjs.org/) and uses Chromium for web rendering.

---

## Links

- **Releases:** https://github.com/Abenezer-Mengistu/enigma-browser/releases
- **Download site:** https://abenezer-mengistu.github.io/enigma-browser/
- **Issues:** https://github.com/Abenezer-Mengistu/enigma-browser/issues

---

<p align="center">
  <sub>Enigma · Privacy built in. Browsing refined.</sub>
</p>
