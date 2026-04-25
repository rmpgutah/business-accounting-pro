import React, { useState, useCallback, useEffect } from 'react';
import ClientList from './ClientList';
import ClientDetail from './ClientDetail';
import ClientForm from './ClientForm';
import { useAppStore } from '../../stores/appStore';

// ─── Module Root ────────────────────────────────────────
const ClientsModule: React.FC = () => {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  // Consume cross-module deep link from RelatedPanel/EntityChip.
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const focus = consumeFocusEntity('client');
    if (focus) setSelectedClientId(focus.id);
  }, [consumeFocusEntity]);
  const [formOpen, setFormOpen] = useState(false);
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  // ─── Navigation Handlers ────────────────────────────
  const handleSelectClient = useCallback((id: string) => {
    setSelectedClientId(id);
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedClientId(null);
  }, []);

  const handleNewClient = useCallback(() => {
    setEditClientId(null);
    setFormOpen(true);
  }, []);

  const handleEditClient = useCallback((id: string) => {
    setEditClientId(id);
    setFormOpen(true);
  }, []);

  const handleFormClose = useCallback(() => {
    setFormOpen(false);
    setEditClientId(null);
  }, []);

  const handleFormSaved = useCallback(() => {
    setFormOpen(false);
    setEditClientId(null);
    // Force list re-fetch by bumping key
    setListKey((k) => k + 1);
    // If we were in detail view, stay there (data will refresh)
  }, []);

  // ─── Render ─────────────────────────────────────────
  return (
    <>
      {selectedClientId ? (
        <ClientDetail
          key={selectedClientId}
          clientId={selectedClientId}
          onBack={handleBackToList}
          onEdit={handleEditClient}
        />
      ) : (
        <ClientList
          key={listKey}
          onSelectClient={handleSelectClient}
          onNewClient={handleNewClient}
        />
      )}

      {formOpen && (
        <ClientForm
          clientId={editClientId}
          onClose={handleFormClose}
          onSaved={handleFormSaved}
        />
      )}
    </>
  );
};

export default ClientsModule;
