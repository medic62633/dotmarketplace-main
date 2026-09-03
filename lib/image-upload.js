const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 4 * 1024 * 1024;
const LISTING_PREFIX = '/uploads/listings/';

function listingUploadDir(publicDir) {
  return path.join(publicDir, 'uploads', 'listings');
}

function ensureListingUploadDir(publicDir) {
  fs.mkdirSync(listingUploadDir(publicDir), { recursive: true });
}

/* #10 Sniff real image bytes — never trust the declared MIME alone. */
const MAGIC = [
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF....WEBP
];

function sniffExt(buf) {
  if (!buf || buf.length < 4) return null;
  for (const m of MAGIC) {
    if (m.bytes.every((b, i) => buf[i] === b)) {
      if (m.ext === 'webp' && buf.toString('ascii', 8, 12) !== 'WEBP') continue;
      return m.ext;
    }
  }
  return null;
}

function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/(jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new Error('invalid image');
  const buf = Buffer.from(match[3], 'base64');
  if (buf.length > MAX_BYTES) throw new Error('too large');
  const real = sniffExt(buf);
  if (!real) throw new Error('invalid image'); // bytes don't match a real image
  return { ext: real, buf };
}

const MAX_PER_USER = 20 * 1024 * 1024; // 20 MB of listing images per seller

/* #10 Per-user storage cap so one seller can't fill the disk. */
function userImageBytes(publicDir, prefix) {
  const dir = listingUploadDir(publicDir);
  let total = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (prefix && !f.startsWith(prefix)) continue;
      try { total += fs.statSync(path.join(dir, f)).size; } catch (_) {}
    }
  } catch (_) {}
  return total;
}

function saveListingImage(dataUrl, publicDir, ownerKey) {
  const { ext, buf } = parseImageDataUrl(dataUrl);
  const dir = listingUploadDir(publicDir);
  fs.mkdirSync(dir, { recursive: true });
  if (ownerKey) {
    const used = userImageBytes(publicDir, ownerKey + '-');
    if (used + buf.length > MAX_PER_USER) throw new Error('storage_limit');
  }
  const filename = (ownerKey ? ownerKey + '-' : '') + crypto.randomBytes(16).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, filename), buf);
  return LISTING_PREFIX + filename;
}

function isListingImageUrl(url) {
  return typeof url === 'string' && url.startsWith(LISTING_PREFIX) && !url.includes('..');
}

/** Best-effort removal of a previously saved listing image file. */
function deleteListingImageFile(url, publicDir) {
  if (!isListingImageUrl(url)) return;
  const filename = path.basename(url);
  const target = path.join(listingUploadDir(publicDir), filename);
  // Guard against path traversal — resolved path must stay inside the dir.
  if (!target.startsWith(listingUploadDir(publicDir) + path.sep)) return;
  fs.rm(target, { force: true }, () => {});
}

module.exports = {
  MAX_BYTES,
  LISTING_PREFIX,
  ensureListingUploadDir,
  parseImageDataUrl,
  saveListingImage,
  isListingImageUrl,
  deleteListingImageFile,
};
