import React, { useState, useCallback, useEffect } from 'react';
import ProjectList from './ProjectList';
import ProjectForm from './ProjectForm';
import ProjectDetail from './ProjectDetail';
import { useAppStore } from '../../stores/appStore';

// ─── View State ─────────────────────────────────────────
type View =
  | { type: 'list' }
  | { type: 'form'; projectId?: string }
  | { type: 'detail'; projectId: string };

// ─── Module Root ────────────────────────────────────────
const ProjectsModule: React.FC = () => {
  const [view, setView] = useState<View>({ type: 'list' });
  const [refreshKey, setRefreshKey] = useState(0);

  // Cross-module deep link consumption.
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const focus = consumeFocusEntity('project');
    if (focus) setView({ type: 'detail', projectId: focus.id });
  }, [consumeFocusEntity]);

  const goToList = useCallback(() => {
    setView({ type: 'list' });
    setRefreshKey((k) => k + 1);
  }, []);

  const goToNew = useCallback(() => {
    setView({ type: 'form' });
  }, []);

  const goToEdit = useCallback((projectId: string) => {
    setView({ type: 'form', projectId });
  }, []);

  const goToDetail = useCallback((projectId: string) => {
    setView({ type: 'detail', projectId });
  }, []);

  const handleSaved = useCallback(() => {
    setView({ type: 'list' });
    setRefreshKey((k) => k + 1);
  }, []);

  // ─── Render ───────────────────────────────────────────
  const showForm = view.type === 'form';

  if (view.type === 'detail') {
    return (
      <ProjectDetail
        projectId={view.projectId}
        onBack={goToList}
        onEdit={goToEdit}
      />
    );
  }

  return (
    <>
      <ProjectList
        key={refreshKey}
        onSelectProject={goToDetail}
        onNewProject={goToNew}
      />
      {showForm && (
        <ProjectForm
          projectId={view.projectId ?? null}
          onClose={goToList}
          onSaved={handleSaved}
        />
      )}
    </>
  );
};

export default ProjectsModule;
