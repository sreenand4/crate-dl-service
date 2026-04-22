import 'dotenv/config';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';

const BUCKET_NAME = 'dj-crate-stash';
const TEMP_PREFIX = 'temp';

let _storage: Storage | null = null;

function getStorage(): Storage {
  if (_storage) return _storage;

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.GCP_ID;

  if (credPath) {
    const resolvedPath = path.isAbsolute(credPath)
      ? credPath
      : path.resolve(process.cwd(), credPath);
    _storage = new Storage({ keyFilename: resolvedPath, projectId });
  } else {
    _storage = new Storage({ projectId });
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
export async function uploadToTemp(localPath: string, filename: string): Promise<string> {
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
