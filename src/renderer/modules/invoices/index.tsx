import React, { useState, useCallback } from 'react';
import InvoiceList from './InvoiceList';
import InvoiceForm from './InvoiceForm';
import InvoiceDetail from './InvoiceDetail';

// ─── View State ─────────────────────────────────────────
type View =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'edit'; invoiceId: string }
  | { type: 'detail'; invoiceId: string };

// ─── Module Router ──────────────────────────────────────
const InvoicingModule: React.FC = () => {
  const [view, setView] = useState<View>({ type: 'list' });

  const goToList = useCallback(() => setView({ type: 'list' }), []);
  const goToNew = useCallback(() => setView({ type: 'new' }), []);
  const goToEdit = useCallback(
    (id: string) => setView({ type: 'edit', invoiceId: id }),
    []
  );
  const goToDetail = useCallback(
    (id: string) => setView({ type: 'detail', invoiceId: id }),
    []
  );

  const handleSaved = useCallback((id: string) => {
    setView({ type: 'detail', invoiceId: id });
  }, []);

  switch (view.type) {
    case 'new':
      return (
        <InvoiceForm
          onBack={goToList}
          onSaved={handleSaved}
        />
      );

    case 'edit':
      return (
        <InvoiceForm
          invoiceId={view.invoiceId}
          onBack={() => goToDetail(view.invoiceId)}
          onSaved={handleSaved}
        />
      );

    case 'detail':
      return (
        <InvoiceDetail
          invoiceId={view.invoiceId}
          onBack={goToList}
          onEdit={goToEdit}
        />
      );

    case 'list':
    default:
      return (
        <InvoiceList
          onNewInvoice={goToNew}
          onViewInvoice={goToDetail}
          onEditInvoice={goToEdit}
        />
      );
  }
};

export default InvoicingModule;
