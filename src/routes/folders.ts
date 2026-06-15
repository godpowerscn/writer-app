import { Hono } from 'hono';
import type { AppBindings, CreateFolderInput } from '../types';
import * as db from '../db';

const folders = new Hono<AppBindings>();

folders.get('/', async (c) => {
  const userId = c.get('userId');
  const flat = await db.listFolders(c.env.DB, userId);
  const tree = db.buildFolderTree(flat);
  return c.json({ flat, tree });
});

folders.post('/', async (c) => {
  const userId = c.get('userId');
  const input: CreateFolderInput = await c.req.json();
  if (!input.name) return c.json({ error: 'Folder name is required' }, 400);
  const folder = await db.createFolder(c.env.DB, userId, input);
  return c.json(folder, 201);
});

folders.put('/:id', async (c) => {
  const userId = c.get('userId');
  const input: Partial<CreateFolderInput> = await c.req.json();
  const folder = await db.updateFolder(c.env.DB, c.req.param('id'), userId, input);
  if (!folder) return c.json({ error: 'Folder not found' }, 404);
  return c.json(folder);
});

folders.delete('/:id', async (c) => {
  const userId = c.get('userId');
  await db.deleteFolder(c.env.DB, c.req.param('id'), userId);
  return c.json({ success: true });
});

export default folders;
