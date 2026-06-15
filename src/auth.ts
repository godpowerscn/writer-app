import { SignJWT, jwtVerify } from 'jose';

const getJwtSecret = (env: { JWT_SECRET?: string }): Uint8Array => {
  const secret = env.JWT_SECRET || 'dev-secret-do-not-use-in-production';
  return new TextEncoder().encode(secret);
};

export function getTokenExpiry(): number {
  return Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days
}

export async function signToken(userId: string, env: { JWT_SECRET?: string }): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(getTokenExpiry())
    .sign(getJwtSecret(env));
}

export async function verifyToken(token: string, env: { JWT_SECRET?: string }): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(env));
    return payload.sub as string;
  } catch {
    return null;
  }
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number = 100000
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

function toBase64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}

function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveKey(password, salt);
  return `${toBase64(salt)}:${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;
  const salt = fromBase64(saltB64);
  const hash = await deriveKey(password, salt);
  return toBase64(hash) === hashB64;
}
