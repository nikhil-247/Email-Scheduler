import 'passport';

declare global {
  namespace Express {
    interface User {
      id: string;
      googleId: string;
      email: string;
      name: string;
      avatarUrl: string | null;
    }
  }
}
