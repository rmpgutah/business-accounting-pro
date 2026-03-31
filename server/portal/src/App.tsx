import { useEffect, useState } from 'react';

interface Invoice {
  id: string;
  invoice_number: string;
  total: number;
  status: string;
  due_date: string;
  notes: string;
}
interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}
interface Company {
  name: string;
  email: string;
  address: string;
}
interface PortalData {
  invoice: Invoice;
  lineItems: LineItem[];
  company: Company;
}

export default function App() {
  const token = window.location.pathname.split('/portal/')[1]?.replace(/\/$/, '') ?? '';
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState('');
  const [paid, setPaid] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) { setError('Invalid portal link'); return; }
    fetch(`/portal/${token}/data`)
      .then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(new Error(e.error))))
      .then((d: PortalData) => setData(d))
      .catch((e: Error) => setError(e.message));

    if (new URLSearchParams(window.location.search).get('paid') === '1') setPaid(true);
  }, [token]);

  const handlePayNow = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (json.error) { setError(json.error); setLoading(false); return; }
      if (!json.url) { setError('Unable to start payment session.'); setLoading(false); return; }
      window.location.href = json.url;
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  if (error) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white border-2 border-red-500 p-8 max-w-md w-full">
        <h1 className="text-2xl font-black text-red-600 mb-2 uppercase tracking-tight">Error</h1>
        <p className="text-gray-700">{error}</p>
      </div>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <p className="text-gray-500 font-mono text-sm">Loading invoice...</p>
    </div>
  );

  const { invoice, lineItems, company } = data;
  const isPaid = paid || invoice.status === 'paid';

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8">
      <div className="max-w-2xl mx-auto bg-white border-2 border-gray-900">

        {/* Header */}
        <div className="bg-gray-900 text-white p-6 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-black tracking-tight uppercase">{company.name}</h1>
            {company.email && <p className="text-gray-400 text-sm mt-1">{company.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-widest">Invoice</p>
            <p className="text-xl font-black">{invoice.invoice_number}</p>
          </div>
        </div>

        {/* Status bar */}
        <div className="px-6 py-4 border-b-2 border-gray-900 flex items-center gap-4">
          <span className={`px-3 py-1 text-xs font-black uppercase tracking-widest border-2 ${
            isPaid
              ? 'border-green-600 text-green-700 bg-green-50'
              : 'border-orange-500 text-orange-700 bg-orange-50'
          }`}>
            {isPaid ? 'Paid' : 'Unpaid'}
          </span>
          {invoice.due_date && (
            <span className="text-sm text-gray-500">Due: <span className="font-bold text-gray-800">{invoice.due_date}</span></span>
          )}
        </div>

        {/* Line items */}
        <div className="p-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-900 text-left">
                <th className="pb-2 font-black uppercase tracking-wide">Description</th>
                <th className="pb-2 font-black uppercase tracking-wide text-right w-16">Qty</th>
                <th className="pb-2 font-black uppercase tracking-wide text-right w-24">Rate</th>
                <th className="pb-2 font-black uppercase tracking-wide text-right w-24">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-2.5 pr-4">{item.description}</td>
                  <td className="py-2.5 text-right">{item.quantity}</td>
                  <td className="py-2.5 text-right">${Number(item.unit_price).toFixed(2)}</td>
                  <td className="py-2.5 text-right font-medium">${Number(item.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 flex justify-end">
            <div className="border-2 border-gray-900 px-6 py-3 flex gap-12 items-baseline">
              <span className="text-sm font-black uppercase tracking-widest text-gray-600">Total</span>
              <span className="text-3xl font-black">${Number(invoice.total).toFixed(2)}</span>
            </div>
          </div>

          {invoice.notes && (
            <p className="mt-4 text-sm text-gray-500 border-t pt-4">{invoice.notes}</p>
          )}
        </div>

        {/* Pay / Paid footer */}
        {!isPaid ? (
          <div className="p-6 border-t-2 border-gray-900">
            <button
              onClick={handlePayNow}
              disabled={loading}
              className="w-full bg-gray-900 text-white py-4 font-black text-sm uppercase tracking-widest hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Redirecting to Stripe\u2026' : 'Pay Now'}
            </button>
            <p className="text-center text-xs text-gray-400 mt-2">Secured by Stripe</p>
          </div>
        ) : (
          <div className="p-6 border-t-2 border-green-600 bg-green-50 text-center">
            <p className="text-green-700 font-black text-lg uppercase tracking-wide">&#10003; Payment Received</p>
            <p className="text-green-600 text-sm mt-1">Thank you for your payment.</p>
          </div>
        )}
      </div>
    </div>
  );
}
