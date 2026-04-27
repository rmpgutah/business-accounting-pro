import React from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import StatusBar from './StatusBar';

interface AppShellProps {
  children: React.ReactNode;
}

const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-primary text-text-primary">
      {/* A11Y: Skip-to-main link visible on focus for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-accent-blue focus:text-white focus:px-3 focus:py-2 focus:text-xs focus:font-bold focus:uppercase"
        style={{ borderRadius: 4 }}
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
          className="flex-1 overflow-auto"
          style={{
            background: 'linear-gradient(160deg, #08090c 0%, #0c0e14 40%, #0e1018 100%)',
          }}
        >
          {children}
        </main>

        <StatusBar />
      </div>
    </div>
  );
};

export default AppShell;
