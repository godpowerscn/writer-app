import { Hono } from 'hono';
import type { Env, CreateTagInput } from '../types';
import * as db from '../db';

const tags = new Hono<{ Bindings: Env }>();

// GET /api/tags
tags.get('/', async (c) => {
  const result = await db.listTags(c.env.DB);
  return c.json(result);
});

// POST /api/tags
tags.post('/', async (c) => {
  const input: CreateTagInput = await c.req.json();
  const tag = await db.createTag(c.env.DB, input);
  return c.json(tag, 201);
});

// DELETE /api/tags/:id
tags.delete('/:id', async (c) => {
  const deleted = await db.deleteTag(c.env.DB, c.req.param('id'));
  if (!deleted) return c.json({ error: 'Tag not found' }, 404);
  return c.json({ success: true });
});

export default tags;
