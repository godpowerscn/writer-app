import { Hono } from 'hono';
import type { AppBindings } from '../types';
import * as db from '../db';

const fonts = new Hono<AppBindings>();

fonts.get('/', async (c) => {
  const userId = c.get('userId');
  const list = await db.listFonts(c.env.DB, userId);
  const active = await db.getActiveFont(c.env.DB, userId);
  return c.json({ fonts: list, activeFontId: active?.id ?? null });
});

fonts.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.parseBody();
  const file = body['file'] as File | null;
  if (!file) return c.json({ error: 'No file uploaded' }, 400);

  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop()?.toLowerCase();
  const formatMap: Record<string, string> = { ttf: 'truetype', woff: 'woff', woff2: 'woff2', otf: 'opentype', eot: 'embedded-opentype' };
  const format = formatMap[ext ?? ''] || 'truetype';
  if (!['truetype', 'woff', 'woff2', 'opentype'].includes(format)) {
    return c.json({ error: 'Unsupported font format. Supported: .ttf, .otf, .woff, .woff2' }, 400);
  }

  if (file.size > 5 * 1024 * 1024) {
    return c.json({ error: 'Font file too large. Max 5MB' }, 400);
  }

  const existing = await db.listFonts(c.env.DB, userId);
  if (existing.length >= 10) {
    return c.json({ error: 'Maximum 10 fonts allowed. Delete one first.' }, 400);
  }

  const r2Key = `${userId}/${db.generateId()}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();

  await c.env.FONT_BUCKET.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  const font = await db.createFontRecord(c.env.DB, userId, name, format, r2Key, file.size);
  return c.json(font, 201);
});

fonts.get('/:id/file', async (c) => {
  const userId = c.get('userId');
  const font = await db.getFont(c.env.DB, c.req.param('id'), userId);
  if (!font) return c.json({ error: 'Font not found' }, 404);

  const obj = await c.env.FONT_BUCKET.get(font.r2_key);
  if (!obj) return c.json({ error: 'Font file not found' }, 404);

  const mimeMap: Record<string, string> = {
    truetype: 'font/ttf',
    opentype: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
  };
  const headers = new Headers({
    'Content-Type': mimeMap[font.format] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000',
    'Access-Control-Allow-Origin': '*',
  });
  return new Response(obj.body, { headers });
});

fonts.put('/:id/activate', async (c) => {
  const userId = c.get('userId');
  const fontId = c.req.param('id');
  const font = await db.getFont(c.env.DB, fontId, userId);
  if (!font) return c.json({ error: 'Font not found' }, 404);
  await db.setActiveFont(c.env.DB, userId, fontId);
  return c.json({ success: true });
});

fonts.delete('/active', async (c) => {
  const userId = c.get('userId');
  await db.setActiveFont(c.env.DB, userId, null);
  return c.json({ success: true });
});

fonts.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const font = await db.deleteFontRecord(c.env.DB, c.req.param('id'), userId);
  if (!font) return c.json({ error: 'Font not found' }, 404);

  try { await c.env.FONT_BUCKET.delete(font.r2_key); } catch {}

  await db.setActiveFont(c.env.DB, userId, null);
  return c.json({ success: true });
});

export default fonts;
