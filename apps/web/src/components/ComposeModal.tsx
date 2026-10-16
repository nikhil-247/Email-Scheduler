import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { AlertCircle, ArrowUpRight, FileUp, LoaderCircle, X } from 'lucide-react';
import { api, Sender } from '../lib/api';
type Props = { open: boolean; onClose: () => void; senders: Sender[]; defaultSenderKey: string; onScheduled: () => void };
function toLocalInputValue(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
export function ComposeModal({ open, onClose, senders, defaultSenderKey, onScheduled }: Props) {
  const [subject, setSubject] = useState(''); const [body, setBody] = useState('Hi there,\n\nI wanted to reach out with a quick introduction.\n\nBest,\nThe ReachInbox Team');
  const [recipients, setRecipients] = useState<string[]>([]); const [fileName, setFileName] = useState('');
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInputValue(new Date(Date.now() + 5 * 60_000)));
  const [delaySeconds, setDelaySeconds] = useState(2); const [hourlyLimit, setHourlyLimit] = useState(50); const [senderKey, setSenderKey] = useState(defaultSenderKey);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [lastAttempt, setLastAttempt] = useState<{ key: string; payload: string } | null>(null);
  const countLabel = useMemo(() => `${recipients.length} email${recipients.length === 1 ? '' : 's'} detected`, [recipients.length]);
  useEffect(() => { if (defaultSenderKey) setSenderKey(defaultSenderKey); }, [defaultSenderKey]);
  if (!open) return null;
  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return; setFileName(file.name); setError('');
    Papa.parse<string[]>(file, { header: false, skipEmptyLines: true, complete: (result) => {
      const allValues = (result.data as unknown as unknown[][]).flatMap((row) => Array.isArray(row) ? row : [row]);
      const candidates = allValues.filter((value): value is string => typeof value === 'string').flatMap((value) => value.toLowerCase().match(/[a-z0-9.!#$%&'*+\/?=^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/g) ?? []);
      const unique = [...new Set(candidates.map((value) => value.trim()).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
      if (!unique.length) { setError('No email addresses found. Use a CSV or text file containing email addresses.'); setRecipients([]); return; }
      setRecipients(unique);
    }, error: () => setError('Could not read this file. Please try another CSV or text file.') });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setLoading(true);
    const requestBody = JSON.stringify({ subject, body, recipients, scheduledAt: new Date(scheduledAt).toISOString(), delaySeconds, hourlyLimit, senderKey });
    const idempotencyKey = lastAttempt?.payload === requestBody ? lastAttempt.key : crypto.randomUUID(); setLastAttempt({ key: idempotencyKey, payload: requestBody });
    try {
      await api('/api/emails/schedule', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: requestBody });
      setLastAttempt(null); setLoading(false); onClose(); onScheduled(); setSubject(''); setRecipients([]); setFileName('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not schedule emails.'); setLoading(false); }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="compose-modal" role="dialog" aria-modal="true" aria-labelledby="compose-title">
      <div className="modal-heading"><div><span className="eyebrow">NEW CAMPAIGN</span><h2 id="compose-title">Compose emails</h2><p>Build a sequence and schedule the first send.</p></div><button className="icon-button" onClick={onClose} aria-label="Close compose dialog"><X size={19}/></button></div>
      <form onSubmit={submit} className="compose-form">
        <label>Subject<input required maxLength={250} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A quick introduction"/></label>
        <label>Email body<textarea required value={body} onChange={(e) => setBody(e.target.value)} rows={5}/></label>
        <div className="form-label-row"><label className="field-label">Recipients</label><span className="muted-small">CSV or TXT</span></div>
        <label className="upload-zone"><FileUp size={21}/><strong>{fileName || 'Upload your lead list'}</strong><span>{recipients.length ? countLabel : 'CSV with an email column, or one email per line'}</span><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={handleFile}/></label>
        <div className="split-fields"><label>Start time<input required type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} min={toLocalInputValue(new Date())}/></label><label>Sender<select value={senderKey} onChange={(e) => setSenderKey(e.target.value)} required>{senders.map((sender) => <option key={sender.key} value={sender.key}>{sender.name} · {sender.email}</option>)}</select></label></div>
        <div className="split-fields"><label>Delay between emails <span className="field-suffix">seconds</span><input type="number" min={0} max={3600} value={delaySeconds} onChange={(e) => setDelaySeconds(Number(e.target.value))} required/></label><label>Hourly campaign limit<input type="number" min={1} max={10000} value={hourlyLimit} onChange={(e) => setHourlyLimit(Number(e.target.value))} required/></label></div>
        {error && <div className="inline-error"><AlertCircle size={16}/>{error}</div>}
        <div className="modal-footer"><span className="muted-small">{recipients.length ? `${recipients.length} recipients queued` : 'Upload a recipient file to continue'}</span><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={loading || !recipients.length || !senders.length}>{loading ? <><LoaderCircle className="spin" size={16}/> Scheduling</> : <>Schedule emails <ArrowUpRight size={16}/></>}</button></div>
      </form>
    </section>
  </div>;
}
