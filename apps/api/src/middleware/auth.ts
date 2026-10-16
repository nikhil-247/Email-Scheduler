import type { NextFunction, Request, Response } from 'express';
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated?.() || !req.user) { res.status(401).json({ error: 'Authentication required. Sign in with Google first.' }); return; }
  next();
}
