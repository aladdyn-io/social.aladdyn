/**
 * JWT Authentication Middleware
 *
 * Validates Bearer tokens issued by server.aladdyn.
 * Attaches decoded user payload to req.user.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Development mode bypass for easy testing via local demo.html
  if (process.env.NODE_ENV !== 'production') {
    req.user = { id: 'dev-user-id', email: 'dev@aladdyn.com', role: 'admin' };
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET || 'fallback-secret';
  const isDevFallback =
    (process.env.NODE_ENV as string) === 'development' && secret === 'fallback-secret';

  try {
    const decoded = jwt.verify(token, secret) as any;
    // server.aladdyn JWT uses `userId` field; normalise to `id` for all services
    req.user = { ...decoded, id: decoded.id ?? decoded.userId ?? '' };
    next();
  } catch {
    if (isDevFallback) {
      const decoded = jwt.decode(token) as any;
      if (decoded && (decoded.id || decoded.userId)) {
        req.user = { ...decoded, id: decoded.id ?? decoded.userId ?? '' };
        next();
        return;
      }
    }
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * Validates x-internal-secret header for service-to-service calls.
 */
export function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-internal-secret'];
  const expected = process.env.INTERNAL_API_SECRET || 'aladdyn-internal-secret';

  if (!secret || secret !== expected) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  next();
}
