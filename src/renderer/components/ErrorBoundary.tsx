import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  handleHardReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full p-12">
          <div className="block-card-elevated max-w-md w-full">
            <h2 className="text-base font-bold text-text-primary mb-2 font-mono">
              Module Error
            </h2>
            <p className="text-xs text-text-muted leading-relaxed mb-5">
              Something went wrong while rendering this module. Try reloading — if the error persists, use Hard Reload to restart the app.
            </p>
            <div
              className="mb-5 p-3 overflow-x-auto"
              style={{
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border-primary)',
                borderRadius: '6px',
              }}
            >
              <code
                className="text-accent-expense text-xs font-mono"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {this.state.error?.message ?? 'Unknown error'}
              </code>
            </div>
            <div className="flex gap-2">
              <button
                onClick={this.handleReload}
                className="block-btn-primary text-xs"
              >
                Reload Module
              </button>
              <button
                onClick={this.handleHardReload}
                className="block-btn text-xs"
              >
                Hard Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
