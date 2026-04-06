import React, { useEffect, useState } from 'react';
import { useCompanyStore } from '../../stores/companyStore';

const StatusBar: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'downloading' | 'ready'>('idle');
  const [updateVersion, setUpdateVersion] = useState('');
  const [downloadPercent, setDownloadPercent] = useState(0);

  useEffect(() => {
    const onDownloading = (_e: any, version: string) => {
      setUpdateStatus('downloading');
      setUpdateVersion(version || '');
    };
    const onProgress = (_e: any, percent: number) => {
      setDownloadPercent(percent);
    };
    const onReady = (_e: any, version: string) => {
      setUpdateStatus('ready');
      setUpdateVersion(version || '');
    };

    // Listen for update events from main process
    // electronAPI.on() returns a cleanup function
    const api = (window as any).electronAPI;
    const cleanups: Array<() => void> = [];
    if (api?.on) {
      cleanups.push(api.on('update:downloading', onDownloading));
      cleanups.push(api.on('update:progress', onProgress));
      cleanups.push(api.on('update:ready', onReady));
    }

    return () => {
      cleanups.forEach((fn) => typeof fn === 'function' && fn());
    };
  }, []);

  const fiscalYear = activeCompany?.fiscal_year_end
    ? `FY ${activeCompany.fiscal_year_end}`
    : 'FY 2025';

  return (
    <footer
      className="flex items-center justify-between h-6 px-3 text-[11px] text-text-muted shrink-0 select-none"
      style={{
        borderRadius: '0px',
        background: 'rgba(14, 15, 20, 0.70)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div className="flex items-center gap-3">
        <span>{fiscalYear}</span>
        {activeCompany?.name && (
          <>
            <span className="text-border-secondary">|</span>
            <span>{activeCompany.name}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {updateStatus === 'downloading' && (
          <span className="text-accent-blue flex items-center gap-1.5">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-accent-blue"
              style={{ animation: 'pulse 1.5s infinite' }}
            />
            Updating{downloadPercent > 0 ? ` ${downloadPercent}%` : '...'}
          </span>
        )}
        {updateStatus === 'ready' && (
          <span className="text-accent-income flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-income" />
            v{updateVersion} ready — restart to apply
          </span>
        )}
        <span>Business Accounting Pro v1.3.0</span>
      </div>
    </footer>
  );
};

export default StatusBar;
