// Uploaded contracts, campaign images and post screenshots, adapted from lovepop-idea-lab's
// server/lib/mediaStore.js. Stored under "<kind>/<file>" and addressed everywhere (DB rows, API)
// by the URL "/uploads/<kind>/<file>"; the frontend adds BASE_PATH when it renders one.
//   UPLOADS_S3_URI set (production, s3://prod-segment-model-store/ambassador/uploads/) → S3, read
//     back through the app (GET /uploads/...), so the bucket stays private.
//   otherwise → a local directory (UPLOADS_DIR, default data/uploads) for development.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const URL_PREFIX = '/uploads/';
export const UPLOAD_KINDS = ['contracts', 'campaigns', 'posts'];
// Uploads come from outside influencers, and the app shares an origin with every other
// admin.lovepop.com tool: only these types render inline, the rest download (so an uploaded
// .html or .svg can never run script there).
const INLINE_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.pdf': 'application/pdf',
};
const FILE_NAME = /^[0-9]+-[0-9a-f]{16}(\.[a-z0-9]{1,8})?$/;

/** '/uploads/posts/1-ab.png' → { kind: 'posts', key: 'posts/1-ab.png' }, or null for anything else. */
export function parseUploadUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(URL_PREFIX)) return null;
  const [kind, file, ...rest] = url.slice(URL_PREFIX.length).split('/');
  if (rest.length || !UPLOAD_KINDS.includes(kind) || !FILE_NAME.test(file || '')) return null;
  return { kind, key: `${kind}/${file}` };
}

/** A fresh, unguessable file name that keeps a safe form of the original extension. */
export function newFileName(originalName, now = Date.now()) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
  return `${now}-${crypto.randomBytes(8).toString('hex')}${safeExt}`;
}

/** Response headers for a stored file: inline for images/PDF, a download for anything else. */
export function responseHeaders(key, { isPrivate }) {
  const ext = path.extname(key);
  const inlineType = INLINE_TYPES[ext];
  return {
    'Content-Type': inlineType || 'application/octet-stream',
    'Content-Disposition': inlineType ? 'inline' : `attachment; filename="${path.basename(key)}"`,
    'X-Content-Type-Options': 'nosniff',
    // Contracts must never sit in CloudFront's cache, where the path alone would fetch them.
    'Cache-Control': isPrivate ? 'private, no-store' : 'public, max-age=31536000, immutable',
  };
}

function parseS3Uri(uri) {
  const match = /^s3:\/\/([^/]+)\/?(.*)$/.exec(uri);
  if (!match) throw new Error(`UPLOADS_S3_URI must look like s3://bucket/prefix/, got ${uri}`);
  const prefix = match[2] && !match[2].endsWith('/') ? `${match[2]}/` : match[2];
  return { bucket: match[1], prefix };
}

function s3Backend(uri, client) {
  const { bucket, prefix } = parseS3Uri(uri);
  return {
    kind: 's3',
    async put(key, body) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: prefix + key, Body: body }));
    },
    async read(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: prefix + key }));
        return Buffer.from(await out.Body.transformToByteArray());
      } catch (error) {
        if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
  };
}

function dirBackend(root) {
  return {
    kind: 'dir',
    async put(key, body) {
      const file = path.join(root, key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body);
    },
    async read(key) {
      try { return await fs.readFile(path.join(root, key)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
  };
}

export function createMediaStore({ s3Uri, dir, s3Client } = {}) {
  const backend = s3Uri ? s3Backend(s3Uri, s3Client || new S3Client({})) : dirBackend(dir);
  return {
    kind: backend.kind,
    /** Store an upload and return its '/uploads/<kind>/<file>' URL. */
    async save(kind, originalName, body) {
      if (!UPLOAD_KINDS.includes(kind)) throw new Error(`unknown upload kind ${kind}`);
      const url = `${URL_PREFIX}${kind}/${newFileName(originalName)}`;
      await backend.put(parseUploadUrl(url).key, body);
      return url;
    },
    /** The stored bytes for an upload key, or null when it does not exist. */
    read: (key) => backend.read(key),
  };
}

export function mediaStoreFromEnv(env = process.env) {
  return createMediaStore({
    s3Uri: env.UPLOADS_S3_URI,
    dir: env.UPLOADS_DIR || path.join(process.cwd(), 'data', 'uploads'),
  });
}
