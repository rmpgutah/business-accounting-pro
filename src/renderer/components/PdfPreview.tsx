import React, { useEffect, useRef, useState } from 'react';
import api from '../lib/api';

interface PdfPreviewProps {
  html: string;
  title: string;
  pdfOptions?: { pageSize?: 'A4' | 'Letter' | 'Legal' | 'Tabloid'; landscape?: boolean; printBackground?: boolean };
  className?: string;
  style?: React.CSSProperties;
}

export const PdfPreview: React.FC<PdfPreviewProps> = ({ html, title, pdfOptions, className, style }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.renderPdf(html, pdfOptions).then((res: { base64?: string; error?: string }) => {
      if (cancelled) return;
      if (res.error || !res.base64) {
        setError(res.error || 'Failed to render PDF');
        setLoading(false);
        return;
      }
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const obj = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = obj;
      setUrl(obj);
      setLoading(false);
    }).catch((e: unknown) => {
      if (!cancelled) { setError(String((e as Error)?.message || e)); setLoading(false); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, JSON.stringify(pdfOptions), nonce]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid var(--hairline)' }}>
        <button className="block-btn" onClick={() => api.saveToPDF(html, title)}>Save as PDF</button>
        <button className="block-btn" onClick={() => api.print(html)}>Print</button>
      </div>
      {error && (
        <div style={{ padding: 16, color: 'var(--color-accent-expense)' }}>
          PDF error: {error}{' '}
          <button className="block-btn" onClick={() => setNonce((n) => n + 1)}>Retry</button>
        </div>
      )}
      {loading && !error && <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>Rendering PDF…</div>}
      {url && !error && (
        <embed src={url} type="application/pdf" style={{ flex: 1, width: '100%', border: 'none', minHeight: 480 }} />
      )}
    </div>
  );
};

export default PdfPreview;
