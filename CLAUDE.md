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
start-chrome.sh     — xvfb-run wrapper; PM2 runs this to keep Chrome alive
start-ngrok.sh      — sources .env and starts the ngrok tunnel; PM2-managed
ecosystem.config.js — PM2 config: crate-dl, chrome, ngrok
```

### Download fallback logic (`src/downloader.ts`)

- **SoundCloud source**: try yt-dlp without cookies → on failure, retry via `ytsearch1:{artist} {song} official audio` with `--cookies-from-browser chrome:{CHROME_USER_DATA_DIR}`
- **YouTube source**: always uses `--extractor-args "youtube:player_client=android"` + `--cookies-from-browser chrome:{CHROME_PROFILE_DIR}` for auth. Android client bypasses the n-sig JS challenge and PO Token requirement. yt-dlp must be the pip-installed version (`~/.local/bin/yt-dlp`) — the standalone binary cannot solve JS challenges.
- Auth errors (bot detection, 403, cookie issues) set `retriable: false`; timeouts set `retriable: true`
- `isAuthError()` is exported so callers can distinguish auth failures

### Chrome session (`start-chrome.sh`)

Google Chrome runs persistently via PM2, launched with `xvfb-run -a` (virtual display, since this machine has no desktop session). Chrome is signed into Google and keeps its own session alive — no periodic cookie-refresh process needed. yt-dlp reads cookies directly from the profile on disk via `--cookies-from-browser chrome:/path/to/profile`.

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
| `CHROME_EXECUTABLE_PATH` | Path to Chrome binary (default: `google-chrome`) |
| `CHROME_USER_DATA_DIR` | Persistent Chrome profile directory (default: `~/chrome-profile`) |
| `CHROME_DEBUG_PORT` | CDP debug port Chrome listens on (default: `9222`) |
| `DOWNLOAD_DIR` | Temp dir for in-progress downloads (default: `/tmp/crate_dl`) |
| `DOWNLOAD_TIMEOUT_MS` | yt-dlp timeout in ms (default: `180000`) |
| `NGROK_DOMAIN` | ngrok custom domain |
| `NGROK_AUTH_TOKEN` | ngrok auth token (exported as `NGROK_AUTHTOKEN` for the ngrok binary) |

## Deploy

```bash
npm install
npm run build
chmod +x start-chrome.sh start-ngrok.sh
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the printed command to enable on reboot
```

First-time Chrome login (do once — SSH X forwarding from Mac):
```bash
# On Mac:
ssh -X sree@<machine-ip>
google-chrome --user-data-dir=/home/sree/chrome-profile --no-sandbox
# Sign into Google, then close Chrome
```

PM2 status and logs:
```bash
pm2 status
pm2 logs           # live stream all processes
pm2 logs crate-dl  # single process
```
