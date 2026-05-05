"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAuthError = isAuthError;
exports.download = download;
require("dotenv/config");
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const BASE_DIR = process.env.DOWNLOAD_DIR || '/tmp/crate_dl';
const TIMEOUT_MS = parseInt(process.env.DOWNLOAD_TIMEOUT_MS || '180000', 10);
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const CHROME_PROFILE = process.env.CHROME_USER_DATA_DIR || path.join(os.homedir(), 'chrome-profile');
const HOME = process.env.HOME ?? os.homedir();
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
function sanitize(str) {
    return str
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_\-]/g, '')
        .slice(0, 60);
}
function execWithTimeout(cmd) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.exec)(cmd, { timeout: TIMEOUT_MS, env: EXEC_ENV }, (err, stdout, stderr) => {
            if (err) {
                if (err.killed) {
                    reject(Object.assign(new Error(`Command timed out after ${TIMEOUT_MS / 1000}s`), { timedOut: true, stdout, stderr }));
                }
                else {
                    reject(Object.assign(err, { stdout, stderr }));
                }
                return;
            }
            resolve({ stdout, stderr });
        });
        // Hard kill after timeout + 3s buffer
        setTimeout(() => {
            try {
                child.kill('SIGKILL');
            }
            catch { }
        }, TIMEOUT_MS + 3000);
    });
}
/**
 * Check if a yt-dlp error looks like a YouTube bot/auth rejection.
 * We use this to decide whether to trigger reauth before retrying.
 */
function isAuthError(stderr) {
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
function isTimeoutError(err) {
    return err.timedOut === true || /timed out/i.test(err.message);
}
function buildYtdlpArgs(url, outputTemplate, useChromeCookies) {
    const args = [
        YTDLP,
        '--extract-audio',
        '--audio-format mp3',
        '--audio-quality 320K',
        '--no-playlist',
        '--no-warnings',
    ];
    if (useChromeCookies) {
        args.push(`--cookies-from-browser "chrome:${CHROME_PROFILE}"`);
        args.push('--extractor-args "youtube:player_client=ios"');
    }
    args.push(`--output "${outputTemplate}"`);
    args.push(`"${url}"`);
    return args.join(' ');
}
async function runYtdlp(url, filename, useChromeCookies) {
    const outputTemplate = path.join(BASE_DIR, `${filename}.%(ext)s`);
    const expectedPath = path.join(BASE_DIR, `${filename}.mp3`);
    const cmd = buildYtdlpArgs(url, outputTemplate, useChromeCookies);
    console.log(`[downloader] yt-dlp cmd: ${cmd}`);
    try {
        const { stdout, stderr } = await execWithTimeout(cmd);
        if (stdout)
            console.log('[downloader] stdout:', stdout.slice(-500));
        if (stderr)
            console.log('[downloader] stderr:', stderr.slice(-300));
    }
    catch (err) {
        const stderr = err.stderr ?? '';
        console.error('[downloader] yt-dlp failed:', err.message);
        if (stderr)
            console.error('[downloader] stderr:', stderr.slice(-400));
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
/**
 * Try a YouTube search fallback using yt-dlp's ytsearch1: prefix.
 * Used when SoundCloud fails and source was soundcloud.
 */
async function youtubeSearchFallback(songName, artist, filename) {
    const query = `ytsearch1:${artist} ${songName} official audio`;
    console.log(`[downloader] SoundCloud failed — trying YouTube search fallback: "${query}"`);
    return runYtdlp(query, filename, true);
}
/**
 * Main entry point — implements SoundCloud-first download with fallback logic.
 *
 * SoundCloud:
 *   1. Try SoundCloud via yt-dlp (no cookies)
 *   2. On failure → YouTube search fallback (with cookies)
 *   3. Both fail → error
 *
 * YouTube:
 *   1. Try YouTube with --cookies-from-browser chromium
 *   2. On auth error → caller should trigger reauth and retry (retriable: false, isAuthError hint)
 *   3. On timeout → error with retriable: true
 */
async function download(input) {
    const { url, source, songName, artist } = input;
    fs.mkdirSync(BASE_DIR, { recursive: true });
    const safeArtist = sanitize(artist);
    const safeSong = sanitize(songName);
    const filename = `${safeArtist}-${safeSong}`;
    console.log(`[downloader] Starting — source=${source}, file="${filename}.mp3"`);
    console.log(`[downloader] URL: ${url}`);
    if (source === 'soundcloud') {
        const result = await runYtdlp(url, filename, false);
        if ('localPath' in result)
            return result;
        // SoundCloud failed — try YouTube search fallback
        console.warn(`[downloader] SoundCloud failed (${result.error}), falling back to YouTube search`);
        const fallback = await youtubeSearchFallback(songName, artist, `${filename}_yt`);
        if ('localPath' in fallback)
            return fallback;
        return {
            error: `Both SoundCloud and YouTube fallback failed. SC: ${result.error}. YT: ${fallback.error}`,
            retriable: false,
        };
    }
    // source === 'youtube'
    return runYtdlp(url, filename, true);
}
