import 'dotenv/config';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const BASE_DIR = process.env.DOWNLOAD_DIR || '/tmp/crate_dl';
const TIMEOUT_MS = parseInt(process.env.DOWNLOAD_TIMEOUT_MS || '180000', 10);
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

const HOME = process.env.HOME ?? os.homedir();
const CHROME_PROFILE = process.env.CHROME_USER_DATA_DIR || path.join(HOME, 'chrome-profile');

const EXEC_ENV = {
  ...process.env,
  PATH: [
    `${HOME}/.pyenv/shims`,
    `${HOME}/.pyenv/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    `${HOME}/.local/bin`,
    process.env.PATH ?? '',
  ].join(':'),
};

export interface DownloadInput {
  url: string;
  source: 'soundcloud' | 'youtube';
  songName: string;
  artist: string;
}

export interface DownloadSuccess {
  localPath: string;
  filename: string;
}

export interface DownloadError {
  error: string;
  retriable: boolean;
}

function sanitize(str: string): string {
  return str
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .slice(0, 60);
}

function execWithTimeout(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { timeout: TIMEOUT_MS, env: EXEC_ENV }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          reject(Object.assign(new Error(`Command timed out after ${TIMEOUT_MS / 1000}s`), { timedOut: true, stdout, stderr }));
        } else {
          reject(Object.assign(err, { stdout, stderr }));
        }
        return;
      }
      resolve({ stdout, stderr });
    });

    // Hard kill after timeout + 3s buffer
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, TIMEOUT_MS + 3000);
  });
}

export function isAuthError(stderr: string): boolean {
  const authPatterns = [
    /sign in to confirm you're not a bot/i,
    /this video is only available to music premium/i,
    /video unavailable/i,
    /HTTP Error 403/i,
    /requested format is not available/i,
    /join this channel/i,
    /cookies/i,
  ];
  return authPatterns.some(p => p.test(stderr));
}

function isTimeoutError(err: any): boolean {
  return err.timedOut === true || /timed out/i.test(err.message);
}

interface BuildOptions {
  playerClient?: string;
  cookiesFromBrowser?: string;
}

function buildArgs(url: string, outputTemplate: string, opts: BuildOptions = {}): string {
  const args = [
    YTDLP,
    '--extract-audio',
    '--audio-format mp3',
    '--audio-quality 320K',
    '--no-playlist',
    '--no-warnings',
  ];

  if (opts.playerClient) {
    args.push(`--extractor-args "youtube:player_client=${opts.playerClient}"`);
  }
  if (opts.cookiesFromBrowser) {
    args.push(`--cookies-from-browser "${opts.cookiesFromBrowser}"`);
  }

  args.push(`--output "${outputTemplate}"`);
  args.push(`"${url}"`);

  return args.join(' ');
}

async function execYtdlp(cmd: string, expectedPath: string, filename: string): Promise<DownloadSuccess | DownloadError> {
  console.log(`[downloader] yt-dlp cmd: ${cmd}`);

  try {
    const { stdout, stderr } = await execWithTimeout(cmd);
    if (stdout) console.log('[downloader] stdout:', stdout.slice(-500));
    if (stderr) console.log('[downloader] stderr:', stderr.slice(-300));
  } catch (err: any) {
    const stderr: string = err.stderr ?? '';
    console.error('[downloader] yt-dlp failed:', err.message);
    if (stderr) console.error('[downloader] stderr:', stderr.slice(-400));

    if (isTimeoutError(err)) {
      return { error: `yt-dlp timed out after ${TIMEOUT_MS / 1000}s`, retriable: true };
    }
    if (isAuthError(stderr)) {
      return { error: `YouTube auth error: ${err.message}`, retriable: false };
    }
    return { error: `yt-dlp failed: ${err.message}`, retriable: false };
  }

  if (!fs.existsSync(expectedPath)) {
    const nearby = fs.readdirSync(BASE_DIR).filter(f => f.startsWith(filename));
    console.error(`[downloader] Expected file not found: ${expectedPath}`);
    console.error('[downloader] Files with matching prefix:', nearby);
    return { error: `File not found after download: ${expectedPath}`, retriable: false };
  }

  const stats = fs.statSync(expectedPath);
  console.log(`[downloader] ✓ Download complete: ${expectedPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  return { localPath: expectedPath, filename: `${filename}.mp3` };
}

// Plan A: android client — bypasses n-sig JS challenge, no PO token on residential IP
// Plan B: android_vr — no PO token required at all, survives most YouTube backend changes
// Plan C: web_creator + Chrome cookies — signed-in browser session as last resort
// Timeouts short-circuit immediately (retriable: true) since client-switching won't help.
async function runYoutubeWithFallbacks(url: string, filename: string): Promise<DownloadSuccess | DownloadError> {
  const outputTemplate = path.join(BASE_DIR, `${filename}.%(ext)s`);
  const expectedPath = path.join(BASE_DIR, `${filename}.mp3`);

  console.log('[downloader] YouTube Plan A: android player client');
  const resultA = await execYtdlp(
    buildArgs(url, outputTemplate, { playerClient: 'android' }),
    expectedPath, filename,
  );
  if ('localPath' in resultA || resultA.retriable) return resultA;

  console.warn(`[downloader] Plan A failed (${resultA.error}) — trying Plan B: android_vr`);
  const resultB = await execYtdlp(
    buildArgs(url, outputTemplate, { playerClient: 'android_vr' }),
    expectedPath, filename,
  );
  if ('localPath' in resultB || resultB.retriable) return resultB;

  console.warn(`[downloader] Plan B failed (${resultB.error}) — trying Plan C: web_creator + Chrome cookies`);
  const resultC = await execYtdlp(
    buildArgs(url, outputTemplate, { playerClient: 'web_creator', cookiesFromBrowser: `chrome:${CHROME_PROFILE}` }),
    expectedPath, filename,
  );
  if ('localPath' in resultC) return resultC;

  return {
    error: `All YouTube strategies failed. A: ${resultA.error} | B: ${resultB.error} | C: ${resultC.error}`,
    retriable: false,
  };
}

export async function download(input: DownloadInput): Promise<DownloadSuccess | DownloadError> {
  const { url, source, songName, artist } = input;

  fs.mkdirSync(BASE_DIR, { recursive: true });

  const safeArtist = sanitize(artist);
  const safeSong = sanitize(songName);
  const filename = `${safeArtist}-${safeSong}`;

  console.log(`[downloader] Starting — source=${source}, file="${filename}.mp3"`);
  console.log(`[downloader] URL: ${url}`);

  if (source === 'soundcloud') {
    const outputTemplate = path.join(BASE_DIR, `${filename}.%(ext)s`);
    const expectedPath = path.join(BASE_DIR, `${filename}.mp3`);
    const result = await execYtdlp(buildArgs(url, outputTemplate), expectedPath, filename);
    if ('localPath' in result) return result;

    console.warn(`[downloader] SoundCloud failed (${result.error}), falling back to YouTube search`);
    const query = `ytsearch1:${artist} ${songName} official audio`;
    const fallback = await runYoutubeWithFallbacks(query, `${filename}_yt`);
    if ('localPath' in fallback) return fallback;

    return {
      error: `Both SoundCloud and YouTube fallback failed. SC: ${result.error}. YT: ${fallback.error}`,
      retriable: false,
    };
  }

  // source === 'youtube'
  return runYoutubeWithFallbacks(url, filename);
}
