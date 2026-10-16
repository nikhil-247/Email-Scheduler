import { Router } from 'express';
import passport from 'passport';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.get('/google', (req, res, next) => {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    res.status(503).json({ error: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.' });
    return;
  }
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })(req, res, next);
});

authRouter.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { failureRedirect: `${config.WEB_ORIGIN}/?auth=failed` }, (error: unknown, user: Express.User | false) => {
    if (error || !user) { res.redirect(`${config.WEB_ORIGIN}/?auth=failed`); return; }
    req.logIn(user, (loginError) => {
      if (loginError) { res.redirect(`${config.WEB_ORIGIN}/?auth=failed`); return; }
      res.redirect(`${config.WEB_ORIGIN}/dashboard`);
    });
  })(req, res, next);
});

authRouter.get('/me', (req, res) => {
  if (!req.isAuthenticated?.() || !req.user) { res.json({ user: null }); return; }
  const user = req.user as Express.User;
  res.json({ user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl } });
});

authRouter.post('/logout', requireAuth, (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    req.session.destroy((sessionError) => {
      if (sessionError) return next(sessionError);
      res.clearCookie('reachinbox.sid');
      res.status(204).end();
    });
  });
});
