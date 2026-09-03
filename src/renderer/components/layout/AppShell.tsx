import React, { Suspense, lazy } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import StatusBar from './StatusBar';
import { useAppStore } from '../../stores/appStore';

const CopilotPanel = lazy(() => import('../../modules/copilot/CopilotPanel'));

interface AppShellProps {
  children: React.ReactNode;
}

const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const copilotOpen = useAppStore((s) => s.copilotOpen);
  const setCopilotOpen = useAppStore((s) => s.setCopilotOpen);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-primary text-text-primary">
      {/* A11Y: Skip-to-main link visible on focus for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:text-white focus:px-3 focus:py-2 focus:text-xs focus:font-bold focus:uppercase"
        style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--app-radius)' }}
      >
        Skip to main content
      </a>
      {/* Sidebar */}
      <Sidebar />

      {/* Main Area */}
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />

        {/* Content */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-auto bg-bg-primary"
        >
          {/* Content width honors the "Use full window width" / "Max content
              width" customization options (Dashboard › Layout) via the
              --app-content-max-width CSS var set by applyCustomizationGlobals. */}
          <div style={{ maxWidth: 'var(--app-content-max-width, 1440px)', marginInline: 'auto', width: '100%' }}>
            {children}
          </div>
        </main>

        <StatusBar />
      </div>

      {/* AI Copilot drawer — toggled by Sidebar button + ⌘\ shortcut */}
      {copilotOpen && (
        <Suspense fallback={null}>
          <CopilotPanel onClose={() => setCopilotOpen(false)} />
        </Suspense>
      )}
    </div>
  );
};

export default AppShell;
