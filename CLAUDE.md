# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service does

`crate-dl` is a download microservice running on a Dell Inspiron 7548 (Ubuntu, residential IP). It receives `POST /download` requests from the `dj-agent` (running on Google Cloud Run), downloads audio via `yt-dlp`, uploads the MP3 to `gs://dj-crate-stash/temp/`, and returns the GCS key. It runs on a residential IP so YouTube doesn't block downloads — no cookie-refresh tricks needed.

## Commands

```bash
npm run dev          # run with tsx (no build step)
npm run build        # tsc → dist/
npm run start        # node dist/index.js (production)
```

Test the endpoint locally:
```bash
curl -X POST http://localhost:4000/download \
  -H "Authorization: Bearer $CRATE_DL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/...","source":"soundcloud","songName":"Test","artist":"Artist"}'
```

There are no tests. There is no linter configured.

## Architecture

```
src/index.ts        — Express app, /health + POST /download + bearer auth
src/downloader.ts   — yt-dlp orchestration and fallback logic
src/gcs.ts          — GCS upload to gs://dj-crate-stash/temp/{filename}
start-ngrok.sh      — sources .env and starts the ngrok tunnel; PM2-managed
ecosystem.config.js — PM2 config: crate-dl, ngrok
```

### Download fallback logic (`src/downloader.ts`)

No cookies or browser auth are used in normal operation. The residential IP makes both YouTube and SoundCloud treat requests as normal user traffic.

- **SoundCloud source**: try yt-dlp directly against the SoundCloud URL (no extractor args — SoundCloud doesn't need them) → on failure, retry via `ytsearch1:{artist} {song} official audio` routed through the YouTube fallback chain below
- **YouTube source** (and YouTube search fallback): tries three strategies in order, stopping on first success or on timeout:
  - **Plan A** — `player_client=android`: bypasses n-sig JS challenge, no PO Token needed on residential IP
  - **Plan B** — `player_client=android_vr`: no PO Token required at all; survives most YouTube backend changes
  - **Plan C** — `player_client=web_creator` + `--cookies-from-browser chrome:{CHROME_PROFILE}`: uses the signed-in Chrome session as last resort
- Timeouts short-circuit the fallback chain immediately (`retriable: true`) — switching clients won't fix a network timeout
- Auth errors and format errors (`retriable: false`) do trigger the next plan
- `isAuthError()` is exported so callers can distinguish auth failures
- yt-dlp must be the pip-installed version (`~/.local/bin/yt-dlp`) — the standalone binary cannot solve JS challenges

### Why Chrome was removed

The original DigitalOcean setup used `--cookies-from-browser chrome:...` to pass YouTube auth cookies from a signed-in Chrome profile — datacenter IPs need that to avoid bot detection. After migrating to the Dell (residential IP), cookies became unnecessary and were actively breaking things: the android player client is incompatible with `--cookies-from-browser`, causing "Requested format is not available" errors. Dropping cookies entirely fixed it. Chrome is no longer started or needed.

### Tunnel (`start-ngrok.sh`)

ngrok exposes port 4000 via a stable custom domain. PM2 manages the process. The script sources `.env` and exports `NGROK_AUTHTOKEN` before calling ngrok.

## Environment variables

| Variable | Description |
|----------|-------------|
| `CRATE_DL_SECRET` | Bearer token — must match `dj-agent`; service refuses to start without it |
| `PORT` | Express port (default `4000`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account JSON |
| `GCP_ID` | GCP project ID |
| `YTDLP_PATH` | Path to yt-dlp binary (default: `yt-dlp`) |
| `CHROME_USER_DATA_DIR` | Chrome profile dir used by Plan C cookie fallback (default: `~/chrome-profile`) |
| `DOWNLOAD_DIR` | Temp dir for in-progress downloads (default: `/tmp/crate_dl`) |
| `DOWNLOAD_TIMEOUT_MS` | yt-dlp timeout in ms (default: `180000`) |
| `NGROK_DOMAIN` | ngrok custom domain |
| `NGROK_AUTH_TOKEN` | ngrok auth token (exported as `NGROK_AUTHTOKEN` for the ngrok binary) |

## Deploy

```bash
npm install
npm run build
chmod +x start-ngrok.sh
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the printed command to enable on reboot
```

PM2 status and logs:
```bash
pm2 status
pm2 logs           # live stream all processes
pm2 logs crate-dl  # single process
```
