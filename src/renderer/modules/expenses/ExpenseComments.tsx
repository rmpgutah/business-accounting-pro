import React, { useEffect, useState, useCallback } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { formatDate } from '../../lib/format';

interface Comment {
  id: string;
  user_id: string;
  user_name?: string;
  body: string;
  created_at: string;
}

interface Props { expenseId: string; }

const ExpenseComments: React.FC<Props> = ({ expenseId }) => {
  const user = useAuthStore((s) => s.user);
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.expenseListComments(expenseId);
    setComments(Array.isArray(res?.comments) ? res.comments : []);
  }, [expenseId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!body.trim() || !user) return;
    setBusy(true);
    try {
      await api.expenseAddComment(expenseId, user.id, body.trim());
      setBody('');
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="block-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={14} className="text-accent-blue" />
        <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">Comments</span>
        <span className="text-xs text-text-muted">({comments.length})</span>
      </div>
      <div className="space-y-2 max-h-56 overflow-y-auto mb-3">
        {comments.length === 0 ? (
          <div className="text-xs text-text-muted">No comments yet.</div>
        ) : comments.map((c) => (
          <div key={c.id} className="border border-border-primary p-2" style={{ borderRadius: 4 }}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-text-primary">{c.user_name || c.user_id || 'user'}</span>
              <span className="text-text-muted font-mono">{formatDate(c.created_at)}</span>
            </div>
            <div className="text-sm text-text-secondary mt-1 whitespace-pre-wrap">{c.body}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          className="block-input flex-1"
          placeholder="Add a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <button className="block-btn-primary flex items-center gap-1" onClick={send} disabled={busy || !body.trim()}>
          <Send size={13} /> Post
        </button>
      </div>
    </div>
  );
};

export default ExpenseComments;
