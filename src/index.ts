import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import { download, DownloadInput } from './downloader';
import { uploadToTemp } from './gcs';

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);
const SECRET = process.env.CRATE_DL_SECRET || '';

if (!SECRET) {
  console.error('[crate-dl] FATAL: CRATE_DL_SECRET is not set. Refusing to start.');
  process.exit(1);
}

app.use(express.json());

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== SECRET) {
    console.warn(`[crate-dl] Unauthorized request from ${req.ip}`);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ── POST /download ────────────────────────────────────────────────────────────

app.post('/download', requireAuth, async (req: Request, res: Response) => {
  const { url, source, songName, artist } = req.body as Partial<DownloadInput>;

  if (!url || !source || !songName || !artist) {
    res.status(400).json({ error: 'Missing required fields: url, source, songName, artist' });
    return;
  }

  if (source !== 'soundcloud' && source !== 'youtube') {
    res.status(400).json({ error: 'source must be "soundcloud" or "youtube"' });
    return;
  }

  console.log(`\n[crate-dl] ── New request ──`);
  console.log(`[crate-dl] source=${source} artist="${artist}" song="${songName}"`);
  console.log(`[crate-dl] url=${url}`);

  const startMs = Date.now();

  // Step 1: download
  const dlResult = await download({ url, source, songName, artist });

  if ('error' in dlResult) {
    console.error(`[crate-dl] Download failed: ${dlResult.error}`);
    res.status(502).json({ error: dlResult.error, retriable: dlResult.retriable });
    return;
  }

  const { localPath, filename } = dlResult;

  // Step 2: upload to GCS temp/
  let gcsKey: string;
  try {
    gcsKey = await uploadToTemp(localPath, filename);
  } catch (err: any) {
    console.error(`[crate-dl] GCS upload failed: ${err.message}`);
    // Best-effort cleanup
    fs.unlink(localPath, () => {});
    res.status(502).json({ error: `GCS upload failed: ${err.message}`, retriable: true });
    return;
  }

  // Step 3: clean up local temp file
  fs.unlink(localPath, (err) => {
    if (err) console.warn(`[crate-dl] Could not delete temp file ${localPath}:`, err.message);
  });

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`[crate-dl] ✓ Done in ${elapsedSec}s — gcsKey=${gcsKey}`);

  res.json({ gcsKey, filename });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[crate-dl] Listening on port ${PORT}`);
});
