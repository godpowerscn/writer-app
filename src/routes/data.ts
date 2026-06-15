import { Hono } from 'hono';
import type { AppBindings, Article, Category, Tag, Folder, Image, Font } from '../types';

const data = new Hono<AppBindings>();

data.get('/export', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const [categories, tags, folders, articlesRows, images, fonts] = await Promise.all([
    db.prepare('SELECT * FROM categories ORDER BY name ASC').all(),
    db.prepare('SELECT * FROM tags ORDER BY name ASC').all(),
    db.prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order ASC, name ASC').bind(userId).all(),
    db.prepare(`SELECT a.*, c.name as category_name, c.color as category_color, f.name as folder_name
      FROM articles a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN folders f ON a.folder_id = f.id
      WHERE a.user_id = ?
      ORDER BY a.updated_at DESC`).bind(userId).all(),
    db.prepare('SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC').bind(userId).all(),
    db.prepare('SELECT * FROM fonts WHERE user_id = ? ORDER BY created_at DESC').bind(userId).all(),
  ]);

  // For each article, get its tags and article_tags
  const articleRows = (articlesRows.results ?? []) as any[];
  const articles = await Promise.all(articleRows.map(async (row) => {
    const tagsRes = await db.prepare(
      'SELECT t.id, t.name, t.slug FROM tags t JOIN article_tags at ON t.id = at.tag_id WHERE at.article_id = ?'
    ).bind(row.id).all();
    return { ...row, tags: tagsRes.results ?? [] };
  }));

  // Build article_tags join table
  const articleTagsRes = await db.prepare(
    'SELECT at.article_id, at.tag_id FROM article_tags at JOIN articles a ON at.article_id = a.id WHERE a.user_id = ?'
  ).bind(userId).all();
  const articleTags = articleTagsRes.results ?? [];

  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    categories: categories.results ?? [],
    tags: tags.results ?? [],
    folders: folders.results ?? [],
    articles,
    article_tags: articleTags,
    images: images.results ?? [],
    fonts: fonts.results ?? [],
  };

  const filename = `writer-app-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

data.post('/import', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  let body: any;

  const contentType = c.req.header('Content-Type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.parseBody();
    const file = formData['file'] as File;
    if (!file) return c.json({ error: 'No file uploaded' }, 400);
    const text = await file.text();
    try { body = JSON.parse(text); } catch { return c.json({ error: 'Invalid JSON file' }, 400); }
  } else {
    body = await c.req.json();
  }

  if (!body || !body.version) {
    return c.json({ error: 'Invalid backup file format' }, 400);
  }

  const stats = { categories: 0, tags: 0, folders: 0, articles: 0, articleTags: 0, images: 0, fonts: 0 };

  // Clear existing user data (in reverse dependency order)
  await db.batch([
    db.prepare('DELETE FROM article_tags WHERE article_id IN (SELECT id FROM articles WHERE user_id = ?)').bind(userId),
    db.prepare('DELETE FROM articles WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM folders WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM images WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM fonts WHERE user_id = ?').bind(userId),
  ]);

  // Import categories
  if (body.categories?.length) {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO categories (id, name, slug, description, color, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const batch = body.categories.map((cat: any) =>
      stmt.bind(cat.id, cat.name, cat.slug, cat.description ?? '', cat.color ?? '#6b7280', cat.created_at)
    );
    await db.batch(batch);
    stats.categories = body.categories.length;
  }

  // Import tags
  if (body.tags?.length) {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO tags (id, name, slug, created_at) VALUES (?, ?, ?, ?)'
    );
    const batch = body.tags.map((tag: any) =>
      stmt.bind(tag.id, tag.name, tag.slug, tag.created_at)
    );
    await db.batch(batch);
    stats.tags = body.tags.length;
  }

  // Import folders (must preserve parent_id references)
  if (body.folders?.length) {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO folders (id, name, parent_id, user_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const batch = body.folders.map((f: any) =>
      stmt.bind(f.id, f.name, f.parent_id ?? null, userId, f.sort_order ?? 0, f.created_at, f.updated_at)
    );
    await db.batch(batch);
    stats.folders = body.folders.length;
  }

  // Import articles
  if (body.articles?.length) {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO articles (id, title, content, excerpt, status, category_id, folder_id, user_id, sort_order, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const batch = body.articles.map((a: any) =>
      stmt.bind(
        a.id, a.title ?? '', a.content ?? '', a.excerpt ?? '',
        a.status ?? 'draft', a.category_id ?? null, a.folder_id ?? null,
        userId, a.sort_order ?? 0, a.created_at, a.updated_at, a.published_at ?? null
      )
    );
    await db.batch(batch);
    stats.articles = body.articles.length;
  }

  // Import article_tags
  if (body.article_tags?.length) {
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)'
    );
    // Only import tags for articles that belong to this user
    const batch: any[] = [];
    for (const at of body.article_tags) {
      const belongs = body.articles?.some((a: any) => a.id === at.article_id);
      if (belongs) {
        batch.push(stmt.bind(at.article_id, at.tag_id));
      }
    }
    if (batch.length) {
      await db.batch(batch);
    }
    stats.articleTags = batch.length;
  }

  // Import images metadata
  if (body.images?.length) {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO images (id, user_id, name, alt_text, r2_key, file_size, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const batch = body.images.map((img: any) =>
      stmt.bind(img.id, userId, img.name, img.alt_text ?? '', img.r2_key, img.file_size ?? 0, img.mime_type ?? 'image/png', img.created_at)
    );
    await db.batch(batch);
    stats.images = body.images.length;
  }

  // Import fonts metadata
  // Skip fonts that reference deleted R2 objects — import metadata only
  if (body.fonts?.length) {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO fonts (id, user_id, name, format, r2_key, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const batch = body.fonts.map((f: any) =>
      stmt.bind(f.id, userId, f.name, f.format, f.r2_key, f.file_size ?? 0, f.created_at)
    );
    await db.batch(batch);
    stats.fonts = body.fonts.length;
  }

  return c.json({ success: true, stats });
});

export default data;
