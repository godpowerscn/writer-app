import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import articles from './routes/articles';
import categories from './routes/categories';
import tags from './routes/tags';

const app = new Hono<{ Bindings: Env }>();

// CORS for development
app.use('/api/*', cors());

// API Routes
app.route('/api/articles', articles);
app.route('/api/categories', categories);
app.route('/api/tags', tags);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 404 for unrecognized API routes
app.notFound((c) => {
  if (c.req.path.startsWith('/api')) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.notFound();
});

export default app;
