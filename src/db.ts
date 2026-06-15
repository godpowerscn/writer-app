import type { Article, Category, Tag, CreateArticleInput, UpdateArticleInput, CreateCategoryInput, CreateTagInput } from './types';

export function generateId(): string {
  return crypto.randomUUID();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

// ─── Articles ──────────────────────────────────────────────

export async function listArticles(
  db: D1Database,
  options: { status?: string; categoryId?: string; page?: number; pageSize?: number; search?: string } = {}
): Promise<{ data: any[]; total: number; page: number; pageSize: number }> {
  const page = options.page ?? 1;
  const pageSize = Math.min(options.pageSize ?? 20, 100);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: any[] = [];

  if (options.status) {
    conditions.push('a.status = ?');
    params.push(options.status);
  }
  if (options.categoryId) {
    conditions.push('a.category_id = ?');
    params.push(options.categoryId);
  }
  if (options.search) {
    conditions.push('(a.title LIKE ? OR a.content LIKE ?)');
    const term = `%${options.search}%`;
    params.push(term, term);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db
    .prepare(`SELECT COUNT(*) as total FROM articles a ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const total = countResult?.total ?? 0;

  const rows = await db
    .prepare(`
      SELECT
        a.*,
        c.name as category_name,
        c.color as category_color
      FROM articles a
      LEFT JOIN categories c ON a.category_id = c.id
      ${where}
      ORDER BY a.updated_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(...params, pageSize, offset)
    .all();

  // Attach tags to each article
  const articles = await Promise.all(
    (rows.results ?? []).map(async (row: any) => {
      const tags = await db
        .prepare(`
          SELECT t.id, t.name, t.slug
          FROM tags t
          JOIN article_tags at ON t.id = at.tag_id
          WHERE at.article_id = ?
        `)
        .bind(row.id)
        .all();
      return { ...row, tags: tags.results ?? [] };
    })
  );

  return { data: articles, total, page, pageSize };
}

export async function getArticle(db: D1Database, id: string): Promise<Article | null> {
  const article = await db
    .prepare(`
      SELECT a.*, c.name as category_name, c.color as category_color
      FROM articles a
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.id = ?
    `)
    .bind(id)
    .first<any>();

  if (!article) return null;

  const tags = await db
    .prepare(`
      SELECT t.id, t.name, t.slug
      FROM tags t
      JOIN article_tags at ON t.id = at.tag_id
      WHERE at.article_id = ?
    `)
    .bind(id)
    .all();

  return { ...article, tags: tags.results ?? [] };
}

export async function createArticle(db: D1Database, input: CreateArticleInput): Promise<Article> {
  const id = generateId();
  const now = new Date().toISOString();
  const status = input.status ?? 'draft';

  await db
    .prepare(`
      INSERT INTO articles (id, title, content, status, category_id, created_at, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      input.title ?? '',
      input.content ?? '',
      status,
      input.category_id ?? null,
      now,
      now,
      status === 'published' ? now : null
    )
    .run();

  // Attach tags
  if (input.tag_ids && input.tag_ids.length > 0) {
    const stmt = db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)');
    for (const tagId of input.tag_ids) {
      await stmt.bind(id, tagId).run();
    }
  }

  return (await getArticle(db, id))!;
}

export async function updateArticle(db: D1Database, id: string, input: UpdateArticleInput): Promise<Article | null> {
  const existing = await getArticle(db, id);
  if (!existing) return null;

  const fields: string[] = [];
  const params: any[] = [];

  if (input.title !== undefined) { fields.push('title = ?'); params.push(input.title); }
  if (input.content !== undefined) { fields.push('content = ?'); params.push(input.content); }
  if (input.excerpt !== undefined) { fields.push('excerpt = ?'); params.push(input.excerpt); }
  if (input.category_id !== undefined) { fields.push('category_id = ?'); params.push(input.category_id); }
  if (input.status !== undefined) {
    fields.push('status = ?');
    params.push(input.status);
    if (input.status === 'published' && existing.status !== 'published') {
      fields.push('published_at = ?');
      params.push(new Date().toISOString());
    }
    if (input.status === 'draft') {
      fields.push('published_at = NULL');
    }
  }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  await db
    .prepare(`UPDATE articles SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  // Update tags if provided
  if (input.tag_ids !== undefined) {
    await db.prepare('DELETE FROM article_tags WHERE article_id = ?').bind(id).run();
    if (input.tag_ids.length > 0) {
      const stmt = db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)');
      for (const tagId of input.tag_ids) {
        await stmt.bind(id, tagId).run();
      }
    }
  }

  return await getArticle(db, id);
}

export async function deleteArticle(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM articles WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

// ─── Categories ────────────────────────────────────────────

export async function listCategories(db: D1Database): Promise<Category[]> {
  const rows = await db
    .prepare(`
      SELECT c.*, COUNT(a.id) as article_count
      FROM categories c
      LEFT JOIN articles a ON c.id = a.category_id
      GROUP BY c.id
      ORDER BY c.name ASC
    `)
    .all();
  return (rows.results ?? []) as unknown as Category[];
}

export async function createCategory(db: D1Database, input: CreateCategoryInput): Promise<Category> {
  const id = generateId();
  const now = new Date().toISOString();
  await db
    .prepare(`
      INSERT INTO categories (id, name, slug, description, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(id, input.name, input.slug, input.description ?? '', input.color ?? '#6b7280', now)
    .run();
  return { id, name: input.name, slug: input.slug, description: input.description ?? '', color: input.color ?? '#6b7280', created_at: now };
}

export async function updateCategory(db: D1Database, id: string, input: Partial<CreateCategoryInput>): Promise<Category | null> {
  const existing = await db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<Category>();
  if (!existing) return null;

  const name = input.name ?? existing.name;
  const slug = input.slug ?? existing.slug;
  const description = input.description ?? existing.description;
  const color = input.color ?? existing.color;

  await db
    .prepare('UPDATE categories SET name = ?, slug = ?, description = ?, color = ? WHERE id = ?')
    .bind(name, slug, description, color, id)
    .run();

  return { ...existing, name, slug, description, color };
}

export async function deleteCategory(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

// ─── Tags ──────────────────────────────────────────────────

export async function listTags(db: D1Database): Promise<Tag[]> {
  const rows = await db
    .prepare(`
      SELECT t.*, COUNT(at.article_id) as article_count
      FROM tags t
      LEFT JOIN article_tags at ON t.id = at.tag_id
      GROUP BY t.id
      ORDER BY t.name ASC
    `)
    .all();
  return (rows.results ?? []) as unknown as Tag[];
}

export async function createTag(db: D1Database, input: CreateTagInput): Promise<Tag> {
  const id = generateId();
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO tags (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, input.name, input.slug, now)
    .run();
  return { id, name: input.name, slug: input.slug, created_at: now };
}

export async function deleteTag(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}
