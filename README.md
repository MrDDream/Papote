<p align="center"><img src="docs/assets/icon.svg" width="96" alt=""></p>

<h1 align="center">Papote</h1>

<p align="center"><b>Your little groups, on your own server.</b><br>
A cosy, self-hosted messenger for family and friends: an Android app, an installable web app (PWA) for iPhone and computers, and a single Docker container.</p>

<p align="center">
<a href="https://mrddream.github.io/Papote/">Website</a> ·
<a href="#quick-start-docker-compose">Install</a> ·
<a href="https://github.com/MrDDream/Papote/releases/latest">Android APK</a> ·
<a href="README.fr.md">Français</a>
</p>

<p align="center">
<a href="https://github.com/MrDDream/Papote/pkgs/container/papote"><img alt="Docker image" src="https://img.shields.io/badge/docker-ghcr.io%2Fmrddream%2Fpapote-6a47d6?logo=docker&logoColor=white"></a>
<a href="https://github.com/MrDDream/Papote/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/MrDDream/Papote?color=6a47d6"></a>
<a href="https://github.com/MrDDream/Papote/actions/workflows/tests.yml"><img alt="Tests" src="https://github.com/MrDDream/Papote/actions/workflows/tests.yml/badge.svg"></a>
<a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-6a47d6"></a>
</p>

<p align="center">
<img src="docs/screens/home.png" width="23%" alt="Groups">
<img src="docs/screens/chat.png" width="23%" alt="Chat">
<img src="docs/screens/chat-poll.png" width="23%" alt="Polls and location">
<img src="docs/screens/game.png" width="23%" alt="Mini-games">
</p>

People join a group with a 6-character invitation code (or a QR code). Messages, photos, voice notes and drawings stay on your server: no account at a third party, no Google services, no tracking.

## Features

- **Chat**: text, photos, **videos and documents**, voice notes with waveform, drawings, emoji (the same Noto emoji everywhere), reactions (built-in + any emoji), **swipe a message to reply**, **read ticks** (sent, read by some, read by everyone), live typing indicators, pinned messages, search (text and transcribed voice notes), a gallery with "one year ago today". Tap a profile picture to see it big.
- **Share to Papote** from any app (text, links, pictures), and straight to a conversation from Android's share sheet.
- **French or English**, chosen in Settings (🇫🇷 / 🇬🇧).
- **Themes for the whole app**: Papote and its colours, plus Starry night, Notebook, Neo-pop, Plain, Arcade and Forest (fonts and shapes change too), each in light and dark. Each group picks its own background: 12 patterns (hearts, stars, waves, leaves, confetti…) or a photo.
- **The fun bits**: Bubu the mascot reacting to the group (sleepy, happy, excited, party, surprised), 24-hour stories, polls, location sharing *without any map service*, birthday banner and confetti, a monthly recap with medals, group stickers and favourites, GIFs through GIPHY (always relayed by your server).
- **Drawing**: brush, marker, eraser, bucket, stamps; timelapse replay; "draw over" a photo; a **shared live canvas** everybody paints on at once.
- **Mini-games**: Tic-tac-toe, Connect 4, Rock-paper-scissors, Hangman, "Who said that?" (from your old messages) and live Pictionary.
- **Voice**: playback speed, voice filters (mouse, robot, echo, giant), walkie-talkie mode, optional transcription by a **Whisper** container on your machine.
- **Photos**: decorate before sending (text, stickers, drawing, crop, filters), or make them disappear after 24 hours.
- **Groups**: colours, 20 icons or a picture, background patterns, the group's own quick reactions, roles (owner / admin / member), approval of newcomers, mute, export as `.zip`, two-person conversations.
- **One account, several devices**, with a permanent personal code (and QR code), account merge, optional 2FA, app lock (PIN or fingerprint) on Android.
- **Notifications without Google**: the Android app keeps its own connection; browsers and the iPhone PWA get Web Push, encrypted for the browser.
- **Admin web** (`/admin`): dashboard, server health, storage, **backup & restore**, journal with filters, invitation codes, members, groups with a **30-day trash**, 2FA, IP allowlist, a **new personal code for a member** who lost their phone (all their devices signed out, account 2FA removed), **new version check** (the Android app offers the new APK by itself). The admin never sees group content.

## Quick start (Docker Compose)

You need a machine with Docker and Docker Compose. The image [`ghcr.io/mrddream/papote`](https://github.com/MrDDream/Papote/pkgs/container/papote) is published for `linux/amd64` and `linux/arm64` (Raspberry Pi 4/5).

Create a folder (for example `papote/`) with this `docker-compose.yml`. It reads every setting from `.env` and includes the optional **Whisper** container for voice note transcription:

```yaml
services:
  papote:
    image: ghcr.io/mrddream/papote:latest
    container_name: papote
    restart: unless-stopped
    ports:
      # Host side from .env: BIND_ADDRESS (127.0.0.1 = only a reverse proxy on this machine) and PORT.
      - "${BIND_ADDRESS:-127.0.0.1}:${PORT:-3000}:3000"
    env_file: .env                       # every setting comes from .env (see below)
    environment:
      PORT: 3000                         # inside the container, whatever PORT says in .env
      BACKUP_DIR: /backups
      PAPOTE_PROFILES: ${COMPOSE_PROFILES:-}   # lets Papote know Whisper runs next to it
    volumes:
      - ./data:/data
      - ${BACKUP_HOST_DIR:-./backups}:/backups   # ideally another disk or a NAS

  # Voice note transcription on your machine (optional, ~1-2 GB of RAM):
  # COMPOSE_PROFILES=whisper in .env. Its image is only pulled in that case.
  whisper:
    image: onerahmet/openai-whisper-asr-webservice:v1.9.1
    container_name: papote-whisper
    profiles: ["whisper"]
    restart: unless-stopped
    environment:
      ASR_MODEL: ${WHISPER_MODEL:-small}
      ASR_ENGINE: faster_whisper
    volumes:
      - ./whisper-cache:/root/.cache
```

and a `.env` next to it:

```bash
# Admin password (/admin), 12+ characters
ADMIN_PASSWORD=a-long-password-of-your-own
# Host port and address: 127.0.0.1 when the reverse proxy is on this machine, 0.0.0.0 otherwise
PORT=3000
BIND_ADDRESS=127.0.0.1
# Behind a reverse proxy serving HTTPS
TRUST_PROXY=loopback, uniquelocal
SECURE_COOKIES=true
TZ=Europe/Paris
# Optional: GIFs (free key on developers.giphy.com) and voice transcription (empty = off)
GIPHY_API_KEY=
COMPOSE_PROFILES=whisper
# Largest video or document, in MB; new-version check against GitHub
MAX_UPLOAD_MB=20
UPDATE_CHECK=true
```

If port 3000 is already taken on the machine, change `PORT` (for example `PORT=3080`) and point your reverse proxy at it: Papote keeps listening on 3000 inside the container. Every variable is described [below](#configuration-env).

The repository's [`docker-compose.yml`](docker-compose.yml) and [`.env.example`](.env.example) do the same with every option written out. To start from them:

```bash
mkdir papote && cd papote
curl -LO https://raw.githubusercontent.com/MrDDream/Papote/main/docker-compose.yml
curl -L -o .env https://raw.githubusercontent.com/MrDDream/Papote/main/.env.example
```

Then start it and read the first access code:

```bash
docker compose up -d
```

```bash
docker compose logs papote
```

On the first start, the log prints the **server access code** for the first person (`Code d'accès pour la première personne : K7P-2Q9`). The same code is on the admin dashboard, where it can be regenerated.

- Web app: `http://<your-server>:3000/web/` (port and address: `PORT` and `BIND_ADDRESS` in `.env`; by default the port only listens on `127.0.0.1`, for a reverse proxy on the same machine).
- Admin: `http://<your-server>:3000/admin`
- Android: install the APK from the [latest release](https://github.com/MrDDream/Papote/releases/latest), then enter your server address and the code.

**Updating**

```bash
docker compose pull && docker compose up -d
```

A backup is made automatically every 24 hours. To make one right before an update: `docker exec papote node src/cli.js backup`.

### Behind a reverse proxy (HTTPS)

Browsers require HTTPS to install the web app and to send notifications. Any reverse proxy works: it must pass WebSockets (`/ws`) and allow uploads a bit larger than `MAX_UPLOAD_MB` (25 MB with the default 20).

Caddy (WebSockets and headers are handled automatically), with the admin only reachable from your LAN:

```
papote.example.com {
    @admin_outside {
        path /admin /admin/*
        not remote_ip 192.168.0.0/16 10.0.0.0/8
    }
    respond @admin_outside 404
    reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 25m;   # a bit more than MAX_UPLOAD_MB
}
```

The server only trusts `X-Forwarded-For` from the addresses listed in `TRUST_PROXY` (default: local and private addresses). If the proxy runs on another machine, set `BIND_ADDRESS=0.0.0.0` and make sure the proxy's address is covered by `TRUST_PROXY`.

### Configuration (`.env`)

| Variable | Default | |
|---|---|---|
| `ADMIN_PASSWORD` | *(empty)* | Admin password, 12+ characters. Empty = admin disabled. |
| `ADMIN_ALLOWED_IPS` | *(empty)* | IPs or CIDR ranges allowed to open `/admin` (comma separated). Elsewhere `/admin` answers 404. |
| `ADMIN_REQUIRE_2FA` | `false` | `true`: the admin shows only the Security page until 2FA is set up. |
| `SERVER_NAME` | `Papote` | Name shown in the apps. |
| `PORT` / `BIND_ADDRESS` | `3000` / `127.0.0.1` | Host port and address. `0.0.0.0` when the proxy is on another machine. |
| `TRUST_PROXY` | `loopback, uniquelocal` | Proxy addresses allowed to set `X-Forwarded-For` (a list, never a number). `0` without a proxy. |
| `SECURE_COOKIES` | `true` | Admin cookie over HTTPS only. `false` only to test over plain HTTP. |
| `BACKUP_EVERY_HOURS` / `BACKUP_KEEP` | `24` / `14` | Automatic backups (0 = off) and how many to keep. |
| `BACKUP_HOST_DIR` | `./backups` | Where backups go on the host. Ideally another disk or a NAS. |
| `TZ` | `Europe/Paris` | Time zone for birthdays and the monthly recap. |
| `MAX_UPLOAD_MB` | `20` | Largest video or document ("File") a member can send. Behind nginx, raise `client_max_body_size` to match. |
| `UPDATE_CHECK` | `true` | The server checks GitHub for a new release twice a day: shown in `/admin`, and the Android app offers the new APK (it only asks your server). `false` = never contact GitHub. |
| `GIPHY_API_KEY` | *(empty)* | Free key from [developers.giphy.com](https://developers.giphy.com). Empty = no GIFs. |
| `COMPOSE_PROFILES` | *(empty)* | `whisper` also runs the transcription container (its image is only pulled then). |
| `WHISPER_MODEL` / `WHISPER_LANGUAGE` | `small` / `fr` | Whisper model (`base`, `small`, `medium`…) and the language of voice notes. |
| `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | *(generated)* | Web Push keys, created once in `data/vapid.json`. |
| `SESSION_SECRET` | *(generated)* | Admin session secret, otherwise created in `data/session.secret`. |

### Optional: GIFs and voice transcription

- **GIFs**: put your key in `GIPHY_API_KEY` and run `docker compose up -d`. Searches and previews go through your server, which also keeps the GIFs that are sent: GIPHY never sees your members.
- **Transcription**: set `COMPOSE_PROFILES=whisper` and run `docker compose up -d`. The [whisper-asr-webservice](https://github.com/ahmetoner/whisper-asr-webservice) image (~2 GB) is pulled and started next to Papote; voice notes are transcribed one at a time, on your machine. The `small` model needs about 1–2 GB of RAM.

## Data, backups and restore

Everything lives in `./data`: `papote.db` (SQLite) and `media/`. Keep it on a **local disk** (not NFS/SMB, not a synced folder).

Automatic backups write a consistent copy of the database plus the media (each copied once) to `BACKUP_HOST_DIR`. The admin lists them, can start one, and can **restore** one: the current state is backed up first, then the server puts the snapshot back and restarts (Docker brings it up again). The admin cannot download backups: they contain every message.

From the command line:

```bash
docker exec papote node src/cli.js backup
docker exec papote node src/cli.js list-backups
docker compose stop papote
docker compose run --rm papote node src/cli.js restore papote-2026-01-01T03-00-00-000.db
docker compose start papote
```

Admin maintenance: `docker exec papote node src/cli.js admin-reset-2fa` (lost phone) and `docker exec papote node src/cli.js admin-logout-all`.

## Security and privacy

- The admin web shows counts, sizes and names — never messages, photos, voice notes or drawings. Invitation codes made by members for their groups are masked in the admin.
- Admin: password + optional TOTP 2FA with recovery codes, server-side sessions, lockout after repeated failures, IP allowlist, journal (90 days), strict CSP (no inline script), no caching.
- Members: bearer tokens (Android) or an HttpOnly `SameSite=Strict` cookie (web); 2FA available on accounts; app lock on Android.
- Messages are **not end-to-end encrypted**: whoever controls the server (the `data/` folder, the backups) can read them. Protect the machine and its backups.
- No analytics, no third-party scripts. Web Push goes through the browser vendor's push service, encrypted for the browser (RFC 8291).

## The apps

- **Android** (8.0+): download `Papote-vX.Y.Z-release.apk` from the [releases](https://github.com/MrDDream/Papote/releases) and install it. Later versions install over it, and the app tells you when one is out (Settings → App). To receive messages while the app is closed, allow notifications and turn off battery optimisation for Papote: the app offers it on first launch. Plain `http://` addresses are accepted on a local network (the app warns that the connection isn't encrypted).
- **iPhone, iPad, computers**: open `https://<your-server>/web/`. On iPhone, Share → *Add to Home Screen* installs it and enables notifications (iOS 16.4+).

The interface is in French for now.

## Build from source

```
papote/
├── server/      REST API + WebSocket + admin (Node 26, Express, built-in SQLite)
│   └── web/     Web app / PWA served on /web (plain HTML/CSS/JS, no build step)
├── android/     Android app (Kotlin, Jetpack Compose)
├── docs/        Website (GitHub Pages)
└── docker-compose.yml
```

**Server image** from source:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

**Server** for development (Node 26):

```bash
cd server
npm install
ADMIN_PASSWORD="$(openssl rand -hex 12)" SECURE_COOKIES=false npm run dev
npm test
```

**Android** (JDK 17, Android SDK 34, `android/local.properties` with `sdk.dir=…`):

```bash
cd android
./gradlew assembleDebug
```

For a signed release, create `android/keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) or export `PAPOTE_STORE_FILE`, `PAPOTE_STORE_PASSWORD`, `PAPOTE_KEY_ALIAS` and `PAPOTE_KEY_PASSWORD`, then run `./gradlew assembleRelease`.

**CI** (`.github/workflows`): every push runs the server tests and builds a debug APK; pushes to `main` and tags `vX.Y.Z` build the multi-arch Docker image `ghcr.io/mrddream/papote`. The signed APK is attached to each GitHub release.

## API (overview)

Everything under `/api` except `/api/server`, `/api/join` and `/api/link` needs `Authorization: Bearer <token>` (Android) or the session cookie (web, with `X-Papote-Client: web`). Main routes: `POST /api/join`, `POST /api/link`, `GET|PATCH /api/me`, `GET|POST /api/groups`, `GET|PATCH|DELETE /api/groups/:id`, `/api/groups/:id/{members,invites,messages,media,read,settings,pins,search,gallery,polls,location,stories,stickers,sticker,gif,games,live-draw,recap,export}`, `/api/messages/:id/{reactions/:kind,pin,vote,close,location}`, `/api/games/:id[/move]`, `/api/gifs/{trending,search}`, `/api/media/:id`, `/api/qr`.

WebSocket `/ws`: the server sends `message.new`, `message.updated`, `typing`, `presence`, `member.*`, `group.*`, `user.updated`, `livedraw`, `live`, `story.*`, `sticker.*`, `game.updated`; clients send `typing` and `live` (strokes of the shared canvas and Pictionary).

## License

Papote is free software under the [GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified version as a service for others, you must offer them its source code.

## Credits

Designed with Claude Design, built with Claude Code. Fonts: Baloo 2, Nunito and Noto Color Emoji (SIL Open Font License, see `server/public/fonts`). Voice transcription uses [whisper-asr-webservice](https://github.com/ahmetoner/whisper-asr-webservice). GIFs powered by GIPHY.
