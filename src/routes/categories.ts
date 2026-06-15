import { Hono } from 'hono';
import type { Env, CreateCategoryInput } from '../types';
import * as db from '../db';

const categories = new Hono<{ Bindings: Env }>();

// GET /api/categories
categories.get('/', async (c) => {
  const result = await db.listCategories(c.env.DB);
  return c.json(result);
});

// POST /api/categories
categories.post('/', async (c) => {
  const input: CreateCategoryInput = await c.req.json();
  const category = await db.createCategory(c.env.DB, input);
  return c.json(category, 201);
});

// PUT /api/categories/:id
categories.put('/:id', async (c) => {
  const input: Partial<CreateCategoryInput> = await c.req.json();
  const category = await db.updateCategory(c.env.DB, c.req.param('id'), input);
  if (!category) return c.json({ error: 'Category not found' }, 404);
  return c.json(category);
});

// DELETE /api/categories/:id
categories.delete('/:id', async (c) => {
  const deleted = await db.deleteCategory(c.env.DB, c.req.param('id'));
  if (!deleted) return c.json({ error: 'Category not found' }, 404);
  return c.json({ success: true });
});

export default categories;
