import { useState } from 'react';

interface DisputeFormProps {
  token: string;
}

export default function DisputeForm({ token }: DisputeFormProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) { setError('Please describe your concern.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/portal/${token}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(`Submission failed (${res.status})`);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <section className="border-2 border-green-700 bg-green-50 p-4">
        <p className="text-green-800 font-bold uppercase tracking-wide text-sm">Thank you</p>
        <p className="text-green-700 text-sm mt-1">We have received your concern and will review and respond shortly.</p>
      </section>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-gray-600 hover:text-gray-900 underline underline-offset-2"
        aria-label="Dispute this invoice"
      >
        Dispute this invoice
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="border-2 border-gray-900 p-4 space-y-3" aria-label="Dispute form">
      <div className="flex justify-between items-center">
        <h3 className="font-black uppercase tracking-widest text-sm">Dispute this invoice</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-900"
          aria-label="Close dispute form"
        >
          Cancel
        </button>
      </div>
      <label className="block text-xs font-bold uppercase tracking-wide text-gray-600">
        What is the issue?
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          className="mt-1 w-full border-2 border-gray-900 p-2 text-sm font-normal normal-case tracking-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
          placeholder="Describe the discrepancy or concern..."
          required
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="bg-gray-900 text-white px-4 py-2 font-black uppercase text-xs tracking-widest hover:bg-gray-700 disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Submit dispute'}
      </button>
    </form>
  );
}
