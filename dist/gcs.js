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
exports.uploadToTemp = uploadToTemp;
require("dotenv/config");
const storage_1 = require("@google-cloud/storage");
const path = __importStar(require("path"));
const BUCKET_NAME = 'dj-crate-stash';
const TEMP_PREFIX = 'temp';
let _storage = null;
function getStorage() {
    if (_storage)
        return _storage;
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const projectId = process.env.GCP_ID;
    if (credPath) {
        const resolvedPath = path.isAbsolute(credPath)
            ? credPath
            : path.resolve(process.cwd(), credPath);
        _storage = new storage_1.Storage({ keyFilename: resolvedPath, projectId });
    }
    else {
        _storage = new storage_1.Storage({ projectId });
    }
    return _storage;
}
function getBucket() {
    return getStorage().bucket(BUCKET_NAME);
}
/**
 * Upload a local file to gs://dj-crate-stash/temp/{filename}.
 * Returns the GCS object key.
 */
async function uploadToTemp(localPath, filename) {
    const gcsKey = `${TEMP_PREFIX}/${filename}`;
    const bucket = getBucket();
    console.log(`[gcs] Uploading ${localPath} → gs://${BUCKET_NAME}/${gcsKey}`);
    await bucket.upload(localPath, {
        destination: gcsKey,
        metadata: { contentType: 'audio/mpeg' },
    });
    console.log(`[gcs] ✓ Uploaded to gs://${BUCKET_NAME}/${gcsKey}`);
    return gcsKey;
}
