import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpRight, CheckCircle2, ChevronDown, Clock3, Inbox, LogOut, Mail, Plus, Search, Send, ShieldCheck, SlidersHorizontal, Sparkles, Unplug, X, XCircle } from 'lucide-react';
import { api, AppUser, EmailRecord, Sender } from '../lib/api';
import { ComposeModal } from '../components/ComposeModal';
type Props = { user: AppUser; onLogout: () => void }; type Tab = 'scheduled' | 'sent' | 'failed';
function formatDate(value: string | null) { if (!value) return '—'; return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
export function Dashboard({ user, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('scheduled'); const [items, setItems] = useState<EmailRecord[]>([]); const [senders, setSenders] = useState<Sender[]>([]); const [defaultSenderKey, setDefaultSenderKey] = useState('');
  const [search, setSearch] = useState(''); const [searchResults, setSearchResults] = useState<{ query: string; items: EmailRecord[] } | null>(null); const [searchLoading, setSearchLoading] = useState(false); const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false); const [error, setError] = useState(''); const [counts, setCounts] = useState({ scheduled: 0, sent: 0, failed: 0 }); const [slackConnected, setSlackConnected] = useState(false); const [slackBusy, setSlackBusy] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const status = tab === 'scheduled' ? 'scheduled' : tab === 'sent' ? 'sent' : 'failed';
      const [result, scheduledResult, sentResult, failedResult] = await Promise.all([
        api<{ items: EmailRecord[] }>('/api/emails?status=' + status + '&pageSize=100'), api<{ total: number }>('/api/emails?status=scheduled&pageSize=1'), api<{ total: number }>('/api/emails?status=sent&pageSize=1'), api<{ total: number }>('/api/emails?status=failed&pageSize=1'),
      ]);
      setItems(result.items); setCounts({ scheduled: scheduledResult.total, sent: sentResult.total, failed: failedResult.total });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load emails.'); } finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    void Promise.all([
      api<{ senders: Sender[]; defaultSenderKey: string }>('/api/emails/senders').then((r) => { setSenders(r.senders); setDefaultSenderKey(r.defaultSenderKey); }).catch((err) => setError(err.message)),
      api<{ connected: boolean }>('/api/integrations/slack/status').then((r) => setSlackConnected(r.connected)).catch(() => setSlackConnected(false)),
    ]);
  }, []);
  useEffect(() => {
    const query = search.trim();
    if (!query) { setSearchLoading(false); setSearchResults(null); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      api<{ items: EmailRecord[] }>('/api/emails/search?q=' + encodeURIComponent(query)).then((r) => { if (active) setSearchResults({ query, items: r.items }); }).catch((err) => { if (active) { setSearchResults({ query, items: [] }); setError(err instanceof Error ? err.message : 'Search failed.'); } }).finally(() => { if (active) setSearchLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search]);
  const visibleItems = useMemo(() => { const query = search.trim(); if (!query) return items; return searchResults?.query === query ? searchResults.items : []; }, [items, search, searchResults]);
  async function connectSlack() { setSlackBusy(true); window.location.href = `${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/integrations/slack/connect`; }
  async function disconnectSlack() { setSlackBusy(true); try { await api('/api/integrations/slack', { method: 'DELETE' }); setSlackConnected(false); } catch (err) { setError(err instanceof Error ? err.message : 'Could not disconnect Slack.'); } finally { setSlackBusy(false); } }
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#top" aria-label="ReachInbox home"><span className="brand-mark"><Send size={18}/></span><span>reachinbox<span className="brand-period">.</span><small>OUTBOX LABS</small></span></a>
      <div className="workspace-chip"><span className="workspace-avatar">{initials(user.name)}</span><span className="workspace-copy"><strong>Personal workspace</strong><small>Free plan</small></span><ChevronDown size={15}/></div>
      <div className="nav-caption">WORKSPACE</div>
      <button className={`nav-link ${tab === 'scheduled' ? 'active' : ''}`} onClick={() => setTab('scheduled')}><Clock3 size={17}/>Scheduled emails<span className="nav-indicator">{tab === 'scheduled' ? '•' : ''}</span></button>
      <button className={`nav-link ${tab === 'sent' ? 'active' : ''}`} onClick={() => setTab('sent')}><Send size={17}/>Sent emails</button>
      <button className={`nav-link ${tab === 'failed' ? 'active' : ''}`} onClick={() => setTab('failed')}><XCircle size={17}/>Failed emails</button>
      <div className="nav-caption nav-caption-lower">SETTINGS</div>
      <button className="nav-link" onClick={() => void (slackConnected ? disconnectSlack() : connectSlack())}><span className="slack-icon">#</span>{slackConnected ? 'Disconnect Slack' : 'Connect Slack'}<span className={`connection-dot ${slackConnected ? 'online' : ''}`}/></button>
      <a className="nav-link" href={`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/admin/queues`} target="_blank" rel="noreferrer"><Activity size={17}/>Queue monitor<ArrowUpRight className="nav-external" size={13}/></a>
      <div className="sidebar-spacer"/><div className="help-card"><div className="help-icon"><Sparkles size={17}/></div><strong>Built for thoughtful outreach</strong><p>Schedule carefully. Send reliably. Keep your pipeline moving.</p><button onClick={() => setComposeOpen(true)}>Create a campaign <ArrowUpRight size={14}/></button></div>
      <div className="sidebar-user"><span className="avatar avatar-small">{user.avatarUrl ? <img src={user.avatarUrl} alt=""/> : initials(user.name)}</span><span className="user-copy"><strong>{user.name}</strong><small>{user.email}</small></span><button title="Log out" className="icon-button icon-button-small" onClick={onLogout}><LogOut size={16}/></button></div>
    </aside>
    <main className="main-content" id="top">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>Email scheduler</strong></div><div className="top-actions"><div className="system-status"><span className="status-dot"/>System operational</div><button className="avatar avatar-top" title={user.email}>{user.avatarUrl ? <img src={user.avatarUrl} alt={user.name}/> : initials(user.name)}</button><button className="top-user" onClick={onLogout}><span><strong>{user.name}</strong><small>{user.email}</small></span><ChevronDown size={15}/></button></div></header>
      <section className="page-intro"><div><div className="eyebrow"><span className="eyebrow-line"/>OUTREACH CONTROL CENTER</div><h1>Email scheduler</h1><p>Manage your outreach with confidence, from first send to final delivery.</p></div><button className="button button-primary compose-trigger" onClick={() => setComposeOpen(true)}><Plus size={17}/>Compose new email</button></section>
      <section className="stats-grid">
        <div className="stat-card"><div className="stat-top"><span>Scheduled emails</span><span className="stat-icon purple"><Clock3 size={17}/></span></div><div className="stat-number">{counts.scheduled.toLocaleString()}</div><div className="stat-note"><span className="stat-bullet purple-bullet"/>Currently in the queue</div></div>
        <div className="stat-card"><div className="stat-top"><span>Sent emails</span><span className="stat-icon green"><CheckCircle2 size={17}/></span></div><div className="stat-number">{counts.sent.toLocaleString()}</div><div className="stat-note"><span className="stat-bullet green-bullet"/>Successfully processed</div></div>
        <div className="stat-card"><div className="stat-top"><span>Send interval</span><span className="stat-icon blue"><Activity size={17}/></span></div><div className="stat-number">2<span className="number-unit"> sec</span></div><div className="stat-note"><span className="stat-bullet blue-bullet"/>Configured minimum delay</div></div>
        <div className="stat-card"><div className="stat-top"><span>Delivery protection</span><span className="stat-icon amber"><ShieldCheck size={17}/></span></div><div className="stat-number">Active</div><div className="stat-note"><span className="stat-bullet green-bullet"/>Rate limits enabled</div></div>
      </section>
      <section className="emails-panel">
        <div className="panel-heading"><div><h2>Emails overview</h2><p>Review your campaigns and individual recipient status.</p></div><button className="button button-secondary" onClick={() => void refresh()}><ArrowDownToLine size={15}/>Refresh data</button></div>
        <div className="table-toolbar"><div className="tabs"><button className={tab === 'scheduled' ? 'selected' : ''} onClick={() => setTab('scheduled')}>Scheduled <span>{tab === 'scheduled' ? items.length : ''}</span></button><button className={tab === 'sent' ? 'selected' : ''} onClick={() => setTab('sent')}>Sent</button><button className={tab === 'failed' ? 'selected' : ''} onClick={() => setTab('failed')}>Failed</button></div><div className="table-tools"><label className="search-box"><Search size={16}/><input aria-label="Search emails" placeholder="Search recipient or subject" value={search} onChange={(e) => setSearch(e.target.value)}/>{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14}/></button>}</label><button className="filter-button" title="Filters are applied through the tabs"><SlidersHorizontal size={16}/><span>Filter</span></button></div></div>
        {error && <div className="banner-error"><XCircle size={17}/>{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={15}/></button></div>}
        <div className="table-wrap"><table><thead><tr><th>RECIPIENT</th><th>SUBJECT</th><th>{tab === 'sent' ? 'SENT TIME' : 'SCHEDULED TIME'}</th><th>SENDER</th><th>STATUS</th></tr></thead><tbody>
          {(loading || (search.trim() !== '' && (searchLoading || searchResults?.query !== search.trim()))) ? <tr><td colSpan={5}><div className="table-state"><span className="loader"/>{search.trim() ? 'Searching emails…' : 'Loading email records…'}</div></td></tr> : visibleItems.length === 0 ? <tr><td colSpan={5}><div className="empty-state"><div className="empty-icon"><Inbox size={22}/></div><strong>{search ? 'No matching emails' : tab === 'scheduled' ? 'Nothing scheduled yet' : tab === 'sent' ? 'No sent emails yet' : 'No failed emails'}</strong><p>{search ? 'Try a different recipient or subject.' : tab === 'scheduled' ? 'Create your first outreach campaign to see scheduled emails here.' : tab === 'sent' ? 'Emails will appear here after the worker processes them.' : 'Great! There are no failed emails to review.'}</p>{tab === 'scheduled' && !search && <button className="button button-primary" onClick={() => setComposeOpen(true)}><Plus size={16}/>Compose new email</button>}</div></td></tr> : visibleItems.map((item) => <tr key={item.id}><td><div className="recipient-cell"><span className="recipient-avatar">{item.recipient.slice(0,1).toUpperCase()}</span><span><strong>{item.recipient}</strong><small>{item.campaignId.slice(0, 12)}</small></span></div></td><td><span className="subject-cell">{item.subject}</span></td><td><span className="date-cell">{formatDate(tab === 'sent' ? item.sentAt : item.scheduledAt)}</span></td><td><span className="sender-chip"><span className="sender-dot"/>{item.senderKey}</span></td><td><span className={`status-pill ${item.status}`}><span/> {item.status}</span>{item.failureReason && <span title={item.failureReason} className="failure-hint">details</span>}</td></tr>)}
        </tbody></table></div>
        <div className="panel-footer"><span>Showing {visibleItems.length} of {items.length} loaded records</span><span className="pagination-note"><span className="status-dot"/>Live status from PostgreSQL</span></div>
      </section>
      <footer className="page-footer"><span>ReachInbox Scheduler <span className="footer-separator">·</span> Built for reliable outreach</span><span>Powered by BullMQ + Redis</span></footer>
    </main>
    {slackBusy && <div className="small-toast">Updating Slack integration…</div>}
    <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} senders={senders} defaultSenderKey={defaultSenderKey} onScheduled={() => { setTab('scheduled'); void refresh(); }}/>
  </div>;
}
