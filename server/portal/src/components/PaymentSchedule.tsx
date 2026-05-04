import { useEffect, useState } from 'react';

interface Milestone {
  id?: string | number;
  description?: string;
  due_date?: string;
  amount?: number | string;
  status?: string;
  paid?: boolean;
}

interface PaymentScheduleProps {
  token: string;
}

const fmt = (n: number | string | undefined) => {
  const v = typeof n === 'number' ? n : Number(n ?? 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number.isFinite(v) ? v : 0);
};

const fmtDate = (s?: string) => {
  if (!s) return '—';
  try {
    const d = new Date(s.includes('T') ? s : s + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
};

export default function PaymentSchedule({ token }: PaymentScheduleProps) {
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/portal/${token}/payment-schedule`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const list = j && Array.isArray(j.milestones) ? j.milestones : null;
        setMilestones(list && list.length > 0 ? list : []);
      })
      .catch(() => { if (!cancelled) setMilestones([]); });
    return () => { cancelled = true; };
  }, [token]);

  if (!milestones || milestones.length === 0) return null;

  return (
    <section className="border-2 border-gray-900" aria-label="Payment schedule">
      <header className="bg-gray-900 text-white px-4 py-2">
        <h2 className="font-black uppercase tracking-widest text-sm">Payment schedule</h2>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b-2 border-gray-900">
            <th className="text-left px-4 py-2 font-black uppercase tracking-widest text-xs">Milestone</th>
            <th className="text-left px-4 py-2 font-black uppercase tracking-widest text-xs w-32">Due</th>
            <th className="text-right px-4 py-2 font-black uppercase tracking-widest text-xs w-28">Amount</th>
            <th className="text-center px-4 py-2 font-black uppercase tracking-widest text-xs w-24">Status</th>
          </tr>
        </thead>
        <tbody>
          {milestones.map((m, i) => {
            const isPaid = m.paid === true || (m.status || '').toLowerCase() === 'paid';
            return (
              <tr key={m.id ?? i} className={i % 2 === 1 ? 'bg-gray-50' : ''}>
                <td className="px-4 py-2 text-gray-800">{m.description || `Milestone ${i + 1}`}</td>
                <td className="px-4 py-2 text-gray-600 tabular-nums">{fmtDate(m.due_date)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(m.amount)}</td>
                <td className="px-4 py-2 text-center">
                  <span className={`text-[10px] font-black uppercase tracking-widest border-2 px-2 py-0.5 ${
                    isPaid ? 'border-green-700 text-green-800 bg-green-100' : 'border-gray-400 text-gray-600 bg-gray-50'
                  }`}>
                    {isPaid ? 'Paid' : (m.status || 'Open')}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
