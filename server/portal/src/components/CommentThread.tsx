import { useEffect, useState } from 'react';

interface Comment {
  id: string | number;
  body: string;
  sender: string;
  created_at: string;
}

interface CommentThreadProps {
  token: string;
  defaultSenderName?: string;
  defaultSenderEmail?: string;
}

function formatDate(s: string) {
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return s; }
}

export default function CommentThread({ token, defaultSenderName = '', defaultSenderEmail = '' }: CommentThreadProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [name, setName] = useState(defaultSenderName);
  const [email, setEmail] = useState(defaultSenderEmail);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`/portal/${token}/comments`);
      if (!res.ok) { setAvailable(false); return; }
      const json = await res.json();
      setComments(Array.isArray(json.comments) ? json.comments : []);
      setAvailable(true);
    } catch {
      setAvailable(false);
    }
  };

  useEffect(() => { void load(); }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !name.trim()) { setError('Name and message are required.'); return; }
    setPosting(true);
    setError('');
    try {
      const res = await fetch(`/portal/${token}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, sender_name: name, sender_email: email }),
      });
      if (!res.ok) throw new Error(`Post failed (${res.status})`);
      setBody('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Post failed');
    } finally {
      setPosting(false);
    }
  };

  if (available === null || available === false) return null;

  return (
    <section className="border-2 border-gray-900" aria-label="Messages">
      <header className="bg-gray-900 text-white px-4 py-2">
        <h2 className="font-black uppercase tracking-widest text-sm">Messages</h2>
      </header>
      <div className="p-4 space-y-3">
        {comments.length === 0 && (
          <p className="text-sm text-gray-500 italic">No messages yet. Start the conversation below.</p>
        )}
        {comments.map((c) => (
          <article key={c.id} className="border-l-4 border-gray-900 pl-3 py-1">
            <div className="flex justify-between items-baseline gap-2">
              <p className="font-bold text-sm text-gray-900">{c.sender || 'Anonymous'}</p>
              <p className="text-xs text-gray-500 tabular-nums">{formatDate(c.created_at)}</p>
            </div>
            <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{c.body}</p>
          </article>
        ))}
        <form onSubmit={submit} className="border-t-2 border-gray-900 pt-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="border-2 border-gray-900 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              required
              aria-label="Your name"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className="border-2 border-gray-900 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              aria-label="Your email"
            />
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a message..."
            rows={3}
            className="w-full border-2 border-gray-900 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            required
            aria-label="Message body"
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={posting}
            className="bg-gray-900 text-white px-4 py-2 font-black uppercase text-xs tracking-widest hover:bg-gray-700 disabled:opacity-50"
          >
            {posting ? 'Sending...' : 'Send message'}
          </button>
        </form>
      </div>
    </section>
  );
}
