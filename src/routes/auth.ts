import { Hono } from 'hono';
import type { AppBindings, RegisterInput, LoginInput } from '../types';
import * as db from '../db';
import { signToken, verifyPassword } from '../auth';

const auth = new Hono<AppBindings>();

// POST /api/auth/register
auth.post('/register', async (c) => {
  const { username, email, password }: RegisterInput = await c.req.json();

  if (!username || !email || !password) {
    return c.json({ error: 'Username, email, and password are required' }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Invalid email format' }, 400);
  }

  const existing = await db.getUserByEmail(c.env.DB, email);
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  const user = await db.createUser(c.env.DB, { username, email, password });
  const token = await signToken(user.id, c.env);

  return c.json({ user, token }, 201);
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  const { email, password }: LoginInput = await c.req.json();

  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  const user = await db.getUserByEmail(c.env.DB, email);
  if (!user) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const token = await signToken(user.id, c.env);
  const { password_hash, ...safeUser } = user;

  return c.json({ user: safeUser, token });
});

// GET /api/auth/me
auth.get('/me', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Not authenticated' }, 401);

  const user = await db.getUserById(c.env.DB, userId);
  if (!user) return c.json({ error: 'User not found' }, 404);

  return c.json({ user });
});

export default auth;
