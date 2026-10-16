import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { api, AppUser, API_URL } from './lib/api';
export default function App() {
  const [user, setUser] = useState<AppUser | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'failed') setError('Google sign-in did not complete. Please try again.');
    if (params.get('slack') === 'connected') window.history.replaceState({}, '', '/dashboard');
    void api<{ user: AppUser | null }>('/api/auth/me').then((result) => setUser(result.user)).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);
  async function logout() { try { await api('/api/auth/logout', { method: 'POST' }); } finally { setUser(null); } }
  if (loading) return <div className="loading-screen"><span className="brand-mark"><Mail size={20}/></span><LoaderCircle className="spin" size={20}/><p>Preparing your workspace…</p></div>;
  if (user) return <Dashboard user={user} onLogout={() => void logout()}/>;
  return <main className="login-layout">
    <section className="login-left"><a className="brand login-brand" href="/"><span className="brand-mark"><Mail size={18}/></span><span>reachinbox<span className="brand-period">.</span><small>OUTBOX LABS</small></span></a><div className="login-content"><div className="eyebrow"><span className="eyebrow-line"/>RELIABLE OUTREACH, SIMPLIFIED</div><h1>Good conversations<br/>start <span>on time.</span></h1><p className="login-lede">A calmer way to schedule, manage, and monitor your outbound email campaigns.</p><div className="login-feature"><span><CheckCircle2 size={17}/></span><div><strong>Set it. Schedule it.</strong><p>Plan every send with precise timing and per-sender limits.</p></div></div><div className="login-feature"><span><ShieldCheck size={17}/></span><div><strong>Built to be dependable</strong><p>Persistent queues and safe recovery help your work survive restarts.</p></div></div><div className="login-feature"><span><Sparkles size={17}/></span><div><strong>One place to stay in control</strong><p>See what is scheduled, sent, and needs attention.</p></div></div></div><div className="login-bottom"><span>© 2026 ReachInbox Scheduler</span><span>Made for thoughtful outreach</span></div></section>
    <section className="login-right"><div className="login-card"><div className="login-card-icon"><LockKeyhole size={22}/></div><span className="eyebrow">WELCOME BACK</span><h2>Sign in to your workspace</h2><p className="login-card-sub">Use your Google account to access your email scheduler.</p>{error && <div className="inline-error"><CircleAlert size={16}/>{error}</div>}<a className="google-button" href={`${API_URL}/api/auth/google`}><span className="google-g">G</span>Continue with Google <ArrowRight size={16}/></a><div className="secure-note"><LockKeyhole size={14}/>Secure sign-in powered by Google OAuth</div><div className="login-divider"><span/>YOUR OUTREACH, UNDER CONTROL<span/></div><div className="login-card-foot"><span className="tiny-dot"/>Your workspace is private to your account.</div></div><div className="login-right-footer">By continuing, you agree to use this demo responsibly.</div></section>
  </main>;
}
