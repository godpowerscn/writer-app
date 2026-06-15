import { Hono } from 'hono';
import type { AppBindings } from '../types';
import * as db from '../db';

const images = new Hono<AppBindings>();

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

images.get('/', async (c) => {
  const userId = c.get('userId');
  const list = await db.listImages(c.env.DB, userId);
  const origin = new URL(c.req.url).origin;
  const imagesWithUrl = list.map(img => ({
    ...img,
    url: `${origin}/api/images/${img.id}/file?token=${c.req.query('token') || ''}`,
  }));
  return c.json({ images: imagesWithUrl });
});

// Streaming upload — raw image bytes, no multipart overhead (matches font pattern)
images.post('/stream', async (c) => {
  const userId = c.get('userId');
  const rawName = c.req.header('X-Image-Name') || 'Untitled';
  const mimeType = c.req.header('X-Image-Mime') || 'image/png';
  const altText = c.req.header('X-Image-Alt') || '';
  const contentLength = parseInt(c.req.header('Content-Length') || '0', 10);

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return c.json({ error: 'Unsupported image format. Supported: JPEG, PNG, GIF, WebP, SVG, BMP, TIFF' }, 400);
  }

  if (contentLength > MAX_IMAGE_SIZE) {
    return c.json({ error: 'Image too large. Max 20MB' }, 400);
  }

  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const name = rawName.replace(/\.[^.]+$/, '');
  const r2Key = `images/${userId}/${db.generateId()}.${ext}`;

  await c.env.IMAGE_BUCKET.put(r2Key, c.req.raw.body, {
    httpMetadata: { contentType: mimeType },
  });

  const image = await db.createImageRecord(c.env.DB, userId, name, r2Key, contentLength, mimeType, altText);
  return c.json(image, 201);
});

// Standard multipart upload
images.post('/upload', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.parseBody();
  const file = body['file'] as File | null;
  if (!file) return c.json({ error: 'No file uploaded' }, 400);

  const mimeType = file.type || 'image/png';
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return c.json({ error: 'Unsupported image format' }, 400);
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return c.json({ error: 'Image too large. Max 20MB' }, 400);
  }

  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const name = file.name.replace(/\.[^.]+$/, '');
  const r2Key = `images/${userId}/${db.generateId()}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();

  await c.env.IMAGE_BUCKET.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: mimeType },
  });

  const image = await db.createImageRecord(c.env.DB, userId, name, r2Key, file.size, mimeType);
  return c.json(image, 201);
});

// Serve image file
images.get('/:id/file', async (c) => {
  const userId = c.get('userId');
  const image = await db.getImage(c.env.DB, c.req.param('id'), userId);
  if (!image) return c.json({ error: 'Image not found' }, 404);

  const obj = await c.env.IMAGE_BUCKET.get(image.r2_key);
  if (!obj) return c.json({ error: 'Image file not found' }, 404);

  const headers = new Headers({
    'Content-Type': image.mime_type,
    'Cache-Control': 'public, max-age=31536000',
    'Access-Control-Allow-Origin': '*',
  });
  return new Response(obj.body, { headers });
});

images.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const image = await db.deleteImageRecord(c.env.DB, c.req.param('id'), userId);
  if (!image) return c.json({ error: 'Image not found' }, 404);

  try { await c.env.IMAGE_BUCKET.delete(image.r2_key); } catch {}

  return c.json({ success: true });
});

export default images;
