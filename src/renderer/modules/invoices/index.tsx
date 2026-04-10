import React, { useState, useCallback } from 'react';
import InvoiceList from './InvoiceList';
import InvoiceForm from './InvoiceForm';
import InvoiceDetail from './InvoiceDetail';
import InvoiceSettings from './InvoiceSettings';
import CatalogManager from './CatalogManager';

// ─── View State ─────────────────────────────────────────
type View =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'edit'; invoiceId: string }
  | { type: 'detail'; invoiceId: string }
  | { type: 'settings' }
  | { type: 'catalog' };

// ─── Module Router ──────────────────────────────────────
const InvoicingModule: React.FC = () => {
  const [view, setView] = useState<View>(() => {
    // If navigated here from "Create Invoice from Time", open the new form immediately
    const flag = sessionStorage.getItem('nav:invoiceNew');
    if (flag) {
      sessionStorage.removeItem('nav:invoiceNew');
      return { type: 'new' };
    }
    return { type: 'list' };
  });

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
  const goToSettings = useCallback(() => setView({ type: 'settings' }), []);
  const goToCatalog = useCallback(() => setView({ type: 'catalog' }), []);

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

    case 'settings':
      return <InvoiceSettings onBack={goToList} />;

    case 'catalog':
      return <CatalogManager onBack={goToList} />;

    case 'list':
    default:
      return (
        <InvoiceList
          onNewInvoice={goToNew}
          onViewInvoice={goToDetail}
          onEditInvoice={goToEdit}
          onSettings={goToSettings}
          onCatalog={goToCatalog}
        />
      );
  }
};

export default InvoicingModule;
