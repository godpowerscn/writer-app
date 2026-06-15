import { Hono } from 'hono';
import type { AppBindings, CreateArticleInput, UpdateArticleInput } from '../types';
import * as db from '../db';

const articles = new Hono<AppBindings>();

articles.get('/', async (c) => {
  const userId = c.get('userId');
  const { status, categoryId, folderId, page, pageSize, search } = c.req.query();
  const result = await db.listArticles(c.env.DB, userId, {
    status,
    categoryId,
    folderId,
    page: page ? parseInt(page) : 1,
    pageSize: pageSize ? parseInt(pageSize) : 20,
    search,
  });
  return c.json(result);
});

articles.post('/', async (c) => {
  const userId = c.get('userId');
  const input: CreateArticleInput = await c.req.json();
  const article = await db.createArticle(c.env.DB, userId, input);
  return c.json(article, 201);
});

articles.get('/:id', async (c) => {
  const userId = c.get('userId');
  const article = await db.getArticle(c.env.DB, c.req.param('id'), userId);
  if (!article) return c.json({ error: 'Article not found' }, 404);
  return c.json(article);
});

articles.put('/:id', async (c) => {
  const userId = c.get('userId');
  const input: UpdateArticleInput = await c.req.json();
  const article = await db.updateArticle(c.env.DB, userId, c.req.param('id'), input);
  if (!article) return c.json({ error: 'Article not found' }, 404);
  return c.json(article);
});

articles.post('/reorder', async (c) => {
  const userId = c.get('userId');
  const { items } = await c.req.json<{ items: { id: string; sort_order: number; folder_id?: string | null }[] }>();
  if (!items?.length) return c.json({ success: true });
  await db.reorderArticles(c.env.DB, userId, items);
  return c.json({ success: true });
});

articles.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const deleted = await db.deleteArticle(c.env.DB, userId, c.req.param('id'));
  if (!deleted) return c.json({ error: 'Article not found' }, 404);
  return c.json({ success: true });
});

export default articles;
