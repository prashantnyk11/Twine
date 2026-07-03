import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';

interface SessionPayload extends JwtPayload {
  userId: number;
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Missing JWT_SECRET.');
  }
  return secret;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as SessionPayload;
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}