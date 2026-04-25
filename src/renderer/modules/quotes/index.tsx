import React, { useState, useCallback, useEffect } from 'react';
import { FileCheck } from 'lucide-react';
import QuoteList from './QuoteList';
import QuoteForm from './QuoteForm';
import { useAppStore } from '../../stores/appStore';

// ─── Types ──────────────────────────────────────────────
type QuoteView = 'list' | 'form';

// ─── Tab Button ─────────────────────────────────────────
const TabBtn: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ active, icon, label, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors ${
      active
        ? 'bg-bg-tertiary text-text-primary border-b-2 border-accent-blue'
        : 'text-text-muted hover:text-text-secondary transition-colors'
    }`}
    style={{ borderRadius: '6px 6px 0 0' }}
  >
    {icon}
    {label}
  </button>
);

// ─── Main Module ────────────────────────────────────────
const QuotesModule: React.FC = () => {
  const [quoteView, setQuoteView] = useState<QuoteView>('list');
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quoteKey, setQuoteKey] = useState(0);

  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const focus = consumeFocusEntity('quote');
    if (focus) {
      setEditingQuoteId(focus.id);
      setQuoteView('form');
    }
  }, [consumeFocusEntity]);

  const handleNewQuote = useCallback(() => {
    setEditingQuoteId(null);
    setQuoteView('form');
  }, []);

  const handleEditQuote = useCallback((id: string) => {
    setEditingQuoteId(id);
    setQuoteView('form');
  }, []);

  const handleQuoteBack = useCallback(() => {
    setQuoteView('list');
    setEditingQuoteId(null);
  }, []);

  const handleQuoteSaved = useCallback(() => {
    setQuoteView('list');
    setEditingQuoteId(null);
    setQuoteKey((k) => k + 1);
  }, []);

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Tabs */}
      <div className="flex border-b border-border-primary mb-6 cursor-pointer">
        <TabBtn
          active={true}
          icon={<FileCheck size={16} />}
          label="Quotes"
          onClick={() => {}}
        />
      </div>

      {/* Content */}
      {quoteView === 'list' && (
        <QuoteList
          key={quoteKey}
          onNew={handleNewQuote}
          onEdit={handleEditQuote}
        />
      )}

      {quoteView === 'form' && (
        <QuoteForm
          quoteId={editingQuoteId}
          onBack={handleQuoteBack}
          onSaved={handleQuoteSaved}
        />
      )}
    </div>
  );
};

export default QuotesModule;
