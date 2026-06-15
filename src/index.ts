import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings } from './types';
import { verifyToken } from './auth';
import articles from './routes/articles';
import categories from './routes/categories';
import tags from './routes/tags';
import auth from './routes/auth';
import folders from './routes/folders';
import fonts from './routes/fonts';
import images from './routes/images';

const app = new Hono<AppBindings>();

app.use('/api/*', cors());

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/auth/register') {
    return next();
  }
  let token: string | null = null;
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    token = c.req.query('token') || null;
  }
  if (!token) {
    return c.json({ error: 'Authorization required' }, 401);
  }
  const userId = await verifyToken(token, c.env);
  if (!userId) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
  c.set('userId', userId);
  await next();
});

app.route('/api/auth', auth);
app.route('/api/articles', articles);
app.route('/api/categories', categories);
app.route('/api/tags', tags);
app.route('/api/folders', folders);
app.route('/api/fonts', fonts);
app.route('/api/images', images);

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.notFound((c) => {
  if (c.req.path.startsWith('/api')) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.notFound();
});

export default app;
