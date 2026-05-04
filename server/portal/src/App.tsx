import { useEffect, useMemo, useState } from 'react';
import StatusBadge from './components/StatusBadge';
import Skeleton from './components/Skeleton';
import ErrorState from './components/ErrorState';
import DisputeForm from './components/DisputeForm';
import CommentThread from './components/CommentThread';
import PaymentSchedule from './components/PaymentSchedule';

interface Invoice {
  id: string;
  invoice_number: string;
  total: number;
  amount_paid?: number;
  subtotal?: number;
  tax?: number;
  status: string;
  issue_date?: string;
  due_date: string;
  notes?: string;
  terms?: string;
  client_name?: string;
  client_email?: string;
  client_address?: string;
  bill_to?: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

interface Company {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  logo_data?: string;
}

interface PortalData {
  invoice: Invoice;
  lineItems: LineItem[];
  company: Company;
}

const fmtCurrency = (n: number | string | undefined | null): string => {
  const v = typeof n === 'number' ? n : Number(n ?? 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(
    Number.isFinite(v) ? v : 0
  );
};

const fmtDate = (s?: string): string => {
  if (!s) return '—';
  try {
    const d = new Date(s.includes('T') ? s : s + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch { return s; }
};

const buildCompanyAddress = (c: Company): string => {
  if (c.address) return c.address;
  const parts = [
    c.address_line1,
    c.address_line2,
    [c.city, c.state, c.zip].filter(Boolean).join(', '),
  ].filter(Boolean);
  return parts.join('\n');
};

export default function App() {
  const token = window.location.pathname.split('/portal/')[1]?.replace(/\/$/, '') ?? '';
  const [data, setData] = useState<PortalData | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | undefined>();
  const [errorMsg, setErrorMsg] = useState('');
  const [paidFlash, setPaidFlash] = useState(false);
  const [payLink, setPayLink] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setErrorMsg('Invalid portal link'); setErrorStatus(404); return; }
    fetch(`/portal/${token}/data`)
      .then(async (r) => {
        if (r.ok) return r.json();
        let msg = '';
        try { const j = await r.json(); msg = j.error || ''; } catch { /* ignore */ }
        setErrorStatus(r.status);
        setErrorMsg(msg);
        return Promise.reject(new Error(msg || `HTTP ${r.status}`));
      })
      .then((d: PortalData) => setData(d))
      .catch(() => { /* error already set */ });

    if (new URLSearchParams(window.location.search).get('paid') === '1') setPaidFlash(true);
  }, [token]);

  // Fetch optional Stripe payment link; hide button silently if endpoint isn't live.
  useEffect(() => {
    if (!token || !data) return;
    if ((data.invoice.status || '').toLowerCase() === 'paid') return;
    let cancelled = false;
    fetch(`/portal/${token}/pay-link`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        if (j && typeof j.payment_link_url === 'string' && j.payment_link_url) {
          setPayLink(j.payment_link_url);
        }
      })
      .catch(() => { /* hide section */ });
    return () => { cancelled = true; };
  }, [token, data]);

  const summary = useMemo(() => {
    if (!data) return null;
    const total = Number(data.invoice.total || 0);
    const paid = Number(data.invoice.amount_paid || 0);
    const subtotal = Number(data.invoice.subtotal ?? data.lineItems.reduce((s, li) => s + Number(li.amount || 0), 0));
    const tax = Number(data.invoice.tax || 0);
    return { total, paid, balance: Math.max(0, total - paid), subtotal, tax };
  }, [data]);

  if (errorMsg || errorStatus) {
    return <ErrorState status={errorStatus} message={errorMsg} companyName={data?.company?.name} />;
  }
  if (!data || !summary) return <Skeleton />;

  const { invoice, lineItems, company } = data;
  const status = (invoice.status || '').toLowerCase();
  const isPaid = paidFlash || status === 'paid';
  const effectiveStatus = isPaid ? 'paid' : status;
  const companyAddress = buildCompanyAddress(company);
  const billTo = invoice.bill_to || invoice.client_name || '';
  const billToAddress = invoice.client_address || '';
  const billToEmail = invoice.client_email || '';

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto bg-white border-2 border-gray-900 shadow-sm">

        {/* Letterhead */}
        <header className="bg-gray-900 text-white p-6 sm:p-8 flex flex-col sm:flex-row justify-between gap-6">
          <div className="flex gap-4 items-start">
            {company.logo_data && /^data:image\//.test(company.logo_data) && (
              <img
                src={company.logo_data}
                alt={`${company.name} logo`}
                className="h-16 w-16 object-contain bg-white border-2 border-white"
              />
            )}
            <div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight uppercase leading-tight">{company.name}</h1>
              {companyAddress && (
                <p className="text-gray-300 text-sm mt-2 whitespace-pre-line leading-snug">{companyAddress}</p>
              )}
              <p className="text-gray-400 text-xs mt-2 space-x-3">
                {company.phone && <span>{company.phone}</span>}
                {company.email && <span>{company.email}</span>}
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right border-t-2 sm:border-t-0 sm:border-l-2 border-gray-700 pt-4 sm:pt-0 sm:pl-6">
            <p className="text-[10px] text-gray-400 uppercase tracking-[0.3em] font-black">Invoice</p>
            <p className="text-2xl font-black tabular-nums mt-1">#{invoice.invoice_number}</p>
            <div className="mt-2"><StatusBadge status={effectiveStatus} /></div>
            <dl className="mt-3 text-xs text-gray-300 space-y-0.5">
              {invoice.issue_date && (
                <div className="flex sm:justify-end gap-2">
                  <dt className="uppercase tracking-wider text-gray-500">Issued:</dt>
                  <dd className="tabular-nums text-gray-200">{fmtDate(invoice.issue_date)}</dd>
                </div>
              )}
              {invoice.due_date && (
                <div className="flex sm:justify-end gap-2">
                  <dt className="uppercase tracking-wider text-gray-500">Due:</dt>
                  <dd className="tabular-nums text-gray-200 font-bold">{fmtDate(invoice.due_date)}</dd>
                </div>
              )}
            </dl>
          </div>
        </header>

        {/* Bill-to + summary cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 border-b-2 border-gray-900">
          <div className="p-6 border-b-2 sm:border-b-0 sm:border-r-2 border-gray-900">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-2">Bill to</p>
            {billTo ? (
              <>
                <p className="font-black text-lg uppercase">{billTo}</p>
                {billToAddress && <p className="text-sm text-gray-700 whitespace-pre-line mt-1">{billToAddress}</p>}
                {billToEmail && <p className="text-sm text-gray-600 mt-1">{billToEmail}</p>}
              </>
            ) : (
              <p className="text-sm text-gray-500 italic">Customer details on file</p>
            )}
          </div>
          <div className="p-6 bg-gray-50">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-2">Summary</p>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-600">Subtotal</dt>
                <dd className="tabular-nums">{fmtCurrency(summary.subtotal)}</dd>
              </div>
              {summary.tax > 0 && (
                <div className="flex justify-between">
                  <dt className="text-gray-600">Tax</dt>
                  <dd className="tabular-nums">{fmtCurrency(summary.tax)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t-2 border-gray-900 pt-1 mt-1">
                <dt className="font-black uppercase text-xs tracking-widest">Total</dt>
                <dd className="tabular-nums font-black">{fmtCurrency(summary.total)}</dd>
              </div>
              {summary.paid > 0 && (
                <div className="flex justify-between text-green-700">
                  <dt>Paid</dt>
                  <dd className="tabular-nums">−{fmtCurrency(summary.paid)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-300 pt-1 mt-1">
                <dt className="font-black uppercase text-xs tracking-widest">Balance due</dt>
                <dd className={`tabular-nums font-black text-lg ${summary.balance > 0 ? 'text-red-700' : 'text-green-700'}`}>
                  {fmtCurrency(summary.balance)}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Line items */}
        <section className="p-4 sm:p-6">
          <table className="w-full text-sm">
            <caption className="sr-only">Invoice line items</caption>
            <thead>
              <tr className="border-b-2 border-gray-900 text-left">
                <th scope="col" className="pb-2 font-black uppercase tracking-widest text-[10px] text-gray-600">Description</th>
                <th scope="col" className="pb-2 font-black uppercase tracking-widest text-[10px] text-gray-600 text-right w-16">Qty</th>
                <th scope="col" className="pb-2 font-black uppercase tracking-widest text-[10px] text-gray-600 text-right w-28">Rate</th>
                <th scope="col" className="pb-2 font-black uppercase tracking-widest text-[10px] text-gray-600 text-right w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, i) => (
                <tr key={i} className={i % 2 === 1 ? 'bg-gray-50' : ''}>
                  <td className="py-2.5 px-2 align-top text-gray-800">{item.description}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums align-top">{item.quantity}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums align-top">{fmtCurrency(item.unit_price)}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums font-medium align-top">{fmtCurrency(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Notes / Terms */}
        {(invoice.notes || invoice.terms) && (
          <section className="px-4 sm:px-6 pb-6 space-y-3">
            {invoice.notes && (
              <div className="border-t border-gray-200 pt-3">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-1">Notes</p>
                <p className="text-sm text-gray-600 italic whitespace-pre-line">{invoice.notes}</p>
              </div>
            )}
            {invoice.terms && (
              <div className="border-t border-gray-200 pt-3">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-1">Terms</p>
                <p className="text-sm text-gray-600 italic whitespace-pre-line">{invoice.terms}</p>
              </div>
            )}
          </section>
        )}

        {/* Actions: Pay online / Download PDF */}
        <section className="border-t-2 border-gray-900 p-4 sm:p-6 space-y-3" aria-label="Invoice actions">
          {!isPaid && payLink && (
            <a
              href={payLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center bg-gray-900 text-white py-4 font-black text-sm uppercase tracking-widest hover:bg-gray-700 transition-colors"
              aria-label={`Pay ${fmtCurrency(summary.balance)} online`}
            >
              Pay {fmtCurrency(summary.balance)} online
            </a>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <a
              href={`/portal/${token}/receipt`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center border-2 border-gray-900 text-gray-900 py-3 font-black text-xs uppercase tracking-widest hover:bg-gray-900 hover:text-white transition-colors"
              aria-label="Download invoice as PDF"
            >
              Download PDF
            </a>
            {isPaid && (
              <div className="flex-1 text-center bg-green-50 border-2 border-green-700 py-3 text-green-800 font-black text-xs uppercase tracking-widest">
                &#10003; Paid in full
              </div>
            )}
          </div>
          <DisputeForm token={token} />
        </section>

        {/* Optional sections */}
        <div className="p-4 sm:p-6 pt-0 space-y-4">
          <PaymentSchedule token={token} />
          <CommentThread
            token={token}
            defaultSenderName={billTo}
            defaultSenderEmail={billToEmail}
          />
        </div>

        {/* Footer */}
        <footer className="border-t-2 border-gray-900 px-4 sm:px-6 py-3 text-center text-[10px] text-gray-500 uppercase tracking-[0.3em]">
          {company.name} &middot; Secured invoice portal
        </footer>
      </div>
    </div>
  );
}
