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
      {/* Sidebar */}
      <Sidebar />

      {/* Main Area */}
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />

        {/* Content */}
        <main
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
