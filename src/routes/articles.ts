import { Hono } from 'hono';
import type { Env, CreateArticleInput, UpdateArticleInput } from '../types';
import * as db from '../db';

const articles = new Hono<{ Bindings: Env }>();

// GET /api/articles — list with pagination & filters
articles.get('/', async (c) => {
  const { status, categoryId, page, pageSize, search } = c.req.query();
  const result = await db.listArticles(c.env.DB, {
    status,
    categoryId,
    page: page ? parseInt(page) : 1,
    pageSize: pageSize ? parseInt(pageSize) : 20,
    search,
  });
  return c.json(result);
});

// POST /api/articles — create
articles.post('/', async (c) => {
  const input: CreateArticleInput = await c.req.json();
  const article = await db.createArticle(c.env.DB, input);
  return c.json(article, 201);
});

// GET /api/articles/:id — get single
articles.get('/:id', async (c) => {
  const article = await db.getArticle(c.env.DB, c.req.param('id'));
  if (!article) return c.json({ error: 'Article not found' }, 404);
  return c.json(article);
});

// PUT /api/articles/:id — update
articles.put('/:id', async (c) => {
  const input: UpdateArticleInput = await c.req.json();
  const article = await db.updateArticle(c.env.DB, c.req.param('id'), input);
  if (!article) return c.json({ error: 'Article not found' }, 404);
  return c.json(article);
});

// DELETE /api/articles/:id — delete
articles.delete('/:id', async (c) => {
  const deleted = await db.deleteArticle(c.env.DB, c.req.param('id'));
  if (!deleted) return c.json({ error: 'Article not found' }, 404);
  return c.json({ success: true });
});

export default articles;
