import type {
  Article, Category, Tag, Folder, Font, Image,
  CreateArticleInput, UpdateArticleInput, CreateCategoryInput, CreateTagInput, CreateFolderInput,
  User, RegisterInput,
} from './types';
import { hashPassword } from './auth';

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

// ─── Users ────────────────────────────────────────────────

export async function createUser(db: D1Database, input: RegisterInput): Promise<User> {
  const id = generateId();
  const now = new Date().toISOString();
  const password_hash = await hashPassword(input.password);
  await db
    .prepare('INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, input.username, input.email, password_hash, now, now)
    .run();
  return { id, username: input.username, email: input.email, created_at: now, updated_at: now };
}

export async function getUserByEmail(db: D1Database, email: string): Promise<(User & { password_hash: string }) | null> {
  return db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<any>();
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  return db
    .prepare('SELECT id, username, email, created_at, updated_at FROM users WHERE id = ?')
    .bind(id)
    .first<any>();
}

// ─── Folders ──────────────────────────────────────────────

export async function listFolders(db: D1Database, userId: string): Promise<Folder[]> {
  const rows = await db
    .prepare(`
      SELECT f.*, COUNT(a.id) as article_count
      FROM folders f
      LEFT JOIN articles a ON f.id = a.folder_id AND a.user_id = ?
      WHERE f.user_id = ?
      GROUP BY f.id
      ORDER BY f.sort_order ASC, f.name ASC
    `)
    .bind(userId, userId)
    .all();
  return (rows.results ?? []) as unknown as Folder[];
}

export function buildFolderTree(folders: Folder[]): Folder[] {
  const map = new Map<string, Folder>();
  const roots: Folder[] = [];
  for (const f of folders) {
    map.set(f.id, { ...f, children: [] });
  }
  for (const f of map.values()) {
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id)!.children!.push(f);
    } else {
      roots.push(f);
    }
  }
  return roots;
}

export async function createFolder(db: D1Database, userId: string, input: CreateFolderInput): Promise<Folder> {
  const id = generateId();
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO folders (id, name, parent_id, user_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, input.name, input.parent_id ?? null, userId, input.sort_order ?? 0, now, now)
    .run();
  return { id, name: input.name, parent_id: input.parent_id ?? null, user_id: userId, sort_order: input.sort_order ?? 0, created_at: now, updated_at: now };
}

export async function updateFolder(db: D1Database, id: string, userId: string, input: Partial<CreateFolderInput>): Promise<Folder | null> {
  const existing = await db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').bind(id, userId).first<Folder>();
  if (!existing) return null;
  const name = input.name ?? existing.name;
  const parent_id = input.parent_id !== undefined ? input.parent_id : existing.parent_id;
  const sort_order = input.sort_order ?? existing.sort_order;
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE folders SET name = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
    .bind(name, parent_id, sort_order, now, id)
    .run();
  return { ...existing, name, parent_id, sort_order, updated_at: now };
}

export async function deleteFolder(db: D1Database, id: string, userId: string): Promise<boolean> {
  await db.prepare('UPDATE articles SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').bind(id, userId).run();
  await db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return true;
}

// ─── Articles ──────────────────────────────────────────────

export async function listArticles(
  db: D1Database,
  userId: string,
  options: { status?: string; categoryId?: string; folderId?: string; tagId?: string; page?: number; pageSize?: number; search?: string } = {}
): Promise<{ data: any[]; total: number; page: number; pageSize: number }> {
  const page = options.page ?? 1;
  const pageSize = Math.min(options.pageSize ?? 20, 100);
  const offset = (page - 1) * pageSize;
  const conditions: string[] = ['a.user_id = ?'];
  const params: any[] = [userId];
  if (options.status) { conditions.push('a.status = ?'); params.push(options.status); }
  if (options.categoryId) { conditions.push('a.category_id = ?'); params.push(options.categoryId); }
  if (options.folderId) { conditions.push('a.folder_id = ?'); params.push(options.folderId); }
  if (options.tagId) {
    conditions.push('a.id IN (SELECT at.article_id FROM article_tags at WHERE at.tag_id = ?)');
    params.push(options.tagId);
  }
  if (options.search) {
    conditions.push('(a.title LIKE ? OR a.content LIKE ? OR a.id IN (SELECT at2.article_id FROM article_tags at2 JOIN tags t2 ON at2.tag_id = t2.id WHERE t2.name LIKE ?))');
    const term = `%${options.search}%`;
    params.push(term, term, term);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await db.prepare(`SELECT COUNT(*) as total FROM articles a ${where}`).bind(...params).first<{ total: number }>();
  const total = countResult?.total ?? 0;
  const rows = await db
    .prepare(`SELECT a.*, c.name as category_name, c.color as category_color, f.name as folder_name FROM articles a LEFT JOIN categories c ON a.category_id = c.id LEFT JOIN folders f ON a.folder_id = f.id ${where} ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, pageSize, offset)
    .all();
  const articles = await Promise.all(
    (rows.results ?? []).map(async (row: any) => {
      const tags = await db.prepare(`SELECT t.id, t.name, t.slug FROM tags t JOIN article_tags at ON t.id = at.tag_id WHERE at.article_id = ?`).bind(row.id).all();
      return { ...row, tags: tags.results ?? [] };
    })
  );
  return { data: articles, total, page, pageSize };
}

export async function getArticle(db: D1Database, id: string, userId: string): Promise<Article | null> {
  const article = await db
    .prepare(`SELECT a.*, c.name as category_name, c.color as category_color FROM articles a LEFT JOIN categories c ON a.category_id = c.id WHERE a.id = ? AND a.user_id = ?`)
    .bind(id, userId)
    .first<any>();
  if (!article) return null;
  const tags = await db.prepare(`SELECT t.id, t.name, t.slug FROM tags t JOIN article_tags at ON t.id = at.tag_id WHERE at.article_id = ?`).bind(id).all();
  return { ...article, tags: tags.results ?? [] };
}

export async function createArticle(db: D1Database, userId: string, input: CreateArticleInput): Promise<Article> {
  const id = generateId();
  const now = new Date().toISOString();
  const status = input.status ?? 'draft';
  await db
    .prepare(`INSERT INTO articles (id, title, content, status, category_id, folder_id, user_id, sort_order, created_at, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.title ?? '', input.content ?? '', status, input.category_id ?? null, input.folder_id ?? null, userId, 0, now, now, status === 'published' ? now : null)
    .run();
  if (input.tag_ids?.length) {
    const stmt = db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)');
    for (const tagId of input.tag_ids) await stmt.bind(id, tagId).run();
  }
  return (await getArticle(db, id, userId))!;
}

export async function updateArticle(db: D1Database, userId: string, id: string, input: UpdateArticleInput): Promise<Article | null> {
  const existing = await getArticle(db, id, userId);
  if (!existing) return null;
  const fields: string[] = [];
  const params: any[] = [];
  if (input.title !== undefined) { fields.push('title = ?'); params.push(input.title); }
  if (input.content !== undefined) { fields.push('content = ?'); params.push(input.content); }
  if (input.excerpt !== undefined) { fields.push('excerpt = ?'); params.push(input.excerpt); }
  if (input.category_id !== undefined) { fields.push('category_id = ?'); params.push(input.category_id); }
  if (input.folder_id !== undefined) { fields.push('folder_id = ?'); params.push(input.folder_id); }
  if (input.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(input.sort_order); }
  if (input.status !== undefined) {
    fields.push('status = ?'); params.push(input.status);
    if (input.status === 'published' && existing.status !== 'published') { fields.push('published_at = ?'); params.push(new Date().toISOString()); }
    if (input.status === 'draft') fields.push('published_at = NULL');
  }
  if (!fields.length) return existing;
  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  await db.prepare(`UPDATE articles SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params, userId).run();
  if (input.tag_ids !== undefined) {
    await db.prepare('DELETE FROM article_tags WHERE article_id = ?').bind(id).run();
    if (input.tag_ids.length) {
      const stmt = db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)');
      for (const tagId of input.tag_ids) await stmt.bind(id, tagId).run();
    }
  }
  return getArticle(db, id, userId);
}

export async function deleteArticle(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM articles WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return result.meta.changes > 0;
}

// ─── Reorder ──────────────────────────────────────────────

export async function reorderFolders(db: D1Database, userId: string, items: { id: string; sort_order: number; parent_id?: string | null }[]): Promise<void> {
  const stmt = db.prepare('UPDATE folders SET sort_order = ?, parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?');
  const now = new Date().toISOString();
  for (const item of items) {
    await stmt.bind(item.sort_order, item.parent_id ?? null, now, item.id, userId).run();
  }
}

export async function reorderArticles(db: D1Database, userId: string, items: { id: string; sort_order: number; folder_id?: string | null }[]): Promise<void> {
  const stmt = db.prepare('UPDATE articles SET sort_order = ?, folder_id = ?, updated_at = ? WHERE id = ? AND user_id = ?');
  const now = new Date().toISOString();
  for (const item of items) {
    await stmt.bind(item.sort_order, item.folder_id ?? null, now, item.id, userId).run();
  }
}

// ─── Categories ────────────────────────────────────────────

export async function listCategories(db: D1Database): Promise<Category[]> {
  const rows = await db.prepare(`SELECT c.*, COUNT(a.id) as article_count FROM categories c LEFT JOIN articles a ON c.id = a.category_id GROUP BY c.id ORDER BY c.name ASC`).all();
  return (rows.results ?? []) as unknown as Category[];
}

export async function createCategory(db: D1Database, input: CreateCategoryInput): Promise<Category> {
  const id = generateId();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO categories (id, name, slug, description, color, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(id, input.name, input.slug, input.description ?? '', input.color ?? '#6b7280', now).run();
  return { id, name: input.name, slug: input.slug, description: input.description ?? '', color: input.color ?? '#6b7280', created_at: now };
}

export async function updateCategory(db: D1Database, id: string, input: Partial<CreateCategoryInput>): Promise<Category | null> {
  const existing = await db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<Category>();
  if (!existing) return null;
  const name = input.name ?? existing.name;
  const slug = input.slug ?? existing.slug;
  const description = input.description ?? existing.description;
  const color = input.color ?? existing.color;
  await db.prepare('UPDATE categories SET name = ?, slug = ?, description = ?, color = ? WHERE id = ?').bind(name, slug, description, color, id).run();
  return { ...existing, name, slug, description, color };
}

export async function deleteCategory(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

// ─── Tags ──────────────────────────────────────────────────

export async function listTags(db: D1Database): Promise<Tag[]> {
  const rows = await db.prepare(`SELECT t.*, COUNT(at.article_id) as article_count FROM tags t LEFT JOIN article_tags at ON t.id = at.tag_id GROUP BY t.id ORDER BY t.name ASC`).all();
  return (rows.results ?? []) as unknown as Tag[];
}

export async function createTag(db: D1Database, input: CreateTagInput): Promise<Tag> {
  const id = generateId();
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO tags (id, name, slug, created_at) VALUES (?, ?, ?, ?)').bind(id, input.name, input.slug, now).run();
  return { id, name: input.name, slug: input.slug, created_at: now };
}

export async function deleteTag(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

// ─── Fonts ────────────────────────────────────────────────

export async function createFontRecord(db: D1Database, userId: string, name: string, format: string, r2Key: string, fileSize: number): Promise<Font> {
  const id = generateId();
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO fonts (id, user_id, name, format, r2_key, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, name, format, r2Key, fileSize, now)
    .run();
  return { id, user_id: userId, name, format, r2_key: r2Key, file_size: fileSize, created_at: now };
}

export async function listFonts(db: D1Database, userId: string): Promise<Font[]> {
  const rows = await db
    .prepare('SELECT * FROM fonts WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all();
  return (rows.results ?? []) as unknown as Font[];
}

export async function getFont(db: D1Database, id: string, userId: string): Promise<Font | null> {
  return db
    .prepare('SELECT * FROM fonts WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<Font>();
}

export async function deleteFontRecord(db: D1Database, id: string, userId: string): Promise<Font | null> {
  const font = await getFont(db, id, userId);
  if (!font) return null;
  await db.prepare('DELETE FROM fonts WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return font;
}

export async function setActiveFont(db: D1Database, userId: string, fontId: string | null): Promise<void> {
  await db.prepare('UPDATE fonts SET is_active = 0 WHERE user_id = ?').bind(userId).run();
  if (fontId) {
    await db.prepare('UPDATE fonts SET is_active = 1 WHERE id = ? AND user_id = ?').bind(fontId, userId).run();
  }
}

export async function getActiveFont(db: D1Database, userId: string): Promise<Font | null> {
  return db
    .prepare('SELECT * FROM fonts WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .bind(userId)
    .first<Font>();
}

// ─── Images ──────────────────────────────────────────────

export async function createImageRecord(
  db: D1Database,
  userId: string,
  name: string,
  r2Key: string,
  fileSize: number,
  mimeType: string,
  altText?: string
): Promise<Image> {
  const id = generateId();
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO images (id, user_id, name, alt_text, r2_key, file_size, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, name, altText ?? '', r2Key, fileSize, mimeType, now)
    .run();
  return { id, user_id: userId, name, alt_text: altText ?? '', r2_key: r2Key, file_size: fileSize, mime_type: mimeType, created_at: now };
}

export async function listImages(db: D1Database, userId: string): Promise<Image[]> {
  const rows = await db
    .prepare('SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all();
  return (rows.results ?? []) as unknown as Image[];
}

export async function getImage(db: D1Database, id: string, userId: string): Promise<Image | null> {
  return db
    .prepare('SELECT * FROM images WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<Image>();
}

export async function deleteImageRecord(db: D1Database, id: string, userId: string): Promise<Image | null> {
  const image = await getImage(db, id, userId);
  if (!image) return null;
  await db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return image;
}
