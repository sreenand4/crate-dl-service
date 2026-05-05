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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const fs = __importStar(require("fs"));
const downloader_1 = require("./downloader");
const gcs_1 = require("./gcs");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '4000', 10);
const SECRET = process.env.CRATE_DL_SECRET || '';
if (!SECRET) {
    console.error('[crate-dl] FATAL: CRATE_DL_SECRET is not set. Refusing to start.');
    process.exit(1);
}
app.use(express_1.default.json());
// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
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
app.post('/download', requireAuth, async (req, res) => {
    const { url, source, songName, artist } = req.body;
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
    const dlResult = await (0, downloader_1.download)({ url, source, songName, artist });
    if ('error' in dlResult) {
        console.error(`[crate-dl] Download failed: ${dlResult.error}`);
        res.status(502).json({ error: dlResult.error, retriable: dlResult.retriable });
        return;
    }
    const { localPath, filename } = dlResult;
    // Step 2: upload to GCS temp/
    let gcsKey;
    try {
        gcsKey = await (0, gcs_1.uploadToTemp)(localPath, filename);
    }
    catch (err) {
        console.error(`[crate-dl] GCS upload failed: ${err.message}`);
        // Best-effort cleanup
        fs.unlink(localPath, () => { });
        res.status(502).json({ error: `GCS upload failed: ${err.message}`, retriable: true });
        return;
    }
    // Step 3: clean up local temp file
    fs.unlink(localPath, (err) => {
        if (err)
            console.warn(`[crate-dl] Could not delete temp file ${localPath}:`, err.message);
    });
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[crate-dl] ✓ Done in ${elapsedSec}s — gcsKey=${gcsKey}`);
    res.json({ gcsKey, filename });
});
// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`[crate-dl] Listening on port ${PORT}`);
});
