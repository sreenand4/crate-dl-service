# Crate

A Slack-native DJ music library assistant. Send it a track name, it finds the best version, downloads it, organizes it into genre folders, and stages it in cloud storage. When you're ready, dump everything as a structured zip.

---

## Repository layout

```
crate/
├── dj-agent/        # Slack bot + Claude agent — runs on Google Cloud Run
└── crate-dl/        # Download microservice — runs on a DigitalOcean VPS
```

---

## How it works

### Full pipeline

```
User (Slack DM)
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  dj-agent  (Google Cloud Run)                       │
│                                                     │
│  1. DISCOVERY                                       │
│     searchSoundCloud → best SoundCloud URL          │
│     (fallback) searchYouTube → best YouTube URL     │
│                                                     │
│  2. DOWNLOAD  ──────────────────────────────────►   │
│     downloadTrack tool                              │
│     POST /download → crate-dl (VPS)                 │
│     ◄── { gcsKey: "temp/Artist-Song.mp3" }          │
│                                                     │
│  3. STASH                                           │
│     getFolders → pick genre folder                  │
│     stageFile → GCS copy: temp/ → {folder}/         │
│               → Firestore manifest entry            │
│                                                     │
│  4. RESPOND                                         │
│     claude final text → Slack chat.update           │
└─────────────────────────────────────────────────────┘
      │                          │
      │ POST /download           │ GCS copy
      ▼                          ▼
┌───────────────────┐    ┌──────────────────────────────┐
│  crate-dl  (VPS)  │    │  Google Cloud Storage        │
│                   │    │  bucket: dj-crate-stash      │
│  yt-dlp           │    │                              │
│  + Chrome cookies │───►│  temp/Artist-Song.mp3        │
│                   │    │    (written by crate-dl)      │
│  upload → GCS     │    │                              │
│  return gcsKey    │    │  {folder}/Artist-Song.mp3    │
└───────────────────┘    │    (moved by dj-agent)        │
                         │                              │
                         │  dumps/crate_dump_{ts}.zip   │
                         │    (written by dumpLibrary)  │
                         └──────────────────────────────┘
```

### Why two services?

Google Cloud Run uses datacenter IPs that YouTube aggressively blocks. `crate-dl` runs on a DigitalOcean droplet with a residential-style IP and a persistent Chromium session for cookie-based YouTube auth. `dj-agent` handles everything else — Slack, the Claude agent loop, Firestore, and GCS organization — and delegates only the download step to the VPS.

---

## dj-agent (Cloud Run)

**Tech:** Node.js + TypeScript, Slack Bolt, Anthropic Claude (`claude-haiku-4-5`), Firebase Admin, `@google-cloud/storage`

**Entry:** `src/app.ts` — Slack Bolt app. Every DM triggers `run()`.

**Agent loop** (`src/agent.ts`):
- Loads conversation history from Firestore
- Calls Claude with the full tool set in a loop (max 10 iterations)
- Updates the Slack message in-place at each tool step
- Persists history after responding

**Tools:**

| Tool | What it does |
|------|-------------|
| `searchSoundCloud` | Brave Search → real SoundCloud URLs via yt-dlp |
| `searchYouTube` | YouTube Data API — returns ranked candidates |
| `downloadTrack` | HTTP POST to `crate-dl`; returns `{ gcsKey, filename }` |
| `getFolders` | Lists genre folders from Firestore registry |
| `stageFile` | GCS server-side copy `temp/` → `{folder}/`; writes Firestore |
| `createFolder` | Adds a new folder to the registry |
| `dumpLibrary` | Zips all staged songs, uploads to GCS, returns signed URL; clears staging |

**GCS object lifecycle:**

```
temp/Artist-Song.mp3         ← written by crate-dl, short-lived (24h lifecycle rule)
{folder}/Artist-Song.mp3     ← written by stageFile (server-side copy from temp/)
dumps/crate_dump_{ts}.zip    ← written by dumpLibrary
```

**Folder taxonomy:** `EDM` · `Pop` · `Hip-Hop` · `Indian` · `Manual_Review`

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `SLACK_BOT_TOKEN` | Slack bot token |
| `SLACK_SIGNING_SECRET` | Slack signing secret |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account key |
| `GCP_ID` | GCP project ID |
| `CRATE_DL_URL` | Base URL of the crate-dl VPS, e.g. `http://1.2.3.4:4000` |
| `CRATE_DL_SECRET` | Shared bearer token (must match VPS) |
| `YT_DATA` | YouTube Data API key (for searchYouTube) |
| `BRAVE_SEARCH_KEY` | Brave Search API key (for searchSoundCloud) |
| `PORT` | Express port (default `3000`) |

---

## crate-dl (VPS — DigitalOcean)

**Tech:** Node.js + TypeScript, Express, yt-dlp binary, Playwright Chromium, `@google-cloud/storage`, PM2

**Entry:** `src/index.ts` — single Express route `POST /download`, protected by bearer token auth.

**Request body:**
```json
{
  "url": "https://soundcloud.com/...",
  "source": "soundcloud",
  "songName": "Calling My Phone",
  "artist": "Lil Tjay"
}
```

**Success response:**
```json
{
  "gcsKey": "temp/Lil_Tjay-Calling_My_Phone.mp3",
  "filename": "Lil_Tjay-Calling_My_Phone.mp3"
}
```

**Error response:**
```json
{
  "error": "yt-dlp timed out after 180s",
  "retriable": true
}
```

**Download fallback logic** (`src/downloader.ts`):

```
source = "soundcloud"
  1. yt-dlp SoundCloud URL — no cookies needed
  2. failure → yt-dlp ytsearch1:{artist} {song} with Chrome cookies
  3. both fail → return error

source = "youtube"
  1. yt-dlp with --cookies-from-browser chromium:{CHROME_PROFILE}
  2. auth error detected → return error (caller triggers reauth + retry)
  3. timeout → return error with retriable: true
```

**Session keepalive** (`src/keepalive.ts`): runs every 6 hours via PM2 cron, loads YouTube Music in a headless Chromium window using the persistent profile to keep cookies alive.

**Process management** (`ecosystem.config.js`): PM2 runs the Express server and keepalive as separate apps.

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `CRATE_DL_SECRET` | Shared bearer token (must match Cloud Run) |
| `PORT` | Express port (default `4000`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account key |
| `GCP_ID` | GCP project ID |
| `YTDLP_PATH` | Path to yt-dlp binary (default: `yt-dlp`) |
| `CHROME_USER_DATA_DIR` | Persistent Chromium profile directory |
| `DOWNLOAD_DIR` | Temp directory for in-progress downloads (default: `/tmp/crate_dl`) |
| `DOWNLOAD_TIMEOUT_MS` | yt-dlp timeout in ms (default: `180000`) |

---

## GCS bucket: `dj-crate-stash`

| Prefix | Written by | Lifecycle |
|--------|-----------|-----------|
| `temp/` | crate-dl | Auto-deleted after 24h (GCS lifecycle rule) |
| `{folder}/` | dj-agent `stageFile` | Permanent until `dumpLibrary` clears staging |
| `dumps/` | dj-agent `dumpLibrary` | Manual cleanup |

Set up the lifecycle rule once in the GCP Console or via `gcloud`:

```bash
gcloud storage buckets update gs://dj-crate-stash \
  --lifecycle-file=- <<'EOF'
{
  "rule": [{
    "action": { "type": "Delete" },
    "condition": { "age": 1, "matchesPrefix": ["temp/"] }
  }]
}
EOF
```

---

## Local development

### dj-agent

```bash
cd dj-agent
cp .env.example .env   # fill in secrets
npm install
npm run dev
```

Point `CRATE_DL_URL` at your VPS (or a locally running crate-dl instance for testing).

### crate-dl

```bash
cd crate-dl
cp .env.example .env   # fill in secrets
npm install
npx playwright install chromium   # install browser once
npm run dev
```

Test the endpoint:
```bash
curl -X POST http://localhost:4000/download \
  -H "Authorization: Bearer $CRATE_DL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/...","source":"soundcloud","songName":"Test","artist":"Artist"}'
```

### Deploy crate-dl to DigitalOcean

```bash
# On the droplet
git clone <repo> && cd crate/crate-dl
npm install && npm run build
cp .env.example .env   # fill in all values
npx playwright install chromium --with-deps
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

Open port 4000 only to Cloud Run egress IPs in the DigitalOcean firewall (Networking → Firewalls).
