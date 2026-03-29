import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, Search, Bell, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useCompanyStore } from '../../stores/companyStore';
import api from '../../lib/api';

const TopBar: React.FC = () => {
  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    notificationCount,
  } = useAppStore();
  const { activeCompany } = useCompanyStore();

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localQuery, setLocalQuery] = useState('');

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setLocalQuery('');
        setSearchQuery('');
        setSearchResults([]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setSearchOpen, setSearchQuery, setSearchResults]);

  // Focus input when modal opens
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  // Debounced search
  const handleSearchInput = useCallback(
    (value: string) => {
      setLocalQuery(value);
      setSearchQuery(value);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!value.trim()) {
        setSearchResults([]);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        try {
          const results = await api.globalSearch(value);
          setSearchResults(results || []);
        } catch {
          setSearchResults([]);
        }
      }, 300);
    },
    [setSearchQuery, setSearchResults]
  );

  const closeSearch = () => {
    setSearchOpen(false);
    setLocalQuery('');
    setSearchQuery('');
    setSearchResults([]);
  };

  // Group results by type
  const grouped = searchResults.reduce<Record<string, typeof searchResults>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  return (
    <>
      <header
        className="flex items-center justify-between h-12 px-4 bg-bg-secondary border-b border-border-primary shrink-0"
        style={{ borderRadius: '0px' }}
      >
        {/* Left — Company */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            className="flex items-center gap-2 px-2 py-1 text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '2px' }}
          >
            <Building2 size={16} className="text-text-muted shrink-0" />
            <span className="text-sm font-medium truncate max-w-[200px]">
              {activeCompany?.name ?? 'No Company'}
            </span>
            <ChevronDown size={14} className="text-text-muted shrink-0" />
          </button>
        </div>

        {/* Center — Search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 w-80 bg-bg-primary border border-border-secondary text-text-muted text-sm hover:border-border-focus transition-colors"
          style={{ borderRadius: '2px' }}
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search...</span>
          <kbd
            className="text-[10px] px-1.5 py-0.5 bg-bg-tertiary border border-border-secondary text-text-muted"
            style={{ borderRadius: '2px' }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Right — Notifications */}
        <div className="flex items-center">
          <button
            className="relative p-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '2px' }}
          >
            <Bell size={18} />
            {notificationCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-accent-expense"
                style={{ borderRadius: '2px' }}
              >
                {notificationCount > 99 ? '99+' : notificationCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Search Modal Overlay */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60"
          onClick={closeSearch}
        >
          <div
            className="w-full max-w-xl bg-bg-elevated border border-border-primary shadow-2xl"
            style={{ borderRadius: '2px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border-primary">
              <Search size={16} className="text-text-muted shrink-0" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search accounts, invoices, clients, transactions..."
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
                value={localQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
              />
              <button
                onClick={closeSearch}
                className="p-1 text-text-muted hover:text-text-primary"
                style={{ borderRadius: '2px' }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto">
              {Object.keys(grouped).length === 0 && localQuery.trim() && (
                <div className="px-4 py-6 text-center text-sm text-text-muted">
                  No results found
                </div>
              )}
              {Object.entries(grouped).map(([type, items]) => (
                <div key={type} className="py-2">
                  <div className="px-4 py-1">
                    <span
                      className="inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-accent-blue/15 text-accent-blue"
                      style={{ borderRadius: '2px' }}
                    >
                      {type}
                    </span>
                  </div>
                  {items.map((result) => (
                    <button
                      key={result.id}
                      className="flex flex-col w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors"
                      onClick={() => {
                        closeSearch();
                        // Navigation to result can be handled by consumer
                      }}
                    >
                      <span className="text-sm text-text-primary">{result.title}</span>
                      {result.subtitle && (
                        <span className="text-xs text-text-muted">{result.subtitle}</span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* Footer hint */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-border-primary text-[11px] text-text-muted">
              <span>Type to search</span>
              <span>
                <kbd className="px-1 py-0.5 bg-bg-tertiary border border-border-secondary" style={{ borderRadius: '2px' }}>
                  ESC
                </kbd>{' '}
                to close
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default TopBar;
